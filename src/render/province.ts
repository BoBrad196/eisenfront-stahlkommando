// Detailkarte einer Provinz in isometrischer Ansicht: Basisbau, Einheiten, Kämpfe, Nebel des Krieges
import { assets } from '../assets';
import { audio } from '../audio';
import type { Game, View } from '../game';
import { BUILDINGS, ECON, FACTIONS, PLAYER, PROVINCES, UNITS } from '../sim/defs';
import { markCircles, powerInfo, sightSources } from '../sim/sim';
import { T_FELS, T_GRAS, T_WALD, T_WASSER, type Building, type GameEvent, type ProvinceMap, type Unit, type Village } from '../sim/types';
import { blockGrid, ensureMap, placementError, provName, queuesOf, seaAccess } from '../sim/world';
import { CommandBar } from '../ui/commandBar';
import { esc } from '../ui/dom';
import { ProvincePanel } from '../ui/provincePanel';
import { Ambient, WIND } from './ambient';
import { TouchGestures } from '../ui/touch';
import { Landscape } from './landscape';
import type { Plot } from '../sim/villageLayout';
import { stageOf, tileHash, type DamageKind, type Stage } from '../sim/damage';
import { TerrainPainter } from './terrain';

const MINI_COLORS = ['#5f8c3c', '#3b6326', '#2c5d86', '#6e6a62', '#c9b47a'];
const MINI_DEPOSIT = ['', '#111', '#a0522d', '#f0c43a'];
const FOG_EXPLORED = 125, FOG_HIDDEN = 255;
const WEAPON_SOUND: Record<string, string> = {
  gewehr: 'sfx.gewehr', mg: 'sfx.mg', panzerbuechse: 'sfx.pak', bombe: 'sfx.stuka', kanone: 'sfx.kanone', schiffsgeschuetz: 'sfx.schiff',
  granate: 'sfx.artillerie', schiffskanone: 'sfx.schiff', luftkanone: 'sfx.mg', flak: 'sfx.flak',
};
/** Krater-Vorlagen: dunkle Mitte, aufgeworfener Rand, verstreute Erde (drei Muster) */
const craterCache: HTMLCanvasElement[] = [];
function craterTexture(v: number): HTMLCanvasElement {
  if (craterCache[v]) return craterCache[v];
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(v * 977 + 13);
  const rim = g.createRadialGradient(64, 32, 6, 64, 32, 62);
  rim.addColorStop(0, 'rgba(38,30,20,0.85)'); rim.addColorStop(0.45, 'rgba(70,58,40,0.7)'); rim.addColorStop(0.75, 'rgba(120,104,76,0.35)'); rim.addColorStop(1, 'rgba(120,104,76,0)');
  g.fillStyle = rim; g.beginPath(); g.ellipse(64, 32, 62, 31, 0, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = 26 + rnd() * 24;
    g.fillStyle = `rgba(${90 + rnd() * 40 | 0},${78 + rnd() * 30 | 0},${56 + rnd() * 20 | 0},${0.5 + rnd() * 0.4})`;
    g.beginPath(); g.ellipse(64 + Math.cos(a) * d, 32 + Math.sin(a) * d * 0.5, 1 + rnd() * 2.5, 0.8 + rnd() * 1.5, 0, 0, Math.PI * 2); g.fill();
  }
  craterCache[v] = c;
  return c;
}
function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const FOREST_TREES = ['object.baum1', 'object.baum3', 'object.baum5', 'object.baum6', 'object.baum2', 'object.baum4', 'object.baum7', 'object.baum8'];
/** Laubbäume auf Wiesen und an Straßen */
const MEADOW_TREES = ['object.baum2', 'object.baum4', 'object.baum7', 'object.baum8'];
const CHUNK = 16; // Bodenabschnitte zu 16×16 Kacheln werden einmal gezeichnet und zwischengespeichert

type EffectKind = 'shot' | 'explosion' | 'marker' | 'flash' | 'dust' | 'smoke' | 'spark' | 'wreck' | 'debris' | 'feuer';
interface Effect {
  kind: EffectKind; x: number; y: number; t: number; life: number;
  x2?: number; y2?: number; weapon?: string; fromAir?: boolean; toAir?: boolean; color?: string;
  z?: number; vx?: number; vy?: number; vz?: number; size?: number; unit?: string; facing?: number; next?: number;
}
const GROUND_FX: EffectKind[] = ['wreck', 'dust'];
const MAX_FX = 450;
/** Abstand der Rohrmündung vom Einheitenmittelpunkt (Kacheln) und Höhe (Pixel) je Waffe */
const MUZZLE: Record<string, [number, number]> = {
  gewehr: [0.25, 9], mg: [0.32, 11], panzerbuechse: [0.45, 14], kanone: [0.72, 10], granate: [0.85, 20],
  bombe: [0, -6], luftkanone: [0.45, 2], flak: [0.45, 22], schiffskanone: [0.6, 8], schiffsgeschuetz: [0.6, 10],
};
/** Schornsteine je Gebäudetyp: Position im Gebäude (Kacheln) und Höhe (1 = 32 px), passend zu tools/make-placeholders.mjs */
const CHIMNEYS: Record<string, [number, number, number][]> = {
  kraftwerk: [[1.75, 0.35, 1.58]],
  panzerfabrik: [[2.6, 0.4, 1.58]],
};
const VILLAGE_CHIMNEYS: [number, number, number][] = [[2.16, 0.67, 0.64], [0.4, 2.47, 0.64], [1.75, 2.52, 0.64]];

/** kind/res/stage: überrollbare Objekte (Bäume, Masten) mit Schadensstufe aus map.crush */
interface Prop {
  tx: number; ty: number; key: string; depth: number; scale?: number; wire?: [number, number] | null;
  kind?: 'baum' | 'mast'; res?: number; stage?: Stage; tile?: number; next?: Prop | null;
}

/** Flughöhe in Pixeln (leichtes Schweben) */
/** Felder einer geraden Linie (Kacheln), vom Start bis zum Ende */
export function lineTiles(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  if (n === 0) return [[x0, y0]];
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n)]);
  return out;
}

export const altitude = (u: Unit) => UNITS[u.type].armor === 'luft' ? 34 + Math.sin(performance.now() / 400 + u.id) * 3 : 0;

/** Blickrichtung (Bogenmaß im Kachelraster) -> Einzelbild 0..7 */
export const dirFrame = (facing: number, frames = 8) => ((Math.round(facing / ((Math.PI * 2) / frames)) % frames) + frames) % frames;

export class ProvinceView implements View {
  id = '';
  cam = { x: 0, y: 0, zoom: 1 };
  sel = new Set<number>();
  selBuilding: number | null = null;
  selVillage: string | null = null;
  placing = false;
  /** Linienbau: Gebäudetyp (Stacheldraht …) und die gezogene Linie in Kacheln */
  lineType: string | null = null;
  lineDrag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  attackMode = false;
  repairMode = false;
  moveMode = false;
  /** Kontrollgruppen je Provinz: Taste 1–9 -> Einheiten-IDs */
  private groups = new Map<string, Map<number, number[]>>();
  private lastGroup = { n: 0, t: 0 };
  private drag: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private pan: { sx: number; sy: number; cx: number; cy: number; moved?: boolean; button?: number } | null = null;
  mouse = { x: -1, y: -1, in: false };
  /** Touch-Bedienung: letzte Eingabe kam per Finger (kein Randscrollen, Geisterbild bleibt stehen) */
  touchMode = false;
  touchMulti = false;  // Tippen fügt der Auswahl hinzu
  touchRect = false;   // Ziehen zeichnet einen Auswahlrahmen statt die Karte zu verschieben
  rallyArmed = false;  // nächstes Tippen setzt den Sammelpunkt des gewählten Gebäudes
  private keys = new Set<string>();
  private effects: Effect[] = [];
  private nextFx = new Map<number, number>(); // nächster Zeitpunkt für Staub/Rauch je Einheit oder Gebäude
  private props: Prop[] = [];
  private ambient = new Ambient();
  private tileProps = new Map<number, Prop[]>();
  private crushSeen = new Float64Array(0);
  private crushCheck = 0;
  private paveSeen = new WeakSet<object>();
  private paveCheck = 0;
  private terrain: TerrainPainter | null = null;
  private mudSeen = new WeakSet<object>();
  private trackFade = 0;
  private firstFrame = true;
  private syncUntil = 0;
  private mudCheck = 0;
  miniBase: HTMLCanvasElement | null = null;
  fog: HTMLCanvasElement = document.createElement('canvas');
  visible = new Uint8Array(0);
  private fogTimer = 0;
  private abort: AbortController | null = null;
  panel: ProvincePanel;
  cmdbar: CommandBar;

  constructor(private game: Game) {
    this.panel = new ProvincePanel(game, this);
    this.cmdbar = new CommandBar(game, this);
  }

  get map(): ProvinceMap { return this.game.state.provinces[this.id].map!; }
  get HW() { return assets.tileW / 2; }
  get HH() { return assets.tileH / 2; }

  /** Kachelkoordinaten -> Weltpixel (isometrisch) */
  iso(tx: number, ty: number): [number, number] {
    return [(tx - ty + this.map.h) * this.HW, (tx + ty) * this.HH];
  }
  /** Bildschirm -> Kachelkoordinaten */
  toTile(sx: number, sy: number): [number, number] {
    const wx = sx / this.cam.zoom + this.cam.x - this.map.h * this.HW, wy = sy / this.cam.zoom + this.cam.y;
    return [(wx / this.HW + wy / this.HH) / 2, (wy / this.HH - wx / this.HW) / 2];
  }
  private toScreen(tx: number, ty: number): [number, number] {
    const [wx, wy] = this.iso(tx, ty);
    return [(wx - this.cam.x) * this.cam.zoom, (wy - this.cam.y) * this.cam.zoom];
  }

  open(id: string) {
    this.id = id;
    ensureMap(this.game.state, id);
    this.sel.clear(); this.selBuilding = null; this.selVillage = null;
    this.setMode('none'); this.effects = [];
    this.prepare();
    const map = this.map;
    const hq = map.buildings.find((b) => b.faction === PLAYER && b.type === 'bauhof');
    const own = map.units.filter((u) => u.faction === PLAYER);
    let fx = map.anchor[0], fy = map.anchor[1];
    if (hq) { fx = hq.x + 1.5; fy = hq.y + 1.5; }
    else if (own.length) { fx = own.reduce((s, u) => s + u.x, 0) / own.length; fy = own.reduce((s, u) => s + u.y, 0) / own.length; }
    this.centerOn(fx, fy);
  }

  centerOn(tx: number, ty: number) {
    const [wx, wy] = this.iso(tx, ty);
    this.cam.x = wx - this.game.viewW / 2 / this.cam.zoom;
    this.cam.y = wy - this.game.viewH / 2 / this.cam.zoom;
    this.clampCam();
  }

  enter() {
    const c = this.game.canvas;
    this.abort = new AbortController();
    const o = { signal: this.abort.signal };
    c.addEventListener('pointerdown', (e) => this.onDown(e), o);
    c.addEventListener('pointermove', (e) => this.onMove(e), o);
    c.addEventListener('pointerup', (e) => this.onUp(e), o);
    c.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') this.mouse.in = false; }, o);
    c.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') this.mouse.in = true; }, o);
    c.addEventListener('dblclick', (e) => this.selectSameType(e.offsetX, e.offsetY), o);
    new TouchGestures(c, {
      tap: (x, y) => this.touchTap(x, y),
      doubleTap: (x, y) => this.selectSameType(x, y),
      longPress: (x, y) => { navigator.vibrate?.(14); this.selectSameType(x, y); },
      pan: (dx, dy) => { this.touchMode = true; this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); },
      pinch: (f, cx, cy, dx, dy) => { this.touchMode = true; this.zoomAt(f, cx, cy); this.cam.x -= dx / this.cam.zoom; this.cam.y -= dy / this.cam.zoom; this.clampCam(); },
      dragStart: (x, y) => {
        this.touchMode = true;
        if (this.lineType) { const [tx, ty] = this.toTile(x, y); this.lineDrag = { x0: Math.floor(tx), y0: Math.floor(ty), x1: Math.floor(tx), y1: Math.floor(ty) }; return true; }
        if (!this.touchRect || this.mode() !== 'none') return false;
        this.drag = { x0: x, y0: y, x1: x, y1: y }; return true;
      },
      dragMove: (x, y) => {
        if (this.lineDrag) { const [tx, ty] = this.toTile(x, y); this.lineDrag.x1 = Math.floor(tx); this.lineDrag.y1 = Math.floor(ty); }
        if (this.drag) { this.drag.x1 = x; this.drag.y1 = y; }
      },
      dragEnd: () => {
        if (this.lineDrag && this.lineType) { this.finishLine(); return; }
        const d = this.drag; this.drag = null; if (d) { this.rectSelect(d, this.touchMulti); this.refreshUi(); }
      },
    }, o.signal);
    c.addEventListener('wheel', (e) => this.onWheel(e), { ...o, passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault(), o);
    window.addEventListener('keydown', (e) => this.onKey(e, true), o);
    window.addEventListener('keyup', (e) => this.onKey(e, false), o);
    this.panel.mount(o.signal);
    this.cmdbar.mount(o.signal);
    this.updateSceneTag();
  }
  leave() { this.abort?.abort(); this.abort = null; this.keys.clear(); this.game.canvas.style.cursor = 'default'; }

