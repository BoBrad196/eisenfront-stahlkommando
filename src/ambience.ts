// Klangkulisse der Detailkarte: Wind, Laubrauschen, Wasser, Vogelstimmen, Weidetiere, Dorfgeräusche
// (Hund, Hahn, Kirchenglocke, Wassermühle) und Fahrzeugmotoren. Alles richtet sich nach dem, was gerade
// im Bild ist; im Gefecht werden Vögel, Tiere und das Dorf still.
// Die Einzelgeräusche kommen als Dateien ("amb.*", siehe tools/make-sounds.mjs), Wind und Wasser entstehen live aus Rauschen.

export interface AmbAnimal { kind: 'kuh' | 'pferd'; pan: number; vol: number }
/** Was im Bild zu sehen ist (alle Anteile 0..1) */
export interface AmbInfo {
  trees: number; water: number; village: number; church: boolean; mill: boolean;
  tanks: number; air: number; animals: AmbAnimal[]; combat: number;
  /** Provinz mit Meeresküste (Meeresrauschen statt Fluss) */
  sea: boolean;
}
export interface AmbHost {
  ctx: AudioContext;
  bus: GainNode;
  buffer(key: string): AudioBuffer | undefined;
  play(key: string, opts: { volume?: number; pan?: number; far?: number; pitch?: number }): void;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T>(l: T[]) => l[Math.floor(Math.random() * l.length)];

export class AmbientSound {
  private out: GainNode;
  private windG: GainNode; private leavesG: GainNode; private waterG: GainNode; private surfG: GainNode;
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private t = 0;
  private active = false;
  private lastUpdate = 0;
  private timers = { bird: 3, animal: 9, dog: 25, rooster: 40, bell: 60 };
  private bellLeft = 0; private bellNext = 0;
  private combat = 0;
  /** Waldhintergrund: eine der drei Aufnahmen, je Spiel zufällig */
  /** Waldbett: je Spiel eine der Aufnahmen (ruhig, Tag oder Vogelwald); dichter Wald legt den tiefen Wald darüber */
  private forest = pick(['amb.wald', 'amb.wald.v2', 'amb.wald.v3', 'amb.wald.ruhig', 'amb.wald.ruhig.v2', 'amb.wald.tag', 'amb.wald.tag.v2']);
  /** Strömung und Meer: je Spiel eine der Aufnahmen */
  /** Starker Wind: eine der drei Aufnahmen, je Spiel gewählt */
  private strongWind = pick(['amb.wind.stark', 'amb.wind.stark.v2', 'amb.wind.stark.v3']);
  private gustTimer = 6;
  private tanksOn = false;
  /** Panzergeräusche je Spiel aus den vorhandenen Aufnahmen gewählt */
  private tankDrive = pick(['amb.panzer.fahrt', 'amb.panzer.fahrt.b', 'amb.panzer.fahrt.c', 'amb.panzer.fahrt.d']);
  private tankIdle = pick(['amb.panzer.leerlauf', 'amb.panzer.leerlauf.b']);
  private tankQuiet = 0;
  private rapids = pick(['amb.stromschnelle', 'amb.stromschnelle.v2']);
  private surf = pick(['amb.meer', 'amb.meer.v2']);

  constructor(private host: AmbHost) {
    const c = host.ctx;
    this.out = c.createGain();
    this.out.gain.value = 0;
    this.out.connect(host.bus);
    // gemeinsames Rauschen (sechs Sekunden, nahtlos)
    const len = c.sampleRate * 6;
    const nb = c.createBuffer(1, len, c.sampleRate);
    const d = nb.getChannelData(0);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += ((Math.random() * 2 - 1) - lp) * 0.6; d[i] = lp; }
    const xf = Math.floor(c.sampleRate * 0.2);
    for (let i = 0; i < xf; i++) { const a = i / xf; d[i] = d[i] * a + d[len - xf + i] * (1 - a); }
    const layer = (filters: BiquadFilterNode[], offset: number) => {
      const s = c.createBufferSource(); s.buffer = nb; s.loop = true; s.loopEnd = (len - xf) / c.sampleRate;
      const g = c.createGain(); g.gain.value = 0;
      let n: AudioNode = s;
      for (const f of filters) n = n.connect(f);
      n.connect(g).connect(this.out);
      s.start(0, offset);
      return g;
    };
    const f = (type: BiquadFilterType, freq: number, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = freq; b.Q.value = q; return b; };
    this.windG = layer([f('lowpass', 700), f('highpass', 90)], 0);
    this.leavesG = layer([f('highpass', 2200), f('bandpass', 5200, 0.6)], 2.1);
    this.waterG = layer([f('lowpass', 1100), f('highpass', 120)], 3.7);
    this.surfG = layer([f('bandpass', 2600, 0.8)], 1.3);
  }

