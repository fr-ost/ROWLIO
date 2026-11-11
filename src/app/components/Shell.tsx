// Application shell: sidebar navigation, connection bar, toasts.
import { useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  Code2,
  ExternalLink,
  FolderOpen,
  Home,
  Info,
  Layers,
  LifeBuoy,
  ListChecks,
  MousePointerClick,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldCheck,
  Sheet,
  Table2,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { requestSiteAccess } from '@/messaging/tabClient';
import { hostOf } from '@/utils/url';
import { useData } from '@/app/stores/data';
import { focusTargetTab, useTarget } from '@/app/stores/target';
import { TOAST_TTL, useUi, type Route, type ToastKind } from '@/app/stores/ui';
import { Credits } from './fx';
import { Button, IconButton, cx } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cx('logo-rows', className)} aria-hidden>
      <defs>
        <linearGradient id="rowlio-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#10b981" />
          <stop offset="0.6" stopColor={brand.colors.brand} />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill="url(#rowlio-logo)" style={{ animation: 'none' }} />
      <rect x="7" y="8.5" width="18" height="3.4" rx="1.7" fill="#fff" />
      <rect x="7" y="14.3" width="18" height="3.4" rx="1.7" fill="#fff" opacity="0.82" />
      <rect x="7" y="20.1" width="11" height="3.4" rx="1.7" fill="#fff" opacity="0.64" />
    </svg>
  );
}

const NAV: { route: Route; label: string; icon: LucideIcon; group: 1 | 2 | 3 }[] = [
  { route: '/', label: 'Home', icon: Home, group: 1 },
  { route: '/tables', label: 'Tables', icon: Table2, group: 1 },
  { route: '/visual', label: 'Visual Selector', icon: MousePointerClick, group: 1 },
  { route: '/selectors', label: 'Advanced Selectors', icon: Code2, group: 1 },
  { route: '/pagination', label: 'Pagination', icon: Layers, group: 1 },
  { route: '/batch', label: 'Batch URLs', icon: ListChecks, group: 1 },
  { route: '/data', label: 'Data Preview', icon: Sheet, group: 2 },
  { route: '/projects', label: 'Projects', icon: FolderOpen, group: 2 },
  { route: '/recipes', label: 'Saved Recipes', icon: BookMarked, group: 2 },
  { route: '/settings', label: 'Settings', icon: SettingsIcon, group: 3 },
  { route: '/help', label: 'Help & About', icon: LifeBuoy, group: 3 },
];

