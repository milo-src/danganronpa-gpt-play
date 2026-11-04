(() => {
  'use strict';
  const D = globalThis.DGP;
  const hash = text => {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
    return (value >>> 0).toString(16);
  };
  const empty = () => ({background: '', location: 'Начало истории', chapter: 'DANGANRONPA', mode: 'daily',
    objective: '', cast: [], evidence: [], dialogue: null, choices: []});
  function apply(state, event) {
    if (event.type === 'scene') {
      for (const key of ['background', 'location', 'chapter', 'mode', 'objective', 'cast', 'evidence']) {
        if (!(key in event)) continue;
        if (key === 'background' && event[key] && !Object.hasOwn(D.assets.backgrounds, event[key])) continue;
        state[key] = event[key];
      }
      state.choices = [];
    } else if (event.type === 'say') {
      state.dialogue = event; state.choices = [];
      if (event.who && Object.hasOwn(D.assets.characters, event.who)) {
        const found = state.cast.some(c => c.id === event.who);
        state.cast = found ? state.cast.map(c => c.id === event.who ? {...c, sprite: event.sprite} : c)
          : [{id: event.who, sprite: event.sprite}];
      }
    } else if (event.type === 'choices') state.choices = event.items;
    else if (event.type === 'evidence') {
      state.evidence = state.evidence.filter(e => e.id !== event.id);
      if (!event.remove) state.evidence = [...state.evidence, {id: event.id, title: event.title, description: event.description}].slice(-60);
    }
    return state;
  }
  class Timeline {
    constructor() { this.entries = []; this.cursor = -1; this.awaiting = false; }
    update(messages, resume) {
      const old = this.entries;
      const entries = messages.flatMap(m => m.events.map((event, index) =>
        ({event, message: m.id, key: `${m.id}:${index}:${hash(JSON.stringify(event))}`})));
      const changed = old.length !== entries.length || old.some((e, i) => e.key !== entries[i]?.key);
      if (!changed) return false;
      this.entries = entries;
      const samePrefix = old.slice(0, this.cursor + 1).every((e, i) => e.key === entries[i]?.key);
      if (old.length && samePrefix) {
        if (this.awaiting) { this.awaiting = false; this.next(); }
        else this.consumeFollowing();
      } else {
        let saved = resume ? entries.findIndex(e => e.key === resume) : -1;
        if (saved >= 0) this.cursor = saved;
        else {
          const lastMessage = entries.at(-1)?.message;
          const start = entries.findIndex(e => e.message === lastMessage);
          this.cursor = start - 1;
          this.next();
        }
      }
      return true;
    }
    consumeFollowing() {
      // Keep scene/evidence changes after a dialogue behind the Next button.
      while (this.cursor + 1 < this.entries.length && this.entries[this.cursor + 1].event.type === 'choices') this.cursor++;
    }
    next() {
      if (this.cursor >= this.entries.length - 1) { this.awaiting = true; return false; }
      this.awaiting = false;
      while (++this.cursor < this.entries.length - 1) {
        if (['say', 'choices'].includes(this.entries[this.cursor].event.type)) break;
      }
      this.consumeFollowing();
      if (!['say', 'choices'].includes(this.entries[this.cursor]?.event.type)) this.awaiting = true;
      return true;
    }
    back() {
      const dialoguePositions = this.entries.map((e, i) => e.event.type === 'say' ? i : -1).filter(i => i >= 0 && i <= this.cursor);
      if (dialoguePositions.length < 2) return false;
      this.cursor = dialoguePositions.at(-2); this.awaiting = false; this.consumeFollowing(); return true;
    }
    replay() {
      const last = this.entries.at(-1)?.message;
      this.cursor = this.entries.findIndex(e => e.message === last) - 1;
      this.awaiting = false; return this.next();
    }
    state() {
      const state = empty();
      for (let i = 0; i <= this.cursor; i++) apply(state, this.entries[i].event);
      return state;
    }
    get key() { return this.entries[this.cursor]?.key || ''; }
    get pending() { return this.entries.slice(this.cursor + 1).filter(e => e.event.type === 'say').length; }
  }
  D.Timeline = Timeline;
})();
