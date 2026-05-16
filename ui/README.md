# Lakebridge UI

Operator console for moving IFS data into the SQL Server staging layer. Built
from the design handoff in [`../docs/design/manifest`](../docs/design/manifest)
which itself was produced from the brief in
[`../docs/design/lakebridge-ui-brief.md`](../docs/design/lakebridge-ui-brief.md).

## Stack

- React 18 + TypeScript + Vite
- Tailwind CSS (palette + type scale wired into `tailwind.config.js`)
- `lucide-react` for icons
- `recharts` is installed but not yet used — the dashboard sparklines and 24h
  timeline are bespoke SVG to keep the design system tight. Wire `recharts`
  in if/when the timeline grows beyond what the inline SVG can show.

## Scripts

```bash
npm install        # install deps
npm run dev        # vite dev server on :5173
npm run build      # type-check then bundle
npm run preview    # serve the production build locally
```

## Layout

```
src/
  App.tsx                  shell · sidebar · top bar · routing · command palette
  main.tsx                 mounts <App />
  index.css                Tailwind + scrollbars + keyframes
  lib/
    cx.ts                  class-name joiner
    icons.tsx              lucide-react re-exports under the `I.foo` key map
  data/sample.ts           typed in-memory fixtures (jobs, runs, errors, …)
  components/primitives.tsx  Button · StatusBadge · Tag · Input · Select · Tabs
                            · EmptyState · Skeleton · InlineBanner · ThSort
                            · ToastProvider/useToast · Kbd · DropdownMenu
                            · Sparkline · Hint · LakebridgeMark
  screens/
    Jobs.tsx               /jobs — hero screen, all five state modes
    Run.tsx                /runs/:id — live timer, step timeline, four tabs
    Dashboard.tsx          / — KPIs, 24h timeline, errors, currently running
    Misc.tsx               Job detail · Sources · Recon · Settings · Sign-in
```

## What is and isn't here

- Module-scoped fake data only. There is no real backend.
- TanStack Query and TanStack Table are not installed yet — once an API
  exists, the data-table primitive (`<table>` with sticky head + fixed
  column widths) is shaped to drop into TanStack Table without a rewrite.
- The Jobs page exposes a "state mode" picker (live/loading/empty/error/
  partial) for the design states demanded by the brief. Remove the picker
  when wiring to a real data source.
