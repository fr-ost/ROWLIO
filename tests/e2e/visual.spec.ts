import { test, expect } from './fixtures';

test.describe('visual selector', () => {
  test('auto-detects the product list and its fields', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    const first = app.getByTestId('pattern').first();
    await expect(first).toContainText('9 items');
    await expect(first).toContainText('article.product-card');
    await first.getByTestId('use-pattern').click();

    const names = app.getByTestId('field-name');
    await expect(names.first()).toBeVisible();
    const values = await names.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    for (const expected of ['Title', 'Price', 'Image URL', 'URL', 'Rating', 'Reviews', 'Description', 'Availability', 'Product ID']) {
      expect(values, `field ${expected}`).toContain(expected);
    }
    await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
    await expect(app.getByTestId('preview-table')).toContainText('চা পাতা প্রিমিয়াম (Premium Tea)');

    await app.getByTestId('extract-rule').click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');
    const grid = app.getByTestId('data-grid');
    await expect(grid).toContainText('$12.50');
    await expect(grid).toContainText('http://127.0.0.1:4173/product/sku-1001');
    await expect(grid).toContainText('3.5 out of 5 stars');
    // Product 4 has no rating: the field is simply empty for that record.
    await expect(app.getByTestId('empty-count')).not.toHaveText('0 empty cells');
  });

  test('point-and-click: pick a record, edit fields, send to the workspace', async ({ connect }) => {
    const { app, target } = await connect('/products', '#/visual');
    await app.getByTestId('start-picker').click();
    const panel = target.locator('[data-rowlio="picker"]');
    await expect(panel).toBeVisible();

    // Clicking the price inside a card selects all nine cards, not just the price.
    await target.bringToFront();
    await target.locator('.product-card .price').first().click();
    await expect(target.locator('[data-rowlio="record-count"]')).toHaveText('9 records selected');
    // The click must not have followed any link.
    expect(new URL(target.url()).pathname).toBe('/products');

    const fields = target.locator('[data-rowlio="field"]');
    const before = await fields.count();
    expect(before).toBeGreaterThanOrEqual(6);

    // Rename the first field and remove the last one.
    await target.locator('[data-rowlio="field-name"]').first().fill('SKU');
    await target.locator('[data-rowlio="field-remove"]').last().click();
    await expect(fields).toHaveCount(before - 1);

    // Narrower / wider change the repeating block and can be reverted.
    await target.locator('[data-rowlio="wider"]').click();
    await expect(target.locator('[data-rowlio="record-count"]')).not.toHaveText('9 records selected');
    await target.locator('[data-rowlio="narrower"]').click();
    await expect(target.locator('[data-rowlio="record-count"]')).toHaveText('9 records selected');

    await target.locator('[data-rowlio="picker-done"]').click();
    await expect(panel).toHaveCount(0);

    await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
    await expect(app.getByTestId('row-selector')).toHaveValue('article.product-card');
  });

  test('adding a field by clicking and cancelling with Escape', async ({ connect }) => {
    const { app, target } = await connect('/products', '#/visual');
    await app.getByTestId('start-picker').click();
    await target.bringToFront();
    await target.locator('.product-card h3.title').first().click();
    await expect(target.locator('[data-rowlio="record-count"]')).toHaveText('9 records selected');

    // Remove every detected field, then add one manually.
    const remove = target.locator('[data-rowlio="field-remove"]');
    while ((await remove.count()) > 0) await remove.first().click();
    await target.locator('[data-rowlio="add-field"]').click();
    await target.locator('.product-card .availability').nth(2).click();
    await expect(target.locator('[data-rowlio="field"]')).toHaveCount(1);
    await expect(target.locator('[data-rowlio="field-name"]')).toHaveValue('Availability');

    await target.keyboard.press('Escape'); // leaves "add field" mode
    await target.keyboard.press('Escape'); // closes the selector
    await expect(target.locator('[data-rowlio="picker"]')).toHaveCount(0);
  });

  test('falls back to two examples when no pattern is found', async ({ connect, context }) => {
    const { app, target } = await connect('/content', '#/visual');
    void context;
    await app.getByTestId('start-picker').click();
    await target.bringToFront();
    // A heading has no similar siblings: Rowlio asks for a second example.
    await target.locator('h1#top').click();
    await expect(target.locator('[data-rowlio="picker"]')).toContainText('No repeating pattern was found');
    await target.locator('[data-rowlio="use-single"]').click();
    await expect(target.locator('[data-rowlio="record-count"]')).toHaveText('1 record selected');
    await target.locator('[data-rowlio="picker-cancel"]').click();
  });
});
