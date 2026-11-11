# Changelog

All notable changes to Rowlio are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/).

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
