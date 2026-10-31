// Simulation: ein Schritt = TICK Sekunden. Läuft für alle Provinzen mit Detailkarte.
import {
  BUILDINGS, ECON, FACTIONS, GEO, NEUTRAL, PLAYER, RESEARCH, RES_KEYS, TICK, UNITS, WEAPONS, type Armor,
} from './defs';
import {
  alliesOf, atWar, baseHaltung, changeHaltung, hasLab, hasResearch, isMajorAi, provinceCount,
} from './diplomacy';
import { applyCommand, canAfford, pay, type Command } from './commands';
import { findPath } from './pathfind';
import {
  DEPOSIT_KEYS, FACTORY_KINDS, T_FELS, T_WALD, T_WASSER, type Building, type GameState, type GameEvent, type ProvinceMap, type ProvinceState, type Queues, type Unit,
} from './types';
import {
  blockGrid, edgePoint, ensureMap, entryTile, factionName, findFreeTile, findWater, navalGrid, pickAiUnit, placeBuilding, placementError, provName, rand, spawnUnit,
} from './world';

export function step(state: GameState, commands: Command[] = []) {
  for (const c of commands) applyCommand(state, c);
  if (state.outcome) return;
  state.time += TICK;
  const tick = Math.round(state.time / TICK);
  const second = tick % Math.round(1 / TICK) === 0;

  for (const prov of Object.values(state.provinces)) {
    if (!prov.map) continue;
    updateProduction(state, prov);
    updateUnits(state, prov);
    updateBuildings(state, prov);
    updateRepairs(state, prov);
    cleanup(state, prov);
  }
  updateTransits(state);
  updateResearch(state);
  if (tick % 5 === 0) for (const prov of Object.values(state.provinces)) if (prov.map) updateExplored(state, prov.map);
  if (second) {
    economy(state);
    diplomacy(state);
    for (const prov of Object.values(state.provinces)) {
      if (!prov.map) continue;
      regrow(prov.map);
      checkCapture(state, prov);
      // KI repariert stark beschädigte Gebäude selbst
      for (const b of prov.map.buildings) {
        if (FACTIONS[b.faction].ai && b.faction !== NEUTRAL && !b.repairing && b.hp < BUILDINGS[b.type].hp * 0.7) b.repairing = true;
      }
    }
    ai(state);
    checkOutcome(state);
  }
  if (state.events.length > 600) state.events.splice(0, state.events.length - 600);
}

function msg(state: GameState, text: string, level: GameEvent['level'] = 'info', target?: string, sound?: string) {
  state.events.push({ kind: 'msg', text, level, target, sound });
}

// ---------- Erkundung (Nebel des Krieges) ----------
/** Sichtquellen einer Fraktion: [x, y, Radius] in Kacheln */
/** Sichtquellen einer Fraktion und ihrer Verbündeten: [x, y, Radius] in Kacheln */
export function sightSources(state: GameState, map: ProvinceMap, faction: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const f of [faction, ...alliesOf(state, faction)]) {
    const bonus = hasResearch(state, f, 'aufklaerung') ? 3 : 0;
    for (const u of map.units) if (u.faction === f) out.push([u.x, u.y, UNITS[u.type].sight + bonus]);
    for (const b of map.buildings) {
      if (b.faction !== f) continue;
      const d = BUILDINGS[b.type];
      out.push([b.x + d.size / 2, b.y + d.size / 2, d.sight + d.size / 2 + bonus]);
    }
  }
  return out;
}
export function markCircles(grid: number[] | Uint8Array, w: number, h: number, sources: [number, number, number][]) {
  for (const [cx, cy, r] of sources) {
    const r2 = r * r;
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(h - 1, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(w - 1, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r2) grid[y * w + x] = 1;
      }
    }
  }
}
function updateExplored(state: GameState, map: ProvinceMap) {
  map.explored ??= {};
  for (const [fid, f] of Object.entries(FACTIONS)) {
    if (f.ai) continue;
    const src = sightSources(state, map, fid);
    if (!src.length) continue;
    const grid = (map.explored[fid] ??= new Array(map.w * map.h).fill(0));
    markCircles(grid, map.w, map.h, src);
  }
}

// ---------- Strom ----------
export function powerInfo(state: GameState, map: ProvinceMap, faction: string) {
  let prod = 0, use = 0;
  const coal = state.factions[faction]?.res.kohle ?? 0;
  for (const b of map.buildings) {
    if (b.faction !== faction) continue;
    const p = BUILDINGS[b.type].power;
    if (p > 0) {
      const boost = b.type === 'kraftwerk' && hasResearch(state, faction, 'kraftwerk') ? 1.5 : 1;
      prod += (b.type === 'kraftwerk' && coal <= 0 && faction === PLAYER ? p / 2 : p) * boost;
    }
    else use -= p;
  }
  return { prod, use, factor: use > prod ? 0.5 : 1 };
}

