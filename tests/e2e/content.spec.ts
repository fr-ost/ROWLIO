import fs from 'node:fs';
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function exportJson(app: Page): Promise<Record<string, string>[]> {
  await app.getByTestId('open-export').click();
  await app.getByTestId('export-format').selectOption('json');
  const download = app.waitForEvent('download');
  await app.getByTestId('export-confirm').click();
  return JSON.parse(fs.readFileSync(await (await download).path(), 'utf8')) as Record<string, string>[];
}

test.describe('links, images, lists, metadata and structured data', () => {
  test('extracts links with absolute and relative URLs and attributes', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    await app.getByTestId('extract-links').click();
    await expect(app.getByTestId('data-page')).toBeVisible();
    const rows = await exportJson(app);
    const external = rows.find((row) => row['Link text'] === 'External B');
    expect(external).toEqual({
      'Link text': 'External B',
      URL: 'https://example.org/b',
      'Relative URL': 'https://example.org/b',
      Title: 'B title',
      Target: '_blank',
      Rel: 'noopener',
      Type: 'external',
    });
    const internal = rows.find((row) => row['Link text'] === 'Internal A');
    expect(internal?.URL).toBe('http://127.0.0.1:4173/a');
    expect(internal?.['Relative URL']).toBe('/a');
    expect(internal?.Type).toBe('internal');
    expect(rows.find((row) => row.URL === 'mailto:hi@example.com')?.Type).toBe('mailto');
  });

  test('filters links by scope, text and container', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    const card = app.getByTestId('card-links');
    await card.getByLabel('Which links').selectOption('external');
    await app.getByTestId('extract-links').click();
    await expect(app.getByTestId('row-count')).toHaveText('1 rows');
    await expect(app.getByTestId('data-grid')).toContainText('https://example.org/b');

    await app.goto(app.url().replace(/#.*/, '#/'));
    await card.getByLabel('Which links').selectOption('all');
    await card.getByLabel('Link text contains').fill('internal a');
    await card.getByLabel('Only inside this container').fill('ul.links');
    await card.getByLabel('Skip duplicate URLs').check();
    await app.getByTestId('extract-links').click();
    await expect(app.getByTestId('dataset-tab')).toHaveCount(2);
    // "Internal A" and "Internal A again" share a URL: one is skipped and reported.
    await expect(app.getByTestId('row-count')).toHaveText('1 rows');
    await expect(app.getByTestId('dataset-warnings')).toContainText('1 duplicate link(s) were skipped');
  });

  test('extracts images including lazy-loaded, srcset and picture sources', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    await app.getByTestId('card-images').getByLabel('Skip duplicate URLs').uncheck();
    await app.getByTestId('extract-images').click();
    await expect(app.getByTestId('data-page')).toBeVisible();
    const rows = await exportJson(app);
    expect(rows).toHaveLength(5);
    const front = rows[0];
    expect(front['Image URL']).toBe('http://127.0.0.1:4173/img/a.png');
    expect(front['Alt text']).toBe('Front view');
    expect(front.Title).toBe('Front');
    expect(front.Loading).toBe('lazy');
    expect(front['Source element']).toBe('img[src]');
    // The placeholder data: URI is looked through to the real lazy source.
    const lazy = rows.find((row) => row['Alt text'] === 'Lazy one');
    expect(lazy?.['Image URL']).toBe('http://127.0.0.1:4173/img/lazy-real.jpg');
    expect(lazy?.['Source element']).toBe('img[data-src]');
    const responsive = rows.find((row) => row['Alt text'] === 'Responsive');
    expect(`${responsive?.['Image URL']} ${responsive?.['Other sources']}`).toContain('/img/large.jpg');
    const hero = rows.find((row) => row['Alt text'] === 'Hero');
    expect(`${hero?.['Image URL']} ${hero?.['Other sources']}`).toContain('/img/hero.webp');
  });

  test('extracts lists, headings, breadcrumbs, metadata, JSON-LD and microdata together', async ({ connect }) => {
    const { app } = await connect('/content', '#/');
    const card = app.getByTestId('card-content');
    for (const label of ['Ordered lists', 'Unordered lists', 'Definition lists', 'Headings', 'Breadcrumbs', 'JSON-LD structured data', 'Schema.org microdata']) {
      await card.getByLabel(label, { exact: true }).check();
    }
    await card.getByLabel(/^Metadata/).check();
    await app.getByTestId('extract-content').click();
    const tabs = app.getByTestId('dataset-tab');
    await expect(tabs).toHaveText([/Lists/, /Headings/, /Breadcrumbs/, /Page metadata/, /JSON-LD/, /Microdata/]);
    const grid = app.getByTestId('data-grid');

    await tabs.filter({ hasText: 'Lists' }).click();
    await expect(grid).toContainText('Capacity');
    await expect(grid).toContainText('1.7 L');
    await expect(grid).toContainText('Colour / Color'); // two terms sharing one definition
    await expect(grid).toContainText('Wait for the click'); // nested item

    await tabs.filter({ hasText: 'Headings' }).click();
    await expect(grid).toContainText('Acme Kettle');
    await expect(grid).toContainText('http://127.0.0.1:4173/content#specs');

    await tabs.filter({ hasText: 'Breadcrumbs' }).click();
    await expect(grid).toContainText('Kitchen');
    await expect(grid).toContainText('JSON-LD');

    await tabs.filter({ hasText: 'Page metadata' }).click();
    await expect(grid).toContainText('A sturdy kettle for everyday use.');
    await expect(grid).toContainText('og:title');
    await expect(grid).toContainText('twitter:card');
    await expect(grid).toContainText('canonical');

    await tabs.filter({ hasText: 'JSON-LD' }).click();
    await expect(app.getByTestId('column-header').filter({ hasText: /^offers\.price(?!Currency)/ })).toHaveCount(1);
    await expect(grid).toContainText('39.90');
    await expect(grid).toContainText('AK-1');
    await expect(grid).toContainText('4.6');

    await tabs.filter({ hasText: 'Microdata' }).click();
    await expect(grid).toContainText('Product');
    await expect(app.getByTestId('column-header').filter({ hasText: 'offers.priceCurrency' })).toHaveCount(1);
  });
});
