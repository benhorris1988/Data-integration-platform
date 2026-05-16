/* global React, ReactDOM, I, LB,
   Button, Input, Kbd, ToastProvider, useToast, StatusBadge, StatusDot, cx,
   JobsIndex, RunDetail, Dashboard, JobDetail, SourcesScreen, ReconScreen, SettingsScreen, SignIn, LakebridgeMark, useClickAway */

// ── Sidebar nav items ──────────────────────────────────────────────────────
const NAV = [
  { key: 'dashboard', label: 'Overview',         icon: I.layoutDashboard },
  { key: 'jobs',      label: 'Jobs',             icon: I.listChecks },
  { key: 'runs',      label: 'Run detail',       icon: I.activity },
  { key: 'sources',   label: 'Sources',          icon: I.database },
  { key: 'recon',     label: 'Reconciliation',   icon: I.gitCompareArrows },
  { key: 'settings',  label: 'Settings',         icon: I.settings },
];

function App() {
  const [theme, setTheme] = React.useState(() => {
    const stored = localStorage.getItem('lb-theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('lb-theme', theme);
  }, [theme]);

  const [signedIn, setSignedIn] = React.useState(true);
  const [route, setRoute] = React.useState({ name: 'jobs' }); // hero first
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    const h = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(o => !o);
      } else if (e.key === 'Escape') {
        setPaletteOpen(false);
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, []);

  const navTo = (name, payload) => setRoute({ name, ...payload });

  if (!signedIn) return (
    <ToastProvider>
      <SignIn onSignedIn={() => setSignedIn(true)} />
    </ToastProvider>
  );

  return (
    <ToastProvider>
      <div className="h-full w-full flex bg-bg dark:bg-d-bg text-text dark:text-d-text">
        <Sidebar route={route} navTo={navTo} onOpenPalette={() => setPaletteOpen(true)} />
        <div className="flex-1 min-w-0 flex flex-col">
          <TopBar
            route={route} theme={theme} setTheme={setTheme}
            onOpenPalette={() => setPaletteOpen(true)}
          />
          <main className="flex-1 min-h-0">
            {route.name === 'dashboard' && <Dashboard onOpenJob={(j) => navTo('job-detail', { job: j })} onOpenRun={(j) => navTo('runs', { job: j })} />}
            {route.name === 'jobs' && <JobsIndex
              onOpenJob={(j) => navTo('job-detail', { job: j })}
              onOpenRun={(j) => navTo('runs', { job: j })}
            />}
            {route.name === 'runs' && <RunDetail job={route.job} onBack={() => navTo('jobs')} />}
            {route.name === 'job-detail' && <JobDetail job={route.job} onBack={() => navTo('jobs')} onOpenRun={(j) => navTo('runs', { job: j })} />}
            {route.name === 'sources' && <SourcesScreen />}
            {route.name === 'recon' && <ReconScreen />}
            {route.name === 'settings' && <SettingsScreen />}
          </main>
        </div>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} navTo={navTo} />}
    </ToastProvider>
  );
}

