/* global React, I, LB, Button, StatusBadge, StatusDot, Tag, Input, Select,
   ThSort, EmptyState, SkeletonRow, InlineBanner, DropdownMenu, Hint, useToast, cx */

// Jobs index — hero screen.
// Header → filter bar → table → footer. Renders all primary states via a
// "stateMode" picker exposed at the top of the page (loading / empty / error
// / partial / live). Defaults to a fully-loaded happy path.

function JobsIndex({ onOpenJob, onOpenRun }) {
  const toast = useToast();
  const [stateMode, setStateMode] = React.useState('live'); // live | loading | empty | error | partial
  const [density, setDensity] = React.useState('default'); // default | compact
  const [query, setQuery] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState(new Set());
  const [scheduleFilter, setScheduleFilter] = React.useState('all');
  const [sourceFilter, setSourceFilter] = React.useState('all');
  const [sort, setSort] = React.useState({ key: 'last_run', dir: 'desc' });
  const [selection, setSelection] = React.useState(new Set());
  const [hoverRow, setHoverRow] = React.useState(null);

  const rows = React.useMemo(() => {
    let r = LB.JOBS.slice();
    if (statusFilter.size) r = r.filter(j => statusFilter.has(j.status));
    if (scheduleFilter !== 'all') {
      r = r.filter(j => scheduleFilter === 'manual' ? j.schedule === 'manual' : j.schedule !== 'manual');
    }
    if (sourceFilter !== 'all') r = r.filter(j => j.source === sourceFilter);
    if (query.trim()) {
      const q = query.toLowerCase();
      r = r.filter(j =>
        j.code.toLowerCase().includes(q) ||
        j.source_object.toLowerCase().includes(q) ||
        j.target_table.toLowerCase().includes(q)
      );
    }
    const { key, dir } = sort;
    const cmp = (a, b) => {
      let av = a[key], bv = b[key];
      if (key === 'last_run') { // pseudo-order based on row index (already realistic)
        av = LB.JOBS.indexOf(a); bv = LB.JOBS.indexOf(b);
      }
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    };
    r.sort((a, b) => dir === 'asc' ? cmp(a, b) : -cmp(a, b));
    return r;
  }, [statusFilter, scheduleFilter, sourceFilter, query, sort]);

  const onSort = (k) => setSort(s => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc' }));

  const toggleStatus = (s) => {
    setStatusFilter(prev => {
      const n = new Set(prev);
      n.has(s) ? n.delete(s) : n.add(s);
      return n;
    });
  };

  const toggleRow = (id) => {
    setSelection(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };
  const allSelected = rows.length > 0 && rows.every(r => selection.has(r.id));
  const toggleAll = () => setSelection(allSelected ? new Set() : new Set(rows.map(r => r.id)));

  const rowH = density === 'compact' ? 28 : 36;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">Jobs</h1>
            <span className="text-sm text-text-muted dark:text-d-text-muted tabular">
              {rows.length} of {LB.JOBS.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <StateModePicker value={stateMode} onChange={setStateMode} />
            <Button variant="ghost" size="md" iconLeft={<I.refresh size={14} />} onClick={() => toast.push({ tone: 'info', title: 'Refreshed jobs list' })}>
              Refresh
            </Button>
            <Button variant="primary" size="md" iconLeft={<I.plus size={14} />}
              onClick={() => toast.push({ tone: 'success', title: 'Job created', description: 'EXT.NEW.JOB.DRAFT — awaiting source binding.', duration: 6000 })}>
              New job
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <div className="w-72">
            <Input
              placeholder="Search jobs, source objects, target tables…"
              icon={<I.search size={14} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              size="md"
            />
          </div>
          <StatusMultiSelect value={statusFilter} onToggle={toggleStatus} onClear={() => setStatusFilter(new Set())} />
          <ScheduleSelect value={scheduleFilter} onChange={setScheduleFilter} />
          <SourceSelect value={sourceFilter} onChange={setSourceFilter} />
          <div className="flex-1" />
          <DensityToggle value={density} onChange={setDensity} />
          <Button variant="ghost" size="md" iconLeft={<I.download size={14} />}>Export</Button>
        </div>
      </div>

      {/* Partial degradation banner */}
      {stateMode === 'partial' && (
        <div className="px-8 pt-3">
          <InlineBanner
            tone="warning"
            title="Metrics service is degraded."
            description="The Jobs list loaded from the primary database, but row-counts and last-run timing are stale (last sync 14 min ago)."
            action={<Button variant="secondary" size="sm">Retry</Button>}
          />
        </div>
      )}

      {/* Batch toolbar */}
      {selection.size > 0 && (
        <div className="px-8 pt-3">
          <div className="flex items-center justify-between bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md px-3 h-10">
            <div className="text-sm text-text dark:text-d-text">
              <span className="font-medium tabular">{selection.size}</span>
              <span className="text-text-muted dark:text-d-text-muted"> selected · </span>
              <button className="text-brand hover:underline" onClick={() => setSelection(new Set())}>Clear</button>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" iconLeft={<I.play size={12} />}
                onClick={() => toast.push({ tone: 'info', title: `${selection.size} jobs queued`, description: 'Runs will start when capacity is available.' })}>
                Run now
              </Button>
              <Button variant="ghost" size="sm" iconLeft={<I.pause size={12} />}>Disable</Button>
              <Button variant="ghost" size="sm" iconLeft={<I.pin size={12} />}>Pin</Button>
              <div className="w-px h-5 bg-border dark:bg-d-border mx-1" />
              <Button variant="ghost" size="sm" iconLeft={<I.x size={12} />} className="text-danger hover:bg-danger/10 hover:text-danger">Delete</Button>
            </div>
          </div>
        </div>
      )}

      {/* Table region */}
      <div className="flex-1 min-h-0 px-8 pt-3 pb-4 overflow-auto">
        <div className="border border-border dark:border-d-border rounded-md overflow-hidden bg-surface dark:bg-d-surface">
          {stateMode === 'error' ? (
            <div className="p-3">
              <InlineBanner
                tone="danger"
                title="Could not load jobs."
                description="Connection to lakebridge-api timed out after 30s. Last successful sync 4 min ago. Showing cached list is disabled per policy."
                action={<Button variant="secondary" size="sm" iconLeft={<I.refresh size={12} />}>Retry</Button>}
              />
            </div>
          ) : (
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 32 }} />
                <col style={{ width: 92 }} />
                <col style={{ width: 230 }} />
                <col style={{ width: 240 }} />
                <col style={{ width: 230 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 130 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 36 }} />
              </colgroup>
              <thead>
                <tr>
                  <th className="h-9 px-3 border-b border-border dark:border-d-border bg-surface dark:bg-d-surface sticky top-0 z-10">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll}
                      className="w-3.5 h-3.5 accent-brand cursor-pointer" />
                  </th>
                  <ThSort k="status"        sort={sort.key} dir={sort.dir} onSort={onSort}>Status</ThSort>
                  <ThSort k="code"          sort={sort.key} dir={sort.dir} onSort={onSort}>Code</ThSort>
                  <ThSort k="source_object" sort={sort.key} dir={sort.dir} onSort={onSort}>Source object</ThSort>
                  <ThSort k="target_table"  sort={sort.key} dir={sort.dir} onSort={onSort}>Target table</ThSort>
                  <ThSort k="strategy"      sort={sort.key} dir={sort.dir} onSort={onSort}>Strategy</ThSort>
                  <ThSort k="schedule"      sort={sort.key} dir={sort.dir} onSort={onSort}>Schedule</ThSort>
                  <ThSort k="last_run"      sort={sort.key} dir={sort.dir} onSort={onSort}>Last finished</ThSort>
                  <ThSort k="rows"          sort={sort.key} dir={sort.dir} onSort={onSort} align="right">Rows</ThSort>
                  <th className="h-9 border-b border-border dark:border-d-border bg-surface dark:bg-d-surface sticky top-0 z-10" />
                </tr>
              </thead>
              <tbody>
                {stateMode === 'loading' && Array.from({ length: 14 }).map((_, i) => (
                  <SkeletonJobRow key={i} rowH={rowH} />
                ))}

                {stateMode === 'empty' && (
                  <tr><td colSpan={10} className="bg-surface dark:bg-d-surface">
                    <EmptyState
                      icon={<I.database size={20} />}
                      title="No jobs yet."
                      description="Create one to start landing IFS data into the staging layer."
                      action={<Button variant="primary" size="md" iconLeft={<I.plus size={14} />}>New job</Button>}
                    />
                  </td></tr>
                )}

                {(stateMode === 'live' || stateMode === 'partial') && rows.length === 0 && (
                  <tr><td colSpan={10} className="bg-surface dark:bg-d-surface">
                    <EmptyState
                      icon={<I.search size={20} />}
                      title="No jobs match your filters."
                      description="Try clearing the status filter or the search query."
                      action={
                        <Button variant="secondary" size="sm" onClick={() => { setStatusFilter(new Set()); setQuery(''); setScheduleFilter('all'); setSourceFilter('all'); }}>
                          Clear filters
                        </Button>
                      }
                    />
                  </td></tr>
                )}

                {(stateMode === 'live' || stateMode === 'partial') && rows.map((j, i) => {
                  const selected = selection.has(j.id);
                  return (
                    <tr
                      key={j.id}
                      style={{ height: rowH }}
                      onMouseEnter={() => setHoverRow(j.id)}
                      onMouseLeave={() => setHoverRow(null)}
                      onClick={() => onOpenJob?.(j)}
                      className={cx(
                        'border-b border-border dark:border-d-border cursor-pointer transition-colors',
                        selected
                          ? 'bg-brand/5 dark:bg-brand/10'
                          : (i % 2 === 1 ? 'bg-surface dark:bg-d-surface' : 'bg-surface dark:bg-d-surface') +
                            ' hover:bg-surface-2 dark:hover:bg-d-surface-2',
                      )}
                    >
                      <td className="px-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected} onChange={() => toggleRow(j.id)}
                          className="w-3.5 h-3.5 accent-brand cursor-pointer" />
                      </td>
                      <td className="px-3">
                        <StatusBadge status={j.status} dense />
                      </td>
                      <td className="px-3">
                        <span className="font-mono text-sm text-text dark:text-d-text">{j.code}</span>
                      </td>
                      <td className="px-3 min-w-0">
                        <span className="font-mono text-sm text-text-muted dark:text-d-text-muted truncate block">
                          {truncMid(j.source_object, 32)}
                        </span>
                      </td>
                      <td className="px-3 min-w-0">
                        <span className="font-mono text-sm text-text-muted dark:text-d-text-muted truncate block">{j.target_table}</span>
                      </td>
                      <td className="px-3"><Tag>{j.strategy}</Tag></td>
                      <td className="px-3">
                        <span className={cx('text-sm tabular', j.schedule === 'manual' ? 'text-text-muted dark:text-d-text-muted' : 'font-mono text-text dark:text-d-text')}>
                          {j.schedule}
                        </span>
                      </td>
                      <td className="px-3">
                        <Hint label={absTime(i)}>
                          <span className="text-sm text-text-muted dark:text-d-text-muted">{j.last_run}</span>
                        </Hint>
                      </td>
                      <td className="px-3 text-right">
                        <span className="text-sm tabular text-text dark:text-d-text">
                          {j.rows > 0 ? j.rows.toLocaleString('en-US') : <span className="text-text-subtle dark:text-d-text-subtle">—</span>}
                        </span>
                      </td>
                      <td className="px-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          {hoverRow === j.id && (
                            <DropdownMenu
                              trigger={
                                <button className="w-6 h-6 inline-flex items-center justify-center rounded-sm text-text-muted hover:text-text hover:bg-surface-2 dark:text-d-text-muted dark:hover:text-d-text dark:hover:bg-d-surface-2"
                                  aria-label="Row actions">
                                  <I.more size={14} />
                                </button>
                              }
                              items={[
                                { label: 'Run now', icon: <I.play size={14} />, onClick: () => toast.push({ tone: 'success', title: `Queued ${j.code}`, description: 'Run will appear in the activity panel.' }) },
                                { label: 'View latest run', icon: <I.externalLink size={14} />, onClick: () => onOpenRun?.(j) },
                                { label: 'Edit configuration', icon: <I.pencil size={14} /> },
                                { label: 'Copy code', icon: <I.copy size={14} />, kbd: '⌘C' },
                                { divider: true },
                                { label: j.enabled ? 'Disable job' : 'Enable job', icon: <I.pause size={14} /> },
                                { label: 'Delete', icon: <I.x size={14} />, danger: true },
                              ]}
                            />
                          )}
                          <I.chevronRight size={14} className={cx('text-text-subtle dark:text-d-text-subtle transition-opacity', hoverRow === j.id ? 'opacity-100' : 'opacity-0')} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        {(stateMode === 'live' || stateMode === 'partial') && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-text-muted dark:text-d-text-muted">
            <div>Showing <span className="tabular text-text dark:text-d-text">{rows.length}</span> of <span className="tabular">{LB.JOBS.length}</span> jobs</div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" iconLeft={<I.chevronLeft size={12} />}>Prev</Button>
              <span className="px-2 tabular">1 / 1</span>
              <Button variant="ghost" size="sm" iconRight={<I.chevronRight size={12} />}>Next</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── filter components ───────────────────────────────────────────────────────
function StatusMultiSelect({ value, onToggle, onClear }) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  window.useClickAway(ref, () => setOpen(false));
  const statuses = ['queued','running','succeeded','failed','cancelled'];
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cx(
          'h-8 px-2.5 inline-flex items-center gap-1.5 rounded-sm border text-sm',
          'border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface',
          'text-text dark:text-d-text hover:bg-surface-2 dark:hover:bg-d-surface-2',
        )}
      >
        <I.filter size={12} className="text-text-muted dark:text-d-text-muted" />
        <span>Status</span>
        {value.size > 0 && (
          <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm bg-brand/15 text-brand text-xs tabular">
            {value.size}
          </span>
        )}
        <I.chevronDown size={12} className="text-text-subtle dark:text-d-text-subtle" />
      </button>
      {open && (
        <div className="absolute mt-1 left-0 z-30 min-w-[200px] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark py-1">
          {statuses.map(s => (
            <button key={s} onClick={() => onToggle(s)} className="w-full px-2.5 py-1.5 flex items-center gap-2 text-sm hover:bg-surface-2 dark:hover:bg-d-surface-2 text-text dark:text-d-text">
              <input type="checkbox" readOnly checked={value.has(s)} className="w-3.5 h-3.5 accent-brand pointer-events-none" />
              <StatusBadge status={s} dense />
            </button>
          ))}
          <div className="my-1 border-t border-border dark:border-d-border" />
          <button onClick={onClear} className="w-full text-left px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-2 dark:hover:bg-d-surface-2 dark:text-d-text-muted">Clear</button>
        </div>
      )}
    </div>
  );
}
function ScheduleSelect({ value, onChange }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All schedules</option>
      <option value="scheduled">Scheduled (cron)</option>
      <option value="manual">Manual</option>
    </Select>
  );
}
function SourceSelect({ value, onChange }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All sources</option>
      {LB.SOURCES.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
    </Select>
  );
}
function DensityToggle({ value, onChange }) {
  return (
    <div className="inline-flex rounded-sm border border-border-strong dark:border-d-border-strong overflow-hidden">
      {['default', 'compact'].map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={cx(
            'px-2 h-8 text-xs font-medium',
            v === value
              ? 'bg-surface-2 text-text dark:bg-d-surface-2 dark:text-d-text'
              : 'bg-surface text-text-muted hover:text-text dark:bg-d-surface dark:text-d-text-muted dark:hover:text-d-text',
          )}>
          {v === 'default' ? 'Default' : 'Compact'}
        </button>
      ))}
    </div>
  );
}

function StateModePicker({ value, onChange }) {
  // small dev-style affordance to switch states; bordered to feel intentional
  return (
    <div className="inline-flex rounded-sm border border-border dark:border-d-border overflow-hidden text-xs">
      {['live','loading','empty','error','partial'].map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={cx(
            'px-2 h-7 font-medium capitalize transition-colors',
            v === value
              ? 'bg-text text-surface dark:bg-d-text dark:text-d-bg'
              : 'bg-surface text-text-muted hover:text-text dark:bg-d-surface dark:text-d-text-muted dark:hover:text-d-text',
          )}>{v}</button>
      ))}
    </div>
  );
}

function SkeletonJobRow({ rowH }) {
  return (
    <tr className="border-b border-border dark:border-d-border" style={{ height: rowH }}>
      <td className="px-3"><div className="w-3.5 h-3.5 rounded-sm lb-skeleton" /></td>
      <td className="px-3"><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full lb-skeleton" /><div className="lb-skeleton rounded-sm h-2.5 w-16" /></div></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-40" /></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-48" /></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-44" /></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-24" /></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-20" /></td>
      <td className="px-3"><div className="lb-skeleton rounded-sm h-2.5 w-16" /></td>
      <td className="px-3 text-right"><div className="lb-skeleton rounded-sm h-2.5 w-14 ml-auto" /></td>
      <td />
    </tr>
  );
}

// truncate middle for long identifiers: keeps the schema and the leaf
function truncMid(s, max = 32) {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + '…' + s.slice(s.length - half);
}
function absTime(i) {
  const hh = String((14 - (i % 6)) % 24).padStart(2, '0');
  const mm = String((42 - (i*7) % 60 + 60) % 60).padStart(2, '0');
  return `2026-05-16 ${hh}:${mm}:11 UTC`;
}

Object.assign(window, { JobsIndex });
