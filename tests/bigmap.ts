// Große Karten: Erzeugung, Erreichbarkeit der Dörfer/Vorkommen von der Basis, Zeiten
import { createGame, ensureMap, blockGrid, findFreeTile } from '../src/sim/world';
import { PROVINCES } from '../src/sim/defs';
import { findPath } from '../src/sim/pathfind';

const state = createGame(12345);
let fails = 0;
const t0 = performance.now();
for (const def of PROVINCES.slice(0, 12)) {
  const t1 = performance.now();
  const map = ensureMap(state, def.id);
  const prov = state.provinces[def.id];
  const grid = blockGrid(state, def.id);
  const [ax, ay] = findFreeTile(state, map, map.anchor[0], map.anchor[1], 30);
  const ms = (performance.now() - t1).toFixed(0);
  let water = 0, wald = 0, fels = 0;
  for (const t of map.terrain) { if (t === 2) water++; else if (t === 1) wald++; else if (t === 3) fels++; }
  const bad: string[] = [];
  let far = 0;
  for (const v of prov.villages) {
    if (v.x < 0) { bad.push(v.name + ' ohne Platz'); continue; }
    const p0 = performance.now();
    const path = findPath(grid, map.w, map.h, ax + 0.5, ay + 0.5, v.x + 0.5, v.y + 0.5);
    const pm = performance.now() - p0;
    far = Math.max(far, pm);
    const end = path?.[path.length - 1];
    if (!end || Math.hypot(end[0] - v.x, end[1] - v.y) > 6) bad.push(`${v.name} unerreichbar`);
  }
  const pct = (n: number) => Math.round((n / map.terrain.length) * 100);
  console.log(`${def.id.padEnd(14)} ${def.terrain.padEnd(7)} ${map.w}x${map.h} Dörfer ${prov.villages.length} Wasser ${pct(water)}% Wald ${pct(wald)}% Fels ${pct(fels)}%  ${ms} ms, längste Wegsuche ${far.toFixed(0)} ms ${bad.length ? 'PROBLEM: ' + bad.join(', ') : ''}`);
  fails += bad.length;
}
console.log(`Gesamt ${(performance.now() - t0).toFixed(0)} ms, Probleme: ${fails}`);
process.exit(fails ? 1 : 0);
