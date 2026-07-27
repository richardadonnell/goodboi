import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { FollowCamera } from './core/camera.js';
import { events } from './core/events.js';
import { createDog } from './dog/model.js';
import { DogAnimator } from './dog/animation.js';
import { DogController, SPEEDS } from './dog/controller.js';
import { Verbs } from './dog/verbs.js';
import { createWorld, createComposer } from './world/index.js';
import { createNpcs } from './npc/index.js';
import { createQuests, Items } from './quests/index.js';
import { createUI } from './ui/index.js';
import { createAudio } from './audio/index.js';

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

// --- Phase 3: verbs, NPCs, quests ------------------------------------------

const items = new Items();
engine.scene.add(items.group);

const verbs = new Verbs({ dog, controller, scene: engine.scene, items, events });

const npcs = createNpcs({ world, events });
engine.scene.add(npcs.group);

const quests = createQuests({ world, items, verbs, npcs, events });

// --- Phase 4: HUD, screens, audio ------------------------------------------

const audio = createAudio({ events });

const ui = createUI({
  events,
  dom: engine.renderer.domElement,
  onStart: () => audio.start(),
  onPause: () => audio.pause(),
  onResume: () => audio.resume(),
});

// Only now, with the HUD subscribed, does the arc emit its first objective —
// otherwise the tutorial line for beat 1 goes out to an empty bus.
quests.start();

// The credits take over the screen; let go of the mouse so the buttons work.
events.on('game:ended', () => document.exitPointerLock());

const NO_LOOK = { x: 0, y: 0 };

engine.onUpdate((dt) => {
  ui.update(dt);

  // Start screen / pause: the world keeps drawing and drifting, but nothing
  // simulates and no input is read.
  if (!ui.playing) {
    world.update?.(dt);
    follow.update(dt, controller.position);
    input.consume();
    return;
  }

  // While a cinematic or the ending is running, the dog stops taking orders.
  const locked = quests.inputLocked;
  const playerInput = locked ? null : input;

  follow.orbit(locked ? NO_LOOK : input.mouseDelta);

  controller.update(dt, { input: playerInput, camera: follow });

  dog.group.position.copy(controller.position);
  dog.group.rotation.y = controller.yaw;

  animator.update(dt, {
    speed: controller.speed,
    maxSpeed: controller.maxSpeed,
    grounded: controller.grounded,
  });

  items.update(dt);

  // Quests get first refusal on F so handing over an item beats picking one up.
  const { interactHandled } = quests.update(dt, { input, controller });

  // Verbs run after the animator: they layer pose offsets over the gait.
  verbs.update(dt, playerInput, { blockInteract: interactHandled });

  npcs.update(dt, controller.position);
  world.update?.(dt);
  audio.update(dt, controller);

  if (input.wasPressed('pause')) document.exitPointerLock();

  // Cinematics pull the camera in close; the rest of the time this is a no-op.
  follow.distance = THREE.MathUtils.lerp(follow.distance, quests.cameraDistance, Math.min(1, dt * 3));
  follow.update(dt, controller.position);

  input.consume();
});

engine.start();

// Debug handle — lets us poke at the world from the console during development.
window.goodboi = { engine, world, dog, controller, follow, verbs, items, npcs, quests, events, ui, audio };
