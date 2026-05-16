"""Default RunStateSink — writes engine callbacks into the lakebridge schema.

Each call opens (and commits) its own transaction so a partial run is still
inspectable from the API while it's in flight. Volume is low enough that
the extra round-trips are not a concern.
"""

from __future__ import annotations

import json
from typing import Any

from .. import db
from ..logging import get_logger
from ..models import StepName

log = get_logger("lakebridge.persistence")


class SqlServerRunStateSink:
    """Persists engine callbacks into `lakebridge.runs` / `run_steps` / `run_errors`."""

    def __init__(self, broadcast: Any | None = None) -> None:
        # `broadcast` is an optional callable that takes (event_type, payload)
        # and is invoked after each successful DB write so the SSE endpoint
        # can push the same update to listening UI clients.
        self._broadcast = broadcast

    def _emit(self, event: str, payload: dict[str, Any]) -> None:
        if self._broadcast is None:
            return
        try:
            self._broadcast(event, payload)
        except Exception:  # pragma: no cover — defensive
            log.exception("persistence.broadcast.failed", event=event)

    def on_run_start(self, run_id: int) -> None:
        db.execute(
            "UPDATE lakebridge.runs "
            "SET status = ?, started_at = SYSUTCDATETIME() "
            "WHERE id = ?",
            ("running", run_id),
        )
        # Pre-create step rows so the UI's six-node timeline can render
        # immediately, even before the first step finishes.
        steps: list[tuple[StepName, int]] = [
            ("connect", 1), ("count", 2), ("extract", 3),
            ("load", 4), ("recon", 5), ("finalize", 6),
        ]
        for name, n in steps:
            db.execute(
                "INSERT INTO lakebridge.run_steps "
                "(run_id, step_no, step_name, status) "
                "VALUES (?, ?, ?, ?)",
                (run_id, n, name, "pending"),
            )
        self._emit("run.started", {"run_id": run_id})

    def on_run_finish(
        self, run_id: int, status: str, watermark_after: str | None
    ) -> None:
        db.execute(
            "UPDATE lakebridge.runs "
            "SET status = ?, finished_at = SYSUTCDATETIME(), watermark_after = ? "
            "WHERE id = ?",
            (status, watermark_after, run_id),
        )
        if status == "succeeded" and watermark_after is not None:
            # Bump the watermark atomically with the run finalisation.
            db.execute(
                """
                MERGE lakebridge.watermarks AS t
                USING (SELECT r.job_id, j.watermark_column FROM lakebridge.runs r
                       JOIN lakebridge.jobs j ON j.id = r.job_id WHERE r.id = ?) AS s
                  ON t.job_id = s.job_id
                WHEN MATCHED THEN
                    UPDATE SET watermark_value = ?, advanced_by_run_id = ?,
                               advanced_at = SYSUTCDATETIME()
                WHEN NOT MATCHED THEN
                    INSERT (job_id, watermark_column, watermark_value,
                            advanced_by_run_id, advanced_at)
                    VALUES (s.job_id, s.watermark_column, ?, ?, SYSUTCDATETIME());
                """,
                (run_id, watermark_after, run_id, watermark_after, run_id),
            )
        self._emit("run.finished", {"run_id": run_id, "status": status})

    def on_step_start(self, run_id: int, step_no: int, step_name: StepName) -> None:
        db.execute(
            "UPDATE lakebridge.run_steps "
            "SET status = ?, started_at = SYSUTCDATETIME() "
            "WHERE run_id = ? AND step_no = ?",
            ("running", run_id, step_no),
        )
        self._emit("step.started", {"run_id": run_id, "step_no": step_no, "step_name": step_name})

    def on_step_progress(
        self,
        run_id: int,
        step_no: int,
        progress_pct: int,
        rows_processed: int,
        message: str | None,
    ) -> None:
        db.execute(
            "UPDATE lakebridge.run_steps "
            "SET progress_pct = ?, rows_processed = ?, message = ? "
            "WHERE run_id = ? AND step_no = ?",
            (progress_pct, rows_processed, message, run_id, step_no),
        )
        # Keep the run-level rows_loaded counter live for the dashboard.
        db.execute(
            "UPDATE lakebridge.runs SET rows_loaded = ? WHERE id = ?",
            (rows_processed, run_id),
        )
        self._emit(
            "step.progress",
            {
                "run_id": run_id,
                "step_no": step_no,
                "progress_pct": progress_pct,
                "rows_processed": rows_processed,
            },
        )

    def on_step_finish(
        self,
        run_id: int,
        step_no: int,
        step_name: StepName,
        status: str,
        message: str | None,
    ) -> None:
        db.execute(
            "UPDATE lakebridge.run_steps "
            "SET status = ?, finished_at = SYSUTCDATETIME(), progress_pct = 100, message = COALESCE(?, message) "
            "WHERE run_id = ? AND step_no = ?",
            (status, message, run_id, step_no),
        )
        self._emit(
            "step.finished",
            {"run_id": run_id, "step_no": step_no, "step_name": step_name, "status": status},
        )

    def on_error(
        self,
        run_id: int,
        severity: str,
        code: str,
        step_name: StepName | None,
        message: str,
        source_pk: str | None,
        payload_json: str | None,
    ) -> None:
        db.execute(
            "INSERT INTO lakebridge.run_errors "
            "(run_id, severity, code, step_name, message, source_pk, payload_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (run_id, severity, code, step_name, message, source_pk, payload_json),
        )
        db.execute(
            "UPDATE lakebridge.runs SET error_count = error_count + 1 WHERE id = ?",
            (run_id,),
        )
        self._emit("run.error", {"run_id": run_id, "code": code, "severity": severity})

    def record_recon(
        self,
        run_id: int,
        job_id: int,
        source_count: int,
        target_count: int,
        checksum_match: bool,
        threshold_pct: float,
    ) -> None:
        variance = source_count - target_count
        result = "ok"
        if not checksum_match:
            # variance-only result; refine when hash buckets land
            if source_count == 0:
                result = "warn" if abs(variance) > 0 else "ok"
            else:
                pct = abs(variance) / source_count
                result = "fail" if pct > threshold_pct else "warn"
        db.execute(
            "INSERT INTO lakebridge.recon_checks "
            "(run_id, job_id, source_count, target_count, checksum_match, result, threshold_pct) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (run_id, job_id, source_count, target_count, checksum_match, result, threshold_pct),
        )

    @staticmethod
    def encode_payload(value: object) -> str:
        return json.dumps(value, default=str, ensure_ascii=False)
