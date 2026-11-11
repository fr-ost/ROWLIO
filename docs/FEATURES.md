# Features

Status legend: **Tested** = covered by automated tests (unit, end-to-end in real
Chromium, or both). **Implemented** = working code, exercised manually or indirectly, but
without a dedicated automated test. Nothing listed here is a mock-up.

## Extraction

### Tables — Tested

- Detects every `<table>`, plus ARIA grids (`role="table" | "grid" | "treegrid"`).
- Looks inside open shadow roots and same-origin iframes.
- Preview of each table (first rows, row and column counts) before extracting.
- Header detection: `<thead>`, or leading rows made only of `<th>`; choose *Auto*,
  *First row* or *None*. Multi-row headers are merged per column (`2024 - H1`).
- `rowspan` and `colspan` (including `rowspan="0"`), clamped to the row group. Option to
  repeat merged values or leave covered cells empty.
- Nested tables: flattened into the parent cell *and* listed as their own table, with a
  warning on the parent.
- Empty cells preserved. Ragged rows padded, with a warning.
- Hidden rows, columns and inline content skipped by default and **counted in a warning**;
  one switch includes them.
- Table names from `<caption>`, `aria-label`, `aria-labelledby` or a preceding heading.
- Dynamic tables: the Tables screen watches the page and refreshes when tables appear or
  change.
- Layout / single-cell tables are hidden by default but one click shows them.
- Extract one, several or all tables; "Show on page" scrolls to and outlines a table.
- Large tables are processed in time slices (20,000 rows verified end to end).

### Visual selector — Tested

- In-page panel (closed shadow root) with hover highlighting.
- Click one element → the repeating records around it are found and outlined.
- **Wider / Narrower** move between repeating levels; **Re-pick** starts again.
- Fields are detected automatically; rename, reorder, remove, change what is read
  (text / link URL / image URL / HTML), or **add a field by clicking** inside a record.
- Hovering a field highlights its matches on the page.
- Manual fallback: when nothing repeats around the click, click a second example and
  Rowlio generalises from the two, or use the single element.
- Also used as a single-element picker for containers, next-page buttons, scroll areas.
- Auto-detect list on the Visual Selector screen ranks repeating structures on the page.

### Intelligent field detection — Tested

Recognised types: title, heading, description, text, price, date, author, category, tags,
rating, review count, image URL, link, email, phone, address, product id, availability,
number. Signals used: tag semantics (`h1–h6`, `time`, `address`, `img`, `a`), class / id /
`itemprop` / `data-*` names, ARIA labels, Schema.org `itemprop`, and value patterns
(currencies including ৳ and Bengali digits, dates, ratings, review counts). Fields that are
absent in a record are left empty — nothing is invented. All local; no AI service.

### CSS selectors and XPath — Tested

- Tester: validate, count, preview up to ten matches (tag, text, value, HTML shown as
  text, attributes), highlight on the page.
- XPath node sets, attribute nodes (`//a/@href`), text nodes, and scalar results
  (`count(…)`, `string(…)`).
- Rules: optional row selector + any number of fields, each CSS or XPath, reading text,
  HTML, link URL, image source or any attribute; "join all matches in a row".
- Live per-field match counts ("7 of 9 rows"), sample values and error messages.
- Column mode (no row selector) with a warning when fields match different counts.
- Save as recipe; extract across pages.

### Links — Tested

All / internal / external; inside a container; text contains; matching a CSS selector;
optional de-duplication. Columns: link text, absolute URL, relative URL (the original
`href`), title, target, rel, type. Relative URLs are resolved against the page (honours
`<base href>`).

### Images — Tested

`<img>`, `srcset`, `<picture>/<source>`, lazy-loading attributes (`data-src`,
`data-original`, `data-lazy-src`, `data-srcset` …), video posters, image inputs, and
optionally CSS background images. Columns: image URL, alt text, title, width, height,
source element, loading attribute, other candidate sources. Filters: container, URL
contains, minimum width / height, de-duplication. Rowlio lists addresses; it does not
download or fetch images.

### Lists, headings, breadcrumbs, metadata, structured data — Tested

- Ordered, unordered (with nesting level) and definition lists.
- Headings `h1–h6` and ARIA headings with anchor URLs.
- Breadcrumbs from markup and from JSON-LD `BreadcrumbList`.
- Page title, description, canonical URL, language, charset, robots; Open Graph; Twitter
  Cards; other meta tags; informative link tags.
- JSON-LD (multiple blocks, arrays, `@graph`), flattened to columns; invalid blocks are
  reported.
- Schema.org microdata with nested items.

### Contacts — Tested

