(() => {
  'use strict';
  const D = globalThis.DGP;
  class ChatGPTAdapter {
    constructor(doc = document, win = window) {
      this.doc = doc; this.win = win; this.timer = null; this.interval = null;
      this.observer = null; this.callback = null; this.pendingSubmit = false;
      this.onSubmit = e => {
        if (e.target.closest?.('form') || e.target.closest?.('[data-testid="send-button"]')) this.markSubmit();
      };
      doc.addEventListener('submit', this.onSubmit, true);
      doc.addEventListener('click', e => {
        if (e.target.closest?.('[data-testid="send-button"]')) this.onSubmit(e);
      }, true);
      doc.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && e.target === this.findComposer()) this.markSubmit();
      }, true);
    }
    route() {
      const path = this.win.location.pathname;
      const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
      return match ? `chat:${match[1]}` : `draft:${path}`;
    }
    scope() {
      const path = this.win.location.pathname;
      // Project URLs add a readable slug after the stable ID when a chat is created.
      const project = path.match(/^\/g\/(g-p-[a-f0-9]{32})(?:-|\/|$)/i);
      return project?.[1] || path.match(/^\/g\/([^/]+)/)?.[1] || 'root';
    }
    fingerprint(text) {
      const normalized = String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim();
      if (!normalized) return '';
      let hash = 2166136261;
      for (let i = 0; i < normalized.length; i++) hash = Math.imul(hash ^ normalized.charCodeAt(i), 16777619);
      return `${normalized.length}:${(hash >>> 0).toString(16)}`;
    }
    hasUserPrompt(fingerprint) {
      return [...this.doc.querySelectorAll('[data-message-author-role="user"]')].some(node =>
        this.fingerprint(node.innerText || node.textContent) === fingerprint);
    }
    markSubmit() {
      this.pendingSubmit = true;
      const composer = this.findComposer();
      if (composer) this.onSend?.(composer.tagName === 'TEXTAREA' ? composer.value : composer.textContent);
    }
    read() {
      const nodes = [...this.doc.querySelectorAll('[data-message-author-role="assistant"], article[data-turn="assistant"]')]
        .filter(node => !node.querySelector('[data-message-author-role="assistant"]'));
      const messages = []; let invalid = 0, latestHasCommands = false, latestInvalid = 0;
      const streaming = !!this.doc.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Остановить генерацию"]');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // Code blocks preserve line breaks, including while ChatGPT is streaming.
        const codes = [...node.querySelectorAll('pre')].filter(c => (c.textContent || '').includes('DGP|'));
        const sources = codes.length ? codes : [node];
        const parsed = {events: [], invalid: 0};
        for (const source of sources) {
          // Syntax highlighters can use spans, divs or <br>, rather than <code>.
          const code = source.querySelector('code') || source;
          const options = {complete: !streaming || i < nodes.length - 1};
          const candidates = [code.innerText, code.textContent].filter(Boolean).map(raw => D.protocol.parse(raw, options));
          candidates.sort((a, b) => b.events.length - a.events.length || a.invalid - b.invalid);
          const best = candidates[0] || {events: [], invalid: 0};
          parsed.events.push(...best.events); parsed.invalid += best.invalid;
        }
        invalid += parsed.invalid;
        if (i === nodes.length - 1) { latestHasCommands = parsed.events.length > 0; latestInvalid = parsed.invalid; }
        const messageID = node.getAttribute('data-message-id') ||
          node.closest('[data-message-id]')?.getAttribute('data-message-id') ||
          node.closest('article')?.getAttribute('data-testid') || `assistant-${i}`;
        if (parsed.events.length) messages.push({id: messageID, events: parsed.events});
      }
      return {messages, invalid, assistantCount: nodes.length, streaming, latestHasCommands, latestInvalid};
    }
    isStreaming() {
      return !!this.doc.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Остановить генерацию"]');
    }
    findSendButton(composer) {
      const selectors = 'button[data-testid="send-button"], button#composer-submit-button, button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Отправить сообщение"], button[aria-label="Отправить запрос"]';
      const candidates = [...this.doc.querySelectorAll(selectors)].filter(button =>
        !button.closest('#dgp-extension-root, [hidden], [inert], [role="dialog"]') &&
        !button.disabled && button.getAttribute('aria-disabled') !== 'true' && button.getClientRects().length &&
        this.win.getComputedStyle(button).visibility !== 'hidden');
      const form = composer?.closest('form');
      const local = form ? candidates.filter(button => form.contains(button)) : [];
      return local.length === 1 ? local[0] : candidates.length === 1 ? candidates[0] : null;
    }
    async sendAction(text, isCurrent = () => true) {
      if (!isCurrent()) return {ok: false, cancelled: true};
      if (this.sending) return {ok: false, reason: 'Действие уже отправляется.'};
      if (this.isStreaming()) return {ok: false, reason: 'Дождись окончания ответа ChatGPT.'};
      this.sending = true;
      const route = this.route();
      const delay = () => new Promise(resolve => this.win.setTimeout(resolve, 80));
      try {
        const result = this.insertDraft(text);
        if (!result.ok) return result;
        const composer = this.findComposer();
        const originalUsers = new Set(this.doc.querySelectorAll('[data-message-author-role="user"]'));
        const fingerprint = this.fingerprint(text);
        // Let the site's editor update its own state and enable its send button.
        for (let attempt = 0; attempt < 38; attempt++) {
          await delay();
          if (!isCurrent() || this.route() !== route) return {ok: false, cancelled: true};
          if (this.findComposer() !== composer || this.fingerprint(composer.tagName === 'TEXTAREA' ? composer.value : composer.textContent) !== fingerprint)
            return {ok: false, reason: 'Черновик изменился. Автоматическая отправка отменена; проверь поле ChatGPT.'};
          if (this.isStreaming()) return {ok: false, reason: 'ChatGPT уже отвечает. Действие осталось в его поле.'};
          const button = this.findSendButton(composer);
          if (!button) continue;
          this.markSubmit(); button.click(); // One click only; never retry a potentially sent message.
          for (let acknowledgement = 0; acknowledgement < 32; acknowledgement++) {
            await delay();
            if (!isCurrent()) return {ok: false, cancelled: true};
            if (this.route() !== route && !route.startsWith('draft:')) return {ok: false, cancelled: true};
            const appeared = [...this.doc.querySelectorAll('[data-message-author-role="user"]')].some(node =>
              !originalUsers.has(node) && this.fingerprint(node.innerText || node.textContent) === fingerprint);
            if (appeared || (this.isStreaming() && !(composer.tagName === 'TEXTAREA' ? composer.value : composer.textContent).trim())) return {ok: true};
          }
          return {ok: false, clicked: true, reason: 'Кнопка отправки нажата, но сайт пока не подтвердил сообщение. Открой чат и проверь его перед повторной отправкой.'};
        }
        return {ok: false, reason: 'Кнопка отправки ChatGPT недоступна. Текст сохранён в его поле; открой чат и отправь вручную.'};
      } finally { this.sending = false; }
    }
    start(callback) {
      this.stop(); this.callback = callback;
      const schedule = () => {
        if (this.timer !== null) return;
        this.timer = this.win.setTimeout(() => { this.timer = null; callback(this.read()); }, 140);
      };
      this.observer = new this.win.MutationObserver(records => {
        if (records.some(r => !r.target.closest?.('#dgp-extension-root'))) schedule();
      });
      this.observer.observe(this.doc.body, {childList: true, subtree: true, characterData: true});
      callback(this.read());
    }
    stop() {
      this.observer?.disconnect(); this.observer = null;
      if (this.timer !== null) this.win.clearTimeout(this.timer);
      this.timer = null; this.callback = null;
    }
    findComposer() {
      const candidates = [...this.doc.querySelectorAll('textarea, [contenteditable], .ProseMirror, [role="textbox"]')];
      const ranked = candidates.filter(el => {
        if (el.closest('#dgp-extension-root, [hidden], [inert], [role="dialog"], nav, aside')) return false;
        if (el.disabled || el.readOnly || el.getAttribute('aria-disabled') === 'true') return false;
        if (el.tagName !== 'TEXTAREA' && !el.isContentEditable) return false;
        if (!el.getClientRects().length) return false;
        const style = this.win.getComputedStyle(el);
        return style.visibility !== 'hidden' && style.display !== 'none';
      }).filter(el => !candidates.some(parent => parent !== el && parent.isContentEditable && parent.contains(el)))
        .map(el => {
          const hint = [el.id, el.getAttribute('data-testid'), el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('data-placeholder')].join(' ');
          if (/search|поиск|rename|переимен|title|названи/i.test(hint)) return {el, score: 0};
          let score = 0;
          if (el.id === 'prompt-textarea' || el.closest('#prompt-textarea')) score = 100;
          else if (/composer|prompt-textarea/.test(hint)) score = 90;
          else if (el.classList.contains('ProseMirror') || el.getAttribute('data-lexical-editor') === 'true') score = 80;
          else if (/message|prompt|ask|сообщени|спроси|новый чат|new chat/i.test(hint)) score = 70;
          else if (el.closest('main') && el.closest('form')) score = 40;
          return {el, score};
        }).filter(c => c.score > 0).sort((a, b) => b.score - a.score);
      return ranked.length && ranked[0].score !== ranked[1]?.score ? ranked[0].el : null;
    }
    insertDraft(text) {
      const el = this.findComposer();
      if (!el) return {ok: false, reason: 'Поле сообщения не найдено. Сначала скопируй текст ниже, затем открой новый чат внутри этого проекта и вставь его в сообщение.'};
      const existing = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      if (existing.trim()) return {ok: false, reason: 'В поле ChatGPT уже есть черновик. Он сохранён: очисти или отправь его перед переносом действия.'};
      try {
        el.scrollIntoView({block: 'center', behavior: 'instant'}); el.focus();
        if (el.tagName === 'TEXTAREA') {
          const setter = Object.getOwnPropertyDescriptor(this.win.HTMLTextAreaElement.prototype, 'value').set;
          setter.call(el, text); el.dispatchEvent(new this.win.Event('input', {bubbles: true}));
        } else {
          const selection = this.win.getSelection(); const range = this.doc.createRange();
          range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
          // insertText goes through the editor's normal input transaction (ProseMirror).
          this.doc.execCommand('insertText', false, text);
        }
      } catch {
        return {ok: false, reason: 'Firefox не разрешил вставку в редактор. Скопируй текст ниже и вставь в сообщение ChatGPT вручную.'};
      }
      const actual = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      if (!actual.includes(text)) return {ok: false, reason: 'Поле не приняло текст. Скопируй его ниже и вставь в сообщение вручную.'};
      return {ok: true};
    }
  }
  D.ChatGPTAdapter = ChatGPTAdapter;
})();
