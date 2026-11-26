/* Cookie Curator – Funktionen, die im Kontext der Webseite laufen (scripting.executeScript, world "MAIN").
 * Jede Funktion muss eigenständig sein: sie wird serialisiert und in die Seite injiziert.
 * Rückgabewerte müssen klonbar sein (keine DOM-/IDB-Objekte).
 */
(function (root) {
  "use strict";

  /* Liest alle Speicherarten der Seite inkl. Details */
  async function inspect(opts) {
    const maxVal = (opts && opts.maxValue) || 4000;
    const maxUrls = (opts && opts.maxUrls) || 200;
    const errors = {};
    const dump = (s) => {
      const o = [];
      try {
        for (let i = 0; i < s.length; i++) {
          const k = s.key(i), v = String(s.getItem(k));
          o.push({ k, v: v.length > maxVal ? v.slice(0, maxVal) + "…" : v, size: k.length + v.length });
        }
      } catch (e) { errors.webstorage = String(e); }
      return o;
    };
    const out = {
      origin: location.origin, host: location.host,
      local: dump(window.localStorage), session: dump(window.sessionStorage),
      idb: null, caches: null, sw: null, estimate: null, errors
    };

    // IndexedDB: Datenbanken → Object Stores → Anzahl Einträge
    try {
      const dbs = await indexedDB.databases();
      out.idb = [];
      for (const d of dbs) {
        const info = { name: String(d.name), version: Number(d.version), stores: [], records: 0 };
        try {
          const db = await new Promise((res, rej) => {
            const r = indexedDB.open(d.name);
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
            r.onblocked = () => rej(new Error("blocked"));
            // existiert nicht mehr → nicht neu anlegen
            r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} rej(new Error("does not exist")); };
          });
          const names = Array.from(db.objectStoreNames);
          if (names.length) {
            const tx = db.transaction(names, "readonly");
            const counts = await Promise.all(names.map(n => new Promise(res => {
              const q = tx.objectStore(n).count();
              q.onsuccess = () => res(q.result);
              q.onerror = () => res(null);
            })));
            names.forEach((n, i) => {
              const st = tx.objectStore(n);
              info.stores.push({ name: n, count: counts[i], keyPath: st.keyPath == null ? null : String(st.keyPath), autoIncrement: !!st.autoIncrement, indexes: Array.from(st.indexNames) });
              info.records += counts[i] || 0;
            });
          }
          db.close();
        } catch (e) { info.error = String(e && e.message || e); }
        out.idb.push(info);
      }
    } catch (e) { errors.idb = String(e && e.message || e); }

    // Cache Storage (Cache-API): Caches → Einträge (URL, Typ, Grösse)
    try {
      const names = await caches.keys();
      out.caches = [];
      for (const name of names) {
        const info = { name, count: 0, size: 0, entries: [] };
        try {
          const c = await caches.open(name);
          const reqs = await c.keys();
          info.count = reqs.length;
          for (const req of reqs.slice(0, maxUrls)) {
            let size = null, type = "";
            try {
              const resp = await c.match(req);
              if (resp) { type = resp.headers.get("content-type") || ""; size = (await resp.clone().blob()).size; info.size += size; }
            } catch (e) {}
            info.entries.push({ url: req.url, method: req.method, size, type });
          }
          info.truncated = reqs.length > maxUrls;
        } catch (e) { info.error = String(e && e.message || e); }
        out.caches.push(info);
      }
    } catch (e) { errors.caches = String(e && e.message || e); }

    // Service Worker
    try {
      if (navigator.serviceWorker) {
        const regs = await navigator.serviceWorker.getRegistrations();
        out.sw = regs.map(r => {
          const w = r.active || r.waiting || r.installing;
          return {
            scope: r.scope, script: w ? w.scriptURL : "", state: w ? w.state : "—",
            active: !!r.active, waiting: !!r.waiting, installing: !!r.installing,
            updateViaCache: r.updateViaCache, controlsPage: !!(navigator.serviceWorker.controller && w && navigator.serviceWorker.controller.scriptURL === w.scriptURL)
          };
        });
      } else out.sw = [];
    } catch (e) { errors.sw = String(e && e.message || e); }

    try { const est = await navigator.storage.estimate(); out.estimate = { usage: Number(est.usage), quota: Number(est.quota) }; } catch (e) {}
    try { out.persisted = await navigator.storage.persisted(); } catch (e) {}
    return out;
  }

  async function deleteIdb(name) {
    return new Promise(res => {
      const r = indexedDB.deleteDatabase(name);
      let blocked = false;
      r.onblocked = () => { blocked = true; };
      r.onsuccess = () => res({ ok: true, blocked });
      r.onerror = () => res({ ok: false, error: String(r.error) });
      // blockiert = Seite hält noch eine Verbindung offen; Löschung läuft, sobald sie geschlossen wird
      setTimeout(() => res({ ok: false, pending: true, blocked }), 3000);
    });
  }

  async function clearIdbStore(dbName, storeName) {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      r.onupgradeneeded = () => { try { r.transaction.abort(); } catch (e) {} rej(new Error("does not exist")); };
    });
    try {
      await new Promise((res, rej) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = res; tx.onerror = () => rej(tx.error);
      });
      return { ok: true };
    } finally { db.close(); }
  }

  async function deleteCache(name) {
    return { ok: await caches.delete(name) };
  }

  async function deleteCacheEntry(name, url) {
    const c = await caches.open(name);
    return { ok: await c.delete(url) };
  }

  async function unregisterSw(scope) {
    const regs = await navigator.serviceWorker.getRegistrations();
    const r = regs.find(x => x.scope === scope);
    if (!r) return { ok: false, error: "not found" };
    return { ok: await r.unregister() };
  }

  /* Alle Caches der Cache API dieser Origin löschen */
  async function purgeCaches() {
    if (typeof caches === "undefined") return { ok: true, removed: [] };   // kein sicherer Kontext
    const names = await caches.keys();
    const removed = [];
    for (const n of names) if (await caches.delete(n)) removed.push(n);
    return { ok: true, removed };
  }

  function removeKeys(store, keys) {
    const s = store === "local" ? window.localStorage : window.sessionStorage;
    let n = 0;
    for (const k of keys) if (s.getItem(k) !== null) { s.removeItem(k); n++; }
    return { ok: true, removed: n };
  }

  root.PAGE_FNS = { inspect, deleteIdb, clearIdbStore, deleteCache, deleteCacheEntry, unregisterSw, purgeCaches, removeKeys };
})(typeof self !== "undefined" ? self : this);
