// Long-running work requested over a port: extraction jobs and bounded infinite scroll.
// Results are streamed in chunks (large datasets never travel as one giant message),
// progress is real, and closing the port or sending "cancel" stops the work.
import type { ExtractSpec, PaginationSettings, RawDataset } from '@/types';
import { isExtractSpec, isPaginationSettings } from '@/types/guards';
import { t } from '@/i18n';
import { Pacer, isCancelled, sleep } from '@/utils/async';
import { isElement, scrollableAncestor } from '@/extraction/dom';
import { runSpec } from '@/extraction/engine';
import { queryPage, type RowCache } from '@/extraction/selectors';
import { collectTables } from '@/extraction/tables';
import { isDisabledControl } from '@/pagination/nextControl';
import { runBoundedScroll, type ScrollEnv } from '@/pagination/scroll';
import { waitForDomQuiet } from '@/pagination/settle';
import { JOB_PORT, type JobClientMessage, type JobServerMessage, type JobSummary } from '@/messaging/protocol';
import { hud } from './overlay';

/** Roughly how many cells go into one port message. */
const CELLS_PER_CHUNK = 20_000;

function post(port: chrome.runtime.Port, message: JobServerMessage): boolean {
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false; // the other side went away
  }
}

async function streamDatasets(port: chrome.runtime.Port, datasets: RawDataset[], pacer: Pacer): Promise<void> {
  for (const dataset of datasets) {
    post(port, {
      type: 'dataset',
      header: {
        key: dataset.key,
        name: dataset.name,
        columns: dataset.columns,
        warnings: dataset.warnings,
        method: dataset.method,
        detail: dataset.detail,
        rowCount: dataset.rows.length,
      },
    });
    const width = Math.max(1, dataset.columns.length);
    const rowsPerChunk = Math.max(50, Math.floor(CELLS_PER_CHUNK / width));
    for (let start = 0; start < dataset.rows.length; start += rowsPerChunk) {
      await pacer.tick();
      if (!post(port, { type: 'rows', key: dataset.key, rows: dataset.rows.slice(start, start + rowsPerChunk) })) return;
    }
  }
}

function scrollTargetFor(spec: ExtractSpec, settings: PaginationSettings): Element {
  const page = document.scrollingElement ?? document.documentElement;
  const custom = settings.scrollContainer.trim();
  if (custom) {
    let el: Element | null;
    try {
      el = document.querySelector(custom);
    } catch {
      throw new Error(t('Invalid scroll container selector.'));
    }
    if (!el) throw new Error(t('The scroll container selector matched nothing on this page.'));
    return el;
  }
  // Auto-detect: records that live inside a scrolling box (virtualised grids, panels).
  try {
    if (spec.kind === 'rule' && spec.rule.rowSelector.trim()) {
      const first = queryPage(document, spec.rule.rowSelector, spec.rule.rowSelectorType).nodes.find(isElement);
      const box = first ? scrollableAncestor(first, 12) : null;
      if (box) return box;
    } else if (spec.kind === 'tables') {
      const handles = collectTables(document);
      const index = spec.indexes === 'all' ? 0 : spec.indexes[0];
      const table = handles[index ?? 0]?.element;
      const box = table ? scrollableAncestor(table, 12) : null;
      if (box) return box;
    }
  } catch {
    /* fall back to the page */
  }
  return page;
}

