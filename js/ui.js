// Панели: инструменты, страницы и слои, ресурсы, инспектор (дизайн / прототип / код).
import * as M from './model.js';
import { h, $, fmt, evalNum, menu, closeMenu } from './dom.js';
import { A, N, selNodes, commit, live, redraw, select, setPage, placeInstance, align, distribute, autoLayoutSel, detachSel, resetOverrides, componentSel, zoomSel, zoomFit, zoomAt, viewSize, toast, canHaveKids, boxOf, zoomToBox } from './app.js';
import { hexA } from './render.js';
import * as IO from './io.js';

const MIXED = Symbol('mixed');
export const FONTS = ['Inter', 'Roboto', 'Montserrat', 'PT Sans', 'PT Serif', 'Playfair Display', 'Comfortaa', 'JetBrains Mono', 'Arial', 'Georgia', 'Times New Roman', 'Courier New'];
const WEIGHTS = [[100, 'Thin'], [200, 'ExtraLight'], [300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'SemiBold'], [700, 'Bold'], [800, 'ExtraBold'], [900, 'Black']];
const BLENDS = [['normal', 'Обычный'], ['multiply', 'Умножение'], ['screen', 'Экран'], ['overlay', 'Перекрытие'], ['darken', 'Затемнение'], ['lighten', 'Осветление'], ['color-dodge', 'Осветление основы'], ['color-burn', 'Затемнение основы'], ['difference', 'Разница'], ['luminosity', 'Яркость']];
const ICON = { page: '▤', frame: '#', component: '❖', instance: '◇', group: '▣', bool: '◑', rect: '▭', ellipse: '◯', line: '╱', path: '✎', text: 'T' };

