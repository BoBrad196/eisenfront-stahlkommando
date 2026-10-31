// Vorschaubilder für Karten und Porträts: das Sprite in einer kleinen Szene
// (dunstiger Himmel, Erdboden, Schatten, Vignette) – einmal gerendert und zwischengespeichert.
import { assets } from '../assets';

const cache = new Map<string, string>();

export function thumb(key: string, w: number, h: number, opts: { frame?: number; ground?: 'erde' | 'wasser'; air?: boolean } = {}): string {
  const id = `${key}|${w}|${h}|${opts.frame ?? -1}|${opts.ground ?? ''}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const k = 2; // doppelte Auflösung für scharfe Darstellung
  const c = document.createElement('canvas');
  c.width = w * k; c.height = h * k;
  const g = c.getContext('2d')!;
  g.scale(k, k);
  // Himmel und Horizont
  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#4d5458'); sky.addColorStop(0.45, '#8b8577'); sky.addColorStop(0.46, opts.ground === 'wasser' ? '#3d5f74' : '#6c6247');
  sky.addColorStop(1, opts.ground === 'wasser' ? '#22394a' : '#3d3527');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // Bodenfleck
  g.fillStyle = opts.ground === 'wasser' ? 'rgba(160,190,200,0.12)' : 'rgba(120,98,66,0.55)';
  g.beginPath(); g.ellipse(w / 2, h * 0.78, w * 0.46, h * 0.2, 0, 0, Math.PI * 2); g.fill();
  // Sprite einpassen: erst in voller Größe zeichnen, sichtbaren Bereich ermitteln, dann zugeschnitten skalieren
  const [fw, fh] = assets.frameSize(key);
  const frames = assets.frames(key);
  const frame = opts.frame ?? (frames >= 16 ? 2 : frames >= 8 ? 1 : 0);
  const [ax, ay] = assets.meta(key).anchor ?? [fw / 2, fh];
  const R = 2;
  const tmp = document.createElement('canvas');
  tmp.width = Math.ceil(fw * R); tmp.height = Math.ceil(fh * R);
  const tg = tmp.getContext('2d')!;
  tg.scale(R, R);
  assets.sprite(tg, key, ax, ay, { frame });
  if (assets.has(`${key}.turm`)) assets.sprite(tg, `${key}.turm`, ax, ay, { frame });
  // gerenderte Grafiken haben einen halbtransparenten Schatten: nur deckende Pixel zählen
  const box = alphaBox(tg, tmp.width, tmp.height, assets.meta(key).photo ? 200 : 24);
  if (box) {
    const [bx0, by0, bx1, by1] = box, bw = bx1 - bx0, bh = by1 - by0;
    const scale = Math.min((w * 0.84) / bw, (h * 0.74) / bh, 2.2 * k);
    const dw = bw * scale, dh = bh * scale;
    const dx = (w - dw) / 2, dy = opts.air ? (h - dh) / 2 : h * 0.86 - dh;
    if (!opts.air && opts.ground !== 'wasser') {
      g.fillStyle = 'rgba(20,14,6,0.45)';
      g.beginPath(); g.ellipse(w / 2, h * 0.86 - dh * 0.06, dw * 0.5, Math.max(3, dh * 0.12), 0, 0, Math.PI * 2); g.fill();
    }
    g.imageSmoothingQuality = 'high';
    g.drawImage(tmp, bx0, by0, bw, bh, dx, dy, dw, dh);
  }
  // warmes Licht und Vignette
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = 'rgba(255,190,110,0.35)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);
  const url = c.toDataURL('image/png');
  cache.set(id, url);
  return url;
}

/** Begrenzungsrechteck der nicht transparenten Pixel */
function alphaBox(g: CanvasRenderingContext2D, w: number, h: number, min = 24): [number, number, number, number] | null {
  const d = g.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > min) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}
