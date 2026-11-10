import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function productRule(app: Page): Promise<void> {
  await app.goto(app.url().replace(/#.*/, '#/visual'));
  await app.getByTestId('use-pattern').first().click();
  await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
}

async function openPagination(app: Page): Promise<void> {
  await app.getByRole('button', { name: 'Extract multiple pages…' }).click();
  await expect(app.getByTestId('run-panel')).toBeVisible();
}

test.describe('pagination', () => {
  test('follows next links across real page loads within the page limit', async ({ connect }) => {
    const { app, target } = await connect('/products', '#/visual');
    await productRule(app);
    await openPagination(app);

    await app.getByTestId('detect-next').click();
    await expect(app.getByTestId('detect-result')).toContainText('Next ›');

    await app.getByTestId('max-pages').fill('10');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();

    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toContainText('27 records collected from 3 pages');
    // The last page has no usable next control, so the run ends on its own.
    expect(['no-next', 'next-disabled']).toContain(await summary.getAttribute('data-reason'));
    expect(new URL(target.url()).searchParams.get('page')).toBe('3');
    await expect(app.getByTestId('run-log')).toContainText('Page 3: 9 records');

    await app.getByTestId('view-run-data').click();
    await expect(app.getByTestId('row-count')).toHaveText('27 rows');
    await expect(app.getByTestId('duplicate-count')).toHaveCount(0);
  });

  test('stops at the maximum number of pages', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await productRule(app);
    await openPagination(app);
    await app.getByTestId('max-pages').fill('2');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toHaveAttribute('data-reason', 'max-pages');
    await expect(summary).toContainText('18 records collected from 2 pages');
  });

  test('stops at the maximum number of records', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await productRule(app);
    await openPagination(app);
    await app.getByTestId('max-records').fill('12');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toHaveAttribute('data-reason', 'max-records');
    await expect(summary).toContainText('12 records collected from 2 pages');
  });

  test('works on a single-page app that swaps content without navigating', async ({ connect }) => {
    const { app } = await connect('/spa', '#/selectors');
    await app.getByTestId('row-selector').fill('li.result');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(0).getByTestId('field-name').fill('Title');
    await app.getByTestId('field-row').nth(0).getByTestId('field-selector').fill('a.result-link');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(1).getByTestId('field-name').fill('URL');
    await app.getByTestId('field-row').nth(1).getByTestId('field-selector').fill('a.result-link');
    await app.getByTestId('field-row').nth(1).getByTestId('field-extract').selectOption('href');
    await expect(app.getByTestId('rule-preview')).toContainText('4 records on this page');
    await openPagination(app);
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toContainText('12 records collected from 3 pages');
    await expect(summary).toHaveAttribute('data-reason', 'next-disabled');
    await app.getByTestId('view-run-data').click();
    await expect(app.getByTestId('data-grid')).toContainText('Result 12');
  });

  test('follows page-number navigation for a table', async ({ connect }) => {
    const { app } = await connect('/numbered', '#/pagination');
    await app.getByTestId('pagination-source').selectOption('table');
    await app.getByTestId('detect-next').click();
    await expect(app.getByTestId('detect-result')).toContainText('page 1 → 2');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toContainText('15 records collected from 3 pages');
    await app.getByTestId('view-run-data').click();
    await expect(app.getByTestId('row-count')).toHaveText('15 rows');
    await expect(app.getByTestId('data-grid')).toContainText('Entry 15');
  });

  test('a custom next selector that matches nothing ends the run honestly', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await productRule(app);
    await openPagination(app);
    await app.getByTestId('next-selector').fill('a.does-not-exist');
    await app.getByTestId('delay-ms').fill('0');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toHaveAttribute('data-reason', 'no-next');
    await expect(summary).toContainText('9 records collected from 1 pages');
  });
});

test.describe('infinite scroll', () => {
  async function postRule(app: Page): Promise<void> {
    await app.getByTestId('row-selector').fill('div.post');
    await app.getByTestId('add-field').click();
    await app.getByTestId('field-row').nth(0).getByTestId('field-name').fill('Title');
    await app.getByTestId('field-row').nth(0).getByTestId('field-selector').fill('h3.post-title');
    await expect(app.getByTestId('rule-preview')).toContainText('15 records on this page');
    await openPagination(app);
    await app.getByRole('radio', { name: 'Infinite scroll' }).click();
  }

  test('collects everything until the content ends and restores the scroll position', async ({ connect }) => {
    const { app, target } = await connect('/scroll', '#/selectors');
    await postRule(app);
    await app.getByTestId('max-scrolls').fill('60');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 50_000 });
    await expect(summary).toContainText('60 records collected');
    await expect(summary).toHaveAttribute('data-reason', 'end-of-content');
    expect(await target.evaluate(() => window.scrollY)).toBe(0);
    await app.getByTestId('view-run-data').click();
    await expect(app.getByTestId('row-count')).toHaveText('60 rows');
  });

  test('respects the record limit', async ({ connect }) => {
    const { app } = await connect('/scroll', '#/selectors');
    await postRule(app);
    await app.getByTestId('max-records').fill('20');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 50_000 });
    await expect(summary).toHaveAttribute('data-reason', 'max-records');
    await expect(summary).toContainText('20 records collected');
  });

  test('respects the scroll limit', async ({ connect }) => {
    const { app } = await connect('/scroll', '#/selectors');
    await postRule(app);
    await app.getByTestId('max-scrolls').fill('2');
    await app.getByTestId('start-run').click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 50_000 });
    await expect(summary).toHaveAttribute('data-reason', 'max-scrolls');
    await expect(summary).toContainText('in 2 scrolls');
  });

  test('can be stopped from the page and keeps what was collected', async ({ connect }) => {
    const { app, target } = await connect('/scroll', '#/selectors');
    await postRule(app);
    await app.getByTestId('max-scrolls').fill('500');
    await app.getByLabel('Pause per scroll (ms)').fill('1500');
    await app.getByTestId('start-run').click();
    const stop = target.locator('[data-rowlio="hud-stop"]');
    await expect(stop).toBeVisible({ timeout: 15_000 });
    await stop.click();
    const summary = app.getByTestId('run-summary');
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toHaveAttribute('data-reason', 'cancelled');
    await expect(summary).toContainText(/\d+ records collected/);
    await expect(target.locator('[data-rowlio="hud"]')).toHaveCount(0);
  });
});
