# Nahtlos kachelbare Bodentexturen (Draufsicht) für Eisenfront.
# Jede Textur deckt 4×4 Spielkacheln (je 5,6 m) ab. Alle Rauschmuster werden auf einem 4D-Torus
# ausgewertet und sind dadurch exakt periodisch; Licht von links oben wie bei den Sprites.
# Aufruf: python boden.py <ausgabeordner> [name ...]
import bpy, math, sys, os

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SIZE_M = 4 * 5.6          # Kantenlänge der Textur in Metern
RES = int(os.environ.get('RES', 384))
SAMPLES = int(os.environ.get('SAMPLES', 64))
R = SIZE_M / (2 * math.pi) # Torusradius: 1 Einheit ~ 1 Meter

bpy.ops.wm.read_factory_settings(use_empty=True)
S = bpy.context.scene
bpy.ops.mesh.primitive_plane_add(size=SIZE_M * 1.5, location=(0, 0, 0))
PLANE = bpy.context.object

cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = SIZE_M
co = bpy.data.objects.new('cam', cam); S.collection.objects.link(co); S.camera = co
co.location = (0, 0, 30)
S.render.resolution_x = S.render.resolution_y = RES
S.render.engine = 'CYCLES'; S.cycles.device = 'CPU'; S.cycles.samples = SAMPLES; S.cycles.use_denoising = True
S.view_settings.view_transform = 'AgX'; S.view_settings.look = 'AgX - Medium High Contrast'; S.view_settings.exposure = -0.75
w = bpy.data.worlds.new('w'); S.world = w; w.use_nodes = True
sky = w.node_tree.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'MULTIPLE_SCATTERING'; sky.sun_disc = False
sky.sun_elevation = math.radians(40); sky.sun_rotation = math.radians(180)
w.node_tree.links.new(sky.outputs['Color'], w.node_tree.nodes['Background'].inputs['Color'])
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.09
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4.6; sun.color = (1.0, 0.93, 0.82); sun.angle = math.radians(1.5)
so = bpy.data.objects.new('sun', sun); S.collection.objects.link(so)
# gleiche Richtung wie bei den Sprites: Licht kommt von -X (im Bild links oben)
so.rotation_euler = (math.radians(50), 0, math.radians(-90))

