// Состояние редактора и операции над документом (группировка, компоненты, выравнивание…).
import * as M from './model.js';
import { inv, ap, apv, mul, aabb, corners, localM } from './geom.js';

export const A = {
  doc: null, page: null, sel: [], tool: 'select', zoom: 1, px: 0, py: 0, hist: null,
  rightTab: 'design', leftTab: 'layers', expanded: new Set(), clip: null, editPath: null, editText: null,
  _ev: {},
  on(e, f) { (this._ev[e] ||= []).push(f); },
  emit(e, a) { for (const f of this._ev[e] || []) f(a); },
};
export const N = id => A.doc.nodes[id];
export const selNodes = () => A.sel.map(N).filter(Boolean);

let raf = 0;
export function redraw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; A.emit('draw'); }); }

// Живое изменение (во время перетаскивания): без записи в историю.
export function live() { M.normalize(A.doc); redraw(); A.emit('live'); }
// Завершённое изменение: в историю, автосохранение, сеть.
export function commit() {
  for (const id in A.doc.nodes) delete A.doc.nodes[id]._drag;
  M.normalize(A.doc);
  A.sel = A.sel.filter(id => A.doc.nodes[id]);
  if (A.hist.commit()) A.emit('commit');
  redraw(); A.emit('change');
}
export function setDoc(doc) {
  A.doc = doc; M.normalize(doc);
  A.hist = new M.History(doc);
  A.page = doc.nodes.root.children[0];
  A.sel = []; A.editPath = null;
  A.emit('doc'); A.emit('change'); redraw();
}
export function select(ids, add) {
  ids = ids.filter(id => A.doc.nodes[id]);
  if (add) { const s = new Set(A.sel); for (const id of ids) s.has(id) ? s.delete(id) : s.add(id); A.sel = [...s]; }
  else A.sel = ids;
  for (const id of A.sel) for (const a of M.ancestors(A.doc, id)) A.expanded.add(a.id);
  if (A.editPath && !A.sel.includes(A.editPath)) A.editPath = null;
  A.emit('select'); A.emit('change'); redraw();
}
export function setPage(id) { A.page = id; A.sel = []; A.editPath = null; A.emit('page'); A.emit('change'); redraw(); }
export function undo() { if (A.hist.undo()) after(); }
export function redo() { if (A.hist.redo()) after(); }
function after() {
  M.normalize(A.doc);
  if (!A.doc.nodes[A.page]) A.page = A.doc.nodes.root.children[0];
  A.sel = A.sel.filter(id => A.doc.nodes[id]);
  A.emit('commit'); A.emit('change'); redraw();
}

/* ---------- вид ---------- */
export const toWorld = (sx, sy) => ({ x: (sx - A.px) / A.zoom, y: (sy - A.py) / A.zoom });
export const toScreen = (wx, wy) => ({ x: wx * A.zoom + A.px, y: wy * A.zoom + A.py });
export function viewSize() { const c = document.getElementById('cv'); return { w: c.clientWidth, h: c.clientHeight }; }
export function zoomAt(z, sx, sy) {
  z = Math.max(0.02, Math.min(256, z));
  const w = toWorld(sx, sy);
  A.zoom = z; A.px = sx - w.x * z; A.py = sy - w.y * z;
  A.emit('zoom'); redraw();
}
export function zoomToBox(b, maxZ = 1) {
  if (!b) return;
  const v = viewSize(), pad = 60;
  const z = Math.min((v.w - pad * 2) / Math.max(b.w, 1), (v.h - pad * 2) / Math.max(b.h, 1), maxZ);
  A.zoom = Math.max(0.02, z);
  A.px = v.w / 2 - (b.x + b.w / 2) * A.zoom; A.py = v.h / 2 - (b.y + b.h / 2) * A.zoom;
  A.emit('zoom'); redraw();
}
export function boxOf(ids) {
  let b = null;
  for (const id of ids) {
    if (!A.doc.nodes[id]) continue;
    const w = M.worldBox(A.doc, id);
    b = b ? { x: Math.min(b.x, w.x), y: Math.min(b.y, w.y), x1: Math.max(b.x1, w.x + w.w), y1: Math.max(b.y1, w.y + w.h) } : { x: w.x, y: w.y, x1: w.x + w.w, y1: w.y + w.h };
  }
  return b && { x: b.x, y: b.y, w: b.x1 - b.x, h: b.y1 - b.y };
}
export const zoomFit = () => zoomToBox(boxOf(N(A.page).children), 1);
export const zoomSel = () => zoomToBox(boxOf(A.sel), 8);
export function viewCenter() { const v = viewSize(); return toWorld(v.w / 2, v.h / 2); }