/* ================= панель инструментов ================= */
const TOOLS = [
  ['select', '➤', 'Выделение (V)'], ['frame', '#', 'Фрейм (F)'], ['rect', '▭', 'Прямоугольник (R)'], ['ellipse', '◯', 'Эллипс (O)'],
  ['line', '╱', 'Линия (L)'], ['pen', '✒', 'Перо (P)'], ['text', 'T', 'Текст (T)'], ['image', '🖼', 'Картинка (Shift+Cmd+K)'], ['hand', '✋', 'Рука (H, пробел)'],
];
export function setTool(t) {
  if (t === 'image') { IO.insertImageDialog(); return; }
  if (A.pen && t !== 'pen') A.emit('finishPen');
  A.tool = t; A.editPath = null; A.emit('tool'); redraw();
}
export function buildToolbar() {
  const tb = $('#toolbar');
  tb.innerHTML = '';
  const left = h('div', { class: 'tb-left' },
    h('button', { class: 'tbtn logo', title: 'Меню', onclick: e => mainMenu(e.currentTarget) }, h('span', { class: 'logo-mark' }, 'Х'), '▾'),
    ...TOOLS.map(([id, ic, tip]) => h('button', { class: 'tbtn tool', 'data-tool': id, title: tip, onclick: () => setTool(id) }, ic)));
  const name = h('input', { class: 'docname', value: A.doc?.name || '', title: 'Название файла', onchange: e => { A.doc.name = e.target.value || 'Без названия'; commit(); A.emit('docname'); }, onkeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  const right = h('div', { class: 'tb-right' },
    h('div', { id: 'peers' }),
    h('button', { class: 'tbtn share', title: 'Совместная работа', onclick: () => A.emit('collab') }, 'Совместно'),
    h('button', { class: 'tbtn play', title: 'Показать прототип (Alt+Cmd+Enter)', onclick: () => A.emit('present') }, '▶'),
    h('button', { class: 'tbtn zoom', id: 'zoomBtn', onclick: e => zoomMenu(e.currentTarget) }, '100%'));
  tb.append(left, h('div', { class: 'tb-mid' }, name), right);
  const upd = () => { for (const b of tb.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === A.tool); };
  A.on('tool', upd); upd();
  A.on('zoom', () => { $('#zoomBtn').textContent = Math.round(A.zoom * 100) + '%'; });
  A.on('doc', () => { name.value = A.doc.name; });
  A.on('docname', () => { if (document.activeElement !== name) name.value = A.doc.name; });
}
function zoomMenu(el) {
  const r = el.getBoundingClientRect(), v = viewSize();
  menu(r.left - 120, r.bottom + 4, [
    { label: 'Приблизить', key: '+', do: () => zoomAt(A.zoom * 2, v.w / 2, v.h / 2) },
    { label: 'Отдалить', key: '−', do: () => zoomAt(A.zoom / 2, v.w / 2, v.h / 2) },
    { label: 'Показать всё', key: '⇧1', do: zoomFit },
    { label: 'К выделению', key: '⇧2', do: zoomSel, disabled: !A.sel.length },
    { label: '50%', do: () => zoomAt(0.5, v.w / 2, v.h / 2) },
    { label: '100%', key: '⌘0', do: () => zoomAt(1, v.w / 2, v.h / 2) },
    { label: '200%', do: () => zoomAt(2, v.w / 2, v.h / 2) },
  ]);
}
function mainMenu(el) {
  const r = el.getBoundingClientRect();
  menu(r.left, r.bottom + 4, [
    { label: 'Мои файлы…', do: () => A.emit('files') },
    { label: 'Новый файл', key: '⌥N', do: () => A.emit('newfile') },
    '-',
    { label: 'Открыть файл .holst…', key: '⌘O', do: IO.openFileDialog },
    { label: 'Сохранить в файл .holst', key: '⌘S', do: IO.saveFile },
    '-',
    { label: 'Вставить картинку…', key: '⇧⌘K', do: IO.insertImageDialog },
    { label: 'Импорт SVG…', do: IO.importSVGDialog },
    '-',
    { label: 'Экспорт выделения', sub: [
      { label: 'PNG 1×', do: () => IO.exportSel('png', 1) }, { label: 'PNG 2×', do: () => IO.exportSel('png', 2) },
      { label: 'JPG 2×', do: () => IO.exportSel('jpg', 2) }, { label: 'SVG', do: () => IO.exportSel('svg', 1) },
      { label: 'HTML + CSS', do: () => IO.exportHTML() },
    ], disabled: !A.sel.length },
    '-',
    { label: 'Отменить', key: '⌘Z', do: () => A.emit('undo') },
    { label: 'Повторить', key: '⇧⌘Z', do: () => A.emit('redo') },
    '-',
    { label: 'Горячие клавиши', key: '?', do: () => A.emit('help') },
    { label: 'Загрузить демо-файл', do: () => A.emit('demo') },
  ]);
}

/* ================= левая панель ================= */
let leftDragging = false;
export function buildLeft() {
  const el = $('#left');
  const render = () => {
    if (leftDragging || !A.doc) return;
    const sc = el.querySelector('.scroll')?.scrollTop || 0;
    el.innerHTML = '';
    const tabs = h('div', { class: 'tabs' },
      h('button', { class: A.leftTab === 'layers' ? 'on' : '', onclick: () => { A.leftTab = 'layers'; render(); } }, 'Слои'),
      h('button', { class: A.leftTab === 'assets' ? 'on' : '', onclick: () => { A.leftTab = 'assets'; render(); } }, 'Ресурсы'));
    el.append(tabs);
    const body = h('div', { class: 'scroll' });
    if (A.leftTab === 'layers') body.append(pagesBlock(), layersBlock());
    else body.append(componentsBlock(), varsBlock());
    el.append(body);
    body.scrollTop = sc;
  };
  let q = 0;
  const later = () => { if (!q) q = requestAnimationFrame(() => { q = 0; render(); }); };
  A.on('change', later); A.on('page', later); A.on('doc', later);
  render();
}
function pagesBlock() {
  const doc = A.doc;
  const box = h('div', { class: 'sect pages' },
    h('div', { class: 'sect-head' }, h('span', null, 'Страницы'),
      h('button', { class: 'ibtn', title: 'Добавить страницу', onclick: () => { const p = M.addPage(doc, 'Страница ' + (doc.nodes.root.children.length + 1)); commit(); setPage(p.id); } }, '+')));
  for (const pid of doc.nodes.root.children) {
    const p = N(pid);
    const row = h('div', { class: 'page-row' + (pid === A.page ? ' on' : ''), onclick: () => setPage(pid),
      oncontextmenu: e => { e.preventDefault(); menu(e.clientX, e.clientY, [
        { label: 'Переименовать', do: () => rename(row.querySelector('.nm'), p) },
        { label: 'Дублировать', do: () => { const nodes = M.cloneTree(doc, pid); nodes[0].name += ' (копия)'; M.insertTree(doc, nodes, 'root'); commit(); } },
        { label: 'Удалить', disabled: doc.nodes.root.children.length < 2, do: () => { if (confirm(`Удалить страницу «${p.name}»?`)) { M.remove(doc, pid); if (A.page === pid) A.page = doc.nodes.root.children[0]; commit(); setPage(A.page); } } },
      ]); } },
      h('span', { class: 'nm', ondblclick: e => rename(e.target, p) }, p.name));
    box.append(row);
  }
  return box;
}
function rename(span, n) {
  const inp = h('input', { class: 'rename', value: n.name });
  span.replaceWith(inp); inp.focus(); inp.select();
  leftDragging = true;
  const done = ok => { leftDragging = false; if (ok && inp.value.trim()) { M.setProp(A.doc, n, 'name', inp.value.trim()); if (n.type === 'text') n.autoName = false; } commit(); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = ''; inp.blur(); } };
  inp.onblur = () => done(true);
}
let dragIds = null;
function layersBlock() {
  const doc = A.doc, page = N(A.page);
  const box = h('div', { class: 'sect layers' }, h('div', { class: 'sect-head' }, h('span', null, 'Слои')));
  const sel = new Set(A.sel);
  const rec = (id, depth) => {
    const n = N(id); if (!n) return;
    const kids = n.children && n.children.length;
    const open = A.expanded.has(id);
    const clone = M.isClone(id);
    const row = h('div', {
      class: 'layer' + (sel.has(id) ? ' on' : '') + (clone || n.type === 'component' || n.type === 'instance' ? ' comp' : '') + (n.visible ? '' : ' hidden') + (ancSel(id, sel) ? ' insel' : ''),
      style: `padding-left:${6 + depth * 14}px`, draggable: !clone, 'data-id': id,
      onclick: e => { if (e.target.closest('.lbtn,.caret,input')) return; select([id], e.shiftKey || e.metaKey || e.ctrlKey); },
      onmouseenter: () => { A.hoverLayer = id; redraw(); }, onmouseleave: () => { A.hoverLayer = null; redraw(); },
      oncontextmenu: e => { e.preventDefault(); if (!A.sel.includes(id)) select([id]); A.emit('contextmenu', { x: e.clientX, y: e.clientY }); },
      ondragstart: e => { dragIds = A.sel.includes(id) ? M.topLevel(doc, A.sel).filter(i => !M.isClone(i)) : [id]; e.dataTransfer.setData('text/plain', 'layers'); e.dataTransfer.effectAllowed = 'move'; leftDragging = true; },
      ondragend: () => { leftDragging = false; dragIds = null; clearDrop(box); A.emit('change'); },
      ondragover: e => { if (!dragIds) return; e.preventDefault(); const z = zone(e, row, n); clearDrop(box); row.classList.add('drop-' + z); },
      ondragleave: () => row.classList.remove('drop-before', 'drop-after', 'drop-into'),
      ondrop: e => { e.preventDefault(); if (!dragIds) return; const z = zone(e, row, n); leftDragging = false; dropLayers(dragIds, id, z); dragIds = null; },
    },
      h('span', { class: 'caret', onclick: () => { open ? A.expanded.delete(id) : A.expanded.add(id); A.emit('change'); } }, kids ? (open ? '▾' : '▸') : ''),
      h('span', { class: 'ico t-' + n.type }, ICON[n.type] || '?'),
      h('span', { class: 'nm', ondblclick: e => { if (!clone) rename(e.target, n); } }, n.name || M.TYPE_RU[n.type]),
      h('span', { class: 'lbtn' + (n.locked ? ' act' : ''), title: 'Заблокировать', onclick: () => { M.setProp(doc, n, 'locked', !n.locked); commit(); } }, n.locked ? '🔒' : '🔓'),
      h('span', { class: 'lbtn' + (!n.visible ? ' act' : ''), title: 'Показать/скрыть', onclick: () => { M.setProp(doc, n, 'visible', !n.visible); commit(); } }, n.visible ? '👁' : '—'));
    box.append(row);
    if (kids && open) for (let i = n.children.length - 1; i >= 0; i--) rec(n.children[i], depth + 1);
  };
  for (let i = page.children.length - 1; i >= 0; i--) rec(page.children[i], 0);
  if (!page.children.length) box.append(h('div', { class: 'empty' }, 'Пусто. Нажмите F и протяните на холсте, чтобы создать фрейм.'));
  return box;
}
const ancSel = (id, sel) => M.ancestors(A.doc, id).some(a => sel.has(a.id));
function clearDrop(box) { box.querySelectorAll('.drop-before,.drop-after,.drop-into').forEach(r => r.classList.remove('drop-before', 'drop-after', 'drop-into')); }
function zone(e, row, n) {
  const r = row.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
  const into = canHaveKids(n) && n.type !== 'page';
  if (into && y > 0.28 && y < 0.72) return 'into';
  return y < 0.5 ? 'before' : 'after';
}
function dropLayers(ids, targetId, z) {
  const doc = A.doc, T = N(targetId);
  if (ids.includes(targetId) || ids.some(id => M.isAncestor(doc, id, targetId))) return;
  let parent, idx;
  if (z === 'into') { parent = targetId; idx = T.children.length; A.expanded.add(targetId); }
  else { parent = T.parent; if (M.isClone(parent) || N(parent).type === 'instance') return; idx = N(parent).children.indexOf(targetId) + (z === 'before' ? 1 : 0); }
  // список сверху вниз = индексы по убыванию; сохраняем видимый порядок
  for (const id of M.treeOrder(doc, ids)) {
    const n = N(id);
    if (n.parent === parent && N(parent).children.indexOf(id) < idx) idx--;
    M.reparent(doc, id, parent, idx);
    idx++;
  }
  commit();
}
function componentsBlock() {
  const doc = A.doc;
  const box = h('div', { class: 'sect' }, h('div', { class: 'sect-head' }, h('span', null, 'Компоненты')));
  let any = false;
  for (const pid of doc.nodes.root.children) {
    const comps = [];
    M.walk(doc, pid, n => { if (n.type === 'component' && !M.isClone(n.id)) comps.push(n); });
    if (!comps.length) continue;
    any = true;
    box.append(h('div', { class: 'asset-page' }, N(pid).name));
    for (const c of comps) box.append(h('div', {
      class: 'asset', draggable: true, title: 'Щелчок — вставить экземпляр, можно перетащить на холст',
      onclick: () => placeInstance(c.id),
      ondragstart: e => { e.dataTransfer.setData('holst/comp', c.id); },
    }, h('span', { class: 'ico t-component' }, '❖'), h('span', { class: 'nm' }, c.name),
      h('button', { class: 'ibtn', title: 'Перейти к главному компоненту', onclick: e => { e.stopPropagation(); goTo(c.id); } }, '→')));
  }
  if (!any) box.append(h('div', { class: 'empty' }, 'Компонентов пока нет. Выделите слои и нажмите ⌥⌘K.'));
  return box;
}
export function goTo(id) {
  const p = M.pageOf(A.doc, id); if (!p) return;
  if (p.id !== A.page) setPage(p.id);
  select([id]); zoomSel();
}
function varsBlock() {
  const doc = A.doc;
  const box = h('div', { class: 'sect vars' },
    h('div', { class: 'sect-head' }, h('span', null, 'Цветовые переменные'),
      h('button', { class: 'ibtn', title: 'Добавить переменную', onclick: () => { doc.vars.push({ id: M.uid(), name: 'Цвет ' + (doc.vars.length + 1), values: doc.modes.map(() => '#5b5bf6') }); commit(); } }, '+')));
  const modes = h('div', { class: 'var-modes' }, h('span', { class: 'muted' }, 'Режим:'),
    ...doc.modes.map((m, i) => h('button', { class: 'chip' + (doc.mode === i ? ' on' : ''), onclick: () => { doc.mode = i; commit(); } }, m)));
  box.append(modes);
  const grid = h('div', { class: 'var-grid', style: `grid-template-columns: 1fr ${doc.modes.map(() => '34px').join(' ')} 20px` },
    h('span', { class: 'muted' }, 'Имя'), ...doc.modes.map(m => h('span', { class: 'muted c' }, m.slice(0, 4))), h('span'));
  for (const v of doc.vars) {
    grid.append(h('input', { class: 'vname', value: v.name, onchange: e => { v.name = e.target.value; commit(); } }));
    v.values.length = doc.modes.length;
    doc.modes.forEach((m, i) => grid.append(h('input', { type: 'color', class: 'vcol', value: v.values[i] || '#000000', oninput: e => { v.values[i] = e.target.value; redraw(); }, onchange: e => { v.values[i] = e.target.value; commit(); } })));
    grid.append(h('button', { class: 'ibtn', title: 'Удалить', onclick: () => { doc.vars.splice(doc.vars.indexOf(v), 1); M.walk(doc, 'root', n => { for (const p of [...(n.fills || []), ...(n.strokes || [])]) if (p.var === v.id) { p.color = v.values[doc.mode]; delete p.var; } }); commit(); } }, '−'));
  }
  box.append(grid);
  if (!doc.vars.length) box.append(h('div', { class: 'empty' }, 'Переменная — именованный цвет со значением для светлой и тёмной темы. Привяжите её к заливке кнопкой ◈.'));
  return box;
}

/* ================= правая панель ================= */
export function buildRight() {
  const el = $('#right');
  let q = 0;
  const render = () => {
    q = 0;
    if (!A.doc) return;
    const act = document.activeElement;
    const key = act && el.contains(act) ? act.dataset.k : null;
    if (act && el.contains(act) && act.tagName === 'INPUT' && act.type !== 'color' && !key) return;
    const sc = el.querySelector('.scroll')?.scrollTop || 0;
    el.innerHTML = '';
    el.append(h('div', { class: 'tabs' },
      ...[['design', 'Дизайн'], ['proto', 'Прототип'], ['code', 'Код']].map(([id, t]) => h('button', { class: A.rightTab === id ? 'on' : '', onclick: () => { A.rightTab = id; render(); redraw(); } }, t))));
    const body = h('div', { class: 'scroll' });
    try {
      if (A.rightTab === 'design') body.append(...designPanel());
      else if (A.rightTab === 'proto') body.append(...protoPanel());
      else body.append(...codePanel());
    } catch (err) { console.error(err); body.append(h('div', { class: 'empty' }, 'Ошибка панели: ' + err.message)); }
    el.append(body);
    body.scrollTop = sc;
    if (key) { const f = el.querySelector(`[data-k="${key}"]`); if (f) { f.focus(); if (f.select && act.tagName === 'INPUT' && act.type === 'text') f.select(); } }
  };
  const later = () => { if (!q) q = requestAnimationFrame(render); };
  A.on('change', later); A.on('live', later); A.on('select', later);
  render();
}

/* ---------- поля ---------- */
const doc = () => A.doc;
function valOf(ns, get) { const vs = ns.map(get); return vs.every(v => v === vs[0] || (typeof v === 'number' && Math.abs(v - vs[0]) < 1e-6)) ? vs[0] : MIXED; }
// Числовое поле: подпись тянется мышью (scrub), ввод принимает выражения «100+20», «*2».
function num(label, k, get, set, o = {}) {
  const ns = selNodes();
  const v = valOf(ns, get);
  const shown = v === MIXED ? '' : o.show ? o.show(v) : fmt(v);
  const inp = h('input', { class: 'num-in', 'data-k': k, value: shown, placeholder: v === MIXED ? 'Смешано' : '', type: 'text', spellcheck: 'false' });
  const apply = (fn, final) => { for (const n of selNodes()) set(n, fn(get(n))); final ? commit() : live(); };
  const fromText = () => {
    const txt = inp.value;
    if (txt === shown) return;
    if (o.parse) { const pv = o.parse(txt); if (pv !== undefined) apply(() => pv, true); return; }
    let ok = false;
    apply(cur => { const r = evalNum(txt, cur); if (r == null) return cur; ok = true; return o.min != null ? Math.max(o.min, o.max != null ? Math.min(o.max, r) : r) : r; }, true);
    if (!ok) inp.value = shown;
  };
  inp.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { fromText(); inp.select(); }
    if (e.key === 'Escape') { inp.value = shown; inp.blur(); }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault(); const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * (o.step || 1);
      apply(cur => clamp((cur || 0) + d, o), true);
    }
  });
  inp.addEventListener('blur', fromText);
  inp.addEventListener('focus', () => setTimeout(() => inp.select(), 0));
  const lab = h('span', { class: 'num-lab', title: o.title || 'Потяните, чтобы изменить' }, label);
  lab.addEventListener('pointerdown', e => {
    e.preventDefault(); lab.setPointerCapture(e.pointerId);
    const x0 = e.clientX, start = new Map(selNodes().map(n => [n.id, get(n)]));
    const mv = ev => { const d = Math.round((ev.clientX - x0) / 2) * (o.step || 1) * (ev.shiftKey ? 10 : 1); for (const n of selNodes()) set(n, clamp((start.get(n.id) || 0) + d, o)); live(); };
    const upf = () => { lab.removeEventListener('pointermove', mv); lab.removeEventListener('pointerup', upf); commit(); };
    lab.addEventListener('pointermove', mv); lab.addEventListener('pointerup', upf);
  });
  return h('label', { class: 'num' + (o.wide ? ' wide' : '') }, lab, inp, o.suffix ? h('span', { class: 'suf' }, o.suffix) : null);
}
const clamp = (v, o) => { if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); return v; };
function sel_(k, value, opts, onchange, attrs = {}) {
  return h('select', { 'data-k': k, onchange: e => onchange(e.target.value), ...attrs }, ...opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
}
const setP = (n, k, v) => M.setProp(doc(), n, k, v);
function section(title, body, extra) {
  return h('div', { class: 'sect' }, h('div', { class: 'sect-head' }, h('span', null, title), extra || null), body);
}
const row = (...k) => h('div', { class: 'row' }, ...k);
const ibtn = (txt, title, fn, on) => h('button', { class: 'ibtn' + (on ? ' on' : ''), title, onclick: fn }, txt);

/* ---------- дизайн ---------- */
function designPanel() {
  const ns = selNodes();
  if (!ns.length) return pagePanel();
  const n = ns[0], one = ns.length === 1, d = doc();
  const out = [];
  const typeName = one ? M.TYPE_RU[n.type] : `Выделено: ${ns.length}`;
  out.push(h('div', { class: 'sel-head' }, h('span', { class: 'ico t-' + n.type }, one ? ICON[n.type] : '⧉'), h('b', null, typeName),
    M.isClone(n.id) ? h('span', { class: 'tag purple' }, 'в экземпляре') : null));
  if (one && n.type === 'instance' && !M.isClone(n.id)) out.push(instanceSection(n));
  if (one && n.type === 'component') out.push(section('Компонент', h('div', null,
    row(h('button', { class: 'btn', onclick: () => { const b = M.worldBox(d, n.id); placeInstance(n.id, { x: b.x + b.w * 1.5 + 40, y: b.y + b.h / 2 }); } }, 'Создать экземпляр')),
    h('textarea', { class: 'desc', placeholder: 'Описание компонента', 'data-k': 'desc', onchange: e => { n.desc = e.target.value; commit(); } }, n.desc || ''))));
  out.push(alignSection(ns));
  out.push(geometrySection(ns));
  const parents = ns.map(x => N(x.parent));
  if (parents.every(p => p?.layout) && ns.every(x => !x.abs)) out.push(childLayoutSection(ns));
  else if (parents.every(p => p && M.FRAMEISH.has(p.type))) out.push(constraintsSection(ns));
  if (ns.some(x => N(x.parent)?.layout)) out.push(row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ns.every(x => x.abs), onchange: e => { ns.forEach(x => setP(x, 'abs', e.target.checked)); commit(); } }), 'Абсолютная позиция (вне авто-раскладки)')));
  if (ns.every(x => M.FRAMEISH.has(x.type))) out.push(autoLayoutSection(ns));
  if (one && n.type === 'bool') out.push(section('Булева операция', row(sel_('op', n.op, [['union', 'Объединение'], ['subtract', 'Вычитание'], ['intersect', 'Пересечение'], ['exclude', 'Исключение']], v => { setP(n, 'op', v); commit(); }))));
  out.push(layerSection(ns));
  if (ns.every(x => x.type === 'text')) out.push(textSection(ns));
  if (ns.every(x => x.type !== 'group' && x.type !== 'line')) out.push(paintsSection(ns, 'fills', 'Заливка'));
  if (ns.every(x => x.type !== 'group' && x.type !== 'bool')) out.push(paintsSection(ns, 'strokes', 'Обводка'));
  if (ns.every(x => x.type !== 'group')) out.push(effectsSection(ns));
  out.push(exportSection());
  return out;
}
function pagePanel() {
  const d = doc(), p = N(A.page);
  return [
    section('Страница', h('div', null,
      row(h('span', { class: 'lbl' }, 'Фон'), h('input', { type: 'color', value: p.bg || '#f0f0f0', oninput: e => { p.bg = e.target.value; redraw(); }, onchange: e => { p.bg = e.target.value; commit(); } }),
        h('input', { class: 'hex', value: (p.bg || '#f0f0f0').replace('#', '').toUpperCase(), onchange: e => { p.bg = '#' + e.target.value.replace('#', ''); commit(); } })))),
    section('Режим переменных', row(...d.modes.map((m, i) => h('button', { class: 'chip' + (d.mode === i ? ' on' : ''), onclick: () => { d.mode = i; commit(); } }, m)))),
    section('Подсказки', h('div', { class: 'help-mini' },
      h('p', null, 'F — фрейм, R — прямоугольник, O — эллипс, T — текст, P — перо.'),
      h('p', null, '⌘G — группа, ⌥⌘G — во фрейм, ⌥⌘K — компонент, ⇧A — авто-раскладка.'),
      h('p', null, 'Двойной щелчок — войти в группу/экземпляр, править текст или точки контура.'),
      h('p', null, 'Alt при выделении — расстояния до соседей. Пробел + мышь — сдвиг холста.'),
      h('button', { class: 'btn ghost', onclick: () => A.emit('help') }, 'Все горячие клавиши'))),
  ];
}
function instanceSection(n) {
  const d = doc(), comps = [];
  M.walk(d, 'root', x => { if (x.type === 'component' && !M.isClone(x.id)) comps.push(x); });
  const ov = Object.keys(n.overrides || {}).length;
  return section('Экземпляр', h('div', null,
    row(h('span', { class: 'lbl' }, 'Компонент'), sel_('main', n.main, [...comps.map(c => [c.id, c.name]), ...(N(n.main) ? [] : [['', '— удалён —']])], v => { if (v) { setP(n, 'main', v); n.overrides = {}; const m = N(v); if (!n.layout) { n.w = m.w; n.h = m.h; } commit(); } })),
    row(h('button', { class: 'btn ghost', onclick: () => goTo(n.main), disabled: !N(n.main) }, 'К главному'),
      h('button', { class: 'btn ghost', onclick: resetOverrides, disabled: !ov, title: 'Переопределений: ' + ov }, 'Сбросить'),
      h('button', { class: 'btn ghost', onclick: detachSel }, 'Отсоединить'))));
}
function alignSection(ns) {
  const can = ns.length > 1 || (ns.length === 1 && N(ns[0].parent)?.type !== 'page');
  return h('div', { class: 'align-bar' + (can ? '' : ' dis') },
    ibtn('⇤', 'По левому краю (⌥A)', () => align('left')), ibtn('↔', 'По центру горизонтально (⌥H)', () => align('hcenter')), ibtn('⇥', 'По правому краю (⌥D)', () => align('right')),
    ibtn('⤒', 'По верху (⌥W)', () => align('top')), ibtn('↕', 'По центру вертикально (⌥V)', () => align('vcenter')), ibtn('⤓', 'По низу (⌥S)', () => align('bottom')),
    ns.length > 2 ? ibtn('⫼', 'Распределить по горизонтали', () => distribute('h')) : null,
    ns.length > 2 ? ibtn('☰', 'Распределить по вертикали', () => distribute('v')) : null);
}
function sizeSet(axis) {
  return (n, v) => {
    v = Math.max(n.type === 'line' && axis === 'h' ? 0 : 0.01, v);
    const d = doc();
    if (n.type === 'text') { if (axis === 'w') setP(n, 'auto', n.auto === 'fixed' ? 'fixed' : 'height'); else setP(n, 'auto', 'fixed'); }
    if (n.layout) setP(n, 'layout', { ...n.layout, [axis === 'w' ? 'hugW' : 'hugH']: false });
    const p = N(n.parent);
    if (p?.layout) { const rowP = p.layout.dir !== 'col'; const key = (axis === 'w') === rowP ? 'grow' : 'stretch'; if (n[key]) setP(n, key, false); }
    M.resizeNode(d, n, axis === 'w' ? v : n.w, axis === 'h' ? v : n.h);
    setP(n, 'w', n.w); setP(n, 'h', n.h);
  };
}
function geometrySection(ns) {
  const n = ns[0];
  const radiusOk = ns.every(x => ['rect', 'frame', 'component', 'instance'].includes(x.type));
  return section('Положение и размер', h('div', null,
    h('div', { class: 'grid2' },
      num('X', 'x', x => x.x, (x, v) => setP(x, 'x', v)),
      num('Y', 'y', x => x.y, (x, v) => setP(x, 'y', v)),
      num('W', 'w', x => x.w, sizeSet('w'), { min: 0.01 }),
      ns.every(x => x.type === 'line') ? h('span') : num('H', 'h', x => x.h, sizeSet('h'), { min: 0.01 }),
      ns.some(x => x.type === 'group' || x.type === 'bool') ? h('span') : num('↻', 'rot', x => -(x.rot || 0), (x, v) => setP(x, 'rot', -(((v % 360) + 540) % 360 - 180)), { suffix: '°', title: 'Поворот' }),
      radiusOk ? num('◜', 'radius', x => x.radius || 0, (x, v) => setP(x, 'radius', Math.max(0, v)), { min: 0, title: 'Скругление углов' }) : h('span')),
    ns.some(x => N(x.parent)?.layout || x.layout || x.type === 'text') ? sizingRow(ns) : null));
}
// Ширина/высота: фикс, по содержимому (hug), заполнить (fill)
function getSizing(n, axis) {
  const p = N(n.parent);
  if (p?.layout && !n.abs) { const rowP = p.layout.dir !== 'col'; if ((axis === 'w') === rowP ? n.grow : n.stretch) return 'fill'; }
  if (n.layout && (axis === 'w' ? n.layout.hugW : n.layout.hugH)) return 'hug';
  if (n.type === 'text') { if (axis === 'w' && n.auto === 'width') return 'hug'; if (axis === 'h' && n.auto !== 'fixed') return 'hug'; }
  return 'fixed';
}
function setSizing(n, axis, v) {
  const p = N(n.parent);
  if (p?.layout) { const rowP = p.layout.dir !== 'col'; const key = (axis === 'w') === rowP ? 'grow' : 'stretch'; setP(n, key, v === 'fill'); }
  if (n.layout) setP(n, 'layout', { ...n.layout, [axis === 'w' ? 'hugW' : 'hugH']: v === 'hug' });
  if (n.type === 'text') {
    if (axis === 'w') setP(n, 'auto', v === 'hug' ? 'width' : (n.auto === 'width' ? 'height' : n.auto));
    else setP(n, 'auto', v === 'hug' ? (n.auto === 'width' ? 'width' : 'height') : 'fixed');
  }
}
function sizingRow(ns) {
  const opts = (axis) => {
    const o = [['fixed', 'Фикс.']];
    if (ns.every(n => n.layout || n.type === 'text')) o.push(['hug', 'По содержимому']);
    if (ns.every(n => N(n.parent)?.layout && !n.abs)) o.push(['fill', 'Заполнить']);
    return o;
  };
  const cur = axis => { const v = valOf(ns, n => getSizing(n, axis)); return v === MIXED ? '' : v; };
  return h('div', { class: 'grid2 sizing' },
    h('label', { class: 'mini' }, 'Ширина', sel_('sw', cur('w'), opts('w'), v => { ns.forEach(n => setSizing(n, 'w', v)); commit(); })),
    h('label', { class: 'mini' }, 'Высота', sel_('sh', cur('h'), opts('h'), v => { ns.forEach(n => setSizing(n, 'h', v)); commit(); })));
}
function constraintsSection(ns) {
  const g = k => { const v = valOf(ns, n => (n.cons || {})[k] || (k === 'h' ? 'left' : 'top')); return v === MIXED ? '' : v; };
  const s = (k, v) => { ns.forEach(n => setP(n, 'cons', { ...(n.cons || {}), [k]: v })); commit(); };
  return section('Ограничения', h('div', { class: 'grid2' },
    h('label', { class: 'mini' }, 'По горизонтали', sel_('ch', g('h'), [['left', 'Слева'], ['right', 'Справа'], ['stretch', 'Слева и справа'], ['center', 'По центру'], ['scale', 'Масштаб']], v => s('h', v))),
    h('label', { class: 'mini' }, 'По вертикали', sel_('cv', g('v'), [['top', 'Сверху'], ['bottom', 'Снизу'], ['stretch', 'Сверху и снизу'], ['center', 'По центру'], ['scale', 'Масштаб']], v => s('v', v)))));
}
function childLayoutSection(ns) {
  return h('div');
}
function autoLayoutSection(ns) {
  const n = ns[0];
  if (!ns.every(x => x.layout)) return section('Авто-раскладка', h('div', { class: 'muted small' }, 'Выстроит слои в ряд или колонку с отступами (⇧A).'), ibtn('+', 'Добавить авто-раскладку', () => { ns.forEach(x => { if (!x.layout) setP(x, 'layout', M.defaultLayout('col')); }); commit(); }));
  const L = n.layout;
  const setL = (k, v) => { ns.forEach(x => setP(x, 'layout', { ...x.layout, [k]: v })); commit(); };
  const padNum = (lab, i, k) => num(lab, k, x => x.layout.pad[i], (x, v) => { const p = [...x.layout.pad]; p[i] = Math.max(0, v); setP(x, 'layout', { ...x.layout, pad: p }); }, { min: 0 });
  const mainOpts = [['start', 'В начале'], ['center', 'По центру'], ['end', 'В конце'], ['between', 'Равномерно']];
  const crossOpts = [['start', 'В начале'], ['center', 'По центру'], ['end', 'В конце']];
  return section('Авто-раскладка', h('div', null,
    row(ibtn('→', 'В ряд', () => setL('dir', 'row'), L.dir !== 'col'), ibtn('↓', 'В колонку', () => setL('dir', 'col'), L.dir === 'col'),
      num('⇹', 'gap', x => x.layout.gap, (x, v) => setP(x, 'layout', { ...x.layout, gap: v }), { title: 'Промежуток между слоями' })),
    h('div', { class: 'grid4' }, padNum('↑', 0, 'pt'), padNum('→', 1, 'pr'), padNum('↓', 2, 'pb'), padNum('←', 3, 'pl')),
    h('div', { class: 'grid2' },
      h('label', { class: 'mini' }, L.dir === 'col' ? 'По вертикали' : 'По горизонтали', sel_('lm', L.main, mainOpts, v => setL('main', v))),
      h('label', { class: 'mini' }, L.dir === 'col' ? 'По горизонтали' : 'По вертикали', sel_('lc', L.cross, crossOpts, v => setL('cross', v)))),
    row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: !!n.clip, onchange: e => { ns.forEach(x => setP(x, 'clip', e.target.checked)); commit(); } }), 'Обрезать содержимое'))),
    ibtn('−', 'Убрать авто-раскладку', () => { ns.forEach(x => setP(x, 'layout', null)); commit(); }));
}
function layerSection(ns) {
  const n = ns[0], d = doc();
  const bl = valOf(ns, x => x.blend || 'normal');
  const frame = ns.every(x => M.FRAMEISH.has(x.type));
  return section('Слой', h('div', null,
    h('div', { class: 'grid2' },
      sel_('blend', bl === MIXED ? '' : bl, BLENDS, v => { ns.forEach(x => setP(x, 'blend', v)); commit(); }),
      num('◐', 'opacity', x => Math.round((x.opacity ?? 1) * 100), (x, v) => setP(x, 'opacity', Math.max(0, Math.min(100, v)) / 100), { suffix: '%', min: 0, max: 100, title: 'Непрозрачность' })),
    frame && !ns.some(x => x.layout) ? row(h('label', { class: 'chk' }, h('input', { type: 'checkbox', checked: ns.every(x => x.clip), onchange: e => { ns.forEach(x => setP(x, 'clip', e.target.checked)); commit(); } }), 'Обрезать содержимое')) : null,
    frame ? row(h('span', { class: 'lbl' }, 'Режим цветов'), sel_('vmode', n.vmode ?? '', [['', 'Как у документа'], ...d.modes.map((m, i) => [i, m])], v => { ns.forEach(x => setP(x, 'vmode', v === '' ? null : +v)); commit(); })) : null));
}
function textSection(ns) {
  const n = ns[0];
  const v = k => { const x = valOf(ns, t => t[k]); return x === MIXED ? '' : x; };
  const setT = (k, val) => { ns.forEach(t => setP(t, k, val)); A.emit('fontload', ns); commit(); };
  return section('Текст', h('div', null,
    row(sel_('font', v('font'), FONTS.map(f => [f, f]), x => setT('font', x), { class: 'grow' })),
    h('div', { class: 'grid2' },
      sel_('weight', v('weight'), WEIGHTS.map(([w, t]) => [w, `${t} ${w}`]), x => setT('weight', +x)),
      num('Aa', 'size', t => t.size, (t, x) => setP(t, 'size', Math.max(1, x)), { min: 1, title: 'Размер шрифта' }),
      num('↕', 'lh', t => t.lh || 0, (t, x) => setP(t, 'lh', Math.max(0, x)), { show: x => x ? fmt(x) : 'Авто', parse: s => /^\s*(авто|auto)?\s*$/i.test(s) ? 0 : (evalNum(s) ?? undefined), title: 'Высота строки (0 — авто)' }),
      num('|A|', 'ls', t => t.ls || 0, (t, x) => setP(t, 'ls', x), { step: 0.1, title: 'Межбуквенный интервал' })),
    row(
      ibtn('⯇', 'По левому краю', () => setT('align', 'left'), n.align === 'left'), ibtn('≡', 'По центру', () => setT('align', 'center'), n.align === 'center'), ibtn('⯈', 'По правому краю', () => setT('align', 'right'), n.align === 'right'),
      h('span', { class: 'sp' }),
      ibtn('I', 'Курсив', () => setT('italic', !n.italic), n.italic), ibtn('U', 'Подчёркивание', () => setT('deco', n.deco === 'underline' ? 'none' : 'underline'), n.deco === 'underline'), ibtn('S', 'Зачёркивание', () => setT('deco', n.deco === 'strike' ? 'none' : 'strike'), n.deco === 'strike'),
      ibtn('AA', 'Заглавные', () => setT('tcase', n.tcase === 'upper' ? '' : 'upper'), n.tcase === 'upper')),
    row(h('span', { class: 'lbl' }, 'Размер'),
      ibtn('↔', 'Ширина по тексту', () => setT('auto', 'width'), n.auto === 'width'), ibtn('↧', 'Фикс. ширина, высота по тексту', () => setT('auto', 'height'), n.auto === 'height'), ibtn('▢', 'Фиксированный блок', () => setT('auto', 'fixed'), n.auto === 'fixed'))));
}

