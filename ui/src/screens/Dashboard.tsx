import { useState } from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';
import { Button, Sparkline, StatusDot, Tag } from '../components/primitives';
import {
  ERRORS,
  JOBS,
  SPARK_ACTIVE,
  SPARK_ROWS,
  SPARK_RUNS,
  SPARK_SUCC,
  TIMELINE_BLOCKS,
  type Job,
} from '../data/sample';

type Props = {
  onOpenJob?: (j: Job) => void;
  onOpenRun?: (j?: Job) => void;
};

export function Dashboard({ onOpenRun }: Props) {
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
            <span className="text-xs text-text-subtle dark:text-d-text-subtle inline-flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-success lb-pulse" />
              All systems nominal
            </span>
            <div className="w-px h-5 bg-border dark:bg-d-border" />
            <Button variant="ghost" size="md" iconLeft={<I.refresh size={14} />}>
              Refresh
            </Button>
            <Button variant="secondary" size="md" iconLeft={<I.calendar size={14} />}>
              Last 24h
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-8 py-4 space-y-4">
        <div className="grid grid-cols-4 gap-4">
          <Kpi
            label="Runs (24h)"
            value="1,284"
            delta="+8.2%"
            deltaTone="success"
            series={SPARK_RUNS}
            color="#2563EB"
          />
          <Kpi
            label="Success rate"
            value="98.4%"
            delta="−0.4 pp"
            deltaTone="warning"
            series={SPARK_SUCC}
            color="#16A34A"
          />
          <Kpi
            label="Rows landed"
            value="184.2M"
            delta="+12.1%"
            deltaTone="success"
            series={SPARK_ROWS}
            color="#0891B2"
          />
          <Kpi
            label="Active jobs"
            value="18 / 28"
            sub="10 paused"
            series={SPARK_ACTIVE}
            color="#71717A"
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
            <Timeline24h />
          </div>

          <div className="col-span-4 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">Strategy mix</h3>
              <span className="text-xs text-text-subtle dark:text-d-text-subtle">runs · 24h</span>
            </div>
            <div className="p-4 space-y-3">
              {(
                [
                  ['watermark_delta', 682, 'bg-brand'],
                  ['append', 401, 'bg-info'],
                  ['full_snapshot', 144, 'bg-text-subtle'],
                  ['truncate_and_load', 57, 'bg-warning'],
                ] as const
              ).map(([name, n, color]) => {
                const pct = (n / 1284) * 100;
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
                      <div className={cx('h-full', color)} style={{ width: pct + '%' }} />
                    </div>
                  </div>
                );
              })}
            </div>
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
            <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 44 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 220 }} />
                <col />
                <col style={{ width: 100 }} />
              </colgroup>
              <tbody>
                {ERRORS.slice(0, 10).map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => onOpenRun?.()}
                    className={cx(
                      'border-t border-border dark:border-d-border cursor-pointer hover:bg-surface-2 dark:hover:bg-d-surface-2',
                    )}
                    style={{ height: 32 }}
                  >
                    <td className="px-3">
                      <StatusDot status={e.severity === 'error' ? 'failed' : 'warning'} />
                    </td>
                    <td className="px-3 font-mono text-sm text-text dark:text-d-text">{e.code}</td>
                    <td className="px-3 font-mono text-xs text-text-muted dark:text-d-text-muted">
                      {e.job_code}
                    </td>
                    <td className="px-3 truncate text-text-muted dark:text-d-text-muted">
                      {e.message}
                    </td>
                    <td className="px-3 text-right text-xs text-text-muted dark:text-d-text-muted">
                      {e.captured_at}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="col-span-4 border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface">
            <div className="px-4 py-2.5 border-b border-border dark:border-d-border flex items-center justify-between">
              <h3 className="text-base font-medium text-text dark:text-d-text">
                Currently running
              </h3>
              <span className="text-xs text-text-subtle dark:text-d-text-subtle tabular">
                3 jobs
              </span>
            </div>
            <div>
              {JOBS.filter((j) => j.status === 'running' || j.status === 'queued')
                .slice(0, 3)
                .concat([JOBS[5], JOBS[9]])
                .slice(0, 3)
                .map((j, i) => (
                  <div
                    key={j.id}
                    onClick={() => onOpenRun?.(j)}
                    className="px-4 py-2.5 border-t border-border dark:border-d-border first:border-t-0 hover:bg-surface-2 dark:hover:bg-d-surface-2 cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-sm text-text dark:text-d-text">{j.code}</span>
                      <span className="text-xs text-text-muted dark:text-d-text-muted tabular">
                        {['00:42', '00:18', '01:12'][i]}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 bg-surface-2 dark:bg-d-surface-2 rounded-sm overflow-hidden">
                      <div
                        className="h-full bg-brand lb-pulse"
                        style={{ width: ['62%', '24%', '88%'][i] }}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs text-text-muted dark:text-d-text-muted">
                      <span>step: {['extract', 'count', 'load'][i]}</span>
                      <span className="tabular">
                        {['18,420', '—', '142,810'][i]} rows
                      </span>
                    </div>
                  </div>
                ))}
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
  delta,
  deltaTone,
  sub,
  series,
  color,
}: {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: 'success' | 'warning' | 'danger';
  sub?: string;
  series: number[];
  color: string;
}) {
  const dColor =
    deltaTone === 'success'
      ? 'text-success'
      : deltaTone === 'warning'
      ? 'text-warning'
      : deltaTone === 'danger'
      ? 'text-danger'
      : 'text-text-muted dark:text-d-text-muted';
  return (
    <div className="border border-border dark:border-d-border rounded-md bg-surface dark:bg-d-surface p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-text-muted dark:text-d-text-muted uppercase tracking-wide">
            {label}
          </div>
          <div className="mt-1.5 text-2xl font-semibold tabular text-text dark:text-d-text">
            {value}
          </div>
        </div>
        {delta && (
          <span
            className={cx('text-xs font-medium inline-flex items-center gap-0.5 tabular', dColor)}
          >
            {deltaTone === 'success' ? <I.arrowUp size={12} /> : <I.arrowDown size={12} />}
            {delta.replace(/^[+−]/, '')}
          </span>
        )}
      </div>
      <div className="mt-2 -mx-1">
        <Sparkline data={series} color={color} height={36} />
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

function Timeline24h() {
  const [hover, setHover] = useState<number | null>(null);
  const colorOf = (s: string) =>
    ({ succeeded: 'bg-success', warning: 'bg-warning', failed: 'bg-danger', running: 'bg-brand' }[
      s
    ] || 'bg-surface-2');
  return (
    <div className="p-4">
      <div className="relative">
        <div className="flex justify-between text-xs text-text-subtle dark:text-d-text-subtle font-mono tabular mb-1.5">
          {['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', 'now'].map((t) => (
            <span key={t}>{t}</span>
          ))}
        </div>
        <div className="flex gap-[2px] items-end h-20 bg-surface-2 dark:bg-d-surface-2 rounded-sm p-1 border border-border dark:border-d-border">
          {TIMELINE_BLOCKS.map((b, i) => {
            const heightPct = 30 + (b.dur_sec / 270) * 70;
            const isHover = hover === i;
            return (
              <div
                key={i}
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
        {hover !== null && (
          <div
            className="absolute bg-text text-surface dark:bg-d-text dark:text-d-bg text-xs rounded-sm px-2 py-1 font-mono pointer-events-none whitespace-nowrap z-10"
            style={{ left: `${(hover / 60) * 100}%`, top: -8, transform: 'translate(-50%, -100%)' }}
          >
            {TIMELINE_BLOCKS[hover].job_code}
            <span className="text-text-subtle dark:text-d-text-subtle"> · </span>
            {TIMELINE_BLOCKS[hover].dur_sec}s
            <span className="text-text-subtle dark:text-d-text-subtle"> · </span>
            {TIMELINE_BLOCKS[hover].status}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-4 text-sm">
        {(
          [
            ['Succeeded', TIMELINE_BLOCKS.filter((b) => b.status === 'succeeded').length, 'text-success'],
            ['Warning', TIMELINE_BLOCKS.filter((b) => b.status === 'warning').length, 'text-warning'],
            ['Failed', TIMELINE_BLOCKS.filter((b) => b.status === 'failed').length, 'text-danger'],
            ['Running', TIMELINE_BLOCKS.filter((b) => b.status === 'running').length, 'text-brand'],
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
