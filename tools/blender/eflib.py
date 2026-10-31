# Gemeinsame Blender-Bibliothek für die Eisenfront-Grafiken:
# Szene, Licht und Kamera passend zum Spielraster, Materialien mit Alterung, Bauformen und Render-Funktionen.
#
# Maßstab: 1 Spielkachel = 5,6 m. Kachelraute 64×32 px (logisch); gerendert wird in doppelter Auflösung.
import bpy, bmesh, math, os
from mathutils import Vector

TILE_M = 5.6
PXM = 2 * 45.25 / TILE_M            # Pixel je Meter in doppelter Auflösung
CAM_ROT = (math.radians(60), 0, math.radians(45))
RIGHT = Vector((0.7071, 0.7071, 0))
UP = Vector((-0.3536, 0.3536, 0.8660))
FWD = Vector((-0.6124, 0.6124, -0.5))

S = None
REF = None   # Bezugsobjekt für Texturkoordinaten (damit Muster über alle Teile laufen)
PARENT = None

def reset(ref_name='Modell'):
    global S, REF, PARENT
    bpy.ops.wm.read_factory_settings(use_empty=True)
    S = bpy.context.scene
    REF = bpy.data.objects.new(ref_name, None); S.collection.objects.link(REF)
    PARENT = REF
    w = bpy.data.worlds.new('Welt'); S.world = w; w.use_nodes = True
    wn = w.node_tree
    sky = wn.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'; sky.sun_disc = False
    sky.sun_elevation = math.radians(40); sky.sun_rotation = math.radians(180)
    wn.links.new(sky.outputs['Color'], wn.nodes['Background'].inputs['Color'])
    wn.nodes['Background'].inputs['Strength'].default_value = 0.09
    sun = bpy.data.lights.new('Sonne', 'SUN'); sun.energy = 4.6; sun.color = (1.0, 0.93, 0.82); sun.angle = math.radians(1.5)
    so = bpy.data.objects.new('Sonne', sun); S.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(-90))   # Licht von links oben im Bild
    cam = bpy.data.cameras.new('Kamera'); cam.type = 'ORTHO'
    co = bpy.data.objects.new('Kamera', cam); S.collection.objects.link(co); S.camera = co
    co.rotation_euler = CAM_ROT
    S.render.engine = 'CYCLES'; S.cycles.device = 'CPU'; S.cycles.use_denoising = True; S.cycles.max_bounces = 6
    S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'
    S.render.film_transparent = True
    return REF

def set_parent(p):
    global PARENT
    PARENT = p

def empty(name, parent=None):
    o = bpy.data.objects.new(name, None); S.collection.objects.link(o); o.parent = parent or REF
    return o

# ======================= Kamera / Rendern =======================
def frame_camera(wpx, hpx, point, ax, ay):
    """Kamera so setzen, dass der Weltpunkt `point` im Bild (wpx×hpx, doppelte Auflösung) bei (ax, ay) liegt."""
    cam = S.camera
    cam.data.ortho_scale = max(wpx, hpx) / PXM
    S.render.resolution_x, S.render.resolution_y = wpx, hpx
    # Bei Hochformat bezieht sich ortho_scale auf die Höhe
    P = Vector(point)
    c = P - RIGHT * ((ax - wpx / 2) / PXM) - UP * ((hpx / 2 - ay) / PXM)
    cam.location = c - FWD * 60

def shadow_catcher(size=80):
    bpy.ops.mesh.primitive_plane_add(size=size)
    p = bpy.context.object; p.is_shadow_catcher = True
    return p

def shoot(path, samples=48):
    S.cycles.samples = samples
    S.render.filepath = path
    bpy.ops.render.render(write_still=True)

# ======================= Material-Helfer =======================
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, m.node_tree, m.node_tree.nodes['Principled BSDF']

def node(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        if k in n.inputs.keys(): n.inputs[k].default_value = v
        else: setattr(n, k, v)
    return n

def L(nt, a, b): nt.links.new(a, b)

def _set(nt, sock, val):
    if isinstance(val, (int, float)): sock.default_value = val
    elif isinstance(val, tuple): sock.default_value = val if len(val) == 4 else (*val, 1)
    else: L(nt, val, sock)

def mix(nt, fac, a, b, blend='MIX'):
    m = node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type=blend)
    _set(nt, m.inputs['Factor'], fac); _set(nt, m.inputs['A'], a); _set(nt, m.inputs['B'], b)
    return m.outputs['Result']

def mixf(nt, fac, a, b):
    m = node(nt, 'ShaderNodeMix', data_type='FLOAT')
    _set(nt, m.inputs['Factor'], fac); _set(nt, m.inputs['A'], a); _set(nt, m.inputs['B'], b)
    return m.outputs['Result']

def ramp(nt, src, stops):
    r = node(nt, 'ShaderNodeValToRGB'); els = r.color_ramp.elements
    while len(els) < len(stops): els.new(0.5)
    for e, (p, c) in zip(els, stops): e.position = p; e.color = c if len(c) == 4 else (*c, 1)
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

def mop(nt, op, a, b=None):
    m = node(nt, 'ShaderNodeMath', operation=op)
    for i, s in enumerate((a, b)):
        if s is None: continue
        if isinstance(s, (int, float)): m.inputs[i].default_value = s
        else: L(nt, s, m.inputs[i])
    return m.outputs['Value']

def coords(nt):
    tc = node(nt, 'ShaderNodeTexCoord', object=REF)
    return tc.outputs['Object']