# ---------------- Knoten-Helfer ----------------
class M:
    def __init__(self, name):
        self.m = bpy.data.materials.new(name); self.m.use_nodes = True
        self.nt = self.m.node_tree; self.bsdf = self.nt.nodes['Principled BSDF']
        tc = self.n('ShaderNodeTexCoord')
        mp = self.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / SIZE_M, 1 / SIZE_M, 1)
        self.l(tc.outputs['Object'], mp.inputs['Vector'])
        sep = self.n('ShaderNodeSeparateXYZ'); self.l(mp.outputs['Vector'], sep.inputs['Vector'])
        def ang(o):
            return self.op('MULTIPLY', o, 2 * math.pi)
        au, av = ang(sep.outputs['X']), ang(sep.outputs['Y'])
        cu, su = self.op('COSINE', au), self.op('SINE', au)
        cv, sv = self.op('COSINE', av), self.op('SINE', av)
        comb = self.n('ShaderNodeCombineXYZ')
        self.l(self.op('MULTIPLY', cu, R), comb.inputs['X']); self.l(self.op('MULTIPLY', su, R), comb.inputs['Y'])
        self.l(self.op('MULTIPLY', cv, R), comb.inputs['Z'])
        self.vec = comb.outputs['Vector']; self.w = self.op('MULTIPLY', sv, R)
        self.seed = 0

    def n(self, kind, **kw):
        x = self.nt.nodes.new(kind)
        for k, v in kw.items():
            if k in x.inputs.keys(): x.inputs[k].default_value = v
            else: setattr(x, k, v)
        return x
    def l(self, a, b): self.nt.links.new(a, b)
    def op(self, o, a, b=None):
        x = self.n('ShaderNodeMath', operation=o)
        for i, s in enumerate((a, b)):
            if s is None: continue
            if isinstance(s, (int, float)): x.inputs[i].default_value = s
            else: self.l(s, x.inputs[i])
        return x.outputs['Value']
    def noise(self, scale, detail=6, rough=0.55, dist=0.0):
        """periodisches 4D-Rauschen; scale = Strukturen je Meter"""
        self.seed += 1
        x = self.n('ShaderNodeTexNoise', noise_dimensions='4D')
        x.inputs['Scale'].default_value = scale; x.inputs['Detail'].default_value = detail
        x.inputs['Roughness'].default_value = rough; x.inputs['Distortion'].default_value = dist
        off = self.n('ShaderNodeVectorMath', operation='ADD'); off.inputs[1].default_value = (self.seed * 37.1, self.seed * 11.3, 0)
        self.l(self.vec, off.inputs[0]); self.l(off.outputs['Vector'], x.inputs['Vector']); self.l(self.w, x.inputs['W'])
        return x
    def voronoi(self, scale, feature='F1', rand=1.0):
        self.seed += 1
        x = self.n('ShaderNodeTexVoronoi', voronoi_dimensions='4D', feature=feature)
        x.inputs['Scale'].default_value = scale; x.inputs['Randomness'].default_value = rand
        off = self.n('ShaderNodeVectorMath', operation='ADD'); off.inputs[1].default_value = (self.seed * 19.7, self.seed * 5.9, 0)
        self.l(self.vec, off.inputs[0]); self.l(off.outputs['Vector'], x.inputs['Vector']); self.l(self.w, x.inputs['W'])
        return x
    def ramp(self, src, stops):
        r = self.n('ShaderNodeValToRGB'); els = r.color_ramp.elements
        while len(els) < len(stops): els.new(0.5)
        for e, (p, c) in zip(els, stops): e.position = p; e.color = (*c, 1)
        self.l(src, r.inputs['Fac']); return r.outputs['Color']
    def mr(self, src, a, b, c=0.0, d=1.0):
        x = self.n('ShaderNodeMapRange'); x.inputs['From Min'].default_value = a; x.inputs['From Max'].default_value = b
        x.inputs['To Min'].default_value = c; x.inputs['To Max'].default_value = d
        self.l(src, x.inputs['Value']); return x.outputs['Result']
    def mix(self, fac, a, b, blend='MIX'):
        x = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        for src, dst in ((fac, 'Factor'), (a, 'A'), (b, 'B')):
            if isinstance(src, (int, float)): x.inputs[dst].default_value = src
            elif isinstance(src, tuple): x.inputs[dst].default_value = (*src, 1) if len(src) == 3 else src
            else: self.l(src, x.inputs[dst])
        return x.outputs['Result']
    def finish(self, col, rough, height, strength=0.5, dist=0.05, metal=0.0):
        self.l(col, self.bsdf.inputs['Base Color'])
        if isinstance(rough, float): self.bsdf.inputs['Roughness'].default_value = rough
        else: self.l(rough, self.bsdf.inputs['Roughness'])
        self.bsdf.inputs['Metallic'].default_value = metal
        b = self.n('ShaderNodeBump'); b.inputs['Strength'].default_value = strength; b.inputs['Distance'].default_value = dist
        self.l(height, b.inputs['Height']); self.l(b.outputs['Normal'], self.bsdf.inputs['Normal'])
        return self.m

# ---------------- Bodenarten ----------------
def gras():
    m = M('gras')
    base = m.ramp(m.noise(0.35, 4).outputs['Fac'], [(0.3, (0.06, 0.10, 0.025)), (0.7, (0.12, 0.16, 0.045))])
    clump = m.voronoi(5.0)
    col = m.mix(m.mr(clump.outputs['Distance'], 0.0, 0.5, 0.35, 0.0), base, (0.03, 0.05, 0.012))
    blades = m.noise(28, 10, 0.75)
    col = m.mix(0.85, col, blades.outputs['Color'], 'OVERLAY')
    col = m.mix(0.5, col, m.noise(70, 12, 0.85).outputs['Color'], 'OVERLAY')
    dry = m.mr(m.noise(0.18, 3).outputs['Fac'], 0.55, 0.72)
    col = m.mix(m.op('MULTIPLY', dry, 0.55), col, (0.24, 0.22, 0.10))
    soil = m.mr(m.noise(1.6, 6).outputs['Fac'], 0.66, 0.74)
    col = m.mix(soil, col, (0.16, 0.12, 0.075))
    flowers = m.mr(m.voronoi(9).outputs['Distance'], 0.05, 0.02)
    col = m.mix(m.op('MULTIPLY', flowers, m.mr(m.noise(0.5).outputs['Fac'], 0.55, 0.6)), col, (0.6, 0.55, 0.25))
    h = m.op('ADD', m.op('MULTIPLY', blades.outputs['Fac'], 0.6), clump.outputs['Distance'])
    return m.finish(col, 0.85, h, 0.55)

