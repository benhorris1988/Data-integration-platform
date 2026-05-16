# Handoff: Lakebridge Operator Console

## Overview

Lakebridge is an internal operator console for moving data from **IFS Applications (Oracle-backed ERP)** into the staging layer of a SQL Server data lake, en route to **SAP ECC 6.0**. The audience is small (<12 data engineers and migration leads), runs only on corporate networks, and is operational software in the spirit of Datadog / Linear / Sentry — not SaaS marketing software.

The primary user task this UI optimizes for: **"Is anything broken?" answered in under five seconds**, with safe paths to make complex configuration changes.

## About the design files

The files in this bundle are **design references created in HTML/React-via-Babel** — interactive prototypes showing the intended look, density, and behavior. **They are not production code to copy directly.**

Your task is to **recreate these designs in the target codebase's existing environment** (React + Tailwind is recommended given the design system; the original brief asks for Tailwind utility classes, `lucide-react`, and `recharts`). Use the existing project's libraries, build setup, routing, and data-access patterns. Do **not** ship Babel-in-the-browser or the prototype's fake-data module.

If the target project has no environment yet, the recommended stack is:
- React 18 + Vite + TypeScript
- Tailwind CSS (config in §Design Tokens below)
- `lucide-react` for icons
- `recharts` for the 24h dashboard timeline
- TanStack Query for server state, TanStack Table for the data-table primitive (virtualization built in — the design assumes this)

## Fidelity

**High-fidelity.** Pixel-perfect mockups with final colors, typography, spacing, borders, density, and interaction patterns. Recreate the UI to match exactly using the codebase's React + Tailwind patterns. The design tokens, type scale, and density numbers below are non-negotiable inputs to the implementation.

## Screens

The console has **seven screens** plus sign-in, all reachable from a fixed sidebar. The **Jobs index is the hero** — build it first; everything else composes from the same primitives.

### 1. Sign-in (`/sign-in`)
- **Purpose:** SSO-only authentication. Local accounts disabled.
- **Layout:** Centered 360px card on otherwise empty background. No marketing copy, no illustration, no product description.
- **Components:**
  - Lakebridge wordmark + 20px icon top-left of card.
  - "Sign in" heading (`text-lg`, weight 500).
  - One-line subtitle: "Use your corporate SSO. Local accounts are disabled."
  - Primary button: "Continue with Okta" (full-width, lg size, brand color, shield icon left).
  - Secondary button: "Continue with security key" (full-width, lg size, key icon).
  - Footer in mono, text-subtle: `build · 2026.05.16-r3142`, `env · prod-eu · region eu-west-1`.

### 2. Overview / Dashboard (`/`)
- **Purpose:** 5-second "is anything broken?" answer. Must fit above the fold at 1440×900.
- **Layout (top to bottom):**
  - Page header: title "Overview", subtitle in mono, "All systems nominal" health pill + Refresh + Last 24h buttons on the right.
  - Row 1: **Four KPI cards** in a 4-column grid, each 1fr wide.
    - Runs (24h): 1,284, +8.2% delta, sparkline (`#2563EB`).
    - Success rate: 98.4%, −0.4 pp delta (warning tone), sparkline (`#16A34A`).
    - Rows landed: 184.2M, +12.1% delta, sparkline (`#0891B2`).
    - Active jobs: 18 / 28, sub "10 paused", sparkline (`#71717A`).
  - Row 2: **12-column grid**.
    - Columns 1–8: 24-hour activity strip — 60 hover-able rectangles, height proportional to run duration, color = run status. Hover popover shows job code, duration, status. Below it: 4 small breakdown stats (succeeded / warning / failed / running counts).
    - Columns 9–12: Strategy mix — 4 horizontal progress bars (watermark_delta, append, full_snapshot, truncate_and_load) with run counts and percentages.
  - Row 3: **12-column grid**.
    - Columns 1–8: Newest errors panel — 10 rows, columns: severity dot, error code (mono), job code (mono), message (truncated), captured-at.
    - Columns 9–12: Currently running mini-cards — 3 entries, each with job code (mono), elapsed time (mono tabular), progress bar (animated pulse), current step + rows count.

