# Design Brief — Lakebridge UI

## Mission

You are designing the operator console for **Lakebridge**, an internal tool that moves data from IFS Applications (Oracle-backed ERP) into the staging layer of a SQL Server data lake, en route to SAP ECC 6.0. The audience is small — fewer than a dozen data engineers and migration leads — and the product runs inside corporate networks, never on the public internet.

This is **operational software**, not marketing software. The job of the UI is to let an experienced operator answer "is anything broken?" in under five seconds, and to make complex configuration changes safely. It is closer in spirit to Datadog, Linear, or Sentry than to a SaaS landing page. There are no hero sections, no testimonials, no soft pastel illustrations. Information density is a virtue; whitespace is the cost of admission, not the goal.

## Reference aesthetic

Pattern-match against these:

- **Linear** for control density, command bars, and the discipline of muted color used purposefully.
- **Vercel dashboard** for the table-and-detail layout pattern.
- **Datadog** for status timelines and infra-monitoring chrome.
- **Sentry** for error lists and stack-trace-like detail panels.
- **Stripe dashboard** for sober, trustworthy formality on settings and audit pages.

Explicitly do **not** pattern-match against: Notion (too playful), Airtable (too colorful), Salesforce Lightning (too dense in the wrong way), or any "Tailwind UI marketing template" aesthetic.

## Design system

### Palette

A near-monochrome base, accented by a single semantic palette for run status. Resist all temptation to use colored backgrounds for non-semantic decoration.

```
Neutral base (light):
  bg            #FAFAFA
  surface       #FFFFFF
  surface-2     #F4F4F5
  border        #E4E4E7
  border-strong #D4D4D8
  text          #18181B
  text-muted    #71717A
  text-subtle   #A1A1AA

Neutral base (dark — same UI, inverted):
  bg            #0A0A0B
  surface       #111113
  surface-2     #18181B
  border        #27272A
  border-strong #3F3F46
  text          #FAFAFA
  text-muted    #A1A1AA
  text-subtle   #71717A

Brand accent (sparingly — primary buttons, focus rings, links):
  brand         #2563EB
  brand-hover   #1D4ED8

Semantic (status only, never decorative):
  success       #16A34A
  warning       #D97706
  danger        #DC2626
  info          #0891B2
  queued        #71717A   (neutral grey — explicitly not blue)
```

Dark mode is a first-class citizen. Both themes ship; system preference is the default; the toggle lives in the user menu.

### Typography

```
Sans: Inter (fall back to system sans)
Mono: JetBrains Mono (fall back to ui-monospace)

Scale:
  text-xs   11px / 16  — table cells secondary, timestamps in lists
  text-sm   13px / 20  — table cells primary, body
  text-base 14px / 22  — paragraph body, form labels
  text-lg   16px / 24  — section headings inside pages
  text-xl   20px / 28  — page titles
  text-2xl  28px / 36  — dashboard KPI numbers (display)

Weights: 400 / 500 / 600 only. No 700+. No italics for emphasis.
```

Mono is used for identifiers (job codes, run IDs), code snippets, SQL fragments, and table/column names. Never for body prose.

### Spacing, radii, shadows

```
Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48 px
Radius:        2px (inputs, buttons, badges, table cells)
               6px (cards, modals, popovers)
               No pill shapes. No fully-rounded buttons.
Shadows:       None on cards — cards are bordered, not floated.
               One soft shadow on overlays (popovers, dropdowns, modals).
Borders:       1px solid, var(--border). Borders define every container.
```

### Density

This is a dense product. Calibrate against these numbers:

- The Jobs table at 1440×900 must show **at least 24 data rows** plus filter bar plus page header.
- The Dashboard at 1440×900 must show all four KPI cards, the 24h timeline, and at least 8 recent-error rows above the fold.
- Run detail at 1440×900 must show the step timeline and at least 12 error rows.
- Default data-table row height: 36px. Compact mode (toggleable): 28px.
- Page horizontal padding: 32px. Card internal padding: 16–24px. No 48px+ gutters anywhere.

### Microcopy

