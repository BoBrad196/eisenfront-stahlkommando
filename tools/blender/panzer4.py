# Panzer IV Ausf. D (1940) – kurze 7,5-cm-Kanone L/24, ohne Schürzen, Panzergrau – detailliertes prozedurales Modell.
# Aufruf: python panzer_foto.py <ausgabeordner> <modus>   (modus: vorschau | spiel | nah)
import bpy, bmesh, math, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mathutils import Vector, noise

OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
MODE = sys.argv[2] if len(sys.argv) > 2 else 'vorschau'
bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
TANK = bpy.data.objects.new('Panzer', None); S.collection.objects.link(TANK)
TURRET = bpy.data.objects.new('Turm', None); S.collection.objects.link(TURRET); TURRET.parent = TANK
PARENT = TANK  # aktuelles Elternobjekt (Wanne oder Turm)

# ======================= Materialien =======================
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree
    return m, nt, nt.nodes['Principled BSDF']

def node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k in n.inputs.keys(): n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n

def L(nt, a, b): nt.links.new(a, b)

def mix(nt, fac, a, b, blend='MIX'):
    m = node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type=blend)
    for src, dst in ((fac, 'Factor'), (a, 'A'), (b, 'B')):
        if isinstance(src, (int, float)): m.inputs[dst].default_value = src
        elif isinstance(src, tuple): m.inputs[dst].default_value = src
        else: L(nt, src, m.inputs[dst])
    return m.outputs['Result']

def mixf(nt, fac, a, b):
    m = node(nt, 'ShaderNodeMix', data_type='FLOAT')
    for src, dst in ((fac, 'Factor'), (a, 'A'), (b, 'B')):
        if isinstance(src, (int, float)): m.inputs[dst].default_value = src
        else: L(nt, src, m.inputs[dst])
    return m.outputs['Result']

def ramp(nt, src, stops, interp='LINEAR'):
    r = node(nt, 'ShaderNodeValToRGB'); r.color_ramp.interpolation = interp
    els = r.color_ramp.elements
    while len(els) < len(stops): els.new(0.5)
    for e, (p, c) in zip(els, stops):
        e.position = p; e.color = c if len(c) == 4 else (*c, 1)
    L(nt, src, r.inputs['Fac'])
    return r.outputs['Color']

def noise_tex(nt, vec, scale, detail=4, rough=0.55, dist=0.0):
    n = node(nt, 'ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough; n.inputs['Distortion'].default_value = dist
    L(nt, vec, n.inputs['Vector'])
    return n

def maprange(nt, src, a, b, c=0.0, d=1.0):
    m = node(nt, 'ShaderNodeMapRange'); m.inputs['From Min'].default_value = a; m.inputs['From Max'].default_value = b
    m.inputs['To Min'].default_value = c; m.inputs['To Max'].default_value = d
    L(nt, src, m.inputs['Value'])
    return m.outputs['Result']

def math_op(nt, op, a, b=None):
    m = node(nt, 'ShaderNodeMath', operation=op)
    for i, s in enumerate((a, b)):
        if s is None: continue
        if isinstance(s, (int, float)): m.inputs[i].default_value = s
        else: L(nt, s, m.inputs[i])
    return m.outputs['Value']

import eflib as _E
_E.REF = TANK
WEAR = dict(wear=0.85, rust=0.55, fade=0.3, scratch=0.6, oil=0.45, mud_h=2.3, mud_col=(0.11, 0.085, 0.055), grime=0.55, dust_amt=0.75)

def weathering(nt, base_col, base_rough, zimmerit=False, chips=True, edge_metal=(0.09, 0.085, 0.08)):
    """Abnutzung wie bei den übrigen Einheiten (eflib, Stil 1940)"""
    _E.weathering(nt, base_col, base_rough, chips=chips, zimmerit=zimmerit, metal_edge=edge_metal, **WEAR)

def camo_paint(name, zimmerit=False):
    m, nt, bsdf = mat(name)
    tc = node(nt, 'ShaderNodeTexCoord', object=TANK)
    obj = tc.outputs['Object']
    # Gespritzte Tarnung: weiche Kanten
    c1 = noise_tex(nt, obj, 0.42, 3, 0.5, 0.6)
    base = ramp(nt, c1.outputs['Fac'], [(0.5, (0.27, 0.21, 0.105)), (0.535, (0.10, 0.12, 0.055))])
    c2 = noise_tex(nt, obj, 0.6, 3, 0.5, 0.8)
    brown = maprange(nt, c2.outputs['Fac'], 0.57, 0.6)
    col = mix(nt, brown, base, (0.16, 0.085, 0.045, 1))
    weathering(nt, col, 0.72, zimmerit)
    return m

def simple(name, color, rough, metal=0.0, weather=True, chips=False):
    m, nt, bsdf = mat(name)
    bsdf.inputs['Metallic'].default_value = metal
    if weather: weathering(nt, (*color, 1), rough, chips=chips)
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1); bsdf.inputs['Roughness'].default_value = rough
    return m

