"""Auth flow tests against a TestClient with the user lookup mocked.

We mock `auth.load_user_by_email` / `load_user_by_subject` so we don't need
a SQL Server backing the test. The session middleware is real.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from lakebridge import auth as authmod
from lakebridge.main import create_app


def _user(email: str, role: str) -> authmod.User:
    return authmod.User(
        id=1,
        email=email,
        name=email.split("@")[0],
        role=role,  # type: ignore[arg-type]
        sso_subject=f"okta|{email}",
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    # In-memory user store so dev-session and current_user can look users up
    # without a database.
    users: dict[str, authmod.User] = {
        "priya.iyer@corp.local": _user("priya.iyer@corp.local", "Admin"),
        "marcus.hahn@corp.local": _user("marcus.hahn@corp.local", "Operator"),
        "tom.mwangi@corp.local": _user("tom.mwangi@corp.local", "Read-only"),
    }
    by_sub = {u.sso_subject: u for u in users.values()}

    monkeypatch.setattr(authmod, "load_user_by_email", lambda e: users.get(e))
    monkeypatch.setattr(authmod, "load_user_by_subject", lambda s: by_sub.get(s))
    # Avoid DB writes in audit() / issue_session().
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "execute", lambda *_a, **_kw: 0)

    app = create_app()
    return TestClient(app)


def test_anonymous_request_is_401(client: TestClient) -> None:
    r = client.get("/api/jobs")
    assert r.status_code == 401


def test_health_does_not_require_auth(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200


def test_dev_session_flow_signs_in_and_me_returns_user(client: TestClient) -> None:
    r = client.post("/api/auth/dev-session", json={"email": "priya.iyer@corp.local"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["email"] == "priya.iyer@corp.local"
    assert body["role"] == "Admin"

    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["role"] == "Admin"


def test_dev_session_unknown_email_404(client: TestClient) -> None:
    r = client.post("/api/auth/dev-session", json={"email": "nobody@corp.local"})
    assert r.status_code == 404


def test_read_only_cannot_run_a_job(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Sign in as Tom (Read-only)
    r = client.post("/api/auth/dev-session", json={"email": "tom.mwangi@corp.local"})
    assert r.status_code == 200

    # Mock the DB lookups the run_now endpoint hits before reaching the
    # role check — it shouldn't matter because the role gate fires first,
    # but mock just enough to ensure we're exercising the gate.
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: {"id": 1, "code": "X", "enabled": True})

    r = client.post("/api/jobs/1/run", json={"run_mode": "manual"})
    assert r.status_code == 403
    assert "Read-only" in r.json()["detail"]


def test_operator_can_run_a_job(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.post("/api/auth/dev-session", json={"email": "marcus.hahn@corp.local"})

    captured: dict[str, Any] = {}

    def fake_enqueue(job_id: int, triggered_by: str, run_mode: str) -> int:
        captured["triggered_by"] = triggered_by
        captured["run_mode"] = run_mode
        return 42

    from lakebridge import db as dbmod
    from lakebridge.api import jobs as jobs_api

    monkeypatch.setattr(jobs_api, "enqueue_run", fake_enqueue)
    monkeypatch.setattr(
        dbmod, "fetch_one", lambda *_a, **_kw: {"id": 1, "code": "EXT.TEST", "enabled": True}
    )

    r = client.post("/api/jobs/1/run", json={"run_mode": "manual"})
    assert r.status_code == 202, r.text
    assert r.json() == {"run_id": 42}
    # The server resolved triggered_by from the session, NOT from any
    # client-supplied field.
    assert captured["triggered_by"] == "marcus.hahn@corp.local"


def test_admin_only_endpoints_reject_operator(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    client.post("/api/auth/dev-session", json={"email": "marcus.hahn@corp.local"})
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "fetch_all", lambda *_a, **_kw: [])

    r = client.get("/api/users")
    assert r.status_code == 403

    r = client.get("/api/audit")
    assert r.status_code == 403


def test_logout_clears_session(client: TestClient) -> None:
    client.post("/api/auth/dev-session", json={"email": "priya.iyer@corp.local"})
    assert client.get("/api/me").status_code == 200

    r = client.post("/api/auth/logout")
    assert r.status_code == 200

    assert client.get("/api/me").status_code == 401


def test_auth_config_reflects_mode(client: TestClient) -> None:
    r = client.get("/api/auth/config")
    assert r.status_code == 200
    body = r.json()
    assert body["mode"] == "dev"  # default in tests
    # Okta URL is None in dev mode; the dev-users list is best-effort
    # (DB mocked to empty) so we don't assert its contents.
    assert body["okta_login_url"] is None