/* ---------- утилиты ---------- */
export function moveWorld(id, dx, dy) { // сдвиг узла на вектор в мировых координатах
  const n = N(id), pm = M.worldM(A.doc, n.parent), d = apv(inv(pm), dx, dy);
  M.setProp(A.doc, n, 'x', n.x + d.x); M.setProp(A.doc, n, 'y', n.y + d.y);
}
export const canHaveKids = n => n && ['page', 'frame', 'component', 'group', 'bool'].includes(n.type) && !M.isClone(n.id);
export const inInstance = id => M.isClone(id);
// Самый глубокий фрейм под точкой (куда класть новые/перетаскиваемые слои).
export function frameAt(wx, wy, exclude = []) {
  const doc = A.doc, ex = new Set(exclude);
  let best = A.page;
  const rec = (pid) => {
    const p = doc.nodes[pid];
    for (let i = p.children.length - 1; i >= 0; i--) {
      const c = doc.nodes[p.children[i]];
      if (!c || !c.visible || ex.has(c.id) || c.locked) continue;
      if (!['frame', 'component', 'group'].includes(c.type) || M.isClone(c.id)) continue;
      const l = ap(inv(M.worldM(doc, c.id)), wx, wy);
      if (l.x >= 0 && l.y >= 0 && l.x <= c.w && l.y <= c.h) {
        if (c.type !== 'group') best = c.id;
        rec(c.id); return true;
      }
    }
    return false;
  };
  rec(A.page);
  return best;
}
let nameCount = {};
export function nextName(base) { nameCount[base] = (nameCount[base] || 0) + 1; return `${base} ${nameCount[base]}`; }

