# Einheiten für Eisenfront: Modelle und Spritesheets (16 bzw. 8 Richtungen, Turm getrennt, Infanterie mit Laufbildern).
# Aufruf: python einheiten.py <ausgabeordner> [name ...]
import bpy, bmesh, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(__file__))
import eflib as E
from eflib import block, box, cyl, line_cyl, prism, sphere, frustum, RX, RY
from mathutils import Vector

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 40))

def plan_prism(name, pts_xy, z0, z1, m, bevel=0.03, top_scale=1.0):
    """Grundriss (x, y) senkrecht von z0 bis z1 extrudiert (Schiffsrümpfe, Decks)."""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    cx = sum(p[0] for p in pts_xy) / len(pts_xy); cy = sum(p[1] for p in pts_xy) / len(pts_xy)
    a = [bm.verts.new((x, y, z0)) for x, y in pts_xy]
    b = [bm.verts.new((cx + (x - cx) * top_scale, cy + (y - cy) * top_scale, z1)) for x, y in pts_xy]
    n = len(a)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    return E.finish(bpy.data.objects.new(name, me), m, bevel)

def track_run(name, s, y, pts, m, width=0.42, link=0.13):
    cd = bpy.data.curves.new(name, 'CURVE'); cd.dimensions = '3D'
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = True
    for bp, p in zip(sp.bezier_points, pts): bp.co = (p[0], 0, p[1]); bp.handle_left_type = bp.handle_right_type = 'AUTO'
    co = bpy.data.objects.new(name, cd); co.location = (0, y, 0); E.S.collection.objects.link(co); co.parent = E.PARENT
    me = bpy.data.meshes.new(name + 'g'); bm = bmesh.new()
    def cube(sx, sy, sz, ox=0, oz=0):
        r = bmesh.ops.create_cube(bm, size=1)
        for v in r['verts']: v.co.x = v.co.x * sx + ox; v.co.y *= sy; v.co.z = v.co.z * sz + oz
    cube(link * 0.92, width, 0.03); cube(0.03, width * 0.95, 0.025, 0.02, 0.025); cube(0.03, width * 0.95, 0.025, 0.02, -0.025)
    bm.to_mesh(me); bm.free()
    g = bpy.data.objects.new(name + 'k', me); g.location = (0, y, 0); E.S.collection.objects.link(g); g.parent = E.PARENT
    g.data.materials.append(m)
    arr = g.modifiers.new('arr', 'ARRAY'); arr.fit_type = 'FIT_CURVE'; arr.curve = co; arr.relative_offset_displace = (1.08, 0, 0)
    cm = g.modifiers.new('curve', 'CURVE'); cm.object = co; cm.deform_axis = 'POS_X'

def wheel(name, x, y, z, r, w, rubber, paint, steel, side):
    cyl(f'{name}_r', r, w, (x, y, z), rubber, rot=RX, verts=36, bevel=min(0.03, r * 0.1))
    cyl(f'{name}_s', r * 0.8, w + 0.02, (x, y, z), paint, rot=RX, verts=36, bevel=0.01)
    cyl(f'{name}_n', r * 0.3, w + 0.06, (x, y, z), steel, rot=RX, verts=16)

WEAR = dict(wear=0.85, rust=0.55, fade=0.3, scratch=0.6, oil=0.45, mud_h=2.3, mud_col=(0.11, 0.085, 0.055), grime=0.55, dust_amt=0.75)   # starke Abnutzung (1940, im Feld)

# Fahrzeuge in dunklem Panzergrau (RAL 7021): wenig Staub, kaum Ausbleichen
WEAR_V = dict(WEAR, dust_amt=0.16, fade=0.1, mud_h=1.9)

def mats():
    M = {}
    M['camo'] = E.camo('Tarn', base=(0.27, 0.21, 0.105), green=(0.10, 0.12, 0.055), brown=(0.16, 0.085, 0.045), **WEAR)
    M['zimm'] = E.camo('Zimmerit', base=(0.27, 0.21, 0.105), green=(0.10, 0.12, 0.055), brown=(0.16, 0.085, 0.045), zimmerit=True, **WEAR)
    M['grey'] = E.camo('Panzergrau', base=(0.03, 0.034, 0.037), green=(0.026, 0.03, 0.033), brown=(0.036, 0.036, 0.036), scale=0.5, **WEAR_V)
    M['steel'] = E.painted('Stahl', (0.06, 0.055, 0.05), 0.5, mud_h=1.0, metal_edge=(0.3, 0.29, 0.28), wear=0.6, rust=0.7)
    M['track'] = E.painted('Kette', (0.09, 0.07, 0.055), 0.7, mud_h=1.3, metal_edge=(0.34, 0.33, 0.31), rust=0.9, wear=0.4)
    M['rubber'] = E.painted('Gummi', (0.03, 0.028, 0.025), 0.85, chips=False, mud_h=1.4, mud_col=(0.09, 0.07, 0.045), dust_amt=0.25)
    M['glass'] = E.plain('Glas', (0.03, 0.04, 0.045), 0.08, 0.2)
    M['wood'] = E.oldwood('Holz', color=(0.2, 0.15, 0.1), grey=0.4)
    M['jerry'] = E.painted('Kanister', (0.13, 0.15, 0.08), 0.6, mud_h=0, wear=0.9, rust=0.4, scratch=0.6)
    M['tarp'] = E.painted('Plane', (0.17, 0.16, 0.10), 0.95, chips=False, mud_h=1.6, streaks=0.5, dust_amt=0.6)
    M['feldgrau'] = E.painted('Feldgrau', (0.12, 0.135, 0.085), 0.9, chips=False, mud_h=0.45, streaks=0.2, dust_amt=0.45, fade=0.5)
    M['coat'] = E.painted('Mantel', (0.17, 0.11, 0.06), 0.92, chips=False, mud_h=0.45, streaks=0.2, dust_amt=0.4, fade=0.5)
    M['cap'] = E.painted('Muetze', (0.09, 0.09, 0.08), 0.9, chips=False, mud_h=0, streaks=0, fade=0.4)
    M['skin'] = E.plain('Haut', (0.5, 0.33, 0.24), 0.6)
    M['leather'] = E.painted('Leder', (0.045, 0.03, 0.02), 0.55, chips=False, mud_h=0.35, streaks=0, scratch=0.5)
    M['helmet'] = E.painted('Helm', (0.11, 0.125, 0.10), 0.65, mud_h=0, streaks=0, wear=0.7, fade=0.4)
    M['white'] = E.plain('Weiß', (0.62, 0.6, 0.55), 0.6)
    M['black'] = E.plain('Schwarz', (0.02, 0.02, 0.02), 0.5)
    M['navy'] = E.painted('Marinegrau', (0.26, 0.28, 0.30), 0.6, mud_h=0, streaks=0.9, wear=0.6, rust=0.9, fade=0.3)
    M['navy_d'] = E.painted('Marinegrau dunkel', (0.12, 0.13, 0.14), 0.6, mud_h=0, streaks=0.6, wear=0.6, rust=0.7)
    M['deck'] = E.oldwood('Deck', color=(0.27, 0.22, 0.15), grey=0.5)
    M['hullred'] = E.painted('Unterwasser', (0.22, 0.06, 0.04), 0.7, chips=False, mud_h=0, rust=0.5)
    M['air'] = E.camo('Splittertarn', base=(0.10, 0.12, 0.08), green=(0.06, 0.08, 0.05), brown=(0.08, 0.10, 0.065), scale=0.9, mud_h=0.4, dust_amt=0.2, wear=0.6, fade=0.5, oil=0.6, scratch=0.5)
    M['yellow'] = E.painted('Gelb', (0.62, 0.45, 0.06), 0.6, mud_h=0, wear=0.7, oil=0.5)
    M['fabric'] = E.painted('Bespannung', (0.24, 0.25, 0.2), 0.85, chips=False, mud_h=0, streaks=0.4, fade=0.5)
    # 1940: Fahrzeuge in Panzergrau – Dreifarbentarnung und Zimmerit gab es erst ab 1943
    M['camo'] = M['zimm'] = M['grey']
    return M

