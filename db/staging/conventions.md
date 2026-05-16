# Staging conventions

This document is the contract between the runner and the SQL Server staging
layer. Lakebridge does not own these tables at the schema level — your DBA
provisions them; the runner only writes into them. The conventions are
designed so a new job needs **one** new table and zero application changes.

## Naming

- Schema: `stg_ifs_<domain>` — one per logical area:
  - `stg_ifs_inventory`, `stg_ifs_customer`, `stg_ifs_purchase`,
    `stg_ifs_sales`, `stg_ifs_supplier`, `stg_ifs_finance`, `stg_ifs_mfg`,
    `stg_ifs_pm`, `stg_ifs_hr`, `stg_ifs_meta`.
- Table: `<lower_snake_of_target_concept>`, e.g. `inventory_part`,
  `customer_master`, `po_line_history`.

## Required columns

Every staging table must include this trailer, added to whatever source
columns the job extracts:

| Column                      | Type           | Source                            |
|-----------------------------|----------------|-----------------------------------|
| `lb_run_id`                 | `BIGINT NOT NULL` | `runs.id` of the loading run    |
| `lb_loaded_at`              | `DATETIME2(3) NOT NULL DEFAULT SYSUTCDATETIME()` | runner |
| `lb_source_hash`            | `CHAR(32) NULL` | hex MD5 over the canonical projection of the source row |
| `lb_quarantined`            | `BIT NOT NULL DEFAULT 0` | runner — true when the row was retained but failed a cast |
| `lb_quarantine_reason`      | `NVARCHAR(200) NULL` | runner |

These are the only columns Lakebridge writes that aren't in the source.
They are how the reconciliation step and the audit trail work; if they're
missing the load fails.

## Strategies

| Strategy            | What the runner does to the target table on each run |
|---------------------|------------------------------------------------------|
| `full_snapshot`     | `TRUNCATE TABLE`, then bulk insert all source rows. Use only when the source is small enough that re-reading is cheap. |
| `truncate_and_load` | `TRUNCATE TABLE`, then bulk insert under a transaction. Identical to `full_snapshot` but explicit about destructiveness. |
| `append`            | Bulk insert; never deletes. The source must produce **only new rows** (e.g. immutable history table). Deduplication is the downstream's problem. |
| `watermark_delta`   | Bulk insert rows whose watermark column is strictly greater than the stored watermark, then advance the watermark. The runner reads `lakebridge.watermarks.watermark_value` and writes the new max back atomically with the run finalisation. |

`append` and `watermark_delta` rely on having no destructive interaction with
prior runs — if you need to delete late-arriving rows, write a downstream
materialised view, do not change the staging table.

## Reconciliation

After every run the runner records a `recon_check`:

- `source_count` = `SELECT COUNT(*) FROM <source_object>` at the start of
  the run (with watermark predicate applied where relevant).
- `target_count` = rows in the staging table whose `lb_run_id` matches the
  current run (or whole-table count for full snapshots).
- `result` is derived from variance and the optional row-hash buckets:
  - `ok` — counts match and all hash buckets match.
  - `warn` — variance within `threshold_pct` (default 0.05 %).
  - `fail` — variance above threshold or hash drift on any bucket.

If you want strict matching, override `threshold_pct` to `0` on a per-job
basis (configuration column TBD; for now set in `lakebridge.recon_checks`
manually).

## Example

See `example_stg_ifs_inventory.sql` in this directory for a worked example
of `stg_ifs_inventory.inventory_part`, the target of
`EXT.MAT.MASTER.FULL`.
