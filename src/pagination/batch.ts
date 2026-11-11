// Batch URL extraction: run one extraction on a list of pages the user supplies.
// Like pagination it is user-started, strictly bounded (the list, and a maximum), paced,
// and cancellable. The loop talks to a BatchTransport so it is testable without a browser.
import type { ExtractSpec, RawDataset, StopReason } from '@/types';
import { t } from '@/i18n';
import { CancelledError, isCancelled } from '@/utils/async';
import { Accumulator } from './accumulator';

export interface BatchTransport {
  /** Navigate to the URL and make the page ready to extract. */
  open(url: string, signal: AbortSignal): Promise<void>;
  extract(spec: ExtractSpec, signal: AbortSignal): Promise<RawDataset[]>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
}

export interface BatchSettings {
  /** Never visit more than this many URLs. */
  maxUrls: number;
  delayMs: number;
  /** Name of the column that records which page a row came from. */
  sourceColumn: string;
}

export interface BatchLogEntry {
  url: string;
  kind: 'info' | 'warning' | 'error';
  message: string;
}

export interface BatchProgress {
  index: number;
  total: number;
  url: string;
  records: number;
  failed: number;
  log: BatchLogEntry[];
}

export interface BatchOutcome {
  datasets: RawDataset[];
  reason: StopReason;
  visited: number;
  failed: number;
  records: number;
  log: BatchLogEntry[];
}

/** Keep valid, distinct http(s) URLs in their original order. */
export function normalizeUrlList(text: string): { urls: string[]; invalid: string[]; duplicates: number } {
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const line of text.split(/[\r\n]+/)) {
    const value = line.trim();
    if (!value) continue;
    let href = '';
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') href = parsed.href;
    } catch {
      href = '';
    }
    if (!href) {
      invalid.push(value);
    } else if (seen.has(href)) {
      duplicates++;
    } else {
      seen.add(href);
      urls.push(href);
    }
  }
  return { urls, invalid, duplicates };
}

function withSource(datasets: RawDataset[], column: string, url: string): RawDataset[] {
  return datasets.map((dataset) => ({
    ...dataset,
    columns: [column, ...dataset.columns],
    rows: dataset.rows.map((row) => [url, ...row]),
  }));
}

export async function runBatch(
  transport: BatchTransport,
  urls: string[],
  spec: ExtractSpec,
  settings: BatchSettings,
  onProgress: (progress: BatchProgress) => void,
  signal: AbortSignal,
): Promise<BatchOutcome> {
  const accumulator = new Accumulator('pages', false);
  const list = urls.slice(0, Math.max(1, Math.floor(settings.maxUrls)));
  const log: BatchLogEntry[] = [];
  let visited = 0;
  let failed = 0;
  let reason: StopReason = 'completed';

  for (let index = 0; index < list.length; index++) {
    const url = list[index];
    if (signal.aborted) {
      reason = 'cancelled';
      break;
    }
    onProgress({ index: index + 1, total: list.length, url, records: accumulator.total, failed, log: log.slice() });
    if (signal.aborted) {
      reason = 'cancelled';
      break;
    }
    try {
      await transport.open(url, signal);
      if (signal.aborted) throw new CancelledError();
      const datasets = await transport.extract(spec, signal);
      const { added } = accumulator.add(withSource(datasets, settings.sourceColumn, url));
      visited++;
      if (added === 0) log.push({ url, kind: 'warning', message: t('No records found') });
      else log.push({ url, kind: 'info', message: t('{count} records', { count: added }) });
    } catch (error) {
      if (isCancelled(error) || signal.aborted) {
        reason = 'cancelled';
        break;
      }
      // One bad page must not cost the user the rest of the list.
      failed++;
      log.push({ url, kind: 'error', message: error instanceof Error ? error.message : String(error) });
    }
    if (index < list.length - 1 && settings.delayMs > 0) {
      try {
        await transport.sleep(settings.delayMs, signal);
      } catch {
        reason = 'cancelled';
        break;
      }
    }
  }
  if (reason === 'completed' && urls.length > list.length) reason = 'max-pages';
  onProgress({ index: Math.min(visited + failed, list.length), total: list.length, url: '', records: accumulator.total, failed, log: log.slice() });
  return { datasets: accumulator.datasets(), reason, visited, failed, records: accumulator.total, log };
}
