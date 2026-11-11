// Data-cleaning operations. Every operation is a pure function of (data, op):
//  - the input is never mutated,
//  - rows that do not change keep their object identity (cheap undo history, cheap React
//    re-renders), and when nothing changes the SAME data object is returned,
//  - the summary states what really happened, with real counts.
import type { Column, Row, TableData } from '@/types/data';
import type { CaseMode, TransformOp, TransformResult } from '@/types/transforms';
import { nextRowId, rowKey } from '@/data-processing/dataset';
import { extractAllNumbers, isBlank, parseDateUnambiguous } from '@/data-processing/infer';
import { t, tn } from '@/i18n';
import { uid } from '@/utils/id';
import { collapseWhitespace, uniqueNames } from '@/utils/text';

/** A delimiter that explodes one column into more columns than this is almost certainly a mistake. */
const MAX_SPLIT_COLUMNS = 500;

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

function unchanged(data: TableData, summary: string): TransformResult {
  return { data, changed: 0, summary };
}

/** Two independent outcome sentences, joined in a translatable way. */
function sentences(first: string, second: string): string {
  return second ? t('{first}. {second}', { first, second }) : first;
}

function columnIndex(data: TableData, id: string): number {
  const index = data.columns.findIndex((column) => column.id === id);
  if (index < 0) throw new Error(t('That column no longer exists.'));
  return index;
}

/** Indexes for an optional column list. Omitted or empty means every column. */
function columnIndexes(data: TableData, ids: string[] | undefined): number[] {
  if (!ids || ids.length === 0) return data.columns.map((_, index) => index);
  return [...new Set(ids)].map((id) => columnIndex(data, id));
}

function uniqueName(taken: Iterable<string>, desired: string): string {
  const used = new Set(taken);
  if (!used.has(desired)) return desired;
  let n = 2;
  while (used.has(`${desired} (${n})`)) n += 1;
  return `${desired} (${n})`;
}

/** Apply `fn` to the given columns of every row, copying only the rows that change. */
function mapCells(
  data: TableData,
  columns: number[],
  fn: (value: string) => string,
): { data: TableData; changed: number } {
  let changed = 0;
  let rows: Row[] | null = null;
  for (let r = 0; r < data.rows.length; r++) {
    const row = data.rows[r]!;
    let cells: string[] | null = null;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i]!;
      const before = row.cells[c] ?? '';
      const after = fn(before);
      if (after !== before) {
        cells ??= row.cells.slice();
        cells[c] = after;
        changed += 1;
      }
    }
    if (cells) {
      rows ??= data.rows.slice();
      rows[r] = { id: row.id, cells };
    }
  }
  return rows ? { data: { columns: data.columns, rows }, changed } : { data, changed: 0 };
}

function withoutColumns(data: TableData, remove: Set<number>): TableData {
  return {
    columns: data.columns.filter((_, index) => !remove.has(index)),
    rows: data.rows.map((row) => ({ id: row.id, cells: row.cells.filter((_, index) => !remove.has(index)) })),
  };
}

function withColumnInserted(data: TableData, at: number, name: string, values: string[]): TableData {
  const column: Column = { id: uid('c'), name: uniqueName(data.columns.map((c) => c.name), name) };
  const columns = data.columns.slice();
  columns.splice(at, 0, column);
  const rows = data.rows.map((row, index) => {
    const cells = row.cells.slice();
    cells.splice(at, 0, values[index] ?? '');
    return { id: row.id, cells };
  });
  return { columns, rows };
}

// ---------------------------------------------------------------------------------------
// Whitespace and case
// ---------------------------------------------------------------------------------------

/** Whitespace as a human sees it at the edge of a cell: spaces, NBSP, BOM and zero-width characters. */
function isEdgeChar(code: number): boolean {
  return (
    code === 0x20 ||
    (code >= 0x09 && code <= 0x0d) ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200d) || // spaces, zero-width space, ZWNJ, ZWJ
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x2060 ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

function trimEdges(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && isEdgeChar(value.charCodeAt(start))) start += 1;
  while (end > start && isEdgeChar(value.charCodeAt(end - 1))) end -= 1;
  return start === 0 && end === value.length ? value : value.slice(start, end);
}

// Zero-width joiners INSIDE a value are meaningful (Bengali conjuncts, emoji sequences),
// so only real whitespace is collapsed; the invisible characters are removed at the edges.
function normalizeSpaces(value: string): string {
  return trimEdges(value.replace(/\s+/g, ' '));
}

