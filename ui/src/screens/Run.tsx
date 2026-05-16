import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  EmptyState,
  InlineBanner,
  SkeletonBlock,
  StatusBadge,
  StatusDot,
  Tabs,
  Tag,
  useToast,
} from '../components/primitives';
import { subscribe } from '../api/client';
import {
  useCancelRun,
  useJob,
  useRun,
  useRunErrors,
  useRunJob,
  useRunSteps,
} from '../api/queries';
import {
  formatDuration,
  formatInt,
  formatRelative,
} from '../api/format';
import type {
  ApiRun,
  ApiRunError,
  ApiRunStep,
  StepName,
} from '../api/types';
import type { RunRef } from '../App';

type Props = {
  runRef?: RunRef;
  onBack?: () => void;
};

const STEP_ORDER: StepName[] = [
  'connect',
  'count',
  'extract',
  'load',
  'recon',
  'finalize',
];

const CURRENT_OPERATOR = 'priya.iyer';

export function RunDetail({ runRef, onBack }: Props) {
  const toast = useToast();
  const qc = useQueryClient();

  if (!runRef) {
    return (
      <div className="p-8">
        <EmptyState
          icon={<I.activity size={20} />}
          title="No run selected."
          description="Pick a job from the index and choose ‘View latest run’."
          action={
            <Button variant="secondary" size="md" onClick={onBack}>
              Back to jobs
            </Button>
          }
        />
      </div>
    );
  }

  return <RunDetailContent runRef={runRef} onBack={onBack} toast={toast} qc={qc} />;
}

