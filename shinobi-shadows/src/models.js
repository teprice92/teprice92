import * as THREE from 'three';

// Simple primitive-built characters with procedural animation.
// Every model faces +Z and has its origin at the feet.

const geoCache = new Map();
function boxGeo(w, h, d) {
  const key = `${w}|${h}|${d}`;
  if (!geoCache.has(key)) geoCache.set(key, new THREE.BoxGeometry(w, h, d));
  return geoCache.get(key);
}

function mat(color, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0.05, ...extra });
}

function limb(w, h, d, material, offsetY) {
  const pivot = new THREE.Group();
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.y = offsetY;
  m.castShadow = true;
  pivot.add(m);
  return pivot;
}

export function buildNinja(colors) {
  const suit = mat(colors.suit);
  const trim = mat(colors.trim);
  const skin = mat(colors.skin);
  const hair = mat(colors.hair);
  const scarfMat = mat(colors.scarf, { side: THREE.DoubleSide });
  const metal = mat(0xc9d2dc, { metalness: 0.8, roughness: 0.3 });

  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);

  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);

  const legL = limb(0.17, 0.88, 0.18, trim, -0.44);
  legL.position.set(-0.12, 0, 0);
  const legR = limb(0.17, 0.88, 0.18, trim, -0.44);
  legR.position.set(0.12, 0, 0);
  hips.add(legL, legR);

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = new THREE.Mesh(boxGeo(0.44, 0.62, 0.26), suit);
  chest.position.y = 0.31;
  chest.castShadow = true;
  const belt = new THREE.Mesh(boxGeo(0.46, 0.08, 0.28), trim);
  belt.position.y = 0.04;
  torso.add(chest, belt);

  const head = new THREE.Group();
  head.position.y = 0.78;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
  skull.castShadow = true;
  head.add(skull);
  // Spiky hair
  for (let i = 0; i < 9; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 5), hair);
    const a = (i / 9) * Math.PI * 2;
    spike.position.set(Math.sin(a) * 0.1, 0.12 + Math.random() * 0.03, Math.cos(a) * 0.1 - 0.03);
    spike.rotation.set(Math.cos(a) * -0.9, 0, Math.sin(a) * 0.9);
    head.add(spike);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), hair);
  top.position.set(0, 0.06, -0.03);
  head.add(top);
  // Headband with metal plate
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.178, 0.06, 16, 1, true), trim);
  band.position.y = 0.05;
  const plate = new THREE.Mesh(boxGeo(0.16, 0.07, 0.02), metal);
  plate.position.set(0, 0.05, 0.17);
  head.add(band, plate);
  // Eyes
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const eyeL = new THREE.Mesh(boxGeo(0.04, 0.025, 0.01), eyeMat);
  eyeL.position.set(-0.06, -0.01, 0.165);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.06;
  head.add(eyeL, eyeR);

  const armL = limb(0.13, 0.62, 0.13, suit, -0.29);
  armL.position.set(-0.3, 0.56, 0);
  const armR = limb(0.13, 0.62, 0.13, suit, -0.29);
  armR.position.set(0.3, 0.56, 0);
  torso.add(armL, armR);

  // Blade held in the right hand (reverse grip tanto).
  const blade = new THREE.Group();
  const edge = new THREE.Mesh(boxGeo(0.03, 0.08, 0.7), metal);
  edge.position.z = 0.3;
  const hilt = new THREE.Mesh(boxGeo(0.05, 0.05, 0.2), trim);
  hilt.position.z = -0.12;
  blade.add(edge, hilt);
  blade.position.set(0, -0.6, 0.05);
  armR.add(blade);

  // Scarf tail: a chain of segments that lag behind the body.
  const scarf = [];
  let parent = torso;
  for (let i = 0; i < 4; i++) {
    const seg = new THREE.Group();
    const piece = new THREE.Mesh(boxGeo(0.12, 0.02, 0.22), scarfMat);
    piece.position.z = -0.11;
    piece.castShadow = true;
    seg.add(piece);
    if (i === 0) seg.position.set(0.08, 0.66, -0.14);
    else seg.position.z = -0.22;
    parent.add(seg);
    parent = seg;
    scarf.push(seg);
  }
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.04, 6, 12), scarfMat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.64;
  torso.add(collar);

  const parts = { root, hips, torso, head, armL, armR, legL, legR, scarf, blade };
  return { group, parts, anim: { phase: 0, lean: 0, attack: 0 }, materials: [suit, trim, skin, hair, scarfMat] };
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
  const moving = s.speed > 0.5;
  const sw = Math.sin(a.phase);

  let lean = 0, armBase = 0, armSwing = 0, legSwing = 0, hipY = 0.9, legBend = 0;
  if (s.climbing) {
    lean = 0.25; legSwing = 1.1; armBase = -0.4; armSwing = 0.6;
    a.phase += dt * 10;
  } else if (!s.grounded) {
    lean = 0.2; legBend = -0.6; armBase = s.vy > 0 ? -0.6 : 0.6;
  } else if (s.crouching) {
    hipY = 0.6; lean = 0.55; legBend = -1.1; armBase = 0.3;
    legSwing = moving ? 0.35 : 0;
  } else if (s.sprinting && moving) {
    // The classic shinobi run: lean forward, arms trailing behind.
    lean = 0.62; armBase = 1.45; armSwing = 0.08; legSwing = 1.15;
  } else if (moving) {
    lean = 0.15; armSwing = 0.8; legSwing = 0.85;
  }

  p.hips.position.y = lerp(p.hips.position.y, hipY + (moving && s.grounded ? Math.abs(sw) * 0.05 : 0));
  p.torso.rotation.x = lerp(p.torso.rotation.x, lean);
  p.legL.rotation.x = lerp(p.legL.rotation.x, legBend + sw * legSwing);
  p.legR.rotation.x = lerp(p.legR.rotation.x, legBend - sw * legSwing);
  p.armL.rotation.x = lerp(p.armL.rotation.x, armBase - sw * armSwing);

  if (s.attackT >= 0) {
    // Overhead slash: raise then cut down.
    const t = s.attackT;
    const target = t < 0.3 ? -2.6 * (t / 0.3) : -2.6 + 3.4 * Math.min(1, (t - 0.3) / 0.4);
    p.armR.rotation.x = target;
    p.armR.rotation.z = -0.3;
  } else if (s.casting) {
    p.armR.rotation.x = lerp(p.armR.rotation.x, -1.5);
    p.armL.rotation.x = lerp(p.armL.rotation.x, -1.5);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0.4);
  } else {
    p.armR.rotation.x = lerp(p.armR.rotation.x, armBase + sw * armSwing);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0);
  }
  p.armL.rotation.z = lerp(p.armL.rotation.z, s.sprinting && moving ? 0.25 : 0);

  // Scarf flutters more the faster we go.
  const flutter = Math.min(1, s.speed / 14);
  p.scarf.forEach((seg, i) => {
    const wave = Math.sin(a.phase * 1.7 + i * 0.9) * (0.15 + flutter * 0.35);
    seg.rotation.x = lerp(seg.rotation.x, (i === 0 ? -0.9 + flutter * 1.0 : 0.15 - flutter * 0.1) + wave);
    seg.rotation.y = Math.sin(a.phase * 1.3 + i) * 0.15 * flutter;
  });
}

