"""Grenzwerte von Firefox, auf die sich die Dokumentation stützt (docs/06, Abschnitt 6.9)."""
from common import HTTP, EXT


def limits(h):
    h.new_tab(HTTP + "/?noinit")
    r = h.drv.execute_script("""
      document.cookie = "longlived=1; max-age=" + (10*365*24*3600) + "; path=/";
      document.cookie = "big=" + "a".repeat(5000) + "; path=/";
      const big = document.cookie.includes("big=");
      let ls = 0; try { localStorage.clear(); const ch = "x".repeat(1024*256); for (let i=0;i<200;i++){ localStorage.setItem("k"+i, ch); ls = i+1; } } catch(e) {}
      localStorage.clear();
      return {big: big, lsMB: ls * 0.25};""")
    h.check(not r["big"], "Cookie über 4 KB wird abgelehnt")
    h.check(4 <= r["lsMB"] <= 10, f"localStorage-Grenze etwa 5 MB pro Origin: {r['lsMB']} MB")
    h.new_tab(); h.ext()
    days = h.js("const x=await browser.cookies.getAll({domain:'localhost', firstPartyDomain:null, partitionKey:{}}); return x.filter(c=>c.name==='longlived').map(c=>Math.round((c.expirationDate-Date.now()/1000)/86400))")
    h.check(days and days[0] <= 400, f"Laufzeit auf höchstens 400 Tage gekürzt: {days}")


TESTS = [("Grenzwerte", limits, {})]
