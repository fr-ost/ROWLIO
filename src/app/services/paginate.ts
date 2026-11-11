// Running pagination and infinite-scroll jobs against the connected tab.
// The run state lives in a store so it survives moving between workspace pages.
import { create } from 'zustand';
import type { ExtractSpec, PaginationSettings, ScrollProgress, StopReason } from '@/types';
import { t } from '@/i18n';
import { ensureInjected, request, runJob } from '@/messaging/tabClient';
import { runPagination, type PageTransport, type PaginationLogEntry, type PaginationProgress } from '@/pagination/runner';
import { CancelledError, isCancelled, sleep } from '@/utils/async';
import { focusTargetTab, focusWorkspace, requireTarget, useTarget } from '@/app/stores/target';
import { toast } from '@/app/stores/ui';
import { describeError, openDatasets, toDatasets } from './extract';
import { onContentEvent } from './events';
import { playSfx } from './sfx';

async function waitForTabComplete(tabId: number, timeoutMs: number, signal: AbortSignal): Promise<void> {
  const started = Date.now();
  for (;;) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) throw new Error(t('The page was closed.'));
    if (tab.status === 'complete') return;
    if (Date.now() - started > timeoutMs) throw new Error(t('The next page took too long to load.'));
    await sleep(120, signal);
  }
}

/** PageTransport backed by the real tab. */
export function createTabTransport(tabId: number, hudText: () => { text: string; detail: string }): PageTransport {
  return {
    async ensureReady(signal) {
      await waitForTabComplete(tabId, 45_000, signal);
      await ensureInjected(tabId);
      // Let late-rendering pages (client-side frameworks) finish before reading them.
      await request(tabId, 'page:settle', { quietMs: 400, timeoutMs: 6000 }, { timeoutMs: 15_000 });
      if (signal.aborted) throw new CancelledError();
      const { text, detail } = hudText();
      await request(tabId, 'hud:show', { text, detail, canStop: true }).catch(() => undefined);
    },
    async extract(spec, signal) {
      const { datasets } = await runJob(tabId, { job: 'extract', spec }, {}, signal);
      return datasets;
    },
    advance(nextSelector, spec) {
      return request(tabId, 'pagination:advance', { nextSelector, spec }, { noRetry: true, timeoutMs: 10_000 });
    },
    async awaitChange(timeoutMs) {
      try {
        const { changed } = await request(tabId, 'pagination:await-change', { timeoutMs }, { noRetry: true, timeoutMs: timeoutMs + 10_000 });
        return changed ? 'changed' : 'unchanged';
      } catch {
        // The content script went away mid-wait: the page is navigating.
        return 'navigated';
      }
    },
    waitForNavigation: (timeoutMs, signal) => waitForTabComplete(tabId, timeoutMs, signal),
    sleep,
  };
}

export interface RunSummary {
  mode: 'next' | 'scroll';
  reason: StopReason;
  records: number;
  duplicates: number;
  /** Pages visited, or scroll steps performed. */
  steps: number;
  elapsedMs: number;
  datasetCount: number;
  error?: string;
}

interface RunState {
  running: boolean;
  mode: 'next' | 'scroll';
  progress: PaginationProgress | null;
  scroll: ScrollProgress | null;
  maxScrolls: number;
  log: PaginationLogEntry[];
  summary: RunSummary | null;
  /** Spec + settings of the last run, for "save as recipe". */
  last: { spec: ExtractSpec; settings: PaginationSettings } | null;
  start(spec: ExtractSpec, settings: PaginationSettings): Promise<void>;
  stop(): void;
  reset(): void;
}

let controller: AbortController | null = null;

export const useRun = create<RunState>((set, get) => ({
  running: false,
  mode: 'next',
  progress: null,
  scroll: null,
  maxScrolls: 0,
  log: [],
  summary: null,
  last: null,

  stop: () => controller?.abort(),

  reset: () => {
    if (!get().running) set({ progress: null, scroll: null, log: [], summary: null });
  },

  start: async (spec, settings) => {
    if (get().running) return;
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
    set({ running: true, mode: settings.mode, progress: null, scroll: null, log: [], summary: null, maxScrolls: settings.maxScrolls, last: { spec, settings } });
    useTarget.getState().setBusy(true);
    playSfx('start');
    const offStop = onContentEvent('hud:stop', () => controller?.abort());
    let summary: RunSummary;

    try {
      // Bring the page to the front: lazy content only renders in a visible tab.
      await focusTargetTab();
      if (settings.mode === 'scroll') {
        const result = await runJob(
          tabId,
          { job: 'scroll', spec, settings },
          { onScrollProgress: (scroll) => set({ scroll }) },
          signal,
        );
        const datasets = toDatasets(result.datasets, undefined);
        const records = datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
        if (records > 0) openDatasets(datasets, { dropEmpty: true, stay: true });
        summary = {
          mode: 'scroll',
          reason: result.summary.reason,
          records,
          duplicates: result.summary.duplicates ?? 0,
          steps: result.summary.scrolls ?? 0,
          elapsedMs: Date.now() - started,
          datasetCount: datasets.filter((dataset) => dataset.rows.length > 0).length,
        };
      } else {
        let latest: PaginationProgress | null = null;
        const transport = createTabTransport(tabId, () => ({
          text: t('Collecting page {page} of up to {max}…', { page: latest?.page ?? 1, max: settings.maxPages }),
          detail: t('{records} records', { records: latest?.records ?? 0 }),
        }));
        const outcome = await runPagination(
          transport,
          spec,
          settings,
          (progress) => {
            latest = progress;
            set({ progress, log: progress.log });
          },
          signal,
        );
        const datasets = toDatasets(outcome.datasets, outcome.pages);
        if (outcome.records > 0) openDatasets(datasets, { dropEmpty: true, stay: true });
        summary = {
          mode: 'next',
          reason: outcome.reason,
          records: outcome.records,
          duplicates: outcome.duplicates,
          steps: outcome.pages,
          elapsedMs: Date.now() - started,
          datasetCount: datasets.filter((dataset) => dataset.rows.length > 0).length,
          error: outcome.reason === 'error' ? outcome.log.filter((entry) => entry.kind === 'error').pop()?.message : undefined,
        };
        set({ log: outcome.log });
      }
    } catch (error) {
      useTarget.getState().markError(error);
      summary = {
        mode: settings.mode,
        reason: isCancelled(error) ? 'cancelled' : 'error',
        records: 0,
        duplicates: 0,
        steps: get().progress?.page ?? get().scroll?.scrolls ?? 0,
        elapsedMs: Date.now() - started,
        datasetCount: 0,
        error: isCancelled(error) ? undefined : describeError(error),
      };
    } finally {
      offStop();
      controller = null;
      useTarget.getState().setBusy(false);
      await request(tabId, 'hud:hide', undefined, { noRetry: true }).catch(() => undefined);
    }

    set({ running: false, summary });
    playSfx(summary.reason === 'error' ? 'error' : summary.records > 0 ? 'complete' : 'warning');
    await focusWorkspace();
    // The page may have changed underneath us: refresh the connection quietly.
    void useTarget.getState().connect();
  },
}));