/* ---------- заливки и обводки ---------- */
function paintCSS(p, d) {
  if (p.type === 'linear') return `linear-gradient(${(p.angle ?? 90) + 90}deg, ${p.stops.map(s => hexA(s.color, s.a ?? 1) + ' ' + Math.round(s.p * 100) + '%').join(', ')})`;
  if (p.type === 'radial') return `radial-gradient(${p.stops.map(s => hexA(s.color, s.a ?? 1) + ' ' + Math.round(s.p * 100) + '%').join(', ')})`;
  if (p.type === 'image') return d.images[p.img] ? `center/cover url(${d.images[p.img]})` : '#ccc';
  const c = p.var ? M.varColor(d, p.var, d.mode) || p.color : p.color;
  return hexA(c, p.a ?? 1);
}
function updPaints(ns, key, fn, final = true) {
  for (const n of ns) { const arr = structuredClone(n[key]); fn(arr, n); setP(n, key, arr); }
  final ? commit() : live();
}
function paintsSection(ns, key, title) {
  const d = doc();
  const first = JSON.stringify(ns[0][key]);
  const same = ns.every(n => JSON.stringify(n[key]) === first);
  const add = () => updPaints(ns, key, arr => arr.push(M.solid(key === 'fills' ? (ns[0].type === 'text' ? '#000000' : '#d9d9d9') : '#000000')));
  const body = h('div', { class: 'paints' });
  if (!same) body.append(h('div', { class: 'muted small' }, 'Разные значения — нажмите +, чтобы задать всем.'));
  else {
    const arr = ns[0][key];
    for (let i = arr.length - 1; i >= 0; i--) {
      const p = arr[i];
      const v = p.var && d.vars.find(x => x.id === p.var);
      body.append(h('div', { class: 'paint' + (p.on === false ? ' off' : '') },
        h('button', { class: 'swatch', style: `background:${paintCSS(p, d)}`, title: 'Настроить', onclick: e => paintPopover(e.currentTarget, ns.map(n => n.id), key, i) }),
        v ? h('span', { class: 'varchip', title: 'Цветовая переменная' }, '◈ ' + v.name)
          : p.type === 'solid' ? h('input', { class: 'hex', 'data-k': key + 'hex' + i, value: (p.color || '').replace('#', '').toUpperCase(), onchange: e => { const c = normHex(e.target.value); if (c) updPaints(ns, key, a => { a[i].color = c; }); } })
            : h('span', { class: 'ptype' }, { linear: 'Линейный', radial: 'Радиальный', image: 'Картинка' }[p.type]),
        p.type !== 'image' ? h('input', { class: 'pct', 'data-k': key + 'a' + i, value: Math.round((p.a ?? 1) * 100) + '%', onchange: e => { const x = evalNum(e.target.value.replace('%', '')); if (x != null) updPaints(ns, key, a => { a[i].a = Math.max(0, Math.min(100, x)) / 100; }); } }) : h('span'),
        ibtn(p.on === false ? '—' : '👁', 'Показать/скрыть', () => updPaints(ns, key, a => { a[i].on = a[i].on === false; })),
        ibtn('−', 'Удалить', () => updPaints(ns, key, a => { a.splice(i, 1); }))));
    }
  }
  const extra = h('span', { class: 'head-btns' }, ibtn('+', 'Добавить', add));
  const sec = section(title, body, extra);
  if (key === 'strokes' && same && ns[0].strokes.length) {
    sec.append(h('div', { class: 'grid2' },
      num('≡', 'sw', n => n.sw, (n, v) => setP(n, 'sw', Math.max(0, v)), { min: 0, title: 'Толщина' }),
      ns.every(n => !['line', 'path', 'text'].includes(n.type)) ? sel_('salign', ns[0].salign || 'center', [['center', 'По центру'], ['inside', 'Внутри'], ['outside', 'Снаружи']], v => { ns.forEach(n => setP(n, 'salign', v)); commit(); }) : sel_('cap', ns[0].cap || 'butt', [['butt', 'Концы: нет'], ['round', 'Круглые'], ['square', 'Квадратные']], v => { ns.forEach(n => setP(n, 'cap', v)); commit(); }),
      num('┄', 'dash', n => n.dash || 0, (n, v) => setP(n, 'dash', Math.max(0, v)), { min: 0, title: 'Пунктир (длина штриха, 0 — сплошная)' })));
  }
  return sec;
}
function normHex(s) {
  s = String(s).trim().replace('#', '');
  if (/^[0-9a-f]{3}$/i.test(s)) s = s.split('').map(c => c + c).join('');
  return /^[0-9a-f]{6}$/i.test(s) ? '#' + s.toLowerCase() : null;
}
let pop = null;
export function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('mousedown', popOutside, true); } }
function popOutside(e) { if (pop && !pop.contains(e.target) && !e.target.closest('.swatch')) closePop(); }
function paintPopover(anchor, ids, key, i) {
  closePop();
  const d = doc();
  pop = h('div', { class: 'popover' });
  const r = anchor.getBoundingClientRect();
  pop.style.top = Math.min(r.top, innerHeight - 380) + 'px';
  pop.style.right = (innerWidth - r.left + 8) + 'px';
  document.body.append(pop);
  setTimeout(() => document.addEventListener('mousedown', popOutside, true), 0);
  const nodes = () => ids.map(N).filter(Boolean);
  const upd = (fn, final = true) => { updPaints(nodes(), key, a => { if (a[i]) fn(a[i]); }, final); if (final) build(); };
  const add = (...k) => pop.append(...k.filter(Boolean));
  const build = () => {
    const p = nodes()[0]?.[key]?.[i];
    if (!p) return closePop();
    pop.innerHTML = '';
    add(h('div', { class: 'pop-head' },
      sel_('ptype', p.type, [['solid', 'Сплошная'], ['linear', 'Линейный градиент'], ['radial', 'Радиальный градиент'], ['image', 'Картинка']], t => upd(q => {
        const base = q.color || q.stops?.[0]?.color || '#d9d9d9';
        for (const k of Object.keys(q)) delete q[k];
        q.type = t; q.a = 1;
        if (t === 'solid') q.color = base;
        if (t === 'linear' || t === 'radial') { q.angle = 90; q.stops = [{ p: 0, color: base, a: 1 }, { p: 1, color: '#ffffff', a: 1 }]; }
        if (t === 'image') { q.fit = 'fill'; q.img = null; }
      })),
      h('button', { class: 'ibtn', onclick: closePop }, '✕')));
    if (p.type === 'solid') {
      const v = p.var && d.vars.find(x => x.id === p.var);
      add(
        row(h('input', { type: 'color', class: 'bigcolor', value: v ? M.varColor(d, p.var, d.mode) : p.color, disabled: !!v, oninput: e => upd(q => { q.color = e.target.value; }, false), onchange: e => upd(q => { q.color = e.target.value; }) })),
        row(h('span', { class: 'lbl' }, 'HEX'), h('input', { class: 'hex', value: (p.color || '').replace('#', '').toUpperCase(), onchange: e => { const c = normHex(e.target.value); if (c) upd(q => { q.color = c; }); } }),
          h('input', { class: 'pct', value: Math.round((p.a ?? 1) * 100) + '%', onchange: e => { const x = evalNum(e.target.value.replace('%', '')); if (x != null) upd(q => { q.a = Math.max(0, Math.min(100, x)) / 100; }); } })),
        row(h('span', { class: 'lbl' }, '◈ Переменная'), sel_('pvar', p.var || '', [['', '— нет —'], ...d.vars.map(x => [x.id, x.name])], val => upd(q => { if (val) { q.var = val; } else { if (q.var) q.color = M.varColor(d, q.var, d.mode) || q.color; delete q.var; } }))),
        d.vars.length ? null : h('div', { class: 'muted small' }, 'Переменные создаются во вкладке «Ресурсы».'),
        h('div', { class: 'palette' }, ...['#000000', '#ffffff', '#f24822', '#ff8a00', '#ffcd29', '#14ae5c', '#0d99ff', '#5b5bf6', '#9747ff', '#ff24bd', '#d9d9d9', '#757575'].map(c => h('button', { class: 'pal', style: `background:${c}`, onclick: () => upd(q => { q.color = c; delete q.var; }) }))));
    } else if (p.type === 'linear' || p.type === 'radial') {
      if (p.type === 'linear') add(row(h('span', { class: 'lbl' }, 'Угол'), h('input', { class: 'pct', value: (p.angle ?? 90) + '°', onchange: e => { const x = evalNum(e.target.value.replace('°', '')); if (x != null) upd(q => { q.angle = x; }); } }),
        ibtn('↻', 'Повернуть на 45°', () => upd(q => { q.angle = ((q.angle ?? 90) + 45) % 360; }))));
      add(h('div', { class: 'grad-preview', style: `background:${paintCSS({ ...p, type: 'linear', angle: 0 }, d)}` }));
      p.stops.forEach((s, k) => add(row(
        h('input', { class: 'pct', value: Math.round(s.p * 100) + '%', title: 'Положение', onchange: e => { const x = evalNum(e.target.value.replace('%', '')); if (x != null) upd(q => { q.stops[k].p = Math.max(0, Math.min(100, x)) / 100; q.stops.sort((a, b) => a.p - b.p); }); } }),
        h('input', { type: 'color', value: s.color, oninput: e => upd(q => { q.stops[k].color = e.target.value; }, false), onchange: e => upd(q => { q.stops[k].color = e.target.value; }) }),
        h('input', { class: 'pct', value: Math.round((s.a ?? 1) * 100) + '%', title: 'Непрозрачность', onchange: e => { const x = evalNum(e.target.value.replace('%', '')); if (x != null) upd(q => { q.stops[k].a = Math.max(0, Math.min(100, x)) / 100; }); } }),
        p.stops.length > 2 ? ibtn('−', 'Удалить точку', () => upd(q => { q.stops.splice(k, 1); })) : null)));
      add(row(h('button', { class: 'btn ghost', onclick: () => upd(q => { q.stops.push({ p: 0.5, color: '#888888', a: 1 }); q.stops.sort((a, b) => a.p - b.p); }) }, '+ точка')));
    } else if (p.type === 'image') {
      add(
        p.img && d.images[p.img] ? h('div', { class: 'img-prev', style: `background-image:url(${d.images[p.img]})` }) : h('div', { class: 'muted small' }, 'Картинка не выбрана'),
        row(h('button', { class: 'btn', onclick: async () => { const id = await IO.pickImageId(); if (id) upd(q => { q.img = id; }); } }, 'Выбрать файл…')),
        row(h('span', { class: 'lbl' }, 'Вписать'), sel_('fit', p.fit || 'fill', [['fill', 'Заполнить'], ['fit', 'Вместить'], ['stretch', 'Растянуть'], ['tile', 'Плитка']], v => upd(q => { q.fit = v; }))),
        row(h('span', { class: 'lbl' }, 'Непрозр.'), h('input', { class: 'pct', value: Math.round((p.a ?? 1) * 100) + '%', onchange: e => { const x = evalNum(e.target.value.replace('%', '')); if (x != null) upd(q => { q.a = Math.max(0, Math.min(100, x)) / 100; }); } })));
    }
  };
  build();
}
function effectsSection(ns) {
  const first = JSON.stringify(ns[0].effects), same = ns.every(n => JSON.stringify(n.effects) === first);
  const upd = (fn, final = true) => { for (const n of ns) { const a = structuredClone(n.effects); fn(a); setP(n, 'effects', a); } final ? commit() : live(); };
  const body = h('div');
  if (same) ns[0].effects.forEach((e, i) => {
    const fld = (lab, k, o = {}) => num(lab, 'ef' + i + k, n => n.effects[i]?.[k] ?? 0, (n, v) => { const a = structuredClone(n.effects); if (a[i]) a[i][k] = o.min != null ? Math.max(o.min, v) : v; setP(n, 'effects', a); }, o);
    body.append(h('div', { class: 'effect' + (e.on === false ? ' off' : '') },
      row(sel_('eft' + i, e.type, [['shadow', 'Тень'], ['blur', 'Размытие слоя']], v => upd(a => { a[i].type = v; })), h('span', { class: 'sp' }),
        ibtn(e.on === false ? '—' : '👁', 'Показать/скрыть', () => upd(a => { a[i].on = a[i].on === false; })), ibtn('−', 'Удалить', () => upd(a => { a.splice(i, 1); }))),
      e.type === 'shadow' ? h('div', { class: 'grid2' }, fld('X', 'x'), fld('Y', 'y'), fld('⊙', 'r', { min: 0, title: 'Размытие' }),
        h('div', { class: 'row tight' }, h('input', { type: 'color', value: e.color || '#000000', oninput: ev => upd(a => { a[i].color = ev.target.value; }, false), onchange: ev => upd(a => { a[i].color = ev.target.value; }) }),
          h('input', { class: 'pct', value: Math.round((e.a ?? 0.25) * 100) + '%', onchange: ev => { const x = evalNum(ev.target.value.replace('%', '')); if (x != null) upd(a => { a[i].a = Math.max(0, Math.min(100, x)) / 100; }); } })))
        : h('div', { class: 'grid2' }, fld('⊙', 'r', { min: 0, title: 'Радиус размытия' }))));
  });
  else body.append(h('div', { class: 'muted small' }, 'Разные значения.'));
  return section('Эффекты', body, ibtn('+', 'Добавить тень', () => upd(a => a.push({ type: 'shadow', x: 0, y: 4, r: 12, color: '#000000', a: 0.2 }))));
}
let exportScale = 2, exportFmt = 'png';
function exportSection() {
  return section('Экспорт', h('div', null,
    row(sel_('exs', exportScale, [[0.5, '0.5×'], [1, '1×'], [2, '2×'], [3, '3×'], [4, '4×']], v => { exportScale = +v; }),
      sel_('exf', exportFmt, [['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG'], ['html', 'HTML']], v => { exportFmt = v; })),
    row(h('button', { class: 'btn wide', onclick: () => exportFmt === 'html' ? IO.exportHTML() : IO.exportSel(exportFmt, exportScale) }, 'Экспортировать'))));
}

