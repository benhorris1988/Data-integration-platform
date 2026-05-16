"""Scheduler — drives both cron-based runs and the queue worker.

Two cooperating concerns live here:

1. **Cron loop** — re-reads `lakebridge.jobs` on every tick and queues a
   new run for any enabled job whose cron predicate fires this minute and
   doesn't already have a queued/running run.
2. **Queue worker** — polls `lakebridge.runs` for `queued` rows, claims
   them with an UPDATE, and dispatches to the engine on a thread pool.
   Concurrency is bounded by `settings.runner_concurrency`.

There is no Celery / Redis here. The audience is small and the deployment
is a single instance; the database is the queue. If that ever changes,
swap this module for a Celery worker without touching the engine.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

from croniter import croniter

from . import db
from .config import Settings, get_settings
from .events import bus
from .logging import get_logger
from .runner.engine import JobSpec, execute_run
from .runner.persistence import SqlServerRunStateSink

log = get_logger("lakebridge.scheduler")


class Scheduler:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._pool = ThreadPoolExecutor(
            max_workers=self._settings.runner_concurrency,
            thread_name_prefix="lakebridge-runner",
        )
        self._stop = threading.Event()
        self._cron_thread: threading.Thread | None = None
        self._worker_thread: threading.Thread | None = None
        self._inflight: dict[int, Future[Any]] = {}
        self._last_cron_minute: tuple[int, int, int, int, int] | None = None

    # ── Lifecycle ────────────────────────────────────────────────────

    def start(self) -> None:
        if self._cron_thread is not None:
            return
        log.info(
            "scheduler.start",
            tick_sec=self._settings.scheduler_tick_sec,
            concurrency=self._settings.runner_concurrency,
        )
        self._cron_thread = threading.Thread(
            target=self._cron_loop, daemon=True, name="lakebridge-cron"
        )
        self._worker_thread = threading.Thread(
            target=self._worker_loop, daemon=True, name="lakebridge-worker"
        )
        self._cron_thread.start()
        self._worker_thread.start()

    def stop(self, *, drain_sec: float = 5.0) -> None:
        log.info("scheduler.stop")
        self._stop.set()
        self._pool.shutdown(wait=True, cancel_futures=False)
        for t in (self._cron_thread, self._worker_thread):
            if t is not None:
                t.join(timeout=drain_sec)
        self._cron_thread = None
        self._worker_thread = None

    # ── Cron loop ────────────────────────────────────────────────────

    def _cron_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._enqueue_due_jobs()
            except Exception:
                log.exception("scheduler.cron.error")
            self._stop.wait(timeout=self._settings.scheduler_tick_sec)

    def _enqueue_due_jobs(self) -> None:
        now = datetime.now(UTC).replace(second=0, microsecond=0)
        minute_key = (now.year, now.month, now.day, now.hour, now.minute)
        if self._last_cron_minute == minute_key:
            return  # already processed this minute
        self._last_cron_minute = minute_key

        candidates = db.fetch_all(
            "SELECT id, schedule FROM lakebridge.jobs "
            "WHERE enabled = 1 AND schedule <> N'manual'"
        )
        for j in candidates:
            schedule = j["schedule"]
            if not _cron_fires_at(schedule, now):
                continue
            if _already_queued_or_running(int(j["id"])):
                continue
            run_id = _insert_queued_run(int(j["id"]), triggered_by="scheduler")
            log.info(
                "scheduler.queued",
                job_id=int(j["id"]),
                run_id=run_id,
                schedule=schedule,
            )

    # ── Worker loop ─────────────────────────────────────────────────

    def _worker_loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._claim_and_dispatch()
            except Exception:
                log.exception("scheduler.worker.error")
            self._stop.wait(timeout=self._settings.scheduler_tick_sec)

    def _claim_and_dispatch(self) -> None:
        # Don't overrun the pool — claim at most as many runs as we have
        # free workers.
        free_slots = self._settings.runner_concurrency - len(
            [f for f in self._inflight.values() if not f.done()]
        )
        if free_slots <= 0:
            return

        runs = _claim_queued_runs(free_slots, claimer=_claimer_id())
        for run in runs:
            spec = _build_job_spec(run)
            if spec is None:
                _mark_failed(int(run["id"]), "LB-CONFIG", "missing source or credentials")
                continue
            fut = self._pool.submit(self._dispatch_one, spec, int(run["id"]))
            self._inflight[int(run["id"])] = fut
            fut.add_done_callback(lambda _f, rid=int(run["id"]): self._inflight.pop(rid, None))

    def _dispatch_one(self, spec: JobSpec, run_id: int) -> None:
        sink = SqlServerRunStateSink(broadcast=bus().publish)

        def cancel_check() -> bool:
            row = db.fetch_one(
                "SELECT cancel_requested FROM lakebridge.runs WHERE id = ?", (run_id,)
            )
            return bool(row and row.get("cancel_requested"))

        execute_run(
            spec=spec,
            run_id=run_id,
            target_dsn=self._settings.odbc_connection_string(),
            state=sink,
            cancel_check=cancel_check,
        )


# ── Helpers ──────────────────────────────────────────────────────────


def _cron_fires_at(expr: str, when: datetime) -> bool:
    """True iff `when` (rounded to the minute) matches `expr`."""
    try:
        return bool(croniter.match(expr, when.replace(second=0, microsecond=0)))
    except (ValueError, KeyError):
        return False


def _already_queued_or_running(job_id: int) -> bool:
    row = db.fetch_one(
        "SELECT COUNT(*) AS n FROM lakebridge.runs "
        "WHERE job_id = ? AND status IN (N'queued', N'running')",
        (job_id,),
    )
    return bool(row and (row.get("n") or 0) > 0)


def _insert_queued_run(job_id: int, triggered_by: str) -> int:
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO lakebridge.runs (job_id, status, triggered_by, run_mode) "
            "OUTPUT INSERTED.id VALUES (?, N'queued', ?, N'scheduled')",
            (job_id, triggered_by),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
    return new_id


def _claimer_id() -> str:
    return f"{os.uname().nodename}#{os.getpid()}"


def _claim_queued_runs(n: int, claimer: str) -> list[dict[str, Any]]:
    """Atomic UPDATE … WITH (ROWLOCK, READPAST) — picks up to `n` queued
    runs without blocking. Multiple orchestrator processes can run safely."""
    sql = (
        "UPDATE TOP (?) lakebridge.runs WITH (ROWLOCK, READPAST) "
        "SET status = N'running', started_at = SYSUTCDATETIME(), triggered_by = COALESCE(triggered_by, ?) "
        "OUTPUT inserted.id "
        "WHERE status = N'queued'"
    )
    # We can't return all columns from OUTPUT in this UPDATE while still
    # safely doing READPAST in a single statement, so claim the ids and
    # then re-fetch the spec rows.
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, (n, claimer))
        claimed_ids = [int(r[0]) for r in cur.fetchall()]
        conn.commit()
    if not claimed_ids:
        return []
    placeholders = ", ".join("?" for _ in claimed_ids)
    return db.fetch_all(
        "SELECT id, job_id, triggered_by, run_mode, backfill_from, backfill_to "
        f"FROM lakebridge.runs WHERE id IN ({placeholders})",
        tuple(claimed_ids),
    )


def _build_job_spec(run: dict[str, Any]) -> JobSpec | None:
    """Read job + source rows, resolve the password, return a JobSpec."""
    j = db.fetch_one(
        "SELECT j.id, j.code, j.strategy, j.source_id, j.source_object, j.source_query, "
        "       j.target_schema, j.target_table, j.batch_size, j.watermark_column, "
        "       s.host, s.port, s.sid, s.service_name, s.username, s.secret_ref, s.tls_required, "
        "       w.watermark_value AS watermark_before "
        "FROM lakebridge.jobs j "
        "JOIN lakebridge.sources s ON s.id = j.source_id "
        "LEFT JOIN lakebridge.watermarks w ON w.job_id = j.id "
        "WHERE j.id = ?",
        (int(run["job_id"]),),
    )
    if j is None:
        return None

    env_key = "LAKEBRIDGE_SECRET_" + j["secret_ref"].upper().replace("/", "_").replace("-", "_")
    password = os.environ.get(env_key)
    if password is None:
        log.error(
            "scheduler.spec.no_secret",
            job_id=int(j["id"]),
            secret_ref=j["secret_ref"],
            env_key=env_key,
        )
        return None

    return JobSpec(
        job_id=int(j["id"]),
        code=str(j["code"]),
        strategy=str(j["strategy"]),
        source_object=str(j["source_object"]),
        source_query=j["source_query"],
        target_schema=str(j["target_schema"]),
        target_table=str(j["target_table"]),
        batch_size=int(j["batch_size"]),
        watermark_column=j["watermark_column"],
        watermark_before=j["watermark_before"],
        backfill_from=run.get("backfill_from"),
        backfill_to=run.get("backfill_to"),
        source_host=str(j["host"]),
        source_port=int(j["port"]),
        source_sid=j["sid"],
        source_service_name=j["service_name"],
        source_user=str(j["username"]),
        source_password=password,
        source_tls_required=bool(j["tls_required"]),
    )


def _mark_failed(run_id: int, code: str, message: str) -> None:
    db.execute(
        "UPDATE lakebridge.runs SET status = N'failed', finished_at = SYSUTCDATETIME() "
        "WHERE id = ?",
        (run_id,),
    )
    db.execute(
        "INSERT INTO lakebridge.run_errors (run_id, severity, code, step_name, message) "
        "VALUES (?, N'error', ?, NULL, ?)",
        (run_id, code, message),
    )


# ── Module-level singleton ──────────────────────────────────────────


_scheduler: Scheduler | None = None


def start_global_scheduler() -> Scheduler:
    global _scheduler
    if _scheduler is None:
        _scheduler = Scheduler()
        _scheduler.start()
    return _scheduler


def stop_global_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.stop()
        _scheduler = None


def get_scheduler() -> Scheduler | None:
    return _scheduler


# ── Cron predicate is reusable for the API (e.g. "next fires at …") ─


def next_fire(expr: str, after: datetime | None = None) -> datetime | None:
    """Return the next firing time, or None if `expr` isn't valid cron."""
    try:
        it = croniter(expr, after or datetime.now(UTC))
        return it.get_next(datetime)  # type: ignore[no-any-return]
    except (ValueError, KeyError):
        return None
