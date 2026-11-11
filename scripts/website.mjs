// Builds the marketing website into ./website-dist (the folder Vercel serves).
//
// Uses only Node built-ins, so it runs on Vercel without `npm install`:
//   • copies ./website, replacing {{tokens}} in .html files with values from
//     brand.config.json and package.json (branding stays in one place);
//   • adds the product screenshots and icons;
//   • includes the extension archive from ./website/downloads (refreshed from ./release
//     whenever `npm run package` has been run locally).
//
//   node scripts/website.mjs            build
//   node scripts/website.mjs --serve    build, then preview on http://127.0.0.1:4321
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'website');
// `--out <dir>` (relative to the current directory) changes the output folder. Used when
// Vercel's Root Directory is set to `website`, where the output must live inside it.
const outArg = process.argv.indexOf('--out');
const out = outArg > -1 && process.argv[outArg + 1] ? path.resolve(process.argv[outArg + 1]) : path.join(root, 'website-dist');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));

const exists = (file) => fs.access(file).then(() => true, () => false);

// Keep the committed download in step with the latest local package, when there is one.
const zipName = `${brand.filePrefix}-${pkg.version}.zip`;
const released = path.join(root, 'release', zipName);
const downloads = path.join(src, 'downloads');
if (await exists(released)) {
  await fs.mkdir(downloads, { recursive: true });
  for (const file of await fs.readdir(downloads)) if (file.endsWith('.zip')) await fs.rm(path.join(downloads, file));
  await fs.copyFile(released, path.join(downloads, zipName));
}
const available = (await exists(downloads)) ? (await fs.readdir(downloads)).filter((file) => file.endsWith('.zip')).sort() : [];
const zip = available.includes(zipName) ? zipName : (available[available.length - 1] ?? '');
if (!zip) console.warn('[website] no extension archive in website/downloads – run `npm run package` first');
const zipSize = zip ? `${Math.round((await fs.stat(path.join(downloads, zip))).size / 1024)} KB` : '';

const tokens = {
  name: brand.name,
  storeTitle: brand.storeTitle,
  tagline: brand.tagline,
  description: brand.shortDescription,
  positioning: brand.positioning,
  motto: brand.motto,
  company: brand.company,
  companyUrl: brand.urls.homepage,
  copyright: brand.copyright,
  developer: brand.developer.name,
  developerUrl: brand.developer.url,
  version: zip ? zip.replace(`${brand.filePrefix}-`, '').replace('.zip', '') : pkg.version,
  zip: zip ? `downloads/${zip}` : '#install',
  zipSize,
  year: String(new Date().getFullYear()),
  // Automated tests behind a release, rounded down (see docs/TESTING.md).
  tests: '900',
};
const escapeHtml = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const render = (text) =>
  text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in tokens)) throw new Error(`Unknown token ${match} in website template`);
    return escapeHtml(tokens[key]);
  });

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (a === out || entry.name === 'vercel.json') continue;
    if (entry.isDirectory()) await copyDir(a, b);
    else if (entry.name.endsWith('.html')) await fs.writeFile(b, render(await fs.readFile(a, 'utf8')));
    else await fs.copyFile(a, b);
  }
}

await fs.rm(out, { recursive: true, force: true });
await copyDir(src, out);
await copyDir(path.join(root, 'docs', 'screenshots'), path.join(out, 'assets', 'screens'));
await copyDir(path.join(root, 'public', 'icons'), path.join(out, 'assets', 'icons'));
console.log(`[website] built ${path.relative(root, out)}/ (download: ${zip || 'none'})`);

if (process.argv.includes('--serve')) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
  const port = Number(process.env.PORT || 4321);
  http
    .createServer(async (req, res) => {
      let pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      let file = path.join(out, pathname);
      if (!file.startsWith(out)) return res.writeHead(403).end();
      if (!(await exists(file)) && (await exists(`${file}.html`))) file = `${file}.html`; // cleanUrls
      try {
        const body = await fs.readFile(file);
        res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' }).end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      }
    })
    .listen(port, '127.0.0.1', () => console.log(`[website] preview on http://127.0.0.1:${port}`));
}
