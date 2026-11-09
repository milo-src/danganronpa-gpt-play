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
    insertDraft(text) { this.prepared = text; return this.draftResult || {ok: true}; }
    async sendAction(text, current) { this.sent = (this.sent || []).concat(text); return this.sendResult ? this.sendResult(text, current) : this.insertDraft(text); }
    composerLayout() { return {gap: 180, available: true}; }
    focusComposer() { this.focused = true; }
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
    preserveDraft(text) { this.savedDrafts = [...(this.savedDrafts || []), text]; }
    setComposerLayout(value) { this.layout = value; }
    setRetry(value) { this.retry = value; }
    setBusy(value) { this.busy = value; }
    setDiagnostics(value) { this.diagnostics = value; }
    setFormatIssue(value) { this.formatIssue = value; }
    setNotes(value) { this.notes = typeof value === 'string' ? value : ''; }
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
test('personal notes are loaded and written only for the active chat', async () => {
  const h = await harness('chat:a', {'dgp-notes:chat:a':'Первая версия','dgp-notes:chat:b':'Другая история'});
  assert.equal(h.player.notes,'Первая версия');
  await h.player.actions.onNotes('Исправленная версия');
  assert.equal(h.store['dgp-notes:chat:a'],'Исправленная версия');
  h.adapter.current='chat:b'; h.poll(); await tick(); await tick();
  assert.equal(h.player.notes,'Другая история');
  await h.player.actions.onNotes('Вторая заметка');
  assert.equal(h.store['dgp-notes:chat:a'],'Исправленная версия');
  assert.equal(h.store['dgp-notes:chat:b'],'Вторая заметка');
});

test('save continuation passes through transport intact and excessive input is rejected', async () => {
  const h = await harness(); await h.toggle(true);
  const text = 'Продолжить: ' + 'данные'.repeat(1000);
  await h.player.actions.onDraft(text);
  assert.equal(h.adapter.sent[0], text);
  const h2 = await harness(); await h2.toggle(true);
  await h2.player.actions.onDraft('x'.repeat(60001));
  assert.equal(h2.adapter.sent, undefined);
});

