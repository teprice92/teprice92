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
import { initAudio, sfx } from './audio.js';

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.mode === 'playing' && !this.input.locked) this.pause();
        else if (this.mode === 'paused' && e.code === 'KeyP') this.resume();
      }
    });

    this.buildMenus();
    this.buildScene(); // backdrop for the menus
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------- Setup ----------------

  buildScene() {
    this.scene = new THREE.Scene();
    this.world = buildWorld(this.scene);
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
    const cards = $('char-cards');
    const max = { hp: 150, chakra: 160, speed: 1.2, power: 1.45, stealth: 1.4 };
    for (const c of CHARACTERS) {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.setProperty('--c', c.color);
      const stat = (k, label) => `<div class="stat"><span>${label}</span><div class="meter"><i style="width:${Math.round((c.stats[k] / max[k]) * 100)}%"></i></div></div>`;
      card.innerHTML = `
        <div class="kanji">${c.kanji}</div>
        <h3>${c.name}</h3>
        <div class="title">${c.title}</div>
        <div class="desc">${c.desc}</div>
        ${stat('hp', 'Health')}${stat('chakra', 'Chakra')}${stat('speed', 'Speed')}${stat('power', 'Power')}${stat('stealth', 'Stealth')}
        <ul>${c.jutsu.map((id, i) => `<li>${i + 1} · <b>${JUTSU[id].kanji}</b> ${JUTSU[id].name}</li>`).join('')}</ul>
        <div class="passive">${c.passive}</div>`;
      card.addEventListener('click', () => {
        this.character = c;
        this.showScreen('screen-briefing');
      });
      cards.appendChild(card);
    }
    $('btn-start').addEventListener('click', () => { initAudio(); this.showScreen('screen-select'); });
    $('btn-deploy').addEventListener('click', () => this.startMission());
    $('btn-resume').addEventListener('click', () => this.resume());
    $('btn-quit').addEventListener('click', () => this.toMenu());
    $('btn-again').addEventListener('click', () => this.startMission());
    $('btn-menu').addEventListener('click', () => this.toMenu());
  }

  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
  }

  toMenu() {
    this.mode = 'menu';
    this.hud.show(false);
    this.input.enabled = false;
    this.input.unlock();
    this.disposeScene();
    this.buildScene();
    this.showScreen('screen-select');
  }

  startMission() {
    initAudio();
    this.disposeScene();
    this.buildScene();
    this.player = new Player(this, this.character);
    this.cam.yaw = this.world.spawn.yaw;
    this.cam.pitch = 0.2;
    this.cam.targetDistance = 5.5;
    this.stats = { kills: 0, stealthKills: 0, detected: 0, damageTaken: 0, time: 0, bodiesFound: 0 };
    this.timeScale = 1;
    this.slowT = 0;
    this.senseTime = 0;
    this.enemyTimeScale = 1;
    this.ending = false;
    this.lord = this.guards.find((g) => g.isLord);

    this.hud.setup(this.character);
    this.hud.show(true);
    this.showScreen(null);
    this.input.enabled = true;
    this.input.lock();
    this.mode = 'playing';
    this.clock.getDelta();

    const tips = [
      [0.5, 'Click to lock the mouse. WASD to move, Shift to sprint.'],
      [4.5, 'Stay out of lantern light. Crouch (C) to move silently.'],
      [8.5, 'Get behind an unaware guard and strike: 忍殺 stealth kill.'],
      [12.5, 'Sprint into a wall to run up it. Right-click / F fires your grappling hook.'],
      [16.5, 'Watch the KI meter (top right): it rises as guards sense you.'],
    ];
    for (const [t, msg] of tips) this.after(t, () => this.message(msg));
  }

  pause() {
    if (this.mode !== 'playing') return;
    this.mode = 'paused';
    this.input.enabled = false;
    this.showScreen('screen-pause');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.showScreen(null);
    this.mode = 'playing';
    this.input.enabled = true;
    this.input.lock();
    this.clock.getDelta();
  }

  // ---------------- API used by entities ----------------

  targets() {
    const list = [];
    if (this.player && this.player.alive) list.push(this.player);
    for (const d of this.decoys) if (d.alive) list.push(d);
    return list;
  }

  message(text, cls) { this.hud.message(text, cls); }
  flash(kanji, sub, ms) { this.hud.flash(kanji, sub, ms); }
  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  makeNoise(pos, radius) {
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
    const mesh = new THREE.Mesh(PROJECTILE_GEO[o.type], PROJECTILE_MAT[o.type]);
    mesh.position.copy(o.pos);
    mesh.castShadow = o.type !== 'fireball';
    this.scene.add(mesh);
    this.projectiles.push({ ...o, mesh, pos: o.pos.clone(), vel: o.vel.clone(), life: 4, stuck: false, gravity: o.gravity ?? 0 });
  }

  spawnSmoke(pos, radius, life) {
    this.smokes.push({ pos: pos.clone(), radius, life, emit: 0 });
    this.effects.smokePuff(pos, 1.6);
    sfx('poof');
    for (const g of this.guards) {
      if (g.dead) continue;
      if (g.target === this.player || g.state === 'alert') g.loseTarget(pos);
    }
    this.message('Smoke bomb! Guards lose sight of you.');
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
      this.message(g.isLord ? 'Lord Gōzan spotted you and is fleeing!' : 'You have been spotted!');
      // The guard shouts: nearby guards join the hunt.
      for (const o of this.guards) {
        if (o === g || o.dead || o.boundT > 0 || o.state === 'alert') continue;
        if (o.pos.distanceTo(g.pos) < 22) {
          o.lastKnown = (g.lastKnown || this.player.pos).clone();
          o.becomeAlert(true);
        }
      }
    }
  }

  onBodyFound(g) {
    this.stats.bodiesFound++;
    sfx('suspicious');
    this.message('A guard discovered a body!');
    this.makeNoise(g.pos, 16);
  }

  onGuardKilled(g, stealth) {
    this.stats.kills++;
    if (stealth) this.stats.stealthKills++;
    if (g.isLord) {
      this.flash('天誅', 'Divine Retribution', 2500);
      this.message('Lord Gōzan is dead. Mission complete!');
      this.slowMo(0.25, 1.2);
      this.after(2.2, () => this.endMission(true));
    }
  }

  onPlayerDeath() {
    this.flash('死', 'You have fallen', 2500);
    this.slowMo(0.3, 1.5);
    this.after(2.2, () => this.endMission(false));
  }

  endMission(victory) {
    if (this.ending) return;
    this.ending = true;
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
      ['Shinobi', this.character.name],
      ['Time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`],
      ['Enemies defeated', s.kills],
      ['忍殺 Stealth kills', s.stealthKills],
      ['Times spotted', s.detected],
      ['Bodies discovered', s.bodiesFound],
      ['Damage taken', Math.round(s.damageTaken)],
    ];
    $('result-stats').innerHTML = rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('');
    this.showScreen('screen-result');
  }

  // ---------------- Main loop ----------------

  frame() {
    const raw = Math.min(0.05, this.clock.getDelta());
    if (this.mode === 'playing') this.update(raw);
    else if (this.mode === 'menu') this.menuCamera(raw);
    if (this.mode !== 'paused') this.effects.update(raw * (this.timeScale || 1));
    this.renderer.render(this.scene, this.camera);
    this.input.endFrame();
  }

  menuCamera(dt) {
    this.menuT = (this.menuT || 0) + dt * 0.05;
    const r = 75;
    this.camera.position.set(Math.sin(this.menuT) * r, 30, Math.cos(this.menuT) * r);
    this.camera.lookAt(0, 4, -10);
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
    if (p.alive) {
      this.cam.handleInput(this.input, raw);
      p.update(dt, this.input, this.cam);
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
    const light = this.world.lightAt(p.center);
    let objective = 'Assassinate Lord Gōzan';
    if (this.lord && !this.lord.dead) objective += ` — ${Math.round(this.lord.pos.distanceTo(p.pos))}m (inner garden, behind the keep)`;
    this.hud.update(p, Math.min(99, Math.round(ki)), anyAlert, light, objective);

    const sk = p.alive ? this.stealthKillTarget() : null;
    this.hud.setPrompt(sk ? `忍殺  STEALTH KILL  [Click]` : '');
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
          sfx('hit');
        } else {
          struck.takeDamage(pr.damage, from);
        }
        pr.life = 0;
      } else if (hit) {
        if (pr.onImpact) { pr.onImpact(to); pr.life = 0; continue; }
        pr.stuck = true;
        pr.life = Math.min(pr.life, 6);
        sfx('clank');
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

const game = new Game();
window.__game = game; // handy for debugging from the console
