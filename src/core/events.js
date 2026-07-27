/**
 * Tiny synchronous pub/sub. The seam between game logic (Phase 3) and the
 * HUD (Phase 4) — nothing in src/quests or src/npc touches the DOM.
 *
 *   events.on('objective:changed', ({ text }) => ...)   -> returns an unsubscribe fn
 *   events.emit('bone:collected', { count: 2, total: 5 })
 *
 * Channels currently in use:
 *   'objective:changed'  { id, text, position|null }
 *   'bone:collected'     { count, total, position }
 *   'prompt:show'        { text }        'prompt:hide'  {}
 *   'dialogue:show'      { speaker, text, duration }   'dialogue:hide' {}
 *   'quest:beat'         { beat, id, title }
 *   'sidequest:done'     { id, title, done, total }
 *   'verb:bark'          { position, radius }
 *   'verb:dig'           { position }
 *   'item:carried'       { kind, label }   'item:dropped' { kind, label }
 *   'memory:show'        { text }          'memory:hide'  {}
 *   'game:ended'         { bones, boneTotal, sideQuests, sideQuestTotal, seconds }
 */
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    let list = this.handlers.get(name);
    if (!list) this.handlers.set(name, (list = []));
    list.push(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(name, fn) {
    const list = this.handlers.get(name);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  emit(name, payload) {
    const list = this.handlers.get(name);
    if (!list || !list.length) return;
    // Copy: handlers are allowed to unsubscribe themselves mid-emit.
    for (const fn of list.slice()) fn(payload);
  }

  clear() {
    this.handlers.clear();
  }
}

/** Shared bus. One game, one session, no reason to pass it around by hand. */
export const events = new EventBus();
