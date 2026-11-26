# 02 – Datenmodell

Alle dauerhaften Daten liegen in **`browser.storage.local`** der Erweiterung, ausser den
Spaltenbreiten (siehe 2.8). `storage.local` ist pro Firefox-Profil, wird nicht synchronisiert und
überlebt Neustarts und Updates der Erweiterung. Beim **Deinstallieren** löscht Firefox ihn.

## 2.1 Übersicht der Schlüssel

| Schlüssel | Inhalt | Geschrieben von | Grösse |
|---|---|---|---|
| `cc_config` | Gesamte Konfiguration (Einstellungen, Kategorien, Regeln, Seiten) | Oberflächen (direkt), Hintergrund (Undo/Redo, „Alles löschen“) | klein (KB) |
| `cc_archive` | Archivierte Cookie-Versionen | nur Hintergrund (serialisiert) | wächst mit Archiv |
| `cc_log` | Protokoll (Ringpuffer) | nur Hintergrund (gepuffert) | max. `logMax` Einträge |
| `cc_history` | Rückgängig-/Wiederholen-Stapel mit vollständigen Konfigurationskopien | nur Hintergrund | bis 100 × Konfiguration |
| `cc_hosts` | Host-Register: Seite → besuchte Hosts | nur Hintergrund (gepuffert) | max. 300 Hosts pro Seite |
| `cc_cachepurge` | Hosts, deren Cache Storage beim nächsten Aufruf gelöscht wird | nur Hintergrund (gepuffert) | max. 500 Hosts, verfallen nach 90 Tagen |
| `cc_lang` | Gewählte Sprache der Oberfläche (`"de"`, `"en"`); fehlt = Deutsch | Oberflächen (Sprachknopf) | ein Wort |

Konstanten: `CC.CONFIG_KEY`, `CC.LOG_KEY`, `CC.ARCHIVE_KEY` (in `lib/core.js`), `HISTORY_KEY`,
`HOSTS_KEY`, `CACHEPURGE_KEY` (in `background.js`), `I18N.STORAGE_KEY` (in `lib/i18n.js`).

## 2.2 `cc_config`

```jsonc
{
  "version": 1,
  "settings": {
    "defaultAction": "keep",          // Standard für übrige Cookies: keep | delete
    "cleanOnTabClose": true,
    "tabCloseDelaySec": 15,
    "cleanOnStartup": true,
    "periodicMinutes": 0,             // 0 = aus
    "skipOpenSites": true,            // Start/Intervall/„Alles bereinigen“: Seiten mit offenen Tabs auslassen
    "enforceBlock": true,             // Aktion „block“ sofort durchsetzen
    "badge": "pending",               // pending | total | off
    "logEnabled": true,
    "logMax": 2000,
    "extraSuffixes": "",              // zusätzliche Public Suffixes, eine pro Zeile
    "restoreOnStartup": true,         // Archiv-Autostart
    "restoreExtendDays": 30,          // abgelaufene Archiv-Versionen verlängern (0 = Sitzungscookie)
    "archiveMaxVersions": 5,
    "storage": {                      // globale Modi Website-Daten
      "localStorage": "keep", "sessionStorage": "keep", "indexedDB": "keep",
      "cacheStorage": "keep", "serviceWorkers": "keep", "cache": "keep"
    },
    "categories": { "consent": "keep", "auth": "keep", "tracking": "delete" } // keep|delete|block|none
  },
  "categoryPatterns": {               // Namensmuster je Kategorie: Glob oder /regex/flags
    "consent": ["*consent*", "OptanonAlertBoxClosed", …],
    "tracking": ["_ga", "_ga_*", "_gid", …],
    "auth": ["*sess*", "PHPSESSID", …]
  },
  "globalRules": [ /* Cookie-Regeln, siehe 2.3 */ ],
  "sites": {
    "nzz.ch": {
      "defaultAction": "inherit",     // inherit | keep | delete
      "tabClose": "inherit",          // inherit | on | off
      "categories": { "consent": "inherit", "auth": "inherit", "tracking": "inherit" },
      "rules": [ /* Cookie-Regeln der Seite */ ],
      "note": "",
      "storage": {
        "localStorage": "inherit",    // inherit | keep | delete | selective
        "sessionStorage": "inherit",  // inherit | keep | selective
        "indexedDB": "inherit",       // inherit | keep | delete
        "cacheStorage": "inherit",    // inherit | keep | delete (ab 0.7)
        "serviceWorkers": "inherit",
        "cache": "inherit",
        "keyDefault": "keep",         // selektiv: Einträge ohne passende Regel
        "keyRules": [ /* Eintragsregeln, siehe 2.4 */ ]
      }
    }
  }
}
```

