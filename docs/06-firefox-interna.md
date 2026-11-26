# 06 – Firefox-Interna

Dieses Kapitel erklärt die Teile von Firefox, die man kennen muss, um das Verhalten des Add-ons zu
verstehen. Die Aussagen zu Quelltext stammen aus dem `omni.ja` von **Firefox 140 ESR**
(`chrome/toolkit/content/extensions/parent/ext-cookies.js`, `ext-browsingData.js`); Grenzwerte
wurden in Firefox 140 gemessen.

## 6.1 Der Cookie-Speicher und OriginAttributes

Firefox speichert alle Cookies eines Profils in einer Datenbank (`cookies.sqlite`, im Speicher als
`nsCookieService`). Ein Cookie ist eindeutig durch:

```
(host, path, name, OriginAttributes)
```

**OriginAttributes** sind die zentrale Trennungs-Struktur von Firefox. Für Cookies relevant:

| Feld | Bedeutung | In der Erweiterungs-API |
|---|---|---|
| `userContextId` | Container (0 = kein Container) | `storeId` = `firefox-default` / `firefox-container-<id>` |
| `privateBrowsingId` | 1 = privates Fenster | `storeId` = `firefox-private` |
| `firstPartyDomain` | First-Party-Isolation (siehe 6.3) | `firstPartyDomain` |
| `partitionKey` | Partitionierung (siehe 6.4) | `partitionKey: { topLevelSite, hasCrossSiteAncestor }` |

Zwei Cookies mit gleichem Namen, gleicher Domain und gleichem Pfad, aber unterschiedlichen
OriginAttributes sind **verschiedene Cookies**. Darum enthält die Cookie-ID des Add-ons
(`CC.cookieId`) Container, firstPartyDomain und Partition:

```
storeId | domain | path | name | firstPartyDomain | topLevelSite
```

## 6.2 Container und private Fenster

* **Container** (Multi-Account Containers bzw. `contextualIdentities`) haben je einen eigenen
  Cookie-Speicher. Die Berechtigung `contextualIdentities` braucht das Add-on nur, um die
  **Namen und Farben** der Container anzuzeigen (`CC.getContainers`); ohne sie wären es nur IDs.
* **Private Fenster:** Cookies im `firefox-private`-Speicher sind nur sichtbar, wenn der Benutzer
  der Erweiterung „In privaten Fenstern ausführen“ erlaubt. Sie werden ohnehin beim Schliessen des
  letzten privaten Fensters verworfen. `browsingData` kann localStorage/IndexedDB im privaten Modus
  nicht löschen (Firefox ignoriert die Anfrage stillschweigend).
* `browsingData.remove` mit `cookieStoreId` funktioniert nur für Cookies, IndexedDB und
  localStorage (letzteres nur mit „Next-Gen LocalStorage“). Das Add-on übergibt bei Website-Daten
  deshalb **keinen** Container – gelöscht wird die Origin in allen Containern.

## 6.3 First-Party-Isolation (FPI)

`privacy.firstparty.isolate = true` (Tor-Browser-Erbe, in Firefox standardmässig aus) trennt
Cookies nach der Domain der Top-Level-Seite im Feld `firstPartyDomain`.

Konsequenz für die API: Ist FPI aktiv und ruft man `cookies.getAll({})` **ohne**
`firstPartyDomain` auf, wirft Firefox den Fehler „First-Party Isolation is enabled, but the required
'firstPartyDomain' attribute was not set.“ Deshalb übergibt das Add-on überall
`firstPartyDomain: null` („alle“) beim Lesen und den genauen Wert beim Löschen/Setzen.

## 6.4 Total Cookie Protection (dFPI, `cookieBehavior = 5`)

Seit Firefox 103 Standard: `network.cookie.cookieBehavior = 5` („reject trackers and partition
foreign“). Ein Cookie, das ein **eingebetteter Drittanbieter** (Iframe, Skript-Anfrage) setzt,
landet in einer **Partition**, die nach der Top-Level-Seite benannt ist. `doubleclick.net` auf
`nzz.ch` und `doubleclick.net` auf `srf.ch` haben getrennte Cookies – sie können Besucher nicht
seitenübergreifend wiedererkennen.

Dasselbe gilt für Website-Daten (localStorage, IndexedDB, … der Iframe liegen unter
`<origin>^partitionKey=…`).

Für die API bedeutet das:

* `cookies.getAll({})` liefert **nur unpartitionierte** Cookies. Für alle braucht es
  `partitionKey: {}`. Das Add-on übergibt beides (`firstPartyDomain: null, partitionKey: {}`) und
  iteriert über alle Cookie-Speicher (`cookies.getAllCookieStores`).
