// Модель документа «Холста»: плоская карта узлов + история + авто-раскладка + компоненты.
// Модуль не трогает DOM — его гоняют тесты в node.
import { I, mul, localM, corners, aabb, ap, bezPts } from './geom.js';

export const uid = () => Math.random().toString(36).slice(2, 10);
export const CONTAINERS = new Set(['page', 'frame', 'component', 'instance', 'group', 'bool']);
export const FRAMEISH = new Set(['frame', 'component', 'instance']);
export const isClone = id => id.includes(':');
export const solid = (color, a = 1) => ({ type: 'solid', color, a });

const DEF = {
  page: { name: 'Страница', bg: '#f0f0f0' },
  frame: { name: 'Фрейм', fills: [solid('#ffffff')], clip: true },
  component: { name: 'Компонент', fills: [solid('#ffffff')], clip: true },
  instance: { name: 'Экземпляр', clip: true, overrides: {} },
  group: { name: 'Группа' },
  bool: { name: 'Объединение', op: 'union', fills: [solid('#999999')] },
  rect: { name: 'Прямоугольник', fills: [solid('#d9d9d9')] },
  ellipse: { name: 'Эллипс', fills: [solid('#d9d9d9')] },
  line: { name: 'Линия', h: 0, strokes: [solid('#000000')], sw: 1 },
  path: { name: 'Вектор', pts: [], closed: false, strokes: [solid('#000000')], sw: 2 },
  text: { name: 'Текст', autoName: true, text: 'Текст', font: 'Inter', size: 16, weight: 400, italic: false, lh: 0, ls: 0, align: 'left', auto: 'width', deco: 'none', fills: [solid('#000000')] },
};
export const TYPE_RU = { page: 'Страница', frame: 'Фрейм', component: 'Компонент', instance: 'Экземпляр', group: 'Группа', bool: 'Булева операция', rect: 'Прямоугольник', ellipse: 'Эллипс', line: 'Линия', path: 'Вектор', text: 'Текст' };

export function mk(type, props = {}) {
  const n = {
    id: uid(), type, name: '', x: 0, y: 0, w: 100, h: 100, rot: 0, opacity: 1, visible: true, locked: false,
    fills: [], strokes: [], sw: 1, radius: 0, effects: [], blend: 'normal', parent: null,
    ...structuredClone(DEF[type] || {}), ...props,
  };
  if (CONTAINERS.has(type) && !n.children) n.children = [];
  return n;
}

/* ---------- документ и дерево ---------- */
export function newDoc(name = 'Без названия') {
  const doc = { id: uid(), v: 1, name, nodes: {}, images: {}, vars: [], modes: ['Светлая', 'Тёмная'], mode: 0 };
  doc.nodes.root = { id: 'root', type: 'root', children: [] };
  addPage(doc, 'Страница 1');
  return doc;
}
export function addPage(doc, name) { return insert(doc, mk('page', { name }), 'root'); }

export function insert(doc, n, parentId, index) {
  doc.nodes[n.id] = n; n.parent = parentId;
  const ch = doc.nodes[parentId].children;
  if (index == null || index > ch.length) ch.push(n.id); else ch.splice(Math.max(0, index), 0, n.id);
  return n;
}
export function unlink(doc, id) {
  const n = doc.nodes[id], p = n && doc.nodes[n.parent];
  if (p) { const i = p.children.indexOf(id); if (i >= 0) p.children.splice(i, 1); }
}
function delSub(doc, id) {
  const n = doc.nodes[id]; if (!n) return;
  if (n.children) for (const c of n.children) delSub(doc, c);
  delete doc.nodes[id];
}
export function remove(doc, id) { if (!doc.nodes[id]) return; unlink(doc, id); delSub(doc, id); }

