import type { ExportFormat } from '@/types/transforms';
import { brand } from '@/config/brand';
import { slugify } from '@/utils/text';

export const EXTENSION: Record<ExportFormat, string> = {
  csv: 'csv',
  tsv: 'tsv',
  json: 'json',
  jsonl: 'jsonl',
  xlsx: 'xlsx',
};

export const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv;charset=utf-8',
  tsv: 'text/tab-separated-values;charset=utf-8',
  json: 'application/json;charset=utf-8',
  jsonl: 'application/x-ndjson;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function two(value: number): string {
  return String(value).padStart(2, '0');
}

/** `<prefix>-<slug>-YYYYMMDD-HHmmss.<ext>` in local time, e.g. "rowlio-price-list-20240131-142501.csv". */
export function exportFilename(name: string, format: ExportFormat, date: Date = new Date()): string {
  const day = `${String(date.getFullYear()).padStart(4, '0')}${two(date.getMonth() + 1)}${two(date.getDate())}`;
  const time = `${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
  return `${brand.filePrefix}-${slugify(name) || 'data'}-${day}-${time}.${EXTENSION[format]}`;
}
