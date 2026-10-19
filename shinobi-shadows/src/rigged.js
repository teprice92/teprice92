import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

// Loads the rigged character models (GLB files generated with Higgsfield's
// image-to-3D, auto-rigged with a humanoid skeleton) and adapts them to the
// game's procedural animation.
//
// The animators in models.js pose a set of "virtual joints" (hips, torso,
// head, arms, forearms, legs, shins), exactly as they do for the primitive
// characters. sync() then copies each joint's rotation onto the matching bone,
// expressed in model space, so the same code animates both kinds of model.

const loader = new GLTFLoader();
const templates = new Map();

/** Loads every model in the manifest ({ id: url }). Missing files are skipped. */
export async function loadModels(manifest, onProgress) {
  let done = 0;
  const entries = Object.entries(manifest);
  await Promise.all(entries.map(async ([id, url]) => {
    try {
      const gltf = await loader.loadAsync(url);
      templates.set(id, prepare(gltf.scene));
    } catch (e) {
      // No model (or it failed to load): that character keeps its primitive look.
      if (!String(e?.message || e).includes('404')) console.warn(`Model ${id} not loaded:`, e?.message || e);
    }
    onProgress?.(++done, entries.length);
  }));
}

export function hasModel(id) { return templates.has(id); }

function prepare(scene) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  return { scene, box, height: box.max.y - box.min.y };
}

// ---------------- Bone lookup ----------------

const strip = (n) => n.toLowerCase().replace(/^mixamorig[:_]?/, '').replace(/[^a-z0-9]/g, '');

function findBones(root) {
  const bones = [];
  root.traverse((o) => { if (o.isBone) bones.push(o); });
  const pos = new Map(bones.map((b) => [b, b.getWorldPosition(new THREE.Vector3())]));
  const byTest = (test) => bones.filter((b) => test(strip(b.name)));
  const first = (list) => list.sort((a, b) => depth(a) - depth(b))[0] || null;
  const side = (list, s) => list.filter((b) => Math.sign(pos.get(b).x) === s).sort((a, b) => depth(a) - depth(b))[0] || null;

  const hips = first(byTest((n) => /hips|pelvis/.test(n))) || first(bones.slice());
  const spines = byTest((n) => /spine|chest/.test(n));
  const neck = first(byTest((n) => /neck/.test(n)));
  const head = first(byTest((n) => /head/.test(n) && !/end|top/.test(n)));
  const upperArm = byTest((n) => (/upperarm|(^|left|right|l|r)arm$/.test(n)) && !/fore|lower/.test(n));
  const foreArm = byTest((n) => /forearm|lowerarm/.test(n));
  const hand = byTest((n) => /hand$/.test(n));
  const thigh = byTest((n) => /upleg|thigh|upperleg/.test(n));
  const shin = byTest((n) => (/(^|left|right|l|r)leg$|calf|lowerleg|shin|knee/.test(n)) && !/up/.test(n));

  const b = { hips, spine: first(spines), neck, head };
  for (const s of [-1, 1]) {
    const k = s < 0 ? 'L' : 'R'; // matches the side convention of the primitive models
    b['arm' + k] = side(upperArm, s);
    b['fore' + k] = side(foreArm, s);
    b['hand' + k] = side(hand, s);
    b['leg' + k] = side(thigh, s);
    b['shin' + k] = side(shin, s);
  }
  return b;
}

function depth(o) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }

// ---------------- Instancing ----------------

/**
 * Creates an animated instance.
 * opts: { height, hue (radians), tint (hex), scale }
 * Returns { group, parts, anim, materials, sync, attach(side, object) }.
 */
