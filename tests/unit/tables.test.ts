import { beforeEach, describe, expect, it } from 'vitest';
import { collectTables, countDataTables, extractTable, extractTables, listTables, tablesFingerprint } from '@/extraction/tables';
import { DEFAULT_TABLE_OPTIONS, type TableOptions } from '@/types';
import { CancelledError, Pacer } from '@/utils/async';
import { setPage } from './helpers';

const opts = (patch: Partial<TableOptions> = {}): TableOptions => ({ ...DEFAULT_TABLE_OPTIONS, ...patch });

async function first(html: string, options: TableOptions = opts()) {
  setPage(html);
  const [dataset] = await extractTables(document, [0], options);
  return dataset;
}

describe('table extraction', () => {
  beforeEach(() => setPage(''));

  it('extracts a simple table with thead and preserves empty cells', async () => {
    const dataset = await first(`
      <table>
        <thead><tr><th>Name</th><th>Age</th><th>City</th></tr></thead>
        <tbody>
          <tr><td>Ada</td><td></td><td>London</td></tr>
          <tr><td></td><td>41</td><td></td></tr>
        </tbody>
      </table>`);
    expect(dataset.columns).toEqual(['Name', 'Age', 'City']);
    expect(dataset.rows).toEqual([
      ['Ada', '', 'London'],
      ['', '41', ''],
    ]);
    expect(dataset.warnings).toEqual([]);
    expect(dataset.method).toBe('table');
  });

  it('uses leading all-<th> rows as the header when there is no thead', async () => {
    const dataset = await first('<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>');
    expect(dataset.columns).toEqual(['A', 'B']);
    expect(dataset.rows).toEqual([['1', '2']]);
  });

  it('generates column names when there is no header, and never drops the first row', async () => {
    const dataset = await first('<table><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>');
    expect(dataset.columns).toEqual(['Column 1', 'Column 2']);
    expect(dataset.rows).toHaveLength(2);
  });

  it('honours the header mode option', async () => {
    const html = '<table><tr><td>h1</td><td>h2</td></tr><tr><td>1</td><td>2</td></tr></table>';
    expect((await first(html, opts({ headerMode: 'first-row' }))).columns).toEqual(['h1', 'h2']);
    const none = await first('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>', opts({ headerMode: 'none' }));
    expect(none.columns).toEqual(['Column 1']);
    expect(none.rows).toEqual([['A'], ['1']]);
  });

  it('expands rowspan and colspan so every row is complete', async () => {
    const dataset = await first(`
      <table>
        <tr><th>Region</th><th>Q1</th><th>Q2</th></tr>
        <tr><td rowspan="2">Asia</td><td>1</td><td>2</td></tr>
        <tr><td>3</td><td>4</td></tr>
        <tr><td>Europe</td><td colspan="2">combined</td></tr>
      </table>`);
    expect(dataset.rows).toEqual([
      ['Asia', '1', '2'],
      ['Asia', '3', '4'],
      ['Europe', 'combined', 'combined'],
    ]);
  });

  it('leaves merged continuations empty when fillMerged is off', async () => {
    const dataset = await first(
      '<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td rowspan="2">x</td><td colspan="2">y</td></tr><tr><td>1</td><td>2</td></tr></table>',
      opts({ fillMerged: false }),
    );
    expect(dataset.rows).toEqual([
      ['x', 'y', ''],
      ['', '1', '2'],
    ]);
  });

  it('merges multi-row headers and repeats grouped header names', async () => {
    const dataset = await first(`
      <table>
        <thead>
          <tr><th rowspan="2">Region</th><th colspan="2">2023</th><th colspan="2">2024</th></tr>
          <tr><th>H1</th><th>H2</th><th>H1</th><th>H2</th></tr>
        </thead>
        <tbody><tr><td>Asia</td><td>1</td><td>2</td><td>3</td><td>4</td></tr></tbody>
      </table>`);
    expect(dataset.columns).toEqual(['Region', '2023 - H1', '2023 - H2', '2024 - H1', '2024 - H2']);
  });

  it('keeps grouped headers intact even when fillMerged is off', async () => {
    const dataset = await first(
      '<table><thead><tr><th colspan="2">Sales</th></tr><tr><th>Q1</th><th>Q2</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
      opts({ fillMerged: false }),
    );
    expect(dataset.columns).toEqual(['Sales - Q1', 'Sales - Q2']);
  });

  it('treats rowspan="0" as "to the end of the row group"', async () => {
    const dataset = await first('<table><tbody><tr><td rowspan="0">all</td><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr></tbody></table>', opts({ headerMode: 'none' }));
    expect(dataset.rows).toEqual([
      ['all', '1'],
      ['all', '2'],
      ['all', '3'],
    ]);
  });

  it('never lets a rowspan leak from the header into the body', async () => {
    const dataset = await first('<table><thead><tr><th rowspan="5">A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    expect(dataset.rows).toEqual([['1', '2']]);
  });

  it('pads ragged rows and says so', async () => {
    const dataset = await first('<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>');
    expect(dataset.rows).toEqual([
      ['1', '', ''],
      ['1', '2', '3'],
    ]);
    expect(dataset.warnings.join(' ')).toMatch(/fewer cells/);
  });

  it('makes duplicate and empty header names unique', async () => {
    const dataset = await first('<table><tr><th>Price</th><th></th><th>Price</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>');
    expect(dataset.columns).toEqual(['Price', 'Column 2', 'Price (2)']);
  });

  it('skips hidden rows and columns by default, reports them, and includes them on request', async () => {
    const html = `
      <style>.gone { display: none }</style>
      <table>
        <tr><th>A</th><th style="display:none">Secret</th><th>C</th></tr>
        <tr><td>1</td><td style="display:none">s1</td><td>3</td></tr>
        <tr class="gone"><td>hidden row</td><td style="display:none">s2</td><td>x</td></tr>
        <tr hidden><td>also hidden</td><td style="display:none">s3</td><td>y</td></tr>
      </table>`;
    const visible = await first(html);
    expect(visible.columns).toEqual(['A', 'C']);
    expect(visible.rows).toEqual([['1', '3']]);
    expect(visible.warnings.join(' ')).toMatch(/2 hidden row\(s\)/);
    expect(visible.warnings.join(' ')).toMatch(/1 hidden column\(s\)/);

    const all = await first(html, opts({ includeHidden: true }));
    expect(all.columns).toEqual(['A', 'Secret', 'C']);
    expect(all.rows).toHaveLength(3);
    expect(all.rows[1]).toEqual(['hidden row', 's2', 'x']);
    expect(all.warnings).toEqual([]);
  });

  it('skips hidden inline content inside cells unless asked', async () => {
    const html = '<table><tr><th>N</th></tr><tr><td><span style="display:none">0042</span>42</td></tr></table>';
    expect((await first(html)).rows).toEqual([['42']]);
    expect((await first(html, opts({ includeHidden: true }))).rows).toEqual([['004242']]);
  });

  it('flattens nested tables into the cell, lists them separately and warns', async () => {
    setPage(`
      <table id="outer">
        <tr><th>Team</th><th>Members</th></tr>
        <tr><td>Core</td><td><table id="inner"><tr><th>Name</th><th>Role</th></tr><tr><td>Ada</td><td>Lead</td></tr></table></td></tr>
      </table>`);
    const datasets = await extractTables(document, 'all', opts());
    expect(datasets).toHaveLength(2);
    expect(datasets[0].rows).toEqual([['Core', 'Name | Role\nAda | Lead']]);
    expect(datasets[0].warnings.join(' ')).toMatch(/nested table/);
    // The inner table's rows are not mixed into the outer one.
    expect(datasets[1].columns).toEqual(['Name', 'Role']);
    expect(datasets[1].rows).toEqual([['Ada', 'Lead']]);

    const summaries = await listTables(document, opts(), 5);
    expect(summaries[0].hasNested).toBe(true);
    expect(summaries[1].nestedIn).toBe(0);
  });

  it('names tables from caption, aria-label, aria-labelledby or a preceding heading', async () => {
    setPage(`
      <table><caption> Prices   2024 </caption><tr><td>1</td></tr></table>
      <table aria-label="Stock levels"><tr><td>1</td></tr></table>
      <p id="lbl">Labelled by</p><table aria-labelledby="lbl"><tr><td>1</td></tr></table>
      <h3>Team members</h3><table><tr><td>1</td></tr></table>
      <p>para</p><table><tr><td>1</td></tr></table>`);
    const names = (await extractTables(document, 'all', opts())).map((dataset) => dataset.name);
    expect(names).toEqual(['Prices 2024', 'Stock levels', 'Labelled by', 'Team members', 'Table 5']);
  });

  it('preserves Unicode, Bengali, emoji, line breaks and form values', async () => {
    const dataset = await first(`
      <table>
        <tr><th>নাম</th><th>মন্তব্য</th><th>Input</th></tr>
        <tr><td>রহিম উদ্দিন</td><td>প্রথম লাইন<br>দ্বিতীয় লাইন 😀</td><td><input value="typed"><select><option>a</option><option selected>b</option></select></td></tr>
        <tr><td>Zoë&nbsp;&amp;&nbsp;Co</td><td><p>one</p><p>two</p></td><td><input type="checkbox" checked></td></tr>
      </table>`);
    expect(dataset.columns).toEqual(['নাম', 'মন্তব্য', 'Input']);
    expect(dataset.rows[0]).toEqual(['রহিম উদ্দিন', 'প্রথম লাইন\nদ্বিতীয় লাইন 😀', 'typed b']);
    expect(dataset.rows[1]).toEqual(['Zoë & Co', 'one\ntwo', 'true']);
  });

  it('ignores script and style content inside cells', async () => {
    const dataset = await first('<table><tr><td>ok<script>var x = 1;</script><style>td{}</style></td></tr></table>', opts({ headerMode: 'none' }));
    expect(dataset.rows).toEqual([['ok']]);
  });

  it('extracts ARIA grids built from divs', async () => {
    setPage(`
      <div role="grid" aria-label="Orders">
        <div role="row"><span role="columnheader">ID</span><span role="columnheader">Total</span></div>
        <div role="rowgroup">
          <div role="row"><span role="gridcell">7</span><span role="gridcell">$10</span></div>
          <div role="row"><span role="gridcell">8</span><span role="gridcell">$12</span></div>
        </div>
      </div>`);
    const [dataset] = await extractTables(document, 'all', opts());
    expect(dataset.name).toBe('Orders');
    expect(dataset.columns).toEqual(['ID', 'Total']);
    expect(dataset.rows).toEqual([
      ['7', '$10'],
      ['8', '$12'],
    ]);
    expect((await listTables(document, opts(), 5))[0].kind).toBe('aria-grid');
  });

  it('finds tables inside open shadow roots', async () => {
    setPage('<div id="host"></div>');
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<table><tr><th>S</th></tr><tr><td>in shadow</td></tr></table>';
    const handles = collectTables(document);
    expect(handles).toHaveLength(1);
    expect(handles[0].location).toBe('shadow-dom');
    expect((await extractTables(document, 'all', opts()))[0].rows).toEqual([['in shadow']]);
  });

  it('reports a table that disappeared instead of silently returning nothing', async () => {
    setPage('<table><tr><td>1</td></tr></table>');
    const [dataset] = await extractTables(document, [3], opts());
    expect(dataset.rows).toEqual([]);
    expect(dataset.warnings[0]).toMatch(/no longer on the page/);
  });

  it('summarises tables for the list view', async () => {
    setPage(`
      <table><caption>Data</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody>${'<tr><td>1</td><td>2</td></tr>'.repeat(12)}</tbody></table>
      <table role="presentation"><tr><td>layout</td></tr></table>`);
    const [data, layout] = await listTables(document, opts(), 5);
    expect(data).toMatchObject({ index: 0, caption: 'Data', rowCount: 12, rowCountExact: true, columnCount: 2, isDataTable: true, kind: 'table', nestedIn: -1 });
    expect(data.preview).toHaveLength(5);
    expect(layout.isDataTable).toBe(false);
    expect(countDataTables(document)).toEqual({ data: 1, all: 2 });
  });

  it('fingerprint changes when rows are added (dynamic tables)', () => {
    setPage('<table id="t"><tr><td>1</td></tr></table>');
    const before = tablesFingerprint(document);
    document.querySelector('#t')!.insertAdjacentHTML('beforeend', '<tr><td>2</td></tr>');
    expect(tablesFingerprint(document)).not.toBe(before);
    document.body.insertAdjacentHTML('beforeend', '<table><tr><td>new</td></tr></table>');
    expect(tablesFingerprint(document).split(',')).toHaveLength(2);
  });

  it('handles a large table completely and can be cancelled', async () => {
    const rows = Array.from({ length: 6000 }, (_, i) => `<tr><td>${i}</td><td>name ${i}</td><td>ঢাকা</td></tr>`).join('');
    setPage(`<table><thead><tr><th>ID</th><th>Name</th><th>City</th></tr></thead><tbody>${rows}</tbody></table>`);
    const [handle] = collectTables(document);
    const table = await extractTable(handle, opts({ includeHidden: true }), new Pacer());
    expect(table.rows).toHaveLength(6000);
    expect(table.rows[5999]).toEqual(['5999', 'name 5999', 'ঢাকা']);

    const controller = new AbortController();
    controller.abort();
    await expect(extractTable(handle, opts({ includeHidden: true }), new Pacer(controller.signal, -1))).rejects.toBeInstanceOf(CancelledError);
  });
});
