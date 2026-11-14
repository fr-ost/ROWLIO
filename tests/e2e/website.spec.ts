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
      expect(html, page).not.toMatch(/\{\{&?\w+\}\}/);
      expect(html, page).toContain('A Product of <a');
      expect(html, page).toContain('href="https://www.uniquelabs.org"');
      expect(html, page).toContain('href="https://t.me/igfrostt"');
      // Nothing is loaded from other origins: no trackers, CDNs or web fonts.
      // (The canonical link names this site's own address and loads nothing.)
      expect(html.replace(/<link rel="canonical"[^>]*>/g, ''), page).not.toMatch(/<(script|link|img)[^>]+(src|href)="https?:/);
      expect(html, page).toMatch(/<link rel="canonical" href="https:\/\/rowlio\.uniquelabs\.org\//);
    }
  });

  test('has a sitemap and robots.txt for the public address', () => {
    const sitemap = fs.readFileSync(path.join(dist, 'sitemap.xml'), 'utf8');
    const locs = Array.from(sitemap.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1]);
    const site = 'https://rowlio.uniquelabs.org';
    expect(locs.slice(0, 3)).toEqual([`${site}/`, `${site}/blog`, `${site}/privacy`]);
    for (const page of ['about', 'contact', 'faq', 'support']) expect(locs).toContain(`${site}/${page}`);
    expect(locs.filter((loc) => loc.startsWith(`${site}/blog/`))).toHaveLength(10);
    expect(locs).not.toContain(`${site}/404`);
    expect(new Set(locs).size).toBe(locs.length);
    expect(sitemap).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    expect(sitemap).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    expect(fs.readFileSync(path.join(dist, 'robots.txt'), 'utf8')).toContain('Sitemap: https://rowlio.uniquelabs.org/sitemap.xml');
  });

  test('every page has unique, complete search metadata and valid structured data', () => {
    const files = fs.readdirSync(dist, { recursive: true }).map(String).filter((name) => name.endsWith('.html') && name !== '404.html');
    expect(files.length).toBe(17);
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const file of files) {
      const html = fs.readFileSync(path.join(dist, file), 'utf8');
      expect(html, file).not.toMatch(/\{\{&?\w+\}\}/);
      const title = /<title>([^<]+)<\/title>/.exec(html)?.[1] ?? '';
      const description = /<meta name="description" content="([^"]+)"/.exec(html)?.[1] ?? '';
      expect(title.length, `${file} title`).toBeGreaterThan(10);
      expect(title.length, `${file} title`).toBeLessThanOrEqual(70);
      expect(description.length, `${file} description`).toBeGreaterThan(50);
      expect(description.length, `${file} description`).toBeLessThanOrEqual(160);
      titles.add(title);
      descriptions.add(description);
      expect(html.match(/<h1[\s>]/g), `${file} h1`).toHaveLength(1);
      expect(html, file).toMatch(/<link rel="canonical" href="https:\/\/rowlio\.uniquelabs\.org\//);
      expect(html, file).toMatch(/<html lang="en">/);
      // Structured data parses, and never claims ratings or reviews that do not exist.
      for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
        const data = JSON.parse(block[1]);
        expect(data['@context']).toBe('https://schema.org');
        expect(JSON.stringify(data)).not.toMatch(/aggregateRating|"review"/);
      }
      // Images are described and sized, so the page does not jump while loading.
      for (const img of html.matchAll(/<img\b[^>]*>/g)) {
        expect(img[0], file).toMatch(/\balt="/);
        expect(img[0], file).toMatch(/\bwidth="\d+"/);
      }
    }
    expect(titles.size).toBe(files.length);
    expect(descriptions.size).toBe(files.length);

    const home = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    for (const type of ['SoftwareApplication', 'WebSite', 'FAQPage']) expect(home).toContain(`"@type":"${type}"`);
    const post = fs.readFileSync(path.join(dist, 'blog', 'is-web-scraping-legal.html'), 'utf8');
    for (const type of ['BlogPosting', 'BreadcrumbList']) expect(post).toContain(`"@type":"${type}"`);
    expect(post).toContain('<meta property="og:type" content="article">');
    expect(fs.readFileSync(path.join(dist, 'faq.html'), 'utf8')).toContain('"@type":"FAQPage"');
    expect(fs.readFileSync(path.join(dist, '404.html'), 'utf8')).toContain('content="noindex"');
    expect(fs.readFileSync(path.join(dist, 'feed.xml'), 'utf8').match(/<item>/g)).toHaveLength(10);
    expect(fs.existsSync(path.join(dist, 'assets', 'og-image.png'))).toBe(true);
  });

  test('blog articles are substantial and every internal link leads somewhere', () => {
    const exists = (href: string) => {
      const clean = href.split('#')[0].replace(/^\//, '');
      if (clean === '') return true;
      return [clean, `${clean}.html`, path.join(clean, 'index.html')].some((candidate) => fs.existsSync(path.join(dist, candidate)) && fs.statSync(path.join(dist, candidate)).isFile());
    };
    const blog = path.join(dist, 'blog');
    const posts = fs.readdirSync(blog).filter((name) => name !== 'index.html');
    expect(posts).toHaveLength(10);
    for (const name of posts) {
      const html = fs.readFileSync(path.join(blog, name), 'utf8');
      const article = /<article>([\s\S]*?)<\/article>/.exec(html)?.[1] ?? '';
      const words = article.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
      expect(words, `${name} words`).toBeGreaterThan(650);
      expect(article.match(/<h2/g)?.length ?? 0, `${name} sections`).toBeGreaterThanOrEqual(5);
      for (const link of html.matchAll(/href="(\/[^"]*)"/g)) expect(exists(link[1]), `${name} → ${link[1]}`).toBe(true);
    }
    const index = fs.readFileSync(path.join(blog, 'index.html'), 'utf8');
    for (const name of posts) expect(index).toContain(`href="/blog/${name.replace('.html', '')}"`);
    for (const page of ['about.html', 'contact.html', 'faq.html', 'support.html']) {
      const html = fs.readFileSync(path.join(dist, page), 'utf8');
      for (const link of html.matchAll(/href="(\/[^"]*)"/g)) expect(exists(link[1]), `${page} → ${link[1]}`).toBe(true);
    }
    expect(fs.readFileSync(path.join(dist, 'contact.html'), 'utf8')).toContain('href="https://t.me/igfrostt"');
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
