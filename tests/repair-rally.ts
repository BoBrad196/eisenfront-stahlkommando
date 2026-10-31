// Reparatur und Sammelpunkt prüfen
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';
const s = createGame(3);
const m = s.provinces.bayern.map!;
const kas = m.buildings.find((b) => b.type === 'kaserne')!;
kas.hp = 300;
const geld0 = s.factions[PLAYER].res.geld;
step(s, [
  { type: 'repair', faction: PLAYER, province: 'bayern', building: kas.id, on: true },
  { type: 'rally', faction: PLAYER, province: 'bayern', building: kas.id, x: 10.5, y: 40.5 },
  { type: 'train', faction: PLAYER, province: 'bayern', unit: 'schuetze' },
]);
for (let i = 0; i < 20 * 40; i++) step(s);
const u = m.units[m.units.length - 1];
console.log('Kaserne LP', Math.round(kas.hp), '/ 800, repariert:', kas.repairing, '| Geld vorher', Math.round(geld0));
console.log('Neue Einheit', u.type, 'bei', u.x.toFixed(1), u.y.toFixed(1), 'Befehl', u.order.kind, '(Sammelpunkt 10.5/40.5)');
