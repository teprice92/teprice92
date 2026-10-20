import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Player } from './player.js';
import { Guard } from './enemy.js';
import { Effects } from './effects.js';
import { ThirdPersonCamera } from './camera.js';
import { Input } from './input.js';
import { HUD } from './hud.js';
import { CHARACTERS } from './characters.js';
import { JUTSU } from './jutsu.js';
import { raycast } from './physics.js';
import { loadModels } from './rigged.js';
import { MODEL_MANIFEST } from './models.js';
import { initAudio, sfx, setVolume, setListener, setMusicState, setPond } from './audio.js';
import { PostFX } from './post.js';
import { loadSettings, saveSettings, renderSettings } from './settings.js';
import { setupTouch, goFullscreen } from './touch.js';
import { Gamepads } from './gamepad.js';
import { Net } from './net.js';
import { RemotePlayer, playerSnapshot, packArgs, unpackArgs, vec, unvec, partnerCastFx } from './coop.js';
import { Decoy } from './jutsu.js';
import { createNinjaModel, animateNinja } from './models.js';

const $ = (id) => document.getElementById(id);

const PROJECTILE_GEO = {
  kunai: new THREE.BoxGeometry(0.06, 0.06, 0.45),
  arrow: new THREE.BoxGeometry(0.04, 0.04, 0.9),
  shuriken: new THREE.CylinderGeometry(0.16, 0.16, 0.02, 4),
  fireball: new THREE.SphereGeometry(0.42, 14, 10),
};
const PROJECTILE_MAT = {
  kunai: new THREE.MeshStandardMaterial({ color: 0x2a2a30, metalness: 0.8, roughness: 0.3 }),
  arrow: new THREE.MeshStandardMaterial({ color: 0x8a6a40 }),
  shuriken: new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.9, roughness: 0.2 }),
  fireball: new THREE.MeshBasicMaterial({ color: 0xff8a2a, toneMapped: false }),
};

function segmentPointDist(a, b, p) {
  const ab = b.clone().sub(a);
  const t = Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / Math.max(ab.lengthSq(), 1e-8)));
  return a.clone().addScaledVector(ab, t).distanceTo(p);
}

