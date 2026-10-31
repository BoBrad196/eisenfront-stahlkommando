// Schnelltest: Simulation ohne Grafik laufen lassen
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';

const s = createGame(12345);
const t0 = performance.now();
const minutes = Number(process.argv[2] ?? 15);
const bay = s.provinces.bayern.map!;
console.log('Bayern Gebäude:', bay.buildings.map((b) => b.type).join(','), '| Einheiten:', bay.units.length, '| Dörfer:', s.provinces.bayern.villages.map((v) => `${v.name}@${v.x},${v.y}`).join(' '));
// Spieler schickt nach 10 s Truppen nach Schwaben (neutral) und plündert/fordert Schutz
let sent = false;
for (let i = 0; i < minutes * 60 * 20; i++) {
  const cmds: any[] = [];
  if (!sent && s.time > 10) {
    sent = true;
    cmds.push({ type: 'transfer', faction: PLAYER, province: 'bayern', ids: bay.units.map((u) => u.id), to: 'schwaben' });
  }
  step(s, cmds);
  if (i % (20 * 60) === 0) {
    const f = s.factions[PLAYER];
    console.log(`t=${Math.round(s.time)}s geld=${Math.round(f.res.geld)} kohle=${Math.round(f.res.kohle)} eisen=${Math.round(f.res.eisen)} gold=${Math.round(f.res.gold)} income=${Math.round(f.income.geld)}/min`);
  }
}
const msgs = s.events.filter((e) => e.kind === 'msg').map((e) => `[${e.level}] ${e.text}`);
console.log(msgs.slice(-40).join('\n'));
const owners: Record<string, number> = {};
for (const p of Object.values(s.provinces)) owners[p.owner] = (owners[p.owner] ?? 0) + 1;
console.log('Besitz:', JSON.stringify(owners), 'Karten:', Object.values(s.provinces).filter((p) => p.map).length);
console.log('Laufzeit', Math.round(performance.now() - t0), 'ms für', minutes, 'min Spielzeit; Spielstand', Math.round(JSON.stringify({ ...s, events: [] }).length / 1024), 'KB');