function RunDetailContent({
  runRef,
  onBack,
  toast,
  qc,
}: {
  runRef: RunRef;
  onBack?: () => void;
  toast: ReturnType<typeof useToast>;
  qc: ReturnType<typeof useQueryClient>;
}) {
  const [tab, setTab] = useState<'summary' | 'errors' | 'recon' | 'log'>('summary');

  // Polling fallback: when the run is in-flight we re-poll every 2s in case
  // SSE drops; once it's terminal we stop. SSE itself invalidates the cache
  // on each event so most of the time we re-render from a single network hit.
  const run = useRun(runRef.runId);
  const isInFlight =
    run.data?.status === 'queued' || run.data?.status === 'running';
  const refetchMs = isInFlight ? 2_000 : undefined;
  const steps = useRunSteps(runRef.runId, refetchMs);
  const errors = useRunErrors(runRef.runId, refetchMs);
  const job = useJob(run.data?.job_id);

  // Live updates via the orchestrator's SSE channel. Each event invalidates
  // exactly the queries the screen depends on — TanStack Query then refetches
  // and the UI re-renders with whatever just changed.
  useEffect(() => {
    if (!isInFlight) return;
    const unsub = subscribe(`/api/runs/${runRef.runId}/events`, (type) => {
      if (type === 'ping') return;
      qc.invalidateQueries({ queryKey: ['run', runRef.runId] });
      qc.invalidateQueries({ queryKey: ['run', runRef.runId, 'steps'] });
      if (type === 'run.error' || type === 'run.finished') {
        qc.invalidateQueries({ queryKey: ['run', runRef.runId, 'errors'] });
      }
    });
    return unsub;
  }, [isInFlight, runRef.runId, qc]);

  const cancelRun = useCancelRun();
  const runJob = useRunJob();

  if (run.isPending) return <RunSkeleton runRef={runRef} onBack={onBack} />;
  if (run.isError) {
    return (
      <div className="p-8">
        <InlineBanner
          tone="danger"
          title="Could not load run."
          description={run.error instanceof Error ? run.error.message : 'Unknown error'}
          action={
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<I.refresh size={12} />}
              onClick={() => run.refetch()}
            >
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const r = run.data!;
  const jobCode = r.job_code;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center gap-2 text-sm text-text-muted dark:text-d-text-muted">
          <button onClick={onBack} className="hover:text-text dark:hover:text-d-text">
            Jobs
          </button>
          <I.chevronRight size={12} />
          <button
            onClick={onBack}
            className="hover:text-text dark:hover:text-d-text font-mono"
          >
            {jobCode}
          </button>
          <I.chevronRight size={12} />
          <span className="text-text dark:text-d-text font-mono">
            run_{String(r.id).padStart(4, '0')}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text font-mono">
              {jobCode}
            </h1>
            <StatusBadge status={r.status} />
            <span className="text-sm text-text-muted dark:text-d-text-muted flex items-center gap-1.5">
              <I.clock size={12} />
              <span className="tabular">
                {r.duration_sec != null
                  ? formatDuration(r.duration_sec)
                  : isInFlight
                  ? <LiveDuration startedAt={r.started_at} />
                  : '—'}
              </span>
            </span>
            <span className="text-sm text-text-muted dark:text-d-text-muted flex items-center gap-1.5">
              <I.user size={12} />
              Triggered by{' '}
              <span className="text-text dark:text-d-text">{r.triggered_by}</span>
            </span>
            <span className="text-xs text-text-subtle dark:text-d-text-subtle font-mono">
              started {r.started_at ? r.started_at.replace('T', ' ').slice(0, 19) + ' UTC' : '—'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" iconLeft={<I.terminal size={14} />}>
              Open in console
            </Button>
            <Button
              variant="secondary"
              size="md"
              iconLeft={<I.x size={14} />}
              disabled={!isInFlight}
              loading={cancelRun.isPending}
              onClick={() =>
                cancelRun.mutate(r.id, {
                  onSuccess: () =>
                    toast.push({ tone: 'info', title: 'Cancellation requested' }),
                })
              }
            >
              Cancel run
            </Button>
            <Button
              variant="primary"
              size="md"
              iconLeft={<I.refresh size={14} />}
              loading={runJob.isPending}
              onClick={() =>
                runJob.mutate(
                  { jobId: r.job_id, triggeredBy: CURRENT_OPERATOR },
                  {
                    onSuccess: () =>
                      toast.push({
                        tone: 'success',
                        title: `Queued ${jobCode} again`,
                      }),
                  },
                )
              }
            >
              Run again
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <StepTimeline
            steps={steps.data ?? []}
            isLoading={steps.isPending}
          />
        </div>
      </div>

      <div className="px-8 pt-3 flex-1 min-h-0 flex flex-col">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          tabs={[
            { value: 'summary', label: 'Summary' },
            { value: 'errors', label: 'Errors', count: errors.data?.length },
            { value: 'recon', label: 'Reconciliation' },
            { value: 'log', label: 'Raw log' },
          ]}
          right={
            isInFlight ? (
              <span className="text-xs text-text-subtle dark:text-d-text-subtle inline-flex items-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-success lb-pulse" />
                Live · streaming via SSE
              </span>
            ) : (
              <span className="text-xs text-text-subtle dark:text-d-text-subtle">
                {r.status}
              </span>
            )
          }
        />

        <div className="flex-1 min-h-0 overflow-auto py-4">
          {tab === 'summary' && (
            <RunSummary
              run={r}
              job={job.data}
              steps={steps.data ?? []}
              errorCount={errors.data?.length ?? r.error_count}
            />
          )}
          {tab === 'errors' && (
            <RunErrorsTable errors={errors.data ?? []} isLoading={errors.isPending} />
          )}
          {tab === 'recon' && <RunRecon run={r} />}
          {tab === 'log' && <RunRawLog />}
        </div>
      </div>
    </div>
  );
}

function LiveDuration({ startedAt }: { startedAt: string | null }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!startedAt) return <>—</>;
  const sec = Math.max(0, Math.floor((Date.now() - Date.parse(startedAt)) / 1000));
  void tick;
  return <>{formatDuration(sec)}</>;
}

function StepTimeline({
  steps,
  isLoading,
}: {
  steps: ApiRunStep[];
  isLoading: boolean;
}) {
  // Always render the canonical six-step order — the API may not have inserted
  // pending rows yet on a freshly-queued run.
  const byName = new Map(steps.map((s) => [s.step_name, s]));

  if (isLoading) {
    return (
      <div className="flex items-center gap-3">
        {STEP_ORDER.map((s) => (
          <SkeletonBlock key={s} w={110} h={24} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center">
      {STEP_ORDER.map((name, i) => {
        const step = byName.get(name);
        const status = step?.status ?? 'pending';
        const progress = step?.progress_pct ?? 0;
        const done = status === 'succeeded';
        const active = status === 'running';
        const failed = status === 'failed';
        return (
          <Fragment key={name}>
            <div className="flex flex-col items-center gap-1.5 min-w-[110px]">
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    'inline-flex items-center justify-center w-5 h-5 rounded-full border-2',
                    done && 'bg-success/10 border-success text-success',
                    active && 'bg-brand/10 border-brand text-brand lb-pulse',
                    failed && 'bg-danger/10 border-danger text-danger',
                    !done && !active && !failed &&
                      'bg-surface dark:bg-d-surface border-border-strong dark:border-d-border-strong text-text-subtle dark:text-d-text-subtle',
                  )}
                >
                  {done ? (
                    <I.check size={11} strokeWidth={2.5} />
                  ) : active ? (
                    <span className="block w-1.5 h-1.5 rounded-full bg-brand" />
                  ) : failed ? (
                    <I.x size={11} strokeWidth={2.5} />
                  ) : (
                    <span className="text-[10px] tabular">{i + 1}</span>
                  )}
                </span>
                <span
                  className={cx(
                    'text-sm capitalize',
                    done && 'text-text dark:text-d-text',
                    active && 'text-text dark:text-d-text font-medium',
                    failed && 'text-danger',
                    !done && !active && !failed &&
                      'text-text-muted dark:text-d-text-muted',
                  )}
                >
                  {name}
                </span>
              </div>
              <div className="text-xs text-text-subtle dark:text-d-text-subtle tabular">
                {step?.duration_sec != null
                  ? formatDuration(Math.round(step.duration_sec))
                  : active
                  ? `${progress}%`
                  : '—'}
              </div>
            </div>
            {i < STEP_ORDER.length - 1 && (
              <div className="flex-1 h-px bg-border dark:bg-d-border relative overflow-hidden">
                {(done || (active && progress > 0)) && (
                  <div
                    className={cx('absolute inset-y-0 left-0', done ? 'bg-success' : 'bg-brand')}
                    style={{ width: done ? '100%' : `${progress}%` }}
                  />
                )}
              </div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

function RunSummary({
  run,
  job,
  steps,
  errorCount,
}: {
  run: ApiRun;
  job: ReturnType<typeof useJob>['data'];
  steps: ApiRunStep[];
  errorCount: number;
}) {
  const kv: Array<[string, ReactNode]> = [
    ['Job code', <span className="font-mono">{run.job_code}</span>],
    ['Run id', <span className="font-mono">run_{String(run.id).padStart(4, '0')}</span>],
    ['Source', <span className="font-mono">{job?.source_id ?? '—'}</span>],
    ['Source object', <span className="font-mono">{job?.source_object ?? '—'}</span>],
    [
      'Target',
      <span className="font-mono">
        {job ? `${job.target_schema}.${job.target_table}` : '—'}
      </span>,
    ],
    ['Strategy', job ? <Tag>{job.strategy}</Tag> : '—'],
    [
      'Watermark column',
      <span className="font-mono">{job?.watermark_column ?? '—'}</span>,
    ],
    [
      'Watermark before',
      <span className="font-mono">{run.watermark_before ?? '—'}</span>,
    ],
    [
      'Watermark after',
      <span className="font-mono">{run.watermark_after ?? '—'}</span>,
    ],
    ['Triggered by', <span>{run.triggered_by}</span>],
    [
      'Triggered at',
      <span className="font-mono">
        {run.triggered_at.replace('T', ' ').slice(0, 19)} UTC
      </span>,
    ],
    ['Run mode', <Tag>{run.run_mode}</Tag>],
  ];

  // Pending: a thoroughput/RPS endpoint. For now render a sparse summary.
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
          <h3 className="text-base font-medium text-text dark:text-d-text">Run details</h3>
          <span className="text-xs text-text-subtle dark:text-d-text-subtle">
            {formatRelative(run.triggered_at)}
          </span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-border dark:divide-d-border">
          {[kv.slice(0, 6), kv.slice(6)].map((col, ci) => (
            <dl key={ci} className="divide-y divide-border dark:divide-d-border">
              {col.map(([k, v], i) => (
                <div
                  key={i}
                  className="px-4 py-2 flex items-center justify-between text-sm"
                >
                  <dt className="text-text-muted dark:text-d-text-muted">{k}</dt>
                  <dd className="text-text dark:text-d-text">{v}</dd>
                </div>
              ))}
            </dl>
          ))}
        </div>
      </div>

      <div className="col-span-5 grid grid-cols-2 gap-4 auto-rows-min">
        <KpiTile
          label="Rows loaded"
          value={formatInt(run.rows_loaded)}
          sub={runRowsSubLabel(steps)}
          tone="brand"
        />
        <KpiTile
          label="Duration"
          value={run.duration_sec != null ? formatDuration(run.duration_sec) : '—'}
          sub={
            run.finished_at
              ? `finished ${formatRelative(run.finished_at)}`
              : 'in flight'
          }
        />
        <KpiTile
          label="Errors"
          value={String(errorCount)}
          sub={errorCount === 0 ? 'clean run' : 'see Errors tab'}
          tone={errorCount > 12 ? 'warning' : errorCount > 0 ? 'default' : 'default'}
        />
        <KpiTile
          label="Watermark"
          value={run.watermark_after ? '↑ advanced' : '—'}
          sub={run.watermark_after ?? 'no watermark for this strategy'}
        />
      </div>
    </div>
  );
}

function runRowsSubLabel(steps: ApiRunStep[]): string {
  const extract = steps.find((s) => s.step_name === 'extract');
  if (!extract) return '—';
  if (extract.status === 'running') return `${extract.progress_pct}% of source`;
  return `${formatInt(extract.rows_processed)} extracted`;
}

function KpiTile({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string;
  value: string;
  sub: string;
  tone?: 'default' | 'brand' | 'warning' | 'danger';
}) {
  const accent =
    tone === 'brand'
      ? 'text-brand'
      : tone === 'warning'
      ? 'text-warning'
      : tone === 'danger'
      ? 'text-danger'
      : 'text-text dark:text-d-text';
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-3">
      <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className={cx('text-xl font-semibold tabular mt-1', accent)}>{value}</div>
      <div className="text-xs text-text-subtle dark:text-d-text-subtle mt-0.5">{sub}</div>
    </div>
  );
}

function RunErrorsTable({
  errors,
  isLoading,
}: {
  errors: ApiRunError[];
  isLoading: boolean;
}) {
  const [selected, setSelected] = useState<ApiRunError | null>(errors[0] ?? null);
  useEffect(() => {
    if (selected == null && errors[0]) setSelected(errors[0]);
  }, [errors, selected]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-12 gap-4 h-full">
        <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} h={20} />
          ))}
        </div>
        <div className="col-span-5 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-4">
          <SkeletonBlock h={180} />
        </div>
      </div>
    );
  }

  if (errors.length === 0) {
    return (
      <EmptyState
        icon={<I.check size={20} />}
        title="No errors recorded."
        description="This run completed without recording any error or warning rows."
      />
    );
  }

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium text-text dark:text-d-text">{errors.length} errors</span>
            <span className="text-text-muted dark:text-d-text-muted">
              {' '}· {new Set(errors.map((e) => e.code)).size} unique codes
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" iconLeft={<I.download size={12} />}>
              Export
            </Button>
            <Button variant="ghost" size="sm" iconLeft={<I.copy size={12} />}>
              Copy
            </Button>
          </div>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 56 }} />
              <col style={{ width: 130 }} />
              <col />
              <col style={{ width: 110 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr>
                {['Sev', 'Code', 'Message', 'Source PK', 'Captured'].map((h) => (
                  <th
                    key={h}
                    className="h-8 px-3 text-left text-xs font-medium text-text-muted dark:text-d-text-muted uppercase tracking-wide border-b border-border dark:border-d-border bg-surface dark:bg-d-surface sticky top-0"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => {
                const active = selected?.id === e.id;
                return (
                  <tr
                    key={e.id}
                    onClick={() => setSelected(e)}
                    className={cx(
                      'border-b border-border dark:border-d-border cursor-pointer',
                      active
                        ? 'bg-brand/5 dark:bg-brand/10'
                        : 'hover:bg-surface-2 dark:hover:bg-d-surface-2',
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
                    <td className="px-3 truncate text-text-muted dark:text-d-text-muted">
                      {e.message}
                    </td>
                    <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                      {e.source_pk ?? '—'}
                    </td>
                    <td className="px-3 text-xs text-text-muted dark:text-d-text-muted">
                      {formatRelative(e.captured_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="col-span-5 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusDot status={selected?.severity === 'error' ? 'failed' : 'warning'} />
            <span className="font-mono text-sm text-text dark:text-d-text">
              {selected?.code ?? '—'}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<I.copy size={12} />}
            onClick={() =>
              selected &&
              navigator.clipboard?.writeText(JSON.stringify(selected, null, 2))
            }
          >
            Copy JSON
          </Button>
        </div>
        <div className="p-3 overflow-auto flex-1">
          <pre className="font-mono text-xs text-text dark:text-d-text whitespace-pre-wrap break-all leading-relaxed">
            {selected ? JSON.stringify(selected, null, 2) : '(no error selected)'}
          </pre>
        </div>
      </div>
    </div>
  );
}

function RunRecon({ run }: { run: ApiRun }) {
  // Hash-bucket recon isn't wired yet — the orchestrator currently only
  // records counts (see /db/migrations/0004 + the engine's recon step).
  // Show the count-based result and leave the hash table as a TODO chip.
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
      <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
        <h3 className="text-base font-medium text-text dark:text-d-text">Reconciliation</h3>
        <span className="text-xs text-text-subtle dark:text-d-text-subtle font-mono tabular">
          {run.finished_at ? formatRelative(run.finished_at) : 'computing'}
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border dark:divide-d-border">
        <ReconCol
          label="Rows loaded"
          value={formatInt(run.rows_loaded)}
          sub="target write completed"
          status="ok"
        />
        <ReconCol
          label="Errors"
          value={String(run.error_count)}
          sub={run.error_count === 0 ? 'clean' : 'see Errors tab'}
          status={run.error_count > 0 ? 'warn' : 'ok'}
        />
        <ReconCol
          label="Watermark"
          value={run.watermark_after ?? '—'}
          sub={run.watermark_after ? 'advanced this run' : 'not applicable'}
          status="ok"
        />
      </div>
      <div className="px-4 py-3 border-t border-border dark:border-d-border">
        <InlineBanner
          tone="info"
          title="Row-hash check not wired yet."
          description="Hash bucket reconciliation needs canonical Oracle↔SQL Server column ordering. Schema is ready (lakebridge.recon_hash_buckets); turning on shortly."
        />
      </div>
    </div>
  );
}

function ReconCol({
  label,
  value,
  sub,
  status,
}: {
  label: string;
  value: string;
  sub: string;
  status: 'ok' | 'warn';
}) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
        {label}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <span className="text-xl font-semibold tabular text-text dark:text-d-text break-all">
          {value}
        </span>
        <StatusDot status={status === 'ok' ? 'succeeded' : 'warning'} />
      </div>
      <div className="text-xs text-text-subtle dark:text-d-text-subtle mt-1">{sub}</div>
    </div>
  );
}

function RunRawLog() {
  // The orchestrator doesn't expose a log stream yet — structlog writes to
  // stdout but isn't tailable via HTTP. Coming next: GET /api/runs/:id/log
  // (Server-Sent Events of stdout lines, filtered to the run's correlation id).
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium text-text dark:text-d-text">Raw log</span>
          <span className="text-text-muted dark:text-d-text-muted">
            {' '}· not yet streamed
          </span>
        </div>
      </div>
      <div className="p-6">
        <EmptyState
          icon={<I.terminal size={20} />}
          title="Log streaming pending."
          description="GET /api/runs/:id/log isn’t implemented yet. For now, exec into the orchestrator pod and tail stdout filtered by run_id."
        />
      </div>
    </div>
  );
}

function RunSkeleton({ runRef, onBack }: { runRef: RunRef; onBack?: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="text-sm text-text-muted dark:text-d-text-muted">
          <button onClick={onBack} className="hover:text-text dark:hover:text-d-text">
            Jobs
          </button>
          <span className="mx-2">/</span>
          <span className="font-mono text-text dark:text-d-text">
            {runRef.jobCode ?? `run_${runRef.runId}`}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-4">
          <SkeletonBlock w={260} h={22} />
          <SkeletonBlock w={80} h={20} />
          <SkeletonBlock w={120} h={14} />
        </div>
        <div className="mt-6 flex items-center gap-3">
          {STEP_ORDER.map((s) => (
            <SkeletonBlock key={s} w={110} h={24} />
          ))}
        </div>
      </div>
    </div>
  );
}

