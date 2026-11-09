(() => {
  'use strict';
  const DB_NAME = 'dgp-local-soundtracks';
  const DB_VERSION = 1;
  const slot = value => /^(dr1|dr2|drv3):(music|ambience|effects):[a-z0-9_-]+$/.test(value);
  const openDb = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Локальное хранилище недоступно'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище музыки'));
  });
  class Sound {
    constructor({url = path => path} = {}) {
      this.url = url; this.settings = {sound: false, musicVolume: .25, effectsVolume: .35, typingVolume: .4, ambientVolume: .25};
      this.active = false; this.game = 'dr1'; this.mode = 'daily'; this.ambienceCue = 'none';
      this.tracks = Object.create(null); this.urls = Object.create(null); this.disposed = false;
      this.failed = new Set(); this.seen = new Set(); this.lastTick = 0;
      this.audio = new Audio(); this.ambient = new Audio(); this.tick = new Audio(); this.fx = new Audio();
      // A complete, softly enveloped mechanical tap, not a cropped game effect.
      this.tick.preload = 'auto';
      this.tick.src = this.tick.dgpSource = this.url('public/assets/audio/ui/typing-soft.wav');
      for (const media of [this.audio, this.ambient]) {
        media.loop = true; media.preload = 'none';
        media.addEventListener('timeupdate', () => {
          const r = media.dgpRecord;
          if (r?.loopEnd > r?.loopStart && media.currentTime >= r.loopEnd) media.currentTime = r.loopStart;
        });
      }
      for (const media of [this.audio, this.ambient, this.tick, this.fx]) media.addEventListener('error', () => {
        if (this.failed.has(media.dgpSource) || this.disposed) return;
        this.failed.add(media.dgpSource);
        this.onError?.('Аудиофайл не загрузился. Проверь локальный аудиопак в public/assets/audio/local.');
      });
    }
    async load() {
      try {
        const response = await fetch(this.url('public/assets/audio/local/catalog.json'));
        if (response.ok) { const pack = await response.json(); if (!this.disposed && pack.version === 1) this.catalog = pack; }
      } catch { /* An audio pack is optional in a fresh checkout. */ }
      if (this.disposed) return this.tracks;
      try {
        const db = await openDb();
        const records = await new Promise((resolve, reject) => {
          const request = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        for (const record of records) {
          if (!(record.blob instanceof Blob)) continue;
          if (slot(record.mode)) this.tracks[record.mode] = record;
          else if (['daily', 'investigation', 'trial'].includes(record.mode)) {
            // Keep 0.4.1 user imports accessible without assigning them to every game.
            const mode = `dr1:music:${record.mode}`;
            if (!records.some(r => r.mode === mode)) {
              this.tracks[mode] = {...record, mode, legacyMode: record.mode};
            }
          }
        }
        db.close();
      } catch { /* Music remains optional when storage is unavailable. */ }
      this.sync(); return this.tracks;
    }
    async setTrack(mode, file) {
      if (!slot(mode) || !(file instanceof Blob)) throw new Error('Выбери аудиофайл.');
      if (!file.type.startsWith('audio/') && !/\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|webm)$/i.test(file.name || '')) {
        throw new Error('Поддерживаются аудиофайлы MP3, OGG, WAV, M4A, AAC, FLAC и WebM.');
      }
      if (file.size > 100 * 1024 * 1024) throw new Error('Файл музыки должен быть меньше 100 МБ.');
      const record = {mode, name: file.name || 'Трек', blob: file};
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite'), items = tx.objectStore('tracks');
        items.put(record, mode);
        if (this.tracks[mode]?.legacyMode) items.delete(this.tracks[mode].legacyMode);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      }).finally(() => db.close());
      if (this.urls[mode]) URL.revokeObjectURL(this.urls[mode]);
      delete this.urls[mode];
      this.tracks[mode] = record;
      this.sync();
      return record.name;
    }
    async removeTrack(mode) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction('tracks', 'readwrite'), items = tx.objectStore('tracks');
        items.delete(mode);
        if (this.tracks[mode]?.legacyMode) items.delete(this.tracks[mode].legacyMode);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      }).finally(() => db.close());
      delete this.tracks[mode];
      if (this.urls[mode]) URL.revokeObjectURL(this.urls[mode]);
      delete this.urls[mode];
      this.sync();
    }
    context(state = {}) {
      const requested = state.audio || {};
      const inferred = [state.background, state.player?.id, ...(state.cast || []).map(c => c.id)]
        .map(id => String(id || '').split('.')[0]).find(game => ['dr1', 'dr2', 'drv3'].includes(game));
      this.game = ['dr1', 'dr2', 'drv3'].includes(requested.game) ? requested.game : inferred || 'dr1';
      this.mode = requested.music || state.mode || 'daily';
      this.ambienceCue = requested.ambience || 'none';
    }
    record(cue = this.mode, layer = 'music') {
      if (cue === 'none') return null;
      return this.tracks[`${this.game}:${layer}:${cue}`] || this.catalog?.games?.[this.game]?.[layer]?.[cue] || null;
    }
    configure(settings, active, state = {}) {
      this.settings = {...this.settings, ...settings}; this.active = active;
      if (typeof state === 'string') state = {mode: state};
      this.context(state); this.sync();
      if (!this.settings.sound || !this.active) this.stopEffects();
      else if (this.settings.textSound === false || this.settings.typingVolume === 0) this.stopTyping();
    }
    source(record) {
      if (!record) return '';
      if (record.blob) {
        if (!this.urls[record.mode]) this.urls[record.mode] = URL.createObjectURL(record.blob);
        return this.urls[record.mode];
      }
      return /^public\/assets\/audio\/local\/(dr1|dr2|drv3)\/[a-z0-9_-]+\.ogg$/.test(record.path) ? this.url(record.path) : '';
    }
    selectTrack(restart = false) {
      this.selectLayer(this.audio, this.record(), this.settings.musicVolume, restart);
      this.selectLayer(this.ambient, this.record(this.ambienceCue, 'ambience'), this.settings.ambientVolume ?? .25, restart);
    }
    selectLayer(media, record, volume, restart) {
      const src = this.source(record);
      if (!src) { media.pause(); media.removeAttribute('src'); media.dgpSource = ''; media.dgpRecord = null; return; }
      if (media.dgpSource !== src) { media.pause(); media.src = src; media.dgpSource = src; }
      media.dgpRecord = record;
      if (restart) media.currentTime = 0;
      media.volume = Math.min(1, Math.max(0, Number(volume) || 0));
      if (this.settings.sound && this.active) this.play(media);
      else media.pause();
    }
    play(media) {
      if (!media.paused || media.dgpPending || this.failed.has(media.dgpSource)) return;
      const requestedSource = media.dgpSource;
      media.dgpPending = true;
      Promise.resolve(media.play()).catch(error => {
        if (error?.name !== 'AbortError' && !this.disposed && requestedSource === media.dgpSource) {
          this.failed.add(requestedSource);
          this.onError?.('Звук не запустился. Нажми «Звук» для повторного запуска; проверь локальный аудиопак.');
        }
      }).finally(() => {
        media.dgpPending = false;
        if (this.disposed || !this.active || !this.settings.sound) media.pause();
        else if (media.dgpSource && requestedSource !== media.dgpSource) this.play(media);
      });
    }
    sync(restart = false) { if (!this.disposed) this.selectTrack(restart); }
    async unlock() {
      if (this.disposed) return false;
      this.failed.clear();
      // Invoked synchronously inside a user's click. Buttons themselves stay silent.
      this.settings.sound = true; this.sync();
      return true;
    }
    effect(cue, key = '') {
      if (cue === 'click' || this.disposed || !this.active || !this.settings.sound ||
          (cue === 'type' && (this.settings.textSound === false || this.settings.typingVolume === 0))) return;
      if (key) {
        if (this.seen.has(key)) return;
        this.seen.add(key);
        if (this.seen.size > 1000) this.seen.delete(this.seen.values().next().value);
      }
      const now = Date.now();
      if (cue === 'type' && now - this.lastTick < 75) return;
      if (cue === 'type') this.lastTick = now;
      const src = cue === 'type' ? this.tick.dgpSource : this.source(this.record(cue, 'effects'));
      if (!src) return;
      const media = cue === 'type' ? this.tick : this.fx;
      if (media.dgpSource !== src) { media.src = src; media.dgpSource = src; }
      media.currentTime = 0;
      media.volume = Math.min(1, Math.max(0, Number(cue === 'type' ? this.settings.typingVolume ?? .4 : this.settings.effectsVolume ?? .35)));
      this.play(media);
    }
    stopTyping() { this.tick.pause(); this.lastTick = 0; }
    stopEffects() { this.stopTyping(); this.fx.pause(); }
    stop() { this.audio.pause(); this.ambient.pause(); this.stopEffects(); }
    dispose() {
      this.disposed = true; this.active = false; this.stop();
      for (const media of [this.audio, this.ambient, this.tick, this.fx]) media.removeAttribute('src');
      for (const url of Object.values(this.urls)) URL.revokeObjectURL(url);
      this.urls = Object.create(null);
    }
  }
  globalThis.DGP.Sound = Sound;
})();
