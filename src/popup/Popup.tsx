// Toolbar popup: a quick entry point. It shows what the current page offers and hands
// the work over to the workspace – the full application does not live in here.
import { useEffect, useState } from 'react';
import { ExternalLink, Image as ImageIcon, Link2, MousePointerClick, ShieldCheck, Table2 } from 'lucide-react';
import type { PageScan } from '@/types';
import { brand, IS_E2E } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { ensureInjected, request, TabAccessError } from '@/messaging/tabClient';
import { PROTOCOL, type OpenWorkspaceMessage, type WorkspaceIntent } from '@/messaging/protocol';
import { hostOf, isRestrictedUrl } from '@/utils/url';
import { Logo } from '@/app/components/Shell';
import { Button, Spinner } from '@/app/components/ui';

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-zinc-100 px-2 py-1.5 text-center dark:bg-zinc-800">
      <div className="text-sm font-semibold tabular-nums">{formatNumber(value)}</div>
      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">{label}</div>
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
    <div className="flex w-[340px] flex-col gap-3 bg-white p-3.5 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100" data-testid="popup" data-phase={state.phase}>
      <header className="flex items-center gap-2.5">
        <Logo className="size-8 shrink-0" />
        <div className="min-w-0">
          <div className="text-sm leading-tight font-semibold">{brand.name}</div>
          <div className="truncate text-[11px] leading-tight text-zinc-500 dark:text-zinc-400">{brand.tagline}</div>
        </div>
      </header>

      <section className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800" aria-label={t('Current website')}>
        <div className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">{t('Current website')}</div>
        <div className="truncate text-[13px] font-medium" data-testid="popup-host">
          {host || t('No webpage')}
        </div>
        {tab?.title ? <div className="truncate text-xs text-zinc-500">{tab.title}</div> : null}
      </section>

      {state.phase === 'loading' ? (
        <div className="py-4 text-center">
          <Spinner label={t('Reading the page…')} />
        </div>
      ) : null}

      {state.phase === 'restricted' ? (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200" role="status">
          {t('Chrome does not let extensions read this page (browser pages, the Chrome Web Store and similar). Open a regular webpage and try again.')}
        </p>
      ) : null}

      {state.phase === 'error' ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">
          {state.message} {t('Reloading the page usually helps.')}
        </p>
      ) : null}

      {scan ? (
        <>
          <div className="grid grid-cols-4 gap-1.5" data-testid="popup-stats">
            <Stat label={t('Tables')} value={scan.dataTables} />
            <Stat label={t('Lists')} value={scan.patterns} />
            <Stat label={t('Links')} value={scan.links} />
            <Stat label={t('Images')} value={scan.images} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Button variant="primary" icon={Table2} disabled={scan.dataTables === 0 || opening} onClick={() => void open({ kind: 'tables', extractAll: true })} data-testid="popup-extract-tables">
              {scan.dataTables === 0 ? t('No tables detected on this page') : scan.dataTables === 1 ? t('Extract the table') : t('Extract {count} tables', { count: scan.dataTables })}
            </Button>
            <Button icon={MousePointerClick} disabled={opening} onClick={() => void open({ kind: 'picker' })} data-testid="popup-picker">
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

      <Button variant={scan ? 'ghost' : 'secondary'} icon={ExternalLink} disabled={opening || !tab} onClick={() => void open({ kind: 'none' })} data-testid="popup-open-workspace">
        {t('Open {name} workspace', { name: brand.name })}
      </Button>

      <footer className="flex items-center justify-center gap-1.5 border-t border-zinc-200 pt-2 text-[11px] text-zinc-500 dark:border-zinc-800">
        <ShieldCheck className="size-3.5 text-brand-600" aria-hidden />
        {t('Free forever · no account · data stays in your browser')}
      </footer>
    </div>
  );
}
