import * as THREE from 'three';
import { Robot } from './robot.js';
import { Pigeons } from './pigeons.js';

export { Robot, Pigeons };

/**
 * Populates the district: Lampy on the main line, two loitering side-quest
 * bots, and the rooftop pigeons.
 *
 *   const npcs = createNpcs({ world, events });
 *   scene.add(npcs.group);
 *   npcs.update(dt, dogPosition);
 *
 * Returns { group, lampy, pip, volt, robots, pigeons, nearest(pos, radius), update }.
 */
export function createNpcs({ world, events }) {
  const group = new THREE.Group();
  const { locations, colliders } = world;

  const lampy = new Robot({
    name: 'Lampy',
    position: locations.lampyPos,
    color: 0xffd23f,
    yaw: facing(locations.lampyPos, locations.plaza),
    height: 1.7,
    colliders,
  });

  const pip = new Robot({
    name: 'Pip',
    position: locations.npcSpots[0],
    color: 0x3dff9e,
    yaw: facing(locations.npcSpots[0], locations.plaza),
    height: 1.25,
    colliders,
  });

  const volt = new Robot({
    name: 'Volt',
    position: locations.npcSpots[1],
    color: 0xa45cff,
    yaw: facing(locations.npcSpots[1], locations.marketAlley),
    height: 1.55,
    colliders,
  });

  const robots = [lampy, pip, volt];
  for (const bot of robots) group.add(bot.group);

  const pigeons = new Pigeons({ position: locations.pigeonLedge, count: 7, events });
  group.add(pigeons.group);

  return {
    group,
    lampy,
    pip,
    volt,
    robots,
    pigeons,
    /** Nearest robot to `position` within `radius`, or null. */
    nearest(position, radius = 3.5) {
      let best = null;
      let bestDist = radius * radius;
      for (const bot of robots) {
        const d = bot.group.position.distanceToSquared(position);
        if (d < bestDist) {
          bestDist = d;
          best = bot;
        }
      }
      return best;
    },
    update(dt, dogPosition) {
      for (const bot of robots) bot.update(dt, dogPosition);
      pigeons.update(dt);
    },
  };
}

/** Yaw that points a -Z-facing model from `from` toward `to`. */
function facing(from, to) {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}
