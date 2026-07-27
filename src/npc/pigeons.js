import * as THREE from 'three';

/**
 * A flock of low-poly pigeons squatting on a ledge. They peck and shuffle until
 * a bark lands nearby, then scatter into the night.
 *
 *   const flock = new Pigeons({ position, events });
 *   scene.add(flock.group);
 *   flock.update(dt);
 *   flock.scattered   // quests read this
 */

const BODY = new THREE.MeshStandardMaterial({ color: 0x5c6377, roughness: 0.85, flatShading: true });
const HEAD = new THREE.MeshStandardMaterial({ color: 0x3f4658, roughness: 0.85, flatShading: true });
const BEAK = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.7, flatShading: true });
const WING = new THREE.MeshStandardMaterial({
  color: 0x717a91, roughness: 0.9, flatShading: true, side: THREE.DoubleSide,
});

function buildPigeon() {
  const g = new THREE.Group();

  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), BODY);
  body.scale.set(1, 0.85, 1.35);
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Group();
  head.position.set(0, 0.13, -0.15);
  g.add(head);

  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), HEAD);
  head.add(skull);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.028, 0.09, 4), BEAK);
  beak.rotation.x = -Math.PI / 2;
  beak.position.z = -0.08;
  head.add(beak);

  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.02, 0.16), BODY);
  tail.position.set(0, 0.02, 0.19);
  tail.rotation.x = -0.25;
  g.add(tail);

  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.08, 0.05, 0);
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), WING);
    wing.rotation.x = -Math.PI / 2;
    wing.position.x = sx * 0.13;
    pivot.add(wing);
    g.add(pivot);
    wings.push(pivot);
  }

  return { group: g, head, wings };
}

export class Pigeons {
  constructor({ position, count = 6, spread = 1.8, events = null, radius = 11 } = {}) {
    this.group = new THREE.Group();
    this.origin = position.clone();
    this.radius = radius;
    this.scattered = false;
    this.events = events;
    this.birds = [];

    for (let i = 0; i < count; i++) {
      const bird = buildPigeon();
      const a = (i / count) * Math.PI * 2 + 0.7;
      const r = spread * (0.35 + (i % 3) * 0.32);
      bird.group.position.set(
        position.x + Math.cos(a) * r,
        position.y + 0.16,
        position.z + Math.sin(a) * r,
      );
      bird.group.rotation.y = a + Math.PI / 2;
      bird.phase = Math.random() * Math.PI * 2;
      bird.peckTimer = 0.5 + Math.random() * 2.5;
      bird.velocity = new THREE.Vector3();
      bird.flying = false;
      bird.life = 0;
      this.group.add(bird.group);
      this.birds.push(bird);
    }

    if (events) {
      this._off = events.on('verb:bark', ({ position: p, radius: barkRadius }) => {
        if (this.scattered) return;
        if (p.distanceTo(this.origin) <= Math.min(this.radius, barkRadius + 1)) this.scatter();
      });
    }
  }

  scatter() {
    if (this.scattered) return false;
    this.scattered = true;
    for (const bird of this.birds) {
      bird.flying = true;
      // Away from the flock centre, and decidedly upward.
      const away = new THREE.Vector3().subVectors(bird.group.position, this.origin);
      if (away.lengthSq() < 1e-4) away.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      away.y = 0;
      away.normalize();
      bird.velocity.set(
        away.x * (3 + Math.random() * 2.5),
        4.5 + Math.random() * 2.5,
        away.z * (3 + Math.random() * 2.5),
      );
      bird.life = 0;
    }
    this.events?.emit('pigeons:scattered', { position: this.origin.clone() });
    return true;
  }

  update(dt) {
    for (const bird of this.birds) {
      bird.phase += dt;

      if (!bird.flying) {
        if (!bird.group.visible) continue;
        // Idle: shuffle, bob, occasional peck at the concrete.
        bird.peckTimer -= dt;
        const pecking = bird.peckTimer < 0.35 && bird.peckTimer > 0;
        bird.head.rotation.x = pecking ? 1.0 : Math.sin(bird.phase * 2.2) * 0.12;
        if (bird.peckTimer <= 0) bird.peckTimer = 1.5 + Math.random() * 3;
        bird.group.position.y += Math.sin(bird.phase * 3) * 0.0012;
        bird.group.rotation.y += Math.sin(bird.phase * 0.7) * dt * 0.4;
        for (const w of bird.wings) w.rotation.z = 0;
        continue;
      }

      bird.life += dt;
      bird.velocity.y -= 3.2 * dt;         // gentle arc, not a rock
      bird.velocity.y = Math.max(bird.velocity.y, 1.4);
      bird.group.position.addScaledVector(bird.velocity, dt);
      bird.group.rotation.y = Math.atan2(-bird.velocity.x, -bird.velocity.z);
      bird.group.rotation.x = -0.25;

      const flap = Math.sin(bird.life * 26 + bird.phase) * 1.1;
      bird.wings[0].rotation.z = -flap;
      bird.wings[1].rotation.z = flap;

      if (bird.life > 4.5) bird.group.visible = false;
    }
  }

  dispose() {
    this._off?.();
  }
}
