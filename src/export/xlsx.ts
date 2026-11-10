// A minimal XLSX (SpreadsheetML) writer on top of fflate. No SheetJS / exceljs: the format
// we need – strings, plain numbers, dates, a bold frozen header with a filter – is small,
// and writing it ourselves keeps the extension light and the output auditable.
//
// FORMULA SAFETY: a value is never written as a formula (<f>). Text always becomes an
// inline-string cell (t="inlineStr"), which spreadsheet applications display literally, so
// "=1+1" or "=HYPERLINK(...)" scraped from a page stays inert text. This is why XLSX
// export needs no apostrophe prefixing, unlike CSV.
import { Zip, ZipDeflate, strToU8, zipSync } from 'fflate';
import type { Zippable } from 'fflate';
import type { TableData } from '@/types/data';
import { brand } from '@/config/brand';
import { formatNumber, t } from '@/i18n';
import { Pacer } from '@/utils/async';

export interface XlsxSheet {
  name: string;
  data: TableData;
}

export interface XlsxOptions {
  /** Write plain numbers and strict ISO dates as numeric / date cells instead of text. */
  typed: boolean;
  /** Default true. */
  includeHeader?: boolean;
  /** Called with the number of data rows written so far, across all sheets. */
  onProgress?: (doneRows: number, totalRows: number) => void;
}

/** Real limits of the XLSX format; exceeding them is reported, never silently truncated. */
export const XLSX_MAX_ROWS = 1_048_576;
export const XLSX_MAX_COLUMNS = 16_384;
export const XLSX_MAX_CELL_CHARS = 32_767;
const SHEET_NAME_MAX = 31;

export class XlsxLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XlsxLimitError';
  }
}

// ---------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

