// Spielerbefehle. Alles, was ein Spieler tut, läuft als Befehl durch die Simulation –
// so kann später jeder Rechner im Mehrspieler dieselben Befehle ausführen.
import { BUILDINGS, ECON, GEO, NEUTRAL, PLAYER, RESEARCH, RES_KEYS, UNITS, type Cost } from './defs';
import { atWar, ceasefireWillingness, changeHaltung, isMajorAi, missingResearch, researchBlocked } from './diplomacy';
import type { FactoryKind, GameState, Resources, Unit } from './types';
import {
  buildRequirementError, factionName, seaAccess, placeBuilding, placementError, provName, queuesOf,
} from './world';

export type Command =
  | { type: 'build'; faction: string; province: string; building: string }
  | { type: 'cancelBuild'; faction: string; province: string }
  | { type: 'buildLine'; faction: string; province: string; building: string; tiles: [number, number][] }
  | { type: 'place'; faction: string; province: string; x: number; y: number }
  | { type: 'train'; faction: string; province: string; unit: string }
  | { type: 'cancelTrain'; faction: string; province: string; unit: string }
  | { type: 'move'; faction: string; province: string; ids: number[]; x: number; y: number; attackMove?: boolean }
  | { type: 'attack'; faction: string; province: string; ids: number[]; target: number }
  | { type: 'stop'; faction: string; province: string; ids: number[] }
  | { type: 'sell'; faction: string; province: string; building: number }
  | { type: 'repair'; faction: string; province: string; building: number; on: boolean }
  | { type: 'rally'; faction: string; province: string; building: number; x: number; y: number }
  | { type: 'transfer'; faction: string; province: string; ids: number[]; to: string }
  | { type: 'setTax'; faction: string; level: number }
  | { type: 'research'; faction: string; id: string }
  | { type: 'cancelResearch'; faction: string }
  | { type: 'diplomacy'; faction: string; target: string; action: 'waffenstillstand' | 'buendnis' | 'geschenk' | 'krieg' }
  | { type: 'schutz'; faction: string; province: string; village: string; on: boolean }
  | { type: 'plunder'; faction: string; province: string; village: string }
  | { type: 'villageUpgrade'; faction: string; province: string; village: string; upgrade: string };

export function canAfford(res: Resources, cost: Cost) {
  return RES_KEYS.every((k) => (res[k] ?? 0) >= (cost[k] ?? 0));
}
export function pay(res: Resources, cost: Cost, factor = 1) {
  for (const k of RES_KEYS) res[k] -= (cost[k] ?? 0) * factor;
}
function msg(state: GameState, faction: string, text: string, level: 'info' | 'gut' | 'warnung' | 'alarm' = 'info', target?: string) {
  if (faction === 'spieler') state.events.push({ kind: 'msg', text, level, target });
}

