import { describe, expect, it } from 'vitest';
import type { TableData } from '@/types/data';
import {
  allColumnStats,
  columnStats,
  extractAllNumbers,
  inferValueType,
  isBlank,
  parseDateUnambiguous,
  parseNumberLoose,
  parseNumberStrict,
  toAsciiDigits,
} from '@/data-processing/infer';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

describe('isBlank', () => {
  it.each(['', ' ', '\t\n', ' ', '​', '﻿ ‍'])('treats %j as blank', (value) => {
    expect(isBlank(value)).toBe(true);
  });

  it.each(['a', ' 0 ', 'বাংলা', '.', '​x'])('treats %j as not blank', (value) => {
    expect(isBlank(value)).toBe(false);
  });
});

describe('toAsciiDigits', () => {
  it.each([
    ['০১২৩৪৫৬৭৮৯', '0123456789'], // Bengali
    ['٠١٢٣٤٥٦٧٨٩', '0123456789'], // Arabic-Indic
    ['۰۱۲۳۴۵۶۷۸۹', '0123456789'], // Extended Arabic-Indic (Persian)
    ['०१२३४५६७८९', '0123456789'], // Devanagari
    ['０１２３４５６７８９', '0123456789'], // fullwidth
    ['𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗', '0123456789'], // mathematical bold (astral)
    ['𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡', '0123456789'], // mathematical double-struck (adjacent set)
    ['দাম ৫০০ টাকা', 'দাম 500 টাকা'],
    ['plain 123', 'plain 123'],
  ])('%s → %s', (input, expected) => {
    expect(toAsciiDigits(input)).toBe(expected);
  });
});

describe('inferValueType', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [' ', 'empty'],
    ['42', 'number'],
    ['-42', 'number'],
    ['+42', 'number'],
    ['−42', 'number'], // U+2212
    ['3.14', 'number'],
    ['.5', 'number'],
    ['1,234', 'number'],
    ['1,234,567.89', 'number'],
    ['12,34,567', 'number'], // Indian grouping
    ['$1,234.50', 'number'],
    ['-$5', 'number'],
    ['$-5', 'number'],
    ['৳ ১,২০০', 'number'],
    ['12 €', 'number'],
    ['45%', 'number'],
    ['12.5 %', 'number'],
    ['১২৩', 'number'],
    [' 7 ', 'number'],
    ['1,23', 'text'],
    ['1.234,56', 'text'],
    ['12 apples', 'text'],
    ['1e5', 'text'],
    ['--5', 'text'],
    ['-$-5', 'text'],
    ['$5%', 'text'],
    ['$', 'text'],
    ['-', 'text'],
    ['1 234', 'text'],
    ['true', 'boolean'],
    ['FALSE', 'boolean'],
    ['Yes', 'boolean'],
    ['no', 'boolean'],
    ['http://example.com', 'url'],
    ['HTTPS://Example.com/a?b=c#d', 'url'],
    ['ftp://example.com', 'text'],
    ['www.example.com', 'text'],
    ['https://example.com/a b', 'text'],
    ['user@example.com', 'email'],
    ['first.last+tag@sub.example.co.uk', 'email'],
    ['user@example', 'text'],
    ['a b@example.com', 'text'],
    ['2024-01-31', 'date'],
    ['2024/01/31', 'date'],
    ['31 Jan 2024', 'date'],
    ['January 31, 2024', 'date'],
    ['2024-01-31T10:30:00Z', 'date'],
    ['03/04/2024', 'date'], // ambiguous order, but still a date
    ['31/02/2024', 'text'], // impossible either way
    ['1/2/24', 'text'],
    ['hello', 'text'],
    ['বাংলা', 'text'],
    ['👍', 'text'],
  ])('%j → %s', (value, expected) => {
    expect(inferValueType(value)).toBe(expected);
  });

  it('classifies long prose as text without choking', () => {
    expect(inferValueType('word '.repeat(5000))).toBe('text');
    expect(inferValueType(`https://example.com/${'a'.repeat(5000)}`)).toBe('url');
  });
});

describe('parseNumberStrict', () => {
  it.each([
    ['42', 42],
    ['-1,234.5', -1234.5],
    ['$1,000', 1000],
    ['৳ ১,২০০.৫০', 1200.5],
    ['12,34,567', 1234567],
    ['45%', 45],
    ['.25', 0.25],
    ['-0', 0],
  ])('%j → %d', (value, expected) => {
    expect(parseNumberStrict(value)).toBe(expected);
  });

  it.each(['', 'abc', '1,23', '12 apples', '1.2.3', '1 234', '(5)'])('%j → null', (value) => {
    expect(parseNumberStrict(value)).toBeNull();
  });
});

