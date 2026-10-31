// Bodenabnutzung: Panzer fährt mehrfach dieselbe Strecke
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';
const s = createGame(3);
const m = s.provinces.bayern.map!;
const tank = m.units.find((u) => u.type === 'kampfpanzer')!;
const [ax, ay] = [Math.floor(tank.x), Math.floor(tank.y)];
const a: [number, number] = [ax + 0.5, ay + 0.5], b: [number, number] = [ax + 6.5, ay + 0.5];
for (let pass = 0; pass < 10; pass++) {
  const [x, y] = pass % 2 ? a : b;
  step(s, [{ type: 'move', faction: PLAYER, province: 'bayern', ids: [tank.id], x, y }]);
  for (let i = 0; i < 20 * 6; i++) step(s);
  if (pass === 0 || pass === 4 || pass === 9) {
    const row = []; for (let x = ax; x <= ax + 6; x++) row.push(Math.round(m.wear![ay * 64 + x]));
    console.log(`nach ${pass + 1} Fahrten:`, row.join(' '));
  }
}
for (let i = 0; i < 20 * 300; i++) step(s);
const row = []; for (let x = ax; x <= ax + 6; x++) row.push(Math.round(m.wear![ay * 64 + x]));
console.log('5 Minuten später:', row.join(' '));
