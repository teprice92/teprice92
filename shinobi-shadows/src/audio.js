// Synthesised audio: sound effects, night ambience and a generative score.
// No audio files: everything is built from oscillators, filtered noise and
// a generated reverb impulse.
//
//   voices -> [gain] -> [panner] -> sfx / music / ambience bus -> master -> compressor -> out
//                                \-> reverb send ------------------------^

let ctx = null;
let master, sfxBus, musicBus, ambBus, reverbIn, noiseBuf;
let scheduler = null;
const vol = { master: 0.8, music: 0.6, sfx: 0.9 };
const listener = { x: 0, y: 0, z: 0, yaw: 0 };
let musicState = 'menu';
let pondPos = null;

// ---------------- Setup ----------------

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 4;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.connect(comp);
  sfxBus = ctx.createGain();
  musicBus = ctx.createGain();
  ambBus = ctx.createGain();
  sfxBus.connect(master); musicBus.connect(master); ambBus.connect(master);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(2.8, 2.6);
  reverbIn = ctx.createGain();
  reverbIn.gain.value = 0.55;
  reverbIn.connect(reverb).connect(master);

  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  applyVolumes();
  startAmbience();
  music.next = ctx.currentTime + 0.3;
  scheduler = setInterval(tick, 50);
  loadSamples();
  loadMusic();
}

// ---------------- Recorded samples (ElevenLabs) and music (Suno) ----------------
//
// Recorded sounds live in assets/audio. Each one replaces its synthesised
// counterpart once loaded; anything missing keeps the synthesised version.

const SAMPLE_NAMES = {
  sfx: ['swing', 'hit', 'clank', 'stealthKill', 'bodyFall', 'throw', 'kunaiHit', 'arrow', 'hurt', 'jump', 'land',
    'grapple', 'poof', 'rasengan', 'lightning', 'fire', 'boom', 'earth', 'heal', 'shadow', 'seal', 'alert',
    'suspicious', 'ambNight', 'ambPond', 'owl', 'stepGravel', 'stepGrass', 'stepWood', 'stepRoof'],
  voice: ['who', 'noise', 'intruder', 'body', 'wind', 'die', 'lordAlert', 'lordDie'],
};
// Per-sample loudness trims (samples are normalised to the same loudness).
const SAMPLE_GAIN = { swing: 0.7, hit: 0.8, throw: 0.8, jump: 0.45, land: 0.6, seal: 0.6, suspicious: 0.55, alert: 0.85, owl: 0.5, heal: 0.7 };
const buffers = new Map();

async function loadSamples() {
  await Promise.all(Object.entries(SAMPLE_NAMES).flatMap(([dir, names]) => names.map(async (n) => {
    try {
      const res = await fetch(`assets/audio/${dir}/${n}.mp3`);
      if (!res.ok) return;
      buffers.set(`${dir}/${n}`, await ctx.decodeAudioData(await res.arrayBuffer()));
      if (n === 'ambNight') startSampleAmbience();
      if (n === 'ambPond') startPondLoop();
    } catch { /* keep the synthesised sound */ }
  })));
}

function playBuffer(buf, dest, t, { rate = 1, gain = 1, loop = false } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.loop = loop;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g).connect(dest);
  src.start(t);
  return { src, g };
}

// Music: loop one file per state, crossfading between them.
const MUSIC_FILES = { menu: 'menu', calm: 'stealth', tense: 'tense', alert: 'alert', victory: 'victory', defeat: 'defeat' };
const tracks = {};

async function loadMusic() {
  for (const [state, file] of Object.entries(MUSIC_FILES)) {
    const url = `assets/audio/music/${file}.mp3`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (!head.ok) continue;
    } catch { continue; }
    const el = new Audio(url);
    el.loop = state !== 'victory' && state !== 'defeat';
    el.preload = 'auto';
    const node = ctx.createMediaElementSource(el);
    const g = ctx.createGain();
    g.gain.value = 0;
    node.connect(g).connect(musicBus);
    tracks[state] = { el, g };
  }
  updateMusicTracks();
}

function hasTrack(state) { return !!tracks[state]; }