export const parentOf = (doc, n) => doc.nodes[n.parent];
export function ancestors(doc, id) { // ближайший первым, страницу включает
  const r = []; let n = doc.nodes[id];
  while (n && n.parent && n.parent !== 'root') { n = doc.nodes[n.parent]; if (!n) break; r.push(n); }
  return r;
}
export function pageOf(doc, id) { let n = doc.nodes[id]; while (n && n.type !== 'page') n = doc.nodes[n.parent]; return n; }
export function isAncestor(doc, a, id) { let n = doc.nodes[id]; while (n) { if (n.parent === a) return true; n = doc.nodes[n.parent]; } return false; }
export function worldM(doc, id) {
  const n = doc.nodes[id];
  if (!n || n.type === 'page' || n.type === 'root') return I;
  return mul(worldM(doc, n.parent), localM(n));
}
export function worldBox(doc, id) { const n = doc.nodes[id]; return aabb(corners(worldM(doc, id), n.w, n.h)); }
export function walk(doc, id, fn) { const n = doc.nodes[id]; if (!n) return; if (fn(n) === false) return; if (n.children) for (const c of [...n.children]) walk(doc, c, fn); }
export function treeOrder(doc, ids) { // порядок как в дереве (снизу вверх)
  const pos = new Map(); let i = 0;
  walk(doc, 'root', n => { pos.set(n.id, i++); });
  return [...ids].sort((a, b) => pos.get(a) - pos.get(b));
}
// Убрать из выделения узлы, чьи предки тоже выделены.
export function topLevel(doc, ids) { const s = new Set(ids); return ids.filter(id => !ancestors(doc, id).some(a => s.has(a.id))); }

// Копия поддерева с новыми id (корень первым); корень без родителя.
export function cloneTree(doc, id, idFn = () => uid()) {
  const out = [];
  const rec = (sid, parent) => {
    const s = doc.nodes[sid]; const c = structuredClone(s);
    c.id = idFn(s); c.parent = parent; out.push(c);
    if (s.children) c.children = s.children.filter(k => doc.nodes[k]).map(k => rec(k, c.id));
    return c.id;
  };
  rec(id, null);
  return out;
}
export function insertTree(doc, nodes, parentId, index) {
  for (const n of nodes.slice(1)) doc.nodes[n.id] = n;
  return insert(doc, nodes[0], parentId, index);
}
// Присвоить новые id всем потомкам (для отсоединения экземпляра).
export function reId(doc, rootId) {
  const root = doc.nodes[rootId];
  const rec = (n, parentId) => {
    n.parent = parentId;
    if (!n.children) return;
    n.children = n.children.filter(k => doc.nodes[k]).map(k => {
      const c = doc.nodes[k]; delete doc.nodes[k];
      c.id = uid(); doc.nodes[c.id] = c; rec(c, n.id); return c.id;
    });
  };
  rec(root, root.parent);
}

// Перенести узел в другого родителя, сохранив положение на холсте.
export function reparent(doc, id, newParent, index) {
  const n = doc.nodes[id];
  const wm = worldM(doc, id);
  const pm = worldM(doc, newParent);
  const lm = mul(invM(pm), wm);
  unlink(doc, id);
  const r = Math.atan2(lm[1], lm[0]) * 180 / Math.PI;
  const c = lm[0], s = lm[1], cx = n.w / 2, cy = n.h / 2;
  n.x = lm[4] - cx + c * cx - s * cy; n.y = lm[5] - cy + s * cx + c * cy;
  n.rot = Math.abs(r) < 1e-3 ? 0 : Math.round(r * 1000) / 1000;
  n.x = Math.round(n.x * 100) / 100; n.y = Math.round(n.y * 100) / 100;
  insert(doc, n, newParent, index);
}
function invM(m) { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; }

/* ---------- компоненты и экземпляры ---------- */
export const INST_COPY = ['fills', 'strokes', 'sw', 'radius', 'effects', 'opacity', 'clip', 'layout', 'blend'];
const NO_OVERRIDE = new Set(['parent', 'children', 'id', 'type', 'main', 'overrides', '_drag']);

