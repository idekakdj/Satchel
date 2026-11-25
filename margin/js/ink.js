// Margin ink engine: pen input (Pointer Events), rendering and undo for one page.
//
// Strokes are vectors in page coordinates: { id, tool, color, size, pts: [x*10, y*10, pressure*1000, ...] }.
// Pen and stylus input (Apple Pencil, Surface Pen, Wacom, USI) draws with pressure. Fingers pan and pinch
// unless "finger drawing" is on, and once a pen has touched the page, fingers never draw (palm rejection).
// Two canvases sit over the scroller's viewport: the base layer redraws only what is visible, the live
// layer shows the stroke being drawn, plus the browser's predicted points to hide latency.

const DARK = window.matchMedia('(prefers-color-scheme: dark)');
const MIN_GAP = 0.35;        // page px between kept samples
const PALM_WIDTH = 46;       // touch contact wider than this (CSS px) is treated as a palm

export const TOOLS = {
  pen: { label: 'Pen', alpha: 1, width: (s, p) => s * (0.28 + 0.9 * p) },
  pencil: { label: 'Pencil', alpha: 0.82, width: (s, p, tilt) => s * 0.7 * (0.55 + 0.6 * p) * (1 + tilt * 1.4) },
  highlighter: { label: 'Highlighter', alpha: 0.32, width: s => s * 2.6 },
};

function displayColor(hex, exportMode) {
  if (exportMode || !DARK.matches) return hex;
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  // Near-black ink would vanish on dark paper: show it as warm white instead.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 50 ? '#efe7da' : hex;
}

const boxes = new WeakMap();
function bbox(s) {
  let b = boxes.get(s);
  if (b) return b;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < s.pts.length; i += 3) {
    const x = s.pts[i] / 10, y = s.pts[i + 1] / 10;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = s.size * 3 + 2;
  b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  boxes.set(s, b);
  return b;
}