def weathering(nt, col, rough, *, chips=True, zimmerit=False, mud_h=1.9, dust_amt=0.6, streaks=0.45, metal_edge=(0.09, 0.085, 0.08), bump=0.12,
               wear=0.0, rust=0.0, fade=0.0, scratch=0.0, oil=0.0, mud_col=(0.17, 0.13, 0.085), grime=0.0):
    """Alterung: Farbunruhe, Regenschlieren, Schmutz in Ritzen, Staub oben, Schlamm unten, Kantenabrieb."""
    obj = coords(nt)
    geo = node(nt, 'ShaderNodeNewGeometry')
    bsdf = nt.nodes['Principled BSDF']
    col = mix(nt, 0.22, col, noise_tex(nt, obj, 22, 8).outputs['Color'], 'OVERLAY')
    col = mix(nt, 0.35, col, ramp(nt, noise_tex(nt, obj, 2.2, 6).outputs['Fac'], [(0.3, (0.75, 0.75, 0.75)), (0.7, (1.1, 1.1, 1.1))]), 'MULTIPLY')
    if fade:
        # von der Sonne ausgeblichener Lack (oben stärker)
        gs = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, geo.outputs['Normal'], gs.inputs['Vector'])
        up_f = mop(nt, 'MULTIPLY', maprange(nt, gs.outputs['Z'], 0.2, 0.9, 0.35, 1.0), fade)
        hsv = node(nt, 'ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = 0.7; hsv.inputs['Value'].default_value = 1.15
        L(nt, col, hsv.inputs['Color'])
        col = mix(nt, mop(nt, 'MULTIPLY', up_f, maprange(nt, noise_tex(nt, obj, 1.6, 6).outputs['Fac'], 0.3, 0.7)), col, hsv.outputs['Color'])
    if rust:
        # Rostläufer: senkrecht gezogene Rostspuren, vor allem unter Kanten
        mpr = node(nt, 'ShaderNodeMapping'); mpr.inputs['Scale'].default_value = (16, 16, 0.6); L(nt, obj, mpr.inputs['Vector'])
        rs = maprange(nt, noise_tex(nt, mpr.outputs['Vector'], 4.0, 8, 0.6).outputs['Fac'], 0.6, 0.78)
        col = mix(nt, mop(nt, 'MULTIPLY', rs, rust), col, (0.20, 0.08, 0.03))
        rp = maprange(nt, noise_tex(nt, obj, 9, 10, 0.7).outputs['Fac'], 0.66, 0.74)
        col = mix(nt, mop(nt, 'MULTIPLY', rp, rust), col, (0.28, 0.11, 0.04))
    if oil:
        ol = maprange(nt, noise_tex(nt, obj, 2.2, 8).outputs['Fac'], 0.66, 0.75)
        col = mix(nt, mop(nt, 'MULTIPLY', ol, oil), col, (0.02, 0.018, 0.015))
    if scratch:
        # feine helle Kratzer
        mps = node(nt, 'ShaderNodeMapping'); mps.inputs['Scale'].default_value = (40, 2.5, 40); mps.inputs['Rotation'].default_value = (0.3, 0.6, 0.9)
        L(nt, obj, mps.inputs['Vector'])
        sc = maprange(nt, noise_tex(nt, mps.outputs['Vector'], 6, 2, 0.5).outputs['Fac'], 0.72, 0.76)
        col = mix(nt, mop(nt, 'MULTIPLY', sc, scratch), col, (0.42, 0.40, 0.36))
    if streaks:
        mp = node(nt, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (7, 7, 0.35); L(nt, obj, mp.inputs['Vector'])
        st = maprange(nt, noise_tex(nt, mp.outputs['Vector'], 3.5, 6).outputs['Fac'], 0.55, 0.75)
        col = mix(nt, mop(nt, 'MULTIPLY', st, streaks), col, (0.12, 0.10, 0.08), 'MULTIPLY')
    ao = node(nt, 'ShaderNodeAmbientOcclusion', samples=8); ao.inputs['Distance'].default_value = 0.3
    col = mix(nt, mop(nt, 'MULTIPLY', maprange(nt, ao.outputs['AO'], 1.0, 0.45), 0.7), col, (0.10, 0.08, 0.06))
    sep = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, geo.outputs['Normal'], sep.inputs['Vector'])
    dust = mop(nt, 'MULTIPLY', maprange(nt, sep.outputs['Z'], 0.55, 0.95), maprange(nt, noise_tex(nt, obj, 4.5, 8).outputs['Fac'], 0.35, 0.7))
    col = mix(nt, mop(nt, 'MULTIPLY', dust, dust_amt), col, (0.47, 0.41, 0.32))
    rough = mixf(nt, dust, rough, 0.95)
    mud = None
    if mud_h:
        so = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, obj, so.inputs['Vector'])
        zz = mop(nt, 'ADD', so.outputs['Z'], mop(nt, 'MULTIPLY', noise_tex(nt, obj, 5.5, 10, 0.6).outputs['Fac'], 0.8))
        mud = maprange(nt, zz, mud_h, mud_h - 0.6)
        col = mix(nt, mud, col, mud_col)
        if grime:
            # großflächige dunkle Verschmutzung (in Spielgröße sichtbar)
            gr = maprange(nt, noise_tex(nt, obj, 0.9, 6, 0.6).outputs['Fac'], 0.45, 0.7)
            col = mix(nt, mop(nt, 'MULTIPLY', gr, grime), col, (0.06, 0.05, 0.035), 'MULTIPLY')
        rough = mixf(nt, mud, rough, 0.88)
    metal = None
    if chips:
        bev = node(nt, 'ShaderNodeBevel', samples=6); bev.inputs['Radius'].default_value = 0.025
        dot = node(nt, 'ShaderNodeVectorMath', operation='DOT_PRODUCT')
        L(nt, bev.outputs['Normal'], dot.inputs[0]); L(nt, geo.outputs['Normal'], dot.inputs[1])
        edge = maprange(nt, dot.outputs['Value'], 0.995, 0.93 + 0.04 * wear)
        cn = maprange(nt, noise_tex(nt, obj, 28, 10, 0.7).outputs['Fac'], 0.42 - 0.12 * wear, 0.62 - 0.1 * wear)
        chip = maprange(nt, mop(nt, 'MULTIPLY', edge, mop(nt, 'ADD', cn, 0.35 + 0.3 * wear)), 0.45, 0.6)
        if wear:
            # zusätzlich abgeplatzte Stellen auf Flächen (Grundierung/Metall)
            fl = maprange(nt, noise_tex(nt, obj, 14, 12, 0.75).outputs['Fac'], 0.7 - 0.06 * wear, 0.73 - 0.06 * wear)
            chip = mop(nt, 'MAXIMUM', chip, mop(nt, 'MULTIPLY', fl, wear))
        if mud is not None: chip = mop(nt, 'MULTIPLY', chip, mop(nt, 'SUBTRACT', 1.0, mud))
        col = mix(nt, chip, col, metal_edge)
        rough = mixf(nt, chip, rough, 0.42)
        metal = chip
    L(nt, col, bsdf.inputs['Base Color'])
    _set(nt, bsdf.inputs['Roughness'], rough)
    if metal is not None: L(nt, metal, bsdf.inputs['Metallic'])
    b1 = node(nt, 'ShaderNodeBump'); b1.inputs['Strength'].default_value = bump; b1.inputs['Distance'].default_value = 0.004
    L(nt, noise_tex(nt, obj, 60, 10).outputs['Fac'], b1.inputs['Height'])
    if zimmerit:
        wv = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z'); wv.inputs['Scale'].default_value = 22
        wv.inputs['Distortion'].default_value = 7; wv.inputs['Detail'].default_value = 4
        L(nt, obj, wv.inputs['Vector'])
        b2 = node(nt, 'ShaderNodeBump'); b2.inputs['Strength'].default_value = 0.7; b2.inputs['Distance'].default_value = 0.012
        L(nt, wv.outputs['Fac'], b2.inputs['Height']); L(nt, b2.outputs['Normal'], b1.inputs['Normal'])
    L(nt, b1.outputs['Normal'], bsdf.inputs['Normal'])

