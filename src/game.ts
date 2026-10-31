// Spielsteuerung: Spielschleife, Befehlswarteschlange, Ansichtswechsel, obere Leiste und Meldungen
import { assets } from './assets';
import { audio } from './audio';
import { ECON, FACTIONS, PLAYER, RESEARCH, RES_KEYS, TICK } from './sim/defs';
import { applyCommand, type Command } from './sim/commands';
import { step } from './sim/sim';
import type { GameEvent, GameState } from './sim/types';
import { createGame, provName } from './sim/world';
import { ProvinceView } from './render/province';
import { StrategicView } from './render/strategic';
import { esc, fmt } from './ui/dom';
import type { MainMenu } from './ui/menu';
import { TouchBar } from './ui/touchbar';

const SAVE_KEY = 'imperium-europa-spielstand'; // Schlüssel beibehalten, damit alte Spielstände ladbar bleiben
const AUTO_KEY = 'imperium-europa-autospeicherung';
const INFO_SUFFIX = '-info';
const AUTOSAVE_EVERY = 60; // Sekunden
type CommandInput = Command extends infer C ? (C extends { faction: string } ? Omit<C, 'faction'> : never) : never;

/** Kurzinfo zu einem Spielstand (für das Hauptmenü, ohne den ganzen Stand zu laden) */
export interface SaveInfo { savedAt: number; time: number; provinces: number }

export interface View {
  enter(): void;
  leave(): void;
  render(g: CanvasRenderingContext2D, w: number, h: number, alpha: number, dt: number): void;
  updatePanel(): void;
  onEvent?(e: GameEvent): void;
}

