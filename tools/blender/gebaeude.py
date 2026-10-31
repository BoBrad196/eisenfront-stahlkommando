# Gebäude für Eisenfront in Blender: Modelle, Render (mit Schatten) und Metadaten fürs Manifest.
# Aufruf: python gebaeude.py <ausgabeordner> [name ...]
import bpy, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(__file__))
import eflib as E
from eflib import block, box, cyl, line_cyl, prism, sphere, frustum, gable_house, windows_on_box, crate, barrel, sandbags, RX, RY
from mathutils import Vector

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 48))

def materials():
    M = {}
    M['brick'] = E.brick('Ziegel')
    M['brick2'] = E.brick('Ziegel2', color=(0.28, 0.12, 0.08))
    M['conc'] = E.concrete('Beton')
    M['conc_d'] = E.concrete('Beton dunkel', color=(0.30, 0.29, 0.27))
    M['plaster'] = E.painted('Putz', (0.56, 0.51, 0.42), 0.85, chips=False, mud_h=0.9, streaks=0.6)
    M['plaster2'] = E.painted('Putz2', (0.52, 0.47, 0.36), 0.85, chips=False, mud_h=0.9, streaks=0.6)
    M['olive'] = E.painted('Oliv', (0.20, 0.21, 0.13), 0.75, mud_h=0.8)
    M['steel'] = E.painted('Stahl', (0.10, 0.10, 0.095), 0.5, mud_h=0.6, metal_edge=(0.3, 0.29, 0.28))
    M['rust'] = E.painted('Rost', (0.25, 0.12, 0.05), 0.85, chips=False, mud_h=0)
    M['tin'] = E.corrugated('Wellblech')
    M['tin_g'] = E.corrugated('Wellblech grün', color=(0.17, 0.2, 0.13), rust=0.25)
    M['roof'] = E.roof_tiles('Dachziegel')
    M['roof2'] = E.roof_tiles('Dachziegel2', color=(0.30, 0.10, 0.06))
    M['slate'] = E.roof_tiles('Schiefer', color=(0.12, 0.12, 0.13))
    M['copper'] = E.painted('Kupfer', (0.18, 0.32, 0.27), 0.6, chips=False, mud_h=0)
    M['wood'] = E.wood('Holz')
    M['glass'] = E.plain('Glas', (0.02, 0.025, 0.03), 0.12, 0.1)
    M['lit'] = E.plain('Licht', (0.9, 0.7, 0.4), 0.5, emission=(1.0, 0.72, 0.38), strength=2.5)
    M['white'] = E.plain('Weiß', (0.7, 0.68, 0.62), 0.6)
    M['coal'] = E.plain('Kohle', (0.025, 0.025, 0.025), 0.45)
    M['iron'] = E.painted('Eisenerz', (0.28, 0.11, 0.05), 0.9, chips=False, mud_h=0, streaks=0)
    M['gold'] = E.painted('Golderz', (0.42, 0.33, 0.12), 0.6, chips=False, mud_h=0, streaks=0)
    M['gravel'] = E.concrete('Schotter', color=(0.33, 0.30, 0.25), bump=0.6)
    M['sand'] = E.painted('Sandsack', (0.40, 0.34, 0.22), 0.95, chips=False, mud_h=0.4, streaks=0)
    M['canvas'] = E.painted('Plane', (0.22, 0.23, 0.15), 0.9, chips=False)
    M['leaf'] = E.painted('Laub', (0.10, 0.15, 0.04), 0.8, chips=False, mud_h=0, streaks=0, dust_amt=0.2)
    M['cobble'] = E.concrete('Pflaster', color=(0.36, 0.33, 0.29), bump=0.8)
    M['garden'] = E.painted('Garten', (0.14, 0.11, 0.07), 0.95, chips=False, mud_h=0, streaks=0)
    M['grass'] = E.painted('Rasen', (0.09, 0.13, 0.04), 0.9, chips=False, mud_h=0, streaks=0)
    return M

# ---------- Bausteine ----------
def lattice_tower(name, x, y, z0, h, w, m, r=0.07):
    c = [(x - w / 2, y - w / 2), (x + w / 2, y - w / 2), (x + w / 2, y + w / 2), (x - w / 2, y + w / 2)]
    for i, (cx, cy) in enumerate(c): line_cyl(f'{name}_b{i}', (cx, cy, z0), (cx, cy, z0 + h), r, m)
    n = max(2, int(h / w))
    for k in range(n):
        za, zb = z0 + h * k / n, z0 + h * (k + 1) / n
        for i in range(4):
            a, b = c[i], c[(i + 1) % 4]
            line_cyl(f'{name}_x{k}{i}', (a[0], a[1], za), (b[0], b[1], zb), r * 0.6, m, verts=6)
            line_cyl(f'{name}_h{k}{i}', (a[0], a[1], zb), (b[0], b[1], zb), r * 0.6, m, verts=6)

