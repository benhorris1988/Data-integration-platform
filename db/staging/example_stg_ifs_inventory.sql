-- Example staging schema and table for EXT.MAT.MASTER.FULL.
--
-- This is illustrative — Lakebridge does NOT create these objects itself.
-- Hand it to the DBA when commissioning a new job; mirror the pattern for
-- every new staging table.
--
-- Source: IFSAPP.INVENTORY_PART_TAB (Oracle 19c, IFS-PRD-EU)
-- Strategy: full_snapshot, daily at 06:00 UTC.

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'stg_ifs_inventory')
    EXEC(N'CREATE SCHEMA stg_ifs_inventory');
GO

IF OBJECT_ID(N'stg_ifs_inventory.inventory_part', N'U') IS NULL
BEGIN
    CREATE TABLE stg_ifs_inventory.inventory_part (
        -- ── projected from the source ──────────────────────────────────
        part_no                 NVARCHAR(25)   NOT NULL,
        description             NVARCHAR(200)  NULL,
        unit_meas               NVARCHAR(10)   NULL,
        gross_weight            DECIMAL(15,6)  NULL,
        net_weight              DECIMAL(15,6)  NULL,
        part_status             NCHAR(1)       NULL,
        planner_buyer           NVARCHAR(20)   NULL,
        configurable_db         NVARCHAR(20)   NULL,
        rowversion              BIGINT         NULL,
        contract                NVARCHAR(5)    NULL,
        created_by              NVARCHAR(30)   NULL,
        created_date            DATETIME2(0)   NULL,
        modified_date           DATETIME2(0)   NULL,
        std_cost                DECIMAL(18,4)  NULL,                 -- NUMBER(22,6) source → narrowed (see drift)
        provide                 NVARCHAR(20)   NULL,

        -- ── Lakebridge trailer (see conventions.md) ────────────────────
        lb_run_id               BIGINT         NOT NULL,
        lb_loaded_at            DATETIME2(3)   NOT NULL CONSTRAINT DF_inventory_part_loaded DEFAULT SYSUTCDATETIME(),
        lb_source_hash          CHAR(32)       NULL,
        lb_quarantined          BIT            NOT NULL CONSTRAINT DF_inventory_part_quar    DEFAULT 0,
        lb_quarantine_reason    NVARCHAR(200)  NULL,

        CONSTRAINT PK_stg_ifs_inventory_part PRIMARY KEY (part_no, contract)
    );

    CREATE INDEX IX_inventory_part_run     ON stg_ifs_inventory.inventory_part (lb_run_id);
    CREATE INDEX IX_inventory_part_quar    ON stg_ifs_inventory.inventory_part (lb_quarantined)
        WHERE lb_quarantined = 1;
END
GO
