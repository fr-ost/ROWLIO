import { describe, expect, it } from 'vitest';
import type { TableData } from '@/types/data';
import type { ColumnFilter, FilterCondition, ViewSpec } from '@/types/transforms';
import { computeView, countEmptyCells, findDuplicateRowIds } from '@/data-processing/view';

function table(columns: string[], rows: string[][]): TableData {
  return {
    columns: columns.map((name, index) => ({ id: `c${index}`, name })),
    rows: rows.map((cells, index) => ({ id: index + 1, cells })),
  };
}

function view(partial: Partial<ViewSpec> = {}): ViewSpec {
  return { search: '', filters: [], sort: null, ...partial };
}

const filter = (column: string, condition: FilterCondition, value = ''): ColumnFilter => ({ column, condition, value });

const products = table(
  ['Name', 'Price', 'Note'],
  [
    ['Green Tea', '120', 'organic'],
    ['black tea', '95', ''],
    ['Coffee', '1,200', 'Imported'],
    ['চা পাতা', '৫০', 'দেশি'],
    ['Mug 👍', '', '  '],
    ['TEA SET', '2500', 'gift (new)'],
  ],
);

/** Values of one column in view order. */
function shown(data: TableData, spec: ViewSpec, columnIndex = 0): string[] {
  return computeView(data, spec).map((index) => data.rows[index]!.cells[columnIndex]!);
}

describe('computeView basics', () => {
  it('returns every row in order for an empty view', () => {
    expect(computeView(products, view())).toEqual([0, 1, 2, 3, 4, 5]);
    expect(computeView(table(['a'], []), view({ search: 'x' }))).toEqual([]);
  });

  it('does not mutate the data', () => {
    const snapshot = structuredClone(products);
    computeView(products, view({ search: 'tea', sort: { column: 'c1', direction: 'desc' }, duplicatesOnly: true }));
    expect(products).toEqual(snapshot);
  });
});

describe('search', () => {
  it('is a case-insensitive substring match across all cells', () => {
    expect(shown(products, view({ search: 'tea' }))).toEqual(['Green Tea', 'black tea', 'TEA SET']);
    expect(shown(products, view({ search: 'IMPORT' }))).toEqual(['Coffee']);
    expect(shown(products, view({ search: '120' }))).toEqual(['Green Tea']);
    expect(shown(products, view({ search: '1,2' }))).toEqual(['Coffee']);
  });

  it('ignores surrounding whitespace in the query and treats it literally', () => {
    expect(shown(products, view({ search: '  tea  ' }))).toEqual(['Green Tea', 'black tea', 'TEA SET']);
    expect(shown(products, view({ search: '   ' }))).toHaveLength(6);
    // Regex metacharacters have no special meaning in a search.
    expect(shown(products, view({ search: '(new)' }))).toEqual(['TEA SET']);
    expect(shown(products, view({ search: '.' }))).toEqual([]);
    expect(shown(products, view({ search: 't.a' }))).toEqual([]);
  });

  it('finds Bengali text and emoji', () => {
    expect(shown(products, view({ search: 'পাতা' }))).toEqual(['চা পাতা']);
    expect(shown(products, view({ search: 'দেশি' }))).toEqual(['চা পাতা']);
    expect(shown(products, view({ search: '👍' }))).toEqual(['Mug 👍']);
    expect(shown(products, view({ search: '৫০' }))).toEqual(['চা পাতা']);
  });

  it('is case-insensitive beyond ASCII', () => {
    const data = table(['a'], [['ÉCOLE'], ['école'], ['Straße'], ['ΑΘΗΝΑ']]);
    expect(shown(data, view({ search: 'école' }))).toEqual(['ÉCOLE', 'école']);
    expect(shown(data, view({ search: 'αθηνα' }))).toEqual(['ΑΘΗΝΑ']);
  });
});

