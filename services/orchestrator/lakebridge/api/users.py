"""/api/users — for the Settings/Users tab."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from .. import auth, db
from ..models import User

router = APIRouter(prefix="/api/users", tags=["users"])


@router.get("", response_model=list[User])
def list_users(
    _: Annotated[auth.User, Depends(auth.RequireAdmin)],
) -> list[User]:
    rows = db.fetch_all(
        "SELECT id, sso_subject, email, name, role, mfa_enabled, disabled, last_active_at "
        "FROM lakebridge.users ORDER BY name"
    )
    return [User.model_validate(r) for r in rows]
