"""/api/runs — detail, errors, recon, SSE.

`enqueue_run` is the public hand-off from the API to the runner. It writes
a `queued` row to `lakebridge.runs` and returns the new run id; the
scheduler thread picks it up on the next tick.
"""

from __future__ import annotations

import asyncio
import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sse_starlette.sse import EventSourceResponse

from .. import auth, db
from ..events import bus
from ..models import Run, RunError, RunStep

router = APIRouter(prefix="/api/runs", tags=["runs"])


def enqueue_run(job_id: int, triggered_by: str, run_mode: str) -> int:
    """Insert a queued run and return its id."""
    with db.connection() as conn, conn.cursor() as cur:
        cur.execute(
            "INSERT INTO lakebridge.runs (job_id, status, triggered_by, run_mode) "
            "OUTPUT INSERTED.id VALUES (?, ?, ?, ?)",
            (job_id, "queued", triggered_by, run_mode),
        )
        new_id = int(cur.fetchone()[0])
        conn.commit()
    return new_id


@router.get("/{run_id}", response_model=Run)
def get_run(
    run_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> Run:
    row = db.fetch_one(
        "SELECT * FROM lakebridge.v_runs_with_job WHERE id = ?", (run_id,)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found")
    return Run.model_validate(row)


@router.get("/{run_id}/steps", response_model=list[RunStep])
def get_steps(
    run_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> list[RunStep]:
    rows = db.fetch_all(
        "SELECT run_id, step_no, step_name, status, started_at, finished_at, "
        "       duration_sec, progress_pct, rows_processed, message "
        "FROM lakebridge.run_steps WHERE run_id = ? ORDER BY step_no",
        (run_id,),
    )
    return [RunStep.model_validate(r) for r in rows]


@router.get("/{run_id}/errors", response_model=list[RunError])
def get_errors(
    run_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
    limit: int = 200,
) -> list[RunError]:
    rows = db.fetch_all(
        f"SELECT TOP {limit} id, run_id, severity, code, step_name, message, "
        "       source_pk, payload_json, captured_at "
        "FROM lakebridge.run_errors WHERE run_id = ? "
        "ORDER BY captured_at DESC",
        (run_id,),
    )
    return [RunError.model_validate(r) for r in rows]


@router.post("/{run_id}/cancel")
def cancel(
    run_id: int,
    user: Annotated[auth.User, Depends(auth.RequireOperator)],
) -> dict[str, bool]:
    row = db.fetch_one(
        "SELECT r.status, j.code AS job_code "
        "FROM lakebridge.runs r JOIN lakebridge.jobs j ON j.id = r.job_id "
        "WHERE r.id = ?",
        (run_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found")
    db.execute(
        "UPDATE lakebridge.runs SET cancel_requested = 1 "
        "WHERE id = ? AND status IN (N'queued', N'running')",
        (run_id,),
    )
    auth.audit(
        user,
        "run.cancel",
        str(row["job_code"]),
        {"run_id": run_id, "prior_status": row["status"]},
    )
    return {"cancel_requested": True}


@router.get("/{run_id}/events")
async def events(
    run_id: int,
    request: Request,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> EventSourceResponse:
    """Server-sent events for a single run. Filters the global event bus
    to events with payload['run_id'] == run_id."""

    async def stream():
        async with bus().subscribe() as q:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=15.0)
                except TimeoutError:
                    # Keep the connection alive through corporate proxies.
                    yield {"event": "ping", "data": "{}"}
                    continue
                if ev.payload.get("run_id") != run_id:
                    continue
                yield {"event": ev.type, "data": json.dumps(ev.payload)}

    return EventSourceResponse(stream())
