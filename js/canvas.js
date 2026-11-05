// Холст: отрисовка сцены и оверлеев, мышь и инструменты.
import * as M from './model.js';
import { inv, ap, apv, mul, corners, aabb, localM } from './geom.js';
import { drawNode, hitTest, ptsPath } from './render.js';
import { A, N, commit, live, redraw, select, toWorld, toScreen, zoomAt, frameAt, nextName, duplicateSel, moveWorld, boxOf, toast } from './app.js';

const BLUE = '#0d99ff', RED = '#f24822', PURPLE = '#9747ff';
let cv, ctx, wrap, dpr = 1;
let drag = null;          // текущее действие мышью
let hover = null;         // id под курсором
let guides = [];          // направляющие при перетаскивании
let marquee = null;
let mouse = { x: 0, y: 0, wx: 0, wy: 0, alt: false };
let labels = [];          // подписи фреймов (для клика)
let spaceDown = false;
export const peersView = { list: [] }; // курсоры соавторов

export function initCanvas() {
  cv = document.getElementById('cv'); wrap = document.getElementById('stage');
  ctx = cv.getContext('2d');
  new ResizeObserver(resize).observe(wrap);
  resize();
  cv.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  cv.addEventListener('dblclick', dbl);
  cv.addEventListener('wheel', wheel, { passive: false });
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const w = toWorld(e.offsetX, e.offsetY);
    const t = pick(hitTest(A.doc, A.page, w.x, w.y, 4 / A.zoom), false);
    if (t && !A.sel.includes(t)) select([t]);
    A.emit('contextmenu', { x: e.clientX, y: e.clientY });
  });
  window.addEventListener('keydown', e => { if (e.code === 'Space' && !isTyping()) { if (!spaceDown) { spaceDown = true; setCursor('grab'); } e.preventDefault(); } if (e.key === 'Alt') { mouse.alt = true; redraw(); } });
  window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; setCursor(''); } if (e.key === 'Alt') { mouse.alt = false; redraw(); } });
  window.addEventListener('blur', () => { spaceDown = false; mouse.alt = false; });
  A.on('draw', draw);
}
export const isTyping = () => { const a = document.activeElement; return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
function resize() {
  dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(wrap.clientWidth * dpr); cv.height = Math.round(wrap.clientHeight * dpr);
  cv.style.width = wrap.clientWidth + 'px'; cv.style.height = wrap.clientHeight + 'px';
  redraw();
}
function setCursor(c) { cv.style.cursor = c; }

/* ================= выбор цели ================= */
// Группы, булевы и экземпляры «входятся» двойным щелчком; фреймы прозрачны.
const ENTRY = new Set(['group', 'bool', 'instance']);
export function pick(hitId, deep) {
  if (!hitId) return null;
  if (deep) return hitId;
  const doc = A.doc;
  const entered = new Set();
  for (const id of A.sel) for (const a of M.ancestors(doc, id)) entered.add(a.id);
  const chain = M.ancestors(doc, hitId).reverse().filter(a => a.type !== 'page'); // сверху вниз
  for (const a of chain) if (ENTRY.has(a.type) && !entered.has(a.id)) return a.id;
  return hitId;
}
// Пустой фон фрейма верхнего уровня с детьми — начинаем рамку выделения, а не перенос.
const isBgFrame = id => { const n = N(id); return n && M.FRAMEISH.has(n.type) && n.parent === A.page && n.children.length && !A.sel.includes(id); };

/* ================= направляющие ================= */
function snapTargets(exclude, parentId) {
  const doc = A.doc, ex = new Set(exclude), boxes = [];
  const p = N(parentId);
  if (p && p.type !== 'page') boxes.push(M.worldBox(doc, parentId));
  const sib = p ? p.children : [];
  for (const id of sib) if (!ex.has(id) && N(id)?.visible) boxes.push(M.worldBox(doc, id));
  if (p && p.type !== 'page') for (const id of N(A.page).children) if (!ex.has(id) && id !== parentId) boxes.push(M.worldBox(doc, id));
  const xs = [], ys = [];
  for (const b of boxes) { xs.push(b.x, b.x + b.w / 2, b.x + b.w); ys.push(b.y, b.y + b.h / 2, b.y + b.h); }
  return { xs, ys, boxes };
}
function snapAxis(vals, lines, tol) {
  let best = null;
  for (const v of vals) for (const l of lines) { const d = l - v; if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, l }; }
  return best;
}
function snapBox(b, T) {
  const tol = 6 / A.zoom;
  const sx = snapAxis([b.x, b.x + b.w / 2, b.x + b.w], T.xs, tol);
  const sy = snapAxis([b.y, b.y + b.h / 2, b.y + b.h], T.ys, tol);
  return { dx: sx ? sx.d : 0, dy: sy ? sy.d : 0 };
}
function makeGuides(b, T) {
  guides = [];
  const eps = 0.01;
  for (const v of [b.x, b.x + b.w / 2, b.x + b.w]) for (const o of T.boxes) for (const l of [o.x, o.x + o.w / 2, o.x + o.w]) if (Math.abs(l - v) < eps) guides.push({ x: v, y0: Math.min(b.y, o.y), y1: Math.max(b.y + b.h, o.y + o.h) });
  for (const v of [b.y, b.y + b.h / 2, b.y + b.h]) for (const o of T.boxes) for (const l of [o.y, o.y + o.h / 2, o.y + o.h]) if (Math.abs(l - v) < eps) guides.push({ y: v, x0: Math.min(b.x, o.x), x1: Math.max(b.x + b.w, o.x + o.w) });
}
function snapPoint(wx, wy, T, ax = true, ay = true) {
  const tol = 6 / A.zoom;
  const sx = ax && snapAxis([wx], T.xs, tol), sy = ay && snapAxis([wy], T.ys, tol);
  return { x: sx ? sx.l : wx, y: sy ? sy.l : wy };
}

