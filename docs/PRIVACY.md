# Privacy

Rowlio is built so that your data never has to leave your computer. This document
describes what the extension does with data. It is written to be usable as the basis of a
public privacy policy; **have it reviewed before publishing it as a legal document.**

## Summary

- Rowlio does **not** collect, transmit, sell or share any data.
- There is no account, no server, no analytics, no telemetry, no advertising, no remote
  AI service.
- Rowlio reads a page only after you invoke it on that page.
- Extracted data is kept in memory in the workspace tab. It is written to disk only when
  **you** save a project or export a file.
- You can delete everything Rowlio stores, at any time.

## What Rowlio reads

When you click the Rowlio icon (or use a Rowlio keyboard shortcut) on a tab, Chrome grants
the extension temporary access to that tab. Rowlio then reads the content of that page —
the same content you can see — in order to show counts in the popup and to perform the
extraction you ask for.

Rowlio does not read pages you have not invoked it on, does not run in the background,
and does not record your browsing history. If you grant permanent access to a site
(optional, one site at a time, confirmed by a Chrome prompt), Rowlio can read pages of
that site without a new click, but still only acts when you ask it to.

Password fields are not read: text extraction skips `input[type=password]` (and hidden
and file inputs).

## What Rowlio stores, and where

| Data | Where | When | How to remove |
|---|---|---|---|
| Extracted records you are working on | Memory of the workspace tab | Until you close the tab | Close the dataset or the tab |
| Saved projects (the extracted records, their names, source URL and title, your notes) | IndexedDB in your Chrome profile | Only when you press **Save** | Projects → Delete, or Settings → Delete all saved data |
| Recipes (selectors, field names, options, URL pattern — no page content) | IndexedDB | Only when you press **Save as recipe** | Saved Recipes → Delete, or Settings → Delete all saved data |
| Settings and the "introduction seen" flag | IndexedDB | When you change a setting | Settings → Reset settings / Delete all saved data |
| Exported files | Your downloads folder | When you export | Delete the files |
| Clipboard contents | Your system clipboard | When you press Copy | Copy something else |

Removing the extension removes its IndexedDB storage.

Rowlio does not use cookies, `localStorage`, `chrome.storage` or sync storage. Nothing is
synchronised between devices.

## What Rowlio sends

Nothing. The extension contains no code that performs network requests, and its extension
pages run under a Content Security Policy with `connect-src 'self'`, so the browser
itself blocks them from connecting to any remote server. The build is checked for network
APIs by an automated test (see [TESTING.md](TESTING.md)).

Note: the *page you are extracting from* continues to behave as it normally does. When
Rowlio follows a next-page link, scrolls an infinite list, or opens the addresses in a
list you gave it (Batch URLs), the website loads its own content exactly as if you had
clicked, scrolled or typed the address yourself.

**Links that leave the extension.** The interface shows two credit links, to the Unique
Labs website (`https://www.uniquelabs.org`) and to the developer's Telegram profile
(`https://t.me/igfrostt`). They are ordinary links: nothing is requested from those sites
unless you click one, in which case Chrome opens it in a new tab like any other link (with
`rel="noopener noreferrer"`, so the destination learns nothing about the extension).

**Files you import.** A CSV, TSV, JSON or JSON Lines file you open with *Import* is read
by the browser from your disk. It is not uploaded.

**Sound and typeface.** Sound effects are generated on your device with the Web Audio
API; there are no audio files and nothing is downloaded. The interface typeface (Inter)
is a font file inside the extension.

## Third parties

None. No third-party service receives data. The third-party libraries and the font
bundled in the extension (listed in the README) run locally and make no network requests.

## The website

The marketing website in this repository (`website/`) is separate from the extension. It
is static: no cookies, no analytics, nothing loaded from third parties; a sound on / off
preference is kept in the browser's local storage. Whoever hosts it (for example Vercel)
will, like any web host, see ordinary request data such as IP addresses in its server
logs. That is outside Rowlio's control and should be covered by the published privacy
policy.

## Children, sensitive data, regulated data

Rowlio has no knowledge of what a page contains. You are responsible for the data you
choose to extract, store and export, including personal data of other people, and for
complying with the website's terms and with laws such as GDPR or CCPA.

## Permissions

See [PERMISSIONS.md](PERMISSIONS.md) for each permission and the reason for it.

## Changes

Any change that affects what is stored or transmitted will be described in
[CHANGELOG.md](../CHANGELOG.md) and here.
