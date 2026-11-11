// Regenerates the screenshots used in the README and the Chrome Web Store listing
// (1280×800, taken against the local fixture site). Skipped in normal test runs:
//   npm run screenshots
import path from 'node:path';
import { test, expect } from './fixtures';

const OUT = path.resolve(import.meta.dirname, '..', '..', 'docs', 'screenshots');

test('capture screenshots', async ({ connect, context, extensionId, serviceWorker }) => {
  test.skip(!process.env.ROWLIO_SCREENSHOTS, 'run with `npm run screenshots`');
  test.setTimeout(120_000);
  const size = { width: 1280, height: 800 };

  // 1. Tables
  const tables = await connect('/tables', '#/tables');
  await tables.app.setViewportSize(size);
  await expect(tables.app.getByTestId('table-card')).toHaveCount(6, { timeout: 15_000 });
  await tables.app.screenshot({ path: path.join(OUT, '01-tables.png') });

  // 2. Visual selector on the page
  const shop = await connect('/products', '#/');
  await shop.app.setViewportSize(size);
  await expect(shop.app.getByTestId('home-hero')).toBeVisible();
  await shop.app.waitForTimeout(1400); // let the counters finish
  await shop.app.screenshot({ path: path.join(OUT, '00-home.png') });
  await shop.app.goto(shop.app.url().replace(/#.*/, '#/visual'));
  await shop.target.setViewportSize(size);
  await shop.app.getByTestId('start-picker').click();
  await shop.target.bringToFront();
  await shop.target.locator('.product-card .price').first().click();
  await expect(shop.target.locator('[data-rowlio="record-count"]')).toBeVisible();
  await shop.target.mouse.move(640, 700);
  await shop.target.screenshot({ path: path.join(OUT, '02-visual-selector.png') });
  await shop.target.locator('[data-rowlio="picker-done"]').click();

  // 3. Rule preview, 4. Data preview
  await shop.app.bringToFront();
  await expect(shop.app.getByTestId('preview-table')).toBeVisible();
  await shop.app.screenshot({ path: path.join(OUT, '03-fields-and-preview.png') });
  await shop.app.getByTestId('extract-rule').click();
  await expect(shop.app.getByTestId('row-count')).toHaveText('9 rows');
  await expect(shop.app.getByTestId('toasts').locator('[role="status"]')).toHaveCount(0, { timeout: 15_000 });
  await shop.app.screenshot({ path: path.join(OUT, '04-data-preview.png') });

  // 5. Export dialog
  await shop.app.getByTestId('open-export').click();
  await shop.app.screenshot({ path: path.join(OUT, '05-export.png') });
  await shop.app.keyboard.press('Escape');

  // 6. Pagination
  await shop.app.goto(shop.app.url().replace(/#.*/, '#/pagination'));
  await expect(shop.app.getByTestId('run-panel')).toBeVisible();
  await shop.app.waitForTimeout(300);
  await shop.app.screenshot({ path: path.join(OUT, '06-pagination.png') });

  // 7. Popup
  const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id ?? -1, tables.target.url());
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 352, height: 440 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByTestId('popup')).toHaveAttribute('data-phase', 'ready');
  await popup.waitForTimeout(1000);
  await popup.screenshot({ path: path.join(OUT, '07-popup.png') });
});
