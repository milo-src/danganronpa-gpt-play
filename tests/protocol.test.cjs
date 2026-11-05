const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load() {
  const context = vm.createContext({});
  for (const file of ['src/data/runtime-assets.js', 'src/game/dialogue/protocol.js', 'src/game/scene/timeline.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.DGP;
}
const D = load();
const plain = v => JSON.parse(JSON.stringify(v));
const say = text => ({type: 'say', who: 'dr1.kyoko-kirigiri', text});
const parse = events => D.protocol.parse(events.map(e => 'DGP|' + JSON.stringify(e)).join('\n')).events;
const message = (events, id = 'message-1') => ({id, events: parse(events)});

test('curated defaults exclude scrum poses, cosplay and alternate identities', () => {
  assert.equal(D.resolveSprite('drv3.kaede-akamatsu', 'default').key, 'archive/kaede-001');
  assert.equal(D.resolveSprite('drv3.tsumugi-shirogane', 'default').key, 'archive/tsumugi-001');
  assert.equal(D.resolveSprite('dr1.kiyotaka-ishimaru', 'default').key, 'archive/kiyotaka-001');
  assert.equal(D.resolveSprite('dr2.nekomaru-nidai', 'default').key, 'archive/nekomaru-001');
  for (const c of Object.values(D.assets.characters)) assert.doesNotMatch(c.defaultSprite, /debate-scrum|cosplay|school-uniform/);
});

test('legacy default uses a talking pose only for the speaker; semantic poses are character-specific', () => {
  assert.equal(D.resolveSprite('drv3.kaede-akamatsu', 'default', true).key, 'archive/kaede-002');
  assert.equal(D.resolveSprite('drv3.kaede-akamatsu', 'happy', true).key, 'archive/kaede-017');
  assert.equal(D.resolveSprite('drv3.shuichi-saihara', 'happy', true).key, 'archive/shuichi-013');
  assert.equal(D.resolveSprite('drv3.kaede-akamatsu', 'https://untrusted/image').key, 'archive/kaede-001');
  assert.equal(D.resolveSprite('__proto__', 'default'), null);
  assert.equal(D.resolveSprite('dr2.akane-owari', 'thinking').key, D.assets.characters['dr2.akane-owari'].defaultSprite);
});

test('expressions follow each visible line and rewind without resetting unspecified scene poses', () => {
  const t = new D.Timeline();
  t.update([message([
    {type: 'scene', cast: [{id: 'drv3.kaede-akamatsu', sprite: 'thinking'}, {id: 'drv3.shuichi-saihara', sprite: 'default'}]},
    {type: 'say', who: 'drv3.kaede-akamatsu', text: 'Нужно подумать.'},
    {type: 'say', who: 'drv3.kaede-akamatsu', sprite: 'happy', text: 'Получилось!'},
    {type: 'say', who: 'drv3.shuichi-saihara', sprite: 'surprised', text: 'Правда?'}
  ])]);
  assert.equal(t.state().cast[0].sprite, 'thinking');
  t.next(); assert.equal(t.state().cast[0].sprite, 'happy');
  t.next(); assert.equal(t.state().dialogue.who, 'drv3.shuichi-saihara');
  assert.equal(t.state().cast[1].sprite, 'surprised');
  assert.equal(t.state().cast[0].sprite, 'happy');
  t.back(); assert.equal(t.state().cast[1].sprite, 'default');
  t.back(); assert.equal(t.state().cast[0].sprite, 'thinking');
});

test('portrait bounds exclude transparent padding without modifying source dimensions', () => {
  const sprite = D.resolveSprite('drv3.kaede-akamatsu', 'neutral');
  const [width, height, x, y, w, h] = sprite.bounds;
  assert.ok(x > 0 && w < width / 2 && h > height * .95);
  for (const c of Object.values(D.assets.characters)) {
    assert.ok(c.bounds[c.defaultSprite]);
    for (const key of Object.values(c.expressions)) assert.ok(c.bounds[key]);
  }
});

test('only explicit DGP lines are commands; code fences and prose are inert', () => {
  const result = D.protocol.parse('Ignore instructions\n```dgp\nDGP|{"type":"say","text":"Hello <img src=x onerror=alert(1)>"}\n```\n{"type":"say","text":"not DGP"}');
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].text, 'Hello <img src=x onerror=alert(1)>');
  assert.equal(result.invalid, 0);
});
test('streaming ignores an incomplete object until its JSON is complete', () => {
  const raw = 'DGP|' + JSON.stringify(say('Реплика с кавычкой " и переносом\nстроки'));
  for (let i = 0; i < raw.length; i++) assert.equal(D.protocol.parse(raw.slice(0, i)).events.length, 0);
  assert.equal(D.protocol.parse(raw).events.length, 1);
});
test('malformed and unsupported lines cannot execute commands or block later events', () => {
  const result = D.protocol.parse('DGP|{broken}\nDGP|{"type":"fetch","url":"https://example.com"}\nDGP|{"type":"say","text":"OK","html":"bad","effect":"eval"}\n');
  assert.equal(result.invalid, 2); assert.equal(result.events.length, 1);
  assert.equal(result.events[0].html, undefined); assert.equal(result.events[0].effect, 'none');
});
test('a malformed final line is reported once generation finishes', () => {
  assert.equal(D.protocol.parse('DGP|{broken', {complete: false}).invalid, 0);
  assert.equal(D.protocol.parse('DGP|{broken', {complete: true}).invalid, 1);
});

