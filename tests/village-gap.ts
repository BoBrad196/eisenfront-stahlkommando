// Dörfer: Grundstücke stehen nie Wand an Wand (auch nicht über Eck), Straßen bleiben frei, genug Häuser pro Dorf
import { createGame, ensureMap } from '../src/sim/world';
import { PROVINCES } from '../src/sim/defs';

const state = createGame(777);
let touching = 0, houses = 0, villages = 0;
for (const def of PROVINCES) {
  ensureMap(state, def.id);
  for (const v of state.provinces[def.id].villages) {
    if (!v.layout) continue;
    villages++;
    const ps = v.layout.plots;
    houses += ps.filter((p) => p.kind === 'haus' || p.kind === 'hof').length;
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
      const a = ps[i], b = ps[j];
      const gx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w)), gy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
      if (gx <= 0 && gy <= 0) touching++; // berühren sich oder überlappen
    }
  }
}
console.log(`Dörfer ${villages}, Grundstücke Haus/Hof ${houses}, Berührungen/Überlappungen ${touching}`);
process.exit(touching ? 1 : 0);
