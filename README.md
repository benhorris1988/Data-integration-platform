# Lakebridge

Internal operator console for moving data from IFS Applications (Oracle-backed ERP) into the staging layer of a SQL Server data lake, en route to SAP ECC 6.0.

Small audience (<12 data engineers and migration leads), runs on corporate networks only, never public-facing.

## Status

Pre-implementation. The UI design brief lives in [`docs/design/lakebridge-ui-brief.md`](docs/design/lakebridge-ui-brief.md) and is the source of truth for the operator console look-and-feel. The UI itself will be produced via Claude Design from that brief; the resulting React manifest will land in this repo once delivered.

## Layout (planned)

```
docs/                Design briefs, ADRs, runbooks
ui/                  React operator console (Claude Design output)
services/            Lakebridge orchestrator, extractors, loaders
db/                  Migrations and schema for the platform's own metadata
```

Nothing below `ui/` or `services/` exists yet — the repo currently holds the design brief and this README only.
