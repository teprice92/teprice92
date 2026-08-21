/* Timeblock — a month planner built around timed blocks, for ADHD brains.
 * No build step, no dependencies, no network. State lives in localStorage.
 * Every design decision here traces to a study; see why.md / the Why tab. */
(function () {
'use strict';

/* ── Utilities ──────────────────────────────────────────────────────────── */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const pad = n => String(n).padStart(2, '0');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const todayISO = () => iso(new Date());
const addDays = (s, n) => { const d = fromISO(s); d.setDate(d.getDate() + n); return iso(d); };
const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function fmtTime(mins) {
  const h24 = Math.floor(mins / 60) % 24, m = mins % 60;
  if (S.settings.clock === 24) return `${pad(h24)}:${pad(m)}`;
  const ap = h24 < 12 ? 'am' : 'pm', h = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h}${ap}` : `${h}:${pad(m)}${ap}`;
}
function fmtDur(mins) {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}
function friendlyDate(dateISO) {
  const t = todayISO();
  if (dateISO === t) return 'Today';
  if (dateISO === addDays(t, 1)) return 'Tomorrow';
  if (dateISO === addDays(t, -1)) return 'Yesterday';
  const d = fromISO(dateISO);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
}

/* ── Domain constants ───────────────────────────────────────────────────── */
const TYPES = [
  { id:'focus',  label:'Deep focus', emoji:'🎯', v:'--t-focus'  },
  { id:'admin',  label:'Admin',      emoji:'📋', v:'--t-admin'  },
  { id:'body',   label:'Body',       emoji:'🏃', v:'--t-body'   },
  { id:'care',   label:'Care',       emoji:'🫖', v:'--t-care'   },
  { id:'social', label:'People',     emoji:'💬', v:'--t-social' },
  { id:'joy',    label:'Joy',        emoji:'✨', v:'--t-joy'    },
  { id:'buffer', label:'Buffer',     emoji:'⌛', v:'--t-buffer' },
];
const typeOf = id => TYPES.find(t => t.id === id) || TYPES[0];
const DURATIONS = [10, 15, 25, 45, 60, 90];

const THEMES = [
  { id:'slate',    name:'Calm Slate',   note:'Low stimulation, default',   lvl:1,  sw:['#f4f5f7','#4f6bed','#5b8c85'] },
  { id:'paper',    name:'Paper',        note:'Near-monochrome, quietest',  lvl:1,  sw:['#f7f5f0','#54606f','#6f7b6a'] },
  { id:'dusk',     name:'Dusk',         note:'Dark, soft contrast',        lvl:1,  sw:['#151821','#7d94ff','#5fb3a6'] },
  { id:'forest',   name:'Forest',       note:'Green and warm',             lvl:3,  sw:['#f1f5f1','#2f7d55','#a9762c'] },
  { id:'contrast', name:'High Contrast',note:'Maximum legibility',         lvl:1,  sw:['#ffffff','#0037c8','#000000'] },
  { id:'sherbet',  name:'Sherbet',      note:'Warmer, higher energy',      lvl:5,  sw:['#fdf4f1','#e0663f','#3f8f6a'] },
  { id:'neon',     name:'Neon Focus',   note:'Vivid dark',                 lvl:8,  sw:['#0b0f18','#00e0b8','#4fd0ff'] },
  { id:'cosmic',   name:'Cosmic',       note:'Deep violet',                lvl:12, sw:['#12101f','#a98bff','#f090b8'] },
];

/* ── State ──────────────────────────────────────────────────────────────── */
const KEY = 'timeblock.v1';
const defaults = () => ({
  v: 1,
  blocks: {},           // id -> block
  inbox: [],            // {id,text,ts}
  anchors: [],          // {id,month:'YYYY-MM',title,color,target}
  reflections: {},      // dateISO -> {wins, note, ts}
  stats: { xp:0, streak:0, best:0, lastDone:null, recovery:2, days:{} }, // days: dateISO -> {done,mins}
  ach: {},              // id -> ts
  active: null,         // {id, startedAt, accumulated, paused}
  settings: {
    theme:'slate', clock:12, dayStart:7, dayEnd:22, buffer:10,
    chime:true, motion:'auto', step:1, wrapWarn:5, onboarded:false,
  },
  ui: { date: todayISO(), month: todayISO().slice(0, 7), view:'now' },
});

let S = defaults();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) S = migrate(JSON.parse(raw));
  } catch (e) { console.warn('Could not read saved data:', e); }
  S.ui.date = todayISO();
  S.ui.month = S.ui.date.slice(0, 7);
}
function migrate(data) {
  const base = defaults();
  const out = Object.assign(base, data);
  out.settings = Object.assign(base.settings, data.settings || {});
  out.stats = Object.assign(base.stats, data.stats || {});
  out.ui = Object.assign(base.ui, data.ui || {});
  return out;
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('⚠️', 'Could not save', 'Storage is full or blocked. Export a backup from Settings.'); }
  }, 250);
}

/* ── Block model ────────────────────────────────────────────────────────── */
/* block = {id,date,start,dur,title,type,cue,action,first,priority,energy,
            anchorId,steps:[{t,done}],status,actual,startedISO} */
function blocksOn(dateISO) {
  return Object.values(S.blocks).filter(b => b.date === dateISO).sort((a, b) => a.start - b.start);
}
function blocksInMonth(ym) {
  return Object.values(S.blocks).filter(b => b.date.startsWith(ym));
}
function blockAt(dateISO, mins) {
  return blocksOn(dateISO).find(b => mins >= b.start && mins < b.start + b.dur && b.status !== 'moved');
}
function currentBlock() {
  const t = todayISO();
  if (S.active) {
    const b = S.blocks[S.active.id];
    if (b && b.status !== 'done') return b;
    S.active = null;
  }
  return blocksOn(t).find(b => b.status === 'planned' && nowMins() >= b.start && nowMins() < b.start + b.dur);
}
function nextBlocks(n = 3) {
  const t = todayISO(), m = nowMins();
  return blocksOn(t).filter(b => b.start > m && b.status === 'planned').slice(0, n);
}
function overlaps(dateISO, start, dur, ignoreId) {
  return blocksOn(dateISO).some(b =>
    b.id !== ignoreId && b.status !== 'moved' && start < b.start + b.dur && b.start < start + dur);
}
function findFreeSlot(dateISO, dur, from) {
  const dayEnd = S.settings.dayEnd * 60;
  let t = Math.ceil((from ?? Math.max(nowMins(), S.settings.dayStart * 60)) / 5) * 5;
  while (t + dur <= dayEnd) {
    if (!overlaps(dateISO, t, dur)) return t;
    t += 5;
  }
  return null;
}

/* ── XP, levels, streaks ────────────────────────────────────────────────── */
/* Payouts are small, immediate and frequent: ADHD is associated with steeper
 * delay discounting, so a reward that lands next week does not motivate now. */
const xpForLevel = n => 60 + (n - 1) * 45;          // level 1->2 costs 60, then +45 each
function levelInfo(xp) {
  let lvl = 1, rem = xp, need = xpForLevel(1);
  while (rem >= need) { rem -= need; lvl++; need = xpForLevel(lvl); }
  return { lvl, rem, need, pct: Math.round((rem / need) * 100) };
}
function award(amount, label, emoji) {
  const before = levelInfo(S.stats.xp).lvl;
  S.stats.xp += amount;
  const after = levelInfo(S.stats.xp).lvl;
  if (label) toast(emoji || '＋', `+${amount} XP`, label, 'xp');
  if (after > before) {
    const unlocked = THEMES.filter(t => t.lvl > before && t.lvl <= after);
    setTimeout(() => toast('🎉', `Level ${after}`,
      unlocked.length ? `Unlocked theme: ${unlocked.map(t => t.name).join(', ')}` : 'Keep going.'), 500);
    chime('level');
  }
  checkAchievements();
  save();
}
function touchStreak() {
  const t = todayISO();
  if (S.stats.lastDone === t) return;
  const yday = addDays(t, -1);
  if (S.stats.lastDone === yday) S.stats.streak += 1;
  else if (S.stats.lastDone && S.stats.lastDone < yday && S.stats.recovery > 0) {
    /* Streak repair. Rigid all-or-nothing streaks punish exactly the days ADHD
     * makes hardest, and shame predicts disengagement — so the streak bends. */
    S.stats.recovery -= 1; S.stats.streak += 1;
    toast('🧡', 'Streak repaired', 'Used one repair token. No lecture, no reset.');
  } else S.stats.streak = 1;
  S.stats.lastDone = t;
  S.stats.best = Math.max(S.stats.best, S.stats.streak);
  if (S.stats.streak % 7 === 0) S.stats.recovery = Math.min(3, S.stats.recovery + 1);
}
function logDay(dateISO, mins) {
  const d = S.stats.days[dateISO] || { done: 0, mins: 0 };
  d.done += 1; d.mins += mins;
  S.stats.days[dateISO] = d;
}
const totalDone = () => Object.values(S.blocks).filter(b => b.status === 'done').length;
const totalMins = () => Object.values(S.stats.days).reduce((a, d) => a + d.mins, 0);

/* ── Achievements ───────────────────────────────────────────────────────── */
/* Deliberately mixed: some reward output, several reward *honest process* —
 * rescheduling, logging real durations, resting — so the game cannot be won
 * by pretending. */
const ACHIEVEMENTS = [
  { id:'first_block',  em:'🌱', name:'Ignition',        desc:'Finish your first block',                test:() => totalDone() >= 1 },
  { id:'ten_blocks',   em:'🔟', name:'Ten Down',        desc:'Finish 10 blocks',                       test:() => totalDone() >= 10 },
  { id:'fifty_blocks', em:'🏔️', name:'Fifty Summits',   desc:'Finish 50 blocks',                       test:() => totalDone() >= 50 },
  { id:'two_min',      em:'⏱️', name:'Two Minutes',     desc:'Start a block you did not feel like starting', test:s => (s.stats.starts||0) >= 1 },
  { id:'starter_10',   em:'🚀', name:'Starter',         desc:'Start 10 blocks',                        test:s => (s.stats.starts||0) >= 10 },
  { id:'intention_1',  em:'🔗', name:'If-Then',         desc:'Write your first cue → action plan',     test:s => Object.values(s.blocks).some(b => b.cue && b.action) },
  { id:'intention_10', em:'🧠', name:'Wired In',        desc:'Write 10 cue → action plans',            test:s => Object.values(s.blocks).filter(b => b.cue && b.action).length >= 10 },
  { id:'reschedule',   em:'🤝', name:'Renegotiator',    desc:'Move a block instead of ghosting it',    test:s => (s.stats.moves||0) >= 1 },
  { id:'honest_clock', em:'📏', name:'Honest Clock',    desc:'Log real duration on 5 blocks',          test:s => Object.values(s.blocks).filter(b => b.actual).length >= 5 },
  { id:'calibrated',   em:'🎯', name:'Calibrated',      desc:'Finish 3 blocks within 10% of estimate', test:s => Object.values(s.blocks).filter(b => b.actual && Math.abs(b.actual - b.dur) <= b.dur * 0.1).length >= 3 },
  { id:'capture_10',   em:'🕸️', name:'Nothing Lost',    desc:'Park 10 distractions instead of chasing them', test:s => (s.stats.captures||0) >= 10 },
  { id:'steps_25',     em:'🪜', name:'Step by Step',    desc:'Tick 25 sub-steps',                      test:s => (s.stats.steps||0) >= 25 },
  { id:'streak_3',     em:'🔥', name:'Three in a Row',  desc:'3-day streak',                           test:s => s.stats.best >= 3 },
  { id:'streak_7',     em:'🗓️', name:'Full Week',       desc:'7-day streak',                           test:s => s.stats.best >= 7 },
  { id:'streak_30',    em:'👑', name:'A Whole Month',   desc:'30-day streak',                          test:s => s.stats.best >= 30 },
  { id:'repair',       em:'🧡', name:'Soft Landing',    desc:'Use a streak repair token — on purpose', test:s => s.stats.recovery < 2 },
  { id:'architect',    em:'🏗️', name:'Month Architect', desc:'Set a monthly anchor',                   test:s => s.anchors.length >= 1 },
  { id:'anchor_done',  em:'⚓', name:'Anchored',        desc:'Complete a monthly anchor',              test:s => s.anchors.some(a => anchorProgress(a).pct >= 100) },
  { id:'reflect_1',    em:'🪞', name:'Look Back',       desc:'Write one end-of-day review',            test:s => Object.keys(s.reflections).length >= 1 },
  { id:'reflect_7',    em:'📔', name:'Week in Review',  desc:'Seven end-of-day reviews',               test:s => Object.keys(s.reflections).length >= 7 },
  { id:'rest',         em:'🛋️', name:'Scheduled Rest',  desc:'Finish a Care or Joy block',             test:s => Object.values(s.blocks).some(b => b.status === 'done' && (b.type === 'care' || b.type === 'joy')) },
  { id:'buffered',     em:'⌛', name:'Room to Breathe',  desc:'Keep a buffer block',                    test:s => Object.values(s.blocks).some(b => b.type === 'buffer' && b.status === 'done') },
  { id:'four_hours',   em:'⛰️', name:'Four Hours Deep', desc:'Log 4 hours of focused time',            test:() => totalMins() >= 240 },
  { id:'twenty_hours', em:'🌌', name:'Twenty Hours',    desc:'Log 20 hours of focused time',           test:() => totalMins() >= 1200 },
];
function checkAchievements() {
  ACHIEVEMENTS.forEach(a => {
    if (S.ach[a.id]) return;
    let ok = false;
    try { ok = a.test(S); } catch (e) { ok = false; }
    if (ok) {
      S.ach[a.id] = Date.now();
      S.stats.xp += 25;
      setTimeout(() => toast(a.em, a.name, a.desc + '  ·  +25 XP'), 260);
      chime('badge');
    }
  });
}
function anchorProgress(a) {
  const done = blocksInMonth(a.month).filter(b => b.anchorId === a.id && b.status === 'done').length;
  const target = Math.max(1, a.target || 1);
  return { done, target, pct: Math.min(100, Math.round((done / target) * 100)) };
}

/* ── Feedback: toasts and sound ─────────────────────────────────────────── */
const TOAST_MAX = 3;
function dismissToast(el) {
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); }, 3400);
}
function toast(em, title, sub, kind) {
  const wrap = $('#toasts');
  /* Several payouts can land in the same instant — starting a block can fire an
   * XP award and two badges at once. Four stacked cards would bury the screen,
   * so consecutive XP notices merge into a single running total instead. */
  const last = wrap.lastElementChild;
  if (kind === 'xp' && last && last.dataset.kind === 'xp') {
    const total = Number(last.dataset.amount || 0) + (parseInt(String(title).replace(/[^0-9]/g, ''), 10) || 0);
    last.dataset.amount = String(total);
    last.querySelector('.t-title').textContent = `+${total} XP`;
    last.querySelector('.t-sub').textContent = sub || '';
    dismissToast(last);
    return;
  }
  const el = document.createElement('div');
  el.className = 'toast';
  el.dataset.kind = kind || 'info';
  if (kind === 'xp') el.dataset.amount = String(parseInt(String(title).replace(/[^0-9]/g, ''), 10) || 0);
  el.innerHTML = `<span class="em" aria-hidden="true">${esc(em)}</span>` +
    `<div><span class="t-title">${esc(title)}</span><small class="t-sub">${esc(sub || '')}</small></div>`;
  wrap.appendChild(el);
  while (wrap.children.length > TOAST_MAX) wrap.firstElementChild.remove();
  dismissToast(el);
}
let audioCtx = null;
function chime(kind) {
  if (!S.settings.chime) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const seq = { done:[660, 880], badge:[523, 659, 784], level:[523, 659, 784, 1046], warn:[440], half:[587] }[kind] || [660];
    seq.forEach((f, i) => {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = audioCtx.currentTime + i * 0.11;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.09, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24);
      o.connect(g).connect(audioCtx.destination); o.start(t0); o.stop(t0 + 0.26);
    });
  } catch (e) { /* audio is a nicety, never a requirement */ }
}

/* ── Block actions ──────────────────────────────────────────────────────── */
function startBlock(id) {
  const b = S.blocks[id];
  if (!b) return;
  if (S.active && S.active.id !== id) stopActive();
  b.status = 'planned';
  b.startedISO = b.startedISO || new Date().toISOString();
  S.active = { id, startedAt: Date.now(), accumulated: 0, paused: false, halfPinged: false, warnPinged: false };
  S.stats.starts = (S.stats.starts || 0) + 1;
  award(3, 'Started — that was the hard part', '🚀');
  render();
}
function elapsedSecs() {
  if (!S.active) return 0;
  const live = S.active.paused ? 0 : (Date.now() - S.active.startedAt) / 1000;
  return Math.floor(S.active.accumulated + live);
}
function pauseActive() {
  if (!S.active || S.active.paused) return;
  S.active.accumulated = elapsedSecs(); S.active.paused = true; save(); render();
}
function resumeActive() {
  if (!S.active || !S.active.paused) return;
  S.active.startedAt = Date.now(); S.active.paused = false; save(); render();
}
function stopActive() { S.active = null; save(); }

function completeBlock(id, opts = {}) {
  const b = S.blocks[id];
  if (!b) return;
  const mins = opts.actual ?? (S.active && S.active.id === id ? Math.max(1, Math.round(elapsedSecs() / 60)) : b.dur);
  b.status = 'done';
  b.actual = mins;
  b.doneAt = Date.now();
  if (S.active && S.active.id === id) S.active = null;
  logDay(b.date, mins);
  touchStreak();
  /* Payout scales with time invested but lands the instant the block ends. */
  award(10 + Math.round(b.dur / 5), 'Block finished', '✅');
  chime('done');
  const drift = driftFactor();
  if (b.actual > b.dur * 1.25 && drift > 1.1) {
    setTimeout(() => toast('📏', 'Noted, not judged',
      `You tend to run about ${Math.round((drift - 1) * 100)}% over. Timeblock will pad new estimates.`), 900);
  }
  render();
}
function moveBlock(id, minutes) {
  const b = S.blocks[id];
  if (!b) return;
  const nb = Object.assign({}, b, { id: uid(), status: 'planned', actual: null, doneAt: null });
  if (minutes === 'tomorrow') { nb.date = addDays(b.date, 1); }
  else {
    const slot = findFreeSlot(b.date, b.dur, b.start + minutes);
    if (slot == null) { nb.date = addDays(b.date, 1); }
    else nb.start = slot;
  }
  b.status = 'moved';
  if (S.active && S.active.id === id) S.active = null;
  S.blocks[nb.id] = nb;
  S.stats.moves = (S.stats.moves || 0) + 1;
  /* Rescheduling is rewarded. An unplanned block that quietly rots is the
   * failure mode; a renegotiated one is a working plan. */
  award(4, 'Renegotiated, not abandoned', '🤝');
  toast('📅', 'Moved', `Now ${friendlyDate(nb.date)} at ${fmtTime(nb.start)}`);
  render();
}
function deleteBlock(id) {
  if (S.active && S.active.id === id) S.active = null;
  delete S.blocks[id];
  save(); render();
}
/* Average ratio of real time to estimated time — the user's personal
 * planning-fallacy coefficient, used to pre-pad new estimates. */
function driftFactor() {
  const done = Object.values(S.blocks).filter(b => b.actual && b.dur);
  if (done.length < 3) return 1;
  const recent = done.sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0)).slice(0, 12);
  const r = recent.reduce((a, b) => a + b.actual / b.dur, 0) / recent.length;
  return clamp(r, 0.7, 2);
}

/* ── The tick: keeps externalised time honest ───────────────────────────── */
let lastTickMin = -1;
function tick() {
  const a = S.active;
  if (a && !a.paused) {
    const b = S.blocks[a.id];
    if (b) {
      const total = b.dur * 60, el = elapsedSecs(), left = total - el;
      if (!a.halfPinged && el >= total / 2 && left > 60) {
        a.halfPinged = true; chime('half');
        toast('🌗', 'Halfway', 'Still here. That counts.');
      }
      const warn = (S.settings.wrapWarn || 5) * 60;
      if (!a.warnPinged && left <= warn && left > 0) {
        a.warnPinged = true; chime('warn');
        toast('⚠️', `${Math.ceil(left / 60)} minutes left`, 'Start landing the plane.');
      }
      updateDial();
    }
  }
  const m = nowMins();
  if (m !== lastTickMin) {
    lastTickMin = m;
    if (S.ui.view === 'now' || S.ui.view === 'day') render();
    else renderNowBar();
  }
}
function updateDial() {
  const a = S.active; if (!a) return;
  const b = S.blocks[a.id]; if (!b) return;
  const total = b.dur * 60, el = clamp(elapsedSecs(), 0, total), left = Math.max(0, total - el);
  const pct = 100 - (el / total) * 100;
  const dial = $('#dial');
  if (dial) {
    dial.style.setProperty('--pct', pct.toFixed(2));
    const mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    const t = $('#dialTime'); if (t) t.textContent = left > 0 ? `${mm}:${pad(ss)}` : 'over';
  }
  renderNowBar();
}

/* ── Rendering: NOW bar ─────────────────────────────────────────────────── */
function renderNowBar() {
  const bar = $('#nowbar');
  const b = currentBlock();
  if (!b) { bar.hidden = true; return; }
  bar.hidden = S.ui.view === 'now';
  const running = S.active && S.active.id === b.id;
  const total = b.dur * 60;
  const el = running ? clamp(elapsedSecs(), 0, total) : 0;
  $('#nowbarRing').style.setProperty('--pct', (100 - (el / total) * 100).toFixed(1));
  $('#nowbarTitle').textContent = b.title;
  $('#nowbarSub').textContent = running
    ? `${Math.max(0, Math.ceil((total - el) / 60))} min left${S.active.paused ? ' · paused' : ''}`
    : `Scheduled now · ${fmtTime(b.start)}–${fmtTime(b.start + b.dur)}`;
}

/* ── Rendering: NOW view ────────────────────────────────────────────────── */
function renderNow() {
  const v = $('#view-now');
  const b = currentBlock();
  const running = !!(S.active && b && S.active.id === b.id);
  const t = todayISO();
  const day = blocksOn(t);
  const done = day.filter(x => x.status === 'done');
  let html = '<div class="stack">';

  if (b) {
    const ty = typeOf(b.type);
    const total = b.dur * 60;
    const el = running ? clamp(elapsedSecs(), 0, total) : 0;
    const left = Math.max(0, total - el);
    const pct = running ? 100 - (el / total) * 100 : 100;
    const warn = running && left <= (S.settings.wrapWarn || 5) * 60 && left > 0;

    html += `<div class="card focus-card">
      ${warn ? `<div class="wrapup">⚠️ ${Math.ceil(left / 60)} min left — start landing the plane.</div>` : ''}
      <div class="dial" id="dial" style="--pct:${pct.toFixed(2)}; --dial-color:var(${ty.v})" role="img"
           aria-label="${running ? Math.ceil(left / 60) + ' minutes remaining' : 'Not started'}">
        <div class="dial-inner">
          <div class="dial-time" id="dialTime">${running ? `${Math.floor(left / 60)}:${pad(Math.floor(left % 60))}` : fmtDur(b.dur)}</div>
          <div class="dial-label">${running ? (S.active.paused ? 'paused' : 'remaining') : 'planned'}</div>
        </div>
      </div>
      <h1 class="focus-title">${esc(ty.emoji)} ${esc(b.title)}</h1>
      <p class="muted small">${fmtTime(b.start)}–${fmtTime(b.start + b.dur)} · ${esc(ty.label)} · priority ${esc(b.priority || 'B')}</p>`;

    if (b.cue && b.action) {
      html += `<div class="intention-readout">When <b>${esc(b.cue)}</b>, I will <b>${esc(b.action)}</b>.</div>`;
    }
    if (!running && b.first) {
      html += `<div class="intention-readout">First move: <b>${esc(b.first)}</b>. Nothing else yet.</div>`;
    }

    if (!running) {
      html += `<button class="btn btn-primary btn-big" data-act="start" data-id="${b.id}">Start — just two minutes ▸</button>
        <p class="muted small" style="margin-top:10px">Two minutes is the whole commitment. Stopping after them is a win too.</p>`;
    } else {
      if (b.steps && b.steps.length) {
        html += '<ul class="steps">' + b.steps.map((s, i) =>
          `<li><input type="checkbox" id="st${i}" data-act="step" data-id="${b.id}" data-i="${i}" ${s.done ? 'checked' : ''}>
             <label for="st${i}" class="${s.done ? 'done' : ''}">${esc(s.t)}</label></li>`).join('') + '</ul>';
      }
      html += `<div class="btn-row" style="margin-top:14px">
        <button class="btn btn-primary" data-act="complete" data-id="${b.id}">Done ✓</button>
        <button class="btn" data-act="${S.active.paused ? 'resume' : 'pause'}" data-id="${b.id}">${S.active.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn" data-act="extend" data-id="${b.id}">+10 min</button>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn btn-quiet" data-act="move" data-id="${b.id}" data-mins="60">Not today — move it</button>
      </div>`;
    }
    html += '</div>';
  } else {
    const next = nextBlocks(1)[0];
    html += `<div class="card"><div class="empty">
      <span class="empty-emoji">${next ? '🌤️' : '🫙'}</span>
      <h2>${next ? 'Nothing scheduled right now' : 'Nothing scheduled today'}</h2>
      <p class="muted small">${next
        ? `Next up: <b>${esc(next.title)}</b> at ${fmtTime(next.start)} — in ${fmtDur(Math.max(1, next.start - nowMins()))}.`
        : 'One block. Twenty-five minutes. That is the entire ask.'}</p>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-primary" data-act="quick25">Start a 25-min block now</button>
        <button class="btn" data-act="new">Plan a block</button>
      </div></div></div>`;
  }

  const upcoming = nextBlocks(3);
  if (upcoming.length) {
    html += `<div><div class="section-label">Up next</div><div class="card">` +
      upcoming.map(x => {
        const ty = typeOf(x.type);
        return `<div class="upnext"><span class="dot" style="background:var(${ty.v})"></span>
          <span class="time-col">${fmtTime(x.start)}</span>
          <span style="flex:1">${esc(x.title)}</span>
          <span class="muted small">${fmtDur(x.dur)}</span></div>`;
      }).join('') + '</div></div>';
  }

  if (S.inbox.length) {
    html += `<div><div class="section-label">Parked (${S.inbox.length})</div><div class="card">` +
      S.inbox.slice(0, 3).map(i => `<div class="upnext"><span class="dot" style="background:var(--muted)"></span>
        <span style="flex:1">${esc(i.text)}</span>
        <button class="btn btn-quiet small" data-act="schedule-inbox" data-id="${i.id}">Schedule</button></div>`).join('') +
      (S.inbox.length > 3 ? `<p class="muted small" style="margin:8px 0 0">+${S.inbox.length - 3} more in the parking lot.</p>` : '') +
      '</div></div>';
  }

  if (done.length && !S.reflections[t]) {
    html += `<div><div class="section-label">Today so far</div><div class="card">
      <p class="small">${done.length} block${done.length > 1 ? 's' : ''} finished · ${fmtDur(S.stats.days[t] ? S.stats.days[t].mins : 0)} of focused time.</p>
      <button class="btn" data-act="reflect">Close out the day →</button></div></div>`;
  }
  if (S.reflections[t]) {
    html += `<div class="card"><h3>🪞 Today's review</h3><p class="small muted">${esc(S.reflections[t].wins)}</p></div>`;
  }

  html += '</div>';
  v.innerHTML = html;
}

/* ── Rendering: DAY view ────────────────────────────────────────────────── */
function renderDay() {
  const v = $('#view-day');
  const date = S.ui.date;
  const list = blocksOn(date);
  const startH = S.settings.dayStart, endH = S.settings.dayEnd;
  const PXH = 60;

  let hours = '';
  for (let h = startH; h < endH; h++) {
    hours += `<div class="hour"><span class="hour-label">${fmtTime(h * 60)}</span>
      <div class="slot-hit" data-act="new-at" data-h="${h}"></div></div>`;
  }

  const layer = list.map(b => {
    const ty = typeOf(b.type);
    const top = ((b.start - startH * 60) / 60) * PXH;
    const h = Math.max(26, (b.dur / 60) * PXH - 3);
    if (top < -20) return '';
    return `<div class="tblock ${b.status === 'done' ? 'is-done' : ''} ${b.status === 'moved' ? 'is-moved' : ''}"
      style="top:${top}px;height:${h}px;--bc:var(${ty.v})" data-act="edit" data-id="${b.id}" tabindex="0" role="button">
      <b>${esc(ty.emoji)} ${esc(b.title)}</b>
      <span class="tb-meta">${fmtTime(b.start)} · ${fmtDur(b.dur)}${b.status === 'done' ? ' · done' : ''}${b.status === 'moved' ? ' · moved' : ''}</span>
    </div>`;
  }).join('');

  const isToday = date === todayISO();
  const nowTop = ((nowMins() - startH * 60) / 60) * PXH;
  const nowline = isToday && nowMins() >= startH * 60 && nowMins() <= endH * 60
    ? `<div class="nowline" style="top:${nowTop}px"></div>` : '';

  const planned = list.filter(b => b.status !== 'moved').reduce((a, b) => a + b.dur, 0);
  const doneMins = list.filter(b => b.status === 'done').reduce((a, b) => a + (b.actual || b.dur), 0);
  const free = (endH - startH) * 60 - planned;

  v.innerHTML = `
    <div class="daynav">
      <button class="icon-btn" data-act="day-prev" aria-label="Previous day">‹</button>
      <h1>${friendlyDate(date)}</h1>
      <button class="icon-btn" data-act="day-next" aria-label="Next day">›</button>
      <button class="btn btn-primary" data-act="new">＋ Block</button>
    </div>
    <div class="card" style="padding:14px 10px 18px">
      <div class="timeline">${hours}<div class="blocks-layer">${layer}${nowline}</div></div>
      <div class="daystats">
        <span>📦 ${list.filter(b => b.status !== 'moved').length} blocks</span>
        <span>⏳ ${fmtDur(planned)} planned</span>
        <span>✅ ${fmtDur(doneMins)} done</span>
        <span>🌬️ ${fmtDur(Math.max(0, free))} unclaimed</span>
      </div>
    </div>
    ${free < 60 && planned > 0 ? `<p class="muted small" style="margin-top:10px">
      Under an hour of slack left today. Transitions and overruns need somewhere to go —
      consider moving a B or C block to tomorrow.</p>` : ''}
    <p class="muted small" style="margin-top:10px">Tap any empty strip to drop a block there.</p>`;

  /* Land the viewport on the present hour the first time this day is opened.
     Scrolling to 7am to find 3pm is a small tax paid many times a day. */
  if (isToday && lastScrolledDay !== date) {
    lastScrolledDay = date;
    requestAnimationFrame(() => {
      const line = v.querySelector('.nowline');
      if (line) line.scrollIntoView({ block: 'center', behavior: S.settings.motion === 'off' ? 'auto' : 'smooth' });
    });
  }
}
let lastScrolledDay = null;

/* ── Rendering: MONTH view ──────────────────────────────────────────────── */
function renderMonth() {
  const v = $('#view-month');
  const ym = S.ui.month;
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const lead = first.getDay();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${pad(d)}`);
  while (cells.length % 7) cells.push(null);

  const capacity = (S.settings.dayEnd - S.settings.dayStart) * 60;
  const grid = cells.map(dISO => {
    if (!dISO) return '<div class="mday is-out" aria-hidden="true"></div>';
    const list = blocksOn(dISO).filter(b => b.status !== 'moved');
    const load = Math.min(100, (list.reduce((a, b) => a + b.dur, 0) / capacity) * 100);
    const dots = list.slice(0, 8).map(b => {
      const ty = typeOf(b.type);
      return `<i class="${b.status === 'done' ? '' : 'is-open'}" style="background:var(${ty.v});--dc:var(${ty.v})"></i>`;
    }).join('');
    const today = dISO === todayISO();
    return `<button class="mday ${today ? 'is-today' : ''}" data-act="open-day" data-date="${dISO}"
      aria-label="${friendlyDate(dISO)}, ${list.length} blocks">
      <span class="mday-n">${Number(dISO.slice(-2))}</span>
      <span class="mday-dots">${dots}</span>
      <span class="mday-load"><span style="width:${load}%"></span></span>
    </button>`;
  }).join('');

  const anchors = S.anchors.filter(a => a.month === ym);
  const monthBlocks = blocksInMonth(ym);
  const doneCount = monthBlocks.filter(b => b.status === 'done').length;

  v.innerHTML = `
    <div class="daynav">
      <button class="icon-btn" data-act="month-prev" aria-label="Previous month">‹</button>
      <h1>${MONTHS[m - 1]} ${y}</h1>
      <button class="icon-btn" data-act="month-next" aria-label="Next month">›</button>
    </div>

    <div class="card">
      <div class="monthgrid">
        ${DOW.map(d => `<div class="dow">${d[0]}</div>`).join('')}
        ${grid}
      </div>
      <div class="legend">
        ${TYPES.map(t => `<span><i class="dot" style="display:inline-block;background:var(${t.v})"></i>${t.label}</span>`).join('')}
        <span>Hollow = planned, solid = done. Bar = how full the day is.</span>
      </div>
    </div>

    <div><div class="section-label">Anchors this month</div>
    <div class="card">
      ${anchors.length ? anchors.map(a => {
        const p = anchorProgress(a);
        return `<div class="anchor">
          <span class="dot" style="background:${esc(a.color)}"></span>
          <span class="anchor-title"><b>${esc(a.title)}</b>
            <span class="muted small"> ${p.done}/${p.target} blocks</span></span>
          <button class="icon-btn" data-act="del-anchor" data-id="${a.id}" aria-label="Remove anchor">✕</button>
          <span class="anchor-bar"><span style="width:${p.pct}%;background:${esc(a.color)}"></span></span>
        </div>`;
      }).join('') : `<p class="muted small">No anchors yet. An anchor is the handful of things that must move this
        month — three at most. Every block you plan can be tied to one, so progress is visible before the deadline is.</p>`}
      ${anchors.length < 4 ? `<button class="btn" data-act="new-anchor" style="margin-top:10px">＋ Add anchor</button>` : ''}
    </div></div>

    <div class="card">
      <div class="statgrid">
        <div class="stat"><b>${doneCount}</b><span>blocks finished</span></div>
        <div class="stat"><b>${fmtDur(monthBlocks.filter(b => b.status === 'done').reduce((a, b) => a + (b.actual || b.dur), 0))}</b><span>focused time</span></div>
        <div class="stat"><b>${Math.round(driftFactor() * 100)}%</b><span>of your estimates</span></div>
      </div>
      ${driftFactor() > 1.15 ? `<p class="muted small" style="margin-top:10px">
        You reliably need about ${Math.round((driftFactor() - 1) * 100)}% longer than you plan. That is not a character
        flaw, it is a measurable constant — new blocks now get padded automatically.</p>` : ''}
    </div>`;
}

/* ── Rendering: REWARDS view ────────────────────────────────────────────── */
function renderRewards() {
  const v = $('#view-rewards');
  const li = levelInfo(S.stats.xp);
  const unlockedCount = Object.keys(S.ach).length;
  const recent = Object.entries(S.ach).sort((a, b) => b[1] - a[1])[0];

  v.innerHTML = `
    <div class="stack">
      <div class="card">
        <div class="statgrid">
          <div class="stat"><b>${li.lvl}</b><span>level</span></div>
          <div class="stat"><b>${S.stats.xp}</b><span>total XP</span></div>
          <div class="stat"><b>${S.stats.streak}</b><span>day streak</span></div>
          <div class="stat"><b>${S.stats.recovery}</b><span>repair tokens</span></div>
        </div>
        <p class="muted small" style="margin-top:12px">
          ${li.need - li.rem} XP to level ${li.lvl + 1}. Repair tokens cover a missed day without resetting your
          streak — you earn one back every seven days. Missing a day is expected, not a failure state.</p>
      </div>

      <div><div class="section-label">Badges (${unlockedCount}/${ACHIEVEMENTS.length})</div>
      <div class="card"><div class="badges">
        ${ACHIEVEMENTS.map(a => {
          const got = !!S.ach[a.id];
          const isNew = recent && recent[0] === a.id && Date.now() - recent[1] < 864e5;
          return `<div class="badge ${got ? '' : 'is-locked'} ${isNew ? 'is-new' : ''}" title="${esc(a.desc)}">
            <em aria-hidden="true">${a.em}</em><b>${esc(a.name)}</b><small>${esc(a.desc)}</small></div>`;
        }).join('')}
      </div></div></div>

      <div><div class="section-label">Themes</div>
      <div class="card"><div class="themegrid">
        ${THEMES.map(t => {
          const locked = li.lvl < t.lvl;
          return `<button class="themecard ${locked ? 'is-locked' : ''}" data-act="theme" data-id="${t.id}"
            aria-pressed="${S.settings.theme === t.id}" ${locked ? 'disabled' : ''}>
            <span class="swatches">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span>
            <b>${esc(t.name)}</b><small>${locked ? `Unlocks at level ${t.lvl}` : esc(t.note)}</small></button>`;
        }).join('')}
      </div></div></div>

      <div class="card">
        <h3>Why there is no leaderboard</h3>
        <p class="muted small">Points here exist to close the gap between doing a thing and being paid for doing it —
        nothing more. There is no comparison to other people, no penalty for a quiet week, and no reward you lose by
        resting. Care and Joy blocks earn exactly what focus blocks earn.</p>
      </div>
    </div>`;
}

/* ── Rendering: WHY view ────────────────────────────────────────────────── */
const EVIDENCE = [
  { f:'The persistent dial and countdown',
    h:'Time is externalised, not remembered',
    p:'Time perception differences are treated as a core feature of ADHD, and a candidate third pathway alongside inhibition and delay aversion — chronic underestimation of how long things take, and losing the thread of elapsed time. The response that holds up is externalising time at the point of performance: putting a visible, continuously updating representation of remaining time in front of you rather than asking an unreliable internal clock. A randomised study of time-assistive devices in children with ADHD improved both time-processing ability and daily time management.',
    l:[['Time perception in adult ADHD: a decade in review (PubMed)','https://pubmed.ncbi.nlm.nih.gov/36833791/']] },
  { f:'Instant XP, halfway pings, per-step payouts',
    h:'Reward has to arrive now, not on Friday',
    p:'A meta-analysis by Marx, Hacker, Yu, Cortese and Sonuga-Barke confirms people with ADHD choose small immediate rewards over larger delayed ones more often than controls, and that offering real rather than hypothetical rewards nearly doubles the effect. Sonuga-Barke\'s delay-aversion model frames this as an aversive emotional response to waiting rather than a preference for less. So every payout in this app lands within seconds of the behaviour: starting pays before finishing does, each sub-step pays on the tick, and nothing important accrues only weekly.',
    l:[['Marx et al., ADHD and the choice of small immediate over larger delayed rewards (J Atten Disord)','https://journals.sagepub.com/doi/10.1177/1087054718772138'],
       ['Behavioural and neurofunctional profiles of delay aversion (Translational Psychiatry)','https://www.nature.com/articles/s41398-025-03353-z']] },
  { f:'The "When … I will …" field on every block',
    h:'Implementation intentions beat good intentions',
    p:'Gollwitzer and Sheeran\'s meta-analysis of 94 independent tests found if-then plans improved goal attainment with a medium-to-large effect (d ≈ 0.65) over holding the goal alone. A 2025 systematic review and meta-analysis in children found effects were strongest in clinical samples, which consisted almost exclusively of children with ADHD, and children with ADHD given an implementation intention outperformed those given a mere goal intention on go/no-go suppression. That is why the cue → action line is the most prominent field in the editor and is read back to you when the block starts.',
    l:[['Gollwitzer & Sheeran, Implementation intentions and goal achievement (meta-analysis)','https://www.researchgate.net/publication/37367696_Implementation_Intentions_and_Goal_Achievement_A_Meta-Analysis_of_Effects_and_Processes'],
       ['Breitwieser et al., Effectiveness of implementation intentions in children (Br J Psychol, 2025)','https://bpspsychub.onlinelibrary.wiley.com/doi/10.1111/bjop.70065?af=R']] },
  { f:'"Start — just two minutes", first tiny move, sub-steps',
    h:'Initiation is the bottleneck, so lower the entry cost',
    p:'Structured CBT for adult ADHD — Safren\'s manualised protocol and its successors — is skills-based and practical: breaking tasks into steps, planning, prioritising, and managing distractibility, with improvements demonstrated against active controls. The app implements those modules directly: A/B/C priorities, forced task breakdown, a first physical action small enough to be trivial, and a start button that only asks for two minutes.',
    l:[['Safren et al., RCT of CBT for adults with ADHD with and without medication (PMC)','https://pmc.ncbi.nlm.nih.gov/articles/PMC3414742/']] },
  { f:'Badges, levels, unlockable themes',
    h:'Game mechanics measurably improve adherence',
    p:'Gamification — points, levels, badges, challenges, customisation applied to non-game contexts — is one of the few reliable levers on engagement and attrition in digital mental-health tools, and an 8-week randomised trial of a gamified educational application in children with ADHD found greater gains in sustained attention and academic measures than a non-gamified equivalent. Customisation is itself a listed mechanic, which is why themes are unlockables rather than a settings afterthought.',
    l:[['Gamified educational application in children with ADHD: 8-week RCT','https://www.researchgate.net/publication/398584473_Effectiveness_of_a_gamified_educational_application_on_attention_and_academic_performance_in_children_with_ADHD_an_8-week_randomized_controlled_trial'],
       ['Gamification to reduce attrition in mobile mental-health interventions: RCT (PMC)','https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7467300/']] },
  { f:'Repair tokens, rewarded rescheduling, no red',
    h:'Shame is the thing that makes people quit the app',
    p:'Low self-compassion is associated with poorer mental health in adults with ADHD specifically, and rejection sensitivity — near-universal in this population by some clinical accounts — reliably predicts anxiety, despair and withdrawal. A planner that punishes a missed day with a broken streak and a red overdue list is optimised to produce exactly that withdrawal. So: missed blocks are neutral grey, moving a block pays XP, streaks bend rather than break, and no screen ever tells you that you failed.',
    l:[['The role of self-compassion in the mental health of adults with ADHD (PMC)','https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9790285/'],
       ['The lived experience of rejection sensitivity in ADHD (PLOS ONE)','https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0314669']] },
  { f:'The parking lot',
    h:'Capture the distraction, keep the block',
    p:'Distractibility management in CBT protocols for adult ADHD uses a "distraction delay": write the intruding thought down, agree to return to it, continue the current task. The capture button is reachable from every screen and from the C key, and parking things pays XP, because the alternative — chasing the thought — costs the whole block.',
    l:[['CBT protocols targeting time-management, planning and distractibility in adults with ADHD','https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4399752/']] },
  { f:'Estimate vs actual, automatic padding, slack warnings',
    h:'Your planning error is a measurable constant',
    p:'Rather than asking you to estimate better — which the underlying time-perception difference makes unlikely — the app logs how long blocks actually take, computes your personal ratio of real to estimated time, and pads new estimates by it. Days packed past their slack get flagged, because transitions and overruns need somewhere to land.',
    l:[['Time perception in adult ADHD: a decade in review (PubMed)','https://pubmed.ncbi.nlm.nih.gov/36833791/']] },
  { f:'Muted palette, one action per screen, Atkinson Hyperlegible',
    h:'Low visual load is an accessibility requirement here',
    p:'Cognitive-accessibility guidance for ADHD converges on the same handful of rules: minimise visual clutter, chunk information with whitespace, restrict primary navigation to a handful of destinations, use progressive disclosure so only one step is visible at a time, avoid autoplaying motion, and prefer soft tones over high-energy colour. The default theme is deliberately the dullest one; Paper and High Contrast go further, and every animation is disabled under prefers-reduced-motion.',
    l:[['Designing digital content for users with cognitive disabilities (Section508.gov)','https://www.section508.gov/design/digital-content-users-with-cognitive-disabilities/'],
       ['Neurodiversity and UX: cognitive accessibility resources','https://stephaniewalter.design/blog/neurodiversity-and-ux-essential-resources-for-cognitive-accessibility/']] },
];
function renderWhy() {
  $('#view-why').innerHTML = `
    <h1>Why the app behaves like this</h1>
    <p class="muted small">Every mechanic below exists because of a specific finding. Where the evidence is thin or
    contested it says so. This page is here so you can disagree with the reasoning rather than just the interface.</p>
    <div class="card">
      ${EVIDENCE.map(e => `<div class="evidence">
        <span class="feature">${esc(e.f)}</span>
        <h3>${esc(e.h)}</h3>
        <p>${esc(e.p)}</p>
        ${e.l.map(([t, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(t)} ↗</a><br>`).join('')}
      </div>`).join('')}
      <p class="muted small"><b>Honest caveat.</b> The time-perception literature in adults is genuinely mixed — some
      studies find clear deficits in time estimation and reproduction, others find none, and much of the delay-aversion
      and implementation-intention evidence is drawn from children. None of this is a substitute for assessment,
      therapy or medication. It is a planner built to fail gently.</p>
    </div>`;
}

/* ── Block editor sheet ─────────────────────────────────────────────────── */
let editing = null; // block id or null
let draft = {};

function openEditor(block) {
  editing = block && block.id && S.blocks[block.id] ? block.id : null;
  const d = driftFactor();
  const base = {
    date: S.ui.date, start: null, dur: 25, type: 'focus', title: '', cue: '', action: '',
    first: '', priority: 'B', energy: 'med', anchorId: '', steps: [],
  };
  draft = Object.assign(base, block || {});
  if (draft.start == null) {
    const slot = findFreeSlot(draft.date, draft.dur);
    if (slot != null) draft.start = slot;
    else {
      /* Today is full or over. Roll to tomorrow morning instead of stacking a
       * block past the end of the day, where it would never be seen. */
      draft.date = addDays(draft.date, 1);
      draft.start = findFreeSlot(draft.date, draft.dur, S.settings.dayStart * 60) ?? S.settings.dayStart * 60;
      setTimeout(() => toast('🌙', 'Moved to tomorrow', 'Today has no room left for this.'), 300);
    }
  }

  $('#sheetTitle').textContent = editing ? 'Edit block' : 'New block';
  $('#f_title').value = draft.title || '';
  $('#f_date').value = draft.date;
  $('#f_start').value = `${pad(Math.floor(draft.start / 60))}:${pad(draft.start % 60)}`;
  $('#f_cue').value = draft.cue || '';
  $('#f_action').value = draft.action || '';
  $('#f_first').value = draft.first || '';
  $('#f_priority').value = draft.priority || 'B';
  $('#f_energy').value = draft.energy || 'med';
  $('#f_steps').value = (draft.steps || []).map(s => s.t).join('\n');
  $('#f_repeat').value = '';
  $('#deleteBlock').hidden = !editing;

  $('#f_type').innerHTML = TYPES.map(t =>
    `<button type="button" class="chip" role="radio" data-color style="--cc:var(${t.v})"
      data-type="${t.id}" aria-checked="${draft.type === t.id}">${t.emoji} ${t.label}</button>`).join('');

  const padded = d > 1.15;
  $('#f_dur').innerHTML = DURATIONS.map(n =>
    `<button type="button" class="chip" role="radio" data-dur="${n}" aria-checked="${draft.dur === n}">${fmtDur(n)}</button>`).join('') +
    `<button type="button" class="chip" data-dur="custom">custom…</button>` +
    (padded && !editing ? `<span class="muted small" style="align-self:center">padded ×${d.toFixed(2)} from your history</span>` : '');

  const anchors = S.anchors.filter(a => a.month === draft.date.slice(0, 7));
  $('#f_goal').innerHTML = '<option value="">— none —</option>' +
    anchors.map(a => `<option value="${a.id}" ${draft.anchorId === a.id ? 'selected' : ''}>${esc(a.title)}</option>`).join('');

  $('#blockSheet').showModal();
  setTimeout(() => $('#f_title').focus(), 60);
}

function collectDraft() {
  const [h, m] = $('#f_start').value.split(':').map(Number);
  draft.title = $('#f_title').value.trim();
  draft.date = $('#f_date').value || draft.date;
  draft.start = (h || 0) * 60 + (m || 0);
  draft.cue = $('#f_cue').value.trim();
  draft.action = $('#f_action').value.trim();
  draft.first = $('#f_first').value.trim();
  draft.priority = $('#f_priority').value;
  draft.energy = $('#f_energy').value;
  draft.anchorId = $('#f_goal').value;
  const lines = $('#f_steps').value.split('\n').map(s => s.trim()).filter(Boolean);
  const old = draft.steps || [];
  draft.steps = lines.map(t => ({ t, done: !!(old.find(o => o.t === t) || {}).done }));
  return draft;
}

function saveEditor() {
  const d = collectDraft();
  if (!d.title) { $('#f_title').focus(); toast('✍️', 'Give it a name', 'Even a bad one. You can fix it later.'); return; }

  const repeat = $('#f_repeat').value;
  const mk = (date, start) => {
    const b = {
      id: uid(), date, start, dur: d.dur, title: d.title, type: d.type, cue: d.cue, action: d.action,
      first: d.first, priority: d.priority, energy: d.energy, anchorId: d.anchorId,
      steps: d.steps.map(s => ({ t: s.t, done: false })), status: 'planned', actual: null,
    };
    S.blocks[b.id] = b;
    return b;
  };

  if (editing) {
    const b = S.blocks[editing];
    Object.assign(b, {
      title: d.title, date: d.date, start: d.start, dur: d.dur, type: d.type, cue: d.cue, action: d.action,
      first: d.first, priority: d.priority, energy: d.energy, anchorId: d.anchorId, steps: d.steps,
    });
    if (d.cue && d.action && !b.intentionPaid) { b.intentionPaid = true; award(3, 'If-then plan written', '🔗'); }
  } else {
    const b = mk(d.date, d.start);
    if (d.cue && d.action) { b.intentionPaid = true; award(3, 'If-then plan written', '🔗'); }
    if (repeat) {
      const [y, mo] = d.date.split('-').map(Number);
      const last = new Date(y, mo, 0).getDate();
      const startDay = Number(d.date.slice(-2));
      const wd = fromISO(d.date).getDay();
      let made = 0;
      for (let day = startDay + 1; day <= last; day++) {
        const dISO = `${d.date.slice(0, 7)}-${pad(day)}`;
        const dow = fromISO(dISO).getDay();
        const want = repeat === 'daily' || (repeat === 'weekdays' && dow > 0 && dow < 6) || (repeat === 'weekly' && dow === wd);
        if (want && !overlaps(dISO, d.start, d.dur)) { mk(dISO, d.start); made++; }
      }
      if (made) toast('🔁', `Repeated ${made}×`, 'Across the rest of the month.');
    }
    /* Auto-buffer: transitions are where time actually disappears. */
    if (S.settings.buffer > 0 && d.type !== 'buffer' && d.dur >= 45) {
      const after = d.start + d.dur;
      if (!overlaps(d.date, after, S.settings.buffer) && after + S.settings.buffer <= S.settings.dayEnd * 60) {
        const bf = mk(d.date, after);
        Object.assign(bf, { title: 'Buffer', type: 'buffer', dur: S.settings.buffer, cue: '', action: '', first: '', steps: [] });
      }
    }
  }
  $('#blockSheet').close();
  if (S.ui.view === 'day') S.ui.date = d.date;
  checkAchievements(); save(); render();
}

/* ── Capture sheet ──────────────────────────────────────────────────────── */
function renderInbox() {
  $('#inboxList').innerHTML = S.inbox.length
    ? S.inbox.map(i => `<li><span>${esc(i.text)}</span>
        <button class="btn btn-quiet small" data-act="schedule-inbox" data-id="${i.id}">Schedule</button>
        <button class="icon-btn" data-act="drop-inbox" data-id="${i.id}" aria-label="Delete">✕</button></li>`).join('')
    : '<li class="muted small">Empty. Good.</li>';
}
function capture(text) {
  if (!text.trim()) return;
  S.inbox.unshift({ id: uid(), text: text.trim(), ts: Date.now() });
  S.stats.captures = (S.stats.captures || 0) + 1;
  award(1, 'Parked — back to it', '🕸️');
  renderInbox(); save();
}

/* ── Settings sheet ─────────────────────────────────────────────────────── */
function renderSettings() {
  const s = S.settings;
  const row = (label, sub, control) =>
    `<div class="setting-row"><label>${label}<span class="sub">${sub}</span></label>${control}</div>`;
  const sw = (act, on) => `<button class="switch" data-act="${act}" role="switch" aria-checked="${on}" aria-label="${act}"></button>`;
  const hours = n => Array.from({ length: 24 }, (_, i) => `<option value="${i}" ${n === i ? 'selected' : ''}>${fmtTime(i * 60)}</option>`).join('');

  $('#settingsBody').innerHTML = `
    ${row('Day starts', 'Top of your timeline', `<select data-act="set-dayStart">${hours(s.dayStart)}</select>`)}
    ${row('Day ends', 'Bottom of your timeline', `<select data-act="set-dayEnd">${hours(s.dayEnd)}</select>`)}
    ${row('Auto-buffer', 'Minutes parked after any block of 45m+', `<input type="number" min="0" max="30" step="5" value="${s.buffer}" data-act="set-buffer">`)}
    ${row('Wrap-up warning', 'Minutes before a block ends', `<input type="number" min="0" max="15" value="${s.wrapWarn}" data-act="set-wrapWarn">`)}
    ${row('Clock', '', `<select data-act="set-clock"><option value="12" ${s.clock == 12 ? 'selected' : ''}>12-hour</option><option value="24" ${s.clock == 24 ? 'selected' : ''}>24-hour</option></select>`)}
    ${row('Sound', 'Halfway, wrap-up and reward chimes', sw('toggle-chime', s.chime))}
    ${row('Reduce motion', 'Kill every transition', sw('toggle-motion', s.motion === 'off'))}
    ${row('Text size', '', `<select data-act="set-step">
        <option value="0.95" ${s.step == 0.95 ? 'selected' : ''}>Small</option>
        <option value="1" ${s.step == 1 ? 'selected' : ''}>Normal</option>
        <option value="1.12" ${s.step == 1.12 ? 'selected' : ''}>Large</option>
        <option value="1.25" ${s.step == 1.25 ? 'selected' : ''}>Largest</option></select>`)}
    <div class="setting-row" style="display:block">
      <label>Your data<span class="sub">Everything lives in this browser only — nothing is uploaded anywhere.
      Export a copy before you clear site data or switch devices.</span></label>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-act="export-copy">Copy backup</button>
        <button class="btn" data-act="export-file">Download backup</button>
        <button class="btn" data-act="import">Restore</button>
      </div>
      <button class="btn btn-danger-quiet" data-act="wipe" style="margin-top:8px">Erase everything</button>
    </div>`;
}

/* ── Reflection ─────────────────────────────────────────────────────────── */
function doReflection() {
  const t = todayISO();
  const wins = prompt('What actually happened today that you are willing to count? Anything counts.');
  if (wins === null) return;
  S.reflections[t] = { wins: wins.trim() || 'Showed up.', ts: Date.now() };
  award(5, 'Day closed out', '🪞');
  render();
}

/* ── Routing ────────────────────────────────────────────────────────────── */
function go(view) {
  S.ui.view = view;
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== view; });
  $$('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.goto === view));
  window.scrollTo({ top: 0, behavior: S.settings.motion === 'off' ? 'auto' : 'smooth' });
  render();
}
function render() {
  const li = levelInfo(S.stats.xp);
  $('#levelChip').textContent = `Lv ${li.lvl}`;
  $('#xpFill').style.width = li.pct + '%';
  $('.xpbar').setAttribute('aria-valuenow', li.pct);
  $('#streakChip').textContent = `🔥 ${S.stats.streak}`;
  document.documentElement.dataset.theme = S.settings.theme;
  document.documentElement.dataset.motion = S.settings.motion;
  document.documentElement.style.setProperty('--step', S.settings.step);

  const v = S.ui.view;
  if (v === 'now') renderNow();
  else if (v === 'day') renderDay();
  else if (v === 'month') renderMonth();
  else if (v === 'rewards') renderRewards();
  else if (v === 'why') renderWhy();
  renderNowBar();
  save();
}

