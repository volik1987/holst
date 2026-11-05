// Отрисовка узлов на Canvas2D и попадание курсора. Общая для редактора, экспорта и прототипа.
import { I, mul, inv, ap, localM, distSeg } from './geom.js';
import { FRAMEISH, textLines, lineH, fontStr, varColor, setMeasure } from './model.js';

const mcv = document.createElement('canvas').getContext('2d');
const mcache = new Map();
setMeasure((s, f) => {
  const k = f + '\u0001' + s;
  let v = mcache.get(k);
  if (v == null) { mcv.font = f; v = mcv.measureText(s).width; if (mcache.size > 20000) mcache.clear(); mcache.set(k, v); }
  return v;
});
export const clearMeasure = () => mcache.clear();

export function hexA(hex, a = 1) {
  let h = String(hex || '#000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}
export function paintColor(doc, p, mode) {
  return (p.var && varColor(doc, p.var, mode)) || p.color || '#000000';
}

/* ---------- контуры ---------- */
export function ptsPath(p, pts, closed) {
  if (!pts.length) return;
  p.moveTo(pts[0].x, pts[0].y);
  const cnt = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < cnt; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
  }
  if (closed) p.closePath();
}
function rr(p, w, h, r) {
  r = Math.max(0, Math.min(r || 0, Math.abs(w) / 2, Math.abs(h) / 2));
  if (r > 0 && p.roundRect) p.roundRect(0, 0, w, h, r); else p.rect(0, 0, w, h);
}
export function shapePath(n) {
  const p = new Path2D();
  switch (n.type) {
    case 'ellipse': p.ellipse(n.w / 2, n.h / 2, Math.abs(n.w / 2), Math.abs(n.h / 2), 0, 0, Math.PI * 2); break;
    case 'line': p.moveTo(0, 0); p.lineTo(n.w, 0); break;
    case 'path': ptsPath(p, n.pts, n.closed); break;
    default: rr(p, n.w, n.h, n.radius);
  }
  return p;
}
// Контур узла вместе с потомками (для булевых операций и попадания).
export function deepPath(doc, n) {
  if (n.type === 'group' || n.type === 'bool') {
    const p = new Path2D();
    for (const id of n.children) {
      const c = doc.nodes[id]; if (!c || !c.visible) continue;
      p.addPath(deepPath(doc, c), new DOMMatrix(localM(c)));
    }
    return p;
  }
  return shapePath(n);
}

/* ---------- заливки ---------- */
function gradient(ctx, doc, p, n, mode) {
  const w = n.w, h = n.h || 1, cx = w / 2, cy = h / 2;
  let g;
  if (p.type === 'radial') g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(w, h) / 2);
  else {
    const a = (p.angle ?? 90) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a);
    const L = Math.abs(w / 2 * dx) + Math.abs(h / 2 * dy);
    g = ctx.createLinearGradient(cx - dx * L, cy - dy * L, cx + dx * L, cy + dy * L);
  }
  for (const s of p.stops || []) g.addColorStop(Math.max(0, Math.min(1, s.p)), hexA(s.var ? varColor(doc, s.var, mode) || s.color : s.color, s.a ?? 1));
  return g;
}
export function paintStyle(ctx, doc, p, n, mode) {
  if (p.type === 'linear' || p.type === 'radial') return gradient(ctx, doc, p, n, mode);
  return hexA(paintColor(doc, p, mode), p.a ?? 1);
}

