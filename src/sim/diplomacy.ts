// Forschung und Diplomatie: Abfragen und Regeln, die von Simulation, Befehlen und Oberfläche genutzt werden
import { ECON, FACTIONS, NEUTRAL, PLAYER, RESEARCH } from './defs';
import type { DiplomacyState, GameState, Relation } from './types';

// ---------- Forschung ----------
export function hasResearch(state: GameState, faction: string, id: string): boolean {
  return state.factions[faction]?.research?.done.includes(id) ?? false;
}
/** Grund, warum eine Forschung (noch) nicht möglich ist, sonst null */
export function researchBlocked(state: GameState, faction: string, id: string): string | null {
  const def = RESEARCH[id];
  if (!def) return 'Unbekannt';
  if (hasResearch(state, faction, id)) return 'Erforscht';
  if (def.requires && !hasResearch(state, faction, def.requires)) return `Benötigt ${RESEARCH[def.requires].name}`;
  if (!hasLab(state, faction)) return 'Benötigt Forschungszentrum';
  return null;
}
export function hasLab(state: GameState, faction: string): boolean {
  return Object.values(state.provinces).some((p) => p.map?.buildings.some((b) => b.faction === faction && b.type === 'forschungszentrum'));
}
/** Fehlende Forschung für eine Einheit/ein Gebäude als Text, sonst null */
export function missingResearch(state: GameState, faction: string, research?: string): string | null {
  if (!research || hasResearch(state, faction, research)) return null;
  return `Benötigt Forschung „${RESEARCH[research].name}“`;
}

// ---------- Diplomatie ----------
export const RELATION_NAMES: Record<Relation, string> = { krieg: 'Krieg', waffenstillstand: 'Waffenstillstand', buendnis: 'Bündnis' };

/** Diplomatischer Zustand zwischen Spieler und einer KI-Macht (null, wenn nicht zutreffend) */
export function diploOf(state: GameState, a: string, b: string): DiplomacyState | null {
  const other = a === PLAYER ? b : b === PLAYER ? a : null;
  if (!other || other === PLAYER || other === NEUTRAL) return null;
  return state.diplomacy?.[other] ?? null;
}
/** Beziehung zweier Mächte. KI untereinander und die Miliz sind immer im Kriegszustand (Miliz: siehe map.war). */
export function relation(state: GameState, a: string, b: string): Relation {
  if (a === b) return 'buendnis';
  return diploOf(state, a, b)?.rel ?? 'krieg';
}
export function atWar(state: GameState, a: string, b: string) { return relation(state, a, b) === 'krieg'; }

/** Verbündete einer Fraktion (für geteilte Sicht) */
export function alliesOf(state: GameState, faction: string): string[] {
  if (faction === PLAYER) return Object.entries(state.diplomacy ?? {}).filter(([, d]) => d.rel === 'buendnis').map(([f]) => f);
  return state.diplomacy?.[faction]?.rel === 'buendnis' ? [PLAYER] : [];
}

export function provinceCount(state: GameState, faction: string) {
  return Object.values(state.provinces).filter((p) => p.owner === faction).length;
}
/** Bereitschaft einer KI-Macht zum Waffenstillstand: schwächere Mächte sind eher bereit */
export function ceasefireWillingness(state: GameState, faction: string) {
  const d = state.diplomacy[faction];
  return d.haltung + ECON.diplomacy.perProvinceDiff * (provinceCount(state, PLAYER) - provinceCount(state, faction));
}
/** Grundhaltung, zu der sich die Haltung langsam hinbewegt */
export function baseHaltung(state: GameState, faction: string) {
  const d = state.diplomacy[faction];
  const diff = Math.max(0, provinceCount(state, PLAYER) - provinceCount(state, faction));
  return -3 * diff + (d.rel === 'buendnis' ? 25 : d.rel === 'waffenstillstand' ? 10 : 0);
}
export function changeHaltung(state: GameState, faction: string, delta: number) {
  const d = state.diplomacy?.[faction];
  if (!d) return;
  d.haltung = Math.max(-100, Math.min(100, d.haltung + delta));
}
export function isMajorAi(faction: string) { return faction !== PLAYER && faction !== NEUTRAL && FACTIONS[faction]?.ai; }
