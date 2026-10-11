import * as THREE from 'three';
import { Box } from './physics.js';

// Builds the night-time castle compound: visuals, colliders, lights,
// and the guard roster with their patrol routes.

const M = {
  ground: new THREE.MeshStandardMaterial({ color: 0x2b3a2a, roughness: 1 }),
  path: new THREE.MeshStandardMaterial({ color: 0x4a4636, roughness: 1 }),
  plaster: new THREE.MeshStandardMaterial({ color: 0xcfc4ad, roughness: 0.95 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x3b2618, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x262b36, roughness: 0.7, flatShading: true }),
  stone: new THREE.MeshStandardMaterial({ color: 0x6f6d68, roughness: 1, flatShading: true }),
  wallStone: new THREE.MeshStandardMaterial({ color: 0x55524c, roughness: 1 }),
  foliage: new THREE.MeshStandardMaterial({ color: 0x1d3b22, roughness: 1, flatShading: true }),
  blossom: new THREE.MeshStandardMaterial({ color: 0xe58fb6, roughness: 1, flatShading: true }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 1 }),
  water: new THREE.MeshStandardMaterial({ color: 0x0d2235, roughness: 0.1, metalness: 0.6 }),
  crate: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 0.9 }),
  glow: new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffa53a, emissiveIntensity: 2.2 }),
  paper: new THREE.MeshStandardMaterial({ color: 0xd8372a, emissive: 0xc0281c, emissiveIntensity: 1.4 }),
};

