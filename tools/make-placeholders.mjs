// Erzeugt isometrische Platzhalter-Grafiken (SVG) in assets/graphics und die assets/manifest.json.
// Bereits vorhandene Dateien werden NICHT überschrieben (außer mit --force),
// damit eigene Grafiken erhalten bleiben.
// Aufruf: npm run placeholders   bzw.   npm run placeholders -- --force
//
// Projektion: eine Kachel ist eine Raute von 64×32 Pixeln. Ein Punkt (x, y, z) in Kachel-
// einheiten erscheint bei ((x − y)·32, (x + y)·16 − z·32). Höhe 1 = 32 Pixel.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { makeUnits } from './unit-models.mjs';

const ROOT = new URL('../assets/', import.meta.url);
const force = process.argv.includes('--force');
const HW = 32, HH = 16, ZS = 32;
const manifest = {
  _info: [
    'Zuordnung Grafik-Schlüssel -> Datei (relativ zu assets/). Eigene Grafiken (PNG/SVG/WebP) hier eintragen oder Datei gleichen Namens ersetzen.',
    'Bodenkacheln: Raute 64x32. Gebäude: Breite = Größe x 64; die untere Spitze der Grundfläche liegt unten in der Bildmitte.',
    'sprites.anchor = Bodenpunkt im Einzelbild in Pixeln. sprites.frames = Anzahl Blickrichtungen nebeneinander (8 oder 16),',
    'beginnend mit Südost (rechts unten), dann im Uhrzeigersinn. sprites.rows = Animationsbilder untereinander (Infanterie: Stehen, Schritt, Schritt).',
    'Panzer haben zusätzlich ein Turm-Bild (Schlüssel + .turm), das sich unabhängig zur Zielrichtung dreht.',
  ],
  tile: { width: 64, height: 32 },
  images: {},
  sprites: {},
};