### 3. Jobs index (`/jobs`) — **HERO SCREEN**
- **Purpose:** Primary working surface; spends-most-time page.
- **Density target:** At 1440×900 must show ≥24 data rows + filter bar + page header. Default row height **36px**, Compact mode **28px**.
- **Layout:**
  - **Page header (top, border-bottom):**
    - Title "Jobs" + count `{filtered} of {total}` in muted text + state-mode picker (dev affordance — `live | loading | empty | error | partial`) + Refresh ghost button + "New job" primary button.
    - Filter bar (4 controls left + density toggle + Export ghost button right):
      - Search input (288px wide, search icon left, placeholder "Search jobs, source objects, target tables…").
      - Status multi-select (popover with checkboxes; shows count badge when any selected).
      - Schedule select (All / Scheduled / Manual).
      - Source select (All sources / IFS-PRD-EU / IFS-PRD-US / IFS-TST).
      - Density toggle (segmented Default / Compact).
  - **Optional banner** (when partial degradation mode active): warning InlineBanner above the table.
  - **Optional batch-action toolbar** (when ≥1 row selected): bordered strip with `{n} selected · Clear`, then Run now / Disable / Pin / Delete (danger).
  - **Table:**
    - Sticky header. Sortable on every column except actions. Active-sort indicator: arrow up/down in text color; inactive: chevrons-up-down in subtle.
    - Columns + widths (fixed `table-layout`):
      - 32px — checkbox.
      - 92px — Status (status badge: dot + label, dense variant).
      - 230px — Code (mono, full identifier like `EXT.MAT.MASTER.FULL`).
      - 240px — Source object (mono, truncate-middle if >32 chars — keep schema prefix and leaf, e.g. `IFSAPP.PURC…E_LINE_TAB`).
      - 230px — Target table (mono, regular truncate).
      - 140px — Strategy (Tag badge — bordered, surface-2 background, never filled pill).
      - 130px — Schedule (mono if cron, regular if "manual").
      - 130px — Last finished (relative time; absolute UTC tooltip on hover).
      - 110px — Rows (right-aligned, tabular numbers, thousand separators "1,284,302"; em-dash for 0).
      - 36px — Actions (kebab menu, only shows on row hover) + chevron right (only on row hover).
    - Row states: default white, hover surface-2, selected brand/5 tint. Click row → navigate to Job detail.
    - Kebab menu items: Run now / View latest run / Edit configuration / Copy code (⌘C) / divider / Disable job / Delete (danger).
  - **Footer:** "Showing N of M jobs" left, pager right.
- **Required states (all must be rendered):**
  - Loading: skeleton rows (shimmer animation), 14 rows. **No spinner on full page.**
  - Empty: centered EmptyState with database icon, "No jobs yet.", description "Create one to start landing IFS data into the staging layer.", "New job" primary CTA.
  - Empty (no matches): "No jobs match your filters." with "Clear filters" secondary CTA.
  - Error: page-level InlineBanner (danger tone) inside the table card, "Could not load jobs.", description names the failure, Retry secondary button.
  - Partial: warning banner above table; table loads but timing/counts are stale.

### 4. Run detail (`/runs/[id]`)
- **Purpose:** Most information-dense page. Live updates via SSE.
- **Layout:**
  - **Header:**
    - Breadcrumb: `Jobs › {job_code, mono} › {run_id, mono}`.
    - Title (job code in mono, `text-xl`, weight 600) + StatusBadge + duration with clock icon (tabular) + "Triggered by {name}" with user icon + absolute started-at timestamp in mono subtle.
    - Right side: ghost "Open in console" + secondary "Cancel run" + primary "Run again".
    - **Step timeline** below header — 6 nodes (connect / count / extract / load / recon / finalize). Each node = 5px circle (success-filled / brand-pulsing / outline) + step label + duration. Connectors between nodes fill proportionally to step progress; in-flight step pulses. Done steps show check icon; in-flight shows small filled brand dot; upcoming shows step number.
  - **Tabs:** Summary / Errors (with live count badge) / Reconciliation / Raw log. Right of tabs: live indicator pulse + "Live · updates every 1.1s".
  - **Summary tab:** 12-column grid.
    - Cols 1–7: Run details card with 12-key definition list in two columns, divided by vertical border. Keys: Job code, Run id, Source, Source object, Target, Strategy, Watermark column, Watermark before, Watermark after, Triggered by, Triggered at, Run mode. Values in mono where they're identifiers.
    - Cols 8–12: 2×2 grid of small KPI tiles (Rows loaded with live ticking, Throughput, Errors with live count, Recon variance). Below: full-width "Rows per second" sparkline card with min/peak/avg footer.
  - **Errors tab:** 12-column split.
    - Cols 1–7: virtualized error table with severity dot / code (mono) / message (truncated) / source PK (mono) / captured-at.
    - Cols 8–12: side panel showing full JSON of the selected error (id, severity, code, message, captured_at, source, target, run, stack).
  - **Reconciliation tab:** 3-column header strip (Source rowcount / Target rowcount / Variance) each with value + status dot + sub-line. Below: row-hash check table (4 buckets) with source hash / target hash / match.
  - **Raw log tab:** Header strip with "Raw log · level=info · stream=stdout" + Download / Pause tail. Body: dense terminal-style `<pre>` with timestamp (subtle, tabular) / level (color-coded uppercase) / message. Auto-scrolls to bottom on new lines.
