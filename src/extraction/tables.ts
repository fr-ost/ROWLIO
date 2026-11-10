// HTML table extraction.
//
// Handles: multiple tables, thead/tbody/tfoot, multi-row headers, rowspan / colspan
// (including rowspan=0), ragged rows, nested tables, hidden rows / columns, captions,
// ARIA grids built from divs, tables in open shadow roots and same-origin iframes.
// Nothing is discarded silently: anything unusual is reported through `warnings`.
import type { RawDataset, TableOptions, TableSummary } from '@/types';
import { t } from '@/i18n';
import { uniqueNames, collapseWhitespace } from '@/utils/text';
import type { Pacer } from '@/utils/async';
import {
  collectRoots,
  elementText,
  inlineText,
  isHiddenDeep,
  isOwnOverlay,
  isSelfHidden,
  scrollableAncestor,
  tagOf,
  type RootLocation,
} from './dom';

export interface TableHandle {
  element: Element;
  kind: 'table' | 'aria-grid';
  location: RootLocation;
}

interface CellModel {
  el: Element;
  isHeader: boolean;
  rowSpan: number;
  colSpan: number;
}

interface RowModel {
  el: Element;
  section: 'head' | 'body' | 'foot';
  /** Index of the last row of this row's section (rowspan never crosses sections). */
  sectionEnd: number;
  cells: CellModel[];
}

const ARIA_GRID_SELECTOR = '[role="table"], [role="grid"], [role="treegrid"]';
const ARIA_CELL_ROLES = new Set(['cell', 'gridcell', 'columnheader', 'rowheader']);
const MAX_COLSPAN = 1000;
const MAX_ROWSPAN = 65534;
/** Tables up to this many rows are measured exactly when listing; larger ones are sampled. */
const EXACT_COUNT_LIMIT = 5000;

/** Every table-like element on the page, in a stable order. */
export function collectTables(doc: Document): TableHandle[] {
  const handles: TableHandle[] = [];
  for (const { root, location } of collectRoots(doc)) {
    const found = root.querySelectorAll(`table, ${ARIA_GRID_SELECTOR}`);
    for (let i = 0; i < found.length; i++) {
      const el = found[i];
      if (isOwnOverlay(el)) continue;
      if (tagOf(el) === 'TABLE') {
        handles.push({ element: el, kind: 'table', location });
      } else if (el.querySelector('[role="row"]')) {
        handles.push({ element: el, kind: 'aria-grid', location });
      }
    }
  }
  return handles;
}

