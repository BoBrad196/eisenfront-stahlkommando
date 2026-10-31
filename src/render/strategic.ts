// Strategiekarte: Europa mit Provinzen, Besitzverhältnissen und Truppenbewegungen
import { assets } from '../assets';
import type { Game, View } from '../game';
import { BUILDINGS, ECON, FACTIONS, GEO, NEUTRAL, PLAYER, PROVINCES, PROVINCE_BY_ID, UNITS } from '../sim/defs';
import { ceasefireWillingness, RELATION_NAMES } from '../sim/diplomacy';
import type { GameState, ProvinceState } from '../sim/types';
import { factionName, provName, seaAccess } from '../sim/world';
import { esc, fmt, icon } from '../ui/dom';
import { TouchGestures } from '../ui/touch';
import { handleVillageAction, villageHtml } from '../ui/village';

const TERRAIN_NAMES: Record<string, string> = { flach: 'Flachland', huegel: 'Hügelland', berge: 'Gebirge', wald: 'Waldland', kueste: 'Küste' };

export class StrategicView implements View {
  selected: string | null = null;
  private hover: string | null = null;
  private cam = { x: 0, y: 0, zoom: 0 };
  private paths = new Map<string, Path2D>();
  private backdrop = new Path2D();
  private abort: AbortController | null = null;
  private drag: { sx: number; sy: number; cx: number; cy: number; moved: boolean } | null = null;
  private time = 0;
  private villageOpen: string | null = null;

  constructor(private game: Game) {
    for (const [id, geo] of Object.entries(GEO.provinces)) {
      const p = new Path2D();
      for (const poly of geo.poly) for (const ring of poly) {
        ring.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
        p.closePath();
      }
      this.paths.set(id, p);
    }
    for (const poly of GEO.backdrop) for (const ring of poly) {
      ring.forEach(([x, y], i) => (i ? this.backdrop.lineTo(x, y) : this.backdrop.moveTo(x, y)));
      this.backdrop.closePath();
    }
  }