// Все пользовательские правки идут через setProp — так запоминаются переопределения экземпляров.
export function setProp(doc, n, k, v) {
  n[k] = v;
  if (NO_OVERRIDE.has(k)) return;
  if (!isClone(n.id)) {
    if (n.type === 'instance' && INST_COPY.includes(k)) ((n.overrides ||= {})[''] ||= {})[k] = structuredClone(v);
    return;
  }
  const rid = n.id.slice(0, n.id.indexOf(':')), r = doc.nodes[rid];
  if (!r) return;
  const key = n.id.slice(rid.length + 1);
  ((r.overrides ||= {})[key] ||= {})[k] = structuredClone(v);
}
export function realInstanceOf(doc, id) { return isClone(id) ? doc.nodes[id.slice(0, id.indexOf(':'))] : null; }

export function syncInstances(doc) {
  const done = new Set();
  for (const id of Object.keys(doc.nodes)) {
    const n = doc.nodes[id];
    if (n && n.type === 'instance' && !isClone(id)) syncInst(doc, n, done, []);
  }
}
function syncInst(doc, inst, done, stack) {
  if (done.has(inst.id)) return; done.add(inst.id);
  const main = doc.nodes[inst.main];
  if (!main || main.type !== 'component' || stack.includes(main.id) || isAncestor(doc, main.id, inst.id)) return;
  walk(doc, main.id, n => { if (n !== main && n.type === 'instance' && !isClone(n.id)) syncInst(doc, n, done, [...stack, main.id]); });
  const ov = inst.overrides || {};
  for (const k of INST_COPY) if (!(ov[''] && k in ov[''])) inst[k] = structuredClone(main[k]);
  for (const c of inst.children) delSub(doc, c);
  inst.children = [];
  const pre = inst.id + ':';
  for (const c of main.children) {
    if (!doc.nodes[c]) continue;
    const out = cloneTree(doc, c, s => pre + s.id);
    out[0].parent = inst.id;
    for (const o of out) doc.nodes[o.id] = o;
    inst.children.push(out[0].id);
  }
  if (!inst.layout && (Math.abs(main.w - inst.w) > 1e-3 || Math.abs(main.h - inst.h) > 1e-3))
    for (const c of inst.children) applyConstraint(doc, doc.nodes[c], main.w, main.h, inst.w, inst.h);
  for (const key in ov) {
    if (!key) continue;
    const t = doc.nodes[pre + key];
    if (t) Object.assign(t, structuredClone(ov[key]));
  }
}
export function makeInstance(doc, mainId, parentId, x, y, index) {
  const main = doc.nodes[mainId];
  const n = mk('instance', { name: main.name, main: mainId, x, y, w: main.w, h: main.h });
  insert(doc, n, parentId, index);
  syncInst(doc, n, new Set(), []);
  return n;
}
export function detachInstance(doc, id) {
  const n = doc.nodes[id];
  if (!n || n.type !== 'instance' || isClone(id)) return;
  reId(doc, id);
  n.type = 'frame'; delete n.main; delete n.overrides;
}

