// Game controller support (Bluetooth or USB pads, using the browser Gamepad API
// and its "standard" button layout). Like touch.js it feeds the shared Input
// object, so the game code doesn't know where its input came from. It also
// drives the menus: the D-pad or left stick moves a highlight, A presses.
//
//   left stick   move (push it all the way to sprint), L3 toggles sprint
//   right stick  look
//   A            jump / double jump          X or RT   strike / stealth kill
//   B or LT      grappling hook              Y         crouch
//   LB + X/Y/B   jutsu 1 / 2 / 3             RB        throw kunai
//   D-pad        ← smoke bomb  → soldier pill  ↑ kunai  ↓ crouch
//   Start        pause / resume              B in menus  back

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEAD = 0.18;
const LOOK_SPEED = 1300; // "mouse pixels" per second at full tilt

function dz(v) {
  const a = Math.abs(v);
  return a < DEAD ? 0 : Math.sign(v) * (a - DEAD) / (1 - DEAD);
}

export class Gamepads {
  constructor(game) {
    this.game = game;
    this.prev = new Map(); // pad index -> previous button states
    this.active = false;
    this.drove = false; // whether we set the analog move axes last frame
    this.held = new Set(); // keys we are holding down in Input
    this.sprintToggle = false;
    this.navT = 0;
    this.navDir = null;
    this.focus = null;
    window.addEventListener('gamepadconnected', (e) => {
      game.message?.(`Controller connected: ${e.gamepad.id.replace(/\s*\(.*\)\s*/g, ' ').trim() || 'gamepad'}`);
    });
    // Any mouse or touch use hides the menu highlight again.
    window.addEventListener('pointerdown', () => this.setFocus(null), true);
  }

  pads() {
    if (!navigator.getGamepads) return [];
    return [...navigator.getGamepads()].filter((p) => p && p.connected);
  }

  poll(dt) {
    const pads = this.pads();
    if (!pads.length) return;
    // Merge every connected pad (some phones expose one controller twice).
    const now = new Array(17).fill(0);
    let lx = 0, ly = 0, rx = 0, ry = 0;
    const edge = new Set();
    for (const p of pads) {
      const prev = this.prev.get(p.index) || [];
      const cur = p.buttons.map((b) => (typeof b === 'object' ? b.pressed || b.value > 0.5 : b > 0.5));
      cur.forEach((v, i) => {
        if (v) now[i] = 1;
        if (v && !prev[i]) edge.add(i);
      });
      this.prev.set(p.index, cur);
      const ax = p.axes;
      if (Math.abs(ax[0] || 0) > Math.abs(lx)) lx = ax[0] || 0;
      if (Math.abs(ax[1] || 0) > Math.abs(ly)) ly = ax[1] || 0;
      if (Math.abs(ax[2] || 0) > Math.abs(rx)) rx = ax[2] || 0;
      if (Math.abs(ax[3] || 0) > Math.abs(ry)) ry = ax[3] || 0;
    }
    const used = edge.size > 0 || Math.hypot(lx, ly) > 0.4 || Math.hypot(rx, ry) > 0.4;
    if (used && !this.active) {
      this.active = true;
      document.body.classList.add('pad');
    }
    if (!this.active) return;

    const g = this.game;
    const playing = g.mode === 'playing' && !g.overlay;
    if (playing) this.play(dt, now, edge, lx, ly, rx, ry);
    else this.releaseAll();
    if (!playing) this.menus(dt, now, edge, lx, ly);
    if (edge.has(BTN.START)) {
      if (playing) g.pause();
      else if (g.mode === 'paused' || g.overlay) g.resume();
    }
  }

  // ---------------- Gameplay ----------------

  play(dt, now, edge, lx, ly, rx, ry) {
    const input = this.game.input;
    if (!input.enabled) return;
    const mx = dz(lx), my = dz(ly);
    const mag = Math.hypot(mx, my);
    if (mag > 0) {
      input.moveX = mx;
      input.moveY = -my;
      if (edge.has(BTN.L3)) this.sprintToggle = !this.sprintToggle;
      input.touchSprint = this.sprintToggle || Math.hypot(lx, ly) > 0.95;
      this.drove = true;
    } else if (this.drove) {
      input.moveX = 0;
      input.moveY = 0;
      input.touchSprint = false;
      this.sprintToggle = false;
      this.drove = false;
    }

    // Look: a curve gives fine aim near the centre and fast turns at the edge.
    const cx = dz(rx), cy = dz(ry);
    input.mouseDX += cx * Math.abs(cx) * LOOK_SPEED * dt;
    input.mouseDY += cy * Math.abs(cy) * LOOK_SPEED * 0.7 * dt;

    const lb = now[BTN.LB];
    const hit = (b) => edge.has(b);
    const tap = (code) => input.pressed.add(code);
    if (lb) {
      // Jutsu chords.
      if (hit(BTN.X)) tap('Digit1');
      if (hit(BTN.Y)) tap('Digit2');
      if (hit(BTN.B)) tap('Digit3');
    } else {
      if (hit(BTN.X)) input.clicked.add(0);
      if (hit(BTN.B)) input.clicked.add(2);
      if (hit(BTN.Y)) tap('KeyC');
    }
    if (hit(BTN.RT)) input.clicked.add(0);
    if (hit(BTN.LT)) input.clicked.add(2);
    if (hit(BTN.RB) || hit(BTN.UP)) tap('KeyQ');
    if (hit(BTN.LEFT)) tap('KeyG');
    if (hit(BTN.RIGHT)) tap('KeyH');
    if (hit(BTN.DOWN)) tap('KeyC');
    this.hold('Space', now[BTN.A], hit(BTN.A));
  }

