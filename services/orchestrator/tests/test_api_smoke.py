"""Smoke tests: the app constructs and OpenAPI renders.

We don't hit any DB-touching endpoints — those need a real SQL Server.
The point of this test is to catch import-time errors and obvious routing
mistakes that would only surface in production otherwise.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from lakebridge.main import create_app


def test_app_constructs_and_health_responds() -> None:
    app = create_app()
    client = TestClient(app)
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "version" in body


def test_openapi_renders_with_all_routers() -> None:
    app = create_app()
    spec = app.openapi()
    paths = set(spec["paths"].keys())
    # Sanity-check that every router is mounted.
    for expected in (
        "/api/health",
        "/api/me",
        "/api/auth/config",
        "/api/auth/dev-session",
        "/api/auth/login",
        "/api/auth/callback",
        "/api/auth/logout",
        "/api/jobs",
        "/api/jobs/{job_id}",
        "/api/jobs/{job_id}/runs",
        "/api/jobs/{job_id}/schema",
        "/api/runs/{run_id}",
        "/api/runs/{run_id}/events",
        "/api/runs/{run_id}/log",
        "/api/sources",
        "/api/sources/{source_id}/test-connection",
        "/api/sources/{source_id}/objects",
        "/api/dashboard/kpis",
        "/api/dashboard/timeline",
        "/api/recon",
        "/api/users",
        "/api/audit",
    ):
        assert expected in paths, f"missing route in OpenAPI: {expected}"
