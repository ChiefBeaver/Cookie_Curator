# 07 – Oberfläche

Popup und Dashboard sind normale HTML-Seiten der Erweiterung (`moz-extension://<uuid>/…`). Sie
nutzen **kein Framework**; die gesamte Oberfläche wird mit einem kleinen DOM-Helfer aufgebaut.

## 7.1 Der DOM-Helfer `el()`

```js
el("button", { class: "btn", onclick: () => …, disabled: busy }, "Löschen", icon)
```

* Attribute: `class`, `text`, `style`, `value`, boolesche Eigenschaften (`checked`, `disabled`,
  `selected`) und `on…`-Funktionen als Ereignis-Handler; `null`/`false` werden übersprungen.
* Kinder: beliebig verschachtelte Arrays aus Knoten, Strings, `null`/`false` (übersprungen).
  Strings werden **immer als Textknoten** eingefügt.

**Sicherheitsregel:** Nirgends wird `innerHTML` mit Fremddaten verwendet. Cookie-Werte,
localStorage-Inhalte und Cache-URLs stammen von Webseiten und könnten HTML/JavaScript enthalten.
Als Textknoten sind sie harmlos. Das ist auch eine Auflage der Mozilla-Prüfung (addons-linter
warnt bei `innerHTML`).

Weitere Helfer in `ui/ui.js`: `select()` (Auswahlfeld mit Optionen `[wert, beschriftung,
deaktiviert]`), `field()` (Beschriftung + Eingabe + Hilfetext), `copyText()`.

## 7.2 Der Seiten-Editor (`UI.SiteEditor`)

Popup und Dashboard-Detailansicht `#site/<seite>` verwenden **dieselbe Klasse**, das Popup mit
`compact = true` (weniger Spalten, Website-Daten zugeklappt, Archiv zugeklappt).

### Aufbau

```
SiteEditor.root
├── summaryEl            Kopfzeile: Seite, Anzahl Cookies je Aktion, „Bereinigen“
├── generalEl            Karte „Allgemein“: Tab-Schliessen, Notiz, „Alles löschen“
├── <details> Cookies
│   ├── policyEl         Richtlinie: Standard, Kategorie-Aktionen
│   ├── cookiesEl        Inhalt: Cookie-Tabelle mit Filter, Auswahl, Sammelaktionen, Details
│   ├── rulesEl          Cookie-Regeln der Seite
│   └── archiveEl        Cookie-Archiv der Seite
└── <details> Website-Daten
    ├── dataPolicyEl     Richtlinie: Modus je Speicherart
    ├── storageEl        Inhalt: Live-Ansicht (local/session/IDB/Cache/SW)
    └── entryRulesEl     Eintragsregeln
```

Die Gruppierung (alle Cookie-Felder zusammen, Website-Daten analog aufgebaut: Richtlinie → Inhalt →
Regeln) war eine ausdrückliche Anforderung. Gemeinsames (Tab-Schliessen gilt für beides) steht in
„Allgemein“.

### Teil-Neuzeichnen

`render()` baut nur das Gerüst und ruft dann `renderSummary()`, `renderGeneral()`, …,
`renderStorage()` auf. Jede `renderX()` leert **nur ihren Container** und baut ihn neu. Eine
Änderung ruft nur die nötigen Teile auf:

| Ereignis | Neu gezeichnet |
|---|---|
| Schnellregel / Richtlinie geändert (`save(false)`) | Kopf, Cookie-Tabelle, Treffer-Zähler der Regeln, ggf. Website-Daten |
| Regel hinzugefügt/entfernt/verschoben (`save(true)`) | zusätzlich die Regel-Tabelle |
| `cookies.onChanged` (gebündelt 400 ms) | Kopf, Cookie-Tabelle, Treffer-Zähler, Archiv |
| Archiv geändert (`storage.onChanged`) | Archiv, Cookie-Tabelle (Archiv-Spalte) |
| Konfiguration von aussen geändert | alles (`render()`) |

**Warum:** Ein komplettes Neuzeichnen würde Eingabefokus, Scrollposition, geöffnete Details-Zeilen
und halb ausgefüllte Regel-Formulare zerstören. Insbesondere die Regel-Tabelle wird beim Tippen
**nicht** neu gezeichnet (nur `updateRuleHits()` aktualisiert die Zahlen), sonst verlöre das
Eingabefeld nach jedem Buchstaben den Fokus.

### Zustand, der ein Neuzeichnen überlebt

* `openState` – welche `<details>`-Abschnitte offen sind (Schlüssel wie `cookieCard`,
  `cookieRules`, `entryRules`).
