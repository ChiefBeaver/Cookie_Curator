/* Cookie Curator – Übersetzungen (global I18N)
 *
 * Jede Sprache liegt in einer eigenen Datei locales/<code>.js und meldet sich dort mit
 * I18N.register("<code>", { key: "Text", … }) an. Geladen wird nur die aktive Sprache
 * (plus die Ersatzsprache Englisch), und zwar bei I18N.init().
 *
 * Neue Sprache hinzufügen:
 *   1. locales/en.js nach locales/<code>.js kopieren und die Texte übersetzen
 *   2. hier in LANGUAGES eine Zeile ergänzen
 *   3. optional: locales/help/en.js nach locales/help/<code>.js kopieren, übersetzen und den
 *      Code hier in EXTRAS.help eintragen (sonst erscheint die englische Hilfe)
 *
 * Texte:
 *   I18N.t("key")                     → Text
 *   I18N.t("key", { name: "x" })      → "{name}" im Text wird ersetzt
 *   I18N.t("key", { n: 3 })           → mit n wird "key_one"/"key_other" (Intl.PluralRules) gewählt,
 *                                        falls vorhanden, sonst "key"
 *   Ein Wert kann auch eine Funktion (params) => Text sein.
 * Fehlt ein Text in der aktiven Sprache, wird Englisch verwendet, danach der Schlüssel selbst.
 *
 * Die gewählte Sprache liegt in storage.local unter "cc_lang" (nicht in cc_config, damit der
 * Sprachwechsel nicht im Verlauf für Rückgängig landet).
 */
