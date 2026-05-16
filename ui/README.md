# Lakebridge UI

Operator console for moving IFS data into the SQL Server staging layer. Built
from the design handoff in [`../docs/design/manifest`](../docs/design/manifest)
which itself was produced from the brief in
[`../docs/design/lakebridge-ui-brief.md`](../docs/design/lakebridge-ui-brief.md).

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS (palette + type scale wired into `tailwind.config.js`)
- `lucide-react` for icons
- `@tanstack/react-query` for fetching, caching, polling and request dedup
- `recharts` is installed but not yet used — the sparklines and 24h timeline
  are bespoke SVG. Wire `recharts` in if/when those grow beyond what inline
  SVG can show.

## Scripts

```bash
npm install            # install deps
npm run dev            # vite dev server on :5173
npm run build          # type-check then bundle
npm run preview        # serve the production build locally
```

## Running against a real backend

The dev server proxies `/api/*` to the orchestrator at
`http://localhost:8080`. Bring it up first:

```bash
cd ../services/orchestrator
docker compose up --build           # SQL Server 2022 + orchestrator + migrations
```

then `npm run dev` here. The UI binds to the API for every screen — Jobs,
Run detail (with live SSE for the in-flight timer), Dashboard, Sources,
Reconciliation, Settings/Users, Audit.

Override the proxy target with `LAKEBRIDGE_API_URL` in `.env` (or set
`VITE_API_BASE_URL` to an absolute URL if you want the bundle to skip the
proxy and hit the API directly).

## Layout

```
src/
  App.tsx                    shell · sidebar · top bar · command palette · routing
  main.tsx                   QueryClientProvider + mount
  index.css                  Tailwind + scrollbars + keyframes
  lib/
    cx.ts                    class-name joiner
    icons.tsx                lucide-react re-exports under the `I.foo` key map
  api/
    client.ts                fetch wrapper + EventSource subscribe()
    queries.ts               TanStack Query hooks per endpoint
    types.ts                 wire shapes mirroring lakebridge/models.py
    format.ts                relative time, int grouping, durations
  components/primitives.tsx  Button · StatusBadge · Tag · Input · Select · Tabs
                             · EmptyState · Skeleton · InlineBanner · ThSort
                             · ToastProvider/useToast · Kbd · DropdownMenu
                             · Sparkline · Hint · LakebridgeMark
  screens/
    Jobs.tsx                 hero screen — jobs table with filters, run-now,
                              enable/disable, loading + error + empty states
    Run.tsx                  live run detail — step timeline, errors with
                              JSON detail, SSE-driven updates while in flight
    Dashboard.tsx            KPIs · 24h timeline · strategy mix · errors
    Misc.tsx                 Job detail · Sources · Recon · Settings · Sign-in
```

## Authentication

Sign-in state is driven entirely by `GET /api/me`. On load:

- 200 → render the app shell with the returned user.
- 401 → render the `<SignIn />` screen.

The Sign-in screen reads `GET /api/auth/config` and renders the path the
orchestrator advertises:

- `mode: "oidc"` → "Continue with Okta" button that redirects to
  `/api/auth/login?return_to=…`.
- `mode: "dev"` → a dropdown of seeded users and a "Continue as …" button
  that POSTs to `/api/auth/dev-session`.
- `mode: "disabled"` → not rendered (the call to `/api/me` already
  succeeded as the built-in Admin).

Buttons that mutate state (Run now, Disable, Test connection, Cancel run)
are disabled for `Read-only` users with a tooltip explaining why. The
Settings page hides the Users + Audit tabs unless the operator is Admin.

The fetch wrapper sends `credentials: 'include'` so the session cookie
goes with every request. 401s anywhere bubble up as TanStack Query errors;
the App-level `useMe()` is the source of truth and re-routes to Sign-in.

## What's deliberately not wired yet

- **Schema introspection.** The Job detail Schema tab links to a planned
  `/api/jobs/:id/schema` endpoint (Oracle USER_TAB_COLUMNS + SQL Server
  INFORMATION_SCHEMA diff).
- **Source object discovery.** Sources screen has a "discovery pending"
  notice; needs a `/api/sources/:id/objects` endpoint.
- **Raw log streaming.** Run detail Log tab is a placeholder; the
  orchestrator's structlog output isn't tailable via HTTP yet.
- **Watermark history.** The current watermark is shown on Job detail;
  a per-run advance history needs `/api/jobs/:id/watermark-history`.
