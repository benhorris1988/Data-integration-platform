import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { LucideProps } from 'lucide-react';
import { cx } from './lib/cx';
import { I } from './lib/icons';
import {
  Button,
  Kbd,
  LakebridgeMark,
  StatusDot,
  ToastProvider,
  useClickAway,
} from './components/primitives';
import { useHealth, useJobs, useLogout, useMe, useSources } from './api/queries';
import type { ApiMe } from './api/types';
import { JobsIndex } from './screens/Jobs';
import { RunDetail } from './screens/Run';
import { Dashboard } from './screens/Dashboard';
import {
  JobDetail,
  ReconScreen,
  SettingsScreen,
  SignIn,
  SourcesScreen,
} from './screens/Misc';

type RouteName =
  | 'dashboard'
  | 'jobs'
  | 'runs'
  | 'job-detail'
  | 'sources'
  | 'recon'
  | 'settings';

// Routes carry only the small handle a destination screen needs to bootstrap.
// The screen itself fetches the full detail via TanStack Query.
export type JobRef = { jobId: number; jobCode: string };
export type RunRef = { runId: number; jobCode?: string };

type Route =
  | { name: 'dashboard' }
  | { name: 'jobs' }
  | { name: 'job-detail'; ref: JobRef }
  | { name: 'runs'; ref?: RunRef }
  | { name: 'sources' }
  | { name: 'recon' }
  | { name: 'settings' };

type Theme = 'light' | 'dark';

type NavItem = { key: RouteName; label: string; icon: ComponentType<LucideProps> };

const NAV: NavItem[] = [
  { key: 'dashboard', label: 'Overview',       icon: I.layoutDashboard },
  { key: 'jobs',      label: 'Jobs',           icon: I.listChecks },
  { key: 'runs',      label: 'Run detail',     icon: I.activity },
  { key: 'sources',   label: 'Sources',        icon: I.database },
  { key: 'recon',     label: 'Reconciliation', icon: I.gitCompareArrows },
  { key: 'settings',  label: 'Settings',       icon: I.settings },
];

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('lb-theme')) as
      | Theme
      | null;
    if (stored === 'light' || stored === 'dark') return stored;
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('lb-theme', theme);
  }, [theme]);

  // The signed-in state is now driven entirely by /api/me. A 401 means
  // we're not signed in; the sign-in screen handles the rest.
  const me = useMe();
  const [route, setRoute] = useState<Route>({ name: 'jobs' });
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const openJob = (ref: JobRef) => setRoute({ name: 'job-detail', ref });
  const openRun = (ref?: RunRef) => setRoute({ name: 'runs', ref });
  const navTo = (name: RouteName) => {
    if (name === 'job-detail' || name === 'runs') return; // require a ref
    setRoute({ name } as Route);
  };

  // While we're checking the session show a minimal splash. If the call
  // failed (401 most likely) drop straight to the sign-in screen.
  if (me.isPending) {
    return (
      <ToastProvider>
        <div className="h-full w-full flex items-center justify-center bg-bg dark:bg-d-bg">
          <span className="text-sm text-text-muted dark:text-d-text-muted">
            Checking session…
          </span>
        </div>
      </ToastProvider>
    );
  }
  if (me.isError || !me.data) {
    return (
      <ToastProvider>
        <SignIn />
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="h-full w-full flex bg-bg dark:bg-d-bg text-text dark:text-d-text">
        <Sidebar
          me={me.data}
          route={route}
          navTo={navTo}
          openJob={openJob}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar
            route={route}
            theme={theme}
            setTheme={setTheme}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main className="flex-1 min-h-0">
            {route.name === 'dashboard' && (
              <Dashboard onOpenJob={openJob} onOpenRun={openRun} />
            )}
            {route.name === 'jobs' && (
              <JobsIndex me={me.data} onOpenJob={openJob} onOpenRun={openRun} />
            )}
            {route.name === 'runs' && (
              <RunDetail
                me={me.data}
                runRef={route.ref}
                onBack={() => setRoute({ name: 'jobs' })}
              />
            )}
            {route.name === 'job-detail' && (
              <JobDetail
                me={me.data}
                jobRef={route.ref}
                onBack={() => setRoute({ name: 'jobs' })}
                onOpenRun={openRun}
              />
            )}
            {route.name === 'sources' && <SourcesScreen me={me.data} />}
            {route.name === 'recon' && <ReconScreen onOpenJob={openJob} />}
            {route.name === 'settings' && <SettingsScreen me={me.data} />}
          </main>
        </div>
      </div>
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          navTo={navTo}
          openJob={openJob}
          openRun={openRun}
        />
      )}
    </ToastProvider>
  );
}