function svg(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>\n`;
}
function put(key, file, content, meta) {
  manifest.images[key] = `graphics/${file}`;
  if (meta) manifest.sprites[key] = meta;
  const url = new URL(`graphics/${file}`, ROOT);
  mkdirSync(dirname(url.pathname), { recursive: true });
  if (force || !existsSync(url)) writeFileSync(url, content);
}
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// ---------- Farben ----------
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
/** Helligkeit einer Seitenfläche nach ihrer Normalen (Licht von links oben) */
const faceLight = (nx, ny) => 0.78 + 0.16 * (ny - nx);

// ---------- 3D-Primitive ----------
class Scene {
  constructor(ox, oy) { this.ox = ox; this.oy = oy; this.out = []; }
  P(x, y, z = 0) { return [this.ox + (x - y) * HW, this.oy + (x + y) * HH - z * ZS]; }
  poly(pts, fill, stroke = 'rgba(0,0,0,0.35)') {
    this.out.push(`<path d="M${pts.map(([a, b]) => `${a.toFixed(1)} ${b.toFixed(1)}`).join('L')}Z" fill="${fill}" stroke="${stroke}" stroke-width="0.7" stroke-linejoin="round"/>`);
  }
  raw(s) { this.out.push(s); }
  /** Quader: Mitte (cx,cy), Länge l entlang Richtung a, Breite w, Höhe h, Unterkante z */
  box({ cx = 0, cy = 0, a = 0, l, w, h, z = 0, color }) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const loc = [[l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2], [-l / 2, -w / 2]];
    const pts = loc.map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca]);
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      let nx = q[1] - p[1], ny = -(q[0] - p[0]);
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      // Normale nach außen ausrichten
      const mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      if (nx + ny <= 0.001) continue; // vom Betrachter abgewandt
      this.poly([this.P(p[0], p[1], z), this.P(q[0], q[1], z), this.P(q[0], q[1], z + h), this.P(p[0], p[1], z + h)], shade(color, faceLight(nx, ny)));
    }
    this.poly(pts.map(([x, y]) => this.P(x, y, z + h)), shade(color, 1.08));
  }
  /** Senkrechtes Prisma über einem konvexen Grundriss (Weltkoordinaten), z. B. Schiffsrumpf */
  prism(pts, z, h, color) {
    let cx = 0, cy = 0;
    for (const [x, y] of pts) { cx += x / pts.length; cy += y / pts.length; }
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      let nx = q[1] - p[1], ny = -(q[0] - p[0]);
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      const mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      if (nx + ny <= 0.001) continue;
      this.poly([this.P(p[0], p[1], z), this.P(q[0], q[1], z), this.P(q[0], q[1], z + h), this.P(p[0], p[1], z + h)], shade(color, faceLight(nx, ny)));
    }
    this.poly(pts.map(([x, y]) => this.P(x, y, z + h)), shade(color, 1.12));
  }
  /** senkrechter Zylinder */
  cyl({ cx, cy, r, h, z = 0, color, topColor }) {
    const [bx, by] = this.P(cx, cy, z), [, ty] = this.P(cx, cy, z + h);
    const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
    this.raw(`<path d="M${bx - rx} ${ty} L${bx - rx} ${by} A${rx} ${ry} 0 0 0 ${bx + rx} ${by} L${bx + rx} ${ty} Z" fill="${shade(color, 0.85)}" stroke="rgba(0,0,0,0.35)" stroke-width="0.7"/>`);
    this.raw(`<path d="M${bx - rx * 0.2} ${ty} L${bx - rx * 0.2} ${by + ry * 0.98} A${rx} ${ry} 0 0 0 ${bx + rx} ${by} L${bx + rx} ${ty} Z" fill="${shade(color, 0.72)}" opacity="0.6"/>`);
    this.raw(`<ellipse cx="${bx}" cy="${ty}" rx="${rx}" ry="${ry}" fill="${topColor ?? shade(color, 1.1)}" stroke="rgba(0,0,0,0.35)" stroke-width="0.7"/>`);
  }
  /** Linie im Raum (Rohr, Mast) */
  line(a, b, color, width) {
    const [x1, y1] = this.P(...a), [x2, y2] = this.P(...b);
    this.raw(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${width}" stroke-linecap="round"/>`);
  }
  /** Haus mit Satteldach (First entlang x) */
  house({ cx, cy, l, w, h, roofH, wall, roof }) {
    this.box({ cx, cy, l, w, h, color: wall });
    const x0 = cx - l / 2, x1 = cx + l / 2, y0 = cy - w / 2 - 0.04, y1 = cy + w / 2 + 0.04;
    const rz = h + roofH;
    this.poly([this.P(x1 + 0.04, cy, rz), this.P(x1, y1, h), this.P(x1, y0, h)], shade(wall, 0.7));
    this.poly([this.P(x0 - 0.04, y0, h), this.P(x1 + 0.04, y0, h), this.P(x1 + 0.04, cy, rz), this.P(x0 - 0.04, cy, rz)], shade(roof, 1.05));
    this.poly([this.P(x0 - 0.04, cy, rz), this.P(x1 + 0.04, cy, rz), this.P(x1 + 0.04, y1, h), this.P(x0 - 0.04, y1, h)], shade(roof, 0.85));
  }
  /** flacher Haufen (Kohle, Erz) */
  pile({ cx, cy, r, h, color }) {
    const [bx, by] = this.P(cx, cy, 0), [, ty] = this.P(cx, cy, h);
    const rx = r * HW * Math.SQRT2, ry = r * HH * Math.SQRT2;
    this.raw(`<path d="M${bx - rx} ${by} Q${bx - rx * 0.4} ${ty} ${bx} ${ty} Q${bx + rx * 0.4} ${ty} ${bx + rx} ${by} A${rx} ${ry} 0 0 1 ${bx - rx} ${by} Z" fill="${color}" stroke="rgba(0,0,0,0.4)" stroke-width="0.7"/>`);
    this.raw(`<path d="M${bx - rx * 0.5} ${by - ry * 0.2} Q${bx - rx * 0.2} ${ty + 3} ${bx} ${ty + 1}" stroke="${shade(color, 1.6)}" stroke-width="1.5" fill="none" opacity="0.7"/>`);
  }
  /** Fensterreihe auf einer sichtbaren Seitenfläche eines Quaders (side 'x' = rechte, 'y' = linke Front) */
  windows({ cx, cy, l, w, z, side, n, h = 0.14, ww = 0.11, lit = 0.5, seed: sd = 1 }) {
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const on = ((sd * 9301 + i * 49297) % 233280) / 233280 < lit;
      const glass = on ? '#ffd27a' : '#2b343c';
      let q;
      if (side === 'y') {
        const x = cx - l / 2 + l * t, y = cy + w / 2 + 0.005;
        q = [this.P(x - ww / 2, y, z), this.P(x + ww / 2, y, z), this.P(x + ww / 2, y, z + h), this.P(x - ww / 2, y, z + h)];
      } else {
        const y = cy - w / 2 + w * t, x = cx + l / 2 + 0.005;
        q = [this.P(x, y - ww / 2, z), this.P(x, y + ww / 2, z), this.P(x, y + ww / 2, z + h), this.P(x, y - ww / 2, z + h)];
      }
      this.poly(q, glass, 'rgba(20,16,10,0.7)');
      if (on) {
        const mx = (q[0][0] + q[2][0]) / 2, my = (q[0][1] + q[2][1]) / 2;
        this.raw(`<ellipse cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" rx="4" ry="4" fill="#ffc860" opacity="0.28"/>`);
      }
    }
  }
  /** Holzkiste */
  crate(cx, cy, z = 0, s = 0.17) {
    this.box({ cx, cy, l: s, w: s, h: s * 0.85, z, color: '#8d6b3c' });
    const [ax, ay] = this.P(cx - s / 2, cy + s / 2, z + s * 0.42), [bx, by] = this.P(cx + s / 2, cy + s / 2, z + s * 0.42);
    this.raw(`<line x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#5a4222" stroke-width="0.8"/>`);
  }
  /** Fass */
  barrel(cx, cy, color = '#5d6b3a') {
    this.cyl({ cx, cy, r: 0.06, h: 0.17, color, topColor: shade(color, 1.25) });
  }
  /** Pyramidendach bzw. Turmspitze über quadratischem Grundriss */
  spire(cx, cy, s, z, h, color) {
    const a = this.P(cx, cy, z + h);
    const c = [[cx - s / 2, cy + s / 2], [cx + s / 2, cy + s / 2], [cx + s / 2, cy - s / 2]].map(([x, y]) => this.P(x, y, z));
    this.poly([c[0], c[1], a], shade(color, 0.85));
    this.poly([c[1], c[2], a], shade(color, 1.05));
  }
  toString() { return this.out.join(''); }
}

// ---------- Bodenkacheln (Raute 64×32) ----------
const DIAMOND = 'M32 0 L64 16 L32 32 L0 16 Z';
function groundTile(base, specks) {
  let s = `<defs><clipPath id="d"><path d="${DIAMOND}"/></clipPath></defs><path d="${DIAMOND}" fill="${base}"/><g clip-path="url(#d)">`;
  for (const [color, n, r0, r1] of specks) {
    for (let i = 0; i < n; i++) s += `<ellipse cx="${(rnd() * 64).toFixed(1)}" cy="${(rnd() * 32).toFixed(1)}" rx="${(r0 + rnd() * (r1 - r0)).toFixed(1)}" ry="${((r0 + rnd() * (r1 - r0)) / 2).toFixed(1)}" fill="${color}"/>`;
  }
  return svg(64, 32, s + '</g>');
}
put('terrain.gras', 'terrain/gras.svg', groundTile('#628f3e', [['#6e9c48', 14, 1, 3], ['#557d34', 12, 1, 2.5]]));
put('terrain.waldboden', 'terrain/waldboden.svg', groundTile('#4b7230', [['#3f6327', 16, 1, 3.5], ['#577d38', 8, 1, 2]]));
put('terrain.wasser', 'terrain/wasser.svg', groundTile('#2d5f88', [['#3a719c', 6, 3, 7], ['#255275', 5, 3, 6]]));
put('terrain.felsboden', 'terrain/felsboden.svg', groundTile('#76716a', [['#8a857c', 12, 1, 3], ['#5f5b55', 10, 1, 3]]));
put('terrain.sand', 'terrain/sand.svg', groundTile('#cbb67c', [['#baa468', 14, 0.8, 2], ['#d8c590', 8, 1, 2]]));

