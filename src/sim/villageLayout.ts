// Dorfplan: Dorfstraße(n) mit Grundstücken links und rechts. Jedes Grundstück liegt an einer Straße,
// das Haus steht zur Straße hin. Grundstücke blockieren Bewegung und Bauplätze, Straßen sind befahrbar.
// Der Plan ergibt sich deterministisch aus Dorfposition und Gelände.
import { T_FELS, T_WASSER, type ProvinceMap } from './types';

/** Seite, an der die Straße liegt (aus Sicht des Grundstücks) */
export type PlotFace = 'px' | 'nx' | 'py' | 'ny';
export interface Plot { x: number; y: number; w: number; h: number; kind: PlotKind; variant: number; face: PlotFace }
export interface VillageLayout { streets: [number, number, number, number][]; plots: Plot[] }
export type PlotKind = 'haus' | 'hof' | 'scheune' | 'gasthaus' | 'kirche' | 'gemeinde' | 'garten' | 'muehle';

/** Straßenfront und Tiefe in Kacheln, Anzahl Varianten (Grafiken) */
export const PLOT_TYPES: Record<PlotKind, { front: number; depth: number; variants: number }> = {
  haus: { front: 2, depth: 2, variants: 6 },
  hof: { front: 3, depth: 2, variants: 3 },
  scheune: { front: 2, depth: 2, variants: 2 },
  gasthaus: { front: 2, depth: 2, variants: 1 },
  kirche: { front: 3, depth: 3, variants: 1 },
  gemeinde: { front: 3, depth: 3, variants: 1 },   // Gemeindehaus (Rathaus) mit Dorfplatz und Fahnenmast
  garten: { front: 2, depth: 2, variants: 2 },     // Obstwiese / Gemüsegarten mit Gartenhaus
  muehle: { front: 3, depth: 2, variants: 2 },     // 0 Wassermühle (nahe Wasser), 1 Bockwindmühle
};