// ---------- Produktion ----------
function updateProduction(state: GameState, prov: ProvinceState) {
  const map = prov.map!;
  for (const [faction, q] of Object.entries(map.queues)) {
    const pf = powerInfo(state, map, faction).factor;
    if (q.line?.tiles.length && !q.struct) startLinePiece(state, prov, faction, q);
    if (q.struct && !q.struct.ready) {
      q.struct.progress += TICK * pf;
      if (q.struct.progress >= q.struct.total && q.struct.auto) finishLinePiece(state, prov, faction, q);
      else if (q.struct.progress >= q.struct.total) {
        q.struct.ready = true;
        if (faction === PLAYER) msg(state, `${BUILDINGS[q.struct.type].name} bereit zum Platzieren (${provName(prov.id)}).`, 'gut', prov.id);
      }
    }
    for (const kind of FACTORY_KINDS) {
      const list = (q[kind] ??= []);
      if (!list.length) continue;
      const factory = map.buildings.find((b) => b.faction === faction && b.type === kind);
      if (!factory) continue;
      const item = list[0];
      item.progress += TICK * pf;
      if (item.progress >= item.total) {
        list.shift();
        const s = BUILDINGS[kind].size;
        // Flugzeuge starten über dem Flugfeld, Schiffe im Wasser neben der Werft
        const [x, y] = UNITS[item.type].armor === 'luft' ? [factory.x + s / 2 - 0.5, factory.y + s / 2 - 0.5]
          : UNITS[item.type].domain === 'see' ? (findWater(map, factory.x + s / 2, factory.y + s / 2) ?? [factory.x, factory.y])
          : findFreeTile(state, map, factory.x + s / 2, factory.y + s + 1, 8);
        const u = spawnUnit(state, map, item.type, faction, x + 0.5, y + 0.5);
        u.facing = Math.PI / 2;
        state.events.push({ kind: 'sfx', sound: 'ui.einheit', province: prov.id, faction, x: u.x, y: u.y });
        if (factory.rally) {
          // leicht verteilt am Sammelpunkt ankommen
          const a = rand(state) * Math.PI * 2, r = rand(state) * 1.2;
          u.order = { kind: 'move', x: factory.rally[0] + Math.cos(a) * r, y: factory.rally[1] + Math.sin(a) * r };
        }
      }
    }
  }
}

// ---------- Einheiten ----------
type Target = { x: number; y: number; r: number; faction: string; armor: Armor; ref: Unit | Building; building: boolean };

function hostile(state: GameState, map: ProvinceMap, a: string, b: string) {
  if (a === b) return false;
  if (a === NEUTRAL) return map.war.includes(b);
  if (b === NEUTRAL) return map.war.includes(a);
  return atWar(state, a, b);
}
/** Kann diese Waffe diese Panzerung überhaupt treffen? (z. B. Kanonen keine Flugzeuge) */
export function canHit(weapon: string, armor: Armor) { return (WEAPONS[weapon]?.[armor] ?? 0) > 0; }
const isAir = (u: Unit) => UNITS[u.type].armor === 'luft';
const isNaval = (u: Unit) => UNITS[u.type].domain === 'see';
/** Bewegungsart: Boden, Luft oder See (Einheiten verschiedener Art schieben sich nicht weg) */
const domainOf = (u: Unit) => (isAir(u) ? 1 : isNaval(u) ? 2 : 0);

function targetOf(map: ProvinceMap, id: number): Target | null {
  for (const u of map.units) if (u.id === id && u.hp > 0) return { x: u.x, y: u.y, r: 0.3, faction: u.faction, armor: UNITS[u.type].armor, ref: u, building: false };
  for (const b of map.buildings) if (b.id === id && b.hp > 0) {
    const s = BUILDINGS[b.type].size;
    return { x: b.x + s / 2, y: b.y + s / 2, r: s / 2, faction: b.faction, armor: 'gebaeude', ref: b, building: true };
  }
  return null;
}
function distTo(x: number, y: number, t: Target) {
  if (!t.building) return Math.hypot(t.x - x, t.y - y);
  const dx = Math.max(Math.abs(x - t.x) - t.r, 0), dy = Math.max(Math.abs(y - t.y) - t.r, 0);
  return Math.hypot(dx, dy);
}
function nearestHostile(state: GameState, map: ProvinceMap, faction: string, weapon: string, x: number, y: number, radius: number): number | null {
  let best: number | null = null, bd = radius;
  for (const o of map.units) {
    if (o.hp <= 0 || !hostile(state, map, faction, o.faction) || !canHit(weapon, UNITS[o.type].armor)) continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < bd) { bd = d; best = o.id; }
  }
  // Gebäude nur, wenn keine Einheit in Reichweite
  if (best === null && canHit(weapon, 'gebaeude')) {
    for (const b of map.buildings) {
      if (b.hp <= 0 || !hostile(state, map, faction, b.faction)) continue;
      const s = BUILDINGS[b.type].size;
      const d = distTo(x, y, { x: b.x + s / 2, y: b.y + s / 2, r: s / 2 } as Target);
      if (d < bd) { bd = d; best = b.id; }
    }
  }
  return best;
}

