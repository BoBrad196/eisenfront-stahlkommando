// Spielstart, Erzeugung der Provinz-Detailkarten und Hilfsfunktionen rund um die Karte
import { makeVillageLayout, plotTiles } from './villageLayout';
import {
  BUILDINGS, ECON, FACTIONS, GEO, NEUTRAL, PLAYER, PROVINCES, PROVINCE_BY_ID, UNITS,
} from './defs';
import {
  D_EISEN, D_GOLD, D_KOHLE, D_NONE, DEPOSIT_KEYS, T_FELS, T_GRAS, T_SAND, T_WALD, T_WASSER,
  type Building, type GameState, type Order, type ProvinceMap, type ProvinceState, type Queues, type Unit, type Village,
} from './types';

/** Größe neuer Detailkarten in Kacheln (eine Kachel ≈ 3 m: ein Dorf braucht rund 60×60 m, bis zum nächsten Dorf sind es 400–600 m) */
export const MAP_W = 192, MAP_H = 192;

// ---------- Zufall (deterministisch) ----------
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function rand(state: GameState): number {
  const r = mulberry(state.rng)();
  state.rng = (Math.imul(state.rng ^ 0x9e3779b9, 0x85ebca6b) + 0x632be5ab) >>> 0;
  return r;
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function newId(state: GameState): number { return state.nextId++; }

export function emptyQueues(): Queues { return { struct: null, kaserne: [], panzerfabrik: [], flugfeld: [], werft: [] }; }
export function queuesOf(map: ProvinceMap, faction: string): Queues {
  const q = (map.queues[faction] ??= emptyQueues());
  q.flugfeld ??= []; // ältere Spielstände
  q.werft ??= [];
  return q;
}

// ---------- Weiler und Dörfer ----------
const HAMLET_A = ['Eichen', 'Linden', 'Buchen', 'Birken', 'Tannen', 'Wiesen', 'Berg', 'Tal', 'Mühl', 'Kirch', 'Hohen', 'Nieder', 'Ober', 'Alt', 'Neu', 'Fels', 'Brunn', 'Sand', 'Wald', 'Hain', 'Rosen', 'Stein', 'Au', 'Ried'];
const HAMLET_B = ['dorf', 'hausen', 'bach', 'feld', 'hof', 'heim', 'stedt', 'brück', 'rode', 'au', 'berg', 'tal', 'kirchen', 'weiler'];
/** Weitere kleine Dörfer neben den Städten der Provinz: deterministisch aus der Provinzkennung */
function hamlets(provId: string, have: number): [string, number][] {
  const r = mulberry(hash(provId) ^ 0x7a31);
  const n = 6 + Math.floor(r() * 4) - Math.max(0, have - 3);
  const out: [string, number][] = [], used = new Set<string>();
  while (out.length < n) {
    const name = HAMLET_A[Math.floor(r() * HAMLET_A.length)] + HAMLET_B[Math.floor(r() * HAMLET_B.length)];
    if (used.has(name)) continue;
    used.add(name);
    out.push([name, 140 + Math.floor(r() * 360)]);
  }
  return out;
}

// ---------- Neues Spiel ----------
export function createGame(seed = Date.now()): GameState {
  const state: GameState = {
    version: 1, time: 0, rng: seed >>> 0, nextId: 1,
    factions: {}, provinces: {}, transits: [], diplomacy: {}, outcome: null, events: [],
  };
  for (const id of Object.keys(FACTIONS)) {
    state.factions[id] = {
      res: id === PLAYER ? { ...ECON.start } : { geld: 2000, kohle: 0, eisen: 0, gold: 0 },
      income: { geld: 0, kohle: 0, eisen: 0, gold: 0 }, tax: 1, alive: true,
      nextAttack: ECON.ai.firstAttackAt + rand(state) * 120,
      nextReinforce: ECON.ai.reinforceEvery * (0.5 + rand(state)),
      research: { done: [], current: null },
      nextResearch: ECON.diplomacy.aiResearchEvery * (0.6 + rand(state) * 0.8),
    };
    if (id !== PLAYER && id !== NEUTRAL) state.diplomacy[id] = { rel: 'krieg', haltung: 0, since: 0 };
  }
  for (const def of PROVINCES) {
    const prov: ProvinceState = {
      id: def.id, owner: def.owner, map: null, garrison: initialGarrison(state, def.owner, def.defense, def.id),
      villages: [...def.villages, ...hamlets(def.id, def.villages.length)].map(([name, pop], i) => ({
        id: `${def.id}-${i}`, name, x: -1, y: -1, basePop: pop, pop, happiness: 60, origin: def.owner,
        upgrades: [], schutz: null, plunderCooldown: 0, revolt: false, income: 0, status: def.owner === NEUTRAL ? 'neutral' : 'eigen',
      })),
    };
    state.provinces[def.id] = prov;
  }
  // Startbasen des Spielers
  setupPlayerStart(state, 'bayern', true);
  setupPlayerStart(state, 'hessen', false);
  return state;
}

function initialGarrison(state: GameState, owner: string, defense: number, provId: string): string[] {
  if (owner === PLAYER) return [];
  if (owner === NEUTRAL) return Array(defense * 2 + 1).fill('miliz');
  const out: string[] = [];
  const n = defense * 2 + 2;
  for (let i = 0; i < n; i++) out.push(pickAiUnit(state, defense, owner));
  if (defense >= 3 && seaAccess(provId)) out.push('patrouillenboot', 'patrouillenboot');
  return out;
}

// ---------- Meer ----------
const SEA_MIN = 60; // so viele zusammenhängende Wasserkacheln gelten als Meer (kleinere: See)
/** Hat die Provinz laut Europakarte einen echten Meerzugang? */
export function seaAccess(provId: string) { return (GEO.provinces[provId]?.coast?.frac ?? 0) >= 0.15; }
const seaCache = new WeakMap<ProvinceMap, Uint8Array>();
/** 1 = Kachel gehört zu einer großen Wasserfläche (Meer) */
export function seaMask(map: ProvinceMap): Uint8Array {
  let m = seaCache.get(map);
  if (m) return m;
  m = new Uint8Array(map.w * map.h);
  const seen = new Uint8Array(map.w * map.h);
  for (let i = 0; i < m.length; i++) {
    if (seen[i] || map.terrain[i] !== T_WASSER) continue;
    const comp: number[] = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const c = comp[k], x = c % map.w, y = (c / map.w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= map.w || ny >= map.h) continue;
        const n = ny * map.w + nx;
        if (!seen[n] && map.terrain[n] === T_WASSER) { seen[n] = 1; comp.push(n); }
      }
    }
    if (comp.length >= SEA_MIN) for (const c of comp) m[c] = 1;
  }
  seaCache.set(map, m);
  return m;
}
/** Wegfindungsraster für Schiffe: alles außer Meer ist blockiert */
const navalCache = new WeakMap<ProvinceMap, Uint8Array>();
export function navalGrid(map: ProvinceMap): Uint8Array {
  let g = navalCache.get(map);
  if (!g) { g = seaMask(map).map((v) => (v ? 0 : 1)); navalCache.set(map, g); }
  return g;
}
/** Nächste Meereskachel zu (x, y), oder null wenn die Karte kein Meer hat */
export function findWater(map: ProvinceMap, cx: number, cy: number): [number, number] | null {
  const sea = seaMask(map);
  cx = Math.round(cx); cy = Math.round(cy);
  for (let r = 0; r < Math.max(map.w, map.h); r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x >= 0 && y >= 0 && x < map.w && y < map.h && sea[y * map.w + x]) return [x, y];
    }
  }
  return null;
}
/** Anzahl Meereskacheln direkt neben einer Grundfläche */
function seaAround(map: ProvinceMap, x: number, y: number, s: number) {
  const sea = seaMask(map);
  let n = 0;
  for (let i = -1; i <= s; i++) for (const [xx, yy] of [[x + i, y - 1], [x + i, y + s], [x - 1, y + i], [x + s, y + i]]) {
    if (xx >= 0 && yy >= 0 && xx < map.w && yy < map.h && sea[yy * map.w + xx]) n++;
  }
  return n;
}
/** Zufällige Einheit für die KI; Einheiten mit Forschungsvoraussetzung erst nach dieser Forschung */
export function pickAiUnit(state: GameState, level: number, faction?: string): string {
  const done = faction ? state.factions[faction]?.research.done ?? [] : [];
  const ok = (t: string) => !UNITS[t].research || done.includes(UNITS[t].research!);
  const pool: [string, number][] = [
    ['schuetze', 4], ['raketentrupp', 3], ['spaehpanzer', 2],
    ['kampfpanzer', level >= 2 ? 2 + level * 0.5 : 0], ['artillerie', level >= 4 ? 1 : 0], ['schwerer_panzer', level >= 5 ? 0.6 : 0],
    ['kampfhubschrauber', level >= 3 ? 1 : 0], ['kampfjet', level >= 4 ? 0.6 : 0],
  ].filter(([t]) => ok(t as string)) as [string, number][];
  const total = pool.reduce((s, [, w]) => s + w, 0);
  let r = rand(state) * total;
  for (const [t, w] of pool) { if ((r -= w) <= 0) return t; }
  return 'schuetze';
}

