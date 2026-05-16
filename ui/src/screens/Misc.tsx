import { useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  LakebridgeMark,
  StatusBadge,
  Tabs,
  Tag,
} from '../components/primitives';
import {
  AUDIT,
  JOBS,
  RECON,
  SCHEMA_MAP,
  SOURCES,
  SOURCE_OBJECTS,
  USERS,
  type Job,
  type Source,
} from '../data/sample';

// ── Job detail ──────────────────────────────────────────────────────────────
export function JobDetail({
  job,
  onBack,
  onOpenRun,
}: {
  job?: Job;
  onBack?: () => void;
  onOpenRun?: (j: Job) => void;
}) {
  const j = job ?? JOBS[0];
  const [tab, setTab] = useState<'config' | 'schema' | 'history' | 'watermarks'>('config');

  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-6 pb-4 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg">
        <div className="flex items-center gap-2 text-sm text-text-muted dark:text-d-text-muted">
          <button onClick={onBack} className="hover:text-text dark:hover:text-d-text">
            Jobs
          </button>
          <I.chevronRight size={12} />
          <span className="text-text dark:text-d-text font-mono">{j.code}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text font-mono">
              {j.code}
            </h1>
            <StatusBadge status={j.status} />
            <span className="text-sm text-text-muted dark:text-d-text-muted font-mono">
              {j.source} → {j.target_table}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" iconLeft={<I.pause size={14} />}>
              {j.enabled ? 'Disable' : 'Enable'}
            </Button>
            <Button
              variant="secondary"
              size="md"
              iconLeft={<I.history size={14} />}
              onClick={() => onOpenRun?.(j)}
            >
              Latest run
            </Button>
            <Button variant="primary" size="md" iconLeft={<I.play size={14} />}>
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
          {tab === 'config' && <JobConfig j={j} />}
          {tab === 'schema' && <JobSchema />}
          {tab === 'history' && <JobHistory j={j} onOpenRun={onOpenRun} />}
          {tab === 'watermarks' && <JobWatermarks />}
        </div>
      </div>
    </div>
  );
}

