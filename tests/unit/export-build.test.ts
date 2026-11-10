import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { readSheet } from 'read-excel-file/node';
import type { TableData } from '@/types/data';
import type { ExportFormat, ExportOptions } from '@/types/transforms';
import { brand } from '@/config/brand';
import { EXTENSION, MIME, XlsxLimitError, buildExport, exportFilename, parseDelimited } from '@/export';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

function options(format: ExportFormat, partial: Partial<ExportOptions> = {}): ExportOptions {
  return {
    format,
    delimiter: ',',
    bom: false,
    formulaGuard: false,
    jsonPretty: false,
    xlsxTypes: true,
    includeHeader: true,
    ...partial,
  };
}

/** Bytes of a Blob, whatever the Blob implementation of the test environment offers. */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsArrayBuffer(blob);
  });
}

async function textOf(blob: Blob): Promise<string> {
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(await bytesOf(blob));
}

const data = table(
  ['Name', 'Price', 'Note'],
  [
    ['আমার সোনার বাংলা', '১২০', 'line 1\nline 2'],
    ['Mug 👍', '42', '=1+1'],
    ['Tea, green', '-3.50', ''],
  ],
);
const sheets = [{ name: 'Products', data }];

describe('buildExport formats', () => {
  it.each<[ExportFormat, string, string]>([
    ['csv', 'csv', 'text/csv;charset=utf-8'],
    ['tsv', 'tsv', 'text/tab-separated-values;charset=utf-8'],
    ['json', 'json', 'application/json;charset=utf-8'],
    ['jsonl', 'jsonl', 'application/x-ndjson;charset=utf-8'],
    ['xlsx', 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('%s has extension .%s and MIME type %s', async (format, extension, mime) => {
    const result = await buildExport(sheets, options(format));
    expect(result.extension).toBe(extension);
    expect(result.mime).toBe(mime);
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.type).toBe(mime);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(MIME[format]).toBe(mime);
    expect(EXTENSION[format]).toBe(extension);
  });

  it('CSV content is UTF-8 with CRLF and round-trips', async () => {
    const result = await buildExport(sheets, options('csv'));
    const text = await textOf(result.blob);
    expect(text).toBe('Name,Price,Note\r\nআমার সোনার বাংলা,১২০,"line 1\nline 2"\r\nMug 👍,42,=1+1\r\n"Tea, green",-3.50,\r\n');
    expect(parseDelimited(text, ',')).toEqual([data.columns.map((c) => c.name), ...data.rows.map((r) => r.cells)]);
    // Bengali is encoded as UTF-8: আ = E0 A6 86.
    const bytes = await bytesOf(result.blob);
    const start = 'Name,Price,Note\r\n'.length;
    expect([...bytes.slice(start, start + 3)]).toEqual([0xe0, 0xa6, 0x86]);
  });

  it('CSV honours the delimiter, the formula guard and includeHeader', async () => {
    const semicolon = await textOf((await buildExport(sheets, options('csv', { delimiter: ';' }))).blob);
    expect(semicolon.split('\r\n')[0]).toBe('Name;Price;Note');
    expect(semicolon).toContain('Tea, green;-3.50;');

    const guarded = await textOf((await buildExport(sheets, options('csv', { formulaGuard: true }))).blob);
    expect(guarded).toContain("Mug 👍,42,'=1+1\r\n");
    expect(guarded).toContain('"Tea, green",-3.50,\r\n');

    const headless = await textOf((await buildExport(sheets, options('csv', { includeHeader: false }))).blob);
    expect(headless.startsWith('আমার সোনার বাংলা,')).toBe(true);
  });

  it('TSV uses tabs regardless of the CSV delimiter option', async () => {
    const text = await textOf((await buildExport(sheets, options('tsv', { delimiter: ';' }))).blob);
    expect(text).toBe('Name\tPrice\tNote\r\nআমার সোনার বাংলা\t১২০\t"line 1\nline 2"\r\nMug 👍\t42\t=1+1\r\nTea, green\t-3.50\t\r\n');
    expect(parseDelimited(text, '\t')).toHaveLength(4);
  });

  it('JSON honours jsonPretty and is valid either way', async () => {
    const compact = await textOf((await buildExport(sheets, options('json'))).blob);
    const pretty = await textOf((await buildExport(sheets, options('json', { jsonPretty: true }))).blob);
    const expected = [
      { Name: 'আমার সোনার বাংলা', Price: '১২০', Note: 'line 1\nline 2' },
      { Name: 'Mug 👍', Price: '42', Note: '=1+1' },
      { Name: 'Tea, green', Price: '-3.50', Note: '' },
    ];
    expect(JSON.parse(compact)).toEqual(expected);
    expect(JSON.parse(pretty)).toEqual(expected);
    expect(compact).toBe(JSON.stringify(expected));
    expect(pretty).toBe(JSON.stringify(expected, null, 2));
  });

  it('JSON Lines has one parseable object per line', async () => {
    const text = await textOf((await buildExport(sheets, options('jsonl'))).blob);
    const lines = text.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => (JSON.parse(line) as { Name: string }).Name)).toEqual(['আমার সোনার বাংলা', 'Mug 👍', 'Tea, green']);
  });

  it('XLSX is a readable workbook that honours xlsxTypes and includeHeader', async () => {
    const typed = await bytesOf((await buildExport(sheets, options('xlsx'))).blob);
    // ZIP local file header signature.
    expect([...typed.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Object.keys(unzipSync(typed))).toContain('xl/worksheets/sheet1.xml');
    const rows = await readSheet(Buffer.from(typed), { trim: false });
    expect(rows).toEqual([
      ['Name', 'Price', 'Note'],
      ['আমার সোনার বাংলা', '১২০', 'line 1\nline 2'],
      ['Mug 👍', 42, '=1+1'],
      ['Tea, green', -3.5, null],
    ]);

    const untyped = await bytesOf((await buildExport(sheets, options('xlsx', { xlsxTypes: false, includeHeader: false }))).blob);
    expect(await readSheet(Buffer.from(untyped), { trim: false })).toEqual([
      ['আমার সোনার বাংলা', '১২০', 'line 1\nline 2'],
      ['Mug 👍', '42', '=1+1'],
      ['Tea, green', '-3.50', null],
    ]);
    // The formula guard is a CSV concern: XLSX text cells are inert, so nothing is prefixed.
    const guarded = await bytesOf((await buildExport(sheets, options('xlsx', { formulaGuard: true }))).blob);
    const xml = strFromU8(unzipSync(guarded)['xl/worksheets/sheet1.xml']!);
    expect(xml).toContain('<t xml:space="preserve">=1+1</t>');
    expect(xml).not.toMatch(/<f[\s>/]/);
  });

  it('XLSX accepts several sheets', async () => {
    const more = [...sheets, { name: 'Second', data: table(['x'], [['1']]) }];
    const bytes = await bytesOf((await buildExport(more, options('xlsx'))).blob);
    const workbook = strFromU8(unzipSync(bytes)['xl/workbook.xml']!);
    expect(workbook).toContain('<sheet name="Products"');
    expect(workbook).toContain('<sheet name="Second"');
  });
});

describe('byte order mark', () => {
  const BOM = [0xef, 0xbb, 0xbf];

  it.each<ExportFormat>(['csv', 'tsv'])('%s starts with EF BB BF when requested', async (format) => {
    const withBom = await bytesOf((await buildExport(sheets, options(format, { bom: true }))).blob);
    expect([...withBom.slice(0, 3)]).toEqual(BOM);
    // Exactly one BOM, followed directly by the header.
    expect([...withBom.slice(3, 7)]).toEqual([...new TextEncoder().encode('Name')]);

    const without = await bytesOf((await buildExport(sheets, options(format, { bom: false }))).blob);
    expect([...without.slice(0, 3)]).not.toEqual(BOM);
    expect(withBom.length).toBe(without.length + 3);
    expect([...withBom.slice(3)]).toEqual([...without]);
  });

  it('the BOM does not disturb parsing', async () => {
    const text = await textOf((await buildExport(sheets, options('csv', { bom: true }))).blob);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(parseDelimited(text, ',')[0]).toEqual(['Name', 'Price', 'Note']);
  });

  it.each<ExportFormat>(['json', 'jsonl', 'xlsx'])('%s never gets a BOM', async (format) => {
    const bytes = await bytesOf((await buildExport(sheets, options(format, { bom: true }))).blob);
    expect([...bytes.slice(0, 3)]).not.toEqual(BOM);
  });
});

describe('progress', () => {
  const big = table(['n', 'label'], Array.from({ length: 7001 }, (_, i) => [String(i), `সারি ${i}`]));

  it.each<ExportFormat>(['csv', 'tsv', 'json', 'jsonl', 'xlsx'])('%s reports real, monotonic progress that reaches the total', async (format) => {
    const calls: [number, number][] = [];
    const result = await buildExport([{ name: 'Big', data: big }], options(format), (done, total) => calls.push([done, total]));
    expect(result.blob.size).toBeGreaterThan(7001);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every(([, total]) => total === 7001)).toBe(true);
    const done = calls.map(([value]) => value);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.every((value) => value >= 0 && value <= 7001)).toBe(true);
    expect(calls.at(-1)).toEqual([7001, 7001]);
    // The total is announced exactly once, at the end.
    expect(done.filter((value) => value === 7001)).toHaveLength(1);
  });

  it('the exported file is complete', async () => {
    const csv = await textOf((await buildExport([{ name: 'Big', data: big }], options('csv'))).blob);
    const records = parseDelimited(csv, ',');
    expect(records).toHaveLength(7002);
    expect(records[7001]).toEqual(['7000', 'সারি 7000']);
    const json = JSON.parse(await textOf((await buildExport([{ name: 'Big', data: big }], options('json', { jsonPretty: true }))).blob)) as unknown[];
    expect(json).toHaveLength(7001);
    const jsonl = (await textOf((await buildExport([{ name: 'Big', data: big }], options('jsonl'))).blob)).trimEnd().split('\n');
    expect(jsonl).toHaveLength(7001);
    expect(JSON.parse(jsonl[7000]!)).toEqual({ n: '7000', label: 'সারি 7000' });
  });

  it('reports (0, 0) for an empty table and still produces a valid file', async () => {
    const empty = [{ name: 'Empty', data: table(['a', 'b'], []) }];
    for (const format of ['csv', 'tsv', 'json', 'jsonl', 'xlsx'] as const) {
      const calls: [number, number][] = [];
      const result = await buildExport(empty, options(format), (done, total) => calls.push([done, total]));
      expect(calls).toEqual([[0, 0]]);
      if (format === 'csv') expect(await textOf(result.blob)).toBe('a,b\r\n');
      if (format === 'json') expect(await textOf(result.blob)).toBe('[]');
      if (format === 'jsonl') expect(result.blob.size).toBe(0);
    }
  });

  it('works without a progress callback', async () => {
    await expect(buildExport(sheets, options('csv'))).resolves.toBeDefined();
  });
});

