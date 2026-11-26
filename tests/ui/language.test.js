/* Sprachknopf: Wechsel Deutsch ↔ Englisch in Dashboard und Popup */
"use strict";
const assert = require("assert");

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
];
