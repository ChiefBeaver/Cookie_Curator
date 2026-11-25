# Cookie Curator – Technische Dokumentation

Diese Dokumentation beschreibt, **wie das Add-on aufgebaut ist, warum es so gebaut ist und welche
Firefox-Interna man kennen muss**, um es zu verstehen oder weiterzuentwickeln. Sie richtet sich an
Entwickler; die Bedienung für Endanwender steht im Dashboard unter *Funktionsweise* und in der
`README.md` im Hauptordner.

Stand: Version **0.7.0**, getestet mit **Firefox 140 ESR** (Mindestversion laut Manifest).

## Inhalt

| Kapitel | Inhalt |
|---|---|
| [01 – Architektur](01-architektur.md) | Komponenten, Ausführungskontexte, Dateien, Ladereihenfolge, Nachrichtenfluss |
| [02 – Datenmodell](02-datenmodell.md) | Alle Speicher-Schlüssel, Schema der Konfiguration, Regeln, Archiv, Protokoll, Verlauf, Migration |
| [03 – Entscheidungslogik](03-entscheidungslogik.md) | Wie für jedes Cookie und jeden Eintrag „Behalten / Löschen / Blockieren“ entschieden wird |
| [04 – Bereinigung und Löschen](04-bereinigung.md) | Auslöser, Tab-Verfolgung, Löschpfade, Prüfung, Ausweichweg, Blockieren, „Alles löschen“ |
| [05 – Website-Daten](05-website-daten.md) | localStorage, sessionStorage, IndexedDB, Cache Storage, Service Worker, HTTP-Cache |
| [06 – Firefox-Interna](06-firefox-interna.md) | Cookie-Speicher, OriginAttributes, Container, Partitionierung, browsingData, Skript-Welten, Grenzwerte |
| [07 – Oberfläche](07-oberflaeche.md) | Popup, Dashboard, Seiten-Editor, Rendering, Tabellen, Bestätigungen, Meldungen |
| [08 – Rückgängig, Archiv, Protokoll](08-verlauf-archiv-protokoll.md) | Konfigurations-Verlauf, Cookie-Archiv mit Autostart, Protokoll |
| [09 – Designentscheidungen](09-designentscheidungen.md) | Entscheidungen mit Alternativen und Begründung, inkl. Lehren aus Fehlern |
| [10 – Grenzen, Tests, Erweiterung](10-grenzen-tests-erweiterung.md) | Bekannte Grenzen, technische Schulden, Teststrategie, wie man erweitert |

## Lesereihenfolge

* **Schneller Überblick:** 01 → 03 → 09.
* **Etwas ändern wollen:** 01 → 02 → das betroffene Kapitel → 10.
* **Ein seltsames Verhalten verstehen** (Cookie lässt sich nicht löschen, Speicher nicht lesbar, …): 06.

## Begriffe, die überall vorkommen

| Begriff | Bedeutung im Code |
|---|---|
| **Seite** (`site`) | Registrierbare Domain (eTLD+1), z. B. `nzz.ch`. Gruppierungsschlüssel für alles. |
| **Host** | Vollständiger Rechnername, z. B. `www.nzz.ch` (bei Website-Daten inkl. Port). |
| **Origin** | Protokoll + Host + Port. Grenze, an der Website-Daten getrennt sind. |
| **Cookie-ID** (`cookieId`) | Eindeutiger Schlüssel eines Cookies: Container, Domain, Pfad, Name, firstPartyDomain, Partition. |
| **Website-Daten** | Alle lokalen Speicher ausser Cookies (Begriff von Firefox: „Cookies und Website-Daten“). |
| **Eintrag / Eintragsregel** | Name-Wert-Paar in local-/sessionStorage bzw. die Regel dafür (im Code `keyRules`). |
| **Bereinigung** | Löschen nach Richtlinie (Tab zu, Start, Intervall, manuell). |
| **Partition** | Getrennter Cookie-/Speicherbereich für eingebettete Inhalte (Total Cookie Protection). |