def stowage(M, rnd, items):
    """Gepäck und Ausrüstung auf Fahrzeugen: [('plane'|'kiste'|'kanister'|'balken'|'rad'|'glieder', x, y, z, rot)]"""
    for k, (kind, x, y, z, r) in enumerate(items):
        if kind == 'plane':
            o = cyl(f'Plane{k}', 0.22, 1.4, (x, y, z + 0.2), M['tarp'], rot=(math.radians(90), 0, r), verts=14)
            E.wobble(o, 0.04, 0.2, levels=1)
            for t in (-0.45, 0.45): cyl(f'Gurt{k}{t}', 0.235, 0.04, (x + math.cos(r + 1.57) * 0 + t * math.cos(r), y + t * math.sin(r), z + 0.2), M['leather'], rot=(math.radians(90), 0, r), verts=14)
        elif kind == 'kiste':
            box(f'Kiste{k}', (0.6, 0.4, 0.35), (x, y, z + 0.18), M['wood'], rot=(0, 0, r), bevel=0.03)
        elif kind == 'kanister':
            box(f'Kanister{k}', (0.17, 0.36, 0.47), (x, y, z + 0.24), M['jerry'], rot=(0, 0, r), bevel=0.02)
        elif kind == 'balken':
            o = cyl(f'Balken{k}', 0.13, 3.4, (x, y, z + 0.13), M['wood'], rot=(0, math.radians(90), r), verts=10)
        elif kind == 'rad':
            cyl(f'Ersatzrad{k}', 0.38, 0.1, (x, y, z), M['camo'], rot=(math.radians(90), 0, r), verts=24, bevel=0.01)
        elif kind == 'glieder':
            for j in range(4): box(f'Glied{k}{j}', (0.14, 0.4, 0.04), (x + j * 0.16 * math.cos(r), y + j * 0.16 * math.sin(r), z), M['track'], rot=(0, 0, r), bevel=0.005)

def dents(names, s=0.015):
    for o in list(E.S.objects):
        if any(o.name.startswith(n) for n in names) and o.type == 'MESH':
            E.wobble(o, s, 0.35, levels=1)

# ======================= Fahrzeuge =======================
def tiger(M, T):
    # Wanne
    prism('Unterwanne', [(-3.0, 0.55), (2.6, 0.55), (3.05, 1.0), (3.05, 1.35), (-3.05, 1.35), (-3.05, 0.9)], 1.85, M['zimm'])
    block('Aufbau', -3.05, -1.72, 1.35, 2.75, 1.72, 2.0, M['zimm'], bevel=0.03)
    prism('Bug', [(2.75, 1.35), (3.15, 1.35), (3.15, 1.45), (2.75, 2.0)], 3.3, M['zimm'])
    block('Motordeck', -3.0, -1.3, 2.0, -1.0, 1.3, 2.08, M['camo'], bevel=0.02)
    for i in range(2): block(f'Gitter{i}', -2.8, -1.1 + i * 1.5, 2.08, -1.4, -0.4 + i * 1.5, 2.12, M['steel'], bevel=0.01)
    box('Fahrersicht', (0.06, 0.4, 0.14), (2.78, 0.6, 1.8), M['steel'])
    cyl('BugMG', 0.13, 0.12, (2.8, -0.65, 1.78), M['zimm'], rot=RY, bevel=0.02)
    for s in (-1, 1):
        box(f'Kotfluegel{s}', (6.2, 0.4, 0.04), (0.0, s * 1.55, 2.0), M['camo'], bevel=0.005)
        cyl(f'Seil{s}', 0.035, 4.0, (-0.6, s * 1.75, 1.65), M['steel'], rot=RY, verts=8)
        cyl(f'Auspuff{s}', 0.12, 0.6, (-3.2, s * 0.55, 1.9), M['steel'], verts=16, bevel=0.02)
    # Laufwerk: Schachtellaufwerk mit großen Rollen
    for s in (-1, 1):
        y = s * 1.4
        for i in range(8):
            x = -2.25 + i * 0.64
            for k, dy in enumerate((-0.18, 0.0, 0.18) if i % 2 else (-0.09, 0.09)):
                cyl(f'Rolle{s}{i}{k}', 0.4, 0.07, (x, y + dy, 0.62), M['zimm'] if k == 0 else M['camo'], rot=RX, verts=32, bevel=0.012)
            cyl(f'Nabe{s}{i}', 0.08, 0.5, (x, y, 0.62), M['steel'], rot=RX, verts=12)
        cyl(f'Treibrad{s}', 0.42, 0.3, (2.75, y, 1.0), M['camo'], rot=RX, verts=32, bevel=0.02)
        for k in range(18):
            a = k * math.pi / 9
            box(f'Zahn{s}{k}', (0.08, 0.26, 0.07), (2.75 + math.cos(a) * 0.45, y, 1.0 + math.sin(a) * 0.45), M['steel'], rot=(0, -a, 0), bevel=0.01)
        cyl(f'Leitrad{s}', 0.36, 0.25, (-2.85, y, 0.85), M['camo'], rot=RX, verts=32, bevel=0.02)
        track_run(f'Kette{s}', s, y, [(2.75, 1.47), (3.22, 1.0), (2.75, 0.55), (2.3, 0.21), (-2.3, 0.21), (-2.85, 0.45), (-3.25, 0.85), (-2.85, 1.25), (0.0, 1.3), (2.0, 1.32)], M['track'], width=0.72, link=0.15)

