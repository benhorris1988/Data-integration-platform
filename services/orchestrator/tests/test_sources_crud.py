"""POST/PUT/DELETE on /api/sources."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from lakebridge import auth as authmod
from lakebridge.main import create_app


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    users = {
        "priya.iyer@corp.local": authmod.User(
            id=1, email="priya.iyer@corp.local", name="Priya", role="Admin",
            sso_subject="okta|priya",
        ),
        "marcus.hahn@corp.local": authmod.User(
            id=2, email="marcus.hahn@corp.local", name="Marcus", role="Operator",
            sso_subject="okta|marcus",
        ),
    }
    monkeypatch.setattr(authmod, "load_user_by_email", lambda e: users.get(e))
    monkeypatch.setattr(
        authmod, "load_user_by_subject",
        lambda s: next((u for u in users.values() if u.sso_subject == s), None),
    )
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "execute", lambda *_a, **_kw: 0)
    return TestClient(create_app())


def _signin(client: TestClient, email: str) -> str:
    client.post("/api/auth/dev-session", json={"email": email})
    return client.cookies["lb_csrf"]


def _body(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "IFS-PRD-APAC",
        "host": "ifs-prd-apac.corp.local",
        "port": 1521,
        "sid": "IFSPROD",
        "service_name": None,
        "oracle_version": "19c",
        "username": "IFSREADER",
        "secret_ref": "secret/lakebridge/ifs-reader-apac",
        "tls_required": True,
        "pool_size": 8,
    }
    base.update(overrides)
    return base


def test_create_source_validation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")  # Admin
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: None)

    # 1. Bad id shape → 422
    r = client.post(
        "/api/sources", json=_body(id="lower-case"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 422

    # 2. Bad secret_ref shape → 422
    r = client.post(
        "/api/sources", json=_body(secret_ref="just-a-name"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 422

    # 3. Both sid and service_name set → 400
    r = client.post(
        "/api/sources",
        json=_body(sid="IFSPROD", service_name="ifs.corp.local"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 400

    # 4. Neither sid nor service_name set → 400
    r = client.post(
        "/api/sources", json=_body(sid=None, service_name=None),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 400


def test_create_source_happy_path(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")
    from lakebridge import db as dbmod

    # First fetch_one is the dup-check (None → no dup); subsequent call is
    # inside get_source which returns the canonical Source.
    canonical = {
        "id": "IFS-PRD-APAC", "host": "ifs-prd-apac.corp.local", "port": 1521,
        "sid": "IFSPROD", "service_name": None, "oracle_version": "19c",
        "username": "IFSREADER", "secret_ref": "secret/lakebridge/ifs-reader-apac",
        "tls_required": True, "pool_size": 8, "status": "ok",
        "last_tested_at": None, "last_test_msg": None,
    }
    calls = {"n": 0}

    def fake_fetch_one(*_a: Any, **_kw: Any) -> Any:
        calls["n"] += 1
        return None if calls["n"] == 1 else canonical

    monkeypatch.setattr(dbmod, "fetch_one", fake_fetch_one)

    r = client.post(
        "/api/sources", json=_body(), headers={"X-Lakebridge-Csrf": csrf}
    )
    assert r.status_code == 201, r.text
    assert r.json()["id"] == "IFS-PRD-APAC"


def test_create_source_requires_admin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "marcus.hahn@corp.local")  # Operator, not Admin
    r = client.post(
        "/api/sources", json=_body(), headers={"X-Lakebridge-Csrf": csrf}
    )
    assert r.status_code == 403


def test_delete_blocks_when_jobs_reference(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")
    from lakebridge import db as dbmod

    def fake_fetch_one(sql: str, *_a: Any, **_kw: Any) -> Any:
        if "FROM lakebridge.sources WHERE id = ?" in sql:
            return {"id": "IFS-PRD-EU"}
        if "COUNT(*)" in sql and "lakebridge.jobs" in sql:
            return {"n": 23}
        return None

    monkeypatch.setattr(dbmod, "fetch_one", fake_fetch_one)
    r = client.delete(
        "/api/sources/IFS-PRD-EU", headers={"X-Lakebridge-Csrf": csrf}
    )
    assert r.status_code == 409
    assert "23 job" in r.json()["detail"]


def test_update_source_rejects_rename(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: {"id": "IFS-PRD-EU"})
    r = client.put(
        "/api/sources/IFS-PRD-EU",
        json=_body(id="IFS-PRD-EU-RENAMED"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 400
    assert "renam" in r.json()["detail"].lower()
