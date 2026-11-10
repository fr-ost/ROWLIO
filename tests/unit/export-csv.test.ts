import { describe, expect, it } from 'vitest';
import type { TableData } from '@/types/data';
import { delimitedChunks, parseDelimited, toDelimited } from '@/export/csv';
import type { DelimitedOptions } from '@/export/csv';
import { guardFormula, isFormulaLike } from '@/export/formula';
import { clipboardText } from '@/export';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

const CSV: DelimitedOptions = { delimiter: ',', formulaGuard: false, includeHeader: true };
const matrix = (data: TableData): string[][] => [data.columns.map((c) => c.name), ...data.rows.map((r) => r.cells)];

describe('CSV writer', () => {
  it('writes a header and rows with CRLF line endings, including after the last row', () => {
    const data = table(['Name', 'Price'], [['Tea', '120'], ['Coffee', '200']]);
    expect(toDelimited(data, CSV)).toBe('Name,Price\r\nTea,120\r\nCoffee,200\r\n');
  });

  it('can use LF and can omit the header', () => {
    const data = table(['Name', 'Price'], [['Tea', '120']]);
    expect(toDelimited(data, { ...CSV, lineEnding: '\n' })).toBe('Name,Price\nTea,120\n');
    expect(toDelimited(data, { ...CSV, includeHeader: false })).toBe('Tea,120\r\n');
  });

  it('quotes fields containing the delimiter, quotes or line breaks, doubling embedded quotes', () => {
    const data = table(
      ['a', 'b'],
      [
        ['one, two', 'plain'],
        ['say "hi"', '"'],
        ['line 1\nline 2', 'cr\rhere'],
        ['crlf\r\nhere', 'semi;colon'],
      ],
    );
    expect(toDelimited(data, { ...CSV, includeHeader: false })).toBe(
      '"one, two",plain\r\n' +
        '"say ""hi""",""""\r\n' +
        '"line 1\nline 2","cr\rhere"\r\n' +
        '"crlf\r\nhere",semi;colon\r\n',
    );
  });

  it('quotes fields with leading or trailing whitespace so importers do not trim them', () => {
    const data = table(['a', 'b', 'c', 'd'], [[' lead', 'trail ', '\ttab', 'in side'], [' nbsp', 'ok', '', ' ']]);
    expect(toDelimited(data, { ...CSV, includeHeader: false })).toBe(
      '" lead","trail ","\ttab",in side\r\n' + '" nbsp",ok,," "\r\n',
    );
  });

  it('escapes header names the same way as cells', () => {
    const data = table(['Name, full', 'He said "x"', ' padded '], [['1', '2', '3']]);
    expect(toDelimited(data, CSV)).toBe('"Name, full","He said ""x"""," padded "\r\n1,2,3\r\n');
  });

  it('keeps empty cells empty and preserves the column order in every row', () => {
    const data = table(['c', 'a', 'b'], [['3', '', '2'], ['', '', ''], ['x', 'y', 'z']]);
    const text = toDelimited(data, CSV);
    expect(text).toBe('c,a,b\r\n3,,2\r\n,,\r\nx,y,z\r\n');
    for (const record of parseDelimited(text, ',')) expect(record).toHaveLength(3);
  });

  it('writes Unicode untouched: Bengali, emoji, combining characters', () => {
    const data = table(['শিরোনাম', 'Emoji'], [['আমার সোনার বাংলা', '👨‍👩‍👧 🇧🇩'], ['দাম: ১২,৩৪৫.৫০ টাকা', 'é']]);
    const text = toDelimited(data, CSV);
    expect(text).toBe('শিরোনাম,Emoji\r\nআমার সোনার বাংলা,👨‍👩‍👧 🇧🇩\r\n"দাম: ১২,৩৪৫.৫০ টাকা",é\r\n');
    expect(parseDelimited(text, ',')).toEqual(matrix(data));
  });

  it('supports a semicolon delimiter: semicolons are quoted, commas are not', () => {
    const data = table(['a', 'b'], [['1,5', 'x;y'], ['plain', 'q"q']]);
    const text = toDelimited(data, { ...CSV, delimiter: ';' });
    expect(text).toBe('a;b\r\n1,5;"x;y"\r\nplain;"q""q"\r\n');
    expect(parseDelimited(text, ';')).toEqual(matrix(data));
  });

  it('writes TSV with the same quoting rules, so tabs and newlines in values survive', () => {
    const data = table(['Name', 'Note'], [['a\tb', 'line 1\nline 2'], ['comma, ok', 'quote " here'], ['বাংলা', '']]);
    const text = toDelimited(data, { ...CSV, delimiter: '\t' });
    expect(text).toBe('Name\tNote\r\n"a\tb"\t"line 1\nline 2"\r\ncomma, ok\t"quote "" here"\r\nবাংলা\t\r\n');
    expect(parseDelimited(text, '\t')).toEqual(matrix(data));
  });

  it('keeps single-column rows with an empty value as records', () => {
    const data = table(['only'], [['a'], [''], ['b']]);
    const text = toDelimited(data, CSV);
    expect(text).toBe('only\r\na\r\n""\r\nb\r\n');
    expect(parseDelimited(text, ',')).toEqual([['only'], ['a'], [''], ['b']]);
  });

  it('handles empty data', () => {
    expect(toDelimited(table(['a', 'b'], []), CSV)).toBe('a,b\r\n');
    expect(toDelimited(table(['a', 'b'], []), { ...CSV, includeHeader: false })).toBe('');
    expect(toDelimited(table([], []), CSV)).toBe('');
  });

  it('rejects an empty delimiter', () => {
    expect(() => toDelimited(table(['a'], [['1']]), { ...CSV, delimiter: '' })).toThrow(/delimiter/i);
    expect(() => parseDelimited('a,b', '')).toThrow(/delimiter/i);
  });

  it('yields chunks of the requested number of rows that concatenate to the full document', () => {
    const rows = Array.from({ length: 2505 }, (_, i) => [String(i), `row ${i}`]);
    const data = table(['n', 'label'], rows);
    const chunks = [...delimitedChunks(data, { ...CSV, chunkRows: 1000 })];
    expect(chunks).toHaveLength(3);
    // The header travels with the first chunk.
    expect(chunks[0]!.split('\r\n')).toHaveLength(1001 + 1);
    expect(chunks[2]!.split('\r\n')).toHaveLength(505 + 1);
    expect(chunks.join('')).toBe(toDelimited(data, CSV));
    expect(parseDelimited(chunks.join(''), ',')).toHaveLength(2506);

    // Default chunk size is 2000 rows.
    expect([...delimitedChunks(data, CSV)]).toHaveLength(2);
    // An exact multiple does not produce an empty trailing chunk.
    const exact = table(['n'], Array.from({ length: 2000 }, (_, i) => [String(i)]));
    expect([...delimitedChunks(exact, { ...CSV, chunkRows: 1000 })]).toHaveLength(2);
  });
});

