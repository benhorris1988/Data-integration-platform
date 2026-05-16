import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  DropdownMenu,
  EmptyState,
  Hint,
  InlineBanner,
  Input,
  Select,
  StatusBadge,
  Tag,
  ThSort,
  useClickAway,
  useToast,
} from '../components/primitives';
import {
  useJobs,
  useRunJob,
  useSources,
  useToggleJob,
  type JobsFilters,
} from '../api/queries';
import { formatInt, formatRelative } from '../api/format';
import type { ApiJobListItem, ApiMe, RunStatus } from '../api/types';
import type { JobRef } from '../App';
import { JobEditor } from './JobEditor';

type Props = {
  me: ApiMe;
  onOpenJob?: (ref: JobRef) => void;
  onOpenRun?: (ref: { runId: number; jobCode?: string }) => void;
};

type SortKey =
  | 'code'
  | 'source_object'
  | 'target_table'
  | 'strategy'
  | 'schedule'
  | 'last_run_finished_at'
  | 'last_run_rows'
  | 'last_run_status';

export function JobsIndex({ me, onOpenJob, onOpenRun }: Props) {
  const toast = useToast();
  const canWrite = me.role !== 'Read-only';
  const [density, setDensity] = useState<'default' | 'compact'>('default');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<Set<RunStatus>>(new Set());
  const [scheduleFilter, setScheduleFilter] = useState<'all' | 'scheduled' | 'manual'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'last_run_finished_at',
    dir: 'desc',
  });
  const [selection, setSelection] = useState<Set<number>>(new Set());
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const [newJobOpen, setNewJobOpen] = useState(false);

  const filters: JobsFilters = useMemo(
    () => ({
      status: statusFilter.size ? Array.from(statusFilter) : undefined,
      schedule: scheduleFilter === 'all' ? undefined : scheduleFilter,
      sourceId: sourceFilter === 'all' ? undefined : sourceFilter,
      q: query.trim() || undefined,
    }),
    [statusFilter, scheduleFilter, sourceFilter, query],
  );

  const jobs = useJobs(filters);
  const runJob = useRunJob();
  const toggleJob = useToggleJob();

  const rows = useMemo(() => {
    const data = jobs.data ?? [];
    const { key, dir } = sort;
    const get = (j: ApiJobListItem): string | number | null => {
      switch (key) {
        case 'code':
          return j.code;
        case 'source_object':
          return j.source_object;
        case 'target_table':
          return j.target_table;
        case 'strategy':
          return j.strategy;
        case 'schedule':
          return j.schedule;
        case 'last_run_status':
          return j.last_run_status ?? '';
        case 'last_run_finished_at':
          return j.last_run_finished_at ? Date.parse(j.last_run_finished_at) : 0;
        case 'last_run_rows':
          return j.last_run_rows ?? 0;
      }
    };
    const cmp = (a: ApiJobListItem, b: ApiJobListItem) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    };
    return [...data].sort((a, b) => (dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
  }, [jobs.data, sort]);

  const onSort = (k: string) =>
    setSort((s) => ({
      key: k as SortKey,
      dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc',
    }));

  const toggleStatus = (s: RunStatus) => {
    setStatusFilter((prev) => {
      const n = new Set(prev);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  };

  const toggleRow = (id: number) => {
    setSelection((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };
  const allSelected = rows.length > 0 && rows.every((r) => selection.has(r.id));
  const toggleAll = () =>
    setSelection(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const rowH = density === 'compact' ? 28 : 36;

  const handleRunNow = (j: ApiJobListItem) => {
    runJob.mutate(
      { jobId: j.id },
      {
        onSuccess: (data) => {
          toast.push({
            tone: 'success',
            title: `Queued ${j.code}`,
            description: `Run #${data.run_id} will appear in Run detail.`,
          });
          onOpenRun?.({ runId: data.run_id, jobCode: j.code });
        },
        onError: (err: unknown) =>
          toast.push({
            tone: 'danger',
            title: `Could not queue ${j.code}`,
            description: err instanceof Error ? err.message : 'Unknown error',
          }),
      },
    );
  };

  const handleToggleEnabled = (j: ApiJobListItem) => {
    toggleJob.mutate(
      { jobId: j.id, enabled: !j.enabled },
      {
        onSuccess: () =>
          toast.push({
            tone: 'info',
            title: j.enabled ? `Disabled ${j.code}` : `Enabled ${j.code}`,
          }),
      },
    );
  };

  const totalJobs = jobs.data?.length ?? 0;
  const isLoading = jobs.isPending;
  const isError = jobs.isError;

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">
              Jobs
            </h1>
            <span className="text-sm text-text-muted dark:text-d-text-muted tabular">
              {isLoading ? '…' : `${rows.length} of ${totalJobs}`}
            </span>
            {jobs.isFetching && !jobs.isPending && (
              <span className="text-xs text-text-subtle dark:text-d-text-subtle">
                refreshing…
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              iconLeft={<I.refresh size={14} />}
              loading={jobs.isFetching}
              onClick={() => jobs.refetch()}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="md"
              iconLeft={<I.plus size={14} />}
              disabled={!canWrite}
              title={canWrite ? undefined : 'Read-only role'}
              onClick={() => setNewJobOpen(true)}
            >
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
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
              size="md"
            />
          </div>
          <StatusMultiSelect
            value={statusFilter}
            onToggle={toggleStatus}
            onClear={() => setStatusFilter(new Set())}
          />
          <ScheduleSelect value={scheduleFilter} onChange={setScheduleFilter} />
          <SourceSelect value={sourceFilter} onChange={setSourceFilter} />
          <div className="flex-1" />
          <DensityToggle value={density} onChange={setDensity} />
          <Button variant="ghost" size="md" iconLeft={<I.download size={14} />}>
            Export
          </Button>
        </div>
      </div>

      {/* Batch toolbar */}
      {selection.size > 0 && (
        <div className="px-8 pt-3">
          <div className="flex items-center justify-between bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md px-3 h-10">
            <div className="text-sm text-text dark:text-d-text">
              <span className="font-medium tabular">{selection.size}</span>
              <span className="text-text-muted dark:text-d-text-muted"> selected · </span>
              <button
                className="text-brand hover:underline"
                onClick={() => setSelection(new Set())}
              >
                Clear
              </button>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<I.play size={12} />}
                disabled={!canWrite}
                onClick={() => {
                  const targets = rows.filter((r) => selection.has(r.id));
                  targets.forEach((j) => runJob.mutate({ jobId: j.id }));
                  toast.push({
                    tone: 'info',
                    title: `${targets.length} jobs queued`,
                    description: 'Runs will start when capacity is available.',
                  });
                }}
              >
                Run now
              </Button>
              <Button variant="ghost" size="sm" iconLeft={<I.pause size={12} />}>
                Disable
              </Button>
              <Button variant="ghost" size="sm" iconLeft={<I.pin size={12} />}>
                Pin
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Table region */}
      <div className="flex-1 min-h-0 px-8 pt-3 pb-4 overflow-auto">
        <div className="border border-border dark:border-d-border rounded-md overflow-hidden bg-surface dark:bg-d-surface">
          {isError ? (
            <div className="p-3">
              <InlineBanner
                tone="danger"
                title="Could not load jobs."
                description={
                  jobs.error instanceof Error
                    ? jobs.error.message
                    : 'Connection to lakebridge-api failed.'
                }
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<I.refresh size={12} />}
                    onClick={() => jobs.refetch()}
                  >
                    Retry
                  </Button>
                }
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
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 accent-brand cursor-pointer"
                    />
                  </th>
                  <ThSort k="last_run_status" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Status
                  </ThSort>
                  <ThSort k="code" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Code
                  </ThSort>
                  <ThSort k="source_object" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Source object
                  </ThSort>
                  <ThSort k="target_table" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Target table
                  </ThSort>
                  <ThSort k="strategy" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Strategy
                  </ThSort>
                  <ThSort k="schedule" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Schedule
                  </ThSort>
                  <ThSort k="last_run_finished_at" sort={sort.key} dir={sort.dir} onSort={onSort}>
                    Last finished
                  </ThSort>
                  <ThSort
                    k="last_run_rows"
                    sort={sort.key}
                    dir={sort.dir}
                    onSort={onSort}
                    align="right"
                  >
                    Rows
                  </ThSort>
                  <th className="h-9 border-b border-border dark:border-d-border bg-surface dark:bg-d-surface sticky top-0 z-10" />
                </tr>
              </thead>
              <tbody>
                {isLoading &&
                  Array.from({ length: 14 }).map((_, i) => (
                    <SkeletonJobRow key={i} rowH={rowH} />
                  ))}

                {!isLoading && rows.length === 0 && totalJobs === 0 && (
                  <tr>
                    <td colSpan={10} className="bg-surface dark:bg-d-surface">
                      <EmptyState
                        icon={<I.database size={20} />}
                        title="No jobs yet."
                        description="Create one to start landing IFS data into the staging layer."
                        action={
                          <Button variant="primary" size="md" iconLeft={<I.plus size={14} />}>
                            New job
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}

                {!isLoading && rows.length === 0 && totalJobs > 0 && (
                  <tr>
                    <td colSpan={10} className="bg-surface dark:bg-d-surface">
                      <EmptyState
                        icon={<I.search size={20} />}
                        title="No jobs match your filters."
                        description="Try clearing the status filter or the search query."
                        action={
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              setStatusFilter(new Set());
                              setQuery('');
                              setScheduleFilter('all');
                              setSourceFilter('all');
                            }}
                          >
                            Clear filters
                          </Button>
                        }
                      />
                    </td>
                  </tr>
                )}

                {!isLoading &&
                  rows.map((j) => {
                    const selected = selection.has(j.id);
                    const status = j.last_run_status ?? 'queued';
                    return (
                      <tr
                        key={j.id}
                        style={{ height: rowH }}
                        onMouseEnter={() => setHoverRow(j.id)}
                        onMouseLeave={() => setHoverRow(null)}
                        onClick={() => onOpenJob?.({ jobId: j.id, jobCode: j.code })}
                        className={cx(
                          'border-b border-border dark:border-d-border cursor-pointer transition-colors',
                          selected
                            ? 'bg-brand/5 dark:bg-brand/10'
                            : 'bg-surface dark:bg-d-surface hover:bg-surface-2 dark:hover:bg-d-surface-2',
                        )}
                      >
                        <td className="px-3" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={() => toggleRow(j.id)}
                            className="w-3.5 h-3.5 accent-brand cursor-pointer"
                          />
                        </td>
                        <td className="px-3">
                          <StatusBadge status={status} dense />
                        </td>
                        <td className="px-3">
                          <span className="font-mono text-sm text-text dark:text-d-text">
                            {j.code}
                          </span>
                        </td>
                        <td className="px-3 min-w-0">
                          <span className="font-mono text-sm text-text-muted dark:text-d-text-muted truncate block">
                            {truncMid(j.source_object, 32)}
                          </span>
                        </td>
                        <td className="px-3 min-w-0">
                          <span className="font-mono text-sm text-text-muted dark:text-d-text-muted truncate block">
                            {j.target_schema}.{j.target_table}
                          </span>
                        </td>
                        <td className="px-3">
                          <Tag>{j.strategy}</Tag>
                        </td>
                        <td className="px-3">
                          <span
                            className={cx(
                              'text-sm tabular',
                              j.schedule === 'manual'
                                ? 'text-text-muted dark:text-d-text-muted'
                                : 'font-mono text-text dark:text-d-text',
                            )}
                          >
                            {j.schedule}
                          </span>
                        </td>
                        <td className="px-3">
                          <Hint label={j.last_run_finished_at ?? '—'}>
                            <span className="text-sm text-text-muted dark:text-d-text-muted">
                              {formatRelative(j.last_run_finished_at)}
                            </span>
                          </Hint>
                        </td>
                        <td className="px-3 text-right">
                          <span className="text-sm tabular text-text dark:text-d-text">
                            {(j.last_run_rows ?? 0) > 0 ? (
                              formatInt(j.last_run_rows)
                            ) : (
                              <span className="text-text-subtle dark:text-d-text-subtle">—</span>
                            )}
                          </span>
                        </td>
                        <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-0.5">
                            {hoverRow === j.id && (
                              <DropdownMenu
                                trigger={
                                  <button
                                    className="w-6 h-6 inline-flex items-center justify-center rounded-sm text-text-muted hover:text-text hover:bg-surface-2 dark:text-d-text-muted dark:hover:text-d-text dark:hover:bg-d-surface-2"
                                    aria-label="Row actions"
                                  >
                                    <I.more size={14} />
                                  </button>
                                }
                                items={[
                                  ...(canWrite
                                    ? [
                                        {
                                          label: 'Run now',
                                          icon: <I.play size={14} />,
                                          onClick: () => handleRunNow(j),
                                        },
                                      ]
                                    : []),
                                  {
                                    label: 'View latest run',
                                    icon: <I.externalLink size={14} />,
                                    onClick: () =>
                                      j.last_run_id != null &&
                                      onOpenRun?.({ runId: j.last_run_id, jobCode: j.code }),
                                  },
                                  { label: 'Edit configuration', icon: <I.pencil size={14} /> },
                                  {
                                    label: 'Copy code',
                                    icon: <I.copy size={14} />,
                                    kbd: '⌘C',
                                    onClick: () => {
                                      navigator.clipboard?.writeText(j.code);
                                      toast.push({ tone: 'info', title: 'Copied to clipboard' });
                                    },
                                  },
                                  ...(canWrite
                                    ? [
                                        { divider: true } as const,
                                        {
                                          label: j.enabled ? 'Disable job' : 'Enable job',
                                          icon: <I.pause size={14} />,
                                          onClick: () => handleToggleEnabled(j),
                                        },
                                        {
                                          label: 'Delete',
                                          icon: <I.x size={14} />,
                                          danger: true,
                                        },
                                      ]
                                    : []),
                                ]}
                              />
                            )}
                            <I.chevronRight
                              size={14}
                              className={cx(
                                'text-text-subtle dark:text-d-text-subtle transition-opacity',
                                hoverRow === j.id ? 'opacity-100' : 'opacity-0',
                              )}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}
        </div>

        {newJobOpen && (
          <JobEditor
            me={me}
            onClose={() => setNewJobOpen(false)}
            onSaved={(j) => {
              setNewJobOpen(false);
              toast.push({
                tone: 'success',
                title: `Created ${j.code}`,
                description: 'Open the job to verify and trigger the first run.',
              });
              jobs.refetch();
              onOpenJob?.({ jobId: j.id, jobCode: j.code });
            }}
          />
        )}

        {/* Footer */}
        {!isLoading && !isError && rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs text-text-muted dark:text-d-text-muted">
            <div>
              Showing{' '}
              <span className="tabular text-text dark:text-d-text">{rows.length}</span> of{' '}
              <span className="tabular">{totalJobs}</span> jobs
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="sm" iconLeft={<I.chevronLeft size={12} />}>
                Prev
              </Button>
              <span className="px-2 tabular">1 / 1</span>
              <Button variant="ghost" size="sm" iconRight={<I.chevronRight size={12} />}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── filter components ───────────────────────────────────────────────────────
function StatusMultiSelect({
  value,
  onToggle,
  onClear,
}: {
  value: Set<RunStatus>;
  onToggle: (s: RunStatus) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const statuses: RunStatus[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled'];
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
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
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => onToggle(s)}
              className="w-full px-2.5 py-1.5 flex items-center gap-2 text-sm hover:bg-surface-2 dark:hover:bg-d-surface-2 text-text dark:text-d-text"
            >
              <input
                type="checkbox"
                readOnly
                checked={value.has(s)}
                className="w-3.5 h-3.5 accent-brand pointer-events-none"
              />
              <StatusBadge status={s} dense />
            </button>
          ))}
          <div className="my-1 border-t border-border dark:border-d-border" />
          <button
            onClick={onClear}
            className="w-full text-left px-2.5 py-1.5 text-sm text-text-muted hover:bg-surface-2 dark:hover:bg-d-surface-2 dark:text-d-text-muted"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function ScheduleSelect({
  value,
  onChange,
}: {
  value: 'all' | 'scheduled' | 'manual';
  onChange: (v: 'all' | 'scheduled' | 'manual') => void;
}) {
  return (
    <Select
      value={value}
      onChange={(e) => onChange(e.target.value as 'all' | 'scheduled' | 'manual')}
    >
      <option value="all">All schedules</option>
      <option value="scheduled">Scheduled (cron)</option>
      <option value="manual">Manual</option>
    </Select>
  );
}

function SourceSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const sources = useSources();
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="all">All sources</option>
      {(sources.data ?? []).map((s) => (
        <option key={s.id} value={s.id}>
          {s.id}
        </option>
      ))}
    </Select>
  );
}

function DensityToggle({
  value,
  onChange,
}: {
  value: 'default' | 'compact';
  onChange: (v: 'default' | 'compact') => void;
}) {
  return (
    <div className="inline-flex rounded-sm border border-border-strong dark:border-d-border-strong overflow-hidden">
      {(['default', 'compact'] as const).map((v) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={cx(
            'px-2 h-8 text-xs font-medium',
            v === value
              ? 'bg-surface-2 text-text dark:bg-d-surface-2 dark:text-d-text'
              : 'bg-surface text-text-muted hover:text-text dark:bg-d-surface dark:text-d-text-muted dark:hover:text-d-text',
          )}
        >
          {v === 'default' ? 'Default' : 'Compact'}
        </button>
      ))}
    </div>
  );
}

function SkeletonJobRow({ rowH }: { rowH: number }) {
  return (
    <tr className="border-b border-border dark:border-d-border" style={{ height: rowH }}>
      <td className="px-3">
        <div className="w-3.5 h-3.5 rounded-sm lb-skeleton" />
      </td>
      <td className="px-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full lb-skeleton" />
          <div className="lb-skeleton rounded-sm h-2.5 w-16" />
        </div>
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-40" />
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-48" />
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-44" />
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-24" />
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-20" />
      </td>
      <td className="px-3">
        <div className="lb-skeleton rounded-sm h-2.5 w-16" />
      </td>
      <td className="px-3 text-right">
        <div className="lb-skeleton rounded-sm h-2.5 w-14 ml-auto" />
      </td>
      <td />
    </tr>
  );
}

function truncMid(s: string, max = 32): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + '…' + s.slice(s.length - half);
}