describe('column filters', () => {
  it('contains / notContains', () => {
    expect(shown(products, view({ filters: [filter('c0', 'contains', 'TEA')] }))).toEqual(['Green Tea', 'black tea', 'TEA SET']);
    expect(shown(products, view({ filters: [filter('c0', 'notContains', 'tea')] }))).toEqual(['Coffee', 'চা পাতা', 'Mug 👍']);
  });

  it('equals / notEquals compare the whole cell, ignoring case', () => {
    expect(shown(products, view({ filters: [filter('c0', 'equals', 'coffee')] }))).toEqual(['Coffee']);
    expect(shown(products, view({ filters: [filter('c0', 'equals', 'tea')] }))).toEqual([]);
    expect(shown(products, view({ filters: [filter('c0', 'notEquals', 'COFFEE')] }))).toHaveLength(5);
    expect(shown(products, view({ filters: [filter('c1', 'equals', '120')] }))).toEqual(['Green Tea']);
  });

  it('startsWith / endsWith', () => {
    expect(shown(products, view({ filters: [filter('c0', 'startsWith', 'tea')] }))).toEqual(['TEA SET']);
    expect(shown(products, view({ filters: [filter('c0', 'endsWith', 'TEA')] }))).toEqual(['Green Tea', 'black tea']);
    expect(shown(products, view({ filters: [filter('c0', 'endsWith', '👍')] }))).toEqual(['Mug 👍']);
    expect(shown(products, view({ filters: [filter('c0', 'startsWith', 'চা')] }))).toEqual(['চা পাতা']);
  });

  it('empty / nonEmpty treat whitespace-only cells as empty', () => {
    expect(shown(products, view({ filters: [filter('c2', 'empty')] }))).toEqual(['black tea', 'Mug 👍']);
    expect(shown(products, view({ filters: [filter('c2', 'nonEmpty')] }))).toEqual(['Green Tea', 'Coffee', 'চা পাতা', 'TEA SET']);
    // The value of an empty / nonEmpty filter is irrelevant.
    expect(shown(products, view({ filters: [filter('c2', 'empty', 'ignored')] }))).toEqual(['black tea', 'Mug 👍']);
  });

  it('regex is used as given, case-insensitively', () => {
    expect(shown(products, view({ filters: [filter('c0', 'regex', '^(green|black) tea$')] }))).toEqual(['Green Tea', 'black tea']);
    expect(shown(products, view({ filters: [filter('c1', 'regex', '^\\d{3,}$')] }))).toEqual(['Green Tea', 'TEA SET']);
    expect(shown(products, view({ filters: [filter('c0', 'regex', '\\p{Script=Bengali}')] }))).toEqual(['চা পাতা']);
    // A dot matches a whole emoji, so "g followed by exactly two characters" does not split it.
    expect(shown(products, view({ filters: [filter('c0', 'regex', 'g .$')] }))).toEqual(['Mug 👍']);
    // Legacy-only syntax still works.
    expect(shown(products, view({ filters: [filter('c2', 'regex', '\\(new\\)\\ ?$')] }))).toEqual(['TEA SET']);
  });

  it('an invalid regex matches nothing instead of throwing', () => {
    expect(() => computeView(products, view({ filters: [filter('c0', 'regex', '([a-z')] }))).not.toThrow();
    expect(computeView(products, view({ filters: [filter('c0', 'regex', '([a-z')] }))).toEqual([]);
    expect(computeView(products, view({ filters: [filter('c0', 'regex', '*')] }))).toEqual([]);
  });

  it('literal filters do not interpret regex syntax', () => {
    expect(shown(products, view({ filters: [filter('c2', 'contains', '(new)')] }))).toEqual(['TEA SET']);
    expect(shown(products, view({ filters: [filter('c0', 'contains', '.*')] }))).toEqual([]);
    expect(shown(products, view({ filters: [filter('c1', 'equals', '1,200')] }))).toEqual(['Coffee']);
  });

  it('combines filters with AND, and with the search', () => {
    const spec = view({ filters: [filter('c0', 'contains', 'tea'), filter('c2', 'nonEmpty')] });
    expect(shown(products, spec)).toEqual(['Green Tea', 'TEA SET']);
    expect(shown(products, { ...spec, search: 'gift' })).toEqual(['TEA SET']);
  });

  it('ignores filters without a value and filters on columns that no longer exist', () => {
    for (const condition of ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith', 'regex'] as const) {
      expect(computeView(products, view({ filters: [filter('c0', condition, '')] }))).toHaveLength(6);
    }
    expect(computeView(products, view({ filters: [filter('gone', 'contains', 'zzz')] }))).toHaveLength(6);
    expect(computeView(products, view({ filters: [filter('gone', 'empty')] }))).toHaveLength(6);
  });
});

