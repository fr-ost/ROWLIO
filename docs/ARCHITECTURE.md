# Architecture

Rowlio is a Manifest V3 Chrome extension with no backend. This document explains how the
pieces fit, why they are shaped the way they are, and where to extend them.

## Contexts and responsibilities

```
┌──────────────────────────── Chrome ─────────────────────────────┐
│                                                                 │
│  Web page (any site)                 Extension pages            │
│  ┌──────────────────────┐            ┌────────────────────────┐ │
│  │ content.js           │◄──────────►│ Workspace  (app.html)  │ │
│  │  injected on demand  │  messages  │  orchestrates all work │ │
│  │  • extraction engine │  + ports   │  • stores (zustand)    │ │
│  │  • visual selector   │            │  • data grid, cleaning │ │
│  │  • pagination helpers│◄──────────►│  • export, projects    │ │
│  │  • progress HUD      │            ├────────────────────────┤ │
│  └──────────────────────┘            │ Popup  (popup.html)    │ │
│                                      │  page summary, shortcuts│ │
│  Service worker (background.js)      └───────────┬────────────┘ │
│   • opens / focuses the workspace ◄──────────────┘              │
│   • keyboard shortcuts                 Data worker (Web Worker) │
│   • nothing else, no state             • heavy transforms/export│
└─────────────────────────────────────────────────────────────────┘
        Storage: IndexedDB (projects, datasets, recipes, settings)
```

| Context | Entry | Role |
|---|---|---|
| Content script | `src/content/index.ts` | Runs in the page. Answers requests, runs extraction jobs, hosts the visual selector and the progress indicator. Classic IIFE, no framework. |
| Workspace | `src/app/main.tsx` | The application. Decides what to run, receives results, owns all user data in memory. |
| Popup | `src/popup/main.tsx` | Quick entry point: scans the page, hands an "intent" to the workspace. |
| Service worker | `src/background/index.ts` | Opens or re-binds the workspace tab; handles `commands`. Stateless by design, so MV3 suspension is harmless. |
| Data worker | `src/workers/data.worker.ts` | Runs transformations and exports off the UI thread for datasets ≥ 100,000 cells. |

### Why the workspace orchestrates (and not the service worker)

MV3 service workers are suspended after about 30 seconds of inactivity. Pagination runs,
large extractions and exports take longer and hold megabytes of data. The workspace is a
normal, long-lived page, so it is the natural owner of long-running work and of the data.
The service worker needs no state and no keep-alive tricks.

### Why the content script is injected on demand

Declaring `content_scripts` for all sites would require host permissions for every site
and would run Rowlio's code on every page the user visits. Instead the manifest declares
none; `chrome.scripting.executeScript` injects `content.js` into exactly one tab, after
the user invoked Rowlio there (`activeTab`). See [PERMISSIONS.md](PERMISSIONS.md).

## Source layout

```
brand.config.json        Single source of product identity
scripts/                 build.mjs, licenses.mjs, package.mjs, generate-icons.mjs
src/
  config/brand.ts        Typed access to brand.config.json, version, E2E flag
  types/                 Shared contracts (data, extraction, recipes, settings,
                         transforms) and runtime guards for untrusted input
  utils/                 async (yield, pacing, cancellation), text, url, css, id
  i18n/                  t() / tn() gettext-style localisation layer
  extraction/            DOM-only extraction engine (no chrome.* APIs)
    dom.ts               text extraction, visibility, shadow roots / frames
    tables.ts            table grid builder (spans, headers, hidden, nested, ARIA)
    selectors.ts         CSS / XPath evaluation, validation, rule extraction
    generate.ts          selector generation, class quality, similarity
    patterns.ts          repeated-element detection, record groups
    fields.ts            field detection inside records
    valueTypes.ts        value classification (price, date, rating …)
    links.ts images.ts lists.ts metadata.ts structured.ts
    engine.ts            runSpec(), scanPage(), contentSignature()
  pagination/
    nextControl.ts       find / activate the next-page control   (page side)
    settle.ts            wait for DOM quiet / content change      (page side)
    scroll.ts            bounded scroll loop over a ScrollEnv
    accumulator.ts       merging pages / scroll steps, duplicate handling
    runner.ts            pagination loop over a PageTransport     (workspace side)
  content/               message router, job streaming, overlay, picker, styles
  messaging/             protocol.ts (the contract), tabClient.ts (inject, request, jobs)
  background/            service worker
  data-processing/       dataset building, type inference, transforms, view (filter/sort)
  export/                csv, json, xlsx (own writer), formula guard, filenames
  storage/               IndexedDB: db, projects, recipes, settings
  workers/               data worker + main-thread client
  app/                   workspace: stores, services, components, pages
  popup/                 popup UI
  styles/app.css         Tailwind entry and theme tokens
tests/
  unit/                  Vitest + jsdom
  e2e/                   Playwright against the built extension, fixture site
docs/
```

