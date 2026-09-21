"""
CHUNKYR // Video Infiltration Protocol — Flask backend using yt-dlp.

Runs as a website: serves the static frontend at `/` plus a JSON API
(`/api/info`, `/api/download`, `/api/health`). Bind host/port via the
HOST and PORT environment variables (defaults: 0.0.0.0:5000).
"""
from flask import Flask, request, jsonify, send_file
import yt_dlp
import os
import re
import shutil
import tempfile
import uuid
import threading
import time
from pathlib import Path

app = Flask(__name__, static_folder='static', template_folder='templates')

# Locate ffmpeg: prefer one on PATH; otherwise check well-known install
# locations (Linux/macOS first, then the Windows fallbacks kept from the
# desktop build). yt-dlp needs ffmpeg to merge separate video+audio
# streams (e.g. 1080p+ on YouTube).
def find_ffmpeg():
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    candidates = [
        # Linux / macOS
        Path("/usr/local/bin/ffmpeg"),
        Path("/usr/bin/ffmpeg"),
        Path("/opt/ffmpeg/bin/ffmpeg"),
        Path.home() / ".local" / "bin" / "ffmpeg",
        # Windows (desktop builds)
        Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Packages" / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe" / "ffmpeg-9.0.1-full_build" / "bin" / "ffmpeg.exe",
        Path("C:/Program Files/ffmpeg/bin/ffmpeg.exe"),
        Path("C:/ffmpeg/bin/ffmpeg.exe"),
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    # Last resort: an ffmpeg binary bundled by the imageio-ffmpeg package.
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None

FFMPEG_PATH = find_ffmpeg()
if FFMPEG_PATH:
    print(f"ffmpeg: {FFMPEG_PATH}")

# Temp directory for downloads
DOWNLOAD_DIR = Path(tempfile.gettempdir()) / "video_downloader"
DOWNLOAD_DIR.mkdir(exist_ok=True)

# Clean up old files periodically
def cleanup_old_files():
    while True:
        try:
            now = time.time()
            for f in DOWNLOAD_DIR.iterdir():
                if f.is_file() and (now - f.stat().st_mtime) > 3600:
                    f.unlink(missing_ok=True)
        except Exception:
            pass
        time.sleep(600)

threading.Thread(target=cleanup_old_files, daemon=True).start()

URL_RE = re.compile(r'^https?://[^\s]+\.[^\s]+', re.IGNORECASE)


def is_valid_url(url: str) -> bool:
    return bool(URL_RE.match(url or ""))


# ── Website-mode protections ────────────────────────────────────────────────
# Extraction (yt-dlp downloading + ffmpeg merging) is heavy. Cap how many run
# at once, and rate-limit API calls per client IP so a single visitor can't
# monopolise the server. Both are simple in-memory guards — fine for a single
# process; swap for Redis/flask-limiter if you scale out.

MAX_CONCURRENT_EXTRACTIONS = int(os.environ.get("MAX_CONCURRENT_EXTRACTIONS", "4"))
EXTRACTION_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_EXTRACTIONS)

_rate_lock = threading.Lock()
_rate_buckets = {}  # key -> list[timestamps]


def rate_limited(key: str, max_hits: int, window_seconds: int) -> bool:
    """True if `key` has exceeded max_hits within the sliding window."""
    now = time.time()
    with _rate_lock:
        hits = [t for t in _rate_buckets.get(key, []) if now - t < window_seconds]
        if len(hits) >= max_hits:
            _rate_buckets[key] = hits
            return True
        hits.append(now)
        _rate_buckets[key] = hits
        return False


def client_key() -> str:
    # Honour the first X-Forwarded-For hop set by a trusted reverse proxy.
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip() or "unknown"
    return request.remote_addr or "unknown"


# ── CORS ────────────────────────────────────────────────────────────────────
# The static GitHub Pages build (or any other origin) may be configured to use
# this server as its extraction "uplink". Allow cross-origin API calls so that
# works. Default '*' because the API is read-only JSON + file downloads and
# carries no credentials; restrict with CORS_ORIGINS="https://you.github.io,…"
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]


