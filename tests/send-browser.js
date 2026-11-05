(async () => {
  const fixture = document.getElementById('fixture'), output = document.getElementById('results');
  const adapter = new DGP.ChatGPTAdapter();
  let passed = 0, failed = 0;
  const assert = (value, message = 'assertion failed') => { if (!value) throw new Error(message); };
  function node(tag, attrs = {}, parent = fixture) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    parent.append(el); return el;
  }
  function composer({acknowledge = true, delayed = false, button = true} = {}) {
    const form = node('form'); const editor = node('div', {id: 'prompt-textarea', contenteditable: 'true', class: 'ProseMirror'}, form);
    editor.style.cssText = 'min-height:40px;border:1px solid gray'; node('p', {}, editor);
    const send = button ? node('button', {id: 'composer-submit-button', type: 'submit', 'aria-label': 'Send prompt'}, form) : null;
    if (send) { send.textContent = 'Отправить'; send.disabled = delayed; }
    let clicks = 0;
    form.addEventListener('submit', e => {
      e.preventDefault(); clicks++;
      if (acknowledge) {
        node('div', {'data-message-author-role': 'user'}).textContent = editor.innerText || editor.textContent;
        editor.replaceChildren();
      }
    });
    if (delayed) editor.addEventListener('input', () => setTimeout(() => { send.disabled = false; }, 180));
    return {editor, send, clicks: () => clicks};
  }
  async function test(name, run) {
    fixture.replaceChildren();
    try { await run(); passed++; output.textContent += `PASS ${name}\n`; }
    catch (error) { failed++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  const command = text => 'DGP|' + JSON.stringify({type: 'say', text});
  await test('reads syntax-highlighted adjacent commands without newlines', () => {
    const article = node('article', {'data-turn': 'assistant', 'data-testid': 'conversation-turn-1'});
    const message = node('div', {'data-message-author-role': 'assistant', 'data-message-id': 'one'}, article);
    const code = node('code', {}, node('pre', {}, message));
    node('span', {}, code).textContent = command('First'); node('span', {}, code).textContent = command('Second');
    const result = adapter.read();
    assert(result.assistantCount === 1); assert(result.messages[0].events.length === 2); assert(result.invalid === 0);
  });
  await test('reads div lines, br breaks and pretty-printed JSON without code element', () => {
    const message = node('article', {'data-turn': 'assistant'}), pre = node('pre', {}, message);
    node('div', {}, pre).textContent = 'dgp';
    node('span', {}, pre).textContent = command('First'); node('br', {}, pre);
    node('span', {}, pre).textContent = 'DGP|{\n"type":"say",\n"text":"Second"\n}';
    const result = adapter.read(); assert(result.messages[0].events.length === 2); assert(result.invalid === 0);
  });
  await test('partial streamed command waits for complete JSON', () => {
    const code = node('code', {}, node('pre', {}, node('div', {'data-message-author-role': 'assistant'})));
    node('button', {'data-testid': 'stop-button'});
    code.textContent = command('One') + '\nDGP|{"type":"say","text":"Tw';
    let result = adapter.read(); assert(result.streaming); assert(result.messages[0].events.length === 1); assert(result.invalid === 0);
    code.textContent += 'o"}'; result = adapter.read(); assert(result.messages[0].events.length === 2);
  });
  await test('reads game code without assistant attributes and with a joined language label', () => {
    const article = node('article');
    const pre = node('pre', {}, article);
    pre.textContent = 'dgp' + command('Recovered scene');
    const result = adapter.read();
    assert(result.messages[0]?.events[0]?.text === 'Recovered scene');
    assert(result.fallbackCount === 1 && result.assistantCount === 1);
    assert(adapter.read().messages[0].id === result.messages[0].id, 'stable identity on reread');
  });
  await test('fallback excludes user code and deduplicates nested renderer containers', () => {
    const user = node('article', {'data-turn': 'user'}); node('pre', {}, user).textContent = command('User example');
    const assistant = node('article');
    const pre = node('pre', {}, assistant); const code = node('code', {}, pre);
    code.textContent = command('Actual game');
    const result = adapter.read();
    assert(result.assistantCount === 1); assert(result.messages[0].events.length === 1);
    assert(result.messages[0].events[0].text === 'Actual game');
  });
  await test('recognizes CodeMirror rendering and keeps turn order', () => {
    const first = node('article', {'data-message-author-role': 'assistant'}); node('pre', {}, first).textContent = command('First');
    const second = node('article'); node('div', {class: 'cm-content'}, second).textContent = command('Second');
    const result = adapter.read(); assert(result.assistantCount === 2);
    assert(result.messages[0].events[0].text === 'First'); assert(result.messages[1].events[0].text === 'Second');
  });
  await test('choice inserts draft without clicking native send', () => {
    const form = composer();
    assert(adapter.insertDraft('Осматриваю класс.').ok);
    assert(form.editor.textContent === 'Осматриваю класс.'); assert(form.clicks() === 0);
  });
  await test('existing user draft is preserved and never submitted', () => {
    const form = composer(); form.editor.textContent = 'My unfinished draft';
    assert(!adapter.insertDraft('New action').ok);
    assert(form.editor.textContent === 'My unfinished draft'); assert(form.clicks() === 0);
  });
  await test('matching draft is reused without rewriting or sending', () => {
    const form = composer(); form.editor.textContent = 'Начни новую игру. Выбери героя.';
    let inputs = 0; form.editor.addEventListener('input', () => inputs++);
    assert(adapter.insertDraft(form.editor.textContent, {reuseMatching: true}).reused);
    assert(form.clicks() === 0 && inputs === 0);
  });
  await test('layout reserves native form including its send controls', () => {
    const form = composer(); const container = form.editor.closest('form');
    container.style.cssText = 'position:fixed;bottom:12px;left:20px;right:20px;height:160px';
    const layout = adapter.composerLayout();
    assert(layout.available); assert(innerHeight - layout.gap < container.getBoundingClientRect().top);
    container.style.height = '230px';
    assert(adapter.composerLayout().gap > layout.gap);
    assert(adapter.focusComposer() && document.activeElement === form.editor);
  });
  await test('native Enter is observed but never prevented by extension', () => {
    const form = composer();
    const event = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
    form.editor.dispatchEvent(event);
    assert(!event.defaultPrevented); assert(form.clicks() === 0);
  });
  await test('multiline action survives contenteditable block and br rendering', async () => {
    const form = composer(); const text = 'Осматриваю дверь.\nПроверяю замок.';
    assert((await adapter.sendAction(text)).ok); assert(form.clicks() === 1);
    assert(adapter.fingerprint(fixture.querySelector('[data-message-author-role=user]').textContent) === adapter.fingerprint(text));
  });
  await test('choice waits for delayed site state and sends once', async () => {
    const form = composer({delayed: true});
    const first = adapter.sendAction('Осмотреть дверь');
    assert(!(await adapter.sendAction('Осмотреть дверь')).ok);
    assert((await first).ok); assert(form.clicks() === 1); assert(form.editor.textContent === '');
  });
  await test('existing draft is never replaced or submitted by a choice', async () => {
    const form = composer(); form.editor.textContent = 'Unfinished';
    assert(!(await adapter.sendAction('Choice')).ok);
    assert(form.clicks() === 0 && form.editor.textContent === 'Unfinished');
  });
  await test('game choice preserves unrelated draft then sends only the choice', async () => {
    const form = composer(); form.editor.textContent = 'My unfinished text'; let saved;
    assert((await adapter.sendAction('Choose DR1', () => true, text => { saved = text; })).ok);
    assert(saved === 'My unfinished text'); assert(form.clicks() === 1);
    assert(fixture.querySelector('[data-message-author-role=user]').textContent === 'Choose DR1');
    assert(adapter.insertDraft(saved).ok); assert(form.editor.textContent === saved);
  });
  await test('matching old draft can be sent by one choice click', async () => {
    const form = composer(); form.editor.textContent = 'Choose DR1';
    assert((await adapter.sendAction('Choose DR1')).ok); assert(form.clicks() === 1);
  });
  await test('cancellation during delayed enable never clicks Send', async () => {
    const form = composer({delayed: true}); let current = true;
    const task = adapter.sendAction('Cancelled', () => current); current = false;
    assert((await task).cancelled); assert(form.clicks() === 0);
  });
  await test('new answer confirms send when user markup and Stop button are absent', async () => {
    const form = composer({acknowledge: false});
    form.editor.closest('form').addEventListener('submit', () => {
      form.editor.replaceChildren();
      node('pre', {}, node('article')).textContent = command('Fast answer without author attributes');
    });
    assert((await adapter.sendAction('My action')).ok); assert(form.clicks() === 1);
  });
  await test('hiding Stop instead of removing it ends streaming and unlocks submission', async () => {
    const form = composer(); const stop = node('button', {'data-testid': 'stop-button'}); stop.textContent = 'Stop';
    let latest; adapter.start(data => {latest = data;}); assert(latest.streaming);
    stop.style.display = 'none';
    await new Promise(resolve => setTimeout(resolve, 220));
    assert(!latest.streaming && !adapter.isStreaming());
    adapter.stop(); assert((await adapter.sendAction('After hidden Stop')).ok); assert(form.clicks() === 1);
  });
  await test('three consecutive turns work with retained native draft and recycled answer node', async () => {
    const form = composer({acknowledge: false}); const pre = node('pre', {}, node('article'));
    pre.textContent = command('Before'); let turn = 0;
    form.editor.closest('form').addEventListener('submit', () => { pre.textContent = command('Reply ' + (++turn)); });
    for (const action of ['Продолжить', 'Продолжить', 'Продолжить']) {
      const result = await adapter.sendAction(action, () => true, () => {});
      assert(result.ok, 'turn must be acknowledged');
      assert(adapter.unconfirmed === null, 'no stale delivery lock');
      assert(adapter.composerText() === action, 'site intentionally retains draft');
    }
    assert(form.clicks() === 3);
  });
  await test('late response reconciles a timed-out attempt before the next action', async () => {
    const form = composer({acknowledge: false}); form.editor.textContent = 'Old';
    adapter.unconfirmed = {text: 'Old', hash: adapter.fingerprint('Old'), route: adapter.route(), userCount: 0,
      response: adapter.responseKey(adapter.read()), accepted: false};
    const pre = node('pre', {}, node('article')); pre.textContent = command('Late reply');
    assert(adapter.observeDelivery(adapter.read())); assert(adapter.unconfirmed === null);
    form.editor.closest('form').addEventListener('submit', () => { pre.textContent = command('Next reply'); });
    assert((await adapter.sendAction('New', () => true, () => {})).ok); assert(form.clicks() === 1);
  });
  await test('an uncertain old action cannot block a different next action', async () => {
    const form = composer({acknowledge: false}); form.editor.textContent = 'Old';
    adapter.unconfirmed = {text: 'Old', hash: adapter.fingerprint('Old'), route: adapter.route(), userCount: 0,
      response: adapter.responseKey(adapter.read()), accepted: false};
    form.editor.closest('form').addEventListener('submit', () => { node('pre', {}, node('article')).textContent = command('Reply'); });
    assert((await adapter.sendAction('Different', () => true, () => {})).ok); assert(form.clicks() === 1);
  });
  await test('unconfirmed submission is not clicked again', async () => {
    const form = composer({acknowledge: false});
    const first = await adapter.sendAction('Unconfirmed');
    assert(!first.ok && first.clicked); assert(form.clicks() === 1);
    const second = await adapter.sendAction('Unconfirmed');
    assert(!second.ok && second.clicked); assert(form.clicks() === 1);
    form.editor.closest('form').addEventListener('submit', () => { node('pre', {}, node('article')).textContent = command('Retry accepted'); });
    assert((await adapter.sendAction('Unconfirmed', () => true, undefined, {retry: true})).ok);
    assert(form.clicks() === 2, 'only explicit retry makes a second click');
  });
  adapter.destroy();
  fixture.replaceChildren(); output.textContent += `\n${passed} passed; ${failed} failed`;
  document.title = `Transport: ${passed} passed, ${failed} failed`;
})();
