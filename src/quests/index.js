import * as THREE from 'three';
import { Items, createMound } from './items.js';

export { Items };

/**
 * The main quest arc (6 beats from DESIGN.md), the two side micro-quests and
 * the bone collectibles.
 *
 * Everything is a linear list of steps. A step owns its objective text, the
 * waypoint route the sniff trail follows, an optional F-interaction, and a
 * `check` that returns true once the step is satisfied. That keeps the arc
 * readable top-to-bottom and makes it hard to build a state that can't advance.
 *
 *   const quests = createQuests({ world, items, verbs, npcs, events });
 *   quests.update(dt, { input, controller, verbs, npcs });
 *
 * Softlock policy: nothing is ever consumed until the step that needs it fires,
 * dropped items stay pickable, dug spots stay dug, opened gates stay open, and
 * every distance check is deliberately generous.
 */

const BONE_PICKUP = 1.8;
const TALK_RANGE = 3.6;
const GIVE_RANGE = 3.6;
const FIT_RANGE = 3.4;
const ELEVATOR_RANGE = 4.5;
const SENSOR_RANGE = 14;
const MEMORY_TIME = 4.2;

const v = (x, y, z) => new THREE.Vector3(x, y, z);

export function createQuests({ world, items, verbs, npcs, events }) {
  const L = world.locations;
  const gates = world.gates;

  // -------------------------------------------------------------------------
  // Routes — hand-placed walkable waypoints, so scent trails hug the level
  // instead of cutting through walls.
  // -------------------------------------------------------------------------
  const ROUTE = {
    toPlaza: [v(-3, 0, 42), v(-3, 0, 34), v(-1, 0, 28), L.plaza.clone()],
    toLampy: [v(0, 0, 22), L.lampyPos.clone()],
    toWrench: [v(-4, 0, 21), L.digSpotWrench.clone()],
    toMarket: [v(0, 0, 12), v(0, 0, 5), v(2, 0, -1), v(7, 0, -2)],
    toJunction: [v(14, 0, -2), v(20, 0, -3), v(25, 0, -4)],
    toElevator: [v(28, 0, -2), L.elevator.clone()],
    acrossRoofs: [
      v(28.2, 9, -1), v(24, 9, -1), v(17.5, 9.4, -1), v(11, 9.8, -2), L.pigeonLedge.clone(),
    ],
    downToCanal: [
      v(-2, 10.6, -3), v(-3, 11, -9), v(-5, 10.6, -15),
      v(-9, 8.4, -19.5), v(-9, 5.8, -20.5), v(-9, 3.4, -17.5), v(-9, 1.4, -20.5), v(-12, 0, -19.5),
    ],
    toCollar: [v(-18, 0, -19), L.digSpotCollar.clone()],
    toSensor: [v(-18, 0, -19), v(-6, 0, -19), v(0, 0, -22), v(0, 0, -28), v(3.2, 0, -32)],
    toHome: [v(0, 0, -36), v(0, 0, -40), L.homeDoor.clone()],
  };

  const cat = (...routes) => routes.flat();

  // -------------------------------------------------------------------------
  // Items: quest props, the ball, and the five bones.
  // -------------------------------------------------------------------------
  const wrench = items.add({ id: 'wrench', kind: 'wrench', position: L.digSpotWrench.clone(), hidden: true });
  const fuse = items.add({ id: 'fuse', kind: 'fuse', position: L.fusePos.clone() });
  const tag = items.add({ id: 'tag', kind: 'tag', position: L.digSpotCollar.clone(), hidden: true });
  const ball = items.add({ id: 'ball', kind: 'ball', position: v(9, 0.2, 10) });

  const bones = L.boneSpots.map((p, i) => items.add({ id: `bone${i}`, kind: 'bone', position: p.clone(), carryable: false }));

  // Mounds mark the two dig spots. They sink away once dug.
  const mounds = {
    wrench: createMound(L.digSpotWrench, { radius: 0.85 }),
    collar: createMound(L.digSpotCollar, { radius: 1.0 }),
  };
  items.group.add(mounds.wrench.group, mounds.collar.group);

  const state = {
    beat: 0,          // bumped to 1 the moment the first step is entered
    stepId: null,
    bones: 0,
    boneTotal: bones.length,
    sideQuests: 0,
    sideQuestTotal: 2,
    barked: false,
    sniffed: false,
    ended: false,
    seconds: 0,
  };

  const flags = {
    lampyIntro: false,
    wrenchDug: false,
    wrenchGiven: false,
    fuseFitted: false,
    collarDug: false,
    homeGateOpen: false,
    pipAsked: false,
    pipDone: false,
    voltAsked: false,
    voltDone: false,
  };

  // -------------------------------------------------------------------------
  // Dig sites (registered up front, gated by `enabled` so the arc controls pacing)
  // -------------------------------------------------------------------------
  const wrenchSite = verbs.registerDigSite({
    id: 'digSpotWrench',
    position: L.digSpotWrench.clone(),
    enabled: false,
    onDig: (site, popPosition) => {
      flags.wrenchDug = true;
      items.reveal(wrench, popPosition);
      sink(mounds.wrench);
      npcs.lampy.say('That is the one! Bring it here, small dog.', 4, 'happy');
      say('Lampy', 'That is the one! Bring it here, small dog.', 4);
    },
  });

  const collarSite = verbs.registerDigSite({
    id: 'digSpotCollar',
    position: L.digSpotCollar.clone(),
    enabled: false,
    onDig: (site, popPosition) => {
      flags.collarDug = true;
      items.reveal(tag, popPosition);
      sink(mounds.collar);
      startMemory();
    },
  });

  // -------------------------------------------------------------------------
  // Cinematic: the collar-tag memory moment
  // -------------------------------------------------------------------------
  const cinematic = { timer: 0, active: false };

  function startMemory() {
    cinematic.active = true;
    cinematic.timer = MEMORY_TIME;
    events.emit('memory:show', {
      text: 'A name you have not heard in a long time. A door, a warm hallway, someone calling you in.',
    });
  }

  // -------------------------------------------------------------------------
  // Steps
  // -------------------------------------------------------------------------
  const steps = [
    {
      id: 'wake', beat: 1,
      objective: 'Wake up. Bark (B), sniff (hold Q), and follow the trail out of the alley.',
      target: () => L.plaza,
      route: () => ROUTE.toPlaza,
      check: (ctx) => state.barked && state.sniffed && near(ctx.position, L.plaza, 8),
    },
    {
      id: 'lampy-intro', beat: 2,
      objective: 'Someone is fussing with a broken streetlight. Go say hello.',
      target: () => L.lampyPos,
      route: () => ROUTE.toLampy,
      check: () => flags.lampyIntro,
    },
    {
      id: 'find-wrench', beat: 2,
      objective: "Sniff out Lampy's wrench and dig it up (X on the loose earth).",
      target: () => L.digSpotWrench,
      route: () => ROUTE.toWrench,
      enter: () => { wrenchSite.enabled = true; },
      check: () => flags.wrenchDug,
    },
    {
      id: 'return-wrench', beat: 2,
      objective: 'Carry the wrench back to Lampy (F to pick up, F again to hand it over).',
      target: () => L.lampyPos,
      route: () => (carrying('wrench') ? ROUTE.toLampy : [itemPos(wrench)]),
      check: () => flags.wrenchGiven,
    },
    {
      id: 'find-fuse', beat: 3,
      objective: 'The gate is open. Find a fuse in the market alley.',
      target: () => itemPos(fuse),
      route: () => (carrying('fuse') ? ROUTE.toJunction : cat(ROUTE.toMarket, [itemPos(fuse)])),
      check: () => carrying('fuse') || flags.fuseFitted,
    },
    {
      id: 'fit-fuse', beat: 3,
      objective: 'Fit the fuse into the junction box to power the elevator.',
      target: () => L.junctionBox,
      route: () => (carrying('fuse') ? ROUTE.toJunction : cat([itemPos(fuse)], ROUTE.toJunction)),
      check: () => flags.fuseFitted,
    },
    {
      id: 'ride-elevator', beat: 3,
      objective: 'Ride the elevator up to the rooftops (F to call it).',
      target: () => L.elevator,
      route: () => ROUTE.toElevator,
      check: (ctx) => ctx.position.y > 7.5,
    },
    {
      id: 'rooftops', beat: 4,
      objective: 'Cross the rooftop catwalks westward.',
      target: () => L.pigeonLedge,
      route: () => ROUTE.acrossRoofs,
      check: (ctx) => near(ctx.position, L.pigeonLedge, 7),
    },
    {
      id: 'pigeons', beat: 4,
      objective: 'Pigeons are holding the ledge. Bark (B) and clear them off.',
      target: () => L.pigeonLedge,
      route: () => [L.pigeonLedge.clone()],
      check: () => npcs.pigeons.scattered,
    },
    {
      id: 'to-canal', beat: 4,
      objective: 'Follow the roofs down into the drainage canal.',
      target: () => L.canal,
      route: () => ROUTE.downToCanal,
      check: (ctx) => ctx.position.y < 2.2 && ctx.position.z < -14,
    },
    {
      id: 'find-collar', beat: 5,
      objective: 'Something of yours is buried down here. Sniff it out, then dig (X).',
      target: () => L.digSpotCollar,
      route: () => ROUTE.toCollar,
      enter: () => { collarSite.enabled = true; },
      check: () => flags.collarDug && !cinematic.active,
    },
    {
      id: 'to-sensor', beat: 6,
      objective: 'You know the way now. A gate blocks the last street — find the sound sensor.',
      target: () => L.soundSensor,
      route: () => ROUTE.toSensor,
      check: (ctx) => near(ctx.position, L.soundSensor, SENSOR_RANGE) || flags.homeGateOpen,
    },
    {
      id: 'bark-sensor', beat: 6,
      objective: 'Bark (B) at the sound sensor to open the gate.',
      target: () => L.soundSensor,
      route: () => [v(0, 0, -28), v(3.2, 0, -32)],
      check: () => flags.homeGateOpen,
    },
    {
      id: 'go-home', beat: 6,
      objective: 'Go home.',
      target: () => L.homeDoor,
      route: () => ROUTE.toHome,
      check: (ctx) => near(ctx.position, L.homeDoor, 3.2),
      complete: () => endGame(),
    },
  ];

  let index = -1;

  // -------------------------------------------------------------------------
  // Reactions
  // -------------------------------------------------------------------------

  events.on('verb:bark', ({ position }) => {
    state.barked = true;

    // Beat 6: the sensor lifts the home gate. Generous radius on purpose.
    if (!flags.homeGateOpen && position.distanceTo(L.soundSensor) <= SENSOR_RANGE) {
      flags.homeGateOpen = true;
      gates.sensor.setTriggered(true);
      gates.homeGate.setOpen(true);
      say('', 'The gate grinds upward.', 2.5);
    }

    // Side quest: Volt's speaker test.
    if (flags.voltAsked && !flags.voltDone && position.distanceTo(npcs.volt.group.position) <= 8) {
      flags.voltDone = true;
      npcs.volt.say('LOUD AND CLEAR. Speaker works. You are a very good diagnostic tool.', 5, 'happy');
      completeSideQuest('volt', "Volt's speaker test");
    }
  });

  // -------------------------------------------------------------------------
  // Interaction (F). Returns true when quest logic consumed the press, which
  // tells Verbs not to also pick something up.
  // -------------------------------------------------------------------------

  function interactionAt(ctx) {
    const pos = ctx.position;
    const held = verbs.carrying;

    if (held?.kind === 'fuse' && !flags.fuseFitted && near(pos, L.junctionBox, FIT_RANGE)) {
      return { text: 'F — Fit the fuse', run: fitFuse };
    }
    if (held?.kind === 'wrench' && !flags.wrenchGiven && near(pos, L.lampyPos, GIVE_RANGE)) {
      return { text: 'F — Give Lampy the wrench', run: giveWrench };
    }
    if (held?.kind === 'ball' && flags.pipAsked && !flags.pipDone && near(pos, npcs.pip.group.position, GIVE_RANGE)) {
      return { text: 'F — Give Pip the ball', run: givePip };
    }

    // Picking something up beats talking, so an item lying at a robot's feet is
    // never unreachable.
    if (!held && verbs.nearestCarryable()) return null;

    // Talking works with something in your mouth — otherwise walking up to Pip
    // holding the ball would drop it instead of starting the conversation.
    const bot = npcs.nearest(pos, TALK_RANGE);
    if (bot) return { text: `F — Talk to ${bot.name}`, run: () => talk(bot) };

    const elevator = world.elevator;
    if (elevator.enabled && near(pos, L.elevator, ELEVATOR_RANGE) && elevator.state === 'idle') {
      return { text: 'F — Call the elevator', run: () => elevator.call() };
    }
    return null;
  }

  function fitFuse() {
    verbs.consumeCarried();
    flags.fuseFitted = true;
    world.elevator.enable();
    say('', 'The junction box hums. Somewhere down the alley, a motor wakes up.', 3.5);
  }

  function giveWrench() {
    verbs.consumeCarried();
    // A player who digs first and hands it over without ever talking would
    // otherwise strand the arc on the intro step.
    flags.lampyIntro = true;
    flags.wrenchGiven = true;
    gates.gate1.setOpen(true);
    npcs.lampy.setEmote('heart');
    npcs.lampy.say('My wrench! Good dog. Very good dog. Here — the gate is yours.', 5.5);
    say('Lampy', 'My wrench! Good dog. Very good dog. Here — the gate is yours.', 5.5);
  }

  function givePip() {
    verbs.consumeCarried();
    flags.pipDone = true;
    npcs.pip.say('You brought it BACK. Nobody ever brings it back!', 5, 'heart');
    completeSideQuest('pip', "Pip's ball");
  }

  function talk(bot) {
    if (bot === npcs.lampy) {
      if (!flags.lampyIntro) {
        flags.lampyIntro = true;
        bot.say('A dog! A real one. Listen — I dropped my wrench and something buried it. West wall, soft ground. Dig it up?', 6.5, 'alert');
        say('Lampy', 'A dog! A real one. Listen — I dropped my wrench and something buried it. West wall, soft ground. Dig it up?', 6.5);
      } else if (!flags.wrenchGiven) {
        bot.say('Soft ground by the west wall. Sniff for it, then dig.', 4, 'question');
        say('Lampy', 'Soft ground by the west wall. Sniff for it, then dig.', 4);
      } else {
        bot.say('Go on then. Whatever you are looking for, it is north of here.', 4.5, 'happy');
        say('Lampy', 'Go on then. Whatever you are looking for, it is north of here.', 4.5);
      }
      return;
    }

    if (bot === npcs.pip) {
      if (flags.pipDone) {
        bot.say('Best day. Best day in eleven years.', 3.5, 'heart');
        say('Pip', 'Best day. Best day in eleven years.', 3.5);
      } else {
        flags.pipAsked = true;
        bot.say('I threw my ball. That was in the spring. It is somewhere in this plaza. Bring it back?', 6, 'sad');
        say('Pip', 'I threw my ball. That was in the spring. It is somewhere in this plaza. Bring it back?', 6);
      }
      return;
    }

    if (bot === npcs.volt) {
      if (flags.voltDone) {
        bot.say('Speaker: nominal. Dog: excellent.', 3.5, 'happy');
        say('Volt', 'Speaker: nominal. Dog: excellent.', 3.5);
      } else {
        flags.voltAsked = true;
        bot.say('New speaker, no way to test it. Make a loud noise for me? Bark, if that is a thing you do.', 6, 'question');
        say('Volt', 'New speaker, no way to test it. Make a loud noise for me? Bark, if that is a thing you do.', 6);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Prompts
  // -------------------------------------------------------------------------

  let lastPrompt = null;

  function promptFor(ctx) {
    if (state.ended || cinematic.active) return null;

    const action = interactionAt(ctx);
    if (action) return action.text;

    if (verbs.digging) return null;
    const site = verbs.activeDigSite();
    if (site) return 'X — Dig';

    if (!verbs.carrying) {
      const item = verbs.nearestCarryable();
      if (item) return `F — Pick up ${item.label}`;
    } else {
      return `F — Drop ${verbs.carrying.label}`;
    }
    return null;
  }

  function setPrompt(text) {
    if (text === lastPrompt) return;
    lastPrompt = text;
    if (text) events.emit('prompt:show', { text });
    else events.emit('prompt:hide', {});
  }

  // -------------------------------------------------------------------------
  // Progress plumbing
  // -------------------------------------------------------------------------

  function say(speaker, text, duration = 4) {
    events.emit('dialogue:show', { speaker, text, duration });
  }

  function completeSideQuest(id, title) {
    state.sideQuests++;
    events.emit('sidequest:done', { id, title, done: state.sideQuests, total: state.sideQuestTotal });
  }

  function advance() {
    if (index >= 0) steps[index].complete?.();
    if (state.ended) return;
    index++;
    const step = steps[index];
    if (!step) return;

    if (step.beat !== state.beat) {
      state.beat = step.beat;
      events.emit('quest:beat', { beat: step.beat, id: step.id });
    }
    state.stepId = step.id;
    step.enter?.();
    refreshTrail();
    events.emit('objective:changed', {
      id: step.id,
      beat: step.beat,
      text: step.objective,
      position: step.target?.()?.clone() ?? null,
    });
  }

  function refreshTrail() {
    const step = steps[index];
    verbs.setTrail(step ? step.route?.().filter(Boolean) : null);
  }

  function endGame() {
    if (state.ended) return;
    state.ended = true;
    gates.homeLight.setOn(true);
    setPrompt(null);
    verbs.setTrail(null);
    events.emit('objective:changed', { id: 'end', beat: 6, text: 'Home.', position: null });
    events.emit('game:ended', {
      bones: state.bones,
      boneTotal: state.boneTotal,
      sideQuests: state.sideQuests,
      sideQuestTotal: state.sideQuestTotal,
      seconds: Math.round(state.seconds),
    });
  }

  function collectBones(position) {
    for (const bone of bones) {
      if (bone.collected) continue;
      if (bone.group.position.distanceTo(position) > BONE_PICKUP) continue;
      items.consume(bone);
      state.bones++;
      events.emit('bone:collected', {
        count: state.bones,
        total: state.boneTotal,
        position: bone.group.position.clone(),
      });
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  function near(a, b, r) { return a.distanceTo(b) <= r; }
  function carrying(kind) { return verbs.carrying?.kind === kind; }
  function itemPos(item) { return items.worldPosition(item, new THREE.Vector3()); }
  function sink(mound) { mound.group.visible = false; }

  // -------------------------------------------------------------------------
  // Public object
  // -------------------------------------------------------------------------

  const quests = {
    state,
    flags,
    items,
    /** True while the game should ignore player input (memory moment, ending). */
    get inputLocked() { return cinematic.active || state.ended; },
    /** Camera distance the follow camera should ease toward. */
    get cameraDistance() { return cinematic.active ? 3.2 : (state.ended ? 4.5 : 6); },
    get step() { return steps[index] || null; },

    start() {
      if (index < 0) advance();
      return quests;
    },

    update(dt, { input, controller }) {
      state.seconds += dt;
      const ctx = { position: controller.position, dt };

      if (verbs.sniffing) {
        if (!state.sniffed) state.sniffed = true;
        if (!quests._sniffWas) refreshTrail();   // re-aim at moved/dropped items
        quests._sniffWas = true;
      } else {
        quests._sniffWas = false;
      }

      collectBones(controller.position);

      if (cinematic.active) {
        cinematic.timer -= dt;
        if (cinematic.timer <= 0) {
          cinematic.active = false;
          events.emit('memory:hide', {});
        }
      }

      let interactHandled = false;
      if (input && !quests.inputLocked && input.wasPressed('interact')) {
        const action = interactionAt(ctx);
        if (action) {
          action.run();
          interactHandled = true;
        }
      }

      setPrompt(promptFor(ctx));

      const step = steps[index];
      if (step && !state.ended && step.check(ctx)) advance();

      return { interactHandled };
    },
  };

  return quests;
}
