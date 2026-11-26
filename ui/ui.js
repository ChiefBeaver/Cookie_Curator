/* Cookie Curator – gemeinsame UI-Bausteine (Popup + Dashboard)
 * Kein innerHTML mit Fremddaten: alle Cookie-Werte werden als Text eingefügt.
 */
(function (root) {
  "use strict";
  const T = I18N.t;

  /* ------------------------------------------------------------------ */
  /* DOM-Helfer                                                          */
  /* ------------------------------------------------------------------ */

  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (k === "style") e.style.cssText = v;
      else if (k === "checked" || k === "disabled" || k === "selected") e[k] = !!v;
      else if (k === "value") e.value = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || kid === false) continue;
      e.append(kid instanceof Node ? kid : String(kid));
    }
    return e;
  }

  function select(options, value, onchange, attrs) {
    const s = el("select", Object.assign({ onchange: e => onchange(e.target.value) }, attrs || {}),
      options.map(o => Array.isArray(o) ? el("option", { value: o[0], disabled: o[2] }, o[1]) : el("option", { value: o }, o)));
    s.value = value;
    return s;
  }

  /* Zwei-Klick-Bestätigung (Popups können keine confirm()-Dialoge) */
  /* id (optional): Bestätigungszustand überlebt ein Neuzeichnen der Oberfläche
   * (z. B. wenn sich zwischen den zwei Klicks ein Cookie ändert). */
  const armedUntil = new Map();
  const ARM_MS = 4000;
  function confirmButton(label, armedLabel, action, cls, id) {
    let armed = false, timer = null;
    const b = el("button", { class: "btn " + (cls || ""), type: "button" }, label);
    const disarm = () => { armed = false; b.textContent = label; b.classList.remove("armed"); if (id) armedUntil.delete(id); };
    const arm = (ms) => {
      armed = true; b.textContent = armedLabel; b.classList.add("armed");
      clearTimeout(timer); timer = setTimeout(disarm, ms);
    };
    if (id && armedUntil.get(id) > Date.now()) arm(armedUntil.get(id) - Date.now());
    b.addEventListener("click", async () => {
      if (!armed) {
        if (id) armedUntil.set(id, Date.now() + ARM_MS);
        arm(ARM_MS);
        return;
      }
      clearTimeout(timer); disarm();
      b.disabled = true;
      try { await action(); }
      catch (e) { console.error("[Cookie Curator]", e); toast(T("ui.error", { msg: e && e.message || e }), "err", 8000); }
      finally { b.disabled = false; }
    });
    return b;
  }

  /* Rückmeldung nach dem Löschen einer ganzen Speicherart */
  function deletedText(type, hosts) {
    if (type === "cacheStorage") return T("ui.cacheDeleted");
    return T("ui.typeDeleted", { label: CC.STORAGE_LABEL[type], n: hosts.length });
  }

  let toastTimer = null;
  function toast(msg, kind, ms) {
    let t = document.getElementById("cc-toast");
    if (!t) { t = el("div", { id: "cc-toast" }); document.body.append(t); }
    t.textContent = msg;
    t.className = "show " + (kind || "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = ""; }, ms || 2800);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast(T("ui.copied")); }
    catch (e) { toast(T("ui.copyFailed"), "err"); }
  }

  function actionPill(action, title) {
    return el("span", { class: "pill a-" + action, title: title || "" }, CC.ACTION_LABEL[action] || action);
  }

  function catBadge(cat, pattern) {
    if (!cat) return null;
    return el("span", { class: "badge c-" + cat, title: T("ui.detectedBy", { pattern }) }, CC.CATEGORY_LABEL[cat]);
  }

  function flagTags(c) {
    const ss = { lax: ["L", "SameSite=Lax"], strict: ["S", "SameSite=Strict"], no_restriction: ["N", "SameSite=None"] }[c.sameSite];
    return el("span", { class: "flags" },
      c.secure ? el("i", { title: "Secure" }, "Sec") : null,
      c.httpOnly ? el("i", { title: T("flag.httpOnly") }, "HO") : null,
      ss ? el("i", { title: ss[1] }, "SS:" + ss[0]) : null,
      c.hostOnly ? el("i", { title: T("flag.hostOnly") }, "Host") : null,
      c.partitionKey ? el("i", { class: "warn", title: T("flag.partitioned", { site: c.partitionKey.topLevelSite || "?" }) }, "Part") : null,
      c.firstPartyDomain ? el("i", { title: T("flag.fpi", { domain: c.firstPartyDomain }) }, "FPI") : null
    );
  }

  /* ------------------------------------------------------------------ */
  /* Regel-Tabelle (Seiten- und globale Regeln)                          */
  /* ------------------------------------------------------------------ */

  function ruleTable(rules, opts) {
    const { onChange, onStructure, containers = {}, cookies = null } = opts;
    const wrap = el("div", { class: "rules" });

    const head = el("tr", {},
      el("th", { title: T("rules.priority") }, "#"),
      el("th", { title: T("rules.enabledTitle") }, T("rules.enabled")),
      el("th", {}, T("rules.type")),
      el("th", {}, T("rules.name")),
      el("th", { title: T("rules.domainTitle") }, T("rules.domain")),
      el("th", { title: T("rules.pathTitle") }, T("rules.path")),
      el("th", {}, T("rules.container")),
      el("th", {}, T("rules.action")),
      el("th", {}, T("rules.note")),
      cookies ? el("th", { title: T("rules.hitsTitle") }, T("rules.hits")) : null,
      el("th", {}, ""));

    const body = el("tbody");
    rules.forEach((r, i) => {
      const nameInput = el("input", {
        class: "mono", value: r.name, spellcheck: "false", placeholder: r.match === "regex" ? "/^_ga/i" : "*",
        onchange: e => { r.name = e.target.value.trim(); validate(); onChange(); }
      });
      const validate = () => {
        const err = r.match === "regex" ? CC.validateRegex(r.name) : null;
        nameInput.classList.toggle("invalid", !!err);
        nameInput.title = err ? T("rules.invalidRegex", { err }) : "";
      };
      validate();
      const storeOpts = [["", T("rules.allContainers")]].concat(Object.entries(containers));
      if (r.store && !containers[r.store]) storeOpts.push([r.store, r.store]);
      let hits = null;
      if (cookies) {
        const n = cookies.filter(c => CC.ruleMatches(r, c)).length;
        hits = el("td", { class: "num " + (n ? "" : "muted") }, String(n));
      }
      body.append(el("tr", { class: r.enabled ? "" : "disabled" },
        el("td", { class: "order" },
          el("button", { class: "icon", title: T("rules.up"), disabled: i === 0, onclick: () => { rules.splice(i - 1, 0, rules.splice(i, 1)[0]); onStructure(); } }, "▲"),
          el("button", { class: "icon", title: T("rules.down"), disabled: i === rules.length - 1, onclick: () => { rules.splice(i + 1, 0, rules.splice(i, 1)[0]); onStructure(); } }, "▼")),
        el("td", {}, el("input", { type: "checkbox", checked: r.enabled, onchange: e => { r.enabled = e.target.checked; onStructure(); } })),
        el("td", {}, select([["exact", T("rules.exact")], ["glob", "glob"], ["regex", "regex"]], r.match, v => { r.match = v; validate(); onChange(); })),
        el("td", {}, nameInput),
        el("td", {}, el("input", { class: "mono", value: r.domain, placeholder: "*", spellcheck: "false", onchange: e => { r.domain = e.target.value.trim().replace(/^\./, ""); onChange(); } })),
        el("td", {}, el("input", { class: "mono short", value: r.path, placeholder: "*", spellcheck: "false", onchange: e => { r.path = e.target.value.trim(); onChange(); } })),
        el("td", {}, select(storeOpts, r.store || "", v => { r.store = v; onChange(); })),
        el("td", {}, select(CC.ACTIONS.map(a => [a, CC.ACTION_LABEL[a]]), r.action, v => { r.action = v; onChange(); }, { class: "act-" + r.action })),
        el("td", {}, el("input", { value: r.note || "", placeholder: r.quick ? T("rules.quick") : "", onchange: e => { r.note = e.target.value; onChange(); } })),
        hits,
        el("td", {}, el("button", { class: "icon danger", title: T("rules.delete"), onclick: () => { rules.splice(i, 1); onStructure(); } }, "✕"))
      ));
    });

    if (!rules.length) {
      body.append(el("tr", {}, el("td", { colspan: cookies ? 11 : 10, class: "empty" }, T("rules.empty"))));
    }

    wrap.append(
      el("div", { class: "table-scroll" }, el("table", { class: "grid" }, el("thead", {}, head), body)),
      el("div", { class: "row-actions" },
        el("button", { class: "btn", onclick: () => { rules.push(CC.newRule({ name: "", match: "exact" })); onStructure(); } }, opts.addLabel || T("rules.add")),
        el("span", { class: "hint" }, T("rules.hint")))
    );
    return wrap;
  }

  /* Eintragsregeln (localStorage/sessionStorage) – gleicher Aufbau wie die Cookie-Regeln */
  function entryRuleTable(rules, opts) {
    const { onChange, onStructure, live = null } = opts;
    const head = el("tr", {},
      el("th", { title: T("rules.priority") }, "#"),
      el("th", { title: T("rules.enabledTitle") }, T("rules.enabled")),
      el("th", {}, T("rules.type")),
      el("th", {}, T("rules.name")),
      el("th", { title: T("entryRules.storeTitle") }, T("entryRules.store")),
      el("th", {}, T("rules.action")),
      el("th", {}, T("rules.note")),
      el("th", { title: T("entryRules.hitsTitle") }, T("rules.hits")),
      el("th", {}, ""));
    const body = el("tbody");
    rules.forEach((r, i) => {
      const nameInput = el("input", {
        class: "mono", value: r.name, spellcheck: "false", placeholder: r.match === "regex" ? "/^_ga/i" : "*",
        onchange: e => { r.name = e.target.value.trim(); validate(); onChange(); }
      });
      const validate = () => {
        const err = r.match === "regex" ? CC.validateRegex(r.name) : null;
        nameInput.classList.toggle("invalid", !!err);
        nameInput.title = err ? T("rules.invalidRegex", { err }) : "";
      };
      validate();
      let hits = "—";
      if (live) {
        let n = 0;
        for (const store of ["local", "session"]) for (const it of live[store] || []) if (CC.keyRuleMatches(r, store, it.k)) n++;
        hits = String(n);
      }
      body.append(el("tr", { class: r.enabled ? "" : "disabled" },
        el("td", { class: "order" },
          el("button", { class: "icon", title: T("rules.up"), disabled: i === 0, onclick: () => { rules.splice(i - 1, 0, rules.splice(i, 1)[0]); onStructure(); } }, "▲"),
          el("button", { class: "icon", title: T("rules.down"), disabled: i === rules.length - 1, onclick: () => { rules.splice(i + 1, 0, rules.splice(i, 1)[0]); onStructure(); } }, "▼")),
        el("td", {}, el("input", { type: "checkbox", checked: r.enabled, onchange: e => { r.enabled = e.target.checked; onStructure(); } })),
        el("td", {}, select([["exact", T("rules.exact")], ["glob", "glob"], ["regex", "regex"]], r.match, v => { r.match = v; validate(); onChange(); })),
        el("td", {}, nameInput),
        el("td", {}, select([["both", T("entryRules.both")], ["local", "localStorage"], ["session", "sessionStorage"]], r.store, v => { r.store = v; onChange(); })),
        el("td", {}, select([["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete]], r.action, v => { r.action = v; onChange(); }, { class: "act-" + r.action })),
        el("td", {}, el("input", { value: r.note || "", placeholder: r.quick ? T("rules.quick") : "", onchange: e => { r.note = e.target.value; onChange(true); } })),
        el("td", { class: "num " + (hits === "0" || hits === "—" ? "muted" : "") }, hits),
        el("td", {}, el("button", { class: "icon danger", title: T("rules.delete"), onclick: () => { rules.splice(i, 1); onStructure(); } }, "✕"))));
    });
    if (!rules.length) body.append(el("tr", {}, el("td", { colspan: 9, class: "empty" }, T("entryRules.empty"))));
    return el("div", { class: "rules" },
      el("div", { class: "table-scroll" }, el("table", { class: "grid" }, el("thead", {}, head), body)),
      el("div", { class: "row-actions" },
        el("button", { class: "btn", onclick: () => { rules.push(CC.newKeyRule({ name: "", match: "exact" })); onStructure(); } }, T("entryRules.add")),
        el("span", { class: "hint" }, T("entryRules.hint"))));
  }

  function field(label, ctrl, help) {
    return el("label", { class: "field", title: help || "" }, el("span", {}, label), ctrl);
  }

  /* ------------------------------------------------------------------ */
  /* Rückgängig / Wiederholen                                            */
  /* ------------------------------------------------------------------ */

  /* Sprachknopf: wechselt reihum zur nächsten Sprache aus I18N.LANGUAGES.
   * Die Seiten laden sich danach neu (I18N.onChange in popup.js / options.js). */
  function languageButton() {
    const cur = I18N.getLang(), nxt = I18N.next();
    const name = code => I18N.LANGUAGES[code] || code;
    return el("button", {
      class: "btn lang-btn", type: "button", lang: cur,
      title: I18N.t("lang.switch", { current: name(cur), next: name(nxt) }),
      onclick: () => I18N.choose(nxt)
    }, cur.toUpperCase());
  }

  function historyButtons(opts) {
    const compact = opts && opts.compact;
    const undoBtn = el("button", { class: "btn hist", type: "button", disabled: true }, compact ? "↶" : T("hist.undo"));
    const redoBtn = el("button", { class: "btn hist", type: "button", disabled: true }, compact ? "↷" : T("hist.redo"));
    const wrap = el("span", { class: "history-buttons" }, undoBtn, redoBtn);

    const refresh = async () => {
      let st;
      try { st = await browser.runtime.sendMessage({ cmd: "historyState" }); } catch (e) { return; }
      if (!st) return;
      undoBtn.disabled = !st.undo;
      redoBtn.disabled = !st.redo;
      undoBtn.title = st.undo ? T("hist.undoTitle", { label: st.undoLabel, ago: CC.fmtAgo(st.undoTime), n: st.undo }) : T("hist.nothingUndo");
      redoBtn.title = st.redo ? T("hist.redoTitle", { label: st.redoLabel, n: st.redo }) : T("hist.nothingRedo");
    };
    const run = async (cmd) => {
      const r = await browser.runtime.sendMessage({ cmd });
      if (r && r.applied) toast(T(cmd === "undo" ? "hist.undone" : "hist.redone", { label: r.applied }));
      refresh();
    };
    undoBtn.addEventListener("click", () => run("undo"));
    redoBtn.addEventListener("click", () => run("redo"));

    browser.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.cc_history) refresh(); });
    document.addEventListener("keydown", e => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // Textfelder behalten ihr eigenes Undo
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); if (!undoBtn.disabled) run("undo"); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); if (!redoBtn.disabled) run("redo"); }
    });
    refresh();
    return wrap;
  }

  /* ------------------------------------------------------------------ */
  /* Archiv-Tabelle (Seiten-Editor + Dashboard)                          */
  /* ------------------------------------------------------------------ */

  const STATUS_CLASS = { same: "a-keep", differs: "a-delete", missing: "a-block" };
  const status = k => [T("archive." + k), STATUS_CLASS[k], T("archive." + k + "Title")];

  async function restoreAids(aids) {
    const r = await browser.runtime.sendMessage({ cmd: "restore", aids });
    if (r.failed.length) toast(T("archive.restoreFailed", { ok: r.ok.length, failed: r.failed.length, name: r.failed[0].name, error: r.failed[0].error }), "err");
    else toast(T("archive.restored", { n: r.ok.length }));
    return r;
  }

  /* opts: { currentById: Map, containers, compact, showSite, selected: Set(aid), onSelect } */
  function archiveTable(entries, opts) {
    const { currentById = new Map(), containers = {}, compact = false, showSite = false } = opts;
    const selected = opts.selected || new Set();
    const sorted = entries.slice().sort((a, b) =>
      (showSite ? a.site.localeCompare(b.site) : 0) || a.cookie.name.localeCompare(b.cookie.name) || b.savedAt - a.savedAt);
    const versionNo = new Map();
    const perKey = new Map();
    for (const e of entries.slice().sort((a, b) => a.savedAt - b.savedAt)) {
      const n = (perKey.get(e.key) || 0) + 1; perKey.set(e.key, n); versionNo.set(e.aid, n);
    }
    const update = (aid, patch) => browser.runtime.sendMessage({ cmd: "archiveUpdate", aid, patch });
    const cols = 9 + (showSite ? 1 : 0) + (compact ? -2 : 1);

    const allBox = el("input", {
      type: "checkbox", title: T("archive.selectAll"), checked: sorted.length > 0 && sorted.every(e => selected.has(e.aid)),
      onchange: ev => { for (const e of sorted) ev.target.checked ? selected.add(e.aid) : selected.delete(e.aid); opts.onSelect && opts.onSelect(); }
    });

    const body = el("tbody", {}, sorted.map(e => {
      const c = e.cookie;
      const st = status(CC.archiveStatus(e, currentById));
      const versions = perKey.get(e.key);
      return el("tr", { class: e.autoRestore ? "autorestore" : "" },
        el("td", {}, el("input", { type: "checkbox", checked: selected.has(e.aid), onchange: ev => { ev.target.checked ? selected.add(e.aid) : selected.delete(e.aid); opts.onSelect && opts.onSelect(); } })),
        el("td", { title: T("archive.autostartTitle") },
          el("label", { class: "autostart" }, el("input", { type: "checkbox", checked: e.autoRestore, onchange: ev => update(e.aid, { autoRestore: ev.target.checked }) }), compact ? "" : T("archive.start"))),
        showSite ? el("td", { class: "mono" }, el("a", { href: "#site/" + encodeURIComponent(e.site) }, e.site)) : null,
        el("td", { class: "name" }, el("code", {}, c.name), versions > 1 ? el("span", { class: "badge", title: T("archive.versions", { n: versions }) }, "v" + versionNo.get(e.aid) + "/" + versions) : null,
          c.partitionKey ? el("span", { class: "badge c-3p" }, "Part") : null),
        el("td", { class: "mono dim", title: c.domain + c.path }, c.domain, compact ? "" : c.path !== "/" ? c.path : ""),
        compact ? null : el("td", { class: "dim" }, containers[c.storeId] || c.storeId),
        el("td", { class: "num", title: new Date(e.savedAt).toLocaleString(T("fmt.locale")) }, CC.fmtAgo(e.savedAt)),
        el("td", { class: "num", title: c.session ? T("archive.sessionCookie") : CC.fmtDate(c.expirationDate) }, CC.fmtExpiry(c)),
        el("td", { class: "val" }, compact
          ? el("span", { class: "mono dim", title: c.value }, c.value.length > 28 ? c.value.slice(0, 28) + "…" : c.value)
          : el("input", { class: "mono", value: c.value, spellcheck: "false", title: T("archive.editValue"), onchange: ev => update(e.aid, { value: ev.target.value }) })),
        el("td", {}, el("span", { class: "pill " + st[1], title: st[2] }, st[0])),
        compact ? null : el("td", {}, el("input", { value: e.note || "", placeholder: T("archive.note"), onchange: ev => update(e.aid, { note: ev.target.value }) })),
        el("td", { class: "nowrap" },
          el("button", { class: "btn small", title: T("archive.restoreTitle"), onclick: () => restoreAids([e.aid]) }, T("archive.restore")),
          el("button", { class: "icon danger", title: T("archive.removeTitle"), onclick: () => browser.runtime.sendMessage({ cmd: "archiveRemove", aids: [e.aid] }) }, "✕"))
      );
    }));
    if (!sorted.length) body.append(el("tr", {}, el("td", { colspan: cols, class: "empty" }, T("archive.empty"))));

    return el("div", { class: "table-scroll archive-scroll" },
      el("table", { class: "grid archive-table" },
        el("thead", {}, el("tr", {},
          el("th", {}, allBox),
          el("th", { title: T("archive.autostartHead") }, "⟲"),
          showSite ? el("th", {}, T("archive.site")) : null,
          el("th", {}, T("rules.name")), el("th", {}, T("rules.domain")),
          compact ? null : el("th", {}, T("rules.container")),
          el("th", {}, T("archive.archived")), el("th", { title: T("archive.expiryTitle") }, T("archive.expiry")),
          el("th", {}, T("archive.value")), el("th", { title: T("archive.currentTitle") }, T("archive.current")),
          compact ? null : el("th", {}, T("archive.note")),
          el("th", {}, ""))),
        body));
  }

  function archiveBulkBar(selected, after) {
    const n = selected.size;
    return el("div", { class: "toolbar bulk" + (n ? "" : " idle") },
      el("span", { class: "dim" }, n ? T("archive.selected", { n }) : T("archive.noSelection")),
      el("button", { class: "btn", disabled: !n, onclick: async () => { await restoreAids([...selected]); selected.clear(); after(); } }, T("archive.restoreSelection")),
      n ? confirmButton(T("archive.remove"), T("archive.removeConfirm", { n }), async () => {
        const k = await browser.runtime.sendMessage({ cmd: "archiveRemove", aids: [...selected] });
        selected.clear(); toast(T("archive.removed", { n: k })); after();
      }, "danger") : null);
  }

  /* „Alles löschen“ für eine Seite inkl. Prüfung, ob die Seite gleich wieder Daten setzt */
  function purgeButton(site, after, opts) {
    return confirmButton((opts && opts.label) || T("purge.label"), T("purge.confirm"), async () => {
      const r = await browser.runtime.sendMessage({ cmd: "purgeSite", site });
      toast(T("purge.done", { site, n: r.cookies }) + (r.configRemoved ? T("purge.configRemoved") : ""), "", 5000);
      await new Promise(res => setTimeout(res, 1500));
      const back = await CC.getCookiesForSite(site);
      if (back.length) {
        toast(T("purge.back", { site, n: back.length }), "warn", 12000);
      }
      if (after) after(r, back);
    }, "danger " + ((opts && opts.cls) || ""), "purge:" + site);
  }

  /* ------------------------------------------------------------------ */
  /* Seiten-Editor                                                       */
  /* ------------------------------------------------------------------ */

  class SiteEditor {
    constructor(rootEl, { site, compact }) {
      this.root = rootEl;
      this.site = site;
      this.compact = !!compact;
      this.filter = "";
      this.actionFilter = "all";
      this.expanded = new Set();
      this.sort = { key: "name", dir: 1 };
      this.pendingSaves = [];           // JSON eigener, noch nicht gemeldeter Speicherungen
      this.showRules = false;          // true = Cookie-Regeln beim nächsten Zeichnen aufklappen
      this.showArchive = !compact;
      this.selected = new Set();        // ausgewählte Cookies (cookieId)
      this.archSelected = new Set();    // ausgewählte Archiv-Einträge (aid)
      this.archive = [];
      this.openState = {};              // auf-/zugeklappte Abschnitte
      this.live = null;                 // Ergebnis von inspectStorage
      this.liveLoading = false;
      this.showKeyRules = false;
    }

    async init() {
      this.containers = await CC.getContainers();
      await this.reloadConfig();
      await this.reloadCookies();
      await this.reloadArchive();
      this.render();
      this.loadLive();

      this._onStorage = (ch, area) => {
        if (area !== "local") return;
        if (ch[CC.ARCHIVE_KEY]) {
          this.archive = (ch[CC.ARCHIVE_KEY].newValue || []).filter(e => e.site === this.site);
          this.renderArchive(); this.renderCookies();
        }
        if (!ch[CC.CONFIG_KEY]) return;
        // eigene Speicherung genau einmal überspringen; ein späteres identisches Schreiben
        // (z. B. Wiederholen) muss neu geladen werden
        const i = this.pendingSaves.indexOf(JSON.stringify(ch[CC.CONFIG_KEY].newValue));
        if (i >= 0) { this.pendingSaves.splice(0, i + 1); return; }
        this.reloadConfig().then(() => this.render());
      };
      let t = null;
      this._onCookie = () => {
        clearTimeout(t);
        t = setTimeout(() => this.reloadCookies().then(() => { this.renderSummary(); this.renderCookies(); this.updateRuleHits(); this.renderArchive(); }), 400);
      };
      browser.storage.onChanged.addListener(this._onStorage);
      browser.cookies.onChanged.addListener(this._onCookie);
    }

    destroy() {
      if (this._onStorage) browser.storage.onChanged.removeListener(this._onStorage);
      if (this._onCookie) browser.cookies.onChanged.removeListener(this._onCookie);
    }

    async reloadConfig() {
      this.cfg = await CC.loadConfig();
      CC.setExtraSuffixes(this.cfg.settings.extraSuffixes);
    }

    async reloadCookies() {
      this.cookies = await CC.getCookiesForSite(this.site);
      try { this.openSites = new Set(await browser.runtime.sendMessage({ cmd: "openSites" })); }
      catch (e) { this.openSites = new Set(); }
    }

    async reloadArchive() {
      this.archive = (await CC.loadArchive()).filter(e => e.site === this.site);
    }

    archiveByKey() {
      const m = new Map();
      for (const e of this.archive) { if (!m.has(e.key)) m.set(e.key, []); m.get(e.key).push(e); }
      for (const v of m.values()) v.sort((a, b) => b.savedAt - a.savedAt);
      return m;
    }

    sc() { return CC.getSite(this.cfg, this.site, true); }

    /* Löschen und prüfen, ob die Seite die Cookies gleich wieder setzt */
    async deleteWithReport(cookies, reason) {
      const r = await browser.runtime.sendMessage({ cmd: "deleteCookiesDetailed", cookies, reason });
      const n = r.removedIds.length;
      if (r.failed.length) {
        toast(T("del.failed", { n, failed: r.failed.length, list: [...new Set(r.failed.map(f => f.name + " (" + f.domain + ")"))].join(", ") }), "err", 12000);
        return { n, back: [] };
      }
      toast(T("del.done", { n }));
      await new Promise(res => setTimeout(res, 1500));
      const ids = new Set(r.removedIds);
      const back = (await CC.getCookiesForSite(this.site)).filter(c => ids.has(CC.cookieId(c)));
      if (back.length) {
        toast(T("del.back", { back: back.length, n, list: [...new Set(back.map(c => c.name))].join(", ") }), "warn", 12000);
      }
      return { n, back };
    }

    async save(structural) {
      await CC.saveConfig(this.cfg, json => {
        this.pendingSaves.push(json);
        setTimeout(() => { const k = this.pendingSaves.indexOf(json); if (k >= 0) this.pendingSaves.splice(k, 1); }, 2000);
      });
      this.renderSummary();
      this.renderCookies();
      if (structural) this.renderRules(); else this.updateRuleHits();
      if (this._storageDirty !== false) this.renderStorage();
    }

    /* Aufklappbarer Unterabschnitt mit gemerktem Zustand */
    sub(container, key, defOpen, title, badges, ...content) {
      if (!container) return;
      if (!(key in this.openState)) this.openState[key] = defOpen;
      container.textContent = "";
      container.append(el("details", { class: "sub", open: this.openState[key], ontoggle: e => { this.openState[key] = e.target.open; } },
        el("summary", {}, el("h4", {}, title), ...(badges || []).filter(Boolean)), ...content));
    }

    evals() {
      return this.cookies.map(c => ({ c, id: CC.cookieId(c), ev: CC.evaluate(c, this.cfg, this.site) }));
    }

    /* ---------- Gesamtaufbau ----------
     * Seite (gemeinsam) · Cookies (Richtlinie, Inhalt, Regeln, Archiv) · Website-Daten (Richtlinie, Inhalt, Regeln) */
    render() {
      this.root.textContent = "";
      this.summaryEl = el("div", { class: "summary" });
      this.generalEl = el("section", { class: "card site-card" });
      this.policyEl = el("div", { class: "policy" });
      this.cookiesEl = el("div", { class: "cookies" });
      this.rulesEl = el("div", { class: "rules-card" });
      this.archiveEl = el("div", { class: "archive-card" });
      this.dataPolicyEl = el("div", { class: "data-policy" });
      this.storageEl = el("div", { class: "storage-card" });
      this.entryRulesEl = el("div", { class: "entry-rules" });
      this.cookieHead = el("span", { class: "card-badges" });
      this.dataHead = el("span", { class: "card-badges" });
      const card = (key, defOpen, cls, title, head, ...parts) => {
        if (!(key in this.openState)) this.openState[key] = defOpen;
        return el("details", { class: "card section-card " + cls, open: this.openState[key], ontoggle: e => { this.openState[key] = e.target.open; } },
          el("summary", {}, el("h2", {}, title), head), ...parts);
      };
      this.root.append(
        this.summaryEl,
        this.generalEl,
        card("cookieCard", true, "cookie-card", T("site.cookies"), this.cookieHead, this.policyEl, this.cookiesEl, this.rulesEl, this.archiveEl),
        card("dataCard", !this.compact, "data-card", T("site.data"), this.dataHead, this.dataPolicyEl, this.storageEl, this.entryRulesEl));
      this.renderSummary();
      this.renderGeneral();
      this.renderPolicy();
      this.renderCookies();
      this.renderRules();
      this.renderArchive();
      this.renderStorage();
    }

    renderSummary() {
      const counts = { keep: 0, delete: 0, block: 0 };
      for (const { ev } of this.evals()) counts[ev.action]++;
      const open = this.openSites && this.openSites.has(this.site);
      const sc = this.cfg.sites[this.site];
      this.summaryEl.textContent = "";
      this.summaryEl.append(
        el("span", { class: "stat muted" }, open ? T("site.tabOpen") : T("site.noTab")),
        sc && !CC.isSiteConfigEmpty(sc) ? el("span", { class: "badge configured" }, T("site.configured")) : el("span", { class: "badge" }, T("site.globalOnly")));
      // Kopfzeilen der beiden Bereiche
      if (this.cookieHead) {
        this.cookieHead.textContent = "";
        this.cookieHead.append(
          el("span", { class: "stat" }, el("b", {}, String(this.cookies.length)), T("site.statCookies")),
          el("span", { class: "stat s-keep" }, el("b", {}, String(counts.keep)), T("site.statKeep")),
          el("span", { class: "stat s-delete" }, el("b", {}, String(counts.delete)), T("site.statDelete")),
          el("span", { class: "stat s-block" }, el("b", {}, String(counts.block)), T("site.statBlock")));
      }
      if (this.dataHead) {
        const del = CC.storageDeleteTypes(this.cfg, this.site);
        const selective = ["localStorage", "sessionStorage"].filter(t => CC.effectiveStorageMode(this.cfg, this.site, t) === "selective");
        this.dataHead.textContent = "";
        this.dataHead.append(
          del.length ? el("span", { class: "badge a-delete" }, T("site.deletes", { list: del.map(t => CC.STORAGE_LABEL[t]).join(", ") })) : el("span", { class: "stat muted" }, T("site.keepAll")),
          ...(selective.length ? [el("span", { class: "badge c-consent" }, T("site.selective", { list: selective.join(", ") }))] : []));
      }
    }

    /* ---------- Seite (gilt für Cookies und Website-Daten) ---------- */
    renderGeneral() {
      const sc = this.sc();
      const g = this.cfg.settings;
      this.generalEl.textContent = "";
      this.generalEl.append(
        el("h2", {}, T("site.general")),
        el("div", { class: "fields" },
          field(T("site.tabClose"),
            select([["inherit", T("site.inherit", { value: g.cleanOnTabClose ? T("site.on") : T("site.off") })], ["on", T("site.on")], ["off", T("site.off")]], sc.tabClose,
              v => { this.sc().tabClose = v; this.save(); this.renderGeneral(); }),
            T("site.tabCloseHelp")),
          field(T("site.note"),
            el("input", { value: sc.note || "", placeholder: T("site.notePlaceholder"), onchange: e => { this.sc().note = e.target.value; this.save(); } }))),
        el("div", { class: "row-actions" },
          el("span", { class: "hint", style: "margin:0" }, T("site.appliesBoth")),
          el("span", { class: "spacer" }),
          purgeButton(this.site, () => { if (this.onPurged) this.onPurged(); else this.reloadCookies().then(() => this.render()); },
            { label: T("site.purgeAll") })));
    }

    /* ---------- Cookies: Richtlinie ---------- */
    renderPolicy() {
      const sc = this.sc();
      const g = this.cfg.settings;
      const lbl = a => CC.ACTION_LABEL[a] || a;
      this.sub(this.policyEl, "cookiePolicy", true, T("policy.title"), null,
        el("div", { class: "fields" },
          field(T("policy.default"),
            select([["inherit", T("site.inherit", { value: lbl(g.defaultAction) })], ["keep", lbl("keep")], ["delete", lbl("delete")]], sc.defaultAction,
              v => { this.sc().defaultAction = v; this.save(); this.renderPolicy(); }),
            T("policy.defaultHelp")),
          ...["consent", "auth", "tracking"].map(cat =>
            field(T("policy.category", { category: CC.CATEGORY_LABEL[cat] }),
              select([["inherit", T("site.inherit", { value: lbl(g.categories[cat]) })], ["keep", lbl("keep")], ["delete", lbl("delete")], ["block", lbl("block")], ["none", T("policy.none")]],
                sc.categories[cat], v => { this.sc().categories[cat] = v; this.save(); this.renderPolicy(); }),
              T("policy.categoryHelp")))),
        el("p", { class: "hint" }, T("policy.order")));
    }

    /* ---------- Cookie-Tabelle ---------- */
    renderCookies() {
      const keepFocus = document.activeElement && document.activeElement.id === "cc-filter";
      const list = this.evals();
      const f = this.filter.toLowerCase();
      let rows = list.filter(({ c, ev }) => {
        if (this.actionFilter !== "all") {
          if (["keep", "delete", "block"].includes(this.actionFilter) && ev.action !== this.actionFilter) return false;
          if (["consent", "auth", "tracking"].includes(this.actionFilter) && ev.category !== this.actionFilter) return false;
          if (this.actionFilter === "uncat" && ev.category) return false;
          if (this.actionFilter === "3p" && !CC.isThirdParty(c)) return false;
        }
        if (!f) return true;
        return c.name.toLowerCase().includes(f) || c.domain.toLowerCase().includes(f) || (c.value || "").toLowerCase().includes(f);
      });
      const k = this.sort.key, d = this.sort.dir;
      const sortVal = ({ c, ev }) => ({
        name: c.name.toLowerCase(), domain: c.domain, expiry: c.session ? Infinity : c.expirationDate || 0,
        size: CC.cookieSize(c), action: ev.action + c.name, cat: (ev.category || "zz") + c.name
      })[k];
      rows.sort((a, b) => { const x = sortVal(a), y = sortVal(b); return x < y ? -d : x > y ? d : 0; });

      const multiStore = new Set(this.cookies.map(c => c.storeId)).size > 1;
      const showStore = multiStore || !this.compact;

      const th = (key, label, title) => el("th", {
        class: "sortable" + (k === key ? " sorted" : ""), title: title || T("ck.sort"),
        onclick: () => { this.sort = { key, dir: k === key ? -d : 1 }; this.renderCookies(); }
      }, label, k === key ? (d > 0 ? " ▴" : " ▾") : "");

      const cols = (this.compact ? 6 : (showStore ? 10 : 9)) + 1;
      const tbody = el("tbody");
      const arch = this.archiveByKey();
      // Auswahl auf vorhandene Cookies beschränken
      const existing = new Set(list.map(x => x.id));
      for (const id of [...this.selected]) if (!existing.has(id)) this.selected.delete(id);
      for (const { c, id, ev } of rows) {
        const sc = this.cfg.sites[this.site];
        const quick = sc && sc.rules.find(r => r.quick && r.name === c.name);
        let qv = quick ? quick.action : (ev.source === "site-rule" || ev.source === "global-rule") ? "rule" : "auto";
        const qOpts = [["auto", T("ck.auto")], ["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete], ["block", CC.ACTION_LABEL.block]];
        if (qv === "rule") qOpts.splice(1, 0, ["rule", T("ck.rule"), true]);
        const quickSel = select(qOpts, qv, v => this.setQuick(c.name, v), { class: "quick act-" + (quick ? quick.action : "auto"), title: T("ck.quickTitle") });
        const isOpen = this.expanded.has(id);

        const av = arch.get(id) || [];
        tbody.append(el("tr", { class: "ck r-" + ev.action + (isOpen ? " open" : "") + (this.selected.has(id) ? " sel" : "") },
          el("td", {}, el("input", { type: "checkbox", checked: this.selected.has(id), onchange: e => { e.target.checked ? this.selected.add(id) : this.selected.delete(id); this.renderCookies(); } })),
          el("td", {}, quickSel),
          el("td", { class: "name", onclick: () => { isOpen ? this.expanded.delete(id) : this.expanded.add(id); this.renderCookies(); } },
            el("span", { class: "caret" }, isOpen ? "▾" : "▸"),
            el("code", {}, c.name || T("ck.empty")), " ", catBadge(ev.category, ev.pattern),
            CC.isThirdParty(c) ? el("span", { class: "badge c-3p", title: T("ck.thirdParty") }, "3P") : null,
            av.length ? el("span", { class: "badge c-arch", title: T("ck.archived", { n: av.length }) + (av.some(a => a.autoRestore) ? T("ck.archivedAuto") : "") }, (av.some(a => a.autoRestore) ? "⟲ " : "") + T("ck.archiveBadge", { n: av.length })) : null),
          el("td", { class: "mono dim", title: c.domain }, c.domain),
          this.compact ? null : el("td", { class: "mono dim" }, c.path),
          el("td", {}, flagTags(c)),
          el("td", { class: "num", title: CC.fmtDate(c.expirationDate) }, CC.fmtExpiry(c)),
          this.compact ? null : el("td", { class: "num" }, CC.fmtBytes(CC.cookieSize(c))),
          !this.compact && showStore ? el("td", { class: "dim" }, this.containers[c.storeId] || c.storeId) : null,
          el("td", {}, actionPill(ev.action, ev.reason)),
          this.compact ? null : el("td", { class: "reason dim" }, ev.reason)
        ));
        if (isOpen) tbody.append(el("tr", { class: "detail" }, el("td", { colspan: cols }, this.detail(c, ev))));
      }
      if (!rows.length) tbody.append(el("tr", {}, el("td", { colspan: cols, class: "empty" }, this.cookies.length ? T("ck.noMatch") : T("ck.none"))));

      const filterChips = [["all", T("ck.chipAll")], ["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete], ["block", T("ck.chipBlocked")], ["consent", CC.CATEGORY_LABEL.consent], ["auth", T("ck.chipLogin")], ["tracking", CC.CATEGORY_LABEL.tracking], ["uncat", T("ck.chipUncat")], ["3p", "3P"]];
      const toDelete = list.filter(x => x.ev.action !== "keep").map(x => x.c);

      const sel = list.filter(x => this.selected.has(x.id)).map(x => x.c);
      const visibleIds = rows.map(r => r.id);
      const allBox = el("input", {
        type: "checkbox", title: T("ck.selectVisible"),
        checked: visibleIds.length > 0 && visibleIds.every(i => this.selected.has(i)),
        onchange: e => { for (const i of visibleIds) e.target.checked ? this.selected.add(i) : this.selected.delete(i); this.renderCookies(); }
      });
      const bulk = el("div", { class: "toolbar bulk" + (sel.length ? "" : " idle") },
        el("span", { class: "dim" }, sel.length ? T("archive.selected", { n: sel.length }) : T("ck.selectHint")),
        el("button", {
          class: "btn", disabled: !sel.length, title: T("ck.archiveTitle"),
          onclick: async () => {
            const r = await browser.runtime.sendMessage({ cmd: "archive", cookies: sel });
            this.selected.clear(); this.renderCookies();
            toast(T("ck.archivedN", { n: r.added }) + (r.skipped ? T("ck.skipped", { n: r.skipped }) : ""));
          }
        }, T("ck.archive")),
        sel.length ? confirmButton(T("ck.archiveDelete"), T("ck.archiveDeleteConfirm", { n: sel.length }), async () => {
          const r = await browser.runtime.sendMessage({ cmd: "archiveAndDelete", cookies: sel });
          this.selected.clear();
          toast(T("ck.archivedDeleted", { added: r.added, deleted: r.deleted }));
        }, "", "cookies-archdel") : null,
        sel.length ? confirmButton(T("ck.delete"), T("ck.deleteConfirm", { n: sel.length }), async () => {
          this.selected.clear();
          await this.deleteWithReport(sel, T("ck.reasonSelection"));
        }, "danger", "cookies-del-sel") : null,
        sel.length ? el("button", { class: "btn", onclick: () => { this.selected.clear(); this.renderCookies(); } }, T("ck.clearSelection")) : null
      );

      this.sub(this.cookiesEl, "cookieContent", true, T("ck.content"), [el("span", { class: "stat muted" }, T("ck.count", { n: this.cookies.length }))],
        el("div", { class: "toolbar" },
          el("input", {
            id: "cc-filter", type: "search", placeholder: T("ck.filter"), value: this.filter,
            oninput: e => { this.filter = e.target.value; this.renderCookies(); }
          }),
          el("div", { class: "chips" }, filterChips.map(([v, l]) =>
            el("button", { class: "chip" + (this.actionFilter === v ? " on" : ""), onclick: () => { this.actionFilter = v; this.renderCookies(); } }, l))),
          el("span", { class: "spacer" }),
          el("button", { class: "btn", title: T("ck.reload"), onclick: () => this.reloadCookies().then(() => { this.renderSummary(); this.renderCookies(); }) }, "↻"),
          confirmButton(T("ck.clean", { n: toDelete.length }), T("ck.cleanConfirm", { n: toDelete.length }), async () => {
            const r = await browser.runtime.sendMessage({ cmd: "cleanSite", site: this.site });
            toast(T("ck.cleaned", { n: r.length }));
          }, "primary", "cookies-clean"),
          confirmButton(T("ck.deleteAll"), T("ck.deleteAllConfirm", { n: this.cookies.length }), async () => {
            await this.deleteWithReport(this.cookies.slice(), T("ck.reasonAll"));
          }, "danger", "cookies-del-all")
        ),
        bulk,
        el("div", { class: "table-scroll cookies-scroll" },
          el("table", { class: "grid cookie-table" },
            el("thead", {}, el("tr", {},
              el("th", {}, allBox),
              el("th", { title: T("ck.ruleHeadTitle") }, T("ck.rule")),
              th("name", T("rules.name")),
              th("domain", T("rules.domain")),
              this.compact ? null : el("th", {}, T("rules.path")),
              el("th", {}, T("ck.flags")),
              th("expiry", T("archive.expiry")),
              this.compact ? null : th("size", T("ck.size")),
              !this.compact && showStore ? el("th", {}, T("rules.container")) : null,
              th("action", T("ck.result"), T("ck.resultTitle")),
              this.compact ? null : el("th", {}, T("ck.reason"))
            )),
            tbody))
      );
      if (keepFocus) {
        const inp = this.cookiesEl.querySelector("#cc-filter");
        inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
      }
    }

    detail(c, ev) {
      const kv = [
        [T("rules.name"), c.name], [T("dt.value"), c.value], [T("rules.domain"), c.domain], ["Host-only", String(!!c.hostOnly)],
        [T("rules.path"), c.path], ["Secure", String(!!c.secure)], ["HttpOnly", String(!!c.httpOnly)],
        ["SameSite", c.sameSite], [T("dt.session"), String(!!c.session)],
        [T("archive.expiry"), c.session ? T("dt.endOfSession") : CC.fmtDate(c.expirationDate) + "  (" + CC.fmtExpiry(c) + ")"],
        [T("rules.container"), (this.containers[c.storeId] || "?") + "  [" + c.storeId + "]"],
        ["firstPartyDomain", c.firstPartyDomain || "—"],
        ["partitionKey", c.partitionKey ? JSON.stringify(c.partitionKey) : "—"],
        [T("ck.size"), T("dt.bytes", { n: CC.cookieSize(c) })],
        [T("dt.category"), ev.category ? CC.CATEGORY_LABEL[ev.category] + "  " + T("dt.pattern", { pattern: ev.pattern }) : "—"],
        [T("dt.decision"), CC.ACTION_LABEL[ev.action] + " – " + ev.reason]
      ];
      let decoded = null;
      try { const d = decodeURIComponent(c.value); if (d !== c.value) decoded = d; } catch (e) {}
      if (decoded) kv.splice(2, 0, [T("dt.valueDecoded"), decoded]);

      return el("div", { class: "detail-box" },
        el("dl", {}, kv.map(([k, v]) => [el("dt", {}, k), el("dd", { class: "mono" }, v == null ? "—" : String(v))])),
        el("div", { class: "row-actions" },
          el("button", { class: "btn", onclick: () => copyText(c.value) }, T("dt.copyValue")),
          el("button", { class: "btn", onclick: () => copyText(JSON.stringify(c, null, 2)) }, T("dt.copyJson")),
          el("button", {
            class: "btn", title: T("dt.preciseTitle"),
            onclick: () => {
              this.sc().rules.unshift(CC.newRule({ match: "exact", name: c.name, domain: CC.cookieHost(c), path: c.path, action: ev.action === "keep" ? "keep" : "delete" }));
              this.showRules = true; this.save(true);
              toast(T("dt.preciseAdded"));
            }
          }, T("dt.precise")),
          el("button", {
            class: "btn", title: T("dt.prefixTitle"),
            onclick: () => {
              const m = /^([A-Za-z_.\-]+?)[_\-.]?[0-9a-f]{4,}.*$|^([A-Za-z_]+[_\-.])/.exec(c.name);
              const prefix = m ? (m[1] || m[2]) : c.name;
              this.sc().rules.unshift(CC.newRule({ match: "glob", name: prefix + "*", action: ev.action === "keep" ? "keep" : "delete" }));
              this.showRules = true; this.save(true);
              toast(T("dt.prefixAdded", { pattern: prefix + "*" }));
            }
          }, T("dt.prefix")),
          el("button", {
            class: "btn", onclick: async () => {
              const r = await browser.runtime.sendMessage({ cmd: "archive", cookies: [c] });
              toast(r.added ? T("dt.archived") : T("dt.unchanged"));
            }
          }, T("ck.archive")),
          el("button", {
            class: "btn", title: T("dt.autostartTitle"),
            onclick: async () => {
              await browser.runtime.sendMessage({ cmd: "archive", cookies: [c] });
              const latest = (await CC.loadArchive()).filter(e => e.key === CC.cookieId(c)).sort((a, b) => b.savedAt - a.savedAt)[0];
              if (latest) await browser.runtime.sendMessage({ cmd: "archiveUpdate", aid: latest.aid, patch: { autoRestore: true } });
              toast(T("dt.autostartDone"));
            }
          }, T("dt.autostart")),
          el("button", {
            class: "btn danger", onclick: async () => {
              await this.deleteWithReport([c], T("dt.reasonSingle"));
            }
          }, T("dt.deleteNow"))
        ),
        this.versionList(c)
      );
    }

    versionList(c) {
      const versions = this.archiveByKey().get(CC.cookieId(c)) || [];
      if (!versions.length) return null;
      return el("div", { class: "versions" },
        el("div", { class: "dim", style: "margin:8px 0 4px" }, T("ver.title", { n: versions.length })),
        el("table", { class: "grid" }, el("tbody", {}, versions.map(e => el("tr", { class: e.autoRestore ? "autorestore" : "" },
          el("td", { class: "num", title: new Date(e.savedAt).toLocaleString(T("fmt.locale")) }, new Date(e.savedAt).toLocaleString(T("fmt.locale"))),
          el("td", { class: "mono val", title: e.cookie.value }, e.cookie.value === c.value ? el("span", { class: "pill a-keep" }, T("ver.current")) : (e.cookie.value.length > 60 ? e.cookie.value.slice(0, 60) + "…" : e.cookie.value)),
          el("td", {}, el("label", { class: "autostart", title: T("ver.autostartTitle") },
            el("input", { type: "checkbox", checked: e.autoRestore, onchange: ev => browser.runtime.sendMessage({ cmd: "archiveUpdate", aid: e.aid, patch: { autoRestore: ev.target.checked } }) }), T("ver.onStart"))),
          el("td", {}, el("button", { class: "btn small", onclick: () => restoreAids([e.aid]) }, T("archive.restore")),
            el("button", { class: "icon danger", title: T("ver.remove"), onclick: () => browser.runtime.sendMessage({ cmd: "archiveRemove", aids: [e.aid] }) }, "✕"))
        )))));
    }

    /* ---------- Weitere lokale Speicher ---------- */
    st() {
      const sc = this.sc();
      if (!sc.storage) sc.storage = CC.defaultSiteStorage();
      return sc.storage;
    }

    async loadLive() {
      this.liveLoading = true;
      this.renderStorage();
      try { this.live = await browser.runtime.sendMessage({ cmd: "inspectStorage", site: this.site }); }
      catch (e) { this.live = { error: String(e) }; }
      this.liveLoading = false;
      this.renderStorage();
    }

    setQuickKey(store, key, value) {
      const st = this.st();
      st.keyRules = st.keyRules.filter(r => !(r.quick && r.store === store && r.name === key));
      if (value === "keep" || value === "delete") {
        st.keyRules.unshift(CC.newKeyRule({ store, match: "exact", name: key, action: value, quick: true, note: T("rules.quick") }));
        const type = store === "local" ? "localStorage" : "sessionStorage";
        if (CC.effectiveStorageMode(this.cfg, this.site, type) !== "selective") {
          st[type] = "selective";
          toast(T("data.switchedSelective", { type }));
        }
      }
      this.save(true);
    }

    async itemAction(op, args, okMsg) {
      try {
        const r = await browser.runtime.sendMessage({ cmd: "storageItem", site: this.site, op, args });
        if (r && r.ok) toast(okMsg);
        else if (r && r.pending) toast(T("data.blocked"), "err");
        else toast(T("data.failed", { msg: (r && r.error) || T("data.unknown") }), "err");
      } catch (e) { toast(T("data.failed", { msg: e.message }), "err"); }
      this.loadLive();
    }

    /* ganze Speicherart für alle bekannten Hosts der Seite löschen (browsingData) */
    deleteTypeButton(type) {
      return confirmButton(T("data.deleteAll"), T("data.sure"), async () => {
        const hosts = await browser.runtime.sendMessage({ cmd: "deleteStorageNow", site: this.site, type });
        toast(deletedText(type, hosts)); this.loadLive();
      }, "danger small");
    }

    /* Einheitlicher Kopf je Speicherart: Name · Kennzahlen · Modus · Aktionen */
    liveSection(type, title, info, actions, table) {
      const mode = type ? CC.MODE_LABEL[CC.effectiveStorageMode(this.cfg, this.site, type)] : null;
      return el("div", { class: "keyblock" },
        el("div", { class: "keyhead" }, el("b", {}, title), el("span", { class: "dim" }, " " + info + (mode ? T("data.mode", { mode }) : "")),
          el("span", { class: "spacer" }), ...(actions || []).filter(Boolean)),
        table);
    }

    entryTable(store, items) {
      const type = store === "local" ? "localStorage" : "sessionStorage";
      const st = this.st();
      const rows = (items || []).map(it => {
        const ev = CC.evalKey(this.cfg, this.site, store, it.k);
        const quick = st.keyRules.find(r => r.quick && r.store === store && r.name === it.k);
        const qv = quick ? quick.action : ev.ruleId ? "rule" : "auto";
        const opts = [["auto", T("ck.auto")], ["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete]];
        if (qv === "rule") opts.splice(1, 0, ["rule", T("ck.rule"), true]);
        return el("tr", { class: "r-" + ev.action },
          el("td", {}, select(opts, qv, v => this.setQuickKey(store, it.k, v), { class: "quick act-" + (quick ? quick.action : "auto"), title: T("data.entryQuickTitle") })),
          el("td", { class: "name" }, el("code", {}, it.k)),
          el("td", { class: "mono dim val", title: it.v }, it.v.length > 80 ? it.v.slice(0, 80) + "…" : it.v),
          el("td", { class: "num" }, CC.fmtBytes(it.size)),
          el("td", {}, actionPill(ev.action, ev.reason)),
          this.compact ? null : el("td", { class: "reason dim" }, ev.reason),
          el("td", { class: "nowrap" },
            el("button", { class: "btn small", title: T("data.copyValue"), onclick: () => copyText(it.v) }, T("data.copy")),
            el("button", { class: "icon danger", title: T("data.deleteEntryTitle"), onclick: async () => {
              await browser.runtime.sendMessage({ cmd: "removeKeys", site: this.site, store, keys: [it.k] });
              toast(T("data.deletedItem", { name: it.k })); this.loadLive();
            } }, "✕")));
      });
      const total = (items || []).reduce((a, b) => a + b.size, 0);
      const cols = this.compact ? 6 : 7;
      const clearAll = store === "local" ? this.deleteTypeButton("localStorage")
        : (items || []).length ? confirmButton(T("data.deleteAll"), T("data.sure"), async () => {
          await browser.runtime.sendMessage({ cmd: "removeKeys", site: this.site, store, keys: items.map(x => x.k) });
          toast(T("data.sessionCleared")); this.loadLive();
        }, "danger small") : null;
      return this.liveSection(type, type, T("data.entries", { n: (items || []).length, size: CC.fmtBytes(total) }), [clearAll],
        el("div", { class: "table-scroll keys-scroll" }, el("table", { class: "grid" },
          el("thead", {}, el("tr", {},
            el("th", { title: T("data.entryRuleHead") }, T("ck.rule")), el("th", {}, T("rules.name")), el("th", {}, T("dt.value")), el("th", {}, T("ck.size")),
            el("th", { title: T("data.resultTitle") }, T("ck.result")), this.compact ? null : el("th", {}, T("ck.reason")), el("th", {}, ""))),
          el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: cols, class: "empty" }, T("data.noEntries")))))));
    }

    idbTable(data) {
      if (data.idb == null) return this.liveSection("indexedDB", "IndexedDB", T("data.unreadable") + (data.errors && data.errors.idb ? ": " + data.errors.idb : ""), [this.deleteTypeButton("indexedDB")], null);
      const total = data.idb.reduce((a, d) => a + (d.records || 0), 0);
      const rows = [];
      for (const d of data.idb) {
        rows.push(el("tr", { class: "grp" },
          el("td", { class: "name" }, el("code", {}, d.name)),
          el("td", { class: "num" }, "v" + d.version),
          el("td", { class: "num" }, String(d.stores.length)),
          el("td", { class: "num" }, String(d.records)),
          el("td", { class: "dim" }, d.error ? T("data.errorPrefix", { msg: d.error }) : ""),
          el("td", { class: "nowrap" }, confirmButton(T("data.delete"), T("data.sure"), () => this.itemAction("deleteIdb", [d.name], T("data.dbDeleted", { name: d.name })), "danger small"))));
        for (const st of d.stores) {
          rows.push(el("tr", { class: "sub" },
            el("td", { class: "mono dim" }, "└ ", st.name),
            el("td", {}, ""),
            el("td", { class: "dim", title: T("data.indexes") }, (st.keyPath ? "key " + st.keyPath : st.autoIncrement ? "autoInc" : "") + (st.indexes.length ? " · " + st.indexes.join(", ") : "")),
            el("td", { class: "num" }, st.count == null ? "?" : String(st.count)),
            el("td", {}, ""),
            el("td", { class: "nowrap" }, confirmButton(T("data.clear"), T("data.sure"), () => this.itemAction("clearIdbStore", [d.name, st.name], T("data.storeCleared", { name: d.name + "/" + st.name })), "small"))));
        }
      }
      return this.liveSection("indexedDB", "IndexedDB", T("data.dbSummary", { dbs: data.idb.length, n: total }), [this.deleteTypeButton("indexedDB")],
        el("div", { class: "table-scroll keys-scroll" }, el("table", { class: "grid" },
          el("thead", {}, el("tr", {}, el("th", {}, T("data.dbName")), el("th", {}, T("data.version")), el("th", {}, T("data.stores")), el("th", {}, T("data.entriesHead")), el("th", {}, ""), el("th", {}, ""))),
          el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: 6, class: "empty" }, T("data.noDbs")))))));
    }

    cacheTable(data) {
      if (data.caches == null) return this.liveSection("cacheStorage", "Cache Storage", T("data.unreadable") + (data.errors && data.errors.caches ? ": " + data.errors.caches : ""), [this.deleteTypeButton("cacheStorage")], null);
      this.openCaches = this.openCaches || new Set();
      const rows = [];
      for (const c of data.caches) {
        const isOpen = this.openCaches.has(c.name);
        rows.push(el("tr", { class: "grp" },
          el("td", { class: "name", onclick: () => { isOpen ? this.openCaches.delete(c.name) : this.openCaches.add(c.name); this.renderStorage(); } },
            el("span", { class: "caret" }, c.count ? (isOpen ? "▾" : "▸") : ""), el("code", {}, c.name)),
          el("td", { class: "num" }, String(c.count) + (c.truncated ? "+" : "")),
          el("td", { class: "num" }, CC.fmtBytes(c.size)),
          el("td", { class: "dim" }, c.error ? T("data.errorPrefix", { msg: c.error }) : ""),
          el("td", { class: "nowrap" }, confirmButton(T("data.delete"), T("data.sure"), () => this.itemAction("deleteCache", [c.name], T("data.cacheDeleted", { name: c.name })), "danger small"))));
        if (isOpen) for (const e of c.entries) {
          rows.push(el("tr", { class: "sub" },
            el("td", { class: "mono dim val", title: e.url }, "└ ", e.method !== "GET" ? e.method + " " : "", e.url),
            el("td", { class: "dim" }, e.type.split(";")[0]),
            el("td", { class: "num" }, CC.fmtBytes(e.size)),
            el("td", {}, ""),
            el("td", {}, el("button", { class: "icon danger", title: T("data.deleteEntry"), onclick: () => this.itemAction("deleteCacheEntry", [c.name, e.url], T("data.entryDeleted")) }, "✕"))));
        }
      }
      const total = data.caches.reduce((a, c) => a + c.size, 0);
      return this.liveSection("cacheStorage", "Cache Storage", T("data.cacheSummary", { n: data.caches.length, size: CC.fmtBytes(total) }), [this.deleteTypeButton("cacheStorage")],
        el("div", { class: "table-scroll keys-scroll" }, el("table", { class: "grid" },
          el("thead", {}, el("tr", {}, el("th", {}, T("data.cacheName")), el("th", {}, T("data.entriesType")), el("th", {}, T("ck.size")), el("th", {}, ""), el("th", {}, ""))),
          el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: 5, class: "empty" }, T("data.noCaches")))))));
    }

    swTable(data) {
      if (data.sw == null) return this.liveSection("serviceWorkers", CC.STORAGE_LABEL.serviceWorkers, T("data.unreadable") + (data.errors && data.errors.sw ? ": " + data.errors.sw : ""), [this.deleteTypeButton("serviceWorkers")], null);
      const rows = data.sw.map(w => el("tr", {},
        el("td", { class: "mono" }, w.scope),
        el("td", { class: "mono dim val", title: w.script }, w.script),
        el("td", {}, el("span", { class: "pill " + (w.state === "activated" ? "a-keep" : "a-delete") }, w.state), w.controlsPage ? el("span", { class: "badge", style: "margin-left:4px", title: T("data.controlsTitle") }, T("data.controls")) : null),
        el("td", { class: "nowrap" }, confirmButton(T("data.unregister"), T("data.sure"), () => this.itemAction("unregisterSw", [w.scope], T("data.swUnregistered")), "danger small"))));
      return this.liveSection("serviceWorkers", CC.STORAGE_LABEL.serviceWorkers, T("data.swSummary", { n: data.sw.length }), [this.deleteTypeButton("serviceWorkers")],
        el("div", { class: "table-scroll keys-scroll" }, el("table", { class: "grid" },
          el("thead", {}, el("tr", {}, el("th", {}, T("data.scope")), el("th", {}, T("data.script")), el("th", {}, T("data.status")), el("th", {}, ""))),
          el("tbody", {}, rows.length ? rows : el("tr", {}, el("td", { colspan: 4, class: "empty" }, T("data.noSw")))))));
    }

    /* ---------- Website-Daten: Richtlinie · Inhalt · Eintragsregeln ---------- */
    renderStorage() {
      if (!this.storageEl) return;
      const st = this.st();
      const g = this.cfg.settings.storage || {};
      const open = this.live && this.live.open;
      const data = this.live && this.live.data;
      const anySelective = ["localStorage", "sessionStorage"].some(t => CC.effectiveStorageMode(this.cfg, this.site, t) === "selective");
      const delTypes = CC.storageDeleteTypes(this.cfg, this.site);
      if (this.renderSummary && this.dataHead) this.renderSummary();

      // 1. Richtlinie
      const modeSel = type => {
        const opts = [["inherit", T("site.inherit", { value: CC.MODE_LABEL[g[type] || "keep"].replace(/ \(.*\)/, "") })]].concat(CC.STORAGE_MODES[type].map(m => [m, CC.MODE_LABEL[m]]));
        return field(CC.STORAGE_LABEL[type],
          select(opts, st[type] || "inherit", v => { this.st()[type] = v; this.save(true); }, { class: "mode-" + CC.effectiveStorageMode(this.cfg, this.site, type) }),
          CC.STORAGE_HELP[type]);
      };
      this.sub(this.dataPolicyEl, "dataPolicy", true, T("policy.title"), null,
        el("div", { class: "fields" },
          ...CC.STORAGE_TYPES.map(modeSel),
          field(T("data.keyDefault"),
            select([["keep", CC.ACTION_LABEL.keep], ["delete", CC.ACTION_LABEL.delete]], st.keyDefault || "keep", v => { this.st().keyDefault = v; this.save(true); }, { disabled: !anySelective }),
            T("data.keyDefaultHelp"))),
        el("p", { class: "hint" }, T("data.policyHint")));

      // 2. Inhalt
      let content;
      if (this.liveLoading) content = [el("p", { class: "dim" }, T("data.loading"))];
      else if (!this.live || !open) content = [
        el("p", { class: "hint" }, T("data.noTab")),
        el("div", { class: "row-actions" }, ...CC.WHOLE_TYPES.map(t =>
          confirmButton(T("data.deleteType", { label: CC.STORAGE_LABEL[t] }), T("data.sure"), async () => {
            const hosts = await browser.runtime.sendMessage({ cmd: "deleteStorageNow", site: this.site, type: t });
            toast(deletedText(t, hosts));
          }, "danger small")))];
      else if (this.live.error) content = [el("p", { class: "hint" }, T("data.readError", { msg: this.live.error }))];
      else content = [
        this.entryTable("local", data.local),
        this.entryTable("session", data.session),
        this.idbTable(data),
        this.cacheTable(data),
        this.swTable(data),
        this.liveSection("cache", CC.STORAGE_LABEL.cache, T("data.httpCacheHidden"), [this.deleteTypeButton("cache")], null)];
      const info = data && open && !this.live.error
        ? el("span", { class: "dim mono" }, data.origin + (data.estimate ? T("data.usage", { usage: CC.fmtBytes(data.estimate.usage), quota: CC.fmtBytes(data.estimate.quota) }) : "") + (data.persisted ? T("data.persistent") : ""))
        : null;
      this.sub(this.storageEl, "dataContent", true, T("ck.content"), null,
        el("div", { class: "toolbar" },
          info,
          el("span", { class: "spacer" }),
          el("button", { class: "btn", title: T("ck.reload"), onclick: () => this.loadLive() }, "↻"),
          anySelective && open ? el("button", { class: "btn", title: T("data.applyTitle"), onclick: async () => {
            const r = await browser.runtime.sendMessage({ cmd: "applyKeyRules", site: this.site });
            const n = (r.results || []).reduce((a, x) => a + ((x.result && (x.result.local + x.result.session)) || 0), 0);
            toast(T("data.removed", { n })); this.loadLive();
          } }, T("data.apply")) : null,
          confirmButton(T("data.clean", { n: delTypes.length }), delTypes.length ? T("data.cleanConfirm") : T("data.nothingDelete"), async () => {
            if (!delTypes.length) return;
            const r = await browser.runtime.sendMessage({ cmd: "cleanStorage", site: this.site });
            toast(T("data.deletedList", { list: r.map(x => x.name).join(", ") })); this.loadLive();
          }, "primary"),
          confirmButton(T("data.deleteAll"), T("data.deleteAllConfirm"), async () => {
            for (const t of CC.WHOLE_TYPES) await browser.runtime.sendMessage({ cmd: "deleteStorageNow", site: this.site, type: t });
            toast(T("data.allDeleted")); this.loadLive();
          }, "danger")),
        ...content);

      // 3. Eintragsregeln
      if (this.showKeyRules) { this.openState.entryRules = true; this.showKeyRules = false; }
      this.sub(this.entryRulesEl, "entryRules", anySelective && !this.compact, T("data.entryRules", { n: st.keyRules.length }), null,
        entryRuleTable(st.keyRules, {
          live: open && data && !this.live.error ? data : null,
          onChange: (noRedraw) => { if (noRedraw) { this._storageDirty = false; this.save(false).then(() => { this._storageDirty = true; }); } else this.save(true); },
          onStructure: () => this.save(true)
        }));
    }

    /* ---------- Archiv der Seite ---------- */
    renderArchive() {
      if (!this.archiveEl) return;
      const currentById = new Map(this.cookies.map(c => [CC.cookieId(c), c]));
      for (const a of [...this.archSelected]) if (!this.archive.some(e => e.aid === a)) this.archSelected.delete(a);
      const auto = this.archive.filter(e => e.autoRestore).length;
      const missing = this.archive.filter(e => CC.archiveStatus(e, currentById) === "missing");
      const redraw = () => this.renderArchive();
      this.sub(this.archiveEl, "cookieArchive", !this.compact, T("sarch.title", { n: this.archive.length }),
        [auto ? el("span", { class: "badge c-arch" }, T("sarch.onStart", { n: auto })) : null,
         missing.length ? el("span", { class: "badge" }, T("sarch.missing", { n: missing.length })) : null],
        el("div", { class: "toolbar" },
          archiveBulkBar(this.archSelected, redraw),
          el("span", { class: "spacer" }),
          missing.length ? el("button", { class: "btn", title: T("sarch.restoreMissingTitle"), onclick: () => {
            const newest = new Map();
            for (const e of missing) if (!newest.has(e.key) || newest.get(e.key).savedAt < e.savedAt) newest.set(e.key, e);
            restoreAids([...newest.values()].map(e => e.aid));
          } }, T("sarch.restoreMissing")) : null),
        archiveTable(this.archive, { currentById, containers: this.containers, compact: this.compact, selected: this.archSelected, onSelect: redraw }),
        el("p", { class: "hint" }, T("sarch.hint")));
    }

    setQuick(name, value) {
      const sc = this.sc();
      sc.rules = sc.rules.filter(r => !(r.quick && r.name === name));
      if (CC.ACTIONS.includes(value)) {
        sc.rules.unshift(CC.newRule({ match: "exact", name, action: value, quick: true, note: T("rules.quick") }));
      }
      this.save(true);
    }

    /* ---------- Seitenregeln ---------- */
    renderRules() {
      const sc = this.sc();
      if (this.showRules) { this.openState.cookieRules = true; this.showRules = false; }
      this.sub(this.rulesEl, "cookieRules", !this.compact, T("site.rules", { n: sc.rules.length }), null,
        ruleTable(sc.rules, {
          containers: this.containers, cookies: this.cookies, addLabel: T("rules.add"),
          onChange: () => this.save(false), onStructure: () => this.save(true)
        }));
    }

    updateRuleHits() {
      // Treffer-Spalte aktualisieren, ohne Eingabefelder neu zu erzeugen
      const sc = this.sc();
      const cells = this.rulesEl.querySelectorAll("tbody tr td.num");
      sc.rules.forEach((r, i) => {
        if (!cells[i]) return;
        const n = this.cookies.filter(c => CC.ruleMatches(r, c)).length;
        cells[i].textContent = String(n);
        cells[i].classList.toggle("muted", !n);
      });
    }
  }

  root.UI = { purgeButton, historyButtons, languageButton, el, select, confirmButton, toast, copyText, actionPill, catBadge, ruleTable, archiveTable, archiveBulkBar, restoreAids, SiteEditor };
})(typeof self !== "undefined" ? self : this);