### Normalisierung statt Migration

`CC.normalizeConfig(cfg)` füllt fehlende Felder mit Standardwerten auf – Ebene für Ebene
(`settings`, `settings.categories`, `settings.storage`, jede Seite inkl. `storage`, jede Regel über
`newRule`/`newKeyRule`). Jede gelesene Konfiguration läuft hier durch (`loadConfig`, Import,
`storage.onChanged` im Hintergrund).

**Warum:** Jede neue Funktion (Archiv-Einstellungen, Website-Daten, …) brachte neue Felder. Statt
Migrationsskripten pro Version wird beim Lesen ergänzt. Alte Konfigurationen und Importe aus älteren
Versionen funktionieren dadurch ohne Sonderfälle. Das Feld `version` ist vorhanden, wird aber erst
gebraucht, wenn sich die *Bedeutung* eines Feldes ändert.

### Leere Seiten werden nicht gespeichert

`CC.saveConfig(cfg)` speichert eine **Kopie**, aus der Seiten entfernt sind, die nur
Standardwerte enthalten (`isSiteConfigEmpty`). So erscheinen in der Übersicht nur wirklich
konfigurierte Seiten als „konf.“. Das Original-Objekt der Oberfläche bleibt unverändert – sonst
würden Objektreferenzen in der Oberfläche plötzlich ins Leere zeigen (früher ein Fehler, siehe
[09, E-12](09-designentscheidungen.md)).

## 2.3 Cookie-Regel

```jsonc
{
  "id": "r…",           // zufällig, stabil
  "enabled": true,
  "match": "exact",     // exact | glob | regex
  "name": "_ga*",       // Cookie-Name bzw. Muster
  "domain": "",         // Glob auf Cookie-Domain ohne führenden Punkt, leer = alle
  "path": "",           // Glob auf Pfad, leer = alle
  "store": "",          // cookieStoreId (Container), leer = alle
  "action": "delete",   // keep | delete | block
  "note": "",
  "quick": true         // optional: Schnellregel aus der Cookie-Tabelle
}
```

* **Reihenfolge = Priorität.** Die erste passende aktive Regel gewinnt.
* **Schnellregeln** (`quick: true`) entstehen über das Auswahlfeld „Regel“ in der Cookie-Tabelle:
  exakter Name, ohne Domain/Pfad/Container, werden **oben** eingefügt, damit sie sicher greifen.
  Pro Name gibt es höchstens eine Schnellregel; „Auto“ entfernt sie wieder.

## 2.4 Eintragsregel (local-/sessionStorage)

```jsonc
{ "id": "k…", "enabled": true, "store": "both",   // both | local | session
  "match": "glob", "name": "_ga*", "action": "delete",  // keep | delete
  "note": "", "quick": false }
```

Im Code heissen sie aus historischen Gründen `keyRules` (frühere Bezeichnung „Schlüsselregel“).

## 2.5 `cc_archive`

Array von Einträgen; ein Cookie kann mehrere Versionen haben.

```jsonc
{
  "aid": "a…",                 // Archiv-ID
  "key": "<cookieId>",         // gleiche ID = gleiches Cookie (Versionen)
  "site": "nzz.ch",
  "savedAt": 1793018000000,
  "note": "",
  "autoRestore": false,        // beim Browserstart zurücksetzen (pro key höchstens einer)
  "cookie": { "name", "value", "domain", "hostOnly", "path", "secure", "httpOnly", "sameSite",
              "session", "expirationDate", "storeId", "firstPartyDomain", "partitionKey" }
}
```

