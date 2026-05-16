/** Source authoring dialog: create or edit an IFS source. Admin-only on
 *  the server. The host/port/SID lives here; the password lives in Vault
 *  or AKV — we only store the path. */

import { useEffect, useState } from 'react';
import { I } from '../lib/icons';
import { Button, InlineBanner, Select } from '../components/primitives';
import {
  useCreateSource,
  useUpdateSource,
  type ApiSourceBody,
} from '../api/queries';
import type { ApiMe, ApiSource } from '../api/types';

type Props = {
  me: ApiMe;
  existing?: ApiSource;
  onClose: () => void;
  onSaved: (source: ApiSource) => void;
};

const ID_RE = /^[A-Z][A-Z0-9-]*$/;

function defaultBody(existing?: ApiSource): ApiSourceBody {
  if (existing) {
    return {
      id: existing.id,
      host: existing.host,
      port: existing.port,
      sid: existing.sid,
      service_name: existing.service_name,
      oracle_version: existing.oracle_version,
      username: existing.username,
      secret_ref: existing.secret_ref,
      tls_required: existing.tls_required,
      pool_size: existing.pool_size,
    };
  }
  return {
    id: '',
    host: '',
    port: 1521,
    sid: '',
    service_name: null,
    oracle_version: '19c',
    username: 'IFSREADER',
    secret_ref: 'secret/lakebridge/',
    tls_required: true,
    pool_size: 8,
  };
}

function localValidate(body: ApiSourceBody, isEdit: boolean): string | null {
  if (!ID_RE.test(body.id)) {
    return 'ID must be uppercase letters/digits/hyphens, e.g. IFS-PRD-EU.';
  }
  if (!body.host) return 'Host is required.';
  if (body.port < 1 || body.port > 65535) return 'Port out of range.';
  if (!!body.sid === !!body.service_name) {
    return 'Set exactly one of SID or Service name.';
  }
  if (!body.username) return 'Username is required.';
  if (!body.secret_ref.includes('/') || body.secret_ref.endsWith('/')) {
    return 'Secret ref should look like secret/lakebridge/<name>.';
  }
  void isEdit;
  return null;
}

export function SourceEditor({ me: _me, existing, onClose, onSaved }: Props) {
  const [body, setBody] = useState<ApiSourceBody>(() => defaultBody(existing));
  const [endpointMode, setEndpointMode] = useState<'sid' | 'service'>(
    existing?.service_name ? 'service' : 'sid',
  );
  const [serverError, setServerError] = useState<string | null>(null);
  const create = useCreateSource();
  const update = useUpdateSource();
  const pending = create.isPending || update.isPending;
  const isEdit = !!existing;

  useEffect(() => {
    setBody(defaultBody(existing));
    setEndpointMode(existing?.service_name ? 'service' : 'sid');
    setServerError(null);
  }, [existing]);

  const localError = localValidate(body, isEdit);

  const set = <K extends keyof ApiSourceBody>(k: K, v: ApiSourceBody[K]) =>
    setBody((b) => ({ ...b, [k]: v }));

  const onSave = () => {
    if (localError) return;
    setServerError(null);
    const handlers = {
      onSuccess: (s: ApiSource) => onSaved(s),
      onError: (err: unknown) =>
        setServerError(err instanceof Error ? err.message : 'Unknown error'),
    };
    if (existing) {
      update.mutate({ id: existing.id, body }, handlers);
    } else {
      create.mutate(body, handlers);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 flex items-start justify-center pt-[8vh]">
      <div className="w-[640px] max-h-[85vh] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark flex flex-col">
        <div className="px-5 py-3 border-b border-border dark:border-d-border flex items-center justify-between">
          <h3 className="text-base font-medium text-text dark:text-d-text">
            {existing ? `Edit ${existing.id}` : 'New source'}
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
          <Field label="ID" hint="uppercase, hyphens — IFS-PRD-EU style">
            <input
              value={body.id}
              onChange={(e) => set('id', e.target.value.toUpperCase())}
              disabled={isEdit}
              placeholder="IFS-PRD-APAC"
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono disabled:opacity-60"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Host" hint="dns or IP">
              <input
                value={body.host}
                onChange={(e) => set('host', e.target.value)}
                placeholder="ifs-prd-eu.corp.local"
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
            <Field label="Port">
              <input
                type="number"
                value={body.port}
                min={1}
                max={65535}
                onChange={(e) => set('port', parseInt(e.target.value || '0', 10))}
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
          </div>

          <Field label="Endpoint">
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={endpointMode === 'sid'}
                  onChange={() => {
                    setEndpointMode('sid');
                    set('service_name', null);
                    if (!body.sid) set('sid', 'IFSPROD');
                  }}
                  className="accent-brand"
                />
                SID
              </label>
              <label className="inline-flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={endpointMode === 'service'}
                  onChange={() => {
                    setEndpointMode('service');
                    set('sid', null);
                    if (!body.service_name) set('service_name', 'ifs.corp.local');
                  }}
                  className="accent-brand"
                />
                Service name
              </label>
            </div>
            <input
              value={(endpointMode === 'sid' ? body.sid : body.service_name) ?? ''}
              onChange={(e) =>
                set(
                  endpointMode === 'sid' ? 'sid' : 'service_name',
                  e.target.value || null,
                )
              }
              className="mt-2 w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Username">
              <input
                value={body.username}
                onChange={(e) => set('username', e.target.value.toUpperCase())}
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
            <Field label="Oracle version" hint="for the operator's reference">
              <input
                value={body.oracle_version ?? ''}
                onChange={(e) => set('oracle_version', e.target.value || null)}
                placeholder="19c"
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
          </div>

          <Field
            label="Secret reference"
            hint="vault path (or AKV name) — never the password itself"
          >
            <input
              value={body.secret_ref}
              onChange={(e) => set('secret_ref', e.target.value)}
              placeholder="secret/lakebridge/ifs-reader"
              className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="TLS">
              <Select
                value={body.tls_required ? 'required' : 'optional'}
                onChange={(e) => set('tls_required', e.target.value === 'required')}
              >
                <option value="required">required</option>
                <option value="optional">optional</option>
              </Select>
            </Field>
            <Field label="Pool size">
              <input
                type="number"
                value={body.pool_size}
                min={1}
                max={64}
                onChange={(e) => set('pool_size', parseInt(e.target.value || '0', 10))}
                className="w-full h-9 px-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface dark:bg-d-surface text-sm font-mono"
              />
            </Field>
          </div>

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
            {existing ? 'Save changes' : 'Create source'}
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
