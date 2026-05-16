# Lakebridge database

SQL Server 2019+ hosts everything: the application metadata in the
`lakebridge` schema, and the staging lake in `stg_ifs_*` schemas.

## Layout

```
db/
  migrations/        numbered T-SQL applied in order by the migrate CLI
  staging/           conventions + a worked example staging table
```

Migrations are applied with the orchestrator's migration CLI:

```bash
cd services/orchestrator
uv run lakebridge-migrate up         # apply all pending migrations
uv run lakebridge-migrate status     # show applied vs pending
```

See [`services/orchestrator/README.md`](../services/orchestrator/README.md)
for how to configure the connection string.

## Why raw T-SQL, not Alembic / EF migrations

SQL Server idioms (computed columns, `CREATE OR ALTER`, `IF OBJECT_ID … IS NULL`,
`GO` batch separators) are awkward to express through Alembic, which assumes
SQLAlchemy DDL semantics. The migration set is small enough that a numbered
file convention plus a hash-checked ledger is simpler and gives the DBA
exactly the SQL they will read in production.

## Schemas

- `lakebridge` — application metadata (this directory's migrations).
- `stg_ifs_<domain>` — staging tables. **Lakebridge does not own these
  schemas at the DDL level**; the DBA provisions them per
  [`staging/conventions.md`](staging/conventions.md). The runner only
  writes data into them and reads counts/hashes back out.
