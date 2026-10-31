# Übernimmt gerenderte Blender-Bilder ins Spiel: setzt Einzelbilder zu Bildstreifen zusammen,
# kopiert sie nach assets/graphics/ und trägt sie (mit Ankerpunkt, Maßstab usw.) in assets/manifest.json ein.
# Aufruf: python3 tools/blender/install.py <gebaeude|einheiten|objekte|grundstuecke|leute> <renderordner>
import json, os, sys
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets')
kind, src = sys.argv[1], sys.argv[2]
man_path = os.path.join(ROOT, 'manifest.json')
man = json.load(open(man_path))

def strip(paths, out):
    ims = [Image.open(p).convert('RGBA') for p in paths]
    w, h = ims[0].size
    sheet = Image.new('RGBA', (w * len(ims), h))
    for i, im in enumerate(ims): sheet.paste(im, (i * w, 0))
    sheet.save(out, optimize=True)

def grid(rows, out):
    ims = [[Image.open(p).convert('RGBA') for p in r] for r in rows]
    w, h = ims[0][0].size
    sheet = Image.new('RGBA', (w * len(ims[0]), h * len(ims)))
    for y, r in enumerate(ims):
        for x, im in enumerate(r): sheet.paste(im, (x * w, y * h))
    sheet.save(out, optimize=True)

KEEP = ('shade', 'warm', 'prop', 'rotor')   # von Hand gesetzte Werte bleiben beim erneuten Übernehmen erhalten
def register(key, rel, meta):
    old = man['sprites'].get(key, {})
    man['images'][key] = rel
    man['sprites'][key] = {k: v for k, v in meta.items() if k not in ('w', 'h', 'turret')}
    for k in KEEP:
        if k in old and k not in man['sprites'][key]: man['sprites'][key][k] = old[k]

metas = {}
for f in os.listdir(src):
    if f.startswith('meta_') and f.endswith('.json'): metas.update(json.load(open(os.path.join(src, f))))

if kind == 'gebaeude':
    os.makedirs(os.path.join(ROOT, 'graphics/buildings/foto'), exist_ok=True)
    for name, meta in metas.items():
        rel = f'graphics/buildings/foto/{name}.png'
        strip([os.path.join(src, f'{name}_{i}.png') for i in range(meta['frames'])], os.path.join(ROOT, rel))
        if meta['frames'] == 1: meta.pop('frames')
        register('village.dorf' if name == 'dorf' else f'building.{name}', rel, meta)
elif kind == 'einheiten':
    os.makedirs(os.path.join(ROOT, 'graphics/units/foto'), exist_ok=True)
    for name, meta in metas.items():
        for part in (['wanne', 'turm'] if meta.get('turret') else ['wanne']):
            rel = f'graphics/units/foto/{name}{"_turm" if part == "turm" else ""}.png'
            rows = [[os.path.join(src, f'{name}_{part}_{r}_{f:02d}.png') for f in range(meta['frames'])] for r in range(meta['rows'])]
            grid(rows, os.path.join(ROOT, rel))
            register(f'unit.{name}{".turm" if part == "turm" else ""}', rel, meta)
elif kind == 'objekte':
    os.makedirs(os.path.join(ROOT, 'graphics/terrain/foto'), exist_ok=True)
    for name, meta in metas.items():
        rel = f'graphics/terrain/foto/{name}.png'
        Image.open(os.path.join(src, f'{name}.png')).save(os.path.join(ROOT, rel), optimize=True)
        key = f'deposit.{name.split("_")[1]}' if name.startswith('vorkommen_') else f'object.{name}'
        register(key, rel, meta)

elif kind == 'grundstuecke':
    os.makedirs(os.path.join(ROOT, 'graphics/village/foto'), exist_ok=True)
    for name, meta in metas.items():
        rel = f'graphics/village/foto/{name}.png'
        if meta.get('frames', 1) > 1:   # bewegliches Teil (Mühlrad, Flügel): Bildfolge
            strip([os.path.join(src, f'{name}_{i}.png') for i in range(meta['frames'])], os.path.join(ROOT, rel))
        else:
            Image.open(os.path.join(src, f'{name}.png')).save(os.path.join(ROOT, rel), optimize=True)
        register(f'plot.{name}', rel, meta)
elif kind == 'leute':
    os.makedirs(os.path.join(ROOT, 'graphics/life'), exist_ok=True)
    for name, meta in metas.items():
        rel = f'graphics/life/{name}.png'
        rows = [[os.path.join(src, f'{name}_wanne_{r}_{f:02d}.png') for f in range(meta['frames'])] for r in range(meta['rows'])]
        grid(rows, os.path.join(ROOT, rel))
        register(f'life.{name}', rel, meta)

json.dump(man, open(man_path, 'w'), indent=2, ensure_ascii=False)
open(man_path, 'a').write('\n')
print('übernommen:', ', '.join(metas))
