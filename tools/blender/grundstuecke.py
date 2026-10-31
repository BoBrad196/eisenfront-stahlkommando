# Dorfgrundstücke für Eisenfront: jedes Grundstück liegt an der Straße (im Modell auf der −Y-Seite),
# Haus mit Tür und Vorgarten zur Straße, dahinter Hof, Garten, Schuppen und Obstbäume.
# Gerendert in vier Ausrichtungen (Straße an +y, +x, −y, −x der Spielkacheln).
# Aufruf: python grundstuecke.py <ausgabeordner> [schlüssel ...]   (z. B. haus0 hof1 kirche0)
import bpy, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eflib as E
import gebaeude1940 as G
from gebaeude1940 import house, fence, wall, garden, fruit_tree, woodpile, washing_line, crate, barrel, cart, pile
from eflib import block, box, cyl, line_cyl, prism, frustum, soft, wobble, soft_patch, mesh_boxes, RX, RY
from mathutils import Vector

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 32))
T = E.TILE_M

def lot_base(F, D, rnd, yard='hof'):
    """Grundstücksboden: Hof/Garten mit weich auslaufendem Rand, Zugangsweg zur Straße"""
    hx, hy = F * T / 2, D * T / 2
    soft_patch('Grund', -hx + 0.1, -hy + 0.1, hx - 0.1, hy - 0.1, E.ground1940('Grund', 'gras'), fade=0.35, z=0.02)
    return hx, hy

def street_fence(hx, hy, rnd, gate_x, M, gate_w=1.4, kind='latten'):
    """Zaun oder Mauer entlang der Straße (−Y) mit Tor bei gate_x"""
    y = -hy + 0.25
    left = [(-hx + 0.2, y + rnd.uniform(-0.05, 0.05)), (gate_x - gate_w / 2, y)]
    right = [(gate_x + gate_w / 2, y), (hx - 0.2, y + rnd.uniform(-0.05, 0.05))]
    for k, pts in enumerate((left, right)):
        if abs(pts[1][0] - pts[0][0]) < 0.5: continue
        if kind == 'mauer': wall(f'Strassenmauer{k}', pts, M, 'stone', h=0.9, th=0.4, rnd=rnd)
        else: fence(f'Strassenzaun{k}', pts, M, rnd, h=1.0, gap=0.14)
    for s in (-1, 1): cyl(f'Torpfosten{s}', 0.12, 1.3, (gate_x + s * gate_w / 2, y, 0.65), M['wood_g'] if kind != 'mauer' else M['stone'], verts=8)

def side_fences(hx, hy, rnd, M):
    fence('Seitenzaun', [(-hx + 0.2, -hy + 0.3), (-hx + 0.15, hy - 0.2)], M, rnd, h=1.1, gap=0.2, missing=0.12)
    fence('Hinterzaun', [(-hx + 0.15, hy - 0.2), (hx - 0.2, hy - 0.25)], M, rnd, h=1.1, gap=0.2, missing=0.12)

def path(x0, y0, x1, y1, w=0.9):
    soft_patch('Weg', min(x0, x1) - w / 2, min(y0, y1), max(x0, x1) + w / 2, max(y0, y1), E.ground1940('Weg', 'hof'), fade=0.15, z=0.04)

# ---------------- Grundstücksarten ----------------
def haus(variant):
    def build(M, rnd):
        F, D = 2, 2
        hx, hy = lot_base(F, D, rnd)
        style = ['fachwerk', 'ziegel', 'putz'][variant]
        roof = ['tiles', 'tiles_d', 'tiles'][variant]
        floors = [2, 1, 1][variant]
        l, w = [(7.6, 5.8), (8.4, 6.2), (7.0, 5.6)][variant]
        cx = rnd.uniform(-hx + l / 2 + 0.6, hx - l / 2 - 0.6) if hx * 2 - l > 1.4 else 0
        cy = -hy + 1.6 + w / 2
        chim = [house('Haus', cx, cy, l, w, M, rnd, floors=floors, style=style, roof=roof, ridge='x', rot=rnd.uniform(-0.03, 0.03),
                      dormer=variant == 1, shed=1.8 if variant == 2 else None, lit=0.4)]
        gate = cx + rnd.uniform(-1.5, 1.5)
        street_fence(hx, hy, rnd, gate, M, kind='mauer' if variant == 1 else 'latten')
        path(gate, -hy + 0.3, gate, -hy + 1.6)
        side_fences(hx, hy, rnd, M)
        # Garten hinter dem Haus
        garden('Beet1', -hx + 0.8, hy - 3.2, -hx + 4.2, hy - 0.8, M, rnd)
        fruit_tree('Obstbaum', hx - 2.0, hy - 1.8, 5.0 + rnd.uniform(-0.6, 0.8), M, rnd)
        if variant == 0: washing_line('Leine', (0.6, hy - 1.0), (3.4, hy - 1.4), M, rnd)
        else: woodpile('Holz', hx - 1.2, cy + w / 2 + 1.0, 1.8, M, rnd, rot=1.57)
        return {'smoke': [c for c in chim if c]}
    return build, 2, 2

