-- 0006 — Convenience views the API uses
--
-- These views centralise the "join shape" the operator console queries
-- repeatedly: jobs joined to their last run, runs joined to their job code.
-- Keeping them as views means the application code stays simple and the
-- DBA has a single place to optimise.

CREATE OR ALTER VIEW lakebridge.v_jobs_with_last_run
AS
SELECT
    j.id,
    j.code,
    j.source_id,
    j.source_object,
    j.target_schema,
    j.target_table,
    j.strategy,
    j.schedule,
    j.owner,
    j.enabled,
    j.pinned,
    last_run.id           AS last_run_id,
    last_run.status       AS last_run_status,
    last_run.finished_at  AS last_run_finished_at,
    last_run.rows_loaded  AS last_run_rows
FROM lakebridge.jobs j
OUTER APPLY (
    SELECT TOP 1 r.id, r.status, r.finished_at, r.rows_loaded
    FROM lakebridge.runs r
    WHERE r.job_id = j.id
    ORDER BY r.triggered_at DESC
) AS last_run;
GO

CREATE OR ALTER VIEW lakebridge.v_runs_with_job
AS
SELECT
    r.id,
    r.job_id,
    j.code              AS job_code,
    j.source_id,
    j.source_object,
    j.target_schema,
    j.target_table,
    j.strategy,
    r.status,
    r.triggered_by,
    r.triggered_at,
    r.started_at,
    r.finished_at,
    r.duration_sec,
    r.run_mode,
    r.rows_loaded,
    r.error_count,
    r.watermark_before,
    r.watermark_after
FROM lakebridge.runs r
JOIN lakebridge.jobs j ON j.id = r.job_id;
GO
