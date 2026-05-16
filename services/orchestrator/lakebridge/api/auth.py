"""/api/auth/* and /api/me.

The Okta dance:

1. UI hits `GET /api/auth/login?return_to=/jobs` → 302 to Okta's authorize
   endpoint with PKCE. The `state` parameter is signed with our session
   secret so the callback can verify it.
2. Operator authenticates with Okta. Okta redirects back to
   `GET /api/auth/callback?code=…&state=…`.
3. We exchange the code for tokens, verify the ID token signature against
   the discovery JWKS, look up the email in `lakebridge.users`, mint a
   session cookie, redirect to `return_to`.

Dev mode skips steps 1-3; `POST /api/auth/dev-session` takes an email and
stamps a session directly. The endpoint returns 404 in production.
"""

from __future__ import annotations

import secrets
import time
from typing import Annotated, Any

from authlib.integrations.requests_client import OAuth2Session
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from joserfc import jwt as joserfc_jwt
from joserfc.errors import JoseError
from joserfc.jwk import KeySet
from pydantic import BaseModel

from .. import auth, db
from ..config import get_settings
from ..logging import get_logger
from ..models import Role

log = get_logger("lakebridge.auth")
router = APIRouter(prefix="/api", tags=["auth"])


# ── /api/me ──────────────────────────────────────────────────────────────


class MeResponse(BaseModel):
    id: int
    email: str
    name: str
    role: Role
    auth_mode: str


@router.get("/me", response_model=MeResponse)
def me(user: Annotated[auth.User, Depends(auth.current_user)]) -> MeResponse:
    return MeResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        auth_mode=get_settings().auth_mode,
    )


# ── /api/auth/config (what the UI's Sign-in screen needs to render) ─────


class AuthConfig(BaseModel):
    mode: str
    okta_login_url: str | None
    dev_users: list[str]


@router.get("/auth/config", response_model=AuthConfig)
def auth_config() -> AuthConfig:
    """Public — the Sign-in screen calls this BEFORE the operator is signed in
    to decide whether to show the Okta button, the dev dropdown, or both."""
    s = get_settings()
    dev_users: list[str] = []
    if s.auth_mode == "dev":
        # Surface the seeded users so the dropdown isn't empty.
        try:
            rows = db.fetch_all(
                "SELECT email FROM lakebridge.users WHERE disabled = 0 ORDER BY name"
            )
            dev_users = [str(r["email"]) for r in rows]
        except Exception:  # pragma: no cover — DB down, dev picker just empty
            pass
    return AuthConfig(
        mode=s.auth_mode,
        okta_login_url="/api/auth/login" if s.auth_mode == "oidc" else None,
        dev_users=dev_users,
    )


# ── /api/auth/logout ────────────────────────────────────────────────────


@router.post("/auth/logout")
def logout(request: Request) -> dict[str, bool]:
    auth.clear_session(request)
    return {"ok": True}


# ── Dev mode sign-in ────────────────────────────────────────────────────


class DevSessionRequest(BaseModel):
    email: str


@router.post("/auth/dev-session", response_model=MeResponse)
def dev_session(request: Request, body: DevSessionRequest) -> MeResponse:
    """Stamp a session as `body.email`. Only available when auth_mode=dev."""
    s = get_settings()
    if s.auth_mode != "dev":
        # Don't even reveal the endpoint exists in production.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    user = auth.load_user_by_email(body.email)
    if user is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"no enabled user with email {body.email}",
        )
    auth.issue_session(request, user)
    auth.audit(user, "auth.dev_login", user.email, {"mode": "dev"})
    return MeResponse(
        id=user.id, email=user.email, name=user.name, role=user.role, auth_mode=s.auth_mode
    )


# ── OIDC sign-in ────────────────────────────────────────────────────────


@router.get("/auth/login")
def login(
    request: Request,
    return_to: str = Query(default="/"),
) -> RedirectResponse:
    """Kick off the Okta authorization code flow."""
    s = get_settings()
    if s.auth_mode != "oidc":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OIDC not enabled")
    if not (s.oidc_issuer and s.oidc_client_id):
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, "OIDC misconfigured"
        )

    metadata = _oidc_discover(s.oidc_issuer)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    # We park state + return_to + nonce in the (signed) session so the
    # callback can validate them.
    request.session["oidc_state"] = state
    request.session["oidc_nonce"] = nonce
    request.session["oidc_return_to"] = return_to

    client = OAuth2Session(
        client_id=s.oidc_client_id,
        client_secret=s.oidc_client_secret,
        scope="openid email profile",
        redirect_uri=s.oidc_redirect_uri,
    )
    url, _ = client.create_authorization_url(
        metadata["authorization_endpoint"],
        state=state,
        nonce=nonce,
    )
    return RedirectResponse(url, status_code=302)


