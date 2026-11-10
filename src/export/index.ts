// Export entry point: turns sheets into a downloadable Blob, cooperatively and with real
// progress, plus clipboard text. Format details live in the sibling modules.
import type { TableData } from '@/types/data';
import type { ExportOptions } from '@/types/transforms';
import { DEFAULT_CHUNK_ROWS, delimitedChunks, toDelimited } from '@/export/csv';
import { EXTENSION, MIME } from '@/export/filename';
import { jsonChunks, jsonlChunks, toJson } from '@/export/json';
import { buildXlsxAsync } from '@/export/xlsx';
import { t } from '@/i18n';
import { Pacer } from '@/utils/async';

export * from '@/export/csv';
export * from '@/export/filename';
export * from '@/export/formula';
export * from '@/export/json';
export * from '@/export/xlsx';

export interface ExportSheet {
  name: string;
  data: TableData;
}

export interface ExportResult {
  blob: Blob;
  extension: string;
  mime: string;
}

const UTF8_BOM = '﻿';

function textChunks(data: TableData, options: ExportOptions): Generator<string> {
  switch (options.format) {
    case 'csv':
      return delimitedChunks(data, {
        delimiter: options.delimiter,
        formulaGuard: options.formulaGuard,
        includeHeader: options.includeHeader,
        chunkRows: DEFAULT_CHUNK_ROWS,
      });
    case 'tsv':
      return delimitedChunks(data, {
        delimiter: '\t',
        formulaGuard: options.formulaGuard,
        includeHeader: options.includeHeader,
        chunkRows: DEFAULT_CHUNK_ROWS,
      });
    case 'json':
      return jsonChunks(data, { pretty: options.jsonPretty }, DEFAULT_CHUNK_ROWS);
    case 'jsonl':
      return jsonlChunks(data, DEFAULT_CHUNK_ROWS);
    case 'xlsx':
      throw new Error('XLSX is not a text format');
  }
}

/**
 * Build the export file. Asynchronous and time-sliced, so it can run on the main thread
 * as well as in a worker; `onProgress(done, total)` reports rows actually written and
 * always finishes with done === total.
 *
 * CSV, TSV, JSON and JSON Lines hold a single table: passing several sheets for those
 * formats throws (export them one by one). XLSX takes any number of sheets.
 * The Blob is assembled from the generated chunks – no giant intermediate string.
 */
export async function buildExport(
  sheets: ExportSheet[],
  options: ExportOptions,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const { format } = options;
  const mime = MIME[format];
  const extension = EXTENSION[format];
  if (sheets.length === 0) throw new Error(t('There is nothing to export.'));

  if (format === 'xlsx') {
    const parts = await buildXlsxAsync(sheets, {
      typed: options.xlsxTypes,
      includeHeader: options.includeHeader,
      onProgress,
      signal,
    });
    return { blob: new Blob(parts, { type: mime }), extension, mime };
  }

  if (sheets.length > 1) {
    throw new Error(
      t('{format} files can hold only one table. Export the {count} datasets one by one, or use XLSX.', {
        format: format.toUpperCase(),
        count: sheets.length,
      }),
    );
  }

  const data = sheets[0]!.data;
  const total = data.rows.length;
  const pacer = new Pacer(signal);
  const parts: string[] = [];
  // Excel only detects UTF-8 (Bengali, accents, emoji…) in delimited text when it starts with a BOM.
  if (options.bom && (format === 'csv' || format === 'tsv')) parts.push(UTF8_BOM);

  let done = 0;
  for (const chunk of textChunks(data, options)) {
    parts.push(chunk);
    done = Math.min(total, done + DEFAULT_CHUNK_ROWS);
    // The last chunk is reported once, below, so `total` is announced exactly one time.
    if (done < total) onProgress?.(done, total);
    await pacer.tick();
  }
  onProgress?.(total, total);
  return { blob: new Blob(parts, { type: mime }), extension, mime };
}

/**
 * Text for the clipboard. TSV is what spreadsheet applications expect on paste; all
 * formats use LF line endings and no BOM, which is right for pasting into editors too.
 */
export function clipboardText(
  data: TableData,
  format: 'tsv' | 'csv' | 'json',
  opts: { formulaGuard: boolean; includeHeader: boolean },
): string {
  if (format === 'json') return toJson(data, { pretty: true });
  return toDelimited(data, {
    delimiter: format === 'tsv' ? '\t' : ',',
    formulaGuard: opts.formulaGuard,
    includeHeader: opts.includeHeader,
    lineEnding: '\n',
  });
}