function JobConfig({ j }: { j: Job }) {
  const rows: Array<[string, ReactNode]> = [
    ['Code', <span className="font-mono">{j.code}</span>],
    ['Source system', <span className="font-mono">{j.source}</span>],
    ['Source object', <span className="font-mono">{j.source_object}</span>],
    ['Target schema', <span className="font-mono">{j.target_table.split('.')[0]}</span>],
    ['Target table', <span className="font-mono">{j.target_table.split('.')[1]}</span>],
    ['Strategy', <Tag>{j.strategy}</Tag>],
    [
      'Schedule',
      j.schedule === 'manual' ? <Tag>manual</Tag> : <span className="font-mono">{j.schedule}</span>,
    ],
    ['Watermark column', <span className="font-mono">MODIFIED_DATE</span>],
    ['Watermark grace', <span className="font-mono">00:05:00</span>],
    ['Batch size', <span className="font-mono tabular">5,000 rows</span>],
    ['Retries', <span className="font-mono tabular">3 · backoff exp(2s, 60s)</span>],
    ['Timeout', <span className="font-mono tabular">00:45:00</span>],
    ['Owner', <span>{j.owner}</span>],
    ['Created', <span className="font-mono">2026-02-14 09:11 UTC · by priya.iyer</span>],
    ['Updated', <span className="font-mono">2026-05-16 09:12 UTC · by priya.iyer</span>],
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
            <h3 className="text-base font-medium text-text dark:text-d-text">Source query</h3>
          </div>
          <pre className="px-4 py-3 font-mono text-xs leading-relaxed text-text dark:text-d-text whitespace-pre overflow-auto">
{`SELECT
  PART_NO, DESCRIPTION,
  UNIT_MEAS, GROSS_WEIGHT,
  NET_WEIGHT, PART_STATUS,
  PLANNER_BUYER, CONTRACT,
  CREATED_BY, CREATED_DATE,
  MODIFIED_DATE, STD_COST
FROM IFSAPP.INVENTORY_PART_TAB
WHERE MODIFIED_DATE > :wm
  AND CONTRACT IN ('100','200');`}
          </pre>
        </div>

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

function JobSchema() {
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-medium text-text dark:text-d-text">Schema mapping</h3>
          <Tag>16 columns</Tag>
          <Tag className="border-warning/40 text-warning">2 drift</Tag>
        </div>
        <Button variant="ghost" size="sm" iconLeft={<I.refresh size={12} />}>
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
          {SCHEMA_MAP.map((c, i) => (
            <tr
              key={i}
              className={cx(
                'border-t border-border dark:border-d-border',
                c.drift && 'bg-warning/5 dark:bg-warning/10',
              )}
            >
              <td className="py-1.5 px-4 font-mono text-text dark:text-d-text">{c.src}</td>
              <td className="py-1.5 px-3 font-mono text-text-muted dark:text-d-text-muted">
                {c.src_type}
              </td>
              <td className="py-1.5 px-3 text-text-subtle dark:text-d-text-subtle">
                <I.arrowRight size={12} />
              </td>
              <td
                className={cx(
                  'py-1.5 px-3 font-mono',
                  c.tgt.startsWith('—')
                    ? 'text-text-subtle dark:text-d-text-subtle'
                    : 'text-text dark:text-d-text',
                )}
              >
                {c.tgt}
              </td>
              <td className="py-1.5 px-3 font-mono text-text-muted dark:text-d-text-muted">
                {c.tgt_type}
              </td>
              <td className="py-1.5 px-4">
                {c.drift === 'cast' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} />
                    Implicit cast
                  </span>
                )}
                {c.drift === 'new' && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning">
                    <I.alertTriangle size={12} />
                    New, unmapped
                  </span>
                )}
                {!c.drift && (
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

function JobHistory({ j, onOpenRun }: { j: Job; onOpenRun?: (j: Job) => void }) {
  const runs = Array.from({ length: 24 }, (_, i) => {
    const seed = ((i + 1) * 7919) % 100;
    let status: 'succeeded' | 'failed' | 'warning' = 'succeeded';
    if (seed > 92) status = 'failed';
    else if (seed > 84) status = 'warning';
    return {
      id: 'run_' + (8842 - i),
      started: `2026-05-${String(16 - Math.floor(i / 4)).padStart(2, '0')} ${String(
        ((14 - i) % 24 + 24) % 24,
      ).padStart(2, '0')}:42:11`,
      duration: 45 + ((i * 13) % 180),
      rows: 18000 + ((i * 1421) % 200000),
      status,
    };
  });
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
          {runs.map((r) => (
            <tr
              key={r.id}
              onClick={() => onOpenRun?.(j)}
              className="border-t border-border dark:border-d-border cursor-pointer hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 32 }}
            >
              <td className="px-4">
                <StatusBadge status={r.status === 'warning' ? 'succeeded' : r.status} dense />
              </td>
              <td className="px-3 font-mono text-text dark:text-d-text">{r.id}</td>
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {r.started}
              </td>
              <td className="px-3 text-right tabular text-text dark:text-d-text">
                {r.duration}s
              </td>
              <td className="px-3 text-right tabular text-text dark:text-d-text">
                {r.rows.toLocaleString('en-US')}
              </td>
              <td className="px-4 text-right tabular text-text-muted dark:text-d-text-muted">
                {Math.round(r.rows / r.duration).toLocaleString('en-US')}/s
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobWatermarks() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border">
          <h3 className="text-base font-medium text-text dark:text-d-text">Current watermark</h3>
        </div>
        <div className="p-4">
          <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
            MODIFIED_DATE
          </div>
          <div className="mt-1 font-mono text-xl text-text dark:text-d-text">
            2026-05-16T14:41:55Z
          </div>
          <div className="mt-1 text-xs text-text-subtle dark:text-d-text-subtle">
            advanced 1m 42s ago · by run_8842
          </div>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="secondary" size="sm" iconLeft={<I.refresh size={12} />}>
              Reset to last successful
            </Button>
            <Button variant="ghost" size="sm" iconLeft={<I.pencil size={12} />}>
              Edit value
            </Button>
          </div>
        </div>
      </div>
      <div className="col-span-5 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border">
          <h3 className="text-base font-medium text-text dark:text-d-text">Recent advances</h3>
        </div>
        <ul>
          {(
            [
              ['2026-05-16 14:41:55Z', 'run_8842', '+1m 42s'],
              ['2026-05-16 14:26:55Z', 'run_8841', '+15m 02s'],
              ['2026-05-16 14:11:53Z', 'run_8840', '+14m 58s'],
              ['2026-05-16 13:56:55Z', 'run_8839', '+15m 01s'],
              ['2026-05-16 13:41:54Z', 'run_8838', '+15m 02s'],
            ] as const
          ).map((r, i) => (
            <li
              key={i}
              className="px-4 py-2 flex items-center justify-between text-sm border-t border-border dark:border-d-border first:border-t-0"
            >
              <span className="font-mono text-text dark:text-d-text">{r[0]}</span>
              <span className="font-mono text-xs text-text-muted dark:text-d-text-muted">
                {r[1]}
              </span>
              <span className="font-mono text-xs tabular text-text-muted dark:text-d-text-muted">
                {r[2]}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Sources ─────────────────────────────────────────────────────────────────
export function SourcesScreen() {
  const [selected, setSelected] = useState<Source>(SOURCES[0]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const runTest = () => {
    setTesting(true);
    setTestResult(null);
    setTimeout(() => {
      setTesting(false);
      setTestResult({
        ok: selected.status === 'ok',
        msg:
          selected.status === 'ok'
            ? 'TNS resolved · 42ms · session opened'
            : 'TNS resolved · 8214ms · query latency above threshold',
      });
    }, 1200);
  };

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
              {SOURCES.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => {
                    setSelected(s);
                    setTestResult(null);
                  }}
                  className={cx(
                    'border-t border-border dark:border-d-border cursor-pointer',
                    selected.id === s.id
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
                    {s.lastTest}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="col-span-7 space-y-4">
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
                  loading={testing}
                  onClick={runTest}
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
                  ['Oracle version', <span className="font-mono">{selected.oracle}</span>],
                  ['Username', <span className="font-mono">IFSREADER</span>],
                  [
                    'Authentication',
                    <span className="inline-flex items-center gap-1.5">
                      <I.key size={12} className="text-text-muted dark:text-d-text-muted" />
                      Vault · secret/lakebridge/ifs-reader
                    </span>,
                  ],
                  ['TLS', <Tag>required · TLSv1.3</Tag>],
                  ['Pool size', <span className="font-mono tabular">8 / 16</span>],
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
            {testResult && (
              <div
                className={cx(
                  'px-4 py-2 border-t flex items-center gap-2 text-sm',
                  testResult.ok
                    ? 'border-success/30 bg-success/5 text-text dark:text-d-text'
                    : 'border-warning/30 bg-warning/5 text-text dark:text-d-text',
                )}
              >
                <span
                  className={cx(
                    'inline-block w-2 h-2 rounded-full',
                    testResult.ok ? 'bg-success' : 'bg-warning',
                  )}
                />
                <span className="font-mono text-xs">{testResult.msg}</span>
              </div>
            )}
          </div>

          <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">Source objects</h3>
              <span className="text-xs text-text-subtle dark:text-d-text-subtle">
                {SOURCE_OBJECTS.length} discovered
              </span>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
                  <th className="text-left py-2 px-4 font-medium">Object</th>
                  <th className="text-right py-2 px-3 font-medium">Row count</th>
                  <th className="text-right py-2 px-3 font-medium">Last seen</th>
                  <th className="text-right py-2 px-4 font-medium">Jobs</th>
                </tr>
              </thead>
              <tbody>
                {SOURCE_OBJECTS.map((o, i) => (
                  <tr
                    key={i}
                    className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
                    style={{ height: 32 }}
                  >
                    <td className="px-4 font-mono text-text dark:text-d-text">{o.name}</td>
                    <td className="px-3 text-right tabular text-text dark:text-d-text">
                      {o.rowcount.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 text-right text-xs text-text-muted dark:text-d-text-muted">
                      {o.last_seen}
                    </td>
                    <td className="px-4 text-right tabular text-text-muted dark:text-d-text-muted">
                      {o.jobs}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Reconciliation ──────────────────────────────────────────────────────────
export function ReconScreen() {
  const [hover, setHover] = useState<{
    key: string;
    c: (typeof RECON)[number]['cells'][number];
    job: Job;
  } | null>(null);
  const tone = (r: string) =>
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
            <Button variant="primary" size="md" iconLeft={<I.refresh size={14} />}>
              Recompute
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-4">
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
              {RECON.map(({ job, cells }, i) => (
                <tr
                  key={job.id}
                  className="border-t border-border dark:border-d-border"
                  style={{ height: 36 }}
                >
                  <td className="px-3 font-mono text-text dark:text-d-text">{job.code}</td>
                  <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                    {job.target_table}
                  </td>
                  {cells.map((c, k) => {
                    const key = `${i}-${k}`;
                    return (
                      <td key={k} className="px-1 relative">
                        <button
                          onMouseEnter={() => setHover({ key, c, job })}
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
                            <div className="font-medium">{job.code}</div>
                            <div className="mt-1 text-text-subtle dark:text-d-text-subtle">
                              source: {c.src_count.toLocaleString('en-US')}
                            </div>
                            <div className="text-text-subtle dark:text-d-text-subtle">
                              target: {c.tgt_count.toLocaleString('en-US')}
                            </div>
                            <div className="text-text-subtle dark:text-d-text-subtle">
                              checksum: {c.checksum_match ? 'match' : 'drift'}
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
      </div>
    </div>
  );
}

// ── Settings ────────────────────────────────────────────────────────────────
export function SettingsScreen() {
  const [sub, setSub] = useState<'users' | 'sources' | 'audit'>('users');
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
          tabs={[
            { value: 'users', label: 'Users' },
            { value: 'sources', label: 'Sources' },
            { value: 'audit', label: 'Audit log' },
          ]}
        />
        <div className="flex-1 min-h-0 overflow-auto py-4">
          {sub === 'users' && <UsersTable />}
          {sub === 'sources' && <SourcesSettings />}
          {sub === 'audit' && <AuditTable />}
        </div>
      </div>
    </div>
  );
}

function UsersTable() {
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <span className="text-sm text-text-muted dark:text-d-text-muted">
          {USERS.length} users
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
          {USERS.map((u, i) => (
            <tr
              key={i}
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
                {u.mfa ? (
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
                {u.last_active}
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

function SourcesSettings() {
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
          {SOURCES.map((s) => (
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
                {s.lastTest}
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
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <span className="text-sm text-text-muted dark:text-d-text-muted">
          {AUDIT.length} events · retained 90 days
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
          {AUDIT.map((a, i) => (
            <tr
              key={i}
              className="border-t border-border dark:border-d-border hover:bg-surface-2 dark:hover:bg-d-surface-2"
              style={{ height: 32 }}
            >
              <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                {a.ts}
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
export function SignIn({ onSignedIn }: { onSignedIn?: () => void }) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-bg dark:bg-d-bg">
      <div className="w-[360px] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md p-6">
        <div className="flex items-center gap-2 mb-6">
          <LakebridgeMark size={20} />
          <span className="text-sm font-semibold text-text dark:text-d-text tracking-tight">
            Lakebridge
          </span>
        </div>
        <h1 className="text-lg font-medium text-text dark:text-d-text">Sign in</h1>
        <p className="mt-1 text-sm text-text-muted dark:text-d-text-muted">
          Use your corporate SSO. Local accounts are disabled.
        </p>

        <div className="mt-5 space-y-3">
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            iconLeft={<I.shield size={14} />}
            onClick={onSignedIn}
          >
            Continue with Okta
          </Button>
          <Button variant="secondary" size="lg" className="w-full" iconLeft={<I.key size={14} />}>
            Continue with security key
          </Button>
        </div>

        <div className="mt-6 pt-4 border-t border-border dark:border-d-border text-xs text-text-subtle dark:text-d-text-subtle font-mono">
          <div>build · 2026.05.16-r3142</div>
          <div>env · prod-eu · region eu-west-1</div>
        </div>
      </div>
    </div>
  );
}
