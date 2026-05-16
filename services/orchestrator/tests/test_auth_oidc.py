"""Okta OIDC callback flow, exercised against a faked Okta.

We don't have an Okta tenant in CI, so the network calls (discovery, JWKS,
token exchange) are replaced with stubs. The ID token is signed with a
local RSA keypair and the JWKS we hand back contains that public key — so
verification runs against real `joserfc` decode + signature check, just
without the network round trip.
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from joserfc import jwt
from joserfc.jwk import KeySet, RSAKey

from lakebridge import auth as authmod
from lakebridge import config as configmod
from lakebridge.api import auth as auth_api
from lakebridge.main import create_app

# A persistent key for every test in this module — saves regenerating RSA
# (slow) on every test.
_TEST_RSA_KEY = RSAKey.generate_key(
    2048, parameters={"kid": "lakebridge-test-1", "use": "sig", "alg": "RS256"}
)
_TEST_JWKS = KeySet([_TEST_RSA_KEY]).as_dict()


def _make_id_token(
    *,
    issuer: str,
    audience: str,
    email: str,
    sub: str,
    nonce: str | None = None,
    expires_in: int = 600,
) -> str:
    now = int(time.time())
    claims: dict[str, Any] = {
        "iss": issuer,
        "aud": audience,
        "sub": sub,
        "email": email,
        "iat": now,
        "exp": now + expires_in,
    }
    if nonce is not None:
        claims["nonce"] = nonce
    return jwt.encode(
        {"alg": "RS256", "kid": "lakebridge-test-1"}, claims, _TEST_RSA_KEY
    )


@pytest.fixture
def oidc_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # Flip to OIDC mode and provide the discovery anchors. The actual
    # network calls below get short-circuited by monkeypatch.
    monkeypatch.setenv("LAKEBRIDGE_AUTH_MODE", "oidc")
    monkeypatch.setenv("LAKEBRIDGE_OIDC_ISSUER", "https://fake-okta.local/oauth2/default")
    monkeypatch.setenv("LAKEBRIDGE_OIDC_CLIENT_ID", "lakebridge-test")
    monkeypatch.setenv("LAKEBRIDGE_OIDC_CLIENT_SECRET", "shh")
    monkeypatch.setenv("LAKEBRIDGE_OIDC_REDIRECT_URI", "http://testserver/api/auth/callback")
    monkeypatch.setenv("LAKEBRIDGE_OIDC_POST_LOGIN_REDIRECT", "http://testserver/")
    monkeypatch.setenv("LAKEBRIDGE_SESSION_SECRET", "test-secret-please-change")
    configmod.get_settings.cache_clear()

    # User store stand-in.
    users = {
        "priya.iyer@corp.local": authmod.User(
            id=1,
            email="priya.iyer@corp.local",
            name="Priya Iyer",
            role="Admin",
            sso_subject="okta|priya",
        ),
    }
    monkeypatch.setattr(authmod, "load_user_by_email", lambda e: users.get(e))
    monkeypatch.setattr(
        authmod, "load_user_by_subject", lambda s: next(
            (u for u in users.values() if u.sso_subject == s), None
        )
    )

    # No DB writes from audit() / issue_session() in tests.
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "execute", lambda *_a, **_kw: 0)

    # Patch the three network functions in api/auth.py.
    monkeypatch.setattr(
        auth_api,
        "_oidc_discover",
        lambda _issuer: {
            "authorization_endpoint": "https://fake-okta.local/oauth2/default/v1/authorize",
            "token_endpoint": "https://fake-okta.local/oauth2/default/v1/token",
            "jwks_uri": "https://fake-okta.local/oauth2/default/v1/keys",
        },
    )
    monkeypatch.setattr(auth_api, "_fetch_jwks", lambda _uri: _TEST_JWKS)

    yield TestClient(create_app())

    # Reset cached settings for the next test module.
    configmod.get_settings.cache_clear()


def test_login_redirects_to_okta(oidc_client: TestClient) -> None:
    r = oidc_client.get("/api/auth/login", follow_redirects=False)
    assert r.status_code == 302
    assert r.headers["location"].startswith(
        "https://fake-okta.local/oauth2/default/v1/authorize"
    )
    # state + nonce must be in the redirect for the callback to verify.
    assert "state=" in r.headers["location"]
    assert "nonce=" in r.headers["location"]


def test_callback_with_valid_id_token_signs_in(
    oidc_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # 1. Drive /login so the session has state + nonce parked.
    login = oidc_client.get("/api/auth/login", follow_redirects=False)
    assert login.status_code == 302
    loc = login.headers["location"]
    # Parse the state we generated.
    from urllib.parse import parse_qs, urlparse

    qs = parse_qs(urlparse(loc).query)
    state = qs["state"][0]
    nonce = qs["nonce"][0]

    # 2. Stub the token exchange: when fetch_token is called, return an
    # ID token signed with our test key.
    id_token = _make_id_token(
        issuer="https://fake-okta.local/oauth2/default",
        audience="lakebridge-test",
        email="priya.iyer@corp.local",
        sub="okta|priya",
        nonce=nonce,
    )
    from authlib.integrations.requests_client import OAuth2Session

    monkeypatch.setattr(
        OAuth2Session,
        "fetch_token",
        lambda self, *_a, **_kw: {"id_token": id_token, "access_token": "fake-at"},
    )

    # 3. Hit the callback. We follow no redirects so we can inspect the
    # 302 + the session cookie.
    cb = oidc_client.get(
        "/api/auth/callback",
        params={"code": "fake-auth-code", "state": state},
        follow_redirects=False,
    )
    assert cb.status_code == 302, cb.text
    # Default return_to is "/" (path-only redirect, stays on the SPA origin).
    assert cb.headers["location"] == "/"

    # 4. /api/me now reflects the signed-in user.
    me = oidc_client.get("/api/me")
    assert me.status_code == 200, me.text
    assert me.json()["email"] == "priya.iyer@corp.local"
    assert me.json()["role"] == "Admin"
    assert me.json()["auth_mode"] == "oidc"


def test_callback_rejects_state_mismatch(
    oidc_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    oidc_client.get("/api/auth/login", follow_redirects=False)
    from authlib.integrations.requests_client import OAuth2Session

    monkeypatch.setattr(
        OAuth2Session,
        "fetch_token",
        lambda self, *_a, **_kw: {"id_token": "x", "access_token": "x"},
    )
    cb = oidc_client.get(
        "/api/auth/callback",
        params={"code": "x", "state": "WRONG-STATE"},
        follow_redirects=False,
    )
    assert cb.status_code == 400
    assert "state" in cb.json()["detail"].lower()


def test_callback_rejects_unprovisioned_user(
    oidc_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A valid Okta ID token for a user who isn't in lakebridge.users
    must be rejected — Okta authenticates, we authorize."""
    login = oidc_client.get("/api/auth/login", follow_redirects=False)
    from urllib.parse import parse_qs, urlparse

    qs = parse_qs(urlparse(login.headers["location"]).query)
    state, nonce = qs["state"][0], qs["nonce"][0]
    id_token = _make_id_token(
        issuer="https://fake-okta.local/oauth2/default",
        audience="lakebridge-test",
        email="random.contractor@corp.local",
        sub="okta|random",
        nonce=nonce,
    )
    from authlib.integrations.requests_client import OAuth2Session

    monkeypatch.setattr(
        OAuth2Session,
        "fetch_token",
        lambda self, *_a, **_kw: {"id_token": id_token, "access_token": "x"},
    )
    cb = oidc_client.get(
        "/api/auth/callback",
        params={"code": "x", "state": state},
        follow_redirects=False,
    )
    assert cb.status_code == 403
    assert "not provisioned" in cb.json()["detail"]