@app.after_request
def add_cors_headers(resp):
    origin = request.headers.get("Origin")
    if not origin:
        return resp
    if "*" in CORS_ORIGINS:
        allow = "*"
    elif origin in CORS_ORIGINS:
        allow = origin
        resp.headers.add("Vary", "Origin")
    else:
        return resp
    resp.headers["Access-Control-Allow-Origin"] = allow
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Accept"
    resp.headers["Access-Control-Max-Age"] = "86400"
    # Without these, browsers hide the download filename and size from fetch().
    resp.headers["Access-Control-Expose-Headers"] = "Content-Disposition, Content-Length"
    return resp


@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "CHUNKYR // Video Infiltration Protocol",
        "ffmpeg": bool(FFMPEG_PATH),
    })


@app.route("/api/info", methods=["POST"])
def get_info():
    """Fetch video metadata without downloading."""
    if rate_limited(f"info:{client_key()}", max_hits=30, window_seconds=60):
        return jsonify({"error": "Rate limit exceeded — slow down, v. Try again in a minute."}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()

    if not is_valid_url(url):
        return jsonify({"error": "Please enter a valid URL (starting with http:// or https://)."}), 400

    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except yt_dlp.utils.DownloadError as e:
        msg = str(e)
        if "Unsupported URL" in msg:
            return jsonify({"error": "This URL is not supported by the downloader."}), 400
        if "Video unavailable" in msg or "Private video" in msg or "Sign in" in msg:
            return jsonify({"error": "This video is unavailable, private, or requires sign-in."}), 400
        return jsonify({"error": f"Could not fetch video: {msg[:200]}"}), 400
    except Exception as e:
        return jsonify({"error": f"Unexpected error: {str(e)[:200]}"}), 500

    # Build a simplified list of formats
    # - For each resolution: prefer the best COMBINED format (video+audio already merged,
    #   no ffmpeg required). Fall back to best video-only if no combined exists.
    # - Audio-only: deduplicate to best bitrate per extension.
    formats = []
    audio_formats = []
    best_per_height = {}  # height -> {ext, filesize, format_id, is_combined}

    for f in info.get("formats", []):
        if not f.get("url"):
            continue
        ext = f.get("ext")
        height = f.get("height")
        vcodec = f.get("vcodec", "none")
        acodec = f.get("acodec", "none")
        filesize = f.get("filesize") or f.get("filesize_approx")
        is_combined = (vcodec != "none" and acodec != "none")

        if vcodec != "none" and height:
            order = {"mp4": 3, "webm": 1, "mkv": 0}
            current = best_per_height.get(height)
            if not current:
                best_per_height[height] = {
                    "ext": ext, "filesize": filesize, "format_id": f.get("format_id"),
                    "is_combined": is_combined,
                }
                continue

            # Ranking: combined > filesize > mp4 > webm
            current_score = (
                1 if current.get("is_combined") else 0,
                current.get("filesize") or 0,
                order.get(current.get("ext"), 0),
            )
            this_score = (
                1 if is_combined else 0,
                filesize or 0,
                order.get(ext, 0),
            )
            if this_score > current_score:
                best_per_height[height] = {
                    "ext": ext, "filesize": filesize, "format_id": f.get("format_id"),
                    "is_combined": is_combined,
                }
        elif acodec != "none" and vcodec == "none":
            abr = f.get("abr", 0) or 0
            audio_formats.append({
                "ext": ext, "abr": abr, "filesize": filesize,
                "format_id": f.get("format_id"),
            })

    # Build video format list, sorted by height (best first)
    for height in sorted(best_per_height.keys(), reverse=True):
        entry = best_per_height[height]
        formats.append({
            "format_id": entry["format_id"],
            "label": f"{height}p",
            "ext": entry["ext"],
            "filesize": entry["filesize"],
            "is_combined": entry.get("is_combined", False),
        })

    # Add audio options — keep only the best per extension
    audio_formats.sort(key=lambda a: a["abr"], reverse=True)
    seen_audio = set()
    for a in audio_formats:
        if a["ext"] in seen_audio:
            continue
        seen_audio.add(a["ext"])
        label = f"Audio only ({a['ext']}, {int(a['abr'])}kbps)" if a["abr"] else f"Audio only ({a['ext']})"
        formats.append({
            "format_id": a["format_id"],
            "label": label,
            "ext": a["ext"],
            "filesize": a["filesize"],
        })

    if not formats:
        return jsonify({"error": "No downloadable formats found for this URL."}), 404

    return jsonify({
        "title": info.get("title", "Untitled"),
        "uploader": info.get("uploader") or info.get("channel", ""),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "site": info.get("extractor_key", "Unknown site"),
        "formats": formats,
    })


@app.route("/api/download", methods=["POST"])
def download():
    """Download the video and stream it back to the client."""
    if rate_limited(f"download:{client_key()}", max_hits=10, window_seconds=60):
        return jsonify({"error": "Rate limit exceeded — slow down, v. Try again in a minute."}), 429

    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    format_id = data.get("format_id")

    if not is_valid_url(url):
        return jsonify({"error": "Please enter a valid URL."}), 400

    # Only a few extractions may run concurrently on a public site.
    if not EXTRACTION_SLOTS.acquire(timeout=180):
        return jsonify({"error": "Server busy — all extraction slots are in use. Try again shortly."}), 429

    try:
        token = uuid.uuid4().hex[:12]
        outtmpl = str(DOWNLOAD_DIR / f"{token}.%(ext)s")

        # format_id is now always an exact yt-dlp format_id (or empty for best)
        is_combined = bool(data.get("is_combined"))
        if format_id:
            if is_combined:
                # Single-stream format — download as-is
                fmt = format_id
            else:
                # Video-only stream — need to merge with best audio
                fmt = f"{format_id}+bestaudio/best"
        else:
            fmt = "bestvideo+bestaudio/best"

        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "outtmpl": outtmpl,
            "format": fmt,
            "merge_output_format": "mp4",
        }
        if FFMPEG_PATH:
            ydl_opts["ffmpeg_location"] = str(Path(FFMPEG_PATH).parent)

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                filename = ydl.prepare_filename(info)
        except Exception as e:
            return jsonify({"error": f"Download failed: {str(e)[:200]}"}), 500

        if not os.path.exists(filename):
            # yt-dlp may have merged into a different extension
            base = os.path.splitext(filename)[0]
            for ext in ("mp4", "mkv", "webm", "mp3", "m4a", "opus"):
                candidate = base + "." + ext
                if os.path.exists(candidate):
                    filename = candidate
                    break
            else:
                return jsonify({"error": "Downloaded file not found."}), 500

        title = info.get("title", "video")
        safe_title = re.sub(r'[^\w\s.-]', '', title)[:80].strip() or "video"
        download_name = f"{safe_title}{os.path.splitext(filename)[1]}"

        return send_file(
            filename,
            as_attachment=True,
            download_name=download_name,
        )
    finally:
        EXTRACTION_SLOTS.release()


if __name__ == "__main__":
    HOST = os.environ.get("HOST", "0.0.0.0")
    PORT = int(os.environ.get("PORT", "5000"))
    THREADS = int(os.environ.get("THREADS", "8"))

    print(f"Downloads temp dir: {DOWNLOAD_DIR}")
    print(f"CHUNKYR website listening on http://{HOST}:{PORT}")

    try:
        # Production WSGI server (pip install waitress — in requirements.txt).
        from waitress import serve
        serve(app, host=HOST, port=PORT, threads=THREADS)
    except ImportError:
        print("waitress not installed — falling back to the Flask dev server.")
        app.run(host=HOST, port=PORT, debug=False, threaded=True)
