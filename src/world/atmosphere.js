import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Night atmosphere: sky dome, exponential fog, and the ambient/moon lighting
 * rig. Neon point lights come from NeonSystem; this module only supplies the
 * base so unlit corners stay readable instead of pure black.
 */

export const SKY_TOP = 0x05060d;
export const SKY_HORIZON = 0x1b1030;   // faint purple glow the city bleeds upward
export const FOG_COLOR = 0x0b0c18;

/** Big inverted dome with a vertical gradient painted into vertex colors. */
export function createSky(radius = 260) {
  const geo = new THREE.SphereGeometry(radius, 24, 16);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(SKY_TOP);
  const horizon = new THREE.Color(SKY_HORIZON);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / radius, -1, 1);
    // squash the gradient toward the horizon so the glow hugs the skyline
    c.copy(horizon).lerp(top, Math.pow(THREE.MathUtils.clamp(t, 0, 1), 0.45));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    fog: false,
    depthWrite: false,
  }));
  mesh.renderOrder = -1;
  return mesh;
}

/** Sparse star points, dimmed so bloom doesn't turn them into blobs. */
export function createStars(count = 300, radius = 230) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * Math.PI * 2;
    const v = Math.random() * 0.55 + 0.15;   // upper hemisphere only
    const r = radius;
    positions[i * 3] = Math.cos(u) * Math.cos(v) * r;
    positions[i * 3 + 1] = Math.sin(v) * r;
    positions[i * 3 + 2] = Math.sin(u) * Math.cos(v) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0x8fa6d8, size: 1.1, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.55 });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -1;
  return points;
}

/**
 * Base lighting rig.
 * One shadow-casting "moon" (the only shadow map we pay for) plus a hemisphere
 * fill tinted blue-from-above / purple-from-below.
 */
export function createLights({ shadowExtent = 60 } = {}) {
  const moon = new THREE.DirectionalLight(0x8ea8ff, 1.7);
  moon.position.set(-40, 70, 30);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  moon.shadow.camera.near = 10;
  moon.shadow.camera.far = 180;
  moon.shadow.camera.left = -shadowExtent;
  moon.shadow.camera.right = shadowExtent;
  moon.shadow.camera.top = shadowExtent;
  moon.shadow.camera.bottom = -shadowExtent;
  moon.shadow.bias = -0.0012;
  moon.shadow.normalBias = 0.04;

  const hemi = new THREE.HemisphereLight(0x4a67ad, 0x33204d, 1.5);
  const ambient = new THREE.AmbientLight(0x39436f, 1.1);

  return [moon, hemi, ambient, moon.target];
}

export function createFog() {
  return new THREE.FogExp2(FOG_COLOR, 0.013);
}

/**
 * Bloom pipeline. Returns an EffectComposer the engine renders instead of
 * calling renderer.render directly.
 */
export function createComposer(renderer, scene, camera, {
  strength = 0.5, radius = 0.45, threshold = 0.8,
} = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(size.x, size.y);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), strength, radius, threshold);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  composer.bloom = bloom;
  return composer;
}
