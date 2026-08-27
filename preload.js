/**
 * CHUNKYR preload script
 *
 * Runs in a privileged context. Exposes a small, safe API to the renderer
 * via contextBridge. The renderer cannot reach Node directly.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chunkyr', {
  // Bootstrap log listener — called by main.js with status messages.
  onBootstrapLog: (callback) => {
    ipcRenderer.on('bootstrap-log', (_event, msg) => callback(msg));
  },

  // Generic logger — currently unused, but exposed for future use.
  log: (msg) => ipcRenderer.send('log', msg),
});