function setupPlayerStart(state: GameState, provId: string, main: boolean) {
  const map = ensureMap(state, provId);
  const anchor = baseAnchor(map);
  placeBuilding(state, map, 'bauhof', PLAYER, anchor[0] - 1, anchor[1] - 1);
  autoPlace(state, map, 'kraftwerk', PLAYER, anchor);
  if (main) {
    autoPlace(state, map, 'kaserne', PLAYER, anchor);
    autoPlaceMine(state, map, 'kohlebergwerk', PLAYER, anchor);
    autoPlaceMine(state, map, 'eisenbergwerk', PLAYER, anchor);
  }
  const units = main
    ? ['schuetze', 'schuetze', 'schuetze', 'schuetze', 'raketentrupp', 'raketentrupp', 'spaehpanzer', 'kampfpanzer', 'kampfpanzer']
    : ['schuetze', 'schuetze', 'schuetze', 'raketentrupp'];
  units.forEach((t, i) => {
    const [x, y] = findFreeTile(state, map, anchor[0] - 2 + (i % 5), anchor[1] + 4 + Math.floor(i / 5), 12);
    spawnUnit(state, map, t, PLAYER, x + 0.5, y + 0.5);
  });
}

// ---------- Detailkarte ----------
function noiseField(rng: () => number, w: number, h: number, cell: number): number[] {
  const gw = Math.ceil(w / cell) + 2, gh = Math.ceil(h / cell) + 2;
  const g = Array.from({ length: gw * gh }, rng);
  const out = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const fx = x / cell, fy = y / cell, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = g[iy * gw + ix], b = g[iy * gw + ix + 1], c = g[(iy + 1) * gw + ix], d = g[(iy + 1) * gw + ix + 1];
    out[y * w + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  }
  return out;
}
function quantile(arr: number[], q: number): number {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

const TERRAIN_MIX: Record<string, { wald: number; fels: number; wasser: number }> = {
  flach: { wald: 0.12, fels: 0.02, wasser: 0.05 },
  huegel: { wald: 0.18, fels: 0.08, wasser: 0.04 },
  berge: { wald: 0.16, fels: 0.2, wasser: 0.03 },
  wald: { wald: 0.36, fels: 0.03, wasser: 0.05 },
  kueste: { wald: 0.12, fels: 0.03, wasser: 0.02 },
};

export function ensureMap(state: GameState, provId: string): ProvinceMap {
  const prov = state.provinces[provId];
  if (prov.map) {
    // ältere Spielstände: Dorfpläne nachträglich anlegen
    if (prov.villages.some((v) => v.x >= 0 && !v.layout)) layoutVillages(prov.map, prov.villages, prov.map.anchor);
    return prov.map;
  }
  const def = PROVINCE_BY_ID[provId];
  const rng = mulberry(hash(provId) ^ 0x5eed);
  const w = MAP_W, h = MAP_H;
  const terrain = new Array(w * h).fill(T_GRAS);
  const deposit = new Array(w * h).fill(D_NONE);
  const mix = TERRAIN_MIX[def.terrain];

  const nForest = noiseField(rng, w, h, 16), nRock = noiseField(rng, w, h, 24), nWater = noiseField(rng, w, h, 30);
  const nDetail = noiseField(rng, w, h, 6); // kleine Waldstücke und Felsen zusätzlich, damit nicht alles in großen Klumpen liegt
  const tf = quantile(nForest, 1 - mix.wald), tr = quantile(nRock, 1 - mix.fels), tw = quantile(nWater, 1 - mix.wasser);
  for (let i = 0; i < w * h; i++) {
    if (nWater[i] > tw) terrain[i] = T_WASSER;
    else if (nRock[i] > tr) terrain[i] = T_FELS;
    else if (nForest[i] > tf || (nForest[i] > tf - 0.12 && nDetail[i] > 0.62)) terrain[i] = T_WALD;
  }
  // Meer an den Seiten, an denen die Provinz in Wirklichkeit Küste hat (8 Richtungen aus europe.json)
  const sea = new Uint8Array(w * h);
  const coast = GEO.provinces[provId].coast;
  if (coast && seaAccess(provId)) {
    const wob = noiseField(rng, w, h, 14);
    const scale = Math.min(1, coast.frac * 2.2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
      const ang = Math.atan2(dy, dx) / (Math.PI / 4);
      const s0 = Math.floor(ang), f = ang - s0;
      const wgt = coast.sectors[((s0 % 8) + 8) % 8] * (1 - f) + coast.sectors[(((s0 + 1) % 8) + 8) % 8] * f;
      const depth = wgt * scale * (22 + wob[y * w + x] * 18);
      const fromEdge = w / 2 - Math.max(Math.abs(dx), Math.abs(dy));
      if (fromEdge < depth) { terrain[y * w + x] = T_WASSER; sea[y * w + x] = 1; }
      else if (fromEdge < depth + 2.4 && depth > 2) terrain[y * w + x] = T_SAND;
    }
  }

  // Flüsse und Bäche: schlängeln sich von einem Kartenrand zum anderen (Furten entstehen, wo Wege sie kreuzen)
  const nRivers = (def.terrain === 'berge' ? 2 : 1) + Math.floor(rng() * 2) + (def.terrain === 'flach' || def.terrain === 'wald' ? 1 : 0);
  for (let ri = 0; ri < nRivers; ri++) {
    const big = ri === 0 && def.terrain !== 'berge';
    const radius = big ? 1.8 : 0.8;
    let x: number, y: number, ang: number;
    const side = Math.floor(rng() * 4);
    if (side === 0) { x = 0; y = 20 + rng() * (h - 40); ang = 0; }
    else if (side === 1) { x = w - 1; y = 20 + rng() * (h - 40); ang = Math.PI; }
    else if (side === 2) { x = 20 + rng() * (w - 40); y = 0; ang = Math.PI / 2; }
    else { x = 20 + rng() * (w - 40); y = h - 1; ang = -Math.PI / 2; }
    let turn = 0;
    for (let step = 0; step < w * 3; step++) {
      turn = turn * 0.92 + (rng() - 0.5) * 0.22;
      ang += turn * 0.5;
      x += Math.cos(ang); y += Math.sin(ang);
      if (x < -2 || y < -2 || x > w + 1 || y > h + 1) break;
      const rr = Math.ceil(radius);
      for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h || sea[yy * w + xx]) continue;
        terrain[yy * w + xx] = T_WASSER;
      }
    }
  }

  const clear = (cx: number, cy: number, r: number) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) terrain[y * w + x] = T_GRAS;
    }
  };
  const isLand = (x: number, y: number) => terrain[y * w + x] !== T_WASSER && terrain[y * w + x] !== T_SAND;
  const far = (pts: number[][], x: number, y: number, d: number) => pts.every(([px, py]) => Math.hypot(px - x, py - y) >= d);
  const pickSpot = (avoid: [number[][], number][], margin: number, near?: [number, number, number, number]) => {
    for (let tries = 0; tries < 400; tries++) {
      const relax = tries > 250 ? 0.6 : 1;
      let x: number, y: number;
      if (near) {
        const a = rng() * Math.PI * 2, r = near[2] + rng() * (near[3] - near[2]);
        x = Math.round(near[0] + Math.cos(a) * r); y = Math.round(near[1] + Math.sin(a) * r);
      } else {
        x = margin + Math.floor(rng() * (w - margin * 2)); y = margin + Math.floor(rng() * (h - margin * 2));
      }
      if (x < margin || y < margin || x >= w - margin || y >= h - margin) continue;
      if (!isLand(x, y) && tries < 300) continue;
      if (avoid.every(([pts, d]) => far(pts, x, y, d * relax))) return [x, y];
    }
    return [margin + Math.floor(rng() * (w - margin * 2)), margin + Math.floor(rng() * (h - margin * 2))];
  };

  // Basis-Standort (Mitte) für alle Provinzen festhalten, Dörfer und Vorkommen drumherum
  const anchor = pickSpot([], 40);
  clear(anchor[0], anchor[1], 9);
  const villagePts: number[][] = [];
  for (const v of prov.villages) {
    // Dörfer bevorzugt auf offenem Land (wenig Wasser ringsum)
    let x = 0, y = 0;
    for (let k = 0; k < 12; k++) {
      [x, y] = pickSpot([[villagePts, 36], [[anchor], 28]], 14);
      let land = 0, all = 0;
      for (let yy = y - 8; yy <= y + 8; yy++) for (let xx = x - 8; xx <= x + 8; xx++) {
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        all++; if (terrain[yy * w + xx] !== T_WASSER) land++;
      }
      if (land / all > 0.85) break;
    }
    v.x = x; v.y = y;
    villagePts.push([x, y]);
    // Lichtung: Felsen und Wald rund ums Dorf werden zu Wiese, Wasser bleibt
    for (let yy = y - 9; yy <= y + 9; yy++) for (let xx = x - 9; xx <= x + 9; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || (xx - x) ** 2 + (yy - y) ** 2 > 81) continue;
      const t = terrain[yy * w + xx];
      if (t === T_FELS || (t === T_WALD && (xx - x) ** 2 + (yy - y) ** 2 < 49)) terrain[yy * w + xx] = T_GRAS;
    }
  }
  // Dorfpläne (Straßen, Grundstücke) vor den Vorkommen festlegen, damit nichts unter Häusern liegt
  const villageTiles = layoutVillages({ w, h, terrain, deposit } as ProvinceMap, prov.villages, anchor as [number, number]);
  const depositPts: number[][] = [];
  const types: [keyof typeof def.deposits, number][] = [['kohle', D_KOHLE], ['eisen', D_EISEN], ['gold', D_GOLD]];
  for (const [key, code] of types) {
    for (let i = 0; i < def.deposits[key]; i++) {
      const near: [number, number, number, number] | undefined = i === 0 ? [anchor[0], anchor[1], 12, 24] : undefined;
      const [x, y] = pickSpot([[villagePts, 16], [depositPts, 14], [[anchor], 10]], 10, near);
      depositPts.push([x, y]);
      clear(x, y, 2.6);
      for (let yy = y - 2; yy <= y + 2; yy++) for (let xx = x - 2; xx <= x + 2; xx++) {
        if ((xx - x) ** 2 + (yy - y) ** 2 <= 3.3 && xx >= 0 && yy >= 0 && xx < w && yy < h && !villageTiles.has(yy * w + xx)) deposit[yy * w + xx] = code;
      }
    }
  }
  // Wege freiräumen, damit alles erreichbar ist (Dörfer, Vorkommen, Kartenränder)
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n), y = Math.round(y0 + ((y1 - y0) * i) / n);
      for (let yy = y; yy <= y + 1; yy++) for (let xx = x; xx <= x + 1; xx++) {
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && !sea[yy * w + xx] && terrain[yy * w + xx] !== T_GRAS && terrain[yy * w + xx] !== T_SAND) {
          terrain[yy * w + xx] = terrain[yy * w + xx] === T_WASSER ? T_SAND : T_GRAS;
        }
      }
    }
  };
  for (const [x, y] of [...villagePts, ...depositPts]) carve(x, y, anchor[0], anchor[1]);
  // Dörfer untereinander verbinden (jedes mit seinem nächsten Nachbarn), damit ein Wegenetz entsteht
  for (let i = 0; i < villagePts.length; i++) {
    let bj = -1, bd = Infinity;
    for (let j = 0; j < villagePts.length; j++) if (j !== i) { const d = Math.hypot(villagePts[i][0] - villagePts[j][0], villagePts[i][1] - villagePts[j][1]); if (d < bd) { bd = d; bj = j; } }
    if (bj >= 0) carve(villagePts[i][0], villagePts[i][1], villagePts[bj][0], villagePts[bj][1]);
  }
  for (const n of GEO.provinces[provId].neighbors) {
    const [ex, ey] = edgePoint(provId, n.id);
    carve(ex, ey, anchor[0], anchor[1]);
  }

  const map: ProvinceMap = {
    id: provId, w, h, anchor: [anchor[0], anchor[1]], terrain, deposit, units: [], buildings: [], queues: {}, explored: {}, wear: new Array(w * h).fill(0), war: [], version: 0,
  };
  prov.map = map;

  // Bestehende Truppen und Basen auf die Karte setzen
  if (prov.owner !== NEUTRAL && prov.owner !== PLAYER) buildAiBase(state, map, prov.owner, def.defense, anchor as [number, number]);
  for (let i = 0; i < prov.garrison.length; i++) {
    const t = prov.garrison[i];
    let cx = anchor[0], cy = anchor[1];
    if (UNITS[t].domain === 'see') {
      const wpos = findWater(map, anchor[0], anchor[1]);
      if (wpos) spawnUnit(state, map, t, prov.owner, wpos[0] + 0.5, wpos[1] + 0.5);
      continue;
    }
    if (t === 'miliz' && prov.villages.length) { const v = prov.villages[i % prov.villages.length]; cx = v.x; cy = v.y + 3; }
    else { const a = rand(state) * Math.PI * 2; cx += Math.round(Math.cos(a) * 5); cy += Math.round(Math.sin(a) * 5); }
    const [x, y] = findFreeTile(state, map, cx, cy, 10);
    spawnUnit(state, map, t, prov.owner, x + 0.5, y + 0.5);
  }
  prov.garrison = [];
  return map;
}