TX = 0.0
def tiger_turret(M, T):
    o = cyl('Turm', 1.15, 0.85, (TX - 0.1, 0, 2.45), M['zimm'], verts=40, bevel=0.04)
    o.scale = (1.3, 1.0, 1.0)
    box('Turmdach', (2.7, 1.9, 0.06), (TX - 0.1, 0, 2.9), M['camo'], bevel=0.02)
    box('Blende', (0.35, 1.5, 0.75), (TX + 1.45, 0, 2.45), M['zimm'], bevel=0.06)
    cyl('Rohrwiege', 0.16, 0.6, (TX + 1.8, 0, 2.5), M['camo'], rot=RY, bevel=0.02)
    cyl('Rohr', 0.085, 4.6, (TX + 4.0, 0, 2.5), M['camo'], rot=RY, verts=24, r2=0.075)
    cyl('Muendungsbremse', 0.15, 0.45, (TX + 6.4, 0, 2.5), M['camo'], rot=RY, verts=24, bevel=0.015)
    cyl('Kuppel', 0.38, 0.3, (TX - 0.8, 0.55, 3.0), M['camo'], verts=32, bevel=0.02)
    for k in range(6):
        a = math.radians(k * 60)
        box(f'Spiegel{k}', (0.05, 0.12, 0.08), (TX - 0.8 + math.cos(a) * 0.38, 0.55 + math.sin(a) * 0.38, 3.03), M['glass'], rot=(0, 0, a), bevel=0)
    box('Ladeluke', (0.5, 0.5, 0.05), (TX - 0.2, -0.5, 2.95), M['camo'], bevel=0.01)
    box('Staukasten', (0.6, 1.6, 0.55), (TX - 1.75, 0, 2.5), M['camo'], bevel=0.03)
    for i in range(3):
        cyl(f'Nebel{i}', 0.04, 0.18, (TX + 0.85, (-1) ** i * 1.05, 2.95), M['steel'], rot=(0, math.radians(35), 0), verts=8)
    for s in (-1, 1):
        for k in range(5): box(f'Ersatzglied{s}{k}', (0.16, 0.05, 0.4), (TX - 0.6 + k * 0.18, s * 1.2, 2.4), M['track'], bevel=0.005)

def puma(M, T):
    # achträdriger Spähwagen mit geschlossener Wanne
    prism('Wanne', [(-0.75, 0.6), (0.75, 0.6), (1.18, 1.25), (0.95, 1.9), (-0.95, 1.9), (-1.18, 1.25)], 5.4, M['camo'], axis='x')
    frustum('Bugkeil', (1.0, 2.2, 1.0), (3.0, 0, 1.3), M['camo'], top=(0.3, 0.85), shift=(-0.3, 0), rot=(0, math.radians(0), 0))
    frustum('Heck', (0.8, 2.2, 1.0), (-2.95, 0, 1.3), M['camo'], top=(0.4, 0.85), shift=(0.2, 0))
    for s in (-1, 1):
        for i, x in enumerate((-1.95, -0.75, 0.75, 1.95)):
            wheel(f'Rad{s}{i}', x, s * 1.05, 0.55, 0.52, 0.32, M['rubber'], M['camo'], M['steel'], s)
            box(f'Kotfluegel{s}{i}', (1.1, 0.42, 0.05), (x, s * 1.1, 1.12), M['camo'], bevel=0.01)
        box(f'Staukasten{s}', (2.0, 0.25, 0.4), (0.0, s * 1.27, 1.45), M['camo'], bevel=0.02)
    box('Sehklappe', (0.06, 0.5, 0.12), (2.85, 0.4, 1.7), M['steel'])
    cyl('Antenne', 0.012, 2.4, (-2.3, -0.6, 3.1), M['steel'], verts=6)
    for i in range(2): box(f'Kanister{i}', (0.18, 0.36, 0.48), (-3.2, -0.35 + i * 0.7, 1.4), M['jerry'], bevel=0.02)

def puma_turret(M, T):
    frustum('Turm', (1.7, 1.55, 0.6), (0.0, 0, 2.2), M['camo'], top=(0.8, 0.78), bevel=0.03)
    o = cyl('Saukopf', 0.25, 0.45, (0.95, 0, 2.2), M['camo'], verts=24, bevel=0.03); o.scale = (1.4, 1, 1)
    cyl('Rohr', 0.05, 2.4, (2.2, 0, 2.2), M['camo'], rot=RY, verts=16)
    cyl('Muendung', 0.08, 0.25, (3.4, 0, 2.2), M['camo'], rot=RY, verts=16)
    box('Luke', (0.4, 0.4, 0.04), (-0.3, 0.2, 2.52), M['camo'], bevel=0.01)

def wespe(M, T):
    prism('Wanne', [(-2.4, 0.45), (1.9, 0.45), (2.35, 0.8), (2.35, 1.2), (-2.4, 1.2)], 1.7, M['camo'])
    block('Oberwanne', -2.4, -1.12, 1.2, 1.2, 1.12, 1.55, M['camo'], bevel=0.02)
    prism('Bug', [(1.2, 1.2), (2.35, 1.2), (1.2, 1.55)], 2.24, M['camo'])
    for s in (-1, 1):
        y = s * 0.98
        for i in range(5):
            wheel(f'Rolle{s}{i}', -1.65 + i * 0.75, y, 0.42, 0.33, 0.22, M['rubber'], M['camo'], M['steel'], s)
        cyl(f'Treibrad{s}', 0.3, 0.22, (2.05, y, 0.85), M['camo'], rot=RX, verts=24, bevel=0.02)
        cyl(f'Leitrad{s}', 0.28, 0.2, (-2.35, y, 0.7), M['camo'], rot=RX, verts=24, bevel=0.02)
        track_run(f'Kette{s}', s, y, [(2.05, 1.17), (2.42, 0.85), (2.05, 0.5), (1.4, 0.1), (-1.8, 0.1), (-2.35, 0.4), (-2.66, 0.7), (-2.35, 0.99), (0.0, 1.0), (1.4, 1.05)], M['track'], width=0.3, link=0.11)
        box(f'Kotfluegel{s}', (4.6, 0.32, 0.04), (0.0, s * 1.08, 1.22), M['camo'], bevel=0.005)
    box('Fahrerhaus', (0.7, 0.8, 0.45), (1.0, 0.55, 1.75), M['camo'], bevel=0.02)

def wespe_turret(M, T):
    # offener Kampfraum mit Haubitze (dreht sich im Spiel als Ganzes)
    for (sx, sy, l, w) in ((-0.2, -1.0, 2.6, 0.06), (-0.2, 1.0, 2.6, 0.06), (-1.5, 0, 0.06, 2.0)):
        o = box(f'Wand{sx}{sy}', (l, w, 0.8), (sx, sy, 1.95), M['camo'], bevel=0.01)
    frustum('Schild', (0.08, 2.0, 0.8), (1.05, 0, 1.95), M['camo'], top=(1, 0.7), shift=(-0.2, 0), bevel=0.01)
    box('Wiege', (1.2, 0.45, 0.35), (0.4, 0, 2.0), M['camo'], bevel=0.03)
    cyl('Rohr', 0.08, 2.6, (1.6, 0, 2.15), M['camo'], rot=(0, math.radians(84), 0), verts=20)
    cyl('Muendung', 0.12, 0.3, (2.9, 0, 2.28), M['camo'], rot=(0, math.radians(84), 0), verts=20)
    for i in range(4): box(f'Granate{i}', (0.12, 0.12, 0.45), (-1.2, -0.6 + i * 0.25, 1.85), M['steel'], bevel=0.02)


