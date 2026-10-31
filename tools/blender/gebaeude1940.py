# Gebäude im Stil um 1940: Backstein- und Fachwerkhäuser, Grundstücke mit Zäunen, Mauern und Gärten,
# abgenutzt, leicht schief und ohne harte Kanten.
# Aufruf: python gebaeude1940.py <ausgabeordner> [name ...]
import bpy, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(__file__))
import eflib as E
from eflib import block, box, cyl, line_cyl, prism, sphere, frustum, mesh_boxes, wobble, soft, soft_patch, RX, RY
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 48))

def materials():
    M = {}
    M['brick'] = E.brick1940('Backstein')
    M['brick_d'] = E.brick1940('Klinker', base=(0.22, 0.09, 0.05), soot=0.7)
    M['plaster'] = E.plaster1940('Kalkputz')
    M['plaster_y'] = E.plaster1940('Putz ocker', color=(0.55, 0.45, 0.28))
    M['plaster_g'] = E.plaster1940('Putz grau', color=(0.42, 0.40, 0.36), reveal=0.5)
    M['stone'] = E.stone1940('Bruchstein')
    M['tiles'] = E.tiles1940('Biberschwanz')
    M['tiles_d'] = E.tiles1940('Ziegel dunkel', color=(0.24, 0.09, 0.06))
    M['slate'] = E.tiles1940('Schiefer', color=(0.10, 0.10, 0.11))
    M['timber'] = E.oldwood('Fachwerkbalken', color=(0.09, 0.06, 0.04), grey=0.25)
    M['wood'] = E.oldwood('Bretter')
    M['wood_g'] = E.oldwood('Bretter grau', color=(0.22, 0.2, 0.17), grey=0.8)
    M['green'] = E.painted('Fensterladen', (0.10, 0.17, 0.10), 0.8, mud_h=0, streaks=0.4)
    M['door'] = E.painted('Tür', (0.18, 0.09, 0.05), 0.8, mud_h=0.4)
    M['frame'] = E.painted('Fensterrahmen', (0.55, 0.52, 0.45), 0.8, chips=True, mud_h=0, streaks=0.3)
    M['glass'] = E.plain('Glas', (0.015, 0.02, 0.025), 0.1, 0.1)
    M['lit'] = E.plain('Licht', (0.5, 0.32, 0.15), 0.5, emission=(1.0, 0.55, 0.22), strength=0.75)
    M['steel'] = E.painted('Stahl', (0.08, 0.075, 0.07), 0.55, mud_h=0.6, metal_edge=(0.3, 0.29, 0.28))
    M['rust'] = E.painted('Rost', (0.24, 0.11, 0.05), 0.85, chips=False, mud_h=0)
    M['tin'] = E.corrugated('Wellblech', rust=0.6)
    M['tar'] = E.painted('Teerpappe', (0.05, 0.05, 0.05), 0.85, chips=False, mud_h=0, streaks=0.3)
    M['copper'] = E.painted('Kupfer', (0.20, 0.33, 0.27), 0.6, chips=False, mud_h=0)
    M['olive'] = E.painted('Feldgrau', (0.18, 0.19, 0.14), 0.75, mud_h=0.8)
    M['soil'] = E.painted('Gartenerde', (0.09, 0.065, 0.04), 0.95, chips=False, mud_h=0, streaks=0, dust_amt=0.1)
    M['veg'] = E.painted('Gemüse', (0.08, 0.15, 0.04), 0.8, chips=False, mud_h=0, streaks=0, dust_amt=0.1)
    M['leaf'] = E.painted('Laub', (0.07, 0.12, 0.035), 0.8, chips=False, mud_h=0, streaks=0, dust_amt=0.15)
    M['coal'] = E.plain('Kohle', (0.02, 0.02, 0.02), 0.5)
    M['iron'] = E.painted('Eisenerz', (0.26, 0.10, 0.045), 0.9, chips=False, mud_h=0, streaks=0)
    M['gold'] = E.painted('Golderz', (0.40, 0.31, 0.11), 0.6, chips=False, mud_h=0, streaks=0)
    M['cloth'] = E.painted('Wäsche', (0.62, 0.60, 0.55), 0.9, chips=False, mud_h=0, streaks=0)
    M['sand'] = E.painted('Sandsack', (0.38, 0.32, 0.21), 0.95, chips=False, mud_h=0.4, streaks=0)
    M['white'] = E.plain('Weiß', (0.65, 0.63, 0.58), 0.6)
    M['canvas'] = E.painted('Plane', (0.22, 0.23, 0.15), 0.9, chips=False)
    return M

# ======================= Hausbaukasten =======================
def windows_face(name, M, rnd, axis, plane, a0, a1, z0, z1, n, h=1.25, w=0.9, lit=0.35, shutters=0.5, skip=None, arched=False):
    """Fenster mit Rahmen, Sprossen, Fensterbank und teils Läden auf einer Wand.
    axis 'y': Wandebene y = plane (außen −Y), 'x': Ebene x = plane (außen +X), 'ny'/'nx': Rückseiten."""
    boxes_f, boxes_g, boxes_l, boxes_s = [], [], [], []
    out = {'y': (0, -1), 'x': (1, 0), 'ny': (0, 1), 'nx': (-1, 0)}[axis]
    along_x = axis in ('y', 'ny')
    for i in range(n):
        if skip is not None and i == skip: continue
        t = (i + 0.5) / n + rnd.uniform(-0.04, 0.04)
        a = a0 + (a1 - a0) * t
        zc = z0 + (z1 - z0) * 0.55 + rnd.uniform(-0.03, 0.03)
        def P(da, d, z):
            return (a + da, plane + out[1] * d, z) if along_x else (plane + out[0] * d, a + da, z)
        def S(sa, sd, sz):
            return (sa, sd, sz) if along_x else (sd, sa, sz)
        lit_here = rnd.random() < lit
        (boxes_l if lit_here else boxes_g).append((*S(w - 0.06, 0.04, h - 0.06), P(0, 0.0, zc), (0, 0, 0)))
        for da, sa in ((-w / 2, 0.08), (w / 2, 0.08)):
            boxes_f.append((*S(sa, 0.1, h + 0.08), P(da, 0.03, zc), (0, 0, 0)))
        boxes_f.append((*S(w + 0.08, 0.1, 0.08), P(0, 0.03, zc + h / 2), (0, 0, 0)))
        boxes_f.append((*S(w, 0.05, 0.05), P(0, 0.03, zc + h * 0.15), (0, 0, 0)))   # Kämpfer
        boxes_f.append((*S(0.05, 0.05, h), P(0, 0.03, zc), (0, 0, 0)))               # Mittelpfosten
        boxes_f.append((*S(w + 0.25, 0.22, 0.07), P(0, 0.09, zc - h / 2 - 0.04), (0, 0, 0)))  # Fensterbank
        if rnd.random() < shutters:
            for side in (-1, 1):
                if rnd.random() < 0.15: continue   # fehlender Laden
                boxes_s.append((*S(w / 2, 0.05, h), P(side * (w * 0.78), 0.06, zc), (0, 0, rnd.uniform(-0.03, 0.03))))
    if boxes_f: mesh_boxes(f'{name}_rahmen', boxes_f, M['frame'], bevel=0.008)
    if boxes_g: mesh_boxes(f'{name}_glas', boxes_g, M['glass'], bevel=0)
    if boxes_l: mesh_boxes(f'{name}_licht', boxes_l, M['lit'], bevel=0)
    if boxes_s: mesh_boxes(f'{name}_laeden', boxes_s, M['green'], bevel=0.01)

