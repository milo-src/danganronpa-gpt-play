(() => {
  'use strict';
  const themes = {
    daily: {beat: .48, bass: [48, 53, 50, 55], notes: [72, 76, 79, 76, 74, 77, 81, 77, 74, 77, 81, 84, 79, 77, 74, 71]},
    investigation: {beat: .65, bass: [45, 45, 41, 43], notes: [69, 0, 72, 71, 0, 64, 0, 67, 65, 0, 69, 0, 67, 0, 71, 0]},
    trial: {beat: .25, bass: [45, 41, 48, 43], notes: [69, 76, 72, 76, 69, 76, 72, 79, 65, 72, 69, 72, 67, 74, 71, 74]}
  };
  class Sound {
    constructor() { this.settings = {sound: false, musicVolume: .18, effectsVolume: .3}; this.active = false; this.mode = 'daily'; this.step = 0; this.nodes = new Set(); }
    async unlock() {
      if (this.disposed) return false;
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return false;
      try {
        if (!this.context) {
          this.context = new Audio(); this.music = this.context.createGain(); this.effects = this.context.createGain();
          this.music.connect(this.context.destination); this.effects.connect(this.context.destination);
        }
        await this.context.resume();
        if (this.disposed) return false;
        this.sync(); return this.context.state === 'running';
      } catch { return false; }
    }
    configure(settings, active, mode = this.mode) {
      this.settings = {...this.settings, ...settings}; this.active = active;
      if (mode !== this.mode) { this.mode = mode; this.step = 0; this.stop(); }
      this.sync();
    }
    sync() {
      if (!this.context || this.disposed) return;
      const audible = this.settings.sound && this.active;
      this.music.gain.setTargetAtTime(audible ? Math.min(.5, Math.max(0, this.settings.musicVolume)) : 0, this.context.currentTime, .08);
      this.effects.gain.setTargetAtTime(audible ? Math.min(.7, Math.max(0, this.settings.effectsVolume)) : 0, this.context.currentTime, .03);
      if (!audible || this.context.state !== 'running') { this.stop(); return; }
      if (!this.timer) this.tick();
    }
    tone(note, duration, gain, bus = this.music, type = 'sine') {
      if (!this.context || !note || !bus) return;
      const now = this.context.currentTime, oscillator = this.context.createOscillator(), envelope = this.context.createGain();
      oscillator.type = type; oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
      envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(gain, now + .015);
      envelope.gain.exponentialRampToValueAtTime(.0001, now + duration);
      oscillator.connect(envelope); envelope.connect(bus); this.nodes.add(oscillator);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); this.nodes.delete(oscillator); };
      oscillator.start(); oscillator.stop(now + duration + .02);
    }
    tick() {
      if (this.disposed || !this.active || !this.settings.sound) { this.stop(); return; }
      const t = themes[this.mode] || themes.daily;
      if (this.settings.musicVolume > 0) {
        this.tone(t.notes[this.step % 16], t.beat * 1.4, .16);
        if (this.step % 4 === 0) this.tone(t.bass[Math.floor(this.step / 4) % 4], t.beat * 3.6, .22, this.music, 'triangle');
        if (this.mode === 'trial' && this.step % 2 === 0) this.tone(33, .09, .16);
      }
      this.step++; this.timer = setTimeout(() => { this.timer = null; this.tick(); }, t.beat * 1000);
    }
    effect(kind) {
      if (!this.context || this.context.state !== 'running' || !this.active || !this.settings.sound) return;
      const now = this.context.currentTime;
      if (kind === 'type' && now - (this.lastType || 0) < .075) return;
      if (kind === 'type') this.lastType = now;
      const sounds = {type: [84, .025, .025], click: [79, .08, .12], evidence: [88, .45, .14], objection: [45, .55, .24]};
      const [note, duration, gain] = sounds[kind] || sounds.click;
      this.tone(note, duration, gain, this.effects, kind === 'objection' ? 'sawtooth' : 'sine');
      if (kind === 'evidence') this.tone(95, .7, .09, this.effects);
    }
    stop() { clearTimeout(this.timer); this.timer = null; for (const node of this.nodes) { try { node.stop(); } catch {} } this.nodes.clear(); }
    dispose() { this.disposed = true; this.active = false; this.stop(); this.context?.close().catch(() => {}); }
  }
  globalThis.DGP.Sound = Sound;
})();
