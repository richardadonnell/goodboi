import * as THREE from 'three';

/**
 * Carryable props (wrench, fuse, ball, collar tag) and the collectible bones.
 *
 * Items live under one group in the scene. Carrying re-parents an item to the
 * dog's head so the mouth position comes for free from the rig; dropping puts
 * it back under the items group at its world position.
 *
 *   const items = new Items();
 *   scene.add(items.group);
 *   const wrench = items.add({ id: 'wrench', kind: 'wrench', position: p, hidden: true });
 *   items.reveal(wrench, p);          // pops out of a dig
 *   items.nearestCarryable(dogPos, 2.5);
 */

const LABELS = {
  wrench: 'the wrench',
  fuse: 'the fuse',
  ball: 'the ball',
  tag: 'the collar tag',
  bone: 'a bone',
};

const MATS = {
  steel: new THREE.MeshStandardMaterial({ color: 0x9aa6bd, roughness: 0.4, metalness: 0.75, flatShading: true }),
  darkSteel: new THREE.MeshStandardMaterial({ color: 0x39405a, roughness: 0.5, metalness: 0.6, flatShading: true }),
  rubber: new THREE.MeshStandardMaterial({ color: 0xff5a3c, roughness: 0.85, flatShading: true }),
  boneWhite: new THREE.MeshStandardMaterial({ color: 0xe8e2cf, roughness: 0.8, flatShading: true }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.35, metalness: 0.8, flatShading: true }),
  soil: new THREE.MeshStandardMaterial({ color: 0x4a3527, roughness: 1, flatShading: true }),
};

function glow(color, opacity = 1) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: opacity < 1, opacity });
}

// ---------------------------------------------------------------------------
// Procedural item meshes. Each is built around its own origin so it hangs
// sensibly off the dog's snout when carried.
// ---------------------------------------------------------------------------

function buildWrench() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.07, 0.09), MATS.steel);
  g.add(shaft);
  for (const sx of [-1, 1]) {
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.19, 0.11), MATS.steel);
    jaw.position.set(sx * 0.29, 0, 0);
    g.add(jaw);
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.08, 0.13), MATS.darkSteel);
    notch.position.set(sx * 0.33, sx * 0.04, 0);
    g.add(notch);
  }
  return g;
}

function buildFuse() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.34, 10), glow(0xffd23f, 0.55));
  body.rotation.z = Math.PI / 2;
  g.add(body);
  for (const sx of [-1, 1]) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.1, 10), MATS.brass);
    cap.rotation.z = Math.PI / 2;
    cap.position.x = sx * 0.2;
    g.add(cap);
  }
  const filament = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.025, 0.025), glow(0xfff2b0));
  g.add(filament);
  return g;
}

function buildBall() {
  const g = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 1), MATS.rubber);
  g.add(ball);
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.026, 6, 14), glow(0x22e0ff, 0.9));
  g.add(stripe);
  return g;
}

function buildBone() {
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.075, 0.075), MATS.boneWhite);
  g.add(shaft);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.068, 0), MATS.boneWhite);
      knob.position.set(sx * 0.18, sy * 0.055, 0);
      g.add(knob);
    }
  }
  return g;
}

function buildTag() {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.03, 12), MATS.brass);
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const face = new THREE.Mesh(new THREE.CircleGeometry(0.1, 12), glow(0xffcf8a, 0.9));
  face.position.z = 0.02;
  g.add(face);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 5, 10), MATS.brass);
  ring.position.y = 0.16;
  g.add(ring);
  // A stub of collar strap, so it reads as "a dog's collar" at a glance.
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.035), MATS.rubber);
  strap.position.y = 0.22;
  g.add(strap);
  return g;
}

const BUILDERS = { wrench: buildWrench, fuse: buildFuse, ball: buildBall, bone: buildBone, tag: buildTag };

/** Loose earth heaped over a dig spot. Removed (visually) once dug out. */
export function createMound(position, { radius = 0.85 } = {}) {
  const g = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(radius, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), MATS.soil);
  dome.scale.y = 0.42;
  dome.castShadow = true;
  dome.receiveShadow = true;
  g.add(dome);
  // A few clods so the silhouette isn't a clean hemisphere.
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    const clod = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13 + (i % 3) * 0.04, 0), MATS.soil);
    clod.position.set(Math.cos(a) * radius * 0.85, 0.06, Math.sin(a) * radius * 0.85);
    g.add(clod);
  }
  // Faint marker so a sniffing dog can spot it from across the plaza.
  const halo = new THREE.Mesh(new THREE.RingGeometry(radius * 1.1, radius * 1.35, 24), glow(0x6effc7, 0.28));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.05;
  g.add(halo);

  g.position.copy(position);
  return { group: g, halo, dome };
}

