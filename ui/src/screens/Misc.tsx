import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  EmptyState,
  InlineBanner,
  LakebridgeMark,
  SkeletonBlock,
  StatusBadge,
  Tabs,
  Tag,
  useToast,
} from '../components/primitives';
import {
  useAudit,
  useAuthConfig,
  useDevSignIn,
  useJob,
  useJobRuns,
  useJobSchema,
  useReconMatrix,
  useRunJob,
  useSourceObjects,
  useSources,
  useTestConnection,
  useToggleJob,
  useUsers,
} from '../api/queries';
import {
  formatDuration,
  formatInt,
  formatPercent,
  formatRelative,
} from '../api/format';
import type { ApiJob, ApiMe, ApiSource, ReconResult } from '../api/types';
import type { JobRef, RunRef } from '../App';

// ── Job detail ──────────────────────────────────────────────────────────────
export function JobDetail({
  me,
  jobRef,
  onBack,
  onOpenRun,
}: {
  me: ApiMe;
  jobRef: JobRef;
  onBack?: () => void;
  onOpenRun?: (ref: RunRef) => void;
}) {
  const canWrite = me.role !== 'Read-only';
  const toast = useToast();
  const job = useJob(jobRef.jobId);
  const runJob = useRunJob();
  const toggleJob = useToggleJob();
  const [tab, setTab] = useState<'config' | 'schema' | 'history' | 'watermarks'>('config');

  if (job.isError) {
    return (
      <div className="p-8">
        <InlineBanner
          tone="danger"
          title="Could not load job."
          description={job.error instanceof Error ? job.error.message : 'Unknown error'}
          action={
            <Button variant="secondary" size="sm" onClick={() => job.refetch()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  const j = job.data;

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center gap-2 text-sm text-text-muted dark:text-d-text-muted">
          <button onClick={onBack} className="hover:text-text dark:hover:text-d-text">
            Jobs
          </button>
          <I.chevronRight size={12} />
          <span className="text-text dark:text-d-text font-mono">{jobRef.jobCode}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text font-mono">
              {jobRef.jobCode}
            </h1>
            {j ? (
              <>
                <StatusBadge status={j.enabled ? 'succeeded' : 'cancelled'} />
                <span className="text-sm text-text-muted dark:text-d-text-muted font-mono">
                  {j.source_id} → {j.target_schema}.{j.target_table}
                </span>
              </>
            ) : (
              <SkeletonBlock w={220} h={20} />
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="md"
              iconLeft={<I.pause size={14} />}
              disabled={!j || !canWrite}
              title={canWrite ? undefined : 'Read-only role'}
              loading={toggleJob.isPending}
              onClick={() =>
                j &&
                toggleJob.mutate(
                  { jobId: j.id, enabled: !j.enabled },
                  {
                    onSuccess: () =>
                      toast.push({
                        tone: 'info',
                        title: j.enabled ? `Disabled ${j.code}` : `Enabled ${j.code}`,
                      }),
                  },
                )
              }
            >
              {j?.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant="primary"
              size="md"
              iconLeft={<I.play size={14} />}
              disabled={!j || !canWrite}
              title={canWrite ? undefined : 'Read-only role'}
              loading={runJob.isPending}
              onClick={() =>
                j &&
                runJob.mutate(
                  { jobId: j.id },
                  {
                    onSuccess: (data) => {
                      toast.push({
                        tone: 'success',
                        title: `Queued ${j.code}`,
                        description: `Run #${data.run_id}`,
                      });
                      onOpenRun?.({ runId: data.run_id, jobCode: j.code });
                    },
                  },
                )
              }
            >
              Run now
            </Button>
          </div>
        </div>
      </div>

      <div className="px-8 pt-3 flex-1 min-h-0 flex flex-col">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          tabs={[
            { value: 'config', label: 'Configuration' },
            { value: 'schema', label: 'Schema' },
            { value: 'history', label: 'Run history' },
            { value: 'watermarks', label: 'Watermarks' },
          ]}
        />
        <div className="flex-1 min-h-0 overflow-auto py-4">
          {tab === 'config' && <JobConfig job={j} isLoading={job.isPending} />}
          {tab === 'schema' && j && <JobSchema jobId={j.id} />}
          {tab === 'history' && j && (
            <JobHistory jobId={j.id} jobCode={j.code} onOpenRun={onOpenRun} />
          )}
          {tab === 'watermarks' && j && <JobWatermarks job={j} />}
        </div>
      </div>
    </div>
  );
}

function JobConfig({ job, isLoading }: { job: ApiJob | undefined; isLoading: boolean }) {
  if (isLoading || !job) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <SkeletonBlock key={i} h={20} />
        ))}
      </div>
    );
  }
  const rows: Array<[string, ReactNode]> = [
    ['Code', <span className="font-mono">{job.code}</span>],
    ['Source system', <span className="font-mono">{job.source_id}</span>],
    ['Source object', <span className="font-mono">{job.source_object}</span>],
    ['Target schema', <span className="font-mono">{job.target_schema}</span>],
    ['Target table', <span className="font-mono">{job.target_table}</span>],
    ['Strategy', <Tag>{job.strategy}</Tag>],
    [
      'Schedule',
      job.schedule === 'manual' ? (
        <Tag>manual</Tag>
      ) : (
        <span className="font-mono">{job.schedule}</span>
      ),
    ],
    [
      'Watermark column',
      <span className="font-mono">{job.watermark_column ?? '—'}</span>,
    ],
    [
      'Batch size',
      <span className="font-mono tabular">{formatInt(job.batch_size)} rows</span>,
    ],
    [
      'Retries',
      <span className="font-mono tabular">{job.retries} · backoff exp(2s, 60s)</span>,
    ],
    [
      'Timeout',
      <span className="font-mono tabular">{formatDuration(job.timeout_sec)}</span>,
    ],
    ['Owner', <span>{job.owner}</span>],
  ];
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-8 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
          <h3 className="text-base font-medium text-text dark:text-d-text">Configuration</h3>
          <Button variant="ghost" size="sm" iconLeft={<I.pencil size={12} />}>
            Edit all
          </Button>
        </div>
        <dl>
          {rows.map(([k, v], i) => (
            <div
              key={i}
              className="px-4 py-2 flex items-center justify-between border-t border-border dark:border-d-border first:border-t-0 text-sm group"
            >
              <dt className="text-text-muted dark:text-d-text-muted">{k}</dt>
              <dd className="flex items-center gap-2 text-text dark:text-d-text">
                {v}
                <button className="opacity-0 group-hover:opacity-100 text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text transition-opacity">
                  <I.pencil size={12} />
                </button>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="col-span-4 space-y-4">
        <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
          <div className="px-4 py-2.5 border-b border-border dark:border-d-border">
            <h3 className="text-base font-medium text-text dark:text-d-text">Danger zone</h3>
          </div>
          <div className="p-4 space-y-2">
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              iconLeft={<I.refresh size={12} />}
            >
              Reset watermark
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="w-full justify-start"
              iconLeft={<I.copy size={12} />}
            >
              Clone job
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-danger hover:bg-danger/10 hover:text-danger"
              iconLeft={<I.x size={12} />}
            >
              Delete job
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function JobSchema({ jobId }: { jobId: number }) {
  const schema = useJobSchema(jobId);

  if (schema.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} h={28} />
        ))}
      </div>
    );
  }
  if (schema.isError) {
    return (
      <InlineBanner
        tone="danger"
        title="Schema introspection failed."
        description={
          schema.error instanceof Error
            ? schema.error.message
            : 'Could not reach the source or target.'
        }
        action={
          <Button variant="secondary" size="sm" onClick={() => schema.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const s = schema.data!;
  const driftCount = s.mapping.filter((m) => m.drift !== null).length;
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-medium text-text dark:text-d-text">Schema mapping</h3>
          <Tag>{s.mapping.length} columns</Tag>
          {driftCount > 0 && (
            <Tag className="border-warning/40 text-warning">{driftCount} drift</Tag>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          iconLeft={<I.refresh size={12} />}
          loading={schema.isFetching}
          onClick={() => schema.refetch()}
        >
          Re-detect
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
            <th className="text-left py-2 px-4 font-medium">Source column</th>
            <th className="text-left py-2 px-3 font-medium">Source type</th>
            <th className="text-left py-2 px-3 font-medium w-6"></th>
            <th className="text-left py-2 px-3 font-medium">Target column</th>
            <th className="text-left py-2 px-3 font-medium">Target type</th>
            <th className="text-left py-2 px-4 font-medium">Drift</th>
          </tr>
        </thead>
        <tbody>
          {s.mapping.map((m, i) => (
            <tr
              key={i}
              className={cx(
                'border-t border-border dark:border-d-border',
                m.drift && 'bg-warning/5 dark:bg-warning/10',
              )}
            >
              <td className="py-1.5 px-4 font-mono text-text dark:text-d-text">
                {m.src?.name ?? '—'}
              </td>
              <td className="py-1.5 px-3 font-mono text-text-muted dark:text-d-text-muted">
                {m.src?.data_type ?? '—'}
              </td>
              <td className="py-1.5 px-3 text-text-subtle dark:text-d-text-subtle">
                <I.arrowRight size={12} />
              </td>
              <td
                className={cx(
                  'py-1.5 px-3 font-mono',
                  m.tgt ? 'text-text dark:text-d-text' : 'text-text-subtle dark:text-d-text-subtle',
                )}
              >
                {m.tgt?.name ?? '— (not mapped)'}
              </td>
              <td className="py-1.5 px-3 font-mono text-text-muted dark:text-d-text-muted">
                {m.tgt?.data_type ?? '—'}
              </td>
              <td className="py-1.5 px-4">
                {m.drift === 'cast' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} />
                    Implicit cast
                  </span>
                )}
                {m.drift === 'new' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} />
                    New, unmapped
                  </span>
                )}
                {m.drift === 'missing' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} />
                    Target only
                  </span>
                )}
                {!m.drift && (
                  <span className="text-xs text-text-subtle dark:text-d-text-subtle">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobHistory({
  jobId,
  jobCode,
  onOpenRun,
}: {
  jobId: number;
  jobCode: string;
  onOpenRun?: (ref: RunRef) => void;
}) {
  const runs = useJobRuns(jobId, 100);

  if (runs.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} h={20} />
        ))}
      </div>
    );
  }
  if (runs.isError) {
    return (
      <InlineBanner
        tone="danger"
        title="Could not load run history."
        description={runs.error instanceof Error ? runs.error.message : 'Unknown error'}
      />
    );
  }
  if (!runs.data || runs.data.length === 0) {
    return (
      <EmptyState
        icon={<I.activity size={20} />}
        title="No runs yet."
        description="Trigger one with ‘Run now’ to populate the history."
      />
    );
  }

  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
            <th className="text-left py-2 px-4 font-medium">Status</th>
            <th className="text-left py-2 px-3 font-medium">Run id</th>
            <th className="text-left py-2 px-3 font-medium">Started</th>
            <th className="text-right py-2 px-3 font-medium">Duration</th>
            <th className="text-right py-2 px-3 font-medium">Rows</th>
            <th className="text-right py-2 px-4 font-medium">Throughput</th>
          </tr>
        </thead>
        <tbody>
          {runs.data.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpenRun?.({ runId: r.id, jobCode })}
              className="border-t border-border dark:border-d-border cursor-pointer hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 32 }}
            >
              <td className="px-4">
                <StatusBadge status={r.status} dense />
              </td>
              <td className="px-3 font-mono text-text dark:text-d-text">
                run_{String(r.id).padStart(4, '0')}
              </td>
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {r.started_at ?? r.triggered_at}
              </td>
              <td className="px-3 text-right tabular text-text dark:text-d-text">
                {r.duration_sec != null ? formatDuration(r.duration_sec) : '—'}
              </td>
              <td className="px-3 text-right tabular text-text dark:text-d-text">
                {formatInt(r.rows_loaded)}
              </td>
              <td className="px-4 text-right tabular text-text-muted dark:text-d-text-muted">
                {r.duration_sec && r.duration_sec > 0
                  ? formatInt(Math.round(r.rows_loaded / r.duration_sec)) + '/s'
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobWatermarks({ job }: { job: ApiJob }) {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border">
          <h3 className="text-base font-medium text-text dark:text-d-text">Watermark</h3>
        </div>
        <div className="p-4">
          {job.watermark_column ? (
            <>
              <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
                {job.watermark_column}
              </div>
              <div className="mt-1 font-mono text-xl text-text dark:text-d-text">
                see most recent run
              </div>
              <div className="mt-1 text-xs text-text-subtle dark:text-d-text-subtle">
                Strategy: {job.strategy}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<I.info size={20} />}
              title="This job doesn’t use a watermark."
              description={`Strategy is ${job.strategy} — every run reads the whole source.`}
            />
          )}
        </div>
      </div>
      <div className="col-span-5 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-4">
        <InlineBanner
          tone="info"
          title="Watermark history view pending."
          description="GET /api/jobs/:id/watermark-history isn’t built yet. The orchestrator already records advances in lakebridge.watermarks."
        />
      </div>
    </div>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
export function SourcesScreen({ me }: { me: ApiMe }) {
  const toast = useToast();
  const sources = useSources();
  const test = useTestConnection();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canWrite = me.role !== 'Read-only';

  const selected: ApiSource | undefined = sources.data?.find(
    (s) => s.id === (selectedId ?? sources.data[0]?.id),
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">
            Sources
          </h1>
          <Button variant="primary" size="md" iconLeft={<I.plus size={14} />}>
            New source
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-4 grid grid-cols-12 gap-4">
        <div className="col-span-5 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
          {sources.isPending ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <SkeletonBlock key={i} h={32} />
              ))}
            </div>
          ) : sources.isError ? (
            <div className="p-3">
              <InlineBanner
                tone="danger"
                title="Could not load sources."
                description={sources.error instanceof Error ? sources.error.message : 'Unknown error'}
                action={
                  <Button variant="secondary" size="sm" onClick={() => sources.refetch()}>
                    Retry
                  </Button>
                }
              />
            </div>
          ) : sources.data && sources.data.length === 0 ? (
            <EmptyState
              icon={<I.database size={20} />}
              title="No sources configured."
              description="Add one to start authoring jobs."
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
                  <th className="text-left py-2 px-4 font-medium">Source</th>
                  <th className="text-left py-2 px-3 font-medium">Host</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-right py-2 px-4 font-medium">Last test</th>
                </tr>
              </thead>
              <tbody>
                {(sources.data ?? []).map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedId(s.id)}
                    className={cx(
                      'border-t border-border dark:border-d-border cursor-pointer',
                      selected?.id === s.id
                        ? 'bg-brand/5 dark:bg-brand/10'
                        : 'hover:bg-surface-2 dark:hover:bg-d-surface-2',
                    )}
                    style={{ height: 36 }}
                  >
                    <td className="px-4 font-mono text-text dark:text-d-text">{s.id}</td>
                    <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                      {s.host}:{s.port}
                    </td>
                    <td className="px-3">
                      <StatusBadge status={s.status} dense />
                    </td>
                    <td className="px-4 text-right text-xs text-text-muted dark:text-d-text-muted">
                      {formatRelative(s.last_tested_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="col-span-7 space-y-4">
          {selected && (
            <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
              <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-medium text-text dark:text-d-text font-mono">
                    {selected.id}
                  </h3>
                  <StatusBadge status={selected.status} dense />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" iconLeft={<I.pencil size={12} />}>
                    Edit
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<I.zap size={12} />}
                    loading={test.isPending}
                    disabled={!canWrite}
                    title={canWrite ? undefined : 'Read-only role'}
                    onClick={() =>
                      test.mutate(selected.id, {
                        onSuccess: (r) =>
                          toast.push({
                            tone: r.ok ? 'success' : 'warning',
                            title: r.ok ? 'Connection OK' : 'Connection failed',
                            description: r.message,
                          }),
                      })
                    }
                  >
                    Test connection
                  </Button>
                </div>
              </div>
              <dl>
                {(
                  [
                    ['Host', <span className="font-mono">{selected.host}</span>],
                    ['Port', <span className="font-mono tabular">{selected.port}</span>],
                    ['SID', <span className="font-mono">{selected.sid}</span>],
                    [
                      'Service name',
                      <span className="font-mono">{selected.service_name ?? '—'}</span>,
                    ],
                    [
                      'Oracle version',
                      <span className="font-mono">{selected.oracle_version ?? '—'}</span>,
                    ],
                    ['Username', <span className="font-mono">{selected.username}</span>],
                    [
                      'Authentication',
                      <span className="inline-flex items-center gap-1.5">
                        <I.key size={12} className="text-text-muted dark:text-d-text-muted" />
                        Vault · {selected.secret_ref}
                      </span>,
                    ],
                    [
                      'TLS',
                      <Tag>{selected.tls_required ? 'required · TLSv1.3' : 'not required'}</Tag>,
                    ],
                    [
                      'Pool size',
                      <span className="font-mono tabular">{selected.pool_size}</span>,
                    ],
                  ] as Array<[string, ReactNode]>
                ).map(([k, v], i) => (
                  <div
                    key={i}
                    className="px-4 py-2 flex items-center justify-between border-t border-border dark:border-d-border text-sm"
                  >
                    <dt className="text-text-muted dark:text-d-text-muted">{k}</dt>
                    <dd className="text-text dark:text-d-text">{v}</dd>
                  </div>
                ))}
              </dl>
              {selected.last_test_msg && (
                <div
                  className={cx(
                    'px-4 py-2 border-t flex items-center gap-2 text-sm',
                    selected.status === 'ok'
                      ? 'border-success/30 bg-success/5 text-text dark:text-d-text'
                      : 'border-warning/30 bg-warning/5 text-text dark:text-d-text',
                  )}
                >
                  <span
                    className={cx(
                      'inline-block w-2 h-2 rounded-full',
                      selected.status === 'ok' ? 'bg-success' : 'bg-warning',
                    )}
                  />
                  <span className="font-mono text-xs">{selected.last_test_msg}</span>
                </div>
              )}
            </div>
          )}

          {selected && <SourceObjectsList sourceId={selected.id} />}
        </div>
      </div>
    </div>
  );
}

function SourceObjectsList({ sourceId }: { sourceId: string }) {
  const [filter, setFilter] = useState('IFSAPP.%');
  const objects = useSourceObjects(sourceId, filter.trim() || undefined, 200);

  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between gap-3">
        <h3 className="text-base font-medium text-text dark:text-d-text">Source objects</h3>
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="OWNER.%"
            className="w-44 h-7 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-xs font-mono"
          />
          <span className="text-xs text-text-subtle dark:text-d-text-subtle tabular">
            {objects.data?.length ?? '—'} matched
          </span>
        </div>
      </div>
      {objects.isPending ? (
        <div className="p-4 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonBlock key={i} h={20} />
          ))}
        </div>
      ) : objects.isError ? (
        <div className="p-3">
          <InlineBanner
            tone="danger"
            title="Could not list source objects."
            description={
              objects.error instanceof Error ? objects.error.message : 'Unknown error'
            }
            action={
              <Button variant="secondary" size="sm" onClick={() => objects.refetch()}>
                Retry
              </Button>
            }
          />
        </div>
      ) : objects.data && objects.data.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-text-muted dark:text-d-text-muted">
          No objects match this pattern.
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
              <th className="text-left py-2 px-4 font-medium">Object</th>
              <th className="text-left py-2 px-3 font-medium">Kind</th>
              <th className="text-right py-2 px-3 font-medium">Row count</th>
              <th className="text-right py-2 px-4 font-medium">Last analyzed</th>
            </tr>
          </thead>
          <tbody>
            {(objects.data ?? []).map((o) => (
              <tr
                key={o.name}
                className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
                style={{ height: 32 }}
              >
                <td className="px-4 font-mono text-text dark:text-d-text">{o.name}</td>
                <td className="px-3">
                  <Tag>{o.kind.toLowerCase()}</Tag>
                </td>
                <td className="px-3 text-right tabular text-text dark:text-d-text">
                  {o.num_rows == null ? '—' : formatInt(o.num_rows)}
                </td>
                <td className="px-4 text-right text-xs text-text-muted dark:text-d-text-muted">
                  {formatRelative(o.last_analyzed)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Reconciliation ──────────────────────────────────────────────────────────
export function ReconScreen({ onOpenJob }: { onOpenJob?: (ref: JobRef) => void }) {
  const recon = useReconMatrix(14, 6);
  const [hover, setHover] = useState<{
    key: string;
    cell: { source_count: number; target_count: number; checksum_match: boolean };
    code: string;
  } | null>(null);
  const tone = (r: ReconResult) =>
    r === 'ok' ? 'bg-success' : r === 'warn' ? 'bg-warning' : 'bg-danger';

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">
              Reconciliation
            </h1>
            <p className="text-sm text-text-muted dark:text-d-text-muted">
              Source vs target counts and checksums · last 6 runs
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" iconLeft={<I.download size={14} />}>
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="md"
              iconLeft={<I.refresh size={14} />}
              loading={recon.isFetching}
              onClick={() => recon.refetch()}
            >
              Refresh
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-4">
        {recon.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 14 }).map((_, i) => (
              <SkeletonBlock key={i} h={28} />
            ))}
          </div>
        ) : recon.isError ? (
          <InlineBanner
            tone="danger"
            title="Could not load reconciliation matrix."
            description={recon.error instanceof Error ? recon.error.message : 'Unknown error'}
          />
        ) : !recon.data || recon.data.length === 0 ? (
          <EmptyState
            icon={<I.gitCompareArrows size={20} />}
            title="No reconciliation data yet."
            description="Recon cells appear after the first successful run of a job."
          />
        ) : (
          <>
            <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden relative">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wide text-text-muted dark:text-d-text-muted border-b border-border dark:border-d-border bg-surface dark:bg-d-surface">
                      Job
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-medium uppercase tracking-wide text-text-muted dark:text-d-text-muted border-b border-border dark:border-d-border bg-surface dark:bg-d-surface">
                      Target
                    </th>
                    {Array.from({ length: 6 }, (_, k) => (
                      <th
                        key={k}
                        className="py-2 text-xs font-medium uppercase tracking-wide text-text-muted dark:text-d-text-muted border-b border-border dark:border-d-border bg-surface dark:bg-d-surface text-center"
                      >
                        run −{5 - k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recon.data.map((row, i) => (
                    <tr
                      key={row.job.job_id}
                      className="border-t border-border dark:border-d-border"
                      style={{ height: 36 }}
                    >
                      <td
                        className="px-3 font-mono text-text dark:text-d-text cursor-pointer hover:underline"
                        onClick={() =>
                          onOpenJob?.({ jobId: row.job.job_id, jobCode: row.job.code })
                        }
                      >
                        {row.job.code}
                      </td>
                      <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                        {row.job.target_schema}.{row.job.target_table}
                      </td>
                      {Array.from({ length: 6 }, (_, k) => {
                        const c = row.cells[k];
                        const key = `${i}-${k}`;
                        if (!c) {
                          return (
                            <td key={k} className="px-1">
                              <div className="w-full h-6 rounded-sm border border-border dark:border-d-border bg-surface-2 dark:bg-d-surface-2" />
                            </td>
                          );
                        }
                        return (
                          <td key={k} className="px-1 relative">
                            <button
                              onMouseEnter={() =>
                                setHover({ key, cell: c, code: row.job.code })
                              }
                              onMouseLeave={() => setHover(null)}
                              className={cx(
                                'w-full h-6 rounded-sm border',
                                tone(c.result),
                                'border-black/5 dark:border-white/5 hover:ring-2 hover:ring-text dark:hover:ring-d-text hover:ring-offset-1 hover:ring-offset-surface dark:hover:ring-offset-d-surface transition-shadow',
                              )}
                              aria-label={c.result}
                            />
                            {hover && hover.key === key && (
                              <div className="absolute z-30 left-1/2 -translate-x-1/2 -top-2 -translate-y-full bg-text text-surface dark:bg-d-text dark:text-d-bg rounded-md shadow-overlay-dark px-3 py-2 text-xs whitespace-nowrap font-mono">
                                <div className="font-medium">{hover.code}</div>
                                <div className="mt-1 text-text-subtle dark:text-d-text-subtle">
                                  source: {formatInt(hover.cell.source_count)}
                                </div>
                                <div className="text-text-subtle dark:text-d-text-subtle">
                                  target: {formatInt(hover.cell.target_count)}
                                </div>
                                <div className="text-text-subtle dark:text-d-text-subtle">
                                  checksum:{' '}
                                  {hover.cell.checksum_match ? 'match' : 'drift'}
                                </div>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 flex items-center gap-4 text-xs">
              <span className="inline-flex items-center gap-1.5 text-text-muted dark:text-d-text-muted">
                <span className="w-3 h-3 rounded-sm bg-success" /> Match
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-muted dark:text-d-text-muted">
                <span className="w-3 h-3 rounded-sm bg-warning" /> Variance within threshold
              </span>
              <span className="inline-flex items-center gap-1.5 text-text-muted dark:text-d-text-muted">
                <span className="w-3 h-3 rounded-sm bg-danger" /> Checksum drift
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
export function SettingsScreen({ me }: { me: ApiMe }) {
  const isAdmin = me.role === 'Admin';
  // The Users + Audit tabs require Admin; non-admins land on Sources.
  const initialTab: 'users' | 'sources' | 'audit' = isAdmin ? 'users' : 'sources';
  const [sub, setSub] = useState<'users' | 'sources' | 'audit'>(initialTab);
  const tabs = [
    ...(isAdmin ? [{ value: 'users', label: 'Users' }] : []),
    { value: 'sources', label: 'Sources' },
    ...(isAdmin ? [{ value: 'audit', label: 'Audit log' }] : []),
  ];
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text">
          Settings
        </h1>
      </div>
      <div className="px-8 pt-3 flex-1 min-h-0 flex flex-col">
        <Tabs
          value={sub}
          onChange={(v) => setSub(v as typeof sub)}
          tabs={tabs}
        />
        <div className="flex-1 min-h-0 overflow-auto py-4">
          {sub === 'users' && isAdmin && <UsersTable />}
          {sub === 'sources' && <SourcesSettingsTable />}
          {sub === 'audit' && isAdmin && <AuditTable />}
        </div>
      </div>
    </div>
  );
}

function UsersTable() {
  const users = useUsers();

  if (users.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} h={28} />
        ))}
      </div>
    );
  }
  if (users.isError) {
    return (
      <InlineBanner
        tone="danger"
        title="Could not load users."
        description={users.error instanceof Error ? users.error.message : 'Unknown error'}
      />
    );
  }

  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <span className="text-sm text-text-muted dark:text-d-text-muted">
          {users.data?.length ?? 0} users
        </span>
        <Button variant="primary" size="sm" iconLeft={<I.plus size={12} />}>
          Invite user
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
            <th className="text-left py-2 px-3 font-medium">Name</th>
            <th className="text-left py-2 px-3 font-medium">Email</th>
            <th className="text-left py-2 px-3 font-medium">Role</th>
            <th className="text-left py-2 px-3 font-medium">MFA</th>
            <th className="text-right py-2 px-3 font-medium">Last active</th>
            <th className="py-2 px-3 font-medium w-8"></th>
          </tr>
        </thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr
              key={u.id}
              className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 36 }}
            >
              <td className="px-3 text-text dark:text-d-text">{u.name}</td>
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {u.email}
              </td>
              <td className="px-3">
                <Tag>{u.role}</Tag>
              </td>
              <td className="px-3">
                {u.mfa_enabled ? (
                  <span className="inline-flex items-center gap-1.5 text-xs text-success">
                    <I.shield size={12} /> enabled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} /> required
                  </span>
                )}
              </td>
              <td className="px-3 text-right text-xs text-text-muted dark:text-d-text-muted">
                {formatRelative(u.last_active_at)}
              </td>
              <td className="px-3 text-right">
                <button className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text">
                  <I.more size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourcesSettingsTable() {
  const sources = useSources();
  if (sources.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} h={32} />
        ))}
      </div>
    );
  }
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
            <th className="text-left py-2 px-3 font-medium">Source</th>
            <th className="text-left py-2 px-3 font-medium">Host</th>
            <th className="text-left py-2 px-3 font-medium">SID</th>
            <th className="text-left py-2 px-3 font-medium">Status</th>
            <th className="text-right py-2 px-3 font-medium">Last test</th>
            <th className="py-2 px-3 w-8"></th>
          </tr>
        </thead>
        <tbody>
          {(sources.data ?? []).map((s) => (
            <tr
              key={s.id}
              className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 36 }}
            >
              <td className="px-3 font-mono text-text dark:text-d-text">{s.id}</td>
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {s.host}:{s.port}
              </td>
              <td className="px-3 font-mono text-text-muted dark:text-d-text-muted">{s.sid}</td>
              <td className="px-3">
                <StatusBadge status={s.status} dense />
              </td>
              <td className="px-3 text-right text-xs text-text-muted dark:text-d-text-muted">
                {formatRelative(s.last_tested_at)}
              </td>
              <td className="px-3 text-right">
                <button className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text">
                  <I.more size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable() {
  const audit = useAudit(200);

  if (audit.isPending) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonBlock key={i} h={20} />
        ))}
      </div>
    );
  }
  if (audit.isError) {
    return (
      <InlineBanner
        tone="danger"
        title="Could not load audit log."
        description={audit.error instanceof Error ? audit.error.message : 'Unknown error'}
      />
    );
  }
  if (!audit.data || audit.data.length === 0) {
    return (
      <EmptyState
        icon={<I.shield size={20} />}
        title="Audit log empty."
        description="Operator actions appear here as they happen."
      />
    );
  }

  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <span className="text-sm text-text-muted dark:text-d-text-muted">
          {audit.data.length} events · retained 90 days
        </span>
        <Button variant="ghost" size="sm" iconLeft={<I.download size={12} />}>
          Export
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
            <th className="text-left py-2 px-3 font-medium">Timestamp</th>
            <th className="text-left py-2 px-3 font-medium">Actor</th>
            <th className="text-left py-2 px-3 font-medium">Action</th>
            <th className="text-left py-2 px-3 font-medium">Target</th>
          </tr>
        </thead>
        <tbody>
          {audit.data.map((a) => (
            <tr
              key={a.id}
              className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 32 }}
            >
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {a.ts.replace('T', ' ').slice(0, 19)}
              </td>
              <td className="px-3 font-mono text-text dark:text-d-text">{a.actor}</td>
              <td className="px-3">
                <Tag mono>{a.action}</Tag>
              </td>
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {a.target}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Sign-in ─────────────────────────────────────────────────────────────────
export function SignIn() {
  const config = useAuthConfig();
  const devSignIn = useDevSignIn();
  const toast = useToast();
  const [devEmail, setDevEmail] = useState('');

  // Pick the first seeded user as the default selection once config arrives.
  if (!devEmail && config.data?.dev_users[0]) {
    setDevEmail(config.data.dev_users[0]);
  }

  const mode = config.data?.mode;
  const oktaUrl = config.data?.okta_login_url;
  const devUsers = config.data?.dev_users ?? [];

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg dark:bg-d-bg">
      <div className="w-[400px] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <LakebridgeMark size={20} />
          <span className="text-sm font-semibold text-text dark:text-d-text tracking-tight">
            Lakebridge
          </span>
        </div>
        <h1 className="text-lg font-medium text-text dark:text-d-text">Sign in</h1>
        <p className="mt-1 text-sm text-text-muted dark:text-d-text-muted">
          {mode === 'oidc'
            ? 'Use your corporate SSO. Local accounts are disabled.'
            : mode === 'dev'
            ? 'Dev mode — pick a seeded operator to impersonate.'
            : 'Checking session…'}
        </p>

        {config.isError && (
          <div className="mt-4">
            <InlineBanner
              tone="danger"
              title="Could not reach lakebridge-api."
              description={
                config.error instanceof Error ? config.error.message : 'Unknown error'
              }
            />
          </div>
        )}

        {mode === 'oidc' && oktaUrl && (
          <div className="mt-5 space-y-3">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              iconLeft={<I.shield size={14} />}
              onClick={() => {
                // Capture where the operator wanted to land after sign-in.
                window.location.href = `${oktaUrl}?return_to=${encodeURIComponent(
                  window.location.pathname + window.location.search,
                )}`;
              }}
            >
              Continue with Okta
            </Button>
          </div>
        )}

        {mode === 'dev' && (
          <div className="mt-5 space-y-3">
            <label className="block text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
              Impersonate
            </label>
            <select
              value={devEmail}
              onChange={(e) => setDevEmail(e.target.value)}
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-text dark:text-d-text text-sm font-mono"
            >
              {devUsers.length === 0 && <option value="">(no users seeded)</option>}
              {devUsers.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              iconLeft={<I.key size={14} />}
              loading={devSignIn.isPending}
              disabled={!devEmail}
              onClick={() =>
                devSignIn.mutate(devEmail, {
                  onError: (err: unknown) =>
                    toast.push({
                      tone: 'danger',
                      title: 'Sign-in failed',
                      description: err instanceof Error ? err.message : 'Unknown error',
                    }),
                })
              }
            >
              Continue as {devEmail || '—'}
            </Button>
            <p className="text-xs text-text-subtle dark:text-d-text-subtle">
              Dev mode is disabled in production builds — the picker won’t appear when
              <span className="font-mono"> LAKEBRIDGE_AUTH_MODE=oidc</span>.
            </p>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-border dark:border-d-border text-xs text-text-subtle dark:text-d-text-subtle font-mono">
          <div>mode · {mode ?? '—'}</div>
          <div>env · prod-eu · region eu-west-1</div>
        </div>
      </div>
    </div>
  );
}