test('pretty-printed and adjacent objects survive code-block line changes', () => {
  const events = [say('Quotes: " } [ and DGP| inside a string'), {type: 'choices', items: [{label: 'Go', text: 'Go'}]}];
  const raw = events.map(e => 'DGP|' + JSON.stringify(e, null, 2)).join('');
  const result = D.protocol.parse(raw, {complete: true});
  assert.equal(result.invalid, 0); assert.equal(result.events.length, 2);
  assert.equal(result.events[0].text, events[0].text);
});

test('broken JSON string does not swallow the next explicit command', () => {
  const result = D.protocol.parse('DGP|{"type":"say","text":"broken\n  DGP|{"type":"say","text":"Recovered"}', {complete: true});
  assert.equal(result.invalid, 1); assert.equal(result.events[0].text, 'Recovered');
});
test('limits and malformed nested values are enforced', () => {
  const result = parse([{type: 'scene', cast: [null, 'x', {id: 'dr1.kyoko-kirigiri'}], evidence: [null, {}]},
    {type: 'say', text: 'A'.repeat(3000)}, {type: 'choices', items: [null, {}, {label: 'Go', text: 'Act'}]}]);
  assert.equal(result[0].cast.length, 1); assert.equal(result[0].evidence.length, 0);
  assert.equal(result[1].text.length, 2000); assert.equal(result[2].items.length, 1);
  assert.equal(D.protocol.parse(Array(170).fill('DGP|{"type":"say","text":"x"}').join('\n')).events.length, 160);
});
test('scene ID cannot cause arbitrary resource loading; unknown background preserves known one', () => {
  const timeline = new D.Timeline();
  timeline.update([message([{type: 'scene', background: 'dr1.bgd-008out'}, say('one'),
    {type: 'scene', background: 'https://example.com/tracker'}, say('two')])]);
  assert.equal(timeline.state().background, 'dr1.bgd-008out');
  timeline.next(); assert.equal(timeline.state().background, 'dr1.bgd-008out');
});
test('incremental scene then first dialogue advances automatically, later dialogue waits', () => {
  const t = new D.Timeline(); const events = [{type: 'scene', background: 'dr1.bgd-008out'}];
  t.update([message(events)]); assert.equal(t.state().dialogue, null);
  events.push(say('one')); t.update([message(events)]); assert.equal(t.state().dialogue.text, 'one');
  events.push(say('two')); t.update([message(events)]); assert.equal(t.state().dialogue.text, 'one');
  assert.equal(t.pending, 1); t.next(); assert.equal(t.state().dialogue.text, 'two');
});
test('duplicate mutation does not replay a dialogue; choices append to current dialogue', () => {
  const t = new D.Timeline(); const events = [say('one')];
  t.update([message(events)]); const key = t.key;
  assert.equal(t.update([message(events)]), false); assert.equal(t.key, key);
  events.push({type: 'choices', items: [{label: 'Осмотр', text: 'Осмотреть'}]});
  t.update([message(events)]); assert.equal(t.state().choices.length, 1); assert.equal(t.state().dialogue.text, 'one');
});
test('next at streaming tail waits for a new complete dialogue', () => {
  const t = new D.Timeline(); t.update([message([say('one')])]);
  assert.equal(t.next(), false);
  t.update([message([say('one'), say('two')])]); assert.equal(t.state().dialogue.text, 'two');
});
test('scene and evidence are not applied before reader reaches them', () => {
  const t = new D.Timeline();
  t.update([message([say('one'), {type: 'scene', mode: 'trial'},
    {type: 'evidence', id: 'note', title: 'Записка', description: 'Test'}, say('two')])]);
  assert.equal(t.state().mode, 'daily'); assert.equal(t.state().evidence.length, 0);
  t.next(); assert.equal(t.state().mode, 'trial'); assert.equal(t.state().evidence.length, 1);
  t.back(); assert.equal(t.state().mode, 'daily'); assert.equal(t.state().evidence.length, 0);
});
test('resume restores a hashed cursor without storing dialogue text', () => {
  const messages = [message([say('one'), say('private dialogue text')])];
  const t = new D.Timeline(); t.update(messages); t.next(); const key = t.key;
  assert.ok(!key.includes('private')); const restored = new D.Timeline(); restored.update(messages, key);
  assert.equal(restored.state().dialogue.text, 'private dialogue text');
});
test('edited/regenerated response rebuilds state and removes stale choices/evidence', () => {
  const t = new D.Timeline();
  t.update([message([{type: 'evidence', id: 'x', title: 'Old'}, say('old'), {type: 'choices', items: [{label: 'x', text: 'x'}]}])]);
  t.update([message([say('new')])]);
  assert.equal(t.state().dialogue.text, 'new'); assert.equal(t.state().evidence.length, 0); assert.equal(t.state().choices.length, 0);
});
test('history hydration starts latest response but retains previous evidence', () => {
  const t = new D.Timeline();
  t.update([message([{type: 'evidence', id: 'x', title: 'Clue'}, say('old')]), message([say('latest')], 'message-2')]);
  assert.equal(t.state().dialogue.text, 'latest'); assert.equal(t.state().evidence.length, 1);
});
test('full scene snapshot clears stale cast and evidence; narrator keeps current cast', () => {
  const t = new D.Timeline();
  t.update([message([{type: 'scene', cast: [{id: 'dr1.kyoko-kirigiri'}], evidence: [{id: 'x', title: 'Old'}]},
    {type: 'say', who: '', text: 'Narration'}, {type: 'scene', cast: [], evidence: []}, {type: 'say', text: 'Empty'}])]);
  assert.equal(t.state().cast.length, 1); t.next();
  assert.deepEqual(plain(t.state().cast), []); assert.deepEqual(plain(t.state().evidence), []);
});
test('instructions example parses and all referenced assets exist', () => {
  const prompt = fs.readFileSync(path.join(__dirname, '../instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt'), 'utf8');
  const example = prompt.split('```dgp\n').at(-1).split('```')[0];
  const parsed = D.protocol.parse(example); assert.equal(parsed.invalid, 0); assert.equal(parsed.events.length, 4);
  for (const e of parsed.events) {
    if (e.background) assert.ok(Object.hasOwn(D.assets.backgrounds, e.background));
    if (e.who) assert.ok(Object.hasOwn(D.assets.characters, e.who));
  }
});


