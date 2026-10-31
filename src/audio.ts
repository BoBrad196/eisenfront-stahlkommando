// Ton und Musik. Geräusche kommen als Dateien aus assets/manifest.json ("audio"), Musik entweder
// aus eigenen Stücken ("music") oder wird live im Browser erzeugt (ruhig im Frieden, treibend im Kampf).
// Browser erlauben Ton erst nach der ersten Benutzeraktion – bis dahin bleibt alles stumm.

import { AmbientSound } from './ambience';

const SETTINGS_KEY = 'imperium-europa-ton';
/** Grundlautstärke je Geräusch (Rechteck-Töne sind von Natur aus laut) */
const BASE_VOLUME: Record<string, number> = {
  'ui.alarm': 0.45, 'ui.warnung': 0.4, 'ui.einheit': 0.5, 'ui.klick': 0.35, 'ui.bestaetigung': 0.5, 'ui.erfolg': 0.6, 'ui.forschung': 0.55,
  'sfx.gewehr': 0.4, 'sfx.mg': 0.4, 'sfx.pak': 0.6, 'sfx.kanone': 0.75, 'sfx.artillerie': 0.8, 'sfx.granate': 0.6, 'sfx.schiff': 0.85,
  'amb.vogel': 0.5, 'amb.vogel.meise': 0.4, 'amb.vogel.fink': 0.4, 'amb.kraehe': 0.45, 'amb.kuckuck': 0.45, 'amb.kuh': 0.55, 'amb.pferd': 0.5,
  'amb.schnauben': 0.5, 'amb.hahn': 0.4, 'amb.hund': 0.45, 'amb.glocke': 0.5,
  'sfx.flak': 0.55, 'sfx.stuka': 0.5, 'sfx.explosion': 0.85, 'sfx.knacken': 0.55, 'sfx.schutt': 0.5, 'sfx.bauen': 0.55,
};
/** Mindestabstand (ms) zwischen zwei gleichen Geräuschen, damit Gefechte nicht übersteuern */
const MIN_GAP: Record<string, number> = {
  'sfx.knacken': 120, 'sfx.schutt': 200, 'sfx.gewehr': 45, 'sfx.mg': 90, 'sfx.pak': 80, 'sfx.kanone': 110, 'sfx.artillerie': 140, 'sfx.granate': 100,
  'sfx.schiff': 200, 'sfx.flak': 90, 'sfx.stuka': 500, 'sfx.explosion': 110, 'sfx.bauen': 300, 'ui.klick': 30, 'funk.feind': 6000,
};
const MAX_VOICES = 8;   // gleichzeitige Stimmen je Geräusch
const MAX_TOTAL = 28;   // insgesamt (Schlachten sollen nicht zu Brei werden)

export interface SoundSettings { on: boolean; music: number; sfx: number; amb: number }

