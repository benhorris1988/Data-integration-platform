"""/api/sources — list, detail, test-connection, CRUD, object discovery.

Sources hold the connection coordinates for an IFS instance and the
vault reference (NOT the password) needed to bind a job to it. Mutations
require Admin because creating a source pins a secret path that may
already exist in Vault — a typo here grants a job's runner real Oracle
credentials.
"""

from __future__ import annotations

import re
import time
from typing import Annotated, Any

import oracledb
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from .. import auth, db
from ..logging import get_logger
from ..models import Source, TestConnectionResult
from ..runner.sources.oracle import OracleEndpoint
from ..secrets import get_resolver

router = APIRouter(prefix="/api/sources", tags=["sources"])

log = get_logger("lakebridge.api.sources")

# Source ids are the operator's primary handle in the UI, audit log, and
# job spec. Same uppercase / hyphen convention IFS-PRD-EU follows.
_SOURCE_ID_RE = re.compile(r"^[A-Z][A-Z0-9-]*$")


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

    password = get_resolver().resolve(row["secret_ref"])
    if not password:
        msg = f"secret {row['secret_ref']!r} not resolvable in current environment"
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


# ── Source object discovery ─────────────────────────────────────────────


class SourceObject(BaseModel):
    name: str            # OWNER.TABLE_NAME
    owner: str
    object_name: str
    kind: str            # 'TABLE' | 'VIEW'
    num_rows: int | None
    last_analyzed: str | None


@router.get("/{source_id}/objects", response_model=list[SourceObject])
def list_objects(
    source_id: str,
    _: Annotated[auth.User, Depends(auth.current_user)],
    like: str | None = Query(default=None, description="LIKE pattern, e.g. 'IFSAPP.%'"),
    limit: int = Query(default=100, le=500),
) -> list[SourceObject]:
    """Discover tables and views on a source. Read-only: hits Oracle's
    ALL_TABLES and ALL_VIEWS catalogs, returns a unioned list."""
    row = db.fetch_one(
        "SELECT host, port, sid, service_name, username, secret_ref, tls_required "
        "FROM lakebridge.sources WHERE id = ?",
        (source_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    password = get_resolver().resolve(row["secret_ref"])
    if not password:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"secret {row['secret_ref']!r} not resolvable",
        )

    where_tables = "WHERE UPPER(owner || '.' || table_name) LIKE UPPER(:pat)" if like else ""
    where_views = "WHERE UPPER(owner || '.' || view_name) LIKE UPPER(:pat)" if like else ""
    bind: dict[str, Any] = {"lim": limit}
    if like:
        bind["pat"] = like

    tables_sql = (
        "SELECT owner, table_name AS object_name, 'TABLE' AS kind, "
        "       num_rows, "
        "       TO_CHAR(last_analyzed, 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS last_analyzed "
        f"FROM all_tables {where_tables} "
        "ORDER BY owner, table_name "
        "FETCH FIRST :lim ROWS ONLY"
    )
    views_sql = (
        "SELECT owner, view_name AS object_name, 'VIEW' AS kind, "
        "       CAST(NULL AS NUMBER) AS num_rows, "
        "       CAST(NULL AS VARCHAR2(30)) AS last_analyzed "
        f"FROM all_views {where_views} "
        "ORDER BY owner, view_name "
        "FETCH FIRST :lim ROWS ONLY"
    )

    out: list[SourceObject] = []
    try:
        conn = _open_oracle(row, password)
        try:
            for sql in (tables_sql, views_sql):
                with conn.cursor() as cur:
                    cur.execute(sql, bind)
                    for r in cur.fetchall():
                        owner, name, kind, num_rows, last_analyzed = r
                        out.append(
                            SourceObject(
                                name=f"{owner}.{name}",
                                owner=str(owner),
                                object_name=str(name),
                                kind=str(kind),
                                num_rows=int(num_rows) if num_rows is not None else None,
                                last_analyzed=str(last_analyzed) if last_analyzed else None,
                            )
                        )
        finally:
            conn.close()
    except oracledb.DatabaseError as exc:
        msg = str(exc).splitlines()[0][:300]
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"oracle: {msg}"
        ) from exc

    # Trim to `limit` after the union and sort for stable display order.
    out.sort(key=lambda x: (x.owner, x.object_name))
    return out[:limit]


# ── Helpers ─────────────────────────────────────────────────────────────


# ── CRUD ────────────────────────────────────────────────────────────────


