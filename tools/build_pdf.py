"""Erzeugt das PDF der Dokumentation aus den Markdown-Kapiteln in docs/.

    pip install markdown playwright && python -m playwright install chromium
    npm install -g @mermaid-js/mermaid-cli      (für die Diagramme; sonst wird npx verwendet)
    python tools/build_pdf.py [AUSGABE.pdf]     (Standard: Cookie-Curator-Dokumentation.pdf im Hauptordner)

Das PDF liegt nicht im Repository: .github/workflows/wiki.yml erzeugt es bei jeder Änderung an
docs/ und legt es ins Wiki (Download über die Seitenleiste und die Startseite des Wikis).
"""
import re, os, subprocess, base64, html, sys, json, shutil, tempfile, datetime
from pathlib import Path
import markdown
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DOCS = str(ROOT / "docs")
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else str(ROOT / "Cookie-Curator-Dokumentation.pdf")
W = tempfile.mkdtemp(prefix="cc-pdf-")
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
TODAY = datetime.date.today().strftime("%d.%m.%Y")
MMDC = [shutil.which("mmdc")] if shutil.which("mmdc") else [shutil.which("npx") or "npx", "-y", "@mermaid-js/mermaid-cli"]
files = ["README.md"] + sorted(f for f in os.listdir(DOCS) if re.match(r"\d\d-.*\.md$", f))
idx = {f: i for i, f in enumerate(files)}

def gh_slug(t):
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).strip().lower()
    t = re.sub(r"[^\w\- ]", "", t)
    return t.replace(" ", "-")

n_mmd = 0
def mermaid(code):
    global n_mmd
    n_mmd += 1
    src = os.path.join(W, f"m{n_mmd}.mmd"); dst = os.path.join(W, f"m{n_mmd}.svg")
    open(src, "w", encoding="utf-8").write(code)
    cfg = os.path.join(W, "mcfg.json")
    open(cfg, "w", encoding="utf-8").write('{"theme":"neutral","themeVariables":{"fontFamily":"DejaVu Sans","fontSize":"14px"},"flowchart":{"htmlLabels":false}}')
    # Chrome für die Diagramme ohne Sandbox: als root (Container) startet er sonst nicht, und auf
    # Ubuntu ab 23.10 (GitHub-Runner) sperrt AppArmor die dafür nötigen User-Namespaces. Gerendert
    # werden nur die eigenen Diagramme aus docs/, keine fremden Seiten.
    pcfg = os.path.join(W, "pcfg.json")
    open(pcfg, "w", encoding="utf-8").write('{"args":["--no-sandbox"]}')
    subprocess.run(MMDC + ["-i", src, "-o", dst, "-c", cfg, "-b", "white", "-q", "-p", pcfg], check=True)
    svg = open(dst, "rb").read()
    return f'<div class="diagram"><img src="data:image/svg+xml;base64,{base64.b64encode(svg).decode()}"/></div>'

chapters = []
toc = []
for f in files:
    n = idx[f]
    s = open(os.path.join(DOCS, f), encoding="utf-8").read()
    # Mermaid → Bild
    s = re.sub(r"```mermaid\n(.*?)```", lambda m: "\n" + mermaid(m.group(1)) + "\n", s, flags=re.S)
    # Links zwischen Dateien → interne Sprungmarken
    def link(m):
        text, target, anchor = m.group(1), m.group(2), m.group(3)
        if target and target not in idx: return m.group(0)
        k = idx[target] if target else n
        return f"[{text}](#c{k}-{anchor})" if anchor else f"[{text}](#c{k})"
    s = re.sub(r"\[([^\]]+)\]\(([0-9A-Za-z\-]+\.md)?(?:#([^)]+))?\)", lambda m: link(m) if (m.group(2) or m.group(3)) else m.group(0), s)
    body = markdown.markdown(s, extensions=["tables", "fenced_code", "toc", "sane_lists"],
                             extension_configs={"toc": {"slugify": lambda v, sep: gh_slug(v)}})
    body = re.sub(r'<h(\d) id="([^"]*)"', lambda m: f'<h{m.group(1)} id="c{n}-{m.group(2)}"', body)
    h1 = re.search(r"<h1[^>]*>(.*?)</h1>", body)
    title = re.sub(r"<[^>]+>", "", h1.group(1)) if h1 else f
    if n == 0: title = "Übersicht"
    toc.append((n, title))
    chapters.append(f'<section class="chapter" id="c{n}">{body}</section>')

