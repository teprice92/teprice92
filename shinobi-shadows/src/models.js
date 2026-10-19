import * as THREE from 'three';
import { tex } from './textures.js';

// Characters built from primitives with procedural animation.
// Every model faces +Z and has its origin at the feet.

const geoCache = new Map();
function cached(key, make) {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
}
const boxGeo = (w, h, d) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const capGeo = (r, len) => cached(`c${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphGeo = (r) => cached(`s${r}`, () => new THREE.SphereGeometry(r, 16, 12));
const cylGeo = (rt, rb, h, seg = 12, open = false) => cached(`y${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...extra });
}

function clothMat(color, repeat = 3, extra = {}) {
  const map = tex('cloth').clone();
  map.repeat.set(repeat, repeat);
  map.needsUpdate = true;
  return mat(color, { map, ...extra });
}

function part(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A limb pivot with an upper segment and a bending lower segment. */
function limb(upper, lower, upperLen, materialUpper, materialLower, extras = () => {}) {
  const pivot = new THREE.Group();
  pivot.add(part(capGeo(upper, upperLen), materialUpper, 0, -(upperLen / 2 + upper * 0.5)));
  const joint = new THREE.Group();
  joint.position.y = -(upperLen + upper * 1.2);
  pivot.add(joint);
  joint.add(part(capGeo(lower, upperLen * 0.95), materialLower, 0, -(upperLen * 0.47 + lower * 0.5)));
  extras(pivot, joint);
  return { pivot, joint };
}

// ---------------- Shinobi ----------------

export function buildNinja(colors, look = {}) {
  const suit = clothMat(colors.suit);
  const trim = clothMat(colors.trim);
  const skin = mat(colors.skin, { roughness: 0.7 });
  const hair = mat(colors.hair, { roughness: 0.6 });
  const scarfMat = clothMat(colors.scarf, 2, { side: THREE.DoubleSide });
  const metal = mat(0xc9d2dc, { metalness: 0.85, roughness: 0.28 });
  const bandage = clothMat(0xd8d0bc, 6);
  const sandal = mat(0x1c1c22);
  const plateMat = mat(0xffffff, { map: tex('emblem'), metalness: 0.8, roughness: 0.3 });

  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);
  hips.add(part(capGeo(0.13, 0.12), trim, 0, -0.02).rotateZ(Math.PI / 2));

  const leg = (side) => {
    const l = limb(0.085, 0.072, 0.32, trim, trim, (pivot, knee) => {
      knee.add(part(cylGeo(0.082, 0.082, 0.2), bandage, 0, -0.22));
      knee.add(part(boxGeo(0.12, 0.07, 0.26), sandal, 0, -0.43, 0.05));
    });
    l.pivot.position.x = side * 0.11;
    hips.add(l.pivot);
    return l;
  };
  const legL = leg(-1), legR = leg(1);

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = part(cylGeo(0.21, 0.155, 0.56), suit, 0, 0.3);
  chest.scale.z = 0.72;
  torso.add(chest);
  if (look.vest) {
    const vest = part(cylGeo(0.225, 0.19, 0.38), trim, 0, 0.36);
    vest.scale.z = 0.78;
    torso.add(vest);
  }
  torso.add(part(cylGeo(0.175, 0.175, 0.07), trim, 0, 0.04));
  torso.add(part(boxGeo(0.16, 0.12, 0.08), trim, 0.1, 0.06, -0.14)); // tool pouch
  torso.add(part(cylGeo(0.06, 0.07, 0.1), skin, 0, 0.62));

  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  const skull = part(sphGeo(0.16), skin);
  skull.scale.set(0.95, 1.08, 1);
  head.add(skull);
  const cap = part(sphGeo(0.158), hair, 0, 0.045, -0.025);
  cap.scale.set(1.04, 0.95, 1.05);
  head.add(cap);
  const spikes = look.hairStyle === 'long' ? 6 : 12;
  for (let i = 0; i < spikes; i++) {
    const a = (i / spikes) * Math.PI * 1.6 - Math.PI * 0.8;
    const len = 0.18 + ((i * 37) % 7) * 0.02;
    const spike = part(cached(`spike${len}`, () => new THREE.ConeGeometry(0.06, len, 5)), hair);
    spike.position.set(Math.sin(a) * 0.11, 0.1 + Math.cos(a * 0.5) * 0.04, -Math.cos(a) * 0.09 - 0.03);
    spike.rotation.set(-0.9 - Math.cos(a) * 0.5, 0, Math.sin(a) * 0.9);
    head.add(spike);
  }
  if (look.hairStyle === 'long') {
    const tail = part(capGeo(0.07, 0.35), hair, 0, -0.18, -0.13);
    tail.rotation.x = 0.25;
    head.add(tail);
  }
  // Forehead protector
  head.add(part(cylGeo(0.168, 0.168, 0.055, 18, true), trim, 0, 0.05));
  head.add(part(boxGeo(0.17, 0.075, 0.02), plateMat, 0, 0.05, 0.163));
  for (const s of [-1, 1]) {
    const tail = part(boxGeo(0.035, 0.22, 0.01), trim, s * 0.035, -0.04, -0.17);
    tail.rotation.set(0.35, 0, s * 0.15);
    head.add(tail);
  }
  // Face
  const white = new THREE.MeshBasicMaterial({ color: 0xf0eee8 });
  const iris = new THREE.MeshBasicMaterial({ color: look.eye ?? 0x2a1a10 });
  if (look.eye && look.eyeGlow) iris.color.multiplyScalar(2.2);
  const brow = mat(colors.hair);
  for (const s of [-1, 1]) {
    head.add(part(boxGeo(0.05, 0.026, 0.01), white, s * 0.055, -0.005, 0.152));
    head.add(part(boxGeo(0.022, 0.026, 0.012), iris, s * 0.05, -0.005, 0.154));
    const b = part(boxGeo(0.055, 0.012, 0.012), brow, s * 0.055, 0.025, 0.153);
    b.rotation.z = s * -0.18;
    head.add(b);
  }
  if (look.mask) {
    const mask = part(cylGeo(0.165, 0.15, 0.13, 16, true), trim, 0, -0.075, 0.005);
    head.add(mask);
  }

  const arm = (side) => {
    const a = limb(0.062, 0.055, 0.24, suit, suit, (pivot, elbow) => {
      elbow.add(part(cylGeo(0.07, 0.064, 0.15), metal, 0, -0.14));
      elbow.add(part(sphGeo(0.055), skin, 0, -0.29));
    });
    a.pivot.position.set(side * 0.27, 0.52, 0);
    torso.add(a.pivot);
    return a;
  };
  const armL = arm(-1), armR = arm(1);

  // Tanto in the right hand.
  const blade = new THREE.Group();
  blade.add(part(boxGeo(0.025, 0.07, 0.62), metal, 0, 0, 0.32));
  blade.add(part(cylGeo(0.06, 0.06, 0.015), mat(0x8a6a20, { metalness: 0.8, roughness: 0.4 }), 0, 0, 0.02).rotateX(Math.PI / 2));
  blade.add(part(boxGeo(0.04, 0.045, 0.18), mat(0x1a1a1a), 0, 0, -0.08));
  blade.position.set(0, -0.3, 0.03);
  armR.joint.add(blade);

  // Scarf tail: a chain of segments that lag behind the body.
  const scarf = [];
  let parent = torso;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    const piece = part(boxGeo(0.12 - i * 0.012, 0.02, 0.2), scarfMat, 0, 0, -0.1);
    seg.add(piece);
    if (i === 0) seg.position.set(0.08, 0.64, -0.14);
    else seg.position.z = -0.2;
    parent.add(seg);
    parent = seg;
    scarf.push(seg);
  }
  const collar = part(new THREE.TorusGeometry(0.135, 0.045, 8, 16), scarfMat, 0, 0.62);
  collar.rotation.x = Math.PI / 2;
  torso.add(collar);

  const parts = {
    root, hips, torso, head, scarf, blade,
    armL: armL.pivot, armR: armR.pivot, foreL: armL.joint, foreR: armR.joint,
    legL: legL.pivot, legR: legR.pivot, shinL: legL.joint, shinR: legR.joint,
  };
  return { group, parts, anim: { phase: 0, breathe: Math.random() * 6 }, materials: [suit, trim, skin, hair, scarfMat] };
}

