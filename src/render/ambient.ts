// Belebte Umgebung (nur Darstellung, ohne Einfluss auf die Simulation): Dorfbewohner auf den Dorfstraßen,
// grasende Kühe und Pferde, ziehende Wolkenschatten, Vogelschwärme und Glitzern auf dem Wasser.
import { assets } from '../assets';
import { T_GRAS, T_WASSER, type ProvinceMap, type Unit, type Village } from '../sim/types';
import type { Landscape } from './landscape';

type Iso = (tx: number, ty: number) => [number, number];
type Item = { d: number; draw: () => void };

interface Walker {
  key: string; x: number; y: number; facing: number;
  path: [number, number][]; speed: number; wait: number;
  /** Dorfstraßen (Kachelindizes) des Dorfs bzw. Weide (Mitte, Radius) */
  streets: number[] | null; home: [number, number, number] | null;
  row: number; grazing: number; seed: number;
}
interface Cloud { x: number; y: number; s: number; img: number }
interface Bird { ox: number; oy: number; ph: number }
interface Flock { x: number; y: number; vx: number; vy: number; alt: number; birds: Bird[] }

/** Wind über der Karte (Kacheln je Sekunde) – Wolken und Bäume */
export const WIND = { x: 0.22, y: -0.12 };

const hash = (x: number, y: number, k: number) => ((((x * 73856093) ^ (y * 19349663) ^ (k * 83492791)) >>> 0) % 10000) / 10000;

export class Ambient {
  private walkers: Walker[] = [];
  private clouds: Cloud[] = [];
  private cloudImgs: HTMLCanvasElement[] = [];
  private flocks: Flock[] = [];
  private nextFlock = 4;
  private water: number[] = [];
  private map!: ProvinceMap;

