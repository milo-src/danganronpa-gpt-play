(() => {
  'use strict';
  const D = globalThis.DGP = globalThis.DGP || {};
  const text = (v, max = 2000) => typeof v === 'string' ? v.slice(0, max) : '';
  const id = v => text(v, 120);
  const modes = ['daily', 'investigation', 'trial'];
  const effects = ['none', 'shake', 'flash', 'objection'];
  function evidence(v) {
    if (!v || typeof v !== 'object' || !id(v.id) || !text(v.title, 100)) return null;
    return {id: id(v.id), title: text(v.title, 100), description: text(v.description, 1200)};
  }
  function normalize(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    switch (v.type) {
      case 'scene': {
        const out = {type: 'scene'};
        for (const k of ['background', 'location', 'chapter', 'objective']) {
          if (typeof v[k] === 'string') out[k] = text(v[k], k === 'objective' ? 500 : 120);
        }
        if (modes.includes(v.mode)) out.mode = v.mode;
        if (Array.isArray(v.cast)) out.cast = v.cast.slice(0, 3).filter(c => c && typeof c === 'object')
          .map(c => ({id: id(c.id), sprite: id(c.sprite) || 'default'})).filter(c => c.id);
        if (Array.isArray(v.evidence)) out.evidence = v.evidence.slice(0, 60).map(evidence).filter(Boolean);
        return out;
      }
      case 'say':
        if (!text(v.text)) return null;
        return {type: 'say', who: id(v.who), name: text(v.name, 100), sprite: id(v.sprite) || 'default',
          text: text(v.text), effect: effects.includes(v.effect) ? v.effect : 'none'};
      case 'choices': {
        if (!Array.isArray(v.items)) return null;
        const items = v.items.slice(0, 6).filter(i => i && typeof i === 'object')
          .map(i => ({label: text(i.label, 100), text: text(i.text, 1000)})).filter(i => i.label && i.text);
        return items.length ? {type: 'choices', items} : null;
      }
      case 'evidence': {
        if (v.remove === true && id(v.id)) return {type: 'evidence', remove: true, id: id(v.id)};
        const item = evidence(v);
        return item ? {type: 'evidence', ...item} : null;
      }
      default: return null;
    }
  }
  function parse(raw, {complete = false} = {}) {
    const events = [];
    let invalid = 0;
    // Frame JSON objects, not visual lines: rich code blocks may join lines or
    // pretty-print an object. Quoted braces and escaped quotes are data.
    const source = String(raw || '').slice(0, 300000);
    const marker = /(?:^|\n)[\t ]*DGP\|/g;
    let position = 0, adjacent = false;
    while (position < source.length && events.length < 160) {
      marker.lastIndex = position;
      const joined = adjacent ? source.slice(position).match(/^\s*DGP\|/) : null;
      const match = joined || marker.exec(source);
      if (!match) break;
      const start = joined ? position + joined[0].length : marker.lastIndex;
      let end = start, depth = 0, quoted = false, escaped = false, opened = false;
      for (; end < source.length; end++) {
        const char = source[end];
        // A physical newline inside a JSON string is invalid; recover the next
        // explicit command rather than losing the rest of the response.
        if (/^\n[\t ]*DGP\|/.test(source.slice(end, end + 80))) break;
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === '\\') escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') quoted = true;
        if (char === '{' || char === '[') { depth++; opened = true; }
        if (char === '}' || char === ']') { depth--; if (opened && depth === 0) { end++; break; } }
      }
      try {
        const event = normalize(JSON.parse(source.slice(start, end)));
        if (event) events.push(event); else invalid++;
      } catch {
        if (complete || end < source.length || source.endsWith('\n')) invalid++;
      }
      position = end; adjacent = opened && depth === 0;
    }
    return {events, invalid};
  }
  D.protocol = {parse, normalize};
})();
