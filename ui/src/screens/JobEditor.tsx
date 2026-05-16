/** Job authoring dialog: create or edit. Used from the Jobs index ("New
 *  job") and from the Job detail header ("Edit configuration"). The form
 *  validates locally where it cheaply can; the server is still the
 *  authoritative validator and surfaces 422/400 as an inline banner. */

import { useEffect, useState } from 'react';
import { I } from '../lib/icons';
import { Button, InlineBanner, Select } from '../components/primitives';
import {
  useCreateJob,
  useSources,
  useUpdateJob,
  type ApiJobBody,
} from '../api/queries';
import type { ApiJob, ApiMe, Strategy } from '../api/types';

type Props = {
  me: ApiMe;
  /** When set, the dialog opens in edit mode and pre-fills from `existing`. */
  existing?: ApiJob;
  onClose: () => void;
  onSaved: (job: ApiJob) => void;
};

const STRATEGY_OPTIONS: Strategy[] = [
  'full_snapshot',
  'append',
  'watermark_delta',
  'truncate_and_load',
];

const CODE_RE = /^[A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+$/;

function defaultBody(me: ApiMe, existing?: ApiJob): ApiJobBody {
  if (existing) {
    return {
      code: existing.code,
      source_id: existing.source_id,
      source_object: existing.source_object,
      source_query: null,
      target_schema: existing.target_schema,
      target_table: existing.target_table,
      strategy: existing.strategy,
      schedule: existing.schedule,
      watermark_column: existing.watermark_column,
      watermark_grace_sec: 300,
      batch_size: existing.batch_size,
      retries: existing.retries,
      timeout_sec: existing.timeout_sec,
      owner: existing.owner,
      enabled: existing.enabled,
    };
  }
  return {
    code: '',
    source_id: '',
    source_object: '',
    source_query: null,
    target_schema: 'stg_ifs_',
    target_table: '',
    strategy: 'full_snapshot',
    schedule: '0 6 * * *',
    watermark_column: null,
    watermark_grace_sec: 300,
    batch_size: 5000,
    retries: 3,
    timeout_sec: 2700,
    owner: me.name,
    enabled: true,
  };
}

function localValidate(body: ApiJobBody): string | null {
  if (!CODE_RE.test(body.code)) {
    return 'Code must be dotted uppercase, e.g. EXT.MAT.MASTER.FULL.';
  }
  if (!body.source_id) return 'Pick a source.';
  if (!body.source_object) return 'Source object is required.';
  if (!body.target_schema.toLowerCase().startsWith('stg_')) {
    return 'Target schema must start with stg_.';
  }
  if (!body.target_table) return 'Target table is required.';
  if (body.strategy === 'watermark_delta' && !body.watermark_column) {
    return 'watermark_delta strategy requires a watermark column.';
  }
  if (!body.owner) return 'Owner is required.';
  return null;
}

export function JobEditor({ me, existing, onClose, onSaved }: Props) {
  const [body, setBody] = useState<ApiJobBody>(() => defaultBody(me, existing));
  const [serverError, setServerError] = useState<string | null>(null);
  const sources = useSources();
  const create = useCreateJob();
  const update = useUpdateJob();
  const pending = create.isPending || update.isPending;

  // Re-seed when `existing` changes (e.g. the parent swaps the job under us).
  useEffect(() => {
    setBody(defaultBody(me, existing));
    setServerError(null);
  }, [me, existing]);

  const localError = localValidate(body);

  const onSave = () => {
    if (localError) return;
    setServerError(null);
    const onSuccess = (job: ApiJob) => onSaved(job);
    const onError = (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setServerError(msg);
    };
    if (existing) {
      update.mutate({ jobId: existing.id, body }, { onSuccess, onError });
    } else {
      create.mutate(body, { onSuccess, onError });
    }
  };

  const set = <K extends keyof ApiJobBody>(k: K, v: ApiJobBody[K]) =>
    setBody((b) => ({ ...b, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 flex items-start justify-center pt-[8vh]">
      <div className="w-[720px] max-h-[85vh] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark flex flex-col">
        <div className="px-5 py-3 border-b border-border dark:border-d-border flex items-center justify-between">
          <h3 className="text-base font-medium text-text dark:text-d-text">
            {existing ? `Edit ${existing.code}` : 'New job'}
          </h3>
          <button
            onClick={onClose}
            className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text"
            aria-label="Close"
          >
            <I.x size={14} />
          </button>
        </div>

        <div className="overflow-auto px-5 py-4 space-y-4">
          <Field label="Code" hint="EXT.<domain>.<entity>.<strategy_hint>">
            <input
              value={body.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              placeholder="EXT.MAT.MASTER.FULL"
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Source">
              <Select
                value={body.source_id}
                onChange={(e) => set('source_id', e.target.value)}
              >
                <option value="">— pick —</option>
                {(sources.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Strategy">
              <Select
                value={body.strategy}
                onChange={(e) => set('strategy', e.target.value as Strategy)}
              >
                {STRATEGY_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Source object" hint="OWNER.TABLE — e.g. IFSAPP.CUSTOMER_INFO">
            <input
              value={body.source_object}
              onChange={(e) => set('source_object', e.target.value.toUpperCase())}
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Target schema" hint="must start with stg_">
              <input
                value={body.target_schema}
                onChange={(e) => set('target_schema', e.target.value.toLowerCase())}
                placeholder="stg_ifs_inventory"
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
            <Field label="Target table">
              <input
                value={body.target_table}
                onChange={(e) => set('target_table', e.target.value.toLowerCase())}
                placeholder="inventory_part"
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
          </div>

          <Field
            label="Schedule"
            hint="cron expression, or 'manual' for run-now only"
          >
            <input
              value={body.schedule}
              onChange={(e) => set('schedule', e.target.value)}
              placeholder="0 6 * * *"
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
            />
          </Field>

          {body.strategy === 'watermark_delta' && (
            <Field
              label="Watermark column"
              hint="source column the runner uses as the high-water mark"
            >
              <input
                value={body.watermark_column ?? ''}
                onChange={(e) =>
                  set('watermark_column', e.target.value.toUpperCase() || null)
                }
                placeholder="MODIFIED_DATE"
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
          )}

          <details className="border-t border-border dark:border-d-border pt-3">
            <summary className="cursor-pointer text-sm text-text-muted dark:text-d-text-muted">
              Advanced
            </summary>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <Field label="Batch size">
                <input
                  type="number"
                  value={body.batch_size}
                  min={1}
                  onChange={(e) => set('batch_size', parseInt(e.target.value || '0', 10))}
                  className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
                />
              </Field>
              <Field label="Retries">
                <input
                  type="number"
                  value={body.retries}
                  min={0}
                  max={20}
                  onChange={(e) => set('retries', parseInt(e.target.value || '0', 10))}
                  className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
                />
              </Field>
              <Field label="Timeout (sec)">
                <input
                  type="number"
                  value={body.timeout_sec}
                  min={1}
                  onChange={(e) => set('timeout_sec', parseInt(e.target.value || '0', 10))}
                  className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <Field label="Owner">
                <input
                  value={body.owner}
                  onChange={(e) => set('owner', e.target.value)}
                  className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm"
                />
              </Field>
              <label className="block">
                <span className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
                  Enabled
                </span>
                <label className="mt-1 flex items-center gap-2 h-9">
                  <input
                    type="checkbox"
                    checked={body.enabled}
                    onChange={(e) => set('enabled', e.target.checked)}
                    className="w-4 h-4 accent-brand"
                  />
                  <span className="text-sm text-text dark:text-d-text">
                    Scheduler will pick this job up
                  </span>
                </label>
              </label>
            </div>
          </details>

          {(localError || serverError) && (
            <InlineBanner
              tone="danger"
              title={localError ? 'Fix the highlighted issue' : 'Server rejected the change'}
              description={localError ?? serverError ?? ''}
            />
          )}
        </div>

        <div className="px-5 py-3 border-t border-border dark:border-d-border flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!!localError}
            loading={pending}
            onClick={onSave}
          >
            {existing ? 'Save changes' : 'Create job'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-text-muted dark:text-d-text-muted">
        {label}
      </span>
      <div className="mt-1">{children}</div>
      {hint && (
        <span className="text-xs text-text-subtle dark:text-d-text-subtle mt-1 block">
          {hint}
        </span>
      )}
    </label>
  );
}
