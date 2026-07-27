import * as THREE from 'three';
import {
  MATS, WALL_MATS, WINDOW_MATS, NEON,
  Batcher, collideOn, makeRng, pick, range,
} from './layout.js';

/**
 * Building blocks for the district. A "building" is a cluster of 1–3 stacked or
 * offset boxes with an emissive window grid, a parapet, and roof junk. Every
 * box contributes a collider so the dog can never walk through a facade.
 */

const WINDOW_LOOK = [
  WINDOW_MATS.warm, WINDOW_MATS.warm, WINDOW_MATS.dim, WINDOW_MATS.dark,
  WINDOW_MATS.cyan, WINDOW_MATS.dark, WINDOW_MATS.pink, WINDOW_MATS.dim,
];

/**
 * One tower/slab with windows and roof detail.
 *
 * ctx: { batcher, colliders, rng }
 * (x, z) is the footprint center; the box rests on `base`.
 */
export function building(ctx, { x, z, w, d, h, base = 0, material, windows = true, parapet = true, roofProps = true, solid = true }) {
  const { batcher, colliders, rng } = ctx;
  const mat = material || pick(rng, WALL_MATS);

  batcher.boxOn(mat, x, base, z, w, h, d);
  if (solid) collideOn(colliders, x, base, z, w, h, d);

  if (windows) windowGrid(ctx, { x, z, w, d, h, base });

  if (parapet && h > 3) {
    // Lip around the roof — reads as a real rooftop and blocks a straight walk-off.
    const t = 0.35;
    const top = base + h;
    batcher.boxOn(MATS.concrete, x, top, z - d / 2 + t / 2, w, 0.55, t);
    batcher.boxOn(MATS.concrete, x, top, z + d / 2 - t / 2, w, 0.55, t);
    batcher.boxOn(MATS.concrete, x - w / 2 + t / 2, top, z, t, 0.55, d - t * 2);
    batcher.boxOn(MATS.concrete, x + w / 2 - t / 2, top, z, t, 0.55, d - t * 2);
  }

  if (roofProps) roofClutter(ctx, { x, z, w, d, top: base + h });

  return { x, z, w, d, h, top: base + h };
}

/** Emissive window quads on all four faces, slightly proud of the wall. */
function windowGrid(ctx, { x, z, w, d, h, base }) {
  const { batcher, rng } = ctx;
  const eps = 0.06;
  const floorH = 3.0;
  const rows = Math.max(0, Math.floor((h - 1.6) / floorH));
  if (rows <= 0) return;

  const faces = [
    { ry: 0, span: w, cx: x, cz: z + d / 2 + eps, ax: 'x' },
    { ry: Math.PI, span: w, cx: x, cz: z - d / 2 - eps, ax: 'x' },
    { ry: Math.PI / 2, span: d, cx: x + w / 2 + eps, cz: z, ax: 'z' },
    { ry: -Math.PI / 2, span: d, cx: x - w / 2 - eps, cz: z, ax: 'z' },
  ];

  for (const face of faces) {
    const cols = Math.max(1, Math.floor(face.span / 2.2));
    const step = face.span / cols;
    const ww = Math.min(1.1, step * 0.5);
    for (let r = 0; r < rows; r++) {
      const wy = base + 2.0 + r * floorH;
      if (wy + 0.8 > base + h) break;
      for (let c = 0; c < cols; c++) {
        if (rng() < 0.18) continue;      // missing panes keep the grid from reading as wallpaper
        const off = -face.span / 2 + step * (c + 0.5);
        const px = face.ax === 'x' ? face.cx + off : face.cx;
        const pz = face.ax === 'x' ? face.cz : face.cz + off;
        batcher.panel(pick(rng, WINDOW_LOOK), px, wy, pz, ww, 1.4, face.ry);
      }
    }
  }
}