// Vorkommen (transparent, über dem Boden)
function depositTile(fill, hi) {
  let s = `<defs><clipPath id="d"><path d="${DIAMOND}"/></clipPath></defs><g clip-path="url(#d)">`;
  for (let i = 0; i < 7; i++) {
    const x = 12 + rnd() * 40, y = 8 + rnd() * 16, r = 2.5 + rnd() * 3;
    s += `<path d="M${x - r} ${y} L${x - r / 3} ${y - r * 0.8} L${x + r} ${y - r / 3} L${x + r / 2} ${y + r / 2} Z" fill="${fill}" stroke="${hi}" stroke-width="0.8"/>`;
  }
  return svg(64, 32, s + '</g>');
}
put('deposit.kohle', 'terrain/vorkommen_kohle.svg', depositTile('#1c1c1c', '#555'));
put('deposit.eisen', 'terrain/vorkommen_eisen.svg', depositTile('#8a4a2e', '#c27a55'));
put('deposit.gold', 'terrain/vorkommen_gold.svg', depositTile('#e0b52a', '#fff0a0'));

// ---------- Geländeobjekte (stehen auf der Kachelmitte) ----------
let gid = 0;
/** Farbverlauf für weiche, plastische Formen (Licht von links oben) */
function grad(light, dark) {
  const id = `g${gid++}`;
  return [`<radialGradient id="${id}" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></radialGradient>`, `url(#${id})`];
}
/** gezackter Nadelbaum-Etagenrand */
function tier(ax, top, bot, w, light, dark) {
  const [def, fill] = grad(light, dark);
  let d = `M${ax} ${top}`;
  const n = 6;
  for (let i = 1; i <= n; i++) { const t = i / n; d += ` L${(ax + w * t).toFixed(1)} ${(top + (bot - top) * t + (i % 2 ? 2 : -1)).toFixed(1)}`; }
  d += ` Q${ax} ${bot + 5} ${ax - w} ${bot}`;
  for (let i = n - 1; i >= 1; i--) { const t = i / n; d += ` L${(ax - w * t).toFixed(1)} ${(top + (bot - top) * t + (i % 2 ? 2 : -1)).toFixed(1)}`; }
  return `<defs>${def}</defs><path d="${d} Z" fill="${fill}" stroke="rgba(10,30,10,0.55)" stroke-width="0.6"/>`;
}
function crown(cx, cy, r, light, dark) {
  const [def, fill] = grad(light, dark);
  return `<defs>${def}</defs><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}"/>`;
}
function tree(variant) {
  const W = 64, H = 92, ax = 32, ay = 76;
  let s = `<ellipse cx="${ax + 7}" cy="${ay + 1}" rx="17" ry="7" fill="rgba(0,0,0,0.3)"/>`;
  if (variant === 0 || variant === 2) {
    // Fichte (0) bzw. schlanke dunkle Tanne (2)
    const slim = variant === 2 ? 0.75 : 1;
    s += `<rect x="${ax - 2}" y="${ay - 14}" width="4" height="14" fill="#4a301b"/>`;
    const light = variant === 2 ? '#3f6b3a' : '#4d7d3a', dark = variant === 2 ? '#14301a' : '#1d4020';
    for (let i = 0; i < 4; i++) {
      const w = (19 - i * 4) * slim, bot = ay - 6 - i * 13, top = bot - 20;
      s += tier(ax, top, bot, w, light, dark);
    }
  } else if (variant === 1) {
    // Laubbaum: viele Blattballen, unten dunkler
    s += `<path d="M${ax - 2} ${ay} L${ax - 3} ${ay - 22} L${ax + 3} ${ay - 22} L${ax + 2} ${ay} Z" fill="#4e3420"/>`;
    for (const [dx, dy, r] of [[-11, -26, 11], [10, -27, 12], [0, -22, 11], [-7, -38, 12], [7, -40, 12], [0, -50, 10], [-13, -40, 8], [13, -36, 8]]) {
      s += crown(ax + dx, ay + dy, r, '#77a84a', '#2c5420');
    }
  } else {
    // Birke: heller Stamm, lockere hellgrüne Krone
    s += `<rect x="${ax - 2}" y="${ay - 34}" width="4" height="34" fill="#e8e4da"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="${ax - 2}" y="${ay - 30 + i * 5}" width="${2 + (i % 2) * 2}" height="1.3" fill="#2a2a2a"/>`;
    for (const [dx, dy, r] of [[-8, -40, 9], [8, -42, 9], [0, -50, 10], [-4, -32, 7], [6, -32, 7]]) s += crown(ax + dx, ay + dy, r, '#a6cf63', '#4f7f2c');
  }
  return [svg(W, H, s), { anchor: [ax, ay] }];
}
put('object.baum1', 'terrain/baum_nadel.svg', ...tree(0));
put('object.baum2', 'terrain/baum_laub.svg', ...tree(1));
put('object.baum3', 'terrain/baum_tanne.svg', ...tree(2));
put('object.baum4', 'terrain/baum_birke.svg', ...tree(3));
function rock(variant) {
  const sc = new Scene(32, 52);
  sc.raw(`<ellipse cx="36" cy="54" rx="28" ry="12" fill="rgba(0,0,0,0.25)"/>`);
  const c = variant ? ['#857d70', '#958d7e', '#6f685d'] : ['#7a7570', '#8b8680', '#67625c'];
  sc.box({ cx: 0.05, cy: -0.15, a: 0.3 + variant, l: 0.62, w: 0.5, h: 0.55 - variant * 0.15, color: c[0] });
  sc.box({ cx: -0.18, cy: 0.12, a: -0.4, l: 0.5, w: 0.42, h: 0.38, color: c[1] });
  sc.box({ cx: 0.22, cy: 0.2, a: 0.8, l: 0.36, w: 0.3, h: 0.26, color: c[2] });
  // Moos und Flechten
  for (let i = 0; i < 7; i++) sc.raw(`<ellipse cx="${(18 + rnd() * 28).toFixed(1)}" cy="${(26 + rnd() * 18).toFixed(1)}" rx="${(2 + rnd() * 3).toFixed(1)}" ry="${(1 + rnd() * 1.5).toFixed(1)}" fill="#5b7a3a" opacity="0.55"/>`);
  return [svg(64, 64, sc.toString()), { anchor: [32, 52] }];
}
put('object.fels', 'terrain/fels.svg', ...rock(0));
put('object.fels2', 'terrain/fels2.svg', ...rock(1));

