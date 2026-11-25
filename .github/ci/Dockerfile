# CI-Image für Cookie Curator: alle Werkzeuge für die drei Testebenen, fertig installiert.
#
#   Node 22 + Playwright mit Chromium      → Einheitentests, Oberflächentests
#   addons-linter                          → Prüfung der XPI
#   Python 3 + Selenium + cryptography     → Firefox-Tests, build_xpi.py
#   Firefox ESR + geckodriver              → Firefox-Tests
#
# Gebaut und in der GitHub Container Registry abgelegt von .github/workflows/ci.yml.
# Der Image-Tag ist ein Hash über diese Datei und die Abhängigkeiten der Tests:
# Ändert sich eine davon, baut der nächste CI-Lauf das Image automatisch neu.

FROM node:22-bookworm

ARG GECKODRIVER_VERSION=0.36.0
# Browser von Playwright an einem festen Ort, damit sie für jeden Benutzer im Container auffindbar sind
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Firefox ESR aus Debian (aktuelle ESR-Reihe, mit Sicherheitsupdates), Python, Hilfsprogramme
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      firefox-esr python3 python3-venv zip xz-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# geckodriver: steuert Firefox für Selenium
RUN curl -fsSL "https://github.com/mozilla/geckodriver/releases/download/v${GECKODRIVER_VERSION}/geckodriver-v${GECKODRIVER_VERSION}-linux64.tar.gz" \
      | tar -xz -C /usr/local/bin \
 && geckodriver --version | head -1

# Python-Pakete in einer eigenen Umgebung; deren "python" steht vorne im PATH
COPY tests/requirements.txt /opt/ci/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir -r /opt/ci/requirements.txt

# Node-Pakete der Tests (Playwright, addons-linter) und der zu Playwright passende Chromium
COPY tests/package.json /opt/ci/package.json
RUN cd /opt/ci && npm install --no-audit --no-fund \
 && npx playwright install --with-deps chromium \
 && rm -rf /root/.npm /var/lib/apt/lists/*

ENV PATH=/opt/venv/bin:/opt/ci/node_modules/.bin:$PATH \
    NODE_PATH=/opt/ci/node_modules \
    FIREFOX_BIN=/usr/bin/firefox-esr \
    GECKODRIVER=/usr/local/bin/geckodriver \
    SE_AVOID_STATS=true

LABEL org.opencontainers.image.description="CI-Umgebung für Cookie Curator (Node, Playwright, Python, Firefox ESR, geckodriver)"
