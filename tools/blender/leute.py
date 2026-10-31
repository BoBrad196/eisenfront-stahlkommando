# Dorfleben für Eisenfront: Bauer, Bäuerin (8 Richtungen × Stehen/Schritt/Schritt), Kuh und Pferd (Stehen/Grasen/Schritt).
# Aufruf: python leute.py <ausgabeordner> [name ...]
import bpy, math, sys, os, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import eflib as E
from eflib import box, cyl, line_cyl, sphere, frustum, RX, RY

OUT = sys.argv[1]
ONLY = sys.argv[2:]
SAMPLES = int(os.environ.get('SAMPLES', 32))

def mats():
    M = {}
    M['hose'] = E.painted('Hose', (0.06, 0.055, 0.05), 0.95, chips=False, mud_h=0.4, streaks=0, dust_amt=0.4, fade=0.4)
    M['hemd'] = E.painted('Hemd', (0.55, 0.52, 0.45), 0.9, chips=False, mud_h=0, streaks=0.2, dust_amt=0.3, fade=0.3)
    M['weste'] = E.painted('Weste', (0.16, 0.10, 0.06), 0.9, chips=False, mud_h=0, streaks=0, dust_amt=0.3, fade=0.4)
    M['rock'] = E.painted('Rock', (0.10, 0.11, 0.16), 0.95, chips=False, mud_h=0.3, streaks=0, dust_amt=0.3, fade=0.4)
    M['bluse'] = E.painted('Bluse', (0.42, 0.30, 0.24), 0.9, chips=False, mud_h=0, streaks=0, dust_amt=0.2, fade=0.3)
    M['schuerze'] = E.painted('Schuerze', (0.5, 0.48, 0.42), 0.9, chips=False, mud_h=0.2, streaks=0.3, dust_amt=0.3)
    M['tuch'] = E.painted('Kopftuch', (0.35, 0.08, 0.06), 0.9, chips=False, mud_h=0, streaks=0, fade=0.4)
    M['muetze'] = E.painted('Schiebermuetze', (0.12, 0.11, 0.09), 0.9, chips=False, mud_h=0, streaks=0)
    M['haut'] = E.plain('Haut', (0.5, 0.33, 0.24), 0.6)
    M['leder'] = E.painted('Leder', (0.05, 0.035, 0.02), 0.6, chips=False, mud_h=0.4, streaks=0)
    M['korb'] = E.oldwood('Korb', color=(0.3, 0.22, 0.12), grey=0.2)
    M['holz'] = E.oldwood('Stiel', color=(0.25, 0.18, 0.1), grey=0.3)
    M['kuh'] = E.camo('Fell', base=(0.4, 0.38, 0.33), green=(0.22, 0.10, 0.05), brown=(0.17, 0.08, 0.04), scale=0.9, mud_h=0.35, mud_col=(0.1, 0.075, 0.05), dust_amt=0.3)
    M['pferd'] = E.painted('Pferdefell', (0.085, 0.04, 0.02), 0.75, chips=False, mud_h=0.15, streaks=0.1, dust_amt=0.06, fade=0.0)
    M['mane'] = E.painted('Maehne', (0.035, 0.028, 0.022), 0.85, chips=False, mud_h=0.1, streaks=0, dust_amt=0.1)
    M['maul'] = E.plain('Maul', (0.35, 0.25, 0.22), 0.6)
    M['horn'] = E.plain('Horn', (0.6, 0.55, 0.45), 0.4)
    M['huf'] = E.plain('Huf', (0.03, 0.025, 0.02), 0.5)
    return M

