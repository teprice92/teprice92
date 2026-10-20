import * as THREE from 'three';
import { createNinjaModel, animateNinja } from './models.js';
import { JUTSU } from './jutsu.js';
import { sfx, footstep } from './audio.js';

// Co-op helpers: the partner's shinobi as seen on this machine, and the
// compact snapshots that travel between the two games.

const r2 = (v) => Math.round(v * 100) / 100;
export const vec = (v) => (v ? [r2(v.x), r2(v.y), r2(v.z)] : null);
export const unvec = (a) => (a ? new THREE.Vector3(a[0], a[1], a[2]) : null);

/** Encodes call arguments so Vector3s survive the trip. */
export function packArgs(args) {
  return args.map((a) => (a && a.isVector3 ? { v: vec(a) } : a));
}
export function unpackArgs(args) {
  return args.map((a) => (a && a.v ? unvec(a.v) : a));
}

const STATES = ['patrol', 'return', 'suspicious', 'search', 'alert'];
export const stateIndex = (s) => Math.max(0, STATES.indexOf(s));
export const stateName = (i) => STATES[i] || 'patrol';

/** The local player's state, sent ~20 times a second. */
export function playerSnapshot(p) {
  return {
    t: 'p',
    p: vec(p.pos), v: vec(p.vel), f: r2(p.facing),
    hp: Math.round(p.hp), mhp: p.maxHp, al: p.alive ? 1 : 0,
    vis: r2(p.visibility), cr: p.crouching ? 1 : 0, h: r2(p.height),
    a: [
      r2(p.dash ? 20 : Math.hypot(p.vel.x, p.vel.z)), p.grounded && !p.dash ? 1 : 0,
      p.sprinting || p.dash ? 1 : 0, p.height < 1.5 ? 1 : 0, p.climbing ? 1 : 0, r2(p.vel.y), r2(p.attackT),
      p.casting > 0 || p.grapple ? 1 : 0,
    ],
    gp: p.grapple ? vec(p.grapple.point) : null,
  };
}

