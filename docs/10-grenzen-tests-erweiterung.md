# 10 – Grenzen, Tests, Erweiterung

## 10.1 Bekannte Grenzen

| Grenze | Ursache | Auswirkung / Umgehung |
|---|---|---|
| „Blockieren“ wirkt erst nach dem Setzen | Erweiterungen können das Setzen nicht verhindern (E-07) | Cookie existiert für Millisekunden |
| Iframe-Hosts fehlen im Host-Register | Tabs liefern nur die URL des Hauptdokuments | Website-Daten eingebetteter Drittanbieter werden bei der Bereinigung nicht gelöscht |
| Eintragsregeln nur im Hauptframe | `allFrames: false` (bewusst, 05.3) | Einträge in Iframes bleiben |
| Cache Storage geschlossener Seiten wird erst beim nächsten Aufruf gelöscht | Firefox bietet keinen browsingData-Typ dafür (05.7) | bis dahin nur für die Seite selbst lesbar; Löschung startet vor deren Skripten |
| HTTP-Cache kann ganz geleert werden | `aIsUserRequest = true` in Firefox (06.6) | Modus standardmässig „Behalten“, Warnung in der Hilfe |
| Live-Ansicht nur mit offenem Tab | Keine Lese-API für Website-Daten | Seite öffnen, dann „Neu laden“ |
| Keine Live-Ansicht auf geschützten Mozilla-Domains | `restrictedDomains` (06.7) | – |
| Behaltene Cookies mit altem Partitionsformat werden im neuen Format neu gesetzt | `cookies.set` erzeugt immer das neue Format (04.5) | für Seiten gleichwertig |
| Tab-Schliessen-Timer gehen beim Beenden verloren | Timer nur im Speicher | Bereinigung beim Start holt das nach |
| Letzte 1,5 s Protokoll können beim Beenden fehlen | gebündeltes Schreiben (08.3) | akzeptiert |
| Seiten-Zuordnung bei exotischen Public Suffixes | kompakte PSL (E-08) | Suffix in den Einstellungen ergänzen |
| Offene Seiten zählen containerübergreifend | `tabSites` kennt keine Container | Seite in Container A offen → wird auch für Container B nicht bereinigt |
| Dashboard-Übersicht scrollt unter ~1100 px Breite | viele Spalten mit Bedienelementen | Spalten verkleinern oder waagrecht scrollen |
| Archiv speichert Login-Cookies im Klartext | `storage.local` ist unverschlüsselt (wie `cookies.sqlite` selbst) | Export-Datei vertraulich behandeln |

## 10.2 Technische Schulden

* **`CC.inspectCode`** in `lib/core.js` ist toter Code (früherer Ansatz in der isolierten Welt,
  ersetzt durch `PAGE_FNS.inspect`). Kann entfernt werden; wird noch exportiert.
* **`PAGE_FNS.removeKeys`** und **`CC.removeKeysCode`** machen dasselbe; die Nachricht `removeKeys`
  nutzt noch den Code-Text-Weg über `tabs.executeScript`. Vereinheitlichen auf `runMain`.
* **`ui/ui.js`** ist mit ~1100 Zeilen gross; `SiteEditor` könnte in Cookie-Teil und
  Website-Daten-Teil aufgeteilt werden.
* **Begriff `keyRules`** im Datenmodell entspricht in der Oberfläche „Eintragsregeln“. Umbenennen
  würde eine echte Migration in `normalizeConfig` brauchen.
* **Texte** sind direkt im Code (nur Deutsch). Für Mehrsprachigkeit müssten sie nach
  `_locales/*/messages.json` und `browser.i18n`.
* **Verlauf** speichert 100 vollständige Konfigurationen. Bei sehr grossen Konfigurationen
  (hunderte Seiten mit vielen Regeln) könnte `cc_history` mehrere MB werden.

## 10.3 Teststrategie

Getestet wird auf drei Ebenen, dazu kommen eine statische Prüfung und die Prüfung der Dokumentation. Alle Tests und die Testumgebung liegen im Ordner **`tests/`**;
Einrichtung und Aufruf stehen in `tests/README.md`:

```powershell
cd tests
npm install; npx playwright install chromium; pip install -r requirements.txt
npm test                              # Einheiten- und Oberflächentests
python firefox\run_firefox.py         # Firefox-Integrationstests
```