export function buildWorld(scene) {
  const colliders = [];
  const lanterns = [];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  function solid(cx, y0, cz, w, h, d, material, { collide = true, shadow = true } = {}) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (collide) colliders.push(new Box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2));
    return mesh;
  }

  function roof(cx, y0, cz, w, d, h) {
    // Truncated pyramid with overhanging eaves; walkable flat top.
    const geo = new THREE.CylinderGeometry(0.45, 1, 1, 4, 1);
    geo.rotateY(Math.PI / 4);
    const mesh = new THREE.Mesh(geo, M.roof);
    const over = 1.2;
    mesh.scale.set((w + over) / Math.SQRT2, h, (d + over) / Math.SQRT2);
    mesh.position.set(cx, y0 + h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Collide with the flat top area only so players can drop off the eaves.
    colliders.push(new Box(cx - w * 0.42, y0, cz - d * 0.42, cx + w * 0.42, y0 + h, cz + d * 0.42));
  }

  function house(cx, cz, w, d, h, { roofH = 1.3, paperLanterns = true } = {}) {
    solid(cx, 0, cz, w, h, d, M.plaster);
    // Dark timber frame
    solid(cx, h - 0.35, cz, w + 0.1, 0.35, d + 0.1, M.wood, { collide: false, shadow: false });
    solid(cx, 0, cz, w + 0.1, 0.5, d + 0.1, M.wood, { collide: false, shadow: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      solid(cx + sx * w / 2, 0, cz + sz * d / 2, 0.3, h, 0.3, M.wood, { collide: false, shadow: false });
    }
    roof(cx, h, cz, w, d, roofH);
    if (paperLanterns) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), M.paper);
      lamp.scale.y = 1.3;
      lamp.position.set(cx + w / 2 - 0.8, h - 0.9, cz + d / 2 + 0.35);
      scene.add(lamp);
    }
  }

  function wall(x0, z0, x1, z1, h = 4.2, t = 1.2) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
    solid(cx, 0, cz, w, h, d, M.wallStone);
    // Little tiled cap on top
    solid(cx, h, cz, w + 0.5, 0.35, d + 0.5, M.roof, { collide: false, shadow: false });
    colliders[colliders.length - 1].max.y = h + 0.35; // stand on the cap
  }

  function tree(x, z, s = 1, blossom = false) {
    solid(x, 0, z, 0.45 * s, 3.2 * s, 0.45 * s, M.trunk);
    const mat = blossom ? M.blossom : M.foliage;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    for (let i = 0; i < 4; i++) {
      const f = new THREE.Mesh(geo, mat);
      const r = (1.3 + Math.random() * 0.6) * s;
      f.scale.setScalar(r);
      f.position.set(x + (Math.random() - 0.5) * 1.6 * s, (3 + Math.random() * 1.4) * s, z + (Math.random() - 0.5) * 1.6 * s);
      f.castShadow = true;
      scene.add(f);
    }
  }

  function stoneLantern(x, z, y = 0, radius = 13) {
    solid(x, y, z, 0.7, 0.4, 0.7, M.stone);
    solid(x, y + 0.4, z, 0.3, 0.8, 0.3, M.stone, { collide: false });
    solid(x, y + 1.2, z, 0.55, 0.45, 0.55, M.glow, { collide: false, shadow: false });
    solid(x, y + 1.65, z, 0.9, 0.2, 0.9, M.stone, { collide: false });
    colliders[colliders.length - 1].max.y = y + 1.8; // one collider for the whole lantern
    const light = new THREE.PointLight(0xffa04a, 26, radius, 1.6);
    light.position.set(x, y + 1.45, z);
    scene.add(light);
    lanterns.push({ pos: new THREE.Vector3(x, y + 1.4, z), radius });
  }

  function tower(x, z) {
    const h = 8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(x + sx * 1.3, 0, z + sz * 1.3, 0.35, h, 0.35, M.wood);
    solid(x, h - 0.4, z, 3.6, 0.4, 3.6, M.wood);
    // Railings
    solid(x, h, z + 1.7, 3.6, 0.8, 0.12, M.wood, { collide: false });
    solid(x, h, z - 1.7, 3.6, 0.8, 0.12, M.wood, { collide: false });
    solid(x + 1.7, h, z, 0.12, 0.8, 3.6, M.wood, { collide: false });
    solid(x - 1.7, h, z, 0.12, 0.8, 3.6, M.wood, { collide: false });
    roof(x, h + 2.2, z, 3.4, 3.4, 1.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(x + sx * 1.5, h, z + sz * 1.5, 0.15, 2.2, 0.15, M.wood, { collide: false });
    // Ladder-ish climb: a rope ladder is implied; players wall-run or grapple.
  }

  function crate(x, z, s = 1.2, y = 0) { solid(x, y, z, s, s, s, M.crate); }

  // ---------- Sky ----------
  scene.background = new THREE.Color(0x070b18);
  scene.fog = new THREE.FogExp2(0x0a1022, 0.012);

  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 1200; i++) {
    const u = Math.random() * Math.PI * 2, v = Math.random() * 0.45 + 0.05;
    const r = 400;
    starPos.push(Math.cos(u) * Math.cos(v * Math.PI) * r, Math.sin(v * Math.PI) * r * 0.9 + 20, Math.sin(u) * Math.cos(v * Math.PI) * r);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.3, sizeAttenuation: false, fog: false }));
  scene.add(stars);

  const moon = new THREE.Mesh(new THREE.SphereGeometry(18, 24, 16), new THREE.MeshBasicMaterial({ color: 0xf4efd8, fog: false }));
  moon.position.set(-160, 190, -260);
  scene.add(moon);

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0x5a6c9c, 0x10140c, 0.75));
  const moonLight = new THREE.DirectionalLight(0xaabbee, 0.9);
  moonLight.position.set(-50, 90, -70);
  moonLight.castShadow = true;
  moonLight.shadow.mapSize.set(2048, 2048);
  const sc = moonLight.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 10; sc.far = 260;
  moonLight.shadow.bias = -0.0008;
  scene.add(moonLight);

  // ---------- Ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), M.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push(new Box(-200, -2, -200, 200, 0, 200, 'ground'));
  const path = new THREE.Mesh(new THREE.PlaneGeometry(9, 70), M.path);
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 40);
  path.receiveShadow = true;
  scene.add(path);

  // Invisible world boundary
  colliders.push(new Box(-95, 0, -96, 95, 60, -94), new Box(-95, 0, 94, 95, 60, 96));
  colliders.push(new Box(-96, 0, -95, -94, 60, 95), new Box(94, 0, -95, 96, 60, 95));

  // ---------- Outer wall with south gate ----------
  const W = 55;
  wall(-W, -W, W, -W);
  wall(-W, -W, -W, W);
  wall(W, -W, W, W);
  wall(-W, W, -4.5, W);
  wall(4.5, W, W, W);
  // Gate posts & lintel
  solid(-5, 0, W, 1.4, 5.5, 1.6, M.wood);
  solid(5, 0, W, 1.4, 5.5, 1.6, M.wood);
  solid(0, 5.5, W, 12, 0.6, 2, M.wood);
  roof(0, 6.1, W, 12, 2.4, 1.2);

  // ---------- Outside: forest cover near the start ----------
  const rng = mulberry32(7);
  for (let i = 0; i < 46; i++) {
    const x = (rng() - 0.5) * 170;
    const z = 60 + rng() * 32;
    if (Math.abs(x) < 9 && z < 86) continue; // keep the road clear
    if (x > -40 && x < -8 && z < 70) continue; // keep the outer patrol route clear
    tree(x, z, 0.9 + rng() * 0.5);
  }
  for (let i = 0; i < 40; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    tree(side * (62 + rng() * 28), (rng() - 0.5) * 150, 0.9 + rng() * 0.6);
  }
  for (let i = 0; i < 18; i++) tree((rng() - 0.5) * 170, -62 - rng() * 28, 1 + rng() * 0.5);
  crate(-9, 60); crate(-10.3, 60.2, 1); crate(9.5, 61);

  // ---------- Inside the compound ----------
  house(-35, 35, 10, 8, 4);
  house(-15, 38, 8, 7, 3.5);
  house(14, 36, 12, 8, 4);
  house(38, 30, 8, 10, 3.5);
  house(-38, 5, 9, 12, 4.5);
  house(38, 0, 10, 10, 4);
  house(-20, 10, 7, 7, 3, { paperLanterns: false });
  house(18, 12, 8, 6, 3);
  house(-38, -25, 10, 8, 4);
  house(38, -28, 9, 9, 4);

  tower(-48, 48); tower(48, 48); tower(-48, -48); tower(48, -48);

  // The keep: three stacked tiers
  solid(0, 0, -18, 22, 6, 14, M.plaster);
  solid(0, 0, -18, 22.3, 0.8, 14.3, M.wallStone, { collide: false });
  solid(0, 5.6, -18, 22.4, 0.4, 14.4, M.wood, { collide: false, shadow: false });
  solid(0, 6, -18, 14, 4.5, 9, M.plaster);
  solid(0, 10.1, -18, 14.3, 0.4, 9.3, M.wood, { collide: false, shadow: false });
  solid(0, 10.5, -18, 8, 3.5, 5, M.plaster);
  roof(0, 14, -18, 8, 5, 2.2);
  // Big doors
  solid(0, 0, -10.9, 5, 4, 0.3, M.wood, { collide: false });

  // Inner garden walls
  wall(-18, -26, -18, -54.4, 3.2, 0.9);
  wall(18, -26, 18, -54.4, 3.2, 0.9);
  wall(-18, -26, -14, -26, 3.2, 0.9);
  wall(14, -26, 18, -26, 3.2, 0.9);

  // Garden: pond, pavilion, blossoms
  const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 24), M.water);
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(1.4, 1, 1);
  pond.position.set(-2, 0.02, -37);
  scene.add(pond);
  for (const [x, z] of [[-4, -50], [4, -50], [-4, -45], [4, -45]]) solid(x, 0, z, 0.35, 3, 0.35, M.wood, { collide: false });
  solid(0, 0, -47.5, 9.4, 0.5, 6.4, M.wood); // pavilion floor
  roof(0, 3, -47.5, 9.4, 6.4, 1.4);
  tree(-13, -32, 0.9, true); tree(12, -36, 1, true); tree(-12, -48, 1.1, true); tree(13, -50, 0.9, true);
  solid(14, 0, -43, 1.8, 1, 1.4, M.stone); solid(-10, 0, -42, 1.2, 0.8, 1.2, M.stone);

  // Courtyard props for cover
  crate(-5, 25); crate(-6.2, 25.1, 1); crate(-5.5, 25, 1, 1.2);
  crate(8, 18); crate(9.3, 17.8, 1);
  crate(-28, -40); crate(-26.8, -40.3, 1); crate(30, -38);
  crate(-8, -2); crate(9, -1, 1.4);
  solid(-22, 0, 26, 6, 1.2, 1.2, M.stone);
  solid(26, 0, -6, 1.2, 1.2, 6, M.stone);
  tree(-10, 48, 1); tree(28, 48, 1); tree(-46, 20, 1.1); tree(46, 15, 1); tree(-23, -9, 1); tree(48, -12, 1);

  // Lanterns (these make you visible!)
  stoneLantern(-7.5, 57);
  stoneLantern(7.5, 57);
  stoneLantern(-7, 30);
  stoneLantern(7, 26);
  stoneLantern(-9, -7);
  stoneLantern(9, -7);
  stoneLantern(-31, 15);
  stoneLantern(30, 10);
  stoneLantern(-7, -42);
  stoneLantern(7, -42);
  stoneLantern(3.5, -12.4, 6, 11);

  // ---------- Guards ----------
  const guardDefs = [
    { type: 'sword', path: [[-6, 58.5]], face: 0 },
    { type: 'sword', path: [[6, 58.5]], face: 0 },
    { type: 'sword', path: [[-34, 65], [-14, 65]] },
    { type: 'sword', path: [[-25, 45], [25, 45], [25, 22], [-25, 22]] },
    { type: 'sword', path: [[-28, -12], [-28, 28]] },
    { type: 'sword', path: [[28, 22], [28, -12], [20, -6]] },
    { type: 'sword', path: [[-13, -5], [13, -5]] },
    { type: 'sword', path: [[32, -48], [30, -14]] },
    { type: 'sword', path: [[-31, -14], [-31, -48]] },
    { type: 'archer', path: [[-48, 48]], y: 8, face: Math.PI * 0.75, stationary: true },
    { type: 'archer', path: [[48, 48]], y: 8, face: -Math.PI * 0.75, stationary: true },
    { type: 'archer', path: [[-48, -48]], y: 8, face: Math.PI * 0.25, stationary: true },
    { type: 'archer', path: [[48, -48]], y: 8, face: -Math.PI * 0.25, stationary: true },
    { type: 'archer', path: [[0, -12.2]], y: 6, face: 0, stationary: true },
    { type: 'elite', path: [[-11, -41], [9, -41], [9, -31], [-11, -31]] },
    { type: 'elite', path: [[-6, -45.5], [6, -45.5]], face: 0 },
    { type: 'lord', path: [[-3, -48], [3, -48]], y: 0.5, face: 0 },
  ];

  function lightAt(p) {
    let l = 0.3;
    for (const L of lanterns) {
      const d = p.distanceTo(L.pos);
      if (d < L.radius) {
        const f = 1 - d / L.radius;
        l += f * f * 1.4;
      }
    }
    return Math.min(1.6, l);
  }

  return {
    colliders,
    lanterns,
    lightAt,
    guardDefs,
    spawn: { pos: new THREE.Vector3(0, 0, 80), yaw: Math.PI },
  };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