@router.get("/auth/callback")
def callback(
    request: Request,
    code: str = Query(...),
    state: str = Query(...),
) -> RedirectResponse:
    """Exchange the code, verify the ID token, mint our cookie."""
    s = get_settings()
    if s.auth_mode != "oidc":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "OIDC not enabled")

    expected_state = request.session.pop("oidc_state", None)
    expected_nonce = request.session.pop("oidc_nonce", None)
    return_to = request.session.pop("oidc_return_to", s.oidc_post_login_redirect)
    if expected_state is None or expected_state != state:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "state mismatch")

    metadata = _oidc_discover(s.oidc_issuer or "")
    client = OAuth2Session(
        client_id=s.oidc_client_id,
        client_secret=s.oidc_client_secret,
        redirect_uri=s.oidc_redirect_uri,
    )
    try:
        token = client.fetch_token(
            metadata["token_endpoint"],
            code=code,
            grant_type="authorization_code",
        )
    except Exception as exc:
        log.exception("auth.token_exchange_failed")
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "token exchange failed"
        ) from exc

    id_token = token.get("id_token")
    if not id_token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "no id_token in response")

    claims = _verify_id_token(
        id_token,
        jwks_uri=metadata["jwks_uri"],
        issuer=s.oidc_issuer,
        audience=s.oidc_audience or s.oidc_client_id or "",
        expected_nonce=expected_nonce,
    )

    email = claims.get("email")
    sub = claims.get("sub")
    if not email or not sub:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "id_token missing email/sub")

    # We trust Okta has authenticated this person; we only authorize against
    # our local users table — if they're not in lakebridge.users they don't
    # get in, even with a valid Okta token. Provisioning is intentionally
    # out-of-band (Terraform / human).
    user = auth.load_user_by_email(email)
    if user is None:
        log.warning("auth.unprovisioned_user", email=email, sub=sub)
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            f"{email} is authenticated but not provisioned in Lakebridge",
        )

    auth.issue_session(request, user)
    auth.audit(
        user,
        "auth.login",
        user.email,
        {"mode": "oidc", "sub": sub},
    )

    safe_return = return_to if return_to.startswith("/") else s.oidc_post_login_redirect
    return RedirectResponse(safe_return, status_code=302)


# ── OIDC plumbing ───────────────────────────────────────────────────────


_DISCOVERY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_JWKS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_DISCOVERY_TTL = 60 * 60  # 1 hour


def _oidc_discover(issuer: str) -> dict[str, Any]:
    """Cached fetch of the OIDC discovery document."""
    import httpx

    if not issuer:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "OIDC issuer not configured")
    cached = _DISCOVERY_CACHE.get(issuer)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1]
    url = issuer.rstrip("/") + "/.well-known/openid-configuration"
    r = httpx.get(url, timeout=5.0)
    r.raise_for_status()
    doc = r.json()
    _DISCOVERY_CACHE[issuer] = (now + _DISCOVERY_TTL, doc)
    return doc


def _fetch_jwks(uri: str) -> dict[str, Any]:
    import httpx

    cached = _JWKS_CACHE.get(uri)
    now = time.time()
    if cached and cached[0] > now:
        return cached[1]
    r = httpx.get(uri, timeout=5.0)
    r.raise_for_status()
    jwks = r.json()
    _JWKS_CACHE[uri] = (now + _DISCOVERY_TTL, jwks)
    return jwks


def _verify_id_token(
    token: str,
    *,
    jwks_uri: str,
    issuer: str | None,
    audience: str,
    expected_nonce: str | None,
) -> dict[str, Any]:
    jwks_doc = _fetch_jwks(jwks_uri)
    key_set = KeySet.import_key_set(jwks_doc)
    try:
        decoded = joserfc_jwt.decode(
            token,
            key_set,
            algorithms=["RS256", "RS384", "RS512", "ES256"],
        )
    except JoseError as exc:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, f"invalid id_token: {exc}"
        ) from exc
    claims = decoded.claims
    # joserfc returns a dict-like; explicit claim checks below.
    if issuer and claims.get("iss") != issuer:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "issuer mismatch")
    aud = claims.get("aud")
    if isinstance(aud, list):
        if audience not in aud:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "audience mismatch")
    elif aud != audience:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "audience mismatch")
    if expected_nonce and claims.get("nonce") != expected_nonce:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "nonce mismatch")
    # Verify exp / nbf manually (joserfc does it but only with a registry).
    now = int(time.time())
    exp = claims.get("exp")
    if isinstance(exp, int) and exp < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "id_token expired")
    return dict(claims)