css = """
@page { size: A4; margin: 18mm 16mm 18mm 16mm; }
body { font-family: 'DejaVu Sans', 'Segoe UI', Arial, sans-serif; font-size: 9.6pt; line-height: 1.45; color: #1f2328; }
h1 { font-size: 20pt; border-bottom: 2px solid #c2410c; padding-bottom: 4px; margin-top: 0; }
h2 { font-size: 14pt; margin-top: 18px; border-bottom: 1px solid #d0d7de; padding-bottom: 2px; break-after: avoid; }
h3 { font-size: 11.5pt; margin-top: 14px; break-after: avoid; }
h4 { font-size: 10pt; break-after: avoid; }
.chapter { break-before: page; }
code { font-family: 'DejaVu Sans Mono', Consolas, monospace; font-size: 8.4pt; background: #f3f4f6; padding: 0 3px; border-radius: 3px; }
pre { background: #f6f8fa; border: 1px solid #d0d7de; border-radius: 4px; padding: 7px 9px; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 7.9pt; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 8.4pt; }
th, td { border: 1px solid #d0d7de; padding: 3px 6px; vertical-align: top; text-align: left; }
th { background: #f6f8fa; }
tr { break-inside: avoid; }
td code { word-break: break-word; }
blockquote { border-left: 3px solid #c2410c; margin: 8px 0; padding: 2px 10px; color: #444; background: #fff7ed; }
a { color: #0b5cad; text-decoration: none; }
hr { border: none; border-top: 1px solid #d0d7de; margin: 12px 0; }
.diagram { text-align: center; margin: 10px 0; break-inside: avoid; }
.diagram img { max-width: 92%; max-height: 165mm; }
.cover { height: 250mm; display: flex; flex-direction: column; justify-content: center; }
.cover h1 { font-size: 30pt; border: none; }
.cover .sub { font-size: 13pt; color: #555; }
.cover .meta { margin-top: 30px; color: #555; }
.toc { break-before: page; }
.toc ol { font-size: 11pt; line-height: 1.9; }
"""
cover = f"""<div class="cover"><h1>Cookie Curator</h1>
<div class="sub">Technische Dokumentation – Aufbau, Designentscheidungen und Firefox-Interna</div>
<div class="meta">Version {VERSION} · getestet mit Firefox 140 ESR<br/>Stand: {TODAY}</div></div>"""
tocl = "".join(f'<li><a href="#c{n}">{html.escape(t)}</a></li>' for n, t in toc)
doc = f'<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Cookie Curator – Technische Dokumentation</title><style>{css}</style></head><body>{cover}<div class="toc"><h1>Inhalt</h1><ol start="0">{tocl}</ol></div>{"".join(chapters)}</body></html>'
open(os.path.join(W, "doc.html"), "w", encoding="utf-8").write(doc)
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    pg.goto(Path(W, "doc.html").as_uri()); pg.wait_for_timeout(500)
    pg.pdf(path=OUT, format="A4", print_background=True, display_header_footer=True,
           header_template="<span></span>",
           footer_template='<div style="font-size:7pt;color:#777;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:DejaVu Sans"><span>Cookie Curator – Technische Dokumentation</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
           margin={"top": "16mm", "bottom": "18mm", "left": "16mm", "right": "16mm"}, outline=True, tagged=True)
    b.close()
shutil.rmtree(W, ignore_errors=True)
print(OUT, n_mmd, "Diagramme")
