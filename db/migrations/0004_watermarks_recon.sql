-- 0004 — Watermarks (one row per job) and reconciliation checks
--
-- `watermarks` is the source of truth for "how far have we caught up?" on
-- watermark_delta jobs. It is updated atomically inside the same transaction
-- that finalises a successful run. `recon_checks` records each run's source
-- vs target counts and optional row-hash buckets, so the Reconciliation UI
-- can render the matrix without recomputing.

IF OBJECT_ID(N'lakebridge.watermarks', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.watermarks (
        job_id              BIGINT          NOT NULL PRIMARY KEY,
        watermark_column    NVARCHAR(80)    NOT NULL,
        watermark_value     NVARCHAR(80)    NOT NULL,                -- ISO 8601 for datetimes; raw string for surrogate keys
        advanced_by_run_id  BIGINT          NULL,
        advanced_at         DATETIME2(3)    NOT NULL CONSTRAINT DF_watermarks_advanced DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_watermarks_job FOREIGN KEY (job_id) REFERENCES lakebridge.jobs(id) ON DELETE CASCADE,
        CONSTRAINT FK_watermarks_run FOREIGN KEY (advanced_by_run_id) REFERENCES lakebridge.runs(id)
    );
END
GO

IF OBJECT_ID(N'lakebridge.recon_checks', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.recon_checks (
        id                  BIGINT          IDENTITY(1,1) NOT NULL PRIMARY KEY,
        run_id              BIGINT          NOT NULL,
        job_id              BIGINT          NOT NULL,
        source_count        BIGINT          NOT NULL,
        target_count        BIGINT          NOT NULL,
        variance_rows       AS (source_count - target_count) PERSISTED,
        checksum_match      BIT             NOT NULL,
        result              NVARCHAR(10)    NOT NULL,                -- 'ok' | 'warn' | 'fail'
        threshold_pct       DECIMAL(6,4)    NOT NULL CONSTRAINT DF_recon_threshold DEFAULT 0.0005,
        computed_at         DATETIME2(3)    NOT NULL CONSTRAINT DF_recon_computed DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_recon_run FOREIGN KEY (run_id) REFERENCES lakebridge.runs(id) ON DELETE CASCADE,
        CONSTRAINT FK_recon_job FOREIGN KEY (job_id) REFERENCES lakebridge.jobs(id),
        CONSTRAINT CK_recon_result CHECK (result IN (N'ok', N'warn', N'fail'))
    );

    CREATE INDEX IX_recon_job_recent
        ON lakebridge.recon_checks (job_id, computed_at DESC) INCLUDE (result, variance_rows);
END
GO

IF OBJECT_ID(N'lakebridge.recon_hash_buckets', N'U') IS NULL
BEGIN
    -- Optional row-hash check, one bucket per hex prefix. Cheap to compute
    -- and gives the UI a 4-row 00–3F / 40–7F / 80–BF / C0–FF readout.
    CREATE TABLE lakebridge.recon_hash_buckets (
        recon_id        BIGINT          NOT NULL,
        bucket          NVARCHAR(10)    NOT NULL,
        source_hash     CHAR(32)        NOT NULL,                    -- hex MD5 of concat(sorted row hashes)
        target_hash     CHAR(32)        NOT NULL,
        matched         AS CAST(IIF(source_hash = target_hash, 1, 0) AS BIT) PERSISTED,
        CONSTRAINT PK_recon_hash_buckets PRIMARY KEY (recon_id, bucket),
        CONSTRAINT FK_recon_hash_buckets_recon
            FOREIGN KEY (recon_id) REFERENCES lakebridge.recon_checks(id) ON DELETE CASCADE
    );
END
GO
