// High-level extraction actions used by the pages: run a spec on the connected tab, turn
// the result into datasets, open them in the Data Preview, and report honestly.
import type { Dataset, ExtractSpec, RawDataset } from '@/types';
import { t, tn } from '@/i18n';
import { datasetFromRaw } from '@/data-processing/dataset';
import { runJob, TabAccessError, type JobHandlers } from '@/messaging/tabClient';
import { isCancelled } from '@/utils/async';
import { useData } from '@/app/stores/data';
import { requireTarget, useTarget } from '@/app/stores/target';
import { navigate, toast } from '@/app/stores/ui';

export function toDatasets(raw: RawDataset[], pages?: number): Dataset[] {
  const { url, title } = useTarget.getState();
  return raw.map((dataset) => datasetFromRaw(dataset, { url, title, extractedAt: Date.now(), pages }));
}

/** Run a spec on the connected page and return datasets (does not open them). */
export async function runExtraction(spec: ExtractSpec, handlers: JobHandlers = {}, signal?: AbortSignal): Promise<Dataset[]> {
  const tabId = requireTarget();
  try {
    const { datasets } = await runJob(tabId, { job: 'extract', spec }, handlers, signal);
    return toDatasets(datasets);
  } catch (error) {
    useTarget.getState().markError(error);
    throw error;
  }
}

export interface OpenOptions {
  /** Skip datasets without rows instead of opening empty sheets. */
  dropEmpty?: boolean;
  stay?: boolean;
}

/** Open extracted datasets in the Data Preview and tell the user exactly what happened. */
export function openDatasets(datasets: Dataset[], options: OpenOptions = {}): boolean {
  const nonEmpty = datasets.filter((dataset) => dataset.rows.length > 0);
  const toOpen = options.dropEmpty ? nonEmpty : datasets;
  if (nonEmpty.length === 0) {
    const reason = datasets.flatMap((dataset) => dataset.warnings)[0];
    toast.warning(t('Nothing was extracted.'), reason ?? t('The page has no matching content.'));
    return false;
  }
  useData.getState().open(options.dropEmpty ? nonEmpty : toOpen);
  const rows = nonEmpty.reduce((sum, dataset) => sum + dataset.rows.length, 0);
  const warnings = toOpen.reduce((sum, dataset) => sum + dataset.warnings.length, 0);
  const summary =
    nonEmpty.length === 1
      ? tn(rows, 'Extracted {count} row', 'Extracted {count} rows')
      : t('Extracted {rows} rows in {count} datasets', { rows, count: nonEmpty.length });
  if (warnings > 0) toast.warning(summary, tn(warnings, '{count} warning – see the Data Preview', '{count} warnings – see the Data Preview'));
  else toast.success(summary);
  if (!options.stay) navigate('/data');
  return true;
}

/** Friendly message for anything thrown while talking to the page. */
export function describeError(error: unknown): string {
  if (error instanceof TabAccessError) return error.message;
  if (isCancelled(error)) return t('Cancelled.');
  return error instanceof Error ? error.message : String(error);
}

/** Run + open, with error reporting. Returns true when data was opened. */
export async function extractAndOpen(spec: ExtractSpec, options: OpenOptions = {}, signal?: AbortSignal): Promise<boolean> {
  try {
    const datasets = await runExtraction(spec, {}, signal);
    return openDatasets(datasets, options);
  } catch (error) {
    if (isCancelled(error)) toast.info(t('Extraction cancelled.'));
    else toast.error(t('Extraction failed'), describeError(error));
    return false;
  }
}
