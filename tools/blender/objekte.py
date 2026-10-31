# Geländeobjekte für Eisenfront: Bäume, Felsen und Rohstoffvorkommen (Kachelauflage).
# Aufruf: python objekte.py <ausgabeordner> [name ...]
import bpy, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(__file__))
import eflib as E
from eflib import cyl, sphere, line_cyl, box
from mathutils import Vector

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 48))

def leaf_mat(name, c1, c2, scale=9.0):
    m, nt, b = E.mat(name)
    obj = E.coords(nt)
    vo = E.node(nt, 'ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = scale; E.L(nt, obj, vo.inputs['Vector'])
    col = E.ramp(nt, vo.outputs['Color'], [(0.0, c1), (1.0, c2)])
    col = E.mix(nt, E.mop(nt, 'MULTIPLY', E.maprange(nt, vo.outputs['Distance'], 0.2, 0.5), 0.6), col, (0.01, 0.02, 0.005))
    col = E.mix(nt, 0.4, col, E.noise_tex(nt, obj, 30, 8).outputs['Color'], 'OVERLAY')
    E.L(nt, col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.7
    b.inputs['Subsurface Weight'].default_value = 0.0
    bp = E.node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.9; bp.inputs['Distance'].default_value = 0.15
    E.L(nt, vo.outputs['Distance'], bp.inputs['Height']); E.L(nt, bp.outputs['Normal'], b.inputs['Normal'])
    return m

def bark_mat(name, color=(0.12, 0.08, 0.05), birch=False):
    m, nt, b = E.mat(name)
    obj = E.coords(nt)
    if birch:
        mp = E.node(nt, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (6, 6, 1.2); E.L(nt, obj, mp.inputs['Vector'])
        marks = E.maprange(nt, E.noise_tex(nt, mp.outputs['Vector'], 4, 4).outputs['Fac'], 0.6, 0.66)
        col = E.mix(nt, marks, (0.62, 0.6, 0.55), (0.04, 0.04, 0.04))
    else:
        mp = E.node(nt, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (8, 8, 1.5); E.L(nt, obj, mp.inputs['Vector'])
        col = E.ramp(nt, E.noise_tex(nt, mp.outputs['Vector'], 6, 8).outputs['Fac'], [(0.3, tuple(c * 0.6 for c in color)), (0.7, color)])
    E.L(nt, col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.9
    return m

def displace(o, scale, strength, name):
    sub = o.modifiers.new('s', 'SUBSURF'); sub.levels = sub.render_levels = 2
    d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(name, 'CLOUDS'); t.noise_scale = scale; t.noise_depth = 3
    d.texture = t; d.strength = strength
    return o

def spruce(h, slim, c1, c2, seed):
    rnd = random.Random(seed)
    leaf = leaf_mat('Nadeln', c1, c2, 7)
    cyl('Stamm', 0.22, h * 0.35, (0, 0, h * 0.17), bark_mat('Rinde'), verts=10)
    n = 13
    for k in range(n):
        t = k / n
        r = (3.3 * (1 - t) ** 0.9 + 0.3) * slim
        z = h * (0.1 + t * 0.8)
        o = E.cyl(f'Ast{k}', r, h * 0.2, (rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), z), leaf, verts=14, r2=r * 0.25)
        o.rotation_euler = (rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), rnd.uniform(0, 6.28))
        displace(o, 0.35, 0.5 * slim, f'n{k}')
    E.cyl('Spitze', 0.35, h * 0.12, (0, 0, h * 0.97), leaf, verts=8, r2=0.02)

def broadleaf(h, c1, c2, seed, birch=False):
    rnd = random.Random(seed)
    leaf = leaf_mat('Laub', c1, c2, 6 if not birch else 9)
    bark = bark_mat('Rinde', birch=birch)
    line_cyl('Stamm', (0, 0, 0), (0.2, -0.1, h * 0.55), 0.28 if not birch else 0.18, bark, verts=10)
    for k in range(4):
        a = k * math.pi / 2 + rnd.uniform(-0.3, 0.3)
        line_cyl(f'Ast{k}', (0.1, 0, h * 0.4), (math.cos(a) * 1.8, math.sin(a) * 1.8, h * 0.68), 0.1, bark, verts=6)
    blobs = 11 if not birch else 9
    for k in range(blobs):
        a = rnd.uniform(0, 6.28); rr = rnd.uniform(0.4, 2.8) * (0.75 if birch else 1)
        z = h * rnd.uniform(0.42, 0.85)
        o = sphere(f'Krone{k}', rnd.uniform(1.3, 2.1) * (0.8 if birch else 1), (math.cos(a) * rr, math.sin(a) * rr, z), leaf, seg=14)
        o.scale = (1, 1, rnd.uniform(0.75, 0.95))
        displace(o, 0.5, 0.7, f'k{k}')

def rock(seed, n):
    rnd = random.Random(seed)
    m, nt, b = E.mat('Gestein')
    obj = E.coords(nt)
    col = E.ramp(nt, E.noise_tex(nt, obj, 1.2, 8).outputs['Fac'], [(0.3, (0.035, 0.033, 0.03)), (0.7, (0.085, 0.08, 0.072))])
    lich = E.maprange(nt, E.noise_tex(nt, obj, 3.5, 6).outputs['Fac'], 0.6, 0.68)
    col = E.mix(nt, E.mop(nt, 'MULTIPLY', lich, 0.7), col, (0.35, 0.37, 0.2))
    E.weathering(nt, col, 0.85, chips=False, mud_h=0.4, dust_amt=0.05, streaks=0.5, bump=0.4)
    for k in range(n):
        r = rnd.uniform(0.7, 1.6) * (1.3 if k == 0 else 1)
        a = rnd.uniform(0, 6.28); d = 0 if k == 0 else rnd.uniform(1.0, 2.2)
        o = sphere(f'Fels{k}', r, (math.cos(a) * d, math.sin(a) * d, r * 0.35), m, seg=16)
        o.scale = (rnd.uniform(0.9, 1.4), rnd.uniform(0.8, 1.2), rnd.uniform(0.6, 0.9)); o.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
        sub = o.modifiers.new('s', 'SUBSURF'); sub.levels = sub.render_levels = 2
        d1 = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(f'r{k}', 'VORONOI'); t.noise_scale = 0.8; d1.texture = t; d1.strength = 0.5
        d2 = o.modifiers.new('d2', 'DISPLACE'); t2 = bpy.data.textures.new(f'r2{k}', 'CLOUDS'); t2.noise_scale = 0.3; d2.texture = t2; d2.strength = 0.15
    # Gras und kleine Steine drumherum
    g = E.painted('Bewuchs', (0.08, 0.12, 0.035), 0.9, chips=False, mud_h=0, streaks=0)
    for k in range(6):
        a = rnd.uniform(0, 6.28); d = rnd.uniform(1.6, 2.8)
        o = sphere(f'Busch{k}', rnd.uniform(0.35, 0.6), (math.cos(a) * d, math.sin(a) * d, 0.1), g, scale=(1, 1, 0.5), seg=10)
        displace(o, 0.2, 0.15, f'b{k}')

def deposit(kind, seed):
    rnd = random.Random(seed)
    c = {'kohle': ((0.02, 0.02, 0.02), 0.35, 0.2), 'eisen': ((0.26, 0.10, 0.045), 0.8, 0.0), 'gold': ((0.6, 0.45, 0.1), 0.3, 0.6)}[kind]
    m, nt, b = E.mat(kind)
    obj = E.coords(nt)
    col = E.ramp(nt, E.noise_tex(nt, obj, 3, 8).outputs['Fac'], [(0.3, tuple(x * 0.6 for x in c[0])), (0.7, c[0])])
    if kind == 'gold':
        vein = E.maprange(nt, E.noise_tex(nt, obj, 6, 8).outputs['Fac'], 0.55, 0.62)
        col = E.mix(nt, vein, (0.16, 0.14, 0.11), col)
        b.inputs['Metallic'].default_value = 0.0
        E.L(nt, vein, b.inputs['Metallic'])
    E.L(nt, col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = c[1]
    host = E.painted('Geroell', (0.12, 0.11, 0.095), 0.9, chips=False, mud_h=0, streaks=0, dust_amt=0.1)
    half = E.TILE_M / 2
    for k in range(34):
        # gleichmäßig in der Raute verteilt (Kachel = Quadrat in Weltkoordinaten), Rand frei lassen
        x, y = rnd.uniform(-half * 0.72, half * 0.72), rnd.uniform(-half * 0.72, half * 0.72)
        r = rnd.uniform(0.18, 0.42)
        o = sphere(f'Brocken{k}', r, (x, y, r * 0.25), m if rnd.random() < 0.75 else host, seg=10)
        o.scale = (rnd.uniform(0.8, 1.5), rnd.uniform(0.8, 1.3), rnd.uniform(0.45, 0.8)); o.rotation_euler = (0, 0, rnd.uniform(0, 6.28))
        d = o.modifiers.new('d', 'DISPLACE'); t = bpy.data.textures.new(f'd{k}', 'VORONOI'); t.noise_scale = 0.25; d.texture = t; d.strength = 0.12

TREES = {
    'baum1': lambda: spruce(13.0, 1.0, (0.04, 0.09, 0.03), (0.09, 0.16, 0.05), 1),
    'baum3': lambda: spruce(15.0, 0.72, (0.02, 0.05, 0.025), (0.05, 0.1, 0.04), 3),
    'baum2': lambda: broadleaf(11.0, (0.07, 0.12, 0.025), (0.2, 0.26, 0.06), 2),
    'baum4': lambda: broadleaf(12.0, (0.13, 0.19, 0.04), (0.3, 0.34, 0.09), 4, birch=True),
}
meta = {}
jobs = [(k, 'tree') for k in TREES] + [('fels', 'rock'), ('fels2', 'rock')] + [(f'vorkommen_{k}', 'dep') for k in ('kohle', 'eisen', 'gold')]
for name, kind in jobs:
    if ONLY and name not in ONLY: continue
    E.reset(name)
    E.shadow_catcher()
    if kind == 'tree':
        TREES[name]()
        W, H, ax, ay = 160, 175, 46, 118
        E.frame_camera(W * 2, H * 2, (0, 0, 0), ax * 2, ay * 2)
    elif kind == 'rock':
        rock(7 if name == 'fels' else 13, 4 if name == 'fels' else 5)
        W, H, ax, ay = 96, 72, 40, 54
        E.frame_camera(W * 2, H * 2, (0, 0, 0), ax * 2, ay * 2)
    else:
        deposit(name.split('_')[1], len(name))
        # Bild = genau die Kachelraute (wird vom Bodenmaler als Kachel gezeichnet)
        W, H, ax, ay = 64, 32, 32, 32
        E.frame_camera(W * 2, H * 2, (E.TILE_M / 2, -E.TILE_M / 2, 0), ax * 2, ay * 2)
    if kind == 'tree':
        # Baum ohne Schatten (wird im Spiel einzeln gezeichnet) und Schatten allein (wird in den Boden eingebacken)
        catcher = [o for o in E.S.objects if o.is_shadow_catcher][0]
        catcher.hide_render = True
        E.shoot(os.path.join(OUT, f'{name}.png'), SAMPLES)
        catcher.hide_render = False
        for o in E.REF.children_recursive: o.visible_camera = False
        E.shoot(os.path.join(OUT, f'{name}_schatten.png'), 16)
        meta[name + '_schatten'] = {'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0}
    else:
        E.shoot(os.path.join(OUT, f'{name}.png'), SAMPLES)
    meta[name] = {'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0}
    print('fertig', name)
json.dump(meta, open(os.path.join(OUT, 'meta_objekte.json'), 'w'), indent=1)
