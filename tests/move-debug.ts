import { createGame, blockGrid } from '../src/sim/world';
import { step } from '../src/sim/sim';
const s = createGame(1);
const m = s.provinces.bayern.map!;
const u = m.units[0];
console.log('start', u.x, u.y, 'anchor', m.anchor);
const g = blockGrid(s, 'bayern');
let rows = '';
for (let y = 10; y < 30; y++) { let r = ''; for (let x = 15; x < 40; x++) r += (Math.floor(u.x) === x && Math.floor(u.y) === y) ? 'U' : g[y * 64 + x] ? String(g[y * 64 + x]) : '.'; rows += r + '\n'; }
console.log(rows);
step(s, [{ type: 'move', faction: 'spieler', province: 'bayern', ids: [u.id], x: 23.9, y: 15.9 }]);
console.log('path', JSON.stringify(u.path));
for (let i = 0; i < 40; i++) { step(s); if (i % 5 === 0) console.log(i, u.x.toFixed(2), u.y.toFixed(2), u.order.kind, u.pathIdx, u.path?.length); }