// ---------- Kleinteile auf dem Boden (werden flach in den Boden gezeichnet) ----------
function tuft(colors, n = 11) {
  let s = '';
  for (let i = 0; i < n; i++) {
    const x = 12 + (rnd() - 0.5) * 16, base = 19 + rnd() * 2, h = 3 + rnd() * 6, lean = (rnd() - 0.5) * 7;
    s += `<path d="M${x.toFixed(1)} ${base.toFixed(1)} Q${(x + lean * 0.4).toFixed(1)} ${(base - h * 0.6).toFixed(1)} ${(x + lean).toFixed(1)} ${(base - h).toFixed(1)}" stroke="${colors[i % colors.length]}" stroke-width="${(0.6 + rnd() * 0.5).toFixed(2)}" fill="none" stroke-linecap="round" opacity="${(0.55 + rnd() * 0.35).toFixed(2)}"/>`;
  }
  return s;
}
put('decor.gras', 'terrain/deko_gras.svg', svg(24, 22, tuft(['#5b8a34', '#77a545', '#4a7a2b'])), { anchor: [12, 20] });
put('decor.trockengras', 'terrain/deko_trockengras.svg', svg(24, 22, tuft(['#a39a52', '#8a8a45', '#b5a868'])), { anchor: [12, 20] });
put('decor.blumen', 'terrain/deko_blumen.svg', svg(24, 22, tuft(['#4f7d2e', '#6c9a3c'], 6) + Array.from({ length: 5 }, () => `<circle cx="${(6 + rnd() * 12).toFixed(1)}" cy="${(8 + rnd() * 8).toFixed(1)}" r="1.5" fill="${['#f4f1e8', '#f3d23a', '#b88ad8', '#e8584a'][Math.floor(rnd() * 4)]}"/>`).join('')), { anchor: [12, 20] });
put('decor.steine', 'terrain/deko_steine.svg', svg(24, 16, Array.from({ length: 3 }, (_, i) => {
  const x = 6 + i * 6 + rnd() * 2, y = 10 + rnd() * 3, r = 2 + rnd() * 2;
  return `<ellipse cx="${x.toFixed(1)}" cy="${(y + 1).toFixed(1)}" rx="${(r + 0.6).toFixed(1)}" ry="${(r * 0.6).toFixed(1)}" fill="rgba(0,0,0,0.25)"/><ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.7).toFixed(1)}" fill="#8e8a82"/><ellipse cx="${(x - r * 0.3).toFixed(1)}" cy="${(y - r * 0.25).toFixed(1)}" rx="${(r * 0.45).toFixed(1)}" ry="${(r * 0.25).toFixed(1)}" fill="#b5b1a8"/>`;
}).join('')), { anchor: [12, 14] });
put('decor.busch', 'terrain/deko_busch.svg', svg(36, 28, `<ellipse cx="20" cy="25" rx="14" ry="4" fill="rgba(0,0,0,0.28)"/>` +
  [[11, 17, 7], [24, 16, 8], [17, 12, 8], [28, 20, 5], [8, 21, 5]].map(([x, y, r]) => crown(x, y, r, '#6e9d40', '#2a4f1d')).join('')), { anchor: [18, 25] });
put('decor.farn', 'terrain/deko_farn.svg', svg(28, 22, Array.from({ length: 6 }, (_, i) => {
  const a = -Math.PI * 0.9 + (i / 5) * Math.PI * 0.8, l = 9 + rnd() * 3;
  return `<path d="M14 19 Q${(14 + Math.cos(a) * l * 0.6).toFixed(1)} ${(19 + Math.sin(a) * l * 0.9).toFixed(1)} ${(14 + Math.cos(a) * l).toFixed(1)} ${(19 + Math.sin(a) * l * 0.6).toFixed(1)}" stroke="#3f6e2a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`;
}).join('')), { anchor: [14, 19] });

// ---------- Gebäude ----------
// Lokale Koordinaten 0..size; untere Spitze der Grundfläche liegt unten in der Bildmitte.
function building(size, extraH, draw, frames = 1) {
  const W = size * 64, H = size * 32 + extraH;
  let body = '';
  for (let f = 0; f < frames; f++) {
    const sc = new Scene(f * W + W / 2, H - size * 32);
    draw(sc, (f * Math.PI) / 4);
    body += sc.toString();
  }
  return [svg(W * frames, H, body), frames > 1 ? { frames, anchor: [W / 2, H] } : { anchor: [W / 2, H] }];
}
const slab = (sc, s, color = '#8e8b80') => sc.box({ cx: s / 2, cy: s / 2, l: s - 0.12, w: s - 0.12, h: 0.06, color });

