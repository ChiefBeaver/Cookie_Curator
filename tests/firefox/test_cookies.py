"""Cookies: Bereinigung beim Tab-Schliessen, Blockieren, Schnellregel."""
import time
from common import HTTP

PAGE = HTTP + "/index.html?noinit"


def tab_close(h):
    page = h.new_tab(PAGE)
    h.drv.execute_script('document.cookie="sessionid=abc; path=/; max-age=9999"; document.cookie="_ga=GA1.1.1; path=/; max-age=9999"; document.cookie="OptanonConsent=x; path=/; max-age=9999"')
    h.new_tab(); h.ext("settings")
    h.js("const c=await CC.loadConfig(); c.settings.tabCloseDelaySec=0; await CC.saveConfig(c); return 1"); time.sleep(0.8)
    h.drv.switch_to.window(page); h.drv.close()
    h.drv.switch_to.window(h.drv.window_handles[-1]); time.sleep(2)
    names = h.js("return (await CC.getCookiesForSite('localhost')).map(c=>c.name).sort()")
    h.check(names == ["OptanonConsent", "sessionid"], f"Tracking gelöscht, Login und Consent behalten: {names}")
    log = h.bg({"cmd": "getLog"})
    h.check(any(e["name"] == "_ga" and e["trigger"] == "tab-close" for e in log), "Protokoll: _ga beim Tab-Schliessen")


def block(h):
    h.ext("rules")
    h.js("const c=await CC.loadConfig(); c.globalRules.push(CC.newRule({match:'glob',name:'blockme*',action:'block'})); await CC.saveConfig(c); return 1"); time.sleep(0.8)
    h.new_tab(PAGE)
    h.drv.execute_script('document.cookie="blockme_1=x; path=/; max-age=9999"; document.cookie="harmless=1; path=/; max-age=9999"')
    time.sleep(1)
    left = h.drv.execute_script("return document.cookie")
    h.check("blockme_1" not in left and "harmless" in left, f"geblocktes Cookie sofort entfernt: {left!r}")


def quick_rule_popup_editor(h):
    h.new_tab(PAGE)
    h.drv.execute_script('document.cookie="_gid=1; path=/; max-age=9999"')
    h.ext("site/localhost", 2.5)
    sel = [r for r in h.drv.find_elements("css selector", "table.cookie-table tr.ck") if "_gid" in r.text][0].find_element("css selector", "select.quick")
    from selenium.webdriver.support.ui import Select
    Select(sel).select_by_value("keep"); time.sleep(0.8)
    rules = h.js("return (await CC.loadConfig()).sites['localhost'].rules.map(r=>r.name+':'+r.action+':'+!!r.quick)")
    h.check(rules == ["_gid:keep:true"], f"Schnellregel gespeichert: {rules}")
    ev = h.js("const c=(await CC.getCookiesForSite('localhost')).find(c=>c.name==='_gid'); return CC.evaluate(c, await CC.loadConfig()).action")
    h.check(ev == "keep", "Entscheidung jetzt Behalten")
    h.screenshot("ff-seiten-editor")


TESTS = [
    ("Bereinigung beim Tab-Schliessen", tab_close, {}),
    ("Blockieren", block, {}),
    ("Schnellregel im Seiten-Editor", quick_rule_popup_editor, {}),
]
