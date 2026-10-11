import * as THREE from 'three';

// GPU point particles plus a handful of one-off visual effects.

const VERT = `
  attribute float size;
  attribute vec4 tint;
  varying vec4 vTint;
  void main() {
    vTint = tint;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = `
  varying vec4 vTint;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vTint.rgb, vTint.a * a);
  }
`;

class ParticlePool {
  constructor(scene, capacity, blending) {
    this.cap = capacity;
    this.items = [];
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.tint = new Float32Array(capacity * 4);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('tint', new THREE.BufferAttribute(this.tint, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(p) {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push(p);
  }

  update(dt) {
    const items = this.items;
    let w = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy -= p.gravity * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02 && p.gravity > 0) { p.y = 0.02; p.vy *= -0.3; }
      items[w++] = p;
    }
    items.length = w;
    for (let i = 0; i < w; i++) {
      const p = items[i];
      const t = p.life / p.maxLife;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      this.size[i] = p.size * (p.grow ? 1 + (1 - t) * p.grow : 1);
      this.tint[i * 4] = p.r; this.tint[i * 4 + 1] = p.g; this.tint[i * 4 + 2] = p.b;
      this.tint[i * 4 + 3] = p.alpha * Math.min(1, t * 2);
    }
    this.geo.setDrawRange(0, w);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.size.needsUpdate = true;
    this.geo.attributes.tint.needsUpdate = true;
  }
}

const tmpColor = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.glow = new ParticlePool(scene, 3000, THREE.AdditiveBlending);
    this.smoke = new ParticlePool(scene, 1500, THREE.NormalBlending);
    this.transients = []; // { obj, life, update(dt, t) }
    this.flashPool = [];
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 1.5);
      scene.add(light);
      this.flashPool.push({ light, life: 0, maxLife: 1, intensity: 0 });
    }
  }

  burst(pos, { count = 20, color = 0xffffff, speed = 4, life = 0.6, size = 0.3, gravity = 0, drag = 2, spread = 1, up = 0, smoke = false, alpha = 1, grow = 0 } = {}) {
    tmpColor.set(color);
    const pool = smoke ? this.smoke : this.glow;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.6);
      const l = life * (0.6 + Math.random() * 0.4);
      pool.spawn({
        x: pos.x + (Math.random() - 0.5) * spread * 0.3,
        y: pos.y + (Math.random() - 0.5) * spread * 0.3,
        z: pos.z + (Math.random() - 0.5) * spread * 0.3,
        vx: Math.sin(v) * Math.cos(u) * s,
        vy: Math.cos(v) * s + up,
        vz: Math.sin(v) * Math.sin(u) * s,
        life: l, maxLife: l, size: size * (0.7 + Math.random() * 0.6),
        r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, alpha, gravity, drag, grow,
      });
    }
  }

  trail(pos, color, size = 0.25, life = 0.3) {
    tmpColor.set(color);
    this.glow.spawn({
      x: pos.x, y: pos.y, z: pos.z, vx: 0, vy: 0, vz: 0, life, maxLife: life, size,
      r: tmpColor.r, g: tmpColor.g, b: tmpColor.b, alpha: 0.9, gravity: 0, drag: 0, grow: 0,
    });
  }

  smokePuff(pos, scale = 1) {
    this.burst(pos, { count: Math.round(28 * scale), color: 0xd8d8d8, speed: 3 * scale, life: 1.0, size: 1.4 * scale, drag: 3, spread: 1.5, smoke: true, alpha: 0.75, grow: 1.5, up: 0.6 });
  }

  /** Expanding flat ring on the ground. */
  shockwave(pos, color = 0xffffff, radius = 6, life = 0.45) {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40),
      new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(pos.x, pos.y + 0.1, pos.z);
    this.scene.add(mesh);
    this.add(mesh, life, (t) => {
      mesh.scale.setScalar(0.5 + t * radius);
      mesh.material.opacity = 1 - t;
    });
  }

  /** Jagged lightning bolt between two points. */
  bolt(a, b, color = 0x9fd8ff, life = 0.12) {
    const pts = [];
    const n = 8;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const j = i === 0 || i === n ? 0 : 0.45;
      pts.push(new THREE.Vector3(
        a.x + (b.x - a.x) * t + (Math.random() - 0.5) * j,
        a.y + (b.y - a.y) * t + (Math.random() - 0.5) * j,
        a.z + (b.z - a.z) * t + (Math.random() - 0.5) * j,
      ));
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending }),
    );
    this.scene.add(line);
    this.add(line, life, (t) => { line.material.opacity = 1 - t; });
  }

  // Flash lights come from a fixed pool: adding/removing lights at runtime
  // would force every material to recompile and cause a hitch.
  flashLight(pos, color, intensity = 60, life = 0.4, distance = 18) {
    let slot = this.flashPool[0];
    for (const f of this.flashPool) if (f.life < slot.life) slot = f;
    slot.light.position.copy(pos);
    slot.light.color.set(color);
    slot.light.distance = distance;
    slot.intensity = intensity;
    slot.life = slot.maxLife = life;
    return slot;
  }

  add(obj, life, update) {
    this.transients.push({ obj, life, maxLife: life, update });
  }

  update(dt) {
    for (const f of this.flashPool) {
      f.life = Math.max(0, f.life - dt);
      f.light.intensity = f.intensity * (f.life / f.maxLife);
    }
    this.glow.update(dt);
    this.smoke.update(dt);
    this.transients = this.transients.filter((e) => {
      e.life -= dt;
      if (e.life <= 0) {
        this.scene.remove(e.obj);
        e.obj.geometry?.dispose();
        e.obj.material?.dispose();
        if (e.obj.dispose) e.obj.dispose();
        return false;
      }
      e.update(1 - e.life / e.maxLife, dt);
      return true;
    });
  }
}

/** Canvas-texture sprite used for the ? / ! markers above guards. */
export function makeMarker() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.scale.set(0.9, 0.9, 1);
  sprite.renderOrder = 10;
  let current = null;
  sprite.userData.set = (symbol, color) => {
    const key = symbol + color;
    if (key === current) return;
    current = key;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, 64, 64);
    if (symbol) {
      g.font = 'bold 56px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 6;
      g.strokeStyle = '#000';
      g.strokeText(symbol, 32, 34);
      g.fillStyle = color;
      g.fillText(symbol, 32, 34);
    }
    tex.needsUpdate = true;
  };
  return sprite;
}