export function createRigged(id, { height = 1.75, hue = 0, tint = null, width = 1 } = {}) {
  const t = templates.get(id);
  const inst = SkeletonUtils.clone(t.scene);
  const materials = [];
  const matCache = new Map();
  inst.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // skinned bounds don't follow the animation
    const one = (m) => {
      if (!matCache.has(m)) {
        const c = m.clone();
        if (hue) hueShift(c, hue);
        if (tint) c.color.multiply(new THREE.Color(tint));
        if (c.emissive) c.emissive.setRGB(0, 0, 0);
        matCache.set(m, c);
        materials.push(c);
      }
      return matCache.get(m);
    };
    o.material = Array.isArray(o.material) ? o.material.map(one) : one(o.material);
  });

  const group = new THREE.Group();
  const root = new THREE.Group();
  const holder = new THREE.Group();
  group.add(root);
  root.add(holder);
  holder.add(inst);
  const s = height / t.height;
  holder.scale.set(s * width, s, s * width);
  const cx = (t.box.min.x + t.box.max.x) / 2, cz = (t.box.min.z + t.box.max.z) / 2;
  inst.position.set(-cx, -t.box.min.y, -cz);

  group.updateMatrixWorld(true);
  const bones = findBones(inst);
  const groupInv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const modelQuat = (o) => {
    const m = new THREE.Matrix4().multiplyMatrices(groupInv, o.matrixWorld);
    return new THREE.Quaternion().setFromRotationMatrix(m.extractRotation(m));
  };

  // Rest pose: lower the T-posed arms to hang at the sides.
  const base = {};
  for (const k of ['L', 'R']) {
    const a = bones['arm' + k], f = bones['fore' + k];
    if (!a || !f) continue;
    const pa = a.getWorldPosition(new THREE.Vector3()), pf = f.getWorldPosition(new THREE.Vector3());
    const cur = pf.sub(pa).normalize();
    const outward = Math.sign(cur.x) || (k === 'R' ? 1 : -1);
    const target = new THREE.Vector3(outward * Math.sin(0.18), -Math.cos(0.18), 0.04).normalize();
    base['arm' + k] = new THREE.Quaternion().setFromUnitVectors(cur, target);
  }

  // Per-bone bind data.
  const drive = [];
  const names = ['spine', 'head', 'armL', 'armR', 'foreL', 'foreR', 'legL', 'legR', 'shinL', 'shinR'];
  const virt = { hips: new THREE.Object3D(), torso: new THREE.Object3D() };
  virt.hips.position.y = 0.92;
  for (const n of names) {
    const bone = bones[n];
    const key = n === 'spine' ? 'torso' : n;
    if (!virt[key]) virt[key] = new THREE.Object3D();
    if (!bone) continue;
    drive.push({
      bone, v: virt[key],
      bindLocal: bone.quaternion.clone(),
      parentWorld: bone.parent ? modelQuat(bone.parent) : new THREE.Quaternion(),
      base: base[n] || null,
    });
  }
  // Hips move in body space: precompute bind position and the parent's inverse.
  const hipsBone = bones.hips;
  const hipsBind = hipsBone ? {
    model: hipsBone.getWorldPosition(new THREE.Vector3()).applyMatrix4(groupInv),
    parentInv: new THREE.Matrix4().multiplyMatrices(groupInv, hipsBone.parent.matrixWorld).invert(),
  } : null;

  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qInv = new THREE.Quaternion(), e = new THREE.Euler();
  const tmp = new THREE.Vector3();

  function sync() {
    for (const d of drive) {
      e.set(d.v.rotation.x, d.v.rotation.y, d.v.rotation.z, 'XYZ');
      qa.setFromEuler(e);
      if (d.base) qa.multiply(d.base);
      // local = (P^-1 * D * P) * bindLocal
      qInv.copy(d.parentWorld).invert();
      qb.copy(qInv).multiply(qa).multiply(d.parentWorld).multiply(d.bindLocal);
      d.bone.quaternion.copy(qb);
    }
    if (hipsBone) {
      // Raise/lower the hips (crouching, running bob).
      tmp.copy(hipsBind.model);
      tmp.y += (virt.hips.position.y - 0.92) * 0.9;
      hipsBone.position.copy(tmp.applyMatrix4(hipsBind.parentInv));
    }
  }

  /** Attach a prop to a hand; it sits in the hand as it would on the primitive rig. */
  function attach(k, object) {
    const hand = bones['hand' + k] || bones['fore' + k];
    if (!hand) { root.add(object); return; }
    group.updateMatrixWorld(true);
    const handWorld = modelQuat(hand);
    const rest = base['arm' + k] ? base['arm' + k].clone() : new THREE.Quaternion();
    // world(object) = rest * handBind * q  ==  identity  =>  q = (rest * handBind)^-1
    object.quaternion.copy(rest.multiply(handWorld).invert());
    const ws = new THREE.Vector3();
    hand.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), ws);
    object.scale.setScalar(1 / ws.x);
    hand.add(object);
  }

  const parts = {
    root, hips: virt.hips, torso: virt.torso, head: virt.head,
    armL: virt.armL, armR: virt.armR, foreL: virt.foreL, foreR: virt.foreR,
    legL: virt.legL, legR: virt.legR, shinL: virt.shinL, shinR: virt.shinR,
    scarf: [], blade: null, weapon: null,
  };
  sync();
  return { group, parts, anim: { phase: Math.random() * 6, breathe: 0 }, materials, sync, attach, rigged: true };
}

/** Rotates the hue of a material's colour (lets one model serve several factions). */
function hueShift(material, angle) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHue = { value: angle };
    shader.fragmentShader = 'uniform float uHue;\n' + shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        const mat3 toYIQ = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
        const mat3 toRGB = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
        vec3 yiq = toYIQ * diffuseColor.rgb;
        float c = cos(uHue), s = sin(uHue);
        yiq.yz = mat2(c, s, -s, c) * yiq.yz;
        diffuseColor.rgb = max(toRGB * yiq, 0.0);
      }`);
  };
  material.customProgramCacheKey = () => `hue${angle}`;
}
