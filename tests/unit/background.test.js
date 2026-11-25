/* Hintergrundseite mit nachgebildeter browser-API: Tab-Schliessen, Blockieren, Vorschau,
 * Undo/Redo und Cache Storage. */
"use strict";
const assert = require("assert");
const { loadBackground, cookie: C } = require("./helpers");

const baseCookies = () => [C("_ga", ".example.com"), C("PHPSESSID", "www.example.com"), C("OptanonConsent", ".example.com"), C("foo", ".example.com"), C("_ga", ".other.ch")];
const baseTabs = () => [{ id: 1, url: "https://www.example.com/", active: true }, { id: 2, url: "https://other.ch/", active: false }];

module.exports = [
  ["Tab schliessen → nach Verzögerung nur Tracking-Cookie gelöscht", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    env.state.tabs = env.state.tabs.filter(t => t.id !== 1);
    await env.browser.tabs.onRemoved.fire(1);
    await env.runTimers();
    assert.deepEqual(env.state.removed.map(r => r.name + "@" + r.url), ["_ga@https://example.com/"]);
    const log = env.eval("log");
    assert.equal(log[0].trigger, "tab-close");
  }],
  ["Seite vor Ablauf wieder geöffnet → keine Bereinigung", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    env.state.tabs = env.state.tabs.filter(t => t.id !== 1);
    await env.browser.tabs.onRemoved.fire(1);
    const tab = { id: 3, url: "https://example.com/x", active: true }; env.state.tabs.push(tab);
    await env.browser.tabs.onUpdated.fire(3, { url: tab.url }, tab);
    await env.runTimers();
    assert.equal(env.state.removed.length, 0);
  }],
  ["Blockieren: gesetztes Cookie wird sofort gelöscht und protokolliert", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    env.eval("config.globalRules.push(CC.newRule({name:'track*',action:'block'}))");
    const bc = C("tracker1", ".foo.com"); env.state.cookies.push(bc);
    await env.browser.cookies.onChanged.fire({ removed: false, cookie: bc, cause: "explicit" });
    assert.equal(env.state.removed.at(-1).name, "tracker1");
    assert.equal(env.eval("log").at(-1).trigger, "block");
  }],
  ["Vorschau „Alles bereinigen“ lässt offene Seiten aus", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    assert.equal((await env.send({ cmd: "cleanAll", skipOpen: true, dryRun: true })).length, 0);
    const all = await env.send({ cmd: "cleanAll", skipOpen: false, dryRun: true });
    assert.deepEqual(all.map(r => r.site + ":" + r.name).sort(), ["example.com:_ga", "other.ch:_ga"]);
  }],
  ["Rückgängig/Wiederholen stellt eine Regel wieder her", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    const CC = env.ctx.self.CC;
    const cfg = CC.defaultConfig(); CC.getSite(cfg, "example.com", true).rules.push(CC.newRule({ name: "foo", action: "delete" }));
    await CC.saveConfig(cfg);
    assert.equal((await env.send({ cmd: "historyState" })).undo, 1);
    await env.send({ cmd: "undo" });
    assert.ok(!env.state.store.cc_config.sites["example.com"]);
    await env.send({ cmd: "redo" });
    assert.equal(env.state.store.cc_config.sites["example.com"].rules[0].name, "foo");
    assert.equal((await env.send({ cmd: "historyState" })).undo, 1, "Wiederholen erzeugt keinen zusätzlichen Schritt");
  }],
  ["Cache Storage: offener Tab sofort, übrige Hosts vormerken und Skript registrieren", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: baseTabs() });
    await env.ready();
    const hosts = await env.send({ cmd: "deleteStorageNow", site: "example.com", type: "cacheStorage" });
    assert.ok(hosts.includes("www.example.com"));
    assert.ok(env.state.executed.some(x => x.tabId === 1 && x.func === "purgeCaches"), "im offenen Tab ausgeführt");
    await env.runTimers();
    const pending = await env.send({ cmd: "cachePurgePending", site: "example.com" });
    assert.deepEqual(pending, ["example.com"], "www.example.com ist offen und erledigt, example.com vorgemerkt");
    const reg = env.state.registered.find(r => r.id === "cc-cache-purge");
    assert.ok(reg && reg.world === "MAIN" && reg.runAt === "document_start" && reg.matches.includes("*://example.com/*"));
    assert.ok(env.state.browsingData.length === 0, "kein browsingData-Aufruf für Cache Storage");
  }],
  ["Cache Storage: nach dem Aufruf des Hosts ausgetragen, Registrierung entfernt", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: [] });
    await env.ready();
    await env.send({ cmd: "deleteStorageNow", site: "example.com", type: "cacheStorage" });
    await env.runTimers();
    assert.deepEqual((await env.send({ cmd: "cachePurgePending", site: "example.com" })).sort(), ["example.com", "www.example.com"]);
    const tab = { id: 9, url: "https://www.example.com/", active: true }; env.state.tabs.push(tab);
    await env.browser.tabs.onUpdated.fire(9, { status: "complete" }, tab);
    await env.runTimers();
    assert.deepEqual(await env.send({ cmd: "cachePurgePending", site: "example.com" }), ["example.com"]);
    const t2 = { id: 10, url: "https://example.com/", active: true }; env.state.tabs.push(t2);
    await env.browser.tabs.onUpdated.fire(10, { status: "complete" }, t2);
    await env.runTimers();
    assert.deepEqual(await env.send({ cmd: "cachePurgePending" }), []);
    assert.ok(!env.state.registered.some(r => r.id === "cc-cache-purge"), "Skript abgemeldet");
  }],
  ["Bereinigung im Modus Löschen: browsingData-Typen gemeinsam, Cache Storage separat", async () => {
    const env = loadBackground({ cookies: baseCookies(), tabs: [] });
    await env.ready();
    env.eval("const s = CC.getSite(config, 'example.com', true); s.storage.indexedDB = 'delete'; s.storage.cacheStorage = 'delete'; s.storage.localStorage = 'delete';");
    const rows = await env.send({ cmd: "cleanStorage", site: "example.com" });
    assert.deepEqual(env.state.browsingData[0].t, { localStorage: true, indexedDB: true });
    assert.ok(rows.some(r => r.name.startsWith("Cache Storage") && r.name.includes("nächsten Aufruf")));
  }],
];
