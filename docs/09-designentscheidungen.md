# 09 – Designentscheidungen

Jede Entscheidung im Format: **Kontext → Entscheidung → Alternativen → Folgen.** Am Ende stehen die
Lehren aus Fehlern, die während der Entwicklung aufgetreten sind.

---

### E-01 Manifest V2 mit dauerhafter Hintergrundseite

**Kontext:** Das Add-on braucht Timer für das Bereinigen nach Tab-Schliessen (Sekunden genau),
einen Speicher-Cache für Tab→Seite und muss Code-Text bei `document_start` registrieren.

**Entscheidung:** MV2, `background.scripts` ohne `"persistent": false`.

**Alternativen:**
* *MV3 mit Event-Page:* Hintergrund wird nach ~30 s Leerlauf beendet → `setTimeout` geht verloren,
  `alarms` haben in Firefox eine Mindestauflösung, Tab-Zuordnung müsste ständig aus
  `storage.session` rekonstruiert werden. `scripting.registerContentScripts` nimmt nur Dateien,
  keinen Code-Text (siehe [06.11](06-firefox-interna.md#611-manifest-v2-in-firefox)).
* *MV2 mit Event-Page* (`persistent: false`): dieselben Timer-Probleme.

**Folgen:** Einfacher, zuverlässiger Code. Speicherbedarf einer dauerhaften Seite (wenige MB) ist
vernachlässigbar. Bei einer späteren MV3-Umstellung sind Tab-Tracking, Timer und
Seitenskript-Registrierung umzubauen (siehe [10.4](10-grenzen-tests-erweiterung.md#104-erweiterung)).

---

### E-02 Lesen direkt, Regeln pro Seite statt pro Cookie gespeichert

**Kontext:** Cookies kommen und gehen ständig; die Konfiguration soll stabil sein.

**Entscheidung:** Die Konfiguration speichert **Regeln** (Namen, Muster), nie einzelne Cookies.
Die Entscheidung wird bei jedem Anzeigen und Bereinigen neu berechnet (`CC.evaluate`).

**Alternativen:** Pro Cookie ein gespeicherter Status (wie manche Cookie-Manager). Nachteil: Ein
Cookie, das neu gesetzt wird (neuer Name-Suffix wie `_ga_ABC123`), wäre unbekannt; die
Konfiguration wüchse unbegrenzt.

**Folgen:** Schnellregeln (Auswahlfeld in der Cookie-Tabelle) geben trotzdem das Gefühl
„pro Cookie“ – sie sind aber exakte Namensregeln.

---

### E-03 Schreibende Aktionen nur im Hintergrund

**Kontext:** Popup und Dashboard können jederzeit geschlossen werden; mehrere Oberflächen können
gleichzeitig offen sein.

**Entscheidung:** Oberflächen dürfen **lesen** (Cookies, Konfiguration, Archiv) und die
**Konfiguration schreiben**. Alles andere – Cookies löschen/setzen, Website-Daten löschen, Archiv
ändern, Protokoll, Verlauf – geht per Nachricht an den Hintergrund.

**Begründung:**
* Ein Popup, das während eines Löschvorgangs geschlossen wird, bricht mitten ab. Im Hintergrund
  läuft der Vorgang zu Ende.
* Ein einziger Schreiber für Archiv und Protokoll verhindert Überschreib-Konflikte (`withArchive`).
* Protokoll und Verlauf entstehen an **einer** Stelle – jede Löschung wird protokolliert, egal von
  wo ausgelöst.
* Die Prüf- und Ausweichlogik beim Löschen (04.4/04.5) existiert nur einmal.

**Warum darf die Oberfläche die Konfiguration selbst schreiben?** Konfigurationsänderungen sind
kleine, sofortige Schreibvorgänge ohne Nebenwirkungen; der Hintergrund bekommt sie über
`storage.onChanged` mit und reagiert (Verlauf, Alarm, Seitenskripte). Ein Umweg über Nachrichten
hätte nur zusätzliche Latenz gebracht.

---

### E-04 Gemeinsamer Seiten-Editor für Popup und Dashboard

**Entscheidung:** Eine Klasse `UI.SiteEditor` mit Schalter `compact`.

**Alternative:** Zwei getrennte Oberflächen. Früher Ansatz – führte dazu, dass Funktionen in einer
Ansicht fehlten oder anders hiessen.

**Folgen:** Jede neue Funktion ist automatisch in beiden verfügbar. Das Popup muss mit wenig Platz
auskommen → `compact` blendet Spalten aus und klappt Bereiche zu.

---

### E-05 Klassische Skripte und globale Namensräume

**Kontext:** Code muss in Hintergrund, Popup und Dashboard geteilt werden.

**Entscheidung:** Klassische `<script>`-Dateien, jede als IIFE, die genau **ein** globales Objekt
(`CC`, `PAGE_FNS`, `UI`, `CCTables`, `buildHelp`) exportiert. Kein Build-Schritt, keine
Bibliotheken.

**Alternativen:**
* *ES-Module* (`type="module"`): in Erweiterungsseiten möglich, aber MV2-Hintergrund-`scripts` sind
  klassisch; man bräuchte eine `background.html` mit Modul-Import. Gewinn gering.
* *Bundler (webpack/rollup) + npm-Bibliotheken:* Bei der Mozilla-Prüfung muss dann der Quellcode
  mit Build-Anleitung eingereicht werden; Abhängigkeiten müssen geprüft werden. Für ~4000 Zeilen
  unverhältnismässig.

**Folgen:** Was im ZIP liegt, ist genau das, was läuft – lesbar und prüfbar. Die Ladereihenfolge
in den HTML-Dateien/Manifest muss stimmen (siehe [01.3](01-architektur.md#13-ladereihenfolge)).
`lib/core.js` darf keine DOM-APIs verwenden (läuft auch im Hintergrund); `PAGE_FNS`-Funktionen
dürfen nichts ausserhalb ihrer selbst referenzieren.

---

### E-06 Kategorien über Namensmuster

**Kontext:** Ziel des Benutzers: Login- und Consent-Cookies behalten, den Rest löschen.

**Entscheidung:** Drei Kategorien (Consent, Tracking, Login/Session) mit editierbaren Glob/Regex-
Listen. Die Muster sind von Hand zusammengestellt aus bekannten Consent-Plattformen (OneTrust,
Cookiebot, Usercentrics, Didomi, Quantcast, …), Analytics/Werbe-Anbietern (Google, Meta, Hotjar,
Matomo, …) und gängigen Session-Namen von Frameworks (PHPSESSID, JSESSIONID, connect.sid,
laravel_session, …).

**Alternativen:**
* *Externe Datenbank* (z. B. Open Cookie Database, Cookiepedia): genauer, aber Netzwerkzugriff
  oder grosse mitgelieferte Datei, Lizenzfragen, Aktualisierung.
* *Heuristik über Attribute* (HttpOnly → Login): unzuverlässig.

**Folgen:** Erkennung ist bewusst grob, transparent (Spalte „Begründung“ zeigt das Muster) und
übersteuerbar (Regeln haben Vorrang). Reihenfolge Consent → Tracking → Login, siehe
[03.2](03-entscheidungslogik.md#32-cookie-behalten-löschen-oder-blockieren).

---

### E-07 Blockieren über `cookies.onChanged` statt `webRequest`

**Entscheidung:** „Blockieren“ löscht ein Cookie sofort nach dem Setzen.

**Alternative:** `webRequest.onHeadersReceived` mit `blocking` und `Set-Cookie`-Header entfernen.
Verhindert das Setzen wirklich – aber nur für HTTP-gesetzte Cookies (nicht `document.cookie`),
braucht die Berechtigungen `webRequest`/`webRequestBlocking`, verlangsamt jede Anfrage und
kollidiert mit anderen Erweiterungen (uBlock Origin), die Header verändern.

**Folgen:** Einfach, deckt beide Quellen ab. Nachteil: Ein Cookie existiert für Millisekunden; eine
Seite kann es in dieser Zeit lesen oder mit einer parallelen Anfrage mitschicken. In der Hilfe so
dokumentiert.

---

### E-08 Kompakte Public-Suffix-Liste

**Entscheidung:** Eingebaute Liste der häufigsten mehrteiligen Suffixes + Benutzer-Ergänzungen.

**Alternativen:** Vollständige PSL (~250 KB, laufende Pflege) oder Firefox' `Services.eTLD` (für
Erweiterungen nicht zugänglich).

**Folgen:** Bei exotischen Suffixes (z. B. `*.myshopify.com`) werden Seiten falsch zusammengefasst,
bis der Benutzer den Suffix ergänzt. In den Einstellungen dokumentiert.

---

### E-09 Website-Daten: ganze Speicherart oder einzelne Einträge

**Kontext:** Anforderung „Konfiguration für alle anderen Arten von lokalem Speicher“.

**Entscheidung:** Pro Speicherart ein Modus. „Selektiv“ (Eintragsregeln) nur für local- und
sessionStorage. Für IndexedDB/Cache/Service Worker nur „Behalten/Löschen“ plus Einzelaktionen in
der Live-Ansicht.

**Begründung:** local-/sessionStorage sind einfache Schlüssel-Wert-Speicher, synchron, und dort
legen Tracker typischerweise einzelne IDs ab. IndexedDB-Datenbanken sind strukturierte Daten einer
App – teilweise löschen zerstört sie meist; Regeln für „Object Store X in DB Y“ wären kaum
verständlich. Firefox bietet ausserdem nur für ganze Hosts eine Lösch-API.

---

### E-10 Eintragsregeln nur pro Seite, nicht global

**Entscheidung:** Keine globalen Eintragsregeln.

**Begründung:** Eine globale Regel müsste per Content-Script in **jede** Seite eingeschleust werden
(`<all_urls>`, `document_start`). Das kostet bei jedem Seitenaufruf Zeit und vergrössert die
Angriffsfläche. Pro Seite wird nur dort Code ausgeführt, wo der Benutzer es ausdrücklich will.

---

### E-11 sessionStorage hat Regeln, aber keinen Modus „Löschen“

Siehe [05.4](05-website-daten.md#54-warum-regeln-für-sessionstorage). Kurz: Er überlebt
Sitzungswiederherstellung und Tab-Duplizieren; „Löschen bei Bereinigung“ ergibt keinen Sinn, weil
bereinigt wird, wenn kein Tab offen ist, und `browsingData` ihn nicht kennt.

---

### E-12 `saveConfig` speichert eine bereinigte Kopie

**Kontext:** Seiten, die nur Standardwerte haben, sollen nicht als „konfiguriert“ gelten.

**Entscheidung:** `saveConfig` entfernt leere Seiten aus einer **Kopie**, nicht aus dem Objekt der
Oberfläche.

**Lehre:** Eine frühere Version entfernte sie im Original. Der Seiten-Editor hielt danach eine
Referenz auf das entfernte Seitenobjekt; die nächste Änderung landete in einem Objekt, das nicht
mehr in der Konfiguration hing, und ging verloren.

---

### E-13 Verifizieren nach dem Löschen

Siehe [04.4](04-bereinigung.md#44-löschen-mit-prüfung-deletelist). Kurz: Keiner Erfolgsmeldung
einer API trauen, deren Rückgabewert nicht garantiert, dass etwas passiert ist. Kosten: ein
zusätzlicher `getAll` pro Cookie (in der Praxis wenige Millisekunden).

---

### E-14 Tabellen: natürliche Breite, einpassen, veränderbar

**Verlauf der Anforderungen:**

1. Erste Version: Übersicht in einem Container mit eigener Scrollbar → „sieht schlecht aus“.
2. Scrollbar entfernt → bei 1720 px Fensterbreite liefen Tabellen über den Rand, Domainnamen
   wurden mitten im Wort umgebrochen.
3. Feste Breiten/Umbruchregeln → passte, aber Benutzer wollte selbst anpassen können;
   Scrollbalken sind dann in Ordnung.
4. Endstand: veränderbare Breiten + automatisches Einpassen als Standard (siehe
   [07.7](07-oberflaeche.md#77-tabellen-veränderbare-spaltenbreiten-uitablesjs)).

**Entscheidung:** Allgemeiner Aufsatz `ui/tables.js`, der jede `table.grid` erkennt – statt jede
Tabelle einzeln anzupassen. Nur Textspalten werden verschmälert; Bedienelemente nie.

**Lehre:** Bei Layout-Fragen früh an der tatsächlichen Bildschirmbreite des Benutzers testen
(hier mit Selenium in echtem Firefox bei 1720 px).

---

### E-15 Zwei-Klick-Bestätigung mit stabiler ID

Siehe [07.5](07-oberflaeche.md#75-zwei-klick-bestätigung-confirmbutton).

---

### E-16 Rückgängig nur für Konfiguration

**Entscheidung:** Verlauf umfasst nur `cc_config`. Gelöschte Cookies sind über das Archiv
wiederherstellbar, nicht über Rückgängig.

**Begründung:** Ein „Rückgängig“ für Löschungen müsste vor jeder Bereinigung alle Cookies sichern
(also auch Login-Tokens dauerhaft speichern) – das widerspricht dem Zweck des Add-ons. Das Archiv
ist dagegen eine **bewusste** Handlung des Benutzers.

---

### E-17 Keine eigenen Cookies, keine Datenübertragung

Das Add-on setzt keine Cookies, nutzt kein Netzwerk und überträgt keine Daten
(`data_collection_permissions: none` im Manifest). Alle Daten liegen in `storage.local`.
Der Export ist eine lokale Datei – mit dem Hinweis, dass das Archiv Login-Cookies enthalten kann.

---

### E-18 Cache Storage: sofort im offenen Tab, sonst beim nächsten Aufruf

**Kontext:** Firefox bietet Erweiterungen keine Möglichkeit, Cache Storage pro Host zu löschen
(05.7). Bis 0.6.1 blieb er deshalb bei Bereinigung und „Alles löschen“ stehen.

**Entscheidung:** Offene Tabs sofort per `PAGE_FNS.purgeCaches` (Welt MAIN); alle anderen Hosts
vormerken und beim nächsten Aufruf mit einem einmalig laufenden, registrierten Skript
(`page/cache-purge.js`, Welt MAIN, `document_start`) löschen.

**Alternativen:**
* *Unsichtbaren Tab öffnen und dort löschen:* Firefox hat keine wirklich versteckten Tabs; der
  Benutzer sähe Tabs aufblitzen, die Seite würde geladen (Netzwerkzugriffe, Tracking).
* *Iframe in der Hintergrundseite:* Wegen Total Cookie Protection läge ihr Speicher in einer
  Partition unter der Erweiterung, nicht im echten Speicher der Seite – wirkungslos.
* *Ganzen Speicher über „Chronik löschen“:* betrifft alle Seiten, widerspricht dem Zweck.
* *Nur anzeigen (Stand 0.6.1):* „Alles löschen“ hätte nicht gehalten, was es verspricht.

**Folgen:** Wirksam, ohne sichtbare Nebenwirkungen; die Löschung ist bei geschlossenen Seiten
verzögert und das in Oberfläche, Protokoll und Hilfe so benannt. Die Daten sind bis dahin nur für die
Seite selbst lesbar, und vor deren Skripten wird gelöscht.

---

### E-19 Eigene Übersetzungen statt `browser.i18n`

**Entscheidung:** Texte in `locales/<code>.js`, übersetzt mit `I18N.t()` aus `lib/i18n.js`; die Wahl
liegt in `cc_lang`. Firefox' `_locales/` nur für die Beschreibung im Add-on-Manager.

**Alternative:** `browser.i18n.getMessage()` mit `_locales/<code>/messages.json`.

**Begründung:** `browser.i18n` folgt immer der Sprache von Firefox; eine Erweiterung kann sie nicht
umschalten. Gewünscht ist aber ein Knopf, mit dem man die Sprache unabhängig vom Browser wählt, und
Deutsch als Standard auch in einem englischen Firefox. Ausserdem braucht die Hilfe Text mit
Auszeichnung (fett, Code, Tabellen), was in `messages.json` nur als HTML-Zeichenkette ginge – die
Oberfläche fügt aber grundsätzlich kein HTML ein (7.1). Eigene JS-Dateien erlauben Funktionen als
Werte (Hilfe) und Mehrzahlformen über `Intl.PluralRules`.

**Folgen:** Eine neue Sprache braucht eine Datei und eine Zeile in `LANGUAGES` (10.4). Ein Test
prüft, dass jede Sprachdatei genau die Schlüssel von `en.js` hat.

---

### E-20 Sprache nicht in der Konfiguration

**Entscheidung:** `cc_lang` ist ein eigener Schlüssel, nicht Teil von `cc_config`.

**Begründung:** Jede Änderung an `cc_config` landet im Verlauf (E-16) und im Export. Ein
Sprachwechsel ist eine Anzeige-Vorliebe wie die Spaltenbreiten (2.9): Er soll weder mit ↶
rückgängig gemacht werden noch beim Import die Sprache eines anderen Geräts übernehmen.

---

## Lehren aus Fehlern

| Symptom (Benutzer) | Ursache | Lehre |
|---|---|---|
| Regel kommt beim Wiederholen nicht wieder | Eigene Speicherung per Inhaltsvergleich erkannt | Eigene Schreibvorgänge mit einer Einmal-Marke **vor** dem Schreiben vormerken (07.4) |
| Löschen-Knopf reagiert nicht | Neuzeichnen zwischen zwei Klicks setzte Knopf zurück | UI-Zustand an inhaltliche IDs binden, nicht an DOM-Elemente (07.5) |
| Rot „nicht gelöscht“, dann orange „wieder gesetzt“ | `cookies.remove` meldet Erfolg, trifft aber Cookies mit altem Partitionsformat nicht | API-Erfolg verifizieren; Firefox-Quelltext lesen; Fehler durch Umstellen der Einstellung nachstellen (06.5) |
| Live-Ansicht zeigt nur local-/sessionStorage | Xray-Grenze der isolierten Welt | Welt MAIN für Seiten-APIs (06.8) |
| Tabellen sehen schlecht aus | Layout nur bei einer Breite getestet | An der realen Breite testen; Benutzer die Kontrolle geben (E-14) |
| „null“ im Kopf der Website-Daten | `append(null)` hängt den Text „null“ an | `el()` filtert `null`; direkte `append`-Aufrufe ebenso absichern |
| Hinweis-Kasten in der Hilfe falsch formatiert | CSS-Klasse `.note` doppelt verwendet | Eindeutige Klassennamen (`.callout`) |
| Cache Storage blieb nach „Alles löschen“ stehen (beim Schreiben dieser Doku gefunden) | Annahme, `browsingData` Typ `indexedDB` lösche den ganzen Quota-Manager-Speicher | Firefox-Quelltext prüfen statt annehmen; Verhalten im echten Browser nachweisen (E-18) |