/**
 * Animates a ninja model.
 * s = { speed, grounded, sprinting, crouching, climbing, vy, attackT (0..1 or -1), casting }
 */
export function animateNinja(model, s, dt) {
  const p = model.parts;
  const a = model.anim;
  const k = 1 - Math.exp(-dt * 14);
  const lerp = (cur, target) => cur + (target - cur) * k;

  a.phase += dt * (3 + s.speed * 1.05);
  a.breathe += dt * 2;
  const moving = s.speed > 0.5;
  const sw = Math.sin(a.phase);
  const knee = (off) => Math.max(0, Math.sin(a.phase + off));

  let lean = 0, armBase = 0, armSwing = 0, legSwing = 0, hipY = 0.92, legBend = 0;
  let kneeL = 0.08, kneeR = 0.08, elbowBase = -0.25, elbowSwing = 0;
  if (s.climbing) {
    lean = 0.25; legSwing = 1.1; armBase = -0.4; armSwing = 0.6;
    kneeL = 0.6 + knee(0) * 1.2; kneeR = 0.6 + knee(Math.PI) * 1.2; elbowBase = -1.2;
    a.phase += dt * 10;
  } else if (!s.grounded) {
    lean = 0.2; legBend = -0.7; armBase = s.vy > 0 ? -0.6 : 0.6;
    kneeL = 1.3; kneeR = 0.9; elbowBase = -0.8;
  } else if (s.crouching) {
    hipY = 0.6; lean = 0.55; legBend = -1.1; armBase = 0.3;
    legSwing = moving ? 0.35 : 0;
    kneeL = 1.9 + sw * 0.2; kneeR = 1.9 - sw * 0.2; elbowBase = -0.9;
  } else if (s.sprinting && moving) {
    // The classic shinobi run: lean forward, arms trailing behind.
    lean = 0.62; armBase = 1.45; armSwing = 0.08; legSwing = 1.15;
    kneeL = 0.2 + knee(1.7) * 1.9; kneeR = 0.2 + knee(1.7 + Math.PI) * 1.9; elbowBase = -0.1;
  } else if (moving) {
    lean = 0.15; armSwing = 0.8; legSwing = 0.85;
    kneeL = 0.15 + knee(1.6) * 1.3; kneeR = 0.15 + knee(1.6 + Math.PI) * 1.3; elbowBase = -0.9; elbowSwing = 0.3;
  }

  const breath = moving ? 0 : Math.sin(a.breathe) * 0.015;
  p.hips.position.y = lerp(p.hips.position.y, hipY + (moving && s.grounded ? Math.abs(sw) * 0.05 : 0));
  p.torso.rotation.x = lerp(p.torso.rotation.x, lean + breath);
  p.legL.rotation.x = lerp(p.legL.rotation.x, legBend + sw * legSwing);
  p.legR.rotation.x = lerp(p.legR.rotation.x, legBend - sw * legSwing);
  p.shinL.rotation.x = lerp(p.shinL.rotation.x, kneeL);
  p.shinR.rotation.x = lerp(p.shinR.rotation.x, kneeR);
  p.armL.rotation.x = lerp(p.armL.rotation.x, armBase - sw * armSwing);
  p.foreL.rotation.x = lerp(p.foreL.rotation.x, elbowBase - Math.max(0, -sw) * elbowSwing);
  p.head.rotation.x = lerp(p.head.rotation.x, -lean * 0.6);

  if (s.attackT >= 0) {
    // Overhead slash: raise then cut down.
    const t = s.attackT;
    p.armR.rotation.x = t < 0.3 ? -2.6 * (t / 0.3) : -2.6 + 3.4 * Math.min(1, (t - 0.3) / 0.4);
    p.armR.rotation.z = -0.3;
    p.foreR.rotation.x = t < 0.3 ? -0.9 : -0.2;
  } else if (s.casting) {
    // Hands meet in front of the chest: a hand seal.
    p.armR.rotation.x = lerp(p.armR.rotation.x, -1.0);
    p.armL.rotation.x = lerp(p.armL.rotation.x, -1.0);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0.55);
    p.armL.rotation.z = lerp(p.armL.rotation.z, -0.55);
    p.foreR.rotation.x = lerp(p.foreR.rotation.x, -1.3);
    p.foreL.rotation.x = lerp(p.foreL.rotation.x, -1.3);
  } else {
    p.armR.rotation.x = lerp(p.armR.rotation.x, armBase + sw * armSwing);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0);
    p.foreR.rotation.x = lerp(p.foreR.rotation.x, elbowBase - Math.max(0, sw) * elbowSwing);
  }
  if (!s.casting) p.armL.rotation.z = lerp(p.armL.rotation.z, s.sprinting && moving ? 0.25 : 0);

  // Scarf flutters more the faster we go.
  const flutter = Math.min(1, s.speed / 14);
  p.scarf.forEach((seg, i) => {
    const wave = Math.sin(a.phase * 1.7 + i * 0.9) * (0.15 + flutter * 0.35);
    seg.rotation.x = lerp(seg.rotation.x, (i === 0 ? -0.9 + flutter * 1.0 : 0.15 - flutter * 0.1) + wave);
    seg.rotation.y = Math.sin(a.phase * 1.3 + i) * 0.15 * flutter;
  });
}

