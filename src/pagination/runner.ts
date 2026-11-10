// Controlled pagination. Runs in the workspace (an extension page) and drives the page
// through a PageTransport, so the loop – limits, retries, duplicate detection, stop
// conditions – is plain logic that unit tests exercise with a fake transport.
import type { ExtractSpec, NextControlInfo, PaginationSettings, RawDataset, StopReason } from '@/types';
import { t } from '@/i18n';
import { isCancelled } from '@/utils/async';
import { Accumulator, rowKeyOf } from './accumulator';

export interface PageTransport {
  /** Make the current page ready to extract (inject, wait for rendering). */
  ensureReady(signal: AbortSignal): Promise<void>;
  extract(spec: ExtractSpec, signal: AbortSignal): Promise<RawDataset[]>;
  /** Find and activate the next-page control. */
  advance(nextSelector: string, spec: ExtractSpec): Promise<NextControlInfo>;
  /** After advance: did the content change in place, not change, or did the page navigate? */
  awaitChange(timeoutMs: number): Promise<'changed' | 'unchanged' | 'navigated'>;
  waitForNavigation(timeoutMs: number, signal: AbortSignal): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface PaginationLogEntry {
  page: number;
  kind: 'info' | 'warning' | 'error';
  message: string;
}

export interface PaginationProgress {
  page: number;
  maxPages: number;
  records: number;
  duplicates: number;
  phase: 'loading' | 'extracting' | 'waiting' | 'advancing' | 'done';
  log: PaginationLogEntry[];
}

export interface PaginationOutcome {
  datasets: RawDataset[];
  reason: StopReason;
  pages: number;
  records: number;
  duplicates: number;
  log: PaginationLogEntry[];
}

const CHANGE_TIMEOUT_MS = 15_000;
const NAVIGATION_TIMEOUT_MS = 45_000;

function pageFingerprint(datasets: RawDataset[]): string {
  return datasets
    .map((dataset) => {
      const first = dataset.rows[0];
      const last = dataset.rows[dataset.rows.length - 1];
      return `${dataset.key}:${dataset.rows.length}:${first ? rowKeyOf(first) : ''}:${last ? rowKeyOf(last) : ''}`;
    })
    .join('\u001e');
}

export async function runPagination(
  transport: PageTransport,
  spec: ExtractSpec,
  settings: PaginationSettings,
  onProgress: (progress: PaginationProgress) => void,
  signal: AbortSignal,
): Promise<PaginationOutcome> {
  const accumulator = new Accumulator('pages', settings.skipDuplicates, settings.maxRecords);
  const log: PaginationLogEntry[] = [];
  const maxPages = Math.max(1, Math.floor(settings.maxPages));
  let page = 0;
  let pagesDone = 0;
  let reason: StopReason = 'completed';
  let previousFingerprint = '';

  const report = (phase: PaginationProgress['phase']) =>
    onProgress({ page: Math.max(page, 1), maxPages, records: accumulator.total, duplicates: accumulator.duplicates, phase, log: log.slice() });
  const note = (kind: PaginationLogEntry['kind'], message: string) => log.push({ page, kind, message });

  try {
    for (;;) {
      page++;
      if (signal.aborted) {
        reason = 'cancelled';
        break;
      }

      // Extract this page, retrying transient failures.
      let datasets: RawDataset[] | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          report('loading');
          await transport.ensureReady(signal);
          report('extracting');
          datasets = await transport.extract(spec, signal);
          break;
        } catch (error) {
          if (isCancelled(error) || signal.aborted) throw error;
          const message = error instanceof Error ? error.message : String(error);
          if (attempt >= settings.retries) {
            note('error', t('Page {page} failed: {message}', { page, message }));
            reason = 'error';
            break;
          }
          note('warning', t('Page {page} failed ({message}). Retrying ({attempt}/{retries})…', { page, message, attempt: attempt + 1, retries: settings.retries }));
          report('waiting');
          await transport.sleep(1000 * (attempt + 1), signal);
        }
      }
      if (!datasets) break;

      const fingerprint = pageFingerprint(datasets);
      const sameAsPrevious = page > 1 && fingerprint === previousFingerprint && datasets.some((dataset) => dataset.rows.length > 0);
      previousFingerprint = fingerprint;
      if (sameAsPrevious) {
        note('warning', t('Page {page} shows the same records as the previous page. Stopping.', { page }));
        reason = 'no-new-records';
        break;
      }
      const { added, duplicates } = accumulator.add(datasets);
      pagesDone = page;
      note(
        'info',
        duplicates > 0
          ? t('Page {page}: {added} new records, {duplicates} duplicates skipped', { page, added, duplicates })
          : t('Page {page}: {added} records', { page, added }),
      );
      report('extracting');

      if (accumulator.full) {
        reason = 'max-records';
        break;
      }
      if (page > 1 && added === 0) {
        note('warning', t('Page {page} added no new records. Stopping.', { page }));
        reason = 'no-new-records';
        break;
      }
      if (page >= maxPages) {
        reason = 'max-pages';
        break;
      }

      report('waiting');
      if (settings.delayMs > 0) await transport.sleep(settings.delayMs, signal);
      if (signal.aborted) {
        reason = 'cancelled';
        break;
      }

      report('advancing');
      const next = await transport.advance(settings.nextSelector, spec);
      if (!next.found) {
        note('info', settings.nextSelector.trim() ? t('The next-page selector matched nothing: this looks like the last page.') : t('No next-page control found: this looks like the last page.'));
        reason = 'no-next';
        break;
      }
      if (next.disabled) {
        note('info', t('The next-page control is disabled: this is the last page.'));
        reason = 'next-disabled';
        break;
      }
      const outcome = await transport.awaitChange(CHANGE_TIMEOUT_MS);
      if (outcome === 'navigated') {
        await transport.waitForNavigation(NAVIGATION_TIMEOUT_MS, signal);
      } else if (outcome === 'unchanged') {
        note('warning', t('Clicking "{label}" did not load new content. Stopping.', { label: next.text || t('next') }));
        reason = 'no-change';
        break;
      }
    }
  } catch (error) {
    if (isCancelled(error) || signal.aborted) {
      reason = 'cancelled';
      note('info', t('Stopped by you. Everything collected so far is kept.'));
    } else {
      reason = 'error';
      note('error', error instanceof Error ? error.message : String(error));
    }
  }

  report('done');
  return {
    datasets: accumulator.datasets(),
    reason,
    pages: pagesDone,
    records: accumulator.total,
    duplicates: accumulator.duplicates,
    log,
  };
}

/** Plain-language explanation of why a run stopped. */
export function describeStop(reason: StopReason): string {
  switch (reason) {
    case 'completed':
      return t('Finished.');
    case 'max-pages':
      return t('Reached the maximum number of pages you set.');
    case 'max-records':
      return t('Reached the maximum number of records you set.');
    case 'max-scrolls':
      return t('Reached the maximum number of scrolls you set.');
    case 'max-duration':
      return t('Reached the time limit you set.');
    case 'no-next':
      return t('No next page was found (last page reached).');
    case 'next-disabled':
      return t('The next-page control is disabled (last page reached).');
    case 'no-change':
      return t('The page did not change after moving to the next page.');
    case 'no-new-records':
      return t('The next page added no new records.');
    case 'end-of-content':
      return t('Reached the end of the content: scrolling loaded nothing new.');
    case 'cancelled':
      return t('Stopped by you.');
    case 'error':
      return t('Stopped because of an error.');
  }
}