test('sound stays opt-in, changes mode without overlapping timers, and stops on hide/dispose', async () => {
  const timers = new Map(); let serial=0;
  const param = () => ({value:0,setTargetAtTime(v){this.value=v},setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  class Audio {
    constructor(){this.state='suspended';this.currentTime=1;this.destination={};}
    createGain(){return {gain:param(),connect(){},disconnect(){}};}
    createOscillator(){return {frequency:param(),connect(){},disconnect(){},start(){},stop(){this.onended?.()}};}
    async resume(){this.state='running';}
    async close(){this.state='closed';}
  }
  const ctx=vm.createContext({DGP:{},AudioContext:Audio,setTimeout:cb=>{const id=++serial;timers.set(id,cb);return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/game/audio.js'),'utf8'),ctx);
  const sound=new ctx.DGP.Sound(); sound.configure({sound:false},true,'daily');
  assert.equal(sound.context,undefined); assert.equal(await sound.unlock(),true); assert.equal(timers.size,0);
  sound.configure({sound:true},true,'daily'); assert.equal(timers.size,1);
  sound.configure({},true,'daily'); assert.equal(timers.size,1);
  sound.configure({},true,'trial'); assert.equal(sound.mode,'trial'); assert.equal(timers.size,1);
  sound.configure({},false); assert.equal(timers.size,0); assert.equal(sound.music.gain.value,0);
  sound.configure({},true,'investigation'); assert.equal(timers.size,1);
  sound.dispose(); assert.equal(timers.size,0); assert.equal(sound.context.state,'closed');
  assert.equal(await sound.unlock(),false); assert.equal(timers.size,0);
});

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
  assert.equal(h.player.input.value, 'Начни новую игру');
  assert.equal(h.player.status, 'Поле сообщения не найдено');
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

test('choice sends native action and new reply advances scene', async () => {
  const h = await harness();
  h.adapter.messages = [{id: 'old', events: [{type: 'say', text: 'Before'}]}];
  await h.toggle(true);
  await h.player.actions.onDraft('Осмотреть комнату');
  assert.equal(h.adapter.prepared, 'Осмотреть комнату');
  assert.equal(h.player.busy, true); assert.equal(h.player.collapsed, false);
  assert.equal(h.adapter.sent.length, 1); assert.match(h.player.status, /Ход отправлен/);
  h.adapter.messages.push({id: 'new', events: [{type: 'say', text: 'After'}]});
  h.adapter.cb(h.adapter.read());
  assert.equal(h.player.state.dialogue.text, 'After');
});

test('native composer remains available beside one-click choices', async () => {
  const h = await harness(); await h.toggle(true);
  h.player.actions.onFocusComposer();
  assert.equal(h.adapter.focused, true); assert.equal(h.player.layout.gap, 180);
  assert.equal(typeof h.realAdapter.prototype.sendAction, 'function');
});

test('streaming does not replace native draft with a choice', async () => {
  const h = await harness(); await h.toggle(true);
  h.adapter.cb({...h.adapter.read(), streaming: true});
  await h.player.actions.onDraft('Action');
  assert.equal(h.adapter.prepared, undefined); assert.equal(h.player.busy, true);
});

test('plain text reply after a game scene offers format recovery and unlocks input', async () => {
  const h = await harness();
  h.adapter.messages = [{id: 'old', events: [{type: 'say', text: 'Before'}]}]; await h.toggle(true);
  await h.player.actions.onDraft('Action');
  h.adapter.cb({...h.adapter.read(), assistantCount: 2, latestHasCommands: false});
  assert.equal(h.player.formatIssue, true); assert.equal(h.player.busy, false);
  assert.match(h.player.status, /не содержит игровых команд/);
});

test('new assistant response reopens a collapsed game even when its format is broken', async () => {
  const h = await harness(); await h.toggle(true);
  h.player.setCollapsed(true);
  h.adapter.cb({messages: [], assistantCount: 1, latestHasCommands: false, latestInvalid: 1, invalid: 1, streaming: false});
  assert.equal(h.player.collapsed, false); assert.equal(h.player.formatIssue, true);
});


test('double clicks cannot send a duplicate action while transport is pending', async () => {
  const h = await harness(); await h.toggle(true);
  let finish; h.adapter.sendResult = () => new Promise(resolve => { finish = resolve; });
  const task = h.player.actions.onDraft('Go'); await h.player.actions.onDraft('Go');
  assert.equal(h.adapter.sent.length, 1); assert.equal(h.player.busy, true);
  finish({ok: true}); await task;
  await h.player.actions.onDraft('Go'); assert.equal(h.adapter.sent.length, 1);
  h.adapter.cb({...h.adapter.read(), assistantCount: 1, streaming: false});
  assert.equal(h.player.busy, false);
});

test('turning off cancels pending transport even after re-enabling', async () => {
  const h = await harness(); await h.toggle(true);
  let finish; h.adapter.sendResult = (text, current) => new Promise(resolve => { finish = () => { assert.equal(current(), false); resolve({cancelled: true}); }; });
  const task = h.player.actions.onDraft('Go'); await h.toggle(false); await h.toggle(true);
  h.player.input.value = 'New draft'; finish(); await task;
  assert.equal(h.player.input.value, 'New draft'); assert.equal(h.player.busy, false);
});

test('navigation cancels pending action without changing another chat', async () => {
  const h = await harness(); await h.toggle(true);
  let finish; h.adapter.sendResult = (text, current) => new Promise(resolve => { finish = () => { assert.equal(current(), false); resolve({cancelled: true}); }; });
  const task = h.player.actions.onDraft('Go'); h.adapter.current = 'chat:b'; await h.poll();
  h.player.input.value = 'New draft'; finish(); await task;
  assert.equal(h.player.enabled, false); assert.equal(h.player.input.value, 'New draft');
});


test('already rendered answer wins over late transport timeout', async () => {
  const h = await harness(); await h.toggle(true);
  let finish; h.adapter.sendResult = () => new Promise(resolve => { finish = resolve; });
  const task = h.player.actions.onDraft('My action');
  h.adapter.messages = [{id: 'reply', events: [{type: 'say', text: 'The answer'}]}];
  h.adapter.cb(h.adapter.read());
  finish({ok: false, clicked: true, reason: 'Unconfirmed'}); await task;
  assert.equal(h.player.state.dialogue.text, 'The answer');
  assert.ok(!h.player.status.includes('Unconfirmed')); assert.equal(h.player.busy, false);
  assert.equal(h.player.input.value, '');
});

test('typing the next action while sending does not lose it on confirmation', async () => {
  const h = await harness(); await h.toggle(true);
  let finish; h.adapter.sendResult = () => new Promise(resolve => { finish = resolve; });
  const task = h.player.actions.onDraft('First'); h.player.input.value = 'Next draft';
  finish({ok: true}); await task;
  assert.equal(h.player.input.value, 'Next draft');
});


test('recycled assistant node unlocks waiting even when message count stays constant', async () => {
  const h = await harness(); h.adapter.messages = [{id: 'same-node', events: [{type: 'say', text: 'Before'}]}];
  await h.toggle(true); await h.player.actions.onDraft('First'); assert.equal(h.player.busy, true);
  h.adapter.messages = [{id: 'same-node', events: [{type: 'say', text: 'After'}]}];
  h.adapter.cb(h.adapter.read()); assert.equal(h.player.busy, false);
  await h.player.actions.onDraft('Second'); assert.equal(h.adapter.sent.length, 2);
});
