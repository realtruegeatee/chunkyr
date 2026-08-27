# CHUNKYR // Video Infiltration Protocol v2.0

A Cyberpunk 2077-themed desktop video downloader. Jack in, v. Pick v's target. Breach the ICE. Extract the data.

Built as an Electron desktop app that runs a Flask backend (using `yt-dlp`) under the hood.

## What's New in v2.0

- **Desktop app** — packaged with Electron. No more browser tabs.
- **Breach Protocol minigame** — every download requires v to hack a 5×5 hex grid before extraction. Like NetWatch, but real.
- **Auto-install** — `yt-dlp` and `ffmpeg` are checked and installed on first launch.
- **V everywhere** — the UI refers to the user as "v", because v is the protagonist of Night City.

## Files

```
video-downloader/
├── main.js               # Electron main process
├── preload.js            # Secure IPC bridge
├── app.py                # Flask backend (unchanged)
├── package.json          # Electron + electron-builder config
├── start.bat             # One-click launcher (Windows)
├── requirements.txt      # Python dependencies
├── static/
│   ├── index.html        # Main UI
│   ├── breach-protocol.js  # Minigame logic
│   ├── breach-protocol.css # Minigame styles
│   ├── splash.html       # Bootstrap splash screen
│   └── nightcity_1920.jpg # Background
└── assets/               # Icons (optional)
```

## Setup

### Quick Start (Windows)

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

### Apple Music note

- **Apple Podcasts** — fully supported.
- **Apple Music catalog songs** — **not supported**. Apple encrypts tracks with FairPlay DRM; yt-dlp cannot bypass this.

## Technical Notes

- The Electron app starts Flask on a random free port; the renderer loads `http://127.0.0.1:<port>/`.
- The renderer uses `contextIsolation: true` and only talks to the main process via `preload.js`.
- yt-dlp and ffmpeg are auto-installed via `pip` and PATH checks on first launch.
- Files are saved to v's browser-via-Electron default Downloads folder.
- The server only runs locally — v's URLs never leave v's machine.
- Only download content v has the right to download. Samurai don't rip licensed content.

## Build Targets

- `npm start` — run in dev mode (with DevTools)
- `npm run build` — package as Windows portable .exe
- `npm run build:portable` — same, but explicitly portable

## License

MIT. Built with love by V. For the streets.
