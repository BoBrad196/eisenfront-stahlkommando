// Lädt alle Grafiken über assets/manifest.json. Fehlt eine Grafik, wird ein
// farbiger Platzhalter gezeichnet – das Spiel läuft also immer weiter.
const RASTER = 2; // Rasterauflösung der Grafiken (für scharfes Heranzoomen)

interface SpriteMeta {
  frames?: number; rows?: number; anchor?: [number, number];
  /** Bildpixel je Spielpixel kleiner 1 = höher aufgelöste Datei (z. B. 0.5 für Renderings in doppelter Auflösung) */
  scale?: number;
  /** Stärke der Teamfarbe (Standard je nach Einheit); gerenderte Fotografiken brauchen weniger */
  tint?: number;
  /** gerenderte Grafik: Teamfarbe nur auf deckende Pixel (nicht auf den eingebackenen Schatten) */
  photo?: boolean;
  /** nahtlose Bodentextur in Draufsicht: deckt tiles×tiles Kacheln ab */
  tiles?: number;
  /** Fahnenspitze relativ zum Ankerpunkt (logische px) für die Teamfahne */
  flag?: [number, number];
  /** Rauchquellen [x, y in Kacheln ab oberer Ecke, Höhe in 32-px-Einheiten] */
  smoke?: [number, number, number][];
  /** Höhe des Hauptrotors über dem Ankerpunkt (logische px) */
  rotor?: number;
  /** Propeller: [Abstand vor dem Mittelpunkt in Kacheln, Höhe in px] */
  prop?: [number, number];
  /** Bildfolge eines beweglichen Teils (Mühlrad, Kran …): Bilder je Sekunde */
  fps?: number;
  /** Abdunkeln der Grafik (0 = nichts, 0,25 = ein Viertel dunkler), z. B. für dunkelgraue Panzer */
  shade?: number;
  /** Stärke der warmen Lichtstimmung (Standard 1; 0 = neutral) */
  warm?: number;
}
interface Manifest {
  tile: { width: number; height: number };
  images: Record<string, string>;
  sprites: Record<string, SpriteMeta>;
}

class AssetStore {
  tileW = 64;
  tileH = 32;
  private manifest: Manifest = { tile: { width: 64, height: 32 }, images: {}, sprites: {} };
  /** vorgerasterte Bilder (doppelte Auflösung): SVG wird so nicht bei jedem Zeichnen neu berechnet */
  private images = new Map<string, { canvas: HTMLCanvasElement; w: number; h: number }>();
  private tints = new Map<string, HTMLCanvasElement>();
  missing: string[] = [];

  async load(onProgress?: (done: number, total: number) => void) {
    try {
      const res = await fetch('manifest.json', { cache: 'no-cache' });
      this.manifest = { ...this.manifest, ...(await res.json()) };
    } catch (e) {
      console.warn('manifest.json konnte nicht geladen werden – es werden Platzhalter gezeichnet.', e);
    }
    this.tileW = this.manifest.tile?.width ?? 64;
    this.tileH = this.manifest.tile?.height ?? 32;
    const entries = Object.entries(this.manifest.images ?? {});
    let done = 0;
    await Promise.all(entries.map(([key, file]) => new Promise<void>((resolve) => {
      // Titelbild des Hauptmenüs: wird vom Menü selbst per CSS geladen, nicht gerastert und eingefärbt
      if (key.startsWith('menu.')) { onProgress?.(++done, entries.length); resolve(); return; }
      const img = new Image();
      img.onload = () => {
        const sc = this.manifest.sprites?.[key]?.scale ?? 1;
        const w = (img.naturalWidth || 32) * sc, h = (img.naturalHeight || 32) * sc;
        const canvas = document.createElement('canvas');
        canvas.width = w * RASTER; canvas.height = h * RASTER;
        const g = canvas.getContext('2d')!;
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (!key.startsWith('terrain.') && !key.startsWith('icon.')) grade(g, img, canvas.width, canvas.height, this.manifest.sprites?.[key]);
        this.images.set(key, { canvas, w, h });
        onProgress?.(++done, entries.length);
        resolve();
      };
      img.onerror = () => { this.missing.push(`${key} (${file})`); onProgress?.(++done, entries.length); resolve(); };
      img.src = file;
    })));
    if (this.missing.length) console.warn('Fehlende Grafiken:', this.missing);
  }

  get(key: string) { return this.images.get(key) ?? null; }
  url(key: string): string | null { return this.manifest.images[key] ?? null; }
  meta(key: string): SpriteMeta { return this.manifest.sprites?.[key] ?? {}; }
  frames(key: string) { return this.meta(key).frames ?? 1; }
  rows(key: string) { return this.meta(key).rows ?? 1; }
  has(key: string) { return this.images.has(key); }

  /** Größe eines Einzelbilds (bei Richtungsbildern ein Ausschnitt) */
  frameSize(key: string): [number, number] {
    const img = this.get(key);
    if (!img) return [this.tileW, this.tileH];
    return [img.w / this.frames(key), img.h / this.rows(key)];
  }