// ---------------- Guards ----------------

export function buildGuard(type) {
  const palette = {
    sword: { armor: 0x8a2a1e, cloth: 0x2e2a2a, hat: 0x6b5a3a },
    archer: { armor: 0x3e5a36, cloth: 0x2e2a2a, hat: 0x6b5a3a },
    elite: { armor: 0x2a2a2e, cloth: 0x5a0d0d, hat: 0x18181c },
    lord: { armor: 0xb08a2e, cloth: 0x5a1a6a, hat: 0x111111 },
  }[type];
  const lamellar = tex('lamellar').clone();
  lamellar.repeat.set(2, 2);
  lamellar.needsUpdate = true;
  const armor = mat(palette.armor, { map: lamellar, roughness: 0.45, metalness: 0.35 });
  const cloth = type === 'lord'
    ? mat(palette.cloth, { map: tex('brocade') })
    : clothMat(palette.cloth);
  const skin = mat(0xd9ae86, { roughness: 0.7 });
  const hatMat = mat(palette.hat, { roughness: 0.7 });
  const metal = mat(0xc4ccd6, { metalness: 0.9, roughness: 0.25 });
  const gold = mat(0xe0b040, { metalness: 0.9, roughness: 0.3 });
  const dark = mat(0x151515);
  const scale = type === 'lord' ? 1.12 : type === 'elite' ? 1.06 : 1;

  const group = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  group.add(root);
  const hips = new THREE.Group();
  hips.position.y = 0.92;
  root.add(hips);

  const leg = (side) => {
    const l = limb(0.1, 0.085, 0.32, cloth, cloth, (pivot, knee) => {
      knee.add(part(cylGeo(0.1, 0.09, 0.22), armor, 0, -0.2)); // shin guard
      knee.add(part(boxGeo(0.13, 0.07, 0.26), dark, 0, -0.43, 0.05));
    });
    l.pivot.position.x = side * 0.13;
    hips.add(l.pivot);
    return l;
  };
  const legL = leg(-1), legR = leg(1);

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = part(cylGeo(0.27, 0.22, 0.62), armor, 0, 0.32);
  chest.scale.z = 0.72;
  torso.add(chest);
  if (type === 'lord') {
    torso.add(part(cylGeo(0.3, 0.52, 0.95, 14), cloth, 0, -0.42));
    const sash = part(cylGeo(0.235, 0.235, 0.1), gold, 0, 0.05);
    sash.scale.z = 0.75;
    torso.add(sash);
  } else {
    // Tassets (kusazuri) and shoulder guards (sode)
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const t = part(boxGeo(0.22, 0.3, 0.03), armor, Math.sin(a) * 0.2, -0.14, Math.cos(a) * 0.15);
      t.rotation.y = a;
      t.rotation.x = 0.12;
      torso.add(t);
    }
    for (const s of [-1, 1]) {
      const sode = part(boxGeo(0.06, 0.28, 0.24), armor, s * 0.37, 0.48, 0);
      sode.rotation.z = s * 0.3;
      torso.add(sode);
    }
  }

  const head = new THREE.Group();
  head.position.y = 0.84;
  torso.add(head);
  const skull = part(sphGeo(0.165), skin);
  skull.scale.y = 1.06;
  head.add(skull);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
  for (const s of [-1, 1]) head.add(part(boxGeo(0.045, 0.018, 0.01), eyeMat, s * 0.055, 0, 0.158));

  if (type === 'lord') {
    head.add(part(sphGeo(0.15), hatMat, 0, 0.05, -0.03));
    const topknot = part(cylGeo(0.04, 0.04, 0.18, 8), hatMat, 0, 0.2, -0.02);
    topknot.rotation.x = -1.2;
    head.add(topknot);
  } else if (type === 'elite') {
    // Kabuto helmet: dome, flared neck guard, golden crest, red face mask.
    const dome = part(new THREE.SphereGeometry(0.19, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), hatMat, 0, 0.03);
    head.add(dome);
    head.add(part(cylGeo(0.2, 0.32, 0.16, 14, true), hatMat, 0, -0.04, -0.02));
    for (const s of [-1, 1]) {
      const horn = part(boxGeo(0.02, 0.3, 0.03), gold, s * 0.08, 0.28, 0.13);
      horn.rotation.z = s * -0.45;
      head.add(horn);
    }
    head.add(part(boxGeo(0.2, 0.12, 0.06), mat(0x8a1a12, { roughness: 0.4 }), 0, -0.08, 0.13));
  } else {
    // Wide conical straw hat (jingasa)
    head.add(part(cached('kasa', () => new THREE.ConeGeometry(0.44, 0.2, 18, 1, true)), new THREE.MeshStandardMaterial({ color: palette.hat, roughness: 0.9, side: THREE.DoubleSide, map: tex('cloth') }), 0, 0.16));
  }

  const arm = (side, extra) => {
    const a = limb(0.075, 0.065, 0.24, armor, cloth, (pivot, elbow) => {
      elbow.add(part(cylGeo(0.08, 0.072, 0.17), armor, 0, -0.14));
      elbow.add(part(sphGeo(0.062), skin, 0, -0.29));
      if (extra) extra(elbow);
    });
    a.pivot.position.set(side * 0.36, 0.56, 0);
    torso.add(a.pivot);
    return a;
  };

  let weapon;
  const armL = arm(-1, type === 'archer' ? (elbow) => {
    // Tall asymmetric yumi bow
    weapon = part(new THREE.TorusGeometry(0.85, 0.02, 4, 24, Math.PI * 0.9), mat(0x3a2414, { roughness: 0.5 }));
    weapon.rotation.set(0, Math.PI / 2, Math.PI / 2 + 0.15);
    weapon.position.set(0, -0.3, 0.1);
    elbow.add(weapon);
  } : null);
  const armR = arm(1, type !== 'archer' ? (elbow) => {
    weapon = new THREE.Group();
    const bladeLen = type === 'lord' ? 0.65 : 0.95;
    const blade = part(boxGeo(0.03, 0.07, bladeLen), metal, 0, 0, bladeLen / 2 + 0.05);
    blade.rotation.x = -0.06; // slight curve suggestion
    weapon.add(blade);
    weapon.add(part(cylGeo(0.07, 0.07, 0.02), gold, 0, 0, 0.04).rotateX(Math.PI / 2));
    weapon.add(part(boxGeo(0.045, 0.045, 0.26), dark, 0, 0, -0.1));
    weapon.position.set(0, -0.3, 0.04);
    elbow.add(weapon);
  } : null);
  if (type === 'archer') {
    const quiver = part(cylGeo(0.07, 0.06, 0.6), mat(0x3a2414), 0.12, 0.35, -0.2);
    quiver.rotation.z = -0.4;
    torso.add(quiver);
  } else if (type !== 'lord') {
    const scabbard = part(boxGeo(0.05, 0.06, 0.9), dark, -0.2, 0.0, -0.05);
    scabbard.rotation.set(0.2, 0.3, 0.6);
    torso.add(scabbard);
  }

  const parts = {
    root, hips, torso, head, weapon,
    armL: armL.pivot, armR: armR.pivot, foreL: armL.joint, foreR: armR.joint,
    legL: legL.pivot, legR: legR.pivot, shinL: legL.joint, shinR: legR.joint,
  };
  const materials = [armor, cloth, skin, hatMat];
  return { group, parts, anim: { phase: Math.random() * 6 }, materials };
}