const imgCache = new Map();
export function getImg(doc, id, onload) {
  let im = imgCache.get(id);
  if (!im) {
    const src = doc.images[id]; if (!src) return null;
    im = new Image(); im.src = src; imgCache.set(id, im);
  }
  if (!im.complete && onload) im.addEventListener('load', onload, { once: true });
  return im;
}
export function preloadImages(doc) {
  return Promise.all(Object.keys(doc.images).map(id => {
    const im = getImg(doc, id);
    return im && !im.complete ? new Promise(r => { im.onload = im.onerror = r; }) : null;
  }));
}
function drawImagePaint(ctx, doc, p, n, path, env) {
  const img = getImg(doc, p.img, env.onload);
  if (!img || !img.complete || !img.naturalWidth) return;
  ctx.save(); ctx.clip(path); ctx.globalAlpha *= p.a ?? 1;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  if (p.fit === 'stretch') ctx.drawImage(img, 0, 0, n.w, n.h);
  else if (p.fit === 'tile') {
    const s = p.scale || 1;
    for (let y = 0; y < n.h; y += ih * s) for (let x = 0; x < n.w; x += iw * s) ctx.drawImage(img, x, y, iw * s, ih * s);
  } else {
    const s = p.fit === 'fit' ? Math.min(n.w / iw, n.h / ih) : Math.max(n.w / iw, n.h / ih);
    ctx.drawImage(img, (n.w - iw * s) / 2, (n.h - ih * s) / 2, iw * s, ih * s);
  }
  ctx.restore();
}
function fillPath(ctx, doc, n, path, env, rule) {
  for (const p of n.fills) {
    if (p.on === false) continue;
    if (p.type === 'image') { drawImagePaint(ctx, doc, p, n, path, env); continue; }
    ctx.fillStyle = paintStyle(ctx, doc, p, n, env.mode);
    ctx.fill(path, rule || 'nonzero');
  }
}
function strokePath(ctx, doc, n, path, env) {
  if (!n.sw) return;
  for (const p of n.strokes) {
    if (p.on === false || p.type === 'image') continue;
    ctx.strokeStyle = paintStyle(ctx, doc, p, n, env.mode);
    ctx.lineWidth = n.sw; ctx.lineJoin = 'round'; ctx.lineCap = n.cap || 'butt';
    if (n.dash) ctx.setLineDash([n.dash, n.dash]);
    if (n.salign === 'inside' && n.type !== 'line' && n.type !== 'path') {
      ctx.save(); ctx.clip(path); ctx.lineWidth = n.sw * 2; ctx.stroke(path); ctx.restore();
    } else if (n.salign === 'outside' && n.type !== 'line' && n.type !== 'path') {
      ctx.save(); const o = new Path2D(); o.rect(-1e5, -1e5, 2e5, 2e5); o.addPath(path); ctx.clip(o, 'evenodd'); ctx.lineWidth = n.sw * 2; ctx.stroke(path); ctx.restore();
    } else ctx.stroke(path);
    ctx.setLineDash([]);
  }
}
function drawShadows(ctx, doc, n, path, env) {
  for (const e of n.effects) {
    if (e.on === false || e.type !== 'shadow') continue;
    ctx.save();
    const t = ctx.getTransform(), T = 20000 / Math.max(Math.hypot(t.a, t.b), 1e-3);
    ctx.shadowColor = hexA(e.color, e.a ?? 0.25);
    ctx.shadowBlur = (e.r || 0) * env.scale;
    ctx.shadowOffsetX = (e.x || 0) * env.scale - t.a * T;
    ctx.shadowOffsetY = (e.y || 0) * env.scale - t.b * T;
    ctx.translate(T, 0);
    ctx.fillStyle = '#000';
    if (n.type === 'line' || (n.type === 'path' && !n.closed && !n.fills.length)) { ctx.lineWidth = n.sw; ctx.strokeStyle = '#000'; ctx.stroke(path); }
    else ctx.fill(path);
    ctx.restore();
  }
}

