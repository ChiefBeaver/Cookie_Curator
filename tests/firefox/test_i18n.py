"""Sprachen in echtem Firefox: Standard Deutsch, Sprachknopf, alle offenen Fenster und der
Hintergrund folgen, Hilfe pro Sprache, Sprachdateien über moz-extension:// geladen."""
import time
from common import HTTP

PAGE = HTTP + "/index.html?noinit"


def _lang_button(h):
    return h.drv.find_element("css selector", "#lang-slot button")


def _nav_help(h):
    return h.drv.find_element("css selector", "#nav a[data-route=help]").text


def _badge_title(h, tab_url_part):
    """Tooltip des Toolbar-Symbols für den Tab mit dieser Adresse (setzt der Hintergrund)."""
    return h.js("const [t]=(await browser.tabs.query({})).filter(t=>t.url.includes(" + repr(tab_url_part) + "));"
                "return t ? browser.browserAction.getTitle({tabId:t.id}) : null")


def default_and_switch(h):
    # Firefox läuft hier englisch; ohne Wahl ist die Oberfläche trotzdem deutsch
    page = h.new_tab(PAGE)
    h.drv.execute_script('document.cookie="_ga=GA1.1.1; path=/; max-age=9999"; document.cookie="sessionid=1; path=/; max-age=9999"')
    h.new_tab(); h.ext("sites", 2)
    dash = h.drv.current_window_handle
    h.check(h.js("return navigator.language").startswith("en"), "Firefox selbst ist englisch")
    h.check(_lang_button(h).text == "DE" and _nav_help(h) == "Funktionsweise", "Standard: Deutsch")
    h.check(h.js("return (await browser.storage.local.get('cc_lang')).cc_lang || null") is None, "noch keine Sprache gespeichert")

    # zweites Fenster der Erweiterung (Popup-Seite) offen lassen: muss dem Wechsel folgen
    h.new_tab(f"{h.drv.current_url.split('/options/')[0]}/popup/popup.html", 2)
    popup = h.drv.current_window_handle
    h.check("Dashboard" in h.drv.page_source and h.drv.find_element("id", "lang-slot").text == "DE", "Popup-Seite deutsch")

    # Hintergrund: Tooltip des Symbols und Begründungen deutsch
    h.drv.switch_to.window(page); time.sleep(1.5)
    h.drv.switch_to.window(dash)
    t = _badge_title(h, "localhost")
    h.check(t and t.endswith("1 wird bei Bereinigung gelöscht"), f"Tooltip des Symbols deutsch (Einzahl): {t!r}")
    reasons = [x["reason"] for x in h.bg({"cmd": "cleanSite", "site": "localhost", "dryRun": True})]
    h.check(any("Kategorie Tracking" in r for r in reasons), f"Begründung deutsch: {reasons}")

    # Wechsel per Knopf im Dashboard
    _lang_button(h).click(); time.sleep(2)
    h.check(h.js("return (await browser.storage.local.get('cc_lang')).cc_lang") == "en", "Wahl gespeichert (cc_lang = en)")
    h.check(_lang_button(h).text == "EN" and _nav_help(h) == "How it works", "Dashboard englisch")
    h.check(h.js("return document.documentElement.lang") == "en", "<html lang> englisch")

    h.drv.switch_to.window(popup); time.sleep(0.5)
    h.check(h.drv.find_element("id", "lang-slot").text == "EN", "anderes offenes Fenster (Popup-Seite) ist mitgewechselt")

    # Hintergrund folgt ohne Neustart
    h.drv.switch_to.window(page); h.drv.refresh(); time.sleep(1.5)
    h.drv.switch_to.window(dash)
    t = _badge_title(h, "localhost")
    h.check(t and "will be deleted on cleanup" in t, f"Tooltip des Symbols englisch: {t!r}")
    reasons = [x["reason"] for x in h.bg({"cmd": "cleanSite", "site": "localhost", "dryRun": True})]
    h.check(any("Category Tracking" in r for r in reasons), f"Begründung englisch: {reasons}")
    hist = h.bg({"cmd": "historyState"})
    h.check(hist["undo"] == 0, "Sprachwechsel landet nicht im Verlauf für Rückgängig")

    # bleibt nach Neuladen erhalten, zurück auf Deutsch
    h.ext("sites", 2)
    h.check(_lang_button(h).text == "EN", "nach Neuladen weiter englisch")
    _lang_button(h).click(); time.sleep(2)
    h.check(_lang_button(h).text == "DE" and _nav_help(h) == "Funktionsweise", "zurück auf Deutsch")
    h.screenshot("ff-sprache")


def help_per_language(h):
    h.ext("help", 2.5)
    first = lambda: h.drv.find_element("css selector", ".help h2").text
    chapters = lambda: len(h.drv.find_elements("css selector", ".help .toc li"))
    h.check(first() == "A · Wie dieses Add-on funktioniert", f"Hilfe deutsch: {first()!r}")
    n = chapters()
    h.check(n >= 18, f"Inhaltsverzeichnis deutsch: {n} Kapitel")
    h.js("await I18N.choose('en'); return 1"); time.sleep(2.5)
    h.check(first() == "A · How this add-on works", f"Hilfe englisch: {first()!r}")
    h.check(chapters() == n, "gleiche Kapitel auf Englisch")
    # die Sprachdateien kommen über moz-extension:// (kein Ladefehler in der Konsole des Dashboards)
    loaded = h.js("return [...document.scripts].map(s=>s.src.replace(/^.*\\/locales\\//,'locales/')).filter(s=>s.startsWith('locales/')).sort()")
    h.check(loaded == ["locales/en.js", "locales/help/en.js"], f"Sprachdateien je einmal geladen: {loaded}")


TESTS = [
    ("Standard Deutsch, Sprachknopf, Fenster und Hintergrund folgen", default_and_switch, {}),
    ("Hilfe pro Sprache", help_per_language, {}),
]
