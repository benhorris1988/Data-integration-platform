"""/api/jobs — list, detail, trigger, enable/disable.

All endpoints require a signed-in user. State-changing endpoints (run /
enable / disable) require Operator or Admin.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from .. import auth, db
from ..models import Job, JobListItem, Run
from ..secrets import get_resolver
from .runs import enqueue_run

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


# `triggered_by` is no longer accepted from the client — the server fills
# it from the session. The body carries run mode and (for backfill) the
# watermark window to replay.
class RunNowBody(BaseModel):
    run_mode: str = "manual"  # "manual" | "backfill"
    # Inclusive lower bound, exclusive upper. Both are required when
    # run_mode="backfill"; ignored for "manual".
    backfill_from: str | None = None
    backfill_to: str | None = None


@router.get("", response_model=list[JobListItem])
def list_jobs(
    _: Annotated[auth.User, Depends(auth.current_user)],
    status_filter: list[str] | None = Query(default=None, alias="status"),
    schedule: str | None = None,
    source_id: str | None = None,
    q: str | None = None,
    limit: int = Query(default=200, le=500),
) -> list[JobListItem]:
    """Return jobs joined to their last run, optionally filtered. Mirrors
    the Jobs index filter bar."""
    where: list[str] = []
    params: list[Any] = []
    if status_filter:
        placeholders = ", ".join("?" for _ in status_filter)
        where.append(f"COALESCE(last_run_status, N'queued') IN ({placeholders})")
        params.extend(status_filter)
    if schedule == "manual":
        where.append("schedule = N'manual'")
    elif schedule == "scheduled":
        where.append("schedule <> N'manual'")
    if source_id:
        where.append("source_id = ?")
        params.append(source_id)
    if q:
        where.append("(code LIKE ? OR source_object LIKE ? OR target_table LIKE ?)")
        like = f"%{q}%"
        params.extend([like, like, like])
    sql = (
        f"SELECT TOP {limit} * FROM lakebridge.v_jobs_with_last_run"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY last_run_finished_at DESC"
    )
    rows = db.fetch_all(sql, tuple(params))
    return [JobListItem.model_validate(r) for r in rows]


@router.get("/{job_id}", response_model=Job)
def get_job(
    job_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> Job:
    row = db.fetch_one(
        "SELECT id, code, source_id, source_object, target_schema, target_table, "
        "       strategy, schedule, watermark_column, batch_size, retries, timeout_sec, "
        "       owner, enabled, pinned "
        "FROM lakebridge.jobs WHERE id = ?",
        (job_id,),
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    return Job.model_validate(row)


@router.get("/{job_id}/runs", response_model=list[Run])
def list_job_runs(
    job_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
    limit: int = Query(default=50, le=500),
) -> list[Run]:
    """Run history for one job, newest first."""
    rows = db.fetch_all(
        f"SELECT TOP {limit} * FROM lakebridge.v_runs_with_job "
        "WHERE job_id = ? ORDER BY triggered_at DESC",
        (job_id,),
    )
    return [Run.model_validate(r) for r in rows]


class SchemaColumn(BaseModel):
    name: str
    data_type: str
    nullable: bool


class SchemaMapping(BaseModel):
    src: SchemaColumn | None
    tgt: SchemaColumn | None
    drift: str | None  # 'cast' | 'new' | 'missing' | None


class SchemaResponse(BaseModel):
    source_object: str
    target: str
    source_columns: list[SchemaColumn]
    target_columns: list[SchemaColumn]
    mapping: list[SchemaMapping]


@router.get("/{job_id}/schema", response_model=SchemaResponse)
def get_job_schema(
    job_id: int,
    _: Annotated[auth.User, Depends(auth.current_user)],
) -> SchemaResponse:
    """Compare the source object's columns (Oracle ALL_TAB_COLUMNS) with
    the target table's columns (SQL Server INFORMATION_SCHEMA.COLUMNS) and
    return a side-by-side mapping with drift flags.

    drift values:
      `cast`    — names align but the target type is narrower than the source
      `new`     — source column has no target column
      `missing` — target has a column the source doesn't (Lakebridge trailer
                  columns are filtered out before this comparison)
    """
    job = db.fetch_one(
        "SELECT j.source_object, j.target_schema, j.target_table, "
        "       s.host, s.port, s.sid, s.service_name, s.username, s.secret_ref, "
        "       s.tls_required "
        "FROM lakebridge.jobs j "
        "JOIN lakebridge.sources s ON s.id = j.source_id "
        "WHERE j.id = ?",
        (job_id,),
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    source_columns = _read_source_columns(job)
    target_columns = _read_target_columns(job)
    return SchemaResponse(
        source_object=str(job["source_object"]),
        target=f"{job['target_schema']}.{job['target_table']}",
        source_columns=source_columns,
        target_columns=target_columns,
        mapping=_diff_columns(source_columns, target_columns),
    )


def _read_source_columns(job: dict[str, Any]) -> list[SchemaColumn]:
    import oracledb

    from ..runner.sources.oracle import OracleEndpoint

    password = get_resolver().resolve(job["secret_ref"])
    if not password:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"secret {job['secret_ref']!r} not resolvable",
        )
    owner, name = _split_owner(str(job["source_object"]))
    ep = OracleEndpoint(
        host=job["host"], port=job["port"], sid=job["sid"],
        service_name=job["service_name"], user=job["username"],
        password=password, tls_required=bool(job["tls_required"]),
    )
    dsn = (
        oracledb.makedsn(ep.host, ep.port, service_name=ep.service_name)
        if ep.service_name
        else oracledb.makedsn(ep.host, ep.port, sid=ep.sid)
    )
    try:
        conn = oracledb.connect(user=ep.user, password=ep.password, dsn=dsn)
    except oracledb.DatabaseError as exc:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"oracle: {str(exc).splitlines()[0][:200]}"
        ) from exc
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT column_name, data_type, data_length, data_precision, data_scale, nullable "
                "FROM all_tab_columns WHERE owner = :owner AND table_name = :name "
                "ORDER BY column_id",
                {"owner": owner, "name": name},
            )
            cols: list[SchemaColumn] = []
            for row in cur.fetchall():
                col_name, dtype, length, precision, scale, nullable = row
                cols.append(
                    SchemaColumn(
                        name=str(col_name),
                        data_type=_format_oracle_type(dtype, length, precision, scale),
                        nullable=(nullable == "Y"),
                    )
                )
            return cols
    finally:
        conn.close()


def _read_target_columns(job: dict[str, Any]) -> list[SchemaColumn]:
    rows = db.fetch_all(
        "SELECT column_name, data_type, character_maximum_length, "
        "       numeric_precision, numeric_scale, is_nullable "
        "FROM INFORMATION_SCHEMA.COLUMNS "
        "WHERE table_schema = ? AND table_name = ? "
        "  AND column_name NOT LIKE 'lb\\_%' ESCAPE '\\' "
        "ORDER BY ordinal_position",
        (job["target_schema"], job["target_table"]),
    )
    return [
        SchemaColumn(
            name=str(r["column_name"]),
            data_type=_format_sqlserver_type(
                r["data_type"],
                r["character_maximum_length"],
                r["numeric_precision"],
                r["numeric_scale"],
            ),
            nullable=(r["is_nullable"] == "YES"),
        )
        for r in rows
    ]


def _diff_columns(
    src: list[SchemaColumn], tgt: list[SchemaColumn]
) -> list[SchemaMapping]:
    """Match by case-insensitive name. Cast drift is detected only for the
    classic NUMBER(22,6) → DECIMAL(18,4) case; anything else returns
    drift=None unless one side is missing the column entirely."""
    by_src = {c.name.lower(): c for c in src}
    by_tgt = {c.name.lower(): c for c in tgt}
    out: list[SchemaMapping] = []
    for s in src:
        t = by_tgt.get(s.name.lower())
        if t is None:
            out.append(SchemaMapping(src=s, tgt=None, drift="new"))
        else:
            out.append(
                SchemaMapping(
                    src=s,
                    tgt=t,
                    drift="cast" if _looks_like_cast(s.data_type, t.data_type) else None,
                )
            )
    # Target columns the source doesn't have (rare; usually means the
    # staging table accreted a column that should be added back into the
    # source projection).
    for t in tgt:
        if t.name.lower() not in by_src:
            out.append(SchemaMapping(src=None, tgt=t, drift="missing"))
    return out


def _split_owner(qualified: str) -> tuple[str, str]:
    if "." not in qualified:
        return ("", qualified.upper())
    owner, name = qualified.split(".", 1)
    return owner.upper(), name.upper()


def _format_oracle_type(
    dtype: str, length: int | None, precision: int | None, scale: int | None
) -> str:
    dtype = (dtype or "").upper()
    if dtype.startswith(("VARCHAR2", "NVARCHAR2", "CHAR")) and length:
        return f"{dtype}({length})"
    if dtype == "NUMBER":
        if precision and scale:
            return f"NUMBER({precision},{scale})"
        if precision:
            return f"NUMBER({precision})"
        return "NUMBER"
    return dtype


def _format_sqlserver_type(
    dtype: str, length: int | None, precision: int | None, scale: int | None
) -> str:
    dtype = (dtype or "").lower()
    if dtype in {"nvarchar", "varchar", "nchar", "char"} and length:
        return f"{dtype}({length if length > 0 else 'max'})"
    if dtype == "decimal" and precision is not None:
        return f"decimal({precision},{scale or 0})"
    if dtype in {"datetime2", "datetimeoffset", "time"} and scale is not None:
        return f"{dtype}({scale})"
    return dtype


def _looks_like_cast(src_type: str, tgt_type: str) -> bool:
    """Detect classic narrowings: NUMBER(p,s) → decimal(p',s') with smaller p or s."""
    if src_type.upper().startswith("NUMBER(") and tgt_type.lower().startswith("decimal("):
        try:
            sp, ss = src_type[7:-1].split(",")
            tp, ts = tgt_type[8:-1].split(",")
            return int(tp) < int(sp) or int(ts) < int(ss)
        except (ValueError, IndexError):
            return False
    return False


@router.post("/{job_id}/run", status_code=status.HTTP_202_ACCEPTED)
def run_now(
    job_id: int,
    body: RunNowBody,
    user: Annotated[auth.User, Depends(auth.RequireOperator)],
) -> dict[str, int]:
    """Enqueue a run. The scheduler thread picks it up on the next tick.

    For backfill runs, the body must include both `backfill_from` (inclusive
    lower bound) and `backfill_to` (exclusive upper). The runner uses them
    as the WHERE predicate on the source query and does NOT advance the
    live watermark on success — backfills are out-of-band replays.
    """
    job = db.fetch_one(
        "SELECT id, code, enabled, strategy FROM lakebridge.jobs WHERE id = ?",
        (job_id,),
    )
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    if not job["enabled"] and body.run_mode != "backfill":
        raise HTTPException(status.HTTP_409_CONFLICT, "job is disabled")
    if body.run_mode == "backfill":
        if job["strategy"] != "watermark_delta":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "backfill is only valid for watermark_delta jobs",
            )
        if not body.backfill_from or not body.backfill_to:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "backfill requires backfill_from and backfill_to",
            )
        if body.backfill_from >= body.backfill_to:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "backfill_from must be strictly before backfill_to",
            )
    run_id = enqueue_run(
        job_id,
        triggered_by=user.email,
        run_mode=body.run_mode,
        backfill_from=body.backfill_from if body.run_mode == "backfill" else None,
        backfill_to=body.backfill_to if body.run_mode == "backfill" else None,
    )
    auth.audit(
        user,
        "job.run_now",
        str(job["code"]),
        {
            "job_id": job_id,
            "run_id": run_id,
            "run_mode": body.run_mode,
            "backfill_from": body.backfill_from,
            "backfill_to": body.backfill_to,
        },
    )
    return {"run_id": run_id}


@router.post("/{job_id}/disable")
def disable(
    job_id: int,
    user: Annotated[auth.User, Depends(auth.RequireOperator)],
) -> dict[str, bool]:
    job = db.fetch_one("SELECT code FROM lakebridge.jobs WHERE id = ?", (job_id,))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    db.execute(
        "UPDATE lakebridge.jobs SET enabled = 0, updated_at = SYSUTCDATETIME(), "
        "                           updated_by = ? "
        "WHERE id = ?",
        (user.email, job_id),
    )
    auth.audit(user, "job.disable", str(job["code"]), {"job_id": job_id})
    return {"enabled": False}


@router.post("/{job_id}/enable")
def enable(
    job_id: int,
    user: Annotated[auth.User, Depends(auth.RequireOperator)],
) -> dict[str, bool]:
    job = db.fetch_one("SELECT code FROM lakebridge.jobs WHERE id = ?", (job_id,))
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
    db.execute(
        "UPDATE lakebridge.jobs SET enabled = 1, updated_at = SYSUTCDATETIME(), "
        "                           updated_by = ? "
        "WHERE id = ?",
        (user.email, job_id),
    )
    auth.audit(user, "job.enable", str(job["code"]), {"job_id": job_id})
    return {"enabled": True}