export class Game {
  state: GameState;
  private cmds: Command[] = [];
  speed = 1;
  paused = false;
  /** Hauptmenü ist offen: Simulation und Zeichnen ruhen */
  suspended = false;
  menu: MainMenu | null = null;
  touchbar: TouchBar | null = null;
  private autosaveTimer = 0;
  private acc = 0;
  private last = performance.now();
  private panelTimer = 0;

  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  sidebar: HTMLElement;     // Inhaltsbereich der Seitenleiste (gehört der aktiven Ansicht)
  sidebarTop: HTMLElement;  // Bereich über den Ressourcen (Minikarte in der Detailkarte)
  cmdbar: HTMLElement;      // untere Befehlsleiste (Detailkarte)
  sceneTag: HTMLElement;    // Ortsangabe oben links
  private resbar: HTMLElement;
  private topbar: HTMLElement;
  private messages: HTMLElement;
  private overlay: HTMLElement;
  strategic: StrategicView;
  provinceView: ProvinceView;
  view: View;
  viewW = 0; viewH = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <header id="topbar"></header>
      <main id="main">
        <div id="viewport"><canvas id="screen"></canvas><div id="scenetag"></div><div id="messages"></div><div id="cmdbar" hidden></div><div id="soundpanel" hidden></div><div id="overlay" hidden></div></div>
        <aside id="sidebar">
          <div class="brandhead"><span>EISENFRONT</span><small>Stahlkommando</small></div>
          <div id="sb-top"></div>
          <div class="resbar"></div>
          <div id="sb-body"></div>
        </aside>
      </main>`;
    this.canvas = root.querySelector('#screen')!;
    this.g = this.canvas.getContext('2d')!;
    this.sidebar = root.querySelector('#sb-body')!;
    this.sidebarTop = root.querySelector('#sb-top')!;
    this.cmdbar = root.querySelector('#cmdbar')!;
    this.sceneTag = root.querySelector('#scenetag')!;
    this.resbar = root.querySelector('.resbar')!;
    this.topbar = root.querySelector('#topbar')!;
    this.messages = root.querySelector('#messages')!;
    this.overlay = root.querySelector('#overlay')!;
    this.touchbar = new TouchBar(root.querySelector('#viewport')!, this);
    this.state = createGame();
    this.strategic = new StrategicView(this);
    this.provinceView = new ProvinceView(this);
    this.view = this.strategic;
    this.buildTopbar();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    this.resize();
    window.addEventListener('keydown', (e) => this.onKey(e));
    // Klickgeräusch für alle Knöpfe
    root.addEventListener('pointerdown', (e) => { if ((e.target as HTMLElement).closest('button')) audio.play('ui.klick'); });
    this.messages.addEventListener('pointerdown', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-goto]');
      if (t) this.enterProvince(t.dataset.goto!);
    });
    this.view.enter();
    // Spielstand sichern, wenn die Seite verlassen oder in den Hintergrund gelegt wird
    window.addEventListener('pagehide', () => this.autosaveNow());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.autosaveNow(); });
    requestAnimationFrame((t) => this.loop(t));
  }

  private welcome() {
    this.message('Willkommen bei Eisenfront: Stahlkommando! Du befehligst Bayern und Hessen. Baue deine Wirtschaft auf und erobere Europa.', 'gut');
    this.message(`Tipp: ${document.body.classList.contains('touch') ? 'Doppeltippen' : 'Doppelklick'} auf eine Provinz öffnet die Detailkarte mit deiner Basis.`, 'info');
  }

  /** Neuen Feldzug beginnen (aus dem Hauptmenü) */
  newGame() {
    this.reset(createGame());
    this.paused = false; this.speed = 1;
    this.messages.innerHTML = '';
    this.welcome();
  }

  setSuspended(v: boolean) {
    this.suspended = v;
    this.last = performance.now();
    this.acc = 0;
  }

  /** Esc darf das Menü öffnen, wenn nichts anderes zum Abbrechen da ist (Auswahl, Bau- oder Befehlsmodus) */
  nothingToCancel(): boolean {
    if (!this.overlay.hidden) return false;
    if (this.view === this.provinceView) {
      const v = this.provinceView;
      return v.mode() === 'none' && v.sel.size === 0 && v.selBuilding == null && v.selVillage == null;
    }
    return this.strategic.selected == null;
  }

  /** Befehl des Spielers einreihen (wird im nächsten Simulationsschritt ausgeführt) */
  issue(c: CommandInput) { this.cmds.push({ ...c, faction: PLAYER } as Command); }

  enterProvince(id: string) {
    this.view.leave();
    this.provinceView.open(id);
    this.view = this.provinceView;
    this.view.enter();
  }
  showMap(select?: string) {
    this.view.leave();
    if (select) this.strategic.selected = select;
    this.view = this.strategic;
    this.view.enter();
  }

  private toggleSoundPanel() {
    const el = this.canvas.parentElement!.querySelector<HTMLElement>('#soundpanel')!;
    if (!el.hidden) { el.hidden = true; return; }
    const st = audio.settings;
    el.innerHTML = `<div class="sub">Ton und Musik</div>
      <label class="tog"><input type="checkbox" id="snd-on" ${st.on ? 'checked' : ''}> Ton an</label>
      <label for="snd-music">Musik</label><input type="range" id="snd-music" min="0" max="1" step="0.05" value="${st.music}">
      <label for="snd-sfx">Effekte</label><input type="range" id="snd-sfx" min="0" max="1" step="0.05" value="${st.sfx}">
      <label for="snd-amb">Umgebung (Wind, Tiere)</label><input type="range" id="snd-amb" min="0" max="1" step="0.05" value="${st.amb}">
      <p class="hint">Die Musik wird live erzeugt und wird im Gefecht dichter. Eigene Stücke und Geräusche: siehe assets/manifest.json.</p>`;
    el.hidden = false;
    el.oninput = () => {
      audio.setSettings({
        on: (el.querySelector('#snd-on') as HTMLInputElement).checked,
        music: Number((el.querySelector('#snd-music') as HTMLInputElement).value),
        sfx: Number((el.querySelector('#snd-sfx') as HTMLInputElement).value),
        amb: Number((el.querySelector('#snd-amb') as HTMLInputElement).value),
      });
    };
    el.onchange = el.oninput;
  }

  /** Europakarte mit Übersicht (Mächte und Diplomatie) */
  showOverview() {
    this.strategic.selected = null;
    this.showMap();
  }

  private resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.viewW = r.width; this.viewH = r.height;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = `${r.width}px`; this.canvas.style.height = `${r.height}px`;
  }

  private loop(now: number) {
    const dt = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    if (this.suspended) {
      // Menü offen: nur die Musik weiterlaufen lassen
      this.panelTimer -= dt;
      if (this.panelTimer <= 0) { this.panelTimer = 0.25; audio.update(); }
      requestAnimationFrame((t) => this.loop(t));
      return;
    }
    this.autosaveTimer += dt;
    if (this.autosaveTimer >= AUTOSAVE_EVERY) this.autosaveNow();
    if (!this.paused && !this.state.outcome) {
      this.acc += dt * this.speed;
      let steps = 0;
      while (this.acc >= TICK && steps < 12) {
        step(this.state, this.cmds.splice(0));
        this.acc -= TICK;
        steps++;
      }
      if (steps === 12) this.acc = 0;
    } else if (this.cmds.length) {
      // Im Pausenmodus Befehle trotzdem annehmen (ohne Zeit voranzuschreiten)
      for (const c of this.cmds.splice(0)) applyCommand(this.state, c);
    }
    this.drainEvents();
    const dpr = window.devicePixelRatio || 1;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.render(this.g, this.viewW, this.viewH, this.paused ? 1 : Math.min(1, this.acc / TICK), dt);
    this.panelTimer -= dt;
    if (this.panelTimer <= 0) {
      this.panelTimer = 0.25;
      this.updateTopbar();
      audio.update();
      this.view.updatePanel();
      this.touchbar?.update();
      this.updateOutcome();
    }
    requestAnimationFrame((t) => this.loop(t));
  }

  private drainEvents() {
    const ev = this.state.events;
    if (!ev.length) return;
    this.state.events = [];
    for (const e of ev) {
      if (e.kind === 'msg') {
        this.message(e.text!, e.level, e.target);
        const s = e.sound ?? { alarm: 'ui.alarm', warnung: 'ui.warnung', gut: 'ui.erfolg', info: null }[e.level ?? 'info'];
        if (s) audio.play(s);
        if (e.level === 'alarm') { audio.combatPulse(); audio.play('funk.feind'); }
      } else this.view.onEvent?.(e);
    }
  }

  // ---------- Meldungen ----------
  message(text: string, level: GameEvent['level'] = 'info', target?: string) {
    const el = document.createElement('div');
    el.className = `msg msg-${level}`;
    el.innerHTML = `${esc(text)}${target ? ` <button data-goto="${target}">→ ${esc(provName(target))}</button>` : ''}`;
    this.messages.appendChild(el);
    while (this.messages.children.length > 7) this.messages.firstElementChild!.remove();
    setTimeout(() => el.classList.add('fade'), 11000);
    setTimeout(() => el.remove(), 12500);
  }

  // ---------- Obere Leiste ----------
  private buildTopbar() {
    const icon = (k: string) => `<img class="ico" src="${assets.url(`icon.${k}`) ?? ''}" alt="">`;
    const names: Record<string, string> = { geld: 'Geld (Taler)', kohle: 'Kohle', eisen: 'Eisen', gold: 'Gold' };
    this.topbar.innerHTML = `
      <div class="brand">Eisenfront <span>Stahlkommando</span></div>
      <label class="tax" title="Steuersatz in deinen Stammdörfern: höhere Steuern = mehr Geld, aber unzufriedenere Einwohner">Steuern
        <select data-tax>${ECON.taxLevels.map((t, i) => `<option value="${i}">${t.name} (${Math.round(t.rate * 100)} %)</option>`).join('')}</select></label>
      <div class="speed">
        <button data-speed="0" title="Pause (P)">⏸</button><button data-speed="1">1×</button><button data-speed="2">2×</button><button data-speed="4">4×</button>
      </div>
      <span class="clock" data-clock></span>
      <span class="minires" data-minires>${['geld', 'kohle', 'eisen', 'gold'].map((k) => `<span title="${names[k]}">${icon(k)}<b data-mini="${k}">0</b></span>`).join('')}</span>
      <span class="chip research-chip" data-research title="Laufende Forschung"></span>
      <div class="menu">
        <button data-act="panel" class="panelbtn" title="Kommandopult ein- / ausblenden">Pult</button>
        <button data-act="menu" title="Hauptmenü (Esc)">Menü</button>
        <button data-act="sound" title="Ton und Musik">Ton</button>
        <button data-act="diplomacy" title="Diplomatie und Mächte auf der Europakarte">Diplomatie</button>
        <button data-act="save" title="Spielstand im Browser speichern">Speichern</button>
        <button data-act="load">Laden</button>
        <button data-act="new">Neues Spiel</button>
      </div>`;
    // Ressourcen-Kacheln in der Seitenleiste (wie im Kommandopult)
    const tile = (k: string, label: string, title: string) => `<div class="rtile" data-tile="${k}" title="${title}">${icon(k)}<div><small>${label}</small><b data-res="${k}">0</b><em data-inc="${k}"></em></div></div>`;
    this.resbar.innerHTML = tile('geld', 'Mark', names.geld) + tile('kohle', 'Kohle', names.kohle) + tile('eisen', 'Eisen', names.eisen) + tile('gold', 'Gold', names.gold)
      + `<div class="rtile strom" data-tile="strom" title="Strom dieser Provinz: Erzeugung / Verbrauch">${icon('strom')}<div><small>Strom</small><b data-strom>–</b></div></div>`;
    (this.topbar.querySelector('[data-tax]') as HTMLSelectElement).value = String(this.state.factions[PLAYER].tax);
    this.topbar.addEventListener('change', (e) => {
      const t = e.target as HTMLSelectElement;
      if (t.dataset.tax !== undefined) this.issue({ type: 'setTax', level: Number(t.value) });
    });
    this.topbar.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.speed) {
        const s = Number(b.dataset.speed);
        if (s === 0) this.paused = !this.paused; else { this.speed = s; this.paused = false; }
      }
      if (b.dataset.act === 'panel') document.getElementById('main')?.classList.toggle('sb-open');
      if (b.dataset.act === 'menu') this.menu?.show(true);
      if (b.dataset.act === 'diplomacy') this.showOverview();
      if (b.dataset.act === 'sound') this.toggleSoundPanel();
      if (b.dataset.act === 'save') this.save();
      if (b.dataset.act === 'load') this.load();
      if (b.dataset.act === 'new') this.ask('Neues Spiel beginnen? Nicht gespeicherter Fortschritt geht verloren.', () => this.reset(createGame()));
    });
  }

  private updateTopbar() {
    const f = this.state.factions[PLAYER];
    for (const k of RES_KEYS) {
      this.resbar.querySelector(`[data-res="${k}"]`)!.textContent = fmt(f.res[k]);
      const mini = this.topbar.querySelector(`[data-mini="${k}"]`);
      if (mini) mini.textContent = fmt(f.res[k]);
      const inc = Math.round(f.income[k]);
      const el = this.resbar.querySelector(`[data-inc="${k}"]`)!;
      el.textContent = inc ? `${inc > 0 ? '+' : ''}${fmt(inc)}/min` : '';
      el.className = inc < 0 ? 'neg' : '';
    }
    const strom = this.resbar.querySelector<HTMLElement>('[data-tile="strom"]')!;
    const pw = this.view === this.provinceView ? this.provinceView.power() : null;
    strom.hidden = !pw;
    if (pw) {
      strom.querySelector('[data-strom]')!.textContent = `${pw.prod} / ${pw.use}`;
      strom.classList.toggle('low', pw.use > pw.prod);
    }
    const rc = this.state.factions[PLAYER].research?.current;
    const rEl = this.topbar.querySelector<HTMLElement>('[data-research]')!;
    rEl.hidden = !rc;
    if (rc) rEl.textContent = `Forschung: ${RESEARCH[rc.type].name} ${Math.floor((rc.progress / rc.total) * 100)} %`;
    const t = Math.floor(this.state.time);
    this.topbar.querySelector('[data-clock]')!.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}${this.paused ? ' – PAUSE' : ''}`;
    this.topbar.querySelectorAll<HTMLElement>('[data-speed]').forEach((b) => {
      const s = Number(b.dataset.speed);
      b.classList.toggle('on', s === 0 ? this.paused : !this.paused && this.speed === s);
    });
  }

  private updateOutcome() {
    const o = this.state.outcome;
    if (!o) return;
    audio.setScene(o === 'sieg' ? 'sieg' : 'niederlage');
    if (!this.overlay.hidden) return;
    audio.play(o === 'sieg' ? 'funk.auftrag_erfuellt' : 'funk.auftrag_gescheitert');
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<div class="box"><h1>${o === 'sieg' ? 'Sieg!' : 'Niederlage'}</h1>
      <p>${o === 'sieg' ? 'Alle gegnerischen Mächte Europas sind besiegt.' : 'Dein Reich hat keine Provinzen mehr.'}</p>
      <button data-act="again">Neues Spiel</button></div>`;
    this.overlay.querySelector('button')!.onclick = () => this.reset(createGame());
  }

  /** Rückfrage im Spiel (Browser-Dialoge wie confirm() sind nicht überall erlaubt) */
  ask(text: string, onYes: () => void) {
    const wasPaused = this.paused;
    this.paused = true;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<div class="box"><p>${esc(text)}</p><div class="btns"><button data-a="yes" class="primary">Ja</button><button data-a="no">Abbrechen</button></div></div>`;
    this.overlay.onclick = (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
      if (!a) return;
      this.overlay.hidden = true;
      this.overlay.onclick = null;
      this.paused = wasPaused;
      if (a === 'yes') onYes();
    };
  }

  // ---------- Speichern / Laden ----------
  private write(key: string): boolean {
    try {
      localStorage.setItem(key, JSON.stringify({ ...this.state, events: [] }));
      const info: SaveInfo = {
        savedAt: Date.now(), time: this.state.time,
        provinces: Object.values(this.state.provinces).filter((p) => p.owner === PLAYER).length,
      };
      localStorage.setItem(key + INFO_SUFFIX, JSON.stringify(info));
      return true;
    } catch { return false; /* Speicher voll oder gesperrt */ }
  }
  save() {
    if (this.write(SAVE_KEY)) this.message('Spiel gespeichert.', 'gut');
    else this.message('Speichern fehlgeschlagen (Browser-Speicher voll oder gesperrt).', 'warnung');
  }
  /** Automatische Sicherung (alle 60 s, beim Verlassen der Seite); nicht während das Menü offen ist oder nach Spielende */
  autosaveNow() {
    this.autosaveTimer = 0;
    if (this.suspended || this.state.outcome) return;
    this.write(AUTO_KEY);
  }
  saveInfo(kind: 'auto' | 'manual'): SaveInfo | null {
    try {
      const key = kind === 'auto' ? AUTO_KEY : SAVE_KEY;
      if (!localStorage.getItem(key)) return null;
      const raw = localStorage.getItem(key + INFO_SUFFIX);
      // ältere Spielstände ohne Kurzinfo: trotzdem ladbar
      return raw ? (JSON.parse(raw) as SaveInfo) : { savedAt: 0, time: 0, provinces: 0 };
    } catch { return null; }
  }
  /** Spielstand laden; false, wenn keiner da oder unlesbar */
  loadSave(kind: 'auto' | 'manual'): boolean {
    let raw: string | null = null;
    try { raw = localStorage.getItem(kind === 'auto' ? AUTO_KEY : SAVE_KEY); } catch { /* Speicher gesperrt */ }
    if (!raw) { this.message('Kein Spielstand gefunden.', 'warnung'); return false; }
    try {
      const s = JSON.parse(raw) as GameState;
      if (s.version !== 1) throw new Error('Unbekannte Version');
      s.events = [];
      this.reset(s);
      this.paused = false;
      this.messages.innerHTML = '';
      this.message(kind === 'auto' ? 'Autospeicherung geladen.' : 'Spielstand geladen.', 'gut');
      return true;
    } catch (e) {
      this.message(`Laden fehlgeschlagen: ${(e as Error).message}`, 'warnung');
      return false;
    }
  }
  load() { this.loadSave('manual'); }
  private reset(s: GameState) {
    this.state = s;
    this.cmds = [];
    this.acc = 0;
    this.overlay.hidden = true;
    (this.topbar.querySelector('[data-tax]') as HTMLSelectElement).value = String(s.factions[PLAYER].tax);
    this.strategic.selected = null;
    this.showMap();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'p' || e.key === 'P' || e.key === 'Pause') { this.paused = !this.paused; e.preventDefault(); }
    if ((e.key === 'm' || e.key === 'M') && this.view === this.provinceView) this.showMap(this.provinceView.id);
  }

  factionColor(id: string) { return FACTIONS[id]?.color ?? '#888'; }
}
