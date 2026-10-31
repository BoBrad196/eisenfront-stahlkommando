// Kulturlandschaft einer Detailkarte (nur Darstellung, keine Spielwirkung):
// Landstraßen von der Basis zu den Dörfern und Kartenrändern, Feldwege zu den Vorkommen, gepflasterte
// Dorfstraßen, Äcker um die Dörfer und Telegrafenmasten entlang der Landstraßen.
// Breiten in echten Maßen (1 Kachel = 5,6 m): Dorfstraße 5,5 m, Landstraße 5 m, Feldweg 3 m.
import { T_FELS, T_GRAS, T_SAND, T_WALD, T_WASSER, type ProvinceMap, type Village } from '../sim/types';
import { plotTiles } from '../sim/villageLayout';

export interface Field { x: number; y: number; w: number; h: number; kind: 'weizen' | 'gruen' | 'acker'; rows: 'x' | 'y' }
export interface Pole { tx: number; ty: number; next: [number, number] | null }
export type RoadKind = 'dorf' | 'strasse' | 'feldweg';
/** halbe Fahrbahnbreite in Kacheln */
export const ROAD_HW: Record<RoadKind, number> = { dorf: 0.49, strasse: 0.45, feldweg: 0.27 };
const KINDS: RoadKind[] = ['dorf', 'strasse', 'feldweg'];

