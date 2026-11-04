const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const tick = () => new Promise(resolve => setImmediate(resolve));

async function harness(initialRoute = 'chat:a', initialStore = {}, initialScope = 'root', initialPrompts = []) {
  const store = structuredClone(initialStore); const tasks = new Map(); let serial = 0; let poll;
  class Adapter {
    constructor() { this.current = initialRoute; this.currentScope = initialScope; this.prompts = initialPrompts; this.pendingSubmit = false; this.started = false; this.reads = 0; this.messages = []; }
    route() { return this.current; }
    scope() { return this.currentScope; }
    fingerprint(text) { return context.DGP.realAdapter.prototype.fingerprint(text); }
    hasUserPrompt(hash) { return this.prompts.some(text => this.fingerprint(text) === hash); }
    read() { this.reads++; return {messages: this.messages, invalid: 0, streaming: false, assistantCount: this.messages.length}; }
    start(cb) { this.started = true; this.cb = cb; cb(this.read()); }
    stop() { this.started = false; this.cb = null; }
    insertDraft() { return this.draftResult || {ok: true}; }
    async sendAction(text, isCurrent) { this.sent = (this.sent || []).concat(text); return this.sendResult ? this.sendResult(text, isCurrent) : this.insertDraft(text); }
    findComposer() { return {}; }
  }
  class Player {
    constructor(actions) { this.actions = actions; this.input = {value: ''}; this.lastDialogue = ''; this.drawer = {}; this.draftHelp = {}; }
    setEnabled(value) { this.enabled = value; this.collapsed = false; }
    setSettings(value) { this.settings = value; }
    notice(value) { this.status = value; }
    reset() { this.input.value = ''; this.state = null; }
    render(state) { this.state = state; }
    setCollapsed(value) { this.collapsed = value; }
    showDraftHelp(text, reason) { this.help = {text, reason}; }
    setBusy(value) { this.busy = value; }
    setDiagnostics(value) { this.diagnostics = value; }
    setFormatIssue(value) { this.formatIssue = value; }
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
  for (const file of ['src/data/runtime-assets.js', 'src/game/dialogue/protocol.js', 'src/game/scene/timeline.js', 'src/adapters/chatgpt/adapter.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  context.DGP.realAdapter = context.DGP.ChatGPTAdapter;
  context.DGP.ChatGPTAdapter = Adapter; context.DGP.Player = Player;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/extension/content/main.js'), 'utf8'), context);
  await tick();
  return {...context.DGP.app, realAdapter: context.DGP.realAdapter, store, poll: () => poll(), flush: async () => {
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
test('missing composer keeps the scene and retains action in recovery UI', async () => {
  const h = await harness(); await h.toggle(true);
  h.adapter.draftResult = {ok: false, reason: 'Поле сообщения не найдено'};
  await h.player.actions.onDraft('Начни новую игру');
  assert.equal(h.player.collapsed, false);
  assert.equal(h.player.help.text, 'Начни новую игру');
  assert.equal(h.player.help.reason, 'Поле сообщения не найдено');
  assert.equal(h.player.enabled, true);
});
test('starting game survives full page navigation with matching prompt and project', async () => {
  const before = await harness('draft:/g/project', {}, 'project-a');
  await before.toggle(true);
  before.player.actions.onDraft('Начни новую игру'); await tick();
  assert.ok(!JSON.stringify(before.store).includes('Начни новую игру'));
  const after = await harness('chat:new', before.store, 'project-a', ['Начни новую игру']);
  assert.equal(after.player.enabled, true); assert.equal(after.store['dgp-start-handoff'], null);
});
test('handoff waits for lazy-loaded user message, including pasted fallback', async () => {
  const before = await harness('draft:/g/project', {}, 'project-a'); await before.toggle(true);
  before.adapter.draftResult = {ok: false, reason: 'No composer'};
  before.player.actions.onDraft('Начни новую игру'); await tick();
  const after = await harness('chat:new', before.store, 'project-a');
  assert.equal(after.player.enabled, false);
  after.adapter.prompts = ['Начни\nновую  игру']; await after.poll();
  assert.equal(after.player.enabled, true);
});
test('handoff never enables other projects, unrelated messages or explicit disabled chats', async () => {
  const before = await harness('draft:/g/project', {}, 'project-a'); await before.toggle(true);
  before.player.actions.onDraft('Начни новую игру'); await tick();
  const other = await harness('chat:other', before.store, 'project-b', ['Начни новую игру']);
  assert.equal(other.player.enabled, false);
  const unrelated = await harness('chat:other', before.store, 'project-a', ['Как дела?']);
  assert.equal(unrelated.player.enabled, false);
  const disabled = await harness('chat:other', {...before.store, 'dgp-session:chat:other': {enabled: false, manual: true}}, 'project-a', ['Начни новую игру']);
  assert.equal(disabled.player.enabled, false);
});
test('expired handoff does not auto-enable', async () => {
  const before = await harness('draft:/', {}, 'root'); await before.toggle(true);
  before.player.actions.onDraft('Start game'); await tick(); before.store['dgp-start-handoff'].expires = 0;
  const after = await harness('chat:new', before.store, 'root', ['Start game']); assert.equal(after.player.enabled, false);
});
test('project home and named conversation URL resolve to the same project scope', async () => {
  const h = await harness(); const prototype = h.realAdapter.prototype;
  const project = 'g-p-0123456789abcdef0123456789abcdef';
  const home = {win: {location: {pathname: `/g/${project}/project`}}};
  const chat = {win: {location: {pathname: `/g/${project}-dro-gui/c/6aeb6280-a0b8-83eb-8428-8bf9ec30bbcd`}}};
  assert.equal(prototype.scope.call(home), project);
  assert.equal(prototype.scope.call(chat), project);
  assert.equal(prototype.route.call(chat), 'chat:6aeb6280-a0b8-83eb-8428-8bf9ec30bbcd');
});

test('action sends once, stays in game and unlocks when the new reply arrives', async () => {
  const h = await harness();
  h.adapter.messages = [{id: 'old', events: [{type: 'say', text: 'Before'}]}];
  await h.toggle(true);
  let finish;
  h.adapter.sendResult = () => new Promise(resolve => { finish = resolve; });
  const first = h.player.actions.onDraft('Осмотреть комнату');
  await h.player.actions.onDraft('Осмотреть комнату');
  assert.equal(h.adapter.sent.length, 1); assert.equal(h.player.busy, true);
  assert.equal(h.player.collapsed, false);
  finish({ok: true}); await first;
  assert.equal(h.player.collapsed, false); assert.equal(h.player.input.value, '');
  assert.equal(h.player.busy, true);
  h.adapter.messages.push({id: 'new', events: [{type: 'say', text: 'After'}, {type: 'choices', items: [{label: 'Door', text: 'Open door'}]}]});
  h.adapter.cb(h.adapter.read());
  assert.equal(h.player.state.dialogue.text, 'After'); assert.equal(h.player.busy, false);
});

test('pending send cannot change the next conversation', async () => {
  const h = await harness(); await h.toggle(true);
  let finish;
  h.adapter.sendResult = (text, current) => new Promise(resolve => { finish = () => resolve(current() ? {ok: true} : {ok: false, cancelled: true}); });
  const task = h.player.actions.onDraft('Action');
  h.adapter.current = 'chat:b'; await h.poll();
  h.player.input.value = 'New conversation draft'; finish(); await task;
  assert.equal(h.player.enabled, false); assert.equal(h.player.input.value, 'New conversation draft');
});

test('turning the game off cancels a pending send even if enabled again immediately', async () => {
  const h = await harness(); await h.toggle(true);
  let finish;
  h.adapter.sendResult = (text, current) => new Promise(resolve => { finish = () => { assert.equal(current(), false); resolve({ok: false, cancelled: true}); }; });
  const task = h.player.actions.onDraft('Old action');
  await h.toggle(false); await h.toggle(true);
  h.player.input.value = 'New draft'; finish(); await task;
  assert.equal(h.player.input.value, 'New draft'); assert.equal(h.player.busy, false);
});

test('plain text reply after a game scene offers format recovery and unlocks input', async () => {
  const h = await harness();
  h.adapter.messages = [{id: 'old', events: [{type: 'say', text: 'Before'}]}]; await h.toggle(true);
  await h.player.actions.onDraft('Action');
  h.adapter.cb({...h.adapter.read(), assistantCount: 2, latestHasCommands: false});
  assert.equal(h.player.formatIssue, true); assert.equal(h.player.busy, false);
  assert.match(h.player.status, /не содержит игровых команд/);
});
