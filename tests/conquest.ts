// Ablauf: Truppen verlegen, Schutzgebühr, Plündern, Miliz besiegen, Provinz erobern, Bauhof bauen
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';
import type { Command } from '../src/sim/commands';

const s = createGame(7);
const run = (sec: number, cmds: Command[] = []) => { step(s, cmds); for (let i = 1; i < sec * 20; i++) step(s); };
const log = () => { const m = s.events.filter((e) => e.kind === 'msg'); s.events = []; m.forEach((e) => console.log(`  [${Math.round(s.time)}s ${e.level}] ${e.text}`)); };
const bay = s.provinces.bayern.map!;
run(1, [{ type: 'transfer', faction: PLAYER, province: 'bayern', ids: bay.units.map((u) => u.id), to: 'schwaben' }]);
run(13); log();
const sw = s.provinces.schwaben;
const m = sw.map!;
const v = sw.villages[0];
console.log('Schwaben: Besitzer', sw.owner, 'Miliz', m.units.filter((u) => u.faction === 'neutral').length, 'eigene', m.units.filter((u) => u.faction === PLAYER).length);
// Zum ersten Dorf ziehen und Schutzgebühr fordern
const mine = () => m.units.filter((u) => u.faction === PLAYER).map((u) => u.id);
run(1, [{ type: 'move', faction: PLAYER, province: 'schwaben', ids: mine(), x: v.x + 2, y: v.y + 3 }, { type: 'schutz', faction: PLAYER, province: 'schwaben', village: v.id, on: true }]);
run(40); log();
console.log(`${v.name}: Status ${v.status}, Einnahme ${v.income.toFixed(0)}/min, Zufriedenheit ${v.happiness.toFixed(0)}`);
run(1, [{ type: 'plunder', faction: PLAYER, province: 'schwaben', village: v.id }]); log();
console.log('Krieg mit Miliz:', m.war);
// Jagd auf alle Milizen
for (let k = 0; k < 6 && sw.owner !== PLAYER; k++) {
  const enemy = m.units.find((u) => u.faction === 'neutral');
  if (!enemy) break;
  run(20, [{ type: 'attack', faction: PLAYER, province: 'schwaben', ids: mine(), target: enemy.id }]);
}
run(2); log();
console.log('Schwaben: Besitzer', sw.owner, 'verbleibende eigene', mine().length, '| Dörfer:', sw.villages.map((x) => `${x.name}=${x.status}`).join(', '));
run(1, [{ type: 'build', faction: PLAYER, province: 'schwaben', building: 'bauhof' }]);
run(30); log();
const q = m.queues[PLAYER];
console.log('Bauhof bereit:', q?.struct?.ready);
const [ax, ay] = m.anchor;
run(1, [{ type: 'place', faction: PLAYER, province: 'schwaben', x: ax - 1, y: ay - 1 }]); log();
console.log('Gebäude in Schwaben:', m.buildings.map((b) => `${b.type}/${b.faction}`).join(', '));
run(60); log();
console.log('Einnahmen/min', JSON.stringify(s.factions[PLAYER].income));
