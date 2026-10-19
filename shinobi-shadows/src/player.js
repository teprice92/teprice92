import * as THREE from 'three';
import { createNinjaModel, animateNinja } from './models.js';
import { moveAndCollide, groundBelow, raycast } from './physics.js';
import { JUTSU } from './jutsu.js';
import { sfx, footstep } from './audio.js';

const GRAVITY = 30;
const JUMP_V = 11;
const AIR_JUMP_V = 10.5;
const RUN = 10;
const SPRINT = 17;
const CROUCH = 4.5;
const CLIMB_V = 9.5;
const GRAPPLE_SPEED = 36;
const GRAPPLE_RANGE = 45;

export class Player {
  constructor(game, character) {
    this.game = game;
    this.char = character;
    this.stats = character.stats;
    this.traits = character.traits || {};

    const m = createNinjaModel(character);
    this.model = m;
    game.scene.add(m.group);

    this.pos = game.world.spawn.pos.clone();
    this.vel = new THREE.Vector3();
    this.facing = game.world.spawn.yaw;
    this.half = 0.3;
    this.standHeight = 1.75;
    this.height = this.standHeight;

    this.maxHp = this.stats.hp;
    this.hp = this.maxHp;
    this.maxChakra = this.stats.chakra;
    this.chakra = this.maxChakra;

    this.alive = true;
    this.isPlayer = true;
    this.grounded = false;
    this.airJumps = 1;
    this.crouching = false;
    this.sprinting = false;
    this.climbing = false;
    this.wallNormal = null;
    this.grapple = null;
    this.dash = null;
    this.casting = 0;
    this.locked = 0; // movement lock (stealth kills)
    this.invuln = 0;
    this.attackT = -1;
    this.attackHitDone = false;
    this.combo = 0;
    this.comboTimer = 0;
    this.heal = null;
    this.items = { kunai: 10, smoke: 3, pill: 2 };
    this.cooldowns = character.jutsu.map(() => 0);
    this.stepTimer = 0;
    this.fallStartY = this.pos.y;

    const ropeGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: 0xd9c9a3 }));
    this.rope.visible = false;
    this.rope.frustumCulled = false;
    game.scene.add(this.rope);
  }

  get center() { return new THREE.Vector3(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z); }

  get handPos() {
    const f = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const r = new THREE.Vector3(-Math.cos(this.facing), 0, Math.sin(this.facing));
    return this.center.addScaledVector(f, 0.5).addScaledVector(r, -0.3).add(new THREE.Vector3(0, 0.2, 0));
  }

  /** How easy the player is to spot right now (multiplied into guard awareness gain). */
  get visibility() {
    let v = 0.85;
    if (this.crouching) v = 0.42;
    else if (this.sprinting && this.grounded) v = 1.2;
    if (this.climbing || this.grapple) v = 1.1;
    return v * (this.traits.detection || 1);
  }

  update(dt, input, cam) {
    const g = this.game;
    this.invuln = Math.max(0, this.invuln - dt);
    this.casting = Math.max(0, this.casting - dt);
    this.locked = Math.max(0, this.locked - dt);
    this.cooldowns = this.cooldowns.map((c) => Math.max(0, c - dt));
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) this.combo = 0;

    // Chakra regenerates faster when standing still or crouching.
    const regen = (this.crouching || this.vel.lengthSq() < 1 ? 9 : 5) * (this.traits.chakraRegen || 1);
    if (!this.climbing) this.chakra = Math.min(this.maxChakra, this.chakra + regen * dt);

    if (this.heal) {
      const h = Math.min(this.heal.rate * dt, this.heal.left);
      this.hp = Math.min(this.maxHp, this.hp + h);
      this.heal.left -= h;
      if (Math.random() < 0.6) g.effects.burst(this.center, { count: 1, color: 0x6bff9a, speed: 1, life: 0.8, size: 0.25, up: 1.5 });
      if (this.heal.left <= 0) this.heal = null;
    }

    if (input.hit('KeyC')) this.crouching = !this.crouching;
    const wantCrouch = this.crouching || input.down('ControlLeft');

    // ----- Actions -----
    if (this.locked <= 0 && !this.dash) {
      if (input.mouseHit(0)) this.attack(cam);
      if (input.mouseHit(2) || input.hit('KeyF')) this.fireGrapple(cam);
      if (input.hit('KeyQ')) this.throwKunai(cam);
      if (input.hit('KeyG')) this.useSmoke();
      if (input.hit('KeyH')) this.usePill();
      ['Digit1', 'Digit2', 'Digit3'].forEach((code, i) => { if (input.hit(code)) this.castJutsu(i, cam); });
    }
    if (this.grapple && (input.hit('Space'))) this.endGrapple(true);

    // ----- Movement intent -----
    const f = cam.forward, r = cam.right;
    const wish = new THREE.Vector3();
    if (this.locked <= 0) {
      if (input.down('KeyW')) wish.add(f);
      if (input.down('KeyS')) wish.sub(f);
      if (input.down('KeyD')) wish.add(r);
      if (input.down('KeyA')) wish.sub(r);
    }
    const hasInput = wish.lengthSq() > 0;
    if (hasInput) wish.normalize();

    this.sprinting = input.down('ShiftLeft') || input.down('ShiftRight');
    if (this.sprinting && hasInput) this.crouching = false;
    const crouchNow = wantCrouch && !this.sprinting && this.grounded;
    this.height = crouchNow ? 1.15 : this.standHeight;

    const spd = this.stats.speed;
    let speed = RUN * spd;
    if (crouchNow) speed = CROUCH * spd;
    else if (this.sprinting) speed = SPRINT * spd * (this.traits.sprintBonus || 1);

    // ----- Special movement states -----
    if (this.dash) {
      this.updateDash(dt);
    } else if (this.grapple) {
      this.updateGrapple(dt);
    } else {
      // Wall run: sprint into a wall to run straight up it using chakra.
      const intoWall = this.wallNormal && hasInput && (wish.x * this.wallNormal.x + wish.z * this.wallNormal.z) < -0.5;
      if (this.sprinting && intoWall && this.chakra > 1) {
        if (!this.climbing) { this.climbing = true; sfx('jump'); }
        this.vel.y = CLIMB_V;
        this.chakra -= 11 * dt;
        this.vel.x = wish.x * 4;
        this.vel.z = wish.z * 4;
        if (Math.random() < 0.5) g.effects.trail(this.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), 0x5fd1ff, 0.3, 0.4);
      } else {
        if (this.climbing) {
          this.climbing = false;
          // Vault over the lip when we run out of wall.
          if (!this.wallNormal) { this.vel.y = Math.max(this.vel.y, 6); this.vel.x = wish.x * 6; this.vel.z = wish.z * 6; }
        }
        // Snappy on the ground, some air control; no input in the air keeps momentum.
        if (this.grounded || hasInput) {
          const k = 1 - Math.exp(-(this.grounded ? 14 : 4) * dt);
          this.vel.x += (wish.x * speed - this.vel.x) * k;
          this.vel.z += (wish.z * speed - this.vel.z) * k;
        }
        this.vel.y -= GRAVITY * dt;
        if (this.vel.y < -45) this.vel.y = -45;
      }

      // Jumping
      if (input.hit('Space') && this.locked <= 0) {
        if (this.grounded) {
          this.vel.y = JUMP_V;
          this.grounded = false;
          sfx('jump');
        } else if (this.airJumps > 0 && this.chakra >= 6) {
          this.airJumps--;
          this.chakra -= 6;
          this.vel.y = AIR_JUMP_V;
          if (hasInput) { this.vel.x = wish.x * speed; this.vel.z = wish.z * speed; }
          g.effects.burst(this.pos, { count: 14, color: 0x7fd8ff, speed: 3, life: 0.4, size: 0.3 });
          sfx('jump');
        }
      }
    }

    // ----- Integrate -----
    const wasGrounded = this.grounded;
    const res = moveAndCollide(this.pos, this.half, this.height, this.vel.clone().multiplyScalar(dt), g.world.colliders);
    if (res.onGround) {
      if (this.vel.y < -18) { g.makeNoise(this.pos, 6); sfx('land'); g.effects.burst(this.pos, { count: 10, color: 0x9a8f7a, speed: 3, life: 0.5, size: 0.35, smoke: true, alpha: 0.5 }); }
      if (!wasGrounded) footstep(this.surface(), this.vel.y < -12 ? 1.5 : 0.8);
      this.vel.y = 0;
    }
    if (res.hitCeiling && this.vel.y > 0) this.vel.y = 0;
    this.grounded = res.onGround || (this.vel.y <= 0 && !!groundBelow(this.pos, this.half, g.world.colliders));
    if (this.grounded) { this.airJumps = 1; if (!wasGrounded) this.fallStartY = this.pos.y; }
    this.wallNormal = res.hitWall ? res.wallNormal : null;
    if (this.grapple && res.hitWall && !this.grounded) this.grapple.blocked += dt;

    // ----- Footsteps: sound for you, noise for the guards -----
    const hspeed = Math.hypot(this.vel.x, this.vel.z);
    if (this.grounded && hspeed > 1) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = crouchNow ? 0.45 : this.sprinting ? 0.21 : 0.29;
        if (this.sprinting) g.makeNoise(this.pos, 8);
        else if (!crouchNow) g.makeNoise(this.pos, 3);
        footstep(this.surface(), crouchNow ? 0.25 : this.sprinting ? 1 : 0.6);
      }
    }

    // ----- Facing -----
    if (this.attackT >= 0 || this.casting > 0 || this.grapple) {
      this.facing = turnToward(this.facing, cam.yaw, dt * 20);
    } else if (this.dash) {
      this.facing = Math.atan2(this.dash.dir.x, this.dash.dir.z);
    } else if (hspeed > 0.5 && !this.climbing) {
      this.facing = turnToward(this.facing, Math.atan2(this.vel.x, this.vel.z), dt * 14);
    } else if (this.climbing && this.wallNormal) {
      this.facing = Math.atan2(-this.wallNormal.x, -this.wallNormal.z);
    }

    // ----- Attack timing -----
    if (this.attackT >= 0) {
      this.attackT += dt / 0.34;
      if (!this.attackHitDone && this.attackT > 0.45) { this.attackHitDone = true; this.resolveMeleeHit(); }
      if (this.attackT >= 1) this.attackT = -1;
    }

    // ----- Model -----
    this.crouching = this.crouching && !this.sprinting;
    const mg = this.model.group;
    mg.position.copy(this.pos);
    mg.rotation.y = this.facing;
    mg.visible = !(this.invuln > 0 && this.invulnBlink && Math.floor(performance.now() / 60) % 2 === 0);
    animateNinja(this.model, {
      speed: this.dash ? 20 : hspeed,
      grounded: this.grounded && !this.dash,
      sprinting: (this.sprinting && hspeed > RUN * 0.9) || !!this.dash,
      crouching: crouchNow,
      climbing: this.climbing,
      vy: this.vel.y,
      attackT: this.attackT,
      casting: this.casting > 0 || !!this.grapple,
    }, dt);

    if (this.grapple) {
      const posAttr = this.rope.geometry.attributes.position;
      const h = this.handPos;
      posAttr.setXYZ(0, h.x, h.y, h.z);
      posAttr.setXYZ(1, this.grapple.point.x, this.grapple.point.y, this.grapple.point.z);
      posAttr.needsUpdate = true;
    }
    this.rope.visible = !!this.grapple;

    // Fell out of the world? Put them back at the start.
    if (this.pos.y < -20) { this.pos.copy(g.world.spawn.pos); this.vel.set(0, 0, 0); }
  }

  /** Ground material under the player (for footstep sounds). */
  surface() {
    return this.game.world.surfaceAt(this.pos, groundBelow(this.pos, this.half, this.game.world.colliders, 0.15));
  }

  // ---------------- Combat ----------------

  attack(cam) {
    const g = this.game;
    const target = g.stealthKillTarget();
    if (target) { g.performStealthKill(target); return; }
    if (this.attackT >= 0) return;
    this.facing = cam.yaw;
    this.attackT = 0;
    this.attackHitDone = false;
    this.combo = (this.combo % 3) + 1;
    this.comboTimer = 0.8;
    sfx('swing');
  }

  resolveMeleeHit() {
    const g = this.game;
    const f = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const finisher = this.combo === 3;
    const dmg = (finisher ? 45 : 28) * this.stats.power;
    let hitAny = false;
    for (const guard of g.guards) {
      if (guard.dead) continue;
      const to = guard.pos.clone().sub(this.pos);
      const dy = to.y;
      to.y = 0;
      const d = to.length();
      if (d > 2.7 || Math.abs(dy) > 1.8) continue;
      if (d > 0.5 && to.normalize().dot(f) < 0.3) continue;
      guard.takeDamage(dmg, this.pos, { knock: finisher ? 9 : 3 });
      g.effects.burst(guard.center, { count: 14, color: 0xb3121b, speed: 4, life: 0.5, size: 0.18, gravity: 12 });
      hitAny = true;
    }
    if (hitAny) { sfx('hit'); g.cam.shake(finisher ? 0.25 : 0.1); g.makeNoise(this.pos, 10); }
  }

  takeDamage(amount, fromPos) {
    if (!this.alive || this.invuln > 0 || this.dash?.invuln) return;
    const dmg = amount * (this.traits.damageTaken || 1);
    this.hp -= dmg;
    this.game.stats.damageTaken += dmg;
    this.invuln = 0.4;
    this.invulnBlink = false;
    if (fromPos) {
      const k = this.pos.clone().sub(fromPos).setY(0).normalize().multiplyScalar(6);
      this.vel.x += k.x; this.vel.z += k.z;
    }
    sfx('hurt');
    this.game.hud.hurt();
    this.game.cam.shake(0.3);
    this.game.effects.burst(this.center, { count: 10, color: 0xb3121b, speed: 3, life: 0.5, size: 0.2, gravity: 10 });
    if (this.endGrapple) this.endGrapple(false);
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.game.onPlayerDeath();
    }
  }

  throwKunai(cam) {
    if (this.items.kunai <= 0) { this.game.message('Out of kunai'); return; }
    this.items.kunai--;
    const aim = this.game.aimPoint(60);
    const from = this.handPos;
    const dir = aim.sub(from).normalize();
    this.facing = cam.yaw;
    this.game.spawnProjectile({ type: 'kunai', owner: 'player', pos: from, vel: dir.multiplyScalar(48), damage: 40 * this.stats.power, gravity: 3 });
    sfx('throw');
  }

  useSmoke() {
    if (this.items.smoke <= 0) { this.game.message('Out of smoke bombs'); return; }
    this.items.smoke--;
    this.game.spawnSmoke(this.center, 5.5, 7);
  }

  usePill() {
    if (this.items.pill <= 0) { this.game.message('Out of soldier pills'); return; }
    this.items.pill--;
    this.hp = Math.min(this.maxHp, this.hp + 40);
    this.chakra = Math.min(this.maxChakra, this.chakra + 70);
    this.game.effects.burst(this.center, { count: 24, color: 0x7fd8ff, speed: 3, life: 0.7, size: 0.3, up: 1 });
    sfx('heal');
    this.game.message('Soldier pill: strength restored');
  }

  castJutsu(i, cam) {
    const id = this.char.jutsu[i];
    const j = JUTSU[id];
    if (!j) return;
    if (this.cooldowns[i] > 0) return;
    if (this.chakra < j.cost) { this.game.message(`Not enough chakra for ${j.name}`); return; }
    if (j.cast(this.game, this, cam) === false) return;
    this.chakra -= j.cost;
    this.cooldowns[i] = j.cooldown;
    this.game.hud.jutsuFlash(i);
  }

  // ---------------- Dash ----------------

  /** opts: { dir, speed, time, invuln, color, onHit(guard)->bool(end), onEnd(hitSomething) } */
  startDash(opts) {
    this.endGrapple(false);
    this.dash = { hit: new Set(), elapsed: 0, ...opts, dir: opts.dir.clone().normalize() };
    this.climbing = false;
  }

  updateDash(dt) {
    const d = this.dash;
    d.elapsed += dt;
    this.vel.copy(d.dir).multiplyScalar(d.speed);
    if (d.color && Math.random() < 0.9) this.game.effects.trail(this.center, d.color, 0.45, 0.35);
    if (d.onTick) d.onTick(dt);
    const c = this.center;
    for (const guard of this.game.guards) {
      if (guard.dead || d.hit.has(guard)) continue;
      if (guard.center.distanceTo(c) < 1.7) {
        d.hit.add(guard);
        if (d.onHit && d.onHit(guard)) { this.finishDash(true); return; }
      }
    }
    if (d.elapsed >= d.time) this.finishDash(d.hit.size > 0);
  }

  finishDash(hit) {
    const d = this.dash;
    if (!d) return;
    this.dash = null;
    this.vel.multiplyScalar(0.25);
    if (d.onEnd) d.onEnd(hit);
  }

  // ---------------- Grappling hook ----------------

  fireGrapple() {
    const g = this.game;
    if (this.grapple) { this.endGrapple(true); return; }
    const { origin, dir } = g.cam.aimRay();
    const hit = raycast(g.world.colliders, origin, dir, GRAPPLE_RANGE);
    if (!hit || hit.box.tag === 'ground') { g.message('Nothing to hook onto'); return; }
    const p = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    if (hit.n.y > 0.5) {
      p.y += 0.4;
    } else if (hit.n.y === 0 && hit.box.max.y - hit.point.y < 5) {
      // Hooked a wall near its top: aim just over the lip so we land on it.
      p.x -= hit.n.x * 0.8;
      p.z -= hit.n.z * 0.8;
      p.y = hit.box.max.y + 0.5;
    } else {
      p.x += hit.n.x * 0.5; p.y += hit.n.y * 0.5; p.z += hit.n.z * 0.5;
    }
    this.grapple = { point: p, time: 0, blocked: 0 };
    this.climbing = false;
    this.crouching = false;
    sfx('grapple');
  }

  updateGrapple(dt) {
    const gr = this.grapple;
    gr.time += dt;
    const c = new THREE.Vector3(this.pos.x, this.pos.y + 0.3, this.pos.z);
    const to = gr.point.clone().sub(c);
    const dist = to.length();
    if (dist < 0.9 || gr.time > 2.5 || gr.blocked > 1) { this.endGrapple(true); return; }
    to.normalize();
    if (this.wallNormal && gr.point.y > c.y) {
      // Pressed against a wall below the hook point: scramble straight up it.
      this.vel.set(to.x * 8, GRAPPLE_SPEED * 0.65, to.z * 8);
    } else {
      this.vel.copy(to).multiplyScalar(GRAPPLE_SPEED);
    }
  }

  endGrapple(pop) {
    if (!this.grapple) return;
    this.grapple = null;
    if (pop) {
      this.vel.y = Math.max(this.vel.y * 0.3, 7);
      this.vel.x *= 0.35; this.vel.z *= 0.35;
    }
  }
}

export function turnToward(cur, target, maxStep) {
  let d = target - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}