function intAttr(el: Element, name: string, fallback: number): number {
  const raw = el.getAttribute(name);
  if (raw === null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function nativeRows(table: HTMLTableElement): RowModel[] {
  const rows: RowModel[] = [];
  const list = table.rows;
  for (let i = 0; i < list.length; i++) {
    const tr = list[i];
    const parentTag = tr.parentElement ? tagOf(tr.parentElement) : '';
    const section = parentTag === 'THEAD' ? 'head' : parentTag === 'TFOOT' ? 'foot' : 'body';
    const cells: CellModel[] = [];
    const trCells = tr.cells;
    for (let c = 0; c < trCells.length; c++) {
      const cell = trCells[c];
      cells.push({
        el: cell,
        isHeader: tagOf(cell) === 'TH',
        rowSpan: intAttr(cell, 'rowspan', 1),
        colSpan: intAttr(cell, 'colspan', 1),
      });
    }
    rows.push({ el: tr, section, sectionEnd: 0, cells });
  }
  return rows;
}

function ariaRows(grid: Element): RowModel[] {
  const rows: RowModel[] = [];
  const rowEls = grid.querySelectorAll('[role="row"]');
  for (let i = 0; i < rowEls.length; i++) {
    const rowEl = rowEls[i];
    // Skip rows that belong to a grid nested inside this one.
    if (rowEl.closest(`table, ${ARIA_GRID_SELECTOR}`) !== grid) continue;
    const cells: CellModel[] = [];
    const candidates = rowEl.querySelectorAll('[role]');
    for (let c = 0; c < candidates.length; c++) {
      const cellEl = candidates[c];
      const role = cellEl.getAttribute('role') ?? '';
      if (!ARIA_CELL_ROLES.has(role)) continue;
      if (cellEl.closest('[role="row"]') !== rowEl) continue;
      cells.push({
        el: cellEl,
        isHeader: role === 'columnheader',
        rowSpan: intAttr(cellEl, 'aria-rowspan', 1),
        colSpan: intAttr(cellEl, 'aria-colspan', 1),
      });
    }
    const allHeaders = cells.length > 0 && cells.every((cell) => cell.isHeader);
    rows.push({ el: rowEl, section: allHeaders ? 'head' : 'body', sectionEnd: 0, cells });
  }
  return rows;
}

function modelRows(handle: TableHandle): RowModel[] {
  const rows = handle.kind === 'table' ? nativeRows(handle.element as HTMLTableElement) : ariaRows(handle.element);
  // Compute section boundaries (consecutive rows of the same section).
  let start = 0;
  for (let i = 1; i <= rows.length; i++) {
    if (i === rows.length || rows[i].section !== rows[start].section || rows[i].el.parentElement !== rows[start].el.parentElement) {
      for (let j = start; j < i; j++) rows[j].sectionEnd = i - 1;
      start = i;
    }
  }
  return rows;
}

function isRowHidden(row: RowModel, tableEl: Element): boolean {
  if (isSelfHidden(row.el)) return true;
  // A hidden <thead>/<tbody>/row group hides all of its rows.
  for (let parent = row.el.parentElement; parent && parent !== tableEl; parent = parent.parentElement) {
    if (isSelfHidden(parent)) return true;
  }
  return false;
}

interface Grid {
  /** text[r][c]; undefined = no cell covers this slot. */
  text: (string | undefined)[][];
  /** True where the slot is the top-left origin of a cell (not a span continuation). */
  origin: boolean[][];
  cellHidden: boolean[][];
  rowHidden: boolean[];
  rows: RowModel[];
  width: number;
  ragged: boolean;
  nestedTables: number;
}

async function buildGrid(
  handle: TableHandle,
  options: TableOptions,
  pacer: Pacer | undefined,
  maxRows: number,
): Promise<Grid> {
  const rows = modelRows(handle);
  const limit = Math.min(rows.length, maxRows);
  const text: (string | undefined)[][] = [];
  const origin: boolean[][] = [];
  const cellHidden: boolean[][] = [];
  const rowHidden: boolean[] = [];
  let nestedTables = 0;
  const ensure = (r: number) => {
    while (text.length <= r) {
      text.push([]);
      origin.push([]);
      cellHidden.push([]);
    }
  };
  const textOptions = { includeHidden: options.includeHidden };

  for (let r = 0; r < limit; r++) {
    if (pacer) await pacer.tick();
    const row = rows[r];
    ensure(r);
    rowHidden[r] = isRowHidden(row, handle.element);
    // Hidden rows are still laid out in the grid so their rowspans keep later rows
    // aligned; they are filtered out afterwards when includeHidden is off.
    let c = 0;
    for (const cell of row.cells) {
      while (text[r][c] !== undefined) c++;
      const colSpan = Math.min(Math.max(cell.colSpan, 1), MAX_COLSPAN);
      let rowSpan = cell.rowSpan;
      if (rowSpan === 0) rowSpan = row.sectionEnd - r + 1; // "to the end of the row group"
      rowSpan = Math.min(Math.max(rowSpan, 1), MAX_ROWSPAN, row.sectionEnd - r + 1, limit - r);
      const hidden = isSelfHidden(cell.el);
      const value = hidden && !options.includeHidden ? elementText(cell.el, { includeHidden: true }) : elementText(cell.el, textOptions);
      if (handle.kind === 'table' && cell.el.querySelector('table')) nestedTables++;
      for (let dr = 0; dr < rowSpan; dr++) {
        ensure(r + dr);
        for (let dc = 0; dc < colSpan; dc++) {
          const isOrigin = dr === 0 && dc === 0;
          if (text[r + dr][c + dc] !== undefined && !isOrigin) continue; // overlapping spans: first cell wins
          text[r + dr][c + dc] = isOrigin || options.fillMerged ? value : '';
          origin[r + dr][c + dc] = isOrigin;
          cellHidden[r + dr][c + dc] = hidden;
        }
      }
      c += colSpan;
    }
  }

  let width = 0;
  for (let r = 0; r < text.length; r++) {
    if (text[r].length > width) width = text[r].length;
  }
  let ragged = false;
  for (let r = 0; r < text.length; r++) {
    for (let c = 0; c < width; c++) {
      if (text[r][c] === undefined) {
        if (rows[r] && rows[r].cells.length > 0) ragged = true;
      }
    }
  }
  return { text, origin, cellHidden, rowHidden, rows: rows.slice(0, limit), width, ragged, nestedTables };
}

function headerRowCount(grid: Grid, options: TableOptions, visibleRows: number[]): number {
  if (options.headerMode === 'none' || visibleRows.length === 0) return 0;
  if (options.headerMode === 'first-row') return 1;
  // auto: rows of <thead>, otherwise leading rows made only of <th> cells.
  let count = 0;
  for (const r of visibleRows) {
    if (grid.rows[r].section === 'head') count++;
    else break;
  }
  if (count === 0) {
    for (const r of visibleRows) {
      const cells = grid.rows[r].cells;
      if (cells.length > 0 && cells.every((cell) => cell.isHeader)) count++;
      else break;
    }
    // A table made only of header cells has no data rows to describe: treat as data.
    if (count === visibleRows.length) count = 0;
  }
  return count;
}

function tableName(el: Element): string {
  const caption = tagOf(el) === 'TABLE' ? (el as HTMLTableElement).caption : null;
  if (caption) {
    const text = inlineText(caption);
    if (text) return text;
  }
  const label = el.getAttribute('aria-label');
  if (label && label.trim()) return collapseWhitespace(label);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const root = el.getRootNode() as Document | ShadowRoot;
    const parts = labelledBy
      .split(/\s+/)
      .map((id) => (id ? root.getElementById?.(id) : null))
      .filter((node): node is HTMLElement => !!node)
      .map((node) => inlineText(node));
    const text = collapseWhitespace(parts.join(' '));
    if (text) return text;
  }
  const summary = el.getAttribute('summary');
  if (summary && summary.trim()) return collapseWhitespace(summary);
  // A heading right before the table (or before its wrapper) usually names it.
  let node: Element | null = el;
  for (let depth = 0; node && depth < 3; depth++) {
    const prev: Element | null = node.previousElementSibling;
    if (prev && /^H[1-6]$/.test(tagOf(prev))) {
      const text = inlineText(prev);
      if (text) return text;
    }
    if (prev) break;
    node = node.parentElement;
  }
  return '';
}

export interface ExtractedTable {
  name: string;
  headers: string[];
  rows: string[][];
  warnings: string[];
  hiddenRows: number;
  hiddenColumns: number;
  hasNested: boolean;
  totalRows: number;
}

/**
 * Extract one table. `maxDataRows` limits how many data rows are materialised (used for
 * previews); `totalRows` always reports the real number of visible data rows.
 */
export async function extractTable(
  handle: TableHandle,
  options: TableOptions,
  pacer?: Pacer,
  maxDataRows = Infinity,
): Promise<ExtractedTable> {
  const warnings: string[] = [];
  const rowBudget = maxDataRows === Infinity ? Infinity : maxDataRows + 12;
  const grid = await buildGrid(handle, options, pacer, rowBudget);
  const allRowCount = modelRowCount(handle);
  const truncated = grid.rows.length < allRowCount;

  // Rows.
  const visibleRows: number[] = [];
  let hiddenRows = 0;
  for (let r = 0; r < grid.rows.length; r++) {
    if (grid.rowHidden[r] && !options.includeHidden) hiddenRows++;
    else visibleRows.push(r);
  }

  // Columns: a column is hidden when every cell in it (across visible rows) is hidden.
  const keepColumns: number[] = [];
  let hiddenColumns = 0;
  for (let c = 0; c < grid.width; c++) {
    let anyCell = false;
    let allHidden = true;
    for (const r of visibleRows) {
      if (grid.text[r][c] === undefined) continue;
      anyCell = true;
      if (!grid.cellHidden[r][c]) {
        allHidden = false;
        break;
      }
    }
    if (anyCell && allHidden && !options.includeHidden) hiddenColumns++;
    else keepColumns.push(c);
  }

  const headerRows = headerRowCount(grid, options, visibleRows);
  const headerIdx = visibleRows.slice(0, headerRows);
  const dataIdx = visibleRows.slice(headerRows);

  // Header names: merge multi-row headers ("Sales - Q1"), dropping repeated parts.
  let headers: string[];
  if (headerIdx.length > 0) {
    headers = keepColumns.map((c) => {
      const parts: string[] = [];
      for (const r of headerIdx) {
        // Headers always use the merged value so grouped headers reach every column.
        const value = collapseWhitespace(headerValue(grid, r, c));
        if (value && parts[parts.length - 1] !== value) parts.push(value);
      }
      return parts.join(' - ');
    });
  } else {
    headers = keepColumns.map(() => '');
  }
  headers = uniqueNames(headers, t('Column'));

  const rows: string[][] = [];
  const take = Math.min(dataIdx.length, maxDataRows);
  for (let i = 0; i < take; i++) {
    const r = dataIdx[i];
    const line = grid.text[r];
    const out = new Array<string>(keepColumns.length);
    for (let k = 0; k < keepColumns.length; k++) out[k] = line[keepColumns[k]] ?? '';
    rows.push(out);
  }

  let totalRows = dataIdx.length;
  if (truncated) {
    // Preview mode: estimate the remaining rows without building them.
    totalRows = Math.max(0, allRowCount - headerRows - hiddenRows);
  }

  if (grid.ragged) {
    warnings.push(t('Some rows have fewer cells than others; the missing cells were left empty.'));
  }
  if (grid.nestedTables > 0) {
    warnings.push(
      t('{count} cell(s) contain a nested table. Their content was flattened into the cell and each nested table is also listed separately.', {
        count: grid.nestedTables,
      }),
    );
  }
  if (hiddenRows > 0) {
    warnings.push(t('{count} hidden row(s) were skipped. Turn on "Include hidden" to extract them.', { count: hiddenRows }));
  }
  if (hiddenColumns > 0) {
    warnings.push(t('{count} hidden column(s) were skipped. Turn on "Include hidden" to extract them.', { count: hiddenColumns }));
  }
  if (!truncated && rows.length === 0) {
    warnings.push(t('This table has no data rows.'));
  }

  return {
    name: tableName(handle.element),
    headers,
    rows,
    warnings,
    hiddenRows,
    hiddenColumns,
    hasNested: grid.nestedTables > 0,
    totalRows,
  };
}

/** Value of a header slot, resolving span continuations back to their origin cell. */
function headerValue(grid: Grid, r: number, c: number): string {
  const value = grid.text[r][c];
  if (value === undefined) return '';
  if (value !== '' || grid.origin[r][c]) return value;
  // fillMerged is off: look left, then up, for the cell that spans this slot.
  for (let cc = c; cc >= 0; cc--) {
    if (grid.origin[r][cc]) return grid.text[r][cc] ?? '';
    if (grid.text[r][cc] === undefined) break;
  }
  for (let rr = r; rr >= 0; rr--) {
    if (grid.origin[rr]?.[c]) return grid.text[rr][c] ?? '';
  }
  return '';
}

function modelRowCount(handle: TableHandle): number {
  if (handle.kind === 'table') return (handle.element as HTMLTableElement).rows.length;
  let count = 0;
  const rowEls = handle.element.querySelectorAll('[role="row"]');
  for (let i = 0; i < rowEls.length; i++) {
    if (rowEls[i].closest(`table, ${ARIA_GRID_SELECTOR}`) === handle.element) count++;
  }
  return count;
}

function looksLikeDataTable(handle: TableHandle, table: ExtractedTable): boolean {
  const role = handle.element.getAttribute('role');
  if (role === 'presentation' || role === 'none') return false;
  if (table.headers.length === 0) return false;
  const cells = table.totalRows * table.headers.length;
  if (cells < 2) return false;
  if (handle.kind === 'table' && handle.element.querySelector('th, thead, caption')) return true;
  return table.totalRows >= 2 || table.headers.length >= 2;
}

/** Summaries (with a small preview) of every table, for the Tables screen. */
export async function listTables(
  doc: Document,
  options: TableOptions,
  previewRows: number,
  pacer?: Pacer,
): Promise<TableSummary[]> {
  const handles = collectTables(doc);
  const summaries: TableSummary[] = [];
  for (let index = 0; index < handles.length; index++) {
    const handle = handles[index];
    // Counts are exact for ordinary tables; only very large ones are sampled.
    const exact = modelRowCount(handle) <= EXACT_COUNT_LIMIT;
    const table = await extractTable(handle, options, pacer, exact ? Infinity : previewRows);
    let nestedIn = -1;
    const parentTable = handle.element.parentElement?.closest(`table, ${ARIA_GRID_SELECTOR}`);
    if (parentTable) nestedIn = handles.findIndex((h) => h.element === parentTable);
    const warnings = [...table.warnings];
    if (isHiddenDeep(handle.element)) {
      warnings.push(t('This table is currently not visible on the page (for example inside a collapsed section).'));
    }
    summaries.push({
      index,
      caption: table.name,
      kind: handle.kind,
      rowCount: table.totalRows,
      rowCountExact: exact,
      columnCount: table.headers.length,
      headers: table.headers,
      preview: table.rows.slice(0, previewRows),
      warnings,
      hiddenRows: table.hiddenRows,
      hiddenColumns: table.hiddenColumns,
      nestedIn,
      hasNested: table.hasNested,
      isDataTable: looksLikeDataTable(handle, table),
      inScrollContainer: !!scrollableAncestor(handle.element),
      location: handle.location,
    });
  }
  return summaries;
}

/** Extract the chosen tables as datasets. Unknown indexes are reported, not ignored. */
export async function extractTables(
  doc: Document,
  indexes: number[] | 'all',
  options: TableOptions,
  pacer?: Pacer,
  onProgress?: (done: number, total: number) => void,
): Promise<RawDataset[]> {
  const handles = collectTables(doc);
  const wanted = indexes === 'all' ? handles.map((_, i) => i) : indexes;
  const datasets: RawDataset[] = [];
  for (let n = 0; n < wanted.length; n++) {
    const index = wanted[n];
    const handle = handles[index];
    const fallbackName = t('Table {n}', { n: index + 1 });
    if (!handle) {
      datasets.push({
        key: `table-${index}`,
        name: fallbackName,
        columns: [],
        rows: [],
        warnings: [t('Table {n} is no longer on the page. Rescan and try again.', { n: index + 1 })],
        method: 'table',
        detail: fallbackName,
      });
      continue;
    }
    const table = await extractTable(handle, options, pacer);
    datasets.push({
      key: `table-${index}`,
      name: table.name || fallbackName,
      columns: table.headers,
      rows: table.rows,
      warnings: table.warnings,
      method: 'table',
      detail: fallbackName,
    });
    onProgress?.(n + 1, wanted.length);
  }
  return datasets;
}

/** Cheap fingerprint of the page's tables, used to notice dynamically rendered tables. */
export function tablesFingerprint(doc: Document): string {
  const handles = collectTables(doc);
  const parts: string[] = [];
  for (const handle of handles) parts.push(`${handle.kind}:${modelRowCount(handle)}`);
  return parts.join(',');
}

/** Number of tables that look like real data tables (cheap heuristic for the popup). */
export function countDataTables(doc: Document): { data: number; all: number } {
  const handles = collectTables(doc);
  let data = 0;
  for (const handle of handles) {
    const role = handle.element.getAttribute('role');
    if (role === 'presentation' || role === 'none') continue;
    const rows = modelRowCount(handle);
    if (rows >= 2 || (handle.kind === 'table' && handle.element.querySelector('th'))) data++;
  }
  return { data, all: handles.length };
}
