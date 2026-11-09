(async () => {
  const output = document.getElementById('results'), editor = document.getElementById('prompt-textarea');
  const base = new URL('../', location.href), memory = {};
  const action = 'Осматриваю дверь.';
  let sent = 0, generation = 0;
  globalThis.browser = {
    runtime: {getURL: path => new URL(path, base).href, getManifest: () => ({version: '0.4.0'}), onMessage: {addListener() {}, removeListener() {}}},
    storage: {local: {async get(key) { return {[key]: key.startsWith('dgp-session:') ? {enabled: true} : memory[key]}; }, async set(values) { Object.assign(memory, values); }}}
  };
  document.getElementById('native-form').addEventListener('submit', e => {
    e.preventDefault(); sent++;
    const user = document.createElement('div'); user.dataset.messageAuthorRole = 'user'; user.textContent = editor.textContent;
    const reply = document.createElement('div'); reply.dataset.messageAuthorRole = 'assistant'; reply.dataset.messageId = 'reply';
    reply.textContent = 'DGP|{"type":"say","text":"Дверь заперта."}';
    document.getElementById('conversation').append(user, reply); editor.replaceChildren();
  });
  const sleep = () => new Promise(resolve => setTimeout(resolve, 50));
  async function until(check) { for (let i = 0; i < 80; i++) { if (check()) return; await sleep(); } throw new Error('Timed out'); }
  const assert = (check, label) => { if (!check) throw new Error(label); output.textContent += 'PASS ' + label + '\n'; };
  async function load() {
    delete DGP.app;
    const script = document.createElement('script'); script.src = '../src/extension/content/main.js?test=' + (++generation);
    await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.body.append(script); });
    await until(() => DGP.app?.player.enabled); return DGP.app;
  }
  try {
    const old = await load();
    assert(document.querySelectorAll('#dgp-extension-root').length === 1, 'stale extension window removed');
    let disposed = false;
    const destroy = old.adapter.destroy.bind(old.adapter); old.adapter.destroy = () => { disposed = true; destroy(); };
    const current = await load();
    assert(disposed && old.adapter.observer === null, 'previous observer and listeners disposed on reinjection');
    assert(document.querySelectorAll('#dgp-extension-root').length === 1, 'only one game window after reinjection');
    const css = current.player.shadow.querySelector('link');
    assert(css.href.includes('?v=0.4.0'), 'stylesheet URL includes the installed version');
    await until(() => getComputedStyle(current.player.panel).position === 'fixed');
    current.player.showDraftHelp(action, 'Тест окна восстановления');
    assert(getComputedStyle(current.player.draftHelp).pointerEvents === 'auto' && Number(getComputedStyle(current.player.draftHelp).zIndex) > 0, 'recovery controls receive pointer input above game');
    [...current.player.draftHelp.querySelectorAll('button')].find(b => b.textContent === 'Открыть чат и проверить').click();
    assert(current.player.panel.hidden && current.player.draftHelp.hidden, 'Open chat exposes the native send button without a blocking panel');
    current.player.setCollapsed(false);
    editor.textContent = action;
    await current.player.actions.onDraft(action);
    assert(sent === 1 && editor.textContent === '', 'choice submits existing matching draft without a second click');
    const panelBottom = current.player.panel.getBoundingClientRect().bottom;
    assert(panelBottom < document.getElementById('native-form').getBoundingClientRect().top, 'game leaves native input and send button uncovered');
    const button = document.querySelector('[data-testid=send-button]');
    const rect = button.getBoundingClientRect();
    assert(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === button, 'native send button receives pointer input');

    await until(() => current.player.currentState?.dialogue?.text === 'Дверь заперта.' && !current.player.busy);
    assert(sent === 1 && editor.textContent === '', 'native submission sends once and reply renders');
    const p = current.player, character = 'dr1.kyoko-kirigiri';
    const featureTimeline = new DGP.Timeline();
    featureTimeline.update([{id:'features',events:[
      {type:'scene',location:'Класс',background:'dr1.bgd-008out',player:{id:'dr1.makoto-naegi',name:'Макото'},cast:[{id:character}],
        hotspots:[{id:'desk',label:'Стол',action:'Осматриваю стол.',kind:'inspect',x:30,y:70}],evidence:[{id:'note',title:'Записка',description:'Время исправлено.'}],summary:'Известная история.'},
      {type:'profile',id:character,name:'Кёко',facts:'Знакомство',talent:'',relationship:'Сотрудничество'},
      {type:'say',who:character,name:'Кёко',text:'На записке 18:00.'}
    ].map(DGP.protocol.normalize)}]);
    const state = featureTimeline.state(), meta = {pending:0,history:[state.dialogue]};
    p.setSettings({speed:0}); p.render(state,meta);
    assert(p.stage.querySelectorAll('.hotspot').length === 1 && p.cast.querySelectorAll('.actor-talk').length === 1, 'objects and NPC actions are rendered');
    p.toggleDrawer('handbook'); const notes = p.drawer.querySelector('textarea'); notes.focus(); notes.value='Проверить чернила'; notes.dispatchEvent(new Event('input'));
    p.render(state,meta); assert(p.drawer.querySelector('textarea') === notes && notes.value==='Проверить чернила','scene refresh keeps notebook focus and typed text');
    await sleep(); assert(Object.entries(memory).some(([k,v])=>k.startsWith('dgp-notes:')&&v==='Проверить чернила'),'notes persisted locally');
    p.toggleDrawer('trial'); const reason = p.drawer.querySelector('textarea'); reason.focus(); reason.value='Чернила отличаются';
    p.render(state,meta); assert(p.drawer.querySelector('textarea')===reason,'scene refresh does not erase objection draft');
    p.setBusy(true); assert(p.drawer.querySelector('.objection-button').disabled,'objection is disabled while a turn is pending'); p.setBusy(false);
    p.toggleDrawer('save');
    let captured; const createURL=URL.createObjectURL, revokeURL=URL.revokeObjectURL, anchorClick=HTMLAnchorElement.prototype.click;
    try {
      URL.createObjectURL=blob=>{captured=blob;return 'blob:test-save'}; URL.revokeObjectURL=()=>{}; HTMLAnchorElement.prototype.click=function(){};
      [...p.drawer.querySelectorAll('button')].find(b=>b.textContent==='Скачать сохранение (.json)').click();
    } finally { URL.createObjectURL=createURL; URL.revokeObjectURL=revokeURL; HTMLAnchorElement.prototype.click=anchorClick; }
    const raw=await captured.text(), saved=DGP.features.readSave(raw);
    assert(saved.notes==='Проверить чернила'&&saved.scene.evidence[0].id==='note'&&saved.profiles[0].facts==='Знакомство','export contains read scene, facts, evidence and notes');
    const file=p.drawer.querySelector('input[type=file]'), transfer=new DataTransfer();
    transfer.items.add(new File([raw],'test-save.json',{type:'application/json'})); file.files=transfer.files; file.dispatchEvent(new Event('change'));
    await until(()=>p.drawer.querySelector('[aria-label="Предпросмотр сохранения"]'));
    assert(sent===1,'import previews without submitting anything');
    [...p.drawer.querySelectorAll('button')].find(b=>b.textContent==='Продолжить в этом чате').click();
    await until(()=>sent===2&&!p.busy);
    assert([...document.querySelectorAll('[data-message-author-role=user]')].at(-1).textContent.includes('Проверить чернила'),'explicit continue sends the exported context');
    p.setCollapsed(true); assert(!p.extras.sound.active,'collapsing the game deactivates audio');
    p.setCollapsed(false);
    const form = document.getElementById('native-form');
    form.style.top = '40px'; form.style.bottom = 'auto';
    current.player.setComposerLayout(current.adapter.composerLayout());
    assert(current.player.panel.hidden && current.player.backdrop.hidden, 'oversized native composer takes priority without being covered');
    document.title = 'Browser: 20 passed, 0 failed'; output.textContent += '\n20 passed; 0 failed';
  } catch (error) { output.textContent += 'FAIL ' + error.message; document.title = 'Reload: FAILED'; }
})();
