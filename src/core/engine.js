import * as THREE from 'three';

const FIXED_DT = 1 / 60;
const MAX_FRAME_TIME = 0.25; // clamp so tab-switches don't spiral the accumulator

/**
 * Renderer + scene + fixed-timestep loop.
 *
 * new Engine({ antialias })      -> { scene, camera, renderer, ... }
 * engine.onUpdate(fn(dt))        -> register a fixed-step (60Hz) update
 * engine.onRender(fn(alpha, dt)) -> register a per-frame hook, called before the draw
 * engine.start() / engine.stop()
 */
export class Engine {
  constructor({ antialias = true, canvas = null } = {}) {
    // Three checks `canvas !== undefined`, so omit the key entirely when we have none.
    const params = { antialias, powerPreference: 'high-performance' };
    if (canvas) params.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer(params);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (!canvas) document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 400);

    this.updaters = [];
    this.renderers = [];

    // Optional postprocessing chain (see world/atmosphere.js). When set, the
    // composer draws instead of the renderer.
    this.composer = null;

    this._running = false;
    this._accumulator = 0;
    this._last = 0;
    this._frame = this._frame.bind(this);

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
  }

  onUpdate(fn) { this.updaters.push(fn); return fn; }
  onRender(fn) { this.renderers.push(fn); return fn; }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  /** Swap in a postprocessing chain (EffectComposer) as the draw path. */
  setComposer(composer) {
    this.composer = composer;
    this.resize();
    return composer;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    requestAnimationFrame(this._frame);
  }

  stop() {
    this._running = false;
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this._onResize);
    this.renderer.dispose();
  }

  _frame(now) {
    if (!this._running) return;
    requestAnimationFrame(this._frame);

    const elapsed = Math.min((now - this._last) / 1000, MAX_FRAME_TIME);
    this._last = now;
    this._accumulator += elapsed;

    while (this._accumulator >= FIXED_DT) {
      for (const fn of this.updaters) fn(FIXED_DT);
      this._accumulator -= FIXED_DT;
    }

    const alpha = this._accumulator / FIXED_DT;
    for (const fn of this.renderers) fn(alpha, elapsed);
    if (this.composer) this.composer.render(elapsed);
    else this.renderer.render(this.scene, this.camera);
  }
}
