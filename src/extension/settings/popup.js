(() => {
  const api = globalThis.browser || globalThis.chrome;
  const status = document.getElementById('status');
  const button = document.getElementById('toggle');
  let tab;
  function show(result) {
    status.textContent = result.enabled ? 'Игра включена в этом диалоге.' : 'Обычный чат. Игровой режим выключен.';
    button.textContent = result.enabled ? 'Выключить игру' : 'Включить игру'; button.disabled = false;
  }
  async function send(type) {
    try { show(await api.tabs.sendMessage(tab.id, {type})); }
    catch { status.textContent = 'Обнови вкладку ChatGPT после установки расширения и открой это меню снова.'; button.disabled = true; }
  }
  button.addEventListener('click', () => send('DGP_TOGGLE'));
  (async () => {
    [tab] = await api.tabs.query({active: true, currentWindow: true});
    if (!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\//.test(tab?.url || '')) {
      status.textContent = 'Открой веб-диалог на chatgpt.com, затем включи игру здесь.'; return;
    }
    await send('DGP_STATUS');
  })().catch(() => { status.textContent = 'Не удалось подключиться к текущей вкладке.'; });
})();
