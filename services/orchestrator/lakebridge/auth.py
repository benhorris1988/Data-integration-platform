"""Authentication and authorization.

Three modes, selected by `settings.auth_mode`:

- `oidc` (production): the UI redirects the operator to Okta; Okta calls back
  with an authorization code; we exchange it for tokens, verify the ID token
  signature against the discovery JWKS, look the user up in
  `lakebridge.users` (must already exist — provisioning is out-of-band), and
  mint our own short-lived session cookie. Every subsequent request reads
  the user from the cookie. The Okta access token is *not* used after the
  initial verification — we trust our own cookie.

- `dev`: the same session cookie is used, but it can also be minted by a
  dev-only endpoint that takes an email and stamps the cookie without any
  external IdP. Off-limits in production.

- `disabled`: every request is treated as an anonymous Admin. Use this only
  for unit-test smoke runs or local prodding from curl. Never deploy with
  this on.

The session cookie itself is signed with `session_secret` via Starlette's
SessionMiddleware. Cookies are `httponly`, `samesite=lax`, and `secure`
when the request comes in over HTTPS. CSRF is mitigated by SameSite=lax;
production deployers should add an explicit double-submit token if they
front this with a third-party proxy that strips the Origin header.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request, status

from . import db
from .config import get_settings
from .models import Role


@dataclass(frozen=True)
class User:
    id: int
    email: str
    name: str
    role: Role
    sso_subject: str

    @property
    def is_admin(self) -> bool:
        return self.role == "Admin"

    @property
    def can_write(self) -> bool:
        # Anyone except Read-only can mutate.
        return self.role in ("Admin", "Operator")


# A built-in Admin used when auth_mode == "disabled". Never persisted.
_DISABLED_ADMIN = User(
    id=0,
    email="anonymous@lakebridge.local",
    name="(auth disabled)",
    role="Admin",
    sso_subject="local|anonymous",
)


def load_user_by_email(email: str) -> User | None:
    row = db.fetch_one(
        "SELECT id, sso_subject, email, name, role, disabled "
        "FROM lakebridge.users WHERE email = ?",
        (email,),
    )
    if row is None or row.get("disabled"):
        return None
    return User(
        id=int(row["id"]),
        sso_subject=str(row["sso_subject"]),
        email=str(row["email"]),
        name=str(row["name"]),
        role=row["role"],
    )


def load_user_by_subject(sso_subject: str) -> User | None:
    row = db.fetch_one(
        "SELECT id, sso_subject, email, name, role, disabled "
        "FROM lakebridge.users WHERE sso_subject = ?",
        (sso_subject,),
    )
    if row is None or row.get("disabled"):
        return None
    return User(
        id=int(row["id"]),
        sso_subject=str(row["sso_subject"]),
        email=str(row["email"]),
        name=str(row["name"]),
        role=row["role"],
    )


def issue_session(request: Request, user: User) -> None:
    """Stamp the session cookie. Side-effects only; mutates request.session."""
    request.session["uid"] = user.id
    request.session["sub"] = user.sso_subject
    request.session["role"] = user.role
    # Refresh last_active in the background — best-effort, swallow errors
    # so a transient DB hiccup never breaks a fresh login.
    with contextlib.suppress(Exception):  # pragma: no cover
        db.execute(
            "UPDATE lakebridge.users SET last_active_at = SYSUTCDATETIME() WHERE id = ?",
            (user.id,),
        )


def clear_session(request: Request) -> None:
    request.session.clear()


def current_user(request: Request) -> User:
    """FastAPI dependency: returns the signed-in operator or raises 401.

    Apply with `user: User = Depends(current_user)`. For role gating use
    `require_role(...)` instead.
    """
    settings = get_settings()
    if settings.auth_mode == "disabled":
        return _DISABLED_ADMIN

    session: dict[str, Any] = request.session
    sub = session.get("sub")
    if not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not signed in")
    user = load_user_by_subject(sub)
    if user is None:
        # The cookie referenced a user that has been removed or disabled —
        # treat as expired and force a fresh sign-in.
        clear_session(request)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session no longer valid")
    return user


# ── Role gates ──────────────────────────────────────────────────────────


def require_role(*roles: Role):
    """Return a dependency that allows only the listed roles."""

    def dep(user: Annotated[User, Depends(current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"requires one of: {', '.join(roles)} (you are {user.role})",
            )
        return user

    return dep


# Common gates — shortcuts the routers use.
RequireOperator = require_role("Admin", "Operator")
RequireAdmin = require_role("Admin")


# ── Audit log helper ────────────────────────────────────────────────────


def audit(
    user: User,
    action: str,
    target: str,
    metadata: dict[str, Any] | None = None,
    request_id: str | None = None,
) -> None:
    """Write an entry into lakebridge.audit_log. Swallows DB errors and logs
    them — auditing must never break the user-facing action."""
    try:
        from json import dumps

        db.execute(
            "INSERT INTO lakebridge.audit_log (actor, action, target, metadata_json, request_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (
                user.email,
                action,
                target,
                dumps(metadata, default=str) if metadata else None,
                request_id,
            ),
        )
    except Exception:  # pragma: no cover — audit must not fail the request
        from .logging import get_logger

        get_logger("lakebridge.audit").exception(
            "audit.write_failed", action=action, target=target
        )
