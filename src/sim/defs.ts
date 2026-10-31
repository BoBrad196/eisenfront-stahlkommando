// Typisierter Zugriff auf die Spieldaten in data/
import unitsJson from '../../data/units.json';
import buildingsJson from '../../data/buildings.json';
import economyJson from '../../data/economy.json';
import factionsJson from '../../data/factions.json';
import provincesJson from '../../data/map/provinces.json';
import europeJson from '../../data/map/europe.json';
import researchJson from '../../data/research.json';

export type ResKey = 'geld' | 'kohle' | 'eisen' | 'gold';
export const RES_KEYS: ResKey[] = ['geld', 'kohle', 'eisen', 'gold'];
export type Cost = Partial<Record<ResKey, number>>;
export type Armor = 'infanterie' | 'leicht' | 'schwer' | 'luft' | 'gebaeude';

export interface UnitDef {
  name: string; armor: Armor; hp: number; sight: number; speed: number; range: number; damage: number; rof: number;
  weapon: string; splash?: number; minRange?: number; cost: Cost; time: number; from: string; sprite: string; research?: string;
  domain?: 'see'; // Schiff
  turret?: boolean; // Turm dreht unabhängig von der Wanne
}
export interface BuildingDef {
  name: string; size: number; hp: number; power: number; sight: number; cost: Cost; time: number; sprite: string;
  requires?: string; deposit?: 'kohle' | 'eisen' | 'gold'; produces?: Cost; coalPerMin?: number;
  incomeBonus?: number; weapon?: string; range?: number; damage?: number; rof?: number; desc: string; research?: string;
  coastal?: boolean;
  /** Linienbau: Gebäude lässt sich als Reihe ziehen (Stacheldraht, Sperren, Gräben) */
  wall?: boolean;
  /** Wen das Gebäude aufhält (Standard: beide) */
  blocks?: { inf: boolean; tank: boolean };
  /** Schaden je Sekunde, den Panzer beim Überfahren nehmen (Stacheldraht reißt) */
  crossDamage?: number;
  /** Geschwindigkeitsfaktor für Panzer auf dem Feld (Schützengraben, Trichter) */
  slow?: number;
}
export interface ResearchDef { name: string; desc: string; cost: Cost; time: number; requires?: string }
export interface FactionDef { name: string; color: string; ai: boolean }
export interface ProvinceDef {
  id: string; name: string; lon: number; lat: number; owner: string;
  terrain: 'flach' | 'huegel' | 'berge' | 'wald' | 'kueste'; defense: number;
  deposits: Record<'kohle' | 'eisen' | 'gold', number>; villages: [string, number][];
}
export interface ProvinceGeo {
  poly: number[][][][]; center: [number, number]; neighbors: { id: string; see: boolean }[];
  coast: { frac: number; sectors: number[] } | null; // Küstenanteil und Küste je Himmelsrichtung (0 = Osten, im Uhrzeigersinn)
}
export interface VillageUpgradeDef { name: string; cost: Cost; desc: string; incomeBonus?: number; maxPopBonus?: number; happiness?: number }

export const UNITS = unitsJson.units as Record<string, UnitDef>;
export const WEAPONS = unitsJson.weapons as Record<string, Record<Armor, number>>;
export const BUILDINGS = buildingsJson.buildings as Record<string, BuildingDef>;
export const ECON = economyJson as typeof economyJson & { villageUpgrades: Record<string, VillageUpgradeDef> };
export const FACTIONS = factionsJson.factions as Record<string, FactionDef>;
export const PROVINCES = provincesJson.provinces as ProvinceDef[];
export const PROVINCE_BY_ID: Record<string, ProvinceDef> = Object.fromEntries(PROVINCES.map((p) => [p.id, p]));
export const GEO = europeJson as unknown as { width: number; height: number; backdrop: number[][][][]; provinces: Record<string, ProvinceGeo> };

export const RESEARCH = researchJson.research as Record<string, ResearchDef>;

export const PLAYER = 'spieler';
export const NEUTRAL = 'neutral';
export const TICK = 0.05; // Sekunden pro Simulationsschritt (20 Hz)

export function costText(c: Cost): string {
  const n: Record<ResKey, string> = { geld: 'T', kohle: 'Kohle', eisen: 'Eisen', gold: 'Gold' };
  return RES_KEYS.filter((k) => c[k]).map((k) => `${c[k]} ${n[k]}`).join(' · ');
}