export function buildGuard(type) {
  const palette = {
    sword: { armor: 0x6b1a14, cloth: 0x2a2320, hat: 0x3a2e1e },
    archer: { armor: 0x2f4a2a, cloth: 0x2a2320, hat: 0x3a2e1e },
    elite: { armor: 0x1a1a1a, cloth: 0x5a0d0d, hat: 0x111111 },
    lord: { armor: 0xb08a2e, cloth: 0x4a1458, hat: 0x111111 },
  }[type];
  const armor = mat(palette.armor, { roughness: 0.55, metalness: 0.3 });
  const cloth = mat(palette.cloth);
  const skin = mat(0xd9ae86);
  const hatMat = mat(palette.hat);
  const metal = mat(0xbfc6cf, { metalness: 0.85, roughness: 0.3 });
  const scale = type === 'lord' ? 1.12 : type === 'elite' ? 1.06 : 1;

  const group = new THREE.Group();
  const root = new THREE.Group();
  root.scale.setScalar(scale);
  group.add(root);
  const hips = new THREE.Group();
  hips.position.y = 0.9;
  root.add(hips);

  const legL = limb(0.2, 0.9, 0.22, cloth, -0.45);
  legL.position.x = -0.13;
  const legR = limb(0.2, 0.9, 0.22, cloth, -0.45);
  legR.position.x = 0.13;
  hips.add(legL, legR);

  const torso = new THREE.Group();
  hips.add(torso);
  const chest = new THREE.Mesh(boxGeo(0.56, 0.66, 0.34), armor);
  chest.position.y = 0.33;
  chest.castShadow = true;
  torso.add(chest);
  if (type === 'lord') {
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.5, 0.95, 10), cloth);
    robe.position.y = -0.4;
    robe.castShadow = true;
    torso.add(robe);
  } else {
    const skirt = new THREE.Mesh(boxGeo(0.6, 0.3, 0.38), armor);
    skirt.position.y = -0.05;
    torso.add(skirt);
    const shoulders = new THREE.Mesh(boxGeo(0.82, 0.1, 0.38), armor);
    shoulders.position.y = 0.62;
    torso.add(shoulders);
  }

  const head = new THREE.Group();
  head.position.y = 0.82;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), skin);
  head.add(skull);
  if (type === 'lord') {
    const topknot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.18, 6), hatMat);
    topknot.position.set(0, 0.2, -0.04);
    topknot.rotation.x = -0.6;
    head.add(topknot);
  } else {
    // Wide conical straw hat (jingasa)
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.2, 14), hatMat);
    hat.position.y = 0.16;
    hat.castShadow = true;
    head.add(hat);
  }

  const armL = limb(0.15, 0.62, 0.15, armor, -0.3);
  armL.position.set(-0.36, 0.56, 0);
  const armR = limb(0.15, 0.62, 0.15, armor, -0.3);
  armR.position.set(0.36, 0.56, 0);
  torso.add(armL, armR);

  let weapon;
  if (type === 'archer') {
    weapon = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.025, 4, 16, Math.PI), mat(0x4a3220));
    weapon.rotation.set(0, Math.PI / 2, Math.PI / 2);
    weapon.position.set(0, -0.6, 0.1);
    armL.add(weapon);
  } else {
    weapon = new THREE.Group();
    const bladeLen = type === 'lord' ? 0.7 : 1.0;
    const blade = new THREE.Mesh(boxGeo(0.04, 0.09, bladeLen), metal);
    blade.position.z = bladeLen / 2;
    const handle = new THREE.Mesh(boxGeo(0.05, 0.05, 0.25), mat(0x111111));
    handle.position.z = -0.12;
    weapon.add(blade, handle);
    weapon.position.set(0, -0.6, 0.05);
    armR.add(weapon);
  }

  const parts = { root, hips, torso, head, armL, armR, legL, legR, weapon };
  const materials = [armor, cloth, skin, hatMat];
  return { group, parts, anim: { phase: Math.random() * 6 }, materials };
}

/** s = { speed, attackT, aiming, dead, deadT, bound } */
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

  p.legL.rotation.x = lerp(p.legL.rotation.x, sw * amp);
  p.legR.rotation.x = lerp(p.legR.rotation.x, -sw * amp);
  p.torso.rotation.x = lerp(p.torso.rotation.x, moving ? Math.min(0.35, s.speed * 0.04) : 0);

  if (s.attackT >= 0) {
    const t = s.attackT;
    p.armR.rotation.x = t < 0.6 ? -2.5 * (t / 0.6) : -2.5 + 3.2 * Math.min(1, (t - 0.6) / 0.25);
  } else if (s.aiming) {
    p.armL.rotation.x = lerp(p.armL.rotation.x, -1.55);
    p.armR.rotation.x = lerp(p.armR.rotation.x, -1.4);
    p.armR.rotation.z = lerp(p.armR.rotation.z, 0.5);
    return;
  } else {
    p.armR.rotation.x = lerp(p.armR.rotation.x, -sw * amp * 0.6 - (s.alert ? 0.8 : 0));
  }
  p.armR.rotation.z = lerp(p.armR.rotation.z, 0);
  p.armL.rotation.x = lerp(p.armL.rotation.x, sw * amp * 0.6);
}