function mulberry(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Plan für ein Dorf um (vx, vy). `taken` enthält bereits belegte Kacheln (andere Dörfer) und wird ergänzt.
 * `avoid` sind Punkte (z. B. Basis), denen das Dorf nicht zu nahe kommen soll.
 */
export function makeVillageLayout(map: ProvinceMap, vx: number, vy: number, seed: number, taken: Set<number>, avoid: [number, number, number][] = []): VillageLayout {
  // mehrere Ausrichtungen und Mittelpunkte probieren, den Plan mit den meisten Häusern nehmen
  let best: { layout: VillageLayout; taken: Set<number>; score: number } | null = null;
  const offsets: [number, number][] = [[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2], [3, 3], [-3, -3], [3, -3], [-3, 3]];
  for (let k = 0; k < offsets.length * 2; k++) {
    const [ox, oy] = offsets[k >> 1];
    const t = new Set(taken);
    const layout = layoutOnce(map, vx + ox, vy + oy, (seed + k * 7919) | 0, k & 1 ? 'y' : 'x', t, avoid);
    const score = layout.plots.filter((p) => p.kind === 'haus' || p.kind === 'hof' || p.kind === 'gasthaus').length - Math.hypot(ox, oy) * 0.3;
    if (!best || score > best.score) best = { layout, taken: t, score };
    if (best.score >= 22) break;
  }
  for (const i of best!.taken) taken.add(i);
  return best!.layout;
}

function layoutOnce(map: ProvinceMap, vx: number, vy: number, seed: number, axis: 'x' | 'y', taken: Set<number>, avoid: [number, number, number][]): VillageLayout {
  const rnd = mulberry(seed);
  const { w, h, terrain } = map;
  const ok = (x: number, y: number) => x >= 2 && y >= 2 && x < w - 2 && y < h - 2 && terrain[y * w + x] !== T_WASSER && terrain[y * w + x] !== T_FELS
    && avoid.every(([ax, ay, r]) => Math.hypot(x - ax, y - ay) >= r);
  const streetTiles = new Set<number>();
  const streets: [number, number, number, number][] = [];
  const plots: Plot[] = [];

  /** Straße entlang einer Achse, an beiden Enden gekürzt, bis das Gelände passt */
  const addStreet = (axis: 'x' | 'y', cx: number, cy: number, half: number) => {
    let a0 = -half, a1 = half;
    const at = (a: number): [number, number] => (axis === 'x' ? [cx + a, cy] : [cx, cy + a]);
    const fine = (a: number) => { const [x, y] = at(a); return ok(x, y) && !taken.has(y * w + x); };
    if (!fine(0)) return null;
    for (let a = 1; a <= half; a++) if (!fine(a)) { a1 = a - 1; break; }
    for (let a = -1; a >= -half; a--) if (!fine(a)) { a0 = a + 1; break; }
    if (a1 - a0 < 4) return null;
    const [x0, y0] = at(a0), [x1, y1] = at(a1);
    streets.push([x0, y0, x1, y1]);
    for (let a = a0; a <= a1; a++) { const [x, y] = at(a); streetTiles.add(y * w + x); }
    return { axis, cx, cy, a0, a1 };
  };

  const main = addStreet(axis, vx, vy, 8 + Math.floor(rnd() * 3));
  if (!main) return { streets, plots };
  const other = main.axis === 'x' ? 'y' : 'x';
  const crossAt = (off: number, half: number) => {
    const [cx, cy] = main.axis === 'x' ? [vx + off, vy] : [vx, vy + off];
    return addStreet(other, cx, cy, half);
  };
  // zwei Querstraßen links und rechts der Dorfmitte
  const crosses = [crossAt(-(3 + Math.floor(rnd() * 3)), 4 + Math.floor(rnd() * 3)), crossAt(4 + Math.floor(rnd() * 3), 4 + Math.floor(rnd() * 3))];

  const free = (x0: number, y0: number, pw: number, ph: number) => {
    for (let y = y0; y < y0 + ph; y++) for (let x = x0; x < x0 + pw; x++) {
      if (!ok(x, y) || streetTiles.has(y * w + x) || taken.has(y * w + x) || map.deposit[y * w + x]) return false;
    }
    return true;
  };
  const built = new Set<number>(); // Hausflächen (ohne Abstand), an denen kein Nachbar anliegen darf
  const occupy = (p: Plot) => { for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { taken.add(y * w + x); built.add(y * w + x); } };
  const touchesBuilt = (x0: number, y0: number, pw: number, ph: number) => {
    for (let y = y0 - 1; y <= y0 + ph; y++) for (let x = x0 - 1; x <= x0 + pw; x++) if (built.has(y * w + x)) return true;
    return false;
  };
  type St = NonNullable<ReturnType<typeof addStreet>>;
  /** Lage eines Grundstücks an Position a (entlang der Straße) auf Seite side */
  const rectFor = (st: St, a: number, side: number, kind: PlotKind) => {
    const t = PLOT_TYPES[kind];
    if (st.axis === 'x') return { px: st.cx + a, pw: t.front, ph: t.depth, py: side < 0 ? st.cy - t.depth : st.cy + 1, face: (side < 0 ? 'py' : 'ny') as PlotFace };
    return { py: st.cy + a, ph: t.front, pw: t.depth, px: side < 0 ? st.cx - t.depth : st.cx + 1, face: (side < 0 ? 'px' : 'nx') as PlotFace };
  };
  /** Grundstück setzen; gibt die belegte Straßenfront zurück (0 = passt nicht) */
  const tryPlot = (st: St, a: number, side: number, kind: PlotKind, variant?: number): number => {
    const t = PLOT_TYPES[kind];
    const { px, py, pw, ph, face } = rectFor(st, a, side, kind);
    if (a + t.front - 1 > st.a1 + 1 || !free(px, py, pw, ph) || touchesBuilt(px, py, pw, ph)) return 0;
    const p: Plot = { x: px, y: py, w: pw, h: ph, kind, variant: variant ?? Math.floor(rnd() * t.variants), face };
    plots.push(p); occupy(p);
    // Abstand zum Nachbarn: eine Kachel Vorgarten bzw. Hofweg an jeder Seite der Straßenfront, nie Wand an Wand
    const gap = face === 'py' || face === 'ny' ? [[-1, 0], [pw, 0]] : [[0, -1], [0, ph]];
    for (const [gx, gy] of gap) { const x = px + gx, y = py + gy; if (x >= 0 && y >= 0 && x < w && y < h) taken.add(y * w + x); }
    return t.front;
  };

  // Dorfmitte: Gemeindehaus mit Dorfplatz, gegenüber die Kirche
  const cSide = rnd() < 0.5 ? -1 : 1;
  for (const a of [-1, 0, -2, 1]) if (tryPlot(main, a, cSide, 'gemeinde')) break;
  for (const a of [-1, 0, 1, -2, 2]) if (tryPlot(main, a, -cSide, 'kirche')) break;

  // Mühle am Dorfrand: am Wasser eine Wassermühle, sonst eine Windmühle möglichst weit draußen
  {
    let best: { st: St; a: number; side: number; score: number; water: boolean } | null = null;
    for (const st of [main, ...crosses]) {
      if (!st) continue;
      for (const a of [st.a0, st.a0 + 1, st.a1 - 3, st.a1 - 2]) for (const side of [-1, 1]) {
        const r = rectFor(st, a, side, 'muehle');
        if (a + 2 > st.a1 + 1 || !free(r.px, r.py, r.pw, r.ph) || touchesBuilt(r.px, r.py, r.pw, r.ph)) continue;
        let wd = 99;
        for (let y = r.py - 3; y < r.py + r.ph + 3; y++) for (let x = r.px - 3; x < r.px + r.pw + 3; x++) {
          if (x >= 0 && y >= 0 && x < w && y < h && terrain[y * w + x] === T_WASSER) wd = Math.min(wd, Math.max(r.px - x, x - (r.px + r.pw - 1), r.py - y, y - (r.py + r.ph - 1), 0));
        }
        const water = wd <= 2;
        const out = Math.hypot(r.px + r.pw / 2 - vx, r.py + r.ph / 2 - vy);
        const score = (water ? 100 - wd * 10 : 0) + out;
        if (!best || score > best.score) best = { st, a, side, score, water };
      }
    }
    if (best) tryPlot(best.st, best.a, best.side, 'muehle', best.water ? 0 : 1);
  }

  let innDone = false;
  const pickKind = (): PlotKind => {
    const r = rnd();
    if (!innDone && r < 0.08) { innDone = true; return 'gasthaus'; }
    return r < 0.58 ? 'haus' : r < 0.76 ? 'hof' : r < 0.86 ? 'scheune' : 'garten';
  };
  const fill = (st: St | null) => {
    if (!st) return;
    for (const side of [-1, 1]) {
      let a = st.a0;
      while (a <= st.a1) {
        let kind = pickKind(), used = 0;
        for (let attempt = 0; attempt < 3 && !used; attempt++) {
          used = tryPlot(st, a, side, kind);
          kind = attempt === 0 ? 'haus' : 'garten';
        }
        a += used ? used + (rnd() < 0.12 ? 1 : 0) : 1;
      }
    }
  };
  fill(main);
  for (const c of crosses) fill(c);
  // zu klein? weitere Gassen anlegen, bis mindestens 20 Häuser stehen
  const houses = () => plots.filter((p) => p.kind === 'haus' || p.kind === 'hof' || p.kind === 'gasthaus').length;
  const cands: [St, number, number][] = [];
  for (const st of [main, ...crosses]) {
    if (!st) continue;
    for (let along = st.a0; along <= st.a1; along += 2) for (const dir of [-1, 1]) cands.push([st, along, dir]);
  }
  for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
  for (const [st, along, dir] of cands) {
    if (houses() >= 22) break;
    const [sx, sy] = st.axis === 'x' ? [st.cx + along, st.cy] : [st.cx, st.cy + along];
    const off = dir * 5, mid = Math.round(off / 2);
    // erst die Verbindung zur Straße, dann eine parallele Gasse
    const link = st.axis === 'x' ? addStreet('y', sx, sy + mid, 2) : addStreet('x', sx + mid, sy, 2);
    if (!link) continue;
    const lane = st.axis === 'x' ? addStreet('x', sx, sy + off, 6) : addStreet('y', sx + off, sy, 6);
    innDone = true;
    fill(link);
    fill(lane);
  }
  for (const t of streetTiles) taken.add(t);
  return { streets, plots };
}

/** Kacheln aller Grundstücke (blockiert) */
export function plotTiles(layout: VillageLayout | undefined, w: number, out: Set<number> = new Set()): Set<number> {
  if (!layout) return out;
  for (const p of layout.plots) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) out.add(y * w + x);
  return out;
}
