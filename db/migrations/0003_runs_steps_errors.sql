-- 0003 — Runs, step timeline, and captured errors
--
-- A `run` is one execution of a `job`. Steps mirror the six-phase pipeline
-- (connect / count / extract / load / recon / finalize). Errors and warnings
-- the runner captures are written to `run_errors`; high-volume detail goes
-- into `payload_json` rather than separate columns so we can evolve without
-- migrations every time the runner gets a new diagnostic.

IF OBJECT_ID(N'lakebridge.runs', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.runs (
        id                  BIGINT          IDENTITY(8000,1) NOT NULL PRIMARY KEY,
        job_id              BIGINT          NOT NULL,
        status              NVARCHAR(20)    NOT NULL,
        triggered_by        NVARCHAR(120)   NOT NULL,                -- 'priya.iyer' or 'scheduler'
        triggered_at        DATETIME2(3)    NOT NULL CONSTRAINT DF_runs_triggered DEFAULT SYSUTCDATETIME(),
        started_at          DATETIME2(3)    NULL,
        finished_at         DATETIME2(3)    NULL,
        duration_sec        AS DATEDIFF(SECOND, started_at, finished_at) PERSISTED,
        run_mode            NVARCHAR(20)    NOT NULL CONSTRAINT DF_runs_mode DEFAULT N'scheduled',
        rows_loaded         BIGINT          NOT NULL CONSTRAINT DF_runs_rows DEFAULT 0,
        error_count         INT             NOT NULL CONSTRAINT DF_runs_errs DEFAULT 0,
        watermark_before    NVARCHAR(80)    NULL,                    -- string for portability (datetime/string/numeric)
        watermark_after     NVARCHAR(80)    NULL,
        cancel_requested    BIT             NOT NULL CONSTRAINT DF_runs_cancel DEFAULT 0,
        CONSTRAINT FK_runs_job  FOREIGN KEY (job_id) REFERENCES lakebridge.jobs(id),
        CONSTRAINT CK_runs_status
            CHECK (status IN (N'queued', N'running', N'succeeded', N'failed', N'cancelled')),
        CONSTRAINT CK_runs_mode
            CHECK (run_mode IN (N'scheduled', N'manual', N'backfill'))
    );

    CREATE INDEX IX_runs_job_triggered
        ON lakebridge.runs (job_id, triggered_at DESC) INCLUDE (status, rows_loaded);
    CREATE INDEX IX_runs_status_recent
        ON lakebridge.runs (status, triggered_at DESC)
        WHERE status IN (N'running', N'queued');
END
GO

IF OBJECT_ID(N'lakebridge.run_steps', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.run_steps (
        run_id          BIGINT          NOT NULL,
        step_no         TINYINT         NOT NULL,                    -- 1..6
        step_name       NVARCHAR(20)    NOT NULL,
        status          NVARCHAR(20)    NOT NULL,
        started_at      DATETIME2(3)    NULL,
        finished_at     DATETIME2(3)    NULL,
        duration_sec    AS CAST(DATEDIFF(MILLISECOND, started_at, finished_at) AS DECIMAL(12,3)) / 1000.0 PERSISTED,
        progress_pct    TINYINT         NOT NULL CONSTRAINT DF_run_steps_progress DEFAULT 0,
        rows_processed  BIGINT          NOT NULL CONSTRAINT DF_run_steps_rows DEFAULT 0,
        message         NVARCHAR(400)   NULL,
        CONSTRAINT PK_run_steps PRIMARY KEY (run_id, step_no),
        CONSTRAINT FK_run_steps_run FOREIGN KEY (run_id) REFERENCES lakebridge.runs(id) ON DELETE CASCADE,
        CONSTRAINT CK_run_steps_name
            CHECK (step_name IN (N'connect', N'count', N'extract', N'load', N'recon', N'finalize')),
        CONSTRAINT CK_run_steps_status
            CHECK (status IN (N'pending', N'running', N'succeeded', N'failed', N'skipped'))
    );
END
GO

IF OBJECT_ID(N'lakebridge.run_errors', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.run_errors (
        id              BIGINT          IDENTITY(1,1) NOT NULL PRIMARY KEY,
        run_id          BIGINT          NOT NULL,
        severity        NVARCHAR(10)    NOT NULL,                    -- 'error' | 'warn'
        code            NVARCHAR(40)    NOT NULL,                    -- 'ORA-12541', 'LB-CAST-FAIL', …
        step_name       NVARCHAR(20)    NULL,
        message         NVARCHAR(2000)  NOT NULL,
        source_pk       NVARCHAR(120)   NULL,
        payload_json    NVARCHAR(MAX)   NULL,                        -- structured detail (stack, target column, attempt)
        captured_at     DATETIME2(3)    NOT NULL CONSTRAINT DF_run_errors_captured DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_run_errors_run FOREIGN KEY (run_id) REFERENCES lakebridge.runs(id) ON DELETE CASCADE,
        CONSTRAINT CK_run_errors_severity CHECK (severity IN (N'error', N'warn'))
    );

    CREATE INDEX IX_run_errors_run_captured
        ON lakebridge.run_errors (run_id, captured_at DESC) INCLUDE (severity, code);
    CREATE INDEX IX_run_errors_code_recent
        ON lakebridge.run_errors (code, captured_at DESC);
END
GO
