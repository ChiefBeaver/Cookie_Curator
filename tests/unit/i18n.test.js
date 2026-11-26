/* Übersetzungen (lib/i18n.js, locales/*.js) */
"use strict";
const assert = require("assert");
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { ROOT, read } = require("./helpers");

function fresh() {
  const ctx = { console, Intl };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(read("lib/i18n.js"), ctx);
  return ctx.I18N;
}
const localeFiles = fs.readdirSync(path.join(ROOT, "locales")).filter(f => f.endsWith(".js"));
function dictOf(file) {
  let dict = null;
  const ctx = { I18N: { register: (code, d) => { dict = { code, d }; } } };
  vm.createContext(ctx);
  vm.runInContext(read("locales/" + file), ctx);
  return dict;
}

module.exports = [
  ["t: Platzhalter, Mehrzahl, Ersatzsprache, unbekannter Schlüssel", () => {
    const I = fresh();
    I.register("en", { hello: "Hello {name}", items_one: "{n} item", items_other: "{n} items", onlyEn: "only English", fn: p => "x" + p.a });
    I.register("de", { hello: "Hallo {name}", items_one: "{n} Eintrag", items_other: "{n} Einträge" });
    I.setLang("de");
    assert.equal(I.t("hello", { name: "Welt" }), "Hallo Welt");
    assert.equal(I.t("items", { n: 1 }), "1 Eintrag");
    assert.equal(I.t("items", { n: 4 }), "4 Einträge");
    assert.equal(I.t("onlyEn"), "only English");
    assert.equal(I.t("fn", { a: 7 }), "x7");
    assert.equal(I.t("missing.key"), "missing.key");
    assert.equal(I.t("hello", {}), "Hallo {name}");
    I.setLang("en"); assert.equal(I.t("items", { n: 1 }), "1 item");
  }],
  ["Sprachwahl: Normalisierung, Reihenfolge des Sprachknopfs", () => {
    const I = fresh();
    for (const f of localeFiles) { const { code, d } = dictOf(f); I.register(code, d); }
    assert.equal(I.normalize("de-CH"), "de");
    assert.equal(I.normalize("EN_us"), "en");
    assert.equal(I.normalize("xx"), null);
    I.setLang("zz"); assert.equal(I.getLang(), "en");
    const codes = I.languages().map(l => l.code);
    I.setLang(codes[0]); assert.equal(I.next(), codes[1 % codes.length]);
    I.setLang(codes[codes.length - 1]); assert.equal(I.next(), codes[0]);
  }],
  ["Jede Sprache in LANGUAGES hat eine Datei und dieselben Schlüssel wie Englisch", () => {
    const I = fresh();
    const files = new Set(localeFiles.map(f => f.replace(/\.js$/, "")));
    for (const code of Object.keys(I.LANGUAGES)) assert.ok(files.has(code), "locales/" + code + ".js fehlt");
    const en = dictOf("en.js").d;
    const base = k => k.replace(/_(zero|one|two|few|many|other)$/, "");
    const enKeys = new Set(Object.keys(en).map(base));
    for (const f of localeFiles) {
      const { code, d } = dictOf(f);
      assert.ok(I.LANGUAGES[code], code + " fehlt in LANGUAGES");
      const keys = new Set(Object.keys(d).map(base));
      const missing = [...enKeys].filter(k => !keys.has(k));
      const extra = [...keys].filter(k => !enKeys.has(k));
      assert.deepEqual(missing, [], code + ": fehlende Schlüssel");
      assert.deepEqual(extra, [], code + ": Schlüssel, die es in en.js nicht gibt");
    }
  }],
];