def painted(name, color, rough=0.7, **kw):
    m, nt, b = mat(name)
    weathering(nt, color, rough, **kw)
    return m

def camo(name, base=(0.36, 0.29, 0.15), green=(0.13, 0.16, 0.075), brown=(0.21, 0.11, 0.055), scale=0.42, **kw):
    m, nt, b = mat(name)
    obj = coords(nt)
    c = ramp(nt, noise_tex(nt, obj, scale, 3, 0.5, 0.6).outputs['Fac'], [(0.5, base), (0.535, green)])
    br = maprange(nt, noise_tex(nt, obj, scale * 1.4, 3, 0.5, 0.8).outputs['Fac'], 0.57, 0.6)
    weathering(nt, mix(nt, br, c, brown), 0.72, **kw)
    return m

def plain(name, color, rough=0.5, metal=0.0, emission=None, strength=1.0):
    m, nt, b = mat(name)
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emission:
        b.inputs['Emission Color'].default_value = (*emission, 1); b.inputs['Emission Strength'].default_value = strength
    return m

def brick(name, color=(0.36, 0.14, 0.08), mortar=(0.45, 0.42, 0.36), scale=1.0):
    m, nt, b = mat(name)
    obj = coords(nt)
    bt = node(nt, 'ShaderNodeTexBrick'); L(nt, obj, bt.inputs['Vector'])
    bt.inputs['Scale'].default_value = 4.0 * scale; bt.inputs['Mortar Size'].default_value = 0.012
    bt.inputs['Color1'].default_value = (*color, 1); bt.inputs['Color2'].default_value = tuple(c * 0.75 for c in color) + (1,)
    bt.inputs['Mortar'].default_value = (*mortar, 1)
    weathering(nt, bt.outputs['Color'], 0.85, chips=False, mud_h=0.9, streaks=0.6)
    return m

def concrete(name, color=(0.42, 0.40, 0.36), **kw):
    m, nt, b = mat(name)
    obj = coords(nt)
    c = ramp(nt, noise_tex(nt, obj, 1.5, 8).outputs['Fac'], [(0.3, tuple(x * 0.8 for x in color)), (0.7, color)])
    kw.setdefault('chips', False); kw.setdefault('mud_h', 0.8)
    weathering(nt, c, 0.88, **kw)
    return m

