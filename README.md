# Cookie Curator – Firefox extension

[![CI](https://github.com/ChiefBeaver/Cookie_Curator/actions/workflows/ci.yml/badge.svg)](https://github.com/ChiefBeaver/Cookie_Curator/actions/workflows/ci.yml)

Control cookies per site: keep login and consent cookies, automatically delete or immediately block tracking and everything else.

[Deutsch](README.de.md) · **English**

## Installation

**Temporary (for testing, until restart):**
1. Open `about:debugging#/runtime/this-firefox`
2. *Load Temporary Add-on …* → choose `manifest.json` in this folder

**Permanently without Mozilla signature** (Firefox Developer Edition / Nightly / ESR only):
1. `about:config` → `xpinstall.signatures.required` = `false`
2. `about:addons` → gear icon → *Install Add-on From File* → `cookie-curator.xpi`

**Permanently in regular Firefox:** upload the XPI to addons.mozilla.org as *unlisted* and have it signed
(`npx web-ext sign --channel=unlisted --api-key … --api-secret …`), then install the signed XPI.

Minimum version: Firefox 140 (ESR 140).

The XPI is not in the Git repository; build it with `python tools/build_xpi.py`.

## Development

- Git repository in the main folder (branch `main`).
- Tests: `tests/README.md` – unit tests (Node), UI tests (Playwright) and
  integration tests in real Firefox (Python/Selenium) including local test servers.
- Technical documentation: `docs/` (in German; rebuild the PDF with `python tools/build_pdf.py`).
- CI: GitHub Actions runs all tests on every push in a prepared Docker image
  (`.github/workflows/ci.yml`); a tag such as `v0.8.0` creates a release with the XPI.

## Languages

The interface is available in German (default) and English. The language button (`DE` / `EN`) at the top right of the
popup and the dashboard switches to the next language in turn; the choice applies to all windows and is kept
(`storage.local` → `cc_lang`). Until a language is chosen, the interface is German. The order of the
button follows `LANGUAGES` in `lib/i18n.js` (German first, English second); the default is `DEFAULT` there.

**Adding a language** (example French, `fr`):

1. Copy `locales/en.js` to `locales/fr.js`, change `I18N.register("en", …)` in it to `"fr"`
   and translate the texts. Leave placeholders such as `{n}` or `{site}` unchanged.
2. Add the line `fr: "Français"` to `LANGUAGES` in `lib/i18n.js`.
3. Optional: translate the help tab – copy `locales/help/en.js` to `locales/help/fr.js`, translate it and add `"fr"`
   to `EXTRAS.help` in `lib/i18n.js` (otherwise the English help is shown).
4. Optional: description in the add-ons manager – create `_locales/fr/messages.json`.
5. `npm run test:unit` in the `tests` folder checks that the new file has exactly the same keys as `en.js`
   (and that a help file has the same chapters).

If a text is missing in a language, the English one is shown.

## Layout per site (since 0.5)

- **General:** clean on tab close, note – applies to cookies and site data.
- **Cookies:** policy (default for other cookies, categories) → content → cookie rules → cookie archive.
- **Site data:** policy (mode per storage type, default for other entries) → content → entry rules.

Terms: *site data* = everything except cookies (as in Firefox's “Cookies and Site Data”);
*entry rule* = rule for individual entries in localStorage/sessionStorage.

## Usage

- **Popup (toolbar icon):** all cookies of the current site, the site's policy, quick rule per cookie
  (Auto / Keep / Delete / Block), detail view by clicking the name.
- **Dashboard (extension preferences):** overview of all sites, site editor with all columns,
  global rules, category patterns, trigger settings, log (CSV export), import/export (JSON).
- **Badge:** number of deletion candidates on the current site (green = nothing to delete).

## Delete, archive, restore (since 0.1)

- **Selection:** tick boxes on the left of the cookie table → *Archive*, *Archive + delete* or *Delete*.
  Individual cookies also in the detail view (click on the name).
- **Archive:** stores several versions per cookie (value, expiry, flags, container, partition), default max. 5.
  Identical versions are not stored twice. Archived values can be edited in the dashboard.
- **Restore:** sets the cookie exactly to the archived state (overwrites the current value).
  Expired versions are extended by the configured number of days (0 = as session cookie).
- **⟲ Autostart:** one version per cookie can be marked. It is set on every browser startup
  after the startup cleanup. To keep it from being cleaned again afterwards: set a Keep rule.
- **Overview:** Dashboard → *Archive* (filters autostart / missing / different, bulk actions, export).
- The archive is stored in `storage.local` under `cc_archive` and is part of the JSON export.
  It can contain login sessions – protect export files accordingly.

## Site data (since 0.3; until 0.4 “local storage”)

One setting per site (and globally) for **localStorage, sessionStorage, IndexedDB, Cache Storage, service workers, HTTP cache**:

| Mode | Effect |
|---|---|
| Keep | nothing happens |
| Delete | the whole storage type per host on every cleanup (tab close, startup, interval, manual) via `browsingData.remove({hostnames})` |
| Selective (local/sessionStorage only) | individual entries by entry rules; content script at `document_start`, i.e. before the page's scripts run |

- Entry rules: type exact/glob/regex, name, storage (local/session/both), action Keep/Delete, order = priority;
  plus “default for other entries”.
- Live view with an open tab (since 0.4 in the page context via `scripting.executeScript`, world MAIN):
  local/sessionStorage entries with quick rule and single deletion; IndexedDB with object stores and number of entries
  (delete database, clear store); Cache Storage with URLs/type/size (delete cache or entry);
  service workers with scope/script/status (unregister); quota. New permission: `scripting`.
- Firefox deletes only **exact** hosts. The add-on remembers all visited hosts of a site (`cc_hosts`) plus cookie domains.
  Subdomains that were never open as a tab (pure iframes) are not covered.
- Cache Storage (Cache API, since 0.7): Firefox offers extensions no per-host deletion. The add-on deletes it immediately
  in open tabs of the site, otherwise on the next visit to the host (script at `document_start`, before the page starts).
  Before (up to 0.6.1), Cache Storage was not removed by “Delete everything” and by cleanup.
- HTTP cache: for some cache types Firefox may clear the entire cache.
- New permission: `browsingData`.

## Undo / redo (since 0.2)

- Buttons ↶ / ↷ at the top right of the dashboard and the popup, or Ctrl+Z / Ctrl+Y (outside text fields).
- Records every configuration change (policies, rules, categories, settings, import, reset),
  up to 100 steps, stored in `cc_history` (survives restarts). Clear the history under *Settings*.
- Not recorded: the cookies themselves, archive, log, language.

## Decision logic (first match wins)

1. Site rules (ordered; quick rules go to the top)
2. Global rules
3. Category (consent → tracking → login/session, by name pattern) – action can be overridden per site
4. Site default
5. Global default

Rule fields: type `exact|glob|regex`, name, domain glob, path glob, container (cookieStoreId), action.

Actions: **Keep**, **Delete** (on the next cleanup), **Block** (deleted immediately after being set).

Cleanup runs: when the last tab of a site is closed (with a delay), on browser startup,
optionally at an interval, and manually.

## Technical details

- Manifest V2 (still supported in Firefox; persistent background for tab timers)
- Site key = eTLD+1 via a compact suffix list (extendable in the settings)
- Partitioned cookies (Total Cookie Protection / CHIPS) are assigned to the top-level site and marked `3P`;
  removal uses the correct `partitionKey`, `firstPartyDomain` and `storeId`
- Containers are supported (container column, container rule field)
- Configuration in `storage.local` under `cc_config`, log under `cc_log`, language under `cc_lang`
- Site data (localStorage, sessionStorage, IndexedDB, Cache Storage, service workers, HTTP cache): see section *Site data*

## Files

```
manifest.json
background.js        triggers, blocking, log, badge
lib/i18n.js          translations: language choice, I18N.t(), loading the language files
lib/core.js          rule engine, classification, domains, cookie API
lib/pagefns.js       functions in the page context (live view, single actions)
ui/ui.js, ui/ui.css  shared UI (site editor, rule table)
ui/tables.js         resizable column widths
popup/               toolbar popup
options/             dashboard
page/cache-purge.js  deletes Cache Storage on the next page visit
locales/             interface texts per language (en.js, de.js), help in locales/help/
_locales/            description in the add-ons manager (read by Firefox itself)
docs/                technical documentation (Markdown and PDF, German)
tests/               tests and test environment (instructions: tests/README.md)
tools/               build_xpi.py, build_pdf.py
icons/icon.svg
```

## License

Copyright (C) 2026 ChiefBeaver

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version (`GPL-3.0-or-later`).

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. The full license
text is in the file [`LICENSE`](LICENSE).
