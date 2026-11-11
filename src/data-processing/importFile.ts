// Importing local files (CSV, TSV, JSON, JSON Lines, Rowlio project files) into the
// workspace. Files are read in the browser; nothing is uploaded.
import type { Dataset, RawDataset } from '@/types/data';
import { isDataset, isObject } from '@/types/guards';
import { parseDelimited } from '@/export/csv';
import { t } from '@/i18n';
import { uid } from '@/utils/id';
import { uniqueNames } from '@/utils/text';

export interface ImportResult {
  /** Tabular content parsed from the file. */
  raw: RawDataset[];
  /** Datasets from a Rowlio project file (already in workspace form). */
  project: Dataset[];
  format: 'csv' | 'tsv' | 'json' | 'jsonl' | 'project';
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').replace(/\.rowlio$/, '') || t('Imported data');
}

/** Pick the delimiter that splits the first line into the most fields. */
export function detectDelimiter(text: string): string {
  const firstLine = text.slice(0, 20_000).split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
  let best = ',';
  let bestCount = 0;
  for (const candidate of ['\t', ';', ',', '|']) {
    let count = 0;
    let quoted = false;
    for (const char of firstLine) {
      if (char === '"') quoted = !quoted;
      else if (char === candidate && !quoted) count++;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function fromRows(name: string, rows: string[][], warnings: string[] = []): RawDataset {
  const nonEmpty = rows.filter((row) => row.some((cell) => cell !== ''));
  if (nonEmpty.length === 0) throw new Error(t('The file contains no data.'));
  const [header, ...body] = nonEmpty;
  return { key: 'import', name, columns: uniqueNames(header!), rows: body, warnings, method: 'import' };
}

function cellOf(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value);
}

function fromRecords(name: string, records: unknown[]): RawDataset {
  if (records.length === 0) throw new Error(t('The file contains no data.'));
  if (records.every(Array.isArray)) {
    return fromRows(name, (records as unknown[][]).map((row) => row.map(cellOf)));
  }
  const columns: string[] = [];
  const index = new Map<string, number>();
  let skipped = 0;
  const rows: string[][] = [];
  for (const record of records) {
    if (!isObject(record)) {
      skipped++;
      continue;
    }
    const row: string[] = [];
    for (const [key, value] of Object.entries(record)) {
      let at = index.get(key);
      if (at === undefined) {
        at = columns.length;
        index.set(key, at);
        columns.push(key);
      }
      row[at] = cellOf(value);
    }
    rows.push(row);
  }
  if (rows.length === 0) throw new Error(t('The JSON file does not contain a list of records.'));
  const filled = rows.map((row) => columns.map((_, i) => row[i] ?? ''));
  const warnings = skipped > 0 ? [t('{count} entries that are not objects were skipped.', { count: skipped })] : [];
  return { key: 'import', name, columns: uniqueNames(columns), rows: filled, warnings, method: 'import' };
}

function fromJson(name: string, value: unknown): ImportResult {
  if (isObject(value) && value.format === 'rowlio-project' && Array.isArray(value.datasets)) {
    const datasets = value.datasets.filter(isDataset).map((dataset) => ({ ...dataset, id: uid('ds') }));
    if (datasets.length === 0) throw new Error(t('The project file contains no valid datasets.'));
    return { raw: [], project: datasets, format: 'project' };
  }
  if (Array.isArray(value)) return { raw: [fromRecords(name, value)], project: [], format: 'json' };
  if (isObject(value)) {
    // { "data": [...] } style wrappers: use the first array of records found.
    for (const [key, inner] of Object.entries(value)) {
      if (Array.isArray(inner) && inner.length > 0 && inner.some((item) => isObject(item) || Array.isArray(item))) {
        return { raw: [fromRecords(`${name} – ${key}`, inner)], project: [], format: 'json' };
      }
    }
    return { raw: [fromRecords(name, [value])], project: [], format: 'json' };
  }
  throw new Error(t('The JSON file does not contain a list of records.'));
}

/** Parse the text of an imported file. Throws an Error with a message for the user. */
export function parseImportFile(fileName: string, text: string): ImportResult {
  const content = text.replace(/^﻿/, '');
  if (content.trim() === '') throw new Error(t('The file is empty.'));
  const name = baseName(fileName);
  const extension = (fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase();

  if (extension === 'jsonl' || extension === 'ndjson') {
    const records: unknown[] = [];
    let line = 0;
    for (const raw of content.split(/\r?\n/)) {
      line++;
      if (raw.trim() === '') continue;
      try {
        records.push(JSON.parse(raw));
      } catch {
        throw new Error(t('Line {line} is not valid JSON.', { line }));
      }
    }
    return { raw: [fromRecords(name, records)], project: [], format: 'jsonl' };
  }

  const looksJson = /^[\[{]/.test(content.trimStart());
  if (extension === 'json' || (looksJson && extension !== 'csv' && extension !== 'tsv')) {
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw new Error(t('The file is not valid JSON.'));
    }
    return fromJson(name, value);
  }

  const delimiter = extension === 'tsv' ? '\t' : detectDelimiter(content);
  return { raw: [fromRows(name, parseDelimited(content, delimiter))], project: [], format: delimiter === '\t' ? 'tsv' : 'csv' };
}
