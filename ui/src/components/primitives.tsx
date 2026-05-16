import {
  cloneElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type SelectHTMLAttributes,
} from 'react';
import { cx } from '../lib/cx';
import { I } from '../lib/icons';

// ── Button ─────────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  iconLeft,
  iconRight,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium select-none transition-colors border';
  const sizes: Record<ButtonSize, string> = {
    sm: 'h-7 px-2 text-xs',
    md: 'h-8 px-2.5 text-sm',
    lg: 'h-9 px-3 text-sm',
  };
  const variants: Record<ButtonVariant, string> = {
    primary:
      'bg-brand text-white border-brand hover:bg-brand-hover hover:border-brand-hover disabled:bg-text-subtle disabled:border-text-subtle dark:disabled:bg-d-border-strong dark:disabled:border-d-border-strong',
    secondary:
      'bg-surface text-text border-border-strong hover:bg-surface-2 dark:bg-d-surface dark:text-d-text dark:border-d-border-strong dark:hover:bg-d-surface-2',
    ghost:
      'bg-transparent text-text-muted border-transparent hover:bg-surface-2 hover:text-text dark:text-d-text-muted dark:hover:bg-d-surface-2 dark:hover:text-d-text',
    danger:
      'bg-danger text-white border-danger hover:bg-red-700 hover:border-red-700',
  };
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        base,
        sizes[size],
        variants[variant],
        (disabled || loading) && 'opacity-60 cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      {loading ? <I.loader size={14} className="lb-spin" /> : iconLeft}
      {children && <span>{children}</span>}
      {!loading && iconRight}
    </button>
  );
}

// ── Status badge ───────────────────────────────────────────────────────────
type StatusKey =
  | 'succeeded'
  | 'running'
  | 'failed'
  | 'queued'
  | 'cancelled'
  | 'warning'
  | 'ok'
  | 'degraded'
  | 'fail'
  | 'warn';

const STATUS_TOKEN: Record<
  StatusKey,
  { dot: string; label: string; pulse?: boolean }
> = {
  succeeded: { dot: 'bg-success', label: 'Succeeded' },
  running:   { dot: 'bg-brand',   label: 'Running', pulse: true },
  failed:    { dot: 'bg-danger',  label: 'Failed' },
  queued:    { dot: 'bg-queued',  label: 'Queued' },
  cancelled: { dot: 'bg-text-subtle dark:bg-d-text-subtle', label: 'Cancelled' },
  warning:   { dot: 'bg-warning', label: 'Warning' },
  ok:        { dot: 'bg-success', label: 'OK' },
  degraded:  { dot: 'bg-warning', label: 'Degraded' },
  fail:      { dot: 'bg-danger',  label: 'Fail' },
  warn:      { dot: 'bg-warning', label: 'Warn' },
};

export function StatusBadge({
  status,
  label,
  dense = false,
  className = '',
}: {
  status: string;
  label?: string;
  dense?: boolean;
  className?: string;
}) {
  const t = STATUS_TOKEN[status as StatusKey] ?? STATUS_TOKEN.queued;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5',
        dense ? 'text-xs' : 'text-sm',
        'text-text dark:text-d-text',
        className,
      )}
    >
      <span
        className={cx(
          'inline-block rounded-full',
          dense ? 'w-1.5 h-1.5' : 'w-2 h-2',
          t.dot,
          t.pulse && 'lb-pulse',
        )}
      />
      <span>{label ?? t.label}</span>
    </span>
  );
}

export function StatusDot({
  status,
  className = '',
}: {
  status: string;
  className?: string;
}) {
  const t = STATUS_TOKEN[status as StatusKey] ?? STATUS_TOKEN.queued;
  return (
    <span
      className={cx(
        'inline-block w-2 h-2 rounded-full',
        t.dot,
        t.pulse && 'lb-pulse',
        className,
      )}
    />
  );
}