function updateMusicTracks() {
  if (!ctx) return;
  const t = ctx.currentTime;
  // Tense falls back to the stealth track if only some exist; missing gameplay
  // tracks keep the generated score (the menu theme stays on the menus).
  const want = hasTrack(musicState) ? musicState
    : musicState === 'tense' && hasTrack('calm') ? 'calm' : null;
  for (const [state, tr] of Object.entries(tracks)) {
    if (state === 'victory' || state === 'defeat') continue;
    const on = state === want;
    tr.g.gain.setTargetAtTime(on ? 1.6 : 0, t, on ? 0.6 : 0.9);
    if (on && tr.el.paused) tr.el.play().catch(() => {});
    if (!on && !tr.el.paused) setTimeout(() => { if (tr.g.gain.value < 0.02) tr.el.pause(); }, 4000);
  }
  fileMusicActive = !!want;
}
let fileMusicActive = false;

/** One-shot result music (victory / defeat); returns false if there's no file. */
function playResultTrack(state) {
  const tr = tracks[state];
  if (!tr) return false;
  for (const [k, o] of Object.entries(tracks)) if (k !== state) o.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
  tr.g.gain.setTargetAtTime(1.6, ctx.currentTime, 0.05);
  tr.el.currentTime = 0;
  tr.el.play().catch(() => {});
  fileMusicActive = true;
  return true;
}

// Guard voice lines, with a cooldown so they don't talk over each other.
let voiceUntil = 0;
export function voice(name, pos = null, { force = false } = {}) {
  if (!ctx || ctx.state !== 'running') return;
  const buf = buffers.get(`voice/${name}`);
  if (!buf) return;
  const t = ctx.currentTime;
  if (!force && t < voiceUntil) return;
  const sp = spatial(pos);
  if (!sp) return;
  voiceUntil = t + buf.duration * 0.8;
  playBuffer(buf, out(sfxBus, { pan: sp.pan, send: sp.send, gain: Math.min(1, sp.gain * 1.6) }), t, { rate: 0.97 + Math.random() * 0.06 });
}

function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

function applyVolumes() {
  if (!ctx) return;
  const t = ctx.currentTime;
  master.gain.setTargetAtTime(vol.master * 0.9, t, 0.05);
  sfxBus.gain.setTargetAtTime(vol.sfx, t, 0.05);
  ambBus.gain.setTargetAtTime(vol.sfx * 0.8, t, 0.05);
  musicBus.gain.setTargetAtTime(vol.music * 0.55, t, 0.05);
}

export function setVolume(kind, value) { vol[kind] = value; applyVolumes(); }
export function getVolumes() { return { ...vol }; }
export function setListener(pos, yaw) { listener.x = pos.x; listener.y = pos.y; listener.z = pos.z; listener.yaw = yaw; }
export function setPond(pos) { pondPos = pos; }
export function setMusicState(state) {
  if (state === musicState) return;
  musicState = state;
  music.step = 0;
  updateMusicTracks();
}

// ---------------- Voice helpers ----------------

/** Output node for a voice: panned, routed to a bus with a reverb send. */
function out(bus, { pan = 0, send = 0.15, gain = 1 } = {}) {
  const g = ctx.createGain();
  g.gain.value = gain;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  g.connect(p);
  p.connect(bus);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = send;
    p.connect(s).connect(reverbIn);
  }
  return g;
}

/** Gain/pan/reverb for a sound at a world position, or null if inaudible. */
function spatial(pos) {
  if (!pos) return { gain: 1, pan: 0, send: 0.15 };
  const dx = pos.x - listener.x, dy = (pos.y || 0) - listener.y, dz = pos.z - listener.z;
  const d = Math.hypot(dx, dy, dz);
  if (d > 70) return null;
  const rx = -Math.cos(listener.yaw), rz = Math.sin(listener.yaw);
  const pan = d > 0.5 ? ((dx * rx + dz * rz) / d) * Math.min(1, d / 4) : 0;
  return { gain: 1 / (1 + (d * d) / 150), pan: pan * 0.85, send: 0.12 + Math.min(0.5, d / 50) };
}

function env(g, t, peak, attack, dur, curve = 'exp') {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  else g.gain.linearRampToValueAtTime(0.0001, t + dur);
}