describe('errors', () => {
  const two = [...sheets, { name: 'Second', data: table(['x'], [['1']]) }];

  it.each<ExportFormat>(['csv', 'tsv', 'json', 'jsonl'])('%s refuses several sheets with a clear message', async (format) => {
    await expect(buildExport(two, options(format))).rejects.toThrow(/only one table/);
    await expect(buildExport(two, options(format))).rejects.toThrow(format.toUpperCase());
  });

  it('refuses to export nothing', async () => {
    for (const format of ['csv', 'xlsx'] as const) {
      await expect(buildExport([], options(format))).rejects.toThrow(/nothing to export/i);
    }
  });

  it('surfaces XLSX format limits', async () => {
    const tooLong = [{ name: 'Long', data: table(['v'], [['x'.repeat(40_000)]]) }];
    await expect(buildExport(tooLong, options('xlsx'))).rejects.toBeInstanceOf(XlsxLimitError);
    // The same data is fine as CSV.
    const csv = await buildExport(tooLong, options('csv'));
    expect(csv.blob.size).toBe('v\r\n'.length + 40_000 + 2);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const big = table(['n', 'label'], Array.from({ length: 400_000 }, (_, i) => [String(i), `row ${i}`]));
    await expect(buildExport([{ name: 'Big', data: big }], options('csv'), undefined, controller.signal)).rejects.toThrow(/cancel/i);
  }, 60_000);
});