export function applyCommand(state: GameState, c: Command) {
  const fac = state.factions[c.faction];
  if (!fac || state.outcome) return;
  if (c.type === 'setTax') { fac.tax = Math.max(0, Math.min(ECON.taxLevels.length - 1, c.level)); return; }
  if (c.type === 'research') {
    const def = RESEARCH[c.id];
    if (!def) return;
    if (fac.research.current) return msg(state, c.faction, 'Es wird bereits geforscht.', 'warnung');
    const err = researchBlocked(state, c.faction, c.id);
    if (err) return msg(state, c.faction, err, 'warnung');
    if (!canAfford(fac.res, def.cost)) return msg(state, c.faction, 'Nicht genug Rohstoffe.', 'warnung');
    pay(fac.res, def.cost);
    fac.research.current = { type: c.id, progress: 0, total: def.time };
    return;
  }
  if (c.type === 'cancelResearch') {
    const cur = fac.research.current;
    if (!cur) return;
    pay(fac.res, RESEARCH[cur.type].cost, -1);
    fac.research.current = null;
    return;
  }
  if (c.type === 'diplomacy') return applyDiplomacy(state, c.faction, c.target, c.action);
  const prov = state.provinces[c.province];
  if (!prov) return;
  const map = prov.map;

  switch (c.type) {
    case 'build': {
      if (!map || !BUILDINGS[c.building]) return;
      const q = queuesOf(map, c.faction);
      if (q.struct) return msg(state, c.faction, 'Es wird bereits ein Gebäude gebaut.', 'warnung');
      const err = buildRequirementError(state, map, c.faction, c.building) ?? missingResearch(state, c.faction, BUILDINGS[c.building].research);
      if (err) return msg(state, c.faction, err, 'warnung');
      const def = BUILDINGS[c.building];
      if (!canAfford(fac.res, def.cost)) return msg(state, c.faction, 'Nicht genug Rohstoffe.', 'warnung');
      pay(fac.res, def.cost);
      q.struct = { type: c.building, progress: 0, total: def.time, ready: false };
      return;
    }
    case 'cancelBuild': {
      if (!map) return;
      const q = queuesOf(map, c.faction);
      q.line = null;
      if (!q.struct) return;
      pay(fac.res, BUILDINGS[q.struct.type].cost, -1);
      q.struct = null;
      return;
    }
    case 'buildLine': {
      if (!map || !BUILDINGS[c.building]?.wall) return;
      const q = queuesOf(map, c.faction);
      if (q.struct && !q.struct.auto) return msg(state, c.faction, 'Es wird bereits ein Gebäude gebaut.', 'warnung');
      const err = buildRequirementError(state, map, c.faction, c.building) ?? missingResearch(state, c.faction, BUILDINGS[c.building].research);
      if (err) return msg(state, c.faction, err, 'warnung');
      if (!canAfford(fac.res, BUILDINGS[c.building].cost)) return msg(state, c.faction, 'Nicht genug Rohstoffe.', 'warnung');
      q.line = { type: c.building, tiles: c.tiles.slice(0, 60) };
      return;
    }
    case 'place': {
      if (!map) return;
      const q = queuesOf(map, c.faction);
      if (!q.struct?.ready) return;
      const err = placementError(state, c.province, c.faction, q.struct.type, c.x, c.y);
      if (err) return msg(state, c.faction, err, 'warnung');
      placeBuilding(state, map, q.struct.type, c.faction, c.x, c.y);
      state.events.push({ kind: 'sfx', sound: 'sfx.bauen', province: c.province, faction: c.faction, x: c.x + 1, y: c.y + 1 });
      q.struct = null;
      return;
    }
    case 'train': {
      const def = UNITS[c.unit];
      if (!map || !def || def.from === 'none') return;
      if (!map.buildings.some((b) => b.faction === c.faction && b.type === def.from)) {
        return msg(state, c.faction, `Benötigt ${BUILDINGS[def.from].name} in dieser Provinz.`, 'warnung');
      }
      const rerr = missingResearch(state, c.faction, def.research);
      if (rerr) return msg(state, c.faction, rerr, 'warnung');
      const list = queuesOf(map, c.faction)[def.from as FactoryKind];
      if (list.length >= 8) return msg(state, c.faction, 'Warteschlange voll.', 'warnung');
      if (!canAfford(fac.res, def.cost)) return msg(state, c.faction, 'Nicht genug Rohstoffe.', 'warnung');
      pay(fac.res, def.cost);
      list.push({ type: c.unit, progress: 0, total: def.time });
      return;
    }
    case 'cancelTrain': {
      const def = UNITS[c.unit];
      if (!map || !def) return;
      const list = queuesOf(map, c.faction)[def.from as FactoryKind];
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].type === c.unit) { list.splice(i, 1); pay(fac.res, def.cost, -1); return; }
      }
      return;
    }
    case 'move': {
      if (!map) return;
      const units = ownUnits(map.units, c.faction, c.ids);
      // In Formation verteilen
      const n = units.length;
      const cols = Math.ceil(Math.sqrt(n));
      units.forEach((u, i) => {
        const ox = (i % cols) - (cols - 1) / 2, oy = Math.floor(i / cols) - (Math.ceil(n / cols) - 1) / 2;
        const x = c.x + ox * 0.9, y = c.y + oy * 0.9;
        u.order = c.attackMove ? { kind: 'attackMove', x, y } : { kind: 'move', x, y };
        u.target = null; u.path = null;
      });
      return;
    }
    case 'attack': {
      if (!map) return;
      const tu = map.units.find((u) => u.id === c.target);
      const tb = map.buildings.find((b) => b.id === c.target);
      const tf = tu?.faction ?? tb?.faction;
      if (!tf || tf === c.faction) return;
      if (tf !== NEUTRAL && !atWar(state, c.faction, tf)) breakTreaty(state, c.faction, tf);
      if (tf === NEUTRAL && !map.war.includes(c.faction)) {
        map.war.push(c.faction);
        msg(state, c.faction, `Die Miliz in ${provName(c.province)} betrachtet dich jetzt als Feind.`, 'warnung');
      }
      for (const u of ownUnits(map.units, c.faction, c.ids)) { u.order = { kind: 'attack', target: c.target }; u.target = c.target; u.path = null; }
      return;
    }
    case 'stop': {
      if (!map) return;
      for (const u of ownUnits(map.units, c.faction, c.ids)) { u.order = { kind: 'idle' }; u.target = null; u.path = null; }
      return;
    }
    case 'repair': {
      const b = map?.buildings.find((x) => x.id === c.building && x.faction === c.faction);
      if (!b) return;
      b.repairing = c.on && b.hp < BUILDINGS[b.type].hp;
      return;
    }
    case 'rally': {
      const b = map?.buildings.find((x) => x.id === c.building && x.faction === c.faction);
      if (!b || (b.type !== 'kaserne' && b.type !== 'panzerfabrik')) return;
      b.rally = [Math.max(0.5, Math.min(map!.w - 0.5, c.x)), Math.max(0.5, Math.min(map!.h - 0.5, c.y))];
      return;
    }
    case 'sell': {
      if (!map) return;
      const i = map.buildings.findIndex((b) => b.id === c.building && b.faction === c.faction);
      if (i < 0) return;
      const b = map.buildings[i];
      const def = BUILDINGS[b.type];
      pay(fac.res, def.cost, -ECON.sellRefund * (b.hp / def.hp));
      map.buildings.splice(i, 1);
      map.version++;
      state.events.push({ kind: 'explosion', province: c.province, x: b.x + def.size / 2, y: b.y + def.size / 2 });
      return;
    }
    case 'transfer': {
      if (!map) return;
      const link = GEO.provinces[c.province].neighbors.find((n) => n.id === c.to);
      if (!link) return;
      let units = ownUnits(map.units, c.faction, c.ids);
      // Schiffe nur zwischen Provinzen mit Meerzugang
      const ships = units.filter((u) => UNITS[u.type].domain === 'see');
      if (ships.length && !(seaAccess(c.province) && seaAccess(c.to))) {
        units = units.filter((u) => UNITS[u.type].domain !== 'see');
        msg(state, c.faction, `${ships.length} Schiff(e) bleiben zurück: ${provName(c.to)} hat keinen Zugang zum Meer.`, 'warnung');
      }
      if (!units.length) return;
      const set = new Set(units.map((u) => u.id));
      map.units = map.units.filter((u) => !set.has(u.id));
      state.transits.push({
        faction: c.faction, from: c.province, to: c.to, hostile: false,
        units: units.map((u) => ({ type: u.type, hp: u.hp })),
        arrive: state.time + travelTime(map, c.faction, link.see),
      });
      msg(state, c.faction, `${units.length} Einheiten unterwegs nach ${provName(c.to)}${link.see ? ' (über See)' : ''}.`);
      return;
    }
    case 'schutz': {
      const v = prov.villages.find((x) => x.id === c.village);
      if (!v || prov.owner === c.faction) return;
      if (c.on && prov.owner !== NEUTRAL && !atWar(state, c.faction, prov.owner)) {
        return msg(state, c.faction, `Mit ${factionName(prov.owner)} besteht ein Vertrag – erst den Krieg erklären.`, 'warnung');
      }
      if (c.on && v.schutz && v.schutz !== c.faction) return msg(state, c.faction, `${v.name} zahlt bereits an ${factionName(v.schutz)}.`, 'warnung');
      v.schutz = c.on ? c.faction : null;
      if (c.on) msg(state, c.faction, `${v.name} wird zur Zahlung von Schutzgebühr aufgefordert. Halte Truppen in der Nähe!`);
      return;
    }
    case 'plunder': {
      const v = prov.villages.find((x) => x.id === c.village);
      if (!v || !map || prov.owner === c.faction) return;
      if (prov.owner !== NEUTRAL && !atWar(state, c.faction, prov.owner)) {
        return msg(state, c.faction, `Mit ${factionName(prov.owner)} besteht ein Vertrag – erst den Krieg erklären.`, 'warnung');
      }
      if (v.plunderCooldown > 0) return msg(state, c.faction, `${v.name} wurde gerade erst geplündert.`, 'warnung');
      const R = ECON.plunder.radius;
      const near = map.units.some((u) => u.faction === c.faction && Math.hypot(u.x - v.x, u.y - v.y) <= R);
      if (!near) return msg(state, c.faction, `Keine eigenen Truppen bei ${v.name} (max. ${R} Felder).`, 'warnung');
      const geld = Math.round(v.pop * ECON.plunder.geldPerPop);
      const gold = Math.round(v.pop * ECON.plunder.goldPerPop);
      fac.res.geld += geld; fac.res.gold += gold;
      v.pop = Math.max(50, v.pop * (1 - ECON.plunder.popLoss));
      v.happiness = 0;
      v.plunderCooldown = ECON.plunder.cooldown;
      if (v.schutz === c.faction) v.schutz = null;
      if (prov.owner === NEUTRAL && !map.war.includes(c.faction)) map.war.push(c.faction);
      msg(state, c.faction, `${v.name} geplündert: +${geld} T, +${gold} Gold.`, 'gut');
      return;
    }
    case 'villageUpgrade': {
      const v = prov.villages.find((x) => x.id === c.village);
      const def = ECON.villageUpgrades[c.upgrade];
      if (!v || !def || prov.owner !== c.faction || v.upgrades.includes(c.upgrade)) return;
      if (!canAfford(fac.res, def.cost)) return msg(state, c.faction, 'Nicht genug Rohstoffe.', 'warnung');
      pay(fac.res, def.cost);
      v.upgrades.push(c.upgrade);
      msg(state, c.faction, `${def.name} in ${v.name} errichtet.`, 'gut');
      return;
    }
  }
}