* Partitionierte Cookies ordnet das Add-on der **Top-Level-Seite** zu (`siteKeyForCookie`), denn
  dorthin gehören sie aus Sicht des Benutzers: Löscht man „alles von nzz.ch“, sollen auch die
  Drittanbieter-Cookies weg, die nur auf nzz.ch existieren.

## 6.5 Partitionsschlüssel: neues und altes Format

Intern ist `OriginAttributes.partitionKey` ein **String**. Davon gibt es zwei Formate:

| Format | Beispiel | Entsteht wenn |
|---|---|---|
| neu („site“) | `(https,nzz.ch)`, `(http,localhost,8765)`, `(https,nzz.ch,f)` | `privacy.dynamic_firstparty.use_site = true` (Standard) |
| alt | `nzz.ch` | `use_site = false`, also bei Cookies aus älteren Profilen/Versionen oder mit umgestellter Einstellung |

`,f` steht für „foreign by ancestor context“ (es gibt einen seitenfremden Vorfahren in der
Frame-Kette).

**Beim Lesen** wandelt Firefox beide Formate in das API-Format um (`ext-cookies.js`):

```js
function getExtPartitionKey(cookie) {
  let partitionKey = cookie.originAttributes.partitionKey;
  if (!partitionKey) return null;
  if (!partitionKey.startsWith("(")) {
    // A partitionKey generated with privacy.dynamic_firstparty.use_site=false.
    let hasCrossSiteAncestor = !isSubdomain(cookie.host, partitionKey);
    return { topLevelSite: `https://${partitionKey}`, hasCrossSiteAncestor };
  }
  let [scheme, domain, opt1, opt2] = partitionKey.slice(1, -1).split(",");
  …
}
```

**Beim Löschen/Setzen** geht es umgekehrt (`fromExtPartitionKey`):

```js
return ChromeUtils.getPartitionKeyFromURL(topLevelSite, cookieUrl, hasCrossSiteAncestor);
```

`getPartitionKeyFromURL` erzeugt **immer das Format der aktuellen Einstellung** – also das neue.

**Das Problem:** Ein Cookie mit altem Schlüssel `nzz.ch` wird als `{topLevelSite: "https://nzz.ch"}`
gemeldet. Übergibt man genau das an `cookies.remove`, sucht Firefox nach
`partitionKey = "(https,nzz.ch)"` – und findet nichts. `cookies.remove` liefert trotzdem ein
Ergebnis-Objekt zurück, als hätte es geklappt. Das Cookie ist über `cookies.remove` **nicht
löschbar**.

Nachgestellt wurde das in Firefox 140, indem `use_site` auf `false` gesetzt, ein Drittanbieter-Cookie
erzeugt und die Einstellung zurückgestellt wurde. Version 0.6.0 scheiterte genau daran; 0.6.1
erkennt es durch die Nachprüfung und löscht über `browsingData` (siehe
[04.4/04.5](04-bereinigung.md#44-löschen-mit-prüfung-deletelist)).

## 6.6 browsingData intern

`browsingData` ist die API hinter „Chronik löschen“. Wichtig sind die Unterschiede pro Datentyp:

### Cookies (`clearCookies`)

Mit `hostnames` oder `cookieStoreId` iteriert Firefox über **alle** Cookies des Profils:

```js
for (const cookie of Services.cookies.cookies) {
  if ((!options.hostnames || options.hostnames.includes(cookie.host.replace(/^\./, ""))) &&
      (!options.cookieStoreId || getCookieStoreIdForOriginAttributes(cookie.originAttributes) === options.cookieStoreId)) {
    Services.cookies.remove(cookie.host, cookie.name, cookie.path, cookie.originAttributes);
  }
}
```

* Der Host wird **exakt** verglichen (führender Punkt entfernt). `nzz.ch` trifft `.nzz.ch` und
  `nzz.ch`, aber nicht `www.nzz.ch`.
* Gelöscht wird **mit den eigenen OriginAttributes des Cookies** – egal, welches
  Partitionsformat. Deshalb funktioniert der Ausweichweg.

### localStorage und IndexedDB (`clearQuotaManager`)

1. `Services.qms.getUsage()` liefert alle Origins mit Speicher im Quota-Manager.
2. Nur Schemata `http`, `https`, `file` (keine Erweiterungen, kein `about:`).
3. `principal.hostPort` muss **exakt** in `hostnames` stehen (inkl. Port).
4. Dann `Services.qms.clearStoragesForClient(principal, "idb")` bzw. `(principal, "ls", "default")`.

Für localStorage sendet Firefox zusätzlich die Notification `extension:purge-localStorage` (für die
alte Implementierung). Folge von Schritt 3: Da der Host der eingebetteten Origin verglichen wird,
löscht ein Aufruf mit `hostnames: ["nzz.ch"]` auch partitionierte Daten von `nzz.ch`, die als
Iframe auf anderen Seiten liegen – aber **nicht** Iframe-Daten fremder Hosts unter `nzz.ch`.

Cache Storage (Client `"cache"`) wird von keinem Typ angesprochen. Das Add-on löscht ihn deshalb
selbst per Skript in der Seite (siehe [05.7](05-website-daten.md#57-cache-storage-ab-07)).

### Service Worker

`ServiceWorkerCleanUp.removeFromHost(host)` – meldet alle Registrierungen des Hosts ab, **inklusive
Subdomains** (`Services.eTLD.hasRootDomain(sw.principal.host, host)`). Hier ist Firefox also
grosszügiger als bei den anderen Typen.

### HTTP-Cache (`clearCache`)

```js
Services.clearData.deleteDataFromHost(host, true /* aIsUserRequest */, CLEAR_ALL_CACHES, resolve);
```

Der Kommentar in Firefox erklärt `aIsUserRequest = true`: Unterstützt ein Cache-„Cleaner“ das Löschen
pro Host nicht, **löscht er stattdessen alles**. `CLEAR_ALL_CACHES` umfasst Netzwerk-Cache,
Bild-Cache, CSS-Cache, … – einzelne davon können pro Host nicht löschen. Darum warnt das Add-on
beim Modus „Löschen“ für den HTTP-Cache.

### sessionStorage

Gibt es in `browsingData` nicht. Nur ein Skript in der Seite kann ihn ändern.

## 6.7 Geschützte Domains

`extensions.webextensions.restrictedDomains` listet Domains, auf denen Erweiterungen **keine Skripte
ausführen** dürfen (Schutz der Mozilla-Konten- und Add-on-Infrastruktur):

```
accounts-static.cdn.mozilla.net, accounts.firefox.com, addons.cdn.mozilla.net,
addons.mozilla.org, api.accounts.firefox.com, content.cdn.mozilla.net,
discovery.addons.mozilla.org, install.mozilla.org, oauth.accounts.firefox.com,
profile.accounts.firefox.com, support.mozilla.org, sync.services.mozilla.com
```

Ebenso gesperrt: `about:`-Seiten, `moz-extension://` anderer Erweiterungen, `view-source:`, PDF-
Betrachter, Reader-Ansicht. Auf diesen Seiten zeigt die Live-Ansicht „nicht lesbar“, und
Eintragsregeln greifen nicht. Cookies sind über die Cookie-API weiterhin sichtbar.

