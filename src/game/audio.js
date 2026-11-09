(() => {
  'use strict';
  const DB_NAME = 'dgp-local-soundtracks';
  const DB_VERSION = 1;
  const TRACKS = ['daily', 'investigation', 'trial'];
  const openDb = () => new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Локальное хранилище недоступно'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore('tracks');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Не удалось открыть хранилище музыки'));
  });
  class Sound {
    constructor() {
      this.settings = {sound: false, musicVolume: .25}; this.active = false; this.mode = 'daily';
      this.tracks = Object.create(null); this.urls = Object.create(null); this.disposed = false;
      this.audio = new Audio(); this.audio.loop = true; this.audio.preload = 'none';
      this.audio.addEventListener('error', () => this.onError?.('Браузер не смог открыть выбранный аудиофайл.'));
    }
    async load() {
      try {
        const db = await openDb();
        const records = await new Promise((resolve, reject) => {
          const request = db.transaction('tracks', 'readonly').objectStore('tracks').getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
        });
        for (const record of records) if (TRACKS.includes(record.mode) && record.blob instanceof Blob) this.tracks[record.mode] = record;
        db.close(); this.sync();
      } catch { /* Music remains optional when storage is unavailable. */ }
      return this.tracks;
    }
    async setTrack(mode, file) {
      if (!TRACKS.includes(mode) || !(file instanceof Blob)) throw new Error('Выбери аудиофайл.');
      if (!file.type.startsWith('audio/') && !/\.(mp3|ogg|oga|opus|wav|m4a|aac|flac|webm)$/i.test(file.name || '')) {
        throw new Error('Поддерживаются аудиофайлы MP3, OGG, WAV, M4A, AAC, FLAC и WebM.');
      }
      if (file.size > 100 * 1024 * 1024) throw new Error('Файл музыки должен быть меньше 100 МБ.');
      const record = {mode, name: file.name || 'Трек', blob: file};
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction('tracks', 'readwrite').objectStore('tracks').put(record, mode);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      }).finally(() => db.close());
      if (this.urls[mode]) URL.revokeObjectURL(this.urls[mode]);
      delete this.urls[mode];
      this.tracks[mode] = record;
      if (this.mode === mode) this.selectTrack(true);
      return record.name;
    }
    async removeTrack(mode) {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction('tracks', 'readwrite').objectStore('tracks').delete(mode);
        request.onsuccess = resolve; request.onerror = () => reject(request.error);
      }).finally(() => db.close());
      delete this.tracks[mode];
      if (this.urls[mode]) URL.revokeObjectURL(this.urls[mode]);
      delete this.urls[mode];
      if (this.mode === mode) { this.audio.pause(); this.audio.removeAttribute('src'); }
    }
    configure(settings, active, mode = this.mode) {
      this.settings = {...this.settings, ...settings}; this.active = active;
      const changed = mode !== this.mode; this.mode = mode;
      this.sync(changed);
    }
    selectTrack(restart = false) {
      const record = this.tracks[this.mode];
      if (!record) { this.audio.pause(); this.audio.removeAttribute('src'); return; }
      if (!this.urls[this.mode]) this.urls[this.mode] = URL.createObjectURL(record.blob);
      const src = this.urls[this.mode];
      if (this.audio.src !== src) this.audio.src = src;
      if (restart && this.settings.sound && this.active) this.audio.currentTime = 0;
      this.audio.volume = Math.min(1, Math.max(0, Number(this.settings.musicVolume) || 0));
      if (this.settings.sound && this.active) this.audio.play().catch(() => this.onError?.('Нажми «Музыка» ещё раз, чтобы разрешить воспроизведение.'));
      else this.audio.pause();
    }
    sync(restart = false) { if (!this.disposed) this.selectTrack(restart); }
    async unlock() {
      if (this.disposed) return false;
      if (!this.tracks[this.mode]) return false;
      this.audio.volume = Math.min(1, Math.max(0, Number(this.settings.musicVolume) || 0));
      try { await this.audio.play(); return !this.audio.paused; } catch { return false; }
    }
    effect() { /* No synthesized or typing effects; only user-selected music is played. */ }
    stop() { this.audio.pause(); }
    dispose() {
      this.disposed = true; this.active = false; this.audio.pause(); this.audio.removeAttribute('src');
      for (const url of Object.values(this.urls)) URL.revokeObjectURL(url);
      this.urls = Object.create(null);
    }
  }
  globalThis.DGP.Sound = Sound;
})();