- **Live behavior:** 1.1s timer ticks: rows-loaded counter increments by ~1000±, error count occasionally bumps, step progress advances 6% per tick, log appends new lines. When a step's progress hits 100%, advance to the next step.

### 5. Job detail (`/jobs/[id]`)
- **Header:** Breadcrumb `Jobs › {job_code}`. Title (mono job code) + StatusBadge + `{source} → {target_table}` in mono muted. Actions: ghost Disable, secondary "Latest run" (history icon), primary "Run now".
- **Tabs:** Configuration / Schema / Run history / Watermarks.
- **Configuration tab:** 12-column split.
  - Cols 1–8: Definition list card, 15 rows, hover reveals inline pencil edit icon. Keys: Code, Source system, Source object, Target schema, Target table, Strategy, Schedule, Watermark column, Watermark grace, Batch size, Retries, Timeout, Owner, Created (with actor), Updated (with actor).
  - Cols 9–12: Source query card (mono `<pre>` SQL snippet) + Danger zone card (Reset watermark / Clone job / Delete job).
- **Schema tab:** Mapping table with 6 columns: source column / source type / arrow / target column / target type / drift status. Drift rows tinted warning/5. Two drift kinds: "Implicit cast" (warning) and "New, unmapped" (warning).
- **Run history tab:** 24-row table — status / run id (mono) / started (mono) / duration / rows / throughput.
- **Watermarks tab:** 12-column split. Cols 1–7: Current watermark card with column name, big mono datetime, "advanced N ago by run_X", Reset + Edit buttons. Cols 8–12: Recent advances list (5 entries: timestamp, run id, delta).

### 6. Sources (`/sources`)
- **Header:** Title "Sources" + primary "New source" button.
- **Layout:** 12-column grid.
  - Cols 1–5: Source list table (Source / Host / Status / Last test). Click selects.
  - Cols 7–12: Detail panel. Top card: 8-row definition list (Host, Port, SID, Oracle version, Username, Authentication, TLS, Pool size). Header has Edit ghost + "Test connection" secondary (shows loading spinner during test, then inline result strip — green for ok, warning for degraded, mono status message). Bottom card: discovered source objects table (Object / Row count / Last seen / Jobs).

### 7. Reconciliation (`/recon`)
- **Header:** Title + description "Source vs target counts and checksums · last 6 runs". Actions: ghost Export CSV, primary Recompute.
- **Layout:** Single table. Job code (mono) / target (mono muted) / 6 cells for last 6 runs. Each cell is a colored bar (green=match, warning=variance within threshold, danger=checksum drift). Hover any cell shows tooltip with job code, source/target counts, checksum status.
- **Legend** below table.

### 8. Settings (`/settings/{users|sources|audit}`)
- **Header:** Title "Settings".
- **Tabs:** Users / Sources / Audit log.
- **Users tab:** Table — Name / Email (mono) / Role (Tag) / MFA (shield icon green if enabled, warning if required) / Last active / kebab. "Invite user" primary in toolbar.
- **Sources tab:** Same data table primitive as the Sources screen list, with kebab actions instead of selection.
- **Audit log tab:** Virtualized-style log table — Timestamp (mono tabular) / Actor (mono) / Action (mono Tag) / Target (mono).

## Design tokens

### Color palette

