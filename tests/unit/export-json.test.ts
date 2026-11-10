import { describe, expect, it } from 'vitest';
import type { TableData } from '@/types/data';
import { jsonChunks, jsonlChunks, toJson, toRecords } from '@/export/json';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

const products = table(
  ['Name', 'Price', 'Note'],
  [
    ['Tea', '120', 'line 1\nline 2'],
    ['চা পাতা', '১২০', 'আমার সোনার বাংলা'],
    ['Mug 👍', '', 'say "hi" \\ back\tslash'],
  ],
);

/** Keys of each object in the order they appear in the JSON text (for flat objects without braces in values). */
function keyOrder(json: string): string[][] {
  const order: string[][] = [];
  for (const object of json.match(/\{[^{}]*\}/g) ?? []) {
    const keys: string[] = [];
    const pattern = /"((?:[^"\\]|\\.)*)"\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(object)) !== null) keys.push(JSON.parse(`"${match[1]}"`) as string);
    order.push(keys);
  }
  return order;
}

describe('toRecords', () => {
  it('creates one object per row keyed by column name, values as strings', () => {
    expect(toRecords(products)).toEqual([
      { Name: 'Tea', Price: '120', Note: 'line 1\nline 2' },
      { Name: 'চা পাতা', Price: '১২০', Note: 'আমার সোনার বাংলা' },
      { Name: 'Mug 👍', Price: '', Note: 'say "hi" \\ back\tslash' },
    ]);
    expect(Object.keys(toRecords(products)[0]!)).toEqual(['Name', 'Price', 'Note']);
  });

  it('never loses a column when names collide', () => {
    const data = table(['a', 'a', 'a (2)', ''], [['1', '2', '3', '4']]);
    const [record] = toRecords(data);
    expect(Object.keys(record!)).toHaveLength(4);
    expect(Object.values(record!).sort()).toEqual(['1', '2', '3', '4']);
    expect(record).toEqual({ a: '1', 'a (2)': '2', 'a (2) (2)': '3', '': '4' });
  });

  it('keeps special property names as ordinary data', () => {
    const data = table(['__proto__', 'constructor', 'toString'], [['p', 'c', 't']]);
    const [record] = toRecords(data);
    expect(Object.keys(record!).sort()).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.getOwnPropertyDescriptor(record!, '__proto__')?.value).toBe('p');
    expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
  });

  it('handles empty data', () => {
    expect(toRecords(table(['a'], []))).toEqual([]);
    expect(toRecords(table([], [[], []]))).toEqual([{}, {}]);
  });
});

