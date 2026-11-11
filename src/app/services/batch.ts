// Running a batch of URLs in the connected tab.
import { create } from 'zustand';
import type { ExtractSpec, StopReason } from '@/types';
import { t } from '@/i18n';
import { ensureInjected, hasSiteAccess, request, runJob } from '@/messaging/tabClient';
import { brand } from '@/config/brand';
import { hostOf, isHttpUrl, originOf } from '@/utils/url';
import { runBatch, type BatchLogEntry, type BatchProgress, type BatchSettings, type BatchTransport } from '@/pagination/batch';
import { CancelledError, isCancelled, sleep } from '@/utils/async';
import { focusTargetTab, focusWorkspace, requireTarget, useTarget } from '@/app/stores/target';
import { toast } from '@/app/stores/ui';
import { describeError, openDatasets, toDatasets } from './extract';
import { onContentEvent } from './events';
import { playSfx } from './sfx';

const LOAD_TIMEOUT_MS = 45_000;

/** Navigate the tab and resolve when the new page has finished loading. */
function navigate(tabId: number, url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new CancelledError());
    let sawLoading = false;
    const finish = (error?: Error) => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      clearTimeout(deadline);
      clearTimeout(grace);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onUpdated = (id: number, change: { status?: string }) => {
      if (id !== tabId) return;
      if (change.status === 'loading') sawLoading = true;
      if (change.status === 'complete' && sawLoading) finish();
    };
    const onAbort = () => finish(new CancelledError());
    const deadline = setTimeout(() => finish(new Error(t('The page took too long to load.'))), LOAD_TIMEOUT_MS);
    // A URL that only differs by #fragment does not reload the page: carry on after a moment.
    const grace = setTimeout(() => {
      if (!sawLoading) finish();
    }, 2500);
    chrome.tabs.onUpdated.addListener(onUpdated);
    signal.addEventListener('abort', onAbort, { once: true });
    chrome.tabs.update(tabId, { url }).catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

function createTransport(tabId: number, homeOrigin: string, hud: () => { text: string; detail: string }): BatchTransport {
  const allowed = new Map<string, boolean>();
  return {
    async open(url, signal) {
      // The list comes from the user or from extracted data: only ever navigate to web pages.
      if (!isHttpUrl(url)) throw new Error(t('Skipped: not a web address.'));
      // Leaving the site Rowlio was invoked on would make Chrome withdraw its access, and
      // the rest of the list would fail too. So pages on other sites are only opened when
      // the user has granted access to that site; otherwise they are skipped in place.
      const origin = originOf(url);
      if (origin !== homeOrigin) {
        if (!allowed.has(origin)) allowed.set(origin, await hasSiteAccess(url));
        if (!allowed.get(origin)) throw new Error(t('Skipped: {name} has no access to {host}. Grant access to that site first.', { name: brand.name, host: hostOf(url) }));
      }
      await navigate(tabId, url, signal);
      // Throws a clear "no access" error for sites Rowlio was not invoked on.
      await ensureInjected(tabId);
      await request(tabId, 'page:settle', { quietMs: 400, timeoutMs: 6000 }, { timeoutMs: 15_000 });
      if (signal.aborted) throw new CancelledError();
      const { text, detail } = hud();
      await request(tabId, 'hud:show', { text, detail, canStop: true }).catch(() => undefined);
    },
    async extract(spec, signal) {
      const { datasets } = await runJob(tabId, { job: 'extract', spec }, {}, signal);
      return datasets;
    },
    sleep,
  };
}

export interface BatchSummary {
  reason: StopReason;
  visited: number;
  failed: number;
  records: number;
  total: number;
  elapsedMs: number;
}

interface BatchState {
  running: boolean;
  progress: BatchProgress | null;
  log: BatchLogEntry[];
  summary: BatchSummary | null;
  start(urls: string[], spec: ExtractSpec, settings: BatchSettings): Promise<void>;
  stop(): void;
}

let controller: AbortController | null = null;

export const useBatch = create<BatchState>((set, get) => ({
  running: false,
  progress: null,
  log: [],
  summary: null,

  stop: () => controller?.abort(),

  start: async (urls, spec, settings) => {
    if (get().running || urls.length === 0) return;
    let tabId: number;
    try {
      tabId = requireTarget();
    } catch (error) {
      toast.error(t('No page connected'), describeError(error));
      return;
    }
    controller = new AbortController();
    const signal = controller.signal;
    const started = Date.now();
    set({ running: true, progress: null, log: [], summary: null });
    useTarget.getState().setBusy(true);
    playSfx('start');
    const offStop = onContentEvent('hud:stop', () => controller?.abort());
    let latest: BatchProgress | null = null;
    let summary: BatchSummary;
    try {
      await focusTargetTab();
      const transport = createTransport(tabId, originOf(useTarget.getState().url), () => ({
        text: t('Collecting page {n} of {total}…', { n: latest?.index ?? 1, total: latest?.total ?? urls.length }),
        detail: t('{records} records', { records: latest?.records ?? 0 }),
      }));
      const outcome = await runBatch(
        transport,
        urls,
        spec,
        settings,
        (progress) => {
          latest = progress;
          set({ progress, log: progress.log });
        },
        signal,
      );
      if (outcome.records > 0) openDatasets(toDatasets(outcome.datasets, outcome.visited), { dropEmpty: true, stay: true });
      summary = { reason: outcome.reason, visited: outcome.visited, failed: outcome.failed, records: outcome.records, total: Math.min(urls.length, settings.maxUrls), elapsedMs: Date.now() - started };
      set({ log: outcome.log });
    } catch (error) {
      useTarget.getState().markError(error);
      summary = { reason: isCancelled(error) ? 'cancelled' : 'error', visited: 0, failed: 0, records: 0, total: urls.length, elapsedMs: Date.now() - started };
      if (!isCancelled(error)) toast.error(t('The batch could not run'), describeError(error));
    } finally {
      offStop();
      controller = null;
      useTarget.getState().setBusy(false);
      await request(tabId, 'hud:hide', undefined, { noRetry: true }).catch(() => undefined);
    }
    set({ running: false, summary });
    playSfx(summary.reason === 'error' ? 'error' : summary.records > 0 ? 'complete' : 'warning');
    await focusWorkspace();
    void useTarget.getState().connect();
  },
}));