**Neutral base (light):**
| Token | Hex |
|---|---|
| `bg` | `#FAFAFA` |
| `surface` | `#FFFFFF` |
| `surface-2` | `#F4F4F5` |
| `border` | `#E4E4E7` |
| `border-strong` | `#D4D4D8` |
| `text` | `#18181B` |
| `text-muted` | `#71717A` |
| `text-subtle` | `#A1A1AA` |

**Neutral base (dark — same UI, inverted):**
| Token | Hex |
|---|---|
| `bg` | `#0A0A0B` |
| `surface` | `#111113` |
| `surface-2` | `#18181B` |
| `border` | `#27272A` |
| `border-strong` | `#3F3F46` |
| `text` | `#FAFAFA` |
| `text-muted` | `#A1A1AA` |
| `text-subtle` | `#71717A` |

**Brand accent (sparing — primary buttons, focus rings, links):**
- `brand` `#2563EB`
- `brand-hover` `#1D4ED8`

**Semantic (status only, never decorative):**
- `success` `#16A34A`
- `warning` `#D97706`
- `danger` `#DC2626`
- `info` `#0891B2`
- `queued` `#71717A` (neutral grey — explicitly **not** blue)

Dark mode is a first-class citizen. Both themes ship. System preference is the default. Toggle lives in the top bar.

### Typography

- Sans: **Inter** (fall back to system sans).
- Mono: **JetBrains Mono** (fall back to `ui-monospace`).

| Token | Size / line height | Used for |
|---|---|---|
| `text-xs` | 11px / 16 | Table cells secondary, timestamps in lists |
| `text-sm` | 13px / 20 | Table cells primary, body |
| `text-base` | 14px / 22 | Paragraph body, form labels |
| `text-lg` | 16px / 24 | Section headings inside pages |
| `text-xl` | 20px / 28 | Page titles |
| `text-2xl` | 28px / 36 | Dashboard KPI numbers |

**Weights:** 400 / 500 / 600 only. **No 700+. No italics for emphasis.**

Mono is used for **identifiers** (job codes, run IDs), code snippets, SQL fragments, and table/column names. **Never for body prose.**

### Spacing, radii, shadows, borders

- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32 / 48 px.
- **Radii:** 2px on inputs / buttons / badges / table cells; 6px on cards / modals / popovers. **No pill shapes. No fully-rounded buttons.**
- **Shadows:** None on cards — cards are bordered, not floated. One soft shadow on overlays only (popovers / dropdowns / modals).
- **Borders:** 1px solid `var(--border)`. Borders define every container.

### Density

- Jobs table @ 1440×900: **≥24 data rows** above the fold.
- Dashboard @ 1440×900: all 4 KPI cards + 24h timeline + ≥8 recent errors above the fold.
- Run detail @ 1440×900: step timeline + ≥12 error rows.
- Default table row height: **36px**. Compact mode: **28px**.
- Page horizontal padding: **32px**. Card internal padding: **16–24px**. No 48px+ gutters anywhere.

### Microcopy rules

- **Sentence case** for buttons and menu items ("New job", not "New Job").
- **Title case** for page titles only.
- **Verb-first** for actions ("Run now", "Disable job", "Test connection").
- **No exclamation marks. No emoji in UI labels.**
- Empty states direct: "No jobs yet. Create one to start landing IFS data."
- Error states name the failure: "Connection refused. IFS host unreachable." **not** "Something went wrong."

### Iconography

`lucide-react` only. **16px** in dense controls, **20px** in toolbars, **24px** in empty states. **No filled icons** in lists — outline icons throughout. **Status uses a dot, not an icon.**

## Components to build first

These six primitives compose everything. Build them first.

1. **Button** — variants `primary | secondary | ghost | danger`. Sizes `sm (h-7) | md (h-8) | lg (h-9)`. Loading state with spinner replacing left icon. Disabled at 60% opacity.
2. **StatusBadge** — dot + label, never a filled pill. Variants: `succeeded | running (pulse) | failed | queued | cancelled | warning | ok | degraded`. Has a `dense` prop that scales dot from 8px → 6px and uses `text-xs`.
3. **Input** / **Select** — 2px focus ring brand color, 30% alpha. Error state with red border + ring + helper text below.
4. **Data-table primitive** — sortable header (`ThSort`) with active-sort indicator. Hover row → surface-2. Selected row → brand/5 tint. Sticky header at top:0 z-10. Fixed `table-layout` with explicit `colgroup` widths. Virtualization-ready API (TanStack Table recommended for the real impl).
5. **Tabs** — bottom-border style. Active tab gets 2px brand underline + text color. Count badges inline (text-xs, tabular, surface-2 background).
6. **Toast** — slides in bottom-right. Min duration **4500ms for state-changing confirmations**. Tones map to semantic icons (info / success / warning / danger).

