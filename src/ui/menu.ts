// Hauptmenü ("Dämmerung"): Titelbild, Ladebalken beim Start, Neuer Feldzug, Fortsetzen, Laden, Einstellungen, Beenden.
// Das Menü liegt als eigene Ebene über der Seite (nicht in #app, weil das Spiel dessen Inhalt ersetzt).
import { audio } from '../audio';
import type { Game, SaveInfo } from '../game';

const HERO = 'graphics/menu/hero.jpg';
type Mode = 'loading' | 'main' | 'settings' | 'confirm' | 'bye';

export class MainMenu {
  private el: HTMLElement;
  private game: Game | null = null;
  private mode: Mode = 'loading';
  private inGame = false;
  private progress = 0;
  private confirmAct: (() => void) | null = null;
  private confirmText = '';

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.id = 'mainmenu';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', () => this.onSettings());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.render();
  }

  get visible() { return !this.el.hidden && this.el.isConnected; }

  /** Ladebalken beim Start */
  setProgress(done: number, total: number) {
    this.progress = total ? done / total : 1;
    const bar = this.el.querySelector<HTMLElement>('[data-bar]');
    if (bar) bar.style.transform = `scaleX(${this.progress})`;
    const txt = this.el.querySelector<HTMLElement>('[data-pct]');
    if (txt) txt.textContent = `Lade Grafiken … ${Math.round(this.progress * 100)} %`;
  }

  attach(game: Game) { this.game = game; }

  /** Menü öffnen; inGame = aus laufendem Spiel (Fortsetzen kehrt zurück statt zu laden) */
  show(inGame: boolean) {
    this.inGame = inGame;
    this.mode = 'main';
    this.game?.setSuspended(true);
    audio.setScene('menu');
    this.el.hidden = false;
    this.el.classList.remove('mm-out');
    this.render();
    this.focusFirst();
  }

  hide() {
    this.el.classList.add('mm-out');
    setTimeout(() => { if (this.el.classList.contains('mm-out')) this.el.hidden = true; }, 380);
    this.game?.setSuspended(false);
    audio.setScene('spiel');
  }

  /** Esc im Spiel öffnet das Menü, solange es nichts anderes abzubrechen gibt */
  canOpenWithEsc() { return !!this.game && !this.visible && this.game.nothingToCancel(); }

  private onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (this.visible && this.mode !== 'loading') {
        e.preventDefault();
        if (this.mode !== 'main') { this.mode = 'main'; this.render(); this.focusFirst(); }
        else if (this.inGame) this.hide();
      } else if (this.canOpenWithEsc()) this.show(true);
      return;
    }
    if (!this.visible || this.mode === 'loading') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...this.el.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i < 0 ? 0 : n].focus();
      e.preventDefault();
    }
  }

  private focusFirst() {
    requestAnimationFrame(() => this.el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true }));
  }

  private onClick(e: MouseEvent) {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
    if (!b || b.disabled || !this.game) return;
    const g = this.game;
    switch (b.dataset.act) {
      case 'new':
        if (this.inGame) this.ask('Neuen Feldzug beginnen? Nicht gespeicherter Fortschritt geht verloren.', () => { g.newGame(); this.hide(); });
        else { g.newGame(); this.hide(); }
        break;
      case 'continue':
        if (this.inGame) this.hide();
        else if (g.loadSave('auto')) this.hide();
        break;
      case 'save': g.save(); this.render(); this.focusFirst(); break;
      case 'load':
        if (this.inGame) this.ask('Gespeicherten Spielstand laden? Nicht gespeicherter Fortschritt geht verloren.', () => { if (g.loadSave('manual')) this.hide(); });
        else if (g.loadSave('manual')) this.hide();
        break;
      case 'settings': this.mode = 'settings'; this.render(); this.focusFirst(); break;
      case 'quit': this.ask('Eisenfront beenden?', () => { this.mode = 'bye'; this.render(); this.focusFirst(); try { window.close(); } catch { /* Browser erlaubt es nicht */ } }); break;
      case 'back': this.mode = 'main'; this.render(); this.focusFirst(); break;
      case 'yes': { const f = this.confirmAct; this.confirmAct = null; this.mode = 'main'; this.render(); f?.(); break; }
      case 'fullscreen':
        if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.();
        break;
    }
  }

  private ask(text: string, onYes: () => void) {
    this.confirmText = text; this.confirmAct = onYes; this.mode = 'confirm';
    this.render(); this.focusFirst();
  }

  private onSettings() {
    if (this.mode !== 'settings') return;
    const v = (id: string) => this.el.querySelector<HTMLInputElement>(`#${id}`)!;
    audio.setSettings({ on: v('mm-on').checked, music: Number(v('mm-music').value), sfx: Number(v('mm-sfx').value), amb: Number(v('mm-amb').value) });
  }

  private info(i: SaveInfo | null): string {
    if (!i) return '';
    const d = new Date(i.savedAt).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const t = Math.floor(i.time);
    return `${i.provinces} ${i.provinces === 1 ? 'Provinz' : 'Provinzen'} · ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')} gespielt · ${d}`;
  }

  private item(act: string, label: string, sub = '', opts: { on?: boolean; off?: boolean } = {}) {
    return `<button class="mm-item${opts.on ? ' mm-on' : ''}" type="button" data-act="${act}"${opts.off ? ' disabled' : ''}><span class="mm-bar"></span><span class="mm-lab">${label}</span>${sub ? `<span class="mm-sub">${sub}</span>` : ''}</button>`;
  }

  private render() {
    const g = this.game;
    let body = '';
    if (this.mode === 'loading') {
      body = `<div class="mm-load"><div class="mm-track"><div class="mm-fill" data-bar style="transform:scaleX(${this.progress})"></div></div><div class="mm-sub" data-pct>Lade Grafiken … ${Math.round(this.progress * 100)} %</div></div>`;
    } else if (this.mode === 'main' && g) {
      const auto = g.saveInfo('auto'), manual = g.saveInfo('manual');
      body = `<nav class="mm-nav" aria-label="Hauptmenü">
        ${this.item('new', 'Neuer Feldzug', 'Europa · Mai 1940', { on: !this.inGame })}
        ${this.inGame
          ? this.item('continue', 'Feldzug fortsetzen', 'Zurück ins Spiel', { on: true })
          : this.item('continue', 'Feldzug fortsetzen', auto ? `Autospeicherung · ${this.info(auto)}` : 'Keine Autospeicherung vorhanden', { off: !auto })}
        ${this.inGame ? this.item('save', 'Spiel speichern', manual ? `Letzter Stand · ${this.info(manual)}` : 'Ein Spielstand im Browser') : ''}
        ${this.item('load', 'Spielstand laden', manual ? this.info(manual) : 'Kein gespeicherter Spielstand', { off: !manual })}
        ${this.item('settings', 'Einstellungen', 'Ton · Anzeige')}
        ${this.item('quit', 'Beenden')}
      </nav>`;
    } else if (this.mode === 'settings') {
      const st = audio.settings;
      body = `<div class="mm-panel">
        <h2>Einstellungen</h2>
        <label class="mm-check"><input type="checkbox" id="mm-on" ${st.on ? 'checked' : ''}> Ton an</label>
        <label class="mm-field" for="mm-music">Musik</label><input type="range" id="mm-music" min="0" max="1" step="0.05" value="${st.music}">
        <label class="mm-field" for="mm-sfx">Effekte</label><input type="range" id="mm-sfx" min="0" max="1" step="0.05" value="${st.sfx}">
        <label class="mm-field" for="mm-amb">Umgebung (Wind, Tiere)</label><input type="range" id="mm-amb" min="0" max="1" step="0.05" value="${st.amb}">
        <button class="mm-small" type="button" data-act="fullscreen">Vollbild an / aus</button>
        <p class="mm-hint">Die Musik wird live erzeugt und wird im Gefecht dichter. Eigene Stücke und Geräusche: siehe assets/manifest.json.</p>
      </div>
      <nav class="mm-nav">${this.item('back', 'Zurück', '', { on: true })}</nav>`;
    } else if (this.mode === 'confirm') {
      body = `<div class="mm-panel"><h2>Bist du sicher?</h2><p class="mm-ask">${this.confirmText}</p></div>
        <nav class="mm-nav">${this.item('yes', 'Ja', '', { on: true })}${this.item('back', 'Abbrechen')}</nav>`;
    } else if (this.mode === 'bye') {
      body = `<div class="mm-panel"><h2>Danke fürs Spielen</h2><p class="mm-ask">Du kannst dieses Fenster jetzt schließen.</p></div>
        <nav class="mm-nav">${this.item('back', 'Zurück zum Hauptmenü', '', { on: true })}</nav>`;
    }
    const emb = [[40, 60, 0, 3, 11, -1], [190, -40, 0, 2, 13, -4], [330, 90, 0, 4, 11, -7], [440, -70, 0, 2, 14, -2], [560, 50, 0, 3, 11, -9], [680, -30, 0, 2, 12, -5], [810, 80, 0, 3, 15, -3], [910, -60, 0, 2, 11, -8], [110, 30, 0, 2, 16, -6], [380, -80, 0, 3, 12, -10]]
      .map(([x, dx, , s, dur, dl]) => `<i class="mm-em" style="left:${x / 9.6}%;width:${s}px;height:${s}px;--dx:${dx}px;animation-duration:${dur}s;animation-delay:${dl}s"></i>`).join('');
    this.el.innerHTML = `
      <div class="mm-bg" style="background-image:url('${HERO}')"></div>
      <div class="mm-shade-x"></div><div class="mm-shade-y"></div>
      <div class="mm-glow"></div><div class="mm-fog mm-fog1"></div><div class="mm-fog mm-fog2"></div>
      ${emb}
      <svg class="mm-grain" aria-hidden="true"><filter id="mm-g"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="4"/><feColorMatrix values="0 0 0 0 .5  0 0 0 0 .5  0 0 0 0 .5  0 0 0 .9 0"/></filter><rect width="100%" height="100%" filter="url(#mm-g)"/></svg>
      <div class="mm-vig"></div>
      <div class="mm-col">
        <div class="mm-crest">
          <svg width="100%" height="100%" viewBox="0 0 64 64" fill="none" stroke="#d9ae4e" stroke-width="2.4" stroke-linecap="square" role="img" aria-label="Zeichen der Zentralmacht"><circle cx="32" cy="32" r="29"/><path d="M18 38 L32 26 L46 38"/><path d="M18 46 L32 34 L46 46"/><path d="M32 12 V20"/></svg>
          <span>ZENTRALMACHT &nbsp;·&nbsp; EUROPA 1940</span>
        </div>
        <h1 class="mm-title">EISENFRONT</h1>
        <div class="mm-subtitle"><i></i><span>STAHLKOMMANDO</span></div>
        <div class="mm-body">${body}</div>
      </div>
      <div class="mm-foot">Vorabversion &nbsp;·&nbsp; läuft im Browser</div>`;
  }
}