/* ================= рамка выделения (для ручек) ================= */
function selFrame() {
  if (!A.sel.length) return null;
  if (A.sel.length === 1) {
    const n = N(A.sel[0]); if (!n) return null;
    return { m: M.worldM(A.doc, n.id), w: n.w, h: n.h, n };
  }
  const b = boxOf(A.sel); if (!b) return null;
  return { m: [1, 0, 0, 1, b.x, b.y], w: b.w, h: b.h };
}
const HANDLES = [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]];
function handleAt(sx, sy) {
  const f = selFrame(); if (!f || A.editPath || A.tool !== 'select') return null;
  const n = f.n;
  if (n && (n.locked || (M.isClone(n.id) && false))) return null;
  const S = mul([A.zoom, 0, 0, A.zoom, A.px, A.py], f.m);
  if (n && n.type === 'line') {
    for (let i = 0; i < 2; i++) { const p = ap(S, i * f.w, 0); if (Math.hypot(p.x - sx, p.y - sy) < 8) return { kind: 'lineEnd', i }; }
    return null;
  }
  const small = f.w * A.zoom < 24 || f.h * A.zoom < 24;
  for (let i = 0; i < 8; i++) {
    if (small && i % 2) continue;
    const [u, v] = HANDLES[i]; const p = ap(S, u * f.w, v * f.h);
    if (Math.hypot(p.x - sx, p.y - sy) < 7) return { kind: 'resize', u, v };
  }
  // края целиком
  const l = ap(inv(S), sx, sy), tx = 5 / A.zoom;
  if (n?.type !== 'text' || true) {
    const inY = l.y > 0 && l.y < f.h, inX = l.x > 0 && l.x < f.w;
    if (inY && Math.abs(l.x) < tx) return { kind: 'resize', u: 0, v: 0.5 };
    if (inY && Math.abs(l.x - f.w) < tx) return { kind: 'resize', u: 1, v: 0.5 };
    if (inX && Math.abs(l.y) < tx) return { kind: 'resize', u: 0.5, v: 0 };
    if (inX && Math.abs(l.y - f.h) < tx) return { kind: 'resize', u: 0.5, v: 1 };
  }
  // зона поворота за углами
  for (let i = 0; i < 8; i += 2) {
    const [u, v] = HANDLES[i]; const p = ap(S, u * f.w, v * f.h);
    const d = Math.hypot(p.x - sx, p.y - sy);
    const outside = l.x < 0 || l.y < 0 || l.x > f.w || l.y > f.h;
    if (d < 20 && outside) return { kind: 'rotate' };
  }
  return null;
}
const CUR = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
function handleCursor(h) {
  if (!h) return '';
  if (h.kind === 'rotate') return 'crosshair';
  if (h.kind === 'lineEnd') return 'move';
  const f = selFrame(); const rot = (f.n?.rot || 0);
  const ang = Math.atan2(h.v - 0.5, h.u - 0.5) * 180 / Math.PI + rot;
  const idx = Math.round(((ang % 180) + 180) % 180 / 45) % 4; // 0:→ 1:↘ 2:↓ 3:↙
  return [CUR[3], CUR[0], CUR[1], CUR[2]][idx];
}

/* ================= мышь ================= */
function evPos(e) { const r = cv.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top; const w = toWorld(x, y); return { x, y, wx: w.x, wy: w.y }; }

function down(e) {
  if (A.present) return;
  try { cv.setPointerCapture(e.pointerId); } catch { }
  const p = evPos(e);
  Object.assign(mouse, p);
  if (A.editText) { A.emit('endText'); }
  if (e.button === 1 || spaceDown || A.tool === 'hand') { drag = { kind: 'pan', sx: p.x, sy: p.y, px: A.px, py: A.py }; setCursor('grabbing'); return; }
  if (e.button === 2) return;
  const doc = A.doc;

  if (A.tool === 'pen') return penDown(p, e);
  if (A.editPath) { if (pathDown(p, e)) return; }

  if (['rect', 'ellipse', 'frame', 'line', 'text'].includes(A.tool)) {
    const parent = frameAt(p.wx, p.wy);
    drag = { kind: 'create', type: A.tool, sx: Math.round(p.wx), sy: Math.round(p.wy), parent, id: null, T: snapTargets([], parent) };
    return;
  }

  // ручки
  const h = handleAt(p.x, p.y);
  if (h) return startHandle(h, p, e);

  // подписи фреймов
  for (const L of labels) if (p.x >= L.x && p.x <= L.x + L.w && p.y >= L.y && p.y <= L.y + L.h) {
    if (e.shiftKey) select([L.id], true); else if (!A.sel.includes(L.id)) select([L.id]);
    return startMove(p, e);
  }

  const hit = hitTest(doc, A.page, p.wx, p.wy, 4 / A.zoom);
  let t = pick(hit, e.metaKey || e.ctrlKey);
  // щелчок внутри выделенного — оставляем выделение (для переноса нескольких)
  if (t && !A.sel.includes(t)) {
    const selAnc = A.sel.find(id => M.isAncestor(doc, id, t) && ENTRY.has(N(id).type));
    if (selAnc) t = selAnc;
  }
  if (t && isBgFrame(t) && !e.shiftKey && hit === t) {
    drag = { kind: 'marquee', sx: p.wx, sy: p.wy, scope: t, base: [] };
    select([]);
    return;
  }
  if (!t) {
    drag = { kind: 'marquee', sx: p.wx, sy: p.wy, scope: A.page, base: e.shiftKey ? [...A.sel] : [] };
    if (!e.shiftKey) select([]);
    return;
  }
  if (e.shiftKey) { select([t], true); return; }
  if (!A.sel.includes(t)) select([t]);
  startMove(p, e);
}

function startMove(p, e) {
  const doc = A.doc;
  let ids = M.topLevel(doc, A.sel).filter(id => !N(id).locked);
  if (!ids.length) return;
  if (e.altKey && ids.every(id => !M.isClone(id))) { ids = duplicateSel(false); }
  const st = {};
  for (const id of ids) { const n = N(id); st[id] = { x: n.x, y: n.y }; }
  const parent = N(ids[0]).parent;
  drag = { kind: 'move', sx: p.wx, sy: p.wy, ids, st, box: boxOf(ids), T: snapTargets(ids, parent), moved: false };
}

