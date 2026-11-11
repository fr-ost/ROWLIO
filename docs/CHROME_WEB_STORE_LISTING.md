# Chrome Web Store listing — draft

Draft copy for the developer dashboard. Review wording, add the missing URLs, and confirm
brand clearance before submitting. Nothing here has been submitted.

## Store listing

**Title** (max 75 characters — 41 used)

```
Rowlio: Free Web Scraper & Data Extractor
```

**Summary** (max 132 characters — 127 used)

```
Turn any webpage into structured data. Extract tables, lists, links and images to CSV, XLSX or JSON. Free forever, 100% local.
```

**Category:** Productivity → Tools *(alternative: Developer Tools)*

**Language:** English

**Description**

```
Rowlio turns any webpage into structured data — tables, product listings, search results, links, images and metadata — ready to review, clean and export. Free forever, with no account and no limits. Everything happens on your device.

HOW IT WORKS
1. Open a webpage and click the Rowlio icon.
2. Pick what you want: tables, items on the page, links or images.
3. Review the rows, tidy them up, and export.

WHAT YOU CAN EXTRACT
• Tables — every HTML table on the page, with merged cells, multi-row headers, nested tables and hidden rows handled properly.
• Lists and cards — click one product, article or search result and Rowlio finds the rest, along with fields such as title, price, image, link, rating and date.
• Custom rules — write CSS selectors or XPath, preview the matches, and build multi-field rules.
• Links and images — with filters for internal / external links, containers, text and size.
• Lists, headings, breadcrumbs, page metadata, Open Graph, Twitter Cards, JSON-LD and Schema.org microdata.
• Multiple pages — follow "next" links, page numbers or infinite scroll, always within limits you set and with a Stop button.

CLEAN YOUR DATA BEFORE EXPORTING
A spreadsheet-style preview lets you edit cells, sort, search, filter, rename and reorder columns, remove duplicates and empty rows, find and replace, split and combine columns, extract numbers and parse dates. Every change can be undone, and the original extraction is always kept.

EXPORT ANYWHERE
CSV, Excel (XLSX), JSON, JSON Lines, TSV, or copy straight to the clipboard. Full Unicode support (বাংলা, العربية, 日本語 …). Exports are protected against spreadsheet formula injection.

SAVE AND REUSE
Save results as projects on your device. Save your extraction settings as recipes and reuse them on similar pages.

PRIVATE BY DESIGN
• No account, no sign-up, no subscription, no premium tier, no watermarks.
• No data is uploaded: Rowlio makes no network requests of its own.
• No analytics, no tracking, no ads.
• Rowlio can only read a page after you click its icon there.
• Your saved data stays in your browser and you can delete it at any time.

WHAT ROWLIO DOES NOT DO
Rowlio reads pages you can already open in your browser. It does not bypass logins, paywalls, CAPTCHAs or anti-bot protections, and it does not crawl websites in the background. Please respect each website's terms of use and applicable laws.

Chrome does not allow extensions to run on browser pages (chrome://), the Chrome Web Store, and a few other protected pages.

Rowlio is made by Unique Labs. Useful technology. Accessible to everyone.
```

## Graphic assets

| Asset | Requirement | Status |
|---|---|---|
| Store icon | 128×128 PNG | Ready: `public/icons/icon-128.png` |
| Screenshots | 1280×800 or 640×400, 1–5 images | Drafts in `docs/screenshots/` (01–06, taken on the test site). **Retake on real, non-copyrighted or own content before submitting**, and choose the five strongest. |
| Small promo tile | 440×280 PNG | **To do** |
| Marquee promo tile | 1400×560 PNG (optional) | To do if wanted |

Suggested screenshot captions:

1. "Every table on the page, previewed before you extract."
2. "Click one item — Rowlio finds the rest and the fields inside."
3. "Check and rename fields before extracting."
4. "Review, edit and clean your data."
5. "Export to CSV, Excel, JSON and more."

## Additional fields

| Field | Value |
|---|---|
| Official URL / homepage | **To be provided** (`brand.config.json` → `urls.homepage`) |
| Support URL | **To be provided** |
| Privacy policy URL | **Required.** Publish a reviewed version of `docs/PRIVACY.md` and enter its URL |
| Mature content | No |
| Pricing | Free. No in-app purchases |
| Regions | All |

## Privacy practices tab

**Single purpose**

```
Rowlio extracts structured data (tables, lists, links, images and metadata) from the web page the user is viewing and exports it to a file, entirely on the user's device.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| activeTab | Rowlio reads the current page only after the user clicks the extension or uses its keyboard shortcut, in order to extract the tables, lists, links, images or metadata the user asks for. |
| scripting | Used to inject the extension's own bundled content script into the tab the user invoked Rowlio on. The script performs the extraction locally in the page. No remote code is loaded or executed. |
| Host permission (optional `http://*/*`, `https://*/*`) | Never granted at install. Requested at runtime for one site at a time, only when the user chooses "Grant access" or "Always allow on this site", so Rowlio keeps working on that site without a new click. |

**Remote code:** No, I am not using remote code.

**Data usage:** Rowlio does not collect any user data. Tick none of the data categories.
Certify all three statements:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single
  purpose.
- I do not use or transfer user data to determine creditworthiness or for lending
  purposes.

## Publishing checklist

**Legal and brand**

- [ ] Trademark search for "Rowlio" in target markets. *Not yet done.*
- [ ] Domain availability checked / domain registered. *Not yet done.*
- [ ] Chrome Web Store searched for conflicting names. *Not yet done.*
- [ ] Licence chosen for the source code (if the repository will be public).
- [ ] Privacy policy reviewed and published at a public URL.
- [ ] Homepage and support contact published; URLs added to `brand.config.json`.
- [ ] Security contact added to `docs/SECURITY.md`.

**Build**

- [ ] `version` in `package.json` set; `CHANGELOG.md` updated (remove "Unreleased").
- [ ] `npm ci && npm run verify` passes on the release commit.
- [ ] `npm audit` shows no known vulnerabilities.
- [ ] Manual checklist in `docs/TESTING.md` completed in current stable Chrome on at
      least Windows and macOS.
- [ ] Exported CSV and XLSX opened in Microsoft Excel and Google Sheets.
- [ ] `npm run package` → `release/rowlio-<version>.zip` (the script refuses test builds).
- [ ] Unzip the archive and confirm `manifest.json` lists only `activeTab` and
      `scripting` under `permissions` and has no `host_permissions`.

**Store**

- [ ] Developer account registered and verified (one-time fee; publisher name
      "Unique Labs").
- [ ] Listing text, category and language entered.
- [ ] Icon, at least one screenshot, and the small promo tile uploaded.
- [ ] Privacy practices tab completed as above.
- [ ] Distribution: public, all regions.
- [ ] Submit for review. Optional host permissions with broad patterns can lead to a
      longer review; the justification above explains why they are optional and
      user-triggered.

**After approval**

- [ ] Install from the store on a clean profile and repeat the smoke test.
- [ ] Tag the release commit and archive the uploaded zip.
- [ ] Add the store URL to `brand.config.json` and the README.