/** Dorfpläne erzeugen, Gelände unter Straßen und Grundstücken zu Wiese machen; liefert alle belegten Kacheln */
function layoutVillages(map: ProvinceMap, villages: Village[], anchor: [number, number]): Set<number> {
  const taken = new Set<number>();
  for (const v of villages) if (v.layout) { plotTiles(v.layout, map.w, taken); for (const [x0, y0, x1, y1] of v.layout.streets) for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) taken.add(y * map.w + x); }
  for (const v of villages) {
    if (v.x < 0 || v.layout) continue;
    v.layout = makeVillageLayout(map, v.x, v.y, hash(v.id) ^ 0x51ed, taken, [[anchor[0], anchor[1], 9]]);
  }
  for (const i of taken) if (map.terrain[i] !== T_WASSER) map.terrain[i] = T_GRAS;
  if ('version' in map) map.version++;
  return taken;
}

export function baseAnchor(map: ProvinceMap): [number, number] {
  return [map.anchor[0], map.anchor[1]];
}

function buildAiBase(state: GameState, map: ProvinceMap, faction: string, defense: number, anchor: [number, number]) {
  placeBuilding(state, map, 'bauhof', faction, anchor[0] - 1, anchor[1] - 1);
  autoPlace(state, map, 'kraftwerk', faction, anchor);
  autoPlace(state, map, 'kaserne', faction, anchor);
  autoPlaceMine(state, map, 'kohlebergwerk', faction, anchor);
  autoPlaceMine(state, map, 'eisenbergwerk', faction, anchor);
  if (defense >= 2) autoPlace(state, map, 'kraftwerk', faction, anchor);
  if (defense >= 3) autoPlace(state, map, 'panzerfabrik', faction, anchor);
  if (defense >= 3) autoPlaceMine(state, map, 'goldmine', faction, anchor);
  if (defense >= 4) autoPlace(state, map, 'verwaltung', faction, anchor);
  for (let i = 0; i < defense - 1; i++) autoPlace(state, map, 'geschuetzturm', faction, anchor, 4 + i);
  if (defense >= 4) autoPlace(state, map, 'flakstellung', faction, anchor, 5);
  if (defense >= 3 && seaAccess(map.id)) autoPlaceCoastal(state, map, 'werft', faction, anchor);
}