  /** Grafik in Teamfarbe eingefärbt (zwischengespeichert, doppelte Auflösung) */
  tinted(key: string, color: string, strength: number): HTMLCanvasElement | null {
    const img = this.get(key);
    if (!img) return null;
    const id = `${key}|${color}|${strength}`;
    let c = this.tints.get(id);
    if (!c) {
      c = document.createElement('canvas');
      c.width = img.canvas.width; c.height = img.canvas.height;
      const g = c.getContext('2d')!;
      g.drawImage(img.canvas, 0, 0);
      if (this.meta(key).photo) {
        // nur deckende Pixel einfärben, der halbtransparente Schatten bleibt neutral
        const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
        const n = parseInt(color.slice(1), 16), cr = (n >> 16) & 255, cg = (n >> 8) & 255, cb = n & 255;
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3];
          if (a < 160) continue;
          const k = strength * ((a - 160) / 95);
          px[i] += (cr - px[i]) * k; px[i + 1] += (cg - px[i + 1]) * k; px[i + 2] += (cb - px[i + 2]) * k;
        }
        g.putImageData(d, 0, 0);
      } else {
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = strength;
        g.fillStyle = color;
        g.fillRect(0, 0, c.width, c.height);
      }
      this.tints.set(id, c);
    }
    return c;
  }

  /**
   * Zeichnet ein Sprite so, dass sein Ankerpunkt (Bodenpunkt) auf (x, y) liegt.
   * frame wählt bei Richtungsbildern das Einzelbild.
   */
  sprite(g: CanvasRenderingContext2D, key: string, x: number, y: number, opts: { frame?: number; row?: number; tint?: string; tintStrength?: number; alpha?: number } = {}) {
    const img = this.get(key);
    const [fw, fh] = this.frameSize(key);
    const anchor = this.meta(key).anchor ?? [fw / 2, fh];
    if (opts.alpha != null) { g.save(); g.globalAlpha = opts.alpha; }
    if (img) {
      const frame = Math.max(0, Math.min(this.frames(key) - 1, opts.frame ?? 0));
      const src = opts.tint ? this.tinted(key, opts.tint, opts.tintStrength ?? 0.4)! : img.canvas;
      const row = Math.max(0, Math.min(this.rows(key) - 1, opts.row ?? 0));
      g.drawImage(src, frame * fw * RASTER, row * fh * RASTER, fw * RASTER, fh * RASTER, x - anchor[0], y - anchor[1], fw, fh);
    } else {
      g.fillStyle = opts.tint ?? '#a0a';
      g.fillRect(x - 12, y - 24, 24, 24);
      g.strokeStyle = '#000'; g.strokeRect(x - 12, y - 24, 24, 24);
    }
    if (opts.alpha != null) g.restore();
  }

  /** Bodenkachel (Raute) mit der oberen Spitze bei (x, y) zeichnen */
  tile(g: CanvasRenderingContext2D, key: string, x: number, y: number) {
    const img = this.get(key);
    const w = this.tileW, h = this.tileH;
    if (img) g.drawImage(img.canvas, x - w / 2 - 0.75, y - 0.4, w + 1.5, h + 0.8); // leichte Überlappung gegen Fugen
    else {
      g.fillStyle = '#a0a';
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + w / 2, y + h / 2); g.lineTo(x, y + h); g.lineTo(x - w / 2, y + h / 2); g.fill();
    }
  }

  /** Einfaches Bild in ein Rechteck zeichnen (Symbole, Explosionen) */
  draw(g: CanvasRenderingContext2D, key: string, x: number, y: number, w: number, h: number, opts: { alpha?: number } = {}) {
    const img = this.get(key);
    if (opts.alpha != null) { g.save(); g.globalAlpha = opts.alpha; }
    if (img) g.drawImage(img.canvas, x, y, w, h);
    else { g.fillStyle = '#a0a'; g.fillRect(x, y, w, h); }
    if (opts.alpha != null) g.restore();
  }
}

export const assets = new AssetStore();

/** Einheitliche Farbstimmung einmalig beim Laden einbacken: warmes Nachmittagslicht, etwas entsättigt
 *  (kostet so pro Bild keine Rechenzeit). Die Transparenz bleibt erhalten. */
function grade(g: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, meta?: SpriteMeta) {
  g.globalCompositeOperation = 'saturation';
  g.fillStyle = 'rgba(128,128,128,0.18)';
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'soft-light';
  g.fillStyle = `rgba(255,178,96,${0.32 * (meta?.warm ?? 1)})`;
  g.fillRect(0, 0, w, h);
  if (meta?.shade) {
    g.globalCompositeOperation = 'multiply';
    const v = Math.round(255 * (1 - meta.shade));
    g.fillStyle = `rgb(${v},${v},${Math.min(255, v + 2)})`;
    g.fillRect(0, 0, w, h);
  }
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(img, 0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
}