/* ---------- ограничения и изменение размеров ---------- */
function axis(m, x, w, o, nn) {
  switch (m) {
    case 'right': case 'bottom': return [x + (nn - o), w];
    case 'center': return [x + (nn - o) / 2, w];
    case 'stretch': return [x, Math.max(1, w + (nn - o))];
    case 'scale': return [o ? x * nn / o : x, o ? w * nn / o : w];
    default: return [x, w];
  }
}
export function applyConstraint(doc, c, ow, oh, nw, nh) {
  if (!c) return;
  const k = c.cons || {};
  const [x, w] = axis(k.h || 'left', c.x, c.w, ow, nw);
  const [y, h] = axis(k.v || 'top', c.y, c.h, oh, nh);
  if (w !== c.w || h !== c.h) resizeNode(doc, c, w, h);
  c.x = x; c.y = y;
}
export function resizeNode(doc, n, w, h) {
  w = Math.max(w, n.type === 'line' ? 0 : 0.01); h = Math.max(h, n.type === 'line' ? 0 : 0.01);
  if (n.type === 'line') h = 0;
  const ow = n.w, oh = n.h;
  if (ow === w && oh === h) return;
  if (n.type === 'group' || n.type === 'bool') {
    const sx = ow ? w / ow : 1, sy = oh ? h / oh : 1;
    for (const id of n.children) {
      const c = doc.nodes[id]; if (!c) continue;
      c.x *= sx; c.y *= sy; resizeNode(doc, c, c.w * sx, c.h * sy);
    }
    n.w = w; n.h = h; return;
  }
  if (n.type === 'path') {
    const sx = ow ? w / ow : 1, sy = oh ? h / oh : 1;
    n.pts = n.pts.map(p => ({ x: p.x * sx, y: p.y * sy, ix: p.ix * sx, iy: p.iy * sy, ox: p.ox * sx, oy: p.oy * sy }));
  }
  n.w = w; n.h = h;
  if (FRAMEISH.has(n.type) && !n.layout && ow && oh)
    for (const id of n.children) applyConstraint(doc, doc.nodes[id], ow, oh, w, h);
}
// Подогнать рамку контура под точки (с сохранением положения на холсте).
export function normPath(n) {
  if (!n.pts.length) return;
  const all = [];
  const P = n.pts, cnt = n.closed ? P.length : P.length - 1;
  all.push({ x: P[0].x, y: P[0].y });
  for (let i = 0; i < cnt; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    all.push(...bezPts({ x: a.x, y: a.y }, { x: a.ox, y: a.oy }, { x: b.ix, y: b.iy }, { x: b.x, y: b.y }));
  }
  const bb = aabb(all), nw = Math.max(bb.w, 0.01), nh = Math.max(bb.h, 0.01);
  const pc = ap(localM(n), bb.x + nw / 2, bb.y + nh / 2);
  n.pts = P.map(p => ({ x: p.x - bb.x, y: p.y - bb.y, ix: p.ix - bb.x, iy: p.iy - bb.y, ox: p.ox - bb.x, oy: p.oy - bb.y }));
  n.w = nw; n.h = nh; n.x = pc.x - nw / 2; n.y = pc.y - nh / 2;
}

/* ---------- текст ---------- */
let measureFn = (s, font) => s.length * 0.55 * parseFloat(/(\d+(\.\d+)?)px/.exec(font)[1]);
export const setMeasure = f => { measureFn = f; };
export const fontStr = n => `${n.italic ? 'italic ' : ''}${n.weight} ${n.size}px "${n.font}", sans-serif`;
export const lineH = n => n.lh > 0 ? n.lh : Math.round(n.size * 1.2);
const tw = (n, s) => measureFn(s, fontStr(n)) + (n.ls || 0) * s.length;
export function caseText(n) { const t = String(n.text ?? ''); return n.tcase === 'upper' ? t.toUpperCase() : n.tcase === 'lower' ? t.toLowerCase() : t; }
export function textLines(n) {
  const lines = [];
  for (const p of caseText(n).split('\n')) {
    if (n.auto === 'width') { lines.push(p); continue; }
    let cur = '';
    for (const w of p.split(/(\s+)/)) {
      if (!w) continue;
      const t = cur + w;
      if (cur.trim() && tw(n, t.trimEnd()) > n.w + 0.5) { lines.push(cur.trimEnd()); cur = /^\s+$/.test(w) ? '' : w; }
      else cur = t;
      while (cur.length > 1 && tw(n, cur) > n.w + 0.5) {
        let i = cur.length - 1; while (i > 1 && tw(n, cur.slice(0, i)) > n.w) i--;
        lines.push(cur.slice(0, i)); cur = cur.slice(i);
      }
    }
    lines.push(cur);
  }
  return lines;
}
export function autosizeText(n) {
  if (n.auto === 'fixed') return;
  const lines = textLines(n);
  if (n.auto === 'width') n.w = Math.max(1, Math.ceil(Math.max(0, ...lines.map(l => tw(n, l)))));
  n.h = Math.max(1, lines.length * lineH(n));
}

