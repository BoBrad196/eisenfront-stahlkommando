// Untere Befehlsleiste der Detailkarte: Porträt der Auswahl, Auswahl-Kacheln und Befehle
// (Bewegen, Angriff, Reparieren, Sprengen, Stopp, Verlegen).
import type { Game } from '../game';
import type { ProvinceView } from '../render/province';
import { BUILDINGS, ECON, FACTIONS, GEO, PLAYER, UNITS } from '../sim/defs';
import { atWar } from '../sim/diplomacy';
import { factionName, provName, queuesOf } from '../sim/world';
import { esc, fmt } from './dom';
import { thumb } from './thumbs';
import { statusText } from './village';

const SVG = {
  move: '<svg viewBox="0 0 32 32"><path d="M16 2l5 6h-3.5v6.5H24V11l6 5-6 5v-3.5h-6.5V24H21l-5 6-5-6h3.5v-6.5H8V21l-6-5 6-5v3.5h6.5V8H11z" fill="currentColor"/></svg>',
  attack: '<svg viewBox="0 0 32 32"><circle cx="16" cy="16" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="16" cy="16" r="2.4" fill="currentColor"/><path d="M16 2v8M16 22v8M2 16h8M22 16h8" stroke="currentColor" stroke-width="2.4"/></svg>',
  repair: '<svg viewBox="0 0 32 32"><path d="M26 4a7 7 0 0 0-8.4 9.2L5 25.8 8.2 29l12.6-12.6A7 7 0 0 0 30 8l-4.2 4.2-3.6-.4-.4-3.6z" fill="currentColor"/></svg>',
  blast: '<svg viewBox="0 0 32 32"><path d="M16 2l3 8 7-5-3 8 8 1-7 4 5 7-8-3-1 8-4-7-5 6 1-8-8-1 7-4-5-6 8 2z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 32 32"><rect x="8" y="8" width="16" height="16" rx="2" fill="currentColor"/></svg>',
  send: '<svg viewBox="0 0 32 32"><path d="M4 16h18l-6-6M22 16l-6 6" fill="none" stroke="currentColor" stroke-width="3"/><path d="M26 6v20" stroke="currentColor" stroke-width="3"/></svg>',
};

export class CommandBar {
  private el!: HTMLElement;
  private last = '';
  private sendOpen = false;

  constructor(private game: Game, private view: ProvinceView) {}

  mount(signal: AbortSignal) {
    this.el = this.game.cmdbar;
    this.el.hidden = false;
    this.el.addEventListener('pointerdown', (e) => this.onPointer(e), { signal });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    // Bildlauf am unteren Bildschirmrand funktioniert auch über der Leiste
    this.el.addEventListener('pointermove', (e) => {
      const r = this.game.canvas.getBoundingClientRect();
      this.view.mouse = e.clientY > r.bottom - 14 ? { x: e.clientX - r.left, y: r.height, in: true } : { ...this.view.mouse, in: false };
    }, { signal });
    this.el.addEventListener('pointerleave', () => (this.view.mouse.in = false), { signal });
    signal.addEventListener('abort', () => { this.el.hidden = true; this.el.innerHTML = ''; this.sendOpen = false; });
    this.render(true);
  }