export function drawStroke(ctx, s, extra, exportMode) {
  const tool = TOOLS[s.tool] || TOOLS.pen;
  const pts = extra ? s.pts.concat(extra) : s.pts;
  const n = pts.length / 3;
  if (!n) return;
  ctx.save();
  ctx.globalAlpha = tool.alpha;
  ctx.strokeStyle = ctx.fillStyle = displayColor(s.color, exportMode);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.tool === 'highlighter') {
    if (exportMode || !DARK.matches) ctx.globalCompositeOperation = 'multiply';
    ctx.lineCap = 'butt';
    ctx.lineWidth = tool.width(s.size, 0.5);
    ctx.beginPath();
    ctx.moveTo(pts[0] / 10, pts[1] / 10);
    for (let i = 1; i < n; i++) ctx.lineTo(pts[i * 3] / 10, pts[i * 3 + 1] / 10);
    if (n === 1) ctx.lineTo(pts[0] / 10 + 0.1, pts[1] / 10);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const P = i => [pts[i * 3] / 10, pts[i * 3 + 1] / 10, pts[i * 3 + 2] / 1000];
  const tilt = s.tilt || 0;
  if (n === 1) {
    const [x, y, p] = P(0);
    ctx.beginPath(); ctx.arc(x, y, Math.max(0.6, tool.width(s.size, p, tilt) / 2), 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }
  // Quadratic smoothing through midpoints; each piece gets the width of its pressure.
  let [px, py, pp] = P(0);
  let mx = px, my = py;
  for (let i = 1; i < n; i++) {
    const [x, y, p] = P(i);
    const nx = (px + x) / 2, ny = (py + y) / 2;
    ctx.lineWidth = Math.max(0.5, tool.width(s.size, (pp + p) / 2, tilt));
    ctx.beginPath();
    ctx.moveTo(mx, my);
    ctx.quadraticCurveTo(px, py, nx, ny);
    ctx.stroke();
    mx = nx; my = ny; px = x; py = y; pp = p;
  }
  ctx.lineWidth = Math.max(0.5, tool.width(s.size, pp, tilt));
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(px, py); ctx.stroke();
  ctx.restore();
}

export class InkLayer {
  constructor({ note, scroller, page, base, live, onChange, onGrow, onZoom, onPenDetected }) {
    Object.assign(this, { note, scroller, page, base, live, onChange, onGrow, onZoom, onPenDetected });
    this.strokes = [];
    this.undoStack = [];
    this.redoStack = [];
    this.tool = 'pen';
    this.color = '#1f1a15';
    this.size = 2.4;
    this.eraser = false;
    this.fingerDraws = false;
    this.zoom = 1;
    this.penSeen = false;
    this.current = null;
    this.predicted = null;
    this.touches = new Map();
    this.erased = null;
    this.frame = 0;
    this.bctx = base.getContext('2d');
    this.lctx = live.getContext('2d');
    this.bind();
  }

  // ---------- geometry ----------
  layout() {
    const s = this.scroller;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    for (const c of [this.base, this.live]) {
      c.style.left = s.offsetLeft + 'px';
      c.style.top = s.offsetTop + 'px';
      c.style.width = s.clientWidth + 'px';
      c.style.height = s.clientHeight + 'px';
      const w = Math.round(s.clientWidth * dpr), h = Math.round(s.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    }
    this.dpr = dpr;
    this.redraw();
  }
  transform() {
    const pr = this.page.getBoundingClientRect(), cr = this.base.getBoundingClientRect();
    return { ox: pr.left - cr.left, oy: pr.top - cr.top, cw: cr.width, ch: cr.height };
  }
  toPage(e) {
    const pr = this.page.getBoundingClientRect();
    return { x: (e.clientX - pr.left) / this.zoom, y: (e.clientY - pr.top) / this.zoom };
  }
  setTransform(ctx) {
    const t = this.transform();
    ctx.setTransform(this.dpr * this.zoom, 0, 0, this.dpr * this.zoom, this.dpr * t.ox, this.dpr * t.oy);
    return t;
  }

  // ---------- rendering ----------
  redraw() {
    const ctx = this.bctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.base.width, this.base.height);
    const t = this.setTransform(ctx);
    const vx0 = -t.ox / this.zoom, vy0 = -t.oy / this.zoom, vx1 = vx0 + t.cw / this.zoom, vy1 = vy0 + t.ch / this.zoom;
    const visible = s => { const b = bbox(s); return b.x1 >= vx0 && b.x0 <= vx1 && b.y1 >= vy0 && b.y0 <= vy1; };
    // Highlighter underneath, ink on top.
    for (const s of this.strokes) if (s.tool === 'highlighter' && visible(s)) drawStroke(ctx, s);
    for (const s of this.strokes) if (s.tool !== 'highlighter' && visible(s)) drawStroke(ctx, s);
  }
  drawLive() {
    this.frame = 0;
    const ctx = this.lctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.live.width, this.live.height);
    if (!this.current) return;
    this.setTransform(ctx);
    drawStroke(ctx, this.current, this.predicted);
  }
  scheduleLive() { if (!this.frame) this.frame = requestAnimationFrame(() => this.drawLive()); }

  // ---------- data ----------
  load(strokes) {
    this.strokes = Array.isArray(strokes) ? strokes.slice() : [];
    this.undoStack = []; this.redoStack = [];
    this.redraw();
  }
  maxY() { let m = 0; for (const s of this.strokes) m = Math.max(m, bbox(s).y1); return m; }
  apply(op, inverse) {
    if (op.add) {
      if (inverse) this.strokes = this.strokes.filter(s => s !== op.add); else this.strokes.push(op.add);
    } else if (op.remove) {
      if (inverse) { for (const r of op.remove.slice().sort((a, b) => a.index - b.index)) this.strokes.splice(Math.min(r.index, this.strokes.length), 0, r.stroke); }
      else { const gone = new Set(op.remove.map(r => r.stroke)); this.strokes = this.strokes.filter(s => !gone.has(s)); }
    }
    this.redraw();
    this.onChange();
  }
  push(op) { this.undoStack.push(op); if (this.undoStack.length > 300) this.undoStack.shift(); this.redoStack = []; this.onChange(); }
  undo() { const op = this.undoStack.pop(); if (op) { this.redoStack.push(op); this.apply(op, true); } }
  redo() { const op = this.redoStack.pop(); if (op) { this.undoStack.push(op); this.apply(op, false); } }
  clear() {
    if (!this.strokes.length) return;
    const op = { remove: this.strokes.map((stroke, index) => ({ stroke, index })) };
    this.strokes = [];
    this.redraw();
    this.push(op);
  }

  // ---------- input ----------
  bind() {
    const el = this.live;
    el.addEventListener('pointerdown', e => this.down(e));
    el.addEventListener('pointermove', e => this.move(e));
    el.addEventListener('pointerup', e => this.up(e));
    el.addEventListener('pointercancel', e => this.up(e, true));
    el.addEventListener('lostpointercapture', e => { if (this.current && e.pointerId === this.drawId) this.up(e); });
    el.addEventListener('contextmenu', e => e.preventDefault());
    el.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) this.onZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
      else this.scroller.scrollBy(e.deltaX, e.deltaY);
    }, { passive: false });
    this.scroller.addEventListener('scroll', () => this.redraw(), { passive: true });
  }
  isPalm(e) { return e.pointerType === 'touch' && (e.width > PALM_WIDTH || e.height > PALM_WIDTH); }
  canDraw(e) {
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return e.button === 0;
    return this.fingerDraws && !this.penSeen;
  }
  down(e) {
    if (e.pointerType === 'pen' && !this.penSeen) { this.penSeen = true; if (this.onPenDetected) this.onPenDetected(); }
    if (this.isPalm(e)) { e.preventDefault(); return; }
    if (this.current && e.pointerType === 'touch') { e.preventDefault(); return; }     // a finger landing mid-stroke
    if (!this.canDraw(e)) { this.touchDown(e); return; }
    e.preventDefault();
    // A pen always wins over fingers that were panning.
    this.touches.clear();
    try { this.live.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.drawId = e.pointerId;
    if (this.eraser) { this.erased = []; this.eraseAt(e); return; }
    const tiltDeg = Math.min(80, Math.hypot(e.tiltX || 0, e.tiltY || 0));
    this.current = { id: Math.random().toString(36).slice(2, 12), tool: this.tool, color: this.color, size: this.size, pts: [] };
    if (this.tool === 'pencil' && e.pointerType === 'pen') this.current.tilt = Math.round((tiltDeg / 80) * 100) / 100;
    this.add(e);
    this.scheduleLive();
  }
  pressure(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.5;
    return 0.5;
  }
  add(e) {
    const { x, y } = this.toPage(e);
    const pts = this.current.pts, n = pts.length;
    if (n && Math.hypot(x - pts[n - 3] / 10, y - pts[n - 2] / 10) < MIN_GAP / this.zoom) return;
    if (n >= 30000) return;
    pts.push(Math.round(x * 10), Math.round(y * 10), Math.round(this.pressure(e) * 1000));
  }
  move(e) {
    if (this.touches.has(e.pointerId)) { this.touchMove(e); return; }
    if (e.pointerId !== this.drawId) return;
    if (!this.current && !this.erased) return;
    e.preventDefault();
    const samples = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = samples.length ? samples : [e];
    if (this.erased) { for (const s of list) this.eraseAt(s); return; }
    for (const s of list) this.add(s);
    const predicted = typeof e.getPredictedEvents === 'function' ? e.getPredictedEvents() : [];
    this.predicted = predicted.length ? predicted.flatMap(p => { const q = this.toPage(p); return [Math.round(q.x * 10), Math.round(q.y * 10), Math.round(this.pressure(p) * 1000)]; }) : null;
    this.scheduleLive();
  }
  up(e, cancelled) {
    if (this.touches.has(e.pointerId)) { this.touches.delete(e.pointerId); this.pinch = null; return; }
    if (e.pointerId !== this.drawId) return;
    this.drawId = null;
    if (this.erased) {
      if (this.erased.length) this.push({ remove: this.erased });
      this.erased = null;
      return;
    }
    const s = this.current;
    this.current = null; this.predicted = null;
    this.drawLive();
    if (!s || cancelled && s.pts.length < 9) return;
    if (!s.pts.length) return;
    this.strokes.push(s);
    this.setTransform(this.bctx);
    drawStroke(this.bctx, s);
    if (s.tool === 'highlighter') this.redraw();
    this.push({ add: s });
    const bottom = bbox(s).y1;
    if (this.onGrow) this.onGrow(bottom);
  }
  eraseAt(e) {
    const { x, y } = this.toPage(e);
    const r = 8 / this.zoom + 4;
    let hit = false;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i], b = bbox(s);
      if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r) continue;
      const reach = r + (TOOLS[s.tool] || TOOLS.pen).width(s.size, 0.5, 0) / 2;
      for (let j = 0; j < s.pts.length; j += 3) {
        if (Math.hypot(s.pts[j] / 10 - x, s.pts[j + 1] / 10 - y) <= reach) {
          this.erased.push({ stroke: s, index: i });
          this.strokes.splice(i, 1);
          hit = true;
          break;
        }
      }
    }
    if (hit) { this.redraw(); this.onChange(); }
  }

  // Fingers pan (one) and pinch-zoom (two) the page while writing.
  touchDown(e) {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    try { this.live.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.pinch = null;
  }
  touchMove(e) {
    e.preventDefault();
    const prev = this.touches.get(e.pointerId);
    const cur = { x: e.clientX, y: e.clientY };
    if (this.touches.size === 1) {
      this.scroller.scrollBy(prev.x - cur.x, prev.y - cur.y);
    } else if (this.touches.size === 2) {
      const pts = [...this.touches.entries()].map(([id, p]) => (id === e.pointerId ? cur : p));
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (!this.pinch) this.pinch = { dist, zoom: this.zoom };
      else if (Math.abs(dist - this.pinch.dist) > 4) this.onZoom(this.pinch.zoom * dist / this.pinch.dist);
    }
    this.touches.set(e.pointerId, cur);
  }
}