Email addresses (from `mailto:` links and from visible text), phone numbers (from `tel:`
links and from text in international or grouped formats, including Bengali digits) and
social profile links (Facebook, X / Twitter, LinkedIn, Instagram, YouTube, TikTok,
GitHub, Telegram, WhatsApp, Pinterest, Threads, Discord). Columns: type, value, label,
where it was found, URL. "Share this" buttons and bare network homepages are ignored, and
duplicates are merged. Only what the page already shows or links to is collected; nothing
is looked up elsewhere.

### Pagination — Tested

- Next-page **links and buttons** (text in ~30 languages, `rel="next"`, ARIA labels,
  class names), **page-number** navigation, `<link rel="next">`, or a **user-defined CSS
  selector** (typed or picked on the page).
- Works with full page loads and with single-page apps that swap content in place.
- Limits: maximum pages, maximum records, delay between pages, retries per page.
- Start / Stop (in the workspace and on the page), progress, current page, activity log.
- Duplicate detection (optional skipping), and loop protection: a "next" that returns the
  same records stops the run.
- Every run ends with an explicit reason.

### Infinite scroll — Tested

- Bounded by maximum scrolls, maximum records and a time limit.
- Scrolls the page or a scrolling container (auto-detected or chosen); optional
  "Load more" button.
- Collects while scrolling, so virtualised lists that remove earlier items are supported.
- Stop at any time and keep what was collected; scroll position is restored.
- When scrolling stops producing content, the run ends and says so.

### Batch URLs — Tested

- Run one extraction over a **list of page addresses you supply**: paste them, or take
  them from a URL column of data that is already open (for example product links you just
  extracted).
- What runs on each page: the current rule, a saved recipe, all tables, metadata,
  JSON-LD, contacts, links or images.
- Invalid lines and duplicates are counted and left out before the run starts.
- Bounded and paced: a maximum number of pages (default 50) and a delay between pages.
  Start / Stop in the workspace and on the page, progress and a per-page log.
- A page that fails (or has no records) is logged and the run carries on.
- Every row gets a **Source URL** column.
- The pages are opened one after another in the connected tab, visibly. Addresses on a
  different site than the one you invoked Rowlio on are **skipped with a reason** unless
  you have granted access to that site, because leaving the site would withdraw Chrome's
  click-granted access.

This is a bounded list runner, not a crawler: it never discovers or follows links on its
own.

## Data preview — Tested

- Virtualised grid: only visible rows are in the DOM.
- Column resize (drag the edge; double-click resets), reorder (drag the header, or
  *Move left / right*), rename (double-click or menu).
- Row selection (click, Shift-click range, select all) and column selection.
- Cell editing (double-click, Enter or F2; Enter commits, Esc cancels, Tab moves on).
- Keyboard navigation: arrows, Page Up / Down, Home / End, Space selects the row.
- Sort (numeric-aware, empty values last), global search, per-column filters (contains,
  equals, starts / ends with, empty, not empty, regex and negations).
- Remove selected rows / columns. Duplicate rows counted, shown and removable. Empty
  cells counted. Column type shown (text, number, date, URL, email, yes/no, mixed).
- Record count, column count, extraction warnings.
- Several datasets open as tabs.

*Column resize by dragging and header drag-and-drop are implemented but only their menu
equivalents are covered by automated tests.*

### Cleaning — Tested

Trim whitespace · normalise whitespace · remove empty rows / columns · remove duplicate
rows · UPPER / lower / Title / Sentence case · extract numbers (understands `1,234.56`,
`1.234,56`, Bengali and other Unicode digits) · parse dates when unambiguous (ambiguous
ones such as `03/04/2024` are left untouched and counted) · normalise URLs · find and
replace (text or regex, per column or everywhere) · split a column by a delimiter ·
combine columns · keep rows where a column is empty / not empty · first row ⇄ header ·
**extract by pattern** (a regular expression; the first capture group or the whole match,
into the same column or a new one) · **fill down** (empty cells take the value above) ·
**add column** (empty, row numbers or a fixed value) · **add row**.

**Column summary**: filled / empty / distinct counts, shortest and longest value, the
most frequent values, and for numeric columns sum, average, median, minimum and maximum.

Every operation reports what it actually changed. **Undo / redo** (50 steps) and
**Restore original** are always available; the extracted data is never overwritten.

## Export — Tested

| Format | Notes |
|---|---|
| CSV | RFC 4180 quoting; comma or semicolon; optional UTF-8 BOM for Excel |
| TSV | Tab-separated with the same quoting rules |
| JSON | Array of objects, key order = column order, optional pretty-print |
| JSON Lines | One object per line |
| XLSX | One sheet per dataset; bold frozen header, auto-filter, column widths; optional typed numbers and ISO dates |
| Markdown | GitHub-style table; pipes, markup and line breaks in cells are escaped |
| HTML | A self-contained page with one table; cell text is escaped, no scripts, no remote assets |
| Clipboard | TSV (paste into Excel / Sheets), CSV, JSON or a Markdown table |

