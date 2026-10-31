// Kleine Helfer für die Oberfläche
import { assets } from '../assets';
import { RES_KEYS, type Cost } from '../sim/defs';

export function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function fmt(n: number) { return Math.floor(n).toLocaleString('de-DE'); }
export function icon(key: string, cls = 'ico') {
  const u = assets.url(key);
  return u ? `<img class="${cls}" src="${u}" alt="">` : '';
}
export function costHtml(c: Cost, have?: Record<string, number>) {
  return RES_KEYS.filter((k) => c[k]).map((k) => {
    const short = have && have[k] < (c[k] ?? 0);
    return `<span class="cost${short ? ' short' : ''}">${icon(`icon.${k}`, 'ico s')}${c[k]}</span>`;
  }).join('');
}
export function bar(frac: number, cls = '') {
  return `<span class="bar ${cls}"><i style="width:${Math.max(0, Math.min(1, frac)) * 100}%"></i></span>`;
}
/** Erstes Einzelbild eines Sprites als Symbol (auch für Richtungsbilder) */
export function spriteIcon(key: string, cls = 'spr', height = cls.includes(' s') ? 24 : 40) {
  const u = assets.url(key);
  if (!u) return '';
  const [fw, fh] = assets.frameSize(key);
  const w = Math.round((fw / fh) * height);
  // Panzer: Turm als zweite Ebene über die Wanne legen (gleiche Bildmaße und Ankerpunkte)
  const turm = assets.url(`${key}.turm`);
  const layers = turm ? `url('${turm}'),url('${u}')` : `url('${u}')`;
  return `<span class="${cls}" style="background-image:${layers};background-size:auto ${assets.rows(key) * height}px;width:${w}px;height:${height}px"></span>`;
}