def tiger40(M, T):
    tiger(M, T)
    rnd = random.Random(11)
    stowage(M, rnd, [('balken', -1.0, 1.25, 2.12, 0.0), ('plane', -2.1, -0.6, 2.12, 0.0), ('kanister', -2.5, 0.5, 2.12, 0.0),
                     ('kanister', -2.5, 0.75, 2.12, 0.1), ('kiste', -1.6, -1.05, 2.12, 0.05), ('glieder', 2.3, -1.2, 2.02, 0.0)])
    dents(['Aufbau', 'Kotfluegel'], 0.012)

def puma40(M, T):
    puma(M, T)
    rnd = random.Random(12)
    stowage(M, rnd, [('plane', -1.4, 0.0, 1.95, 0.0), ('kanister', -2.4, -0.7, 1.95, 0.0), ('kiste', -0.4, 0.75, 1.95, 0.1)])
    dents(['Kotfluegel', 'Staukasten'], 0.02)

def wespe40(M, T):
    wespe(M, T)
    rnd = random.Random(13)
    stowage(M, rnd, [('plane', 1.6, -0.5, 1.56, 0.0), ('kanister', 2.0, 0.6, 1.56, 0.0), ('rad', -2.2, 1.18, 1.0, 0.0)])
    dents(['Kotfluegel'], 0.02)

# ======================= Infanterie (1940) =======================
def soldier(M, T, kind, row, scale=1.8):
    root = E.empty('Soldat'); root.scale = (scale, scale, scale); E.set_parent(root)
    rnd = random.Random(hash(kind) & 0xff)
    tunic = M['coat'] if kind == 'miliz' else M['feldgrau']
    swing = (0, 0.45, -0.45)[row]
    for side in (-1, 1):
        leg = E.empty(f'Huefte{side}', root); leg.location = (0, side * 0.11, 0.92)
        E.set_parent(leg)
        cyl(f'Hose{side}', 0.085, 0.5, (0, 0, -0.25), tunic if kind == 'miliz' else M['feldgrau'], verts=10)
        cyl(f'Stiefel{side}', 0.075, 0.38, (0, 0, -0.68), M['leather'], verts=10)
        box(f'Sohle{side}', (0.26, 0.11, 0.07), (0.05, 0, -0.88), M['leather'], bevel=0.03)
        leg.rotation_euler = (0, swing * side, 0)
        E.set_parent(root)
    o = frustum('Rock', (0.3, 0.42, 0.66), (0, 0, 1.25), tunic, top=(0.9, 1.06), bevel=0.06)
    E.wobble(o, 0.01, 0.1, levels=1)
    box('Koppel', (0.32, 0.44, 0.06), (0, 0, 0.98), M['leather'], bevel=0.02)
    for s in (-1, 1): box(f'Patronentasche{s}', (0.1, 0.12, 0.1), (0.15, s * 0.12, 1.02), M['leather'], bevel=0.02)
    box('Brotbeutel', (0.1, 0.2, 0.18), (-0.06, 0.24, 0.92), M['tarp'], bevel=0.04)
    cyl('Feldflasche', 0.06, 0.16, (-0.05, 0.27, 0.78), M['jerry'], verts=10)
    cyl('Gasmaske', 0.07, 0.28, (-0.18, -0.15, 0.95), M['feldgrau'], verts=12)
    sphere('Kopf', 0.105, (0.02, 0, 1.68), M['skin'], seg=14)
    if kind == 'miliz':
        cyl('Muetze', 0.12, 0.09, (0.0, 0, 1.8), M['cap'], verts=16)
        box('Schirm', (0.13, 0.19, 0.02), (0.11, 0, 1.76), M['cap'], bevel=0)
        cyl('Armbinde', 0.068, 0.07, (0, 0.27, 1.35), M['white'], verts=10)
    else:
        sphere('Helm', 0.14, (0.0, 0, 1.73), M['helmet'], scale=(1.05, 1, 0.8), seg=16)
        cyl('Helmrand', 0.165, 0.035, (-0.02, 0, 1.68), M['helmet'], verts=16, r2=0.14)
        box('Nackenschutz', (0.08, 0.26, 0.08), (-0.13, 0, 1.64), M['helmet'], rot=(0, 0.6, 0), bevel=0.02)
    box('Tornister', (0.14, 0.3, 0.28), (-0.2, 0, 1.3), M['tarp'] if kind != 'miliz' else M['coat'], bevel=0.04)
    if kind != 'miliz': cyl('Kochgeschirr', 0.08, 0.12, (-0.28, 0, 1.48), M['feldgrau'], rot=RY, verts=10)
    for side in (-1, 1):
        arm = E.empty(f'Schulter{side}', root); arm.location = (0, side * 0.24, 1.5)
        E.set_parent(arm)
        cyl(f'Arm{side}', 0.06, 0.58, (0.0, 0, -0.29), tunic, verts=8)
        sphere(f'Hand{side}', 0.045, (0, 0, -0.6), M['skin'], seg=8)
        arm.rotation_euler = (0, -swing * side * 0.8 - (0.9 if side == 1 else 0.35), 0)
        E.set_parent(root)
    if kind == 'raketentrupp':
        # Panzerbüchse 39 (1,6 m lang, Zweibein eingeklappt) und Patronenkästen
        line_cyl('PzB_Schaft', (-0.28, -0.2, 1.02), (0.3, 0.06, 1.33), 0.04, M['steel'], verts=6)
        line_cyl('PzB_Lauf', (0.3, 0.06, 1.33), (1.25, 0.48, 1.86), 0.022, M['steel'], verts=8)
        line_cyl('PzB_Muendung', (1.2, 0.46, 1.83), (1.3, 0.5, 1.89), 0.034, M['steel'], verts=8)
        line_cyl('PzB_Zweibein', (0.75, 0.25, 1.55), (0.45, 0.13, 1.38), 0.012, M['steel'], verts=4)
        for k in range(2): box(f'Patronenkasten{k}', (0.12, 0.14, 0.12), (0.12, -0.24 + k * 0.48, 1.0), M['leather'], bevel=0.02)
    else:
        line_cyl('Schaft', (-0.1, -0.2, 1.05), (0.5, 0.12, 1.42), 0.028, M['wood'], verts=6)
        line_cyl('Lauf', (0.42, 0.08, 1.38), (0.85, 0.3, 1.62), 0.014, M['steel'], verts=6)
    E.set_parent(E.REF)


