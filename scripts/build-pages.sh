#!/usr/bin/env bash
#
# Build the static GitHub Pages site into docs/.
#
# static/ stays the single source of truth; docs/ is a generated copy with
# window.CHUNKYR_PAGES = true injected so the app boots in backendless
# (direct-link) mode until an extraction uplink is configured.
#
set -euo pipefail
cd "$(dirname "$0")/.."

echo "> Building GitHub Pages site into docs/ ..."

mkdir -p docs/static

# index.html — inject Pages flag right before the app scripts load.
python3 - <<'PY'
from pathlib import Path

src = Path("static/index.html").read_text(encoding="utf-8")

flag = "<script>window.CHUNKYR_PAGES = true;</script>\n"
anchor = '<script src="static/chunkyr-web.js"></script>'
if anchor not in src:
    raise SystemExit("build-pages: anchor script tag not found in static/index.html")
out = src.replace(anchor, flag + anchor, 1)

# Note the static build in the footer for future netrunners debugging it.
out = out.replace(
    "&gt; SYS.BUILT_WITH.YT_DLP  //  RESPECT_INTELLECTUAL_PROPERTY",
    "&gt; SYS.BUILT_WITH.YT_DLP  //  RESPECT_INTELLECTUAL_PROPERTY  //  STATIC BUILD (GITHUB PAGES)",
    1,
)

Path("docs/index.html").write_text(out, encoding="utf-8")
print("  docs/index.html")
PY

# Shared static assets, byte-identical.
cp static/breach-protocol.css docs/static/
cp static/breach-protocol.js  docs/static/
cp static/chunkyr-web.js      docs/static/
echo "  docs/static/{breach-protocol.css,breach-protocol.js,chunkyr-web.js}"

# GitHub Pages: skip Jekyll processing so files are served as-is.
touch docs/.nojekyll

echo "> Done. Serve the backend (python app.py) as the extraction uplink,"
echo "  then open the Pages URL and point UPLINK at it for full yt-dlp power."
