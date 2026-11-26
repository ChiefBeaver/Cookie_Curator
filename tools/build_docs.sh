#!/usr/bin/env bash
# Erzeugt Wiki-Seiten und PDF der Dokumentation in einen Ordner und prüft alle Links.
#
#   tools/build_docs.sh AUSGABEORDNER
#
# Benötigt: Python mit "markdown" und "playwright" (+ Chromium), Node (npx lädt mermaid-cli).
# Wird von .github/workflows/ci.yml (Job "Dokumentation") und .github/workflows/wiki.yml benutzt.
set -euo pipefail
out="${1:?Aufruf: tools/build_docs.sh AUSGABEORDNER}"
here="$(cd "$(dirname "$0")" && pwd)"
python "$here/docs_to_wiki.py" "$out"
python "$here/build_pdf.py" "$out/Cookie-Curator-Dokumentation.pdf"
python "$here/check_wiki.py" "$out"
