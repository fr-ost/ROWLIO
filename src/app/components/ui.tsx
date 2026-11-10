// Rowlio design system: small, dependency-free building blocks shared by the workspace
// and the popup. Accessible by default (labels, focus rings, keyboard support).
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Loader2, X, type LucideIcon } from 'lucide-react';
import { t } from '@/i18n';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---- Button ----------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:hover:bg-brand-600 border border-transparent',
  secondary:
    'border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800',
  ghost: 'border border-transparent text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800',
  danger: 'bg-red-600 text-white hover:bg-red-700 border border-transparent',
};
const SIZES: Record<Size, string> = { sm: 'h-7 px-2 text-xs gap-1', md: 'h-8 px-3 text-[13px] gap-1.5' };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: LucideIcon;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, loading, className, children, disabled, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors select-none disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : Icon ? <Icon className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  size?: Size;
  active?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, size = 'md', active, className, type, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white',
        size === 'sm' ? 'size-6' : 'size-8',
        active && 'bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white',
        className,
      )}
      {...rest}
    >
      <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} aria-hidden />
    </button>
  );
});

// ---- Form controls -----------------------------------------------------------------------

const CONTROL =
  'h-8 w-full min-w-0 rounded-md border border-zinc-300 bg-white px-2.5 text-[13px] text-zinc-900 placeholder:text-zinc-400 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean }>(
  function Input({ className, invalid, mono, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(CONTROL, mono && 'font-mono text-xs', invalid && 'border-red-500 dark:border-red-500', className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx(CONTROL, 'h-auto py-1.5 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cx(CONTROL, 'pr-7', className)} {...rest}>
      {children}
    </select>
  );
});

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', className)}>
      <label htmlFor={id} className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {label}
      </label>
      {children(id, hint || error ? hintId : undefined)}
      {error ? (
        <p id={hintId} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  indeterminate,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate && !checked;
  }, [indeterminate, checked]);
  const box = (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.checked)}
      className="size-3.5 shrink-0 rounded border-zinc-400 accent-brand-600"
    />
  );
  if (!label) return box;
  return (
    <label className={cx('flex items-start gap-2 text-[13px]', disabled && 'opacity-60', className)}>
      <span className="flex h-5 items-center">{box}</span>
      <span className="min-w-0">
        <span className="text-zinc-800 dark:text-zinc-200">{label}</span>
        {description ? <span className="block text-xs text-zinc-500 dark:text-zinc-400">{description}</span> : null}
      </span>
    </label>
  );
}

// ---- Surfaces ------------------------------------------------------------------------------

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900', className)} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">{title}</h1>
        {description ? <p className="mt-0.5 max-w-3xl text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

type Tone = 'neutral' | 'brand' | 'amber' | 'red' | 'blue' | 'violet';
const TONES: Record<Tone, string> = {
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  brand: 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300',
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex h-5 items-center rounded px-1.5 text-[11px] font-medium whitespace-nowrap', TONES[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-10 text-center', className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        <Icon className="size-5" aria-hidden />
      </div>
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">{title}</h2>
      {description ? <p className="mt-1 max-w-md text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = 'neutral', icon: Icon, children, className, role }: { tone?: Tone; icon?: LucideIcon; children: ReactNode; className?: string; role?: string }) {
  return (
    <div role={role} className={cx('flex items-start gap-2 rounded-md px-3 py-2 text-[13px]', TONES[tone], className)}>
      {Icon ? <Icon className="mt-0.5 size-4 shrink-0" aria-hidden /> : null}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[13px] text-zinc-600 dark:text-zinc-400" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label ?? t('Working…')}
    </span>
  );
}

/** Determinate when `value` is given (0–1); otherwise indeterminate. Never fakes progress. */
export function ProgressBar({ value, label }: { value?: number; label: string }) {
  const pct = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
    >
      {pct === undefined ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-brand-500" />
      ) : (
        <div className="h-full rounded-full bg-brand-600 transition-[width]" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}

// ---- Dialog ----------------------------------------------------------------------------------

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) onClose(); // click on the backdrop
      }}
      className={cx('w-[calc(100vw-2rem)] rounded-xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100', width)}
    >
      <div className="flex max-h-[85vh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">{description}</p> : null}
          </div>
          <IconButton icon={X} label={t('Close')} size="sm" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{footer}</div> : null}
      </div>
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="max-w-md"
      footer={
        <>
          <Button onClick={onClose}>{t('Cancel')}</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-[13px] text-zinc-700 dark:text-zinc-300">{message}</div>
    </Dialog>
  );
}