describe('toJson', () => {
  it('produces valid JSON equal to the records, compact or pretty', () => {
    const compact = toJson(products, { pretty: false });
    const pretty = toJson(products, { pretty: true });
    expect(JSON.parse(compact)).toEqual(toRecords(products));
    expect(JSON.parse(pretty)).toEqual(toRecords(products));
    expect(compact).toBe(JSON.stringify(toRecords(products)));
    expect(pretty).toBe(JSON.stringify(toRecords(products), null, 2));
    expect(compact).not.toContain('\n');
  });

  it('writes Unicode as real characters, not escapes', () => {
    const json = toJson(products, { pretty: false });
    expect(json).toContain('আমার সোনার বাংলা');
    expect(json).toContain('১২০');
    expect(json).toContain('👍');
    expect(json).not.toMatch(/\\u09/i);
  });

  it('escapes what JSON requires and survives lone surrogates and control characters', () => {
    const data = table(['k"ey', 'v'], [['a\u0000b', 'lone \ud83d surrogate'], ['\u2028\u2029', '\\"\n\r\t\b\f']]);
    for (const pretty of [false, true]) {
      const json = toJson(data, { pretty });
      const parsed = JSON.parse(json) as Record<string, string>[];
      expect(parsed).toEqual([
        { 'k"ey': 'a\u0000b', v: 'lone \ud83d surrogate' },
        { 'k"ey': '\u2028\u2029', v: '\\"\n\r\t\b\f' },
      ]);
      // Well-formed output: no raw control characters, no unpaired surrogate.
      expect(json).not.toMatch(/[\u0000-\u0009\u000b-\u001f]/);
      expect(json).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
  });

  it('preserves the column order in every object', () => {
    const data = table(['z', 'a', 'm', 'বাংলা', 'b'], [['1', '2', '3', '4', '5'], ['6', '7', '8', '9', '10']]);
    for (const pretty of [false, true]) {
      expect(keyOrder(toJson(data, { pretty }))).toEqual([
        ['z', 'a', 'm', 'বাংলা', 'b'],
        ['z', 'a', 'm', 'বাংলা', 'b'],
      ]);
    }
  });

  it('preserves the column order even for integer-like names, which objects would reorder', () => {
    const data = table(['2023', 'Name', '2022', '10', '9'], [['a', 'b', 'c', 'd', 'e']]);
    // The plain-object view cannot keep this order – that is a JavaScript rule…
    expect(Object.keys(toRecords(data)[0]!)).toEqual(['9', '10', '2022', '2023', 'Name']);
    // …but the serialised text does, in both layouts and in JSON Lines.
    const expected = [['2023', 'Name', '2022', '10', '9']];
    expect(keyOrder(toJson(data, { pretty: false }))).toEqual(expected);
    expect(keyOrder(toJson(data, { pretty: true }))).toEqual(expected);
    expect(keyOrder([...jsonlChunks(data)].join(''))).toEqual(expected);
    expect(toJson(data, { pretty: false })).toBe('[{"2023":"a","Name":"b","2022":"c","10":"d","9":"e"}]');
    expect(JSON.parse(toJson(data, { pretty: true }))).toEqual(toRecords(data));
  });

  it('keeps values as strings – numbers, booleans and null-looking text are not converted', () => {
    const data = table(['n', 'b', 'x', 'lead'], [['42', 'true', 'null', '007']]);
    expect(toJson(data, { pretty: false })).toBe('[{"n":"42","b":"true","x":"null","lead":"007"}]');
  });

  it('handles empty data and tables without columns', () => {
    expect(toJson(table(['a'], []), { pretty: false })).toBe('[]');
    expect(toJson(table(['a'], []), { pretty: true })).toBe('[]');
    expect(toJson(table([], [[]]), { pretty: false })).toBe('[{}]');
    expect(toJson(table([], [[], []]), { pretty: true })).toBe(JSON.stringify([{}, {}], null, 2));
  });

  it('chunks concatenate to exactly the same document', () => {
    const rows = Array.from({ length: 2501 }, (_, i) => [String(i), `চা ${i}`]);
    const data = table(['n', 'label'], rows);
    for (const pretty of [false, true]) {
      const chunks = [...jsonChunks(data, { pretty }, 1000)];
      expect(chunks).toHaveLength(3);
      expect(chunks.join('')).toBe(toJson(data, { pretty }));
      const parsed = JSON.parse(chunks.join('')) as Record<string, string>[];
      expect(parsed).toHaveLength(2501);
      expect(parsed[2500]).toEqual({ n: '2500', label: 'চা 2500' });
    }
    // An exact multiple of the chunk size still closes the array.
    const exact = table(['n'], Array.from({ length: 2000 }, (_, i) => [String(i)]));
    const chunks = [...jsonChunks(exact, { pretty: false }, 1000)];
    expect(chunks).toHaveLength(2);
    expect(JSON.parse(chunks.join(''))).toHaveLength(2000);
  });
});

describe('jsonlChunks', () => {
  it('writes one valid JSON object per line, each terminated by a newline', () => {
    const text = [...jsonlChunks(products)].join('');
    expect(text.endsWith('\n')).toBe(true);
    const lines = text.split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(toRecords(products));
    // Newlines inside values are escaped, so a record never spans lines.
    expect(lines[0]).toBe('{"Name":"Tea","Price":"120","Note":"line 1\\nline 2"}');
    expect(lines[1]).toBe('{"Name":"চা পাতা","Price":"১২০","Note":"আমার সোনার বাংলা"}');
  });

  it('every line parses on its own for large, awkward data', () => {
    const rows = Array.from({ length: 4321 }, (_, i) => [String(i), i % 7 === 0 ? 'multi\nline "q" \u2028' : `বাংলা ${i} 👍`]);
    const data = table(['id', 'text'], rows);
    const chunks = [...jsonlChunks(data, 1000)];
    expect(chunks).toHaveLength(5);
    const lines = chunks.join('').split('\n');
    expect(lines.pop()).toBe('');
    expect(lines).toHaveLength(4321);
    lines.forEach((line, index) => {
      const parsed = JSON.parse(line) as Record<string, string>;
      expect(Object.keys(parsed)).toEqual(['id', 'text']);
      expect(parsed.id).toBe(String(index));
      expect(parsed.text).toBe(rows[index]![1]);
    });
  });

  it('yields nothing for no rows and "{}" lines for no columns', () => {
    expect([...jsonlChunks(table(['a'], []))]).toEqual([]);
    expect([...jsonlChunks(table([], [[], []]))].join('')).toBe('{}\n{}\n');
  });
});
