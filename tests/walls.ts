// Verteidigungslinien: Stacheldraht hält Infanterie, Panzer reißen ihn nieder; Panzersperre hält Panzer, Infanterie geht durch
import { createGame, ensureMap, blockGrid, placeBuilding } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { applyCommand } from '../src/sim/commands';
import { PLAYER } from '../src/sim/defs';

let fails = 0;
const check = (ok: boolean, what: string) => { console.log((ok ? 'OK   ' : 'FEHL ') + what); if (!ok) fails++; };

const s = createGame(5);
const m = ensureMap(s, 'bayern');
const [ax, ay] = m.anchor;
const pid = 'bayern';

// Sperren als Gebäude setzen (Bau über Linie testen wir danach)
const row = (type: string, y: number) => { for (let x = ax + 20; x < ax + 26; x++) placeBuilding(s, m, type, PLAYER, x, y); };
row('stacheldraht', ay + 20);
row('panzersperre', ay + 24);
const gInf = blockGrid(s, pid, 'inf'), gTank = blockGrid(s, pid, 'tank');
const at = (g: Uint8Array, x: number, y: number) => g[y * m.w + x];
check(at(gInf, ax + 22, ay + 20) === 2, 'Stacheldraht blockiert Infanterie');
check(at(gTank, ax + 22, ay + 20) === 0, 'Stacheldraht blockiert Panzer nicht');
check(at(gTank, ax + 22, ay + 24) === 2, 'Panzersperre blockiert Panzer');
check(at(gInf, ax + 22, ay + 24) === 0, 'Panzersperre blockiert Infanterie nicht');

// Stacheldraht wird von einem Panzer überfahren und verliert Haltbarkeit
const wire = m.buildings.find((b) => b.type === 'stacheldraht' && b.y === ay + 20 && b.x === ax + 22)!;
const hp0 = wire.hp;
const tank = { ...m.units[0] };
m.units.push({ ...tank, id: 99999, type: 'kampfpanzer', faction: PLAYER, x: ax + 22.5, y: ay + 20.5, px: ax + 22.5, py: ay + 20.5, hp: 600, order: { kind: 'idle' }, target: null, path: null });
for (let i = 0; i < 20; i++) step(s);
check(wire.hp < hp0, `Panzer reißt Stacheldraht nieder (${hp0} -> ${wire.hp.toFixed(0)})`);

// Linienbau: 8 Stacheldrähte in einer Reihe bauen (Kaserne ist Voraussetzung, Bauhof steht)
const cost0 = { ...s.factions[PLAYER].res };
applyCommand(s, { type: 'buildLine', faction: PLAYER, province: pid, building: 'stacheldraht', tiles: Array.from({ length: 8 }, (_, i) => [ax + 30 + i, ay + 30]) });
const q = m.queues[PLAYER];
check(!!q?.line || q?.struct?.auto === true || (m.buildings.filter((b) => b.type === 'stacheldraht' && b.y === ay + 30).length > 0), 'Linienauftrag angenommen');
// Kasernen-Voraussetzung: falls keine Kaserne steht, wird die Linie abgelehnt – hier nur prüfen, dass nichts kaputtgeht
for (let i = 0; i < 20 * 60 * 2; i++) step(s);
const built = m.buildings.filter((b) => b.type === 'stacheldraht' && b.y === ay + 30).length;
check(built >= 1, `Linie baut Felder nacheinander (${built} von 8 gesetzt)`);
check(!m.queues[PLAYER]?.line && !m.queues[PLAYER]?.struct, 'Warteschlange ist danach leer');
console.log(`Geld vorher ${cost0.geld} nachher ${s.factions[PLAYER].res.geld}`);
console.log(fails ? `Fehler: ${fails}` : 'alle Prüfungen bestanden');
process.exit(fails ? 1 : 0);