function createScrollEnv(spec: ExtractSpec, settings: PaginationSettings, signal: AbortSignal): ScrollEnv {
  const target = scrollTargetFor(spec, settings);
  const isPage = target === (document.scrollingElement ?? document.documentElement);
  const originalTop = target.scrollTop;
  const originalLeft = target.scrollLeft;
  const cache: RowCache = new WeakMap();
  const pacer = new Pacer(signal);
  const stepDelay = Math.max(150, settings.delayMs);

  return {
    extract: () => runSpec(document, spec, { pacer, cache }),
    async scrollStep() {
      const before = target.scrollTop;
      const viewport = isPage ? window.innerHeight : target.clientHeight;
      const step = Math.max(200, Math.floor(viewport * 0.9));
      target.scrollTo({ top: before + step, behavior: 'instant' as ScrollBehavior });
      // Let scroll / intersection handlers run before measuring.
      await sleep(50, signal);
      const after = target.scrollTop;
      const atEnd = after + viewport >= target.scrollHeight - 2;
      return { moved: Math.abs(after - before) > 1, atEnd };
    },
    async waitForContent() {
      const heightBefore = target.scrollHeight;
      await sleep(stepDelay, signal);
      const { mutated } = await waitForDomQuiet(document, 300, 4000, signal);
      return mutated || target.scrollHeight !== heightBefore;
    },
    async clickLoadMore() {
      const selector = settings.loadMoreSelector.trim();
      if (!selector) return false;
      let button: Element | null;
      try {
        button = document.querySelector(selector);
      } catch {
        throw new Error(t('Invalid "load more" selector.'));
      }
      if (!button || isDisabledControl(button)) return false;
      const rect = button.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      (button as HTMLElement).click();
      return true;
    },
    now: () => performance.now(),
    restore() {
      target.scrollTo({ top: originalTop, left: originalLeft, behavior: 'instant' as ScrollBehavior });
    },
  };
}

async function runExtract(port: chrome.runtime.Port, spec: ExtractSpec, signal: AbortSignal): Promise<JobSummary> {
  const pacer = new Pacer(signal);
  const datasets = await runSpec(document, spec, {
    pacer,
    onProgress: (done, total) => post(port, { type: 'progress', done, total }),
  });
  await streamDatasets(port, datasets, pacer);
  return { reason: 'completed' };
}

async function runScroll(
  port: chrome.runtime.Port,
  spec: ExtractSpec,
  settings: PaginationSettings,
  controller: AbortController,
): Promise<JobSummary> {
  const env = createScrollEnv(spec, settings, controller.signal);
  hud.show({
    text: t('Scrolling and collecting…'),
    detail: '',
    canStop: true,
    stopLabel: t('Stop'),
    onStop: () => controller.abort(),
  });
  try {
    const outcome = await runBoundedScroll(
      env,
      {
        maxScrolls: settings.maxScrolls,
        maxRecords: settings.maxRecords,
        maxDurationMs: settings.maxDurationSec * 1000,
        skipDuplicates: settings.skipDuplicates,
      },
      (progress) => {
        hud.update(t('Scrolling and collecting…'), t('{records} records · scroll {scrolls}/{max}', { records: progress.records, scrolls: progress.scrolls, max: settings.maxScrolls }));
        post(port, { type: 'scroll-progress', progress });
      },
      controller.signal,
    );
    if (outcome.reason === 'error') throw new Error(outcome.error ?? t('Scrolling failed.'));
    // Whatever was collected is delivered, including after Stop.
    await streamDatasets(port, outcome.datasets, new Pacer());
    return { reason: outcome.reason, scrolls: outcome.scrolls, duplicates: outcome.duplicates, elapsedMs: outcome.elapsedMs };
  } finally {
    hud.hide();
  }
}

export function registerJobHandler(): () => void {
  const onConnect = (port: chrome.runtime.Port): void => {
    if (port.name !== JOB_PORT) return;
    // Only our own extension pages may start jobs.
    if (port.sender?.id !== chrome.runtime.id) {
      port.disconnect();
      return;
    }
    const controller = new AbortController();
    let started = false;
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener((raw: unknown) => {
      const message = raw as JobClientMessage;
      if (!message || typeof message !== 'object') return;
      if (message.type === 'cancel') {
        controller.abort();
        return;
      }
      if (message.type !== 'start' || started) return;
      started = true;
      if (!isExtractSpec(message.spec) || (message.job === 'scroll' && !isPaginationSettings(message.settings))) {
        post(port, { type: 'error', message: t('The extraction request is not valid.'), cancelled: false });
        return;
      }
      const run = message.job === 'scroll' ? runScroll(port, message.spec, message.settings, controller) : runExtract(port, message.spec, controller.signal);
      run.then(
        (summary) => post(port, { type: 'done', summary }),
        (error: unknown) => {
          post(port, {
            type: 'error',
            message: isCancelled(error) ? t('Cancelled.') : error instanceof Error ? error.message : String(error),
            cancelled: isCancelled(error),
          });
        },
      );
    });
  };
  chrome.runtime.onConnect.addListener(onConnect);
  return () => chrome.runtime.onConnect.removeListener(onConnect);
}
