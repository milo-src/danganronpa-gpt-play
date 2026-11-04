(() => {
  const fixture = document.getElementById('fixture');
  const output = document.getElementById('results');
  const adapter = new DGP.ChatGPTAdapter();
  let passed = 0, failed = 0;
  function assert(value, message = 'assertion failed') { if (!value) throw new Error(message); }
  function field(tag = 'textarea', attributes = {}, parent = fixture) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    if (attributes.contenteditable) node.style.cssText = 'min-height:40px;border:1px solid #aaa';
    parent.append(node); return node;
  }
  function test(name, action) {
    fixture.replaceChildren();
    try { action(); passed++; output.textContent += `PASS ${name}\n`; }
    catch (error) { failed++; output.textContent += `FAIL ${name}: ${error.message}\n`; }
  }
  test('Known contenteditable composer', () => {
    const editor = field('div', {id: 'prompt-textarea', contenteditable: 'true'});
    assert(adapter.findComposer() === editor);
    assert(adapter.insertDraft('Тестовая реплика').ok); assert(editor.textContent === 'Тестовая реплика');
  });
  test('Wrapper ID and editor without its own ID', () => {
    const wrapper = field('div', {id: 'prompt-textarea'});
    const editor = field('div', {contenteditable: 'true'}, wrapper);
    field('p', {}, editor);
    assert(adapter.findComposer() === editor);
  });
  test('ProseMirror without known ID or data-testid', () => {
    const editor = field('div', {class: 'ProseMirror', contenteditable: 'true'});
    assert(adapter.findComposer() === editor);
  });
  test('Project textarea selected by Russian placeholder and emits input', () => {
    const editor = field('textarea', {placeholder: 'Новое сообщение'}); let observed = '';
    editor.addEventListener('input', () => { observed = editor.value; });
    assert(adapter.insertDraft('Начни новую игру').ok); assert(observed === 'Начни новую игру');
  });
  test('Generic unique textarea in main form', () => {
    const form = field('form'); const editor = field('textarea', {}, form);
    assert(adapter.findComposer() === editor);
  });
  test('Hidden stale ID does not hide visible project editor', () => {
    const old = field('textarea', {id: 'prompt-textarea'}); old.hidden = true;
    const current = field('textarea', {placeholder: 'Спросите что-нибудь'});
    assert(adapter.findComposer() === current);
  });
  test('Search and settings are never selected', () => {
    field('textarea', {placeholder: 'Поиск сообщений'});
    const dialog = field('div', {role: 'dialog'}); field('textarea', {id: 'prompt-textarea'}, dialog);
    assert(adapter.findComposer() === null);
  });
  test('Read-only and disabled editors excluded', () => {
    field('textarea', {id: 'prompt-textarea', readonly: ''});
    field('textarea', {'data-testid': 'composer-input', disabled: ''});
    assert(adapter.findComposer() === null);
  });
  test('Ambiguous editors are not guessed', () => {
    field('textarea', {placeholder: 'Message'}); field('textarea', {placeholder: 'Message'});
    assert(adapter.findComposer() === null);
  });
  test('Existing draft stays intact', () => {
    const editor = field('textarea', {id: 'prompt-textarea'}); editor.value = 'Мой черновик';
    assert(!adapter.insertDraft('Другое действие').ok); assert(editor.value === 'Мой черновик');
  });
  test('Missing editor returns recoverable failure', () => {
    const result = adapter.insertDraft('Действие'); assert(!result.ok && result.reason.includes('скопируй'));
  });
  fixture.replaceChildren();
  output.textContent += `\n${passed} passed; ${failed} failed`;
  document.title = `Adapter: ${passed} passed, ${failed} failed`;
})();
