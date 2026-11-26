/* Gemeinsame Helfer für die Einheitentests: lädt lib/core.js bzw. background.js in eine
 * eigene VM-Umgebung mit einer nachgebildeten browser-API. Kein Firefox nötig. */
"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const read = rel => fs.readFileSync(path.join(ROOT, rel), "utf8");

/* lib/core.js laden → CC */
/* Übersetzungen in einen VM-Kontext laden; Standardsprache der Tests ist Deutsch */
const I18N_FILES = ["lib/i18n.js", ...fs.readdirSync(path.join(ROOT, "locales")).filter(f => f.endsWith(".js")).sort().map(f => "locales/" + f)];
function loadI18n(ctx, lang = "de") {
  for (const f of I18N_FILES) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext("I18N", ctx).setLang(lang);
}

function loadCore(lang) {
  const ctx = { self: {}, console, URL, Intl };
  ctx.self = ctx;
  vm.createContext(ctx);
  loadI18n(ctx, lang);
  vm.runInContext(read("lib/core.js"), ctx, { filename: "lib/core.js" });
  return ctx.CC;
}

/* Ereignis-Attrappe wie browser.*.onX */
function event() {
  const ls = [];
  return {
    addListener: f => ls.push(f),
    removeListener: f => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
    hasListener: f => ls.includes(f),
    fire: (...a) => Promise.all(ls.map(f => f(...a)))
  };
}

const cookie = (name, domain, extra = {}) =>
  Object.assign({ name, domain, path: "/", value: "v", storeId: "firefox-default", secure: true, firstPartyDomain: "" }, extra);

/* Hintergrundseite (core.js + pagefns.js + background.js) mit nachgebildeter API laden.
 * Timer werden nicht automatisch ausgeführt, sondern mit env.runTimers() ausgelöst. */
function loadBackground({ cookies = [], tabs = [] } = {}) {
  const state = {
    cookies: cookies.slice(), tabs: tabs.slice(), store: {}, removed: [], browsingData: [],
    registered: [], executed: [], timers: []
  };
  const browser = {
    storage: {
      local: {
        get: async k => ({ [k]: state.store[k] === undefined ? undefined : JSON.parse(JSON.stringify(state.store[k])) }),
        set: async o => {
          for (const k of Object.keys(o)) {
            const old = state.store[k];
            state.store[k] = JSON.parse(JSON.stringify(o[k]));
            await browser.storage.onChanged.fire({ [k]: { oldValue: old, newValue: JSON.parse(JSON.stringify(o[k])) } }, "local");
          }
        }
      },
      onChanged: event()
    },
    cookies: {
      getAllCookieStores: async () => [{ id: "firefox-default" }],
      getAll: async () => state.cookies.map(c => Object.assign({}, c)),
      remove: async d => {
        state.removed.push(d);
        state.cookies = state.cookies.filter(c => !(c.name === d.name && d.url.includes(c.domain.replace(/^\./, ""))));
        return d;
      },
      set: async d => { state.cookies.push(Object.assign({ domain: new URL(d.url).hostname }, d)); return d; },
      onChanged: event()
    },
    tabs: {
      query: async () => state.tabs.slice(),
      get: async id => state.tabs.find(t => t.id === id),
      executeScript: async (tabId, d) => { state.executed.push({ tabId, code: d.code }); return [null]; },
      onUpdated: event(), onRemoved: event(), onActivated: event()
    },
    scripting: {
      executeScript: async d => { state.executed.push({ tabId: d.target.tabId, func: d.func.name, args: d.args }); return [{ result: { ok: true, removed: [] } }]; },
      registerContentScripts: async list => { state.registered.push(...list); },
      unregisterContentScripts: async ({ ids }) => { state.registered = state.registered.filter(r => !ids.includes(r.id)); },
      getRegisteredContentScripts: async ({ ids } = {}) => state.registered.filter(r => !ids || ids.includes(r.id))
    },
    contentScripts: { register: async o => ({ unregister: async () => {} }) },
    browsingData: { remove: async (o, t) => { state.browsingData.push({ o, t }); }, removeCookies: async () => {} },
    runtime: { onStartup: event(), onInstalled: event(), onMessage: event(), openOptionsPage() {} },
    alarms: { clear() {}, create() {}, onAlarm: event() },
    browserAction: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} }
  };
  const ctx = {
    browser, console, URL, Intl,
    setTimeout: (f) => { state.timers.push(f); return state.timers.length; },
    clearTimeout() {}
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  loadI18n(ctx);
  for (const f of ["lib/core.js", "lib/pagefns.js", "background.js"]) vm.runInContext(read(f), ctx, { filename: f });
  const tick = () => new Promise(r => setImmediate(r));
  return {
    browser, state, ctx,
    eval: code => vm.runInContext(code, ctx),
    /* alle anstehenden Timer ausführen (auch neu entstehende), mehrere Runden */
    async runTimers(rounds = 5) {
      for (let i = 0; i < rounds; i++) {
        const t = state.timers.splice(0);
        if (!t.length) { await tick(); continue; }
        for (const f of t) await f();
        await tick();
      }
    },
    async ready() { for (let i = 0; i < 10; i++) await tick(); await vm.runInContext("ready", ctx); },
    /* Nachricht an den Hintergrund senden wie runtime.sendMessage */
    send: async msg => (await browser.runtime.onMessage.fire(msg)).find(x => x !== undefined)
  };
}

module.exports = { ROOT, read, loadCore, loadBackground, cookie, event };