function startHandle(h, p, e) {
  const doc = A.doc, f = selFrame();
  if (h.kind === 'rotate') {
    const c = ap(f.m, f.w / 2, f.h / 2);
    const targets = [];
    const add = id => { const n = N(id); if (n.type === 'group' || n.type === 'bool') n.children.forEach(add); else targets.push(id); };
    M.topLevel(doc, A.sel).forEach(add);
    const st = {};
    for (const id of targets) { const n = N(id); const wm = M.worldM(doc, id); st[id] = { rot: n.rot || 0, c: ap(wm, n.w / 2, n.h / 2), pm: inv(M.worldM(doc, n.parent)) }; }
    drag = { kind: 'rotate', c, a0: Math.atan2(p.wy - c.y, p.wx - c.x), st, targets, single: A.sel.length === 1 ? A.sel[0] : null };
    return;
  }
  if (h.kind === 'lineEnd') {
    const n = f.n, pm = M.worldM(doc, n.parent), lm = localM(n);
    drag = { kind: 'lineEnd', id: n.id, i: h.i, p0: ap(lm, 0, 0), p1: ap(lm, n.w, 0), ipm: inv(pm), T: snapTargets([n.id], n.parent) };
    return;
  }
  if (A.sel.length === 1) {
    const n = f.n;
    drag = { kind: 'resize', id: n.id, u: h.u, v: h.v, n0: { x: n.x, y: n.y, w: n.w, h: n.h, rot: n.rot || 0 }, im: inv(f.m), lm0: localM(n), T: snapTargets([n.id], n.parent) };
  } else {
    const ids = M.topLevel(doc, A.sel), st = {};
    for (const id of ids) { const n = N(id); st[id] = { b: M.worldBox(doc, id), w: n.w, h: n.h, pm: inv(M.worldM(doc, n.parent)), x: n.x, y: n.y }; }
    drag = { kind: 'mresize', u: h.u, v: h.v, b0: boxOf(ids), ids, st, T: snapTargets(ids, N(ids[0]).parent) };
  }
}

function move(e) {
  if (A.present) return;
  const p = evPos(e);
  Object.assign(mouse, p); mouse.alt = e.altKey;
  A.emit('cursor', { x: p.wx, y: p.wy });
  if (!drag) {
    if (e.target !== cv) { if (hover) { hover = null; redraw(); } return; }
    if (A.tool === 'pen' && A.pen) { redraw(); return; }
    const h = A.tool === 'select' && !spaceDown ? handleAt(p.x, p.y) : null;
    setCursor(spaceDown || A.tool === 'hand' ? 'grab' : h ? handleCursor(h) : A.tool === 'text' ? 'text' : A.tool !== 'select' ? 'crosshair' : '');
    const nh = h ? null : pick(hitTest(A.doc, A.page, p.wx, p.wy, 4 / A.zoom), e.metaKey || e.ctrlKey);
    if (nh !== hover) { hover = nh; redraw(); }
    else if (mouse.alt) redraw();
    return;
  }
  const doc = A.doc;
  switch (drag.kind) {
    case 'pan': A.px = drag.px + p.x - drag.sx; A.py = drag.py + p.y - drag.sy; A.emit('zoom'); redraw(); break;
    case 'marquee': {
      marquee = { x: Math.min(drag.sx, p.wx), y: Math.min(drag.sy, p.wy), w: Math.abs(p.wx - drag.sx), h: Math.abs(p.wy - drag.sy) };
      const ids = N(drag.scope).children.filter(id => { const n = N(id); if (!n.visible || n.locked) return false; const b = M.worldBox(doc, id); return b.x < marquee.x + marquee.w && marquee.x < b.x + b.w && b.y < marquee.y + marquee.h && marquee.y < b.y + b.h; });
      const s = [...new Set([...drag.base, ...ids])];
      if (s.join() !== A.sel.join()) { A.sel = s; A.emit('select'); A.emit('change'); }
      redraw(); break;
    }
    case 'move': {
      let dx = p.wx - drag.sx, dy = p.wy - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) * A.zoom < 3) return;
      if (!drag.moved) { drag.moved = true; for (const id of drag.ids) { const n = N(id); if (N(n.parent)?.layout && !n.abs) n._drag = true; } }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const b = { ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy };
      const s = snapBox(b, drag.T);
      dx = Math.round(dx + s.dx); dy = Math.round(dy + s.dy);
      const sx = Math.round(drag.box.x + dx) - (drag.box.x + dx); dx += sx;
      const sy = Math.round(drag.box.y + dy) - (drag.box.y + dy); dy += sy;
      for (const id of drag.ids) {
        const n = N(id); if (!n) continue;
        const d = apv(inv(M.worldM(doc, n.parent)), dx, dy);
        M.setProp(doc, n, 'x', drag.st[id].x + d.x); M.setProp(doc, n, 'y', drag.st[id].y + d.y);
      }
      makeGuides({ ...drag.box, x: drag.box.x + dx, y: drag.box.y + dy }, drag.T);
      drag.drop = frameAt(p.wx, p.wy, drag.ids);
      live(); break;
    }
    case 'resize': doResize(p, e); break;
    case 'mresize': doMResize(p, e); break;
    case 'rotate': {
      let da = (Math.atan2(p.wy - drag.c.y, p.wx - drag.c.x) - drag.a0) * 180 / Math.PI;
      if (drag.single && N(drag.single)?.type !== 'group' && N(drag.single)?.type !== 'bool') {
        const r0 = drag.st[drag.single]?.rot || 0;
        let r = r0 + da; if (e.shiftKey) r = Math.round(r / 15) * 15; da = r - r0;
      } else if (e.shiftKey) da = Math.round(da / 15) * 15;
      const ra = da * Math.PI / 180, c = Math.cos(ra), s = Math.sin(ra);
      for (const id of drag.targets) {
        const n = N(id), st = drag.st[id]; if (!n) continue;
        const wc = { x: drag.c.x + (st.c.x - drag.c.x) * c - (st.c.y - drag.c.y) * s, y: drag.c.y + (st.c.x - drag.c.x) * s + (st.c.y - drag.c.y) * c };
        const lc = ap(st.pm, wc.x, wc.y);
        let r = ((st.rot + da) % 360 + 540) % 360 - 180;
        M.setProp(doc, n, 'rot', Math.round(r * 100) / 100);
        M.setProp(doc, n, 'x', lc.x - n.w / 2); M.setProp(doc, n, 'y', lc.y - n.h / 2);
      }
      drag.angle = da;
      live(); break;
    }
    case 'lineEnd': {
      const n = N(drag.id);
      let q = snapPoint(p.wx, p.wy, drag.T);
      let l = ap(drag.ipm, q.x, q.y);
      const o = drag.i === 0 ? drag.p1 : drag.p0;
      if (e.shiftKey) { const a = Math.round(Math.atan2(l.y - o.y, l.x - o.x) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(l.x - o.x, l.y - o.y); l = { x: o.x + Math.cos(a) * d, y: o.y + Math.sin(a) * d }; }
      const a = drag.i === 0 ? l : o, b = drag.i === 0 ? o : l;
      const len = Math.hypot(b.x - a.x, b.y - a.y), rot = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
      M.setProp(doc, n, 'w', len); M.setProp(doc, n, 'rot', Math.round(rot * 100) / 100);
      M.setProp(doc, n, 'x', (a.x + b.x) / 2 - len / 2); M.setProp(doc, n, 'y', (a.y + b.y) / 2);
      live(); break;
    }
    case 'create': doCreate(p, e); break;
    case 'penHandle': {
      const pt = A.pen.pts[A.pen.pts.length - 1];
      pt.ox = p.wx; pt.oy = p.wy; pt.ix = 2 * pt.x - p.wx; pt.iy = 2 * pt.y - p.wy;
      redraw(); break;
    }
    case 'pathPt': doPathDrag(p, e); break;
  }
}

