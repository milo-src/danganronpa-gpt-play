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
        node('div', {'data-message-author-role': 'user'}).textContent = editor.textContent;
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
  adapter.destroy();
  fixture.replaceChildren(); output.textContent += `\n${passed} passed; ${failed} failed`;
  document.title = `Transport: ${passed} passed, ${failed} failed`;
})();
