import * as THREE from 'three';
import { MATS, NEON, neonMaterial, makeRng, range } from './layout.js';

/**
 * Neon: signs, tube strips, hanging cables and street lamps.
 *
 * Static neon (strips, most signs) is batched with the rest of the district.
 * Anything that flickers keeps its own mesh + material and registers an updater,
 * which is why `NeonSystem.update(dt)` exists.
 */

const _tmp = new THREE.Vector3();

/**
 * Call sites specify light strength in readable "brightness" units (2–10);
 * three.js point lights are physical (inverse-square with decay 2), so they get
 * scaled up here rather than at every call site.
 */
const LIGHT_GAIN = 8;

export class NeonSystem {
  constructor(group) {
    this.group = group;
    this.flickers = [];
    this.lights = [];
    this.t = 0;
  }

  /**
   * A glowing panel (sign face). Not batched — it may flicker and it may carry
   * a light. `ry` 0 faces +Z.
   */
  sign(x, y, z, w, h, color, { ry = 0, flicker = null, light = 0, backing = true } = {}) {
    const mat = neonMaterial(color);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry;
    this.group.add(mesh);

    if (backing) {
      const back = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.25),
        MATS.metalDark,
      );
      back.position.set(x - Math.sin(ry) * 0.16, y, z - Math.cos(ry) * 0.16);
      back.rotation.y = ry;
      this.group.add(back);
    }

    let pointLight = null;
    if (light > 0) {
      pointLight = new THREE.PointLight(color, light * LIGHT_GAIN, 26, 2);
      pointLight.position.set(x + Math.sin(ry) * 1.2, y, z + Math.cos(ry) * 1.2);
      this.group.add(pointLight);
      this.lights.push(pointLight);
    }

    if (flicker) {
      this.flickers.push({
        mat, light: pointLight,
        base: 1, lightBase: light * LIGHT_GAIN,
        phase: Math.random() * 10,
        ...FLICKER[flicker],
      });
    }
    return mesh;
  }

  /** Chunky "letter" boxes spelling a shape — abstract glyph blocks, not real text. */
  letterSign(x, y, z, color, { ry = 0, glyphs = 4, seed = 7, flicker = null, light = 2.5 } = {}) {
    const rng = makeRng(seed);
    const mat = neonMaterial(color);
    const group = new THREE.Group();
    let cursor = 0;
    for (let i = 0; i < glyphs; i++) {
      const gw = range(rng, 0.5, 0.9);
      const gh = range(rng, 0.9, 1.6);
      const strokes = Math.floor(range(rng, 2, 4));
      for (let s = 0; s < strokes; s++) {
        const vertical = rng() < 0.5;
        const len = vertical ? gh * range(rng, 0.5, 1) : gw * range(rng, 0.6, 1);
        const bx = cursor + range(rng, 0, gw - 0.1);
        const by = range(rng, -gh / 2, gh / 2 - 0.1);
        const bar = new THREE.Mesh(
          new THREE.BoxGeometry(vertical ? 0.12 : len, vertical ? len : 0.12, 0.12),
          mat,
        );
        bar.position.set(bx, by, 0);
        group.add(bar);
      }
      cursor += gw + 0.3;
    }
    group.position.set(x - Math.cos(ry) * cursor / 2, y, z + Math.sin(ry) * cursor / 2);
    group.rotation.y = ry;
    this.group.add(group);

    let pointLight = null;
    if (light > 0) {
      pointLight = new THREE.PointLight(color, light * LIGHT_GAIN, 22, 2);
      pointLight.position.set(x + Math.sin(ry) * 1.0, y, z + Math.cos(ry) * 1.0);
      this.group.add(pointLight);
      this.lights.push(pointLight);
    }
    if (flicker) {
      this.flickers.push({
        mat, light: pointLight, base: 1, lightBase: light * LIGHT_GAIN,
        phase: Math.random() * 10, ...FLICKER[flicker],
      });
    }
    return group;
  }

  /** Street lamp: post + head + cone of light. Adds its own collider. */
  lamp(ctx, x, z, { color = 0xffd9a0, height = 4.5, intensity = 9 } = {}) {
    const { batcher, colliders } = ctx;
    batcher.cylinder(MATS.metalDark, x, height / 2, z, 0.11, height);
    batcher.boxOn(MATS.metal, x, height, z, 0.9, 0.28, 0.5);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - 0.22, 0, z - 0.22),
      new THREE.Vector3(x + 0.22, height, z + 0.22),
    ));

    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.35), neonMaterial(color));
    bulb.position.set(x, height - 0.1, z);
    this.group.add(bulb);

    const light = new THREE.PointLight(color, intensity * LIGHT_GAIN, 24, 2);
    light.position.set(x, height - 0.3, z);
    this.group.add(light);
    this.lights.push(light);
    return light;
  }

  /**
   * Sagging cable between two points, approximated with a few segments.
   * Purely decorative (no collider) — the dog passes underneath.
   */
  cable(ctx, from, to, { sag = 1.6, segments = 6, material = MATS.cable, radius = 0.05 } = {}) {
    const { batcher } = ctx;
    let prev = from.clone();
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      _tmp.lerpVectors(from, to, t);
      _tmp.y -= Math.sin(t * Math.PI) * sag;
      batcher.segment(material, prev, _tmp, radius);
      prev.copy(_tmp);
    }
  }

  /** Row of little pennant lights strung along a cable. */
  bulbString(ctx, from, to, { sag = 1.2, count = 9, color = NEON.yellow } = {}) {
    this.cable(ctx, from, to, { sag });
    const rng = makeRng(Math.floor(from.x * 13 + to.z * 7) + 1000);
    const mat = neonMaterial(color);
    for (let i = 1; i < count; i++) {
      const t = i / count;
      _tmp.lerpVectors(from, to, t);
      _tmp.y -= Math.sin(t * Math.PI) * sag + 0.16;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 4), rng() < 0.25 ? neonMaterial(NEON.pink) : mat);
      bulb.position.copy(_tmp);
      this.group.add(bulb);
    }
  }

  /** Thin emissive trim strip — batched, since it never flickers. */
  strip(ctx, material, x, y, z, w, h, ry = 0) {
    ctx.batcher.panel(material, x, y, z, w, h, ry);
  }

  update(dt) {
    this.t += dt;
    for (const f of this.flickers) {
      const v = f.fn(this.t + f.phase);
      f.mat.opacity = f.base * v;
      f.mat.transparent = true;
      if (f.light) f.light.intensity = f.lightBase * v;
    }
  }
}

/** Flicker profiles. Each maps time -> brightness multiplier in [0, 1]. */
const FLICKER = {
  // dying tube: mostly on, with sharp stutters
  bad: {
    fn: (t) => {
      const s = Math.sin(t * 12.7) * Math.sin(t * 3.1) * Math.sin(t * 27.3);
      return s > 0.55 ? 0.12 : 1;
    },
  },
  // slow breathing pulse
  pulse: { fn: (t) => 0.62 + 0.38 * Math.sin(t * 1.6) },
  // fast arcade shimmer
  buzz: { fn: (t) => 0.8 + 0.2 * Math.sin(t * 21) * Math.sin(t * 6.3) },
  // a sign that has all but given up
  dying: {
    fn: (t) => {
      const cycle = t % 5.5;
      if (cycle < 3.4) return 1;
      if (cycle < 3.6) return 0.05;
      if (cycle < 3.75) return 0.9;
      if (cycle < 4.4) return 0.05;
      return 0.75 + 0.25 * Math.sin(t * 33);
    },
  },
};

export { FLICKER };
