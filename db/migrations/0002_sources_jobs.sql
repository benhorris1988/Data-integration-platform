-- 0002 — Source systems and job definitions
--
-- `sources` is the set of IFS Oracle instances Lakebridge can read from.
-- `jobs` is the unit of scheduling: one job extracts one source object into
-- one staging table under one strategy. Codes are dotted and uppercase, e.g.
-- EXT.MAT.MASTER.FULL — they're the operator's primary handle on a job.

IF OBJECT_ID(N'lakebridge.sources', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.sources (
        id              NVARCHAR(40)    NOT NULL PRIMARY KEY,        -- 'IFS-PRD-EU'
        host            NVARCHAR(200)   NOT NULL,
        port            INT             NOT NULL CONSTRAINT DF_sources_port DEFAULT 1521,
        sid             NVARCHAR(60)    NOT NULL,
        service_name    NVARCHAR(120)   NULL,                        -- alt to SID; either is acceptable
        oracle_version  NVARCHAR(40)    NULL,
        username        NVARCHAR(60)    NOT NULL,
        secret_ref      NVARCHAR(200)   NOT NULL,                    -- vault path; never store passwords here
        tls_required    BIT             NOT NULL CONSTRAINT DF_sources_tls DEFAULT 1,
        pool_size       INT             NOT NULL CONSTRAINT DF_sources_pool DEFAULT 8,
        status          NVARCHAR(20)    NOT NULL CONSTRAINT DF_sources_status DEFAULT N'ok',
        last_tested_at  DATETIME2(3)    NULL,
        last_test_msg   NVARCHAR(400)   NULL,
        created_at      DATETIME2(3)    NOT NULL CONSTRAINT DF_sources_created DEFAULT SYSUTCDATETIME(),
        created_by      NVARCHAR(128)   NOT NULL,
        updated_at      DATETIME2(3)    NOT NULL CONSTRAINT DF_sources_updated DEFAULT SYSUTCDATETIME(),
        updated_by      NVARCHAR(128)   NOT NULL,
        CONSTRAINT CK_sources_status CHECK (status IN (N'ok', N'degraded', N'failed'))
    );
END
GO

IF OBJECT_ID(N'lakebridge.jobs', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.jobs (
        id                  BIGINT          IDENTITY(1,1) NOT NULL PRIMARY KEY,
        code                NVARCHAR(120)   NOT NULL,                -- 'EXT.MAT.MASTER.FULL'
        source_id           NVARCHAR(40)    NOT NULL,
        source_object       NVARCHAR(240)   NOT NULL,                -- 'IFSAPP.INVENTORY_PART_TAB'
        source_query        NVARCHAR(MAX)   NULL,                    -- optional override; NULL = SELECT * FROM source_object
        target_schema       NVARCHAR(80)    NOT NULL,                -- 'stg_ifs_inventory'
        target_table        NVARCHAR(80)    NOT NULL,                -- 'inventory_part'
        strategy            NVARCHAR(40)    NOT NULL,
        schedule            NVARCHAR(60)    NOT NULL CONSTRAINT DF_jobs_schedule DEFAULT N'manual',
        watermark_column    NVARCHAR(80)    NULL,                    -- required for watermark_delta
        watermark_grace_sec INT             NOT NULL CONSTRAINT DF_jobs_grace DEFAULT 300,
        batch_size          INT             NOT NULL CONSTRAINT DF_jobs_batch DEFAULT 5000,
        retries             INT             NOT NULL CONSTRAINT DF_jobs_retries DEFAULT 3,
        timeout_sec         INT             NOT NULL CONSTRAINT DF_jobs_timeout DEFAULT 2700,
        owner               NVARCHAR(120)   NOT NULL,
        enabled             BIT             NOT NULL CONSTRAINT DF_jobs_enabled DEFAULT 1,
        pinned              BIT             NOT NULL CONSTRAINT DF_jobs_pinned DEFAULT 0,
        created_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_jobs_created DEFAULT SYSUTCDATETIME(),
        created_by          NVARCHAR(128)   NOT NULL,
        updated_at          DATETIME2(3)    NOT NULL CONSTRAINT DF_jobs_updated DEFAULT SYSUTCDATETIME(),
        updated_by          NVARCHAR(128)   NOT NULL,
        CONSTRAINT UQ_jobs_code UNIQUE (code),
        CONSTRAINT FK_jobs_source
            FOREIGN KEY (source_id) REFERENCES lakebridge.sources(id),
        CONSTRAINT CK_jobs_strategy
            CHECK (strategy IN (N'full_snapshot', N'append', N'watermark_delta', N'truncate_and_load')),
        CONSTRAINT CK_jobs_watermark
            -- watermark_delta requires a watermark column
            CHECK (strategy <> N'watermark_delta' OR watermark_column IS NOT NULL)
    );

    CREATE INDEX IX_jobs_source_id   ON lakebridge.jobs (source_id);
    CREATE INDEX IX_jobs_enabled     ON lakebridge.jobs (enabled) INCLUDE (code, schedule);
END
GO
