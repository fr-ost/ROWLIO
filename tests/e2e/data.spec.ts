import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function openProducts(app: Page): Promise<void> {
  await app.getByTestId('use-pattern').first().click();
  await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
  await app.getByTestId('extract-rule').click();
  await expect(app.getByTestId('row-count')).toHaveText('9 rows');
}

function cell(app: Page, row: number, column: number) {
  return app.getByTestId('data-grid').locator(`[role="row"][aria-rowindex="${row + 1}"] [role="gridcell"]`).nth(column);
}

async function columnIndex(app: Page, name: string): Promise<number> {
  const headers = await app.getByTestId('column-header').allTextContents();
  const index = headers.findIndex((text) => text.startsWith(name));
  expect(index, `column ${name}`).toBeGreaterThanOrEqual(0);
  return index;
}

test.describe('data preview', () => {
  test('edit, undo, redo and restore the original', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await openProducts(app);
    const title = await columnIndex(app, 'Title');
    await expect(cell(app, 1, title)).toHaveText('Product 1');

    await cell(app, 1, title).dblclick();
    await app.getByTestId('cell-editor').fill('Edited name');
    await app.getByTestId('cell-editor').press('Enter');
    await expect(cell(app, 1, title)).toHaveText('Edited name');

    await app.getByTestId('undo').click();
    await expect(cell(app, 1, title)).toHaveText('Product 1');
    await app.getByTestId('redo').click();
    await expect(cell(app, 1, title)).toHaveText('Edited name');

    await app.getByTestId('restore-original').click();
    await app.getByRole('button', { name: 'Restore original' }).click();
    await expect(cell(app, 1, title)).toHaveText('Product 1');
    // Restoring is itself undoable.
    await app.getByTestId('undo').click();
    await expect(cell(app, 1, title)).toHaveText('Edited name');
  });

  test('sort, search and filter change the view without changing the data', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await openProducts(app);
    const title = await columnIndex(app, 'Title');
    const price = await columnIndex(app, 'Price');

    // Sort by price descending: click the header twice.
    const priceHeader = app.getByTestId('column-header').nth(price).getByRole('button').first();
    await priceHeader.click();
    await expect(cell(app, 1, price)).toHaveText('$12.50');
    await priceHeader.click();
    await expect(cell(app, 1, price)).toHaveText('$36.50');

    await app.getByTestId('grid-search').fill('premium tea');
    await expect(app.getByTestId('row-count')).toHaveText('1 of 9 rows');
    await expect(cell(app, 1, title)).toContainText('চা পাতা');
    await app.getByTestId('grid-search').fill('');
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');

    // Column filter: availability equals "Out of stock".
    await app.getByTestId('add-filter').click();
    await app.getByLabel('Column', { exact: true }).selectOption({ label: 'Availability' });
    await app.getByTestId('filter-condition').selectOption('equals');
    await app.getByTestId('filter-value').fill('out of stock');
    await app.getByTestId('filter-apply').click();
    await expect(app.getByTestId('row-count')).toHaveText('1 of 9 rows');
    await expect(app.getByTestId('filter-chip')).toContainText('Availability');
    await app.getByRole('button', { name: 'Clear search and filters' }).click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');

    // Empty-value filter from the column menu.
    const rating = await columnIndex(app, 'Rating');
    await app.getByTestId('column-menu').nth(rating).click();
    await app.getByRole('menuitem', { name: 'Show only empty cells' }).click();
    await expect(app.getByTestId('row-count')).toHaveText('2 of 9 rows');
  });

  test('cleaning: find & replace, extract numbers, split, case, remove rows and columns', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await openProducts(app);
    const columnsBefore = await app.getByTestId('column-header').count();

    // Find & replace in all columns.
    await app.getByTestId('clean-menu').click();
    await app.getByRole('menuitem', { name: 'Find and replace…' }).click();
    await app.getByTestId('find-input').fill('In stock');
    await app.getByTestId('replace-input').fill('Available');
    await app.getByTestId('find-replace-apply').click();
    // Eight of the nine products on this page are in stock.
    await expect(app.getByTestId('toasts')).toContainText('8 cells');
    const availability = await columnIndex(app, 'Availability');
    await expect(cell(app, 1, availability)).toHaveText('Available');

    // Extract numbers from the price into a new column.
    const price = await columnIndex(app, 'Price');
    await app.getByTestId('column-menu').nth(price).click();
    await app.getByRole('menuitem', { name: 'Extract numbers into a new column' }).click();
    await expect(app.getByTestId('column-header')).toHaveCount(columnsBefore + 1);
    await expect(cell(app, 1, price + 1)).toHaveText('12.50');

    // Split "Product 1" on the space.
    const title = await columnIndex(app, 'Title');
    await app.getByTestId('column-menu').nth(title).click();
    await app.getByRole('menuitem', { name: 'Split into columns…' }).click();
    await app.getByTestId('split-delimiter').fill(' ');
    await app.getByTestId('split-apply').click();
    await expect(app.getByTestId('column-header').filter({ hasText: 'Title 1' })).toHaveCount(1);

    // Upper-case one column.
    const availabilityNow = await columnIndex(app, 'Availability');
    await app.getByTestId('column-menu').nth(availabilityNow).click();
    await app.getByRole('menuitem', { name: 'UPPERCASE' }).click();
    await expect(cell(app, 1, availabilityNow)).toHaveText('AVAILABLE');

    // Remove two selected rows.
    await app.getByLabel('Select row 1', { exact: true }).click();
    await app.getByLabel('Select row 2', { exact: true }).click();
    await app.getByTestId('remove-rows').click();
    await expect(app.getByTestId('row-count')).toHaveText('7 rows');

    // Remove a selected column.
    const count = await app.getByTestId('column-header').count();
    await app.getByLabel('Select column Description').check();
    await app.getByTestId('remove-columns').click();
    await expect(app.getByTestId('column-header')).toHaveCount(count - 1);

    // Everything above is undoable step by step.
    await app.getByTestId('undo').click();
    await expect(app.getByTestId('column-header')).toHaveCount(count);
    await app.getByTestId('undo').click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');
  });

  test('duplicate detection and removal', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    await app.getByTestId('card-images').getByLabel('Skip duplicate URLs').uncheck();
    await app.getByTestId('extract-images').click();
    await expect(app.getByTestId('row-count')).toHaveText('5 rows');
    // Remove the columns that differ, so two rows become identical.
    for (const name of ['Alt text', 'Title', 'Loading', 'Width', 'Height']) {
      await app.getByLabel(`Select column ${name}`).check();
    }
    await app.getByTestId('remove-columns').click();
    await expect(app.getByTestId('duplicate-count')).toContainText('1 duplicate rows');
    await app.getByTestId('duplicate-count').getByRole('button', { name: 'Remove' }).click();
    await expect(app.getByTestId('row-count')).toHaveText('4 rows');
    await expect(app.getByTestId('status-bar')).toContainText('No duplicate rows');
  });

  test('rename and reorder columns, keyboard navigation', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await openProducts(app);
    const title = await columnIndex(app, 'Title');
    await app.getByTestId('column-menu').nth(title).click();
    await app.getByRole('menuitem', { name: 'Rename…' }).click();
    await app.getByTestId('rename-input').fill('Product name');
    await app.getByTestId('rename-confirm').click();
    await expect(app.getByTestId('column-header').nth(title)).toContainText('Product name');

    await app.getByTestId('column-menu').nth(title).click();
    await app.getByRole('menuitem', { name: 'Move left' }).click();
    await expect(app.getByTestId('column-header').nth(title - 1)).toContainText('Product name');

    // Keyboard: focus the grid, move with arrows, edit with Enter.
    await cell(app, 1, 0).click();
    await app.keyboard.press('ArrowDown');
    await app.keyboard.press('ArrowRight');
    await app.keyboard.press('Enter');
    const editor = app.getByTestId('cell-editor');
    await expect(editor).toBeVisible();
    await editor.fill('typed with keyboard');
    await editor.press('Enter');
    await expect(cell(app, 2, 1)).toHaveText('typed with keyboard');
  });
});
