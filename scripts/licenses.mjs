// Collects the licence texts of every third-party package whose code ends up in the
// shipped extension and writes them to public/THIRD_PARTY_NOTICES.txt (copied into dist/).
// MIT / ISC require the copyright notice to accompany redistributed copies.
// Run: npm run licenses   (also runs as part of `npm run build`)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));

// Runtime dependencies, their runtime dependencies, plus Tailwind CSS: it is a build tool,
// but the stylesheet it generates (base styles and utilities) is part of the bundle.
const SHIPPED_BUILD_TOOLS = ['tailwindcss'];
const ALLOWED = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD']);

async function readPackage(name) {
  const dir = path.join(root, 'node_modules', name);
  const json = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
  const files = await fs.readdir(dir);
  const licenseFile = files.find((file) => /^licen[sc]e(\.(md|txt))?$/i.test(file));
  const text = licenseFile ? (await fs.readFile(path.join(dir, licenseFile), 'utf8')).trim() : '';
  return { name, version: json.version, license: json.license ?? 'UNKNOWN', homepage: json.homepage ?? json.repository?.url ?? '', text, dependencies: Object.keys(json.dependencies ?? {}) };
}

const seen = new Map();
const queue = [...Object.keys(pkg.dependencies ?? {}), ...SHIPPED_BUILD_TOOLS];
while (queue.length) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  const info = await readPackage(name);
  seen.set(name, info);
  // Build tools pull in many build-only packages; only their own output ships.
  if (!SHIPPED_BUILD_TOOLS.includes(name)) queue.push(...info.dependencies);
}

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
const problems = packages.filter((info) => !ALLOWED.has(info.license) || !info.text);
if (problems.length) {
  throw new Error(`Licence check failed for: ${problems.map((info) => `${info.name} (${info.license}${info.text ? '' : ', no licence file'})`).join(', ')}`);
}

const lines = [
  `${brand.name} – third-party notices`,
  '',
  `${brand.name} includes the open-source software listed below. Each package is used`,
  'unmodified and remains under its own licence, reproduced here in full.',
  '',
  ...packages.map((info) => `  ${info.name} ${info.version} – ${info.license}`),
  '',
];
for (const info of packages) {
  lines.push('='.repeat(78), `${info.name} ${info.version} (${info.license})`, info.homepage, '='.repeat(78), '', info.text, '');
}
await fs.mkdir(path.join(root, 'public'), { recursive: true });
await fs.writeFile(path.join(root, 'public', 'THIRD_PARTY_NOTICES.txt'), `${lines.join('\n')}\n`);
console.log(`[rowlio] third-party notices: ${packages.map((info) => `${info.name}@${info.version} (${info.license})`).join(', ')}`);
