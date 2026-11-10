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
import { useUi, type Route, type ToastKind } from '@/app/stores/ui';
import { Button, IconButton, cx } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill={brand.colors.brand} />
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
    <aside className="flex w-14 shrink-0 flex-col border-r border-zinc-200 bg-white lg:w-56 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex h-14 items-center gap-2.5 border-b border-zinc-200 px-3.5 dark:border-zinc-800">
        <Logo className="size-7 shrink-0" />
        <div className="min-w-0 max-lg:hidden">
          <div className="text-[15px] leading-tight font-semibold tracking-tight">{brand.name}</div>
          <div className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">{brand.attribution}</div>
        </div>
      </div>
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
                  'flex h-8.5 items-center gap-2.5 rounded-md px-2.5 text-[13px] font-medium transition-colors max-lg:justify-center max-lg:px-0',
                  active
                    ? 'bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-200'
                    : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800',
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span className="min-w-0 flex-1 truncate max-lg:sr-only">{t(item.label)}</span>
                {item.route === '/data' && open > 0 ? (
                  <span className="rounded-full bg-zinc-200 px-1.5 text-[11px] font-semibold text-zinc-700 max-lg:hidden dark:bg-zinc-700 dark:text-zinc-200" aria-label={t('{count} rows open', { count: rowCount })}>
                    {formatNumber(rowCount)}
                  </span>
                ) : null}
              </a>
            </div>
          );
        })}
      </nav>
      <div className="flex items-center gap-1.5 border-t border-zinc-200 px-3.5 py-2.5 text-[11px] text-zinc-500 max-lg:justify-center dark:border-zinc-800 dark:text-zinc-400" title={t('Everything stays in your browser. No account, no uploads, no tracking.')}>
        <ShieldCheck className="size-3.5 shrink-0 text-brand-600" aria-hidden />
        <span className="max-lg:sr-only">{t('100% local · free forever')}</span>
      </div>
    </aside>
  );
}

const STATUS_DOT: Record<string, string> = {
  ready: 'bg-brand-500',
  connecting: 'bg-amber-400 animate-pulse',
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
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="topbar" data-status={status}>
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
  info: 'text-blue-600',
  warning: 'text-amber-600',
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
            className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
          >
            <Icon className={cx('mt-0.5 size-4 shrink-0', TOAST_TONE[item.kind])} aria-hidden />
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
      <div className="max-w-md text-center">
        <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
          <ExternalLink className="size-5" aria-hidden />
        </div>
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mt-1 text-[13px] text-zinc-600 dark:text-zinc-400">{description}</p>
      </div>
    </div>
  );
}