// ---------------------------------------------------------------------------
// Item registry
// ---------------------------------------------------------------------------

export class Items {
  constructor() {
    this.group = new THREE.Group();
    this.list = [];
    this._v = new THREE.Vector3();
  }

  /**
   * @param {{id:string, kind:string, position:THREE.Vector3, hidden?:boolean,
   *          carryable?:boolean, scale?:number}} spec
   */
  add({ id, kind, position, hidden = false, carryable = true, scale = 1 }) {
    const mesh = (BUILDERS[kind] || buildBall)();
    mesh.scale.setScalar(scale);
    mesh.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    const group = new THREE.Group();
    group.add(mesh);
    group.position.copy(position);
    group.visible = !hidden;
    this.group.add(group);

    const item = {
      id,
      kind,
      label: LABELS[kind] || kind,
      group,
      mesh,
      carryable,
      hidden,
      carried: false,
      collected: false,
      home: position.clone(),
      phase: Math.random() * Math.PI * 2,
      pop: 0,
    };
    this.list.push(item);
    return item;
  }

  get(id) {
    return this.list.find((it) => it.id === id) || null;
  }

  /** Nearest loose, visible, carryable item within `radius` of `position`. */
  nearestCarryable(position, radius, filter = null) {
    let best = null;
    let bestDist = radius * radius;
    for (const item of this.list) {
      if (!item.carryable || item.hidden || item.carried || item.collected) continue;
      if (filter && !filter(item)) continue;
      const d = this._worldPos(item).distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** Nearest item of any kind, ignoring carryability (used for bones). */
  nearest(position, radius, filter = null) {
    let best = null;
    let bestDist = radius * radius;
    for (const item of this.list) {
      if (item.hidden || item.carried || item.collected) continue;
      if (filter && !filter(item)) continue;
      const d = this._worldPos(item).distanceToSquared(position);
      if (d < bestDist) {
        bestDist = d;
        best = item;
      }
    }
    return best;
  }

  /** World position of an item, whether it's loose or parented to the dog. */
  worldPosition(item, out = new THREE.Vector3()) {
    return item.group.getWorldPosition(out);
  }

  /** Un-hide a buried item at `position` with a little pop-out hop. */
  reveal(item, position) {
    item.hidden = false;
    item.collected = false;
    if (position) item.group.position.copy(position);
    item.group.visible = true;
    item.pop = 1;
    return item;
  }

  hide(item) {
    item.hidden = true;
    item.group.visible = false;
    return item;
  }

  /** Parent to the dog's head. `mount` is the local offset at the snout. */
  attachTo(item, parent, mount) {
    item.carried = true;
    item.pop = 0;
    parent.add(item.group);
    item.group.position.copy(mount);
    item.group.rotation.set(0, 0, 0);
    item.mesh.rotation.set(0.2, 0.5, 0.1);
    return item;
  }

  /** Detach back into the world at `position`. */
  detach(item, position) {
    item.carried = false;
    this.group.add(item.group);
    item.group.position.copy(position);
    item.group.rotation.set(0, 0, 0);
    item.pop = 0.6;
    return item;
  }

  /** Permanently consume an item (fitted fuse, collected bone, handed-over wrench). */
  consume(item) {
    item.collected = true;
    item.carried = false;
    if (item.group.parent) item.group.parent.remove(item.group);
    return item;
  }

  update(dt, time) {
    for (const item of this.list) {
      if (item.hidden || item.collected) continue;
      if (item.carried) continue;
      // Loose items bob and turn so they read as "pick me up".
      item.phase += dt;
      const hop = item.pop > 0 ? Math.sin(item.pop * Math.PI) * 0.8 : 0;
      item.mesh.position.y = 0.16 + Math.sin(item.phase * 2) * 0.05 + hop;
      item.mesh.rotation.y += dt * 1.1;
      if (item.pop > 0) item.pop = Math.max(0, item.pop - dt * 1.4);
    }
  }

  _worldPos(item) {
    return item.group.getWorldPosition(this._v);
  }
}
