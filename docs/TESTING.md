# Testing

Rowlio has three layers of automated tests. All of them run locally with no network
access beyond a fixture site served from `127.0.0.1`.

| Layer | Tool | Where | What it proves |
|---|---|---|---|
| Unit | Vitest + jsdom | `tests/unit/` | The extraction engine, detection heuristics, pagination and scroll logic, data cleaning, exports, storage and input validation behave correctly on realistic HTML and data. |
| End-to-end (test build) | Playwright + Chromium | `tests/e2e/*.spec.ts` | Complete user workflows through the real extension UI in a real browser. |
| End-to-end (production build) | Playwright + DevTools protocol | `tests/e2e/production.spec.ts`, `manifest.spec.ts` | The build that ships works with **real permissions**: no access before the toolbar button is clicked, full function after. |

## Running

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

`npm run test:e2e` builds `dist/` and `dist-e2e/` first. `npm run verify` runs everything.
A single file or test:

```bash
npx vitest run tests/unit/tables.test.ts
```

```bash
npx playwright test tests/e2e/pagination.spec.ts --trace off
```

To debug an end-to-end failure, re-run that test with `--trace on` and open the trace.

## Current results

Last full run: **all passing**.

| Suite | Files | Tests | Result |
|---|---|---|---|
| Unit | 15 | 862 | 862 passed |
| End-to-end | 11 | 53 | 52 passed, 1 skipped (the screenshot generator, which only runs on request) |
| Type check | — | — | 0 errors (`strict`) |
| `npm audit` | — | — | 0 known vulnerabilities |

Environment: Chromium 153.0.8010.12 (Playwright 1.63.0, headless), Node.js 22,
Vitest 5.1, jsdom 31, TypeScript 7.0.

## Unit tests

| File | Covers |
|---|---|
| `tables.test.ts` | Headers, `rowspan` / `colspan` / `rowspan=0`, multi-row headers, ragged rows, hidden rows / columns / inline content, nested tables, names, Unicode + Bengali + emoji, form values, ARIA grids, shadow DOM, missing tables, summaries, dynamic fingerprint, 6,000-row table, cancellation |
| `selectors.test.ts` | CSS / XPath validation, relative queries, XPath attributes / text nodes / scalars, reading text / HTML / links / images / attributes, lazy images, rule extraction, missing fields, column mode warnings, preview limit, invalid rules, row cache |
| `detection.test.ts` | Class quality, similarity, unique / relative / group selectors, pattern ranking, record groups (rows vs. cells, lists, two examples), field detection and types, value classification |
| `content-extractors.test.ts` | Text extraction, links (filters, `<base>`, duplicates), `srcset` parsing, lazy / `<picture>` images, size filters, CSS backgrounds, lists (nested, definition), headings, breadcrumbs, metadata, JSON flattening, JSON-LD, microdata, page scan, content signature |
| `pagination.test.ts` | Next-control detection (rel, text in many languages, ARIA, class, arrows, page numbers, disabled, carousels excluded, custom selector), accumulator (pages / scroll modes, column union, limits), pagination runner with a scripted transport (every stop reason, retries, cancellation, loop guard), bounded scroll with a scripted environment (every limit, virtualised lists, load more, cancel, errors), DOM settle / change waits |
| `transforms.test.ts` | Every cleaning operation, purity and structural sharing, Bengali digits and text |
| `infer.test.ts` | Type inference, number parsing (locales, Unicode digits), unambiguous date parsing and rejections |
| `view.test.ts` | Search, filters, numeric-aware stable sort, duplicates |
| `dataset.test.ts` | Building datasets from raw results, ragged rows, column union |
| `export-csv.test.ts` | RFC 4180 escaping, CRLF, delimiters, TSV, round trip, Unicode, formula-injection table |
| `export-json.test.ts` | JSON / JSONL validity, key order, Unicode |
| `export-xlsx.test.ts` | OOXML structure, inline strings, no formulas, number and date typing, sheet names, illegal XML characters, limits, 50,000-row sheet, independent round trip through `read-excel-file` |
| `export-build.test.ts` | Blob output per format, BOM, progress, multi-sheet rules |
| `storage.test.ts` | Projects and recipes CRUD on `fake-indexeddb`, transactions, import validation, settings merge, delete all |
| `guards-utils.test.ts` | Validation of untrusted messages / recipes / datasets, URL helpers and patterns, restricted pages, text helpers, i18n, async helpers, brand config |

## End-to-end tests

The fixture site (`tests/e2e/server.mjs`) serves: tables (merged cells, hidden rows,
Bengali, nested, scrollable, a layout table, a table inserted after load), a 27-product
catalogue over three pages, a single-page app with in-place paging, page-number
navigation, an infinite-scroll feed driven by `IntersectionObserver`, a table of any
size, and a content page with lists, breadcrumbs, lazy / responsive images, metadata,
JSON-LD and microdata.