  // ---------- Vorbereitung: Geländeobjekte, Minikarte, Nebel ----------
  private prepare() {
    const map = this.map;
    this.props = [];
    const land = new Landscape(map, this.game.state.provinces[this.id].villages);
    this.terrain = new TerrainPainter(map, this.HW, this.HH, CHUNK, land);
    this.firstFrame = true;
    this.syncUntil = performance.now() + 350;
    map.wear ??= new Array(map.w * map.h).fill(0); // ältere Spielstände
    const rnd = (x: number, y: number, k: number) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 10000) / 10000;
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      const t = map.terrain[y * map.w + x];
      const rd = land.roadDist(x + 0.5, y + 0.5);
      if (rd < 0.75 || land.fieldAt(x + 0.5, y + 0.5) || land.isPlot(x + 0.5, y + 0.5)) continue; // Wege, Äcker und Grundstücke frei halten
      if (t === T_WALD) {
        // dichter Mischwald: ein bis zwei Bäume je Kachel, verschiedene Arten und Größen
        const n = rnd(x, y, 0) < 0.55 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const ox = (rnd(x, y, k + 1) - 0.5) * 0.7, oy = (rnd(x, y, k + 5) - 0.5) * 0.7;
          const r = rnd(x, y, k + 9);
          // acht Baumarten (Fichten, Kiefern, Laubbäume, Birken, junge Bäume) für einen abwechslungsreichen Wald
          const key = FOREST_TREES[Math.floor(r * FOREST_TREES.length) % FOREST_TREES.length];
          this.props.push({ tx: x + 0.5 + ox, ty: y + 0.5 + oy, key, depth: x + y + 1 + ox + oy, scale: 0.78 + rnd(x, y, k + 13) * 0.4 });
        }
      } else if (t === T_FELS) {
        this.props.push({ tx: x + 0.5, ty: y + 0.5, key: rnd(x, y, 3) < 0.5 ? 'object.fels' : 'object.fels2', depth: x + y + 1, scale: 0.85 + rnd(x, y, 4) * 0.3 });
      } else if (t === T_GRAS && rnd(x, y, 7) < 0.012) {
        // vereinzelte Bäume auf Wiesen
        this.props.push({ tx: x + 0.5, ty: y + 0.5, key: MEADOW_TREES[Math.floor(rnd(x, y, 8) * MEADOW_TREES.length)], depth: x + y + 1, scale: 0.9 + rnd(x, y, 9) * 0.25 });
      }
    }
    for (const p of land.poles) this.props.push({ tx: p.tx, ty: p.ty, key: 'mast', depth: p.tx + p.ty, wire: p.next });
    // Linden an freien Stellen entlang der Dorfstraßen
    const streetSet = new Set<number>();
    for (const v of this.game.state.provinces[this.id].villages) for (const [x0, y0, x1, y1] of v.layout?.streets ?? []) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) streetSet.add(y * map.w + x);
    }
    for (const i of streetSet) {
      const x = i % map.w, y = (i / map.w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const j = (y + dy) * map.w + x + dx;
        if (streetSet.has(j) || land.plots.has(j) || map.terrain[j] === T_WASSER || map.deposit[j] || rnd(x, y, dx * 3 + dy + 40) > 0.45) continue;
        const tx = x + 0.5 + dx * 0.62, ty = y + 0.5 + dy * 0.62;
        if (this.props.some((p) => Math.abs(p.tx - tx) + Math.abs(p.ty - ty) < 1.2)) continue;
        this.props.push({ tx, ty, key: MEADOW_TREES[Math.floor(rnd(x, y, 77) * MEADOW_TREES.length)], depth: tx + ty, scale: 0.7 + rnd(x, y, 78) * 0.3 });
      }
    }
    // überrollbare Objekte: Schadensstufe aus dem gespeicherten Überrollschaden
    const crush0 = map.crush;
    this.tileProps = new Map();
    const poleAt = new Map<string, Prop>();
    for (const p of this.props) {
      const tree = p.key.startsWith('object.baum');
      if (!tree && p.key !== 'mast') continue;
      p.kind = tree ? 'baum' : 'mast';
      p.res = tree ? (0.8 + rnd(Math.floor(p.tx * 4), Math.floor(p.ty * 4), 71) * 0.8) * (p.scale ?? 1) : 0.9 + rnd(Math.floor(p.tx), Math.floor(p.ty), 72) * 0.6;
      p.tile = Math.floor(p.ty) * map.w + Math.floor(p.tx);
      p.stage = stageOf(p.kind, crush0?.[p.tile] ?? 0, p.res);
      let l = this.tileProps.get(p.tile);
      if (!l) this.tileProps.set(p.tile, l = []);
      l.push(p);
      if (!tree) poleAt.set(`${p.tx},${p.ty}`, p);
    }
    for (const p of poleAt.values()) p.next = p.wire ? poleAt.get(`${p.wire[0]},${p.wire[1]}`) ?? null : null;
    this.crushSeen = Float64Array.from(crush0 ?? []);
    this.terrain.setShadowProps(this.props);
    this.ambient.prepare(map, this.game.state.provinces[this.id].villages, land, blockGrid(this.game.state, this.id));
    const mini = document.createElement('canvas');
    mini.width = map.w; mini.height = map.h;
    const mg = mini.getContext('2d')!;
    for (let i = 0; i < map.w * map.h; i++) {
      mg.fillStyle = map.deposit[i] ? MINI_DEPOSIT[map.deposit[i]] : MINI_COLORS[map.terrain[i]];
      mg.fillRect(i % map.w, Math.floor(i / map.w), 1, 1);
    }
    // Dorfgrundstücke (Dächer) und Straßen auf der Minikarte
    for (const v of this.game.state.provinces[this.id].villages) {
      mg.fillStyle = '#8f8678';
      for (const [x0, y0, x1, y1] of v.layout?.streets ?? []) mg.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
      mg.fillStyle = '#9a4a33';
      for (const p of v.layout?.plots ?? []) mg.fillRect(p.x + 0.2, p.y + 0.2, p.w - 0.4, p.h - 0.4);
    }
    this.miniBase = mini;
    this.fog.width = map.w + 2; this.fog.height = map.h + 2; // 1 Kachel dunkler Rand gegen helle Kanten
    this.visible = new Uint8Array(map.w * map.h);
    this.fogTimer = 0;
    this.updateFog();
  }

  /** Sichtbare Kacheln neu berechnen und Nebel-Bild aktualisieren */
  private updateFog() {
    const map = this.map;
    this.visible.fill(0);
    markCircles(this.visible, map.w, map.h, sightSources(this.game.state, map, PLAYER));
    const explored = map.explored?.[PLAYER];
    const g = this.fog.getContext('2d')!;
    const W = map.w + 2;
    const img = g.createImageData(W, map.h + 2);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = FOG_HIDDEN;
    for (let i = 0; i < map.w * map.h; i++) {
      const o = ((Math.floor(i / map.w) + 1) * W + (i % map.w) + 1) * 4 + 3;
      img.data[o] = this.visible[i] ? 0 : explored?.[i] ? FOG_EXPLORED : FOG_HIDDEN;
    }
    g.putImageData(img, 0, 0);
  }
  isVisible(tx: number, ty: number) {
    const map = this.map;
    const x = Math.floor(tx), y = Math.floor(ty);
    return x >= 0 && y >= 0 && x < map.w && y < map.h && this.visible[y * map.w + x] === 1;
  }
  isExplored(tx: number, ty: number) {
    const map = this.map;
    const x = Math.floor(tx), y = Math.floor(ty);
    if (x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
    return this.visible[y * map.w + x] === 1 || map.explored?.[PLAYER]?.[y * map.w + x] === 1;
  }
  unitShown(u: Unit) { return u.faction === PLAYER || this.isVisible(u.x, u.y); }
  buildingShown(b: Building) {
    const s = BUILDINGS[b.type].size;
    return b.faction === PLAYER || this.isExplored(b.x + s / 2, b.y + s / 2);
  }
  villageShown(v: Village) { return this.isExplored(v.x + 0.5, v.y + 0.5); }

  private clampCam() {
    const map = this.map;
    const W = (map.w + map.h) * this.HW, H = (map.w + map.h) * this.HH;
    const vw = this.game.viewW / this.cam.zoom, vh = this.game.viewH / this.cam.zoom;
    const m = 64;
    this.cam.x = vw >= W ? (W - vw) / 2 : Math.max(-m, Math.min(W - vw + m, this.cam.x));
    const bar = (this.game.cmdbar.hidden ? 0 : this.game.cmdbar.offsetHeight) / this.cam.zoom; // Befehlsleiste verdeckt den unteren Rand
    this.cam.y = vh >= H + bar ? (H + bar - vh) / 2 : Math.max(-m - 96, Math.min(H - vh + m + bar, this.cam.y));
  }

  // ---------- Treffer-Suche (Bildschirmkoordinaten) ----------
  private unitAt(sx: number, sy: number) {
    let best: Unit | null = null, bd = Infinity;
    for (const u of this.map.units) {
      if (!this.unitShown(u)) continue;
      const inf = UNITS[u.type].armor === 'infanterie';
      const [x, y] = this.toScreen(u.x, u.y);
      const d = Math.hypot(sx - x, sy - (y - ((inf ? 10 : 8) + altitude(u)) * this.cam.zoom)) / this.cam.zoom;
      if (d < (inf ? 13 : 22) && d < bd) { bd = d; best = u; }
    }
    return best;
  }
  private buildingAt(sx: number, sy: number) {
    const [tx, ty] = this.toTile(sx, sy);
    const map = this.map;
    const onFoot = map.buildings.find((b) => {
      const s = BUILDINGS[b.type].size;
      return this.buildingShown(b) && tx >= b.x && ty >= b.y && tx < b.x + s && ty < b.y + s;
    });
    if (onFoot) return onFoot;
    // sonst über das Bild (hohe Gebäude ragen nach oben)
    let best: Building | null = null, bd = -Infinity;
    for (const b of map.buildings) {
      if (!this.buildingShown(b)) continue;
      const def = BUILDINGS[b.type];
      const [fw, fh] = assets.frameSize(def.sprite);
      const [anx, any] = assets.meta(def.sprite).anchor ?? [fw / 2, fh];
      const [ax, ay] = this.toScreen(b.x + def.size, b.y + def.size);
      const z = this.cam.zoom;
      // Bildbereich über der Grundfläche (Anker kann außermittig liegen, z. B. wegen Schatten rechts)
      const half = Math.min(anx, def.size * this.HW) * z * 0.9;
      if (sx >= ax - half && sx <= ax + half && sy >= ay - any * z && sy <= ay - def.size * this.HH * z) {
        const d = b.x + b.y;
        if (d > bd) { bd = d; best = b; }
      }
    }
    return best;
  }
  private villageAt(sx: number, sy: number) {
    const [tx, ty] = this.toTile(sx, sy);
    return this.game.state.provinces[this.id].villages.find((v) => this.villageShown(v) && (
      (Math.abs(v.x + 0.5 - tx) < 1.6 && Math.abs(v.y + 0.5 - ty) < 1.6)
      || !!v.layout?.plots.some((p) => tx >= p.x && ty >= p.y && tx < p.x + p.w && ty < p.y + p.h))) ?? null;
  }
  /** Aktiver Klickmodus der Detailkarte */
  mode(): 'place' | 'line' | 'move' | 'attack' | 'repair' | 'none' {
    return this.lineType ? 'line' : this.placing ? 'place' : this.moveMode ? 'move' : this.attackMode ? 'attack' : this.repairMode ? 'repair' : 'none';
  }
  /** Gezogene Linie als Bauauftrag abschicken */
  private finishLine() {
    const d = this.lineDrag;
    this.lineDrag = null;
    if (!d || !this.lineType) return;
    this.game.issue({ type: 'buildLine', province: this.id, building: this.lineType, tiles: lineTiles(d.x0, d.y0, d.x1, d.y1) });
  }
  /** Linienbau für einen Wehrbau-Typ starten (Linie ziehen statt einzelner Platzierung) */
  setLineMode(type: string) { this.setMode('none'); this.lineType = type; this.refreshUi(); }
  setMode(m: 'place' | 'move' | 'attack' | 'repair' | 'none') {
    this.lineType = null; this.lineDrag = null;
    document.body.classList.toggle('mode-place', m === 'place');
    if (m === 'place') document.getElementById('main')?.classList.remove('sb-open'); // Handy: Seitenleiste weg, damit das Baufeld frei ist
    this.placing = m === 'place'; this.moveMode = m === 'move'; this.attackMode = m === 'attack'; this.repairMode = m === 'repair';
    this.cmdbar?.render(true);
  }
  /** Seitenleiste und Befehlsleiste sofort neu zeichnen */
  refreshUi() { this.panel.render(true); this.cmdbar.render(true); this.game.touchbar?.update(true); }
  power() { return powerInfo(this.game.state, this.map, PLAYER); }
  private updateSceneTag() {
    const n = String(PROVINCES.findIndex((p) => p.id === this.id) + 1).padStart(2, '0');
    this.game.sceneTag.innerHTML = `<b>${n}</b><span>/</span>${esc(provName(this.id).toUpperCase())}`;
  }

  ownSelected() { return this.map.units.filter((u) => this.sel.has(u.id) && u.faction === PLAYER); }

  // ---------- Eingabe ----------
  private onDown(e: PointerEvent) {
    if (e.pointerType === 'touch') return; // Finger laufen über TouchGestures
    this.touchMode = false;
    this.mouse = { x: e.offsetX, y: e.offsetY, in: true };
    // Mitteltaste oder rechte Taste gedrückt halten: Karte verschieben. Ein Rechtsklick ohne Ziehen gibt den Befehl.
    if (e.button === 1 || e.button === 2) { this.pan = { sx: e.offsetX, sy: e.offsetY, cx: this.cam.x, cy: this.cam.y, moved: false, button: e.button }; return; }
    if (e.button !== 0) return;
    if (this.lineType) {
      const [tx, ty] = this.toTile(e.offsetX, e.offsetY);
      this.lineDrag = { x0: Math.floor(tx), y0: Math.floor(ty), x1: Math.floor(tx), y1: Math.floor(ty) };
      this.game.canvas.setPointerCapture(e.pointerId);
      return;
    }
    if (this.modeClick(e.offsetX, e.offsetY)) return;
    this.game.canvas.setPointerCapture(e.pointerId);
    this.drag = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
  }

  /** Klick im Bau-, Reparatur-, Angriffs- oder Bewegungsmodus; false, wenn kein Modus aktiv ist */
  private modeClick(sx: number, sy: number): boolean {
    const [tx, ty] = this.toTile(sx, sy);
    if (this.placing) { this.placeAt(sx, sy); return true; }
    if (this.repairMode) {
      const b = this.buildingAt(sx, sy);
      if (b && b.faction === PLAYER) {
        this.game.issue({ type: 'repair', province: this.id, building: b.id, on: !b.repairing });
        this.effects.push({ kind: 'marker', x: tx, y: ty, t: 0, life: 0.6, color: '#5ad65a' });
      }
      return true;
    }
    if (this.attackMode) {
      this.setMode('none');
      const ids = this.ownSelected().map((u) => u.id);
      if (ids.length) {
        audio.play('ui.bestaetigung');
        this.game.issue({ type: 'move', province: this.id, ids, x: tx, y: ty, attackMove: true });
        this.effects.push({ kind: 'marker', x: tx, y: ty, t: 0, life: 0.6, color: '#ff5050' });
      }
      return true;
    }
    if (this.moveMode) {
      this.setMode('none');
      if (this.ownSelected().length) this.command(sx, sy);
      return true;
    }
    return false;
  }

  /** Gebäude an der Bildschirmposition platzieren */
  private placeAt(sx: number, sy: number) {
    const [tx, ty] = this.toTile(sx, sy);
    const q = queuesOf(this.map, PLAYER);
    if (q.struct?.ready) {
      const s = BUILDINGS[q.struct.type].size;
      this.game.issue({ type: 'place', province: this.id, x: Math.floor(tx) - ((s - 1) >> 1), y: Math.floor(ty) - ((s - 1) >> 1) });
    }
  }

  // ---------- Touch ----------
  /** Antippen: Modus ausführen, Einheit wählen, Befehl geben oder ansehen (siehe Tippen-zum-Befehlen) */
  private touchTap(sx: number, sy: number) {
    this.touchMode = true;
    this.mouse = { x: sx, y: sy, in: true };
    if (this.lineType) { // ein Tippen setzt ein einzelnes Feld
      const [tx, ty] = this.toTile(sx, sy);
      this.lineDrag = { x0: Math.floor(tx), y0: Math.floor(ty), x1: Math.floor(tx), y1: Math.floor(ty) };
      this.finishLine();
      return;
    }
    if (this.placing) { this.game.touchbar?.update(true); return; } // Geisterbild setzen; gebaut wird über „Hier bauen“
    if (this.rallyArmed) { this.rallyArmed = false; this.command(sx, sy); this.game.touchbar?.update(true); return; }
    if (this.modeClick(sx, sy)) { this.game.touchbar?.update(true); return; }
    const u = this.unitAt(sx, sy);
    if (u && u.faction === PLAYER) {
      if (!this.touchMulti) this.clearSel();
      if (this.touchMulti && this.sel.has(u.id)) this.sel.delete(u.id); else this.sel.add(u.id);
      this.refreshUi(); return;
    }
    const b = u ? null : this.buildingAt(sx, sy);
    const v = u || b ? null : this.villageAt(sx, sy);
    if (this.ownSelected().length) {
      if (b && b.faction === PLAYER) { this.clearSel(); this.selBuilding = b.id; this.refreshUi(); return; }
      if (v) { this.clearSel(); this.selVillage = v.id; this.refreshUi(); return; }
      this.command(sx, sy); // gewählte Einheiten bewegen oder angreifen
      return;
    }
    if (!this.touchMulti) this.clearSel();
    if (b) this.selBuilding = b.id; else if (v) this.selVillage = v.id; else if (u) this.sel.add(u.id);
    this.refreshUi();
  }
  /** Werkzeugleiste: Bau an der gemerkten Stelle bestätigen */
  confirmPlace() { if (this.placing && this.mouse.in) this.placeAt(this.mouse.x, this.mouse.y); }
  selectAllOwn() { this.clearSel(); for (const u of this.map.units) if (u.faction === PLAYER) this.sel.add(u.id); this.refreshUi(); }
  deselect() { this.setMode('none'); this.clearSel(); this.rallyArmed = false; this.refreshUi(); }
  ownFactorySelected() {
    const fb = this.map.buildings.find((b) => b.id === this.selBuilding);
    return !!fb && fb.faction === PLAYER && ['kaserne', 'panzerfabrik', 'flugfeld', 'werft'].includes(fb.type);
  }

  private onMove(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    this.touchMode = false;
    this.mouse = { x: e.offsetX, y: e.offsetY, in: true };
    if (this.drag) { this.drag.x1 = e.offsetX; this.drag.y1 = e.offsetY; }
    if (this.lineDrag) { const [tx, ty] = this.toTile(e.offsetX, e.offsetY); this.lineDrag.x1 = Math.floor(tx); this.lineDrag.y1 = Math.floor(ty); }
    if (this.pan) {
      if (Math.abs(e.offsetX - this.pan.sx) + Math.abs(e.offsetY - this.pan.sy) > 5) this.pan.moved = true;
      this.cam.x = this.pan.cx - (e.offsetX - this.pan.sx) / this.cam.zoom;
      this.cam.y = this.pan.cy - (e.offsetY - this.pan.sy) / this.cam.zoom;
      this.clampCam();
    }
  }

  private onUp(e: PointerEvent) {
    if (e.pointerType === 'touch') return;
    if (e.button === 1) { this.pan = null; return; }
    if (e.button === 0 && this.lineDrag && this.lineType) { this.finishLine(); return; }
    if (e.button === 2) {
      const moved = this.pan?.moved;
      this.pan = null;
      if (moved) return;
      if (this.mode() !== 'none') { this.setMode('none'); return; }
      this.command(e.offsetX, e.offsetY);
      return;
    }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag;
    this.drag = null;
    const shift = e.shiftKey;
    if (Math.abs(d.x1 - d.x0) + Math.abs(d.y1 - d.y0) < 6) {
      const u = this.unitAt(d.x0, d.y0);
      if (u && u.faction === PLAYER) {
        if (!shift) this.clearSel();
        if (shift && this.sel.has(u.id)) this.sel.delete(u.id); else this.sel.add(u.id);
      } else {
        const b = u ? null : this.buildingAt(d.x0, d.y0);
        const v = b || u ? null : this.villageAt(d.x0, d.y0);
        if (!shift) this.clearSel();
        if (b) this.selBuilding = b.id;
        else if (v) this.selVillage = v.id;
        else if (u) this.sel.add(u.id); // fremde Einheit nur zur Ansicht
      }
    } else this.rectSelect(d, shift);
    this.refreshUi();
  }

  /** Einheiten im Auswahlrahmen wählen (add = der Auswahl hinzufügen) */
  private rectSelect(d: { x0: number; y0: number; x1: number; y1: number }, add: boolean) {
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    const hits = this.map.units.filter((u) => {
      if (u.faction !== PLAYER) return false;
      const [x, y0u] = this.toScreen(u.x, u.y);
      const y = y0u - altitude(u) * this.cam.zoom;
      return x >= x0 && x <= x1 && y >= y0 && y <= y1 + 6;
    });
    if (hits.length || !add) {
      if (!add) this.clearSel();
      for (const u of hits) this.sel.add(u.id);
    }
  }

  /** Doppelklick / Doppeltippen / langes Drücken: alle sichtbaren Einheiten dieses Typs wählen */
  private selectSameType(sx: number, sy: number) {
    const u = this.unitAt(sx, sy);
    if (!u || u.faction !== PLAYER) return;
    for (const o of this.map.units) {
      if (o.faction !== PLAYER || o.type !== u.type) continue;
      const [x, y] = this.toScreen(o.x, o.y);
      if (x >= 0 && y >= 0 && x <= this.game.viewW && y <= this.game.viewH) this.sel.add(o.id);
    }
    this.refreshUi();
  }

  groupsHere(): Map<number, number[]> {
    let m = this.groups.get(this.id);
    if (!m) { m = new Map(); this.groups.set(this.id, m); }
    // gefallene oder verlegte Einheiten entfernen
    const alive = new Set(this.map.units.filter((u) => u.faction === PLAYER).map((u) => u.id));
    for (const [n, ids] of m) {
      const rest = ids.filter((id) => alive.has(id));
      if (rest.length) m.set(n, rest); else m.delete(n);
    }
    return m;
  }
  private setGroup(n: number, add: boolean) {
    const ids = this.ownSelected().map((u) => u.id);
    if (!ids.length) return;
    const m = this.groupsHere();
    // Eine Einheit gehört immer nur zu einer Gruppe
    for (const [k, list] of m) m.set(k, list.filter((id) => !ids.includes(id)));
    m.set(n, add ? [...new Set([...(m.get(n) ?? []), ...ids])] : ids);
    this.refreshUi();
  }
  selectGroup(n: number) {
    const ids = this.groupsHere().get(n);
    if (!ids?.length) return;
    const now = performance.now();
    const again = this.lastGroup.n === n && now - this.lastGroup.t < 400;
    this.lastGroup = { n, t: now };
    this.clearSel();
    for (const id of ids) this.sel.add(id);
    if (again) {
      const us = this.ownSelected();
      if (us.length) this.centerOn(us.reduce((a, u) => a + u.x, 0) / us.length, us.reduce((a, u) => a + u.y, 0) / us.length);
    }
    this.refreshUi();
  }
  groupOf(id: number): number | null {
    for (const [n, ids] of this.groups.get(this.id) ?? []) if (ids.includes(id)) return n;
    return null;
  }

  private clearSel() { this.sel.clear(); this.selBuilding = null; this.selVillage = null; }

  /** Rechtsklick: Bewegen oder Angreifen */
  private command(sx: number, sy: number) {
    const ids = this.ownSelected().map((u) => u.id);
    const [tx, ty] = this.toTile(sx, sy);
    if (!ids.length) {
      // Gewählte Kaserne/Fabrik: Rechtsklick setzt den Sammelpunkt
      const fb = this.map.buildings.find((b) => b.id === this.selBuilding);
      if (fb && fb.faction === PLAYER && (fb.type === 'kaserne' || fb.type === 'panzerfabrik' || fb.type === 'flugfeld' || fb.type === 'werft')) {
        this.game.issue({ type: 'rally', province: this.id, building: fb.id, x: tx, y: ty });
        this.effects.push({ kind: 'marker', x: tx, y: ty, t: 0, life: 0.6, color: '#ffe066' });
        return;
      }
      this.clearSel(); this.refreshUi(); return;
    }
    const u = this.unitAt(sx, sy);
    const b = u ? null : this.buildingAt(sx, sy);
    const target = u && u.faction !== PLAYER ? u : b && b.faction !== PLAYER ? b : null;
    audio.play('ui.bestaetigung');
    if (target) {
      this.game.issue({ type: 'attack', province: this.id, ids, target: target.id });
      this.effects.push({ kind: 'marker', x: tx, y: ty, t: 0, life: 0.6, color: '#ff5050' });
    } else {
      this.game.issue({ type: 'move', province: this.id, ids, x: tx, y: ty });
      this.effects.push({ kind: 'marker', x: tx, y: ty, t: 0, life: 0.6, color: '#7dff7d' });
    }
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.offsetX, e.offsetY);
  }
  /** Zoom um den Bildschirmpunkt (ox, oy), sodass der Punkt unter dem Finger/Zeiger bleibt */
  private zoomAt(factor: number, ox: number, oy: number) {
    const [tx, ty] = this.toTile(ox, oy);
    this.cam.zoom = Math.max(0.45, Math.min(1.8, this.cam.zoom * factor));
    const [wx, wy] = this.iso(tx, ty);
    this.cam.x = wx - ox / this.cam.zoom;
    this.cam.y = wy - oy / this.cam.zoom;
    this.clampCam();
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    const k = e.key;
    if (k.startsWith('Arrow')) { down ? this.keys.add(k) : this.keys.delete(k); e.preventDefault(); return; }
    if (!down) return;
    if (k === 'Escape') { this.setMode('none'); this.clearSel(); this.refreshUi(); }
    // Kontrollgruppen: Strg/Alt+Zahl = festlegen, Umschalt+Zahl = hinzufügen, Zahl = wählen (zweimal = Kamera)
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.altKey) this.setGroup(n, false);
      else if (e.shiftKey) this.setGroup(n, true);
      else this.selectGroup(n);
      return;
    }
    if ((k === 'r' || k === 'R') && !e.ctrlKey && !e.metaKey) this.setMode(this.repairMode ? 'none' : 'repair');
    if ((k === 'a' || k === 'A') && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.clearSel();
      for (const u of this.map.units) if (u.faction === PLAYER) this.sel.add(u.id);
      this.refreshUi();
      return;
    }
    if ((k === 'a' || k === 'A') && this.ownSelected().length) this.setMode('attack');
    if ((k === 's' || k === 'S') && this.ownSelected().length) this.game.issue({ type: 'stop', province: this.id, ids: this.ownSelected().map((u) => u.id) });
    if (k === 'h' || k === 'H') {
      const hq = this.map.buildings.find((b) => b.faction === PLAYER && b.type === 'bauhof');
      if (hq) this.centerOn(hq.x + 1.5, hq.y + 1.5);
    }
  }


  private ambTimer = 0;
  /** Klangkulisse füttern: was ist gerade im Bild (Wald, Wasser, Dorf, Fahrzeuge, Tiere)? Alle 0,3 s */
  private ambienceTick(dt: number) {
    const amb = audio.ambience;
    if (!amb) return;
    this.ambTimer += dt;
    if (this.ambTimer < 0.3) return;
    const step = this.ambTimer; this.ambTimer = 0;
    const map = this.map, w = this.game.viewW, h = this.game.viewH;
    const inView = (tx: number, ty: number, pad = 0) => { const [sx, sy] = this.toScreen(tx, ty); return sx > -pad && sx < w + pad && sy > -pad && sy < h + pad; };
    // Wald und Wasser: Raster aus Bildpunkten abtasten
    let wald = 0, wasser = 0, n = 0;
    for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 12; gx++) {
      const [tx, ty] = this.toTile(((gx + 0.5) / 12) * w, ((gy + 0.5) / 8) * h);
      const x = Math.floor(tx), y = Math.floor(ty);
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      n++;
      const t = map.terrain[y * map.w + x];
      if (t === T_WALD) wald++; else if (t === T_WASSER) wasser++;
    }
    const village = this.game.state.provinces[this.id].villages;
    let near = 0, church = false, mill = false;
    for (const v of village) {
      if (!this.villageShown(v) || !v.layout) continue;
      if (inView(v.x + 0.5, v.y + 0.5, 120)) near = 1;
      for (const p of v.layout.plots) {
        if (p.kind !== 'kirche' && !(p.kind === 'muehle' && p.variant === 0)) continue;
        if (!inView(p.x + p.w / 2, p.y + p.h / 2, 60)) continue;
        if (p.kind === 'kirche') church = true; else mill = true;
      }
    }
    let tanks = 0, air = 0;
    for (const u of map.units) {
      if (u.x === u.px && u.y === u.py) continue;
      const d = UNITS[u.type];
      if (d.armor === 'infanterie' || d.domain === 'see' || !this.unitShown(u) || !inView(u.x, u.y, 80)) continue;
      if (d.armor === 'luft') air++; else tanks++;
    }
    const animals = this.ambient.animals().filter((a) => this.isExplored(a.x, a.y) && inView(a.x, a.y, 40)).map((a) => {
      const [sx, sy] = this.toScreen(a.x, a.y);
      const dd = Math.hypot(sx - w / 2, sy - h / 2) / Math.max(w, h);
      return { kind: a.kind, pan: (sx / w * 2 - 1) * 0.7, vol: Math.max(0.25, Math.min(1, 1.2 - dd * 1.2)) };
    });
    amb.update(step, { trees: Math.min(1, (wald / Math.max(1, n)) * 1.8), water: Math.min(1, (wasser / Math.max(1, n)) * 1.6), village: near, church, mill, tanks, air, animals, combat: audio.combatLevel(), sea: seaAccess(this.id) });
  }

  /** Geräusch an einer Kartenposition: leiser, je weiter vom Bildmittelpunkt; links/rechts nach Lage */
  private soundAt(key: string, tx: number, ty: number, vol = 1) {
    const [sx, sy] = this.toScreen(tx, ty);
    const w = this.game.viewW, h = this.game.viewH;
    const d = Math.hypot(sx - w / 2, sy - h / 2) / Math.max(w, h);
    audio.play(key, { volume: vol * Math.max(0.1, Math.min(1, 1.25 - d * 1.4)), pan: (sx / w * 2 - 1) * 0.7, far: Math.min(1, d * 1.1) });
  }

  onEvent(e: GameEvent) {
    if (e.province !== this.id) return;
    if (e.kind === 'sfx') {
      if (e.faction === PLAYER) this.soundAt(e.sound!, e.x ?? 0, e.y ?? 0);
      return;
    }
    // Nur Effekte zeigen, die der Spieler sehen kann
    const seen = this.isVisible(e.x!, e.y!) || (e.x2 != null && this.isVisible(e.x2, e.y2!));
    if (!seen) return;
    audio.combatPulse();
    if (e.kind === 'shot') this.soundAt(WEAPON_SOUND[e.weapon ?? 'gewehr'] ?? 'sfx.gewehr', e.x!, e.y!, 0.8);
    if (e.kind === 'explosion') {
      this.soundAt('sfx.explosion', e.x!, e.y!);
      this.addCrater(e.x!, e.y!, e.building ? 1.3 : e.unit ? 0.8 : 0.55, !!e.building);
    }
    if (e.kind === 'shot') {
      // Mündungsfeuer an der Rohrspitze, dann die Leuchtspur
      const dir = Math.atan2(e.y2! - e.y!, e.x2! - e.x!);
      const [r, z] = MUZZLE[e.weapon ?? 'gewehr'] ?? [0.3, 10];
      const mx = e.x! + Math.cos(dir) * r, my = e.y! + Math.sin(dir) * r;
      if (e.weapon === 'bombe') {
        // Einschlag, wenn die Bombe unten ankommt
        const [bx, by] = [e.x2!, e.y2!];
        setTimeout(() => {
          this.addFx({ kind: 'explosion', x: bx, y: by, t: 0, life: 0.6 });
          for (let i = 0; i < 4; i++) this.addFx({ kind: 'smoke', x: bx + (Math.random() - 0.5) * 0.5, y: by + (Math.random() - 0.5) * 0.5, z: 8, vz: 22, size: 11, t: 0, life: 1.8 });
          this.soundAt('sfx.explosion', bx, by, 0.9);
        }, 550);
      } else this.addFx({ kind: 'flash', x: mx, y: my, z: z + (e.fromAir ? 34 : 0), size: e.weapon === 'gewehr' || e.weapon === 'mg' ? 4 : 8, t: 0, life: 0.08 });
      this.addFx({ kind: 'shot', x: mx, y: my, x2: e.x2, y2: e.y2, weapon: e.weapon, fromAir: e.fromAir, toAir: e.toAir, z: z + (e.fromAir ? 34 : 0), t: 0, life: e.weapon === 'bombe' ? 0.55 : e.weapon === 'schiffsgeschuetz' || e.weapon === 'granate' ? 0.22 : 0.12 });
    }
    if (e.kind === 'explosion') {
      this.addFx({ kind: 'explosion', x: e.x!, y: e.y!, t: 0, life: 0.7 });
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
        this.addFx({ kind: 'spark', x: e.x!, y: e.y!, z: 8, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: 60 + Math.random() * 80, t: 0, life: 0.45 + Math.random() * 0.3 });
      }
      for (let i = 0; i < 3; i++) this.addFx({ kind: 'smoke', x: e.x! + (Math.random() - 0.5) * 0.4, y: e.y! + (Math.random() - 0.5) * 0.4, z: 10, vz: 18, size: 10, t: 0, life: 1.6 });
      // Ausgebranntes Wrack bleibt eine Weile liegen und raucht
      if (e.unit && UNITS[e.unit] && UNITS[e.unit].armor !== 'luft' && UNITS[e.unit].domain !== 'see') {
        this.addFx({ kind: 'wreck', x: e.x!, y: e.y!, unit: e.unit, facing: e.facing ?? 0, t: 0, life: 25, next: 0 });
      }
    }
  }

  private addFx(fx: Effect) { if (this.effects.length < MAX_FX) this.effects.push(fx); }

  /** Krater an einer Einschlagstelle; zerstörte Gebäude brennen danach kurz, Staub und Rauch bleiben liegen */
  private addCrater(x: number, y: number, r: number, burning: boolean) {
    const map = this.map;
    map.craters ??= [];
    map.craters.push({ x, y, r: r * (0.8 + Math.random() * 0.5), v: Math.floor(Math.random() * 3) });
    if (map.craters.length > 260) map.craters.shift();
    this.addFx({ kind: 'smoke', x, y, z: 6, vz: 10, size: 9, t: 0, life: 5, color: '120,114,106' });
    this.addFx({ kind: 'dust', x, y, z: 2, vz: 2, size: 12, t: 0, life: 3, color: '150,134,104' } as Effect);
    if (burning) this.addFx({ kind: 'feuer', x, y, t: 0, life: 9 });
  }

  /** Staub hinter fahrenden Fahrzeugen, Rauch bei beschädigten Einheiten, Gebäuden und Wracks */
  private spawnAmbient(now: number) {
    const map = this.map;
    if (now > this.trackFade) { this.trackFade = now + 1.5; this.terrain?.fadeTracks(0.012); }
    const due = (id: number, every: number) => {
      const n = this.nextFx.get(id) ?? 0;
      if (now < n) return false;
      this.nextFx.set(id, now + every * (0.8 + Math.random() * 0.4));
      return true;
    };
    for (const u of map.units) {
      const def = UNITS[u.type];
      // Fahrspuren auch im Nebel aufzeichnen (der Nebel verdeckt sie ohnehin)
      if ((def.armor === 'schwer' || def.armor === 'leicht') && !def.domain) {
        this.terrain?.stamp(u.id, u.x, u.y, u.facing, def.armor === 'schwer' || def.turret ? 'kette' : 'rad', def.armor === 'schwer' ? (u.type === 'schwerer_panzer' ? 0.3 : 0.24) : 0.2);
      }
      if (!this.unitShown(u)) continue;
      const vehicle = def.armor === 'leicht' || def.armor === 'schwer';
      const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.001;
      if (vehicle && !def.domain && moving && map.terrain[Math.floor(u.y) * map.w + Math.floor(u.x)] !== T_WASSER && due(u.id, 0.13)) {
        this.addFx({ kind: 'dust', x: u.x - Math.cos(u.facing) * 0.38, y: u.y - Math.sin(u.facing) * 0.38, z: 3, vz: 6, size: 5, t: 0, life: 0.9 });
      }
      if (def.armor !== 'infanterie' && u.hp < def.hp * 0.35 && due(-u.id, 0.3)) {
        this.addFx({ kind: 'smoke', x: u.x, y: u.y, z: 14 + altitude(u), vz: 22, size: 5, t: 0, life: 1.8 });
      }
    }
    for (const b of map.buildings) {
      const def = BUILDINGS[b.type];
      if (b.hp >= def.hp * 0.4 || !this.buildingShown(b) || !due(-1e6 - b.id, 0.35)) continue;
      this.addFx({ kind: 'smoke', x: b.x + Math.random() * def.size, y: b.y + Math.random() * def.size, z: 20 + def.size * 8, vz: 20, size: 8, t: 0, life: 2.4 });
    }
    // ständiger Rauch aus Schornsteinen (Kraftwerk, Fabrik, Dorfhäuser)
    for (const b of map.buildings) {
      const ch = (assets.meta(BUILDINGS[b.type].sprite).smoke as [number, number, number][] | undefined) ?? CHIMNEYS[b.type];
      if (!ch || !this.buildingShown(b)) continue;
      ch.forEach(([cx, cy, z], k) => {
        if (due(-2e6 - b.id * 4 - k, 0.32)) this.addFx({ kind: 'smoke', x: b.x + cx, y: b.y + cy, z: z * 32, vz: 15, size: 5, t: 0, life: 3.6, color: '168,164,156' });
      });
    }
    this.game.state.provinces[this.id].villages.forEach((v, i) => {
      if (!this.villageShown(v)) return;
      if (v.layout && assets.has(plotKey(v.layout.plots[0]))) {
        // Schornsteinrauch der einzelnen Häuser
        v.layout.plots.forEach((p, j) => {
          if (!this.isExplored(p.x + p.w / 2, p.y + p.h / 2)) return;
          const sm = assets.meta(plotKey(p)).smoke as [number, number, number][] | undefined;
          sm?.forEach(([cx, cy, z], k) => {
            if (due(-3e6 - i * 4000 - j * 8 - k, 0.9)) this.addFx({ kind: 'smoke', x: p.x + cx, y: p.y + cy, z: z * 32, vz: 9, size: 3, t: 0, life: 2.8, color: '150,146,140' });
          });
        });
        return;
      }
      for (const [k, [cx, cy, z]] of ((assets.meta('village.dorf').smoke as [number, number, number][] | undefined) ?? VILLAGE_CHIMNEYS).entries()) {
        if (due(-3e6 - i * 8 - k, 0.7)) this.addFx({ kind: 'smoke', x: v.x - 1 + cx, y: v.y - 1 + cy, z: z * 32, vz: 9, size: 3, t: 0, life: 2.8, color: '150,146,140' });
      }
    });
    for (const w of this.effects) {
      if (w.kind !== 'wreck' || w.t > 10 || now < (w.next ?? 0)) continue;
      w.next = now + 0.45;
      this.addFx({ kind: 'smoke', x: w.x, y: w.y, z: 8, vz: 18, size: 6, t: 0, life: 2.2 });
    }
  }

  /** Mast steht auf einem Gebäude (später gebaut) – dann weglassen */
  private poleBlocked(tx: number, ty: number) {
    return this.map.buildings.some((b) => { const sz = BUILDINGS[b.type].size; return tx >= b.x - 0.1 && ty >= b.y - 0.1 && tx < b.x + sz + 0.1 && ty < b.y + sz + 0.1; });
  }

  /** Telegrafenmast mit Querträger und durchhängenden Leitungen zum nächsten Mast; stage = Überrollschaden (0 heil … 3 zerstört) */
  private drawPole(g: CanvasRenderingContext2D, sx: number, sy: number, wire: [number, number] | null | undefined, stage: Stage = 0, nextStage: Stage = 0) {
    const H = 30;
    const lean = stage === 1 ? 5 : 0; // schiefer Mast: Spitze weicht seitlich aus
    if (stage < 2) {
      g.fillStyle = 'rgba(0,0,0,0.22)';
      g.beginPath(); g.ellipse(sx + 1, sy, 3.5, 1.6, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2; // Schatten am Boden
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 14 + lean, sy + 5); g.stroke();
      g.strokeStyle = '#3d2e1e'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + lean, sy - H); g.stroke();
      g.strokeStyle = '#5a4630'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(sx + 0.6, sy - 1); g.lineTo(sx + 0.6 + lean, sy - H + 1); g.stroke();
      g.strokeStyle = '#3d2e1e'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(sx - 6 + lean, sy - H + 4 - lean * 0.2); g.lineTo(sx + 6 + lean, sy - H + 1 + lean * 0.2); g.stroke();
      g.fillStyle = '#d9d4c4';
      g.fillRect(sx - 6 + lean, sy - H + 2, 1.4, 2); g.fillRect(sx + 4.6 + lean, sy - H - 1, 1.4, 2);
    } else {
      // abgebrochen: kurzer Stumpf, der Rest liegt mit Querträger im Gras
      g.strokeStyle = '#3d2e1e'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + 0.5, sy - (stage === 2 ? 9 : 4)); g.stroke();
      if (stage === 2) {
        g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 3;
        g.beginPath(); g.moveTo(sx + 3, sy + 2); g.lineTo(sx + 25, sy + 10); g.stroke();
        g.strokeStyle = '#4a3a28'; g.lineWidth = 2.2;
        g.beginPath(); g.moveTo(sx + 2, sy - 1); g.lineTo(sx + 24, sy + 7); g.stroke();
        g.strokeStyle = '#3d2e1e'; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(sx + 21, sy + 2); g.lineTo(sx + 27, sy + 11); g.stroke();
      } else {
        g.fillStyle = '#6b5236';
        g.fillRect(sx + 4, sy + 1, 5, 1.4); g.fillRect(sx - 6, sy + 2, 4, 1.2);
      }
    }
    if (wire && stage < 2) {
      const [ex, ey] = this.iso(wire[0], wire[1]);
      g.strokeStyle = 'rgba(25,22,18,0.75)'; g.lineWidth = 0.8;
      for (const o of [-5.3, 5.3]) {
        const ax = sx + o + lean, ay = sy - H + 2.5 - o * 0.25;
        if (nextStage >= 2) {
          // Leitung vom Nachbarmast hängt herab und liegt am Boden (abgebrochener Mast bzw. Stumpf)
          const gx = ex + o * 0.6 + (nextStage === 2 ? 22 : 4), gy = ey + (nextStage === 2 ? 8 : 2) + o * 0.1;
          g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + gx) / 2, Math.max(ay, gy) + 2, gx, gy); g.stroke();
        } else {
          const bx = ex + o + (nextStage === 1 ? 5 : 0), by = ey - H + 2.5 - o * 0.25;
          g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + bx) / 2, (ay + by) / 2 + 7, bx, by); g.stroke();
        }
      }
    }
  }

  /** Baum mit Wind (heil) oder Überrollschaden: schiefgedrückt, umgeknickt, nur noch Stumpf */
  private drawTree(g: CanvasRenderingContext2D, p: Prop, sx: number, sy: number, sc: number, now: number) {
    const stage = p.stage ?? 0;
    const dir = tileHash(Math.floor(p.tx * 8), Math.floor(p.ty * 8), 5) < 0.5 ? -1 : 1;
    if (stage === 0) {
      // Wind: Böen laufen als Welle durch den Wald, die Krone neigt sich (Stamm bleibt am Boden)
      const gust = 0.55 + 0.45 * Math.sin(now * 0.23 + p.tx * 0.05);
      const lean = -(0.01 + 0.02 * gust * (0.6 + 0.4 * Math.sin(now * 1.7 - p.tx * WIND.x * 2.4 + p.ty * -WIND.y * 2.4 + p.depth)));
      g.save(); g.transform(sc, 0, lean * sc, sc, sx, sy); assets.sprite(g, p.key, 0, 0); g.restore();
    } else if (stage === 1) {
      g.save(); g.translate(sx, sy); g.rotate(dir * (0.3 + 0.1 * tileHash(p.tile ?? 0, 3, 9))); g.scale(sc, sc * 0.96); assets.sprite(g, p.key, 0, 0); g.restore();
    } else if (stage === 2) {
      // umgeknickt: die Krone liegt am Boden, am Stamm bleibt ein zersplitterter Stumpf
      this.drawStump(g, p, sx, sy, sc, 12);
      g.save(); g.translate(sx + dir * 4, sy + 1); g.rotate(dir * 1.38); g.scale(sc * 0.95, sc * 0.8); g.globalAlpha = 0.97; assets.sprite(g, p.key, 0, 0); g.restore();
    } else {
      // zerstört: nur ein niedriger Stumpf mit Splittern und Blättern
      this.drawStump(g, p, sx, sy, sc, 5);
      g.strokeStyle = '#4a3823'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(sx + 5 * sc, sy + 1); g.lineTo(sx + 11 * sc, sy + 3); g.moveTo(sx - 5 * sc, sy + 2); g.lineTo(sx - 12 * sc, sy + 1); g.moveTo(sx + 2, sy + 4); g.lineTo(sx + 7, sy + 6); g.stroke();
      g.fillStyle = 'rgba(52,70,32,0.85)';
      for (let k = 0; k < 4; k++) { g.beginPath(); g.ellipse(sx + (k - 1.5) * 6 * sc, sy + 3 + (k % 2) * 2, 3, 1.4, 0, 0, Math.PI * 2); g.fill(); }
    }
  }

  /** Baumstumpf (Rinde passend zur Baumart, helle Schnittfläche) */
  private drawStump(g: CanvasRenderingContext2D, p: Prop, sx: number, sy: number, sc: number, h: number) {
    const birch = p.key === 'object.baum4', cut = birch ? '#cdbf9a' : '#b8935c';
    const w = (birch ? 2.4 : 3) * sc, hh = h * sc;
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.ellipse(sx + 2, sy + 1, w * 1.8, w * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = birch ? '#d9d4c6' : p.key === 'object.baum2' ? '#4d4034' : '#4a3a28';
    g.beginPath(); g.moveTo(sx - w, sy); g.lineTo(sx - w * 0.85, sy - hh);
    if (h > 8) { g.lineTo(sx - w * 0.3, sy - hh - 3 * sc); g.lineTo(sx + w * 0.1, sy - hh + 1); g.lineTo(sx + w * 0.6, sy - hh - 2 * sc); }
    g.lineTo(sx + w * 0.85, sy - hh); g.lineTo(sx + w, sy); g.closePath(); g.fill();
    g.fillStyle = cut; g.beginPath(); g.ellipse(sx, sy - hh, w * 0.85, w * 0.38, 0, 0, Math.PI * 2); g.fill();
  }

  /** Alle 0,25 s: Wo hat sich der Überrollschaden geändert? Objekte wechseln die Stufe, Effekte und Ton folgen */
  private checkCrush(now: number) {
    const crush = this.map.crush;
    if (!crush || now < this.crushCheck) return;
    this.crushCheck = now + 0.25;
    if (this.crushSeen.length !== crush.length) this.crushSeen = new Float64Array(crush.length); // Schaden erst jetzt entstanden: alles Neue erkennen
    const seen = this.crushSeen;
    const T = this.terrain!;
    for (let i = 0; i < crush.length; i++) {
      if (crush[i] === seen[i]) continue;
      seen[i] = crush[i];
      const list = this.tileProps.get(i);
      if (list) for (const p of list) {
        const st = stageOf(p.kind!, crush[i], p.res);
        if (st === p.stage) continue;
        const was = p.stage ?? 0;
        p.stage = st;
        if (st > was) this.crushFx(p.tx, p.ty, p.kind!, st);
        if (p.kind === 'baum' && (st >= 2 || was >= 2)) T.invalidate(p.tx, p.ty); // Schatten neu einbacken
      }
      for (const ev of T.crushChanged(i, crush[i])) this.crushFx(ev.x, ev.y, ev.kind, ev.stage);
    }
  }

  /** Staub, Splitter und Ton, wenn etwas kaputtgefahren wird (nur im sichtbaren Bereich) */
  private crushFx(x: number, y: number, kind: DamageKind, stage: Stage) {
    if (!this.isVisible(x, y)) return;
    const burst = (n: number, color: string, size: number, speed: number, up: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
        this.addFx({ kind: 'debris', x, y, z: 3, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5, vz: up * (0.6 + Math.random() * 0.8), size, color, t: 0, life: 0.5 + Math.random() * 0.4 });
      }
    };
    if (kind === 'strasse') {
      this.addFx({ kind: 'smoke', x, y, z: 4, vz: 10, size: 7, t: 0, life: 1.4, color: '150,140,124' });
      burst(stage * 3, '#8a8174', 2.2, 60, 50);
      if (stage >= 2) this.soundAt('sfx.schutt', x, y, 0.7);
    } else if (kind === 'baum') {
      this.addFx({ kind: 'dust', x, y, z: 6, vz: 8, size: 7, t: 0, life: 0.9 });
      burst(2 + stage * 3, stage >= 2 ? '#4f6a2e' : '#6b5236', 2.2, 70, 80);
      if (stage >= 2) { this.addFx({ kind: 'dust', x: x + 0.2, y, z: 4, vz: 6, size: 9, t: 0, life: 1.1 }); this.soundAt('sfx.knacken', x, y, 0.75); }
    } else if (kind === 'mast') {
      burst(4 + stage * 3, '#7a6040', 2, 80, 90);
      if (stage >= 2) { for (let i = 0; i < 6; i++) this.addFx({ kind: 'spark', x, y, z: 22, vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 40, vz: 40 + Math.random() * 50, t: 0, life: 0.5 }); this.soundAt('sfx.knacken', x, y, 0.8); }
    } else {
      this.addFx({ kind: 'dust', x, y, z: 3, vz: 5, size: 5, t: 0, life: 0.7 });
      burst(2 + stage * 2, '#7a6040', 1.8, 55, 60);
      if (stage >= 2) this.soundAt('sfx.knacken', x, y, 0.45);
    }
  }

  private drawFx(g: CanvasRenderingContext2D, fx: Effect) {
    const k = fx.t / fx.life;
    const [x1, y1] = this.iso(fx.x, fx.y);
    const z = (fx.z ?? 0) + (fx.vz ?? 0) * fx.t;
    switch (fx.kind) {
      case 'feuer': {
        // Brand nach dem Treffer: flackernde Flammen, die zum Ende hin niedriger werden
        const fade = 1 - k;
        for (let j = 0; j < 4; j++) {
          const f = Math.sin(fx.t * (9 + j * 3) + j * 2) * 0.5 + 0.5;
          g.globalAlpha = fade * (0.55 + 0.4 * f);
          g.fillStyle = j % 2 ? '#ffb347' : '#ff6a1f';
          g.beginPath(); g.ellipse(x1 + (j - 1.5) * 4, y1 - 2 - f * 3 * fade, 3 + f, 5 + f * 3 * fade, 0, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        break;
      }
      case 'wreck': {
        const def = UNITS[fx.unit!];
        const fade = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
        g.fillStyle = `rgba(20,16,12,${0.45 * fade})`;
        g.beginPath(); g.ellipse(x1, y1, 26, 12, 0, 0, Math.PI * 2); g.fill();
        assets.sprite(g, def.sprite, x1, y1, { frame: dirFrame(fx.facing!, assets.frames(def.sprite)), tint: '#17130f', tintStrength: 0.78, alpha: fade });
        if (assets.has(`${def.sprite}.turm`)) assets.sprite(g, `${def.sprite}.turm`, x1, y1, { frame: dirFrame(fx.facing! + 0.7, assets.frames(`${def.sprite}.turm`)), tint: '#17130f', tintStrength: 0.8, alpha: fade });
        break;
      }
      case 'dust': {
        g.fillStyle = `rgba(190,172,128,${0.35 * (1 - k)})`;
        g.beginPath(); g.ellipse(x1, y1 - z, (fx.size ?? 5) * (1 + k * 1.6), (fx.size ?? 5) * (0.6 + k), 0, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'smoke': {
        const r = (fx.size ?? 6) * (1 + k * 2.2);
        g.fillStyle = fx.color ? `rgba(${fx.color},${0.5 * (1 - k)})` : `rgba(55,55,55,${0.42 * (1 - k)})`;
        g.beginPath(); g.arc(x1 + k * 6, y1 - z, r, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'debris': {
        // Holzsplitter, Blätter oder Steine fliegen und fallen zu Boden
        const px = x1 + (fx.vx ?? 0) * fx.t, py = y1 + (fx.vy ?? 0) * fx.t - ((fx.z ?? 0) + (fx.vz ?? 0) * fx.t - 130 * fx.t * fx.t);
        g.fillStyle = fx.color ?? '#6b5236';
        g.globalAlpha = 1 - k * k;
        g.fillRect(px - 1, Math.min(py, y1) - 1, fx.size ?? 2, (fx.size ?? 2) * 0.75);
        g.globalAlpha = 1;
        break;
      }
      case 'spark': {
        const px = x1 + (fx.vx ?? 0) * fx.t, py = y1 + (fx.vy ?? 0) * fx.t - ((fx.z ?? 0) + (fx.vz ?? 0) * fx.t - 160 * fx.t * fx.t);
        g.fillStyle = k < 0.5 ? '#fff2a8' : '#ff8a2a';
        g.globalAlpha = 1 - k;
        g.fillRect(px - 1, py - 1, 2.2, 2.2);
        g.globalAlpha = 1;
        break;
      }
      case 'flash': {
        const r = (fx.size ?? 6) * (1.2 - k * 0.6);
        const grad = g.createRadialGradient(x1, y1 - z, 0, x1, y1 - z, r);
        grad.addColorStop(0, 'rgba(255,255,230,1)'); grad.addColorStop(0.4, 'rgba(255,210,90,0.9)'); grad.addColorStop(1, 'rgba(255,140,30,0)');
        g.fillStyle = grad;
        g.beginPath(); g.arc(x1, y1 - z, r, 0, Math.PI * 2); g.fill();
        break;
      }
      case 'shot': {
        const [x2, y2] = this.iso(fx.x2!, fx.y2!);
        if (fx.weapon === 'bombe') {
          // Bombe fällt vom Sturzkampfbomber aufs Ziel (beschleunigt), mit kurzem Pfeifen im Ton
          const ya = y1 - (fx.z ?? 40), yb = y2 - 4;
          const bx = x1 + (x2 - x1) * k, by = ya + (yb - ya) * k * k;
          const ang = Math.atan2((yb - ya) * 2 * k + 1e-3, x2 - x1 || 1e-3);
          g.fillStyle = '#20201c';
          g.save(); g.translate(bx, by); g.rotate(ang); g.beginPath(); g.ellipse(0, 0, 3.4, 1.4, 0, 0, Math.PI * 2); g.fill(); g.restore();
          break;
        }
        const style: Record<string, [string, number]> = { gewehr: ['#fff3a0', 1], mg: ['#ffe066', 1.5], panzerbuechse: ['#fff3a0', 1.6], kanone: ['#fff', 3], granate: ['#ffcf70', 1.5], luftkanone: ['#ffe066', 1.5], flak: ['#ffd0a0', 2], schiffskanone: ['#fff', 3], schiffsgeschuetz: ['#fff', 3] };
        const [c, lw] = style[fx.weapon ?? 'gewehr'] ?? ['#fff', 1];
        g.strokeStyle = c; g.lineWidth = lw; g.globalAlpha = 1 - k;
        const ya = y1 - (fx.z ?? 12), yb = y2 - (fx.toAir ? 38 : 8);
        g.beginPath(); g.moveTo(x1, ya); g.lineTo(x2, yb); g.stroke();
        if (lw >= 2) {
          g.fillStyle = '#ffd34a';
          g.beginPath(); g.arc(x2, yb, 6 * (1 - k) + 2, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 1;
        break;
      }
      case 'explosion': {
        const s = 40 * (0.8 + k * 1.4);
        assets.draw(g, 'effect.explosion', x1 - s / 2, y1 - s * 0.75, s, s, { alpha: 1 - k });
        break;
      }
      case 'marker': {
        g.strokeStyle = fx.color!; g.lineWidth = 2; g.globalAlpha = 1 - k;
        g.beginPath(); g.ellipse(x1, y1, 6 + k * 14, (6 + k * 14) / 2, 0, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
        break;
      }
    }
  }

  /** Luftschraube der Propellerflugzeuge (Ju 87, Bf 109) – wird live animiert */
  private drawAirExtras(g: CanvasRenderingContext2D, u: Unit, ux: number, uy: number, sx: number, sy: number, alt: number) {
    const now = performance.now() / 1000;
    const isoOff = (dx: number, dy: number): [number, number] => [(dx - dy) * this.HW, (dx + dy) * this.HH];
    const prop = assets.meta(UNITS[u.type].sprite).prop;
    if (!prop) return;
    // drehende Luftschraube als halbtransparente Scheibe an der Nase
    const [pd, ph] = prop;
    const [px, py] = this.iso(ux + Math.cos(u.facing) * pd, uy + Math.sin(u.facing) * pd);
    const [ox, oy] = isoOff(-Math.sin(u.facing) * 0.32, Math.cos(u.facing) * 0.32);
    const cy = py - alt - ph;
    g.fillStyle = 'rgba(30,30,30,0.18)';
    g.beginPath(); g.ellipse(px, cy, Math.max(2, Math.abs(ox)), Math.max(3, Math.abs(oy) + 6), 0, 0, Math.PI * 2); g.fill();
    const th = now * 50 + u.id;
    g.strokeStyle = 'rgba(15,15,15,0.55)'; g.lineWidth = 1.6;
    const k = Math.cos(th);
    g.beginPath(); g.moveTo(px - ox * k, cy - oy * k - 6 * Math.sin(th)); g.lineTo(px + ox * k, cy + oy * k + 6 * Math.sin(th)); g.stroke();
  }

  updatePanel() { this.panel.render(); this.cmdbar.render(); }

  // ---------- Zeichnen ----------
  render(g: CanvasRenderingContext2D, w: number, h: number, alpha: number, dt: number) {
    const state = this.game.state;
    const map = this.map;
    const HW = this.HW, HH = this.HH;
    // Kamera per Pfeiltasten / Bildschirmrand
    const sp = 900 * dt / this.cam.zoom;
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= sp;
    if (this.keys.has('ArrowRight')) dx += sp;
    if (this.keys.has('ArrowUp')) dy -= sp;
    if (this.keys.has('ArrowDown')) dy += sp;
    if (this.mouse.in && !this.touchMode && !this.drag && !this.pan) {
      const m = 14;
      if (this.mouse.x < m) dx -= sp; else if (this.mouse.x > w - m) dx += sp;
      if (this.mouse.y < m) dy -= sp; else if (this.mouse.y > h - m) dy += sp;
    }
    if (dx || dy) { this.cam.x += dx; this.cam.y += dy; this.clampCam(); }

    this.fogTimer -= dt;
    if (this.fogTimer <= 0) { this.fogTimer = 0.15; this.updateFog(); }

    // Auswahl bereinigen (auch Einheiten, die im Nebel verschwinden)
    for (const id of this.sel) {
      const u = map.units.find((x) => x.id === id);
      if (!u || !this.unitShown(u)) this.sel.delete(id);
    }
    if (this.selBuilding != null && !map.buildings.some((b) => b.id === this.selBuilding)) this.selBuilding = null;
    const q = queuesOf(map, PLAYER);
    if (this.placing && !q.struct?.ready) this.setMode('none');
    if ((this.moveMode || this.attackMode) && !this.ownSelected().length) this.setMode('none');

    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.save();
    g.scale(this.cam.zoom, this.cam.zoom);
    g.translate(-this.cam.x, -this.cam.y);
    const vx0 = this.cam.x - HW * 2, vx1 = this.cam.x + w / this.cam.zoom + HW * 2;
    const vy0 = this.cam.y - HH * 2, vy1 = this.cam.y + h / this.cam.zoom + 160;
    const onScreen = (wx: number, wy: number) => wx >= vx0 && wx <= vx1 && wy >= vy0 && wy <= vy1;

    // 1) Boden aus vorberechneten Abschnitten, darüber Matsch und Fahrspuren
    const T = this.terrain!;
    this.mudCheck -= dt;
    let mudBudget = this.mudCheck <= 0 ? 1 : 0; // höchstens ein Matsch-Abschnitt pro Prüfung neu berechnen
    if (this.mudCheck <= 0) this.mudCheck = 0.8;
    this.paveCheck -= dt;
    let paveBudget = performance.now() < this.syncUntil + 1500 ? 6 : this.paveCheck <= 0 ? 1 : 0; // Straßenschäden ebenso
    if (this.paveCheck <= 0) this.paveCheck = 0.7;
    const visibleChunks: [number, number, number][] = [];
    const nearChunks: [number, number][] = [];
    const [mcx, mcy] = this.toTile(w / 2, h / 2);
    for (let cy = 0; cy < map.h; cy += CHUNK) for (let cx = 0; cx < map.w; cx += CHUNK) {
      const [left] = this.iso(cx, cy + CHUNK), [right] = this.iso(cx + CHUNK, cy);
      const [, top] = this.iso(cx, cy), [, bottom] = this.iso(cx + CHUNK, cy + CHUNK);
      if (right < vx0 - 700 || left > vx1 + 700 || bottom < vy0 - 900 || top > vy1 + 500) continue;
      if (right < vx0 || left > vx1 || bottom < vy0 - 200 || top > vy1) { nearChunks.push([cx, cy]); continue; }
      visibleChunks.push([cx, cy, Math.hypot(cx + CHUNK / 2 - mcx, cy + CHUNK / 2 - mcy)]);
    }
    visibleChunks.sort((a, b) => a[2] - b[2]); // Bildmitte zuerst
    for (const [cx, cy] of visibleChunks) {
      // beim Öffnen bis ca. 0,35 s sofort bauen (Bildmitte zuerst), danach im Hintergrund
      const c = T.ground(cx, cy, this.firstFrame && performance.now() < this.syncUntil) ?? T.fallback(cx, cy);
      g.drawImage(c.canvas, c.x, c.y);
      const pv = T.paveLayer(cx, cy, paveBudget > 0);
      if (pv) {
        if (paveBudget > 0 && !this.paveSeen.has(pv)) paveBudget--;
        this.paveSeen.add(pv);
        g.drawImage(pv.canvas, pv.x, pv.y, pv.canvas.width * (pv.scale ?? 1), pv.canvas.height * (pv.scale ?? 1));
      }
      const mud = T.mudLayer(cx, cy, mudBudget > 0);
      if (mud && mudBudget > 0 && !this.mudSeen.has(mud)) mudBudget--;
      if (mud) { this.mudSeen.add(mud); g.drawImage(mud.canvas, mud.x, mud.y, mud.canvas.width * (mud.scale ?? 1), mud.canvas.height * (mud.scale ?? 1)); }
      const tr = T.trackLayer(cx, cy);
      if (tr) g.drawImage(tr.canvas, tr.x, tr.y);
    }

    if (map.w * map.h > 100 * 100) for (const [cx, cy] of nearChunks) T.want(cx, cy);
    const now = performance.now() / 1000;
    const isoFn = (x: number, y: number) => this.iso(x, y);
    this.checkCrush(now);
    this.ambient.update(this.game.paused ? 0 : dt, map.units);
    this.ambienceTick(dt);
    this.ambient.drawWater(g, isoFn, onScreen, now);

    // übrige Abschnitte im Hintergrund weiterbauen (ein paar Millisekunden pro Bild)
    if (this.firstFrame) { this.firstFrame = false; T.prewarm(); }
    T.pump(7);

    // 2) Bodenmarkierungen: Bauradius, Auswahl, Platzierung
    const diamond = (x: number, y: number, sw: number, sh: number) => {
      g.beginPath();
      const pts = [this.iso(x, y), this.iso(x + sw, y), this.iso(x + sw, y + sh), this.iso(x, y + sh)];
      g.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) g.lineTo(p[0], p[1]);
      g.closePath();
    };
    if (this.placing) {
      const R = ECON.buildRadius;
      g.fillStyle = 'rgba(120,255,120,0.06)';
      g.strokeStyle = 'rgba(120,255,120,0.35)';
      g.lineWidth = 1;
      for (const b of map.buildings) {
        if (b.faction !== PLAYER) continue;
        const s = BUILDINGS[b.type].size;
        diamond(b.x - R, b.y - R, s + 2 * R, s + 2 * R);
        g.fill(); g.stroke();
      }
    }
    for (const b of map.buildings) {
      if (b.id !== this.selBuilding) continue;
      const s = BUILDINGS[b.type].size;
      g.strokeStyle = 'rgba(232,184,74,0.5)'; g.lineWidth = 1;
      diamond(b.x, b.y, s, s); g.stroke();
      {
        const [lx] = this.iso(b.x, b.y + s), [rx] = this.iso(b.x + s, b.y), [, ty] = this.iso(b.x, b.y), [, by] = this.iso(b.x + s, b.y + s);
        brackets(g, lx - 4, ty - s * HH * 1.7, rx + 4, by + 4, b.faction === PLAYER ? '#e8b84a' : '#e8503c');
      }
      if (b.rally && b.faction === PLAYER) {
        const [ax, ay] = this.iso(b.x + s / 2, b.y + s);
        const [rx, ry] = this.iso(b.rally[0], b.rally[1]);
        g.strokeStyle = '#ffe066'; g.lineWidth = 1.5; g.setLineDash([5, 5]);
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(rx, ry); g.stroke(); g.setLineDash([]);
        g.strokeStyle = '#222'; g.beginPath(); g.moveTo(rx, ry); g.lineTo(rx, ry - 24); g.stroke();
        g.fillStyle = '#ffe066'; g.fillRect(rx, ry - 24, 12, 8);
      }
    }
    const prov = state.provinces[this.id];
    for (const v of prov.villages) {
      if (v.id !== this.selVillage) continue;
      g.strokeStyle = '#ffe066'; g.lineWidth = 1.5; g.setLineDash([8, 6]);
      const [cx, cy] = this.iso(v.x + 0.5, v.y + 0.5), R = ECON.protectionRadius;
      g.beginPath(); g.ellipse(cx, cy, R * HW * Math.SQRT2, R * HH * Math.SQRT2, 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    let placeErr: string | null = null;
    let ghost: { key: string; x: number; y: number; s: number } | null = null;
    if (this.placing && q.struct?.ready && this.mouse.in) {
      const def = BUILDINGS[q.struct.type];
      const [tx, ty] = this.toTile(this.mouse.x, this.mouse.y);
      const bx = Math.floor(tx) - ((def.size - 1) >> 1), by = Math.floor(ty) - ((def.size - 1) >> 1);
      placeErr = placementError(state, this.id, PLAYER, q.struct.type, bx, by);
      g.fillStyle = placeErr ? 'rgba(255,60,60,0.4)' : 'rgba(80,255,80,0.35)';
      for (let yy = by; yy < by + def.size; yy++) for (let xx = bx; xx < bx + def.size; xx++) { diamond(xx, yy, 1, 1); g.fill(); }
      ghost = { key: def.sprite, x: bx, y: by, s: def.size };
    }

    // 3) Objekte nach Tiefe sortiert
    type Item = { d: number; draw: () => void };
    const items: Item[] = [];
    for (const p of this.props) {
      const [sx, sy] = this.iso(p.tx, p.ty);
      if (!onScreen(sx, sy)) continue;
      const sc = p.scale ?? 1;
      items.push({ d: p.depth, draw: () => {
        if (p.key === 'mast') { if (!this.poleBlocked(p.tx, p.ty)) this.drawPole(g, sx, sy, p.wire && !this.poleBlocked(...p.wire) ? p.wire : null, p.stage ?? 0, p.next?.stage ?? 0); return; }
        if (p.key.startsWith('object.baum')) { this.drawTree(g, p, sx, sy, sc, now); return; }
        if (sc === 1) { assets.sprite(g, p.key, sx, sy); return; }
        g.save(); g.translate(sx, sy); g.scale(sc, sc); assets.sprite(g, p.key, 0, 0); g.restore();
      } });
    }
    for (const v of prov.villages) {
      if (v.layout && v.layout.plots.length && assets.has(plotKey(v.layout.plots[0]))) {
        // Dorf aus einzelnen Grundstücken an der Straße
        for (const p of v.layout.plots) {
          if (!this.isExplored(p.x + p.w / 2, p.y + p.h / 2)) continue;
          const [sx, sy] = this.iso(p.x + p.w, p.y + p.h);
          if (!onScreen(sx, sy) && !onScreen(sx, sy - 120)) continue;
          const key = plotKey(p);
          // Dorfplatz: Fahne der Fraktion, die das Dorf besitzt, besetzt hält oder Schutzgeld nimmt
          const flagMeta = p.kind === 'gemeinde' ? assets.meta(key).flag : undefined;
          const holder = v.status === 'neutral' ? null : (v.status === 'schutz' || v.status === 'schutz-pausiert') ? v.schutz : prov.owner === 'neutral' ? null : prov.owner;
          items.push({ d: p.x + p.y + (p.w + p.h) / 2, draw: () => {
            assets.sprite(g, key, sx, sy);
            drawAnims(g, key, sx, sy, now, p.x + p.y);
            if (flagMeta && holder && FACTIONS[holder]) drawFlag(g, sx + flagMeta[0], sy + flagMeta[1], FACTIONS[holder].color, p.x * 97 + p.y, 1.3);
          } });
        }
        continue;
      }
      if (!this.villageShown(v)) continue;
      const [sx, sy] = this.iso(v.x + 2, v.y + 2);
      if (onScreen(sx, sy)) items.push({ d: v.x + v.y + 1, draw: () => assets.sprite(g, 'village.dorf', sx, sy) });
    }
    for (const b of map.buildings) {
      if (!this.buildingShown(b)) continue;
      const def = BUILDINGS[b.type];
      const [sx, sy] = this.iso(b.x + def.size, b.y + def.size);
      if (!onScreen(sx, sy)) continue;
      items.push({ d: b.x + b.y + def.size, draw: () => {
        const meta = assets.meta(def.sprite);
        assets.sprite(g, def.sprite, sx, sy, { frame: dirFrame(b.facing, assets.frames(def.sprite)), tint: FACTIONS[b.faction].color, tintStrength: meta.tint ?? 0.18 });
        drawAnims(g, def.sprite, sx, sy, b.hp < def.hp * 0.4 ? 0 : now, b.id);
        if (meta.flag) { drawFlag(g, sx + meta.flag[0], sy + meta.flag[1], FACTIONS[b.faction].color, b.id); return; }
        // Fahne in Teamfarbe an der vorderen Ecke
        const [fx, fy] = this.iso(b.x + def.size - 0.15, b.y + def.size - 0.15);
        g.strokeStyle = '#222'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx, fy - 22); g.stroke();
        g.fillStyle = FACTIONS[b.faction].color;
        g.fillRect(fx, fy - 22, 11, 7);
      } });
    }
    for (const u of map.units) {
      if (!this.unitShown(u)) continue;
      const ux = u.px + (u.x - u.px) * alpha, uy = u.py + (u.y - u.py) * alpha;
      const [sx, sy] = this.iso(ux, uy);
      if (!onScreen(sx, sy)) continue;
      const def = UNITS[u.type];
      const alt = altitude(u);
      const naval = def.domain === 'see';
      const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.001;
      // Flugzeuge immer über allen Bodenobjekten; Schatten am Boden
      items.push({ d: (alt ? 1e6 : 0) + ux + uy, draw: () => {
        if (naval) {
          // Bugwelle und Kielwasser bei Fahrt, sonst leichte Kreise im Wasser
          const t = performance.now() / 1000;
          g.strokeStyle = 'rgba(235,245,255,0.55)'; g.lineWidth = 1.2;
          if (moving) {
            for (let k = 1; k <= 3; k++) {
              const [wx, wy] = this.iso(ux - Math.cos(u.facing) * 0.35 * k, uy - Math.sin(u.facing) * 0.35 * k);
              g.globalAlpha = 0.5 / k;
              g.beginPath(); g.ellipse(wx, wy, 6 + k * 4, 3 + k * 2, 0, 0, Math.PI * 2); g.stroke();
            }
            g.globalAlpha = 1;
          } else {
            g.globalAlpha = 0.25 + 0.15 * Math.sin(t * 2 + u.id);
            g.beginPath(); g.ellipse(sx, sy, 26, 12, 0, 0, Math.PI * 2); g.stroke();
            g.globalAlpha = 1;
          }
        }
        if (alt) {
          g.fillStyle = 'rgba(0,0,0,0.28)';
          g.beginPath(); g.ellipse(sx, sy, 18, 9, 0, 0, Math.PI * 2); g.fill();
        }
        if (this.sel.has(u.id)) {
          const inf = def.armor === 'infanterie';
          g.strokeStyle = u.faction === PLAYER ? 'rgba(232,184,74,0.55)' : 'rgba(232,80,60,0.55)'; g.lineWidth = 1;
          g.beginPath(); g.ellipse(sx, sy, inf ? 11 : naval ? 34 : 24, inf ? 5.5 : naval ? 16 : 12, 0, 0, Math.PI * 2); g.stroke();
        }
        const bob = naval ? Math.sin(performance.now() / 600 + u.id) * 1.5 : 0;
        const meta = assets.meta(def.sprite);
        const col = FACTIONS[u.faction].color, strength = meta.tint ?? (def.armor === 'infanterie' ? 0.35 : 0.38);
        if (meta.photo && !alt) {
          // gerenderte Einheit: Teamfarbe zusätzlich als dezenter Ring am Boden
          g.strokeStyle = col; g.globalAlpha = 0.55; g.lineWidth = 2;
          const inf = def.armor === 'infanterie';
          g.beginPath(); g.ellipse(sx, sy + 1, naval ? 40 : inf ? 9 : 26, naval ? 19 : inf ? 4.5 : 13, 0, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
        }
        // Infanterie: Laufanimation (Reihe 1 und 2 abwechselnd), sonst Stehen (Reihe 0)
        const row = assets.rows(def.sprite) > 1 && moving ? 1 + (Math.floor(performance.now() / 140 + u.id) % 2) : 0;
        assets.sprite(g, def.sprite, sx, sy - alt + bob, { frame: dirFrame(u.facing, assets.frames(def.sprite)), row, tint: col, tintStrength: strength });
        const turm = `${def.sprite}.turm`;
        if (assets.has(turm)) assets.sprite(g, turm, sx, sy - alt + bob, { frame: dirFrame(u.aim ?? u.facing, assets.frames(turm)), tint: col, tintStrength: strength });
        if (alt) this.drawAirExtras(g, u, ux, uy, sx, sy, alt);
      } });
    }
    this.ambient.items(g, isoFn, onScreen, (x, y) => this.isExplored(x, y), items);
    // Vorschau der gezogenen Linie: jedes Feld als Raute
    if (this.lineDrag) {
      for (const [x, y] of lineTiles(this.lineDrag.x0, this.lineDrag.y0, this.lineDrag.x1, this.lineDrag.y1)) {
        const c = [this.iso(x, y), this.iso(x + 1, y), this.iso(x + 1, y + 1), this.iso(x, y + 1)];
        items.push({ d: 1e9, draw: () => {
          g.beginPath(); g.moveTo(c[0][0], c[0][1]); for (const [px, py] of c.slice(1)) g.lineTo(px, py); g.closePath();
          g.fillStyle = 'rgba(240,196,99,0.22)'; g.fill(); g.strokeStyle = 'rgba(240,196,99,0.9)'; g.lineWidth = 1.2; g.stroke();
        } });
      }
    }
    if (ghost) {
      const [sx, sy] = this.iso(ghost.x + ghost.s, ghost.y + ghost.s);
      items.push({ d: 1e9, draw: () => assets.sprite(g, ghost!.key, sx, sy, { alpha: 0.6 }) });
    }
    items.sort((a, b) => a.d - b.d);
    // Bodeneffekte (Wracks, Staub) unter den Objekten
    this.effects = this.effects.filter((fx) => (fx.t += dt) < fx.life);
    this.spawnAmbient(performance.now() / 1000);
    // Krater am Boden (dauerhafte Bodenmarken, nur im aufgeklärten Gelände)
    for (const c of map.craters ?? []) {
      const [cx, cy] = this.iso(c.x, c.y);
      if (!onScreen(cx, cy) || !this.isExplored(c.x, c.y)) continue;
      const W = c.r * this.HW * 3.2, H = W * 0.5;
      g.drawImage(craterTexture(c.v), cx - W / 2, cy - H / 2, W, H);
    }
    for (const fx of this.effects) if (GROUND_FX.includes(fx.kind) && onScreen(...this.iso(fx.x, fx.y))) this.drawFx(g, fx);
    for (const it of items) it.draw();

    // 4) Effekte über den Objekten
    for (const fx of this.effects) if (!GROUND_FX.includes(fx.kind) && onScreen(...this.iso(fx.x, fx.y))) this.drawFx(g, fx);

    this.ambient.drawSky(g, isoFn, [vx0, vy0, vx1, vy1], now);

    // 5) Nebel des Krieges: weich interpoliertes Raster über die Karte legen
    g.save();
    g.transform(HW, HH, -HW, HH, map.h * HW, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.fog, -1, -1);
    g.restore();

    // (Farbstimmung ist in Boden und Grafiken eingebacken, Vignette per CSS)

    // 6) Lebensbalken und Dorfnamen (über dem Nebel, nur wenn sichtbar/erkundet)
    for (const b of map.buildings) {
      if (!this.buildingShown(b)) continue;
      const def = BUILDINGS[b.type];
      if (b.id !== this.selBuilding && b.hp >= def.hp) continue;
      const [fw, fh] = assets.frameSize(def.sprite);
      const [sx, sy] = this.iso(b.x + def.size, b.y + def.size);
      this.hpBar(g, sx - fw * 0.3, sy - fh - 4, fw * 0.6, b.hp / def.hp);
    }
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 180);
    for (const b of map.buildings) {
      if (!b.repairing || !this.buildingShown(b)) continue;
      const def = BUILDINGS[b.type];
      const [, fh] = assets.frameSize(def.sprite);
      const [sx, sy] = this.iso(b.x + def.size, b.y + def.size);
      const cy = sy - fh - 18;
      g.globalAlpha = pulse;
      g.fillStyle = '#1e5a24'; g.beginPath(); g.arc(sx, cy, 10, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7dff7d'; g.fillRect(sx - 6, cy - 2, 12, 4); g.fillRect(sx - 2, cy - 6, 4, 12);
      g.globalAlpha = 1;
    }
    for (const u of map.units) {
      if (!this.unitShown(u)) continue;
      const def = UNITS[u.type];
      if (!this.sel.has(u.id) && u.hp >= def.hp) continue;
      const [sx, sy] = this.iso(u.px + (u.x - u.px) * alpha, u.py + (u.y - u.py) * alpha);
      const inf = def.armor === 'infanterie';
      if (this.sel.has(u.id)) {
        // goldene Eckklammern um die gewählte Einheit
        const bw2 = inf ? 13 : def.domain === 'see' ? 40 : 30, top = (inf ? 30 : 34) + altitude(u);
        brackets(g, sx - bw2, sy - top, sx + bw2, sy + (inf ? 6 : 12), u.faction === PLAYER ? '#e8b84a' : '#e8503c');
      }
      const bw = inf ? 18 : 30;
      this.hpBar(g, sx - bw / 2, sy - (inf ? 32 : 38) - altitude(u), bw, u.hp / def.hp);
    }
    g.font = 'bold 10px system-ui, sans-serif';
    g.textAlign = 'center';
    for (const u of map.units) {
      if (u.faction !== PLAYER) continue;
      const n = this.groupOf(u.id);
      if (n == null) continue;
      const [sx, sy] = this.iso(u.px + (u.x - u.px) * alpha, u.py + (u.y - u.py) * alpha);
      const inf = UNITS[u.type].armor === 'infanterie';
      const bx = sx + (inf ? 11 : 17), by = sy - (inf ? 34 : 40) - altitude(u);
      g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(bx - 5, by - 5, 10, 11);
      g.fillStyle = '#ffe066'; g.fillText(String(n), bx, by + 4);
    }
    g.textAlign = 'center';
    g.font = 'bold 12px system-ui, sans-serif';
    for (const v of prov.villages) {
      if (!this.villageShown(v)) continue;
      const [sx, sy] = this.iso(v.x - 1, v.y - 1);
      if (!onScreen(sx, sy + 40)) continue;
      const col = v.status === 'aufstand' ? '#ff3b3b' : v.status === 'schutz' || v.status === 'schutz-pausiert' ? FACTIONS[v.schutz!].color : FACTIONS[prov.owner].color;
      const label = `${v.name} · ${Math.round(v.pop)}`;
      const tw = g.measureText(label).width + 16;
      const ly = sy - 46;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.fillRect(sx - tw / 2, ly, tw, 15);
      g.fillStyle = col;
      g.fillRect(sx - tw / 2 + 3, ly + 4, 7, 7);
      g.fillStyle = '#fff';
      g.fillText(label, sx + 5, ly + 11.5);
    }
    g.restore();

    // 7) Auswahlrahmen und Hinweise in Bildschirmkoordinaten
    if (this.drag && Math.abs(this.drag.x1 - this.drag.x0) + Math.abs(this.drag.y1 - this.drag.y0) >= 6) {
      const d = this.drag;
      g.strokeStyle = '#7dff7d'; g.lineWidth = 1;
      g.fillStyle = 'rgba(125,255,125,0.08)';
      g.fillRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.strokeRect(Math.min(d.x0, d.x1) + 0.5, Math.min(d.y0, d.y1) + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    const hint = this.lineType ? 'Linie ziehen: Linksklick halten und ziehen · Rechtsklick: abbrechen'
      : this.placing ? (placeErr ?? 'Linksklick: platzieren · Rechtsklick: abbrechen')
      : this.attackMode ? 'Angriffsbewegung: Ziel anklicken'
      : this.moveMode ? 'Bewegen: Ziel anklicken · Rechtsklick: abbrechen'
      : this.repairMode ? 'Reparieren: eigenes Gebäude anklicken (nochmal = stoppen) · R/Rechtsklick: beenden' : null;
    if (hint && this.mouse.in) {
      g.font = '12px system-ui, sans-serif';
      g.textAlign = 'left';
      const tw = g.measureText(hint).width + 10;
      g.fillStyle = 'rgba(0,0,0,0.75)';
      g.fillRect(this.mouse.x + 14, this.mouse.y + 14, tw, 18);
      g.fillStyle = placeErr ? '#ff8080' : '#fff';
      g.fillText(hint, this.mouse.x + 19, this.mouse.y + 27);
    }
    this.game.canvas.style.cursor = this.placing || this.lineType ? 'copy' : this.attackMode ? 'crosshair' : this.moveMode ? 'pointer' : this.repairMode ? 'cell' : 'default';
    this.panel.drawMinimap();
  }

  private hpBar(g: CanvasRenderingContext2D, x: number, y: number, w: number, frac: number) {
    g.fillStyle = 'rgba(0,0,0,0.7)';
    g.fillRect(x, y, w, 4);
    g.fillStyle = frac > 0.6 ? '#5ad65a' : frac > 0.3 ? '#e6c440' : '#e04a3a';
    g.fillRect(x + 0.5, y + 0.5, (w - 1) * Math.max(0, frac), 3);
  }

  /** Eckpunkte des sichtbaren Bildschirmausschnitts in Kachelkoordinaten */
  viewCorners(): [number, number][] {
    const w = this.game.viewW, h = this.game.viewH;
    return [this.toTile(0, 0), this.toTile(w, 0), this.toTile(w, h), this.toTile(0, h)];
  }
}

/** Eckklammern (Auswahlrahmen im Stil des Bildes) */
function brackets(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, color: string) {
  const L = Math.max(5, Math.min(12, (x1 - x0) * 0.22, (y1 - y0) * 0.3));
  g.save();
  g.lineWidth = 2; g.lineCap = 'square';
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  const path = (o: number) => {
    g.beginPath();
    g.moveTo(x0 + o, y0 + L + o); g.lineTo(x0 + o, y0 + o); g.lineTo(x0 + L + o, y0 + o);
    g.moveTo(x1 - L + o, y0 + o); g.lineTo(x1 + o, y0 + o); g.lineTo(x1 + o, y0 + L + o);
    g.moveTo(x0 + o, y1 - L + o); g.lineTo(x0 + o, y1 + o); g.lineTo(x0 + L + o, y1 + o);
    g.moveTo(x1 - L + o, y1 + o); g.lineTo(x1 + o, y1 + o); g.lineTo(x1 + o, y1 - L + o);
    g.stroke();
  };
  path(1);
  g.strokeStyle = color;
  path(0);
  g.restore();
}

/** Grafik-Schlüssel eines Dorfgrundstücks: plot.<art><variante>.<straßenseite> */
function plotKey(p: Plot) {
  const k = `plot.${p.kind}${p.variant}.${p.face}`;
  if (assets.has(k)) return k;
  // fehlende Grafik: andere Variante derselben Art, sonst ein Wohnhaus gleicher Ausrichtung
  const k0 = `plot.${p.kind}0.${p.face}`;
  return assets.has(k0) ? k0 : `plot.haus0.${p.face}`;
}

/** Bildfolgen beweglicher Teile (Mühlrad, Flügel, Kran, Förderrad …) über dem Grundbild */
function drawAnims(g: CanvasRenderingContext2D, base: string, sx: number, sy: number, now: number, seed: number) {
  for (let k = 0; k < 3; k++) {
    const key = `${base}.anim${k}`;
    if (!assets.has(key)) return;
    const m = assets.meta(key), n = m.frames ?? 1;
    assets.sprite(g, key, sx, sy, { frame: Math.floor(now * (m.fps ?? 6) + seed) % n });
  }
}

/** wehende Fahne an einer Mastspitze (px, py) */
function drawFlag(g: CanvasRenderingContext2D, px: number, py: number, color: string, seed: number, size = 1) {
  const t = performance.now() / 260 + seed;
  g.fillStyle = color;
  g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(px, py);
  for (let k = 1; k <= 6; k++) g.lineTo(px + k * 2.2 * size, py + Math.sin(t + k * 0.9) * 1.2 * size * (k / 6));
  for (let k = 6; k >= 0; k--) g.lineTo(px + k * 2.2 * size, py + 7 * size + Math.sin(t + k * 0.9) * 1.2 * size * (k / 6));
  g.closePath(); g.fill(); g.stroke();
}