def fachwerk_face(boxes, rnd, axis, plane, a0, a1, z0, z1):
    """Fachwerkbalken auf einer Wandfläche (Schwelle, Rähm, Ständer, Riegel, Streben)"""
    out = {'y': (0, -1), 'x': (1, 0), 'ny': (0, 1), 'nx': (-1, 0)}[axis]
    along_x = axis in ('y', 'ny')
    t = 0.16
    def add(a, z, la, lz, rot=0.0):
        if along_x: boxes.append((la, 0.08, lz, (a, plane + out[1] * 0.035, z), (0, rot, 0)))
        else: boxes.append((0.08, la, lz, (plane + out[0] * 0.035, a, z), (rot, 0, 0)))
    L = a1 - a0
    add((a0 + a1) / 2, z0 + t / 2, L + 0.1, t)
    add((a0 + a1) / 2, z1 - t / 2, L + 0.1, t)
    add((a0 + a1) / 2, (z0 + z1) / 2 + rnd.uniform(-0.1, 0.1), L, t * 0.8)
    n = max(2, int(L / 1.05))
    for i in range(n + 1):
        a = a0 + L * i / n + (rnd.uniform(-0.06, 0.06) if 0 < i < n else 0)
        add(a, (z0 + z1) / 2, t, z1 - z0)
    # Streben (Mann-Figur an den Ecken)
    h = z1 - z0
    for k, sgn in ((0, 1), (n - 1, -1)):
        a = a0 + L * (k + 0.5) / n
        ang = math.atan2(h, L / n) * sgn
        add(a, (z0 + z1) / 2, math.hypot(L / n, h) * 0.95, t * 0.8, ang if along_x else -ang)

def house(name, cx, cy, l, w, M, rnd, floors=1, style='ziegel', roof='tiles', ridge='x', rot=0.0, pitch=48, lit=0.35,
          shed=None, chimney=True, dormer=False, door_side='y'):
    """Wohnhaus um 1940. l = Länge entlang des Firsts, w = Tiefe. Gibt die Schornsteinspitze (Welt) zurück."""
    H = E.empty(name); H.location = (cx, cy, 0)
    H.rotation_euler = (0, 0, rot + (0 if ridge == 'x' else math.pi / 2) + rnd.uniform(-0.04, 0.04))
    prev = E.PARENT; E.set_parent(H)
    fh = 2.8
    zb = 0.5
    wall_top = zb + floors * fh
    hx, hy = l / 2, w / 2
    # Sockel aus Bruchstein, Erdgeschoss, Obergeschoss
    o = block(f'{name}_sockel', -hx - 0.06, -hy - 0.06, 0, hx + 0.06, hy + 0.06, zb, M['stone'], bevel=0.05); wobble(o, 0.025, 0.4)
    wall_m = {'ziegel': M['brick'], 'putz': M['plaster' if rnd.random() < 0.5 else 'plaster_y'], 'fachwerk': M['plaster'], 'klinker': M['brick_d']}[style]
    ground_m = M['brick'] if style == 'fachwerk' and rnd.random() < 0.5 else wall_m
    for f in range(floors):
        m = ground_m if f == 0 else wall_m
        o = block(f'{name}_g{f}', -hx, -hy, zb + f * fh, hx, hy, zb + (f + 1) * fh, m, bevel=0.04)
        soft(o, 0.05, 3); wobble(o, 0.018, 0.5)
    beams = []
    if style == 'fachwerk':
        f0 = 1 if floors > 1 and ground_m is not wall_m else 0
        for f in range(f0, floors):
            z0, z1 = zb + f * fh, zb + (f + 1) * fh
            fachwerk_face(beams, rnd, 'y', -hy, -hx, hx, z0, z1)
            fachwerk_face(beams, rnd, 'x', hx, -hy, hy, z0, z1)
            fachwerk_face(beams, rnd, 'ny', hy, -hx, hx, z0, z1)
            fachwerk_face(beams, rnd, 'nx', -hx, -hy, hy, z0, z1)
    # Fenster auf allen Seiten (Haus kann gedreht stehen)
    nl, nw = max(1, int(l / 2.1)), max(1, int(w / 2.4))
    for f in range(floors):
        z0, z1 = zb + f * fh, zb + (f + 1) * fh
        door_i = rnd.randrange(nl) if f == 0 else None
        windows_face(f'{name}_fy{f}', M, rnd, 'y', -hy - 0.02, -hx, hx, z0, z1, nl, lit=lit, skip=door_i)
        windows_face(f'{name}_fny{f}', M, rnd, 'ny', hy + 0.02, -hx, hx, z0, z1, nl, lit=lit)
        windows_face(f'{name}_fx{f}', M, rnd, 'x', hx + 0.02, -hy, hy, z0, z1, nw, lit=lit)
        windows_face(f'{name}_fnx{f}', M, rnd, 'nx', -hx - 0.02, -hy, hy, z0, z1, nw, lit=lit)
        if f == 0:
            a = -hx + l * (door_i + 0.5) / nl
            box(f'{name}_tuer', (1.0, 0.1, 2.1), (a, -hy - 0.03, zb + 1.05), M['door'], bevel=0.02)
            o = box(f'{name}_stufe', (1.4, 0.7, 0.35), (a, -hy - 0.35, 0.17), M['stone'], bevel=0.05); wobble(o, 0.02)
    if beams: mesh_boxes(f'{name}_fachwerk', beams, M['timber'], bevel=0.015)
    # Dach: Giebel als Prisma, Dachhaut als zwei Platten mit Überstand, leicht durchhängend
    ang = math.radians(pitch + rnd.uniform(-4, 4))
    rh = hy * math.tan(ang)
    g = prism(f'{name}_giebel', [(-hy, wall_top), (hy, wall_top), (0, wall_top + rh)], l - 0.02, wall_m if style != 'fachwerk' else M['plaster'], axis='x', bevel=0.03)
    g.location = (0, 0, 0)
    ov = 0.45
    slope = math.hypot(hy, rh) + ov
    for s in (-1, 1):
        o = box(f'{name}_dach{s}', (l + 0.7, slope, 0.14),
                (0, s * (hy - (slope / 2) * math.cos(ang)) + s * 0.0, wall_top + rh - (slope / 2) * math.sin(ang) + 0.07),
                M[roof], rot=(-s * ang, 0, 0), bevel=0.03)
        # Platte an den First schieben
        o.location.y = s * (slope / 2) * math.cos(ang) - s * 0.02
        o.location.z = wall_top + rh - (slope / 2) * math.sin(ang) + 0.06
        soft(o, 0.04, 3); wobble(o, 0.07, 1.2, levels=3)
    cyl(f'{name}_first', 0.11, l + 0.75, (0, 0, wall_top + rh + 0.08), M[roof], rot=RY, verts=10)
    top = None
    if chimney:
        x = rnd.uniform(-hx * 0.6, hx * 0.6); y = rnd.uniform(-0.3, 0.6)
        zt = wall_top + rh + rnd.uniform(0.7, 1.2)
        o = block(f'{name}_kamin', x - 0.28, y - 0.28, wall_top, x + 0.28, y + 0.28, zt, M['brick_d'], bevel=0.03); wobble(o, 0.015)
        box(f'{name}_kaminkopf', (0.7, 0.7, 0.12), (x, y, zt), M['stone'], bevel=0.03)
        top = H.matrix_world @ Vector((x, y, zt + 0.15))
        # Weltkoordinaten erst nach Szenen-Update gültig: lokal berechnen
        c, s_ = math.cos(H.rotation_euler.z), math.sin(H.rotation_euler.z)
        top = (cx + x * c - y * s_, cy + x * s_ + y * c, zt + 0.15)
    if dormer:
        x = rnd.uniform(-hx * 0.4, hx * 0.4)
        o = block(f'{name}_gaube', x - 0.7, -hy * 0.55, wall_top + rh * 0.25, x + 0.7, -hy * 0.15, wall_top + rh * 0.62, wall_m, bevel=0.03)
        prism(f'{name}_gaubendach', [(-0.85, wall_top + rh * 0.6), (0.85, wall_top + rh * 0.6), (0, wall_top + rh * 0.82)], 1.0, M[roof], axis='y').location = (x, -hy * 0.35, 0)
        box(f'{name}_gaubenfenster', (0.8, 0.06, 0.6), (x, -hy * 0.56, wall_top + rh * 0.43), M['lit' if rnd.random() < 0.4 else 'glass'], bevel=0)
    if shed:
        sx = hx + shed / 2
        o = block(f'{name}_anbau', hx - 0.05, -hy * 0.75, 0, hx + shed, hy * 0.6, 2.3, M['wood_g'] if rnd.random() < 0.6 else M['brick'], bevel=0.03)
        wobble(o, 0.02)
        r = box(f'{name}_anbaudach', (shed + 0.5, hy * 1.6, 0.08), (sx + 0.1, -0.07, 2.55), M['tin' if rnd.random() < 0.5 else 'tar'], rot=(0, math.radians(14), 0), bevel=0.02)
        wobble(r, 0.04, 1.0)
        box(f'{name}_anbautuer', (0.06, 1.1, 1.9), (hx + shed + 0.02, 0.2, 0.95), M['wood'], bevel=0.01)
    E.set_parent(prev)
    return top