function updateUnits(state: GameState, prov: ProvinceState) {
  const map = prov.map!;
  const landGrid = blockGrid(state, prov.id, 'tank');
  const infGrid = blockGrid(state, prov.id, 'inf');
  const seaGrid = navalGrid(map);
  const w = map.w;
  for (const u of map.units) {
    if (u.hp <= 0) continue;
    const grid = isNaval(u) ? seaGrid : UNITS[u.type].armor === 'infanterie' ? infGrid : landGrid;
    // Stacheldraht reißt unter Panzern nieder
    if (!isNaval(u) && UNITS[u.type].armor !== 'infanterie' && !isAir(u)) {
      const wall = buildingAtTile(map, Math.floor(u.x), Math.floor(u.y));
      const dmg = wall && BUILDINGS[wall.type].crossDamage;
      if (dmg) wall!.hp -= dmg * TICK;
    }
    u.px = u.x; u.py = u.y;
    const def = UNITS[u.type];
    u.cooldown -= TICK;
    u.scan -= TICK;
    u.repath -= TICK;

    if (u.order.kind === 'attack') u.target = u.order.target;
    let t = u.target != null ? targetOf(map, u.target) : null;
    if (t && !canHit(def.weapon, t.armor)) t = null; // z. B. Panzer gegen Hubschrauber
    if (!t && u.target != null) {
      u.target = null;
      if (u.order.kind === 'attack') u.order = { kind: 'idle' };
    }
    const auto = u.order.kind === 'idle' || u.order.kind === 'attackMove' || u.order.kind === 'hunt';
    if (auto && u.scan <= 0) {
      u.scan = 0.5;
      const radius = u.order.kind === 'hunt' ? 999 : def.range + 3;
      const cand = nearestHostile(state, map, u.faction, def.weapon, u.x, u.y, radius);
      // Bereits verfolgtes Ziel nur wechseln, wenn das neue näher ist
      if (cand != null && (!t || cand !== u.target)) {
        const ct = targetOf(map, cand)!;
        if (!t || distTo(u.x, u.y, ct) + 0.5 < distTo(u.x, u.y, t)) { u.target = cand; t = ct; u.path = null; }
      }
      // Leine: Leerlauf-Einheiten jagen Ziele nicht über die ganze Karte
      if (t && u.order.kind === 'idle' && distTo(u.x, u.y, t) > def.range + 6) { u.target = null; t = null; }
    }

    if (t) {
      const d = distTo(u.x, u.y, t);
      const want = Math.atan2(t.y - u.y, t.x - u.x);
      if (def.turret) u.aim = turn(u.aim ?? u.facing, want, 5 * TICK); // Turm folgt dem Ziel auch während der Fahrt
      if (d <= def.range && d >= (def.minRange ?? 0)) {
        u.path = null;
        if (!def.turret) u.facing = turn(u.facing, want, 6 * TICK);
        // Erst feuern, wenn der Turm (bzw. die Einheit) ungefähr zum Ziel zeigt
        const pointing = Math.abs(angleDiff(def.turret ? u.aim! : u.facing, want)) < 0.35;
        if (u.cooldown <= 0 && pointing) { fire(state, prov, u.faction, u.x, u.y, def.weapon, def.damage, def.splash, t, isAir(u)); u.cooldown = def.rof; }
      } else if (isAir(u)) {
        flyToward(u, t.x, t.y, def.speed, map);
      } else if (d < (def.minRange ?? 0)) {
        // zu nah (Artillerie): zurückweichen
        const a = Math.atan2(u.y - t.y, u.x - t.x);
        moveToward(u, u.x + Math.cos(a) * 2, u.y + Math.sin(a) * 2, def.speed, grid, map);
      } else {
        if (!u.path || u.repath <= 0) {
          u.path = findPath(grid, w, map.h, u.x, u.y, t.x, t.y, 6000);
          u.pathIdx = 0; u.repath = 1 + rand(state) * 0.5;
        }
        followPath(u, def.speed, grid, map);
      }
      continue;
    }

    // Ohne Ziel dreht der Turm langsam zurück in Fahrtrichtung
    if (def.turret) u.aim = turn(u.aim ?? u.facing, u.facing, 2.5 * TICK);
    if ((u.order.kind === 'move' || u.order.kind === 'attackMove') && isAir(u)) {
      if (flyToward(u, u.order.x, u.order.y, def.speed, map)) u.order = { kind: 'idle' };
      continue;
    }
    if (u.order.kind === 'move' || u.order.kind === 'attackMove') {
      const o = u.order;
      if (!u.path) { u.path = findPath(grid, w, map.h, u.x, u.y, o.x, o.y); u.pathIdx = 0; }
      if (!u.path || u.pathIdx >= u.path.length) { u.order = { kind: 'idle' }; u.path = null; continue; }
      followPath(u, def.speed, grid, map);
    }
  }
  separate(map, landGrid, seaGrid);
  for (const u of map.units) addWear(map, u);
}

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function turn(cur: number, want: number, max: number) {
  let d = want - cur;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return cur + Math.max(-max, Math.min(max, d));
}

/** Flugzeuge fliegen geradeaus über jedes Gelände */
function flyToward(u: Unit, tx: number, ty: number, speed: number, map: ProvinceMap): boolean {
  tx = Math.max(0.5, Math.min(map.w - 0.5, tx)); ty = Math.max(0.5, Math.min(map.h - 0.5, ty));
  const dx = tx - u.x, dy = ty - u.y, d = Math.hypot(dx, dy);
  const stepLen = speed * TICK;
  u.facing = turn(u.facing, Math.atan2(dy, dx), 5 * TICK);
  if (d <= stepLen) { u.x = tx; u.y = ty; return true; }
  u.x += (dx / d) * stepLen; u.y += (dy / d) * stepLen;
  return false;
}

/** Gebäude, das die Kachel (x, y) belegt */
function buildingAtTile(map: ProvinceMap, x: number, y: number) {
  return map.buildings.find((b) => { const s = BUILDINGS[b.type].size; return x >= b.x && x < b.x + s && y >= b.y && y < b.y + s; });
}

function speedAt(u: Unit, speed: number, map: ProvinceMap) {
  const i = Math.floor(u.y) * map.w + Math.floor(u.x);
  const armor = UNITS[u.type].armor;
  let s = map.terrain[i] === T_WALD ? speed * (armor === 'infanterie' ? 0.85 : 0.65) : speed;
  // Schützengräben und Gräben bremsen Fahrzeuge
  const slow = armor !== 'infanterie' ? BUILDINGS[buildingAtTile(map, Math.floor(u.x), Math.floor(u.y))?.type ?? '']?.slow : undefined;
  if (slow) s *= slow;
  // Tiefer Matsch bremst Fahrzeuge (Radfahrzeuge stärker als Kettenfahrzeuge)
  const wear = map.wear?.[i] ?? 0;
  if (wear > 55 && armor !== 'infanterie') s *= armor === 'leicht' ? 0.8 : 0.9;
  return s;
}