Auf GitHub laufen alle Ebenen automatisch bei jedem Pull Request und jedem Push auf `main` in einem
vorbereiteten Docker-Image (`.github/workflows/ci.yml`, `.github/ci/Dockerfile`); ein Push auf einen
anderen Zweig allein startet keine Tests (dafür einen Pull Request öffnen oder den Workflow von Hand
starten); Einzelheiten in `tests/README.md`,
Abschnitt „Automatische Tests auf GitHub“. Die Firefox-Tests laufen dort mit der aktuellen
Firefox-ESR-Version aus Debian (beim Einrichten 153 ESR), lokal mit dem installierten Firefox.

### 1. Einheitentests mit Node

`lib/core.js` braucht keinen DOM und läuft in Node, wenn man ein minimales `browser`-Objekt
bereitstellt. Getestet:

* `baseDomain` (mehrteilige Suffixes, IPs, `localhost`, Ports, Benutzer-Suffixes),
* `evaluate`/`classify` (Reihenfolge, Glob/Regex, ungültige Regex, Container-Filter, Kategorien
  „none“, Standard der Seite vs. global),
* `normalizeConfig` mit alten/unvollständigen Konfigurationen, `saveConfig` (leere Seiten),
* `addToArchive` (gleiche Inhalte überspringen, max. Versionen, Autostart geschützt, Sortierung bei
  gleichem Zeitstempel), `restoreDetails` (Host-only, SameSite=None, Ablauf/Verlängerung),
* `evalKey`, `pageKeyCleaner` (gegen ein nachgebildetes `Storage`), `describeConfigChange`,
* Übersetzungen (`i18n.test.js`): Platzhalter, Mehrzahl, Ersatz durch Englisch, Standard Deutsch und
  Reihenfolge des Sprachknopfs; **jede Sprachdatei hat genau die Schlüssel von `en.js`**, jede
  Hilfedatei dieselben Kapitel, und `EXTRAS.help` passt zu `locales/help/`.

Die Tests laufen auf Deutsch (`loadCore(lang)` kann eine andere Sprache laden).

### 2. Oberflächentests mit Playwright (Chromium, nachgebildete API)

Popup- und Dashboard-HTML wurden in Chromium geladen, mit einer **nachgebildeten
`browser`-API** (In-Memory-Cookies, `storage.local` mit `onChanged`, Nachrichten). Der Mock lädt
`lib/core.js`, `lib/pagefns.js` und `background.js` in dieselbe Seite, sodass `runtime.sendMessage`
direkt den echten Hintergrund-Handler aufruft. Damit wurden Klickabläufe geprüft (Schnellregel,
Rückgängig/Wiederholen, Zwei-Klick-Löschen mit Neuzeichnen dazwischen, Archiv, „Alles löschen“) und
Bildschirmfotos bei verschiedenen Breiten erstellt.

Sprachen (`language.test.js`): Sprachknopf in Dashboard und Popup, Hilfe pro Sprache, und ein
Durchgang durch **alle Ansichten auf Englisch** (alle Abschnitte und eine Detailansicht aufgeklappt),
der fehlschlägt, sobald ein Übersetzungsschlüssel oder deutscher Text (Umlaute) sichtbar ist –
auch in Tooltips, Platzhaltern und Auswahllisten.

Grenze: Der Mock bildet Firefox-Eigenheiten (Partitionen, `browsingData`-Verhalten) nicht ab. Sein
Zustand liegt in `sessionStorage` und zusätzlich in `window.name`, weil Chromium `sessionStorage`
asynchron schreibt und ein sofortiges `location.reload()` (Sprachwechsel) sonst manchmal den alten
Stand sieht.

### 3. Tests in echtem Firefox (Selenium + geckodriver)

* Firefox ESR (zuletzt 153 ESR; Mindestversion des Add-ons 140), geckodriver 0.36, Selenium, headless.
* Add-on als temporäres Add-on installiert (`install_addon(path, temporary=True)`).
* Lokale Testseiten: HTTP-Server auf Port 8765, HTTPS-Server auf 8443 mit selbstsigniertem
  Zertifikat; Testdomains über `network.dns.localDomains` (`nzz.test`, `static-nzz.test`,
  `host-a.test`), `network.proxy.type = 0`.
* Für Zugriff auf Firefox-Interna (Einstellungen ändern, `Services.cookies` lesen) im
  Chrome-Kontext: Firefox mit `-remote-allow-system-access` starten, dann
  `driver.context("chrome")`.
* Geprüft u. a.: Bereinigung beim Tab-Schliessen, Blockieren, partitionierte Drittanbieter-Cookies,
  **Altformat-Partitionsschlüssel** (Einstellung `privacy.dynamic_firstparty.use_site` umstellen,
  Cookie erzeugen, zurückstellen, löschen – 0.6.0 scheitert, 0.6.1 besteht), Website-Daten-
  Löschung pro Host, Eintragsregeln bei `document_start`, Live-Ansicht in der Welt MAIN,
  Grenzwerte (06.9), Tabellen bei 1720 px.
