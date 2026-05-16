// TanStack Query hooks for every endpoint the screens consume. Keep the call
// sites tidy: any component that needs jobs just calls `useJobs()` and gets
// `{ data, isPending, error }`.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from './client';
import type {
  ApiAuditEntry,
  ApiAuthConfig,
  ApiDashboardKpis,
  ApiJob,
  ApiJobListItem,
  ApiJobSchema,
  ApiMe,
  ApiRecentError,
  ApiReconRow,
  ApiRun,
  ApiRunError,
  ApiRunRecon,
  ApiRunStep,
  ApiSource,
  ApiSourceObject,
  ApiTestConnectionResult,
  ApiTimelineEntry,
  ApiUser,
  RunStatus,
} from './types';

// ── Jobs ──────────────────────────────────────────────────────────────────

export type JobsFilters = {
  status?: RunStatus[];
  schedule?: 'manual' | 'scheduled';
  sourceId?: string;
  q?: string;
};

export function useJobs(filters: JobsFilters = {}) {
  const params = new URLSearchParams();
  filters.status?.forEach((s) => params.append('status', s));
  if (filters.schedule) params.set('schedule', filters.schedule);
  if (filters.sourceId) params.set('source_id', filters.sourceId);
  if (filters.q) params.set('q', filters.q);
  const qs = params.toString();
  return useQuery({
    queryKey: ['jobs', filters],
    queryFn: () =>
      request<ApiJobListItem[]>(`/api/jobs${qs ? `?${qs}` : ''}`),
    staleTime: 10_000,
  });
}

export function useJobSchema(jobId: number | undefined) {
  return useQuery({
    queryKey: ['job-schema', jobId],
    queryFn: () => request<ApiJobSchema>(`/api/jobs/${jobId}/schema`),
    enabled: jobId !== undefined,
    staleTime: 60_000,
    retry: 0,  // introspection failures usually mean Oracle is down — surface fast
  });
}

export function useJobRuns(jobId: number | undefined, limit = 50) {
  return useQuery({
    queryKey: ['job-runs', jobId, limit],
    queryFn: () => request<ApiRun[]>(`/api/jobs/${jobId}/runs?limit=${limit}`),
    enabled: jobId !== undefined,
    staleTime: 10_000,
  });
}

export function useJob(jobId: number | undefined) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => request<ApiJob>(`/api/jobs/${jobId}`),
    enabled: jobId !== undefined,
  });
}

