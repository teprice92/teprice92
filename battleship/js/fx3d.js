/* Fleet Command — 3D battle renderer (Three.js, loaded on demand).
 *
 * FC.Board3D has the same interface as the 2D FC.Board (setView, aim,
 * cellAt, clearFx and the effect methods that return Promises), so the
 * battle controller can use either one. One grid cell is one world unit;
 * the board sits on an animated Gerstner-wave ocean under a physical sky.
 */
(function (FC) {
  'use strict';

  var THREE = null, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, Sky;

  FC.webglOK = function () {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
    } catch (e) { return false; }
  };

  FC.load3D = function () {
    if (FC._load3d) return FC._load3d;
    FC._load3d = Promise.all([
      import('three'),
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
      import('three/addons/objects/Sky.js')
    ]).then(function (m) {
      THREE = m[0];
      EffectComposer = m[1].EffectComposer; RenderPass = m[2].RenderPass;
      UnrealBloomPass = m[3].UnrealBloomPass; OutputPass = m[4].OutputPass; Sky = m[5].Sky;
      FC.Board3D = Board3D;
      return true;
    }).catch(function (e) {
      console.warn('3D graphics unavailable:', e);
      FC._load3d = null;
      return false;
    });
    return FC._load3d;
  };

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var Sound = FC.Sound;

  // ---- per-map lighting moods ---------------------------------------------------
  var MOODS = {
    open:  { elev: 7,  azim: 35, turb: 6,  ray: 2.2, exp: 0.55, deep: '#062c42', shallow: '#17607a', sky: '#9db7c4', fog: '#b4a596', sun: '#ffd2a0', sunI: 2.6, hemi: 0.9 },
    arch:  { elev: 32, azim: 320, turb: 4,  ray: 1.4, exp: 0.42, deep: '#044a58', shallow: '#1c8f98', sky: '#a6d0e2', fog: '#bcd6df', sun: '#fff3df', sunI: 2.8, hemi: 1.1 },
    mines: { elev: 14, azim: 40, turb: 10, ray: 1.0, exp: 0.4,  deep: '#103a48', shallow: '#2a6670', sky: '#8ea2aa', fog: '#9aa8ad', sun: '#f4ead8', sunI: 2.0, hemi: 1.0 },
    storm: { elev: 4,  azim: 300, turb: 20, ray: 0.3, exp: 0.55, deep: '#0f2431', shallow: '#2a4f60', sky: '#66747e', fog: '#56636c', sun: '#d5dde6', sunI: 1.8, hemi: 1.6 },
    deep:  { elev: 1.5, azim: 330, turb: 3,  ray: 3.0, exp: 0.6,  deep: '#06203a', shallow: '#164a72', sky: '#3e5a86', fog: '#25344e', sun: '#b8ccff', sunI: 2.2, hemi: 1.5 }
  };

  // Ocean waves: [dirX, dirZ, steepness, wavelength]. Mirrored in the shader.
  var WAVES = [[1, 0.3, 0.08, 9], [0.4, 1, 0.07, 5.5], [-0.7, 0.5, 0.06, 3.1], [0.2, -1, 0.04, 1.7]];
  function waveAt(x, z, t) {
    var y = 0, tx = 1, ty = 0, tz = 0, bx = 0, by = 0, bz = 1;
    for (var k = 0; k < WAVES.length; k++) {
      var w = WAVES[k], kk = 6.2831853 / w[3], c = Math.sqrt(9.8 / kk), len = Math.hypot(w[0], w[1]);
      var dx = w[0] / len, dz = w[1] / len, f = kk * (dx * x + dz * z - c * t * 0.35), a = w[2] / kk;
      y += a * Math.sin(f);
      tx += -dx * dx * w[2] * Math.sin(f); ty += dx * w[2] * Math.cos(f); tz += -dx * dz * w[2] * Math.sin(f);
      bx += -dx * dz * w[2] * Math.sin(f); by += dz * w[2] * Math.cos(f); bz += -dz * dz * w[2] * Math.sin(f);
    }
    // normal = b × t
    var nx = by * tz - bz * ty, ny = bz * tx - bx * tz, nz = bx * ty - by * tx, nl = Math.hypot(nx, ny, nz);
    return { y: y, nx: nx / nl, ny: ny / nl, nz: nz / nl };
  }

  var WATER_VS = [
    'uniform float uTime;',
    'varying vec3 vWorld; varying vec2 vBase; varying float vH;',
    'vec3 gerst(vec4 w, vec3 p, inout vec3 t, inout vec3 b) {',
    '  float k = 6.2831853 / w.w; float c = sqrt(9.8 / k); vec2 d = normalize(w.xy);',
    '  float f = k * (dot(d, p.xz) - c * uTime * 0.35); float a = w.z / k;',
    '  t += vec3(-d.x * d.x * (w.z * sin(f)), d.x * (w.z * cos(f)), -d.x * d.y * (w.z * sin(f)));',
    '  b += vec3(-d.x * d.y * (w.z * sin(f)), d.y * (w.z * cos(f)), -d.y * d.y * (w.z * sin(f)));',
    '  return vec3(d.x * (a * cos(f)), a * sin(f), d.y * (a * cos(f)));',
    '}',
    'void main() {',
    '  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;',
    '  vec3 t = vec3(1.0, 0.0, 0.0), b = vec3(0.0, 0.0, 1.0), q = p;',
    '  q += gerst(vec4(1.0, 0.3, 0.08, 9.0), p, t, b);',
    '  q += gerst(vec4(0.4, 1.0, 0.07, 5.5), p, t, b);',
    '  q += gerst(vec4(-0.7, 0.5, 0.06, 3.1), p, t, b);',
    '  q += gerst(vec4(0.2, -1.0, 0.04, 1.7), p, t, b);',
    '  vBase = p.xz; vWorld = q; vH = q.y;',
    '  gl_Position = projectionMatrix * viewMatrix * vec4(q, 1.0);',
    '}'
  ].join('\n');

  var WATER_FS = [
    'uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uFog;',
    'uniform float uTime; uniform float uFogNear; uniform float uFogFar;',
    'varying vec3 vWorld; varying vec2 vBase; varying float vH;',
    'void gn(vec4 w, vec2 p, inout vec3 t, inout vec3 b) {',
    '  float k = 6.2831853 / w.w; float c = sqrt(9.8 / k); vec2 d = normalize(w.xy);',
    '  float f = k * (dot(d, p) - c * uTime * 0.35);',
    '  t += vec3(-d.x * d.x * (w.z * sin(f)), d.x * (w.z * cos(f)), -d.x * d.y * (w.z * sin(f)));',
    '  b += vec3(-d.x * d.y * (w.z * sin(f)), d.y * (w.z * cos(f)), -d.y * d.y * (w.z * sin(f)));',
    '}',
    'void main() {',
    '  vec2 uv = vWorld.xz;',
    '  vec3 t = vec3(1.0, 0.0, 0.0), b = vec3(0.0, 0.0, 1.0);',
    '  gn(vec4(1.0, 0.3, 0.08, 9.0), vBase, t, b); gn(vec4(0.4, 1.0, 0.07, 5.5), vBase, t, b);',
    '  gn(vec4(-0.7, 0.5, 0.06, 3.1), vBase, t, b); gn(vec4(0.2, -1.0, 0.04, 1.7), vBase, t, b);',
    '  vec3 n = normalize(cross(b, t));',
    '  float r1 = sin(uv.x * 3.1 + uTime * 1.3) * cos(uv.y * 2.7 - uTime * 1.1);',
    '  float r2 = sin(uv.x * 1.7 - uv.y * 4.3 + uTime * 1.7) * cos(uv.y * 1.3 + uTime * 0.7);',
    '  float r3 = cos(uv.x * 6.1 + sin(uv.y * 2.0) * 2.0 - uTime * 2.2);',
    '  n = normalize(n + vec3(r1 * 0.04 + r3 * 0.015, 0.0, r2 * 0.035));',
    '  vec3 V = normalize(cameraPosition - vWorld);',
    '  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);',
    '  vec3 col = mix(uDeep, uShallow, clamp(vH * 3.0 + 0.45, 0.0, 1.0));',
    '  col = mix(col, uSky, clamp(fres * 0.45, 0.0, 1.0));',
    '  vec3 H = normalize(uSunDir + V);',
    '  float nh = max(dot(n, H), 0.0);',
    '  col += uSunColor * (pow(nh, 400.0) * 1.4 + pow(nh, 30.0) * 0.06);',
    '  float foam = smoothstep(0.1, 0.17, vH) * (0.6 + 0.4 * sin(uv.x * 1.3 + uTime * 0.8) * cos(uv.y * 1.1 - uTime * 0.5));',
    '  col = mix(col, vec3(0.8, 0.88, 0.92), foam * 0.22);',
    '  float d = length(vWorld.xz);',
    '  col = mix(col, uFog, smoothstep(uFogNear, uFogFar, d));',
    '  gl_FragColor = vec4(col, 1.0);',
    '  #include <tonemapping_fragment>',
    '  #include <colorspace_fragment>',
    '}'
  ].join('\n');

  var PART_VS = [
    'attribute float psize; attribute vec4 pcolor; uniform float uScale; varying vec4 vC;',
    'void main() {',
    '  vC = pcolor;',
    '  vec4 mv = modelViewMatrix * vec4(position, 1.0);',
    '  gl_PointSize = psize * uScale / max(0.1, -mv.z);',
    '  gl_Position = projectionMatrix * mv;',
    '}'
  ].join('\n');
  var PART_FS = [
    'varying vec4 vC; uniform float uAdd;',
    'void main() {',
    '  float d = length(gl_PointCoord - 0.5);',
    '  float a = smoothstep(0.5, 0.0, d) * vC.a;',
    '  if (a < 0.003) discard;',
    '  gl_FragColor = uAdd > 0.5 ? vec4(vC.rgb * a, a) : vec4(vC.rgb, a);',
    '}'
  ].join('\n');

  var SHIELD_FS = [
    'uniform float uTime; uniform float uPulse; varying vec3 vN; varying vec3 vP; varying vec3 vV;',
    'void main() {',
    '  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.5);',
    '  vec2 h = vP.xz * 6.0 + vec2(0.0, vP.y * 6.0);',
    '  float hex = abs(sin(h.x + sin(h.y * 0.5)) * sin(h.y)) ;',
    '  float lines = smoothstep(0.92, 1.0, hex);',
    '  float a = fres * 0.7 + lines * 0.25 + uPulse * 0.4 + 0.04 * sin(uTime * 3.0 + vP.y * 10.0);',
    '  gl_FragColor = vec4(vec3(0.45, 0.78, 1.0) * a, a);',
    '}'
  ].join('\n');
  var SHIELD_VS = [
    'varying vec3 vN; varying vec3 vP; varying vec3 vV;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4(position, 1.0);',
    '  vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = cameraPosition - wp.xyz;',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}'
  ].join('\n');

  // ---- particles ------------------------------------------------------------------
  function Particles(cap, additive) {
    this.cap = cap;
    this.list = [];
    var g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3); this.col = new Float32Array(cap * 4); this.size = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('psize', new THREE.BufferAttribute(this.size, 1));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 400 }, uAdd: { value: additive ? 1 : 0 } },
      vertexShader: PART_VS, fragmentShader: PART_FS,
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 19;
  }
  Particles.prototype.add = function (p) {
    if (this.list.length >= this.cap) return;
    p.age = 0; this.list.push(p);
  };
  Particles.prototype.update = function (dt) {
    var L = this.list, n = 0;
    for (var k = L.length - 1; k >= 0; k--) {
      var p = L[k];
      p.age += dt;
      if (p.age >= p.life) { L.splice(k, 1); continue; }
      p.vy -= (p.g || 0) * dt;
      var dr = p.drag ? Math.pow(p.drag, dt * 60) : 1;
      p.vx *= dr; p.vy *= dr; p.vz *= dr;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (k = 0; k < L.length; k++) {
      p = L[k];
      var f = p.age / p.life, c = PALETTE[p.kind](f, p);
      this.pos[n * 3] = p.x; this.pos[n * 3 + 1] = p.y; this.pos[n * 3 + 2] = p.z;
      this.col[n * 4] = c[0]; this.col[n * 4 + 1] = c[1]; this.col[n * 4 + 2] = c[2]; this.col[n * 4 + 3] = c[3];
      this.size[n] = c[4];
      n++;
    }
    this.geo.setDrawRange(0, n);
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
  };
  Particles.prototype.clear = function () { this.list = []; this.geo.setDrawRange(0, 0); };

  // [r, g, b, a, size] by kind and life fraction
  var PALETTE = {
    fire: function (f, p) { var a = 1 - f; return f < 0.25 ? [1.6, 1.25, 0.6, a, p.s * (0.6 + f * 2)] : f < 0.6 ? [1.4, 0.55, 0.12, a * 0.9, p.s * (1.1 - f * 0.3)] : [0.5, 0.15, 0.05, a * 0.6, p.s * (1 - f * 0.5)]; },
    flash: function (f, p) { return [2.0, 1.7, 1.2, 1 - f, p.s * (0.6 + f)]; },
    spark: function (f, p) { return [1.8, 1.3, 0.6, 1 - f, p.s]; },
    green: function (f, p) { return [0.4, 1.4, 0.6, 1 - f, p.s]; },
    cyan: function (f, p) { return [0.4, 1.1, 1.3, 1 - f, p.s * (1 + f)]; },
    smoke: function (f, p) { return [0.09, 0.09, 0.1, (1 - f) * 0.45 * Math.min(1, f * 6), p.s * (0.6 + f * 2.4)]; },
    steam: function (f, p) { return [0.6, 0.62, 0.66, (1 - f) * 0.25, p.s * (0.6 + f * 2)]; },
    water: function (f, p) { return [0.82, 0.92, 0.98, (1 - f) * 0.9, p.s * (1 - f * 0.3)]; },
    debris: function (f, p) { return [0.05, 0.05, 0.05, 1 - f * 0.5, p.s]; },
    bubble: function (f, p) { return [0.8, 0.92, 1.0, (1 - f) * 0.7, p.s * (1 + f)]; }
  };

  // ---- materials & geometry helpers --------------------------------------------------
  var M = null;
  function mats() {
    if (M) return M;
    var std = function (c, o) { return new THREE.MeshStandardMaterial(Object.assign({ color: c, metalness: 0.35, roughness: 0.55 }, o || {})); };
    M = {
      deck: std('#5d6873', { roughness: 0.8 }),
      deckDark: std('#3a4550', { roughness: 0.85 }),
      sup: std('#bcc7cf', { metalness: 0.25, roughness: 0.5 }),
      supHi: std('#d6dee3', { metalness: 0.2, roughness: 0.45 }),
      dark: std('#2c343b', { metalness: 0.5, roughness: 0.5 }),
      gun: std('#4a535d', { metalness: 0.6, roughness: 0.4 }),
      win: new THREE.MeshStandardMaterial({ color: '#1c2a36', emissive: '#ffcf7a', emissiveIntensity: 0.35, roughness: 0.3 }),
      brass: std('#d9b25a', { metalness: 0.8, roughness: 0.35 }),
      white: std('#e8ecef', { metalness: 0.1, roughness: 0.6 }),
      teal: new THREE.MeshStandardMaterial({ color: '#2a6a70', emissive: '#4fd1c5', emissiveIntensity: 0.6 }),
      red: new THREE.MeshStandardMaterial({ color: '#7a1a10', emissive: '#ff4a2a', emissiveIntensity: 1.2 }),
      sand: std('#cdb47a', { metalness: 0, roughness: 0.95 }),
      grass: std('#4f7f40', { metalness: 0, roughness: 0.9 }),
      grassDark: std('#3b6532', { metalness: 0, roughness: 0.9 }),
      rock: std('#6b6a64', { metalness: 0, roughness: 0.95 }),
      trunk: std('#6b4b2d', { metalness: 0, roughness: 0.9 }),
      peg: std('#f2f5f7', { metalness: 0.05, roughness: 0.35 }),
      pegHit: new THREE.MeshStandardMaterial({ color: '#c0281a', emissive: '#ff3a1a', emissiveIntensity: 0.8, roughness: 0.35 })
    };
    return M;
  }
  var hullMats = {}, charred = new Map(), ghosts = new Map();
  function hullMat(cls) {
    if (!hullMats[cls]) hullMats[cls] = new THREE.MeshStandardMaterial({ color: FC.SHIPS[cls].hull, metalness: 0.45, roughness: 0.5 });
    return hullMats[cls];
  }
  function charMat(m) {
    if (!charred.has(m)) {
      var c = m.clone();
      c.color = m.color.clone().multiplyScalar(0.22).lerp(new THREE.Color('#2a120a'), 0.35);
      if (c.emissive) { c.emissive = new THREE.Color('#000000'); c.emissiveIntensity = 0; }
      c.roughness = 0.95; c.metalness = 0.1;
      charred.set(m, c);
    }
    return charred.get(m);
  }
  function ghostMat(m) {
    if (!ghosts.has(m)) {
      var c = m.clone(); c.transparent = true; c.opacity = 0.5; c.depthWrite = false;
      ghosts.set(m, c);
    }
    return ghosts.get(m);
  }

  function box(g, w, h, d, mat, x, y, z) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x || 0, (y || 0) + h / 2, z || 0); g.add(m); return m;
  }
  function cyl(g, rt, rb, h, mat, x, y, z, seg) {
    var m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 14), mat);
    m.position.set(x || 0, (y || 0) + h / 2, z || 0); g.add(m); return m;
  }

  var DECK = 0.15;
  function hullShape(L, B, round) {
    var s = new THREE.Shape(), x0 = -L / 2, x1 = L / 2, h = B / 2;
    if (round) {
      s.absellipse(0, 0, L / 2, h, 0, Math.PI * 2, false, 0);
      return s;
    }
    s.moveTo(x0 + 0.08, -h);
    s.lineTo(x1 - 0.42, -h);
    s.quadraticCurveTo(x1 - 0.08, -h, x1, 0);
    s.quadraticCurveTo(x1 - 0.08, h, x1 - 0.42, h);
    s.lineTo(x0 + 0.08, h);
    s.quadraticCurveTo(x0, h, x0, h - 0.08);
    s.lineTo(x0, -h + 0.08);
    s.quadraticCurveTo(x0, -h, x0 + 0.08, -h);
    return s;
  }
  function hull(g, cls, L, B) {
    var geo = new THREE.ExtrudeGeometry(hullShape(L, B), { depth: DECK + 0.08, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2, curveSegments: 10 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -0.08, 0);
    var m = new THREE.Mesh(geo, [M.deck, hullMat(cls)]);
    g.add(m);
    // waterline stripe
    var wl = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape(L + 0.012, B + 0.012), { depth: 0.025, bevelEnabled: false, curveSegments: 10 }), M.dark);
    wl.geometry.rotateX(-Math.PI / 2); wl.geometry.translate(0, -0.005, 0);
    g.add(wl);
    return m;
  }
  function turret(g, x, dir, r, n, len) {
    var t = new THREE.Group();
    cyl(t, r, r * 1.08, 0.05, M.gun, 0, 0, 0, 18);
    var houseGeo = new THREE.SphereGeometry(r * 0.95, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    var house = new THREE.Mesh(houseGeo, M.gun); house.scale.set(1.15, 0.55, 1); house.position.y = 0.05; t.add(house);
    for (var k = 0; k < n; k++) {
      var b = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.014, len, 8), M.dark);
      b.rotation.z = Math.PI / 2;
      b.position.set(dir * (r + len / 2 - 0.02), 0.07, (k - (n - 1) / 2) * 0.034);
      t.add(b);
    }
    t.position.set(x, DECK, 0);
    g.add(t);
    return t;
  }
  function bridge(g, x, w, d, levels) {
    var y = DECK;
    for (var k = 0; k < levels; k++) {
      var ww = w * (1 - k * 0.2), dd = d * (1 - k * 0.15), h = 0.07;
      box(g, ww, h, dd, k ? M.supHi : M.sup, x - k * 0.02, y, 0);
      box(g, 0.012, 0.025, dd * 0.82, M.win, x + ww / 2, y + 0.035, 0);
      y += h;
    }
    return y;
  }
  function mast(g, x, y, h, spin) {
    cyl(g, 0.008, 0.012, h, M.dark, x, y, 0, 6);
    box(g, 0.012, 0.012, 0.16, M.dark, x, y + h * 0.7, 0);
    if (spin) box(g, 0.02, 0.02, 0.12, M.supHi, x, y + h, 0).userData.spin = true;
  }
  function funnel(g, x, y) {
    cyl(g, 0.045, 0.055, 0.14, M.sup, x, y, 0);
    cyl(g, 0.046, 0.046, 0.025, M.dark, x, y + 0.14, 0).userData.funnelTop = true;
  }
  function jet(scale) {
    var j = new THREE.Group();
    var body = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.16, 8), M.supHi); body.rotation.z = -Math.PI / 2; j.add(body);
    var wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.006, 0.14), M.supHi); wing.position.x = -0.01; j.add(wing);
    var tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.006), M.supHi); tail.position.set(-0.07, 0.02, 0); j.add(tail);
    j.scale.setScalar(scale || 1);
    return j;
  }

  var shipCache = {};
  function buildShip(cls) {
    mats();
    var size = FC.SHIPS[cls].size, L = size * 0.94, B = cls === 'PT' ? 0.4 : 0.5;
    var g = new THREE.Group(), k;
    var x0 = -L / 2, x1 = L / 2;
    if (cls === 'SS') {
      var body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, L - 0.36, 8, 18), hullMat('SS'));
      body.rotation.z = Math.PI / 2; body.scale.set(1, 1, 0.9); body.position.y = 0.03; g.add(body);
      var sail = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.16, 4, 12), M.dark);
      sail.rotation.z = Math.PI / 2; sail.scale.set(1, 2.2, 0.8); sail.position.set(0.1, 0.2, 0); g.add(sail);
      box(g, 0.1, 0.01, 0.34, M.dark, 0.12, 0.25, 0);
      box(g, 0.08, 0.01, 0.42, M.dark, x0 + 0.12, 0.1, 0);
      box(g, 0.08, 0.16, 0.01, M.dark, x0 + 0.1, 0.06, 0);
      mast(g, 0.06, 0.32, 0.12, false);
      g.userData = { funnels: [] };
      return g;
    }
    hull(g, cls, L, B);
    switch (cls) {
      case 'CV':
        var fd = new THREE.Mesh(new THREE.ExtrudeGeometry(hullShape(L * 0.98, 0.62), { depth: 0.03, bevelEnabled: false, curveSegments: 8 }), M.deckDark);
        fd.geometry.rotateX(-Math.PI / 2); fd.position.y = DECK + 0.01; g.add(fd);
        for (k = 0; k < 9; k++) box(g, 0.14, 0.004, 0.018, M.white, x0 + 0.35 + k * 0.42, DECK + 0.04, 0);
        box(g, 2.6, 0.004, 0.012, M.white, 0.1, DECK + 0.04, 0.12).rotation.y = 0.12;
        var isl = new THREE.Group();
        var top = bridge(isl, 0, 0.4, 0.12, 3);
        mast(isl, -0.05, top, 0.18, true); funnel(isl, 0.12, DECK + 0.07);
        isl.position.set(0.7, 0.04, -0.26); g.add(isl);
        for (k = 0; k < 5; k++) { var j = jet(1); j.position.set(x0 + 0.5 + k * 0.32, DECK + 0.06, k % 2 ? 0.14 : -0.1); j.rotation.y = 0.4; g.add(j); }
        break;
      case 'BB': case 'DN':
        var big = cls === 'DN', yb = bridge(g, -0.15, big ? 0.9 : 0.7, 0.3, big ? 4 : 3);
        mast(g, -0.2, yb, 0.3, true);
        funnel(g, 0.25, DECK); if (big) funnel(g, 0.42, DECK);
        var fore = big ? [1.15, 1.6] : [0.85, 1.3], aft = big ? [-1.2, -1.65] : [-1.05];
        fore.forEach(function (x, n) { turret(g, x, 1, big ? 0.13 : 0.12, 3, 0.34).position.y += n ? 0.03 : 0; });
        aft.forEach(function (x, n) { turret(g, x, -1, big ? 0.13 : 0.12, big ? 3 : 2, 0.32).position.y += n ? 0 : 0.03; });
        break;
      case 'CA':
        var yc = bridge(g, -0.1, 0.5, 0.26, 3); mast(g, -0.15, yc, 0.24, true); funnel(g, 0.2, DECK);
        turret(g, 0.85, 1, 0.1, 2, 0.26); turret(g, -0.95, -1, 0.1, 2, 0.26);
        break;
      case 'AE':
        var ya = bridge(g, -0.25, 0.6, 0.3, 3);
        [[-0.05, 0.155], [-0.05, -0.155]].forEach(function (p) {
          var hx = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.01, 6), M.teal);
          hx.rotation.x = Math.PI / 2; hx.position.set(p[0], DECK + 0.12, p[1]); g.add(hx);
        });
        mast(g, -0.3, ya, 0.22, true);
        for (k = 0; k < 6; k++) box(g, 0.07, 0.02, 0.07, M.dark, 0.45 + (k % 3) * 0.09, DECK, k < 3 ? -0.05 : 0.05);
        turret(g, 1.05, 1, 0.07, 1, 0.2);
        break;
      case 'RT':
        var yr = bridge(g, -0.5, 0.45, 0.32, 3); mast(g, -0.55, yr, 0.2, true);
        cyl(g, 0.19, 0.19, 0.012, M.deckDark, x0 + 0.25, DECK, 0, 24);
        box(g, 0.012, 0.004, 0.14, M.white, x0 + 0.21, DECK + 0.013, 0); box(g, 0.012, 0.004, 0.14, M.white, x0 + 0.29, DECK + 0.013, 0); box(g, 0.08, 0.004, 0.012, M.white, x0 + 0.25, DECK + 0.013, 0);
        box(g, 0.28, 0.03, 0.32, M.deckDark, 0.25, DECK, 0); box(g, 0.28, 0.03, 0.32, M.deckDark, 0.62, DECK, 0);
        var crane = box(g, 0.6, 0.025, 0.025, M.brass, 0.6, DECK + 0.2, 0); crane.rotation.z = 0.45;
        cyl(g, 0.03, 0.04, 0.2, M.brass, 0.35, DECK, 0);
        break;
      case 'DD':
        var yd = bridge(g, -0.1, 0.4, 0.24, 2); mast(g, -0.15, yd, 0.2, true); funnel(g, 0.12, DECK);
        turret(g, 0.55, 1, 0.08, 1, 0.22);
        box(g, 0.28, 0.035, 0.05, M.dark, -0.55, DECK, 0.08); box(g, 0.28, 0.035, 0.05, M.dark, -0.55, DECK, -0.08);
        break;
      case 'ML':
        var ym = bridge(g, 0.15, 0.32, 0.26, 2); mast(g, 0.1, ym, 0.16, false);
        for (k = 0; k < 6; k++) {
          var mn = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), M.dark);
          mn.position.set(x0 + 0.15 + (k % 3) * 0.12, DECK + 0.045, k < 3 ? -0.1 : 0.1); g.add(mn);
        }
        turret(g, 0.62, 1, 0.06, 1, 0.16);
        break;
      case 'PT':
        var cab = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 4, 12), M.supHi);
        cab.rotation.z = Math.PI / 2; cab.scale.set(0.8, 1, 1.1); cab.position.set(-0.05, DECK + 0.05, 0); g.add(cab);
        box(g, 0.03, 0.05, 0.16, M.win, 0.12, DECK + 0.02, 0);
        turret(g, 0.5, 1, 0.05, 2, 0.14); turret(g, -0.65, -1, 0.05, 2, 0.14);
        break;
      case 'CO':
        cyl(g, 0.18, 0.18, 0.01, M.deckDark, x0 + 0.25, DECK, 0, 24);
        var yo = bridge(g, 0.05, 0.36, 0.26, 2); mast(g, 0.02, yo, 0.22, true);
        turret(g, 0.62, 1, 0.06, 1, 0.16);
        var heli = new THREE.Group();
        box(heli, 0.16, 0.05, 0.06, M.supHi, 0, 0, 0); box(heli, 0.3, 0.004, 0.02, M.dark, 0, 0.06, 0).rotation.y = 0.6;
        heli.position.set(x0 + 0.25, DECK + 0.012, 0); g.add(heli);
        break;
      case 'AR':
        var yar = bridge(g, x0 + 0.4, 0.45, 0.3, 3); mast(g, x0 + 0.35, yar, 0.22, true);
        for (k = 0; k < 16; k++) box(g, 0.17, 0.03, 0.1, M.dark, -0.6 + (k % 8) * 0.22, DECK, k < 8 ? -0.07 : 0.07);
        turret(g, 1.55, 1, 0.07, 1, 0.18);
        break;
    }
    void x1;
    // funnel tops, in ship coordinates, for the smoke emitters
    g.updateMatrixWorld(true);
    var funnels = [], wp = new THREE.Vector3();
    g.traverse(function (o) { if (o.userData.funnelTop) { o.getWorldPosition(wp); funnels.push([wp.x, wp.y + 0.03, wp.z]); } });
    g.userData = { funnels: funnels };
    return g;
  }
  function shipModel(cls) {
    if (!shipCache[cls]) shipCache[cls] = buildShip(cls);
    var g = shipCache[cls].clone(true), spin = [];
    g.traverse(function (o) { if (o.userData.spin) spin.push(o); });
    g.userData = { spin: spin, funnels: shipCache[cls].userData.funnels };
    return g;
  }
  function swapMats(g, fn) {
    g.traverse(function (o) {
      if (!o.isMesh) return;
      if (!o.userData.base) o.userData.base = o.material;
      var b = o.userData.base;
      o.material = fn ? (Array.isArray(b) ? b.map(fn) : fn(b)) : b;
    });
  }

  // ---- text sprites --------------------------------------------------------------
  var texCache = {};
  function textTexture(text, color, bg, px) {
    var key = text + '|' + color + '|' + bg + '|' + px;
    if (texCache[key]) return texCache[key];
    var c = document.createElement('canvas'), x = c.getContext('2d');
    var font = (px > 60 ? '' : '600 ') + px + 'px ' + (px > 60 ? '"Saira Stencil One", Impact, sans-serif' : '"IBM Plex Mono", monospace');
    x.font = font;
    var w = Math.ceil(x.measureText(text).width) + px * 0.8, h = Math.ceil(px * 1.5);
    if (bg) w = Math.max(w, h);
    c.width = w; c.height = h;
    x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
    if (bg) { x.fillStyle = bg; x.beginPath(); x.arc(w / 2, h / 2, h / 2 - 2, 0, Math.PI * 2); x.fill(); }
    else { x.lineWidth = px * 0.12; x.strokeStyle = 'rgba(2,10,16,0.85)'; x.strokeText(text, w / 2, h / 2); }
    x.fillStyle = color; x.fillText(text, w / 2, h / 2 + px * 0.04);
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.userData = { aspect: w / h };
    texCache[key] = t;
    return t;
  }
  function textSprite(text, color, bg, px, height) {
    var t = textTexture(text, color, bg, px);
    var s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false }));
    s.scale.set(height * t.userData.aspect, height, 1);
    s.renderOrder = 30;
    return s;
  }
  function radialTexture(inner, outer) {
    var c = document.createElement('canvas'); c.width = c.height = 128;
    var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ---- the board -----------------------------------------------------------------
  function Board3D(canvas) {
    mats();
    this.cv = canvas;
    this.opts = {};
    this.view = null;
    this.aim = null;
    this.drag = null;
    this.t = 0;
    this.fx = [];
    this.sinking = {};
    this.shakeT = 0; this.shakeMag = 0;
    this.quality = 'high';
    var r = this.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.hemi = new THREE.HemisphereLight('#bcd6e6', '#3a4a52', 1);
    this.sun = new THREE.DirectionalLight('#ffffff', 2);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.flashes = [];
    for (var k = 0; k < 4; k++) {
      var pl = new THREE.PointLight('#ffb060', 0, 7, 1.6);
      pl.userData.t = 0;
      this.scene.add(pl); this.flashes.push(pl);
    }
    this.fireP = new Particles(2200, true);
    this.smokeP = new Particles(1600, false);
    this.scene.add(this.fireP.points, this.smokeP.points);

    this.world = new THREE.Group(); this.scene.add(this.world);
    this.shipLayer = new THREE.Group(); this.scene.add(this.shipLayer);
    this.markLayer = new THREE.Group(); this.scene.add(this.markLayer);
    this.fxLayer = new THREE.Group(); this.scene.add(this.fxLayer);
    this.aimLayer = new THREE.Group(); this.scene.add(this.aimLayer);
    this.marks = {}; this.markKey = null; this.shipKey = null;

    this.glowTex = radialTexture('rgba(255,200,120,1)', 'rgba(255,90,20,0)');
    this.foamTex = radialTexture('rgba(255,255,255,0.55)', 'rgba(255,255,255,0)');
    this.buildAim();

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.35, 0.94);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    FC.Board.all.push(this);
    var self = this;
    if (window.ResizeObserver) new ResizeObserver(function () { self.layout(); }).observe(canvas);
    canvas.addEventListener('webglcontextlost', function (e) { e.preventDefault(); self.lost = true; });
    canvas.addEventListener('webglcontextrestored', function () { self.lost = false; });
  }

  Board3D.prototype.setQuality = function (q) {
    this.quality = q === 'lite' ? 'lite' : 'high';
    this.layout();
  };
  Board3D.prototype.isVisible = function () { return this.cv.offsetParent !== null; };
  Board3D.prototype.snd = function (n, big) { if (!this.opts.silent) Sound.play(n, big); };

  Board3D.prototype.layout = function () {
    var rect = this.cv.getBoundingClientRect();
    if (!rect.width) return;
    this.W = rect.width; this.H = rect.height || rect.width;
    var dpr = Math.min(window.devicePixelRatio || 1, this.quality === 'lite' ? 1 : 1.75);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(this.W, this.H, false);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(this.W, this.H);
    this.camera.aspect = this.W / this.H;
    this.fireP.mat.uniforms.uScale.value = this.H * dpr * 0.5;
    this.smokeP.mat.uniforms.uScale.value = this.H * dpr * 0.5;
    this.fitCamera();
  };

  // Pull the camera back until the whole board (with its labels) is in frame.
  Board3D.prototype.fitCamera = function () {
    if (!this.view) return;
    var N = this.view.size, half = N / 2 + 0.55, cam = this.camera, pitch = 58 * Math.PI / 180;
    var target = new THREE.Vector3(0, 0, 0.35);
    var dir = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    var corners = [[-half, -half], [half, -half], [-half, half], [half, half]].map(function (c) { return new THREE.Vector3(c[0], 0, c[1]); });
    var d = N * 0.8;
    for (var it = 0; it < 80; it++) {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      var ok = corners.every(function (p) { var v = p.clone().project(cam); return Math.abs(v.x) < 0.98 && Math.abs(v.y) < 0.97; });
      if (ok) break;
      d *= 1.04;
    }
    this.camBase = cam.position.clone();
    this.camTarget = target;
  };

  Board3D.prototype.pos = function (i, y) {
    var N = this.view.size;
    return new THREE.Vector3(i % N - (N - 1) / 2, y || 0, Math.floor(i / N) - (N - 1) / 2);
  };
  Board3D.prototype.center = function (i) { return this.pos(i); };

  Board3D.prototype.cellAt = function (clientX, clientY) {
    if (!this.view) return -1;
    var r = this.cv.getBoundingClientRect(), N = this.view.size;
    var ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    var hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.plane, hit)) return -1;
    var x = Math.floor(hit.x + N / 2), z = Math.floor(hit.z + N / 2);
    if (x < 0 || z < 0 || x >= N || z >= N) return -1;
    return z * N + x;
  };

  Board3D.prototype.setView = function (view) {
    var rebuild = !this.view || this.view.size !== view.size || this.view.map !== view.map;
    this.view = view;
    if (rebuild) { this.buildWorld(view); this.layout(); }
  };

  function disposeTree(o) {
    o.traverse(function (n) {
      if (n.geometry) n.geometry.dispose();
      if (n.material && n.material.isShaderMaterial) n.material.dispose();
    });
  }

  Board3D.prototype.buildWorld = function (v) {
    var self = this, N = v.size, mood = MOODS[v.map.id] || MOODS.open;
    disposeTree(this.world);
    this.world.clear();
    this.clearMarks();
    this.shipKey = null;
    this.mood = mood;

    // sky + environment lighting
    var sky = new Sky();
    sky.scale.setScalar(300);
    var su = sky.material.uniforms;
    su.turbidity.value = mood.turb; su.rayleigh.value = mood.ray; su.mieCoefficient.value = 0.006; su.mieDirectionalG.value = 0.86;
    var phi = THREE.MathUtils.degToRad(90 - mood.elev), theta = THREE.MathUtils.degToRad(mood.azim);
    var sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    su.sunPosition.value.copy(sunDir);
    this.world.add(sky);
    this.renderer.toneMappingExposure = mood.exp;
    try {
      var pm = new THREE.PMREMGenerator(this.renderer), envScene = new THREE.Scene(), sky2 = sky.clone();
      envScene.add(sky2);
      if (this.env) this.env.dispose();
      this.env = pm.fromScene(envScene, 0.04).texture;
      this.scene.environment = this.env;
      pm.dispose();
    } catch (e) { this.scene.environment = null; }

    this.sun.color.set(mood.sun); this.sun.intensity = mood.sunI;
    this.sun.position.copy(sunDir).multiplyScalar(30);
    this.hemi.color.set(mood.sky); this.hemi.intensity = mood.hemi;

    // ocean
    var water = new THREE.Mesh(new THREE.PlaneGeometry(120, 120, 220, 220), new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 }, uDeep: { value: new THREE.Color(mood.deep) }, uShallow: { value: new THREE.Color(mood.shallow) },
        uSky: { value: new THREE.Color(mood.sky) }, uFog: { value: new THREE.Color(mood.fog) }, uSunColor: { value: new THREE.Color(mood.sun) },
        uSunDir: { value: sunDir.clone().normalize() }, uFogNear: { value: N * 0.9 }, uFogFar: { value: N * 4 }
      },
      vertexShader: WATER_VS, fragmentShader: WATER_FS
    }));
    water.geometry.rotateX(-Math.PI / 2);
    water.renderOrder = -2;
    this.water = water;
    this.world.add(water);

    // grid lines drawn over the water, under everything else
    var pts = [], h = N / 2;
    for (var k = 0; k <= N; k++) {
      pts.push(-h + k, 0, -h, -h + k, 0, h, -h, 0, -h + k, h, 0, -h + k);
    }
    var gg = new THREE.BufferGeometry(); gg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    var grid = new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: '#4d8fa0', depthTest: false, depthWrite: false }));
    grid.renderOrder = -1;
    this.world.add(grid);
    // brass frame + corner posts
    var frameMat = new THREE.MeshStandardMaterial({ color: '#c9973e', metalness: 0.85, roughness: 0.35, emissive: '#5a3a08', emissiveIntensity: 0.4 });
    [[0, -h - 0.06, N + 0.24, 0.06], [0, h + 0.06, N + 0.24, 0.06], [-h - 0.06, 0, 0.06, N + 0.24], [h + 0.06, 0, 0.06, N + 0.24]].forEach(function (f) {
      var b = new THREE.Mesh(new THREE.BoxGeometry(f[2], 0.06, f[3]), frameMat);
      b.position.set(f[0], 0.05, f[1]); self.world.add(b);
    });
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) {
      var p = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.3, 12), frameMat);
      p.position.set(c[0] * (h + 0.06), 0.05, c[1] * (h + 0.06)); self.world.add(p);
      var lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshBasicMaterial({ color: '#ffd27a' }));
      lamp.position.set(c[0] * (h + 0.06), 0.24, c[1] * (h + 0.06)); self.world.add(lamp);
    });
    // coordinate labels
    for (k = 0; k < N; k++) {
      var a = textSprite(FC.colName(k), '#e6f0f3', null, 44, 0.5);
      a.position.set(-h + k + 0.5, 0.15, -h - 0.48); this.world.add(a);
      var n = textSprite(String(k + 1), '#e6f0f3', null, 44, 0.5);
      n.position.set(-h - 0.55, 0.15, -h + k + 0.5); this.world.add(n);
    }
    // islands
    var bl = v.blocked;
    for (k = 0; k < bl.length; k++) if (bl[k]) this.world.add(this.island(k));
    this.reconSprites = new THREE.Group(); this.world.add(this.reconSprites); this.reconKey = '';
  };

  Board3D.prototype.island = function (i) {
    var g = new THREE.Group(), p = this.pos(i), seed = (i * 2654435761) >>> 0;
    function rnd(k) { return ((Math.sin(seed * 0.001 + k * 12.9898) * 43758.5453) % 1 + 1) % 1; }
    var sand = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.sand);
    sand.scale.set(1.05, 0.28, 1.05); g.add(sand);
    var grass = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 1), M.grass);
    grass.scale.set(1, 0.42 + rnd(1) * 0.2, 1); grass.position.y = 0.06; g.add(grass);
    var top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), M.grassDark);
    top.scale.set(1, 0.7, 1); top.position.set((rnd(2) - 0.5) * 0.3, 0.2, (rnd(3) - 0.5) * 0.3); g.add(top);
    if (rnd(4) > 0.35) {
      var palm = new THREE.Group();
      cyl(palm, 0.015, 0.025, 0.36, M.trunk, 0, 0, 0, 6);
      for (var k = 0; k < 5; k++) {
        var leaf = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.26, 4), M.grassDark);
        leaf.rotation.z = Math.PI / 2.4; leaf.rotation.y = k * 1.26; leaf.position.y = 0.36;
        leaf.position.x = Math.cos(k * 1.26) * 0.1; leaf.position.z = -Math.sin(k * 1.26) * 0.1;
        palm.add(leaf);
      }
      palm.position.set((rnd(5) - 0.5) * 0.4, 0.12, (rnd(6) - 0.5) * 0.4);
      g.add(palm);
    }
    var rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), M.rock);
    rock.position.set((rnd(7) - 0.5) * 0.9, 0.02, (rnd(8) - 0.5) * 0.9); g.add(rock);
    var foam = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.85, 32), new THREE.MeshBasicMaterial({ map: this.foamTex, transparent: true, opacity: 0.55, depthWrite: false }));
    foam.rotation.x = -Math.PI / 2; foam.position.y = 0.06; foam.userData.foam = true; g.add(foam);
    g.position.copy(p).setY(-0.03);
    return g;
  };

  // ---- aim highlight ------------------------------------------------------------
  Board3D.prototype.buildAim = function () {
    this.aimQuads = [];
    this.aimMat = new THREE.MeshBasicMaterial({ color: '#ffb84a', transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    this.aimBad = new THREE.MeshBasicMaterial({ color: '#ff4a2a', transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    var qg = new THREE.PlaneGeometry(0.92, 0.92); qg.rotateX(-Math.PI / 2);
    for (var k = 0; k < 25; k++) {
      var q = new THREE.Mesh(qg, this.aimMat); q.renderOrder = 25; q.visible = false;
      this.aimLayer.add(q); this.aimQuads.push(q);
    }
    var ret = this.reticle = new THREE.Group();
    this.retMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, depthTest: false, depthWrite: false });
    for (k = 0; k < 4; k++) {
      var arc = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.46, 24, 1, k * Math.PI / 2 + 0.22, Math.PI / 2 - 0.44), this.retMat);
      arc.rotation.x = -Math.PI / 2; ret.add(arc);
    }
    var bar = new THREE.PlaneGeometry(0.22, 0.04); bar.rotateX(-Math.PI / 2);
    [[0.58, 0, 0], [-0.58, 0, 0], [0, 0, 0.58], [0, 0, -0.58]].forEach(function (p, n) {
      var m = new THREE.Mesh(bar, this.retMat); m.position.set(p[0], 0, p[2]); if (n > 1) m.rotation.y = Math.PI / 2; ret.add(m);
    }, this);
    ret.children.forEach(function (c) { c.renderOrder = 26; });
    ret.visible = false;
    this.aimLayer.add(ret);
  };
  Board3D.prototype.updateAim = function (t) {
    var A = this.aim, k;
    for (k = 0; k < this.aimQuads.length; k++) this.aimQuads[k].visible = false;
    this.reticle.visible = false;
    if (!A || !this.view) return;
    var mat = A.bad ? this.aimBad : this.aimMat;
    mat.opacity = 0.26 + Math.sin(t * 6) * 0.08;
    (A.cells || []).forEach(function (c, n) {
      if (n >= this.aimQuads.length) return;
      var q = this.aimQuads[n]; q.material = mat; q.visible = true; q.position.copy(this.pos(c, 0.08));
    }, this);
    if (A.center >= 0) {
      this.reticle.visible = true;
      this.reticle.position.copy(this.pos(A.center, 0.1));
      this.reticle.rotation.y = t * 1.6;
      this.retMat.color.set(A.bad ? '#ff5a3c' : '#ffd27a');
    }
  };

  // ---- ships ------------------------------------------------------------------------
  Board3D.prototype.syncShips = function () {
    var v = this.view, self = this;
    var key = (v.own ? 'o' : 'e') + (v.reveal ? 'r' : '') + (v.ships || []).map(function (s) { return s.c + s.x + '.' + s.y + s.d + (s.sunk ? 'x' : ''); }).join('|');
    if (key === this.shipKey) return;
    this.shipKey = key;
    this.shipLayer.clear();
    this.shipObjs = [];
    (v.ships || []).forEach(function (s, idx) {
      if (!v.own && !s.sunk && !v.reveal) { self.shipObjs.push(null); return; }
      var g = shipModel(s.c);
      var a = self.pos(s.cells[0]), b = self.pos(s.cells[s.cells.length - 1]);
      g.position.set((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
      g.rotation.y = s.d ? -Math.PI / 2 : 0;
      g.userData.base = { x: g.position.x, z: g.position.z, ry: g.rotation.y, idx: idx, sunk: s.sunk };
      if (s.sunk) swapMats(g, charMat);
      else if (!v.own) swapMats(g, ghostMat);
      var foam = new THREE.Mesh(new THREE.PlaneGeometry(FC.SHIPS[s.c].size + 0.4, 0.95), new THREE.MeshBasicMaterial({ map: self.foamTex, transparent: true, opacity: s.sunk ? 0.25 : 0.5, depthWrite: false }));
      foam.rotation.x = -Math.PI / 2; foam.position.y = 0.04;
      g.add(foam);
      self.shipLayer.add(g);
      self.shipObjs.push(g);
    });
  };
  Board3D.prototype.animateShips = function (t, dt) {
    var self = this;
    (this.shipObjs || []).forEach(function (g) {
      if (!g) return;
      var B = g.userData.base, w = waveAt(B.x, B.z, t);
      var sk = self.sinking[B.idx], sinkF = 0;
      if (sk != null) {
        sinkF = Math.min(1, (t - sk) / 2.4);
        if (sinkF < 1 && Math.random() < 0.7) {
          self.smokeP.add({ kind: 'bubble', x: B.x + (Math.random() - 0.5), y: 0.05, z: B.z + (Math.random() - 0.5) * 0.5, vx: 0, vy: 0.25, vz: 0, life: 1, s: 0.05 });
        }
        if (sinkF >= 1) delete self.sinking[B.idx];
      }
      var settled = B.sunk ? (sk != null ? 1 - Math.pow(1 - sinkF, 3) : 1) : 0;
      g.position.y = w.y * 0.8 - settled * 0.11;
      g.rotation.set(w.nz * 0.5 + settled * 0.2 * (B.idx % 2 ? 1 : -1), B.ry, -w.nx * 0.5 - settled * 0.05);
      g.userData.spin.forEach(function (r) { r.rotation.y += dt * 2.5; });
      if (!B.sunk && self.view.own && Math.random() < dt * 3) {
        g.userData.funnels.forEach(function (f) {
          var wp = new THREE.Vector3(f[0], f[1], f[2]).applyMatrix4(g.matrixWorld);
          self.smokeP.add({ kind: 'steam', x: wp.x, y: wp.y, z: wp.z, vx: 0.15, vy: 0.2, vz: 0.05, life: 2.2, s: 0.09 });
        });
      }
    });
  };
  Board3D.prototype.sink = function (idx) { this.sinking[idx] = this.t; };

  // ---- cell markers -------------------------------------------------------------------
  Board3D.prototype.clearMarks = function () {
    this.markLayer.children.slice().forEach(disposeObj);
    this.markLayer.clear();
    this.dome = null; this.shieldKey = null;
    this.marks = {};
    this.markGrid = null;
  };
  Board3D.prototype.syncMarks = function () {
    var v = this.view, G = v.grid;
    if (!G) return;
    if (this.markGrid !== G || this.markOwn !== v.own) { this.clearMarks(); this.markGrid = G; this.markOwn = v.own; this.marks = {}; }
    for (var i = 0; i < G.shot.length; i++) {
      var key = G.shot[i] * 64 + G.intel[i] * 16 + G.repaired[i] * 4 + (v.own && G.mine && G.mine[i] ? 1 : 0);
      var cur = this.marks[i];
      if ((cur ? cur.key : 0) === key) continue;
      if (cur) { this.markLayer.remove(cur.obj); disposeObj(cur.obj); }
      if (!key) { delete this.marks[i]; continue; }
      var obj = this.makeMark(i, G, v);
      this.markLayer.add(obj);
      this.marks[i] = { key: key, obj: obj };
    }
    // shield dome
    var sk = G.shield ? G.shield.join(',') : '';
    if (sk !== this.shieldKey) {
      this.shieldKey = sk;
      if (this.dome) { this.markLayer.remove(this.dome); disposeObj(this.dome); this.dome = null; }
      if (G.shield && G.shield.length) {
        var mn = { x: 1e9, z: 1e9 }, mx = { x: -1e9, z: -1e9 }, self = this;
        G.shield.forEach(function (c) { var p = self.pos(c); mn.x = Math.min(mn.x, p.x); mn.z = Math.min(mn.z, p.z); mx.x = Math.max(mx.x, p.x); mx.z = Math.max(mx.z, p.z); });
        var d = this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.ShaderMaterial({
          uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } }, vertexShader: SHIELD_VS, fragmentShader: SHIELD_FS,
          transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending
        }));
        d.scale.set((mx.x - mn.x) / 2 + 0.75, 0.9, (mx.z - mn.z) / 2 + 0.75);
        d.position.set((mn.x + mx.x) / 2, 0, (mn.z + mx.z) / 2);
        d.renderOrder = 18;
        this.markLayer.add(d);
      }
    }
    // recon counts at the board edge
    var rk = (G.recon || []).map(function (r) { return r.o + '.' + r.n + '.' + r.count; }).join('|');
    if (rk !== this.reconKey) {
      this.reconKey = rk;
      this.reconSprites.clear();
      var N = v.size, h = N / 2;
      (G.recon || []).forEach(function (r) {
        var s = textSprite(String(r.count), '#061722', r.count ? '#e0a63a' : '#4fd1c5', 48, 0.46);
        if (r.o) s.position.set(-h + r.n + 0.5, 0.2, h + 0.55); else s.position.set(h + 0.55, 0.2, -h + r.n + 0.5);
        this.reconSprites.add(s);
      }, this);
    }
    // burning hits
    this.hot = [];
    for (i = 0; i < G.shot.length; i++) if (G.shot[i] === 2) this.hot.push(i);
  };
  Board3D.prototype.makeMark = function (i, G, v) {
    var g = new THREE.Group(), s = G.shot[i], p = this.pos(i);
    g.position.copy(p);
    var onShip = v.own || (v.ships || []).some(function (sh) { return (sh.sunk || v.reveal) && sh.cells.indexOf(i) >= 0; });
    g.userData = { i: i, float: !onShip, deckY: onShip ? DECK + 0.02 : 0 };
    if (s === 1) {
      var peg = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 4, 10), M.peg); peg.position.y = 0.08; g.add(peg);
      var ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 24), new THREE.MeshBasicMaterial({ color: '#e8f6fb', transparent: true, opacity: 0.35, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
      g.userData.ring = ring;
    } else if (s === 2) {
      var hp = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.1, 4, 10), M.pegHit); hp.position.y = 0.1; g.add(hp);
      var glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#ff9a50' }));
      glow.scale.set(0.9, 0.9, 1); glow.position.y = 0.2; glow.renderOrder = 21; g.add(glow);
      g.userData.glow = glow;
    } else if (s === 3) {
      var sc = new THREE.Mesh(new THREE.CircleGeometry(0.38, 20), new THREE.MeshBasicMaterial({ color: '#120c08', transparent: true, opacity: 0.6, depthWrite: false }));
      sc.rotation.x = -Math.PI / 2; sc.position.y = 0.04; g.add(sc);
      for (var k = 0; k < 4; k++) {
        var deb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.05), M.dark);
        deb.position.set(Math.cos(k * 1.7) * 0.2, 0.03, Math.sin(k * 1.7) * 0.2); deb.rotation.y = k; g.add(deb);
      }
    }
    if (!s && G.intel[i] === 2) {
      var dia = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), new THREE.MeshBasicMaterial({ color: '#ffbe50', transparent: true, opacity: 0.85, wireframe: true }));
      dia.scale.y = 1.4; dia.position.y = 0.45; g.add(dia); g.userData.spinner = dia;
      var dc = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.26, 4), new THREE.MeshBasicMaterial({ color: '#ffbe50', transparent: true, opacity: 0.5, depthWrite: false }));
      dc.rotation.x = -Math.PI / 2; dc.position.y = 0.05; g.add(dc);
    } else if (!s && G.intel[i] === 1) {
      var xm = new THREE.MeshBasicMaterial({ color: '#4fd1c5', transparent: true, opacity: 0.55, depthWrite: false });
      [Math.PI / 4, -Math.PI / 4].forEach(function (r) { var b = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.04), xm); b.rotation.x = -Math.PI / 2; b.rotation.z = r; b.position.y = 0.05; g.add(b); });
    }
    if (!s && G.repaired[i]) {
      var rr = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 24), new THREE.MeshBasicMaterial({ color: '#7cf096' }));
      rr.rotation.x = -Math.PI / 2; rr.position.y = DECK + 0.05; g.add(rr);
    }
    if (!s && v.own && G.mine && G.mine[i]) {
      var mine = new THREE.Group();
      mine.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.12, 1), M.dark));
      for (k = 0; k < 8; k++) {
        var sp = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.08, 6), M.dark);
        var dirv = new THREE.Vector3(Math.cos(k * 0.785), (k % 2 ? 0.6 : -0.2), Math.sin(k * 0.785)).normalize();
        sp.position.copy(dirv).multiplyScalar(0.13); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirv); mine.add(sp);
      }
      var led = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff3a20' }));
      led.position.y = 0.13; mine.add(led); g.userData.led = led;
      mine.position.y = 0.02; g.add(mine);
    }
    return g;
  };
  Board3D.prototype.animateMarks = function (t, dt) {
    var self = this;
    this.markLayer.children.forEach(function (g) {
      var u = g.userData;
      if (u.i == null) return;
      var p = g.position, w = waveAt(p.x, p.z, t);
      p.y = u.float ? w.y * 0.9 : u.deckY + w.y * 0.8;
      if (u.spinner) { u.spinner.rotation.y += dt * 2; u.spinner.position.y = 0.45 + Math.sin(t * 3 + u.i) * 0.05; }
      if (u.glow) { var f = 0.8 + Math.sin(t * 11 + u.i) * 0.12 + Math.random() * 0.08; u.glow.scale.set(f, f, 1); }
      if (u.ring) { u.ring.material.opacity = 0.25 + Math.sin(t * 2 + u.i) * 0.1; }
      if (u.led) u.led.visible = Math.sin(t * 5 + u.i) > 0;
    });
    if (this.dome) this.dome.material.uniforms.uTime.value = t;
    // fire and smoke from every burning hit
    if (!reduceMotion && this.hot) {
      for (var k = 0; k < this.hot.length; k++) {
        var m = this.marks[this.hot[k]];
        if (!m) continue;
        var q = m.obj.position;
        if (Math.random() < dt * 22) self.fireP.add({ kind: 'fire', x: q.x + (Math.random() - 0.5) * 0.25, y: q.y + 0.12, z: q.z + (Math.random() - 0.5) * 0.25, vx: (Math.random() - 0.5) * 0.1, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.1, life: 0.45 + Math.random() * 0.3, s: 0.16 + Math.random() * 0.1, drag: 0.97 });
        if (Math.random() < dt * 6) self.smokeP.add({ kind: 'smoke', x: q.x, y: q.y + 0.35, z: q.z, vx: 0.12 + Math.random() * 0.1, vy: 0.35, vz: 0.04, life: 2.6, s: 0.28, drag: 0.99 });
      }
    }
  };

  // ---- frame ------------------------------------------------------------------------
  Board3D.prototype.frame = function (dt) {
    if (!this.view || this.lost) return;
    if (!this.W) this.layout();
    if (!this.W) return;
    this.t += dt;
    var t = this.t;
    if (this.water) this.water.material.uniforms.uTime.value = t;
    this.syncShips();
    this.syncMarks();
    this.animateShips(t, dt);
    this.animateMarks(t, dt);
    this.world.children.forEach(function (o) {
      if (o.children) o.children.forEach(function (c) { if (c.userData.foam) c.material.opacity = 0.4 + Math.sin(t * 1.5 + o.position.x) * 0.15; });
    });
    this.updateAim(t);
    for (var k = this.fx.length - 1; k >= 0; k--) {
      var f = this.fx[k];
      f.age += dt * FC.settings.speed;
      if (f.step(Math.min(f.age, f.life), dt) === false || f.age >= f.life) {
        if (f.cleanup) f.cleanup();
        if (f.done) f.done();
        this.fx.splice(k, 1);
      }
    }
    this.flashes.forEach(function (l) { if (l.intensity > 0) l.intensity = Math.max(0, l.intensity - dt * l.userData.decay); });
    this.fireP.update(dt); this.smokeP.update(dt);
    // camera: gentle drift plus shake
    if (this.camBase) {
      var cam = this.camera;
      cam.position.copy(this.camBase);
      if (!reduceMotion) { cam.position.x += Math.sin(t * 0.21) * 0.25; cam.position.y += Math.sin(t * 0.33) * 0.12; }
      if (this.shakeT > 0) {
        this.shakeT -= dt;
        var s = this.shakeMag * Math.max(0, this.shakeT / 0.4);
        cam.position.x += (Math.random() - 0.5) * s; cam.position.y += (Math.random() - 0.5) * s;
      }
      cam.lookAt(this.camTarget);
    }
    if (this.quality === 'lite') this.renderer.render(this.scene, this.camera);
    else this.composer.render(dt);
  };

  // ---- effects (each returns a Promise) -------------------------------------------------
  Board3D.prototype.add = function (life, step, cleanup) {
    var self = this;
    return new Promise(function (res) {
      self.fx.push({ age: 0, life: life, step: step, cleanup: cleanup, done: res });
    });
  };
  Board3D.prototype.clearFx = function () {
    this.fx.forEach(function (f) { if (f.cleanup) f.cleanup(); if (f.done) f.done(); });
    this.fx = []; this.fireP.clear(); this.smokeP.clear(); this.sinking = {};
    this.fxLayer.children.slice().forEach(disposeObj);
    this.fxLayer.clear();
  };
  Board3D.prototype.shake = function (m) { if (!reduceMotion) { this.shakeMag = Math.max(this.shakeMag * (this.shakeT > 0 ? 1 : 0), m); this.shakeT = 0.4; } };
  Board3D.prototype.flash = function (p, intensity, color) {
    var l = this.flashes.reduce(function (a, b) { return a.intensity <= b.intensity ? a : b; });
    l.position.copy(p).setY(p.y + 0.6); l.color.set(color || '#ffb060');
    l.intensity = intensity; l.userData.decay = intensity * 2.4;
  };
  Board3D.prototype.mesh = function (geo, mat) { var m = new THREE.Mesh(geo, mat); this.fxLayer.add(m); return m; };
  function shared(m) { return !m || Object.keys(M).some(function (k) { return M[k] === m; }) || m.userData.keep; }
  function disposeObj(o) {
    o.traverse(function (n) {
      if (n.geometry && !n.geometry.userData.keep) n.geometry.dispose();
      if (n.material && !Array.isArray(n.material) && !shared(n.material)) n.material.dispose();
    });
  }
  Board3D.prototype.drop = function (o) { if (o.parent) o.parent.remove(o); disposeObj(o); };

  Board3D.prototype.ring = function (p, r1, life, color, opacity) {
    var self = this, m = this.mesh(new THREE.RingGeometry(0.85, 1, 48), new THREE.MeshBasicMaterial({ color: color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: opacity || 0.8 }));
    m.rotation.x = -Math.PI / 2; m.position.copy(p).setY(p.y + 0.06); m.renderOrder = 22;
    return this.add(life, function (age) {
      var f = age / life, e = 1 - Math.pow(1 - f, 2);
      m.scale.setScalar(0.1 + r1 * e); m.material.opacity = (opacity || 0.8) * (1 - f);
    }, function () { self.drop(m); });
  };

  Board3D.prototype.explode = function (i, big) {
    var p = this.pos(i, 0.2), k;
    var onShip = this.view.own || (this.view.ships || []).some(function (s) { return s.cells.indexOf(i) >= 0 && (s.sunk || this.view.reveal); }, this);
    if (onShip) p.y = DECK + 0.15;
    this.snd('boom', big);
    this.shake(big ? 0.35 : 0.18);
    this.flash(p, big ? 14 : 8);
    var n = reduceMotion ? 10 : big ? 70 : 40;
    this.fireP.add({ kind: 'flash', x: p.x, y: p.y + 0.1, z: p.z, vx: 0, vy: 0, vz: 0, life: 0.25, s: big ? 3.2 : 2.2 });
    for (k = 0; k < n; k++) {
      var a = Math.random() * Math.PI * 2, el = Math.random() * 1.2, sp = (big ? 2.6 : 1.7) * (0.3 + Math.random());
      this.fireP.add({ kind: 'fire', x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp + 0.6, vz: Math.sin(a) * Math.cos(el) * sp, life: 0.5 + Math.random() * 0.5, s: (big ? 0.5 : 0.36) * (0.6 + Math.random() * 0.6), drag: 0.9 });
    }
    for (k = 0; k < n / 2; k++) {
      var a2 = Math.random() * Math.PI * 2, s2 = 2 + Math.random() * 4;
      this.fireP.add({ kind: 'spark', x: p.x, y: p.y, z: p.z, vx: Math.cos(a2) * s2 * 0.6, vy: 2 + Math.random() * 3, vz: Math.sin(a2) * s2 * 0.6, g: 9, life: 0.7 + Math.random() * 0.5, s: 0.05, drag: 0.98 });
      this.smokeP.add({ kind: 'debris', x: p.x, y: p.y, z: p.z, vx: Math.cos(a2) * s2 * 0.4, vy: 2 + Math.random() * 2.5, vz: Math.sin(a2) * s2 * 0.4, g: 9, life: 0.9, s: 0.05 });
    }
    for (k = 0; k < (big ? 14 : 8); k++) this.smokeP.add({ kind: 'smoke', x: p.x + (Math.random() - 0.5) * 0.4, y: p.y + 0.2, z: p.z + (Math.random() - 0.5) * 0.4, vx: (Math.random() - 0.5) * 0.4, vy: 0.5 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 2.6 + Math.random(), s: big ? 0.7 : 0.5, drag: 0.98 });
    this.ring(p, big ? 2.6 : 1.6, 0.6, '#ffe2b0', 0.9);
    return new Promise(function (res) { setTimeout(res, 280 / FC.settings.speed); });
  };

  Board3D.prototype.splash = function (i) {
    var self = this, p = this.pos(i), k;
    p.y = waveAt(p.x, p.z, this.t).y;
    this.snd('splash');
    var col = this.mesh(new THREE.CylinderGeometry(0.03, 0.17, 1, 14, 1, true), new THREE.MeshStandardMaterial({ color: '#eef8fc', transparent: true, opacity: 0.85, roughness: 0.3, depthWrite: false }));
    col.geometry.translate(0, 0.5, 0); col.position.copy(p);
    this.add(1.0, function (age) {
      var f = age / 1.0, h = Math.sin(Math.min(1, f * 1.35) * Math.PI) * 1.6;
      col.scale.set(1 + f * 0.8, Math.max(0.001, h), 1 + f * 0.8); col.material.opacity = 0.85 * (1 - f);
    }, function () { self.drop(col); });
    for (k = 0; k < (reduceMotion ? 8 : 34); k++) {
      var a = Math.random() * Math.PI * 2, s = 0.3 + Math.random() * 0.8;
      this.smokeP.add({ kind: 'water', x: p.x, y: p.y + Math.random() * 0.4, z: p.z, vx: Math.cos(a) * s, vy: 2.2 + Math.random() * 2.2, vz: Math.sin(a) * s, g: 9, life: 0.9 + Math.random() * 0.4, s: 0.05 + Math.random() * 0.05 });
    }
    for (k = 0; k < 6; k++) this.smokeP.add({ kind: 'steam', x: p.x, y: p.y + 0.3, z: p.z, vx: (Math.random() - 0.5) * 0.3, vy: 0.3, vz: (Math.random() - 0.5) * 0.3, life: 1.4, s: 0.35 });
    this.ring(p, 1.4, 1.2, '#dff4fb', 0.6);
    return this.ring(p, 0.8, 0.8, '#ffffff', 0.7);
  };

  Board3D.prototype.popText = function (i, text, color) {
    var self = this, s = textSprite(text, color, null, 96, 0.6), p = this.pos(i, 0.9);
    this.fxLayer.add(s);
    return this.add(1.2, function (age) {
      var f = age / 1.2;
      s.position.set(p.x, p.y + f * 0.6, p.z);
      s.material.opacity = f < 0.12 ? f / 0.12 : 1 - Math.max(0, (f - 0.6) / 0.4);
    }, function () { self.fxLayer.remove(s); s.material.dispose(); });
  };

  var shellGeo = null;
  function shellMesh(self, color) {
    var g = new THREE.Group();
    if (!shellGeo) { shellGeo = new THREE.SphereGeometry(0.05, 10, 8); shellGeo.userData.keep = true; }
    g.add(new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: color || '#fff1c4' })));
    var halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: self.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.scale.set(0.6, 0.6, 1); g.add(halo);
    self.fxLayer.add(g);
    return g;
  }
  function originFor(self, target) {
    var N = self.view.size, own = self.view.own;
    return new THREE.Vector3(target.x * 0.3 + (Math.random() - 0.5) * N * 0.5, 2.5, own ? -N * 0.9 : N * 0.95);
  }
  Board3D.prototype.flyArc = function (from, to, life, height, mesh, trail) {
    var self = this;
    return this.add(life, function (age) {
      var f = age / life;
      var x = from.x + (to.x - from.x) * f, z = from.z + (to.z - from.z) * f, y = from.y + (to.y - from.y) * f + Math.sin(f * Math.PI) * height;
      mesh.position.set(x, y, z);
      if (trail && Math.random() < 0.9) self.smokeP.add({ kind: trail, x: x, y: y, z: z, vx: 0, vy: 0.05, vz: 0, life: 0.7, s: 0.14 });
    }, function () { self.drop(mesh); });
  };

  Board3D.prototype.shell = function (i, delay) {
    var self = this, to = this.pos(i, 0.1), from = originFor(this, to);
    this.snd('cannon'); this.snd('whistle');
    return FC.wait(delay || 0).then(function () {
      var m = shellMesh(self);
      return self.flyArc(from, to, 0.75, 3.2, m, 'steam');
    });
  };

  Board3D.prototype.missiles = function (cells) {
    var self = this;
    this.snd('missile');
    return Promise.all(cells.map(function (c, k) {
      return FC.wait(k * 150).then(function () {
        var to = self.pos(c, 0.1), from = originFor(self, to);
        var m = shellMesh(self, '#e8eef2');
        return self.add(0.8, function (age) {
          var f = age / 0.8, e = f * f;
          var x = from.x + (to.x - from.x) * e, z = from.z + (to.z - from.z) * e, y = from.y + (to.y - from.y) * f + Math.sin(f * Math.PI) * 2;
          m.position.set(x, y, z);
          self.fireP.add({ kind: 'fire', x: x, y: y, z: z, vx: 0, vy: 0, vz: 0, life: 0.15, s: 0.2 });
          self.smokeP.add({ kind: 'steam', x: x, y: y, z: z, vx: 0, vy: 0.05, vz: 0, life: 0.9, s: 0.12 });
        }, function () { self.drop(m); });
      });
    }));
  };

  Board3D.prototype.planes = function (cells, o) {
    var self = this, a = this.pos(cells[0], 1.6), b = this.pos(cells[cells.length - 1], 1.6), N = this.view.size;
    var dir = new THREE.Vector3().subVectors(b, a).normalize();
    if (!isFinite(dir.x)) dir.set(o ? 0 : 1, 0, o ? 1 : 0);
    var start = a.clone().addScaledVector(dir, -N * 0.8), end = b.clone().addScaledVector(dir, N * 0.8), life = 1.7;
    var side = new THREE.Vector3(-dir.z, 0, dir.x);
    var jets = [0, 1, 2].map(function (k) {
      var j = jet(3.2); j.rotation.y = Math.atan2(-dir.z, dir.x); self.fxLayer.add(j);
      j.userData.off = side.clone().multiplyScalar((k - 1) * 0.55); j.userData.lag = Math.abs(k - 1) * 0.05;
      return j;
    });
    this.snd('jet');
    var dropped = {};
    this.add(life, function (age) {
      var f = age / life;
      jets.forEach(function (j) {
        var ff = Math.max(0, f - j.userData.lag);
        j.position.lerpVectors(start, end, ff).add(j.userData.off);
        if (Math.random() < 0.5) self.smokeP.add({ kind: 'steam', x: j.position.x, y: j.position.y, z: j.position.z, vx: 0, vy: 0, vz: 0, life: 0.8, s: 0.08 });
      });
      cells.forEach(function (c, n) {
        if (dropped[n]) return;
        var p = self.pos(c), lead = jets[1].position;
        if (Math.abs((p.x - lead.x) * dir.x + (p.z - lead.z) * dir.z) < 0.4) {
          dropped[n] = 1;
          var bomb = shellMesh(self, '#333'); bomb.position.copy(lead);
          self.flyArc(lead.clone(), p.clone().setY(0.1), 0.35, 0, bomb, null);
        }
      });
    }, function () { jets.forEach(function (j) { self.drop(j); }); });
    var total = start.distanceTo(end), first = start.distanceTo(a);
    return FC.wait(life * 1000 * first / total + 300);
  };

  Board3D.prototype.torpedo = function (path) {
    var self = this;
    if (!path.length) return Promise.resolve();
    var pts = path.map(function (c) { return self.pos(c, 0.02); });
    var a = pts[0], b = pts[pts.length - 1], dir = new THREE.Vector3().subVectors(b, a);
    if (dir.lengthSq() < 0.01) dir.set(1, 0, 0);
    dir.normalize();
    var start = a.clone().addScaledVector(dir, -0.9), life = 0.4 + pts.length * 0.1;
    var torp = this.mesh(new THREE.CapsuleGeometry(0.035, 0.18, 4, 8), M.dark);
    torp.rotation.z = Math.PI / 2; torp.rotation.y = Math.atan2(-dir.z, dir.x);
    this.snd('torpedo');
    return this.add(life, function (age) {
      var f = age / life;
      torp.position.lerpVectors(start, b, f);
      var p = torp.position;
      self.smokeP.add({ kind: 'water', x: p.x + (Math.random() - 0.5) * 0.1, y: 0.06, z: p.z + (Math.random() - 0.5) * 0.1, vx: (Math.random() - 0.5) * 0.3, vy: 0.3, vz: (Math.random() - 0.5) * 0.3, g: 2, life: 0.9, s: 0.06 });
      self.smokeP.add({ kind: 'steam', x: p.x, y: 0.05, z: p.z, vx: 0, vy: 0, vz: 0, life: 1.4, s: 0.18 });
    }, function () { self.drop(torp); });
  };

  Board3D.prototype.homing = function (i) {
    var self = this, to = this.pos(i, 0.02), N = this.view.size;
    var from = new THREE.Vector3(0, 0.02, this.view.own ? -N * 0.7 : N * 0.7), life = 1.2;
    var torp = this.mesh(new THREE.CapsuleGeometry(0.035, 0.18, 4, 8), M.red);
    torp.rotation.z = Math.PI / 2;
    this.snd('torpedo');
    return this.add(life, function (age) {
      var f = age / life;
      torp.position.lerpVectors(from, to, f);
      torp.position.x += Math.sin(f * 12) * 0.4 * (1 - f);
      var p = torp.position;
      self.smokeP.add({ kind: 'steam', x: p.x, y: 0.05, z: p.z, vx: 0, vy: 0, vz: 0, life: 1.2, s: 0.16 });
      self.fireP.add({ kind: 'spark', x: p.x, y: 0.1, z: p.z, vx: 0, vy: 0.2, vz: 0, life: 0.2, s: 0.08 });
    }, function () { self.drop(torp); });
  };

  Board3D.prototype.sonar = function (center, cells, contacts) {
    var self = this, p = this.pos(center, 0.05);
    this.snd('ping');
    contacts.forEach(function (c, k) {
      setTimeout(function () {
        self.snd('blip');
        var q = self.pos(c, 0.1);
        for (var n = 0; n < 10; n++) self.fireP.add({ kind: 'cyan', x: q.x, y: q.y, z: q.z, vx: (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 0.4, vz: (Math.random() - 0.5) * 0.4, life: 0.8, s: 0.12 });
      }, 450 + k * 120);
    });
    var beam = this.mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.6, 40, 1, true), new THREE.MeshBasicMaterial({ color: '#4fd1c5', transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    beam.position.copy(p).setY(0.3);
    this.ring(p, 1.9, 1.2, '#4fd1c5', 0.9);
    setTimeout(function () { self.ring(p, 1.9, 1.0, '#4fd1c5', 0.6); }, 300);
    return this.add(1.3, function (age) {
      var f = age / 1.3; beam.scale.set(0.2 + f, 1, 0.2 + f); beam.material.opacity = 0.2 * (1 - f);
    }, function () { self.drop(beam); });
    void cells;
  };

  Board3D.prototype.recon = function (cells, o) {
    var self = this, a = this.pos(cells[0], 1.3), b = this.pos(cells[cells.length - 1], 1.3), life = 1.4;
    var dir = new THREE.Vector3().subVectors(b, a).normalize();
    var plane = jet(3.5); plane.rotation.y = Math.atan2(-dir.z, dir.x); this.fxLayer.add(plane);
    var cone = this.mesh(new THREE.ConeGeometry(0.5, 1.3, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#4fd1c5', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    this.snd('jet');
    return this.add(life, function (age) {
      var f = age / life;
      plane.position.lerpVectors(a.clone().addScaledVector(dir, -1), b.clone().addScaledVector(dir, 1), f);
      cone.position.copy(plane.position).setY(0.65);
    }, function () { self.drop(plane); self.drop(cone); });
    void o;
  };

  Board3D.prototype.shieldUp = function (cells, center) {
    var self = this, p = this.pos(center, 0.05);
    this.snd('shield');
    this.flash(p, 6, '#8fd0ff');
    return this.add(0.8, function () {
      if (self.dome) { var f = Math.min(1, self.dome.userData.grow = (self.dome.userData.grow || 0) + 0.05); self.dome.material.uniforms.uPulse.value = 1 - f; }
    }).then(function () { return self.ring(p, 2.2, 0.6, '#8fd0ff', 0.8); });
    void cells;
  };

  Board3D.prototype.deflect = function (i) {
    var self = this, p = this.pos(i, 0.6);
    this.snd('deflect');
    this.flash(p, 6, '#9fd8ff');
    for (var k = 0; k < 24; k++) {
      var a = Math.random() * Math.PI * 2;
      this.fireP.add({ kind: 'cyan', x: p.x, y: p.y, z: p.z, vx: Math.cos(a) * 2, vy: 1 + Math.random() * 2, vz: Math.sin(a) * 2, g: 6, life: 0.6, s: 0.1 });
    }
    if (this.dome) this.dome.material.uniforms.uPulse.value = 1;
    return this.add(0.5, function (age) { if (self.dome) self.dome.material.uniforms.uPulse.value = 1 - age / 0.5; });
  };

  Board3D.prototype.repairFx = function (i) {
    var p = this.pos(i, DECK + 0.1);
    this.snd('repair');
    for (var k = 0; k < 30; k++) this.fireP.add({ kind: 'green', x: p.x + (Math.random() - 0.5) * 0.7, y: p.y, z: p.z + (Math.random() - 0.5) * 0.7, vx: 0, vy: 0.6 + Math.random() * 0.6, vz: 0, life: 1, s: 0.09 });
    return this.ring(p, 0.8, 0.8, '#7cf096', 0.9);
  };

  Board3D.prototype.mineDrop = function (i) {
    var p = this.pos(i, 0.05);
    this.snd('mine');
    for (var k = 0; k < 12; k++) this.smokeP.add({ kind: 'water', x: p.x, y: 0.05, z: p.z, vx: (Math.random() - 0.5) * 0.6, vy: 1 + Math.random(), vz: (Math.random() - 0.5) * 0.6, g: 9, life: 0.6, s: 0.05 });
    return this.ring(p, 0.8, 0.8, '#e8f6fb', 0.7);
  };

  Board3D.prototype.lightning = function (i) {
    var self = this, p = this.pos(i, 0.05), pts = [new THREE.Vector3(p.x + (Math.random() - 0.5) * 3, 9, p.z - 2)];
    for (var k = 1; k < 10; k++) pts.push(new THREE.Vector3().lerpVectors(pts[0], p, k / 10).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, 0, (Math.random() - 0.5) * 0.6)));
    pts.push(p);
    var bolt = this.mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1), 40, 0.035, 5, false), new THREE.MeshBasicMaterial({ color: '#eef3ff' }));
    this.snd('zap');
    this.shake(0.3);
    this.flash(p, 30, '#bcd0ff');
    var hemi = this.hemi, base = hemi.intensity;
    return this.add(0.5, function (age) {
      var f = age / 0.5;
      bolt.visible = f < 0.25 || Math.random() < 0.4 * (1 - f);
      hemi.intensity = base + (bolt.visible ? 3 * (1 - f) : 0);
    }, function () { hemi.intensity = base; self.drop(bolt); });
  };

  Board3D.prototype.kraken = function (i) {
    var self = this, p = this.pos(i, 0), mat = new THREE.MeshStandardMaterial({ color: '#5b2a4f', roughness: 0.4, metalness: 0.1, emissive: '#1a0614' });
    mat.userData.keep = true;
    this.snd('kraken');
    this.shake(0.25);
    var tubes = [];
    return this.add(1.4, function (age) {
      var f = age / 1.4, rise = Math.sin(f * Math.PI);
      tubes.forEach(function (t) { self.drop(t); });
      tubes = [-1, 0, 1].map(function (k) {
        var bx = p.x + k * 0.45, h = 1.8 * rise * (k ? 0.7 : 1);
        var curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(bx, -0.2, p.z + k * 0.2),
          new THREE.Vector3(bx + Math.sin(age * 6 + k) * 0.3, h * 0.45, p.z + Math.cos(age * 5 + k) * 0.2),
          new THREE.Vector3(bx + Math.cos(age * 5 + k) * 0.5, h, p.z + Math.sin(age * 4 + k) * 0.3)
        ]);
        var geo = new THREE.TubeGeometry(curve, 18, k ? 0.07 : 0.1, 7, false);
        var m = new THREE.Mesh(geo, mat); self.fxLayer.add(m);
        return m;
      });
      if (Math.random() < 0.5) self.smokeP.add({ kind: 'water', x: p.x + (Math.random() - 0.5), y: 0.05, z: p.z + (Math.random() - 0.5), vx: 0, vy: 1.5, vz: 0, g: 9, life: 0.6, s: 0.06 });
    }, function () { tubes.forEach(function (t) { self.drop(t); }); mat.dispose(); });
  };
})(window.FC = window.FC || {});