  enter() {
    const c = this.game.canvas;
    this.abort = new AbortController();
    const o = { signal: this.abort.signal };
    if (!this.cam.zoom) this.fitPlayer();
    c.addEventListener('pointerdown', (e) => this.onDown(e), o);
    c.addEventListener('pointermove', (e) => this.onMove(e), o);
    c.addEventListener('pointerup', (e) => this.onUp(e), o);
    c.addEventListener('dblclick', (e) => {
      const id = this.pick(e.offsetX, e.offsetY);
      if (id) this.game.enterProvince(id);
    }, o);
    new TouchGestures(c, {
      tap: (x, y) => { this.selected = this.pick(x, y); this.villageOpen = null; this.updatePanel(true); if (this.selected) document.getElementById('main')?.classList.add('sb-open'); },
      doubleTap: (x, y) => { const id = this.pick(x, y); if (id) this.game.enterProvince(id); },
      pan: (dx, dy) => { this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); },
      pinch: (f, cx, cy, dx, dy) => { this.zoomAt(f, cx, cy); this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); },
    }, o.signal);
    c.addEventListener('wheel', (e) => this.onWheel(e), { ...o, passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    this.game.sidebar.addEventListener('pointerdown', (e) => this.onPanel(e), o);
    this.game.sidebar.className = 'strategic';
    this.game.sidebarTop.innerHTML = '';
    this.game.sceneTag.innerHTML = '<b>EU</b><span>/</span>LAGEKARTE EUROPA';
    this.updatePanel(true);
  }
  leave() { this.abort?.abort(); this.abort = null; }

  private fitPlayer() {
    const w = this.game.viewW || 800, h = this.game.viewH || 600;
    this.cam.zoom = Math.max(w / GEO.width, h / GEO.height) * 1.6;
    const own = Object.values(this.game.state.provinces).filter((p) => p.owner === PLAYER);
    const c = own.length ? GEO.provinces[own[0].id].center : [GEO.width / 2, GEO.height / 2];
    this.cam.x = c[0] - w / 2 / this.cam.zoom;
    this.cam.y = c[1] - h / 2 / this.cam.zoom;
  }
  private toWorld(sx: number, sy: number): [number, number] { return [sx / this.cam.zoom + this.cam.x, sy / this.cam.zoom + this.cam.y]; }
  private pick(sx: number, sy: number): string | null {
    const [x, y] = this.toWorld(sx, sy);
    const g = this.game.g;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    let hit: string | null = null;
    for (const [id, p] of this.paths) if (g.isPointInPath(p, x, y)) { hit = id; break; }
    g.restore();
    return hit;
  }
  private clampCam() {
    const w = this.game.viewW, h = this.game.viewH;
    const minZoom = Math.min(w / GEO.width, h / GEO.height) * 0.9;
    this.cam.zoom = Math.max(minZoom, Math.min(3, this.cam.zoom));
    const vw = w / this.cam.zoom, vh = h / this.cam.zoom;
    this.cam.x = Math.max(-vw * 0.5, Math.min(GEO.width - vw * 0.5, this.cam.x));
    this.cam.y = Math.max(-vh * 0.5, Math.min(GEO.height - vh * 0.5, this.cam.y));
  }

  private onDown(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    this.game.canvas.setPointerCapture(e.pointerId);
    this.drag = { sx: e.offsetX, sy: e.offsetY, cx: this.cam.x, cy: this.cam.y, moved: false };
  }
  private onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    if (this.drag) {
      const dx = e.offsetX - this.drag.sx, dy = e.offsetY - this.drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 5) this.drag.moved = true;
      if (this.drag.moved) {
        this.cam.x = this.drag.cx - dx / this.cam.zoom;
        this.cam.y = this.drag.cy - dy / this.cam.zoom;
        this.clampCam();
      }
    }
    this.hover = this.pick(e.offsetX, e.offsetY);
    this.game.canvas.style.cursor = this.hover ? 'pointer' : 'default';
  }
  private onUp(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    if (this.drag && !this.drag.moved && e.button === 0) {
      this.selected = this.pick(e.offsetX, e.offsetY);
      this.villageOpen = null;
      this.updatePanel(true);
    }
    this.drag = null;
  }
  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY);
  }
  private zoomAt(factor: number, ox: number, oy: number) {
    const [wx, wy] = this.toWorld(ox, oy);
    this.cam.zoom *= factor;
    this.clampCam();
    this.cam.x = wx - ox / this.cam.zoom;
    this.cam.y = wy - oy / this.cam.zoom;
    this.clampCam();
  }

  render(g: CanvasRenderingContext2D, w: number, h: number, _alpha: number, dt: number) {
    this.time += dt;
    const s = this.game.state;
    const z = this.cam.zoom;
    g.fillStyle = '#16293d';
    g.fillRect(0, 0, w, h);
    g.save();
    g.scale(z, z);
    g.translate(-this.cam.x, -this.cam.y);
    g.fillStyle = '#3b3f42';
    g.fill(this.backdrop);

    for (const [id, p] of this.paths) {
      const prov = s.provinces[id];
      g.fillStyle = FACTIONS[prov.owner].color;
      g.globalAlpha = prov.owner === NEUTRAL ? 0.85 : 0.92;
      g.fill(p);
      g.globalAlpha = 1;
      if (id === this.hover && id !== this.selected) { g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(p); }
    }
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(20,20,20,0.75)';
    g.lineWidth = 1.4 / z;
    for (const p of this.paths.values()) g.stroke(p);
    if (this.selected) {
      g.strokeStyle = '#fff';
      g.lineWidth = 3.5 / z;
      g.stroke(this.paths.get(this.selected)!);
      // Nachbarn markieren
      const c = GEO.provinces[this.selected].center;
      g.setLineDash([6 / z, 6 / z]);
      for (const n of GEO.provinces[this.selected].neighbors) {
        const d = GEO.provinces[n.id].center;
        g.strokeStyle = n.see ? 'rgba(120,220,255,0.8)' : 'rgba(255,255,255,0.5)';
        g.lineWidth = 1.5 / z;
        g.beginPath(); g.moveTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.stroke();
      }
      g.setLineDash([]);
    }

    // Truppenbewegungen
    for (const t of s.transits) {
      const a = GEO.provinces[t.from].center, b = GEO.provinces[t.to].center;
      const col = FACTIONS[t.faction].color;
      g.strokeStyle = t.hostile ? '#ff4040' : col;
      g.lineWidth = (t.hostile ? 4 : 3) / z;
      g.setLineDash([10 / z, 6 / z]);
      g.lineDashOffset = -this.time * 30 / z;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
      g.setLineDash([]);
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const hx = b[0] - Math.cos(ang) * 18, hy = b[1] - Math.sin(ang) * 18;
      g.fillStyle = t.hostile ? '#ff4040' : col;
      g.beginPath();
      g.moveTo(hx + Math.cos(ang) * 12, hy + Math.sin(ang) * 12);
      g.lineTo(hx + Math.cos(ang + 2.5) * 12, hy + Math.sin(ang + 2.5) * 12);
      g.lineTo(hx + Math.cos(ang - 2.5) * 12, hy + Math.sin(ang - 2.5) * 12);
      g.fill();
    }
    g.restore();

    // Beschriftungen in Bildschirmkoordinaten
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fs = Math.max(10, Math.min(16, 11 * z * 1.6));
    const known = knownProvinces(s);
    for (const def of PROVINCES) {
      const prov = s.provinces[def.id];
      const [cx, cy] = GEO.provinces[def.id].center;
      const sx = (cx - this.cam.x) * z, sy = (cy - this.cam.y) * z;
      if (sx < -80 || sy < -40 || sx > w + 80 || sy > h + 40) continue;
      g.font = `${def.id === this.selected ? 'bold ' : ''}${fs}px system-ui, sans-serif`;
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.65)';
      g.strokeText(def.name, sx, sy);
      g.fillStyle = '#fff';
      g.fillText(def.name, sx, sy);
      let bx = sx - 20;
      const by = sy + fs * 0.95;
      if (prov.map?.buildings.some((b) => b.type === 'bauhof' && b.faction === prov.owner)) {
        assets.draw(g, 'icon.bauhof', bx - 7, by - 7, 14, 14); bx += 16;
      }
      const forces = known.has(def.id) ? forceCount(prov) : -1;
      if (forces) {
        g.font = `bold ${Math.round(fs * 0.8)}px system-ui, sans-serif`;
        g.fillStyle = 'rgba(0,0,0,0.55)';
        const txt = forces < 0 ? '⚔?' : `⚔${forces}`;
        const tw = g.measureText(txt).width + 6;
        g.fillRect(bx - 3, by - 7, tw, 14);
        g.fillStyle = '#fff';
        g.textAlign = 'left';
        g.fillText(txt, bx, by);
        g.textAlign = 'center';
        bx += tw + 2;
      }
      if (z > 0.75) {
        for (const k of ['kohle', 'eisen', 'gold'] as const) {
          if (def.deposits[k]) { assets.draw(g, `icon.${k}`, bx - 6, by - 6, 12, 12); bx += 13; }
        }
      }
      if (s.transits.some((t) => t.hostile && t.to === def.id && prov.owner === PLAYER)) {
        const pulse = 0.6 + 0.4 * Math.sin(this.time * 8);
        g.globalAlpha = pulse;
        assets.draw(g, 'icon.angriff', sx - 10, sy - fs * 2.2, 20, 20);
        g.globalAlpha = 1;
      }
    }
  }

  // ---------- Seitenleiste ----------
  private lastPanel = '';
  updatePanel(force = false) {
    const html = this.selected ? this.provincePanel(this.selected) : this.overviewPanel();
    if (!force && html === this.lastPanel) return;
    this.lastPanel = html;
    this.game.sidebar.innerHTML = html;
  }

  private overviewPanel(): string {
    const s = this.game.state;
    const rows = Object.entries(FACTIONS).map(([id, f]) => {
      const provs = Object.values(s.provinces).filter((p) => p.owner === id);
      const pop = provs.reduce((a, p) => a + p.villages.reduce((b, v) => b + v.pop, 0), 0);
      return `<div class="frow"><span class="sw" style="background:${f.color}"></span><b>${esc(f.name)}</b>
        <span>${provs.length} Prov.</span><span>${fmt(pop)} Einw.</span>${s.factions[id].alive || id === NEUTRAL ? '' : '<em>besiegt</em>'}</div>`;
    }).join('');
    return `<div class="panel">
      <h2>Europa</h2>
      <p class="hint">${document.body.classList.contains('touch') ? 'Provinz antippen für Details. Doppeltippen öffnet die Detailkarte. Ein Finger verschiebt, zwei Finger zoomen.' : 'Klicke eine Provinz an für Details. Doppelklick öffnet die Detailkarte. Ziehen = verschieben, Mausrad = zoomen.'}</p>
      <div class="sub">Mächte</div>${rows}
      ${this.diplomacyHtml()}
      <div class="sub">So verdienst du Geld</div>
      <ul class="hint">
        <li><b>Steuern</b> aus deinen Stammdörfern (Steuersatz oben)</li>
        <li><b>Besatzungsabgaben</b> aus eroberten Dörfern</li>
        <li><b>Schutzgebühr</b> von fremden Dörfern, wenn deine Truppen dort stehen</li>
        <li><b>Plünderung</b> – schnell, aber die Dörfer leiden</li>
        <li><b>Bergwerke</b> auf Kohle-, Eisen- und Goldvorkommen</li>
      </ul></div>`;
  }

  private diplomacyHtml(): string {
    const s = this.game.state;
    const D = ECON.diplomacy;
    let html = `<div class="sub">Diplomatie</div>`;
    for (const [fid, d] of Object.entries(s.diplomacy ?? {})) {
      if (!s.factions[fid].alive) continue;
      const f = FACTIONS[fid];
      const will = Math.round(ceasefireWillingness(s, fid));
      const h = Math.round(d.haltung);
      const waitAlliance = Math.max(0, Math.ceil(d.since + D.allianceAfter - s.time));
      html += `<div class="diplo rel-${d.rel}">
        <div class="dhead"><span class="sw" style="background:${f.color}"></span><b>${esc(f.name)}</b><span class="chip-rel">${RELATION_NAMES[d.rel]}</span></div>
        <div class="kv"><span>Haltung</span><b class="${h < 0 ? 'neg' : 'pos'}">${h > 0 ? '+' : ''}${h}</b></div>
        <span class="hbar"><i style="left:${50 + Math.min(0, h) / 2}%;width:${Math.abs(h) / 2}%;background:${h < 0 ? 'var(--bad)' : 'var(--good)'}"></i></span>
        <div class="btns">`;
      if (d.rel === 'krieg') html += `<button data-act="diplo" data-f="${fid}" data-a="waffenstillstand" title="Bereitschaft ${will} (nötig ${D.ceasefireNeeds}). Schwächere Mächte sind eher bereit.">Waffenstillstand <small>${will}/${D.ceasefireNeeds}</small></button>`;
      if (d.rel === 'waffenstillstand') html += `<button data-act="diplo" data-f="${fid}" data-a="buendnis" title="Haltung ${D.allianceNeeds} nötig${waitAlliance ? `, frühestens in ${waitAlliance} s` : ''}. Bündnis: gemeinsame Sicht, +${Math.round(D.allianceIncomeBonus * 100)} % Handelseinnahmen.">Bündnis <small>${waitAlliance ? `${waitAlliance} s` : `${h}/${D.allianceNeeds}`}</small></button>`;
      html += `<button data-act="diplo" data-f="${fid}" data-a="geschenk" title="+${D.giftHaltung} Haltung">Geschenk <small>${fmt(D.giftAmount)} T</small></button>`;
      if (d.rel !== 'krieg') html += `<button class="danger" data-act="diplo" data-f="${fid}" data-a="krieg" title="Bricht den Vertrag. Senkt die Haltung aller Mächte.">Krieg erklären</button>`;
      html += `</div></div>`;
    }
    return html;
  }

  private provincePanel(id: string): string {
    const s = this.game.state;
    const prov = s.provinces[id];
    const def = PROVINCE_BY_ID[id];
    const owner = prov.owner;
    const income = prov.villages.reduce((a, v) => a + v.income, 0);
    let html = `<div class="panel">
      <div class="ptitle"><h2>${esc(def.name)}</h2><button data-act="close" title="Schließen">✕</button></div>
      <div class="owner"><span class="sw" style="background:${FACTIONS[owner].color}"></span>${esc(factionName(owner))}${s.diplomacy?.[owner] ? ` · ${RELATION_NAMES[s.diplomacy[owner].rel]}` : ''}</div>
      <div class="kv"><span>Gelände</span><b>${TERRAIN_NAMES[def.terrain]}${seaAccess(id) ? ' · Meerzugang ⚓' : ''}</b></div>
      <div class="kv"><span>Einnahmen der Dörfer</span><b>${fmt(income)} T/min</b></div>
      <div class="kv"><span>Vorkommen</span><b>${(['kohle', 'eisen', 'gold'] as const).map((k) => def.deposits[k] ? `${icon(`icon.${k}`)}${def.deposits[k]}` : '').join(' ') || '–'}</b></div>
      <button class="primary" data-act="enter">Detailkarte öffnen</button>`;

    // Truppen
    html += `<div class="sub">Truppen</div>`;
    if (!knownProvinces(s).has(id)) {
      html += `<p class="hint">Keine Aufklärung. Erobere eine Nachbarprovinz oder schicke Truppen hinein, um Truppen und Gebäude zu sehen.</p>`;
    } else if (prov.map) {
      const byFaction: Record<string, Record<string, number>> = {};
      for (const u of prov.map.units) ((byFaction[u.faction] ??= {})[u.type] = (byFaction[u.faction]?.[u.type] ?? 0) + 1);
      const entries = Object.entries(byFaction);
      if (!entries.length) html += `<p class="hint">Keine Truppen.</p>`;
      for (const [f, types] of entries) {
        html += `<div class="troops"><span class="sw" style="background:${FACTIONS[f].color}"></span>${Object.entries(types).map(([t, n]) => `${n}× ${UNITS[t].name}`).join(', ')}</div>`;
      }
      const blds = prov.map.buildings.filter((b) => b.faction === owner);
      if (blds.length) {
        const counts: Record<string, number> = {};
        for (const b of blds) counts[b.type] = (counts[b.type] ?? 0) + 1;
        html += `<div class="sub">Gebäude</div><p class="hint">${Object.entries(counts).map(([t, n]) => `${n > 1 ? `${n}× ` : ''}${BUILDINGS[t].name}`).join(', ')}</p>`;
      }
    } else {
      html += `<p class="hint">${prov.garrison.length ? `Aufklärung: etwa ${prov.garrison.length} Einheiten (${esc(factionName(owner))})` : 'Keine Truppen bekannt.'}</p>`;
    }

    // Truppen verlegen
    const mine = prov.map?.units.filter((u) => u.faction === PLAYER) ?? [];
    if (mine.length) {
      html += `<div class="sub">Alle ${mine.length} eigenen Einheiten verlegen nach</div><div class="neighbors">`;
      for (const n of GEO.provinces[id].neighbors) {
        const t = s.provinces[n.id];
        const hostile = t.owner !== PLAYER;
        html += `<button data-act="send" data-to="${n.id}" class="${hostile ? 'danger' : ''}"><span class="sw" style="background:${FACTIONS[t.owner].color}"></span>${esc(provName(n.id))}${n.see ? ' ⚓' : ''}${hostile ? ' ⚔' : ''}</button>`;
      }
      html += `</div>`;
    }
    const incoming = s.transits.filter((t) => t.to === id);
    for (const t of incoming) {
      html += `<p class="${t.hostile ? 'alarm' : 'hint'}">${t.hostile ? '⚠ ' : ''}${esc(factionName(t.faction))}: ${t.units.length} Einheiten aus ${esc(provName(t.from))}, Ankunft in ${Math.ceil(t.arrive - s.time)} s</p>`;
    }

    html += `<div class="sub">Dörfer</div>`;
    for (const v of prov.villages) {
      const open = this.villageOpen === v.id;
      html += `<div class="vlist ${open ? 'open' : ''}" data-act="village" data-village="${v.id}">${villageHtml(this.game, id, v, !open)}</div>`;
    }
    return html + '</div>';
  }

  private onPanel(e: PointerEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || e.button !== 0) return;
    const act = el.dataset.act;
    if (handleVillageAction(this.game, el)) return;
    if (act === 'close') this.selected = null;
    if (act === 'diplo') {
      const a = el.dataset.a as 'waffenstillstand' | 'buendnis' | 'geschenk' | 'krieg';
      const issue = () => this.game.issue({ type: 'diplomacy', target: el.dataset.f!, action: a });
      if (a === 'krieg') this.game.ask(`${FACTIONS[el.dataset.f!].name} den Krieg erklären? Das ist ein Vertragsbruch und senkt die Haltung aller Mächte.`, issue);
      else issue();
    }
    if (act === 'enter' && this.selected) return this.game.enterProvince(this.selected);
    if (act === 'send' && this.selected) {
      const ids = this.game.state.provinces[this.selected].map!.units.filter((u) => u.faction === PLAYER).map((u) => u.id);
      this.game.issue({ type: 'transfer', province: this.selected, ids, to: el.dataset.to! });
    }
    if (act === 'village') this.villageOpen = this.villageOpen === el.dataset.village ? null : el.dataset.village!;
    this.updatePanel(true);
  }
}

/** Provinzen, über die der Spieler Aufklärung hat: eigene, deren Nachbarn und solche mit eigenen Truppen */
export function knownProvinces(state: GameState): Set<string> {
  const known = new Set<string>();
  for (const p of Object.values(state.provinces)) {
    if (p.owner === PLAYER) {
      known.add(p.id);
      for (const n of GEO.provinces[p.id].neighbors) known.add(n.id);
    } else if (p.map?.units.some((u) => u.faction === PLAYER)) known.add(p.id);
  }
  return known;
}

function forceCount(prov: ProvinceState): number {
  if (prov.map) return prov.map.units.filter((u) => u.faction === prov.owner).length;
  return prov.garrison.length;
}