def fence(name, pts, M, rnd, h=1.15, gap=0.13, missing=0.06):
    """Lattenzaun mit schiefen Pfosten, zwei Riegeln und fehlenden Latten"""
    boxes_p, boxes_l = [], []
    for (ax_, ay_), (bx_, by_) in zip(pts[:-1], pts[1:]):
        dx, dy = bx_ - ax_, by_ - ay_; L = math.hypot(dx, dy); ang = math.atan2(dy, dx)
        ux, uy = dx / L, dy / L
        npost = max(1, int(L / 1.9))
        for i in range(npost + 1):
            t = i / npost
            boxes_p.append((0.1, 0.1, h + 0.15, (ax_ + dx * t, ay_ + dy * t, (h + 0.15) / 2), (rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), ang)))
        for z in (0.3, h - 0.2):
            boxes_l.append((L, 0.04, 0.07, ((ax_ + bx_) / 2 - uy * 0.06, (ay_ + by_) / 2 + ux * 0.06, z + rnd.uniform(-0.04, 0.04)), (rnd.uniform(-0.02, 0.02), 0, ang)))
        n = int(L / gap)
        for i in range(n):
            if rnd.random() < missing: continue
            t = (i + 0.5) / n
            hh = h * rnd.uniform(0.88, 1.0)
            boxes_l.append((0.07, 0.02, hh, (ax_ + dx * t - uy * 0.09, ay_ + dy * t + ux * 0.09, hh / 2 + 0.05), (rnd.uniform(-0.05, 0.05), rnd.uniform(-0.04, 0.04), ang)))
    mesh_boxes(f'{name}_pfosten', boxes_p, M['wood_g'], bevel=0.01)
    mesh_boxes(f'{name}_latten', boxes_l, M['wood_g'], bevel=0.005)

def wall(name, pts, M, kind='stone', h=1.2, th=0.45, rnd=None):
    m = M['stone'] if kind == 'stone' else M['brick']
    for k, ((ax_, ay_), (bx_, by_)) in enumerate(zip(pts[:-1], pts[1:])):
        dx, dy = bx_ - ax_, by_ - ay_; L = math.hypot(dx, dy); ang = math.atan2(dy, dx)
        hh = h * (rnd.uniform(0.85, 1.05) if rnd else 1)
        o = box(f'{name}{k}', (L + th * 0.5, th, hh), ((ax_ + bx_) / 2, (ay_ + by_) / 2, hh / 2), m, rot=(0, 0, ang), bevel=0.06)
        soft(o, 0.08, 3); wobble(o, 0.05, 0.5)
        if kind == 'brick':
            box(f'{name}{k}_ab', (L + th * 0.6, th + 0.1, 0.1), ((ax_ + bx_) / 2, (ay_ + by_) / 2, hh + 0.04), M['stone'], rot=(0, 0, ang), bevel=0.03)

def garden(name, x0, y0, x1, y1, M, rnd, rows_x=True):
    """Gemüsebeete: dunkle Erde mit Reihen kleiner Pflanzen"""
    o = block(f'{name}_erde', x0, y0, 0, x1, y1, 0.12, M['soil'], bevel=0.05); soft(o, 0.08, 3); wobble(o, 0.04, 0.4)
    blobs = []
    if rows_x:
        n = max(1, int((y1 - y0) / 0.7))
        for r in range(n):
            y = y0 + (r + 0.5) * (y1 - y0) / n
            k = int((x1 - x0) / 0.35)
            for i in range(k):
                if rnd.random() < 0.15: continue
                s = rnd.uniform(0.12, 0.22)
                blobs.append((s, s, s * 0.8, (x0 + (i + 0.5) * (x1 - x0) / k, y + rnd.uniform(-0.05, 0.05), 0.15), (0, 0, rnd.uniform(0, 3))))
    else:
        n = max(1, int((x1 - x0) / 0.7))
        for r in range(n):
            x = x0 + (r + 0.5) * (x1 - x0) / n
            k = int((y1 - y0) / 0.35)
            for i in range(k):
                if rnd.random() < 0.15: continue
                s = rnd.uniform(0.12, 0.22)
                blobs.append((s, s, s * 0.8, (x + rnd.uniform(-0.05, 0.05), y0 + (i + 0.5) * (y1 - y0) / k, 0.15), (0, 0, rnd.uniform(0, 3))))
    if blobs:
        o = mesh_boxes(f'{name}_pflanzen', blobs, M['veg'], bevel=0.05)
        wobble(o, 0.04, 0.1, levels=1)

def fruit_tree(name, x, y, h, M, rnd):
    line_cyl(f'{name}_st', (x, y, 0), (x + rnd.uniform(-0.3, 0.3), y + rnd.uniform(-0.3, 0.3), h * 0.45), 0.14, M['timber'], verts=8)
    for k in range(6):
        p = (x + rnd.uniform(-1.1, 1.1), y + rnd.uniform(-1.1, 1.1), h * rnd.uniform(0.55, 0.85))
        o = sphere(f'{name}_k{k}', rnd.uniform(0.8, 1.3), p, M['leaf'], seg=12)
        o.scale = (1, 1, 0.85)
        d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(f'{name}{k}', 'CLOUDS'); t.noise_scale = 0.3; d.texture = t; d.strength = 0.45

def woodpile(name, x, y, l, M, rnd, rot=0.0):
    logs = []
    for layer in range(4):
        for i in range(int(l / 0.22) - layer):
            logs.append((0.2, 0.75, 0.2, (x + (i + layer * 0.5) * 0.22 - l / 2, y, 0.11 + layer * 0.19), (0, 0, rot + rnd.uniform(-0.05, 0.05))))
    o = mesh_boxes(name, logs, M['wood'], bevel=0.06)
    box(f'{name}_dach', (l + 0.4, 1.0, 0.06), (x, y, 1.0), M['tar'], rot=(0.1, 0, rot), bevel=0.01)

