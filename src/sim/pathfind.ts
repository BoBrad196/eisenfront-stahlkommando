// A*-Wegfindung auf dem Kachelraster (8 Richtungen, keine Ecken schneiden)
export function findPath(grid: Uint8Array, w: number, h: number, sx: number, sy: number, gx: number, gy: number, maxNodes = 45000): [number, number][] | null {
  sx = clamp(Math.floor(sx), 0, w - 1); sy = clamp(Math.floor(sy), 0, h - 1);
  gx = clamp(Math.floor(gx), 0, w - 1); gy = clamp(Math.floor(gy), 0, h - 1);
  if (grid[gy * w + gx]) {
    const alt = nearestFree(grid, w, h, gx, gy, sx, sy);
    if (!alt) return null;
    [gx, gy] = alt;
  }
  const start = sy * w + sx, goal = gy * w + gx;
  if (start === goal) return [[gx + 0.5, gy + 0.5]];
  const g = new Float32Array(w * h).fill(Infinity);
  const from = new Int32Array(w * h).fill(-1);
  const closed = new Uint8Array(w * h);
  const heap = new Heap();
  g[start] = 0;
  heap.push(start, heur(sx, sy, gx, gy));
  let expanded = 0;
  let best = start, bestH = Infinity;
  while (heap.size) {
    const cur = heap.pop();
    if (cur === goal) { best = goal; break; }
    if (closed[cur]) continue;
    closed[cur] = 1;
    if (++expanded > maxNodes) break;
    const cx = cur % w, cy = (cur / w) | 0;
    const hh = heur(cx, cy, gx, gy);
    if (hh < bestH) { bestH = hh; best = cur; }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (closed[ni] || (grid[ni] && ni !== start)) continue;
      if (dx && dy && (grid[cy * w + nx] || grid[ny * w + cx])) continue;
      const ng = g[cur] + (dx && dy ? 1.4142 : 1);
      if (ng < g[ni]) {
        g[ni] = ng; from[ni] = cur;
        heap.push(ni, ng + heur(nx, ny, gx, gy));
      }
    }
  }
  // Kein vollständiger Weg: bis zum nächstgelegenen erreichten Punkt laufen
  const path: [number, number][] = [];
  for (let c = best; c !== start && c !== -1; c = from[c]) path.push([(c % w) + 0.5, ((c / w) | 0) + 0.5]);
  path.reverse();
  return path.length ? smooth(grid, w, path) : null;
}

/** Überflüssige Zwischenpunkte entfernen, wenn eine gerade Linie frei ist */
function smooth(grid: Uint8Array, w: number, path: [number, number][]): [number, number][] {
  const out: [number, number][] = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let j = Math.min(path.length - 1, i + 8);
    while (j > i + 1 && !lineFree(grid, w, path[i], path[j])) j--;
    out.push(path[j]);
    i = j;
  }
  return out;
}
function lineFree(grid: Uint8Array, w: number, a: [number, number], b: [number, number]) {
  const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 3);
  for (let k = 1; k < n; k++) {
    const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n;
    for (const [ox, oy] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      if (grid[Math.floor(y + oy) * w + Math.floor(x + ox)]) return false;
    }
  }
  return true;
}

export function nearestFree(grid: Uint8Array, w: number, h: number, x: number, y: number, towardX: number, towardY: number): [number, number] | null {
  for (let r = 1; r < 20; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || grid[ny * w + nx]) continue;
      const d = Math.hypot(nx - towardX, ny - towardY);
      if (d < bd) { bd = d; best = [nx, ny]; }
    }
    if (best) return best;
  }
  return null;
}

const heur = (x: number, y: number, gx: number, gy: number) => {
  const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
  return dx + dy - 0.5858 * Math.min(dx, dy);
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

class Heap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size() { return this.ids.length; }
  push(id: number, key: number) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop(): number {
    const a = this.ids, k = this.keys;
    const top = a[0];
    const lastId = a.pop()!, lastK = k.pop()!;
    if (a.length) {
      a[0] = lastId; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
