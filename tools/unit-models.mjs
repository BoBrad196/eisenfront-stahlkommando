// Isometrische Einheitenmodelle für die Platzhaltergrafiken.
// Alle Modelle werden aus einfachen 3D-Formen in Kacheleinheiten gebaut (x vorwärts, y seitlich, z hoch)
// und für 16 Blickrichtungen (Infanterie: 8 Richtungen x 3 Laufbilder) gerendert.
// Panzer bestehen aus zwei Bildern: Wanne (dreht mit der Fahrtrichtung) und Turm (dreht zum Ziel).

export function makeUnits({ Scene, shade, faceLight, svg, put }) {
  const off = (fx, fy, f, s) => [fx * f - fy * s, fy * f + fx * s]; // lokal (vorne f, seitlich s) -> Welt
  let clipId = 0;
  let seed = 4242;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // ---------- Bausteine ----------
  /** Einzelbilder nebeneinander (Richtungen), optional mehrere Reihen (Animation) */
  function sheet(W, H, ax, ay, draw, { frames = 16, rows = 1, shadow = 0.3 } = {}) {
    let body = '';
    for (let r = 0; r < rows; r++) for (let f = 0; f < frames; f++) {
      const a = (f * 2 * Math.PI) / frames;
      const ox = f * W + ax, oy = r * H + ay;
      const sc = new Scene(ox, oy);
      if (shadow) sc.raw(`<ellipse cx="${ox + 2}" cy="${oy + 1.5}" rx="${(W * shadow).toFixed(1)}" ry="${(W * shadow * 0.45).toFixed(1)}" fill="rgba(0,0,0,0.28)"/>`);
      draw(sc, a, Math.cos(a), Math.sin(a), r);
      body += sc.toString();
    }
    return [svg(W * frames, H * rows, body), { frames, rows, anchor: [ax, ay] }];
  }

  /** Eckpunkte eines gedrehten Rechtecks (Welt) */
  function rect(cx, cy, a, l, w) {
    const ca = Math.cos(a), sa = Math.sin(a);
    return [[l / 2, -w / 2], [l / 2, w / 2], [-l / 2, w / 2], [-l / 2, -w / 2]].map(([u, v]) => [cx + u * ca - v * sa, cy + u * sa + v * ca]);
  }

  /** Quader mit Schattierung: dunklere Unterkante (Umgebungsschatten), helle Oberkante */
  function block(sc, { cx = 0, cy = 0, a = 0, l, w, h, z = 0, color, camo = null, edge = true }) {
    const pts = rect(cx, cy, a, l, w);
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      let nx = q[1] - p[1], ny = -(q[0] - p[0]);
      const len = Math.hypot(nx, ny) || 1; nx /= len; ny /= len;
      const mx = (p[0] + q[0]) / 2 - cx, my = (p[1] + q[1]) / 2 - cy;
      if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
      if (nx + ny <= 0.001) continue;
      sc.poly([sc.P(p[0], p[1], z), sc.P(q[0], q[1], z), sc.P(q[0], q[1], z + h), sc.P(p[0], p[1], z + h)], shade(color, faceLight(nx, ny)));
      if (h > 0.05) {
        const zh = z + h * 0.35;
        sc.poly([sc.P(p[0], p[1], z), sc.P(q[0], q[1], z), sc.P(q[0], q[1], zh), sc.P(p[0], p[1], zh)], 'rgba(0,0,0,0.18)', 'none');
      }
    }
    const top = pts.map(([x, y]) => sc.P(x, y, z + h));
    sc.poly(top, shade(color, 1.1));
    if (camo) camoOn(sc, top, camo, l * w);
    if (edge) sc.raw(`<path d="M${top.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="0.8"/>`);
    return pts;
  }

  /** Tarnflecken auf einer (projizierten) Deckfläche */
  function camoOn(sc, top, colors, area) {
    const id = `c${clipId++}`;
    const xs = top.map((p) => p[0]), ys = top.map((p) => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    let s = `<clipPath id="${id}"><path d="M${top.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z"/></clipPath><g clip-path="url(#${id})">`;
    const n = Math.max(3, Math.round(area * 22));
    for (let i = 0; i < n; i++) {
      const x = minX + rnd() * (maxX - minX), y = minY + rnd() * (maxY - minY);
      s += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(3 + rnd() * 5).toFixed(1)}" ry="${(1.5 + rnd() * 2.5).toFixed(1)}" fill="${colors[i % colors.length]}" opacity="0.75"/>`;
    }
    sc.raw(s + '</g>');
  }

  /** Kette mit Laufrollen und Profil */
  function track(sc, a, fx, fy, l, side, z = 0, h = 0.14, n = 5) {
    const [x, y] = off(fx, fy, 0, side);
    block(sc, { cx: x, cy: y, a, l, w: 0.15, h, z, color: '#2f2f2c', edge: false });
    // Profil auf der Oberseite
    for (let i = 0; i < 9; i++) {
      const f = -l / 2 + 0.04 + (i * (l - 0.08)) / 8;
      const [p1x, p1y] = off(fx, fy, f, side - 0.07), [p2x, p2y] = off(fx, fy, f, side + 0.07);
      sc.line([p1x, p1y, z + h + 0.002], [p2x, p2y, z + h + 0.002], 'rgba(0,0,0,0.45)', 0.7);
    }
    // Laufrollen auf der sichtbaren Außenseite
    const [nx, ny] = off(fx, fy, 0, Math.sign(side));
    if (nx + ny <= 0) return;
    for (let i = 0; i < n; i++) {
      const f = -l / 2 + 0.09 + (i * (l - 0.18)) / (n - 1);
      const [wx, wy] = off(fx, fy, f, side + Math.sign(side) * 0.078);
      const [px, py] = sc.P(wx, wy, z + h * 0.45);
      sc.raw(`<ellipse cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="2.6" ry="2.4" fill="#4a4a46" stroke="#151515" stroke-width="0.6"/><circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="0.9" fill="#8a8a82"/>`);
    }
  }

  /** Rohr mit Mündungsbremse */
  function barrel(sc, a, fx, fy, start, len, z, w = 0.055, side = 0, color = '#2b2d27') {
    const [x, y] = off(fx, fy, start + len / 2, side);
    block(sc, { cx: x, cy: y, a, l: len, w, h: w, z, color, edge: false });
    const [mx, my] = off(fx, fy, start + len - 0.02, side);
    block(sc, { cx: mx, cy: my, a, l: 0.06, w: w * 1.7, h: w * 1.5, z: z - w * 0.25, color: '#1f201c', edge: false });
  }

  /** Luke / Kommandantenkuppel */
  function hatch(sc, x, y, z, r = 0.07) {
    sc.cyl({ cx: x, cy: y, r, h: 0.035, z, color: '#55594a', topColor: '#6a6f5a' });
    const [px, py] = sc.P(x, y, z + 0.035);
    sc.raw(`<ellipse cx="${px}" cy="${py}" rx="${r * 32 * 0.8}" ry="${r * 16 * 0.8}" fill="none" stroke="rgba(0,0,0,0.5)" stroke-width="0.6"/>`);
  }

  function antenna(sc, x, y, z, hgt) {
    sc.line([x, y, z], [x, y, z + hgt], '#1d1d1d', 0.8);
    const [tx, ty] = sc.P(x, y, z + hgt);
    sc.raw(`<circle cx="${tx}" cy="${ty}" r="0.9" fill="#1d1d1d"/>`);
  }

  const CAMO_GREEN = ['#4f5a36', '#6b5a3c', '#3e4a2b'];
  const CAMO_GREY = ['#5d6268', '#868c92', '#4c5156'];
  const front = (fx, fy) => fx + fy >= 0;

  // ---------- Kampfpanzer ----------
  put('unit.kampfpanzer', 'units/kampfpanzer.svg', ...sheet(104, 76, 52, 50, (sc, a, fx, fy) => {
    const tracks = () => [-0.27, 0.27].sort((p, q) => (off(fx, fy, 0, p)[0] + off(fx, fy, 0, p)[1]) - (off(fx, fy, 0, q)[0] + off(fx, fy, 0, q)[1])).forEach((s) => track(sc, a, fx, fy, 0.92, s));
    tracks();
    block(sc, { a, l: 0.86, w: 0.44, h: 0.1, z: 0.06, color: '#6f7552' });
    const [ux, uy] = off(fx, fy, -0.03, 0);
    block(sc, { cx: ux, cy: uy, a, l: 0.78, w: 0.52, h: 0.07, z: 0.16, color: '#7b8159', camo: CAMO_GREEN });
    // Motorgitter hinten, Scheinwerfer vorn
    for (let i = 0; i < 4; i++) {
      const [p1x, p1y] = off(fx, fy, -0.36 + i * 0.03, -0.14), [p2x, p2y] = off(fx, fy, -0.36 + i * 0.03, 0.14);
      sc.line([p1x, p1y, 0.232], [p2x, p2y, 0.232], 'rgba(0,0,0,0.5)', 0.8);
    }
    if (front(fx, fy)) for (const s of [-0.2, 0.2]) { const [lx, ly] = off(fx, fy, 0.41, s); const [px, py] = sc.P(lx, ly, 0.19); sc.raw(`<circle cx="${px}" cy="${py}" r="1.3" fill="#f1e6a8" stroke="#333" stroke-width="0.4"/>`); }
  }));
  put('unit.kampfpanzer.turm', 'units/kampfpanzer_turm.svg', ...sheet(104, 76, 52, 50, (sc, a, fx, fy) => {
    const gun = () => barrel(sc, a, fx, fy, 0.16, 0.56, 0.29);
    if (!front(fx, fy)) gun();
    const [tx, ty] = off(fx, fy, -0.04, 0);
    block(sc, { cx: tx, cy: ty, a, l: 0.42, w: 0.36, h: 0.12, z: 0.23, color: '#6c7250', camo: CAMO_GREEN });
    const [mx, my] = off(fx, fy, 0.18, 0);
    block(sc, { cx: mx, cy: my, a, l: 0.06, w: 0.16, h: 0.08, z: 0.25, color: '#5d6245', edge: false });
    if (front(fx, fy)) gun();
    const [hx, hy] = off(fx, fy, -0.1, -0.08);
    hatch(sc, hx, hy, 0.35);
    const [ax, ay] = off(fx, fy, -0.2, 0.12);
    antenna(sc, ax, ay, 0.35, 0.45);
  }, { shadow: 0 }));

  // ---------- Spähpanzer (Radfahrzeug) ----------
  put('unit.spaehpanzer', 'units/spaehpanzer.svg', ...sheet(88, 68, 44, 44, (sc, a, fx, fy) => {
    const wheels = [];
    for (const f of [-0.24, 0, 0.24]) for (const s of [-0.21, 0.21]) wheels.push([f, s]);
    wheels.sort((p, q) => { const a1 = off(fx, fy, ...p), b1 = off(fx, fy, ...q); return a1[0] + a1[1] - b1[0] - b1[1]; });
    for (const [f, s] of wheels) {
      const [x, y] = off(fx, fy, f, s);
      block(sc, { cx: x, cy: y, a, l: 0.15, w: 0.07, h: 0.15, color: '#1f1f1f', edge: false });
      const [nx, ny] = off(fx, fy, 0, Math.sign(s));
      if (nx + ny > 0) { const [hx, hy] = off(fx, fy, f, s + Math.sign(s) * 0.04); const [px, py] = sc.P(hx, hy, 0.075); sc.raw(`<circle cx="${px}" cy="${py}" r="1.4" fill="#7c7c72"/>`); }
    }
    block(sc, { a, l: 0.72, w: 0.38, h: 0.11, z: 0.07, color: '#858a6e' });
    const [ux, uy] = off(fx, fy, -0.02, 0);
    block(sc, { cx: ux, cy: uy, a, l: 0.6, w: 0.34, h: 0.07, z: 0.18, color: '#8f9477', camo: ['#6d7356', '#9a8c64'] });
    const [wx, wy] = off(fx, fy, 0.24, 0);
    block(sc, { cx: wx, cy: wy, a, l: 0.05, w: 0.26, h: 0.03, z: 0.25, color: '#2c3a44', edge: false });
  }));
  put('unit.spaehpanzer.turm', 'units/spaehpanzer_turm.svg', ...sheet(88, 68, 44, 44, (sc, a, fx, fy) => {
    const gun = () => barrel(sc, a, fx, fy, 0.08, 0.3, 0.33, 0.035);
    if (!front(fx, fy)) gun();
    sc.cyl({ cx: 0, cy: 0, r: 0.11, h: 0.08, z: 0.25, color: '#6d725a' });
    const [sx, sy] = off(fx, fy, 0.08, 0);
    block(sc, { cx: sx, cy: sy, a, l: 0.03, w: 0.18, h: 0.09, z: 0.3, color: '#5a5f4a', edge: false });
    if (front(fx, fy)) gun();
    const [ax, ay] = off(fx, fy, -0.12, 0.06);
    antenna(sc, ax, ay, 0.3, 0.4);
  }, { shadow: 0 }));

  // ---------- Artillerie (Panzerhaubitze) ----------
  put('unit.artillerie', 'units/artillerie.svg', ...sheet(112, 84, 56, 56, (sc, a, fx, fy) => {
    [-0.25, 0.25].sort((p, q) => (off(fx, fy, 0, p)[0] + off(fx, fy, 0, p)[1]) - (off(fx, fy, 0, q)[0] + off(fx, fy, 0, q)[1])).forEach((s) => track(sc, a, fx, fy, 0.84, s));
    block(sc, { a, l: 0.8, w: 0.42, h: 0.1, z: 0.06, color: '#7f7b5e' });
    block(sc, { a, l: 0.72, w: 0.46, h: 0.06, z: 0.16, color: '#8a8668', camo: ['#6c6a4c', '#9b8a5c'] });
  }));
  put('unit.artillerie.turm', 'units/artillerie_turm.svg', ...sheet(112, 84, 56, 56, (sc, a, fx, fy) => {
    const [bx, by] = off(fx, fy, 0.1, 0), tip = off(fx, fy, 0.82, 0);
    const gun = () => { sc.line([bx, by, 0.38], [tip[0], tip[1], 0.64], '#26271f', 4); const [px, py] = sc.P(tip[0], tip[1], 0.64); sc.raw(`<circle cx="${px}" cy="${py}" r="2.8" fill="#1c1c18"/>`); };
    if (!front(fx, fy)) gun();
    const [tx, ty] = off(fx, fy, -0.12, 0);
    block(sc, { cx: tx, cy: ty, a, l: 0.46, w: 0.4, h: 0.2, z: 0.22, color: '#77735a', camo: ['#605e44', '#958660'] });
    if (front(fx, fy)) gun();
    const [hx, hy] = off(fx, fy, -0.22, 0.1);
    hatch(sc, hx, hy, 0.42, 0.06);
    const [ax, ay] = off(fx, fy, -0.3, -0.12);
    antenna(sc, ax, ay, 0.42, 0.4);
  }, { shadow: 0 }));

  // ---------- Mammutpanzer ----------
  put('unit.schwerer_panzer', 'units/schwerer_panzer.svg', ...sheet(124, 92, 62, 60, (sc, a, fx, fy) => {
    [-0.36, -0.2, 0.2, 0.36].sort((p, q) => (off(fx, fy, 0, p)[0] + off(fx, fy, 0, p)[1]) - (off(fx, fy, 0, q)[0] + off(fx, fy, 0, q)[1])).forEach((s) => track(sc, a, fx, fy, 1.08, s, 0, 0.15, 6));
    block(sc, { a, l: 1.02, w: 0.62, h: 0.12, z: 0.06, color: '#666b50' });
    const [ux, uy] = off(fx, fy, -0.04, 0);
    block(sc, { cx: ux, cy: uy, a, l: 0.92, w: 0.66, h: 0.08, z: 0.18, color: '#6f7458', camo: CAMO_GREEN });
  }));
  put('unit.schwerer_panzer.turm', 'units/schwerer_panzer_turm.svg', ...sheet(124, 92, 62, 60, (sc, a, fx, fy) => {
    const guns = () => { barrel(sc, a, fx, fy, 0.2, 0.62, 0.36, 0.06, 0.08); barrel(sc, a, fx, fy, 0.2, 0.62, 0.36, 0.06, -0.08); };
    const pods = () => { for (const s of [-0.29, 0.29]) { const [px, py] = off(fx, fy, -0.06, s); block(sc, { cx: px, cy: py, a, l: 0.3, w: 0.1, h: 0.1, z: 0.3, color: '#4d5240' }); } };
    if (!front(fx, fy)) guns();
    pods();
    const [tx, ty] = off(fx, fy, -0.06, 0);
    block(sc, { cx: tx, cy: ty, a, l: 0.52, w: 0.46, h: 0.15, z: 0.26, color: '#5f644b', camo: CAMO_GREEN });
    if (front(fx, fy)) guns();
    const [hx, hy] = off(fx, fy, -0.14, -0.1);
    hatch(sc, hx, hy, 0.41, 0.08);
    const [ax, ay] = off(fx, fy, -0.28, 0.16);
    antenna(sc, ax, ay, 0.41, 0.5);
  }, { shadow: 0 }));

  // ---------- Infanterie: 8 Richtungen x 3 Bilder (Stehen, Schritt links, Schritt rechts) ----------
  function soldier({ helmet, uniform, skin = '#d9b38c', weapon = 'gewehr', backpack = true, cap = false }) {
    return sheet(40, 52, 20, 40, (sc, a, fx, fy, row) => {
      const stride = row === 0 ? 0 : row === 1 ? 0.055 : -0.055;
      const parts = [];
      // Beine
      for (const [s, d] of [[-0.04, stride], [0.04, -stride]]) {
        parts.push([s, () => { const [x, y] = off(fx, fy, d, s); block(sc, { cx: x, cy: y, a, l: 0.06, w: 0.05, h: 0.15, color: shade(uniform, 0.72), edge: false }); }]);
      }
      parts.sort((p, q) => { const a1 = off(fx, fy, 0, p[0]), b1 = off(fx, fy, 0, q[0]); return a1[0] + a1[1] - b1[0] - b1[1]; });
      parts.forEach((p) => p[1]());
      const bp = () => { if (backpack) { const [x, y] = off(fx, fy, -0.075, 0); block(sc, { cx: x, cy: y, a, l: 0.06, w: 0.12, h: 0.12, z: 0.17, color: shade(uniform, 0.8), edge: false }); } };
      const wpn = () => {
        if (weapon === 'rakete') {
          const [x, y] = off(fx, fy, 0.02, 0.075);
          block(sc, { cx: x, cy: y, a, l: 0.38, w: 0.07, h: 0.07, z: 0.33, color: '#3c4232', edge: false });
          const [mx, my] = off(fx, fy, 0.21, 0.075); const [px, py] = sc.P(mx, my, 0.365);
          sc.raw(`<circle cx="${px}" cy="${py}" r="1.6" fill="#111"/>`);
        } else {
          const [x, y] = off(fx, fy, 0.11, 0.05);
          block(sc, { cx: x, cy: y, a, l: 0.3, w: 0.025, h: 0.03, z: 0.25, color: '#1e1e1c', edge: false });
          const [sx, sy] = off(fx, fy, -0.02, 0.05);
          block(sc, { cx: sx, cy: sy, a, l: 0.07, w: 0.03, h: 0.04, z: 0.23, color: '#5a3d24', edge: false });
        }
      };
      const back = !front(fx, fy);
      if (!back) bp();
      if (back) wpn();
      block(sc, { a, l: 0.1, w: 0.16, h: 0.17, z: 0.15, color: uniform });
      // Koppel
      const belt = rect(0, 0, a, 0.102, 0.162).map(([x, y]) => sc.P(x, y, 0.19));
      sc.raw(`<path d="M${belt.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z" fill="none" stroke="#2b2418" stroke-width="1"/>`);
      // Arme nach vorn zur Waffe
      for (const s of [-0.09, 0.09]) { const [x, y] = off(fx, fy, 0.05, s * 0.8); block(sc, { cx: x, cy: y, a, l: 0.12, w: 0.04, h: 0.04, z: 0.24, color: shade(uniform, 0.9), edge: false }); }
      if (!back) wpn();
      if (back) bp();
      const [hx, hy] = sc.P(0, 0, 0.4);
      sc.raw(`<circle cx="${hx}" cy="${hy}" r="3.3" fill="${skin}" stroke="rgba(0,0,0,0.4)" stroke-width="0.5"/>`);
      if (cap) sc.raw(`<ellipse cx="${hx}" cy="${hy - 2}" rx="3.8" ry="1.8" fill="${helmet}"/><path d="M${hx + fx * 2} ${hy - 1.5} l${(fx - fy) * 3} ${(fx + fy) * 1.5}" stroke="${helmet}" stroke-width="1.6"/>`);
      else sc.raw(`<path d="M${hx - 4.1} ${hy - 0.2} A4.1 3.9 0 0 1 ${hx + 4.1} ${hy - 0.2} Z" fill="${helmet}" stroke="rgba(0,0,0,0.45)" stroke-width="0.5"/><path d="M${hx - 4.6} ${hy - 0.1} L${hx + 4.6} ${hy - 0.1}" stroke="${shade(helmet, 0.8)}" stroke-width="1"/><ellipse cx="${hx - 1}" cy="${hy - 2.2}" rx="1.4" ry="0.8" fill="rgba(255,255,255,0.18)"/>`);
    }, { frames: 8, rows: 3, shadow: 0.22 });
  }
  put('unit.schuetze', 'units/schuetze.svg', ...soldier({ helmet: '#45532a', uniform: '#5d6b3a' }));
  put('unit.raketentrupp', 'units/raketentrupp.svg', ...soldier({ helmet: '#45532a', uniform: '#56643a', weapon: 'rakete' }));
  put('unit.miliz', 'units/miliz.svg', ...soldier({ helmet: '#4a3826', uniform: '#7a5c3a', backpack: false, cap: true }));

  // ---------- Luftwaffe (Anker = Rumpfmitte, der Renderer setzt die Flughöhe; Rotor zeichnet der Renderer) ----------
  put('unit.kampfhubschrauber', 'units/kampfhubschrauber.svg', ...sheet(104, 76, 52, 50, (sc, a, fx, fy) => {
    const tail = () => {
      const [tx, ty] = off(fx, fy, -0.5, 0);
      block(sc, { cx: tx, cy: ty, a, l: 0.48, w: 0.06, h: 0.07, z: 0.12, color: '#55604a', edge: false });
      const [fx2, fy2] = off(fx, fy, -0.72, 0);
      block(sc, { cx: fx2, cy: fy2, a, l: 0.1, w: 0.03, h: 0.2, z: 0.1, color: '#4a553f', edge: false });
      const [sx, sy] = off(fx, fy, -0.66, 0);
      block(sc, { cx: sx, cy: sy, a, l: 0.07, w: 0.22, h: 0.02, z: 0.14, color: '#4a553f', edge: false });
    };
    const wings = () => {
      const [wx, wy] = off(fx, fy, -0.02, 0);
      block(sc, { cx: wx, cy: wy, a, l: 0.1, w: 0.56, h: 0.025, z: 0.12, color: '#56614a', edge: false });
      for (const s of [-0.26, 0.26]) { const [px, py] = off(fx, fy, 0.0, s); block(sc, { cx: px, cy: py, a, l: 0.2, w: 0.07, h: 0.07, z: 0.06, color: '#3b3f35', edge: false }); }
    };
    const back = !front(fx, fy);
    if (!back) tail();
    for (const s of [-0.12, 0.12]) { const [x, y] = off(fx, fy, 0, s); block(sc, { cx: x, cy: y, a, l: 0.5, w: 0.025, h: 0.025, z: -0.09, color: '#2a2a2a', edge: false }); }
    if (back) wings();
    const body = [[0.36, 0], [0.18, 0.11], [-0.22, 0.12], [-0.3, 0.06], [-0.3, -0.06], [-0.22, -0.12], [0.18, -0.11]].map(([f, s]) => off(fx, fy, f, s));
    sc.prism(body, -0.04, 0.17, '#66724f');
    camoOn(sc, body.map(([x, y]) => sc.P(x, y, 0.13)), ['#4f5a3c', '#7a7a55'], 0.08);
    const [cx, cy] = off(fx, fy, 0.18, 0);
    block(sc, { cx, cy, a, l: 0.2, w: 0.14, h: 0.07, z: 0.13, color: '#86b4cc', edge: false });
    const [c2x, c2y] = off(fx, fy, 0.02, 0);
    block(sc, { cx: c2x, cy: c2y, a, l: 0.16, w: 0.14, h: 0.1, z: 0.13, color: '#7aa6bf', edge: false });
    if (!back) wings();
    if (back) tail();
    sc.cyl({ cx: 0, cy: 0, r: 0.04, h: 0.08, z: 0.23, color: '#333' });
    const [nx, ny] = off(fx, fy, 0.37, 0);
    block(sc, { cx: nx, cy: ny, a, l: 0.08, w: 0.025, h: 0.025, z: 0.0, color: '#1c1c1c', edge: false });
  }, { shadow: 0 }));
  put('unit.kampfjet', 'units/kampfjet.svg', ...sheet(112, 76, 56, 48, (sc, a, fx, fy) => {
    const wing = [[0.2, 0.06], [-0.3, 0.5], [-0.4, 0.5], [-0.34, 0.08], [-0.34, -0.08], [-0.4, -0.5], [-0.3, -0.5], [0.2, -0.06]].map(([f, s]) => off(fx, fy, f, s));
    const wp = wing.map(([x, y]) => sc.P(x, y, 0.08));
    sc.poly(wp, '#8b939b');
    camoOn(sc, wp, CAMO_GREY, 0.3);
    const fus = [[0.55, 0], [0.32, 0.07], [-0.4, 0.07], [-0.46, 0.05], [-0.46, -0.05], [-0.4, -0.07], [0.32, -0.07]].map(([f, s]) => off(fx, fy, f, s));
    sc.prism(fus, 0.04, 0.09, '#98a0a8');
    const [kx, ky] = off(fx, fy, 0.22, 0);
    block(sc, { cx: kx, cy: ky, a, l: 0.2, w: 0.07, h: 0.05, z: 0.13, color: '#4f86ad', edge: false });
    for (const s of [-0.09, 0.09]) {
      const [tx, ty] = off(fx, fy, -0.38, s);
      block(sc, { cx: tx, cy: ty, a, l: 0.14, w: 0.02, h: 0.2, z: 0.11, color: '#7d858d', edge: false });
    }
    if (!front(fx, fy)) {
      const [ex, ey] = off(fx, fy, -0.47, 0); const [px, py] = sc.P(ex, ey, 0.085);
      sc.raw(`<ellipse cx="${px}" cy="${py}" rx="3" ry="2.4" fill="#222" stroke="#555" stroke-width="0.6"/>`);
    }
  }, { shadow: 0 }));

  // ---------- Marine (Anker = Wasserlinie in Schiffsmitte) ----------
  function hullShape(fx, fy, len, beam) {
    return [[len * 0.55, 0], [len * 0.3, beam / 2], [-len * 0.45, beam / 2], [-len * 0.5, beam * 0.35], [-len * 0.5, -beam * 0.35], [-len * 0.45, -beam / 2], [len * 0.3, -beam / 2]]
      .map(([f, s]) => off(fx, fy, f, s));
  }
  function shipHull(sc, fx, fy, len, beam, h, color) {
    const pts = hullShape(fx, fy, len, beam);
    sc.prism(pts, -0.03, 0.05, '#6e2c26'); // rote Wasserlinie
    sc.prism(pts, 0.02, h - 0.02, color);
    // helleres Deck mit Planken-Linien
    const deck = hullShape(fx, fy, len * 0.94, beam * 0.86).map(([x, y]) => sc.P(x, y, h + 0.001));
    sc.poly(deck, '#a8adb2', 'none');
  }
  function bridge(sc, a, fx, fy, f, l, w, h, z, color) {
    const [x, y] = off(fx, fy, f, 0);
    block(sc, { cx: x, cy: y, a, l, w, h, z, color });
    block(sc, { cx: x, cy: y, a, l: l + 0.004, w: w + 0.004, h: 0.03, z: z + h * 0.62, color: '#26323d', edge: false }); // Fensterband
  }
  function shipGun(sc, a, fx, fy, f, z, size, len, isFront) {
    const [x, y] = off(fx, fy, f, 0);
    const g = () => barrel(sc, a, fx, fy, f + size * 0.4, len, z + size * 0.25, 0.045);
    if (!isFront) g();
    sc.cyl({ cx: x, cy: y, r: size * 0.5, h: size * 0.45, z, color: '#6c737b' });
    if (isFront) g();
  }
  const HULL = '#77808a';
  put('unit.patrouillenboot', 'units/patrouillenboot.svg', ...sheet(96, 68, 48, 44, (sc, a, fx, fy) => {
    const fr = front(fx, fy);
    shipHull(sc, fx, fy, 0.82, 0.3, 0.12, HULL);
    const parts = [() => bridge(sc, a, fx, fy, -0.08, 0.26, 0.2, 0.14, 0.12, '#c9cdd1'),
      () => shipGun(sc, a, fx, fy, 0.22, 0.12, 0.12, 0.16, fr)];
    (fr ? parts : [...parts].reverse()).forEach((p) => p());
    const [mx, my] = off(fx, fy, -0.12, 0);
    sc.line([mx, my, 0.26], [mx, my, 0.5], '#2a2a2a', 1);
  }, { shadow: 0 }));
  put('unit.zerstoerer', 'units/zerstoerer.svg', ...sheet(132, 92, 66, 58, (sc, a, fx, fy) => {
    const fr = front(fx, fy);
    shipHull(sc, fx, fy, 1.38, 0.38, 0.14, HULL);
    const parts = [
      () => shipGun(sc, a, fx, fy, -0.48, 0.14, 0.16, 0.24, fr),
      () => { const [sx, sy] = off(fx, fy, -0.25, 0); sc.cyl({ cx: sx, cy: sy, r: 0.06, h: 0.24, z: 0.14, color: '#3d4247' }); },
      () => { bridge(sc, a, fx, fy, -0.02, 0.42, 0.24, 0.2, 0.14, '#9aa1a8'); bridge(sc, a, fx, fy, 0.04, 0.18, 0.16, 0.13, 0.34, '#b4bac0');
        const [mx, my] = off(fx, fy, 0.0, 0); sc.line([mx, my, 0.47], [mx, my, 0.92], '#2d2d2d', 1.4);
        const [c1x, c1y] = off(fx, fy, 0, -0.1), [c2x, c2y] = off(fx, fy, 0, 0.1); sc.line([c1x, c1y, 0.8], [c2x, c2y, 0.8], '#2d2d2d', 1.1); },
      () => shipGun(sc, a, fx, fy, 0.4, 0.14, 0.18, 0.28, fr),
    ];
    (fr ? parts : [...parts].reverse()).forEach((p) => p());
  }, { shadow: 0 }));
  put('unit.raketenkreuzer', 'units/raketenkreuzer.svg', ...sheet(144, 100, 72, 62, (sc, a, fx, fy) => {
    const fr = front(fx, fy);
    shipHull(sc, fx, fy, 1.62, 0.44, 0.15, '#6f7780');
    const launcher = (f) => {
      for (const s of [-0.08, 0.08]) {
        const [x, y] = off(fx, fy, f, s);
        block(sc, { cx: x, cy: y, a, l: 0.2, w: 0.12, h: 0.09, z: 0.15, color: '#4f565d' });
        for (const d of [-0.05, 0.05]) { const [hx, hy] = off(fx, fy, f + d, s); const [px, py] = sc.P(hx, hy, 0.241); sc.raw(`<ellipse cx="${px}" cy="${py}" rx="2" ry="1" fill="#1b1e21"/>`); }
      }
    };
    const parts = [() => launcher(-0.56),
      () => { bridge(sc, a, fx, fy, -0.12, 0.5, 0.3, 0.26, 0.15, '#a3aab1'); bridge(sc, a, fx, fy, -0.06, 0.24, 0.2, 0.16, 0.41, '#bcc2c8');
        const [mx, my] = off(fx, fy, -0.06, 0); sc.line([mx, my, 0.57], [mx, my, 0.82], '#2d2d2d', 1.4);
        const [rx, ry] = sc.P(mx, my, 0.84); sc.raw(`<ellipse cx="${rx}" cy="${ry}" rx="7.5" ry="3" fill="#dfe3e6" stroke="#555" stroke-width="0.8"/>`); },
      () => launcher(0.3), () => shipGun(sc, a, fx, fy, 0.6, 0.15, 0.15, 0.22, fr)];
    (fr ? parts : [...parts].reverse()).forEach((p) => p());
  }, { shadow: 0 }));
}
