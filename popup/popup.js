"use strict";
(async function () {
  const { el } = UI;
  await I18N.init();
  I18N.apply();
  I18N.onChange(() => location.reload());
  document.getElementById("lang-slot").append(UI.languageButton());
  const cfg = await CC.loadConfig();
  CC.setExtraSuffixes(cfg.settings.extraSuffixes);

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const site = tab ? CC.siteFromUrl(tab.url || "") : "";
  const main = document.getElementById("main");
  document.getElementById("history-slot").append(UI.historyButtons({ compact: true }));
  CCTables.observe(main);
  const title = document.getElementById("title");

  document.getElementById("open-dash").addEventListener("click", () => {
    const url = browser.runtime.getURL("options/options.html") + (site ? "#site/" + encodeURIComponent(site) : "");
    browser.tabs.create({ url });
    window.close();
  });

  if (!site) {
    main.append(el("div", { class: "nosite" },
      el("p", {}, I18N.t("popup.noSite")),
      el("p", {}, I18N.t("popup.noSiteHint"))));
    return;
  }

  const host = CC.hostFromUrl(tab.url);
  title.textContent = "";
  title.append(I18N.t("popup.cookiesFor"), el("code", {}, site), host !== site ? el("span", { class: "dim", style: "font-weight:400;font-size:12px" }, "  (" + host + ")") : null);

  const editor = new UI.SiteEditor(main, { site, compact: true });
  await editor.init();
})();