describe('parseNumberLoose', () => {
  it.each<[string, number | null]>([
    ['42', 42],
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['1 234,5', 1234.5],
    ['1 234 567,89', 1234567.89],
    ['1 234,5', 1234.5],
    ["1'234'567.5", 1234567.5],
    ['12,345', 12345],
    ['1,234,567', 1234567],
    ['1.234.567', 1234567],
    ['12,34,567.89', 1234567.89],
    ['12,5', 12.5],
    ['0,345', 0.345],
    ['1234,567', 1234.567],
    ['1.234', 1.234],
    ['3.14', 3.14],
    ['.5', 0.5],
    ['-.5', -0.5],
    ['-12.5', -12.5],
    ['−12.5', -12.5], // U+2212 minus
    ['－7', -7], // fullwidth hyphen-minus
    ['+7', 7],
    ['(123)', 123], // parentheses are NOT a negative sign
    ['$1,299.00', 1299],
    ['-$5.50', -5.5],
    ['$-5.50', -5.5],
    ['-৳ 500', -500],
    ['Price: ৳ ১২,৩৪৫.৫০ only', 12345.5],
    ['১২,৩৪৫.৫০', 12345.5],
    ['٣٫١٤', 3.14], // Arabic-Indic digits with Arabic decimal separator
    ['١٬٢٣٤٫٥', 1234.5],
    ['१२३', 123],
    ['１２３．５', 123.5],
    ['about 15 items', 15],
    ['No.5', 5],
    ['v2', 2],
    ['SKU-123', 123], // hyphen glued to a word is not a minus
    ['10-20', 10],
    ['5 - 3', 5],
    ['Temp -5°C', -5],
    ['45%', 45],
    ['007', 7],
    ['0', 0],
    ['-0', 0],
    ['abc', null],
    ['', null],
    ['—', null],
    ['বাংলা', null],
  ])('%j → %j', (value, expected) => {
    expect(parseNumberLoose(value)).toBe(expected);
  });
});

describe('extractAllNumbers', () => {
  it.each<[string, string[]]>([
    ['', []],
    ['none here', []],
    ['1,234.56', ['1234.56']],
    ['১২,৩৪৫.৫০', ['12345.50']],
    ['12.50', ['12.50']],
    ['007', ['007']],
    ['.5', ['0.5']],
    ['3 for $10.50 (was 12)', ['3', '10.50', '12']],
    ['10-20', ['10', '20']],
    ['from -5 to +5', ['-5', '5']],
    ['1, 2, 3', ['1', '2', '3']],
    ['1,2,3', ['1', '2', '3']],
    ['1.5,2.5', ['1.5', '2.5']],
    ['192.168.1.1', ['192', '168', '1', '1']],
    ['31.12.2024', ['31', '12', '2024']],
    ['2024-01-31', ['2024', '01', '31']],
    ['1.234,56 € / 2.000,00 €', ['1234.56', '2000.00']],
    ['1 234,5 kg', ['1234.5']],
    ['10 20 30', ['10', '20', '30']],
    ['+880 1711 000000', ['880', '1711', '000000']],
    ['৫টি পণ্য, দাম ১,২০০ টাকা', ['5', '1200']],
    ['−1 234', ['-1234']],
  ])('%j → %j', (value, expected) => {
    expect(extractAllNumbers(value)).toEqual(expected);
  });
});