/* ---------- текст ---------- */
function drawText(ctx, doc, n, env) {
  const lines = textLines(n), lh = lineH(n);
  ctx.font = fontStr(n);
  if ('letterSpacing' in ctx) ctx.letterSpacing = (n.ls || 0) + 'px';
  ctx.textBaseline = 'middle';
  ctx.textAlign = n.align === 'center' ? 'center' : n.align === 'right' ? 'right' : 'left';
  const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0;
  const sh = n.effects.find(e => e.type === 'shadow' && e.on !== false);
  ctx.save();
  if (sh) { ctx.shadowColor = hexA(sh.color, sh.a ?? 0.25); ctx.shadowBlur = (sh.r || 0) * env.scale; ctx.shadowOffsetX = (sh.x || 0) * env.scale; ctx.shadowOffsetY = (sh.y || 0) * env.scale; }
  for (const p of n.fills) {
    if (p.on === false || p.type === 'image') continue;
    ctx.fillStyle = paintStyle(ctx, doc, p, n, env.mode);
    lines.forEach((l, i) => ctx.fillText(l, x, i * lh + lh / 2));
    if (n.deco !== 'none') {
      lines.forEach((l, i) => {
        const w = ctx.measureText(l).width, x0 = ctx.textAlign === 'center' ? x - w / 2 : ctx.textAlign === 'right' ? x - w : x;
        const y = i * lh + lh / 2 + (n.deco === 'underline' ? n.size * 0.45 : 0);
        ctx.fillRect(x0, y, w, Math.max(1, n.size / 14));
      });
    }
  }
  ctx.restore();
  if (n.sw && n.strokes.length) for (const p of n.strokes) {
    if (p.on === false) continue;
    ctx.strokeStyle = paintStyle(ctx, doc, p, n, env.mode); ctx.lineWidth = n.sw;
    lines.forEach((l, i) => ctx.strokeText(l, x, i * lh + lh / 2));
  }
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
}

/* ---------- булевы операции через композицию ---------- */
const offPool = [];
function drawBool(ctx, doc, n, env) {
  const cv = ctx.canvas, d = env.depth || 0;
  let off = offPool[d];
  if (!off) off = offPool[d] = document.createElement('canvas');
  if (off.width !== cv.width || off.height !== cv.height) { off.width = cv.width; off.height = cv.height; }
  const o = off.getContext('2d');
  o.setTransform(1, 0, 0, 1, 0, 0); o.clearRect(0, 0, off.width, off.height);
  o.setTransform(ctx.getTransform());
  const ops = { union: 'source-over', subtract: 'destination-out', intersect: 'destination-in', exclude: 'xor' };
  let first = true;
  for (const id of n.children) {
    const c = doc.nodes[id]; if (!c || !c.visible) continue;
    o.save(); o.transform(...localM(c));
    o.globalCompositeOperation = first ? 'source-over' : ops[n.op] || 'source-over';
    o.fillStyle = '#000'; o.fill(deepPath(doc, c));
    o.restore(); first = false;
  }
  let k = 0;
  for (const p of n.fills) {
    if (p.on === false || p.type === 'image') continue;
    o.globalCompositeOperation = k++ ? 'source-atop' : 'source-in';
    o.fillStyle = paintStyle(o, doc, p, n, env.mode);
    o.fillRect(-1, -1, n.w + 2, n.h + 2);
  }
  o.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();
}

/* ---------- обход ---------- */
export function drawNode(ctx, doc, n, env) {
  if (!n || !n.visible || (env.hide && env.hide.has(n.id))) return;
  ctx.save();
  ctx.transform(...localM(n));
  ctx.globalAlpha *= n.opacity ?? 1;
  if (n.blend && n.blend !== 'normal') ctx.globalCompositeOperation = n.blend;
  if (n.vmode != null && n.vmode !== '' && +n.vmode !== env.mode) env = { ...env, mode: +n.vmode };
  const blur = n.effects.find(e => e.type === 'blur' && e.on !== false);
  if (blur) ctx.filter = `blur(${(blur.r || 0) * env.scale}px)`;
  if (n.type === 'group') {
    for (const id of n.children) drawNode(ctx, doc, doc.nodes[id], env);
  } else if (n.type === 'bool') {
    drawBool(ctx, doc, n, { ...env, depth: (env.depth || 0) + 1 });
  } else if (n.type === 'text') {
    drawText(ctx, doc, n, env);
  } else {
    const path = shapePath(n);
    drawShadows(ctx, doc, n, path, env);
    if (n.type !== 'line') fillPath(ctx, doc, n, path, env);
    if (n.children && n.children.length) {
      ctx.save();
      if (n.clip) ctx.clip(path);
      for (const id of n.children) drawNode(ctx, doc, doc.nodes[id], env);
      ctx.restore();
    }
    strokePath(ctx, doc, n, path, env);
  }
  ctx.restore();
}

