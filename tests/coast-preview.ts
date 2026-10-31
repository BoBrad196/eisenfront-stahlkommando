import { createGame, ensureMap } from '../src/sim/world';
const s = createGame(5);
const ids = process.argv.slice(2);
const ch = ['.', 'T', '~', '^', ':'];
const rows: string[][] = [];
for (const id of ids) {
  const m = ensureMap(s, id);
  const lines: string[] = [id.padEnd(32)];
  for (let y = 0; y < 64; y += 2) { let r = ''; for (let x = 0; x < 64; x += 2) r += ch[m.terrain[y * 64 + x]]; lines.push(r); }
  rows.push(lines);
}
for (let i = 0; i < rows[0].length; i++) console.log(rows.map((r) => r[i]).join('   '));