// ── Sidebar ────────────────────────────────────────────────────────────────
function Sidebar({ route, navTo, onOpenPalette }) {
  return (
    <aside className="w-60 shrink-0 bg-surface dark:bg-d-surface border-r border-border dark:border-d-border flex flex-col">
      <div className="h-14 px-4 flex items-center gap-2 border-b border-border dark:border-d-border">
        <LakebridgeMark size={20} />
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold tracking-tight">Lakebridge</span>
          <span className="text-[10px] font-mono text-text-subtle dark:text-d-text-subtle">prod-eu · r3142</span>
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
        {NAV.map(item => {
          const Icon = item.icon;
          const active = route.name === item.key || (item.key === 'jobs' && route.name === 'job-detail');
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
              {item.key === 'jobs' && <span className="text-[10px] font-mono tabular text-text-subtle dark:text-d-text-subtle">{LB.JOBS.length}</span>}
            </button>
          );
        })}

        <div className="mt-4 px-2 mb-1 text-[10px] uppercase tracking-wide text-text-subtle dark:text-d-text-subtle">Pinned jobs</div>
        {LB.JOBS.slice(0, 4).map(j => (
          <button
            key={j.id}
            onClick={() => navTo('job-detail', { job: j })}
            className="w-full h-7 px-2 rounded-sm flex items-center gap-2 text-xs hover:bg-surface-2 dark:hover:bg-d-surface-2 text-text-muted dark:text-d-text-muted hover:text-text dark:hover:text-d-text"
          >
            <StatusDot status={j.status} />
            <span className="font-mono truncate">{j.code}</span>
          </button>
        ))}
      </nav>

      <div className="border-t border-border dark:border-d-border p-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-sm bg-surface-2 dark:bg-d-surface-2 border border-border dark:border-d-border flex items-center justify-center text-xs font-mono text-text dark:text-d-text">PI</div>
          <div className="flex-1 min-w-0 leading-tight">
            <div className="text-sm text-text dark:text-d-text truncate">Priya Iyer</div>
            <div className="text-xs text-text-subtle dark:text-d-text-subtle truncate">Admin · Okta SSO</div>
          </div>
          <button className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text">
            <I.more size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ── Top bar ────────────────────────────────────────────────────────────────
function TopBar({ route, theme, setTheme, onOpenPalette }) {
  const crumb = ({
    dashboard:    [['Overview']],
    jobs:         [['Jobs']],
    runs:         [['Jobs'], ['Run detail']],
    'job-detail': [['Jobs'], ['Job']],
    sources:      [['Sources']],
    recon:        [['Reconciliation']],
    settings:     [['Settings']],
  })[route.name] || [['']];
  return (
    <div className="h-14 px-6 border-b border-border dark:border-d-border bg-bg dark:bg-d-bg flex items-center justify-between">
      <div className="flex items-center gap-2 text-sm">
        {crumb.map((c, i) => (
          <React.Fragment key={i}>
            <span className={i === crumb.length - 1 ? 'text-text dark:text-d-text font-medium' : 'text-text-muted dark:text-d-text-muted'}>{c[0]}</span>
            {i < crumb.length - 1 && <I.chevronRight size={12} className="text-text-subtle dark:text-d-text-subtle" />}
          </React.Fragment>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-text-muted dark:text-d-text-muted">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-success lb-pulse" />
          lakebridge-api · healthy
        </span>
        <div className="w-px h-5 bg-border dark:bg-d-border" />
        <Button variant="ghost" size="md" onClick={onOpenPalette} iconLeft={<I.command size={14} />}>
          Command
        </Button>
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </div>
    </div>
  );
}

function ThemeToggle({ theme, setTheme }) {
  return (
    <div className="inline-flex rounded-sm border border-border-strong dark:border-d-border-strong overflow-hidden">
      {[
        ['light', <I.sun size={12} />],
        ['dark',  <I.moon size={12} />],
      ].map(([k, icon]) => (
        <button key={k}
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

// ── Command Palette ────────────────────────────────────────────────────────
function CommandPalette({ onClose, navTo }) {
  const [q, setQ] = React.useState('');
  const [idx, setIdx] = React.useState(0);
  const ref = React.useRef(null);
  useClickAway(ref, onClose);

  const items = React.useMemo(() => {
    const all = [
      ...NAV.map(n => ({ kind: 'nav', label: n.label, hint: 'Navigate', icon: <n.icon size={14} />, action: () => navTo(n.key) })),
      ...LB.JOBS.slice(0, 14).map(j => ({ kind: 'job', label: j.code, hint: `Job · ${j.target_table}`, icon: <StatusDot status={j.status} />, action: () => navTo('job-detail', { job: j }) })),
      ...LB.SOURCES.map(s => ({ kind: 'source', label: s.id, hint: `Source · ${s.host}:${s.port}`, icon: <I.database size={14} />, action: () => navTo('sources') })),
      { kind: 'action', label: 'Run latest job again', hint: 'Action · Re-runs the most recently scheduled job', icon: <I.refresh size={14} />, kbd: '⌘R', action: () => navTo('runs') },
      { kind: 'action', label: 'Toggle theme', hint: 'Action · Switch between light and dark', icon: <I.monitor size={14} /> },
      { kind: 'action', label: 'View raw log', hint: 'Action · Open the current run\'s raw log', icon: <I.terminal size={14} />, action: () => navTo('runs') },
    ];
    if (!q.trim()) return all;
    const Q = q.toLowerCase();
    return all.filter(x => x.label.toLowerCase().includes(Q) || x.hint.toLowerCase().includes(Q));
  }, [q]);

  React.useEffect(() => { setIdx(0); }, [q]);

  React.useEffect(() => {
    const h = (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(i + 1, items.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(0, i - 1)); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const it = items[idx]; if (it?.action) it.action();
        onClose();
      }
    };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [items, idx, onClose]);

  // group by kind, preserving order
  const groups = items.reduce((acc, it) => {
    const k = it.kind;
    acc[k] ||= []; acc[k].push(it); return acc;
  }, {});
  const groupOrder = ['nav', 'job', 'source', 'action'];
  const groupLabels = { nav: 'Navigation', job: 'Jobs', source: 'Sources', action: 'Actions' };
  // flatten with running index for keyboard nav highlight
  let running = -1;

  return (
    <div className="fixed inset-0 z-50 bg-black/30 dark:bg-black/60 flex items-start justify-center pt-[12vh]" >
      <div ref={ref} className="w-[640px] bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark overflow-hidden flex flex-col max-h-[70vh]">
        <div className="flex items-center gap-2 px-3 h-11 border-b border-border dark:border-d-border">
          <I.search size={14} className="text-text-subtle dark:text-d-text-subtle" />
          <input
            autoFocus
            value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Jump to job, source, action…"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-subtle dark:placeholder:text-d-text-subtle"
          />
          <Kbd>esc</Kbd>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {items.length === 0 && (
            <div className="px-6 py-10 text-center text-sm text-text-muted dark:text-d-text-muted">
              No results for <span className="font-mono text-text dark:text-d-text">"{q}"</span>
            </div>
          )}
          {groupOrder.map(g => {
            const list = groups[g]; if (!list?.length) return null;
            return (
              <div key={g}>
                <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-text-subtle dark:text-d-text-subtle">{groupLabels[g]}</div>
                {list.map(it => {
                  running++;
                  const active = running === idx;
                  return (
                    <button
                      key={running}
                      onMouseEnter={() => setIdx(running)}
                      onClick={() => { it.action?.(); onClose(); }}
                      className={cx(
                        'w-full text-left px-3 h-9 flex items-center gap-2.5 text-sm',
                        active ? 'bg-brand/10 text-brand dark:bg-brand/15' : 'text-text dark:text-d-text hover:bg-surface-2 dark:hover:bg-d-surface-2',
                      )}
                    >
                      <span className={cx('shrink-0', active ? 'text-brand' : 'text-text-muted dark:text-d-text-muted')}>{it.icon}</span>
                      <span className={cx('flex-1 truncate', it.kind === 'job' || it.kind === 'source' ? 'font-mono' : '')}>{it.label}</span>
                      <span className="text-xs text-text-subtle dark:text-d-text-subtle truncate max-w-[260px]">{it.hint}</span>
                      {it.kbd && <Kbd>{it.kbd}</Kbd>}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="px-3 h-8 border-t border-border dark:border-d-border flex items-center gap-3 text-[11px] text-text-subtle dark:text-d-text-subtle">
          <span className="inline-flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>↵</Kbd> open</span>
          <span className="inline-flex items-center gap-1.5"><Kbd>esc</Kbd> close</span>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