/* ── Events ─────────────────────────────────────────────────────────────── */
function onAction(act, el, ev) {
  const id = el.dataset.id;
  switch (act) {
    case 'start':    startBlock(id); break;
    case 'pause':    pauseActive(); break;
    case 'resume':   resumeActive(); break;
    case 'complete': completeBlock(id); break;
    case 'extend': {
      const b = S.blocks[id];
      if (b) { b.dur += 10; toast('⏳', '+10 minutes', 'Estimate updated, not a failure.'); save(); render(); }
      break;
    }
    case 'move':     moveBlock(id, Number(el.dataset.mins || 60)); break;
    case 'step': {
      const b = S.blocks[id], i = Number(el.dataset.i);
      if (!b || !b.steps[i]) break;
      b.steps[i].done = el.checked;
      if (el.checked) { S.stats.steps = (S.stats.steps || 0) + 1; award(1, 'Step done', '✔️'); }
      /* Patch the one row in place. A full re-render mid-block would yank the
       * list out from under the cursor, which is exactly the derailment this
       * app exists to prevent. */
      const label = el.parentElement && el.parentElement.querySelector('label');
      if (label) label.classList.toggle('done', el.checked);
      save();
      if (b.steps.every(s => s.done)) {
        setTimeout(() => toast('🏁', 'All steps ticked', 'Hit Done when you are ready.'), 200);
      }
      break;
    }
    case 'new':      openEditor(null); break;
    case 'new-at': {
      const h = Number(el.dataset.h);
      const rect = el.getBoundingClientRect();
      const y = ev && ev.clientY != null ? ev.clientY - rect.top : 0;
      const mins = h * 60 + Math.round((y / rect.height) * 60 / 15) * 15;
      openEditor({ date: S.ui.date, start: clamp(mins, 0, 23 * 60 + 45) });
      break;
    }
    case 'edit': {
      const b = S.blocks[id];
      if (!b) break;
      if (b.status === 'done') { toast('✅', 'Already done', 'Leave it be.'); break; }
      openEditor(b);
      break;
    }
    case 'quick25': {
      const start = Math.floor(nowMins() / 5) * 5;
      const b = { id: uid(), date: todayISO(), start, dur: 25, title: 'Focus block', type: 'focus',
                  cue: '', action: '', first: '', priority: 'B', energy: 'med', anchorId: '', steps: [], status: 'planned' };
      S.blocks[b.id] = b; startBlock(b.id);
      break;
    }
    case 'day-prev':  S.ui.date = addDays(S.ui.date, -1); render(); break;
    case 'day-next':  S.ui.date = addDays(S.ui.date, 1); render(); break;
    case 'open-day':  S.ui.date = el.dataset.date; go('day'); break;
    case 'month-prev': case 'month-next': {
      const [y, m] = S.ui.month.split('-').map(Number);
      const d = new Date(y, m - 1 + (act === 'month-next' ? 1 : -1), 1);
      S.ui.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      render(); break;
    }
    case 'new-anchor': {
      const title = prompt('What has to move this month?');
      if (!title) break;
      const n = prompt('Roughly how many blocks will that take? (a number)', '8');
      const palette = ['#4f6bed', '#c4708f', '#4d9a5b', '#c98b3a'];
      S.anchors.push({ id: uid(), month: S.ui.month, title: title.trim(),
        color: palette[S.anchors.length % palette.length], target: clamp(parseInt(n, 10) || 8, 1, 200) });
      award(5, 'Anchor set', '⚓'); render(); break;
    }
    case 'del-anchor':
      S.anchors = S.anchors.filter(a => a.id !== id);
      Object.values(S.blocks).forEach(b => { if (b.anchorId === id) b.anchorId = ''; });
      save(); render(); break;
    case 'schedule-inbox': {
      const item = S.inbox.find(i => i.id === id);
      if (!item) break;
      S.inbox = S.inbox.filter(i => i.id !== id);
      $('#captureSheet').close();
      renderInbox();
      openEditor({ title: item.text, date: S.ui.date });
      break;
    }
    case 'drop-inbox':
      S.inbox = S.inbox.filter(i => i.id !== id); renderInbox(); save(); break;
    case 'reflect':  doReflection(); break;
    case 'theme': {
      const t = THEMES.find(x => x.id === el.dataset.id);
      if (!t || levelInfo(S.stats.xp).lvl < t.lvl) break;
      S.settings.theme = t.id; save(); render();
      toast('🎨', t.name, 'Applied.');
      break;
    }
    /* Settings */
    case 'toggle-chime': S.settings.chime = !S.settings.chime; if (S.settings.chime) chime('done'); renderSettings(); save(); break;
    case 'toggle-motion': S.settings.motion = S.settings.motion === 'off' ? 'auto' : 'off'; renderSettings(); render(); break;
    case 'export-copy': {
      const json = JSON.stringify(S);
      navigator.clipboard.writeText(json)
        .then(() => toast('📋', 'Backup copied', 'Paste it somewhere safe.'))
        .catch(() => toast('⚠️', 'Clipboard blocked', 'Use Download backup instead.'));
      break;
    }
    case 'export-file': {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `timeblock-backup-${todayISO()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'import': {
      const raw = prompt('Paste a backup here. This replaces everything currently stored.');
      if (!raw) break;
      try {
        S = migrate(JSON.parse(raw));
        save(); renderSettings(); render();
        toast('📥', 'Restored', 'Your data is back.');
      } catch (e) { toast('⚠️', 'That did not parse', 'Nothing was changed.'); }
      break;
    }
    case 'wipe':
      if (confirm('Erase every block, badge and setting? This cannot be undone.')) {
        localStorage.removeItem(KEY); S = defaults(); save(); renderSettings(); render();
      }
      break;
  }
}

document.addEventListener('click', ev => {
  const tab = ev.target.closest('[data-goto]');
  if (tab) { go(tab.dataset.goto); return; }

  const chip = ev.target.closest('#f_type .chip, #f_dur .chip');
  if (chip) {
    if (chip.dataset.type) {
      draft.type = chip.dataset.type;
      $$('#f_type .chip').forEach(c => c.setAttribute('aria-checked', c.dataset.type === draft.type));
    } else if (chip.dataset.dur) {
      let n = chip.dataset.dur === 'custom' ? parseInt(prompt('How many minutes?', String(draft.dur)), 10) : Number(chip.dataset.dur);
      if (!n || n < 5) return;
      const d = driftFactor();
      if (!editing && d > 1.15 && chip.dataset.dur !== 'custom') n = Math.round((n * d) / 5) * 5;
      draft.dur = n;
      $$('#f_dur .chip').forEach(c => c.setAttribute('aria-checked', Number(c.dataset.dur) === draft.dur));
      if (n !== Number(chip.dataset.dur) && chip.dataset.dur !== 'custom') {
        toast('📏', `Padded to ${fmtDur(n)}`, 'Based on how long your blocks really take.');
      }
    }
    return;
  }

  const el = ev.target.closest('[data-act]');
  if (!el || el.dataset.act === 'step') return;   // step is handled on 'change'
  onAction(el.dataset.act, el, ev);
});
document.addEventListener('change', ev => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const a = el.dataset.act;
  if (a === 'step') { onAction('step', el, ev); return; }
  if (a.startsWith('set-')) {
    const k = a.slice(4);
    S.settings[k] = k === 'step' ? parseFloat(el.value) : parseInt(el.value, 10);
    if (k === 'dayEnd' && S.settings.dayEnd <= S.settings.dayStart) S.settings.dayEnd = S.settings.dayStart + 1;
    save(); renderSettings(); render();
  }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target.tagName);
  if (typing || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const k = ev.key.toLowerCase();
  if (k === 'c') { ev.preventDefault(); openCapture(); }
  else if (k === 'n') { ev.preventDefault(); openEditor(null); }
  else if (k === ' ') {
    const b = currentBlock();
    if (b) { ev.preventDefault(); S.active && S.active.id === b.id ? (S.active.paused ? resumeActive() : pauseActive()) : startBlock(b.id); }
  }
  else if ('12345'.includes(k)) go(['now', 'day', 'month', 'rewards', 'why'][Number(k) - 1]);
});

function openCapture() { renderInbox(); $('#captureSheet').showModal(); setTimeout(() => $('#captureInput').focus(), 60); }

$('#captureBtn').addEventListener('click', openCapture);
$('#captureClose').addEventListener('click', () => $('#captureSheet').close());
$('#captureForm').addEventListener('submit', ev => {
  ev.preventDefault();
  capture($('#captureInput').value);
  $('#captureInput').value = '';
});
$('#settingsBtn').addEventListener('click', () => { renderSettings(); $('#settingsSheet').showModal(); });
$('#settingsClose').addEventListener('click', () => $('#settingsSheet').close());
$('#saveBlock').addEventListener('click', saveEditor);
$('#cancelBlock').addEventListener('click', () => $('#blockSheet').close());
$('#deleteBlock').addEventListener('click', () => {
  if (editing && confirm('Delete this block?')) { deleteBlock(editing); $('#blockSheet').close(); }
});
$('#blockForm').addEventListener('submit', ev => { ev.preventDefault(); saveEditor(); });
$('#nowbarJump').addEventListener('click', () => go('now'));

/* ── First run ──────────────────────────────────────────────────────────── */
function seedFirstRun() {
  if (S.settings.onboarded) return;
  S.settings.onboarded = true;
  const t = todayISO();
  const start = findFreeSlot(t, 25, Math.max(nowMins() + 5, S.settings.dayStart * 60)) ?? nowMins() + 5;
  const b = {
    id: uid(), date: t, start, dur: 25, title: 'Try one block', type: 'focus',
    cue: 'I finish reading this', action: 'press Start and do literally anything for two minutes',
    first: 'press the button', priority: 'B', energy: 'low', anchorId: '',
    steps: [{ t: 'Press Start', done: false }, { t: 'Do the thing badly', done: false }, { t: 'Press Done', done: false }],
    status: 'planned', actual: null,
  };
  S.blocks[b.id] = b;
  setTimeout(() => toast('👋', 'One block is waiting', 'Twenty-five minutes. Start is the only hard part.'), 700);
  save();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */
load();
seedFirstRun();
go(S.ui.view || 'now');
setInterval(tick, 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
window.addEventListener('beforeunload', () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} });

})();