## 6.8 Skript-Welten: isolierte Welt, Xray und MAIN

Ein Skript, das eine Erweiterung in eine Webseite einschleust, kann in zwei „Welten“ laufen:

### Isolierte Welt (klassisches Content-Script)

* Eigener JavaScript-Kontext (Sandbox) mit eigener `window`-Sicht. Variablen der Seite sind
  unsichtbar und umgekehrt.
* Firefox verbindet die Welten über **Xray-Wrapper**: Das Content-Script sieht DOM-Objekte der Seite
  „durch Röntgenbrille“ – nur die eingebauten (nativen) Eigenschaften, nie Änderungen, die die
  Seite per JavaScript vorgenommen hat. Das schützt vor manipulierten Prototypen.
* Hat die Seite Zugriff auf `browser.runtime.sendMessage` (nur Content-Script).
* Unterliegt **nicht** der Content Security Policy der Seite.
* Problem: Asynchrone Web-APIs (IndexedDB-Aufzählung, `caches`, `navigator.serviceWorker`) geben
  Objekte zurück, die zur Seite bzw. zur Sandbox gehören. Beim Weiterreichen über die
  Welten-Grenze entstehen Fehler wie „Permission denied to access property“ oder nicht klonbare
  Ergebnisse; der Umweg über `window.wrappedJSObject` (Xray abschalten) funktioniert nur teilweise.
  Der erste Ansatz (`CC.inspectCode`, noch im Code, siehe [10](10-grenzen-tests-erweiterung.md))
  lieferte deshalb für Cache Storage und Service Worker oft leere oder fehlerhafte Daten.

### Welt MAIN (`scripting.executeScript({ world: "MAIN" })`)

* Die Funktion läuft **als wäre sie ein Skript der Seite**: gleiche Globals, gleiche Origin, kein
  Xray. IndexedDB, Cache Storage und Service-Worker-API verhalten sich exakt wie für die Seite.
* Firefox serialisiert die Funktion (`func.toString()`) und führt sie im Seitenkontext aus; die
  Rückgabe wird strukturiert geklont. Daher müssen `PAGE_FNS` in sich geschlossen sein.
* Kein Zugriff auf Erweiterungs-APIs; die Seite könnte theoretisch globale Funktionen
  (`JSON`, `Array.from`) überschrieben haben – für eine Anzeige-Funktion akzeptabel.
* Die Seiten-CSP blockiert diese Ausführung nicht (sie wird nicht als Inline-Skript eingefügt).