function Sidebar({
  me,
  route,
  navTo,
  openJob,
  onOpenPalette,
}: {
  me: ApiMe;
  route: Route;
  navTo: (name: RouteName) => void;
  openJob: (ref: JobRef) => void;
  onOpenPalette: () => void;
}) {
  // Hit the API for the sidebar's job count and pinned list — the data is
  // already cached when the operator navigates to the Jobs index.
  const jobs = useJobs();
  const logout = useLogout();
  const pinned = (jobs.data ?? []).filter((j) => j.pinned).slice(0, 4);
  const initials = me.name
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  return (
    <aside className="w-60 shrink-0 bg-surface dark:bg-d-surface border-r border-border dark:border-d-border flex flex-col">
      <div className="h-14 px-4 flex items-center gap-2 border-b border-border dark:border-d-border">
        <LakebridgeMark size={20} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Lakebridge</span>
          <span className="text-[10px] font-mono text-text-subtle dark:text-d-text-subtle">
            prod-eu · r3142
          </span>
        </div>
      </div>

      <div className="px-3 py-2">
        <button
          onClick={onOpenPalette}
          className="w-full h-8 px-2 inline-flex items-center gap-2 rounded-sm border border-border-strong dark:border-d-border-strong bg-surface-2 dark:bg-d-surface-2 text-text-muted dark:text-d-text-muted hover:text-text dark:hover:text-d-text"
        >
          <I.search size={14} />
          <span className="text-sm flex-1 text-left">Jump to…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      <nav className="px-2 py-1 flex-1 overflow-auto">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active =
            route.name === item.key ||
            (item.key === 'jobs' && route.name === 'job-detail');
          return (
            <button
              key={item.key}
              onClick={() => navTo(item.key)}
              className={cx(
                'w-full h-8 px-2 rounded-sm flex items-center gap-2 text-sm font-medium transition-colors',
                active
                  ? 'bg-brand/10 text-brand dark:bg-brand/15'
                  : 'text-text-muted dark:text-d-text-muted hover:text-text dark:hover:text-d-text hover:bg-surface-2 dark:hover:bg-d-surface-2',
              )}
            >
              <Icon size={14} />
              <span className="flex-1 text-left">{item.label}</span>
              {item.key === 'jobs' && jobs.data && (
                <span className="text-[10px] font-mono tabular text-text-subtle dark:text-d-text-subtle">
                  {jobs.data.length}
                </span>
              )}
            </button>
          );
        })}

        {pinned.length > 0 && (
          <>
            <div className="mt-4 px-2 mb-1 text-[10px] uppercase tracking-wide text-text-subtle dark:text-d-text-subtle">
              Pinned jobs
            </div>
            {pinned.map((j) => (
              <button
                key={j.id}
                onClick={() => openJob({ jobId: j.id, jobCode: j.code })}
                className="w-full h-7 px-2 rounded-sm flex items-center gap-2 text-xs hover:bg-surface-2 dark:hover:bg-d-surface-2 text-text-muted dark:text-d-text-muted hover:text-text dark:hover:text-d-text"
              >
                <StatusDot status={j.last_run_status ?? 'queued'} />
                <span className="font-mono truncate">{j.code}</span>
              </button>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-border dark:border-d-border p-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-sm bg-surface-2 dark:bg-d-surface-2 border border-border dark:border-d-border flex items-center justify-center text-xs font-mono text-text dark:text-d-text">
            {initials || '··'}
          </div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-sm text-text dark:text-d-text truncate">{me.name}</div>
            <div className="text-xs text-text-subtle dark:text-d-text-subtle truncate">
              {me.role} ·{' '}
              {me.auth_mode === 'oidc'
                ? 'Okta SSO'
                : me.auth_mode === 'dev'
                ? 'dev session'
                : 'auth disabled'}
            </div>
          </div>
          <button
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            title="Sign out"
            className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text disabled:opacity-50"
            aria-label="Sign out"
          >
            <I.logOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function TopBar({
  route,
  theme,
  setTheme,
  onOpenPalette,
}: {
  route: Route;
  theme: Theme;
  setTheme: (t: Theme) => void;
  onOpenPalette: () => void;
}) {
  const health = useHealth();
  const crumb: string[][] =
    {
      dashboard: [['Overview']],
      jobs: [['Jobs']],
      runs: [['Jobs'], ['Run detail']],
      'job-detail': [['Jobs'], ['Job']],
      sources: [['Sources']],
      recon: [['Reconciliation']],
      settings: [['Settings']],
    }[route.name] ?? [['']];

  let healthLabel: string;
  let healthTone: 'success' | 'warning' | 'danger';
  if (health.isPending) {
    healthLabel = 'lakebridge-api · connecting';
    healthTone = 'warning';
  } else if (health.isError) {
    healthLabel = 'lakebridge-api · unreachable';
    healthTone = 'danger';
  } else {
    healthLabel = `lakebridge-api · healthy · v${health.data?.version ?? '?'}`;
    healthTone = 'success';
  }
  const dotColor = {
    success: 'bg-success',
    warning: 'bg-warning',
    danger: 'bg-danger',
  }[healthTone];

  return (
    <div className="h-14 px-6 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        {crumb.map((c, i) => (
          <Fragment key={i}>
            <span
              className={
                i === crumb.length - 1
                  ? 'text-text dark:text-d-text font-medium'
                  : 'text-text-muted dark:text-d-text-muted'
              }
            >
              {c[0]}
            </span>
            {i < crumb.length - 1 && (
              <I.chevronRight size={12} className="text-text-subtle dark:text-d-text-subtle" />
            )}
          </Fragment>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span
          className="hidden md:inline-flex items-center gap-1.5 text-xs text-text-muted dark:text-d-text-muted"
          title={health.error?.message ?? undefined}
        >
          <span className={cx('inline-block w-1.5 h-1.5 rounded-full lb-pulse', dotColor)} />
          {healthLabel}
        </span>
        <div className="w-px h-5 bg-border dark:bg-d-border" />
        <Button
          variant="ghost"
          size="md"
          onClick={onOpenPalette}
          iconLeft={<I.command size={14} />}
        >
          Command
        </Button>
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>
    </div>
  );
}

function ThemeToggle({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  const items: Array<[Theme, ReactNode]> = [
    ['light', <I.sun size={12} />],
    ['dark', <I.moon size={12} />],
  ];
  return (
    <div className="inline-flex rounded-sm border border-border-strong dark:border-d-border-strong overflow-hidden">
      {items.map(([k, icon]) => (
        <button
          key={k}
          onClick={() => setTheme(k)}
          className={cx(
            'h-8 w-8 inline-flex items-center justify-center',
            theme === k
              ? 'bg-surface-2 text-text dark:bg-d-surface-2 dark:text-d-text'
              : 'bg-surface text-text-muted hover:text-text dark:bg-d-surface dark:text-d-text-muted dark:hover:text-d-text',
          )}
          aria-label={`${k} theme`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}

type PaletteItem = {
  kind: 'nav' | 'job' | 'source' | 'action';
  label: string;
  hint: string;
  icon: ReactNode;
  kbd?: string;
  action?: () => void;
};

function CommandPalette({
  onClose,
  navTo,
  openJob,
  openRun,
}: {
  onClose: () => void;
  navTo: (name: RouteName) => void;
  openJob: (ref: JobRef) => void;
  openRun: (ref?: RunRef) => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, onClose);
  const jobs = useJobs();
  const sources = useSources();

  const items = useMemo<PaletteItem[]>(() => {
    const NavIcon = (Icon: ComponentType<LucideProps>) => <Icon size={14} />;
    const all: PaletteItem[] = [
      ...NAV.map((n) => ({
        kind: 'nav' as const,
        label: n.label,
        hint: 'Navigate',
        icon: NavIcon(n.icon),
        action: () => navTo(n.key),
      })),
      ...(jobs.data ?? []).slice(0, 14).map((j) => ({
        kind: 'job' as const,
        label: j.code,
        hint: `Job · ${j.target_table}`,
        icon: <StatusDot status={j.last_run_status ?? 'queued'} />,
        action: () => openJob({ jobId: j.id, jobCode: j.code }),
      })),
      ...(sources.data ?? []).map((s) => ({
        kind: 'source' as const,
        label: s.id,
        hint: `Source · ${s.host}:${s.port}`,
        icon: <I.database size={14} />,
        action: () => navTo('sources'),
      })),
      {
        kind: 'action',
        label: 'Open latest run',
        hint: 'Action · Last triggered run',
        icon: <I.refresh size={14} />,
        kbd: '⌘R',
        action: () => openRun(),
      },
      {
        kind: 'action',
        label: 'Toggle theme',
        hint: 'Action · Switch between light and dark',
        icon: <I.monitor size={14} />,
      },
      {
        kind: 'action',
        label: 'View raw log',
        hint: "Action · Open the current run's raw log",
        icon: <I.terminal size={14} />,
        action: () => openRun(),
      },
    ];
    if (!q.trim()) return all;
    const Q = q.toLowerCase();
    return all.filter(
      (x) => x.label.toLowerCase().includes(Q) || x.hint.toLowerCase().includes(Q),
    );
  }, [q, navTo, openJob, openRun, jobs.data, sources.data]);

  useEffect(() => {
    setIdx(0);
  }, [q]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setIdx((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[idx];
        if (it?.action) it.action();
        onClose();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [items, idx, onClose]);

  const groups = items.reduce<Record<string, PaletteItem[]>>((acc, it) => {
    (acc[it.kind] ||= []).push(it);
    return acc;
  }, {});
  const groupOrder = ['nav', 'job', 'source', 'action'] as const;
  const groupLabels: Record<(typeof groupOrder)[number], string> = {
    nav: 'Navigation',
    job: 'Jobs',
    source: 'Sources',
    action: 'Actions',
  };
  let running = -1;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 flex items-start justify-center pt-[12vh]">
      <div
        ref={ref}
        className="w-[640px] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark overflow-hidden flex flex-col max-h-[70vh]"
      >
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border dark:border-d-border">
          <I.search size={14} className="text-text-subtle dark:text-d-text-subtle" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to job, source, action…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-subtle dark:placeholder:text-d-text-subtle"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {items.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
              No results for{' '}
              <span className="font-mono text-text dark:text-d-text">"{q}"</span>
            </div>
          )}
          {groupOrder.map((g) => {
            const list = groups[g];
            if (!list?.length) return null;
            return (
              <div key={g}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-subtle dark:text-d-text-subtle">
                  {groupLabels[g]}
                </div>
                {list.map((it) => {
                  running++;
                  const active = running === idx;
                  const myIdx = running;
                  return (
                    <button
                      key={`${g}-${myIdx}`}
                      onMouseEnter={() => setIdx(myIdx)}
                      onClick={() => {
                        it.action?.();
                        onClose();
                      }}
                      className={cx(
                        'w-full text-left px-3 h-9 flex items-center gap-2.5 text-sm',
                        active
                          ? 'bg-brand/10 text-brand dark:bg-brand/15'
                          : 'text-text dark:text-d-text hover:bg-surface-2 dark:hover:bg-d-surface-2',
                      )}
                    >
                      <span
                        className={cx(
                          'shrink-0',
                          active ? 'text-brand' : 'text-text-muted dark:text-d-text-muted',
                        )}
                      >
                        {it.icon}
                      </span>
                      <span
                        className={cx(
                          'flex-1 truncate',
                          it.kind === 'job' || it.kind === 'source' ? 'font-mono' : '',
                        )}
                      >
                        {it.label}
                      </span>
                      <span className="text-xs text-text-subtle dark:text-d-text-subtle truncate max-w-[260px]">
                        {it.hint}
                      </span>
                      {it.kbd && <Kbd>{it.kbd}</Kbd>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="px-3 h-8 border-t border-border dark:border-d-border flex items-center gap-3 text-[11px] text-text-subtle dark:text-d-text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> navigate
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>↵</Kbd> open
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>esc</Kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}
