const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function harness() {
  const timers = new Map(); let serial = 0;
  class Audio {
    constructor() { this.paused = true; this.currentTime = 0; this.plays = 0; this.events = {}; }
    addEventListener(name, cb) { this.events[name] = cb; }
    play() { this.paused = false; this.plays++; return Promise.resolve(); }
    pause() { this.paused = true; }
    removeAttribute(name) { if (name === 'src') this.src = ''; }
  }
  const ctx = vm.createContext({DGP:{}, Audio, Blob, URL, Date,
    document: {hidden: false},
    setTimeout: cb => { timers.set(++serial, cb); return serial; }, clearTimeout: id => timers.delete(id),
    setInterval: cb => { timers.set(++serial, cb); return serial; }, clearInterval: id => timers.delete(id)});
  vm.runInContext(read('src/game/audio.js'), ctx);
  vm.runInContext(read('src/ui/components/player.js'), ctx);
  const sound = new ctx.DGP.Sound({url: path => 'https://extension.test/' + path});
  const record = (game, cue) => ({path: `public/assets/audio/local/${game}/${cue}.ogg`, name: cue, loopStart: 1, loopEnd: 20});
  sound.catalog = {version:1,games: Object.fromEntries(['dr1','dr2','drv3'].map(game => [game, {
    music: Object.fromEntries(['daily','trial','tension'].map(cue => [cue,record(game,cue)])),
    ambience:{rain:record(game,'rain')}, effects: {type:record(game,'type'), click:record(game,'click'), evidence:record(game,'evidence')}
  }]))};
  return {sound,ctx,timers};
}
test('original music is opt-in, uses the scene game, and does not restart on renders', async () => {
  const {sound} = harness();
  sound.configure({sound:false}, true, {background:'drv3.classroom'});
  assert.equal(sound.audio.plays,0);
  await sound.unlock(); await Promise.resolve(); await Promise.resolve();
  assert.equal(sound.audio.plays,1); assert.match(sound.audio.src,/drv3\/daily/);
  sound.audio.currentTime = 8;
  sound.configure({},true,{background:'drv3.classroom'});
  assert.equal(sound.audio.currentTime,8); assert.equal(sound.audio.plays,1);
  sound.configure({},true,{background:'dr2.island',mode:'trial'});
  assert.match(sound.audio.src,/dr2\/trial/);
  sound.configure({},false,{background:'dr2.island'});
  assert.ok(sound.audio.paused && sound.ambient.paused && sound.fx.paused && sound.tick.paused);
});
test('explicit silence stops music, environment is independent, and loop bounds are respected', () => {
  const {sound} = harness();
  sound.configure({sound:true},true,{audio:{game:'dr1',music:'none',ambience:'rain'}});
  assert.ok(sound.audio.paused); assert.match(sound.ambient.src,/rain/);
  sound.configure({},true,{audio:{game:'dr1',music:'tension',ambience:'none'}});
  assert.ok(sound.ambient.paused); assert.match(sound.audio.src,/tension/);
  sound.audio.currentTime = 20.1; sound.audio.events.timeupdate();
  assert.equal(sound.audio.currentTime,1);
});
test('event sounds do not repeat on rerender or rewind and typing is rate limited', async () => {
  const {sound,timers} = harness(); sound.configure({sound:true},true,{mode:'daily'});
  sound.effect('evidence','line-1'); await Promise.resolve(); await Promise.resolve();
  const plays = sound.fx.plays;
  sound.effect('evidence','line-1'); assert.equal(sound.fx.plays,plays);
  sound.effect('type'); sound.effect('type'); assert.equal(sound.tick.plays,1); assert.equal(timers.size,1);
  sound.configure({sound:false},true,{});
  assert.equal(timers.size,0); assert.ok(sound.tick.paused);
  sound.effect('type'); assert.equal(sound.tick.plays,1);
  sound.dispose(); assert.equal(await sound.unlock(),false); assert.equal(timers.size,0);
});
test('local pack cannot load arbitrary URLs, and missing cues stay silent', () => {
  const {sound} = harness();
  sound.catalog.games.dr1.music.daily.path = 'https://example.test/tracking.mp3';
  sound.configure({sound:true},true,{}); assert.equal(sound.audio.plays,0);
  sound.configure({},true,{audio:{music:'nonexistent'}}); assert.equal(sound.audio.plays,0);
});
test('a scene switch while play is pending starts the new track after cancellation', async () => {
  const {sound} = harness(); let rejectOld;
  sound.audio.play = function() { this.plays++; return new Promise((resolve,reject) => {rejectOld = reject;}); };
  sound.configure({sound:true},true,{mode:'daily'});
  sound.configure({},true,{mode:'trial'});
  sound.audio.play = function() { this.plays++; this.paused = false; return Promise.resolve(); };
  rejectOld({name:'AbortError'});
  for (let i=0;i<5;i++) await Promise.resolve();
  assert.match(sound.audio.src,/trial/); assert.equal(sound.audio.plays,2); assert.equal(sound.audio.paused,false);
  assert.equal(sound.failed.size,0);
});
test('next reveals a typing line first, then advances, cancelling old sound timers', () => {
  const {ctx,timers} = harness(); let advances = 0, ticks = 0;
  const p = Object.create(ctx.DGP.Player.prototype);
  Object.assign(p,{settings:{textSpeed:12},enabled:true,collapsed:false,text:{textContent:''},nextButton:{},
    meta:{pending:1},currentState:{choices:[]},actions:{onNext(){advances++;}},scheduleAuto(){},
    extras:{sound:{effect(){ticks++;},stopTyping(){}}}});
  p.typeText('Привет 🌟'); assert.equal(p.text.textContent,'');
  [...timers.values()][0](); assert.equal(p.text.textContent,'П'); assert.equal(ticks,1);
  p.advance(); assert.equal(p.text.textContent,'Привет 🌟'); assert.equal(advances,0); assert.equal(timers.size,0);
  p.advance(); assert.equal(advances,1);
  p.typeText('Следующая'); p.typeText('Замена'); assert.equal(timers.size,1);
  p.finishTyping(); assert.equal(p.text.textContent,'Замена'); assert.equal(timers.size,0);
});
test('audio cues are validated, follow read position, and survive save export', () => {
  const ctx = vm.createContext({});
  for (const file of ['src/data/runtime-assets.js','src/game/dialogue/protocol.js','src/game/scene/timeline.js','src/game/features.js']) vm.runInContext(read(file),ctx);
  const D = ctx.DGP, t = new D.Timeline();
  const events = [{type:'scene',location:'A',audio:{game:'drv3',music:'tension',ambience:'none'}},
    {type:'say',text:'A'}, {type:'scene',location:'B',mode:'trial'}, {type:'say',text:'B',sound:'evidence'}].map(D.protocol.normalize);
  t.update([{id:'a',events}]); assert.equal(t.state().audio.music,'tension');
  t.next(); assert.equal(t.state().audio.music,undefined); t.back(); assert.equal(t.state().audio.music,'tension');
  const saved = D.features.readSave(JSON.stringify(D.features.snapshot(t.state())));
  assert.equal(saved.scene.audio.music,'tension');
  assert.equal(D.protocol.normalize({type:'scene',audio:{music:'https://bad.test'}}).audio.music,undefined);
});