def track_steel():
    m, nt, bsdf = mat('Kettenstahl')
    tc = node(nt, 'ShaderNodeTexCoord', object=TANK)
    rust = noise_tex(nt, tc.outputs['Object'], 14, 8)
    col = ramp(nt, rust.outputs['Fac'], [(0.35, (0.07, 0.06, 0.05)), (0.65, (0.2, 0.1, 0.045))])
    bsdf.inputs['Metallic'].default_value = 0.6
    weathering(nt, col, 0.7, chips=True, edge_metal=(0.32, 0.31, 0.3))
    return m

def grey_paint(name):
    """Panzergrau (RAL 7021), wie 1940 üblich – Tarnanstrich und Zimmerit kamen erst 1943"""
    m, nt, bsdf = mat(name)
    tc = node(nt, 'ShaderNodeTexCoord', object=TANK)
    n = noise_tex(nt, tc.outputs['Object'], 0.8, 3, 0.5)
    col = ramp(nt, n.outputs['Fac'], [(0.3, (0.027, 0.031, 0.034)), (0.7, (0.034, 0.038, 0.041))])
    _E.weathering(nt, col, 0.7, chips=True, zimmerit=False, metal_edge=(0.09, 0.085, 0.08), **dict(WEAR, dust_amt=0.16, fade=0.1, mud_h=1.9))
    return m

PAINT = grey_paint('Panzergrau')
ZIMM = PAINT
STEEL = simple('Stahl', (0.06, 0.055, 0.05), 0.5, 0.7, chips=True)
TRACK = track_steel()
RUBBER = simple('Gummi', (0.035, 0.033, 0.03), 0.85)
RUST = simple('Auspuff', (0.22, 0.09, 0.035), 0.9)
WOOD = simple('Holz', (0.25, 0.15, 0.07), 0.8)
JERRY = simple('Kanister', (0.13, 0.15, 0.08), 0.6, chips=True)
GLASS = simple('Glas', (0.03, 0.04, 0.04), 0.08, 0.2, weather=False)
WHITE = simple('Kennung', (0.75, 0.72, 0.66), 0.7)

# ======================= Geometrie-Helfer =======================
def finish(o, m, bevel=0.0, seg=3):
    S.collection.objects.link(o) if o.name not in S.collection.objects else None
    o.parent = PARENT
    if m: o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = seg; b.limit_method = 'ANGLE'; b.harden_normals = True
    else:
        o.modifiers.new('ws', 'WEIGHTED_NORMAL').keep_sharp = True
    return o

