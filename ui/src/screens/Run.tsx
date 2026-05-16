import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import {
  Button,
  Sparkline,
  StatusBadge,
  StatusDot,
  Tabs,
  Tag,
} from '../components/primitives';
import { ERRORS, JOBS, RPS_SERIES, STEPS, type Job, type RunError } from '../data/sample';

type Props = {
  job?: Job;
  onBack?: () => void;
};

export function RunDetail({ job, onBack }: Props) {
  const j = job ?? JOBS[1];
  const [tab, setTab] = useState<'summary' | 'errors' | 'recon' | 'log'>('summary');
  const [now, setNow] = useState(0);
  const [errCount, setErrCount] = useState(14);
  const [rowsLoaded, setRowsLoaded] = useState(184_220);
  const [stepIdx, setStepIdx] = useState(2);
  const [stepProgress, setStepProgress] = useState(40);

  useEffect(() => {
    const t = setInterval(() => {
      setNow((n) => n + 1);
      setRowsLoaded((r) => r + Math.round(800 + Math.random() * 600));
      if (Math.random() < 0.15) setErrCount((c) => c + 1);
      setStepProgress((p) => {
        if (p >= 100) {
          setStepIdx((idx) => Math.min(idx + 1, STEPS.length - 1));
          return 0;
        }
        return Math.min(100, p + 6);
      });
    }, 1100);
    return () => clearInterval(t);
  }, []);

  const stepDurations = [3.2, 1.8, 84, 142, 8, 0.6];
  const totalDuration =
    stepDurations.slice(0, stepIdx).reduce((a, b) => a + b, 0) +
    (stepDurations[stepIdx] * stepProgress) / 100;

  const status =
    stepIdx >= STEPS.length - 1 && stepProgress >= 100 ? 'succeeded' : 'running';

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
            {j.code}
          </button>
          <I.chevronRight size={12} />
          <span className="text-text dark:text-d-text font-mono">run_8842</span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-semibold tracking-tight text-text dark:text-d-text font-mono">
              {j.code}
            </h1>
            <StatusBadge status={status} />
            <span className="text-sm text-text-muted dark:text-d-text-muted flex items-center gap-1.5">
              <I.clock size={12} />
              <span className="tabular">{formatDuration(totalDuration)}</span>
            </span>
            <span className="text-sm text-text-muted dark:text-d-text-muted flex items-center gap-1.5">
              <I.user size={12} />
              Triggered by{' '}
              <span className="text-text dark:text-d-text">{j.owner}</span>
            </span>
            <span className="text-xs text-text-subtle dark:text-d-text-subtle font-mono">
              started 2026-05-16 14:42:11 UTC
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" iconLeft={<I.terminal size={14} />}>
              Open in console
            </Button>
            <Button variant="secondary" size="md" iconLeft={<I.x size={14} />}>
              Cancel run
            </Button>
            <Button variant="primary" size="md" iconLeft={<I.refresh size={14} />}>
              Run again
            </Button>
          </div>
        </div>

        <div className="mt-6">
          <StepTimeline current={stepIdx} progress={stepProgress} durations={stepDurations} />
        </div>
      </div>

      <div className="px-8 pt-3 flex-1 min-h-0 flex flex-col">
        <Tabs
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          tabs={[
            { value: 'summary', label: 'Summary' },
            { value: 'errors', label: 'Errors', count: errCount },
            { value: 'recon', label: 'Reconciliation' },
            { value: 'log', label: 'Raw log' },
          ]}
          right={
            <span className="text-xs text-text-subtle dark:text-d-text-subtle inline-flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-success lb-pulse" />
              Live · updates every 1.1s
            </span>
          }
        />

        <div className="flex-1 min-h-0 overflow-auto py-4">
          {tab === 'summary' && <RunSummary j={j} rowsLoaded={rowsLoaded} errCount={errCount} />}
          {tab === 'errors' && <RunErrorsTable errCount={errCount} />}
          {tab === 'recon' && <RunRecon />}
          {tab === 'log' && <RunRawLog now={now} />}
        </div>
      </div>
    </div>
  );
}

