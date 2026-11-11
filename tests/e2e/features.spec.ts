import fs from 'node:fs';
import { test, expect, settingsSaved, SITE } from './fixtures';
import type { Page } from '@playwright/test';

async function products(app: Page): Promise<void> {
  await app.getByTestId('use-pattern').first().click();
  await expect(app.getByTestId('rule-preview')).toContainText('9 records on this page');
}

async function columnIndex(app: Page, name: string): Promise<number> {
  const headers = await app.getByTestId('column-header').allTextContents();
  const index = headers.findIndex((text) => text.startsWith(name));
  expect(index, `column ${name}`).toBeGreaterThanOrEqual(0);
  return index;
}

test.describe('batch URLs', () => {
  test('runs one extraction over a list of pages and records the source of every row', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await products(app);
    await app.goto(app.url().replace(/#.*/, '#/batch'));
    await expect(app.getByTestId('batch-source')).toHaveValue('rule');
    const other = `${SITE.replace('127.0.0.1', '127.0.0.2')}/products`;
    await app.getByTestId('batch-urls').fill([`${SITE}/products?page=1`, other, 'not a url', `${SITE}/products?page=2`, `${SITE}/products?page=3`, `${SITE}/products?page=2`].join('\n'));
    await expect(app.getByTestId('batch-count')).toContainText('4 addresses');
    await expect(app.getByTestId('batch-count')).toContainText('1 duplicates ignored');
    await expect(app.getByTestId('batch-count')).toContainText('1 lines are not web addresses');
    await app.getByTestId('batch-delay').fill('0');
    await app.getByTestId('batch-start').click();

    const summary = app.getByTestId('batch-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toContainText('27 records from 3 of 4 pages');
    await expect(summary).toContainText('1 pages failed');
    // The page on another site is skipped with a reason; the run carries on.
    await expect(app.getByTestId('batch-log')).toContainText('has no access to 127.0.0.2');

    await app.getByTestId('batch-view-data').click();
    await expect(app.getByTestId('row-count')).toHaveText('27 rows');
    await expect(app.getByTestId('column-header').first()).toContainText('Source URL');
    await expect(app.getByTestId('data-grid')).toContainText(`${SITE}/products?page=1`);
  });

  test('takes addresses from a URL column of extracted data and respects the page limit', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await products(app);
    await app.getByTestId('extract-rule').click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');
    await app.goto(app.url().replace(/#.*/, '#/batch'));
    await app.getByTestId('batch-column').selectOption({ label: 'Extracted records → URL' });
    await app.getByTestId('batch-use-column').click();
    await expect(app.getByTestId('batch-count')).toContainText('9 addresses');

    await app.getByTestId('batch-source').selectOption('metadata');
    await app.getByTestId('batch-max').fill('2');
    await app.getByTestId('batch-delay').fill('0');
    await expect(app.getByTestId('batch-start')).toHaveText(/Visit 2 pages/);
    await app.getByTestId('batch-start').click();
    const summary = app.getByTestId('batch-summary');
    await expect(summary).toBeVisible({ timeout: 45_000 });
    await expect(summary).toHaveAttribute('data-reason', 'max-pages');
    await expect(summary).toContainText('from 2 of 2 pages');
  });
});

test.describe('import, contacts and new data tools', () => {
  test('imports a CSV file into the data preview', async ({ connect }) => {
    const { app } = await connect('/tables', '#/data');
    await app.getByTestId('import-file-input').setInputFiles({
      name: 'দাম তালিকা.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('﻿নাম;Price;Note\r\n"রহিম; উদ্দিন";10;"a\nb"\r\nZoë;20;\r\n', 'utf8'),
    });
    await expect(app.getByTestId('toasts')).toContainText('Imported 2 rows');
    await expect(app.getByTestId('row-count')).toHaveText('2 rows');
    await expect(app.getByTestId('column-header')).toHaveText([/নাম/, /Price/, /Note/]);
    await expect(app.getByTestId('data-grid')).toContainText('রহিম; উদ্দিন');
    await expect(app.getByTestId('dataset-tab')).toContainText('দাম তালিকা');

    // A broken file is refused with an explanation.
    await app.getByTestId('import-file-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{oops') });
    await expect(app.getByTestId('toasts')).toContainText('not valid JSON');
  });

  test('extracts emails and social links as contacts', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    const card = app.getByTestId('card-content');
    for (const label of ['Headings', 'JSON-LD structured data']) await card.getByLabel(label, { exact: true }).uncheck();
    await card.getByLabel(/^Metadata/).uncheck();
    await card.getByLabel('Emails, phone numbers and social profiles').check();
    await app.getByTestId('extract-content').click();
    await expect(app.getByTestId('dataset-tab')).toContainText('Contacts');
    await expect(app.getByTestId('data-grid')).toContainText('hi@example.com');
    await expect(app.getByTestId('data-grid')).toContainText('mailto link');
  });

  test('regex extraction, column summary, added columns and Markdown export', async ({ connect }) => {
    const { app } = await connect('/products', '#/visual');
    await products(app);
    await app.getByTestId('extract-rule').click();
    await expect(app.getByTestId('row-count')).toHaveText('9 rows');

    // Pull the number out of "(17 reviews)".
    const reviews = await columnIndex(app, 'Reviews');
    await app.getByTestId('column-menu').nth(reviews).click();
    await app.getByRole('menuitem', { name: 'Extract by pattern…' }).click();
    await app.getByTestId('regex-pattern').fill('(\\d+) reviews');
    await app.getByTestId('regex-apply').click();
    await expect(app.getByTestId('column-header').nth(reviews + 1)).toContainText('Reviews (match)');
    await expect(app.getByTestId('data-grid').locator('[role="row"][aria-rowindex="2"] [role="gridcell"]').nth(reviews + 1)).toHaveText('17');

    // Summary of the new numeric column: 7 of 9 products have reviews.
    await app.getByTestId('column-menu').nth(reviews + 1).click();
    await app.getByRole('menuitem', { name: 'Column summary…' }).click();
    const summary = app.getByTestId('column-summary');
    await expect(summary).toContainText('Numeric cells');
    await expect(summary).toContainText('Empty');
    await expect(summary).toContainText('Median');
    await app.getByRole('button', { name: 'Close', exact: true }).last().click();

    // Add a row-number column.
    const before = await app.getByTestId('column-header').count();
    await app.getByTestId('clean-menu').click();
    await app.getByRole('menuitem', { name: 'Add column…' }).click();
    await app.getByTestId('add-column-name').fill('No.');
    await app.getByTestId('add-column-fill').selectOption('rowNumber');
    await app.getByTestId('add-column-apply').click();
    await expect(app.getByTestId('column-header')).toHaveCount(before + 1);
    await expect(app.getByTestId('column-header').last()).toContainText('No.');

    // Markdown export.
    await app.getByTestId('open-export').click();
    await app.getByTestId('export-format').selectOption('markdown');
    const download = app.waitForEvent('download');
    await app.getByTestId('export-confirm').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.md$/);
    const text = fs.readFileSync(await file.path(), 'utf8');
    expect(text.split('\n')[0]).toMatch(/^\| Product ID \| /);
    expect(text.split('\n')[1]).toMatch(/^\| --- \| /);
    expect(text).toContain('চা পাতা প্রিমিয়াম');
    expect(text.trim().split('\n')).toHaveLength(11);
  });
});