def pile(name, x, y, r, h, m, seed=1):
    o = E.cyl(name, r, h, (x, y, h / 2), m, verts=40, r2=r * 0.15)
    sub = o.modifiers.new('s', 'SUBSURF'); sub.levels = sub.render_levels = 2
    d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(name, 'CLOUDS'); t.noise_scale = 0.6; d.texture = t; d.strength = 0.35
    return o

def flagpole(x, y, h, M):
    cyl('Fahnenmast', 0.06, h, (x, y, h / 2), M['steel'], verts=10)
    return (x, y, h - 0.2)

def fence_line(name, a, b, m, h=1.6):
    a, b = Vector(a), Vector(b); n = max(2, int((b - a).length / 2.5))
    for i in range(n + 1):
        p = a + (b - a) * (i / n); cyl(f'{name}_p{i}', 0.05, h, (p.x, p.y, h / 2), m, verts=6)
    for zz in (0.5, 1.0, h - 0.1): line_cyl(f'{name}_d{zz}', (a.x, a.y, zz), (b.x, b.y, zz), 0.02, m, verts=4)

def tree(name, x, y, h, M, kind='laub'):
    cyl(f'{name}_st', 0.18, h * 0.5, (x, y, h * 0.25), M['wood'], verts=8)
    rnd = random.Random(hash(name) & 0xffff)
    for k in range(7 if kind == 'laub' else 5):
        if kind == 'laub':
            p = (x + rnd.uniform(-1.2, 1.2), y + rnd.uniform(-1.2, 1.2), h * rnd.uniform(0.55, 0.85))
            o = sphere(f'{name}_k{k}', rnd.uniform(1.1, 1.7), p, M['leaf'], seg=12)
        else:
            o = E.cyl(f'{name}_k{k}', 1.6 - k * 0.28, h * 0.28, (x, y, h * (0.3 + k * 0.15)), M['leaf'], verts=10, r2=0.1)
        d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(f'{name}{k}', 'CLOUDS'); t.noise_scale = 0.35; d.texture = t; d.strength = 0.4