def frustum(name, size, loc, top=(1, 1), shift=(0, 0), m=PAINT, bevel=0.025, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
        if v.co.z > 0: v.co.x = v.co.x * top[0] + shift[0]; v.co.y = v.co.y * top[1] + shift[1]
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; o.rotation_euler = rot
    return finish(o, m, bevel)

def box(name, size, loc, m=PAINT, rot=(0, 0, 0), bevel=0.012):
    return frustum(name, size, loc, m=m, bevel=bevel, rot=rot)

def prism(name, pts_xz, width, y=0.0, m=PAINT, bevel=0.025):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    a = [bm.verts.new((x, -width / 2, z)) for x, z in pts_xz]
    b = [bm.verts.new((x, width / 2, z)) for x, z in pts_xz]
    n = len(a)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = (0, y, 0)
    return finish(o, m, bevel)

def cyl(name, r, depth, loc, rot=(0, 0, 0), m=PAINT, verts=32, bevel=0.0, r2=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r2 if r2 is not None else r, depth=depth)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; o.rotation_euler = rot
    return finish(o, m, bevel, 2)

def weld(name, a, b, r=0.014):
    a, b = Vector(a), Vector(b); d = b - a
    o = cyl(name, r, d.length, (a + b) / 2, m=PAINT, verts=8)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    # unregelmäßige Schweißraupe
    dis = o.modifiers.new('d', 'DISPLACE'); tex = bpy.data.textures.new(name, 'CLOUDS'); tex.noise_scale = 0.02; dis.texture = tex; dis.strength = 0.012
    return o

def bolts(prefix, pts, normal_rot, r=0.022, h=0.025, m=STEEL):
    for i, p in enumerate(pts): cyl(f'{prefix}{i}', r, h, p, rot=normal_rot, m=m, verts=6)

RX = (math.radians(90), 0, 0)   # Zylinderachse entlang y
RY = (0, math.radians(90), 0)   # Zylinderachse entlang x

# ======================= Wanne =======================
prism('Unterwanne', [(-2.75, 0.62), (2.25, 0.62), (2.72, 0.95), (2.72, 1.24), (-2.86, 1.24), (-2.86, 0.86)], 1.95)
frustum('Aufbau', (4.25, 2.86, 0.56), (-0.47, 0, 1.52), top=(0.995, 0.985), m=ZIMM)
frustum('Fahrerfront', (0.5, 2.0, 0.56), (1.72, 0, 1.52), top=(0.92, 1.0), shift=(-0.02, 0), m=ZIMM)
prism('Bugschraege', [(1.95, 1.24), (2.72, 1.24), (2.72, 1.3), (1.95, 1.62)], 1.95, m=ZIMM)
frustum('Motordeck', (1.95, 2.55, 0.1), (-1.78, 0, 1.85), top=(0.97, 0.97))
for i in range(2):
    box(f'Lueftergitter{i}', (0.55, 0.75, 0.03), (-1.4 - i * 0.75, 0.55 - i * 1.1, 1.915), m=STEEL, bevel=0.006)
    for k in range(8): box(f'Rippe{i}{k}', (0.02, 0.72, 0.02), (-1.65 - i * 0.75 + k * 0.07, 0.55 - i * 1.1, 1.935), m=STEEL, bevel=0)
box('Heckplatte', (0.06, 2.0, 0.5), (-2.9, 0, 1.0), bevel=0.01)
for s in (-1, 1):
    box(f'Kotfluegel{s}', (5.55, 0.5, 0.03), (-0.08, s * 1.2, 1.255), bevel=0.006)
    box(f'Kotfluegel_vorn{s}', (0.4, 0.5, 0.03), (2.82, s * 1.2, 1.17), rot=(0, math.radians(24), 0), bevel=0.006)
    box(f'Kotfluegel_hinten{s}', (0.3, 0.5, 0.03), (-2.95, s * 1.2, 1.18), rot=(0, math.radians(-30), 0), bevel=0.006)
# Schweißnähte an den Kanten des Aufbaus
weld('Naht1', (1.98, -1.0, 1.8), (1.98, 1.0, 1.8))
weld('Naht2', (1.48, -1.4, 1.8), (1.48, 1.4, 1.8))
weld('Naht3', (-2.58, -1.43, 1.8), (1.45, -1.43, 1.8))
weld('Naht4', (2.72, -0.97, 1.25), (2.72, 0.97, 1.25))
# Fahrersichtklappe, Bug-MG, Bolzen
box('Sehklappe', (0.08, 0.36, 0.11), (2.0, 0.55, 1.57), m=STEEL, bevel=0.012)
box('Sehschlitz', (0.02, 0.24, 0.025), (2.045, 0.55, 1.585), m=GLASS, bevel=0)
cyl('MG_Kugel', 0.12, 0.1, (2.0, -0.5, 1.54), rot=RY, m=PAINT, bevel=0.02)
cyl('Bug_MG', 0.019, 0.38, (2.2, -0.5, 1.54), rot=RY, m=STEEL, verts=10)
bolts('Bugbolzen', [(2.73, -0.9 + i * 0.2, 1.23) for i in range(10)], RY)
# Ersatzkettenglieder auf der Bugplatte
for i in range(6): box(f'Ersatzglied{i}', (0.05, 0.13, 0.25), (2.745, -0.85 + i * 0.34, 1.08), m=TRACK, bevel=0.006)
box('Halter', (0.03, 2.0, 0.04), (2.77, 0, 1.12), m=STEEL, bevel=0)
# Scheinwerfer mit Tarnkappe
cyl('Scheinwerfer', 0.075, 0.13, (2.35, 0.95, 1.38), rot=RY, m=STEEL, bevel=0.01)
box('Notek', (0.12, 0.08, 0.06), (2.45, -0.95, 1.33), m=STEEL)
# Auspuff, Heckdetails
cyl('Auspuff', 0.14, 0.8, (-3.02, 0.42, 1.02), rot=RX, m=RUST, bevel=0.02)
cyl('Auspuffrohr', 0.045, 0.25, (-3.02, 0.9, 1.1), rot=RX, m=RUST)
cyl('Hilfsauspuff', 0.08, 0.5, (-3.0, -0.62, 1.07), rot=RX, m=RUST)
box('Kiste', (0.72, 0.46, 0.32), (-2.25, 0.82, 2.06), bevel=0.02)
for i in range(3): box(f'Kanister{i}', (0.17, 0.36, 0.48), (-2.55, -1.0 + i * 0.21, 1.98), m=JERRY, rot=RX, bevel=0.02)
# Werkzeug auf den Kotflügeln
for s in (-1, 1):
    y = s * 1.3
    cyl(f'Abschleppseil{s}', 0.028, 3.2, (-0.6, y, 1.3), rot=RY, m=STEEL, verts=8)
    cyl(f'Spatenstiel{s}', 0.02, 1.0, (0.9, y - s * 0.08, 1.3), rot=RY, m=WOOD, verts=8)
    box(f'Spatenblatt{s}', (0.28, 0.2, 0.02), (1.5, y - s * 0.08, 1.3), m=STEEL, bevel=0.005)
    cyl(f'Axtstiel{s}', 0.02, 0.8, (-1.8, y - s * 0.1, 1.3), rot=RY, m=WOOD, verts=8)
    box(f'Axtkopf{s}', (0.08, 0.04, 0.2), (-1.38, y - s * 0.1, 1.32), m=STEEL)
    for k in range(4): box(f'Halteband{s}{k}', (0.03, 0.12, 0.05), (-1.6 + k * 0.9, y, 1.31), m=STEEL, bevel=0)
cyl('Wagenheber', 0.065, 0.5, (-1.0, -1.08, 1.84), rot=RY, m=STEEL, bevel=0.01)

# ======================= Turm =======================
PARENT = TURRET
TX = 0.15
frustum('Turmkoerper', (2.2, 1.95, 0.74), (TX, 0, 2.17), top=(0.86, 0.8), shift=(0.02, 0), m=ZIMM)
frustum('Turmdach', (1.85, 1.52, 0.04), (TX + 0.02, 0, 2.555), top=(0.98, 0.98))
weld('NahtT1', (TX + 0.9, -0.6, 2.54), (TX + 0.9, 0.6, 2.54))
# Seitenluken am Turm
for s in (-1, 1):
    box(f'Seitenluke{s}', (0.5, 0.04, 0.42), (TX - 0.05, s * 0.86, 2.2), rot=(s * math.radians(-12), 0, 0), bevel=0.012)
    box(f'Sehklappe_T{s}', (0.16, 0.04, 0.06), (TX + 0.55, s * 0.9, 2.28), rot=(s * math.radians(-12), 0, 0), m=STEEL, bevel=0.006)
# Kommandantenkuppel mit Winkelspiegeln und Luken
cyl('Kuppel', 0.34, 0.27, (TX - 0.55, 0.0, 2.7), m=PAINT, verts=40, bevel=0.02)
cyl('Kuppelring', 0.37, 0.05, (TX - 0.55, 0.0, 2.6), m=PAINT, verts=40, bevel=0.01)
for k in range(7):
    a = math.radians(-90 + k * 30)
    box(f'Winkelspiegel{k}', (0.05, 0.13, 0.08), (TX - 0.55 + math.cos(a) * 0.34, math.sin(a) * 0.34, 2.73), m=GLASS, rot=(0, 0, a), bevel=0)
cyl('Kuppeldeckel', 0.31, 0.045, (TX - 0.55, 0.0, 2.86), m=PAINT, verts=40, bevel=0.012)
cyl('Fliegerbeschussring', 0.012, 0.75, (TX - 0.55, 0, 2.92), rot=RY, m=STEEL, verts=6)
box('Ladeluke', (0.42, 0.38, 0.045), (TX + 0.35, 0.42, 2.595), bevel=0.012)
cyl('Luefter', 0.12, 0.08, (TX + 0.55, -0.35, 2.6), m=PAINT, bevel=0.01)
# Blende und 7,5-cm-Kanone
frustum('Blende', (0.46, 0.9, 0.52), (TX + 1.2, 0, 2.17), top=(0.78, 0.9), bevel=0.05)
bolts('Blendenbolzen', [(TX + 1.43, -0.3 + k * 0.2, 2.35) for k in range(4)], RY, r=0.025)
cyl('Rohrwiege', 0.14, 0.55, (TX + 1.6, 0, 2.18), rot=RY, bevel=0.015)
# kurze 7,5-cm-KwK 37 L/24 ohne Mündungsbremse
cyl('Rohr', 0.085, 1.75, (TX + 2.42, 0, 2.18), rot=RY, verts=28, r2=0.078)
cyl('Muendung', 0.095, 0.08, (TX + 3.27, 0, 2.18), rot=RY, verts=28, bevel=0.01)
cyl('Koax_MG', 0.018, 0.25, (TX + 1.5, 0.28, 2.1), rot=RY, m=STEEL, verts=8)
# Turmnummer an den Turmseiten
for s in (-1, 1):
    bpy.ops.object.text_add(location=(TX - 0.45, s * 0.905, 2.2), rotation=(math.radians(90 - s * 12), 0, 0 if s < 0 else math.pi))
    t = bpy.context.object; t.data.body = '421'; t.data.size = 0.3; t.data.align_x = 'CENTER'; t.data.align_y = 'CENTER'
    t.data.extrude = 0.003; t.parent = TURRET; t.data.materials.append(WHITE)
PARENT = TANK
cyl('Antenne', 0.008, 2.0, (-2.4, -1.15, 2.85), rot=(math.radians(-8), math.radians(-6), 0), m=STEEL, verts=6)
cyl('Antennenfuss', 0.05, 0.12, (-2.4, -1.15, 1.9), m=STEEL)

# ======================= Laufwerk =======================
WZ, WR = 0.42, 0.235
def road_wheel(name, x, y, s, outer):
    cyl(f'{name}_reifen', WR, 0.085, (x, y, WZ), rot=RX, m=RUBBER, verts=40, bevel=0.025)
    cyl(f'{name}_scheibe', WR - 0.045, 0.1, (x, y, WZ), rot=RX, m=PAINT, verts=40, bevel=0.012)
    if outer:
        cyl(f'{name}_nabe', 0.075, 0.15, (x, y, WZ), rot=RX, m=PAINT, verts=20, bevel=0.012)
        for k in range(8):
            a = k * math.pi / 4
            cyl(f'{name}_mutter{k}', 0.014, 0.02, (x + math.cos(a) * 0.12, y + s * 0.055, WZ + math.sin(a) * 0.12), rot=RX, m=STEEL, verts=6)

for s in (-1, 1):
    y = s * 1.2
    for i in range(8):
        x = -1.92 + i * 0.52 + (0.06 if i % 2 else -0.06)
        road_wheel(f'Rolle{s}{i}a', x, y + s * 0.07, s, True)
        road_wheel(f'Rolle{s}{i}b', x, y - s * 0.07, s, False)
    for i in range(4):
        box(f'Schwinge{s}{i}', (0.7, 0.06, 0.14), (-1.66 + i * 1.04, y - s * 0.17, 0.55), m=PAINT, bevel=0.02)
        cyl(f'Stuetzrolle{s}{i}', 0.09, 0.15, (-1.6 + i * 1.05, y, 1.02), rot=RX, m=RUBBER, verts=20, bevel=0.015)
    cyl(f'Treibrad{s}', 0.3, 0.22, (2.42, y, 0.78), rot=RX, m=PAINT, verts=32, bevel=0.02)
    for k in range(20):
        a = k * math.pi / 10
        box(f'Zahn{s}{k}', (0.07, 0.2, 0.06), (2.42 + math.cos(a) * 0.33, y, 0.78 + math.sin(a) * 0.33), m=STEEL, rot=(0, -a, 0), bevel=0.01)
    cyl(f'Treibnabe{s}', 0.12, 0.3, (2.42, y, 0.78), rot=RX, m=PAINT, verts=20, bevel=0.02)
    cyl(f'Leitrad{s}', 0.29, 0.18, (-2.62, y, 0.68), rot=RX, m=PAINT, verts=32, bevel=0.02)
    for k in range(6):
        a = k * math.pi / 3
        cyl(f'Speiche{s}{k}', 0.05, 0.2, (-2.62 + math.cos(a) * 0.17, y, 0.68 + math.sin(a) * 0.17), rot=RX, m=STEEL, verts=12)

def track(s):
    y = s * 1.2
    cd = bpy.data.curves.new(f'Kettenweg{s}', 'CURVE'); cd.dimensions = '3D'
    pts = [(2.42, 0, 1.15), (2.76, 0, 0.78), (2.42, 0, 0.42), (2.1, 0, 0.19), (-1.9, 0, 0.175), (-2.35, 0, 0.3), (-2.93, 0, 0.68),
           (-2.62, 0, 0.99), (-1.6, 0, 1.12), (0.5, 0, 1.135), (1.6, 0, 1.13)]
    sp = cd.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1); sp.use_cyclic_u = True
    for bp, p in zip(sp.bezier_points, pts): bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    co = bpy.data.objects.new(f'Kettenweg{s}', cd); co.location = (0, y, 0); S.collection.objects.link(co); co.parent = TANK
    # Kettenglied: Platte, Stollen auf beiden Seiten, Führungszahn in der Mitte
    me = bpy.data.meshes.new(f'Glied{s}'); bm = bmesh.new()
    def cube(sx, sy, sz, ox=0, oy=0, oz=0):
        r = bmesh.ops.create_cube(bm, size=1)
        for v in r['verts']: v.co.x = v.co.x * sx + ox; v.co.y = v.co.y * sy + oy; v.co.z = v.co.z * sz + oz
    cube(0.12, 0.42, 0.03)
    cube(0.03, 0.4, 0.025, 0.02, 0, 0.025); cube(0.03, 0.4, 0.025, 0.02, 0, -0.025)
    cube(0.07, 0.05, 0.06, 0, 0, 0.04)
    cube(0.02, 0.44, 0.03, -0.055, 0, 0)  # Gelenkbolzen
    bm.to_mesh(me); bm.free()
    g = bpy.data.objects.new(f'Kette{s}', me); g.location = (0, y, 0); S.collection.objects.link(g); g.parent = TANK
    g.data.materials.append(TRACK)
    arr = g.modifiers.new('arr', 'ARRAY'); arr.fit_type = 'FIT_CURVE'; arr.curve = co; arr.relative_offset_displace = (1.08, 0, 0)
    cm = g.modifiers.new('curve', 'CURVE'); cm.object = co; cm.deform_axis = 'POS_X'
    b = g.modifiers.new('bevel', 'BEVEL'); b.width = 0.006; b.segments = 2