// ---------- Diplomatie ----------
function breakTreaty(state: GameState, faction: string, other: string) {
  const ai = faction === PLAYER ? other : faction;
  const d = state.diplomacy[ai];
  if (!d || d.rel === 'krieg') return;
  d.rel = 'krieg'; d.since = state.time;
  changeHaltung(state, ai, -ECON.diplomacy.warDeclarationPenalty);
  for (const other2 of Object.keys(state.diplomacy)) if (other2 !== ai) changeHaltung(state, other2, -ECON.diplomacy.breakTrustPenalty);
  msg(state, PLAYER, `Vertragsbruch: Krieg mit ${factionName(ai)}! Auch die anderen Mächte trauen dir weniger.`, 'alarm');
}

function applyDiplomacy(state: GameState, faction: string, target: string, action: 'waffenstillstand' | 'buendnis' | 'geschenk' | 'krieg') {
  if (faction !== PLAYER || !isMajorAi(target) || !state.factions[target].alive) return;
  const D = ECON.diplomacy;
  const d = state.diplomacy[target];
  const name = factionName(target);
  const fac = state.factions[faction];
  switch (action) {
    case 'geschenk': {
      if (fac.res.geld < D.giftAmount) return msg(state, faction, 'Nicht genug Geld für ein Geschenk.', 'warnung');
      fac.res.geld -= D.giftAmount;
      state.factions[target].res.geld += D.giftAmount;
      changeHaltung(state, target, D.giftHaltung);
      return msg(state, faction, `${name} nimmt das Geschenk an. Haltung jetzt ${Math.round(d.haltung)}.`, 'gut');
    }
    case 'krieg': {
      if (d.rel === 'krieg') return;
      return breakTreaty(state, faction, target);
    }
    case 'waffenstillstand': {
      if (d.rel !== 'krieg') return;
      const w = ceasefireWillingness(state, target);
      if (w >= D.ceasefireNeeds) {
        d.rel = 'waffenstillstand'; d.since = state.time;
        return msg(state, faction, `${name} willigt in einen Waffenstillstand ein. Keine Angriffe mehr – solange die Haltung nicht unter ${D.cancelBelow} fällt.`, 'gut');
      }
      return msg(state, faction, `${name} lehnt ab (Bereitschaft ${Math.round(w)}, nötig ${D.ceasefireNeeds}). Geschenke oder militärischer Druck könnten helfen.`, 'warnung');
    }
    case 'buendnis': {
      if (d.rel !== 'waffenstillstand') return msg(state, faction, 'Ein Bündnis setzt einen Waffenstillstand voraus.', 'warnung');
      const wait = d.since + D.allianceAfter - state.time;
      if (wait > 0) return msg(state, faction, `${name} will den Waffenstillstand erst noch ${Math.ceil(wait)} s erproben.`, 'warnung');
      if (d.haltung < D.allianceNeeds) return msg(state, faction, `${name} lehnt ein Bündnis ab (Haltung ${Math.round(d.haltung)}, nötig ${D.allianceNeeds}).`, 'warnung');
      d.rel = 'buendnis'; d.since = state.time;
      return msg(state, faction, `Bündnis mit ${name}! Gemeinsame Sicht und +${Math.round(D.allianceIncomeBonus * 100)} % Handelseinnahmen.`, 'gut');
    }
  }
}
/** Reisedauer; eine eigene Werft halbiert Seeüberfahrten */
export function travelTime(map: { buildings: { faction: string; type: string }[] } | null, faction: string, see: boolean) {
  if (!see) return ECON.travelTime.land;
  const werft = map?.buildings.some((b) => b.faction === faction && b.type === 'werft');
  return ECON.travelTime.see / (werft ? 2 : 1);
}

function ownUnits(units: Unit[], faction: string, ids: number[]) {
  const set = new Set(ids);
  return units.filter((u) => u.faction === faction && set.has(u.id));
}
