import * as THREE from 'three';

// Procedural textures painted on canvases at startup, so the game needs no
// image files. Most are light/neutral so a material's colour can tint them.
// Every texture is cached; call tex(name) to get it.

const SIZE = 512;
const cache = new Map();

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(size = SIZE) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

/** Soft blotchy noise: many translucent circles. */
function blotches(g, r, count, colors, minR, maxR, alpha, size = SIZE) {
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = minR + r() * (maxR - minR);
    const col = colors[Math.floor(r() * colors.length)];
    // Draw wrapped copies so the texture tiles seamlessly.
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const cx = x + ox, cy = y + oy;
      if (cx + rad < 0 || cx - rad > size || cy + rad < 0 || cy - rad > size) continue;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      grd.addColorStop(0, col.replace('A', alpha));
      grd.addColorStop(1, col.replace('A', 0));
      g.fillStyle = grd;
      g.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
    }
  }
}

function speckle(g, r, count, colors, maxSize = 2, size = SIZE) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    const s = 0.5 + r() * maxSize;
    g.fillRect(r() * size, r() * size, s, s);
  }
}

const PAINTERS = {
  grass(g, r) {
    g.fillStyle = '#27371f';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 60, ['rgba(60,80,40,A)', 'rgba(20,30,18,A)', 'rgba(70,64,40,A)'], 30, 110, 0.35);
    g.lineCap = 'round';
    for (let i = 0; i < 9000; i++) {
      const x = r() * SIZE, y = r() * SIZE, len = 3 + r() * 9, a = -Math.PI / 2 + (r() - 0.5) * 1.2;
      const l = 18 + r() * 22;
      g.strokeStyle = `hsl(${85 + r() * 30}, ${30 + r() * 25}%, ${l}%)`;
      g.lineWidth = 0.6 + r() * 1.1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  },

  gravel(g, r) {
    g.fillStyle = '#7d7563';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 50, ['rgba(110,100,80,A)', 'rgba(60,55,45,A)'], 30, 90, 0.35);
    // Raked lines, like a temple courtyard.
    for (let y = 0; y < SIZE; y += 16) {
      g.strokeStyle = 'rgba(40,36,28,0.25)';
      g.lineWidth = 3;
      g.beginPath();
      for (let x = 0; x <= SIZE; x += 8) g.lineTo(x, y + Math.sin((x / SIZE) * Math.PI * 4) * 2);
      g.stroke();
    }
    for (let i = 0; i < 7000; i++) {
      const x = r() * SIZE, y = r() * SIZE, s = 1 + r() * 2.6;
      const l = 30 + r() * 45;
      g.fillStyle = `hsl(${30 + r() * 20}, ${8 + r() * 10}%, ${l}%)`;
      g.beginPath();
      g.ellipse(x, y, s, s * (0.6 + r() * 0.4), r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  },

  dirt(g, r) {
    g.fillStyle = '#4a3f30';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 80, ['rgba(90,74,52,A)', 'rgba(35,28,20,A)', 'rgba(70,66,50,A)'], 20, 90, 0.4);
    speckle(g, r, 5000, ['#5c5040', '#3a3024', '#6e6350', '#2d261c'], 2.4);
    for (let i = 0; i < 260; i++) {
      const x = r() * SIZE, y = r() * SIZE, s = 2 + r() * 5;
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath(); g.ellipse(x + 1, y + 1.5, s, s * 0.7, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = `hsl(35, 10%, ${35 + r() * 25}%)`;
      g.beginPath(); g.ellipse(x, y, s, s * 0.7, r() * 3, 0, Math.PI * 2); g.fill();
    }
  },

  plaster(g, r) {
    g.fillStyle = '#e4ddcc';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 70, ['rgba(160,150,125,A)', 'rgba(255,250,240,A)'], 20, 120, 0.18);
    speckle(g, r, 3000, ['rgba(120,110,90,0.25)', 'rgba(255,255,255,0.3)'], 1.5);
    // Rain streaks
    for (let i = 0; i < 40; i++) {
      const x = r() * SIZE, y = r() * SIZE * 0.5, len = 60 + r() * 200;
      const grd = g.createLinearGradient(x, y, x, y + len);
      grd.addColorStop(0, 'rgba(90,80,60,0.12)');
      grd.addColorStop(1, 'rgba(90,80,60,0)');
      g.fillStyle = grd;
      g.fillRect(x, y, 2 + r() * 4, len);
    }
  },

  // Plaster wall with timber framing and shoji paper panels. v=0 is the
  // ground, the texture covers 4 m of height.
  houseWall(g, r) {
    PAINTERS.plaster(g, r);
    const px = (m) => (m / 4) * SIZE; // metres to pixels
    const Y = (m) => SIZE - px(m);
    const wood = (x, y, w, h) => {
      g.fillStyle = '#3d2818'; g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,220,180,0.06)';
      for (let i = 0; i < w * h / 40; i++) g.fillRect(x + r() * w, y + r() * h, 1, 3 + r() * 6);
    };
    // Sill beam and base
    wood(0, Y(0.55), SIZE, px(0.55));
    wood(0, Y(2.75), SIZE, px(0.18));
    // Shoji panels between 0.7 m and 2.6 m
    const top = Y(2.6), bot = Y(0.7);
    for (let i = 0; i < 2; i++) {
      const x0 = i * SIZE / 2 + px(0.25), w = SIZE / 2 - px(0.5);
      g.fillStyle = '#efe6cf';
      g.fillRect(x0, top, w, bot - top);
      g.strokeStyle = '#4a3220';
      g.lineWidth = 3;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x0 + (w * k) / 4, top); g.lineTo(x0 + (w * k) / 4, bot); g.stroke(); }
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x0, top + ((bot - top) * k) / 6); g.lineTo(x0 + w, top + ((bot - top) * k) / 6); g.stroke(); }
      g.lineWidth = 7;
      g.strokeRect(x0, top, w, bot - top);
    }
    // Posts
    for (const x of [0, SIZE / 2, SIZE]) wood(x - px(0.1), 0, px(0.2), SIZE);
  },

  // Emissive mask for houseWall: only the paper panels glow.
  houseGlow(g) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, SIZE, SIZE);
    const px = (m) => (m / 4) * SIZE;
    const top = SIZE - px(2.6), bot = SIZE - px(0.7);
    for (let i = 0; i < 2; i++) {
      const x0 = i * SIZE / 2 + px(0.25), w = SIZE / 2 - px(0.5);
      const grd = g.createLinearGradient(0, top, 0, bot);
      grd.addColorStop(0, '#6a4a22');
      grd.addColorStop(1, '#ffb15a');
      g.fillStyle = grd;
      g.fillRect(x0, top, w, bot - top);
      g.strokeStyle = '#000';
      g.lineWidth = 3;
      for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x0 + (w * k) / 4, top); g.lineTo(x0 + (w * k) / 4, bot); g.stroke(); }
      for (let k = 1; k < 6; k++) { g.beginPath(); g.moveTo(x0, top + ((bot - top) * k) / 6); g.lineTo(x0 + w, top + ((bot - top) * k) / 6); g.stroke(); }
    }
  },

  wood(g, r) {
    g.fillStyle = '#b8a089';
    g.fillRect(0, 0, SIZE, SIZE);
    const planks = 6;
    for (let p = 0; p < planks; p++) {
      const x0 = (p * SIZE) / planks, w = SIZE / planks;
      g.fillStyle = `hsl(28, ${18 + r() * 10}%, ${55 + r() * 15}%)`;
      g.fillRect(x0, 0, w, SIZE);
      for (let i = 0; i < 26; i++) {
        const x = x0 + r() * w, amp = 1 + r() * 3, freq = 0.01 + r() * 0.02;
        g.strokeStyle = `rgba(60,35,20,${0.12 + r() * 0.2})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        for (let y = 0; y <= SIZE; y += 8) g.lineTo(x + Math.sin(y * freq + i) * amp, y);
        g.stroke();
      }
      if (r() < 0.5) {
        const kx = x0 + w * (0.3 + r() * 0.4), ky = r() * SIZE;
        g.fillStyle = 'rgba(50,28,14,0.6)';
        g.beginPath(); g.ellipse(kx, ky, 3 + r() * 3, 6 + r() * 6, 0, 0, Math.PI * 2); g.fill();
      }
      g.fillStyle = 'rgba(20,10,5,0.7)';
      g.fillRect(x0, 0, 2, SIZE);
    }
  },

  // Japanese kawara roof tiles: rounded columns, overlapping rows.
  roof(g, r) {
    g.fillStyle = '#7e8494';
    g.fillRect(0, 0, SIZE, SIZE);
    const cols = 12, rows = 10;
    const cw = SIZE / cols, rh = SIZE / rows;
    for (let row = 0; row < rows; row++) {
      for (let c = 0; c < cols; c++) {
        const x = c * cw, y = row * rh;
        const shade = 0.85 + r() * 0.3;
        const grd = g.createLinearGradient(x, 0, x + cw, 0);
        grd.addColorStop(0, `rgba(40,44,54,${0.9})`);
        grd.addColorStop(0.45, `rgba(${Math.round(170 * shade)},${Math.round(176 * shade)},${Math.round(190 * shade)},1)`);
        grd.addColorStop(1, 'rgba(30,32,40,1)');
        g.fillStyle = grd;
        g.fillRect(x + 1, y, cw - 2, rh);
      }
      // Shadow under the overlapping lip of the next row
      const sh = g.createLinearGradient(0, row * rh, 0, row * rh + rh * 0.35);
      sh.addColorStop(0, 'rgba(0,0,0,0.65)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.fillRect(0, row * rh, SIZE, rh * 0.35);
    }
    speckle(g, r, 2500, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.15)'], 1.5);
  },

  // Irregular dry-stone castle base (ishigaki).
  stoneWall(g, r) {
    g.fillStyle = '#242220';
    g.fillRect(0, 0, SIZE, SIZE);
    let y = 0;
    while (y < SIZE) {
      const h = 40 + r() * 34;
      let x = -r() * 60;
      while (x < SIZE) {
        const w = 50 + r() * 70;
        const l = 38 + r() * 22;
        const sx = x + 3, sy = y + 3, sw = w - 6, sh = Math.min(h, SIZE - y) - 6;
        const grd = g.createLinearGradient(sx, sy, sx + sw * 0.3, sy + sh);
        grd.addColorStop(0, `hsl(${30 + r() * 20}, 6%, ${l + 10}%)`);
        grd.addColorStop(1, `hsl(${30 + r() * 20}, 6%, ${l - 12}%)`);
        g.fillStyle = grd;
        g.beginPath();
        const j = () => (r() - 0.5) * 8;
        g.moveTo(sx + j(), sy + j());
        g.lineTo(sx + sw + j(), sy + j());
        g.lineTo(sx + sw + j(), sy + sh + j());
        g.lineTo(sx + j(), sy + sh + j());
        g.closePath();
        g.fill();
        x += w;
      }
      y += h;
    }
    speckle(g, r, 6000, ['rgba(255,255,255,0.08)', 'rgba(0,0,0,0.2)'], 1.6);
    blotches(g, r, 30, ['rgba(40,60,30,A)'], 20, 60, 0.25); // moss
  },

  stone(g, r) {
    g.fillStyle = '#8b8780';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 70, ['rgba(60,58,54,A)', 'rgba(170,166,158,A)', 'rgba(60,80,50,A)'], 15, 70, 0.3);
    speckle(g, r, 14000, ['#6a665f', '#a8a39b', '#55524c', '#c2beb6'], 2);
  },

  crate(g, r) {
    PAINTERS.wood(g, r);
    g.strokeStyle = '#3a2414';
    g.lineWidth = 40;
    g.strokeRect(20, 20, SIZE - 40, SIZE - 40);
    g.lineWidth = 30;
    g.beginPath(); g.moveTo(30, 30); g.lineTo(SIZE - 30, SIZE - 30); g.stroke();
  },

  bark(g, r) {
    g.fillStyle = '#6b5544';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 180; i++) {
      const x = r() * SIZE, w = 4 + r() * 14;
      g.fillStyle = `rgba(${20 + r() * 30},${15 + r() * 20},${10 + r() * 15},${0.3 + r() * 0.4})`;
      g.beginPath();
      let y = 0;
      g.moveTo(x, 0);
      while (y < SIZE) { y += 20 + r() * 30; g.lineTo(x + (r() - 0.5) * 10, y); }
      g.lineTo(x + w, SIZE); g.lineTo(x + w, 0);
      g.fill();
    }
  },

  // Neutral fabric weave; tinted by material colour.
  cloth(g, r) {
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let y = 0; y < SIZE; y += 3) {
      g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.05})`;
      g.fillRect(0, y, SIZE, 1);
    }
    for (let x = 0; x < SIZE; x += 3) {
      g.fillStyle = `rgba(255,255,255,${0.03 + r() * 0.05})`;
      g.fillRect(x, 0, 1, SIZE);
    }
    blotches(g, r, 40, ['rgba(0,0,0,A)', 'rgba(255,255,255,A)'], 20, 80, 0.07);
  },

  // Lamellar armour: rows of small lacquered plates tied with cord.
  lamellar(g, r) {
    g.fillStyle = '#202020';
    g.fillRect(0, 0, SIZE, SIZE);
    const rows = 10, cols = 16;
    const h = SIZE / rows, w = SIZE / cols;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const grd = g.createLinearGradient(0, y * h, 0, y * h + h);
        const l = 70 + r() * 15;
        grd.addColorStop(0, `hsl(0,0%,${l + 12}%)`);
        grd.addColorStop(1, `hsl(0,0%,${l - 25}%)`);
        g.fillStyle = grd;
        g.fillRect(x * w + 1, y * h + 1, w - 2, h - 5);
      }
      // Lacing cord
      g.fillStyle = 'rgba(30,30,40,0.9)';
      for (let x = 0; x < cols; x++) g.fillRect(x * w + w / 2 - 1.5, y * h + h - 6, 3, 6);
    }
  },

  // Lord's robe: tortoiseshell (kikko) pattern.
  brocade(g, r) {
    g.fillStyle = '#c8c8c8';
    g.fillRect(0, 0, SIZE, SIZE);
    const s = 32;
    g.strokeStyle = '#ffe9a0';
    g.lineWidth = 2.5;
    for (let row = -1; row < SIZE / (s * 1.5) + 1; row++) {
      for (let col = -1; col < SIZE / (s * Math.sqrt(3)) + 1; col++) {
        const cx = col * s * Math.sqrt(3) + (row % 2 ? s * Math.sqrt(3) / 2 : 0);
        const cy = row * s * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = Math.PI / 6 + (k * Math.PI) / 3;
          g.lineTo(cx + Math.cos(a) * s * 0.92, cy + Math.sin(a) * s * 0.92);
        }
        g.closePath();
        g.stroke();
      }
    }
    speckle(g, r, 2000, ['rgba(0,0,0,0.1)'], 1.5);
  },

  // Forehead protector plate with an original swirl-and-wave emblem.
  emblem(g) {
    const grd = g.createLinearGradient(0, 0, 0, SIZE);
    grd.addColorStop(0, '#e6ecf2');
    grd.addColorStop(1, '#8c96a3');
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
    g.strokeStyle = '#2b2f36';
    g.lineWidth = 26;
    g.lineCap = 'round';
    g.beginPath();
    for (let a = 0; a < Math.PI * 3.2; a += 0.05) {
      const rad = 20 + a * 26;
      g.lineTo(SIZE / 2 + Math.cos(a) * rad, SIZE / 2 + Math.sin(a) * rad * 0.8);
    }
    g.stroke();
    g.fillStyle = '#2b2f36';
    for (const x of [40, SIZE - 40]) { g.beginPath(); g.arc(x, SIZE / 2, 16, 0, Math.PI * 2); g.fill(); }
  },

  moon(g, r) {
    g.fillStyle = '#f2ecd6';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 40, ['rgba(150,145,130,A)'], 20, 90, 0.45);
    for (let i = 0; i < 60; i++) {
      const x = r() * SIZE, y = r() * SIZE, s = 3 + r() * 14;
      g.strokeStyle = 'rgba(120,115,100,0.5)';
      g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.stroke();
    }
  },

  // Wispy noise used for mist and clouds (alpha in the white channel).
  mist(g, r) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, SIZE, SIZE);
    blotches(g, r, 160, ['rgba(255,255,255,A)'], 25, 120, 0.22);
  },

  // Opaque centre fading to transparent at the top/bottom edges (roads).
  edgeFade(g) {
    const grd = g.createLinearGradient(0, 0, 0, SIZE);
    grd.addColorStop(0, '#000');
    grd.addColorStop(0.18, '#fff');
    grd.addColorStop(0.82, '#fff');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
  },

  // Opaque centre fading out radially (soft-edged ground patches).
  softPatch(g) {
    const grd = g.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.3, SIZE / 2, SIZE / 2, SIZE / 2);
    grd.addColorStop(0, '#fff');
    grd.addColorStop(1, '#000');
    g.fillStyle = grd;
    g.fillRect(0, 0, SIZE, SIZE);
  },

  water(g, r) {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 400; i++) {
      const x = r() * SIZE, y = r() * SIZE, s = 6 + r() * 30;
      g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${0.12 + r() * 0.15})`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath(); g.ellipse(x, y, s, s * 0.6, 0, 0, Math.PI * 2); g.stroke();
    }
  },
};

/** Returns a cached, repeat-wrapped texture. `color` marks sRGB colour maps. */
export function tex(name, { color = true, size = SIZE } = {}) {
  const key = `${name}|${color}`;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(size);
  PAINTERS[name](g, rng(name.length * 7919 + name.charCodeAt(0)));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** A material whose texture tiles every `tile` metres (geometry UVs are in metres). */
export function texturedMaterial(name, tile, opts = {}) {
  const { bump = 0, glow = null, ...rest } = opts;
  const map = tex(name).clone();
  map.repeat.set(1 / tile, 1 / tile);
  map.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.9, ...rest });
  if (bump) {
    const b = tex(name, { color: false }).clone();
    b.repeat.copy(map.repeat);
    b.needsUpdate = true;
    m.bumpMap = b;
    m.bumpScale = bump;
  }
  if (glow) {
    // Emissive mask painted to line up with the colour map.
    const e = tex(glow).clone();
    e.repeat.copy(map.repeat);
    e.needsUpdate = true;
    m.emissiveMap = e;
  }
  return m;
}

/** A soft round sprite texture (for halos, glows). */
export function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const key = `radial|${inner}|${outer}`;
  if (cache.has(key)) return cache.get(key);
  const [c, g] = canvas(size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}