## Module boundaries

The dependency direction is strict, which is what keeps the engine reusable:

```
types, utils, i18n, config
        ▲
extraction, pagination (page side)        data-processing, export, storage
        ▲                                             ▲
     content  ──── messaging/protocol ────►  messaging/tabClient
                                                      ▲
                                          app (stores → services → pages), popup
```

- `extraction/` and the page-side parts of `pagination/` touch only the DOM. They run
  unchanged in the content script and in jsdom unit tests, and could run in a Firefox
  content script or a standalone web app.
- `data-processing/`, `export/` are pure functions over plain data; they run on the main
  thread or in the worker.
- Only `content/`, `messaging/`, `background/`, `app/` and `popup/` use `chrome.*`.

## The message protocol (`src/messaging/protocol.ts`)

Three channels, all typed in one file so both sides stay in sync:

1. **Requests** — `chrome.tabs.sendMessage(tabId, { rowlio: 1, type, payload })` →
   `{ ok: true, data } | { ok: false, error }`. Short operations: `ping`, `scan`,
   `tables:list`, `selector:test`, `rule:preview`, `patterns:detect`, `picker:start`,
   `pagination:advance`, `page:settle`, `hud:show` …
2. **Jobs** — `chrome.tabs.connect(tabId, { name: 'rowlio-job' })`. Anything that returns
   a dataset. The content script streams `progress`, `dataset` headers, `rows` chunks
   (~20,000 cells per message), then `done` or `error`. Closing the port or sending
   `cancel` aborts the work in the page. Two job kinds: `extract` and `scroll`.
3. **Events** — `chrome.runtime.sendMessage({ rowlio: 1, event, payload })` from the page:
   `picker:done`, `picker:element`, `picker:cancelled`, `tables:changed`, `hud:stop`,
   `hud:back`.

Every receiver validates the sender (`sender.id === chrome.runtime.id`; events must come
from the connected tab; bind requests must not come from a tab) and the payload shape
(`src/types/guards.ts`). See [SECURITY.md](SECURITY.md).

## Data model

```ts
ExtractSpec        // what to extract: tables | rule | links | images | lists | …
  → RawDataset     // what the page returns: { key, name, columns: string[], rows: string[][], warnings }
  → Dataset        // workspace form: column ids, row ids, source info
  → TableData      // { columns, rows } – what transformations operate on
```

- A **rule** (`ExtractionRule`) is a row selector plus `FieldRule`s (selector, CSS/XPath,
  what to read, optional "join all matches"). The visual selector, the auto-detector and
  the Advanced Selectors editor all produce the same structure.
- A **recipe** is `{ name, description, urlPattern, spec: ExtractSpec, pagination }`.
- **Transformations** are serialisable `TransformOp` descriptions applied by a pure
  `applyTransform(data, op)`. Unchanged rows keep their identity, so the undo history
  shares memory between states.
- **Warnings** travel with every dataset from the engine to the UI. Anything unusual
  (hidden rows skipped, ragged rows, mismatched field counts, duplicates skipped) becomes
  a visible warning rather than silent data loss.

## Key algorithms

**Table grid.** Rows are laid into a grid cell by cell; `rowspan` / `colspan` (clamped
to the row group, `rowspan=0` supported) fill covered slots. Hidden rows stay in the grid
so their spans keep later rows aligned and are filtered afterwards. Header rows are the
`<thead>` rows or leading all-`<th>` rows; multi-row headers are merged per column
("2024 - H1").