// ---------- Blockierung / Platzsuche ----------
const blockCache = new WeakMap<ProvinceMap, Record<string, { version: number; grid: Uint8Array }>>();
/**
 * 0 = frei, 1 = Gelände blockiert, 2 = Gebäude, 3 = Dorf.
 * Ohne `cls` blockiert jedes Gebäude (für Bauplätze); mit 'inf' bzw. 'tank' nur, was diese Einheitenart aufhält.
 */
export function blockGrid(state: GameState, provId: string, cls?: 'inf' | 'tank'): Uint8Array {
  const map = state.provinces[provId].map!;
  const key = cls ?? 'alle';
  const cache = blockCache.get(map) ?? {};
  blockCache.set(map, cache);
  const c = cache[key];
  if (c && c.version === map.version) return c.grid;
  const g = new Uint8Array(map.w * map.h);
  for (let i = 0; i < g.length; i++) if (map.terrain[i] === T_WASSER || map.terrain[i] === T_FELS) g[i] = 1;
  for (const b of map.buildings) {
    const def = BUILDINGS[b.type];
    if (cls && def.blocks && !def.blocks[cls]) continue;
    const s = def.size;
    for (let y = b.y; y < b.y + s; y++) for (let x = b.x; x < b.x + s; x++) g[y * map.w + x] = 2;
  }
  for (const v of state.provinces[provId].villages) {
    if (v.x < 0) continue;
    if (v.layout) { for (const i of plotTiles(v.layout, map.w)) g[i] = 3; continue; }
    for (let y = v.y - 1; y <= v.y + 1; y++) for (let x = v.x - 1; x <= v.x + 1; x++) g[y * map.w + x] = 3;
  }
  cache[key] = { version: map.version, grid: g };
  return g;
}
export function findFreeTile(state: GameState, map: ProvinceMap, cx: number, cy: number, maxR: number): [number, number] {
  const g = blockGrid(state, map.id);
  cx = Math.round(cx); cy = Math.round(cy);
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x >= map.w - 1 || y >= map.h - 1) continue;
      if (!g[y * map.w + x]) return [x, y];
    }
  }
  return [Math.max(1, Math.min(map.w - 2, cx)), Math.max(1, Math.min(map.h - 2, cy))];
}

