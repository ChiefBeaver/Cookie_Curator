# Cookie Curator – Firefox-Erweiterung

[![CI](https://github.com/ChiefBeaver/Cookie_Curator/actions/workflows/ci.yml/badge.svg)](https://github.com/ChiefBeaver/Cookie_Curator/actions/workflows/ci.yml)

Cookies pro Seite steuern: Login- und Consent-Cookies behalten, Tracking und Rest automatisch löschen oder sofort blockieren.

**Deutsch** · [English](README.md)

## Installation

**Temporär (zum Testen, bis zum Neustart):**
1. `about:debugging#/runtime/this-firefox` öffnen
2. *Temporäres Add-on laden …* → `manifest.json` in diesem Ordner wählen

**Dauerhaft ohne Mozilla-Signatur** (nur Firefox Developer Edition / Nightly / ESR):
1. `about:config` → `xpinstall.signatures.required` = `false`
2. `about:addons` → Zahnrad → *Add-on aus Datei installieren* → `cookie-curator.xpi`

**Dauerhaft im normalen Firefox:** XPI auf addons.mozilla.org als *unlisted* hochladen und signieren lassen
(`npx web-ext sign --channel=unlisted --api-key … --api-secret …`), dann die signierte XPI installieren.

Mindestversion: Firefox 140 (ESR 140).

Die XPI ist nicht im Git-Repository; erzeugen mit `python tools/build_xpi.py`.

## Entwicklung

- Git-Repository im Hauptordner (Zweig `main`).
- Tests: `tests/README.md` – Einheitentests (Node), Oberflächentests (Playwright) und
  Integrationstests in echtem Firefox (Python/Selenium) samt lokalen Testservern.
- Technische Dokumentation: `docs/`, auch als [Wiki](https://github.com/ChiefBeaver/Cookie_Curator/wiki) mit PDF zum
  Herunterladen – beides wird bei jeder Änderung an `docs/` automatisch neu erzeugt (`.github/workflows/wiki.yml`).
  Lokal: `python tools/build_pdf.py`; das PDF liegt nicht im Repository.
- CI: GitHub Actions führt bei jedem Push alle Tests in einem vorbereiteten Docker-Image aus
  (`.github/workflows/ci.yml`); ein Tag wie `v0.8.0` erzeugt ein Release mit der XPI.

## Sprachen

Die Oberfläche gibt es auf Deutsch (Standard) und Englisch. Der Sprachknopf (`DE` / `EN`) oben rechts im Popup und
im Dashboard wechselt reihum zur nächsten Sprache; die Wahl gilt für alle Fenster und bleibt erhalten
(`storage.local` → `cc_lang`). Solange keine Sprache gewählt ist, ist die Oberfläche deutsch. Die Reihenfolge
des Knopfs folgt `LANGUAGES` in `lib/i18n.js` (Deutsch zuerst, Englisch danach); der Standard steht dort unter `DEFAULT`.

**Neue Sprache hinzufügen** (Beispiel Französisch, `fr`):

1. `locales/en.js` nach `locales/fr.js` kopieren, darin `I18N.register("en", …)` auf `"fr"` ändern
   und die Texte übersetzen. Platzhalter wie `{n}` oder `{site}` unverändert lassen.
2. In `lib/i18n.js` bei `LANGUAGES` die Zeile `fr: "Français"` ergänzen.
3. Optional: Hilfe-Tab übersetzen – `locales/help/en.js` nach `locales/help/fr.js` kopieren, übersetzen und `"fr"`
   in `lib/i18n.js` bei `EXTRAS.help` ergänzen (sonst erscheint die englische Hilfe).
4. Optional: Beschreibung im Add-on-Manager – `_locales/fr/messages.json` anlegen.
5. `npm run test:unit` im Ordner `tests` prüft, dass die neue Datei genau dieselben Schlüssel wie `en.js` hat
   (und eine Hilfedatei dieselben Kapitel).

Fehlt ein Text in einer Sprache, erscheint der englische.

## Aufbau pro Seite (ab 0.5)

- **Allgemein:** Bereinigen bei Tab-Schliessen, Notiz – gilt für Cookies und Website-Daten.
- **Cookies:** Richtlinie (Standard für übrige Cookies, Kategorien) → Inhalt → Cookie-Regeln → Cookie-Archiv.
- **Website-Daten:** Richtlinie (Modus je Speicherart, Standard für übrige Einträge) → Inhalt → Eintragsregeln.

Begriffe: *Website-Daten* = alles ausser Cookies (wie in Firefox „Cookies und Website-Daten“);
*Eintragsregel* = Regel für einzelne Einträge in localStorage/sessionStorage.

## Bedienung

- **Popup (Toolbar-Icon):** alle Cookies der aktuellen Seite, Richtlinie der Seite, Schnellregel pro Cookie
  (Auto / Behalten / Löschen / Blockieren), Detailansicht per Klick auf den Namen.
- **Dashboard (Einstellungen der Erweiterung):** Übersicht aller Seiten, Seiten-Editor mit allen Spalten,
  globale Regeln, Kategorie-Muster, Trigger-Einstellungen, Protokoll (CSV-Export), Import/Export (JSON).
- **Badge:** Anzahl Löschkandidaten der aktuellen Seite (grün = nichts zu löschen).

## Löschen, Archivieren, Zurückholen (ab 0.1)

- **Auswahl:** In der Cookie-Tabelle links Häkchen setzen → *Archivieren*, *Archivieren + löschen* oder *Löschen*.
  Einzelne Cookies auch in der Detailansicht (Klick auf den Namen).
- **Archiv:** speichert pro Cookie mehrere Versionen (Wert, Ablauf, Flags, Container, Partition), Standard max. 5.
  Identische Versionen werden nicht doppelt abgelegt. Archivierte Werte sind im Dashboard bearbeitbar.
- **Zurückholen:** setzt das Cookie exakt auf den archivierten Stand (überschreibt den aktuellen Wert).
  Abgelaufene Versionen werden um die eingestellte Anzahl Tage verlängert (0 = als Sitzungscookie).
- **⟲ Autostart:** Eine Version pro Cookie kann markiert werden. Sie wird bei jedem Browserstart
  nach der Start-Bereinigung gesetzt. Damit sie danach nicht wieder bereinigt wird: Behalten-Regel setzen.
- **Übersicht:** Dashboard → *Archiv* (Filter Autostart / fehlend / abweichend, Sammelaktionen, Export).
- Das Archiv liegt in `storage.local` unter `cc_archive` und ist im JSON-Export enthalten.
  Es kann Login-Sitzungen enthalten – Exportdateien entsprechend schützen.

## Website-Daten (ab 0.3; bis 0.4 „Lokaler Speicher“)

Pro Seite (und global) je eine Einstellung für **localStorage, sessionStorage, IndexedDB, Cache Storage, Service Worker, HTTP-Cache**:

| Modus | Wirkung |
|---|---|
| Behalten | nichts passiert |
| Löschen | ganze Speicherart pro Host bei jeder Bereinigung (Tab-Schliessen, Start, Intervall, manuell) via `browsingData.remove({hostnames})` |
| Selektiv (nur local/sessionStorage) | einzelne Einträge nach Eintragsregeln; Content-Script bei `document_start`, also bevor die Seitenskripte laufen |

- Eintragsregeln: Typ exakt/glob/regex, Name, Speicher (local/session/beide), Aktion Behalten/Löschen, Reihenfolge = Priorität;
  dazu „Standard für übrige Einträge“.
- Live-Ansicht bei offenem Tab (ab 0.4 im Seitenkontext via `scripting.executeScript`, world MAIN):
  local/sessionStorage-Einträge mit Schnellregel und Einzel-Löschen; IndexedDB mit Object Stores und Anzahl Einträgen
  (Datenbank löschen, Store leeren); Cache Storage mit URLs/Typ/Grösse (Cache oder Eintrag löschen);
  Service Worker mit Scope/Skript/Status (abmelden); Quota. Neue Berechtigung: `scripting`.
- Firefox löscht nur **exakte** Hosts. Das Add-on merkt sich alle besuchten Hosts einer Seite (`cc_hosts`) plus Cookie-Domains.
  Subdomains, die nie als Tab offen waren (reine iframes), werden nicht erfasst.
- Cache Storage (Cache API, ab 0.7): Firefox bietet Erweiterungen keine Löschung pro Host. Das Add-on löscht ihn sofort
  in offenen Tabs der Seite, sonst beim nächsten Aufruf des Hosts (Skript bei `document_start`, bevor die Seite startet).
  Vorher (bis 0.6.1) wurde Cache Storage bei „Alles löschen“ und bei der Bereinigung nicht entfernt.
- HTTP-Cache: Firefox leert bei manchen Cache-Arten ggf. den ganzen Cache.
- Neue Berechtigung: `browsingData`.

## Rückgängig / Wiederholen (ab 0.2)

- Knöpfe ↶ / ↷ oben rechts im Dashboard und im Popup, oder Strg+Z / Strg+Y (ausserhalb von Textfeldern).
- Erfasst jede Konfigurationsänderung (Richtlinien, Regeln, Kategorien, Einstellungen, Import, Zurücksetzen),
  bis 100 Schritte, gespeichert in `cc_history` (übersteht Neustarts). Verlauf leeren unter *Einstellungen*.
- Nicht erfasst: Cookies selbst, Archiv, Protokoll, Sprache.

## Entscheidungslogik (erste Übereinstimmung gewinnt)

1. Seitenregeln (geordnet; Schnellregeln landen oben)
2. Globale Regeln
3. Kategorie (Consent → Tracking → Login/Session, über Namensmuster) – Aktion pro Seite übersteuerbar
4. Seiten-Standard
5. Globaler Standard

Regelfelder: Typ `exact|glob|regex`, Name, Domain-Glob, Pfad-Glob, Container (cookieStoreId), Aktion.

Aktionen: **Behalten**, **Löschen** (bei der nächsten Bereinigung), **Blockieren** (sofort nach dem Setzen gelöscht).

Bereinigung läuft: beim Schliessen des letzten Tabs einer Seite (mit Verzögerung), beim Browserstart,
optional im Intervall und manuell.

## Technische Details

- Manifest V2 (in Firefox weiterhin unterstützt; persistenter Hintergrund für Tab-Timer)
- Seiten-Schlüssel = eTLD+1 über kompakte Suffix-Liste (in den Einstellungen erweiterbar)
- Partitionierte Cookies (Total Cookie Protection / CHIPS) werden der Top-Level-Seite zugeordnet und mit `3P` markiert;
  Entfernen erfolgt mit korrektem `partitionKey`, `firstPartyDomain` und `storeId`
- Container werden unterstützt (Spalte Container, Regel-Feld Container)
- Konfiguration in `storage.local` unter `cc_config`, Protokoll unter `cc_log`, Sprache unter `cc_lang`
- Website-Daten (localStorage, sessionStorage, IndexedDB, Cache Storage, Service Worker, HTTP-Cache) siehe Abschnitt *Website-Daten*

## Dateien

```
manifest.json
background.js        Trigger, Blockieren, Protokoll, Badge
lib/i18n.js          Übersetzungen: Sprachwahl, I18N.t(), Laden der Sprachdateien
lib/core.js          Regel-Engine, Klassifizierung, Domains, Cookie-API
lib/pagefns.js       Funktionen im Seitenkontext (Live-Ansicht, Einzelaktionen)
ui/ui.js, ui/ui.css  gemeinsame UI (Seiten-Editor, Regel-Tabelle)
ui/tables.js         veränderbare Spaltenbreiten
popup/               Toolbar-Popup
options/             Dashboard
page/cache-purge.js  löscht Cache Storage beim nächsten Seitenaufruf
locales/             Texte der Oberfläche pro Sprache (en.js, de.js), Hilfe in locales/help/
_locales/            Beschreibung im Add-on-Manager (von Firefox selbst gelesen)
docs/                technische Dokumentation (Markdown; PDF und Wiki werden erzeugt)
tests/               Tests und Testumgebung (Anleitung: tests/README.md)
tools/               build_xpi.py, build_pdf.py, docs_to_wiki.py
icons/icon.svg
```

## Lizenz

Copyright (C) 2026 ChiefBeaver

Dieses Programm ist freie Software: Du kannst es unter den Bedingungen der GNU General Public
License, wie von der Free Software Foundation veröffentlicht, weitergeben und/oder ändern,
entweder gemäss Version 3 der Lizenz oder (nach deiner Wahl) jeder späteren Version
(`GPL-3.0-or-later`).

Es wird in der Hoffnung verbreitet, dass es nützlich ist, aber OHNE JEDE GEWÄHRLEISTUNG – sogar
ohne die implizite Gewährleistung der MARKTFÄHIGKEIT oder EIGNUNG FÜR EINEN BESTIMMTEN ZWECK.
Den vollständigen Lizenztext (englisch, rechtlich massgebend) enthält die Datei [`LICENSE`](LICENSE).