def roof_tiles(name, color=(0.38, 0.12, 0.07)):
    m, nt, b = mat(name)
    obj = coords(nt)
    bt = node(nt, 'ShaderNodeTexBrick'); L(nt, obj, bt.inputs['Vector'])
    bt.inputs['Scale'].default_value = 3.0; bt.inputs['Mortar Size'].default_value = 0.02; bt.inputs['Row Height'].default_value = 0.25
    bt.inputs['Color1'].default_value = (*color, 1); bt.inputs['Color2'].default_value = tuple(c * 0.7 for c in color) + (1,)
    bt.inputs['Mortar'].default_value = (0.07, 0.04, 0.03, 1)
    moss = maprange(nt, noise_tex(nt, obj, 2.5, 6).outputs['Fac'], 0.58, 0.7)
    col = mix(nt, mop(nt, 'MULTIPLY', moss, 0.6), bt.outputs['Color'], (0.18, 0.2, 0.08))
    weathering(nt, col, 0.75, chips=False, mud_h=0, streaks=0.3)
    return m

def corrugated(name, color=(0.30, 0.31, 0.30), rust=0.4):
    m, nt, b = mat(name)
    obj = coords(nt)
    c = mix(nt, mop(nt, 'MULTIPLY', maprange(nt, noise_tex(nt, obj, 1.8, 8).outputs['Fac'], 0.5, 0.75), rust), color, (0.30, 0.12, 0.05))
    weathering(nt, c, 0.55, chips=False, mud_h=0.8, streaks=0.7)
    wv = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='X'); wv.inputs['Scale'].default_value = 40
    L(nt, obj, wv.inputs['Vector'])
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.5; bp.inputs['Distance'].default_value = 0.02
    L(nt, wv.outputs['Fac'], bp.inputs['Height'])
    old = b.inputs['Normal'].links[0].from_node if b.inputs['Normal'].links else None
    if old: L(nt, bp.outputs['Normal'], old.inputs['Normal'])
    else: L(nt, bp.outputs['Normal'], b.inputs['Normal'])
    b.inputs['Metallic'].default_value = 0.4
    return m

def wood(name, color=(0.26, 0.16, 0.08)):
    m, nt, b = mat(name)
    obj = coords(nt)
    wv = node(nt, 'ShaderNodeTexWave', wave_type='BANDS', bands_direction='Z'); wv.inputs['Scale'].default_value = 6; wv.inputs['Distortion'].default_value = 12
    L(nt, obj, wv.inputs['Vector'])
    col = ramp(nt, wv.outputs['Fac'], [(0.2, tuple(c * 0.7 for c in color)), (0.8, color)])
    weathering(nt, col, 0.8, chips=False, mud_h=0.5)
    return m

# ======================= Geometrie =======================
def finish(o, m, bevel=0.0, seg=3):
    if o.name not in S.collection.objects: S.collection.objects.link(o)
    o.parent = PARENT
    if m: o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = seg; b.limit_method = 'ANGLE'; b.harden_normals = True
    else:
        o.modifiers.new('wn', 'WEIGHTED_NORMAL').keep_sharp = True
    return o

def frustum(name, size, loc, m, top=(1, 1), shift=(0, 0), bevel=0.02, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name); bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        v.co.x *= size[0]; v.co.y *= size[1]; v.co.z *= size[2]
        if v.co.z > 0: v.co.x = v.co.x * top[0] + shift[0]; v.co.y = v.co.y * top[1] + shift[1]
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; o.rotation_euler = rot
    return finish(o, m, bevel)

def box(name, size, loc, m, rot=(0, 0, 0), bevel=0.012):
    return frustum(name, size, loc, m, bevel=bevel, rot=rot)

def block(name, x0, y0, z0, x1, y1, z1, m, bevel=0.02):
    """Quader über Eckpunkte"""
    return box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), m, bevel=bevel)

def prism(name, pts_xz, width, m, y=0.0, bevel=0.02, axis='y'):
    """Profil (a, z) über die Breite extrudiert; axis 'y': Profil in x-z, 'x': Profil in y-z"""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    if axis == 'y':
        a = [bm.verts.new((p, -width / 2, z)) for p, z in pts_xz]; b = [bm.verts.new((p, width / 2, z)) for p, z in pts_xz]
    else:
        a = [bm.verts.new((-width / 2, p, z)) for p, z in pts_xz]; b = [bm.verts.new((width / 2, p, z)) for p, z in pts_xz]
    n = len(a)
    bm.faces.new(a[::-1]); bm.faces.new(b)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    o.location = (0, y, 0) if axis == 'y' else (y, 0, 0)
    return finish(o, m, bevel)

def cyl(name, r, depth, loc, m, rot=(0, 0, 0), verts=32, bevel=0.0, r2=None):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r2 if r2 is not None else r, depth=depth)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; o.rotation_euler = rot
    return finish(o, m, bevel, 2)

def line_cyl(name, a, b, r, m, verts=8):
    a, b = Vector(a), Vector(b); d = b - a
    o = cyl(name, r, d.length, (a + b) / 2, m, verts=verts)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o

def sphere(name, r, loc, m, scale=(1, 1, 1), seg=16):
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=r)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); o.location = loc; o.scale = scale
    return finish(o, m)

RX = (math.radians(90), 0, 0)
RY = (0, math.radians(90), 0)

