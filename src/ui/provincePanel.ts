// Seitenleiste der Detailkarte: Minikarte, Reiter (Gebäude, Einheiten, Forschung, Dörfer) mit Bildkarten
// und die Produktionswarteschlange. Auswahl und Befehle stehen in der unteren Befehlsleiste.
import type { Game } from '../game';
import type { ProvinceView } from '../render/province';
import { BUILDINGS, PLAYER, RESEARCH, RES_KEYS, UNITS, type Cost } from '../sim/defs';
import { hasResearch, missingResearch, researchBlocked } from '../sim/diplomacy';
import { FACTORY_KINDS, type FactoryKind } from '../sim/types';
import { powerInfo } from '../sim/sim';
import { buildRequirementError, queuesOf, seaAccess } from '../sim/world';
import { costHtml, esc, fmt, icon } from './dom';
import { thumb } from './thumbs';
import { handleVillageAction, statusText, villageHtml } from './village';

type Tab = 'bauen' | 'einheiten' | 'forschung' | 'doerfer';
const TABS: [Tab, string, string][] = [
  ['bauen', 'Gebäude', '<svg viewBox="0 0 20 20"><path d="M2 18V9l5-3v3l5-3v3l5-3v12z" fill="currentColor"/></svg>'],
  ['einheiten', 'Einheiten', '<svg viewBox="0 0 20 20"><circle cx="10" cy="5" r="3" fill="currentColor"/><path d="M4 18c0-5 3-8 6-8s6 3 6 8z" fill="currentColor"/></svg>'],
  ['forschung', 'Forschung', '<svg viewBox="0 0 20 20"><path d="M7 2h6v2h-1v5l5 8H3l5-8V4H7z" fill="currentColor"/></svg>'],
  ['doerfer', 'Dörfer', '<svg viewBox="0 0 20 20"><path d="M2 18v-7l5-4 5 4v7zM12 18v-9l3-3 3 3v9z" fill="currentColor"/></svg>'],
];
const MIN_QUEUE_ROWS = 3;

