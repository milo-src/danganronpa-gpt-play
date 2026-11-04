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
    constructor({url, onToggle, onNext, onBack, onReplay, onDraft, onSettings, onExpand}) {
      this.url = url; this.actions = {onToggle, onNext, onBack, onReplay, onDraft, onSettings, onExpand};
      this.lastDialogue = ''; this.lastCast = ''; this.animation = null; this.autoTimer = null;
      this.settings = {speed: 22, auto: false, reduced: false}; this.enabled = false; this.collapsed = false;
      this.host = el('div'); this.host.id = 'dgp-extension-root';
      this.host.style.cssText = 'position:fixed;z-index:2147483000;inset:0;pointer-events:none;';
      this.shadow = this.host.attachShadow({mode: 'open'});
      const css = el('link'); css.rel = 'stylesheet'; css.href = url('src/ui/styles/player.css');
      this.shadow.append(css);
      this.launch = this.button('RONPA · ВЫКЛ', () => this.enabled && this.collapsed ? this.setCollapsed(false) : onToggle(), 'launcher');
      this.launch.setAttribute('aria-label', 'Включить или выключить игровой режим');
      this.panel = el('section', 'player'); this.panel.hidden = true;
      this.panel.setAttribute('aria-label', 'Игровая сцена Danganronpa');
      const toolbar = el('header', 'toolbar');
      const brand = el('div', 'brand', 'DANGANRONPA'); brand.append(el('small', '', 'GPT PLAY / LOCAL'));
      const controls = el('nav', 'controls'); controls.setAttribute('aria-label', 'Управление игрой');
      controls.append(this.button('Улики', () => this.toggleDrawer('evidence')), this.button('Журнал', () => this.toggleDrawer('history')),
        this.button('Настройки', () => this.toggleDrawer('settings')), this.button('Свернуть', () => this.setCollapsed(true)),
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
        el('p', '', 'Добавь инструкции и каталог ресурсов в проект ChatGPT. Напиши «Начни новую игру» — сцена появится по мере ответа.'));
      this.welcome.append(this.button('Вставить стартовый запрос', () => onDraft('Начни новую игру Danganronpa по инструкциям проекта, в формате DGP. Сначала предложи выбрать часть, героя и режим спойлеров.')));
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
      const compose = el('div', 'compose'); this.input = el('textarea'); this.input.rows = 1; this.input.maxLength = 3000;
      this.input.placeholder = 'Твоё действие, реплика или возражение…'; this.input.setAttribute('aria-label', 'Действие игрока');
      compose.append(this.input, this.button('В поле ChatGPT ↗', () => onDraft(this.input.value), 'draft'));
      this.drawer = el('aside', 'drawer'); this.drawer.hidden = true;
      this.panel.append(toolbar, this.stage, this.dialogue, this.status, compose, this.drawer);
      this.shadow.append(this.launch, this.panel); document.documentElement.append(this.host);
      this.panel.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this.setCollapsed(true); this.launch.focus(); }
        if ((e.key === ' ' || e.key === 'ArrowRight') && !['TEXTAREA', 'INPUT', 'SELECT', 'BUTTON'].includes(e.target.tagName)) {
          e.preventDefault(); this.advance();
        }
      });
      this.panel.tabIndex = -1;
      this.panel.addEventListener('focusout', () => this.scheduleAuto());
      document.addEventListener('visibilitychange', () => this.scheduleAuto());
      this.drawSettings();
    }
    button(text, callback, cls = '') {
      const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', callback); return b;
    }
    setEnabled(value) {
      this.enabled = value; this.collapsed = false; this.panel.hidden = !value;
      this.launch.textContent = value ? 'RONPA · ВКЛ' : 'RONPA · ВЫКЛ';
      this.launch.setAttribute('aria-pressed', String(value));
      this.host.classList.toggle('enabled', value);
      if (!value) { this.stopTyping(); clearTimeout(this.autoTimer); }
      else this.panel.focus({preventScroll: true});
    }
    setCollapsed(value) {
      this.collapsed = value; this.panel.hidden = value || !this.enabled;
      this.launch.textContent = value ? 'RONPA · ОТКРЫТЬ' : (this.enabled ? 'RONPA · ВКЛ' : 'RONPA · ВЫКЛ');
      this.scheduleAuto();
      if (!value) { this.actions.onExpand?.(); this.panel.focus({preventScroll: true}); }
    }
    notice(text) { this.status.textContent = text; }
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
        el('p', 'hint', 'Space / → — далее, когда фокус на сцене. Esc — свернуть. Действия переносятся в черновик; отправь их обычной кнопкой ChatGPT.'));
      if (this.drawerName === 'settings' && !this.drawer.hidden) this.renderDrawer();
    }
    render(state, meta) {
      this.currentState = state; this.meta = meta;
      this.chapter.textContent = state.chapter; this.mode.textContent = modes[state.mode]; this.panel.dataset.mode = state.mode;
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
          const path = Object.hasOwn(asset.sprites, c.sprite) ? asset.sprites[c.sprite] : asset.sprites[asset.defaultSprite];
          const figure = el('figure', 'actor' + (state.dialogue?.who === c.id ? ' speaking' : ''));
          const image = el('img'); image.alt = asset.name; image.src = this.url(path);
          image.addEventListener('error', () => { figure.hidden = true; this.notice(`Не загрузился спрайт: ${asset.name}.`); });
          figure.append(image); this.cast.append(figure);
        }
      }
      this.welcome.hidden = !!state.dialogue;
      this.dialogue.hidden = !state.dialogue;
      if (state.dialogue) {
        const d = state.dialogue;
        const character = Object.hasOwn(D.assets.characters, d.who) ? D.assets.characters[d.who] : null;
        this.speaker.textContent = d.name || character?.name || 'Рассказчик';
        this.progress.textContent = meta.pending ? `Ещё реплик: ${meta.pending}` : 'Текущая реплика';
        const dialogueKey = JSON.stringify(d);
        if (dialogueKey !== this.lastDialogue) {
          this.lastDialogue = dialogueKey; this.typeText(d.text); this.playEffect(d.effect);
        }
      } else { this.lastDialogue = ''; this.stopTyping(); }
      this.choices.replaceChildren(...state.choices.map(c => this.button(c.label, () => this.actions.onDraft(c.text))));
      this.nextButton.disabled = meta.total === 0;
      this.nextButton.textContent = meta.pending ? 'Далее ▸' : 'Дочитать / ждать ▸';
      if (!this.drawer.hidden) this.renderDrawer();
      this.scheduleAuto();
    }
    typeText(text) {
      this.stopTyping(); this.fullText = text;
      if (this.settings.speed === 0 || this.settings.reduced) { this.text.textContent = text; return; }
      this.text.textContent = ''; const chars = Array.from(text); let pos = 0;
      this.animation = setInterval(() => {
        pos = Math.min(chars.length, pos + Math.max(1, Math.ceil(chars.length / 450)));
        this.text.textContent = chars.slice(0, pos).join('');
        if (pos === chars.length) { this.stopTyping(); this.scheduleAuto(); }
      }, this.settings.speed);
    }
    stopTyping() { clearInterval(this.animation); this.animation = null; }
    advance() {
      if (this.animation) { this.stopTyping(); this.text.textContent = this.fullText; this.scheduleAuto(); }
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
      this.input.value = ''; this.drawer.hidden = true; this.effect.textContent = ''; this.background.dataset.path = '';
    }
  }
  D.Player = Player;
})();
