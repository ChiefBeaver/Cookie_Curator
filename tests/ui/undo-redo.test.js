/* Rückgängig/Wiederholen in Seiten-Editor, globalen Regeln, Einstellungen und Popup */
"use strict";
const assert = require("assert");

module.exports = [
  ["Rückgängig/Wiederholen überall (Regressionstest „Regel kommt nicht wieder“)", async ({ newPage, BASE }) => {
    const p = await newPage();
    const C = () => p.evaluate(() => __mock.store.cc_config);
    const undo = async () => { await p.click("button.hist >> nth=0"); await p.waitForTimeout(400); };
    const redo = async () => { await p.click("button.hist >> nth=1"); await p.waitForTimeout(400); };
    await p.goto(BASE + "options/options.html#site/example.com"); await p.waitForTimeout(700);
    await p.locator("table.cookie-table tr.ck", { hasText: "lang" }).locator("td.name").click(); await p.waitForTimeout(150);
    await p.click("text=Präzise Regel anlegen"); await p.waitForTimeout(300);
    await p.click("text=Präfix-Regel anlegen"); await p.waitForTimeout(300);
    await undo(); await undo(); assert.ok(!(await C()).sites["example.com"]);
    await redo(); await redo(); assert.equal((await C()).sites["example.com"].rules.length, 2);
    assert.ok(await p.locator(".rules-card tbody input.mono").count() >= 2, "Oberfläche zeigt beide Regeln");
    await p.goto(BASE + "options/options.html#rules"); await p.waitForTimeout(600);
    await p.click("text=+ Cookie-Regel"); await p.waitForTimeout(300);
    await undo(); assert.equal((await C()).globalRules.length, 0);
    await redo(); assert.equal((await C()).globalRules.length, 1);
    await p.goto(BASE + "options/options.html#settings"); await p.waitForTimeout(500);
    await p.locator(".form-grid select").first().selectOption("delete"); await p.waitForTimeout(300);
    await undo(); await redo();
    assert.equal(await p.locator(".form-grid select").first().inputValue(), "delete");
    const pp = await newPage(800, 600);
    await pp.goto(BASE + "popup/popup.html"); await pp.waitForTimeout(700);
    await pp.locator("table.cookie-table tr.ck", { hasText: "_gid" }).locator("select.quick").selectOption("keep"); await pp.waitForTimeout(400);
    await pp.click("button.hist >> nth=0"); await pp.waitForTimeout(400); await pp.click("button.hist >> nth=1"); await pp.waitForTimeout(400);
    assert.equal(await pp.locator("table.cookie-table tr.ck", { hasText: "_gid" }).locator("select.quick").inputValue(), "keep");
  }],
];
