// Touch-Bedienung für beide Kartenansichten: Tippen, Doppeltippen, langes Drücken,
// Ziehen mit einem Finger (Karte verschieben oder Auswahlrahmen) und Zwei-Finger-Zoom mit Verschieben.
// Maus und Stift laufen weiter über die normalen Zeigerereignisse der Ansichten.

export interface TouchHandlers {
  tap(x: number, y: number): void;
  doubleTap?(x: number, y: number): void;
  longPress?(x: number, y: number): void;
  /** Ein Finger zieht die Karte; dx/dy = Verschiebung seit dem letzten Ereignis in Bildschirmpixeln */
  pan(dx: number, dy: number): void;
  /** Zwei Finger: factor = Zoomänderung seit dem letzten Ereignis, (cx, cy) = Mitte, (dx, dy) = Verschiebung der Mitte */
  pinch(factor: number, cx: number, cy: number, dx: number, dy: number): void;
  /** Ein Finger beginnt zu ziehen: true = die Ansicht zeichnet einen Auswahlrahmen (statt die Karte zu verschieben) */
  dragStart?(x: number, y: number): boolean;
  dragMove?(x: number, y: number): void;
  dragEnd?(x: number, y: number): void;
}

interface Pt { x: number; y: number; x0: number; y0: number; t0: number }
const MOVE_SLOP = 10;       // px, bis aus einem Tippen ein Ziehen wird
const LONG_PRESS_MS = 520;
const DOUBLE_TAP_MS = 340;

export class TouchGestures {
  private pts = new Map<number, Pt>();
  private state: 'idle' | 'tap' | 'pan' | 'rect' | 'pinch' | 'done' = 'idle';
  private lastTap = { t: 0, x: -999, y: -999 };
  private timer = 0;
  private last = { x: 0, y: 0, dist: 0, cx: 0, cy: 0 };

  constructor(private canvas: HTMLCanvasElement, private h: TouchHandlers, signal: AbortSignal) {
    const o = { signal };
    canvas.addEventListener('pointerdown', (e) => this.down(e), o);
    canvas.addEventListener('pointermove', (e) => this.move(e), o);
    canvas.addEventListener('pointerup', (e) => this.up(e), o);
    canvas.addEventListener('pointercancel', (e) => this.cancel(e), o);
    signal.addEventListener('abort', () => clearTimeout(this.timer));
  }

  private two(): [Pt, Pt] | null {
    if (this.pts.size < 2) return null;
    const [a, b] = [...this.pts.values()];
    return [a, b];
  }

  private down(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    this.canvas.setPointerCapture(e.pointerId);
    this.pts.set(e.pointerId, { x: e.offsetX, y: e.offsetY, x0: e.offsetX, y0: e.offsetY, t0: performance.now() });
    clearTimeout(this.timer);
    if (this.pts.size === 1) {
      this.state = 'tap';
      this.last.x = e.offsetX; this.last.y = e.offsetY;
      const x = e.offsetX, y = e.offsetY;
      this.timer = window.setTimeout(() => {
        if (this.state === 'tap' && this.h.longPress) { this.state = 'done'; this.h.longPress(x, y); }
      }, LONG_PRESS_MS);
    } else if (this.pts.size === 2) {
      if (this.state === 'rect') this.h.dragEnd?.(this.last.x, this.last.y);
      this.state = 'pinch';
      const [a, b] = this.two()!;
      this.last.dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      this.last.cx = (a.x + b.x) / 2; this.last.cy = (a.y + b.y) / 2;
    }
  }

  private move(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    const p = this.pts.get(e.pointerId);
    if (!p) return;
    p.x = e.offsetX; p.y = e.offsetY;
    if (this.state === 'pinch') {
      const two = this.two();
      if (!two) return;
      const [a, b] = two;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.h.pinch(dist / this.last.dist, cx, cy, cx - this.last.cx, cy - this.last.cy);
      this.last.dist = dist; this.last.cx = cx; this.last.cy = cy;
      return;
    }
    if (this.state === 'tap') {
      if (Math.hypot(p.x - p.x0, p.y - p.y0) < MOVE_SLOP) return;
      clearTimeout(this.timer);
      if (this.h.dragStart?.(p.x0, p.y0)) { this.state = 'rect'; this.h.dragMove?.(p.x, p.y); }
      else { this.state = 'pan'; this.last.x = p.x0; this.last.y = p.y0; }
    }
    if (this.state === 'rect') { this.h.dragMove?.(p.x, p.y); this.last.x = p.x; this.last.y = p.y; }
    else if (this.state === 'pan') {
      this.h.pan(p.x - this.last.x, p.y - this.last.y);
      this.last.x = p.x; this.last.y = p.y;
    }
  }

  private up(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    const p = this.pts.get(e.pointerId);
    this.pts.delete(e.pointerId);
    clearTimeout(this.timer);
    if (!p) return;
    if (this.state === 'tap') {
      const now = performance.now(), L = this.lastTap;
      if (this.h.doubleTap && now - L.t < DOUBLE_TAP_MS && Math.hypot(p.x - L.x, p.y - L.y) < 36) {
        this.lastTap = { t: 0, x: -999, y: -999 };
        this.h.doubleTap(p.x, p.y);
      } else {
        this.lastTap = { t: now, x: p.x, y: p.y };
        this.h.tap(p.x, p.y);
      }
    } else if (this.state === 'rect') this.h.dragEnd?.(p.x, p.y);
    // Nach Zwei-Finger-Gesten oder langem Drücken erst wieder reagieren, wenn alle Finger oben sind
    this.state = this.pts.size ? (this.state === 'pinch' || this.state === 'done' ? 'done' : this.state) : 'idle';
  }

  private cancel(e: PointerEvent) {
    if (e.pointerType !== 'touch') return;
    this.pts.delete(e.pointerId);
    clearTimeout(this.timer);
    if (this.state === 'rect') this.h.dragEnd?.(this.last.x, this.last.y);
    if (!this.pts.size) this.state = 'idle';
  }
}