// Quick test so the common cell (plain text) is copied without any replace() call.
const NEEDS_XML_WORK = /[&<>"\r\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff￾￿]|_x[0-9A-Fa-f]{4}_/;
// Characters XML 1.0 cannot carry: C0 controls other than TAB / LF / CR, U+FFFE / U+FFFF and
// UNPAIRED surrogates. Proper surrogate pairs (emoji, other astral characters) are kept.
const XML_ILLEGAL =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
// SpreadsheetML decodes "_xHHHH_" inside strings as a character escape, so literal text of
// that shape must have its underscore escaped or Excel would show a different string.
const OOXML_ESCAPE_LOOKALIKE = /_(?=x[0-9A-Fa-f]{4}_)/g;
const XML_SPECIAL = /[&<>"\r]/g;
const XML_ENTITY: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  // A literal CR would be normalised to LF by every XML parser; the reference survives.
  '\r': '&#13;',
};

function xmlEscape(value: string): string {
  if (!NEEDS_XML_WORK.test(value)) return value;
  return value
    .replace(XML_ILLEGAL, '')
    .replace(OOXML_ESCAPE_LOOKALIKE, '_x005F_')
    .replace(XML_SPECIAL, (ch) => XML_ENTITY[ch] ?? ch);
}

/** "A", "B", … "Z", "AA", … for a zero-based column index. */
function columnLetters(index: number): string {
  let n = index + 1;
  let letters = '';
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const code = text.charCodeAt(end - 1);
  // Do not cut a surrogate pair in half.
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return text.slice(0, end);
}

function cleanSheetName(raw: string): string {
  // Excel forbids [ ] : * ? / \ in sheet names and a leading / trailing apostrophe.
  let name = raw.replace(/[\u0000-\u001f\u007f[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ');
  for (;;) {
    const next = name.trim().replace(/^'+|'+$/g, '');
    if (next === name) return name;
    name = next;
  }
}

/**
 * Valid, unique Excel sheet names: at most 31 characters, none of `[]:*?/\`, not empty, no
 * leading / trailing apostrophe, unique ignoring case (duplicates get " (2)", " (3)", …).
 */
export function sanitizeSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((raw, index) => {
    let base = cleanSheetName(clip(cleanSheetName(raw), SHEET_NAME_MAX));
    if (base === '') base = t('Sheet {n}', { n: index + 1 });
    // "History" is reserved by Excel.
    if (base.toLowerCase() === 'history') base = `${base}_`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = cleanSheetName(clip(base, SHEET_NAME_MAX - suffix.length)) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// ---------------------------------------------------------------------------------------
// Cell typing
// ---------------------------------------------------------------------------------------

// No plus sign, no leading zeros ("00123" is an identifier), no exponent, no separators.
const PLAIN_NUMBER = /^-?(0|[1-9]\d{0,14})(\.\d+)?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;
const MS_PER_DAY = 86_400_000;
/** Excel serial number of 1970-01-01. */
const UNIX_EPOCH_SERIAL = 25_569;

function isPlainNumber(value: string): boolean {
  const first = value.charCodeAt(0);
  if (value.length > 32 || (first !== 45 && (first < 48 || first > 57))) return false;
  const match = PLAIN_NUMBER.exec(value);
  if (!match) return false;
  // A double holds 15 significant digits; more would be silently rounded by Excel.
  const significant = ((match[1] ?? '') + (match[2] ?? '').slice(1)).replace(/^0+/, '');
  if (significant.length > 15) return false;
  // "-0" would come back as 0.
  return !(first === 45 && significant === '');
}

/** First serial on which Excel, LibreOffice and Google Sheets agree: 1 March 1900. */
const FIRST_PORTABLE_SERIAL = 61;

/**
 * Serial number for strict `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm(:ss)`, or null when the value
 * must stay text: not that exact shape, not a real calendar date, or outside 1900-03-01 …
 * 9999-12-31.
 *
 * Why not from 1900-01-01: Excel's calendar contains a non-existent 29 Feb 1900, while
 * LibreOffice and Google Sheets do not, so every serial below 61 shows a different day
 * depending on the application. Those 59 days are written as text, which is right everywhere.
 */
function isoDateSerial(value: string): { serial: number; hasTime: boolean } | null {
  if (value.length < 10 || value.length > 19 || value.charCodeAt(4) !== 45) return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  // Date.UTC rolls impossible dates over (Feb 30 → Mar 1); reject those.
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const serial = utc / MS_PER_DAY + UNIX_EPOCH_SERIAL;
  if (serial < FIRST_PORTABLE_SERIAL) return null;

  if (match[4] === undefined) return { serial, hasTime: false };
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { serial: serial + (hour * 3600 + minute * 60 + second) / 86_400, hasTime: true };
}

// Indexes into <cellXfs> in styles.xml.
const STYLE_HEADER = 1;
const STYLE_DATE = 2;
const STYLE_DATETIME = 3;

const STYLES_XML =
  `${XML_DECLARATION}<styleSheet xmlns="${NS_MAIN}">` +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

// ---------------------------------------------------------------------------------------
// Planning and static parts
// ---------------------------------------------------------------------------------------

interface PlannedSheet {
  name: string;
  data: TableData;
  path: string;
  /** Header row is written, frozen and filterable. */
  header: boolean;
  /** Rows in the worksheet, header included. */
  sheetRows: number;
}

interface Plan {
  sheets: PlannedSheet[];
  typed: boolean;
  totalRows: number;
}

function plan(sheets: XlsxSheet[], opts: XlsxOptions): Plan {
  if (sheets.length === 0) throw new Error(t('There is nothing to export.'));
  const includeHeader = opts.includeHeader ?? true;
  const names = sanitizeSheetNames(sheets.map((sheet) => sheet.name));
  let totalRows = 0;
  const planned = sheets.map((sheet, index): PlannedSheet => {
    const name = names[index]!;
    const columns = sheet.data.columns.length;
    const header = includeHeader && columns > 0;
    const sheetRows = sheet.data.rows.length + (header ? 1 : 0);
    if (columns > XLSX_MAX_COLUMNS) {
      throw new XlsxLimitError(
        t(
          'Sheet "{sheet}" has {count} columns, but an Excel sheet can hold at most {max}. Remove columns or export as CSV or JSON instead.',
          { sheet: name, count: formatNumber(columns), max: formatNumber(XLSX_MAX_COLUMNS) },
        ),
      );
    }
    if (sheetRows > XLSX_MAX_ROWS) {
      throw new XlsxLimitError(
        t(
          'Sheet "{sheet}" has {count} rows, but an Excel sheet can hold at most {max}. Export as CSV or JSON instead, or split the data.',
          { sheet: name, count: formatNumber(sheetRows), max: formatNumber(XLSX_MAX_ROWS) },
        ),
      );
    }
    totalRows += sheet.data.rows.length;
    return { name, data: sheet.data, path: `xl/worksheets/sheet${index + 1}.xml`, header, sheetRows };
  });
  return { sheets: planned, typed: opts.typed, totalRows };
}

function usedRange(sheet: PlannedSheet): string {
  const columns = sheet.data.columns.length;
  if (columns === 0 || sheet.sheetRows === 0) return 'A1';
  return `A1:${columnLetters(columns - 1)}${sheet.sheetRows}`;
}

function contentTypesXml(p: Plan): string {
  const sheets = p.sheets
    .map(
      (sheet) =>
        `<Override PartName="/${sheet.path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');
  return (
    `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    sheets +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    '</Types>'
  );
}

const ROOT_RELS_XML =
  `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_REL}">` +
  `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  `<Relationship Id="rId3" Type="${NS_REL}/extended-properties" Target="docProps/app.xml"/>` +
  '</Relationships>';

function appXml(): string {
  return (
    `${XML_DECLARATION}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">` +
    `<Application>${xmlEscape(brand.name)}</Application></Properties>`
  );
}

function coreXml(): string {
  const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    `${XML_DECLARATION}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ` +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:creator>${xmlEscape(brand.name)}</dc:creator>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>` +
    '</cp:coreProperties>'
  );
}

function workbookXml(p: Plan): string {
  const sheets = p.sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('');
  // Excel records an auto-filter both in the sheet and as a hidden defined name.
  const filters = p.sheets
    .map((sheet, index) => {
      if (!sheet.header) return '';
      const quoted = `'${sheet.name.replace(/'/g, "''")}'`;
      const last = `$${columnLetters(sheet.data.columns.length - 1)}$${sheet.sheetRows}`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xmlEscape(quoted)}!$A$1:${last}</definedName>`;
    })
    .join('');
  return (
    `${XML_DECLARATION}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    '<bookViews><workbookView/></bookViews>' +
    `<sheets>${sheets}</sheets>` +
    (filters ? `<definedNames>${filters}</definedNames>` : '') +
    '</workbook>'
  );
}

