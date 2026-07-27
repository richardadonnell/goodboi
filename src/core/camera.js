import * as THREE from 'three';

const MIN_PITCH = -0.55;   // looking down at the dog
const MAX_PITCH = 1.15;    // looking up

/**
 * Third-person orbit-follow camera.
 *
 * const cam = new FollowCamera(camera, { distance, height });
 * cam.orbit(mouseDelta)          -> apply mouse look
 * cam.update(dt, targetPosition) -> smooth-follow, writes camera position/quaternion
 * cam.yaw                        -> current yaw, used for camera-relative movement
 * cam.getForward(out) / cam.getRight(out) -> flattened basis vectors on the XZ plane
 */
export class FollowCamera {
  constructor(camera, { distance = 6, height = 2.0, lookHeight = 0.9, damping = 10, minDistance = 2 } = {}) {
    this.camera = camera;
    this.distance = distance;
    this.minDistance = minDistance;
    this.height = height;
    this.lookHeight = lookHeight;
    this.damping = damping;

    this.yaw = 0;
    this.pitch = 0.25;

    this._target = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._offset = new THREE.Vector3();
    this._initialized = false;
  }

  orbit(mouseDelta) {
    this.yaw -= mouseDelta.x;
    this.pitch = THREE.MathUtils.clamp(this.pitch + mouseDelta.y, MIN_PITCH, MAX_PITCH);
  }

  /** Unit vector the camera faces, flattened onto XZ. */
  getForward(out = new THREE.Vector3()) {
    return out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Unit vector to the camera's right, flattened onto XZ. */
  getRight(out = new THREE.Vector3()) {
    return out.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  update(dt, targetPosition) {
    this._target.copy(targetPosition);

    const dist = Math.max(this.distance, this.minDistance);
    const cosPitch = Math.cos(this.pitch);
    this._offset.set(
      Math.sin(this.yaw) * cosPitch * dist,
      this.height + Math.sin(this.pitch) * dist,
      Math.cos(this.yaw) * cosPitch * dist,
    );
    this._desired.copy(this._target).add(this._offset);

    if (!this._initialized) {
      this.camera.position.copy(this._desired);
      this._initialized = true;
    } else {
      // frame-rate independent exponential smoothing
      const t = 1 - Math.exp(-this.damping * dt);
      this.camera.position.lerp(this._desired, t);
    }

    this._lookAt.copy(this._target);
    this._lookAt.y += this.lookHeight;
    this.camera.lookAt(this._lookAt);
  }
}