  private loop(key: string, vol: number, rate = 1) {
    let l = this.loops.get(key);
    if (!l) {
      const buf = this.host.buffer(key);
      if (!buf) return;
      const src = this.host.ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const gain = this.host.ctx.createGain(); gain.gain.value = 0;
      src.connect(gain).connect(this.out);
      src.start();
      l = { src, gain };
      this.loops.set(key, l);
    }
    const now = this.host.ctx.currentTime;
    l.gain.gain.setTargetAtTime(vol, now, 0.6);
    l.src.playbackRate.setTargetAtTime(rate, now, 0.8);
  }

  /** Detailkarte nicht sichtbar (Europakarte, Menü): alles ausblenden */
  silence() {
    if (!this.active) return;
    this.active = false;
    this.out.gain.setTargetAtTime(0, this.host.ctx.currentTime, 0.5);
  }
  /** Läuft zu lange kein update() mehr, wurde die Detailkarte verlassen */
  idle(now: number) { if (this.active && now - this.lastUpdate > 800) this.silence(); }

  update(dt: number, info: AmbInfo) {
    dt = Math.min(dt, 0.5);
    const c = this.host.ctx, now = c.currentTime;
    this.lastUpdate = performance.now();
    this.active = true;
    this.t += dt;
    this.out.gain.setTargetAtTime(1, now, 0.8);
    this.combat += (info.combat - this.combat) * Math.min(1, dt * 0.8);
    const calm = 1 - Math.min(1, this.combat * 1.4);

    // Wind: gleichmäßiges Rauschen mit Böen; Laub rauscht mit den Böen stärker
    const gust = 0.5 + 0.5 * Math.sin(this.t * 0.31) * Math.sin(this.t * 0.113 + 1.2) + 0.25 * Math.sin(this.t * 0.9);
    const g = Math.max(0, Math.min(1, gust));
    // Wind: sanfte Grundbrise, bei Böen der starke Wind darüber; zwischendurch einzelne Windstöße
    this.windG.gain.setTargetAtTime(0.03 + 0.03 * g, now, 0.7);
    this.loop('amb.wind.sanft', calm * (0.16 + 0.12 * g), 1);
    this.loop(this.strongWind, calm * Math.max(0, g - 0.4) * 1.1, 1);
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTimer = rand(9, 22) / Math.max(0.3, g);
      if (g > 0.6) this.host.play('amb.windstoss', { volume: 0.35 + 0.5 * g, pan: rand(-0.8, 0.8), far: rand(0, 0.4) });
    }
    this.leavesG.gain.setTargetAtTime(info.trees * (0.012 + 0.07 * g * g), now, 0.5);
    // Wasser: Plätschern und Wellen, die an- und abschwellen
    const wave = 0.65 + 0.35 * Math.sin(this.t * 0.8);
    this.waterG.gain.setTargetAtTime(info.water * 0.2 * wave, now, 0.6);
    this.surfG.gain.setTargetAtTime(info.water * 0.035 * (0.5 + 0.5 * Math.sin(this.t * 0.8 + 0.6)), now, 0.4);

