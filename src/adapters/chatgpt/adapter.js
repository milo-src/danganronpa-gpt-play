(() => {
  'use strict';
  const D = globalThis.DGP;
  class ChatGPTAdapter {
    constructor(doc = document, win = window) {
      this.doc = doc; this.win = win; this.timer = null; this.interval = null;
      this.observer = null; this.callback = null; this.pendingSubmit = false;
      this.messageIDs = new WeakMap(); this.messageSerial = 0;
      this.onSubmit = e => {
        if (e.target.closest?.('form') || e.target.closest?.('[data-testid="send-button"]')) this.markSubmit();
      };
      doc.addEventListener('submit', this.onSubmit, true);
      this.onClick = e => {
        if (e.target.closest?.('[data-testid="send-button"]')) this.onSubmit(e);
      };
      this.onKeydown = e => {
        if (e.key === 'Enter' && !e.shiftKey && e.target === this.findComposer()) this.markSubmit();
      };
      doc.addEventListener('click', this.onClick, true);
      doc.addEventListener('keydown', this.onKeydown, true);
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
      // Some site layouts omit the author wrapper around the code renderer.
      // Read explicit game code in the conversation, excluding identified user turns.
      const fallback = new Set();
      const blocks = this.doc.querySelectorAll('main pre, main code, main [data-language="dgp"], main .cm-content, [role="main"] pre, [role="main"] code');
      for (const block of blocks) {
        if (!(block.textContent || '').includes('DGP|') ||
            block.closest('#dgp-extension-root, [data-message-author-role="user"], [data-turn="user"], [role="dialog"], nav, aside') ||
            nodes.some(node => node.contains(block))) continue;
        const container = block.closest('article') || block.closest('pre') || block;
        if (container.querySelector('[data-message-author-role="user"]')) continue;
        fallback.add(container);
      }
      const extra = [...fallback].filter(node => ![...fallback].some(other => other !== node && other.contains(node)));
      nodes.push(...extra);
      nodes.sort((a, b) => a.compareDocumentPosition(b) & 2 ? 1 : -1);
      const messages = []; let invalid = 0, latestHasCommands = false, latestInvalid = 0;
      const streaming = !!this.doc.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Остановить генерацию"]');
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        // Code blocks preserve line breaks, including while ChatGPT is streaming.
        const isCode = node.matches('pre, code, [data-language="dgp"], .cm-content');
        const codes = isCode ? [node] : [...node.querySelectorAll('pre, [data-language="dgp"], .cm-content')]
          .filter(c => (c.textContent || '').includes('DGP|'))
          .filter((c, index, all) => !all.some(other => other !== c && other.contains(c)));
        const sources = codes.length ? codes : [node];
        const parsed = {events: [], invalid: 0};
        for (const source of sources) {
          // Syntax highlighters can use spans, divs or <br>, rather than <code>.
          const code = source.querySelector('code') || source;
          const options = {complete: !streaming || i < nodes.length - 1};
          const candidates = [code.innerText, code.textContent, source.innerText, source.textContent].filter(Boolean).map(raw => {
            // A renderer may concatenate its language toolbar with the first line.
            const start = codes.length ? raw.indexOf('DGP|') : -1;
            return D.protocol.parse(start >= 0 ? raw.slice(start) : raw, options);
          });
          candidates.sort((a, b) => b.events.length - a.events.length || a.invalid - b.invalid);
          const best = candidates[0] || {events: [], invalid: 0};
          parsed.events.push(...best.events); parsed.invalid += best.invalid;
        }
        invalid += parsed.invalid;
        if (i === nodes.length - 1) { latestHasCommands = parsed.events.length > 0; latestInvalid = parsed.invalid; }
        if (!this.messageIDs.has(node)) this.messageIDs.set(node, `dom-message-${++this.messageSerial}`);
        const messageID = node.getAttribute('data-message-id') ||
          node.closest('[data-message-id]')?.getAttribute('data-message-id') ||
          node.closest('article')?.getAttribute('data-testid') || this.messageIDs.get(node);
        if (parsed.events.length) messages.push({id: messageID, events: parsed.events});
      }
      return {messages, invalid, assistantCount: nodes.length, streaming, latestHasCommands, latestInvalid, fallbackCount: extra.length};
    }
    isStreaming() {
      return !!this.doc.querySelector('[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Остановить генерацию"]');
    }
    composerLayout() {
      const editor = this.findComposer();
      if (!editor) return null;
      const rect = editor.getBoundingClientRect();
      const form = editor.closest('form');
      const formRect = form?.getBoundingClientRect();
      // Reserve the site's own editor and controls without moving React-owned DOM.
      const top = formRect && formRect.height < 320 && formRect.top > 100 ? Math.min(rect.top, formRect.top) : rect.top - 28;
      return {gap: Math.max(120, this.win.innerHeight - top + 12), available: top > 140};
    }
    focusComposer() {
      const editor = this.findComposer();
      if (!editor) return false;
      editor.scrollIntoView({block: 'nearest', behavior: 'instant'});
      editor.focus({preventScroll: true}); return true;
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
    destroy() {
      this.stop();
      this.doc.removeEventListener('submit', this.onSubmit, true);
      this.doc.removeEventListener('click', this.onClick, true);
      this.doc.removeEventListener('keydown', this.onKeydown, true);
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
    insertDraft(text, {reuseMatching = false} = {}) {
      const el = this.findComposer();
      if (!el) return {ok: false, reason: 'Поле сообщения не найдено. Сначала скопируй текст ниже, затем открой новый чат внутри этого проекта и вставь его в сообщение.'};
      const existing = el.tagName === 'TEXTAREA' ? el.value : el.textContent;
      const normalize = value => String(value).normalize('NFC').replace(/\s+/g, ' ').trim();
      if (reuseMatching && normalize(existing) === normalize(text)) return {ok: true, reused: true};
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
