import * as THREE from 'three';

// Warm brown/tan palette.
const PALETTE = {
  fur: 0x8a5a34,
  furLight: 0xc09262,
  snout: 0x5a3a22,
  nose: 0x241a15,
  ear: 0x6d452a,
  paw: 0xd9b98c,
  eye: 0x18120e,
};

function mat(color) {
  return new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, metalness: 0.0 });
}

function box(w, h, d, color) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Procedural low-poly dog. Faces -Z (Three's forward), origin at the paws.
 *
 * createDog() -> {
 *   group,                        // add to scene; position it at the controller's feet
 *   head, snout, ears:[l,r], tail, tailBase, body,
 *   legs: [frontLeft, frontRight, backLeft, backRight],
 *   restY: { body, head, ... }    // rest transforms animation.js lerps around
 * }
 */
export function createDog() {
  const group = new THREE.Group();

  // --- body ---
  const body = box(0.52, 0.46, 0.95, PALETTE.fur);
  body.position.set(0, 0.62, 0);
  group.add(body);

  const chest = box(0.5, 0.42, 0.3, PALETTE.furLight);
  chest.position.set(0, -0.03, -0.4);
  body.add(chest);

  // --- head (pivot at the neck so nodding looks right) ---
  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.5);
  group.add(head);

  const skull = box(0.38, 0.36, 0.4, PALETTE.fur);
  skull.position.set(0, 0.12, -0.06);
  head.add(skull);

  const snout = box(0.2, 0.17, 0.28, PALETTE.snout);
  snout.position.set(0, 0.04, -0.35);
  head.add(snout);

  const nose = box(0.11, 0.09, 0.07, PALETTE.nose);
  nose.position.set(0, 0.07, -0.5);
  head.add(nose);

  for (const sx of [-1, 1]) {
    const eye = box(0.07, 0.07, 0.05, PALETTE.eye);
    eye.position.set(sx * 0.12, 0.18, -0.25);
    head.add(eye);
  }

  // Floppy ears: pivot at the top of the skull, flap hangs below.
  const ears = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.18, 0.26, -0.02);
    const flap = box(0.09, 0.3, 0.18, PALETTE.ear);
    flap.position.set(0, -0.15, 0);
    pivot.add(flap);
    pivot.rotation.z = sx * 0.25;
    head.add(pivot);
    ears.push(pivot);
  }

  // --- legs: pivot at the hip/shoulder, so rotation.x swings the whole leg ---
  const legs = [];
  const legSpec = [
    [-0.18, -0.32], // front left
    [0.18, -0.32],  // front right
    [-0.19, 0.33],  // back left
    [0.19, 0.33],   // back right
  ];
  for (const [x, z] of legSpec) {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.42, z);
    const upper = box(0.15, 0.44, 0.16, PALETTE.fur);
    upper.position.set(0, -0.22, 0);
    pivot.add(upper);
    const paw = box(0.17, 0.1, 0.22, PALETTE.paw);
    paw.position.set(0, -0.44, -0.02);
    pivot.add(paw);
    group.add(pivot);
    legs.push(pivot);
  }

  // --- tail: pivot at the rump, segments angled up ---
  const tailBase = new THREE.Group();
  tailBase.position.set(0, 0.72, 0.46);
  tailBase.rotation.x = -0.6;
  group.add(tailBase);

  const tail = box(0.11, 0.11, 0.42, PALETTE.furLight);
  tail.position.set(0, 0, 0.2);
  tailBase.add(tail);

  const tailTip = box(0.09, 0.09, 0.2, PALETTE.fur);
  tailTip.position.set(0, 0.02, 0.3);
  tail.add(tailTip);

  return {
    group,
    body,
    head,
    snout,
    ears,
    legs,
    tail,
    tailBase,
    rest: {
      bodyY: body.position.y,
      headY: head.position.y,
      tailBaseX: tailBase.rotation.x,
      earZ: ears.map((e) => e.rotation.z),
    },
  };
}
