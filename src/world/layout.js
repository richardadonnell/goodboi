import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Shared vocabulary for the city district: palette, materials, the geometry
 * batcher every builder writes into, and the district's layout constants.
 *
 * Everything static goes through `Batcher` so the whole district collapses to
 * roughly one draw call per material instead of one per prop.
 */

export const PALETTE = {
  asphalt: 0x0e1018,
  concrete: 0x1a1e2c,
  wallDark: 0x151a29,
  wallMid: 0x232941,
  wallWarm: 0x2a2338,
  wallPurple: 0x2e2450,
  wallBlue: 0x1c2740,
  metal: 0x2b3145,
  metalDark: 0x191d2a,
  rust: 0x3a2a26,
  canalWater: 0x0a1a22,
};

export const NEON = {
  pink: 0xff2e88,
  cyan: 0x22e0ff,
  orange: 0xff8a2b,
  yellow: 0xffd23f,
  green: 0x3dff9e,
  violet: 0xa45cff,
};

/** Structural (lit) materials. Flat-shaded, low roughness variance. */
export const MATS = {
  asphalt: new THREE.MeshStandardMaterial({ color: PALETTE.asphalt, roughness: 0.85, metalness: 0.1, flatShading: true }),
  concrete: new THREE.MeshStandardMaterial({ color: PALETTE.concrete, roughness: 0.95, flatShading: true }),
  wallDark: new THREE.MeshStandardMaterial({ color: PALETTE.wallDark, roughness: 0.9, flatShading: true }),
  wallMid: new THREE.MeshStandardMaterial({ color: PALETTE.wallMid, roughness: 0.9, flatShading: true }),
  wallWarm: new THREE.MeshStandardMaterial({ color: PALETTE.wallWarm, roughness: 0.9, flatShading: true }),
  wallPurple: new THREE.MeshStandardMaterial({ color: PALETTE.wallPurple, roughness: 0.9, flatShading: true }),
  wallBlue: new THREE.MeshStandardMaterial({ color: PALETTE.wallBlue, roughness: 0.9, flatShading: true }),
  metal: new THREE.MeshStandardMaterial({ color: PALETTE.metal, roughness: 0.55, metalness: 0.6, flatShading: true }),
  metalDark: new THREE.MeshStandardMaterial({ color: PALETTE.metalDark, roughness: 0.6, metalness: 0.5, flatShading: true }),
  rust: new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 1, flatShading: true }),
  cable: new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 1 }),
  // Wet asphalt / puddles: cheap fake reflection. Full metalness would render
  // black without an env map, so this is glossy-dielectric instead — the neon
  // point lights streak across it and read as standing water.
  puddle: new THREE.MeshStandardMaterial({ color: 0x121a2b, roughness: 0.22, metalness: 0.3 }),
  water: new THREE.MeshStandardMaterial({ color: PALETTE.canalWater, roughness: 0.18, metalness: 0.35 }),
};

/** The wall palette buildings pick from. */
export const WALL_MATS = [MATS.wallDark, MATS.wallMid, MATS.wallWarm, MATS.wallPurple, MATS.wallBlue];

/** Unlit emissive materials — these are what the bloom pass latches onto. */
export function neonMaterial(color, { opacity = 1 } = {}) {
  return new THREE.MeshBasicMaterial({
    color,
    toneMapped: false,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide,
  });
}

/** Window lights: a handful of shared materials so windows merge into few draws. */
export const WINDOW_MATS = {
  warm: neonMaterial(0xffc477),
  cyan: neonMaterial(0x8ff0ff),
  pink: neonMaterial(0xff8fc4),
  dim: new THREE.MeshBasicMaterial({ color: 0x2a3350, toneMapped: false, side: THREE.DoubleSide }),
  dark: new THREE.MeshBasicMaterial({ color: 0x0a0d16, toneMapped: false, side: THREE.DoubleSide }),
};

// ---------------------------------------------------------------------------
// District layout — every builder and every Phase 3 hook reads these.
// The dog spawns in the south (+Z) and works north (-Z) toward home.
// ---------------------------------------------------------------------------

export const BOUNDS = 60;          // playable half-extent; outer wall ring sits here
export const GROUND_Y = 0;
export const ROOF_Y = 9;           // first rooftop deck height
export const CANAL_WALL_H = 5.5;

export const ZONES = {
  spawnAlley: { x: -4, z: 42, halfW: 2.6, z0: 32, z1: 52 },
  plaza: { x: 0, z: 18, radius: 13 },
  marketAlley: { z: -1, halfD: 4, x0: 2, x1: 36 },
  canal: { z: -19, halfD: 3.5, x0: -46, x1: -6 },
  homeRun: { x: 0, halfW: 4, z0: -46, z1: -12 },
};

