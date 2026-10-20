import * as THREE from 'three';
import { createNinjaModel, animateNinja } from './models.js';
import { moveAndCollide, raycast, lineOfSight, pointInBoxes } from './physics.js';
import { sfx } from './audio.js';

// Jutsu library. Each cast(game, player, cam) returns false to cancel
// (no chakra spent), anything else counts as a successful cast.

function aimFlat(cam) {
  const f = cam.forward;
  return new THREE.Vector3(f.x, 0, f.z).normalize();
}

function areaDamage(game, center, radius, damage, knock, player) {
  let hits = 0;
  for (const g of game.guards) {
    if (g.dead) continue;
    const d = g.center.distanceTo(center);
    if (d > radius) continue;
    g.takeDamage(damage * (1 - 0.4 * d / radius) * player.stats.power, center, { knock });
    hits++;
  }
  return hits;
}

export const JUTSU = {
  shadowClone: {
    name: 'Shadow Clone', kanji: '影分身', cost: 30, cooldown: 9, color: '#ffb347',
    cast(game, p, cam) {
      const f = aimFlat(cam);
      const count = p.char.id === 'hayate' ? 3 : 2;
      for (let i = 0; i < count; i++) {
        const ang = (i - (count - 1) / 2) * 0.9 + (Math.random() - 0.5) * 0.3;
        const dir = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), ang);
        const start = p.pos.clone().addScaledVector(dir, 0.8);
        game.decoys.push(new Decoy(game, start, dir, p.char));
        game.effects.smokePuff(start.clone().setY(start.y + 1), 0.6);
      }
      sfx('poof');
      game.message('Shadow Clones: guards will chase the copies');
    },
  },

  spiralSphere: {
    name: 'Spiral Sphere', kanji: '螺旋丸', cost: 40, cooldown: 7, color: '#5fd1ff',
    cast(game, p, cam) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0x8fe4ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending }),
      );
      game.scene.add(sphere);
      let alive = true;
      const follow = () => {
        sphere.position.copy(p.handPos);
        const s = 0.8 + Math.sin(performance.now() * 0.03) * 0.15;
        sphere.scale.setScalar(s);
        for (let i = 0; i < 3; i++) {
          const a = Math.random() * Math.PI * 2;
          game.effects.trail(sphere.position.clone().add(new THREE.Vector3(Math.cos(a) * 0.35, Math.sin(a * 2) * 0.3, Math.sin(a) * 0.35)), 0x5fd1ff, 0.22, 0.15);
        }
      };
      game.effects.add(sphere, 1.2, () => { if (alive) follow(); });
      p.casting = 0.35;
      sfx('rasengan');
      const dir = aimFlat(cam);
      game.after(0.3, () => {
        p.startDash({
          dir, speed: 30, time: 0.4, color: 0x5fd1ff,
          onHit: (guard) => {
            const at = guard.center;
            areaDamage(game, at, 3.2, 130, 14, p);
            game.effects.burst(at, { count: 70, color: 0x8fe4ff, speed: 12, life: 0.6, size: 0.35 });
            game.effects.shockwave(guard.pos, 0x8fe4ff, 5);
            game.effects.flashLight(at, 0x8fe4ff, 80, 0.4);
            game.cam.shake(0.45);
            game.makeNoise(at, 14);
            sfx('boom', at);
            return true;
          },
          onEnd: () => {
            alive = false;
            sphere.visible = false;
            game.effects.burst(sphere.position, { count: 20, color: 0x8fe4ff, speed: 4, life: 0.4, size: 0.25 });
          },
        });
      });
    },
  },

  windDash: {
    name: 'Wind Dash', kanji: '風遁', cost: 18, cooldown: 2.5, color: '#b8f2c9',
    cast(game, p, cam) {
      const dir = aimFlat(cam);
      p.startDash({
        dir, speed: 58, time: 0.24, invuln: true, color: 0xc8ffe0,
        onHit: (guard) => {
          guard.takeDamage(30 * p.stats.power, p.pos, { knock: 10 });
          game.effects.burst(guard.center, { count: 20, color: 0xc8ffe0, speed: 6, life: 0.4, size: 0.25 });
          return false;
        },
      });
      sfx('swing');
    },
  },

  lightningBlade: {
    name: 'Lightning Blade', kanji: '雷切', cost: 45, cooldown: 7, color: '#9fd8ff',
    cast(game, p, cam) {
      const { origin, dir: aim } = cam.aimRay();
      let target = null, best = 0.8;
      for (const g of game.guards) {
        if (g.dead) continue;
        const to = g.center.sub(origin);
        const d = to.length();
        if (d > 20) continue;
        const dot = to.normalize().dot(aim);
        if (dot > best && lineOfSight(game.world.colliders, p.center, g.center)) { best = dot; target = g; }
      }
      p.casting = 0.25;
      sfx('lightning');
      game.makeNoise(p.pos, 14);
      const crackle = () => {
        const h = p.handPos;
        game.effects.bolt(h, h.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.6)));
      };
      for (let i = 0; i < 6; i++) game.after(i * 0.04, crackle);
      game.after(0.22, () => {
        let dir = aimFlat(cam);
        let time = 0.3;
        if (target && !target.dead) {
          dir = target.center.sub(p.center);
          time = Math.min(0.7, dir.length() / 50 + 0.1);
        }
        p.startDash({
          dir, speed: 50, time, color: 0x9fd8ff, invuln: true,
          onTick: () => { if (Math.random() < 0.5) crackle(); },
          onHit: (guard) => {
            guard.takeDamage(170 * p.stats.power, p.pos, { knock: 6 });
            const c = guard.center;
            for (let i = 0; i < 8; i++) game.effects.bolt(c, c.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 3, (Math.random() - 0.5) * 4)));
            game.effects.burst(c, { count: 50, color: 0x9fd8ff, speed: 10, life: 0.5, size: 0.25 });
            game.effects.flashLight(c, 0x9fd8ff, 90, 0.35);
            game.cam.shake(0.35);
            return true;
          },
        });
      });
    },
  },

  fireball: {
    name: 'Fireball', kanji: '火遁', cost: 30, cooldown: 4.5, color: '#ff6a2a',
    cast(game, p, cam) {
      p.casting = 0.3;
      const target = game.aimPoint(80);
      const from = p.center.add(new THREE.Vector3(0, 0.45, 0)).addScaledVector(aimFlat(cam), 0.8);
      const dir = target.sub(from).normalize();
      game.spawnProjectile({
        type: 'fireball', owner: 'player', pos: from, vel: dir.multiplyScalar(26), gravity: 0, radius: 0.9,
        onImpact: (at) => {
          areaDamage(game, at, 4.8, 90, 10, p);
          game.effects.burst(at, { count: 90, color: 0xff7a2a, speed: 9, life: 0.8, size: 0.6, drag: 3, up: 2 });
          game.effects.burst(at, { count: 30, color: 0x333333, speed: 4, life: 1.5, size: 1.4, smoke: true, alpha: 0.6, grow: 1.5, up: 1.5 });
          game.effects.shockwave(at.clone().setY(Math.max(0, at.y - 1)), 0xff7a2a, 6);
          game.effects.flashLight(at, 0xff7a2a, 150, 0.8, 26);
          game.cam.shake(0.4);
          game.makeNoise(at, 26);
          sfx('boom', at);
        },
      });
      sfx('fire');
    },
  },

  crimsonEye: {
    name: 'Crimson Eye', kanji: '写輪眼', cost: 35, cooldown: 16, color: '#ff2a2a',
    cast(game) {
      game.senseTime = 7;
      game.flash('写輪眼', 'Crimson Eye');
      sfx('jutsu');
      game.message('Time slows. You see every guard and where they look.');
    },
  },

  earthSplitter: {
    name: 'Earth Splitter', kanji: '土遁', cost: 35, cooldown: 6, color: '#d9a066',
    cast(game, p) {
      p.casting = 0.3;
      game.after(0.18, () => {
        const at = p.pos.clone();
        areaDamage(game, at.clone().setY(at.y + 1), 6.5, 80, 15, p);
        game.effects.shockwave(at, 0xd9a066, 8, 0.5);
        game.effects.burst(at, { count: 50, color: 0x8a7255, speed: 8, life: 1.0, size: 0.5, gravity: 14, up: 6, smoke: true, alpha: 0.9 });
        game.effects.burst(at, { count: 30, color: 0x5a4a3a, speed: 5, life: 1.6, size: 1.6, smoke: true, alpha: 0.5, grow: 1.2, up: 1 });
        game.cam.shake(0.7);
        game.makeNoise(at, 22);
        sfx('earth');
      });
    },
  },

  healingPalm: {
    name: 'Healing Palm', kanji: '掌仙術', cost: 30, cooldown: 10, color: '#6bff9a',
    cast(game, p) {
      if (p.hp >= p.maxHp) { game.message('Already at full health'); return false; }
      p.heal = { left: 55, rate: 40 };
      p.casting = 0.6;
      sfx('heal');
    },
  },

  substitution: {
    name: 'Substitution', kanji: '変わり身', cost: 20, cooldown: 6, color: '#c8a46b',
    cast(game, p, cam) {
      const from = p.pos.clone();
      // Leave a log behind in a puff of smoke.
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2b }));
      log.position.copy(from).setY(from.y + 0.7);
      log.rotation.z = 0.3;
      log.castShadow = true;
      game.scene.add(log);
      game.effects.add(log, 6, (t) => { if (t > 0.9) log.scale.setScalar((1 - t) * 10); });
      game.effects.smokePuff(log.position, 1);
      // Hop backwards.
      const back = aimFlat(cam).negate();
      moveAndCollide(p.pos, p.half, p.height, back.multiplyScalar(10).setY(0.2), game.world.colliders);
      p.vel.set(0, 0, 0);
      p.endGrapple(false);
      p.invuln = 1.2;
      p.invulnBlink = true;
      game.effects.smokePuff(p.center, 0.5);
      for (const g of game.guards) g.loseTarget(log.position);
      sfx('poof');
    },
  },

  shadowBind: {
    name: 'Shadow Bind', kanji: '影縛り', cost: 35, cooldown: 10, color: '#9b6bff',
    cast(game, p, cam) {
      const f = aimFlat(cam);
      const caught = [];
      for (const g of game.guards) {
        if (g.dead) continue;
        const to = g.pos.clone().sub(p.pos);
        const d = to.length();
        if (d > 15) continue;
        to.y = 0;
        if (d > 2 && to.normalize().dot(f) < 0.35) continue;
        if (!lineOfSight(game.world.colliders, p.center, g.center)) continue;
        caught.push(g);
      }
      if (!caught.length) { game.message('No guards in front of you to bind'); return false; }
      p.casting = 0.5;
      sfx('shadow');
      for (const g of caught) {
        g.bind(6);
        // A dark tendril of shadow stretching across the ground.
        const a = p.pos.clone(), b = g.pos.clone();
        const len = a.distanceTo(b);
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(0.5, 1),
          new THREE.MeshBasicMaterial({ color: 0x05000a, transparent: true, opacity: 0.85, depthWrite: false }),
        );
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = Math.atan2(b.x - a.x, b.z - a.z);
        game.scene.add(strip);
        game.effects.add(strip, 6, (t) => {
          const grow = Math.min(1, t * 12);
          strip.scale.set(1, len * grow, 1);
          const mid = a.clone().lerp(b, grow * 0.5);
          strip.position.set(mid.x, Math.max(a.y, b.y) + 0.04, mid.z);
          strip.material.opacity = t > 0.9 ? (1 - t) * 8.5 : 0.85;
        });
        game.effects.burst(g.pos, { count: 16, color: 0x1a0a2a, speed: 2, life: 0.8, size: 0.6, smoke: true, alpha: 0.8 });
      }
      game.message(`Shadow Bind: ${caught.length} guard${caught.length > 1 ? 's' : ''} frozen - strike now!`);
    },
  },

  shadowStep: {
    name: 'Shadow Step', kanji: '影歩', cost: 22, cooldown: 2.5, color: '#7a5cff',
    cast(game, p, cam) {
      const { origin, dir } = cam.aimRay();
      const range = 24;
      const hit = raycast(game.world.colliders, origin, dir, range);
      const dest = hit
        ? new THREE.Vector3(hit.point.x + hit.n.x * 0.5, hit.point.y, hit.point.z + hit.n.z * 0.5)
        : origin.clone().addScaledVector(dir, range);
      if (hit && hit.n.y < 0.5) dest.y = Math.max(0, hit.point.y - 0.9);
      if (hit && hit.n.y < -0.5) dest.y = hit.point.y - p.standHeight - 0.1;
      // Nudge upward until the destination is free.
      let ok = false;
      for (let i = 0; i < 6; i++) {
        const probes = [dest.clone().setY(dest.y + 0.1), dest.clone().setY(dest.y + p.standHeight * 0.5), dest.clone().setY(dest.y + p.standHeight - 0.1)];
        if (!probes.some((q) => pointInBoxes(game.world.colliders, q))) { ok = true; break; }
        dest.y += 0.6;
      }
      if (!ok) { game.message('Cannot step there'); return false; }
      game.effects.burst(p.center, { count: 30, color: 0x150a25, speed: 3, life: 0.7, size: 0.7, smoke: true, alpha: 0.85 });
      p.pos.copy(dest);
      p.vel.set(0, 0, 0);
      p.endGrapple(false);
      game.effects.burst(p.center, { count: 30, color: 0x150a25, speed: 3, life: 0.7, size: 0.7, smoke: true, alpha: 0.85 });
      sfx('shadow');
    },
  },
};

