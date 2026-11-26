/* Cookie Curator – Tab „Funktionsweise“ (Rahmen)
 * Der Inhalt steht pro Sprache in locales/help/<code>.js und wird erst beim Öffnen des Tabs
 * geladen. Fehlt eine Sprache, wird die englische Hilfe angezeigt.
 *
 * Jede Hilfedatei meldet sich mit I18N.register("<code>", { "help.content": h => ({ … }) }) an.
 * Die Funktion bekommt die Bausteine unten (h.P, h.B, h.TABLE, …) und liefert:
 *   { addon: [Kapitel …], basics: [Kapitel …],
 *     text: { tocAddon, tocBasics, titleAddon, introAddon, titleBasics, introBasics } }
 * Ein Kapitel entsteht mit h.CH(id, Titel, …Inhalt); das Inhaltsverzeichnis wird daraus erzeugt.
 */
(function (root) {
  "use strict";

  function helpers() {
    const { el } = UI;
    return {
      el,
      P: (...k) => el("p", {}, ...k),
      C: t => el("code", {}, t),
      B: t => el("b", {}, t),
      I: t => el("i", {}, t),
      H4: t => el("h4", {}, t),
      UL: (...items) => el("ul", {}, items.map(i => el("li", {}, ...[].concat(i)))),
      OL: (...items) => el("ol", {}, items.map(i => el("li", {}, ...[].concat(i)))),
      PRE: t => el("pre", { class: "codeblock" }, t),
      NOTE: (...k) => el("div", { class: "callout" }, ...k),
      TABLE: (head, rows) => el("div", { class: "table-scroll help-table" }, el("table", { class: "grid" },
        el("thead", {}, el("tr", {}, head.map(h => el("th", {}, h)))),
        el("tbody", {}, rows.map(r => el("tr", {}, r.map(c => el("td", {}, ...[].concat(c)))))))),
      GLOSSARY: entries => el("dl", { class: "glossary" }, entries.map(([t, d]) => [el("dt", {}, t), el("dd", {}, d)])),
      CH: (id, title, ...content) => el("section", { class: "help-chapter", id: "h-" + id }, el("h3", {}, title), ...content)
    };
  }

  function fill(box, content) {
    const { el } = UI;
    const t = content.text;
    const toc = (title, sections) => el("div", { class: "toc-col" }, el("b", {}, title),
      el("ol", {}, sections.map(s => el("li", {}, el("a", {
        href: "#", onclick: e => { e.preventDefault(); s.scrollIntoView({ behavior: "smooth", block: "start" }); }
      }, s.querySelector("h3").textContent)))));
    box.append(
      el("div", { class: "card toc" }, toc(t.tocAddon, content.addon), toc(t.tocBasics, content.basics)),
      el("div", { class: "card" }, el("h2", {}, t.titleAddon), el("p", { class: "hint" }, t.introAddon), ...content.addon),
      el("div", { class: "card" }, el("h2", {}, t.titleBasics), el("p", { class: "hint" }, t.introBasics), ...content.basics));
  }

  function buildHelp() {
    const box = UI.el("div", { class: "help" });
    I18N.loadExtra("help").then(() => {
      const content = I18N.t("help.content", helpers());
      if (content && typeof content === "object") fill(box, content);
    });
    return box;
  }

  root.buildHelp = buildHelp;
})(typeof self !== "undefined" ? self : this);
