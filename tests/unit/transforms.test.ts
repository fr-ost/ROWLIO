import { describe, expect, it } from 'vitest';
import type { TableData } from '@/types/data';
import type { TransformOp, TransformResult } from '@/types/transforms';
import { applyTransform, describeOp } from '@/data-processing/transforms';

/** Columns get ids "c0", "c1", …; rows get ids 1, 2, … */
function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

const names = (data: TableData): string[] => data.columns.map((column) => column.name);
const cells = (data: TableData): string[][] => data.rows.map((row) => row.cells);
const column = (data: TableData, index: number): string[] => data.rows.map((row) => row.cells[index]!);

/** Apply an op and assert the purity contract that holds for EVERY operation. */
function run(data: TableData, op: TransformOp): TransformResult {
  const snapshot = structuredClone(data);
  const result = applyTransform(data, op);
  // The input is never mutated.
  expect(data).toEqual(snapshot);
  // Nothing changed ⇔ the very same object comes back.
  if (result.changed === 0) expect(result.data).toBe(data);
  else expect(result.data).not.toBe(data);
  expect(typeof result.summary).toBe('string');
  expect(result.summary.length).toBeGreaterThan(0);
  // The result is structurally sound: every row is as wide as the header, ids are unique.
  for (const row of result.data.rows) expect(row.cells).toHaveLength(result.data.columns.length);
  expect(new Set(result.data.rows.map((row) => row.id)).size).toBe(result.data.rows.length);
  expect(new Set(result.data.columns.map((c) => c.id)).size).toBe(result.data.columns.length);
  return result;
}

describe('trim', () => {
  it('strips leading / trailing whitespace including NBSP and zero-width characters', () => {
    const data = table(
      ['a', 'b'],
      [
        ['  hello  ', 'ok'],
        [' nbsp ', '​zero​'],
        ['﻿bom', 'tab\t'],
        ['in  side', '\n\nline\r\n'],
        ['', '   '],
      ],
    );
    const result = run(data, { type: 'trim' });
    expect(cells(result.data)).toEqual([
      ['hello', 'ok'],
      ['nbsp', 'zero'],
      ['bom', 'tab'],
      ['in  side', 'line'],
      ['', ''],
    ]);
    expect(result.changed).toBe(7);
    expect(result.summary).toBe('Trimmed 7 cells');
  });

  it('keeps unchanged rows by identity and returns the same data when nothing changes', () => {
    const data = table(['a'], [['clean'], [' dirty '], ['also clean']]);
    const result = run(data, { type: 'trim' });
    expect(result.data.rows[0]).toBe(data.rows[0]);
    expect(result.data.rows[2]).toBe(data.rows[2]);
    expect(result.data.rows[1]).not.toBe(data.rows[1]);
    expect(result.data.columns).toBe(data.columns);
    expect(result.summary).toBe('Trimmed 1 cell');

    const again = run(result.data, { type: 'trim' });
    expect(again.changed).toBe(0);
    expect(again.data).toBe(result.data);
    expect(again.summary).toBe('No cells needed trimming');
  });

  it('only touches the selected columns', () => {
    const data = table(['a', 'b'], [[' x ', ' y ']]);
    const result = run(data, { type: 'trim', columns: ['c1'] });
    expect(cells(result.data)).toEqual([[' x ', 'y']]);
    expect(result.changed).toBe(1);
  });

  it('does not damage Bengali text or emoji', () => {
    const data = table(['a'], [['  বাংলা  ভাষা  '], [' 👨‍👩‍👧 '], ['ক্‍ষ']]);
    const result = run(data, { type: 'trim' });
    // Inner double space and the inner zero-width joiners are untouched.
    expect(column(result.data, 0)).toEqual(['বাংলা  ভাষা', '👨‍👩‍👧', 'ক্‍ষ']);
    expect(result.changed).toBe(2);
  });

  it('throws for a column that does not exist', () => {
    expect(() => applyTransform(table(['a'], [['x']]), { type: 'trim', columns: ['nope'] })).toThrow(/column/i);
  });
});

