# Lakebridge orchestrator

The Python service behind the operator console. Two responsibilities:

1. **HTTP API** the UI calls (`/api/jobs`, `/api/runs/:id`, `/api/dashboard`,
   the SSE stream at `/api/runs/:id/events`, …).
2. **Runner + scheduler** that actually moves IFS Oracle data into the
   SQL Server staging lake on the schedule operators configure.

Both run in the same process by default. There is no separate worker queue
— the database is the queue (`lakebridge.runs.status = 'queued'`), which
is fine for the small audience and single-instance deployment this targets.

## Stack

- Python 3.12, FastAPI, uvicorn
- `python-oracledb` (thin mode — no Oracle Instant Client required)
- `pyodbc` + Microsoft ODBC Driver 18 for SQL Server
- `APScheduler` and `croniter` for the cron loop
- `pydantic-settings` for config, `structlog` for JSON logging
- `sse-starlette` for the `/events` stream

## Running locally

The fastest path is docker-compose, which brings up SQL Server 2022 alongside
the orchestrator and runs migrations automatically:

```bash
cd services/orchestrator
cp .env.example .env       # tweak as needed
docker compose up --build
```

The API will be on `http://localhost:8080`, ready for the UI's
`http://localhost:5173` dev server. The first boot takes ~30s while
SQL Server initialises and migrations run.

### Local Python install

If you'd rather run outside Docker:

```bash
# system deps (Ubuntu)
sudo apt-get install -y unixodbc-dev curl gnupg
# Microsoft ODBC Driver 18 (one-off; see Microsoft docs for current packages)

# project deps
uv sync                       # or: pip install -e ".[dev]"
cp .env.example .env

# migrate then serve
uv run lakebridge-migrate up
uv run lakebridge-serve
```

## Layout

```
lakebridge/
  main.py                FastAPI app + uvicorn entrypoint
  config.py              pydantic-settings (LAKEBRIDGE_* env)
  db.py                  pyodbc connection pool + fetch helpers
  models.py              pydantic types shared by API + runner
  events.py              in-process pub/sub for SSE
  logging.py             structlog wiring
  migrate.py             `lakebridge-migrate {up,status,verify}`
  scheduler.py           cron loop + queue worker, thread-pool dispatch
  api/
    health.py            /api/health · /api/health/ready
    jobs.py              /api/jobs (+ run / disable / enable)
    runs.py              /api/runs/:id (+ steps, errors, cancel, /events SSE)
    sources.py           /api/sources (+ test-connection)
    dashboard.py         /api/dashboard/{kpis,timeline,errors-recent}
    recon.py             /api/recon  (job × last_n recon cells)
    users.py             /api/users
    audit.py             /api/audit
  runner/
    engine.py            connect → count → extract → load → recon → finalize
    persistence.py       default RunStateSink writing to lakebridge.*
    sources/oracle.py    python-oracledb adapter (read-only)
    sinks/sqlserver.py   pyodbc bulk insert (fast_executemany=True)
```

## Testing

```bash
uv run pytest                    # unit tests, no DB needed
uv run ruff check lakebridge     # lint
uv run mypy lakebridge           # type check (strict)
```

The end-to-end integration path (a real Oracle source + real SQL Server)
isn't covered in the unit suite because we can't faithfully mock the IFS
schemas. Use a known-good `IFS-TST` source in a staging deployment.

## Things deliberately not done yet

- **Authentication.** The API is open. Wire OIDC (Okta) at the load
  balancer or as FastAPI middleware before exposing this.
- **Secrets manager.** `LAKEBRIDGE_SECRET_*` env vars stand in for Vault /
  AKV / SM lookups. Replace `os.environ.get(...)` in `api/sources.py` and
  `scheduler._build_job_spec` with a real client.
- **Row-hash reconciliation.** Counts only for the MVP. Hash buckets need
  canonical column ordering between Oracle and SQL Server plus a server-side
  `HASHBYTES('MD5', …)` — the schema is ready (`recon_hash_buckets`).
- **Quarantine table.** The trailer column `lb_quarantined` is written but
  the cast layer doesn't actually quarantine rows yet — failures abort the
  run. Add a per-row try/except in the load step when ready.
- **Backfill ranges.** `run_mode = 'backfill'` accepts the value but treats
  it the same as `manual`. Add a `(from, to)` watermark window before using.