class AudioEngine {
  settings: SoundSettings = { on: true, music: 0.5, sfx: 0.8, amb: 0.7 };
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private ambBus!: GainNode;
  /** Klangkulisse der Detailkarte (Wind, Vögel, Tiere …); erst nach dem Entsperren des Tons vorhanden */
  ambience: AmbientSound | null = null;
  private files: Record<string, string> = {};
  private musicFiles: string[] = [];
  /** Musikstücke für Szenen (Hauptmenü, Gefecht, Sieg, Niederlage) */
  private tracks: Record<string, string> = {};
  private trackEls = new Map<string, { el: HTMLAudioElement; gain: GainNode }>();
  private trackKey: string | null = null;
  private scene = 'menu';
  private procBus: GainNode | null = null;
  private raw = new Map<string, ArrayBuffer>();
  private buffers = new Map<string, AudioBuffer>();
  private lastPlay = new Map<string, number>();
  private voices = new Map<string, number>();
  private total = 0;
  /** Grundschlüssel -> Varianten ("sfx.gewehr", "sfx.gewehr.v2" …), zufällig gewählt */
  private variants = new Map<string, string[]>();
  private music: ProceduralMusic | null = null;
  private musicEl: HTMLAudioElement | null = null;
  private combat = 0;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
      if (s) this.settings = { ...this.settings, ...s };
    } catch { /* Speicher gesperrt – Standardwerte */ }
  }

  /** Dateiliste aus dem Manifest übernehmen und schon einmal herunterladen */
  async load() {
    try {
      const m = await (await fetch('manifest.json', { cache: 'no-cache' })).json();
      this.files = m.audio ?? {};
      this.musicFiles = (m.music ?? []).filter(Boolean);
      this.tracks = m.tracks ?? {};
      for (const key of Object.keys(this.files)) {
        const base = key.replace(/\.v\d+$/, '');
        const list = this.variants.get(base) ?? [];
        list.push(key);
        this.variants.set(base, list);
      }
    } catch { return; }
    await Promise.all(Object.entries(this.files).map(async ([key, file]) => {
      try { this.raw.set(key, await (await fetch(file)).arrayBuffer()); } catch { /* fehlende Datei: Geräusch bleibt stumm */ }
    }));
    // Ton freischalten, sobald der Spieler das erste Mal klickt oder eine Taste drückt
    const unlock = () => { this.unlock(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private unlock() {
    if (this.ctx) return;
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    // Begrenzer: viele gleichzeitige Explosionen sollen nicht übersteuern
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.22;
    this.master.connect(comp).connect(this.ctx.destination);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    this.ambBus = this.ctx.createGain();
    this.ambBus.connect(this.master);
    this.applySettings();
    for (const [key, data] of this.raw) {
      this.ctx.decodeAudioData(data.slice(0)).then((b) => this.buffers.set(key, b)).catch(() => {});
    }
    this.ambience = new AmbientSound({
      ctx: this.ctx, bus: this.ambBus,
      buffer: (k) => this.buffers.get(k),
      play: (k, o) => this.play(k, o),
    });
    this.startMusic();
  }

  private startMusic() {
    if (!this.ctx) return;
    if (this.musicFiles.length) {
      // Eigene Musikstücke nacheinander abspielen
      let i = 0;
      const el = new Audio();
      el.src = this.musicFiles[0];
      el.onended = () => { i = (i + 1) % this.musicFiles.length; el.src = this.musicFiles[i]; el.play().catch(() => {}); };
      const src = this.ctx.createMediaElementSource(el);
      src.connect(this.musicBus);
      el.play().catch(() => {});
      this.musicEl = el;
    } else {
      this.procBus = this.ctx.createGain();
      this.procBus.connect(this.musicBus);
      this.music = new ProceduralMusic(this.ctx, this.procBus);
      this.music.start();
    }
  }

  /** Szene wählen: menu, spiel, sieg, niederlage. Die Musik wechselt beim nächsten Aufruf von update() */
  setScene(scene: string) { this.scene = scene; }

  /** Ein Musikstück auf- bzw. abblenden; null = erzeugte Musik */
  private setTrack(key: string | null) {
    if (!this.ctx || key === this.trackKey) return;
    const now = this.ctx.currentTime;
    const old = this.trackKey ? this.trackEls.get(this.trackKey) : undefined;
    if (old) {
      old.gain.gain.setTargetAtTime(0, now, 0.8);
      const el = old.el, prev = this.trackKey;
      setTimeout(() => { if (this.trackKey !== prev) el.pause(); }, 3000);
    }
    this.trackKey = key;
    if (key && this.tracks[key]) {
      let t = this.trackEls.get(key);
      if (!t) {
        const el = new Audio(this.tracks[key]);
        el.loop = key === 'menu' || key === 'kampf';
        const gain = this.ctx.createGain(); gain.gain.value = 0;
        this.ctx.createMediaElementSource(el).connect(gain).connect(this.musicBus);
        t = { el, gain };
        this.trackEls.set(key, t);
      }
      t.el.currentTime = 0;
      t.gain.gain.setTargetAtTime(1, now, 0.8);
      t.el.play().catch(() => {});
    }
    // erzeugte Musik leiser, solange ein Stück läuft
    this.procBus?.gain.setTargetAtTime(key && this.tracks[key] ? 0 : 1, now, 0.8);
  }

  setSettings(s: Partial<SoundSettings>) {
    this.settings = { ...this.settings, ...s };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch { /* egal */ }
    this.applySettings();
  }
  private applySettings() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.on ? 1 : 0, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.1);
    this.ambBus.gain.setTargetAtTime(this.settings.amb, t, 0.1);
    // Eigene Musikstücke bei ausgeschaltetem Ton anhalten statt stumm weiterlaufen lassen
    if (this.musicEl) { if (this.settings.on && this.settings.music > 0) this.musicEl.play().catch(() => {}); else this.musicEl.pause(); }
  }

  /** Geräusch abspielen. volume 0..1, pan -1 (links) .. 1 (rechts), far 0..1 = Entfernung (dumpfer, leiser Klang) */
  play(key: string, opts: { volume?: number; pan?: number; pitch?: number; far?: number } = {}) {
    if (!this.ctx || !this.settings.on) return;
    const variants = this.variants.get(key);
    const pick = variants && variants.length > 1 ? variants[Math.floor(Math.random() * variants.length)] : key;
    const buf = this.buffers.get(pick) ?? this.buffers.get(key);
    if (!buf) return;
    const now = performance.now();
    if (now - (this.lastPlay.get(key) ?? 0) < (MIN_GAP[key] ?? 40)) return;
    if ((this.voices.get(key) ?? 0) >= MAX_VOICES || this.total >= MAX_TOTAL) return;
    this.lastPlay.set(key, now);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.pitch ?? 1) * (key.startsWith('sfx.') ? 0.94 + Math.random() * 0.12 : 1);
    const bus = key.startsWith('amb.') ? this.ambBus : this.sfxBus;
    const gain = this.ctx.createGain();
    gain.gain.value = (opts.volume ?? 1) * (BASE_VOLUME[key] ?? 0.8);
    let node: AudioNode = src.connect(gain);
    const far = Math.max(0, Math.min(1, opts.far ?? 0));
    if (far > 0.05) {
      // Weit entfernte Geräusche klingen dumpf: Höhen verschwinden
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 9000 * Math.pow(0.07, far); f.Q.value = 0.3;
      node = node.connect(f);
    }
    const panner = this.ctx.createStereoPanner?.();
    if (panner) {
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan ?? 0));
      node.connect(panner).connect(bus);
    } else node.connect(bus);
    this.voices.set(key, (this.voices.get(key) ?? 0) + 1);
    this.total++;
    src.onended = () => { this.voices.set(key, Math.max(0, (this.voices.get(key) ?? 1) - 1)); this.total = Math.max(0, this.total - 1); };
    src.start();
  }

  /** Kampfgeschehen melden – die Musik wird für einige Sekunden intensiver */
  combatPulse() { this.combat = performance.now(); }
  /** Regelmäßig aufrufen: Musikstimmung nachführen */
  update() {
    this.music?.setIntensity(performance.now() - this.combat < 9000 ? 1 : 0);
    // Szene -> Stück: Menü, Gefecht (bei Kampfgeschehen), Ende; sonst erzeugte Musik
    if (this.scene === 'menu' || this.scene === 'sieg' || this.scene === 'niederlage') this.setTrack(this.scene);
    else this.setTrack(this.combatLevel() > 0.35 ? 'kampf' : null);
    this.ambience?.idle(performance.now());
  }
  /** Anteil 0..1: wie frisch das letzte Kampfgeschehen ist (Vögel und Tiere verstummen) */
  combatLevel() { return Math.max(0, Math.min(1, 1 - (performance.now() - this.combat - 2500) / 7000)); }
}

