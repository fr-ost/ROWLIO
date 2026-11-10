import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import readXlsxFile, { readSheet } from 'read-excel-file/node';
import type { TableData } from '@/types/data';
import { brand } from '@/config/brand';
import {
  XLSX_MAX_CELL_CHARS,
  XLSX_MAX_COLUMNS,
  XLSX_MAX_ROWS,
  XlsxLimitError,
  buildXlsx,
  buildXlsxAsync,
  sanitizeSheetNames,
} from '@/export/xlsx';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

/** Unzip a workbook into { path: xml }. */
function unpack(bytes: Uint8Array): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(unzipSync(bytes))) files[path] = strFromU8(content);
  return files;
}

function sheetXml(data: TableData, typed = true, includeHeader = true): string {
  return unpack(buildXlsx([{ name: 'Data', data }], { typed, includeHeader }))['xl/worksheets/sheet1.xml']!;
}

/** The raw XML of one cell, e.g. cell(xml, 'B2'). */
function cell(xml: string, ref: string): string | null {
  const match = new RegExp(`<c r="${ref}"[^>]*?(?:/>|>.*?</c>)`, 's').exec(xml);
  return match ? match[0] : null;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function assertWellFormed(xml: string, path: string): void {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  expect(error ? `${path}: ${error.textContent}` : '').toBe('');
}

const sample = table(
  ['Name', 'Qty', 'When', 'Note'],
  [
    ['আমার সোনার বাংলা', '42', '2024-01-01', '=1+1'],
    ['Mug 👍', '-3.50', '2024-01-01T10:30:00', ''],
    ['', '00123', 'soon', 'a < b & "c" > d'],
  ],
);

describe('package structure', () => {
  const files = unpack(buildXlsx([{ name: 'First', data: sample }, { name: 'Second', data: table(['x'], [['1']]) }], { typed: true }));

  it('contains every required part, content types first', () => {
    expect(Object.keys(files)).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/app.xml',
      'docProps/core.xml',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
  });

  it('every part is well-formed XML with a declaration', () => {
    for (const [path, xml] of Object.entries(files)) {
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')).toBe(true);
      assertWellFormed(xml, path);
    }
  });

  it('declares the content types of all parts', () => {
    const types = files['[Content_Types].xml']!;
    expect(types).toContain('<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>');
    expect(types).toContain('<Default Extension="xml" ContentType="application/xml"/>');
    expect(types).toContain(
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    );
    for (const n of [1, 2]) {
      expect(types).toContain(
        `<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      );
    }
    expect(types).toContain('PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"');
    expect(types).toContain('PartName="/docProps/core.xml"');
    expect(types).toContain('PartName="/docProps/app.xml"');
  });

  it('wires up the relationships', () => {
    expect(files['_rels/.rels']).toContain('Target="xl/workbook.xml"');
    const rels = files['xl/_rels/workbook.xml.rels']!;
    expect(rels).toContain('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>');
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>');
    const workbook = files['xl/workbook.xml']!;
    expect(workbook).toContain('<sheet name="First" sheetId="1" r:id="rId1"/>');
    expect(workbook).toContain('<sheet name="Second" sheetId="2" r:id="rId2"/>');
  });

  it('names the product as the application, from the brand config', () => {
    expect(files['docProps/app.xml']).toContain(`<Application>${brand.name}</Application>`);
    expect(files['docProps/core.xml']).toContain(`<dc:creator>${brand.name}</dc:creator>`);
    expect(files['docProps/core.xml']).toMatch(/<dcterms:created xsi:type="dcterms:W3CDTF">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/dcterms:created>/);
  });

  it('defines the bold header style and the two date formats', () => {
    const styles = files['xl/styles.xml']!;
    expect(styles).toContain('<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>');
    expect(styles).toContain('<numFmt numFmtId="165" formatCode="yyyy-mm-dd hh:mm:ss"/>');
    expect(styles).toContain('<font><b/>');
    expect(styles).toContain('<cellXfs count="4">');
  });
});

describe('worksheet', () => {
  const xml = sheetXml(sample);

  it('has a dimension, a frozen header row, column widths and an auto-filter over the used range', () => {
    expect(xml).toContain('<dimension ref="A1:D4"/>');
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<autoFilter ref="A1:D4"/>');
    expect(xml.match(/<col /g)).toHaveLength(4);
    // Element order matters to Excel: dimension, sheetViews, sheetFormatPr, cols, sheetData, autoFilter.
    const order = ['<dimension', '<sheetViews', '<sheetFormatPr', '<cols', '<sheetData', '<autoFilter'].map((tag) => xml.indexOf(tag));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const workbook = unpack(buildXlsx([{ name: "It's data", data: sample }], { typed: true }))['xl/workbook.xml']!;
    expect(workbook).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'It''s data'!$A$1:$D$4</definedName>`);
  });

  it('writes the header as bold inline strings with cell references', () => {
    expect(cell(xml, 'A1')).toBe('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Name</t></is></c>');
    expect(cell(xml, 'D1')).toBe('<c r="D1" t="inlineStr" s="1"><is><t xml:space="preserve">Note</t></is></c>');
    expect(xml).toContain('<row r="1">');
    expect(xml).toContain('<row r="4">');
  });

  it('writes text as inline strings and never uses shared strings', () => {
    expect(cell(xml, 'A2')).toBe('<c r="A2" t="inlineStr"><is><t xml:space="preserve">আমার সোনার বাংলা</t></is></c>');
    expect(cell(xml, 'A3')).toBe('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Mug 👍</t></is></c>');
    expect(xml).not.toContain('t="s"');
    expect(Object.keys(unpack(buildXlsx([{ name: 'x', data: sample }], { typed: true })))).not.toContain('xl/sharedStrings.xml');
  });

  it('never writes a formula: "=1+1" stays text', () => {
    expect(cell(xml, 'D2')).toBe('<c r="D2" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>');
    const nasty = table(['=HEADER()'], [['=1+1'], ['=HYPERLINK("http://evil.test","x")'], ['+cmd|\' /C calc\'!A0'], ['@SUM(A1)'], ['-1+1'], ['<f>1+1</f>']]);
    for (const typed of [true, false]) {
      const out = sheetXml(nasty, typed);
      expect(out).not.toMatch(/<f[\s>/]/);
      expect(out).not.toContain('t="str"');
      expect(cell(out, 'A2')).toContain('<is><t xml:space="preserve">=1+1</t></is>');
      expect(cell(out, 'A7')).toContain('&lt;f&gt;1+1&lt;/f&gt;');
    }
  });

  it('omits empty cells but keeps the row', () => {
    expect(cell(xml, 'D3')).toBeNull();
    expect(cell(xml, 'A4')).toBeNull();
    expect(xml).toContain('<row r="4"><c r="B4"');
    const blanks = sheetXml(table(['a', 'b'], [['', ''], ['x', '']]));
    expect(blanks).toContain('<row r="2"></row>');
    // Whitespace-only cells are real content and are preserved.
    expect(cell(sheetXml(table(['a'], [['  ']])), 'A2')).toBe('<c r="A2" t="inlineStr"><is><t xml:space="preserve">  </t></is></c>');
  });

  it('escapes XML special characters in cells, headers and sheet names', () => {
    expect(cell(xml, 'D4')).toContain('a &lt; b &amp; &quot;c&quot; &gt; d');
    const files = unpack(buildXlsx([{ name: 'R&D <2024> "x"', data: table(['a & b <c>'], [['1']]) }], { typed: false }));
    expect(files['xl/workbook.xml']).toContain('<sheet name="R&amp;D &lt;2024&gt; &quot;x&quot;"');
    expect(files['xl/workbook.xml']).toContain("'R&amp;D &lt;2024&gt; &quot;x&quot;'!$A$1:$A$2");
    expect(files['xl/worksheets/sheet1.xml']).toContain('a &amp; b &lt;c&gt;');
    for (const [path, part] of Object.entries(files)) assertWellFormed(part, path);
  });

  it('strips characters that are illegal in XML but keeps astral characters and Bengali intact', () => {
    const data = table(['v'], [
      ['a\u0000b\u0001c\u0008d\u000be\u000cf\u001fg'],
      ['tab\there\nnewline'],
      ['lone high \ud83d surrogate'],
      ['lone low \ude00 surrogate'],
      ['bad ￾ and ￿'],
      ['👍 😀 𝒳 🇧🇩 👨‍👩‍👧'],
      ['আমার সোনার বাংলা, আমি তোমায় ভালোবাসি'],
      ['\ud83d'],
    ]);
    const out = sheetXml(data, false);
    assertWellFormed(out, 'sheet1.xml');
    expect(cell(out, 'A2')).toContain('>abcdefg<');
    expect(cell(out, 'A3')).toContain('>tab\there\nnewline<');
    expect(cell(out, 'A4')).toContain('>lone high  surrogate<');
    expect(cell(out, 'A5')).toContain('>lone low  surrogate<');
    expect(cell(out, 'A6')).toContain('>bad  and <');
    expect(cell(out, 'A7')).toContain('>👍 😀 𝒳 🇧🇩 👨‍👩‍👧<');
    expect(cell(out, 'A8')).toContain('>আমার সোনার বাংলা, আমি তোমায় ভালোবাসি<');
    // A cell that becomes empty after stripping is still a valid (empty) string cell.
    expect(cell(out, 'A9')).toBe('<c r="A9" t="inlineStr"><is><t xml:space="preserve"></t></is></c>');
    expect(out).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/);
  });

  it('keeps carriage returns and protects text that looks like an OOXML escape', () => {
    const out = sheetXml(table(['v'], [['line 1\r\nline 2'], ['literal _x000D_ and _xABCD_ and _x12_']]), false);
    // A raw CR would be turned into LF by XML parsers; a character reference survives.
    expect(cell(out, 'A2')).toContain('line 1&#13;\nline 2');
    // Excel decodes _xHHHH_ sequences, so literal ones get their underscore escaped.
    expect(cell(out, 'A3')).toContain('literal _x005F_x000D_ and _x005F_xABCD_ and _x12_');
  });

  it('computes column widths from the content, clamped to 8–60', () => {
    const data = table(['id', 'A fairly long header name', 'text'], [['1', 'x', 'y'.repeat(500)], ['2', 'x', 'short\nmulti-line cell']]);
    const widths = [...sheetXml(data).matchAll(/<col min="(\d+)" max="\1" width="([\d.]+)" customWidth="1"\/>/g)].map((m) => Number(m[2]));
    expect(widths).toEqual([8, 'A fairly long header name'.length + 2, 60]);
  });

  it('references columns beyond Z correctly', () => {
    const columns = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const out = sheetXml(table(columns, [columns.map((_, i) => `v${i}`)]));
    expect(out).toContain('<dimension ref="A1:AD2"/>');
    expect(cell(out, 'Z2')).toContain('>v25<');
    expect(cell(out, 'AA2')).toContain('>v26<');
    expect(cell(out, 'AD2')).toContain('>v29<');
  });

  it('can omit the header: no bold row, no frozen pane, no filter', () => {
    const out = sheetXml(sample, true, false);
    expect(out).toContain('<dimension ref="A1:D3"/>');
    expect(out).not.toContain('<pane');
    expect(out).not.toContain('<autoFilter');
    expect(out).not.toContain('s="1"');
    expect(cell(out, 'A1')).toContain('আমার সোনার বাংলা');
    expect(unpack(buildXlsx([{ name: 'x', data: sample }], { typed: true, includeHeader: false }))['xl/workbook.xml']).not.toContain('definedName');
  });

  it('handles empty tables', () => {
    const headerOnly = sheetXml(table(['a', 'b'], []));
    expect(headerOnly).toContain('<dimension ref="A1:B1"/>');
    expect(headerOnly).toContain('<autoFilter ref="A1:B1"/>');
    const nothing = unpack(buildXlsx([{ name: 'Empty', data: table([], []) }], { typed: true }));
    expect(nothing['xl/worksheets/sheet1.xml']).toContain('<dimension ref="A1"/>');
    expect(nothing['xl/worksheets/sheet1.xml']).toContain('<sheetData></sheetData>');
    expect(nothing['xl/worksheets/sheet1.xml']).not.toContain('<cols>');
    expect(nothing['xl/worksheets/sheet1.xml']).not.toContain('<autoFilter');
    for (const [path, part] of Object.entries(nothing)) assertWellFormed(part, path);
  });
});

describe('cell typing', () => {
  const numeric = ['0', '7', '42', '-42', '3.14', '-0.5', '0.000123', '123456789012345', '1234567890.12345', '12.50', '100'];
  const textual = [
    '00123', // leading zeros: an identifier, not a number
    '01',
    '+5',
    '1,234',
    '1.234,56',
    '1e5',
    '1E5',
    '.5',
    '5.',
    '-',
    '--5',
    ' 5',
    '5 ',
    '1 000',
    '1234567890123456', // 16 digits: would lose precision
    '0.1234567890123456',
    '123456789.1234567',
    '-0',
    '-0.00',
    'TRUE',
    'false',
    'NaN',
    'Infinity',
    '0x1F',
    '১২৩',
    '12%',
    '$5',
    '5-3',
  ];

  it.each(numeric)('typed: %j is written as a number', (value) => {
    const xml = sheetXml(table(['v'], [[value]]), true);
    expect(cell(xml, 'A2')).toBe(`<c r="A2"><v>${value}</v></c>`);
  });

  it.each(textual)('typed: %j stays a string', (value) => {
    const xml = sheetXml(table(['v'], [[value]]), true);
    expect(cell(xml, 'A2')).toBe(`<c r="A2" t="inlineStr"><is><t xml:space="preserve">${value}</t></is></c>`);
  });

  it.each<[string, number]>([
    ['2024-01-01', 45292],
    ['1970-01-01', 25569],
    ['2000-02-29', 36585],
    ['1900-03-01', 61],
    ['1999-12-31', 36525],
    ['9999-12-31', 2958465],
  ])('typed: %s is written as date serial %d', (value, serial) => {
    const xml = sheetXml(table(['v'], [[value]]), true);
    expect(cell(xml, 'A2')).toBe(`<c r="A2" s="2"><v>${serial}</v></c>`);
  });

  it.each<[string, number]>([
    ['2024-01-01T00:00', 45292],
    ['2024-01-01T12:00', 45292.5],
    ['2024-01-01T10:30:00', 45292.4375],
    ['2024-01-01T18:00:00', 45292.75],
    ['2024-01-01T23:59:59', 45292 + 86399 / 86400],
  ])('typed: %s is written as a date-time serial', (value, serial) => {
    const xml = sheetXml(table(['v'], [[value]]), true);
    const written = /<c r="A2" s="3"><v>([\d.]+)<\/v><\/c>/.exec(xml);
    expect(written).not.toBeNull();
    expect(Number(written![1])).toBeCloseTo(serial, 9);
  });

  it.each([
    '2024-02-30',
    '2023-02-29',
    '1900-02-29', // exists in Excel but not in reality
    // Before 1 March 1900 Excel and LibreOffice / Google Sheets disagree by one day about
    // every serial number, so these stay text – correct in every application.
    '1900-02-28',
    '1900-01-01',
    '1900-01-15T08:00',
    '2024-13-01',
    '2024-00-10',
    '2024-01-00',
    '1899-12-31',
    '0999-01-01',
    '2024-1-5',
    '2024/01/01',
    '01/01/2024',
    '2024-01-01 10:30',
    '2024-01-01T24:00',
    '2024-01-01T10:60',
    '2024-01-01T10:30:60',
    '2024-01-01T10:30:00Z',
    '2024-01-01T10:30:00.123',
    '2024-01-01T10',
    '20240101',
    '31 Jan 2024',
  ])('typed: %j is not treated as a date', (value) => {
    const xml = sheetXml(table(['v'], [[value]]), true);
    const written = cell(xml, 'A2')!;
    expect(written).not.toContain('s="2"');
    expect(written).not.toContain('s="3"');
    // "20240101" is a plain number; everything else stays text.
    if (value === '20240101') expect(written).toBe('<c r="A2"><v>20240101</v></c>');
    else expect(written).toContain('t="inlineStr"');
  });

  it('untyped: everything is a string', () => {
    const xml = sheetXml(table(['a', 'b', 'c'], [['42', '2024-01-01', '2024-01-01T10:30:00']]), false);
    for (const ref of ['A2', 'B2', 'C2']) expect(cell(xml, ref)).toContain('t="inlineStr"');
    expect(xml).not.toContain('<v>');
  });

  it('header names are always strings, even when they look like numbers or dates', () => {
    const xml = sheetXml(table(['2024', '2024-01-01'], [['1', '2']]), true);
    expect(cell(xml, 'A1')).toBe('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">2024</t></is></c>');
    expect(cell(xml, 'B1')).toContain('t="inlineStr"');
  });
});

describe('sheet names', () => {
  it('removes forbidden characters and trims', () => {
    expect(sanitizeSheetNames(['Sales [2024]: Q1/Q2 *final*? \\ok'])).toEqual(['Sales 2024 Q1 Q2 final ok']);
    expect(sanitizeSheetNames(['  padded  '])).toEqual(['padded']);
    expect(sanitizeSheetNames(['tab\there\nnewline'])).toEqual(['tab here newline']);
    for (const name of sanitizeSheetNames(['a[b]c:d*e?f/g\\h', '[]:*?/\\'])) expect(name).not.toMatch(/[[\]:*?/\\]/);
  });

  it('limits names to 31 characters without splitting a surrogate pair', () => {
    const [long] = sanitizeSheetNames(['x'.repeat(50)]);
    expect(long).toBe('x'.repeat(31));
    const [emoji] = sanitizeSheetNames([`${'x'.repeat(30)}👍tail`]);
    expect(emoji).toBe('x'.repeat(30));
    const [bengali] = sanitizeSheetNames(['আমার সোনার বাংলা আমি তোমায় ভালোবাসি চিরদিন']);
    expect(bengali!.length).toBeLessThanOrEqual(31);
    expect('আমার সোনার বাংলা আমি তোমায় ভালোবাসি চিরদিন'.startsWith(bengali!)).toBe(true);
  });

  it('never returns an empty name', () => {
    expect(sanitizeSheetNames(['', '   ', '[]', "'''"])).toEqual(['Sheet 1', 'Sheet 2', 'Sheet 3', 'Sheet 4']);
  });

  it('strips leading and trailing apostrophes but keeps inner ones', () => {
    expect(sanitizeSheetNames(["'quoted'", "it's", "' spaced '", "''x''"])).toEqual(['quoted', "it's", 'spaced', 'x']);
    // Truncation must not leave a trailing apostrophe either.
    const [cut] = sanitizeSheetNames([`${'a'.repeat(30)}'b`]);
    expect(cut).toBe('a'.repeat(30));
  });

  it('makes names unique, ignoring case, within the length limit', () => {
    expect(sanitizeSheetNames(['Data', 'Data', 'data', 'DATA'])).toEqual(['Data', 'Data (2)', 'data (3)', 'DATA (4)']);
    expect(sanitizeSheetNames(['a/b', 'a:b', 'a b'])).toEqual(['a b', 'a b (2)', 'a b (3)']);
    const long = sanitizeSheetNames(['y'.repeat(40), 'y'.repeat(40), 'y'.repeat(40)]);
    expect(long).toEqual(['y'.repeat(31), `${'y'.repeat(27)} (2)`, `${'y'.repeat(27)} (3)`]);
    expect(new Set(long.map((name) => name.toLowerCase())).size).toBe(3);
    // A generated suffix must not collide with a name that is already taken.
    expect(sanitizeSheetNames(['A', 'A (2)', 'A'])).toEqual(['A', 'A (2)', 'A (3)']);
  });

  it('avoids the name Excel reserves', () => {
    expect(sanitizeSheetNames(['History', 'history'])).toEqual(['History_', 'history_ (2)']);
  });

  it('is applied when building a workbook', () => {
    const files = unpack(buildXlsx([{ name: 'Q1/Q2', data: sample }, { name: 'Q1:Q2', data: sample }, { name: '', data: sample }], { typed: false }));
    const workbook = files['xl/workbook.xml']!;
    expect(workbook).toContain('<sheet name="Q1 Q2" sheetId="1"');
    expect(workbook).toContain('<sheet name="Q1 Q2 (2)" sheetId="2"');
    expect(workbook).toContain('<sheet name="Sheet 3" sheetId="3"');
  });
});

describe('format limits', () => {
  it('throws XlsxLimitError naming the sheet, column and row for an over-long cell', () => {
    const data = table(['id', 'Description'], [['1', 'ok'], ['2', 'x'.repeat(XLSX_MAX_CELL_CHARS)], ['3', 'y'.repeat(XLSX_MAX_CELL_CHARS + 1)]]);
    let error: unknown;
    try {
      buildXlsx([{ name: 'Products', data }], { typed: true });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(XlsxLimitError);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect((error as Error).name).toBe('XlsxLimitError');
    expect(message).toContain('"Products"');
    expect(message).toContain('"Description"');
    expect(message).toContain('row 3');
    expect(message).toContain('32,768');
    expect(message).toContain('32,767');
  });

  it('accepts a cell of exactly 32,767 characters without truncating it', () => {
    const value = 'চ'.repeat(XLSX_MAX_CELL_CHARS);
    const xml = sheetXml(table(['v'], [[value]]), false);
    expect(cell(xml, 'A2')).toContain(`>${value}<`);
  });

  it('applies the limit to header names and in untyped mode too', () => {
    expect(() => buildXlsx([{ name: 's', data: table(['h'.repeat(40_000)], [['1']]) }], { typed: false })).toThrow(XlsxLimitError);
    expect(() => buildXlsx([{ name: 's', data: table(['h'], [['9'.repeat(40_000)]]) }], { typed: true })).toThrow(XlsxLimitError);
    expect(() => buildXlsx([{ name: 's', data: table(['h'], [['z'.repeat(40_000)]]) }], { typed: false })).toThrow(/row 1/);
  });

  it('rejects more columns than a sheet can hold', () => {
    const columns = Array.from({ length: XLSX_MAX_COLUMNS + 1 }, (_, i) => ({ id: `c${i}`, name: `c${i}` }));
    const wide: TableData = { columns, rows: [] };
    expect(() => buildXlsx([{ name: 'Wide', data: wide }], { typed: false })).toThrow(XlsxLimitError);
    expect(() => buildXlsx([{ name: 'Wide', data: wide }], { typed: false })).toThrow(/"Wide" has 16,385 columns.*16,384/);
    const fits: TableData = { columns: columns.slice(0, XLSX_MAX_COLUMNS), rows: [] };
    expect(() => buildXlsx([{ name: 'Wide', data: fits }], { typed: false })).not.toThrow();
  });

  it('rejects more rows than a sheet can hold, counting the header', () => {
    // One shared row object: the limit check must happen before any row is serialised.
    const row = { id: 1, cells: ['x'] };
    const tall: TableData = { columns: [{ id: 'a', name: 'a' }], rows: new Array(XLSX_MAX_ROWS).fill(row) };
    expect(() => buildXlsx([{ name: 'Tall', data: tall }], { typed: false })).toThrow(XlsxLimitError);
    expect(() => buildXlsx([{ name: 'Tall', data: tall }], { typed: false })).toThrow(/"Tall" has 1,048,577 rows.*1,048,576/);
  });

  it('refuses to build a workbook without sheets', () => {
    expect(() => buildXlsx([], { typed: true })).toThrow(/nothing to export/i);
  });

  it('the async builder reports the same errors', async () => {
    const data = table(['v'], [['x'.repeat(40_000)]]);
    await expect(buildXlsxAsync([{ name: 'S', data }], { typed: true })).rejects.toBeInstanceOf(XlsxLimitError);
    await expect(buildXlsxAsync([], { typed: true })).rejects.toThrow(/nothing to export/i);
  });
});

describe('progress', () => {
  it('reports rows written across all sheets and ends at the total', () => {
    const a = table(['n'], Array.from({ length: 4500 }, (_, i) => [String(i)]));
    const b = table(['n'], Array.from({ length: 1500 }, (_, i) => [String(i)]));
    const calls: [number, number][] = [];
    buildXlsx([{ name: 'a', data: a }, { name: 'b', data: b }], { typed: true, onProgress: (done, total) => calls.push([done, total]) });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every(([, total]) => total === 6000)).toBe(true);
    expect(calls.map(([done]) => done)).toEqual([...calls.map(([done]) => done)].sort((x, y) => x - y));
    expect(calls.at(-1)).toEqual([6000, 6000]);
  });

  it('reports once for an empty workbook', () => {
    const calls: [number, number][] = [];
    buildXlsx([{ name: 'a', data: table(['n'], []) }], { typed: true, onProgress: (done, total) => calls.push([done, total]) });
    expect(calls).toEqual([[0, 0]]);
  });
});

describe('independent round trip with read-excel-file', () => {
  it('reads back rows, Bengali text, emoji and typed values', async () => {
    const bytes = buildXlsx([{ name: 'Data', data: sample }], { typed: true });
    const rows = await readSheet(Buffer.from(bytes), { trim: false });
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(['Name', 'Qty', 'When', 'Note']);
    expect(rows[1]![0]).toBe('আমার সোনার বাংলা');
    expect(rows[1]![1]).toBe(42);
    expect(typeof rows[1]![1]).toBe('number');
    expect(rows[1]![2]).toBeInstanceOf(Date);
    expect((rows[1]![2] as unknown as Date).toISOString()).toBe('2024-01-01T00:00:00.000Z');
    // The formula-looking text comes back as the literal string.
    expect(rows[1]![3]).toBe('=1+1');
    expect(rows[2]![0]).toBe('Mug 👍');
    expect(rows[2]![1]).toBe(-3.5);
    expect((rows[2]![2] as unknown as Date).toISOString()).toBe('2024-01-01T10:30:00.000Z');
    expect(rows[2]![3]).toBeNull();
    expect(rows[3]).toEqual([null, '00123', 'soon', 'a < b & "c" > d']);
  });

  it('reads everything back as strings when typing is off', async () => {
    const bytes = buildXlsx([{ name: 'Data', data: sample }], { typed: false });
    const rows = await readSheet(Buffer.from(bytes), { trim: false });
    expect(rows[1]).toEqual(['আমার সোনার বাংলা', '42', '2024-01-01', '=1+1']);
    expect(rows[2]).toEqual(['Mug 👍', '-3.50', '2024-01-01T10:30:00', null]);
  });

  it('preserves whitespace, line breaks and awkward characters', async () => {
    const data = table(['v'], [['  padded  '], ['line 1\nline 2'], ['crlf\r\nline'], ['tab\tsep'], ["it's \"quoted\" & <tagged>"], ['দাম: ১২,৩৪৫.৫০ টাকা']]);
    const rows = await readSheet(Buffer.from(buildXlsx([{ name: 'Data', data }], { typed: true })), { trim: false });
    expect(rows.slice(1).map((row) => row[0])).toEqual(data.rows.map((row) => row.cells[0]));
  });

  it('reads all sheets with their sanitised names', async () => {
    const second = table(['x', 'y'], [['1', 'চা'], ['2', 'কফি']]);
    const bytes = buildXlsx([{ name: 'Sales/2024', data: sample }, { name: 'বাংলা শিট', data: second }], { typed: true });
    const sheets = await readXlsxFile(Buffer.from(bytes), { trim: false });
    expect(sheets.map((sheet) => sheet.sheet)).toEqual(['Sales 2024', 'বাংলা শিট']);
    expect(sheets[0]!.data).toHaveLength(4);
    expect(sheets[1]!.data).toEqual([['x', 'y'], [1, 'চা'], [2, 'কফি']]);
  });

  it('builds and round-trips a 50,000 × 8 sheet in reasonable time', async () => {
    const columns = ['id', 'name', 'price', 'date', 'url', 'note', 'বাংলা', 'flag'];
    const rows: string[][] = [];
    for (let i = 0; i < 50_000; i++) {
      rows.push([String(i + 1), `Product ${i}`, (i * 1.25).toFixed(2), '2024-01-01', `https://example.test/p/${i}`, i % 10 === 0 ? '' : `note & <${i}>`, `পণ্য ${i}`, i % 2 === 0 ? 'yes' : 'no']);
    }
    const data = table(columns, rows);

    const started = performance.now();
    const bytes = buildXlsx([{ name: 'Big', data }], { typed: true });
    const buildMs = performance.now() - started;
    expect(buildMs).toBeLessThan(20_000);
    expect(bytes.length).toBeGreaterThan(100_000);

    const read = await readSheet(Buffer.from(bytes), { trim: false });
    expect(read).toHaveLength(50_001);
    expect(read[0]).toEqual(columns);
    expect(read[1]).toEqual([1, 'Product 0', 0, new Date('2024-01-01T00:00:00.000Z'), 'https://example.test/p/0', null, 'পণ্য 0', 'yes']);
    expect(read[50_000]).toEqual([50_000, 'Product 49999', 62498.75, new Date('2024-01-01T00:00:00.000Z'), 'https://example.test/p/49999', 'note & <49999>', 'পণ্য 49999', 'no']);
    expect(read[25_000]![6]).toBe('পণ্য 24999');
  }, 120_000);
});

describe('buildXlsxAsync', () => {
  it('produces an equivalent workbook in parts', async () => {
    const second = table(['x'], [['1'], ['2']]);
    const sheets = [{ name: 'Data', data: sample }, { name: 'More', data: second }];
    const parts = await buildXlsxAsync(sheets, { typed: true });
    expect(parts.length).toBeGreaterThan(1);
    const streamed = unpack(join(parts));
    const direct = unpack(buildXlsx(sheets, { typed: true }));
    expect(Object.keys(streamed)).toEqual(Object.keys(direct));
    for (const path of Object.keys(direct)) {
      // The creation timestamp may differ by a second between the two builds.
      if (path === 'docProps/core.xml') continue;
      expect(streamed[path]).toBe(direct[path]);
    }
    const read = await readXlsxFile(Buffer.from(join(parts)), { trim: false });
    expect(read.map((sheet) => sheet.sheet)).toEqual(['Data', 'More']);
    expect(read[0]!.data[1]![0]).toBe('আমার সোনার বাংলা');
    expect(read[1]!.data).toEqual([['x'], [1], [2]]);
  });

  it('reports progress up to the total and can be cancelled', async () => {
    const data = table(['n', 't'], Array.from({ length: 30_000 }, (_, i) => [String(i), `row ${i}`]));
    const calls: [number, number][] = [];
    const parts = await buildXlsxAsync([{ name: 'Data', data }], { typed: true, onProgress: (done, total) => calls.push([done, total]) });
    expect(calls.length).toBeGreaterThan(5);
    expect(calls.at(-1)).toEqual([30_000, 30_000]);
    expect(await readSheet(Buffer.from(join(parts)))).toHaveLength(30_001);

    const controller = new AbortController();
    controller.abort();
    // An already-aborted signal stops the build at the first yield point; small builds may
    // finish before one is reached, so use data large enough to need several slices.
    const big = table(['n', 't'], Array.from({ length: 200_000 }, (_, i) => [String(i), `row ${i}`]));
    await expect(buildXlsxAsync([{ name: 'Data', data: big }], { typed: true, signal: controller.signal })).rejects.toThrow(/cancel/i);
  }, 120_000);
});