(function (root) {
  "use strict";

  /* code → Name der Sprache in dieser Sprache selbst; die Reihenfolge ist die des Sprachknopfs */
  const LANGUAGES = {
    de: "Deutsch",
    en: "English"
  };
  /* Sprache, solange keine gewählt wurde */
  const DEFAULT = "de";
  /* Zusatzdateien locales/<name>/<code>.js: für welche Sprachen es sie gibt (siehe loadExtra) */
  const EXTRAS = {
    help: ["en", "de"]
  };
  /* Ersatz für Texte, die in einer Sprache fehlen (en.js ist die Vorlage für neue Sprachen) */
  const FALLBACK = "en";
  const STORAGE_KEY = "cc_lang";

  const dicts = {};
  const listeners = [];
  let lang = DEFAULT;
  let plural = null;

  function register(code, dict) {
    dicts[code] = Object.assign(dicts[code] || {}, dict);
  }

  function lookup(code, key) {
    const d = dicts[code];
    return d && Object.prototype.hasOwnProperty.call(d, key) ? d[key] : undefined;
  }

  function find(key) {
    for (const code of [lang, FALLBACK]) {
      const v = lookup(code, key);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  function t(key, params) {
    let v;
    if (params && typeof params.n === "number") {
      if (!plural || plural.lang !== lang) {
        try { plural = { lang, rules: new Intl.PluralRules(lang) }; } catch (e) { plural = { lang, rules: null }; }
      }
      const form = plural.rules ? plural.rules.select(params.n) : (params.n === 1 ? "one" : "other");
      v = find(key + "_" + form);
      if (v === undefined) v = find(key + "_other");
    }
    if (v === undefined) v = find(key);
    if (v === undefined) return key;
    if (typeof v === "function") return v(params || {});
    if (!params) return v;
    return v.replace(/\{(\w+)\}/g, (m, k) => (k in params && params[k] != null ? String(params[k]) : m));
  }

  function languages() {
    return Object.entries(LANGUAGES).map(([code, name]) => ({ code, name }));
  }

  function normalize(code) {
    if (!code) return null;
    code = String(code).toLowerCase();
    if (LANGUAGES[code]) return code;
    const base = code.split(/[-_]/)[0];
    return LANGUAGES[base] ? base : null;
  }

  /* Lädt locales/<code>.js, falls die Sprache noch nicht angemeldet ist.
   * Standard: <script>-Element (Popup, Dashboard und Hintergrundseite haben ein document).
   * Tests können mit setLoader() einen eigenen Lader setzen. */
  let loader = function (code) {
    return new Promise((resolve, reject) => {
      const doc = root.document;
      if (!doc) return reject(new Error("no document to load locale " + code));
      const s = doc.createElement("script");
      s.src = root.browser.runtime.getURL("locales/" + code + ".js");
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("could not load locale " + code));
      (doc.head || doc.documentElement).append(s);
    });
  };
  function setLoader(fn) { loader = fn; }

  /* jede Sprachdatei höchstens einmal laden, auch wenn sie gleichzeitig mehrfach verlangt wird
   * (z. B. Englisch als gewählte Sprache und als Ersatz) */
  const loading = new Map();
  function ensure(code) {
    if (dicts[code]) return Promise.resolve();
    if (!loading.has(code)) {
      loading.set(code, Promise.resolve().then(() => loader(code)).catch(e => console.warn("[Cookie Curator]", e)));
    }
    return loading.get(code);
  }

  /* Zusätzliche, grössere Texte, die nur eine Oberfläche braucht (z. B. die Hilfe):
   * lädt locales/<name>/<code>.js für die aktive Sprache und Englisch. Fehlt die Datei
   * einer Sprache, greift wie bei t() die englische. */
  const loadedExtras = new Map();
  function loadExtra(name) {
    const codes = [...new Set([lang, FALLBACK])].filter(c => (EXTRAS[name] || []).includes(c));
    return Promise.all(codes.map(code => {
      const path = name + "/" + code;
      if (!loadedExtras.has(path)) {
        loadedExtras.set(path, Promise.resolve().then(() => loader(path)).catch(e => console.warn("[Cookie Curator]", e)));
      }
      return loadedExtras.get(path);
    }));
  }

  /* Synchron, wenn die Sprache schon angemeldet ist (z. B. in Tests), sonst nach dem Laden */
  function setLang(code) {
    code = normalize(code) || DEFAULT;
    if (dicts[code] && dicts[FALLBACK]) { activate(code); return Promise.resolve(); }
    return Promise.all([ensure(code), ensure(FALLBACK)]).then(() => activate(code));
  }

  function activate(code) {
    const changed = code !== lang;
    lang = code;
    if (root.document && root.document.documentElement) root.document.documentElement.lang = code;
    if (changed) for (const fn of listeners.slice()) { try { fn(code); } catch (e) { console.error(e); } }
  }

  function getLang() { return lang; }

  /* Gewählte Sprache lesen (sonst DEFAULT) und Änderungen verfolgen */
  let initPromise = null;
  function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      let stored = null;
      try { stored = (await root.browser.storage.local.get(STORAGE_KEY))[STORAGE_KEY]; } catch (e) {}
      await setLang(normalize(stored) || DEFAULT);
      try {
        root.browser.storage.onChanged.addListener((changes, area) => {
          if (area === "local" && changes[STORAGE_KEY]) setLang(changes[STORAGE_KEY].newValue);
        });
      } catch (e) {}
    })();
    return initPromise;
  }

  /* Sprache wählen und speichern (alle offenen Oberflächen und die Hintergrundseite folgen) */
  async function choose(code) {
    code = normalize(code) || DEFAULT;
    // erst speichern: setLang benachrichtigt die Seiten, und die laden sich daraufhin neu
    await root.browser.storage.local.set({ [STORAGE_KEY]: code });
    await setLang(code);
  }

  /* Nächste Sprache in der Reihenfolge von LANGUAGES (für den Sprachknopf) */
  function next() {
    const codes = Object.keys(LANGUAGES);
    return codes[(codes.indexOf(lang) + 1) % codes.length];
  }

  function onChange(fn) { listeners.push(fn); }

  /* Statische Texte in HTML: data-i18n="key" (Inhalt), data-i18n-title="key" (Tooltip) */
  function apply(scope) {
    const r = scope || root.document;
    for (const e of r.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
    for (const e of r.querySelectorAll("[data-i18n-title]")) e.title = t(e.dataset.i18nTitle);
  }

  root.I18N = {
    LANGUAGES, EXTRAS, DEFAULT, FALLBACK, STORAGE_KEY,
    register, t, languages, normalize, setLoader, setLang, getLang, init, choose, next, onChange, apply, loadExtra,
    has: key => find(key) !== undefined
  };
})(typeof self !== "undefined" ? self : this);