def hof(variant):
    def build(M, rnd):
        F, D = 3, 2
        hx, hy = lot_base(F, D, rnd)
        soft_patch('Hofplatz', -2.0, -hy + 0.5, hx - 0.6, hy - 2.0, E.ground1940('Hofplatz', 'hof'), fade=0.4, z=0.04)
        style = 'fachwerk' if variant == 0 else 'ziegel'
        chim = [house('Bauernhaus', -hx + 4.4, -hy + 1.5 + 3.0, 7.6, 6.0, M, rnd, floors=2 if variant == 0 else 1, style=style, roof='tiles',
                      ridge='y', rot=rnd.uniform(-0.03, 0.03), dormer=variant == 1, lit=0.4)]
        # Scheune hinten quer
        o = block('Scheune', -1.0, hy - 6.4, 0, hx - 0.5, hy - 0.8, 4.2, M['wood_g'] if variant == 0 else M['brick'], bevel=0.05)
        soft(o, 0.06, 3); wobble(o, 0.03, 0.5)
        prism('Scheunendach', [(-2.95, 4.1), (2.95, 4.1), (0, 7.0)], (hx - 0.5) - (-1.0) + 0.6, M['tiles_d'], axis='x').location = ((hx - 1.5) / 2, hy - 3.6, 0)
        for k in range(2): box(f'Scheunentor{k}', (2.6, 0.1, 3.2), (0.6 + k * 4.2, hy - 6.45, 1.6), M['wood'], bevel=0.03)
        # Hofeinfahrt, Misthaufen, Karren, Strohballen
        street_fence(hx, hy, rnd, 3.0, M, gate_w=3.2, kind='mauer' if variant == 1 else 'latten')
        pile('Misthaufen', 4.6, -0.6, 1.3, 0.8, M['soil'])
        cart('Leiterwagen', 1.6, -1.8, 0.3, M)
        for k in range(3): cyl(f'Ballen{k}', 0.55, 1.1, (6.4, hy - 7.2 + k * 1.15, 0.55), M['gold'], rot=(0, 0, 0), verts=20)
        fence('Hinterzaun', [(-hx + 0.15, hy - 0.2), (hx - 0.2, hy - 0.25)], M, rnd, h=1.1, gap=0.2, missing=0.12)
        garden('Beet', -hx + 0.6, hy - 3.6, -hx + 3.6, hy - 0.8, M, rnd, rows_x=False)
        return {'smoke': [c for c in chim if c]}
    return build, 3, 2