function up(e) {
  if (!drag) return;
  const d = drag; drag = null; guides = []; marquee = null;
  const doc = A.doc;
  if (d.kind === 'pan') { setCursor(spaceDown || A.tool === 'hand' ? 'grab' : ''); return; }
  if (d.kind === 'marquee') { redraw(); A.emit('change'); return; }
  if (d.kind === 'move') {
    if (!d.moved) {
      // щелчок без переноса по выделенной группе — ничего
      redraw(); return;
    }
    const target = d.drop;
    const p = mouse;
    for (const id of d.ids) {
      const n = N(id); if (!n || M.isClone(id)) continue;
      delete n._drag;
      const cur = n.parent;
      if (target && target !== cur && !d.ids.includes(target) && !M.isClone(target)) {
        const tn = N(target);
        let idx;
        if (tn.layout) { const l = ap(inv(M.worldM(doc, target)), p.wx, p.wy); idx = M.layoutIndex(doc, tn, l.x, l.y, id); }
        M.reparent(doc, id, target, idx);
      } else if (N(cur)?.layout && !n.abs) {
        const pn = N(cur), l = ap(inv(M.worldM(doc, cur)), p.wx, p.wy);
        const idx = M.layoutIndex(doc, pn, l.x, l.y, id);
        pn.children.splice(pn.children.indexOf(id), 1); pn.children.splice(idx, 0, id);
      }
    }
    commit(); return;
  }
  if (d.kind === 'create') return endCreate(d);
  if (d.kind === 'penHandle') { redraw(); return; }
  if (d.kind === 'pathPt') { const n = N(A.editPath); if (n) { M.normPath(n); commit(); } return; }
  commit();
}

function wheel(e) {
  e.preventDefault();
  if (A.present) return;
  const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  if (e.ctrlKey || e.metaKey) {
    const k = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01));
    zoomAt(A.zoom * k, sx, sy);
  } else {
    const f = e.deltaMode ? 20 : 1;
    if (e.shiftKey && !e.deltaX) { A.px -= e.deltaY * f; } else { A.px -= e.deltaX * f; A.py -= e.deltaY * f; }
    A.emit('zoom'); redraw();
  }
}

function dbl(e) {
  const p = evPos(e), doc = A.doc;
  if (A.tool === 'pen') { finishPen(false); return; }
  if (A.editPath) return;
  const hit = hitTest(doc, A.page, p.wx, p.wy, 4 / A.zoom);
  if (!hit) return;
  const s = A.sel.length === 1 ? N(A.sel[0]) : null;
  if (s && s.children && (ENTRY.has(s.type) || M.FRAMEISH.has(s.type)) && M.isAncestor(doc, s.id, hit)) {
    // войти внутрь: ближайший ребёнок по пути к попаданию
    const chain = [hit, ...M.ancestors(doc, hit).map(a => a.id)];
    const i = chain.indexOf(s.id);
    select([chain[i - 1]]);
    return;
  }
  const t = s && s.id === hit ? hit : pick(hit, false);
  const n = N(t);
  if (n?.type === 'text') { select([t]); A.emit('editText', t); }
  else if (n?.type === 'path' || n?.type === 'line' || n?.type === 'rect' || n?.type === 'ellipse') { if (n.type === 'path') { select([t]); A.editPath = t; A.pathSel = -1; redraw(); A.emit('change'); } }
}

