// Keyboard + mouse state with pointer lock.

export class Input {
  constructor(element) {
    this.el = element;
    this.keys = new Set();
    this.pressed = new Set(); // keys pressed this frame
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.clicked = new Set();
    this.locked = false;
    this.enabled = false;
    this.onUnlock = null;

    window.addEventListener('keydown', (e) => {
      if (!this.enabled) return;
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Some browsers report a huge spurious jump right after locking.
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    element.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) this.lock();
      this.buttons.add(e.button);
      this.clicked.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    element.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.el;
      if (was && !this.locked && this.onUnlock) this.onUnlock();
    });
  }

  lock() {
    try {
      const p = this.el.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* pointer lock unavailable (e.g. sandboxed iframe) - arrow keys still turn the camera */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) { return this.keys.has(code); }
  hit(code) { return this.pressed.has(code); }
  mouseDown(b) { return this.buttons.has(b); }
  mouseHit(b) { return this.clicked.has(b); }

  endFrame() {
    this.pressed.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
  }
}