/** Render a whole note (paper, text and ink) to a PNG data URL, for "Download as image". */
export function renderPage({ width, height, paper, text, strokes, textLeft }) {
  const scale = 2, c = document.createElement('canvas');
  c.width = width * scale; c.height = height * scale;
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fffdf6'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(84,120,170,.22)'; ctx.fillStyle = 'rgba(84,120,170,.3)'; ctx.lineWidth = 1;
  if (paper === 'lined') {
    for (let y = 31.5; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    ctx.strokeStyle = 'rgba(214,96,80,.45)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(72, 0); ctx.lineTo(72, height); ctx.stroke();
  } else if (paper === 'grid') {
    for (let y = 0.5; y < height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    for (let x = 0.5; x < width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
  } else if (paper === 'dotted') {
    for (let y = 16; y < height; y += 32) for (let x = 16; x < width; x += 32) { ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.fillStyle = '#1f1a15'; ctx.font = '17px system-ui, -apple-system, "Segoe UI", sans-serif'; ctx.textBaseline = 'alphabetic';
  const maxW = width - textLeft - 40;
  let y = 32 + 23;
  for (const para of String(text || '').split('\n')) {
    let line = '';
    for (const word of para.split(/(\s+)/)) {
      if (ctx.measureText(line + word).width > maxW && line) { ctx.fillText(line.trimEnd(), textLeft, y); y += 32; line = word.trimStart(); }
      else line += word;
    }
    ctx.fillText(line, textLeft, y); y += 32;
  }
  for (const s of strokes) if (s.tool === 'highlighter') drawStroke(ctx, s, null, true);
  for (const s of strokes) if (s.tool !== 'highlighter') drawStroke(ctx, s, null, true);
  return c.toDataURL('image/png');
}
