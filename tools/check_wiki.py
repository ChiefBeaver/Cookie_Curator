"""Prüft die von tools/docs_to_wiki.py erzeugten Wiki-Seiten (und das PDF) vor dem Hochladen.

    python tools/check_wiki.py WIKIORDNER

Geprüft wird:
* jeder Link auf eine andere Wiki-Seite zeigt auf eine vorhandene Seite (Datei <Seite>.md),
* jeder Anker (#abschnitt) gehört zu einer Überschrift der Zielseite (GitHub-Schreibweise),
* Links auf das PDF im Wiki (…/wiki/<Datei>.pdf) zeigen auf eine Datei, die im Ordner liegt,
  und die Datei beginnt wirklich mit %PDF.
Läuft in CI (.github/workflows/ci.yml, Job "Dokumentation") und vor jedem Hochladen ins Wiki
(.github/workflows/wiki.yml). Exit-Code 1, wenn etwas nicht stimmt.
"""
import html
import re
import sys
from pathlib import Path

LINK = re.compile(r"\]\(([^)\s]+)\)")


def gh_slug(title: str) -> str:
    """Anker, wie GitHub ihn aus einer Überschrift erzeugt (wie in tools/build_pdf.py)."""
    t = re.sub(r"<[^>]+>", "", title)
    t = html.unescape(t).strip().lower()
    t = re.sub(r"[^\w\- ]", "", t)
    return t.replace(" ", "-")


def anchors(md: str) -> set:
    md = re.sub(r"```.*?```", "", md, flags=re.S)          # Überschriften in Codeblöcken zählen nicht
    return {gh_slug(m.group(1)) for m in re.finditer(r"^#{1,6} (.+?)\s*$", md, re.M)}


def main(wiki_dir: str) -> int:
    wiki = Path(wiki_dir)
    pages = {p.stem: p.read_text(encoding="utf-8") for p in wiki.glob("*.md")}
    if "Home" not in pages:
        print("FEHLT  Home.md"); return 1
    page_anchors = {name: anchors(text) for name, text in pages.items()}
    errors, checked = [], 0
    for name, text in pages.items():
        text = re.sub(r"```.*?```", "", text, flags=re.S)
        for target in LINK.findall(text):
            if target.startswith("mailto:"):
                continue
            if "/wiki/" in target:                       # absolute Links ins Wiki (das PDF)
                file = target.split("/wiki/", 1)[1].split("#")[0]
                checked += 1
                f = wiki / file
                if not f.is_file():
                    errors.append(f"{name}: {target} – Datei {file} fehlt im Wiki")
                elif file.lower().endswith(".pdf") and f.read_bytes()[:4] != b"%PDF":
                    errors.append(f"{name}: {file} ist kein PDF")
                continue
            if re.match(r"^[a-z]+:", target):            # andere externe Links: nicht geprüft
                continue
            page, _, anchor = target.partition("#")
            page = page or name
            checked += 1
            if page not in pages:
                errors.append(f"{name}: Link auf fehlende Seite {page!r}")
            elif anchor and anchor not in page_anchors[page]:
                errors.append(f"{name}: Anker #{anchor} fehlt auf Seite {page}")
    for e in errors:
        print("FEHLER", e)
    print(f"Wiki: {len(pages)} Seiten, {checked} Links geprüft, {len(errors)} Fehler")
    return 1 if errors else 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Aufruf: python tools/check_wiki.py WIKIORDNER")
    sys.exit(main(sys.argv[1]))