/** The partner's shinobi: follows their snapshots and stands in for them here. */
export class RemotePlayer {
  constructor(game, character) {
    this.game = game;
    this.char = character;
    this.model = createNinjaModel(character);
    this.model.group.rotation.order = 'YXZ';
    game.scene.add(this.model.group);
    this.pos = game.world.spawn.pos.clone().add(new THREE.Vector3(1.6, 0, 0));
    this.vel = new THREE.Vector3();
    this.facing = game.world.spawn.yaw;
    this.height = 1.75;
    this.half = 0.3;
    this.hp = character.stats.hp;
    this.maxHp = this.hp;
    this.alive = true;
    this.visibility = 0.85;
    this.crouching = false;
    this.isRemote = true;
    this.snap = null;
    this.age = 0;
    this.anim = { speed: 0, grounded: true, sprinting: false, crouching: false, climbing: false, vy: 0, attackT: -1, casting: false };
    this.stepT = 0;

    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9c9a3 }));
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    game.scene.add(this.rope);

    // A small name tag in the partner's colour so you can find each other.
    this.tag = makeTag(character);
    this.tag.position.y = 2.25;
    this.model.group.add(this.tag);
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }

  applySnapshot(s) {
    const wasAlive = this.alive;
    this.snap = s;
    this.age = 0;
    this.hp = s.hp;
    this.maxHp = s.mhp;
    this.alive = !!s.al;
    this.visibility = s.vis;
    this.crouching = !!s.cr;
    this.height = s.h;
    if (s.v) this.vel.set(s.v[0], s.v[1], s.v[2]);
    const [speed, grounded, sprinting, crouching, climbing, vy, attackT, casting] = s.a;
    if (attackT >= 0 && this.anim.attackT < 0) sfx('swing', this.pos);
    Object.assign(this.anim, { speed, grounded: !!grounded, sprinting: !!sprinting, crouching: !!crouching, climbing: !!climbing, vy, attackT, casting: !!casting });
    this.grapplePoint = unvec(s.gp);
    if (wasAlive && !this.alive) this.game.onPartnerDown?.();
    if (!wasAlive && this.alive) this.game.onPartnerRevived?.();
  }

  update(dt) {
    const s = this.snap;
    if (s) {
      this.age += dt;
      // Head for where they are now (their last position plus a little extrapolation).
      const lead = Math.min(this.age, 0.12);
      const tx = s.p[0] + this.vel.x * lead, ty = s.p[1] + Math.max(-20, this.vel.y) * lead * 0.5, tz = s.p[2] + this.vel.z * lead;
      const far = Math.hypot(tx - this.pos.x, tz - this.pos.z) > 6;
      const k = far ? 1 : 1 - Math.exp(-dt * 16);
      this.pos.x += (tx - this.pos.x) * k;
      this.pos.y += (ty - this.pos.y) * k;
      this.pos.z += (tz - this.pos.z) * k;
      let d = s.f - this.facing;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.facing += d * (1 - Math.exp(-dt * 18));
    }
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.y = this.facing;
    // Downed: lie on the ground until revived.
    const lie = this.alive ? 0 : -1.45;
    g.rotation.x += (lie - g.rotation.x) * (1 - Math.exp(-dt * 6));
    if (!this.alive) g.position.y += 0.15;
    this.tag.visible = this.game.camera.position.distanceTo(this.pos) > 4;
    if (this.alive) animateNinja(this.model, this.anim, dt);

    // Footsteps you can hear when they're nearby.
    if (this.alive && this.anim.grounded && this.anim.speed > 1) {
      this.stepT -= dt;
      if (this.stepT <= 0) {
        this.stepT = this.anim.crouching ? 0.45 : this.anim.sprinting ? 0.21 : 0.29;
        footstep(this.game.world.surfaceAt(this.pos, null), this.anim.crouching ? 0.2 : 0.5, this.pos);
      }
    }

    this.rope.visible = !!this.grapplePoint;
    if (this.grapplePoint) {
      const a = this.rope.geometry.attributes.position;
      const h = this.center;
      a.setXYZ(0, h.x, h.y + 0.2, h.z);
      a.setXYZ(1, this.grapplePoint.x, this.grapplePoint.y, this.grapplePoint.z);
      a.needsUpdate = true;
    }
  }

  /** A guard hit the partner here: tell their game. */
  takeDamage(amount, fromPos) {
    if (!this.alive) return;
    this.game.net?.send({ t: 'hurt', a: amount, f: vec(fromPos) });
    this.game.effects.burst(this.center, { count: 8, color: 0xb3121b, speed: 3, life: 0.5, size: 0.2, gravity: 10 });
  }

  remove() {
    this.game.scene.remove(this.model.group);
    this.game.scene.remove(this.rope);
  }
}

function makeTag(character) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.font = 'bold 30px "Segoe UI", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 6;
  x.strokeStyle = 'rgba(0,0,0,0.8)';
  const text = `${character.kanji} ${character.name.split(' ')[0]}`;
  x.strokeText(text, 128, 32);
  x.fillStyle = character.color;
  x.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(1.6, 0.4, 1);
  sprite.renderOrder = 10;
  return sprite;
}

/** A light-weight look at the partner's jutsu (the real effects run on their machine). */
export function partnerCastFx(game, remote, id) {
  const j = JUTSU[id];
  if (!j) return;
  const c = remote.center;
  const color = new THREE.Color(j.color).getHex();
  game.effects.burst(c, { count: 30, color, speed: 4, life: 0.6, size: 0.3 });
  game.effects.flashLight(c, color, 40, 0.3);
  if (id === 'earthSplitter') game.effects.shockwave(remote.pos.clone(), color, 8, 0.5);
  if (id === 'lightningBlade') {
    for (let i = 0; i < 5; i++) game.effects.bolt(c, c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.5, (Math.random() - 0.5) * 2)));
  }
  const sound = { spiralSphere: 'rasengan', lightningBlade: 'lightning', fireball: 'fire', earthSplitter: 'earth', healingPalm: 'heal', shadowBind: 'shadow', shadowStep: 'shadow', substitution: 'poof', shadowClone: 'poof' }[id] || 'jutsu';
  sfx(sound, remote.pos);
}