def washing_line(name, a, b, M, rnd):
    for p in (a, b): cyl(f'{name}_pf{p[0]}', 0.05, 1.9, (p[0], p[1], 0.95), M['wood_g'], verts=6)
    line_cyl(f'{name}_leine', (a[0], a[1], 1.8), (b[0], b[1], 1.8), 0.01, M['steel'], verts=4)
    n = 4
    for i in range(n):
        t = (i + 1) / (n + 1)
        x, y = a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t
        ang = math.atan2(b[1] - a[1], b[0] - a[0])
        box(f'{name}_tuch{i}', (rnd.uniform(0.4, 0.7), 0.02, rnd.uniform(0.4, 0.8)), (x, y, 1.45), M['cloth' if i % 2 else 'white'], rot=(0, 0, ang), bevel=0)

def crate(name, loc, M, s=0.8, rot=0.0):
    o = box(name, (s, s, s * 0.8), (loc[0], loc[1], loc[2] + s * 0.4), M['wood'], rot=(0, 0, rot), bevel=0.04)

def barrel(name, loc, m, r=0.3, h=0.88):
    cyl(name, r, h, (loc[0], loc[1], loc[2] + h / 2), m, verts=20, bevel=0.03)

def cart(name, x, y, rot, M):
    c = E.empty(name); c.location = (x, y, 0); c.rotation_euler = (0, 0, rot); prev = E.PARENT; E.set_parent(c)
    box(f'{name}_k', (2.2, 1.2, 0.45), (0, 0, 0.85), M['wood'], bevel=0.03)
    for s in (-1, 1): cyl(f'{name}_r{s}', 0.55, 0.08, (0.2, s * 0.68, 0.55), M['wood'], rot=RX, verts=16)
    line_cyl(f'{name}_d', (1.1, 0, 0.8), (2.6, 0, 0.3), 0.05, M['wood'], verts=6)
    E.set_parent(prev)

def lattice_tower(name, x, y, z0, h, w, m, r=0.07):
    c = [(x - w / 2, y - w / 2), (x + w / 2, y - w / 2), (x + w / 2, y + w / 2), (x - w / 2, y + w / 2)]
    for i, (cx, cy) in enumerate(c): line_cyl(f'{name}_b{i}', (cx, cy, z0), (cx, cy, z0 + h), r, m)
    n = max(2, int(h / w))
    for k in range(n):
        za, zb = z0 + h * k / n, z0 + h * (k + 1) / n
        for i in range(4):
            a, b = c[i], c[(i + 1) % 4]
            line_cyl(f'{name}_x{k}{i}', (a[0], a[1], za), (b[0], b[1], zb), r * 0.6, m, verts=6)

def pile(name, x, y, r, h, m):
    o = E.cyl(name, r, h, (x, y, h / 2), m, verts=40, r2=r * 0.15)
    sub = o.modifiers.new('s', 'SUBSURF'); sub.levels = sub.render_levels = 2
    d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(name, 'CLOUDS'); t.noise_scale = 0.6; d.texture = t; d.strength = 0.35
    return o

def flagpole(x, y, h, M):
    cyl('Fahnenmast', 0.06, h, (x, y, h / 2), M['steel'], verts=10)
    return (x, y, h - 0.2)

def arch_windows(name, M, rnd, axis, plane, a0, a1, z0, z1, n, lit=0.15):
    """hohe Industriefenster mit Rundbogen-Sturz aus Klinker"""
    windows_face(name, M, rnd, axis, plane, a0, a1, z0, z1, n, h=(z1 - z0) * 0.62, w=1.2, lit=lit, shutters=0)
    out = {'y': (0, -1), 'x': (1, 0)}[axis]
    for i in range(n):
        a = a0 + (a1 - a0) * (i + 0.5) / n
        zc = z0 + (z1 - z0) * 0.55 + (z1 - z0) * 0.31 + 0.12
        if axis == 'y': o = cyl(f'{name}_bogen{i}', 0.7, 0.12, (a, plane - 0.04, zc), M['brick_d'], rot=RX, verts=20)
        else: o = cyl(f'{name}_bogen{i}', 0.7, 0.12, (plane + 0.04, a, zc), M['brick_d'], rot=RY, verts=20)
        o.scale = (1, 0.5, 1) if axis == 'y' else (0.5, 1, 1)