  prepare(map: ProvinceMap, villages: Village[], land: Landscape, blocked: Uint8Array) {
    this.map = map;
    this.walkers = [];
    const { w, h } = map;
    villages.forEach((v, vi) => {
      if (!v.layout) return;
      const streets = new Set<number>();
      for (const [x0, y0, x1, y1] of v.layout.streets) {
        for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) streets.add(y * w + x);
      }
      const list = [...streets];
      if (!list.length) return;
      // Dorfbewohner: etwa einer je vier Grundstücke
      const n = Math.min(12, 3 + Math.round(v.layout.plots.length / 4));
      for (let k = 0; k < n; k++) {
        const i = list[Math.floor(hash(vi, k, 1) * list.length)];
        this.walkers.push({
          key: hash(vi, k, 2) < 0.5 ? 'life.bauer' : 'life.baeuerin', x: (i % w) + 0.5, y: Math.floor(i / w) + 0.5, facing: hash(vi, k, 3) * 6.28,
          path: [], speed: 0.32 + hash(vi, k, 4) * 0.12, wait: hash(vi, k, 5) * 6, streets: list, home: null, row: 0, grazing: 0, seed: vi * 31 + k,
        });
      }
      // Weide mit Kühen: freie Wiese am Dorfrand
      let best: [number, number] | null = null, bestScore = 0;
      for (let k = 0; k < 60; k++) {
        const a = hash(vi, k, 7) * Math.PI * 2, r = 8 + hash(vi, k, 8) * 7;
        const cx = Math.round(v.x + Math.cos(a) * r), cy = Math.round(v.y + Math.sin(a) * r);
        if (cx < 3 || cy < 3 || cx >= w - 3 || cy >= h - 3) continue;
        let free = 0;
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (this.pasture(x, y, land, blocked)) free++;
        if (free > bestScore) { bestScore = free; best = [cx, cy]; }
      }
      if (best && bestScore >= 16) {
        // Weide: Kühe, Pferde oder beides gemischt
        const mixKind = hash(vi, 14, 14);
        const cows = mixKind < 0.2 ? 0 : 2 + Math.floor(hash(vi, 9, 9) * 4);
        const horses = mixKind < 0.2 ? 2 + Math.floor(hash(vi, 15, 9) * 3) : mixKind > 0.6 ? 1 + Math.floor(hash(vi, 16, 9) * 2) : 0;
        const herd = [...Array(cows).fill('life.kuh'), ...Array(horses).fill('life.pferd')];
        herd.forEach((key, k) => {
          const x = best![0] + 0.5 + (hash(vi, k, 10) - 0.5) * 3, y = best![1] + 0.5 + (hash(vi, k, 11) - 0.5) * 3;
          this.walkers.push({ key, x, y, facing: hash(vi, k, 12) * 6.28, path: [], speed: key === 'life.pferd' ? 0.16 : 0.12, wait: hash(vi, k, 13) * 8,
            streets: null, home: [best![0] + 0.5, best![1] + 0.5, 2.3], row: 1, grazing: 1, seed: vi * 31 + k + 500 });
        });
      }
    });
    this.blockedRef = (x, y) => !this.pasture(x, y, land, blocked);
    // Wasserkacheln für das Glitzern
    this.water = [];
    for (let i = 0; i < w * h; i++) if (map.terrain[i] === T_WASSER) this.water.push(i);
    // Wolkenschatten
    if (!this.cloudImgs.length) for (let k = 0; k < 3; k++) this.cloudImgs.push(cloudTexture(k));
    this.clouds = [];
    const nc = Math.max(4, Math.round((w * h) / 700));
    for (let k = 0; k < nc; k++) this.clouds.push({ x: hash(k, 1, 20) * (w + 40) - 20, y: hash(k, 2, 21) * (h + 40) - 20, s: 0.7 + hash(k, 3, 22) * 0.8, img: k % 3 });
    this.flocks = [];
  }
  private blockedRef: (x: number, y: number) => boolean = () => true;

  private pasture(x: number, y: number, land: Landscape, blocked: Uint8Array) {
    const { w, h } = this.map;
    if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
    const i = y * w + x;
    return this.map.terrain[i] === T_GRAS && !blocked[i] && !this.map.deposit[i] && land.roadDist(x + 0.5, y + 0.5) > 1 && !land.fieldAt(x + 0.5, y + 0.5);
  }

  update(dt: number, units: Unit[]) {
    dt = Math.min(dt, 0.1);
    const w = this.map.w;
    for (const p of this.walkers) {
      // Fahrzeuge und Soldaten haben Vorrang: kurz stehen bleiben
      const crowd = units.some((u) => Math.abs(u.x - p.x) + Math.abs(u.y - p.y) < (p.streets ? 0.9 : 1.4));
      if (p.wait > 0 || crowd) {
        p.wait -= dt;
        p.row = p.streets ? 0 : p.grazing ? 1 : 0;
        if (p.wait <= 0 && !crowd) this.plan(p, w);
        continue;
      }
      if (!p.path.length) { this.plan(p, w); continue; }
      const [tx, ty] = p.path[0];
      const dx = tx - p.x, dy = ty - p.y, d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step) { p.x = tx; p.y = ty; p.path.shift(); if (!p.path.length) this.arrive(p); continue; }
      p.x += (dx / d) * step; p.y += (dy / d) * step;
      p.facing = Math.atan2(dy, dx);
      const t = performance.now() / (p.streets ? 150 : 320) + p.seed;
      p.row = 1 + (Math.floor(t) % 2);
      if (!p.streets) p.row = Math.floor(t) % 2 ? 2 : 0;
    }
    // Wolken ziehen, Vögel fliegen
    const { h } = this.map;
    for (const c of this.clouds) {
      c.x += WIND.x * dt; c.y += WIND.y * dt;
      if (c.x > w + 25) c.x -= w + 50; if (c.y < -25) c.y += h + 50;
    }
    this.nextFlock -= dt;
    if (this.nextFlock <= 0 && this.flocks.length < 3) {
      this.nextFlock = 12 + Math.random() * 25;
      const a = Math.random() * Math.PI * 2, sp = 1.3 + Math.random() * 0.8;
      const cx = w / 2 - Math.cos(a) * (w / 2 + 6), cy = h / 2 - Math.sin(a) * (h / 2 + 6);
      const n = 4 + Math.floor(Math.random() * 7);
      const birds: Bird[] = [];
      for (let k = 0; k < n; k++) birds.push({ ox: (Math.random() - 0.5) * 3, oy: (Math.random() - 0.5) * 3, ph: Math.random() * 6.28 });
      this.flocks.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, alt: 70 + Math.random() * 50, birds });
    }
    this.flocks = this.flocks.filter((f) => {
      f.x += f.vx * dt; f.y += f.vy * dt;
      return f.x > -12 && f.y > -12 && f.x < w + 12 && f.y < h + 12;
    });
  }

  /** neues Ziel: Dorfbewohner gehen über die Dorfstraßen, Kühe bummeln über die Weide */
  private plan(p: Walker, w: number) {
    if (p.streets) {
      const target = p.streets[Math.floor(Math.random() * p.streets.length)];
      const tiles = streetPath(Math.floor(p.y) * w + Math.floor(p.x), target, new Set(p.streets), w);
      // rechts der Straßenmitte gehen (Gegenverkehr weicht so von selbst aus)
      let [px, py] = [Math.floor(p.x), Math.floor(p.y)];
      p.path = tiles.map(([x, y]) => {
        const dx = Math.sign(x - px), dy = Math.sign(y - py);
        px = x; py = y;
        return [x + 0.5 - dy * 0.28, y + 0.5 + dx * 0.28] as [number, number];
      });
      if (!p.path.length) p.wait = 2 + Math.random() * 4;
      return;
    }
    const [hx, hy, r] = p.home!;
    if (Math.random() < 0.55) { p.grazing = 1; p.wait = 5 + Math.random() * 10; return; }
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * 6.28, d = Math.random() * r;
      const x = hx + Math.cos(a) * d, y = hy + Math.sin(a) * d;
      if (this.blockedRef(Math.floor(x), Math.floor(y))) continue;
      p.path = [[x, y]]; p.grazing = 0; return;
    }
    p.wait = 3;
  }

  private arrive(p: Walker) {
    if (p.streets) { p.wait = Math.random() < 0.6 ? 1 + Math.random() * 6 : 0; if (p.wait) p.facing += (Math.random() - 0.5) * 2; }
    else { p.grazing = 1; p.wait = 4 + Math.random() * 10; }
  }

  /** Glitzern und leichte Wellen auf dem Wasser (unter allen Objekten) */
  drawWater(g: CanvasRenderingContext2D, iso: Iso, onScreen: (x: number, y: number) => boolean, t: number) {
    const w = this.map.w;
    g.lineCap = 'round';
    for (const i of this.water) {
      const x = i % w, y = (i / w) | 0;
      const [sx, sy] = iso(x + 0.5, y + 0.5);
      if (!onScreen(sx, sy)) continue;
      const h1 = hash(x, y, 31), h2 = hash(x, y, 32);
      // ziehende, schwache Wellenlinie (auf jeder zweiten Kachel)
      if (h1 < 0.5) {
        const ph = (t * 0.12 + h2) % 1;
        const wx = sx + (h2 - 0.5) * 40 + ph * 14, wy = sy + (h1 * 2 - 0.5) * 18 - ph * 7;
        g.globalAlpha = 0.13 * Math.sin(ph * Math.PI);
        g.strokeStyle = '#d8e8ec'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(wx - 7, wy); g.quadraticCurveTo(wx, wy - 2, wx + 7, wy); g.stroke();
      }
      // kurzes Funkeln in der Sonne
      const v = Math.sin(t * (1.1 + h2) + h1 * 40);
      if (v > 0.9) {
        const a = (v - 0.9) / 0.1;
        g.globalAlpha = a * 0.85; g.strokeStyle = '#fffbe8'; g.lineWidth = 1.2;
        const gx = sx + (h1 - 0.5) * 44, gy = sy + (h2 - 0.5) * 20, l = 1.5 + a * 2.5;
        g.beginPath(); g.moveTo(gx - l, gy); g.lineTo(gx + l, gy); g.stroke();
      }
    }
    g.globalAlpha = 1; g.lineCap = 'butt';
  }

  /** Weidetiere (Kühe, Pferde) mit Kachelposition – für die Klangkulisse */
  animals(): { kind: 'kuh' | 'pferd'; x: number; y: number }[] {
    return this.walkers.filter((p) => p.home).map((p) => ({ kind: p.key === 'life.pferd' ? 'pferd' : 'kuh', x: p.x, y: p.y }));
  }

  /** Dorfbewohner, Kühe und Pferde als tiefensortierte Objekte */
  items(g: CanvasRenderingContext2D, iso: Iso, onScreen: (x: number, y: number) => boolean, shown: (x: number, y: number) => boolean, out: Item[]) {
    for (const p of this.walkers) {
      if (!assets.has(p.key)) continue;
      const [sx, sy] = iso(p.x, p.y);
      if (!onScreen(sx, sy) || !shown(p.x, p.y)) continue;
      const frame = dirFrame8(p.facing), row = p.row;
      out.push({ d: p.x + p.y, draw: () => assets.sprite(g, p.key, sx, sy, { frame, row }) });
    }
  }

  /** Wolkenschatten und Vögel über allem (unter dem Nebel) */
  drawSky(g: CanvasRenderingContext2D, iso: Iso, view: [number, number, number, number], t: number) {
    const [vx0, vy0, vx1, vy1] = view;
    for (const c of this.clouds) {
      const [sx, sy] = iso(c.x, c.y);
      const W = 1100 * c.s, H = 560 * c.s;
      if (sx + W / 2 < vx0 || sx - W / 2 > vx1 || sy + H / 2 < vy0 || sy - H / 2 > vy1) continue;
      g.globalAlpha = 0.2;
      g.drawImage(this.cloudImgs[c.img], sx - W / 2, sy - H / 2, W, H);
    }
    g.globalAlpha = 1;
    for (const f of this.flocks) {
      const dir = Math.sign(iso(f.x + f.vx, f.y + f.vy)[0] - iso(f.x, f.y)[0]) || 1;
      for (const b of f.birds) {
        const bx = f.x + b.ox + Math.sin(t * 0.7 + b.ph) * 0.3, by = f.y + b.oy + Math.cos(t * 0.6 + b.ph) * 0.3;
        const [sx, sy] = iso(bx, by);
        if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1 + 200) continue;
        // Schatten am Boden
        g.fillStyle = 'rgba(0,0,0,0.16)';
        g.beginPath(); g.ellipse(sx + 6, sy + 3, 2.6, 1.1, 0, 0, Math.PI * 2); g.fill();
        // Flügelschlag mit Gleitphasen
        const flapOn = Math.sin(t * 0.9 + b.ph) > -0.3;
        const wing = flapOn ? Math.sin(t * 11 + b.ph * 3) : 0.25;
        const y0 = sy - f.alt - b.oy * 4;
        g.strokeStyle = '#1e1c19'; g.lineWidth = 1.1;
        g.beginPath();
        g.moveTo(sx - 3.6, y0 - wing * 2.6);
        g.quadraticCurveTo(sx - 1.5, y0 - 1.2 - wing * 0.8, sx + dir * 0.3, y0);
        g.quadraticCurveTo(sx + 1.5, y0 - 1.2 - wing * 0.8, sx + 3.6, y0 - wing * 2.6);
        g.stroke();
      }
    }
  }
}

