# Lakebridge

Internal operator console for moving data from IFS Applications (Oracle-backed ERP) into the staging layer of a SQL Server data lake, en route to SAP ECC 6.0.

Small audience (<12 data engineers and migration leads), runs on corporate networks only, never public-facing.

## Layout

```
docs/
  design/
    lakebridge-ui-brief.md       canonical UI design brief (the source)
    manifest/                    Claude Design output — design reference
      README.md                  handoff doc (tokens, screens, components)
      prototype/                 HTML + Babel-in-the-browser preview
ui/                              React + TS + Vite operator console (live)
```

`services/` and `db/` (orchestrator, extractors, loaders, metadata schema)
will be added once the backend is scoped — see the brief.

## UI

```bash
cd ui && npm install && npm run dev
```

The console implements every screen called out in the brief — Jobs (hero),
Run detail (live timer), Dashboard, Job detail, Sources, Reconciliation,
Settings, Sign-in — plus the design system primitives, dark mode, and a
⌘K command palette. Data is module-scoped fixtures in `ui/src/data/sample.ts`
and gets swapped for real queries once the orchestrator API exists.