def waldboden():
    m = M('waldboden')
    leaves = m.voronoi(14)
    col = m.ramp(leaves.outputs['Color'], [(0.0, (0.07, 0.05, 0.03)), (0.5, (0.16, 0.10, 0.045)), (1.0, (0.24, 0.17, 0.07))])
    col = m.mix(m.mr(leaves.outputs['Distance'], 0.3, 0.0), col, (0.04, 0.03, 0.02))
    moss = m.op('MULTIPLY', m.mr(m.noise(0.6, 5).outputs['Fac'], 0.52, 0.7), 0.6)
    col = m.mix(moss, col, m.mix(0.5, (0.07, 0.11, 0.03), m.noise(20).outputs['Color'], 'OVERLAY'))
    col = m.mix(0.4, col, m.noise(35, 8).outputs['Color'], 'OVERLAY')
    return m.finish(col, 0.9, m.op('ADD', leaves.outputs['Distance'], m.noise(30).outputs['Fac']), 0.6)

def sand():
    m = M('sand')
    col = m.ramp(m.noise(0.5, 5).outputs['Fac'], [(0.3, (0.30, 0.24, 0.15)), (0.7, (0.42, 0.35, 0.23))])
    grain = m.noise(60, 10, 0.8)
    col = m.mix(0.35, col, grain.outputs['Color'], 'OVERLAY')
    peb = m.voronoi(7)
    pm = m.op('MULTIPLY', m.mr(peb.outputs['Distance'], 0.1, 0.04), m.mr(m.noise(0.8).outputs['Fac'], 0.45, 0.6))
    col = m.mix(pm, col, m.ramp(peb.outputs['Color'], [(0, (0.3, 0.28, 0.25)), (1, (0.55, 0.52, 0.47))]))
    ripple = m.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X'); ripple.inputs['Scale'].default_value = 1.2
    ripple.inputs['Distortion'].default_value = 6
    m.l(m.vec, ripple.inputs['Vector'])
    return m.finish(col, 0.92, m.op('ADD', m.op('MULTIPLY', ripple.outputs['Fac'], 0.25), m.op('ADD', grain.outputs['Fac'], pm)), 0.45)

def felsboden():
    m = M('felsboden')
    cells = m.voronoi(0.5, 'DISTANCE_TO_EDGE')
    col = m.ramp(m.noise(0.8, 6).outputs['Fac'], [(0.3, (0.15, 0.145, 0.13)), (0.7, (0.27, 0.26, 0.23))])
    col = m.mix(m.mr(cells.outputs['Distance'], 0.06, 0.0), col, (0.06, 0.055, 0.05))
    lichen = m.mr(m.noise(3, 6).outputs['Fac'], 0.62, 0.7)
    col = m.mix(m.op('MULTIPLY', lichen, 0.7), col, (0.38, 0.40, 0.22))
    col = m.mix(0.45, col, m.noise(25, 10).outputs['Color'], 'OVERLAY')
    gr = m.mr(m.noise(0.5).outputs['Fac'], 0.58, 0.66)
    col = m.mix(gr, col, (0.10, 0.13, 0.04))
    h = m.op('ADD', m.mr(cells.outputs['Distance'], 0.0, 0.08), m.op('MULTIPLY', m.noise(8, 10).outputs['Fac'], 0.6))
    return m.finish(col, 0.8, h, 0.8)

def erde():
    m = M('erde')
    col = m.ramp(m.noise(0.7, 6).outputs['Fac'], [(0.3, (0.15, 0.11, 0.07)), (0.7, (0.26, 0.20, 0.13))])
    col = m.mix(0.45, col, m.noise(40, 10).outputs['Color'], 'OVERLAY')
    peb = m.voronoi(10)
    pm = m.op('MULTIPLY', m.mr(peb.outputs['Distance'], 0.12, 0.05), m.mr(m.noise(1.2).outputs['Fac'], 0.4, 0.6))
    col = m.mix(pm, col, m.ramp(peb.outputs['Color'], [(0, (0.32, 0.30, 0.27)), (1, (0.52, 0.49, 0.44))]))
    dry = m.mr(m.noise(0.4).outputs['Fac'], 0.5, 0.65)
    col = m.mix(m.op('MULTIPLY', dry, 0.5), col, (0.42, 0.36, 0.26))
    return m.finish(col, 0.93, m.op('ADD', m.noise(20, 10).outputs['Fac'], pm), 0.5)

