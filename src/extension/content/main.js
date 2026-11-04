(() => {
  'use strict';
  const D = globalThis.DGP;
  if (D.app) return;
  const api = globalThis.browser || globalThis.chrome;
  const adapter = new D.ChatGPTAdapter();
  let timeline = new D.Timeline();
  let route = adapter.route(), routeVersion = 0, enabled = false, resume = '', saveTimer;
  let settings = {speed: 22, auto: false, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches};
  let lastRead = {messages: [], streaming: false, invalid: 0, assistantCount: 0};
  const url = path => api.runtime.getURL(path);
  const keyFor = key => 'dgp-session:' + key;
  const storageGet = async key => { try { return (await api.storage.local.get(key))[key]; } catch { return undefined; } };
  const storageSet = async (key, value) => {
    try { await api.storage.local.set({[key]: value}); }
    catch { player.notice('Не удалось сохранить настройки. Игра продолжает работать в этой вкладке.'); }
  };
  function save() {
    clearTimeout(saveTimer);
    const key = keyFor(route), value = {enabled, cursor: timeline.key, updated: Date.now()};
    saveTimer = setTimeout(() => storageSet(key, value), 250);
  }
  function render() {
    const state = timeline.state();
    player.render(state, {pending: timeline.pending, total: timeline.entries.length,
      history: timeline.entries.slice(0, timeline.cursor + 1).filter(e => e.event.type === 'say').slice(-60).map(e => e.event)});
    const errors = lastRead.invalid ? ` Пропущено строк с ошибкой формата: ${lastRead.invalid}.` : '';
    player.notice((lastRead.streaming ? 'ChatGPT пишет — готовые реплики появляются в сцене.' :
      !timeline.entries.length ? 'Ожидание ответа DGP. Инструкции: instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt.' :
      timeline.pending ? `Продолжай читать: ещё ${timeline.pending} реплик.` :
      'Твой ход. Выбери действие или напиши своё; затем отправь его в ChatGPT.') + errors);
    save();
  }
  const player = new D.Player({url,
    onToggle: () => toggle(!enabled),
    onNext: () => { timeline.next(); render(); },
    onBack: () => { timeline.back(); render(); },
    onReplay: () => { timeline.replay(); player.lastDialogue = ''; render(); },
    onExpand: () => { if (enabled) { lastRead = adapter.read(); timeline.update(lastRead.messages); render(); } },
    onSettings: patch => { settings = {...settings, ...patch}; player.setSettings(settings); storageSet('dgp-settings', settings); },
    onDraft: text => {
      const value = String(text || '').trim().slice(0, 3000);
      if (!value) { player.notice('Сначала напиши действие или выбери вариант.'); return; }
      player.input.value = value;
      const result = adapter.insertDraft(value);
      if (result.ok) {
        player.input.value = ''; player.setCollapsed(true);
        player.notice('Действие в поле ChatGPT. Нажми обычную кнопку отправки.');
      } else {
        player.notice(result.reason);
        player.showDraftHelp(value, result.reason);
      }
    }
  });
  function receive(data) {
    if (!enabled || adapter.route() !== route) return;
    const wasAtEnd = timeline.cursor >= timeline.entries.length - 1;
    const previousMessage = timeline.entries.at(-1)?.message;
    lastRead = data;
    const newMessage = data.messages.at(-1)?.id;
    if (wasAtEnd && previousMessage && previousMessage !== newMessage) timeline.awaiting = true;
    if (timeline.update(data.messages, resume)) {
      resume = '';
      if (previousMessage !== newMessage && newMessage && player.collapsed) player.setCollapsed(false);
      render();
    } else {
      // Do not restart text animations for unrelated mutations.
      const status = data.invalid ? `Пропущено строк с ошибкой формата: ${data.invalid}. Попроси ChatGPT исправить формат DGP.` :
        data.streaming ? 'ChatGPT пишет — готовые реплики появляются в сцене.' :
        !timeline.entries.length && data.assistantCount ? 'Ответ найден, но нет строк DGP. Проверь инструкции проекта и попроси ответить в формате DGP.' : '';
      if (status) player.notice(status);
    }
  }
  async function toggle(value) {
    enabled = value; player.setEnabled(value);
    if (value) { player.lastDialogue = ''; adapter.start(receive); render(); }
    else adapter.stop();
    save();
    return {enabled};
  }
  async function switchRoute() {
    const next = adapter.route(); if (next === route) return;
    const version = ++routeVersion;
    const previousRoute = route;
    const transfer = enabled && route.startsWith('draft:') && next.startsWith('chat:') && adapter.pendingSubmit;
    clearTimeout(saveTimer);
    await storageSet(keyFor(previousRoute), {enabled, cursor: timeline.key, updated: Date.now()});
    if (version !== routeVersion) return;
    adapter.stop(); route = next; timeline = new D.Timeline(); resume = ''; adapter.pendingSubmit = false;
    player.reset(); enabled = false; player.setEnabled(false);
    const saved = await storageGet(keyFor(route));
    if (version !== routeVersion) return;
    resume = saved?.cursor || '';
    if (transfer) await storageSet(keyFor(previousRoute), {enabled: false, cursor: '', updated: Date.now()});
    await toggle(transfer || saved?.enabled === true);
  }
  api.runtime.onMessage.addListener((message, sender, respond) => {
    if (message?.type === 'DGP_STATUS') { respond({enabled, route}); return false; }
    if (message?.type === 'DGP_TOGGLE') { toggle(!enabled).then(respond); return true; }
    return false;
  });
  D.app = {player, adapter, toggle};
  // Poll just the URL: no conversation reads while disabled. Handles SPA navigation.
  setInterval(switchRoute, 500);
  (async () => {
    const version = routeVersion;
    const savedSettings = await storageGet('dgp-settings');
    if (savedSettings) {
      settings = {...settings, speed: [0, 12, 22, 40].includes(savedSettings.speed) ? savedSettings.speed : 22,
        auto: savedSettings.auto === true, reduced: savedSettings.reduced === true};
    }
    player.setSettings(settings);
    const session = await storageGet(keyFor(route));
    if (version !== routeVersion) return;
    resume = session?.cursor || '';
    await toggle(session?.enabled === true);
  })();
})();
