# CHUNKYR // Video Infiltration Protocol v2.4

A Cyberpunk 2077-themed video downloader. Jack in, v. Pick v's target. Breach the ICE. Extract the data.

Runs three ways: as a **static site on GitHub Pages**, as a **self-hosted website** (Flask + waitress), or as an **Electron desktop app** — same interface everywhere. Powered by [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) under the hood.

## Run on GitHub Pages (static build)

The frontend is a static site — no server code runs on GitHub Pages. Two ways to use it:

1. **Backendless (direct-link mode)** — out of the box, the Pages build rips
   **direct media links** (`.mp4`, `.webm`, `.mp3`, `.m4a`, `.m3u8`, …)
   entirely in-browser: fetch → Breach Protocol → save. Hosts must allow
   cross-origin reads (CORS); if a target refuses, the UI tells you.
2. **With an extraction uplink (full yt-dlp power)** — run the Flask backend
   anywhere (`python app.py`, must be HTTPS-reachable), then open the Pages
   site, click **UPLINK**, paste the backend URL and hit SAVE. JACK IN /
   EXECUTE then work for all 1500+ supported sites.

Bonus: `?api=<backend-url>` in the URL presets the uplink for one click.

### Deployment

Everything is committed; publishing needs **one manual click** in the repo
(a bot token can't flip this setting):

- **Option A — classic, zero Actions** (works today):
  **Settings → Pages → Source: "Deploy from a branch" →
  branch `arena/01a0c290-chunkyr`, folder `/docs` → Save.**
  GitHub publishes the pre-built `docs/` folder (`.nojekyll` included).
  Re-run `./scripts/build-pages.sh` after frontend edits and commit.
- **Option B — GitHub Actions** (auto-deploys on every push):
  **Settings → Pages → Source: "GitHub Actions"**, plus
  **Settings → Actions → General → Workflow permissions →
  "Read and write permissions"** (needed so the workflow can bootstrap the
  Pages site itself). `.github/workflows/pages.yml` rebuilds and publishes
  `docs/` on each push.
- Either way the site lands at `https://<owner>.github.io/chunkyr/`.
- `static/` is the single source of truth; `docs/` is generated — never
  edit `docs/` by hand.

### Backend CORS

The backend sends permissive CORS headers by default so the Pages site can
call it. Lock it down to your Pages origin in production:

```bash
CORS_ORIGINS="https://<you>.github.io" python app.py
```

`Content-Disposition` and `Content-Length` are exposed cross-origin, so the
browser still sees the real filename and a live progress bar.

## What's New in v2.4

- **GitHub Pages build** — static site in `docs/`, auto-deployed by Actions. Backendless direct-link ripping, or point UPLINK at a self-hosted backend for full yt-dlp power.
- **Winnable breaches** — daemon sequences are now guaranteed to lie on a legal grid path (previously most runs were mathematically impossible).
- **Minigame fixes** — RESTART no longer bricks the run, added ABORT (button + Escape), and real keyboard controls (arrows/WASD + Enter).
- **Security** — video metadata is rendered XSS-safe; backend CORS is configurable (`CORS_ORIGINS`).
- **Real progress bar** — streamed downloads now show live percentage/MB instead of a frozen 0%.

## Files

```
video-downloader/
├── app.py                # Flask backend + website server (waitress)
├── main.js               # Electron main process (desktop mode)
├── preload.js            # Secure IPC bridge (desktop mode)
├── package.json          # Electron + electron-builder config
├── start.sh              # One-click website launcher (Linux/macOS)
├── start.bat             # One-click desktop launcher (Windows)
├── requirements.txt      # Python dependencies
├── scripts/
│   └── build-pages.sh    # Builds docs/ from static/ for GitHub Pages
├── docs/                 # GENERATED static site (GitHub Pages) — don't edit
├── .github/workflows/
│   └── pages.yml         # Pages deployment (Actions)
├── static/
│   ├── index.html        # Main UI (source of truth)
│   ├── chunkyr-web.js    # Uplink layer (API base, direct-link, streaming)
│   ├── breach-protocol.js  # Minigame logic
│   ├── breach-protocol.css # Minigame styles
│   ├── splash.html       # Bootstrap splash screen (desktop mode)
│   └── nightcity_1920.jpg # Background
└── assets/               # Icons (optional)
```

## Run as a Website

Requirements: Python 3.10+. Node is **not** needed for website mode.

### Quick Start (Linux / macOS)

```bash
./start.sh
```

It creates a virtualenv, installs dependencies, finds (or bootstraps) ffmpeg,
and serves the site on `http://localhost:5000`.

### Manual

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

Then open `http://localhost:5000` (or `http://<server-ip>:5000` — the server
binds to all interfaces by default).

### Configuration (environment variables)

| Variable                     | Default  | Purpose                                  |
| ---------------------------- | -------- | ---------------------------------------- |
| `HOST`                       | `0.0.0.0`| Interface to bind.                       |
| `PORT`                       | `5000`   | Port to listen on.                       |
| `THREADS`                    | `8`      | waitress worker threads.                 |
| `MAX_CONCURRENT_EXTRACTIONS` | `4`      | Max simultaneous downloads server-wide.  |

Website mode also applies simple in-memory rate limits (30 info lookups and
10 downloads per client IP per minute) — tune or replace with Redis-backed
limiting if you deploy at scale.

### Production notes

- `waitress` serves the app (installed from `requirements.txt`); app.py falls
  back to the Flask dev server if it's missing.
- Behind nginx/Apache, proxy all paths to `http://127.0.0.1:5000` and send
  `X-Forwarded-For` so rate limiting sees real client IPs.
- `GET /api/health` returns service + ffmpeg status for uptime checks.
- Downloaded files are staged in the system temp dir and swept hourly.
- ffmpeg: install system-wide (`apt install ffmpeg` / `brew install ffmpeg`),
  or let the `imageio-ffmpeg` package provide a bundled binary — app.py finds
  it automatically.

## Run as a Desktop App (Windows / Electron)

### Quick Start

1. Install [Node.js](https://nodejs.org/) (LTS) and [Python 3.10+](https://python.org/).
2. Double-click `start.bat`. It will:
   - Install Electron and dependencies
   - Check for Python + yt-dlp (auto-installs if missing)
   - Launch the desktop app

### Manual

```bash
# Install Node deps
npm install

# Set up Python venv (optional but recommended)
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt

# Launch
npm start
```

### Build Windows Installer (.exe) + Portable

```bash
npm run build
```

Output in `dist/`:
- `CHUNKYR Setup 2.0.0.exe` — full NSIS installer with desktop/start-menu shortcuts, optional install location
- `CHUNKYR 2.0.0.exe` — portable, no install needed

Or build them individually:

```bash
npm run build:installer   # NSIS installer only
npm run build:portable    # portable .exe only
```

## How to Use

1. **Paste a URL** from YouTube, Vimeo, Twitter, or any of 1500+ supported sites.
2. **Click "JACK IN"** to fetch video info and available formats.
3. **Select a quality** (e.g. 1080p, 720p, or audio-only).
4. **Click "EXECUTE"** — the Breach Protocol minigame opens.
5. **Extract a daemon** within 20 seconds:
   - First pick must come from the **top row**; after that the game alternates **column → row → column…**
   - **Click** a cell, or move the cursor with **arrow keys / WASD** and pick with **Enter**
   - Match all codes of any TARGET SEQUENCE in order (gaps in the buffer are fine)
   - Don't overflow the 7-slot buffer, and don't run out the clock
   - **RESTART** rerolls the grid; **ABORT** / **Escape** bails out
6. **Success** → download proceeds automatically. **Failure** → access denied, try again.

## Supported Sites

yt-dlp supports 1500+ sites. The most common:

- YouTube, Vimeo, Dailymotion
- Twitter / X, TikTok, Instagram (public posts)
- Facebook (public videos), Reddit
- Twitch clips, Soundcloud (audio)
- **Apple Podcasts** (`podcasts.apple.com/...`)
- Direct .mp4 / .m3u8 links

Private, age-restricted, or sign-in-required videos will not work.
