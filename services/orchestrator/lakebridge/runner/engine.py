"""Run engine — orchestrates the six-step pipeline for a single job run.

States, in order: connect → count → extract → load → recon → finalize.

The engine is intentionally synchronous. Concurrent jobs run on separate
threads from the runner thread pool (see `lakebridge.scheduler`). This
keeps each step easy to reason about; the cost of a process-wide GIL is
trivial because the heavy work is I/O-bound (Oracle fetch, SQL Server
bulk insert).
"""

from __future__ import annotations

import contextlib
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from ..logging import get_logger
from ..models import StepName
from . import sinks, sources

log = get_logger("lakebridge.runner")

STEPS: tuple[StepName, ...] = ("connect", "count", "extract", "load", "recon", "finalize")


@dataclass(frozen=True)
class JobSpec:
    """Everything the engine needs to run one job."""

    job_id: int
    code: str
    strategy: str
    source_object: str
    source_query: str | None
    target_schema: str
    target_table: str
    batch_size: int
    watermark_column: str | None
    watermark_before: str | None
    # Source connection
    source_host: str
    source_port: int
    source_sid: str | None
    source_service_name: str | None
    source_user: str
    source_password: str
    source_tls_required: bool


@dataclass
class RunResult:
    run_id: int
    status: str
    rows_loaded: int
    error_count: int
    source_count: int
    target_count: int
    watermark_after: str | None


class RunStateSink(Protocol):
    """Callbacks the engine fires as it progresses.

    The default implementation in `lakebridge.runner.persistence` writes to
    `lakebridge.runs` / `run_steps` / `run_errors`; tests can swap in a
    recording implementation.
    """

    def on_run_start(self, run_id: int) -> None: ...
    def on_run_finish(self, run_id: int, status: str, watermark_after: str | None) -> None: ...
    def on_step_start(self, run_id: int, step_no: int, step_name: StepName) -> None: ...
    def on_step_progress(
        self, run_id: int, step_no: int, progress_pct: int, rows_processed: int, message: str | None
    ) -> None: ...
    def on_step_finish(
        self, run_id: int, step_no: int, step_name: StepName, status: str, message: str | None
    ) -> None: ...
    def on_error(
        self,
        run_id: int,
        severity: str,
        code: str,
        step_name: StepName | None,
        message: str,
        source_pk: str | None,
        payload_json: str | None,
    ) -> None: ...
    def record_recon(
        self,
        run_id: int,
        job_id: int,
        source_count: int,
        target_count: int,
        checksum_match: bool,
        threshold_pct: float,
    ) -> None: ...


# ── Watermark-delta helpers ──────────────────────────────────────────────


def _build_extraction_sql(spec: JobSpec) -> tuple[str, dict[str, Any]]:
    """Compose the SELECT the runner sends to Oracle, plus bound params.

    If `source_query` is set on the job, use it verbatim (operator's
    responsibility to bind `:wm` where appropriate). Otherwise, fall back
    to `SELECT * FROM <source_object>` with an optional watermark predicate.
    """
    params: dict[str, Any] = {}
    if spec.source_query:
        sql = spec.source_query
        if ":wm" in sql:
            if spec.watermark_before is None:
                raise ValueError(
                    f"job {spec.code} uses :wm but no current watermark is recorded"
                )
            params["wm"] = spec.watermark_before
        return sql, params

    sql = f"SELECT * FROM {spec.source_object}"
    if spec.strategy == "watermark_delta":
        if not spec.watermark_column:
            raise ValueError(f"job {spec.code} is watermark_delta but has no watermark_column")
        if spec.watermark_before is None:
            # First-ever run — pull everything, then record the max.
            return sql, params
        sql += f" WHERE {spec.watermark_column} > :wm"
        params["wm"] = spec.watermark_before
    return sql, params


def _predicate_for_count(spec: JobSpec) -> str | None:
    """Return the WHERE-clause body (or None) the count step should apply."""
    if spec.strategy != "watermark_delta" or spec.watermark_before is None:
        return None
    return f"{spec.watermark_column} > :wm"


