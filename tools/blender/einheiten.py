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

def mats():
    M = {}
    M['camo'] = E.camo('Tarn')
    M['zimm'] = E.camo('Zimmerit', zimmerit=True)
    M['grey'] = E.camo('Grau', base=(0.20, 0.21, 0.20), green=(0.14, 0.15, 0.13), brown=(0.17, 0.16, 0.14), scale=0.5)
    M['steel'] = E.painted('Stahl', (0.06, 0.055, 0.05), 0.5, mud_h=1.0, metal_edge=(0.3, 0.29, 0.28))
    M['track'] = E.painted('Kette', (0.09, 0.07, 0.055), 0.7, mud_h=1.2, metal_edge=(0.32, 0.31, 0.3))
    M['rubber'] = E.painted('Gummi', (0.035, 0.033, 0.03), 0.85, chips=False, mud_h=1.0)
    M['glass'] = E.plain('Glas', (0.03, 0.04, 0.045), 0.08, 0.2)
    M['wood'] = E.wood('Holz')
    M['jerry'] = E.painted('Kanister', (0.13, 0.15, 0.08), 0.6, mud_h=0)
    M['feldgrau'] = E.painted('Feldgrau', (0.14, 0.16, 0.12), 0.85, chips=False, mud_h=0.35, streaks=0, dust_amt=0.3)
    M['coat'] = E.painted('Mantel', (0.20, 0.13, 0.07), 0.9, chips=False, mud_h=0.35, streaks=0, dust_amt=0.3)
    M['cap'] = E.painted('Muetze', (0.10, 0.10, 0.09), 0.9, chips=False, mud_h=0, streaks=0)
    M['skin'] = E.plain('Haut', (0.55, 0.36, 0.26), 0.6)
    M['leather'] = E.painted('Leder', (0.05, 0.035, 0.025), 0.6, chips=False, mud_h=0.3, streaks=0)
    M['helmet'] = E.painted('Helm', (0.12, 0.14, 0.11), 0.6, mud_h=0, streaks=0)
    M['navy'] = E.painted('Marinegrau', (0.28, 0.30, 0.32), 0.6, mud_h=0, streaks=0.8)
    M['navy_d'] = E.painted('Marinegrau dunkel', (0.13, 0.14, 0.15), 0.6, mud_h=0, streaks=0.5)
    M['deck'] = E.wood('Deck', color=(0.30, 0.24, 0.16))
    M['hullred'] = E.painted('Unterwasser', (0.25, 0.06, 0.04), 0.7, chips=False, mud_h=0)
    M['air'] = E.camo('Luftwaffe', base=(0.20, 0.24, 0.17), green=(0.13, 0.17, 0.10), brown=(0.18, 0.2, 0.14), scale=0.7, mud_h=0, dust_amt=0.2)
    M['white'] = E.plain('Weiß', (0.7, 0.68, 0.62), 0.6)
    M['black'] = E.plain('Schwarz', (0.02, 0.02, 0.02), 0.5)
    return M

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