describe('exportFilename', () => {
  const date = new Date(2024, 0, 31, 9, 5, 7);

  it('builds prefix-slug-date-time.ext in local time', () => {
    expect(exportFilename('Price List (2024)', 'csv', date)).toBe(`${brand.filePrefix}-price-list-2024-20240131-090507.csv`);
    expect(exportFilename('Products', 'xlsx', new Date(2025, 11, 1, 23, 59, 59))).toBe(`${brand.filePrefix}-products-20251201-235959.xlsx`);
  });

  it.each<ExportFormat>(['csv', 'tsv', 'json', 'jsonl', 'xlsx'])('uses the .%s extension', (format) => {
    expect(exportFilename('x', format, date).endsWith(`.${format}`)).toBe(true);
  });

  it('falls back to "data" when the name has nothing usable', () => {
    expect(exportFilename('', 'json', date)).toBe(`${brand.filePrefix}-data-20240131-090507.json`);
    expect(exportFilename('  ///  ', 'json', date)).toBe(`${brand.filePrefix}-data-20240131-090507.json`);
  });

  it('never contains characters that are unsafe in file names', () => {
    const name = exportFilename('a/b\\c:d*e?f"g<h>i|j\u0000k\nl', 'csv', date);
    expect(name).not.toMatch(/[\\/:*?"<>|\u0000-\u001f]/);
    expect(name.startsWith(`${brand.filePrefix}-`)).toBe(true);
  });

  it('defaults to the current time', () => {
    expect(exportFilename('x', 'csv')).toMatch(new RegExp(`^${brand.filePrefix}-x-\\d{8}-\\d{6}\\.csv$`));
  });
});
