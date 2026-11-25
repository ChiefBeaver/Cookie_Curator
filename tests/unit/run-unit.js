/* Führt alle *.test.js in diesem Ordner aus. Jede Datei exportiert ein Array [[name, async fn], …]. */
"use strict";
const fs = require("fs");
const path = require("path");
(async () => {
  let pass = 0, fail = 0;
  const only = process.argv[2];
  for (const f of fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort()) {
    if (only && !f.includes(only)) continue;
    console.log("\n" + f);
    for (const [name, fn] of require(path.join(__dirname, f))) {
      try { await fn(); pass++; console.log("  OK    " + name); }
      catch (e) { fail++; console.log("  FAIL  " + name + "\n        " + (e && e.stack || e).split("\n").slice(0, 4).join("\n        ")); }
    }
  }
  console.log(`\nEinheitentests: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();
