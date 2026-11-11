// Toolbar popup: a quick entry point. It shows what the current page offers and hands
// the work over to the workspace – the full application does not live in here.
import { useEffect, useState } from 'react';
import { ArrowRight, Image as ImageIcon, Link2, MousePointerClick, ShieldCheck, Table2, type LucideIcon } from 'lucide-react';
import type { PageScan } from '@/types';
import { brand, IS_E2E } from '@/config/brand';
import { t } from '@/i18n';
import { ensureInjected, request, TabAccessError } from '@/messaging/tabClient';
import { PROTOCOL, type OpenWorkspaceMessage, type WorkspaceIntent } from '@/messaging/protocol';
import { hostOf, isRestrictedUrl } from '@/utils/url';
import { Logo } from '@/app/components/Shell';
import { Aurora, CountUp, Credits } from '@/app/components/fx';
import { Button, Spinner, cx } from '@/app/components/ui';

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; scan: PageScan }
  | { phase: 'restricted' }
  | { phase: 'error'; message: string };

interface TabInfo {
  id: number;
  url: string;
  title: string;
}

async function currentTab(): Promise<TabInfo | null> {
  // Test hook (E2E build only): the popup is opened as a normal page with ?tab=<id>.
  if (IS_E2E) {
    const forced = Number(new URLSearchParams(window.location.search).get('tab'));
    if (forced) {
      const tab = await chrome.tabs.get(forced);
      return { id: forced, url: tab.url ?? '', title: tab.title ?? '' };
    }
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) return null;
  return { id: tab.id, url: tab.url ?? '', title: tab.title ?? '' };
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className={cx('rounded-xl border px-1 py-2 text-center transition-transform duration-300 hover:-translate-y-0.5', value > 0 ? 'border-brand-200/70 bg-brand-50/70 dark:border-brand-900 dark:bg-brand-950/50' : 'border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-800/50')}>
      <Icon className={cx('mx-auto mb-0.5 size-3.5', value > 0 ? 'text-brand-600 dark:text-brand-300' : 'text-zinc-400')} aria-hidden />
      <div className="text-[15px] leading-tight font-semibold">
        <CountUp value={value} duration={700} />
      </div>
      <div className="text-[10.5px] text-zinc-600 dark:text-zinc-400">{label}</div>
    </div>
  );
}