* Cache Storage (0.7): Ausgangsfehler belegt (`indexedDB` lässt Caches stehen), Löschen im offenen
  Tab ohne Neuladen, Vormerken und Registrierung bei geschlossenem Tab, Löschen beim nächsten
  Aufruf, Austragen danach (neuer Cache bleibt), Modus „Löschen“ beim Tab-Schliessen mit
  Protokoll, „Alles löschen“, Anzeige in der Oberfläche.
* Sprachen (`test_i18n.py`, Firefox auf Englisch eingestellt): Standard Deutsch trotzdem, Wechsel per
  Knopf, ein zweites offenes Fenster wechselt mit, der Hintergrund folgt ohne Neustart (Tooltip des
  Symbols, Begründungen), die Wahl übersteht Neuladen und landet nicht im Verlauf, Hilfe pro Sprache,
  jede Sprachdatei wird nur einmal geladen.
* Die Firefox-Tests arbeiten mit festen Wartezeiten (0,5–3 s). Auf einem langsamen Rechner kann
  ein Test deshalb vereinzelt fehlschlagen, ohne dass das Add-on fehlerhaft ist; dann den einzelnen
  Test mit Filter erneut laufen lassen (`python firefox\run_firefox.py cache`).

### 4. Statische Prüfung

`npx addons-linter cookie-curator.xpi` – 0 Fehler. Einzige Warnung: `data_collection_permissions`
wird erst ab Firefox für Android 142 unterstützt (Add-on ist für Desktop gedacht).

### 5. Dokumentation

CI-Job `docs` (bei jedem Pull Request): `tools/build_docs.sh` erzeugt die Wiki-Seiten und das PDF
genau wie beim Hochladen und prüft mit `tools/check_wiki.py`, dass jeder Link auf eine vorhandene
Seite und jeder Anker auf eine vorhandene Überschrift zeigt und das PDF ein PDF ist. Das PDF hängt
als Artefakt am Lauf. Nach dem Hochladen ins Wiki prüft `wiki.yml` zusätzlich, dass der PDF-Link im
Wiki eine PDF-Datei liefert (siehe 10.5).

## 10.4 Erweiterung

### Neue Cookie-Kategorie

1. `lib/core.js`: Kategorie in `CATEGORIES`, `CATEGORY_LABEL`, `DEFAULT_PATTERNS` ergänzen.
2. `defaultConfig().settings.categories` und `defaultSiteConfig().categories` um den Schlüssel
   erweitern – `normalizeConfig` füllt ihn bei bestehenden Konfigurationen auf.
3. Reihenfolge in `classify` festlegen (vor Login, falls Namen „session“ enthalten können).
4. Oberfläche: Kategorie-Tabellen lesen `CATEGORIES` – keine weiteren Änderungen nötig.

### Neue Speicherart

1. `STORAGE_TYPES`, `STORAGE_MODES[typ]`, `STORAGE_LABEL`, `STORAGE_HELP` in `lib/core.js`; falls als Ganzes
   löschbar in `WHOLE_TYPES`, falls über `browsingData` zusätzlich in `BROWSING_DATA_TYPES`.
2. Standardwert in `settings.storage` und `defaultSiteConfig().storage`.
3. Prüfen, ob `browsingData` den Typ pro Host kann (06.6) – sonst nur Einzelaktion über `PAGE_FNS`.
4. Lesen in `PAGE_FNS.inspect`, Anzeige als Abschnitt in `SiteEditor.renderStorage`.

### Neue Hintergrund-Nachricht

1. `case "name":` im `runtime.onMessage`-Handler in `background.js`; immer ein klonbares Ergebnis
   zurückgeben.
