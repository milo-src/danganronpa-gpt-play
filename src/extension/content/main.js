(() => {
  'use strict';
  const D = globalThis.DGP;
  if (D.app) return;
  const api = globalThis.browser || globalThis.chrome;
  const adapter = new D.ChatGPTAdapter();
  let timeline = new D.Timeline();
  let route = adapter.route(), routeVersion = 0, enabled = false, resume = '', saveTimer;
  let manualChoice = false, handoff = null, checkingHandoff = false;
  let scope = adapter.scope();
  const handoffKey = 'dgp-start-handoff';
  let settings = {textSpeed: 12, textSound: true, auto: false, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches, sound: false, musicVolume: .25, effectsVolume: .35, ambientVolume: .25};
  let lastRead = {messages: [], streaming: false, invalid: 0, assistantCount: 0};
  let disposed = false, routePoll, sending = false, sendGeneration = 0, awaitingReply = null;
  const url = path => api.runtime.getURL(path);
  const keyFor = key => 'dgp-session:' + key;
  const storageGet = async key => { try { return (await api.storage.local.get(key))[key]; } catch { return undefined; } };
  const storageSet = async (key, value) => {
    if (disposed) return;
    try { await api.storage.local.set({[key]: value}); }
    catch { player.notice('Не удалось сохранить настройки. Игра продолжает работать в этой вкладке.'); }
  };
  function save() {
    clearTimeout(saveTimer);
    const key = keyFor(route), value = {enabled, manual: manualChoice, cursor: timeline.key, updated: Date.now()};
    saveTimer = setTimeout(() => storageSet(key, value), 250);
  }
  function render() {
    const state = timeline.state();
    player.render(state, {key: timeline.entries.slice(0, timeline.cursor + 1).findLast(e => e.event.type === 'say')?.key || timeline.key, pending: timeline.pending, total: timeline.entries.length,
      history: timeline.entries.slice(0, timeline.cursor + 1).filter(e => e.event.type === 'say').slice(-60).map(e => e.event)});
    const errors = lastRead.latestInvalid ? ` В последнем ответе пропущено строк с ошибкой: ${lastRead.latestInvalid}.` : '';
    player.setBusy(sending || !!awaitingReply || lastRead.streaming);
    player.setComposerLayout(adapter.composerLayout());
    player.notice((sending ? 'Отправляю выбранное действие…' : awaitingReply && !lastRead.streaming ? 'Ход отправлен. Ожидаю ответ ChatGPT…' : lastRead.streaming ? 'ChatGPT пишет — готовые реплики появляются в сцене.' :
      !timeline.entries.length ? 'Ожидание ответа DGP. Инструкции: instructions/CHATGPT_PROJECT_INSTRUCTIONS.txt.' :
      state.menu ? (state.choices.length ? 'Нажми вариант — он отправится в ChatGPT. Или напиши свой ответ в поле игры.' : 'Ответь на вопрос в поле «Твоё действие или реплика».') :
      timeline.pending ? `Продолжай читать: ещё ${timeline.pending} реплик.` :
      'Твой ход. Выбери вариант или напиши своё действие в поле ниже.') + errors);
    save();
  }
  const player = new D.Player({url, version: api.runtime.getManifest?.().version || 'dev',
    onToggle: () => toggle(!enabled),
    onNext: () => { timeline.next(); render(); },
    onBack: () => { timeline.back(); render(); },
    onReplay: () => { timeline.replay(); player.lastDialogue = ''; render(); },
    onExpand: () => { if (enabled) { render(); receive(adapter.read()); } },
    onFocusComposer: () => { adapter.focusComposer(); player.setComposerLayout(adapter.composerLayout()); },
    onRestoreDraft: () => {
      const text = player.savedDrafts.pop(); if (!text) return;
      if (player.input.value.trim() && player.input.value !== text) player.savedDrafts.push(player.input.value);
      player.input.value = text; player.input.focus();
      player.restoreDraftButton.hidden = !player.savedDrafts.length;
      player.notice('Твой черновик восстановлен в поле игры.');
    },
    onSettings: patch => { settings = {...settings, ...patch}; player.setSettings(settings); storageSet('dgp-settings', settings); },
    onNotes: text => storageSet('dgp-notes:' + route, String(text).slice(0, 8000)),
    onRetry: () => player.actions.onDraft(player.input.value, {retry: true}),
    onDraft: async (text, {retry = false} = {}) => {
      if (disposed) return;
      if (adapter.route() !== route) { await switchRoute(); return; }
      const value = String(text || '').trim();
      if (value.length > 60000) { player.notice('Сообщение превышает 60 000 символов. Сохрани контекст в файл и прикрепи его к чату.'); return; }
      if (!value) { player.notice('Сначала напиши действие или выбери вариант.'); return; }
      if (sending || awaitingReply || lastRead.streaming) { player.notice('Дождись ответа ChatGPT на предыдущее действие.'); return; }
      const generation = ++sendGeneration, targetRoute = route;
      const current = () => !disposed && enabled && generation === sendGeneration && route === targetRoute;
      sending = true; player.setBusy(true); player.setRetry(false);
      if (player.input.value.trim() && player.input.value.trim() !== value) player.preserveDraft(player.input.value);
      player.input.value = value; player.drawer.hidden = true; player.draftHelp.hidden = true;
      player.notice('Отправляю выбранное действие…');
      armHandoff(value);
      const beforeCount = lastRead.assistantCount;
      const beforeResponse = JSON.stringify(lastRead.messages.at(-1));
      try {
        const result = await adapter.sendAction(value, current, text => player.preserveDraft(text), {retry});
        if (!current() || result.cancelled) return;
        player.setComposerLayout(adapter.composerLayout());
        const replyArrived = lastRead.assistantCount > beforeCount || JSON.stringify(lastRead.messages.at(-1)) !== beforeResponse;
        if (result.ok || replyArrived) {
          if (player.input.value.trim() === value) player.input.value = '';
          if (!replyArrived) awaitingReply = {count: beforeCount, response: beforeResponse, until: Date.now() + 30000};
          if (replyArrived) render();
          else player.notice(lastRead.streaming ? 'ChatGPT пишет — готовые реплики появляются в сцене.' : 'Ход отправлен. Ожидаю ответ ChatGPT…');
        } else { player.setRetry(result.uncertain === true); player.notice(result.reason); }
      } catch {
        if (current()) player.notice('Не удалось отправить действие. Текст сохранён; поле ChatGPT доступно под сценой.');
      } finally {
        if (current()) { sending = false; player.setBusy(!!awaitingReply || lastRead.streaming); }
      }
    }
  });
  function receive(data) {
    if (disposed || !enabled || adapter.route() !== route) return;
    const wasAtEnd = timeline.cursor >= timeline.entries.length - 1;
    const previousMessage = timeline.entries.at(-1)?.message;
    const previousCount = lastRead.assistantCount;
    lastRead = data;
    const delivered = adapter.observeDelivery?.(data);
    if (delivered) player.setRetry(false);
    if (awaitingReply && (data.assistantCount > awaitingReply.count ||
        JSON.stringify(data.messages.at(-1)) !== awaitingReply.response)) awaitingReply = null;
    const newMessage = data.messages.at(-1)?.id;
    const answered = previousMessage && newMessage && newMessage !== previousMessage;
    if (wasAtEnd && previousMessage && previousMessage !== newMessage) timeline.awaiting = true;
    if (timeline.update(data.messages, resume)) {
      resume = '';
      if (answered) timeline.replay();
      if (previousMessage !== newMessage && newMessage && player.collapsed) player.setCollapsed(false);
      player.setRetry(false); render();
    } else {
      if (delivered) render();
      // Do not restart text animations for unrelated mutations.
      const status = data.latestInvalid ? `Пропущено строк с ошибкой формата: ${data.latestInvalid}. Можно запросить исправление формата.` :
        data.streaming ? 'ChatGPT пишет — готовые реплики появляются в сцене.' :
        data.assistantCount && data.latestHasCommands === false ? 'Последний ответ ChatGPT не содержит игровых команд. Нажми «Исправить формат ответа» или открой чат.' : '';
      if (status) player.notice(status);
    }
    player.setBusy(sending || !!awaitingReply || data.streaming);
    player.setComposerLayout(adapter.composerLayout());
    player.setFormatIssue(!data.streaming && !!data.assistantCount && (data.latestHasCommands === false || data.latestInvalid > 0));
    player.setDiagnostics({route, ...data, composer: !!adapter.findComposer(), events: timeline.entries.length});
    // Also reopen for a newly rendered answer whose format needs repairing.
    if (data.assistantCount > previousCount && player.collapsed) player.setCollapsed(false);
  }
  function armHandoff(text) {
    if (!enabled || !route.startsWith('draft:')) return;
    const fingerprint = adapter.fingerprint(text);
    if (!fingerprint) return;
    handoff = {scope: adapter.scope(), fingerprint, expires: Date.now() + 10 * 60 * 1000};
    // Persist before navigation: the new page may have a new content-script instance.
    storageSet(handoffKey, handoff);
  }
  adapter.onSend = armHandoff;
  async function resumeHandoff() {
    if (checkingHandoff || enabled || manualChoice || !route.startsWith('chat:') || !handoff) return;
    if (handoff.expires <= Date.now() || handoff.scope !== adapter.scope()) { handoff = null; return; }
    if (!adapter.hasUserPrompt(handoff.fingerprint)) return;
    const target = route, version = routeVersion;
    checkingHandoff = true; handoff = null;
    try {
      await storageSet(handoffKey, null);
      if (route === target && routeVersion === version && !manualChoice) await toggle(true, false);
    } finally { checkingHandoff = false; }
  }
  async function toggle(value, manual = true) {
    if (disposed) return {enabled: false};
    if (manual) {
      manualChoice = true;
      if (!value) { handoff = null; await storageSet(handoffKey, null); }
    }
    if (disposed) return {enabled: false};
    if (!value) { sendGeneration++; sending = false; awaitingReply = null; }
    enabled = value; player.setEnabled(value);
    if (value) { player.lastDialogue = ''; adapter.start(receive); render(); }
    else adapter.stop();
    // A click must survive immediate navigation, not just a debounce timer.
    if (manual) {
      clearTimeout(saveTimer);
      await storageSet(keyFor(route), {enabled, manual: true, cursor: timeline.key, updated: Date.now()});
    } else save();
    return {enabled};
  }
  async function switchRoute() {
    if (disposed) return;
    const next = adapter.route(); if (next === route) {
      if (enabled) player.setComposerLayout(adapter.composerLayout());
      if (awaitingReply && Date.now() > awaitingReply.until) { awaitingReply = null; player.setBusy(lastRead.streaming); player.notice('Ответ пока не появился. Проверь сообщение или ограничение ChatGPT под сценой.'); }
      await resumeHandoff(); return;
    }
    const version = ++routeVersion;
    sendGeneration++; sending = false; awaitingReply = null;
    const previousRoute = route;
    const transfer = enabled && route.startsWith('draft:') && next.startsWith('chat:') && adapter.pendingSubmit && scope === adapter.scope();
    clearTimeout(saveTimer);
    await storageSet(keyFor(previousRoute), {enabled, manual: manualChoice, cursor: timeline.key, updated: Date.now()});
    if (version !== routeVersion) return;
    adapter.stop(); route = next; scope = adapter.scope(); timeline = new D.Timeline(); resume = ''; adapter.pendingSubmit = false;
    player.reset(); enabled = false;
    lastRead = {messages: [], streaming: false, invalid: 0, assistantCount: 0}; player.setEnabled(false);
    const saved = await storageGet(keyFor(route));
    const notes = await storageGet('dgp-notes:' + route);
    handoff = await storageGet(handoffKey);
    if (version !== routeVersion) return;
    player.setNotes?.(notes);
    resume = saved?.cursor || '';
    manualChoice = saved?.manual === true;
    if (transfer) await storageSet(keyFor(previousRoute), {enabled: false, cursor: '', updated: Date.now()});
    await toggle((transfer && !manualChoice) || saved?.enabled === true, false);
    await resumeHandoff();
  }
  const onRuntimeMessage = (message, sender, respond) => {
    if (message?.type === 'DGP_STATUS') { respond({enabled, route}); return false; }
    if (message?.type === 'DGP_TOGGLE') { toggle(!enabled).then(respond); return true; }
    return false;
  };
  api.runtime.onMessage.addListener(onRuntimeMessage);
  function dispose() {
    disposed = true; enabled = false; routeVersion++;
    clearTimeout(saveTimer); clearInterval(routePoll);
    adapter.destroy(); api.runtime.onMessage.removeListener?.(onRuntimeMessage);
  }
  player.host?.addEventListener('dgp-dispose', dispose, {once: true});
  D.app = {player, adapter, toggle};
  // Poll just the URL: no conversation reads while disabled. Handles SPA navigation.
  routePoll = setInterval(switchRoute, 500);
  (async () => {
    const version = routeVersion;
    const savedSettings = await storageGet('dgp-settings');
    if (savedSettings) {
      settings = {...settings,
        textSpeed: Number.isFinite(savedSettings.textSpeed) ? Math.max(0, Math.min(50, savedSettings.textSpeed)) : 12,
        textSound: savedSettings.textSound !== false,
        effectsVolume: Number.isFinite(savedSettings.effectsVolume) ? Math.max(0, Math.min(1, savedSettings.effectsVolume)) : .35,
        ambientVolume: Number.isFinite(savedSettings.ambientVolume) ? Math.max(0, Math.min(1, savedSettings.ambientVolume)) : .25,
        auto: savedSettings.auto === true, reduced: savedSettings.reduced === true, sound: savedSettings.sound === true,
        musicVolume: Number.isFinite(savedSettings.musicVolume) ? Math.max(0, Math.min(1, savedSettings.musicVolume)) : .25};
    }
    player.setSettings(settings);
    const session = await storageGet(keyFor(route));
    const notes = await storageGet('dgp-notes:' + route);
    handoff = await storageGet(handoffKey);
    if (version !== routeVersion) return;
    player.setNotes?.(notes);
    resume = session?.cursor || '';
    manualChoice = session?.manual === true;
    await toggle(session?.enabled === true, false);
    await resumeHandoff();
  })();
})();