Plus: EmptyState (icon + title + description + optional CTA, centered, py-12), Skeleton row (shimmer-animated), InlineBanner (tonal background tint, left icon, optional action + dismiss), Command palette (`⌘K`, fuzzy across jobs/sources/nav/actions, keyboard nav).

## Interactions & behavior

- **Sort:** Click any sortable header — first click ascending, second descending, third returns to default.
- **Multi-select filters:** Status uses checkbox popover with a Clear action; shows count badge on trigger when any selected.
- **Row selection:** Checkbox in leftmost column; header checkbox toggles all visible. Selection persists across filter changes. Batch toolbar appears above table when selection > 0.
- **Row click:** Navigates to detail. Action menu and checkbox stop propagation.
- **Hover affordances:** Kebab menu and chevron right appear only on row hover, not always-on, to keep density.
- **Tooltips:** All relative timestamps show absolute UTC on hover. Implementation: simple absolute positioned mono pill above the trigger.
- **Animations:**
  - In-flight status dots: 1.6s ease-out pulse, box-shadow expanding ring.
  - Spinners on buttons: 0.7s linear rotation.
  - Skeleton: 1.2s ease-in-out background-position shimmer.
  - No transitions on row hover beyond color (`transition-colors`).
- **Live updates (Run detail):** Connect to SSE / WebSocket. Tick interval ~1.1s. Updates: step progress, rows loaded, error count, log tail. When tab is "Errors", live count badge updates without re-mounting the table.
- **Test connection:** Loading state on button (spinner), then inline strip below the source's definition list (NOT a toast).
- **Command palette:** `⌘K` opens. `↑/↓` navigate, `↵` open, `esc` close. Fuzzy match across navigation, jobs (top 14), sources, actions. Groups labeled, keyboard highlight crosses groups.

## State management

Per-screen state needed:

- **Jobs index:** `filters` (status set, schedule, source, query), `sort` (`{key, dir}`), `selection` (id set), `density`, `stateMode` (for the dev affordance, can be removed in production).
- **Run detail:** Live `stepIdx`, `stepProgress`, `rowsLoaded`, `errCount`, `now` tick for log tail; selected error for side panel; active tab.
- **Job detail:** Active tab.
- **Sources:** Selected source, test-in-progress flag, test-result.
- **App-level:** Theme (`light | dark | system`), signed-in flag, command-palette open flag, current route.

Recommended hooks:
- `useQuery(['jobs', filters, sort])` returning the table page.
- `useEventSource(`/runs/${id}/events`)` for the live run detail.
- `useTheme()` reading/writing `localStorage` and toggling `html.dark` class.

## Data shapes

The prototype uses these shapes in `data.js`. Mirror them in TypeScript:

```ts
type Job = {
  id: string;              // 'job_001'
  code: string;            // 'EXT.MAT.MASTER.FULL'
  source_object: string;   // 'IFSAPP.INVENTORY_PART_TAB'
  target_table: string;    // 'stg_ifs_inventory.inventory_part'
  strategy: 'full_snapshot' | 'append' | 'watermark_delta' | 'truncate_and_load';
  source: 'IFS-PRD-EU' | 'IFS-PRD-US' | 'IFS-TST';
  schedule: string;        // cron expression OR 'manual'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  last_run: string;        // relative; absolute on hover
  rows: number;            // 0 when never run / cancelled
  owner: string;
  enabled: boolean;
};

type RunError = {
  id: string;
  severity: 'error' | 'warn';
  code: string;            // 'ORA-12541', 'LB-CAST-FAIL', etc.
  message: string;
  source_pk: string | '—';
  captured_at: string;     // relative
  run_id: string;
  job_code: string;
};

type Source = {
  id: string;
  host: string;
  port: number;
  sid: string;
  oracle: string;
  status: 'ok' | 'degraded' | 'failed';
  lastTest: string;
};
```