class Game {
  constructor() {
    this.container = $('game');
    this.settings = loadSettings();
    for (const k of ['master', 'music', 'sfx']) setVolume(k, this.settings[k]);
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 900);
    this.cam = new ThirdPersonCamera(this.camera);
    this.input = new Input(this.renderer.domElement);
    this.input.onUnlock = () => { if (this.mode === 'playing') this.pause(); };
    this.hud = new HUD();
    this.clock = new THREE.Clock();
    this.mode = 'menu';
    this.character = null;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.post.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.mode === 'playing' && !this.overlay && !this.input.locked) this.pause();
        else if ((this.mode === 'paused' || this.overlay) && e.code === 'KeyP') this.resume();
      }
    });

    this.pads = new Gamepads(this);
    this.net = null;
    this.remote = null;
    this.buildMenus();
    setupTouch(this);
    this.buildScene(); // backdrop for the menus
    this.post = new PostFX(this.renderer, this.scene, this.camera, this.settings.quality);
    this.hurtT = 0;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- Setup ----------------

  buildScene() {
    this.scene = new THREE.Scene();
    this.world = buildWorld(this.scene, { quality: this.settings.quality });
    if (this.post) this.post.setScene(this.scene);
    setPond(this.world.pond);
    this.effects = new Effects(this.scene);
    this.guards = this.world.guardDefs.map((d) => new Guard(this, d));
    this.decoys = [];
    this.projectiles = [];
    this.smokes = [];
    this.timers = [];
    this.player = null;
    // Soft light from the camera so your shinobi stays readable at night.
    this.fill = new THREE.DirectionalLight(0x8fa4d8, 0.45);
    this.scene.add(this.fill, this.fill.target);
  }

  disposeScene() {
    if (!this.scene) return;
    this.scene.traverse((o) => {
      if (o.geometry && !Object.values(PROJECTILE_GEO).includes(o.geometry)) o.geometry.dispose();
    });
  }

  buildMenus() {
    // ----- Character select: a roster of tiles plus a detail panel; the chosen
    // shinobi stands in the 3D scene next to it. -----
    const roster = $('char-roster');
    for (const c of CHARACTERS) {
      const tile = document.createElement('button');
      tile.className = 'char-tile';
      tile.dataset.id = c.id;
      tile.style.setProperty('--c', c.color);
      tile.innerHTML = `<span class="tk">${c.kanji}</span><span class="tn">${c.name.split(' ')[0]}</span>`;
      tile.addEventListener('click', () => {
        if (this.previewId === c.id) this.chooseCharacter(c);
        else this.previewCharacter(c);
      });
      tile.addEventListener('mouseenter', () => this.previewCharacter(c));
      tile.addEventListener('padfocus', () => this.previewCharacter(c));
      roster.appendChild(tile);
    }

    $('btn-start').addEventListener('click', () => { this.leaveCoop(); this.enterSelect(); });
    $('btn-coop').addEventListener('click', () => this.openCoop());
    $('btn-settings').addEventListener('click', () => this.showScreen('screen-settings'));
    $('btn-controls').addEventListener('click', () => this.showScreen('screen-controls'));
    // Any first press on the menus wakes the audio and (on phones) goes fullscreen.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('button, .card')) return;
      initAudio();
      if (this.touch && this.mode !== 'playing') goFullscreen();
      sfx('ui');
    });
    document.querySelectorAll('[data-to]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.to === 'screen-select') this.enterSelect();
      else this.showScreen(b.dataset.to);
    }));
    $('btn-select-back').addEventListener('click', () => this.toTitle());
    $('btn-coop-back').addEventListener('click', () => this.toTitle());

    const onSetting = (key, value) => {
      this.settings[key] = value;
      saveSettings(this.settings);
      if (key === 'quality') {
        this.post.build(value);
        // Grass, shadows and mist are baked into the world; rebuild it now if we're on a menu.
        if (this.mode === 'menu') { this.disposeScene(); this.buildScene(); }
        for (const id of ['settings-title', 'settings-pause']) renderSettings($(id), this.settings, onSetting);
      } else {
        initAudio();
        setVolume(key, value);
      }
    };
    for (const id of ['settings-title', 'settings-pause']) renderSettings($(id), this.settings, onSetting);

    // ----- Online co-op lobby -----
    $('btn-host').addEventListener('click', () => this.hostGame());
    $('btn-join').addEventListener('click', () => this.joinGame($('join-code').value));
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.joinGame($('join-code').value); });
    $('join-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    $('btn-share').addEventListener('click', async () => {
      const url = new URL(location.href);
      url.searchParams.set('room', this.net?.code || '');
      const text = `Join my Shinobi Shadows mission! Room code ${this.net?.code}`;
      try {
        if (navigator.share) await navigator.share({ title: 'Shinobi Shadows', text, url: url.href });
        else { await navigator.clipboard.writeText(url.href); this.coopStatus('Invite link copied. Waiting for your partner…'); }
      } catch { /* share sheet closed */ }
    });
    const room = new URLSearchParams(location.search).get('room');
    if (room) {
      // Opened from an invite link: go straight to joining.
      $('join-code').value = room.toUpperCase().slice(0, 4);
      this.openCoop();
      this.coopStatus('Tap Join to team up with your partner.');
    }

    $('btn-deploy').addEventListener('click', () => {
      if (this.net?.isGuest) return;
      if (this.net && !this.partnerChar) return;
      this.startMission();
    });
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-quit').addEventListener('click', () => { this.leaveCoop(); this.toMenu(); });
    $('btn-again').addEventListener('click', () => { if (!this.net?.isGuest) this.startMission(); });
    $('btn-menu').addEventListener('click', () => {
      this.net?.send({ t: 'toSelect' });
      this.toMenu();
    });
    $('btn-title').addEventListener('click', () => { this.leaveCoop(); this.toTitle(); });
  }

  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    document.body.classList.toggle('on-select', id === 'screen-select');
  }

  toTitle() {
    if (this.mode !== 'menu' && this.mode !== 'select') { this.toMenu(); }
    this.mode = 'menu';
    this.clearPreview();
    this.showScreen('screen-title');
  }

  /** Back to the menus after a mission (rebuilds the world as a backdrop). */
  toMenu() {
    this.mode = 'menu';
    this.overlay = false;
    this.hud.show(false);
    this.hud.setPartner(null);
    this.input.enabled = false;
    this.input.unlock();
    this.disposeScene();
    this.buildScene();
    this.enterSelect();
  }

  // ---------------- Character select ----------------

  enterSelect() {
    this.mode = 'select';
    this.showScreen('screen-select');
    this.updateSelectPartner();
    this.previewCharacter(this.character || CHARACTERS[0], true);
  }

  previewCharacter(c, quiet = false) {
    if (this.previewId === c.id && this.preview?.[c.id]) return;
    this.previewId = c.id;
    for (const t of document.querySelectorAll('.char-tile')) t.classList.toggle('selected', t.dataset.id === c.id);
    const max = { hp: 150, chakra: 160, speed: 1.2, power: 1.45, stealth: 1.4 };
    const stat = (k, label) => `<div class="stat"><span>${label}</span><div class="meter"><i style="width:${Math.round((c.stats[k] / max[k]) * 100)}%"></i></div></div>`;
    const d = $('char-detail');
    d.style.setProperty('--c', c.color);
    d.innerHTML = `
      <div class="kanji">${c.kanji}</div>
      <h3>${c.name}</h3>
      <div class="title">${c.title}</div>
      <div class="desc">${c.desc}</div>
      ${stat('hp', 'Health')}${stat('chakra', 'Chakra')}${stat('speed', 'Speed')}${stat('power', 'Power')}${stat('stealth', 'Stealth')}
      <ul>${c.jutsu.map((id, i) => `<li><span class="kb">${i + 1}</span><span class="gp">LB+${'XYB'[i]}</span> · <b>${JUTSU[id].kanji}</b> ${JUTSU[id].name}</li>`).join('')}</ul>
      <div class="passive">${c.passive}</div>
      <button class="btn choose-btn">Choose ${c.name.split(' ')[0]}</button>`;
    d.querySelector('.choose-btn').addEventListener('click', () => this.chooseCharacter(c));

    // The 3D stand-in.
    this.ensurePreview();
    for (const [id, m] of Object.entries(this.preview)) m.group.visible = id === c.id;
    this.previewSpin = 0;
    if (!quiet) {
      const at = this.stagePos.clone().setY(this.stagePos.y + 1);
      this.effects.smokePuff(at, 0.7);
      sfx('poof');
    }
  }

  ensurePreview() {
    if (this.preview && this.previewScene === this.scene) return;
    this.preview = {};
    this.previewScene = this.scene;
    // A quiet corner just outside the gate, lit like a stage.
    this.stagePos = this.world.spawn.pos.clone().add(STAGE_OFFSET);
    for (const c of CHARACTERS) {
      const m = createNinjaModel(c);
      m.group.position.copy(this.stagePos);
      m.group.visible = false;
      this.scene.add(m.group);
      this.preview[c.id] = m;
      for (let i = 0; i < 12; i++) animateNinja(m, IDLE, 0.1); // settle out of the T-pose
    }
    const partner = this.partnerChar && createNinjaModel(this.partnerChar);
    this.partnerPreview = partner || null;
    if (partner) {
      partner.group.position.copy(this.stagePos).add(new THREE.Vector3(-1.4, 0, -0.9));
      this.scene.add(partner.group);
      for (let i = 0; i < 12; i++) animateNinja(partner, IDLE, 0.1);
    }
    // Light the stage with the existing fill light: adding lights would make
    // every material recompile its shaders, a long stall on phones.
    this.fill.position.copy(this.stagePos).add(new THREE.Vector3(2.5, 4, 5));
    this.fill.target.position.copy(this.stagePos).setY(this.stagePos.y + 1);
    this.fill.intensity = 1.8;
    this.fill.color.setHex(0xffe6c8);
  }

  clearPreview() {
    if (!this.preview) return;
    for (const m of Object.values(this.preview)) this.scene.remove(m.group);
    if (this.partnerPreview) this.scene.remove(this.partnerPreview.group);
    this.fill.intensity = 0.45;
    this.fill.color.setHex(0x8fa4d8);
    this.preview = null;
    this.partnerPreview = null;
  }

  selectCamera(dt) {
    const p = this.stagePos;
    // Frame the shinobi on the left; the info panel sits on the right.
    const narrow = window.innerWidth < window.innerHeight * 1.2;
    this.camera.position.set(p.x + (narrow ? 0 : 1.1), p.y + 1.3, p.z + (narrow ? 4.6 : 3.8));
    this.camera.lookAt(p.x + (narrow ? 0 : 1.6), p.y + 0.95, p.z);
    this.previewSpin += dt;
    for (const m of Object.values(this.preview || {})) {
      if (!m.group.visible) continue;
      m.group.rotation.y = 0.35 + Math.sin(this.previewSpin * 0.6) * 0.35;
      animateNinja(m, IDLE, dt);
    }
    if (this.partnerPreview) {
      this.partnerPreview.group.rotation.y = 0.6;
      animateNinja(this.partnerPreview, IDLE, dt);
    }
    for (const g of this.guards) g.update(dt);
  }

  chooseCharacter(c) {
    this.character = c;
    this.net?.send({ t: 'pick', c: c.id });
    this.showBriefing();
  }

  showBriefing() {
    this.mode = 'menu';
    this.showScreen('screen-briefing');
    this.updateBriefing();
  }

  updateBriefing() {
    const note = $('briefing-coop');
    const deploy = $('btn-deploy');
    note.classList.toggle('hidden', !this.net);
    deploy.disabled = false;
    deploy.textContent = 'Deploy';
    if (!this.net) return;
    const partner = this.partnerChar ? `${this.partnerChar.kanji} ${this.partnerChar.name}` : 'still choosing…';
    note.innerHTML = `<b>Co-op.</b> You: ${this.character.kanji} ${this.character.name} · Partner: ${partner}. If one of you falls, the other can revive them by standing close for a moment. The mission fails if you both fall.`;
    if (this.net.isGuest) { deploy.disabled = true; deploy.textContent = 'Waiting for host…'; }
    else if (!this.partnerChar) { deploy.disabled = true; deploy.textContent = 'Waiting for partner…'; }
  }

  updateSelectPartner() {
    const el = $('select-partner');
    if (!this.net) { el.textContent = ''; return; }
    el.innerHTML = this.partnerChar
      ? `Partner: <b style="color:${this.partnerChar.color}">${this.partnerChar.kanji} ${this.partnerChar.name.split(' ')[0]}</b>`
      : 'Partner is choosing…';
  }

  // ---------------- Online co-op ----------------

  openCoop() {
    this.leaveCoop();
    $('coop-choose').classList.remove('hidden');
    $('coop-hosting').classList.add('hidden');
    this.coopStatus('');
    this.showScreen('screen-coop');
  }

  coopStatus(text, error = false) {
    const el = $('coop-status');
    el.textContent = text;
    el.classList.toggle('error', error);
  }

  makeNet() {
    this.leaveCoop();
    this.partnerChar = null;
    const net = new Net({
      onConnect: () => {
        this.coopStatus('Connected!');
        sfx('jutsu');
        net.send({ t: 'hello' });
        this.enterSelect();
      },
      onMessage: (m) => this.onNet(m),
      onDisconnect: (reason) => this.onNetLost(reason),
      onStatus: (text) => this.coopStatus(text, true),
    });
    this.net = net;
    return net;
  }

  async hostGame() {
    const net = this.makeNet();
    this.coopStatus('Creating a room…');
    try {
      const code = await net.host();
      if (this.net !== net) return;
      $('coop-choose').classList.add('hidden');
      $('coop-hosting').classList.remove('hidden');
      $('room-code').textContent = code;
      this.coopStatus('Waiting for your partner to join…');
    } catch (err) {
      if (this.net === net) { this.net = null; this.coopStatus(err.message, true); }
    }
  }

  async joinGame(code) {
    const net = this.makeNet();
    this.coopStatus('Connecting…');
    try {
      await net.join(code);
    } catch (err) {
      if (this.net === net) { net.close(); this.net = null; this.coopStatus(err.message, true); }
    }
  }

  leaveCoop() {
    if (!this.net) return;
    this.net.send({ t: 'bye' });
    const n = this.net;
    this.net = null;
    setTimeout(() => n.close(), 150);
    this.partnerChar = null;
    if (this.remote) { this.remote.remove(); this.remote = null; }
    this.hud.setPartner(null);
  }

  onNetLost(reason) {
    const wasGuest = this.net?.isGuest;
    this.net = null;
    this.partnerChar = null;
    if (this.mode === 'playing' || this.mode === 'paused') {
      if (this.remote) { this.remote.remove(); this.remote = null; }
      this.hud.setPartner(null);
      if (wasGuest) {
        // The host ran the guards, so the mission can't go on without them.
        this.endMission(false, `${reason}. The mission ended.`);
      } else {
        this.message(`${reason}. You're on your own now.`);
      }
      return;
    }
    if (this.mode === 'result') { $('result-note').textContent = reason; return; }
    this.openCoop();
    this.coopStatus(reason, true);
  }

  guardCall(g, method, args) {
    this.net?.send({ t: 'gc', i: this.guards.indexOf(g), m: method, a: packArgs(args) });
  }

  nearestTarget(pos) {
    let best = this.player?.pos || pos, bd = Infinity;
    for (const t of [this.player, this.remote]) {
      if (!t || !t.alive) continue;
      const d = t.pos.distanceTo(pos);
      if (d < bd) { bd = d; best = t.pos; }
    }
    return best;
  }

  onNet(m) {
    const playing = this.mode === 'playing' || this.mode === 'paused';
    switch (m.t) {
      case 'hello': break;
      case 'pick':
        this.partnerChar = CHARACTERS.find((c) => c.id === m.c) || CHARACTERS[0];
        this.updateSelectPartner();
        if (this.preview) { this.clearPreview(); if (this.mode === 'select') this.previewCharacter(CHARACTERS.find((c) => c.id === this.previewId), true); }
        if (!$('screen-briefing').classList.contains('hidden')) this.updateBriefing();
        break;
      case 'toSelect':
        if (this.mode === 'result') this.toMenu();
        break;
      case 'bye':
        this.net?.close();
        this.onNetLost('Your partner left');
        break;
      case 'start':
        // Host deployed: both start the same mission.
        this.character = CHARACTERS.find((c) => c.id === m.you) || this.character;
        this.partnerChar = CHARACTERS.find((c) => c.id === m.host) || this.partnerChar;
        this.startMission(true);
        break;
      case 'p':
        if (playing && this.remote) this.remote.applySnapshot(m);
        break;
      case 'g':
        if (playing && this.net?.isGuest) m.s.forEach((s, i) => { if (this.guards[i]) this.guards[i].netSnap = s; });
        break;
      case 'gc': {
        const g = this.guards[m.i];
        if (playing && g && this.net?.isHost) g[m.m]?.(...unpackArgs(m.a));
        break;
      }
      case 'noise':
        if (playing && this.net?.isHost) this.makeNoise(unvec(m.p), m.r, true);
        break;
      case 'hurt':
        if (playing && this.player?.alive) this.player.takeDamage(m.a, unvec(m.f));
        break;
      case 'pr':
        if (playing) this.spawnProjectile({ type: m.k, owner: m.o, pos: unvec(m.p), vel: unvec(m.v), gravity: m.g, damage: m.d || 0, radius: m.r, fromNet: true });
        break;
      case 'sm':
        if (playing) this.spawnSmoke(unvec(m.p), m.r, m.l, true);
        break;
      case 'dc':
        if (playing) {
          const c = CHARACTERS.find((x) => x.id === m.c) || CHARACTERS[0];
          const d = new Decoy(this, unvec(m.p), unvec(m.d), c, { seed: m.s, id: m.id });
          this.decoys.push(d);
          this.effects.smokePuff(d.center, 0.6);
        }
        break;
      case 'dp': {
        const d = this.decoys.find((x) => x.id === m.id);
        if (d) d.poof(true);
        break;
      }
      case 'cast':
        if (playing && this.remote) partnerCastFx(this, this.remote, m.j);
        break;
      case 'ev':
        if (!playing) break;
        if (m.k === 'alert') {
          sfx('alert');
          this.message(m.lord ? 'Lord Gōzan spotted one of you and is fleeing!' : m.you ? 'You have been spotted!' : 'Your partner has been spotted!');
        } else if (m.k === 'body') {
          sfx('suspicious');
          this.message('A guard discovered a body!');
        } else if (m.k === 'kill') {
          this.flash('天誅', 'Divine Retribution', 2500);
          this.message('Lord Gōzan is dead. Mission complete!');
          this.slowMo(0.25, 1.2);
        }
        break;
      case 'end':
        if (playing) this.endMission(m.v, null, m.s);
        break;
      default: break;
    }
  }

  /** Per-frame co-op work: send our state, revive a downed partner, check for a wipe. */
  netTick(raw) {
    const net = this.net;
    if (!net) return;
    if (this.mode !== 'playing' && this.mode !== 'paused') return;
    this.netT = (this.netT || 0) - raw;
    if (this.netT <= 0) {
      this.netT = 0.05;
      if (this.player) net.send(playerSnapshot(this.player));
      if (net.isHost) net.send({ t: 'g', s: this.guards.map((g) => g.snapshot()) });
    }
  }

  // ---------------- Missions ----------------

  startMission(fromNet = false) {
    initAudio();
    if (this.net?.isHost && !fromNet) {
      if (!this.partnerChar) return;
      this.net.send({ t: 'start', host: this.character.id, you: this.partnerChar.id });
    }
    this.clearPreview();
    this.disposeScene();
    this.buildScene();
    this.player = new Player(this, this.character);
    this.player.model.group.rotation.order = 'YXZ';
    if (this.net) {
      // Guest starts a step to the side of the host.
      if (this.net.isGuest) this.player.pos.x += 1.6;
      this.remote = new RemotePlayer(this, this.partnerChar || CHARACTERS[0]);
      if (this.net.isHost) this.remote.pos.x += 1.6;
      else this.remote.pos.x -= 1.6;
      this.hud.setPartner(this.remote);
    } else {
      this.remote = null;
      this.hud.setPartner(null);
    }
    this.cam.yaw = this.world.spawn.yaw;
    this.cam.pitch = 0.2;
    this.cam.targetDistance = 5.5;
    this.stats = { kills: 0, stealthKills: 0, detected: 0, damageTaken: 0, time: 0, bodiesFound: 0 };
    this.timeScale = 1;
    this.slowT = 0;
    this.senseTime = 0;
    this.enemyTimeScale = 1;
    this.ending = false;
    this.overlay = false;
    this.reviveT = 0;
    this.lastHp = undefined;
    this.hurtT = 0;
    this.lord = this.guards.find((g) => g.isLord);

    this.hud.setup(this.character);
    this.hud.show(true);
    this.showScreen(null);
    this.input.enabled = true;
    if (!this.touch && !this.pads.active) this.input.lock();
    this.mode = 'playing';
    this.clock.getDelta();

    const pad = this.pads.active;
    const tips = this.touch && !pad ? [
      [0.5, 'Left thumb moves (push to the edge to sprint), right thumb looks.'],
      [4.5, 'Stay out of lantern light. 伏 crouches to move silently.'],
      [8.5, 'Get behind an unaware guard and tap 斬: 忍殺 stealth kill.'],
      [12.5, 'Sprint into a wall to run up it. 鉤 fires your grappling hook. Tap a jutsu to cast it.'],
      [16.5, 'Watch the KI meter (top right): it rises as guards sense you.'],
    ] : pad ? [
      [0.5, 'Left stick moves (push it all the way to sprint), right stick looks.'],
      [4.5, 'Stay out of lantern light. Y crouches to move silently.'],
      [8.5, 'Get behind an unaware guard and press X: 忍殺 stealth kill.'],
      [12.5, 'Sprint into a wall to run up it. B fires your grappling hook. Hold LB and press X / Y / B for jutsu.'],
      [16.5, 'Watch the KI meter (top right): it rises as guards sense you.'],
    ] : [
      [0.5, 'Click to lock the mouse. WASD to move, Shift to sprint.'],
      [4.5, 'Stay out of lantern light. Crouch (C) to move silently.'],
      [8.5, 'Get behind an unaware guard and strike: 忍殺 stealth kill.'],
      [12.5, 'Sprint into a wall to run up it. Right-click / F fires your grappling hook.'],
      [16.5, 'Watch the KI meter (top right): it rises as guards sense you.'],
    ];
    if (this.net) tips.push([20.5, `Co-op: your partner shows up with their name over their head. Stick together, or split up and strike from two sides.`]);
    for (const [t, msg] of tips) this.after(t, () => this.message(msg));
  }

  pause() {
    if (this.mode !== 'playing' || this.overlay) return;
    this.input.enabled = false;
    this.input.keys.clear();
    this.input.buttons.clear();
    $('pause-coop').classList.toggle('hidden', !this.net);
    if (this.net) this.overlay = true; // online, the world keeps running
    else this.mode = 'paused';
    this.showScreen('screen-pause');
  }

  resume() {
    if (this.mode !== 'paused' && !this.overlay) return;
    this.showScreen(null);
    this.mode = 'playing';
    this.overlay = false;
    this.input.enabled = true;
    if (!this.touch && !this.pads.active) this.input.lock();
    this.clock.getDelta();
  }

  // ---------------- API used by entities ----------------

  targets() {
    const list = [];
    if (this.player && this.player.alive) list.push(this.player);
    if (this.remote && this.remote.alive) list.push(this.remote);
    for (const d of this.decoys) if (d.alive) list.push(d);
    return list;
  }

  message(text, cls) { this.hud.message(text, cls); }
  flash(kanji, sub, ms) { this.hud.flash(kanji, sub, ms); }
  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  makeNoise(pos, radius, fromNet = false) {
    if (this.net?.isGuest && this.mode === 'playing') { this.net.send({ t: 'noise', p: vec(pos), r: radius }); return; }
    for (const g of this.guards) g.hear(pos, radius);
  }

  /** World point under the crosshair (or far along the aim ray). */
  aimPoint(maxDist = 60) {
    const { origin, dir } = this.cam.aimRay();
    const hit = raycast(this.world.colliders, origin, dir, maxDist);
    let best = hit ? hit.t : maxDist;
    // Also aim at guards under the crosshair.
    for (const g of this.guards) {
      if (g.dead) continue;
      const c = g.center;
      const t = c.clone().sub(origin).dot(dir);
      if (t < 0 || t > best) continue;
      if (origin.clone().addScaledVector(dir, t).distanceTo(c) < 0.8) best = t;
    }
    return origin.clone().addScaledVector(dir, best);
  }

  spawnProjectile(o) {
    // Online, the other game gets a copy: a harmless one for our own throws (hits are
    // worked out here), and the real thing for guards' arrows so each player can dodge.
    if (this.net && !o.fromNet && (o.owner === 'player' || this.net.isHost)) {
      this.net.send({ t: 'pr', k: o.type, o: o.owner === 'player' ? 'fx' : o.owner, p: vec(o.pos), v: vec(o.vel), g: o.gravity ?? 0, d: o.owner === 'player' ? 0 : o.damage, r: o.radius });
      if (o.owner === 'enemy') sfx(o.type === 'arrow' ? 'arrow' : 'throw', o.pos);
    }
    if (o.fromNet && o.owner === 'enemy') sfx(o.type === 'arrow' ? 'arrow' : 'throw', o.pos);
    if (o.fromNet && o.type === 'fireball') o.onImpact = (at) => this.fireballFx(at);
    const mesh = new THREE.Mesh(PROJECTILE_GEO[o.type], PROJECTILE_MAT[o.type]);
    mesh.position.copy(o.pos);
    mesh.castShadow = o.type !== 'fireball';
    this.scene.add(mesh);
    this.projectiles.push({ ...o, mesh, pos: o.pos.clone(), vel: o.vel.clone(), life: 4, stuck: false, gravity: o.gravity ?? 0 });
  }

  spawnSmoke(pos, radius, life, fromNet = false) {
    this.smokes.push({ pos: pos.clone(), radius, life, emit: 0 });
    this.effects.smokePuff(pos, 1.6);
    sfx('poof', pos);
    if (fromNet && !this.net?.isHost) return;
    if (!fromNet) this.net?.send({ t: 'sm', p: vec(pos), r: radius, l: life });
    for (const g of this.guards) {
      if (g.dead) continue;
      const near = g.target && g.target.pos.distanceTo(pos) < radius * 1.5;
      if (g.target === this.player || near || g.state === 'alert') g.loseTarget(pos);
    }
    if (!fromNet) this.message('Smoke bomb! Guards lose sight of you.');
  }

  /** The explosion of a partner's fireball (the damage happens on their machine). */
  fireballFx(at) {
    this.effects.burst(at, { count: 90, color: 0xff7a2a, speed: 9, life: 0.8, size: 0.6, drag: 3, up: 2 });
    this.effects.shockwave(at.clone().setY(Math.max(0, at.y - 1)), 0xff7a2a, 6);
    this.effects.flashLight(at, 0xff7a2a, 150, 0.8, 26);
    sfx('boom', at);
  }

  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (segmentPointDist(a, b, s.pos) < s.radius * 0.85) return true;
    }
    return false;
  }

  slowMo(scale, duration) { this.timeScale = scale; this.slowT = duration; }

  stealthKillTarget() {
    const p = this.player;
    if (!p || p.dash || p.grapple || p.locked > 0) return null;
    let best = null, bestD = Infinity;
    for (const g of this.guards) {
      if (g.dead) continue;
      if (g.state === 'alert' && g.boundT <= 0) continue;
      const dy = p.pos.y - g.pos.y;
      const hd = Math.hypot(p.pos.x - g.pos.x, p.pos.z - g.pos.z);
      const level = hd < 2.4 && Math.abs(dy) < 1.4;
      const fromAbove = !p.grounded && dy > 0.5 && dy < 6 && hd < 2;
      if ((level || fromAbove) && hd < bestD) { bestD = hd; best = g; }
    }
    return best;
  }

  performStealthKill(g) {
    const p = this.player;
    // Step in behind the victim.
    const behind = g.pos.clone().addScaledVector(g.forward, -1.0);
    behind.y = Math.max(behind.y, g.pos.y);
    p.pos.copy(behind);
    p.vel.set(0, 0, 0);
    p.facing = g.facing;
    p.locked = 0.5;
    p.invuln = 0.9;
    p.attackT = 0;
    p.attackHitDone = true;
    g.bind(10);
    g.executing = true;
    this.pads.rumble(0.8, 250);
    g.awareness = 0;
    this.slowMo(0.3, 0.75);
    this.cam.targetDistance = 3.2;
    this.flash('忍殺', 'Stealth Kill', 1300);
    sfx('swing');
    this.after(0.22, () => {
      g.die(true);
      sfx('stealthKill');
      this.effects.burst(g.center, { count: 40, color: 0x9a0d14, speed: 5, life: 0.9, size: 0.22, gravity: 12 });
      this.cam.shake(0.2);
    });
    this.after(0.75, () => { this.cam.targetDistance = 5.5; });
  }

  onGuardAlert(g, fromShout) {
    if (!fromShout) {
      this.stats.detected++;
      sfx('alert');
      const partner = g.target && g.target === this.remote;
      this.net?.send({ t: 'ev', k: 'alert', you: partner, lord: g.isLord });
      this.message(g.isLord ? `Lord Gōzan spotted ${this.net ? 'one of you' : 'you'} and is fleeing!` : partner ? 'Your partner has been spotted!' : 'You have been spotted!');
      // The guard shouts: nearby guards join the hunt.
      for (const o of this.guards) {
        if (o === g || o.dead || o.boundT > 0 || o.state === 'alert') continue;
        if (o.pos.distanceTo(g.pos) < 22) {
          o.lastKnown = (g.lastKnown || this.nearestTarget(g.pos)).clone();
          o.becomeAlert(true);
        }
      }
    }
  }

  onBodyFound(g) {
    this.stats.bodiesFound++;
    this.net?.send({ t: 'ev', k: 'body' });
    sfx('suspicious');
    this.message('A guard discovered a body!');
    this.makeNoise(g.pos, 16);
  }

  onGuardKilled(g, stealth) {
    this.stats.kills++;
    if (stealth) this.stats.stealthKills++;
    if (g.isLord) {
      this.net?.send({ t: 'ev', k: 'kill' });
      this.flash('天誅', 'Divine Retribution', 2500);
      this.message('Lord Gōzan is dead. Mission complete!');
      this.slowMo(0.25, 1.2);
      this.after(2.2, () => this.endMission(true));
    }
  }

  onPlayerDeath() {
    this.pads.rumble(1, 400);
    if (this.remote?.alive) {
      this.flash('倒', 'Downed: your partner can revive you', 2500);
      return;
    }
    this.flash('死', 'You have fallen', 2500);
    this.slowMo(0.3, 1.5);
    this.checkWipe();
  }

  onPartnerDown() {
    this.message(this.player?.alive ? 'Your partner is down! Stand next to them to revive them.' : 'Your partner has fallen too.');
    this.checkWipe();
  }

  onPartnerRevived() { this.message('Your partner is back on their feet.'); }

  /** Solo: you fell. Co-op: both of you fell (the host decides). */
  checkWipe() {
    if (this.net?.isGuest) return;
    if (this.player?.alive || this.remote?.alive) return;
    this.after(2.2, () => this.endMission(false));
  }

  endMission(victory, note = null, netStats = null) {
    if (this.ending) return;
    this.ending = true;
    if (netStats) Object.assign(this.stats, netStats, { damageTaken: this.stats.damageTaken });
    if (this.net?.isHost) this.net.send({ t: 'end', v: victory, s: this.stats });
    this.mode = 'result';
    this.input.enabled = false;
    this.input.unlock();
    this.hud.show(false);
    sfx(victory ? 'victory' : 'fail');
    const s = this.stats;
    const t = Math.round(s.time);
    let score = 1000 + s.stealthKills * 120 - (s.kills - s.stealthKills) * 40 - Math.max(0, t - 240) * 2;
    score += s.detected === 0 ? 600 : -s.detected * 150;
    score -= s.bodiesFound * 60;
    const ranks = [
      [2200, 'Kage', 'Grand Master'],
      [1700, 'Jōnin', 'Master Ninja'],
      [1200, 'Chūnin', 'Ninja'],
      [700, 'Genin', 'Novice'],
      [-Infinity, 'Academy Student', 'Thug'],
    ];
    const [, rank, sub] = ranks.find(([min]) => score >= min);
    $('result-title').textContent = victory ? 'Mission Complete' : 'Mission Failed';
    $('result-rank').innerHTML = victory ? `${rank}<small>${sub} · score ${Math.max(0, score)}</small>` : `—<small>The Iron Lord lives on</small>`;
    const rows = [
      [this.net || this.remote ? 'Team' : 'Shinobi', this.remote ? `${this.character.name} & ${this.remote.char.name}` : this.character.name],
      ['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
      ['Enemies defeated', s.kills],
      ['忍殺 Stealth kills', s.stealthKills],
      ['Times spotted', s.detected],
      ['Bodies discovered', s.bodiesFound],
      ['Damage taken', Math.round(s.damageTaken)],
    ];
    $('result-stats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    $('result-note').textContent = note || (this.net?.isGuest ? 'The host can start the next mission.' : '');
    $('btn-again').disabled = !!this.net?.isGuest;
    $('btn-again').textContent = this.net?.isGuest ? 'Waiting for host…' : 'Play Again';
    if (this.remote) { this.remote.remove(); this.remote = null; }
    this.showScreen('screen-result');
  }

  // ---------------- Main loop ----------------

  frame() {
    const raw = Math.min(0.05, this.clock.getDelta());
    this.elapsed = (this.elapsed || 0) + raw;
    // View frustum (from last frame's camera) so distant or off-screen guards can animate less often.
    this.frameNo = (this.frameNo || 0) + 1;
    this.camera.updateMatrixWorld();
    this.frustum = this.frustum || new THREE.Frustum();
    this.frustum.setFromProjectionMatrix(VIEW_PROJ.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    this.pads.poll(raw);
    if (this.mode === 'playing') this.update(raw);
    else if (this.mode === 'select') this.selectCamera(raw);
    else if (this.mode === 'menu') this.menuCamera(raw);
    this.netTick(raw);
    if (this.mode !== 'paused') {
      this.effects.update(raw * (this.timeScale || 1));
      this.world.update(this.elapsed, raw);
    }
    if (this.mode === 'menu' || this.mode === 'select' || this.mode === 'result') setMusicState('menu');
    setListener(this.camera.position, this.mode === 'playing' ? this.cam.yaw : 0);
    this.hurtT = Math.max(0, this.hurtT - raw * 2.5);
    this.post.render(this.elapsed, { sense: this.mode === 'playing' && this.senseTime > 0 ? 1 : 0, hurt: Math.min(1, this.hurtT) });
    this.input.endFrame();
  }

  menuCamera(dt) {
    // Slow cinematic drift around the compound.
    this.menuT = (this.menuT || 0) + dt * 0.04;
    const r = 62 + Math.sin(this.menuT * 0.7) * 10;
    this.camera.position.set(Math.sin(this.menuT) * r, 20 + Math.sin(this.menuT * 1.3) * 6, Math.cos(this.menuT) * r);
    this.camera.lookAt(0, 6, -14);
    for (const g of this.guards) g.update(dt);
  }

  update(raw) {
    if (this.slowT > 0) {
      this.slowT -= raw;
      if (this.slowT <= 0) this.timeScale = 1;
    }
    const dt = raw * this.timeScale;
    this.stats.time += raw;

    if (this.senseTime > 0) this.senseTime -= raw;
    this.enemyTimeScale = this.senseTime > 0 ? 0.35 : 1;
    this.hud.setSense(this.senseTime > 0);
    const edt = dt * this.enemyTimeScale;

    // Timers
    const due = [];
    this.timers = this.timers.filter((t) => { t.t -= dt; if (t.t <= 0) { due.push(t.fn); return false; } return true; });
    due.forEach((fn) => fn());

    const p = this.player;
    this.cam.handleInput(this.input, raw);
    if (p.alive) p.update(dt, this.input, this.cam);
    else p.updateDowned(raw);
    if (this.remote) {
      this.remote.update(raw);
      this.updateRevive(raw);
      this.hud.updatePartner(this.remote, !this.remote.alive ? 'DOWN' : '');
    }
    for (const g of this.guards) g.update(edt);
    for (const d of this.decoys) d.update(dt);
    this.decoys = this.decoys.filter((d) => d.alive);
    this.updateProjectiles(dt, edt);
    this.updateSmokes(dt);
    this.cam.update(raw, p, this.world.colliders);
    this.fill.position.copy(this.camera.position);
    this.fill.target.position.copy(p.pos);

    // Crosshair turns into a ring when the grappling hook can reach.
    const aim = this.cam.aimRay();
    const ah = raycast(this.world.colliders, aim.origin, aim.dir, 45);
    this.hud.setGrappleAim(!!ah && ah.box.tag !== 'ground');

    // ----- HUD -----
    let ki = 0, anyAlert = false;
    for (const g of this.guards) {
      if (g.dead) continue;
      const d = g.pos.distanceTo(p.pos);
      if (g.state === 'alert' && d < 40) anyAlert = true;
      if (d < 30) ki = Math.max(ki, (1 - d / 30) * 30, g.awareness);
    }
    let suspicious = false;
    for (const g of this.guards) {
      if (!g.dead && (g.state === 'suspicious' || g.state === 'search') && g.pos.distanceTo(p.pos) < 40) suspicious = true;
    }
    setMusicState(!p.alive ? 'silent' : anyAlert ? 'alert' : suspicious || ki >= 35 ? 'tense' : 'calm');
    if (p.hp < (this.lastHp ?? p.hp)) this.hurtT = 1;
    this.lastHp = p.hp;
    const light = this.world.lightAt(p.center);
    let objective = 'Assassinate Lord Gōzan';
    if (this.lord && !this.lord.dead) objective += ` — ${Math.round(this.lord.pos.distanceTo(p.pos))}m (inner garden, behind the keep)`;
    this.hud.update(p, Math.min(99, Math.round(ki)), anyAlert, light, objective);

    const sk = p.alive ? this.stealthKillTarget() : null;
    const btn = this.pads.active ? 'X' : this.touch ? '斬' : 'Click';
    let prompt = sk ? `忍殺  STEALTH KILL  [${btn}]` : '';
    if (this.reviveT > 0) prompt = `蘇生  REVIVING ${Math.round(this.reviveT / 2 * 100)}%`;
    this.hud.setPrompt(prompt);
  }

  /** Standing next to a downed partner for two seconds brings them back. */
  updateRevive(dt) {
    const p = this.player, r = this.remote;
    const close = p.alive !== r.alive && p.pos.distanceTo(r.pos) < 2.4;
    this.reviveT = close ? this.reviveT + dt : Math.max(0, this.reviveT - dt * 2);
    if (this.reviveT >= 2) {
      this.reviveT = 0;
      if (!p.alive) { p.revive(); this.message('Your partner revived you!'); }
    }
  }

  updateProjectiles(dt, edt) {
    const cols = this.world.colliders;
    for (const pr of this.projectiles) {
      const step = pr.owner === 'enemy' ? edt : dt;
      pr.life -= step;
      if (pr.stuck) continue;
      pr.vel.y -= pr.gravity * step;
      const from = pr.pos.clone();
      const move = pr.vel.clone().multiplyScalar(step);
      const len = move.length();
      if (len < 1e-6) continue;
      const dir = move.clone().divideScalar(len);
      const hit = raycast(cols, from, dir, len);
      const to = hit ? new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) : from.clone().add(move);

      // Hit entities along the segment.
      let struck = null;
      if (pr.owner === 'player') {
        for (const g of this.guards) {
          if (g.dead) continue;
          if (segmentPointDist(from, to, g.center) < (pr.radius || 0.75)) { struck = g; break; }
        }
      } else {
        for (const t of this.targets()) {
          if (t.isRemote) continue; // their own game works out their hits
          const c = t.center;
          if (segmentPointDist(from, to, c) < 0.75) { struck = t; break; }
        }
      }

      pr.pos.copy(to);
      pr.mesh.position.copy(to);
      if (pr.type === 'shuriken') pr.mesh.rotation.y += step * 30;
      else pr.mesh.lookAt(to.clone().add(dir));
      if (pr.type === 'fireball') {
        for (let i = 0; i < 4; i++) this.effects.trail(to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8)), Math.random() < 0.5 ? 0xff7a2a : 0xffd04a, 0.9, 0.35);
      }

      if (struck) {
        if (pr.onImpact) { pr.onImpact(to); pr.life = 0; continue; }
        if (pr.owner === 'player') {
          // Kunai to an unsuspecting guard does double damage.
          const mult = struck.state === 'alert' ? 1 : 2;
          struck.takeDamage(pr.damage * mult, from, { knock: 2 });
          this.effects.burst(struck.center, { count: 10, color: 0xb3121b, speed: 3, life: 0.4, size: 0.18, gravity: 10 });
          sfx('hit', struck.center);
        } else {
          struck.takeDamage(pr.damage, from);
        }
        pr.life = 0;
      } else if (hit) {
        if (pr.onImpact) { pr.onImpact(to); pr.life = 0; continue; }
        pr.stuck = true;
        pr.life = Math.min(pr.life, 6);
        sfx(pr.owner === 'player' ? 'kunaiHit' : 'clank', to);
        if (pr.owner === 'player') this.makeNoise(to, 7);
      }
    }
    this.projectiles = this.projectiles.filter((pr) => {
      if (pr.life > 0) return true;
      this.scene.remove(pr.mesh);
      return false;
    });
  }

  updateSmokes(dt) {
    for (const s of this.smokes) {
      s.life -= dt;
      s.emit -= dt;
      if (s.emit <= 0 && s.life > 1) {
        s.emit = 0.12;
        const p = s.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * s.radius, (Math.random() - 0.3) * 2, (Math.random() - 0.5) * s.radius));
        this.effects.burst(p, { count: 3, color: 0xcfcfcf, speed: 0.8, life: 2.2, size: 3.2, smoke: true, alpha: 0.55, drag: 1, grow: 0.6 });
      }
    }
    this.smokes = this.smokes.filter((s) => s.life > 0);
  }
}

const VIEW_PROJ = new THREE.Matrix4();
const STAGE_OFFSET = new THREE.Vector3(0, 0, 0); // character select stands you in front of the gate
const IDLE = { speed: 0, grounded: true, sprinting: false, crouching: false, climbing: false, vy: 0, attackT: -1, casting: false };

// Load the 3D character models first; any that are missing fall back to the primitive look.
const startBtn = $('btn-start');
const menuBtns = [startBtn, $('btn-coop')];
for (const b of menuBtns) b.disabled = true;
startBtn.textContent = 'Loading…';
loadModels(MODEL_MANIFEST, (done, total) => { startBtn.textContent = `Loading ${done}/${total}`; }).finally(() => {
  for (const b of menuBtns) b.disabled = false;
  startBtn.textContent = 'Story Mission';
  window.__game = new Game(); // handy for debugging from the console
});