Sentence case for buttons and menu items: "New job," not "New Job." Title case for page titles only. Verb-first for actions: "Run now," "Disable job," "Test connection." No exclamation marks. No emoji in UI labels. Empty states are direct: "No jobs yet. Create one to start landing IFS data." Error states name the failure: "Connection refused. IFS host unreachable." not "Something went wrong."

### Iconography

`lucide-react` only. 16px in dense controls, 20px in toolbars, 24px in empty states. No filled icons in lists; outline icons throughout. Status uses a dot, not an icon.

## Components to build first

Get these right and everything composes from them:

- **Button** — primary, secondary, ghost; three sizes; loading state with spinner.
- **Status badge** — dot + label, not a filled pill. One per status.
- **Input** and **Select** — clear focus ring (2px brand); error state with helper text below.
- **Data-table primitive** — sortable header with active-sort indicator; hover row; selected row; subtle zebra optional; sticky header; virtualization-ready API even if not all tables are virtualized.
- **Tabs** for in-page navigation (used on Job detail and Run detail).
- **Toast** — slides in from bottom-right; dismissible; never auto-dismisses confirmations of state-changing actions under 4 seconds.
- **Empty state** — small icon + one-line description + optional CTA.
- **Skeleton row** for tables (do not use spinners on full pages).
- **Inline error banner** for partial failures within a page.
- **Command palette** triggered by ⌘K — fuzzy search across jobs, runs, sources, settings.

## Screens to design (in priority order)

**The Jobs index is the hero screen.** Render it first, at full fidelity, with realistic data. It is where users spend most of their time and the page that proves the design system works under load. If it doesn't feel right, the rest won't either.

1. **Jobs index** (`/jobs`). Page header with title, total count, "New job" primary button. Filter bar: status multi-select, schedule kind, source system, search input. Table columns: status dot, code (mono), source object (mono, truncated middle), target table (mono), strategy (badge), schedule (cron expression or "manual"), last run finished (relative time, absolute on hover), rows last run (right-aligned number with thousand separators), actions menu (⋯). Row hover surfaces a subtle chevron at right. Selecting rows enables a batch-action toolbar above the table. Sortable on every column except actions.

2. **Run detail** (`/runs/[id]`). The most information-dense page. Top: breadcrumb (Job code → Run id) + status badge + duration + triggered-by. Then a horizontal **step timeline** — connect / count / extract / load / recon / finalize — each step a node with status dot, name, duration; the in-flight step animates with a subtle pulse. Below: tab strip — Summary / Errors / Reconciliation / Raw log. Default tab is Summary, showing a two-column key-value list and a sparkline of rows-per-second over the run. The Errors tab is a virtualized table of severity, code, message, source PK, captured-at, with a side panel showing the full JSON of the selected error.

3. **Dashboard** (`/`). Four KPI cards in a 4-column grid: Runs (24h), Success rate, Rows landed (24h), Active jobs. Each KPI has a tiny sparkline. Below: a 24-hour horizontal **timeline strip** of run blocks (each a colored rectangle proportional to duration; hover for popover) and a panel of the 10 newest errors with deep links into their runs.

4. **Job detail** (`/jobs/[id]`). Page header with code, status, source, target. Tabs: Configuration / Schema / Run History / Watermarks. Configuration tab uses a definition-list layout with inline-edit on each field. Schema tab shows source columns mapped to staging columns in a two-pane diff view, flagging drift in amber.

5. **Sources** (`/sources`). Simple table; detail page has connection info and a child table of source objects, with a "Test connection" button that reveals an inline result strip.

6. **Reconciliation** (`/recon`). A matrix of jobs × latest recon result, with each cell colored green/amber/red. Click a cell for a popover with raw counts and checksums.

7. **Settings** (`/settings/users`, `/settings/sources`, `/settings/audit`). Three sub-pages; users uses the same data-table primitive; audit is a virtualized log table.

**Sign-in** is a centered card on an otherwise empty page. No marketing imagery, no product description, no illustration.

## States to demonstrate

For every screen above, render explicitly:

- **Loading** — skeleton rows, not spinners on full pages.
- **Empty** — first-time zero state with one-line guidance.
- **Error** — page-level inline banner with a retry action.
- **Partial degradation** — e.g., Jobs page where the metrics service is down but the table loads.
- **Live update** — Run detail must demonstrate SSE-style step transitions and live error counts using a timer.