function osc(dest, t, dur, { type = 'sine', freq = 440, freqEnd = null, gain = 0.3, attack = 0.005, detune = 0, curve = 'exp' } = {}) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  o.detune.value = detune;
  const g = ctx.createGain();
  env(g, t, gain, attack, dur, curve);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function noise(dest, t, dur, { type = 'bandpass', freq = 1200, freqEnd = null, q = 1, gain = 0.4, attack = 0.004, curve = 'exp' } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, gain, attack, dur, curve);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.05);
}

// ---------------- Instruments ----------------

/** Koto-like pluck: bright attack, decaying filter, slight bend. */
function koto(dest, t, freq, { gain = 0.22, decay = 2.2, bend = true } = {}) {
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(freq * 9, t);
  f.frequency.exponentialRampToValueAtTime(freq * 1.6, t + decay * 0.6);
  f.Q.value = 2;
  const g = ctx.createGain();
  env(g, t, gain, 0.003, decay);
  f.connect(g).connect(dest);
  for (const [mult, type, lvl] of [[1, 'triangle', 1], [2, 'sine', 0.35], [3.01, 'sine', 0.18]]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq * mult * (bend ? 1.012 : 1), t);
    o.frequency.exponentialRampToValueAtTime(freq * mult, t + 0.06);
    const og = ctx.createGain();
    og.gain.value = lvl;
    o.connect(og).connect(f);
    o.start(t);
    o.stop(t + decay + 0.1);
  }
  noise(dest, t, 0.02, { type: 'highpass', freq: 3000, gain: gain * 0.5 });
}

/** Breathy end-blown flute in the style of a shakuhachi. */
function flute(dest, t, freq, dur, { gain = 0.13 } = {}) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq * 0.97, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.18);
  o.frequency.setValueAtTime(freq, t + dur * 0.75);
  o.frequency.exponentialRampToValueAtTime(freq * 0.94, t + dur); // falling "meri" at the end
  const vib = ctx.createOscillator();
  vib.frequency.value = 5;
  const vibAmt = ctx.createGain();
  vibAmt.gain.setValueAtTime(0, t);
  vibAmt.gain.linearRampToValueAtTime(freq * 0.012, t + dur * 0.8);
  vib.connect(vibAmt).connect(o.frequency);
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = freq * 2;
  const o2g = ctx.createGain();
  o2g.gain.value = 0.12;
  o2.connect(o2g);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * 4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.25);
  g.gain.setValueAtTime(gain, t + dur - 0.35);
  g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(lp); o2g.connect(lp);
  lp.connect(g).connect(dest);
  for (const n of [o, o2, vib]) { n.start(t); n.stop(t + dur + 0.05); }
  // Breath
  noise(dest, t, dur, { type: 'bandpass', freq: freq * 2.2, q: 3, gain: gain * 0.35, attack: 0.2, curve: 'lin' });
}

function taiko(dest, t, { gain = 0.6, pitch = 1 } = {}) {
  osc(dest, t, 0.55, { freq: 95 * pitch, freqEnd: 48 * pitch, gain, attack: 0.002 });
  osc(dest, t, 0.2, { freq: 190 * pitch, freqEnd: 90 * pitch, gain: gain * 0.3, attack: 0.002 });
  noise(dest, t, 0.18, { type: 'lowpass', freq: 400, gain: gain * 0.6 });
}

function ka(dest, t, gain = 0.25) {
  noise(dest, t, 0.04, { type: 'bandpass', freq: 2200, q: 4, gain });
  osc(dest, t, 0.05, { type: 'triangle', freq: 1100, gain: gain * 0.5 });
}

// ---------------- Generative score ----------------

// In-sen scale on D: D Eb G A C
const IN_SEN = [0, 1, 5, 7, 10];
function note(degree, base = 293.66) {
  const oct = Math.floor(degree / 5);
  const idx = ((degree % 5) + 5) % 5;
  return base * Math.pow(2, oct + IN_SEN[idx] / 12);
}

const music = { next: 0, step: 0, degree: 3, phraseLeft: 0 };
let drone = null;