**Entscheidung:** Lesen und Einzelaktionen → MAIN. Eintragsregeln beim Laden → isolierte Welt per
`contentScripts.register`: Nur diese API nimmt **Code-Text** an (die Regeln stecken als JSON darin);
eine Registrierung in der Welt MAIN ginge nur mit einer festen Datei, die ihre Regeln dann asynchron
holen müsste. local-/sessionStorage funktionieren über Xray problemlos (synchrone, einfache API), und
die isolierte Welt darf zusätzlich `runtime.sendMessage` für das Protokoll benutzen.

## 6.9 Grenzwerte (gemessen in Firefox 140)

| Grenze | Wert | Einstellung |
|---|---|---|
| Cookies pro Host | 180, beim Überschreiten Kürzung auf 150 (gemessen: 400 gesetzt → 153 übrig) | `network.cookie.maxPerHost`, `network.cookie.quotaPerHost` |
| Cookies gesamt | 3000 | `network.cookie.maxNumber` |
| Grösse pro Cookie | Name + Wert > 4096 Byte → abgelehnt | fest |
| Maximale Laufzeit | 400 Tage (längere `Expires` werden gekürzt) | fest eingebaut (Vorgabe aus RFC 6265bis) |
| localStorage / sessionStorage | ≈ 5 MB pro Origin | `dom.storage.default_quota` |
| IndexedDB / Cache Storage | Anteil am freien Speicher (Quota-Manager, „best effort“) | – |

Die 400-Tage-Grenze erklärt, warum archivierte Cookies mit „Ablauf in 10 Jahren“ beim
Zurückholen höchstens 400 Tage erhalten.

## 6.10 Sitzungswiederherstellung

Firefox' SessionStore speichert pro Tab URL, Formulardaten, Scrollposition **und sessionStorage**
(`sessionstore.jsonlz4`). Bei „Vorherige Sitzung wiederherstellen“ oder nach einem Absturz erhält der
Tab den sessionStorage zurück. Auch Sitzungscookies (ohne Ablaufdatum) überleben dann den
Neustart – Firefox stellt sie bei Sitzungswiederherstellung ebenfalls wieder her. Das ist der Grund,
warum die Bereinigung beim Start nicht auf Sitzungscookies verzichten kann.

Während der Wiederherstellung haben Tabs zunächst `about:blank` oder noch keine URL; deshalb wartet
das Add-on 4 s nach `runtime.onStartup`, bevor es offene Seiten bestimmt.

## 6.11 Manifest V2 in Firefox

Firefox unterstützt MV2 weiterhin vollständig (anders als Chrome) und hat keine Abschaltung
angekündigt. Für dieses Add-on relevante Unterschiede zu MV3:

| Thema | MV2 (verwendet) | MV3 in Firefox |
|---|---|---|
| Hintergrund | dauerhafte Hintergrundseite | Event-Page (wird nach Leerlauf beendet) |
| Timer (Tab-Schliessen-Verzögerung) | `setTimeout` im Speicher, zuverlässig | gehen beim Beenden verloren → `alarms` mit Mindestintervall |
| Code-Registrierung | `contentScripts.register({ js: [{ code }] })` mit Code-Text | `scripting.registerContentScripts` nur mit **Dateien** |
| Host-Rechte | mit der Installation erteilt | optional, Benutzer muss sie einzeln erlauben |

Der dritte Punkt ist der wichtigste: Ohne Code-Text müssten die Eintragsregeln asynchron geholt
werden – zu spät für `document_start`. Siehe [09, E-01](09-designentscheidungen.md#e-01-manifest-v2-mit-dauerhafter-hintergrundseite).

## 6.12 Popup-Lebenszyklus

* Das Popup ist eine eigene Seite, die beim Öffnen geladen und beim Schliessen (Fokusverlust)
  **sofort zerstört** wird – laufende Promises brechen ab.
* `alert()`/`confirm()` sind im Popup nicht verfügbar (bzw. schliessen es). Darum die Zwei-Klick-
  Bestätigung (`UI.confirmButton`).
* Maximalgrösse 800 × 600 px.

## 6.13 `storage.onChanged`

* Feuert in **allen** Kontexten der Erweiterung, auch in dem, der geschrieben hat.
* Liefert `oldValue` und `newValue` als **Kopien** (strukturiert geklont) – Vergleich nur über
  Inhalt (JSON), nie über Objekt-Identität.
* Das Ereignis kann im schreibenden Kontext eintreffen, **bevor** das Promise von
  `storage.local.set` aufgelöst ist. Wer seine eigenen Schreibvorgänge erkennen will, muss sie
  **vor** dem Schreiben vormerken (siehe [07.4](07-oberflaeche.md#74-eigene-speicherungen-erkennen)).
