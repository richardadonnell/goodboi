# GoodBoi — Design Spec (v1 vertical slice)

Browser-based 3D adventure. You are a stray dog in a post-human neon robot city, trying to find your way home. Three.js + Vite, static deploy, no backend.

## Pillars
- Chill exploration, atmosphere-first (Stray-inspired mood, dog-centric verbs)
- ~15–30 min polished vertical slice: one handcrafted city district
- Runs 60fps on mid-range hardware; all assets procedural/primitive low-poly (flat-shaded), no external model files

## Player verbs
- **Move/run/jump**: third-person controller, WASD + mouse-orbit camera, Shift run, Space jump
- **Bark** (B): triggers reactions — scares pigeons, activates sound sensors, gets NPC attention
- **Sniff** (hold Q or E): reveals glowing scent trails leading to objectives
- **Fetch/Carry** (F): pick up / drop small items (bone, ball, fuse, key item); carried in mouth
- **Dig** (X at dig spots): unearth buried items

## World
One district: neon alleys, small plaza, rooftop route, drainage canal. Low-poly buildings with emissive neon signs, fog, night lighting, puddle-reflective look (cheap: emissive + bloom). Robot NPCs (boxy, screen faces, emote via screen icons + floating text dialogue).

## Quest arc (main line, ~6 beats)
1. Wake in alley. Tutorial: move, bark, sniff. Scent trail → plaza.
2. Plaza robot "Lampy" (streetlight repair bot): fetch its dropped wrench (dig spot) → opens gate.
3. Market alley: carry fuse to junction box → powers elevator to rooftops.
4. Rooftop route: platforming traversal, bark at pigeons blocking a ledge.
5. Canal: find buried collar tag (sniff + dig) — memory of home, reveals home direction.
6. Final gate: bark at sound sensor, squeeze through, cutscene-lite ending — dog reaches door of home, lights turn on. Credits.

Side content: 5 hidden bones (collectible counter), 2 optional NPC micro-quests.

## UI
Minimal diegetic-ish HUD: objective hint text (fades), bone counter, interaction prompts ("F — Pick up"). Start screen with title + "Press any key". Ending/credits screen. Pause (Esc).

## Audio
WebAudio, procedural/synthesized or tiny embedded: ambient synth pad loop, bark sfx, pickup chime, footsteps, quest-complete sting. No large audio files.

## Tech
- Vite + Three.js, plain ES modules, no framework
- Structure: `src/core` (loop, input, camera), `src/dog` (controller + procedural dog model w/ simple animation: leg swing, tail wag), `src/world` (city gen, props, lighting), `src/npc`, `src/quests` (state machine), `src/ui`, `src/audio`
- Fixed-timestep update, render at rAF; postprocessing: bloom (UnrealBloomPass) + fog
- Collision: simple AABB/capsule vs boxes (no physics engine)
- Save nothing (single session); quest state in memory

## Definition of done
`npm run build` clean; playable start→credits in browser; 60fps-ish; no console errors; all verbs used at least once in main quest.
