import * as THREE from 'three';
import {
  MATS, NEON, WALL_MATS, neonMaterial,
  Batcher, makeRng, collideOn, wall, wallRing,
  GROUND_Y, BOUNDS,
} from './layout.js';
import { building, buildingBlock, deck, crates, facadePipes } from './buildings.js';
import { NeonSystem } from './neon.js';
import {
  createElevator, createGate, junctionBox, soundSensor,
  digSpot, puddles, streetJunk, canalPipes,
} from './props.js';
import { createSky, createStars, createLights, createFog, createComposer, FOG_COLOR } from './atmosphere.js';

export { createComposer };

/**
 * The district.
 *
 * Layout (dog spawns in the south at +Z and works north toward -Z):
 *
 *      z=-46  ┌─ home door ─┐
 *             │ home run    │            (north)
 *      z=-23  ├─────┬───────┘
 *      z=-19  │  drainage canal  ──────────────────  (west)
 *      z=-15  ├──────────────────────────────────
 *      z=-1   │       market alley  ──────► elevator (x=33)
 *      z= 5   ├── gate1 ──┐
 *      z=18   │   plaza   │
 *      z=31   └──┬────────┘
 *      z=42      │ spawn alley
 *
 * Rooftop route runs back west at y≈9–11 from the elevator and drops into the
 * canal, which is the only way through to the home run.
 *
 * Returned object (the contract main.js consumes):
 *   { group/root, colliders, spawn, spawnYaw, groundY, fog, background,
 *     lights, locations, elevator, gates, neon, update(dt) }
 */
export function createWorld() {
  const group = new THREE.Group();
  const colliders = [];
  const batcher = new Batcher();
  const neon = new NeonSystem(group, batcher);
  const rng = makeRng(20260727);
  const ctx = { group, batcher, colliders, rng, neon };

  const locations = {};
  const updaters = [];

  ground(ctx);
  outerShell(ctx);
  spawnAlley(ctx, locations);
  plaza(ctx, locations, updaters);
  marketAlley(ctx, locations, updaters);
  rooftops(ctx, locations);
  canal(ctx, locations);
  homeRun(ctx, locations, updaters);
  cityFill(ctx);
  hiddenSpots(ctx, locations);

  const drawCalls = batcher.build(group);

  const lights = createLights({ shadowExtent: 58 });
  group.add(createSky());
  group.add(createStars());

  const world = {
    group,
    root: group,               // alias: main.js/Phase 1 contract calls it `root`
    colliders,
    spawn: locations.spawnAlley.clone(),
    spawnYaw: 0,               // facing -Z, up the alley
    groundY: GROUND_Y,
    fog: createFog(),
    background: new THREE.Color(FOG_COLOR),
    lights,
    locations,
    neon,
    elevator: locations._elevator,
    gates: locations._gates,
    stats: { mergedDrawCalls: drawCalls, colliders: colliders.length },
    update(dt) {
      neon.update(dt);
      for (const fn of updaters) fn(dt);
    },
  };

  delete locations._elevator;
  delete locations._gates;
  return world;
}

// ---------------------------------------------------------------------------
// Ground + shell
// ---------------------------------------------------------------------------

function ground(ctx) {
  ctx.batcher.floor(MATS.asphalt, 0, GROUND_Y, 0, 140, 140);
  puddles(ctx, [
    [-4, 44], [-4, 36], [2, 24], [-6, 14], [8, 20], [0, 8],
    [10, -2], [20, 0], [30, -3], [-2, -3],
    [-14, -19], [-26, -18], [-38, -20], [-8, -20],
    [0, -28], [1, -38], [-1, -44],
  ]);
}

/** Far wall ring — the district is a closed box; you can never fall out. */
function outerShell(ctx) {
  wallRing(ctx, { x0: -BOUNDS, x1: BOUNDS, z0: -BOUNDS, z1: BOUNDS, height: 30, thickness: 3 });
}

// ---------------------------------------------------------------------------
// Beat 1 — starting alley
// ---------------------------------------------------------------------------

