// The marketing website (./website → ./website-dist, the folder Vercel serves).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..', '..');
const dist = path.join(root, 'website-dist');

test.describe('website', () => {
  test.beforeAll(() => {
    execFileSync('node', [path.join(root, 'scripts', 'website.mjs')], { cwd: root });
  });

  test('is built from the brand configuration with no placeholders left', () => {
    const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    expect(vercel.outputDirectory).toBe('website-dist');
    expect(vercel.buildCommand).toBe('node scripts/website.mjs');
    for (const page of ['index.html', 'privacy.html']) {
      const html = fs.readFileSync(path.join(dist, page), 'utf8');
      expect(html, page).not.toMatch(/\{\{|\}\}/);
      expect(html, page).toContain('A Product of <a');
      expect(html, page).toContain('href="https://www.uniquelabs.org"');
      expect(html, page).toContain('href="https://t.me/igfrostt"');
      // Nothing is loaded from other origins: no trackers, CDNs or web fonts.
      expect(html, page).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
    }
  });

  test('renders, offers the download and makes no third-party requests', async ({ page }) => {
    const requests: string[] = [];
    const errors: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(pathToFileURL(path.join(dist, 'index.html')).href);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Turn any webpage into structured data.');
    expect(requests.filter((url) => !url.startsWith('file:'))).toEqual([]);
    expect(errors).toEqual([]);

    const download = page.getByRole('link', { name: /Download for Chrome/ });
    const href = await download.getAttribute('href');
    expect(href).toMatch(/^downloads\/rowlio-\d+\.\d+\.\d+\.zip$/);
    expect(fs.existsSync(path.join(dist, href!))).toBe(true);

    // Every image on the page exists and loads.
    const broken = await page.evaluate(async () => {
      const images = Array.from(document.images);
      // Images further down are lazy; ask for them now so every one is checked.
      for (const img of images) img.loading = 'eager';
      await Promise.all(images.map((img) => (img.complete ? null : new Promise((resolve) => ((img.onload = resolve), (img.onerror = resolve))))));
      return images.filter((img) => img.naturalWidth === 0).map((img) => img.src);
    });
    expect(broken).toEqual([]);

    const footer = page.locator('footer');
    await expect(footer).toContainText('© 2026 Unique Labs. A Product of Unique Labs. Developed by Shahriar Ahmed.');
    await expect(footer.getByRole('link', { name: 'Shahriar Ahmed' })).toHaveAttribute('href', 'https://t.me/igfrostt');

    // Interactions: step tabs swap the screenshot, the sound switch remembers its state.
    await page.getByRole('tab', { name: /Export/ }).click();
    await expect(page.locator('#shot img')).toHaveAttribute('src', /05-export\.png$/);
    const sound = page.getByRole('button', { name: 'Sound effects' });
    await expect(sound).toHaveAttribute('aria-pressed', 'true');
    await sound.click();
    await expect(sound).toHaveAttribute('aria-pressed', 'false');
  });

  test('fits a phone screen without sideways scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 380, height: 780 });
    await page.goto(pathToFileURL(path.join(dist, 'index.html')).href);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