function startDrone() {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 260;
  const g = ctx.createGain();
  g.gain.value = 0;
  lp.connect(g);
  g.connect(out(musicBus, { send: 0.4 }));
  for (const [f, det] of [[73.42, -6], [73.42, 7], [110, 3]]) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.value = det;
    const og = ctx.createGain();
    og.gain.value = 0.25;
    o.connect(og).connect(lp);
    o.start();
  }
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoAmt = ctx.createGain();
  lfoAmt.gain.value = 120;
  lfo.connect(lfoAmt).connect(lp.frequency);
  lfo.start();
  drone = { gain: g, filter: lp };
}

function scheduleMusic(t) {
  const s = musicState;
  if (fileMusicActive) {
    // A recorded track is playing: keep the generative score quiet.
    if (drone) drone.gain.gain.setTargetAtTime(0, t, 0.8);
    return 0.5;
  }
  const dest = out(musicBus, { send: 0.45, pan: (Math.random() - 0.5) * 0.8 });
  const walk = (lo, hi) => {
    music.degree = Math.max(lo, Math.min(hi, music.degree + Math.floor(Math.random() * 5) - 2));
    return music.degree;
  };
  if (drone) {
    const target = { menu: 0.05, calm: 0.035, tense: 0.07, alert: 0.11, silent: 0 }[s] ?? 0.04;
    drone.gain.gain.setTargetAtTime(target, t, 1.5);
    drone.filter.frequency.setTargetAtTime(s === 'alert' ? 520 : s === 'tense' ? 380 : 240, t, 1);
  }

  if (s === 'menu' || s === 'calm') {
    const beat = s === 'menu' ? 0.55 : 0.65;
    if (Math.random() < (s === 'menu' ? 0.42 : 0.22)) {
      const d = walk(0, 9);
      koto(dest, t, note(d), { gain: s === 'menu' ? 0.2 : 0.14 });
      if (Math.random() < 0.2) koto(dest, t + beat / 2, note(d - 2), { gain: 0.1 });
    }
    if (music.phraseLeft <= 0 && music.step % 16 === 0 && Math.random() < (s === 'menu' ? 0.6 : 0.3)) music.phraseLeft = 3;
    if (music.phraseLeft > 0 && music.step % 4 === 0) {
      music.phraseLeft--;
      flute(out(musicBus, { send: 0.6 }), t, note(walk(2, 9)), beat * (3 + Math.random() * 2), { gain: s === 'menu' ? 0.12 : 0.08 });
    }
    music.step++;
    return beat;
  }

  if (s === 'tense') {
    const beat = 0.32;
    const pat = [0, null, 1, null, 0, null, null, -1];
    const d = pat[music.step % 8];
    if (d !== null) koto(dest, t, note(d, 146.83), { gain: 0.16, decay: 0.9, bend: false });
    if (music.step % 8 === 0) { taiko(out(musicBus, { send: 0.3 }), t, { gain: 0.3, pitch: 0.8 }); taiko(out(musicBus, { send: 0.3 }), t + 0.22, { gain: 0.2, pitch: 0.8 }); }
    if (Math.random() < 0.08) flute(out(musicBus, { send: 0.6 }), t, note(6 + Math.floor(Math.random() * 3)), 1.4, { gain: 0.06 });
    music.step++;
    return beat;
  }

  if (s === 'alert') {
    const beat = 0.2; // 8th notes at 150 bpm
    const step = music.step % 16;
    const tk = out(musicBus, { send: 0.25 });
    if ([0, 3, 6, 8, 10, 12, 14].includes(step)) taiko(tk, t, { gain: step === 0 || step === 8 ? 0.75 : 0.5 });
    if ([2, 5, 7, 11, 13, 15].includes(step)) ka(tk, t, 0.18);
    if (step % 2 === 0) koto(dest, t, note(walk(3, 12)), { gain: 0.13, decay: 0.6 });
    if (step === 0 && Math.random() < 0.5) flute(out(musicBus, { send: 0.5 }), t, note(10), 0.9, { gain: 0.09 });
    music.step++;
    return beat;
  }
  music.step++;
  return 0.5;
}

// ---------------- Ambience ----------------

function loopNoise(dest, { type, freq, q = 1, gain }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(dest);
  src.start();
  return { f, g };
}

let synthAmb = null;