def gable_house(name, cx, cy, l, w, h, roof_h, wall_m, roof_m, axis='x', overhang=0.25, z=0.0, win_m=None, lit_m=None, n_win=3, seed=1):
    """Haus mit Satteldach, First entlang `axis` ('x' oder 'y'); optional Fenster (teils beleuchtet)."""
    lx, ly = (l, w) if axis == 'x' else (w, l)
    block(f'{name}_w', cx - lx / 2, cy - ly / 2, z, cx + lx / 2, cy + ly / 2, z + h, wall_m, bevel=0.03)
    across = 'x' if axis == 'x' else 'y'   # prism-Achse: Profil quer zum First
    gable = prism(f'{name}_g', [(-w / 2, z + h), (w / 2, z + h), (0, z + h + roof_h - 0.02)], l - 0.02, wall_m, axis=across, bevel=0.02)
    roof = prism(f'{name}_r', [(-w / 2 - overhang, z + h - 0.06), (w / 2 + overhang, z + h - 0.06), (0, z + h + roof_h), ], l + overhang * 2, roof_m, axis=across, bevel=0.02)
    for o in (gable, roof): o.location = (cx, cy, 0)
    if win_m:
        windows_on_box(name, cx, cy, lx, ly, z, h, win_m, lit_m, n_win, seed)

def windows_on_box(name, cx, cy, lx, ly, z, h, win_m, lit_m=None, n=3, seed=1, ww=0.7, wh=0.9, rows=1):
    """Fenster auf den beiden zur Kamera zeigenden Seiten (+X und -Y) eines Quaders."""
    import random
    rnd = random.Random(seed)
    for row in range(rows):
        zc = z + h * (row + 0.55) / rows
        for i in range(n):
            t = (i + 0.5) / n
            lit = lit_m is not None and rnd.random() < 0.45
            # Seite -Y (links vorne im Bild)
            box(f'{name}_fy{row}{i}', (ww, 0.06, wh), (cx - lx / 2 + lx * t, cy - ly / 2 - 0.02, zc), lit_m if lit else win_m, bevel=0.01)
        m2 = max(1, round(n * ly / max(lx, 0.1)))
        for i in range(m2):
            t = (i + 0.5) / m2
            lit = lit_m is not None and rnd.random() < 0.45
            box(f'{name}_fx{row}{i}', (0.06, ww, wh), (cx + lx / 2 + 0.02, cy - ly / 2 + ly * t, zc), lit_m if lit else win_m, bevel=0.01)

def crate(name, loc, m, s=0.9):
    box(name, (s, s, s * 0.8), (loc[0], loc[1], loc[2] + s * 0.4), m, bevel=0.03)

def barrel(name, loc, m, r=0.3, h=0.88):
    cyl(name, r, h, (loc[0], loc[1], loc[2] + h / 2), m, verts=20, bevel=0.03)
    for k, zz in enumerate((0.2, 0.68)): cyl(f'{name}_ring{k}', r + 0.015, 0.04, (loc[0], loc[1], loc[2] + h * zz), m, verts=20)

def sandbags(name, x0, y0, x1, y1, layers, m):
    d = Vector((x1 - x0, y1 - y0, 0)); L_ = d.length; n = max(1, int(L_ / 0.55))
    ang = math.atan2(d.y, d.x)
    for k in range(layers):
        for i in range(n):
            t = (i + 0.5 + (0.5 if k % 2 else 0)) / n
            if t > 1: continue
            o = sphere(f'{name}{k}_{i}', 0.3, (x0 + d.x * t, y0 + d.y * t, 0.14 + k * 0.24), m, scale=(1.0, 0.6, 0.45), seg=12)
            o.rotation_euler = (0, 0, ang)

def ground_patch(name, x0, y0, x1, y1, m, z=0.0, h=0.12, bevel=0.06):
    return block(name, x0, y0, z, x1, y1, z + h, m, bevel=bevel)

# ======================= 1940: Altbau-Bausteine =======================
from mathutils import Matrix, Euler

def wobble(o, strength=0.02, scale=0.6, levels=2):
    """Unebenheit: Fläche unterteilen und leicht verbeulen (keine harten, perfekten Flächen)."""
    sub = o.modifiers.new('ws', 'SUBSURF'); sub.subdivision_type = 'SIMPLE'; sub.levels = sub.render_levels = levels
    d = o.modifiers.new('wd', 'DISPLACE'); t = bpy.data.textures.new(o.name + 'w', 'CLOUDS'); t.noise_scale = scale
    d.texture = t; d.strength = strength
    return o

def soft(o, w=0.06, seg=4):
    """weiche, gerundete Kanten"""
    for m in list(o.modifiers):
        if m.type in ('BEVEL', 'WEIGHTED_NORMAL'): o.modifiers.remove(m)
    b = o.modifiers.new('bevel', 'BEVEL'); b.width = w; b.segments = seg; b.limit_method = 'ANGLE'; b.harden_normals = True
    o.modifiers.move(len(o.modifiers) - 1, 0)
    return o

def mesh_boxes(name, boxes, m, bevel=0.01):
    """Viele Quader als ein Objekt: boxes = [(sx, sy, sz, (x, y, z), (rx, ry, rz)), ...]"""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    for sx, sy, sz, loc, rot in boxes:
        mat = Matrix.LocRotScale(Vector(loc), Euler(rot).to_quaternion(), Vector((sx, sy, sz)))
        bmesh.ops.create_cube(bm, size=1, matrix=mat)
    bm.to_mesh(me); bm.free()
    return finish(bpy.data.objects.new(name, me), m, bevel)

