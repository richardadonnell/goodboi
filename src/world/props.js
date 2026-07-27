import * as THREE from 'three';
import { MATS, NEON, neonMaterial, collideOn, makeRng, range } from './layout.js';

/**
 * Interactive-adjacent props: the elevator platform, gates, junction box,
 * sound sensor, dig spots, canal dressing, puddles.
 *
 * These are the things Phase 3 will attach quest logic to, so anything with
 * behaviour is returned as an object with a small API rather than batched away.
 */

// ---------------------------------------------------------------------------
// Elevator
// ---------------------------------------------------------------------------

/**
 * A platform that rides between `bottomY` and `topY`.
 *
 *   elevator.enable()          -> unlocks it (Phase 3: after the fuse is fitted)
 *   elevator.call()            -> send it to whichever end it isn't at
 *   elevator.sendTo('top')     -> explicit target: 'top' | 'bottom'
 *   elevator.enabled           -> boolean
 *   elevator.state             -> 'idle' | 'moving'
 *   elevator.y                 -> current platform TOP surface height
 *   elevator.collider          -> the Box3 in world.colliders (moves with it)
 *   elevator.position          -> THREE.Vector3 of the platform centre
 *
 * The collider's top face is what DogController lands on, so the dog rides up
 * with the platform: gravity re-resolves it onto `collider.max.y` every step.
 */
export function createElevator(ctx, { x, z, w = 4, d = 4, bottomY = 0, topY = 9, speed = 2.4 }) {
  const { group, colliders } = ctx;

  const platform = new THREE.Group();
  const thickness = 0.4;

  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, thickness, d), MATS.metal);
  slab.castShadow = true;
  slab.receiveShadow = true;
  platform.add(slab);

  // corner posts + an emissive edge strip so it reads as machinery
  const stripMat = neonMaterial(NEON.cyan);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.1, 0.22), MATS.metalDark);
    post.position.set(sx * (w / 2 - 0.2), 0.55, sz * (d / 2 - 0.2));
    platform.add(post);
  }
  for (const [ox, oz, rw, rd] of [
    [0, -d / 2 + 0.06, w, 0.08], [0, d / 2 - 0.06, w, 0.08],
    [-w / 2 + 0.06, 0, 0.08, d], [w / 2 - 0.06, 0, 0.08, d],
  ]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(rw, 0.09, rd), stripMat);
    strip.position.set(ox, thickness / 2, oz);
    platform.add(strip);
  }

  platform.position.set(x, bottomY - thickness / 2, z);
  group.add(platform);

  // Guide rails (static, collidable) framing the shaft. They sit on the Z faces
  // only, so the rooftop landing deck can butt straight up against the +/-X edge.
  for (const sz of [-1, 1]) {
    const rz = z + sz * (d / 2 + 0.35);
    ctx.batcher.boxOn(MATS.metalDark, x, bottomY, rz, 0.4, topY + 1.2, 0.4);
    collideOn(colliders, x, bottomY, rz, 0.4, topY + 1.2, 0.4);
  }

  const collider = new THREE.Box3();
  colliders.push(collider);

  const elevator = {
    group: platform,
    position: platform.position,
    collider,
    enabled: false,
    state: 'idle',
    target: bottomY,
    bottomY,
    topY,
    speed,
    get y() { return platform.position.y + thickness / 2; },
    get atTop() { return Math.abs(elevator.y - topY) < 0.02; },
    get atBottom() { return Math.abs(elevator.y - bottomY) < 0.02; },
    enable() { elevator.enabled = true; stripMat.color.set(NEON.green); return elevator; },
    disable() { elevator.enabled = false; stripMat.color.set(NEON.pink); return elevator; },
    sendTo(where) {
      if (!elevator.enabled) return false;
      elevator.target = where === 'top' ? topY : bottomY;
      elevator.state = 'moving';
      return true;
    },
    call() {
      return elevator.sendTo(elevator.y > (bottomY + topY) / 2 ? 'bottom' : 'top');
    },
    update(dt) {
      if (elevator.state === 'moving') {
        const cur = elevator.y;
        const step = elevator.speed * dt;
        const next = Math.abs(elevator.target - cur) <= step
          ? elevator.target
          : cur + Math.sign(elevator.target - cur) * step;
        platform.position.y = next - thickness / 2;
        if (next === elevator.target) elevator.state = 'idle';
      }
      collider.min.set(x - w / 2, platform.position.y - thickness / 2, z - d / 2);
      collider.max.set(x + w / 2, platform.position.y + thickness / 2, z + d / 2);
    },
  };

  elevator.disable();
  elevator.update(0);
  return elevator;
}

// ---------------------------------------------------------------------------
// Quest fixtures
// ---------------------------------------------------------------------------