function areaFree(map: ProvinceMap, g: Uint8Array, x: number, y: number, s: number, gap: number, allowDeposit: boolean) {
  for (let yy = y - gap; yy < y + s + gap; yy++) for (let xx = x - gap; xx < x + s + gap; xx++) {
    if (xx < 1 || yy < 1 || xx >= map.w - 1 || yy >= map.h - 1) return false;
    if (g[yy * map.w + xx]) return false;
    const inside = xx >= x && yy >= y && xx < x + s && yy < y + s;
    if (inside && !allowDeposit && map.deposit[yy * map.w + xx]) return false;
  }
  return true;
}

function autoPlace(state: GameState, map: ProvinceMap, type: string, faction: string, anchor: [number, number], minR = 2) {
  const s = BUILDINGS[type].size;
  const g = blockGrid(state, map.id);
  for (let r = minR; r < 20; r++) {
    const cand: [number, number][] = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      cand.push([anchor[0] + dx - (s >> 1), anchor[1] + dy - (s >> 1)]);
    }
    const start = Math.floor(rand(state) * cand.length);
    for (let i = 0; i < cand.length; i++) {
      const [x, y] = cand[(start + i) % cand.length];
      if (areaFree(map, g, x, y, s, 1, false)) return placeBuilding(state, map, type, faction, x, y);
    }
  }
  return null;
}

