/**
 * CHUNKYR // BREACH PROTOCOL v3
 *
 * Accurate recreation of the Cyberpunk 2077 Breach Protocol minigame.
 *
 * How it ACTUALLY works in CP2077:
 *  - 5x5 grid of hex code pairs
 *  - 2-3 daemon sequences (targets) shown at top, color-coded
 *  - You select from the TOP ROW first
 *  - Then you alternate: pick from the COLUMN of your last pick, then
 *    the ROW of that pick, then COLUMN, then ROW...
 *  - Each selected cell is added to the buffer
 *  - Buffer size limit (default 7)
 *  - You don't have to fill the whole buffer — you can stop when all
 *    target sequences are matched in order
 *  - Once you start picking, the timer ticks down
 *  - 20 second countdown
 *  - Match all targets in order = SUCCESS. Buffer full or timer hit = FAIL.
 *
 * Hex codes can repeat in the buffer. You can stop the run at any time
 * by pressing the SUBMIT button, but the minigame auto-wins when all
 * sequences are matched.
 */

(function (global) {
  'use strict';

  // ── Hex code pool (CP2077-inspired) ─────────────────────────────────────────
  const HEX_POOL = [
    'BD', '1A', 'FF', '91', '7B', '4A', '3C', 'E9', '6D', '2F',
    'C0', '8E', '55', 'AA', '12', 'DE', '7F', 'E4', '03', '68',
    'B1', '4E', '9C', '20', 'DF', '56', '88', 'C7', '1D', '3A',
  ];

  // ── Cyberpunk color palette for target sequences ───────────────────────────
  const TARGET_COLORS = [
    '#ff2a6d', // magenta
    '#00f0ff', // cyan
    '#39ff14', // neon green
    '#ff9d00', // amber
    '#fcee0a', // yellow
    '#bf5af2', // purple
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

  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ── BreachProtocol class ───────────────────────────────────────────────────
  class BreachProtocol {
    constructor({ onSuccess, onFail } = {}) {
      this.onSuccess = onSuccess || (() => {});
      this.onFail    = onFail    || (() => {});
      this._destroyed = false;
    }

    // ── Public API ───────────────────────────────────────────────────────────
    start() {
      if (this._destroyed) return;
      this._init();
      this._show();
      // Timer doesn't start until first pick (real CP2077 behavior)
      this._timerStarted = false;
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
      this._phase     = 'aiming';  // 'aiming' | 'playing' | 'won' | 'lost'
      this._timeLeft  = 20;
      this._buffer    = [];        // selected hex codes
      this._bufferSlots = Array.from({ length: 7 }, () => null);
      this._bufferSize = 7;
      this._lastPick = null;       // { row, col } of last selected cell
      this._axis     = 'row';      // 'row' | 'col' — what axis the NEXT pick must be on

      this._grid    = this._generateGrid();
      this._targets = this._generateTargets();
    }

    _generateGrid() {
      // 5x5 grid of random hex codes
      const grid = [];
      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          row.push(pickRandom(HEX_POOL));
        }
        grid.push(row);
      }
      return grid;
    }

    _generateTargets() {
      // 2 sequences, each 3 codes long
      const count = 2;
      const targets = [];
      const usedCodes = new Set();

      for (let i = 0; i < count; i++) {
        const color = TARGET_COLORS[i % TARGET_COLORS.length];
        const seq = [];
        let attempts = 0;
        while (seq.length < 3 && attempts < 100) {
          attempts++;
          const code = pickRandom(HEX_POOL);
          if (!seq.includes(code)) {
            seq.push(code);
            usedCodes.add(code);
          }
        }
        targets.push({ seq, color, label: `1x3` });
      }
      return targets;
    }

    // ── Pick logic ───────────────────────────────────────────────────────────
    _canPick(row, col) {
      // No picking before timer is going — actually first pick is from top row
      if (this._phase === 'won' || this._phase === 'lost') return false;

      // First pick must be from ROW 0 (top row)
      if (this._buffer.length === 0) {
        return row === 0;
      }

      // Subsequent picks: must match the current axis requirement
      // If last pick was on column X, you must pick from the same column
      // (any row in that column). If last pick was on row Y, you must
      // pick from the same row (any column in that row).
      if (this._axis === 'col') {
        return col === this._lastPick.col;
      } else {
        return row === this._lastPick.row;
      }
    }

    _pick(row, col) {
      if (!this._canPick(row, col)) return;

      const code = this._grid[row][col];
      this._buffer.push(code);
      this._bufferSlots[this._buffer.length - 1] = { code, row, col };
      this._lastPick = { row, col };

      // Alternate axis for next pick
      this._axis = this._axis === 'row' ? 'col' : 'row';

      // Play sound
      this._playSound('pick');

      // Start timer on first pick
      if (!this._timerStarted) {
        this._timerStarted = true;
        this._startTimer();
      }

      this._renderAll();
      this._checkWin();
    }

    _checkWin() {
      const matched = this._countConsecutiveMatches();
      if (matched === this._targets.length) {
        this._win();
        return;
      }
      if (this._buffer.length >= this._bufferSize) {
        this._lose('BUFFER OVERFLOW');
      }
    }

    _countConsecutiveMatches() {
      let bufPos = 0;
      let matched = 0;
      for (const target of this._targets) {
        if (bufPos + target.seq.length > this._buffer.length) break;
        let ok = true;
        for (let i = 0; i < target.seq.length; i++) {
          if (this._buffer[bufPos + i] !== target.seq[i]) { ok = false; break; }
        }
        if (ok) {
          bufPos += target.seq.length;
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
      this._playSound('win');
      setTimeout(() => {
        if (!this._destroyed) { this._cleanup(); this.onSuccess(); }
      }, 2500);
    }

    _lose(reason) {
      this._phase = 'lost';
      this._clearTimer();
      this._renderResult(false, reason);
      this._playSound('lose');
      setTimeout(() => {
        if (!this._destroyed) { this._cleanup(); this.onFail(); }
      }, 2500);
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
      this._phase = 'playing';
      this._clearTimer();
      this._timerId = setInterval(() => this._tick(), 1000);
    }

    _clearTimer() {
      if (this._timerId) { clearInterval(this._timerId); this._timerId = null; }
    }

    // ── Audio ────────────────────────────────────────────────────────────────
    _playSound(type) {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const gain = ctx.createGain();
        gain.gain.value = 0.1;
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.connect(gain);

        if (type === 'pick') {
          osc.frequency.value = 600 + Math.random() * 300;
          osc.type = 'square';
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.06);
        } else if (type === 'win') {
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          osc.frequency.setValueAtTime(523, ctx.currentTime);
          osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
          osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.6);
        } else if (type === 'lose') {
          osc.frequency.value = 200;
          osc.type = 'sawtooth';
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.5);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        }
      } catch (e) {}
    }

    // ── Input ───────────────────────────────────────────────────────────────
    _setupInput() {
      this._keyHandler = (e) => {
        if (e.key === 'Escape') { this._restart(); return; }
        if (this._phase === 'won' || this._phase === 'lost') return;
        if (this._phase === 'aiming') {
          if (e.key === 'Enter' || e.key === ' ') {
            // Pick the first cell in top row as default
            this._pick(0, 0);
          }
        }
      };
      window.addEventListener('keydown', this._keyHandler);
    }

    _clearInput() {
      if (this._keyHandler) { window.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    }

    _restart() {
      this.destroy();
      this._init();
      this._show();
    }

    // ── DOM rendering ────────────────────────────────────────────────────────
    _show() {
      const existing = document.getElementById('bp-overlay');
      if (existing) existing.remove();

      const html = `
      <div id="bp-overlay">
        <div class="bp-container">
          <div class="bp-header">
            <div class="bp-title">// BREACH PROTOCOL</div>
            <div class="bp-subtitle">EXTRACT DAEMONS FROM THE NET</div>
          </div>

          <div class="bp-timer-row">
            <div class="bp-timer-label">TIME</div>
            <div class="bp-timer-bar-wrap">
              <div class="bp-timer-bar" id="bp-timer-bar"></div>
            </div>
            <div class="bp-timer-value" id="bp-timer-value">20</div>
          </div>

          <div class="bp-instruction-banner" id="bp-instr-banner">
            SELECT A CODE FROM THE TOP ROW
          </div>

          <div class="bp-targets-section">
            <div class="bp-section-label">// DAEMONS TO EXTRACT</div>
            <div class="bp-targets" id="bp-targets"></div>
          </div>

          <div class="bp-buffer-row">
            <div class="bp-section-label">// BUFFER</div>
            <div class="bp-buffer" id="bp-buffer"></div>
          </div>

          <div class="bp-grid-wrap">
            <div class="bp-grid" id="bp-grid"></div>
          </div>

          <div class="bp-status" id="bp-status"></div>

          <div class="bp-controls">
            <button class="bp-btn bp-btn-secondary" id="bp-restart-btn">↺ RESTART</button>
          </div>

          <div class="bp-instructions">
            <span>PICK FROM TOP ROW</span>
            <span>·</span>
            <span>ALTERNATE ROW/COLUMN</span>
            <span>·</span>
            <span>EXTRACT ALL DAEMONS</span>
          </div>
        </div>
      </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      this._overlay = document.getElementById('bp-overlay');

      document.getElementById('bp-restart-btn').addEventListener('click', () => this._restart());

      this._renderTargets();
      this._renderBuffer();
      this._renderGrid();
      this._renderTimer();
      this._setupInput();
    }

    _renderAll() {
      this._renderBuffer();
      this._renderGrid();
      this._updateInstructionBanner();
    }

    _renderTargets() {
      const el = document.getElementById('bp-targets');
      if (!el) return;
      el.innerHTML = this._targets.map((t, i) => `
        <div class="bp-target" data-target-idx="${i}" style="border-color:${t.color}40;background:${t.color}08;">
          <div class="bp-target-label" style="color:${t.color}">${t.label}</div>
          ${t.seq.map(code => `
            <div class="bp-target-code" data-code="${code}">
              <span class="bp-hex" style="background:${t.color}15;border-color:${t.color};color:${t.color};text-shadow:0 0 6px ${t.color}">${code}</span>
            </div>
          `).join('')}
        </div>
      `).join('');
    }

    _renderBuffer() {
      const el = document.getElementById('bp-buffer');
      if (!el) return;

      const matched = this._countConsecutiveMatches();

      // Calculate how many cells belong to each matched target for color coding
      const cellColors = new Array(this._buffer.length).fill(null);
      let bufPos = 0;
      for (let tIdx = 0; tIdx < this._targets.length && bufPos < this._buffer.length; tIdx++) {
        const target = this._targets[tIdx];
        let ok = true;
        for (let i = 0; i < target.seq.length; i++) {
          if (this._buffer[bufPos + i] !== target.seq[i]) { ok = false; break; }
        }
        if (ok) {
          for (let i = 0; i < target.seq.length; i++) {
            if (bufPos + i < this._buffer.length) {
              cellColors[bufPos + i] = target.color;
            }
          }
          bufPos += target.seq.length;
        } else {
          break;
        }
      }

      // Build the buffer UI
      let slotsHTML = '';
      for (let i = 0; i < this._bufferSize; i++) {
        const slot = this._bufferSlots[i];
        if (slot) {
          const color = cellColors[i] || '#00f0ff';
          slotsHTML += `
            <div class="bp-buf-slot filled" style="border-color:${color};background:${color}20;box-shadow:0 0 10px ${color}80;">
              <span class="bp-buf-code" style="color:${color};text-shadow:0 0 8px ${color}">${slot.code}</span>
            </div>`;
        } else {
          slotsHTML += `<div class="bp-buf-slot"><span class="bp-buf-code empty">──</span></div>`;
        }
      }
      el.innerHTML = slotsHTML;

      // Update target states (highlight matched, fade others)
      this._targets.forEach((t, i) => {
        const targetEl = el.parentElement.querySelector(`.bp-target[data-target-idx="${i}"]`);
        if (!targetEl) return;
        if (i < matched) {
          targetEl.classList.add('matched');
        } else {
          targetEl.classList.remove('matched');
        }
      });

      // Update target DOM status
      this._updateTargetStatus();
    }

    _updateTargetStatus() {
      const matched = this._countConsecutiveMatches();
      const targetEls = document.querySelectorAll('.bp-target');
      targetEls.forEach((el, i) => {
        if (i < matched) {
          el.classList.add('matched');
          el.classList.remove('active');
        } else if (i === matched) {
          el.classList.add('active');
          el.classList.remove('matched');
        } else {
          el.classList.remove('active', 'matched');
        }
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
          const cellEl = document.createElement('div');
          cellEl.className = 'bp-cell';
          cellEl.dataset.row = r;
          cellEl.dataset.col = c;
          cellEl.textContent = this._grid[r][c];

          // Check if this cell is a valid pick
          const isPickable = this._canPick(r, c);

          // Highlight valid picks
          if (isPickable && this._phase !== 'won' && this._phase !== 'lost') {
            cellEl.classList.add('pickable');

            // Different highlight for first pick vs subsequent
            if (this._buffer.length === 0) {
              cellEl.classList.add('first-pick');
            } else {
              cellEl.classList.add('next-pick');
            }

            cellEl.addEventListener('click', () => this._pick(r, c));
          }

          // Highlight last pick
          if (this._lastPick && this._lastPick.row === r && this._lastPick.col === c) {
            cellEl.classList.add('last-pick');
          }

          // Show row/column highlight for the active axis
          if (this._lastPick && this._phase === 'playing') {
            if (this._axis === 'col' && c === this._lastPick.col) {
              cellEl.classList.add('active-axis');
            } else if (this._axis === 'row' && r === this._lastPick.row) {
              cellEl.classList.add('active-axis');
            }
          }

          // Show first-pick highlight on row 0 when buffer is empty
          if (this._buffer.length === 0 && r === 0) {
            cellEl.classList.add('top-row-hint');
          }

          rowEl.appendChild(cellEl);
        }
        el.appendChild(rowEl);
      }
    }

    _updateInstructionBanner() {
      const banner = document.getElementById('bp-instr-banner');
      if (!banner) return;
      if (this._phase === 'won') {
        banner.textContent = '✓ ACCESS GRANTED';
        banner.className = 'bp-instruction-banner success';
      } else if (this._phase === 'lost') {
        banner.textContent = '✗ ACCESS DENIED';
        banner.className = 'bp-instruction-banner failed';
      } else if (this._buffer.length === 0) {
        banner.textContent = 'SELECT A CODE FROM THE TOP ROW';
      } else {
        banner.textContent = this._axis === 'col'
          ? `SELECT FROM COLUMN ${this._lastPick.col + 1} (TOP TO BOTTOM)`
          : `SELECT FROM ROW ${this._lastPick.row + 1} (LEFT TO RIGHT)`;
      }
    }

    _renderTimer() {
      const bar = document.getElementById('bp-timer-bar');
      const val = document.getElementById('bp-timer-value');
      if (!bar || !val) return;
      const pct = Math.max(0, (this._timeLeft / 20) * 100);
      bar.style.width = pct + '%';
      val.textContent = this._timeLeft;
      if (this._timeLeft <= 5) {
        val.style.color = '#ff2a6d';
        bar.style.background = '#ff2a6d';
      } else if (this._timeLeft <= 10) {
        val.style.color = '#ff9d00';
        bar.style.background = 'linear-gradient(90deg, #ff9d00, #ff2a6d)';
      } else {
        val.style.color = '#00f0ff';
        bar.style.background = 'linear-gradient(90deg, #00f0ff, #39ff14)';
      }
    }

    _renderResult(won, reason = '') {
      const statusEl = document.getElementById('bp-status');
      if (!statusEl) return;
      statusEl.className = 'bp-status ' + (won ? 'won' : 'lost');
      statusEl.innerHTML = won
        ? `<div class="bp-result-text">ACCESS GRANTED</div><div class="bp-result-sub">ALL DAEMONS EXTRACTED</div>`
        : `<div class="bp-result-text">ACCESS DENIED</div><div class="bp-result-sub">${reason}</div>`;
    }

    _cleanup() {
      this._clearTimer();
      this._clearInput();
      if (this._overlay) { this._overlay.remove(); this._overlay = null; }
    }
  }

  global.BreachProtocol = BreachProtocol;

})(window);
