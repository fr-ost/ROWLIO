import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from './fixtures';

test.describe('table extraction', () => {
  test('lists tables with previews, warnings and dynamic tables', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    const cards = app.getByTestId('table-card');
    // revenue, bengali, nested (outer), nested (inner), scrolling, + the late table.
    await expect(cards).toHaveCount(6, { timeout: 15_000 });
    await expect(app.getByTestId('table-name').first()).toHaveText('Quarterly revenue by region');
    await expect(cards.first()).toContainText('2023 - H1');
    await expect(cards.first()).toContainText('hidden row');
    await expect(app.getByText('Live prices')).toBeVisible();
    await expect(app.getByText('Contains nested tables')).toBeVisible();
    await expect(app.getByText('Scrollable container')).toBeVisible();
    // The layout table is hidden by default but not silently dropped.
    await expect(app.getByText('Show layout / tiny tables (1)')).toBeVisible();
  });

  test('extracts a table with merged cells into the data preview', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    await app.getByTestId('extract-table').first().click();
    await expect(app.getByTestId('data-page')).toBeVisible();
    await expect(app.getByTestId('row-count')).toHaveText('4 rows');
    await expect(app.getByTestId('column-count')).toHaveText('5 columns');
    const headers = app.getByTestId('column-header');
    await expect(headers).toHaveText([/Region/, /2023 - H1/, /2023 - H2/, /2024 - H1/, /2024 - H2/]);
    const grid = app.getByTestId('data-grid');
    // rowspan: "Asia" is repeated on the second row; colspan: the combined value fills both cells.
    await expect(grid.locator('[role="row"][aria-rowindex="3"] [role="gridcell"]').first()).toHaveText('Asia');
    await expect(grid.locator('[role="row"][aria-rowindex="4"] [role="gridcell"]').nth(2)).toHaveText('2,400 (combined)');
    await expect(app.getByTestId('dataset-warnings')).toContainText('hidden row');
  });

  test('includes hidden rows when asked', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    await app.getByLabel('Include hidden rows and columns').check();
    await expect(app.getByTestId('table-card').first()).toContainText('5 rows');
    await app.getByTestId('extract-table').first().click();
    await expect(app.getByTestId('row-count')).toHaveText('5 rows');
    await expect(app.getByTestId('data-grid')).toContainText('Internal');
  });

  test('extract all opens every data table as its own dataset', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    await expect(app.getByTestId('table-card')).toHaveCount(6, { timeout: 15_000 });
    await app.getByTestId('extract-all-tables').click();
    await expect(app.getByTestId('dataset-tab')).toHaveCount(6);
  });

  test('Bengali, emoji and formula-like text survive CSV and XLSX export', async ({ connect }) => {
    const { app } = await connect('/tables', '#/tables');
    await app.getByTestId('extract-table').nth(1).click();
    await expect(app.getByTestId('row-count')).toHaveText('3 rows');
    await expect(app.getByTestId('data-grid')).toContainText('রহিম উদ্দিন');

    // CSV
    await app.getByTestId('open-export').click();
    await app.getByTestId('export-format').selectOption('csv');
    const csvDownload = app.waitForEvent('download');
    await app.getByTestId('export-confirm').click();
    const csvFile = await csvDownload;
    expect(csvFile.suggestedFilename()).toMatch(/^rowlio-.*\.csv$/);
    const bytes = fs.readFileSync(await csvFile.path());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const csv = bytes.toString('utf8');
    expect(csv).toContain('নাম,শহর,মন্তব্য');
    expect(csv).toContain('রহিম উদ্দিন,ঢাকা,"""সেরা"", দ্রুত ডেলিভারি"');
    expect(csv).toContain("করিম,চট্টগ্রাম,'=SUM(A1:A2)"); // formula neutralised
    expect(csv).toContain('Zoë 😀,সিলেট,"line one\nline two"');

    // XLSX
    await app.getByTestId('open-export').click();
    await app.getByTestId('export-format').selectOption('xlsx');
    const xlsxDownload = app.waitForEvent('download');
    await app.getByTestId('export-confirm').click();
    const xlsxFile = await xlsxDownload;
    expect(xlsxFile.suggestedFilename()).toMatch(/\.xlsx$/);
    const zip = unzipSync(new Uint8Array(fs.readFileSync(await xlsxFile.path())));
    const sheet = strFromU8(zip['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('রহিম উদ্দিন');
    expect(sheet).toContain('😀');
    expect(sheet).toContain('=SUM(A1:A2)');
    expect(sheet).not.toContain('<f>'); // never written as a formula
  });

  test('copies rows to the clipboard as TSV', async ({ connect, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const { app } = await connect('/tables', '#/tables');
    await app.getByTestId('extract-table').nth(1).click();
    await app.getByTestId('copy-menu').click();
    await app.getByRole('menuitem', { name: 'Copy for spreadsheets (TSV)' }).click();
    await expect(app.getByTestId('toasts')).toContainText('Copied 3 rows');
    const text = await app.evaluate(() => navigator.clipboard.readText());
    expect(text.split('\n')[0]).toBe('নাম\tশহর\tমন্তব্য');
    expect(text).toContain('রহিম উদ্দিন\tঢাকা');
  });

  test('handles a 20,000 row table without losing rows', async ({ connect }) => {
    test.setTimeout(120_000);
    const { app } = await connect('/big-table?rows=20000', '#/tables');
    await expect(app.getByTestId('table-card').first()).toContainText('20,000 rows', { timeout: 30_000 });
    await app.getByTestId('extract-table').first().click();
    await expect(app.getByTestId('row-count')).toHaveText('20,000 rows', { timeout: 60_000 });
    // Virtualised: only a screenful of rows is in the DOM.
    const rendered = await app.getByTestId('data-grid').locator('[role="row"]').count();
    expect(rendered).toBeLessThan(120);
    // Search across all rows.
    await app.getByTestId('grid-search').fill('user19999@example.com');
    await expect(app.getByTestId('row-count')).toHaveText('1 of 20,000 rows');
    // Export everything and count the lines.
    await app.getByTestId('grid-search').fill('');
    await expect(app.getByTestId('row-count')).toHaveText('20,000 rows');
    await app.getByTestId('open-export').click();
    await app.getByTestId('export-format').selectOption('jsonl');
    const download = app.waitForEvent('download');
    await app.getByTestId('export-confirm').click();
    const lines = fs.readFileSync(await (await download).path(), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(20000);
    expect(JSON.parse(lines[6])).toEqual({ ID: '7', Name: 'User 7', Email: 'user7@example.com', Amount: '10.50', City: 'ঢাকা' });
  });
});