export function Popup() {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await currentTab();
      if (cancelled) return;
      setTab(info);
      if (!info || isRestrictedUrl(info.url)) {
        setState({ phase: 'restricted' });
        return;
      }
      try {
        await ensureInjected(info.id, info.url);
        const scan = await request(info.id, 'scan', undefined, { timeoutMs: 15_000 });
        if (!cancelled) setState({ phase: 'ready', scan });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof TabAccessError && error.code === 'restricted') setState({ phase: 'restricted' });
        else setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
      }
    })().catch((error: unknown) => {
      if (!cancelled) setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const open = async (intent: WorkspaceIntent) => {
    if (!tab) return;
    setOpening(true);
    const message: OpenWorkspaceMessage = { rowlio: PROTOCOL, internal: 'open-workspace', tabId: tab.id, url: tab.url, title: tab.title, intent };
    try {
      const reply = (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string } | undefined;
      if (reply && !reply.ok) throw new Error(reply.error || 'Could not open the workspace.');
      window.close();
    } catch (error) {
      setOpening(false);
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const scan = state.phase === 'ready' ? state.scan : null;
  const host = tab ? hostOf(tab.url) : '';

  return (
    <div className="flex w-[352px] flex-col bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" data-testid="popup" data-phase={state.phase}>
      <header className="relative overflow-hidden px-4 pt-4 pb-3.5">
        <Aurora />
        <div className="relative flex items-center gap-2.5">
          <Logo className="size-9 shrink-0 drop-shadow-[0_6px_12px_rgb(16_169_116/0.5)]" />
          <div className="min-w-0">
            <div className="text-[15px] leading-tight font-semibold tracking-tight">{brand.name}</div>
            <div className="truncate text-[11px] leading-tight text-zinc-600 dark:text-zinc-300">{brand.tagline}</div>
          </div>
        </div>
        <section className="glass relative mt-3 rounded-xl border border-white/60 px-3 py-2 dark:border-white/10" aria-label={t('Current website')}>
          <div className="text-[10.5px] font-semibold tracking-[0.12em] text-brand-700 uppercase dark:text-brand-300">{t('Current website')}</div>
          <div className="truncate text-[13px] font-semibold" data-testid="popup-host">
            {host || t('No webpage')}
          </div>
          {tab?.title ? <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">{tab.title}</div> : null}
        </section>
      </header>

      <div className="flex flex-col gap-3 px-4 pb-3">
        {state.phase === 'loading' ? (
          <div className="flex flex-col gap-2 py-1" role="status" aria-label={t('Reading the page…')}>
            <div className="grid grid-cols-4 gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="shimmer h-[58px] rounded-xl bg-zinc-100 dark:bg-zinc-800" />
              ))}
            </div>
            <div className="text-center">
              <Spinner label={t('Reading the page…')} />
            </div>
          </div>
        ) : null}

        {state.phase === 'restricted' ? (
          <p className="pop-in rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
            {t('Chrome does not let extensions read this page (browser pages, the Chrome Web Store and similar). Open a regular webpage and try again.')}
          </p>
        ) : null}

        {state.phase === 'error' ? (
          <p className="pop-in rounded-xl bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
            {state.message} {t('Reloading the page usually helps.')}
          </p>
        ) : null}

        {scan ? (
          <>
            <div className="stagger grid grid-cols-4 gap-1.5" data-testid="popup-stats">
              <Stat icon={Table2} label={t('Tables')} value={scan.dataTables} />
              <Stat icon={MousePointerClick} label={t('Lists')} value={scan.patterns} />
              <Stat icon={Link2} label={t('Links')} value={scan.links} />
              <Stat icon={ImageIcon} label={t('Images')} value={scan.images} />
            </div>
            <div className="stagger flex flex-col gap-1.5">
              <Button variant={scan.dataTables === 0 ? 'secondary' : 'primary'} icon={Table2} className="h-9" disabled={scan.dataTables === 0 || opening} onClick={() => void open({ kind: 'tables', extractAll: true })} data-testid="popup-extract-tables">
                {scan.dataTables === 0 ? t('No tables detected on this page') : scan.dataTables === 1 ? t('Extract the table') : t('Extract {count} tables', { count: scan.dataTables })}
              </Button>
              <Button variant={scan.dataTables === 0 ? 'primary' : 'secondary'} icon={MousePointerClick} className="h-9" disabled={opening} onClick={() => void open({ kind: 'picker' })} data-testid="popup-picker">
                {t('Select items on the page')}
              </Button>
              <div className="grid grid-cols-2 gap-1.5">
                <Button icon={Link2} disabled={scan.links === 0 || opening} onClick={() => void open({ kind: 'links' })} data-testid="popup-links">
                  {t('Links')}
                </Button>
                <Button icon={ImageIcon} disabled={scan.images === 0 || opening} onClick={() => void open({ kind: 'images' })} data-testid="popup-images">
                  {t('Images')}
                </Button>
              </div>
            </div>
          </>
        ) : null}

        <button
          type="button"
          disabled={opening || !tab}
          onClick={() => void open({ kind: 'none' })}
          data-testid="popup-open-workspace"
          className="btn-press group flex h-9 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium text-brand-700 hover:bg-brand-50 disabled:opacity-50 dark:text-brand-300 dark:hover:bg-brand-950"
        >
          {t('Open {name} workspace', { name: brand.name })}
          <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" aria-hidden />
        </button>
      </div>

      <footer className="border-t border-zinc-200 px-4 py-2 text-center dark:border-zinc-800">
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
          <ShieldCheck className="size-3.5 text-brand-600" aria-hidden />
          {t('Free forever · no account · data stays in your browser')}
        </div>
        <Credits className="mt-0.5 block text-[10.5px]" />
      </footer>
    </div>
  );
}
