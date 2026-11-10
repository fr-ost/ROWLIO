import { describe, expect, it } from 'vitest';
import type { Dataset, RawDataset, TableData } from '@/types/data';
import { isDataset } from '@/types/guards';
import { appendRaw, cloneTableData, datasetFromRaw, nextRowId, rowKey } from '@/data-processing/dataset';

function raw(partial: Partial<RawDataset> = {}): RawDataset {
  return {
    key: 'table:0',
    name: 'Products',
    columns: ['Name', 'Price'],
    rows: [
      ['Tea', '120'],
      ['চা', '১২০'],
    ],
    warnings: [],
    method: 'table',
    ...partial,
  };
}

const SOURCE = { url: 'https://example.test/shop', title: 'Shop' };

describe('datasetFromRaw', () => {
  it('builds a valid dataset with ids, names and source', () => {
    const before = Date.now();
    const dataset = datasetFromRaw(raw({ detail: 'Table 1' }), { ...SOURCE, pages: 3 });

    expect(isDataset(dataset)).toBe(true);
    expect(dataset.id).toMatch(/^ds_/);
    expect(dataset.name).toBe('Products');
    expect(dataset.columns.map((c) => c.name)).toEqual(['Name', 'Price']);
    expect(dataset.columns.every((c) => /^c_/.test(c.id))).toBe(true);
    expect(new Set(dataset.columns.map((c) => c.id)).size).toBe(2);
    expect(dataset.rows).toEqual([
      { id: 1, cells: ['Tea', '120'] },
      { id: 2, cells: ['চা', '১২০'] },
    ]);
    expect(dataset.source.url).toBe(SOURCE.url);
    expect(dataset.source.title).toBe('Shop');
    expect(dataset.source.method).toBe('table');
    expect(dataset.source.detail).toBe('Table 1');
    expect(dataset.source.pages).toBe(3);
    expect(dataset.source.extractedAt).toBeGreaterThanOrEqual(before);
    expect(dataset.warnings).toEqual([]);
  });

  it('uses the given extraction time and leaves optional source fields out', () => {
    const dataset = datasetFromRaw(raw(), { ...SOURCE, extractedAt: 1_700_000_000_000 });
    expect(dataset.source.extractedAt).toBe(1_700_000_000_000);
    expect('detail' in dataset.source).toBe(false);
    expect('pages' in dataset.source).toBe(false);
  });

  it('makes column names unique and non-empty', () => {
    const dataset = datasetFromRaw(raw({ columns: ['Name', '', 'Name', '  Price  '], rows: [] }), SOURCE);
    expect(dataset.columns.map((c) => c.name)).toEqual(['Name', 'Column 2', 'Name (2)', 'Price']);
  });

  it('pads short rows with empty cells and warns', () => {
    const dataset = datasetFromRaw(raw({ columns: ['A', 'B', 'C'], rows: [['1'], ['1', '2', '3'], []] }), SOURCE);
    expect(dataset.rows.map((r) => r.cells)).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
      ['', '', ''],
    ]);
    expect(dataset.warnings).toHaveLength(1);
    expect(dataset.warnings[0]).toContain('2 rows had fewer cells');
    expect(isDataset(dataset)).toBe(true);
  });

  it('adds columns for rows longer than the header instead of dropping cells', () => {
    const dataset = datasetFromRaw(
      raw({
        columns: ['A', 'B'],
        rows: [
          ['1', '2'],
          ['1', '2', 'extra', 'more'],
          ['1'],
        ],
        warnings: ['from the page'],
      }),
      SOURCE,
    );
    expect(dataset.columns.map((c) => c.name)).toEqual(['A', 'B', 'Column 3', 'Column 4']);
    expect(dataset.rows.map((r) => r.cells)).toEqual([
      ['1', '2', '', ''],
      ['1', '2', 'extra', 'more'],
      ['1', '', '', ''],
    ]);
    // Original warnings are kept and both kinds of raggedness are reported.
    expect(dataset.warnings[0]).toBe('from the page');
    expect(dataset.warnings.some((w) => w.includes('1 row had fewer cells'))).toBe(true);
    expect(dataset.warnings.some((w) => w.includes('1 row had more cells'))).toBe(true);
    expect(isDataset(dataset)).toBe(true);
  });

  it('handles a dataset without a header or without rows', () => {
    const headerless = datasetFromRaw(raw({ columns: [], rows: [['a', 'b']] }), SOURCE);
    expect(headerless.columns.map((c) => c.name)).toEqual(['Column 1', 'Column 2']);
    expect(headerless.rows[0]!.cells).toEqual(['a', 'b']);

    const empty = datasetFromRaw(raw({ columns: [], rows: [] }), SOURCE);
    expect(empty.columns).toEqual([]);
    expect(empty.rows).toEqual([]);
    expect(empty.warnings).toEqual([]);
  });

  it('does not share arrays with the raw input', () => {
    const input = raw();
    const dataset = datasetFromRaw(input, SOURCE);
    dataset.rows[0]!.cells[0] = 'changed';
    dataset.warnings.push('x');
    expect(input.rows[0]![0]).toBe('Tea');
    expect(input.warnings).toEqual([]);
  });

  it('coerces non-string cells defensively (values crossing the messaging boundary)', () => {
    const input = raw({ rows: [[null, 5] as unknown as string[]] });
    const dataset = datasetFromRaw(input, SOURCE);
    expect(dataset.rows[0]!.cells).toEqual(['', '5']);
  });
});

