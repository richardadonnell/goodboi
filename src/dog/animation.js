import * as THREE from 'three';

/**
 * Procedural animation for the dog rig from model.js.
 *
 * const anim = new DogAnimator(dog);
 * anim.wagSpeed = 3;                     // raise near interactables (Phase 3)
 * anim.update(dt, { speed, maxSpeed, grounded, airborneTime })
 */
export class DogAnimator {
  constructor(dog) {
    this.dog = dog;
    this.time = 0;
    this.gait = 0;        // gait phase, advances with distance travelled
    this.wagSpeed = 3;    // base wags/sec; scale up when something exciting is near
    this.wagAmount = 0.35;
    this._blend = 0;      // 0 = idle, 1 = full trot
  }

  /**
   * @param {number} dt seconds
   * @param {{speed:number, maxSpeed:number, grounded:boolean}} state
   */
  update(dt, state = {}) {
    const { dog } = this;
    const speed = state.speed ?? 0;
    const maxSpeed = state.maxSpeed || 6;
    const grounded = state.grounded !== false;

    this.time += dt;

    const moving = THREE.MathUtils.clamp(speed / 1.2, 0, 1);
    this._blend += (moving - this._blend) * Math.min(1, dt * 12);

    // Gait phase advances with distance so steps don't slide at different speeds.
    this.gait += speed * dt * 2.6;

    // --- legs: diagonal pairs, front/back offset by half a cycle ---
    const swing = 0.85 * this._blend;
    const phases = [0, Math.PI, Math.PI, 0]; // FL, FR, BL, BR
    for (let i = 0; i < dog.legs.length; i++) {
      const target = grounded
        ? Math.sin(this.gait + phases[i]) * swing
        : (i < 2 ? -0.5 : 0.45); // tuck front, trail back while airborne
      const leg = dog.legs[i];
      leg.rotation.x += (target - leg.rotation.x) * Math.min(1, dt * 18);
    }

    // --- body: idle breathing + a bob synced to the trot ---
    const breathe = Math.sin(this.time * 1.8) * 0.012 * (1 - this._blend);
    const bob = Math.abs(Math.sin(this.gait)) * 0.05 * this._blend;
    dog.body.position.y = dog.rest.bodyY + breathe + bob;
    dog.body.rotation.x = Math.sin(this.gait * 2) * 0.03 * this._blend;

    // --- head: follows the body, dips slightly when running ---
    const run = THREE.MathUtils.clamp(speed / maxSpeed, 0, 1);
    dog.head.position.y = dog.rest.headY + breathe * 0.8 + bob * 0.7;
    dog.head.rotation.x = 0.12 * run + Math.sin(this.time * 1.6) * 0.02 * (1 - this._blend);

    // --- tail: always wagging, faster with wagSpeed and while moving ---
    const wagRate = this.wagSpeed * (1 + this._blend * 0.8);
    dog.tailBase.rotation.y = Math.sin(this.time * wagRate * Math.PI * 2) * this.wagAmount;
    dog.tailBase.rotation.x = dog.rest.tailBaseX - this._blend * 0.25;

    // --- ears: flop against the body's motion, plus a slow idle sway ---
    const flop = Math.sin(this.gait * 1.0) * 0.22 * this._blend
      + Math.sin(this.time * 1.3) * 0.04;
    for (let i = 0; i < dog.ears.length; i++) {
      const ear = dog.ears[i];
      const sx = i === 0 ? -1 : 1;
      ear.rotation.z = dog.rest.earZ[i] + flop * sx * 0.5;
      ear.rotation.x = -flop * 0.8 - run * 0.15;
    }
  }
}
