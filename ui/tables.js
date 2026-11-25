/* Cookie Curator – veränderbare Spaltenbreiten für alle Tabellen (table.grid)
 * - Griff am rechten Rand jedes Spaltenkopfs: ziehen = Breite ändern
 * - Doppelklick auf einen Griff: alle Spalten dieser Tabelle zurücksetzen
 * - Breiten werden pro Tabelle (erkannt an den Spaltennamen) im Browser gemerkt
 */
(function (root) {
  "use strict";

  const PREFIX = "cc_colw:";

  function tableKey(table) {
    const page = location.pathname.split("/").slice(-2).join("/");
    const cols = [...table.tHead.rows[0].cells].map(c => c.textContent.replace(/[▴▾▲▼↑↓]/g, "").trim()).join("|");
    return PREFIX + page + ":" + cols;
  }

  function load(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function save(key, v) { try { if (v) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch (e) { /* privater Modus o. ä. */ } }

  function apply(table, widths) {
    const ths = [...table.tHead.rows[0].cells];
    if (!widths || widths.length !== ths.length) {
      table.classList.remove("cc-fixed");
      table.style.width = "";
      ths.forEach(th => { th.style.width = ""; });
      return;
    }
    table.classList.add("cc-fixed");
    ths.forEach((th, i) => { th.style.width = widths[i] + "px"; });
    table.style.width = widths.reduce((a, b) => a + b, 0) + "px";
  }

  /* Standardbreiten: ohne gespeicherte Breiten passt sich die Tabelle in den verfügbaren Platz ein.
   * Breite Textspalten werden zuerst schmaler (Inhalt endet mit „…“), schmale Spalten bleiben. */
  const MIN_TEXT_COL = 90;
  function fit(table) {
    if (!table.isConnected || table.dataset.ccUser === "1") return;
    const box = table.parentElement;
    const avail = box ? box.clientWidth : 0;
    if (!avail) return;
    apply(table, null);                                  // natürliche Breiten messen
    const ths = [...table.tHead.rows[0].cells];
    const ws = ths.map(th => th.getBoundingClientRect().width);
    const sum = ws.reduce((a, b) => a + b, 0);
    if (sum <= avail + 1) { table.dataset.ccFit = ""; return; }
    let excess = sum - avail;
    // nur Textspalten verschmälern – nie Spalten mit Knöpfen, Auswahlfeldern, Häkchen oder Zahlen
    const rows = [...table.tBodies[0] ? table.tBodies[0].rows : []].filter(r => r.cells.length === ths.length).slice(0, 8);
    const fixedCol = ths.map((th, i) => th.classList.contains("num") || rows.some(r => {
      const c = r.cells[i];
      return c.classList.contains("num") || c.classList.contains("actions") || c.classList.contains("order") || c.classList.contains("split") ||
        !!c.querySelector("button, select, input");
    }));
    const room = ws.map((w, i) => fixedCol[i] ? 0 : Math.max(0, w - MIN_TEXT_COL));
    const totalRoom = room.reduce((a, b) => a + b, 0);
    if (totalRoom <= 0) return;                          // passt nicht – Scrollbar
    const take = Math.min(excess, totalRoom);
    const widths = ws.map((w, i) => Math.floor(w - take * room[i] / totalRoom));
    apply(table, widths);
    table.dataset.ccFit = "1";
  }

  // Tabellen in zugeklappten Bereichen beim Aufklappen einpassen
  document.addEventListener("toggle", e => {
    if (e.target && e.target.open && e.target.querySelectorAll) e.target.querySelectorAll("table.grid[data-cc-resize]").forEach(fit);
  }, true);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => document.querySelectorAll("table.grid[data-cc-resize]").forEach(fit), 150);
  });

  function enhance(table) {
    if (table.dataset.ccResize || !table.tHead || !table.tHead.rows.length) return;
    if (table.closest(".help-table")) return;          // Hilfetexte bleiben fliessend
    table.dataset.ccResize = "1";
    const ths = [...table.tHead.rows[0].cells];
    const key = tableKey(table);
    const saved = load(key);
    if (saved && saved.length === ths.length) { table.dataset.ccUser = "1"; apply(table, saved); }
    else requestAnimationFrame(() => fit(table));

    ths.forEach((th, i) => {
      const h = document.createElement("span");
      h.className = "cc-col-resize";
      h.title = "Ziehen: Spaltenbreite ändern · Doppelklick: Breiten zurücksetzen";
      h.addEventListener("click", e => e.stopPropagation());              // nicht sortieren
      h.addEventListener("dblclick", e => { e.stopPropagation(); save(key, null); table.dataset.ccUser = ""; fit(table); });
      h.addEventListener("pointerdown", e => {
        if (e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        const widths = ths.map(t => Math.round(t.getBoundingClientRect().width));  // aktuelle Breiten einfrieren
        apply(table, widths);
        const x0 = e.clientX, w0 = widths[i];
        h.setPointerCapture(e.pointerId);
        h.classList.add("active");
        const move = ev => { widths[i] = Math.max(36, Math.round(w0 + ev.clientX - x0)); apply(table, widths); };
        const up = () => {
          h.removeEventListener("pointermove", move);
          h.removeEventListener("pointerup", up);
          h.classList.remove("active");
          table.dataset.ccUser = "1";
          save(key, widths);
        };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", up);
      });
      th.appendChild(h);
    });
  }

  function enhanceAll(scope) { (scope || document).querySelectorAll("table.grid").forEach(enhance); }

  function observe(scope) {
    scope = scope || document.body;
    enhanceAll(scope);
    let queued = false;
    new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; enhanceAll(scope); });
    }).observe(scope, { childList: true, subtree: true });
  }

  function resetAll() {
    try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k)); } catch (e) {}
    document.querySelectorAll("table.grid[data-cc-resize]").forEach(t => { t.dataset.ccUser = ""; fit(t); });
  }

  root.CCTables = { enhance, enhanceAll, observe, resetAll, fit };
})(typeof self !== "undefined" ? self : this);