put('building.bauhof', 'buildings/bauhof.svg', ...building(3, 96, (sc) => {
  slab(sc, 3);
  sc.box({ cx: 1.0, cy: 1.05, l: 1.5, w: 1.4, h: 0.75, z: 0.06, color: '#b9b4a4' });
  sc.box({ cx: 1.0, cy: 1.05, l: 1.1, w: 1.0, h: 0.2, z: 0.81, color: '#6b8fb3' });
  sc.windows({ cx: 1.0, cy: 1.05, l: 1.5, w: 1.4, z: 0.35, side: 'y', n: 5, lit: 0.5, seed: 2 });
  sc.windows({ cx: 1.0, cy: 1.05, l: 1.5, w: 1.4, z: 0.35, side: 'x', n: 4, lit: 0.4, seed: 4 });
  sc.box({ cx: 2.2, cy: 0.9, l: 0.9, w: 1.1, h: 0.45, z: 0.06, color: '#a7a293' });
  sc.windows({ cx: 2.2, cy: 0.9, l: 0.9, w: 1.1, z: 0.2, side: 'x', n: 3, lit: 0.6, seed: 6 });
  sc.crate(2.75, 1.6, 0.06); sc.crate(2.75, 1.8, 0.06); sc.crate(2.75, 1.7, 0.2); sc.barrel(2.55, 1.6); sc.barrel(2.62, 1.75, '#7a4a2a');
  sc.cyl({ cx: 2.15, cy: 2.2, r: 0.5, h: 0.03, z: 0.06, color: '#55534d', topColor: '#5d5b55' });
  sc.raw(`<text x="${sc.P(2.15, 2.2, 0.1)[0]}" y="${sc.P(2.15, 2.2, 0.1)[1] + 4}" font-family="Arial" font-weight="bold" font-size="13" fill="#e8e8e8" text-anchor="middle">H</text>`);
  sc.box({ cx: 0.55, cy: 2.35, l: 0.12, w: 0.12, h: 2.0, z: 0.06, color: '#e0b52a' });
  sc.box({ cx: 1.2, cy: 2.35, a: 0, l: 1.6, w: 0.1, h: 0.1, z: 2.0, color: '#e0b52a' });
  sc.line([1.9, 2.35, 2.0], [1.9, 2.35, 1.3], '#333', 1);
}));
put('building.kraftwerk', 'buildings/kraftwerk.svg', ...building(2, 80, (sc) => {
  slab(sc, 2);
  sc.box({ cx: 1.45, cy: 0.5, l: 0.8, w: 0.6, h: 0.45, z: 0.06, color: '#9c8a6e' });
  sc.windows({ cx: 1.45, cy: 0.5, l: 0.8, w: 0.6, z: 0.22, side: 'x', n: 2, lit: 0.9, seed: 1 });
  sc.cyl({ cx: 0.55, cy: 0.6, r: 0.42, h: 1.0, z: 0.06, color: '#cfccc2', topColor: '#e9e9e9' });
  sc.cyl({ cx: 1.2, cy: 1.4, r: 0.42, h: 1.0, z: 0.06, color: '#cfccc2', topColor: '#e9e9e9' });
  sc.cyl({ cx: 1.75, cy: 0.35, r: 0.08, h: 1.5, z: 0.06, color: '#8a5a3a' });
  sc.barrel(1.8, 1.55); sc.barrel(1.88, 1.65); sc.barrel(1.72, 1.7, '#7a4a2a');
}));
function mine(pileColor) {
  return building(2, 72, (sc) => {
    slab(sc, 2, '#7f7a6c');
    sc.box({ cx: 0.55, cy: 0.6, l: 0.8, w: 0.7, h: 0.5, z: 0.06, color: '#7a6d58' });
    // Förderturm
    sc.line([0.95, 0.35, 0.06], [1.05, 0.55, 1.5], '#3a3a3a', 2.5);
    sc.line([1.35, 0.35, 0.06], [1.05, 0.55, 1.5], '#3a3a3a', 2.5);
    sc.line([1.15, 0.85, 0.06], [1.05, 0.55, 1.5], '#3a3a3a', 2);
    const [wx, wy] = sc.P(1.05, 0.55, 1.5);
    sc.raw(`<ellipse cx="${wx}" cy="${wy}" rx="7" ry="5" fill="none" stroke="#222" stroke-width="2"/>`);
    sc.windows({ cx: 0.55, cy: 0.6, l: 0.8, w: 0.7, z: 0.22, side: 'y', n: 2, lit: 0.6, seed: 8 });
    sc.pile({ cx: 1.35, cy: 1.4, r: 0.45, h: 0.55, color: pileColor });
    sc.crate(0.4, 1.55, 0.06); sc.crate(0.6, 1.6, 0.06); sc.barrel(0.45, 1.8);
  });
}
put('building.kohlebergwerk', 'buildings/kohlebergwerk.svg', ...mine('#1d1d1d'));
put('building.eisenbergwerk', 'buildings/eisenbergwerk.svg', ...mine('#8a4a2e'));
put('building.goldmine', 'buildings/goldmine.svg', ...mine('#d9a826'));
put('building.kaserne', 'buildings/kaserne.svg', ...building(2, 64, (sc) => {
  slab(sc, 2);
  sc.house({ cx: 1.0, cy: 0.5, l: 1.6, w: 0.55, h: 0.4, roofH: 0.25, wall: '#8f8a6a', roof: '#5f6a45' });
  sc.windows({ cx: 1.0, cy: 0.5, l: 1.6, w: 0.55, z: 0.18, side: 'y', n: 5, lit: 0.5, seed: 12 });
  sc.house({ cx: 0.85, cy: 1.35, l: 1.3, w: 0.55, h: 0.4, roofH: 0.25, wall: '#8f8a6a', roof: '#5f6a45' });
  sc.windows({ cx: 0.85, cy: 1.35, l: 1.3, w: 0.55, z: 0.18, side: 'y', n: 4, lit: 0.5, seed: 14 });
  sc.crate(1.75, 0.95, 0.06); sc.crate(1.75, 1.15, 0.06); sc.barrel(1.6, 1.85); sc.barrel(1.45, 1.85);
  sc.line([1.8, 1.7, 0.06], [1.8, 1.7, 1.3], '#222', 1.5);
  const [fx, fy] = sc.P(1.8, 1.7, 1.3);
  sc.raw(`<path d="M${fx} ${fy} l14 3 l-2 7 l-12 -3 Z" fill="#cc3333" stroke="#661a1a" stroke-width="0.6"/>`);
}));
put('building.panzerfabrik', 'buildings/panzerfabrik.svg', ...building(3, 80, (sc) => {
  slab(sc, 3);
  sc.box({ cx: 1.4, cy: 1.2, l: 2.4, w: 1.8, h: 0.9, z: 0.06, color: '#7f838b' });
  for (let i = 0; i < 4; i++) sc.box({ cx: 0.5 + i * 0.6, cy: 1.2, l: 0.35, w: 1.7, h: 0.12, z: 0.96, color: '#6a6e76' });
  sc.box({ cx: 1.4, cy: 2.15, l: 1.2, w: 0.12, h: 0.65, z: 0.06, color: '#4f5156' });
  sc.cyl({ cx: 2.6, cy: 0.4, r: 0.12, h: 1.5, z: 0.06, color: '#5a5a5a' });
  sc.windows({ cx: 1.4, cy: 1.2, l: 2.4, w: 1.8, z: 0.55, side: 'x', n: 6, h: 0.18, ww: 0.16, lit: 0.6, seed: 21 });
  sc.crate(2.75, 2.5, 0.06); sc.crate(2.75, 2.7, 0.06); sc.crate(2.55, 2.75, 0.06); sc.crate(2.75, 2.6, 0.2);
  sc.barrel(0.3, 2.6); sc.barrel(0.42, 2.72); sc.barrel(0.3, 2.78, '#7a4a2a');
}));
put('building.verwaltung', 'buildings/verwaltung.svg', ...building(2, 72, (sc) => {
  slab(sc, 2);
  sc.box({ cx: 0.95, cy: 0.9, l: 1.5, w: 1.1, h: 0.8, z: 0.06, color: '#d8d2bf' });
  sc.windows({ cx: 0.95, cy: 0.9, l: 1.5, w: 1.1, z: 0.2, side: 'y', n: 6, lit: 0.6, seed: 31 });
  sc.windows({ cx: 0.95, cy: 0.9, l: 1.5, w: 1.1, z: 0.5, side: 'y', n: 6, lit: 0.5, seed: 33 });
  sc.windows({ cx: 0.95, cy: 0.9, l: 1.5, w: 1.1, z: 0.2, side: 'x', n: 4, lit: 0.5, seed: 35 });
  sc.windows({ cx: 0.95, cy: 0.9, l: 1.5, w: 1.1, z: 0.5, side: 'x', n: 4, lit: 0.6, seed: 37 });
  for (let i = 0; i < 5; i++) sc.box({ cx: 0.35 + i * 0.3, cy: 1.6, l: 0.09, w: 0.09, h: 0.75, z: 0.06, color: '#f2eee2' });
  sc.box({ cx: 0.95, cy: 1.15, l: 1.6, w: 1.0, h: 0.1, z: 0.86, color: '#b5ad95' });
  sc.cyl({ cx: 0.95, cy: 0.9, r: 0.3, h: 0.3, z: 0.96, color: '#7d9aa8' });
}));
put('building.geschuetzturm', 'buildings/geschuetzturm.svg', ...building(1, 48, (sc, a) => {
  sc.cyl({ cx: 0.5, cy: 0.5, r: 0.36, h: 0.4, color: '#7c7a70' });
  const fx = Math.cos(a), fy = Math.sin(a);
  const barrel = () => sc.box({ cx: 0.5 + fx * 0.4, cy: 0.5 + fy * 0.4, a, l: 0.5, w: 0.08, h: 0.08, z: 0.55, color: '#2c2c2a' });
  if (fx + fy < 0) barrel();
  sc.box({ cx: 0.5, cy: 0.5, a, l: 0.42, w: 0.36, h: 0.22, z: 0.42, color: '#5b5a54' });
  if (fx + fy >= 0) barrel();
}, 8));