def wall_uv(nt):
    """Koordinaten für Wandtexturen: waagerecht (x + y) und senkrecht (z), passt für beide Wandrichtungen"""
    obj = coords(nt)
    sep = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, obj, sep.inputs['Vector'])
    comb = node(nt, 'ShaderNodeCombineXYZ')
    L(nt, mop(nt, 'ADD', sep.outputs['X'], sep.outputs['Y']), comb.inputs['X']); L(nt, sep.outputs['Z'], comb.inputs['Y'])
    return comb.outputs['Vector']

def _brick_color(nt, base, scale=1.0):
    uv = wall_uv(nt)
    bt = node(nt, 'ShaderNodeTexBrick'); L(nt, uv, bt.inputs['Vector'])
    bt.inputs['Scale'].default_value = 2.0 * scale; bt.inputs['Mortar Size'].default_value = 0.018
    bt.inputs['Brick Width'].default_value = 0.5; bt.inputs['Row Height'].default_value = 0.2
    bt.inputs['Color1'].default_value = (*base, 1); bt.inputs['Color2'].default_value = tuple(c * 0.68 for c in base) + (1,)
    bt.inputs['Mortar'].default_value = (0.36, 0.33, 0.29, 1); bt.inputs['Bias'].default_value = 0.1
    # einzelne Steine dunkler / heller gebrannt
    vo = node(nt, 'ShaderNodeTexNoise'); vo.inputs['Scale'].default_value = 9; L(nt, uv, vo.inputs['Vector'])
    col = mix(nt, 0.45, bt.outputs['Color'], vo.outputs['Color'], 'OVERLAY')
    return col, bt.outputs['Fac']

def brick1940(name, base=(0.30, 0.11, 0.06), soot=0.5):
    m, nt, b = mat(name)
    col, mortar = _brick_color(nt, base)
    obj = coords(nt)
    # Ruß und Kalkausblühungen
    col = mix(nt, mop(nt, 'MULTIPLY', maprange(nt, noise_tex(nt, obj, 0.8, 6).outputs['Fac'], 0.55, 0.75), soot), col, (0.05, 0.04, 0.035))
    col = mix(nt, mop(nt, 'MULTIPLY', maprange(nt, noise_tex(nt, obj, 1.5, 8).outputs['Fac'], 0.65, 0.8), 0.35), col, (0.55, 0.52, 0.46))
    weathering(nt, col, 0.88, chips=False, mud_h=0.9, streaks=0.6, bump=0.25)
    # Fugen vertieft
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.6; bp.inputs['Distance'].default_value = 0.01
    L(nt, mop(nt, 'SUBTRACT', 1.0, mortar), bp.inputs['Height'])
    old = b.inputs['Normal'].links[0].from_node
    L(nt, bp.outputs['Normal'], old.inputs['Normal'])
    return m

def plaster1940(name, color=(0.58, 0.53, 0.43), reveal=0.35):
    """Kalkputz, fleckig, an manchen Stellen abgeplatzt (Ziegel darunter sichtbar)"""
    m, nt, b = mat(name)
    obj = coords(nt)
    base = ramp(nt, noise_tex(nt, obj, 0.9, 6).outputs['Fac'], [(0.3, tuple(c * 0.82 for c in color)), (0.7, color)])
    stains = maprange(nt, noise_tex(nt, obj, 2.5, 8).outputs['Fac'], 0.55, 0.8)
    col = mix(nt, mop(nt, 'MULTIPLY', stains, 0.5), base, (0.25, 0.22, 0.16))
    brick, mortar = _brick_color(nt, (0.30, 0.12, 0.07))
    patch = maprange(nt, noise_tex(nt, obj, 1.3, 8, 0.65).outputs['Fac'], 1.0 - reveal * 0.45, 1.0 - reveal * 0.4)
    col = mix(nt, patch, col, brick)
    weathering(nt, col, 0.9, chips=False, mud_h=1.0, streaks=0.75, bump=0.3)
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.5; bp.inputs['Distance'].default_value = 0.012
    L(nt, mop(nt, 'SUBTRACT', 1.0, patch), bp.inputs['Height'])
    old = b.inputs['Normal'].links[0].from_node
    L(nt, bp.outputs['Normal'], old.inputs['Normal'])
    return m

