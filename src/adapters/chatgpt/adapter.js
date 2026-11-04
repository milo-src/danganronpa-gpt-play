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
        if (e.key === 'Enter' && !e.shiftKey && e.target.closest?.('#prompt-textarea')) this.pendingSubmit = true;
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
    insertDraft(text) {
      const el = this.doc.querySelector('#prompt-textarea[contenteditable="true"], [contenteditable="true"][data-testid="composer-input"], textarea#prompt-textarea');
      if (!el) return {ok: false, reason: 'Не найдено поле ChatGPT. Скопируй действие из игрового поля вручную.'};
      const existing = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      if (existing.trim()) return {ok: false, reason: 'В поле ChatGPT уже есть черновик. Он сохранён: очисти или отправь его перед переносом действия.'};
      el.focus();
      if (el.tagName === 'TEXTAREA') {
        const setter = Object.getOwnPropertyDescriptor(this.win.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(el, text); el.dispatchEvent(new this.win.Event('input', {bubbles: true}));
      } else {
        const selection = this.win.getSelection(); const range = this.doc.createRange();
        range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range);
        // insertText goes through the editor's normal input transaction (ProseMirror).
        const inserted = this.doc.execCommand('insertText', false, text);
        if (!inserted || !el.textContent.includes(text)) {
          return {ok: false, reason: 'Редактор не принял вставку. Текст оставлен в игровом поле — скопируй его вручную.'};
        }
      }
      return {ok: true};
    }
  }
  D.ChatGPTAdapter = ChatGPTAdapter;
})();