  render(force = false) {
    if (!this.el) return;
    const v = this.view, s = this.game.state, map = v.map;
    const units = map.units.filter((u) => v.sel.has(u.id));
    const own = units.filter((u) => u.faction === PLAYER);
    const b = v.selBuilding != null ? map.buildings.find((x) => x.id === v.selBuilding) : undefined;
    const village = v.selVillage ? s.provinces[v.id].villages.find((x) => x.id === v.selVillage) : undefined;

    // ---- Porträt ----
    let portrait = '';
    if (units.length) {
      const u = units[0], d = UNITS[u.type];
      portrait = this.portrait(thumb(d.sprite, 120, 84, { ground: d.domain === 'see' ? 'wasser' : 'erde', air: d.armor === 'luft' }), d.name + (u.faction !== PLAYER ? ` (${factionName(u.faction)})` : ''), u.hp, d.hp,
        `<span title="Reichweite">⌖ ${d.range}</span><span title="Schaden">✸ ${d.damage}</span><span title="Tempo">➤ ${d.speed}</span><span title="Sichtweite">◉ ${d.sight}</span>`, v.groupOf(u.id));
    } else if (b) {
      const d = BUILDINGS[b.type];
      const extra = b.faction !== PLAYER ? esc(factionName(b.faction))
        : (b.type === 'kaserne' || b.type === 'panzerfabrik' || b.type === 'flugfeld' || b.type === 'werft')
          ? `Warteschlange: ${queuesOf(map, PLAYER)[b.type]?.length ?? 0} · Sammelpunkt: Rechtsklick auf Karte`
          : esc(d.desc);
      portrait = this.portrait(thumb(d.sprite, 120, 84), d.name, b.hp, d.hp, `<span class="pdesc">${extra}</span>`, null, b.repairing);
    } else if (village) {
      portrait = `<div class="portrait"><img src="${thumb('village.dorf', 120, 84)}" alt=""><div class="pinfo"><b>${esc(village.name)}</b>
        <span class="pnum">${fmt(village.pop)} Einwohner · ${Math.round(village.happiness)} % zufrieden</span><span class="pdesc">${esc(statusText(village, s.provinces[v.id].owner))} – Aktionen im Reiter „Dörfer“</span></div></div>`;
    } else {
      portrait = `<div class="portrait empty"><div class="pinfo"><b>Keine Auswahl</b><span class="pdesc">Linksklick oder Rahmen ziehen wählt Einheiten · Rechtsklick bewegt/greift an · Strg+1–9 bildet Gruppen</span></div></div>`;
    }

    // ---- Auswahl-Kacheln ----
    const tiles = units.slice(0, 14).map((u, i) => {
      const d = UNITS[u.type], g = v.groupOf(u.id);
      return `<button class="utile ${i === 0 ? 'lead' : ''}" data-act="only" data-id="${u.id}" title="${esc(d.name)} – nur diese Einheit wählen">
        <img src="${thumb(d.sprite, 54, 54, { ground: d.domain === 'see' ? 'wasser' : 'erde', air: d.armor === 'luft' })}" alt="">
        ${g != null ? `<span class="gnum">${g}</span>` : ''}<span class="hp"><i style="width:${(u.hp / d.hp) * 100}%;background:${hpColor(u.hp / d.hp)}"></i></span></button>`;
    }).join('') + (units.length > 14 ? `<span class="more">+${units.length - 14}</span>` : '');

    // ---- Befehle ----
    const hasOwn = own.length > 0;
    const ownB = b && b.faction === PLAYER ? b : undefined;
    const mode = v.mode();
    const cmd = (act: string, label: string, svg: string, enabled: boolean, active = false, title = '') =>
      `<button class="cmd ${active ? 'on' : ''}" data-act="${act}" ${enabled ? '' : 'disabled'} title="${esc(title)}">${svg}<span>${label}</span></button>`;
    let commands = cmd('move', 'Bewegen', SVG.move, hasOwn, mode === 'move', 'Ziel anklicken (oder Rechtsklick)')
      + cmd('attack', 'Angriff', SVG.attack, hasOwn, mode === 'attack', 'Angriffsbewegung: greift unterwegs alles an (A)')
      + cmd('repair', 'Reparieren', SVG.repair, true, mode === 'repair' || !!ownB?.repairing, ownB ? 'Gewähltes Gebäude reparieren' : 'Reparaturmodus: eigenes Gebäude anklicken (R)')
      + cmd('blast', 'Sprengen', SVG.blast, !!ownB, false, ownB ? `Gebäude sprengen (+${fmt((BUILDINGS[ownB.type].cost.geld ?? 0) * ECON.sellRefund * (ownB.hp / BUILDINGS[ownB.type].hp))} T Erlös)` : 'Eigenes Gebäude wählen');
    commands += `<div class="cmdsmall">${cmd('stop', '', SVG.stop, hasOwn, false, 'Stopp (S)')}${cmd('send', '', SVG.send, hasOwn, this.sendOpen, 'In Nachbarprovinz verlegen')}</div>`;

    let pop = '';
    if (this.sendOpen && hasOwn) {
      pop = `<div class="sendpop"><div class="qhead">Verlegen nach</div>${GEO.provinces[v.id].neighbors.map((n) => {
        const t = s.provinces[n.id];
        const hostile = t.owner !== PLAYER && (t.owner === 'neutral' || atWar(s, PLAYER, t.owner));
        return `<button data-act="sendto" data-to="${n.id}" class="${hostile ? 'danger' : ''}"><span class="sw" style="background:${FACTIONS[t.owner].color}"></span>${esc(provName(n.id))}${n.see ? ' ⚓' : ''}${hostile ? ' ⚔' : ''}</button>`;
      }).join('')}</div>`;
    } else this.sendOpen = false;

    const html = `${pop}<div class="cbsec">${portrait}</div><div class="cbsec utiles">${tiles}</div><div class="cbsec cmds">${commands}</div>`;
    if (!force && html === this.last) return;
    this.last = html;
    this.el.innerHTML = html;
  }

  private portrait(img: string, name: string, hp: number, max: number, extra: string, group: number | null, repairing = false) {
    return `<div class="portrait"><img src="${img}" alt="">${group != null ? `<span class="gnum">${group}</span>` : ''}
      <div class="pinfo"><b>${esc(name)}</b><span class="hpbar"><i style="width:${(hp / max) * 100}%;background:${hpColor(hp / max)}"></i></span>
      <span class="pnum">${Math.ceil(hp)} / ${max}${repairing ? ' · wird repariert' : ''}</span><span class="pstats">${extra}</span></div></div>`;
  }

  private onPointer(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || e.button !== 0 || (el as HTMLButtonElement).disabled) return;
    const v = this.view, ids = v.ownSelected().map((u) => u.id);
    switch (el.dataset.act) {
      case 'move': v.setMode(v.mode() === 'move' ? 'none' : 'move'); break;
      case 'attack': v.setMode(v.mode() === 'attack' ? 'none' : 'attack'); break;
      case 'repair': {
        const b = v.map.buildings.find((x) => x.id === v.selBuilding && x.faction === PLAYER);
        if (b) this.game.issue({ type: 'repair', province: v.id, building: b.id, on: !b.repairing });
        else v.setMode(v.mode() === 'repair' ? 'none' : 'repair');
        break;
      }
      case 'blast': {
        const b = v.map.buildings.find((x) => x.id === v.selBuilding && x.faction === PLAYER);
        if (b) this.game.ask(`${BUILDINGS[b.type].name} sprengen? Du erhältst einen Teil der Baukosten zurück.`, () => this.game.issue({ type: 'sell', province: v.id, building: b.id }));
        break;
      }
      case 'stop': this.game.issue({ type: 'stop', province: v.id, ids }); break;
      case 'send': this.sendOpen = !this.sendOpen; break;
      case 'sendto': this.game.issue({ type: 'transfer', province: v.id, ids, to: el.dataset.to! }); v.sel.clear(); this.sendOpen = false; break;
      case 'only': v.sel.clear(); v.sel.add(Number(el.dataset.id)); break;
    }
    v.refreshUi();
  }
}

function hpColor(f: number) { return f > 0.6 ? '#5fbf3f' : f > 0.3 ? '#e2b33c' : '#d8432f'; }
