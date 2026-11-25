/* Oberflächentests: Dashboard und Popup in Chromium mit nachgebildeter browser-API.
 * Aufruf: node ui/run-ui.js [Filter]   (zuvor: npm install && npx playwright install chromium) */
"use strict";
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..", "..");
const BASE = pathToFileURL(ROOT).href + "/";
const OUT = path.join(__dirname, "..", "output");
const MOCK = fs.readFileSync(path.join(__dirname, "mock-browser.js"), "utf8");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const only = process.argv[2];
  const headed = process.argv.includes("--headed");
  const browser = await chromium.launch({ headless: !headed });
  let pass = 0, fail = 0;
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort()) {
    if (only && !only.startsWith("--") && !f.includes(only)) continue;
    console.log("\n" + f);
    for (const [name, fn] of require(path.join(__dirname, f))) {
      const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
      await ctx.addInitScript(MOCK);
      const errors = [];
      const newPage = async (w, h) => {
        const p = await ctx.newPage();
        if (w) await p.setViewportSize({ width: w, height: h });
        p.on("pageerror", e => errors.push(e.message));
        p.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
        return p;
      };
      try {
        await fn({ newPage, BASE, OUT, shot: (p, n) => p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: true }) });
        if (errors.length) throw new Error("Fehler in der Seite: " + errors.join(" | "));
        pass++; console.log("  OK    " + name);
      } catch (e) {
        fail++; console.log("  FAIL  " + name + "\n        " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n        "));
      } finally { await ctx.close(); }
    }
  }
  await browser.close();
  console.log(`\nOberflächentests: ${pass} bestanden, ${fail} fehlgeschlagen (Bildschirmfotos in tests/output)`);
  process.exit(fail ? 1 : 0);
})();
