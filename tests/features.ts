// Forschung, Luftwaffe, Diplomatie ohne Grafik prüfen
import { createGame, placeBuilding, spawnUnit } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';
import type { Command } from '../src/sim/commands';

const s = createGame(11);
const run = (sec: number, cmds: Command[] = []) => { step(s, cmds); for (let i = 1; i < sec * 20; i++) step(s); };
const log = () => { const m = s.events.filter((e) => e.kind === 'msg'); s.events = []; m.forEach((e) => console.log(`  [${Math.round(s.time)}s ${e.level}] ${e.text}`)); };
const P = PLAYER, bay = s.provinces.bayern.map!;
s.factions[P].res = { geld: 50000, kohle: 5000, eisen: 5000, gold: 2000 };

// Forschung ohne Labor -> abgelehnt, mit Labor -> läuft
run(1, [{ type: 'research', faction: P, id: 'luftfahrt' }]); log();
placeBuilding(s, bay, 'forschungszentrum', P, bay.anchor[0] + 5, bay.anchor[1] - 6);
run(1, [{ type: 'research', faction: P, id: 'luftfahrt' }]);
run(95); log();
console.log('Erforscht:', s.factions[P].research.done);

// Flugfeld + Hubschrauber
const ff = placeBuilding(s, bay, 'flugfeld', P, bay.anchor[0] - 8, bay.anchor[1] - 8);
run(1, [{ type: 'train', faction: P, province: 'bayern', unit: 'kampfhubschrauber' }, { type: 'train', faction: P, province: 'bayern', unit: 'kampfjet' }]);
run(40); log();
const heli = bay.units.find((u) => u.type === 'kampfhubschrauber')!;
console.log('Hubschrauber bei', heli.x.toFixed(1), heli.y.toFixed(1), '(Flugfeld', ff.x, ff.y, ')');
// Flug über Felsen/Wasser: direkt in die Ecke
run(1, [{ type: 'move', faction: P, province: 'bayern', ids: [heli.id], x: 3, y: 3 }]);
run(15);
console.log('Hubschrauber nach Flug:', heli.x.toFixed(1), heli.y.toFixed(1), heli.order.kind);

// Luftkampf: feindlicher Panzer kann Hubschrauber nicht treffen, Hubschrauber trifft Panzer
const tank = spawnUnit(s, bay, 'kampfpanzer', 'suedallianz', 4, 4);
const heliHp = heli.hp;
run(12);
console.log('Panzer LP', Math.round(tank.hp), '| Hubschrauber LP', Math.round(heli.hp), 'vorher', heliHp);

// Diplomatie
const d = s.diplomacy.suedallianz;
run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'waffenstillstand' }]); log();
for (let i = 0; i < 4; i++) run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'geschenk' }]);
run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'waffenstillstand' }]); log();
console.log('Beziehung', d.rel, 'Haltung', Math.round(d.haltung));
// Angriffswelle unterwegs -> wird zurückgezogen
s.transits.push({ faction: 'suedallianz', from: 'lombardei', to: 'bayern', hostile: true, arrive: s.time + 1, units: [{ type: 'schuetze', hp: 60 }] });
run(3); log();
run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'buendnis' }]); log();
run(185);
run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'buendnis' }]); log();
console.log('Beziehung', d.rel, 'Haltung', Math.round(d.haltung));
run(1, [{ type: 'diplomacy', faction: P, target: 'suedallianz', action: 'krieg' }]); log();
console.log('Beziehung', d.rel, 'Haltung', Math.round(d.haltung), '| Nordpakt-Haltung', Math.round(s.diplomacy.nordpakt.haltung));