class SourceBody(BaseModel):
    """Mutable fields of a source. Same shape for create (POST) and
    update (PUT). The `id` is editable on creation only; updates ignore
    any `id` change and operate on the URL-path id."""

    id: str = Field(min_length=2, max_length=40)
    host: str = Field(min_length=1, max_length=200)
    port: int = Field(default=1521, ge=1, le=65535)
    sid: str | None = Field(default=None, max_length=60)
    service_name: str | None = Field(default=None, max_length=120)
    oracle_version: str | None = Field(default=None, max_length=40)
    username: str = Field(min_length=1, max_length=60)
    secret_ref: str = Field(min_length=1, max_length=200)
    tls_required: bool = True
    pool_size: int = Field(default=8, ge=1, le=64)

    @field_validator("id")
    @classmethod
    def _id_shape(cls, v: str) -> str:
        if not _SOURCE_ID_RE.match(v):
            raise ValueError(
                "id must be uppercase letters/digits/hyphens, e.g. IFS-PRD-EU"
            )
        return v

    @field_validator("secret_ref")
    @classmethod
    def _secret_ref_shape(cls, v: str) -> str:
        # Vault path style: `<engine>/<path>` with at least one slash.
        # Allows engine-agnostic refs (AKV uses the value verbatim).
        if "/" not in v or v.startswith("/") or v.endswith("/"):
            raise ValueError(
                "secret_ref should be a vault-style path (e.g. secret/lakebridge/ifs-reader)"
            )
        return v


def _enforce_endpoint_shape(body: SourceBody) -> None:
    """Exactly one of sid / service_name must be set."""
    if bool(body.sid) == bool(body.service_name):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "exactly one of sid or service_name must be set",
        )


@router.post("", response_model=Source, status_code=status.HTTP_201_CREATED)
def create_source(
    body: SourceBody,
    user: Annotated[auth.User, Depends(auth.RequireAdmin)],
) -> Source:
    """Add a new IFS source. Admin only — this writes the vault binding
    that runner credentials will resolve against."""
    _enforce_endpoint_shape(body)
    dup = db.fetch_one("SELECT id FROM lakebridge.sources WHERE id = ?", (body.id,))
    if dup is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"source {body.id!r} already exists"
        )
    db.execute(
        "INSERT INTO lakebridge.sources "
        "(id, host, port, sid, service_name, oracle_version, username, secret_ref, "
        " tls_required, pool_size, created_by, updated_by) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            body.id, body.host, body.port, body.sid, body.service_name,
            body.oracle_version, body.username, body.secret_ref,
            body.tls_required, body.pool_size, user.email, user.email,
        ),
    )
    auth.audit(user, "source.create", body.id, {"host": body.host, "port": body.port})
    return get_source(body.id, user)  # type: ignore[arg-type]


@router.put("/{source_id}", response_model=Source)
def update_source(
    source_id: str,
    body: SourceBody,
    user: Annotated[auth.User, Depends(auth.RequireAdmin)],
) -> Source:
    """Edit an existing source. The path id is authoritative — renaming a
    source is intentionally not supported (it'd invalidate every job
    that references it via FK)."""
    _enforce_endpoint_shape(body)
    if body.id != source_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "renaming a source is not supported; create a new one and rebind jobs",
        )
    existing = db.fetch_one(
        "SELECT id FROM lakebridge.sources WHERE id = ?", (source_id,)
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    db.execute(
        "UPDATE lakebridge.sources SET "
        "  host = ?, port = ?, sid = ?, service_name = ?, oracle_version = ?, "
        "  username = ?, secret_ref = ?, tls_required = ?, pool_size = ?, "
        "  updated_at = SYSUTCDATETIME(), updated_by = ? "
        "WHERE id = ?",
        (
            body.host, body.port, body.sid, body.service_name, body.oracle_version,
            body.username, body.secret_ref, body.tls_required, body.pool_size,
            user.email, source_id,
        ),
    )
    auth.audit(user, "source.edit", source_id, {"host": body.host, "port": body.port})
    return get_source(source_id, user)  # type: ignore[arg-type]


@router.delete(
    "/{source_id}", status_code=status.HTTP_204_NO_CONTENT, response_model=None
)
def delete_source(
    source_id: str,
    user: Annotated[auth.User, Depends(auth.RequireAdmin)],
) -> None:
    """Delete a source. Refuses if any jobs reference it — the operator
    must reassign them first. No force flag: orphaning a job by deleting
    its source would silently break the next scheduled run."""
    existing = db.fetch_one(
        "SELECT id FROM lakebridge.sources WHERE id = ?", (source_id,)
    )
    if existing is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "source not found")
    refs = db.fetch_one(
        "SELECT COUNT(*) AS n FROM lakebridge.jobs WHERE source_id = ?",
        (source_id,),
    )
    n = int((refs or {}).get("n") or 0)
    if n > 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{n} job(s) still reference this source; reassign them first",
        )
    db.execute("DELETE FROM lakebridge.sources WHERE id = ?", (source_id,))
    auth.audit(user, "source.delete", source_id, {"job_count": n})


def _open_oracle(row: dict[str, Any], password: str) -> Any:
    ep = OracleEndpoint(
        host=row["host"],
        port=row["port"],
        sid=row["sid"],
        service_name=row["service_name"],
        user=row["username"],
        password=password,
        tls_required=bool(row["tls_required"]),
    )
    if ep.service_name:
        dsn = oracledb.makedsn(ep.host, ep.port, service_name=ep.service_name)
    else:
        dsn = oracledb.makedsn(ep.host, ep.port, sid=ep.sid)
    return oracledb.connect(user=ep.user, password=ep.password, dsn=dsn)
