// All sounds are synthesised with WebAudio: no audio files to download.
export type SfxName = 'hit' | 'push' | 'pass' | 'catch' | 'bounce' | 'whistle' | 'buzzer' | 'goal' | 'hype' | 'steal';

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowdGain!: GainNode;
  private noise!: AudioBuffer;
  private crowdLevel = 0.12;
  muted = false;

  /** Browsers only allow audio after a user gesture. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(ctx.destination);
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // Crowd bed: looping band-passed noise whose volume follows the action.
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    this.crowdGain = ctx.createGain(); this.crowdGain.gain.value = 0;
    src.connect(bp).connect(this.crowdGain).connect(this.master); src.start();
  }

  setMuted(m: boolean) { this.muted = m; if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05); }
  /** 0..1 crowd excitement, eased. */
  crowd(level: number) {
    if (!this.ctx) return;
    this.crowdLevel += (level - this.crowdLevel) * 0.05;
    this.crowdGain.gain.setTargetAtTime(0.04 + this.crowdLevel * 0.22, this.ctx.currentTime, 0.1);
  }

  play(name: SfxName, v = 1) {
    const ctx = this.ctx; if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    switch (name) {
      case 'hit': { // metal crunch: noise burst + low thump, scaled by impact
        const k = Math.min(1, v / 7);
        this.burst(t, 0.12 + k * 0.15, 0.15 + k * 0.5, 'highpass', 700, 1);
        this.tone(t, 'sine', 120 - k * 50, 45, 0.18, 0.3 + k * 0.5);
        if (k > 0.6) this.tone(t, 'square', 1800, 900, 0.08, 0.06); // clang
        break;
      }
      case 'push': this.burst(t, 0.12, 0.08 * v, 'bandpass', 400, 2); break;
      case 'pass': this.burst(t, 0.15, 0.14, 'bandpass', 2400, 3, 600); break;
      case 'catch': this.tone(t, 'triangle', 500, 380, 0.06, 0.18); break;
      case 'steal': this.tone(t, 'square', 660, 990, 0.12, 0.12); break;
      case 'bounce': this.tone(t, 'sine', 180, 90, 0.12, 0.35); this.burst(t, 0.05, 0.12, 'lowpass', 600, 1); break;
      case 'whistle': {
        for (const [f, d] of [[2900, 0], [3100, 0]] as const) {
          const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
          o.type = 'sine'; o.frequency.value = f; lfo.frequency.value = 28; lg.gain.value = 120;
          lfo.connect(lg).connect(o.frequency);
          g.gain.setValueAtTime(0, t + d); g.gain.linearRampToValueAtTime(0.12, t + d + 0.02);
          g.gain.setValueAtTime(0.12, t + 0.38); g.gain.linearRampToValueAtTime(0, t + 0.45);
          o.connect(g).connect(this.master); o.start(t); lfo.start(t); o.stop(t + 0.5); lfo.stop(t + 0.5);
        }
        break;
      }
      case 'buzzer': this.tone(t, 'sawtooth', 220, 210, 1.0, 0.2); this.tone(t, 'sawtooth', 223, 213, 1.0, 0.15); break;
      case 'goal': {
        // Air horn chord + crowd roar swell
        for (const f of [233, 294, 349]) this.tone(t, 'sawtooth', f, f, 0.9, 0.09);
        this.burst(t, 2.2, 0.5, 'bandpass', 1000, 0.5, 0, 0.4);
        break;
      }
      case 'hype': for (let i = 0; i < 4; i++) this.tone(t + i * 0.07, 'square', 440 * 2 ** (i / 3), 440 * 2 ** (i / 3), 0.09, 0.1); break;
    }
  }

  private tone(t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number) {
    const ctx = this.ctx!, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
  private burst(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q: number, sweepTo = 0, attack = 0.005) {
    const ctx = this.ctx!, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.noise; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
}