describe('formula-injection guard', () => {
  const dangerous = [
    '=SUM(A1)',
    '=1+1',
    '=HYPERLINK("http://evil.test","click")',
    "=cmd|' /C calc'!A0",
    '+cmd|\' /C calc\'!A0',
    '+880 1711-000000',
    '+1+1',
    '-1+1',
    '-2+3+cmd|\' /C calc\'!A0',
    '-A1',
    '--5',
    '- 5',
    '-',
    '+',
    '@cmd',
    '@SUM(1+1)',
    '\t=1+1',
    '\r=1+1',
    '\n=1+1',
    '\tplain',
    '＝1+1', // fullwidth forms
    '＋1',
    '－1',
    '＠cmd',
    '-1e5',
    '-5 apples',
    '+A',
    '-12.50\n=1+1',
  ];

  const harmless = [
    '',
    'hello',
    '12',
    '-12.50',
    '+3',
    '-1,200',
    '-1 200,50',
    '+12.5%',
    '-0',
    '5-3',
    'a=b',
    'user@example.com',
    'x+y',
    '1-800-555-0100',
    ' =1+1', // a leading space makes it text in spreadsheets; the field is quoted instead
    "'=1+1",
    'বাংলা',
    '👍',
    '−5', // U+2212 is not interpreted as a formula operator
  ];

  it.each(dangerous)('guards %j', (value) => {
    expect(isFormulaLike(value)).toBe(true);
    expect(guardFormula(value)).toBe(`'${value}`);
  });

  it.each(harmless)('leaves %j alone', (value) => {
    expect(isFormulaLike(value)).toBe(false);
    expect(guardFormula(value)).toBe(value);
  });

  it('is applied to cells and header names when enabled, and only then', () => {
    const data = table(['=HEADER()', 'n'], [['=1+1', '-12.50'], ['@cmd', '+880 1711-000000'], ['safe', '-5']]);
    const guarded = parseDelimited(toDelimited(data, { ...CSV, formulaGuard: true }), ',');
    expect(guarded).toEqual([
      ["'=HEADER()", 'n'],
      ["'=1+1", '-12.50'],
      ["'@cmd", "'+880 1711-000000"],
      ['safe', '-5'],
    ]);
    const raw = parseDelimited(toDelimited(data, CSV), ',');
    expect(raw).toEqual(matrix(data));
  });

  it('guards before quoting, so the apostrophe sits inside the quotes', () => {
    const data = table(['a'], [['=SUM(A1,B1)'], ['\t=1+1'], ['-1+1\n2']]);
    expect(toDelimited(data, { ...CSV, formulaGuard: true, includeHeader: false })).toBe(
      '"\'=SUM(A1,B1)"\r\n' + '\'\t=1+1\r\n' + '"\'-1+1\n2"\r\n',
    );
  });

  it('no guarded output cell starts with a formula trigger', () => {
    const data = table(['v'], dangerous.map((value) => [value]));
    const records = parseDelimited(toDelimited(data, { ...CSV, formulaGuard: true, includeHeader: false }), ',');
    expect(records).toHaveLength(dangerous.length);
    for (const [cell] of records) expect(cell!.startsWith("'")).toBe(true);
  });
});