// ---- Menu --------------------------------------------------------------------------------------

export type MenuItem =
  | { type?: 'item'; label: string; icon?: LucideIcon; onSelect: () => void; disabled?: boolean; danger?: boolean; checked?: boolean; hint?: string }
  | { type: 'separator' }
  | { type: 'label'; label: string };

/**
 * Dropdown menu rendered in a portal (so it is never clipped by scrolling containers)
 * with full keyboard support: arrows, Home/End, Enter, Escape, Tab closes.
 */
export function Menu({
  trigger,
  items,
  align = 'start',
  label,
}: {
  trigger: (props: { onClick: () => void; 'aria-haspopup': 'menu'; 'aria-expanded': boolean; ref: (el: HTMLElement | null) => void }) => ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  /** Position the menu next to its trigger. Returns false when the trigger left the viewport. */
  const place = useCallback((): boolean => {
    if (!triggerRef.current || !menuRef.current) return false;
    const rect = triggerRef.current.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return false;
    const menu = menuRef.current.getBoundingClientRect();
    let left = align === 'end' ? rect.right - menu.width : rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - menu.width - 8));
    let top = rect.bottom + 4;
    if (top + menu.height > window.innerHeight - 8) top = Math.max(8, rect.top - menu.height - 4);
    setPosition((current) => (current && current.top === top && current.left === left ? current : { top, left }));
    return true;
  }, [align]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    place();
    const first = menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus({ preventScroll: true });
  }, [open, place, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    // Follow the trigger while the page scrolls; close only once it is out of view.
    const onMove = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      if (!place()) close(false);
    };
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? []);
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1) % options.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options[options.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  // Menus inside a modal <dialog> must be portalled into it, or they render underneath.
  const host = triggerRef.current?.closest('dialog') ?? document.body;

  return (
    <>
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        ref: (el) => {
          triggerRef.current = el;
        },
      })}
      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              onKeyDown={onKeyDown}
              style={{ position: 'fixed', top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
              className="z-50 max-h-[70vh] min-w-44 overflow-auto rounded-lg border border-zinc-200 bg-white p-1 text-[13px] shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
            >
              {items.map((item, index) => {
                if (item.type === 'separator') return <div key={index} role="separator" className="my-1 h-px bg-zinc-200 dark:bg-zinc-800" />;
                if (item.type === 'label') {
                  return (
                    <div key={index} className="px-2 pt-1.5 pb-1 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">
                      {item.label}
                    </div>
                  );
                }
                const Icon = item.icon;
                return (
                  <button
                    key={index}
                    type="button"
                    role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                    aria-checked={item.checked}
                    aria-disabled={item.disabled || undefined}
                    tabIndex={-1}
                    onClick={() => {
                      if (item.disabled) return;
                      close(true);
                      item.onSelect();
                    }}
                    className={cx(
                      'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus:bg-zinc-100 dark:focus:bg-zinc-800',
                      item.disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-zinc-100 dark:hover:bg-zinc-800',
                      item.danger && 'text-red-600 dark:text-red-400',
                    )}
                  >
                    {Icon ? <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden /> : item.checked !== undefined ? <span className="size-3.5 shrink-0">{item.checked ? <Check className="size-3.5" aria-hidden /> : null}</span> : null}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.hint ? <span className="text-[11px] text-zinc-400">{item.hint}</span> : null}
                  </button>
                );
              })}
            </div>,
            host,
          )
        : null}
    </>
  );
}

export function MenuButton({
  label,
  icon,
  items,
  variant = 'secondary',
  size = 'md',
  align,
  disabled,
  testId,
}: {
  label: string;
  icon?: LucideIcon;
  items: MenuItem[];
  variant?: Variant;
  size?: Size;
  align?: 'start' | 'end';
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <Menu
      label={label}
      items={items}
      align={align}
      trigger={({ ref, ...props }) => (
        <Button ref={ref as (el: HTMLButtonElement | null) => void} variant={variant} size={size} icon={icon} disabled={disabled} data-testid={testId} {...props}>
          {label}
          <ChevronDown className="size-3 opacity-70" aria-hidden />
        </Button>
      )}
    />
  );
}

// ---- Segmented control / tabs --------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 p-0.5 dark:border-zinc-700 dark:bg-zinc-800">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            'h-6.5 rounded px-2.5 text-xs font-medium transition-colors',
            option.value === value ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-white' : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      {children}
    </kbd>
  );
}