/* ================= изменение размеров ================= */
function doResize(p, e) {
  const doc = A.doc, d = drag, n = N(d.id); if (!n) return;
  let wx = p.wx, wy = p.wy;
  if (!d.n0.rot) { const q = snapPoint(wx, wy, d.T, d.u !== 0.5, d.v !== 0.5); wx = Math.round(q.x); wy = Math.round(q.y); }
  const l = ap(d.im, wx, wy), w0 = d.n0.w, h0 = d.n0.h;
  let L = 0, R = w0, T = 0, B = h0;
  const hx = d.u === 1 ? 1 : d.u === 0 ? -1 : 0, hy = d.v === 1 ? 1 : d.v === 0 ? -1 : 0;
  if (hx === 1) R = l.x; if (hx === -1) L = l.x;
  if (hy === 1) B = l.y; if (hy === -1) T = l.y;
  if (e.altKey) { if (hx === 1) L = w0 - R; if (hx === -1) R = w0 - L; if (hy === 1) T = h0 - B; if (hy === -1) B = h0 - T; }
  if (e.shiftKey && w0 && h0) {
    let sw = (R - L) / w0, sh = (B - T) / h0;
    const s = hx && hy ? (Math.abs(sw) > Math.abs(sh) ? sw : sh) : hx ? sw : sh;
    const nw = w0 * s, nh = h0 * s;
    if (!hx) { L = (w0 - nw) / 2; R = L + nw; } else if (hx === -1) L = R - nw; else R = L + nw;
    if (!hy) { T = (h0 - nh) / 2; B = T + nh; } else if (hy === -1) T = B - nh; else B = T + nh;
  }
  if (R < L) [L, R] = [R, L]; if (B < T) [T, B] = [B, T];
  const nw = Math.max(1, R - L), nh = Math.max(1, B - T);
  const pc = ap(d.lm0, L + nw / 2, T + nh / 2);
  if (n.type === 'text') { if (hx) M.setProp(doc, n, 'auto', hy ? 'fixed' : 'height'); else if (hy) M.setProp(doc, n, 'auto', 'fixed'); }
  if (N(n.parent)?.layout && !n.abs) { if (hx && n.grow) M.setProp(doc, n, 'grow', false); }
  if (n.layout) { const L2 = { ...n.layout }; if (hx) L2.hugW = false; if (hy) L2.hugH = false; M.setProp(doc, n, 'layout', L2); }
  M.resizeNode(doc, n, nw, nh);
  M.setProp(doc, n, 'w', nw); M.setProp(doc, n, 'h', nh);
  M.setProp(doc, n, 'x', pc.x - nw / 2); M.setProp(doc, n, 'y', pc.y - nh / 2);
  live();
}
function doMResize(p, e) {
  const doc = A.doc, d = drag, b = d.b0;
  const q = snapPoint(p.wx, p.wy, d.T, d.u !== 0.5, d.v !== 0.5);
  let x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
  if (d.u === 1) x1 = q.x; if (d.u === 0) x0 = q.x; if (d.v === 1) y1 = q.y; if (d.v === 0) y0 = q.y;
  if (e.shiftKey) { const s = Math.max((x1 - x0) / b.w, (y1 - y0) / b.h); if (d.u === 0) x0 = x1 - b.w * s; else x1 = x0 + b.w * s; if (d.v === 0) y0 = y1 - b.h * s; else y1 = y0 + b.h * s; }
  const sx = Math.max(0.01, (x1 - x0) / b.w), sy = Math.max(0.01, (y1 - y0) / b.h);
  for (const id of d.ids) {
    const n = N(id), st = d.st[id]; if (!n) continue;
    const nwx = x0 + (st.b.x - b.x) * sx, nwy = y0 + (st.b.y - b.y) * sy;
    M.resizeNode(doc, n, st.w * sx, st.h * sy); M.setProp(doc, n, 'w', n.w); M.setProp(doc, n, 'h', n.h);
    const nb = M.worldBox(doc, id);
    const dl = apv(st.pm, nwx - nb.x, nwy - nb.y);
    M.setProp(doc, n, 'x', n.x + dl.x); M.setProp(doc, n, 'y', n.y + dl.y);
  }
  live();
}

/* ================= создание фигур ================= */
function doCreate(p, e) {
  const doc = A.doc, d = drag;
  const q = snapPoint(Math.round(p.wx), Math.round(p.wy), d.T);
  let x0 = d.sx, y0 = d.sy, x1 = Math.round(q.x), y1 = Math.round(q.y);
  if (!d.id && Math.hypot(x1 - x0, y1 - y0) * A.zoom < 3) return;
  if (d.type === 'line') {
    if (e.shiftKey) { const a = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x1 - x0, y1 - y0); x1 = x0 + Math.cos(a) * l; y1 = y0 + Math.sin(a) * l; }
  } else {
    if (e.shiftKey) { const s = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * s; y1 = y0 + Math.sign(y1 - y0 || 1) * s; }
    if (e.altKey) { x0 = 2 * d.sx - x1; y0 = 2 * d.sy - y1; }
  }
  const ipm = inv(M.worldM(doc, d.parent));
  const a = ap(ipm, x0, y0), b = ap(ipm, x1, y1);
  if (!d.id) {
    const names = { rect: 'Прямоугольник', ellipse: 'Эллипс', frame: 'Фрейм', line: 'Линия', text: 'Текст' };
    const props = { name: nextName(names[d.type]) };
    if (d.type === 'text') Object.assign(props, { text: '', auto: 'height', name: 'Текст' });
    const n = M.mk(d.type, props);
    M.insert(doc, n, d.parent);
    d.id = n.id; A.sel = [n.id]; A.emit('select');
  }
  const n = N(d.id);
  if (d.type === 'line') {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    n.w = len; n.rot = Math.round(Math.atan2(b.y - a.y, b.x - a.x) * 18000 / Math.PI) / 100; n.x = (a.x + b.x) / 2 - len / 2; n.y = (a.y + b.y) / 2;
  } else {
    n.x = Math.min(a.x, b.x); n.y = Math.min(a.y, b.y); M.resizeNode(doc, n, Math.max(1, Math.abs(b.x - a.x)), Math.max(1, Math.abs(b.y - a.y)));
  }
  makeGuides(M.worldBox(doc, n.id), d.T);
  live();
}
function endCreate(d) {
  const doc = A.doc;
  if (!d.id) { // щелчок без протяжки
    const ipm = inv(M.worldM(doc, d.parent)), l = ap(ipm, d.sx, d.sy);
    const names = { rect: 'Прямоугольник', ellipse: 'Эллипс', frame: 'Фрейм', line: 'Линия', text: 'Текст' };
    const props = { name: nextName(names[d.type]), x: Math.round(l.x), y: Math.round(l.y) };
    if (d.type === 'text') Object.assign(props, { text: '', auto: 'width', name: 'Текст' });
    if (d.type === 'line') props.w = 100;
    const n = M.mk(d.type, props);
    M.insert(doc, n, d.parent);
    d.id = n.id; A.sel = [n.id];
  }
  const n = N(d.id);
  A.tool = 'select'; A.emit('tool');
  if (n.type === 'text') { A.sel = [n.id]; M.normalize(doc); A.emit('select'); A.emit('editText', n.id); return; }
  commit(); A.emit('select');
}

