// Read-only views over a dataset: search, column filters, duplicates-only and sorting.
// Nothing here copies rows – a view is an array of indexes into data.rows – and every
// test is allocation-free per cell so 200k × 10 datasets stay interactive.
import type { Row, TableData } from '@/types/data';
import type { ColumnFilter, ViewSpec } from '@/types/transforms';
import { rowKey } from '@/data-processing/dataset';
import { isBlank, parseNumberStrict } from '@/data-processing/infer';

type CellTest = (value: string) => boolean;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Case-insensitive literal matcher. A compiled regex is used instead of lowercasing every
 * cell so that no temporary string is created per cell.
 */
function literal(text: string, anchorStart: boolean, anchorEnd: boolean): CellTest {
  const pattern = new RegExp(`${anchorStart ? '^' : ''}${escapeRegExp(text)}${anchorEnd ? '$' : ''}`, 'iu');
  return (value) => pattern.test(value);
}

function userRegex(source: string): CellTest {
  let pattern: RegExp | null = null;
  // Unicode mode first (emoji, \p{…}); legacy mode for patterns only valid there.
  for (const flags of ['iu', 'i']) {
    try {
      pattern = new RegExp(source, flags);
      break;
    } catch {
      pattern = null;
    }
  }
  // An invalid pattern (typically one that is still being typed) matches nothing.
  if (!pattern) return () => false;
  const compiled = pattern;
  return (value) => compiled.test(value);
}

/** null = the filter is not active (it has no value yet). */
function cellTest(filter: ColumnFilter): CellTest | null {
  if (filter.condition === 'empty') return isBlank;
  if (filter.condition === 'nonEmpty') return (value) => !isBlank(value);
  // A value-based filter without a value is "not filled in yet", not "match nothing":
  // otherwise adding a "does not contain" filter would blank the table before typing.
  if (filter.value === '') return null;
  switch (filter.condition) {
    case 'contains':
      return literal(filter.value, false, false);
    case 'notContains': {
      const contains = literal(filter.value, false, false);
      return (value) => !contains(value);
    }
    case 'equals':
      return literal(filter.value, true, true);
    case 'notEquals': {
      const equals = literal(filter.value, true, true);
      return (value) => !equals(value);
    }
    case 'startsWith':
      return literal(filter.value, true, false);
    case 'endsWith':
      return literal(filter.value, false, true);
    case 'regex':
      return userRegex(filter.value);
    default:
      return null;
  }
}

/** flags[i] === 1 when row i repeats an earlier row (compared on `indexes`, or on every cell). */
function duplicateFlags(data: TableData, indexes: number[] | null): Uint8Array {
  const rows = data.rows;
  const flags = new Uint8Array(rows.length);
  const seen = new Set<string>();
  const scratch = indexes ? new Array<string>(indexes.length) : null;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]!.cells;
    let key: string;
    if (indexes && scratch) {
      for (let i = 0; i < indexes.length; i++) scratch[i] = cells[indexes[i]!] ?? '';
      key = rowKey(scratch);
    } else {
      key = rowKey(cells);
    }
    if (seen.has(key)) flags[r] = 1;
    else seen.add(key);
  }
  return flags;
}

const KIND_NUMBER = 0;
const KIND_TEXT = 1;
const KIND_BLANK = 2;

let collator: Intl.Collator | null = null;

/**
 * Stable sort of `order` by one column. Total order: numbers (numerically) < text
 * (natural, case-insensitive collation) < empty. Descending reverses numbers and text but
 * empty cells stay last. Sort keys are computed once per row, not once per comparison.
 */