for s in (-1, 1): track(s)


# ======================= Licht, Himmel, Kamera =======================
w = bpy.data.worlds.new('Welt'); S.world = w; w.use_nodes = True
wn = w.node_tree
sky = wn.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'
sky.sun_disc = False; sky.sun_elevation = math.radians(38); sky.sun_rotation = math.radians(200)
wn.links.new(sky.outputs['Color'], wn.nodes['Background'].inputs['Color'])
wn.nodes['Background'].inputs['Strength'].default_value = 0.09
sun = bpy.data.lights.new('Sonne', 'SUN'); sun.energy = 5.5; sun.color = (1.0, 0.93, 0.82); sun.angle = math.radians(1.2)
so = bpy.data.objects.new('Sonne', sun); S.collection.objects.link(so)
so.rotation_euler = (math.radians(52), 0, math.radians(-110))

cam = bpy.data.cameras.new('Kamera'); cam.type = 'ORTHO'
camo = bpy.data.objects.new('Kamera', cam); S.collection.objects.link(camo); S.camera = camo
camo.rotation_euler = (math.radians(60), 0, math.radians(45))
S.render.engine = 'CYCLES'; S.cycles.device = 'CPU'; S.cycles.use_denoising = True
S.cycles.max_bounces = 6
S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'

# ======================= Boden (nur Vorschau) =======================
def ground_preview(rot_deg):
    n = 260; size = 26.0
    me = bpy.data.meshes.new('Boden'); bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=n, y_segments=n, size=size / 2)
    ca, sa = math.cos(math.radians(rot_deg)), math.sin(math.radians(rot_deg))
    grass_w = []
    for v in bm.verts:
        x, y = v.co.x, v.co.y
        u = x * ca + y * sa; lat = -x * sa + y * ca          # Koordinaten in Fahrtrichtung des Panzers
        z = noise.fractal(Vector((x * 0.6, y * 0.6, 0)), 0.5, 2.0, 5) * 0.04 + noise.noise(Vector((x * 4, y * 4, 3))) * 0.008
        rut = 0.0
        if u < 2.9:  # Spuren hinter und unter dem Panzer
            for c in (-1.2, 1.2):
                d = abs(lat - c)
                rut += -0.07 * max(0.0, 1 - (d / 0.24) ** 2) + 0.025 * math.exp(-((d - 0.32) / 0.08) ** 2)
            rut *= min(1.0, (2.9 - u) / 0.5)
        z += rut
        v.co.z = z
        track_mask = 1.0 if (u < 2.9 and min(abs(lat - 1.2), abs(lat + 1.2)) < 0.45) else 0.0
        patch = noise.noise(Vector((x * 0.25, y * 0.25, 7)))
        grass_w.append(max(0.0, min(1.0, 0.95 + patch * 1.4)) * (1 - track_mask))
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('Boden', me); S.collection.objects.link(o)
    for p in me.polygons: p.use_smooth = True
    vg = o.vertex_groups.new(name='gras')
    for i, wv in enumerate(grass_w): vg.add([i], wv, 'REPLACE')
    # Erdmaterial: trockene Erde, feuchte Spurrinnen, Steinchen
    m, nt, bsdf = mat('Erde')
    tc = node(nt, 'ShaderNodeTexCoord'); ob = tc.outputs['Object']
    sep = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, ob, sep.inputs['Vector'])
    col = ramp(nt, noise_tex(nt, ob, 1.2, 10, 0.6).outputs['Fac'], [(0.35, (0.15, 0.11, 0.07)), (0.65, (0.27, 0.21, 0.13))])
    col = mix(nt, 0.4, col, noise_tex(nt, ob, 40, 10).outputs['Color'], 'OVERLAY')
    vo = node(nt, 'ShaderNodeTexVoronoi'); vo.inputs['Scale'].default_value = 55; L(nt, ob, vo.inputs['Vector'])
    pebble = maprange(nt, vo.outputs['Distance'], 0.12, 0.05)
    pm = math_op(nt, 'MULTIPLY', pebble, maprange(nt, noise_tex(nt, ob, 3, 4).outputs['Fac'], 0.45, 0.65))
    col = mix(nt, pm, col, (0.45, 0.42, 0.37, 1))
    wet = maprange(nt, sep.outputs['Z'], -0.02, -0.06)
    col = mix(nt, math_op(nt, 'MULTIPLY', wet, 0.7), col, (0.09, 0.07, 0.045, 1))
    L(nt, col, bsdf.inputs['Base Color']); L(nt, mixf(nt, wet, 0.95, 0.62), bsdf.inputs['Roughness'])
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.01
    L(nt, math_op(nt, 'ADD', noise_tex(nt, ob, 30, 12).outputs['Fac'], math_op(nt, 'MULTIPLY', pebble, 0.6)), bp.inputs['Height'])
    L(nt, bp.outputs['Normal'], bsdf.inputs['Normal'])
    o.data.materials.append(m)
    # Gras als Haare
    ps = o.modifiers.new('gras', 'PARTICLE_SYSTEM').particle_system
    st = ps.settings
    st.type = 'HAIR'; st.count = 240000; st.hair_length = 0.085; ps.vertex_group_density = 'gras'; ps.vertex_group_length = 'gras'
    st.use_advanced_hair = False
    st.child_type = 'SIMPLE'; st.rendered_child_count = 7; st.child_percent = 2; st.child_radius = 0.06; st.child_length = 1.0; st.roughness_1 = 0.02; st.roughness_endpoint = 0.04; st.kink = 'NO'
    st.root_radius = 1.0; st.tip_radius = 0.0; st.radius_scale = 0.0035
    st.material = 2
    gm, gnt, gb = mat('Gras')
    hi = node(gnt, 'ShaderNodeHairInfo')
    gcol = ramp(gnt, hi.outputs['Random'], [(0.0, (0.07, 0.13, 0.025)), (0.55, (0.13, 0.2, 0.045)), (0.85, (0.22, 0.24, 0.08)), (1.0, (0.34, 0.3, 0.14))])
    tip = mix(gnt, hi.outputs['Intercept'], (0.05, 0.07, 0.02, 1), gcol)
    L(gnt, tip, gb.inputs['Base Color']); gb.inputs['Roughness'].default_value = 0.6
    gb.inputs['Subsurface Weight'].default_value = 0.0
    o.data.materials.append(gm)
    S.cycles_curves.shape = 'RIBBONS' if hasattr(S, 'cycles_curves') else None
    return o

