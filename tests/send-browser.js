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
  await test('waits for site editor, sends once and confirms new user message', async () => {
    const form = composer({delayed: true});
    const first = adapter.sendAction('Осматриваю класс.');
    const second = await adapter.sendAction('Осматриваю класс.');
    assert(!second.ok); assert((await first).ok); assert(form.clicks() === 1); assert(form.editor.textContent === '');
  });
  await test('existing user draft is preserved and never submitted', async () => {
    const form = composer(); form.editor.textContent = 'My unfinished draft';
    assert(!(await adapter.sendAction('New action')).ok);
    assert(form.editor.textContent === 'My unfinished draft'); assert(form.clicks() === 0);
  });
  await test('streaming prevents inserting or sending another action', async () => {
    const form = composer(); node('button', {'data-testid': 'stop-button'});
    assert(!(await adapter.sendAction('Wait')).ok); assert(form.editor.textContent === ''); assert(form.clicks() === 0);
  });
  await test('navigation cancellation prevents clicking send', async () => {
    const form = composer(); let current = true;
    const result = adapter.sendAction('Cancelled', () => current); current = false;
    assert((await result).cancelled); assert(form.clicks() === 0);
  });
  await test('missing send button leaves the action in the native composer', async () => {
    const form = composer({button: false}); const result = await adapter.sendAction('Preserve this');
    assert(!result.ok && !result.clicked); assert(form.editor.textContent === 'Preserve this');
  });
  await test('unconfirmed click is not retried, even if an old matching user message exists', async () => {
    const form = composer({acknowledge: false});
    node('div', {'data-message-author-role': 'user'}).textContent = 'Same action';
    const result = await adapter.sendAction('Same action');
    assert(!result.ok && result.clicked); assert(form.clicks() === 1); assert(form.editor.textContent === 'Same action');
  });
  fixture.replaceChildren(); output.textContent += `\n${passed} passed; ${failed} failed`;
  document.title = `Transport: ${passed} passed, ${failed} failed`;
})();