export function useRunJob() {
  const qc = useQueryClient();
  return useMutation({
    // `triggered_by` is no longer a parameter — the server resolves it
    // from the session cookie. Clients can't impersonate other users.
    mutationFn: ({
      jobId,
      runMode = 'manual',
      backfillFrom,
      backfillTo,
    }: {
      jobId: number;
      runMode?: 'manual' | 'backfill';
      backfillFrom?: string;
      backfillTo?: string;
    }) =>
      request<{ run_id: number }>(`/api/jobs/${jobId}/run`, {
        method: 'POST',
        body: JSON.stringify({
          run_mode: runMode,
          backfill_from: backfillFrom,
          backfill_to: backfillTo,
        }),
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job', vars.jobId] });
    },
  });
}

// Shape sent to POST /api/jobs and PUT /api/jobs/:id. Matches JobBody on
// the server.
export type ApiJobBody = {
  code: string;
  source_id: string;
  source_object: string;
  source_query: string | null;
  target_schema: string;
  target_table: string;
  strategy: 'full_snapshot' | 'append' | 'watermark_delta' | 'truncate_and_load';
  schedule: string;
  watermark_column: string | null;
  watermark_grace_sec: number;
  batch_size: number;
  retries: number;
  timeout_sec: number;
  owner: string;
  enabled: boolean;
};

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ApiJobBody) =>
      request<ApiJob>('/api/jobs', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, body }: { jobId: number; body: ApiJobBody }) =>
      request<ApiJob>(`/api/jobs/${jobId}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job', vars.jobId] });
    },
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, force = false }: { jobId: number; force?: boolean }) =>
      request<void>(`/api/jobs/${jobId}${force ? '?force=true' : ''}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useSetPinned() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, pinned }: { jobId: number; pinned: boolean }) =>
      request<{ pinned: boolean }>(`/api/jobs/${jobId}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['jobs'] }),
  });
}

export function useToggleJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, enabled }: { jobId: number; enabled: boolean }) =>
      request<{ enabled: boolean }>(
        `/api/jobs/${jobId}/${enabled ? 'enable' : 'disable'}`,
        { method: 'POST' },
      ),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['job', vars.jobId] });
    },
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────

export function useRun(runId: number | undefined, refetchMs?: number) {
  return useQuery({
    queryKey: ['run', runId],
    queryFn: () => request<ApiRun>(`/api/runs/${runId}`),
    enabled: runId !== undefined,
    refetchInterval: refetchMs,
  });
}

export function useRunSteps(runId: number | undefined, refetchMs?: number) {
  return useQuery({
    queryKey: ['run', runId, 'steps'],
    queryFn: () => request<ApiRunStep[]>(`/api/runs/${runId}/steps`),
    enabled: runId !== undefined,
    refetchInterval: refetchMs,
  });
}

export function useRunRecon(runId: number | undefined, refetchMs?: number) {
  return useQuery({
    queryKey: ['run', runId, 'recon'],
    queryFn: () => request<ApiRunRecon | null>(`/api/runs/${runId}/recon`),
    enabled: runId !== undefined,
    refetchInterval: refetchMs,
  });
}

export function useRunErrors(runId: number | undefined, refetchMs?: number) {
  return useQuery({
    queryKey: ['run', runId, 'errors'],
    queryFn: () => request<ApiRunError[]>(`/api/runs/${runId}/errors`),
    enabled: runId !== undefined,
    refetchInterval: refetchMs,
  });
}

export function useCancelRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: number) =>
      request<{ cancel_requested: boolean }>(`/api/runs/${runId}/cancel`, {
        method: 'POST',
      }),
    onSuccess: (_d, runId) => {
      qc.invalidateQueries({ queryKey: ['run', runId] });
    },
  });
}

// ── Sources ───────────────────────────────────────────────────────────────

export function useSources() {
  return useQuery({
    queryKey: ['sources'],
    queryFn: () => request<ApiSource[]>('/api/sources'),
    staleTime: 30_000,
  });
}

export function useSourceObjects(
  sourceId: string | undefined,
  like: string | undefined,
  limit = 100,
) {
  const params = new URLSearchParams();
  if (like) params.set('like', like);
  params.set('limit', String(limit));
  return useQuery({
    queryKey: ['source-objects', sourceId, like, limit],
    queryFn: () =>
      request<ApiSourceObject[]>(
        `/api/sources/${sourceId}/objects?${params.toString()}`,
      ),
    enabled: sourceId !== undefined,
    staleTime: 60_000,
    retry: 0,
  });
}

export function useTestConnection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sourceId: string) =>
      request<ApiTestConnectionResult>(
        `/api/sources/${sourceId}/test-connection`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export function useDashboardKpis(refetchMs = 30_000) {
  return useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => request<ApiDashboardKpis>('/api/dashboard/kpis'),
    refetchInterval: refetchMs,
  });
}

export function useDashboardTimeline(refetchMs = 30_000) {
  return useQuery({
    queryKey: ['dashboard', 'timeline'],
    queryFn: () => request<ApiTimelineEntry[]>('/api/dashboard/timeline'),
    refetchInterval: refetchMs,
  });
}

export function useDashboardErrors(limit = 10, refetchMs = 30_000) {
  return useQuery({
    queryKey: ['dashboard', 'errors-recent', limit],
    queryFn: () =>
      request<ApiRecentError[]>(`/api/dashboard/errors-recent?limit=${limit}`),
    refetchInterval: refetchMs,
  });
}

// ── Recon ─────────────────────────────────────────────────────────────────

export function useReconMatrix(limitJobs = 14, lastN = 6) {
  return useQuery({
    queryKey: ['recon', limitJobs, lastN],
    queryFn: () =>
      request<ApiReconRow[]>(
        `/api/recon?limit_jobs=${limitJobs}&last_n=${lastN}`,
      ),
    staleTime: 30_000,
  });
}

// ── Users + Audit ────────────────────────────────────────────────────────

export function useUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => request<ApiUser[]>('/api/users'),
    staleTime: 60_000,
  });
}

export function useAudit(limit = 200) {
  return useQuery({
    queryKey: ['audit', limit],
    queryFn: () => request<ApiAuditEntry[]>(`/api/audit?limit=${limit}`),
    staleTime: 10_000,
  });
}

// ── Health (for the top-bar "lakebridge-api · healthy" pill) ─────────────

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => request<{ status: string; version: string }>('/api/health'),
    refetchInterval: 30_000,
    retry: 1,
    staleTime: 10_000,
  });
}

// ── Auth ─────────────────────────────────────────────────────────────────

export function useMe() {
  // `retry: false` because we treat 401 as "not signed in" and want the
  // outer app to switch to the sign-in screen immediately on first failure
  // rather than retrying three times silently.
  return useQuery({
    queryKey: ['me'],
    queryFn: () => request<ApiMe>('/api/me'),
    retry: false,
    staleTime: 60_000,
  });
}

export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => request<ApiAuthConfig>('/api/auth/config'),
    staleTime: 5 * 60_000,
  });
}

export function useDevSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      request<ApiMe>('/api/auth/dev-session', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    onSuccess: () => {
      // Wipe every cached query on logout so the next user doesn't see
      // stale data with a different access scope.
      qc.clear();
    },
  });
}
