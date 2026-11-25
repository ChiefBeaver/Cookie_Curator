"""Cache Storage (ab 0.7): sofort in offenen Tabs, sonst beim nächsten Aufruf."""
import json, time
from common import HTTP

PAGE = HTTP + "/index.html?noinit"


def _mk(h, name):
    return h.js(f"const c=await caches.open({json.dumps(name)}); await c.put('/x', new Response('hallo')); return await caches.keys()")


def _keys(h):
    return h.js("return await caches.keys()")


def firefox_behaviour(h):
    """Belegt die Firefox-Grenze: browsingData indexedDB lässt Cache Storage stehen."""
    page = h.new_tab(PAGE); _mk(h, "c1")
    h.drv.close(); h.drv.switch_to.window(h.drv.window_handles[0])
    h.ext()
    h.bg({"cmd": "deleteStorageNow", "site": "localhost", "type": "indexedDB"})
    h.new_tab(PAGE)
    h.check(_keys(h) == ["c1"], "browsingData(indexedDB) löscht Cache Storage nicht (deshalb eigener Weg)")


def open_tab_now(h):
    page = h.new_tab(PAGE); _mk(h, "c1")
    h.new_tab(); h.ext()
    h.bg({"cmd": "deleteStorageNow", "site": "localhost", "type": "cacheStorage"})
    h.drv.switch_to.window(page)
    h.check(_keys(h) == [], "offener Tab: sofort gelöscht, ohne Neuladen")


def next_visit(h):
    page = h.new_tab(PAGE); _mk(h, "c2")
    h.drv.close(); h.drv.switch_to.window(h.drv.window_handles[0]); h.ext()
    h.bg({"cmd": "deleteStorageNow", "site": "localhost", "type": "cacheStorage"}); time.sleep(0.6)
    pend = h.bg({"cmd": "cachePurgePending", "site": "localhost"})
    h.check("localhost" in pend, f"vorgemerkt: {pend}")
    reg = h.js("return (await browser.scripting.getRegisteredContentScripts()).map(x=>({id:x.id,m:x.matches,w:x.world}))")
    h.check(any(r["id"] == "cc-cache-purge" and r["w"] == "MAIN" for r in reg), f"Skript registriert: {reg}")
    ext = h.drv.current_window_handle
    page = h.new_tab(PAGE)
    h.check(_keys(h) == [], "beim nächsten Aufruf gelöscht")
    h.drv.switch_to.window(ext); time.sleep(0.6)
    h.check("localhost" not in h.bg({"cmd": "cachePurgePending", "site": "localhost"}), "danach ausgetragen")
    h.drv.switch_to.window(page); _mk(h, "c3"); h.drv.refresh(); time.sleep(1.5)
    h.check(_keys(h) == ["c3"], "neuer Cache bleibt danach erhalten")


def policy_tab_close(h):
    page = h.new_tab(PAGE); _mk(h, "c4")
    h.new_tab(); h.ext()
    h.js("const c=await CC.loadConfig(); c.settings.tabCloseDelaySec=0; await CC.saveConfig(c); return 1")
    h.site_config("localhost", "s.storage.cacheStorage='delete'; s.tabClose='on'")
    ext = h.drv.current_window_handle
    h.drv.switch_to.window(page); h.drv.close(); h.drv.switch_to.window(ext); time.sleep(2)
    log = h.bg({"cmd": "getLog"})
    h.check(any(e["name"].startswith("Cache Storage") and e["trigger"] == "tab-close" for e in log), "Bereinigung beim Tab-Schliessen protokolliert")
    h.new_tab(PAGE)
    h.check(_keys(h) == [], "Cache nach Wiederaufruf weg")


def purge_site(h):
    page = h.new_tab(PAGE); _mk(h, "c5")
    h.new_tab(); h.ext()
    r = h.bg({"cmd": "purgeSite", "site": "localhost", "removeConfig": True})
    h.drv.switch_to.window(page)
    h.check(_keys(h) == [] and any("Cache Storage" in x for x in r["data"]), f"„Alles löschen“ entfernt Cache Storage: {r['data']}")


TESTS = [
    ("Firefox-Grenze belegt", firefox_behaviour, {}),
    ("offener Tab: sofort", open_tab_now, {}),
    ("geschlossene Seite: beim nächsten Aufruf", next_visit, {}),
    ("Richtlinie Löschen beim Tab-Schliessen", policy_tab_close, {}),
    ("Alles löschen", purge_site, {}),
]
