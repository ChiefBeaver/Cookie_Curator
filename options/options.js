"use strict";
(function () {
  const { el, select, confirmButton, toast } = UI;
  const T = I18N.t;
  const view = document.getElementById("view");
  let cfg = null;
  let pendingSaves = [];   // JSON eigener, noch nicht gemeldeter Speicherungen
  let route = "sites";
  let currentEditor = null;
  let state = { sitesFilter: "", sitesMode: "all", sitesSort: { key: "total", dir: -1 }, logFilter: "", logTrigger: "all", archFilter: "", archMode: "all", archSelected: new Set() };

  async function load() {
    cfg = await CC.loadConfig();
    CC.setExtraSuffixes(cfg.settings.extraSuffixes);
  }

  async function save() {
    await CC.saveConfig(cfg, json => {
      pendingSaves.push(json);
      setTimeout(() => { const k = pendingSaves.indexOf(json); if (k >= 0) pendingSaves.splice(k, 1); }, 2000);
    });
  }

  browser.storage.onChanged.addListener(async (ch, area) => {
    if (area === "local" && ch[CC.ARCHIVE_KEY] && route === "archive") renderArchive();
    if (area !== "local" || !ch[CC.CONFIG_KEY]) return;
    const i = pendingSaves.indexOf(JSON.stringify(ch[CC.CONFIG_KEY].newValue));
    if (i >= 0) { pendingSaves.splice(0, i + 1); return; }
    await load();
    if (!route.startsWith("site/")) render(); // Seiten-Editor hat eigenen Listener
  });

  window.addEventListener("hashchange", render);

  function pageHead(title, ...right) {
    return el("div", { class: "page-head" }, el("h2", {}, title), el("span", { class: "spacer" }), ...right);
  }

  async function render() {
    route = decodeURIComponent((location.hash || "#sites").slice(1)) || "sites";
    for (const a of document.querySelectorAll("#nav a")) {
      a.classList.toggle("active", route === a.dataset.route || (route.startsWith("site/") && a.dataset.route === "sites"));
    }
    view.textContent = "";
    if (currentEditor) { currentEditor.destroy(); currentEditor = null; }
    if (route.startsWith("site/")) return renderSite(route.slice(5));
    switch (route) {
      case "rules": return renderRules();
      case "categories": return renderCategories();
      case "settings": return renderSettings();
      case "log": return renderLog();
      case "archive": return renderArchive();
      case "backup": return renderBackup();
      case "help": return renderHelp();
      default: return renderSites();
    }
  }

  /* ================================================================== */
  /* Seiten-Übersicht                                                    */
  /* ================================================================== */

  async function renderSites() {
    const all = await CC.getAllCookies();
    let open = new Set();
    try { open = new Set(await browser.runtime.sendMessage({ cmd: "openSites" })); } catch (e) {}

    const rows = new Map();
    const row = site => {
      if (!rows.has(site)) rows.set(site, { site, total: 0, keep: 0, delete: 0, block: 0, consent: 0, auth: 0, tracking: 0, tp: 0, cookies: [] });
      return rows.get(site);
    };
    for (const c of all) {
      const ev = CC.evaluate(c, cfg);
      const r = row(ev.site);
      r.total++; r[ev.action]++; r.cookies.push(c);
      if (ev.category) r[ev.category]++;
      if (CC.isThirdParty(c)) r.tp++;
    }
    for (const s of Object.keys(cfg.sites)) row(s);

    const f = state.sitesFilter.toLowerCase();
    let list = [...rows.values()].filter(r => {
      if (f && !r.site.includes(f)) return false;
      const sc = cfg.sites[r.site];
      const configured = sc && !CC.isSiteConfigEmpty(sc);
      if (state.sitesMode === "configured" && !configured) return false;
      if (state.sitesMode === "unconfigured" && configured) return false;
      if (state.sitesMode === "open" && !open.has(r.site)) return false;
      if (state.sitesMode === "pending" && !(r.delete + r.block)) return false;
      return true;
    });
    const { key, dir } = state.sitesSort;
    list.sort((a, b) => {
      const x = key === "site" ? a.site : a[key], y = key === "site" ? b.site : b[key];
      return x < y ? -dir : x > y ? dir : a.site.localeCompare(b.site);
    });

    const th = (k, label, title) => el("th", {
      class: "sortable" + (key === k ? " sorted" : ""), title: title || "",
      onclick: () => { state.sitesSort = { key: k, dir: key === k ? -dir : (k === "site" ? 1 : -1) }; renderSites(); }
    }, label, key === k ? (dir > 0 ? " ▴" : " ▾") : "");

    const g = cfg.settings;
    const tbody = el("tbody");
    for (const r of list) {
      const sc = cfg.sites[r.site];
      const configured = sc && !CC.isSiteConfigEmpty(sc);
      const go = () => { location.hash = "site/" + encodeURIComponent(r.site); };
      tbody.append(el("tr", {},
        el("td", { class: "site", onclick: go }, r.site, configured ? el("span", { class: "badge configured", style: "margin-left:6px" }, T("sites.configuredShort")) : null),
        el("td", { title: open.has(r.site) ? T("sites.colOpen") : "" }, open.has(r.site) ? el("span", { class: "dot" }) : ""),
        el("td", { class: "num" }, String(r.total)),
        el("td", { class: "num split", title: T("sites.split", { keep: r.keep, del: r.delete, block: r.block }) },
          el("span", { class: "n-keep" }, String(r.keep)), el("span", { class: "sep" }, "·"),
          el("span", { class: r.delete ? "n-del" : "muted" }, String(r.delete)), el("span", { class: "sep" }, "·"),
          el("span", { class: r.block ? "n-block" : "muted" }, String(r.block))),
        el("td", {},
          r.consent ? el("span", { class: "badge c-consent" }, "C " + r.consent) : null, " ",
          r.auth ? el("span", { class: "badge c-auth" }, "L " + r.auth) : null, " ",
          r.tracking ? el("span", { class: "badge c-tracking" }, "T " + r.tracking) : null, " ",
          r.tp ? el("span", { class: "badge c-3p" }, "3P " + r.tp) : null),
        el("td", { class: "dim" }, sc && sc.defaultAction !== "inherit" ? CC.ACTION_LABEL[sc.defaultAction] : "↳ " + CC.ACTION_LABEL[g.defaultAction]),
        el("td", { class: "dim" }, CC.effectiveTabClose(cfg, r.site) ? T("sites.on") : T("sites.off"), sc && sc.tabClose !== "inherit" ? "" : " ↳"),
        el("td", { class: "num" }, sc && sc.rules.length ? String(sc.rules.length) : ""),
        el("td", { class: "dim", title: CC.STORAGE_TYPES.map(t => CC.STORAGE_LABEL[t] + ": " + CC.MODE_LABEL[CC.effectiveStorageMode(cfg, r.site, t)]).join("\n") }, storageShort(r.site)),
        el("td", { class: "note", title: sc ? sc.note : "" }, sc ? sc.note : ""),
        el("td", { class: "actions" },
          el("button", { class: "btn small", onclick: go }, T("sites.edit")),
          UI.purgeButton(r.site, () => renderSites(), { cls: "small" }),
          r.delete + r.block ? el("button", {
            class: "btn small", title: T("sites.cleanTitle"),
            onclick: async () => { const x = await browser.runtime.sendMessage({ cmd: "cleanSite", site: r.site }); toast(T("sites.deleted", { n: x.length })); renderSites(); }
          }, T("sites.clean")) : null)
      ));
    }
    if (!list.length) tbody.append(el("tr", {}, el("td", { colspan: 13, class: "empty" }, T("sites.none"))));

    const addInput = el("input", { placeholder: "domain.ch", class: "mono", style: "width:160px" });
    const previewBox = el("div");
    const modes = [["all", T("sites.modeAll")], ["configured", T("sites.modeConfigured")], ["unconfigured", T("sites.modeUnconfigured")], ["open", T("sites.modeOpen")], ["pending", T("sites.modePending")]];

    view.textContent = "";
    view.append(
      pageHead(T("sites.title"),
        el("span", { class: "dim" }, T("sites.count", { cookies: all.length, sites: rows.size })),
        addInput,
        el("button", {
          class: "btn", onclick: () => {
            const v = CC.baseDomain(addInput.value.trim().replace(/^https?:\/\//, "").split("/")[0]);
            if (!v) return;
            CC.getSite(cfg, v, true); location.hash = "site/" + encodeURIComponent(v);
          }
        }, T("sites.configure"))),
      el("div", { class: "card" },
        el("div", { class: "toolbar" },
          el("input", { type: "search", placeholder: T("sites.filter"), value: state.sitesFilter, oninput: e => { state.sitesFilter = e.target.value; renderSitesDebounced(); } }),
          el("div", { class: "chips" }, modes.map(([v, l]) => el("button", { class: "chip" + (state.sitesMode === v ? " on" : ""), onclick: () => { state.sitesMode = v; renderSites(); } }, l))),
          el("span", { class: "spacer" }),
          el("button", {
            class: "btn", onclick: async () => {
              const x = await browser.runtime.sendMessage({ cmd: "cleanAll", dryRun: true, skipOpen: g.skipOpenSites });
              previewBox.textContent = "";
              previewBox.append(previewTable(x, T("sites.previewTitle") + (g.skipOpenSites ? T("sites.previewSkip") : "")));
            }
          }, T("sites.preview")),
          confirmButton(T("sites.cleanAll"), T("sites.cleanAllConfirm"), async () => {
            const x = await browser.runtime.sendMessage({ cmd: "cleanAll", skipOpen: g.skipOpenSites });
            toast(T("sites.cleanedCookies", { n: x.length }));
            renderSites();
          }, "primary")),
        el("div", { class: "table-scroll cookies-scroll" },
          el("table", { class: "grid overview" },
            el("thead", {}, el("tr", {},
              th("site", T("sites.colSite")), el("th", { title: T("sites.colOpen") }, "●"), th("total", T("sites.colCookies")),
              el("th", { class: "num split-head", title: T("sites.colSplitTitle") },
                ...[["keep", T("sites.colKeep")], ["delete", T("sites.colDelete")], ["block", T("sites.colBlock")]].flatMap(([k, l], i) => [i ? el("span", { class: "sep" }, "·") : null,
                  el("span", { class: "sortable" + (key === k ? " sorted" : ""), onclick: () => { state.sitesSort = { key: k, dir: key === k ? -dir : -1 }; renderSites(); } }, l, key === k ? (dir > 0 ? "▴" : "▾") : "")])),
              el("th", { title: T("sites.colCatTitle") }, T("sites.colCat")),
              el("th", { title: T("sites.colDefaultTitle") }, T("sites.colDefault")), el("th", {}, T("sites.colTabClose")),
              el("th", { title: T("sites.colRulesTitle") }, T("sites.colRules")), el("th", { title: T("sites.colDataTitle") }, T("sites.colData")), el("th", {}, T("sites.colNote")), el("th", {}, ""))),
            tbody))),
      previewBox
    );
    const inp = view.querySelector("input[type=search]");
    if (state.focusSitesFilter) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); state.focusSitesFilter = false; }
  }
  let sitesTimer = null;
  function renderSitesDebounced() {
    clearTimeout(sitesTimer);
    sitesTimer = setTimeout(() => { state.focusSitesFilter = true; view.textContent = ""; renderSites(); }, 200);
  }

  function storageShort(site) {
    const abbr = { localStorage: "L", sessionStorage: "S", indexedDB: "I", cacheStorage: "A", serviceWorkers: "W", cache: "H" };
    const parts = [];
    for (const t of CC.STORAGE_TYPES) {
      const m = CC.effectiveStorageMode(cfg, site, t);
      if (m === "delete") parts.push(abbr[t] + "✕");
      else if (m === "selective") parts.push(abbr[t] + "◐");
    }
    return parts.join(" ") || "—";
  }

  function previewTable(list, title) {
    return el("div", { class: "card" },
      el("h3", {}, `${title} – ${list.length}`),
      el("div", { class: "table-scroll preview-list" },
        el("table", { class: "grid" },
          el("thead", {}, el("tr", {}, el("th", {}, T("sites.colSite")), el("th", {}, T("rules.name")), el("th", {}, T("rules.domain")), el("th", {}, T("rules.path")), el("th", {}, T("ck.reason")))),
          el("tbody", {}, list.length ? list.map(x => el("tr", {},
            el("td", { class: "mono" }, x.site), el("td", { class: "mono" }, x.name, x.kind === "storage" ? el("span", { class: "badge c-consent", style: "margin-left:4px" }, T("sites.siteData")) : null), el("td", { class: "mono dim", title: x.domain }, x.domain.length > 60 ? x.domain.slice(0, 60) + "…" : x.domain),
            el("td", { class: "mono dim" }, x.path), el("td", { class: "reason dim" }, x.reason)))
            : el("tr", {}, el("td", { colspan: 5, class: "empty" }, T("sites.nothing")))))));
  }

  /* ================================================================== */
  /* Seiten-Editor                                                       */
  /* ================================================================== */

  async function renderSite(site) {
    const box = el("div");
    view.append(
      pageHead(el("span", {}, T("siteView.site"), el("code", {}, site)),
        el("a", { href: "https://" + site, target: "_blank", rel: "noopener", class: "btn" }, T("siteView.open")),
        confirmButton(T("siteView.remove"), T("siteView.removeConfirm"), async () => {
          delete cfg.sites[site]; await save(); toast(T("siteView.removed")); location.hash = "sites";
        }, "danger"),
        el("a", { href: "#sites", class: "btn" }, T("siteView.back"))),
      box);
    const ed = new UI.SiteEditor(box, { site, compact: false });
    ed.onPurged = () => { location.hash = "sites"; };
    currentEditor = ed;
    await ed.init();
  }

  /* ================================================================== */
  /* Globale Regeln                                                      */
  /* ================================================================== */

  async function renderRules() {
    const containers = await CC.getContainers();
    const all = await CC.getAllCookies();
    const wrap = el("div", { class: "card" });
    const draw = () => {
      wrap.textContent = "";
      wrap.append(
        el("p", { class: "hint", style: "margin:0 0 8px" },
          T("grules.hint"), T("grules.example"), el("code", {}, T("grules.exampleRule")), T("grules.exampleText")),
        UI.ruleTable(cfg.globalRules, {
          containers, cookies: all,
          onChange: () => save(),
          onStructure: () => { save(); draw(); }
        }));
    };
    draw();
    view.textContent = "";
    view.append(pageHead(T("grules.title")), wrap);
  }

  /* ================================================================== */
  /* Kategorien                                                          */
  /* ================================================================== */

  function renderCategories() {
    const g = cfg.settings;
    const grid = el("div", { class: "cat-grid" });
    const areas = {};
    for (const cat of ["consent", "auth", "tracking"]) {
      areas[cat] = el("textarea", { spellcheck: "false" });
      areas[cat].value = (cfg.categoryPatterns[cat] || []).join("\n");
      grid.append(el("div", { class: "card" },
        el("h3", {}, el("span", { class: "badge c-" + cat }, CC.CATEGORY_LABEL[cat]),
          el("span", { class: "spacer" }),
          "Globale Aktion: ",
          select([["keep", "Behalten"], ["delete", "Löschen"], ["block", "Blockieren"], ["none", "Keine"]], g.categories[cat],
            v => { g.categories[cat] = v; save(); toast("Gespeichert"); })),
        areas[cat],
        el("p", { class: "hint" }, "Ein Muster pro Zeile, Glob (", el("code", {}, "*"), ", ", el("code", {}, "?"), ") oder ", el("code", {}, "/regex/i"), ". Geprüft wird nur der Cookie-Name.")));
    }

    const testIn = el("input", { class: "mono", placeholder: "Cookie-Name testen, z. B. _ga_XYZ", style: "width:280px" });
    const testOut = el("span", { class: "dim" });
    testIn.addEventListener("input", () => {
      const tmp = Object.assign({}, cfg, { categoryPatterns: readAreas() });
      const r = CC.classify({ name: testIn.value }, tmp);
      testOut.textContent = testIn.value ? (r.category ? `→ ${CC.CATEGORY_LABEL[r.category]} (Muster ${r.pattern})` : "→ keine Kategorie") : "";
    });
    const readAreas = () => {
      const o = {};
      for (const k in areas) o[k] = areas[k].value.split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
      return o;
    };

    view.append(
      pageHead("Cookie-Kategorien",
        testIn, testOut,
        confirmButton("Muster zurücksetzen", "Standardmuster laden?", async () => {
          cfg.categoryPatterns = JSON.parse(JSON.stringify(CC.DEFAULT_PATTERNS)); await save(); render(); toast("Standardmuster geladen");
        }),
        el("button", {
          class: "btn primary", onclick: async () => {
            const p = readAreas();
            const bad = Object.values(p).flat().filter(x => /^\/.*\/[a-z]*$/.test(x) && CC.validateRegex(x));
            if (bad.length) { toast("Ungültiger RegExp: " + bad[0], "err"); return; }
            cfg.categoryPatterns = p; await save(); toast("Muster gespeichert");
          }
        }, "Muster speichern")),
      el("p", { class: "hint", style: "margin:0 0 10px" },
        "Prüfreihenfolge: Consent → Tracking → Login/Session. Die erste passende Kategorie zählt. ",
        "Seiten können die Aktion pro Kategorie übersteuern. Zeilen mit # sind Kommentare."),
      grid);
  }

  /* ================================================================== */
  /* Einstellungen                                                       */
  /* ================================================================== */

  function renderSettings() {
    const s = cfg.settings;
    const set = (k, v) => { s[k] = v; save(); toast("Gespeichert"); };
    const row = (label, ctrl, desc) => [el("label", {}, label), el("div", {}, ctrl, desc ? el("div", { class: "desc" }, desc) : null)];
    const check = (k) => el("input", { type: "checkbox", checked: s[k], onchange: e => set(k, e.target.checked) });
    const num = (k, min, max) => el("input", { type: "number", min, max, value: s[k], onchange: e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || 0))) });

    const suffix = el("textarea", { rows: 4, spellcheck: "false", placeholder: "z. B.\nmy-hosting.example\nco.ch" });
    suffix.value = s.extraSuffixes || "";
    suffix.addEventListener("change", () => set("extraSuffixes", suffix.value));

    const group = (title, intro, ...rows) => el("div", { class: "card" },
      el("h3", {}, title), intro ? el("p", { class: "hint", style: "margin:0 0 10px" }, intro) : null,
      el("div", { class: "form-grid" }, ...rows));

    view.append(
      pageHead("Einstellungen",
        el("span", { class: "hint", style: "margin:0" }, "Jede Änderung ist mit ↶ / ↷ oben rechts (oder Strg+Z / Strg+Y) rückgängig zu machen."),
        confirmButton("Verlauf leeren", "Verlauf wirklich leeren?", async () => { await browser.runtime.sendMessage({ cmd: "historyClear" }); toast("Verlauf geleert"); })),

      group("Bereinigung", "Wann bereinigt wird. Gilt für Cookies und Website-Daten gleichermassen.",
        row("Bereinigen bei Tab-Schliessen", check("cleanOnTabClose"),
          "Wenn der letzte Tab einer Seite geschlossen oder wegnavigiert wird. Pro Seite übersteuerbar."),
        row("Verzögerung (Sekunden)", num("tabCloseDelaySec", 0, 3600),
          "Wartezeit nach dem Schliessen. Wird die Seite in der Zeit wieder geöffnet, entfällt die Bereinigung."),
        row("Bereinigen beim Browserstart", check("cleanOnStartup"), "Läuft ca. 4 s nach dem Start über alle Seiten."),
        row("Intervall-Bereinigung (Minuten)", num("periodicMinutes", 0, 10080), "0 = aus. Bereinigt alle Seiten periodisch."),
        row("Seiten mit offenen Tabs auslassen", check("skipOpenSites"),
          "Gilt für Start, Intervall und „Alles bereinigen“. Verhindert, dass aktive Sitzungen unterbrochen werden.")),

      group("Cookies", el("span", {}, "Globale Vorgaben für Seiten ohne eigene Einstellung. Weitere Cookie-Einstellungen: ",
          el("a", { href: "#rules" }, "Cookie-Regeln"), " · ", el("a", { href: "#categories" }, "Cookie-Kategorien"), " · ", el("a", { href: "#archive" }, "Cookie-Archiv"), "."),
        row("Standard für übrige Cookies", select([["keep", "Behalten"], ["delete", "Löschen"]], s.defaultAction, v => set("defaultAction", v)),
          "Für Cookies ohne passende Cookie-Regel oder Kategorie. „Löschen“ = Whitelist-Betrieb: nur explizit Erlaubtes bleibt."),
        row("Blockieren sofort durchsetzen", check("enforceBlock"),
          "Cookies mit Aktion „Blockieren“ werden direkt nach dem Setzen gelöscht (cookies.onChanged).")),

      group("Website-Daten", "Globale Vorgaben für Seiten ohne eigene Einstellung. „Selektiv“ (nach Eintragsregeln) gibt es nur pro Seite.",
        ...CC.STORAGE_TYPES.map(t => row(CC.STORAGE_LABEL[t],
          select(CC.STORAGE_MODES[t].filter(m => m !== "selective").map(m => [m, CC.MODE_LABEL[m]]), (s.storage || {})[t] || "keep",
            v => { s.storage = Object.assign({}, s.storage, { [t]: v }); save(); toast("Gespeichert"); }),
          CC.STORAGE_HELP[t]))),

      group("Cookie-Archiv", null,
        row("Beim Browserstart zurücksetzen", check("restoreOnStartup"),
          "Archivierte Versionen mit ⟲ Autostart werden ca. 4 s nach dem Start gesetzt – nach der Start-Bereinigung."),
        row("Abgelaufene verlängern (Tage)", num("restoreExtendDays", 0, 3650),
          "Ist die archivierte Version abgelaufen, bekommt sie beim Zurückholen diese Laufzeit. 0 = als Sitzungscookie setzen."),
        row("Versionen pro Cookie", num("archiveMaxVersions", 1, 100),
          "Ältere Versionen werden beim Archivieren entfernt. Versionen mit Autostart bleiben immer erhalten.")),

      group("Anzeige & Protokoll", null,
        row("Badge am Symbol", select([["pending", "Anzahl Cookie-Löschkandidaten"], ["total", "Anzahl Cookies"], ["off", "Aus"]], s.badge, v => set("badge", v)),
          "Grün = nichts zu löschen, orange = Löschkandidaten vorhanden."),
        row("Protokoll aktiv", check("logEnabled")),
        row("Protokoll max. Einträge", num("logMax", 100, 100000))),

      group("Erweitert", null,
        row("Spaltenbreiten der Tabellen", el("button", { class: "btn", onclick: () => { CCTables.resetAll(); toast("Spaltenbreiten zurückgesetzt"); } }, "Alle zurücksetzen"),
          "Spalten lassen sich in jeder Tabelle am rechten Rand des Spaltenkopfs breiter oder schmaler ziehen; Doppelklick dort setzt eine Tabelle zurück."),
        row("Zusätzliche Public Suffixes", suffix,
          "Die Seitenzuordnung nutzt eine kompakte Suffix-Liste (kein vollständiger PSL). Eintragen, wenn Subdomains als eigene Seiten gelten sollen; „github.io“ ist bereits enthalten.")));
  }

  /* ================================================================== */
  /* Archiv                                                              */
  /* ================================================================== */

  let archTimer = null;
  async function renderArchive() {
    const [archive, all, containers] = await Promise.all([CC.loadArchive(), CC.getAllCookies(), CC.getContainers()]);
    const currentById = new Map(all.map(c => [CC.cookieId(c), c]));
    const f = state.archFilter.toLowerCase();
    const list = archive.filter(e => {
      const st = CC.archiveStatus(e, currentById);
      if (state.archMode === "auto" && !e.autoRestore) return false;
      if (state.archMode === "missing" && st !== "missing") return false;
      if (state.archMode === "differs" && st !== "differs") return false;
      if (!f) return true;
      return e.site.includes(f) || e.cookie.name.toLowerCase().includes(f) || (e.note || "").toLowerCase().includes(f) || e.cookie.value.toLowerCase().includes(f);
    });
    const sel = state.archSelected;
    for (const a of [...sel]) if (!archive.some(e => e.aid === a)) sel.delete(a);
    const auto = archive.filter(e => e.autoRestore).length;
    const redraw = () => renderArchive();
    const modes = [["all", "Alle"], ["auto", "⟲ Autostart"], ["missing", "Aktuell fehlend"], ["differs", "Abweichend"]];
    const keepFocus = document.activeElement && document.activeElement.id === "arch-filter";

    view.textContent = "";
    view.append(
      pageHead("Cookie-Archiv",
        el("span", { class: "dim" }, `${archive.length} Versionen von ${new Set(archive.map(e => e.key)).size} Cookies · ${auto} mit Autostart`),
        el("button", {
          class: "btn", disabled: !auto, title: "Alle Autostart-Einträge jetzt anwenden (wie beim Browserstart)",
          onclick: async () => { const r = await browser.runtime.sendMessage({ cmd: "restoreAutostart" }); toast(`${r.ok.length} zurückgesetzt` + (r.failed.length ? `, ${r.failed.length} fehlgeschlagen` : ""), r.failed.length ? "err" : ""); }
        }, "Autostart jetzt ausführen"),
        el("button", { class: "btn", onclick: () => download(`cookie-curator-archiv-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), archive }, null, 2)) }, "Archiv exportieren")),
      el("div", { class: "card" },
        el("div", { class: "toolbar" },
          el("input", { id: "arch-filter", type: "search", placeholder: "Filter: Seite, Name, Wert, Notiz …", value: state.archFilter,
            oninput: e => { state.archFilter = e.target.value; clearTimeout(archTimer); archTimer = setTimeout(redraw, 200); } }),
          el("div", { class: "chips" }, modes.map(([v, l]) => el("button", { class: "chip" + (state.archMode === v ? " on" : ""), onclick: () => { state.archMode = v; redraw(); } }, l)))),
        UI.archiveBulkBar(sel, redraw),
        UI.archiveTable(list, { currentById, containers, showSite: true, selected: sel, onSelect: redraw }),
        el("p", { class: "hint" },
          "Archivieren geht im Popup oder im Seiten-Editor: Cookies auswählen → Archivieren, oder in der Detailansicht eines Cookies. ",
          "⟲ Autostart: Diese Version wird bei jedem Browserstart gesetzt (überschreibt den aktuellen Wert). ",
          "Ablauf: abgelaufene Versionen werden beim Zurückholen um die eingestellte Anzahl Tage verlängert.")));
    if (keepFocus) { const i = document.getElementById("arch-filter"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
  }

  /* ================================================================== */
  /* Protokoll                                                           */
  /* ================================================================== */

  async function renderLog() {
    const log = (await browser.runtime.sendMessage({ cmd: "getLog" })) || [];
    const containers = await CC.getContainers();
    const f = state.logFilter.toLowerCase();
    const rows = log.slice().reverse().filter(e =>
      (state.logTrigger === "all" || e.trigger === state.logTrigger) &&
      (!f || e.site.includes(f) || e.name.toLowerCase().includes(f) || (e.reason || "").toLowerCase().includes(f)));
    const trig = { "tab-close": "Tab zu", startup: "Start", interval: "Intervall", manual: "Manuell", block: "Block", restore: "Zurückgeholt", "startup-restore": "Start-Reset", "page-load": "Seitenaufruf" };

    const toCsv = () => {
      const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const lines = [["Zeit", "Trigger", "Seite", "Name", "Domain", "Pfad", "Container", "Partitioniert", "Begründung"].map(esc).join(";")];
      for (const e of rows) lines.push([new Date(e.t).toISOString(), e.trigger, e.site, e.name, e.domain, e.path, e.storeId, e.partitioned, e.reason].map(esc).join(";"));
      download("cookie-curator-log.csv", "﻿" + lines.join("\r\n"), "text/csv");
    };

    view.textContent = "";
    view.append(
      pageHead("Protokoll", el("span", { class: "dim" }, `${log.length} Einträge`),
        el("button", { class: "btn", onclick: toCsv }, "CSV exportieren"),
        confirmButton("Leeren", "Wirklich leeren?", async () => { await browser.runtime.sendMessage({ cmd: "clearLog" }); render(); }, "danger")),
      el("div", { class: "card" },
        el("div", { class: "toolbar" },
          el("input", { type: "search", placeholder: "Filter …", value: state.logFilter, onchange: e => { state.logFilter = e.target.value; render(); } }),
          el("div", { class: "chips" }, [["all", "Alle"], ...Object.entries(trig)].map(([v, l]) =>
            el("button", { class: "chip" + (state.logTrigger === v ? " on" : ""), onclick: () => { state.logTrigger = v; render(); } }, l)))),
        el("div", { class: "table-scroll cookies-scroll" },
          el("table", { class: "grid" },
            el("thead", {}, el("tr", {}, ["Zeit", "Trigger", "Seite", "Name", "Domain", "Pfad", "Container", "Begründung"].map(h => el("th", {}, h)))),
            el("tbody", {}, rows.length ? rows.slice(0, 2000).map(e => el("tr", {},
              el("td", { class: "num" }, new Date(e.t).toLocaleString("de-CH")),
              el("td", {}, trig[e.trigger] || e.trigger),
              el("td", { class: "mono" }, el("a", { href: "#site/" + encodeURIComponent(e.site) }, e.site)),
              el("td", { class: "mono" }, e.name, e.partitioned ? el("span", { class: "badge c-3p" }, "Part") : null, e.kind === "storage" ? el("span", { class: "badge c-consent", style: "margin-left:4px" }, T("sites.siteData")) : null),
              el("td", { class: "mono dim" }, e.domain),
              el("td", { class: "mono dim" }, e.path),
              el("td", { class: "dim" }, containers[e.storeId] || e.storeId),
              el("td", { class: "reason dim", title: e.reason }, e.reason)))
              : el("tr", {}, el("td", { colspan: 8, class: "empty" }, "Keine Einträge.")))))));
  }

  /* ================================================================== */
  /* Import / Export                                                     */
  /* ================================================================== */

  function download(name, text, type) {
    const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: type || "application/json" })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function renderBackup() {
    const file = el("input", { type: "file", accept: ".json,application/json" });
    const status = el("div", { class: "hint" });
    let imported = null, importedArchive = [];
    file.addEventListener("change", async () => {
      imported = null; importedArchive = [];
      try {
        const data = JSON.parse(await file.files[0].text());
        importedArchive = Array.isArray(data.archive) ? data.archive : [];
        if (data.config || data.settings || data.sites) imported = CC.normalizeConfig(data.config || data);
        status.textContent = `Gelesen: ${imported ? Object.keys(imported.sites).length + " Seiten, " + imported.globalRules.length + " globale Regeln" : "keine Konfiguration"}, ${importedArchive.length} Archiv-Einträge.`;
      } catch (e) { status.textContent = "Fehler: " + e.message; }
    });
    const importArchive = async () => {
      if (!importedArchive.length) return 0;
      return browser.runtime.sendMessage({ cmd: "archiveImport", entries: importedArchive });
    };

    view.append(
      pageHead("Import / Export"),
      el("div", { class: "card" },
        el("h3", {}, "Export"),
        el("p", { class: "hint" }, "Komplette Konfiguration (Einstellungen, Kategorien, globale Regeln, Seiten) und Cookie-Archiv als JSON. Achtung: das Archiv enthält Cookie-Werte, also u. U. Login-Sitzungen – Datei entsprechend schützen."),
        el("div", { class: "row-actions" },
          el("button", { class: "btn primary", onclick: async () => download(`cookie-curator-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), config: cfg, archive: await CC.loadArchive() }, null, 2)) }, "JSON herunterladen (inkl. Archiv)"),
          el("button", { class: "btn", onclick: async () => { const c = await CC.getAllCookies(); download("cookies-snapshot.json", JSON.stringify(c, null, 2)); } }, "Alle Cookies als JSON (Snapshot)"))),
      el("div", { class: "card" },
        el("h3", {}, "Import"),
        file, status,
        el("div", { class: "row-actions" },
          el("button", {
            class: "btn", onclick: async () => {
              if (!imported && !importedArchive.length) return toast("Zuerst Datei wählen", "err");
              if (imported) {
                for (const [k, v] of Object.entries(imported.sites)) cfg.sites[k] = v;
                const ids = new Set(cfg.globalRules.map(r => r.id));
                for (const r of imported.globalRules) if (!ids.has(r.id)) cfg.globalRules.push(r);
                await save();
              }
              const n = await importArchive();
              toast(`Zusammengeführt (Seiten überschrieben, Regeln ergänzt, ${n} Archiv-Einträge ergänzt)`);
            }
          }, "Zusammenführen"),
          confirmButton("Ersetzen", "Alles ersetzen?", async () => {
            if (!imported) return toast("Datei enthält keine Konfiguration", "err");
            cfg = imported; await save();
            if (importedArchive.length) { await CC.saveArchive([]); await importArchive(); }
            toast("Konfiguration ersetzt" + (importedArchive.length ? " (Archiv ebenfalls ersetzt)" : ""));
          }, "danger"))),
      el("div", { class: "card" },
        el("h3", {}, "Zurücksetzen"),
        el("p", { class: "hint" }, "Setzt alle Einstellungen, Regeln und Seiten auf Werkszustand. Cookies und Archiv bleiben unberührt."),
        el("div", { class: "row-actions" },
          confirmButton("Auf Standard zurücksetzen", "Wirklich alles zurücksetzen?", async () => {
            cfg = CC.defaultConfig(); await save(); toast("Zurückgesetzt");
          }, "danger"))));
  }

  /* ================================================================== */
  /* Hilfe                                                               */
  /* ================================================================== */

  function renderHelp() {
    view.append(pageHead("Funktionsweise"), buildHelp());
  }

  document.getElementById("history-slot").append(UI.historyButtons());
  CCTables.observe(document.getElementById("view"));

  // Höhe der klebenden Navigationsleiste für die klebenden Tabellenköpfe
  const header = document.querySelector("header.top");
  const setHdr = () => document.documentElement.style.setProperty("--hdr", header.offsetHeight + "px");
  setHdr();
  if (window.ResizeObserver) new ResizeObserver(setHdr).observe(header); else window.addEventListener("resize", setHdr);
  I18N.init().then(() => {
    I18N.apply();
    I18N.onChange(() => location.reload());
    document.getElementById("lang-slot").append(UI.languageButton());
    return load();
  }).then(render);
})();
