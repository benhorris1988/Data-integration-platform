"""/api/jobs — list, detail, trigger, enable/disable."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from .. import db
from ..models import Job, JobListItem, Run, RunTriggerRequest
from .runs import enqueue_run

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.get("", response_model=list[JobListItem])
def list_jobs(
    status_filter: list[str] | None = Query(default=None, alias="status"),
    schedule: str | None = None,
    source_id: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=500),
) -> list[JobListItem]:
    """Return jobs joined to their last run, optionally filtered. Mirrors
    the Jobs index filter bar."""
    where: list[str] = []
    params: list[Any] = []
    if status_filter:
        placeholders = ", ".join("?" for _ in status_filter)
        where.append(f"COALESCE(last_run_status, N'queued') IN ({placeholders})")
        params.extend(status_filter)
    if schedule == "manual":
        where.append("schedule = N'manual'")
    elif schedule == "scheduled":
        where.append("schedule <> N'manual'")
    if source_id:
        where.append("source_id = ?")
        params.append(source_id)
    if q:
        where.append("(code LIKE ? OR source_object LIKE ? OR target_table LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    sql = (
        f"SELECT TOP {limit} * FROM lakebridge.v_jobs_with_last_run"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY last_run_finished_at DESC"
    )
    rows = db.fetch_all(sql, tuple(params))
    return [JobListItem.model_validate(r) for r in rows]


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: int) -> Job:
    row = db.fetch_one(
        "SELECT id, code, source_id, source_object, target_schema, target_table, "
        "       strategy, schedule, watermark_column, batch_size, retries, timeout_sec, "
        "       owner, enabled, pinned "
        "FROM lakebridge.jobs WHERE id = ?",
        (job_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    return Job.model_validate(row)


@router.get("/{job_id}/runs", response_model=list[Run])
def list_job_runs(job_id: int, limit: int = Query(default=50, le=500)) -> list[Run]:
    """Run history for one job, newest first."""
    rows = db.fetch_all(
        f"SELECT TOP {limit} * FROM lakebridge.v_runs_with_job "
        "WHERE job_id = ? ORDER BY triggered_at DESC",
        (job_id,),
    )
    return [Run.model_validate(r) for r in rows]


@router.post("/{job_id}/run", status_code=status.HTTP_202_ACCEPTED)
def run_now(job_id: int, body: RunTriggerRequest) -> dict[str, int]:
    """Enqueue a run. The scheduler thread picks it up on the next tick."""
    job = db.fetch_one(
        "SELECT id, enabled FROM lakebridge.jobs WHERE id = ?", (job_id,)
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    if not job["enabled"] and body.run_mode != "backfill":
        raise HTTPException(status.HTTP_409_CONFLICT, "job is disabled")
    run_id = enqueue_run(job_id, body.triggered_by, body.run_mode)
    return {"run_id": run_id}


@router.post("/{job_id}/disable")
def disable(job_id: int) -> dict[str, bool]:
    db.execute(
        "UPDATE lakebridge.jobs SET enabled = 0, updated_at = SYSUTCDATETIME() "
        "WHERE id = ?",
        (job_id,),
    )
    return {"enabled": False}


@router.post("/{job_id}/enable")
def enable(job_id: int) -> dict[str, bool]:
    db.execute(
        "UPDATE lakebridge.jobs SET enabled = 1, updated_at = SYSUTCDATETIME() "
        "WHERE id = ?",
        (job_id,),
    )
    return {"enabled": True}