# ======================= Gebäude =======================
def dorf(M, S, rnd):
    h = S / 2
    soft_patch('Dorfgrund', -h - 0.6, -h - 0.6, h + 0.6, h + 0.6, E.ground1940('Dorfgrund', 'gras'), fade=1.6)
    soft_patch('Dorfstrasse', -h - 0.4, -1.4, h + 0.4, 0.6, E.ground1940('Strasse', 'hof'), fade=0.7, z=0.04)
    soft_patch('Kirchplatz', -1.8, -1.0, 3.2, 3.6, E.ground1940('Platz', 'pflaster'), fade=0.6, z=0.05)
    chim = []
    # Backsteinkirche mit Turm (hinten), Kirchhofmauer
    house('Kirche', -4.2, 5.9, 8.2, 4.8, M, rnd, floors=2, style='ziegel', roof='slate', ridge='x', pitch=52, lit=0.5, chimney=False)
    o = block('Turm', 0.4, 4.3, 0, 3.2, 7.1, 12.5, M['brick'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.02, 0.5)
    for k, (ax, pl) in enumerate((('y', 4.28), ('x', 3.22))):
        windows_face(f'Schall{k}', M, rnd, ax, pl, 0.6 if ax == 'y' else 4.5, 3.0 if ax == 'y' else 6.9, 9.6, 11.8, 2, h=1.1, w=0.5, lit=0, shutters=0)
    box('Uhr', (1.0, 0.08, 1.0), (1.8, 4.25, 8.4), M['white'], bevel=0.02)
    frustum('Turmhelm', (3.3, 3.3, 6.5), (1.8, 5.7, 15.7), M['copper'], top=(0.03, 0.03), rot=(0, 0, rnd.uniform(-0.03, 0.03)))
    line_cyl('Kreuz1', (1.8, 5.7, 18.9), (1.8, 5.7, 20.2), 0.05, M['gold'], verts=6)
    line_cyl('Kreuz2', (1.4, 5.7, 19.8), (2.2, 5.7, 19.8), 0.05, M['gold'], verts=6)
    wall('Kirchhof', [(-8.6, 2.6), (-3.2, 2.5), (-1.5, 2.9)], M, 'stone', h=1.1, rnd=rnd)
    for i in range(5):
        box(f'Grab{i}', (0.15, 0.5, 0.7), (-7.6 + i * 1.0, 3.5 + (i % 2) * 0.3, 0.35), M['stone'], rot=(0, rnd.uniform(-0.1, 0.1), 0), bevel=0.04)
    fruit_tree('Linde', -0.6, 2.2, 7.5, M, rnd)
    # Fachwerkhaus vorne links mit Garten und Lattenzaun
    chim.append(house('Haus1', -5.4, -3.6, 6.6, 5.2, M, rnd, floors=2, style='fachwerk', roof='tiles', ridge='x', rot=0.03, dormer=True, shed=1.6))
    soft_patch('Gartengrund', -9.4, -10.6, -1.0, -6.6, E.ground1940('Garten', 'gras'), fade=0.5, z=0.03)
    fence('Zaun1', [(-9.2, -7.2), (-9.3, -10.3), (-4.6, -10.6), (-1.4, -10.2), (-1.3, -7.3)], M, rnd)
    garden('Garten1', -8.6, -9.9, -5.4, -8.2, M, rnd)
    garden('Garten1b', -4.8, -9.9, -2.0, -8.6, M, rnd, rows_x=False)
    washing_line('Leine1', (-8.4, -7.6), (-5.6, -7.8), M, rnd)
    # Backsteinhaus vorne rechts, quer gestellt, mit Hofmauer und Holzstapel
    chim.append(house('Haus2', 3.6, -4.6, 6.4, 5.0, M, rnd, floors=1, style='ziegel', roof='tiles_d', ridge='y', rot=-0.05, dormer=True))
    wall('Hofmauer', [(1.6, -8.4), (5.6, -8.7)], M, 'brick', h=1.3, rnd=rnd)
    soft_patch('Obstwiese', 5.2, -10.8, 10.6, -1.0, E.ground1940('Wiese', 'gras'), fade=0.6, z=0.03)
    fence('Zaun2', [(5.9, -8.8), (10.2, -9.0), (10.4, -4.4), (8.6, -1.6)], M, rnd, h=1.0, gap=0.16)
    fruit_tree('Birne', 8.8, -7.4, 5.2, M, rnd)
    garden('Garten2', 7.2, -5.0, 9.6, -3.2, M, rnd, rows_x=False)
    woodpile('Holz2', 1.6, -2.0, 2.0, M, rnd, rot=1.57)
    # Putzhaus rechts mit Anbau, Wäscheleine
    chim.append(house('Haus3', 5.8, 2.6, 6.0, 4.6, M, rnd, floors=1, style='putz', roof='tiles', ridge='x', rot=0.06, shed=1.8))
    fence('Zaun3', [(3.0, 5.6), (9.8, 5.3), (10.0, 0.2)], M, rnd, h=1.0)
    garden('Garten3', 8.4, 0.8, 9.6, 4.6, M, rnd, rows_x=False)
    # Scheune links aus Brettern
    o = block('Scheune', -8.6, -1.2, 0, -4.8, 3.4, 3.8, M['wood_g'], bevel=0.04); soft(o, 0.05, 3); wobble(o, 0.03, 0.5)
    prism('Scheunendach', [(-2.7, 3.7), (2.7, 3.7), (0, 6.0)], 4.8, M['tiles_d'], axis='y').location = (-6.7, 1.1, 0)
    box('Scheunentor', (0.08, 2.4, 2.8), (-4.77, 1.1, 1.4), M['wood'], bevel=0.02)
    fruit_tree('Apfel', -2.6, -2.6, 5.0, M, rnd)
    cyl('Brunnen', 0.8, 0.8, (1.4, 1.4, 0.4), M['stone'], verts=24, bevel=0.05)
    cart('Karren', -3.0, -0.3, 0.4, M)
    for i in range(3): barrel(f'Fass{i}', (3.2 + i * 0.65, -2.0 + (i % 2) * 0.2, 0), M['wood'])
    return {'smoke': [c for c in chim if c][:3]}

def bauhof(M, S, rnd):
    h = S / 2
    soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'hof'), fade=1.2)
    # zweistöckiges Backstein-Verwaltungshaus hinten, Fachwerk-Werkstatt rechts
    house('Kontor', -3.8, 3.8, 9.0, 6.4, M, rnd, floors=2, style='ziegel', roof='tiles_d', ridge='x', rot=0.02, dormer=True, lit=0.5)
    house('Werkstatt', 4.6, 3.6, 8.4, 5.4, M, rnd, floors=1, style='fachwerk', roof='tiles', ridge='y', rot=-0.03, lit=0.4, chimney=True)
    o = block('Remise', 1.0, -3.2, 0, 7.6, 0.0, 3.4, M['wood_g'], bevel=0.04); soft(o, 0.05, 3); wobble(o, 0.03)
    r = box('Remisendach', (7.2, 3.8, 0.1), (4.3, -1.6, 3.6), M['tin'], rot=(math.radians(-10), 0, 0), bevel=0.02); wobble(r, 0.05, 1)
    for i in range(3): box(f'Remisentor{i}', (1.9, 0.08, 2.7), (2.2 + i * 2.15, -3.25, 1.4), M['wood'], bevel=0.02)
    # Derrick-Kran aus Holz und Stahl
    lattice_tower('Kran', -6.4, -4.8, 0, 10.5, 0.8, M['steel'])
    prev = E.PARENT; kr = E.pivot('Kranarm', (-6.4, -4.8, 0))
    line_cyl('Ausleger', (0, 0, 9.0), (5.8, 0.6, 11.2), 0.12, M['steel'])
    line_cyl('Abspannung', (0, 0, 10.5), (5.8, 0.6, 11.2), 0.03, M['steel'], verts=4)
    hk = E.pivot('Haken', (5.8, 0.6, 0))
    seil = line_cyl('Seil', (0, 0, 11.0), (0, 0, 3.5), 0.02, M['steel'], verts=4)
    box('Last', (1.4, 1.0, 0.7), (0, 0, 3.1), M['wood'], bevel=0.03)
    E.set_parent(prev)
    def pose(root, k):
        t = 2 * math.pi * k / 24
        root.rotation_euler = (0, 0, 0.55 * math.sin(t))
        hk.location.z = 1.6 * (1 - math.cos(t)) / 2      # Last steigt beim Schwenken
    anim = [{'root': kr, 'frames': 24, 'fps': 3, 'pose': pose}]
    # Baustofflager: Bretterstapel, Ziegelpaletten, Fässer
    for k in range(3):
        mesh_boxes(f'Bretter{k}', [(3.2, 0.2, 0.05, (-4.6, -7.4 + k * 0.6 + rnd.uniform(-0.05, 0.05), 0.05 + j * 0.06), (0, 0, rnd.uniform(-0.03, 0.03))) for j in range(8)], M['wood'], bevel=0.005)
    for k in range(4): box(f'Ziegelpalette{k}', (1.0, 1.0, 0.8), (-1.6 + (k % 2) * 1.2, -7.2 + (k // 2) * 1.2, 0.4), M['brick'], rot=(0, 0, rnd.uniform(-0.1, 0.1)), bevel=0.03)
    for i in range(4): barrel(f'Fass{i}', (2.0 + i * 0.7, -6.6 + (i % 2) * 0.4, 0), M['olive' if i % 2 else 'rust'])
    wall('Mauer', [(-8.6, -2.0), (-8.6, -8.6), (-3.0, -8.9)], M, 'brick', h=1.6, rnd=rnd)
    fence('Zaun', [(-2.6, -8.8), (4.0, -8.5), (8.6, -8.7), (8.7, -4.0)], M, rnd, h=1.3)
    return {'flag': flagpole(7.6, -7.6, 8.5, M), 'anim': anim}

def kraftwerk(M, S, rnd):
    h = S / 2
    soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'hof'), fade=1.0)
    o = block('Kesselhaus', -5.0, 0.2, 0, 0.8, 5.3, 8.5, M['brick'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.02)
    prism('Kesseldach', [(0.0, 8.5), (5.5, 8.5), (2.75, 10.3)], 6.2, M['slate'], axis='x').location = (-2.1, 0.0, 0)
    arch_windows('KesselV', M, rnd, 'y', 0.18, -4.6, 0.4, 0.5, 8.0, 3)
    arch_windows('KesselS', M, rnd, 'x', 0.82, 0.6, 5.0, 0.5, 8.0, 3)
    cyl('Schornstein', 0.95, 18.5, (-3.5, 3.8, 9.25), M['brick_d'], verts=32, r2=0.6)
    for z in (6.0, 12.0, 17.5): cyl(f'Ring{z}', 0.98 - z * 0.019, 0.25, (-3.5, 3.8, z), M['stone'], verts=32)
    o = cyl('Wasserbehaelter', 1.4, 4.8, (2.8, 3.3, 3.0), M['rust'], verts=40, bevel=0.06)
    for k in range(5): cyl(f'Niet{k}', 1.43, 0.06, (2.8, 3.3, 1.2 + k * 0.9), M['steel'], verts=40)
    line_cyl('Stuetze1', (1.6, 2.1, 0), (1.9, 2.4, 1.0), 0.1, M['steel']); line_cyl('Stuetze2', (4.0, 4.5, 0), (3.7, 4.2, 1.0), 0.1, M['steel'])
    pile('Kohlehaufen', -2.4, -2.6, 2.6, 1.8, M['coal'])
    for i in range(2): box(f'Trafo{i}', (1.0, 1.4, 1.5), (2.4 + i * 1.6, -2.4, 0.75), M['olive'], bevel=0.05)
    fence('Zaun', [(0.8, -4.6), (5.4, -4.9), (5.3, -0.6)], M, rnd, h=1.6, missing=0.03)
    for i in range(2): line_cyl(f'Gleis{i}', (-5.4, -4.4 + i * 0.75, 0.08), (0.6, -4.6 + i * 0.75, 0.08), 0.04, M['steel'], verts=6)
    return {'smoke': [(-3.5, 3.8, 18.6)], 'flag': flagpole(-4.9, -4.9, 7.0, M)}

def mine(kind):
    def build(M, S, rnd):
        h = S / 2
        soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'hof'), fade=1.0)
        house('Maschinenhaus', -2.6, 3.0, 5.6, 4.0, M, rnd, floors=1, style='ziegel', roof='tiles_d', ridge='x', rot=0.02, lit=0.5, chimney=True)
        for sx in (-1, 1):
            line_cyl(f'Bein{sx}', (1.2 + sx * 1.2, 0.8, 0), (1.2 + sx * 0.45, 0.8, 12.0), 0.17, M['steel'])
            line_cyl(f'Strebe{sx}', (1.2 + sx * 1.0, -2.6, 0), (1.2 + sx * 0.4, 0.6, 10.5), 0.14, M['steel'])
            for k in range(5):
                z = 1.6 + k * 2.1; wd = 1.2 - (z / 12) * 0.75
                line_cyl(f'Quer{sx}{k}', (1.2 - wd, 0.8, z), (1.2 + wd, 0.8, z), 0.06, M['steel'], verts=6)
        box('Bühne', (1.8, 1.5, 0.2), (1.2, 0.8, 12.0), M['steel'], bevel=0.01)
        wheels = []
        prev = E.PARENT; grp = E.pivot('Seilscheiben', (0, 0, 0))
        for k, dy in enumerate((0.35, 1.25)):
            wheels.append(E.pivot(f'Seilscheibe{k}', (1.2, dy, 13.15)))
            E.spoke_wheel(f'Scheibe{k}', 1.2, 0.14, 6, M['rust']); E.set_parent(grp)
        E.set_parent(prev)
        # 6 Speichen: nach 60° sieht das Rad wieder gleich aus
        def pose(root, k):
            for x, sg in zip(wheels, (1, -1)): x.rotation_euler = (sg * k * math.radians(60) / 8, 0, 0)
        anim = [{'root': grp, 'frames': 8, 'fps': 8, 'pose': pose}]
        o = block('Schachthalle', 0.0, -0.4, 0, 2.6, 2.0, 3.0, M['wood_g'], bevel=0.04); soft(o, 0.05); wobble(o, 0.03)
        box('Schachtdach', (3.0, 2.8, 0.08), (1.3, 0.8, 3.2), M['tin'], rot=(0.15, 0, 0), bevel=0.02)
        line_cyl('Seil', (1.2, 0.35, 12.9), (-1.0, 2.0, 4.6), 0.03, M['steel'], verts=4)
        mp = {'kohle': M['coal'], 'eisen': M['iron'], 'gold': M['gold']}[kind]
        pile('Halde', 2.8, -2.8, 2.3, 1.8, mp); pile('Halde2', 4.2, -0.4, 1.3, 1.0, mp)
        # Holzbunker mit Rutsche
        o = block('Bunker', -4.8, -3.6, 1.4, -2.4, -1.2, 3.6, M['wood'], bevel=0.04); wobble(o, 0.03)
        for x in (-4.6, -2.6):
            for y in (-3.4, -1.4): line_cyl(f'Bunkerbein{x}{y}', (x, y, 0), (x, y, 1.45), 0.1, M['wood'], verts=6)
        for i in range(2): line_cyl(f'Schiene{i}', (-4.8, -5.2 + i * 0.7, 0.08), (2.0, -4.6 + i * 0.7, 0.08), 0.04, M['steel'], verts=6)
        block('Lore', -1.2, -5.2, 0.3, 0.3, -4.2, 1.0, M['rust'], bevel=0.05)
        pile('Ladung', -0.45, -4.7, 0.6, 0.35, mp).location.z = 1.0
        fence('Zaun', [(-5.5, 5.2), (-5.4, -1.0)], M, rnd)
        return {'flag': flagpole(-5.0, -5.0, 6.5, M), 'anim': anim}
    return build

