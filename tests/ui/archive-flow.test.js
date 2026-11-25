/* Archivieren, löschen, zurückholen, Autostart beim Browserstart */
"use strict";
const assert = require("assert");

module.exports = [
  ["Archiv: archivieren, doppelt überspringen, archivieren+löschen, zurückholen, Autostart", async ({ newPage, BASE, shot }) => {
    const p = await newPage();
    await p.goto(BASE + "options/options.html#site/example.com"); await p.waitForTimeout(700);
    const val = n => p.evaluate(n => { const c = __mock.cookies().find(c => c.name === n); return c ? c.value : null; }, n);
    const row = n => p.locator("table.cookie-table tr.ck", { hasText: n }).first();
    const archive = () => p.evaluate(() => __mock.store.cc_archive);
    await row("PHPSESSID").locator("input[type=checkbox]").check(); await p.waitForTimeout(100);
    await row("OptanonConsent").locator("input[type=checkbox]").check(); await p.waitForTimeout(100);
    await p.click(".cookies .toolbar.bulk >> text=Archivieren"); await p.waitForTimeout(400);
    assert.equal((await archive()).length, 2, "2 archiviert");
    await row("PHPSESSID").locator("input[type=checkbox]").check(); await row("OptanonConsent").locator("input[type=checkbox]").check();
    await p.click(".cookies .toolbar.bulk >> text=Archivieren"); await p.waitForTimeout(300);
    assert.equal((await archive()).length, 2, "gleicher Inhalt nicht doppelt");
    await p.evaluate(() => browser.cookies.set({ url: "https://www.example.com/", name: "PHPSESSID", value: "sess-NEW", httpOnly: true, storeId: "firefox-default" })); await p.waitForTimeout(600);
    await p.locator(".archive-table tr", { hasText: "PHPSESSID" }).first().locator("label.autostart input").check(); await p.waitForTimeout(400);
    assert.equal((await archive()).filter(e => e.autoRestore).length, 1);
    await row("lang").locator("input[type=checkbox]").check(); await p.waitForTimeout(100);
    await p.click(".cookies .toolbar.bulk >> text=Archivieren + löschen"); await p.click(".cookies .toolbar.bulk >> text=archivieren & löschen?"); await p.waitForTimeout(700);
    assert.equal(await val("lang"), null, "lang gelöscht");
    await p.click("text=Fehlende zurückholen"); await p.waitForTimeout(600);
    assert.equal(await val("lang"), "de", "lang zurückgeholt");
    await p.evaluate(() => browser.cookies.set({ url: "https://www.example.com/", name: "PHPSESSID", value: "sess-OTHER", httpOnly: true, storeId: "firefox-default" }));
    await p.evaluate(() => __mock.startup._fire()); await p.waitForTimeout(4800);
    assert.equal(await val("PHPSESSID"), "sess-ORIGINAL", "Autostart setzt beim Start zurück");
    await shot(p, "ui-archiv");
  }],
];
