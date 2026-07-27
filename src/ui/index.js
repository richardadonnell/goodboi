import './ui.css';

/**
 * The whole DOM layer: HUD (objective / bones / prompt / dialogue / memory) plus
 * the start, pause and ending screens.
 *
 * It only ever *reads* the event bus — game logic never touches the DOM. The one
 * thing it pushes back out is its state: `ui.playing` gates the simulation in
 * main.js, and the `onStart` / `onResume` callbacks let audio follow along.
 *
 *   const ui = createUI({ events, dom: engine.renderer.domElement, onStart });
 *   ui.update(dt);   // every fixed step, paused or not
 */

const OBJECTIVE_HOLD = 5; // seconds the objective banner stays up before fading

const CONTROLS = [
  ['WASD', 'Move'],
  ['Shift', 'Run'],
  ['Space', 'Jump'],
  ['B', 'Bark'],
  ['Q', 'Sniff'],
  ['F', 'Interact'],
  ['X', 'Dig'],
  ['Esc', 'Pause'],
];

// A bone: a bar across the diagonal with a pair of knuckles at each end.
const BONE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
  <g transform="rotate(-45 12 12)">
    <rect x="6" y="10.2" width="12" height="3.6" rx="1.8"/>
    <circle cx="6" cy="9.8" r="3"/><circle cx="6" cy="14.2" r="3"/>
    <circle cx="18" cy="9.8" r="3"/><circle cx="18" cy="14.2" r="3"/>
  </g>
</svg>`;

const legendHtml = () =>
  CONTROLS.map(([key, label]) => `<div><kbd>${key}</kbd><span>${label}</span></div>`).join('');

const TEMPLATE = `
  <div class="hud-objective"></div>
  <div class="hud-bones">${BONE_ICON}<span>0/5</span></div>
  <div class="hud-prompt"></div>
  <div class="hud-dialogue"><span class="speaker"></span><span class="line"></span></div>
  <div class="hud-memory"></div>
  <div class="blackout"></div>

  <div class="screen screen-start">
    <h1 class="title">Good<em>Boi</em></h1>
    <p class="tagline">A stray dog, a neon district after the rain, and a long way home.</p>
    <p class="cta">Click to play</p>
    <div class="legend">${legendHtml()}</div>
  </div>

  <div class="screen screen-pause hidden">
    <h2>Paused</h2>
    <div class="legend">${legendHtml()}</div>
    <button class="btn" data-act="resume">Resume</button>
    <button class="btn ghost" data-act="restart">Restart</button>
  </div>

  <div class="screen screen-end hidden">
    <h2>GoodBoi found home.</h2>
    <div class="stats">
      <div><strong data-stat="bones">0/5</strong>Bones</div>
      <div><strong data-stat="side">0/2</strong>Favours</div>
      <div><strong data-stat="time">0:00</strong>Time</div>
    </div>
    <button class="btn" data-act="restart">Play again</button>
    <p class="credits">Made with Three.js &amp; Claude</p>
  </div>