def person(M, kind, row, scale=1.0):   # 1 Blender-Einheit = 1 m: Mensch ca. 1,8 m
    """Dorfbewohner; Blickrichtung +x. row 0 = stehen, 1/2 = Schrittstellungen"""
    root = E.empty('Person'); root.scale = (scale,) * 3; E.set_parent(root)
    swing = (0, 0.42, -0.42)[row]
    frau = kind == 'baeuerin'
    for side in (-1, 1):
        leg = E.empty(f'Huefte{side}', root); leg.location = (0, side * 0.1, 0.9); E.set_parent(leg)
        cyl(f'Bein{side}', 0.075, 0.55, (0, 0, -0.27), M['hose'] if not frau else M['haut'], verts=10)
        cyl(f'Schuh{side}', 0.07, 0.3, (0, 0, -0.7), M['leder'], verts=10)
        box(f'Sohle{side}', (0.25, 0.1, 0.07), (0.05, 0, -0.86), M['leder'], bevel=0.03)
        leg.rotation_euler = (0, swing * side * (0.6 if frau else 1), 0)
        E.set_parent(root)
    if frau:
        o = frustum('Rock', (0.46, 0.5, 0.62), (0, 0, 0.58), M['rock'], top=(0.62, 0.62), bevel=0.06); E.wobble(o, 0.012, 0.1, levels=1)
        box('Schuerze', (0.03, 0.34, 0.6), (0.2, 0, 0.62), M['schuerze'], rot=(0, -0.18, 0), bevel=0.02)
        o = frustum('Mieder', (0.26, 0.34, 0.52), (0, 0, 1.15), M['bluse'], top=(0.85, 1.0), bevel=0.06)
        sphere('Kopf', 0.1, (0.02, 0, 1.6), M['haut'], seg=14)
        sphere('Kopftuch', 0.115, (-0.01, 0, 1.63), M['tuch'], scale=(1.05, 1, 0.9), seg=14)
        box('Knoten', (0.08, 0.06, 0.08), (-0.11, 0, 1.55), M['tuch'], bevel=0.03)
    else:
        o = frustum('Rumpf', (0.27, 0.4, 0.62), (0, 0, 1.22), M['hemd'], top=(0.95, 1.05), bevel=0.06); E.wobble(o, 0.01, 0.1, levels=1)
        frustum('Weste', (0.29, 0.42, 0.42), (0, 0, 1.3), M['weste'], top=(0.95, 1.05), bevel=0.05)
        box('Guertel', (0.29, 0.41, 0.05), (0, 0, 0.93), M['leder'], bevel=0.02)
        sphere('Kopf', 0.105, (0.02, 0, 1.67), M['haut'], seg=14)
        cyl('Muetze', 0.12, 0.07, (0.0, 0, 1.77), M['muetze'], verts=16)
        box('Schirm', (0.12, 0.2, 0.02), (0.11, 0, 1.75), M['muetze'], bevel=0)
    for side in (-1, 1):
        arm = E.empty(f'Schulter{side}', root); arm.location = (0, side * (0.2 if frau else 0.23), 1.45); E.set_parent(arm)
        cyl(f'Arm{side}', 0.055, 0.55, (0, 0, -0.27), M['bluse'] if frau else M['hemd'], verts=8)
        sphere(f'Hand{side}', 0.045, (0, 0, -0.57), M['haut'], seg=8)
        carry = (frau and side == 1) or (not frau and side == -1)
        arm.rotation_euler = (0, -0.5 if carry else -swing * side * 0.8, 0)
        E.set_parent(root)
    if frau:
        # Korb am Arm
        o = cyl('Korb', 0.16, 0.2, (0.22, 0.25, 0.95), M['korb'], verts=14, r2=0.2); E.wobble(o, 0.01, 0.1, levels=1)
        line_cyl('Henkel', (0.1, 0.25, 1.05), (0.34, 0.25, 1.05), 0.012, M['korb'], verts=4)
    else:
        # Heugabel über der Schulter
        line_cyl('Gabelstiel', (0.45, -0.25, 0.65), (-0.6, -0.25, 1.75), 0.022, M['holz'], verts=6)
        for k in (-1, 0, 1): line_cyl(f'Zinke{k}', (-0.6, -0.25 + k * 0.05, 1.75), (-0.8, -0.25 + k * 0.06, 1.95), 0.01, M['leder'], verts=4)
    E.set_parent(E.REF)

