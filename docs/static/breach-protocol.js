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
    constructor({ onSuccess, onFail, onAbort } = {}) {
      this.onSuccess = onSuccess || (() => {});
      this.onFail    = onFail    || (() => {});
      this.onAbort   = onAbort   || (() => {});
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
      this._cursor   = { row: 0, col: 0 };  // keyboard navigation cursor

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
      // 2 sequences, each 3 codes long.
      // BUGFIX: previously the daemon codes were drawn from HEX_POOL at
      // random with no guarantee they existed in the grid or lay on a legal
      // row/column path — most breaches were mathematically unwinnable.
      // Now every sequence is PLANTED into the grid along a valid
      // (top-row → column → row) alternation path, so each daemon can
      // always be extracted.
      const count = 2;
      const targets = [];
      const usedCodes = new Set();
      const occupiedCells = new Set();  // "r,c" cells already planted

      for (let i = 0; i < count; i++) {
        const color = TARGET_COLORS[i % TARGET_COLORS.length];
        const seq = [];
        let attempts = 0;
        while (seq.length < 3 && attempts < 200) {
          attempts++;
          const code = pickRandom(HEX_POOL);
          if (!seq.includes(code) && !usedCodes.has(code)) {
            seq.push(code);
            usedCodes.add(code);
          }
        }
        this._plantSequence(seq, occupiedCells);
        targets.push({ seq, color, label: `1x3` });
      }
      return targets;
    }

    // Write seq codes into grid cells that form a legal alternation path:
    //   (0, c0) → (r1, c0) → (r1, c2)   i.e. top row → column → row.
    // Cells already planted by an earlier sequence are avoided.
    _plantSequence(seq, occupiedCells) {
      const key = (r, c) => `${r},${c}`;
      for (let attempt = 0; attempt < 300; attempt++) {
        const c0 = Math.floor(Math.random() * 5);
        const r1 = 1 + Math.floor(Math.random() * 4);
        // c2 must differ from c0 — otherwise the 3rd cell would coincide with
        // the 2nd and seq[2] would overwrite seq[1] in the same grid cell.
        const c2picks = [0, 1, 2, 3, 4].filter((c) => c !== c0);
        const c2 = c2picks[Math.floor(Math.random() * c2picks.length)];
        const cells = [[0, c0], [r1, c0], [r1, c2]];
        if (cells.some(([r, c]) => occupiedCells.has(key(r, c)))) continue;
        cells.forEach(([r, c], k) => {
          this._grid[r][c] = seq[k];
          occupiedCells.add(key(r, c));
        });
        return;
      }
      // Overwhelmingly unlikely (25 cells, 6 needed) — but never leave a
      // sequence unplanted: fall back to the first free cells of the top
      // row / first column, which always form a legal path.
      const fallbackCells = [[0, 0], [1, 0], [1, 1]].filter(
        ([r, c]) => !occupiedCells.has(key(r, c))
      );
      for (let k = 0; k < seq.length && k < fallbackCells.length; k++) {
        const [r, c] = fallbackCells[k];
        this._grid[r][c] = seq[k];
        occupiedCells.add(key(r, c));
      }
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

      // Park the keyboard cursor on the first legal cell of the new axis
      this._cursor = this._firstPickableCell() || { row: 0, col: 0 };

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

    _firstPickableCell() {
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (this._canPick(r, c)) return { row: r, col: c };
        }
      }
      return null;
    }

    _checkWin() {
      // Win on matching any ONE sequence (gaps allowed in the buffer)
      for (let tIdx = 0; tIdx < this._targets.length; tIdx++) {
        if (this._seqMatches(this._targets[tIdx].seq, this._buffer)) {
          this._winningTargetIdx = tIdx;
          this._win();
          return;
        }
      }
      if (this._buffer.length >= this._bufferSize) {
        this._lose('BUFFER OVERFLOW');
      }
    }

    // Check if seq is a subsequence of buffer (gaps allowed)
    _seqMatches(seq, buffer) {
      let bufIdx = 0;
      for (let s = 0; s < seq.length; s++) {
        let found = false;
        while (bufIdx < buffer.length) {
          if (buffer[bufIdx] === seq[s]) { found = true; bufIdx++; break; }
          bufIdx++;
        }
        if (!found) return false;
      }
      return true;
    }

    // Get the indices of buffer slots that are part of the first matched sequence
    _getMatchedSlotIndices(seq) {
      const indices = [];
      let bufIdx = 0;
      for (let s = 0; s < seq.length; s++) {
        while (bufIdx < this._buffer.length) {
          if (this._buffer[bufIdx] === seq[s]) { indices.push(bufIdx); bufIdx++; break; }
          bufIdx++;
        }
      }
      return indices;
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
      const MOVE_KEYS = {
        ArrowUp: [-1, 0], w: [-1, 0], W: [-1, 0],
        ArrowDown: [1, 0], s: [1, 0], S: [1, 0],
        ArrowLeft: [0, -1], a: [0, -1], A: [0, -1],
        ArrowRight: [0, 1], d: [0, 1], D: [0, 1],
      };
      this._keyHandler = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); this._abort(); return; }
        if (this._phase === 'won' || this._phase === 'lost') return;

        const move = MOVE_KEYS[e.key];
        if (move) {
          e.preventDefault();
          this._moveCursor(move[0], move[1]);
          return;
        }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (this._canPick(this._cursor.row, this._cursor.col)) {
            this._pick(this._cursor.row, this._cursor.col);
          }
        }
      };
      window.addEventListener('keydown', this._keyHandler);
    }

    // Move the cursor one step. Only the active axis is navigable: before the
    // first pick that's the top row (left/right); afterwards it's the row or
    // column of the last pick.
    _moveCursor(dr, dc) {
      const inPlay = this._phase === 'aiming' || this._phase === 'playing';
      if (!inPlay) return;
      let { row, col } = this._cursor;
      for (let step = 0; step < 5; step++) {
        row = (row + dr + 5) % 5;
        col = (col + dc + 5) % 5;
        if (this._canPick(row, col)) {
          this._cursor = { row, col };
          this._renderGrid();
          return;
        }
      }
    }

    _clearInput() {
      if (this._keyHandler) { window.removeEventListener('keydown', this._keyHandler); this._keyHandler = null; }
    }

    _restart() {
      // BUGFIX: previously this called this.destroy(), which permanently
      // flagged the instance as destroyed — every *restarted* run then died
      // silently: the win callback (and with it the download) never fired.
      this._clearTimer();
      this._clearInput();
      if (this._overlay) { this._overlay.remove(); this._overlay = null; }
      this._init();
      this._show();
    }

    _abort() {
      if (this._destroyed) return;
      this.destroy();
      this.onAbort();
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
            <button class="bp-btn bp-btn-danger" id="bp-abort-btn">✕ ABORT</button>
          </div>

          <div class="bp-instructions">
            <span>CLICK OR ARROWS/WASD</span>
            <span>·</span>
            <span>ENTER TO PICK</span>
            <span>·</span>
            <span>ESC TO ABORT</span>
          </div>
        </div>
      </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      this._overlay = document.getElementById('bp-overlay');

      document.getElementById('bp-restart-btn').addEventListener('click', () => this._restart());
      document.getElementById('bp-abort-btn').addEventListener('click', () => this._abort());

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

      // Check which targets are matched (gaps allowed in buffer)
      const matchedTargetIdx = this._targets.findIndex(t => this._seqMatches(t.seq, this._buffer));
      const activeTargetIdx = matchedTargetIdx >= 0 ? matchedTargetIdx : 0;

      // Color cells: matched target's cells, rest stay default cyan
      const cellColors = new Array(this._buffer.length).fill('#00f0ff');
      if (matchedTargetIdx >= 0) {
        const matchedIndices = this._getMatchedSlotIndices(this._targets[matchedTargetIdx].seq);
        matchedIndices.forEach(i => { cellColors[i] = this._targets[matchedTargetIdx].color; });
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

      // Update target states
      this._targets.forEach((t, i) => {
        const targetEl = el.parentElement.querySelector(`.bp-target[data-target-idx="${i}"]`);
        if (!targetEl) return;
        if (i === matchedTargetIdx) {
          targetEl.classList.add('matched');
          targetEl.classList.remove('active');
        } else if (i === activeTargetIdx) {
          targetEl.classList.add('active');
          targetEl.classList.remove('matched');
        } else {
          targetEl.classList.remove('active', 'matched');
        }
      });
    }

    _updateTargetStatus() {
      const matchedTargetIdx = this._targets.findIndex(t => this._seqMatches(t.seq, this._buffer));
      const activeTargetIdx = matchedTargetIdx >= 0 ? matchedTargetIdx : 0;
      const targetEls = document.querySelectorAll('.bp-target');
      targetEls.forEach((el, i) => {
        if (i === matchedTargetIdx) {
          el.classList.add('matched');
          el.classList.remove('active');
        } else if (i === activeTargetIdx) {
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

          // Keyboard cursor highlight
          if (this._cursor && this._cursor.row === r && this._cursor.col === c
              && this._phase !== 'won' && this._phase !== 'lost') {
            cellEl.classList.add('cursor');
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
        ? `<div class="bp-result-text">ACCESS GRANTED</div><div class="bp-result-sub">DAEMON EXTRACTED</div>`
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
