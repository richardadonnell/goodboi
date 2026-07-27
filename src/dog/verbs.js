import * as THREE from 'three';
import { BarkRing, DirtBurst, ScentTrail } from './vfx.js';

/**
 * The dog's four non-locomotion verbs: bark, sniff, fetch/carry, dig.
 *
 * Runs AFTER DogAnimator each step so it can layer pose offsets (head lift on a
 * bark, nose down while sniffing, scrabbling front legs while digging) on top
 * of the procedural gait without the animator knowing anything about verbs.
 *
 *   const verbs = new Verbs({ dog, controller, scene, items, events });
 *   verbs.registerDigSite({ id, position, onDig });
 *   verbs.setTrail([...waypoints]);      // quests supply the route to the objective
 *   verbs.update(dt, input, { blockInteract });
 *
 * State the rest of the game reads: `verbs.carrying`, `verbs.sniffing`,
 * `verbs.digging`, `verbs.digProgress`.
 */

const BARK_COOLDOWN = 0.6;
const BARK_ANIM = 0.45;
const BARK_RADIUS = 12;
const SNIFF_SPEED_SCALE = 0.45;
const PICKUP_RANGE = 2.5;
const DIG_TIME = 1.5;
const DIG_RANGE = 2.2;
const TRAIL_REBUILD = 0.2;

// Where a carried item sits: just under the snout, in head-local space.
const MOUTH = new THREE.Vector3(0, -0.02, -0.58);

export class Verbs {
  constructor({ dog, controller, scene, items, events }) {
    this.dog = dog;
    this.controller = controller;
    this.items = items;
    this.events = events;

    this.ring = new BarkRing(scene, { maxRadius: BARK_RADIUS });
    this.dirt = new DirtBurst(scene);
    this.trail = new ScentTrail(scene);

    this.carrying = null;
    this.sniffing = false;
    this.digging = false;
    this.digProgress = 0;

    this.digSites = [];
    this.trailWaypoints = null;

    this._barkCooldown = 0;
    this._barkAnim = 0;
    this._sniffBlend = 0;
    this._digTimer = 0;
    this._digSite = null;
    this._digSpray = 0;
    this._trailAge = 0;
    this._time = 0;

    this._v = new THREE.Vector3();
    this._forward = new THREE.Vector3();
  }

  // -------------------------------------------------------------------------
  // Registration (quests own the content, verbs own the mechanics)
  // -------------------------------------------------------------------------

  /** @param {{id:string, position:THREE.Vector3, radius?:number, onDig:Function}} spec */
  registerDigSite(spec) {
    const site = { radius: DIG_RANGE, enabled: true, dug: false, ...spec };
    this.digSites.push(site);
    return site;
  }

  /** Waypoints from somewhere near the dog to the current objective, or null. */
  setTrail(waypoints) {
    this.trailWaypoints = waypoints && waypoints.length ? waypoints : null;
    this._trailAge = TRAIL_REBUILD; // force a rebuild on the next sniffing step
  }

  /** The dig site the dog is standing on, if any. */
  activeDigSite() {
    for (const site of this.digSites) {
      if (!site.enabled || site.dug) continue;
      if (this.controller.position.distanceTo(site.position) <= site.radius) return site;
    }
    return null;
  }

  /** Nearest loose carryable in pickup range. */
  nearestCarryable(radius = PICKUP_RANGE) {
    return this.items.nearestCarryable(this.controller.position, radius);
  }

  /** Unit vector the dog is facing (its model rest pose faces -Z). */
  forward(out = this._forward) {
    return out.set(-Math.sin(this.controller.yaw), 0, -Math.cos(this.controller.yaw));
  }

  // -------------------------------------------------------------------------
  // Verbs
  // -------------------------------------------------------------------------

  bark() {
    if (this._barkCooldown > 0) return false;
    this._barkCooldown = BARK_COOLDOWN;
    this._barkAnim = BARK_ANIM;
    this.ring.play(this.controller.position);
    this.events.emit('verb:bark', {
      position: this.controller.position.clone(),
      radius: BARK_RADIUS,
    });
    return true;
  }

  pickUp(item) {
    if (!item || this.carrying) return false;
    this.items.attachTo(item, this.dog.head, MOUTH);
    this.carrying = item;
    this.events.emit('item:carried', { kind: item.kind, label: item.label, id: item.id });
    return true;
  }

  /** Drop whatever's in the mouth just in front of the dog, on the ground it's standing on. */
  drop() {
    const item = this.carrying;
    if (!item) return null;
    this.forward(this._v).multiplyScalar(0.95);
    this._v.add(this.controller.position);
    // Drop height follows the dog's feet, so items never end up inside geometry
    // or floating after a rooftop drop — always re-reachable.
    this._v.y = this.controller.position.y + 0.15;
    this.items.detach(item, this._v);
    this.carrying = null;
    this.events.emit('item:dropped', { kind: item.kind, label: item.label, id: item.id });
    return item;
  }

  /** Hand the carried item off to quest logic (fitted, given away, etc). */
  consumeCarried() {
    const item = this.carrying;
    if (!item) return null;
    this.items.consume(item);
    this.carrying = null;
    return item;
  }

  startDig(site) {
    if (this.digging || !site) return false;
    this.digging = true;
    this._digSite = site;
    this._digTimer = DIG_TIME;
    this._digSpray = 0;
    this.digProgress = 0;
    return true;
  }