// ---------- Überrollschäden ----------
/** Gewicht eines schweren Fahrzeugs für den Überrollschaden (Panzer IV = 1, schwerer = bis 1,6) */
export function crushWeight(hp: number) { return Math.min(1.6, Math.max(0.8, hp / 480)); }

// ---------- Bodenabnutzung ----------
/** Abnutzung pro gefahrener Kachel: schwere Fahrzeuge zerwühlen den Boden stark, Infanterie tritt Pfade aus */
const WEAR_PER_TILE: Record<string, number> = { schwer: 7, leicht: 3.5, infanterie: 0.5 };
function addWear(map: ProvinceMap, u: Unit) {
  const def = UNITS[u.type];
  if (def.armor === 'luft' || def.domain === 'see') return;
  const d = Math.hypot(u.x - u.px, u.y - u.py);
  if (d < 1e-4) return;
  const i = Math.floor(u.y) * map.w + Math.floor(u.x);
  const t = map.terrain[i];
  if (t === T_WASSER || t === T_FELS) return;
  // Schwere Panzer überrollen Dorfstraßen, Bäume, Masten und Zäune (Stufen siehe src/render/damage.ts)
  if (def.armor === 'schwer') {
    const crush = (map.crush ??= new Array(map.w * map.h).fill(0));
    crush[i] += d * crushWeight(def.hp);
  }
  const wear = (map.wear ??= new Array(map.w * map.h).fill(0));
  wear[i] = Math.min(100, wear[i] + (WEAR_PER_TILE[def.armor] ?? 0) * d);
}
/** Gras wächst langsam nach (jede Sekunde ein kleiner Anteil) */
function regrow(map: ProvinceMap) {
  const wear = map.wear;
  if (!wear) return;
  for (let i = 0; i < wear.length; i++) if (wear[i] > 0) wear[i] = wear[i] < 0.5 ? 0 : wear[i] * 0.9985;
}
function followPath(u: Unit, speed: number, grid: Uint8Array, map: ProvinceMap) {
  if (!u.path || u.pathIdx >= u.path.length) return;
  const [tx, ty] = u.path[u.pathIdx];
  if (moveToward(u, tx, ty, speed, grid, map)) u.pathIdx++;
}
function moveToward(u: Unit, tx: number, ty: number, speed: number, grid: Uint8Array, map: ProvinceMap): boolean {
  const dx = tx - u.x, dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  const stepLen = speedAt(u, speed, map) * TICK;
  u.facing = turn(u.facing, Math.atan2(dy, dx), 8 * TICK);
  if (d <= stepLen) { u.x = tx; u.y = ty; return true; }
  const nx = u.x + (dx / d) * stepLen, ny = u.y + (dy / d) * stepLen;
  if (!grid[Math.floor(ny) * map.w + Math.floor(nx)]) { u.x = nx; u.y = ny; }
  else u.path = null;
  return false;
}

function separate(map: ProvinceMap, grid: Uint8Array, seaGrid: Uint8Array) {
  const us = map.units;
  for (let i = 0; i < us.length; i++) {
    const a = us[i];
    const ra = UNITS[a.type].armor === 'infanterie' ? 0.25 : isNaval(a) ? 0.55 : 0.42;
    for (let j = i + 1; j < us.length; j++) {
      const b = us[j];
      if (domainOf(a) !== domainOf(b)) continue; // Boden, Luft und See stören sich nicht
      const rb = UNITS[b.type].armor === 'infanterie' ? 0.25 : isNaval(b) ? 0.55 : 0.42;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) continue;
      const d = Math.hypot(dx, dy) || 0.01;
      const min = ra + rb;
      if (d >= min) continue;
      const push = (min - d) * 0.25;
      const ux = dx / d, uy = dy / d;
      if (isAir(a)) { a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push; continue; }
      const g = isNaval(a) ? seaGrid : grid;
      tryPush(a, -ux * push, -uy * push, g, map.w);
      tryPush(b, ux * push, uy * push, g, map.w);
    }
  }
}
function tryPush(u: Unit, dx: number, dy: number, grid: Uint8Array, w: number) {
  const nx = u.x + dx, ny = u.y + dy;
  if (!grid[Math.floor(ny) * w + Math.floor(nx)]) { u.x = nx; u.y = ny; }
}

// ---------- Kampf ----------
function fire(state: GameState, prov: ProvinceState, faction: string, x: number, y: number, weapon: string, damage: number, splash: number | undefined, t: Target, fromAir = false) {
  const map = prov.map!;
  state.events.push({ kind: 'shot', province: prov.id, x, y, x2: t.x, y2: t.y, weapon, fromAir, toAir: t.armor === 'luft' });
  const mult = WEAPONS[weapon];
  if (hasResearch(state, faction, 'munition')) damage *= 1.15;
  if (splash) {
    for (const o of map.units) {
      if (o.hp <= 0 || !hostile(state, map, faction, o.faction) || isAir(o)) continue;
      const d = Math.hypot(o.x - t.x, o.y - t.y);
      if (d <= splash) hit(state, prov, faction, o, damage * mult[UNITS[o.type].armor] * (1 - (d / splash) * 0.5));
    }
    if (t.building) hit(state, prov, faction, t.ref, damage * mult.gebaeude);
    state.events.push({ kind: 'explosion', province: prov.id, x: t.x, y: t.y });
  } else {
    hit(state, prov, faction, t.ref, damage * mult[t.armor]);
  }
}
const alarmAt: Record<string, number> = {};
function hit(state: GameState, prov: ProvinceState, attacker: string, ref: Unit | Building, dmg: number) {
  if ('order' in ref) {
    const armor = UNITS[ref.type].armor;
    if ((armor === 'leicht' || armor === 'schwer') && hasResearch(state, ref.faction, 'panzerung')) dmg *= 0.8;
  } else if (hasResearch(state, ref.faction, 'befestigung')) dmg *= 0.75;
  ref.hp -= dmg;
  const map = prov.map!;
  if (attacker === PLAYER && isMajorAi(ref.faction)) changeHaltung(state, ref.faction, -ECON.diplomacy.attackPenalty);
  if (ref.faction === NEUTRAL && attacker !== NEUTRAL && !map.war.includes(attacker)) map.war.push(attacker);
  if (ref.faction === PLAYER && attacker !== PLAYER && (alarmAt[prov.id] ?? -99) < state.time - 25) {
    alarmAt[prov.id] = state.time;
    msg(state, `Kampf in ${provName(prov.id)}!`, 'alarm', prov.id);
  }
  // Getroffene Einheiten im Leerlauf wehren sich
  if ('order' in ref && ref.order.kind === 'idle' && ref.target == null) ref.scan = 0;
}