// ---------- Musik-Generator ----------
// Dunkle, langsame Musik in d-Moll (Dm – B – Gm – A): ein Streicherteppich aus verstimmten Sägezähnen,
// tiefe Celli, vereinzelte Glockentöne und fernes Paukengrollen, alles in einem großen Hallraum.
// Im Gefecht kommen Pauken, Marschtrommel, Blechstöße und ein treibendes Cello-Ostinato dazu.
const ROOT = 146.83; // d
const CHORDS = [[0, 3, 7], [-4, 0, 3], [-7, -4, 0], [-5, -1, 2]]; // Halbtöne relativ zu d (Dm, B, Gm, A-Dur)
const SCALE = [0, 2, 3, 5, 7, 8, 10]; // d-Moll natürlich
const SNARE = 'x..x.x..x..x.xxx';
const semi = (n: number) => ROOT * Math.pow(2, n / 12);

export class ProceduralMusic {
  private next = 0;
  private stepIdx = 0;
  private timer = 0;
  private intensity = 0;
  private calmBus: GainNode;
  private battleBus: GainNode;
  private noiseBuf: AudioBuffer;
  private readonly bpm = 66;
  private lastNote = 7;

  constructor(private ctx: AudioContext, out: GainNode) {
    // Hallraum: abklingendes, nach oben gedämpftes Stereorauschen (ca. 3,2 s)
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        lp += ((Math.random() * 2 - 1) - lp) * Math.max(0.08, 0.6 - t * 0.2); // wird mit der Zeit dumpfer
        d[i] = lp * Math.exp(-t * 1.7) * (i < 400 ? i / 400 : 1);
      }
    }
    verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.9;
    verb.connect(wet).connect(out);
    const mk = (send: number) => {
      const g = ctx.createGain();
      g.connect(out);
      const s = ctx.createGain(); s.gain.value = send;
      g.connect(s).connect(verb);
      return g;
    };
    this.calmBus = mk(0.55);
    this.battleBus = mk(0.3);
    this.battleBus.gain.value = 0;
    const nl = ctx.sampleRate * 0.6;
    this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) d[i] = Math.random() * 2 - 1;
  }

  start() {
    this.next = this.ctx.currentTime + 0.2;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }
  setIntensity(v: number) {
    if (v === this.intensity) return;
    this.intensity = v;
    const t = this.ctx.currentTime;
    this.battleBus.gain.setTargetAtTime(v ? 1 : 0, t, 1.4);
    this.calmBus.gain.setTargetAtTime(v ? 0.75 : 1, t, 1.4);
  }

  private schedule() {
    const sixteenth = 60 / this.bpm / 4;
    while (this.next < this.ctx.currentTime + 0.4) {
      this.step(this.stepIdx, this.next, sixteenth);
      this.next += sixteenth;
      this.stepIdx++;
    }
  }

  private step(i: number, t: number, s16: number) {
    const bar = Math.floor(i / 16), pos = i % 16;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const beat = s16 * 4;
    // ruhig: Streicherteppich über zwei Takte, Cello auf der Eins, Glockentöne, fernes Grollen
    if (pos === 0 && bar % 2 === 0) {
      for (const n of chord) this.strings(semi(n), t, beat * 8.5);
      this.strings(semi(chord[0] - 12), t, beat * 8.5, 0.5);
    }
    if (pos === 0) this.cello(semi(chord[0] - 12), t, beat * 3.2, 0.5);
    if (pos === 8 && bar % 2 === 1) this.cello(semi(chord[2] - 12), t, beat * 1.8, 0.3);
    if (pos === 0 && bar % 4 === 0) this.timpani(t, 0.28, this.calmBus);
    if ((pos === 2 || pos === 6 || pos === 10) && Math.random() < (pos === 2 ? 0.55 : 0.22)) this.bell(t, chord);
    // Gefecht: Pauken auf 1 und 3, Marschtrommel, Blechstöße, Cello-Ostinato
    if (pos === 0 || pos === 8) this.timpani(t, 0.55, this.battleBus);
    if (SNARE[pos] === 'x') this.snare(t, pos % 4 === 0 ? 0.32 : 0.16);
    if (pos === 0) this.brass(semi(chord[0] - 12), t, beat * 1.6);
    if (pos === 8) this.brass(semi(chord[2] - 12), t, beat * 1.2);
    if (pos % 2 === 0) this.ostinato(semi((pos % 8 === 4 ? chord[2] : chord[0]) - 12), t, s16 * 1.7);
  }

  private env(g: GainNode, t: number, peak: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  private voice(type: OscillatorType, freq: number, detune: number, t: number, dur: number, peak: number, attack: number, bus: GainNode, cutoff: number) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.detune.value = detune;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 0.5;
    const g = this.ctx.createGain();
    this.env(g, t, peak, attack, dur);
    o.connect(f).connect(g).connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  /** Streicher: drei verstimmte Sägezähne, langsam anschwellend, mit leichtem Vibrato */
  private strings(f: number, t: number, dur: number, k = 1) {
    for (const det of [-9, 0, 9]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 4.6 + Math.random() * 0.6;
      const lg = this.ctx.createGain(); lg.gain.value = 5;
      lfo.connect(lg).connect(o.detune);
      const flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 520 + f * 1.4; flt.Q.value = 0.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.022 * k, t + dur * 0.28);
      g.gain.setValueAtTime(0.022 * k, t + dur * 0.62);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(flt).connect(g).connect(this.calmBus);
      o.start(t); o.stop(t + dur + 0.05); lfo.start(t); lfo.stop(t + dur + 0.05);
    }
  }
  private cello(f: number, t: number, dur: number, peak: number) {
    this.voice('sawtooth', f, 0, t, dur, 0.05 * peak, 0.18, this.calmBus, 340);
    this.voice('triangle', f, 4, t, dur, 0.06 * peak, 0.2, this.calmBus, 600);
  }
  /** Glockenartiger Einzelton aus der Moll-Tonleiter, bevorzugt in kleinen Schritten von der letzten Note */
  private bell(t: number, chord: number[]) {
    const step = [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)];
    const idx = Math.max(0, Math.min(SCALE.length * 2 - 1, this.lastNote + step));
    const near = Math.random() < 0.4 ? chord[Math.floor(Math.random() * 3)] + 12 : SCALE[idx % SCALE.length] + 12 * Math.floor(idx / SCALE.length);
    this.lastNote = idx;
    const f = semi(near + 12);
    const g = this.ctx.createGain();
    this.env(g, t, 0.05, 0.004, 2.4);
    const o1 = this.ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01;
    const g2 = this.ctx.createGain(); g2.gain.value = 0.25;
    o1.connect(g); o2.connect(g2).connect(g);
    g.connect(this.calmBus);
    o1.start(t); o1.stop(t + 2.5); o2.start(t); o2.stop(t + 2.5);
  }
  private timpani(t: number, peak: number, bus: GainNode) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(96, t);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g).connect(bus);
    o.start(t); o.stop(t + 0.95);
    // Fellanschlag
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 240;
    const gn = this.ctx.createGain();
    gn.gain.setValueAtTime(peak * 0.6, t);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    n.connect(f).connect(gn).connect(bus);
    n.start(t); n.stop(t + 0.15);
  }
  private snare(t: number, peak: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200; f.Q.value = 0.7;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    src.connect(f).connect(g).connect(this.battleBus);
    src.start(t); src.stop(t + 0.12);
  }
  /** Tiefes Blech: zwei verstimmte Sägezähne mit weichem Ansatz */
  private brass(f: number, t: number, dur: number) {
    for (const det of [-6, 6]) this.voice('sawtooth', f * 2, det, t, dur, 0.05, 0.14, this.battleBus, 650);
  }
  private ostinato(f: number, t: number, dur: number) { this.voice('sawtooth', f * 2, 0, t, dur, 0.038, 0.012, this.battleBus, 520); }
  stop() { clearInterval(this.timer); }
}

export const audio = new AudioEngine();
