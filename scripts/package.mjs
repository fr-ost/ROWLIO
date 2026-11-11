// Creates the upload-ready archive for the Chrome Web Store from ./dist.
// Output: release/<prefix>-<version>.zip (manifest.json at the root of the archive).
import { zipSync } from 'fflate';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));
const dist = path.join(root, 'dist');

const manifest = JSON.parse(await fs.readFile(path.join(dist, 'manifest.json'), 'utf8'));
if (manifest.host_permissions) throw new Error('dist/ contains host_permissions: refusing to package a test build.');
if (manifest.version !== pkg.version) throw new Error('dist/manifest.json is stale. Run `npm run build` first.');

async function collect(dir, prefix = '') {
  const entries = {};
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) Object.assign(entries, await collect(full, name));
    else entries[name] = new Uint8Array(await fs.readFile(full));
  }
  return entries;
}

const files = await collect(dist);
const archive = zipSync(files, { level: 9 });
const outDir = path.join(root, 'release');
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `${brand.filePrefix}-${pkg.version}.zip`);
await fs.writeFile(outFile, archive);
console.log(`[rowlio] ${path.relative(root, outFile)} – ${Object.keys(files).length} files, ${(archive.length / 1024).toFixed(0)} KB`);
