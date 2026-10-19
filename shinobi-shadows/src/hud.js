import { JUTSU } from './jutsu.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.hp = $('hp-fill');
    this.ck = $('ck-fill');
    this.ki = $('ki-value');
    this.kiRing = $('ki-ring');
    this.light = $('light-indicator');
    this.promptEl = $('prompt');
    this.flashEl = $('center-flash');
    this.log = $('msg-log');
    this.vignette = $('damage-vignette');
    this.objectiveEl = $('hud-objective');
    this.crosshair = $('crosshair');
    this.slots = [];
    this.flashTimer = null;
  }

  setup(character) {
    this.root.style.setProperty('--c', character.color);
    $('hud-kanji').textContent = character.kanji;
    $('hud-name').textContent = character.name.toUpperCase();
    const wrap = $('jutsu-slots');
    wrap.innerHTML = '';
    this.slots = character.jutsu.map((id, i) => {
      const j = JUTSU[id];
      const el = document.createElement('div');
      el.className = 'jutsu';
      el.style.setProperty('--jc', j.color);
      el.innerHTML = `<span class="slot-key">${i + 1}</span><div class="jk">${j.kanji}</div><div class="jn">${j.name}</div><div class="jc">${j.cost} chakra</div><div class="cd"></div>`;
      wrap.appendChild(el);
      return { el, cd: el.querySelector('.cd'), j };
    });
    this.log.innerHTML = '';
    this.promptEl.textContent = '';
    this.flashEl.classList.remove('show');
  }

  show(v) { this.root.classList.toggle('hidden', !v); }

  update(player, ki, anyAlert, light, objective) {
    this.hp.style.width = `${(player.hp / player.maxHp) * 100}%`;
    this.ck.style.width = `${(player.chakra / player.maxChakra) * 100}%`;
    $('kunai-count').textContent = player.items.kunai;
    $('smoke-count').textContent = player.items.smoke;
    $('pill-count').textContent = player.items.pill;

    this.ki.textContent = anyAlert ? '!' : String(ki);
    const col = anyAlert ? '#ff3b2b' : ki >= 60 ? '#ff8a2b' : ki >= 25 ? '#ffd23a' : '#3d7bd9';
    this.kiRing.style.borderColor = col;
    this.kiRing.style.boxShadow = anyAlert || ki >= 60 ? `0 0 18px ${col}` : 'none';
    this.ki.style.color = col;

    // Light: how exposed you are to lanterns.
    this.light.style.color = light > 0.9 ? '#ffd23a' : light > 0.5 ? '#a0a0a0' : '#3a3a4a';
    this.light.title = light > 0.9 ? 'Exposed' : light > 0.5 ? 'Dim' : 'Hidden in shadow';

    this.slots.forEach((s, i) => {
      const cd = player.cooldowns[i];
      s.cd.style.height = `${(cd / s.j.cooldown) * 100}%`;
      s.el.classList.toggle('low', player.chakra < s.j.cost);
    });

    if (objective !== this._obj) { this._obj = objective; this.objectiveEl.textContent = objective; }
  }

  setPrompt(text) {
    if (text !== this._prompt) { this._prompt = text; this.promptEl.textContent = text; }
  }

  setGrappleAim(on) { this.crosshair.classList.toggle('grapple', on); }

  setSense() {
    // The red Crimson Eye view is drawn by the post-processing grade (post.js).
  }

  hurt() {
    this.vignette.style.opacity = '1';
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => { this.vignette.style.opacity = '0'; }, 180);
  }

  jutsuFlash(i) {
    const s = this.slots[i];
    if (!s) return;
    s.el.animate([{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }], { duration: 250 });
  }

  message(text, cls = '') {
    const d = document.createElement('div');
    d.textContent = text;
    if (cls === 'muted') d.style.color = '#a99f8c';
    this.log.appendChild(d);
    while (this.log.children.length > 5) this.log.firstChild.remove();
    setTimeout(() => d.remove(), 4000);
  }

  flash(kanji, sub = '', ms = 1100) {
    this.flashEl.innerHTML = `${kanji}${sub ? `<small>${sub}</small>` : ''}`;
    this.flashEl.classList.add('show');
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashEl.classList.remove('show'), ms);
  }
}