function startAmbience() {
  // All synthesised ambience goes through one gain so recorded ambience can replace it.
  synthAmb = ctx.createGain();
  synthAmb.connect(ambBus);
  // Wind: low rumble whose brightness drifts slowly.
  const wind = loopNoise(out(synthAmb, { send: 0.1 }), { type: 'lowpass', freq: 500, q: 0.7, gain: 0.07 });
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.05;
  const amt = ctx.createGain();
  amt.gain.value = 260;
  lfo.connect(amt).connect(wind.f.frequency);
  lfo.start();
  // Distant cricket field: narrow noise band pulsed rapidly.
  for (const pan of [-0.7, 0.7]) {
    // Base gain + square tremolo of the same depth = pulses between 0 and 2x.
    const bed = loopNoise(out(synthAmb, { pan, send: 0.3 }), { type: 'bandpass', freq: pan < 0 ? 4300 : 4700, q: 12, gain: 0.025 });
    const pulse = ctx.createOscillator();
    pulse.type = 'square';
    pulse.frequency.value = pan < 0 ? 17 : 21;
    const pg = ctx.createGain();
    pg.gain.value = 0.025;
    pulse.connect(pg).connect(bed.g.gain);
    pulse.start();
  }
  startDrone();
}

const amb = { cricket: 0, owl: 12, frog: 0, pond: null };

function startSampleAmbience() {
  playBuffer(buffers.get('sfx/ambNight'), out(ambBus, { send: 0.05 }), ctx.currentTime, { loop: true, gain: 0.55 });
  synthAmb.gain.setTargetAtTime(0.25, ctx.currentTime, 2); // keep a little synth texture underneath
}

function startPondLoop() {
  const g = out(ambBus, { send: 0.2, gain: 0 });
  playBuffer(buffers.get('sfx/ambPond'), g, ctx.currentTime, { loop: true, gain: 0.9 });
  amb.pond = g;
}

function scheduleAmbience(now) {
  if (now >= amb.cricket) {
    amb.cricket = now + 0.15 + Math.random() * 0.7;
    const d = out(synthAmb, { pan: Math.random() * 2 - 1, send: 0.35 });
    const f = 4200 + Math.random() * 900;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) osc(d, now + i * 0.045, 0.025, { freq: f, gain: 0.03 + Math.random() * 0.02, attack: 0.004 });
  }
  if (now >= amb.owl) {
    amb.owl = now + 22 + Math.random() * 30;
    const owlBuf = buffers.get('sfx/owl');
    if (owlBuf) {
      playBuffer(owlBuf, out(ambBus, { pan: Math.random() * 1.6 - 0.8, send: 0.7 }), now, { gain: 0.35, rate: 0.95 + Math.random() * 0.1 });
      return;
    }
    const d = out(ambBus, { pan: Math.random() * 1.6 - 0.8, send: 0.8, gain: 0.7 });
    const f = 360 + Math.random() * 40;
    osc(d, now, 0.5, { freq: f, freqEnd: f * 0.92, gain: 0.07, attack: 0.08 });
    osc(d, now + 0.7, 0.25, { freq: f * 1.02, freqEnd: f * 0.95, gain: 0.05, attack: 0.05 });
    osc(d, now + 1.0, 0.6, { freq: f, freqEnd: f * 0.9, gain: 0.07, attack: 0.08 });
  }
  if (amb.pond && pondPos) {
    // Recorded frog loop: louder and panned as you approach the pond.
    const sp = spatial(pondPos);
    amb.pond.gain.setTargetAtTime(sp ? Math.min(1, sp.gain * 1.5) : 0, now, 0.3);
    return;
  }
  if (pondPos && now >= amb.frog) {
    amb.frog = now + 0.4 + Math.random() * 1.6;
    const sp = spatial(pondPos);
    if (sp && sp.gain > 0.05) {
      const d = out(ambBus, { pan: sp.pan, send: sp.send, gain: sp.gain });
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = 110 + Math.random() * 40;
      const am = ctx.createOscillator();
      am.frequency.value = 28;
      const amg = ctx.createGain();
      amg.gain.value = 0.5;
      const g = ctx.createGain();
      env(g, now, 0.09, 0.02, 0.28);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      am.connect(amg).connect(g.gain);
      o.connect(bp).connect(g).connect(d);
      o.start(now); am.start(now); o.stop(now + 0.32); am.stop(now + 0.32);
    }
  }
}