function spawnAlley(ctx, locations) {
  const { neon } = ctx;
  // Walls: two long slabs forming a 6m-wide alley from z=53 down to the plaza.
  wall(ctx, MATS.wallDark, -8.5, 0, 42, 3, 16, 24);
  wall(ctx, MATS.wallWarm, 2.5, 0, 42, 3, 20, 24);
  wall(ctx, MATS.concrete, -3, 0, 54, 14, 12, 3);          // dead end behind the dog

  locations.spawnAlley = new THREE.Vector3(-3, 0, 46);

  // dressing: dumpsters, a fire escape, drooping cables overhead
  crates(ctx, { x: -5.5, z: 50, seed: 11, count: 3 });
  crates(ctx, { x: 0, z: 38, seed: 12, count: 3 });
  facadePipes(ctx, { x: -6.8, z: 44, height: 9, count: 4 });

  neon.cable(ctx, new THREE.Vector3(-7, 8.5, 48), new THREE.Vector3(1, 9.5, 47), { sag: 1.4 });
  neon.cable(ctx, new THREE.Vector3(-7, 9.5, 40), new THREE.Vector3(1, 8.5, 39), { sag: 1.8 });
  neon.bulbString(ctx, new THREE.Vector3(-7, 6.5, 34), new THREE.Vector3(1, 6.5, 34), { sag: 1.0, count: 10 });

  // The one sign you wake up under — deliberately half-dead.
  neon.sign(0.9, 5.5, 50, 2.6, 1.2, NEON.pink, { ry: -Math.PI / 2, flicker: 'dying', light: 5 });
  neon.letterSign(-6.9, 6.2, 44, NEON.cyan, { ry: Math.PI / 2, glyphs: 3, seed: 4, flicker: 'bad', light: 0 });
  neon.lamp(ctx, -6, 37, { intensity: 8 });
  neon.lamp(ctx, 0.4, 48.5, { color: 0xffc9a0, intensity: 6, height: 4 });

  // vertical trim strips make the alley walls read at a glance
  neon.strip(ctx, neonMaterial(NEON.violet), 0.95, 4, 41, 0.14, 7, -Math.PI / 2);
  neon.strip(ctx, neonMaterial(NEON.violet), -6.95, 4, 47, 0.14, 7, Math.PI / 2);
}

// ---------------------------------------------------------------------------
// Beat 2 — plaza, Lampy, the wrench dig spot, gate1
// ---------------------------------------------------------------------------

function plaza(ctx, locations, updaters) {
  const { neon, batcher } = ctx;
  const X0 = -13, X1 = 13, Z0 = 5, Z1 = 31;

  // plaza floor slab (a slightly lighter apron than the street)
  batcher.floor(MATS.concrete, 0, 0.01, 18, 26, 26);

  // south wall, split around the alley mouth (alley is x -7..1)
  wall(ctx, MATS.wallMid, -10.5, 0, Z1, 6, 14, 2);
  wall(ctx, MATS.wallMid, 7.5, 0, Z1, 12, 16, 2);
  // side walls
  wall(ctx, MATS.wallBlue, X0, 0, 18, 2, 18, 26);
  wall(ctx, MATS.wallPurple, X1, 0, 18, 2, 15, 26);
  // north wall, split around gate1 (gate spans x -4..4)
  wall(ctx, MATS.wallWarm, -8.5, 0, Z0, 11, 14, 2);
  wall(ctx, MATS.wallWarm, 8.5, 0, Z0, 11, 14, 2);

  locations.plaza = new THREE.Vector3(0, 0, 18);

  // Centrepiece: a dry fountain / planter the dog can climb.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const px = Math.cos(a) * 2.6;
    const pz = 18 + Math.sin(a) * 2.6;
    batcher.boxOn(MATS.concrete, px, 0, pz, 1.6, 0.7, 1.6, a);
    collideOn(ctx.colliders, px, 0, pz, 1.5, 0.7, 1.5);
  }
  batcher.cylinder(MATS.concrete, 0, 0.9, 18, 0.5, 1.8);
  neon.sign(0, 2.2, 18, 0.5, 0.5, NEON.cyan, { light: 0, backing: false, flicker: 'pulse' });

  // Lampy the streetlight-repair bot waits by the broken lamp.
  locations.lampyPos = new THREE.Vector3(5.5, 0, 21);
  const brokenLamp = neon.lamp(ctx, 7.5, 21, { color: NEON.orange, intensity: 2, height: 5 });
  updaters.push(() => { brokenLamp.intensity = 1.2 + Math.random() * 1.6; });

  neon.lamp(ctx, -8, 12, { intensity: 9 });
  neon.lamp(ctx, 9, 27, { intensity: 9 });

  // Beat 2 objective: the wrench is buried in a soft patch by the west wall.
  locations.digSpotWrench = digSpot(ctx, { x: -9.5, z: 23 });

  // Storefront neon around the square.
  neon.letterSign(-11.9, 7, 14, NEON.pink, { ry: Math.PI / 2, glyphs: 5, seed: 21, light: 0 });
  neon.letterSign(11.9, 8, 24, NEON.yellow, { ry: -Math.PI / 2, glyphs: 4, seed: 22, flicker: 'buzz', light: 5 });
  neon.sign(-3, 9.5, 29.9, 5, 1.6, NEON.violet, { ry: Math.PI, flicker: 'pulse', light: 4 });
  neon.sign(0, 6.5, 6.1, 5, 1.2, NEON.cyan, { light: 5 });

  neon.bulbString(ctx, new THREE.Vector3(-12, 7.5, 10), new THREE.Vector3(12, 7.5, 10), { sag: 2.2, count: 14 });
  neon.bulbString(ctx, new THREE.Vector3(-12, 8, 28), new THREE.Vector3(12, 8, 28), { sag: 2.4, count: 14, color: NEON.cyan });

  streetJunk(ctx, { x0: -11, x1: 11, z0: 8, z1: 29, count: 7, seed: 77 });

  // gate1 — Lampy opens this once it has its wrench back.
  const gate = createGate(ctx, { x: 0, z: 5, w: 8, h: 5 });
  locations.gate1 = gate.position.clone();
  updaters.push((dt) => gate.update(dt));
  locations._gates = { gate1: gate };
}