/** Deterministic RNG so the "handcrafted" district is identical every load. */
export function makeRng(seed = 1337) {
  let t = seed >>> 0;
  return function rng() {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function range(rng, lo, hi) {
  return lo + rng() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Batcher
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

/**
 * Accumulates transformed geometry per material, then emits one merged mesh
 * per material. Keeps the whole static district under ~40 draw calls.
 */
export class Batcher {
  constructor() {
    this.buckets = new Map();   // material -> BufferGeometry[]
    this.materials = [];
  }

  /** Add an arbitrary geometry positioned/rotated/scaled into world space. */
  add(geometry, material, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) {
    _p.set(x, y, z);
    _e.set(rx, ry, rz);
    _q.setFromEuler(_e);
    _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    return this._push(geometry, material, _m);
  }

  _push(geometry, material, matrix) {
    const g = geometry.clone().applyMatrix4(matrix);
    g.deleteAttribute('uv1');
    let bucket = this.buckets.get(material);
    if (!bucket) {
      bucket = [];
      this.buckets.set(material, bucket);
      this.materials.push(material);
    }
    bucket.push(g);
    return this;
  }

  /** Cylinder spanning `from` -> `to` (Vector3), used for cables and pipes. */
  segment(material, from, to, radius = 0.05) {
    _p.subVectors(to, from);
    const len = _p.length();
    if (len < 1e-4) return this;
    _q.setFromUnitVectors(UP, _p.divideScalar(len));
    _p.addVectors(from, to).multiplyScalar(0.5);
    _s.set(radius, len, radius);
    _m.compose(_p, _q, _s);
    return this._push(unitCylinder, material, _m);
  }

  /** Axis-aligned box; (x, y, z) is the CENTER. */
  box(material, x, y, z, w, h, d, ry = 0) {
    return this.add(unitBox, material, { x, y, z, ry, sx: w, sy: h, sz: d });
  }

  /** Box resting ON y=base, (x, z) centered — matches how colliders are specced. */
  boxOn(material, x, base, z, w, h, d, ry = 0) {
    return this.box(material, x, base + h / 2, z, w, h, d, ry);
  }

  /** Flat quad lying on the XZ plane, facing up. */
  floor(material, x, y, z, w, d, ry = 0) {
    return this.add(unitPlane, material, { x, y, z, rx: -Math.PI / 2, ry: 0, rz: ry, sx: w, sy: d });
  }

  /** Vertical quad; `ry` rotates it about Y (0 faces +Z). */
  panel(material, x, y, z, w, h, ry = 0) {
    return this.add(unitPlane, material, { x, y, z, ry, sx: w, sy: h });
  }

  cylinder(material, x, y, z, r, h, ry = 0, rx = 0, rz = 0) {
    return this.add(unitCylinder, material, { x, y, z, rx, ry, rz, sx: r, sy: h, sz: r });
  }

  /** Emit merged meshes into `parent`. Safe to call once. */
  build(parent, { castShadow = true, receiveShadow = true } = {}) {
    let drawCalls = 0;
    for (const material of this.materials) {
      const parts = this.buckets.get(material);
      if (!parts.length) continue;
      const merged = mergeGeometries(parts, false);
      for (const g of parts) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      const lit = material.isMeshStandardMaterial;
      mesh.castShadow = castShadow && lit;
      mesh.receiveShadow = receiveShadow && lit;
      mesh.matrixAutoUpdate = false;
      parent.add(mesh);
      drawCalls++;
    }
    this.buckets.clear();
    this.materials.length = 0;
    return drawCalls;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitPlane = new THREE.PlaneGeometry(1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 8);

// ---------------------------------------------------------------------------
// Collider helpers — the contract DogController consumes.
// ---------------------------------------------------------------------------

/** Solid box sitting ON `base`, centered at (x, z). Returns the Box3. */
export function collideOn(colliders, x, base, z, w, h, d) {
  const box = new THREE.Box3(
    new THREE.Vector3(x - w / 2, base, z - d / 2),
    new THREE.Vector3(x + w / 2, base + h, z + d / 2),
  );
  colliders.push(box);
  return box;
}

/** Four walls enclosing a rectangle, leaving `gaps` (arrays of [side, center, width]). */
export function wallRing(ctx, { x0, x1, z0, z1, height, thickness = 1.5, material = MATS.concrete }) {
  const { batcher, colliders } = ctx;
  const spans = [
    { axis: 'z', at: z0, from: x0, to: x1 },
    { axis: 'z', at: z1, from: x0, to: x1 },
    { axis: 'x', at: x0, from: z0, to: z1 },
    { axis: 'x', at: x1, from: z0, to: z1 },
  ];
  for (const s of spans) {
    const len = s.to - s.from + thickness;
    const mid = (s.from + s.to) / 2;
    if (s.axis === 'z') {
      batcher.boxOn(material, mid, 0, s.at, len, height, thickness);
      collideOn(colliders, mid, 0, s.at, len, height, thickness);
    } else {
      batcher.boxOn(material, s.at, 0, mid, thickness, height, len);
      collideOn(colliders, s.at, 0, mid, thickness, height, len);
    }
  }
}

/** A straight run of wall along X or Z, batched + collided in one call. */
export function wall(ctx, material, x, base, z, w, h, d) {
  ctx.batcher.boxOn(material, x, base, z, w, h, d);
  collideOn(ctx.colliders, x, base, z, w, h, d);
}
