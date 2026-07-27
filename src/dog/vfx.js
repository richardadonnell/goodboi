import * as THREE from 'three';

/**
 * Cheap, self-contained effects for the dog verbs. Everything is preallocated
 * at construction and recycled: no per-frame geometry or material churn.
 *
 *   const ring = new BarkRing(scene);  ring.play(pos);  ring.update(dt);
 *   const dirt = new DirtBurst(scene); dirt.play(pos);  dirt.update(dt);
 *   const trail = new ScentTrail(scene); trail.setPath(points); trail.update(dt);
 */

// ---------------------------------------------------------------------------
// Bark: an expanding, fading ring on the ground
// ---------------------------------------------------------------------------

const RING_LIFE = 0.7;

export class BarkRing {
  constructor(parent, { color = 0xffe9b0, maxRadius = 12 } = {}) {
    this.maxRadius = maxRadius;
    // Unit-radius ring; the mesh scale does the expanding.
    this.material = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.0, 40), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);
    this.t = -1;
  }

  play(position) {
    this.mesh.position.copy(position);
    this.mesh.position.y += 0.35;
    this.t = 0;
    this.mesh.visible = true;
  }

  update(dt) {
    if (this.t < 0) return;
    this.t += dt;
    const k = this.t / RING_LIFE;
    if (k >= 1) {
      this.t = -1;
      this.mesh.visible = false;
      return;
    }
    // Fast out, slow settle — reads as a pressure wave rather than a balloon.
    const r = 0.6 + this.maxRadius * (1 - Math.pow(1 - k, 2.2));
    this.mesh.scale.set(r, r, 1);
    this.material.opacity = 0.75 * Math.pow(1 - k, 1.6);
  }
}

// ---------------------------------------------------------------------------
// Dig: a burst of dirt specks
// ---------------------------------------------------------------------------

export class DirtBurst {
  constructor(parent, { count = 90, color = 0x6b4a33 } = {}) {
    this.count = count;
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.lives = new Float32Array(count);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color,
      size: 0.11,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.visible = false;
    parent.add(this.points);

    this.origin = new THREE.Vector3();
    this.active = 0;
  }

  /** Kick `n` specks up and backward from `position`. */
  play(position, n = 26) {
    this.origin.copy(position);
    let spawned = 0;
    for (let i = 0; i < this.count && spawned < n; i++) {
      if (this.lives[i] > 0) continue;
      const a = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 2.2;
      this.positions[i * 3] = position.x + (Math.random() - 0.5) * 0.3;
      this.positions[i * 3 + 1] = position.y + 0.06;
      this.positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * 0.3;
      this.velocities[i * 3] = Math.cos(a) * speed * 0.5;
      this.velocities[i * 3 + 1] = 1.6 + Math.random() * 2.4;
      this.velocities[i * 3 + 2] = Math.sin(a) * speed * 0.5;
      this.lives[i] = 0.5 + Math.random() * 0.5;
      spawned++;
    }
    this.points.visible = true;
  }

  update(dt) {
    if (!this.points.visible) return;
    let alive = 0;
    for (let i = 0; i < this.count; i++) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt;
      if (this.lives[i] <= 0) {
        // Park dead specks far below the world rather than branching in the shader.
        this.positions[i * 3 + 1] = -1000;
        continue;
      }
      this.velocities[i * 3 + 1] -= 11 * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      alive++;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    if (alive === 0) this.points.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Sniff: a flowing dashed trail toward the current objective
// ---------------------------------------------------------------------------

const TRAIL_SEGMENTS = 44;

export class ScentTrail {
  constructor(parent, { color = 0x6effc7, segments = TRAIL_SEGMENTS } = {}) {
    this.segments = segments;
    this.strength = 0;      // 0..1, eased in while sniffing
    this.flow = 0;
    this.material = new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    // One quad per dash, all sharing the material so it stays a single draw call.
    const quad = new THREE.PlaneGeometry(0.34, 0.34);
    this.mesh = new THREE.InstancedMesh(quad, this.material, segments);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    parent.add(this.mesh);

    this.curve = null;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /** @param {THREE.Vector3[]} points dog -> ... -> objective. Null clears the trail. */
  setPath(points) {
    if (!points || points.length < 2) {
      this.curve = null;
      return;
    }
    this.curve = new THREE.CatmullRomCurve3(points.map((p) => p.clone()), false, 'catmullrom', 0.4);
    // Dash count follows the route's length so a short hop doesn't collapse
    // into a solid ribbon and a long one doesn't turn into sparse confetti.
    this._count = THREE.MathUtils.clamp(Math.round(this.curve.getLength() / 0.95), 5, this.segments);
  }

  update(dt, wanted) {
    // Ease the whole trail in/out so releasing Q doesn't pop.
    const target = wanted && this.curve ? 1 : 0;
    this.strength += (target - this.strength) * Math.min(1, dt * 6);
    if (this.strength < 0.01) {
      this.strength = 0;
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.flow = (this.flow + dt * 0.35) % 1;

    const n = this._count || this.segments;
    for (let i = 0; i < this.segments; i++) {
      if (i >= n) {
        // Park the surplus instances at zero scale rather than resizing the mesh.
        this._m.compose(this._p.set(0, -1000, 0), this._q, this._s.set(0, 0, 0));
        this.mesh.setMatrixAt(i, this._m);
        continue;
      }
      const u = i / (n - 1);
      this.curve.getPointAt(THREE.MathUtils.clamp(u, 0, 1), this._p);
      this._p.y += 0.3 + Math.sin(u * 14 + this.flow * Math.PI * 2) * 0.05;
      // Dashes swell as the flow pulse passes over them.
      const pulse = 0.55 + 0.45 * Math.sin((u - this.flow) * Math.PI * 6);
      const scale = (0.55 + pulse * 0.75) * this.strength;
      this._s.set(scale, scale, scale);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.material.opacity = 0.72 * this.strength;
  }
}
