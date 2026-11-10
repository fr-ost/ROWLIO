// RFC 4180 writer and parser for delimiter-separated text (CSV, semicolon CSV, TSV).
import type { TableData } from '@/types/data';
import { guardFormula } from '@/export/formula';
import { t } from '@/i18n';

export interface DelimitedOptions {
  delimiter: string;
  /** Prefix formula-like cells with an apostrophe (see formula.ts). */
  formulaGuard: boolean;
  includeHeader: boolean;
  /** Default CRLF, as RFC 4180 specifies and Excel expects. */
  lineEnding?: '\r\n' | '\n';
  /** Rows per yielded string. Default 2000. */
  chunkRows?: number;
}

export const DEFAULT_CHUNK_ROWS = 2000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Yield the document in strings of about `chunkRows` rows, so the caller can hand them to
 * `new Blob(parts)` without ever building one giant string.
 *
 * A field is quoted when it contains the delimiter, a double quote, CR or LF, or when it
 * starts / ends with whitespace (many importers trim unquoted fields). Embedded quotes are
 * doubled. Every row – including the last – ends with the line ending.
 */
export function* delimitedChunks(data: TableData, opts: DelimitedOptions): Generator<string> {
  const { delimiter, formulaGuard } = opts;
  if (delimiter === '') throw new Error(t('The delimiter cannot be empty.'));
  const lineEnding = opts.lineEnding ?? '\r\n';
  const chunkRows = Math.max(1, Math.floor(opts.chunkRows ?? DEFAULT_CHUNK_ROWS));
  const width = data.columns.length;
  const needsQuoting = new RegExp(`["\\r\\n]|${escapeRegExp(delimiter)}|^\\s|\\s$`);

  const field = (raw: string): string => {
    const value = formulaGuard ? guardFormula(raw) : raw;
    if (value === '') return '';
    return needsQuoting.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  // A record whose only field is empty would be an empty line, which most parsers skip;
  // quoting it keeps the row count intact.
  const record = (fields: string[]): string => (width === 1 && fields[0] === '' ? '""' : fields.join(delimiter));

  // No columns means no fields: there is nothing to write, not even empty lines.
  if (width === 0) return;

  let lines: string[] = [];
  if (opts.includeHeader) lines.push(record(data.columns.map((column) => field(column.name))));

  const fields = new Array<string>(width);
  let pending = 0;
  for (let r = 0; r < data.rows.length; r++) {
    const cells = data.rows[r]!.cells;
    for (let c = 0; c < width; c++) fields[c] = field(cells[c] ?? '');
    lines.push(record(fields));
    pending += 1;
    if (pending === chunkRows) {
      yield lines.join(lineEnding) + lineEnding;
      lines = [];
      pending = 0;
    }
  }
  if (lines.length > 0) yield lines.join(lineEnding) + lineEnding;
}

/** The whole document as one string (fine for previews and small data; prefer the chunks for files). */
export function toDelimited(data: TableData, opts: DelimitedOptions): string {
  let text = '';
  for (const chunk of delimitedChunks(data, opts)) text += chunk;
  return text;
}

const QUOTE = 0x22;
const CR = 0x0d;
const LF = 0x0a;

/**
 * RFC 4180 parser: quoted fields may contain delimiters, line breaks and doubled quotes;
 * records end with CRLF, LF or a lone CR; a leading UTF-8 BOM is ignored; the final line
 * ending does not produce an extra empty record. Slightly malformed input is read
 * leniently (a stray quote inside an unquoted field, or text after a closing quote, is
 * kept literally) instead of throwing.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  if (delimiter === '') throw new Error(t('The delimiter cannot be empty.'));
  const records: string[][] = [];
  const length = text.length;
  const delimiterCode = delimiter.charCodeAt(0);
  const delimiterLength = delimiter.length;

  const isDelimiterAt = (index: number): boolean =>
    text.charCodeAt(index) === delimiterCode && (delimiterLength === 1 || text.startsWith(delimiter, index));

  /** Index of the delimiter / line ending that terminates the unquoted text starting at `from`. */
  const fieldEnd = (from: number): number => {
    let index = from;
    while (index < length) {
      const code = text.charCodeAt(index);
      if (code === CR || code === LF || isDelimiterAt(index)) break;
      index += 1;
    }
    return index;
  };

  let position = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let record: string[] = [];
  while (position < length) {
    let value: string;
    if (text.charCodeAt(position) === QUOTE) {
      value = '';
      position += 1;
      for (;;) {
        const quote = text.indexOf('"', position);
        if (quote === -1) {
          // Unterminated quote: the rest of the input belongs to this field.
          value += text.slice(position);
          position = length;
          break;
        }
        value += text.slice(position, quote);
        if (text.charCodeAt(quote + 1) === QUOTE) {
          value += '"';
          position = quote + 2;
          continue;
        }
        position = quote + 1;
        break;
      }
      const end = fieldEnd(position);
      value += text.slice(position, end);
      position = end;
    } else {
      const end = fieldEnd(position);
      value = text.slice(position, end);
      position = end;
    }
    record.push(value);

    if (position >= length) break;
    if (isDelimiterAt(position)) {
      position += delimiterLength;
      // A delimiter at the very end still owes one (empty) field.
      if (position >= length) record.push('');
      continue;
    }
    position += text.charCodeAt(position) === CR && text.charCodeAt(position + 1) === LF ? 2 : 1;
    records.push(record);
    record = [];
  }
  if (record.length > 0) records.push(record);
  return records;
}
