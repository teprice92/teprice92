import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Box, pointInBoxes } from './physics.js';
import { tex, texturedMaterial, radialTexture } from './textures.js';

// Builds the night-time castle compound: visuals, colliders, lights,
// ambient life (grass, fireflies, petals, mist) and the guard roster.
// Static scenery is merged into one mesh per material to keep draw calls low.

let M = null;
function materials() {
  if (M) return M;
  const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
  M = {
    grass: texturedMaterial('grass', 5, { roughness: 1 }),
    gravel: texturedMaterial('gravel', 4, { color: 0x9a968c, roughness: 1, bump: 0.03, ...decal }),
    road: texturedMaterial('dirt', 3, { roughness: 1, transparent: true, ...decal }),
    plaster: texturedMaterial('plaster', 3, { bump: 0.015 }),
    houseWall: texturedMaterial('houseWall', 4, { bump: 0.01 }),
    houseLit: texturedMaterial('houseWall', 4, { bump: 0.01, glow: 'houseGlow', emissive: 0xffc890, emissiveIntensity: 1.3 }),
    wood: texturedMaterial('wood', 2, { color: 0x6e4a32, bump: 0.02 }),
    darkWood: texturedMaterial('wood', 2, { color: 0x3a2618, bump: 0.02 }),
    vermilion: texturedMaterial('wood', 2, { color: 0xd8442a, roughness: 0.6 }),
    roof: texturedMaterial('roof', 2, { color: 0x77809a, bump: 0.04, roughness: 0.55, metalness: 0.25, side: THREE.DoubleSide }),
    stoneWall: texturedMaterial('stoneWall', 3, { bump: 0.06 }),
    stone: texturedMaterial('stone', 1.5, { bump: 0.04, flatShading: true }),
    crate: texturedMaterial('crate', 1.2, { color: 0x9a7350, bump: 0.02 }),
    bark: texturedMaterial('bark', 1.2, { color: 0x8a7462, bump: 0.05 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    bamboo: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    water: new THREE.MeshStandardMaterial({ color: 0x0b1b2c, roughness: 0.06, metalness: 0.1 }),
    lily: new THREE.MeshStandardMaterial({ color: 0x2d5a2a, roughness: 0.8, side: THREE.DoubleSide }),
    paper: new THREE.MeshStandardMaterial({ color: 0xd8372a, emissive: 0xff3a1c, emissiveIntensity: 2.2 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 }),
  };
  // Fade across the road's 7 m width (v runs across it).
  M.road.alphaMap = tex('edgeFade', { color: false }).clone();
  M.road.alphaMap.repeat.set(1, 1 / 7);
  M.road.alphaMap.needsUpdate = true;
  M.water.bumpMap = tex('water', { color: false }).clone();
  M.water.bumpMap.repeat.set(0.25, 0.25);
  M.water.bumpMap.needsUpdate = true;
  M.water.bumpScale = 0.08;
  return M;
}

// ---------- Geometry helpers (UVs are in metres) ----------

function boxGeo(cx, y0, cz, w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx, y = p.getY(i) + h / 2, z = p.getZ(i) + cz;
    const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
    if (Math.abs(nx) > 0.5) uv.setXY(i, -z * Math.sign(nx), y);
    else if (Math.abs(ny) > 0.5) uv.setXY(i, x, z);
    else uv.setXY(i, x * Math.sign(nz), y);
  }
  g.translate(cx, y0 + h / 2, cz);
  return g.toNonIndexed();
}

/** Builds a geometry from quads, fixing winding so normals face `out`. */
function quadGeo(quads) {
  const pos = [], uvs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const { p, uv, out } of quads) {
    a.subVectors(p[1], p[0]); b.subVectors(p[2], p[0]); c.crossVectors(a, b);
    const order = c.dot(out) >= 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    for (const k of order) { pos.push(p[k].x, p[k].y, p[k].z); uvs.push(uv[k][0], uv[k][1]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.computeVertexNormals();
  return g;
}

const ROOF_CURVE = 1.35;

/**
 * Japanese hip roof with a concave sweep and upturned corners.
 * Returns { geo, steps } where steps are walkable collider levels.
 */
function hipRoofGeo(cx, y0, cz, w, d, h, over = 1.2) {
  const Ax = (w + over) / 2, Az = (d + over) / 2;
  const topHalf = Math.max(0.3, Math.min(w, d) * 0.08);
  const S = Math.min(Ax, Az) - topHalf;
  const prof = [0, 0.2, 0.42, 0.66, 1];
  const f = (u) => Math.pow(u, ROOF_CURVE);
  const V = (x, y, z) => new THREE.Vector3(cx + x, y0 + y, cz + z);
  const quads = [];
  // Each side: [edge direction axis, outward normal sign]
  const sides = [
    { axis: 'x', sign: 1 }, { axis: 'x', sign: -1 }, { axis: 'z', sign: 1 }, { axis: 'z', sign: -1 },
  ];
  for (const { axis, sign } of sides) {
    const along = axis === 'x' ? Ax : Az; // half length of this eave
    const across = axis === 'x' ? Az : Ax; // distance of eave from centre
    let vAcc = 0;
    for (let k = 0; k < prof.length - 1; k++) {
      const s0 = prof[k] * S, s1 = prof[k + 1] * S;
      const lift0 = k === 0 ? 0.28 : 0, lift1 = k === 0 ? 0.08 : 0;
      const y0r = h * f(prof[k]), y1r = h * f(prof[k + 1]);
      const pt = (t, s, y, lift) => {
        const e = (along - s) * t; // position along the eave
        const o = (across - s) * sign; // offset from centre
        const yy = y + (Math.abs(t) === 1 ? lift : 0);
        return axis === 'x' ? V(e, yy, o) : V(o, yy, e);
      };
      const segLen = Math.hypot(s1 - s0, y1r - y0r);
      const out = axis === 'x' ? new THREE.Vector3(0, 1, sign) : new THREE.Vector3(sign, 1, 0);
      quads.push({
        p: [pt(-1, s0, y0r, lift0), pt(1, s0, y0r, lift0), pt(1, s1, y1r, lift1), pt(-1, s1, y1r, lift1)],
        uv: [[-(along - s0), vAcc], [along - s0, vAcc], [along - s1, vAcc + segLen], [-(along - s1), vAcc + segLen]],
        out,
      });
      vAcc += segLen;
    }
  }
  const tx = Ax - S, tz = Az - S;
  quads.push({ p: [V(-tx, h, -tz), V(tx, h, -tz), V(tx, h, tz), V(-tx, h, tz)], uv: [[0, 0], [tx * 2, 0], [tx * 2, tz * 2], [0, tz * 2]], out: new THREE.Vector3(0, 1, 0) });
  quads.push({ p: [V(-Ax, 0, -Az), V(Ax, 0, -Az), V(Ax, 0, Az), V(-Ax, 0, Az)], uv: [[0, 0], [Ax * 2, 0], [Ax * 2, Az * 2], [0, Az * 2]], out: new THREE.Vector3(0, -1, 0) });

  // Stepped colliders approximating the slope (each step <= 0.2 m).
  const n = Math.max(2, Math.ceil(h / 0.2));
  const steps = [];
  for (let k = 1; k <= n; k++) {
    const u = Math.pow(k / n, 1 / ROOF_CURVE);
    const s = u * S;
    steps.push(new Box(cx - (Ax - s), y0, cz - (Az - s), cx + (Ax - s), y0 + h * f(u), cz + (Az - s), 'roof'));
  }
  return { geo: quadGeo(quads), steps, top: { tx, tz } };
}

function colorize(geo, fn) {
  const p = geo.attributes.position;
  const cols = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getX(i), p.getY(i), p.getZ(i), i);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return geo;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Ambient shaders ----------

const FIREFLY_VERT = `
  uniform float uTime;
  attribute float phase;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.4 + phase * 7.0) * 1.6;
    p.y += sin(uTime * 0.7 + phase * 3.0) * 0.6;
    p.z += cos(uTime * 0.35 + phase * 5.0) * 1.6;
    vAlpha = smoothstep(0.2, 1.0, sin(uTime * 1.3 + phase * 11.0) * 0.5 + 0.5);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = 6.0 * (40.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const FIREFLY_FRAG = `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vec3(1.6, 2.2, 0.6) * vAlpha, vAlpha * smoothstep(0.5, 0.0, d));
  }`;

const PETAL_VERT = `
  uniform float uTime;
  attribute float phase;
  attribute vec3 origin;
  varying float vAlpha;
  void main() {
    float t = mod(uTime * 0.12 + phase, 1.0);
    vec3 p = origin;
    p.y = origin.y * (1.0 - t);
    p.x += sin(uTime * 1.5 + phase * 20.0) * 0.6 + t * 3.0;
    p.z += cos(uTime * 1.1 + phase * 13.0) * 0.6;
    vAlpha = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.85, t);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = 3.0 * (40.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PETAL_FRAG = `
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    if (abs(c.x) + abs(c.y) * 1.6 > 0.5) discard;
    gl_FragColor = vec4(1.0, 0.62, 0.78, vAlpha * 0.9);
  }`;

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const SKY_FRAG = `
  uniform vec3 horizon;
  uniform vec3 zenith;
  uniform vec3 moonDir;
  uniform vec3 moonGlow;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    vec3 c = mix(horizon, zenith, smoothstep(-0.02, 0.55, d.y));
    float m = max(dot(d, moonDir), 0.0);
    c += moonGlow * (pow(m, 8.0) * 0.6 + pow(m, 60.0) * 1.5);
    gl_FragColor = vec4(c, 1.0);
  }`;

const STAR_VERT = `
  uniform float uTime;
  attribute float phase;
  attribute float bright;
  varying float vB;
  void main() {
    vB = bright * (0.65 + 0.35 * sin(uTime * (1.0 + phase) + phase * 40.0));
    gl_PointSize = 1.0 + bright * 2.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const STAR_FRAG = `
  varying float vB;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * vB * 1.6, smoothstep(0.5, 0.1, d));
  }`;

// ---------- World ----------

export function buildWorld(scene, { quality = 'high' } = {}) {
  const Mt = materials();
  const colliders = [];
  const lanterns = [];
  const buckets = new Map();
  const time = { value: 0 };
  const petalOrigins = [];
  const rng = mulberry32(7);

  function add(mat, geo, cast = true) {
    const key = mat.uuid + (cast ? 'c' : 'n');
    if (!buckets.has(key)) buckets.set(key, { mat, cast, geos: [] });
    buckets.get(key).geos.push(geo.index ? geo.toNonIndexed() : geo);
  }

  function solid(cx, y0, cz, w, h, d, mat, { collide = true, shadow = true, tag = 'stone' } = {}) {
    add(mat, boxGeo(cx, y0, cz, w, h, d), shadow);
    if (collide) colliders.push(new Box(cx - w / 2, y0, cz - d / 2, cx + w / 2, y0 + h, cz + d / 2, tag));
  }

  function roof(cx, y0, cz, w, d, h, { over = 1.2, ridge = true } = {}) {
    const r = hipRoofGeo(cx, y0, cz, w, d, h, over);
    add(Mt.roof, r.geo);
    colliders.push(...r.steps);
    if (ridge) {
      // Ridge beam with raised end tiles.
      const long = r.top.tx >= r.top.tz;
      const len = (long ? r.top.tx : r.top.tz) * 2 + 0.3;
      if (long) solid(cx, y0 + h, cz, len, 0.22, 0.3, Mt.roof, { collide: false });
      else solid(cx, y0 + h, cz, 0.3, 0.22, len, Mt.roof, { collide: false });
      for (const s of [-1, 1]) {
        const ex = long ? cx + s * len / 2 : cx, ez = long ? cz : cz + s * len / 2;
        solid(ex, y0 + h, ez, 0.35, 0.45, 0.35, Mt.roof, { collide: false });
      }
    }
  }

  function house(cx, cz, w, d, h, { roofH = 1.3, lit = false, paperLanterns = true } = {}) {
    solid(cx, 0, cz, w, h, d, lit ? Mt.houseLit : Mt.houseWall, { tag: 'wood' });
    solid(cx, 0, cz, w + 0.25, 0.3, d + 0.25, Mt.stone, { collide: false });
    solid(cx, h - 0.3, cz, w + 0.14, 0.3, d + 0.14, Mt.darkWood, { collide: false, shadow: false });
    roof(cx, h, cz, w, d, roofH);
    if (paperLanterns) chochin(cx + w / 2 - 0.9, h - 1.0, cz + d / 2 + 0.45);
  }

  function chochin(x, y, z) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 8), Mt.paper);
    lamp.scale.y = 1.35;
    lamp.position.set(x, y, z);
    scene.add(lamp);
    for (const dy of [-0.3, 0.3]) {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 10), Mt.black);
      cap.position.set(x, y + dy, z);
      scene.add(cap);
    }
  }

  function wall(x0, z0, x1, z1, h = 4.2, t = 1.2) {
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const w = Math.abs(x1 - x0) || t, d = Math.abs(z1 - z0) || t;
    const base = Math.min(1.8, h * 0.45);
    solid(cx, 0, cz, w + 0.1, base, d + 0.1, Mt.stoneWall, { collide: false });
    solid(cx, 0, cz, w, h, d, Mt.plaster);
    solid(cx, h - 0.25, cz, w + 0.08, 0.25, d + 0.08, Mt.darkWood, { collide: false, shadow: false });
    // Tiled coping
    solid(cx, h, cz, w + 0.6, 0.18, d + 0.6, Mt.roof, { collide: false });
    solid(cx, h + 0.18, cz, w + 0.25, 0.17, d + 0.25, Mt.roof, { collide: false });
    colliders[colliders.length - 1].max.y = h + 0.35; // stand on the coping
    colliders[colliders.length - 1].tag = 'roof';
  }

  function pine(x, z, s = 1) {
    const lean = (rng() - 0.5) * 0.25;
    const h = 4.2 * s;
    const trunk = new THREE.CylinderGeometry(0.16 * s, 0.3 * s, h, 7, 3);
    trunk.translate(0, h / 2, 0);
    trunk.rotateZ(lean);
    trunk.translate(x, 0, z);
    add(Mt.bark, trunk);
    colliders.push(new Box(x - 0.25 * s, 0, z - 0.25 * s, x + 0.25 * s, h * 0.8, z + 0.25 * s, 'wood'));
    const clumps = 4 + Math.floor(rng() * 3);
    for (let i = 0; i < clumps; i++) {
      const t = 0.45 + (i / clumps) * 0.6;
      const g = new THREE.IcosahedronGeometry(1, 1);
      const r = (1.4 + rng() * 0.9) * s * (1.1 - t * 0.4);
      g.scale(r, r * 0.38, r);
      const a = rng() * Math.PI * 2, off = (1 - t) * 1.6 * s;
      g.translate(x - Math.sin(lean) * h * t + Math.cos(a) * off, h * t + 0.6 * s, z + Math.sin(a) * off);
      const base = 0.25 + rng() * 0.15;
      colorize(g, (c, px, py) => c.setHSL(0.3 + rng() * 0.05, 0.45, base * (0.1 + Math.min(1, (py - h * t) * 0.5 + 0.18)) * 0.5));
      add(Mt.foliage, g);
    }
  }

  function cherry(x, z, s = 1) {
    const h = 3.2 * s;
    const trunk = new THREE.CylinderGeometry(0.14 * s, 0.28 * s, h, 7, 2);
    trunk.translate(x, h / 2, z);
    add(Mt.bark, trunk);
    colliders.push(new Box(x - 0.25 * s, 0, z - 0.25 * s, x + 0.25 * s, h, z + 0.25 * s, 'wood'));
    for (let i = 0; i < 6; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const r = (1.1 + rng() * 0.7) * s;
      g.scale(r, r * 0.75, r);
      const px = x + (rng() - 0.5) * 2.6 * s, py = h + (rng() * 1.3) * s, pz = z + (rng() - 0.5) * 2.6 * s;
      g.translate(px, py, pz);
      colorize(g, (c, vx, vy) => c.setHSL(0.93 + rng() * 0.03, 0.7, 0.45 + (vy - py) * 0.12 + rng() * 0.1));
      add(Mt.foliage, g);
      petalOrigins.push([px, py, pz]);
    }
  }

  function bamboo(x, z, n = 14) {
    for (let i = 0; i < n; i++) {
      const bx = x + (rng() - 0.5) * 3, bz = z + (rng() - 0.5) * 3;
      const h = 6 + rng() * 4;
      const g = new THREE.CylinderGeometry(0.07, 0.09, h, 6, Math.round(h / 0.9));
      g.translate(bx, h / 2, bz);
      colorize(g, (c, vx, vy) => c.setHSL(0.24, 0.45, (vy % 0.9) < 0.08 ? 0.12 : 0.2 + rng() * 0.03));
      add(Mt.bamboo, g);
      for (let k = 0; k < 3; k++) {
        const f = new THREE.IcosahedronGeometry(0.9, 0);
        f.scale(1, 0.35, 1);
        f.translate(bx + (rng() - 0.5), h - k * 1.2, bz + (rng() - 0.5));
        colorize(f, (c) => c.setHSL(0.26, 0.5, 0.1 + rng() * 0.06));
        add(Mt.foliage, f);
      }
    }
    colliders.push(new Box(x - 1.3, 0, z - 1.3, x + 1.3, 6, z + 1.3, 'wood'));
  }

  function rock(x, z, s = 1, y = 0) {
    const g = new THREE.IcosahedronGeometry(s, 0);
    g.scale(1, 0.6, 0.8);
    g.rotateY(rng() * 3);
    g.translate(x, y + s * 0.3, z);
    add(Mt.stone, g);
  }

  function stoneLantern(x, z, y = 0, radius = 13) {
    // Pedestal, pillar, firebox and pagoda hat.
    solid(x, y, z, 0.8, 0.25, 0.8, Mt.stone);
    colliders[colliders.length - 1].max.y = y + 1.9; // one collider for the whole lantern
    const pillar = new THREE.CylinderGeometry(0.13, 0.17, 0.8, 8);
    pillar.translate(x, y + 0.65, z);
    add(Mt.stone, pillar);
    solid(x, y + 1.05, z, 0.62, 0.1, 0.62, Mt.stone, { collide: false });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffd28a, emissive: 0xffa53a, emissiveIntensity: 3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.44), glowMat);
    box.position.set(x, y + 1.35, z);
    scene.add(box);
    for (const [dx, dz] of [[-0.21, -0.21], [0.21, -0.21], [-0.21, 0.21], [0.21, 0.21]]) {
      solid(x + dx, y + 1.15, z + dz, 0.07, 0.42, 0.07, Mt.stone, { collide: false, shadow: false });
    }
    const hat = new THREE.ConeGeometry(0.62, 0.42, 4);
    hat.rotateY(Math.PI / 4);
    hat.translate(x, y + 1.78, z);
    add(Mt.stone, hat);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture('rgba(255,180,90,0.9)', 'rgba(255,140,60,0)'), blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55,
    }));
    halo.position.set(x, y + 1.35, z);
    halo.scale.setScalar(2.4);
    scene.add(halo);
    const light = new THREE.PointLight(0xffa04a, 26, radius, 1.6);
    light.position.set(x, y + 1.45, z);
    scene.add(light);
    lanterns.push({ pos: new THREE.Vector3(x, y + 1.4, z), radius, light, glowMat, halo, seed: rng() * 100 });
  }

  function tower(x, z) {
    const h = 8;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(x + sx * 1.3, 0, z + sz * 1.3, 0.35, h, 0.35, Mt.darkWood, { tag: 'wood' });
    // Cross bracing
    for (const yy of [2.5, 5.2]) {
      solid(x, yy, z + 1.3, 2.6, 0.18, 0.12, Mt.darkWood, { collide: false });
      solid(x, yy, z - 1.3, 2.6, 0.18, 0.12, Mt.darkWood, { collide: false });
      solid(x + 1.3, yy, z, 0.12, 0.18, 2.6, Mt.darkWood, { collide: false });
      solid(x - 1.3, yy, z, 0.12, 0.18, 2.6, Mt.darkWood, { collide: false });
    }
    solid(x, h - 0.4, z, 3.6, 0.4, 3.6, Mt.wood, { tag: 'wood' });
    solid(x, h, z + 1.7, 3.6, 0.8, 0.12, Mt.wood, { collide: false });
    solid(x, h, z - 1.7, 3.6, 0.8, 0.12, Mt.wood, { collide: false });
    solid(x + 1.7, h, z, 0.12, 0.8, 3.6, Mt.wood, { collide: false });
    solid(x - 1.7, h, z, 0.12, 0.8, 3.6, Mt.wood, { collide: false });
    roof(x, h + 2.2, z, 3.4, 3.4, 1.1, { ridge: false });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid(x + sx * 1.5, h, z + sz * 1.5, 0.15, 2.2, 0.15, Mt.darkWood, { collide: false });
  }

  function crate(x, z, s = 1.2, y = 0) { solid(x, y, z, s, s, s, Mt.crate, { tag: 'wood' }); }

  function groundPatch(mat, cx, cz, w, d, y, rot = 0) {
    const g = new THREE.PlaneGeometry(w, d);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * d);
    const m = new THREE.Mesh(g, mat);
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(cx, y, cz);
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  // ---------- Sky ----------
  const horizon = new THREE.Color(0x111a33);
  scene.background = new THREE.Color(0x04060d);
  scene.fog = new THREE.FogExp2(horizon, 0.0115);
  const moonDir = new THREE.Vector3(-160, 190, -260).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(520, 32, 16), new THREE.ShaderMaterial({
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { horizon: { value: horizon }, zenith: { value: new THREE.Color(0x02030a) }, moonDir: { value: moonDir }, moonGlow: { value: new THREE.Color(0x3a4a70) } },
  }));
  sky.renderOrder = -10;
  scene.add(sky);

  const starPos = [], starPhase = [], starBright = [];
  for (let i = 0; i < 1600; i++) {
    const u = rng() * Math.PI * 2, v = 0.08 + Math.pow(rng(), 0.7) * 1.4;
    const r = 480;
    starPos.push(Math.cos(u) * Math.cos(v) * r, Math.sin(v) * r, Math.sin(u) * Math.cos(v) * r);
    starPhase.push(rng());
    starBright.push(Math.pow(rng(), 3) * 0.9 + 0.1);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  starGeo.setAttribute('phase', new THREE.Float32BufferAttribute(starPhase, 1));
  starGeo.setAttribute('bright', new THREE.Float32BufferAttribute(starBright, 1));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { uTime: time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  stars.renderOrder = -9;
  scene.add(stars);

  const moonMat = new THREE.MeshBasicMaterial({ map: tex('moon'), fog: false });
  moonMat.color.setRGB(1.7, 1.65, 1.5);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 32, 20), moonMat);
  moon.position.copy(moonDir).multiplyScalar(440);
  scene.add(moon);
  const moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture('rgba(200,215,255,0.55)', 'rgba(120,140,200,0)'), blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  moonHalo.position.copy(moon.position);
  moonHalo.scale.setScalar(150);
  scene.add(moonHalo);

  const clouds = [];
  const cloudMat = new THREE.SpriteMaterial({ alphaMap: tex('mist', { color: false }), color: 0x2a3554, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  for (let i = 0; i < 10; i++) {
    const c = new THREE.Sprite(cloudMat);
    const a = -2.4 + rng() * 1.8;
    c.position.set(Math.cos(a) * 380, 110 + rng() * 120, Math.sin(a) * 380);
    c.scale.set(200 + rng() * 160, 60 + rng() * 40, 1);
    c.userData.speed = 1.5 + rng() * 2;
    scene.add(c);
    clouds.push(c);
  }

  // ---------- Lights ----------
  scene.add(new THREE.HemisphereLight(0x5a6c9c, 0x10140c, 0.7));
  const moonLight = new THREE.DirectionalLight(0xb0c0f0, 1.0);
  moonLight.position.copy(moonDir).multiplyScalar(120);
  moonLight.castShadow = quality !== 'low';
  const shadowRes = quality === 'high' ? 2048 : 1024;
  moonLight.shadow.mapSize.set(shadowRes, shadowRes);
  const sc = moonLight.shadow.camera;
  sc.left = -85; sc.right = 85; sc.top = 85; sc.bottom = -85; sc.near = 10; sc.far = 300;
  moonLight.shadow.bias = -0.0008;
  moonLight.shadow.normalBias = 0.04;
  scene.add(moonLight);

  // ---------- Ground ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), Mt.grass);
  const guv = ground.geometry.attributes.uv;
  for (let i = 0; i < guv.count; i++) guv.setXY(i, guv.getX(i) * 400, guv.getY(i) * 400);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  colliders.push(new Box(-200, -2, -200, 200, 0, 200, 'ground'));
  groundPatch(Mt.gravel, 0, 0, 110, 110, 0.01);
  const gardenGrass = texturedMaterial('grass', 4, { roughness: 1, color: 0xb8d0a0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  groundPatch(gardenGrass, 0, -40.5, 35, 28, 0.02);
  groundPatch(Mt.road, 0, 75, 40, 7, 0.02, Math.PI / 2);
  groundPatch(Mt.road, 0, 22, 66, 7, 0.02, Math.PI / 2);

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
  solid(-5, 0, W, 1.4, 5.5, 1.6, Mt.darkWood, { tag: 'wood' });
  solid(5, 0, W, 1.4, 5.5, 1.6, Mt.darkWood, { tag: 'wood' });
  solid(0, 5.5, W, 12, 0.6, 2, Mt.darkWood, { tag: 'wood' });
  roof(0, 6.1, W, 12, 2.4, 1.2);
  chochin(-3, 4.6, W + 1.1);
  chochin(3, 4.6, W + 1.1);

  // Vermilion torii on the approach road
  for (const s of [-1, 1]) {
    const post = new THREE.CylinderGeometry(0.24, 0.28, 5.2, 12);
    post.translate(s * 3.2, 2.6, 68);
    add(Mt.vermilion, post);
    colliders.push(new Box(s * 3.2 - 0.3, 0, 67.7, s * 3.2 + 0.3, 5.2, 68.3, 'wood'));
    solid(s * 3.2, 0, 68, 0.75, 0.4, 0.75, Mt.black, { collide: false });
  }
  solid(0, 4.2, 68, 7.6, 0.35, 0.4, Mt.vermilion, { collide: false });
  solid(0, 5.15, 68, 9.4, 0.4, 0.6, Mt.black, { collide: false });
  solid(0, 5.0, 68, 8.6, 0.2, 0.5, Mt.vermilion, { collide: false });

  // ---------- Outside: forest cover near the start ----------
  for (let i = 0; i < 46; i++) {
    const x = (rng() - 0.5) * 170;
    const z = 60 + rng() * 32;
    if (Math.abs(x) < 9 && z < 86) continue; // keep the road clear
    if (x > -40 && x < -8 && z < 70) continue; // keep the outer patrol route clear
    pine(x, z, 0.9 + rng() * 0.5);
  }
  for (let i = 0; i < 40; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    pine(side * (62 + rng() * 28), (rng() - 0.5) * 150, 0.9 + rng() * 0.6);
  }
  for (let i = 0; i < 18; i++) pine((rng() - 0.5) * 170, -62 - rng() * 28, 1 + rng() * 0.5);
  bamboo(18, 64); bamboo(24, 70, 10); bamboo(-48, 72, 12);
  for (let i = 0; i < 30; i++) {
    const x = (rng() - 0.5) * 180, z = 58 + rng() * 34;
    if (Math.abs(x) > 8) rock(x, z, 0.3 + rng() * 0.5);
  }
  crate(-9, 60); crate(-10.3, 60.2, 1); crate(9.5, 61);

  // ---------- Inside the compound ----------
  house(-35, 35, 10, 8, 4, { lit: true });
  house(-15, 38, 8, 7, 3.5);
  house(14, 36, 12, 8, 4, { lit: true });
  house(38, 30, 8, 10, 3.5);
  house(-38, 5, 9, 12, 4.5, { lit: true });
  house(38, 0, 10, 10, 4);
  house(-20, 10, 7, 7, 3, { paperLanterns: false });
  house(18, 12, 8, 6, 3, { lit: true });
  house(-38, -25, 10, 8, 4);
  house(38, -28, 9, 9, 4, { lit: true });

  tower(-48, 48); tower(48, 48); tower(-48, -48); tower(48, -48);

  // The keep: three stacked tiers with skirt roofs
  solid(0, 0, -18, 22.4, 2.4, 14.4, Mt.stoneWall, { collide: false });
  solid(0, 0, -18, 22, 6, 14, Mt.houseLit, { tag: 'wood' });
  roof(0, 6, -18, 22, 14, 0.8, { ridge: false });
  solid(0, 6, -18, 14, 4.5, 9, Mt.houseLit, { tag: 'wood' });
  roof(0, 10.5, -18, 14, 9, 0.7, { ridge: false });
  solid(0, 10.5, -18, 8, 3.5, 5, Mt.houseWall, { tag: 'wood' });
  roof(0, 14, -18, 8, 5, 2.2);
  solid(0, 0, -10.9, 5, 4, 0.3, Mt.darkWood, { collide: false });
  // Golden roof fish on the keep
  for (const s of [-1, 1]) {
    const fish = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0xe0b040, metalness: 0.9, roughness: 0.3, emissive: 0x302000 }));
    fish.position.set(s * 2.4, 16.6, -18);
    fish.rotation.z = s * 0.4;
    scene.add(fish);
  }
  chochin(-2.5, 3.2, -10.4);
  chochin(2.5, 3.2, -10.4);

  // Inner garden walls
  wall(-18, -26, -18, -54.4, 3.2, 0.9);
  wall(18, -26, 18, -54.4, 3.2, 0.9);
  wall(-18, -26, -14, -26, 3.2, 0.9);
  wall(14, -26, 18, -26, 3.2, 0.9);

  // Garden: pond, pavilion, blossoms
  const pond = new THREE.Mesh(new THREE.CircleGeometry(5, 40), Mt.water);
  pond.rotation.x = -Math.PI / 2;
  pond.scale.set(1.4, 1, 1);
  pond.position.set(-2, 0.04, -37);
  pond.receiveShadow = true;
  scene.add(pond);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2;
    rock(-2 + Math.cos(a) * 7.2, -37 + Math.sin(a) * 5.15, 0.3 + rng() * 0.25);
  }
  for (let i = 0; i < 9; i++) {
    const lp = new THREE.Mesh(new THREE.CircleGeometry(0.35 + rng() * 0.2, 12, 0.3, Math.PI * 1.8), Mt.lily);
    lp.rotation.set(-Math.PI / 2, 0, rng() * 6);
    lp.position.set(-2 + (rng() - 0.5) * 9, 0.06, -37 + (rng() - 0.5) * 6);
    scene.add(lp);
  }
  for (const [x, z] of [[-4, -50], [4, -50], [-4, -45], [4, -45]]) solid(x, 0.5, z, 0.3, 2.5, 0.3, Mt.vermilion, { collide: false });
  solid(0, 0, -47.5, 9.4, 0.5, 6.4, Mt.darkWood, { tag: 'wood' });
  roof(0, 3, -47.5, 9.4, 6.4, 1.4);
  cherry(-13, -32, 0.9); cherry(12, -36, 1); cherry(-12, -48, 1.1); cherry(13, -50, 0.9);
  solid(14, 0, -43, 1.8, 1, 1.4, Mt.stone); solid(-10, 0, -42, 1.2, 0.8, 1.2, Mt.stone);
  for (let i = 0; i < 5; i++) rock(4 + i * 0.9, -30 - i * 1.6, 0.35, -0.15);

  // Courtyard props for cover
  crate(-5, 25); crate(-6.2, 25.1, 1); crate(-5.5, 25, 1, 1.2);
  crate(8, 18); crate(9.3, 17.8, 1);
  crate(-28, -40); crate(-26.8, -40.3, 1); crate(30, -38);
  crate(-8, -2); crate(9, -1, 1.4);
  solid(-22, 0, 26, 6, 1.2, 1.2, Mt.stone);
  solid(26, 0, -6, 1.2, 1.2, 6, Mt.stone);
  pine(-10, 48, 1); pine(28, 48, 1); pine(-46, 20, 1.1); pine(46, 15, 1); pine(-23, -9, 1); pine(48, -12, 1);

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
  stoneLantern(3.5, -12.4, 6.15, 11);

  // ---------- Merge static scenery ----------
  for (const { mat, cast, geos } of buckets.values()) {
    const merged = mergeGeometries(geos.map((g) => { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); return g; }));
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }

  // ---------- Ambient life ----------
  const grassCount = { high: 14000, medium: 6000, low: 0 }[quality] ?? 6000;
  if (grassCount) scene.add(buildGrass(grassCount, colliders, time, rng));

  const ffPos = [], ffPhase = [];
  for (let i = 0; i < 90; i++) {
    const inGarden = i < 35;
    const x = inGarden ? (rng() - 0.5) * 30 : (rng() - 0.5) * 160;
    const z = inGarden ? -40 + (rng() - 0.5) * 24 : 60 + rng() * 30;
    ffPos.push(x, 0.8 + rng() * 2.2, z);
    ffPhase.push(rng());
  }
  const ffGeo = new THREE.BufferGeometry();
  ffGeo.setAttribute('position', new THREE.Float32BufferAttribute(ffPos, 3));
  ffGeo.setAttribute('phase', new THREE.Float32BufferAttribute(ffPhase, 1));
  const fireflies = new THREE.Points(ffGeo, new THREE.ShaderMaterial({
    vertexShader: FIREFLY_VERT, fragmentShader: FIREFLY_FRAG, uniforms: { uTime: time }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  fireflies.frustumCulled = false;
  scene.add(fireflies);

  const pOrigin = [], pPhase = [];
  for (const o of petalOrigins) {
    for (let i = 0; i < 22; i++) {
      pOrigin.push(o[0] + (rng() - 0.5) * 3, o[1] + rng(), o[2] + (rng() - 0.5) * 3);
      pPhase.push(rng());
    }
  }
  const petalGeo = new THREE.BufferGeometry();
  petalGeo.setAttribute('position', new THREE.Float32BufferAttribute(pOrigin, 3));
  petalGeo.setAttribute('origin', new THREE.Float32BufferAttribute(pOrigin, 3));
  petalGeo.setAttribute('phase', new THREE.Float32BufferAttribute(pPhase, 1));
  const petals = new THREE.Points(petalGeo, new THREE.ShaderMaterial({
    vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, uniforms: { uTime: time }, transparent: true, depthWrite: false,
  }));
  petals.frustumCulled = false;
  scene.add(petals);

  const mistTex = tex('mist', { color: false }).clone();
  mistTex.needsUpdate = true;
  const mistMat = new THREE.MeshBasicMaterial({ color: 0x4a5a80, alphaMap: mistTex, transparent: true, opacity: 0.13, depthWrite: false });
  if (quality !== 'low') {
    for (let i = 0; i < 9; i++) {
      const mist = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), mistMat);
      mist.rotation.x = -Math.PI / 2;
      mist.position.set((rng() - 0.5) * 150, 0.5 + rng() * 0.8, (rng() - 0.5) * 150);
      mist.renderOrder = 5;
      scene.add(mist);
    }
  }

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
    { type: 'archer', path: [[0, -12.2]], y: 6.3, face: 0, stationary: true },
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

  /** What the player is standing on, for footstep sounds. */
  function surfaceAt(pos, box) {
    if (box && box.tag !== 'ground') return box.tag;
    const inCompound = Math.abs(pos.x) < W && Math.abs(pos.z) < W;
    if (inCompound && !(Math.abs(pos.x) < 17.5 && pos.z < -27)) return 'gravel';
    if (Math.abs(pos.x) < 3.5 && pos.z > W) return 'gravel';
    return 'grass';
  }

  function update(t, dt) {
    time.value = t;
    for (const L of lanterns) {
      const n = Math.sin(t * 9 + L.seed) * 0.5 + Math.sin(t * 23 + L.seed * 2) * 0.3 + Math.sin(t * 4.3 + L.seed) * 0.2;
      const f = 1 + n * 0.08;
      L.light.intensity = 26 * f;
      L.glowMat.emissiveIntensity = 3 * f;
      L.halo.material.opacity = 0.5 * f;
    }
    for (const c of clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x > 420) c.position.x = -420;
    }
    mistTex.offset.x += dt * 0.004;
    mistTex.offset.y += dt * 0.002;
    Mt.water.bumpMap.offset.x += dt * 0.01;
    Mt.water.bumpMap.offset.y += dt * 0.006;
  }

  return {
    colliders,
    lanterns,
    lightAt,
    surfaceAt,
    update,
    guardDefs,
    pond: new THREE.Vector3(-2, 0, -37),
    spawn: { pos: new THREE.Vector3(0, 0, 80), yaw: Math.PI },
  };
}

function buildGrass(count, colliders, time, rng) {
  // One clump = several thin bent blades.
  const pos = [], col = [], nor = [];
  for (let b = 0; b < 7; b++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.22;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 0.28 + rng() * 0.32, w = 0.035;
    const ang = rng() * Math.PI;
    const dx = Math.cos(ang) * w, dz = Math.sin(ang) * w;
    const lean = (rng() - 0.5) * 0.25;
    pos.push(bx - dx, 0, bz - dz, bx + dx, 0, bz + dz, bx + lean, h, bz + lean * 0.5);
    col.push(0.02, 0.04, 0.015, 0.02, 0.04, 0.015, 0.09, 0.14, 0.05);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float sway = sin(uTime * 1.6 + wp.x * 0.3 + wp.z * 0.2) * 0.12 + sin(uTime * 3.7 + wp.x * 1.3) * 0.04;
      transformed.x += sway * position.y;
      transformed.z += sway * 0.5 * position.y;`);
  };

  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const solids = colliders.filter((c) => c.tag !== 'ground');
  let placed = 0, tries = 0;
  while (placed < count && tries < count * 4) {
    tries++;
    const x = (rng() - 0.5) * 190, z = (rng() - 0.5) * 190;
    const inCompound = Math.abs(x) < 55.5 && Math.abs(z) < 55.5;
    const inGarden = Math.abs(x) < 17 && z < -27 && z > -54;
    if (inCompound && !inGarden) continue;
    if (inGarden && (((x + 2) / 7.3) ** 2 + ((z + 37) / 5.3) ** 2 < 1 || (Math.abs(x) < 5.2 && z < -44 && z > -51))) continue;
    if (Math.abs(x) < 4.5 && z > 54) continue; // road
    p.set(x, 0.2, z);
    if (pointInBoxes(solids, p)) continue;
    q.setFromAxisAngle(up, rng() * Math.PI * 2);
    const k = 0.7 + rng() * 0.7;
    s.set(k, k * (0.8 + rng() * 0.5), k);
    p.y = 0;
    m.compose(p, q, s);
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}