function updateBuildings(state: GameState, prov: ProvinceState) {
  const map = prov.map!;
  for (const b of map.buildings) {
    const def = BUILDINGS[b.type];
    if (!def.weapon || b.hp <= 0) continue;
    b.cooldown -= TICK;
    const cx = b.x + def.size / 2, cy = b.y + def.size / 2;
    let t = b.target != null ? targetOf(map, b.target) : null;
    if (!t || distTo(cx, cy, t) > def.range!) {
      const id = nearestHostile(state, map, b.faction, def.weapon, cx, cy, def.range!);
      b.target = id; t = id != null ? targetOf(map, id) : null;
    }
    if (!t) continue;
    b.facing = turn(b.facing, Math.atan2(t.y - cy, t.x - cx), 4 * TICK);
    if (b.cooldown <= 0) {
      fire(state, prov, b.faction, cx, cy, def.weapon, def.damage!, undefined, t);
      b.cooldown = def.rof! / powerInfo(state, map, b.faction).factor;
    }
  }
}

// ---------- Reparatur ----------
const REPAIR_RATE = 0.03;      // Anteil der Lebenspunkte pro Sekunde
const REPAIR_COST = 0.6;       // Anteil der Baukosten (Geld) für volle Instandsetzung
function updateRepairs(state: GameState, prov: ProvinceState) {
  for (const b of prov.map!.buildings) {
    if (!b.repairing || b.hp <= 0) continue;
    const def = BUILDINGS[b.type];
    const fac = state.factions[b.faction];
    const gain = Math.min(def.hp * REPAIR_RATE * TICK, def.hp - b.hp);
    const cost = gain * ((def.cost.geld ?? 0) / def.hp) * REPAIR_COST * (hasResearch(state, b.faction, 'befestigung') ? 0.5 : 1);
    if (fac.res.geld < cost) {
      b.repairing = false;
      if (b.faction === PLAYER) msg(state, `Reparatur von ${def.name} gestoppt: zu wenig Geld.`, 'warnung', prov.id);
      continue;
    }
    fac.res.geld -= cost;
    b.hp += gain;
    if (b.hp >= def.hp) { b.hp = def.hp; b.repairing = false; }
  }
}

function cleanup(state: GameState, prov: ProvinceState) {
  const map = prov.map!;
  if (map.units.some((u) => u.hp <= 0)) {
    for (const u of map.units) if (u.hp <= 0 && UNITS[u.type].armor !== 'infanterie') state.events.push({ kind: 'explosion', province: prov.id, x: u.x, y: u.y, unit: u.type, facing: u.facing });
    map.units = map.units.filter((u) => u.hp > 0);
  }
  if (map.buildings.some((b) => b.hp <= 0)) {
    for (const b of map.buildings) {
      if (b.hp > 0) continue;
      const s = BUILDINGS[b.type].size;
      state.events.push({ kind: 'explosion', province: prov.id, x: b.x + s / 2, y: b.y + s / 2, building: b.type });
      if (b.faction === PLAYER) msg(state, `${BUILDINGS[b.type].name} in ${provName(prov.id)} zerstört!`, 'alarm', prov.id);
    }
    map.buildings = map.buildings.filter((b) => b.hp > 0);
    map.version++;
  }
}

// ---------- Linienbau (Stacheldraht, Sperren, Gräben) ----------
/** Nächstes Feld der Linie bezahlen und in Bau geben; ungültige Felder werden übersprungen */
function startLinePiece(state: GameState, prov: ProvinceState, faction: string, q: Queues) {
  const line = q.line!;
  const def = BUILDINGS[line.type];
  while (line.tiles.length) {
    const [x, y] = line.tiles[0];
    if (!placementError(state, prov.id, faction, line.type, x, y)) break;
    line.tiles.shift();
  }
  if (!line.tiles.length) { q.line = null; return; }
  const fac = state.factions[faction];
  if (!canAfford(fac.res, def.cost)) {
    q.line = null;
    if (faction === PLAYER) msg(state, `Linie abgebrochen: nicht genug Rohstoffe (${provName(prov.id)}).`, 'warnung', prov.id);
    return;
  }
  pay(fac.res, def.cost);
  q.struct = { type: line.type, progress: 0, total: def.time, ready: false, auto: true };
}
/** Fertiges Feld setzen; sonst Kosten erstatten und mit dem nächsten Feld weitermachen */
function finishLinePiece(state: GameState, prov: ProvinceState, faction: string, q: Queues) {
  const map = prov.map!;
  const s = q.struct!;
  const [x, y] = q.line?.tiles[0] ?? [-1, -1];
  q.struct = null;
  if (!q.line) return;
  q.line.tiles.shift();
  if (placementError(state, prov.id, faction, s.type, x, y)) {
    pay(state.factions[faction].res, BUILDINGS[s.type].cost, -1);
    return;
  }
  placeBuilding(state, map, s.type, faction, x, y);
  state.events.push({ kind: 'sfx', sound: 'sfx.bauen', province: prov.id, faction, x: x + 0.5, y: y + 0.5 });
  if (!q.line.tiles.length) q.line = null;
}