/** A shadow clone: runs off on its own and draws guard attention. */
export class Decoy {
  constructor(game, pos, dir, character) {
    this.game = game;
    this.model = createNinjaModel(character);
    game.scene.add(this.model.group);
    this.pos = pos.clone();
    this.vel = dir.clone().multiplyScalar(9);
    this.height = 1.75;
    this.half = 0.3;
    this.life = 8;
    this.alive = true;
    this.isDecoy = true;
    this.visibility = 1.3;
    this.turnT = 1 + Math.random();
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + 1, this.pos.z); }

  update(dt) {
    if (!this.alive) return;
    this.life -= dt;
    if (this.life <= 0) { this.poof(); return; }
    this.turnT -= dt;
    if (this.turnT <= 0) {
      this.turnT = 1 + Math.random() * 1.5;
      const a = (Math.random() - 0.5) * 1.6;
      const speed = Math.hypot(this.vel.x, this.vel.z);
      const ang = Math.atan2(this.vel.x, this.vel.z) + a;
      this.vel.x = Math.sin(ang) * speed; this.vel.z = Math.cos(ang) * speed;
    }
    this.vel.y -= 30 * dt;
    const res = moveAndCollide(this.pos, this.half, this.height, this.vel.clone().multiplyScalar(dt), this.game.world.colliders);
    if (res.onGround) this.vel.y = 0;
    if (res.hitWall) {
      // Bounce off walls and keep running.
      if (res.wallNormal.x) this.vel.x = Math.abs(this.vel.x) * res.wallNormal.x;
      if (res.wallNormal.z) this.vel.z = Math.abs(this.vel.z) * res.wallNormal.z;
    }
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.y = Math.atan2(this.vel.x, this.vel.z);
    animateNinja(this.model, { speed: 12, grounded: true, sprinting: true, crouching: false, climbing: false, vy: 0, attackT: -1 }, dt);
  }

  takeDamage() { this.poof(); }

  poof() {
    if (!this.alive) return;
    this.alive = false;
    this.game.scene.remove(this.model.group);
    this.game.effects.smokePuff(this.center, 0.8);
    sfx('poof', this.pos);
    for (const g of this.game.guards) if (g.target === this) g.loseTarget(this.pos);
  }
}