function autoPlaceCoastal(state: GameState, map: ProvinceMap, type: string, faction: string, anchor: [number, number]) {
  const s = BUILDINGS[type].size;
  const g = blockGrid(state, map.id);
  let best: [number, number, number] | null = null;
  for (let y = 1; y < map.h - s; y++) for (let x = 1; x < map.w - s; x++) {
    if (seaAround(map, x, y, s) < 3 || !areaFree(map, g, x, y, s, 0, false)) continue;
    const d = Math.hypot(x - anchor[0], y - anchor[1]);
    if (!best || d < best[2]) best = [x, y, d];
  }
  return best ? placeBuilding(state, map, type, faction, best[0], best[1]) : null;
}

function autoPlaceMine(state: GameState, map: ProvinceMap, type: string, faction: string, anchor: [number, number]) {
  const want = DEPOSIT_KEYS.indexOf(BUILDINGS[type].deposit!);
  const g = blockGrid(state, map.id);
  let best: [number, number, number] | null = null;
  for (let y = 1; y < map.h - 2; y++) for (let x = 1; x < map.w - 2; x++) {
    let cover = 0;
    for (let yy = y; yy < y + 2; yy++) for (let xx = x; xx < x + 2; xx++) if (map.deposit[yy * map.w + xx] === want) cover++;
    if (cover < 3 || !areaFree(map, g, x, y, 2, 0, true)) continue;
    const d = Math.hypot(x - anchor[0], y - anchor[1]) - cover;
    if (!best || d < best[2]) best = [x, y, d];
  }
  return best ? placeBuilding(state, map, type, faction, best[0], best[1]) : null;
}