/* ================= перо ================= */
function penDown(p, e) {
  if (!A.pen) A.pen = { pts: [] };
  const P = A.pen.pts;
  if (P.length > 1) {
    const f = toScreen(P[0].x, P[0].y);
    if (Math.hypot(f.x - p.x, f.y - p.y) < 8) { finishPen(true); return; }
  }
  let x = p.wx, y = p.wy;
  if (e.shiftKey && P.length) { const o = P[P.length - 1], a = Math.round(Math.atan2(y - o.y, x - o.x) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(x - o.x, y - o.y); x = o.x + Math.cos(a) * l; y = o.y + Math.sin(a) * l; }
  P.push({ x, y, ix: x, iy: y, ox: x, oy: y });
  drag = { kind: 'penHandle' };
  redraw();
}
export function finishPen(close) {
  const pen = A.pen; A.pen = null;
  if (!pen || pen.pts.length < 2) { redraw(); return; }
  const doc = A.doc;
  const parent = frameAt(pen.pts[0].x, pen.pts[0].y);
  const ipm = inv(M.worldM(doc, parent));
  const pts = pen.pts.map(q => { const a = ap(ipm, q.x, q.y), i = ap(ipm, q.ix, q.iy), o = ap(ipm, q.ox, q.oy); return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; });
  const n = M.mk('path', { name: nextName('Вектор'), pts, closed: close, x: 0, y: 0, w: 1, h: 1, fills: close ? [M.solid('#d9d9d9')] : [] });
  M.insert(doc, n, parent);
  M.normPath(n);
  A.tool = 'select'; A.emit('tool');
  A.sel = [n.id]; commit(); A.emit('select');
}

/* ================= правка контура ================= */
function pathDown(p, e) {
  const n = N(A.editPath); if (!n) { A.editPath = null; return false; }
  const wm = M.worldM(A.doc, n.id), S = mul([A.zoom, 0, 0, A.zoom, A.px, A.py], wm);
  const near = (x, y) => { const s = ap(S, x, y); return Math.hypot(s.x - p.x, s.y - p.y) < 7; };
  if (A.pathSel >= 0) {
    const q = n.pts[A.pathSel];
    if (q && near(q.ix, q.iy)) { drag = { kind: 'pathPt', which: 'in', i: A.pathSel, im: inv(wm) }; return true; }
    if (q && near(q.ox, q.oy)) { drag = { kind: 'pathPt', which: 'out', i: A.pathSel, im: inv(wm) }; return true; }
  }
  for (let i = 0; i < n.pts.length; i++) if (near(n.pts[i].x, n.pts[i].y)) {
    A.pathSel = i; drag = { kind: 'pathPt', which: 'pt', i, im: inv(wm) }; redraw(); return true;
  }
  // щелчок мимо — выход из режима
  A.editPath = null; A.pathSel = -1; M.normPath(n); commit();
  return false;
}
function doPathDrag(p, e) {
  const n = N(A.editPath), d = drag; if (!n) return;
  const l = ap(d.im, p.wx, p.wy), q = n.pts[d.i];
  if (d.which === 'pt') { const dx = l.x - q.x, dy = l.y - q.y; q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy; }
  else if (d.which === 'in') { q.ix = l.x; q.iy = l.y; if (!e.altKey) { q.ox = 2 * q.x - l.x; q.oy = 2 * q.y - l.y; } }
  else { q.ox = l.x; q.oy = l.y; if (!e.altKey) { q.ix = 2 * q.x - l.x; q.iy = 2 * q.y - l.y; } }
  M.setProp(A.doc, n, 'pts', n.pts);
  redraw();
}
export function deletePathPoint() {
  const n = N(A.editPath); if (!n || A.pathSel < 0) return false;
  if (n.pts.length <= 2) return true;
  n.pts.splice(A.pathSel, 1); A.pathSel = -1; M.setProp(A.doc, n, 'pts', n.pts); M.normPath(n); commit();
  return true;
}

/* ================= отрисовка ================= */
function strokePoly(pts, color, w = 1) {
  ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath();
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
}
function screenCorners(id) { const n = N(id); const m = M.worldM(A.doc, id); return corners(m, n.w, n.h).map(p => toScreen(p.x, p.y)); }
function pill(text, x, y, bg = BLUE, align = 'center') {
  ctx.font = '600 11px Inter, system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  const x0 = align === 'center' ? x - w / 2 : x;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y, w, 17, 3) : ctx.rect(x0, y, w, 17); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(text, x0 + 5, y + 9);
}
const fmt = v => String(Math.round(v * 100) / 100);

function draw() {
  if (!A.doc || !cv) return;
  const doc = A.doc, page = N(A.page); if (!page) return;
  const W = cv.width / dpr, H = cv.height / dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  ctx.fillStyle = page.bg || '#f0f0f0'; ctx.fillRect(0, 0, cv.width, cv.height);
  const s = dpr * A.zoom;
  const hide = new Set(); if (A.editText) hide.add(A.editText);
  const vb = { x: -A.px / A.zoom, y: -A.py / A.zoom, w: W / A.zoom, h: H / A.zoom };
  for (const id of page.children) {
    const n = N(id); if (!n) continue;
    const b = M.worldBox(doc, id), pad = 50 / A.zoom + 100;
    if (b.x > vb.x + vb.w + pad || b.y > vb.y + vb.h + pad || b.x + b.w < vb.x - pad || b.y + b.h < vb.y - pad) continue;
    ctx.save(); ctx.setTransform(s, 0, 0, s, A.px * dpr, A.py * dpr);
    drawNode(ctx, doc, n, { scale: s, mode: doc.mode, hide, onload: redraw });
    ctx.restore();
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  // пиксельная сетка
  if (A.zoom >= 8) {
    ctx.strokeStyle = 'rgba(0,0,0,0.07)'; ctx.lineWidth = 1; ctx.beginPath();
    const x0 = Math.floor(vb.x), y0 = Math.floor(vb.y);
    for (let x = x0; x < vb.x + vb.w; x++) { const sx = Math.round(x * A.zoom + A.px) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, H); }
    for (let y = y0; y < vb.y + vb.h; y++) { const sy = Math.round(y * A.zoom + A.py) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(W, sy); }
    ctx.stroke();
  }
  // подписи фреймов верхнего уровня
  labels = [];
  ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
  for (const id of page.children) {
    const n = N(id); if (!n || !n.visible || !M.FRAMEISH.has(n.type)) continue;
    const p = toScreen(...Object.values(ap(M.worldM(doc, id), 0, 0)));
    const isC = n.type === 'component' || n.type === 'instance';
    const sel = A.sel.includes(id);
    ctx.fillStyle = isC ? PURPLE : sel ? BLUE : '#777';
    const name = (n.type === 'component' ? '❖ ' : n.type === 'instance' ? '◇ ' : '') + n.name;
    const maxw = Math.max(20, n.w * A.zoom);
    let t = name; while (t.length > 1 && ctx.measureText(t).width > maxw) t = t.slice(0, -2) + '…';
    if (!n.rot) { ctx.fillText(t, p.x, p.y - 4); labels.push({ id, x: p.x, y: p.y - 18, w: ctx.measureText(t).width, h: 16 }); }
  }
  // контуры компонентов
  for (const id of page.children) {
    const n = N(id);
    if (n?.type === 'component' && !A.sel.includes(id)) strokePoly(screenCorners(id), 'rgba(151,71,255,0.5)');
  }
  // прототип: связи
  if (A.rightTab === 'proto') drawLinks();
  // наведение
  if (hover && !A.sel.includes(hover) && !drag && N(hover)) {
    const n = N(hover);
    if (n.type === 'path' || n.type === 'line') { ctx.save(); ctx.setTransform(s, 0, 0, s, A.px * dpr, A.py * dpr); ctx.transform(...M.worldM(doc, hover)); ctx.strokeStyle = BLUE; ctx.lineWidth = 2 / A.zoom; const p = new Path2D(); if (n.type === 'line') { p.moveTo(0, 0); p.lineTo(n.w, 0); } else ptsPath(p, n.pts, n.closed); ctx.stroke(p); ctx.restore(); }
    else strokePoly(screenCorners(hover), M.isClone(hover) || n.type === 'instance' || n.type === 'component' ? PURPLE : BLUE, 1.5);
  }
  if (drag?.kind === 'move' && drag.drop && drag.drop !== A.page && drag.drop !== N(drag.ids[0])?.parent) strokePoly(screenCorners(drag.drop), BLUE, 2);
  // выделение
  if (A.sel.length) {
    for (const id of A.sel) if (N(id)) {
      const n = N(id);
      if (n.type === 'line') { const c = screenCorners(id); ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.strokeStyle = BLUE; ctx.lineWidth = 1; ctx.stroke(); }
      else strokePoly(screenCorners(id), M.isClone(id) || n.type === 'component' || n.type === 'instance' ? PURPLE : BLUE, 1);
    }
    const f = selFrame();
    if (f && !A.editPath && !A.editText) {
      const S = mul([A.zoom, 0, 0, A.zoom, A.px, A.py], f.m);
      if (A.sel.length > 1) strokePoly(corners(S, f.w, f.h), BLUE, 1);
      const col = f.n && (M.isClone(f.n.id) || f.n.type === 'component' || f.n.type === 'instance') ? PURPLE : BLUE;
      const hs = f.n?.type === 'line' ? [[0, 0], [1, 0]] : HANDLES.filter((h, i) => !(i % 2) || (f.w * A.zoom >= 24 && f.h * A.zoom >= 24 && f.n?.type !== 'text'));
      if (!f.n || !f.n.locked) for (const [u, v] of hs) {
        const p = ap(S, u * f.w, v * f.h);
        ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 1;
        ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 4 + 0.5, p.y - 4 + 0.5, 7, 7);
      }
      // размер
      const bb = aabb(corners(S, f.w, f.h));
      const label = drag?.kind === 'rotate' ? `${fmt(drag.single ? N(drag.single).rot : drag.angle)}°` : f.n?.type === 'line' ? fmt(f.w) : `${fmt(f.w)} × ${fmt(f.h)}`;
      pill(label, bb.x + bb.w / 2, bb.y + bb.h + 6, col);
      if (f.n?.layout) drawLayoutHints(f.n, S);
    }
  }
  // правка контура
  if (A.editPath && N(A.editPath)) drawPathEdit();
  // перо
  if (A.pen) drawPen();
  // рамка выделения
  if (marquee) {
    const a = toScreen(marquee.x, marquee.y);
    ctx.fillStyle = 'rgba(13,153,255,0.08)'; ctx.strokeStyle = BLUE; ctx.lineWidth = 1;
    ctx.fillRect(a.x, a.y, marquee.w * A.zoom, marquee.h * A.zoom); ctx.strokeRect(a.x + 0.5, a.y + 0.5, marquee.w * A.zoom, marquee.h * A.zoom);
  }
  // направляющие
  if (guides.length) {
    ctx.strokeStyle = RED; ctx.lineWidth = 1; ctx.beginPath();
    for (const g of guides) {
      if (g.x != null) { const a = toScreen(g.x, g.y0), b = toScreen(g.x, g.y1); ctx.moveTo(Math.round(a.x) + 0.5, a.y); ctx.lineTo(Math.round(b.x) + 0.5, b.y); }
      else { const a = toScreen(g.x0, g.y), b = toScreen(g.x1, g.y); ctx.moveTo(a.x, Math.round(a.y) + 0.5); ctx.lineTo(b.x, Math.round(b.y) + 0.5); }
    }
    ctx.stroke();
  }
  // расстояния с Alt
  if (mouse.alt && A.sel.length && !drag) drawMeasure();
  // соавторы
  drawPeers();
}

