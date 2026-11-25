/* Website-Daten: Schnellregel, Eintragsregeln, Bereinigung, Cache-Storage-Modus */
"use strict";
const assert = require("assert");
const modeSelect = (p, label) => p.locator(".data-policy label.field", { hasText: label }).locator("select");

module.exports = [
  ["Eintragsregeln, Bereinigen im Modus Löschen, Rückgängig", async ({ newPage, BASE, shot }) => {
    const p = await newPage();
    const cfg = () => p.evaluate(() => __mock.store.cc_config || null);
    await p.goto(BASE + "options/options.html#site/example.com"); await p.waitForTimeout(900);
    const card = p.locator(".storage-card");
    assert.ok(await card.locator("text=_ga_tracker").count(), "Live-Einträge sichtbar");
    await card.locator("tr", { hasText: "_ga_tracker" }).locator("select.quick").selectOption("delete"); await p.waitForTimeout(700);
    let c = await cfg();
    assert.equal(c.sites["example.com"].storage.localStorage, "selective");
    assert.equal(await p.evaluate(() => window.__cs.length), 1, "Seitenskript registriert");
    if (await p.locator(".entry-rules details").getAttribute("open") === null) await p.locator(".entry-rules summary").click();
    await p.locator(".entry-rules").locator("text=+ Eintragsregel").click(); await p.waitForTimeout(400);
    await p.locator(".entry-rules tbody tr").last().locator("select").nth(0).selectOption("glob"); await p.waitForTimeout(300);
    const inp = p.locator(".entry-rules tbody tr").last().locator("input.mono");
    await inp.fill("ads_*"); await inp.press("Tab"); await p.waitForTimeout(500);
    await card.locator("text=Eintragsregeln anwenden").click(); await p.waitForTimeout(800);
    assert.deepEqual((await p.evaluate(() => [...window.__page.localStorage._m.keys()])).sort(), ["auth.token", "theme"]);
    await modeSelect(p, "IndexedDB").selectOption("delete"); await p.waitForTimeout(400);
    await modeSelect(p, "HTTP-Cache").selectOption("delete"); await p.waitForTimeout(400);
    await card.locator("button", { hasText: "Bereinigen (2)" }).click(); await card.locator("button", { hasText: "Jetzt löschen?" }).click(); await p.waitForTimeout(600);
    const bd = await p.evaluate(() => window.__bd);
    assert.deepEqual(bd[0].t, { indexedDB: true, cache: true });
    assert.ok(bd[0].o.hostnames.includes("www.example.com") && bd[0].o.hostnames.includes("example.com"));
    await p.click("button.hist >> nth=0"); await p.waitForTimeout(500);
    c = await cfg(); assert.equal(c.sites["example.com"].storage.cache, "inherit", "Rückgängig");
    await shot(p, "ui-website-daten");
  }],
  ["Cache Storage: Modus in Richtlinie, Kürzel in der Übersicht", async ({ newPage, BASE, shot }) => {
    const p = await newPage();
    await p.goto(BASE + "options/options.html#site/example.com"); await p.waitForTimeout(800);
    await modeSelect(p, "Cache Storage").selectOption("delete"); await p.waitForTimeout(400);
    const c = await p.evaluate(() => __mock.store.cc_config);
    assert.equal(c.sites["example.com"].storage.cacheStorage, "delete");
    await p.goto(BASE + "options/options.html#sites"); await p.waitForTimeout(800);
    const cell = await p.locator(".overview tbody tr", { hasText: "example.com" }).first().textContent();
    assert.ok(cell.includes("A✕"), "Übersicht zeigt A✕: " + cell);
    await shot(p, "ui-uebersicht");
  }],
];
