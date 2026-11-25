"""Website-Daten: Live-Ansicht, Einzelaktionen, Eintragsregeln beim Laden, Löschen pro Host."""
import time
from common import HTTP


def live_and_items(h):
    page = h.new_tab(HTTP + "/")
    h.check(h.wait_text("s") == "ready", "Testseite hat IndexedDB, Caches und Service Worker angelegt")
    h.new_tab(); h.ext("site/localhost", 2.5)
    d = h.bg({"cmd": "inspectStorage", "site": "localhost"}).get("data") or {}
    idb = {x["name"]: x for x in d.get("idb") or []}
    h.check(idb.get("appdata", {}).get("records") == 6 and len(idb["appdata"]["stores"]) == 2, "IndexedDB appdata: 2 Stores, 6 Einträge")
    h.check(idb.get("analytics-queue", {}).get("records") == 12, "IndexedDB analytics-queue: 12 Einträge")
    cs = {x["name"]: x for x in d.get("caches") or []}
    h.check(cs.get("static-v2", {}).get("count") == 2, "Cache static-v2: 2 Einträge")
    h.check(len(d.get("sw") or []) == 1 and d["sw"][0]["state"] == "activated", "Service Worker aktiv")
    card = h.drv.find_element("css selector", ".storage-card").text
    h.check("analytics-queue" in card and "users" in card and "activated" in card, "Oberfläche zeigt Datenbanken, Stores, SW-Status")
    h.screenshot("ff-website-daten")
    bg = lambda op, *args: h.bg({"cmd": "storageItem", "site": "localhost", "op": op, "args": list(args)})
    h.check(bg("clearIdbStore", "appdata", "users").get("ok"), "Store appdata/users geleert")
    h.check(bg("deleteCacheEntry", "static-v2", HTTP + "/a.css").get("ok"), "Cache-Eintrag gelöscht")
    h.check(bg("deleteCache", "images-v1").get("ok"), "Cache images-v1 gelöscht")
    h.check(bg("unregisterSw", HTTP + "/").get("ok"), "Service Worker abgemeldet")
    d = h.bg({"cmd": "inspectStorage", "site": "localhost"})["data"]
    h.check({x["name"]: x["records"] for x in d["idb"]}.get("appdata") == 1, "appdata jetzt 1 Eintrag")
    h.check({c["name"]: c["count"] for c in d["caches"]} == {"static-v2": 1}, "nur noch static-v2 mit 1 Eintrag")
    h.check(d["sw"] == [], "keine Service Worker mehr")


def entry_rules_on_load(h):
    page = h.new_tab(HTTP + "/?noinit")
    h.drv.execute_script("localStorage.setItem('theme','dark'); localStorage.setItem('_ga_x','1'); sessionStorage.setItem('_ga_s','1')")
    h.new_tab(); h.ext("site/localhost")
    h.site_config("localhost", "s.storage.localStorage='selective'; s.storage.sessionStorage='selective'; s.storage.keyRules=[CC.newKeyRule({match:'glob',name:'_ga*',action:'delete'})]")
    ext = h.drv.current_window_handle
    h.drv.switch_to.window(page); h.open(HTTP + "/?noinit", 2)
    keys = h.drv.execute_script("return [Object.keys(localStorage).sort(), Object.keys(sessionStorage).sort()]")
    h.check(keys == [["theme"], []], f"beim Laden entfernt (local, session): {keys}")
    h.drv.switch_to.window(ext)
    log = h.bg({"cmd": "getLog"})
    h.check(any(e["trigger"] == "page-load" and e["name"] == "_ga_x" for e in log), "Protokoll enthält page-load-Löschung")


def delete_per_host(h):
    page = h.new_tab(HTTP + "/")
    h.wait_text("s")
    h.new_tab(); h.ext("site/localhost")
    ext = h.drv.current_window_handle
    h.site_config("localhost", "s.storage.indexedDB='delete'; s.storage.localStorage='delete'")
    h.bg({"cmd": "cleanStorage", "site": "localhost"}); time.sleep(1)
    h.drv.switch_to.window(page); h.open(HTTP + "/?noinit", 1)
    dbs = h.js("return (await indexedDB.databases()).map(d=>d.name)")
    ls = h.drv.execute_script("return Object.keys(localStorage)")
    h.check(dbs == [] and ls == [], f"IndexedDB und localStorage per browsingData gelöscht: {dbs} {ls}")


TESTS = [
    ("Live-Ansicht und Einzelaktionen (Welt MAIN)", live_and_items, {}),
    ("Eintragsregeln beim Laden (document_start)", entry_rules_on_load, {}),
    ("Löschen pro Host über browsingData", delete_per_host, {}),
]