describe('normalizeWhitespace', () => {
  it('collapses runs of any whitespace into one space and trims', () => {
    const data = table(
      ['a'],
      [['  a   b  '], ['a  b'], ['a\tb\nc\r\nd'], ['বাংলা  ভাষা'], ['already clean'], ['']],
    );
    const result = run(data, { type: 'normalizeWhitespace' });
    expect(column(result.data, 0)).toEqual(['a b', 'a b', 'a b c d', 'বাংলা ভাষা', 'already clean', '']);
    expect(result.changed).toBe(4);
    expect(result.summary).toBe('Cleaned up whitespace in 4 cells');
    expect(result.data.rows[4]).toBe(data.rows[4]);
  });

  it('keeps zero-width joiners inside words (Bengali conjuncts, emoji sequences)', () => {
    const data = table(['a'], [['র‍্য  ক'], ['👩‍💻   dev']]);
    const result = run(data, { type: 'normalizeWhitespace' });
    expect(column(result.data, 0)).toEqual(['র‍্য ক', '👩‍💻 dev']);
  });

  it('reports when there is nothing to do', () => {
    const result = run(table(['a'], [['x y']]), { type: 'normalizeWhitespace' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('Whitespace is already clean');
  });
});

describe('removeEmptyRows', () => {
  it('removes rows whose cells are all empty or whitespace', () => {
    const data = table(
      ['a', 'b'],
      [
        ['1', ''],
        ['', ''],
        [' ', ' \t'],
        ['', '0'],
        ['​', ''],
      ],
    );
    const result = run(data, { type: 'removeEmptyRows' });
    expect(result.data.rows.map((row) => row.id)).toEqual([1, 4]);
    expect(result.changed).toBe(3);
    expect(result.summary).toBe('Removed 3 empty rows');
    expect(result.data.rows[0]).toBe(data.rows[0]);
  });

  it('is a no-op without empty rows', () => {
    const result = run(table(['a'], [['x']]), { type: 'removeEmptyRows' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('No empty rows found');
  });
});

describe('removeEmptyColumns', () => {
  it('removes columns that are empty in every row', () => {
    const data = table(
      ['keep', 'blank', 'spaces', 'last'],
      [
        ['1', '', ' ', 'x'],
        ['2', '', ' ', ''],
      ],
    );
    const result = run(data, { type: 'removeEmptyColumns' });
    expect(names(result.data)).toEqual(['keep', 'last']);
    expect(result.data.columns.map((c) => c.id)).toEqual(['c0', 'c3']);
    expect(cells(result.data)).toEqual([
      ['1', 'x'],
      ['2', ''],
    ]);
    expect(result.changed).toBe(2);
    expect(result.summary).toBe('Removed 2 empty columns');
  });

  it('never deletes the header of a table without rows', () => {
    const result = run(table(['a', 'b'], []), { type: 'removeEmptyColumns' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('No empty columns found');
  });
});

describe('removeDuplicates', () => {
  it('keeps the first occurrence of each row', () => {
    const data = table(
      ['a', 'b'],
      [
        ['x', '1'],
        ['y', '2'],
        ['x', '1'],
        ['x', '2'],
        ['y', '2'],
        ['x', '1'],
      ],
    );
    const result = run(data, { type: 'removeDuplicates' });
    expect(result.data.rows.map((row) => row.id)).toEqual([1, 2, 4]);
    expect(result.changed).toBe(3);
    expect(result.summary).toBe('Removed 3 duplicate rows');
    expect(result.data.rows[2]).toBe(data.rows[3]);
  });

  it('compares only the given columns', () => {
    const data = table(
      ['a', 'b'],
      [
        ['x', '1'],
        ['x', '2'],
        ['y', '1'],
      ],
    );
    const byA = run(data, { type: 'removeDuplicates', columns: ['c0'] });
    expect(byA.data.rows.map((row) => row.id)).toEqual([1, 3]);
    expect(byA.summary).toBe('Removed 1 duplicate row');
    const byB = run(data, { type: 'removeDuplicates', columns: ['c1'] });
    expect(byB.data.rows.map((row) => row.id)).toEqual([1, 2]);
  });

  it('is exact: case, whitespace and cell boundaries matter', () => {
    const data = table(
      ['a', 'b'],
      [
        ['ab', ''],
        ['a', 'b'],
        ['', 'ab'],
        ['A', 'b'],
        ['a ', 'b'],
        ['বাংলা', '১'],
        ['বাংলা', '১'],
      ],
    );
    const result = run(data, { type: 'removeDuplicates' });
    expect(result.changed).toBe(1);
    expect(result.data.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('reports when no duplicates exist', () => {
    const result = run(table(['a'], [['1'], ['2']]), { type: 'removeDuplicates' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('No duplicate rows found');
  });
});

describe('convertCase', () => {
  const data = table(['a'], [["hello WORLD. second sentence! o'neil's 3rd try"], ['বাংলা ভাষা'], ['ÉCOLE élève straße'], ['👍 ok'], ['']]);

  it('upper', () => {
    const result = run(data, { type: 'convertCase', mode: 'upper' });
    expect(column(result.data, 0)).toEqual([
      "HELLO WORLD. SECOND SENTENCE! O'NEIL'S 3RD TRY",
      'বাংলা ভাষা',
      'ÉCOLE ÉLÈVE STRASSE',
      '👍 OK',
      '',
    ]);
    expect(result.changed).toBe(3);
    expect(result.summary).toBe('Changed the case of 3 cells');
  });

  it('lower', () => {
    const result = run(data, { type: 'convertCase', mode: 'lower' });
    expect(column(result.data, 0)).toEqual([
      "hello world. second sentence! o'neil's 3rd try",
      'বাংলা ভাষা',
      'école élève straße',
      '👍 ok',
      '',
    ]);
  });

  it('title', () => {
    const result = run(data, { type: 'convertCase', mode: 'title' });
    expect(column(result.data, 0)).toEqual([
      "Hello World. Second Sentence! O'neil's 3rd Try",
      'বাংলা ভাষা',
      'École Élève Straße',
      '👍 Ok',
      '',
    ]);
  });

  it('sentence', () => {
    const result = run(data, { type: 'convertCase', mode: 'sentence' });
    expect(column(result.data, 0)).toEqual([
      "Hello world. Second sentence! O'neil's 3rd try",
      'বাংলা ভাষা',
      'École élève straße',
      '👍 Ok',
      '',
    ]);
  });

  it('leaves scripts without case untouched (same row objects)', () => {
    const bengali = table(['a'], [['আমার সোনার বাংলা'], ['১২৩'], ['中文'], ['العربية']]);
    for (const mode of ['upper', 'lower', 'title', 'sentence'] as const) {
      const result = run(bengali, { type: 'convertCase', mode });
      expect(result.changed).toBe(0);
      expect(result.data).toBe(bengali);
      expect(result.summary).toBe('No cells needed a case change');
    }
  });

  it('respects the column selection', () => {
    const two = table(['a', 'b'], [['x', 'y']]);
    const result = run(two, { type: 'convertCase', mode: 'upper', columns: ['c1'] });
    expect(cells(result.data)).toEqual([['x', 'Y']]);
  });
});

describe('extractNumbers', () => {
  const data = table(
    ['Price', 'Note'],
    [
      ['$1,299.00', 'a'],
      ['৳ ১২,৩৪৫.৫০', 'b'],
      ['from 10 to 20', 'c'],
      ['N/A', 'd'],
      ['', 'e'],
      ['42', 'f'],
      ['-5°C', 'g'],
    ],
  );

  it('replace / first: converts cells and leaves cells without a number unchanged', () => {
    const result = run(data, { type: 'extractNumbers', column: 'c0', mode: 'first', target: 'replace' });
    expect(column(result.data, 0)).toEqual(['1299.00', '12345.50', '10', 'N/A', '', '42', '-5']);
    expect(result.changed).toBe(4);
    expect(result.summary).toBe('Extracted the numbers in 4 cells. 1 cell without a number was left unchanged');
    // Untouched rows keep identity.
    expect(result.data.rows[3]).toBe(data.rows[3]);
    expect(result.data.rows[4]).toBe(data.rows[4]);
    expect(result.data.rows[5]).toBe(data.rows[5]);
    expect(names(result.data)).toEqual(['Price', 'Note']);
  });

  it('replace / all: joins every number with a space', () => {
    const result = run(data, { type: 'extractNumbers', column: 'c0', mode: 'all', target: 'replace' });
    expect(column(result.data, 0)).toEqual(['1299.00', '12345.50', '10 20', 'N/A', '', '42', '-5']);
  });

  it('new: adds "<name> (number)" right after the source; cells without a number are empty', () => {
    const result = run(data, { type: 'extractNumbers', column: 'c0', mode: 'first', target: 'new' });
    expect(names(result.data)).toEqual(['Price', 'Price (number)', 'Note']);
    expect(column(result.data, 0)).toEqual(column(data, 0));
    expect(column(result.data, 1)).toEqual(['1299.00', '12345.50', '10', '', '', '42', '-5']);
    expect(column(result.data, 2)).toEqual(column(data, 1));
    expect(result.data.columns[0]).toBe(data.columns[0]);
    expect(result.data.columns[2]).toBe(data.columns[1]);
    expect(result.data.columns[1]!.id).toMatch(/^c_/);
    expect(result.changed).toBe(5);
    expect(result.summary).toBe('Extracted numbers from 5 cells into a new column. 1 cell without a number was left empty');
  });

  it('new: picks a free column name', () => {
    const taken = table(['Price', 'Price (number)'], [['5 kg', 'x']]);
    const result = run(taken, { type: 'extractNumbers', column: 'c0', mode: 'first', target: 'new' });
    expect(names(result.data)).toEqual(['Price', 'Price (number) (2)', 'Price (number)']);
  });

  it('is an honest no-op when the column has no numbers', () => {
    const words = table(['w'], [['abc'], ['']]);
    const replaced = run(words, { type: 'extractNumbers', column: 'c0', mode: 'first', target: 'replace' });
    expect(replaced.changed).toBe(0);
    expect(replaced.summary).toBe('No numbers found in "w". 1 cell without a number was left unchanged');
    const added = run(words, { type: 'extractNumbers', column: 'c0', mode: 'all', target: 'new' });
    expect(added.changed).toBe(0);
    expect(added.summary).toBe('No numbers found in "w"');
  });

  it('is a no-op when every cell already is a plain number', () => {
    const plain = table(['n'], [['1'], ['2.5'], ['']]);
    const result = run(plain, { type: 'extractNumbers', column: 'c0', mode: 'first', target: 'replace' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('No cells needed changes');
  });

  it('throws for an unknown column', () => {
    expect(() => applyTransform(data, { type: 'extractNumbers', column: 'zz', mode: 'first', target: 'new' })).toThrow();
  });
});

describe('parseDates', () => {
  const data = table(
    ['When', 'x'],
    [
      ['31 Jan 2024', '1'],
      ['January 5, 2024 5:05 PM', '2'],
      ['03/04/2024', '3'], // ambiguous
      ['2024-02-30', '4'], // impossible
      ['2024-03-01', '5'], // already ISO
      ['', '6'],
      ['soon', '7'],
      ['৩১/১২/২০২৪', '8'],
    ],
  );

  it('replace: converts unambiguous dates and leaves the rest unchanged', () => {
    const result = run(data, { type: 'parseDates', column: 'c0', target: 'replace' });
    expect(column(result.data, 0)).toEqual([
      '2024-01-31',
      '2024-01-05T17:05:00',
      '03/04/2024',
      '2024-02-30',
      '2024-03-01',
      '',
      'soon',
      '2024-12-31',
    ]);
    expect(result.changed).toBe(3);
    expect(result.summary).toBe(
      'Converted 3 dates to ISO format. 3 cells are not unambiguous dates and were left unchanged',
    );
    expect(result.data.rows[2]).toBe(data.rows[2]);
    expect(result.data.rows[4]).toBe(data.rows[4]);
  });

  it('new: adds "<name> (date)" after the source; unparseable cells are empty', () => {
    const result = run(data, { type: 'parseDates', column: 'c0', target: 'new' });
    expect(names(result.data)).toEqual(['When', 'When (date)', 'x']);
    expect(column(result.data, 0)).toEqual(column(data, 0));
    expect(column(result.data, 1)).toEqual(['2024-01-31', '2024-01-05T17:05:00', '', '', '2024-03-01', '', '', '2024-12-31']);
    expect(result.changed).toBe(4);
    expect(result.summary).toBe(
      'Converted 4 dates into a new column. 3 cells are not unambiguous dates and were left empty',
    );
  });

  it('reports honestly when nothing can be converted', () => {
    const vague = table(['d'], [['03/04/2024'], ['tomorrow']]);
    const replaced = run(vague, { type: 'parseDates', column: 'c0', target: 'replace' });
    expect(replaced.changed).toBe(0);
    expect(replaced.summary).toBe(
      'No unambiguous dates found in "d". 2 cells are not unambiguous dates and were left unchanged',
    );
    const added = run(vague, { type: 'parseDates', column: 'c0', target: 'new' });
    expect(added.changed).toBe(0);
    expect(names(added.data)).toEqual(['d']);

    const iso = table(['d'], [['2024-01-01']]);
    expect(run(iso, { type: 'parseDates', column: 'c0', target: 'replace' }).summary).toBe('No cells needed changes');
  });
});

describe('normalizeUrls', () => {
  const op = (extra: Partial<Extract<TransformOp, { type: 'normalizeUrls' }>> = {}): TransformOp => ({
    type: 'normalizeUrls',
    column: 'c0',
    stripTracking: false,
    stripHash: false,
    ...extra,
  });
  const normalize = (values: string[], extra?: Partial<Extract<TransformOp, { type: 'normalizeUrls' }>>): string[] =>
    column(run(table(['u'], values.map((value) => [value])), op(extra)).data, 0);

  it('lowercases scheme and host, drops default ports, keeps the rest as written', () => {
    expect(
      normalize([
        'HTTP://Example.COM:80/Path/Page?Q=1#Frag',
        'https://EXAMPLE.com:443',
        'https://example.com:8443/x',
        'http://example.com:443/x',
        'https://User:Pw@Example.com/a',
        'https://example.com/বাংলা/পাতা?q=চা',
        '  https://Example.com/a  ',
        'https://[2001:DB8::1]:443/x',
      ]),
    ).toEqual([
      'http://example.com/Path/Page?Q=1#Frag',
      'https://example.com/',
      'https://example.com:8443/x',
      'http://example.com:443/x',
      'https://User:Pw@example.com/a',
      'https://example.com/বাংলা/পাতা?q=চা',
      'https://example.com/a',
      'https://[2001:db8::1]/x',
    ]);
  });

  it('leaves non-URLs and other schemes untouched', () => {
    const values = [
      'mailto:Someone@Example.com',
      'tel:+8801711000000',
      'javascript:void(0)',
      'data:text/plain,Hi',
      'ftp://Example.com/file',
      'not a url',
      'N/A',
      '24/7',
      'example.com/path',
      'https://exa mple.com/',
      'http://',
      '',
    ];
    const data = table(['u'], values.map((value) => [value]));
    const result = run(data, op({ baseUrl: 'https://base.test/dir/page', stripTracking: true, stripHash: true }));
    expect(result.changed).toBe(0);
    expect(result.data).toBe(data);
    expect(result.summary).toBe('No URLs needed changes');
  });

  it('resolves relative URLs only when a base is given', () => {
    const values = ['/a/b', '../up', './same', '?q=1', '#top', '//cdn.Example.com/x.js', 'page2.html', 'img/photo.JPG?v=2'];
    expect(normalize(values)).toEqual(values);
    expect(normalize(values, { baseUrl: 'https://Shop.test/list/items?page=1' })).toEqual([
      'https://shop.test/a/b',
      'https://shop.test/up',
      'https://shop.test/list/same',
      'https://shop.test/list/items?q=1',
      'https://shop.test/list/items?page=1#top',
      'https://cdn.example.com/x.js',
      'https://shop.test/list/page2.html',
      'https://shop.test/list/img/photo.JPG?v=2',
    ]);
  });

  it('ignores an unusable base', () => {
    expect(normalize(['/a'], { baseUrl: 'not a url' })).toEqual(['/a']);
    expect(normalize(['/a'], { baseUrl: 'ftp://files.test/' })).toEqual(['/a']);
  });

  it('strips tracking parameters when asked, and only those', () => {
    const values = [
      'https://example.com/p?utm_source=news&id=5&utm_medium=email&fbclid=abc#frag',
      'https://example.com/p?gclid=1&msclkid=2&mc_eid=3&igshid=4&yclid=5&UTM_Campaign=x',
      'https://example.com/p?id=5&ref=home&utmost=1',
      'https://example.com/p?a=1&&b=2',
    ];
    expect(normalize(values, { stripTracking: true })).toEqual([
      'https://example.com/p?id=5#frag',
      'https://example.com/p',
      'https://example.com/p?id=5&ref=home&utmost=1',
      'https://example.com/p?a=1&&b=2',
    ]);
    // Without the option nothing is removed.
    expect(normalize(values)).toEqual(values);
  });

  it('removes the fragment when asked', () => {
    expect(normalize(['https://example.com/p?x=1#section', 'https://example.com/#'], { stripHash: true })).toEqual([
      'https://example.com/p?x=1',
      'https://example.com/',
    ]);
  });

  it('counts only the cells that changed', () => {
    const data = table(['u'], [['https://example.com/a'], ['HTTPS://example.com/b'], ['text']]);
    const result = run(data, op());
    expect(result.changed).toBe(1);
    expect(result.summary).toBe('Normalized 1 URL');
    expect(result.data.rows[0]).toBe(data.rows[0]);
  });
});

describe('findReplace', () => {
  const base = { type: 'findReplace', regex: false, caseSensitive: false, wholeCell: false } as const;
  const data = table(
    ['a', 'b'],
    [
      ['Hello hello HELLO', 'hello'],
      ['a.b.c', 'N/A'],
      ['price: $5', '$5'],
      ['বাংলা ভাষা', 'আমার বাংলা'],
      ['👍 good 👍', ''],
    ],
  );

  it('replaces every literal occurrence, case-insensitively by default', () => {
    const result = run(data, { ...base, find: 'hello', replace: 'bye' });
    expect(cells(result.data)[0]).toEqual(['bye bye bye', 'bye']);
    expect(result.changed).toBe(2);
    expect(result.summary).toBe('Replaced text in 2 cells');
    expect(result.data.rows[1]).toBe(data.rows[1]);
  });

  it('honours caseSensitive', () => {
    const result = run(data, { ...base, find: 'hello', replace: 'bye', caseSensitive: true });
    expect(cells(result.data)[0]).toEqual(['Hello bye HELLO', 'bye']);
  });

  it('treats the search text literally (no regex meaning) and the replacement literally (no $ patterns)', () => {
    const dots = run(data, { ...base, find: '.', replace: '-' });
    expect(cells(dots.data)[1]).toEqual(['a-b-c', 'N/A']);
    expect(dots.changed).toBe(1);

    const dollars = run(data, { ...base, find: '$5', replace: '$& $1 $$' });
    expect(cells(dollars.data)[2]).toEqual(['price: $& $1 $$', '$& $1 $$']);
    const sensitive = run(data, { ...base, find: '$5', replace: '$&', caseSensitive: true });
    expect(cells(sensitive.data)[2]).toEqual(['price: $&', '$&']);
  });

  it('wholeCell only matches cells that equal the search text', () => {
    const result = run(data, { ...base, find: 'HELLO', replace: '', wholeCell: true });
    expect(cells(result.data)[0]).toEqual(['Hello hello HELLO', '']);
    expect(result.changed).toBe(1);
    const sensitive = run(data, { ...base, find: 'HELLO', replace: '', wholeCell: true, caseSensitive: true });
    expect(sensitive.changed).toBe(0);
    const na = run(data, { ...base, find: 'n/a', replace: '', wholeCell: true });
    expect(cells(na.data)[1]).toEqual(['a.b.c', '']);
  });

  it('works on Bengali text and emoji', () => {
    const bengali = run(data, { ...base, find: 'বাংলা', replace: 'ইংরেজি' });
    expect(cells(bengali.data)[3]).toEqual(['ইংরেজি ভাষা', 'আমার ইংরেজি']);
    const emoji = run(data, { ...base, find: '👍', replace: '✅' });
    expect(cells(emoji.data)[4]).toEqual(['✅ good ✅', '']);
  });

  it('restricts to the selected columns', () => {
    const result = run(data, { ...base, find: 'hello', replace: 'x', columns: ['c1'] });
    expect(cells(result.data)[0]).toEqual(['Hello hello HELLO', 'x']);
  });

  it('supports regular expressions with groups', () => {
    const result = run(data, { ...base, regex: true, find: '(\\w)\\.(\\w)', replace: '$2.$1' });
    expect(cells(result.data)[1]).toEqual(['b.a.c', 'N/A']);

    const digits = run(data, { ...base, regex: true, find: '\\d+', replace: '<$&>' });
    expect(cells(digits.data)[2]).toEqual(['price: $<5>', '$<5>']);
  });

  it('regex honours caseSensitive and wholeCell', () => {
    const insensitive = run(data, { ...base, regex: true, find: 'h(e)llo', replace: 'J$1llo' });
    expect(cells(insensitive.data)[0]).toEqual(['Jello Jello JEllo', 'Jello']);
    const sensitive = run(data, { ...base, regex: true, find: 'h(e)llo', replace: 'J$1llo', caseSensitive: true });
    expect(cells(sensitive.data)[0]).toEqual(['Hello Jello HELLO', 'Jello']);
    // The whole cell must match, alternatives included: "hello" matches, "Hello hello HELLO" does not.
    const whole = run(data, { ...base, regex: true, find: 'hello|n/a', replace: '-', wholeCell: true });
    expect(column(whole.data, 0)).toEqual(column(data, 0));
    expect(column(whole.data, 1)).toEqual(['-', '-', '$5', 'আমার বাংলা', '']);
  });

  it('regex handles emoji as whole characters and legacy-only syntax', () => {
    const emoji = run(data, { ...base, regex: true, find: '^.', replace: '*' });
    expect(cells(emoji.data)[4]![0]).toBe('* good 👍');
    // "\-" is a syntax error in Unicode mode but valid in legacy mode: it must still work.
    const legacy = run(table(['a'], [['a-b']]), { ...base, regex: true, find: 'a\\-b', replace: 'ok' });
    expect(column(legacy.data, 0)).toEqual(['ok']);
  });

  it('throws a clear error for an invalid regex or an empty search', () => {
    expect(() => applyTransform(data, { ...base, regex: true, find: '([a-z', replace: '' })).toThrow(
      /^Invalid regular expression: /,
    );
    expect(() => applyTransform(data, { ...base, regex: true, find: '(', replace: '', wholeCell: true })).toThrow(
      /^Invalid regular expression: /,
    );
    expect(() => applyTransform(data, { ...base, find: '', replace: 'x' })).toThrow(/find/i);
    expect(() => applyTransform(data, { ...base, regex: true, find: '', replace: 'x' })).toThrow(/find/i);
  });

  it('reports no matches, and matches that change nothing', () => {
    const none = run(data, { ...base, find: 'zzz', replace: 'x' });
    expect(none.changed).toBe(0);
    expect(none.summary).toBe('No matches found');
    const same = run(data, { ...base, find: 'good', replace: 'good' });
    expect(same.changed).toBe(0);
    expect(same.summary).toBe('1 cell matched, but the replacement is identical; nothing changed');
  });
});

describe('splitColumn', () => {
  const data = table(
    ['id', 'Tags', 'end'],
    [
      ['1', 'a,b,c', 'x'],
      ['2', 'solo', 'y'],
      ['3', '', 'z'],
      ['4', 'চা, কফি', 'w'],
    ],
  );

  it('creates as many columns as the longest split, after the source', () => {
    const result = run(data, { type: 'splitColumn', column: 'c1', delimiter: ',', keepOriginal: true });
    expect(names(result.data)).toEqual(['id', 'Tags', 'Tags 1', 'Tags 2', 'Tags 3', 'end']);
    expect(cells(result.data)).toEqual([
      ['1', 'a,b,c', 'a', 'b', 'c', 'x'],
      ['2', 'solo', 'solo', '', '', 'y'],
      ['3', '', '', '', '', 'z'],
      ['4', 'চা, কফি', 'চা', ' কফি', '', 'w'],
    ]);
    expect(result.changed).toBe(3);
    expect(result.summary).toBe('Split "Tags" into 3 columns');
    expect(result.data.columns.slice(0, 2)).toEqual(data.columns.slice(0, 2));
  });

  it('removes the source column when keepOriginal is false', () => {
    const result = run(data, { type: 'splitColumn', column: 'c1', delimiter: ',', keepOriginal: false });
    expect(names(result.data)).toEqual(['id', 'Tags 1', 'Tags 2', 'Tags 3', 'end']);
    expect(cells(result.data)[0]).toEqual(['1', 'a', 'b', 'c', 'x']);
  });

  it('supports multi-character delimiters and the \\t / \\n escapes typed literally', () => {
    const multi = run(table(['v'], [['a -> b -> c']]), { type: 'splitColumn', column: 'c0', delimiter: ' -> ', keepOriginal: false });
    expect(cells(multi.data)).toEqual([['a', 'b', 'c']]);

    const tabs = run(table(['v'], [['a\tb']]), { type: 'splitColumn', column: 'c0', delimiter: '\\t', keepOriginal: false });
    expect(cells(tabs.data)).toEqual([['a', 'b']]);

    const lines = run(table(['v'], [['line 1\nline 2\nline 3']]), { type: 'splitColumn', column: 'c0', delimiter: '\\n', keepOriginal: false });
    expect(cells(lines.data)).toEqual([['line 1', 'line 2', 'line 3']]);
  });

  it('avoids clashing with existing column names', () => {
    const clash = table(['Tags', 'Tags 1'], [['a|b', 'existing']]);
    const result = run(clash, { type: 'splitColumn', column: 'c0', delimiter: '|', keepOriginal: true });
    expect(names(result.data)).toEqual(['Tags', 'Tags 1 (2)', 'Tags 2', 'Tags 1']);
  });

  it('is a no-op when the delimiter never occurs', () => {
    const result = run(data, { type: 'splitColumn', column: 'c1', delimiter: ';', keepOriginal: false });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('The delimiter does not occur in "Tags"; nothing was split');
  });

  it('throws for an empty delimiter and for an absurd number of columns', () => {
    expect(() => applyTransform(data, { type: 'splitColumn', column: 'c1', delimiter: '', keepOriginal: true })).toThrow(
      /delimiter/i,
    );
    const wide = table(['v'], [[Array.from({ length: 600 }, (_, i) => i).join(' ')]]);
    expect(() => applyTransform(wide, { type: 'splitColumn', column: 'c0', delimiter: ' ', keepOriginal: true })).toThrow(
      /600 columns/,
    );
  });
});

describe('combineColumns', () => {
  const data = table(
    ['First', 'Mid', 'Last', 'Other'],
    [
      ['Ada', '', 'Lovelace', 'x'],
      ['', '', '', 'y'],
      ['রবীন্দ্রনাথ', ' ', 'ঠাকুর', 'z'],
    ],
  );

  it('joins in the given order, skipping empty cells, and places the result at the first source', () => {
    const result = run(data, { type: 'combineColumns', columns: ['c0', 'c1', 'c2'], separator: ' ', name: 'Full name', removeSources: true });
    expect(names(result.data)).toEqual(['Full name', 'Other']);
    expect(cells(result.data)).toEqual([
      ['Ada Lovelace', 'x'],
      ['', 'y'],
      ['রবীন্দ্রনাথ ঠাকুর', 'z'],
    ]);
    expect(result.data.columns[1]).toEqual(data.columns[3]);
    expect(result.changed).toBe(4);
    expect(result.summary).toBe('Combined 3 columns into "Full name"');
  });

  it('keeps the sources when removeSources is false', () => {
    const result = run(data, { type: 'combineColumns', columns: ['c2', 'c0'], separator: ', ', name: 'Sorted', removeSources: false });
    // Given order is Last, First; the new column sits where "Last" (the first given) was.
    expect(names(result.data)).toEqual(['First', 'Mid', 'Sorted', 'Last', 'Other']);
    expect(column(result.data, 2)).toEqual(['Lovelace, Ada', '', 'ঠাকুর, রবীন্দ্রনাথ']);
    expect(result.changed).toBe(1);
  });

  it('makes the new name unique and defaults it when empty', () => {
    const clash = run(data, { type: 'combineColumns', columns: ['c0', 'c2'], separator: '-', name: 'Other', removeSources: false });
    expect(names(clash.data)).toContain('Other (2)');
    // When a source is removed its name becomes available again.
    const reuse = run(data, { type: 'combineColumns', columns: ['c0', 'c2'], separator: '-', name: 'First', removeSources: true });
    expect(names(reuse.data)).toEqual(['First', 'Mid', 'Other']);
    const unnamed = run(data, { type: 'combineColumns', columns: ['c0', 'c2'], separator: '-', name: '  ', removeSources: true });
    expect(names(unnamed.data)).toEqual(['First + Last', 'Mid', 'Other']);
  });

  it('throws for fewer than two columns or an unknown column', () => {
    expect(() => applyTransform(data, { type: 'combineColumns', columns: ['c0'], separator: ' ', name: 'n', removeSources: false })).toThrow(
      /two columns/,
    );
    expect(() => applyTransform(data, { type: 'combineColumns', columns: [], separator: ' ', name: 'n', removeSources: false })).toThrow(
      /two columns/,
    );
    expect(() => applyTransform(data, { type: 'combineColumns', columns: ['c0', 'zz'], separator: ' ', name: 'n', removeSources: false })).toThrow();
  });
});

describe('keepRows', () => {
  const data = table(
    ['a', 'b'],
    [
      ['1', 'x'],
      ['2', ''],
      ['3', '  '],
      ['4', 'y'],
    ],
  );

  it('keeps rows where the column is non-empty', () => {
    const result = run(data, { type: 'keepRows', column: 'c1', condition: 'nonEmpty' });
    expect(result.data.rows.map((row) => row.id)).toEqual([1, 4]);
    expect(result.changed).toBe(2);
    expect(result.summary).toBe('Removed 2 rows, kept 2');
    expect(result.data.rows[0]).toBe(data.rows[0]);
  });

  it('keeps rows where the column is empty', () => {
    const result = run(data, { type: 'keepRows', column: 'c1', condition: 'empty' });
    expect(result.data.rows.map((row) => row.id)).toEqual([2, 3]);
  });

  it('is a no-op when every row matches', () => {
    const result = run(data, { type: 'keepRows', column: 'c0', condition: 'nonEmpty' });
    expect(result.changed).toBe(0);
    expect(result.summary).toBe('Every row already matches; nothing was removed');
  });
});

describe('removeRows / removeColumns', () => {
  const data = table(
    ['a', 'b', 'c'],
    [
      ['1', '2', '3'],
      ['4', '5', '6'],
      ['7', '8', '9'],
    ],
  );

  it('removes rows by id and ignores unknown ids', () => {
    const result = run(data, { type: 'removeRows', rowIds: [2, 99] });
    expect(result.data.rows.map((row) => row.id)).toEqual([1, 3]);
    expect(result.changed).toBe(1);
    expect(result.summary).toBe('Removed 1 row');
    expect(result.data.rows[1]).toBe(data.rows[2]);

    const none = run(data, { type: 'removeRows', rowIds: [42] });
    expect(none.changed).toBe(0);
    expect(none.summary).toBe('No matching rows to remove');
  });

  it('removes columns and their cells', () => {
    const result = run(data, { type: 'removeColumns', columns: ['c0', 'c2'] });
    expect(names(result.data)).toEqual(['b']);
    expect(cells(result.data)).toEqual([['2'], ['5'], ['8']]);
    expect(result.changed).toBe(2);
    expect(result.summary).toBe('Removed 2 columns');

    const none = run(data, { type: 'removeColumns', columns: ['gone'] });
    expect(none.changed).toBe(0);
    expect(none.summary).toBe('No matching columns to remove');
  });
});

describe('renameColumn', () => {
  const data = table(['a', 'b'], [['1', '2']]);

  it('renames, trimming the name, and shares the rows', () => {
    const result = run(data, { type: 'renameColumn', column: 'c0', name: '  Total   price ' });
    expect(names(result.data)).toEqual(['Total price', 'b']);
    expect(result.data.columns[0]!.id).toBe('c0');
    expect(result.data.rows).toBe(data.rows);
    expect(result.data.columns[1]).toBe(data.columns[1]);
    expect(result.changed).toBe(1);
    expect(result.summary).toBe('Renamed "a" to "Total price"');
  });

  it('keeps names unique', () => {
    const result = run(data, { type: 'renameColumn', column: 'c0', name: 'b' });
    expect(names(result.data)).toEqual(['b (2)', 'b']);
    const taken = table(['x', 'b', 'b (2)'], []);
    expect(names(run(taken, { type: 'renameColumn', column: 'c0', name: 'b' }).data)).toEqual(['b (3)', 'b', 'b (2)']);
  });

  it('is a no-op for the same name and throws for an empty one', () => {
    const same = run(data, { type: 'renameColumn', column: 'c0', name: ' a ' });
    expect(same.changed).toBe(0);
    expect(() => applyTransform(data, { type: 'renameColumn', column: 'c0', name: '   ' })).toThrow(/name/i);
    expect(() => applyTransform(data, { type: 'renameColumn', column: 'zz', name: 'x' })).toThrow();
  });

  it('accepts Bengali names', () => {
    expect(names(run(data, { type: 'renameColumn', column: 'c1', name: 'দাম' }).data)).toEqual(['a', 'দাম']);
  });
});

describe('moveColumn', () => {
  const data = table(
    ['a', 'b', 'c', 'd'],
    [
      ['1', '2', '3', '4'],
      ['5', '6', '7', '8'],
    ],
  );

  it('reorders the header and every row', () => {
    const right = run(data, { type: 'moveColumn', column: 'c0', toIndex: 2 });
    expect(names(right.data)).toEqual(['b', 'c', 'a', 'd']);
    expect(cells(right.data)).toEqual([
      ['2', '3', '1', '4'],
      ['6', '7', '5', '8'],
    ]);
    expect(right.changed).toBe(1);
    expect(right.summary).toBe('Moved "a" to position 3');

    const left = run(data, { type: 'moveColumn', column: 'c3', toIndex: 0 });
    expect(names(left.data)).toEqual(['d', 'a', 'b', 'c']);
    expect(cells(left.data)[0]).toEqual(['4', '1', '2', '3']);
    expect(left.data.columns.map((c) => c.id)).toEqual(['c3', 'c0', 'c1', 'c2']);
  });

  it('clamps out-of-range targets and is a no-op for the same position', () => {
    expect(names(run(data, { type: 'moveColumn', column: 'c1', toIndex: 99 }).data)).toEqual(['a', 'c', 'd', 'b']);
    expect(names(run(data, { type: 'moveColumn', column: 'c1', toIndex: -5 }).data)).toEqual(['b', 'a', 'c', 'd']);
    const same = run(data, { type: 'moveColumn', column: 'c1', toIndex: 1 });
    expect(same.changed).toBe(0);
    expect(() => applyTransform(data, { type: 'moveColumn', column: 'c1', toIndex: Number.NaN })).toThrow();
  });
});

describe('editCell', () => {
  const data = table(
    ['a', 'b'],
    [
      ['1', '2'],
      ['3', '4'],
    ],
  );

  it('changes exactly one cell and one row object', () => {
    const result = run(data, { type: 'editCell', rowId: 2, column: 'c1', value: 'নতুন 👍' });
    expect(cells(result.data)).toEqual([
      ['1', '2'],
      ['3', 'নতুন 👍'],
    ]);
    expect(result.data.rows[0]).toBe(data.rows[0]);
    expect(result.data.rows[1]).not.toBe(data.rows[1]);
    expect(result.data.columns).toBe(data.columns);
    expect(result.changed).toBe(1);
  });

  it('is a no-op for the same value and throws for unknown rows / columns', () => {
    expect(run(data, { type: 'editCell', rowId: 1, column: 'c0', value: '1' }).changed).toBe(0);
    expect(() => applyTransform(data, { type: 'editCell', rowId: 9, column: 'c0', value: 'x' })).toThrow(/row/i);
    expect(() => applyTransform(data, { type: 'editCell', rowId: 1, column: 'zz', value: 'x' })).toThrow(/column/i);
  });
});

describe('promoteHeader / demoteHeader', () => {
  it('promotes the first row to unique header names and removes it', () => {
    const data = table(
      ['Column 1', 'Column 2', 'Column 3', 'Column 4'],
      [
        ['Name', '', 'Name', ' দাম '],
        ['Tea', 'x', 'y', '১২০'],
      ],
    );
    const result = run(data, { type: 'promoteHeader' });
    expect(names(result.data)).toEqual(['Name', 'Column 2', 'Name (2)', 'দাম']);
    expect(result.data.columns.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0]).toBe(data.rows[1]);
    expect(result.changed).toBe(1);
    expect(result.summary).toBe('Used the first row as the header');
  });

  it('promote is a no-op without rows', () => {
    const result = run(table(['a'], []), { type: 'promoteHeader' });
    expect(result.changed).toBe(0);
  });

  it('demotes the header into a new first row with a fresh id', () => {
    const data: TableData = {
      columns: [
        { id: 'x', name: 'Name' },
        { id: 'y', name: 'দাম' },
      ],
      rows: [
        { id: 5, cells: ['Tea', '120'] },
        { id: 2, cells: ['Coffee', '200'] },
      ],
    };
    const result = run(data, { type: 'demoteHeader' });
    expect(names(result.data)).toEqual(['Column 1', 'Column 2']);
    expect(result.data.columns.map((c) => c.id)).toEqual(['x', 'y']);
    expect(result.data.rows[0]).toEqual({ id: 6, cells: ['Name', 'দাম'] });
    expect(result.data.rows[1]).toBe(data.rows[0]);
    expect(result.data.rows[2]).toBe(data.rows[1]);
    expect(result.changed).toBe(1);
  });

  it('demote then promote restores the header names', () => {
    const data = table(['Name', 'Price'], [['Tea', '120']]);
    const demoted = run(data, { type: 'demoteHeader' });
    const restored = run(demoted.data, { type: 'promoteHeader' });
    expect(names(restored.data)).toEqual(['Name', 'Price']);
    expect(cells(restored.data)).toEqual([['Tea', '120']]);
  });

  it('demote is a no-op without columns', () => {
    expect(run({ columns: [], rows: [] }, { type: 'demoteHeader' }).changed).toBe(0);
  });
});

describe('contract across all operations', () => {
  const data = table(
    ['Name', 'Price', 'Link', 'Blank'],
    [
      [' Tea ', '$1,200.50', 'HTTPS://Example.com/tea?utm_source=x', ''],
      ['চা', '১২০  টাকা', '/cha', ' '],
      ['', '', '', ''],
      [' Tea ', '$1,200.50', 'HTTPS://Example.com/tea?utm_source=x', ''],
      ['Coffee 👍', '31 Jan 2024', 'mailto:a@b.c', ''],
    ],
  );

  const ops: TransformOp[] = [
    { type: 'trim' },
    { type: 'normalizeWhitespace' },
    { type: 'removeEmptyRows' },
    { type: 'removeEmptyColumns' },
    { type: 'removeDuplicates' },
    { type: 'removeDuplicates', columns: ['c0'] },
    { type: 'convertCase', mode: 'upper' },
    { type: 'convertCase', mode: 'lower' },
    { type: 'convertCase', mode: 'title' },
    { type: 'convertCase', mode: 'sentence' },
    { type: 'extractNumbers', column: 'c1', mode: 'first', target: 'replace' },
    { type: 'extractNumbers', column: 'c1', mode: 'all', target: 'new' },
    { type: 'parseDates', column: 'c1', target: 'replace' },
    { type: 'parseDates', column: 'c1', target: 'new' },
    { type: 'normalizeUrls', column: 'c2', baseUrl: 'https://example.com/', stripTracking: true, stripHash: true },
    { type: 'findReplace', find: 'tea', replace: 'TEA', regex: false, caseSensitive: false, wholeCell: false },
    { type: 'findReplace', find: '\\s+', replace: ' ', regex: true, caseSensitive: true, wholeCell: false },
    { type: 'splitColumn', column: 'c1', delimiter: ' ', keepOriginal: true },
    { type: 'splitColumn', column: 'c1', delimiter: ' ', keepOriginal: false },
    { type: 'combineColumns', columns: ['c0', 'c1'], separator: ' / ', name: 'Both', removeSources: true },
    { type: 'combineColumns', columns: ['c0', 'c1'], separator: ' / ', name: 'Both', removeSources: false },
    { type: 'keepRows', column: 'c0', condition: 'nonEmpty' },
    { type: 'keepRows', column: 'c0', condition: 'empty' },
    { type: 'removeRows', rowIds: [1, 3] },
    { type: 'removeColumns', columns: ['c1'] },
    { type: 'renameColumn', column: 'c0', name: 'Product' },
    { type: 'moveColumn', column: 'c0', toIndex: 2 },
    { type: 'editCell', rowId: 2, column: 'c0', value: 'কফি' },
    { type: 'promoteHeader' },
    { type: 'demoteHeader' },
  ];

  it.each(ops.map((op) => [JSON.stringify(op), op] as const))('%s is pure and structurally sound', (_label, op) => {
    const result = run(data, op);
    expect(result.changed).toBeGreaterThan(0);
    // Applying the op again to its own result must not mutate that result either. Ops that
    // consumed their column may legitimately refuse the second time.
    try {
      run(result.data, op);
    } catch (error) {
      expect((error as Error).message).toBe('That column no longer exists.');
    }
  });

  it('covers every operation type', () => {
    const covered = new Set(ops.map((op) => op.type));
    const all: TransformOp['type'][] = [
      'trim',
      'normalizeWhitespace',
      'removeEmptyRows',
      'removeEmptyColumns',
      'removeDuplicates',
      'convertCase',
      'extractNumbers',
      'parseDates',
      'normalizeUrls',
      'findReplace',
      'splitColumn',
      'combineColumns',
      'keepRows',
      'removeRows',
      'removeColumns',
      'renameColumn',
      'moveColumn',
      'editCell',
      'promoteHeader',
      'demoteHeader',
    ];
    expect([...covered].sort()).toEqual([...all].sort());
  });

  it('describes every operation with a short label', () => {
    for (const op of ops) {
      const label = describeOp(op);
      expect(label.length).toBeGreaterThan(3);
      expect(label.length).toBeLessThan(40);
    }
    expect(describeOp({ type: 'trim' })).toBe('Trim whitespace');
    expect(describeOp({ type: 'removeRows', rowIds: [1] })).toBe('Delete 1 row');
    expect(describeOp({ type: 'removeRows', rowIds: [1, 2] })).toBe('Delete 2 rows');
    expect(describeOp({ type: 'convertCase', mode: 'upper' })).toBe('Convert to UPPERCASE');
  });

  it('rejects an unknown operation', () => {
    expect(() => applyTransform(data, { type: 'explode' } as unknown as TransformOp)).toThrow(/Unknown operation/);
  });

  it('handles 200,000 rows without copying untouched rows', () => {
    const rows = Array.from({ length: 200_000 }, (_, i) => ({ id: i + 1, cells: [`name ${i}`, i % 1000 === 0 ? ' x ' : 'x'] }));
    const big: TableData = { columns: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], rows };
    const result = applyTransform(big, { type: 'trim' });
    expect(result.changed).toBe(200);
    let shared = 0;
    for (let i = 0; i < rows.length; i++) if (result.data.rows[i] === rows[i]) shared += 1;
    expect(shared).toBe(200_000 - 200);
  });
});