function tick() {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  while (music.next < now + 0.25) {
    if (music.next < now) music.next = now + 0.02;
    music.next += scheduleMusic(music.next);
  }
  scheduleAmbience(now);
}

// ---------------- Footsteps ----------------

export function footstep(surface, intensity = 1, pos = null) {
  if (!ctx || ctx.state !== 'running') return;
  const sp = spatial(pos);
  if (!sp) return;
  const t = ctx.currentTime;
  const d = out(sfxBus, { pan: sp.pan, send: sp.send * 0.5, gain: sp.gain * intensity });
  const stepBuf = buffers.get(`sfx/${{ gravel: 'stepGravel', grass: 'stepGrass', wood: 'stepWood', roof: 'stepRoof', stone: 'stepGravel' }[surface] || 'stepGrass'}`);
  if (stepBuf) {
    // Vary pitch and level a little so repeated steps don't sound identical.
    playBuffer(stepBuf, d, t, { rate: (surface === 'stone' ? 1.25 : 1) * (0.88 + Math.random() * 0.24), gain: 0.45 + Math.random() * 0.15 });
    return;
  }
  switch (surface) {
    case 'gravel':
      for (let i = 0; i < 5; i++) noise(d, t + i * (0.006 + Math.random() * 0.012), 0.014, { type: 'highpass', freq: 2200 + Math.random() * 1500, gain: 0.16 });
      noise(d, t, 0.06, { type: 'lowpass', freq: 400, gain: 0.18 });
      break;
    case 'wood':
      osc(d, t, 0.09, { freq: 170, freqEnd: 110, gain: 0.22 });
      noise(d, t, 0.05, { type: 'lowpass', freq: 900, gain: 0.15 });
      break;
    case 'roof':
      noise(d, t, 0.04, { type: 'bandpass', freq: 1500, q: 5, gain: 0.2 });
      osc(d, t, 0.05, { type: 'triangle', freq: 760 + Math.random() * 120, gain: 0.07 });
      noise(d, t + 0.03, 0.03, { type: 'bandpass', freq: 1900, q: 5, gain: 0.08 });
      break;
    case 'stone':
      noise(d, t, 0.035, { type: 'bandpass', freq: 2600, q: 1.5, gain: 0.16 });
      osc(d, t, 0.06, { freq: 140, freqEnd: 90, gain: 0.12 });
      break;
    default: // grass
      noise(d, t, 0.1, { type: 'bandpass', freq: 1100 + Math.random() * 500, q: 0.8, gain: 0.14 });
      noise(d, t + 0.02, 0.06, { type: 'highpass', freq: 3500, gain: 0.04 });
  }
}

// ---------------- Sound effects ----------------