// ---------- Dorf (3×3) mit Kirche ----------
put('village.dorf', 'village/dorf.svg', ...building(3, 110, (sc) => {
  // Dorfplatz und Gassen
  sc.poly([sc.P(0.1, 0.1), sc.P(2.9, 0.1), sc.P(2.9, 2.9), sc.P(0.1, 2.9)], '#8f8a5c', 'none');
  sc.poly([sc.P(0.9, 1.0), sc.P(2.0, 1.0), sc.P(2.0, 2.0), sc.P(0.9, 2.0)], '#b3a37a', 'none');
  sc.poly([sc.P(1.3, 0.1), sc.P(1.6, 0.1), sc.P(1.6, 2.9), sc.P(1.3, 2.9)], '#a99a72', 'none');
  sc.poly([sc.P(0.1, 2.05), sc.P(2.9, 2.05), sc.P(2.9, 2.3), sc.P(0.1, 2.3)], '#a99a72', 'none');
  // Gärten / Hecken hinten
  for (const [x, y] of [[0.35, 0.35], [2.55, 0.4]]) sc.raw(crown(...sc.P(x, y, 0.12), 7, '#6f9a42', '#2c4f1d'));
  // Kirche (Schiff entlang x, Turm vorne rechts)
  sc.house({ cx: 0.85, cy: 0.62, l: 1.0, w: 0.5, h: 0.48, roofH: 0.32, wall: '#e6dcc2', roof: '#7d3a2a' });
  sc.windows({ cx: 0.85, cy: 0.62, l: 1.0, w: 0.5, z: 0.2, side: 'y', n: 3, h: 0.2, ww: 0.08, lit: 0.7, seed: 3 });
  sc.box({ cx: 1.48, cy: 0.62, l: 0.34, w: 0.34, h: 1.25, color: '#e1d6ba' });
  sc.windows({ cx: 1.48, cy: 0.62, l: 0.34, w: 0.34, z: 0.9, side: 'x', n: 1, h: 0.2, ww: 0.1, lit: 0 });
  sc.windows({ cx: 1.48, cy: 0.62, l: 0.34, w: 0.34, z: 0.9, side: 'y', n: 1, h: 0.2, ww: 0.1, lit: 0 });
  sc.spire(1.48, 0.62, 0.38, 1.25, 0.95, '#4f6b5a');
  sc.line([1.48, 0.62, 2.2], [1.48, 0.62, 2.45], '#c9a64a', 1.4);
  sc.line([1.43, 0.62, 2.37], [1.53, 0.62, 2.37], '#c9a64a', 1.2);
  // Häuser mit Fachwerk-Farben und beleuchteten Fenstern
  const houses = [[2.35, 0.75, 0.75, '#e3d6b5', '#a8452e'], [0.5, 1.5, 0.6, '#d8c9a2', '#8f3f2a'], [2.45, 1.5, 0.7, '#e9dfc6', '#b55235'],
    [0.55, 2.55, 0.75, '#e3d6b5', '#9c4630'], [1.95, 2.6, 0.8, '#d9ccab', '#a8452e'], [1.15, 2.6, 0.5, '#e6dcc2', '#7a4a32']];
  houses.forEach(([x, y, l, wall, roof], i) => {
    sc.house({ cx: x, cy: y, l, w: 0.46, h: 0.34, roofH: 0.26, wall, roof });
    sc.windows({ cx: x, cy: y, l, w: 0.46, z: 0.1, side: 'y', n: l > 0.6 ? 3 : 2, h: 0.12, ww: 0.09, lit: 0.55, seed: i + 5 });
    sc.windows({ cx: x, cy: y, l, w: 0.46, z: 0.1, side: 'x', n: 1, h: 0.12, ww: 0.09, lit: 0.5, seed: i + 11 });
    // Schornstein
    sc.box({ cx: x - l * 0.25, cy: y - 0.08, l: 0.07, w: 0.07, h: 0.62, color: '#7a5a48' });
  });
  // Brunnen auf dem Platz, Fässer und Karren
  sc.cyl({ cx: 1.45, cy: 1.5, r: 0.13, h: 0.1, color: '#8d8a80', topColor: '#3e5f74' });
  sc.barrel(1.85, 1.2); sc.barrel(1.95, 1.3, '#7a4a2a'); sc.crate(1.0, 1.85);
  sc.raw(crown(...sc.P(2.7, 2.1, 0.3), 9, '#77a84a', '#2c5420'));
}));