2. Bei Datenänderung: `addLog(...)` und ggf. `updateBadgeAll()`.
3. Tabelle in [01.5](01-architektur.md#15-nachrichten-schnittstelle-hintergrund) ergänzen.

### Neue Einstellung

1. Standardwert in `defaultConfig().settings`.
2. Beschriftung `setting.<name>` in allen `locales/*.js` und den Namen in `SETTING_LABEL` (für die
   Verlaufsbeschreibung).
3. Eingabefeld in `renderSettings()` (`options.js`) in der passenden Gruppe, Texte über `T("set.…")`.

### Neuer Text in der Oberfläche

Nie Text direkt in den Code schreiben: Schlüssel in **allen** `locales/*.js` ergänzen (der
Einheitentest meldet fehlende), im Code `T("bereich.name", { platzhalter })`. Mehrzahl über
`name_one`/`name_other` und `{ n }`. Der englische Oberflächentest findet vergessene Stellen.

### Neue Sprache (Beispiel Französisch, `fr`)

1. `locales/en.js` nach `locales/fr.js` kopieren, `I18N.register("en", …)` auf `"fr"` ändern, Texte
   übersetzen; Platzhalter wie `{n}` unverändert lassen.
2. In `lib/i18n.js` bei `LANGUAGES` die Zeile `fr: "Français"` ergänzen (Reihenfolge = Sprachknopf).
3. Optional Hilfe: `locales/help/en.js` → `locales/help/fr.js`, übersetzen, `"fr"` bei
   `EXTRAS.help` ergänzen; sonst erscheint die englische Hilfe.
4. Optional `_locales/fr/messages.json` für die Beschreibung im Add-on-Manager.
5. `node tests/unit/run-unit.js i18n` prüft Schlüssel und Kapitel. Mit einer vorübergehenden
   dritten Sprache erprobt: Die übrigen Tests brauchen keine Anpassung.

### Umstellung auf Manifest V3 (falls je nötig)

* Hintergrund als Event-Page: Tab-Zuordnung aus `tabs.query` beim Aufwachen rekonstruieren,
  Tab-Schliessen-Timer über `alarms` (Zeitpunkt in `storage.session`) statt `setTimeout`.
* Eintragsregeln: `scripting.registerContentScripts` akzeptiert nur Dateien, keinen Code-Text.
  Eine feste Datei müsste ihre Regeln asynchron holen (`storage.local` oder Nachricht) – dann ist
  nicht mehr garantiert, dass sie vor den Skripten der Seite läuft. Man müsste akzeptieren, dass
  Einträge erst kurz nach dem Laden entfernt werden.
* Host-Berechtigungen als `optional_host_permissions` anfragen.

## 10.5 Wiki

Das GitHub-Wiki des Repositorys wird aus diesem Ordner erzeugt (`tools/docs_to_wiki.py`, Workflow
`.github/workflows/wiki.yml`): Jede Änderung an `docs/` auf `main` aktualisiert das Wiki automatisch.
Die Kapitel heissen dort nach ihrer Überschrift (z. B. „01 Architektur“), `README.md` wird zur
Startseite, dazu kommen eine Seitenleiste und ein Hinweis auf die Quelle. Bearbeitet wird immer
hier in `docs/`; direkte Änderungen im Wiki überschreibt der nächste Abgleich.

Der Workflow erzeugt dabei auch das PDF der ganzen Dokumentation (`tools/build_pdf.py`) und legt
es ins Wiki; Startseite und Seitenleiste verlinken es. Im Repository liegt kein PDF. Beides erledigt
`tools/build_docs.sh ORDNER`, das danach alle Links prüft (`tools/check_wiki.py`); nach dem Hochladen
prüft der Workflow, dass der PDF-Link im Wiki eine PDF-Datei liefert. Lokal:
`python tools/build_pdf.py [AUSGABE.pdf]` (braucht `markdown`, `playwright` mit Chromium und Node für
`npx @mermaid-js/mermaid-cli`; Chrome für die Diagramme läuft ohne Sandbox, weil Container und
GitHub-Runner sie nicht erlauben – gerendert werden nur die eigenen Diagramme).

## 10.6 Paketieren, Signieren, Installieren

* **Paket:** `python tools/build_xpi.py` erzeugt `cookie-curator.xpi`. Inhalt: `manifest.json`,
  `_locales/`, `background.js`, `lib/`, `locales/`, `ui/`, `popup/`, `options/`, `icons/`, `page/`, `LICENSE` – **ohne** `docs/`,
  `tests/`, `tools/` und `README.md`. Von Hand dasselbe:
  ```
  zip -r cookie-curator.xpi manifest.json background.js lib ui popup options icons page LICENSE
  ```
* **Zum Testen:** `about:debugging#/runtime/this-firefox` → „Temporäres Add-on laden“ →
  `manifest.json`. Wird beim Beenden von Firefox entfernt (Daten in `storage.local` bleiben für
  dieselbe Add-on-ID erhalten).
* **Dauerhaft in normalem Firefox:** Firefox (Release/ESR) installiert nur von Mozilla signierte
  Add-ons. Signieren ohne Veröffentlichung: auf addons.mozilla.org als „unlisted“ hochladen oder
  `web-ext sign --channel=unlisted` mit API-Schlüssel. Die Add-on-ID `cookie-curator@chief-beaver.com` im
  Manifest muss dabei eindeutig sein.
* **Ohne Signatur:** nur Firefox Developer Edition, Nightly oder ESR mit
  `xpinstall.signatures.required = false`.
