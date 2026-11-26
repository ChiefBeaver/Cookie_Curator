/*
 * Cookie Curator – Kernlogik
 * Wird von Background, Popup und Dashboard gemeinsam genutzt (globaler Namespace `CC`).
 *
 * Entscheidungsreihenfolge für ein Cookie (erste Übereinstimmung gewinnt):
 *   1. Cookie-Regeln der Seite (explizit, geordnet)
 *   2. Globale Cookie-Regeln (explizit, geordnet)
 *   3. Kategorie (Consent / Login / Tracking) → Seiten-Override, sonst globale Kategorie-Aktion
 *   4. Standard der Seite (Behalten / Löschen)
 *   5. Globaler Standard
 *
 * Aktionen:  keep   = bleibt bei Bereinigungen erhalten
 *            delete = wird bei Bereinigungen (Tab zu / Start / Intervall / manuell) gelöscht
 *            block  = wird sofort beim Setzen gelöscht (und bei jeder Bereinigung)
 */
(function (root) {
  "use strict";

  const CONFIG_KEY = "cc_config";
  const LOG_KEY = "cc_log";
  const SCHEMA_VERSION = 1;

  const ACTIONS = ["keep", "delete", "block"];
  /* Beschriftungen kommen aus den Sprachdateien; die Getter lesen bei jedem Zugriff die aktive Sprache */
  const T = (key, params) => root.I18N ? root.I18N.t(key, params) : key;
  function labels(prefix, keys) {
    const o = {};
    for (const k of keys) Object.defineProperty(o, k, { get: () => T(prefix + k), enumerable: true });
    return o;
  }

  const ACTION_LABEL = labels("action.", ["keep", "delete", "block", "none", "inherit"]);
  const CATEGORIES = ["consent", "tracking", "auth"]; // Prüfreihenfolge
  const CATEGORY_LABEL = labels("category.", ["consent", "auth", "tracking"]);

  /* ------------------------------------------------------------------ */
  /* Standard-Konfiguration                                              */
  /* ------------------------------------------------------------------ */

  const DEFAULT_PATTERNS = {
    consent: [
      "*consent*", "OptanonAlertBoxClosed", "eupubconsent*", "CookieConsentBulkSetting*",
      "cookielawinfo*", "cookies_accepted", "cookies-accepted", "cookie_notice_accepted",
      "viewed_cookie_policy", "SOCS", "didomi_token", "_iub_cs-*", "uc_settings",
      "uc_user_interaction", "borlabs-cookie", "cmplz_*", "complianz_*", "usprivacy",
      "__cmpcvc*", "__cmpcc*", "notice_preferences", "notice_gdpr_prefs", "truste*",
      "axeptio_*", "tarteaucitron", "klaro", "cc_cookie", "moove_gdpr_popup", "*gdpr*",
      "CookieScriptConsent", "cookiebot*", "cookieyes-*", "osano_*", "_evidon_*", "OTAdditionalConsentString"
    ],
    tracking: [
      "_ga", "_ga_*", "_gid", "_gat*", "_gcl_*", "__utm*", "_dc_gtm_*", "_fbp", "_fbc", "fr",
      "IDE", "test_cookie", "DSID", "__gads", "__gpi", "__eoi", "_uetsid", "_uetvid", "MUID",
      "_clck", "_clsk", "CLID", "ANONCHK", "SM", "_hj*", "_pk_*", "_pin_unauth", "_ttp", "_tt_*",
      "_scid", "_sctr", "_rdt_uuid", "li_sugr", "bcookie", "lidc", "UserMatchHistory",
      "AnalyticsSyncHistory", "personalization_id", "muc_ads", "YSC", "VISITOR_INFO1_LIVE",
      "__qca", "ajs_*", "amplitude_*", "AMP_*", "mp_*_mixpanel", "_mkto_trk", "hubspotutk",
      "__hstc", "__hssc", "__hssrc", "_vwo_*", "optimizelyEndUserId", "_parsely*", "s_cc",
      "s_sq", "s_vi", "s_fid", "AMCV_*", "AMCVS_*", "_ym_*", "yandexuid", "cto_bundle",
      "__adroll*", "_tq_id*", "_awl", "_gaexp", "_lfa", "_mkto_*", "__ar_v4", "_an_uid", "tuuid*"
    ],
    auth: [
      "*sess*", "PHPSESSID", "JSESSIONID", "ASP.NET_SessionId", ".AspNetCore.*", "connect.sid",
      "sid", "*_sid", "ssid", "*auth*", "*token*", "*login*", "*logged_in*", "remember*",
      "*remember_me*", "wordpress_*", "*_user_session", "user_session", "__Host-*", "__Secure-*",
      "*csrf*", "*xsrf*", "SAPISID", "APISID", "HSID", "LSID", "SIDCC", "*jwt*", "*identity*"
    ]
  };

  function defaultConfig() {
    return {
      version: SCHEMA_VERSION,
      settings: {
        defaultAction: "keep",        // Seiten ohne eigene Einstellung: keep | delete
        cleanOnTabClose: true,
        tabCloseDelaySec: 15,
        cleanOnStartup: true,
        periodicMinutes: 0,           // 0 = aus
        skipOpenSites: true,          // Start/Intervall/"Alles bereinigen": Seiten mit offenen Tabs auslassen
        enforceBlock: true,           // "block" sofort beim Setzen löschen
        badge: "pending",             // pending | total | off
        logEnabled: true,
        logMax: 2000,
        extraSuffixes: "",            // zusätzliche Public Suffixes, je Zeile eine
        restoreOnStartup: true,       // Archiv-Einträge mit Autostart beim Browserstart zurücksetzen
        restoreExtendDays: 30,        // abgelaufene archivierte Cookies beim Zurückholen verlängern (0 = Sitzung)
        archiveMaxVersions: 5,        // Versionen pro Cookie im Archiv
        storage: { localStorage: "keep", sessionStorage: "keep", indexedDB: "keep", cacheStorage: "keep", serviceWorkers: "keep", cache: "keep" },
        categories: { consent: "keep", auth: "keep", tracking: "delete" } // keep|delete|block|none
      },
      categoryPatterns: JSON.parse(JSON.stringify(DEFAULT_PATTERNS)),
      globalRules: [],
      sites: {}
    };
  }

  function defaultSiteConfig() {
    return {
      defaultAction: "inherit",       // inherit | keep | delete
      tabClose: "inherit",            // inherit | on | off
      categories: { consent: "inherit", auth: "inherit", tracking: "inherit" },
      rules: [],
      note: "",
      storage: defaultSiteStorage()
    };
  }

  function defaultSiteStorage() {
    return {
      localStorage: "inherit", sessionStorage: "inherit", indexedDB: "inherit", cacheStorage: "inherit", serviceWorkers: "inherit", cache: "inherit",
      keyDefault: "keep",             // selektiver Modus: Einträge ohne passende Eintragsregel
      keyRules: []                    // { id, enabled, store: local|session|both, match, name, action: keep|delete, note }
    };
  }

  function newRule(partial) {
    return Object.assign({
      id: "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      enabled: true,
      match: "glob",                  // exact | glob | regex
      name: "*",
      domain: "",                     // Glob auf cookie.domain (ohne führenden Punkt), leer = alle
      path: "",                       // Glob auf cookie.path, leer = alle
      store: "",                      // cookieStoreId (Container), leer = alle
      action: "keep",
      note: ""
    }, partial || {});
  }

  /* Fehlende Felder nach Updates/Import ergänzen */
  function normalizeConfig(cfg) {
    const d = defaultConfig();
    if (!cfg || typeof cfg !== "object") return d;
    const out = Object.assign({}, d, cfg);
    out.settings = Object.assign({}, d.settings, cfg.settings || {});
    out.settings.categories = Object.assign({}, d.settings.categories, (cfg.settings || {}).categories || {});
    out.settings.storage = Object.assign({}, d.settings.storage, (cfg.settings || {}).storage || {});
    out.categoryPatterns = Object.assign({}, d.categoryPatterns, cfg.categoryPatterns || {});
    out.globalRules = (cfg.globalRules || []).map(r => newRule(r));
    out.sites = {};
    for (const [k, v] of Object.entries(cfg.sites || {})) {
      const s = Object.assign(defaultSiteConfig(), v);
      s.categories = Object.assign(defaultSiteConfig().categories, v.categories || {});
      s.rules = (v.rules || []).map(r => newRule(r));
      s.storage = Object.assign(defaultSiteStorage(), v.storage || {});
      s.storage.keyRules = (s.storage.keyRules || []).map(r => newKeyRule(r));
      out.sites[k] = s;
    }
    out.version = SCHEMA_VERSION;
    return out;
  }

  async function loadConfig() {
    const r = await browser.storage.local.get(CONFIG_KEY);
    return normalizeConfig(r[CONFIG_KEY]);
  }

  /* Speichert eine bereinigte Kopie (leere Seiten-Einträge entfallen); das übergebene Objekt bleibt unverändert. */
  async function saveConfig(cfg, beforeWrite) {
    const copy = JSON.parse(JSON.stringify(cfg));
    for (const [k, s] of Object.entries(copy.sites)) {
      if (isSiteConfigEmpty(s)) delete copy.sites[k];
    }
    // Aufrufer kann die eigene Speicherung vormerken, bevor storage.onChanged feuert
    if (beforeWrite) beforeWrite(JSON.stringify(copy));
    await browser.storage.local.set({ [CONFIG_KEY]: copy });
    return copy;
  }

  function isSiteConfigEmpty(s) {
    return s.defaultAction === "inherit" && s.tabClose === "inherit" && !s.note &&
      (!s.rules || s.rules.length === 0) &&
      Object.values(s.categories || {}).every(v => v === "inherit") &&
      isSiteStorageEmpty(s.storage);
  }

  function isSiteStorageEmpty(st) {
    if (!st) return true;
    return STORAGE_TYPES.every(t => !st[t] || st[t] === "inherit") && (!st.keyRules || !st.keyRules.length) && (st.keyDefault || "keep") === "keep";
  }

  function getSite(cfg, site, create) {
    if (!cfg.sites[site] && create) cfg.sites[site] = defaultSiteConfig();
    return cfg.sites[site] || null;
  }

  /* ------------------------------------------------------------------ */
  /* Domains / Seiten-Schlüssel                                          */
  /* ------------------------------------------------------------------ */

  // Kompakte Liste mehrteiliger Public Suffixes (kein vollständiger PSL – ergänzbar in den Einstellungen)
  const MULTI_SUFFIXES = new Set((
    "co.uk org.uk ac.uk gov.uk ltd.uk plc.uk me.uk net.uk sch.uk nhs.uk " +
    "com.au net.au org.au edu.au gov.au asn.au id.au co.nz org.nz net.nz govt.nz ac.nz " +
    "co.jp ne.jp or.jp ac.jp go.jp gr.jp co.kr or.kr ne.kr go.kr " +
    "com.br net.br org.br gov.br com.cn net.cn org.cn gov.cn edu.cn com.tw org.tw net.tw " +
    "com.hk org.hk net.hk com.sg org.sg edu.sg com.my co.id or.id co.th in.th " +
    "co.in net.in org.in gov.in ac.in firm.in gen.in co.za org.za gov.za " +
    "com.mx org.mx gob.mx com.ar gob.ar com.co com.pe com.ve com.uy com.ec " +
    "com.tr org.tr gov.tr co.il org.il ac.il gov.il com.ua org.ua kiev.ua com.pl net.pl org.pl " +
    "co.at or.at gv.at ac.at com.es org.es gob.es com.pt com.gr com.cy com.mt " +
    "com.sa com.eg com.ng com.pk com.ph com.vn com.bd co.ke " +
    "github.io gitlab.io herokuapp.com netlify.app vercel.app pages.dev workers.dev " +
    "blogspot.com appspot.com firebaseapp.com web.app azurewebsites.net cloudfront.net " +
    "s3.amazonaws.com myshopify.com wixsite.com webflow.io onrender.com fly.dev glitch.me " +
    "readthedocs.io translate.goog"
  ).split(/\s+/));

  let extraSuffixes = new Set();
  function setExtraSuffixes(text) {
    extraSuffixes = new Set(String(text || "").split(/[\s,]+/).map(s => s.trim().toLowerCase().replace(/^\./, "")).filter(Boolean));
  }

  function isIP(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");
  }

  function baseDomain(host) {
    if (!host) return "";
    host = String(host).toLowerCase().replace(/^\./, "").replace(/\.$/, "");
    if (host.startsWith("[")) return host;
    if (isIP(host) || !host.includes(".")) return host;
    const parts = host.split(".");
    // längsten passenden Suffix suchen (max. 3 Labels)
    for (let n = Math.min(3, parts.length - 1); n >= 2; n--) {
      const suf = parts.slice(-n).join(".");
      if (MULTI_SUFFIXES.has(suf) || extraSuffixes.has(suf)) {
        return parts.slice(-(n + 1)).join(".");
      }
    }
    for (const suf of extraSuffixes) {
      if (!suf.includes(".") && host.endsWith("." + suf) && parts.length >= 2) return parts.slice(-2).join(".");
    }
    return parts.slice(-2).join(".");
  }

  function hostFromUrl(url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") return "";
      return u.hostname;
    } catch (e) { return ""; }
  }

  function siteFromUrl(url) {
    const h = hostFromUrl(url);
    return h ? baseDomain(h) : "";
  }

  function cookieHost(c) { return String(c.domain || "").replace(/^\./, ""); }

  function partitionTopSite(c) {
    const t = c.partitionKey && c.partitionKey.topLevelSite;
    return t ? siteFromUrl(t) : "";
  }

  /* Seite, der ein Cookie zugeordnet wird:
   * - partitionierte Cookies (Total Cookie Protection / CHIPS): Top-Level-Seite der Partition
   * - sonst: Basisdomain des Cookies */
  function siteKeyForCookie(c) {
    return partitionTopSite(c) || baseDomain(cookieHost(c));
  }

  function isThirdParty(c) {
    const top = partitionTopSite(c);
    return !!top && top !== baseDomain(cookieHost(c));
  }

  function cookieId(c) {
    const pk = c.partitionKey && c.partitionKey.topLevelSite || "";
    return [c.storeId, c.domain, c.path, c.name, c.firstPartyDomain || "", pk].join("|");
  }

  function cookieUrl(c) {
    return (c.secure ? "https://" : "http://") + cookieHost(c) + (c.path || "/");
  }

  /* ------------------------------------------------------------------ */
  /* Pattern-Matching                                                    */
  /* ------------------------------------------------------------------ */

  const reCache = new Map();
  function globToRegex(glob) {
    const key = "g:" + glob;
    if (reCache.has(key)) return reCache.get(key);
    const src = "^" + String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
    const re = new RegExp(src, "i");
    reCache.set(key, re);
    return re;
  }

  function userRegex(str) {
    const key = "r:" + str;
    if (reCache.has(key)) return reCache.get(key);
    let re;
    const m = /^\/(.*)\/([a-z]*)$/.exec(str);
    try { re = m ? new RegExp(m[1], m[2]) : new RegExp(str, "i"); }
    catch (e) { re = null; }
    reCache.set(key, re);
    return re;
  }

  function validateRegex(str) {
    const m = /^\/(.*)\/([a-z]*)$/.exec(str);
    try { m ? new RegExp(m[1], m[2]) : new RegExp(str, "i"); return null; }
    catch (e) { return e.message; }
  }

  // Muster in Kategorielisten: Glob oder /regex/flags
  function patternMatches(pattern, value) {
    if (!pattern) return false;
    if (/^\/.*\/[a-z]*$/.test(pattern)) {
      const re = userRegex(pattern);
      return !!re && re.test(value);
    }
    return globToRegex(pattern).test(value);
  }

  function nameMatches(rule, name) {
    switch (rule.match) {
      case "exact": return rule.name === name;
      case "regex": { const re = userRegex(rule.name); return !!re && re.test(name); }
      default: return globToRegex(rule.name || "*").test(name);
    }
  }

  function ruleMatches(rule, c) {
    if (!rule.enabled) return false;
    if (!nameMatches(rule, c.name)) return false;
    if (rule.domain && !globToRegex(rule.domain).test(cookieHost(c))) return false;
    if (rule.path && !globToRegex(rule.path).test(c.path || "/")) return false;
    if (rule.store && rule.store !== c.storeId) return false;
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Klassifizierung & Auswertung                                        */
  /* ------------------------------------------------------------------ */

  function classify(c, cfg) {
    for (const cat of CATEGORIES) {
      const list = cfg.categoryPatterns[cat] || [];
      for (const p of list) {
        if (patternMatches(p, c.name)) return { category: cat, pattern: p };
      }
    }
    return { category: null, pattern: null };
  }

  function describeRule(r) {
    const parts = [`${r.match}:${r.name}`];
    if (r.domain) parts.push(`domain=${r.domain}`);
    if (r.path) parts.push(`path=${r.path}`);
    if (r.store) parts.push(`store=${r.store}`);
    return parts.join(" ");
  }

  /** Liefert {action, source, reason, ruleId, category, pattern, site} */
  function evaluate(c, cfg, siteOverride) {
    const site = siteOverride || siteKeyForCookie(c);
    const sc = cfg.sites[site];
    const cls = classify(c, cfg);
    const base = { site, category: cls.category, pattern: cls.pattern, ruleId: null };

    if (sc) {
      for (const r of sc.rules) {
        if (ruleMatches(r, c)) return Object.assign(base, { action: r.action, source: "site-rule", ruleId: r.id, reason: T("reason.siteRule", { rule: describeRule(r) }) });
      }
    }
    for (const r of cfg.globalRules) {
      if (ruleMatches(r, c)) return Object.assign(base, { action: r.action, source: "global-rule", ruleId: r.id, reason: T("reason.globalRule", { rule: describeRule(r) }) });
    }
    if (cls.category) {
      let a = sc ? sc.categories[cls.category] : "inherit";
      let from = T("reason.fromSite");
      if (!a || a === "inherit") { a = cfg.settings.categories[cls.category]; from = T("reason.fromGlobal"); }
      if (a && a !== "none") {
        return Object.assign(base, { action: a, source: "category", reason: T("reason.category", { category: CATEGORY_LABEL[cls.category], from, pattern: cls.pattern }) });
      }
    }
    if (sc && sc.defaultAction !== "inherit") {
      return Object.assign(base, { action: sc.defaultAction, source: "site-default", reason: T("reason.siteDefault") });
    }
    return Object.assign(base, { action: cfg.settings.defaultAction, source: "global-default", reason: T("reason.globalDefault") });
  }

  function effectiveTabClose(cfg, site) {
    const sc = cfg.sites[site];
    if (sc && sc.tabClose === "on") return true;
    if (sc && sc.tabClose === "off") return false;
    return !!cfg.settings.cleanOnTabClose;
  }

  /* ------------------------------------------------------------------ */
  /* Cookie-API Hilfen                                                   */
  /* ------------------------------------------------------------------ */

  let partitionSupported = true;
  async function getAllCookies() {
    const stores = await browser.cookies.getAllCookieStores();
    const out = [];
    for (const s of stores) {
      let list;
      if (partitionSupported) {
        try { list = await browser.cookies.getAll({ storeId: s.id, firstPartyDomain: null, partitionKey: {} }); }
        catch (e) { partitionSupported = false; }
      }
      if (!list) list = await browser.cookies.getAll({ storeId: s.id, firstPartyDomain: null });
      out.push(...list);
    }
    return out;
  }

  async function getCookiesForSite(site) {
    const all = await getAllCookies();
    return all.filter(c => siteKeyForCookie(c) === site);
  }

  async function removeCookie(c) {
    const details = { url: cookieUrl(c), name: c.name, storeId: c.storeId };
    if (c.firstPartyDomain !== undefined) details.firstPartyDomain = c.firstPartyDomain;
    if (c.partitionKey) details.partitionKey = c.partitionKey;
    return browser.cookies.remove(details);
  }

  async function getContainers() {
    const map = { "firefox-default": T("container.default"), "firefox-private": T("container.private") };
    try {
      if (browser.contextualIdentities) {
        const ids = await browser.contextualIdentities.query({});
        for (const i of ids || []) map[i.cookieStoreId] = i.name;
      }
    } catch (e) { /* Container deaktiviert */ }
    return map;
  }

  /* ------------------------------------------------------------------ */
  /* Formatierung                                                        */
  /* ------------------------------------------------------------------ */

  function fmtExpiry(c) {
    if (c.session || !c.expirationDate) return T("fmt.session");
    const ms = c.expirationDate * 1000 - Date.now();
    if (ms < 0) return T("fmt.expired");
    const d = ms / 86400000;
    if (d >= 365) return T("fmt.years", { n: (d / 365).toFixed(1) });
    if (d >= 1) return T("fmt.days", { n: Math.round(d) });
    const h = ms / 3600000;
    if (h >= 1) return T("fmt.hours", { n: Math.round(h) });
    return T("fmt.minutes", { n: Math.max(1, Math.round(ms / 60000)) });
  }

  function fmtDate(sec) {
    if (!sec) return "—";
    const d = new Date(sec * 1000);
    return d.toLocaleString(T("fmt.locale"));
  }

  function cookieSize(c) { return (c.name || "").length + (c.value || "").length; }

  /* ------------------------------------------------------------------ */
  /* Website-Daten (alles ausser Cookies)                                             */
  /* ------------------------------------------------------------------ */
  /* Löschen ganzer Speicherarten läuft über browsingData.remove({hostnames}).
   * Firefox gleicht Hostnamen exakt ab (keine Subdomains) → das Background-Skript
   * merkt sich alle Hosts, die zu einer Seite gesehen wurden.
   * Einzelne Einträge (local/sessionStorage) werden per Seitenskript beim Laden entfernt.
   * Cache Storage kennt browsingData nicht: Löschen per Skript in offenen Tabs, sonst beim
   * nächsten Aufruf des Hosts (registriertes Skript in der Welt MAIN, document_start). */

  const STORAGE_TYPES = ["localStorage", "sessionStorage", "indexedDB", "cacheStorage", "serviceWorkers", "cache"];
  /* Speicherarten, die als Ganzes gelöscht werden können (alle ausser sessionStorage) */
  const WHOLE_TYPES = ["localStorage", "indexedDB", "cacheStorage", "serviceWorkers", "cache"];
  /* davon über browsingData.remove({hostnames}) */
  const BROWSING_DATA_TYPES = ["localStorage", "indexedDB", "serviceWorkers", "cache"];
  const STORAGE_LABEL = labels("storage.", STORAGE_TYPES);
  const STORAGE_MODES = {
    localStorage: ["keep", "delete", "selective"],
    sessionStorage: ["keep", "selective"],
    indexedDB: ["keep", "delete"],
    cacheStorage: ["keep", "delete"],
    serviceWorkers: ["keep", "delete"],
    cache: ["keep", "delete"]
  };
  const MODE_LABEL = labels("mode.", ["keep", "delete", "selective", "inherit"]);
  const STORAGE_HELP = labels("storageHelp.", STORAGE_TYPES);

  function newKeyRule(partial) {
    return Object.assign({
      id: "k" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      enabled: true, store: "both", match: "glob", name: "*", action: "delete", note: ""
    }, partial || {});
  }

  function effectiveStorageMode(cfg, site, type) {
    const sc = cfg.sites[site];
    const v = sc && sc.storage && sc.storage[type];
    if (v && v !== "inherit") return v;
    return (cfg.settings.storage || {})[type] || "keep";
  }

  function keyRuleMatches(r, store, key) {
    if (!r.enabled) return false;
    if (r.store !== "both" && r.store !== store) return false;
    return nameMatches(r, key);
  }

  /* store: "local" | "session" → {action: keep|delete, reason, ruleId} */
  function evalKey(cfg, site, store, key) {
    const type = store === "local" ? "localStorage" : "sessionStorage";
    const mode = effectiveStorageMode(cfg, site, type);
    if (mode === "keep") return { action: "keep", reason: T("reason.modeKeep") };
    if (mode === "delete") return { action: "delete", reason: T("reason.wholeType", { type }) };
    const st = (cfg.sites[site] || {}).storage || defaultSiteStorage();
    for (const r of st.keyRules || []) {
      if (keyRuleMatches(r, store, key)) return { action: r.action, ruleId: r.id, reason: T("reason.keyRule", { rule: r.match + ":" + r.name }) };
    }
    return { action: st.keyDefault || "keep", reason: T("reason.keyDefault") };
  }

  /* Speicherarten, die bei einer Bereinigung dieser Seite komplett gelöscht werden */
  function storageDeleteTypes(cfg, site) {
    return WHOLE_TYPES.filter(t => effectiveStorageMode(cfg, site, t) === "delete");
  }

  /* Regeln für das Seitenskript, oder null wenn nichts selektiv ist */
  function pageKeyRules(cfg, site) {
    const st = (cfg.sites[site] || {}).storage;
    const pick = (type, store) => {
      if (effectiveStorageMode(cfg, site, type) !== "selective") return null;
      return {
        def: (st && st.keyDefault) || "keep",
        rules: ((st && st.keyRules) || []).filter(r => r.enabled && (r.store === "both" || r.store === store))
          .map(r => ({ match: r.match, name: r.name, action: r.action }))
      };
    };
    const R = { local: pick("localStorage", "local"), session: pick("sessionStorage", "session") };
    return (R.local || R.session) ? R : null;
  }

  /* Läuft als Content-Script in der Seite (eigenständig, keine Abhängigkeiten). */
  function pageKeyCleaner(R) {
    try {
      var esc = function (p) { return p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, "."); };
      var test = function (r, k) {
        if (r.match === "exact") return r.name === k;
        if (r.match === "regex") {
          var x = /^\/(.*)\/([a-z]*)$/.exec(r.name);
          try { return (x ? new RegExp(x[1], x[2]) : new RegExp(r.name, "i")).test(k); } catch (e) { return false; }
        }
        return new RegExp("^" + esc(r.name || "*") + "$", "i").test(k);
      };
      var removed = { local: [], session: [] };
      var apply = function (s, name, cfg) {
        if (!cfg || !s) return;
        var keys = [];
        for (var i = 0; i < s.length; i++) keys.push(s.key(i));
        keys.forEach(function (k) {
          var a = cfg.def;
          for (var j = 0; j < cfg.rules.length; j++) { if (test(cfg.rules[j], k)) { a = cfg.rules[j].action; break; } }
          if (a === "delete") { s.removeItem(k); removed[name].push(k); }
        });
      };
      apply(window.localStorage, "local", R.local);
      apply(window.sessionStorage, "session", R.session);
      if ((removed.local.length || removed.session.length) && typeof browser !== "undefined" && R.log) {
        browser.runtime.sendMessage({ cmd: "logKeys", host: location.host, removed: removed, trigger: R.trigger || "page-load" });
      }
      return { local: removed.local.length, session: removed.session.length, removed: removed };
    } catch (e) { return { error: String(e) }; }
  }

  function pageKeyCleanerCode(R) {
    return "(" + pageKeyCleaner.toString() + ")(" + JSON.stringify(R) + ");";
  }

  /* Liest den Speicher einer offenen Seite (Content-Script-Kontext, best effort für IDB/Cache/SW) */
  function inspectCode() {
    return "(" + (async function () {
      var dump = function (s) {
        var o = [];
        try {
          for (var i = 0; i < s.length; i++) {
            var k = s.key(i), v = String(s.getItem(k));
            o.push({ k: k, v: v.length > 4000 ? v.slice(0, 4000) + "…" : v, size: k.length + v.length });
          }
        } catch (e) {}
        return o;
      };
      var out = { origin: location.origin, host: location.host, local: dump(window.localStorage), session: dump(window.sessionStorage), idb: null, caches: null, sw: null, estimate: null };
      var W = window.wrappedJSObject || window;
      try { var dbs = await W.indexedDB.databases(); out.idb = Array.from(dbs).map(function (d) { return { name: String(d.name), version: Number(d.version) }; }); } catch (e) { out.idbErr = String(e); }
      try { var ks = await W.caches.keys(); out.caches = Array.from(ks).map(String); } catch (e) {}
      try { var regs = await W.navigator.serviceWorker.getRegistrations(); out.sw = Array.from(regs).map(function (r) { return String(r.scope); }); } catch (e) {}
      try { var est = await W.navigator.storage.estimate(); out.estimate = { usage: Number(est.usage), quota: Number(est.quota) }; } catch (e) {}
      return JSON.parse(JSON.stringify(out));
    }).toString() + ")();";
  }

  function removeKeysCode(store, keys) {
    return "(" + (function (store, keys) {
      var s = store === "local" ? window.localStorage : window.sessionStorage, n = 0;
      keys.forEach(function (k) { if (s.getItem(k) !== null) { s.removeItem(k); n++; } });
      return n;
    }).toString() + ")(" + JSON.stringify(store) + "," + JSON.stringify(keys) + ");";
  }

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return "—";
    if (n < 1024) return n + " B";
    if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
    if (n < 1073741824) return (n / 1048576).toFixed(1) + " MB";
    return (n / 1073741824).toFixed(2) + " GB";
  }

  /* ------------------------------------------------------------------ */
  /* Archiv                                                              */
  /* ------------------------------------------------------------------ */
  /* Eintrag: { aid, key, site, savedAt, note, autoRestore, cookie }
   *   key         = cookieId des Cookies (gleiches Cookie → mehrere Versionen)
   *   autoRestore = diese Version wird beim Browserstart wiederhergestellt
   *                 (pro key höchstens eine Version)                       */

  const ARCHIVE_KEY = "cc_archive";
  const COOKIE_FIELDS = ["name", "value", "domain", "hostOnly", "path", "secure", "httpOnly", "sameSite",
    "session", "expirationDate", "storeId", "firstPartyDomain", "partitionKey"];

  function cleanCookie(c) {
    const o = {};
    for (const f of COOKIE_FIELDS) if (c[f] !== undefined) o[f] = c[f];
    return JSON.parse(JSON.stringify(o));
  }

  async function loadArchive() {
    const r = await browser.storage.local.get(ARCHIVE_KEY);
    return Array.isArray(r[ARCHIVE_KEY]) ? r[ARCHIVE_KEY] : [];
  }

  async function saveArchive(list) {
    await browser.storage.local.set({ [ARCHIVE_KEY]: list });
  }

  function newArchiveEntry(c, note) {
    return {
      aid: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      key: cookieId(c), site: siteKeyForCookie(c), savedAt: Date.now(),
      note: note || "", autoRestore: false, cookie: cleanCookie(c)
    };
  }

  /* Fügt Versionen hinzu. Identische Version (Wert + Ablauf + Flags) zur neuesten wird übersprungen.
   * Pro Cookie bleiben maxVersions Versionen; Autostart-Versionen werden nie automatisch entfernt. */
  function addToArchive(list, cookies, note, maxVersions) {
    let added = 0, skipped = 0;
    for (const c of cookies) {
      const entry = newArchiveEntry(c, note);
      // neueste zuerst; bei gleicher Zeit entscheidet die Einfügereihenfolge
      const versions = list.map((e, i) => [e, i]).filter(([e]) => e.key === entry.key)
        .sort((a, b) => (b[0].savedAt - a[0].savedAt) || (b[1] - a[1])).map(([e]) => e);
      const latest = versions[0];
      if (latest && sameCookieContent(latest.cookie, entry.cookie)) { skipped++; continue; }
      list.push(entry);
      added++;
      const max = Math.max(1, Number(maxVersions) || 5);
      const all = [entry, ...versions];
      let keep = 0;
      for (const v of all) {
        if (v.autoRestore) continue;
        keep++;
        if (keep > max) list.splice(list.indexOf(v), 1);
      }
    }
    return { added, skipped };
  }

  function sameCookieContent(a, b) {
    return a.value === b.value && a.expirationDate === b.expirationDate && a.secure === b.secure &&
      a.httpOnly === b.httpOnly && a.sameSite === b.sameSite && a.path === b.path;
  }

  function setAutoRestore(list, aid, on) {
    const e = list.find(x => x.aid === aid);
    if (!e) return;
    if (on) for (const x of list) if (x.key === e.key) x.autoRestore = false; // nur eine Version pro Cookie
    e.autoRestore = !!on;
  }

  /* Status eines Archiv-Eintrags gegenüber dem aktuellen Cookie-Bestand */
  function archiveStatus(entry, currentById) {
    const cur = currentById.get(entry.key);
    if (!cur) return "missing";
    return cur.value === entry.cookie.value ? "same" : "differs";
  }

  /* Details für cookies.set() aus einem archivierten Cookie.
   * extendDays: abgelaufene Cookies so viele Tage verlängern (0 = als Sitzungscookie setzen). */
  function restoreDetails(c, extendDays) {
    const d = {
      url: cookieUrl(c), name: c.name, value: c.value, path: c.path || "/",
      secure: !!c.secure, httpOnly: !!c.httpOnly, storeId: c.storeId
    };
    if (!c.hostOnly) d.domain = c.domain;
    if (c.sameSite) d.sameSite = c.sameSite;
    if (c.sameSite === "no_restriction") d.secure = true;
    if (c.firstPartyDomain !== undefined) d.firstPartyDomain = c.firstPartyDomain;
    if (c.partitionKey) d.partitionKey = c.partitionKey;
    const now = Date.now() / 1000;
    if (!c.session && c.expirationDate) {
      if (c.expirationDate > now + 60) d.expirationDate = c.expirationDate;
      else if (Number(extendDays) > 0) d.expirationDate = Math.floor(now + Number(extendDays) * 86400);
      // sonst: kein expirationDate → Sitzungscookie
    }
    return d;
  }

  /* Kurzbeschreibung einer Konfigurationsänderung (für Rückgängig/Wiederholen) */
  const SETTING_LABEL = labels("setting.", ["defaultAction", "cleanOnTabClose", "tabCloseDelaySec", "cleanOnStartup",
    "periodicMinutes", "skipOpenSites", "enforceBlock", "badge", "logEnabled", "logMax", "extraSuffixes", "categories",
    "restoreOnStartup", "restoreExtendDays", "archiveMaxVersions", "storage"]);
  function describeConfigChange(a, b) {
    a = a || {}; b = b || {};
    const J = x => JSON.stringify(x === undefined ? null : x);
    const parts = [];
    const sa = a.settings || {}, sb = b.settings || {};
    const changedSettings = [...new Set([...Object.keys(sa), ...Object.keys(sb)])].filter(k => J(sa[k]) !== J(sb[k]));
    if (changedSettings.length) parts.push(T("change.settings", { list: changedSettings.map(k => SETTING_LABEL[k] || k).join(", ") }));
    if (J(a.globalRules) !== J(b.globalRules)) parts.push(T("change.globalRules"));
    if (J(a.categoryPatterns) !== J(b.categoryPatterns)) parts.push(T("change.patterns"));
    const xa = a.sites || {}, xb = b.sites || {};
    const changedSites = [...new Set([...Object.keys(xa), ...Object.keys(xb)])].filter(k => J(xa[k]) !== J(xb[k]));
    if (changedSites.length === 1) {
      const k = changedSites[0], o = xa[k] || defaultSiteConfig(), n = xb[k] || defaultSiteConfig();
      const what = J(o.rules) !== J(n.rules) ? "rules" : o.defaultAction !== n.defaultAction ? "default"
        : o.tabClose !== n.tabClose ? "tabClose" : J(o.categories) !== J(n.categories) ? "categories"
        : J(o.storage) !== J(n.storage) ? "storage" : o.note !== n.note ? "note" : "config";
      parts.push(T("change.site", { site: k, what: T("change." + what) }));
    } else if (changedSites.length > 1) parts.push(T("change.sites", { n: changedSites.length }));
    return parts.join(" · ") || T("change.config");
  }

  function fmtAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return T("fmt.justNow");
    if (s < 3600) return T("fmt.minutes", { n: Math.round(s / 60) });
    if (s < 86400) return T("fmt.hours", { n: Math.round(s / 3600) });
    return T("fmt.days", { n: Math.round(s / 86400) });
  }

  root.CC = {
    ARCHIVE_KEY, loadArchive, saveArchive, newArchiveEntry, addToArchive, setAutoRestore, archiveStatus,
    restoreDetails, cleanCookie, fmtAgo, describeConfigChange,
    STORAGE_TYPES, WHOLE_TYPES, BROWSING_DATA_TYPES, STORAGE_LABEL, STORAGE_MODES, STORAGE_HELP, MODE_LABEL, defaultSiteStorage, isSiteStorageEmpty, newKeyRule,
    effectiveStorageMode, keyRuleMatches, evalKey, storageDeleteTypes, pageKeyRules, pageKeyCleanerCode, inspectCode, removeKeysCode, fmtBytes,
    CONFIG_KEY, LOG_KEY, ACTIONS, ACTION_LABEL, CATEGORIES, CATEGORY_LABEL, DEFAULT_PATTERNS,
    defaultConfig, defaultSiteConfig, newRule, normalizeConfig, loadConfig, saveConfig, getSite, isSiteConfigEmpty,
    baseDomain, hostFromUrl, siteFromUrl, setExtraSuffixes, cookieHost, siteKeyForCookie, isThirdParty,
    partitionTopSite, cookieId, cookieUrl,
    globToRegex, validateRegex, patternMatches, ruleMatches, classify, evaluate, describeRule, effectiveTabClose,
    getAllCookies, getCookiesForSite, removeCookie, getContainers,
    fmtExpiry, fmtDate, cookieSize
  };
})(typeof self !== "undefined" ? self : this);