export function Sidebar() {
  const route = useUi((state) => state.route);
  const rowCount = useData((state) => state.items.reduce((sum, item) => sum + item.dataset.rows.length, 0));
  const open = useData((state) => state.items.length);
  return (
    <aside className="glass relative z-20 flex w-14 shrink-0 flex-col border-r border-zinc-200/80 lg:w-60 dark:border-zinc-800">
      <a href="#/" className="group flex h-14 items-center gap-2.5 border-b border-zinc-200/80 px-3.5 dark:border-zinc-800" aria-label={brand.name}>
        <Logo className="size-8 shrink-0 drop-shadow-[0_4px_10px_rgb(16_169_116/0.45)] transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3" />
        <div className="min-w-0 max-lg:hidden">
          <div className="text-[15px] leading-tight font-semibold tracking-tight">{brand.name}</div>
          <div className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">{brand.attribution}</div>
        </div>
      </a>
      <nav aria-label={t('Main')} className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV.map((item, index) => {
          const Icon = item.icon;
          const active = route === item.route;
          const divider = index > 0 && NAV[index - 1].group !== item.group;
          return (
            <div key={item.route} className={cx(item.group === 3 && NAV[index - 1].group !== 3 && 'mt-auto')}>
              {divider ? <div className="mx-1 my-1.5 h-px bg-zinc-200 dark:bg-zinc-800" /> : null}
              <a
                href={`#${item.route}`}
                aria-current={active ? 'page' : undefined}
                title={t(item.label)}
                className={cx(
                  'group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors duration-200 max-lg:justify-center max-lg:px-0',
                  active
                    ? 'bg-brand-50 text-brand-800 shadow-[inset_0_0_0_1px_rgb(16_169_116/0.18)] dark:bg-brand-950/70 dark:text-brand-200'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
                )}
              >
                <span className={cx('brand-gradient nav-indicator absolute top-2 bottom-2 left-0 w-[3px] rounded-full', active ? 'scale-y-100 opacity-100' : 'scale-y-0 opacity-0')} aria-hidden />
                <Icon className={cx('size-4 shrink-0 transition-transform duration-300 group-hover:scale-110', active && 'text-brand-600 dark:text-brand-300')} aria-hidden />
                <span className="min-w-0 flex-1 truncate max-lg:sr-only">{t(item.label)}</span>
                {item.route === '/data' && open > 0 ? (
                  <span className="brand-gradient pop-in rounded-full px-1.5 text-[11px] font-semibold text-white max-lg:hidden" aria-label={t('{count} rows open', { count: rowCount })}>
                    {formatNumber(rowCount)}
                  </span>
                ) : null}
              </a>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-zinc-200/80 px-3.5 py-2.5 dark:border-zinc-800">
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 max-lg:justify-center dark:text-zinc-400" title={t('Everything stays in your browser. No account, no uploads, no tracking.')}>
          <ShieldCheck className="size-3.5 shrink-0 text-brand-600" aria-hidden />
          <span className="max-lg:sr-only">{t('100% local · free forever')}</span>
        </div>
        <div className="mt-1.5 text-[10.5px] leading-snug max-lg:hidden">
          <div className="text-zinc-400 dark:text-zinc-500">{brand.copyright}</div>
          <Credits stacked />
        </div>
      </div>
    </aside>
  );
}

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-brand-500 text-brand-500 status-ping',
  connecting: 'bg-amber-400 text-amber-400 status-ping',
  none: 'bg-zinc-300 dark:bg-zinc-600',
  restricted: 'bg-amber-500',
  'no-access': 'bg-amber-500',
  closed: 'bg-zinc-400',
  failed: 'bg-red-500',
};

export function TopBar() {
  const { tabId, url, title, status, error, scanning } = useTarget();
  const connect = useTarget((state) => state.connect);
  const [granting, setGranting] = useState(false);
  const host = hostOf(url);

  let primary: string;
  let secondary = '';
  switch (status) {
    case 'none':
      primary = t('No page connected');
      secondary = t('Open a webpage and click the {name} icon in the toolbar.', { name: brand.name });
      break;
    case 'connecting':
      primary = title || host || t('Connecting…');
      secondary = t('Reading the page…');
      break;
    case 'ready':
      primary = title || host;
      secondary = url;
      break;
    case 'restricted':
      primary = t('This page cannot be read');
      secondary = t('Chrome does not allow extensions on browser pages, the Chrome Web Store and similar pages.');
      break;
    case 'no-access':
      if (host) {
        primary = title || host;
        secondary = t('Access to this page expired. Click the {name} icon on that tab again, or grant access to the site.', { name: brand.name });
      } else {
        primary = t('The tab moved to another site');
        secondary = t('{name} only has access to the site you invoked it on. Click the {name} icon on that tab to continue there.', { name: brand.name });
      }
      break;
    case 'closed':
      primary = t('The connected page was closed');
      secondary = t('Your extracted data is still here. Open a page and click the {name} icon to connect again.', { name: brand.name });
      break;
    default:
      primary = title || host || t('Could not reach the page');
      secondary = error;
  }

  const grant = async () => {
    setGranting(true);
    try {
      if (await requestSiteAccess(url)) await connect();
    } finally {
      setGranting(false);
    }
  };

  return (
    <div className="glass relative z-10 flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200/80 px-4 dark:border-zinc-800" data-testid="topbar" data-status={status}>
      <span className={cx('size-2 shrink-0 rounded-full', STATUS_DOT[status] ?? STATUS_DOT.failed)} aria-hidden />
      <div className="min-w-0 flex-1" role="status" aria-live="polite">
        <div className="truncate text-[13px] font-medium text-zinc-900 dark:text-white" data-testid="target-title">
          {primary}
        </div>
        <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">{secondary}</div>
      </div>
      {status === 'no-access' && host ? (
        <Button variant="primary" size="sm" loading={granting} onClick={grant}>
          {t('Grant access to {host}', { host })}
        </Button>
      ) : null}
      {tabId !== null && status !== 'closed' && status !== 'none' ? (
        <>
          <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void focusTargetTab()}>
            <span className="max-md:sr-only">{t('Go to page')}</span>
          </Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} loading={scanning} onClick={() => void connect()} data-testid="rescan">
            <span className="max-md:sr-only">{t('Rescan')}</span>
          </Button>
        </>
      ) : null}
    </div>
  );
}