// ---------- Hilfen für Gebäude ----------
const off = (fx, fy, f, s) => [fx * f - fy * s, fy * f + fx * s]; // lokal (vorne f, seitlich s) -> Welt
function hull(sc, fx, fy, len, beam, h, color, at = [0, 0], z = -0.03) {
  const pts = [[len * 0.55, 0], [len * 0.3, beam / 2], [-len * 0.45, beam / 2], [-len * 0.5, beam * 0.35], [-len * 0.5, -beam * 0.35], [-len * 0.45, -beam / 2], [len * 0.3, -beam / 2]]
    .map(([f, sd]) => { const [x, y] = off(fx, fy, f, sd); return [x + at[0], y + at[1]]; });
  sc.prism(pts, z, h, color);
}

// ---------- Weitere Gebäude ----------
put('building.flakstellung', 'buildings/flakstellung.svg', ...building(1, 52, (sc, a) => {
  sc.box({ cx: 0.5, cy: 0.5, l: 0.84, w: 0.84, h: 0.14, color: '#7c7a70' });
  const fx = Math.cos(a), fy = Math.sin(a);
  const barrels = () => {
    for (const side of [-0.07, 0.07]) {
      const [bx, by] = off(fx, fy, 0, side);
      const [ex, ey] = off(fx, fy, 0.42, side);
      sc.line([0.5 + bx, 0.5 + by, 0.32], [0.5 + ex, 0.5 + ey, 0.75], '#262626', 2.4);
    }
  };
  if (fx + fy < 0) barrels();
  sc.cyl({ cx: 0.5, cy: 0.5, r: 0.22, h: 0.22, z: 0.14, color: '#5d6650' });
  if (fx + fy >= 0) barrels();
}, 8));
put('building.forschungszentrum', 'buildings/forschungszentrum.svg', ...building(2, 84, (sc) => {
  slab(sc, 2);
  sc.box({ cx: 0.85, cy: 1.15, l: 1.3, w: 1.0, h: 0.6, z: 0.06, color: '#d9dde0' });
  sc.box({ cx: 0.85, cy: 1.15, l: 1.3, w: 0.2, h: 0.12, z: 0.42, color: '#6b8fb3' });
  sc.cyl({ cx: 1.45, cy: 0.55, r: 0.38, h: 0.45, z: 0.06, color: '#c9ced3' });
  const [dx, dy] = sc.P(1.45, 0.55, 0.51);
  sc.raw(`<path d="M${dx - 21} ${dy} A21 18 0 0 1 ${dx + 21} ${dy} Z" fill="#e8ecef" stroke="rgba(0,0,0,0.35)" stroke-width="0.7"/><path d="M${dx - 2} ${dy - 17} L${dx + 3} ${dy - 17} L${dx + 3} ${dy} L${dx - 2} ${dy} Z" fill="#333" opacity="0.6"/>`);
  sc.line([0.35, 0.5, 0.06], [0.35, 0.5, 1.6], '#555', 1.6);
  const [ax, ay] = sc.P(0.35, 0.5, 1.35);
  sc.raw(`<ellipse cx="${ax + 6}" cy="${ay}" rx="9" ry="6" fill="#ddd" stroke="#666" stroke-width="1" transform="rotate(-25 ${ax + 6} ${ay})"/>`);
}));
put('building.flugfeld', 'buildings/flugfeld.svg', ...building(3, 64, (sc) => {
  slab(sc, 3, '#77746c');
  sc.poly([sc.P(0.25, 1.75, 0.07), sc.P(2.85, 1.75, 0.07), sc.P(2.85, 2.55, 0.07), sc.P(0.25, 2.55, 0.07)], '#4b4b4b', 'none');
  for (let i = 0; i < 5; i++) sc.poly([sc.P(0.45 + i * 0.5, 2.12, 0.075), sc.P(0.7 + i * 0.5, 2.12, 0.075), sc.P(0.7 + i * 0.5, 2.18, 0.075), sc.P(0.45 + i * 0.5, 2.18, 0.075)], '#f2f2f2', 'none');
  sc.cyl({ cx: 2.3, cy: 0.9, r: 0.45, h: 0.02, z: 0.06, color: '#5b5b5b', topColor: '#5f5f5f' });
  sc.raw(`<text x="${sc.P(2.3, 0.9, 0.1)[0]}" y="${sc.P(2.3, 0.9, 0.1)[1] + 4}" font-family="Arial" font-weight="bold" font-size="12" fill="#e8e8e8" text-anchor="middle">H</text>`);
  sc.house({ cx: 0.95, cy: 0.75, l: 1.3, w: 0.95, h: 0.5, roofH: 0.3, wall: '#8f939a', roof: '#6b7078' });
  sc.cyl({ cx: 0.3, cy: 1.45, r: 0.13, h: 0.9, z: 0.06, color: '#c8c4b8' });
  sc.box({ cx: 0.3, cy: 1.45, l: 0.36, w: 0.36, h: 0.2, z: 0.96, color: '#7aa3c0' });
}));

