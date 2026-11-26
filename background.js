/* Cookie Curator – Hintergrundskript
 * Zuständig für: Bereinigungs-Trigger (Tab geschlossen, Browserstart, Intervall, manuell),
 * sofortiges Blockieren, Protokoll und Badge.
 */
"use strict";

let config = CC.defaultConfig();
const tabSites = new Map();          // tabId -> site
const pendingTabClose = new Map();   // site  -> timeoutId
let log = [];
let logDirty = false;

/* ------------------------------------------------------------------ */
/* Initialisierung                                                     */
/* ------------------------------------------------------------------ */

const ready = (async function init() {
  await I18N.init();
  I18N.onChange(() => updateBadgeAll());
  config = await CC.loadConfig();
  CC.setExtraSuffixes(config.settings.extraSuffixes);
  const r = await browser.storage.local.get(CC.LOG_KEY);
  log = Array.isArray(r[CC.LOG_KEY]) ? r[CC.LOG_KEY] : [];
  const tabs = await browser.tabs.query({});
  for (const t of tabs) setTabSite(t.id, t.url);
  const h = await browser.storage.local.get(HOSTS_KEY);
  for (const [site, hosts] of Object.entries(h[HOSTS_KEY] || {})) siteHosts.set(site, new Set(hosts));
  const cp = await browser.storage.local.get(CACHEPURGE_KEY);
  const cpMin = Date.now() - CACHEPURGE_DAYS * 86400000;   // nie wieder besuchte Hosts verfallen
  for (const [host, v] of Object.entries(cp[CACHEPURGE_KEY] || {})) if (v && v.t > cpMin) cachePurgeHosts.set(host, v);
  registerCachePurge();
  scheduleAlarm();
  registerPageScripts();
  updateBadgeAll();
})();

browser.runtime.onStartup.addListener(async () => {
  await ready;
  if (!config.settings.cleanOnStartup && !config.settings.restoreOnStartup) return;
  // kurz warten, bis wiederhergestellte Tabs ihre URL haben
  setTimeout(async () => {
    const tabs = await browser.tabs.query({});
    for (const t of tabs) setTabSite(t.id, t.url);
    if (config.settings.cleanOnStartup) await cleanAll("startup", { skipOpen: config.settings.skipOpenSites });
    if (config.settings.restoreOnStartup) await restoreAutostart("startup-restore");
  }, 4000);
});

browser.runtime.onInstalled.addListener(async (details) => {
  await ready;
  if (details.reason === "install") browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[CC.CONFIG_KEY]) return;
  recordHistory(changes[CC.CONFIG_KEY].oldValue, changes[CC.CONFIG_KEY].newValue);
  config = CC.normalizeConfig(changes[CC.CONFIG_KEY].newValue);
  CC.setExtraSuffixes(config.settings.extraSuffixes);
  // Seiten-Schlüssel neu berechnen (zusätzliche Suffixes könnten sich geändert haben)
  browser.tabs.query({}).then(tabs => { tabSites.clear(); for (const t of tabs) setTabSite(t.id, t.url); });
  scheduleAlarm();
  clearTimeout(pageScriptTimer);
  pageScriptTimer = setTimeout(registerPageScripts, 300);
  updateBadgeAll();
});

/* ------------------------------------------------------------------ */
/* Rückgängig / Wiederholen (Konfiguration)                            */
/* ------------------------------------------------------------------ */
/* Jede Änderung an cc_config landet als Schritt im Verlauf (max. 100).
 * Technisch gekoppelte Schreibvorgänge (< 0,3 s) werden zu einem Schritt zusammengefasst.
 * Nicht enthalten: Cookies selbst, Archiv, Protokoll.                  */

const HISTORY_KEY = "cc_history";
const HISTORY_MAX = 100;
let cfgHistory = { undo: [], redo: [] };
let historyApplying = null;   // JSON des Zustands, den Undo/Redo gerade schreibt
let lastHistoryPush = 0;

browser.storage.local.get(HISTORY_KEY).then(r => {
  if (r[HISTORY_KEY] && Array.isArray(r[HISTORY_KEY].undo)) cfgHistory = r[HISTORY_KEY];
});

function saveHistory() {
  return browser.storage.local.set({ [HISTORY_KEY]: cfgHistory });
}

