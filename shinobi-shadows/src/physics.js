// Lightweight axis-aligned box physics. The whole level is built from boxes,
// which keeps collision, line-of-sight and grappling cheap and predictable.

export class Box {
  constructor(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
    this.min = { x: minX, y: minY, z: minZ };
    this.max = { x: maxX, y: maxY, z: maxZ };
    this.tag = tag;
  }
}

const EPS = 0.001;
const STEP_HEIGHT = 0.55;
const MAX_SUBSTEP = 0.35;

function overlaps(pos, half, height, b) {
  return (
    pos.x + half > b.min.x && pos.x - half < b.max.x &&
    pos.z + half > b.min.z && pos.z - half < b.max.z &&
    pos.y + height > b.min.y && pos.y < b.max.y
  );
}

/**
 * Moves an upright box (feet at pos, given half-width and height) by `delta`,
 * sliding along walls. Mutates `pos`. Returns contact information.
 */
export function moveAndCollide(pos, half, height, delta, colliders, canStep = true) {
  const res = { onGround: false, hitCeiling: false, hitWall: false, wallNormal: { x: 0, z: 0 }, stepped: false };
  const dist = Math.max(Math.abs(delta.x), Math.abs(delta.y), Math.abs(delta.z));
  const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP));
  const dx = delta.x / steps, dy = delta.y / steps, dz = delta.z / steps;

  for (let s = 0; s < steps; s++) {
    // Horizontal axes first so we can step up onto low ledges.
    for (const axis of ['x', 'z']) {
      const d = axis === 'x' ? dx : dz;
      if (d === 0) continue;
      pos[axis] += d;
      for (const b of colliders) {
        if (!overlaps(pos, half, height, b)) continue;
        const rise = b.max.y - pos.y;
        if (canStep && rise > 0 && rise <= STEP_HEIGHT && !blockedAbove(pos, half, height, b.max.y, colliders)) {
          pos.y = b.max.y + EPS;
          res.stepped = true;
          continue;
        }
        if (d > 0) pos[axis] = b.min[axis] - half - EPS;
        else pos[axis] = b.max[axis] + half + EPS;
        res.hitWall = true;
        res.wallNormal[axis] = d > 0 ? -1 : 1;
      }
    }
    if (dy !== 0) {
      pos.y += dy;
      for (const b of colliders) {
        if (!overlaps(pos, half, height, b)) continue;
        if (dy < 0) { pos.y = b.max.y + EPS; res.onGround = true; }
        else { pos.y = b.min.y - height - EPS; res.hitCeiling = true; }
      }
    }
  }
  return res;
}

function blockedAbove(pos, half, height, newY, colliders) {
  const test = { x: pos.x, y: newY + EPS * 2, z: pos.z };
  for (const b of colliders) if (overlaps(test, half, height, b)) return true;
  return false;
}

/** Checks for ground directly beneath the feet (used for "grounded" when not moving). */
export function groundBelow(pos, half, colliders, probe = 0.08) {
  for (const b of colliders) {
    if (pos.x + half > b.min.x && pos.x - half < b.max.x &&
        pos.z + half > b.min.z && pos.z - half < b.max.z &&
        pos.y >= b.max.y - 0.05 && pos.y - probe <= b.max.y) return b;
  }
  return null;
}

/** Slab-method ray vs box. Returns {t, n:{x,y,z}} or null. */
export function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT;
  let nAxis = -1, nSign = 0;
  for (let i = 0; i < 3; i++) {
    const a = i === 0 ? 'x' : i === 1 ? 'y' : 'z';
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < b.min[a] || o[a] > b.max[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (b.min[a] - o[a]) * inv;
    let t2 = (b.max[a] - o[a]) * inv;
    let sign = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
    if (t1 > tmin) { tmin = t1; nAxis = i; nSign = sign; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (nAxis === -1) return null; // origin inside the box
  const n = { x: 0, y: 0, z: 0 };
  n[nAxis === 0 ? 'x' : nAxis === 1 ? 'y' : 'z'] = nSign;
  return { t: tmin, n };
}

/** Nearest hit of a ray against all colliders. `d` must be normalised. */
export function raycast(colliders, o, d, maxT) {
  let best = null;
  for (const b of colliders) {
    const h = rayBox(o, d, b, best ? best.t : maxT);
    if (h && (!best || h.t < best.t)) { best = h; best.box = b; }
  }
  if (best) {
    best.point = { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t };
  }
  return best;
}

/** True if the straight segment between a and b is unobstructed. */
export function lineOfSight(colliders, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return true;
  const d = { x: dx / len, y: dy / len, z: dz / len };
  for (const box of colliders) {
    if (rayBox(a, d, box, len - 0.05)) return false;
  }
  return true;
}

export function pointInBoxes(colliders, p) {
  for (const b of colliders) {
    if (p.x > b.min.x && p.x < b.max.x && p.y > b.min.y && p.y < b.max.y && p.z > b.min.z && p.z < b.max.z) return b;
  }
  return null;
}
