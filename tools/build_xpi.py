"""Erzeugt cookie-curator.xpi im Hauptordner (nur die Dateien, die das Add-on braucht).

    python tools/build_xpi.py
"""
import json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ["manifest.json", "background.js", "lib", "ui", "popup", "options", "icons", "page", "LICENSE"]

version = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "cookie-curator.xpi"
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for part in PARTS:
        p = ROOT / part
        files = [p] if p.is_file() else sorted(x for x in p.rglob("*") if x.is_file())
        for f in files:
            z.write(f, f.relative_to(ROOT).as_posix())
print(f"{out.name} (Version {version}) erstellt, {len(z.namelist())} Dateien")