- Export all rows, the filtered rows, or the selected rows; one dataset or all open ones.
- Real progress (rows written) for large exports, which run in a Web Worker.
- **Formula-injection protection**: in CSV, TSV, HTML and clipboard (TSV / CSV) output,
  cells starting with `=`, `+`, `-`, `@`, tab or carriage return get a leading apostrophe
  (plain numbers such as `-12.5` are left alone). HTML is included because spreadsheet
  applications open HTML tables as well. In XLSX, text is always stored as text.
- Format limits are reported, not silently applied (for example Excel's 32,767 characters
  per cell and 1,048,576 rows per sheet).
- Unicode verified end to end with Bengali text and emoji.

## Import — Tested

Open a file from your computer in the Data Preview: CSV and TSV (delimiter detected among
comma, semicolon, tab and pipe; quoted fields, embedded line breaks, optional BOM), JSON
(an array of objects, an array of arrays, or an object holding one), JSON Lines, and
Rowlio project files. The file is read by the browser and is not uploaded anywhere.
Excel (`.xlsx`) files are not supported.

## Projects and recipes — Tested

- Save the open datasets as a project (IndexedDB), with name, folder and notes.
- Search, filter by folder, open, rename / move, duplicate, delete (with confirmation).
- Export a project as XLSX / CSV / JSON, or as a portable project file; import project
  files.
- Recipes store name, description, URL pattern, extraction method, selectors / XPath,
  field definitions, options and pagination settings — never page content.
- Recipes matching the connected page are offered on Home; run, edit, export, import,
  delete. A recipe with pagination opens the Pagination screen pre-filled; you still press
  Start.

## Interface

- Workspace sections: Home / Extract, Tables, Visual Selector, Advanced Selectors,
  Pagination, Batch URLs, Data Preview, Projects, Saved Recipes, Settings, Help & About.
- Home shows what the connected page contains (tables, repeating lists, links, images,
  headings, structured data) as live counters. — Tested
- Popup: current site, counts (tables, lists, links, images), quick actions, open
  workspace. — Tested
- First-run introduction (five steps, skippable, replayable). — Tested
- Light / dark / system theme; sidebar collapses on narrow windows. — Tested (theme)
- **Motion**: page and card entrances, drifting colour fields, pointer spotlights,
  counting numbers, animated progress and toasts. One switch turns all of it off, and
  `prefers-reduced-motion` always wins. — Tested (the switch and its persistence)
- **Sound effects**: short tones for clicks, navigation, success, completion, warnings
  and errors, synthesised with the Web Audio API (no audio files). One switch turns them
  off. — Implemented; the switch is tested, the audio output itself is not (headless
  browsers have no audible output to assert on)
- **Credits**: "A Product of Unique Labs. Developed by Shahriar Ahmed." with links, in the
  sidebar, the popup and Help & About. — Tested
- Empty states and actionable error messages on every screen.
- Keyboard shortcuts `Alt+Shift+R / W / S`. — Implemented (Chrome offers no way to
  trigger extension commands from automated tests)

## Accessibility

Semantic landmarks and headings, labelled controls, visible focus rings, a skip link,
`aria-live` status and alert regions, native `<dialog>` modals (focus trapping, Esc),
keyboard-operable menus (arrows, Home / End, Esc), grid roles on the data viewer, and
`prefers-reduced-motion` support. Tests locate controls by role and label, which keeps
names honest, **but no formal audit (for example with axe or a screen reader) has been
performed yet.**

## Internationalisation

All interface strings go through `t()` (`src/i18n`), with the English text as the key, so
translations can be added as catalogs without touching components. Extension name and
description use Chrome's `_locales`. **Only English is shipped.** Data handling is
Unicode-safe throughout.

## Not implemented

These are deliberately out of the first release. The architecture leaves room for them
(see [ARCHITECTURE.md](ARCHITECTURE.md)).

- Scheduled extraction, extraction across several tabs at once.
- Batch URL lists that span several sites in one run without granting access to each.
- Local OCR, PDF parsing, page snapshots.
- Downloading image files (only their addresses are extracted).
- RDFa structured data (JSON-LD and microdata are supported).
- Importing Excel (`.xlsx`) files (CSV, TSV, JSON and JSON Lines can be imported).
- A Chrome side panel version of the workspace.
- Column virtualisation in the data grid (rows are virtualised; hundreds of columns will
  render slowly).
- Firefox, standalone web app, desktop app.
- Translations other than English.

## Deliberately excluded

CAPTCHA solving, paywall or login bypass, anti-bot evasion, proxy rotation, fingerprint
spoofing, credential extraction, hidden-API abuse, background or uncontrolled crawling,
analytics, accounts, cloud sync, AI services.
