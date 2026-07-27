import * as THREE from 'three';

const WALK_SPEED = 3;
const RUN_SPEED = 6;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const GROUND_ACCEL = 22;
const AIR_ACCEL = 6;
const TURN_RATE = 11;      // radians/sec toward the move direction
const GROUND_EPS = 0.06;   // snap tolerance for staying "grounded"
const STEP_HEIGHT = 0.35;  // knee height: ledges up to this get stepped onto
const SKIN = 0.02;         // ignore contacts thinner than this (touching != penetrating)
const MAX_SUB = 0.12;      // max displacement per collision substep (< half the thinnest collider)
const MAX_PASSES = 4;      // depenetration passes per axis

/**
 * Axis-separated AABB character controller. No physics engine; the world hands us
 * an array of THREE.Box3 colliders, a ground height and a containment box.
 *
 * Movement is substepped (≤ MAX_SUB per step, so nothing tunnels through a thin
 * wall) and each substep resolves X, then Z, then Y. Horizontal penetration is
 * always resolved horizontally — by penetration depth, not by direction of
 * travel — so overlapping colliders can neither pop the dog onto a box's top
 * edge nor shove it out through a wall. `bounds` is the final backstop.
 *
 * const dog = new DogController({ colliders, spawn, radius, height });
 * dog.update(dt, { input, camera })   -> camera is a FollowCamera (for camera-relative move)
 * dog.position  THREE.Vector3 at the paws
 * dog.speed     horizontal speed in m/s (feed to DogAnimator)
 * dog.grounded  boolean
 * dog.setColliders(boxes)             -> Phase 2 swaps the world in
 */
export class DogController {
  constructor({ colliders = [], spawn = new THREE.Vector3(), radius = 0.35, height = 1.1, groundY = 0, bounds = null } = {}) {
    this.colliders = colliders;
    this.radius = radius;
    this.height = height;
    this.groundY = groundY;
    // Hard containment box for the paws — the dog can never leave it, whatever
    // the colliders do. { min: Vector3, max: Vector3 } in world space.
    this.bounds = bounds;

    this.position = new THREE.Vector3().copy(spawn);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.grounded = true;
    this.maxSpeed = RUN_SPEED;
    this.speedScale = 1;   // verbs slow the dog down (sniffing, digging)

    this._box = new THREE.Box3();
    this._wish = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
  }

  setColliders(boxes) {
    this.colliders = boxes;
  }

