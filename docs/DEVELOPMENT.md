# Development

Everything another engineer needs to build, change, test and release Rowlio.

## Requirements

- Node.js 20.19 or newer (developed on 22).
- npm 10+.
- Chrome 120+ to run the extension.
- For end-to-end tests: the Chromium that matches the pinned Playwright version. Install
  it once with:

```bash
npx playwright install chromium
```

## Setup

```bash
npm install
```

```bash
npm run build
```

Load `dist/` at `chrome://extensions` (Developer mode → Load unpacked).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Builds `dist/` and rebuilds on change. Reload the extension in Chrome to pick changes up (the content script also needs the page reloaded or Rowlio re-invoked). |
| `npm run build` | Regenerates third-party notices, then builds the production extension into `dist/`. |
| `npm run build:e2e` | Builds the test variant into `dist-e2e/` (see [TESTING.md](TESTING.md)). Never ship it. |
| `npm run typecheck` | `tsc --noEmit` in strict mode. |
| `npm test` / `npm run test:watch` | Unit tests. |
| `npm run test:e2e` | Builds both variants and runs Playwright. |
| `npm run verify` | Type check + unit tests + end-to-end tests. Run before every release. |
| `npm run package` | Builds and writes `release/rowlio-<version>.zip` for the Chrome Web Store. Refuses to package a test build. |
| `npm run icons` | Regenerates `public/icons/*.png` from the SVG in `scripts/generate-icons.mjs` (uses Playwright's Chromium). |
| `npm run licenses` | Regenerates `public/THIRD_PARTY_NOTICES.txt`; fails on a missing or non-permissive licence. |
| `npm run screenshots` | Regenerates `docs/screenshots/*.png` (1280×800) from the fixture site. The website uses the same images. |
| `npm run store-assets` | Regenerates the Chrome Web Store graphics in `store-assets/` (store icon, promo tiles, five captioned 1280×800 screenshots) from `docs/screenshots/`. |
| `npm run website` | Builds the marketing site from `website/` into `website-dist/` (Node built-ins only). |
| `npm run website:preview` | Builds the site and serves it on `http://127.0.0.1:4321`. |

## How the build works

`scripts/build.mjs` runs three Vite builds and then writes the manifest:

1. **Pages** — `app.html` and `popup.html` (React, Tailwind, code-split, plus the data
   worker chunk).
2. **Content script** — `src/content/index.ts` → one classic IIFE file, `content.js`.
   It must be a single non-module file because `chrome.scripting.executeScript({ files })`
   cannot load ES modules.
3. **Service worker** — `src/background/index.ts` → `background.js` (ES module).
4. **`manifest.json` and `_locales/en/messages.json`** are generated from
   `brand.config.json` and `package.json` (version). Edit the `manifest()` function in
   the build script to change permissions, commands or the CSP.

Build-time constants: `__APP_VERSION__` and `__E2E__` (read through
`src/config/brand.ts` as `APP_VERSION` and `IS_E2E`).

## The website and Vercel

`website/` is hand-written HTML, CSS and JavaScript with no dependencies and no
third-party requests. `scripts/website.mjs`:

1. copies `website/` to `website-dist/`, replacing `{{tokens}}` in `.html` files with
   values from `brand.config.json` and `package.json` (an unknown token fails the build);
2. copies `docs/screenshots/` to `assets/screens/` and `public/icons/` to `assets/icons/`;
3. if `release/rowlio-<version>.zip` exists, copies it over `website/downloads/` so the
   site always offers the latest package.

`vercel.json` makes a root deployment work without dashboard settings: no install step,
build command `node scripts/website.mjs`, output directory `website-dist`, clean URLs and
a few security headers. Because Vercel does not run `npm run package`, the archive in
`website/downloads/` is **committed**; refresh it with `npm run package && npm run
website` when releasing.

## Look and feel

- Design tokens, gradients and every animation live in `src/styles/app.css`. Animations
  are plain CSS classes (`page-enter`, `stagger`, `pop-in`, `card-lift`, `aurora` …).
- `html[data-motion="off"]` (the Animations setting) and `prefers-reduced-motion` switch
  all of them off in one place; `src/app/components/fx.tsx` components check the same
  flag.
- Sounds are defined as short note lists in `src/app/services/sfx.ts` and synthesised
  with the Web Audio API. Add a sound by adding an entry; play it with `playSfx(name)`.
  Do not add audio files.
- The typeface comes from `@fontsource-variable/inter` and is bundled by Vite. If you
  change it, update `SHIPPED_BUILD_TOOLS` in `scripts/licenses.mjs`.

## Changing things

### Branding

Edit `brand.config.json` only. Name, store title, tagline, description (≤ 132
characters, enforced by the build), company, colours, URLs and file prefixes flow from
there into the manifest, UI, in-page overlay, export filenames and icons. After changing
colours run `npm run icons` and update the `--color-brand-*` scale in
`src/styles/app.css`.

### Adding an extraction type

1. Add a member to `ExtractSpec` in `src/types/extraction.ts` and to `isExtractSpec` in
   `src/types/guards.ts`.
2. Implement the extractor in `src/extraction/` (DOM only; return a `RawDataset`, put
   anything unusual in `warnings`).
3. Handle it in `runSpec` (`src/extraction/engine.ts`).
4. Add labels in `src/app/components/RecipeDialog.tsx` (`METHOD_LABELS`, `describeSpec`)
   and a way to start it in the UI.
5. Add unit tests with an HTML fixture and, if it has UI, an end-to-end test.

### Adding a cleaning operation

1. Add a member to `TransformOp` (`src/types/transforms.ts`).
2. Implement it in `applyTransform` and `describeOp`
   (`src/data-processing/transforms.ts`). Keep it pure, return the same `data` reference
   when nothing changes, and report real counts in `summary`.
3. Add a menu entry in `src/app/pages/DataPage.tsx`.
4. Add tests to `tests/unit/transforms.test.ts`.

### Adding an export format

Add a writer in `src/export/`, handle it in `buildExport` (`src/export/index.ts`), add
the format to `ExportFormat`, `EXTENSION`, `MIME` and `FORMAT_LABELS`.

### Adding a request to the content script

Add it to `ContentRequests` in `src/messaging/protocol.ts`; implement the handler in
`src/content/index.ts` (validate the payload — it arrives as `unknown`); call it with
`request(tabId, 'your:type', payload)` from `src/messaging/tabClient.ts`.

### Translating

Wrap every user-visible string in `t('English text')` or `tn(count, one, other)`. To add a
language, call `registerCatalog('bn', { 'English text': 'অনুবাদ' })` and `setLocale('bn')`
at startup, and generate `_locales/<lang>/messages.json` in `scripts/build.mjs`.

## Conventions

- TypeScript `strict`; no `any` for data that crosses a boundary — use `unknown` and a
  guard.
- `src/extraction/`, `src/pagination/` (page side), `src/data-processing/` and
  `src/export/` must not import `chrome.*` or React. This keeps them testable in jsdom
  and reusable outside the extension.
- Never write page content with `innerHTML` (or any HTML sink). Use `textContent` /
  React text.
- Long loops take a `Pacer` and call `await pacer.tick()`; long operations accept an
  `AbortSignal`.
- No silent data loss: if something is skipped, capped or ambiguous, add a warning or
  throw an error with a message the user can act on.
- Success messages state real counts returned by the operation.
- Tests may not be weakened to pass. A failing test means the code or the stated
  expectation is wrong; decide which, and say so in the commit.
- There is no ESLint configuration yet; the type checker is the only static gate.
  Adding a linter is a reasonable next step.

## Debugging

- **Workspace / popup**: right-click the page → Inspect. The popup can also be opened as
  a tab in the test build: `chrome-extension://<id>/popup.html?tab=<tabId>`.
- **Service worker**: `chrome://extensions` → Rowlio → "service worker".
- **Content script**: the page's DevTools → Sources → Content scripts, or select the
  "Rowlio" context in the console's context dropdown.
- **Storage**: workspace DevTools → Application → IndexedDB → `rowlio`.
- **End-to-end tests**: run one with `--trace on`, or `--headed --debug`.

## Release procedure

1. Update `version` in `package.json` (the manifest version follows it) and add a section
   to `CHANGELOG.md`.
2. `npm ci`
3. `npm run verify`
4. `npm audit`
5. Work through the manual checklist in [TESTING.md](TESTING.md).
6. `npm run package`, then `npm run website`, and commit the refreshed
   `website/downloads/rowlio-<version>.zip`.
7. Upload `release/rowlio-<version>.zip` in the Chrome Web Store developer dashboard and
   complete the listing from
   [CHROME_WEB_STORE_LISTING.md](CHROME_WEB_STORE_LISTING.md).
8. Tag the commit.

## Open decisions for the maintainers

- **Licence** for Rowlio's own code (none chosen; see the README).
- **Brand clearance**: domain, Chrome Web Store name and trademark availability of
  "Rowlio" have not been verified.
- **Contact details**: `brand.config.json` → `urls.homepage` is set to the Unique Labs
  website; support, privacy policy and source code URLs are still empty.
- **Website domain**: where the site will be served from, and whether the archive should
  keep being offered there once the extension is in the Chrome Web Store.
