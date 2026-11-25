/* Cookie Curator – Cache Storage beim Seitenaufruf löschen.
 * Wird von background.js nur für Hosts registriert, deren Cache Storage gelöscht werden soll,
 * während kein Tab offen war (Firefox bietet dafür keine browsingData-Funktion).
 * Läuft in der Welt MAIN bei document_start, also vor den Skripten der Seite. */
(function () {
  "use strict";
  if (typeof caches === "undefined") return;           // kein sicherer Kontext → keine Cache API
  caches.keys().then(names => Promise.all(names.map(n => caches.delete(n)))).catch(() => {});
})();