test.describe('look and feel', () => {
  test('credits link to Unique Labs and the developer', async ({ connect }) => {
    const { app } = await connect('/tables', '#/help');
    const credits = app.getByTestId('about').getByTestId('credits');
    await expect(credits).toContainText('A Product of Unique Labs. Developed by Shahriar Ahmed.');
    await expect(credits.getByRole('link', { name: 'Unique Labs' })).toHaveAttribute('href', 'https://www.uniquelabs.org');
    await expect(credits.getByRole('link', { name: 'Shahriar Ahmed' })).toHaveAttribute('href', 'https://t.me/igfrostt');
    for (const link of await credits.getByRole('link').all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }
    await expect(app.getByTestId('about')).toContainText('© 2026 Unique Labs');
  });

  test('sound and animations can be switched off and stay off', async ({ connect }) => {
    const { app } = await connect('/tables', '#/settings');
    await expect(app.locator('html')).toHaveAttribute('data-motion', 'on');
    await expect(app.getByTestId('sound-test')).toBeEnabled();
    await app.getByLabel('Sound effects').uncheck();
    await app.getByLabel(/^Animations/).uncheck();
    await expect(app.locator('html')).toHaveAttribute('data-motion', 'off');
    await expect(app.getByTestId('sound-test')).toBeDisabled();
    await settingsSaved(app);
    await app.reload();
    await expect(app.locator('html')).toHaveAttribute('data-motion', 'off');
    await expect(app.getByLabel('Sound effects')).not.toBeChecked();
  });

  test('the home screen counts what the page contains', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    const hero = app.getByTestId('home-hero');
    await expect(hero).toContainText('What do you want from');
    // Six counters animate up to the real values reported by the page scan.
    const counters = hero.locator('[data-value]');
    await expect(counters).toHaveCount(6);
    await expect.poll(() => counters.evaluateAll((nodes) => nodes.every((node) => node.textContent === node.getAttribute('data-value')))).toBe(true);
    const values = await counters.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-value'))));
    // The fixture has links, images, headings and structured data, but no data table.
    expect(values[0]).toBe(0);
    for (const index of [2, 3, 4, 5]) expect(values[index], `counter ${index}`).toBeGreaterThan(0);
  });
});
