import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { FollowCamera } from './core/camera.js';
import { createDog } from './dog/model.js';
import { DogAnimator } from './dog/animation.js';
import { DogController, SPEEDS } from './dog/controller.js';
import { createWorld, createComposer } from './world/index.js';

const engine = new Engine();
const input = new Input(engine.renderer.domElement);

const world = createWorld();
engine.scene.add(world.group);
engine.scene.fog = world.fog;
engine.scene.background = world.background;
for (const light of world.lights) engine.scene.add(light);

// Neon-heavy night scene: bloom is doing most of the mood work.
engine.setComposer(createComposer(engine.renderer, engine.scene, engine.camera));

const dog = createDog();
engine.scene.add(dog.group);

const controller = new DogController({
  colliders: world.colliders,
  spawn: world.spawn,
  groundY: world.groundY,
});
controller.yaw = world.spawnYaw;
controller.maxSpeed = SPEEDS.RUN;

const animator = new DogAnimator(dog);
const follow = new FollowCamera(engine.camera, { distance: 6, height: 1.6 });
follow.yaw = world.spawnYaw;

engine.onUpdate((dt) => {
  follow.orbit(input.mouseDelta);

  controller.update(dt, { input, camera: follow });

  dog.group.position.copy(controller.position);
  dog.group.rotation.y = controller.yaw;

  animator.update(dt, {
    speed: controller.speed,
    maxSpeed: controller.maxSpeed,
    grounded: controller.grounded,
  });

  follow.update(dt, controller.position);

  // Verb stubs — wired up properly in Phase 3.
  if (input.wasPressed('bark')) console.log('woof');
  if (input.wasPressed('interact')) {
    // Phase 3 gates this behind the fuse; for now F near the shaft rides it.
    if (controller.position.distanceTo(world.locations.elevator) < 4) {
      world.elevator.enable();
      world.elevator.call();
    }
    console.log('interact');
  }
  if (input.wasPressed('dig')) console.log('dig');
  if (input.wasPressed('pause')) document.exitPointerLock();

  world.update?.(dt);

  input.consume();
});

engine.start();

// Debug handle — lets us poke at the world from the console during development.
window.goodboi = { engine, world, dog, controller, follow };