put('building.werft', 'buildings/werft.svg', ...building(3, 88, (sc) => {
  slab(sc, 3, '#827e74');
  // Helling mit Schiffsrumpf im Bau
  sc.poly([sc.P(1.2, 0.3, 0.07), sc.P(2.85, 0.3, 0.07), sc.P(2.85, 1.5, 0.07), sc.P(1.2, 1.5, 0.07)], '#5d5a54', 'none');
  hull(sc, 1, 0, 1.4, 0.55, 0.22, '#8c6f5a', [2.0, 0.9], 0.07);
  // Portalkran
  for (const [x, y] of [[1.25, 0.3], [1.25, 1.5], [2.8, 0.3], [2.8, 1.5]]) sc.box({ cx: x, cy: y, l: 0.08, w: 0.08, h: 1.4, z: 0.07, color: '#d9a51f' });
  sc.box({ cx: 1.25, cy: 0.9, l: 0.1, w: 1.3, h: 0.1, z: 1.45, color: '#e0b52a' });
  sc.box({ cx: 2.8, cy: 0.9, l: 0.1, w: 1.3, h: 0.1, z: 1.45, color: '#e0b52a' });
  sc.box({ cx: 2.0, cy: 0.9, l: 1.7, w: 0.12, h: 0.12, z: 1.5, color: '#e8bf35' });
  // Werkhalle
  sc.house({ cx: 0.9, cy: 2.2, l: 1.4, w: 0.9, h: 0.55, roofH: 0.3, wall: '#9b9a94', roof: '#5f6670' });
  sc.cyl({ cx: 2.4, cy: 2.4, r: 0.15, h: 1.1, z: 0.07, color: '#6a6a6a' });
}));

// ---------- Einheiten (siehe unit-models.mjs) ----------
makeUnits({ Scene, shade, faceLight, svg, put });

// ---------- Symbole (Oberfläche) ----------
put('icon.geld', 'icons/geld.svg', svg(24, 24, `<circle cx="12" cy="12" r="10" fill="#e0b52a" stroke="#8a6a10" stroke-width="2"/><text x="12" y="17" font-family="Arial" font-weight="bold" font-size="13" text-anchor="middle" fill="#6a4f08">T</text>`));
put('icon.kohle', 'icons/kohle.svg', svg(24, 24, `<path d="M3 16 L8 6 L15 8 L21 15 L16 21 L6 20 Z" fill="#222" stroke="#666" stroke-width="1.5"/>`));
put('icon.eisen', 'icons/eisen.svg', svg(24, 24, `<path d="M3 15 L7 9 H19 L21 15 Z" fill="#9aa0a8" stroke="#4a4e54" stroke-width="1.5"/><rect x="3" y="15" width="18" height="4" fill="#7a8088" stroke="#4a4e54" stroke-width="1.5"/>`));
put('icon.gold', 'icons/gold.svg', svg(24, 24, `<path d="M2 18 L6 11 H12 L14 18 Z M10 18 L14 11 H20 L22 18 Z M6 11 L9 5 H15 L18 11 Z" fill="#f0c43a" stroke="#8a6a10" stroke-width="1.2"/>`));
put('icon.strom', 'icons/strom.svg', svg(24, 24, `<path d="M14 2 L5 14 H11 L9 22 L19 9 H13 Z" fill="#f2d33c" stroke="#7a6a10" stroke-width="1.2"/>`));
put('icon.einwohner', 'icons/einwohner.svg', svg(24, 24, `<circle cx="9" cy="8" r="4" fill="#ddd"/><path d="M2 21 q7 -11 14 0 Z" fill="#ddd"/><circle cx="17" cy="9" r="3" fill="#aaa"/><path d="M13 21 q5 -9 10 0 Z" fill="#aaa"/>`));
put('icon.zufriedenheit', 'icons/zufriedenheit.svg', svg(24, 24, `<circle cx="12" cy="12" r="10" fill="#f2d33c" stroke="#7a6a10" stroke-width="1.5"/><circle cx="8.5" cy="10" r="1.5" fill="#333"/><circle cx="15.5" cy="10" r="1.5" fill="#333"/><path d="M7 14 q5 5 10 0" stroke="#333" stroke-width="1.6" fill="none"/>`));
put('icon.bauhof', 'icons/bauhof.svg', svg(24, 24, `<rect x="3" y="8" width="18" height="13" fill="#ccc" stroke="#333" stroke-width="1.5"/><path d="M2 9 L12 3 L22 9 Z" fill="#e0b52a" stroke="#333" stroke-width="1.2"/>`));
put('icon.angriff', 'icons/angriff.svg', svg(24, 24, `<path d="M4 20 L18 6 M14 4 L20 4 L20 10 M4 4 L20 20" stroke="#e33" stroke-width="2.6" fill="none"/>`));

// ---------- Effekte ----------
put('effect.explosion', 'effects/explosion.svg', svg(48, 48, `<circle cx="24" cy="24" r="20" fill="#ff9a1f" opacity="0.85"/><circle cx="24" cy="24" r="13" fill="#ffd34a"/><circle cx="24" cy="24" r="6" fill="#fff6c8"/>`));

// Ton-Einträge (von make-sounds.mjs bzw. eigene Musik) übernehmen
const mUrl = new URL('manifest.json', ROOT);
if (existsSync(mUrl)) {
  const old = JSON.parse(readFileSync(mUrl, 'utf8'));
  for (const k of ['audio', 'music', '_audioInfo']) if (old[k] !== undefined) manifest[k] = old[k];
  // Gerenderte Grafiken (Blender, tools/blender/) haben Vorrang vor den Platzhaltern
  for (const [k, file] of Object.entries(old.images ?? {})) {
    if (!old.sprites?.[k]?.photo) continue;
    manifest.images[k] = file;
    manifest.sprites[k] = old.sprites[k];
  }
}
writeFileSync(mUrl, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${Object.keys(manifest.images).length} Grafiken im Manifest${force ? ' (überschrieben)' : ''}.`);
