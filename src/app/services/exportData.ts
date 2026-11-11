// Turning datasets into downloaded files / clipboard text.
import type { ExportFormat, ExportOptions, TableData } from '@/types';
import { t } from '@/i18n';
import { clipboardText, exportFilename } from '@/export';
import { runExport } from '@/workers/client';

export interface Sheet {
  name: string;
  data: TableData;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser time to start the download before releasing the blob.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export interface ExportOutcome {
  files: string[];
  rows: number;
  bytes: number;
}

/**
 * Export sheets to files. XLSX puts every sheet into one workbook; text formats produce
 * one file per sheet. Progress is the real number of rows written.
 */
export async function exportSheets(
  sheets: Sheet[],
  options: ExportOptions,
  baseName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportOutcome> {
  const totalRows = sheets.reduce((sum, sheet) => sum + sheet.data.rows.length, 0);
  const files: string[] = [];
  let bytes = 0;
  if (options.format === 'xlsx') {
    const result = await runExport(sheets, options, onProgress);
    const filename = exportFilename(sheets.length === 1 ? sheets[0].name : baseName, 'xlsx');
    download(result.blob, filename);
    files.push(filename);
    bytes += result.blob.size;
  } else {
    let offset = 0;
    const used = new Set<string>();
    for (const sheet of sheets) {
      const base = offset;
      const result = await runExport([sheet], options, (done) => onProgress?.(base + done, totalRows));
      let filename = exportFilename(sheet.name, options.format);
      // Two sheets with the same name must not overwrite each other.
      for (let n = 2; used.has(filename); n++) filename = exportFilename(`${sheet.name} ${n}`, options.format);
      used.add(filename);
      download(result.blob, filename);
      files.push(filename);
      bytes += result.blob.size;
      offset += sheet.data.rows.length;
    }
  }
  onProgress?.(totalRows, totalRows);
  return { files, rows: totalRows, bytes };
}

export async function copyToClipboard(
  data: TableData,
  format: 'tsv' | 'csv' | 'json' | 'markdown',
  options: { formulaGuard: boolean; includeHeader: boolean },
): Promise<number> {
  const text = clipboardText(data, format, options);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    throw new Error(t('The browser blocked clipboard access. Click inside the workspace and try again.'));
  }
  return data.rows.length;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel (XLSX)',
  json: 'JSON',
  jsonl: 'JSON Lines',
  tsv: 'TSV',
  markdown: 'Markdown table',
  html: 'HTML table',
};
