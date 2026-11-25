# Tests

Drei Ebenen, von schnell bis realistisch:

| Ebene | Ordner | Läuft in | Dauer | Prüft |
|---|---|---|---|---|
| Einheitentests | `unit/` | Node.js | < 1 s | Regel-Engine, Domains, Kategorien, Archiv, Eintragsregeln, Hintergrundlogik mit nachgebildeter API (Tab-Schliessen, Blockieren, Rückgängig, Cache Storage) |
| Oberflächentests | `ui/` | Chromium (Playwright) mit nachgebildeter `browser`-API | ~ 30 s | Dashboard und Popup: Archiv-Ablauf, Rückgängig/Wiederholen, Website-Daten, Übersicht |
| Firefox-Tests | `firefox/` | echtes Firefox (Selenium) mit installiertem Add-on | ~ 5 min | Alles, was nur Firefox kann: echte Cookies, Partitionierung, browsingData, Skript-Welten, Cache Storage, Grenzwerte |

Warum drei Ebenen: siehe `docs/10-grenzen-tests-erweiterung.md`, Abschnitt 10.3.

## Einmalig einrichten

Benötigt: **Node.js ≥ 18**, **Python ≥ 3.9**, **Firefox** (normal installiert; ≥ 140).

```powershell
cd <Projektordner>\tests

# Node: Playwright + Chromium für die Oberflächentests
npm install
npx playwright install chromium

# Python: Selenium für die Firefox-Tests (am besten in einer virtuellen Umgebung)
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

`geckodriver` muss nicht installiert werden: Selenium lädt ihn beim ersten Lauf selbst herunter
(Selenium Manager, braucht einmal Internet).

## Ausführen

Alle Befehle im Ordner `tests`:

```powershell
npm run test:unit        # Einheitentests
npm run test:ui          # Oberflächentests (Bildschirmfotos landen in tests\output)
npm test                 # beide

python firefox\run_firefox.py              # alle Firefox-Tests, Firefox unsichtbar
python firefox\run_firefox.py --headed     # Firefox sichtbar, zum Zuschauen
python firefox\run_firefox.py cache        # nur Tests mit „cache“ im Namen
python firefox\run_firefox.py --firefox "C:\Program Files\Mozilla Firefox\firefox.exe"

npm run lint             # XPI bauen und mit dem Mozilla addons-linter prüfen
```

Einzelne Dateien: `node unit\run-unit.js background`, `node ui\run-ui.js website --headed`.

Jeder Lauf endet mit einer Zusammenfassung; der Exit-Code ist 0, wenn alles bestanden hat.

## Die Testumgebung für Firefox

`firefox/common.py` baut sie bei jedem Lauf auf und räumt danach auf:

* **Testseiten** aus `firefox/site/` über zwei lokale Server:
  * `http://localhost:8765` – Cookies, localStorage, IndexedDB, Cache Storage, Service Worker
    (`index.html` + `app.js` legen alles an; `?noinit` lädt die Seite ohne anzulegen),
  * `https://nzz.test:8443`, `https://static-nzz.test:8443`, `https://host-a.test:8443` – für
    Drittanbieter-Cookies in Iframes (`embed.html` bettet `setc.html` zweier Domains ein).
    Das Zertifikat wird bei jedem Lauf frisch erzeugt (selbstsigniert, nur für diese Namen) und
    Firefox nimmt es im Testprofil an.
* **Namensauflösung:** Firefox bekommt `network.dns.localDomains`, damit `*.test` auf 127.0.0.1
  zeigt – keine Änderung an der `hosts`-Datei nötig.
* **Profil:** Jeder Test startet Firefox mit einem **neuen, leeren Profil**. Das eigene
  Firefox-Profil wird nicht verwendet und nicht verändert.
* **Add-on:** wird direkt aus dem Hauptordner als temporäres Add-on installiert (wie
  `about:debugging`), mit fester interner ID, damit die Tests `moz-extension://…/options/options.html`
  öffnen und dort `browser.runtime.sendMessage` an den Hintergrund schicken können.
* **Firefox-Interna:** Der Test „alter Partitionsschlüssel“ startet Firefox mit
  `-remote-allow-system-access`, um eine Einstellung im laufenden Browser umzustellen. Kennt die
  installierte Firefox-Version das nicht, wird der Test übersprungen (nicht fehlgeschlagen).

Ports 8765 und 8443 müssen frei sein. Die Windows-Firewall fragt eventuell beim ersten Lauf nach –
die Server lauschen nur auf 127.0.0.1, Zugriff aus dem Netzwerk ist nicht nötig.

## Aufbau

```
tests/
├── package.json           npm-Skripte, Playwright, addons-linter
├── requirements.txt       Selenium, cryptography
├── unit/
│   ├── helpers.js         lädt core.js / background.js in eine VM mit nachgebildeter API
│   ├── run-unit.js        Testläufer
│   └── *.test.js          core, archive, storage, background
├── ui/
│   ├── mock-browser.js    nachgebildete browser-API (lädt die echte background.js in die Seite)
│   ├── run-ui.js          Testläufer (Chromium)
│   └── *.test.js          archive-flow, undo-redo, website-data
├── firefox/
│   ├── common.py          Server, Zertifikat, Firefox-Start, Hilfsfunktionen
│   ├── run_firefox.py     Testläufer
│   ├── test_*.py          cookies, website_data, cache_storage, partition, ui, limits
│   └── site/              Testseiten
└── output/                Bildschirmfotos (wird erzeugt, nicht im Git)
```

## Einen Test hinzufügen

* **Einheitentest:** in einer `unit/*.test.js` einen Eintrag `["Name", async () => { … }]` ins
  exportierte Array. Für die Hintergrundseite `loadBackground({cookies, tabs})` aus `helpers.js`
  verwenden; Timer laufen erst mit `await env.runTimers()`.
* **Oberflächentest:** Eintrag in `ui/*.test.js`; die Funktion bekommt `{ newPage, BASE, shot }`.
  `__mock.cookies()`, `__mock.store` und `window.__page` geben Zugriff auf den nachgebildeten Zustand.
* **Firefox-Test:** Funktion `def mein_test(h)` in einer `firefox/test_*.py` und in `TESTS`
  eintragen. `h` (Klasse `Harness`) bietet u. a. `new_tab`, `ext(route)`, `bg(nachricht)`,
  `js(code)`, `site_config(seite, js)`, `check(bedingung, text)`, `screenshot(name)`.
  Dritter Eintrag in `TESTS` sind Startoptionen, z. B. `{"prefs": {…}, "system_access": True}`.
