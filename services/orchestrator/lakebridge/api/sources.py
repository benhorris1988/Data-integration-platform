"""/api/sources — list, detail, test-connection."""

from __future__ import annotations

import os
import time
from typing import Annotated

import oracledb
from fastapi import APIRouter, Depends, HTTPException, status

from .. import auth, db
from ..logging import get_logger
from ..models import Source, TestConnectionResult
from ..runner.sources.oracle import OracleEndpoint

router = APIRouter(prefix="/api/sources", tags=["sources"])

log = get_logger("lakebridge.api.sources")


@router.get("", response_model=list[Source])
def list_sources(
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> list[Source]:
    rows = db.fetch_all(
        "SELECT id, host, port, sid, service_name, oracle_version, username, "
        "       secret_ref, tls_required, pool_size, status, last_tested_at, last_test_msg "
        "FROM lakebridge.sources ORDER BY id"
    )
    return [Source.model_validate(r) for r in rows]


@router.get("/{source_id}", response_model=Source)
def get_source(
    source_id: str,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> Source:
    row = db.fetch_one(
        "SELECT id, host, port, sid, service_name, oracle_version, username, "
        "       secret_ref, tls_required, pool_size, status, last_tested_at, last_test_msg "
        "FROM lakebridge.sources WHERE id = ?",
        (source_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    return Source.model_validate(row)


@router.post("/{source_id}/test-connection", response_model=TestConnectionResult)
def test_connection(
    source_id: str,
    user: Annotated[auth.User, Depends(auth.RequireOperator)],
) -> TestConnectionResult:
    row = db.fetch_one(
        "SELECT host, port, sid, service_name, username, secret_ref, tls_required "
        "FROM lakebridge.sources WHERE id = ?",
        (source_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")

    # Stub secret resolution: read from env var `LAKEBRIDGE_SECRET_<secret_ref slug>`.
    # Real install wires this to Vault / Azure Key Vault / AWS Secrets Manager.
    env_key = "LAKEBRIDGE_SECRET_" + row["secret_ref"].upper().replace("/", "_").replace("-", "_")
    password = os.environ.get(env_key)
    if not password:
        msg = f"vault not configured: missing env var {env_key}"
        log.warning("source.test.skipped", source=source_id, reason=msg)
        return TestConnectionResult(ok=False, latency_ms=0, message=msg)

    ep = OracleEndpoint(
        host=row["host"],
        port=row["port"],
        sid=row["sid"],
        service_name=row["service_name"],
        user=row["username"],
        password=password,
        tls_required=bool(row["tls_required"]),
    )
    started = time.monotonic()
    try:
        # Connect, run a trivial SELECT, close.
        if ep.service_name:
            dsn = oracledb.makedsn(ep.host, ep.port, service_name=ep.service_name)
        else:
            dsn = oracledb.makedsn(ep.host, ep.port, sid=ep.sid)
        conn = oracledb.connect(user=ep.user, password=ep.password, dsn=dsn)
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1 FROM DUAL")
                cur.fetchone()
        finally:
            conn.close()
    except oracledb.DatabaseError as exc:
        elapsed = int((time.monotonic() - started) * 1000)
        msg = str(exc).splitlines()[0][:300]
        db.execute(
            "UPDATE lakebridge.sources SET status = ?, last_tested_at = SYSUTCDATETIME(), "
            "                              last_test_msg = ? WHERE id = ?",
            ("failed", msg, source_id),
        )
        return TestConnectionResult(ok=False, latency_ms=elapsed, message=msg)

    elapsed = int((time.monotonic() - started) * 1000)
    msg = f"TNS resolved · {elapsed}ms · session opened"
    db.execute(
        "UPDATE lakebridge.sources SET status = ?, last_tested_at = SYSUTCDATETIME(), "
        "                              last_test_msg = ? WHERE id = ?",
        ("ok", msg, source_id),
    )
    auth.audit(user, "source.test", source_id, {"latency_ms": elapsed, "ok": True})
    return TestConnectionResult(ok=True, latency_ms=elapsed, message=msg)