/* ---------- авто-раскладка ---------- */
export function defaultLayout(dir = 'row') { return { dir, gap: 10, pad: [10, 10, 10, 10], main: 'start', cross: 'start', hugW: true, hugH: true }; }
export function applyLayout(doc, f) {
  const L = f.layout; if (!L) return;
  const row = L.dir !== 'col';
  const [pt, pr, pb, pl] = L.pad;
  const kids = f.children.map(id => doc.nodes[id]).filter(c => c && c.visible && !c.abs && !c._drag);
  const M = row ? 'w' : 'h', C = row ? 'h' : 'w', MP = row ? 'x' : 'y', CP = row ? 'y' : 'x';
  const ps = row ? pl : pt, pe = row ? pr : pb, cs = row ? pt : pl, ce = row ? pb : pr;
  // если размер по оси задаёт родительская раскладка (заполнить/растянуть) — «по содержимому» не действует
  const P = doc.nodes[f.parent];
  let ctlW = false, ctlH = false;
  if (P && P.layout && !f.abs) { const rp = P.layout.dir !== 'col'; ctlW = rp ? !!f.grow : !!f.stretch; ctlH = rp ? !!f.stretch : !!f.grow; }
  const hugW = L.hugW && !ctlW, hugH = L.hugH && !ctlH;
  const hugM = row ? hugW : hugH, hugC = row ? hugH : hugW;
  const n = kids.length, gap = L.gap || 0, gaps = gap * Math.max(0, n - 1);
  if (hugM) f[M] = Math.max(1, kids.reduce((s, c) => s + c[M], 0) + gaps + ps + pe);
  if (hugC) f[C] = Math.max(1, kids.reduce((s, c) => c.stretch ? s : Math.max(s, c[C]), 0) + cs + ce);
  const inM = f[M] - ps - pe, inC = f[C] - cs - ce;
  const growers = hugM ? [] : kids.filter(c => c.grow);
  const fixed = kids.reduce((s, c) => growers.includes(c) ? s : s + c[M], 0);
  const gsize = growers.length ? Math.max(1, (inM - fixed - gaps) / growers.length) : 0;
  for (const c of kids) {
    c.rot = 0;
    const nm = growers.includes(c) ? gsize : c[M], nc = c.stretch ? Math.max(1, inC) : c[C];
    if (nm !== c[M] || nc !== c[C]) {
      const nw = row ? nm : nc, nh = row ? nc : nm;
      if (c.type === 'text' && c.auto === 'width' && nw !== c.w) c.auto = 'height';
      resizeNode(doc, c, nw, nh);
      if (c.type === 'text') autosizeText(c);
      if (c.layout) applyLayout(doc, c);
    }
  }
  const total = kids.reduce((s, c) => s + c[M], 0);
  let pos = ps, g = gap;
  const rem = inM - total - gaps;
  if (L.main === 'between' && n > 1) g = (inM - total) / (n - 1);
  else if (L.main === 'center') pos += rem / 2;
  else if (L.main === 'end') pos += rem;
  for (const c of kids) {
    c[MP] = pos; pos += c[M] + g;
    const cr = inC - c[C];
    c[CP] = cs + (L.cross === 'center' ? cr / 2 : L.cross === 'end' ? cr : 0);
  }
}
// Порядок вставки в раскладку по точке (в координатах рамки).
export function layoutIndex(doc, f, lx, ly, skip) {
  const row = f.layout.dir !== 'col';
  const kids = f.children.filter(id => id !== skip);
  for (let i = 0; i < kids.length; i++) {
    const c = doc.nodes[kids[i]];
    if (!c || c.abs || !c.visible) continue;
    if ((row ? lx < c.x + c.w / 2 : ly < c.y + c.h / 2)) return i;
  }
  return kids.length;
}