  teleport(position, yaw = this.yaw) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
  }

  update(dt, { input, camera }) {
    // --- desired horizontal direction, relative to where the camera faces ---
    this._wish.set(0, 0, 0);
    if (input) {
      camera.getForward(this._forward);
      camera.getRight(this._right);
      if (input.isDown('forward')) this._wish.add(this._forward);
      if (input.isDown('back')) this._wish.sub(this._forward);
      if (input.isDown('right')) this._wish.add(this._right);
      if (input.isDown('left')) this._wish.sub(this._right);
    }

    const wants = this._wish.lengthSq() > 1e-6;
    if (wants) this._wish.normalize();

    const running = input?.isDown('run');
    const target = wants ? (running ? RUN_SPEED : WALK_SPEED) * this.speedScale : 0;
    const accel = this.grounded ? GROUND_ACCEL : AIR_ACCEL;

    // Accelerate horizontal velocity toward the target vector.
    const tx = this._wish.x * target;
    const tz = this._wish.z * target;
    const step = accel * dt;
    this.velocity.x = approach(this.velocity.x, tx, step);
    this.velocity.z = approach(this.velocity.z, tz, step);

    if (input?.wasPressed('jump') && this.grounded) {
      this.velocity.y = JUMP_SPEED;
      this.grounded = false;
    }

    this.velocity.y -= GRAVITY * dt;

    // --- move + resolve, substepped so nothing tunnels through thin walls ---
    this._move(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);

    // --- face the direction of travel ---
    if (wants) {
      // Model's rest pose faces -Z, so negate both components.
      const desiredYaw = Math.atan2(-this._wish.x, -this._wish.z);
      this.yaw = dampAngle(this.yaw, desiredYaw, TURN_RATE, dt);
    }

    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    return this;
  }

  /** World-space AABB at an optional offset position. */
  getBox(target = this._box, position = this.position) {
    target.min.set(position.x - this.radius, position.y, position.z - this.radius);
    target.max.set(position.x + this.radius, position.y + this.height, position.z + this.radius);
    return target;
  }

  /**
   * Substepped move. Horizontal displacement is resolved horizontally only
   * (X then Z, penetration-depth based) and vertical separately, so walking
   * into a wall can never launch the dog onto its top edge.
   */
  _move(dx, dy, dz) {
    const largest = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
    const steps = Math.max(1, Math.min(16, Math.ceil(largest / MAX_SUB)));
    const sx = dx / steps, sy = dy / steps, sz = dz / steps;

    for (let i = 0; i < steps; i++) {
      if (sx !== 0) { this.position.x += sx; this._resolveHorizontal('x', sx); }
      if (sz !== 0) { this.position.z += sz; this._resolveHorizontal('z', sz); }
      this._moveVertical(sy);
      this._clampToBounds();
    }
  }

  /**
   * Push out of anything we horizontally overlap, along `axis` only, choosing
   * the shorter way out rather than trusting the direction of travel — residual
   * penetration from a neighbouring box then can't shove us through a wall.
   * Low ledges are stepped onto instead of blocking.
   */
  _resolveHorizontal(axis, delta) {
    for (let pass = 0; pass < MAX_PASSES; pass++) {
      const collider = this._firstOverlap();
      if (!collider) return;

      // Step-up: a kerb/ledge below knee height we can stand on cleanly.
      const rise = collider.max.y - this.position.y;
      if (rise > 0 && rise <= STEP_HEIGHT && (this.grounded || this.velocity.y <= 0) && this._fitsAt(this.position.x, collider.max.y, this.position.z)) {
        this.position.y = collider.max.y;
        if (this.velocity.y < 0) this.velocity.y = 0;
        this.grounded = true;
        continue;
      }

      const outPos = collider.max[axis] + this.radius - this.position[axis];   // >= 0
      const outNeg = collider.min[axis] - this.radius - this.position[axis];   // <= 0
      const push = Math.abs(outPos) < Math.abs(outNeg) ? outPos : outNeg;
      this.position[axis] += push;
      if (push * delta < 0 || push * this.velocity[axis] < 0) this.velocity[axis] = 0;
    }
  }

  _moveVertical(delta) {
    this.grounded = false;
    this.position.y += delta;

    if (this.position.y <= this.groundY) {
      this.position.y = this.groundY;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    }

    // Falling: land on the highest overlapping top. Rising: bonk the lowest underside.
    let top = -Infinity, under = Infinity;
    for (const c of this.colliders) {
      if (!this._overlapsColumn(c)) continue;
      if (c.max.y > this.position.y + SKIN && c.min.y < this.position.y + this.height - SKIN) {
        if (delta <= 0 && c.max.y <= this.position.y + this.height * 0.5) top = Math.max(top, c.max.y);
        else under = Math.min(under, c.min.y);
      }
    }
    if (delta <= 0 && top > -Infinity) {
      this.position.y = top;
      if (this.velocity.y < 0) this.velocity.y = 0;
      this.grounded = true;
    } else if (delta > 0 && under < Infinity) {
      this.position.y = Math.max(this.groundY, under - this.height);
      if (this.velocity.y > 0) this.velocity.y = 0;
    }

    // A tiny probe below keeps `grounded` true (and snaps the paws down) while
    // walking over seams — without it the dog sinks a skin's depth every frame.
    if (!this.grounded && this.velocity.y <= 0) {
      const surface = this._groundProbe();
      if (surface !== null) {
        this.position.y = surface;
        this.velocity.y = 0;
        this.grounded = true;
      }
    }
  }

  /** Hard containment: the dog can never leave the playable box. */
  _clampToBounds() {
    const b = this.bounds;
    if (!b) return;
    const p = this.position;
    p.x = Math.min(Math.max(p.x, b.min.x + this.radius), b.max.x - this.radius);
    p.z = Math.min(Math.max(p.z, b.min.z + this.radius), b.max.z - this.radius);
    if (p.y < b.min.y) { p.y = b.min.y; if (this.velocity.y < 0) this.velocity.y = 0; }
    const ceil = b.max.y - this.height;
    if (p.y > ceil) { p.y = ceil; if (this.velocity.y > 0) this.velocity.y = 0; }
  }

  /** First collider genuinely penetrating the body (touching contacts ignored). */
  _firstOverlap(x = this.position.x, y = this.position.y, z = this.position.z) {
    for (const c of this.colliders) {
      if (c.max.y <= y + SKIN || c.min.y >= y + this.height - SKIN) continue;
      if (c.max.x <= x - this.radius + SKIN || c.min.x >= x + this.radius - SKIN) continue;
      if (c.max.z <= z - this.radius + SKIN || c.min.z >= z + this.radius - SKIN) continue;
      return c;
    }
    return null;
  }

  /** Body fits (no penetration) standing at this position? */
  _fitsAt(x, y, z) {
    return !this._firstOverlap(x, y, z);
  }

  /** Horizontal (XZ) overlap only, shrunk by the skin. */
  _overlapsColumn(c) {
    const p = this.position, r = this.radius - SKIN;
    return c.max.x > p.x - r && c.min.x < p.x + r && c.max.z > p.z - r && c.min.z < p.z + r;
  }

  /** Height of the surface just under the paws, or null if there is none. */
  _groundProbe() {
    let surface = this.position.y - this.groundY <= GROUND_EPS ? this.groundY : null;
    // Only a surface *below the paws* counts — a wall we're brushing past doesn't.
    for (const c of this.colliders) {
      if (!this._overlapsColumn(c)) continue;
      if (c.max.y <= this.position.y + SKIN && c.max.y >= this.position.y - GROUND_EPS) {
        surface = surface === null ? c.max.y : Math.max(surface, c.max.y);
      }
    }
    return surface;
  }
}

function approach(current, target, maxStep) {
  const diff = target - current;
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

function dampAngle(current, target, rate, dt) {
  let diff = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.min(1, rate * dt);
}

export const SPEEDS = { WALK: WALK_SPEED, RUN: RUN_SPEED };