* `addToArchive` überspringt Versionen, die der neuesten **inhaltlich gleichen**
  (`sameCookieContent`: Wert, Ablauf, Secure, HttpOnly, SameSite, Pfad).
* Pro Cookie bleiben `archiveMaxVersions` Versionen; Autostart-Versionen werden nie automatisch
  entfernt. Sortierung „neueste zuerst“ mit der Einfügereihenfolge als Gleichstand-Entscheid (zwei
  Versionen in derselben Millisekunde – ein früher gefundener Fehler).

## 2.6 `cc_log`

```jsonc
{ "t": 1793018000000, "trigger": "tab-close",   // tab-close | startup | interval | manual | block |
                                                //   restore | startup-restore | page-load
  "kind": "cookie",                             // cookie | storage
  "site": "nzz.ch", "name": "_ga", "domain": ".nzz.ch", "path": "/",
  "storeId": "firefox-default", "partitioned": false, "reason": "Kategorie Tracking (global, Muster _ga)" }
```

Ringpuffer: beim Überschreiten von `logMax` werden die ältesten verworfen. Geschrieben wird
gebündelt 1,5 s nach dem ersten neuen Eintrag (siehe [08](08-verlauf-archiv-protokoll.md)).

## 2.7 `cc_history`, `cc_hosts` und `cc_cachepurge`

```jsonc
// cc_history
{ "undo": [ { "t": …, "label": "Seite nzz.ch: Cookie-Regeln", "config": { /* vollständige Konfiguration */ } } ],
  "redo": [ … ] }

// cc_hosts
{ "nzz.ch": ["nzz.ch", "www.nzz.ch", "epaper.nzz.ch"], "localhost": ["localhost:8765"] }

// cc_cachepurge (Hostname ohne Port → Seite und Zeitpunkt des Vormerkens)
{ "nzz.ch": { "site": "nzz.ch", "t": 1793018000000 }, "epaper.nzz.ch": { "site": "nzz.ch", "t": 1793018000000 } }
```

Ältere Konfigurationen ohne `cacheStorage` erhalten den Wert durch `normalizeConfig` automatisch
(global `keep`, pro Seite `inherit`).

## 2.8 `cc_lang`

Nur der Sprachcode als Zeichenkette, z. B. `"en"`. Liegt bewusst **nicht** in `cc_config`: Ein
Sprachwechsel ist keine Konfigurationsänderung, soll nicht im Verlauf für Rückgängig landen und
nicht im Export (siehe [09, E-19](09-designentscheidungen.md#e-19-eigene-übersetzungen-statt-browseri18n)).
Unbekannte oder fehlende Werte ergeben die Standardsprache Deutsch (`I18N.DEFAULT`).

## 2.9 Spaltenbreiten (`localStorage` der Erweiterungsseiten)

Schlüssel `cc_colw:<seite>:<spaltennamen>` → Array von Pixelbreiten. Liegt bewusst **nicht** in
`storage.local`: Es ist eine reine Anzeige-Vorliebe pro Gerät, soll nicht im Export landen und
nicht den Konfigurations-Verlauf (Rückgängig) auslösen. Popup und Dashboard haben unterschiedliche
Schlüssel, weil der Seitenpfad Teil des Schlüssels ist.

## 2.10 Import/Export

Export (Dashboard → Import / Export) schreibt `{ exportedAt, config, archive }` als JSON. **Das
Archiv kann Login-Cookies enthalten** – die Oberfläche weist darauf hin. Import:

* *Zusammenführen:* Seiten aus der Datei überschreiben gleichnamige Seiten, globale Regeln werden
  ergänzt (nach `id`), Archiv-Einträge ergänzt (nach `aid`).
* *Ersetzen:* Konfiguration komplett ersetzen, Archiv ersetzen, falls in der Datei enthalten.

Beide Wege laufen durch `normalizeConfig` und sind über den Verlauf rückgängig zu machen
(Konfiguration, nicht Archiv).
