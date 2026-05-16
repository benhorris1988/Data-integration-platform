import { useMemo, useState } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  InlineBanner,
  SkeletonBlock,
  Sparkline,
  StatusDot,
  Tag,
} from '../components/primitives';
import {
  useDashboardErrors,
  useDashboardKpis,
  useDashboardTimeline,
  useJobs,
} from '../api/queries';
import { formatInt, formatPercent, formatRelative } from '../api/format';
import type { ApiTimelineEntry, RunStatus } from '../api/types';
import type { JobRef, RunRef } from '../App';

type Props = {
  onOpenJob?: (ref: JobRef) => void;
  onOpenRun?: (ref?: RunRef) => void;
};

export function Dashboard({ onOpenRun }: Props) {
  const kpis = useDashboardKpis();
  const timeline = useDashboardTimeline();
  const errors = useDashboardErrors(10);
  const jobs = useJobs();

  const refreshAll = () => {
    kpis.refetch();
    timeline.refetch();
    errors.refetch();
    jobs.refetch();
  };

  const isLoading = kpis.isPending;
  const isError = kpis.isError;
  const k = kpis.data;

  const running = (jobs.data ?? []).filter(
    (j) => j.last_run_status === 'running' || j.last_run_status === 'queued',
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">
              Overview
            </h1>
            <p className="text-sm text-text-muted dark:text-d-text-muted">
              Lakebridge · IFS → SAP ECC staging · last 24 hours
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isError ? (
              <span className="text-xs text-danger inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-danger" />
                Metrics unavailable
              </span>
            ) : (
              <span className="text-xs text-text-subtle dark:text-d-text-subtle inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-success lb-pulse" />
                Live · refreshes every 30s
              </span>
            )}
            <div className="w-px h-5 bg-border dark:bg-d-border" />
            <Button
              variant="ghost"
              size="md"
              iconLeft={<I.refresh size={14} />}
              loading={kpis.isFetching || timeline.isFetching || errors.isFetching}
              onClick={refreshAll}
            >
              Refresh
            </Button>
            <Button variant="secondary" size="md" iconLeft={<I.calendar size={14} />}>
              Last 24h
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-4 space-y-4">
        {isError && (
          <InlineBanner
            tone="danger"
            title="Could not load dashboard."
            description={kpis.error instanceof Error ? kpis.error.message : 'Unknown error'}
            action={
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<I.refresh size={12} />}
                onClick={refreshAll}
              >
                Retry
              </Button>
            }
          />
        )}

        <div className="grid grid-cols-4 gap-4">
          <Kpi
            label="Runs (24h)"
            value={k ? formatInt(k.runs_24h) : '—'}
            series={k?.series_runs ?? []}
            color="#2563EB"
            loading={isLoading}
          />
          <Kpi
            label="Success rate"
            value={k ? formatPercent(k.success_rate_pct) : '—'}
            series={k?.series_success ?? []}
            color="#16A34A"
            loading={isLoading}
          />
          <Kpi
            label="Rows landed"
            value={k ? formatRowsCompact(k.rows_landed_24h) : '—'}
            series={k?.series_rows ?? []}
            color="#0891B2"
            loading={isLoading}
          />
          <Kpi
            label="Active jobs"
            value={k ? `${k.active_jobs} / ${k.active_jobs + k.paused_jobs}` : '—'}
            sub={k ? `${k.paused_jobs} paused` : undefined}
            series={k?.series_active ?? []}
            color="#71717A"
            loading={isLoading}
          />
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">
                Run activity · last 24h
              </h3>
              <div className="flex items-center gap-3 text-xs">
                <LegendDot color="bg-success" label="Succeeded" />
                <LegendDot color="bg-warning" label="Warning" />
                <LegendDot color="bg-danger" label="Failed" />
                <LegendDot color="bg-brand" label="Running" />
              </div>
            </div>
            <Timeline24h
              entries={timeline.data ?? []}
              isLoading={timeline.isPending}
            />
          </div>

          <div className="col-span-4 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">
                Strategy mix
              </h3>
              <span className="text-xs text-text-subtle dark:text-d-text-subtle">jobs</span>
            </div>
            <StrategyMix jobs={jobs.data ?? []} isLoading={jobs.isPending} />
          </div>
        </div>

        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-8 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-medium text-text dark:text-d-text">
                  Newest errors
                </h3>
                <Tag>last 30 min</Tag>
              </div>
              <Button variant="ghost" size="sm" iconRight={<I.arrowRight size={12} />}>
                View all
              </Button>
            </div>
            {errors.isPending ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SkeletonBlock key={i} h={20} />
                ))}
              </div>
            ) : errors.data && errors.data.length > 0 ? (
              <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 44 }} />
                  <col style={{ width: 150 }} />
                  <col style={{ width: 220 }} />
                  <col />
                  <col style={{ width: 100 }} />
                </colgroup>
                <tbody>
                  {errors.data.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => onOpenRun?.({ runId: e.run_id, jobCode: e.job_code })}
                      className={cx(
                        'border-t border-border dark:border-d-border cursor-pointer hover:bg-surface-2 dark:hover:bg-d-surface-2',
                      )}
                      style={{ height: 32 }}
                    >
                      <td className="px-3">
                        <StatusDot
                          status={e.severity === 'error' ? 'failed' : 'warning'}
                        />
                      </td>
                      <td className="px-3 font-mono text-sm text-text dark:text-d-text">
                        {e.code}
                      </td>
                      <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                        {e.job_code}
                      </td>
                      <td className="px-3 truncate text-text-muted dark:text-d-text-muted">
                        {e.message}
                      </td>
                      <td className="px-3 text-right text-xs text-text-muted dark:text-d-text-muted">
                        {formatRelative(e.captured_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
                No errors in the recent window.
              </div>
            )}
          </div>

          <div className="col-span-4 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">
                Currently running
              </h3>
              <span className="text-xs text-text-subtle dark:text-d-text-subtle tabular">
                {running.length} job{running.length === 1 ? '' : 's'}
              </span>
            </div>
            <div>
              {running.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
                  Nothing running right now.
                </div>
              ) : (
                running.slice(0, 4).map((j) => (
                  <div
                    key={j.id}
                    onClick={() =>
                      j.last_run_id != null &&
                      onOpenRun?.({ runId: j.last_run_id, jobCode: j.code })
                    }
                    className="px-4 py-2.5 border-t border-border dark:border-d-border first:border-t-0 hover:bg-surface-2 dark:hover:bg-d-surface-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-text dark:text-d-text">
                        {j.code}
                      </span>
                      <span className="text-xs text-text-muted dark:text-d-text-muted tabular">
                        {j.last_run_status}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-surface-2 dark:bg-d-surface-2 rounded-sm overflow-hidden">
                      <div className="h-full bg-brand lb-pulse" style={{ width: '40%' }} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-text-muted dark:text-d-text-muted">
                      <span>{j.target_schema}.{j.target_table}</span>
                      <span className="tabular">
                        {j.last_run_rows ? formatInt(j.last_run_rows) : '—'} rows
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  series,
  color,
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  series: number[];
  color: string;
  loading: boolean;
}) {
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
            {label}
          </div>
          {loading ? (
            <div className="mt-1.5">
              <SkeletonBlock w={120} h={28} />
            </div>
          ) : (
            <div className="mt-1.5 text-2xl font-semibold tabular text-text dark:text-d-text">
              {value}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 -mx-1">
        {series.length > 0 ? (
          <Sparkline data={series} color={color} height={36} />
        ) : (
          <SkeletonBlock h={36} />
        )}
      </div>
      {sub && (
        <div className="text-xs text-text-subtle dark:text-d-text-subtle mt-1">{sub}</div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-text-muted dark:text-d-text-muted">
      <span className={cx('inline-block w-2 h-2 rounded-sm', color)} />
      {label}
    </span>
  );
}

function StrategyMix({
  jobs,
  isLoading,
}: {
  jobs: { strategy: string }[];
  isLoading: boolean;
}) {
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const j of jobs) m.set(j.strategy, (m.get(j.strategy) ?? 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [jobs]);
  const total = jobs.length;
  const colorFor = (s: string) =>
    ({
      watermark_delta: 'bg-brand',
      append: 'bg-info',
      full_snapshot: 'bg-text-subtle',
      truncate_and_load: 'bg-warning',
    }[s] ?? 'bg-surface-2');

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} h={20} />
        ))}
      </div>
    );
  }
  if (total === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
        No jobs yet.
      </div>
    );
  }
  return (
    <div className="p-4 space-y-3">
      {counts.map(([name, n]) => {
        const pct = (n / total) * 100;
        return (
          <div key={name}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-mono text-text dark:text-d-text">{name}</span>
              <span className="tabular text-text-muted dark:text-d-text-muted">
                {n}{' '}
                <span className="text-text-subtle dark:text-d-text-subtle">
                  ({pct.toFixed(0)}%)
                </span>
              </span>
            </div>
            <div className="mt-1 h-1.5 bg-surface-2 dark:bg-d-surface-2 rounded-sm overflow-hidden">
              <div className={cx('h-full', colorFor(name))} style={{ width: pct + '%' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Timeline24h({
  entries,
  isLoading,
}: {
  entries: ApiTimelineEntry[];
  isLoading: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const colorOf = (s: RunStatus | 'warning') =>
    ({
      succeeded: 'bg-success',
      warning: 'bg-warning',
      failed: 'bg-danger',
      cancelled: 'bg-text-subtle',
      running: 'bg-brand',
      queued: 'bg-info',
    }[s] ?? 'bg-surface-2');

  if (isLoading) {
    return (
      <div className="p-4">
        <SkeletonBlock h={96} />
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="px-4 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
        No runs in the last 24h.
      </div>
    );
  }

  const counts = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.status] = (acc[e.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="p-4">
      <div className="relative">
        <div className="flex justify-between text-xs text-text-subtle dark:text-d-text-subtle font-mono tabular mb-1.5">
          {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'now'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="flex gap-[2px] items-end h-20 bg-surface-2 dark:bg-d-surface-2 rounded-sm p-1 border border-border dark:border-d-border">
          {entries.map((b, i) => {
            const maxDur = entries.reduce((m, e) => Math.max(m, e.dur_sec ?? 0), 60);
            const heightPct = 30 + ((b.dur_sec ?? 30) / maxDur) * 70;
            const isHover = hover === i;
            return (
              <div
                key={b.id}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className={cx(
                  'flex-1 rounded-sm cursor-pointer transition-all',
                  colorOf(b.status),
                  b.status === 'running' && 'lb-pulse',
                  isHover &&
                    'ring-2 ring-text dark:ring-d-text ring-offset-1 ring-offset-surface-2 dark:ring-offset-d-surface-2',
                )}
                style={{ height: `${heightPct}%` }}
              />
            );
          })}
        </div>
        {hover !== null && entries[hover] && (
          <div
            className="absolute bg-text text-surface dark:bg-d-text dark:text-d-bg text-xs rounded-sm px-2 py-1 font-mono pointer-events-none whitespace-nowrap z-10"
            style={{
              left: `${(hover / entries.length) * 100}%`,
              top: -8,
              transform: 'translate(-50%, -100%)',
            }}
          >
            {entries[hover].job_code}
            <span className="text-text-subtle dark:text-d-text-subtle"> · </span>
            {entries[hover].dur_sec ?? '—'}s
            <span className="text-text-subtle dark:text-d-text-subtle"> · </span>
            {entries[hover].status}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
        {(
          [
            ['Succeeded', counts['succeeded'] ?? 0, 'text-success'],
            ['Failed', counts['failed'] ?? 0, 'text-danger'],
            ['Running', counts['running'] ?? 0, 'text-brand'],
            ['Other', (counts['cancelled'] ?? 0) + (counts['queued'] ?? 0), 'text-text-muted'],
          ] as const
        ).map(([k, n, c]) => (
          <div key={k}>
            <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
              {k}
            </div>
            <div className={cx('text-lg font-semibold tabular mt-0.5', c)}>{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatRowsCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