These states are where AI-generated UIs typically embarrass themselves. Render them deliberately and thoughtfully.

## Sample data

Use realistic IFS and SAP terminology. Never Lorem Ipsum.

```
Source systems:    IFS-PRD-EU, IFS-PRD-US, IFS-TST
Source objects:    IFSAPP.INVENTORY_PART_TAB
                   IFSAPP.CUSTOMER_INFO
                   IFSAPP.PURCHASE_ORDER_LINE_TAB
                   IAL.CUSTOMER_ORDER_HIST
                   IFSAPP.CUSTOMER_ORDER_LINE_TAB
                   IFSAPP.SUPPLIER_INFO
Job codes:         EXT.MAT.MASTER.FULL
                   EXT.CUST.MASTER.DELTA
                   EXT.PO.LINES.APPEND
                   EXT.CO.HISTORY.WMARK
                   EXT.SUPP.MASTER.FULL
                   EXT.INV.BAL.SNAPSHOT
Target tables:     stg_ifs_inventory.inventory_part
                   stg_ifs_customer.customer_master
                   stg_ifs_purchase.po_line_history
                   stg_ifs_sales.co_history
Strategies:        full_snapshot, append, watermark_delta, truncate_and_load
Run statuses:      queued, running, succeeded, failed, cancelled
Error codes:       ORA-12541, ORA-01017, LB-CAST-FAIL, LB-SCHEMA-DRIFT,
                   LB-WMARK-REGRESS, LB-CONN-LOST, LB-ROWHASH-MISMATCH
Operator names:    Priya Iyer, Marcus Hahn, Jules Okafor, Linnea Berg, Tom Mwangi
Row counts:        6 to 9 digits; show "1,284,302" not "1.28M".
Timestamps:        mix "2 min ago", "yesterday 14:22", absolute UTC on hover.
Cron schedules:    "0 */2 * * *", "0 6 * * *", "*/15 * * * *", "manual"
```

## Deliverables

Produce a **single React artifact** that renders the design system and the seven screens listed, switchable from a sidebar. Tailwind utility classes only; no external CSS. Use `lucide-react` for icons. Use `recharts` for sparklines and the dashboard timeline. No real backend — fake data lives in module-level constants. Do not include any code beyond what's needed to render the UI; this is a design artifact, not a working app.

Order of operations:

1. Implement the palette as Tailwind theme extensions and the type scale.
2. Build the component inventory (buttons, badges, inputs, table primitives, tabs, toasts).
3. Render the **Jobs index** completely. Spend disproportionate time here.
4. Render the Run detail page with at least one live-update interaction (timer-driven).
5. Render the Dashboard.
6. Render Job detail, Sources, Reconciliation, Settings.
7. Add a light/dark toggle in the top bar; make sure dark mode looks correct on every page.

## Anti-patterns to avoid

If you find yourself reaching for any of the following, stop and reconsider:

- Purple or pink gradient backgrounds. No gradients at all except inside a single sparkline fill.
- Glass-morphism, frosted blur, neon glows.
- Card grids on the dashboard with three lines of placeholder body text per card.
- "AI sparkle" iconography, robot mascots, or chat-style FAQ widgets.
- Centered hero text with "Welcome to Lakebridge."
- Soft pastel illustrations of clouds, databases, or people at desks.
- Rounded-full buttons on a desktop dense UI.
- Animated background blobs or shimmer effects on decorative elements.
- Default shadcn aesthetic shipped untouched — extend it; do not rely on the demo look.
- Emoji in UI labels.
- Toasts that auto-dismiss state-changing confirmations in under 4 seconds.
- Spinners on full pages.
- Sentence-style page titles like "Let's see your jobs!"
- Avatar circles with random gradients used as decoration.

## How to start

Begin by rendering the Jobs index. Do not start with the dashboard — it is the most forgiving and least informative screen to design first. Once the Jobs page feels right, the rest will fall out of the same primitives. After the Jobs page is complete, post a brief screenshot description of what you built, what design decisions you made that weren't in this brief, and what you'd flag as still uncertain.
