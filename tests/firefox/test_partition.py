"""Partitionierte Drittanbieter-Cookies und Partitionsschlüssel im alten Format (siehe docs/06)."""
import time
from selenium.common.exceptions import WebDriverException
from common import HTTPS_PORT, SkipTest

NZZ = f"https://nzz.test:{HTTPS_PORT}"
HOST_A = f"https://host-a.test:{HTTPS_PORT}"
SNAP = "return (await CC.getAllCookies()).filter(c=>c.domain.includes('nzz.test')).map(c=>c.name+'@'+c.domain.replace(/^\\./,'')+(c.partitionKey?'[P]':'')).sort()"


def third_party(h):
    h.new_tab(HOST_A + "/embed.html", 2.5)
    h.new_tab(); h.ext()
    rows = h.js("return (await CC.getAllCookies()).filter(c=>c.partitionKey && c.domain.includes('nzz.test')).map(c=>CC.siteKeyForCookie(c))")
    h.check(rows and set(rows) == {"host-a.test"}, f"eingebettete Cookies sind partitioniert und gehören zu host-a.test: {rows}")
    h.ext("site/host-a.test", 2)
    h.check(len(h.drv.find_elements("css selector", "table.cookie-table tr.ck")) >= 4, "Seiten-Editor zeigt die Drittanbieter-Cookies")


def legacy_key(h):
    """Cookies mit altem Partitionsschlüssel erzeugen, dann Firefox-Standard wiederherstellen und löschen."""
    h.new_tab(NZZ + "/index.html?noinit", 1)
    h.drv.execute_script('document.cookie="login=firstparty; path=/; max-age=9999; Secure"')
    h.open(HOST_A + "/embed.html", 2.5)
    try:
        with h.drv.context(h.drv.CONTEXT_CHROME):
            h.drv.execute_script('Services.prefs.setBoolPref("privacy.dynamic_firstparty.use_site", true)')
    except WebDriverException as e:
        raise SkipTest("Chrome-Kontext nicht verfügbar (Firefox ohne -remote-allow-system-access?): " + str(e)[:120])
    h.new_tab(); h.ext("help")
    before = h.js(SNAP)
    h.ext("site/host-a.test", 2)
    # alle __cf_bm-Zeilen auswählen; jedes Häkchen zeichnet die Tabelle neu, darum per Skript und mit Wartezeit
    for _ in range(4):
        n = h.drv.execute_script("""const r=[...document.querySelectorAll('table.cookie-table tr.ck')]
            .find(r=>r.textContent.includes('__cf_bm') && !r.querySelector('input[type=checkbox]').checked);
            if (r) { r.querySelector('input[type=checkbox]').click(); return 1; } return 0;""")
        time.sleep(0.5)
        if not n:
            break

    def click(text):
        for _ in range(10):
            try:
                [b for b in h.drv.find_elements("css selector", ".cookies .toolbar.bulk button") if b.text.strip() == text][0].click()
                return True
            except Exception:
                time.sleep(0.25)
        return False
    click("Löschen"); time.sleep(0.3); click("2 löschen?"); time.sleep(3)
    toast = h.drv.execute_script("const t=document.getElementById('cc-toast');return t?t.className+': '+t.textContent:''")
    after = h.js(SNAP)
    h.check(after == sorted(x for x in before if not x.startswith("__cf_bm@")), f"nur __cf_bm gelöscht, Rest unverändert: {after}")
    h.check("err" not in toast and "warn" not in toast, f"keine Fehlermeldung: {toast!r}")


TESTS = [
    ("Drittanbieter-Cookies der Top-Level-Seite zugeordnet", third_party, {}),
    ("Löschen trotz altem Partitionsschlüssel (Regression 0.6.0)", legacy_key,
     {"system_access": True, "prefs": {"privacy.dynamic_firstparty.use_site": False, "network.cookie.cookieBehavior": 5}}),
]
