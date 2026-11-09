const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function load() {
  const context = vm.createContext({});
  for (const file of ['src/data/runtime-assets.js', 'src/game/dialogue/protocol.js', 'src/game/scene/timeline.js', 'src/game/features.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  }
  return context.DGP;
}
const D = load();
const plain = v => JSON.parse(JSON.stringify(v));
const say = text => ({type: 'say', who: 'dr1.kyoko-kirigiri', text});
const parse = events => D.protocol.parse(events.map(e => 'DGP|' + JSON.stringify(e)).join('\n')).events;
const message = (events, id = 'message-1') => ({id, events: parse(events)});

test('all character packs have verified neutral and speech poses without missing files', () => {
  assert.equal(Object.keys(D.assets.characters).length, 65);
  for (const [id, c] of Object.entries(D.assets.characters)) {
    assert.ok(c.expressions.neutral && c.expressions.talking, id);
    for (const key of Object.values(c.expressions)) assert.ok(c.sprites[key], id + ':' + key);
  }
  assert.match(D.resolveSprite('dr2.fuyuhiko-kuzuryu', 'angry').key, /nopatch/);
  assert.equal(D.resolveSprite('dr1.alter-ego', 'happy').key, 'app/alteregoface02');
});

test('hotspots reject unusable actions, constrain coordinates, and disappear on moving rooms', () => {
  const scene = D.protocol.normalize({type:'scene',location:'Класс',hotspots:[null,{},
    {id:'door',label:'Дверь',action:'Осматриваю дверь',kind:'bad',x:900,y:-2},
    {id:'desk',label:'Стол',action:'Осматриваю стол',x:'50',y:null}]});
  assert.equal(scene.hotspots.length, 2);
  assert.deepEqual(plain(scene.hotspots[0]), {id:'door',label:'Дверь',action:'Осматриваю дверь',kind:'inspect',x:96,y:8});
  assert.equal(scene.hotspots[1].x, null);
  const t = new D.Timeline(); t.update([message([scene,say('Оглянись.'),{type:'scene',location:'Холл'},say('Новая комната.')])]);
  assert.equal(t.state().hotspots.length, 2); t.next(); assert.equal(t.state().hotspots.length, 0);
  t.back(); assert.equal(t.state().hotspots.length, 2);
});

test('handbook, evidence and save contain only read facts, including when rewinding', () => {
  const t = new D.Timeline(); t.update([message([
    {type:'scene',location:'Класс',player:{id:'dr1.makoto-naegi',name:'Макото'},cast:[{id:'dr1.kyoko-kirigiri'}],summary:'Мы в классе.'},
    {type:'profile',id:'dr1.kyoko-kirigiri',name:'Кёко',facts:'Знакомство'},say('Привет.'),
    {type:'profile',id:'dr1.kyoko-kirigiri',name:'Кёко',facts:'Новый факт'},
    {type:'evidence',id:'secret',title:'Новая улика',description:'Пока не прочитано'},say('Новый факт')
  ])]);
  const save = () => D.features.snapshot(t.state(), t.entries.slice(0,t.cursor+1).filter(x=>x.event.type==='say').map(x=>x.event),'Моя версия');
  const initial = save(); assert.equal(initial.profiles[0].facts, 'Знакомство');
  assert.equal(initial.scene.evidence.length, 0); assert.doesNotMatch(JSON.stringify(initial), /Новый факт|Пока не прочитано/);
  assert.equal(initial.scene.profiles, undefined); assert.equal(initial.scene.dialogue, undefined);
  t.next(); assert.equal(save().profiles[0].facts, 'Новый факт'); assert.equal(save().scene.evidence.length,1);
  t.back(); assert.equal(save().scene.evidence.length,0);
  const copy = D.features.readSave(JSON.stringify(initial)); assert.deepEqual(plain(copy),plain(initial));
  const prompt = D.features.continuation(copy); assert.match(prompt,/Моя версия/); assert.match(prompt,/Не начинай заново/);
});

test('profile validation rejects unknown identities and limits revealed text', () => {
  assert.equal(D.protocol.normalize({type:'profile',id:'__proto__'}),null);
  assert.equal(D.protocol.normalize({type:'profile',id:'unknown'}),null);
  const p = D.protocol.normalize({type:'profile',id:'dr1.kyoko-kirigiri',facts:'a'.repeat(3000),relationship:'b'.repeat(500)});
  assert.equal(p.facts.length,1200); assert.equal(p.relationship.length,300);
});

test('save import validates schema, asset IDs and size; does not execute arbitrary data', () => {
  const good = D.features.snapshot({...new D.Timeline().state(),location:'Класс'},[], 'notes');
  for (const value of ['', '{}', 'null', '{bad}', JSON.stringify({...good,version:9}),JSON.stringify({...good,scene:{type:'scene'}}),'x'.repeat(1000001)]) {
    assert.throws(()=>D.features.readSave(value));
  }
  assert.throws(()=>D.features.readSave(JSON.stringify({...good,scene:{...good.scene,background:'https://outside/'}})));
  const cleaned = D.features.readSave(JSON.stringify({...good,profiles:[null,{}, {id:'__proto__'}],history:[null,{}],scene:{...good.scene,cast:[{id:'__proto__'}]}}));
  assert.equal(cleaned.profiles.length,0); assert.equal(cleaned.history.length,0); assert.equal(cleaned.scene.cast.length,0);
  assert.throws(()=>D.features.continuation({...good,notes:'x'.repeat(60001)}),/60 000/);
});

test('a fully populated maximum-size exported save can be imported again', () => {
  const state = {...new D.Timeline().state(),location:'Класс',
    evidence:Array.from({length:60},(_,i)=>({id:String(i),title:'"'.repeat(100),description:'"'.repeat(1200)})),
    profiles:Object.keys(D.assets.characters).map(id=>({id,name:'"'.repeat(100),talent:'"'.repeat(120),facts:'"'.repeat(1200),relationship:'"'.repeat(300)}))};
  const history=Array.from({length:60},()=>({who:'dr1.kyoko-kirigiri',name:'"'.repeat(100),text:'"'.repeat(2000)}));
  const exported=D.features.snapshot(state,history,'"'.repeat(8000));
  const raw=JSON.stringify(exported,null,2);
  assert.ok(raw.length>250000); assert.ok(Buffer.byteLength(raw)<2000000);
  const imported=D.features.readSave(raw);
  assert.equal(imported.history.length,60); assert.equal(imported.profiles.length,65); assert.equal(imported.scene.evidence.length,60);
});

test('objection ties the actual statement and evidence to the player explanation', () => {
  const line = {name:'Кёко',text:'Встреча в 18:00.'}, evidence={id:'note',title:'Записка',description:'Исправлено на 19:00.'};
  assert.throws(()=>D.features.objection(line,evidence,' '));
  const result = D.features.objection(line,evidence,'Чернила отличаются.');
  for (const text of ['Встреча в 18:00.','Записка','note','Исправлено на 19:00.','Чернила отличаются.','не засчитывай']) assert.ok(result.includes(text));
});

test('moving to a room without a cast clears previous inhabitants and rewinds correctly', () => {
  const t = new D.Timeline();
  t.update([message([
    {type: 'scene', background: 'drv3.classroom1a', location: 'Класс', cast: [{id: 'drv3.kaede-akamatsu'}]},
    {type: 'say', who: 'drv3.kaede-akamatsu', text: 'Я останусь здесь.'},
    {type: 'scene', background: 'drv3.1f', location: 'Холл'},
    {type: 'say', who: '', name: 'Рассказчик', text: 'Шуити выходит в пустой холл.'}
  ])]);
  assert.equal(t.state().cast.length, 1);
  t.next(); assert.deepEqual(plain(t.state().cast), []);
  assert.equal(t.state().dialogue.who, '');
  t.back(); assert.equal(t.state().cast[0].id, 'drv3.kaede-akamatsu');
});

test('explicit empty cast stays empty for an off-screen voice until a new entrance scene', () => {
  const t = new D.Timeline();
  t.update([message([
    {type: 'scene', location: 'Холл', cast: []},
    {type: 'say', who: 'drv3.kaede-akamatsu', text: 'Голос из-за двери.'},
    {type: 'scene', cast: [{id: 'drv3.kaede-akamatsu'}]},
    {type: 'say', who: 'drv3.kaede-akamatsu', text: 'Каэдэ входит.'}
  ])]);
  assert.equal(t.state().cast.length, 0);
  assert.equal(t.state().dialogue.who, 'drv3.kaede-akamatsu');
  t.next(); assert.equal(t.state().cast.length, 1);
});

test('player identity is separate from NPCs, persists across rooms and cannot spawn a self portrait', () => {
  const t = new D.Timeline();
  t.update([message([
    {type: 'scene', player: {id: 'drv3.shuichi-saihara', name: 'Шуити Сайхара'}, location: 'Класс',
      cast: [{id: 'drv3.shuichi-saihara'}, {id: 'drv3.kaede-akamatsu'}]},
    {type: 'say', who: '', text: 'Ты стоишь рядом с Каэдэ.'},
    {type: 'scene', location: 'Холл'},
    {type: 'say', who: 'drv3.shuichi-saihara', text: 'Моя мысль.'},
    {type: 'scene', player: null, cast: []},
    {type: 'say', text: 'Выбор другого героя.'}
  ])]);
  assert.deepEqual(plain(t.state().cast.map(c => c.id)), ['drv3.kaede-akamatsu']);
  t.next(); assert.equal(t.state().player.name, 'Шуити Сайхара');
  assert.equal(t.state().cast.length, 0);
  t.next(); assert.equal(t.state().player, null);
});

test('narrator in the same room preserves visible NPCs; invalid backgrounds cannot clear them', () => {
  const t = new D.Timeline();
  t.update([message([
    {type: 'scene', location: 'Класс', cast: [{id: 'drv3.kaede-akamatsu'}]},
    {type: 'say', text: 'Каэдэ рядом.'},
    {type: 'scene', mode: 'investigation', background: 'https://invalid.example/image'},
    {type: 'say', text: 'Ты осматриваешь стол.'}
  ])]);
  t.next(); assert.equal(t.state().cast[0].id, 'drv3.kaede-akamatsu');
});

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
  assert.equal(D.resolveSprite('dr2.akane-owari', 'thinking').key, 'archive/akane-007');
  assert.equal(D.resolveSprite('custom.yasuke-matsuda', 'angry').key, D.assets.characters['custom.yasuke-matsuda'].defaultSprite);
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
  const parsed = D.protocol.parse(example); assert.equal(parsed.invalid, 0); assert.equal(parsed.events.length, 1);
  assert.ok(prompt.replaceAll('\n','\r\n').length < 8000);
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
