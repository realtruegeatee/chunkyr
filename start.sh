#!/usr/bin/env bash
#
# CHUNKYR // Video Infiltration Protocol — one-click website launcher
# (Linux / macOS equivalent of start.bat)
#
# Creates a venv, installs Python dependencies, makes sure ffmpeg is
# available, then serves the site with waitress on ${PORT:-5000}.
#
set -e
cd "$(dirname "$0")"

echo "> CHUNKYR initializing..."

if ! command -v python3 >/dev/null 2>&1; then
  echo "  python3 not found. Install Python 3.10+ first: https://python.org"
  exit 1
fi

if [ ! -d venv ]; then
  echo "> Creating virtualenv..."
  python3 -m venv venv
fi

# shellcheck disable=SC1091
source venv/bin/activate

echo "> Installing dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt

if command -v ffmpeg >/dev/null 2>&1; then
  echo "> ffmpeg found at: $(command -v ffmpeg)"
else
  echo "> ffmpeg not on PATH. Using the imageio-ffmpeg bundled binary."
  python - <<'PY'
import os, shutil, imageio_ffmpeg
dest = os.path.join(os.environ["VIRTUAL_ENV"], "bin", "ffmpeg")
shutil.copy2(imageio_ffmpeg.get_ffmpeg_exe(), dest)
os.chmod(dest, 0o755)
print(f"  ffmpeg installed to {dest}")
PY
fi

echo "> Deployment netrunner standing by."
echo "> Open http://localhost:${PORT:-5000} in your browser."
exec python app.py
