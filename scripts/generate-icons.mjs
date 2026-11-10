// Renders the extension icons (PNG 16/32/48/128) and the store icon from one SVG,
// using the Chromium that ships with Playwright (a dev dependency). Run: npm run icons
// The generated files in public/icons are committed, so a normal build needs no browser.
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));
const outDir = path.join(root, 'public', 'icons');
await fs.mkdir(outDir, { recursive: true });

// Three "rows" on a rounded square: rows of data, the product's whole idea.
const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7.5" fill="${brand.colors.brand}"/>
  <rect x="7" y="8.3" width="18" height="3.6" rx="1.8" fill="#ffffff"/>
  <rect x="7" y="14.2" width="18" height="3.6" rx="1.8" fill="#ffffff" fill-opacity="0.84"/>
  <rect x="7" y="20.1" width="11" height="3.6" rx="1.8" fill="#ffffff" fill-opacity="0.66"/>
</svg>`;

await fs.writeFile(path.join(outDir, 'icon.svg'), svg(128).trim() + '\n');

const browser = await chromium.launch();
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg(size)}`);
    await page.screenshot({ path: path.join(outDir, `icon-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`[rowlio] icons written to ${path.relative(root, outDir)}/`);
