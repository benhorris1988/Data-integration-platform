// Types mirroring `services/orchestrator/lakebridge/models.py`. The orchestrator
// returns Pydantic-serialised JSON; these are the wire shapes.
//
// Hand-maintained for now. If drift becomes a problem, generate from the
// FastAPI OpenAPI spec with `openapi-typescript`.

export type RunStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type Strategy =
  | 'full_snapshot'
  | 'append'
  | 'watermark_delta'
  | 'truncate_and_load';

export type SourceStatus = 'ok' | 'degraded' | 'failed';
export type StepName =
  | 'connect'
  | 'count'
  | 'extract'
  | 'load'
  | 'recon'
  | 'finalize';
export type StepStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped';
export type Severity = 'error' | 'warn';
export type ReconResult = 'ok' | 'warn' | 'fail';
export type Role = 'Admin' | 'Operator' | 'Read-only';
export type RunMode = 'scheduled' | 'manual' | 'backfill';

export type ApiSource = {
  id: string;
  host: string;
  port: number;
  sid: string;
  service_name: string | null;
  oracle_version: string | null;
  username: string;
  secret_ref: string;
  tls_required: boolean;
  pool_size: number;
  status: SourceStatus;
  last_tested_at: string | null;
  last_test_msg: string | null;
};

export type ApiJob = {
  id: number;
  code: string;
  source_id: string;
  source_object: string;
  target_schema: string;
  target_table: string;
  strategy: Strategy;
  schedule: string;
  watermark_column: string | null;
  batch_size: number;
  retries: number;
  timeout_sec: number;
  owner: string;
  enabled: boolean;
  pinned: boolean;
};

export type ApiJobListItem = {
  id: number;
  code: string;
  source_id: string;
  source_object: string;
  target_schema: string;
  target_table: string;
  strategy: Strategy;
  schedule: string;
  owner: string;
  enabled: boolean;
  pinned: boolean;
  last_run_id: number | null;
  last_run_status: RunStatus | null;
  last_run_finished_at: string | null;
  last_run_rows: number | null;
};

export type ApiRun = {
  id: number;
  job_id: number;
  job_code: string;
  status: RunStatus;
  triggered_by: string;
  triggered_at: string;
  started_at: string | null;
  finished_at: string | null;
  duration_sec: number | null;
  run_mode: RunMode;
  rows_loaded: number;
  error_count: number;
  watermark_before: string | null;
  watermark_after: string | null;
};

export type ApiRunStep = {
  run_id: number;
  step_no: number;
  step_name: StepName;
  status: StepStatus;
  started_at: string | null;
  finished_at: string | null;
  duration_sec: number | null;
  progress_pct: number;
  rows_processed: number;
  message: string | null;
};

export type ApiRunError = {
  id: number;
  run_id: number;
  severity: Severity;
  code: string;
  step_name: StepName | null;
  message: string;
  source_pk: string | null;
  payload_json: string | null;
  captured_at: string;
};

export type ApiReconCheck = {
  id: number;
  run_id: number;
  job_id: number;
  source_count: number;
  target_count: number;
  variance_rows: number;
  checksum_match: boolean;
  result: ReconResult;
  threshold_pct: number;
  computed_at: string;
};

export type ApiUser = {
  id: number;
  sso_subject: string;
  email: string;
  name: string;
  role: Role;
  mfa_enabled: boolean;
  disabled: boolean;
  last_active_at: string | null;
};

export type ApiAuditEntry = {
  id: number;
  ts: string;
  actor: string;
  action: string;
  target: string;
  metadata_json: string | null;
  request_id: string | null;
};

export type ApiDashboardKpis = {
  runs_24h: number;
  success_rate_pct: number;
  rows_landed_24h: number;
  active_jobs: number;
  paused_jobs: number;
  series_runs: number[];
  series_success: number[];
  series_rows: number[];
  series_active: number[];
};

export type ApiTimelineEntry = {
  id: number;
  job_code: string;
  status: RunStatus | 'warning';
  dur_sec: number | null;
  triggered_at: string;
};

export type ApiRecentError = {
  id: number;
  run_id: number;
  severity: Severity;
  code: string;
  message: string;
  captured_at: string;
  job_code: string;
};

export type ApiReconRow = {
  job: {
    job_id: number;
    code: string;
    target_schema: string;
    target_table: string;
  };
  cells: ApiReconCheck[];
};

export type ApiTestConnectionResult = {
  ok: boolean;
  latency_ms: number;
  message: string;
};