* `expanded` – Cookies, deren Detailzeile aufgeklappt ist.
* `selected`, `archSelected` – Auswahl-Häkchen (nach Cookie-ID bzw. Archiv-ID).
* `filter`, `actionFilter`, `sort`.
* `armedUntil` (global in `ui.js`) – siehe 7.5.

Alle Schlüssel sind **inhaltliche IDs**, nie DOM-Referenzen – darum überleben sie das Neuzeichnen.

## 7.3 Dashboard-Routing

`options.js` liest `location.hash` (`#sites`, `#site/nzz.ch`, `#rules`, …) und ruft die passende
`renderX()`. `hashchange` löst ein neues `render()` aus. Vorteile: Zurück-Knopf funktioniert,
Ansichten sind als Lesezeichen speicherbar, kein Router-Code nötig.

Beim Verlassen einer Seitenansicht ruft `render()` `currentEditor.destroy()` auf, das die
Listener (`storage.onChanged`, `cookies.onChanged`) entfernt – sonst würden verwaiste Editoren
weiter auf Ereignisse reagieren.

Die Seitenübersicht (`renderSites`) sammelt alle Seiten aus Cookies, Konfiguration und offenen
Tabs, zeigt Anzahl, Aufteilung Behalten/Löschen/Blockieren, Website-Daten-Modi und die Aktionen
*Bearbeiten*, *Bereinigen* und *Alles löschen*. Sie wird bei Cookie-Änderungen gebündelt neu
gezeichnet (`renderSitesDebounced`).

## 7.4 Eigene Speicherungen erkennen

Jede offene Oberfläche hört auf `storage.onChanged`. Ändert eine **andere** Oberfläche (oder
Rückgängig im Hintergrund) die Konfiguration, muss neu geladen und gezeichnet werden. Die **eigene**
Speicherung dagegen darf kein komplettes Neuzeichnen auslösen (Fokusverlust, siehe 7.2).

### Erster Ansatz und warum er scheiterte

Ursprünglich verglich die Oberfläche: „Ist `newValue` gleich meinem aktuellen `this.cfg`? Dann war
ich es.“ Das brach **Wiederholen** (Benutzer-Fehlermeldung: „Regel kommt beim Wiederholen nicht
mehr“):

1. Benutzer legt Regel an → Konfiguration A (mit Regel). Oberfläche zeigt A.
2. Rückgängig → Hintergrund schreibt B (ohne Regel). Oberfläche lädt B.
3. Wiederholen → Hintergrund schreibt A.
4. Aber: Bei Schritt 2 war die Oberfläche kurzzeitig im Zustand A, und durch die Reihenfolge der
   Ereignisse hielt sie das eintreffende A für „gleich wie ich“ → ignoriert → Anzeige blieb B.

### Lösung: Warteschlange `pendingSaves`

```js
await CC.saveConfig(this.cfg, json => {          // Callback läuft VOR storage.local.set
  this.pendingSaves.push(json);
  setTimeout(() => { /* nach 2 s wieder entfernen */ }, 2000);
});

// in storage.onChanged:
const i = this.pendingSaves.indexOf(JSON.stringify(newValue));
if (i >= 0) { this.pendingSaves.splice(0, i + 1); return; }   // genau einmal überspringen
this.reloadConfig().then(() => this.render());
```