const SFX = {
  ui: (d, t) => osc(d, t, 0.06, { type: 'triangle', freq: 1400, freqEnd: 1100, gain: 0.08 }),
  swing: (d, t) => {
    noise(d, t, 0.2, { freq: 3200, freqEnd: 700, q: 1.6, gain: 0.45, attack: 0.03 });
    noise(d, t, 0.12, { type: 'highpass', freq: 5000, gain: 0.08, attack: 0.02 });
  },
  hit: (d, t) => {
    osc(d, t, 0.16, { freq: 130, freqEnd: 50, gain: 0.5 });
    noise(d, t, 0.1, { type: 'lowpass', freq: 1600, gain: 0.55 });
    noise(d, t, 0.025, { type: 'highpass', freq: 3000, gain: 0.3 });
  },
  clank: (d, t) => {
    const f = 900 + Math.random() * 300;
    [[1, 0.09], [2.76, 0.06], [5.4, 0.04], [8.93, 0.025]].forEach(([m, g]) => osc(d, t, 0.6, { freq: f * m, gain: g, attack: 0.001 }));
    noise(d, t, 0.03, { type: 'highpass', freq: 4000, gain: 0.25 });
  },
  stealthKill: (d, t) => {
    noise(d, t, 0.14, { freq: 4500, freqEnd: 1200, q: 2, gain: 0.5, attack: 0.01 });
    [[1, 0.06], [2.4, 0.04], [4.1, 0.025]].forEach(([m, g]) => osc(d, t + 0.02, 1.2, { freq: 2300 * m, gain: g, attack: 0.001 }));
    noise(d, t + 0.06, 0.25, { type: 'lowpass', freq: 1200, freqEnd: 300, gain: 0.35 });
    osc(d, t + 0.4, 0.4, { freq: 80, freqEnd: 40, gain: 0.5 });
    noise(d, t + 0.4, 0.2, { type: 'lowpass', freq: 300, gain: 0.4 });
  },
  jump: (d, t) => noise(d, t, 0.16, { freq: 600, freqEnd: 1800, q: 1.2, gain: 0.14, attack: 0.03 }),
  land: (d, t) => { osc(d, t, 0.15, { freq: 90, freqEnd: 45, gain: 0.35 }); noise(d, t, 0.1, { type: 'lowpass', freq: 500, gain: 0.3 }); },
  throw: (d, t) => {
    noise(d, t, 0.2, { freq: 4500, freqEnd: 1800, q: 7, gain: 0.25, attack: 0.02 });
    osc(d, t, 0.18, { freq: 3200, freqEnd: 1700, gain: 0.03 });
  },
  poof: (d, t) => {
    noise(d, t, 0.5, { type: 'lowpass', freq: 1400, freqEnd: 180, gain: 0.55, attack: 0.01 });
    osc(d, t, 0.14, { freq: 240, freqEnd: 140, gain: 0.2 });
  },
  grapple: (d, t) => {
    noise(d, t, 0.32, { freq: 5000, freqEnd: 1200, q: 5, gain: 0.25, attack: 0.01 });
    osc(d, t, 0.25, { type: 'triangle', freq: 1300, freqEnd: 500, gain: 0.06 });
    osc(d, t + 0.18, 0.12, { freq: 320, freqEnd: 120, gain: 0.3 });
    noise(d, t + 0.18, 0.05, { type: 'bandpass', freq: 2000, q: 3, gain: 0.25 });
  },
  alert: (d, t) => {
    taiko(d, t, { gain: 0.7 });
    ka(d, t + 0.12, 0.25);
    flute(d, t + 0.05, 1174.7, 0.5, { gain: 0.14 });
    taiko(d, t + 0.25, { gain: 0.6, pitch: 1.1 });
  },
  suspicious: (d, t) => { koto(d, t, note(5), { gain: 0.18, decay: 1.2 }); koto(d, t + 0.14, note(7), { gain: 0.18, decay: 1.5 }); },
  hurt: (d, t) => {
    osc(d, t, 0.22, { type: 'sawtooth', freq: 210, freqEnd: 95, gain: 0.12 });
    noise(d, t, 0.15, { type: 'lowpass', freq: 900, gain: 0.45 });
    osc(d, t, 0.2, { freq: 110, freqEnd: 50, gain: 0.35 });
  },
  seal: (d, t) => {
    for (let i = 0; i < 3; i++) noise(d, t + i * 0.07, 0.025, { type: 'bandpass', freq: 1700 + i * 200, q: 4, gain: 0.3 });
  },
  jutsu: (d, t) => {
    SFX.seal(d, t);
    [0, 7, 12].forEach((det, i) => osc(d, t + 0.15, 0.6, { type: 'triangle', freq: 330 * Math.pow(2, det / 12), freqEnd: 990 * Math.pow(2, det / 12), gain: 0.06, attack: 0.1, detune: i * 6 }));
    noise(d, t + 0.15, 0.6, { freq: 1200, freqEnd: 5000, q: 2, gain: 0.15, attack: 0.15 });
  },
  rasengan: (d, t) => {
    SFX.seal(d, t);
    osc(d, t, 1.1, { type: 'sawtooth', freq: 70, freqEnd: 160, gain: 0.12, attack: 0.2 });
    noise(d, t, 1.1, { freq: 500, freqEnd: 3200, q: 9, gain: 0.35, attack: 0.15 });
    noise(d, t + 0.1, 1.0, { freq: 900, freqEnd: 4200, q: 12, gain: 0.25, attack: 0.15 });
  },
  lightning: (d, t) => {
    // A thousand chirping birds: warbling square waves plus crackle.
    for (let v = 0; v < 3; v++) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 2400 + v * 500;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 30 + v * 9;
      const lg = ctx.createGain();
      lg.gain.value = 700;
      lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain();
      env(g, t, 0.025, 0.05, 1.0);
      o.connect(g).connect(d);
      o.start(t); lfo.start(t); o.stop(t + 1.05); lfo.stop(t + 1.05);
    }
    for (let i = 0; i < 14; i++) noise(d, t + Math.random() * 0.9, 0.03, { type: 'highpass', freq: 3000, gain: 0.25 });
  },
  fire: (d, t) => {
    SFX.seal(d, t);
    noise(d, t + 0.1, 1.0, { type: 'lowpass', freq: 300, freqEnd: 1800, gain: 0.55, attack: 0.15 });
    for (let i = 0; i < 10; i++) noise(d, t + 0.2 + Math.random() * 0.8, 0.02, { type: 'highpass', freq: 2500, gain: 0.2 });
  },
  boom: (d, t) => {
    osc(d, t, 1.1, { freq: 65, freqEnd: 28, gain: 0.8 });
    noise(d, t, 1.2, { type: 'lowpass', freq: 900, freqEnd: 70, gain: 0.9, attack: 0.005 });
    noise(d, t, 0.08, { type: 'highpass', freq: 2000, gain: 0.3 });
  },
  heal: (d, t) => [0, 2, 4, 7].forEach((deg, i) => osc(d, t + i * 0.1, 0.9, { freq: note(deg + 5), gain: 0.07, attack: 0.02 })),
  shadow: (d, t) => {
    osc(d, t, 0.9, { type: 'sawtooth', freq: 55, freqEnd: 40, gain: 0.12, attack: 0.3 });
    noise(d, t, 0.8, { type: 'lowpass', freq: 200, freqEnd: 700, gain: 0.35, attack: 0.5, curve: 'lin' });
    osc(d, t + 0.1, 0.8, { freq: 880, freqEnd: 440, gain: 0.025, attack: 0.3 });
  },
  arrow: (d, t) => {
    osc(d, t, 0.12, { type: 'triangle', freq: 190, freqEnd: 150, gain: 0.15 });
    noise(d, t + 0.02, 0.2, { freq: 3200, freqEnd: 1000, q: 6, gain: 0.18 });
  },
  victory: (d, t) => {
    [0, 1, 2, 3, 4, 5, 6, 7].forEach((deg, i) => koto(d, t + i * 0.13, note(deg), { gain: 0.16 }));
    flute(d, t + 1.1, note(7), 2.5, { gain: 0.12 });
  },
  fail: (d, t) => { flute(d, t, note(4), 1.2, { gain: 0.12 }); flute(d, t + 1.1, note(1), 2.2, { gain: 0.12 }); taiko(d, t + 1.1, { gain: 0.4, pitch: 0.7 }); },
};

