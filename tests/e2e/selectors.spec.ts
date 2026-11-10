import { test, expect } from './fixtures';

test.describe('advanced selectors', () => {
  test('tests CSS and XPath selectors with counts, samples and errors', async ({ connect }) => {
    const { app } = await connect('/products', '#/selectors');
    const input = app.getByTestId('tester-input');

    await input.fill('article.product-card h3.title');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-count')).toHaveText('9 matches');
    await expect(app.getByTestId('tester-sample').first()).toContainText('Product 1');

    // Invalid CSS is reported, not silently ignored.
    await input.fill('article..broken[');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-error')).toContainText('Invalid CSS selector');

    // XPath returning attribute nodes.
    await app.getByTestId('tester-type').selectOption('xpath');
    await input.fill('//article[@class="product-card"]//h3/a/@href');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-count')).toHaveText('9 matches');
    await expect(app.getByTestId('tester-sample').first()).toContainText('/product/sku-1001');

    // XPath returning a scalar.
    await input.fill('count(//article)');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-scalar')).toHaveText('9');

    // Invalid XPath.
    await input.fill('//article[');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-error')).toContainText('Invalid XPath');

    // Valid but empty.
    await input.fill('//nonexistent');
    await app.getByTestId('tester-run').click();
    await expect(app.getByTestId('tester-count')).toHaveText('0 matches');
    await expect(app.getByTestId('tester-result')).toContainText('matches nothing on this page');
  });

  test('builds a multi-field rule mixing CSS and XPath and extracts it', async ({ connect }) => {
    const { app } = await connect('/products', '#/selectors');
    await app.getByTestId('row-selector').fill('article.product-card');
    await expect(app.getByTestId('row-match')).toContainText('9 matches');

    // Field 1: CSS text.
    await app.getByTestId('add-field').click();
    let row = app.getByTestId('field-row').nth(0);
    await row.getByTestId('field-name').fill('Name');
    await row.getByTestId('field-selector').fill('h3.title');
    await expect(row.getByTestId('field-sample')).toContainText('Product 1');

    // Field 2: link URL.
    await app.getByTestId('add-field').click();
    row = app.getByTestId('field-row').nth(1);
    await row.getByTestId('field-name').fill('Link');
    await row.getByTestId('field-selector').fill('h3.title a');
    await row.getByTestId('field-extract').selectOption('href');

    // Field 3: XPath with an attribute.
    await app.getByTestId('add-field').click();
    row = app.getByTestId('field-row').nth(2);
    await row.getByTestId('field-name').fill('Stars');
    await row.getByLabel('Selector type').selectOption('xpath');
    await row.getByTestId('field-selector').fill('.//div[@class="rating"]/@aria-label');
    // Seven of the nine products have a rating.
    await expect(row).toContainText('7 of 9 rows');

    // Field 4: attribute of the row itself (empty selector).
    await app.getByTestId('add-field').click();
    row = app.getByTestId('field-row').nth(3);
    await row.getByTestId('field-name').fill('SKU');
    await row.getByTestId('field-extract').selectOption('attr');
    await row.getByTestId('field-attribute').fill('data-product-id');

    // Field 5: image source.
    await app.getByTestId('add-field').click();
    row = app.getByTestId('field-row').nth(4);
    await row.getByTestId('field-name').fill('Image');
    await row.getByTestId('field-selector').fill('img');
    await row.getByTestId('field-extract').selectOption('src');

    await expect(app.getByTestId('preview-table')).toContainText('sku-1001');
    await app.getByTestId('extract-rule').click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');
    await expect(app.getByTestId('column-header')).toHaveText([/Name/, /Link/, /Stars/, /SKU/, /Image/]);
    const firstRow = app.getByTestId('data-grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]');
    await expect(firstRow).toHaveText(['Product 1', 'http://127.0.0.1:4173/product/sku-1001', '3.5 out of 5 stars', 'sku-1001', 'http://127.0.0.1:4173/img/sku-1001.png']);
  });

  test('column mode warns when fields match different numbers of elements', async ({ connect }) => {
    const { app } = await connect('/products', '#/selectors');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(0).getByTestId('field-selector').fill('.product-card h3.title');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(1).getByTestId('field-selector').fill('.product-card .rating');
    await expect(app.getByTestId('rule-preview')).toContainText('matched different numbers of elements');
  });

  test('reports an invalid field selector instead of extracting', async ({ connect }) => {
    const { app } = await connect('/products', '#/selectors');
    await app.getByTestId('row-selector').fill('article.product-card');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(0).getByTestId('field-selector').fill('h3[');
    await expect(app.getByTestId('field-error')).toContainText('Invalid CSS selector');
    await expect(app.getByTestId('extract-rule')).toBeDisabled();
  });
});
