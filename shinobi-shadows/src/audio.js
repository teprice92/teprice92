// Tiny synthesised sound effects - no audio files needed.

let ctx = null;
let master = null;
let noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
}

function noise(dur, { type = 'bandpass', freq = 1200, q = 1, gain = 0.5, freqEnd = null, attack = 0.005 } = {}) {
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.05);
}

function tone(dur, { freq = 440, freqEnd = null, type = 'sine', gain = 0.3, delay = 0 } = {}) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const SFX = {
  swing: () => noise(0.18, { freq: 2500, freqEnd: 600, q: 2, gain: 0.4 }),
  hit: () => { noise(0.12, { type: 'lowpass', freq: 1800, gain: 0.7 }); tone(0.1, { freq: 180, freqEnd: 60, type: 'square', gain: 0.15 }); },
  stealthKill: () => { noise(0.35, { freq: 3500, freqEnd: 300, q: 3, gain: 0.5 }); tone(0.9, { freq: 90, freqEnd: 40, type: 'sawtooth', gain: 0.18, delay: 0.05 }); },
  jump: () => noise(0.1, { freq: 800, freqEnd: 1800, gain: 0.15 }),
  land: () => noise(0.08, { type: 'lowpass', freq: 400, gain: 0.25 }),
  throw: () => noise(0.12, { freq: 4000, freqEnd: 1500, q: 4, gain: 0.25 }),
  poof: () => noise(0.4, { type: 'lowpass', freq: 900, freqEnd: 200, gain: 0.6, attack: 0.01 }),
  grapple: () => { tone(0.15, { freq: 900, freqEnd: 400, type: 'triangle', gain: 0.15 }); noise(0.3, { freq: 3000, q: 6, gain: 0.15 }); },
  alert: () => { tone(0.12, { freq: 880, type: 'square', gain: 0.12 }); tone(0.2, { freq: 1320, type: 'square', gain: 0.12, delay: 0.12 }); },
  suspicious: () => tone(0.25, { freq: 520, freqEnd: 700, type: 'triangle', gain: 0.12 }),
  hurt: () => { tone(0.2, { freq: 220, freqEnd: 90, type: 'sawtooth', gain: 0.2 }); noise(0.15, { type: 'lowpass', freq: 900, gain: 0.4 }); },
  jutsu: () => { tone(0.4, { freq: 300, freqEnd: 900, type: 'triangle', gain: 0.15 }); noise(0.3, { freq: 1500, freqEnd: 4000, gain: 0.2 }); },
  rasengan: () => { noise(0.8, { freq: 600, freqEnd: 2500, q: 8, gain: 0.35 }); tone(0.8, { freq: 120, freqEnd: 300, type: 'sawtooth', gain: 0.1 }); },
  lightning: () => { for (let i = 0; i < 6; i++) tone(0.05, { freq: 2000 + Math.random() * 3000, type: 'square', gain: 0.06, delay: i * 0.04 }); noise(0.6, { freq: 5000, q: 2, gain: 0.3 }); },
  fire: () => noise(0.8, { type: 'lowpass', freq: 1200, freqEnd: 200, gain: 0.6, attack: 0.05 }),
  boom: () => { noise(0.9, { type: 'lowpass', freq: 600, freqEnd: 60, gain: 0.9 }); tone(0.6, { freq: 70, freqEnd: 30, type: 'sine', gain: 0.4 }); },
  heal: () => { tone(0.5, { freq: 520, freqEnd: 780, gain: 0.12 }); tone(0.5, { freq: 660, freqEnd: 990, gain: 0.1, delay: 0.1 }); },
  shadow: () => { tone(0.6, { freq: 160, freqEnd: 60, type: 'sawtooth', gain: 0.12 }); noise(0.5, { type: 'lowpass', freq: 500, gain: 0.3 }); },
  arrow: () => noise(0.15, { freq: 3000, freqEnd: 900, q: 5, gain: 0.2 }),
  clank: () => { tone(0.15, { freq: 1800, type: 'square', gain: 0.07 }); noise(0.05, { freq: 5000, q: 3, gain: 0.2 }); },
  victory: () => [523, 659, 784, 1046].forEach((f, i) => tone(0.5, { freq: f, type: 'triangle', gain: 0.15, delay: i * 0.15 })),
  fail: () => [392, 330, 262, 196].forEach((f, i) => tone(0.5, { freq: f, type: 'triangle', gain: 0.15, delay: i * 0.18 })),
};

export function sfx(name) {
  if (!ctx || ctx.state !== 'running') return;
  const fn = SFX[name];
  if (fn) fn();
}