def kuh(M, row, scale=1.5):
    """Kuh; Blickrichtung +x. row 0 = stehen, 1 = grasen (Kopf unten), 2 = Schritt"""
    root = E.empty('Kuh'); root.scale = (scale,) * 3; E.set_parent(root)
    o = sphere('Rumpf', 0.5, (0, 0, 1.0), M['kuh'], scale=(1.5, 0.85, 0.85), seg=20); E.wobble(o, 0.02, 0.3, levels=1)
    sphere('Euter', 0.15, (-0.35, 0, 0.58), M['maul'], scale=(1.2, 1, 0.8), seg=10)
    step = 0.32 if row == 2 else 0
    for i, (lx, ly) in enumerate(((0.52, -0.2), (0.52, 0.2), (-0.55, -0.2), (-0.55, 0.2))):
        leg = E.empty(f'Bein{i}', root); leg.location = (lx, ly, 0.85); E.set_parent(leg)
        cyl(f'Bein{i}_o', 0.075, 0.5, (0, 0, -0.22), M['kuh'], verts=10, r2=0.055)
        cyl(f'Bein{i}_u', 0.05, 0.38, (0, 0, -0.62), M['kuh'], verts=8)
        cyl(f'Huf{i}', 0.06, 0.08, (0.01, 0, -0.81), M['huf'], verts=8)
        leg.rotation_euler = (0, step * (1 if i in (0, 3) else -1), 0)
        E.set_parent(root)
    neck = E.empty('Hals', root); neck.location = (0.65, 0, 1.15); E.set_parent(neck)
    line_cyl('Halsstueck', (0, 0, 0), (0.35, 0, 0.05), 0.2, M['kuh'], verts=12)
    o = sphere('Kopf', 0.16, (0.48, 0, 0.0), M['kuh'], scale=(1.6, 0.9, 1.0), seg=14)
    sphere('Maul', 0.11, (0.7, 0, -0.06), M['maul'], scale=(1.0, 1.0, 0.85), seg=10)
    for s in (-1, 1):
        line_cyl(f'Horn{s}', (0.4, s * 0.1, 0.13), (0.38, s * 0.24, 0.24), 0.022, M['horn'], verts=5)
        box(f'Ohr{s}', (0.06, 0.14, 0.05), (0.38, s * 0.2, 0.06), M['kuh'], rot=(s * 0.4, 0, 0), bevel=0.02)
    neck.rotation_euler = (0, 1.05 if row == 1 else 0.05, 0)
    E.set_parent(root)
    line_cyl('Schwanz', (-0.75, 0, 1.15), (-0.82, 0.03, 0.45), 0.025, M['kuh'], verts=5)
    sphere('Quaste', 0.05, (-0.82, 0.03, 0.42), M['huf'], seg=8)
    E.set_parent(E.REF)


