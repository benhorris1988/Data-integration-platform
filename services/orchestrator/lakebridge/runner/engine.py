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
import json
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
    # Backfill window (only set when the run was queued as run_mode='backfill').
    # When set, the runner uses these as the WHERE bounds on the source
    # query and does NOT advance the live watermark on success.
    backfill_from: str | None = None
    backfill_to: str | None = None
    # Source connection
    source_host: str = ""
    source_port: int = 1521
    source_sid: str | None = None
    source_service_name: str | None = None
    source_user: str = ""
    source_password: str = ""
    source_tls_required: bool = True


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
    def record_recon_buckets(
        self,
        run_id: int,
        buckets: list[dict[str, Any]],
    ) -> None: ...


# ── Watermark-delta helpers ──────────────────────────────────────────────


def _is_backfill(spec: JobSpec) -> bool:
    return bool(spec.backfill_from and spec.backfill_to)


def _build_extraction_sql(spec: JobSpec) -> tuple[str, dict[str, Any]]:
    """Compose the SELECT the runner sends to Oracle, plus bound params."""
    params: dict[str, Any] = {}

    # Backfill takes precedence over the normal watermark predicate. The
    # bounds are `(from, to]` — inclusive of `from`, exclusive of `to` —
    # so successive non-overlapping backfills never re-emit the same row.
    if _is_backfill(spec):
        if not spec.watermark_column:
            raise ValueError(
                f"job {spec.code} backfill requires watermark_column"
            )
        sql = (
            f"SELECT * FROM {spec.source_object} "
            f"WHERE {spec.watermark_column} >= :wm_from AND {spec.watermark_column} < :wm_to"
        )
        params["wm_from"] = spec.backfill_from
        params["wm_to"] = spec.backfill_to
        return sql, params

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
    if _is_backfill(spec):
        return f"{spec.watermark_column} >= :wm_from AND {spec.watermark_column} < :wm_to"
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
    # Source-side row hashes, kept in memory and bucketed at recon time.
    # Same MD5 the load step writes to lb_source_hash, so the comparison is
    # over an apples-to-apples fingerprint.
    _source_row_hashes: list[str] = []

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
        count_predicate = _predicate_for_count(spec)
        count_binds: dict[str, Any] = {}
        if _is_backfill(spec):
            count_binds = {"wm_from": spec.backfill_from, "wm_to": spec.backfill_to}
        elif (
            spec.strategy == "watermark_delta"
            and spec.watermark_before is not None
        ):
            count_binds = {"wm": spec.watermark_before}
        source_count = sources.oracle.count_rows(
            src_conn, spec.source_object, count_predicate, count_binds
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
            # Compute and stash the source row hashes for recon. The same
            # bytes go into lb_source_hash during bulk_insert, so source
            # and target buckets are over identical fingerprints.
            for r in rows:
                _source_row_hashes.append(sinks.sqlserver.row_hash(r))
            written, quarantined = sinks.sqlserver.bulk_insert(
                sink_conn,
                spec.target_schema,
                spec.target_table,
                columns_lower,
                rows,
                run_id=run_id,
            )
            rows_loaded += written
            for raw_row, reason in quarantined:
                # The row's values are the source-order tuple — the
                # operator-visible columns plus the watermark. Carry the
                # raw row in the payload so the analyst can replay it.
                state.on_error(
                    run_id,
                    "warn",
                    "LB-QUARANTINE",
                    "load",
                    reason,
                    None,
                    json.dumps(
                        {"columns": columns_lower, "row": list(raw_row)},
                        default=str,
                        ensure_ascii=False,
                    ),
                )
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
        # Hash-bucket reconciliation. Both sides are bucketed by the first
        # byte of the row's MD5 (the `lb_source_hash` we wrote at load):
        # 00-3F, 40-7F, 80-BF, C0-FF. Per-bucket fingerprint is the XOR of
        # all hash bytes in the bucket — order-independent and
        # collision-resistant for any practical N. A mismatched bucket
        # tells the operator where to look without scanning the whole
        # table.
        source_buckets = _bucket_fingerprints(_source_row_hashes)
        target_buckets = _read_target_hash_buckets(
            sink_conn, spec.target_schema, spec.target_table, run_scope
        )
        bucket_results = _compare_buckets(source_buckets, target_buckets)
        all_match = all(b["matched"] for b in bucket_results)
        state.record_recon(
            run_id, spec.job_id, source_count, target_count,
            checksum_match=(source_count == target_count and all_match),
            threshold_pct=0.0005,
        )
        state.record_recon_buckets(run_id, bucket_results)
        drift_buckets = [b["bucket"] for b in bucket_results if not b["matched"]]
        msg = (
            f"source={source_count:,} target={target_count:,} "
            f"variance={source_count - target_count}"
            + (f" · drift in {','.join(drift_buckets)}" if drift_buckets else "")
        )
        state.on_step_finish(run_id, 5, "recon", "succeeded", msg)

        # ── 6. finalize ──────────────────────────────────────────────
        state.on_step_start(run_id, 6, "finalize")
        if _is_backfill(spec):
            # Backfill runs deliberately don't advance the watermark — they
            # replay an out-of-band window. Surface the bounds in the step
            # message for the operator's audit trail.
            watermark_after = None  # ensure on_run_finish doesn't bump
            state.on_step_progress(
                run_id, 6, 100, 0,
                f"backfill {spec.backfill_from} → {spec.backfill_to} (watermark untouched)",
            )
        elif spec.strategy == "watermark_delta" and watermark_after:
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


# ── Recon hash buckets ──────────────────────────────────────────────────


_BUCKETS: tuple[tuple[str, int, int], ...] = (
    ("00-3F", 0x00, 0x3F),
    ("40-7F", 0x40, 0x7F),
    ("80-BF", 0x80, 0xBF),
    ("C0-FF", 0xC0, 0xFF),
)


def _bucket_for(first_byte: int) -> str:
    for name, lo, hi in _BUCKETS:
        if lo <= first_byte <= hi:
            return name
    return "C0-FF"  # unreachable; bytes are 0..255


def _bucket_fingerprints(hashes: list[str]) -> dict[str, dict[str, Any]]:
    """Group hex-MD5 strings into the four buckets and produce a per-bucket
    (count, xor-fingerprint) summary."""
    init: dict[str, dict[str, Any]] = {
        name: {"count": 0, "xor": bytearray(16)} for name, _, _ in _BUCKETS
    }
    for h in hashes:
        digest = bytes.fromhex(h)
        bucket = _bucket_for(digest[0])
        cell = init[bucket]
        cell["count"] = int(cell["count"]) + 1
        xb: bytearray = cell["xor"]
        for i in range(16):
            xb[i] ^= digest[i]
    return {name: {"count": v["count"], "xor": bytes(v["xor"]).hex()} for name, v in init.items()}


def _read_target_hash_buckets(
    sink_conn: Any, schema: str, table: str, run_id: int | None
) -> dict[str, dict[str, Any]]:
    """Stream `lb_source_hash` from the target and bucket it the same way
    as the source. Same Python helper for byte-identical comparison."""
    sql = f"SELECT lb_source_hash FROM [{schema}].[{table}]"
    params: tuple[Any, ...] = ()
    if run_id is not None:
        sql += " WHERE lb_run_id = ?"
        params = (run_id,)
    hashes: list[str] = []
    with sink_conn.cursor() as cur:
        cur.execute(sql, params)
        for row in cur.fetchall():
            if row[0]:
                hashes.append(str(row[0]))
    return _bucket_fingerprints(hashes)


def _compare_buckets(
    source: dict[str, dict[str, Any]],
    target: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Produce the per-bucket comparison rows the persistence layer writes
    into `lakebridge.recon_hash_buckets`."""
    out: list[dict[str, Any]] = []
    for name, _, _ in _BUCKETS:
        s = source.get(name, {"count": 0, "xor": "00" * 16})
        t = target.get(name, {"count": 0, "xor": "00" * 16})
        # MD5 is 16 bytes / 32 hex chars; recon_hash_buckets.source_hash is
        # CHAR(32). The XOR fingerprint is the right shape.
        out.append(
            {
                "bucket": name,
                "source_count": s["count"],
                "target_count": t["count"],
                "source_hash": s["xor"],
                "target_hash": t["xor"],
                "matched": s["count"] == t["count"] and s["xor"] == t["xor"],
            }
        )
    return out


# ── Convenience for tests / callers that don't want to assemble UTC time ─


def utcnow() -> datetime:
    return datetime.now(UTC)


def perf_now() -> float:
    return time.monotonic()
