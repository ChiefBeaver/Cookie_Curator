# Tests

Drei Ebenen, von schnell bis realistisch:

| Ebene | Ordner | Läuft in | Dauer | Prüft |
|---|---|---|---|---|
| Einheitentests | `unit/` | Node.js | < 1 s | Regel-Engine, Domains, Kategorien, Archiv, Eintragsregeln, Hintergrundlogik mit nachgebildeter API (Tab-Schliessen, Blockieren, Rückgängig, Cache Storage), Übersetzungen (gleiche Schlüssel in jeder Sprache) |
| Oberflächentests | `ui/` | Chromium (Playwright) mit nachgebildeter `browser`-API | ~ 1 min | Dashboard und Popup: Archiv-Ablauf, Rückgängig/Wiederholen, Website-Daten, Übersicht, Sprachknopf, alle Ansichten auf Englisch ohne fehlende Übersetzung |
| Firefox-Tests | `firefox/` | echtes Firefox (Selenium) mit installiertem Add-on | ~ 5 min | Alles, was nur Firefox kann: echte Cookies, Partitionierung, browsingData, Skript-Welten, Cache Storage, Grenzwerte, Sprachwechsel über alle Fenster und den Hintergrund |

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
* **Systemzugriff für WebDriver:** Firefox wird mit `-remote-allow-system-access` und geckodriver mit
  `--allow-system-access` gestartet. Neuere Firefox-Versionen (gesehen ab ESR 153) lassen WebDriver
  sonst keine `moz-extension://`-Seiten öffnen, und der Test „alter Partitionsschlüssel“ braucht den
  Zugriff, um eine Einstellung im laufenden Browser umzustellen. Gilt nur für das Testprofil.

Ports 8765 und 8443 müssen frei sein. Die Windows-Firewall fragt eventuell beim ersten Lauf nach –
die Server lauschen nur auf 127.0.0.1, Zugriff aus dem Netzwerk ist nicht nötig.

## Automatische Tests auf GitHub (CI)

Bei jedem Push auf `main`, bei Pull Requests und bei Versions-Tags läuft
`.github/workflows/ci.yml` auf GitHub Actions (für öffentliche Repositories kostenlos). Ein Push auf
einen anderen Zweig allein startet keine Tests – dafür einen Pull Request öffnen oder den Workflow
unter *Actions → CI → Run workflow* für den Zweig starten:

```
Push / Pull Request / Tag v*
   │
   ▼
image ── CI-Image aus .github/ci/Dockerfile bereitstellen
   │      (nur neu bauen, wenn sich Dockerfile, package.json oder requirements.txt geändert haben)
   ├──► unit      Einheitentests
   ├──► ui        Oberflächentests
   ├──► lint      XPI bauen, Mozilla addons-linter
   └──► firefox   Firefox-Tests
docs ──── Wiki-Seiten und PDF der Dokumentation erzeugen, alle Links prüfen (eigener Runner,
   │      ohne Image; das PDF hängt als Artefakt am Lauf)
          │
          ▼ (nur bei Tag v0.8.0 usw.)
        release   XPI bauen und an ein GitHub-Release hängen
```

**Das CI-Image** enthält alle Werkzeuge fertig installiert: Node 22, Playwright mit Chromium,
addons-linter, Python mit Selenium, Firefox ESR aus Debian und geckodriver. Es liegt in der
GitHub Container Registry (`ghcr.io/chiefbeaver/cookie-curator-ci`). Sein Name enthält einen
Hash über `Dockerfile`, `package.json` und `requirements.txt`: Ändert sich eine dieser Dateien,
baut der nächste Lauf automatisch ein neues Image; sonst wird das vorhandene verwendet und nichts
installiert.

**Firefox-Version:** Das Image nimmt die aktuelle ESR-Version aus Debian (Stand des Bauens:
153 ESR). Eine neuere Firefox-ESR-Version holt man über *Actions → CI → Run workflow* mit
„CI-Image neu bauen“.

**Release:** Version in `manifest.json` erhöhen, committen, dann
`git tag v0.8.0 && git push origin v0.8.0`. Passt der Tag nicht zur Version im Manifest, bricht
der Release-Job ab.

**Lokal im selben Image testen** (mit Docker):

```bash
docker run --rm --shm-size=2g -v "$PWD:/repo" -w /repo ghcr.io/chiefbeaver/cookie-curator-ci:latest \
  bash -c "node tests/unit/run-unit.js && node tests/ui/run-ui.js && python tests/firefox/run_firefox.py"
```

## Aufbau

```
tests/
├── package.json           npm-Skripte, Playwright, addons-linter
├── requirements.txt       Selenium, cryptography
├── unit/
│   ├── helpers.js         lädt core.js / background.js in eine VM mit nachgebildeter API
│   ├── run-unit.js        Testläufer
│   └── *.test.js          core, archive, storage, background, i18n
├── ui/
│   ├── mock-browser.js    nachgebildete browser-API (lädt die echte background.js in die Seite)
│   ├── run-ui.js          Testläufer (Chromium)
│   └── *.test.js          archive-flow, undo-redo, website-data, language
├── firefox/
│   ├── common.py          Server, Zertifikat, Firefox-Start, Hilfsfunktionen
│   ├── run_firefox.py     Testläufer
│   ├── test_*.py          cookies, website_data, cache_storage, partition, ui, limits, i18n
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
  Dritter Eintrag in `TESTS` sind Startoptionen, z. B. `{"prefs": {…}, "width": 1700}`.
* **Sprache:** Alle Tests laufen mit der Standardsprache Deutsch; Knöpfe werden darum über ihren
  deutschen Text gefunden. Für englische Abläufe vorher die Sprache wählen – im Oberflächentest
  `await p.evaluate(() => I18N.choose("en"))`, im Firefox-Test `h.js("await I18N.choose('en'); return 1")`.
  Neue Oberflächentexte gehören in alle `locales/*.js`; `unit/i18n.test.js` meldet fehlende
  Schlüssel, `ui/language.test.js` sichtbare Schlüssel oder deutsche Texte auf Englisch.

## Dokumentation prüfen

Die technische Dokumentation (`docs/`) wird als Wiki mit PDF veröffentlicht. Dieselbe Erzeugung
läuft in CI (Job `docs`) und lokal:

```bash
pip install markdown playwright && python -m playwright install chromium
tools/build_docs.sh /tmp/wiki      # Wiki-Seiten + PDF erzeugen, danach alle Links prüfen
```

`tools/check_wiki.py` meldet Links auf fehlende Seiten, Anker ohne passende Überschrift und einen
fehlenden oder kaputten PDF-Link. Für die Diagramme lädt `npx` beim ersten Lauf `@mermaid-js/mermaid-cli`.

