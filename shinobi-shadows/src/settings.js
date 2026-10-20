import { QUALITY } from './post.js';

// Player settings (graphics quality, volumes), remembered in localStorage
// when it's available.

const KEY = 'shinobi-shadows-settings';
// Phones and tablets start on Medium.
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const DEFAULTS = { quality: coarse ? 'medium' : 'high', master: 0.8, music: 0.6, sfx: 0.9 };

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

/** Renders the settings controls into `el`; calls onChange(key, value). */
export function renderSettings(el, settings, onChange) {
  el.innerHTML = `
    <div class="setting">
      <label>Graphics</label>
      <div class="seg">${Object.entries(QUALITY).map(([k, q]) => `<button data-q="${k}" class="${settings.quality === k ? 'on' : ''}">${q.label}</button>`).join('')}</div>
    </div>
    ${['master', 'music', 'sfx'].map((k) => `
      <div class="setting">
        <label>${{ master: 'Volume', music: 'Music', sfx: 'Effects' }[k]}</label>
        <input type="range" min="0" max="1" step="0.05" value="${settings[k]}" data-v="${k}">
      </div>`).join('')}`;
  el.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('[data-q]').forEach((o) => o.classList.toggle('on', o === b));
    onChange('quality', b.dataset.q);
  }));
  el.querySelectorAll('[data-v]').forEach((r) => r.addEventListener('input', () => onChange(r.dataset.v, Number(r.value))));
}