* **Vormerken vor dem Schreiben**, weil `onChanged` im schreibenden Kontext eintreffen kann,
  bevor `set()` zurückkehrt (siehe [06.13](06-firefox-interna.md#613-storageonchanged)).
* **Genau einmal** überspringen (`splice`): Ein späteres identisches Schreiben – etwa durch
  Wiederholen – wird nicht mehr als eigenes erkannt.
* Der JSON-Vergleich nutzt dieselbe bereinigte Kopie, die `saveConfig` speichert (leere Seiten
  entfernt) – deshalb liefert `saveConfig` das JSON über den Callback, statt dass die Oberfläche es
  selbst berechnet.
* 2 s Zeitlimit: Falls ein Ereignis nie kommt, wächst die Liste nicht.

Dasselbe Muster nutzt das Dashboard für seine globalen Ansichten (`options.js`).

## 7.5 Zwei-Klick-Bestätigung (`confirmButton`)

Löschende Aktionen verlangen einen zweiten Klick innerhalb von 4 s („Löschen“ → „Wirklich
löschen?“). `confirm()` ist im Popup nicht möglich (siehe 06.12) und wäre im Dashboard ein
störender modaler Dialog.

**Fehler aus der Praxis:** „Wenn ich auf Löschen drücke, passiert nichts.“ Ursache: Zwischen erstem
und zweitem Klick setzte die Seite ein Cookie → `cookies.onChanged` → Cookie-Tabelle neu
gezeichnet → **neuer Knopf** im Ausgangszustand → der zweite Klick war wieder ein „erster“.

**Lösung:** Knöpfe mit stabiler `id` (z. B. `"del-sel:" + site`) speichern den scharfen Zustand
global in `armedUntil: Map<id, zeitpunkt>`. Ein neu gebauter Knopf mit derselben id startet
bereits scharf, mit der Restzeit.

Zusätzlich fängt `confirmButton` Fehler der Aktion ab und zeigt sie als rote Meldung – vorher
endeten sie als „uncaught exception“ in der Konsole, ohne sichtbare Rückmeldung.

## 7.6 Meldungen (`toast`)

Ein einziges Element `#cc-toast` unten; eine neue Meldung ersetzt die alte. Arten: normal (grün,
2,8 s), `warn` (orange), `err` (rot), mit frei wählbarer Dauer (lange Texte 12 s).

**Fehler aus der Praxis:** Nach „Löschen“ erschien zuerst rot „konnte nicht gelöscht werden“,
danach orange „wurden sofort wieder gesetzt“ – widersprüchlich. Ursache war die alte
Partitionsschlüssel-Falle (06.5): Die Cookies waren nie weg, die orange Prüfung fand sie wieder.
Seit 0.6.1 gilt in `deleteWithReport`:

* Fehlgeschlagene → **nur** rote Meldung mit Namen, keine Wiederkehr-Prüfung.
* Alles gelöscht → grün, dann nach 1,5 s prüfen, ob dieselben Cookie-IDs **wieder** existieren →
  nur dann orange („Seite läuft noch …, Blockieren wählen“).

## 7.7 Tabellen: veränderbare Spaltenbreiten (`ui/tables.js`)

Ablauf der Anforderungen (siehe auch [09, E-14](09-designentscheidungen.md#e-14-tabellen-natürliche-breite-einpassen-veränderbar)):
innere Scrollbalken entfernt → Tabelle zu breit bei 1720 px → automatisch einpassen → Benutzer
soll Breiten selbst ändern können, Scrollbalken erlaubt, Standard soll auf den Bildschirm passen.

Umsetzung ohne Eingriff in den Code, der die Tabellen baut:

* `CCTables.observe(container)` – ein `MutationObserver` ruft (gebündelt per
  `requestAnimationFrame`) `enhance()` für jede neue `table.grid` auf.
* `enhance(table)` – hängt an jede Kopfzelle einen Zieh-Griff (`span.cc-col-resize`).
  * Ziehen: aktuelle Breiten einfrieren, Tabelle auf `table-layout: fixed` (`cc-fixed`), Breite der
    Spalte ändern (min. 36 px), am Ende in `localStorage` speichern.
  * Doppelklick: gespeicherte Breiten löschen, wieder automatisch einpassen.
  * Klicks auf den Griff werden gestoppt, damit die Spalte nicht sortiert.
* `fit(table)` – ohne gespeicherte Breiten:
  1. natürliche Breiten messen,
  2. passt alles in den Elterncontainer → fertig,
  3. sonst **nur Textspalten** schmaler machen, proportional zu ihrem Überschuss über 90 px.
     Spalten mit Knöpfen, Auswahlfeldern, Häkchen, Zahlen (`num`, `actions`, `order`, `split`)
     bleiben unangetastet – die werden nie abgeschnitten,
  4. reicht das nicht → Tabelle bleibt breiter, der Container (`.table-scroll`, `overflow-x: auto`)
     zeigt einen waagrechten Scrollbalken.
* Neu einpassen bei Fenstergrösse (150 ms gebündelt) und beim Aufklappen eines `<details>`
  (zugeklappte Tabellen haben Breite 0 und können nicht gemessen werden).
* Zellen sind einzeilig mit „…“; der volle Wert steht im `title` bzw. in der Detailzeile.
* Schlüssel `cc_colw:<pfad>:<spaltennamen>` – ändern sich die Spalten (andere Version, Popup vs.
  Dashboard), passt der alte Wert nicht mehr und wird ignoriert.

## 7.8 Popup-Besonderheiten

* Breite fest (~780 px), Höhe von Firefox auf 600 px begrenzt → Popup scrollt als Ganzes.
* `compact`: weniger Spalten in der Cookie-Tabelle, Website-Daten und Archiv zugeklappt.
* Länger dauernde Aktionen (Bereinigen, Alles löschen) laufen im Hintergrund; das Popup zeigt nur das
  Ergebnis, wenn es dann noch offen ist.
* Interne Seiten (`about:`, `moz-extension:`) haben keine Seite → Popup zeigt einen Hinweis und
  einen Link zum Dashboard.

## 7.9 Hilfe-Tab „Funktionsweise“

`options/help.js` ist nur der Rahmen (Bausteine, Inhaltsverzeichnis); der Text steht pro Sprache in
`locales/help/<code>.js` und wird erst beim Öffnen des Tabs geladen (`I18N.loadExtra("help")`, siehe
7.10). Die Bausteine (`P`, `B`, `TABLE`, `CH` …) bauen den Inhalt mit `el()` (kein HTML-String); das
Inhaltsverzeichnis entsteht aus den Kapiteln (`CH(id, Titel, …)`). Reihenfolge auf Wunsch des
Benutzers: **Teil A – das Add-on** (Aufbau, Entscheidungsreihenfolge, Website-Daten inkl.
sessionStorage-Begründung, Archiv, Rückgängig, Regelfelder, Einrichtung, Grenzen), dann **Teil B –
Grundlagen** für Einsteiger (was Cookies und Website-Daten sind, Attribute, Praxisbeispiele,
Partitionierung, Glossar). Hinweis-Kästen nutzen die Klasse `.callout` (vorher `.note`, kollidierte
mit der Notiz-Spalte der Tabellen).

## 7.10 Sprachen (`lib/i18n.js`, `locales/`)

Die Oberfläche gibt es auf Deutsch (Standard) und Englisch. Kein Text steht mehr im Code: Überall
steht `I18N.t("schlüssel", { platzhalter })`, die Texte liegen in einer Datei pro Sprache.

| Datei | Inhalt |
|---|---|
| `lib/i18n.js` | `LANGUAGES` (Reihenfolge = Sprachknopf), `DEFAULT` (`de`), `FALLBACK` (`en`), `EXTRAS` (welche Sprachen eine Hilfe-Datei haben); `t()`, `init()`, `choose()`, `loadExtra()`, `apply()` |
| `locales/de.js`, `locales/en.js` | alle Texte als `I18N.register("<code>", { "schlüssel": "Text", … })`; Schlüssel nach Bereich benannt (`ck.*` Cookie-Tabelle, `data.*` Website-Daten, `set.*` Einstellungen …) |
| `locales/help/<code>.js` | Hilfe-Tab als Funktion, die aus den Bausteinen von `options/help.js` die Kapitel baut |
| `_locales/<code>/messages.json` | nur die Beschreibung im Add-on-Manager (Firefox-eigenes Format, richtet sich nach der Browsersprache) |

**Texte:** `t("key", { n: 3 })` wählt mit `Intl.PluralRules` `key_one`/`key_other`, falls vorhanden
(z. B. deutscher Tooltip „1 wird … gelöscht“ / „2 werden …“). Ein Wert kann auch eine Funktion sein
(so die Hilfe). Fehlt ein Schlüssel in der aktiven Sprache, gilt Englisch (`en.js` ist die Vorlage
für neue Sprachen), danach der Schlüssel selbst – ein sichtbarer Schlüssel ist also ein Fehler, den
der Oberflächentest findet. Beschriftungen in `lib/core.js` (`ACTION_LABEL`, `CATEGORY_LABEL`,
`STORAGE_LABEL` …) sind Getter, die bei jedem Zugriff übersetzen. Statischer Text in HTML trägt
`data-i18n` bzw. `data-i18n-title`; `I18N.apply()` setzt ihn.

**Laden:** Nur die aktive Sprache und Englisch werden geladen, per `<script>` aus
`moz-extension://…/locales/<code>.js` (Popup, Dashboard und Hintergrundseite haben ein `document`).
Jede Datei wird höchstens einmal angefordert, auch wenn sie als gewählte Sprache und Ersatz zugleich
gebraucht wird. Jeder Kontext ruft vor dem ersten Text `await I18N.init()` auf; Knöpfe und Tabellen
entstehen erst danach (sonst zeigten sie Schlüssel).

**Sprachknopf** (`UI.languageButton()`, oben rechts in Popup und Dashboard): zeigt den aktiven Code
und wechselt reihum zur nächsten Sprache aus `LANGUAGES`. `I18N.choose()` speichert zuerst
`cc_lang` und stellt dann um; `storage.onChanged` erreicht alle offenen Seiten, die sich daraufhin
neu laden (`I18N.onChange(() => location.reload())`). Die Hintergrundseite lädt nicht neu: ihre
Texte (Protokoll, Fehler, Tooltip des Symbols) holen die neue Sprache beim nächsten Zugriff, der
Tooltip wird sofort neu gesetzt. Einträge, die schon im Protokoll stehen, bleiben in der Sprache,
in der sie geschrieben wurden.

**Seitenkontext:** Funktionen aus `lib/pagefns.js` laufen in der Webseite, wo es kein `I18N` gibt.
Ihre wenigen Fehlermeldungen sind darum englisch, wie die des Browsers selbst.