/* ---------- операции ---------- */
export function deleteSel() {
  const ids = M.topLevel(A.doc, A.sel).filter(id => !M.isClone(id));
  if (!ids.length) return;
  for (const id of ids) M.remove(A.doc, id);
  A.sel = []; commit(); A.emit('select');
}
export function duplicateSel(offset = true) {
  const ids = M.treeOrder(A.doc, M.topLevel(A.doc, A.sel)).filter(id => !M.isClone(id));
  if (!ids.length) return [];
  const out = [];
  for (const id of ids) {
    const n = N(id), p = N(n.parent), idx = p.children.indexOf(id) + 1;
    const nodes = M.cloneTree(A.doc, id);
    if (nodes[0].type === 'component') { nodes[0].type = 'frame'; } // копия главного компонента — обычный фрейм
    M.insertTree(A.doc, nodes, n.parent, idx);
    if (offset && !p.layout) { nodes[0].x += 10; nodes[0].y += 10; }
    out.push(nodes[0].id);
  }
  A.sel = out; commit(); A.emit('select');
  return out;
}
function wrap(type, props = {}) {
  const doc = A.doc;
  const ids = M.treeOrder(doc, M.topLevel(doc, A.sel)).filter(id => !M.isClone(id));
  if (!ids.length) return null;
  const parent = N(ids[ids.length - 1]).parent;
  const pnode = N(parent);
  const idx = Math.max(...ids.filter(id => N(id).parent === parent).map(id => pnode.children.indexOf(id)));
  const pm = M.worldM(doc, parent), ipm = inv(pm);
  let b = null;
  for (const id of ids) {
    const n = N(id);
    const pts = corners(M.worldM(doc, id), n.w, n.h).map(p => ap(ipm, p.x, p.y));
    const bb = aabb(pts);
    b = b ? { x: Math.min(b.x, bb.x), y: Math.min(b.y, bb.y), x1: Math.max(b.x1, bb.x + bb.w), y1: Math.max(b.y1, bb.y + bb.h) } : { x: bb.x, y: bb.y, x1: bb.x + bb.w, y1: bb.y + bb.h };
  }
  const g = M.mk(type, { x: b.x, y: b.y, w: b.x1 - b.x, h: b.y1 - b.y, ...props });
  M.insert(doc, g, parent, idx + 1);
  for (const id of ids) M.reparent(doc, id, g.id);
  return g;
}
export function groupSel() { const g = wrap('group', { name: nextName('Группа') }); if (g) { A.sel = [g.id]; commit(); A.emit('select'); } }
export function frameSel() { const g = wrap('frame', { name: nextName('Фрейм'), fills: [], clip: false }); if (g) { A.sel = [g.id]; commit(); A.emit('select'); } return g; }
export function boolSel(op) {
  const ids = M.treeOrder(A.doc, M.topLevel(A.doc, A.sel));
  if (ids.length < 2) { toast('Выделите минимум два слоя'); return; }
  const first = N(ids[0]);
  const names = { union: 'Объединение', subtract: 'Вычитание', intersect: 'Пересечение', exclude: 'Исключение' };
  const g = wrap('bool', { op, name: names[op], fills: structuredClone(first.fills.length ? first.fills : [M.solid('#999999')]) });
  if (g) { A.sel = [g.id]; commit(); A.emit('select'); }
}
export function ungroupSel() {
  const doc = A.doc, out = [];
  for (const id of A.sel) {
    const g = N(id);
    if (!g || M.isClone(id) || !['group', 'bool', 'frame'].includes(g.type)) { out.push(id); continue; }
    const p = N(g.parent); let idx = p.children.indexOf(id);
    for (const c of [...g.children]) { M.reparent(doc, c, g.parent, idx++); out.push(c); }
    M.remove(doc, id);
  }
  A.sel = out.filter(id => N(id)); commit(); A.emit('select');
}
export function componentSel() {
  const doc = A.doc;
  if (A.sel.length === 1 && N(A.sel[0]).type === 'frame' && !M.isClone(A.sel[0])) {
    const n = N(A.sel[0]); n.type = 'component';
    if (/^Фрейм/.test(n.name)) n.name = nextName('Компонент');
  } else {
    const g = wrap('component', { name: nextName('Компонент'), fills: [] });
    if (!g) return;
    A.sel = [g.id];
  }
  commit(); A.emit('select'); toast('Компонент создан — экземпляры в «Ресурсах»');
}
export function placeInstance(mainId, at) {
  const doc = A.doc, main = N(mainId);
  const c = at || viewCenter();
  const parent = A.sel.length === 1 && canHaveKids(N(A.sel[0])) && N(A.sel[0]).type !== 'group' && !M.isAncestor(doc, mainId, A.sel[0]) && A.sel[0] !== mainId ? A.sel[0] : A.page;
  const pm = inv(M.worldM(doc, parent)), l = ap(pm, c.x - main.w / 2, c.y - main.h / 2);
  const n = M.makeInstance(doc, mainId, parent, Math.round(l.x), Math.round(l.y));
  A.sel = [n.id]; commit(); A.emit('select');
}
export function detachSel() {
  for (const id of A.sel) M.detachInstance(A.doc, id);
  commit(); A.emit('select');
}
export function resetOverrides() {
  for (const id of A.sel) { const n = N(id); if (n.type === 'instance' && !M.isClone(id)) n.overrides = {}; }
  commit();
}
export function zorder(where) {
  const doc = A.doc;
  for (const id of A.sel) {
    if (M.isClone(id)) continue;
    const n = N(id), ch = N(n.parent).children, i = ch.indexOf(id);
    ch.splice(i, 1);
    const j = where === 'front' ? ch.length : where === 'back' ? 0 : where === 'up' ? Math.min(ch.length, i + 1) : Math.max(0, i - 1);
    ch.splice(j, 0, id);
  }
  commit();
}
export function autoLayoutSel() {
  const doc = A.doc;
  let f = A.sel.length === 1 ? N(A.sel[0]) : null;
  if (!f || !M.FRAMEISH.has(f.type)) {
    if (!A.sel.length) return;
    f = wrap('frame', { name: nextName('Фрейм'), fills: [], clip: false });
    if (!f) return;
    A.sel = [f.id];
  }
  if (f.layout) { M.setProp(doc, f, 'layout', null); commit(); return; }
  const kids = f.children.map(N).filter(Boolean);
  let dir = 'col';
  if (kids.length > 1) {
    const xs = kids.map(k => k.x), ys = kids.map(k => k.y);
    dir = (Math.max(...xs) - Math.min(...xs)) > (Math.max(...ys) - Math.min(...ys)) ? 'row' : 'col';
  }
  const key = dir === 'row' ? 'x' : 'y', size = dir === 'row' ? 'w' : 'h';
  kids.sort((a, b) => a[key] - b[key]);
  f.children = [...kids.map(k => k.id), ...f.children.filter(id => !kids.find(k => k.id === id))];
  let gap = 10;
  if (kids.length > 1) gap = Math.max(0, Math.round(kids.slice(1).reduce((s, k, i) => s + (k[key] - kids[i][key] - kids[i][size]), 0) / (kids.length - 1)));
  const L = M.defaultLayout(dir);
  L.gap = gap;
  if (kids.length) {
    const minx = Math.min(...kids.map(k => k.x)), miny = Math.min(...kids.map(k => k.y));
    L.pad = [Math.max(0, Math.round(miny)), 10, 10, Math.max(0, Math.round(minx))];
    L.pad[1] = L.pad[3]; L.pad[2] = L.pad[0];
  }
  M.setProp(doc, f, 'layout', L);
  commit();
}
export function align(how) {
  const ids = M.topLevel(A.doc, A.sel);
  if (!ids.length) return;
  let ref;
  if (ids.length === 1) { const p = N(N(ids[0]).parent); if (p.type === 'page') return; ref = M.worldBox(A.doc, p.id); }
  else ref = boxOf(ids);
  for (const id of ids) {
    const b = M.worldBox(A.doc, id); let dx = 0, dy = 0;
    if (how === 'left') dx = ref.x - b.x;
    if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2);
    if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
    if (how === 'top') dy = ref.y - b.y;
    if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2);
    if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
    moveWorld(id, dx, dy);
  }
  commit();
}
export function distribute(axis) {
  const ids = M.topLevel(A.doc, A.sel);
  if (ids.length < 3) return;
  const bs = ids.map(id => ({ id, b: M.worldBox(A.doc, id) }));
  const k = axis === 'h' ? 'x' : 'y', s = axis === 'h' ? 'w' : 'h';
  bs.sort((a, b) => a.b[k] - b.b[k]);
  const total = bs.reduce((t, o) => t + o.b[s], 0);
  const span = bs[bs.length - 1].b[k] + bs[bs.length - 1].b[s] - bs[0].b[k];
  const gap = (span - total) / (bs.length - 1);
  let pos = bs[0].b[k];
  for (const o of bs) { const d = pos - o.b[k]; moveWorld(o.id, axis === 'h' ? d : 0, axis === 'h' ? 0 : d); pos += o.b[s] + gap; }
  commit();
}
export function toggleProp(k) {
  if (!A.sel.length) return;
  const v = !N(A.sel[0])[k];
  for (const id of A.sel) M.setProp(A.doc, N(id), k, v);
  commit();
}
export function selectAll() {
  const ids = A.sel.length ? N(N(A.sel[0]).parent).children : N(A.page).children;
  select([...ids]);
}