// ---------------------------------------------------------------------------
// Beat 3 — market alley, fuse, junction box, elevator
// ---------------------------------------------------------------------------

function marketAlley(ctx, locations, updaters) {
  const { neon, batcher } = ctx;
  const Z_S = 4.5, Z_N = -6;   // south/north walls of the 10m-wide alley

  // south wall east of the gate, north wall along the whole run
  wall(ctx, MATS.wallMid, 21, 0, Z_S, 34, 13, 2);
  wall(ctx, MATS.wallDark, 17, 0, Z_N, 46, 17, 2);
  wall(ctx, MATS.wallPurple, -6, 0, -1, 2, 14, 13);      // west cap
  wall(ctx, MATS.concrete, 38, 0, -1, 2, 12, 13);        // east cap behind the elevator

  // Market stalls: awnings on posts, climbable crates beneath.
  for (let i = 0; i < 5; i++) {
    const sx = 4 + i * 6.5;
    const sz = i % 2 ? 2.2 : -3.6;
    batcher.boxOn(MATS.metalDark, sx, 0, sz, 3.2, 0.2, 2.2);
    for (const [ox, oz] of [[-1.4, -0.9], [1.4, -0.9], [-1.4, 0.9], [1.4, 0.9]]) {
      batcher.boxOn(MATS.metalDark, sx + ox, 0.2, sz + oz, 0.12, 2.2, 0.12);
    }
    batcher.boxOn(i % 2 ? MATS.rust : MATS.wallWarm, sx, 2.4, sz, 3.6, 0.25, 2.6);
    collideOn(ctx.colliders, sx, 0, sz, 3.2, 1.0, 2.2);
    crates(ctx, { x: sx + 2.6, z: sz, seed: 30 + i, count: 2 });
    neon.strip(ctx, neonMaterial(i % 2 ? NEON.orange : NEON.green), sx, 1.9, sz + 1.34, 3.2, 0.16);
  }

  locations.marketAlley = new THREE.Vector3(18, 0, -1);

  // Beat 3: the fuse sits on a crate; the junction box is on the north wall.
  locations.fusePos = new THREE.Vector3(9.5, 1.1, -3.6);
  const jbox = junctionBox(ctx, { x: 26, y: 1.6, z: -4.9, ry: 0 });
  locations.junctionBox = jbox.position.clone();

  // Elevator at the dead end, rising to the rooftop deck.
  const elevator = createElevator(ctx, { x: 33, z: -1, w: 4.5, d: 4.5, bottomY: 0, topY: 9 });
  locations.elevator = new THREE.Vector3(33, 0, -1);
  updaters.push((dt) => elevator.update(dt));
  locations._elevator = elevator;
  // wire the junction box's status light to the elevator's power state
  const origEnable = elevator.enable;
  elevator.enable = () => { jbox.setPowered(true); return origEnable(); };

  // Overhead clutter + signage.
  neon.cable(ctx, new THREE.Vector3(-4, 9, 3), new THREE.Vector3(20, 10, 3), { sag: 2.6, segments: 8 });
  neon.cable(ctx, new THREE.Vector3(6, 10, -5), new THREE.Vector3(34, 9, -5), { sag: 3.0, segments: 8 });
  neon.bulbString(ctx, new THREE.Vector3(2, 6.5, -1), new THREE.Vector3(20, 6.5, -1), { sag: 1.6, count: 12, color: NEON.orange });
  neon.bulbString(ctx, new THREE.Vector3(20, 6.5, -1), new THREE.Vector3(36, 6.5, -1), { sag: 1.6, count: 10, color: NEON.pink });

  neon.letterSign(8, 8.5, -4.9, NEON.green, { glyphs: 5, seed: 33, light: 5 });
  neon.letterSign(24, 9.5, 3.4, NEON.pink, { ry: Math.PI, glyphs: 4, seed: 34, flicker: 'bad', light: 0 });
  neon.sign(31, 5.5, -4.9, 3.4, 1.4, NEON.cyan, { flicker: 'buzz', light: 4 });
  neon.sign(14, 4.2, 3.4, 2.6, 1.0, NEON.yellow, { ry: Math.PI, light: 0 });

  neon.lamp(ctx, 2, 3, { intensity: 6 });
  neon.lamp(ctx, 30, 3, { intensity: 6 });
}

