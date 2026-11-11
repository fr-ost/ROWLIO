// Markdown and HTML table exports. Both escape cell text, so page content can never turn
// into markup in the exported file.
import type { TableData } from '@/types/data';
import { guardFormula } from '@/export/formula';

const DEFAULT_ROWS = 2000;

function markdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/\r\n|\r|\n/g, '<br>')
    .trim();
}

/** GitHub-flavoured Markdown table. A header row is always written (the syntax needs one). */
export function* markdownChunks(data: TableData, chunkRows = DEFAULT_ROWS): Generator<string> {
  const names = data.columns.map((column) => markdownCell(column.name) || ' ');
  yield `| ${names.join(' | ')} |\n| ${names.map(() => '---').join(' | ')} |\n`;
  let buffer = '';
  for (let r = 0; r < data.rows.length; r++) {
    const row = data.rows[r]!;
    buffer += `| ${data.columns.map((_, c) => markdownCell(row.cells[c] ?? '')).join(' | ')} |\n`;
    if ((r + 1) % chunkRows === 0) {
      yield buffer;
      buffer = '';
    }
  }
  if (buffer) yield buffer;
}

export function toMarkdown(data: TableData): string {
  return Array.from(markdownChunks(data)).join('');
}

function htmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlCell(value: string): string {
  return htmlText(value).replace(/\r\n|\r|\n/g, '<br>');
}

/**
 * A complete, self-contained HTML document holding one table (no scripts, no remote assets).
 * Spreadsheet applications open HTML tables too, and evaluate cells that look like formulas,
 * so the same guard as for CSV applies unless the caller switches it off.
 */
export function* htmlChunks(data: TableData, options: { includeHeader: boolean; title?: string; formulaGuard?: boolean }, chunkRows = DEFAULT_ROWS): Generator<string> {
  const guard = options.formulaGuard !== false;
  const cell = (value: string): string => htmlCell(guard ? guardFormula(value) : value);
  const title = htmlText(options.title ?? 'Data');
  yield `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>${title}</title>\n<style>body{font:14px/1.5 system-ui,sans-serif;margin:24px;color:#18181b}table{border-collapse:collapse}th,td{border:1px solid #d4d4d8;padding:4px 10px;text-align:left;vertical-align:top}th{background:#f4f4f5}</style>\n</head>\n<body>\n<table>\n`;
  if (options.includeHeader) {
    yield `<thead><tr>${data.columns.map((column) => `<th>${cell(column.name)}</th>`).join('')}</tr></thead>\n`;
  }
  yield '<tbody>\n';
  let buffer = '';
  for (let r = 0; r < data.rows.length; r++) {
    const row = data.rows[r]!;
    buffer += `<tr>${data.columns.map((_, c) => `<td>${cell(row.cells[c] ?? '')}</td>`).join('')}</tr>\n`;
    if ((r + 1) % chunkRows === 0) {
      yield buffer;
      buffer = '';
    }
  }
  if (buffer) yield buffer;
  yield '</tbody>\n</table>\n</body>\n</html>\n';
}
