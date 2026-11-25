# 08 – Rückgängig, Archiv, Protokoll

Drei Funktionen, die „Vergangenheit“ speichern – mit bewusst unterschiedlichem Umfang:

| | Verlauf (Rückgängig) | Cookie-Archiv | Protokoll |
|---|---|---|---|
| Was | Konfiguration | Cookie-Werte | Löschvorgänge |
| Wer schreibt | Hintergrund, automatisch | Benutzer (archivieren) | Hintergrund, automatisch |
| Umkehrbar | ja (Rückgängig/Wiederholen) | ja (Zurückholen) | nein, nur Anzeige |
| Speicher | `cc_history` | `cc_archive` | `cc_log` |

## 8.1 Konfigurations-Verlauf

### Aufzeichnen

Der Hintergrund hört auf `storage.onChanged` für `cc_config` und ruft
`recordHistory(oldValue, newValue)`:

1. War die Änderung ein eigenes Rückgängig/Wiederholen (`historyApplying === newJson`) → nicht
   aufzeichnen, Merker zurücksetzen (**einmalig**).
2. `oldValue` fehlt (erste Änderung nach Installation) → Standardkonfiguration verwenden.
3. Inhaltlich gleich → ignorieren.
4. Beschreibung erzeugen: `CC.describeConfigChange(old, new)` → z. B. „Seite nzz.ch:
   Cookie-Regeln“, „Einstellungen: Verzögerung“.
5. **Zusammenfassen:** Kam der letzte Schritt vor < 300 ms und hat dieselbe Beschreibung, wird kein
   neuer Schritt angelegt – der ältere Ausgangszustand bleibt. So wird z. B. das Tippen in ein
   Notizfeld oder ein technisch doppelter Schreibvorgang nicht zu vielen Einzelschritten.
6. Sonst `{t, label, config: oldValue}` auf den Undo-Stapel (max. 100, älteste fallen raus).
7. Redo-Stapel leeren (neue Änderung verwirft die „Zukunft“).

### Anwenden

`applyHistory("undo", "redo")` bzw. umgekehrt:

1. Obersten Schritt vom Quell-Stapel nehmen.
2. **Aktuelle** Konfiguration (aus dem Speicher, nicht aus dem Hintergrund-Cache) als Schritt auf den
   Ziel-Stapel legen.
3. `historyApplying = JSON(step.config)` setzen, dann `step.config` speichern.

### Warum vollständige Kopien statt Diffs?

Die Konfiguration ist klein (typisch < 50 KB). 100 Kopien sind vertretbar; dafür ist das Anwenden
trivial und robust, auch über Programmversionen hinweg (jede Kopie läuft beim Laden durch
`normalizeConfig`). Diffs müssten mit jeder Schema-Änderung mitgepflegt werden.

### Warum im Hintergrund?

Es gibt mehrere Oberflächen (Popup, mehrere Dashboard-Tabs). Würde jede selbst aufzeichnen, gäbe es
mehrere Verläufe oder doppelte Einträge. Der Hintergrund sieht **jede** Änderung genau einmal,
egal woher.

### Was nicht im Verlauf ist

Cookies, Website-Daten, Archiv und Protokoll. Gelöschte Cookies lassen sich nicht über Rückgängig
zurückholen – dafür gibt es das Archiv. Das steht auch so neben den Knöpfen
(`UI.historyButtons`, mit Tooltip der nächsten Aktion und deren Zeitpunkt).

## 8.2 Cookie-Archiv

### Archivieren

`archive` / `archiveAndDelete` → `withArchive(list => CC.addToArchive(list, cookies, note, max))`.

* **`withArchive`** serialisiert alle Schreibzugriffe über eine Promise-Kette
  (`archiveQueue`): laden → ändern → speichern. Ohne das würden zwei gleichzeitige Aktionen
  (z. B. Archivieren im Popup und Autostart-Häkchen im Dashboard) sich gegenseitig überschreiben
  („lost update“), weil `storage.local` keine Transaktionen kennt.
* Archiv-Einträge enthalten den **vollständigen Cookie** inkl. Partition und Container (siehe
  [02.5](02-datenmodell.md#25-cc_archive)).

### Zurückholen

`restoreEntries(entries)`:

1. Cookie-ID in `restoring` eintragen (Blockier-Logik überspringt sie, 2 s lang).
2. `cookies.set(CC.restoreDetails(cookie, restoreExtendDays))`.

`restoreDetails` übersetzt das gelesene Cookie in Parameter für `cookies.set`:

* `url` aus Secure-Flag, Domain und Pfad (`cookieUrl`) – Firefox verlangt eine URL, für die das
  Cookie gültig wäre.
* `domain` **nur** bei Domain-Cookies (`hostOnly: false`). Wird `domain` angegeben, entsteht immer
  ein Domain-Cookie (`.nzz.ch`) – ein Host-Only-Cookie würde sich verändern.
* `sameSite: "no_restriction"` erzwingt `secure: true` (sonst lehnt Firefox ab).
* `firstPartyDomain` und `partitionKey` werden übernommen.
* Ablauf: liegt das gespeicherte Ablaufdatum noch in der Zukunft (> 60 s) → übernehmen. Sonst um
  `restoreExtendDays` verlängern; bei 0 → **Sitzungscookie** (ohne `expirationDate`).

`cookies.set` liefert `null`, wenn Firefox das Cookie ablehnt (z. B. `__Host-`-Präfix mit Domain,
Secure-Cookie für http-URL). Das wird als Fehler mit Grund gemeldet.

### Autostart

Pro Cookie (gleiche `key`) kann **eine** Version „beim Start zurücksetzen“ markiert sein
(`setAutoRestore` entfernt die Markierung bei den anderen Versionen). Beim Browserstart:
erst Bereinigung, dann `restoreAutostart` (Reihenfolge siehe [04.8](04-bereinigung.md#48-start-ablauf)).

Anwendungsfall: Eine Seite speichert Einstellungen (Sprache, Darstellung, Consent) im Cookie und
„vergisst“ sie oder überschreibt sie mit Tracking-Varianten. Mit Autostart beginnt jede Sitzung mit
dem gewünschten Zustand.

### Wert bearbeiten

`archiveUpdate` mit `patch.value` ändert den gespeicherten Wert – z. B. um einen Consent-String
anzupassen, bevor er zurückgesetzt wird.

## 8.3 Protokoll

`addLog(trigger, cookie, reason, kind)`:

* Nur wenn `logEnabled`.
* Hält das Protokoll **im Speicher** (`log`) und schreibt **gebündelt**: Der erste neue Eintrag
  setzt einen 1,5-s-Timer, danach wird einmal gespeichert. Eine Bereinigung mit 200 Cookies erzeugt
  so einen Schreibvorgang statt 200.
* Ringpuffer mit `logMax` (min. 100).
* Einträge für Website-Daten (`kind: "storage"`) haben statt Cookie-Feldern einen beschreibenden
  Namen („localStorage (komplett)“, Eintragsname) und die Hosts als Domain.

Grenze: Wird Firefox innerhalb der 1,5 s beendet, gehen die letzten Einträge verloren. Akzeptiert,
weil das Protokoll nur der Nachvollziehbarkeit dient.

Das Dashboard liest das Protokoll per Nachricht `getLog` (nicht aus dem Speicher), damit auch noch
nicht geschriebene Einträge sichtbar sind.