/* ---------- буфер обмена ---------- */
export function copySel() {
  const ids = M.treeOrder(A.doc, M.topLevel(A.doc, A.sel));
  if (!ids.length) return null;
  const items = [], imgs = {};
  for (const id of ids) {
    const nodes = M.cloneTree(A.doc, id, s => s.id.replace(/:/g, '_') + '_' + M.uid());
    const wm = M.worldM(A.doc, id);
    nodes[0]._wm = wm;
    for (const n of nodes) for (const f of [...(n.fills || []), ...(n.strokes || [])]) if (f.img) imgs[f.img] = A.doc.images[f.img];
    items.push({ nodes, parent: N(id).parent });
  }
  const data = { holst: 1, items, imgs, mains: {} };
  A.clip = data;
  return data;
}
export function pasteData(data) {
  if (!data?.items) return;
  const doc = A.doc;
  Object.assign(doc.images, data.imgs || {});
  const target = A.sel.length === 1 && canHaveKids(N(A.sel[0])) && N(A.sel[0]).type !== 'group' && N(A.sel[0]).type !== 'bool' ? A.sel[0] : null;
  const out = [];
  for (const it of data.items) {
    const nodes = structuredClone(it.nodes).map(n => n);
    const map = {};
    for (const n of nodes) { const nid = M.uid(); map[n.id] = nid; }
    for (const n of nodes) { n.id = map[n.id]; if (n.parent) n.parent = map[n.parent]; if (n.children) n.children = n.children.map(c => map[c]).filter(Boolean); }
    const wm = nodes[0]._wm; delete nodes[0]._wm;
    let parent = target || (doc.nodes[it.parent] && M.pageOf(doc, it.parent)?.id === A.page ? it.parent : A.page);
    if (target && wm) { // в выбранный фрейм: та же позиция относительно рамки, если влезает
      const n0 = nodes[0];
      const tb = N(target);
      n0.x = Math.max(0, Math.min(n0.x, tb.w - n0.w)); n0.y = Math.max(0, Math.min(n0.y, tb.h - n0.h));
    } else if (wm) {
      const pm = inv(M.worldM(doc, parent)), lm = mul(pm, wm);
      const n0 = nodes[0], c = lm[0], s = lm[1], cx = n0.w / 2, cy = n0.h / 2;
      n0.x = lm[4] - cx + c * cx - s * cy; n0.y = lm[5] - cy + s * cx + c * cy;
    }
    M.insertTree(doc, nodes, parent);
    out.push(nodes[0].id);
  }
  A.sel = out; commit(); A.emit('select');
}

/* ---------- всплывашки ---------- */
export function toast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('on'), ms);
}