export function placeBuilding(state: GameState, map: ProvinceMap, type: string, faction: string, x: number, y: number): Building {
  const b: Building = { id: newId(state), type, faction, x, y, hp: BUILDINGS[type].hp, cooldown: 0, target: null, facing: 0 };
  map.buildings.push(b);
  map.version++;
  return b;
}

export function spawnUnit(state: GameState, map: ProvinceMap, type: string, faction: string, x: number, y: number, order: Order = { kind: 'idle' }, hp?: number): Unit {
  const u: Unit = {
    id: newId(state), type, faction, x, y, px: x, py: y, hp: hp ?? UNITS[type].hp,
    facing: rand(state) * Math.PI * 2, order, target: null, cooldown: 0, path: null, pathIdx: 0, repath: 0, scan: rand(state) * 0.5,
  };
  map.units.push(u);
  return u;
}

/** Punkt am Kartenrand in Richtung der Nachbarprovinz */
export function edgePoint(provId: string, fromId: string): [number, number] {
  const a = GEO.provinces[provId].center, b = GEO.provinces[fromId].center;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  // Schnittpunkt der Richtung mit dem Kartenrand (Quadrat), 4 Kacheln davor
  const k = (MAP_W / 2 - 4) / Math.max(Math.abs(Math.cos(ang)), Math.abs(Math.sin(ang)), 0.01);
  return [Math.round(MAP_W / 2 + Math.cos(ang) * k), Math.round(MAP_H / 2 + Math.sin(ang) * k)];
}

