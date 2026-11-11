// Rowlio build pipeline.
//
// Produces a loadable Manifest V3 extension in ./dist (or ./dist-e2e with --e2e):
//   1. extension pages (app.html, popup.html) – standard Vite multi-page build
//   2. content script – a single classic IIFE file (it is injected on demand with
//      chrome.scripting.executeScript, which cannot load ES modules)
//   3. background service worker – a single ES module file
//   4. manifest.json and _locales generated from brand.config.json + package.json
//
// Flags:
//   --watch   rebuild on change (development)
//   --e2e     test build: adds localhost host permissions so Playwright can drive the
//             extension without a real toolbar click. Never ship this build.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const watch = args.has('--watch');
const e2e = args.has('--e2e');
const outDir = path.join(root, e2e ? 'dist-e2e' : 'dist');

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const brand = JSON.parse(await fs.readFile(path.join(root, 'brand.config.json'), 'utf8'));

const shared = {
  root,
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: {
      '@brand': path.join(root, 'brand.config.json'),
      '@': path.join(root, 'src'),
    },
  },
  define: {
    __E2E__: JSON.stringify(e2e),
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
};

const common = {
  outDir,
  target: 'chrome120',
  sourcemap: false,
  minify: !watch,
  watch: watch ? {} : null,
  reportCompressedSize: false,
};

function manifest() {
  const m = {
    manifest_version: 3,
    name: '__MSG_extName__',
    short_name: brand.name,
    description: '__MSG_extDescription__',
    version: pkg.version,
    default_locale: 'en',
    ...(brand.urls.homepage ? { homepage_url: brand.urls.homepage } : {}),
    minimum_chrome_version: '120',
    icons: {
      16: 'icons/icon-16.png',
      32: 'icons/icon-32.png',
      48: 'icons/icon-48.png',
      128: 'icons/icon-128.png',
    },
    action: {
      default_popup: 'popup.html',
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: 'icons/icon-16.png',
        32: 'icons/icon-32.png',
        48: 'icons/icon-48.png',
      },
    },
    background: {
      service_worker: 'background.js',
      type: 'module',
    },
    // The only install-time permissions. No host permissions: Rowlio can touch a
    // page only after the user invokes it on that tab (activeTab).
    permissions: ['activeTab', 'scripting'],
    // Requested at runtime, per site, only when the user asks for persistent access.
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+R' },
        description: '__MSG_cmdOpenPopup__',
      },
      'open-workspace': {
        suggested_key: { default: 'Alt+Shift+W' },
        description: '__MSG_cmdOpenWorkspace__',
      },
      'start-picker': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdStartPicker__',
      },
    },
    content_security_policy: {
      // connect-src 'self' means extension pages cannot talk to any remote server.
      extension_pages:
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; " +
        "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
  };
  if (e2e) {
    m.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];
    m.name = `${brand.name} (E2E test build)`;
  }
  return m;
}

function locales() {
  const msg = (message, description) => ({ message, ...(description ? { description } : {}) });
  return {
    extName: msg(brand.storeTitle, 'Extension name shown in Chrome and the Chrome Web Store.'),
    extDescription: msg(brand.shortDescription, 'Short description (max 132 characters).'),
    actionTitle: msg(`${brand.name} – ${brand.tagline}`),
    cmdOpenPopup: msg(`Open the ${brand.name} popup`),
    cmdOpenWorkspace: msg(`Open the ${brand.name} workspace for the current tab`),
    cmdStartPicker: msg('Start the visual selector on the current tab'),
  };
}

async function writeStatic() {
  if (brand.shortDescription.length > 132) {
    throw new Error(`brand.shortDescription is ${brand.shortDescription.length} chars; Chrome allows 132.`);
  }
  await fs.mkdir(path.join(outDir, '_locales', 'en'), { recursive: true });
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest(), null, 2));
  await fs.writeFile(
    path.join(outDir, '_locales', 'en', 'messages.json'),
    JSON.stringify(locales(), null, 2),
  );
}

async function buildPages() {
  await build({
    ...shared,
    base: './',
    plugins: [react(), tailwindcss()],
    worker: { format: 'es' },
    build: {
      ...common,
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          app: path.join(root, 'app.html'),
          popup: path.join(root, 'popup.html'),
        },
      },
    },
  });
}

async function buildSingle(entry, fileName, format, name) {
  await build({
    ...shared,
    publicDir: false,
    build: {
      ...common,
      emptyOutDir: false,
      copyPublicDir: false,
      lib: {
        entry: path.join(root, entry),
        formats: [format],
        name,
        fileName: () => fileName,
      },
    },
  });
}

const started = Date.now();
await buildPages();
await Promise.all([
  buildSingle('src/content/index.ts', 'content.js', 'iife', 'RowlioContent'),
  buildSingle('src/background/index.ts', 'background.js', 'es', 'RowlioBackground'),
]);
await writeStatic();

if (watch) {
  console.log(`[rowlio] watching – load ${path.relative(root, outDir)}/ as an unpacked extension`);
} else {
  console.log(`[rowlio] built ${path.relative(root, outDir)}/ in ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