# ======================= Fahrzeuge um 1940 =======================
def nbfz(M, T):
    """Neubaufahrzeug (1940 in Norwegen im Einsatz): lange Wanne, Hauptturm, zwei MG-Nebentürme, gepanzerte Laufwerksabdeckung"""
    G = M['grey']
    prism('Unterwanne', [(-3.3, 0.5), (2.9, 0.5), (3.3, 0.95), (3.3, 1.3), (-3.3, 1.3), (-3.35, 0.85)], 2.0, G)
    block('Aufbau', -3.3, -1.3, 1.3, 2.5, 1.3, 2.05, G, bevel=0.03)
    prism('Bugplatte', [(2.5, 1.3), (3.3, 1.3), (2.5, 2.05)], 2.6, G)
    block('Motordeck', -3.2, -1.1, 2.05, -1.5, 1.1, 2.12, G, bevel=0.02)
    for i in range(2): block(f'Gitter{i}', -3.0, -0.95 + i * 1.1, 2.12, -1.8, -0.15 + i * 1.1, 2.15, M['steel'], bevel=0.01)
    box('Fahrersicht', (0.06, 0.4, 0.14), (2.52, 0.5, 1.85), M['steel'])
    for x, y, d in ((1.6, -0.72, 1), (-1.15, 0.72, -1)):
        cyl(f'Nebenturm{x}', 0.5, 0.55, (x, y, 2.32), G, verts=28, bevel=0.03)
        cyl(f'Nebenturmdach{x}', 0.42, 0.06, (x, y, 2.62), G, verts=28, bevel=0.01)
        line_cyl(f'NebenMG{x}', (x + d * 0.45, y, 2.35), (x + d * 0.95, y, 2.35), 0.025, M['steel'], verts=8)
    for s in (-1, 1):
        y = s * 1.15
        box(f'Kotfluegel{s}', (6.4, 0.38, 0.04), (0.0, s * 1.48, 1.32), G, bevel=0.005)
        cyl(f'Seil{s}', 0.035, 3.6, (-0.4, s * 1.55, 1.42), M['steel'], rot=RY, verts=8)
        for i in range(10):
            wheel(f'Rolle{s}{i}', -2.5 + i * 0.52, y, 0.42, 0.3, 0.2, M['rubber'], G, M['steel'], s)
        # Panzerplatte über dem oberen Laufwerk (gehörte zur Konstruktion)
        box(f'Laufwerkspanzer{s}', (5.4, 0.05, 0.42), (-0.15, s * 1.3, 0.98), G, bevel=0.01)
        cyl(f'Treibrad{s}', 0.4, 0.28, (2.85, y, 1.0), G, rot=RX, verts=32, bevel=0.02)
        cyl(f'Leitrad{s}', 0.36, 0.25, (-3.0, y, 0.85), G, rot=RX, verts=32, bevel=0.02)
        track_run(f'Kette{s}', s, y, [(2.85, 1.42), (3.28, 1.0), (2.85, 0.6), (2.3, 0.12), (-2.6, 0.12), (-3.0, 0.48), (-3.38, 0.85), (-3.0, 1.22), (0.0, 1.27), (2.0, 1.3)], M['track'], width=0.46, link=0.13)

def nbfz_turret(M, T):
    G = M['grey']
    frustum('Turm', (2.3, 2.0, 0.85), (0.0, 0, 2.5), G, top=(0.85, 0.82), bevel=0.04)
    box('Blende', (0.3, 1.2, 0.6), (1.1, 0, 2.48), G, bevel=0.06)
    # 7,5-cm-KwK L/24 und daneben 3,7-cm-KwK L/45
    cyl('Rohr75', 0.085, 1.7, (2.05, 0.22, 2.45), G, rot=RY, verts=24, r2=0.078)
    cyl('Rohr37', 0.045, 2.0, (2.2, -0.32, 2.5), G, rot=RY, verts=16)
    cyl('Kuppel', 0.33, 0.3, (-0.55, 0.3, 3.05), G, verts=28, bevel=0.02)
    box('Luke', (0.5, 0.45, 0.05), (0.1, -0.45, 2.95), G, bevel=0.01)
    box('Staukasten', (0.4, 1.2, 0.4), (-1.15, 0, 2.45), G, bevel=0.03)
    cyl('Antenne', 0.012, 2.0, (-0.9, -0.7, 3.8), M['steel'], verts=6)

def sdkfz232(M, T):
    """Schwerer Panzerspähwagen Sd.Kfz. 232 (8-Rad): wie Sd.Kfz. 231, mit großer Rahmenantenne über der Wanne"""
    puma(M, T)
    G = M['grey']
    for x, ys in ((1.1, (-0.95, 0.95)), (-2.5, (0.0,))):
        for y in ys: line_cyl(f'Antennenstuetze{x}{y}', (x, y * 0.95, 1.9), (x, y, 3.0), 0.025, M['steel'], verts=6)
    pts = [(1.25, -0.98), (1.25, 0.98), (-2.55, 0.98), (-2.55, -0.98)]
    for k in range(4):
        (ax, ay), (bx, by) = pts[k], pts[(k + 1) % 4]
        line_cyl(f'Rahmenantenne{k}', (ax, ay, 3.0), (bx, by, 3.0), 0.03, M['steel'], verts=6)

def sdkfz232_turret(M, T):
    G = M['grey']
    frustum('Turm', (1.45, 1.3, 0.55), (0.0, 0, 2.2), G, top=(0.82, 0.8), bevel=0.03)
    box('Blende', (0.2, 0.6, 0.35), (0.72, 0, 2.2), G, bevel=0.03)
    cyl('Rohr20', 0.03, 1.3, (1.4, 0.1, 2.22), M['steel'], rot=RY, verts=12)
    cyl('Muendung20', 0.045, 0.12, (2.06, 0.1, 2.22), M['steel'], rot=RY, verts=12)
    cyl('KoaxMG', 0.018, 0.5, (1.0, -0.15, 2.2), M['steel'], rot=RY, verts=8)
    box('Gitter', (1.0, 0.9, 0.03), (-0.05, 0, 2.5), M['steel'], bevel=0.005)

def sturmpanzer1(M, T):
    """Sturmpanzer I (15-cm-sIG 33 auf Panzer I Ausf. B, 1940): kleines Fahrgestell mit Außenträger"""
    G = M['grey']
    prism('Wanne', [(-2.2, 0.45), (1.75, 0.45), (2.15, 0.8), (2.15, 1.15), (-2.2, 1.15)], 1.6, G)
    block('Oberwanne', -2.2, -1.0, 1.15, 1.0, 1.0, 1.4, G, bevel=0.02)
    prism('Bug', [(1.0, 1.15), (2.15, 1.15), (1.0, 1.4)], 2.0, G)
    for s in (-1, 1):
        y = s * 0.92
        for i in range(5):
            wheel(f'Rolle{s}{i}', -1.45 + i * 0.66, y, 0.36, 0.27, 0.18, M['rubber'], G, M['steel'], s)
        line_cyl(f'Aussentraeger{s}', (-1.65, y + s * 0.13, 0.52), (1.45, y + s * 0.13, 0.52), 0.06, G, verts=8)
        cyl(f'Treibrad{s}', 0.28, 0.2, (1.85, y, 0.8), G, rot=RX, verts=24, bevel=0.02)
        cyl(f'Leitrad{s}', 0.26, 0.18, (-2.15, y, 0.62), G, rot=RX, verts=24, bevel=0.02)
        track_run(f'Kette{s}', s, y, [(1.85, 1.1), (2.18, 0.8), (1.85, 0.48), (1.3, 0.08), (-1.6, 0.08), (-2.15, 0.34), (-2.45, 0.62), (-2.15, 0.9), (0.0, 0.98), (1.3, 1.02)], M['track'], width=0.28, link=0.11)
        box(f'Kotfluegel{s}', (4.3, 0.3, 0.04), (0.0, s * 1.02, 1.16), G, bevel=0.005)

