/* Sprachknopf: Wechsel Deutsch ↔ Englisch in Dashboard und Popup */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

/* alle Schlüssel aus locales/en.js – tauchen sie als Text auf, fehlt eine Übersetzung */
const KEYS = (() => {
  let d = {};
  new Function("I18N", fs.readFileSync(path.join(__dirname, "..", "..", "locales", "en.js"), "utf8"))({ register: (c, x) => { d = x; } });
  return Object.keys(d).map(k => k.replace(/_(one|other)$/, ""));
})();

/* sichtbarer Text inkl. Tooltips, Platzhalter und Optionen */
const pageText = p => p.evaluate(() => {
  const parts = [document.body.innerText];
  for (const e of document.querySelectorAll("[title],[placeholder]")) parts.push(e.title || "", e.placeholder || "");
  for (const o of document.querySelectorAll("option")) parts.push(o.textContent);
  return parts.join("\n");
});

function checkEnglish(text, where) {
  const raw = KEYS.filter(k => text.includes(k));
  assert.deepEqual(raw, [], where + ": Schlüssel statt Text");
  const german = text.split("\n").filter(l => /[äöüÄÖÜß]/.test(l));
  assert.deepEqual(german, [], where + ": deutsche Texte");
}

module.exports = [
  ["Sprachknopf wechselt die Sprache und merkt sie sich", async ({ newPage, BASE, shot }) => {
    const p = await newPage();
    await p.goto(BASE + "options/options.html#sites"); await p.waitForTimeout(700);
    const btn = p.locator("#lang-slot button");
    assert.equal(await btn.textContent(), "DE");
    assert.ok((await btn.getAttribute("title")).startsWith("Sprache:"), "Tooltip deutsch");
    await btn.click(); await p.waitForTimeout(900);   // Seite lädt neu
    assert.equal(await p.evaluate(() => __mock.store.cc_lang), "en");
    assert.equal(await p.evaluate(() => document.documentElement.lang), "en");
    assert.equal(await p.locator("#lang-slot button").textContent(), "EN");
    assert.ok((await p.locator("#lang-slot button").getAttribute("title")).startsWith("Language:"), "Tooltip englisch");
    await shot(p, "ui-sprache-en");
    const pp = await newPage(800, 600);
    await pp.goto(BASE + "popup/popup.html"); await pp.waitForTimeout(700);
    // jede Testseite hat ihren eigenen nachgebildeten Speicher, das Popup beginnt also deutsch
    assert.equal(await pp.locator("#lang-slot button").textContent(), "DE");
    await pp.locator("#lang-slot button").click(); await pp.waitForTimeout(900);
    assert.equal(await pp.evaluate(() => __mock.store.cc_lang), "en");
    assert.equal(await pp.locator("#lang-slot button").textContent(), "EN");
  }],
  ["Hilfe wird in der gewählten Sprache geladen", async ({ newPage, BASE }) => {
    const p = await newPage();
    await p.goto(BASE + "options/options.html#help"); await p.waitForTimeout(800);
    assert.equal(await p.locator(".help h2").first().textContent(), "A · Wie dieses Add-on funktioniert");
    assert.ok(await p.locator(".help .toc li").count() >= 18, "Inhaltsverzeichnis");
    await p.click("#lang-slot button"); await p.waitForTimeout(1000);
    assert.equal(await p.locator(".help h2").first().textContent(), "A · How this add-on works");
    assert.equal(await p.locator("#nav a[data-route=help]").textContent(), "How it works");
  }],
  ["Englisch: alle Ansichten ohne fehlende Übersetzungen", async ({ newPage, BASE, shot }) => {
    const p = await newPage();
    await p.goto(BASE + "options/options.html#sites"); await p.waitForTimeout(700);
    await p.click("#lang-slot button"); await p.waitForTimeout(1000);
    for (const route of ["sites", "site/example.com", "rules", "categories", "settings", "archive", "log", "backup", "help"]) {
      await p.goto(BASE + "options/options.html#" + route); await p.waitForTimeout(900);
      if (route.startsWith("site/")) {
        // Detailansicht und alle Abschnitte aufklappen
        await p.locator("table.cookie-table tr.ck td.name").first().click(); await p.waitForTimeout(200);
        for (const d of await p.locator("details:not([open]) > summary").all()) await d.click();
        await p.waitForTimeout(300);
        await shot(p, "ui-site-en");
      }
      checkEnglish(await pageText(p), route);
    }
    const pp = await newPage(800, 600);
    await pp.goto(BASE + "popup/popup.html"); await pp.waitForTimeout(700);
    await pp.click("#lang-slot button"); await pp.waitForTimeout(1000);
    checkEnglish(await pageText(pp), "popup");
    await shot(pp, "ui-popup-en");
  }],
];

