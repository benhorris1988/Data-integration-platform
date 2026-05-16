"""/api/dashboard — KPIs + 24h timeline + newest errors."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import db
from ..models import DashboardKPIs

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/kpis", response_model=DashboardKPIs)
def kpis() -> DashboardKPIs:
    """Top four cards on the Overview screen. One DB hit each — small N."""
    runs_24h = int(
        (db.fetch_one(
            "SELECT COUNT(*) AS n FROM lakebridge.runs "
            "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME())"
        ) or {"n": 0})["n"]
    )
    success_row = db.fetch_one(
        "SELECT "
        "  COUNT(*) AS total, "
        "  SUM(CASE WHEN status = N'succeeded' THEN 1 ELSE 0 END) AS ok "
        "FROM lakebridge.runs "
        "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME()) "
        "  AND status IN (N'succeeded', N'failed', N'cancelled')"
    ) or {"total": 0, "ok": 0}
    total = int(success_row["total"] or 0)
    ok = int(success_row["ok"] or 0)
    success_rate = (ok / total * 100.0) if total else 100.0

    rows_landed = int(
        (db.fetch_one(
            "SELECT ISNULL(SUM(rows_loaded), 0) AS n FROM lakebridge.runs "
            "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME()) "
            "  AND status = N'succeeded'"
        ) or {"n": 0})["n"]
    )

    job_row = db.fetch_one(
        "SELECT "
        "  SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS active, "
        "  SUM(CASE WHEN enabled = 0 THEN 1 ELSE 0 END) AS paused "
        "FROM lakebridge.jobs"
    ) or {"active": 0, "paused": 0}

    series_runs = _hourly_count(
        "SELECT DATEDIFF(HOUR, triggered_at, SYSUTCDATETIME()) AS bucket, COUNT(*) AS n "
        "FROM lakebridge.runs "
        "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME()) "
        "GROUP BY DATEDIFF(HOUR, triggered_at, SYSUTCDATETIME())",
        buckets=24,
    )
    series_rows = _hourly_count(
        "SELECT DATEDIFF(HOUR, triggered_at, SYSUTCDATETIME()) AS bucket, "
        "       ISNULL(SUM(rows_loaded), 0) AS n "
        "FROM lakebridge.runs "
        "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME()) "
        "  AND status = N'succeeded' "
        "GROUP BY DATEDIFF(HOUR, triggered_at, SYSUTCDATETIME())",
        buckets=24,
    )
    # Per-hour success rate and active jobs are computed-on-the-fly placeholders.
    series_success = [int(success_rate)] * 24
    series_active = [int(job_row["active"] or 0)] * 24

    return DashboardKPIs(
        runs_24h=runs_24h,
        success_rate_pct=round(success_rate, 1),
        rows_landed_24h=rows_landed,
        active_jobs=int(job_row["active"] or 0),
        paused_jobs=int(job_row["paused"] or 0),
        series_runs=series_runs,
        series_success=series_success,
        series_rows=series_rows,
        series_active=series_active,
    )


@router.get("/timeline")
def timeline() -> list[dict[str, Any]]:
    """24h activity strip — one entry per run, oldest-first."""
    rows = db.fetch_all(
        "SELECT id, job_code, status, "
        "       DATEDIFF(SECOND, started_at, ISNULL(finished_at, SYSUTCDATETIME())) AS dur_sec, "
        "       triggered_at "
        "FROM lakebridge.v_runs_with_job "
        "WHERE triggered_at >= DATEADD(HOUR, -24, SYSUTCDATETIME()) "
        "ORDER BY triggered_at"
    )
    return rows


@router.get("/errors-recent")
def errors_recent(limit: int = 10) -> list[dict[str, Any]]:
    return db.fetch_all(
        f"SELECT TOP {limit} re.id, re.run_id, re.severity, re.code, re.message, "
        "       re.captured_at, j.code AS job_code "
        "FROM lakebridge.run_errors re "
        "JOIN lakebridge.runs r ON r.id = re.run_id "
        "JOIN lakebridge.jobs j ON j.id = r.job_id "
        "ORDER BY re.captured_at DESC"
    )


def _hourly_count(sql: str, buckets: int) -> list[int]:
    rows = db.fetch_all(sql)
    indexed = {int(r["bucket"]): int(r["n"]) for r in rows}
    # Oldest hour first, "now" last — matches sparkline left-to-right reading.
    return [indexed.get(buckets - 1 - i, 0) for i in range(buckets)]
