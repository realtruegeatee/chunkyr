# CHUNKYR // Video Infiltration Protocol v2.0

A Cyberpunk 2077-themed video downloader. Jack in, v. Pick v's target. Breach the ICE. Extract the data.

Runs as a **website** (Flask + waitress, served straight to your browser) — or as an **Electron desktop app** with the same interface. Powered by [`yt-dlp`](https://github.com/yt-dlp/yt-dlp) under the hood.

## What's New in v2.0

- **Website mode** — run it on any server with `python app.py`. No Electron required.
- **Desktop app** — packaged with Electron. No more browser tabs.
- **Breach Protocol minigame** — every download requires v to hack a 5×5 hex grid before extraction. Like NetWatch, but real.
- **Auto-install** — `yt-dlp` and `ffmpeg` are checked and installed on first launch.
- **V everywhere** — the UI refers to the user as "v", because v is the protagonist of Night City.

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
├── static/
│   ├── index.html        # Main UI
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
5. **Solve the minigame** within 20 seconds:
   - Move through the 5×5 grid with **arrow keys**, **WASD**, or **click**
   - Collect the hex codes in the order shown in the TARGET SEQUENCES
   - Avoid `██` ICE walls and re-visited cells
   - Fill the 7-slot buffer before time runs out
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
