"""Gemeinsame Testumgebung für die Firefox-Integrationstests.

* startet einen HTTP-Server (http://localhost:8765) und einen HTTPS-Server (https://<name>.test:8443)
  mit selbst erzeugtem Zertifikat für die Testseiten in ./site,
* startet Firefox über Selenium/geckodriver und installiert das Add-on als temporäres Add-on,
* stellt Hilfsfunktionen bereit (Nachrichten an den Hintergrund, Konfiguration ändern, Prüfungen).

Firefox und geckodriver findet Selenium selbst (Selenium Manager). Abweichend:
  Umgebungsvariable FIREFOX_BIN   Pfad zu firefox(.exe)
  Umgebungsvariable GECKODRIVER   Pfad zu geckodriver(.exe)
"""
import datetime, http.server, ipaddress, json, os, shutil, ssl, tempfile, threading, time
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

HERE = Path(__file__).resolve().parent
ADDON = HERE.parent.parent                 # Hauptordner des Add-ons (enthält manifest.json)
SITE = HERE / "site"
OUT = HERE.parent / "output"
UUID = "11111111-2222-3333-4444-555555555555"
EXT = f"moz-extension://{UUID}"
HTTP_PORT, HTTPS_PORT = 8765, 8443
TEST_DOMAINS = "nzz.test,static-nzz.test,host-a.test"
HTTP = f"http://localhost:{HTTP_PORT}"


class SkipTest(Exception):
    """Test kann in dieser Umgebung nicht laufen (z. B. Firefox-Funktion fehlt)."""


# ---------------------------------------------------------------- Server

class _Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(SITE), **kw)

    def end_headers(self):
        # setc.html: zusätzlich Cookies per HTTP-Header (für Partitionierungs-Tests)
        if self.path.startswith("/setc"):
            self.send_header("Set-Cookie", "__cf_bm=srv123; Path=/; Secure; HttpOnly; SameSite=None")
            self.send_header("Set-Cookie", "keep_me=1; Path=/; Secure; SameSite=None; Max-Age=9999")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *a):
        pass


def _make_cert(directory):
    """Selbstsigniertes Zertifikat für localhost und die *.test-Namen (nur für Tests)."""
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "cookie-curator-test")])
    sans = [x509.DNSName(n) for n in ["localhost", *TEST_DOMAINS.split(",")]] + [x509.IPAddress(ipaddress.ip_address("127.0.0.1"))]
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now - datetime.timedelta(days=1))
            .not_valid_after(now + datetime.timedelta(days=30)).add_extension(x509.SubjectAlternativeName(sans), False)
            .sign(key, hashes.SHA256()))
    c, k = Path(directory) / "cert.pem", Path(directory) / "key.pem"
    c.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    k.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.TraditionalOpenSSL, serialization.NoEncryption()))
    return c, k


class Servers:
    def __enter__(self):
        self.tmp = tempfile.mkdtemp(prefix="cc-test-")
        self.http = http.server.ThreadingHTTPServer(("127.0.0.1", HTTP_PORT), _Handler)
        self.https = http.server.ThreadingHTTPServer(("127.0.0.1", HTTPS_PORT), _Handler)
        cert, key = _make_cert(self.tmp)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(str(cert), str(key))
        self.https.socket = ctx.wrap_socket(self.https.socket, server_side=True)
        for s in (self.http, self.https):
            threading.Thread(target=s.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *a):
        for s in (self.http, self.https):
            s.shutdown(); s.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)


# ---------------------------------------------------------------- Firefox

class Harness:
    """Eine Firefox-Instanz mit installiertem Add-on und Hilfsfunktionen für einen Test."""

    def __init__(self, headed=False, prefs=None, width=1600, height=1100):
        o = Options()
        if os.environ.get("FIREFOX_BIN"):
            o.binary_location = os.environ["FIREFOX_BIN"]
        if not headed:
            o.add_argument("-headless")
        # Erlaubt WebDriver den Zugriff auf privilegierte Seiten: ab etwa Firefox 15x nötig, um
        # moz-extension://-Seiten (Dashboard) zu öffnen, und für den Chrome-Kontext (Firefox-Interna).
        o.add_argument("-remote-allow-system-access")
        o.accept_insecure_certs = True
        base = {
            "extensions.webextensions.uuids": json.dumps({"cookie-curator@chief-beaver.com": UUID}),
            "network.dns.localDomains": TEST_DOMAINS,          # *.test → 127.0.0.1
            "network.proxy.type": 0,
            "browser.shell.checkDefaultBrowser": False,
        }
        base.update(prefs or {})
        for k, v in base.items():
            o.set_preference(k, v)
        args = ["--allow-system-access"]                       # Gegenstück in geckodriver
        service = Service(os.environ["GECKODRIVER"], service_args=args) if os.environ.get("GECKODRIVER") else Service(service_args=args)
        self.drv = webdriver.Firefox(options=o, service=service)
        self.drv.set_window_size(width, height)
        self.drv.install_addon(str(ADDON), temporary=True)
        self.ok = True
        self.results = []

    def quit(self):
        try:
            self.drv.quit()
        except Exception:
            pass

    # Prüfungen ---------------------------------------------------
    def check(self, cond, msg):
        cond = bool(cond)
        print(("    OK    " if cond else "    FAIL  ") + msg)
        self.results.append((cond, msg))
        self.ok = self.ok and cond
        return cond

    # Navigation --------------------------------------------------
    def open(self, url, wait=1.5):
        self.drv.get(url)
        time.sleep(wait)

    def new_tab(self, url=None, wait=1.5):
        self.drv.switch_to.new_window("tab")
        if url:
            self.open(url, wait)
        return self.drv.current_window_handle

    def ext(self, route="help", wait=1.5):
        """Dashboard der Erweiterung öffnen (dort sind browser.* und CC verfügbar)."""
        self.open(f"{EXT}/options/options.html#{route}", wait)

    def wait_text(self, by_id, not_text="init", timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            try:
                t = self.drv.find_element(By.ID, by_id).text
                if t != not_text:
                    return t
            except Exception:
                pass
            time.sleep(0.25)
        return None

    # Erweiterung -------------------------------------------------
    def bg(self, msg):
        """Nachricht an den Hintergrund (nur aus einer Erweiterungsseite heraus)."""
        r = self.drv.execute_async_script(
            "const d=arguments[arguments.length-1]; browser.runtime.sendMessage(arguments[0])"
            ".then(r=>d(JSON.stringify(r===undefined?null:r))).catch(e=>d(JSON.stringify({__err:String(e)})))", msg)
        return json.loads(r)

    def js(self, body):
        """Asynchrones JavaScript in der aktuellen Seite; `return` liefert das Ergebnis."""
        return self.drv.execute_async_script(
            "const d=arguments[arguments.length-1]; (async()=>{" + body + "})().then(r=>d(r===undefined?null:r), e=>d({__err:String(e)}))")

    def site_config(self, site, js_body):
        """Seitenkonfiguration ändern: js_body bekommt c (Konfiguration) und s (Seite)."""
        self.js(f"const c=await CC.loadConfig(); const s=CC.getSite(c,{json.dumps(site)},true); {js_body}; await CC.saveConfig(c); return 1")
        time.sleep(0.8)

    def screenshot(self, name):
        OUT.mkdir(parents=True, exist_ok=True)
        self.drv.save_screenshot(str(OUT / f"{name}.png"))