function recordHistory(oldValue, newValue) {
  const newJson = JSON.stringify(newValue);
  if (historyApplying !== null && newJson === historyApplying) { historyApplying = null; return; }
  if (oldValue === undefined) oldValue = CC.defaultConfig();   // erste Änderung nach Installation
  if (JSON.stringify(oldValue) === newJson) return;
  const now = Date.now();
  const label = CC.describeConfigChange(oldValue, newValue);
  const top = cfgHistory.undo[cfgHistory.undo.length - 1];
  if (top && now - lastHistoryPush < 300 && top.label === label) {
    // zusammenfassen: der ältere Ausgangszustand bleibt erhalten
  } else {
    cfgHistory.undo.push({ t: now, label, config: oldValue });
    if (cfgHistory.undo.length > HISTORY_MAX) cfgHistory.undo.shift();
  }
  lastHistoryPush = now;
  cfgHistory.redo = [];
  saveHistory();
}

async function applyHistory(from, to) {
  const step = cfgHistory[from].pop();
  if (!step) return historyState();
  const current = (await browser.storage.local.get(CC.CONFIG_KEY))[CC.CONFIG_KEY] || CC.defaultConfig();
  cfgHistory[to].push({ t: Date.now(), label: step.label, config: current });
  historyApplying = JSON.stringify(step.config);
  await saveHistory();
  await browser.storage.local.set({ [CC.CONFIG_KEY]: step.config });
  return Object.assign(historyState(), { applied: step.label });
}

function historyState() {
  const u = cfgHistory.undo[cfgHistory.undo.length - 1], r = cfgHistory.redo[cfgHistory.redo.length - 1];
  return { undo: cfgHistory.undo.length, redo: cfgHistory.redo.length, undoLabel: u ? u.label : "", redoLabel: r ? r.label : "", undoTime: u ? u.t : 0, redoTime: r ? r.t : 0 };
}

/* ------------------------------------------------------------------ */
/* Tab-Tracking & Bereinigung beim Schliessen                          */
/* ------------------------------------------------------------------ */

function setTabSite(tabId, url) {
  const site = CC.siteFromUrl(url || "");
  if (site) tabSites.set(tabId, site); else tabSites.delete(tabId);
  if (site) { try { rememberHost(site, new URL(url).host); } catch (e) {} }
  if (site && pendingTabClose.has(site)) {           // Seite wurde wieder geöffnet
    clearTimeout(pendingTabClose.get(site));
    pendingTabClose.delete(site);
  }
}

function openSites() { return new Set(tabSites.values()); }

function siteLeft(site) {
  if (!site || openSites().has(site)) return;
  if (!CC.effectiveTabClose(config, site)) return;
  if (pendingTabClose.has(site)) clearTimeout(pendingTabClose.get(site));
  const delay = Math.max(0, Number(config.settings.tabCloseDelaySec) || 0) * 1000;
  pendingTabClose.set(site, setTimeout(() => {
    pendingTabClose.delete(site);
    if (!openSites().has(site)) cleanSite(site, "tab-close");
  }, delay));
}

browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!info.url && !info.status) return;
  if (info.status === "complete") cachePurgeVisited(tab.url);
  const before = tabSites.get(tabId);
  setTabSite(tabId, tab.url);
  const after = tabSites.get(tabId);
  if (before && before !== after) siteLeft(before);
  if (tab.active) updateBadge(tab);
});

browser.tabs.onRemoved.addListener((tabId) => {
  const site = tabSites.get(tabId);
  tabSites.delete(tabId);
  if (site) siteLeft(site);
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  try { updateBadge(await browser.tabs.get(tabId)); } catch (e) {}
});

/* ------------------------------------------------------------------ */
/* Bereinigung                                                         */
/* ------------------------------------------------------------------ */

/* Löscht Cookies und prüft danach, ob sie wirklich weg sind.
 * Firefox kann Cookies mit Partitionsschlüssel im alten Format (z. B. „<id>.mozilla“ oder aus älteren
 * Firefox-Versionen) über cookies.remove() nicht treffen. Dann greift forceRemove(). */
async function deleteList(cookies, trigger, reasons) {
  const removed = [], failed = [];
  for (const c of cookies) {
    try {
      const res = await CC.removeCookie(c);
      if (res && !(await cookieExists(c))) {
        removed.push(c);
        addLog(trigger, c, reasons ? reasons.get(CC.cookieId(c)) : "");
        continue;
      }
    } catch (e) {
      console.warn("[Cookie Curator] cookies.remove failed", c, e);
    }
    failed.push(c);
  }
  if (failed.length) {
    const rescued = await forceRemove(failed, cookies);
    for (const c of rescued) {
      removed.push(c);
      addLog(trigger, c, I18N.t("bg.viaBrowsingData", { reason: reasons ? reasons.get(CC.cookieId(c)) || "" : "" }).trim());
    }
  }
  if (removed.length) updateBadgeAll();
  return removed;
}

async function cookieExists(c) {
  const id = CC.cookieId(c);
  let list;
  try { list = await browser.cookies.getAll({ name: c.name, storeId: c.storeId, firstPartyDomain: null, partitionKey: {} }); }
  catch (e) { list = await browser.cookies.getAll({ name: c.name, storeId: c.storeId, firstPartyDomain: null }); }
  return list.some(x => CC.cookieId(x) === id);
}

