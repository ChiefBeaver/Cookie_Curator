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
          T("cat.globalAction"),
          select(["keep", "delete", "block", "none"].map(a => [a, CC.ACTION_LABEL[a]]), g.categories[cat],
            v => { g.categories[cat] = v; save(); toast(T("cat.saved")); })),
        areas[cat],
        el("p", { class: "hint" }, T("cat.hint1"), el("code", {}, "*"), ", ", el("code", {}, "?"), T("cat.hint2"), el("code", {}, "/regex/i"), T("cat.hint3"))));
    }

    const testIn = el("input", { class: "mono", placeholder: T("cat.testPlaceholder"), style: "width:280px" });
    const testOut = el("span", { class: "dim" });
    testIn.addEventListener("input", () => {
      const tmp = Object.assign({}, cfg, { categoryPatterns: readAreas() });
      const r = CC.classify({ name: testIn.value }, tmp);
      testOut.textContent = testIn.value ? (r.category ? T("cat.testResult", { category: CC.CATEGORY_LABEL[r.category], pattern: r.pattern }) : T("cat.testNone")) : "";
    });
    const readAreas = () => {
      const o = {};
      for (const k in areas) o[k] = areas[k].value.split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("#"));
      return o;
    };

    view.append(
      pageHead(T("cat.title"),
        testIn, testOut,
        confirmButton(T("cat.reset"), T("cat.resetConfirm"), async () => {
          cfg.categoryPatterns = JSON.parse(JSON.stringify(CC.DEFAULT_PATTERNS)); await save(); render(); toast(T("cat.resetDone"));
        }),
        el("button", {
          class: "btn primary", onclick: async () => {
            const p = readAreas();
            const bad = Object.values(p).flat().filter(x => /^\/.*\/[a-z]*$/.test(x) && CC.validateRegex(x));
            if (bad.length) { toast(T("cat.invalid", { pattern: bad[0] }), "err"); return; }
            cfg.categoryPatterns = p; await save(); toast(T("cat.savedPatterns"));
          }
        }, T("cat.save"))),
      el("p", { class: "hint", style: "margin:0 0 10px" },
        T("cat.order")),
      grid);
  }

  /* ================================================================== */
  /* Einstellungen                                                       */
  /* ================================================================== */

  function renderSettings() {
    const s = cfg.settings;
    const set = (k, v) => { s[k] = v; save(); toast(T("cat.saved")); };
    const row = (label, ctrl, desc) => [el("label", {}, label), el("div", {}, ctrl, desc ? el("div", { class: "desc" }, desc) : null)];
    const check = (k) => el("input", { type: "checkbox", checked: s[k], onchange: e => set(k, e.target.checked) });
    const num = (k, min, max) => el("input", { type: "number", min, max, value: s[k], onchange: e => set(k, Math.max(min, Math.min(max, Number(e.target.value) || 0))) });

    const suffix = el("textarea", { rows: 4, spellcheck: "false", placeholder: T("set.suffixPlaceholder") });
    suffix.value = s.extraSuffixes || "";
    suffix.addEventListener("change", () => set("extraSuffixes", suffix.value));

    const group = (title, intro, ...rows) => el("div", { class: "card" },
      el("h3", {}, title), intro ? el("p", { class: "hint", style: "margin:0 0 10px" }, intro) : null,
      el("div", { class: "form-grid" }, ...rows));

    view.append(
      pageHead(T("set.title"),
        el("span", { class: "hint", style: "margin:0" }, T("set.undoHint")),
        confirmButton(T("set.clearHistory"), T("set.clearHistoryConfirm"), async () => { await browser.runtime.sendMessage({ cmd: "historyClear" }); toast(T("set.historyCleared")); })),

      group(T("set.cleanup"), T("set.cleanupIntro"),
        row(T("set.tabClose"), check("cleanOnTabClose"), T("set.tabCloseDesc")),
        row(T("set.delay"), num("tabCloseDelaySec", 0, 3600), T("set.delayDesc")),
        row(T("set.startup"), check("cleanOnStartup"), T("set.startupDesc")),
        row(T("set.interval"), num("periodicMinutes", 0, 10080), T("set.intervalDesc")),
        row(T("set.skipOpen"), check("skipOpenSites"), T("set.skipOpenDesc"))),

      group(T("set.cookies"), el("span", {}, T("set.cookiesIntro"),
          el("a", { href: "#rules" }, T("nav.rules")), " · ", el("a", { href: "#categories" }, T("nav.categories")), " · ", el("a", { href: "#archive" }, T("nav.archive")), "."),
        row(T("set.default"), select([["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete]], s.defaultAction, v => set("defaultAction", v)), T("set.defaultDesc")),
        row(T("set.enforce"), check("enforceBlock"), T("set.enforceDesc"))),

      group(T("set.data"), T("set.dataIntro"),
        ...CC.STORAGE_TYPES.map(t => row(CC.STORAGE_LABEL[t],
          select(CC.STORAGE_MODES[t].filter(m => m !== "selective").map(m => [m, CC.MODE_LABEL[m]]), (s.storage || {})[t] || "keep",
            v => { s.storage = Object.assign({}, s.storage, { [t]: v }); save(); toast(T("cat.saved")); }),
          CC.STORAGE_HELP[t]))),

      group(T("set.archive"), null,
        row(T("set.restore"), check("restoreOnStartup"), T("set.restoreDesc")),
        row(T("set.extend"), num("restoreExtendDays", 0, 3650), T("set.extendDesc")),
        row(T("set.versions"), num("archiveMaxVersions", 1, 100), T("set.versionsDesc"))),

      group(T("set.display"), null,
        row(T("set.badge"), select([["pending", T("set.badgePending")], ["total", T("set.badgeTotal")], ["off", T("set.badgeOff")]], s.badge, v => set("badge", v)), T("set.badgeDesc")),
        row(T("set.logEnabled"), check("logEnabled")),
        row(T("set.logMax"), num("logMax", 100, 100000))),

      group(T("set.advanced"), null,
        row(T("set.columns"), el("button", { class: "btn", onclick: () => { CCTables.resetAll(); toast(T("set.columnsReset")); } }, T("set.resetAll")), T("set.columnsDesc")),
        row(T("set.suffixes"), suffix, T("set.suffixesDesc"))));
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
    const modes = [["all", T("arch.modeAll")], ["auto", T("arch.modeAuto")], ["missing", T("arch.modeMissing")], ["differs", T("arch.modeDiffers")]];
    const keepFocus = document.activeElement && document.activeElement.id === "arch-filter";

    view.textContent = "";
    view.append(
      pageHead(T("arch.title"),
        el("span", { class: "dim" }, T("arch.summary", { versions: archive.length, cookies: new Set(archive.map(e => e.key)).size, auto })),
        el("button", {
          class: "btn", disabled: !auto, title: T("arch.runTitle"),
          onclick: async () => { const r = await browser.runtime.sendMessage({ cmd: "restoreAutostart" }); toast(T("arch.restored", { n: r.ok.length }) + (r.failed.length ? T("arch.failed", { n: r.failed.length }) : ""), r.failed.length ? "err" : ""); }
        }, T("arch.run")),
        el("button", { class: "btn", onclick: () => download(`${T("arch.fileName")}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), archive }, null, 2)) }, T("arch.export"))),
      el("div", { class: "card" },
        el("div", { class: "toolbar" },
          el("input", { id: "arch-filter", type: "search", placeholder: T("arch.filter"), value: state.archFilter,
            oninput: e => { state.archFilter = e.target.value; clearTimeout(archTimer); archTimer = setTimeout(redraw, 200); } }),
          el("div", { class: "chips" }, modes.map(([v, l]) => el("button", { class: "chip" + (state.archMode === v ? " on" : ""), onclick: () => { state.archMode = v; redraw(); } }, l)))),
        UI.archiveBulkBar(sel, redraw),
        UI.archiveTable(list, { currentById, containers, showSite: true, selected: sel, onSelect: redraw }),
        el("p", { class: "hint" }, T("arch.hint"))));
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
    const trig = { "tab-close": T("log.tabClose"), startup: T("log.startup"), interval: T("log.interval"), manual: T("log.manual"), block: T("log.block"), restore: T("log.restore"), "startup-restore": T("log.startupRestore"), "page-load": T("log.pageLoad") };

    const toCsv = () => {
      const esc = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
      const lines = [[T("log.time"), T("log.trigger"), T("sites.colSite"), T("rules.name"), T("rules.domain"), T("rules.path"), T("rules.container"), T("log.partitioned"), T("ck.reason")].map(esc).join(";")];
      for (const e of rows) lines.push([new Date(e.t).toISOString(), e.trigger, e.site, e.name, e.domain, e.path, e.storeId, e.partitioned, e.reason].map(esc).join(";"));
      download("cookie-curator-log.csv", "﻿" + lines.join("\r\n"), "text/csv");
    };

    view.textContent = "";
    view.append(
      pageHead(T("log.title"), el("span", { class: "dim" }, T("log.count", { n: log.length })),
        el("button", { class: "btn", onclick: toCsv }, T("log.csv")),
        confirmButton(T("log.clear"), T("log.clearConfirm"), async () => { await browser.runtime.sendMessage({ cmd: "clearLog" }); render(); }, "danger")),
      el("div", { class: "card" },
        el("div", { class: "toolbar" },
          el("input", { type: "search", placeholder: T("log.filter"), value: state.logFilter, onchange: e => { state.logFilter = e.target.value; render(); } }),
          el("div", { class: "chips" }, [["all", T("sites.modeAll")], ...Object.entries(trig)].map(([v, l]) =>
            el("button", { class: "chip" + (state.logTrigger === v ? " on" : ""), onclick: () => { state.logTrigger = v; render(); } }, l)))),
        el("div", { class: "table-scroll cookies-scroll" },
          el("table", { class: "grid" },
            el("thead", {}, el("tr", {}, [T("log.time"), T("log.trigger"), T("sites.colSite"), T("rules.name"), T("rules.domain"), T("rules.path"), T("rules.container"), T("ck.reason")].map(h => el("th", {}, h)))),
            el("tbody", {}, rows.length ? rows.slice(0, 2000).map(e => el("tr", {},
              el("td", { class: "num" }, new Date(e.t).toLocaleString(T("fmt.locale"))),
              el("td", {}, trig[e.trigger] || e.trigger),
              el("td", { class: "mono" }, el("a", { href: "#site/" + encodeURIComponent(e.site) }, e.site)),
              el("td", { class: "mono" }, e.name, e.partitioned ? el("span", { class: "badge c-3p" }, "Part") : null, e.kind === "storage" ? el("span", { class: "badge c-consent", style: "margin-left:4px" }, T("sites.siteData")) : null),
              el("td", { class: "mono dim" }, e.domain),
              el("td", { class: "mono dim" }, e.path),
              el("td", { class: "dim" }, containers[e.storeId] || e.storeId),
              el("td", { class: "reason dim", title: e.reason }, e.reason)))
              : el("tr", {}, el("td", { colspan: 8, class: "empty" }, T("log.none"))))))));
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
        status.textContent = T("bk.read", { what: imported ? T("bk.readConfig", { sites: Object.keys(imported.sites).length, rules: imported.globalRules.length }) : T("bk.noConfig"), n: importedArchive.length });
      } catch (e) { status.textContent = T("bk.error", { msg: e.message }); }
    });
    const importArchive = async () => {
      if (!importedArchive.length) return 0;
      return browser.runtime.sendMessage({ cmd: "archiveImport", entries: importedArchive });
    };

    view.append(
      pageHead(T("bk.title")),
      el("div", { class: "card" },
        el("h3", {}, T("bk.export")),
        el("p", { class: "hint" }, T("bk.exportHint")),
        el("div", { class: "row-actions" },
          el("button", { class: "btn primary", onclick: async () => download(`cookie-curator-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), config: cfg, archive: await CC.loadArchive() }, null, 2)) }, T("bk.download")),
          el("button", { class: "btn", onclick: async () => { const c = await CC.getAllCookies(); download("cookies-snapshot.json", JSON.stringify(c, null, 2)); } }, T("bk.snapshot")))),
      el("div", { class: "card" },
        el("h3", {}, T("bk.import")),
        file, status,
        el("div", { class: "row-actions" },
          el("button", {
            class: "btn", onclick: async () => {
              if (!imported && !importedArchive.length) return toast(T("bk.chooseFirst"), "err");
              if (imported) {
                for (const [k, v] of Object.entries(imported.sites)) cfg.sites[k] = v;
                const ids = new Set(cfg.globalRules.map(r => r.id));
                for (const r of imported.globalRules) if (!ids.has(r.id)) cfg.globalRules.push(r);
                await save();
              }
              const n = await importArchive();
              toast(T("bk.merged", { n }));
            }
          }, T("bk.merge")),
          confirmButton(T("bk.replace"), T("bk.replaceConfirm"), async () => {
            if (!imported) return toast(T("bk.noConfigInFile"), "err");
            cfg = imported; await save();
            if (importedArchive.length) { await CC.saveArchive([]); await importArchive(); }
            toast(T("bk.replaced") + (importedArchive.length ? T("bk.replacedArchive") : ""));
          }, "danger"))),
      el("div", { class: "card" },
        el("h3", {}, T("bk.reset")),
        el("p", { class: "hint" }, T("bk.resetHint")),
        el("div", { class: "row-actions" },
          confirmButton(T("bk.resetButton"), T("bk.resetConfirm"), async () => {
            cfg = CC.defaultConfig(); await save(); toast(T("bk.resetDone"));
          }, "danger"))));
  }

  /* ================================================================== */
  /* Hilfe                                                               */
  /* ================================================================== */

  function renderHelp() {
    view.append(pageHead(T("help.title")), buildHelp());
  }

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
    document.getElementById("history-slot").append(UI.historyButtons());
    return load();
  }).then(render);
})();
