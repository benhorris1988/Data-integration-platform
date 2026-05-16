-- 0001 — Lakebridge metadata schema and migration ledger
--
-- Creates the `lakebridge` schema (application metadata, lives in the SAME
-- SQL Server instance as the staging lake — `stg_ifs_*` schemas live in
-- their own namespaces) and the ledger the migrate CLI uses to track which
-- scripts have been applied.

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'lakebridge')
    EXEC(N'CREATE SCHEMA lakebridge');
GO

IF OBJECT_ID(N'lakebridge.schema_migrations', N'U') IS NULL
BEGIN
    CREATE TABLE lakebridge.schema_migrations (
        version       INT            NOT NULL PRIMARY KEY,
        name          NVARCHAR(200)  NOT NULL,
        checksum      CHAR(64)       NOT NULL,
        applied_at    DATETIME2(3)   NOT NULL CONSTRAINT DF_lakebridge_schema_migrations_applied_at DEFAULT SYSUTCDATETIME(),
        applied_by    NVARCHAR(128)  NOT NULL CONSTRAINT DF_lakebridge_schema_migrations_applied_by DEFAULT SUSER_SNAME(),
        duration_ms   INT            NOT NULL
    );
END
GO