  // -------------------------------------------------------------------------
  // Step
  // -------------------------------------------------------------------------

  update(dt, input, { blockInteract = false } = {}) {
    this._time += dt;
    if (this._barkCooldown > 0) this._barkCooldown -= dt;

    if (input) {
      if (input.wasPressed('bark')) this.bark();

      if (input.wasPressed('interact') && !blockInteract && !this.digging) {
        if (this.carrying) this.drop();
        else this.pickUp(this.nearestCarryable());
      }

      if (input.wasPressed('dig') && !this.digging) this.startDig(this.activeDigSite());
    }

    // Sniffing is a hold, and it's mutually exclusive with digging.
    this.sniffing = !!(input && input.isDown('sniff')) && !this.digging;

    this._updateDig(dt);

    this.controller.speedScale = this.digging ? 0 : (this.sniffing ? SNIFF_SPEED_SCALE : 1);

    this._updateTrail(dt);
    this._updatePose(dt);

    this.ring.update(dt);
    this.dirt.update(dt);
    return this;
  }

  _updateDig(dt) {
    if (!this.digging) return;
    this._digTimer -= dt;
    this.digProgress = 1 - Math.max(0, this._digTimer) / DIG_TIME;

    // Spray dirt from just in front of the paws in bursts, not every frame.
    this._digSpray -= dt;
    if (this._digSpray <= 0) {
      this._digSpray = 0.13;
      this.forward(this._v).multiplyScalar(0.55).add(this.controller.position);
      this._v.y = this.controller.position.y;
      this.dirt.play(this._v, 14);
    }

    if (this._digTimer <= 0) {
      const site = this._digSite;
      this.digging = false;
      this._digSite = null;
      this.digProgress = 0;
      if (site) {
        site.dug = true;
        this.forward(this._v).multiplyScalar(0.8).add(this.controller.position);
        this._v.y = this.controller.position.y + 0.2;
        this.dirt.play(this._v, 40);
        this.events.emit('verb:dig', { id: site.id, position: site.position.clone() });
        site.onDig?.(site, this._v.clone());
      }
    }
  }

  _updateTrail(dt) {
    this._trailAge += dt;
    if (this.sniffing && this.trailWaypoints && this._trailAge >= TRAIL_REBUILD) {
      this._trailAge = 0;
      this.trail.setPath(this._buildPath());
    }
    this.trail.update(dt, this.sniffing && !!this.trailWaypoints);
  }

  /**
   * Dog -> the remaining waypoints -> objective. Starting from the waypoint
   * nearest the dog means the trail never doubles back on ground already covered.
   */
  _buildPath() {
    const wps = this.trailWaypoints;
    const pos = this.controller.position;
    let start = 0;
    let bestDist = Infinity;
    for (let i = 0; i < wps.length; i++) {
      const d = wps[i].distanceToSquared(pos);
      if (d < bestDist) {
        bestDist = d;
        start = i;
      }
    }
    // Skip the nearest waypoint itself if we're basically on top of it.
    if (bestDist < 4 && start < wps.length - 1) start++;

    const points = [new THREE.Vector3(pos.x, pos.y + 0.1, pos.z)];
    for (let i = start; i < wps.length; i++) points.push(wps[i]);
    return points.length >= 2 ? points : null;
  }

  /** Pose offsets layered over DogAnimator's output. */
  _updatePose(dt) {
    const { dog } = this;

    // --- bark: head snaps up and back, ears perk, mouth opens ---
    if (this._barkAnim > 0) {
      this._barkAnim = Math.max(0, this._barkAnim - dt);
      const u = 1 - this._barkAnim / BARK_ANIM;
      const amount = Math.pow(Math.sin(u * Math.PI), 0.6);
      dog.head.rotation.x -= 0.55 * amount;
      dog.head.position.y += 0.09 * amount;
      dog.snout.position.y = 0.04 - 0.05 * amount;
      for (let i = 0; i < dog.ears.length; i++) {
        dog.ears[i].rotation.x -= 0.5 * amount;
      }
      dog.tailBase.rotation.x -= 0.25 * amount;
    } else {
      dog.snout.position.y = 0.04;
    }

    // --- sniff: nose to the ground, slow deliberate head sway ---
    const sniffTarget = this.sniffing ? 1 : 0;
    this._sniffBlend += (sniffTarget - this._sniffBlend) * Math.min(1, dt * 8);
    if (this._sniffBlend > 0.01) {
      const s = this._sniffBlend;
      dog.head.rotation.x += 0.55 * s;
      dog.head.position.y -= 0.22 * s;
      dog.head.rotation.y = Math.sin(this._time * 3.4) * 0.28 * s;
      dog.body.rotation.x += 0.1 * s;
    } else {
      dog.head.rotation.y = 0;
    }

    // --- dig: front legs scrabble, rump up, head down between the paws ---
    if (this.digging) {
      const t = this._time * 22;
      dog.legs[0].rotation.x = -0.9 + Math.sin(t) * 0.75;
      dog.legs[1].rotation.x = -0.9 + Math.sin(t + Math.PI) * 0.75;
      dog.body.rotation.x = 0.32;
      dog.body.position.y = dog.rest.bodyY - 0.06;
      dog.head.rotation.x = 0.85 + Math.sin(t * 0.5) * 0.1;
      dog.head.position.y = dog.rest.headY - 0.32;
      dog.tailBase.rotation.x = dog.rest.tailBaseX - 0.5;
    }
  }
}
