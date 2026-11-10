// Turning raw extraction output (plain strings) into the Dataset model, and small
// structural helpers shared by transforms, views and storage.
import type { Column, Dataset, RawDataset, Row, TableData } from '@/types/data';
import { tn } from '@/i18n';
import { uid } from '@/utils/id';
import { uniqueNames } from '@/utils/text';

const KEY_SEPARATOR = '\u001f';
const KEY_ESCAPE = '\u001e';
const KEY_UNSAFE = /[\u001e\u001f]/;
const KEY_UNSAFE_ALL = /[\u001e\u001f]/g;

/**
 * Exact dedupe key for a row. Deliberately not a hash: a collision would silently drop a
 * distinct row. Cells are joined with U+001F; the (practically non-existent) cells that
 * contain that control character are escaped so the key stays collision-free.
 */
export function rowKey(cells: string[]): string {
  for (let i = 0; i < cells.length; i++) {
    if (KEY_UNSAFE.test(cells[i] ?? '')) return cells.map(escapeKeyPart).join(KEY_SEPARATOR);
  }
  return cells.join(KEY_SEPARATOR);
}

function escapeKeyPart(cell: string): string {
  return (cell ?? '').replace(KEY_UNSAFE_ALL, (ch) => KEY_ESCAPE + (ch === KEY_ESCAPE ? '0' : '1'));
}

/** Structural copy: new column objects, new row objects, new cells arrays. */
export function cloneTableData(data: TableData): TableData {
  return {
    columns: data.columns.map((column) => ({ id: column.id, name: column.name })),
    rows: data.rows.map((row) => ({ id: row.id, cells: row.cells.slice() })),
  };
}

/** The smallest row id that is guaranteed not to collide with an existing row. */
export function nextRowId(data: TableData): number {
  let max = 0;
  for (let i = 0; i < data.rows.length; i++) {
    const id = data.rows[i]!.id;
    if (id > max) max = id;
  }
  return max + 1;
}

function toCell(value: unknown): string {
  if (typeof value === 'string') return value;
  return value === null || value === undefined ? '' : String(value);
}

interface Shape {
  /** Widest row or the header, whichever is larger. */
  width: number;
  short: number;
  long: number;
}

function measure(raw: RawDataset): Shape {
  const header = raw.columns.length;
  let width = header;
  let short = 0;
  let long = 0;
  for (const cells of raw.rows) {
    if (cells.length < header) short += 1;
    else if (cells.length > header) {
      long += 1;
      if (cells.length > width) width = cells.length;
    }
  }
  return { width, short, long };
}

/** Header names padded to `width` and made unique ("" → "Column N", duplicates → "Name (2)"). */
function headerNames(raw: RawDataset, width: number): string[] {
  const names = raw.columns.map(toCell);
  while (names.length < width) names.push('');
  return uniqueNames(names);
}

function raggedWarnings(shape: Shape): string[] {
  const warnings: string[] = [];
  if (shape.short > 0) {
    warnings.push(
      tn(
        shape.short,
        '{count} row had fewer cells than the header; the missing cells were left empty.',
        '{count} rows had fewer cells than the header; the missing cells were left empty.',
      ),
    );
  }
  if (shape.long > 0) {
    warnings.push(
      tn(
        shape.long,
        '{count} row had more cells than the header; the extra cells were kept in additional columns.',
        '{count} rows had more cells than the header; the extra cells were kept in additional columns.',
      ),
    );
  }
  return warnings;
}

function mergeWarnings(existing: string[], incoming: string[]): string[] {
  const seen = new Set(existing);
  const merged = existing.slice();
  for (const warning of incoming) {
    if (!seen.has(warning)) {
      seen.add(warning);
      merged.push(warning);
    }
  }
  return merged;
}

/**
 * Build a Dataset from what the content script returned. Never loses data: short rows are
 * padded with '' and rows longer than the header get extra "Column N" columns.
 */
export function datasetFromRaw(
  raw: RawDataset,
  source: { url: string; title: string; extractedAt?: number; pages?: number },
): Dataset {
  const shape = measure(raw);
  const { width } = shape;
  const columns: Column[] = headerNames(raw, width).map((name) => ({ id: uid('c'), name }));

  const rows: Row[] = new Array<Row>(raw.rows.length);
  for (let r = 0; r < raw.rows.length; r++) {
    const input = raw.rows[r]!;
    const cells = new Array<string>(width);
    for (let c = 0; c < width; c++) cells[c] = c < input.length ? toCell(input[c]) : '';
    rows[r] = { id: r + 1, cells };
  }

  const dataset: Dataset = {
    id: uid('ds'),
    name: raw.name,
    columns,
    rows,
    source: {
      url: source.url,
      title: source.title,
      extractedAt: source.extractedAt ?? Date.now(),
      method: raw.method,
    },
    warnings: mergeWarnings([], [...raw.warnings, ...raggedWarnings(shape)]),
  };
  if (raw.detail !== undefined) dataset.source.detail = raw.detail;
  if (source.pages !== undefined) dataset.source.pages = source.pages;
  return dataset;
}

/**
 * Append the rows of another page of the same dataset. Columns are aligned by NAME, so a
 * page whose columns come in a different order (or with extra / missing fields) still lands
 * in the right cells. Unknown columns are added to the dataset; nothing is dropped.
 * Returns a new Dataset; the input is not mutated and untouched rows keep their identity.
 */
export function appendRaw(dataset: Dataset, raw: RawDataset): { dataset: Dataset; added: number } {
  const shape = measure(raw);
  // Same naming rules as datasetFromRaw, so page 2 of ["Name", "Name"] maps onto
  // "Name" / "Name (2)" exactly like page 1 did.
  const names = headerNames(raw, shape.width);

  const indexByName = new Map<string, number>();
  dataset.columns.forEach((column, index) => {
    if (!indexByName.has(column.name)) indexByName.set(column.name, index);
  });

  const columns = dataset.columns.slice();
  const target = new Array<number>(names.length);
  for (let c = 0; c < names.length; c++) {
    const name = names[c]!;
    let index = indexByName.get(name);
    if (index === undefined) {
      index = columns.length;
      columns.push({ id: uid('c'), name });
      indexByName.set(name, index);
    }
    target[c] = index;
  }

  const width = columns.length;
  const grew = width > dataset.columns.length;
  const rows: Row[] = grew
    ? dataset.rows.map((row) => ({ id: row.id, cells: padCells(row.cells, width) }))
    : dataset.rows.slice();

  let id = nextRowId(dataset);
  for (const input of raw.rows) {
    const cells = new Array<string>(width).fill('');
    for (let c = 0; c < input.length; c++) cells[target[c]!] = toCell(input[c]);
    rows.push({ id, cells });
    id += 1;
  }

  const warnings = mergeWarnings(dataset.warnings, [...raw.warnings, ...raggedWarnings(shape)]);
  return {
    dataset: { ...dataset, source: { ...dataset.source }, columns, rows, warnings },
    added: raw.rows.length,
  };
}

function padCells(cells: string[], width: number): string[] {
  const padded = cells.slice();
  while (padded.length < width) padded.push('');
  return padded;
}