// ---------- Truppenbewegungen zwischen Provinzen ----------
function updateTransits(state: GameState) {
  if (!state.transits.length) return;
  const arrived = state.transits.filter((t) => t.arrive <= state.time);
  if (!arrived.length) return;
  state.transits = state.transits.filter((t) => t.arrive > state.time);
  for (const t of arrived) {
    const prov = state.provinces[t.to];
    if (t.hostile && prov.owner !== NEUTRAL && !atWar(state, t.faction, prov.owner)) {
      // Inzwischen Frieden geschlossen: Truppen kehren um
      const src = state.provinces[t.from];
      if (src.owner === t.faction) {
        if (src.map) for (const su of t.units) { const [x, y] = findFreeTile(state, src.map, src.map.anchor[0], src.map.anchor[1] + 3, 12); spawnUnit(state, src.map, su.type, t.faction, x + 0.5, y + 0.5, { kind: 'idle' }, su.hp); }
        else src.garrison.push(...t.units.map((u) => u.type));
      }
      if (prov.owner === PLAYER) msg(state, `${factionName(t.faction)} hält sich an die Abmachung und zieht die Truppen vor ${provName(t.to)} zurück.`, 'gut', t.to);
      continue;
    }
    const map = ensureMap(state, t.to);
    const [ex, ey] = entryTile(state, t.to, t.from);
    if (t.faction !== NEUTRAL && prov.owner === NEUTRAL && t.hostile && !map.war.includes(t.faction)) map.war.push(t.faction);
    for (const su of t.units) {
      if (UNITS[su.type].domain === 'see') {
        // Schiffe laufen vom Kartenrand in Richtung der Herkunft ein
        const [px, py] = edgePoint(t.to, t.from);
        const wpos = findWater(map, px, py);
        if (wpos) spawnUnit(state, map, su.type, t.faction, wpos[0] + 0.5, wpos[1] + 0.5, t.hostile ? { kind: 'hunt' } : { kind: 'idle' }, su.hp);
        continue;
      }
      const [x, y] = findFreeTile(state, map, ex + Math.round((rand(state) - 0.5) * 4), ey + Math.round((rand(state) - 0.5) * 4), 10);
      spawnUnit(state, map, su.type, t.faction, x + 0.5, y + 0.5, t.hostile ? { kind: 'hunt' } : { kind: 'idle' }, su.hp);
    }
    if (t.faction === PLAYER) msg(state, `${t.units.length} Einheiten in ${provName(t.to)} eingetroffen.`, 'info', t.to);
    else if (prov.owner === PLAYER) msg(state, `${factionName(t.faction)} greift ${provName(t.to)} an!`, 'alarm', t.to);
  }
}

// ---------- Wirtschaft (jede Sekunde) ----------
function unitsNear(map: ProvinceMap, faction: string, x: number, y: number, r: number) {
  let hp = 0;
  for (const u of map.units) if (u.faction === faction && Math.hypot(u.x - x, u.y - y) <= r) hp += u.hp;
  return hp;
}