/* ---------- нормализация ---------- */
function fitGroup(doc, g) {
  let b = null;
  for (const id of g.children) {
    const c = doc.nodes[id]; if (!c) continue;
    const bb = aabb(corners(localM(c), c.w, c.h));
    b = b ? { x: Math.min(b.x, bb.x), y: Math.min(b.y, bb.y), x1: Math.max(b.x1, bb.x + bb.w), y1: Math.max(b.y1, bb.y + bb.h) } : { x: bb.x, y: bb.y, x1: bb.x + bb.w, y1: bb.y + bb.h };
  }
  if (!b) return;
  if (Math.abs(b.x) > 1e-6 || Math.abs(b.y) > 1e-6) {
    for (const id of g.children) { const c = doc.nodes[id]; if (c) { c.x -= b.x; c.y -= b.y; } }
    g.x += b.x; g.y += b.y;
  }
  g.w = Math.max(0.01, b.x1 - b.x); g.h = Math.max(0.01, b.y1 - b.y);
}
function upd(doc, n) {
  if (n.children) {
    for (const id of [...n.children]) {
      const c = doc.nodes[id];
      if (!c) { n.children.splice(n.children.indexOf(id), 1); continue; }
      upd(doc, c);
    }
  }
  if (n.type === 'text') autosizeText(n);
  else if (n.type === 'group' || n.type === 'bool') {
    if (!n.children.length) { remove(doc, n.id); return; }
    n.rot = 0; fitGroup(doc, n);
  } else if (n.layout) applyLayout(doc, n);
}
export function normalize(doc) {
  syncInstances(doc);
  for (const pid of doc.nodes.root.children) upd(doc, doc.nodes[pid]);
}

/* ---------- переменные (цвета с режимами) ---------- */
export function varColor(doc, varId, mode) {
  const v = doc.vars.find(v => v.id === varId);
  if (!v) return null;
  return v.values[mode] ?? v.values[0];
}

/* ---------- история ---------- */
const ser = doc => JSON.stringify(doc, (k, v) => (k === 'images' || k === '_drag') ? undefined : v);
export function loadInto(doc, src) {
  const o = typeof src === 'string' ? JSON.parse(src) : src;
  const imgs = o.images || doc.images || {};
  for (const k of Object.keys(doc)) delete doc[k];
  Object.assign(doc, o, { images: imgs });
}
export class History {
  constructor(doc) { this.doc = doc; this.u = []; this.r = []; this.last = ser(doc); }
  commit() {
    const s = ser(this.doc);
    if (s === this.last) return false;
    this.u.push(this.last); if (this.u.length > 150) this.u.shift();
    this.last = s; this.r = [];
    return true;
  }
  undo() { if (!this.u.length) return false; this.r.push(this.last); this.last = this.u.pop(); loadInto(this.doc, { ...JSON.parse(this.last), images: this.doc.images }); return true; }
  redo() { if (!this.r.length) return false; this.u.push(this.last); this.last = this.r.pop(); loadInto(this.doc, { ...JSON.parse(this.last), images: this.doc.images }); return true; }
  reset() { this.u = []; this.r = []; this.last = ser(this.doc); }
  rebase() { this.last = ser(this.doc); }
}

/* ---------- разница для совместной работы ---------- */
export function nodeMap(doc) {
  const m = {};
  for (const id in doc.nodes) if (!isClone(id)) m[id] = JSON.stringify(doc.nodes[id], (k, v) => k === '_drag' ? undefined : v);
  return m;
}
export function diff(prev, doc) {
  const cur = nodeMap(doc), set = {}, del = [];
  for (const id in cur) if (prev[id] !== cur[id]) set[id] = JSON.parse(cur[id]);
  for (const id in prev) if (!(id in cur)) del.push(id);
  return { set, del, map: cur };
}
export function applyOps(doc, ops) {
  for (const id of ops.del || []) delete doc.nodes[id];
  for (const id in ops.set || {}) doc.nodes[id] = ops.set[id];
  for (const id in doc.nodes) { // детей без узлов отбросит normalize; осиротевшие узлы удаляем
    const n = doc.nodes[id];
    if (id !== 'root' && !isClone(id) && !doc.nodes[n.parent]) delete doc.nodes[id];
  }
  // узел мог сменить родителя: убрать его из чужих списков
  for (const id in doc.nodes) {
    const n = doc.nodes[id];
    if (n.children) n.children = n.children.filter((c, i, a) => a.indexOf(c) === i && (!doc.nodes[c] || doc.nodes[c].parent === id || isClone(c)));
  }
  if (ops.meta) Object.assign(doc, ops.meta);
  if (ops.imgs) Object.assign(doc.images, ops.imgs);
}
export const metaOf = doc => ({ name: doc.name, vars: doc.vars, modes: doc.modes, mode: doc.mode });
