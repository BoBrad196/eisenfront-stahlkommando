# Schneidet gerenderte Bildstreifen auf den sichtbaren Inhalt zu (gemeinsamer Rahmen über alle Einzelbilder)
# und passt Ankerpunkte und Fahnenpositionen im Manifest an. Spart beim Zeichnen viel Füllrate.
# Aufruf: python3 tools/blender/trim.py
import json, os
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets')
man_path = os.path.join(ROOT, 'manifest.json')
man = json.load(open(man_path))
saved = 0
for key, meta in man['sprites'].items():
    if not meta.get('photo') or meta.get('tiles') or key.startswith('deposit.'): continue
    path = os.path.join(ROOT, man['images'][key])
    im = Image.open(path).convert('RGBA')
    # feines Rauschen des Entrauschers im Alphakanal entfernen
    cut = 90 if key.startswith('object.baum') and not key.endswith('_schatten') else 14  # Bäume: weicher Bodenschleier gehört in den Schatten
    r_, g_, b_, a_ = im.split(); a_ = a_.point(lambda a: 0 if a < cut else a); im = Image.merge('RGBA', (r_, g_, b_, a_))
    sc = meta.get('scale', 1)
    frames, rows = meta.get('frames', 1), meta.get('rows', 1)
    fw, fh = im.width // frames, im.height // rows
    box = None
    for r in range(rows):
        for f in range(frames):
            b = im.crop((f * fw, r * fh, (f + 1) * fw, (r + 1) * fh)).getchannel('A').point(lambda a: 255 if a > max(24, cut) else 0).getbbox()
            if b: box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    if not box or box == (0, 0, fw, fh):
        im.save(path, optimize=True); continue
    # auf gerade Pixel runden (Bild ist doppelt aufgelöst)
    x0, y0 = box[0] - box[0] % 2, box[1] - box[1] % 2
    x1, y1 = box[2] + box[2] % 2, box[3] + box[3] % 2
    nw, nh = x1 - x0, y1 - y0
    out = Image.new('RGBA', (nw * frames, nh * rows))
    for r in range(rows):
        for f in range(frames):
            out.paste(im.crop((f * fw + x0, r * fh + y0, f * fw + x1, r * fh + y1)), (f * nw, r * nh))
    out.save(path, optimize=True)
    meta['anchor'] = [round(meta['anchor'][0] - x0 * sc, 2), round(meta['anchor'][1] - y0 * sc, 2)]
    saved += (fw * fh - nw * nh) * frames * rows
    print(f'{key}: {fw}x{fh} -> {nw}x{nh}')
json.dump(man, open(man_path, 'w'), indent=2, ensure_ascii=False)
open(man_path, 'a').write('\n')
print(f'{saved / 1e6:.1f} Mio. Pixel eingespart')