// A word starts with a letter or digit ("3rd" must not become "3Rd") and may contain
// combining marks and apostrophes ("o'neil" → "O'neil").
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’]*/gu;
const SENTENCE_START = /(^|[.!?…।]\s+|[\r\n]+)([^\p{L}\p{N}]*)(\p{L})/gu;

function changeCase(value: string, mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return value.toLocaleUpperCase();
    case 'lower':
      return value.toLocaleLowerCase();
    case 'title':
      return value.replace(WORD, (word) => {
        const first = String.fromCodePoint(word.codePointAt(0) ?? 0);
        return first.toLocaleUpperCase() + word.slice(first.length).toLocaleLowerCase();
      });
    case 'sentence':
      return value
        .toLocaleLowerCase()
        .replace(
          SENTENCE_START,
          (_match, boundary: string, lead: string, letter: string) => boundary + lead + letter.toLocaleUpperCase(),
        );
  }
}

// ---------------------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------------------

const HTTP_PREFIX = /^https?:\/\//i;
const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// scheme, authority, path, query, fragment
const URL_PARTS = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;
const AUTHORITY = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/;
// Only values that are unmistakably relative URLs are resolved; "N/A" or "24/7" must stay text.
const RELATIVE_PREFIX = /^(?:\/|\.\.?\/|\?|#)/;
const RELATIVE_FILE =
  /^[\w\-.~%]+(?:\/[\w\-.~%]+)*\.(?:html?|php|aspx?|jspx?|pdf|png|jpe?g|gif|webp|avif|svg)(?:[?#]\S*)?$/i;
const TRACKING_PARAM = /^(?:utm_.*|fbclid|gclid|dclid|gbraid|wbraid|mc_eid|mc_cid|msclkid|igshid|yclid)$/i;
const DEFAULT_PORT: Record<string, number> = { http: 80, https: 443 };

function normalizeAuthority(authority: string, scheme: string): string | null {
  const at = authority.lastIndexOf('@');
  const userinfo = authority.slice(0, at + 1);
  const match = AUTHORITY.exec(authority.slice(at + 1));
  if (!match || !match[1]) return null;
  const host = match[1].toLowerCase();
  const port = match[2] ?? '';
  const keepPort = port !== '' && Number(port) !== DEFAULT_PORT[scheme];
  return userinfo + host + (keepPort ? `:${port}` : '');
}

function stripTrackingParams(query: string): string {
  const kept = query
    .slice(1)
    .split('&')
    .filter((pair) => {
      const rawKey = pair.split('=', 1)[0] ?? '';
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '));
      } catch {
        // Malformed escape: compare the raw key.
      }
      return !TRACKING_PARAM.test(key);
    });
  return kept.length > 0 ? `?${kept.join('&')}` : '';
}

/**
 * Lowercase scheme + host, drop the default port, optionally strip tracking parameters and
 * the fragment. Works on the text of the URL instead of re-serialising it through `URL`,
 * so the path and query stay exactly as written (readable Bengali slugs are not turned
 * into percent-escapes, and nothing else is "corrected"). Anything that is not clearly an
 * http(s) URL is returned untouched.
 */
function normalizeUrl(value: string, base: string | null, stripTracking: boolean, stripHash: boolean): string {
  const text = trimEdges(value);
  if (text === '' || /\s/.test(text)) return value;

  let absolute = text;
  try {
    if (HTTP_PREFIX.test(text)) {
      new URL(text); // validity check only
    } else {
      // mailto:, tel:, javascript:, data:… are not ours to touch; relative needs a base.
      if (ANY_SCHEME.test(text) || base === null) return value;
      if (!RELATIVE_PREFIX.test(text) && !RELATIVE_FILE.test(text)) return value;
      absolute = new URL(text, base).href;
    }
  } catch {
    return value;
  }

  const parts = URL_PARTS.exec(absolute);
  if (!parts) return value;
  const scheme = (parts[1] ?? '').toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') return value;
  const authority = normalizeAuthority(parts[2] ?? '', scheme);
  if (authority === null) return value;
  const path = parts[3] || '/';
  const query = stripTracking && parts[4] ? stripTrackingParams(parts[4]) : (parts[4] ?? '');
  const hash = stripHash ? '' : (parts[5] ?? '');
  return `${scheme}://${authority}${path}${query}${hash}`;
}

function validBase(baseUrl: string | undefined): string | null {
  if (!baseUrl) return null;
  try {
    const url = new URL(baseUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------
// Find & replace
// ---------------------------------------------------------------------------------------

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a user-supplied pattern. Unicode mode first (correct emoji / astral handling,
 * \p{…}); patterns that are only valid in legacy mode (e.g. `\-`) fall back to it.
 */
function compileUserRegex(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, `${flags}u`);
  } catch {
    // fall through to legacy mode
  }
  try {
    return new RegExp(source, flags);
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Engines prefix the message with the whole pattern; keep only the reason.
    const reason = raw.slice(raw.lastIndexOf(': ') + 2) || raw;
    throw new Error(t('Invalid regular expression: {reason}', { reason }));
  }
}

function buildReplacer(op: Extract<TransformOp, { type: 'findReplace' }>, onMatch: () => void): (value: string) => string {
  const { find, replace } = op;
  if (find === '') throw new Error(t('Enter the text to find.'));

  if (op.regex) {
    compileUserRegex(find, ''); // report syntax errors against the pattern as typed
    const source = op.wholeCell ? `^(?:${find})$` : find;
    const pattern = compileUserRegex(source, op.caseSensitive ? 'g' : 'gi');
    return (value) => {
      pattern.lastIndex = 0;
      if (!pattern.test(value)) return value;
      onMatch();
      pattern.lastIndex = 0;
      return value.replace(pattern, replace); // $1, $& … work as in JavaScript
    };
  }

  if (op.wholeCell) {
    if (op.caseSensitive) {
      return (value) => {
        if (value !== find) return value;
        onMatch();
        return replace;
      };
    }
    const whole = new RegExp(`^${escapeRegExp(find)}$`, 'iu');
    return (value) => {
      if (!whole.test(value)) return value;
      onMatch();
      return replace;
    };
  }

  if (op.caseSensitive) {
    return (value) => {
      if (!value.includes(find)) return value;
      onMatch();
      return value.split(find).join(replace);
    };
  }

  const pattern = new RegExp(escapeRegExp(find), 'giu');
  return (value) => {
    pattern.lastIndex = 0;
    if (!pattern.test(value)) return value;
    onMatch();
    // Function replacer: the replacement is literal text, "$1" must not be interpreted.
    return value.replace(pattern, () => replace);
  };
}

// ---------------------------------------------------------------------------------------
// Derived columns (numbers, dates)
// ---------------------------------------------------------------------------------------

interface DeriveResult {
  data: TableData;
  /** Cells rewritten (replace) or filled in the new column (new). */
  converted: number;
  /** Non-empty cells for which nothing could be derived. */
  missed: number;
}

/**
 * Shared engine for "extract numbers" and "parse dates". `derive` returns null when the
 * cell has nothing to offer: such cells are LEFT UNCHANGED when replacing in place (never
 * destroy what we cannot interpret) and become '' in a new column.
 */
function deriveColumn(
  data: TableData,
  index: number,
  target: 'replace' | 'new',
  suffix: string,
  derive: (value: string) => string | null,
): DeriveResult {
  let missed = 0;
  if (target === 'replace') {
    const result = mapCells(data, [index], (value) => {
      if (isBlank(value)) return value;
      const derived = derive(value);
      if (derived === null) {
        missed += 1;
        return value;
      }
      return derived;
    });
    return { data: result.data, converted: result.changed, missed };
  }

  let converted = 0;
  const values = data.rows.map((row) => {
    const value = row.cells[index] ?? '';
    if (isBlank(value)) return '';
    const derived = derive(value);
    if (derived === null) {
      missed += 1;
      return '';
    }
    converted += 1;
    return derived;
  });
  // A column with nothing in it would only be clutter: report it instead of adding it.
  if (converted === 0) return { data, converted, missed };
  const name = `${data.columns[index]!.name} (${suffix})`;
  return { data: withColumnInserted(data, index + 1, name, values), converted, missed };
}

// ---------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------

function removeRowsWhere(data: TableData, shouldRemove: (row: Row, index: number) => boolean): { data: TableData; removed: number } {
  const rows: Row[] = [];
  for (let i = 0; i < data.rows.length; i++) {
    const row = data.rows[i]!;
    if (!shouldRemove(row, i)) rows.push(row);
  }
  const removed = data.rows.length - rows.length;
  return removed === 0 ? { data, removed } : { data: { columns: data.columns, rows }, removed };
}

function isBlankRow(row: Row): boolean {
  for (let i = 0; i < row.cells.length; i++) {
    if (!isBlank(row.cells[i]!)) return false;
  }
  return true;
}

function removeDuplicates(data: TableData, columns: string[] | undefined): TransformResult {
  const indexes = columns && columns.length > 0 ? columnIndexes(data, columns) : null;
  const seen = new Set<string>();
  const scratch = indexes ? new Array<string>(indexes.length) : null;
  const { data: next, removed } = removeRowsWhere(data, (row) => {
    let key: string;
    if (indexes && scratch) {
      for (let i = 0; i < indexes.length; i++) scratch[i] = row.cells[indexes[i]!] ?? '';
      key = rowKey(scratch);
    } else {
      key = rowKey(row.cells);
    }
    if (seen.has(key)) return true;
    seen.add(key);
    return false;
  });
  if (removed === 0) return unchanged(data, t('No duplicate rows found'));
  return {
    data: next,
    changed: removed,
    summary: tn(removed, 'Removed {count} duplicate row', 'Removed {count} duplicate rows'),
  };
}

function removeEmptyColumns(data: TableData): TransformResult {
  // With no rows every column is trivially "empty"; deleting the whole header would be absurd.
  if (data.rows.length === 0) return unchanged(data, t('No empty columns found'));
  const empty = new Set<number>();
  for (let c = 0; c < data.columns.length; c++) {
    let blank = true;
    for (let r = 0; r < data.rows.length; r++) {
      if (!isBlank(data.rows[r]!.cells[c] ?? '')) {
        blank = false;
        break;
      }
    }
    if (blank) empty.add(c);
  }
  if (empty.size === 0) return unchanged(data, t('No empty columns found'));
  return {
    data: withoutColumns(data, empty),
    changed: empty.size,
    summary: tn(empty.size, 'Removed {count} empty column', 'Removed {count} empty columns'),
  };
}

function extractNumbers(data: TableData, op: Extract<TransformOp, { type: 'extractNumbers' }>): TransformResult {
  const index = columnIndex(data, op.column);
  const name = data.columns[index]!.name;
  const derive = (value: string): string | null => {
    const numbers = extractAllNumbers(value);
    if (numbers.length === 0) return null;
    return op.mode === 'first' ? numbers[0]! : numbers.join(' ');
  };
  const result = deriveColumn(data, index, op.target, t('number'), derive);
  const { converted, missed } = result;

  if (op.target === 'new') {
    if (converted === 0) return unchanged(data, t('No numbers found in "{name}"', { name }));
    const main = tn(
      converted,
      'Extracted a number from {count} cell into a new column',
      'Extracted numbers from {count} cells into a new column',
    );
    const rest =
      missed > 0
        ? tn(missed, '{count} cell without a number was left empty', '{count} cells without a number were left empty')
        : '';
    return { data: result.data, changed: converted, summary: sentences(main, rest) };
  }

  const rest =
    missed > 0
      ? tn(missed, '{count} cell without a number was left unchanged', '{count} cells without a number were left unchanged')
      : '';
  if (converted === 0) {
    const main = missed > 0 ? t('No numbers found in "{name}"', { name }) : t('No cells needed changes');
    return unchanged(data, sentences(main, rest));
  }
  const main = tn(converted, 'Extracted the number in {count} cell', 'Extracted the numbers in {count} cells');
  return { data: result.data, changed: converted, summary: sentences(main, rest) };
}

function parseDates(data: TableData, op: Extract<TransformOp, { type: 'parseDates' }>): TransformResult {
  const index = columnIndex(data, op.column);
  const name = data.columns[index]!.name;
  const result = deriveColumn(data, index, op.target, t('date'), parseDateUnambiguous);
  const { converted, missed } = result;
  let rest = '';
  if (missed > 0) {
    rest =
      op.target === 'new'
        ? tn(
            missed,
            '{count} cell is not an unambiguous date and was left empty',
            '{count} cells are not unambiguous dates and were left empty',
          )
        : tn(
            missed,
            '{count} cell is not an unambiguous date and was left unchanged',
            '{count} cells are not unambiguous dates and were left unchanged',
          );
  }

  if (converted === 0) {
    const main =
      missed > 0 || op.target === 'new'
        ? t('No unambiguous dates found in "{name}"', { name })
        : t('No cells needed changes');
    return unchanged(data, sentences(main, rest));
  }
  const main =
    op.target === 'new'
      ? tn(converted, 'Converted {count} date into a new column', 'Converted {count} dates into a new column')
      : tn(converted, 'Converted {count} date to ISO format', 'Converted {count} dates to ISO format');
  return { data: result.data, changed: converted, summary: sentences(main, rest) };
}

function splitColumn(data: TableData, op: Extract<TransformOp, { type: 'splitColumn' }>): TransformResult {
  // "\t" and "\n" typed literally in a text field mean tab and newline.
  const delimiter = op.delimiter.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  if (delimiter === '') throw new Error(t('Enter a delimiter to split by.'));
  const index = columnIndex(data, op.column);
  const name = data.columns[index]!.name;

  let width = 1;
  const pieces = data.rows.map((row) => {
    const parts = (row.cells[index] ?? '').split(delimiter);
    if (parts.length > width) width = parts.length;
    return parts;
  });
  if (width === 1) return unchanged(data, t('The delimiter does not occur in "{name}"; nothing was split', { name }));
  if (width > MAX_SPLIT_COLUMNS) {
    throw new Error(
      t('Splitting "{name}" would create {count} columns (the limit is {max}). Choose a different delimiter.', {
        name,
        count: width,
        max: MAX_SPLIT_COLUMNS,
      }),
    );
  }

  const taken = new Set(data.columns.map((column) => column.name));
  if (!op.keepOriginal) taken.delete(name);
  const added: Column[] = [];
  for (let i = 1; i <= width; i++) {
    const unique = uniqueName(taken, `${name} ${i}`);
    taken.add(unique);
    added.push({ id: uid('c'), name: unique });
  }

  const keep = op.keepOriginal ? index + 1 : index;
  const columns = [...data.columns.slice(0, keep), ...added, ...data.columns.slice(index + 1)];
  const rows = data.rows.map((row, r) => {
    const parts = pieces[r]!;
    const cells = row.cells.slice(0, keep);
    for (let i = 0; i < width; i++) cells.push(parts[i] ?? '');
    for (let i = index + 1; i < row.cells.length; i++) cells.push(row.cells[i]!);
    return { id: row.id, cells };
  });
  return {
    data: { columns, rows },
    changed: width,
    summary: t('Split "{name}" into {count} columns', { name, count: width }),
  };
}

function combineColumns(data: TableData, op: Extract<TransformOp, { type: 'combineColumns' }>): TransformResult {
  const sources = columnIndexes(data, op.columns);
  if (op.columns.length === 0 || sources.length < 2) throw new Error(t('Select at least two columns to combine.'));
  const sourceSet = new Set(sources);
  const anchor = sources[0]!;
  const remaining = data.columns.filter((_, index) => !op.removeSources || !sourceSet.has(index));
  const wanted = collapseWhitespace(op.name) || sources.map((index) => data.columns[index]!.name).join(' + ');
  const combined: Column = { id: uid('c'), name: uniqueName(remaining.map((column) => column.name), wanted) };

  const columns: Column[] = [];
  data.columns.forEach((column, index) => {
    if (index === anchor) columns.push(combined);
    if (!op.removeSources || !sourceSet.has(index)) columns.push(column);
  });

  const parts: string[] = [];
  const rows = data.rows.map((row) => {
    parts.length = 0;
    for (const index of sources) {
      const value = row.cells[index] ?? '';
      if (!isBlank(value)) parts.push(value);
    }
    const joined = parts.join(op.separator);
    const cells: string[] = [];
    for (let index = 0; index < row.cells.length; index++) {
      if (index === anchor) cells.push(joined);
      if (!op.removeSources || !sourceSet.has(index)) cells.push(row.cells[index]!);
    }
    return { id: row.id, cells };
  });

  return {
    data: { columns, rows },
    changed: 1 + (op.removeSources ? sources.length : 0),
    summary: t('Combined {count} columns into "{name}"', { count: sources.length, name: combined.name }),
  };
}

function renameColumn(data: TableData, op: Extract<TransformOp, { type: 'renameColumn' }>): TransformResult {
  const index = columnIndex(data, op.column);
  const wanted = collapseWhitespace(op.name);
  if (wanted === '') throw new Error(t('Enter a column name.'));
  const current = data.columns[index]!;
  if (wanted === current.name) return unchanged(data, t('The column already has that name'));
  const others = data.columns.filter((_, i) => i !== index).map((column) => column.name);
  const name = uniqueName(others, wanted);
  const columns = data.columns.slice();
  columns[index] = { id: current.id, name };
  return {
    data: { columns, rows: data.rows },
    changed: 1,
    summary: t('Renamed "{from}" to "{to}"', { from: current.name, to: name }),
  };
}

function moveColumn(data: TableData, op: Extract<TransformOp, { type: 'moveColumn' }>): TransformResult {
  const from = columnIndex(data, op.column);
  if (!Number.isFinite(op.toIndex)) throw new Error(t('Invalid column position.'));
  const to = Math.max(0, Math.min(data.columns.length - 1, Math.trunc(op.toIndex)));
  const name = data.columns[from]!.name;
  if (from === to) return unchanged(data, t('"{name}" is already in that position', { name }));
  const move = <T>(items: T[]): T[] => {
    const copy = items.slice();
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item as T);
    return copy;
  };
  return {
    data: { columns: move(data.columns), rows: data.rows.map((row) => ({ id: row.id, cells: move(row.cells) })) },
    changed: 1,
    summary: t('Moved "{name}" to position {position}', { name, position: to + 1 }),
  };
}

function editCell(data: TableData, op: Extract<TransformOp, { type: 'editCell' }>): TransformResult {
  const index = columnIndex(data, op.column);
  const at = data.rows.findIndex((row) => row.id === op.rowId);
  if (at < 0) throw new Error(t('That row no longer exists.'));
  const row = data.rows[at]!;
  if ((row.cells[index] ?? '') === op.value) return unchanged(data, t('The cell already has that value'));
  const cells = row.cells.slice();
  cells[index] = op.value;
  const rows = data.rows.slice();
  rows[at] = { id: row.id, cells };
  return { data: { columns: data.columns, rows }, changed: 1, summary: t('Edited 1 cell') };
}

function promoteHeader(data: TableData): TransformResult {
  const first = data.rows[0];
  if (!first || data.columns.length === 0) return unchanged(data, t('There is no row to use as the header'));
  const names = uniqueNames(data.columns.map((_, index) => first.cells[index] ?? ''));
  return {
    data: {
      columns: data.columns.map((column, index) => ({ id: column.id, name: names[index]! })),
      rows: data.rows.slice(1),
    },
    changed: 1,
    summary: t('Used the first row as the header'),
  };
}

function demoteHeader(data: TableData): TransformResult {
  if (data.columns.length === 0) return unchanged(data, t('There are no columns'));
  const headerRow: Row = { id: nextRowId(data), cells: data.columns.map((column) => column.name) };
  const names = uniqueNames(data.columns.map(() => ''));
  return {
    data: {
      columns: data.columns.map((column, index) => ({ id: column.id, name: names[index]! })),
      rows: [headerRow].concat(data.rows),
    },
    changed: 1,
    summary: t('Moved the header into the first row'),
  };
}

function extractRegex(data: TableData, op: Extract<TransformOp, { type: 'extractRegex' }>): TransformResult {
  if (op.pattern === '') throw new Error(t('Enter a pattern to look for.'));
  const index = columnIndex(data, op.column);
  const name = data.columns[index]!.name;
  const regex = compileUserRegex(op.pattern, op.caseSensitive ? '' : 'i');
  const result = deriveColumn(data, index, op.target, t('match'), (value) => {
    const match = regex.exec(value);
    if (!match) return null;
    // With a capture group the group is the result; otherwise the whole match.
    return match[1] ?? match[0];
  });
  const { converted, missed } = result;
  const rest =
    missed > 0
      ? op.target === 'new'
        ? tn(missed, '{count} cell without a match was left empty', '{count} cells without a match were left empty')
        : tn(missed, '{count} cell without a match was left unchanged', '{count} cells without a match were left unchanged')
      : '';
  if (converted === 0) return unchanged(data, sentences(t('The pattern matched nothing in "{name}"', { name }), rest));
  const main = tn(converted, 'Extracted the match from {count} cell', 'Extracted the match from {count} cells');
  return { data: result.data, changed: converted, summary: sentences(main, rest) };
}

function fillDown(data: TableData, columns: string[] | undefined): TransformResult {
  const indexes = columnIndexes(data, columns);
  const last = new Map<number, string>();
  let changed = 0;
  let rows: Row[] | null = null;
  for (let r = 0; r < data.rows.length; r++) {
    const row = data.rows[r]!;
    let cells: string[] | null = null;
    for (const c of indexes) {
      const value = row.cells[c] ?? '';
      if (!isBlank(value)) {
        last.set(c, value);
      } else if (last.has(c)) {
        cells ??= row.cells.slice();
        cells[c] = last.get(c)!;
        changed += 1;
      }
    }
    if (cells) {
      rows ??= data.rows.slice();
      rows[r] = { id: row.id, cells };
    }
  }
  if (!rows) return unchanged(data, t('No empty cells had a value above them'));
  return { data: { columns: data.columns, rows }, changed, summary: tn(changed, 'Filled {count} empty cell from the row above', 'Filled {count} empty cells from the rows above') };
}

function addColumn(data: TableData, op: Extract<TransformOp, { type: 'addColumn' }>): TransformResult {
  const name = collapseWhitespace(op.name);
  if (!name) throw new Error(t('Give the new column a name.'));
  const values = data.rows.map((_, index) => (op.fill === 'rowNumber' ? String(index + 1) : op.fill === 'value' ? (op.value ?? '') : ''));
  return { data: withColumnInserted(data, data.columns.length, name, values), changed: 1, summary: t('Added the column "{name}"', { name }) };
}

function addRow(data: TableData): TransformResult {
  if (data.columns.length === 0) throw new Error(t('Add a column first.'));
  const row: Row = { id: nextRowId(data), cells: data.columns.map(() => '') };
  return { data: { columns: data.columns, rows: data.rows.concat([row]) }, changed: 1, summary: t('Added an empty row at the end') };
}

/**
 * Apply one cleaning operation. Throws an Error with a user-presentable message for
 * invalid input (unknown column, empty search text, invalid regular expression, …).
 */
export function applyTransform(data: TableData, op: TransformOp): TransformResult {
  switch (op.type) {
    case 'trim': {
      const result = mapCells(data, columnIndexes(data, op.columns), trimEdges);
      if (result.changed === 0) return unchanged(data, t('No cells needed trimming'));
      return { ...result, summary: tn(result.changed, 'Trimmed {count} cell', 'Trimmed {count} cells') };
    }

    case 'normalizeWhitespace': {
      const result = mapCells(data, columnIndexes(data, op.columns), normalizeSpaces);
      if (result.changed === 0) return unchanged(data, t('Whitespace is already clean'));
      return {
        ...result,
        summary: tn(result.changed, 'Cleaned up whitespace in {count} cell', 'Cleaned up whitespace in {count} cells'),
      };
    }

    case 'removeEmptyRows': {
      const { data: next, removed } = removeRowsWhere(data, isBlankRow);
      if (removed === 0) return unchanged(data, t('No empty rows found'));
      return { data: next, changed: removed, summary: tn(removed, 'Removed {count} empty row', 'Removed {count} empty rows') };
    }

    case 'removeEmptyColumns':
      return removeEmptyColumns(data);

    case 'removeDuplicates':
      return removeDuplicates(data, op.columns);

    case 'convertCase': {
      const mode = op.mode;
      const result = mapCells(data, columnIndexes(data, op.columns), (value) => changeCase(value, mode));
      if (result.changed === 0) return unchanged(data, t('No cells needed a case change'));
      return { ...result, summary: tn(result.changed, 'Changed the case of {count} cell', 'Changed the case of {count} cells') };
    }

    case 'extractNumbers':
      return extractNumbers(data, op);

    case 'parseDates':
      return parseDates(data, op);

    case 'normalizeUrls': {
      const base = validBase(op.baseUrl);
      const result = mapCells(data, [columnIndex(data, op.column)], (value) =>
        normalizeUrl(value, base, op.stripTracking, op.stripHash),
      );
      if (result.changed === 0) return unchanged(data, t('No URLs needed changes'));
      return { ...result, summary: tn(result.changed, 'Normalized {count} URL', 'Normalized {count} URLs') };
    }

    case 'findReplace': {
      let matched = 0;
      const replacer = buildReplacer(op, () => {
        matched += 1;
      });
      const result = mapCells(data, columnIndexes(data, op.columns), replacer);
      if (result.changed === 0) {
        return unchanged(
          data,
          matched === 0
            ? t('No matches found')
            : tn(
                matched,
                '{count} cell matched, but the replacement is identical; nothing changed',
                '{count} cells matched, but the replacement is identical; nothing changed',
              ),
        );
      }
      return { ...result, summary: tn(result.changed, 'Replaced text in {count} cell', 'Replaced text in {count} cells') };
    }

    case 'splitColumn':
      return splitColumn(data, op);

    case 'combineColumns':
      return combineColumns(data, op);

    case 'keepRows': {
      const index = columnIndex(data, op.column);
      const wantEmpty = op.condition === 'empty';
      const { data: next, removed } = removeRowsWhere(data, (row) => isBlank(row.cells[index] ?? '') !== wantEmpty);
      if (removed === 0) return unchanged(data, t('Every row already matches; nothing was removed'));
      return {
        data: next,
        changed: removed,
        summary: tn(removed, 'Removed {count} row, kept {kept}', 'Removed {count} rows, kept {kept}', {
          kept: next.rows.length,
        }),
      };
    }

    case 'removeRows': {
      const ids = new Set(op.rowIds);
      const { data: next, removed } = removeRowsWhere(data, (row) => ids.has(row.id));
      if (removed === 0) return unchanged(data, t('No matching rows to remove'));
      return { data: next, changed: removed, summary: tn(removed, 'Removed {count} row', 'Removed {count} rows') };
    }

    case 'removeColumns': {
      // Removing something that is already gone is not an error, just a no-op.
      const ids = new Set(op.columns);
      const remove = new Set<number>();
      data.columns.forEach((column, index) => {
        if (ids.has(column.id)) remove.add(index);
      });
      if (remove.size === 0) return unchanged(data, t('No matching columns to remove'));
      return {
        data: withoutColumns(data, remove),
        changed: remove.size,
        summary: tn(remove.size, 'Removed {count} column', 'Removed {count} columns'),
      };
    }

    case 'renameColumn':
      return renameColumn(data, op);

    case 'moveColumn':
      return moveColumn(data, op);

    case 'editCell':
      return editCell(data, op);

    case 'promoteHeader':
      return promoteHeader(data);

    case 'demoteHeader':
      return demoteHeader(data);

    case 'extractRegex':
      return extractRegex(data, op);

    case 'fillDown':
      return fillDown(data, op.columns);

    case 'addColumn':
      return addColumn(data, op);

    case 'addRow':
      return addRow(data);

    default: {
      const unknown: never = op;
      throw new Error(t('Unknown operation: {type}', { type: String((unknown as { type?: unknown }).type) }));
    }
  }
}

function describeCase(mode: CaseMode): string {
  switch (mode) {
    case 'upper':
      return t('Convert to UPPERCASE');
    case 'lower':
      return t('Convert to lowercase');
    case 'title':
      return t('Convert to Title Case');
    case 'sentence':
      return t('Convert to Sentence case');
  }
}

/** Short label for the history / undo UI. */
export function describeOp(op: TransformOp): string {
  switch (op.type) {
    case 'trim':
      return t('Trim whitespace');
    case 'normalizeWhitespace':
      return t('Clean up whitespace');
    case 'removeEmptyRows':
      return t('Remove empty rows');
    case 'removeEmptyColumns':
      return t('Remove empty columns');
    case 'removeDuplicates':
      return t('Remove duplicates');
    case 'convertCase':
      return describeCase(op.mode);
    case 'extractNumbers':
      return t('Extract numbers');
    case 'parseDates':
      return t('Convert dates to ISO');
    case 'normalizeUrls':
      return t('Normalize URLs');
    case 'findReplace':
      return t('Find and replace');
    case 'splitColumn':
      return t('Split column');
    case 'combineColumns':
      return t('Combine columns');
    case 'keepRows':
      return op.condition === 'empty' ? t('Keep rows with an empty value') : t('Keep rows with a value');
    case 'removeRows':
      return tn(op.rowIds.length, 'Delete {count} row', 'Delete {count} rows');
    case 'removeColumns':
      return tn(op.columns.length, 'Delete {count} column', 'Delete {count} columns');
    case 'renameColumn':
      return t('Rename column');
    case 'moveColumn':
      return t('Move column');
    case 'editCell':
      return t('Edit cell');
    case 'promoteHeader':
      return t('Use first row as header');
    case 'demoteHeader':
      return t('Move header to first row');
    case 'extractRegex':
      return t('Extract by pattern');
    case 'fillDown':
      return t('Fill down');
    case 'addColumn':
      return t('Add column');
    case 'addRow':
      return t('Add row');
  }
}