def kaserne(M, S, rnd):
    h = S / 2
    soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'hof'), fade=1.0)
    house('Mannschaft', -1.0, 2.6, 9.4, 5.2, M, rnd, floors=2, style='putz', roof='tiles_d', ridge='x', rot=0.015, dormer=True, lit=0.55)
    house('Wache', 3.6, -3.2, 3.2, 3.0, M, rnd, floors=1, style='ziegel', roof='tiles', ridge='y', rot=-0.08, lit=0.6)
    o = block('Garage', -5.2, -4.6, 0, -1.0, -1.2, 2.8, M['wood_g'], bevel=0.04); wobble(o, 0.03)
    box('Garagendach', (4.6, 3.8, 0.08), (-3.1, -2.9, 3.0), M['tar'], rot=(math.radians(-8), 0, 0), bevel=0.02)
    from eflib import sandbags
    sandbags('Sand', 1.2, -5.2, 2.2, -5.3, 3, M['sand'])
    for i in range(3): crate(f'Kiste{i}', (-0.6 + i * 0.9, -4.6 + (i % 2) * 0.3, 0), M, rot=rnd.uniform(-0.3, 0.3))
    box('Plane', (2.4, 1.6, 1.0), (4.0, 0.6, 0.6), M['canvas'], bevel=0.3)
    fence('Zaun', [(-5.5, -5.4), (0.6, -5.6)], M, rnd, h=1.8, gap=0.25)
    return {'flag': flagpole(5.0, -5.0, 8.0, M)}

