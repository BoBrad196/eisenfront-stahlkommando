// Werkzeugleiste für Touch-Geräte (nur sichtbar, wenn mit dem Finger gespielt wird):
// Mehrfachauswahl, Auswahlrahmen, alle Einheiten, abwählen, zur Europakarte, Sammelpunkt, Bau bestätigen / abbrechen.
import type { Game } from '../game';

export class TouchBar {
  private el: HTMLElement;
  private sig = '';

  constructor(parent: HTMLElement, private game: Game) {
    this.el = document.createElement('div');
    this.el.id = 'touchbar';
    this.el.hidden = true;
    parent.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-t]');
      if (!b) return;
      const v = this.game.provinceView;
      switch (b.dataset.t) {
        case 'multi': v.touchMulti = !v.touchMulti; break;
        case 'rect': v.touchRect = !v.touchRect; break;
        case 'all': v.selectAllOwn(); break;
        case 'none': v.deselect(); break;
        case 'map': this.game.showMap(v.id); break;
        case 'rally': v.rallyArmed = !v.rallyArmed; break;
        case 'build': v.confirmPlace(); break;
        case 'cancel': v.setMode('none'); v.rallyArmed = false; v.refreshUi(); break;
      }
      this.update(true);
    });
  }

  /** Nur bei Touch-Bedienung und in der Detailkarte sichtbar; baut die Knöpfe nur bei Änderungen neu auf */
  update(force = false) {
    const show = document.body.classList.contains('touch') && this.game.view === this.game.provinceView;
    if (this.el.hidden === show) this.el.hidden = !show;
    if (!show) { this.sig = ''; return; }
    const v = this.game.provinceView;
    const mode = v.mode();
    const sig = [mode, v.touchMulti, v.touchRect, v.rallyArmed, v.ownFactorySelected(), v.sel.size > 0 || v.selBuilding != null || v.selVillage != null].join('|');
    if (!force && sig === this.sig) return;
    this.sig = sig;
    const btn = (t: string, label: string, on = false, extra = '') => `<button type="button" data-t="${t}" class="${on ? 'on' : ''} ${extra}">${label}</button>`;
    let html = '';
    if (mode === 'place') html = btn('build', 'Hier bauen', false, 'go') + btn('cancel', 'Abbrechen');
    else if (mode !== 'none') html = btn('cancel', 'Abbrechen');
    else {
      html = btn('multi', 'Mehrfach', v.touchMulti) + btn('rect', 'Rahmen', v.touchRect) + btn('all', 'Alle') + btn('none', 'Abwählen');
      if (v.ownFactorySelected()) html += btn('rally', 'Sammelpunkt', v.rallyArmed);
      html += btn('map', 'Karte');
    }
    this.el.innerHTML = html;
  }
}