# ---------- Gebäude ----------
def bauhof(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['conc'], bevel=0.08)
    # Hauptgebäude (hinten), zweistöckig mit Attika
    block('Halle', -7.6, 0.2, 0.15, 0.2, 7.6, 6.4, M['brick'], bevel=0.04)
    block('Attika', -7.75, 0.05, 6.4, 0.35, 7.75, 6.8, M['conc_d'], bevel=0.04)
    block('Dach', -7.4, 0.4, 6.4, 0.0, 7.4, 6.6, M['conc_d'], bevel=0.02)
    windows_on_box('Halle', -3.7, 3.9, 7.8, 7.4, 0.15, 6.25, M['glass'], M['lit'], n=5, seed=3, ww=0.9, wh=1.2, rows=2)
    box('Eingang', (1.6, 0.25, 2.4), (-2.0, 0.08, 1.35), M['steel'])
    box('Vordach', (2.6, 1.3, 0.15), (-2.0, -0.4, 2.8), M['conc_d'])
    # Fahrzeughallen mit Toren
    block('Werkhalle', 0.2, 2.2, 0.15, 7.6, 7.6, 4.6, M['plaster2'], bevel=0.04)
    prism('Werkdach', [(2.0, 4.6), (7.8, 4.6), (7.8, 4.75), (2.0, 5.7)], 7.6, M['tin'], axis='x').location = (3.9, 0, 0)
    for i in range(3):
        box(f'Tor{i}', (2.0, 0.12, 3.0), (1.5 + i * 2.35, 2.12, 1.65), M['tin_g'], bevel=0.02)
    # Turmdrehkran hinten links
    E.lattice = None
    lattice_tower('Kran', -6.2, -5.6, 0.15, 13.5, 0.9, M['steel'])
    box('Ausleger', (13.0, 0.6, 0.6), (-1.2, -5.6, 14.0), M['steel'], bevel=0.01)
    box('Gegengewicht', (1.4, 1.0, 1.0), (-8.0, -5.6, 13.6), M['conc_d'])
    box('Kabine', (1.0, 1.0, 1.0), (-5.6, -5.6, 13.3), M['olive'])
    line_cyl('Seil', (3.5, -5.6, 13.7), (3.5, -5.6, 6.5), 0.02, M['steel'], verts=4)
    box('Last', (1.2, 1.2, 0.8), (3.5, -5.6, 6.1), M['wood'])
    # Hubschrauberplatz
    cyl('Landeplatz', 2.8, 0.1, (4.0, -4.0, 0.2), M['conc_d'], verts=48)
    for (sx, sy, sz, px, py) in ((0.25, 1.8, 0.03, -0.55, 0), (0.25, 1.8, 0.03, 0.55, 0), (1.1, 0.25, 0.03, 0, 0)):
        box('H', (sx, sy, sz), (4.0 + px - py, -4.0 + py, 0.27), M['white'], rot=(0, 0, math.radians(45)), bevel=0)
    # Tanks, Kisten, Fässer, Sandsäcke
    for i in range(2):
        cyl(f'Tank{i}', 1.0, 4.5, (-6.0 + i * 2.4, -1.6, 1.25), M['olive'], rot=RX, verts=32, bevel=0.05)
    for i, (cx, cy) in enumerate(((6.5, -1.0), (6.5, 0.0), (5.6, -0.5))):
        crate(f'Kiste{i}', (cx, cy, 0.15), M['wood'])
    for i in range(5): barrel(f'Fass{i}', (-1.0 + (i % 3) * 0.7, -7.0 + (i // 3) * 0.7, 0.15), M['olive' if i % 2 else 'rust'])
    sandbags('Sand', 0.5, -7.5, 4.0, -7.5, 3, M['sand'])
    return {'flag': flagpole(7.2, -7.2, 9.0, M)}

def kraftwerk(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['gravel'], bevel=0.08)
    block('Kesselhaus', -5.0, 0.2, 0.15, 0.6, 5.2, 8.0, M['brick'], bevel=0.04)
    prism('Kesseldach', [(0.0, 8.0), (5.4, 8.0), (2.7, 9.6)], 5.8, M['slate'], axis='x').location = (-2.2, 0, 0)
    windows_on_box('Kessel', -2.2, 2.7, 5.6, 5.0, 0.15, 7.8, M['glass'], M['lit'], n=3, seed=5, ww=0.8, wh=2.2, rows=2)
    # Schornstein
    cyl('Schornstein', 0.85, 18.0, (-3.6, 3.6, 9.15), M['brick2'], verts=32, r2=0.55)
    cyl('Schornsteinkopf', 0.68, 0.5, (-3.6, 3.6, 18.2), M['conc_d'], verts=32)
    # Speicher und Transformatoren
    for i, (cx, cy) in enumerate(((2.6, 3.2), (2.6, 0.2))):
        cyl(f'Speicher{i}', 1.3, 5.5, (cx, cy, 2.9), M['plaster'], verts=40, bevel=0.05)
        cyl(f'Speicherdach{i}', 1.35, 0.4, (cx, cy, 5.8), M['conc_d'], verts=40, r2=0.4)
    line_cyl('Rohr1', (0.6, 3.2, 4.5), (1.3, 3.2, 4.5), 0.25, M['rust'])
    line_cyl('Rohr2', (0.6, 0.6, 3.5), (1.3, 0.3, 3.5), 0.25, M['rust'])
    pile('Kohlehaufen', -2.6, -2.8, 2.4, 1.6, M['coal'])
    for i in range(3):
        box(f'Trafo{i}', (1.0, 1.4, 1.6), (2.0 + i * 1.4, -3.6, 0.95), M['olive'], bevel=0.04)
        for k in range(3): cyl(f'Isolator{i}{k}', 0.07, 0.6, (2.0 + i * 1.4, -4.0 + k * 0.4, 2.05), M['white'], verts=8)
    fence_line('Zaun1', (0.8, -5.2), (5.4, -5.2), M['steel'])
    fence_line('Zaun2', (5.4, -5.2), (5.4, -1.6), M['steel'])
    chimney = (-3.6, 3.6, 18.5)
    return {'smoke': [chimney], 'flag': flagpole(-4.8, -4.8, 7.0, M)}

def mine(kind):
    def build(M, S):
        h = S / 2
        block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['gravel'], bevel=0.08)
        gable_house('Maschinenhaus', -2.8, 3.0, 5.0, 3.6, 4.2, 1.8, M['brick'], M['roof2'], axis='x', z=0.15, win_m=M['glass'], lit_m=M['lit'], n_win=3, seed=11)
        # Förderturm
        for sx in (-1, 1):
            line_cyl(f'Bein{sx}', (1.0 + sx * 1.1, 1.2, 0.15), (1.0 + sx * 0.4, 1.2, 12.0), 0.16, M['steel'])
            line_cyl(f'Strebe{sx}', (1.0 + sx * 0.9, -2.0, 0.15), (1.0 + sx * 0.35, 1.0, 10.5), 0.13, M['steel'])
            for k in range(5):
                z = 1.5 + k * 2.1
                line_cyl(f'Quer{sx}{k}', (1.0 - (1.1 - (z / 12) * 0.7), 1.2, z), (1.0 + (1.1 - (z / 12) * 0.7), 1.2, z), 0.06, M['steel'], verts=6)
        box('Seilscheibenbühne', (1.6, 1.4, 0.2), (1.0, 1.2, 12.0), M['steel'], bevel=0.01)
        for k, dy in enumerate((0.75, 1.65)):
            o = cyl(f'Seilscheibe{k}', 0.9, 0.12, (1.0, dy, 12.9), M['rust'], rot=(0, math.radians(90), 0), verts=40)
        block('Schachthaus', -0.2, 0.0, 0.15, 2.2, 2.4, 2.8, M['tin'], bevel=0.03)
        line_cyl('Seil1', (1.0, 0.75, 12.9), (-1.6, 3.0, 4.6), 0.03, M['steel'], verts=4)
        mat_pile = {'kohle': M['coal'], 'eisen': M['iron'], 'gold': M['gold']}[kind]
        pile('Halde', 2.6, -2.6, 2.2, 1.7, mat_pile)
        pile('Halde2', 3.9, -0.6, 1.3, 1.0, mat_pile)
        for i in range(2): line_cyl(f'Schiene{i}', (-3.5, -1.6 + i * 0.7, 0.2), (2.0, -1.6 + i * 0.7, 0.2), 0.04, M['steel'], verts=6)
        block('Lore', -1.6, -1.9, 0.35, 0.0, -0.6, 1.15, M['rust'], bevel=0.04)
        pile('Lorenladung', -0.8, -1.25, 0.6, 0.4, mat_pile).location.z = 1.15
        for i in range(2): crate(f'Kiste{i}', (-4.4, -3.6 + i * 1.0, 0.15), M['wood'])
        barrel('Fass', (-3.2, -4.4, 0.15), M['olive'])
        return {'flag': flagpole(-4.8, -1.0, 6.5, M)}
    return build

def kaserne(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['gravel'], bevel=0.08)
    gable_house('Baracke1', -0.8, 3.0, 8.4, 3.4, 3.0, 1.6, M['plaster2'], M['tin_g'], axis='x', z=0.15, win_m=M['glass'], lit_m=M['lit'], n_win=6, seed=21)
    gable_house('Baracke2', -1.4, -1.6, 7.2, 3.2, 3.0, 1.5, M['plaster2'], M['tin_g'], axis='x', z=0.15, win_m=M['glass'], lit_m=M['lit'], n_win=5, seed=22)
    box('Tuer1', (1.0, 0.1, 2.1), (-0.8, 1.25, 1.2), M['wood'])
    box('Tuer2', (1.0, 0.1, 2.1), (-1.4, -3.25, 1.2), M['wood'])
    sandbags('Sand1', 2.8, -5.0, 5.2, -5.0, 3, M['sand'])
    sandbags('Sand2', 5.2, -5.0, 5.2, -2.6, 3, M['sand'])
    for i in range(3): crate(f'Kiste{i}', (4.4 + (i % 2) * 0.95, 1.2 + i * 0.9, 0.15), M['wood'])
    for i in range(3): barrel(f'Fass{i}', (-4.6 + i * 0.7, -4.6, 0.15), M['olive'])
    box('Plane', (2.4, 1.8, 1.2), (3.4, -2.4, 0.75), M['canvas'], bevel=0.25)
    return {'flag': flagpole(4.6, -4.2, 8.0, M)}

def panzerfabrik(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['conc'], bevel=0.08)
    x0, x1, y0, y1, H = -7.6, 3.6, -0.6, 7.6, 7.0
    block('Fabrikhalle', x0, y0, 0.15, x1, y1, H, M['brick'], bevel=0.05)
    n = 5; dy = (y1 - y0) / n
    for i in range(n):
        ya = y0 + i * dy
        p = prism(f'Shed{i}', [(0, H), (dy, H), (dy, H + 2.2), (dy - 0.15, H + 2.2)], x1 - x0 + 0.3, M['tin'], axis='x')
        p.location = ((x0 + x1) / 2, ya, 0)
        box(f'Shedglas{i}', (x1 - x0 - 0.3, 0.06, 1.9), ((x0 + x1) / 2, ya + dy - 0.02, H + 1.1), M['glass'], bevel=0)
    windows_on_box('Fabrik', (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.15, H - 0.6, M['glass'], M['lit'], n=7, seed=31, ww=1.0, wh=2.0, rows=2)
    for i in range(2): box(f'Tor{i}', (3.0, 0.15, 4.4), (-5.0 + i * 4.2, y0 - 0.06, 2.35), M['tin_g'], bevel=0.02)
    box('Tor_seite', (0.15, 3.2, 4.4), (x1 + 0.06, 3.0, 2.35), M['tin_g'], bevel=0.02)
    block('Buero', 3.6, 3.4, 0.15, 7.6, 7.6, 5.0, M['plaster'], bevel=0.04)
    windows_on_box('Buero', 5.6, 5.5, 4.0, 4.2, 0.15, 4.8, M['glass'], M['lit'], n=3, seed=33, rows=2)
    cyl('Schornstein', 0.6, 14.0, (6.6, 6.6, 7.0 + 0.15), M['rust'], verts=24, r2=0.5)
    # Portalkran vor der Halle mit Panzerwanne
    for sx in (-6.6, 1.8):
        for sy in (-6.8, -2.0):
            line_cyl(f'Kranbein{sx}{sy}', (sx, sy, 0.15), (sx, sy, 6.0), 0.18, M['steel'])
        box(f'Kranquer{sx}', (0.4, 5.2, 0.5), (sx, -4.4, 6.1), M['steel'], bevel=0.01)
    box('Kranbruecke', (9.0, 0.6, 0.6), (-2.4, -4.4, 6.6), M['olive'], bevel=0.01)
    box('Laufkatze', (1.0, 1.0, 0.7), (-1.6, -4.4, 6.0), M['olive'])
    line_cyl('Kranseil', (-1.6, -4.4, 5.6), (-1.6, -4.4, 3.0), 0.03, M['steel'], verts=4)
    box('Turmrohling', (1.6, 1.4, 0.7), (-1.6, -4.4, 2.6), M['steel'])
    prism('Wanne', [(-2.8, 0.5), (2.6, 0.5), (3.0, 1.0), (3.0, 1.9), (-2.9, 1.9), (-2.9, 0.9)], 2.4, M['olive'], axis='y').location = (-4.8, -4.4, 0)
    for i in range(4): box(f'Platte{i}', (2.4, 1.6, 0.08), (3.8, -6.0, 0.25 + i * 0.1), M['steel'], rot=(0, 0, 0.05 * i), bevel=0)
    for i in range(3): crate(f'Kiste{i}', (6.6, -6.8 + i * 1.0, 0.15), M['wood'])
    return {'smoke': [(6.6, 6.6, 21.2)], 'flag': flagpole(7.2, 2.6, 8.0, M)}

def verwaltung(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['cobble'], bevel=0.08)
    block('Sockel', -4.8, -1.4, 0.15, 3.4, 5.0, 0.9, M['conc_d'], bevel=0.04)
    block('Bau', -4.6, -1.2, 0.9, 3.2, 4.8, 9.6, M['plaster'], bevel=0.05)
    block('Gesims', -4.8, -1.4, 9.6, 3.4, 5.0, 10.0, M['conc'], bevel=0.04)
    frustum('Walmdach', (8.2, 6.4, 2.8), (-0.7, 1.8, 11.4), M['slate'], top=(0.55, 0.12))
    windows_on_box('Bau', -0.7, 1.8, 7.8, 6.0, 0.9, 8.7, M['glass'], M['lit'], n=6, seed=41, ww=0.8, wh=1.5, rows=3)
    # Säulenportikus auf der Vorderseite (-Y)
    block('Treppe', -2.8, -3.2, 0.15, 1.4, -1.4, 0.6, M['conc'], bevel=0.03)
    for i in range(4): cyl(f'Saeule{i}', 0.3, 6.4, (-2.4 + i * 1.1, -2.6, 3.8), M['white'], verts=20)
    prism('Giebel', [(-3.0, 7.0), (1.6, 7.0), (-0.7, 8.4)], 1.6, M['white'], y=-2.5)
    block('Gebaelk', -3.0, -3.3, 7.0, 1.6, -1.2, 7.3, M['white'], bevel=0.03)
    for i in range(2): tree(f'Baum{i}', 4.4, -3.8 + i * 3.6, 6.0, M)
    block('Rasen', 3.6, -5.2, 0.15, 5.2, 0.6, 0.22, M['grass'], bevel=0.05)
    return {'flag': flagpole(-4.0, -4.6, 9.0, M)}

def forschung(M, S):
    h = S / 2
    block('Platz', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.15, M['conc'], bevel=0.08)
    block('Labor', -5.0, -0.5, 0.15, 2.8, 5.0, 6.0, M['conc'], bevel=0.05)
    windows_on_box('Labor', -1.1, 2.25, 7.8, 5.5, 0.15, 5.8, M['glass'], M['lit'], n=7, seed=51, ww=1.0, wh=1.2, rows=2)
    cyl('Kuppelbau', 2.2, 2.5, (3.0, 3.0, 1.4), M['plaster'], verts=48)
    o = sphere('Kuppel', 2.2, (3.0, 3.0, 2.65), M['copper'], seg=32)
    o.scale = (1, 1, 0.9)
    box('Spalt', (0.5, 2.3, 2.0), (3.0, 3.0, 4.0), M['steel'], rot=(0, math.radians(30), math.radians(-45)), bevel=0)
    # Funkmast mit Parabolantenne
    lattice_tower('Funkmast', -3.6, -3.4, 0.15, 11.0, 0.7, M['steel'])
    d = sphere('Antenne', 1.6, (-3.0, -3.9, 9.5), M['white'], seg=24)
    d.scale = (0.35, 1, 1); d.rotation_euler = (0, math.radians(-25), math.radians(-40))
    line_cyl('Antennenarm', (-3.6, -3.4, 9.5), (-2.8, -4.1, 9.5), 0.08, M['steel'])
    for i in range(3): box(f'Kasten{i}', (1.2, 0.8, 1.0), (1.0 + i * 1.5, -3.8, 0.65), M['olive'])
    return {'flag': flagpole(4.8, -4.8, 7.0, M)}

def flugfeld(M, S):
    h = S / 2
    block('Rasen', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.1, M['grass'], bevel=0.08)
    block('Piste', -h + 0.2, -3.0, 0.1, h - 0.2, 2.0, 0.18, M['conc'], bevel=0.04)
    for i in range(6): box(f'Mittellinie{i}', (1.2, 0.18, 0.02), (-7.0 + i * 2.8, -0.5, 0.19), M['white'], bevel=0)
    # Hangar mit Tonnendach
    o = cyl('Hangar', 3.4, 7.0, (-3.8, 5.6, 0.1), M['tin'], rot=(0, math.radians(90), 0), verts=48)
    o.scale = (1, 1, 1)
    box('Hangarboden', (7.0, 6.8, 0.1), (-3.8, 5.6, 0.1), M['conc'])
    box('Hangartor', (6.6, 0.1, 3.0), (-3.8, 2.2, 1.6), M['glass'], bevel=0)
    # Kontrollturm
    block('Turm', 3.0, 4.0, 0.1, 5.4, 6.6, 6.0, M['plaster'], bevel=0.04)
    block('Kanzel', 2.8, 3.8, 6.0, 5.6, 6.8, 7.4, M['glass'], bevel=0.02)
    block('Kanzeldach', 2.6, 3.6, 7.4, 5.8, 7.0, 7.7, M['conc_d'], bevel=0.03)
    windows_on_box('Turm', 4.2, 5.3, 2.4, 2.6, 0.1, 5.8, M['glass'], M['lit'], n=1, seed=61, rows=2)
    line_cyl('Windsackmast', (6.8, -5.8, 0.1), (6.8, -5.8, 4.0), 0.05, M['steel'])
    o = E.cyl('Windsack', 0.35, 1.6, (7.4, -5.8, 3.9), M['white'], rot=(0, math.radians(80), 0), verts=12, r2=0.15)
    for i in range(6): barrel(f'Fass{i}', (-7.0 + (i % 3) * 0.7, -6.6 + (i // 3) * 0.7, 0.1), M['olive' if i % 3 else 'rust'])
    return {'flag': flagpole(6.8, 3.4, 8.0, M)}

def werft(M, S):
    h = S / 2
    block('Kai', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.6, M['conc_d'], bevel=0.08)
    # Helling mit Schiffsrumpf im Bau
    prism('Rumpf', [(-6.5, 1.0), (4.5, 1.0), (6.8, 2.2), (6.8, 3.8), (-6.8, 3.8), (-6.8, 2.0)], 3.2, M['steel'], axis='y').location = (-0.4, -3.6, 0)
    block('Deck', -7.0, -5.1, 3.8, 6.4, -2.1, 3.95, M['wood'], bevel=0.02)
    box('Aufbau', (2.4, 2.2, 1.8), (-1.6, -3.6, 4.85), M['conc_d'])
    for i in range(7):
        x = -6.4 + i * 2.0
        for sy in (-5.6, -1.6): line_cyl(f'Geruest{i}{sy}', (x, sy, 0.6), (x, sy, 5.4), 0.06, M['wood'], verts=6)
    line_cyl('Geruestlang1', (-6.4, -5.6, 5.4), (5.6, -5.6, 5.4), 0.06, M['wood'], verts=6)
    line_cyl('Geruestlang2', (-6.4, -1.6, 5.4), (5.6, -1.6, 5.4), 0.06, M['wood'], verts=6)
    # Wippkran und Lagerhalle
    lattice_tower('Kran', 3.0, 1.6, 0.6, 11.0, 1.0, M['olive'])
    box('Kranausleger', (10.0, 0.5, 0.5), (0.0, 1.6, 11.8), M['olive'], rot=(0, math.radians(-12), 0), bevel=0.01)
    block('Lager', -7.6, 2.4, 0.6, 1.4, 7.6, 5.2, M['brick'], bevel=0.04)
    prism('Lagerdach', [(2.2, 5.2), (7.8, 5.2), (5.0, 6.6)], 9.4, M['tin'], axis='x').location = (-3.1, 0, 0)
    windows_on_box('Lager', -3.1, 5.0, 9.0, 5.2, 0.6, 4.6, M['glass'], M['lit'], n=5, seed=71)
    for i in range(4): crate(f'Kiste{i}', (5.6 + (i % 2), 4.6 + (i // 2) * 1.1, 0.6), M['wood'])
    for i in range(5): cyl(f'Poller{i}', 0.18, 0.6, (-7.4 + i * 3.6, -7.9, 0.9), M['steel'], verts=12)
    return {'flag': flagpole(7.2, -0.8, 9.0, M)}

def dorf(M, S):
    h = S / 2
    rnd = random.Random(5)
    block('Wiese', -h + 0.3, -h + 0.3, 0, h - 0.3, h - 0.3, 0.06, M['grass'], bevel=0.1)
    block('Platz', -3.0, -3.0, 0.06, 3.4, 3.4, 0.12, M['cobble'], bevel=0.08)
    block('Gasse1', -h + 0.4, -0.8, 0.06, h - 0.4, 0.8, 0.11, M['cobble'], bevel=0.05)
    block('Gasse2', -0.6, -h + 0.4, 0.06, 0.6, h - 0.4, 0.11, M['cobble'], bevel=0.05)
    # Kirche hinten (Schiff entlang x, Turm vorne)
    gable_house('Kirche', -3.6, 5.2, 7.0, 3.8, 5.6, 3.0, M['plaster'], M['roof2'], axis='x', z=0.06)
    for i in range(3): box(f'Kirchenfenster{i}', (0.5, 0.08, 2.0), (-6.0 + i * 1.8, 3.27, 3.2), M['lit' if i == 1 else 'glass'], bevel=0.01)
    block('Turm', -0.6, 3.8, 0.06, 2.2, 6.6, 11.0, M['plaster'], bevel=0.05)
    for side in range(2):
        box(f'Schallfenster{side}', (0.7, 0.08, 1.2) if side == 0 else (0.08, 0.7, 1.2),
            (0.8, 3.76, 9.6) if side == 0 else (2.24, 5.2, 9.6), M['glass'], bevel=0.01)
    frustum('Turmhelm', (3.0, 3.0, 6.0), (0.8, 5.2, 14.0), M['copper'], top=(0.02, 0.02))
    line_cyl('Kreuz1', (0.8, 5.2, 17.0), (0.8, 5.2, 18.2), 0.05, M['gold'], verts=6)
    line_cyl('Kreuz2', (0.45, 5.2, 17.8), (1.15, 5.2, 17.8), 0.05, M['gold'], verts=6)
    box('Uhr', (0.9, 0.06, 0.9), (0.8, 3.77, 8.0), M['white'], bevel=0.01)
    # Häuser rund um den Platz
    houses = [(-5.6, -1.2, 4.6, 3.2, 'y'), (-5.2, -5.8, 4.4, 3.4, 'x'), (-0.6, -5.8, 3.4, 3.2, 'x'), (5.0, -5.6, 3.6, 3.4, 'y'),
              (5.4, -0.6, 4.4, 3.4, 'y'), (5.6, 4.6, 3.6, 3.6, 'x'), (-6.2, 2.0, 2.6, 2.6, 'x')]
    chimneys = []
    for i, (cx, cy, l, w, ax) in enumerate(houses):
        roof = M['roof'] if i % 3 else M['roof2']
        hh = rnd.uniform(3.4, 4.4)
        gable_house(f'Haus{i}', cx, cy, l, w, hh, rnd.uniform(2.0, 2.6), M['plaster' if i % 2 else 'plaster2'], roof, axis=ax, z=0.06,
                    win_m=M['glass'], lit_m=M['lit'], n_win=2 if l < 4 else 3, seed=80 + i)
        # Schornstein auf der hinteren Dachhälfte
        kx, ky = (cx - l * 0.25, cy + 0.6) if ax == 'x' else (cx - 0.6, cy + l * 0.25)
        top = hh + 3.2
        block(f'Schornstein{i}', kx - 0.25, ky - 0.25, hh, kx + 0.25, ky + 0.25, top, M['brick2'], bevel=0.02)
        chimneys.append((kx, ky, top + 0.1))
    # Brunnen, Bäume, Gärten, Zäune
    cyl('Brunnen', 0.9, 0.7, (1.5, 1.0, 0.45), M['conc_d'], verts=32, bevel=0.04)
    cyl('Wasser', 0.75, 0.05, (1.5, 1.0, 0.76), M['glass'], verts=32)
    tree('Linde', -1.8, 0.8, 7.0, M)
    tree('Baum2', 7.4, 7.4, 6.0, M)
    tree('Baum3', -7.4, -7.6, 5.5, M, kind='nadel')
    block('Garten', 1.8, -8.0, 0.06, 7.8, -7.2, 0.2, M['garden'], bevel=0.05)
    fence_line('Zaun', (1.6, -8.2), (8.0, -8.2), M['wood'], h=1.0)
    for i in range(3): barrel(f'Fass{i}', (2.6 + i * 0.7, 2.4, 0.12), M['wood'])
    box('Karren', (2.0, 1.2, 0.5), (-2.4, -2.4, 0.8), M['wood'], bevel=0.04)
    for k in (-1, 1): cyl(f'Rad{k}', 0.55, 0.1, (-2.4, -2.4 + k * 0.7, 0.6), M['wood'], rot=RX, verts=16)
    return {'smoke': chimneys[:4]}

def flak(angle_frames=8):
    def build(M, S, frame):
        a = -frame * 2 * math.pi / angle_frames
        sandbags('Ring', 0, 0, 0, 0, 0, M['sand'])
        for k in range(16):
            t0, t1 = k * 2 * math.pi / 16, (k + 1) * 2 * math.pi / 16
            if k in (11,): continue  # Durchgang
            sandbags(f'Wall{k}', 2.1 * math.cos(t0), 2.1 * math.sin(t0), 2.1 * math.cos(t1), 2.1 * math.sin(t1), 3, M['sand'])
        cyl('Boden', 2.0, 0.12, (0, 0, 0.06), M['gravel'], verts=40)
        cyl('Sockel', 0.5, 0.6, (0, 0, 0.4), M['olive'], verts=24, bevel=0.03)
        g = E.empty('Geschuetz'); E.set_parent(g)
        cyl('Drehkranz', 0.9, 0.18, (0, 0, 0.8), M['olive'], verts=32, bevel=0.03)
        box('Schild', (0.1, 1.6, 0.9), (0.5, 0, 1.4), M['olive'], bevel=0.02)
        box('Wiege', (1.2, 0.5, 0.4), (0.0, 0, 1.3), M['olive'], bevel=0.03)
        for dy in (-0.2, 0.2):
            o = line_cyl(f'Rohr{dy}', (0.2, dy, 1.4), (2.3, dy, 2.6), 0.06, M['steel'], verts=12)
        box('Sitz', (0.3, 0.3, 0.1), (-0.5, 0.45, 1.0), M['steel'])
        E.set_parent(E.REF)
        g.rotation_euler = (0, 0, a)
        for i in range(3): crate(f'Munition{i}', (-1.1 + i * 0.6, -1.3, 0.12), M['olive'], s=0.45)
        return {}
    return build

def bunker(angle_frames=8):
    def build(M, S, frame):
        a = -frame * 2 * math.pi / angle_frames
        frustum('Bunker', (4.4, 4.4, 1.8), (0, 0, 0.9), M['conc'], top=(0.82, 0.82), bevel=0.15)
        block('Erdwall', -2.6, -2.6, 0, 2.6, 2.6, 0.5, M['garden'], bevel=0.4)
        g = E.empty('Turm'); E.set_parent(g)
        cyl('Drehturm', 1.2, 0.7, (0, 0, 2.15), M['olive'], verts=32, bevel=0.06, r2=1.0)
        sphere('Kuppel', 1.0, (0, 0, 2.5), M['olive'], scale=(1, 1, 0.45), seg=24)
        box('Blende', (0.5, 0.8, 0.6), (1.1, 0, 2.2), M['olive'], bevel=0.05)
        line_cyl('Kanone', (1.2, 0, 2.2), (3.4, 0, 2.3), 0.09, M['steel'], verts=16)
        cyl('Muendung', 0.13, 0.25, (3.4, 0, 2.3), M['steel'], rot=RY, verts=16)
        E.set_parent(E.REF)
        g.rotation_euler = (0, 0, a)
        return {}
    return build

# Name, Größe in Kacheln, Zusatzhöhe (logische px), Funktion, Richtungen
BUILDINGS = {
    'bauhof': (3, 150, bauhof, 1), 'kraftwerk': (2, 170, kraftwerk, 1), 'kohlebergwerk': (2, 120, mine('kohle'), 1),
    'eisenbergwerk': (2, 120, mine('eisen'), 1), 'goldmine': (2, 120, mine('gold'), 1), 'kaserne': (2, 90, kaserne, 1),
    'panzerfabrik': (3, 160, panzerfabrik, 1), 'verwaltung': (2, 120, verwaltung, 1), 'forschungszentrum': (2, 110, forschung, 1),
    'flugfeld': (3, 90, flugfeld, 1), 'werft': (3, 110, werft, 1), 'dorf': (3, 150, dorf, 1),
    'flakstellung': (1, 50, flak(), 8), 'geschuetzturm': (1, 45, bunker(), 8),
}

def screen_offset(p, anchor_world):
    d = Vector(p) - Vector(anchor_world)
    return [round(d.dot(E.RIGHT) * E.PXM / 2, 1), round(-d.dot(E.UP) * E.PXM / 2, 1)]

meta_all = {}
for name, (size, top, fn, frames) in BUILDINGS.items():
    if ONLY and name not in ONLY: continue
    Sm = size * E.TILE_M
    m = max(16 * size, int(top * 0.85))            # Rand für Schatten (Sonne von links oben, 40° hoch)
    mb = max(16 * size, int(top * 0.45))
    W, H = size * 64 + 2 * m, top + size * 32 + mb  # logische Bildgröße
    ax, ay = m + size * 32, top + size * 32
    corner = (Sm / 2, -Sm / 2, 0)                   # untere Spitze der Grundfläche
    paths = []
    info = {}
    for f in range(frames):
        E.reset(name)
        M = materials()
        info = (fn(M, Sm, f) if frames > 1 else fn(M, Sm)) or {}
        E.shadow_catcher()
        E.frame_camera(W * 2, H * 2, corner, ax * 2, ay * 2)
        p = os.path.join(OUT, f'{name}_{f}.png'); paths.append(p)
        E.shoot(p, SAMPLES)
    meta = {'frames': frames, 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0, 'w': W, 'h': H}
    if 'flag' in info: meta['flag'] = screen_offset(info['flag'], corner)
    if 'smoke' in info:
        # Rauchquellen in Kachelkoordinaten relativ zur oberen Ecke der Grundfläche; Höhe in Einheiten von 32 px
        meta['smoke'] = [[round((x + Sm / 2) / E.TILE_M, 3), round((-y + Sm / 2) / E.TILE_M, 3), round(z * 0.866 * E.PXM / 2 / 32, 3)] for x, y, z in info['smoke']]
    meta_all[name] = meta
    print('fertig', name, meta)
json.dump(meta_all, open(os.path.join(OUT, f'meta_{"_".join(ONLY) or "alle"}.json'), 'w'), indent=1)