def test_callback_rejects_bad_audience(
    oidc_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = oidc_client.get("/api/auth/login", follow_redirects=False)
    from urllib.parse import parse_qs, urlparse

    qs = parse_qs(urlparse(login.headers["location"]).query)
    state, nonce = qs["state"][0], qs["nonce"][0]
    # Audience is some other application — should be rejected.
    id_token = _make_id_token(
        issuer="https://fake-okta.local/oauth2/default",
        audience="someone-else",
        email="priya.iyer@corp.local",
        sub="okta|priya",
        nonce=nonce,
    )
    from authlib.integrations.requests_client import OAuth2Session

    monkeypatch.setattr(
        OAuth2Session,
        "fetch_token",
        lambda self, *_a, **_kw: {"id_token": id_token, "access_token": "x"},
    )
    cb = oidc_client.get(
        "/api/auth/callback",
        params={"code": "x", "state": state},
        follow_redirects=False,
    )
    assert cb.status_code == 401
    assert "audience" in cb.json()["detail"].lower()


def test_callback_rejects_expired_token(
    oidc_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    login = oidc_client.get("/api/auth/login", follow_redirects=False)
    from urllib.parse import parse_qs, urlparse

    qs = parse_qs(urlparse(login.headers["location"]).query)
    state, nonce = qs["state"][0], qs["nonce"][0]
    id_token = _make_id_token(
        issuer="https://fake-okta.local/oauth2/default",
        audience="lakebridge-test",
        email="priya.iyer@corp.local",
        sub="okta|priya",
        nonce=nonce,
        expires_in=-60,  # already expired
    )
    from authlib.integrations.requests_client import OAuth2Session

    monkeypatch.setattr(
        OAuth2Session,
        "fetch_token",
        lambda self, *_a, **_kw: {"id_token": id_token, "access_token": "x"},
    )
    cb = oidc_client.get(
        "/api/auth/callback",
        params={"code": "x", "state": state},
        follow_redirects=False,
    )
    assert cb.status_code == 401
    assert "expired" in cb.json()["detail"].lower()


def test_dev_session_404_in_oidc_mode(oidc_client: TestClient) -> None:
    """In OIDC mode the dev bootstrap is hidden entirely."""
    r = oidc_client.post(
        "/api/auth/dev-session", json={"email": "priya.iyer@corp.local"}
    )
    assert r.status_code == 404
