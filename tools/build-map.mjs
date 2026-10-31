// Erzeugt data/map/europe.json (Provinzgrenzen, Nachbarn) aus
// data/map/provinces.json und den Natural-Earth-Ländergrenzen (world-atlas).
// Aufruf: npm run map
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { feature } from 'topojson-client';
import { geoConicConformal } from 'd3-geo';
import { Delaunay } from 'd3-delaunay';
import pc from 'polygon-clipping';

const require = createRequire(import.meta.url);
const topo = require('world-atlas/countries-50m.json');
const src = JSON.parse(readFileSync(new URL('../data/map/provinces.json', import.meta.url)));

const EUROPE = new Set([
  'Albania', 'Andorra', 'Austria', 'Belarus', 'Belgium', 'Bosnia and Herz.', 'Bulgaria', 'Croatia',
  'Czechia', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland',
  'Italy', 'Kosovo', 'Latvia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macedonia', 'Moldova',
  'Monaco', 'Montenegro', 'Netherlands', 'Norway', 'Poland', 'Portugal', 'Romania', 'Russia',
  'San Marino', 'Serbia', 'Slovakia', 'Slovenia', 'Spain', 'Sweden', 'Switzerland', 'Ukraine',
  'United Kingdom', 'Vatican', 'Isle of Man', 'Jersey', 'Guernsey', 'Malta', 'Aland',
]);

const BBOX = [-11, 34.5, 41, 71.3]; // lon/lat
const WIDTH = 2400;

const bboxPoly = [[[BBOX[0], BBOX[1]], [BBOX[2], BBOX[1]], [BBOX[2], BBOX[3]], [BBOX[0], BBOX[3]], [BBOX[0], BBOX[1]]]];
const countries = feature(topo, topo.objects.countries).features;

// Ringe über die Datumsgrenze (Russland) in 0..360 verschieben, sonst entstehen Artefakte beim Zuschneiden
function toMulti(geom, name) {
  if (!geom) return [];
  const multi = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  if (name !== 'Russia') return multi;
  return multi.map((poly) => poly.map((ring) => ring.map(([lon, lat]) => [lon < -100 ? lon + 360 : lon, lat])));
}

const euroGeo = [];
const backdropGeo = [];
for (const c of countries) {
  const clipped = pc.intersection(toMulti(c.geometry, c.properties.name), bboxPoly);
  if (!clipped.length) continue;
  (EUROPE.has(c.properties.name) ? euroGeo : backdropGeo).push(...clipped);
}

// fitWidth() nicht nutzbar: polygon-clipping liefert planare Ringrichtung, d3-geo erwartet sphärische
const projection = geoConicConformal().parallels([40, 62]).rotate([-14, 0]).scale(1).translate([0, 0]);
{
  const [[a], [c]] = boundsOf(euroGeo.map((p) => projectPoly(p)));
  projection.scale((WIDTH - 40) / (c - a));
}
const [[x0, y0], [x1, y1]] = boundsOf(euroGeo.map((p) => projectPoly(p)));
const HEIGHT = Math.ceil(y1 - y0 + 40);
const offX = 20 - x0;
const offY = 20 - y0;

function projectPoly(poly) {
  return poly.map((ring) => ring.map(([lon, lat]) => projection([lon, lat])));
}
function shift(poly) {
  return poly.map((ring) => ring.map(([x, y]) => [x + offX, y + offY]));
}
function boundsOf(polys) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of polys) for (const r of p) for (const [x, y] of r) {
    a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y);
  }
  return [[a, b], [c, d]];
}

const land = pc.union(...euroGeo.map((p) => [shift(projectPoly(p))]));
const backdrop = backdropGeo.map((p) => shift(projectPoly(p)));

const provs = src.provinces;
const seeds = provs.map((p) => {
  const [x, y] = projection([p.lon, p.lat]);
  return [x + offX, y + offY];
});
const delaunay = Delaunay.from(seeds);
const voronoi = delaunay.voronoi([-200, -200, WIDTH + 200, HEIGHT + 200]);

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a / 2);
}
function simplify(ring) {
  const out = [];
  for (const [x, y] of ring) {
    const q = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - q[0], last[1] - q[1]) >= 1.2) out.push(q);
  }
  if (out.length > 2) out.push(out[0]);
  return out;
}
function cleanMulti(multi, minArea) {
  return multi
    .filter((poly) => ringArea(poly[0]) >= minArea)
    .map((poly) => poly.map(simplify).filter((r) => r.length >= 4));
}