function workbookRelsXml(p: Plan): string {
  const sheets = p.sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  return (
    `${XML_DECLARATION}<Relationships xmlns="${NS_PACKAGE_REL}">${sheets}` +
    `<Relationship Id="rId${p.sheets.length + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    '</Relationships>'
  );
}

/** Everything except the worksheets, in the order the parts are stored in the archive. */
function staticParts(p: Plan): [path: string, xml: string][] {
  return [
    ['[Content_Types].xml', contentTypesXml(p)],
    ['_rels/.rels', ROOT_RELS_XML],
    ['docProps/app.xml', appXml()],
    ['docProps/core.xml', coreXml()],
    ['xl/workbook.xml', workbookXml(p)],
    ['xl/_rels/workbook.xml.rels', workbookRelsXml(p)],
    ['xl/styles.xml', STYLES_XML],
  ];
}

// ---------------------------------------------------------------------------------------
// Worksheets
// ---------------------------------------------------------------------------------------

const WIDTH_SAMPLE_ROWS = 200;
const MIN_COLUMN_WIDTH = 8;
const MAX_COLUMN_WIDTH = 60;
/** Flush a chunk of worksheet XML once it reaches this many characters or rows. */
const CHUNK_CHARS = 256 * 1024;
const CHUNK_ROWS = 2000;

function displayLength(value: string): number {
  if (value.length <= MIN_COLUMN_WIDTH) return value.length;
  if (!value.includes('\n')) return value.length;
  let longest = 0;
  for (const line of value.split('\n')) if (line.length > longest) longest = line.length;
  return longest;
}

/** Column widths (in characters) from the header and the first rows, clamped to 8–60. */
function columnWidths(sheet: PlannedSheet): number[] {
  const { columns, rows } = sheet.data;
  const sample = Math.min(rows.length, WIDTH_SAMPLE_ROWS);
  return columns.map((column, c) => {
    let longest = sheet.header ? displayLength(column.name) : 0;
    for (let r = 0; r < sample && longest < MAX_COLUMN_WIDTH; r++) {
      const length = displayLength(rows[r]!.cells[c] ?? '');
      if (length > longest) longest = length;
    }
    return Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, longest + 2));
  });
}

function sheetHead(sheet: PlannedSheet, first: boolean): string {
  const selected = first ? ' tabSelected="1"' : '';
  const view = sheet.header
    ? `<sheetView${selected} workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>'
    : `<sheetView${selected} workbookViewId="0"/>`;
  const widths = columnWidths(sheet);
  const cols =
    widths.length > 0
      ? `<cols>${widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
      : '';
  return (
    `${XML_DECLARATION}<worksheet xmlns="${NS_MAIN}">` +
    `<dimension ref="${usedRange(sheet)}"/>` +
    `<sheetViews>${view}</sheetViews>` +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    cols +
    '<sheetData>'
  );
}

function sheetTail(sheet: PlannedSheet): string {
  return `</sheetData>${sheet.header ? `<autoFilter ref="${usedRange(sheet)}"/>` : ''}</worksheet>`;
}

function tooLong(sheet: PlannedSheet, column: number, row: number | null, length: number): XlsxLimitError {
  const params = {
    sheet: sheet.name,
    column: sheet.data.columns[column]?.name ?? columnLetters(column),
    length: formatNumber(length),
    max: formatNumber(XLSX_MAX_CELL_CHARS),
  };
  return new XlsxLimitError(
    row === null
      ? t(
          'Sheet "{sheet}": the name of column "{column}" has {length} characters, but an Excel cell can hold at most {max}. Shorten it, or export as CSV or JSON instead.',
          params,
        )
      : t(
          'Sheet "{sheet}", column "{column}", row {row}: the cell has {length} characters, but an Excel cell can hold at most {max}. Shorten it, or export as CSV or JSON instead.',
          { ...params, row: formatNumber(row) },
        ),
  );
}

/**
 * The worksheet XML in chunks. `onRows(n)` is called after each chunk with the number of
 * data rows it contained, which is what progress reporting is based on.
 */
function* sheetChunks(sheet: PlannedSheet, first: boolean, typed: boolean, onRows: (rows: number) => void): Generator<string> {
  const { columns, rows } = sheet.data;
  const width = columns.length;
  const letters = columns.map((_, index) => columnLetters(index));

  let buffer = sheetHead(sheet, first);
  if (sheet.header) {
    buffer += '<row r="1">';
    for (let c = 0; c < width; c++) {
      const name = columns[c]!.name;
      if (name === '') continue;
      if (name.length > XLSX_MAX_CELL_CHARS) throw tooLong(sheet, c, null, name.length);
      buffer += `<c r="${letters[c]}1" t="inlineStr" s="${STYLE_HEADER}"><is><t xml:space="preserve">${xmlEscape(name)}</t></is></c>`;
    }
    buffer += '</row>';
  }

  const offset = sheet.header ? 2 : 1;
  let pending = 0;
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r]!.cells;
    const rowNumber = r + offset;
    buffer += `<row r="${rowNumber}">`;
    for (let c = 0; c < width; c++) {
      const value = cells[c] ?? '';
      // Empty cells are simply absent, as in files written by Excel itself.
      if (value === '') continue;
      const ref = `${letters[c]}${rowNumber}`;
      if (typed) {
        if (isPlainNumber(value)) {
          buffer += `<c r="${ref}"><v>${value}</v></c>`;
          continue;
        }
        const date = isoDateSerial(value);
        if (date) {
          buffer += `<c r="${ref}" s="${date.hasTime ? STYLE_DATETIME : STYLE_DATE}"><v>${date.serial}</v></c>`;
          continue;
        }
      }
      if (value.length > XLSX_MAX_CELL_CHARS) throw tooLong(sheet, c, r + 1, value.length);
      // Always an inline string, never a formula – see FORMULA SAFETY at the top of the file.
      buffer += `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
    }
    buffer += '</row>';
    pending += 1;
    if (pending >= CHUNK_ROWS || buffer.length >= CHUNK_CHARS) {
      yield buffer;
      onRows(pending);
      buffer = '';
      pending = 0;
    }
  }
  yield buffer + sheetTail(sheet);
  if (pending > 0) onRows(pending);
}