def acker():
    m = M('acker')
    clods = m.voronoi(4.5)
    col = m.ramp(clods.outputs['Color'], [(0.0, (0.11, 0.08, 0.05)), (1.0, (0.24, 0.18, 0.11))])
    col = m.mix(m.mr(clods.outputs['Distance'], 0.45, 0.0), col, (0.06, 0.045, 0.03))
    col = m.mix(0.4, col, m.noise(30, 10).outputs['Color'], 'OVERLAY')
    return m.finish(col, 0.95, m.op('ADD', clods.outputs['Distance'], m.noise(25).outputs['Fac']), 0.9)

def saat():
    m = M('saat')
    soil = m.ramp(m.noise(0.7).outputs['Fac'], [(0.3, (0.12, 0.09, 0.06)), (0.7, (0.2, 0.15, 0.1))])
    sprout = m.mr(m.noise(24, 8).outputs['Fac'], 0.45, 0.6)
    cover = m.mr(m.noise(0.4).outputs['Fac'], 0.3, 0.7, 0.55, 0.95)
    col = m.mix(m.op('MULTIPLY', sprout, cover), soil, m.ramp(m.noise(3).outputs['Fac'], [(0.3, (0.09, 0.16, 0.03)), (0.7, (0.17, 0.23, 0.05))]))
    return m.finish(col, 0.85, m.noise(30, 10).outputs['Fac'], 0.5)

def weizen():
    m = M('weizen')
    col = m.ramp(m.noise(0.6, 5).outputs['Fac'], [(0.3, (0.30, 0.21, 0.07)), (0.7, (0.45, 0.33, 0.12))])
    ears = m.noise(45, 10, 0.8)
    col = m.mix(0.6, col, ears.outputs['Color'], 'OVERLAY')
    gaps = m.mr(m.voronoi(16).outputs['Distance'], 0.08, 0.0)
    col = m.mix(m.op('MULTIPLY', gaps, 0.6), col, (0.16, 0.11, 0.05))
    green = m.mr(m.noise(0.35).outputs['Fac'], 0.6, 0.72)
    col = m.mix(m.op('MULTIPLY', green, 0.5), col, (0.33, 0.33, 0.12))
    return m.finish(col, 0.75, ears.outputs['Fac'], 0.6, 0.03)

def wasser():
    m = M('wasser')
    col = m.ramp(m.noise(0.4, 4).outputs['Fac'], [(0.3, (0.035, 0.08, 0.085)), (0.7, (0.06, 0.12, 0.12))])
    mp = m.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1.0, 2.5, 1.0)
    waves = m.noise(1.6, 8, 0.6, 0.4)
    return m.finish(col, 0.06, waves.outputs['Fac'], 0.35, 0.08)

def pflaster():
    """Kopfsteinpflaster der Dorfstraße: Reihen rundlicher Steine, dunkle Fugen, ausgefahrene Mitte"""
    m = M('pflaster')
    vo = m.voronoi(5.5, 'DISTANCE_TO_EDGE')
    vc = m.voronoi(5.5)
    col = m.ramp(vc.outputs['Color'], [(0.0, (0.14, 0.13, 0.12)), (0.5, (0.24, 0.22, 0.19)), (1.0, (0.32, 0.29, 0.25))])
    col = m.mix(m.mr(vo.outputs['Distance'], 0.08, 0.0), col, (0.05, 0.045, 0.035))
    col = m.mix(0.35, col, m.noise(30, 10).outputs['Color'], 'OVERLAY')
    dirt = m.mr(m.noise(0.5, 6).outputs['Fac'], 0.5, 0.7)
    col = m.mix(m.op('MULTIPLY', dirt, 0.6), col, (0.15, 0.12, 0.08))
    return m.finish(col, 0.75, m.mr(vo.outputs['Distance'], 0.0, 0.15), 0.9, 0.04)

KINDS = {'pflaster': pflaster, 'gras': gras, 'waldboden': waldboden, 'sand': sand, 'felsboden': felsboden, 'erde': erde,
         'acker': acker, 'saat': saat, 'weizen': weizen, 'wasser': wasser}
for name, fn in KINDS.items():
    if ONLY and name not in ONLY: continue
    PLANE.data.materials.clear(); PLANE.data.materials.append(fn())
    S.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
    print('fertig', name)
