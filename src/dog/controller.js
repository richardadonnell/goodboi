import * as THREE from 'three';

const WALK_SPEED = 3;
const RUN_SPEED = 6;
const GRAVITY = 22;
const JUMP_SPEED = 7.2;
const GROUND_ACCEL = 22;
const AIR_ACCEL = 6;
const TURN_RATE = 11;      // radians/sec toward the move direction
const GROUND_EPS = 0.06;   // snap tolerance for staying "grounded"

/**
 * Axis-separated AABB character controller. No physics engine; the world hands us
 * an array of THREE.Box3 colliders and a ground height.
 *
 * const dog = new DogController({ colliders, spawn, radius, height });
 * dog.update(dt, { input, camera })   -> camera is a FollowCamera (for camera-relative move)
 * dog.position  THREE.Vector3 at the paws
 * dog.speed     horizontal speed in m/s (feed to DogAnimator)
 * dog.grounded  boolean
 * dog.setColliders(boxes)             -> Phase 2 swaps the world in
 */
export class DogController {
  constructor({ colliders = [], spawn = new THREE.Vector3(), radius = 0.35, height = 1.1, groundY = 0 } = {}) {
    this.colliders = colliders;
    this.radius = radius;
    this.height = height;
    this.groundY = groundY;

    this.position = new THREE.Vector3().copy(spawn);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.grounded = true;
    this.maxSpeed = RUN_SPEED;
    this.speedScale = 1;   // verbs slow the dog down (sniffing, digging)

    this._box = new THREE.Box3();
    this._probe = new THREE.Box3();
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

    // --- move + resolve, one axis at a time so sliding along walls works ---
    this._moveAxis('x', this.velocity.x * dt);
    this._moveAxis('z', this.velocity.z * dt);
    this._moveAxis('y', this.velocity.y * dt);

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

  _moveAxis(axis, delta) {
    if (delta === 0) return;
    this.position[axis] += delta;

    if (axis === 'y') {
      this.grounded = false;
      if (this.position.y <= this.groundY) {
        this.position.y = this.groundY;
        this.velocity.y = 0;
        this.grounded = true;
      }
    }

    const box = this.getBox();
    for (const collider of this.colliders) {
      if (!box.intersectsBox(collider)) continue;

      if (axis === 'y') {
        if (delta < 0) {
          // landed on top
          this.position.y = collider.max.y;
          this.grounded = true;
        } else {
          // bonked the underside
          this.position.y = collider.min.y - this.height;
        }
        this.velocity.y = 0;
      } else {
        const half = this.radius;
        if (delta > 0) this.position[axis] = collider.min[axis] - half;
        else this.position[axis] = collider.max[axis] + half;
        this.velocity[axis] = 0;
      }
      this.getBox(box);
    }

    // A tiny probe below keeps `grounded` true while walking over seams.
    if (axis === 'y' && !this.grounded && this.velocity.y <= 0) {
      this.grounded = this._groundProbe();
    }
  }

  _groundProbe() {
    if (this.position.y - this.groundY <= GROUND_EPS) return true;
    const probe = this._probe;
    probe.min.set(this.position.x - this.radius, this.position.y - GROUND_EPS, this.position.z - this.radius);
    probe.max.set(this.position.x + this.radius, this.position.y, this.position.z + this.radius);
    for (const collider of this.colliders) {
      if (probe.intersectsBox(collider)) return true;
    }
    return false;
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
