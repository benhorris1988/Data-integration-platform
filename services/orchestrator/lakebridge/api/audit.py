"""/api/audit — paged audit log."""

from __future__ import annotations

from fastapi import APIRouter, Query

from .. import db
from ..models import AuditEntry

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("", response_model=list[AuditEntry])
def list_audit(
    actor: str | None = None,
    action: str | None = None,
    limit: int = Query(default=200, le=1000),
) -> list[AuditEntry]:
    where: list[str] = []
    params: list[object] = []
    if actor:
        where.append("actor = ?")
        params.append(actor)
    if action:
        where.append("action = ?")
        params.append(action)
    sql = (
        f"SELECT TOP {limit} id, ts, actor, action, target, metadata_json, request_id "
        "FROM lakebridge.audit_log"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY ts DESC"
    )
    rows = db.fetch_all(sql, tuple(params))
    return [AuditEntry.model_validate(r) for r in rows]