def sturmpanzer1_turret(M, T):
    # hoher, oben und hinten offener Aufbau mit 15-cm-sIG 33 (dreht sich im Spiel als Ganzes)
    G = M['grey']
    for sy in (-1, 1): box(f'Wand{sy}', (2.1, 0.05, 1.75), (-0.1, sy * 0.98, 2.25), G, bevel=0.01)
    frustum('Schild', (0.06, 2.0, 1.85), (0.95, 0, 2.3), G, top=(1, 0.95), shift=(-0.12, 0), bevel=0.01)
    box('Wiege', (1.3, 0.5, 0.45), (0.3, 0, 1.95), M['steel'], bevel=0.03)
    for s in (-1, 1): box(f'Lafette{s}', (1.8, 0.08, 0.7), (-0.2, s * 0.45, 1.75), G, bevel=0.01)
    cyl('Rohr', 0.13, 1.6, (1.45, 0, 2.08), G, rot=(0, math.radians(84), 0), verts=24)
    cyl('Muendung', 0.15, 0.12, (2.24, 0, 2.17), G, rot=(0, math.radians(84), 0), verts=24)
    for i in range(4): box(f'Granate{i}', (0.16, 0.16, 0.5), (-0.95, -0.55 + i * 0.36, 1.65), M['steel'], bevel=0.02)

def stuka(M, T):
    """Junkers Ju 87 B: Knickflügel, starres verkleidetes Fahrwerk, lange Kanzel, 250-kg-Bombe"""
    A = M['air']
    o = sphere('Rumpf', 1.0, (-0.3, 0, 1.75), A, seg=24); o.scale = (4.4, 0.55, 0.66)
    o = frustum('Motorhaube', (1.6, 1.05, 1.15), (3.5, 0, 1.8), A, top=(0.75, 0.8), rot=(0, math.radians(90), 0), bevel=0.08)
    E.cyl('Spinner', 0.3, 0.5, (4.55, 0, 1.85), M['black'], rot=RY, verts=16, r2=0.04)
    box('Kuehler', (0.9, 0.55, 0.45), (3.3, 0, 1.12), A, bevel=0.1)
    o = sphere('Kanzel', 0.5, (0.6, 0, 2.3), M['glass'], seg=16); o.scale = (2.3, 0.75, 0.65)
    for k in range(5): box(f'Kanzelrahmen{k}', (0.05, 0.72, 0.52), (-0.3 + k * 0.45, 0, 2.32), A, bevel=0)
    line_cyl('HeckMG', (-0.6, 0, 2.4), (-1.5, 0, 2.55), 0.025, M['steel'], verts=6)
    # Knickflügel: innen nach unten, außen nach oben
    def wing(name, pts, root, angle, s):
        o = plan_prism(name, [(x, y * s) for x, y in pts], -0.07, 0.07, A, bevel=0.02)
        o.location = root; o.rotation_euler = (s * angle, 0, 0)
        return o
    for s in (-1, 1):
        a_in, L_in = math.radians(-22), 2.0
        wing(f'Innenfluegel{s}', [(1.4, 0), (1.3, L_in), (-0.75, L_in), (-0.95, 0)], (0, s * 0.45, 1.3), a_in, s)
        ty, tz = s * (0.45 + L_in * math.cos(a_in)), 1.3 + L_in * math.sin(a_in)
        wing(f'Aussenfluegel{s}', [(1.3, 0), (1.0, 4.4), (0.6, 4.9), (-0.4, 4.9), (-0.75, 4.4), (-0.75, 0)], (0, ty, tz), math.radians(9), s)
        # verkleidetes Fahrwerk („Hosen“) am Knick
        o = sphere(f'Radverkleidung{s}', 0.45, (0.45, ty, tz - 0.55), A, seg=16); o.scale = (1.4, 0.55, 1.5)
        cyl(f'Rad{s}', 0.3, 0.12, (0.5, ty, 0.3), M['rubber'], rot=RX, verts=16)
        cyl(f'Sirene{s}', 0.08, 0.2, (1.0, ty, tz - 0.3), M['steel'], rot=RY, verts=10)
        for k in range(2): box(f'Sturzflugbremse{s}{k}', (0.12, 1.1, 0.04), (0.2, ty + s * (1.2 + k * 1.3), tz - 0.15 + k * 0.2), M['steel'], bevel=0)
        o = sphere(f'Fluegelbombe{s}', 0.12, (0.4, ty + s * 1.6, tz - 0.25), M['grey'], seg=10); o.scale = (3.2, 1, 1)
    plan_prism('Hoehenleitwerk', [(-3.7, -1.8), (-3.4, 0), (-3.7, 1.8), (-4.3, 1.8), (-4.4, 0), (-4.3, -1.8)], 1.95, 2.03, A, bevel=0.01)
    for s in (-1, 1): line_cyl(f'Leitwerksstrebe{s}', (-3.9, s * 1.0, 1.95), (-3.9, s * 0.25, 1.45), 0.025, M['steel'], verts=6)
    prism('Seitenleitwerk', [(-4.5, 1.9), (-3.5, 2.0), (-3.8, 3.2), (-4.4, 3.25)], 0.08, A)
    o = sphere('Bombe', 0.2, (0.2, 0, 1.05), M['grey'], seg=12); o.scale = (3.4, 1, 1)
    for k in range(4): box(f'Bombenleitwerk{k}', (0.3, 0.02, 0.32), (-0.55, 0, 1.05), M['grey'], rot=(k * math.pi / 4, 0, 0), bevel=0)
    line_cyl('Bombengabel', (0.2, 0, 1.25), (0.5, 0, 1.15), 0.03, M['steel'], verts=6)

# ======================= Luftfahrzeuge (1940) =======================
def heli(M, T):
    """Flettner Fl 282 Kolibri: kleiner Rumpf, offener Sitz, Gitterrohr-Heck, zwei Rotormasten"""
    o = sphere('Rumpf', 1.0, (0.4, 0, 1.25), M['air'], seg=20); o.scale = (1.5, 0.6, 0.7)
    o = sphere('Motorhaube', 0.7, (1.4, 0, 1.15), M['air'], seg=16); o.scale = (0.9, 0.62, 0.65)
    box('Windschutz', (0.05, 0.6, 0.35), (1.2, 0, 1.85), M['glass'], rot=(0, -0.4, 0), bevel=0)
    sphere('Pilot', 0.2, (0.6, 0, 1.95), M['helmet'], seg=12)
    # Gitterrohrrumpf nach hinten
    for dy in (-0.25, 0.25):
        for dz in (0.95, 1.45):
            line_cyl(f'Rohr{dy}{dz}', (-0.6, dy, dz), (-3.6, dy * 0.3, 1.3 + (dz - 1.2) * 0.3), 0.035, M['steel'], verts=6)
    for k in range(5):
        x = -0.8 - k * 0.6
        line_cyl(f'Strebe{k}', (x, -0.22, 1.0), (x - 0.3, 0.22, 1.42), 0.025, M['steel'], verts=6)
    prism('Leitwerk', [(-3.9, 1.0), (-3.3, 1.1), (-3.4, 2.1), (-3.9, 2.2)], 0.05, M['fabric'])
    box('Hoehenleitwerk', (0.6, 1.8, 0.04), (-3.5, 0, 1.35), M['fabric'], bevel=0.01)
    for s in (-1, 1):
        line_cyl(f'Mast{s}', (0.45, s * 0.12, 1.7), (0.45, s * 0.35, 2.75), 0.06, M['steel'])
        cyl(f'Nabe{s}', 0.12, 0.12, (0.45, s * 0.36, 2.78), M['steel'], verts=12)
        line_cyl(f'Fahrwerk{s}', (0.6, s * 0.2, 0.9), (0.6, s * 0.75, 0.25), 0.04, M['steel'])
        cyl(f'Rad{s}', 0.22, 0.1, (0.6, s * 0.75, 0.22), M['rubber'], rot=RX, verts=16)
    cyl('Bugrad', 0.15, 0.08, (1.9, 0, 0.16), M['rubber'], rot=RX, verts=14)
    line_cyl('Bugstrebe', (1.9, 0, 0.2), (1.7, 0, 0.9), 0.035, M['steel'])
    box('Bombe', (0.7, 0.18, 0.18), (0.4, 0, 0.6), M['grey'], bevel=0.06)