// ── Tag ────────────────────────────────────────────────────────────────────
export function Tag({
  children,
  className = '',
  mono = false,
}: {
  children: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center px-1.5 h-5 rounded-sm border text-xs',
        mono ? 'font-mono' : '',
        'bg-surface-2 border-border text-text-muted dark:bg-d-surface-2 dark:border-d-border dark:text-d-text-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────
type InputSize = 'sm' | 'md' | 'lg';
type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & {
  size?: InputSize;
  error?: boolean;
  icon?: ReactNode;
};

export function Input({
  size = 'md',
  error,
  icon,
  className = '',
  ...rest
}: InputProps) {
  const heights: Record<InputSize, string> = {
    sm: 'h-7 text-xs',
    md: 'h-8 text-sm',
    lg: 'h-9 text-sm',
  };
  return (
    <div className="relative w-full">
      {icon && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-subtle dark:text-d-text-subtle pointer-events-none">
          {icon}
        </span>
      )}
      <input
        className={cx(
          'w-full rounded-sm border bg-surface text-text placeholder:text-text-subtle',
          'dark:bg-d-surface dark:text-d-text dark:placeholder:text-d-text-subtle',
          'border-border-strong dark:border-d-border-strong',
          'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30',
          icon ? 'pl-7' : 'px-2.5',
          'pr-2.5',
          heights[size],
          error && 'border-danger focus:border-danger focus:ring-danger/30',
          className,
        )}
        {...rest}
      />
    </div>
  );
}

// ── Select ─────────────────────────────────────────────────────────────────
type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & {
  size?: InputSize;
};

export function Select({
  size = 'md',
  children,
  className = '',
  ...rest
}: SelectProps) {
  const heights: Record<InputSize, string> = {
    sm: 'h-7 text-xs',
    md: 'h-8 text-sm',
    lg: 'h-9 text-sm',
  };
  return (
    <div className="relative">
      <select
        className={cx(
          'appearance-none w-full rounded-sm border bg-surface text-text pr-7 pl-2.5',
          'dark:bg-d-surface dark:text-d-text',
          'border-border-strong dark:border-d-border-strong',
          'focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/30',
          heights[size],
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <I.chevronDown
        size={14}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-text-subtle dark:text-d-text-subtle pointer-events-none"
      />
    </div>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────
export type TabItem = { value: string; label: string; count?: number };

export function Tabs({
  tabs,
  value,
  onChange,
  right = null,
}: {
  tabs: TabItem[];
  value: string;
  onChange: (v: string) => void;
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between border-b border-border dark:border-d-border">
      <div className="flex">
        {tabs.map((t) => {
          const active = t.value === value;
          return (
            <button
              key={t.value}
              onClick={() => onChange(t.value)}
              className={cx(
                'relative h-9 px-3 text-sm font-medium transition-colors',
                active
                  ? 'text-text dark:text-d-text'
                  : 'text-text-muted hover:text-text dark:text-d-text-muted dark:hover:text-d-text',
              )}
            >
              <span className="inline-flex items-center gap-1.5">
                {t.label}
                {typeof t.count === 'number' && (
                  <span
                    className={cx(
                      'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm text-xs tabular',
                      active
                        ? 'bg-text/10 text-text dark:bg-d-text/10 dark:text-d-text'
                        : 'bg-surface-2 text-text-muted dark:bg-d-surface-2 dark:text-d-text-muted',
                    )}
                  >
                    {t.count}
                  </span>
                )}
              </span>
              {active && <span className="absolute left-0 right-0 bottom-[-1px] h-[2px] bg-brand" />}
            </button>
          );
        })}
      </div>
      {right && <div className="pb-1">{right}</div>}
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="w-10 h-10 rounded-md border border-border dark:border-d-border flex items-center justify-center text-text-subtle dark:text-d-text-subtle mb-3">
        {icon ?? <I.inbox size={20} />}
      </div>
      <div className="text-sm font-medium text-text dark:text-d-text">{title}</div>
      {description && (
        <div className="mt-1 text-sm text-text-muted dark:text-d-text-muted max-w-sm">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── Skeleton ───────────────────────────────────────────────────────────────
export function SkeletonBlock({
  w = '100%',
  h = 12,
  className = '',
}: {
  w?: string | number;
  h?: number;
  className?: string;
}) {
  return (
    <div
      className={cx('lb-skeleton rounded-sm', className)}
      style={{ width: w, height: h }}
    />
  );
}

// ── Inline banner ──────────────────────────────────────────────────────────
type BannerTone = 'info' | 'warning' | 'danger' | 'success';

export function InlineBanner({
  tone = 'info',
  title,
  description,
  action,
  onDismiss,
  className = '',
}: {
  tone?: BannerTone;
  title: string;
  description?: string;
  action?: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const tones: Record<BannerTone, { wrap: string; icon: ReactNode }> = {
    info: {
      wrap: 'bg-surface border-info/30 dark:bg-d-surface dark:border-info/40',
      icon: <I.info size={16} className="text-info" />,
    },
    warning: {
      wrap: 'bg-surface border-warning/30 dark:bg-d-surface dark:border-warning/40',
      icon: <I.alertTriangle size={16} className="text-warning" />,
    },
    danger: {
      wrap: 'bg-surface border-danger/30 dark:bg-d-surface dark:border-danger/40',
      icon: <I.alertCircle size={16} className="text-danger" />,
    },
    success: {
      wrap: 'bg-surface border-success/30 dark:bg-d-surface dark:border-success/40',
      icon: <I.check size={16} className="text-success" />,
    },
  };
  const t = tones[tone];
  return (
    <div
      className={cx('flex items-start gap-3 border rounded-md px-3 py-2.5', t.wrap, className)}
    >
      <div className="mt-0.5">{t.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-text dark:text-d-text">{title}</div>
        {description && (
          <div className="text-sm text-text-muted dark:text-d-text-muted mt-0.5">
            {description}
          </div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="shrink-0 text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text"
          aria-label="Dismiss"
        >
          <I.x size={14} />
        </button>
      )}
    </div>
  );
}

// ── Sortable header cell ───────────────────────────────────────────────────
export function ThSort({
  children,
  sort,
  dir,
  k,
  onSort,
  align = 'left',
  className = '',
}: {
  children: ReactNode;
  sort: string;
  dir: 'asc' | 'desc';
  k: string;
  onSort: (k: string) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  const active = sort === k;
  return (
    <th
      className={cx(
        'select-none px-3 text-xs font-medium text-text-muted dark:text-d-text-muted',
        'uppercase tracking-wide',
        'h-9 border-b border-border dark:border-d-border',
        'bg-surface dark:bg-d-surface sticky top-0 z-10',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cx(
          'inline-flex items-center gap-1 hover:text-text dark:hover:text-d-text',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        <span>{children}</span>
        {active ? (
          dir === 'asc' ? (
            <I.arrowUp size={12} className="text-text dark:text-d-text" />
          ) : (
            <I.arrowDown size={12} className="text-text dark:text-d-text" />
          )
        ) : (
          <I.chevronsUpDown size={12} className="text-text-subtle dark:text-d-text-subtle" />
        )}
      </button>
    </th>
  );
}

// ── Toast ──────────────────────────────────────────────────────────────────
type Toast = {
  id: string;
  tone?: BannerTone;
  title: string;
  description?: string;
  duration?: number;
};

type ToastContextValue = {
  push: (t: Omit<Toast, 'id'> & Partial<Pick<Toast, 'id'>>) => string;
  dismiss: (id: string) => void;
};

const ToastCtx = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>((t) => {
    const id = t.id ?? Math.random().toString(36).slice(2);
    const toast: Toast = { tone: 'info', duration: 4500, ...t, id };
    setToasts((prev) => [...prev, toast]);
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== id));
      }, toast.duration);
    }
    return id;
  }, []);

  return (
    <ToastCtx.Provider value={{ push, dismiss }}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => {
          const toneIcon = {
            info: <I.info size={16} className="text-info" />,
            success: <I.check size={16} className="text-success" />,
            warning: <I.alertTriangle size={16} className="text-warning" />,
            danger: <I.alertCircle size={16} className="text-danger" />,
          }[t.tone ?? 'info'];
          return (
            <div
              key={t.id}
              className="bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark px-3 py-2.5 flex items-start gap-3 animate-lb-fade-in-up"
            >
              <div className="mt-0.5">{toneIcon}</div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text dark:text-d-text">{t.title}</div>
                {t.description && (
                  <div className="text-sm text-text-muted dark:text-d-text-muted mt-0.5">
                    {t.description}
                  </div>
                )}
              </div>
              <button
                className="text-text-subtle hover:text-text dark:text-d-text-subtle dark:hover:text-d-text"
                onClick={() => dismiss(t.id)}
              >
                <I.x size={14} />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ── Kbd ────────────────────────────────────────────────────────────────────
export function Kbd({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cx(
        'inline-flex items-center justify-center px-1 min-w-[18px] h-[18px] rounded-sm',
        'border border-border dark:border-d-border bg-surface-2 dark:bg-d-surface-2',
        'text-[10px] font-mono text-text-muted dark:text-d-text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ── Click-away hook ────────────────────────────────────────────────────────
export function useClickAway(ref: RefObject<HTMLElement>, onAway: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onAway();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onAway]);
}

// ── Dropdown menu ──────────────────────────────────────────────────────────
export type DropdownItem =
  | { divider: true }
  | {
      divider?: false;
      label: string;
      icon?: ReactNode;
      kbd?: string;
      danger?: boolean;
      onClick?: () => void;
    };

type TriggerProps = { onClick?: (e: ReactMouseEvent) => void };

export function DropdownMenu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: ReactElement<TriggerProps>;
  items: DropdownItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));
  const originalClick = trigger.props.onClick;
  return (
    <div className="relative inline-block" ref={ref}>
      {cloneElement(trigger, {
        onClick: (e: ReactMouseEvent) => {
          e.stopPropagation();
          originalClick?.(e);
          setOpen((o) => !o);
        },
      })}
      {open && (
        <div
          className={cx(
            'absolute mt-1 min-w-[180px] z-40 bg-surface dark:bg-d-surface border border-border dark:border-d-border rounded-md shadow-overlay dark:shadow-overlay-dark py-1',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((it, i) =>
            'divider' in it && it.divider ? (
              <div key={i} className="my-1 border-t border-border dark:border-d-border" />
            ) : (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  if (!('divider' in it && it.divider)) it.onClick?.();
                }}
                className={cx(
                  'w-full text-left px-2.5 py-1.5 text-sm flex items-center gap-2',
                  'danger' in it && it.danger
                    ? 'text-danger hover:bg-danger/10'
                    : 'text-text dark:text-d-text hover:bg-surface-2 dark:hover:bg-d-surface-2',
                )}
              >
                {'icon' in it && it.icon && (
                  <span className="text-text-muted dark:text-d-text-muted">{it.icon}</span>
                )}
                <span className="flex-1">{'label' in it ? it.label : ''}</span>
                {'kbd' in it && it.kbd && <Kbd>{it.kbd}</Kbd>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

// ── Sparkline ──────────────────────────────────────────────────────────────
export function Sparkline({
  data,
  color = '#2563EB',
  height = 28,
  fill = true,
  className = '',
}: {
  data: number[];
  color?: string;
  height?: number;
  fill?: boolean;
  className?: string;
}) {
  if (data.length === 0) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 120;
  const h = height;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return [x, y] as const;
  });
  const path = pts
    .map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`))
    .join(' ');
  const area = `${path} L${w},${h} L0,${h} Z`;
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={className}
    >
      {fill && (
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.18" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={area} fill={`url(#${gid})`} />}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Tooltip-on-hover helper ────────────────────────────────────────────────
export function Hint({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="absolute z-30 left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap bg-text text-surface text-xs px-1.5 py-0.5 rounded-sm dark:bg-d-text dark:text-d-bg font-mono">
          {label}
        </span>
      )}
    </span>
  );
}

// ── Lakebridge mark (custom SVG, per handoff README) ───────────────────────
export function LakebridgeMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-brand"
    >
      <path d="M3 17h18" />
      <path d="M5 17V9a3 3 0 0 1 3-3h0" />
      <path d="M19 17V9a3 3 0 0 0-3-3h0" />
      <path d="M9 17V13" />
      <path d="M15 17V13" />
      <circle cx="12" cy="9" r="1.5" fill="currentColor" />
    </svg>
  );
}
