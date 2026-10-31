// Überrollschäden: schwere Panzer fahren über dieselbe Strecke, leichte Fahrzeuge und Infanterie nicht
import { createGame } from '../src/sim/world';
import { step } from '../src/sim/sim';
import { PLAYER } from '../src/sim/defs';
import { stageOf } from '../src/sim/damage';
const s = createGame(3);
const m = s.provinces.bayern.map!;
const W = m.w;
const tank = m.units.find((u) => u.type === 'kampfpanzer')!;
const [ax, ay] = [Math.floor(tank.x), Math.floor(tank.y)];
const a: [number, number] = [ax + 0.5, ay + 0.5], b: [number, number] = [ax + 6.5, ay + 0.5];
const row = () => { const r = []; for (let x = ax + 1; x <= ax + 5; x++) r.push((m.crush?.[ay * W + x] ?? 0).toFixed(1)); return r.join(' '); };
console.log('vorher:', row());
for (let pass = 0; pass < 12; pass++) {
  const [x, y] = pass % 2 ? a : b;
  step(s, [{ type: 'move', faction: PLAYER, province: 'bayern', ids: [tank.id], x, y }]);
  for (let i = 0; i < 20 * 6; i++) step(s);
  if ([0, 2, 5, 11].includes(pass)) {
    const c = m.crush![ay * W + ax + 3];
    console.log(`nach ${pass + 1} Fahrten: ${row()}  → Stufen Straße/Baum/Mast/Zaun:`, (['strasse', 'baum', 'mast', 'zaun'] as const).map((k) => stageOf(k, c)).join('/'));
  }
}
// leichte Fahrzeuge und Infanterie hinterlassen keinen Überrollschaden
const m2 = createGame(3).provinces.bayern.map!;
const light = m2.units.find((u) => u.type === 'spaehpanzer' || u.type === 'schuetze')!;
console.log('Einheit', light.type, 'crush nach Spielbeginn vorhanden:', !!m2.crush);