/** s = { speed, attackT, aiming, dead, deadT, bound, alert } */
export function animateGuard(model, s, dt) {
  const p = model.parts;
  const a = model.anim;
  const k = 1 - Math.exp(-dt * 10);
  const lerp = (cur, target) => cur + (target - cur) * k;

  if (s.dead) {
    const t = Math.min(1, s.deadT / 0.6);
    p.root.rotation.x = -Math.PI / 2 * (t * t);
    p.root.position.y = 0.15 * t;
    p.armL.rotation.x = lerp(p.armL.rotation.x, -2.6);
    p.armR.rotation.x = lerp(p.armR.rotation.x, -2.6);
    p.shinL.rotation.x = lerp(p.shinL.rotation.x, 0.4);
    return;
  }
  if (s.bound) {
    // Frozen mid-step, trembling.
    p.root.position.x = Math.sin(performance.now() * 0.05) * 0.015;
    return;
  }
  p.root.position.x = 0;

  a.phase += dt * (2 + s.speed * 1.4);
  const sw = Math.sin(a.phase);
  const moving = s.speed > 0.3;
  const amp = moving ? Math.min(1, 0.35 + s.speed * 0.1) : 0;
  const knee = (off) => Math.max(0, Math.sin(a.phase + off));

  p.legL.rotation.x = lerp(p.legL.rotation.x, sw * amp);
  p.legR.rotation.x = lerp(p.legR.rotation.x, -sw * amp);
  p.shinL.rotation.x = lerp(p.shinL.rotation.x, 0.08 + (moving ? knee(1.6) * amp * 1.2 : 0));
  p.shinR.rotation.x = lerp(p.shinR.rotation.x, 0.08 + (moving ? knee(1.6 + Math.PI) * amp * 1.2 : 0));
  p.torso.rotation.x = lerp(p.torso.rotation.x, moving ? Math.min(0.35, s.speed * 0.04) : 0);
  p.foreL.rotation.x = lerp(p.foreL.rotation.x, -0.3);

  if (s.attackT >= 0) {
    const t = s.attackT;
    p.armR.rotation.x = t < 0.6 ? -2.5 * (t / 0.6) : -2.5 + 3.2 * Math.min(1, (t - 0.6) / 0.25);
    p.foreR.rotation.x = t < 0.6 ? -0.8 : -0.15;
  } else if (s.aiming) {
    p.armL.rotation.x = lerp(p.armL.rotation.x, -1.55);
    p.armR.rotation.x = lerp(p.armR.rotation.x, -1.4);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0.5);
    p.foreR.rotation.x = lerp(p.foreR.rotation.x, -1.2);
    return;
  } else {
    p.armR.rotation.x = lerp(p.armR.rotation.x, -sw * amp * 0.6 - (s.alert ? 0.8 : 0));
    p.foreR.rotation.x = lerp(p.foreR.rotation.x, s.alert ? -0.9 : -0.35);
  }
  p.armR.rotation.z = lerp(p.armR.rotation.z, 0);
  p.armL.rotation.x = lerp(p.armL.rotation.x, sw * amp * 0.6);
}