describe('parseDateUnambiguous', () => {
  it.each<[string, string]>([
    // ISO and year-first forms
    ['2024-01-31', '2024-01-31'],
    ['2024-1-5', '2024-01-05'],
    ['2024/01/31', '2024-01-31'],
    ['2024.01.31', '2024-01-31'],
    ['2024-02-29', '2024-02-29'], // leap day
    ['2000-02-29', '2000-02-29'],
    ['2024-01-31T10:30', '2024-01-31T10:30:00'],
    ['2024-01-31T10:30:45', '2024-01-31T10:30:45'],
    ['2024-01-31 10:30:45', '2024-01-31T10:30:45'],
    // Time zones are dropped, never applied: the wall-clock value is kept.
    ['2024-01-31T23:30:00Z', '2024-01-31T23:30:00'],
    ['2024-01-31T23:30:00+06:00', '2024-01-31T23:30:00'],
    ['2024-01-31T23:30:00.123-0800', '2024-01-31T23:30:00'],
    // English month names
    ['31 Jan 2024', '2024-01-31'],
    ['31 January 2024', '2024-01-31'],
    ['1 March 2024', '2024-03-01'],
    ['31st January 2024', '2024-01-31'],
    ['2nd of February, 2024', '2024-02-02'],
    ['31-Jan-2024', '2024-01-31'],
    ['3 sept 2024', '2024-09-03'],
    ['January 31, 2024', '2024-01-31'],
    ['Jan 31 2024', '2024-01-31'],
    ['Jan. 31st, 2024', '2024-01-31'],
    ['JANUARY 31, 2024', '2024-01-31'],
    ['december 1, 1999', '1999-12-01'],
    ['Wednesday, January 31, 2024', '2024-01-31'],
    ['Wed 31 Jan 2024', '2024-01-31'],
    ['January 31, 2024 5:05 PM', '2024-01-31T17:05:00'],
    ['Jan 31, 2024 at 12:00 am', '2024-01-31T00:00:00'],
    ['Jan 31, 2024, 12:15 p.m.', '2024-01-31T12:15:00'],
    // RFC 2822
    ['Wed, 31 Jan 2024 10:30:00 +0000', '2024-01-31T10:30:00'],
    ['Wed, 31 Jan 2024 10:30:00 GMT', '2024-01-31T10:30:00'],
    ['31 Jan 2024 10:30 EST', '2024-01-31T10:30:00'],
    // Numeric day/month only when the order is certain
    ['31/01/2024', '2024-01-31'],
    ['01/31/2024', '2024-01-31'],
    ['13.02.2024', '2024-02-13'],
    ['25-12-2024', '2024-12-25'],
    ['12/25/2024', '2024-12-25'],
    ['05/05/2024', '2024-05-05'], // same either way
    ['31/01/2024 08:15', '2024-01-31T08:15:00'],
    // Other scripts' digits
    ['৩১/০১/২০২৪', '2024-01-31'],
    ['২০২৪-০১-৩১', '2024-01-31'],
    ['  2024-01-31  ', '2024-01-31'],
  ])('%j → %s', (value, expected) => {
    expect(parseDateUnambiguous(value)).toBe(expected);
  });

  it.each([
    '',
    'not a date',
    '03/04/2024', // could be 3 April or 4 March
    '1/2/2024',
    '12.11.2024',
    '03/04/24', // two-digit year
    '31/01/24',
    "Jan 31 '24",
    '2024-02-30', // impossible dates
    '2023-02-29',
    '1900-02-29',
    '2024-13-01',
    '2024-00-10',
    '2024-01-32',
    '31/02/2024',
    '31 April 2024',
    'June 31, 2024',
    '32/13/2024',
    '2024-01-31T24:00',
    '2024-01-31T10:60',
    'Jan 31, 2024 13:00 PM',
    '2024-01', // incomplete
    'January 2024',
    '20240131',
    '2024',
    '31 Foo 2024',
    'Posted on 31 Jan 2024', // free text around a date is not a date value
    '2024-01-31 and more',
    '2024-01/31', // mixed separators
    '10:30',
  ])('rejects %j', (value) => {
    expect(parseDateUnambiguous(value)).toBeNull();
  });

  it('does not depend on the machine time zone', () => {
    // The parser never constructs a Date from the text, so there is nothing to shift.
    expect(parseDateUnambiguous('2024-03-10T02:30:00-05:00')).toBe('2024-03-10T02:30:00');
    expect(parseDateUnambiguous('2024-01-01T00:00:00+14:00')).toBe('2024-01-01T00:00:00');
  });
});

describe('columnStats', () => {
  it('reports the dominant type and exact counts', () => {
    const data = table(
      ['n', 'mixed', 'empty', 'text'],
      [
        ['1', '1', '', 'a'],
        ['2', 'x', ' ', 'b'],
        ['3', '2024-01-01', ' ', 'a'],
        ['', 'true', '', 'বাংলা'],
      ],
    );
    expect(columnStats(data, 0)).toEqual({ type: 'number', empty: 1, nonEmpty: 3, distinct: 3 });
    expect(columnStats(data, 1)).toEqual({ type: 'mixed', empty: 0, nonEmpty: 4, distinct: 4 });
    expect(columnStats(data, 2)).toEqual({ type: 'empty', empty: 4, nonEmpty: 0, distinct: 0 });
    expect(columnStats(data, 3)).toEqual({ type: 'text', empty: 0, nonEmpty: 4, distinct: 3 });
    expect(allColumnStats(data).map((stats) => stats.type)).toEqual(['number', 'mixed', 'empty', 'text']);
  });

  it('uses a 90% threshold for the dominant type', () => {
    const nine = Array.from({ length: 9 }, (_, i) => [String(i)]);
    expect(columnStats(table(['c'], [...nine, ['oops']]), 0).type).toBe('number'); // exactly 90%
    const eight = nine.slice(0, 8);
    expect(columnStats(table(['c'], [...eight, ['oops'], ['again']]), 0).type).toBe('mixed'); // 80%
  });

  it('handles an empty dataset and an out-of-range column', () => {
    expect(columnStats(table(['c'], []), 0)).toEqual({ type: 'empty', empty: 0, nonEmpty: 0, distinct: 0 });
    expect(columnStats(table(['c'], [['x']]), 5)).toEqual({ type: 'empty', empty: 1, nonEmpty: 0, distinct: 0 });
  });

  it('samples the type on large data but counts empties and distinct values exactly', () => {
    const rows: string[][] = [];
    for (let i = 0; i < 60_000; i++) rows.push([i % 3 === 0 ? '' : String(i % 1000)]);
    const stats = columnStats(table(['n'], rows), 0);
    expect(stats.empty).toBe(20_000);
    expect(stats.nonEmpty).toBe(40_000);
    expect(stats.type).toBe('number');
    // Values i % 1000 with i % 3 !== 0: every residue 0..999 is reached by some i not divisible by 3.
    expect(stats.distinct).toBe(1000);
  });
});