def panzerfabrik(M, S, rnd):
    h = S / 2
    soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'pflaster'), fade=1.0)
    x0, x1, y0, y1, H = -7.6, 3.6, -0.6, 7.6, 7.0
    o = block('Halle', x0, y0, 0, x1, y1, H, M['brick'], bevel=0.06); soft(o, 0.06); wobble(o, 0.02)
    n = 5; dy = (y1 - y0) / n
    for i in range(n):
        ya = y0 + i * dy
        p = prism(f'Shed{i}', [(0, H), (dy, H), (dy, H + 2.2), (dy - 0.15, H + 2.2)], x1 - x0 + 0.3, M['tar'], axis='x')
        p.location = ((x0 + x1) / 2, ya, 0)
        box(f'Shedglas{i}', (x1 - x0 - 0.3, 0.06, 1.9), ((x0 + x1) / 2, ya + dy - 0.02, H + 1.1), M['lit' if i % 2 else 'glass'], bevel=0)
    arch_windows('HalleV', M, rnd, 'y', y0 - 0.02, x0, x1, 0.4, H - 0.4, 6)
    arch_windows('HalleS', M, rnd, 'x', x1 + 0.02, y0, y1, 0.4, H - 0.4, 4)
    for i in range(2): box(f'Tor{i}', (3.0, 0.15, 4.2), (-5.4 + i * 4.4, y0 - 0.06, 2.1), M['wood'], bevel=0.03)
    house('Buero', 5.6, 5.0, 4.6, 4.0, M, rnd, floors=2, style='ziegel', roof='tiles_d', ridge='y', rot=0.02, lit=0.5)
    cyl('Schornstein', 0.7, 15.0, (6.8, 1.2, 7.5), M['brick_d'], verts=28, r2=0.5)
    for sx in (-6.8, 1.6):
        for sy in (-6.8, -2.2): line_cyl(f'Kranbein{sx}{sy}', (sx, sy, 0), (sx, sy, 6.0), 0.18, M['steel'])
        box(f'Kranquer{sx}', (0.4, 5.0, 0.5), (sx, -4.5, 6.1), M['steel'], bevel=0.02)
    prev = E.PARENT; kb = E.pivot('Kranbruecke', (0, 0, 0))
    box('Bruecke', (0.6, 5.2, 0.6), (-2.6, -4.5, 6.6), M['steel'], bevel=0.02)
    box('Laufkatze', (0.9, 0.9, 0.5), (-2.6, -4.5, 6.15), M['yellow'] if 'yellow' in M else M['rust'], bevel=0.02)
    line_cyl('Kranseil', (-2.6, -4.5, 6.0), (-2.6, -4.5, 3.0), 0.03, M['steel'], verts=4)
    box('Turmrohling', (1.6, 1.4, 0.7), (-2.6, -4.5, 2.6), M['olive'], bevel=0.05)
    E.set_parent(prev)
    def pose(root, k): root.location.x = 3.4 * math.sin(2 * math.pi * k / 24)
    anim = [{'root': kb, 'frames': 24, 'fps': 3, 'pose': pose}]
    prism('Wanne', [(-2.8, 0.5), (2.6, 0.5), (3.0, 1.0), (3.0, 1.9), (-2.9, 1.9), (-2.9, 0.9)], 2.4, M['olive'], axis='y').location = (-5.0, -4.5, 0)
    for i in range(3): crate(f'Kiste{i}', (6.4 + (i % 2) * 0.9, -6.8 + i * 0.9, 0), M, rot=rnd.uniform(-0.3, 0.3))
    wall('Mauer', [(8.6, -2.0), (8.7, -8.7), (2.6, -8.8)], M, 'brick', h=1.8, rnd=rnd)
    return {'smoke': [(6.8, 1.2, 15.1)], 'flag': flagpole(7.8, 3.0, 9.0, M), 'anim': anim}