def stone1940(name, color=(0.30, 0.28, 0.25)):
    """Bruchstein mit Mörtelfugen"""
    m, nt, b = mat(name)
    uv = wall_uv(nt)
    vo = node(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vo.inputs['Scale'].default_value = 3.2; L(nt, uv, vo.inputs['Vector'])
    vc = node(nt, 'ShaderNodeTexVoronoi'); vc.inputs['Scale'].default_value = 3.2; L(nt, uv, vc.inputs['Vector'])
    col = ramp(nt, vc.outputs['Color'], [(0.0, tuple(c * 0.6 for c in color)), (1.0, tuple(min(1, c * 1.25) for c in color))])
    col = mix(nt, maprange(nt, vo.outputs['Distance'], 0.05, 0.0), col, (0.32, 0.30, 0.26))
    weathering(nt, col, 0.9, chips=False, mud_h=0.8, streaks=0.4, bump=0.3)
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.8; bp.inputs['Distance'].default_value = 0.03
    L(nt, maprange(nt, vo.outputs['Distance'], 0.0, 0.08), bp.inputs['Height'])
    old = b.inputs['Normal'].links[0].from_node
    L(nt, bp.outputs['Normal'], old.inputs['Normal'])
    return m

def tiles1940(name, color=(0.36, 0.13, 0.07)):
    """Biberschwanz-Dachziegel mit Moos, Farbunterschieden und einzelnen dunklen (ersetzten) Ziegeln"""
    m, nt, b = mat(name)
    obj = coords(nt)
    sep = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, obj, sep.inputs['Vector'])
    comb = node(nt, 'ShaderNodeCombineXYZ')
    L(nt, mop(nt, 'ADD', sep.outputs['X'], sep.outputs['Y']), comb.inputs['X']); L(nt, mop(nt, 'MULTIPLY', sep.outputs['Z'], 1.4), comb.inputs['Y'])
    bt = node(nt, 'ShaderNodeTexBrick'); L(nt, comb.outputs['Vector'], bt.inputs['Vector'])
    bt.inputs['Scale'].default_value = 5.0; bt.inputs['Mortar Size'].default_value = 0.03; bt.inputs['Row Height'].default_value = 0.3
    bt.inputs['Brick Width'].default_value = 0.35
    bt.inputs['Color1'].default_value = (*color, 1); bt.inputs['Color2'].default_value = tuple(c * 0.6 for c in color) + (1,)
    bt.inputs['Mortar'].default_value = (0.05, 0.03, 0.02, 1); bt.inputs['Bias'].default_value = 0.2
    col = mix(nt, 0.4, bt.outputs['Color'], noise_tex(nt, obj, 14, 6).outputs['Color'], 'OVERLAY')
    moss = maprange(nt, noise_tex(nt, obj, 1.6, 8).outputs['Fac'], 0.55, 0.72)
    col = mix(nt, mop(nt, 'MULTIPLY', moss, 0.75), col, (0.13, 0.15, 0.05))
    lichen = maprange(nt, noise_tex(nt, obj, 9, 4).outputs['Fac'], 0.68, 0.74)
    col = mix(nt, mop(nt, 'MULTIPLY', lichen, 0.5), col, (0.45, 0.43, 0.30))
    weathering(nt, col, 0.8, chips=False, mud_h=0, streaks=0.35, dust_amt=0.25, bump=0.2)
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.9; bp.inputs['Distance'].default_value = 0.03
    L(nt, mop(nt, 'SUBTRACT', 1.0, bt.outputs['Fac']), bp.inputs['Height'])
    old = b.inputs['Normal'].links[0].from_node
    L(nt, bp.outputs['Normal'], old.inputs['Normal'])
    return m

def oldwood(name, color=(0.20, 0.17, 0.13), grey=0.5):
    """verwittertes Holz (Bretter, Zäune), teils vergraut"""
    m, nt, b = mat(name)
    obj = coords(nt)
    mp = node(nt, 'ShaderNodeMapping'); mp.inputs['Scale'].default_value = (14, 14, 1.0); L(nt, obj, mp.inputs['Vector'])
    grain = noise_tex(nt, mp.outputs['Vector'], 3, 10, 0.7)
    col = ramp(nt, grain.outputs['Fac'], [(0.3, tuple(c * 0.6 for c in color)), (0.7, color)])
    col = mix(nt, mop(nt, 'MULTIPLY', maprange(nt, noise_tex(nt, obj, 1.2).outputs['Fac'], 0.4, 0.7), grey), col, (0.33, 0.32, 0.29))
    weathering(nt, col, 0.92, chips=False, mud_h=0.5, streaks=0.4, bump=0.4)
    return m

