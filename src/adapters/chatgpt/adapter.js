(() => {
  'use strict';
  const D = globalThis.DGP;
  class ChatGPTAdapter {
    constructor(doc = document, win = window) {
      this.doc = doc; this.win = win; this.timer = null; this.interval = null;
      this.observer = null; this.callback = null; this.pendingSubmit = false;
      this.onSubmit = e => {
        if (e.target.closest?.('form') || e.target.closest?.('[data-testid="send-button"]')) this.pendingSubmit = true;
      };
      doc.addEventListener('submit', this.onSubmit, true);
      doc.addEventListener('click', e => {
        if (e.target.closest?.('[data-testid="send-button"]')) this.onSubmit(e);
      }, true);
      doc.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !e.shiftKey && e.target === this.findComposer()) this.pendingSubmit = true;
      }, true);
    }
    route() {
      const path = this.win.location.pathname;
      const match = path.match(/\/c\/([a-zA-Z0-9-]+)/);
      return match ? `chat:${match[1]}` : `draft:${path}`;
    }
    read() {
      const nodes = [...this.doc.querySelectorAll('[data-message-author-role="assistant"]')];
      const messages = []; let invalid = 0;
      const streaming = !!this.doc.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Остановить генерацию"]');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // Code blocks preserve line breaks, including while ChatGPT is streaming.
        const codes = [...node.querySelectorAll('pre code')].filter(c => (c.textContent || '').includes('DGP|'));
        const raw = codes.length ? codes.map(c => c.textContent).join('\n') : (node.innerText || node.textContent || '');
        const parsed = D.protocol.parse(raw, {complete: !streaming || i < nodes.length - 1});
        invalid += parsed.invalid;
        const messageID = node.getAttribute('data-message-id') ||
          node.closest('[data-message-id]')?.getAttribute('data-message-id') ||
          node.closest('article')?.getAttribute('data-testid') || `assistant-${i}`;
        if (parsed.events.length) messages.push({id: messageID, events: parsed.events});
      }
      return {messages, invalid, assistantCount: nodes.length, streaming};
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
