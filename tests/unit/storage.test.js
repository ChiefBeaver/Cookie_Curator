/* Website-Daten: Modi, Eintragsregeln, Seitenskript (lib/core.js) */
"use strict";
const assert = require("assert");
const vm = require("vm");
const { loadCore } = require("./helpers");
const CC = loadCore();
const mkStorage = () => {
  const m = new Map();
  return { get length() { return m.size; }, key: i => [...m.keys()][i], getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
};

module.exports = [
  ["Seitenskript wendet Eintragsregeln an (exact, regex, glob mit Sonderzeichen, Standard)", () => {
    const ls = mkStorage(), ss = mkStorage();
    ["_ga_x", "auth.token", "theme", "tracker[1]", "a.b", "ID?"].forEach(k => ls.setItem(k, "v"));
    ["tmp1", "keep"].forEach(k => ss.setItem(k, "v"));
    const cfg = CC.defaultConfig(); cfg.sites["ex.com"] = CC.defaultSiteConfig();
    const st = cfg.sites["ex.com"].storage;
    st.localStorage = "selective"; st.sessionStorage = "selective"; st.keyDefault = "delete";
    st.keyRules = [
      CC.newKeyRule({ match: "exact", name: "theme", action: "keep" }),
      CC.newKeyRule({ match: "regex", name: "/^auth\\./", action: "keep", store: "local" }),
      CC.newKeyRule({ match: "glob", name: "tracker[*", action: "delete" }),
      CC.newKeyRule({ match: "glob", name: "keep", action: "keep", store: "session" }),
      CC.newKeyRule({ match: "glob", name: "a.b", action: "keep" }),
      CC.newKeyRule({ match: "glob", name: "ID?", action: "keep" })
    ];
    const code = CC.pageKeyCleanerCode(CC.pageKeyRules(cfg, "ex.com"));
    vm.runInNewContext(code, { window: { localStorage: ls, sessionStorage: ss }, location: { host: "ex.com" } });
    assert.deepEqual([...ls._m.keys()].sort(), ["ID?", "a.b", "auth.token", "theme"]);
    assert.deepEqual([...ss._m.keys()], ["keep"]);
  }],
  ["evalKey folgt dem Modus", () => {
    const cfg = CC.defaultConfig(); cfg.sites["ex.com"] = CC.defaultSiteConfig();
    const st = cfg.sites["ex.com"].storage;
    st.localStorage = "selective"; st.keyDefault = "delete";
    st.keyRules = [CC.newKeyRule({ match: "exact", name: "theme", action: "keep" })];
    assert.equal(CC.evalKey(cfg, "ex.com", "local", "_ga_x").action, "delete");
    assert.equal(CC.evalKey(cfg, "ex.com", "local", "theme").action, "keep");
    st.localStorage = "inherit"; assert.equal(CC.evalKey(cfg, "ex.com", "local", "_ga_x").action, "keep");
  }],
  ["storageDeleteTypes inkl. Cache Storage; nur browsingData-Typen gehen an browsingData", () => {
    const cfg = CC.defaultConfig(); cfg.sites["ex.com"] = CC.defaultSiteConfig();
    cfg.settings.storage.indexedDB = "delete"; cfg.sites["ex.com"].storage.cacheStorage = "delete"; cfg.sites["ex.com"].storage.cache = "delete";
    assert.deepEqual([...CC.storageDeleteTypes(cfg, "ex.com")], ["indexedDB", "cacheStorage", "cache"]);
    assert.ok(!CC.BROWSING_DATA_TYPES.includes("cacheStorage"));
    assert.ok(CC.WHOLE_TYPES.includes("cacheStorage") && !CC.WHOLE_TYPES.includes("sessionStorage"));
  }],
  ["Code-Texte sind gültiges JavaScript (auch mit Anführungszeichen in Namen)", () => {
    new Function(CC.removeKeysCode("local", ['a"b', "c\\d"]));
  }],
];