def jet(M, T):
    """Messerschmitt Bf 109: schlanker Rumpf, gelbe Nase, Splittertarnung, Propeller wird im Spiel animiert"""
    o = sphere('Rumpf', 1.0, (0.0, 0, 1.25), M['air'], seg=24); o.scale = (4.3, 0.5, 0.6)
    o = sphere('Nase', 0.55, (3.4, 0, 1.3), M['yellow'], seg=16); o.scale = (1.4, 0.9, 0.95)
    o = E.cyl('Spinner', 0.28, 0.6, (4.3, 0, 1.3), M['black'], rot=RY, verts=16, r2=0.02)
    o = sphere('Haube', 0.45, (1.0, 0, 1.75), M['glass'], seg=16); o.scale = (1.6, 0.75, 0.6)
    for k in range(3): box(f'Haubenrahmen{k}', (0.05, 0.7, 0.4), (0.45 + k * 0.55, 0, 1.78), M['air'], bevel=0)
    plan_prism('Fluegel', [(1.7, -4.9), (2.0, -1.0), (2.0, 1.0), (1.7, 4.9), (0.9, 4.9), (0.3, 1.0), (0.3, -1.0), (0.9, -4.9)], 0.95, 1.07, M['air'], bevel=0.02)
    plan_prism('Hoehenleitwerk', [(-3.4, -1.6), (-3.1, 0), (-3.4, 1.6), (-4.0, 1.6), (-4.1, 0), (-4.0, -1.6)], 1.55, 1.62, M['air'], bevel=0.01)
    prism('Seitenleitwerk', [(-4.2, 1.4), (-3.4, 1.5), (-3.6, 2.6), (-4.2, 2.65)], 0.08, M['air'])
    box('Rumpfband', (0.3, 1.02, 1.22), (-2.6, 0, 1.3), M['yellow'], bevel=0.05).scale = (1, 0.98, 0.98)
    for s in (-1, 1):
        cyl(f'Auspuff{s}', 0.04, 0.6, (2.6, s * 0.45, 1.4), M['rust'] if 'rust' in M else M['steel'], rot=RY, verts=8)
        line_cyl(f'Fahrwerk{s}', (1.1, s * 0.9, 1.0), (1.3, s * 1.2, 0.3), 0.05, M['steel'])
        cyl(f'Rad{s}', 0.3, 0.12, (1.3, s * 1.2, 0.3), M['rubber'], rot=RX, verts=16)

def cruiser(M, T):
    """Schwerer Kreuzer (Admiral-Hipper-Klasse), stark vereinfacht: vier Zwillingstürme, Turmmast, Flak, Katapult mit Bordflugzeug"""
    hull('Kreuzer', 28.0, 3.9, 1.7, M, bow=0.3)
    block('Aufbau', -4.0, -1.4, 1.76, 5.0, 1.4, 3.0, M['navy'], bevel=0.05)
    block('Turmmast', 2.6, -0.9, 3.0, 4.6, 0.9, 6.2, M['navy'], bevel=0.05)
    block('Bruecke', 2.4, -1.3, 4.6, 4.9, 1.3, 5.1, M['navy'], bevel=0.03)
    box('Brueckenfenster', (0.06, 2.2, 0.3), (4.92, 0, 4.85), M['glass'], bevel=0)
    o = cyl('Entfernungsmesser', 0.3, 3.2, (3.6, 0, 6.6), M['navy_d'], rot=RX, verts=14)
    cyl('Schornstein', 0.85, 3.2, (-0.4, 0, 4.4), M['navy'], verts=24, bevel=0.04).scale = (1.5, 1, 1)
    cyl('Kappe', 0.8, 0.25, (-0.4, 0, 6.05), M['black'], verts=24).scale = (1.5, 1, 1)
    naval_turret('Turm_A', 10.0, 1.76, M, 2, 1.25); naval_turret('Turm_B', 7.4, 3.0, M, 2, 1.25)
    naval_turret('Turm_C', -7.2, 3.0, M, 2, 1.25, facing=math.pi); naval_turret('Turm_D', -10.0, 1.76, M, 2, 1.25, facing=math.pi)
    for s in (-1, 1):
        for k, x in enumerate((-3.0, 0.8, 2.6)):
            cyl(f'Flak{s}{k}', 0.35, 0.3, (x, s * 1.2, 3.2), M['navy_d'], verts=14)
            line_cyl(f'Flakrohr{s}{k}', (x, s * 1.2, 3.4), (x + 0.6, s * 1.3, 3.9), 0.04, M['steel'], verts=6)
    # Katapult mit Bordflugzeug (Arado)
    box('Katapult', (5.0, 0.4, 0.3), (-2.4, 0, 3.2), M['steel'], rot=(0, 0, 0.5), bevel=0.02)
    o = sphere('Flugzeugrumpf', 0.4, (-2.4, 0, 3.6), M['grey'], seg=12); o.scale = (3.0, 0.8, 0.8)
    box('Flugzeugfluegel', (0.6, 4.4, 0.06), (-2.2, 0, 3.75), M['grey'], rot=(0, 0, 0.5), bevel=0.01)
    line_cyl('Mast', (1.0, 0, 6.2), (1.0, 0, 10.0), 0.1, M['steel']); line_cyl('Rah', (1.0, -1.4, 9.0), (1.0, 1.4, 9.0), 0.05, M['steel'])
    line_cyl('Ankerkette', (12.6, -0.5, 1.78), (11.0, -0.4, 1.78), 0.05, M['steel'], verts=6)

# ======================= Schiffe =======================
def hull(name, L, B, H, M, bow=0.3):
    pts = [(L / 2, 0), (L / 2 - L * bow, B / 2), (-L / 2 + B * 0.3, B / 2), (-L / 2, B * 0.35), (-L / 2, -B * 0.35), (-L / 2 + B * 0.3, -B / 2), (L / 2 - L * bow, -B / 2)]
    plan_prism(f'{name}_u', [(x * 0.97, y * 0.92) for x, y in pts], 0.0, 0.25, M['hullred'], bevel=0.05)
    plan_prism(f'{name}_r', pts, 0.25, H, M['navy'], bevel=0.05)
    plan_prism(f'{name}_d', [(x * 0.985, y * 0.95) for x, y in pts], H, H + 0.06, M['deck'], bevel=0.01)

