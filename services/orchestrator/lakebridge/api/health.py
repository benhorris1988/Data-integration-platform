"""/api/health — liveness + db connectivity check.

The UI's top bar reads this to show the "lakebridge-api · healthy" pill.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, status

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
def health() -> dict[str, Any]:
    """Returns 200 if the API process is alive. Cheap; no DB."""
    from .. import __version__

    return {"status": "ok", "version": __version__}


@router.get("/ready")
def ready() -> dict[str, Any]:
    """Returns 200 only if a SQL Server SELECT 1 round-trips. Used by k8s."""
    try:
        from .. import db

        with db.connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
    except Exception as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)[:200]) from exc
    return {"status": "ready"}