export function entryTile(state: GameState, provId: string, fromId: string): [number, number] {
  const map = ensureMap(state, provId);
  const [x, y] = edgePoint(provId, fromId);
  return findFreeTile(state, map, x, y, 12);
}

// ---------- Bauregeln ----------
export function placementError(state: GameState, provId: string, faction: string, type: string, x: number, y: number): string | null {
  const prov = state.provinces[provId];
  const map = prov.map;
  if (!map) return 'Keine Karte';
  const def = BUILDINGS[type];
  const s = def.size;
  const g = blockGrid(state, provId);
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) {
    if (xx < 1 || yy < 1 || xx >= map.w - 1 || yy >= map.h - 1) return 'Außerhalb der Karte';
    const v = g[yy * map.w + xx];
    if (v === 1) return 'Gelände nicht bebaubar';
    if (v) return 'Platz belegt';
  }
  if (def.coastal && seaAround(map, x, y, s) < 3) return 'Muss direkt am Meer stehen';
  if (def.deposit) {
    const want = DEPOSIT_KEYS.indexOf(def.deposit);
    let cover = 0;
    for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) if (map.deposit[yy * map.w + xx] === want) cover++;
    if (!cover) return `Muss auf ${def.deposit === 'gold' ? 'einem Goldvorkommen' : def.deposit === 'kohle' ? 'einem Kohlevorkommen' : 'einem Eisenvorkommen'} stehen`;
  }
  for (const u of map.units) {
    if (u.x > x - 0.3 && u.x < x + s + 0.3 && u.y > y - 0.3 && u.y < y + s + 0.3 && u.faction !== faction) return 'Feindliche Einheiten im Weg';
  }
  const own = map.buildings.filter((b) => b.faction === faction);
  if (type === 'bauhof') {
    if (own.some((b) => b.type === 'bauhof')) return 'Nur ein Bauhof pro Provinz';
    if (prov.owner !== faction) return 'Provinz muss dir gehören';
    return null;
  }
  const R = ECON.buildRadius;
  const near = own.some((b) => {
    const bs = BUILDINGS[b.type].size;
    const dx = Math.max(b.x - (x + s), x - (b.x + bs), 0), dy = Math.max(b.y - (y + s), y - (b.y + bs), 0);
    return Math.max(dx, dy) <= R;
  });
  if (!near) return 'Zu weit von eigenen Gebäuden entfernt';
  return null;
}

export function buildRequirementError(state: GameState, map: ProvinceMap, faction: string, type: string): string | null {
  const def = BUILDINGS[type];
  if (def.research && !state.factions[faction]?.research.done.includes(def.research)) return 'Benötigt Forschung';
  if (def.coastal && !seaAccess(map.id)) return 'Kein Zugang zum Meer';
  const own = map.buildings.filter((b) => b.faction === faction);
  const hasHq = own.some((b) => b.type === 'bauhof');
  if (type === 'bauhof') return hasHq ? 'Bauhof vorhanden' : null;
  if (!hasHq) return 'Benötigt Bauhof';
  if (def.requires && !own.some((b) => b.type === def.requires)) return `Benötigt ${BUILDINGS[def.requires].name}`;
  if (type === 'verwaltung' && own.some((b) => b.type === 'verwaltung')) return 'Nur eine Verwaltung pro Provinz';
  return null;
}

export function factionName(id: string) { return FACTIONS[id]?.name ?? id; }
export function provName(id: string) { return PROVINCE_BY_ID[id]?.name ?? id; }
