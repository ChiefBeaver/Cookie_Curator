"""Oberfläche in echtem Firefox: Zwei-Klick-Bestätigung trotz Neuzeichnen, Spaltenbreiten, „Alles löschen“."""
import time
from selenium.webdriver.common.action_chains import ActionChains
from common import HTTP

SITE = "testpartition.example"


def _set(h):
    h.js("""for (const dom of ['nzz.ch','static-nzz.ch']) await browser.cookies.set({url:'https://'+dom+'/', domain:'.'+dom, name:'__cf_bm',
            value:'v'+Date.now(), secure:true, httpOnly:true, sameSite:'no_restriction', partitionKey:{topLevelSite:'https://""" + SITE + """'}}); return 1""")


def _count(h):
    return h.js("return (await CC.getAllCookies()).filter(c=>c.name==='__cf_bm').length")


def _click(h, sel, text):
    """Knopf mit genau diesem Text (oder für den die Funktion text(...) True liefert) klicken.
    Wiederholt, weil die Tabelle bei Cookie-Änderungen neu gezeichnet wird."""
    match = text if callable(text) else (lambda t: t == text)
    for _ in range(12):
        try:
            [b for b in h.drv.find_elements("css selector", sel) if match(b.text.strip())][0].click()
            return True
        except Exception:
            time.sleep(0.25)
    return False


def _labels(h):
    return h.drv.execute_script("return [...document.querySelectorAll('.cookies .toolbar button')].map(b=>b.textContent)")


def confirm_survives_rerender(h):
    h.ext(); _set(h)
    h.ext("site/" + SITE, 2)
    _click(h, ".cookies .toolbar button", "Alle löschen"); time.sleep(0.2)
    h.js("await browser.cookies.set({url:'https://nzz.ch/', name:'other', value:'1', secure:true, sameSite:'no_restriction', partitionKey:{topLevelSite:'https://" + SITE + "'}}); return 1")
    # warten, bis die Tabelle mit dem neuen Cookie neu gezeichnet ist (Knopf zeigt dann 3)
    armed = []
    for _ in range(20):
        armed = [l for l in _labels(h) if l.startswith("Alle") and l.endswith("?")]
        if any("3" in l for l in armed):
            break
        time.sleep(0.2)
    h.check(any("3" in l for l in armed), f"nach dem Neuzeichnen weiter scharf: {armed}")
    _click(h, ".cookies .toolbar button", lambda t: t.startswith("Alle") and t.endswith("?")); time.sleep(2.2)
    h.check(_count(h) == 0, "Cookies gelöscht")


def reset_warning(h):
    h.ext(); _set(h)
    h.ext("site/" + SITE, 2)
    # simuliert eine Seite, die gelöschte Cookies sofort wieder setzt
    h.drv.execute_script("browser.cookies.onChanged.addListener(i=>{ if(i.removed && i.cookie.name==='__cf_bm' && i.cause==='explicit') setTimeout(()=>browser.cookies.set({url:'https://'+i.cookie.domain.replace(/^\\./,'')+'/', domain:i.cookie.domain, name:'__cf_bm', value:'neu', secure:true, httpOnly:true, sameSite:'no_restriction', partitionKey:i.cookie.partitionKey}),150) });")
    _click(h, ".cookies .toolbar button", "Alle löschen"); time.sleep(0.2)
    _click(h, ".cookies .toolbar button", lambda t: t.startswith("Alle") and t.endswith("?")); time.sleep(2.5)
    t = h.drv.execute_script("const t=document.getElementById('cc-toast');return t&&t.className.includes('show')?t.className+': '+t.textContent:null")
    h.check(t and "warn" in t and "sofort wieder gesetzt" in t and "err" not in t, f"nur orange Meldung „sofort wieder gesetzt“: {t}")


def tables_and_purge(h):
    page = h.new_tab(HTTP + "/?noinit")
    h.drv.execute_script("for (let i=0;i<12;i++) localStorage.setItem('sehr-langer-eintragsname-'+i, JSON.stringify({x:'y'.repeat(300)})); document.cookie='a=1; path=/; max-age=999'")
    h.new_tab(); h.ext("site/localhost", 3)
    tbl = lambda: h.drv.find_element("css selector", ".storage-card .keyblock table")
    th = lambda: tbl().find_elements("css selector", "thead th")[1]
    w0 = th().rect["width"]
    h.drv.execute_script("arguments[0].scrollIntoView({block:'center'})", th()); time.sleep(0.3)
    ActionChains(h.drv).click_and_hold(th().find_element("css selector", ".cc-col-resize")).move_by_offset(-150, 0).release().perform(); time.sleep(0.3)
    w1 = th().rect["width"]
    h.check(w1 < w0 - 100, f"Spalte schmaler gezogen: {w0:.0f} → {w1:.0f} px")
    h.drv.refresh(); time.sleep(3)
    h.check(abs(th().rect["width"] - w1) < 3, "Breite nach Neuladen gemerkt")
    h.drv.set_window_size(1000, 1000); time.sleep(0.6)
    over = h.drv.execute_script("const de=document.documentElement; return de.scrollWidth-de.clientWidth")
    h.check(over <= 0, f"schmales Fenster: Seite ohne seitlichen Überstand ({over})")
    h.drv.set_window_size(1600, 1100)
    ext = h.drv.current_window_handle
    h.drv.switch_to.window(page); h.drv.close(); h.drv.switch_to.window(ext)
    h.site_config("localhost", "s.note='Test'")
    h.ext("sites", 2)
    row = lambda: [r for r in h.drv.find_elements("css selector", ".overview tbody tr")
                   if any(td.text.startswith("localhost") for td in r.find_elements("css selector", "td.site"))]
    h.check(row(), "localhost in der Übersicht")
    [b for b in row()[0].find_elements("css selector", "button") if b.text == "Alles löschen"][0].click(); time.sleep(0.3)
    [b for b in row()[0].find_elements("css selector", "button") if "Wirklich" in b.text][0].click(); time.sleep(2.5)
    h.check(not row(), "nach „Alles löschen“ aus der Übersicht verschwunden")
    left = h.js("return {cookies:(await CC.getCookiesForSite('localhost')).length, config: !!(await CC.loadConfig()).sites['localhost']}")
    h.check(left == {"cookies": 0, "config": False}, f"Cookies und Konfiguration entfernt: {left}")


TESTS = [
    ("Zwei-Klick-Bestätigung übersteht Neuzeichnen", confirm_survives_rerender, {}),
    ("Hinweis, wenn Cookies sofort wieder gesetzt werden", reset_warning, {}),
    ("Spaltenbreiten und „Alles löschen“ in der Übersicht", tables_and_purge, {"width": 1700, "height": 1100}),
]