function economy(state: GameState) {
  for (const f of Object.values(state.factions)) f.income = { geld: 0, kohle: 0, eisen: 0, gold: 0 };
  const H = ECON.happiness;
  for (const prov of Object.values(state.provinces)) {
    const owner = prov.owner;
    const map = prov.map;
    const ownerFac = state.factions[owner];
    const verwaltung = map?.buildings.some((b) => b.faction === owner && b.type === 'verwaltung') ? BUILDINGS.verwaltung.incomeBonus! : 0;
    const D = ECON.diplomacy;
    for (const v of prov.villages) {
      v.plunderCooldown = Math.max(0, v.plunderCooldown - 1);
      const base = owner === NEUTRAL ? 'neutral' : v.origin === owner ? 'eigen' : 'besetzt';
      if (v.schutz === owner) v.schutz = null;
      let schutzActive = false;
      if (v.schutz && map && v.x >= 0) {
        const R = ECON.protectionRadius;
        const mine = unitsNear(map, v.schutz, v.x, v.y, R), theirs = unitsNear(map, owner, v.x, v.y, R);
        schutzActive = mine > 0 && mine > theirs * 1.5;
      }
      const garrison = map && v.x >= 0 && owner !== NEUTRAL ? unitsNear(map, owner, v.x, v.y, 10) > 0 : false;

      let target = H.base;
      if (base === 'eigen') target += ECON.taxLevels[ownerFac.tax].happiness;
      if (base === 'besetzt') target += H.occupied + (garrison ? H.garrison : 0);
      if (v.upgrades.includes('klinik')) target += ECON.villageUpgrades.klinik.happiness!;
      if (schutzActive) target += H.protection;
      target = Math.max(0, Math.min(100, target));
      v.happiness += Math.sign(target - v.happiness) * Math.min(Math.abs(target - v.happiness), 0.25);

      if (base === 'besetzt' && v.happiness < H.revoltBelow && !v.revolt) {
        v.revolt = true;
        if (owner === PLAYER) msg(state, `Aufstand in ${v.name} (${provName(prov.id)})! Keine Abgaben mehr.`, 'warnung', prov.id);
      }
      if (v.revolt && (v.happiness > H.revoltEndAbove || base !== 'besetzt')) v.revolt = false;

      const maxPop = v.basePop * ECON.maxPopFactor * (1 + (v.upgrades.includes('wohnblock') ? ECON.villageUpgrades.wohnblock.maxPopBonus! : 0));
      const g = ECON.growthPerMin / 60;
      if (v.happiness >= 50) v.pop = Math.min(maxPop, v.pop * (1 + g));
      else if (v.happiness < 30) v.pop = Math.max(v.basePop * 0.2, v.pop * (1 - g));

      let mult = (0.5 + v.happiness / 100) * (1 + (v.upgrades.includes('markt') ? ECON.villageUpgrades.markt.incomeBonus! : 0));
      let rate = 0, receiver: string | null = null;
      if (schutzActive) { rate = ECON.protectionRate; receiver = v.schutz; }
      else if (v.revolt) rate = 0;
      else if (base === 'eigen') { rate = ECON.taxLevels[ownerFac.tax].rate; receiver = owner; mult *= 1 + verwaltung; }
      else if (base === 'besetzt') { rate = ECON.occupationRate; receiver = owner; mult *= 1 + verwaltung; }
      let perMin = v.pop * rate * mult;
      if (receiver && hasResearch(state, receiver, 'verwaltung')) perMin *= 1.15;
      if (receiver && alliesOf(state, receiver).length) perMin *= 1 + D.allianceIncomeBonus * alliesOf(state, receiver).length;
      if (receiver && FACTIONS[receiver].ai) perMin *= ECON.ai.incomeFactor;
      v.income = receiver ? perMin : 0;
      if (receiver) {
        state.factions[receiver].res.geld += perMin / 60;
        state.factions[receiver].income.geld += perMin;
      }
      v.status = v.revolt ? 'aufstand' : v.schutz ? (schutzActive ? 'schutz' : 'schutz-pausiert') : base;
    }

    // Bergwerke und Kraftwerke
    if (!map) continue;
    const factions = new Set(map.buildings.map((b) => b.faction));
    for (const f of factions) {
      const fac = state.factions[f];
      const pf = powerInfo(state, map, f).factor;
      for (const b of map.buildings) {
        if (b.faction !== f) continue;
        const def = BUILDINGS[b.type];
        if (def.coalPerMin && f === PLAYER) {
          const use = def.coalPerMin * (hasResearch(state, f, 'kraftwerk') ? 0.5 : 1);
          fac.res.kohle = Math.max(0, fac.res.kohle - use / 60);
          fac.income.kohle -= use;
        }
        if (!def.produces) continue;
        const want = DEPOSIT_KEYS.indexOf(def.deposit!);
        let cover = 0;
        for (let y = b.y; y < b.y + def.size; y++) for (let x = b.x; x < b.x + def.size; x++) if (map.deposit[y * map.w + x] === want) cover++;
        const eff = Math.min(1, cover / (def.size * def.size) + 0.25) * pf * (FACTIONS[f].ai ? ECON.ai.incomeFactor : 1) * (hasResearch(state, f, 'bergbau') ? 1.3 : 1);
        for (const k of RES_KEYS) {
          const amount = (def.produces[k] ?? 0) * eff;
          fac.res[k] += amount / 60;
          fac.income[k] += amount;
        }
      }
    }
  }
}

