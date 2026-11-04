(async () => {
  const output = document.getElementById('results'), editor = document.getElementById('prompt-textarea');
  const base = new URL('../', location.href), memory = {};
  const action = 'Осматриваю дверь.';
  let sent = 0, generation = 0;
  globalThis.browser = {
    runtime: {getURL: path => new URL(path, base).href, getManifest: () => ({version: '0.2.1'}), onMessage: {addListener() {}, removeListener() {}}},
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
    assert(css.href.includes('?v=0.2.1'), 'stylesheet URL includes the installed version');
    await until(() => getComputedStyle(current.player.panel).position === 'fixed');
    current.player.showDraftHelp(action, 'Тест окна восстановления');
    assert(getComputedStyle(current.player.draftHelp).pointerEvents === 'auto' && Number(getComputedStyle(current.player.draftHelp).zIndex) > 0, 'recovery controls receive pointer input above game');
    [...current.player.draftHelp.querySelectorAll('button')].find(b => b.textContent === 'Открыть чат и проверить').click();
    assert(current.player.panel.hidden && current.player.draftHelp.hidden, 'Open chat exposes the native send button without a blocking panel');
    current.player.setCollapsed(false);
    editor.textContent = action; current.player.input.value = action; current.player.sendButton.click();
    await until(() => current.player.currentState?.dialogue?.text === 'Дверь заперта.' && !current.player.busy);
    assert(sent === 1 && editor.textContent === '', 'matching existing draft sent once and reply rendered');
    current.player.setCollapsed(true);
    document.title = 'Reload: 7 passed, 0 failed'; output.textContent += '\n7 passed; 0 failed';
  } catch (error) { output.textContent += 'FAIL ' + error.message; document.title = 'Reload: FAILED'; }
})();