// ---------------------------------------------------------------------------
// Beat 4 — rooftop route
// ---------------------------------------------------------------------------

function rooftops(ctx, locations) {
  const { neon } = ctx;

  // Landing deck butted against the elevator platform's west edge (x=30.75).
  deck(ctx, { x: 28.2, z: -1, w: 4.5, d: 4.5, y: 9, rail: false });
  locations.rooftopStart = new THREE.Vector3(28.2, 9, -1);

  // West-bound catwalks over the market alley, then north and down into the
  // canal. Gaps run 1.7–2.4m: a real commit, inside the controller's ~3.9m reach.
  const route = [
    [24, 9.0, -1, 5, 5],
    [17.5, 9.4, -1, 4, 4],
    [11, 9.8, -2, 4.5, 4],
    [4.5, 10.2, -2, 5, 4.5],    // pigeon ledge
    [-2, 10.6, -3, 4, 4],
    [-3, 11.0, -9, 4, 4],
    [-5, 10.6, -15, 4, 4],
    [-9, 8.4, -19.5, 4, 4],     // clears the canal's south wall
    [-9, 5.8, -20.5, 3, 3],
    [-9, 3.4, -17.5, 3, 3],
    [-9, 1.4, -20.5, 3, 3],     // last step down to the canal floor
  ];
  for (const [x, y, z, w, d] of route) {
    deck(ctx, { x, z, w, d, y, rail: y > 3 });
  }

  locations.pigeonLedge = new THREE.Vector3(4.5, 10.2, -2);

  // A perched sign to make the height read.
  neon.sign(11, 12.5, -2, 3, 2.4, NEON.violet, { flicker: 'pulse', light: 3.5 });
  neon.sign(-3, 13, -9, 2.4, 2.0, NEON.cyan, { ry: Math.PI / 2, flicker: 'bad', light: 0 });
  neon.cable(ctx, new THREE.Vector3(24, 12, -1), new THREE.Vector3(4.5, 13, -2), { sag: 2.2, segments: 7 });
  neon.cable(ctx, new THREE.Vector3(-2, 13.5, -3), new THREE.Vector3(-5, 13, -15), { sag: 2.0, segments: 6 });
}

// ---------------------------------------------------------------------------
// Beat 5 — drainage canal
// ---------------------------------------------------------------------------

