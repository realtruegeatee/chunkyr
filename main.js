/**
 * CHUNKYR // Video Infiltration Protocol
 * Electron Main Process
 *
 * Responsibilities:
 *  - Auto-install yt-dlp + ffmpeg if missing
 *  - Start the Flask backend on a random port
 *  - Spawn the BrowserWindow and point it at the server
 *  - Quit cleanly when the window closes
 */

const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');

const isDev = process.argv.includes('--dev');
const PROJECT_ROOT = __dirname;
const APP_PORT = process.env.PORT || 0; // 0 = random free port

// ---------- Auto-install dependencies -----------------------------------------

function getEmbeddedPython() {
  // The user's existing venv lives in ./venv
  const venvPython = process.platform === 'win32'
    ? path.join(PROJECT_ROOT, 'venv', 'Scripts', 'python.exe')
    : path.join(PROJECT_ROOT, 'venv', 'bin', 'python');
  if (fs.existsSync(venvPython)) return venvPython;

  // Fall back to system python
  const cmd = process.platform === 'win32' ? 'python' : 'python3';
  return cmd;
}

function ensureYtDlp(pythonCmd, log) {
  log('> Checking yt-dlp...');
  try {
    execSync(`${pythonCmd} -c "import yt_dlp"`, { stdio: 'pipe' });
    log('  yt-dlp already installed.');
    return true;
  } catch {
    // not installed
  }
  log('  yt-dlp missing. Installing now (this may take a minute)...');
  try {
    execSync(`${pythonCmd} -m pip install --upgrade yt-dlp`, { stdio: 'inherit' });
    log('  yt-dlp installed.');
    return true;
  } catch (e) {
    log('  FAILED to install yt-dlp: ' + e.message);
    return false;
  }
}

function ensureFfmpeg(log) {
  log('> Checking ffmpeg...');
  // Check PATH first
  try {
    const cmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const out = execSync(cmd, { stdio: 'pipe' }).toString().trim();
    if (out) {
      log('  ffmpeg found at: ' + out);
      return true;
    }
  } catch {}

  log('  ffmpeg not on PATH. The downloader will still work for combined formats.');
  log('  For 1080p+ downloads, install ffmpeg from https://ffmpeg.org.');
  return false;
}

async function setupDependencies() {
  const log = (msg) => {
    if (splashWindow) splashWindow.webContents.send('bootstrap-log', msg);
    console.log(msg);
  };

  log('> CHUNKYR initializing...');
  const python = getEmbeddedPython();
  log('> Using python: ' + python);

  const ytdlpOk = ensureYtDlp(python, log);
  if (!ytdlpOk) {
    dialog.showErrorBox('yt-dlp install failed', 'Could not install yt-dlp. The app cannot continue.');
    app.quit();
    return false;
  }
  ensureFfmpeg(log);

  log('> Dependencies OK.');
  return true;
}

// ---------- Start Flask server ------------------------------------------------

let serverProcess = null;
let splashWindow = null;
let mainWindow = null;

function startFlask() {
  const python = getEmbeddedPython();
  const env = {
    ...process.env,
    // app.py hardcodes port 5000, so we just pass a dummy PORT var
    PORT: '5000',
  };
  serverProcess = spawn(python, ['app.py'], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout.on('data', (d) => console.log('[flask]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => console.error('[flask err]', d.toString().trim()));
  serverProcess.on('exit', (code) => {
    console.log(`[flask] exited with code ${code}`);
    if (code !== 0 && mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('Backend error', 'The Flask backend crashed. Restart the app.');
      app.quit();
    }
  });
}

function waitForServer(port, maxTries = 60) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryOnce = () => {
      const req = http.get({ hostname: '127.0.0.1', port, path: '/', timeout: 500 }, (res) => {
        res.resume();
        resolve(port);
      });
      req.on('error', () => {
        tries++;
        if (tries >= maxTries) return reject(new Error('Server did not start in time.'));
        setTimeout(tryOnce, 500);
      });
      req.on('timeout', () => req.destroy(new Error('timeout')));
    };
    tryOnce();
  });
}

async function startServerAndGetPort() {
  // Flask is hardcoded to port 5000 in app.py. We just start it and wait.
  // (Could be made configurable by editing app.py to read PORT from env.)
  const port = 5000;
  startFlask();
  return waitForServer(port).then(() => port);
}

// ---------- Splash window (shows bootstrap log) --------------------------------

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 560,
    height: 320,
    resizable: false,
    frame: false,
    transparent: false,
    backgroundColor: '#08080e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splashWindow.loadFile(path.join(PROJECT_ROOT, 'static', 'splash.html'));
  splashWindow.setMenuBarVisibility(false);
}

// ---------- Main window --------------------------------------------------------

function createMainWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 720,
    minHeight: 620,
    backgroundColor: '#08080e',
    title: 'CHUNKYR // Video Infiltration Protocol',
    icon: path.join(PROJECT_ROOT, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(PROJECT_ROOT, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // Allow local Flask server
      webSecurity: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  // Open external links in OS browser, not in our window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ---------- App lifecycle ------------------------------------------------------

app.whenReady().then(async () => {
  createSplash();

  const ok = await setupDependencies();
  if (!ok) return;

  const port = await startServerAndGetPort();
  console.log(`Flask is up on port ${port}`);

  createMainWindow(port);

  if (splashWindow) splashWindow.close();
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // Re-create window
    startServerAndGetPort().then((port) => createMainWindow(port));
  }
});

app.on('before-quit', () => {
  if (serverProcess) {
    try { serverProcess.kill(); } catch {}
  }
});
