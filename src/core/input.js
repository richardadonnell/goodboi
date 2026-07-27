/**
 * Keyboard + pointer-lock mouse input.
 *
 * const input = new Input(renderer.domElement);
 * input.isDown('forward')     -> boolean, held this frame
 * input.wasPressed('bark')    -> boolean, went down since last consume()
 * input.mouseDelta            -> { x, y } accumulated since last consume()
 * input.consume()             -> call once per fixed update, AFTER reading
 */

// Action -> KeyboardEvent.code list. Mirrors DESIGN.md player verbs.
export const KEY_MAP = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  bark: ['KeyB'],
  sniff: ['KeyQ', 'KeyE'],
  interact: ['KeyF'],
  dig: ['KeyX'],
  pause: ['Escape'],
};

// code -> action, built once from KEY_MAP
const CODE_TO_ACTIONS = (() => {
  const map = new Map();
  for (const [action, codes] of Object.entries(KEY_MAP)) {
    for (const code of codes) {
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(action);
    }
  }
  return map;
})();

export class Input {
  constructor(domElement, { lookSensitivity = 0.0022 } = {}) {
    this.dom = domElement;
    this.lookSensitivity = lookSensitivity;

    this.down = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDelta = { x: 0, y: 0 };
    this.pointerLocked = false;

    this._onKeyDown = (e) => {
      const actions = CODE_TO_ACTIONS.get(e.code);
      if (!actions) return;
      if (e.code === 'Space') e.preventDefault(); // don't scroll the page
      if (!this.down.has(e.code)) {
        for (const a of actions) this.pressed.add(a);
      }
      this.down.add(e.code);
    };

    this._onKeyUp = (e) => {
      const actions = CODE_TO_ACTIONS.get(e.code);
      if (!actions) return;
      this.down.delete(e.code);
      for (const a of actions) {
        if (!this._anyCodeDown(a)) this.released.add(a);
      }
    };

    this._onBlur = () => {
      this.down.clear();
      this.mouseDelta.x = 0;
      this.mouseDelta.y = 0;
    };

    this._onMouseMove = (e) => {
      if (!this.pointerLocked) return;
      this.mouseDelta.x += e.movementX * this.lookSensitivity;
      this.mouseDelta.y += e.movementY * this.lookSensitivity;
    };

    this._onClick = () => {
      if (!this.pointerLocked) this.dom.requestPointerLock();
    };

    this._onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === this.dom;
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    this.dom.addEventListener('click', this._onClick);
  }

  isDown(action) {
    return this._anyCodeDown(action);
  }

  wasPressed(action) {
    return this.pressed.has(action);
  }

  wasReleased(action) {
    return this.released.has(action);
  }

  /** Clears per-step edge state and mouse delta. Call at the end of each fixed update. */
  consume() {
    this.pressed.clear();
    this.released.clear();
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    this.dom.removeEventListener('click', this._onClick);
  }

  _anyCodeDown(action) {
    const codes = KEY_MAP[action];
    if (!codes) return false;
    for (const code of codes) {
      if (this.down.has(code)) return true;
    }
    return false;
  }
}