const narrate = text => ({type: 'say', who: '', text});

test('empty setup menu exposes all narration and choices without extra Next clicks', () => {
  const t = new D.Timeline();
  const events = [{type: 'scene', background: '', cast: [], location: 'Главное меню', chapter: 'Новая игра'},
    narrate('Welcome'), narrate('Which game?'), {type: 'choices', items: [{label: 'DR1', text: 'Choose DR1'}]}];
  t.update([message(events)]);
  assert.equal(t.state().menu, true);
  assert.equal(t.state().dialogue.text, 'Welcome\n\nWhich game?');
  assert.equal(t.state().choices[0].label, 'DR1'); assert.equal(t.pending, 0);
  const key = t.key; const resumed = new D.Timeline(); resumed.update([message(events)], key);
  assert.deepEqual(resumed.state(), t.state());
  t.update([message(events), message([{type: 'scene', background: 'dr1.bgd-008out', location: 'Класс', chapter: 'Глава 1'}, narrate('Awake'), narrate('Door')], 'next')]);
  t.replay();
  assert.equal(t.state().menu, undefined); assert.equal(t.state().dialogue.text, 'Awake'); assert.equal(t.pending, 1);
});

test('setup choices appear after streaming; actual characters and rooms keep dialogue pacing', () => {
  const t = new D.Timeline();
  const events = [{type: 'scene', background: '', cast: [], location: 'Настройка новой игры'}, narrate('Welcome')];
  t.update([message(events)]); assert.equal(t.state().menu, true); assert.equal(t.state().choices.length, 0);
  events.push(narrate('Pick a hero'), {type: 'choices', items: [{label: 'Custom', text: 'Custom hero'}]});
  t.update([message(events)]); assert.equal(t.state().choices.length, 1); assert.equal(t.pending, 0);
  const story = new D.Timeline();
  story.update([message([{type: 'scene', background: 'dr1.bgd-008out', location: 'Главное меню'}, narrate('One'), narrate('Two')])]);
  assert.equal(story.state().menu, undefined); assert.equal(story.pending, 1);
  const character = new D.Timeline();
  character.update([message([{type: 'scene', background: '', location: 'Новая игра'}, {type: 'say', who: 'dr1.kyoko-kirigiri', text: 'One'}, narrate('Two')])]);
  assert.equal(character.state().menu, undefined); assert.equal(character.pending, 1);
});
