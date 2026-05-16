-- 0008 — Backfill window columns on the runs table
--
-- For watermark_delta jobs, a "backfill" run replays a specific window
-- without advancing the live watermark. The orchestrator passes the
-- window through these columns; the runner uses them as the WHERE
-- predicate on the source query and skips the post-run watermark bump.
--
-- Regular scheduled / manual runs leave these NULL.

IF COL_LENGTH(N'lakebridge.runs', N'backfill_from') IS NULL
BEGIN
    ALTER TABLE lakebridge.runs ADD backfill_from NVARCHAR(80) NULL;
END
GO

IF COL_LENGTH(N'lakebridge.runs', N'backfill_to') IS NULL
BEGIN
    ALTER TABLE lakebridge.runs ADD backfill_to NVARCHAR(80) NULL;
END
GO

-- Refresh the convenience view so the API can read backfill bounds.
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
    r.watermark_after,
    r.backfill_from,
    r.backfill_to
FROM lakebridge.runs r
JOIN lakebridge.jobs j ON j.id = r.job_id;
GO