function drawLayoutHints(n, S) {
  // пунктир отступов авто-раскладки
  const [t, r, b, l] = n.layout.pad;
  ctx.save(); ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(13,153,255,0.6)';
  strokePoly([ap(S, l, t), ap(S, n.w - r, t), ap(S, n.w - r, n.h - b), ap(S, l, n.h - b)], 'rgba(13,153,255,0.5)');
  ctx.restore();
}
function drawPathEdit() {
  const n = N(A.editPath);
  const S = mul([A.zoom, 0, 0, A.zoom, A.px, A.py], M.worldM(A.doc, n.id));
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const p2 = new Path2D(); ptsPath(p2, n.pts, n.closed);
  ctx.transform(...S); ctx.strokeStyle = BLUE; ctx.lineWidth = 1 / A.zoom; ctx.stroke(p2);
  ctx.restore();
  n.pts.forEach((q, i) => {
    const s = ap(S, q.x, q.y);
    if (i === A.pathSel) {
      for (const [hx, hy] of [[q.ix, q.iy], [q.ox, q.oy]]) {
        const h = ap(S, hx, hy);
        ctx.strokeStyle = BLUE; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(h.x, h.y); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, 3.5, 0, 7); ctx.fill(); ctx.stroke();
      }
    }
    ctx.fillStyle = i === A.pathSel ? BLUE : '#fff'; ctx.strokeStyle = BLUE;
    ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill(); ctx.stroke();
  });
}
function drawPen() {
  const P = A.pen.pts; if (!P.length) return;
  ctx.save(); ctx.setTransform(dpr * A.zoom, 0, 0, dpr * A.zoom, A.px * dpr, A.py * dpr);
  const p = new Path2D(); ptsPath(p, P, false);
  const last = P[P.length - 1];
  if (!drag) { p.moveTo(last.x, last.y); p.bezierCurveTo(last.ox, last.oy, mouse.wx, mouse.wy, mouse.wx, mouse.wy); }
  ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5 / A.zoom; ctx.stroke(p);
  ctx.restore();
  for (const q of P) { const s = toScreen(q.x, q.y); ctx.fillStyle = '#fff'; ctx.strokeStyle = BLUE; ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill(); ctx.stroke(); }
  const h = toScreen(last.ox, last.oy), s = toScreen(last.x, last.y);
  if (Math.hypot(h.x - s.x, h.y - s.y) > 2) { ctx.beginPath(); ctx.moveTo(2 * s.x - h.x, 2 * s.y - h.y); ctx.lineTo(h.x, h.y); ctx.stroke(); }
}
function drawMeasure() {
  const doc = A.doc;
  const a = boxOf(A.sel); if (!a) return;
  let other = hover && !A.sel.includes(hover) ? M.worldBox(doc, hover) : null;
  if (!other) { const p = N(N(A.sel[0]).parent); if (p && p.type !== 'page') other = M.worldBox(doc, p.id); }
  if (!other) return;
  strokePoly([other, { x: other.x + other.w, y: other.y }, { x: other.x + other.w, y: other.y + other.h }, { x: other.x, y: other.y + other.h }].map(p => toScreen(p.x, p.y)), RED, 1);
  const segs = [];
  const cy = a.y + a.h / 2, cx = a.x + a.w / 2;
  const contains = other.x <= a.x && other.y <= a.y && other.x + other.w >= a.x + a.w && other.y + other.h >= a.y + a.h;
  if (contains) {
    segs.push([other.x, cy, a.x, cy], [a.x + a.w, cy, other.x + other.w, cy], [cx, other.y, cx, a.y], [cx, a.y + a.h, cx, other.y + other.h]);
  } else {
    if (other.x >= a.x + a.w) segs.push([a.x + a.w, cy, other.x, cy]);
    if (other.x + other.w <= a.x) segs.push([other.x + other.w, cy, a.x, cy]);
    if (other.y >= a.y + a.h) segs.push([cx, a.y + a.h, cx, other.y]);
    if (other.y + other.h <= a.y) segs.push([cx, other.y + other.h, cx, a.y]);
  }
  ctx.strokeStyle = RED; ctx.lineWidth = 1;
  for (const [x0, y0, x1, y1] of segs) {
    const d = Math.hypot(x1 - x0, y1 - y0); if (d < 0.01) continue;
    const p = toScreen(x0, y0), q = toScreen(x1, y1);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    pill(fmt(d), (p.x + q.x) / 2, (p.y + q.y) / 2 - 8, RED);
  }
}
function drawLinks() {
  const doc = A.doc;
  const page = N(A.page);
  if (page.start && N(page.start)) { const p = toScreen(...Object.values(ap(M.worldM(doc, page.start), 0, 0))); pill('▶ Старт', p.x, p.y - 40, BLUE, 'left'); }
  M.walk(doc, A.page, n => {
    if (!n.link?.to) return;
    const a = M.worldBox(doc, n.id); let b = null;
    if (n.link.to === 'back') { b = null; } else if (N(n.link.to)) b = M.worldBox(doc, n.link.to);
    const s = toScreen(a.x + a.w, a.y + a.h / 2);
    ctx.strokeStyle = BLUE; ctx.fillStyle = BLUE; ctx.lineWidth = 2;
    if (!b) { pill('← Назад', s.x + 6, s.y - 8, BLUE, 'left'); return; }
    const e = toScreen(b.x, b.y + Math.min(b.h / 2, 60));
    const dx = Math.max(40, Math.abs(e.x - s.x) / 2);
    ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.bezierCurveTo(s.x + dx, s.y, e.x - dx, e.y, e.x - 6, e.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - 9, e.y - 5); ctx.lineTo(e.x - 9, e.y + 5); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x, s.y, 4, 0, 7); ctx.fill();
  });
}
function drawPeers() {
  for (const p of peersView.list) {
    if (p.page !== A.page) continue;
    for (const id of p.sel || []) if (N(id)) strokePoly(screenCorners(id), p.color, 2);
    if (p.x == null) continue;
    const s = toScreen(p.x, p.y);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x + 3, s.y + 15); ctx.lineTo(s.x + 7, s.y + 10); ctx.lineTo(s.x + 13, s.y + 9); ctx.closePath(); ctx.fill();
    pill(p.name, s.x + 12, s.y + 14, p.color, 'left');
  }
}
export function cancelDrag() { drag = null; guides = []; marquee = null; redraw(); }
