// Marine prüfen
import { createGame, ensureMap, placeBuilding, placementError, seaMask } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER, UNITS } from '../src/sim/defs';
import type { Command } from '../src/sim/commands';

const s = createGame(21);
const run = (sec: number, cmds: Command[] = []) => { step(s, cmds); for (let i = 1; i < sec * 20; i++) step(s); };
const log = () => { const m = s.events.filter((e) => e.kind === 'msg'); s.events = []; m.forEach((e) => console.log(`  [${Math.round(s.time)}s ${e.level}] ${e.text}`)); };
const P = PLAYER;
s.factions[P].res = { geld: 90000, kohle: 9000, eisen: 9000, gold: 3000 };
s.factions[P].research.done.push('marine');

// Bretagne übernehmen (Miliz entfernen) und Basis errichten
const br = s.provinces.bretagne; const m = ensureMap(s, 'bretagne');
m.units = []; br.owner = P;
placeBuilding(s, m, 'bauhof', P, m.anchor[0] - 1, m.anchor[1] - 1);
placeBuilding(s, m, 'kraftwerk', P, m.anchor[0] + 3, m.anchor[1] - 1);
const sea = seaMask(m); console.log('Meereskacheln Bretagne:', sea.reduce((a, b) => a + b, 0));
// Werft-Platz suchen (Bauradius ignorieren wir hier, getestet wird die Küstenregel)
let spot: [number, number] | null = null, why = '';
for (let y = 1; y < 61 && !spot; y++) for (let x = 1; x < 61 && !spot; x++) {
  const e = placementError(s, 'bretagne', P, 'werft', x, y);
  if (!e || e === 'Zu weit von eigenen Gebäuden entfernt') { spot = [x, y]; why = e ?? ''; }
}
console.log('Werft-Platz', spot, why);
console.log('Werft im Binnenland (Mitte):', placementError(s, 'bretagne', P, 'werft', m.anchor[0] + 6, m.anchor[1] + 6));
placeBuilding(s, m, 'werft', P, spot![0], spot![1]);
run(1, ['patrouillenboot', 'zerstoerer', 'raketenkreuzer'].map((u) => ({ type: 'train', faction: P, province: 'bretagne', unit: u }) as Command));
run(150); log();
const ships = m.units.filter((u) => UNITS[u.type].domain === 'see');
console.log('Schiffe:', ships.map((u) => `${u.type}@${u.x.toFixed(1)},${u.y.toFixed(1)} Wasser=${sea[Math.floor(u.y) * 64 + Math.floor(u.x)]}`).join(' | '));
// Fahrt: Ziel an Land -> Schiff bleibt im Wasser
const tgt: [number, number] = [m.anchor[0], m.anchor[1]];
run(1, [{ type: 'move', faction: P, province: 'bretagne', ids: ships.map((u) => u.id), x: tgt[0], y: tgt[1] }]);
run(30);
console.log('Nach Fahrt ins Landesinnere:', ships.map((u) => `${u.x.toFixed(1)},${u.y.toFixed(1)} Wasser=${sea[Math.floor(u.y) * 64 + Math.floor(u.x)]}`).join(' | '));
// Verlegung: nach Normandie (Küste) und Burgund? Bretagne-Nachbarn prüfen
run(1, [{ type: 'transfer', faction: P, province: 'bretagne', ids: [ships[0].id], to: 'normandie' }]); log();
console.log('Transits:', s.transits.map((t) => `${t.from}->${t.to} ${t.units.map((u) => u.type)} Ankunft ${Math.round(t.arrive - s.time)}s`).join('; '));
// KI-Werft in Nordengland
const ne = ensureMap(s, 'nordengland');
console.log('Nordengland:', ne.buildings.map((b) => b.type).join(','), '| Schiffe:', ne.units.filter((u) => UNITS[u.type].domain === 'see').length);
run(15); log();
const no = s.provinces.normandie.map!;
console.log('Normandie Schiffe:', no.units.filter((u) => UNITS[u.type].domain === 'see').map((u) => `${u.faction} ${u.type} Wasser=${seaMask(no)[Math.floor(u.y) * 64 + Math.floor(u.x)]}`).join(', '));
