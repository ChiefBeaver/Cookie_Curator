/* Cookie-Archiv: Versionen, Autostart, Wiederherstellungs-Parameter (lib/core.js) */
"use strict";
const assert = require("assert");
const { loadCore } = require("./helpers");
const CC = loadCore();
const now = Date.now() / 1000;
const c = (v, extra = {}) => Object.assign({ name: "s", value: v, domain: ".ex.com", path: "/", storeId: "firefox-default", secure: true, expirationDate: now + 1000 }, extra);

module.exports = [
  ["max. Versionen, Autostart-Version bleibt erhalten", () => {
    const list = [];
    for (let i = 0; i < 8; i++) {
      CC.addToArchive(list, [c("v" + i)], "", 3);
      if (i === 1) CC.setAutoRestore(list, list.find(e => e.cookie.value === "v1").aid, true);
    }
    assert.deepEqual(list.map(e => e.cookie.value).sort(), ["v1", "v5", "v6", "v7"]);
  }],
  ["gleicher Inhalt wird nicht doppelt archiviert", () => {
    const list = [];
    CC.addToArchive(list, [c("a")], "", 5);
    assert.equal(CC.addToArchive(list, [c("a")], "", 5).skipped, 1);
  }],
  ["nur eine Autostart-Version pro Cookie", () => {
    const list = [];
    CC.addToArchive(list, [c("a")], "", 5); CC.addToArchive(list, [c("b")], "", 5);
    CC.setAutoRestore(list, list[0].aid, true); CC.setAutoRestore(list, list[1].aid, true);
    assert.equal(list.filter(e => e.autoRestore).length, 1);
  }],
  ["restoreDetails: Ablauf verlängern, Sitzungscookie, Host-only, SameSite=None", () => {
    let d = CC.restoreDetails(c("x", { expirationDate: now - 100 }), 30); assert.ok(d.expirationDate > now + 29 * 86400);
    d = CC.restoreDetails(c("x", { expirationDate: now - 100 }), 0); assert.equal(d.expirationDate, undefined);
    d = CC.restoreDetails(c("x", { hostOnly: true, domain: "www.ex.com" }), 30); assert.equal(d.domain, undefined); assert.equal(d.url, "https://www.ex.com/");
    d = CC.restoreDetails(c("x", { partitionKey: { topLevelSite: "https://a.ch" }, sameSite: "no_restriction", secure: false }), 30);
    assert.ok(d.secure); assert.ok(d.partitionKey);
  }],
];