def verwaltung(M, S, rnd):
    h = S / 2
    soft_patch('Platz', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Platz', 'pflaster'), fade=1.0)
    house('Rathaus', -1.0, 1.6, 8.0, 6.4, M, rnd, floors=3, style='fachwerk', roof='tiles_d', ridge='x', rot=0.0, dormer=True, lit=0.55, chimney=True, pitch=52)
    # Dachreiter mit Uhr
    o = block('Dachreiter', -1.6, 1.1, 12.0, -0.4, 2.3, 14.0, M['wood_g'], bevel=0.03)
    frustum('Haube', (1.6, 1.6, 2.0), (-1.0, 1.7, 15.0), M['copper'], top=(0.05, 0.05))
    box('Uhr', (0.7, 0.06, 0.7), (-1.0, 1.06, 13.2), M['white'], bevel=0.02)
    wall('Mauer', [(-5.3, -2.6), (-1.6, -2.8)], M, 'brick', h=0.9, rnd=rnd)
    wall('Mauer2', [(0.6, -2.8), (5.2, -2.5), (5.3, 3.0)], M, 'brick', h=0.9, rnd=rnd)
    fruit_tree('Linde', 3.8, -4.4, 7.0, M, rnd)
    fruit_tree('Linde2', -4.4, -4.6, 6.0, M, rnd)
    for i in range(2): box(f'Bank{i}', (1.6, 0.4, 0.45), (-3.8 + i * 5.4, -1.8, 0.22), M['wood'], bevel=0.03)
    return {'flag': flagpole(0.0, -2.0, 9.5, M)}

def forschung(M, S, rnd):
    h = S / 2
    soft_patch('Hof', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Hof', 'gras'), fade=1.0)
    house('Institut', -1.6, 2.4, 7.4, 5.2, M, rnd, floors=2, style='klinker', roof='slate', ridge='x', rot=0.01, lit=0.65, dormer=True)
    cyl('Sternwarte', 2.0, 3.2, (3.4, -2.6, 1.6), M['plaster_g'], verts=40, bevel=0.05)
    o = sphere('Kuppel', 2.05, (3.4, -2.6, 3.2), M['copper'], seg=32); o.scale = (1, 1, 0.85)
    box('Spalt', (0.5, 2.2, 1.8), (3.4, -2.6, 4.5), M['steel'], rot=(0, math.radians(30), math.radians(-45)), bevel=0)
    # Würzburg-Funkmessgerät
    line_cyl('Sockel', (-3.6, -3.6, 0), (-3.6, -3.6, 2.6), 0.3, M['olive'])
    prev = E.PARENT; rd = E.pivot('Funkmess', (-3.6, -3.6, 0))
    box('Gabel', (0.5, 0.9, 1.0), (0, 0, 3.0), M['olive'], bevel=0.04)
    d = sphere('Spiegel', 1.9, (0.45, 0, 3.8), M['olive'], seg=24); d.scale = (0.25, 1, 1); d.rotation_euler = (0, math.radians(-30), 0)
    line_cyl('Erreger', (0.45, 0, 3.8), (1.5, 0, 4.4), 0.04, M['steel'], verts=6)
    E.set_parent(prev)
    def pose(root, k): root.rotation_euler = (0, 0, math.radians(-40) + 2 * math.pi * k / 24)
    pose(rd, 0)
    anim = [{'root': rd, 'frames': 24, 'fps': 4, 'pose': pose}]
    wall('Mauer', [(-5.6, -0.6), (-5.6, 5.4)], M, 'brick', h=1.2, rnd=rnd)
    garden('Beet', 0.4, -5.6, 2.2, -4.6, M, rnd)
    return {'flag': flagpole(5.2, 3.8, 7.0, M), 'anim': anim}

def flugfeld(M, S, rnd):
    h = S / 2
    soft_patch('Grasplatz', -h - 0.5, -h - 0.5, h + 0.5, h + 0.5, E.ground1940('Gras', 'gras'), fade=1.5)
    soft_patch('Rollfeld', -h - 0.3, -3.2, h + 0.3, 1.8, E.ground1940('Rollfeld', 'hof'), fade=0.8, z=0.04)
    o = cyl('Hangar', 3.5, 8.0, (-3.6, 5.4, 0.0), M['tin'], rot=(0, math.radians(90), 0), verts=48); wobble(o, 0.03, 1.0)
    box('Hangarstirn', (8.0, 0.1, 3.4), (-3.6, 1.95, 1.7), M['wood_g'], bevel=0.02)
    house('Leitstelle', 4.8, 5.0, 3.4, 3.2, M, rnd, floors=2, style='ziegel', roof='tar', ridge='x', pitch=12, chimney=False, lit=0.6)
    box('Kanzel', (2.6, 2.4, 1.2), (4.8, 5.0, 7.0), M['glass'], bevel=0.04)
    line_cyl('Windsackmast', (7.0, -6.0, 0), (7.0, -6.0, 4.0), 0.05, M['steel'])
    prev = E.PARENT; ws = E.pivot('Windsack', (7.0, -6.0, 3.9))
    for i in range(4): E.cyl(f'Sackring{i}', 0.34 - i * 0.05, 0.42, (0.3 + i * 0.4, 0, -0.05 * i), M['white'] if i % 2 == 0 else M['rust'], rot=(0, math.radians(84), 0), verts=12, r2=0.3 - i * 0.05)
    E.set_parent(prev)
    def pose(root, k): t = 2 * math.pi * k / 8; root.rotation_euler = (0.08 * math.sin(2 * t), 0.12 * math.sin(t), 0.3 * math.sin(t + 0.6))
    anim = [{'root': ws, 'frames': 8, 'fps': 5, 'pose': pose}]
    for i in range(6): barrel(f'Fass{i}', (-7.0 + (i % 3) * 0.7, -6.6 + (i // 3) * 0.7, 0), M['olive' if i % 3 else 'rust'])
    fence('Zaun', [(-8.6, -8.6), (0.0, -8.8)], M, rnd, h=1.0, gap=0.3)
    return {'flag': flagpole(6.8, 2.8, 8.0, M), 'anim': anim}

def werft(M, S, rnd):
    h = S / 2
    soft_patch('Kai', -h - 0.3, -h - 0.3, h + 0.3, h + 0.3, E.ground1940('Kai', 'pflaster'), fade=0.8)
    o = block('Kaimauer', -h, -h, 0, h, -h + 1.2, 0.8, M['stone'], bevel=0.06); wobble(o, 0.03)
    prism('Rumpf', [(-6.5, 1.0), (4.5, 1.0), (6.8, 2.2), (6.8, 3.8), (-6.8, 3.8), (-6.8, 2.0)], 3.2, M['steel'], axis='y').location = (-0.4, -3.4, 0)
    block('Deck', -7.0, -4.9, 3.8, 6.4, -1.9, 3.95, M['wood'], bevel=0.02)
    for i in range(7):
        x = -6.4 + i * 2.0
        for sy in (-5.5, -1.3): line_cyl(f'Geruest{i}{sy}', (x, sy, 0), (x + 0.1, sy, 5.4), 0.07, M['wood'], verts=6)
    for sy in (-5.5, -1.3): line_cyl(f'GeruestL{sy}', (-6.4, sy, 5.4), (5.7, sy, 5.4), 0.07, M['wood'], verts=6)
    lattice_tower('Kran', 3.2, 1.6, 0, 11.0, 1.0, M['steel'])
    prev = E.PARENT; wk = E.pivot('Werftkran', (3.2, 1.6, 0))
    box('Kranhaus', (1.6, 1.4, 1.2), (0.3, 0, 11.6), M['rust'], bevel=0.03)
    box('Kranausleger', (10.0, 0.5, 0.5), (-3.0, 0, 11.8), M['steel'], rot=(0, math.radians(-12), 0), bevel=0.02)
    line_cyl('Werftseil', (-7.6, 0, 12.7), (-7.6, 0, 6.0), 0.03, M['steel'], verts=4)
    box('Werftlast', (1.6, 1.0, 0.6), (-7.6, 0, 5.6), M['wood'], bevel=0.03)
    E.set_parent(prev)
    def pose(root, k): root.rotation_euler = (0, 0, 0.5 * math.sin(2 * math.pi * k / 24))
    anim = [{'root': wk, 'frames': 24, 'fps': 3, 'pose': pose}]
    house('Lager', -3.2, 5.0, 9.0, 5.0, M, rnd, floors=2, style='ziegel', roof='tiles_d', ridge='x', rot=-0.02, lit=0.4)
    for i in range(4): crate(f'Kiste{i}', (5.6 + (i % 2), 4.6 + (i // 2) * 1.1, 0), M, rot=rnd.uniform(-0.3, 0.3))
    for k in range(3):
        mesh_boxes(f'Planken{k}', [(4.0, 0.25, 0.08, (5.0, -0.6 + k * 0.5, 0.05 + j * 0.09), (0, 0, rnd.uniform(-0.03, 0.03))) for j in range(6)], M['wood'], bevel=0.005)
    return {'flag': flagpole(7.6, -1.0, 9.0, M), 'anim': anim}

BUILDINGS = {
    'dorf': (3, 165, dorf), 'bauhof': (3, 150, bauhof), 'kraftwerk': (2, 170, kraftwerk), 'kohlebergwerk': (2, 120, mine('kohle')),
    'eisenbergwerk': (2, 120, mine('eisen')), 'goldmine': (2, 120, mine('gold')), 'kaserne': (2, 110, kaserne),
    'panzerfabrik': (3, 160, panzerfabrik), 'verwaltung': (2, 150, verwaltung), 'forschungszentrum': (2, 120, forschung),
    'flugfeld': (3, 100, flugfeld), 'werft': (3, 120, werft),
}

def screen_offset(p, anchor_world):
    d = Vector(p) - Vector(anchor_world)
    return [round(d.dot(E.RIGHT) * E.PXM / 2, 1), round(-d.dot(E.UP) * E.PXM / 2, 1)]

if __name__ == '__main__':
    meta_all = {}
    for name, (size, top, fn) in BUILDINGS.items():
        if ONLY and name not in ONLY: continue
        Sm = size * E.TILE_M
        m = max(16 * size, int(top * 0.85)); mb = max(16 * size, int(top * 0.45))
        W, H = size * 64 + 2 * m, top + size * 32 + mb
        ax, ay = m + size * 32, top + size * 32
        corner = (Sm / 2, -Sm / 2, 0)
        E.reset(name)
        M = materials()
        rnd = random.Random(sum(map(ord, name)))
        info = fn(M, Sm, rnd) or {}
        catcher = E.shadow_catcher()
        E.frame_camera(W * 2, H * 2, corner, ax * 2, ay * 2)
        anims = info.get('anim', [])
        E.hide_moving(anims)
        E.shoot(os.path.join(OUT, f'{name}_0.png'), SAMPLES)
        E.render_anims(anims, lambda gi, k: os.path.join(OUT, f'{name}.anim{gi}_{k}.png'), int(os.environ.get('ANIM_SAMPLES', SAMPLES)), catcher)
        for gi, a in enumerate(anims):
            meta_all[f'{name}.anim{gi}'] = {'frames': a['frames'], 'fps': a['fps'], 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0, 'w': W, 'h': H}
        meta = {'frames': 1, 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0, 'w': W, 'h': H}
        if 'flag' in info: meta['flag'] = screen_offset(info['flag'], corner)
        if 'smoke' in info:
            meta['smoke'] = [[round((x + Sm / 2) / E.TILE_M, 3), round((-y + Sm / 2) / E.TILE_M, 3), round(z * 0.866 * E.PXM / 2 / 32, 3)] for x, y, z in info['smoke']]
        meta_all[name] = meta
        print('fertig', name)
    json.dump(meta_all, open(os.path.join(OUT, f'meta_{"_".join(ONLY) or "alle"}.json'), 'w'), indent=1)