# ── Public entry point ──────────────────────────────────────────────────


def execute_run(
    spec: JobSpec,
    run_id: int,
    target_dsn: str,
    state: RunStateSink,
    *,
    cancel_check: Callable[[], bool] = lambda: False,
) -> RunResult:
    """Run one job end-to-end. Returns the final result.

    On failure, the relevant step is marked `failed`, the run is marked
    `failed`, the error is appended to `run_errors`, and the function
    returns normally (it does not re-raise). Callers should not assume
    success from a non-exception return; check `result.status`.
    """
    # Bind run_id to structlog's contextvars so every log line emitted
    # while this run executes carries it. The log tap publishes them onto
    # the bus / ring buffer for /api/runs/:id/log to stream.
    import structlog

    structlog.contextvars.bind_contextvars(run_id=run_id, job_code=spec.code)
    log.info("run.start", run_id=run_id, job_code=spec.code)
    state.on_run_start(run_id)

    rows_loaded = 0
    error_count = 0
    source_count = 0
    target_count = 0
    watermark_after: str | None = None
    failure: tuple[StepName, str, str] | None = None  # (step, code, message)

    src_conn: Any = None
    sink_conn: Any = None

    try:
        # ── 1. connect ────────────────────────────────────────────────
        state.on_step_start(run_id, 1, "connect")
        ep = sources.oracle.OracleEndpoint(
            host=spec.source_host,
            port=spec.source_port,
            sid=spec.source_sid,
            service_name=spec.source_service_name,
            user=spec.source_user,
            password=spec.source_password,
            tls_required=spec.source_tls_required,
        )
        # Manage the source connection by hand so the load step can keep
        # cycling through the cursor across iterations.
        oracle_cm = sources.oracle.connect(ep)
        src_conn = oracle_cm.__enter__()
        sink_conn = sinks.sqlserver.open_connection(target_dsn)
        state.on_step_finish(run_id, 1, "connect", "succeeded", "session established")

        # ── 2. count ─────────────────────────────────────────────────
        if cancel_check():
            raise _Cancelled()
        state.on_step_start(run_id, 2, "count")
        source_count = sources.oracle.count_rows(
            src_conn, spec.source_object, _predicate_for_count(spec)
        )
        state.on_step_finish(
            run_id, 2, "count", "succeeded", f"source rowcount = {source_count:,}"
        )

        # ── 3 + 4. extract + load (interleaved) ──────────────────────
        if spec.strategy in ("full_snapshot", "truncate_and_load"):
            sinks.sqlserver.truncate(sink_conn, spec.target_schema, spec.target_table)

        state.on_step_start(run_id, 3, "extract")
        state.on_step_start(run_id, 4, "load")
        sql, params = _build_extraction_sql(spec)
        columns_lower: list[str] = []
        for columns, rows in sources.oracle.fetch_batches(
            src_conn, sql, params, spec.batch_size
        ):
            if cancel_check():
                raise _Cancelled()
            if not columns_lower:
                columns_lower = [c.lower() for c in columns]
            written = sinks.sqlserver.bulk_insert(
                sink_conn,
                spec.target_schema,
                spec.target_table,
                columns_lower,
                rows,
                run_id=run_id,
            )
            rows_loaded += written
            pct = min(100, int(rows_loaded / source_count * 100)) if source_count > 0 else 100
            state.on_step_progress(run_id, 3, pct, rows_loaded, None)
            state.on_step_progress(run_id, 4, pct, rows_loaded, None)
            # Track the max watermark seen during this run for watermark_delta.
            if spec.strategy == "watermark_delta" and spec.watermark_column:
                idx = _column_index(columns_lower, spec.watermark_column)
                if idx is not None:
                    for r in rows:
                        v = r[idx]
                        if v is None:
                            continue
                        s = v.isoformat() if hasattr(v, "isoformat") else str(v)
                        if watermark_after is None or s > watermark_after:
                            watermark_after = s
        sinks.sqlserver.commit(sink_conn)
        state.on_step_finish(run_id, 3, "extract", "succeeded", f"{rows_loaded:,} rows fetched")
        state.on_step_finish(run_id, 4, "load", "succeeded", f"{rows_loaded:,} rows loaded")

        # ── 5. recon ─────────────────────────────────────────────────
        if cancel_check():
            raise _Cancelled()
        state.on_step_start(run_id, 5, "recon")
        run_scope = run_id if spec.strategy in ("append", "watermark_delta") else None
        target_count = sinks.sqlserver.target_count(
            sink_conn, spec.target_schema, spec.target_table, run_scope
        )
        # MVP: count check only. Hash buckets are a follow-up — they need
        # canonical column ordering between Oracle and SQL Server and a
        # cheap server-side hash function (HASHBYTES('MD5', …)).
        state.record_recon(
            run_id, spec.job_id, source_count, target_count,
            checksum_match=(source_count == target_count),
            threshold_pct=0.0005,
        )
        msg = (
            f"source={source_count:,} target={target_count:,} "
            f"variance={source_count - target_count}"
        )
        state.on_step_finish(run_id, 5, "recon", "succeeded", msg)

        # ── 6. finalize ──────────────────────────────────────────────
        state.on_step_start(run_id, 6, "finalize")
        if spec.strategy == "watermark_delta" and watermark_after:
            # Persistence layer is responsible for writing back via the
            # state sink — the engine just hands it the value.
            state.on_step_progress(run_id, 6, 100, 0, f"watermark → {watermark_after}")
        state.on_step_finish(run_id, 6, "finalize", "succeeded", None)

    except _Cancelled:
        failure = ("connect", "LB-CANCELLED", "run cancelled by operator")
        log.warning("run.cancelled", run_id=run_id)
    except Exception as exc:
        # Best-effort step inference based on which conn is set.
        step: StepName = "connect" if sink_conn is None else "extract"
        code = type(exc).__name__
        # python-oracledb DatabaseError formats with leading "ORA-…"
        msg = str(exc).splitlines()[0][:1800] if str(exc) else type(exc).__name__
        if "ORA-" in msg:
            code = msg.split(":")[0].strip()
        elif "fast_executemany" in msg or "OperationalError" in code:
            code = "LB-LOAD-FAIL"
        else:
            code = "LB-RUNTIME"
        state.on_error(
            run_id,
            "error",
            code,
            step,
            msg,
            None,
            None,
        )
        error_count += 1
        failure = (step, code, msg)
        log.exception("run.failed", run_id=run_id, step=step, code=code)

    finally:
        if src_conn is not None:
            with contextlib.suppress(Exception):
                src_conn.close()
        if sink_conn is not None:
            with contextlib.suppress(Exception):
                sink_conn.close()

    status: str
    if failure is not None:
        status = "cancelled" if failure[1] == "LB-CANCELLED" else "failed"
    else:
        status = "succeeded"
    state.on_run_finish(run_id, status, watermark_after)
    log.info("run.finish", run_id=run_id, status=status, rows=rows_loaded)
    structlog.contextvars.unbind_contextvars("run_id", "job_code")
    return RunResult(
        run_id=run_id,
        status=status,
        rows_loaded=rows_loaded,
        error_count=error_count,
        source_count=source_count,
        target_count=target_count,
        watermark_after=watermark_after,
    )


def _column_index(columns_lower: list[str], wm_col: str) -> int | None:
    needle = wm_col.lower()
    for i, c in enumerate(columns_lower):
        if c == needle:
            return i
    return None


class _Cancelled(Exception):
    """Raised internally when a cancel_check() returns True."""


# ── Convenience for tests / callers that don't want to assemble UTC time ─


def utcnow() -> datetime:
    return datetime.now(UTC)


def perf_now() -> float:
    return time.monotonic()