const dirFrame8 = (facing: number) => ((Math.round(facing / (Math.PI / 4)) % 8) + 8) % 8;

/** kürzester Weg über die Dorfstraßen (Breitensuche); Ergebnis ohne Startkachel */
function streetPath(from: number, to: number, set: Set<number>, w: number): [number, number][] {
  if (!set.has(from)) {
    // vom Rand zurück auf die nächstgelegene Straßenkachel
    let best = -1, bd = 1e9;
    for (const i of set) { const d = Math.abs((i % w) - (from % w)) + Math.abs(Math.floor(i / w) - Math.floor(from / w)); if (d < bd) { bd = d; best = i; } }
    from = best;
  }
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const c = q.shift()!;
    if (c === to) break;
    for (const n of [c + 1, c - 1, c + w, c - w]) if (set.has(n) && !prev.has(n)) { prev.set(n, c); q.push(n); }
  }
  if (!prev.has(to)) return [];
  const out: [number, number][] = [];
  for (let c = to; c !== -1 && c !== from; c = prev.get(c)!) out.push([c % w, Math.floor(c / w)]);
  return out.reverse();
}

/** weicher Wolkenschatten aus vielen überlagerten Flecken */
function cloudTexture(seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 22; k++) {
    const a = hash(seed, k, 40) * Math.PI * 2, r = Math.sqrt(hash(seed, k, 41)) * 0.8;
    const x = 128 + Math.cos(a) * r * 90, y = 64 + Math.sin(a) * r * 40, rad = 18 + hash(seed, k, 42) * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(10,14,20,0.55)'); gr.addColorStop(1, 'rgba(10,14,20,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}