/* ---------- попадание ---------- */
const hctx = document.createElement('canvas').getContext('2d');
function hitNode(doc, id, pm, wx, wy, tol, deep) {
  const n = doc.nodes[id];
  if (!n || !n.visible || n.locked) return null;
  const m = mul(pm, localM(n)), l = ap(inv(m), wx, wy);
  const ins = l.x >= 0 && l.y >= 0 && l.x <= n.w && l.y <= n.h;
  if (n.type === 'bool') {
    if (!ins) return null;
    return hctx.isPointInPath(deepPath(doc, n), l.x, l.y) ? id : null;
  }
  if (n.children) {
    if (FRAMEISH.has(n.type) && n.clip && !ins) return null;
    for (let i = n.children.length - 1; i >= 0; i--) {
      const r = hitNode(doc, n.children[i], m, wx, wy, tol, deep);
      if (r) return r;
    }
    return FRAMEISH.has(n.type) && ins ? id : null;
  }
  if (n.type === 'text') return ins ? id : null;
  if (n.type === 'line') return distSeg(l.x, l.y, 0, 0, n.w, 0) <= tol + n.sw / 2 ? id : null;
  const p = shapePath(n);
  const hasFill = n.fills.some(f => f.on !== false);
  if ((hasFill || n.type !== 'path' || n.closed) && hctx.isPointInPath(p, l.x, l.y)) return id;
  hctx.lineWidth = (n.sw || 0) + tol * 2;
  return hctx.isPointInStroke(p, l.x, l.y) ? id : null;
}
export function hitTest(doc, rootId, wx, wy, tol = 3) {
  const root = doc.nodes[rootId];
  const pm = root.type === 'page' ? I : mul(worldParent(doc, rootId), I);
  if (root.type !== 'page') return hitNode(doc, rootId, worldParent(doc, rootId), wx, wy, tol);
  for (let i = root.children.length - 1; i >= 0; i--) {
    const r = hitNode(doc, root.children[i], pm, wx, wy, tol);
    if (r) return r;
  }
  return null;
}
function worldParent(doc, id) {
  const n = doc.nodes[id]; const chain = [];
  let p = doc.nodes[n.parent];
  while (p && p.type !== 'page' && p.type !== 'root') { chain.unshift(p); p = doc.nodes[p.parent]; }
  return chain.reduce((m, a) => mul(m, localM(a)), I);
}

/* ---------- рендер узла в отдельный холст (экспорт, прототип) ---------- */
export function renderToCanvas(doc, ids, scale, opts = {}) {
  const { worldBox, worldM } = opts.M;
  let b = null;
  for (const id of ids) {
    const wb = worldBox(doc, id);
    b = b ? { x: Math.min(b.x, wb.x), y: Math.min(b.y, wb.y), x1: Math.max(b.x1, wb.x + wb.w), y1: Math.max(b.y1, wb.y + wb.h) } : { x: wb.x, y: wb.y, x1: wb.x + wb.w, y1: wb.y + wb.h };
  }
  const pad = opts.pad || 0;
  const W = Math.max(1, Math.ceil((b.x1 - b.x + pad * 2) * scale)), H = Math.max(1, Math.ceil((b.y1 - b.y + pad * 2) * scale));
  const cv = opts.canvas || document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, W, H); }
  for (const id of ids) {
    const n = doc.nodes[id];
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, (pad - b.x) * scale, (pad - b.y) * scale);
    ctx.transform(...worldM(doc, n.parent));
    drawNode(ctx, doc, n, { scale, mode: opts.mode ?? doc.mode, onload: opts.onload });
    ctx.restore();
  }
  return { canvas: cv, box: { x: b.x, y: b.y, w: b.x1 - b.x, h: b.y1 - b.y } };
}