const TOAST_ICON: Record<ToastKind, LucideIcon> = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle };
const TOAST_TONE: Record<ToastKind, string> = {
  success: 'text-brand-600',
  error: 'text-red-600',
  info: 'text-sky-600',
  warning: 'text-amber-600',
};
const TOAST_BAR: Record<ToastKind, string> = {
  success: 'brand-gradient',
  error: 'bg-red-500',
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
};

export function Toasts() {
  const toasts = useUi((state) => state.toasts);
  const dismiss = useUi((state) => state.dismissToast);
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite" aria-relevant="additions" data-testid="toasts">
      {toasts.map((item) => {
        const Icon = TOAST_ICON[item.kind];
        return (
          <div
            key={item.id}
            role={item.kind === 'error' ? 'alert' : 'status'}
            data-kind={item.kind}
            className="toast-in glass pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl border border-zinc-200/80 p-3 pl-3.5 shadow-[0_16px_40px_-12px_rgb(0_0_0/0.28)] dark:border-zinc-700"
          >
            <span className={cx('absolute inset-y-0 left-0 w-1', TOAST_BAR[item.kind])} aria-hidden />
            {item.kind === 'success' ? (
              <svg viewBox="0 0 20 20" className="check-draw mt-0.5 size-4 shrink-0 text-brand-600" aria-hidden>
                <circle cx="10" cy="10" r="9" fill="currentColor" opacity="0.14" />
                <path d="M5.5 10.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <Icon className={cx('mt-0.5 size-4 shrink-0', TOAST_TONE[item.kind])} aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-zinc-900 dark:text-white">{item.message}</div>
              {item.detail ? <div className="mt-0.5 text-xs break-words text-zinc-600 dark:text-zinc-400">{item.detail}</div> : null}
              {item.action ? (
                <button
                  type="button"
                  className="mt-1.5 text-xs font-medium text-brand-700 hover:underline dark:text-brand-300"
                  onClick={() => {
                    item.action!.run();
                    dismiss(item.id);
                  }}
                >
                  {item.action.label}
                </button>
              ) : null}
            </div>
            <IconButton icon={X} label={t('Dismiss')} size="sm" onClick={() => dismiss(item.id)} />
            <span className={cx('toast-life absolute inset-x-0 bottom-0 h-0.5 opacity-60', TOAST_BAR[item.kind])} style={{ animationDuration: `${TOAST_TTL[item.kind]}ms` }} aria-hidden />
          </div>
        );
      })}
    </div>
  );
}

/** Shown on extraction pages when there is no usable page. */
export function ConnectionGate({ children }: { children: React.ReactNode }) {
  const status = useTarget((state) => state.status);
  const error = useTarget((state) => state.error);
  if (status === 'ready' || status === 'connecting') return <>{children}</>;
  const messages: Record<string, [string, string]> = {
    none: [t('Connect a page first'), t('Open the webpage you want to extract from, then click the {name} icon in Chrome’s toolbar and choose an action. {name} only reads a page after you ask it to.', { name: brand.name })],
    restricted: [t('This page cannot be read'), t('Chrome blocks every extension on its own pages (chrome://…), the Chrome Web Store, and a few other protected pages. Open a regular webpage instead.')],
    'no-access': [t('No access to this page'), t('Chrome grants {name} temporary access to one site each time you click its icon, and withdraws it when the tab moves to another site. Click the {name} icon on that tab to continue. Your extracted data is still in the Data Preview.', { name: brand.name })],
    closed: [t('The connected page was closed'), t('Open a page and click the {name} icon there to connect again. Your extracted data is still in the Data Preview.', { name: brand.name })],
    failed: [t('Could not reach the page'), error || t('Reload the page and try again.')],
  };
  const [title, description] = messages[status] ?? messages.failed;
  return (
    <div className="flex h-full items-center justify-center p-8" data-testid="connection-gate">
      <div className="pop-in max-w-md text-center">
        <div className="float mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-50 to-sky-50 text-brand-600 ring-1 ring-brand-200/60 dark:from-brand-950 dark:to-sky-950 dark:text-brand-300 dark:ring-brand-800/60">
          <ExternalLink className="size-5" aria-hidden />
        </div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p>
      </div>
    </div>
  );
}
