// Boden der Detailkarte: pixelgenaue Mischung der Gelände-Texturen mit natürlichen Übergängen,
// großflächiger Farbvariation, Wassertiefe und Uferschaum, Kleinteilen (Gras, Blumen, Steine, Büsche),
// dazu zwei Ebenen für Abnutzung: Matsch (aus der Simulation) und Fahrspuren (live gezeichnet).
import { assets } from '../assets';
import type { Landscape } from './landscape';
import { T_FELS, T_GRAS, T_SAND, T_WALD, T_WASSER, type ProvinceMap } from '../sim/types';
import { stageOf, type DamageKind, type Stage } from '../sim/damage';

const GROUND_KEYS = ['terrain.gras', 'terrain.waldboden', 'terrain.wasser', 'terrain.felsboden', 'terrain.sand'];
const DEPOSIT_SPRITES = ['', 'deposit.kohle', 'deposit.eisen', 'deposit.gold'];
const TYPES = 5;

// ---------- Rauschen (deterministisch, kachelbar) ----------
const NS = 256;
const NOISE = (() => {
  const a = new Float32Array(NS * NS);
  let s = 1234567;
  for (let i = 0; i < a.length; i++) { s = (s * 16807) % 2147483647; a[i] = s / 2147483647; }
  return a;
})();
function noise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const x0 = xi & (NS - 1), y0 = yi & (NS - 1), x1 = (x0 + 1) & (NS - 1), y1 = (y0 + 1) & (NS - 1);
  const a = NOISE[y0 * NS + x0], b = NOISE[y0 * NS + x1], c = NOISE[y1 * NS + x0], d = NOISE[y1 * NS + x1];
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** bilineare Interpolation eines Kachelecken-Rasters */
function lerp2(a: Float32Array, ci: number, fx: number, fy: number, W: number) {
  return (a[ci] * (1 - fx) + a[ci + 1] * fx) * (1 - fy) + (a[ci + W + 1] * (1 - fx) + a[ci + W + 2] * fx) * fy;
}
const EDGE = 0.06; // Überlapp der Abschnitte in Kacheln (ca. 2 Pixel)
const hash = (x: number, y: number, k = 0) => (((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) / 4294967296;

/** Bodentextur: entweder Raute je Kachel (SVG-Platzhalter) oder gerenderte, nahtlose Draufsicht über `tiles`×`tiles` Kacheln */
interface Tex { data: Uint8ClampedArray; w: number; h: number; tiles: number; avg: string }
const EXTRA_KEYS = { erde: 'terrain.erde', acker: 'terrain.acker', saat: 'terrain.saat', weizen: 'terrain.weizen', pflaster: 'terrain.pflaster' } as const;

function loadTex(key: string): Tex | null {
  const img = assets.get(key);
  if (!img) return null;
  const g = img.canvas.getContext('2d')!;
  const data = g.getImageData(0, 0, img.canvas.width, img.canvas.height).data;
  let r = 0, gg = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 4 * 97) { if (data[i + 3] > 200) { r += data[i]; gg += data[i + 1]; b += data[i + 2]; n++; } }
  n ||= 1;
  return { data, w: img.canvas.width, h: img.canvas.height, tiles: assets.meta(key).tiles ?? 0, avg: `rgb(${(r / n) | 0},${(gg / n) | 0},${(b / n) | 0})` };
}

/** Farbe an Kachelposition (tx, ty); u, v = Lage in der Kachel für Rauten-Texturen */
function sampleTex(T: Tex, tx: number, ty: number, u: number, v: number, out: number[]) {
  let o: number;
  if (T.tiles) {
    const fx = tx / T.tiles, fy = ty / T.tiles;
    o = ((((fy - Math.floor(fy)) * T.h) | 0) * T.w + (((fx - Math.floor(fx)) * T.w) | 0)) * 4;
  } else {
    o = (((((u + v) * 0.5 * T.h) | 0) * T.w + (((0.5 + (u - v) * 0.5) * T.w) | 0)) * 4);
  }
  out[0] = T.data[o]; out[1] = T.data[o + 1]; out[2] = T.data[o + 2];
}
const SMP = [0, 0, 0];
/** Zaunstück um einen Acker mit eigenem Überrollschaden */
interface FenceSeg { ax: number; ay: number; bx: number; by: number; tile: number; res: number; stage: Stage; startPost: boolean; endPost: boolean; seed: number }
/** Ein Objekt hat seine Schadensstufe gewechselt (für Staub und Ton) */
export interface CrushEvent { x: number; y: number; kind: DamageKind; stage: Stage }
interface Job { key: string; cx: number; cy: number; left: number; top: number; width: number; height: number; canvas: HTMLCanvasElement; img: ImageData; row: number }
export interface Layer { canvas: HTMLCanvasElement; x: number; y: number; scale?: number }

export class TerrainPainter {
  private tex: (Tex | null)[] = [];
  private extra: Record<keyof typeof EXTRA_KEYS, Tex | null>;
  private photo: boolean; // gerenderte Bodentexturen: keine gezeichneten Grasbüschel
  /** Objekte, deren Schatten in den Boden eingebacken wird (Bäume) */
  private shadowProps: { tx: number; ty: number; key: string; scale?: number; stage?: number }[] = [];
  private waterDist: Float32Array;
  private chunks = new Map<string, Layer>();
  private quick = new Map<string, Layer>();
  private jobs = new Map<string, Job>();
  private queue: string[] = [];
  private wts = new Float32Array(TYPES);
  private wetGrid: Float32Array;   // Nähe zum Wasser je Kachelecke (nasser Sand)
  private depthGrid: Float32Array; // Wassertiefe je Kachelecke
  private macroGrid: Float32Array; // großflächige Helligkeit je Kachelecke
  private dryGrid: Float32Array;   // trockene Wiesenflächen je Kachelecke
  private mud = new Map<string, Layer & { sum: number }>();
  private pave = new Map<string, Layer & { sum: number }>();
  /** Kacheln der Dorfstraßen (1) und ihre Schadensstufe; Straßenkacheln je Abschnitt */
  private street: Uint8Array;
  private streetStage: Uint8Array;
  private streetByChunk = new Map<string, number[]>();
  private fenceSegs: FenceSeg[] = [];
  private fenceByTile = new Map<number, FenceSeg[]>();
  /** Abschnitte, deren Boden (Schatten gefällter Bäume, Zäune) neu eingebacken werden muss: frühester Beginn */
  private dirty = new Map<string, number>();
  private tracks = new Map<string, Layer>();
  private lastStamp = new Map<number, [number, number]>();

  constructor(private map: ProvinceMap, private HW: number, private HH: number, private chunkSize: number, private land: Landscape) {
    this.tex = GROUND_KEYS.map(loadTex);
    this.extra = { erde: loadTex(EXTRA_KEYS.erde), acker: loadTex(EXTRA_KEYS.acker), saat: loadTex(EXTRA_KEYS.saat), weizen: loadTex(EXTRA_KEYS.weizen), pflaster: loadTex(EXTRA_KEYS.pflaster) };
    this.photo = !!this.tex[T_GRAS]?.tiles;
    // Entfernung jeder Wasserkachel zum nächsten Land (für Wassertiefe)
    const { w, h, terrain } = map;
    this.waterDist = new Float32Array(w * h);
    const q: number[] = [];
    for (let i = 0; i < w * h; i++) {
      if (terrain[i] === T_WASSER) this.waterDist[i] = 99; else { this.waterDist[i] = 0; q.push(i); }
    }
    for (let k = 0; k < q.length; k++) {
      const i = q[k], x = i % w, y = (i / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (this.waterDist[n] > this.waterDist[i] + 1) { this.waterDist[n] = this.waterDist[i] + 1; q.push(n); }
      }
    }
    const wetAt = (x: number, y: number) => {
      let n = 0;
      for (let dy = -2; dy <= 1; dy++) for (let dx = -2; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && terrain[yy * w + xx] === T_WASSER) n++;
      }
      return Math.min(1, n / 5);
    };
    const corners = (f: (x: number, y: number) => number) => {
      const a = new Float32Array((w + 1) * (h + 2));
      for (let y = 0; y <= h; y++) for (let x = 0; x <= w; x++) a[y * (w + 1) + x] = f(x, y);
      return a;
    };
    const depthAt = (x: number, y: number) => {
      let s = 0, n = 0;
      for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h) { s += Math.min(8, this.waterDist[yy * w + xx]); n++; }
      }
      return n ? s / n : 0;
    };
    // Dorfstraßen-Kacheln und Zaunstücke für die Überrollschäden
    const crush = map.crush;
    this.street = new Uint8Array(w * h);
    this.streetStage = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ri = this.land.roadInfo(x + 0.5, y + 0.5);
      if (ri.kind !== 'dorf' || ri.d > ri.hw * 0.6) continue;
      const i = y * w + x;
      this.street[i] = 1;
      this.streetStage[i] = stageOf('strasse', crush?.[i] ?? 0);
      const [cx, cy] = this.chunkOf(x, y), key = `${cx},${cy}`;
      let list = this.streetByChunk.get(key);
      if (!list) this.streetByChunk.set(key, list = []);
      list.push(i);
    }
    for (const f of this.land.fields) {
      const corners: [number, number][] = [[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h]];
      const gateSide = Math.floor(hash(f.x, f.y, 41) * 4);
      for (let sd = 0; sd < 4; sd++) {
        const [ax, ay] = corners[sd], [bx, by] = corners[(sd + 1) % 4];
        const L = Math.hypot(bx - ax, by - ay), n = Math.round(L * 2);
        const gate = sd === gateSide ? Math.floor(n / 2) : -1;
        for (let k = 0; k < n; k++) {
          if (k === gate) continue;
          const t0 = k / n, t1 = (k + 1) / n;
          const seg: FenceSeg = {
            ax: ax + (bx - ax) * t0, ay: ay + (by - ay) * t0, bx: ax + (bx - ax) * t1, by: ay + (by - ay) * t1, tile: 0,
            res: 0.8 + hash(f.x * 7 + sd, f.y * 5 + k, 61) * 0.8, stage: 0, startPost: true, endPost: k === n - 1 || k + 1 === gate, seed: sd * 100 + k,
          };
          const mx = Math.min(w - 1, Math.max(0, Math.floor((seg.ax + seg.bx) / 2))), my = Math.min(h - 1, Math.max(0, Math.floor((seg.ay + seg.by) / 2)));
          seg.tile = my * w + mx;
          seg.stage = stageOf('zaun', crush?.[seg.tile] ?? 0, seg.res);
          this.fenceSegs.push(seg);
          let l = this.fenceByTile.get(seg.tile);
          if (!l) this.fenceByTile.set(seg.tile, l = []);
          l.push(seg);
        }
      }
    }
    this.depthGrid = corners(depthAt);
    this.wetGrid = corners(wetAt);
    this.macroGrid = corners((x, y) => noise(x * 0.13 + 100, y * 0.13));
    this.dryGrid = corners((x, y) => smooth(0.55, 0.85, noise(x * 0.07 + 50, y * 0.07 + 9)));
  }

  private iso(tx: number, ty: number): [number, number] { return [(tx - ty + this.map.h) * this.HW, (tx + ty) * this.HH]; }
  private bounds(cx: number, cy: number) {
    const C = this.chunkSize, map = this.map;
    const x1 = Math.min(cx + C, map.w), y1 = Math.min(cy + C, map.h);
    const left = Math.floor(this.iso(cx, y1)[0]) - 2, top = Math.floor(this.iso(cx, cy)[1]) - 2;
    const width = Math.ceil(this.iso(x1, cy)[0] - left) + 4, height = Math.ceil(this.iso(x1, y1)[1] - top) + 4;
    return { left, top, width, height };
  }
  private chunkOf(tx: number, ty: number) {
    const C = this.chunkSize;
    return [Math.floor(tx / C) * C, Math.floor(ty / C) * C] as const;
  }

  // ---------- Boden ----------
  /**
   * Fertiger Bodenabschnitt. sync = sofort vollständig berechnen (beim Öffnen der Provinz);
   * sonst wird er in Zeitscheiben im Hintergrund gebaut (pump) und bis dahin null geliefert.
   */
  ground(cx: number, cy: number, sync: boolean): Layer | null {
    const key = `${cx},${cy}`;
    const hit = this.chunks.get(key);
    this.lastUse.set(key, ++this.useTick);
    if (hit) return hit;
    const job = this.job(cx, cy);
    if (sync) { this.work(job, Infinity); return this.chunks.get(key)!; }
    // sichtbare Abschnitte zuerst
    this.queue = [key, ...this.queue.filter((k) => k !== key)];
    return null;
  }
  /** Alle übrigen Abschnitte für später vormerken */
  prewarm() {
    // Große Karten haben viele Abschnitte: gebaut wird nur, was im Bild war (mit Zwischenspeicher begrenzter Größe)
    if (this.map.w * this.map.h > 100 * 100) return;
    for (let cy = 0; cy < this.map.h; cy += this.chunkSize) for (let cx = 0; cx < this.map.w; cx += this.chunkSize) {
      const key = `${cx},${cy}`;
      if (!this.chunks.has(key) && !this.queue.includes(key)) { this.job(cx, cy); this.queue.push(key); }
    }
  }
  /** Abschnitt neben dem Bild vormerken (nur wenn gerade nichts anderes gebaut wird), damit Scrollen nicht ins Leere läuft */
  want(cx: number, cy: number) {
    const key = `${cx},${cy}`;
    this.lastUse.set(key, ++this.useTick);
    if (this.queue.length || this.chunks.has(key)) return;
    this.job(cx, cy); this.queue.push(key);
  }
  private lastUse = new Map<string, number>();
  private useTick = 0;
  /** Zwischenspeicher begrenzen: lange nicht gesehene Abschnitte verwerfen (werden bei Bedarf neu gebaut) */
  private evict() {
    const MAX = 64;
    if (this.chunks.size <= MAX) return;
    const old = [...this.chunks.keys()].filter((k) => !this.jobs.has(k) && this.useTick - (this.lastUse.get(k) ?? 0) > 400)
      .sort((a, b) => (this.lastUse.get(a) ?? 0) - (this.lastUse.get(b) ?? 0));
    for (const k of old.slice(0, this.chunks.size - MAX)) {
      const c = this.chunks.get(k); if (c) { c.canvas.width = 0; c.canvas.height = 0; }
      this.chunks.delete(k); this.lastUse.delete(k); this.quick.delete(k);
    }
  }
  /** Im Hintergrund weiterbauen, höchstens budgetMs Millisekunden */
  pump(budgetMs: number) {
    const end = performance.now() + budgetMs;
    this.evict();
    // geänderte Abschnitte (gefällte Bäume, zerstörte Zäune) nach kurzer Pause im Hintergrund neu einbacken; bis dahin bleibt der alte stehen
    for (const [key, at] of this.dirty) {
      if (end < at || this.jobs.has(key)) continue;
      this.dirty.delete(key);
      const [cx, cy] = key.split(',').map(Number);
      this.job(cx, cy);
      this.queue.push(key);
    }
    while (this.queue.length && performance.now() < end) {
      const job = this.jobs.get(this.queue[0])!;
      if (this.work(job, end)) this.queue.shift();
    }
  }
  /** Schneller Ersatz aus einfachen Kacheln, solange der richtige Abschnitt noch entsteht */
  fallback(cx: number, cy: number): Layer {
    const key = `${cx},${cy}`;
    let l = this.quick.get(key);
    if (l) return l;
    const { left, top, width, height } = this.bounds(cx, cy);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const g = canvas.getContext('2d')!;
    g.translate(-left, -top);
    const W = this.map.w, x1 = Math.min(cx + this.chunkSize, W), y1 = Math.min(cy + this.chunkSize, this.map.h);
    for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) {
      const [sx, sy] = this.iso(x, y);
      const T = this.tex[this.map.terrain[y * W + x]];
      if (T?.tiles) {
        // gerenderte Textur: vorläufig nur die Durchschnittsfarbe als Raute
        g.fillStyle = T.avg;
        g.beginPath(); g.moveTo(sx, sy - 0.5); g.lineTo(sx + this.HW + 0.7, sy + this.HH); g.lineTo(sx, sy + 2 * this.HH + 0.5); g.lineTo(sx - this.HW - 0.7, sy + this.HH); g.fill();
      } else assets.tile(g, GROUND_KEYS[this.map.terrain[y * W + x]], sx, sy);
    }
    l = { canvas, x: left, y: top };
    this.quick.set(key, l);
    return l;
  }

  private job(cx: number, cy: number): Job {
    const key = `${cx},${cy}`;
    let j = this.jobs.get(key);
    if (j) return j;
    const { left, top, width, height } = this.bounds(cx, cy);
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    j = { key, cx, cy, left, top, width, height, canvas, img: canvas.getContext('2d')!.createImageData(width, height), row: 0 };
    this.jobs.set(key, j);
    return j;
  }

  /** Zeilen eines Abschnitts berechnen; true, wenn fertig */
  private work(j: Job, end: number): boolean {
    const map = this.map, W = map.w, H = map.h, HW = this.HW, HH = this.HH, C = this.chunkSize;
    const out = j.img.data, wts = this.wts, tex = this.tex;
    const { left, top, width, height, cx, cy } = j;
    while (j.row < height) {
      const py = j.row++;
      const wy = top + py + 0.5;
      for (let px = 0; px < width; px++) {
        const wx = left + px + 0.5 - H * HW;
        const tx = (wx / HW + wy / HH) / 2, ty = (wy / HH - wx / HW) / 2;
        // Jedes Pixel gehört einem Abschnitt; ein schmaler Überlapp verhindert Fugen beim Skalieren
        if (tx < cx - EDGE || ty < cy - EDGE || tx >= cx + C + EDGE || ty >= cy + C + EDGE || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const ti = Math.floor(tx), tj = Math.floor(ty);
        // Gelände-Gewichte mit verwirbelten (natürlichen) Grenzen
        const qx = tx + (noise(tx * 1.1, ty * 1.1) - 0.5) * 0.9 + (noise(tx * 3.3 + 17, ty * 3.3) - 0.5) * 0.35 - 0.5;
        const qy = ty + (noise(tx * 1.1 + 37, ty * 1.1 + 11) - 0.5) * 0.9 + (noise(tx * 3.3, ty * 3.3 + 29) - 0.5) * 0.35 - 0.5;
        const i0 = qx < 0 ? 0 : qx >= W - 1 ? W - 1 : Math.floor(qx), j0 = qy < 0 ? 0 : qy >= H - 1 ? H - 1 : Math.floor(qy);
        const i1 = i0 + 1 < W ? i0 + 1 : i0, j1 = j0 + 1 < H ? j0 + 1 : j0;
        const fx = Math.max(0, Math.min(1, qx - i0)), fy = Math.max(0, Math.min(1, qy - j0));
        wts[0] = wts[1] = wts[2] = wts[3] = wts[4] = 0;
        wts[map.terrain[j0 * W + i0]] += (1 - fx) * (1 - fy);
        wts[map.terrain[j0 * W + i1]] += fx * (1 - fy);
        wts[map.terrain[j1 * W + i0]] += (1 - fx) * fy;
        wts[map.terrain[j1 * W + i1]] += fx * fy;
        let sum = 0;
        for (let t = 0; t < TYPES; t++) { const v = wts[t] * wts[t] * (0.4 + wts[t]); wts[t] = v; sum += v; }
        // Texturkoordinaten im Inneren der Rauten-Textur (Ränder sind kantengeglättet und würden Fugen zeigen)
        const u = 0.1 + (tx - ti) * 0.8, v = 0.1 + (ty - tj) * 0.8;
        // großflächige Werte je Kachelecke vorberechnet, hier nur interpoliert
        const ci = Math.min(H - 1, tj) * (W + 1) + Math.min(W - 1, ti), ffx = tx - ti, ffy = ty - tj;
        let r = 0, gg = 0, b = 0;
        for (let t = 0; t < TYPES; t++) {
          if (wts[t] < 0.002) continue;
          const wt = wts[t] / sum;
          const T = tex[t];
          let cr = 120, cg = 120, cb = 120;
          if (T) { sampleTex(T, tx, ty, u, v, SMP); cr = SMP[0]; cg = SMP[1]; cb = SMP[2]; }
          if (t === T_WASSER) {
            // Tiefes Wasser dunkler, flaches Wasser heller und grünlicher
            const deep = Math.min(1, lerp2(this.depthGrid, ci, ffx, ffy, W) / 6);
            cr = cr * (1.15 - deep * 0.5) + 20 * (1 - deep); cg = cg * (1.12 - deep * 0.4) + 30 * (1 - deep); cb = cb * (1.05 - deep * 0.25);
            const sparkle = noise(tx * 6 + 3, ty * 3);
            if (sparkle > 0.78) { const k = (sparkle - 0.78) * 2.5; cr += 60 * k; cg += 70 * k; cb += 70 * k; }
          } else if (t === T_GRAS || t === T_WALD) {
            // große Flächen: saftig / trocken / dunkle Senken
            const bright = 0.86 + lerp2(this.macroGrid, ci, ffx, ffy, W) * 0.26;
            const dry = lerp2(this.dryGrid, ci, ffx, ffy, W);
            cr = (cr * (1 - dry) + (cr * 1.14 + 12) * dry) * bright;
            cg = (cg * (1 - dry) + cg * 0.97 * dry) * bright;
            cb = (cb * (1 - dry) + cb * 0.78 * dry) * bright;
          } else if (t === T_SAND) {
            const wet = 1 - lerp2(this.wetGrid, ci, ffx, ffy, W) * 0.2; // nasser Sand am Wasser, weich verlaufend
            cr *= wet; cg *= wet; cb *= wet;
          }
          r += cr * wt; gg += cg * wt; b += cb * wt;
        }
        // Uferschaum am Übergang Wasser/Land
        const ww = wts[T_WASSER] / sum;
        if (ww > 0.2 && ww < 0.7) {
          const foam = (1 - Math.abs(ww - 0.45) / 0.25) * smooth(0.45, 0.75, noise(tx * 5, ty * 5 + 7));
          r += (235 - r) * foam * 0.7; gg += (240 - gg) * foam * 0.7; b += (235 - b) * foam * 0.7;
        }
        const grain = 0.95 + NOISE[(px * 7 + py * 131) & (NS * NS - 1)] * 0.1;
        // Äcker (Weizen, junge Saat, gepflügt) mit Furchen
        const land = this.land;
        if (ww < 0.3) {
          const f = land.fieldAt(tx, ty);
          if (f) {
            const fu = tx - f.x, fv = ty - f.y;
            const edge = Math.min(fu, fv, f.w - fu, f.h - fv) + (noise(tx * 4, ty * 4) - 0.5) * 0.06;
            const along = f.rows === 'x' ? fv : fu;
            const furrow = 0.5 + 0.5 * Math.sin(along * Math.PI * 2 * 3.5);
            const speck = NOISE[(px * 13 + py * 57) & (NS * NS - 1)];
            let fr: number, fg: number, fb: number;
            const FT = f.kind === 'weizen' ? this.extra.weizen : f.kind === 'gruen' ? this.extra.saat : this.extra.acker;
            if (FT) {
              sampleTex(FT, tx, ty, 0, 0, SMP);
              const k = 1 - furrow * 0.28;
              fr = SMP[0] * k; fg = SMP[1] * k; fb = SMP[2] * k;
            } else if (f.kind === 'weizen') { fr = 206 - furrow * 34 + speck * 26; fg = 168 - furrow * 32 + speck * 20; fb = 88 - furrow * 18 + speck * 6; }
            else if (f.kind === 'gruen') { fr = 112 - furrow * 30 + speck * 12; fg = 132 - furrow * 30 + speck * 14; fb = 64 - furrow * 16; }
            else { fr = 118 - furrow * 34 + speck * 10; fg = 90 - furrow * 28 + speck * 8; fb = 62 - furrow * 18 + speck * 6; }
            const fa = smooth(0.02, 0.14, edge);
            r += (fr - r) * fa; gg += (fg - gg) * fa; b += (fb - b) * fa;
          }
          // Wege in echten Breiten: gepflasterte Dorfstraße, Schotter-Landstraße, Feldweg mit Fahrrinnen und Grasnarbe
          const ri = land.roadInfo(tx, ty);
          const d = ri.d + (noise(tx * 2.3 + 5, ty * 2.3) - 0.5) * (ri.kind === 'dorf' ? 0.03 : 0.08);
          const hw = ri.hw;
          if (d < hw + 0.25) {
            const ra = smooth(hw + (ri.kind === 'dorf' ? 0.03 : 0.08), hw - 0.05, d) * (1 - ww / 0.3);
            const dn = 0.88 + noise(tx * 6, ty * 6 + 3) * 0.24;
            let dr = 146 * dn, dg = 118 * dn, db = 84 * dn;
            if (ri.kind === 'dorf') {
              if (this.extra.pflaster) { sampleTex(this.extra.pflaster, tx, ty, 0, 0, SMP); dr = SMP[0]; dg = SMP[1]; db = SMP[2]; }
              else { dr = 110 * dn; dg = 104 * dn; db = 94 * dn; }
              // Rinnstein am Rand
              const gut = smooth(0.06, 0, Math.abs(d - hw + 0.06));
              dr *= 1 - gut * 0.35; dg *= 1 - gut * 0.35; db *= 1 - gut * 0.35;
            } else {
              if (this.extra.erde) { sampleTex(this.extra.erde, tx, ty, 0, 0, SMP); dr = SMP[0] * 1.08; dg = SMP[1] * 1.08; db = SMP[2] * 1.08; }
              if (ri.kind === 'strasse') {
                // Schotter: heller und grauer, flache Spurrillen (Spurweite ~1,6 m)
                const l = (dr + dg + db) / 3;
                dr = (dr * 0.6 + l * 0.4) * 1.12; dg = (dg * 0.6 + l * 0.4) * 1.12; db = (db * 0.6 + l * 0.4) * 1.12;
                const rut = smooth(0.06, 0, Math.abs(d - 0.15)) * 0.14;
                dr *= 1 - rut; dg *= 1 - rut; db *= 1 - rut;
              } else {
                const rut = smooth(0.06, 0, Math.abs(d - 0.14));
                dr *= 1 - rut * 0.26; dg *= 1 - rut * 0.28; db *= 1 - rut * 0.3;
                const mid = smooth(0.06, 0.01, d) * 0.4;
                dr += (r - dr) * mid; dg += (gg - dg) * mid; db += (b - db) * mid;
              }
            }
            // ausgetretener Rand
            const rim = smooth(0.12, 0, Math.abs(d - hw - 0.03)) * 0.12 * (1 - ra);
            r = (r + (dr - r) * ra) * (1 - rim); gg = (gg + (dg - gg) * ra) * (1 - rim); b = (b + (db - b) * ra) * (1 - rim);
          }
        }
        // Farbgebung: etwas entsättigt und warm (wie ein sonniger Spätsommertag)
        const lum = r * 0.3 + gg * 0.59 + b * 0.11;
        const sat = this.photo ? 0.95 : 0.8;
        r = lum + (r - lum) * sat + 7; gg = lum + (gg - lum) * sat + 2; b = lum + (b - lum) * sat - 7;
        const o = (py * width + px) * 4;
        out[o] = r * grain; out[o + 1] = gg * grain; out[o + 2] = b * grain; out[o + 3] = 255;
      }
      if ((py & 7) === 7 && performance.now() > end) return false;
    }
    // fertig: Bild übernehmen, Vorkommen und Kleinteile darüber
    const g = j.canvas.getContext('2d')!;
    g.putImageData(j.img, 0, 0);
    g.translate(-left, -top);
    const x1 = Math.min(cx + C, W), y1 = Math.min(cy + C, H);
    for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) {
      const i = y * W + x;
      const [sx, sy] = this.iso(x, y);
      if (map.deposit[i]) assets.tile(g, DEPOSIT_SPRITES[map.deposit[i]], sx, sy);
      else this.decor(g, x, y, map.terrain[i]);
    }
    this.fences(g);
    // Schatten der Bäume (fällt nach rechts unten, daher auch Objekte links/oberhalb des Abschnitts)
    g.globalCompositeOperation = 'source-atop';
    for (const p of this.shadowProps) {
      if (p.tx < cx - 4 || p.ty < cy - 4 || p.tx > x1 + 1 || p.ty > y1 + 1) continue;
      if ((p.stage ?? 0) >= 2) continue; // umgeknickte Bäume werfen keinen Schatten mehr
      const [sx, sy] = this.iso(p.tx, p.ty);
      const sc = p.scale ?? 1;
      g.save(); g.translate(sx, sy); g.scale(sc, sc);
      assets.sprite(g, `${p.key}_schatten`, 0, 0);
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    this.chunks.set(j.key, { canvas: j.canvas, x: left, y: top });
    this.jobs.delete(j.key);
    this.quick.delete(j.key);
    return true;
  }

  /** Kleinteile: zufällig, aber für jede Kachel immer gleich */
  private decor(g: CanvasRenderingContext2D, x: number, y: number, t: number) {
    const place = (key: string, k: number) => {
      const px = x + 0.15 + hash(x, y, k + 7) * 0.7, py = y + 0.15 + hash(x, y, k + 13) * 0.7;
      if (this.land.roadDist(px, py) < 0.5 || this.land.fieldAt(px, py) || this.land.isPlot(px, py)) return; // nicht auf Wegen, Äckern, Grundstücken
      const [sx, sy] = this.iso(px, py);
      assets.sprite(g, key, sx, sy);
    };
    if (this.photo) return; // gerenderter Boden enthält seine Kleinteile schon
    const r1 = hash(x, y, 1), r2 = hash(x, y, 2);
    if (t === T_GRAS) {
      const dry = noise(x * 0.07 + 50, y * 0.07 + 9) > 0.62;
      if (r1 < 0.5) place(dry ? 'decor.trockengras' : 'decor.gras', 1);
      if (r2 < 0.14) place(dry ? 'decor.trockengras' : 'decor.gras', 2);
      // ungemähte Grasbüschel auf offenen Wiesen, Erdflecken in der Nähe von Wegen (festgetretener Boden)
      if (hash(x, y, 5) < 0.12 && !dry) place('decor.grasbueschel', 5);
      if (this.land.roadDist(x + 0.5, y + 0.5) < 2.5 && hash(x, y, 6) < 0.22) place('decor.erdfleck', 6);
      if (r2 > 0.93 && !dry) place('decor.blumen', 3);
      else if (r2 > 0.9) place('decor.steine', 3);
      if (hash(x, y, 4) < 0.05) place('decor.busch', 4);
      if (hash(x, y, 8) < 0.012) place('decor.strauch', 8);
    } else if (t === T_WALD) {
      if (r1 < 0.5) place('decor.farn', 1);
      if (r2 < 0.25) place('decor.busch', 2);
      if (hash(x, y, 9) < 0.05) place('decor.strauch', 9);
    } else if (t === T_SAND) {
      if (r1 < 0.12) place('decor.steine', 1);
      if (r2 < 0.15) place('decor.trockengras', 2);
    } else if (t === T_FELS) {
      if (r1 < 0.4) place('decor.steine', 1);
    }
  }

  /** Objekte mit eigenem Schattenbild (Schlüssel + _schatten) für die Bodenabschnitte vormerken */
  setShadowProps(list: { tx: number; ty: number; key: string; scale?: number; stage?: number }[]) {
    this.shadowProps = list.filter((p) => assets.has(`${p.key}_schatten`));
  }

  /** Holzzäune um die Äcker, mit Lücke als Tor; je nach Überrollschaden heil, schief, nur noch Pfosten oder weg */
  private fences(g: CanvasRenderingContext2D) {
    for (const f of this.fenceSegs) {
      if (f.stage === 3) continue;
      const [x0, y0] = this.iso(f.ax, f.ay), [x1, y1] = this.iso(f.bx, f.by);
      const h = hash(f.tile, f.seed, 63);
      if (f.stage === 2) {
        // abgeknickte Pfosten und Latten im Gras
        g.strokeStyle = '#4a3823'; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (h - 0.5) * 3, y0 - 3 - h * 2); g.stroke();
        g.strokeStyle = '#7a6040'; g.lineWidth = 1.1;
        const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
        g.beginPath(); g.moveTo(mx - 3, my + 1); g.lineTo(mx + 4, my + 2 + h * 2); g.moveTo(mx - 1, my + 3); g.lineTo(mx + 5, my + 1); g.stroke();
        continue;
      }
      const lean = f.stage === 1 ? 2 + h * 2 : 0;
      // Schatten, Pfosten, zwei Latten
      g.strokeStyle = 'rgba(30,22,10,0.25)'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0 + 2, y0 + 1); g.lineTo(x1 + 2, y1 + 1); g.stroke();
      g.strokeStyle = '#4a3823'; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + lean, y0 - 8); g.stroke();
      if (f.endPost) { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 + lean, y1 - 8); g.stroke(); }
      g.strokeStyle = '#7a6040'; g.lineWidth = 1.1;
      g.beginPath();
      if (f.stage === 1) {
        // schief: obere Latte hängt oder fehlt, untere hängt durch
        g.moveTo(x0 + lean * 0.4, y0 - 3); g.lineTo(x1 + lean * 0.4, y1 - 1);
        if (h < 0.5) { g.moveTo(x0 + lean * 0.9, y0 - 6.5); g.lineTo((x0 + x1) / 2 + lean * 0.5, (y0 + y1) / 2 - 3); }
      } else {
        g.moveTo(x0, y0 - 3); g.lineTo(x1, y1 - 3); g.moveTo(x0, y0 - 6.5); g.lineTo(x1, y1 - 6.5);
      }
      g.stroke();
    }
  }

  // ---------- Überrollschäden ----------
  /** Abschnitt (mit Kachel tx, ty) später neu einbacken */
  invalidate(tx: number, ty: number) {
    const [cx, cy] = this.chunkOf(Math.floor(tx), Math.floor(ty)), key = `${cx},${cy}`;
    if (!this.chunks.has(key)) return; // wird noch gebaut und berücksichtigt den aktuellen Stand ohnehin
    if (!this.dirty.has(key)) this.dirty.set(key, performance.now() + 1500);
  }

  /** Überrollschaden einer Kachel hat sich geändert: Dorfstraße und Zäune prüfen, Stufenwechsel melden */
  crushChanged(i: number, crush: number): CrushEvent[] {
    const out: CrushEvent[] = [];
    const W = this.map.w;
    if (this.street[i]) {
      const st = stageOf('strasse', crush);
      if (st !== this.streetStage[i]) {
        if (st > this.streetStage[i]) out.push({ x: (i % W) + 0.5, y: Math.floor(i / W) + 0.5, kind: 'strasse', stage: st });
        this.streetStage[i] = st;
      }
    }
    const segs = this.fenceByTile.get(i);
    if (segs) for (const f of segs) {
      const st = stageOf('zaun', crush, f.res);
      if (st === f.stage) continue;
      if (st > f.stage) out.push({ x: (f.ax + f.bx) / 2, y: (f.ay + f.by) / 2, kind: 'zaun', stage: st });
      f.stage = st;
      this.invalidate(f.ax, f.ay);
    }
    return out;
  }

  /** Schadensebene der Dorfstraßen (Risse, Schlaglöcher, zerstörtes Pflaster); null, wenn nichts beschädigt ist */
  paveLayer(cx: number, cy: number, allowRebuild: boolean): Layer | null {
    const key = `${cx},${cy}`;
    const list = this.streetByChunk.get(key), crush = this.map.crush;
    if (!list || !crush) return null;
    let sum = 0;
    for (const i of list) sum += Math.min(crush[i], 30);
    const hit = this.pave.get(key);
    if (hit && Math.abs(hit.sum - sum) < 1.2) return hit;
    if (!allowRebuild) return hit ?? null;
    if (!hit && sum < 3) return null;
    const layer = this.paintPave(cx, cy, sum);
    this.pave.set(key, layer);
    return layer;
  }

  private paintPave(cx: number, cy: number, sum: number) {
    const { left, top, width, height } = this.bounds(cx, cy);
    const S = 2; // halbe Auflösung, wird weich hochskaliert
    const cw = Math.ceil(width / S), ch = Math.ceil(height / S);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(cw, ch);
    const out = img.data;
    const map = this.map, W = map.w, H = map.h, HW = this.HW, HH = this.HH, crush = map.crush!, street = this.street, C = this.chunkSize, e = EDGE * S;
    for (let py = 0; py < ch; py++) {
      const wy = top + (py + 0.5) * S;
      for (let px = 0; px < cw; px++) {
        const wx = left + (px + 0.5) * S - H * HW;
        const tx = (wx / HW + wy / HH) / 2, ty = (wy / HH - wx / HW) / 2;
        if (tx < cx - e || ty < cy - e || tx >= cx + C + e || ty >= cy + C + e || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        // Überrollschaden: gewichtetes Mittel der Straßenkacheln ringsum (Nicht-Straße zählt nicht mit)
        const gx = tx - 0.5, gy = ty - 0.5, i0 = Math.floor(gx), j0 = Math.floor(gy), fx = gx - i0, fy = gy - j0;
        let num = 0, den = 0;
        for (let k = 0; k < 4; k++) {
          const xx = i0 + (k & 1), yy = j0 + (k >> 1);
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const idx = yy * W + xx;
          if (!street[idx]) continue;
          const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy);
          num += wt * crush[idx]; den += wt;
        }
        if (den < 0.15) continue;
        const v = num / den;
        if (v < 2.5) continue;
        const ri = this.land.roadInfo(tx, ty);
        if (ri.kind !== 'dorf') continue;
        const d = ri.d + (noise(tx * 2.3 + 5, ty * 2.3) - 0.5) * 0.03;
        const ra = smooth(ri.hw + 0.03, ri.hw - 0.05, d);
        if (ra < 0.04) continue;
        const vv = v + (noise(tx * 3.1 + 7, ty * 3.1) - 0.5) * 6; // der Schaden ist ungleichmäßig verteilt
        let ER = 96, EG = 74, EB = 52;
        if (this.extra.erde) { sampleTex(this.extra.erde, tx, ty, 0, 0, SMP); ER = SMP[0] * 0.85; EG = SMP[1] * 0.85; EB = SMP[2] * 0.85; }
        let r = 0, gg = 0, b = 0, a = 0;
        const over = (cr: number, cg: number, cb: number, ca: number) => {
          if (ca <= 0.005) return;
          const na = ca + a * (1 - ca);
          r = (cr * ca + r * a * (1 - ca)) / na; gg = (cg * ca + gg * a * (1 - ca)) / na; b = (cb * ca + b * a * (1 - ca)) / na; a = na;
        };
        const [L1, L2, L3] = [4, 10, 18];
        // Stufe 1: ausgebrochene Pflastersteine und Risse
        over(ER * 0.7, EG * 0.7, EB * 0.7, 0.8 * smooth(0.8, 0.86, noise(tx * 15 + 2, ty * 15 + 6)) * smooth(L1, L1 + 4, vv));
        over(26, 24, 22, 0.8 * smooth(0.9, 0.975, 1 - Math.abs(noise(tx * 4.6 + 9, ty * 4.6) * 2 - 1)) * smooth(L1 - 1, L1 + 2, vv));
        // Stufe 2: Schlaglöcher mit aufgeworfenem Rand und Pfützen
        const ph = noise(tx * 2.7 + 3, ty * 2.7 + 8), thr = 0.78 - smooth(L2 - 1, L3, vv) * 0.27, on2 = smooth(L2 - 1, L2 + 2, vv);
        const hole = smooth(thr, thr + 0.06, ph) * on2;
        over(150, 142, 128, 0.55 * smooth(thr - 0.06, thr, ph) * (1 - hole) * on2);
        over(ER * 0.62, EG * 0.62, EB * 0.62, 0.95 * hole);
        if (hole > 0.4 && noise(tx * 7 + 11, ty * 7) > 0.64) over(70, 78, 80, 0.9 * hole);
        // Stufe 3: Pflaster weitgehend weg, nasser Matsch mit einzelnen Steinen
        const gone = smooth(L3 - 3, L3 + 1, vv) * smooth(0.18, 0.34, noise(tx * 3.6 + 1, ty * 3.6 + 4) + smooth(L3, L3 + 8, vv) * 0.5);
        over(ER * 0.72, EG * 0.7, EB * 0.68, 0.94 * gone);
        if (noise(tx * 18 + 4, ty * 18 + 9) > 0.86) over(118, 112, 100, 0.75 * gone);
        if (a < 0.01) continue;
        const grain = 0.92 + noise(tx * 11, ty * 11) * 0.16;
        const o = (py * cw + px) * 4;
        out[o] = r * grain; out[o + 1] = gg * grain; out[o + 2] = b * grain; out[o + 3] = a * ra * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas, x: left, y: top, sum, scale: S };
  }

  // ---------- Matsch (aus der Bodenabnutzung der Simulation) ----------
  /** Matsch-Ebene eines Abschnitts; wird neu berechnet, wenn sich die Abnutzung merklich ändert */
  mudLayer(cx: number, cy: number, allowRebuild: boolean): Layer | null {
    const key = `${cx},${cy}`;
    const wear = this.map.wear;
    if (!wear) return null;
    let sum = 0;
    const W = this.map.w, x1 = Math.min(cx + this.chunkSize, W), y1 = Math.min(cy + this.chunkSize, this.map.h);
    for (let y = cy; y < y1; y++) for (let x = cx; x < x1; x++) sum += wear[y * W + x];
    const hit = this.mud.get(key);
    if (hit && Math.abs(hit.sum - sum) < 4) return hit;
    if (!allowRebuild) return hit ?? null;
    if (!hit && sum < 2) return null;
    const layer = this.paintMud(cx, cy, sum);
    this.mud.set(key, layer);
    return layer;
  }

  private paintMud(cx: number, cy: number, sum: number) {
    const { left, top, width, height } = this.bounds(cx, cy);
    const S = 2; // halbe Auflösung, wird weich hochskaliert
    const cw = Math.ceil(width / S), ch = Math.ceil(height / S);
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const g = canvas.getContext('2d')!;
    const img = g.createImageData(cw, ch);
    const out = img.data;
    const map = this.map, W = map.w, H = map.h, HW = this.HW, HH = this.HH, wear = map.wear!;
    const at = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return 0;
      const t = map.terrain[y * W + x];
      return t === T_WASSER || t === T_FELS ? 0 : wear[y * W + x];
    };
    for (let py = 0; py < ch; py++) {
      const wy = top + (py + 0.5) * S;
      for (let px = 0; px < cw; px++) {
        const wx = left + (px + 0.5) * S - H * HW;
        const tx = (wx / HW + wy / HH) / 2, ty = (wy / HH - wx / HW) / 2;
        // wie beim Boden: nur Pixel dieses Abschnitts (plus schmaler Überlapp), sonst doppelte Deckkraft an den Grenzen
        const C = this.chunkSize, e = EDGE * S;
        if (tx < cx - e || ty < cy - e || tx >= cx + C + e || ty >= cy + C + e || tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
        const qx = tx + (noise(tx * 2.1 + 5, ty * 2.1) - 0.5) * 0.6 - 0.5, qy = ty + (noise(tx * 2.1, ty * 2.1 + 9) - 0.5) * 0.6 - 0.5;
        const i0 = Math.floor(qx), j0 = Math.floor(qy), fx = qx - i0, fy = qy - j0;
        const w = at(i0, j0) * (1 - fx) * (1 - fy) + at(i0 + 1, j0) * fx * (1 - fy) + at(i0, j0 + 1) * (1 - fx) * fy + at(i0 + 1, j0 + 1) * fx * fy;
        const wv = w + (noise(tx * 4, ty * 4) - 0.5) * 14;
        if (wv < 6) continue;
        const trampled = smooth(6, 24, wv), dirt = smooth(22, 48, wv), mud = smooth(48, 72, wv);
        // plattgedrücktes Gras -> Erde -> nasser Matsch
        let r = 128, gg = 118, b = 66, a = 0.32 * trampled;
        r += (104 - r) * dirt; gg += (80 - gg) * dirt; b += (52 - b) * dirt; a += (0.82 - a) * dirt;
        r += (66 - r) * mud; gg += (50 - gg) * mud; b += (35 - b) * mud; a += (0.93 - a) * mud;
        const grain = 0.9 + noise(tx * 11, ty * 11) * 0.2;
        r *= grain; gg *= grain; b *= grain;
        // Pfützen im tiefen Matsch
        const pud = wv > 66 ? smooth(0.6, 0.68, noise(tx * 2.6 + 21, ty * 2.6 + 4)) : 0;
        if (pud > 0) {
          const hl = noise(tx * 8, ty * 8) > 0.7 ? 40 : 0;
          r += (84 + hl - r) * pud; gg += (90 + hl - gg) * pud; b += (88 + hl - b) * pud; a = Math.max(a, 0.9);
        }
        const o = (py * cw + px) * 4;
        out[o] = r; out[o + 1] = gg; out[o + 2] = b; out[o + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    return { canvas, x: left, y: top, sum, scale: S };
  }

  // ---------- Fahrspuren ----------
  trackLayer(cx: number, cy: number): Layer | null { return this.tracks.get(`${cx},${cy}`) ?? null; }

  /** Spurabdruck für ein fahrendes Fahrzeug setzen (Ketten: breite, Räder: schmale Doppelspur) */
  stamp(id: number, x: number, y: number, facing: number, kind: 'kette' | 'rad', gauge: number) {
    const last = this.lastStamp.get(id);
    if (last && Math.hypot(x - last[0], y - last[1]) < 0.13) return;
    this.lastStamp.set(id, [x, y]);
    if (!last || Math.hypot(x - last[0], y - last[1]) > 1) return; // nach Sprüngen (Neuerscheinen) neu ansetzen
    const map = this.map;
    const t = map.terrain[Math.floor(y) * map.w + Math.floor(x)];
    if (t === T_WASSER || t === T_FELS) return;
    const [cx, cy] = this.chunkOf(x, y);
    const key = `${cx},${cy}`;
    let layer = this.tracks.get(key);
    if (!layer) {
      const { left, top, width, height } = this.bounds(cx, cy);
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      layer = { canvas, x: left, y: top };
      this.tracks.set(key, layer);
    }
    const g = layer.canvas.getContext('2d')!;
    const dx = Math.cos(facing), dy = Math.sin(facing), nx = -dy, ny = dx;
    const len = 0.075, wid = kind === 'kette' ? 0.065 : 0.03;
    g.fillStyle = kind === 'kette' ? 'rgba(52,40,26,0.2)' : 'rgba(58,46,30,0.17)';
    for (const side of [-gauge, gauge]) {
      const ox = x + nx * side, oy = y + ny * side;
      const pts = [[-len, -wid], [len, -wid], [len, wid], [-len, wid]].map(([f, s]) => this.iso(ox + dx * f + nx * s, oy + dy * f + ny * s));
      g.beginPath();
      g.moveTo(pts[0][0] - layer.x, pts[0][1] - layer.y);
      for (const p of pts.slice(1)) g.lineTo(p[0] - layer.x, p[1] - layer.y);
      g.closePath(); g.fill();
      if (kind === 'kette') {
        // Kettenglieder als feine Querrillen
        const [ax, ay] = this.iso(ox + nx * wid, oy + ny * wid), [bx, by] = this.iso(ox - nx * wid, oy - ny * wid);
        g.strokeStyle = 'rgba(35,26,16,0.22)'; g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(ax - layer.x, ay - layer.y); g.lineTo(bx - layer.x, by - layer.y); g.stroke();
      }
    }
  }

  /** Spuren verblassen langsam (Regen, nachwachsendes Gras) */
  fadeTracks(amount: number) {
    for (const l of this.tracks.values()) {
      const g = l.canvas.getContext('2d')!;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = `rgba(0,0,0,${amount})`;
      g.fillRect(0, 0, l.canvas.width, l.canvas.height);
      g.globalCompositeOperation = 'source-over';
    }
  }
}