describe('parseDelimited', () => {
  it('parses quoted fields with delimiters, doubled quotes and line breaks', () => {
    expect(parseDelimited('a,"b,c","d ""q"" e"\r\n"multi\r\nline",x,\r\n', ',')).toEqual([
      ['a', 'b,c', 'd "q" e'],
      ['multi\r\nline', 'x', ''],
    ]);
  });

  it('accepts CRLF, LF and lone CR, with or without a final line ending', () => {
    expect(parseDelimited('a,b\r\nc,d\r\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a,b\nc,d\n', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a,b\rc,d\r', ',')).toEqual([['a', 'b'], ['c', 'd']]);
    expect(parseDelimited('a,b\r\nc,d', ',')).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('ignores a leading byte order mark', () => {
    expect(parseDelimited('﻿a,b\r\n1,2\r\n', ',')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('﻿"a",b', ',')).toEqual([['a', 'b']]);
    expect(parseDelimited('﻿', ',')).toEqual([]);
  });

  it('keeps empty fields and empty lines', () => {
    expect(parseDelimited('', ',')).toEqual([]);
    expect(parseDelimited(',', ',')).toEqual([['', '']]);
    expect(parseDelimited('a,', ',')).toEqual([['a', '']]);
    expect(parseDelimited(',a\n', ',')).toEqual([['', 'a']]);
    expect(parseDelimited('a,,c\n,,\n', ',')).toEqual([['a', '', 'c'], ['', '', '']]);
    expect(parseDelimited('a\n\nb\n', ',')).toEqual([['a'], [''], ['b']]);
    expect(parseDelimited('""\n', ',')).toEqual([['']]);
    expect(parseDelimited('"",""', ',')).toEqual([['', '']]);
  });

  it('is lenient with slightly malformed input', () => {
    expect(parseDelimited('a"b,c', ',')).toEqual([['a"b', 'c']]);
    expect(parseDelimited('"abc"def,x', ',')).toEqual([['abcdef', 'x']]);
    expect(parseDelimited('"never closed,x\ny', ',')).toEqual([['never closed,x\ny']]);
  });

  it('supports other and multi-character delimiters', () => {
    expect(parseDelimited('a\tb\t"c\td"\n', '\t')).toEqual([['a', 'b', 'c\td']]);
    expect(parseDelimited('a;b;"c;d"', ';')).toEqual([['a', 'b', 'c;d']]);
    expect(parseDelimited('a||b||"c||d"\nx|y||z', '||')).toEqual([['a', 'b', 'c||d'], ['x|y', 'z']]);
  });

  it('round-trips awkward data exactly, for every delimiter and line ending', () => {
    const data = table(
      ['id', 'text, with comma', 'quote "q"', 'বাংলা'],
      [
        ['1', 'plain', 'a,b', 'আমার সোনার বাংলা'],
        ['2', ' leading', 'trailing ', 'tab\there'],
        ['3', 'multi\nline\r\ncell', '"quoted"', '""'],
        ['4', '', ';', '\t'],
        ['5', '=1+1', "'apostrophe", '👍'],
        ['', '', '', ''],
        ['7', ',', '"', '\n'],
      ],
    );
    for (const delimiter of [',', ';', '\t', '|']) {
      for (const lineEnding of ['\r\n', '\n'] as const) {
        const text = toDelimited(data, { delimiter, formulaGuard: false, includeHeader: true, lineEnding });
        expect(parseDelimited(text, delimiter)).toEqual(matrix(data));
      }
    }
  });

  it('round-trips random data', () => {
    // Small deterministic generator: the alphabet is chosen to hit every quoting rule.
    let seed = 42;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = ['a', 'b', ',', ';', '"', '\n', '\r', '\t', ' ', 'চ', 'া', '👍', "'", '=', '-'];
    const rows: string[][] = [];
    for (let r = 0; r < 300; r++) {
      const cells: string[] = [];
      for (let c = 0; c < 4; c++) {
        let cell = '';
        const length = next() % 6;
        for (let i = 0; i < length; i++) cell += alphabet[next() % alphabet.length];
        cells.push(cell);
      }
      rows.push(cells);
    }
    const data = table(['w', 'x', 'y', 'z'], rows);
    for (const delimiter of [',', ';', '\t']) {
      const text = toDelimited(data, { delimiter, formulaGuard: false, includeHeader: true });
      expect(parseDelimited(text, delimiter)).toEqual(matrix(data));
    }
  });
});

describe('clipboardText', () => {
  const data = table(['Name', 'Note'], [['Tea', 'a\tb'], ['=1+1', 'চা']]);

  it('produces TSV with LF line endings and no BOM', () => {
    const text = clipboardText(data, 'tsv', { formulaGuard: false, includeHeader: true });
    expect(text).toBe('Name\tNote\nTea\t"a\tb"\n=1+1\tচা\n');
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    expect(text).not.toContain('\r');
  });

  it('honours includeHeader and formulaGuard', () => {
    expect(clipboardText(data, 'tsv', { formulaGuard: true, includeHeader: false })).toBe('Tea\t"a\tb"\n\'=1+1\tচা\n');
    expect(clipboardText(data, 'csv', { formulaGuard: true, includeHeader: true })).toBe("Name,Note\nTea,a\tb\n'=1+1,চা\n");
  });

  it('produces pretty JSON', () => {
    const text = clipboardText(data, 'json', { formulaGuard: true, includeHeader: false });
    expect(JSON.parse(text)).toEqual([
      { Name: 'Tea', Note: 'a\tb' },
      { Name: '=1+1', Note: 'চা' },
    ]);
    expect(text).toContain('\n  {\n    "Name": "Tea"');
  });
});
