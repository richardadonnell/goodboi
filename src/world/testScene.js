import * as THREE from 'three';

/**
 * Temporary stand-in for the Phase 2 city district.
 *
 * A "world" is any object with this shape — main.js only depends on this contract:
 *   {
 *     root:      THREE.Object3D  added to the scene
 *     colliders: THREE.Box3[]    solid boxes for DogController
 *     spawn:     THREE.Vector3   dog start position (at the paws)
 *     spawnYaw:  number          dog start facing
 *     groundY:   number          flat ground plane height
 *     fog:       THREE.Fog|null  applied to the scene
 *     lights:    THREE.Light[]   added to the scene
 *     update(dt) optional per-step hook
 *   }
 */
export function createTestScene() {
  const root = new THREE.Group();
  const colliders = [];

  // --- ground ---
  const groundY = 0;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 120),
    new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 1, flatShading: true }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  root.add(ground);

  // --- a few blocks to bump into, climb on, and jump between ---
  const blockMat = new THREE.MeshStandardMaterial({ color: 0x424a5c, roughness: 0.9, flatShading: true });
  const blockSpec = [
    // [x, y, z, w, h, d]
    [6, 0, -4, 4, 3, 4],
    [-7, 0, -6, 5, 5, 3],
    [0, 0, -14, 10, 2, 2],
    [-3, 0, 6, 2, 1, 2],
    [1, 0, 9, 2, 1.6, 2],
    [5, 0, 12, 2, 2.4, 2],
    [12, 0, 2, 3, 6, 3],
  ];
  for (const [x, y, z, w, h, d] of blockSpec) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), blockMat);
    mesh.position.set(x, y + h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);

    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h, z + d / 2),
    ));
  }

  // --- lights ---
  const sun = new THREE.DirectionalLight(0xbfd0ff, 2.4);
  sun.position.set(-12, 20, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  const s = 25;
  sun.shadow.camera.left = -s;
  sun.shadow.camera.right = s;
  sun.shadow.camera.top = s;
  sun.shadow.camera.bottom = -s;

  const ambient = new THREE.AmbientLight(0x6d7fa8, 1.8);

  return {
    root,
    colliders,
    spawn: new THREE.Vector3(0, 0, 0),
    spawnYaw: 0,
    groundY,
    fog: new THREE.Fog(0x0a0b10, 25, 90),
    lights: [sun, ambient],
  };
}