const R = 4; // Auflösung des Wege-Abstandsfelds (Werte je Kachel)
const hash = (x: number, y: number, k = 0) => (((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) / 4294967296;

export class Landscape {
  roads: { pts: [number, number][]; kind: RoadKind }[] = [];
  fields: Field[] = [];
  poles: Pole[] = [];
  /** Kacheln, auf denen Dorfgrundstücke liegen (keine Bäume, Äcker, Wege) */
  plots = new Set<number>();
  private dist: Record<RoadKind, Float32Array>;
  private DW: number;

  constructor(private map: ProvinceMap, villages: Village[]) {
    const { w, h } = map;
    this.DW = w * R + 1;
    this.dist = { dorf: new Float32Array(this.DW * (h * R + 1)).fill(9), strasse: new Float32Array(this.DW * (h * R + 1)).fill(9), feldweg: new Float32Array(this.DW * (h * R + 1)).fill(9) };
    for (const v of villages) plotTiles(v.layout, w, this.plots);
    // Dorfstraßen: gerade, von Kachelmitte zu Kachelmitte
    for (const v of villages) for (const [x0, y0, x1, y1] of v.layout?.streets ?? []) {
      const ext = x0 === x1 ? [0, 0.35] : [0.35, 0];
      const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      this.roads.push({ kind: 'dorf', pts: [[x0 + 0.5 - dx * ext[0], y0 + 0.5 - dy * ext[1]], [x1 + 0.5 + dx * ext[0], y1 + 0.5 + dy * ext[1]]] });
    }
    this.buildRoads(villages);
    for (const r of this.roads) for (let i = 0; i + 1 < r.pts.length; i++) this.rasterSeg(r.pts[i], r.pts[i + 1], this.dist[r.kind]);
    this.buildFields(villages);
    this.buildPoles();
  }

  private sample(d: Float32Array, tx: number, ty: number) {
    const gx = Math.max(0, Math.min(this.map.w * R - 1.001, tx * R)), gy = Math.max(0, Math.min(this.map.h * R - 1.001, ty * R));
    const x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, i = y0 * this.DW + x0;
    return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + this.DW] * (1 - fx) + d[i + this.DW + 1] * fx) * fy;
  }

  /** Abstand zum Rand der nächsten Fahrbahn in Kacheln (negativ = auf der Fahrbahn) */
  roadDist(tx: number, ty: number): number {
    let best = 9;
    for (const k of KINDS) best = Math.min(best, this.sample(this.dist[k], tx, ty) - ROAD_HW[k] + 0.3);
    return best;
  }

  /** Nächstgelegene Fahrbahn: Art, Abstand zur Mittellinie, halbe Breite */
  roadInfo(tx: number, ty: number): { kind: RoadKind; d: number; hw: number } {
    let kind: RoadKind = 'feldweg', d = 9, edge = 9;
    for (const k of KINDS) {
      const dk = this.sample(this.dist[k], tx, ty), e = dk - ROAD_HW[k];
      if (e < edge) { edge = e; d = dk; kind = k; }
    }
    return { kind, d, hw: ROAD_HW[kind] };
  }

  isPlot(tx: number, ty: number) { return this.plots.has(Math.floor(ty) * this.map.w + Math.floor(tx)); }

  fieldAt(tx: number, ty: number): Field | null {
    for (const f of this.fields) if (tx >= f.x && ty >= f.y && tx < f.x + f.w && ty < f.y + f.h) return f;
    return null;
  }

  // ---------- Wege: kürzeste Wege (Dijkstra) von der Basis, die sich zu einem Netz vereinen ----------
  private buildRoads(villages: Village[]) {
    const { w, h, terrain } = this.map;
    const n = w * h;
    const cost = new Float32Array(n);
    const streetTiles = new Set<number>();
    for (const v of villages) for (const [x0, y0, x1, y1] of v.layout?.streets ?? []) {
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) streetTiles.add(y * w + x);
    }
    for (let i = 0; i < n; i++) {
      const t = terrain[i];
      cost[i] = t === T_WASSER ? Infinity : t === T_FELS ? 30 : t === T_WALD ? 5 : t === T_SAND ? 1.4 : 1;
      cost[i] += hash(i % w, (i / w) | 0, 5) * 0.8; // leichte Schlängelung
      if (this.plots.has(i)) cost[i] = Infinity;          // nicht durch Grundstücke
      if (streetTiles.has(i)) cost[i] = 0.2;              // vorhandene Dorfstraßen nutzen
    }
    const start = this.nearestLand(Math.round(this.map.anchor[0]), Math.round(this.map.anchor[1]));
    if (start < 0) return;
    const best = new Float32Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
    best[start] = 0;
    const heap: [number, number][] = [[0, start]];
    const push = (c: number, i: number) => {
      heap.push([c, i]);
      let k = heap.length - 1;
      while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1, r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]]; k = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [c, i] = pop();
      if (c > best[i]) continue;
      const x = i % w, y = (i / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (dx && dy && (cost[y * w + nx] === Infinity || cost[ny * w + x] === Infinity)) continue;
        const nc = c + cost[j] * (dx && dy ? 1.42 : 1);
        if (nc < best[j]) { best[j] = nc; prev[j] = i; push(nc, j); }
      }
    }
    // Ziele: beide Enden jeder Dorfstraße und zwei bis drei Kartenränder (Landstraßen), je ein Feld jedes Vorkommens (Feldweg)
    const targets: [number, RoadKind][] = [];
    for (const v of villages) {
      if (!v.layout?.streets.length) { targets.push([this.nearestLand(Math.round(v.x), Math.round(v.y) + 1), 'strasse']); continue; }
      for (const [x0, y0, x1, y1] of v.layout.streets) { targets.push([y0 * w + x0, 'strasse']); targets.push([y1 * w + x1, 'strasse']); }
    }
    const depTargets: number[] = [];
    const seenDep = new Set<number>();
    for (let i = 0; i < n; i++) {
      if (!this.map.deposit[i] || seenDep.has(i)) continue;
      // ganzes Vorkommen markieren, nur eines anfahren
      const stack = [i];
      seenDep.add(i);
      while (stack.length) {
        const k = stack.pop()!, x = k % w, y = (k / w) | 0;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
          const j = ny * w + nx;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && this.map.deposit[j] && !seenDep.has(j)) { seenDep.add(j); stack.push(j); }
        }
      }
      depTargets.push(i);
    }
    const edges: [number, number][] = [[0, h >> 1], [w - 1, h >> 1], [w >> 1, 0], [w >> 1, h - 1]];
    const ek = Math.floor(hash(w, h, this.map.anchor[0]) * 4);
    for (let e = 0; e < 3; e++) {
      const [ex, ey] = edges[(ek + e) % 4];
      let bestE = -1, bd = Infinity;
      for (let o = -12; o <= 12; o++) {
        const x = ex === 0 || ex === w - 1 ? ex : ex + o, y = ex === 0 || ex === w - 1 ? ey + o : ey;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (best[i] < bd) { bd = best[i]; bestE = i; }
      }
      if (bestE >= 0 && bd < Infinity) targets.push([bestE, 'strasse']);
    }
    for (const t of depTargets) targets.push([t, 'feldweg']);
    // Pfade zurückverfolgen; bereits befahrene Kacheln beenden einen Zweig (Netz statt Parallelwegen)
    const used = new Uint8Array(n);
    used[start] = 1;
    for (const t of streetTiles) used[t] = 1;
    for (const [t, kind] of targets) {
      if (t < 0 || best[t] === Infinity) continue;
      const pts: [number, number][] = [];
      let i = t;
      while (i >= 0) {
        if (streetTiles.has(i) && pts.length) { pts.push([(i % w) + 0.5, ((i / w) | 0) + 0.5]); break; }
        if (!streetTiles.has(i)) pts.push([(i % w) + 0.5, ((i / w) | 0) + 0.5]);
        if (used[i] && pts.length > 1) break;
        used[i] = 1;
        i = prev[i];
      }
      if (pts.length >= 2) this.roads.push({ kind, pts: chaikin(chaikin(pts)) });
    }
  }

  private nearestLand(x: number, y: number) {
    const { w, h, terrain } = this.map;
    for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && terrain[yy * w + xx] !== T_WASSER && terrain[yy * w + xx] !== T_FELS) return yy * w + xx;
    }
    return -1;
  }

  private rasterSeg(a: [number, number], b: [number, number], dist: Float32Array) {
    const x0 = Math.max(0, Math.floor((Math.min(a[0], b[0]) - 1.5) * R)), x1 = Math.min(this.map.w * R, Math.ceil((Math.max(a[0], b[0]) + 1.5) * R));
    const y0 = Math.max(0, Math.floor((Math.min(a[1], b[1]) - 1.5) * R)), y1 = Math.min(this.map.h * R, Math.ceil((Math.max(a[1], b[1]) + 1.5) * R));
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const px = gx / R, py = gy / R;
      const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
      const ex = a[0] + dx * t - px, ey = a[1] + dy * t - py;
      const d = Math.sqrt(ex * ex + ey * ey), i = gy * this.DW + gx;
      if (d < dist[i]) dist[i] = d;
    }
  }

  // ---------- Äcker bei den Dörfern ----------
  private buildFields(villages: Village[]) {
    const { w, h, terrain, deposit } = this.map;
    const [ax, ay] = this.map.anchor;
    const free = (x: number, y: number, fw: number, fh: number) => {
      if (x < 1 || y < 1 || x + fw >= w - 1 || y + fh >= h - 1) return false;
      if (Math.hypot(x + fw / 2 - ax, y + fh / 2 - ay) < 9) return false; // Bauplatz der Basis frei lassen
      for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) {
        const i = yy * w + xx;
        if (terrain[i] !== T_GRAS || deposit[i] || this.plots.has(i)) return false;
        if (this.roadDist(xx + 0.5, yy + 0.5) < 0.85) return false;
        // mindestens eine Kachel Abstand zu Grundstücken
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (this.plots.has((yy + oy) * w + xx + ox)) return false;
      }
      for (const f of this.fields) if (x < f.x + f.w + 1 && f.x < x + fw + 1 && y < f.y + f.h + 1 && f.y < y + fh + 1) return false;
      return true;
    };
    villages.forEach((v, vi) => {
      let made = 0;
      for (let k = 0; k < 160 && made < 4; k++) {
        const ang = hash(vi, k, 31) * Math.PI * 2, r = 7 + hash(vi, k, 32) * 6;   // rund um das Dorf
        const big = k < 80; // erst große, dann kleinere Äcker versuchen
        const fw = (big ? 3 : 2) + Math.floor(hash(vi, k, 33) * 3), fh = 2 + Math.floor(hash(vi, k, 34) * (big ? 3 : 2));
        const x = Math.round(v.x + Math.cos(ang) * r - fw / 2), y = Math.round(v.y + Math.sin(ang) * r - fh / 2);
        if (!free(x, y, fw, fh)) continue;
        const kr = hash(vi, k, 35);
        this.fields.push({ x, y, w: fw, h: fh, kind: kr < 0.6 ? 'weizen' : kr < 0.82 ? 'gruen' : 'acker', rows: hash(vi, k, 36) < 0.5 ? 'x' : 'y' });
        made++;
      }
    });
  }

  // ---------- Telegrafenmasten entlang der längeren Wege ----------
  private buildPoles() {
    const { w, h, terrain } = this.map;
    for (const road of this.roads) {
      if (road.kind !== 'strasse') continue;   // Telegrafenleitung nur an Landstraßen
      const line = road.pts;
      let acc = 1.2, prevPole: Pole | null = null;
      for (let i = 0; i + 1 < line.length; i++) {
        const [x0, y0] = line[i], [x1, y1] = line[i + 1];
        const L = Math.hypot(x1 - x0, y1 - y0);
        for (let s = 0; s < L; s += 0.25) {
          acc += 0.25;
          if (acc < 2.8) continue;
          const t = s / L, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
          // seitlich versetzt (rechts der Fahrtrichtung)
          const nx = -(y1 - y0) / L, ny = (x1 - x0) / L;
          const px = x + nx * 0.85, py = y + ny * 0.85;
          const ti = Math.floor(py) * w + Math.floor(px);
          if (px < 0.5 || py < 0.5 || px > w - 0.5 || py > h - 0.5 || Math.hypot(px - this.map.anchor[0], py - this.map.anchor[1]) < 4.5 || terrain[ti] === T_WASSER || terrain[ti] === T_FELS || this.plots.has(ti) || this.roadDist(px, py) < 0.4
            || this.poles.some((p) => Math.abs(p.tx - px) + Math.abs(p.ty - py) < 1.6)) { prevPole = null; acc = 2; continue; }
          const pole: Pole = { tx: px, ty: py, next: null };
          if (prevPole) prevPole.next = [px, py];
          this.poles.push(pole);
          prevPole = pole;
          acc = 0;
        }
      }
    }
  }
}

/** Ecken abrunden (Chaikin), Endpunkte bleiben */
function chaikin(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p;
  const out: [number, number][] = [p[0]];
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  out.push(p[p.length - 1]);
  return out;
}