function StepTimeline({
  current,
  progress,
  durations,
}: {
  current: number;
  progress: number;
  durations: number[];
}) {
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        const upcoming = i > current;
        return (
          <Fragment key={s}>
            <div className="flex flex-col items-center gap-1.5 min-w-[110px]">
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    'inline-flex items-center justify-center w-5 h-5 rounded-full border-2',
                    done && 'bg-success/10 border-success text-success',
                    active && 'bg-brand/10 border-brand text-brand lb-pulse',
                    upcoming &&
                      'bg-surface dark:bg-d-surface border-border-strong dark:border-d-border-strong text-text-subtle dark:text-d-text-subtle',
                  )}
                >
                  {done ? (
                    <I.check size={11} strokeWidth={2.5} />
                  ) : active ? (
                    <span className="block w-1.5 h-1.5 rounded-full bg-brand" />
                  ) : (
                    <span className="text-[10px] tabular">{i + 1}</span>
                  )}
                </span>
                <span
                  className={cx(
                    'text-sm capitalize',
                    done && 'text-text dark:text-d-text',
                    active && 'text-text dark:text-d-text font-medium',
                    upcoming && 'text-text-muted dark:text-d-text-muted',
                  )}
                >
                  {s}
                </span>
              </div>
              <div className="text-xs text-text-subtle dark:text-d-text-subtle tabular">
                {done ? formatDuration(durations[i]) : active ? `${Math.round(progress)}%` : '—'}
              </div>
            </div>
            {i < STEPS.length - 1 && (
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
  j,
  rowsLoaded,
  errCount,
}: {
  j: Job;
  rowsLoaded: number;
  errCount: number;
}) {
  const kv: Array<[string, ReactNode]> = [
    ['Job code', <span className="font-mono">{j.code}</span>],
    ['Run id', <span className="font-mono">run_8842</span>],
    ['Source', <span className="font-mono">{j.source}</span>],
    ['Source object', <span className="font-mono">{j.source_object}</span>],
    ['Target', <span className="font-mono">{j.target_table}</span>],
    ['Strategy', <Tag>{j.strategy}</Tag>],
    ['Watermark column', <span className="font-mono">MODIFIED_DATE</span>],
    ['Watermark before', <span className="font-mono">2026-05-16T13:11:08Z</span>],
    ['Watermark after', <span className="font-mono">2026-05-16T14:41:55Z</span>],
    ['Triggered by', <span>{j.owner}</span>],
    ['Triggered at', <span className="font-mono">2026-05-16 14:42:11 UTC</span>],
    ['Run mode', <Tag>scheduled</Tag>],
  ];

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
        <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
          <h3 className="text-base font-medium text-text dark:text-d-text">Run details</h3>
          <span className="text-xs text-text-subtle dark:text-d-text-subtle">Live</span>
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
          value={rowsLoaded.toLocaleString('en-US')}
          sub="of est. 412,048"
          tone="brand"
        />
        <KpiTile label="Throughput" value="9,840" sub="rows/sec (avg last 30s)" />
        <KpiTile
          label="Errors"
          value={String(errCount)}
          sub="14 unique codes"
          tone={errCount > 12 ? 'warning' : 'default'}
        />
        <KpiTile label="Recon variance" value="0.013%" sub="14 / 184,220 rows" />

        <div className="col-span-2 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
          <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
            <h3 className="text-base font-medium text-text dark:text-d-text">Rows per second</h3>
            <span className="text-xs text-text-subtle dark:text-d-text-subtle font-mono tabular">
              last 60s
            </span>
          </div>
          <div className="px-4 py-3">
            <Sparkline data={RPS_SERIES} color="#2563EB" height={64} />
            <div className="mt-2 flex items-center justify-between text-xs text-text-muted dark:text-d-text-muted tabular">
              <span>min 6,210</span>
              <span>peak 11,840</span>
              <span>avg 9,840</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
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

function RunErrorsTable({ errCount }: { errCount: number }) {
  const [selected, setSelected] = useState<RunError>(ERRORS[0]);
  const rows = ERRORS.slice(0, Math.max(12, Math.min(errCount, ERRORS.length)));

  return (
    <div className="grid grid-cols-12 gap-4 h-full">
      <div className="col-span-7 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden flex flex-col">
        <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
          <div className="text-sm">
            <span className="font-medium text-text dark:text-d-text">{rows.length} errors</span>
            <span className="text-text-muted dark:text-d-text-muted"> · 7 unique codes</span>
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
              <col style={{ width: 90 }} />
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
              {rows.map((e) => {
                const active = selected.id === e.id;
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
                      <StatusDot status={e.severity === 'error' ? 'failed' : 'warning'} />
                    </td>
                    <td className="px-3 font-mono text-sm text-text dark:text-d-text">
                      {e.code}
                    </td>
                    <td className="px-3 truncate text-text-muted dark:text-d-text-muted">
                      {e.message}
                    </td>
                    <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                      {e.source_pk}
                    </td>
                    <td className="px-3 text-xs text-text-muted dark:text-d-text-muted">
                      {e.captured_at}
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
            <StatusDot status={selected.severity === 'error' ? 'failed' : 'warning'} />
            <span className="font-mono text-sm text-text dark:text-d-text">{selected.code}</span>
          </div>
          <Button variant="ghost" size="sm" iconLeft={<I.copy size={12} />}>
            Copy JSON
          </Button>
        </div>
        <div className="p-3 overflow-auto flex-1">
          <pre className="font-mono text-xs text-text dark:text-d-text whitespace-pre leading-relaxed">
{`{
  "id":          "${selected.id}",
  "severity":    "${selected.severity}",
  "code":        "${selected.code}",
  "message":     "${selected.message}",
  "captured_at": "2026-05-16T14:42:11.392Z",
  "source": {
    "system":    "IFS-PRD-EU",
    "object":    "IFSAPP.CUSTOMER_INFO",
    "pk":        "${selected.source_pk}",
    "row_no":    188420
  },
  "target": {
    "table":     "stg_ifs_customer.customer_master",
    "column":    "NET_AMOUNT",
    "type":      "decimal(18,4)"
  },
  "run": {
    "id":        "run_8842",
    "step":      "extract",
    "attempt":   1
  },
  "stack": [
    "lakebridge.extract.cursor.fetchmany",
    "lakebridge.extract.cast.coerce_decimal",
    "lakebridge.extract.cast.scale_overflow"
  ]
}`}
          </pre>
        </div>
      </div>
    </div>
  );
}

function RunRecon() {
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
      <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
        <h3 className="text-base font-medium text-text dark:text-d-text">Reconciliation</h3>
        <span className="text-xs text-text-subtle dark:text-d-text-subtle font-mono tabular">
          computed 14:47:22 UTC
        </span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-border dark:divide-d-border">
        <ReconCol
          label="Source rowcount"
          value="184,220"
          sub="IFSAPP.CUSTOMER_INFO @ 14:42:08Z"
          status="ok"
        />
        <ReconCol
          label="Target rowcount"
          value="184,206"
          sub="stg_ifs_customer.customer_master"
          status="warn"
        />
        <ReconCol
          label="Variance"
          value="14 rows"
          sub="0.0076% — below 0.05% threshold"
          status="warn"
        />
      </div>
      <div className="px-4 py-3 border-t border-border dark:border-d-border">
        <h4 className="text-sm font-medium text-text dark:text-d-text mb-2">Row hash check</h4>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
              <th className="text-left py-1.5 font-medium">Bucket</th>
              <th className="text-right py-1.5 font-medium">Source hash</th>
              <th className="text-right py-1.5 font-medium">Target hash</th>
              <th className="text-right py-1.5 font-medium">Match</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {(
              [
                ['00–3F', 'a4 9c 11 e7 …', 'a4 9c 11 e7 …', 'ok'],
                ['40–7F', '7d 22 b8 04 …', '7d 22 b8 04 …', 'ok'],
                ['80–BF', '02 ff ec 91 …', '02 ff ec 91 …', 'ok'],
                ['C0–FF', '1b 88 4a 12 …', '1b 88 4a 28 …', 'fail'],
              ] as const
            ).map((r, i) => (
              <tr key={i} className="border-t border-border dark:border-d-border">
                <td className="py-1.5 text-text-muted dark:text-d-text-muted">{r[0]}</td>
                <td className="py-1.5 text-right text-text dark:text-d-text">{r[1]}</td>
                <td className="py-1.5 text-right text-text dark:text-d-text">{r[2]}</td>
                <td className="py-1.5 text-right">
                  <StatusDot status={r[3] === 'ok' ? 'succeeded' : 'failed'} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
        <span className="text-xl font-semibold tabular text-text dark:text-d-text">{value}</span>
        <StatusDot status={status === 'ok' ? 'succeeded' : 'warning'} />
      </div>
      <div className="text-xs text-text-subtle dark:text-d-text-subtle mt-1">{sub}</div>
    </div>
  );
}

function RunRawLog({ now }: { now: number }) {
  const lines = useMemo(() => generateLog(now), [now]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines]);
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface overflow-hidden flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border dark:border-d-border flex items-center justify-between">
        <div className="text-sm">
          <span className="font-medium text-text dark:text-d-text">Raw log</span>
          <span className="text-text-muted dark:text-d-text-muted">
            {' '}
            · level=info · stream=stdout
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" iconLeft={<I.download size={12} />}>
            Download
          </Button>
          <Button variant="ghost" size="sm" iconLeft={<I.pause size={12} />}>
            Pause tail
          </Button>
        </div>
      </div>
      <div ref={ref} className="flex-1 overflow-auto bg-surface dark:bg-d-surface">
        <pre className="px-3 py-2 font-mono text-xs leading-relaxed text-text dark:text-d-text">
          {lines.map((l, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-text-subtle dark:text-d-text-subtle shrink-0 tabular">
                {l.ts}
              </span>
              <span
                className={cx(
                  'shrink-0 w-12 uppercase',
                  l.level === 'error'
                    ? 'text-danger'
                    : l.level === 'warn'
                    ? 'text-warning'
                    : 'text-text-subtle dark:text-d-text-subtle',
                )}
              >
                {l.level}
              </span>
              <span>{l.msg}</span>
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}

function generateLog(now: number) {
  const base: Array<['info' | 'warn' | 'error', string, string]> = [
    ['info', 'lakebridge.runner', 'starting run run_8842 for EXT.CUST.MASTER.DELTA'],
    [
      'info',
      'lakebridge.connect',
      'dialing oracle://ifsreader@ifs-prd-eu.corp.local:1521/IFSPROD',
    ],
    ['info', 'lakebridge.connect', 'session established · sid=88247 · serial=39112'],
    [
      'info',
      'lakebridge.count',
      'SELECT COUNT(*) FROM IFSAPP.CUSTOMER_INFO WHERE MODIFIED_DATE > :wm',
    ],
    ['info', 'lakebridge.count', 'source rowcount = 184,220'],
    ['info', 'lakebridge.extract', 'fetching with array_size=5000'],
    ['info', 'lakebridge.extract', 'offset=0 rows=5000 elapsed=412ms'],
    ['info', 'lakebridge.extract', 'offset=5000 rows=5000 elapsed=403ms'],
    ['info', 'lakebridge.extract', 'offset=10000 rows=5000 elapsed=388ms'],
    [
      'warn',
      'lakebridge.cast',
      'implicit cast VARCHAR2(4000) → NVARCHAR(MAX) on column DESCRIPTION',
    ],
    ['info', 'lakebridge.load', 'BULK INSERT staging.customer_master · batch=10000'],
    ['info', 'lakebridge.load', 'flushed batch 1/19 · rows=10000 elapsed=612ms'],
    ['info', 'lakebridge.load', 'flushed batch 2/19 · rows=10000 elapsed=598ms'],
    [
      'error',
      'lakebridge.cast',
      'numeric overflow casting NUMBER(22,6) → DECIMAL(18,4) on column NET_AMOUNT pk=CO-44102861',
    ],
    [
      'info',
      'lakebridge.load',
      'flushed batch 3/19 · rows=9988 elapsed=621ms (12 quarantined)',
    ],
  ];
  const tail: Array<['info', string, string]> = Array.from({ length: now % 6 }, (_, i) => [
    'info',
    'lakebridge.load',
    `flushed batch ${4 + i}/19 · rows=10000 elapsed=${600 + ((i * 21) % 80)}ms`,
  ]);
  return base.concat(tail).map((l, i) => ({
    ts:
      '14:42:' +
      String(11 + i).padStart(2, '0') +
      '.' +
      String((i * 407) % 1000).padStart(3, '0'),
    level: l[0],
    msg: l[1] + ' · ' + l[2],
  }));
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}m ${s}s`;
}