/* Ausweichweg: alle Cookies des Hosts (im selben Container) per browsingData löschen –
 * das trifft jeden Partitionsschlüssel – und alle, die bleiben sollen, sofort neu setzen. */
async function forceRemove(failed, allToDelete) {
  const deleteIds = new Set(allToDelete.map(c => CC.cookieId(c)));
  const groups = new Map();
  for (const c of failed) {
    const k = CC.cookieHost(c) + "|" + c.storeId;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const rescued = [];
  for (const [k, list] of groups) {
    const [host, storeId] = k.split("|");
    const keep = (await CC.getAllCookies()).filter(x => CC.cookieHost(x) === host && x.storeId === storeId && !deleteIds.has(CC.cookieId(x)));
    for (const x of keep) restoring.add(CC.cookieId(x));
    try {
      await browser.browsingData.removeCookies({ hostnames: [host], cookieStoreId: storeId });
    } catch (e) {
      console.warn("[Cookie Curator] browsingData.removeCookies failed", host, e);
      continue;
    }
    for (const x of keep) {
      try { if (!(await browser.cookies.set(CC.restoreDetails(x, 0)))) throw new Error("abgelehnt"); }
      catch (e) { console.warn("[Cookie Curator] restoring after fallback deletion failed", x, e); }
    }
    setTimeout(() => keep.forEach(x => restoring.delete(CC.cookieId(x))), 2000);
    for (const c of list) if (!(await cookieExists(c))) rescued.push(c);
  }
  return rescued;
}

function plan(cookies) {
  const toDelete = [];
  const reasons = new Map();
  for (const c of cookies) {
    const ev = CC.evaluate(c, config);
    if (ev.action === "delete" || ev.action === "block") {
      toDelete.push(c);
      reasons.set(CC.cookieId(c), ev.reason);
    }
  }
  return { toDelete, reasons };
}

async function cleanSite(site, trigger, dryRun) {
  const cookies = await CC.getCookiesForSite(site);
  const { toDelete, reasons } = plan(cookies);
  const storageRows = await cleanStorage(site, trigger, dryRun, cookies);
  if (dryRun) return toDelete.map(c => summarize(c, reasons.get(CC.cookieId(c)))).concat(storageRows);
  const removed = await deleteList(toDelete, trigger, reasons);
  return removed.map(c => summarize(c, reasons.get(CC.cookieId(c)))).concat(storageRows);
}

async function cleanAll(trigger, { skipOpen = true, dryRun = false } = {}) {
  const open = openSites();
  const all = await CC.getAllCookies();
  const candidates = skipOpen ? all.filter(c => !open.has(CC.siteKeyForCookie(c))) : all;
  const { toDelete, reasons } = plan(candidates);
  // weitere Speicher: alle bekannten und konfigurierten Seiten
  const sites = new Set([...siteHosts.keys(), ...Object.keys(config.sites), ...all.map(c => CC.siteKeyForCookie(c))]);
  let storageRows = [];
  for (const site of sites) {
    if (skipOpen && open.has(site)) continue;
    storageRows = storageRows.concat(await cleanStorage(site, trigger, dryRun, all.filter(c => CC.siteKeyForCookie(c) === site)));
  }
  if (dryRun) return toDelete.map(c => summarize(c, reasons.get(CC.cookieId(c)))).concat(storageRows);
  const removed = await deleteList(toDelete, trigger, reasons);
  return removed.map(c => summarize(c, reasons.get(CC.cookieId(c)))).concat(storageRows);
}

/* ------------------------------------------------------------------ */
/* Website-Daten (alles ausser Cookies)                                             */
/* ------------------------------------------------------------------ */

const HOSTS_KEY = "cc_hosts";
const siteHosts = new Map();     // site -> Set(host[:port])
let hostsTimer = null;
let pageScriptTimer = null;
let pageScriptRegs = [];

function rememberHost(site, host) {
  if (!site || !host) return;
  let set = siteHosts.get(site);
  if (!set) { set = new Set(); siteHosts.set(site, set); }
  if (set.has(host)) return;
  set.add(host);
  if (set.size > 300) set.delete(set.values().next().value);
  saveHostsSoon();
}

function saveHostsSoon() {
  clearTimeout(hostsTimer);
  hostsTimer = setTimeout(() => {
    const o = {};
    for (const [k, v] of siteHosts) o[k] = [...v];
    browser.storage.local.set({ [HOSTS_KEY]: o });
  }, 500);
}

/* Alles einer Seite löschen: Cookies, Website-Daten, sessionStorage offener Tabs,
 * gemerkte Hosts und (optional) die Seiten-Konfiguration → Seite verschwindet aus der Übersicht */
async function purgeSite(site, removeConfig) {
  const cookies = await CC.getCookiesForSite(site);
  const reasons = new Map(cookies.map(c => [CC.cookieId(c), I18N.t("bg.purgedAll")]));
  const removed = await deleteList(cookies, "manual", reasons);
  const hostnames = hostsForSite(site, cookies);
  const data = [];
  for (const t of CC.BROWSING_DATA_TYPES) {
    try { await browser.browsingData.remove({ hostnames }, { [t]: true }); data.push(CC.STORAGE_LABEL[t]); }
    catch (e) { console.warn("[Cookie Curator] purge", t, e); }
  }
  const cs = await purgeCacheStorage(site, hostnames);
  data.push(cs.later.length ? I18N.t("bg.partlyLater", { label: CC.STORAGE_LABEL.cacheStorage }) : CC.STORAGE_LABEL.cacheStorage);
  if (data.length) addLog("manual", { site, name: I18N.t("bg.siteData", { list: data.join(", ") }), domain: hostnames.join(", ") }, I18N.t("bg.purgedAll"), "storage");
  const openTabs = tabsOfSite(site);
  if (openTabs.length) await runInSiteTabs(site, "try { sessionStorage.clear(); } catch (e) {}");
  siteHosts.delete(site);
  saveHostsSoon();
  let configRemoved = false;
  if (removeConfig) {
    const cfg = await CC.loadConfig();
    if (cfg.sites[site]) { delete cfg.sites[site]; await CC.saveConfig(cfg); configRemoved = true; }
  }
  return { cookies: removed.length, cookiesTotal: cookies.length, data, hostnames, openTabs: openTabs.length, configRemoved };
}

/* Firefox löscht nur exakte Hosts → alle bekannten Hosts der Seite inkl. Cookie-Domains übergeben */
function hostsForSite(site, cookies) {
  const set = new Set([site, "www." + site]);
  for (const h of siteHosts.get(site) || []) set.add(h);
  for (const c of cookies || []) if (!c.partitionKey) set.add(CC.cookieHost(c));
  return [...set].filter(Boolean);
}

async function cleanStorage(site, trigger, dryRun, cookies) {
  const types = CC.storageDeleteTypes(config, site);
  if (!types.length) return [];
  const hostnames = hostsForSite(site, cookies);
  const scope = t => (config.sites[site] && config.sites[site].storage && config.sites[site].storage[t] !== "inherit" ? I18N.t("bg.scopeSite") : I18N.t("bg.scopeGlobal"));
  const row = t => ({
    site, kind: "storage", name: I18N.t("bg.complete", { label: CC.STORAGE_LABEL[t] }), domain: hostnames.join(", "), path: "",
    reason: I18N.t("bg.modeDelete", { scope: scope(t) })
  });
  if (dryRun) return types.map(row);
  const done = [];
  const logRow = r => { done.push(r); addLog(trigger, { site, name: r.name, domain: r.domain }, r.reason, "storage"); };
  const bdTypes = types.filter(t => CC.BROWSING_DATA_TYPES.includes(t));
  if (bdTypes.length) {
    const dataTypes = {};
    for (const t of bdTypes) dataTypes[t] = true;
    try {
      await browser.browsingData.remove({ hostnames }, dataTypes);
      bdTypes.forEach(t => logRow(row(t)));
    } catch (e) {
      // einzeln versuchen, damit ein nicht unterstützter Typ die anderen nicht blockiert
      for (const t of bdTypes) {
        try { await browser.browsingData.remove({ hostnames }, { [t]: true }); logRow(row(t)); }
        catch (err) { console.warn("[Cookie Curator] browsingData", t, err); }
      }
    }
  }
  if (types.includes("cacheStorage")) {
    const r = await purgeCacheStorage(site, hostnames);
    const x = row("cacheStorage");
    if (r.later.length) x.name += r.now.length ? I18N.t("bg.nowAndLater") : I18N.t("bg.later");
    logRow(x);
  }
  return done;
}

/* ------------------------------------------------------------------ */
/* Cache Storage                                                       */
/* ------------------------------------------------------------------ */
/* browsingData kann Cache Storage nicht pro Host löschen (der Typ indexedDB löscht im
 * Quota-Manager nur den Client "idb"). Darum:
 *  1. offene Tabs der Seite: sofort per Skript in der Welt MAIN (PAGE_FNS.purgeCaches),
 *  2. alle übrigen Hosts: vormerken (cc_cachepurge) und page/cache-purge.js für diese Hosts
 *     registrieren; es läuft beim nächsten Aufruf bei document_start, bevor die Seite startet.
 * Nach dem ersten vollständig geladenen Aufruf wird der Host wieder ausgetragen. */

const CACHEPURGE_KEY = "cc_cachepurge";
const CACHEPURGE_MAX = 500;
const CACHEPURGE_DAYS = 90;
const cachePurgeHosts = new Map();   // hostname -> { site, t }
let cachePurgeTimer = null;
let cachePurgeQueue = Promise.resolve();

function hostnameOf(host) {
  try { return new URL("http://" + host + "/").hostname; } catch (e) { return ""; }
}

async function purgeCacheStorage(site, hostnames) {
  const now = new Set();
  for (const tabId of tabsOfSite(site)) {
    try {
      const tab = await browser.tabs.get(tabId);
      const res = await runMain(tabId, "purgeCaches", []);
      if (res && res.ok) now.add(new URL(tab.url).hostname);
    } catch (e) { console.warn("[Cookie Curator] Cache Storage in tab", tabId, e); }
  }
  const later = [];
  for (const h of new Set(hostnames.map(hostnameOf))) {
    if (!h || now.has(h) || !/^[a-z0-9.-]+$/i.test(h)) continue;
    cachePurgeHosts.delete(h);                       // neu eintragen → ans Ende (jüngster)
    cachePurgeHosts.set(h, { site, t: Date.now() });
    later.push(h);
  }
  while (cachePurgeHosts.size > CACHEPURGE_MAX) cachePurgeHosts.delete(cachePurgeHosts.keys().next().value);
  if (later.length) cachePurgeChanged();
  return { now: [...now], later };
}

function cachePurgeVisited(url) {
  let h;
  try { h = new URL(url).hostname; } catch (e) { return; }
  if (!cachePurgeHosts.has(h)) return;
  cachePurgeHosts.delete(h);
  cachePurgeChanged();
}

function cachePurgeChanged() {
  clearTimeout(cachePurgeTimer);
  cachePurgeTimer = setTimeout(() => {
    browser.storage.local.set({ [CACHEPURGE_KEY]: Object.fromEntries(cachePurgeHosts) });
    registerCachePurge();
  }, 200);
}

function registerCachePurge() {
  cachePurgeQueue = cachePurgeQueue.then(async () => {
    if (!browser.scripting || !browser.scripting.registerContentScripts) return;
    try {
      const reg = await browser.scripting.getRegisteredContentScripts({ ids: ["cc-cache-purge"] });
      if (reg.length) await browser.scripting.unregisterContentScripts({ ids: ["cc-cache-purge"] });
    } catch (e) { console.warn("[Cookie Curator] unregistering cache script", e); }
    const hosts = [...cachePurgeHosts.keys()];
    if (!hosts.length) return;
    try {
      await browser.scripting.registerContentScripts([{
        id: "cc-cache-purge", js: ["page/cache-purge.js"], matches: hosts.map(h => `*://${h}/*`),
        runAt: "document_start", world: "MAIN", allFrames: false, persistAcrossSessions: false
      }]);
    } catch (e) { console.warn("[Cookie Curator] registering cache script", e); }
  }).catch(() => {});
  return cachePurgeQueue;
}

/* Selektive Eintragsregeln: Content-Script pro Seite, läuft bei document_start vor den Seitenskripten */
async function registerPageScripts() {
  const old = pageScriptRegs;
  pageScriptRegs = [];
  for (const r of old) { try { await r.unregister(); } catch (e) {} }
  if (!browser.contentScripts) return;
  for (const site of Object.keys(config.sites)) {
    const R = CC.pageKeyRules(config, site);
    if (!R) continue;
    R.log = !!config.settings.logEnabled;
    R.trigger = "page-load";
    const ipLike = /^[\d.]+$|:|^localhost$/.test(site);
    const matches = ipLike ? [`*://${site}/*`] : [`*://${site}/*`, `*://*.${site}/*`];
    try {
      pageScriptRegs.push(await browser.contentScripts.register({
        matches, js: [{ code: CC.pageKeyCleanerCode(R) }], runAt: "document_start", allFrames: false
      }));
    } catch (e) { console.warn("[Cookie Curator] contentScripts.register", site, e); }
  }
}

function tabsOfSite(site) {
  return [...tabSites.entries()].filter(([, s]) => s === site).map(([id]) => id);
}

async function runInSiteTabs(site, code) {
  const results = [];
  for (const tabId of tabsOfSite(site)) {
    try {
      const [r] = await browser.tabs.executeScript(tabId, { code, runAt: "document_idle" });
      results.push({ tabId, result: r });
    } catch (e) { results.push({ tabId, error: String(e && e.message || e) }); }
  }
  return results;
}

/* Führt eine Funktion aus PAGE_FNS im Kontext der Webseite aus (wie ein Seitenskript, ohne CSP-Einschränkung) */
async function runMain(tabId, fnName, args) {
  const func = PAGE_FNS[fnName];
  if (browser.scripting && browser.scripting.executeScript) {
    const [r] = await browser.scripting.executeScript({ target: { tabId, frameIds: [0] }, world: "MAIN", func, args: args || [] });
    if (r && r.error) throw new Error(String(r.error.message || r.error));
    return r ? r.result : undefined;
  }
  // Fallback: isoliertes Content-Script
  const [r] = await browser.tabs.executeScript(tabId, { code: "(" + func.toString() + ").apply(null," + JSON.stringify(args || []) + ");", runAt: "document_idle" });
  return r;
}

async function preferredTab(site) {
  const ids = tabsOfSite(site);
  if (!ids.length) return null;
  try { const act = await browser.tabs.query({ active: true }); const hit = act.find(t => ids.includes(t.id)); if (hit) return hit.id; } catch (e) {}
  return ids[0];
}

async function inspectStorage(site) {
  const tabId = await preferredTab(site);
  if (tabId == null) return { open: false };
  try {
    return { open: true, tabId, data: await runMain(tabId, "inspect", [{ maxValue: 4000, maxUrls: 200 }]) };
  } catch (e) {
    return { open: true, tabId, error: String(e && e.message || e) };
  }
}

const ITEM_OPS = {
  deleteIdb: { label: a => "IndexedDB " + a[0] },
  clearIdbStore: { label: a => I18N.t("bg.idbCleared", { db: a[0], store: a[1] }) },
  deleteCache: { label: a => "Cache " + a[0] },
  deleteCacheEntry: { label: a => "Cache " + a[0] + ": " + a[1] },
  unregisterSw: { label: a => "Service Worker " + a[0] }
};

async function storageItem(site, op, args) {
  if (!ITEM_OPS[op]) throw new Error(I18N.t("bg.unknownOp", { op }));
  const tabId = await preferredTab(site);
  if (tabId == null) return { ok: false, error: I18N.t("bg.noTab") };
  const res = await runMain(tabId, op, args);
  if (res && (res.ok || res.pending)) addLog("manual", { site, name: ITEM_OPS[op].label(args), domain: site }, res.pending ? I18N.t("bg.manualBlocked") : I18N.t("bg.manual"), "storage");
  return res;
}

function summarize(c, reason) {
  return { site: CC.siteKeyForCookie(c), name: c.name, domain: c.domain, path: c.path, storeId: c.storeId, reason: reason || "" };
}

/* ------------------------------------------------------------------ */
/* Intervall                                                           */
/* ------------------------------------------------------------------ */

function scheduleAlarm() {
  browser.alarms.clear("cc-periodic");
  const m = Number(config.settings.periodicMinutes) || 0;
  if (m > 0) browser.alarms.create("cc-periodic", { periodInMinutes: Math.max(1, m) });
}

browser.alarms.onAlarm.addListener((a) => {
  if (a.name === "cc-periodic") cleanAll("interval", { skipOpen: config.settings.skipOpenSites });
});

/* ------------------------------------------------------------------ */
/* Blockieren (sofort löschen)                                         */
/* ------------------------------------------------------------------ */

let badgeTimer = null;
const restoring = new Set();         // cookieIds, die gerade wiederhergestellt werden (nicht blockieren)
browser.cookies.onChanged.addListener(async (info) => {
  await ready;
  if (!info.removed && config.settings.enforceBlock && !restoring.has(CC.cookieId(info.cookie))) {
    const ev = CC.evaluate(info.cookie, config);
    if (ev.action === "block") {
      try {
        await CC.removeCookie(info.cookie);
        addLog("block", info.cookie, ev.reason);
      } catch (e) { console.warn("[Cookie Curator] blocking failed", e); }
    }
  }
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(updateBadgeAll, 600);
});

/* ------------------------------------------------------------------ */
/* Archiv                                                              */
/* ------------------------------------------------------------------ */

let archiveQueue = Promise.resolve();   // Schreibzugriffe aufs Archiv serialisieren
function withArchive(fn) {
  const p = archiveQueue.then(async () => {
    const list = await CC.loadArchive();
    const result = await fn(list);
    await CC.saveArchive(list);
    return result;
  });
  archiveQueue = p.catch(() => {});
  return p;
}

function archiveCookies(cookies, note) {
  return withArchive(list => CC.addToArchive(list, cookies, note, config.settings.archiveMaxVersions));
}

async function restoreEntries(entries, trigger) {
  const ok = [], failed = [];
  for (const e of entries) {
    const c = e.cookie;
    const id = CC.cookieId(c);
    restoring.add(id);
    try {
      const res = await browser.cookies.set(CC.restoreDetails(c, config.settings.restoreExtendDays));
      if (!res) throw new Error(I18N.t("bg.cookieRejected"));
      ok.push(e.aid);
      addLog(trigger, c, I18N.t("bg.fromArchive", { date: new Date(e.savedAt).toLocaleString(I18N.t("fmt.locale")) }) + (e.note ? " (" + e.note + ")" : ""));
    } catch (err) {
      failed.push({ aid: e.aid, name: c.name, error: String(err && err.message || err) });
      console.warn("[Cookie Curator] restore failed", c, err);
    } finally {
      setTimeout(() => restoring.delete(id), 2000);
    }
  }
  updateBadgeAll();
  return { ok, failed };
}

async function restoreAutostart(trigger) {
  const list = await CC.loadArchive();
  const auto = list.filter(e => e.autoRestore);
  if (!auto.length) return { ok: [], failed: [] };
  return restoreEntries(auto, trigger);
}

/* ------------------------------------------------------------------ */
/* Protokoll                                                           */
/* ------------------------------------------------------------------ */

function addLog(trigger, c, reason, kind) {
  if (!config.settings.logEnabled) return;
  log.push({
    t: Date.now(), trigger, kind: kind || "cookie", site: c.site || CC.siteKeyForCookie(c), name: c.name, domain: c.domain,
    path: c.path || "", storeId: c.storeId || "", partitioned: !!c.partitionKey, reason: reason || ""
  });
  const max = Math.max(100, Number(config.settings.logMax) || 2000);
  if (log.length > max) log = log.slice(-max);
  if (!logDirty) {
    logDirty = true;
    setTimeout(() => { logDirty = false; browser.storage.local.set({ [CC.LOG_KEY]: log }); }, 1500);
  }
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

async function updateBadge(tab) {
  if (!tab) return;
  const mode = config.settings.badge;
  const site = CC.siteFromUrl(tab.url || "");
  if (mode === "off" || !site) {
    browser.browserAction.setBadgeText({ text: "", tabId: tab.id });
    return;
  }
  try {
    const cookies = await CC.getCookiesForSite(site);
    let pending = 0;
    for (const c of cookies) {
      const a = CC.evaluate(c, config).action;
      if (a === "delete" || a === "block") pending++;
    }
    const n = mode === "total" ? cookies.length : pending;
    browser.browserAction.setBadgeText({ text: n ? String(n) : "", tabId: tab.id });
    browser.browserAction.setBadgeBackgroundColor({ color: pending ? "#c2410c" : "#15803d", tabId: tab.id });
    if (browser.browserAction.setBadgeTextColor) browser.browserAction.setBadgeTextColor({ color: "#ffffff", tabId: tab.id });
    browser.browserAction.setTitle({
      title: I18N.t("bg.badgeTitle", { site, total: cookies.length, n: pending }),
      tabId: tab.id
    });
  } catch (e) { /* Tab weg */ }
}

async function updateBadgeAll() {
  const tabs = await browser.tabs.query({ active: true });
  for (const t of tabs) updateBadge(t);
}

/* ------------------------------------------------------------------ */
/* Nachrichten von Popup / Dashboard                                   */
/* ------------------------------------------------------------------ */

browser.runtime.onMessage.addListener(async (msg) => {
  await ready;
  switch (msg && msg.cmd) {
    case "cleanSite": return cleanSite(msg.site, "manual", !!msg.dryRun);
    case "cleanAll": return cleanAll("manual", { skipOpen: msg.skipOpen !== false, dryRun: !!msg.dryRun });
    case "deleteCookiesDetailed": {
      const reasons = new Map(msg.cookies.map(c => [CC.cookieId(c), msg.reason || I18N.t("bg.manual")]));
      const removed = await deleteList(msg.cookies, "manual", reasons);
      const ids = new Set(removed.map(c => CC.cookieId(c)));
      return { removedIds: [...ids], failed: msg.cookies.filter(c => !ids.has(CC.cookieId(c))).map(c => ({ name: c.name, domain: c.domain })) };
    }
    case "deleteCookies": {
      const reasons = new Map(msg.cookies.map(c => [CC.cookieId(c), msg.reason || I18N.t("bg.manual")]));
      const removed = await deleteList(msg.cookies, "manual", reasons);
      return removed.length;
    }
    case "openSites": return [...openSites()];
    case "historyState": return historyState();
    case "purgeSite": return purgeSite(msg.site, msg.removeConfig !== false);
    case "inspectStorage": return inspectStorage(msg.site);
    case "storageItem": return storageItem(msg.site, msg.op, msg.args || []);
    case "cachePurgePending": return [...cachePurgeHosts].filter(([, v]) => !msg.site || v.site === msg.site).map(([h]) => h);
    case "siteHosts": return hostsForSite(msg.site, await CC.getCookiesForSite(msg.site));
    case "cleanStorage": return cleanStorage(msg.site, "manual", !!msg.dryRun, await CC.getCookiesForSite(msg.site));
    case "deleteStorageNow": {
      // einzelne Speicherart sofort komplett löschen (unabhängig vom Modus)
      const hostnames = hostsForSite(msg.site, await CC.getCookiesForSite(msg.site));
      let note = "";
      if (msg.type === "cacheStorage") {
        const r = await purgeCacheStorage(msg.site, hostnames);
        if (r.later.length) note = r.now.length ? I18N.t("bg.nowAndLater") : I18N.t("bg.later");
      } else if (CC.BROWSING_DATA_TYPES.includes(msg.type)) {
        await browser.browsingData.remove({ hostnames }, { [msg.type]: true });
      } else throw new Error(I18N.t("bg.unknownType", { type: msg.type }));
      addLog("manual", { site: msg.site, name: I18N.t("bg.complete", { label: CC.STORAGE_LABEL[msg.type] }) + note, domain: hostnames.join(", ") }, I18N.t("bg.manual"), "storage");
      return hostnames;
    }
    case "applyKeyRules": {
      const R = CC.pageKeyRules(config, msg.site);
      if (!R) return { results: [], note: I18N.t("bg.noSelective") };
      R.log = !!config.settings.logEnabled; R.trigger = "manual";
      return { results: await runInSiteTabs(msg.site, CC.pageKeyCleanerCode(R)) };
    }
    case "removeKeys": {
      const res = await runInSiteTabs(msg.site, CC.removeKeysCode(msg.store, msg.keys));
      for (const k of msg.keys) addLog("manual", { site: msg.site, name: k, domain: msg.site }, I18N.t("bg.manualEntry", { store: msg.store }), "storage");
      return res;
    }
    case "logKeys": {
      const site = CC.siteFromUrl("https://" + msg.host + "/");
      for (const store of ["local", "session"]) {
        for (const k of (msg.removed && msg.removed[store]) || []) {
          addLog(msg.trigger || "page-load", { site, name: k, domain: msg.host }, I18N.t("bg.entryRule", { store }), "storage");
        }
      }
      return true;
    }
    case "undo": return applyHistory("undo", "redo");
    case "redo": return applyHistory("redo", "undo");
    case "historyClear": cfgHistory = { undo: [], redo: [] }; await saveHistory(); return historyState();
    case "getLog": return log;
    case "clearLog": log = []; await browser.storage.local.set({ [CC.LOG_KEY]: [] }); return true;
    case "pendingTabClose": return [...pendingTabClose.keys()];
    case "archive": return archiveCookies(msg.cookies, msg.note);
    case "archiveAndDelete": {
      const r = await archiveCookies(msg.cookies, msg.note);
      const reasons = new Map(msg.cookies.map(c => [CC.cookieId(c), I18N.t("bg.archivedDeleted")]));
      r.deleted = (await deleteList(msg.cookies, "manual", reasons)).length;
      return r;
    }
    case "restore": {
      const list = await CC.loadArchive();
      const wanted = new Set(msg.aids);
      return restoreEntries(list.filter(e => wanted.has(e.aid)), "restore");
    }
    case "restoreAutostart": return restoreAutostart("restore");
    case "archiveUpdate": return withArchive(list => {
      const e = list.find(x => x.aid === msg.aid);
      if (!e) return false;
      if ("autoRestore" in msg.patch) CC.setAutoRestore(list, msg.aid, msg.patch.autoRestore);
      if ("note" in msg.patch) e.note = String(msg.patch.note || "");
      if ("value" in msg.patch) e.cookie.value = String(msg.patch.value);
      return true;
    });
    case "archiveRemove": return withArchive(list => {
      const rm = new Set(msg.aids);
      let n = 0;
      for (let i = list.length - 1; i >= 0; i--) if (rm.has(list[i].aid)) { list.splice(i, 1); n++; }
      return n;
    });
    case "archiveImport": return withArchive(list => {
      const have = new Set(list.map(e => e.aid));
      let n = 0;
      for (const e of msg.entries || []) {
        if (!e || !e.cookie || !e.cookie.name || have.has(e.aid)) continue;
        const ne = CC.newArchiveEntry(e.cookie, e.note);
        if (e.aid) ne.aid = e.aid;
        if (e.savedAt) ne.savedAt = e.savedAt;
        ne.autoRestore = !!e.autoRestore;
        list.push(ne);
        n++;
      }
      return n;
    });
    default: return undefined;
  }
});