/** Wall-mounted junction box with a door and a status light. */
export function junctionBox(ctx, { x, y = 1.4, z, ry = 0 }) {
  const { group, batcher } = ctx;
  batcher.boxOn(MATS.metal, x, y - 0.5, z, 1.1, 1.4, 0.45, ry);
  const lampMat = neonMaterial(NEON.pink);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), lampMat);
  lamp.position.set(x + Math.sin(ry) * 0.3, y + 0.35, z + Math.cos(ry) * 0.3);
  group.add(lamp);
  return {
    position: new THREE.Vector3(x, y, z),
    lampMaterial: lampMat,
    setPowered(on) { lampMat.color.set(on ? NEON.green : NEON.pink); },
  };
}

/** A gate that swings/slides open. Its collider is removed from the world when open. */
export function createGate(ctx, { x, z, w = 6, h = 4, ry = 0 }) {
  const { group, colliders } = ctx;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.4), MATS.metal);
  mesh.position.set(x, h / 2, z);
  mesh.rotation.y = ry;
  mesh.castShadow = true;
  group.add(mesh);

  // bar detailing
  for (let i = -2; i <= 2; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, h - 0.4, 0.5), MATS.metalDark);
    bar.position.set(i * (w / 6), 0, 0);
    mesh.add(bar);
  }

  const collider = collideOn(colliders, x, 0, z, w * Math.abs(Math.cos(ry)) + 0.4 * Math.abs(Math.sin(ry)), h, 0.4 * Math.abs(Math.cos(ry)) + w * Math.abs(Math.sin(ry)));

  let openAmount = 0;
  return {
    mesh,
    collider,
    position: new THREE.Vector3(x, 0, z),
    open: false,
    setOpen(v) {
      this.open = v;
      const i = colliders.indexOf(collider);
      if (v && i >= 0) colliders.splice(i, 1);
      else if (!v && i < 0) colliders.push(collider);
    },
    update(dt) {
      const target = this.open ? 1 : 0;
      openAmount += THREE.MathUtils.clamp(target - openAmount, -dt * 0.8, dt * 0.8);
      mesh.position.y = h / 2 - openAmount * (h - 0.3);
      mesh.visible = openAmount < 0.98;
    },
  };
}

/** Bark-activated sound sensor: dish + indicator. */
export function soundSensor(ctx, { x, y = 3.2, z, ry = 0 }) {
  const { group, batcher } = ctx;
  batcher.cylinder(MATS.metalDark, x, y / 2, z, 0.12, y);
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.7, 8, 1, true), MATS.metal);
  dish.position.set(x, y + 0.2, z);
  dish.rotation.set(Math.PI / 2 - 0.4, ry, 0);
  group.add(dish);
  const eyeMat = neonMaterial(NEON.orange);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), eyeMat);
  eye.position.set(x, y + 0.2, z);
  group.add(eye);
  return {
    position: new THREE.Vector3(x, y, z),
    material: eyeMat,
    setTriggered(on) { eyeMat.color.set(on ? NEON.green : NEON.orange); },
  };
}

/** Loose earth patch marking a diggable spot. Flat, no collider. */
export function digSpot(ctx, { x, z, radius = 0.9 }) {
  const { batcher } = ctx;
  batcher.floor(MATS.rust, x, 0.03, z, radius * 2, radius * 2);
  batcher.floor(MATS.concrete, x, 0.02, z, radius * 2.6, radius * 2.6);
  return new THREE.Vector3(x, 0, z);
}

// ---------------------------------------------------------------------------
// Dressing
// ---------------------------------------------------------------------------

/** Dark glossy puddles that catch the neon. Purely visual. */
export function puddles(ctx, spots, seed = 91) {
  const rng = makeRng(seed);
  for (const [x, z] of spots) {
    const w = range(rng, 2.2, 5.5);
    const d = range(rng, 1.6, 4.0);
    ctx.batcher.floor(MATS.puddle, x, 0.015, z, w, d, range(rng, 0, Math.PI));
  }
}

/** Bollards, barrels, traffic markers scattered along a run. */
export function streetJunk(ctx, { x0, x1, z0, z1, count = 8, seed = 55 }) {
  const rng = makeRng(seed);
  const { batcher, colliders } = ctx;
  for (let i = 0; i < count; i++) {
    const x = range(rng, x0, x1);
    const z = range(rng, z0, z1);
    if (rng() < 0.5) {
      const h = range(rng, 0.9, 1.2);
      batcher.cylinder(MATS.rust, x, h / 2, z, 0.42, h);
      collideOn(colliders, x, 0, z, 0.84, h, 0.84);
    } else {
      batcher.cylinder(MATS.metalDark, x, 0.5, z, 0.14, 1.0);
      batcher.cylinder(neonMaterial(NEON.orange), x, 0.85, z, 0.16, 0.1);
    }
  }
}

/** Drainage pipes jutting out of a canal wall. */
export function canalPipes(ctx, { z, side = 1, x0, x1, count = 5, seed = 22 }) {
  const rng = makeRng(seed);
  const { batcher } = ctx;
  for (let i = 0; i < count; i++) {
    const x = range(rng, x0, x1);
    const r = range(rng, 0.4, 0.85);
    const y = range(rng, 0.8, 2.4);
    batcher.cylinder(MATS.metalDark, x, y, z + side * -0.9, r, 1.6, 0, Math.PI / 2);
  }
}