def naval_turret(name, x, z, M, barrels=2, big=1.0, facing=0.0):
    t = E.empty(name); t.location = (x, 0, z); t.rotation_euler = (0, 0, facing); E.set_parent(t)
    frustum(f'{name}_k', (1.4 * big, 1.2 * big, 0.6 * big), (0, 0, 0.3 * big), M['navy'], top=(0.85, 0.9), bevel=0.04)
    for i in range(barrels):
        dy = (i - (barrels - 1) / 2) * 0.32 * big
        cyl(f'{name}_b{i}', 0.07 * big, 2.0 * big, (1.5 * big, dy, 0.35 * big), M['navy_d'], rot=(0, math.radians(87), 0), verts=12)
    E.set_parent(E.REF)

def patrol(M, T):
    hull('Boot', 14.0, 2.6, 1.0, M, bow=0.35)
    block('Bruecke', 0.5, -0.7, 1.06, 2.6, 0.7, 2.1, M['navy'], bevel=0.04)
    box('Fenster', (0.06, 1.2, 0.25), (2.62, 0, 1.85), M['glass'], bevel=0)
    for s in (-1, 1): cyl(f'Torpedorohr{s}', 0.28, 3.4, (4.4, s * 0.85, 1.35), M['navy_d'], rot=RY, verts=16, bevel=0.03)
    cyl('Flak', 0.35, 0.3, (-3.5, 0, 1.25), M['navy_d'], verts=16)
    line_cyl('Flakrohr', (-3.5, 0, 1.4), (-2.5, 0, 1.9), 0.05, M['steel'])
    line_cyl('Mast', (1.6, 0, 2.1), (1.6, 0, 3.6), 0.05, M['steel'])
    for i in range(3): box(f'Wasserbombe{i}', (0.3, 0.3, 0.3), (-6.0, -0.6 + i * 0.6, 1.2), M['navy_d'], bevel=0.05)

def destroyer(M, T):
    hull('Zerstoerer', 22.0, 3.2, 1.4, M, bow=0.32)
    block('Vorschiffaufbau', 2.0, -1.1, 1.46, 5.0, 1.1, 2.5, M['navy'], bevel=0.05)
    block('Bruecke', 2.6, -0.9, 2.5, 4.4, 0.9, 3.4, M['navy'], bevel=0.04)
    box('Brueckenfenster', (0.06, 1.6, 0.3), (4.42, 0, 3.15), M['glass'], bevel=0)
    for i, x in enumerate((-0.8, -3.0)):
        cyl(f'Schornstein{i}', 0.55, 2.6, (x, 0, 2.7), M['navy'], verts=24, bevel=0.03).scale = (1.4, 1, 1)
        cyl(f'Kappe{i}', 0.5, 0.15, (x, 0, 4.05), M['black'], verts=24).scale = (1.4, 1, 1)
    block('Mittelaufbau', -4.5, -0.9, 1.46, 0.6, 0.9, 2.1, M['navy'], bevel=0.04)
    naval_turret('Turm_A', 7.2, 1.46, M, 2); naval_turret('Turm_B', 5.4, 2.5, M, 2)
    naval_turret('Turm_C', -6.5, 1.46, M, 2, facing=math.pi); naval_turret('Turm_D', -8.4, 1.46, M, 1, facing=math.pi)
    lattice = [line_cyl('Mast', (1.8, 0, 2.5), (1.8, 0, 6.5), 0.08, M['steel']), line_cyl('Rah', (1.8, -1.0, 5.6), (1.8, 1.0, 5.6), 0.04, M['steel'])]
    for s in (-1, 1): cyl(f'Torpedosatz{s}', 0.35, 2.6, (-2.0, s * 0.95, 1.75), M['navy_d'], rot=RY, verts=16)
    for i in range(4): box(f'Wasserbombe{i}', (0.35, 0.35, 0.35), (-10.2, -0.9 + i * 0.6, 1.62), M['navy_d'], bevel=0.05)

# Name: (Bau, Turm-Bau oder None, Richtungen, Reihen, Bildbreite, -höhe, Anker x, Anker y, Schatten, Höhe über Grund)
UNITS = {
    'schwerer_panzer': (nbfz, nbfz_turret, 16, 1, 140, 100, 70, 62, True, 0),
    'spaehpanzer': (sdkfz232, sdkfz232_turret, 16, 1, 112, 84, 56, 54, True, 0),
    'artillerie': (sturmpanzer1, sturmpanzer1_turret, 16, 1, 112, 84, 56, 54, True, 0),
    'schuetze': ('schuetze', None, 8, 3, 40, 48, 20, 40, True, 0),
    'raketentrupp': ('raketentrupp', None, 8, 3, 40, 48, 20, 40, True, 0),
    'miliz': ('miliz', None, 8, 3, 40, 48, 20, 40, True, 0),
    'kampfhubschrauber': (stuka, None, 16, 1, 150, 110, 75, 70, False, 0),
    'kampfjet': (jet, None, 16, 1, 128, 96, 64, 64, False, 0),
    'patrouillenboot': (patrol, None, 16, 1, 150, 100, 75, 60, True, 0),
    'zerstoerer': (destroyer, None, 16, 1, 220, 150, 110, 88, True, 0),
    'raketenkreuzer': (cruiser, None, 16, 1, 270, 180, 135, 104, True, 0),
}

meta = {}
for name, (build, tbuild, frames, rows, W, H, ax, ay, shadow, _) in UNITS.items():
    if ONLY and name not in ONLY: continue
    parts = ['wanne', 'turm'] if tbuild else ['wanne']
    for row in range(rows):
        E.reset(name)
        M = mats()
        T = E.empty('Turm')
        if callable(build): build(M, None)
        else: soldier(M, None, build, row)
        if tbuild:
            E.set_parent(T); tbuild(M, T); E.set_parent(E.REF)
        plane = E.shadow_catcher() if shadow else None
        E.frame_camera(W * 2, H * 2, (0, 0, 0), ax * 2, ay * 2)
        turret_objs = set(T.children_recursive)
        hull_objs = [o for o in E.REF.children_recursive if o not in turret_objs and o.type != 'EMPTY']
        for part in parts:
            for o in turret_objs: o.visible_camera = part == 'turm'
            for o in hull_objs: o.hide_render = part == 'turm'
            if plane: plane.hide_render = part == 'turm'
            only = os.environ.get('FRAMES')
            for f in range(frames):
                if only and str(f) not in only.split(','): continue
                E.REF.rotation_euler = (0, 0, -f * 2 * math.pi / frames)
                E.shoot(os.path.join(OUT, f'{name}_{part}_{row}_{f:02d}.png'), SAMPLES)
    meta[name] = {'frames': frames, 'rows': rows, 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.05, 'turret': bool(tbuild), 'w': W, 'h': H}
    print('fertig', name)
json.dump(meta, open(os.path.join(OUT, f'meta_{"_".join(ONLY) or "alle"}.json'), 'w'), indent=1)
