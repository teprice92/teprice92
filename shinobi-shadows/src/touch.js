// Touch controls for phones and tablets. They switch on with the first touch
// and feed the same Input object as the keyboard and mouse, so the game code
// doesn't need to know where its input came from.
//
//   left side   floating joystick (push it to the edge to sprint)
//   right side  drag to look
//   buttons     strike, jump, grapple, crouch, pause; the HUD's jutsu slots
//               and item counters become tappable too.

const BUTTONS = [
  { id: 'strike', label: '斬', sub: 'Strike', click: 0 },
  { id: 'jump', label: '跳', sub: 'Jump', key: 'Space' },
  { id: 'grapple', label: '鉤', sub: 'Hook', click: 2 },
  { id: 'crouch', label: '伏', sub: 'Crouch', key: 'KeyC' },
];
const ITEM_KEYS = ['KeyQ', 'KeyG', 'KeyH'];
const JUTSU_KEYS = ['Digit1', 'Digit2', 'Digit3'];
const STICK_R = 56; // joystick travel in px
const LOOK_GAIN = 2.2;

export function setupTouch(game) {
  const start = () => {
    window.removeEventListener('touchstart', start);
    enableTouch(game);
  };
  window.addEventListener('touchstart', start, { passive: true });
}

function enableTouch(game) {
  const input = game.input;
  document.body.classList.add('touch');

  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div id="touch-move"><div id="stick-base"><div id="stick-knob"></div></div></div>
    <div id="touch-look"></div>
    <div id="touch-buttons">${BUTTONS.map((b) => `<button class="tbtn" data-id="${b.id}"><b>${b.label}</b><span>${b.sub}</span></button>`).join('')}</div>
    <button id="touch-pause" aria-label="Pause">❚❚</button>`;
  document.getElementById('hud').prepend(root); // HUD buttons stay on top of the touch zones

  const base = root.querySelector('#stick-base');
  const knob = root.querySelector('#stick-knob');
  let stickId = null, lookId = null;
  let sx = 0, sy = 0, lx = 0, ly = 0;

  const setStick = (dx, dy) => {
    const len = Math.hypot(dx, dy);
    const k = len > STICK_R ? STICK_R / len : 1;
    dx *= k; dy *= k;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    input.moveX = dx / STICK_R;
    input.moveY = -dy / STICK_R;
    const sprint = len > STICK_R * 0.95;
    input.touchSprint = sprint;
    base.classList.toggle('sprint', sprint);
  };

  const zone = root.querySelector('#touch-move');
  zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickId !== null) return;
    const t = e.changedTouches[0];
    stickId = t.identifier;
    sx = t.clientX; sy = t.clientY;
    base.style.left = `${sx}px`;
    base.style.top = `${sy}px`;
    base.classList.add('active');
    setStick(0, 0);
  }, { passive: false });

  const look = root.querySelector('#touch-look');
  look.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (lookId !== null) return;
    const t = e.changedTouches[0];
    lookId = t.identifier;
    lx = t.clientX; ly = t.clientY;
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) setStick(t.clientX - sx, t.clientY - sy);
      else if (t.identifier === lookId && input.enabled) {
        input.mouseDX += (t.clientX - lx) * LOOK_GAIN;
        input.mouseDY += (t.clientY - ly) * LOOK_GAIN;
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });

  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        stickId = null;
        setStick(0, 0);
        base.classList.remove('active');
      } else if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', end);
  window.addEventListener('touchcancel', end);

  // A tap on a button is a key press (or mouse click) for one frame; jump is
  // also held while the finger stays down.
  const press = (b) => {
    if (!input.enabled) return;
    if (b.click !== undefined) input.clicked.add(b.click);
    if (b.key) { input.pressed.add(b.key); input.keys.add(b.key); }
  };
  const release = (b) => { if (b.key) input.keys.delete(b.key); };
  root.querySelectorAll('.tbtn').forEach((el) => {
    const b = BUTTONS.find((x) => x.id === el.dataset.id);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); el.classList.add('down'); press(b); }, { passive: false });
    el.addEventListener('touchend', (e) => { e.preventDefault(); el.classList.remove('down'); release(b); }, { passive: false });
  });

  const tapKey = (code) => { if (input.enabled) input.pressed.add(code); };
  const delegate = (id, selector, keys) => {
    document.getElementById(id).addEventListener('touchstart', (e) => {
      const el = e.target.closest(selector);
      if (!el) return;
      e.preventDefault();
      const i = [...el.parentElement.children].indexOf(el);
      if (keys[i]) tapKey(keys[i]);
    }, { passive: false });
  };
  delegate('jutsu-slots', '.jutsu', JUTSU_KEYS);
  delegate('items', '.item', ITEM_KEYS);

  root.querySelector('#touch-pause').addEventListener('touchstart', (e) => {
    e.preventDefault();
    game.pause();
  }, { passive: false });

  // Phones: pause when the app is backgrounded.
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

  // The hint text and tips assume a keyboard; swap them for touch versions.
  const hint = document.querySelector('#screen-title .hint');
  if (hint) hint.textContent = 'Touch controls on. Landscape works best.';
  game.touch = true;
}

/** Tries to go fullscreen in landscape (phones only allow this from a tap). */
export function goFullscreen() {
  const el = document.documentElement;
  try {
    const p = el.requestFullscreen?.({ navigationUI: 'hide' });
    p?.then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
  } catch { /* not supported */ }
}
