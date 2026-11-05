(() => {
  'use strict';
  const D = globalThis.DGP;
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const modes = {daily: 'ПОВСЕДНЕВНАЯ ЖИЗНЬ', investigation: 'РАССЛЕДОВАНИЕ', trial: 'КЛАССНЫЙ СУД'};
  class Player {
    constructor({url, version = 'dev', onToggle, onNext, onBack, onReplay, onDraft, onSettings, onExpand, onFocusComposer, onRestoreDraft, onRetry}) {
      this.url = url; this.actions = {onToggle, onNext, onBack, onReplay, onDraft, onSettings, onExpand, onFocusComposer, onRestoreDraft, onRetry};
      this.version = version; this.busy = false; this.savedDrafts = [];
      this.lastDialogue = ''; this.lastCast = ''; this.animation = null; this.autoTimer = null;
      this.settings = {speed: 22, auto: false, reduced: false}; this.enabled = false; this.collapsed = false;
      // Firefox can leave a previous content script's DOM behind on add-on reload.
      for (const previous of document.querySelectorAll('#dgp-extension-root')) {
        previous.dispatchEvent(new Event('dgp-dispose'));
        previous.remove();
      }
      this.host = el('div'); this.host.id = 'dgp-extension-root';
      this.host.dataset.version = version;
      this.host.style.cssText = 'position:fixed;z-index:2147483000;inset:0;pointer-events:none;';
      this.shadow = this.host.attachShadow({mode: 'open'});
      const css = el('link'); css.rel = 'stylesheet'; css.href = url('src/ui/styles/player.css') + '?v=' + encodeURIComponent(version);
      this.shadow.append(css);
      this.backdrop = el('div', 'native-backdrop'); this.backdrop.hidden = true;
      this.shadow.append(this.backdrop);
      this.launch = this.button('RONPA · ВЫКЛ', () => this.enabled ? this.setCollapsed(!this.collapsed) : onToggle(), 'launcher');
      this.launch.setAttribute('aria-label', 'Включить или выключить игровой режим');
      this.panel = el('section', 'player'); this.panel.hidden = true;
      this.panel.setAttribute('aria-label', 'Игровая сцена Danganronpa');
      const toolbar = el('header', 'toolbar');
      const brand = el('div', 'brand', 'DANGANRONPA'); brand.append(el('small', '', `GPT PLAY · ${version}`));
      const controls = el('nav', 'controls'); controls.setAttribute('aria-label', 'Управление игрой');
      controls.append(this.button('Улики', () => this.toggleDrawer('evidence')), this.button('Журнал', () => this.toggleDrawer('history')),
        this.button('Настройки', () => this.toggleDrawer('settings')), this.button('Открыть чат', () => this.setCollapsed(true)),
        this.button('Выкл', onToggle, 'off'));
      toolbar.append(brand, controls);
      this.stage = el('div', 'stage'); this.background = el('img', 'background'); this.background.alt = '';
      this.background.addEventListener('error', () => { this.background.hidden = true; this.notice('Файл фона не загрузился. Проверь, что папка public скачана целиком.'); });
      const shade = el('div', 'shade');
      this.chapter = el('div', 'chapter'); this.mode = el('div', 'mode'); this.location = el('div', 'location');
      const top = el('div', 'scene-info'); top.append(this.chapter, this.mode, this.location);
      this.cast = el('div', 'cast'); this.effect = el('div', 'effect'); this.effect.setAttribute('aria-hidden', 'true');
      this.stage.append(this.background, shade, top, this.cast, this.effect);
      this.welcome = el('div', 'welcome');
      this.welcome.append(el('span', 'eyebrow', 'ТВОЯ ИСТОРИЯ НАЧИНАЕТСЯ ЗДЕСЬ'), el('h1', '', 'Надежда или отчаяние?'),
        el('p', '', 'Вставь единый TXT в инструкции проекта ChatGPT и открой в нём новый чат. Отправь «Начни новую игру» — сцена появится по мере ответа.'));
      this.startButton = this.button('Начать игру', () => onDraft('Начни новую игру Danganronpa по инструкциям проекта, в формате DGP. Сначала предложи выбрать часть, героя и режим спойлеров.'));
      this.welcome.append(this.startButton);
      this.stage.append(this.welcome);
      this.dialogue = el('section', 'dialogue');
      const dialogueTop = el('div', 'dialogue-top'); this.speaker = el('strong', 'speaker'); this.progress = el('small', 'progress');
      dialogueTop.append(this.speaker, this.progress);
      this.text = el('p', 'speech');
      this.nextButton = this.button('Далее ▸', () => this.advance(), 'next');
      this.backButton = this.button('◂ Назад', onBack);
      const actions = el('div', 'dialogue-actions'); actions.append(this.backButton, this.nextButton);
      this.choices = el('div', 'choices');
      this.dialogue.append(dialogueTop, this.text, this.choices, actions);
      this.status = el('div', 'status'); this.status.setAttribute('role', 'status');
      this.repairButton = this.button('Исправить формат ответа', () => onDraft('Переформатируй только свой последний ответ по инструкциям проекта: блок dgp, команды DGP| и строгий JSON. Сохрани сюжет, текущую сцену и варианты выбора; не начинай игру заново.'), 'repair');
      this.repairButton.hidden = true;
      const statusRow = el('div', 'status-row'); statusRow.append(this.status, this.repairButton);
      const compose = el('div', 'game-compose');
      const inputLabel = this.inputLabel = el('label', 'input-label', 'Твоё действие или реплика');
      this.input = el('textarea', 'action-input'); this.input.id = 'dgp-action';
      this.input.rows = 2; this.input.maxLength = 3000;
      this.input.placeholder = 'Опиши своё действие или напиши реплику от лица своего героя…';
      inputLabel.htmlFor = this.input.id;
      this.sendButton = this.button('Отправить ▸', () => this.actions.onDraft(this.input.value), 'send-action');
      this.input.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
          e.preventDefault(); e.stopPropagation();
          if (!this.busy) this.actions.onDraft(this.input.value);
        }
      });
      const inputRow = el('div', 'input-row'); inputRow.append(this.input, this.sendButton);
      const inputTools = el('div', 'input-tools');
      this.composerHint = el('span', '', 'Enter — отправить · Shift+Enter — новая строка');
      this.restoreDraftButton = this.button('Вернуть мой черновик', () => this.actions.onRestoreDraft?.());
      this.restoreDraftButton.hidden = true;
      this.retryButton = this.button('Повторить этот ход', () => this.actions.onRetry?.());
      this.retryButton.hidden = true;
      inputTools.append(this.retryButton, this.restoreDraftButton, this.composerHint, this.button('Поле сайта ↓', () => this.actions.onFocusComposer?.()));
      compose.append(inputLabel, inputRow, inputTools);
      this.drawer = el('aside', 'drawer'); this.drawer.hidden = true;
      this.panel.append(toolbar, this.stage, this.dialogue, statusRow, compose, this.drawer);
      this.draftHelp = el('aside', 'draft-help'); this.draftHelp.hidden = true;
      // Essential placement and hit testing must survive a stale or failed stylesheet.
      this.draftHelp.style.cssText = 'position:fixed;z-index:10;top:80px;right:24px;max-height:calc(100vh - 100px);overflow:auto;pointer-events:auto;';
      this.draftHelp.setAttribute('aria-label', 'Перенос действия в ChatGPT');
      this.shadow.append(this.launch, this.panel, this.draftHelp); document.documentElement.append(this.host);
      this.panel.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this.setCollapsed(true); this.launch.focus(); }
        if ((e.key === ' ' || e.key === 'ArrowRight') && !['TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) {
          e.preventDefault(); this.advance();
        }
      });
      this.panel.tabIndex = -1;
      this.panel.addEventListener('focusout', () => this.scheduleAuto());
      this.onVisibility = () => this.scheduleAuto();
      document.addEventListener('visibilitychange', this.onVisibility);
      this.host.addEventListener('dgp-dispose', () => {
        this.stopTyping(); clearTimeout(this.autoTimer);
        document.removeEventListener('visibilitychange', this.onVisibility);
      }, {once: true});
      this.drawSettings();
    }
    button(text, callback, cls = '') {
      const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', callback); return b;
    }
    setEnabled(value) {
      this.draftHelp.hidden = true;
      this.enabled = value; this.collapsed = false; this.panel.hidden = !value;
      this.launch.textContent = value ? 'RONPA · ВКЛ' : 'RONPA · ВЫКЛ';
      this.launch.setAttribute('aria-pressed', String(value));
      this.host.classList.toggle('enabled', value);
      this.backdrop.hidden = !value;
      if (!value) { this.stopTyping(); clearTimeout(this.autoTimer); }
      else this.panel.focus({preventScroll: true});
    }
    setCollapsed(value) {
      if (!value) this.draftHelp.hidden = true;
      this.collapsed = value; this.panel.hidden = value || !this.enabled;
      this.backdrop.hidden = value || !this.enabled;
      this.launch.textContent = value ? 'RONPA · ОТКРЫТЬ' : (this.enabled ? 'RONPA · ВКЛ' : 'RONPA · ВЫКЛ');
      this.scheduleAuto();
      if (!value) { this.actions.onExpand?.(); if (!this.collapsed) this.panel.focus({preventScroll: true}); }
    }
    notice(text) { this.status.textContent = text; }
    setComposerLayout(layout) {
      // A tall native editor takes priority over the scene; never cover its controls.
      if (layout && !layout.available && this.enabled && !this.collapsed) this.setCollapsed(true);
      const gap = layout?.available ? layout.gap : 180;
      this.host.style.setProperty('--composer-gap', `${gap}px`);
      this.composerHint.textContent = layout ? 'Enter — отправить · Shift+Enter — новая строка' :
        'Поле ChatGPT пока не найдено. Открой диалог внутри проекта через «Открыть чат».';
    }
    setRetry(value) { this.retryButton.hidden = !value; }
    preserveDraft(text) {
      if (this.savedDrafts.at(-1) !== text) this.savedDrafts.push(text);
      this.restoreDraftButton.hidden = false;
    }
    setBusy(value) {
      this.busy = value;
      this.panel.setAttribute('aria-busy', String(value));
      this.retryButton.disabled = value;
      this.sendButton.disabled = value;
      this.sendButton.textContent = value ? 'Ждём ответ…' : 'Отправить ▸';
      this.restoreDraftButton.disabled = value;
      this.startButton.disabled = value;
      this.repairButton.disabled = value;
      for (const button of this.choices.querySelectorAll('button')) button.disabled = value;
      for (const button of this.drawer.querySelectorAll('.evidence-card button')) button.disabled = value;
    }
    setDiagnostics(data) {
      this.diagnostics = data;
      if (this.drawerName === 'settings' && !this.drawer.hidden) this.drawSettings();
    }
    setFormatIssue(value) { this.repairButton.hidden = !value; }
    showDraftHelp(text, reason) {
      this.draftHelp.hidden = false;
      const explanation = el('p', '', reason); explanation.setAttribute('role', 'status');
      const copyText = el('textarea'); copyText.value = text; copyText.readOnly = true; copyText.rows = 4;
      copyText.setAttribute('aria-label', 'Текст для ручной вставки');
      const copy = this.button('Скопировать текст', async () => {
        try {
          await navigator.clipboard.writeText(text);
          explanation.textContent = 'Скопировано. Вставь в сообщение ChatGPT через Ctrl+V и отправь.';
        } catch {
          copyText.focus(); copyText.select();
          explanation.textContent = 'Текст выделен. Нажми Ctrl+C, затем вставь его в сообщение ChatGPT через Ctrl+V.';
        }
      });
      this.draftHelp.replaceChildren(this.button('Закрыть ×', () => { this.draftHelp.hidden = true; }, 'close-drawer'),
        el('strong', '', 'Действие сохранено'), explanation, copyText, copy,
        this.button('Открыть чат и проверить', () => { this.draftHelp.hidden = true; this.setCollapsed(true); }));
    }
    setSettings(settings) {
      this.settings = {...this.settings, ...settings}; this.panel.classList.toggle('reduced', this.settings.reduced);
      this.drawSettings(); this.scheduleAuto();
    }
    drawSettings() {
      this.settingsBody = el('div');
      const speedLabel = el('label', 'setting', 'Скорость текста'); const speed = el('select');
      for (const [value, name] of [[0, 'Сразу'], [12, 'Быстро'], [22, 'Обычно'], [40, 'Медленно']]) {
        const option = el('option', '', name); option.value = value; speed.append(option);
      }
      speed.value = this.settings.speed; speed.addEventListener('change', () => this.actions.onSettings({speed: Number(speed.value)}));
      speedLabel.append(speed); this.settingsBody.append(speedLabel);
      for (const [key, label] of [['auto', 'Автоматически читать следующие реплики'], ['reduced', 'Уменьшить анимацию и вспышки']]) {
        const row = el('label', 'setting', label); const input = el('input'); input.type = 'checkbox'; input.checked = this.settings[key];
        input.addEventListener('change', () => this.actions.onSettings({[key]: input.checked})); row.append(input); this.settingsBody.append(row);
      }
      this.settingsBody.append(this.button('Повторить последний ответ', this.actions.onReplay),
        this.button('Перечитать сообщения', this.actions.onExpand),
        el('p', 'hint', 'Space / → — далее. Действие пиши в поле игры. Enter отправляет, Shift+Enter добавляет строку. Нажатие варианта отправляет выбранное действие. Esc — открыть чат.'));
      const info = this.diagnostics;
      this.settingsBody.append(el('p', 'diagnostics', `Версия ${this.version}. ` + (info ?
        `Ответов на странице: ${info.assistantCount}. Команд: ${info.events}. Ошибок формата: ${info.invalid}. Поле ввода: ${info.composer ? 'найдено' : 'не найдено'}. Блоков без разметки автора: ${info.fallbackCount || 0}.` : 'Ожидание чтения страницы.')));
      if (this.drawerName === 'settings' && !this.drawer.hidden) this.renderDrawer();
    }
    render(state, meta) {
      this.currentState = state; this.meta = meta;
      this.inputLabel.textContent = state.player?.name ? `Твоё действие или реплика · Ты — ${state.player.name}` : 'Твоё действие или реплика';
      this.panel.classList.toggle('menu', !!state.menu);
      this.panel.classList.toggle('text-scene', !state.background && !state.cast.length && !!state.dialogue);
      this.chapter.textContent = state.chapter; this.mode.textContent = state.menu ? 'НАСТРОЙКА ИСТОРИИ' : modes[state.mode]; this.panel.dataset.mode = state.mode;
      this.location.textContent = state.location;
      const bg = D.assets.backgrounds[state.background];
      if (bg && this.background.dataset.path !== bg.path) { this.background.dataset.path = bg.path; this.background.src = this.url(bg.path); this.background.hidden = false; }
      else if (!bg) { this.background.removeAttribute('src'); this.background.hidden = true; this.background.dataset.path = ''; }
      const castKey = JSON.stringify([state.cast, state.dialogue?.who]);
      if (castKey !== this.lastCast) {
        this.lastCast = castKey; this.cast.replaceChildren();
        for (const c of state.cast) {
          const asset = Object.hasOwn(D.assets.characters, c.id) ? D.assets.characters[c.id] : null;
          if (!asset) continue;
          const sprite = D.resolveSprite(c.id, c.sprite, state.dialogue?.who === c.id);
          const figure = el('figure', 'actor' + (state.dialogue?.who === c.id ? ' speaking' : ''));
          figure.dataset.sprite = sprite.key;
          let image;
          if (sprite.bounds) {
            const [width, height, x, y, croppedWidth, croppedHeight] = sprite.bounds;
            const ns = 'http://www.w3.org/2000/svg';
            const portrait = document.createElementNS(ns, 'svg');
            portrait.setAttribute('viewBox', `${x} ${y} ${croppedWidth} ${croppedHeight}`);
            portrait.setAttribute('preserveAspectRatio', 'xMidYMax meet');
            portrait.setAttribute('role', 'img'); portrait.setAttribute('aria-label', asset.name);
            image = document.createElementNS(ns, 'image');
            image.setAttribute('width', width); image.setAttribute('height', height);
            image.setAttribute('href', this.url(sprite.path));
            portrait.append(image); figure.append(portrait);
          } else {
            image = el('img'); image.alt = asset.name; image.src = this.url(sprite.path);
            figure.append(image);
          }
          image.addEventListener('error', () => { figure.hidden = true; this.notice(`Не загрузился спрайт: ${asset.name}.`); });
          this.cast.append(figure);
        }
      }
      this.welcome.hidden = !!state.dialogue || state.choices.length > 0;
      this.dialogue.hidden = !state.dialogue && !state.choices.length;
      if (state.dialogue) {
        const d = state.dialogue;
        const character = Object.hasOwn(D.assets.characters, d.who) ? D.assets.characters[d.who] : null;
        this.speaker.textContent = d.name || character?.name || 'Рассказчик';
        this.progress.textContent = meta.pending ? `Ещё реплик: ${meta.pending}` : 'Текущая реплика';
        const dialogueKey = JSON.stringify(d);
        if (dialogueKey !== this.lastDialogue) {
          this.lastDialogue = dialogueKey;
          if (state.menu) { this.stopTyping(); this.fullText = d.text; this.text.textContent = d.text; }
          else this.typeText(d.text);
          this.playEffect(d.effect);
        }
      } else { this.lastDialogue = ''; this.stopTyping(); }
      this.choices.replaceChildren(...state.choices.map(c => this.button(c.label, () => this.actions.onDraft(c.text))));
      this.nextButton.hidden = !!state.menu; this.backButton.hidden = !!state.menu;
      this.nextButton.disabled = !meta.pending && !this.animation;
      this.nextButton.textContent = meta.pending ? 'Далее ▸' : this.animation ? 'Показать текст ▸' : state.choices.length ? 'Выбери действие выше' : 'Твой ход';
      if (!this.drawer.hidden) this.renderDrawer();
      this.scheduleAuto();
      this.setBusy(this.busy);
    }
    typeText(text) {
      this.stopTyping(); this.fullText = text;
      if (this.settings.speed === 0 || this.settings.reduced) { this.text.textContent = text; return; }
      this.text.textContent = ''; const chars = Array.from(text); let pos = 0;
      this.animation = setInterval(() => {
        pos = Math.min(chars.length, pos + Math.max(1, Math.ceil(chars.length / 450)));
        this.text.textContent = chars.slice(0, pos).join('');
        if (pos === chars.length) { this.stopTyping(); this.nextButton.disabled = !this.meta?.pending; this.scheduleAuto(); }
      }, this.settings.speed);
    }
    stopTyping() { clearInterval(this.animation); this.animation = null; }
    advance() {
      if (this.animation) { this.stopTyping(); this.text.textContent = this.fullText; this.nextButton.disabled = !this.meta?.pending; this.scheduleAuto(); }
      else this.actions.onNext();
    }
    scheduleAuto() {
      clearTimeout(this.autoTimer);
      const active = this.shadow.activeElement;
      if (!this.enabled || this.collapsed || !this.settings.auto || this.animation || document.hidden ||
          !this.meta?.pending || this.currentState?.choices.length || !this.drawer.hidden ||
          ['TEXTAREA', 'INPUT', 'SELECT'].includes(active?.tagName)) return;
      this.autoTimer = setTimeout(() => this.actions.onNext(), Math.max(2200, (this.fullText?.length || 0) * 35));
    }
    playEffect(effect) {
      this.stage.classList.remove('shake', 'flash'); this.effect.textContent = '';
      if (effect === 'objection') this.effect.textContent = 'ВОЗРАЖЕНИЕ!';
      if (this.settings.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      if (effect === 'shake' || effect === 'flash') {
        void this.stage.offsetWidth; this.stage.classList.add(effect);
      }
    }
    toggleDrawer(name) {
      if (this.drawerName === name && !this.drawer.hidden) this.drawer.hidden = true;
      else { this.drawerName = name; this.drawer.hidden = false; this.renderDrawer(); }
      this.scheduleAuto();
    }
    renderDrawer() {
      const name = this.drawerName;
      this.drawer.replaceChildren(this.button('Закрыть ×', () => { this.drawer.hidden = true; this.scheduleAuto(); }, 'close-drawer'),
        el('h2', '', {evidence: 'Улики / Truth Bullets', history: 'Журнал', settings: 'Настройки'}[name]));
      if (name === 'settings') this.drawer.append(this.settingsBody);
      if (name === 'evidence') {
        const items = this.currentState?.evidence || [];
        if (!items.length) this.drawer.append(el('p', '', 'Улики появятся по мере расследования.'));
        for (const item of items) {
          const card = el('article', 'evidence-card');
          card.append(el('h3', '', item.title), el('p', '', item.description),
            this.button('Предъявить улику', () => this.actions.onDraft(`Предъявляю улику «${item.title}» (${item.id}). ${item.description}`)));
          this.drawer.append(card);
        }
      }
      if (name === 'history') {
        this.drawer.append(el('p', 'objective', this.currentState?.objective || 'Текущая цель пока не задана.'));
        for (const d of this.meta?.history || []) {
          const paragraph = el('p'); paragraph.append(el('strong', '', `${d.name || D.assets.characters[d.who]?.name || 'Рассказчик'}: `), document.createTextNode(d.text));
          this.drawer.append(paragraph);
        }
      }
    }
    reset() {
      this.stopTyping(); clearTimeout(this.autoTimer); this.lastDialogue = ''; this.lastCast = '';
      this.input.value = ''; this.drawer.hidden = true; this.draftHelp.hidden = true; this.effect.textContent = ''; this.background.dataset.path = '';
      this.repairButton.hidden = true; this.retryButton.hidden = true; this.diagnostics = null; this.setBusy(false);
    }
  }
  D.Player = Player;
})();
