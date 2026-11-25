/* Regel-Engine, Domains, Kategorien, Normalisierung (lib/core.js) */
"use strict";
const assert = require("assert");
const { loadCore } = require("./helpers");
const CC = loadCore();
const ck = (name, domain = ".example.com", extra = {}) => Object.assign({ name, domain, path: "/", storeId: "firefox-default", value: "x" }, extra);

module.exports = [
  ["baseDomain: mehrteilige Suffixes, IP, localhost, eigene Suffixes", () => {
    assert.equal(CC.baseDomain(".login.example.co.uk"), "example.co.uk");
    assert.equal(CC.baseDomain("www.srf.ch"), "srf.ch");
    assert.equal(CC.baseDomain("foo.github.io"), "foo.github.io");
    assert.equal(CC.baseDomain("localhost"), "localhost");
    assert.equal(CC.baseDomain("192.168.1.1"), "192.168.1.1");
    CC.setExtraSuffixes("co.ch"); assert.equal(CC.baseDomain("a.b.co.ch"), "b.co.ch"); CC.setExtraSuffixes("");
  }],
  ["Kategorien: Consent, Tracking vor Login, Login", () => {
    const cfg = CC.defaultConfig();
    const ev = c => CC.evaluate(c, cfg);
    assert.equal(ev(ck("_ga")).category, "tracking"); assert.equal(ev(ck("_ga")).action, "delete");
    assert.equal(ev(ck("OptanonConsent")).category, "consent"); assert.equal(ev(ck("OptanonConsent")).action, "keep");
    assert.equal(ev(ck("PHPSESSID")).category, "auth");
    assert.equal(ev(ck("_hjSessionUser_123")).category, "tracking", "Hotjar enthält 'Session', ist aber Tracking");
    assert.equal(ev(ck("euconsent-v2")).category, "consent");
  }],
  ["Reihenfolge: Seitenregel > globale Regel > Kategorie > Standard", () => {
    const cfg = CC.defaultConfig();
    const ev = c => CC.evaluate(c, cfg);
    assert.equal(ev(ck("foo")).action, "keep");
    cfg.settings.defaultAction = "delete"; assert.equal(ev(ck("foo")).action, "delete");
    cfg.sites["example.com"] = CC.defaultSiteConfig();
    cfg.sites["example.com"].rules.push(CC.newRule({ match: "exact", name: "foo", action: "keep" }));
    assert.equal(ev(ck("foo")).action, "keep"); assert.equal(ev(ck("foo")).source, "site-rule");
    cfg.sites["example.com"].categories.tracking = "block"; assert.equal(ev(ck("_gid")).action, "block");
    cfg.globalRules.push(CC.newRule({ match: "regex", name: "/^_gid$/", action: "keep" })); assert.equal(ev(ck("_gid")).action, "keep");
  }],
  ["Regel mit Domain- und Pfad-Glob", () => {
    const cfg = CC.defaultConfig(); cfg.settings.defaultAction = "delete";
    cfg.sites["example.com"] = CC.defaultSiteConfig();
    cfg.sites["example.com"].rules.push(CC.newRule({ match: "glob", name: "*", domain: "shop.example.com", path: "/cart*", action: "keep" }));
    assert.equal(CC.evaluate(ck("bar", "shop.example.com", { path: "/cart/1" }), cfg).action, "keep");
    assert.equal(CC.evaluate(ck("bar", "shop.example.com", { path: "/x" }), cfg).action, "delete");
  }],
  ["Partitioniertes Drittanbieter-Cookie gehört zur Top-Level-Seite", () => {
    const p = ck("IDE", ".doubleclick.net", { partitionKey: { topLevelSite: "https://example.com" } });
    assert.equal(CC.siteKeyForCookie(p), "example.com"); assert.ok(CC.isThirdParty(p));
  }],
  ["cookieUrl und ungültige Regex", () => {
    assert.equal(CC.cookieUrl(ck("a", ".x.com", { secure: true, path: "/p" })), "https://x.com/p");
    assert.ok(CC.validateRegex("/(/"), "ungültige Regex wird gemeldet");
  }],
  ["normalizeConfig ergänzt fehlende Felder (auch cacheStorage)", () => {
    const old = { settings: { storage: { indexedDB: "delete" } }, sites: { "a.ch": { rules: [{ name: "x" }], storage: { localStorage: "delete" } } } };
    const n = CC.normalizeConfig(old);
    assert.equal(n.settings.storage.indexedDB, "delete");
    assert.equal(n.settings.storage.cacheStorage, "keep");
    assert.equal(n.sites["a.ch"].storage.cacheStorage, "inherit");
    assert.equal(n.sites["a.ch"].rules[0].action, "keep");
    assert.ok(n.sites["a.ch"].rules[0].id);
  }],
  ["Leere Seiten erkennen", () => {
    const e = CC.defaultSiteConfig(); assert.ok(CC.isSiteConfigEmpty(e));
    e.storage.cacheStorage = "delete"; assert.ok(!CC.isSiteConfigEmpty(e));
  }],
];