// ---------- Eroberung ----------
function checkCapture(state: GameState, prov: ProvinceState) {
  const map = prov.map!;
  const owner = prov.owner;
  // Nur Bodentruppen halten oder erobern eine Provinz
  if (map.units.some((u) => u.faction === owner && !isAir(u) && !isNaval(u)) || map.buildings.some((b) => b.faction === owner)) return;
  const counts: Record<string, number> = {};
  for (const u of map.units) {
    if (u.faction === NEUTRAL || isAir(u) || isNaval(u) || (owner !== NEUTRAL && !atWar(state, u.faction, owner))) continue;
    counts[u.faction] = (counts[u.faction] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (!best) return;
  const newOwner = best[0];
  prov.owner = newOwner;
  delete map.queues[owner];
  for (const v of prov.villages) if (v.schutz === newOwner) v.schutz = null;
  const name = provName(prov.id);
  if (newOwner === PLAYER && isMajorAi(owner)) changeHaltung(state, owner, -ECON.diplomacy.conquestPenalty);
  if (newOwner === PLAYER) msg(state, `${name} erobert! Die Dörfer zahlen dir nun Besatzungsabgaben.`, 'gut', prov.id);
  else if (owner === PLAYER) msg(state, `${name} an ${factionName(newOwner)} verloren!`, 'alarm', prov.id);
  else msg(state, `${factionName(newOwner)} hat ${name} erobert.`, 'info', prov.id);
}

// ---------- Computergegner (strategisch) ----------
function ai(state: GameState) {
  const A = ECON.ai;
  const provs = Object.values(state.provinces);
  for (const [fid, fac] of Object.entries(state.factions)) {
    if (!FACTIONS[fid].ai || fid === NEUTRAL || !fac.alive) continue;
    const own = provs.filter((p) => p.owner === fid);
    if (!own.length) continue;
    const level = Math.min(5, 1 + Math.floor(state.time / 300));

    // KI forscht in festen Abständen (vereinfacht, ohne Kosten)
    if (state.time >= (fac.nextResearch ?? Infinity)) {
      fac.nextResearch = state.time + ECON.diplomacy.aiResearchEvery * (0.8 + rand(state) * 0.4);
      const open = Object.keys(RESEARCH).filter((r) => !fac.research.done.includes(r) && (!RESEARCH[r].requires || fac.research.done.includes(RESEARCH[r].requires!)));
      if (open.length) fac.research.done.push(open[Math.floor(rand(state) * open.length)]);
    }

    if (state.time >= fac.nextReinforce) {
      fac.nextReinforce = state.time + A.reinforceEvery * (0.8 + rand(state) * 0.4);
      const border = own.filter((p) => GEO.provinces[p.id].neighbors.some((n) => state.provinces[n.id].owner !== fid));
      const pool = border.length ? border : own;
      const p = pool[Math.floor(rand(state) * pool.length)];
      const size = p.map ? p.map.units.filter((u) => u.faction === fid).length : p.garrison.length;
      const type = pickAiUnit(state, level, fid);
      const cost = UNITS[type].cost.geld ?? 0;
      if (size < A.maxGarrison && fac.res.geld >= cost) {
        fac.res.geld -= cost;
        if (p.map) {
          const hq = p.map.buildings.find((b) => b.faction === fid && b.type === 'bauhof');
          const [cx, cy] = hq ? [hq.x + 1, hq.y + 4] : p.map.anchor;
          const [x, y] = findFreeTile(state, p.map, cx, cy, 10);
          spawnUnit(state, p.map, type, fid, x + 0.5, y + 0.5);
        } else p.garrison.push(type);
      }
    }

    if (state.time >= fac.nextAttack) {
      fac.nextAttack = state.time + A.attackIntervalMin + rand(state) * (A.attackIntervalMax - A.attackIntervalMin);
      const options: [ProvinceState, string, number][] = [];
      for (const p of own) for (const n of GEO.provinces[p.id].neighbors) {
        const t = state.provinces[n.id];
        if (t.owner === fid || (t.owner !== NEUTRAL && !atWar(state, fid, t.owner))) continue;
        const w = t.owner === PLAYER ? 3 : t.owner === NEUTRAL ? 2 : 0.7;
        options.push([p, n.id, w]);
      }
      if (!options.length) continue;
      let r = rand(state) * options.reduce((s, o) => s + o[2], 0);
      let pick = options[0];
      for (const o of options) { if ((r -= o[2]) <= 0) { pick = o; break; } }
      const [src, to] = pick;
      let budget = Math.min(fac.res.geld, 1500 + state.time * 1.5);
      const units: { type: string; hp: number }[] = [];
      for (let i = 0; i < 40 && units.length < 14; i++) {
        const type = pickAiUnit(state, level, fid);
        const cost = UNITS[type].cost.geld ?? 0;
        if (cost > budget) continue;
        budget -= cost; fac.res.geld -= cost;
        units.push({ type, hp: UNITS[type].hp });
      }
      if (units.length < 3) { fac.res.geld += units.reduce((s, u) => s + (UNITS[u.type].cost.geld ?? 0), 0); continue; }
      state.transits.push({ faction: fid, from: src.id, to, units, arrive: state.time + A.warningTime, hostile: true });
      if (state.provinces[to].owner === PLAYER) {
        msg(state, `${factionName(fid)} marschiert mit ${units.length} Einheiten von ${provName(src.id)} auf ${provName(to)}! Ankunft in ${A.warningTime} s.`, 'alarm', to);
      }
    }
  }
}

// ---------- Forschung ----------
function updateResearch(state: GameState) {
  for (const [fid, fac] of Object.entries(state.factions)) {
    const cur = fac.research?.current;
    if (!cur) continue;
    if (!hasLab(state, fid)) continue; // ohne Forschungszentrum ruht die Forschung
    cur.progress += TICK;
    if (cur.progress >= cur.total) {
      fac.research.done.push(cur.type);
      fac.research.current = null;
      if (fid === PLAYER) msg(state, `Forschung abgeschlossen: ${RESEARCH[cur.type].name}. ${RESEARCH[cur.type].desc}`, 'gut', undefined, 'ui.forschung');
    }
  }
}

// ---------- Diplomatie (jede Sekunde) ----------
function diplomacy(state: GameState) {
  const D = ECON.diplomacy;
  for (const [fid, d] of Object.entries(state.diplomacy ?? {})) {
    if (!state.factions[fid].alive) continue;
    // Haltung bewegt sich langsam (3 Punkte/min) zur Grundhaltung
    const base = baseHaltung(state, fid);
    d.haltung += Math.sign(base - d.haltung) * Math.min(Math.abs(base - d.haltung), 0.05);
    if (d.rel !== 'krieg' && d.haltung < D.cancelBelow) {
      d.rel = 'krieg'; d.since = state.time;
      state.factions[fid].nextAttack = Math.min(state.factions[fid].nextAttack, state.time + 90);
      msg(state, `${factionName(fid)} kündigt den Vertrag – wieder Krieg! (Haltung zu schlecht, ${provinceCount(state, PLAYER)} gegen ${provinceCount(state, fid)} Provinzen)`, 'alarm');
    }
  }
}

function checkOutcome(state: GameState) {
  const owners = new Set(Object.values(state.provinces).map((p) => p.owner));
  for (const [fid, fac] of Object.entries(state.factions)) {
    if (fid === NEUTRAL || !fac.alive) continue;
    if (!owners.has(fid) && !state.transits.some((t) => t.faction === fid)) {
      fac.alive = false;
      if (fid !== PLAYER) msg(state, `${factionName(fid)} wurde besiegt!`, 'gut');
    }
  }
  if (!state.factions[PLAYER].alive) { state.outcome = 'niederlage'; msg(state, 'Dein Reich ist gefallen.', 'alarm'); return; }
  const enemiesLeft = Object.entries(state.factions).some(([fid, f]) => fid !== PLAYER && fid !== NEUTRAL && f.alive && atWar(state, PLAYER, fid));
  if (!enemiesLeft) {
    state.outcome = 'sieg';
    const allied = Object.entries(state.factions).some(([fid, f]) => fid !== PLAYER && fid !== NEUTRAL && f.alive);
    msg(state, allied ? 'Europa ist geeint: Alle verbliebenen Mächte sind mit dir verbündet oder besiegt!' : 'Alle gegnerischen Mächte sind besiegt – Europa gehört dir!', 'gut');
  }
}