def scheune(variant):
    def build(M, rnd):
        hx, hy = lot_base(2, 2, rnd)
        soft_patch('Hofplatz', -hx + 0.5, -hy + 0.4, hx - 0.5, -hy + 3.0, E.ground1940('Vorplatz', 'hof'), fade=0.3, z=0.04)
        o = block('Scheune', -3.8, -hy + 2.6, 0, 3.8, hy - 0.6, 4.6, M['wood_g'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.03, 0.5)
        prism('Dach', [(-hy + 2.2, 4.5), (hy - 0.2, 4.5), ((-hy + 2.2 + hy - 0.2) / 2, 7.6)], 8.4, M['tiles_d'], axis='y').location = (0, 0, 0)
        box('Tor', (3.0, 0.12, 3.6), (rnd.uniform(-1.5, 1.5), -hy + 2.55, 1.8), M['wood'], bevel=0.03)
        o = cyl('Heuschober', 1.2, 2.4, (hx - 1.4, hy - 1.4, 1.2), M['gold'], verts=20, r2=0.3); wobble(o, 0.1, 0.4)
        street_fence(hx, hy, rnd, 0.0, M, gate_w=3.4)
        for k in range(2): barrel(f'Fass{k}', (-hx + 1.0 + k * 0.7, -hy + 1.2, 0), M['wood'])
        return {}
    return build, 2, 2

def gasthaus(variant):
    def build(M, rnd):
        hx, hy = lot_base(2, 2, rnd)
        chim = [house('Gasthaus', 0.0, -hy + 1.3 + 3.3, 9.0, 6.6, M, rnd, floors=2, style='putz', roof='tiles_d', ridge='x', dormer=True, lit=0.65)]
        box('Wirtshausschild', (1.0, 0.06, 0.6), (2.8, -hy + 0.9, 3.4), M['wood'], bevel=0.02)
        line_cyl('Schildarm', (2.8, -hy + 1.3, 3.8), (2.8, -hy + 0.8, 3.8), 0.04, M['steel'], verts=6)
        # Biergarten hinten mit Kastanie, Tischen und Bänken
        fruit_tree('Kastanie', -2.2, hy - 2.0, 6.5, M, rnd)
        for k in range(3):
            x, y = -3.6 + k * 2.6, hy - 2.4 + (k % 2) * 0.8
            box(f'Tisch{k}', (1.6, 0.7, 0.08), (x, y, 0.75), M['wood'], bevel=0.02)
            for s in (-1, 1): box(f'Bank{k}{s}', (1.6, 0.3, 0.06), (x, y + s * 0.7, 0.45), M['wood'], bevel=0.02)
        street_fence(hx, hy, rnd, 0.0, M, gate_w=2.0, kind='mauer')
        side_fences(hx, hy, rnd, M)
        for k in range(4): barrel(f'Fass{k}', (hx - 1.2, -hy + 2.0 + k * 0.7, 0), M['wood'])
        return {'smoke': [c for c in chim if c]}
    return build, 2, 2

def kirche(variant):
    def build(M, rnd):
        hx, hy = lot_base(3, 3, rnd)
        soft_patch('Kirchhof', -hx + 0.4, -hy + 0.4, hx - 0.4, hy - 0.4, E.ground1940('Kirchhof', 'gras'), fade=0.3, z=0.03)
        house('Kirche', -1.2, 1.6, 10.0, 6.2, M, rnd, floors=2, style='ziegel', roof='slate', ridge='y', pitch=52, lit=0.5, chimney=False)
        tx, ty = -1.2, -hy + 3.0
        o = block('Turm', tx - 1.6, ty - 1.6, 0, tx + 1.6, ty + 1.6, 13.5, M['brick'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.02, 0.5)
        box('Portal', (1.4, 0.12, 2.6), (tx, ty - 1.66, 1.3), M['door'], bevel=0.03)
        for k, (ax, pl) in enumerate((('y', ty - 1.62), ('x', tx + 1.62))):
            G.windows_face(f'Schall{k}', M, rnd, ax, pl, (tx - 1.4) if ax == 'y' else (ty - 1.4), (tx + 1.4) if ax == 'y' else (ty + 1.4), 10.4, 12.8, 2, h=1.1, w=0.5, lit=0, shutters=0)
        box('Uhr', (1.0, 0.08, 1.0), (tx, ty - 1.65, 9.0), M['white'], bevel=0.02)
        frustum('Helm', (3.6, 3.6, 7.5), (tx, ty, 17.25), M['copper'], top=(0.03, 0.03))
        line_cyl('Kreuz1', (tx, ty, 21.0), (tx, ty, 22.4), 0.05, M['gold'], verts=6)
        line_cyl('Kreuz2', (tx - 0.45, ty, 21.9), (tx + 0.45, ty, 21.9), 0.05, M['gold'], verts=6)
        wall('Kirchmauer', [(-hx + 0.3, -hy + 0.3), (tx - 1.2, -hy + 0.25)], M, 'stone', h=1.0, rnd=rnd)
        wall('Kirchmauer2', [(tx + 1.2, -hy + 0.25), (hx - 0.3, -hy + 0.35), (hx - 0.25, hy - 0.3), (-hx + 0.3, hy - 0.3), (-hx + 0.3, -hy + 0.3)], M, 'stone', h=1.0, rnd=rnd)
        for k in range(9):
            x, y = 3.0 + (k % 3) * 1.6 + rnd.uniform(-0.2, 0.2), -4.0 + (k // 3) * 2.4
            box(f'Grab{k}', (0.5, 0.14, 0.75), (x, y, 0.37), M['stone'], rot=(rnd.uniform(-0.1, 0.1), 0, rnd.uniform(-0.1, 0.1)), bevel=0.05)
            o = block(f'Grabbeet{k}', x - 0.4, y + 0.1, 0, x + 0.4, y + 1.6, 0.15, M['soil'], bevel=0.05)
        fruit_tree('Linde1', hx - 1.6, hy - 1.8, 8.0, M, rnd)
        fruit_tree('Linde2', -hx + 1.6, -hy + 2.0, 7.0, M, rnd)
        return {}
    return build, 3, 3

def haus_neu(variant):
    """weitere Wohnhäuser: 3 Klinker giebelständig, 4 kleine Fachwerkkate, 5 Putzhaus mit Vorgarten und Bienen"""
    def build(M, rnd):
        hx, hy = lot_base(2, 2, rnd)
        chim = []
        if variant == 3:
            cx = rnd.uniform(-1.0, 0.6)
            chim.append(house('Haus', cx, -hy + 1.4 + 4.0, 8.0, 6.0, M, rnd, floors=2, style='klinker', roof='slate', ridge='y', rot=rnd.uniform(-0.03, 0.03), lit=0.4))
            street_fence(hx, hy, rnd, cx + 3.6, M, kind='mauer', gate_w=1.2)
            path(cx + 3.6, -hy + 0.3, cx + 3.6, -hy + 3.2)
            side_fences(hx, hy, rnd, M)
            garden('Beet', -hx + 0.7, hy - 2.4, 1.0, hy - 0.7, M, rnd)
            woodpile('Holz', hx - 1.0, hy - 1.6, 1.6, M, rnd, rot=1.57)
            o = block('Schuppen', hx - 2.6, hy - 4.6, 0, hx - 0.6, hy - 2.8, 2.1, M['wood_g'], bevel=0.03); wobble(o, 0.03, 0.5)
            box('Schuppendach', (2.4, 2.2, 0.08), (hx - 1.6, hy - 3.7, 2.25), M['tar'], rot=(0.18, 0, 0), bevel=0.02)
        elif variant == 4:
            cx = rnd.uniform(-1.6, -0.6)
            chim.append(house('Kate', cx, -hy + 1.7 + 2.6, 6.4, 5.2, M, rnd, floors=1, style='fachwerk', roof='tiles_d', ridge='x', pitch=52,
                              rot=rnd.uniform(-0.05, 0.05), shed=2.0, lit=0.3))
            street_fence(hx, hy, rnd, cx - 1.8, M, gate_w=1.2)
            path(cx - 1.8, -hy + 0.3, cx - 1.8, -hy + 1.7)
            side_fences(hx, hy, rnd, M)
            garden('Beet1', -hx + 0.7, hy - 4.0, -hx + 3.6, hy - 0.7, M, rnd, rows_x=False)
            garden('Beet2', -hx + 4.2, hy - 2.6, 1.6, hy - 0.7, M, rnd)
            fruit_tree('Obstbaum', hx - 1.8, hy - 2.0, 4.6, M, rnd)
            # Hühnerstall mit Auslauf
            o = block('Huehnerstall', hx - 3.6, hy - 5.2, 0.3, hx - 2.0, hy - 4.0, 1.4, M['wood_g'], bevel=0.03); wobble(o, 0.03, 0.5)
            box('Stalldach', (1.9, 1.5, 0.06), (hx - 2.8, hy - 4.6, 1.5), M['tar'], rot=(0.2, 0, 0), bevel=0.01)
            fence('Auslauf', [(hx - 3.7, hy - 3.9), (hx - 3.7, hy - 3.1), (hx - 2.0, hy - 3.1), (hx - 2.0, hy - 3.9)], M, rnd, h=0.7, gap=0.25, missing=0.1)
            barrel('Regentonne', (cx + 3.5, -hy + 4.5, 0), M['wood'], r=0.35, h=0.9)
        else:
            cx = rnd.uniform(-0.6, 0.6)
            chim.append(house('Haus', cx, -hy + 2.8 + 2.8, 7.4, 5.6, M, rnd, floors=2, style='putz', roof='tiles', ridge='x', rot=rnd.uniform(-0.03, 0.03),
                              dormer=True, lit=0.45))
            street_fence(hx, hy, rnd, cx, M, gate_w=1.2)
            path(cx, -hy + 0.3, cx, -hy + 2.8, w=1.0)
            # Vorgarten mit Blumenbeeten, Bienenstöcke hinten
            garden('Blumen1', -hx + 0.6, -hy + 0.7, cx - 0.9, -hy + 2.4, M, rnd)
            garden('Blumen2', cx + 0.9, -hy + 0.7, hx - 0.6, -hy + 2.4, M, rnd)
            side_fences(hx, hy, rnd, M)
            for k in range(3): box(f'Bienenstock{k}', (0.55, 0.5, 0.6), (-hx + 1.2 + k * 0.8, hy - 1.0, 0.45), M['wood' if k % 2 else 'plaster_y'], bevel=0.03)
            fruit_tree('Obstbaum', hx - 1.8, hy - 1.6, 5.2, M, rnd)
            washing_line('Leine', (0.0, hy - 1.6), (2.6, hy - 1.0), M, rnd)
        return {'smoke': [c for c in chim if c]}
    return build, 2, 2

def hof_dreiseit(variant):
    """Dreiseithof: Wohnhaus links, Scheune hinten, Stall rechts, gepflasterter Hof mit Tor zur Straße"""
    def build(M, rnd):
        F, D = 3, 2
        hx, hy = lot_base(F, D, rnd)
        soft_patch('Hofplatz', -hx + 6.0, -hy + 0.5, hx - 4.4, hy - 3.4, E.ground1940('Hofplatz', 'pflaster'), fade=0.3, z=0.04)
        chim = [house('Wohnhaus', -hx + 3.3, -hy + 0.6 + 4.6, 9.0, 5.4, M, rnd, floors=2, style='ziegel', roof='tiles_d', ridge='y', rot=rnd.uniform(-0.02, 0.02), lit=0.4)]
        o = block('Scheune', -hx + 6.2, hy - 3.4, 0, hx - 0.4, hy - 0.4, 4.0, M['brick'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.03, 0.5)
        prism('Scheunendach', [(-1.75, 3.9), (1.75, 3.9), (0, 6.3)], (hx - 0.4) - (-hx + 6.2) + 0.5, M['tiles'], axis='x').location = ((hx - 0.4 + -hx + 6.2) / 2, hy - 1.9, 0)
        box('Scheunentor', (3.0, 0.1, 3.2), (1.2, hy - 3.45, 1.6), M['wood'], bevel=0.03)
        o = block('Stall', hx - 4.2, -hy + 1.4, 0, hx - 0.5, hy - 3.6, 3.0, M['wood_g'], bevel=0.04); soft(o, 0.05, 3); wobble(o, 0.03, 0.5)
        sw = (hx - 0.5) - (hx - 4.2)
        prism('Stalldach', [(-sw / 2 - 0.3, 2.9), (sw / 2 + 0.3, 2.9), (0, 4.7)], (hy - 3.6) - (-hy + 1.4) + 0.4, M['tiles_d'], axis='y').location = (hx - 2.35, (hy - 3.6 + -hy + 1.4) / 2, 0)
        for k in range(2): box(f'Stalltuer{k}', (0.1, 1.1, 1.9), (hx - 4.25, -hy + 2.4 + k * 2.4, 0.95), M['door'], bevel=0.02)
        wall('Hofmauer', [(-hx + 6.0, -hy + 0.3), (-0.6, -hy + 0.3)], M, 'brick', h=1.6, th=0.35, rnd=rnd)
        wall('Hofmauer2', [(2.8, -hy + 0.3), (hx - 4.2, -hy + 0.3)], M, 'brick', h=1.6, th=0.35, rnd=rnd)
        for s, x in ((-1, -0.6), (1, 2.8)): o = block(f'Torpfeiler{s}', x - 0.3, -hy + 0.05, 0, x + 0.3, -hy + 0.6, 2.1, M['brick_d'], bevel=0.04)
        pile('Misthaufen', 2.6, 0.2, 1.1, 0.7, M['soil'])
        cart('Leiterwagen', -1.2, 1.2, 1.3, M)
        o = cyl('Brunnen', 0.5, 0.9, (-hx + 7.2, -hy + 1.6, 0.45), M['stone'], verts=16); wobble(o, 0.03)
        fruit_tree('Hofbaum', -hx + 1.4, hy - 1.3, 6.0, M, rnd)
        return {'smoke': [c for c in chim if c]}
    return build, 3, 2

def scheune_neu(variant):
    """Ziegelscheune giebelständig mit Holzanbau, Heuballen und Ackerwagen"""
    def build(M, rnd):
        hx, hy = lot_base(2, 2, rnd)
        soft_patch('Vorplatz', -hx + 0.5, -hy + 0.4, hx - 0.5, -hy + 2.6, E.ground1940('Vorplatz', 'hof'), fade=0.3, z=0.04)
        o = block('Scheune', -2.6, -hy + 2.4, 0, 2.6, hy - 1.0, 4.4, M['brick'], bevel=0.05); soft(o, 0.06, 3); wobble(o, 0.03, 0.5)
        prism('Dach', [(-2.95, 4.3), (2.95, 4.3), (0, 7.4)], (hy - 1.0) - (-hy + 2.4) + 0.6, M['tiles'], axis='y').location = (0, (hy - 1.0 + -hy + 2.4) / 2, 0)
        box('Tor', (2.6, 0.12, 3.4), (0, -hy + 2.35, 1.7), M['wood'], bevel=0.03)
        o = block('Anbau', 2.55, -hy + 3.2, 0, hx - 0.4, hy - 1.6, 2.6, M['wood_g'], bevel=0.03); wobble(o, 0.03, 0.5)
        box('Anbaudach', ((hx - 0.4) - 2.55 + 0.4, (hy - 1.6) - (-hy + 3.2) + 0.4, 0.08), ((hx - 0.4 + 2.55) / 2, (hy - 1.6 + -hy + 3.2) / 2, 2.85), M['tin'], rot=(0, math.radians(-12), 0), bevel=0.02)
        for k in range(4): cyl(f'Ballen{k}', 0.55, 1.1, (-hx + 1.0, -hy + 3.4 + k * 1.15, 0.55), M['gold'], verts=20)
        cart('Ackerwagen', 2.6, -hy + 1.2, 0.2, M)
        street_fence(hx, hy, rnd, 0.0, M, gate_w=3.2)
        fence('Hinterzaun', [(-hx + 0.15, hy - 0.2), (hx - 0.2, hy - 0.25)], M, rnd, h=1.1, gap=0.2, missing=0.15)
        return {}
    return build, 2, 2

def garten(variant):
    """0 Obstwiese mit Bienen und Gartenhaus, 1 Gemüsegarten mit Laube, Kompost und Regentonne"""
    def build(M, rnd):
        hx, hy = lot_base(2, 2, rnd)
        street_fence(hx, hy, rnd, rnd.uniform(-2.5, 2.5), M, gate_w=1.1)
        side_fences(hx, hy, rnd, M)
        if variant == 0:
            for k in range(6):
                x = -hx + 2.2 + (k % 3) * 3.4 + rnd.uniform(-0.5, 0.5)
                y = -hy + 3.0 + (k // 3) * 4.4 + rnd.uniform(-0.5, 0.5)
                fruit_tree(f'Obstbaum{k}', x, y, rnd.uniform(4.2, 5.8), M, rnd)
            for k in range(3): box(f'Bienenstock{k}', (0.55, 0.5, 0.6), (hx - 1.0, -hy + 1.6 + k * 0.8, 0.45), M['wood' if k % 2 else 'plaster_y'], bevel=0.03)
            o = block('Gartenhaus', -hx + 0.6, hy - 2.4, 0, -hx + 2.6, hy - 0.6, 2.1, M['wood_g'], bevel=0.03); wobble(o, 0.03, 0.5)
            prism('Gartenhausdach', [(-1.1, 2.0), (1.1, 2.0), (0, 2.9)], 2.4, M['tar'], axis='x').location = (-hx + 1.6, hy - 1.5, 0)
        else:
            for k in range(4):
                x0 = -hx + 0.8 + (k % 2) * 4.6; y0 = -hy + 1.2 + (k // 2) * 3.6
                garden(f'Beet{k}', x0, y0, x0 + 3.8, y0 + 2.8, M, rnd, rows_x=bool(k % 2))
            path(-0.3, -hy + 0.3, -0.3, hy - 2.4, w=0.8)
            o = block('Laube', hx - 3.0, hy - 2.6, 0, hx - 0.6, hy - 0.6, 2.2, M['wood_g'], bevel=0.03); wobble(o, 0.03, 0.5)
            box('Laubendach', (2.8, 2.4, 0.08), (hx - 1.8, hy - 1.6, 2.35), M['tar'], rot=(0.15, 0, 0), bevel=0.02)
            pile('Kompost', -hx + 1.4, hy - 1.4, 0.9, 0.6, M['soil'])
            barrel('Regentonne', (hx - 3.4, hy - 1.0, 0), M['wood'], r=0.35, h=0.9)
            fruit_tree('Obstbaum', -hx + 1.8, hy - 3.6, 4.8, M, rnd)
        return {}
    return build, 2, 2

def gemeinde(variant):
    """Gemeindehaus (Rathaus) mit Dachreiter, davor gepflasterter Dorfplatz mit Linde, Brunnen, Bänken und Fahnenmast"""
    def build(M, rnd):
        hx, hy = lot_base(3, 3, rnd)
        soft_patch('Dorfplatz', -hx + 0.3, -hy + 0.3, hx - 0.3, 2.4, E.ground1940('Dorfplatz', 'pflaster'), fade=0.25, z=0.05)
        chim = [house('Gemeindehaus', 0.4, hy - 0.8 - 3.3, 11.0, 6.6, M, rnd, floors=2, style='putz', roof='tiles_d', ridge='x', pitch=45, lit=0.55)]
        # Dachreiter mit Glocke
        bx, by, bz = 0.4 + 2.2, hy - 4.1, 0.5 + 5.6 + 3.3 + 0.8
        o = block('Dachreiter', bx - 0.6, by - 0.6, bz - 1.4, bx + 0.6, by + 0.6, bz + 0.8, M['wood_g'], bevel=0.03); wobble(o, 0.01)
        frustum('Dachreiterhelm', (1.6, 1.6, 1.6), (bx, by, bz + 1.6), M['copper'], top=(0.03, 0.03))
        box('Eingang', (2.0, 0.6, 0.4), (0.4, hy - 7.65, 0.2), M['stone'], bevel=0.05)
        box('Schild', (2.6, 0.06, 0.5), (0.4, hy - 7.45, 3.2), M['white'], bevel=0.01)
        # Linde, Brunnen, Bänke, Fahnenmast
        fruit_tree('Dorflinde', -hx + 3.2, -hy + 3.4, 8.5, M, rnd)
        o = block('Bank1', -hx + 1.6, -hy + 5.6, 0.4, -hx + 4.8, -hy + 6.0, 0.48, M['wood'], bevel=0.02)
        o = cyl('Brunnen', 1.1, 0.7, (2.6, -hy + 4.0, 0.35), M['stone'], verts=24, bevel=0.05); wobble(o, 0.03)
        cyl('Brunnenwasser', 0.95, 0.05, (2.6, -hy + 4.0, 0.68), M['glass'], verts=24)
        line_cyl('Brunnensaeule', (2.6, -hy + 4.0, 0.7), (2.6, -hy + 4.0, 1.8), 0.15, M['stone'], verts=10)
        for k in range(2): box(f'Bank{k + 2}', (2.4, 0.4, 0.08), (hx - 2.4, -hy + 2.2 + k * 3.2, 0.45), M['wood'], bevel=0.02)
        flag = G.flagpole(-hx + 6.6, -hy + 1.6, 9.0, M)
        o = cyl('Mastsockel', 0.4, 0.3, (-hx + 6.6, -hy + 1.6, 0.15), M['stone'], verts=12)
        # hinten Zaun, seitlich niedrige Mauer
        fence('Hinterzaun', [(-hx + 0.15, hy - 0.2), (hx - 0.2, hy - 0.25)], M, rnd, h=1.1, gap=0.2, missing=0.1)
        wall('Platzmauer', [(-hx + 0.3, 2.6), (-hx + 0.3, hy - 0.4)], M, 'stone', h=0.8, th=0.4, rnd=rnd)
        wall('Platzmauer2', [(hx - 0.3, 2.6), (hx - 0.3, hy - 0.4)], M, 'stone', h=0.8, th=0.4, rnd=rnd)
        return {'smoke': [c for c in chim if c], 'flag': flag}
    return build, 3, 3

def muehle(variant):
    """0 Wassermühle mit unterschlächtigem Rad am Mühlgraben, 1 Bockwindmühle auf einem Hügel. Rad bzw. Flügel drehen sich."""
    def build(M, rnd):
        F, D = 3, 2
        hx, hy = lot_base(F, D, rnd)
        wasser = E.plain('Wasser', (0.025, 0.05, 0.05), 0.04, 0.0)
        segel = E.plain('Segeltuch', (0.2, 0.16, 0.11), 1.0)
        chim = []
        anim = []
        if variant == 0:
            soft_patch('Muehlhof', -hx + 0.4, -hy + 0.4, 2.0, -hy + 2.6, E.ground1940('Muehlhof', 'hof'), fade=0.3, z=0.04)
            chim.append(house('Muehle', -2.2, -0.8, 9.0, 6.8, M, rnd, floors=2, style='fachwerk', roof='tiles_d', ridge='x', rot=0.0, lit=0.45))
            # Mühlgraben vom Teich hinten bis zum Durchlass an der Straße, mit Steinkanten
            gx = 3.6
            block('Graben', gx - 0.9, -hy + 0.6, 0.0, gx + 0.9, hy - 2.4, 0.06, wasser, bevel=0)
            for s_ in (-1, 1):
                o = block(f'Grabenkante{s_}', gx + s_ * 1.05 - 0.18, -hy + 0.5, 0, gx + s_ * 1.05 + 0.18, hy - 2.5, 0.35, M['stone'], bevel=0.05); wobble(o, 0.03, 0.4)
            o = block('Durchlass', gx - 1.3, -hy + 0.2, 0, gx + 1.3, -hy + 1.0, 0.7, M['stone'], bevel=0.08); soft(o, 0.06, 3); wobble(o, 0.03)
            o = cyl('Teich', 2.6, 0.06, (gx + 1.4, hy - 2.4, 0.0), wasser, verts=40); o.scale = (1.0, 0.75, 1)
            for k in range(14):
                a = rnd.uniform(0, 2 * math.pi); r = 2.5 + rnd.uniform(-0.1, 0.3)
                line_cyl(f'Schilf{k}', (gx + 1.4 + r * math.cos(a), hy - 2.4 + 0.75 * r * math.sin(a), 0), (gx + 1.4 + r * math.cos(a) + rnd.uniform(-0.15, 0.15), hy - 2.4 + 0.75 * r * math.sin(a), rnd.uniform(0.7, 1.2)), 0.03, M['veg'], verts=4)
            fruit_tree('Weide', -hx + 2.0, hy - 1.6, 6.5, M, rnd)
            # Wasserrad an der Giebelseite (Achse = x), taucht in den Graben
            prev = E.PARENT; rad = E.pivot('Wasserrad', (gx, -0.6, 2.0))
            E.spoke_wheel('Rad', 2.3, 0.9, 8, M['wood'], paddles=16)
            E.set_parent(prev)
            line_cyl('Radwelle', (2.3, -0.6, 2.0), (gx + 0.7, -0.6, 2.0), 0.14, M['wood'], verts=10)
            for s_ in (-1, 1): line_cyl(f'Lager{s_}', (gx + s_ * 0.75, -0.6, 0.2), (gx + s_ * 0.75, -0.6, 2.0), 0.12, M['wood'], verts=8)
            # unterschlächtig: Schaufeln laufen unten mit dem Wasser Richtung Straße (−y); 8 Speichen = 45° Wiederholung
            def pose(root, k): root.rotation_euler = (-k * math.radians(45) / 12, 0, 0)
            anim.append({'root': rad, 'frames': 12, 'fps': 8, 'pose': pose})
            for k in range(5): o = cyl(f'Sack{k}', 0.32, 0.8, (-hx + 1.0 + k * 0.62, -hy + 1.6 + (k % 2) * 0.3, 0.4), M['canvas'], verts=12, r2=0.22); wobble(o, 0.04, 0.3)
            o = cyl('Muehlstein', 0.9, 0.3, (-6.9, -3.6, 0.9), M['stone'], rot=(math.radians(80), 0, 0.3), verts=24, bevel=0.04)
            street_fence(hx, hy, rnd, -2.6, M, gate_w=3.0, kind='latten')
        else:
            o = pile('Huegel', 1.0, 0.6, 4.6, 1.0, E.ground1940('Huegel', 'gras'))
            chim.append(house('Muellerhaus', -5.0, -hy + 1.5 + 2.4, 5.6, 4.8, M, rnd, floors=1, style='fachwerk', roof='tiles', ridge='y', rot=0.03, lit=0.4))
            cx, cy, zb = 1.0, 0.6, 3.4
            # Bock: Steinsockel, Kreuzschwellen, Streben, Hausbaum
            for a in (0, math.pi / 2):
                line_cyl(f'Schwelle{a}', (cx - 2.4 * math.cos(a), cy - 2.4 * math.sin(a), 1.2), (cx + 2.4 * math.cos(a), cy + 2.4 * math.sin(a), 1.2), 0.22, M['wood'], verts=8)
            for k in range(4):
                a = k * math.pi / 2
                o = block(f'Sockel{k}', cx + 2.2 * math.cos(a) - 0.4, cy + 2.2 * math.sin(a) - 0.4, 0.4, cx + 2.2 * math.cos(a) + 0.4, cy + 2.2 * math.sin(a) + 0.4, 1.05, M['stone'], bevel=0.05)
                line_cyl(f'Strebe{k}', (cx + 2.0 * math.cos(a), cy + 2.0 * math.sin(a), 1.2), (cx, cy, zb - 0.3), 0.14, M['wood'], verts=8)
            line_cyl('Hausbaum', (cx, cy, 1.0), (cx, cy, zb + 0.2), 0.3, M['wood'], verts=10)
            # Mühlenkasten aus Brettern mit Satteldach, Achse und Flügel zur +x-Seite
            o = block('Kasten', cx - 2.2, cy - 1.8, zb, cx + 2.2, cy + 1.8, zb + 4.6, M['wood'], bevel=0.05); soft(o, 0.05, 3); wobble(o, 0.03, 0.5)
            prism('Kastendach', [(-2.1, zb + 4.5), (2.1, zb + 4.5), (0, zb + 6.3)], 4.8, M['tiles_d'], axis='x').location = (cx, cy, 0)
            box('Kastentuer', (0.08, 1.0, 1.8), (cx - 2.22, cy, zb + 0.95), M['door'], bevel=0.02)
            line_cyl('Steert', (cx - 2.2, cy, zb + 0.6), (cx - 6.6, cy, 0.4), 0.13, M['wood'], verts=8)
            cyl('Steertrad', 0.45, 0.12, (cx - 6.6, cy, 0.45), M['wood'], rot=RX, verts=16)
            line_cyl('Treppe', (cx - 2.2, cy + 0.6, zb + 0.1), (cx - 5.2, cy + 0.6, 0.3), 0.08, M['wood'], verts=6)
            line_cyl('Treppe2', (cx - 2.2, cy - 0.6, zb + 0.1), (cx - 5.2, cy - 0.6, 0.3), 0.08, M['wood'], verts=6)
            for k in range(7):
                t = (k + 0.5) / 7
                line_cyl(f'Stufe{k}', (cx - 2.2 - 3.0 * t, cy - 0.6, zb + 0.1 - (zb - 0.2) * t), (cx - 2.2 - 3.0 * t, cy + 0.6, zb + 0.1 - (zb - 0.2) * t), 0.05, M['wood'], verts=6)
            hz = zb + 3.6
            line_cyl('Welle', (cx + 1.6, cy, hz), (cx + 2.9, cy, hz), 0.22, M['wood'], verts=12)
            prev = E.PARENT; fl = E.pivot('Fluegel', (cx + 2.8, cy, hz))
            L = 6.6
            for k in range(4):
                a = k * math.pi / 2 + math.radians(20)
                ca, sa = math.cos(a), math.sin(a)
                line_cyl(f'Rute{k}', (0, 0, 0), (0, L * ca, L * sa), 0.1, M['wood'], verts=6)
                # Gatter mit Segeltuch auf einer Seite der Rute
                nx, ny = -sa, ca
                for j in range(5):
                    t = 1.6 + j * (L - 1.8) / 4
                    line_cyl(f'Scheide{k}{j}', (0.05, t * ca, t * sa), (0.05, t * ca + 1.5 * nx, t * sa + 1.5 * ny), 0.035, M['wood'], verts=4)
                line_cyl(f'Saumlatte{k}', (0.05, 1.6 * ca + 1.5 * nx, 1.6 * sa + 1.5 * ny), (0.05, L * ca + 1.5 * nx, L * sa + 1.5 * ny), 0.04, M['wood'], verts=4)
                mid = (L + 1.6) / 2
                box(f'Segel{k}', (0.03, L - 1.8, 1.4), (0.09, mid * ca + 0.75 * nx, mid * sa + 0.75 * ny), segel, rot=(a, 0, 0), bevel=0)
            cyl('Nabe', 0.35, 0.5, (0, 0, 0), M['wood'], rot=RY, verts=12)
            E.set_parent(prev)
            # vier Flügel: nach 90° wieder gleich
            def pose(root, k): root.rotation_euler = (k * math.radians(90) / 16, 0, 0)
            anim.append({'root': fl, 'frames': 16, 'fps': 6, 'pose': pose})
            path(-1.0, -hy + 0.3, -1.0, -2.6, w=1.0)
            for k in range(4): o = cyl(f'Sack{k}', 0.32, 0.8, (-2.2 + k * 0.6, -3.0, 0.4), M['canvas'], verts=12, r2=0.22); wobble(o, 0.04, 0.3)
            cart('Muellerwagen', 4.6, -3.4, 0.3, M)
            street_fence(hx, hy, rnd, -1.0, M, gate_w=2.4, kind='latten')
        return {'smoke': [c for c in chim if c], 'anim': anim}
    return build, 3, 2

PLOTS = {}
for k in range(3): PLOTS[f'haus{k}'] = haus(k)
for k in range(3, 6): PLOTS[f'haus{k}'] = haus_neu(k)
for k in range(2): PLOTS[f'hof{k}'] = hof(k)
PLOTS['hof2'] = hof_dreiseit(0)
PLOTS['scheune0'] = scheune(0)
PLOTS['scheune1'] = scheune_neu(0)
PLOTS['gasthaus0'] = gasthaus(0)
PLOTS['kirche0'] = kirche(0)
for k in range(2): PLOTS[f'garten{k}'] = garten(k)
PLOTS['gemeinde0'] = gemeinde(0)
for k in range(2): PLOTS[f'muehle{k}'] = muehle(k)

# Straßenseite (Spielkacheln) -> Drehung des Modells (Straße liegt im Modell auf −Y = Kachel +y)
FACES = {'py': 0, 'px': 90, 'ny': 180, 'nx': 270}

meta = {}
for key, (fn, F, D) in PLOTS.items():
    if ONLY and key not in ONLY: continue
    for face, deg in FACES.items():
        if os.environ.get('FACES') and face not in os.environ['FACES'].split(','): continue
        E.reset(key)
        M = G.materials()
        rnd = random.Random(sum(map(ord, key)))
        info = fn(M, rnd) or {}
        a = math.radians(deg)
        E.REF.rotation_euler = (0, 0, a)
        w, h = (F, D) if deg in (0, 180) else (D, F)
        top = 175 if key.startswith('kirche') else 150 if key.startswith('muehle') else 120 if key.startswith('gemeinde') else 95
        m = max(16 * max(w, h), int(top * 0.85)); mb = max(16 * max(w, h), int(top * 0.45))
        Wl, ax, ay = (w + h) * 32 + 2 * m, m + w * 32, top + (w + h) * 16
        Hl = ay + mb
        Wx, Wy = w * T, h * T
        corner = (Wx / 2, -Wy / 2, 0)
        catcher = E.shadow_catcher()
        E.frame_camera(Wl * 2, Hl * 2, corner, ax * 2, ay * 2)
        anims = info.get('anim', [])
        E.hide_moving(anims)
        E.shoot(os.path.join(OUT, f'{key}.{face}.png'), SAMPLES)
        E.render_anims(anims, lambda gi, k: os.path.join(OUT, f'{key}.{face}.anim{gi}_{k}.png'), int(os.environ.get('ANIM_SAMPLES', SAMPLES)), catcher)
        for gi, an in enumerate(anims):
            meta[f'{key}.{face}.anim{gi}'] = {'frames': an['frames'], 'fps': an['fps'], 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0}
        sm = []
        for (x, y, z) in info.get('smoke', []):
            rx, ry = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
            sm.append([round((rx + Wx / 2) / T, 3), round((Wy / 2 - ry) / T, 3), round(z * 0.866 * E.PXM / 2 / 32, 3)])
        meta[f'{key}.{face}'] = {'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0, 'smoke': sm}
        if 'flag' in info:
            x, y, z = info['flag']
            rx, ry = x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a)
            meta[f'{key}.{face}']['flag'] = G.screen_offset((rx, ry, z), corner)
        print('fertig', key, face)
json.dump(meta, open(os.path.join(OUT, f'meta_{"_".join(ONLY) or "alle"}.json'), 'w'), indent=1)
