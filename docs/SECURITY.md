# Security

## Reporting a vulnerability

Please report security issues privately to Unique Labs rather than in a public issue.
*(A contact address must be added here and in `brand.config.json` → `urls.support` before
public release.)* Include the Rowlio version, Chrome version, and steps to reproduce.

## Threat model

Rowlio processes **untrusted content**: any web page, including one written specifically
to attack a scraping tool or the person using it. The assets to protect are the user's
other tabs and data, the extension's privileged APIs, and the files Rowlio produces.

| Threat | Mitigation |
|---|---|
| **A page tries to run script in the extension (XSS).** | Page content is never interpreted as HTML by Rowlio. In the workspace everything is rendered by React as text; "HTML" previews are shown inside `<pre>` as text. The in-page UI sets `textContent` only. There is no `innerHTML`, `dangerouslySetInnerHTML`, `eval` or `new Function` on page data. The extension CSP (`script-src 'self'`, no inline scripts) would block injected script regardless. |
| **Exported files attack whoever opens them (CSV / formula injection).** | CSV, TSV, HTML and clipboard (TSV / CSV) output neutralise cells that begin with `=`, `+`, `-`, `@`, tab, carriage return or line feed (and full-width variants) by prefixing an apostrophe, following OWASP guidance; plain signed numbers are exempt so data is not mangled. XLSX writes all text as inline strings, never as formulas. Covered by unit and end-to-end tests. The protection can be switched off per export for machine consumers. |
| **A page sends messages to the extension.** | No `externally_connectable`, so pages cannot message it at all. Internally, every listener checks `sender.id === chrome.runtime.id`. The workspace accepts page events only from the tab it is connected to; "bind to this tab" only from a non-tab context (the service worker); the service worker accepts "open workspace" only from extension pages. |
| **A page manipulates Rowlio's in-page UI** (fakes a click on "Use these records", reads field names, restyles the panel). | The UI lives in a **closed shadow root**; page scripts cannot obtain a reference to its contents and page CSS does not apply. Handlers ignore events with `isTrusted === false`. The content script runs in Chrome's isolated world, so page scripts cannot touch its variables or prototypes. |
| **Malformed or hostile messages / files** (crafted recipe or project files, tampered storage). | Runtime guards (`src/types/guards.ts`) validate every extraction request in the content script and every imported recipe / project (types, enums, lengths, numeric ranges). Invalid recipes are skipped and counted; invalid project files are rejected with a message. Imported items get fresh ids, so they cannot overwrite existing data. |
| **Invalid or expensive selectors.** | CSS and XPath are syntax-checked before use and failures are reported as messages. Selector length is capped; field counts are capped. |
| **Unsafe URLs** (`javascript:`, `data:`). | Extracted URLs are data. Rowlio never fetches them and does not render them as clickable links. It navigates the connected tab in two cases only, both started by the user: activating the page's own next-page control, and opening the addresses of a **Batch URLs** list. Batch addresses are parsed with the URL parser and only `http:` / `https:` ones are accepted, both when the list is prepared and again immediately before navigating; anything else is counted as invalid and never opened. |
| **A batch run wanders onto other sites or runs away.** | The list is finite and supplied by the user; a maximum page count and a delay apply; Stop works from the workspace and the page. Rowlio never discovers links to visit by itself. An address on a different origin than the connected page is skipped unless the user has granted access to that origin, so a list cannot carry the tab (and the click-granted access) somewhere unexpected. Verified on the production build. |
| **Imported files** (CSV, TSV, JSON, JSON Lines). | Parsed as data by Rowlio's own parsers (`JSON.parse` for JSON; no evaluation). Cell values are rendered as text like any extracted data. Project files go through the same guards as before. |
| **Exported HTML and Markdown.** | Cell text is escaped (`&`, `<`, `>`, `"`; pipes and line breaks in Markdown), so page content cannot become markup or script in the exported file. The HTML file contains no scripts and no remote references. Because spreadsheet applications open HTML tables, the formula guard applies to HTML too. |
| **External links in the interface.** | Exactly two, both fixed in `brand.config.json` (company site and developer profile), rendered with `target="_blank" rel="noopener noreferrer"`. They are not built from page content. |
| **Remote code / supply chain at runtime.** | No remote scripts, styles, fonts, images or audio. Everything is bundled (the Inter typeface is a local file; sound effects are synthesised with the Web Audio API). CSP forbids remote sources. An automated test scans the built scripts for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval`, `new Function`, `importScripts`, and the built pages and stylesheets for remote `src` / `href` / `url()` / `@import`. |
| **Data exfiltration by the extension itself.** | `connect-src 'self'` makes the browser block any connection from extension pages to a remote server. The content script contains no network code. |
| **Over-broad access.** | `activeTab` + `scripting` only; no standing host access; content script injected into one tab on demand. See [PERMISSIONS.md](PERMISSIONS.md). |
| **Runaway automation** (endless pagination or scrolling). | Every run requires finite limits (validated: pages ≥ 1, scrolls ≥ 1, duration ≥ 1 s), has loop detection (same records twice, no new records, no change after "next"), and can be stopped from the workspace or the page. |
| **Sensitive form values.** | Text extraction (tables, fields, lists) never reads password, hidden or file inputs. A value is only read from another kind of form control when it is part of the content the user chose to extract. |
| **Denial of service by huge pages.** | Work is time-sliced and cancellable; results are streamed in chunks; the grid is virtualised. Extremely large pages are slow rather than fatal, and the limitation is documented. |

## What is out of scope

- Rowlio does not attempt to defeat a website's access controls, and reads only what the
  user's own browser session can already display.
- A malicious page can show misleading *content* (for example fake prices). Rowlio
  extracts what is there; it cannot judge truthfulness.
- Anyone with access to the user's Chrome profile can read saved projects (IndexedDB is
  not encrypted). Do not save data you would not keep in an ordinary file.
- A closed shadow root and `isTrusted` checks raise the bar against page interference;
  they are not a cryptographic boundary. The isolated world is the real one.

## Secure development practices

- TypeScript `strict` mode; no `any` in message handling.
- Dependencies are few (six runtime packages plus one bundled font), permissively
  licensed, and `npm audit` reported 0 known vulnerabilities at release time.
- The licence script fails the build if a shipped dependency has a missing or
  non-permissive licence.
- The production manifest and bundles are asserted by tests on every run.

## Before public release

- Add a security contact.
- Re-run `npm audit` and the full test suite on the release commit.
- Consider an independent review of `src/content/` and `src/messaging/`, the code that
  faces untrusted pages.