/** AC units, vents, pipes, water tanks — the silhouette breakers. */
function roofClutter(ctx, { x, z, w, d, top }) {
  const { batcher, rng } = ctx;
  const count = Math.floor(range(rng, 1, 4));
  for (let i = 0; i < count; i++) {
    const px = x + range(rng, -w / 2 + 1.2, w / 2 - 1.2);
    const pz = z + range(rng, -d / 2 + 1.2, d / 2 - 1.2);
    const roll = rng();
    if (roll < 0.45) {
      // AC unit
      const uw = range(rng, 1.0, 1.8);
      batcher.boxOn(MATS.metal, px, top, pz, uw, range(rng, 0.6, 1.0), uw * 0.8);
      batcher.cylinder(MATS.metalDark, px, top + 0.9, pz, uw * 0.28, 0.12);
    } else if (roll < 0.75) {
      // vent stack
      const hh = range(rng, 1.2, 2.6);
      batcher.cylinder(MATS.metalDark, px, top + hh / 2, pz, range(rng, 0.18, 0.32), hh);
      batcher.cylinder(MATS.metal, px, top + hh + 0.1, pz, 0.4, 0.2);
    } else {
      // water tank on stilts
      const r = range(rng, 0.7, 1.1);
      const hh = range(rng, 1.4, 2.2);
      batcher.cylinder(MATS.rust, px, top + 1.0 + hh / 2, pz, r, hh);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        batcher.boxOn(MATS.metalDark, px + sx * r * 0.6, top, pz + sz * r * 0.6, 0.12, 1.0, 0.12);
      }
    }
  }
}

/** Wall-hugging fire escape / pipes — pure decoration on a facade. */
export function facadePipes(ctx, { x, z, ry = 0, height, count = 3 }) {
  const { batcher, rng } = ctx;
  for (let i = 0; i < count; i++) {
    const off = range(rng, -2.5, 2.5);
    const px = x + Math.cos(ry) * off;
    const pz = z - Math.sin(ry) * off;
    const h = height * range(rng, 0.6, 1.0);
    batcher.cylinder(MATS.rust, px, h / 2, pz, range(rng, 0.09, 0.16), h);
    batcher.box(MATS.metalDark, px, h * 0.5, pz, 0.34, 0.14, 0.34);
  }
}

/**
 * A block of buildings filling a rectangle, used to pack the district edges.
 * Deterministic given `seed`.
 */
export function buildingBlock(ctx, { x0, x1, z0, z1, minH = 6, maxH = 22, seed = 1 }) {
  const rng = makeRng(seed);
  const local = { ...ctx, rng };
  const cellW = 9;
  const cols = Math.max(1, Math.round((x1 - x0) / cellW));
  const rows = Math.max(1, Math.round((z1 - z0) / cellW));
  const sw = (x1 - x0) / cols;
  const sd = (z1 - z0) / rows;
  const made = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cx = x0 + sw * (c + 0.5);
      const cz = z0 + sd * (r + 0.5);
      const w = sw * range(rng, 0.72, 0.96);
      const d = sd * range(rng, 0.72, 0.96);
      const h = range(rng, minH, maxH);
      made.push(building(local, { x: cx, z: cz, w, d, h }));
      // occasional squat annex for a stepped silhouette
      if (rng() < 0.35) {
        const aw = w * range(rng, 0.4, 0.6);
        made.push(building(local, {
          x: cx + (rng() < 0.5 ? -1 : 1) * (w / 2 + aw / 2) * 0.9,
          z: cz, w: aw, d: d * 0.7, h: h * range(rng, 0.25, 0.5),
          roofProps: false, parapet: false,
        }));
      }
    }
  }
  return made;
}

/** Walkable rooftop deck (a thin slab you can stand on) with a correct collider top. */
export function deck(ctx, { x, z, w, d, y, thickness = 0.6, material = MATS.concrete, rail = true }) {
  const { batcher, colliders } = ctx;
  batcher.boxOn(material, x, y - thickness, z, w, thickness, d);
  collideOn(colliders, x, y - thickness, z, w, thickness, d);
  if (rail) {
    // knee-high edging: visual guide, deliberately too low to block a jump
    for (const [ox, oz, rw, rd] of [
      [0, -d / 2 + 0.1, w, 0.2], [0, d / 2 - 0.1, w, 0.2],
      [-w / 2 + 0.1, 0, 0.2, d], [w / 2 - 0.1, 0, 0.2, d],
    ]) {
      batcher.boxOn(MATS.metalDark, x + ox, y, z + oz, rw, 0.3, rd);
    }
  }
  return new THREE.Vector3(x, y, z);
}

/** Cluster of crates/dumpsters — cover and climbable steps. */
export function crates(ctx, { x, z, seed = 3, count = 4 }) {
  const rng = makeRng(seed);
  for (let i = 0; i < count; i++) {
    const s = range(rng, 0.8, 1.4);
    const px = x + range(rng, -2.2, 2.2);
    const pz = z + range(rng, -2.2, 2.2);
    const mat = rng() < 0.4 ? MATS.rust : MATS.metalDark;
    ctx.batcher.boxOn(mat, px, 0, pz, s, s, s, range(rng, -0.4, 0.4));
    collideOn(ctx.colliders, px, 0, pz, s, s, s);
  }
}

export { NEON, Batcher };
