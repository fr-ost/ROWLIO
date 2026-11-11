// Renders the Chrome Web Store graphics into ./store-assets, using the Chromium that
// ships with Playwright (a dev dependency). Run: npm run store-assets
//
//   store-icon-128.png            128×128, artwork 96×96 with transparent padding
//   promo-small-440x280.png       small promo tile
//   promo-marquee-1400x560.png    marquee promo tile
//   screenshot-1..5-1280x800.png  captioned screenshots (from docs/screenshots)
//
// Text comes from brand.config.json. The screenshots inside the frames are the ones
// `npm run screenshots` takes on the local test site.
import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));
const outDir = path.join(root, 'store-assets');
await fs.mkdir(outDir, { recursive: true });

const url = (...parts) => pathToFileURL(path.join(root, ...parts)).href;
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const logo = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10b981"/><stop offset="1" stop-color="#0ea5e9"/></linearGradient></defs>
  <rect width="32" height="32" rx="7.5" fill="url(#g)"/>
  <rect x="7" y="8.3" width="18" height="3.6" rx="1.8" fill="#fff"/>
  <rect x="7" y="14.2" width="18" height="3.6" rx="1.8" fill="#fff" fill-opacity="0.84"/>
  <rect x="7" y="20.1" width="11" height="3.6" rx="1.8" fill="#fff" fill-opacity="0.66"/>
</svg>`;

const base = `
@font-face { font-family: Inter; src: url("${url('website', 'assets', 'fonts', 'inter-latin.woff2')}") format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body {
  font-family: Inter, system-ui, sans-serif; color: #ecfdf5; overflow: hidden; position: relative;
  background:
    radial-gradient(60% 80% at 0% 0%, rgba(16, 185, 129, 0.55), transparent 62%),
    radial-gradient(55% 80% at 100% 10%, rgba(14, 165, 233, 0.45), transparent 62%),
    radial-gradient(60% 70% at 60% 110%, rgba(13, 148, 136, 0.4), transparent 62%),
    #04100c;
}
.grad { background: linear-gradient(90deg, #38bdf8, #2dd4bf 60%, #34d399); -webkit-background-clip: text; background-clip: text; color: transparent; }
.brand { display: flex; align-items: center; gap: 0.45em; font-weight: 700; letter-spacing: -0.02em; }
.pill { display: inline-block; border: 1px solid rgba(255,255,255,0.18); background: rgba(255,255,255,0.06); border-radius: 999px; color: #a7f3d0; font-weight: 500; }
.shot { border-radius: 14px; border: 1px solid rgba(255,255,255,0.16); box-shadow: 0 40px 90px -20px rgba(0,0,0,0.75), 0 0 0 6px rgba(255,255,255,0.04); display: block; }
`;

const page = (css, body) => `<!doctype html><meta charset="utf-8"><style>${base}${css}</style><body>${body}</body>`;

const [headA, headB] = (() => {
  // "Turn any webpage into structured data." → highlight the last two words.
  const words = brand.tagline.split(' ');
  return [words.slice(0, -2).join(' '), words.slice(-2).join(' ')];
})();

const jobs = [
  {
    file: 'promo-small-440x280.png',
    width: 440,
    height: 280,
    html: page(
      `body { display: flex; flex-direction: column; justify-content: center; padding: 30px 34px; }
       .brand { font-size: 30px; } h1 { font-size: 31px; line-height: 1.12; letter-spacing: -0.035em; font-weight: 800; margin-top: 18px; }
       .pill { font-size: 12.5px; padding: 5px 12px; margin-top: 18px; align-self: flex-start; }`,
      `<div class="brand">${logo(40)}${esc(brand.name)}</div>
       <h1>${esc(headA)}<br><span class="grad">${esc(headB)}</span></h1>
       <span class="pill">Free forever · No account · 100% local</span>`,
    ),
  },
  {
    file: 'promo-marquee-1400x560.png',
    width: 1400,
    height: 560,
    html: page(
      `.left { position: absolute; left: 84px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
       .brand { font-size: 44px; } h1 { font-size: 66px; line-height: 1.04; letter-spacing: -0.04em; font-weight: 800; margin-top: 30px; }
       p { font-size: 22px; line-height: 1.45; color: #a7c4b8; margin-top: 22px; }
       .pill { font-size: 17px; padding: 8px 18px; margin-top: 28px; align-self: flex-start; }
       .shot { position: absolute; left: 730px; top: 70px; width: 880px; transform: perspective(1800px) rotateY(-9deg) rotateX(2deg); transform-origin: left center; }`,
      `<div class="left">
         <div class="brand">${logo(58)}${esc(brand.name)}</div>
         <h1>${esc(headA)}<br><span class="grad">${esc(headB)}</span></h1>
         <p>Tables, listings, links and images to CSV, Excel or JSON.</p>
         <span class="pill">Free forever · No account · 100% local</span>
       </div>
       <img class="shot" src="${url('docs', 'screenshots', '00-home.png')}">`,
    ),
  },
  ...[
    ['00-home.png', 'See what a page contains', 'Tables, lists, links and images, counted the moment you open it.'],
    ['01-tables.png', 'Every table, previewed', 'Merged cells, multi-row headers and nested tables handled properly.'],
    ['02-visual-selector.png', 'Click one item, get them all', 'Rowlio finds the similar items and the fields inside them.'],
    ['04-data-preview.png', 'Review and clean your data', 'Edit, sort, filter, remove duplicates. Every change can be undone.'],
    ['05-export.png', 'Export anywhere', 'CSV, Excel, JSON, JSON Lines, TSV, Markdown or HTML. Nothing is uploaded.'],
  ].map(([shot, title, sub], index) => ({
    file: `screenshot-${index + 1}-1280x800.png`,
    width: 1280,
    height: 800,
    html: page(
      `.head { position: absolute; left: 0; right: 0; top: 34px; text-align: center; }
       .brand { position: absolute; left: 40px; top: 34px; font-size: 22px; }
       h1 { font-size: 40px; letter-spacing: -0.035em; font-weight: 800; }
       p { font-size: 19px; color: #a7c4b8; margin-top: 8px; }
       .shot { position: absolute; left: 160px; top: 158px; width: 960px; }`,
      `<div class="brand">${logo(30)}${esc(brand.name)}</div>
       <div class="head"><h1>${esc(title)}</h1><p>${esc(sub)}</p></div>
       <img class="shot" src="${url('docs', 'screenshots', shot)}">`,
    ),
  })),
];

const tmp = path.join(outDir, '.frame.html');
const browser = await chromium.launch();
try {
  for (const job of jobs) {
    const tab = await browser.newPage({ viewport: { width: job.width, height: job.height }, deviceScaleFactor: 1 });
    await fs.writeFile(tmp, job.html);
    await tab.goto(pathToFileURL(tmp).href);
    await tab.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, (img) => img.decode()));
    });
    // The store rejects images with an alpha channel: an opaque page gives an opaque PNG.
    await tab.screenshot({ path: path.join(outDir, job.file) });
    await tab.close();
  }
  // Store icon: Google asks for 96×96 artwork centred in a transparent 128×128 canvas.
  const tab = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 });
  await tab.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;margin:16px}</style>${logo(96)}`);
  await tab.screenshot({ path: path.join(outDir, 'store-icon-128.png'), omitBackground: true });
  await tab.close();
} finally {
  await browser.close();
  await fs.rm(tmp, { force: true });
}
console.log(`[rowlio] store assets written to ${path.relative(root, outDir)}/`);