describe('appendRaw', () => {
  function base(): Dataset {
    return datasetFromRaw(raw(), SOURCE);
  }

  it('appends rows with continuing ids and does not mutate the input', () => {
    const dataset = base();
    const snapshot = structuredClone(dataset);
    const result = appendRaw(dataset, raw({ rows: [['Coffee', '200']] }));

    expect(result.added).toBe(1);
    expect(result.dataset).not.toBe(dataset);
    expect(result.dataset.id).toBe(dataset.id);
    expect(result.dataset.rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(result.dataset.rows[2]!.cells).toEqual(['Coffee', '200']);
    expect(dataset).toEqual(snapshot);
    // Same columns: existing rows and column objects are shared, not copied.
    expect(result.dataset.rows[0]).toBe(dataset.rows[0]);
    expect(result.dataset.columns[0]).toBe(dataset.columns[0]);
    expect(isDataset(result.dataset)).toBe(true);
  });

  it('aligns by column name, not by position', () => {
    const result = appendRaw(base(), raw({ columns: ['Price', 'Name'], rows: [['200', 'Coffee']] }));
    expect(result.dataset.columns.map((c) => c.name)).toEqual(['Name', 'Price']);
    expect(result.dataset.rows[2]!.cells).toEqual(['Coffee', '200']);
  });

  it('adds unknown columns and pads the existing rows', () => {
    const dataset = base();
    const snapshot = structuredClone(dataset);
    const result = appendRaw(dataset, raw({ columns: ['Name', 'Stock'], rows: [['Coffee', 'yes']] }));

    expect(result.dataset.columns.map((c) => c.name)).toEqual(['Name', 'Price', 'Stock']);
    expect(result.dataset.rows.map((r) => r.cells)).toEqual([
      ['Tea', '120', ''],
      ['চা', '১২০', ''],
      ['Coffee', '', 'yes'],
    ]);
    // Existing column ids are stable; the new one is fresh.
    expect(result.dataset.columns.slice(0, 2)).toEqual(dataset.columns);
    expect(result.dataset.columns[2]!.id).toMatch(/^c_/);
    expect(dataset).toEqual(snapshot);
    expect(isDataset(result.dataset)).toBe(true);
  });

  it('maps duplicate header names the same way on every page', () => {
    const first = datasetFromRaw(raw({ columns: ['Name', 'Name', ''], rows: [['a', 'b', 'c']] }), SOURCE);
    const result = appendRaw(first, raw({ columns: ['Name', 'Name', ''], rows: [['d', 'e', 'f']] }));
    expect(result.dataset.columns.map((c) => c.name)).toEqual(['Name', 'Name (2)', 'Column 3']);
    expect(result.dataset.rows[1]!.cells).toEqual(['d', 'e', 'f']);
  });

  it('keeps cells of ragged appended rows and reports them once', () => {
    const dataset = base();
    const page = raw({ rows: [['only-name'], ['a', 'b', 'overflow']], warnings: ['page 2 was slow'] });
    const once = appendRaw(dataset, page);
    expect(once.dataset.columns.map((c) => c.name)).toEqual(['Name', 'Price', 'Column 3']);
    expect(once.dataset.rows.slice(2).map((r) => r.cells)).toEqual([
      ['only-name', '', ''],
      ['a', 'b', 'overflow'],
    ]);
    expect(once.dataset.warnings).toContain('page 2 was slow');
    expect(once.dataset.warnings).toHaveLength(3);

    // The same warnings from a later page are not repeated.
    const twice = appendRaw(once.dataset, page);
    expect(twice.dataset.warnings).toEqual(once.dataset.warnings);
    expect(twice.dataset.rows).toHaveLength(6);
    expect(new Set(twice.dataset.rows.map((r) => r.id)).size).toBe(6);
  });

  it('continues after the highest existing id even when rows were deleted', () => {
    const dataset = base();
    const pruned: Dataset = { ...dataset, rows: [dataset.rows[1]!] };
    const result = appendRaw(pruned, raw({ rows: [['x', 'y']] }));
    expect(result.dataset.rows.map((r) => r.id)).toEqual([2, 3]);
  });

  it('appending nothing keeps the data and reports zero', () => {
    const dataset = base();
    const result = appendRaw(dataset, raw({ rows: [] }));
    expect(result.added).toBe(0);
    expect(result.dataset.rows).toEqual(dataset.rows);
  });
});

describe('rowKey', () => {
  it('is equal for equal rows and different for different rows', () => {
    expect(rowKey(['a', 'b'])).toBe(rowKey(['a', 'b']));
    expect(rowKey(['a', 'b'])).not.toBe(rowKey(['b', 'a']));
    expect(rowKey(['ab', ''])).not.toBe(rowKey(['a', 'b']));
    expect(rowKey(['', 'ab'])).not.toBe(rowKey(['a', 'b']));
    expect(rowKey(['a', ''])).not.toBe(rowKey(['a']));
    expect(rowKey(['বাংলা', '👍'])).toBe(rowKey(['বাংলা', '👍']));
  });

  it('is case- and whitespace-sensitive (exact)', () => {
    expect(rowKey(['A'])).not.toBe(rowKey(['a']));
    expect(rowKey(['a '])).not.toBe(rowKey(['a']));
  });

  it('cannot collide even when cells contain the separator characters', () => {
    const keys = new Set([
      rowKey(['a\u001fb', 'c']),
      rowKey(['a', 'b\u001fc']),
      rowKey(['a', 'b', 'c']),
      rowKey(['a\u001f', 'b', 'c']),
      rowKey(['\u001e1', 'x']),
      rowKey(['\u001f', 'x']),
      rowKey(['\u001e', '1', 'x']),
    ]);
    expect(keys.size).toBe(7);
  });
});

describe('cloneTableData / nextRowId', () => {
  const data: TableData = {
    columns: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    rows: [
      { id: 7, cells: ['1', '2'] },
      { id: 3, cells: ['3', '4'] },
    ],
  };

  it('copies every array and object', () => {
    const copy = cloneTableData(data);
    expect(copy).toEqual(data);
    expect(copy).not.toBe(data);
    expect(copy.columns).not.toBe(data.columns);
    expect(copy.columns[0]).not.toBe(data.columns[0]);
    expect(copy.rows[0]).not.toBe(data.rows[0]);
    expect(copy.rows[0]!.cells).not.toBe(data.rows[0]!.cells);
    copy.rows[0]!.cells[0] = 'x';
    copy.columns[0]!.name = 'Z';
    expect(data.rows[0]!.cells[0]).toBe('1');
    expect(data.columns[0]!.name).toBe('A');
  });

  it('drops Dataset-only properties when given a Dataset', () => {
    const dataset = datasetFromRaw(raw(), SOURCE);
    expect(Object.keys(cloneTableData(dataset)).sort()).toEqual(['columns', 'rows']);
  });

  it('returns max id + 1, and 1 for no rows', () => {
    expect(nextRowId(data)).toBe(8);
    expect(nextRowId({ columns: [], rows: [] })).toBe(1);
  });
});