`;

export function createUI({ events, dom, onStart, onResume, onPause } = {}) {
  const root = document.createElement('div');
  root.id = 'ui';
  root.innerHTML = TEMPLATE;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const el = {
    objective: $('.hud-objective'),
    bones: $('.hud-bones'),
    boneCount: $('.hud-bones span'),
    prompt: $('.hud-prompt'),
    dialogue: $('.hud-dialogue'),
    speaker: $('.hud-dialogue .speaker'),
    line: $('.hud-dialogue .line'),
    memory: $('.hud-memory'),
    blackout: $('.blackout'),
    start: $('.screen-start'),
    pause: $('.screen-pause'),
    end: $('.screen-end'),
  };

  // 'start' | 'playing' | 'paused' | 'ended'
  let state = 'start';
  let objectiveTimer = 0;
  let dialogueTimer = 0;
  let boneTimer = 0;

  const show = (node, on) => node.classList.toggle('show', on);

  // --- state transitions ----------------------------------------------------

  function lock() {
    // Chrome refuses a re-lock too soon after an exit (and newer versions
    // reject a promise rather than throwing). Either way it's not fatal — the
    // canvas click handler in Input is the fallback.
    try {
      dom?.requestPointerLock?.()?.catch?.(() => {});
    } catch { /* ignore */ }
  }

  function start() {
    if (state !== 'start') return;
    state = 'playing';
    el.start.classList.add('fading');
    setTimeout(() => el.start.classList.add('hidden'), 600);
    lock();
    onStart?.();
  }

  function pause() {
    if (state !== 'playing') return;
    state = 'paused';
    el.pause.classList.remove('hidden');
    onPause?.();
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'playing';
    el.pause.classList.add('hidden');
    lock();
    onResume?.();
  }

  // --- input on the screens themselves --------------------------------------

  const onScreenClick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'restart') location.reload();
    else if (act === 'resume') resume();
    else if (state === 'start') start();
  };
  el.start.addEventListener('click', onScreenClick);
  el.pause.addEventListener('click', onScreenClick);
  el.end.addEventListener('click', onScreenClick);

  const onKey = (e) => {
    if (e.code === 'Escape') {
      // While the pointer is locked the browser eats Escape to release it, and
      // the lock-change handler below pauses us. This is the un-locked case.
      if (state === 'paused') resume();
      else pause();
    } else if (state === 'start' && e.code === 'Space') {
      start();
    }
  };
  window.addEventListener('keydown', onKey);

  // Losing the pointer (Esc, alt-tab, clicking away) always means "pause".
  const onLockChange = () => {
    if (state === 'playing' && document.pointerLockElement !== dom) pause();
  };
  document.addEventListener('pointerlockchange', onLockChange);

  // --- event bus ------------------------------------------------------------

  events.on('objective:changed', ({ text }) => {
    if (!text) return;
    el.objective.textContent = text;
    show(el.objective, true);
    objectiveTimer = OBJECTIVE_HOLD;
  });

  events.on('bone:collected', ({ count, total }) => {
    el.boneCount.textContent = `${count}/${total}`;
    el.bones.classList.add('pop');
    boneTimer = 0.35;
  });

  events.on('prompt:show', ({ text }) => {
    // "F — Pick up" reads better with the key picked out. Built as nodes rather
    // than markup so prompt text is never parsed as HTML.
    const [, key, rest] = /^([A-Z])\b(.*)$/s.exec(String(text)) ?? [null, null, null];
    el.prompt.replaceChildren();
    if (key) {
      const b = document.createElement('b');
      b.textContent = key;
      el.prompt.append(b, document.createTextNode(rest));
    } else {
      el.prompt.textContent = text;
    }
    show(el.prompt, true);
  });
  events.on('prompt:hide', () => show(el.prompt, false));

  events.on('dialogue:show', ({ speaker, text, duration = 4 }) => {
    el.speaker.textContent = speaker ?? '';
    el.line.textContent = text ?? '';
    show(el.dialogue, true);
    dialogueTimer = duration;
  });
  events.on('dialogue:hide', () => { dialogueTimer = 0; show(el.dialogue, false); });

  events.on('memory:show', ({ text }) => {
    el.memory.textContent = text;
    show(el.memory, true);
  });
  events.on('memory:hide', () => show(el.memory, false));

  events.on('game:ended', ({ bones, boneTotal, sideQuests, sideQuestTotal, seconds }) => {
    state = 'ended';
    show(el.prompt, false);
    show(el.objective, false);
    show(el.dialogue, false);
    el.blackout.classList.add('on');

    el.end.querySelector('[data-stat="bones"]').textContent = `${bones}/${boneTotal}`;
    el.end.querySelector('[data-stat="side"]').textContent = `${sideQuests}/${sideQuestTotal}`;
    const m = Math.floor(seconds / 60);
    el.end.querySelector('[data-stat="time"]').textContent =
      `${m}:${String(seconds - m * 60).padStart(2, '0')}`;

    // Let the fade to black land before the credits come up over it.
    setTimeout(() => {
      el.end.classList.add('fading');
      el.end.classList.remove('hidden');
      requestAnimationFrame(() => el.end.classList.remove('fading'));
    }, 2200);
  });

  // --- ticking timers -------------------------------------------------------

  function update(dt) {
    if (objectiveTimer > 0 && (objectiveTimer -= dt) <= 0) show(el.objective, false);
    if (dialogueTimer > 0 && (dialogueTimer -= dt) <= 0) show(el.dialogue, false);
    if (boneTimer > 0 && (boneTimer -= dt) <= 0) el.bones.classList.remove('pop');
  }

  return {
    update,
    start,
    pause,
    resume,
    get state() { return state; },
    /** True only while the simulation should be stepping. */
    get playing() { return state === 'playing' || state === 'ended'; },
    dispose() {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerlockchange', onLockChange);
      root.remove();
    },
  };
}