def pferd(M, row, scale=1.5):
    """Kaltblut-Ackerpferd; Blickrichtung +x. row 0 = stehen, 1 = grasen (Kopf unten), 2 = Schritt"""
    root = E.empty('Pferd'); root.scale = (scale,) * 3; E.set_parent(root)
    o = sphere('Rumpf', 0.5, (0, 0, 1.28), M['pferd'], scale=(1.5, 0.74, 0.82), seg=20); E.wobble(o, 0.015, 0.3, levels=1)
    sphere('Kruppe', 0.4, (-0.5, 0, 1.3), M['pferd'], scale=(1.0, 0.85, 0.95), seg=14)
    sphere('Brust', 0.36, (0.52, 0, 1.28), M['pferd'], scale=(0.95, 0.9, 1.05), seg=14)
    step = 0.34 if row == 2 else 0
    for i, (lx, ly) in enumerate(((0.55, -0.17), (0.55, 0.17), (-0.55, -0.17), (-0.55, 0.17))):
        leg = E.empty(f'Bein{i}', root); leg.location = (lx, ly, 1.1); E.set_parent(leg)
        cyl(f'Bein{i}_o', 0.1, 0.55, (0, 0, -0.26), M['pferd'], verts=10, r2=0.065)
        cyl(f'Bein{i}_u', 0.05, 0.5, (0, 0, -0.78), M['pferd'], verts=8)
        cyl(f'Fessel{i}', 0.07, 0.1, (0, 0, -1.02), M['mane'], verts=8)
        cyl(f'Huf{i}', 0.075, 0.1, (0.01, 0, -1.1), M['huf'], verts=8)
        leg.rotation_euler = (0, step * (1 if i in (0, 3) else -1), 0)
        E.set_parent(root)
    neck = E.empty('Hals', root); neck.location = (0.62, 0, 1.45); E.set_parent(neck)
    line_cyl('Halsstueck', (0, 0, 0), (0.42, 0, 0.5), 0.17, M['pferd'], verts=12)
    for k in range(6):
        t = k / 5
        box(f'Maehne{k}', (0.04, 0.03, 0.17), (0.38 * t - 0.04, 0, 0.5 * t + 0.16), M['mane'], rot=(0, 0.62, 0), bevel=0.01)
    o = sphere('Kopf', 0.14, (0.56, 0, 0.5), M['pferd'], scale=(1.0, 0.8, 0.9), seg=14)
    line_cyl('Nase', (0.5, 0, 0.55), (0.78, 0, 0.3), 0.1, M['pferd'], verts=10)
    sphere('Maul', 0.08, (0.8, 0, 0.28), M['maul'], scale=(1.0, 0.9, 0.9), seg=10)
    for s in (-1, 1):
        box(f'Ohr{s}', (0.04, 0.05, 0.13), (0.5, s * 0.07, 0.68), M['pferd'], rot=(s * 0.2, 0, 0), bevel=0.01)
    neck.rotation_euler = (0, 1.25 if row == 1 else -0.12, 0)
    E.set_parent(root)
    line_cyl('Schweif', (-0.82, 0, 1.45), (-0.95, 0.02, 0.7), 0.05, M['mane'], verts=8)
    sphere('SchweifEnde', 0.07, (-0.95, 0.02, 0.66), M['mane'], scale=(0.8, 0.8, 2.4), seg=8)
    E.set_parent(E.REF)

# Name: (Bau, Richtungen, Reihen, Bildbreite, -höhe, Anker x, Anker y)
FIGS = {
    'bauer': (lambda M, r: person(M, 'bauer', r), 8, 3, 40, 48, 20, 40),
    'baeuerin': (lambda M, r: person(M, 'baeuerin', r), 8, 3, 40, 48, 20, 40),
    'kuh': (lambda M, r: kuh(M, r), 8, 3, 72, 56, 36, 40),
    'pferd': (lambda M, r: pferd(M, r), 8, 3, 88, 72, 44, 52),
}

meta = {}
for name, (build, frames, rows, W, H, ax, ay) in FIGS.items():
    if ONLY and name not in ONLY: continue
    for row in range(rows):
        E.reset(name)
        M = mats()
        build(M, row)
        E.shadow_catcher()
        E.frame_camera(W * 2, H * 2, (0, 0, 0), ax * 2, ay * 2)
        for f in range(frames):
            E.REF.rotation_euler = (0, 0, -f * 2 * math.pi / frames)
            E.shoot(os.path.join(OUT, f'{name}_wanne_{row}_{f:02d}.png'), SAMPLES)
    meta[name] = {'frames': frames, 'rows': rows, 'anchor': [ax, ay], 'scale': 0.5, 'photo': True, 'tint': 0.0, 'w': W, 'h': H}
    print('fertig', name)
json.dump(meta, open(os.path.join(OUT, f'meta_{"_".join(ONLY) or "alle"}.json'), 'w'), indent=1)