/* ---------- прототип ---------- */
function topFrames() { return N(A.page).children.map(N).filter(n => n && M.FRAMEISH.has(n.type)); }
function protoPanel() {
  const ns = selNodes(), d = doc(), page = N(A.page);
  const out = [];
  out.push(section('Показ', h('div', null,
    row(h('span', { class: 'lbl' }, 'Старт'), sel_('start', page.start || '', [['', '— первый фрейм —'], ...topFrames().map(f => [f.id, f.name])], v => { page.start = v || null; commit(); })),
    row(h('button', { class: 'btn wide', onclick: () => A.emit('present') }, '▶ Показать прототип')))));
  if (ns.length === 1) {
    const n = ns[0], L = n.link || {};
    const set = (k, v) => { const l = { tr: 'instant', dur: 300, ...(n.link || {}), [k]: v }; if (!l.to) setP(n, 'link', null); else setP(n, 'link', l); commit(); };
    out.push(section('Взаимодействие', h('div', null,
      h('div', { class: 'muted small' }, 'По щелчку на «' + n.name + '»'),
      row(h('span', { class: 'lbl' }, 'Перейти'), sel_('lto', L.to || '', [['', '— нет —'], ['back', '← Назад'], ...topFrames().filter(f => f.id !== n.id).map(f => [f.id, f.name])], v => set('to', v))),
      L.to && L.to !== 'back' ? row(h('span', { class: 'lbl' }, 'Анимация'), sel_('ltr', L.tr || 'instant', [['instant', 'Мгновенно'], ['dissolve', 'Растворение'], ['slideL', 'Сдвиг влево'], ['slideR', 'Сдвиг вправо'], ['slideU', 'Снизу вверх'], ['push', 'Выталкивание']], v => set('tr', v))) : null,
      L.to && L.to !== 'back' && L.tr && L.tr !== 'instant' ? row(h('span', { class: 'lbl' }, 'Длительность'), sel_('ldur', L.dur || 300, [[150, '150 мс'], [300, '300 мс'], [500, '500 мс'], [800, '800 мс']], v => set('dur', +v))) : null)));
  } else out.push(h('div', { class: 'empty' }, 'Выделите слой, чтобы назначить переход по щелчку. Стрелки на холсте показывают связи.'));
  return out;
}

/* ---------- код ---------- */
function codePanel() {
  const ns = selNodes();
  if (ns.length !== 1) return [h('div', { class: 'empty' }, 'Выделите один слой — здесь будет CSS, размеры и экспорт в HTML.')];
  const n = ns[0];
  const b = M.worldBox(doc(), n.id);
  const css = IO.nodeCSS(doc(), n);
  return [
    section('Размеры', h('div', { class: 'code-dims' }, `${fmt(n.w)} × ${fmt(n.h)}  •  x ${fmt(n.x)}, y ${fmt(n.y)}  •  на холсте ${fmt(b.x)}, ${fmt(b.y)}`)),
    section('CSS', h('div', null, h('pre', { class: 'code' }, css),
      row(h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(css); toast('CSS скопирован'); } }, 'Копировать'),
        M.FRAMEISH.has(n.type) || n.type === 'group' ? h('button', { class: 'btn ghost', onclick: () => IO.exportHTML() }, 'Скачать HTML') : null))),
    n.type === 'text' ? section('Текст', h('pre', { class: 'code' }, n.text)) : null,
  ].filter(Boolean);
}