def aim(target, scale, res):
    cam.ortho_scale = scale
    S.render.resolution_x, S.render.resolution_y = res
    fwd = camo.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
    camo.location = Vector(target) - fwd * 40

def shoot(path, samples, transparent):
    S.cycles.samples = samples; S.render.film_transparent = transparent
    S.render.filepath = path
    bpy.ops.render.render(write_still=True)

if MODE == 'vorschau':
    rot = 200
    TANK.rotation_euler = (0, 0, math.radians(rot))
    ground_preview(rot)
    aim((0.9, 0, 1.1), 11, (1600, 1030))
    shoot(os.path.join(OUT, 'panzer_foto.png'), int(os.environ.get('SAMPLES', 160)), False)
elif MODE == 'nah':
    rot = 200
    TANK.rotation_euler = (0, 0, math.radians(rot))
    ground_preview(rot)
    aim((-0.3, 0.3, 1.3), 5.2, (1200, 900))
    shoot(os.path.join(OUT, 'panzer_nah.png'), int(os.environ.get('SAMPLES', 160)), False)
elif MODE == 'spiel':
    bpy.ops.mesh.primitive_plane_add(size=60); bpy.context.object.is_shadow_catcher = True
    for i, rot in enumerate([200, 290, 20, 110, 155, 245]):
        TANK.rotation_euler = (0, 0, math.radians(rot))
        aim((0, 0, 1.0), 8.2, (220, 220))
        shoot(os.path.join(OUT, f'foto_klein_{i}.png'), 64, True)