function progressReporter(p: Plan, opts: XlsxOptions): (rows: number) => void {
  let done = 0;
  return (rows) => {
    done += rows;
    opts.onProgress?.(done, p.totalRows);
  };
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0]!;
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

const DEFLATE_LEVEL = 6;

/**
 * Build a workbook synchronously. Throws XlsxLimitError when the data cannot be
 * represented in the XLSX format (too many rows / columns, or a cell over 32,767
 * characters) – the message names the sheet, column and row.
 */
export function buildXlsx(sheets: XlsxSheet[], opts: XlsxOptions): Uint8Array {
  const p = plan(sheets, opts);
  const report = progressReporter(p, opts);
  const files: Zippable = {};
  for (const [path, xml] of staticParts(p)) files[path] = strToU8(xml);
  p.sheets.forEach((sheet, index) => {
    // Encode chunk by chunk: one giant string per sheet would need twice the memory.
    const encoded: Uint8Array[] = [];
    for (const chunk of sheetChunks(sheet, index === 0, p.typed, report)) encoded.push(strToU8(chunk));
    files[sheet.path] = concatBytes(encoded);
  });
  if (p.totalRows === 0) opts.onProgress?.(0, 0);
  return zipSync(files, { level: DEFLATE_LEVEL });
}

/**
 * Same workbook, built cooperatively: worksheet XML is generated and compressed chunk by
 * chunk, yielding to the event loop in between, so a 200k-row export does not freeze the
 * page and never holds a whole uncompressed sheet in memory. Resolves with the bytes of
 * the .xlsx file as a list of parts ready for `new Blob(parts)`.
 */