    // Fahrzeuge, Flugzeuge, Mühle
    // Panzer: Motorengeräusch und Ketten, solange gefahren wird; Anlassen und Abstellen als Einzelgeräusch
    this.loop(this.tankDrive, Math.min(1, info.tanks / 2) * 0.55, 0.94 + 0.03 * Math.min(4, info.tanks));
    // Motor läuft, der Panzer steht: Leerlauf
    this.loop(this.tankIdle, this.tanksOn && info.tanks === 0 ? 0.3 : 0);
    if (info.tanks > 0) { this.tankQuiet = 0; if (!this.tanksOn) { this.tanksOn = true; this.host.play('amb.panzer.start', { volume: 0.7, far: 0.3 }); } }
    else if (this.tanksOn) { this.tankQuiet += dt; if (this.tankQuiet > 4) { this.tanksOn = false; this.host.play('amb.panzer.stopp', { volume: 0.6, far: 0.3 }); } }
    this.loop('amb.flug', Math.min(1, info.air) * 0.4, 0.97 + 0.04 * Math.min(3, info.air));
    this.loop('amb.muehle', info.mill ? 0.5 : 0);
    // Waldvögel in der Ferne als Dauerhintergrund, stärker je mehr Wald im Bild ist
    this.loop(this.forest, calm * (0.05 + 0.5 * info.trees), 1);
    this.loop('amb.wald.tief', calm * Math.max(0, info.trees - 0.35) * 0.9, 1);
    // Wasser: Fluss und Stromschnellen im Binnenland, Brandung an der Küste
    const inland = !info.sea;
    this.loop('amb.fluss', inland ? info.water * 0.32 : 0);
    this.loop(this.rapids, inland ? info.water * 0.1 : 0);
    this.loop(this.surf, info.sea ? 0.18 + 0.3 * info.water : 0);

    // Einzelgeräusche
    const tm = this.timers;
    tm.bird -= dt; tm.animal -= dt; tm.dog -= dt; tm.rooster -= dt; tm.bell -= dt;
    if (tm.bird <= 0) {
      tm.bird = rand(2.5, 9) / (0.45 + info.trees * 1.4 + info.village * 0.4);
      if (calm > 0.6) {
        const r = Math.random();
        const key = r < 0.34 ? 'amb.vogel' : r < 0.58 ? 'amb.vogel.meise' : r < 0.78 ? 'amb.vogel.fink' : r < 0.9 ? 'amb.kraehe' : info.trees > 0.15 ? 'amb.kuckuck' : 'amb.vogel';
        this.host.play(key, { volume: rand(0.45, 1) * calm, pan: rand(-0.85, 0.85), far: rand(0.05, 0.6), pitch: rand(0.94, 1.08) });
      }
    }
    if (tm.animal <= 0) {
      tm.animal = rand(7, 20);
      if (info.animals.length && calm > 0.5) {
        const a = pick(info.animals);
        const key = a.kind === 'kuh' ? 'amb.kuh' : Math.random() < 0.35 ? 'amb.pferd' : 'amb.schnauben';
        this.host.play(key, { volume: a.vol * calm, pan: a.pan, far: Math.min(0.8, 1 - a.vol), pitch: rand(0.92, 1.08) });
      }
    }
    if (info.village > 0.1 && calm > 0.6) {
      if (tm.dog <= 0) { tm.dog = rand(18, 50); this.host.play('amb.hund', { volume: rand(0.5, 0.9), pan: rand(-0.7, 0.7), far: rand(0.3, 0.7) }); }
      if (tm.rooster <= 0) { tm.rooster = rand(30, 80); this.host.play('amb.hahn', { volume: rand(0.5, 0.9), pan: rand(-0.7, 0.7), far: rand(0.2, 0.6) }); }
    } else { tm.dog = Math.max(tm.dog, 5); tm.rooster = Math.max(tm.rooster, 8); }
    // Kirchenglocke: drei bis vier Schläge, wenn die Kirche im Bild ist
    if (info.church && calm > 0.7 && tm.bell <= 0 && this.bellLeft === 0) { this.bellLeft = 3 + Math.floor(Math.random() * 2); this.bellNext = 0; tm.bell = rand(70, 130); }
    if (this.bellLeft > 0) {
      this.bellNext -= dt;
      if (this.bellNext <= 0) { this.host.play('amb.glocke', { volume: 0.8, pan: rand(-0.3, 0.3), far: 0.35 }); this.bellLeft--; this.bellNext = 2.6; }
    }
  }
}