/** Kosten kurz: Mark groß, übrige Rohstoffe klein */
function cardCost(c: Cost, res: Record<string, number>) {
  return RES_KEYS.filter((k) => c[k]).map((k) => `<span class="cc${res[k] < (c[k] ?? 0) ? ' short' : ''}">${icon(`icon.${k}`, 'ico s')}${fmt(c[k]!)}</span>`).join('');
}
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.max(0, Math.ceil(s % 60)) % 60).padStart(2, '0')}`;

export class ProvincePanel {
  private tab: Tab = 'bauen';
  private mini!: HTMLCanvasElement;
  private dyn!: HTMLElement;
  private last = '';
  private lastVillage: string | null = null;

  constructor(private game: Game, private view: ProvinceView) {}

  mount(signal: AbortSignal) {
    this.game.sidebarTop.innerHTML = `<div class="minimapframe"><canvas class="minimap" width="320" height="160"></canvas><i class="br tl"></i><i class="br tr"></i><i class="br bl"></i><i class="br br2"></i><span class="north">N</span></div>`;
    this.mini = this.game.sidebarTop.querySelector('.minimap')!;
    const sb = this.game.sidebar;
    sb.className = 'province';
    sb.innerHTML = `<div class="dyn"></div>`;
    this.dyn = sb.querySelector('.dyn')!;
    this.last = '';
    sb.addEventListener('pointerdown', (e) => this.onPointer(e), { signal });
    sb.addEventListener('contextmenu', (e) => e.preventDefault(), { signal });
    signal.addEventListener('abort', () => { this.game.sidebarTop.innerHTML = ''; });
    let dragging = false;
    const moveCam = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      const map = this.view.map;
      const k = this.mini.width / (map.w + map.h);
      const mx = ((e.clientX - r.left) / r.width) * this.mini.width, my = ((e.clientY - r.top) / r.height) * this.mini.height;
      const a = mx / k - map.h, b = (2 * my) / k; // a = x - y, b = x + y
      this.view.centerOn((a + b) / 2, (b - a) / 2);
    };
    this.mini.addEventListener('pointerdown', (e) => { dragging = true; this.mini.setPointerCapture(e.pointerId); moveCam(e); }, { signal });
    this.mini.addEventListener('pointermove', (e) => dragging && moveCam(e), { signal });
    this.mini.addEventListener('pointerup', () => (dragging = false), { signal });
    this.render(true);
  }

  // ---------- Minikarte (jeden Frame) ----------
  drawMinimap() {
    const g = this.mini?.getContext('2d');
    const v = this.view;
    if (!g || !v.miniBase) return;
    const map = v.map;
    const k = this.mini.width / (map.w + map.h);
    const P = (tx: number, ty: number): [number, number] => [(tx - ty + map.h) * k, ((tx + ty) * k) / 2];
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = '#0b0d0e';
    g.fillRect(0, 0, this.mini.width, this.mini.height);
    g.save();
    g.setTransform(k, k / 2, -k, k / 2, map.h * k, 0);
    g.imageSmoothingEnabled = true;
    g.filter = 'saturate(0.7) brightness(0.85)';
    g.drawImage(v.miniBase, 0, 0);
    g.filter = 'none';
    for (const vil of this.game.state.provinces[v.id].villages) {
      if (!v.villageShown(vil)) continue;
      g.fillStyle = '#b9ab88';
      g.fillRect(vil.x - 1, vil.y - 1, 3, 3);
    }
    g.drawImage(v.fog, -1, -1);
    g.restore();
    const col = (f: string) => (f === PLAYER ? '#5fdc4a' : f === 'neutral' ? '#c9c19a' : '#e8402e');
    for (const b of map.buildings) {
      if (!v.buildingShown(b)) continue;
      const s = BUILDINGS[b.type].size;
      const [x, y] = P(b.x + s / 2, b.y + s / 2);
      g.fillStyle = col(b.faction);
      g.fillRect(x - 3, y - 3, 6, 6);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 1; g.strokeRect(x - 3, y - 3, 6, 6);
    }
    for (const u of map.units) {
      if (!v.unitShown(u)) continue;
      const [x, y] = P(u.x, u.y);
      g.fillStyle = col(u.faction);
      g.beginPath(); g.moveTo(x, y - 3.5); g.lineTo(x + 3.2, y + 2.5); g.lineTo(x - 3.2, y + 2.5); g.closePath(); g.fill();
    }
    const c = v.viewCorners().map(([x, y]) => P(x, y));
    g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(c[0][0], c[0][1]); for (const p of c.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.stroke();
  }

  // ---------- Inhalt (4× pro Sekunde) ----------
  render(force = false) {
    if (!this.dyn) return;
    const v = this.view;
    // Dorf angeklickt: Dörfer-Reiter mit diesem Dorf zeigen
    if (v.selVillage && v.selVillage !== this.lastVillage) this.tab = 'doerfer';
    this.lastVillage = v.selVillage;
    let html = `<div class="tabs">${TABS.map(([t, name, svg]) => `<button data-tab="${t}" class="${this.tab === t ? 'on' : ''}">${svg}<span>${name}</span></button>`).join('')}</div>`;
    const body = { bauen: () => this.buildTab(), einheiten: () => this.unitTab(), forschung: () => this.researchTab(), doerfer: () => this.villageTab() }[this.tab]();
    html += `<div class="tabbody">${body}</div>`;
    html += this.queueHtml();
    if (!force && html === this.last) return;
    this.last = html;
    this.dyn.innerHTML = html;
  }

  private card(act: string, type: string, name: string, img: string, cost: Cost, opts: { cls?: string; state?: string; fill?: number; badge?: number; title: string }) {
    const res = this.game.state.factions[PLAYER].res;
    return `<button class="card ${opts.cls ?? ''}" data-act="${act}" data-type="${type}" title="${esc(opts.title)}">
      <img src="${img}" alt="">
      ${opts.fill != null ? `<i class="cfill" style="width:${opts.fill * 100}%"></i>` : ''}
      ${opts.badge ? `<span class="badge">${opts.badge}</span>` : ''}
      <span class="cinfo"><b>${esc(name)}</b><span class="ccost">${cardCost(cost, res)}</span></span>
      ${opts.state ? `<span class="cstate">${opts.state}</span>` : ''}
    </button>`;
  }

  private buildTab(): string {
    const s = this.game.state;
    const prov = s.provinces[this.view.id];
    const map = this.view.map;
    const q = queuesOf(map, PLAYER);
    const hasHq = map.buildings.some((b) => b.faction === PLAYER && b.type === 'bauhof');
    if (!hasHq && prov.owner !== PLAYER) {
      return `<p class="hint">Hier hast du keinen Bauhof. Erobere die Provinz – zerstöre alle feindlichen Truppen und Gebäude bzw. besiege die Miliz –, dann kannst du einen Bauhof errichten.</p>`;
    }
    const types = hasHq ? Object.keys(BUILDINGS).filter((t) => t !== 'bauhof') : ['bauhof'];
    let html = hasHq ? '' : `<p class="hint">Diese Provinz gehört dir, hat aber noch keinen Bauhof. Errichte einen, um hier bauen zu können.</p>`;
    html += '<div class="cards">';
    for (const t of types) {
      const def = BUILDINGS[t];
      const err = missingResearch(s, PLAYER, def.research) ?? buildRequirementError(s, map, PLAYER, t);
      const cur = q.struct?.type === t ? q.struct : null;
      let state = '', cls = '';
      if (cur?.ready) { state = 'Platzieren'; cls = 'ready'; }
      else if (cur) state = `${Math.floor((cur.progress / cur.total) * 100)} %`;
      else if (err) { state = esc(err); cls = 'locked'; }
      else if (q.struct) cls = 'busy';
      html += this.card('build', t, def.name, thumb(def.sprite, 160, 100), def.cost, {
        cls, state, fill: cur && !cur.ready ? cur.progress / cur.total : undefined,
        title: `${def.name}: ${def.desc}${def.power ? ` Strom ${def.power > 0 ? '+' : ''}${def.power}.` : ''} Rechtsklick bricht den Bau ab.`,
      });
    }
    return html + '</div>';
  }

  private unitTab(): string {
    const s = this.game.state;
    const map = this.view.map;
    const q = queuesOf(map, PLAYER);
    let html = '';
    for (const from of FACTORY_KINDS) {
      if (from === 'werft' && !seaAccess(this.view.id)) continue; // Binnenprovinz: keine Schiffe
      const has = map.buildings.some((b) => b.faction === PLAYER && b.type === from);
      q[from] ??= [];
      html += `<div class="sub">${BUILDINGS[from].name}${has ? '' : ' <small>– nicht vorhanden</small>'}</div><div class="cards">`;
      for (const [t, def] of Object.entries(UNITS)) {
        if (def.from !== from) continue;
        const queued = q[from].filter((i) => i.type === t).length;
        const head = q[from][0]?.type === t ? q[from][0] : null;
        const lock = missingResearch(s, PLAYER, def.research);
        html += this.card('train', t, def.name, thumb(def.sprite, 160, 100, { ground: def.domain === 'see' ? 'wasser' : 'erde', air: def.armor === 'luft' }), def.cost, {
          cls: has && !lock ? '' : 'locked', state: lock ? esc(lock.replace('Benötigt Forschung ', '')) : undefined,
          fill: head ? head.progress / head.total : undefined, badge: queued,
          title: `${def.name}: ${def.hp} LP, Reichweite ${def.range}, Schaden ${def.damage}${def.armor === 'luft' ? ', fliegt' : ''}. Rechtsklick entfernt aus der Warteschlange.`,
        });
      }
      html += '</div>';
    }
    return html;
  }

  private researchTab(): string {
    const s = this.game.state;
    const fac = s.factions[PLAYER];
    const cur = fac.research.current;
    let html = `<p class="hint">Forschung gilt für das ganze Reich und braucht ein Forschungszentrum in einer deiner Provinzen. Rechtsklick bricht ab (volle Erstattung).</p>`;
    for (const [id, def] of Object.entries(RESEARCH)) {
      const done = hasResearch(s, PLAYER, id);
      const running = cur?.type === id;
      const block = done || running ? null : researchBlocked(s, PLAYER, id);
      const state = done ? '<b class="pos">✓ erforscht</b>' : running ? `<b>${Math.floor((cur!.progress / cur!.total) * 100)} %</b>` : block ? `<small class="lockt">${esc(block)}</small>` : costHtml(def.cost, fac.res);
      html += `<button class="row research ${done ? 'done' : ''} ${block ? 'locked' : ''}" data-act="research" data-id="${id}" ${done ? 'disabled' : ''}>
        ${running ? `<i class="fill" style="width:${(cur!.progress / cur!.total) * 100}%"></i>` : ''}
        <span><b>${esc(def.name)}</b> <small>${esc(def.desc)} (${def.time} s)</small></span><span>${state}</span></button>`;
    }
    return html;
  }

  private villageTab(): string {
    const prov = this.game.state.provinces[this.view.id];
    const sel = this.view.selVillage;
    return prov.villages.map((v) => v.id === sel
      ? `<div class="vlist open">${villageHtml(this.game, prov.id, v)}</div>`
      : `<button class="row" data-act="focusVillage" data-village="${v.id}">
      <span><b>${esc(v.name)}</b> <small class="st-${v.status}">${esc(statusText(v, prov.owner))}</small></span>
      <span>${fmt(v.pop)} ${icon('icon.einwohner', 'ico s')} · ${fmt(v.income)} T/min</span></button>`).join('')
      + `<p class="hint">Steuersatz für Stammdörfer oben einstellen. Besetzte Dörfer bleiben ruhiger, wenn Truppen in der Nähe stehen.</p>`;
  }

  // ---------- Produktionswarteschlange ----------
  private queueHtml(): string {
    const map = this.view.map;
    const q = queuesOf(map, PLAYER);
    const pf = powerInfo(this.game.state, map, PLAYER).factor;
    type Row = { kind: 'bau' | FactoryKind; type: string; name: string; sprite: string; frac: number; left: number; ready?: boolean };
    const rows: Row[] = [];
    if (q.struct) {
      const d = BUILDINGS[q.struct.type];
      rows.push({ kind: 'bau', type: q.struct.type, name: d.name, sprite: d.sprite, frac: q.struct.progress / q.struct.total, left: (q.struct.total - q.struct.progress) / pf, ready: q.struct.ready });
    }
    for (const kind of FACTORY_KINDS) {
      let wait = 0;
      for (const it of q[kind] ?? []) {
        const d = UNITS[it.type];
        const left = wait + (it.total - it.progress) / pf;
        rows.push({ kind, type: it.type, name: d.name, sprite: d.sprite, frac: it.progress / it.total, left });
        wait = left;
      }
    }
    let html = `<div class="queue"><div class="qhead">Produktionswarteschlange</div>`;
    rows.forEach((r, i) => {
      html += `<div class="qrow"><span class="qn">${i + 1}</span><img src="${thumb(r.sprite, 64, 40)}" alt="">
        <div class="qmid"><b>${esc(r.name)}</b><span class="qbar"><i style="width:${Math.min(1, r.frac) * 100}%"></i></span></div>
        <span class="qtime">${r.ready ? 'bereit' : mmss(r.left)}</span>
        <button class="qx" data-act="${r.kind === 'bau' ? 'cancelBuild' : 'cancelTrain'}" data-type="${r.type}" title="Abbrechen (volle Erstattung)">✕</button></div>`;
    });
    for (let i = rows.length; i < MIN_QUEUE_ROWS; i++) html += `<div class="qrow free"><span class="qn"></span><span class="qempty"></span><div class="qmid"><span>Freier Platz</span></div></div>`;
    return html + '</div>';
  }

  private onPointer(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab]');
    if (!el) return;
    const right = e.button === 2;
    const v = this.view;
    if (el.dataset.tab) { this.tab = el.dataset.tab as Tab; if (this.tab !== 'doerfer') v.selVillage = null; this.render(true); return; }
    if (!right && handleVillageAction(this.game, el)) return;
    const type = el.dataset.type!;
    switch (el.dataset.act) {
      case 'build': {
        const q = queuesOf(v.map, PLAYER);
        if (right) { if (q.struct?.type === type) this.game.issue({ type: 'cancelBuild', province: v.id }); return; }
        if (BUILDINGS[type].wall) { v.setLineMode(type); return; }
        if (q.struct?.type === type && q.struct.ready) { v.setMode('place'); return; }
        if (!q.struct) this.game.issue({ type: 'build', province: v.id, building: type });
        return;
      }
      case 'cancelBuild': this.game.issue({ type: 'cancelBuild', province: v.id }); return;
      case 'cancelTrain': this.game.issue({ type: 'cancelTrain', province: v.id, unit: type }); return;
      case 'research':
        if (right) { if (this.game.state.factions[PLAYER].research.current?.type === el.dataset.id) this.game.issue({ type: 'cancelResearch' }); return; }
        this.game.issue({ type: 'research', id: el.dataset.id! });
        return;
      case 'train':
        this.game.issue(right ? { type: 'cancelTrain', province: v.id, unit: type } : { type: 'train', province: v.id, unit: type });
        return;
      case 'focusVillage': {
        const vil = this.game.state.provinces[v.id].villages.find((x) => x.id === el.dataset.village);
        if (vil) { v.centerOn(vil.x + 0.5, vil.y + 0.5); v.sel.clear(); v.selBuilding = null; v.selVillage = vil.id; this.render(true); }
        return;
      }
    }
  }
}
