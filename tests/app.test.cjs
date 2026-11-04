const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness(initialRoute = 'chat:a', initialStore = {}) {
  const store = structuredClone(initialStore); const tasks = new Map(); let serial = 0; let poll;
  class Adapter {
    constructor() { this.current = initialRoute; this.pendingSubmit = false; this.started = false; this.reads = 0; this.messages = []; }
    route() { return this.current; }
    read() { this.reads++; return {messages: this.messages, invalid: 0, streaming: false, assistantCount: this.messages.length}; }
    start(cb) { this.started = true; this.cb = cb; cb(this.read()); }
    stop() { this.started = false; this.cb = null; }
    insertDraft() { return this.draftResult || {ok: true}; }
  }
  class Player {
    constructor(actions) { this.actions = actions; this.input = {value: ''}; this.lastDialogue = ''; }
    setEnabled(value) { this.enabled = value; this.collapsed = false; }
    setSettings(value) { this.settings = value; }
    notice(value) { this.status = value; }
    reset() { this.input.value = ''; this.state = null; }
    render(state) { this.state = state; }
    setCollapsed(value) { this.collapsed = value; }
    showDraftHelp(text, reason) { this.help = {text, reason}; this.collapsed = true; }
  }
  const context = vm.createContext({
    setTimeout: callback => { const id = ++serial; tasks.set(id, callback); return id; },
    clearTimeout: id => tasks.delete(id), setInterval: callback => { poll = callback; },
    matchMedia: () => ({matches: false}),
    browser: {runtime: {getURL: p => 'extension://' + p, onMessage: {addListener() {}}}, storage: {local: {
      async get(key) { return {[key]: store[key]}; },
      async set(values) { Object.assign(store, values); }
    }}}
  });
  for (const file of ['src/data/runtime-assets.js', 'src/game/dialogue/protocol.js', 'src/game/scene/timeline.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  context.DGP.ChatGPTAdapter = Adapter; context.DGP.Player = Player;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/extension/content/main.js'), 'utf8'), context);
  await tick();
  return {...context.DGP.app, store, poll: () => poll(), flush: async () => {
    const current = [...tasks.values()]; tasks.clear(); current.forEach(cb => cb()); await tick();
  }};
}
test('new chats default off; toggling disconnects message observation', async () => {
  const h = await harness(); assert.equal(h.player.enabled, false); assert.equal(h.adapter.started, false);
  assert.equal(h.adapter.reads, 0); await h.toggle(true); assert.equal(h.adapter.started, true);
  await h.toggle(false); assert.equal(h.adapter.started, false); await h.flush();
  assert.equal(h.store['dgp-session:chat:a'].enabled, false);
});
test('SPA navigation isolates enable state and clears previous scene and draft', async () => {
  const h = await harness('chat:a', {'dgp-session:chat:a': {enabled: true}});
  assert.equal(h.player.enabled, true); h.player.input.value = 'private draft';
  h.adapter.current = 'chat:b'; await h.poll(); await h.flush();
  assert.equal(h.player.enabled, false); assert.equal(h.adapter.started, false); assert.equal(h.player.input.value, '');
  assert.equal(h.store['dgp-session:chat:a'].enabled, true); assert.equal(h.store['dgp-session:chat:b'].enabled, false);
  h.adapter.current = 'chat:a'; await h.poll(); assert.equal(h.player.enabled, true);
});
test('first sent message transfers enabled draft mode to created conversation only', async () => {
  const h = await harness('draft:/g/project'); await h.toggle(true);
  h.adapter.pendingSubmit = true; h.adapter.current = 'chat:new'; await h.poll(); await h.flush();
  assert.equal(h.player.enabled, true); assert.equal(h.store['dgp-session:chat:new'].enabled, true);
  assert.equal(h.store['dgp-session:draft:/g/project'].enabled, false);
});
test('opening unrelated conversation from a draft does not transfer enabled mode', async () => {
  const h = await harness('draft:/'); await h.toggle(true);
  h.adapter.current = 'chat:other'; await h.poll(); assert.equal(h.player.enabled, false);
});
test('stored reading position contains no conversation text', async () => {
  const h = await harness(); h.adapter.messages = [{id: 'response', events: [{type: 'say', who: '', text: 'SECRET DIALOGUE'}]}];
  await h.toggle(true); await h.flush();
  const serialized = JSON.stringify(h.store);
  assert.ok(!serialized.includes('SECRET')); assert.ok(h.store['dgp-session:chat:a'].cursor.startsWith('response:'));
});
test('missing composer collapses the scene and retains action in recovery UI', async () => {
  const h = await harness(); await h.toggle(true);
  h.adapter.draftResult = {ok: false, reason: 'Поле сообщения не найдено'};
  h.player.actions.onDraft('Начни новую игру');
  assert.equal(h.player.collapsed, true);
  assert.equal(h.player.help.text, 'Начни новую игру');
  assert.equal(h.player.help.reason, 'Поле сообщения не найдено');
  assert.equal(h.player.enabled, true);
});
