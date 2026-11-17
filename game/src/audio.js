// Starlight Diner — synthesized sound. No audio files: every effect is
// built from WebAudio oscillators, and the ambient pad is two detuned
// triangle waves through a slow LFO. Audio starts on the first user
// gesture (title click / key), so autoplay policies never block it.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.padNodes = null;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.startPad();
    } catch { this.ctx = null; }
  }

  setMuted(m) {
    this.muted = m;
    if (this.padNodes) this.padNodes.gain.gain.value = m ? 0 : 0.05;
  }

  tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }

  click()  { this.tone(660, 0.06, 'triangle', 0.10); }
  cook()   { this.tone(520, 0.07, 'triangle', 0.10); this.tone(780, 0.07, 'triangle', 0.08, 0.06); }
  ready()  { this.tone(880, 0.09, 'sine', 0.12); this.tone(1318, 0.12, 'sine', 0.10, 0.08); }
  serve()  { this.tone(988, 0.08, 'triangle', 0.14); this.tone(1319, 0.14, 'triangle', 0.12, 0.07); }
  coin()   { this.tone(1568, 0.10, 'square', 0.05); this.tone(2093, 0.16, 'square', 0.04, 0.06); }
  angry()  { this.tone(220, 0.25, 'sawtooth', 0.10, 0, 110); }
  strike() { this.tone(180, 0.3, 'sawtooth', 0.12, 0, 90); this.tone(140, 0.35, 'sawtooth', 0.10, 0.15, 70); }
  win()    { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.13, i * 0.11)); }
  lose()   { [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.11, i * 0.13)); }
  rush()   { this.tone(440, 0.1, 'square', 0.07); this.tone(587, 0.1, 'square', 0.07, 0.09); this.tone(880, 0.16, 'square', 0.07, 0.18); }

  startPad() {
    if (!this.ctx) return;
    const g = this.ctx.createGain();
    g.gain.value = this.muted ? 0 : 0.05;
    g.connect(this.ctx.destination);
    const o1 = this.ctx.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 110;
    const o2 = this.ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 164.81;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 0.02;
    lfo.connect(lfoGain).connect(g.gain);
    o1.connect(g); o2.connect(g);
    o1.start(); o2.start(); lfo.start();
    this.padNodes = { gain: g };
  }
}
