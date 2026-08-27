/**
 * CHUNKYR // BREACH PROTOCOL v2
 *
 * Accurate recreation of the Cyberpunk 2077 Breach Protocol minigame.
 *
 * How it works:
 *  - 5×5 grid of hex code pairs
 *  - Player clicks a START cell on the perimeter, then clicks adjacent cells to move
 *  - Each move collects the hex code into a 7-slot buffer
 *  - Match target sequences (shown in color) IN ORDER to win
 *  - ICE walls block movement. Already-visited cells can't be re-entered.
 *  - Special bonus cells: +3s (clock icon), buffer reset (refresh icon)
 *  - 20-second countdown
 *  - Success → ACCESS GRANTED. Failure/timeout/overflow → ACCESS DENIED.
 */

(function (global) {
  'use strict';

  // ── Hex code pool (CP2077-inspired) ─────────────────────────────────────────
  const HEX_POOL = [
    'BD', '1A', 'FF', '91', '7B', '4A', '3C', 'E9', '6D', '2F',
    'C0', '8E', '55', 'AA', '12', 'DE', '7F', 'E4', '03', '68',
    'B1', '4E', '9C', '20', 'DF', '56', '88', 'C7', '1D', '3A',
  ];

  // ── Cyberpunk color palette for targets ────────────────────────────────────
  const TARGET_COLORS = [
    '#ff2a6d', // magenta / pink
    '#00f0ff', // cyan
    '#39ff14', // neon green
    '#ff9d00', // amber / orange
    '#fcee0a', // yellow
    '#bf5af2', // purple
    '#64d2ff', // light blue
  ];

  // ── Bonus cell types ───────────────────────────────────────────────────────
  const BONUS_TIME  = '+3s';
  const BONUS_RESET = '↺';   // buffer reset

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
      // Don't start timer yet — wait for player to click a start cell
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
      this._buffer    = [];
      this._bufferSlots = Array.from({ length: 7 }, () => '');
      this._pos       = null;      // { row, col } — only set after START
      this._started   = false;
      this._timerStarted = false;

      // Generate grid, targets, start positions
      this._grid    = this._generateGrid();
      this._targets = this._generateTargets();
      // Start positions: any of the 16 perimeter cells
      this._startOptions = this._getStartPositions();

      // Track visited for visual trail
      this._visited = new Set();
      this._path    = []; // ordered list of visited cells for trail rendering
    }

    _getStartPositions() {
      // Return all perimeter cell indices (row, col) the player can start from
      const pos = [];
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 5; c++) {
          if (r === 0 || r === 4 || c === 0 || c === 4) {
            pos.push({ row: r, col: c });
          }
        }
      }
      return shuffle(pos);
    }

    _generateGrid() {
      // Fill with hex codes, then add ICE walls and bonus cells
      const pool = shuffle(HEX_POOL);
      let poolIdx = 0;
      const grid = [];

      // Decide special cells: 1 ICE wall + 1 bonus cell (randomly)
      const icePos = Math.floor(Math.random() * 24);  // 0-23 (skip a perimeter cell)
      const bonusType = Math.random() < 0.5 ? BONUS_TIME : BONUS_RESET;
      const bonusPos = (icePos + 1 + Math.floor(Math.random() * 22)) % 24; // spread apart

      let specialIdx = 0;
      for (let r = 0; r < 5; r++) {
        const row = [];
        for (let c = 0; c < 5; c++) {
          // Map flat index (0-24) to row/col
          const flatIdx = r * 5 + c;
          if (flatIdx === icePos) {
            row.push({ type: 'ice', code: 'ICE' });
          } else if (flatIdx === bonusPos) {
            row.push({ type: 'bonus', code: bonusType });
          } else {
            row.push({ type: 'normal', code: pool[poolIdx++ % pool.length] });
          }
        }
        grid.push(row);
      }
      return grid;
    }

    _generateTargets() {
      // Generate 2 targets, each 3 codes long (classic CP2077 style)
      const count = 2;
      const targets = [];
      // Use specific codes from the pool for reliability
      const usedCodes = new Set();

      for (let i = 0; i < count; i++) {
        const color = TARGET_COLORS[i % TARGET_COLORS.length];
        const seq = [];
        let attempts = 0;
        while (seq.length < 3 && attempts < 50) {
          attempts++;
          const code = HEX_POOL[Math.floor(Math.random() * HEX_POOL.length)];
          // Avoid duplicates within this sequence and across previous targets
          if (!seq.includes(code) && !usedCodes.has(code)) {
            seq.push(code);
          }
        }
        seq.forEach(c => usedCodes.add(c));
        targets.push({ seq, color });
      }
      return targets;
    }

    // ── Start position selection ──────────────────────────────────────────────
    _getAdjacentCells(row, col) {
      const adj = [];
      const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
      for (const [dr, dc] of dirs) {
        const nr = row + dr, nc = col + dc;
        if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5) {
          adj.push({ row: nr, col: nc });
        }
      }
      return adj;
    }

    _isStartPosition(row, col) {
      return this._startOptions.some(s => s.row === row && s.col === col);
    }

    // ── Cell interaction ─────────────────────────────────────────────────────
    _onCellClick(row, col) {
      if (this._phase === 'won' || this._phase === 'lost') return;

      const cell = this._grid[row][col];

      // If not started yet — only allow clicking on START perimeter cells
      if (!this._started) {
        if (cell.type === 'ice') return; // can't start on ICE
        if (!this._isStartPosition(row, col)) return;
        // Start!
        this._started = true;
        this._phase = 'playing';
        this._pos = { row, col };
        this._visited.add(`${row},${col}`);
        this._path.push({ row, col });
        this._collectCell(row, col);
        this._renderGrid();
        // Start the timer NOW (gives player time to read targets)
        this._startTimer();
        return;
      }

      // Already playing — can only move to adjacent unvisited non-ICE cells
      if (this._phase !== 'playing') return;
      if (cell.type === 'ice') return;
      if (this._visited.has(`${row},${col}`)) return;

      const adj = this._getAdjacentCells(this._pos.row, this._pos.col);
      if (!adj.some(a => a.row === row && a.col === col)) return;

      // Move!
      this._pos = { row, col };
      this._visited.add(`${row},${col}`);
      this._path.push({ row, col });
      this._collectCell(row, col);
      this._renderGrid();
    }

    _collectCell(row, col) {
      const cell = this._grid[row][col];

      if (cell.type === 'bonus') {
        if (cell.code === BONUS_TIME) {
          this._timeLeft = Math.min(20, this._timeLeft + 3);
          this._showBonusFlash(`+3 SECONDS`, '#39ff14');
        } else if (cell.code === BONUS_RESET) {
          this._buffer = [];
          this._bufferSlots = Array.from({ length: 7 }, () => '');
          this._showBonusFlash(`BUFFER RESET`, '#00f0ff');
        }
        // Bonus cells don't fill the buffer
      } else {
        // Normal hex code
        if (this._buffer.length >= 7) return; // shouldn't happen — overflow handled separately
        this._buffer.push(cell.code);
        this._bufferSlots[this._buffer.length - 1] = cell.code;
      }

      this._renderBuffer();
      this._checkWin();
    }

    _showBonusFlash(text, color) {
      const el = document.getElementById('bp-bonus-flash');
      if (!el) return;
      el.textContent = text;
      el.style.color = color;
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
      setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-20px)';
      }, 1200);
    }

    // ── Win/Lose check ───────────────────────────────────────────────────────
    _checkWin() {
      // Check if buffer starts with all targets consecutively
      const matched = this._countConsecutiveMatches();
      if (matched === this._targets.length) {
        this._win();
        return;
      }
      if (this._buffer.length >= 7) {
        if (matched < this._targets.length) {
          this._lose('BUFFER OVERFLOW');
        }
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
        gain.gain.value = 0.15;
        gain.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.connect(gain);
        gain.connect(ctx.destination);

        if (type === 'collect') {
          osc.frequency.value = 800 + Math.random() * 400;
          osc.type = 'square';
          gain.gain.setValueAtTime(0.1, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.08);
        } else if (type === 'win') {
          osc.frequency.value = 523;
          osc.type = 'sine';
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          osc.start(ctx.currentTime);
          osc.frequency.setValueAtTime(659, ctx.currentTime + 0.15);
          osc.frequency.setValueAtTime(784, ctx.currentTime + 0.3);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
          osc.stop(ctx.currentTime + 0.6);
        } else if (type === 'lose') {
          osc.frequency.value = 200;
          osc.type = 'sawtooth';
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.5);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
          osc.start(ctx.currentTime);
          osc.stop(ctx.currentTime + 0.5);
        }
      } catch (e) {
        // Audio not supported — silent fail
      }
    }

    // ── Input ───────────────────────────────────────────────────────────────
    _setupInput() {
      this._keyHandler = (e) => {
        if (this._phase === 'won' || this._phase === 'lost') return;
        if (e.key === 'Escape') { this._restart(); return; }
        if (!this._started) {
          // Before starting: allow starting from any perimeter cell via keyboard
          if (e.key === 'Enter' || e.key === ' ') {
            // Start from the first available position
            if (this._startOptions.length > 0) {
              const s = this._startOptions[0];
              this._onCellClick(s.row, s.col);
            }
          }
          return;
        }
        if (this._phase !== 'playing') return;
        const dirs = {
          ArrowUp: [-1, 0], w: [-1, 0], W: [-1, 0],
          ArrowDown: [1, 0], s: [1, 0], S: [1, 0],
          ArrowLeft: [0, -1], a: [0, -1], A: [0, -1],
          ArrowRight: [0, 1], d: [0, 1], D: [0, 1],
        };
        const d = dirs[e.key];
        if (!d) return;
        e.preventDefault();
        const adj = this._getAdjacentCells(this._pos.row, this._pos.col);
        // Pick the first valid adjacent cell in that direction
        const target = adj.find(a => a.row === this._pos.row + d[0] && a.col === this._pos.col + d[1]);
        if (target) this._onCellClick(target.row, target.col);
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

          <!-- Timer row -->
          <div class="bp-timer-row">
            <div class="bp-timer-label">TIME</div>
            <div class="bp-timer-bar-wrap">
              <div class="bp-timer-bar" id="bp-timer-bar"></div>
            </div>
            <div class="bp-timer-value" id="bp-timer-value">20</div>
          </div>

          <!-- Bonus flash -->
          <div class="bp-bonus-flash" id="bp-bonus-flash"></div>

          <!-- Targets -->
          <div class="bp-targets-section">
            <div class="bp-section-label">// TARGET SEQUENCES</div>
            <div class="bp-targets" id="bp-targets"></div>
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

          <!-- Controls -->
          <div class="bp-controls">
            <button class="bp-btn-restart" id="bp-restart-btn">↺ RESTART</button>
          </div>

          <!-- Instructions -->
          <div class="bp-instructions">
            <span id="bp-instr-text">CLICK A START CELL ON THE GRID PERIMETER</span>
            <span>·</span>
            <span>THEN CLICK ADJACENT CELLS TO MOVE</span>
          </div>
        </div>
      </div>
      `;

      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container.firstElementChild);
      this._overlay = document.getElementById('bp-overlay');

      // Restart button
      document.getElementById('bp-restart-btn').addEventListener('click', () => this._restart());

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
        `<div class="bp-target" data-color="${t.color}" style="border-color:${t.color};">
          ${t.seq.map(c => `<span class="bp-hex" style="background:${t.color}20;border-color:${t.color};color:${t.color};text-shadow:0 0 8px ${t.color}">${c}</span>`).join('')}
          <span class="bp-target-check" id="bp-check-${t.seq[0]}">✓</span>
        </div>`
      ).join('');
    }

    _renderBuffer() {
      const el = document.getElementById('bp-buffer');
      if (!el) return;

      const matched = this._countConsecutiveMatches();
      let matchedUpTo = 0;
      el.innerHTML = this._bufferSlots.map((code, i) => {
        let slotClass = 'bp-buf-slot';
        let filled = i < this._buffer.length;
        let codeColor = '#00f0ff';
        let bgColor = 'rgba(0,240,255,0.06)';

        if (filled) {
          // Find which target this slot belongs to for coloring
          let bufIdx = 0;
          for (let t = 0; t < this._targets.length; t++) {
            const target = this._targets[t];
            if (bufIdx + target.seq.length <= i + 1 && bufIdx <= i) {
              const inTarget = i - bufIdx < target.seq.length;
              if (inTarget) {
                codeColor = target.color;
                bgColor = target.color + '15';
              }
              bufIdx += target.seq.length;
            }
          }
        }

        return `<div class="${slotClass}${filled ? ' filled' : ''}" style="${filled ? `border-color:${codeColor};background:${bgColor}` : ''}">
          <span class="bp-buf-code" style="${filled ? `color:${codeColor};text-shadow:0 0 6px ${codeColor}` : ''}">${code || '──'}</span>
        </div>`;
      }).join('');

      // Update target matched states
      this._targets.forEach((t, ti) => {
        const checkEl = document.getElementById(`bp-check-${t.seq[0]}`);
        if (!checkEl) return;
        const targetRow = el.parentElement.querySelector(`.bp-target[data-color="${t.color}"]`);
        if (ti < matched) {
          checkEl.style.opacity = '1';
          if (targetRow) targetRow.classList.add('matched');
        } else {
          checkEl.style.opacity = '0';
          if (targetRow) targetRow.classList.remove('matched');
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
          const cell = this._grid[r][c];
          const key = `${r},${c}`;
          const isVisited = this._visited.has(key);
          const isPos = this._pos && this._pos.row === r && this._pos.col === c;
          const isStart = this._isStartPosition(r, c) && !this._started && cell.type !== 'ice';
          const isAdjacent = this._pos && this._getAdjacentCells(this._pos.row, this._pos.col).some(a => a.row === r && a.col === c);
          const canClick = (isStart || (isAdjacent && !isVisited && cell.type !== 'ice'));

          const cellEl = document.createElement('div');
          let classes = 'bp-cell';
          if (cell.type === 'ice')    classes += ' ice';
          if (cell.type === 'bonus')   classes += ' bonus';
          if (isVisited)               classes += ' visited';
          if (isPos)                  classes += ' pos';
          if (isStart)                classes += ' start-cell';
          if (isAdjacent && !isVisited && cell.type !== 'ice') classes += ' can-move';
          if (canClick)                classes += ' clickable';

          cellEl.className = classes;
          cellEl.dataset.row = r;
          cellEl.dataset.col = c;

          // Cell content
          if (cell.type === 'ice') {
            cellEl.innerHTML = `<span class="bp-ice-text">ICE</span>`;
          } else if (cell.type === 'bonus') {
            cellEl.innerHTML = `<span class="bp-bonus-text">${cell.code}</span>`;
          } else {
            cellEl.textContent = cell.code;
          }

          if (canClick) {
            cellEl.addEventListener('click', () => {
              this._playSound('collect');
              this._onCellClick(r, c);
            });
          }

          rowEl.appendChild(cellEl);
        }
        el.appendChild(rowEl);
      }

      // Update instructions
      const instr = document.getElementById('bp-instr-text');
      if (instr) {
        if (!this._started) {
          instr.textContent = 'CLICK A START CELL ON THE GRID PERIMETER';
        } else {
          instr.textContent = 'COLLECT ALL TARGET SEQUENCES IN ORDER';
        }
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
        ? `<div class="bp-result-text">ACCESS GRANTED</div><div class="bp-result-sub">ICE BREACHED. PROCEEDING...</div>`
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
