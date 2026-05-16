"""Pydantic models shared by the API and the runner."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RunStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]
Strategy = Literal["full_snapshot", "append", "watermark_delta", "truncate_and_load"]
SourceStatus = Literal["ok", "degraded", "failed"]
StepName = Literal["connect", "count", "extract", "load", "recon", "finalize"]
StepStatus = Literal["pending", "running", "succeeded", "failed", "skipped"]
Severity = Literal["error", "warn"]
ReconResult = Literal["ok", "warn", "fail"]
Role = Literal["Admin", "Operator", "Read-only"]


class _Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Source(_Base):
    id: str
    host: str
    port: int
    sid: str
    service_name: str | None = None
    oracle_version: str | None = None
    username: str
    secret_ref: str
    tls_required: bool
    pool_size: int
    status: SourceStatus
    last_tested_at: datetime | None = None
    last_test_msg: str | None = None


class Job(_Base):
    id: int
    code: str
    source_id: str
    source_object: str
    target_schema: str
    target_table: str
    strategy: Strategy
    schedule: str
    watermark_column: str | None = None
    batch_size: int
    retries: int
    timeout_sec: int
    owner: str
    enabled: bool
    pinned: bool


class JobListItem(_Base):
    """The shape the Jobs index renders. Mirrors `v_jobs_with_last_run`."""

    id: int
    code: str
    source_id: str
    source_object: str
    target_schema: str
    target_table: str
    strategy: Strategy
    schedule: str
    owner: str
    enabled: bool
    pinned: bool
    last_run_id: int | None = None
    last_run_status: RunStatus | None = None
    last_run_finished_at: datetime | None = None
    last_run_rows: int | None = None


class Run(_Base):
    id: int
    job_id: int
    job_code: str
    status: RunStatus
    triggered_by: str
    triggered_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_sec: int | None = None
    run_mode: Literal["scheduled", "manual", "backfill"]
    rows_loaded: int
    error_count: int
    watermark_before: str | None = None
    watermark_after: str | None = None


class RunStep(_Base):
    run_id: int
    step_no: int = Field(ge=1, le=6)
    step_name: StepName
    status: StepStatus
    started_at: datetime | None = None
    finished_at: datetime | None = None
    duration_sec: float | None = None
    progress_pct: int = Field(ge=0, le=100)
    rows_processed: int
    message: str | None = None


class RunError(_Base):
    id: int
    run_id: int
    severity: Severity
    code: str
    step_name: StepName | None = None
    message: str
    source_pk: str | None = None
    payload_json: str | None = None
    captured_at: datetime


class ReconCheck(_Base):
    id: int
    run_id: int
    job_id: int
    source_count: int
    target_count: int
    variance_rows: int
    checksum_match: bool
    result: ReconResult
    threshold_pct: float
    computed_at: datetime


class User(_Base):
    id: int
    sso_subject: str
    email: str
    name: str
    role: Role
    mfa_enabled: bool
    disabled: bool
    last_active_at: datetime | None = None


class AuditEntry(_Base):
    id: int
    ts: datetime
    actor: str
    action: str
    target: str
    metadata_json: str | None = None
    request_id: str | None = None


# ── API request/response wrappers ─────────────────────────────────────────


class RunTriggerRequest(BaseModel):
    # `triggered_by` is resolved from the session by the server; clients
    # cannot impersonate other users.
    run_mode: Literal["manual", "backfill"] = "manual"


class TestConnectionResult(BaseModel):
    ok: bool
    latency_ms: int
    message: str


class DashboardKPIs(BaseModel):
    runs_24h: int
    success_rate_pct: float
    rows_landed_24h: int
    active_jobs: int
    paused_jobs: int
    series_runs: list[int]
    series_success: list[int]
    series_rows: list[int]
    series_active: list[int]
