/**
 * CHUNKYR // WEB UPLINK LAYER
 *
 * Shared by the Flask-served app and the static GitHub Pages build.
 *
 * Resolution order for the extraction backend ("uplink"):
 *   1. ?api=<url> query parameter (saved to localStorage)
 *   2. localStorage 'chunkyr.apiBase'
 *   3. GitHub Pages build (window.CHUNKYR_PAGES) → backendless direct-link mode
 *      Flask build → same-origin API ('')
 */
(function (global) {
  'use strict';

  const LS_KEY = 'chunkyr.apiBase';

  function _normalize(base) {
    return (base || '').trim().replace(/\/+$/, '');
  }

  function _read(queryFirst) {
    if (queryFirst) {
      const q = new URLSearchParams(location.search).get('api');
      if (q) {
        try { localStorage.setItem(LS_KEY, _normalize(q)); } catch (e) {}
        return _normalize(q);
      }
    }
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) return _normalize(saved);
    } catch (e) {}
    return null;
  }

  const WEB = {
    // '' = same-origin backend (Flask), full URL = remote uplink,
    // null = backendless (static Pages build with no uplink configured).
    getBase() {
      const saved = _read(true);
      if (saved !== null) return saved;
      return global.CHUNKYR_PAGES ? null : '';
    },

    setBase(base) {
      const v = _normalize(base);
      try {
        if (v) localStorage.setItem(LS_KEY, v);
        else localStorage.removeItem(LS_KEY);
      } catch (e) {}
      return v;
    },

    clearBase() { this.setBase(''); },

    // Build the absolute URL for an API path.
    apiUrl(path) {
      const base = this.getBase();
      if (base === null) return path;      // never fetched in backendless mode
      return base + path;                   // '' + '/api/x' → same-origin path
    },

    // True when running the static Pages build without a configured uplink.
    isBackendless() {
      return !!global.CHUNKYR_PAGES && this.getBase() === null;
    },

    async ping() {
      const base = this.getBase();
      if (base === null) return { ok: false, reason: 'no-uplink' };
      try {
        const res = await fetch(base + '/api/health', {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) return { ok: false, reason: 'http-' + res.status };
        const data = await res.json().catch(() => ({}));
        return { ok: true, ffmpeg: !!data.ffmpeg };
      } catch (err) {
        return { ok: false, reason: 'unreachable' };
      }
    },

    // ── Backendless direct-link extraction ─────────────────────────────────
    MEDIA_RE: /\.(mp4|webm|mkv|mov|m4v|mpg|mpeg|mp3|m4a|ogg|oga|opus|wav|flac|aac|m3u8)(\?|#|$)/i,

    isDirectMedia(url) {
      return this.MEDIA_RE.test(url || '');
    },

    // Synthesize a TARGET PROFILE for a direct media URL without any
    // network call (a HEAD probe would be CORS-blocked on most hosts).
    directInfo(url) {
      let pathname = '';
      try { pathname = new URL(url).pathname; } catch (e) { pathname = url; }
      let name = pathname.split('/').filter(Boolean).pop() || 'download';
      try { name = decodeURIComponent(name); } catch (e) {}
      const m = name.match(this.MEDIA_RE);
      const ext = m ? m[1].toLowerCase() : 'bin';
      const title = name.replace(/\.[a-z0-9]{2,5}$/i, '') || 'direct-signal';
      return {
        title,
        uploader: '',
        duration: null,
        thumbnail: '',
        site: 'DIRECT SIGNAL',
        formats: [{
          format_id: 'direct',
          label: `Original file (${ext})`,
          ext,
          filesize: null,
          is_combined: true,
        }],
        _direct: { url, filename: name },
      };
    },

    // Stream a Response into a Blob while reporting progress.
    // onProgress(receivedBytes, fractionOrNull)
    async streamToBlob(res, onProgress) {
      const total = Number(res.headers.get('Content-Length')) || 0;
      if (!res.body || typeof res.body.getReader !== 'function') {
        const blob = await res.blob();
        if (onProgress) onProgress(blob.size, 1);
        return blob;
      }
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (onProgress) onProgress(received, total ? received / total : null);
      }
      return new Blob(chunks, {
        type: res.headers.get('Content-Type') || 'application/octet-stream',
      });
    },
  };

  global.CHUNKYR_WEB = WEB;
})(window);
