import type { VillageLayout } from './villageLayout';
// Spielzustand – nur reine Daten (JSON-serialisierbar), damit Speichern
// und später Mehrspieler (Befehle synchron auf allen Rechnern) möglich sind.
import type { ResKey } from './defs';

export type Resources = Record<ResKey, number>;

export const T_GRAS = 0, T_WALD = 1, T_WASSER = 2, T_FELS = 3, T_SAND = 4;
export const D_NONE = 0, D_KOHLE = 1, D_EISEN = 2, D_GOLD = 3;
export const DEPOSIT_KEYS = ['', 'kohle', 'eisen', 'gold'] as const;

export type Order =
  | { kind: 'idle' }
  | { kind: 'move'; x: number; y: number }
  | { kind: 'attackMove'; x: number; y: number }
  | { kind: 'attack'; target: number }
  | { kind: 'hunt' };

export interface Unit {
  id: number;
  type: string;
  faction: string;
  x: number; y: number;   // Position in Kacheln (Mittelpunkt)
  px: number; py: number; // vorherige Position (für flüssige Darstellung)
  hp: number;
  facing: number;
  aim?: number; // Ausrichtung des Geschützturms (nur Einheiten mit Turm)
  order: Order;
  target: number | null;
  cooldown: number;
  path: [number, number][] | null;
  pathIdx: number;
  repath: number;
  scan: number;
}

export interface Building {
  id: number;
  type: string;
  faction: string;
  x: number; y: number; // linke obere Kachel
  hp: number;
  cooldown: number;
  target: number | null;
  facing: number;
  repairing?: boolean;           // wird gerade repariert (kostet Geld)
  rally?: [number, number] | null; // Sammelpunkt für neu gebaute Einheiten
}

export interface Village {
  id: string;
  name: string;
  x: number; y: number; // Mitte (Kachel), -1 solange Detailkarte nicht erzeugt
  basePop: number;
  pop: number;
  happiness: number;
  origin: string;        // Fraktion, der das Dorf bei Spielbeginn gehörte
  upgrades: string[];
  schutz: string | null; // Fraktion, die Schutzgebühr fordert
  plunderCooldown: number;
  revolt: boolean;
  income: number;        // zuletzt berechnete Einnahme pro Minute (Anzeige)
  status: VillageStatus;
  layout?: VillageLayout; // Dorfstraßen und Grundstücke (ab Erzeugung der Detailkarte)
}
export type VillageStatus = 'eigen' | 'besetzt' | 'schutz' | 'schutz-pausiert' | 'neutral' | 'aufstand';

export interface QueueItem { type: string; progress: number; total: number }
export interface Queues {
  struct: (QueueItem & { ready: boolean; auto?: boolean }) | null;
  /** Linienbau: noch zu setzende Felder, nacheinander gebaut */
  line?: { type: string; tiles: [number, number][] } | null;
  kaserne: QueueItem[];
  panzerfabrik: QueueItem[];
  flugfeld: QueueItem[];
  werft: QueueItem[];
}
export type FactoryKind = 'kaserne' | 'panzerfabrik' | 'flugfeld' | 'werft';
export const FACTORY_KINDS: FactoryKind[] = ['kaserne', 'panzerfabrik', 'flugfeld', 'werft'];

export interface ProvinceMap {
  id: string;
  /** Krater (Bodenmarken) aus Einschlägen und zerstörten Gebäuden */
  craters?: { x: number; y: number; r: number; v: number }[];
  w: number; h: number;
  anchor: [number, number]; // Standort der Basis
  terrain: number[];
  deposit: number[];
  units: Unit[];
  buildings: Building[];
  queues: Record<string, Queues>;
  explored: Record<string, number[]>; // erkundete Kacheln (1) je menschlicher Fraktion
  wear?: number[]; // Bodenabnutzung je Kachel 0..100 (Spuren, Trampelpfade, Matsch)
  crush?: number[]; // Überrollschaden je Kachel: Summe der Überfahrten schwerer Fahrzeuge (Dorfstraßen, Bäume, Masten, Zäune)
  war: string[];   // Fraktionen, mit denen die neutrale Miliz im Krieg ist
  version: number; // erhöht sich bei Änderungen an Gebäuden (Wegfindung neu berechnen)
}

export interface ProvinceState {
  id: string;
  owner: string;
  villages: Village[];
  garrison: string[]; // abstrakte Truppen, solange keine Detailkarte existiert
  map: ProvinceMap | null;
}

export interface FactionState {
  res: Resources;
  income: Resources; // geschätzte Einnahmen pro Minute (Anzeige)
  tax: number; // Index in economy.taxLevels
  alive: boolean;
  nextAttack: number;
  nextReinforce: number;
  research: { done: string[]; current: QueueItem | null };
  nextResearch: number; // nur KI: Zeitpunkt der nächsten automatischen Forschung
}

export type Relation = 'krieg' | 'waffenstillstand' | 'buendnis';
/** Beziehung des Spielers zu einer KI-Macht */
export interface DiplomacyState { rel: Relation; haltung: number; since: number }

export interface Transit {
  faction: string;
  from: string;
  to: string;
  units: { type: string; hp: number }[];
  arrive: number;
  hostile: boolean; // KI-Angriffswelle
}

export interface GameEvent { building?: string;
  kind: 'shot' | 'explosion' | 'msg' | 'sfx';
  sound?: string; // Geräusch-Schlüssel (assets/manifest.json "audio")
  faction?: string;
  province?: string;
  x?: number; y?: number; x2?: number; y2?: number;
  weapon?: string;
  fromAir?: boolean; toAir?: boolean;
  unit?: string; facing?: number; // zerstörte Einheit (für Wracks)
  text?: string;
  level?: 'info' | 'gut' | 'warnung' | 'alarm';
  target?: string; // Provinz für "Hinspringen"
}

export interface GameState {
  version: 1;
  time: number;
  rng: number;
  nextId: number;
  factions: Record<string, FactionState>;
  provinces: Record<string, ProvinceState>;
  transits: Transit[];
  diplomacy: Record<string, DiplomacyState>;
  outcome: null | 'sieg' | 'niederlage';
  events: GameEvent[]; // flüchtig, wird nicht gespeichert
}