def ground1940(name, kind='hof'):
    """Hofboden, der zum Rand hin weich ausläuft (Alpha), damit das Gebäude in den Spielboden übergeht"""
    m, nt, b = mat(name)
    obj = coords(nt)
    if kind == 'hof':
        c1, c2 = (0.085, 0.06, 0.035), (0.17, 0.125, 0.08)
    elif kind == 'pflaster':
        c1, c2 = (0.11, 0.10, 0.09), (0.21, 0.19, 0.16)
    else:
        c1, c2 = (0.05, 0.08, 0.02), (0.10, 0.13, 0.04)
    col = ramp(nt, noise_tex(nt, obj, 0.8, 8).outputs['Fac'], [(0.3, c1), (0.7, c2)])
    if kind == 'pflaster':
        vo = node(nt, 'ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); vo.inputs['Scale'].default_value = 5.0; L(nt, obj, vo.inputs['Vector'])
        col = mix(nt, maprange(nt, vo.outputs['Distance'], 0.06, 0.0), col, (0.08, 0.07, 0.06))
    grass = maprange(nt, noise_tex(nt, obj, 0.7, 8).outputs['Fac'], 0.52, 0.66)
    if kind != 'gras':
        col = mix(nt, mop(nt, 'MULTIPLY', grass, 0.85), col, (0.09, 0.12, 0.04))
    col = mix(nt, 0.4, col, noise_tex(nt, obj, 30, 10).outputs['Color'], 'OVERLAY')
    L(nt, col, b.inputs['Base Color']); b.inputs['Roughness'].default_value = 0.95
    bp = node(nt, 'ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.5; bp.inputs['Distance'].default_value = 0.02
    L(nt, noise_tex(nt, obj, 20, 10).outputs['Fac'], bp.inputs['Height']); L(nt, bp.outputs['Normal'], b.inputs['Normal'])
    return m

def soft_patch(name, x0, y0, x1, y1, m, fade=1.4, z=0.02):
    """Bodenfläche mit unregelmäßigem, weich ausblendendem Rand (Alpha über Rauschen)"""
    o = block(name, x0, y0, 0, x1, y1, z, m, bevel=0)
    nt = m.node_tree
    if not getattr(m, '_faded', False):
        obj = coords(nt)
        sep = node(nt, 'ShaderNodeSeparateXYZ'); L(nt, obj, sep.inputs['Vector'])
        cx, cy, hx, hy = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
        dx = mop(nt, 'SUBTRACT', hx, mop(nt, 'ABSOLUTE', mop(nt, 'SUBTRACT', sep.outputs['X'], cx)))
        dy = mop(nt, 'SUBTRACT', hy, mop(nt, 'ABSOLUTE', mop(nt, 'SUBTRACT', sep.outputs['Y'], cy)))
        d = mop(nt, 'MINIMUM', dx, dy)
        n = mop(nt, 'MULTIPLY', noise_tex(nt, obj, 0.22, 6, 0.6).outputs['Fac'], fade * 3.6)
        alpha = mop(nt, 'MINIMUM', maprange(nt, d, 0.0, fade * 0.8), maprange(nt, mop(nt, 'ADD', d, n), fade * 2.3, fade * 3.1))
        L(nt, alpha, nt.nodes['Principled BSDF'].inputs['Alpha'])
    return o

# ======================= bewegliche Teile =======================
def pivot(name, loc):
    """Drehpunkt für ein bewegliches Teil: alles, was danach gebaut wird, hängt (in lokalen Koordinaten) daran"""
    p = empty(name, PARENT); p.location = loc
    set_parent(p)
    return p

def render_anims(anims, path_fn, samples, catcher=None):
    """Bewegliche Teile als eigene Bildfolgen rendern. anims: [{'root': Empty, 'frames': n, 'pose': fn(root, k)}].
    Das übrige Modell wird zum Holdout (verdeckt die Teile richtig), der Schattenfänger entfällt."""
    groups = [set(a['root'].children_recursive) for a in anims]
    meshes = [o for o in S.objects if o.type == 'MESH' and o is not catcher]
    sun = next(o for o in S.objects if o.type == 'LIGHT')
    to_sun = (sun.matrix_world.to_3x3() @ Vector((0, 0, 1))).normalized()
    for gi, a in enumerate(anims):
        # Schatten des Teils fällt mit in die Bildfolge (Schattenfänger an, übrige Teile werfen dabei keinen Schatten)
        for o in meshes:
            if o in groups[gi]: o.visible_camera = True; o.visible_shadow = True; o.is_holdout = False; o.hide_render = False
            elif any(o in g for g in groups): o.hide_render = True
            else: o.is_holdout = True; o.visible_shadow = False
        # nur den Bildbereich rendern, den das Teil in irgendeiner Stellung überstreicht
        from bpy_extras.object_utils import world_to_camera_view
        x0 = y0 = 1.0; x1 = y1 = 0.0
        for k in range(a['frames']):
            a['pose'](a['root'], k); bpy.context.view_layer.update()
            for o in groups[gi]:
                if o.type != 'MESH': continue
                for c in o.bound_box:
                    p = o.matrix_world @ Vector(c)
                    for q in (p, p - to_sun * (p.z / max(to_sun.z, 0.05))):   # auch der Schattenpunkt am Boden
                        v = world_to_camera_view(S, S.camera, q)
                        x0, y0, x1, y1 = min(x0, v.x), min(y0, v.y), max(x1, v.x), max(y1, v.y)
        S.render.use_border = True; S.render.use_crop_to_border = False
        S.render.border_min_x, S.render.border_min_y = max(0, x0 - 0.02), max(0, y0 - 0.02)
        S.render.border_max_x, S.render.border_max_y = min(1, x1 + 0.02), min(1, y1 + 0.02)
        for k in range(a['frames']):
            a['pose'](a['root'], k)
            shoot(path_fn(gi, k), samples)
        a['pose'](a['root'], 0)
        S.render.use_border = False
    for o in meshes: o.is_holdout = False; o.hide_render = False; o.visible_shadow = True

def hide_moving(anims):
    """Für das Grundbild: bewegliche Teile samt Schatten weglassen (beides kommt mit der Bildfolge)"""
    for a in anims:
        for o in a['root'].children_recursive:
            if o.type == 'MESH': o.visible_camera = False; o.visible_shadow = False

def spoke_wheel(name, r, width, spokes, m, paddles=0, m2=None):
    """Speichenrad in der YZ-Ebene (Achse = lokale X-Achse) um den aktuellen Drehpunkt"""
    n = 16
    for i in range(n):
        a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
        for s in (-1, 1):
            line_cyl(f'{name}_kranz{i}{s}', (s * width / 2, r * math.cos(a0), r * math.sin(a0)), (s * width / 2, r * math.cos(a1), r * math.sin(a1)), r * 0.06, m, verts=6)
    for i in range(spokes):
        a = 2 * math.pi * i / spokes
        for s in (-1, 1):
            line_cyl(f'{name}_speiche{i}{s}', (s * width / 2, 0, 0), (s * width / 2, r * math.cos(a), r * math.sin(a)), r * 0.045, m, verts=6)
    cyl(f'{name}_nabe', r * 0.14, width * 1.2, (0, 0, 0), m, rot=RY, verts=12)
    for i in range(paddles):
        a = 2 * math.pi * (i + 0.5) / paddles
        box(f'{name}_schaufel{i}', (width, r * 0.3, 0.06), (0, r * 0.86 * math.cos(a), r * 0.86 * math.sin(a)), m2 or m, rot=(a, 0, 0), bevel=0.01)
