// Starlight Diner — pointer + keyboard input, in canvas coordinates.
// The canvas is letterboxed to fit the window; this maps client coords
// back into the 1280x720 view space and queues clicks/keys for the game.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = -1; this.y = -1;      // last pointer position (view coords)
    this.clicks = [];              // queued {x, y} since last drain
    this.keys = [];                // queued key strings since last drain
    this.held = new Set();
    this.scale = 1; this.ox = 0; this.oy = 0;
    canvas.addEventListener('pointermove', (e) => {
      const p = this.toView(e.clientX, e.clientY);
      this.x = p.x; this.y = p.y;
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = this.toView(e.clientX, e.clientY);
      this.x = p.x; this.y = p.y;
      this.clicks.push({ x: p.x, y: p.y });
    });
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      this.held.add(e.key.length === 1 ? e.key.toLowerCase() : e.key);
      if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key);
    });
  }

  // Called on resize: view 1280x720 is fit into the window, centered.
  fit() {
    const ww = window.innerWidth, wh = window.innerHeight;
    this.scale = Math.min(ww / 1280, wh / 720);
    const w = 1280 * this.scale, h = 720 * this.scale;
    this.ox = (ww - w) / 2; this.oy = (wh - h) / 2;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  toView(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left) / (r.width / 1280), y: (cy - r.top) / (r.height / 720) };
  }

  drainClicks() { const c = this.clicks; this.clicks = []; return c; }
  drainKeys() { const k = this.keys; this.keys = []; return k; }
  hover(x, y, w, h) { return this.x >= x && this.x <= x + w && this.y >= y && this.y <= y + h; }
  inCircle(cx, cy, r) { const dx = this.x - cx, dy = this.y - cy; return dx * dx + dy * dy <= r * r; }
}