function sortByColumn(order: number[], rows: Row[], column: number, descending: boolean): void {
  const kinds = new Uint8Array(rows.length);
  const numbers = new Float64Array(rows.length);
  for (let i = 0; i < order.length; i++) {
    const r = order[i]!;
    const value = rows[r]!.cells[column] ?? '';
    if (isBlank(value)) {
      kinds[r] = KIND_BLANK;
      continue;
    }
    const number = parseNumberStrict(value);
    if (number === null) {
      kinds[r] = KIND_TEXT;
    } else {
      kinds[r] = KIND_NUMBER;
      numbers[r] = number;
    }
  }

  collator ??= new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const compareText = collator.compare;
  const direction = descending ? -1 : 1;
  order.sort((a, b) => {
    const kindA = kinds[a]!;
    const kindB = kinds[b]!;
    if (kindA !== kindB) {
      if (kindA === KIND_BLANK) return 1;
      if (kindB === KIND_BLANK) return -1;
      return direction * (kindA - kindB);
    }
    if (kindA === KIND_BLANK) return 0;
    if (kindA === KIND_NUMBER) {
      const difference = numbers[a]! - numbers[b]!;
      return difference === 0 ? 0 : difference < 0 ? -direction : direction;
    }
    return direction * compareText(rows[a]!.cells[column] ?? '', rows[b]!.cells[column] ?? '');
  });
}

/**
 * Indexes into data.rows, in display order, after applying the search (case-insensitive
 * substring in any cell), the column filters, `duplicatesOnly` and finally a stable sort.
 * Filters that reference a column which no longer exists are ignored.
 */
export function computeView(data: TableData, view: ViewSpec): number[] {
  const { rows, columns } = data;
  const needle = view.search.trim();
  const matchesSearch = needle === '' ? null : literal(needle, false, false);

  const filterColumns: number[] = [];
  const filterTests: CellTest[] = [];
  for (const filter of view.filters) {
    const index = columns.findIndex((column) => column.id === filter.column);
    const test = index < 0 ? null : cellTest(filter);
    if (test) {
      filterColumns.push(index);
      filterTests.push(test);
    }
  }

  // Duplicates are judged against the whole dataset, not just the filtered rows, so the
  // view shows exactly the rows "Remove duplicates" would delete.
  const duplicates = view.duplicatesOnly ? duplicateFlags(data, null) : null;

  const order: number[] = [];
  scan: for (let r = 0; r < rows.length; r++) {
    if (duplicates && duplicates[r] === 0) continue;
    const cells = rows[r]!.cells;
    for (let f = 0; f < filterTests.length; f++) {
      if (!filterTests[f]!(cells[filterColumns[f]!] ?? '')) continue scan;
    }
    if (matchesSearch) {
      let hit = false;
      for (let c = 0; c < cells.length; c++) {
        if (matchesSearch(cells[c]!)) {
          hit = true;
          break;
        }
      }
      if (!hit) continue;
    }
    order.push(r);
  }

  if (view.sort) {
    const sortColumn = view.sort.column;
    const index = columns.findIndex((column) => column.id === sortColumn);
    if (index >= 0) sortByColumn(order, rows, index, view.sort.direction === 'desc');
  }
  return order;
}

/**
 * Ids of rows that duplicate an EARLIER row (the first occurrence is not included).
 * `columnIds` restricts the comparison; omitted, empty or entirely unknown means all columns.
 */
export function findDuplicateRowIds(data: TableData, columnIds?: string[]): Set<number> {
  let indexes: number[] | null = null;
  if (columnIds && columnIds.length > 0) {
    const resolved = new Set<number>();
    for (const id of columnIds) {
      const index = data.columns.findIndex((column) => column.id === id);
      if (index >= 0) resolved.add(index);
    }
    if (resolved.size > 0) indexes = [...resolved];
  }
  const flags = duplicateFlags(data, indexes);
  const ids = new Set<number>();
  for (let r = 0; r < flags.length; r++) {
    if (flags[r] === 1) ids.add(data.rows[r]!.id);
  }
  return ids;
}

export function countEmptyCells(data: TableData): number {
  let count = 0;
  for (let r = 0; r < data.rows.length; r++) {
    const cells = data.rows[r]!.cells;
    for (let c = 0; c < cells.length; c++) {
      if (isBlank(cells[c]!)) count += 1;
    }
  }
  return count;
}