describe('sorting', () => {
  it('sorts numbers numerically, not as text', () => {
    const data = table(['n'], [['10'], ['9'], ['1,000'], ['-5'], ['2.5'], ['$30'], ['৭'], ['45%']]);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'asc' } }))).toEqual(['-5', '2.5', '৭', '9', '10', '$30', '45%', '1,000']);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'desc' } }))).toEqual(['1,000', '45%', '$30', '10', '9', '৭', '2.5', '-5']);
  });

  it('sorts text naturally and case-insensitively', () => {
    const data = table(['t'], [['item 10'], ['Item 9'], ['banana'], ['Apple'], ['item 1'], ['cherry']]);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'asc' } }))).toEqual(['Apple', 'banana', 'cherry', 'item 1', 'Item 9', 'item 10']);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'desc' } }))).toEqual(['item 10', 'Item 9', 'item 1', 'cherry', 'banana', 'Apple']);
  });

  it('puts empty cells last in both directions', () => {
    const data = table(['v'], [[''], ['b'], ['  '], ['a'], [' '], ['3']]);
    const asc = computeView(data, view({ sort: { column: 'c0', direction: 'asc' } }));
    const desc = computeView(data, view({ sort: { column: 'c0', direction: 'desc' } }));
    expect(asc).toEqual([5, 3, 1, 0, 2, 4]);
    expect(desc).toEqual([1, 3, 5, 0, 2, 4]);
  });

  it('is stable: ties keep their original order in both directions', () => {
    const data = table(
      ['group', 'label'],
      [
        ['b', 'first b'],
        ['a', 'first a'],
        ['B', 'second b'],
        ['a', 'second a'],
        ['b', 'third b'],
        ['A', 'third a'],
      ],
    );
    expect(shown(data, view({ sort: { column: 'c0', direction: 'asc' } }), 1)).toEqual([
      'first a',
      'second a',
      'third a',
      'first b',
      'second b',
      'third b',
    ]);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'desc' } }), 1)).toEqual([
      'first b',
      'second b',
      'third b',
      'first a',
      'second a',
      'third a',
    ]);
  });

  it('is stable for equal numbers written differently', () => {
    const data = table(['n', 'label'], [['1.0', 'a'], ['2', 'b'], ['1', 'c'], ['01', 'd'], ['1.00', 'e']]);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'asc' } }), 1)).toEqual(['a', 'c', 'd', 'e', 'b']);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'desc' } }), 1)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('orders a mixed column consistently: numbers, then text, then empty', () => {
    const data = table(['v'], [['N/A'], ['999'], ['5 apples'], ['1,000'], [''], ['12'], ['abc']]);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'asc' } }))).toEqual(['12', '999', '1,000', '5 apples', 'abc', 'N/A', '']);
    expect(shown(data, view({ sort: { column: 'c0', direction: 'desc' } }))).toEqual(['N/A', 'abc', '5 apples', '1,000', '999', '12', '']);
  });

  it('sorts Bengali text without throwing and keeps all rows', () => {
    const data = table(['t'], [['খ'], ['ক'], ['গ'], ['অ']]);
    const order = shown(data, view({ sort: { column: 'c0', direction: 'asc' } }));
    expect(order).toEqual(['অ', 'ক', 'খ', 'গ']);
  });

  it('sorts only the rows that passed the filters, and ignores an unknown sort column', () => {
    expect(shown(products, view({ search: 'tea', sort: { column: 'c1', direction: 'desc' } }))).toEqual(['TEA SET', 'Green Tea', 'black tea']);
    expect(computeView(products, view({ sort: { column: 'gone', direction: 'asc' } }))).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('duplicates', () => {
  const data = table(
    ['a', 'b'],
    [
      ['x', '1'],
      ['y', '2'],
      ['x', '1'],
      ['x', '2'],
      ['y', '2'],
      ['x', '1'],
      ['X', '1'],
    ],
  );

  it('findDuplicateRowIds returns rows that repeat an earlier row', () => {
    expect([...findDuplicateRowIds(data)]).toEqual([3, 5, 6]);
    expect([...findDuplicateRowIds(data, [])]).toEqual([3, 5, 6]);
  });

  it('can compare a subset of columns', () => {
    expect([...findDuplicateRowIds(data, ['c0'])]).toEqual([3, 4, 5, 6]);
    expect([...findDuplicateRowIds(data, ['c1'])]).toEqual([3, 4, 5, 6, 7]);
    expect([...findDuplicateRowIds(data, ['c1', 'c0', 'c1'])]).toEqual([3, 5, 6]);
    // Unknown ids are ignored; if none is left, all columns are compared.
    expect([...findDuplicateRowIds(data, ['c0', 'gone'])]).toEqual([3, 4, 5, 6]);
    expect([...findDuplicateRowIds(data, ['gone'])]).toEqual([3, 5, 6]);
  });

  it('uses row ids, not positions', () => {
    const shuffled: TableData = {
      columns: data.columns,
      rows: [
        { id: 40, cells: ['q'] },
        { id: 7, cells: ['q'] },
        { id: 12, cells: ['r'] },
        { id: 3, cells: ['q'] },
      ].map((row) => ({ id: row.id, cells: [row.cells[0]!, ''] })),
    };
    expect([...findDuplicateRowIds(shuffled)]).toEqual([7, 3]);
  });

  it('does not confuse cell boundaries', () => {
    const tricky = table(['a', 'b'], [['ab', ''], ['a', 'b'], ['', 'ab']]);
    expect(findDuplicateRowIds(tricky).size).toBe(0);
  });

  it('duplicatesOnly shows exactly those rows and composes with search and sort', () => {
    expect(computeView(data, view({ duplicatesOnly: true }))).toEqual([2, 4, 5]);
    expect(computeView(data, view({ duplicatesOnly: true, search: 'y' }))).toEqual([4]);
    expect(computeView(data, view({ duplicatesOnly: true, sort: { column: 'c0', direction: 'desc' } }))).toEqual([4, 2, 5]);
    // A duplicate stays a duplicate even when its original is filtered out of view.
    expect(computeView(data, view({ duplicatesOnly: true, filters: [filter('c1', 'equals', '2')] }))).toEqual([4]);
    expect(computeView(table(['a'], [['1'], ['2']]), view({ duplicatesOnly: true }))).toEqual([]);
  });
});

describe('countEmptyCells', () => {
  it('counts empty and whitespace-only cells', () => {
    expect(countEmptyCells(products)).toBe(3);
    expect(countEmptyCells(table(['a', 'b'], [['', ' '], ['\t', 'x'], [' ', '​']]))).toBe(5);
    expect(countEmptyCells(table(['a'], []))).toBe(0);
  });
});

describe('scale', () => {
  it('filters, searches and sorts 200,000 × 10 in reasonable time', () => {
    const columns = Array.from({ length: 10 }, (_, i) => `col ${i}`);
    const rows: string[][] = [];
    for (let r = 0; r < 200_000; r++) {
      const cells = new Array<string>(10);
      for (let c = 0; c < 10; c++) cells[c] = c === 0 ? String((r * 7919) % 200_003) : c === 1 ? (r % 5 === 0 ? '' : `Item ${r % 977}`) : `value ${r}-${c}`;
      rows.push(cells);
    }
    const data = table(columns, rows);

    const started = performance.now();
    const all = computeView(data, view({ sort: { column: 'c0', direction: 'asc' } }));
    const searched = computeView(data, view({ search: 'value 1999' }));
    const filtered = computeView(data, view({ filters: [filter('c1', 'nonEmpty'), filter('c1', 'contains', 'item 9')], sort: { column: 'c1', direction: 'desc' } }));
    const duplicates = findDuplicateRowIds(data);
    const elapsed = performance.now() - started;

    expect(all).toHaveLength(200_000);
    for (let i = 1; i < all.length; i += 997) {
      expect(Number(data.rows[all[i - 1]!]!.cells[0])).toBeLessThanOrEqual(Number(data.rows[all[i]!]!.cells[0]));
    }
    // "value 1999-c" (row 1999) and "value 1999x-c" for x = 0..9 (rows 19990–19999) and 199900–199999.
    expect(searched).toHaveLength(1 + 10 + 100);
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every((index) => /^Item 9/.test(data.rows[index]!.cells[1]!))).toBe(true);
    expect(duplicates.size).toBe(0);
    // Generous bound: this is a smoke test against accidental quadratic behaviour.
    expect(elapsed).toBeLessThan(15_000);
  });
});
