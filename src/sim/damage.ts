// Überrollschäden: Aus der Summe der Überfahrten schwerer Fahrzeuge je Kachel (map.crush) ergibt sich für jedes
// überfahrbare Objekt eine Schadensstufe. 0 = heil, 1 = beschädigt, 2 = schwer beschädigt, 3 = zerstört.
//  - Dorfstraße: 1 Risse und ausgebrochene Pflastersteine · 2 Schlaglöcher · 3 Pflaster zerstört, Matsch
//  - Baum:       1 schiefgedrückt · 2 umgeknickt · 3 nur noch Stumpf
//  - Telegrafenmast: 1 schief · 2 abgebrochen, Leitung hängt · 3 Stumpf, Leitung liegt am Boden
//  - Feldzaun:   1 schief, Latten fehlen · 2 nur noch Pfosten · 3 weg
export type DamageKind = 'strasse' | 'baum' | 'mast' | 'zaun';
export type Stage = 0 | 1 | 2 | 3;

/** Überfahrten (nach Gewicht), ab denen die Stufen 1, 2 und 3 erreicht sind */
export const DAMAGE_LIMITS: Record<DamageKind, [number, number, number]> = {
  strasse: [4, 10, 18],
  baum: [0.6, 1.4, 2.4],
  mast: [1.0, 2.0, 3.5],
  zaun: [0.5, 1.1, 1.8],
};

/** res = Widerstandsfähigkeit des einzelnen Objekts (0,8 … 1,6): dicke Bäume halten mehr aus */
export function stageOf(kind: DamageKind, crush: number, res = 1): Stage {
  const [a, b, c] = DAMAGE_LIMITS[kind];
  return crush >= c * res ? 3 : crush >= b * res ? 2 : crush >= a * res ? 1 : 0;
}

/** Reproduzierbarer Zufallswert je Kachel und Zweck */
export function tileHash(x: number, y: number, k: number) {
  return ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 10000) / 10000;
}