  hold(code, down, pressed) {
    const input = this.game.input;
    if (pressed) input.pressed.add(code);
    if (down) { input.keys.add(code); this.held.add(code); }
    else if (this.held.has(code)) { input.keys.delete(code); this.held.delete(code); }
  }

  releaseAll() {
    const input = this.game.input;
    for (const k of this.held) input.keys.delete(k);
    this.held.clear();
    if (this.drove) { input.moveX = 0; input.moveY = 0; input.touchSprint = false; this.drove = false; }
  }

  // ---------------- Menus ----------------

  /** Focusable things on the screen that's showing. */
  focusables() {
    const screen = [...document.querySelectorAll('.screen')].find((s) => !s.classList.contains('hidden'));
    if (!screen) return [];
    return [...screen.querySelectorAll('button, .card, input, [data-pad]')].filter((el) => !el.disabled && el.offsetParent !== null);
  }

  setFocus(el) {
    if (this.focus === el) return;
    this.focus?.classList.remove('pad-focus');
    this.focus = el;
    if (el) {
      el.classList.add('pad-focus');
      el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      el.dispatchEvent(new CustomEvent('padfocus', { bubbles: true }));
    }
  }

  menus(dt, now, edge, lx, ly) {
    const items = this.focusables();
    if (!items.length) { this.setFocus(null); return; }
    if (!items.includes(this.focus)) {
      const pref = items.find((el) => el.classList.contains('selected')) || items.find((el) => el.classList.contains('btn')) || items[0];
      this.setFocus(pref);
    }
    let dir = null;
    if (now[BTN.UP] || ly < -0.6) dir = 'up';
    else if (now[BTN.DOWN] || ly > 0.6) dir = 'down';
    else if (now[BTN.LEFT] || lx < -0.6) dir = 'left';
    else if (now[BTN.RIGHT] || lx > 0.6) dir = 'right';
    if (dir !== this.navDir) { this.navDir = dir; this.navT = 0; this.navRepeat = false; }
    if (dir) {
      this.navT -= dt;
      if (this.navT <= 0) {
        this.move(dir, items);
        // One step, a pause, then auto-repeat while held.
        this.navT = this.navRepeat ? 0.14 : 0.4;
        this.navRepeat = true;
      }
    }

    const f = this.focus;
    if (edge.has(BTN.A) && f) {
      if (f.type === 'range') return;
      f.click();
    }
    if (edge.has(BTN.B)) {
      const back = [...document.querySelectorAll('.screen:not(.hidden) [data-back]')].find((el) => el.offsetParent !== null);
      back?.click();
    }
  }

  move(dir, items) {
    const f = this.focus;
    // Sliders take left/right.
    if (f && f.type === 'range' && (dir === 'left' || dir === 'right')) {
      const step = Number(f.step) || 0.05;
      f.value = String(Math.min(Number(f.max), Math.max(Number(f.min), Number(f.value) + (dir === 'right' ? step : -step))));
      f.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (!f) { this.setFocus(items[0]); return; }
    const a = f.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestScore = Infinity;
    for (const el of items) {
      if (el === f) continue;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax, dy = b.top + b.height / 2 - ay;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 4) continue;
      const score = along + across * 2.5;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (best) { this.setFocus(best); return; }
    // Nothing that way: wrap around in document order for up/down.
    if (dir === 'up' || dir === 'down') {
      const i = items.indexOf(f);
      this.setFocus(items[(i + (dir === 'down' ? 1 : -1) + items.length) % items.length]);
    }
  }

  /** Controller rumble, where the browser and pad support it. */
  rumble(strength = 0.5, ms = 120) {
    if (!this.active) return;
    for (const p of this.pads()) {
      try {
        p.vibrationActuator?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: Math.min(1, strength * 1.4) })?.catch?.(() => {});
      } catch { /* not supported */ }
    }
  }
}