export async function buildXlsxAsync(
  sheets: XlsxSheet[],
  opts: XlsxOptions & { signal?: AbortSignal },
): Promise<Uint8Array<ArrayBuffer>[]> {
  const p = plan(sheets, opts);
  const report = progressReporter(p, opts);
  const pacer = new Pacer(opts.signal);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  const outcome: { error: Error | null } = { error: null };
  const zip = new Zip((error, chunk) => {
    if (error) outcome.error = error;
    else parts.push(chunk);
  });
  const empty = new Uint8Array(0);

  try {
    for (const [path, xml] of staticParts(p)) {
      const file = new ZipDeflate(path, { level: DEFLATE_LEVEL });
      zip.add(file);
      file.push(strToU8(xml), true);
    }
    for (let index = 0; index < p.sheets.length; index++) {
      const sheet = p.sheets[index]!;
      const file = new ZipDeflate(sheet.path, { level: DEFLATE_LEVEL });
      zip.add(file);
      for (const chunk of sheetChunks(sheet, index === 0, p.typed, report)) {
        file.push(strToU8(chunk), false);
        await pacer.tick();
      }
      file.push(empty, true);
    }
    zip.end();
  } catch (error) {
    zip.terminate();
    throw error;
  }
  if (outcome.error) throw outcome.error;
  if (p.totalRows === 0) opts.onProgress?.(0, 0);
  return parts;
}
