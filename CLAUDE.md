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

Nothing built yet. When code exists, keep this section updated with the big-picture structure (scene management, game loop, input handling, asset pipeline) rather than per-file listings.

Guiding constraints for future work:

- Browser performance matters: target 60fps on mid-range hardware; watch draw calls and asset sizes.
- Game loop and rendering concerns should stay separate from game/entity logic.
- Assets (models, textures, audio) will likely dominate repo size — plan for glTF/GLB and compressed textures early.