/** Play a sound effect, optionally at a world position (panned and attenuated). */
export function sfx(name, pos = null) {
  if (!ctx || ctx.state !== 'running') return;
  if (name === 'victory' && playResultTrack('victory')) return;
  if (name === 'fail' && playResultTrack('defeat')) return;
  const sp = spatial(pos);
  if (!sp) return;
  const dest = out(sfxBus, { pan: sp.pan, send: sp.send, gain: sp.gain });
  const buf = buffers.get('sfx/' + name);
  if (buf) {
    playBuffer(buf, dest, ctx.currentTime, { rate: 0.94 + Math.random() * 0.12, gain: SAMPLE_GAIN[name] ?? 1 });
    return;
  }
  const fn = SFX[name] || SFX[SFX_FALLBACK[name]];
  if (fn) fn(dest, ctx.currentTime);
}
// Sounds that only exist as recordings borrow a synthesised one when missing.
const SFX_FALLBACK = { bodyFall: 'land', kunaiHit: 'clank', earth: 'boom' };

export function stopAudio() {
  if (scheduler) clearInterval(scheduler);
}

/** A MediaStream of the final mix (handy for recording a clip of the game's audio). */
export function tapStream() {
  if (!ctx) return null;
  const dest = ctx.createMediaStreamDestination();
  master.connect(dest);
  return dest.stream;
}
