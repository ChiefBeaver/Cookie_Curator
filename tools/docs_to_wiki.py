"""Erzeugt die Seiten des GitHub-Wikis aus den Markdown-Kapiteln in docs/.

    python tools/docs_to_wiki.py ZIELORDNER

Quelle bleibt immer docs/ im Repository; das Wiki ist eine erzeugte Kopie. Die Datei
.github/workflows/wiki.yml ruft dieses Skript bei jeder Änderung an docs/ auf und lädt das
Ergebnis ins Wiki hoch.

Was das Skript macht:
* docs/README.md wird zur Startseite Home.md.
* Jedes Kapitel NN-name.md wird zu einer Seite, benannt nach seiner Überschrift
  ("01 – Architektur" → Seite "01 Architektur", Datei 01-Architektur.md).
* Links zwischen Kapiteln (02-datenmodell.md#abschnitt) werden zu Wiki-Links (02-Datenmodell#abschnitt).
* _Sidebar.md (Kapitelliste) und _Footer.md (Hinweis auf die Quelle) werden erzeugt.
* Mermaid-Diagramme bleiben unverändert; GitHub zeichnet sie auch im Wiki.
"""
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
REPO_URL = os.environ.get("REPO_URL", "https://github.com/ChiefBeaver/Cookie_Curator")
BRANCH = os.environ.get("REPO_BRANCH", "main")


def title_of(md_file: Path) -> str:
    """Erste Überschrift des Kapitels, z. B. '01 – Architektur'."""
    m = re.search(r"^# (.+)$", md_file.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip() if m else md_file.stem


def page_name(md_file: Path) -> str:
    """Seitenname aus der ersten Überschrift: '01 – Architektur' → '01-Architektur'."""
    if md_file.name == "README.md":
        return "Home"
    title = title_of(md_file).replace(" – ", " ").replace(",", "")
    title = re.sub(r"[\\/:*?\"<>|#]", "", title)          # in Dateinamen bzw. Wiki-URLs unzulässig
    return re.sub(r"\s+", "-", title.strip())


def main(out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    chapters = sorted(p for p in DOCS.glob("[0-9][0-9]-*.md"))
    sources = [DOCS / "README.md"] + chapters
    names = {p.name: page_name(p) for p in sources}

    def fix_links(text: str) -> str:
        # Links auf andere Kapitel: (02-datenmodell.md#anker) → (02-Datenmodell#anker)
        def repl(m):
            target, anchor = m.group(1), m.group(2) or ""
            if target in names:
                return f"]({names[target]}{anchor})"
            # andere Dateien im docs-Ordner (z. B. das PDF) → Datei im Repository
            if (DOCS / target).exists():
                return f"]({REPO_URL}/blob/{BRANCH}/docs/{target}{anchor})"
            return m.group(0)
        return re.sub(r"\]\(([^)#\s]+\.(?:md|pdf))(#[^)\s]*)?\)", repl, text)

    for src in sources:
        text = fix_links(src.read_text(encoding="utf-8"))
        if src.name == "README.md":
            text = text.replace(
                "## Inhalt",
                f"Die gesamte Dokumentation gibt es auch als [PDF]({REPO_URL}/blob/{BRANCH}/docs/Cookie-Curator-Dokumentation.pdf).\n\n## Inhalt",
                1)
        (out / f"{names[src.name]}.md").write_text(text, encoding="utf-8")

    sidebar = ["**[Übersicht](Home)**", ""]
    for c in chapters:
        n = names[c.name]
        sidebar.append(f"* [{title_of(c)}]({n})")
    sidebar += ["", f"[PDF herunterladen]({REPO_URL}/blob/{BRANCH}/docs/Cookie-Curator-Dokumentation.pdf)"]
    (out / "_Sidebar.md").write_text("\n".join(sidebar) + "\n", encoding="utf-8")

    (out / "_Footer.md").write_text(
        f"Dieses Wiki wird automatisch aus dem Ordner [`docs/`]({REPO_URL}/tree/{BRANCH}/docs) erzeugt. "
        "Änderungen bitte dort vornehmen – direkte Änderungen im Wiki werden beim nächsten Abgleich überschrieben.\n",
        encoding="utf-8")
    print(f"{len(sources)} Seiten + Seitenleiste nach {out} geschrieben")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("Aufruf: python tools/docs_to_wiki.py ZIELORDNER")
    main(sys.argv[1])