# ======================= Infanterie =======================
def soldier(M, T, kind, row, scale=1.8):
    root = E.empty('Soldat'); root.scale = (scale, scale, scale); E.set_parent(root)
    tunic = M['coat'] if kind == 'miliz' else M['feldgrau']
    swing = (0, 0.45, -0.45)[row]
    for side in (-1, 1):
        leg = E.empty(f'Huefte{side}', root); leg.location = (0, side * 0.12, 0.92)
        E.set_parent(leg)
        cyl(f'Bein{side}', 0.085, 0.82, (0, 0, -0.43), M['feldgrau' if kind != 'miliz' else 'cap'], verts=10)
        box(f'Stiefel{side}', (0.26, 0.12, 0.14), (0.05, 0, -0.85), M['leather'], bevel=0.03)
        leg.rotation_euler = (0, swing * side, 0)
        E.set_parent(root)
    frustum('Rumpf', (0.3, 0.42, 0.62), (0, 0, 1.25), tunic, top=(0.9, 1.05), bevel=0.06)
    box('Koppel', (0.32, 0.44, 0.06), (0, 0, 0.98), M['leather'], bevel=0.02)
    sphere('Kopf', 0.11, (0.02, 0, 1.68), M['skin'], seg=14)
    if kind == 'miliz':
        cyl('Muetze', 0.12, 0.08, (0.0, 0, 1.79), M['cap'], verts=16)
        box('Schirm', (0.12, 0.18, 0.02), (0.11, 0, 1.76), M['cap'], bevel=0)
    else:
        sphere('Helm', 0.14, (0.0, 0, 1.73), M['helmet'], scale=(1.05, 1, 0.8), seg=16)
        cyl('Helmrand', 0.16, 0.03, (-0.01, 0, 1.69), M['helmet'], verts=16, r2=0.14)
    box('Tornister', (0.14, 0.32, 0.3), (-0.2, 0, 1.3), M['leather' if kind != 'miliz' else 'coat'], bevel=0.04)
    for side in (-1, 1):
        arm = E.empty(f'Schulter{side}', root); arm.location = (0, side * 0.25, 1.5)
        E.set_parent(arm)
        cyl(f'Arm{side}', 0.06, 0.6, (0.0, 0, -0.3), tunic, verts=8)
        arm.rotation_euler = (0, -swing * side * 0.8 - (0.9 if side == 1 else 0.35), 0)
        E.set_parent(root)
    if kind == 'raketentrupp':
        tube = cyl('Panzerschreck', 0.06, 1.6, (0.15, 0.2, 1.62), M['camo'], rot=(0, math.radians(95), 0), verts=14)
        box('Schutzschild', (0.03, 0.36, 0.3), (0.45, 0.2, 1.62), M['camo'], bevel=0.01)
    else:
        line_cyl('Gewehr', (-0.1, -0.2, 1.05), (0.55, 0.15, 1.45), 0.025, M['wood'], verts=6)
        line_cyl('Lauf', (0.45, 0.1, 1.4), (0.85, 0.3, 1.62), 0.015, M['steel'], verts=6)
    E.set_parent(E.REF)

# ======================= Luftfahrzeuge =======================
def heli(M, T):
    o = sphere('Rumpf', 1.0, (0.3, 0, 1.4), M['air'], seg=24); o.scale = (2.3, 0.75, 0.9)
    o = sphere('Kanzel', 0.8, (1.6, 0, 1.6), M['glass'], seg=20); o.scale = (1.1, 0.62, 0.7)
    line_cyl('Heckausleger', (-1.5, 0, 1.55), (-4.0, 0, 1.9), 0.25, M['air'], verts=16)
    prism('Seitenleitwerk', [(-4.3, 1.7), (-3.7, 1.8), (-3.9, 2.9), (-4.4, 3.0)], 0.08, M['air'])
    box('Hoehenleitwerk', (0.5, 1.6, 0.05), (-3.5, 0, 1.85), M['air'], bevel=0.01)
    cyl('Rotormast', 0.12, 0.5, (0.3, 0, 2.45), M['steel'], verts=12)
    cyl('Rotorkopf', 0.25, 0.15, (0.3, 0, 2.72), M['steel'], verts=16)
    for s in (-1, 1):
        box(f'Stummelfluegel{s}', (0.6, 1.0, 0.08), (0.2, s * 0.95, 1.3), M['air'], bevel=0.02)
        cyl(f'Raketenbehaelter{s}', 0.17, 1.0, (0.35, s * 1.35, 1.12), M['air'], rot=RY, verts=16)
        line_cyl(f'Kufe{s}', (-1.0, s * 0.7, 0.2), (1.6, s * 0.7, 0.2), 0.04, M['steel'])
        for x in (-0.5, 1.0): line_cyl(f'Strebe{s}{x}', (x, s * 0.7, 0.2), (x, s * 0.45, 0.8), 0.035, M['steel'])
    box('Kennung', (0.6, 0.02, 0.35), (-1.6, -0.62, 1.55), M['white'], bevel=0)