const result = {};
provs.forEach((p, i) => {
  const cell = voronoi.cellPolygon(i);
  const shape = pc.intersection(land, [cell]);
  const poly = cleanMulti(shape, 6);
  if (!poly.length) throw new Error(`Provinz ${p.id} hat keine Landfläche`);
  result[p.id] = { poly, center: seeds[i].map((v) => Math.round(v)), neighbors: [] };
});

// Landnachbarn: Delaunay-Nachbarn mit gemeinsamer Grenze. Seewege kommen aus provinces.json (seaLinks).
function minVertexDist(a, b) {
  let best = Infinity;
  for (const pa of a) for (const ra of pa) for (const p of ra) {
    for (const pb of b) for (const rb of pb) for (const q of rb) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d < best) best = d;
    }
  }
  return best;
}
function link(a, b, see) {
  if (!result[a] || !result[b]) throw new Error(`Unbekannte Provinz in Verbindung ${a}-${b}`);
  if (result[a].neighbors.some((n) => n.id === b)) return;
  result[a].neighbors.push({ id: b, see });
  result[b].neighbors.push({ id: a, see });
}
provs.forEach((p, i) => {
  for (const j of delaunay.neighbors(i)) {
    if (j < i) continue;
    if (minVertexDist(result[p.id].poly, result[provs[j].id].poly) < 3) link(p.id, provs[j].id, false);
  }
});
for (const [a, b] of src.seaLinks) link(a, b, true);

// Küsten: Randstücke einer Provinz, die nicht auf der Grenze zu einer Nachbarprovinz liegen (dort sind
// beide Mittelpunkte gleich weit entfernt) und nicht am Kartenrand, sind Küste.
// Ergebnis je Provinz: Anteil der Küste am Umfang und Küstenlänge in 8 Richtungen (0 = Osten, im Uhrzeigersinn).
const inBbox = (x, y) => {
  const [lon, lat] = projection.invert([x - offX, y - offY]);
  return lon > BBOX[0] + 0.15 && lon < BBOX[2] - 0.15 && lat > BBOX[1] + 0.15 && lat < BBOX[3] - 0.15;
};
provs.forEach((p, i) => {
  const r = result[p.id];
  let total = 0, coast = 0;
  const sectors = new Array(8).fill(0);
  for (const poly of r.poly) for (const ring of poly) for (let k = 0; k < ring.length - 1; k++) {
    const [ax, ay] = ring[k], [bx, by] = ring[k + 1];
    const len = Math.hypot(bx - ax, by - ay);
    const mx = (ax + bx) / 2, my = (ay + by) / 2;
    total += len;
    const d0 = Math.hypot(mx - seeds[i][0], my - seeds[i][1]);
    let d1 = Infinity;
    seeds.forEach((q, j) => { if (j !== i) d1 = Math.min(d1, Math.hypot(mx - q[0], my - q[1])); });
    if (Math.abs(d1 - d0) < 2 || !inBbox(mx, my)) continue;
    coast += len;
    const sec = ((Math.round(Math.atan2(my - seeds[i][1], mx - seeds[i][0]) / (Math.PI / 4)) % 8) + 8) % 8;
    sectors[sec] += len;
  }
  const frac = coast / (total || 1);
  const max = Math.max(...sectors) || 1;
  r.coast = frac < 0.08 ? null : { frac: Math.round(frac * 100) / 100, sectors: sectors.map((v) => Math.round((v / max) * 100) / 100) };
});

const out = {
  _info: 'AUTOMATISCH ERZEUGT von tools/build-map.mjs – nicht von Hand bearbeiten.',
  width: WIDTH,
  height: HEIGHT,
  backdrop: cleanMulti(backdrop.flat ? backdrop : [], 20).map((p) => p),
  provinces: result,
};
writeFileSync(new URL('../data/map/europe.json', import.meta.url), JSON.stringify(out));
const nCount = Object.values(result).map((r) => r.neighbors.length);
console.log(`Karte ${WIDTH}x${HEIGHT}, ${provs.length} Provinzen, Nachbarn Ø ${(nCount.reduce((a, b) => a + b) / nCount.length).toFixed(1)}`);
for (const [id, r] of Object.entries(result)) if (!r.neighbors.length) console.warn('Keine Nachbarn:', id);
