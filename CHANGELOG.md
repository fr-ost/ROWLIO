# Changelog

All notable changes to Rowlio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

## [1.1.0] – Unreleased

Not yet published to the Chrome Web Store.

### Added

- **Batch URLs**: run one extraction (current rule, a recipe, tables, metadata, JSON-LD,
  contacts, links or images) over a list of addresses you paste or take from a URL column.
  Bounded, paced and stoppable; failed pages are logged and skipped; every row records
  its source URL.
- **Contacts extraction**: email addresses, phone numbers and social profile links.
- **File import**: CSV, TSV, JSON and JSON Lines files open in the Data Preview.
- **New data tools**: extract by pattern (regex), fill down, add column, add row, and a
  per-column summary (counts, top values, numeric statistics).
- **Markdown and HTML table export**, and "Copy as Markdown table".
- **Redesigned interface**: new visual identity with the Inter typeface (bundled),
  gradient accents, glass surfaces, animated entrances, counters, progress and toasts, a
  new Home screen that shows what the page contains, and a redesigned popup and in-page
  panel.
- **Sound effects**, synthesised in the browser. Sound and animations each have a switch
  in Settings; the system "reduce motion" preference is respected.
- **Credits and copyright**: "© 2026 Unique Labs. A Product of Unique Labs. Developed by
  Shahriar Ahmed." with links, in the workspace, the popup and Help & About.
- **Marketing website** in `website/`, built by `scripts/website.mjs` and deployable to
  Vercel from the repository root (`vercel.json`).
- 26 new unit tests and 12 new end-to-end tests.

### Changed

- `homepage_url` in the manifest now points to the Unique Labs website.
- The interface typeface is Inter instead of the system font.

### Security and privacy

- No new permissions. Batch runs use the access you already gave: addresses on other
  sites are skipped unless you granted access to that site, and only `http` / `https`
  addresses are ever opened.
- Still no network requests, analytics or remote code. The font is bundled, sounds are
  generated locally, and the two credit links open only when clicked.
- The HTML export escapes all cell text and applies the same formula-injection guard as
  CSV, because spreadsheet applications open HTML tables too.
- The build check now also asserts that pages and stylesheets reference no remote
  resources.

## [1.0.0] – Unreleased

First release candidate. Not yet published to the Chrome Web Store.

### Added

- **Table extraction**: multiple tables, multi-row headers, `rowspan` / `colspan`, nested
  tables, hidden rows and columns (optional), captions, ARIA grids, open shadow DOM,
  same-origin frames, dynamically rendered tables, large tables in time slices.
- **Visual selector**: in-page point-and-click selection of repeated records with
  automatic field detection, wider / narrower, add field by clicking, two-example
  fallback, single-element picking.
- **Field detection** for titles, prices, dates, ratings, review counts, images, links,
  authors, categories, tags, emails, phones, addresses, product ids, availability.
- **Advanced selectors**: CSS and XPath tester and multi-field rule editor with live
  validation, match counts, samples and highlighting.
- **Links, images, lists, headings, breadcrumbs, metadata, JSON-LD and microdata**
  extraction.
- **Pagination** (next links / buttons, page numbers, custom selector; full page loads and
  single-page apps) and **bounded infinite scroll**, with limits, progress, retries,
  duplicate handling, loop protection and Stop.
- **Data preview**: virtualised grid with editing, sorting, search, filters, column
  resize / reorder / rename, selection, duplicate and empty-value detection, type
  detection.
- **Cleaning tools** with undo / redo and restore-original.
- **Export** to CSV, TSV, JSON, JSON Lines, XLSX and the clipboard, with
  formula-injection protection and UTF-8 throughout.
- **Projects** (local IndexedDB storage, folders, search, import / export) and reusable
  **recipes** with URL patterns.
- Workspace with ten sections, toolbar popup, first-run introduction, light / dark theme,
  keyboard shortcuts.
- Documentation, 862 unit tests and 52 end-to-end tests, including a suite that drives
  the production build through real toolbar clicks.

### Security and privacy

- Install-time permissions limited to `activeTab` and `scripting`; no host permissions;
  content script injected on demand.
- Extension pages cannot make remote connections (`connect-src 'self'`).
- No analytics, telemetry, accounts or remote code.

### Known limitations

See "Limitations" in the README and "Not covered by automated tests" in
[docs/TESTING.md](docs/TESTING.md).
