"""POST/PUT/DELETE on /api/jobs.

We mock both DB and the auth user lookups; the goal is to exercise the
validation chain (Pydantic constraints, the JobBody validators, the
cross-field business rules in `_validate_business_rules`) and the
mutation paths in the router.
"""

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
        "code": "EXT.NEW.JOB.FULL",
        "source_id": "IFS-PRD-EU",
        "source_object": "IFSAPP.WIDGET",
        "source_query": None,
        "target_schema": "stg_ifs_test",
        "target_table": "widget",
        "strategy": "full_snapshot",
        "schedule": "0 6 * * *",
        "watermark_column": None,
        "watermark_grace_sec": 300,
        "batch_size": 5000,
        "retries": 3,
        "timeout_sec": 2700,
        "owner": "Priya Iyer",
        "enabled": True,
    }
    base.update(overrides)
    return base


def test_create_job_validation_chain(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")
    from lakebridge import db as dbmod

    # 1. Bad code shape → 422 from pydantic field validator.
    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: None)
    r = client.post(
        "/api/jobs", json=_body(code="lower.case"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 422

    # 2. target_schema not stg_ → 422
    r = client.post(
        "/api/jobs", json=_body(target_schema="other_thing"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 422

    # 3. invalid cron → 422
    r = client.post(
        "/api/jobs", json=_body(schedule="not-a-cron"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 422

    # 4. watermark_delta without watermark_column → 400 from business rules
    monkeypatch.setattr(
        dbmod, "fetch_one", lambda *_a, **_kw: {"x": 1}
    )  # source exists
    r = client.post(
        "/api/jobs",
        json=_body(strategy="watermark_delta", watermark_column=None),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 400
    assert "watermark_column" in r.json()["detail"]

    # 5. Unknown source_id → 400
    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: None)
    r = client.post(
        "/api/jobs", json=_body(source_id="NOT-A-SOURCE"),
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 400
    assert "NOT-A-SOURCE" in r.json()["detail"]


def test_create_job_happy_path(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "marcus.hahn@corp.local")  # Operator can create
    from lakebridge import db as dbmod

    # source exists, no dup, get_job returns the row.
    calls: list[Any] = []

    def fake_fetch_one(sql: str, params: tuple[Any, ...] = (), **_kw: Any) -> Any:
        calls.append(sql)
        if "FROM lakebridge.sources" in sql:
            return {"x": 1}
        if "WHERE code = ?" in sql:
            return None  # no dup
        if "WHERE id = ?" in sql:
            # get_job after insert returns this canonical Job shape
            return {
                "id": 77, "code": "EXT.NEW.JOB.FULL", "source_id": "IFS-PRD-EU",
                "source_object": "IFSAPP.WIDGET", "target_schema": "stg_ifs_test",
                "target_table": "widget", "strategy": "full_snapshot",
                "schedule": "0 6 * * *", "watermark_column": None,
                "batch_size": 5000, "retries": 3, "timeout_sec": 2700,
                "owner": "Priya Iyer", "enabled": True, "pinned": False,
            }
        return None

    monkeypatch.setattr(dbmod, "fetch_one", fake_fetch_one)

    class FakeCursor:
        def __init__(self) -> None:
            self.executed: list[Any] = []

        def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
            self.executed.append((sql, params))

        def fetchone(self) -> tuple[Any, ...]:
            return (77,)

        def __enter__(self) -> FakeCursor:
            return self

        def __exit__(self, *_: Any) -> None:
            return None

    class FakeConn:
        def cursor(self) -> FakeCursor:
            return FakeCursor()

        def commit(self) -> None:
            pass

    from contextlib import contextmanager

    @contextmanager
    def fake_conn():
        yield FakeConn()

    monkeypatch.setattr(dbmod, "connection", fake_conn)

    r = client.post(
        "/api/jobs", json=_body(), headers={"X-Lakebridge-Csrf": csrf}
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["id"] == 77
    assert body["code"] == "EXT.NEW.JOB.FULL"


def test_delete_blocks_when_runs_exist(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "priya.iyer@corp.local")  # Admin required
    from lakebridge import db as dbmod

    def fake_fetch_one(sql: str, *_a: Any, **_kw: Any) -> Any:
        if "FROM lakebridge.jobs WHERE id = ?" in sql:
            return {"code": "EXT.MAT.MASTER.FULL"}
        if "COUNT(*)" in sql and "lakebridge.runs" in sql:
            return {"n": 14}
        return None

    monkeypatch.setattr(dbmod, "fetch_one", fake_fetch_one)

    r = client.delete("/api/jobs/1", headers={"X-Lakebridge-Csrf": csrf})
    assert r.status_code == 409
    assert "14 run" in r.json()["detail"]

    # ?force=true bypasses the safety net.
    r = client.delete("/api/jobs/1?force=true", headers={"X-Lakebridge-Csrf": csrf})
    assert r.status_code == 204


def test_delete_requires_admin(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "marcus.hahn@corp.local")  # Operator, not Admin
    from lakebridge import db as dbmod

    monkeypatch.setattr(
        dbmod, "fetch_one", lambda *_a, **_kw: {"code": "X"}
    )
    r = client.delete("/api/jobs/1", headers={"X-Lakebridge-Csrf": csrf})
    assert r.status_code == 403


def test_pin_round_trips(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    csrf = _signin(client, "marcus.hahn@corp.local")
    from lakebridge import db as dbmod

    monkeypatch.setattr(dbmod, "fetch_one", lambda *_a, **_kw: {"code": "X"})
    r = client.post(
        "/api/jobs/1/pin", json={"pinned": True},
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 200
    assert r.json() == {"pinned": True}

    r = client.post(
        "/api/jobs/1/pin", json={"pinned": False},
        headers={"X-Lakebridge-Csrf": csrf},
    )
    assert r.status_code == 200
    assert r.json() == {"pinned": False}
