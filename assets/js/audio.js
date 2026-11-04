// All sound is synthesized with WebAudio: ambience, effects and a generative electro/techno soundtrack.
const hz = (n) => 440 * Math.pow(2, (n - 69) / 12);
// Music styles. chords: MIDI notes (two bars each); bass: per 16th step, 0 = rest, 1 = root, 8 = fifth,
// 13 = octave (semitones + 1); hat: level per step; arp: chord-tone index per step (-1 = rest); perc: tom pitch.
const STYLES = {
  // Dark and driving, A minor.
  storm: { bpm: 128, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],
    bass: [0, 0, 1, 1, 0, 0, 1, 13, 0, 0, 1, 1, 0, 0, 8, 1], hat: [0.6, 0.4, 1, 0.4, 0.6, 0.4, 1, 0.5, 0.6, 0.4, 1, 0.4, 0.6, 0.4, 1, 0.6],
    arp: [0, 1, 2, 4, 2, 1, 0, 1, 2, 4, 5, 4, 2, 1, 2, 4] },
  // Bright, bouncy house, F major.
  sunny: { bpm: 122, chords: [[65, 69, 72], [60, 64, 67], [62, 65, 69], [58, 62, 65]],
    bass: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 13, 1, 0], hat: [0.3, 0.6, 1, 0.6, 0.3, 0.6, 1, 0.6, 0.3, 0.6, 1, 0.6, 0.3, 0.6, 1, 0.8],
    arp: [0, -1, 2, 1, -1, 4, 2, -1, 0, -1, 2, 1, 4, -1, 5, 4] },
  // Tribal electro with toms, E minor.
  forest: { bpm: 118, chords: [[64, 67, 71], [57, 60, 64], [59, 62, 66], [64, 67, 71]],
    bass: [1, 0, 0, 8, 0, 0, 1, 0, 13, 0, 0, 1, 0, 0, 8, 0], hat: [0.5, 0, 0.8, 0.3, 0.5, 0, 0.8, 0.3, 0.5, 0, 0.8, 0.3, 0.5, 0.3, 0.8, 0.3],
    arp: [0, 2, 1, -1, 0, 2, 4, -1, 2, 1, 0, -1, 2, 4, 5, -1], perc: [0, 0, 0, 1.3, 0, 0, 0, 1, 0, 0, 1.2, 0, 0, 0.9, 0, 0] },
  // Volcano: heavy and fast, E minor with a dark flat second.
  volcano: { bpm: 132, chords: [[64, 67, 71], [65, 69, 72], [64, 67, 71], [62, 65, 69]],
    bass: [1, 1, 0, 1, 1, 0, 2, 0, 1, 1, 0, 1, 13, 0, 8, 0], hat: [0.8, 0.3, 0.6, 0.3, 0.8, 0.3, 0.6, 0.5, 0.8, 0.3, 0.6, 0.3, 0.8, 0.5, 0.6, 0.8],
    arp: [0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 5, 4, 2, 1], perc: [0, 0, 0, 0, 0, 0, 1.1, 0, 0, 0, 0, 0, 0.9, 0, 1.2, 0] },
  // City: synthwave at sunset, A minor, laid back.
  city: { bpm: 110, chords: [[57, 60, 64], [53, 57, 60], [55, 59, 62], [52, 55, 59]],
    bass: [1, 0, 13, 0, 1, 0, 13, 0, 1, 0, 13, 0, 1, 0, 8, 13], hat: [0.3, 0.2, 1, 0.2, 0.3, 0.2, 1, 0.2, 0.3, 0.2, 1, 0.2, 0.3, 0.2, 1, 0.4],
    arp: [0, 2, 4, 2, 1, 2, 4, 5, 0, 2, 4, 2, 1, 4, 5, 4] },
  // Waterfall: sunny tropical house, G major, with marimba-like toms.
  waterfall: { bpm: 116, chords: [[67, 71, 74], [64, 67, 71], [60, 64, 67], [62, 66, 69]],
    bass: [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 13, 8, 0], hat: [0.3, 0.5, 0.9, 0.5, 0.3, 0.5, 0.9, 0.5, 0.3, 0.5, 0.9, 0.5, 0.3, 0.6, 0.9, 0.7],
    arp: [0, 2, 4, 2, 1, 4, 5, -1, 0, 2, 4, 5, 4, 2, 1, -1], perc: [0, 0, 1.4, 0, 0, 1.2, 0, 0, 0, 0, 1.4, 0, 1.3, 0, 1.1, 0] },
  // Menu: mid-tempo and catchy, D minor.
  menu: { bpm: 124, chords: [[62, 65, 69], [58, 62, 65], [60, 64, 67], [57, 61, 64]],
    bass: [1, 0, 1, 0, 0, 13, 1, 0, 1, 0, 1, 0, 0, 8, 1, 0], hat: [0.4, 0.4, 1, 0.4, 0.4, 0.4, 1, 0.4, 0.4, 0.4, 1, 0.4, 0.4, 0.4, 1, 0.6],
    arp: [0, 1, 2, 1, 4, 2, 1, 2, 0, 1, 2, 4, 5, 4, 2, 1] },
};
export class Sound {
  constructor() {
    this.ctx = null;
    this.music = 0.5;
    this.sfx = 0.8;
  }

  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.comp = c.createDynamicsCompressor();
    this.comp.connect(c.destination);
    this.sfxG = this.gain(this.sfx, this.comp);
    this.musG = this.gain(this.music * 0.35, this.comp);
    this.ambG = this.gain(this.sfx * 0.9, this.comp);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // Rain: filtered noise bed. Wind: band-passed noise whose level follows altitude and gusts.
    this.rainG = this.gain(0.12, this.ambG);
    this.loop(this.chain(this.filter('highpass', 900), this.filter('lowpass', 7000), this.rainG));
    // Waterfall: a deep rushing roar plus a brighter hiss of spray.
    this.fallsG = this.gain(0, this.ambG);
    this.loop(this.chain(this.filter('lowpass', 650), this.gain(0.8, this.fallsG)), 0.9);
    this.loop(this.chain(this.filter('bandpass', 2400, 0.6), this.gain(0.25, this.fallsG)), 1.3);
    this.windF = this.filter('bandpass', 380, 0.7);
    this.windG = this.gain(0.06, this.ambG);
    this.loop(this.chain(this.windF, this.windG), 0.7);
    this.reelO = c.createOscillator();
    this.reelO.type = 'sawtooth';
    this.reelG = this.gain(0, this.sfxG);
    this.reelO.connect(this.chain(this.filter('lowpass', 900), this.reelG));
    this.reelO.start();
    this.startMusic();
  }

  setVolumes(music, sfx) {
    this.music = music; this.sfx = sfx;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.musG.gain.setTargetAtTime(music * 0.35, t, 0.1);
    this.sfxG.gain.setTargetAtTime(sfx, t, 0.1);
    this.ambG.gain.setTargetAtTime(sfx * 0.9, t, 0.1);
  }

  gain(v, to) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (to) g.connect(to);
    return g;
  }

  filter(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  }

  chain(...n) {
    for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]);
    return n[0];
  }

  loop(to, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    s.connect(to);
    s.start();
    return s;
  }

  burst(dur, to, delay = 0) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.connect(to);
    s.start(this.ctx.currentTime + delay, Math.random(), dur + 0.1);
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  tone(f0, f1, dur, type = 'sine', vol = 0.3, delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay, o = c.createOscillator(), g = this.gain(0, this.sfxG);
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(g);
    this.env(g, t, 0.01, vol, dur);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  noiseHit(type, f, dur, vol, delay = 0, q = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay, g = this.gain(0, this.sfxG);
    this.burst(dur, this.chain(this.filter(type, f, q), g), delay);
    this.env(g, t, 0.005, vol, dur);
  }

  jump() { this.tone(300, 640, 0.13, 'triangle', 0.22); }
  walljump() { this.tone(360, 820, 0.12, 'triangle', 0.24); this.noiseHit('highpass', 2200, 0.05, 0.16); }
  dash() { this.tone(900, 240, 0.16, 'sawtooth', 0.09); this.noiseHit('bandpass', 1600, 0.17, 0.3); }
  emote() { this.tone(660, 990, 0.09, 'triangle', 0.1); }
  land(v) { const k = Math.min(1, v / 22); this.tone(150, 50, 0.14, 'sine', 0.15 + k * 0.45); if (k > 0.5) this.noiseHit('lowpass', 500, 0.2, k * 0.4); }
  grab() { this.tone(880, 860, 0.06, 'square', 0.08); this.tone(1320, 1300, 0.08, 'square', 0.05, 0.02); this.noiseHit('highpass', 3000, 0.06, 0.2); }
  release() { this.tone(620, 380, 0.07, 'triangle', 0.12); }
  pad() { this.tone(180, 900, 0.3, 'sine', 0.35); this.tone(360, 1800, 0.25, 'triangle', 0.1); }
  sling() { if (!this.ctx) return; const t = this.ctx.currentTime, f = this.filter('bandpass', 400, 2), g = this.gain(0, this.sfxG); f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + 0.35); this.burst(0.4, this.chain(f, g)); this.env(g, t, 0.02, 0.6, 0.35); }
  zap() { this.tone(1800, 200, 0.25, 'sawtooth', 0.25); this.noiseHit('highpass', 2500, 0.3, 0.5); }
  slip() { this.tone(500, 180, 0.3, 'sawtooth', 0.12); }
  splash() { this.noiseHit('lowpass', 900, 1.0, 0.7); this.noiseHit('bandpass', 2400, 0.4, 0.25, 0.05); }
  ui() { this.tone(1100, 1250, 0.04, 'sine', 0.12); }
  shield() { this.tone(400, 900, 0.18, 'sine', 0.25); this.tone(800, 1800, 0.12, 'triangle', 0.08, 0.04); }
  block() { this.tone(1200, 600, 0.2, 'triangle', 0.25); this.noiseHit('highpass', 3500, 0.15, 0.25); }
  warn() { this.tone(1500, 1500, 0.07, 'square', 0.07); this.tone(1500, 1500, 0.07, 'square', 0.07, 0.12); }
  bonk() { this.tone(260, 90, 0.22, 'square', 0.18); this.noiseHit('lowpass', 700, 0.2, 0.35); }
  grapple() { this.tone(300, 1400, 0.25, 'sawtooth', 0.1); this.noiseHit('bandpass', 2000, 0.25, 0.2, 0, 3); }
  // Each kind of weapon has its own voice. Very fast guns only make every sound that has room.
  shoot(kind = 'pistol', vol = 1) {
    const now = performance.now();
    if (now - (this.shotLast || 0) < 42) return;
    this.shotLast = now;
    const v = vol, T = (a, b, d, t, q, w = 0) => this.tone(a, b, d, t, q * v, w), N = (t, f, d, q, w = 0) => this.noiseHit(t, f, d, q * v, w);
    switch (kind) {
      case 'smg': T(1400, 300, 0.05, 'square', 0.07); N('highpass', 3000, 0.04, 0.14); break;
      case 'silent': T(900, 260, 0.04, 'triangle', 0.08); N('bandpass', 2600, 0.03, 0.1); break;
      case 'magnum': T(620, 70, 0.22, 'sawtooth', 0.16); N('lowpass', 2400, 0.16, 0.32); break;
      case 'rifle': T(1000, 120, 0.09, 'sawtooth', 0.1); N('bandpass', 1800, 0.08, 0.24); break;
      case 'shotgun': T(260, 50, 0.26, 'sawtooth', 0.18); N('lowpass', 1700, 0.24, 0.5); break;
      case 'sniper': T(800, 45, 0.5, 'sawtooth', 0.18); N('lowpass', 3000, 0.28, 0.45); N('lowpass', 700, 0.5, 0.14, 0.14); break;
      case 'heavy': T(420, 70, 0.08, 'sawtooth', 0.11); N('lowpass', 1500, 0.07, 0.26); break;
      case 'boom': T(150, 40, 0.5, 'sawtooth', 0.2); N('lowpass', 900, 0.5, 0.55); N('highpass', 2600, 0.08, 0.14); break;
      case 'energy': T(1900, 500, 0.16, 'sine', 0.14); T(950, 240, 0.14, 'square', 0.05); N('highpass', 4200, 0.06, 0.08); break;
      case 'rail': T(240, 3000, 0.16, 'sawtooth', 0.09); T(2400, 90, 0.55, 'sawtooth', 0.14, 0.14); N('lowpass', 2600, 0.5, 0.4, 0.14); break;
      case 'thunder': T(1500, 90, 0.26, 'sawtooth', 0.15); N('highpass', 1800, 0.14, 0.3); N('lowpass', 500, 0.5, 0.42, 0.03); break;
      case 'void': T(90, 900, 0.3, 'sine', 0.2); T(1100, 40, 0.65, 'sawtooth', 0.14, 0.26); N('lowpass', 500, 0.7, 0.5, 0.26); break;
      default: T(1800, 220, 0.12, 'square', 0.12); N('highpass', 2500, 0.08, 0.2);
    }
  }
  door() { this.tone(120, 240, 0.6, 'sawtooth', 0.12); this.noiseHit('lowpass', 400, 0.6, 0.3); this.tone(880, 1320, 0.25, 'triangle', 0.15, 0.4); }
  stun() { [900, 700, 900, 700].forEach((f, i) => this.tone(f, f * 0.9, 0.08, 'triangle', 0.1, i * 0.07)); }
  crumble() { this.noiseHit('lowpass', 300, 0.6, 0.5); this.tone(90, 40, 0.5, 'sawtooth', 0.12); }
  // n: how many in quick succession; each one climbs a step.
  coin(n = 1) { const f = 988 * Math.pow(2, Math.min(n - 1, 12) / 12); this.tone(f, f, 0.05, 'square', 0.04); this.tone(f * 1.5, f * 1.5, 0.16, 'triangle', 0.1, 0.04); }
  relicHum() { [196, 294, 392].forEach((f, i) => this.tone(f, f * 1.01, 1.4, 'sine', 0.09, i * 0.14)); this.tone(1568, 1760, 0.8, 'sine', 0.03, 0.4); }
  relic() { [392, 523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, f, 0.9, 'triangle', 0.16, i * 0.08)); [131, 196].forEach((f) => this.tone(f, f, 2.4, 'sawtooth', 0.05)); }
  checkpoint() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.35, 'triangle', 0.18, i * 0.09)); }
  zone() { [131, 196, 262, 330].forEach((f) => this.tone(f, f * 1.01, 2.6, 'sawtooth', 0.05)); this.tone(523, 523, 1.6, 'triangle', 0.12, 0.3); }
  win() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, f, 0.8, 'triangle', 0.2, i * 0.12)); [262, 330, 392].forEach((f) => this.tone(f, f, 4, 'sawtooth', 0.06, 0.6)); }

  thunder(dist) {
    if (!this.ctx) return;
    const near = 1 - Math.min(1, dist / 160), delay = Math.min(2.5, dist / 120);
    const t = this.ctx.currentTime + delay, g = this.gain(0, this.ambG), f = this.filter('lowpass', 160 + near * 500);
    this.burst(3.5, this.chain(f, g), delay);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + near * 0.9, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.12 + near * 0.3, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    if (near > 0.6) this.noiseHit('highpass', 1800, 0.18, near * 0.6, delay);
  }

  // Continuous state: wind level (0..1+), reel hum and rain amount.
  ambient(wind, reeling, charge, rain, falls = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windG.gain.setTargetAtTime(0.04 + Math.min(1.2, wind) * 0.3, t, 0.25);
    this.windF.frequency.setTargetAtTime(300 + Math.min(1.2, wind) * 700, t, 0.3);
    this.reelG.gain.setTargetAtTime(reeling ? 0.05 + charge * 0.05 : 0, t, 0.05);
    this.reelO.frequency.setTargetAtTime(70 + charge * 160 + (reeling ? 20 : 0), t, 0.08);
    this.rainG.gain.setTargetAtTime(0.13 * rain, t, 0.5);
    this.fallsG.gain.setTargetAtTime(0.11 * falls, t, 0.6);
  }

  // ---------------------------------------------------------------- music
  // An original generative electro/techno track, synthesized live: four on the floor kick with sidechain
  // pumping, claps, hats, a rolling bass, an arpeggio with echo and pads. Each map has its own style
  // (tempo, key, chords, bass rhythm), the menu has one too. It builds in 8-bar sections and gets busier
  // the higher you climb (setIntensity).
  startMusic() {
    const c = this.ctx;
    this.bus = this.gain(1, this.musG);
    this.duck = this.gain(1, this.bus); // pads, bass and arp go through the sidechain duck
    const echo = c.createDelay(1);
    this.echo = echo;
    const fb = this.gain(0.33, echo), wet = this.gain(0.5, this.duck), echoLp = this.filter('lowpass', 2600);
    echo.connect(echoLp); echoLp.connect(fb); echoLp.connect(wet);
    this.mus = { style: 'menu', want: 'menu', intensity: 0.6, step: 0, bar: 0, next: c.currentTime + 0.15, S: STYLES.menu };
    echo.delayTime.value = (60 / this.mus.S.bpm) * 0.75;
    this.musTimer = setInterval(() => this.schedule(), 25);
  }

  setStyle(name) { if (this.mus && STYLES[name]) this.mus.want = name; }
  setIntensity(v) { if (this.mus) this.mus.intensity = Math.max(0, Math.min(1, v)); }

  schedule() {
    const c = this.ctx, m = this.mus;
    if (!c || c.state !== 'running') { if (m) m.next = Math.max(m.next, (c ? c.currentTime : 0) + 0.1); return; }
    while (m.next < c.currentTime + 0.14) {
      if (m.step === 0 && m.want !== m.style && m.bar % 4 === 0) {
        m.style = m.want; m.S = STYLES[m.style]; m.bar = 0;
        this.echo.delayTime.setValueAtTime((60 / m.S.bpm) * 0.75, m.next);
      }
      this.playStep(m.next, m.step, m.bar);
      m.next += 60 / m.S.bpm / 4;
      if (++m.step === 16) { m.step = 0; m.bar++; }
    }
  }

  playStep(t, i, bar) {
    const m = this.mus, S = m.S, I = m.intensity, sec = Math.floor(bar / 8) % 4; // 0 intro, 1 groove, 2 full, 3 breakdown
    const chord = S.chords[Math.floor(bar / 2) % S.chords.length], beat = 60 / S.bpm, six = beat / 4;
    const drums = sec !== 3, full = sec === 2 || (sec === 1 && I > 0.55);
    if (drums && i % 4 === 0) this.kick(t);
    if (drums && sec > 0 && (i === 4 || i === 12)) this.clap(t, 0.32);
    // A phone short of CPU time plays the same song with fewer notes on top: each note is work for it.
    const thin = !!this.thin;
    if (drums && S.hat[i] && (thin ? i % 2 === 0 : sec > 0 || i % 2 === 0)) this.hat(t, 0.045, S.hat[i] * (0.05 + I * 0.07));
    if (drums && full && !thin && i % 4 === 2) this.hat(t, 0.2, 0.06 + I * 0.05);
    if (S.perc && drums && !thin && S.perc[i] && I > 0.35) this.tom(t, S.perc[i]);
    // Bass: from the groove section on, following the chord root.
    if (sec >= 1 && sec !== 3 && S.bass[i]) this.bass(t, chord[0] - 24 + S.bass[i] - 1, six * 0.9);
    // Arp: chord tones going up and down, busier with height; in the breakdown it carries the tune.
    if ((sec >= 2 || sec === 3 || I > 0.7) && S.arp[i] >= 0 && (thin ? sec === 3 && i % 2 === 0 : sec === 3 || i % (I > 0.5 ? 1 : 2) === 0)) {
      const n = chord[S.arp[i] % chord.length] + 12 * (1 + Math.floor(S.arp[i] / chord.length));
      this.pluck(t, n, six * 1.6, 0.05 + I * 0.03);
    }
    // Pads: a long chord every two bars.
    if (i === 0 && bar % 2 === 0) this.musicPad(t, chord, beat * 8, sec === 3 ? 0.09 : 0.05);
  }

  kick(t) {
    const c = this.ctx, o = c.createOscillator(), g = this.gain(0, this.bus);
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    o.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.95, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.start(t); o.stop(t + 0.4);
    // Sidechain pump on everything melodic.
    this.duck.gain.setValueAtTime(0.35, t);
    this.duck.gain.linearRampToValueAtTime(1, t + 0.22);
  }

  clap(t, v) {
    const g = this.gain(0, this.bus), f = this.filter('bandpass', 1400, 1.2);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.connect(f); f.connect(g);
    g.gain.setValueAtTime(0.0001, t);
    for (const d of [0, 0.011, 0.023]) { g.gain.setValueAtTime(v, t + d); g.gain.exponentialRampToValueAtTime(v * 0.3, t + d + 0.009); }
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.start(t, Math.random()); src.stop(t + 0.25);
  }

  hat(t, dec, v) {
    const src = this.ctx.createBufferSource(), f = this.filter('highpass', 7500), g = this.gain(0, this.bus);
    src.buffer = this.noise;
    src.connect(f); f.connect(g);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    src.start(t, Math.random()); src.stop(t + dec + 0.02);
  }

  tom(t, pitch) {
    const o = this.ctx.createOscillator(), g = this.gain(0, this.bus);
    o.frequency.setValueAtTime(120 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(70 * pitch, t + 0.15);
    o.connect(g);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.start(t); o.stop(t + 0.22);
  }

  bass(t, n, dur) {
    const c = this.ctx, f = this.filter('lowpass', 300, 6), g = this.gain(0, this.duck);
    f.connect(g);
    for (const [type, det, k] of [['sawtooth', 0, 1], ['square', -1200, 0.6]]) {
      const o = c.createOscillator();
      o.type = type; o.frequency.value = hz(n); o.detune.value = det;
      const og = this.gain(k * 0.5, f);
      o.connect(og);
      o.start(t); o.stop(t + dur + 0.05);
    }
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(900 + this.mus.intensity * 900, t + 0.02);
    f.frequency.exponentialRampToValueAtTime(240, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  pluck(t, n, dur, v) {
    const c = this.ctx, o = c.createOscillator(), f = this.filter('lowpass', 3000, 2), g = this.gain(0, this.duck), send = this.gain(0.6, this.echo);
    o.type = 'square'; o.frequency.value = hz(n);
    o.connect(f); f.connect(g); g.connect(send);
    f.frequency.setValueAtTime(4200, t);
    f.frequency.exponentialRampToValueAtTime(700, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  musicPad(t, chord, dur, v) {
    const c = this.ctx, f = this.filter('lowpass', 900, 0.7), g = this.gain(0, this.duck);
    f.connect(g);
    f.frequency.setValueAtTime(500, t);
    f.frequency.linearRampToValueAtTime(1600, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(600, t + dur);
    for (const n of chord) for (const det of [-9, 9]) {
      const o = c.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = hz(n); o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 0.6);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + dur * 0.3);
    g.gain.setValueAtTime(v, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
  }

  suspend(on) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend(); else this.ctx.resume();
  }
}