Error codes the design uses (keep this set when implementing): `ORA-12541, ORA-01017, LB-CAST-FAIL, LB-SCHEMA-DRIFT, LB-WMARK-REGRESS, LB-CONN-LOST, LB-ROWHASH-MISMATCH`.

## Anti-patterns to avoid

These were called out in the brief — preserve through implementation:

- No purple/pink gradient backgrounds. No gradients **at all** except inside a single sparkline fill.
- No glass-morphism, frosted blur, neon glows.
- No card grids on the dashboard with three lines of placeholder body text per card.
- No "AI sparkle" iconography, robot mascots, chat-style FAQ widgets.
- No centered hero text like "Welcome to Lakebridge."
- No soft pastel illustrations.
- No rounded-full buttons on a desktop dense UI.
- No animated background blobs or shimmer on decorative elements.
- No default shadcn aesthetic shipped untouched.
- No emoji in UI labels.
- No toasts that auto-dismiss state-changing confirmations under 4 seconds.
- No spinners on full pages — use skeleton rows.
- No sentence-style page titles like "Let's see your jobs!".
- No avatar circles with random gradients.

## Assets

- **Fonts:** Inter and JetBrains Mono — load from Google Fonts or self-host. Weights 400 / 500 / 600 only.
- **Icons:** All from `lucide-react`. In the prototype these are inline SVG paths for portability; switch to the package import in the real codebase.
- **Logo:** The Lakebridge wordmark is paired with a small bridge-glyph icon (custom SVG in `screen-misc.jsx` as `LakebridgeMark`). The bridge metaphor is: arch above a central node. Keep this; ask the brand team if they want a finalized lockup.
- **No photography, no illustrations** anywhere in the product.

## Files in this bundle

- `index.html` — entry. Loads Tailwind CDN (configures the tokens above), Google Fonts (Inter + JetBrains Mono), React 18, Babel standalone, Recharts, then the JSX modules.
- `data.js` — fake module-scoped data. Jobs (28), errors, sources, recon matrix, users, audit log, schema map, source objects, sparkline series. **Do not ship.**
- `icons.jsx` — inline `lucide`-equivalent icons as a JSX dictionary. Replace with `lucide-react` imports.
- `primitives.jsx` — Button / StatusBadge / Tag / Input / Select / Tabs / EmptyState / Skeleton / InlineBanner / ThSort / Toast (provider + hook) / Kbd / DropdownMenu / Sparkline / Hint.
- `screen-jobs.jsx` — Jobs index (the hero). Includes the state-mode picker, filter components, batch toolbar.
- `screen-run.jsx` — Run detail with timer-driven live updates, step timeline, Summary / Errors / Reconciliation / Raw log tabs.
- `screen-dashboard.jsx` — 4 KPI cards, 24h timeline strip, strategy mix, errors panel, currently-running panel.
- `screen-misc.jsx` — Job detail, Sources, Reconciliation matrix, Settings (Users/Sources/Audit), Sign-in.
- `app.jsx` — App shell: sidebar, top bar, theme toggle, command palette, routing.

## Implementation order (recommended)

1. Tailwind config — palette + type scale + radii.
2. Primitives — Button, StatusBadge, Tag, Input, Select, Tabs, Toast.
3. Data-table primitive (TanStack Table is the right choice).
4. **Jobs index** — spend disproportionate time here. If this feels right, the rest will.
5. Run detail with one live-update path wired to SSE.
6. Dashboard.
7. Job detail, Sources, Reconciliation, Settings.
8. Theme toggle + command palette.
9. All five states (loading / empty / error / partial / live) for every list-bearing screen.

## Open questions / decisions to confirm with design

1. **Batch-action toolbar** currently appends below the filter bar (non-destructive). Some teams prefer it replacing the filter bar in-place. Pick one and apply consistently.
2. **Step timeline** uses circular nodes; works at 6 steps. If the pipeline grows past 8, drop the dot and rely on filled connectors, or stack onto two lines.
3. **24h dashboard timeline** rolls up runs into 60 ~24-min slots. The original brief implied per-run blocks; with 1,200+ runs/day that's unreadable. If you want per-run, gate it behind a job/source filter first.
4. **Virtualization** is unimplemented in the prototype but the table primitive is shaped for it (sticky header, fixed row height, colgroup widths). Use TanStack Virtual on the audit log and the Run-detail errors table at minimum.