function canal(ctx, locations) {
  const { neon, batcher } = ctx;
  const Z = -19, X0 = -47, X1 = 5;

  // Channel floor with a dark water strip down the middle.
  batcher.floor(MATS.concrete, (X0 + X1) / 2, 0.01, Z, X1 - X0, 8);
  batcher.floor(MATS.water, (X0 + X1) / 2, 0.03, Z, X1 - X0 - 2, 2.4);

  // High walls both sides; the north wall opens at x -4.5..4.5 into the home run.
  wall(ctx, MATS.concrete, (X0 + X1) / 2, 0, Z + 4, X1 - X0, 5.5, 2);
  wall(ctx, MATS.concrete, (X0 - 4.5) / 2, 0, Z - 4, Math.abs(-4.5 - X0), 5.5, 2);
  wall(ctx, MATS.concrete, X0, 0, Z, 2, 5.5, 10);
  wall(ctx, MATS.concrete, X1, 0, Z, 2, 5.5, 10);

  locations.canal = new THREE.Vector3(-20, 0, Z);

  canalPipes(ctx, { z: Z + 3, side: 1, x0: X0 + 4, x1: X1 - 4, count: 6, seed: 41 });
  canalPipes(ctx, { z: Z - 3, side: -1, x0: X0 + 4, x1: -8, count: 4, seed: 42 });

  // Silt bank where the collar tag is buried — beat 5's dig.
  locations.digSpotCollar = digSpot(ctx, { x: -28, z: Z + 2.4, radius: 1.1 });

  // Debris to climb over / around.
  crates(ctx, { x: -16, z: Z, seed: 51, count: 3 });
  crates(ctx, { x: -34, z: Z - 1, seed: 52, count: 3 });
  streetJunk(ctx, { x0: X0 + 5, x1: X1 - 5, z0: Z - 2.5, z1: Z + 2.5, count: 6, seed: 53 });

  // Sparse, cold lighting — this stretch should feel like the low point.
  for (const x of [-38, -24, -10]) {
    neon.lamp(ctx, x, Z + 3.2, { color: 0x9fd8ff, height: 5, intensity: 6 });
  }
  neon.strip(ctx, neonMaterial(NEON.cyan), -20, 0.12, Z - 2.9, 40, 0.1);
  neon.sign(-28, 4.4, Z + 2.9, 3.2, 1.0, NEON.green, { ry: Math.PI, flicker: 'dying', light: 0 });
}

// ---------------------------------------------------------------------------
// Beat 6 — home run, sound sensor, home gate and door
// ---------------------------------------------------------------------------

function homeRun(ctx, locations, updaters) {
  const { neon, batcher } = ctx;
  const X = 0, HALF = 4.5, Z0 = -46, Z1 = -23;

  batcher.floor(MATS.concrete, X, 0.01, (Z0 + Z1) / 2, HALF * 2, Z1 - Z0);
  wall(ctx, MATS.wallBlue, X - HALF, 0, (Z0 + Z1) / 2, 2, 16, Z1 - Z0);
  wall(ctx, MATS.wallWarm, X + HALF, 0, (Z0 + Z1) / 2, 2, 14, Z1 - Z0);

  // Beat 6: bark at the sensor, the gate lifts.
  const gate = createGate(ctx, { x: X, z: -34, w: 9, h: 5 });
  locations.homeGate = new THREE.Vector3(X, 0, -34);
  updaters.push((dt) => gate.update(dt));
  const sensor = soundSensor(ctx, { x: 3.2, z: -32, y: 3.4 });
  locations.soundSensor = sensor.position.clone();

  locations._gates = locations._gates || {};
  locations._gates.homeGate = gate;
  locations._gates.sensor = sensor;

  // Home: a warm doorway at the end of the corridor — the only warm light left.
  batcher.boxOn(MATS.wallWarm, X, 0, Z0, 14, 12, 2);
  const doorMat = neonMaterial(0xffcf8a, { opacity: 0.35 });
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.4), doorMat);
  door.position.set(X, 1.7, Z0 + 1.05);
  ctx.group.add(door);
  const porch = new THREE.PointLight(0xffcf8a, 30, 20, 2);
  porch.position.set(X, 3.2, Z0 + 2.5);
  ctx.group.add(porch);
  neon.lights.push(porch);

  locations.homeDoor = new THREE.Vector3(X, 0, Z0 + 2.2);
  // Phase 3 turns the lights on at the end — expose the handles.
  locations._gates.homeLight = {
    material: doorMat,
    light: porch,
    setOn(on) { doorMat.opacity = on ? 1 : 0.35; porch.intensity = on ? 160 : 30; },
  };

  neon.lamp(ctx, -3.2, -28, { color: 0xffd9a0, intensity: 6 });
  neon.lamp(ctx, 3.2, -41, { color: 0xffd9a0, intensity: 6 });
  neon.bulbString(ctx, new THREE.Vector3(-4, 6, -38), new THREE.Vector3(4, 6, -38), { sag: 0.9, count: 7 });
  streetJunk(ctx, { x0: -3, x1: 3, z0: -44, z1: -25, count: 4, seed: 61 });
}

