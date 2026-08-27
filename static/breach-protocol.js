/**
 * CHUNKYR // BREACH PROTOCOL
 *
 * The iconic hacking minigame from Cyberpunk 2077.
 *
 * How it works:
 *  - 5×5 grid of hex code pairs (e.g. "BD", "1A", "FF")
 *  - 2–3 daemon sequences shown at top must be matched IN ORDER
 *  - Player navigates from a starting position, collecting codes into a 7-slot buffer
 *  - ICE walls (██) block movement
 *  - 20-second countdown
 *  - Success → download proceeds. Failure/timeout → download blocked.
 *
 * Usage:
 *   const bp = new BreachProtocol({
 *     onSuccess: () => { /* proceed with download *!/ },
 *     onFail:    () => { /* cancel download *!/ },
 *   });
 *   bp.start();
 *   bp.destroy();  // cleanup
 */

(function (global) {
  'use strict';

  // ── Hex code pool ──────────────────────────────────────────────────────────
  const HEX_POOL = [
    'BD', '1A', 'FF', '91', '7B', '4A', '3C', 'E9', '6D', '2F',
    'C0', '8E', '55', 'AA', '12', 'DE', '7F', 'E4', '03', '68',
    'B1', '4E', '9C', '20', 'DF', '56', '88', 'C7', '1D', '3A',
  ];

  // ── Helpers ────────────────────────────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pick(arr, n) {
    return shuffle(arr).slice(0, n);
  }

  function pad2(n) {
    return n.toString(16).toUpperCase().padStart(2, '0');
  }

  // ── BreachProtocol class ───────────────────────────────────────────────────
  class BreachProtocol {
    constructor({ onSuccess, onFail } = {}) {
      this.onSuccess = onSuccess || (() => {});
      this.onFail    = onFail    || (() => {});
      this._destroyed = false;
      this._callbacks = [];
    }

    // ── Public API ───────────────────────────────────────────────────────────
    start() {
      if (this._destroyed) return;
      this._init();
      this._show();
      this._startTimer();
    }

    destroy() {
      this._destroyed = true;
      this._clearTimer();
      this._clearInput();
      if (this._overlay) {
        this._overlay.remove();
        this._overlay = null;
      }
    }

    // ── Game state ───────────────────────────────────────────────────────────
    _init() {
      this._phase   = 'playing'; // 'playing' | 'won' | 'lost'
      this._timeLeft = 20;
      this._buffer   = [];        // collected hex codes
      const MAX = 7;
      this._bufferSlots = Array.from({ length: MAX }, () => '');

      this._grid = this._generateGrid();
      this._targets = this._generateTargets();
      // Starting position: bottom-left of the grid
      this._pos = { row: 4, col: 0 };
      // Mark starting cell as visited
      this._visited = new Set(['4,0']);
      // Collect the starting hex
      this._collectAt(this._pos.row, this._pos.col);
    }

    _generateGrid() {
      // 5×5 grid, with some ICE walls (1–3 ICE cells)
      const pool = pick(HEX_POOL, 25);
      const grid = [];
      let idx = 0;
      const iceCount = 1 + Math.floor(Math.random() * 3);
      const icePositions = new Set(
        pick([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], iceCount)
          .map(n => Math.floor(n / 5) + ',' + (n % 5))
      );

      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          const key = `${r},${c}`;
          if (r === 4 && c === 0) {
            row.push({ code: pool[idx++], ice: false }); // start cell
          } else if (icePositions.has(key)) {
            row.push({ code: '██', ice: true });
          } else {
            row.push({ code: pool[idx++], ice: false });
          }
        }
        grid.push(row);
      }
      return grid;
    }

    _generateTargets() {
      // Generate 2–3 targets, each 2–4 codes long
      const count = 2 + Math.floor(Math.random() * 2); // 2 or 3
      const used  = new Set();
      const targets = [];
      let poolCopy = [...HEX_POOL];

      for (let i = 0; i < count; i++) {
        // Each target is a sequence of 2–3 codes that share no prefix overlap
        const len = 2 + Math.floor(Math.random() * 2); // 2 or 3
        const seq = [];
        for (let j = 0; j < len; j++) {
          // Try to avoid repeating codes within this sequence
          let attempts = 0;
          let code;
          do {
            code = poolCopy[Math.floor(Math.random() * poolCopy.length)];
            attempts++;
          } while (seq.includes(code) && attempts < 20);
          seq.push(code);
        }
        // Make sure no target is a prefix of another
        let ok = true;
        for (const t of targets) {
          if (seq.slice(0, t.length).join(' ') === t.join(' ')) {
            ok = false; break;
          }
          if (t.slice(0, seq.length).join(' ') === seq.join(' ')) {
            ok = false; break;
          }
        }
        if (!ok) { i--; continue; }
        targets.push(seq);
      }
      return targets;
    }

    _collectAt(row, col) {
      const cell = this._grid[row][col];
      if (cell.ice) return; // should never happen but guard anyway
      const code = cell.code;
      if (this._buffer.length >= 7) return;

      this._buffer.push(code);
      this._bufferSlots[this._buffer.length - 1] = code;

      // Mark cell as collected visually (and remove from grid logic)
      // Re-render buffer
      this._renderBuffer();
      this._checkWin();
    }

    _tryMove(dRow, dCol) {
      if (this._phase !== 'playing') return;
      const newRow = this._pos.row + dRow;
      const newCol = this._pos.col + dCol;
      if (newRow < 0 || newRow > 4 || newCol < 0 || newCol > 4) return;
      const cell = this._grid[newRow][newCol];
      if (cell.ice) return; // ICE wall
      if (this._visited.has(`${newRow},${newCol}`)) return; // already visited

      this._pos = { row: newRow, col: newCol };
      this._visited.add(`${newRow},${newCol}`);
      this._collectAt(newRow, newCol);
      this._renderGrid();
    }

    _checkWin() {
      // Check if the buffer starts with all target sequences in order
      // We need the buffer to contain each target as a prefix
      let bufIdx = 0;
      for (const target of this._targets) {
        // Find this target sequence starting at bufIdx (or later, but we check in order)
        let match = true;
        for (let i = 0; i < target.length; i++) {
          const bufCode = this._buffer[bufIdx + i];
          if (bufCode !== target[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          bufIdx += target.length;
        } else {
          // This target wasn't found starting from bufIdx; continue checking
          bufIdx++;
          if (bufIdx >= this._buffer.length) break;
          // Re-try the same target from the new position
          // (Simplified: just advance and re-evaluate)
        }
      }

      // Better approach: check if all targets are matched consecutively from buffer start
      // The buffer must contain each target in sequence
      const matched = this._testMatchSequence(0);
      if (matched === this._targets.length) {
        this._win();
        return;
      }
      if (this._buffer.length >= 7) {
        // Buffer full — check if all matched
        if (matched < this._targets.length) {
          this._lose('BUFFER OVERFLOW');
        }
      }
    }

    // Returns how many targets were matched starting from bufStart
    _testMatchSequence(bufStart) {
      if (bufStart >= this._buffer.length) return 0;
      let matched = 0;
      let pos = bufStart;
      for (const target of this._targets) {
        if (pos + target.length > this._buffer.length) break;
        let ok = true;
        for (let i = 0; i < target.length; i++) {
          if (this._buffer[pos + i] !== target[i]) { ok = false; break; }
        }
        if (ok) {
          pos += target.length;
          matched++;
        } else {
          break;
        }
      }
      return matched;
    }

    _win() {
      this._phase = 'won';
      this._clearTimer();
      this._renderResult(true);
      setTimeout(() => {
        if (!this._destroyed) {
          this._cleanup();
          this.onSuccess();
        }
      }, 2200);
    }

    _lose(reason) {
      this._phase = 'lost';
      this._clearTimer();
      this._renderResult(false, reason);
      setTimeout(() => {
        if (!this._destroyed) {
          this._cleanup();
          this.onFail();
        }
      }, 2200);
    }

    _tick() {
      if (this._destroyed || this._phase !== 'playing') return;
      this._timeLeft--;
      this._renderTimer();
      if (this._timeLeft <= 0) {
        this._lose('TIME EXPIRED');
      }
    }

    // ── Timer ───────────────────────────────────────────────────────────────
    _startTimer() {
      this._clearTimer();
      this._timerId = setInterval(() => this._tick(), 1000);
    }

    _clearTimer() {
      if (this._timerId) {
        clearInterval(this._timerId);
        this._timerId = null;
      }
    }

    // ── Input ───────────────────────────────────────────────────────────────
    _setupInput() {
      this._keyHandler = (e) => {
        switch (e.key) {
          case 'ArrowUp':    case 'w': case 'W': e.preventDefault(); this._tryMove(-1,  0); break;
          case 'ArrowDown':  case 's': case 'S': e.preventDefault(); this._tryMove( 1,  0); break;
          case 'ArrowLeft':  case 'a': case 'A': e.preventDefault(); this._tryMove( 0, -1); break;
          case 'ArrowRight': case 'd': case 'D': e.preventDefault(); this._tryMove( 0,  1); break;
        }
      };
      window.addEventListener('keydown', this._keyHandler);
    }

    _clearInput() {
      if (this._keyHandler) {
        window.removeEventListener('keydown', this._keyHandler);
        this._keyHandler = null;
      }
    }

    // ── DOM ─────────────────────────────────────────────────────────────────
    _show() {
      const existing = document.getElementById('bp-overlay');
      if (existing) existing.remove();

      const html = `
      <div id="bp-overlay">
        <div class="bp-container">
          <!-- Header -->
          <div class="bp-header">
            <div class="bp-title">// BREACH PROTOCOL</div>
            <div class="bp-subtitle">HACK THE ICE</div>
          </div>

          <!-- Targets -->
          <div class="bp-targets-section">
            <div class="bp-section-label">// TARGET SEQUENCES</div>
            <div class="bp-targets" id="bp-targets"></div>
          </div>

          <!-- Timer -->
          <div class="bp-timer-row">
            <div class="bp-timer-label">TIME</div>
            <div class="bp-timer-bar-wrap">
              <div class="bp-timer-bar" id="bp-timer-bar"></div>
            </div>
            <div class="bp-timer-value" id="bp-timer-value">20</div>
          </div>

          <!-- Buffer -->
          <div class="bp-buffer-row">
            <div class="bp-section-label">// BUFFER</div>
            <div class="bp-buffer" id="bp-buffer"></div>
          </div>

          <!-- Grid -->
          <div class="bp-grid-wrap">
            <div class="bp-grid" id="bp-grid"></div>
          </div>

          <!-- Status / Result -->
          <div class="bp-status" id="bp-status"></div>

          <!-- Instructions -->
          <div class="bp-instructions">
            <span>NAVIGATE: ARROW KEYS / WASD</span>
            <span>·</span>
            <span>COLLECT ALL SEQUENCES</span>
          </div>
        </div>
      </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      this._overlay = document.getElementById('bp-overlay');

      this._renderTargets();
      this._renderBuffer();
      this._renderGrid();
      this._renderTimer();
      this._setupInput();
    }

    _renderTargets() {
      const el = document.getElementById('bp-targets');
      if (!el) return;
      el.innerHTML = this._targets.map(t =>
        `<div class="bp-target">${t.map(c => `<span class="bp-hex">${c}</span>`).join('')}</div>`
      ).join('');
    }

    _renderBuffer() {
      const el = document.getElementById('bp-buffer');
      if (!el) return;
      el.innerHTML = this._bufferSlots.map((code, i) =>
        `<div class="bp-buf-slot${i < this._buffer.length ? ' filled' : ''}" data-idx="${i}">
          <span class="bp-buf-code">${code || '──'}</span>
        </div>`
      ).join('');

      // Highlight matched targets
      this._highlightMatchedTargets();
    }

    _highlightMatchedTargets() {
      const matched = this._testMatchSequence(0);
      const targetEls = document.querySelectorAll('.bp-target');
      targetEls.forEach((el, i) => {
        el.classList.toggle('matched', i < matched);
        el.classList.toggle('active', i === matched);
      });
    }

    _renderGrid() {
      const el = document.getElementById('bp-grid');
      if (!el) return;
      el.innerHTML = '';

      for (let r = 0; r < 5; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'bp-grid-row';
        for (let c = 0; c < 5; c++) {
          const cell = this._grid[r][c];
          const isVisited = this._visited.has(`${r},${c}`);
          const isPos = this._pos.row === r && this._pos.col === c;
          const isStart = r === 4 && c === 0;

          const cellEl = document.createElement('div');
          cellEl.className = 'bp-cell' +
            (cell.ice ? ' ice' : '') +
            (isVisited && !cell.ice ? ' visited' : '') +
            (isPos ? ' pos' : '') +
            (isStart && !isVisited ? '' : '');
          cellEl.textContent = cell.code;

          if (!cell.ice) {
            cellEl.dataset.row = r;
            cellEl.dataset.col = c;
            cellEl.addEventListener('click', () => {
              if (isPos) return;
              // Click to move: try direct move or path
              this._tryMove(r - this._pos.row, c - this._pos.col);
            });
          }

          rowEl.appendChild(cellEl);
        }
        el.appendChild(rowEl);
      }
    }

    _renderTimer() {
      const bar  = document.getElementById('bp-timer-bar');
      const val  = document.getElementById('bp-timer-value');
      if (!bar || !val) return;
      const pct = Math.max(0, (this._timeLeft / 20) * 100);
      bar.style.width = pct + '%';
      val.textContent = this._timeLeft;
      val.style.color = this._timeLeft <= 5 ? '#ff2a6d' : this._timeLeft <= 10 ? '#ff9d00' : '#00f0ff';
    }

    _renderResult(won, reason = '') {
      const statusEl = document.getElementById('bp-status');
      if (!statusEl) return;
      statusEl.className = 'bp-status ' + (won ? 'won' : 'lost');
      statusEl.innerHTML = won
        ? `<div class="bp-result-text">ACCESS GRANTED</div><div class="bp-result-sub">ICE BREACHED. PROCEEDING...</div>`
        : `<div class="bp-result-text">ACCESS DENIED</div><div class="bp-result-sub">${reason}</div>`;
    }

    _cleanup() {
      this._clearTimer();
      this._clearInput();
      if (this._overlay) {
        this._overlay.remove();
        this._overlay = null;
      }
    }
  }

  // Expose globally
  global.BreachProtocol = BreachProtocol;

})(window);