elif MODE == 'sprite':
    # Spritesheets fürs Spiel: 16 Richtungen, Wanne (mit Schatten) und Turm getrennt, doppelte Auflösung.
    # Maßstab: 1 Kachel = 5,6 m; Kachel-Diagonale 64 px -> 45,25 px je Kachelseite -> 8,08 px/m (x2 = 16,16)
    PXM = 2 * 45.25 / 5.6
    FW, FH, AX, AY = 120, 90, 60, 58          # logisches Einzelbild und Ankerpunkt (Bodenpunkt)
    so.rotation_euler = (math.radians(50), 0, math.radians(-90))   # Licht von links oben wie im Spiel
    sky.sun_rotation = math.radians(180)
    bpy.ops.mesh.primitive_plane_add(size=60); plane = bpy.context.object; plane.is_shadow_catcher = True
    S.render.resolution_x, S.render.resolution_y = FW * 2, FH * 2
    cam.ortho_scale = FW * 2 / PXM
    cam.shift_y = (AY - FH / 2) * 2 / (FW * 2)     # Ursprung liegt AY px unter der Oberkante
    fwd = camo.rotation_euler.to_quaternion() @ Vector((0, 0, -1))
    camo.location = Vector((0, 0, 0)) - fwd * 40
    turret_objs = set(TURRET.children_recursive)
    hull_objs = [o for o in TANK.children_recursive if o not in turret_objs and o.type != 'EMPTY']
    samples = int(os.environ.get('SAMPLES', 48))
    for part in ('wanne', 'turm'):
        for o in turret_objs: o.visible_camera = part == 'turm'; o.hide_render = False
        for o in hull_objs: o.hide_render = part == 'turm'
        plane.hide_render = part == 'turm'
        for f in range(16):
            TANK.rotation_euler = (0, 0, -f * math.pi / 8)   # Bild 0 = Südost, dann im Uhrzeigersinn
            shoot(os.path.join(OUT, f'{part}_{f:02d}.png'), samples, True)