**Repeated elements.** For each parent with ≥ 3 children, the most common
(tag + class signature) picks a representative; similar siblings form a group. Groups
are scored by size × content richness, penalised inside navigation, boosted by on-screen
area. For a click, Rowlio walks up to the lowest repeating ancestor; a level of
single-value leaves (cells) is skipped in favour of the enclosing level when every
enclosing record holds the same number of them (cells of a row vs. items of a list).

**Field detection.** Candidates (text-bearing elements, links, images, `<time>`,
rating labels, microdata) are collected in a sample of records, keyed by a position-free
relative selector, kept when present in ≥ 2 records, split per position for fixed-width
siblings or joined for variable-length groups, then classified from values and markup
hints. No field is assumed to exist.

**Pagination.** The runner (workspace) loops: make the page ready → extract → merge →
check limits → ask the page to find and activate "next" → wait for either an in-place
content change (signature of the targeted records) or a navigation → repeat. Stop
reasons are explicit (`max-pages`, `max-records`, `no-next`, `next-disabled`, `no-change`,
`no-new-records`, `cancelled`, `error`).

**Infinite scroll.** A loop in the page over a `ScrollEnv` (extract, scroll one step,
wait for content, optional "load more"), bounded by scrolls, records and time. The
accumulator's scroll mode only adds a row when a step shows more copies of it than were
already emitted, so re-reading a growing page never duplicates and virtualised lists
that drop old rows are still collected.

## Performance

- Long loops call `Pacer.tick()`, which yields roughly every 24 ms via
  `scheduler.yield` / `MessageChannel` — not timers, which Chrome throttles to 1/s in
  background tabs (the page being read is usually behind the workspace).
- Results cross the process boundary in chunks.
- The data grid renders only visible rows (fixed row height, overscan 8) and scales the
  scroll range for datasets taller than the browser's maximum element height.
- Transformations and exports of ≥ 100,000 cells run in the data worker; CSV / JSONL are
  produced as chunk lists and turned into a `Blob` without one giant string.
- Scroll extraction caches rows by element and content signature, so each step only
  reads new or changed records.

## Extension points (planned features)

| Future feature | Where it plugs in |
|---|---|
| Scheduled, user-controlled extraction | `chrome.alarms` + a recipe run: `runRecipe()` already separates "what" (spec) from "when". Needs the `alarms` permission and persistent site access. |
| Multiple tabs / batch URLs | `PageTransport` is the only thing `runPagination` knows about a tab; a batch runner is another loop over transports. |
| Visual template builder | Rules are plain data (`ExtractionRule`); a builder is another editor for the same structure. |
| Transformation workflows | `TransformOp` is serialisable; store and replay arrays of ops. |
| More export formats | Add a writer in `src/export/`, a case in `buildExport`, a label in `FORMAT_LABELS`. |
| Local OCR, page snapshots | New `ExtractSpec` kinds handled in `engine.runSpec`. |
| Firefox | The engine is DOM-only; `messaging/` and `background/` would need the `browser.*` equivalents and a second manifest target in `scripts/build.mjs`. |
| Standalone web / desktop app | `extraction/`, `data-processing/`, `export/`, `storage/` and the React UI have no extension dependency; replace `tabClient` with a transport over an iframe or webview. |
| Translations | `registerCatalog(locale, { 'English text': '…' })` in `src/i18n`; add `_locales/<lang>` generation in `scripts/build.mjs`. |

## Decisions worth knowing

- **Own XLSX writer** (`src/export/xlsx.ts`, ~600 lines on `fflate`). The common
  libraries are either large, unmaintained on npm, or both. Writing inline-string cells
  also makes formula injection structurally impossible.
- **No schema library.** Hand-written guards keep the content script small (≈ 99 KB) and
  avoid shipping a validator into every page Rowlio is invoked on.
- **Closed shadow root** for everything drawn on the page; handlers require
  `event.isTrusted`.
- **No automatic persistence of extracted data.** Page content is written to disk only
  when the user saves a project.
- **Settings in IndexedDB**, not `chrome.storage`, which avoids the `storage` permission.
