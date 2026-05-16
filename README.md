# Lakebridge

Internal operator console for moving data from IFS Applications (Oracle-backed ERP) into the staging layer of a SQL Server data lake, en route to SAP ECC 6.0.

Small audience (<12 data engineers and migration leads), runs on corporate networks only, never public-facing.

## Layout

```
docs/
  design/
    lakebridge-ui-brief.md       canonical UI design brief (the source)
    manifest/                    Claude Design output — design reference
db/
  migrations/                    numbered T-SQL applied in order
  staging/                       conventions + a worked example
services/
  orchestrator/                  Python 3.12 + FastAPI service:
                                   API the UI calls, runner that moves IFS
                                   data, scheduler that fires cron jobs
ui/                              React + TS + Vite operator console
```

## Running the whole thing locally

```bash
# 1. SQL Server + orchestrator
cd services/orchestrator
cp .env.example .env
docker compose up --build       # API on :8080, migrations auto-applied

# 2. UI (separate terminal)
cd ui && npm install && npm run dev   # :5173, talks to the API above
```

## Components

- **UI** — every screen the brief calls out, dark mode, ⌘K command palette.
  See [`ui/README.md`](ui/README.md).
- **DB** — single SQL Server instance hosts both `lakebridge.*` metadata
  and `stg_ifs_*.*` staging tables. See [`db/README.md`](db/README.md).
- **Orchestrator** — FastAPI API + cron + queue worker + extraction engine
  (Oracle → SQL Server via python-oracledb + pyodbc). See
  [`services/orchestrator/README.md`](services/orchestrator/README.md).
