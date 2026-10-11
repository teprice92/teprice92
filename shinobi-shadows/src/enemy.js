import * as THREE from 'three';
import { buildGuard, animateGuard } from './models.js';
import { moveAndCollide, lineOfSight } from './physics.js';
import { makeMarker } from './effects.js';
import { turnToward } from './player.js';
import { sfx } from './audio.js';

const TYPES = {
  sword: { hp: 100, walk: 2.4, run: 6.4, sight: 24, fov: 62, damage: 14, reach: 2.1, throws: true },
  archer: { hp: 70, walk: 2.0, run: 5.0, sight: 34, fov: 55, damage: 12, ranged: true },
  elite: { hp: 200, walk: 2.6, run: 7.4, sight: 26, fov: 66, damage: 20, reach: 2.3, throws: true },
  lord: { hp: 120, walk: 1.6, run: 5.6, sight: 16, fov: 60, damage: 8, reach: 1.8, coward: true },
};

const SUSPICIOUS_AT = 25;
const ALERT_AT = 100;
const UP = new THREE.Vector3(0, 1, 0);

export class Guard {
  constructor(game, def) {
    this.game = game;
    this.type = def.type;
    this.cfg = TYPES[def.type];
    this.path = def.path.map(([x, z]) => new THREE.Vector3(x, def.y || 0, z));
    this.pos = this.path[0].clone();
    this.homeFacing = def.face ?? 0;
    this.facing = this.homeFacing;
    this.stationary = !!def.stationary;
    this.vel = new THREE.Vector3();
    this.wp = this.path.length > 1 ? 1 : 0;
    this.waitT = 0;
    this.hp = this.cfg.hp;
    this.maxHp = this.cfg.hp;
    this.state = 'patrol';
    this.awareness = 0;
    this.lastKnown = null;
    this.target = null; // entity currently seen
    this.lostT = 0;
    this.searchT = 0;
    this.searchPoint = null;
    this.attackT = -1;
    this.attackCd = 0;
    this.shootCd = 1 + Math.random();
    this.aimT = 0;
    this.boundT = 0;
    this.stunT = 0;
    this.dead = false;
    this.deadT = 0;
    this.bodyFound = false;
    this.stuckT = 0;
    this.detourT = 0;
    this.detourDir = null;
    this.lookT = Math.random() * 10;
    this.speedNow = 0;
    this.half = 0.35;
    this.height = 1.85;
    this.isLord = def.type === 'lord';

    this.model = buildGuard(def.type);
    game.scene.add(this.model.group);

    this.marker = makeMarker();
    this.marker.position.y = 2.55;
    this.model.group.add(this.marker);

    const half = THREE.MathUtils.degToRad(this.cfg.fov);
    const coneGeo = new THREE.CircleGeometry(1, 24, -Math.PI / 2 - half, half * 2);
    coneGeo.rotateX(-Math.PI / 2);
    this.cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xffee88, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.cone.scale.setScalar(this.cfg.sight * 0.65); // typical range in the dark
    this.cone.position.y = 0.06;
    this.cone.renderOrder = 2;
    this.cone.visible = false;
    this.model.group.add(this.cone);

    this.syncModel(0);
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.1, this.pos.z); }
  get eye() { return new THREE.Vector3(this.pos.x, this.pos.y + 1.7, this.pos.z); }
  get forward() { return new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing)); }
  get alerted() { return this.state === 'alert'; }

  // ---------------- Perception ----------------

  /** 0 = can't see it, otherwise how strongly per second the target registers. */
  sightOf(t) {
    if (!t.alive) return 0;
    const g = this.game;
    const eye = this.eye;
    const tc = new THREE.Vector3(t.pos.x, t.pos.y + t.height * 0.6, t.pos.z);
    const d = eye.distanceTo(tc);
    const light = g.world.lightAt(tc);
    let range = this.cfg.sight * Math.min(1.25, 0.45 + light * 0.6);
    if (this.state === 'alert') range *= 1.4;
    if (d > range) return 0;

    const to = tc.clone().sub(eye);
    to.y = 0;
    const flat = to.length();
    const cos = flat > 0.01 ? to.divideScalar(flat).dot(this.forward) : 1;
    const inCone = cos >= Math.cos(THREE.MathUtils.degToRad(this.cfg.fov));
    const close = d < 3.2;
    if (!inCone && !close) return 0;
    if (!lineOfSight(g.world.colliders, eye, tc)) return 0;
    if (g.smokeBlocks(eye, tc)) return 0;

    let f = Math.pow(1 - d / range, 0.6) * (0.55 + light * 0.45) * t.visibility;
    if (!inCone) f *= t.crouching ? 0.12 : 0.35; // sensed nearby
    if (this.state === 'alert') f *= 3;
    return f;
  }

  perceive(dt) {
    let best = null, bestF = 0;
    for (const t of this.game.targets()) {
      const f = this.sightOf(t);
      // Clones are flashy: guards prefer chasing them when visible.
      const w = t.isDecoy ? f * 1.5 : f;
      if (w > bestF) { bestF = w; best = t; }
    }
    if (best) {
      this.awareness = Math.min(ALERT_AT, this.awareness + 150 * bestF * dt);
      this.lastKnown = best.pos.clone();
      this.target = best;
      this.lostT = 0;
    } else {
      this.target = null;
      this.lostT += dt;
    }
    return best;
  }

  /** Noise heard at a position (footsteps, combat, explosions). */
  hear(pos, radius) {
    if (this.dead || this.boundT > 0 || this.state === 'alert') return;
    const d = this.pos.distanceTo(pos);
    if (d > radius) return;
    const amount = 35 + (1 - d / radius) * 45;
    if (amount > this.awareness) this.awareness = amount;
    this.lastKnown = pos.clone();
    if (this.state === 'patrol' || this.state === 'return') this.becomeSuspicious();
    else if (this.state === 'search') { this.searchPoint = pos.clone(); this.searchT = Math.max(this.searchT, 8); }
  }

  checkBodies() {
    for (const other of this.game.guards) {
      if (!other.dead || other.bodyFound || other.deadT < 1) continue;
      const d = this.pos.distanceTo(other.pos);
      if (d > 18) continue;
      const to = other.pos.clone().sub(this.pos).setY(0).normalize();
      if (to.dot(this.forward) < 0.4) continue;
      if (!lineOfSight(this.game.world.colliders, this.eye, other.center.setY(other.pos.y + 0.4))) continue;
      other.bodyFound = true;
      this.awareness = Math.max(this.awareness, 75);
      this.lastKnown = other.pos.clone();
      this.startSearch(other.pos, 14);
      this.game.onBodyFound(this);
      return;
    }
  }

  // ---------------- State changes ----------------

  becomeSuspicious() {
    if (this.state !== 'suspicious') sfx('suspicious');
    this.state = 'suspicious';
    this.suspiciousT = 0;
  }

  becomeAlert(fromShout = false) {
    if (this.dead) return;
    const was = this.state;
    this.state = 'alert';
    this.awareness = ALERT_AT;
    this.lostT = 0;
    if (was !== 'alert') this.game.onGuardAlert(this, fromShout);
  }

  startSearch(point, time = 10) {
    this.state = 'search';
    this.searchPoint = point.clone();
    this.searchT = time;
    this.wanderPoint = null;
  }

  loseTarget(decoyPos) {
    if (this.dead) return;
    if (this.state === 'alert' || this.target) {
      this.target = null;
      this.awareness = Math.min(this.awareness, 70);
      this.startSearch(decoyPos, 9);
    }
  }

  bind(seconds) {
    this.boundT = seconds;
    this.attackT = -1;
    this.aimT = 0;
  }

  takeDamage(amount, fromPos, { knock = 3 } = {}) {
    if (this.dead) return;
    this.hp -= amount;
    this.flashT = 0.15;
    if (fromPos) {
      const k = this.pos.clone().sub(fromPos).setY(0);
      if (k.lengthSq() > 1e-4) k.normalize().multiplyScalar(knock);
      this.vel.x += k.x; this.vel.z += k.z;
      if (knock > 8) this.vel.y = 5;
    }
    if (this.hp <= 0) { this.die(false); return; }
    this.attackT = -1;
    this.stunT = 0.35;
    this.lastKnown = this.game.player.pos.clone();
    if (this.boundT <= 0) {
      this.becomeAlert();
      // Face the attacker.
      if (fromPos) this.facing = Math.atan2(fromPos.x - this.pos.x, fromPos.z - this.pos.z);
    }
  }

  die(stealth) {
    if (this.dead) return;
    this.dead = true;
    this.deadT = 0;
    this.boundT = 0;
    this.marker.visible = false;
    this.cone.visible = false;
    this.game.onGuardKilled(this, stealth);
  }

  // ---------------- Update ----------------

  update(dt) {
    if (this.dead) {
      this.deadT += dt;
      this.applyPhysics(dt, 0, 0, 0);
      this.syncModel(dt);
      return;
    }
    if (this.flashT > 0) this.flashT -= dt;

    if (this.boundT > 0) {
      this.boundT -= dt;
      if (this.boundT <= 0) {
        this.awareness = 80;
        this.lastKnown = this.game.player.pos.clone();
        this.startSearch(this.lastKnown, 8);
      }
      this.syncModel(dt);
      return;
    }

    this.attackCd -= dt;
    this.shootCd -= dt;
    if (this.stunT > 0) {
      this.stunT -= dt;
      this.applyPhysics(dt, 0, 0, 0);
      this.syncModel(dt);
      return;
    }

    const seen = this.perceive(dt);
    if (this.state !== 'alert') this.checkBodies();

    let moveX = 0, moveZ = 0, moveSpeed = 0;
    const goTo = (p, speed) => {
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.4) return true;
      let dirX = dx / d, dirZ = dz / d;
      if (this.detourT > 0 && this.detourDir) { dirX = this.detourDir.x; dirZ = this.detourDir.z; }
      this.facing = turnToward(this.facing, Math.atan2(dirX, dirZ), dt * 7);
      moveX = dirX; moveZ = dirZ; moveSpeed = speed;
      return false;
    };
    const lookAt = (p, rate = 5) => {
      this.facing = turnToward(this.facing, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), dt * rate);
    };

    switch (this.state) {
      case 'patrol':
      case 'return': {
        if (this.awareness >= SUSPICIOUS_AT) { this.becomeSuspicious(); break; }
        this.awareness = Math.max(0, this.awareness - 6 * dt);
        if (this.stationary || this.path.length === 1) {
          const home = this.path[0];
          if (!this.stationary && this.pos.distanceTo(home) > 0.6) { goTo(home, this.cfg.walk); break; }
          // Idle: glance left and right.
          this.lookT += dt;
          const sweep = this.stationary ? 0.9 : 0.6;
          this.facing = turnToward(this.facing, this.homeFacing + Math.sin(this.lookT * 0.5) * sweep, dt * 2);
          if (this.state === 'return') this.state = 'patrol';
          break;
        }
        if (this.waitT > 0) {
          this.waitT -= dt;
          this.lookT += dt;
          this.facing += Math.sin(this.lookT * 1.6) * dt * 0.9;
          break;
        }
        if (goTo(this.path[this.wp], this.cfg.walk)) {
          this.wp = (this.wp + 1) % this.path.length;
          this.waitT = 1.2 + Math.random() * 1.5;
          if (this.state === 'return') this.state = 'patrol';
        }
        break;
      }

      case 'suspicious': {
        this.suspiciousT += dt;
        if (this.awareness >= ALERT_AT) { this.becomeAlert(); break; }
        if (!seen) this.awareness = Math.max(0, this.awareness - 9 * dt);
        if (this.awareness < 8) { this.state = 'return'; break; }
        if (!this.lastKnown) break;
        if (this.suspiciousT < 1.0 || seen) {
          lookAt(this.lastKnown, 4);
          if (seen && this.suspiciousT > 1.6 && !this.stationary) goTo(this.lastKnown, this.cfg.walk * 0.8);
        } else if (!this.stationary) {
          if (goTo(this.lastKnown, this.cfg.walk * 1.4)) this.startSearch(this.lastKnown, 6);
        } else {
          lookAt(this.lastKnown, 2);
        }
        break;
      }

      case 'search': {
        this.searchT -= dt;
        if (this.awareness >= ALERT_AT) { this.becomeAlert(); break; }
        if (!seen) this.awareness = Math.max(0, this.awareness - 4 * dt);
        if (seen && this.awareness >= SUSPICIOUS_AT) lookAt(this.lastKnown, 5);
        if (this.searchT <= 0) {
          this.state = 'return';
          this.awareness = 0;
          this.game.message('"Must have been the wind..."', 'muted');
          break;
        }
        if (this.stationary) { this.facing += dt * 1.2; break; }
        if (!this.wanderPoint) {
          this.wanderPoint = this.searchPoint.clone();
          this.wanderT = 0;
        }
        if (goTo(this.wanderPoint, this.cfg.walk * 1.5)) {
          this.wanderT += dt;
          this.facing += dt * 2;
          if (this.wanderT > 1.2) {
            const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 6;
            this.wanderPoint = this.searchPoint.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
            this.wanderT = 0;
          }
        }
        break;
      }

      case 'alert': {
        if (seen) this.awareness = ALERT_AT;
        if (this.lostT > 4) {
          this.awareness = 80;
          this.startSearch(this.lastKnown || this.pos, 12);
          this.game.message('Guards lost your trail. They are searching...');
          break;
        }
        const t = this.target || (this.lastKnown ? { pos: this.lastKnown, alive: true, ghost: true } : null);
        if (!t) break;
        const to = t.pos.clone().sub(this.pos);
        const dy = to.y;
        to.y = 0;
        const hd = to.length();

        if (this.cfg.coward) {
          // The lord flees from danger, calling for help.
          if (hd < this.cfg.reach && !t.ghost && Math.abs(dy) < 1.6) {
            this.meleeAttack(t, dt, lookAt);
          } else if (hd < 18) {
            const away = this.pos.clone().sub(t.pos).setY(0).normalize().multiplyScalar(6).add(this.pos);
            goTo(away, this.cfg.run);
          }
          break;
        }

        if (this.cfg.ranged) {
          if (!t.ghost && seen) {
            this.rangedAttack(t, dt, lookAt);
            if (hd < 5 && !this.stationary) {
              const away = this.pos.clone().sub(t.pos).setY(0).normalize().multiplyScalar(3).add(this.pos);
              goTo(away, this.cfg.walk);
            }
          } else if (!this.stationary) {
            goTo(t.pos, this.cfg.run);
          } else {
            lookAt(t.pos, 3);
          }
          break;
        }

        // Melee guards
        if (!t.ghost && hd < this.cfg.reach && Math.abs(dy) < 1.6) {
          this.meleeAttack(t, dt, lookAt);
        } else if (this.attackT >= 0) {
          this.meleeAttack(t, dt, lookAt);
        } else if (!t.ghost && seen && Math.abs(dy) > 2.2 && hd < 22) {
          // Target is up on a roof: hurl shuriken.
          this.rangedAttack(t, dt, lookAt, true);
          if (hd > 6) goTo(t.pos, this.cfg.walk);
        } else {
          if (goTo(t.pos, this.cfg.run) && t.ghost) this.lostT = Math.max(this.lostT, 3.5);
        }
        break;
      }
    }

    // Stuck detection: if we can't make progress, sidestep for a moment.
    if (this.detourT > 0) this.detourT -= dt;
    this.applyPhysics(dt, moveX, moveZ, moveSpeed);
    this.syncModel(dt);
  }

  meleeAttack(t, dt, lookAt) {
    lookAt(t.pos, 10);
    if (this.attackT < 0) {
      if (this.attackCd <= 0) { this.attackT = 0; this.didHit = false; }
      return;
    }
    this.attackT += dt / 0.85;
    if (!this.didHit && this.attackT >= 0.7) {
      this.didHit = true;
      sfx('swing');
      const tgt = this.target;
      if (tgt && tgt.alive) {
        const d = tgt.pos.clone().sub(this.pos);
        const dy = d.y;
        d.y = 0;
        if (d.length() < this.cfg.reach + 0.6 && Math.abs(dy) < 1.8 && d.normalize().dot(this.forward) > 0.3) {
          tgt.takeDamage(this.cfg.damage, this.pos);
          sfx('clank');
        }
      }
    }
    if (this.attackT >= 1) { this.attackT = -1; this.attackCd = 0.9 + Math.random() * 0.6; }
  }

  rangedAttack(t, dt, lookAt, thrown = false) {
    lookAt(t.pos, 8);
    if (this.shootCd > 0) { this.aimT = 0; return; }
    this.aimT += dt;
    if (this.aimT < (thrown ? 0.35 : 0.6)) return;
    this.aimT = 0;
    this.shootCd = thrown ? 2.2 + Math.random() : 1.8 + Math.random() * 0.6;
    const from = this.eye.addScaledVector(this.forward, 0.6);
    const aim = new THREE.Vector3(t.pos.x, t.pos.y + 1.1, t.pos.z);
    // Lead the target a little, imperfectly.
    if (t.vel) aim.addScaledVector(t.vel, from.distanceTo(aim) / 40 * Math.random());
    aim.x += (Math.random() - 0.5) * 1.2;
    aim.z += (Math.random() - 0.5) * 1.2;
    const speed = thrown ? 30 : 42;
    const dir = aim.sub(from).normalize();
    this.game.spawnProjectile({
      type: thrown ? 'shuriken' : 'arrow', owner: 'enemy', pos: from, vel: dir.multiplyScalar(speed),
      damage: thrown ? 8 : this.cfg.damage, gravity: thrown ? 2 : 1.5,
    });
    sfx(thrown ? 'throw' : 'arrow');
  }

  applyPhysics(dt, mx, mz, speed) {
    const before = this.pos.clone();
    // Knockback decays; intended movement on top.
    const damp = Math.exp(-dt * 6);
    this.vel.x *= damp; this.vel.z *= damp;
    this.vel.y -= 30 * dt;
    const delta = new THREE.Vector3((this.vel.x + mx * speed) * dt, this.vel.y * dt, (this.vel.z + mz * speed) * dt);
    const res = moveAndCollide(this.pos, this.half, this.height, delta, this.game.world.colliders);
    if (res.onGround) this.vel.y = 0;
    this.speedNow = Math.hypot(this.pos.x - before.x, this.pos.z - before.z) / Math.max(dt, 1e-4);

    if (speed > 0 && this.detourT <= 0) {
      if (this.speedNow < speed * 0.3) this.stuckT += dt;
      else this.stuckT = Math.max(0, this.stuckT - dt);
      if (this.stuckT > 0.5) {
        this.stuckT = 0;
        this.detourT = 0.9;
        const side = Math.random() < 0.5 ? 1 : -1;
        this.detourDir = new THREE.Vector3(mx, 0, mz).applyAxisAngle(UP, side * Math.PI / 2);
      }
    }
  }

  syncModel(dt) {
    const g = this.model.group;
    g.position.copy(this.pos);
    g.rotation.y = this.facing;
    animateGuard(this.model, {
      speed: this.speedNow,
      attackT: this.attackT,
      aiming: this.aimT > 0,
      dead: this.dead,
      deadT: this.deadT,
      bound: this.boundT > 0,
      alert: this.state === 'alert',
    }, dt);

    // Hit flash
    const flash = this.flashT > 0 ? 0.8 : 0;
    for (const m of this.model.materials) m.emissive.setRGB(flash, flash * 0.1, flash * 0.1);

    if (this.dead) return;
    const m = this.marker.userData;
    if (this.executing) m.set('', '');
    else if (this.boundT > 0) m.set('◉', '#b48cff');
    else if (this.state === 'alert') m.set('!', '#ff3b2b');
    else if (this.state === 'suspicious' || this.state === 'search') m.set('?', '#ffd23a');
    else if (this.game.senseTime > 0) m.set(this.isLord ? '★' : '▼', this.isLord ? '#ffcc33' : '#ffffff');
    else m.set('', '');

    this.cone.visible = this.game.senseTime > 0;
    if (this.cone.visible) {
      const c = this.state === 'alert' ? 0xff3b2b : this.state === 'patrol' || this.state === 'return' ? 0xffee88 : 0xffa53a;
      this.cone.material.color.setHex(c);
    }
  }
}