// ---------------------------------------------------------------------------
// Everything the player only ever sees: the skyline behind the walls.
// ---------------------------------------------------------------------------

function cityFill(ctx) {
  // Blocks are placed strictly outside the walkable corridors.
  buildingBlock(ctx, { x0: -44, x1: -10, z0: 33, z1: 55, minH: 8, maxH: 24, seed: 101 });
  buildingBlock(ctx, { x0: 4, x1: 44, z0: 33, z1: 55, minH: 8, maxH: 26, seed: 102 });
  buildingBlock(ctx, { x0: -44, x1: -16, z0: 4, z1: 31, minH: 10, maxH: 28, seed: 103 });
  buildingBlock(ctx, { x0: 16, x1: 44, z0: 4, z1: 31, minH: 10, maxH: 26, seed: 104 });
  // Low-rise blocks under the rooftop route, so the catwalks read as
  // roof-hopping rather than floating. Capped below the deck heights (y>=9).
  buildingBlock(ctx, { x0: -44, x1: -2, z0: -13, z1: -9, minH: 4, maxH: 7 , seed: 105 });
  buildingBlock(ctx, { x0: -44, x1: -9, z0: -8, z1: 2, minH: 4, maxH: 7, seed: 108 });
  buildingBlock(ctx, { x0: 8, x1: 44, z0: -44, z1: -9, minH: 9, maxH: 26, seed: 106 });
  buildingBlock(ctx, { x0: -44, x1: -8, z0: -44, z1: -26, minH: 9, maxH: 24, seed: 107 });

  // A couple of distant towers for skyline depth (no colliders needed — they
  // sit beyond the outer wall).
  const rng = makeRng(9);
  const far = { ...ctx, rng };
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const r = 75 + rng() * 55;
    building(far, {
      x: Math.cos(a) * r, z: Math.sin(a) * r,
      w: 10 + rng() * 14, d: 10 + rng() * 14, h: 30 + rng() * 55,
      material: WALL_MATS[i % WALL_MATS.length],
      solid: false, parapet: false, roofProps: false,
    });
  }
}

// ---------------------------------------------------------------------------
// Collectibles + optional NPCs
// ---------------------------------------------------------------------------

function hiddenSpots(ctx, locations) {
  // 5 bones tucked where you have to look: behind crates, up on the roof route,
  // in the canal, on a market awning, and in the dead end behind spawn.
  locations.boneSpots = [
    new THREE.Vector3(-5.5, 0.2, 51.5),      // behind the spawn dumpsters
    new THREE.Vector3(-11.5, 0.2, 27),       // plaza's dark west corner
    new THREE.Vector3(23, 2.7, 2.2),         // on a market stall awning
    new THREE.Vector3(-4, 11.2, -9),         // rooftop catwalk corner
    new THREE.Vector3(-40, 0.2, -20.5),      // canal's west dead end
  ];

  // Two robots loitering off the main line for the optional micro-quests.
  locations.npcSpots = [
    new THREE.Vector3(-10, 0, 10),           // plaza south-west, by the trim strip
    new THREE.Vector3(16, 0, -4),            // market alley, leaning on the north wall
  ];

  // Faint floor glow under each bone so a sniffing dog has something to find.
  const markerMat = neonMaterial(NEON.yellow, { opacity: 0.22 });
  for (const p of locations.boneSpots) {
    ctx.batcher.floor(markerMat, p.x, p.y - 0.15, p.z, 1.0, 1.0);
  }
}