def jet(M, T):
    o = sphere('Rumpf', 1.0, (0.0, 0, 1.2), M['air'], seg=24); o.scale = (4.0, 0.55, 0.6)
    o = sphere('Kanzel', 0.45, (1.6, 0, 1.6), M['glass'], seg=16); o.scale = (1.4, 0.8, 0.7)
    plan_prism('Fluegel', [(0.9, -3.6), (1.6, 0.0), (0.9, 3.6), (-0.1, 3.6), (0.2, 0.0), (-0.1, -3.6)], 1.55, 1.68, M['air'], bevel=0.02)
    # Triebwerk oben auf dem Rumpf (He 162)
    cyl('Triebwerk', 0.42, 3.2, (-1.2, 0, 2.05), M['steel'], rot=RY, verts=24, bevel=0.03)
    cyl('Einlauf', 0.38, 0.1, (0.42, 0, 2.05), M['black'], rot=RY, verts=24)
    box('Hoehenleitwerk', (0.8, 2.6, 0.06), (-3.4, 0, 1.45), M['air'], bevel=0.01)
    for s in (-1, 1): prism(f'Seitenleitwerk{s}', [(-3.8, 1.2), (-3.0, 1.2), (-3.3, 2.3), (-3.8, 2.3)], 0.05, M['air'], y=s * 1.3)

# Flugzeuge liegen mittig über dem Ankerpunkt; der Fahrwerk-Bezug: Ursprung = Boden unter dem Rumpf

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

def cruiser(M, T):
    hull('Kreuzer', 28.0, 3.9, 1.7, M, bow=0.3)
    block('Aufbau', -4.0, -1.4, 1.76, 5.5, 1.4, 3.0, M['navy'], bevel=0.05)
    block('Bruecke', 3.0, -1.1, 3.0, 5.2, 1.1, 4.4, M['navy'], bevel=0.04)
    box('Brueckenfenster', (0.06, 2.0, 0.35), (5.22, 0, 4.1), M['glass'], bevel=0)
    cyl('Schornstein', 0.75, 3.0, (-0.6, 0, 4.3), M['navy'], verts=24, bevel=0.03).scale = (1.5, 1, 1)
    cyl('Kappe', 0.7, 0.18, (-0.6, 0, 5.85), M['black'], verts=24).scale = (1.5, 1, 1)
    naval_turret('Turm_A', 10.0, 1.76, M, 3, 1.2); naval_turret('Turm_B', 7.6, 3.0, M, 3, 1.2)
    naval_turret('Turm_C', -7.6, 1.76, M, 3, 1.2, facing=math.pi); naval_turret('Turm_D', -10.2, 1.76, M, 3, 1.2, facing=math.pi)
    # Raketenstarter mittschiffs
    for s in (-1, 1):
        o = box(f'Starter{s}', (2.2, 0.9, 0.7), (-2.6, s * 1.15, 3.4), M['navy_d'], rot=(0, math.radians(-20), 0), bevel=0.04)
        for k in range(3): cyl(f'Rakete{s}{k}', 0.1, 1.6, (-1.7, s * (0.9 + k * 0.25), 3.75), M['white'], rot=(0, math.radians(70), 0), verts=10)
    line_cyl('Mast', (2.0, 0, 4.4), (2.0, 0, 9.0), 0.1, M['steel']); line_cyl('Rah', (2.0, -1.3, 8.0), (2.0, 1.3, 8.0), 0.05, M['steel'])
    o = sphere('Radar', 0.6, (2.0, 0, 9.2), M['navy_d'], seg=16); o.scale = (0.3, 1, 0.6)

# Name: (Bau, Turm-Bau oder None, Richtungen, Reihen, Bildbreite, -höhe, Anker x, Anker y, Schatten, Höhe über Grund)
UNITS = {
    'schwerer_panzer': (tiger, tiger_turret, 16, 1, 140, 100, 70, 62, True, 0),
    'spaehpanzer': (puma, puma_turret, 16, 1, 112, 84, 56, 54, True, 0),
    'artillerie': (wespe, wespe_turret, 16, 1, 112, 84, 56, 54, True, 0),
    'schuetze': ('schuetze', None, 8, 3, 40, 48, 20, 40, True, 0),
    'raketentrupp': ('raketentrupp', None, 8, 3, 40, 48, 20, 40, True, 0),
    'miliz': ('miliz', None, 8, 3, 40, 48, 20, 40, True, 0),
    'kampfhubschrauber': (heli, None, 16, 1, 120, 90, 60, 66, False, 0),
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