| File | Workflows |
|---|---|
| `tables.spec.ts` | Listing with previews and warnings, dynamic table pickup, merged cells in the grid, hidden rows, extract all, CSV + XLSX download with Bengali / emoji / formula text, clipboard copy, 20,000-row table (virtualised grid, search, worker transform + undo, JSONL export of all rows) |
| `visual.spec.ts` | Auto-detected fields for product cards, point-and-click picking with wider / narrower / rename / remove, adding a field by clicking, Escape, two-example fallback |
| `selectors.spec.ts` | Selector tester (CSS, XPath, attributes, scalars, errors), multi-field mixed CSS / XPath rule, column-mode warning, invalid selector blocks extraction |
| `pagination.spec.ts` | Next links over real page loads, page limit, record limit, single-page app, page numbers, custom selector with no match; infinite scroll to the end, record limit, scroll limit, Stop on the page |
| `content.spec.ts` | Links and filters, images (lazy, `srcset`, `<picture>`), lists / headings / breadcrumbs / metadata / JSON-LD / microdata together |
| `data.spec.ts` | Edit / undo / redo / restore, sort / search / filter, find & replace, number extraction, split, case, remove rows / columns, duplicates, rename / reorder, keyboard editing |
| `app.spec.ts` | Save / reopen / rename / export / delete / import a project, recipes (save, offer on matching page, run, delete, pagination pre-fill), onboarding, no page connected, restricted pages, no host permission, settings persistence + theme, popup hand-over, page scripts cannot message the extension |
| `manifest.spec.ts` | Production manifest (permissions, CSP, store limits) and bundles free of network / eval APIs |
| `production.spec.ts` | Production build with real toolbar clicks (below) |
| `smoke.spec.ts` | The extension loads and connects |

### Testing the real permission model

In production Rowlio has no host permissions: it can read a page only after the user
invokes it there. Playwright cannot click the browser toolbar, so most suites use a
separate build, `dist-e2e/`, that differs from production in exactly three ways:

1. `host_permissions` for `http://127.0.0.1/*` and `http://localhost/*`;
2. the in-page shadow root is `open`, so tests can operate the visual selector;
3. the popup accepts `?tab=<id>` so it can be opened as a normal page.

To prove the shipped build works, `production.spec.ts` loads `dist/` itself and clicks
the real toolbar action through the DevTools protocol (`Extensions.triggerAction`). It
verifies that:

- before the click, `chrome.scripting.executeScript` is refused ("Cannot access contents
  of the page") and nothing is injected;
- after the click the popup opens and the workspace can list and extract tables;
- access persists on the same site and the workspace reconnects after navigation;
- access is withdrawn on another site, and the workspace says so without offering the
  old site;
- three-page pagination works with click-granted access only;
- the in-page overlay's shadow root is closed (`shadowRoot === null` from the page).

### Independent checks of exported files

Besides the automated round trip through `read-excel-file`, a workbook produced by
Rowlio (Bengali, emoji, typed numbers and dates, formula-like text, leading zeros,
a 3,000-row second sheet) was opened with **openpyxl 3.1.5** and **LibreOffice Calc**.
Both read every value correctly, with formula-like text as plain text.

## Not covered by automated tests

Be aware of these gaps:

- **Live third-party websites.** All tests use the local fixture site. Real sites vary
  enormously; expect to adjust selectors or use Wider / Narrower on some.
- **Microsoft Excel and Google Sheets** have not opened the exported files (openpyxl,
  LibreOffice and read-excel-file have).
- **Keyboard shortcut commands** (`Alt+Shift+R / W / S`): Chrome provides no way to
  trigger them from automation. The handler is a few lines in `src/background/index.ts`.
- **Granting permanent site access**: needs Chrome's own permission prompt, which
  automation cannot answer. The surrounding logic (listing, the "no access" states) is
  covered.
- **Column resize and header drag-and-drop** by mouse (their menu equivalents are tested).
- **Accessibility**: no automated audit (axe) or screen-reader pass yet.
- **Other browsers and platforms**: tested on Chromium 153 on Linux, headless only.
- **Datasets beyond ~100,000 rows** in the UI, and memory behaviour on low-end machines.
- **`file://` pages**, PDF viewer pages, and pages inside frames.

## Manual test checklist before a release

1. `npm run verify` passes.
2. Load `dist/` unpacked in the current stable Chrome. The introduction appears once.
3. On a real site with a table: click the icon → Extract tables → export CSV and XLSX →
   open both in Excel.
4. On a real listing page: Select items on the page → Use records → Extract → save as
   recipe → reload the page → the recipe is offered on Home.
5. Pagination on a real multi-page listing with a limit of 3 pages; press Stop mid-run on
   another attempt.
6. Infinite scroll on a real feed with a limit of 10 scrolls.
7. Press `Alt+Shift+W` and `Alt+Shift+S` on a page.
8. Open `chrome://extensions` and click the icon: the popup explains the page cannot be
   read.
9. Settings → Delete all saved data, then confirm Projects and Recipes are empty.
10. Check the extension's service worker console and the workspace console for errors.
