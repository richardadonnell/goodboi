# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**GoodBoi** — a browser-based 3D adventure game where you play as a stray dog. Inspired loosely by the vibe of *Stray* (BlueTwelve, 2022), but dog-centric: fetch, dig, bark, sniff-trails, carry objects. Atmosphere-first, low-stress exploration and puzzles.

The project is greenfield; the design is still being shaped. Broad direction only so far:

- **Engine:** Three.js (WebGL), running entirely in the browser. No Steam, no native builds.
- **Distribution:** static web app — should be deployable to any static host.
- **Working title:** "GoodBoi" (alternate considered: "Pound").

## Tech Decisions (initial)

- Three.js for rendering.
- Vite for dev server / bundling (fast HMR, trivial static output). Plain ES modules, no framework unless a real need appears.
- Keep dependencies minimal — prefer Three.js built-ins (OrbitControls, GLTFLoader, etc. from `three/addons/`) over third-party libs.

## Commands

Once scaffolded (not yet done):

```
npm install
npm run dev      # Vite dev server
npm run build    # production build to dist/
npm run preview  # serve the production build locally
```

## Architecture Notes

`src/main.js` wires the pieces together and owns the per-step update order; nothing else knows about anything else.

- **`src/core`** — `Engine` (renderer, scene, fixed-timestep loop, optional `EffectComposer` draw path via `setComposer`), `Input`, `FollowCamera`. No game logic.
- **`src/dog`** — procedural dog mesh, `DogAnimator`, and `DogController` (axis-separated AABB resolution against an array of `THREE.Box3`; no physics engine).
- **`src/world`** — the city district. `index.js` assembles and exports the world contract: `{ group, colliders, spawn, spawnYaw, groundY, fog, background, lights, locations, elevator, gates, update(dt) }`. `layout.js` holds the palette, shared materials, and the `Batcher` that merges all static geometry into ~one draw call per material. `buildings.js` / `neon.js` / `props.js` / `atmosphere.js` are pure builders writing into that batcher.

- **`src/npc`** — `Robot` (boxy procedural bot, canvas-texture screen face + floating dialogue billboard) and `Pigeons` (flock that scatters on a bark). `index.js` places Lampy and the two side-quest bots at `world.locations`.
- **`src/quests`** — `index.js` is the whole arc as a flat, ordered list of steps; each owns its objective text, sniff-trail route, optional F-interaction and a `check()` that advances it. `items.js` holds the procedural carryables (wrench, fuse, ball, bone, collar tag) and the dig mounds.

`world.locations` is the handshake with later phases: every quest beat, dig spot, NPC slot, and collectible position is a named vector there, so quest code never hardcodes coordinates.

`src/core/events.js` is the other handshake — a tiny pub/sub the game logic emits into (`objective:changed`, `prompt:show/hide`, `dialogue:show`, `bone:collected`, `game:ended`, …). Nothing under `src/quests`, `src/npc` or `src/dog` touches the DOM; the HUD subscribes.

- **`src/ui`** — the only code that touches the DOM. `createUI({ events, dom })` builds one `#ui` overlay (styled by `ui.css`) holding the HUD (objective banner, bone counter, interaction prompt, dialogue box, memory card) and the start / pause / ending screens. It subscribes to the bus and exposes `ui.playing`, which is the gate `main.js` uses to skip the simulation on the start and pause screens.
- **`src/audio`** — `createAudio({ events })`: every sound synthesized in WebAudio, no files. An ambient pad (detuned saws through an LFO-swept lowpass) plus one-shots for bark, footsteps, pickup, dig, quest sting and the ending chord. Nothing exists until `start()` runs from the start-screen click, since browsers require a gesture; footsteps are driven from `audio.update(dt, controller)`.

The dog's verbs live in `src/dog/verbs.js` (bark / sniff / fetch-carry / dig) with their effects in `vfx.js`. Verbs run *after* `DogAnimator` each step and layer pose offsets over the gait, so the animator stays ignorant of them. Quests get first refusal on the F key and tell Verbs whether the press was consumed.

Keep this section updated with big-picture structure rather than per-file listings.

Guiding constraints for future work:

- Browser performance matters: target 60fps on mid-range hardware; watch draw calls and asset sizes.
- Game loop and rendering concerns should stay separate from game/entity logic.
- Assets (models, textures, audio) will likely dominate repo size — plan for glTF/GLB and compressed textures early.
