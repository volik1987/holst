// Точка входа: собирает интерфейс, горячие клавиши, текстовый редактор, файлы, буфер обмена.
import * as M from './model.js';
import { mul } from './geom.js';
import { A, N, commit, live, redraw, select, setDoc, setPage, undo, redo, deleteSel, duplicateSel, groupSel, ungroupSel, frameSel, boolSel, componentSel, detachSel, zorder, autoLayoutSel, align, selectAll, copySel, pasteData, zoomAt, zoomFit, zoomSel, viewSize, toWorld, toast, toggleProp, placeInstance, moveWorld, boxOf, resetOverrides } from './app.js';
import { initCanvas, isTyping, finishPen, deletePathPoint, cancelDrag } from './canvas.js';
import { buildToolbar, buildLeft, buildRight, setTool, closePop, goTo, FONTS } from './ui.js';
import { clearMeasure, paintColor, renderToCanvas, hexA } from './render.js';
import { h, $, menu, modal, closeMenu } from './dom.js';
import * as IO from './io.js';
import { present } from './proto.js';
import { collab } from './collab.js';
import { listDocs, getDoc, putDoc, delDoc } from './store.js';
import { demoDoc } from './demo.js';

/* ---------- шрифты ---------- */
async function loadFonts(nodes) {
  const want = new Set();
  for (const n of nodes) if (n.type === 'text') want.add(M.fontStr({ ...n, size: 16 }));
  if (!want.size || !document.fonts) return;
  try { await Promise.all([...want].map(f => document.fonts.load(f, 'АаZz'))); } catch { }
  clearMeasure(); M.normalize(A.doc); redraw(); A.emit('change');
}
document.fonts?.addEventListener?.('loadingdone', () => { clearMeasure(); if (A.doc) { M.normalize(A.doc); redraw(); } });

/* ---------- автосохранение ---------- */
let saveT = 0;
function scheduleSave() {
  clearTimeout(saveT);
  saveT = setTimeout(async () => {
    try {
      let thumb = null;
      const ids = N(A.doc.nodes.root.children[0])?.children || [];
      if (ids.length) {
        const b = boxOf(ids);
        const s = Math.min(240 / b.w, 150 / b.h, 1);
        thumb = renderToCanvas(A.doc, ids, s, { M, bg: N(A.doc.nodes.root.children[0]).bg || '#f0f0f0', pad: 10 / s }).canvas.toDataURL('image/jpeg', 0.6);
      }
      await putDoc(A.doc, thumb);
      localStorage.setItem('holst-last', A.doc.id);
    } catch (e) { console.warn('autosave', e); }
  }, 700);
}

/* ---------- текстовый редактор поверх холста ---------- */
let ta = null;
function placeTA() {
  const n = N(A.editText); if (!n || !ta) return;
  const m = mul([A.zoom, 0, 0, A.zoom, A.px, A.py], M.worldM(A.doc, n.id));
  const fill = n.fills.find(f => f.on !== false && f.type === 'solid');
  Object.assign(ta.style, {
    transform: `matrix(${m.join(',')})`, width: (n.auto === 'width' ? n.w + 40 : n.w) + 'px', height: Math.max(n.h, M.lineH(n)) + 'px',
    font: M.fontStr(n), lineHeight: M.lineH(n) + 'px', letterSpacing: (n.ls || 0) + 'px', textAlign: n.align,
    color: fill ? hexA(paintColor(A.doc, fill, A.doc.mode), fill.a ?? 1) : '#000', whiteSpace: n.auto === 'width' ? 'pre' : 'pre-wrap',
    textTransform: n.tcase === 'upper' ? 'uppercase' : 'none', textDecoration: n.deco === 'underline' ? 'underline' : n.deco === 'strike' ? 'line-through' : 'none',
  });
}
function startText(id) {
  endText();
  const n = N(id); if (!n) return;
  if (M.isClone(id) === false && n.locked) return;
  A.editText = id;
  ta = h('textarea', { class: 'text-edit', spellcheck: 'false' });
  ta.value = n.text;
  $('#stage').append(ta);
  placeTA();
  ta.focus(); ta.select();
  ta.addEventListener('input', () => {
    const n = N(id); if (!n) return;
    M.setProp(A.doc, n, 'text', ta.value);
    if (n.autoName && !M.isClone(id)) n.name = ta.value.trim().slice(0, 40) || 'Текст';
    M.normalize(A.doc); placeTA(); redraw(); A.emit('live');
  });
  ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); endText(); } });
  ta.addEventListener('blur', () => endText());
  redraw();
}
function endText() {
  if (!ta) return;
  const id = A.editText, t = ta; ta = null; A.editText = null;
  t.remove();
  const n = N(id);
  if (n && !String(n.text).trim() && !M.isClone(id)) { M.remove(A.doc, id); A.sel = A.sel.filter(x => x !== id); }
  commit(); A.emit('select');
}
A.on('editText', startText);
A.on('endText', endText);
A.on('zoom', placeTA);
A.on('remote', placeTA);

/* ---------- контекстное меню ---------- */
A.on('contextmenu', ({ x, y }) => {
  const ns = A.sel.map(N).filter(Boolean), one = ns.length === 1 ? ns[0] : null, any = ns.length > 0;
  const clone = ns.some(n => M.isClone(n.id));
  menu(x, y, any ? [
    { label: 'Копировать', key: '⌘C', do: () => copySel() },
    { label: 'Вставить', key: '⌘V', do: () => A.clip && pasteData(A.clip), disabled: !A.clip },
    { label: 'Дублировать', key: '⌘D', do: () => duplicateSel(), disabled: clone },
    { label: 'Удалить', key: '⌫', do: deleteSel, disabled: clone },
    '-',
    { label: 'На передний план', key: '⇧⌘]', do: () => zorder('front') },
    { label: 'Выше', key: '⌘]', do: () => zorder('up') },
    { label: 'Ниже', key: '⌘[', do: () => zorder('down') },
    { label: 'На задний план', key: '⇧⌘[', do: () => zorder('back') },
    '-',
    { label: 'Сгруппировать', key: '⌘G', do: groupSel, disabled: clone },
    { label: 'Разгруппировать', key: '⇧⌘G', do: ungroupSel, disabled: !ns.some(n => ['group', 'bool', 'frame'].includes(n.type)) || clone },
    { label: 'Обернуть во фрейм', key: '⌥⌘G', do: frameSel, disabled: clone },
    { label: 'Авто-раскладка', key: '⇧A', do: autoLayoutSel, disabled: clone },
    { label: 'Булевы операции', disabled: ns.length < 2 || clone, sub: [
      { label: 'Объединение', do: () => boolSel('union') }, { label: 'Вычитание', do: () => boolSel('subtract') },
      { label: 'Пересечение', do: () => boolSel('intersect') }, { label: 'Исключение', do: () => boolSel('exclude') }] },
    '-',
    { label: 'Создать компонент', key: '⌥⌘K', do: componentSel, disabled: clone },
    one?.type === 'instance' && !clone ? { label: 'Отсоединить экземпляр', key: '⌥⌘B', do: detachSel } : null,
    one?.type === 'instance' && !clone ? { label: 'Сбросить переопределения', do: resetOverrides } : null,
    one?.type === 'instance' && N(one.main) ? { label: 'Перейти к главному компоненту', do: () => goTo(one.main) } : null,
    '-',
    { label: ns.every(n => n.visible) ? 'Скрыть' : 'Показать', key: '⇧⌘H', do: () => toggleProp('visible') },
    { label: ns.every(n => n.locked) ? 'Разблокировать' : 'Заблокировать', key: '⇧⌘L', do: () => toggleProp('locked') },
    '-',
    { label: 'Копировать как PNG', do: copyPNG },
    { label: 'Экспорт PNG 2×', do: () => IO.exportSel('png', 2) },
    { label: 'Экспорт SVG', do: () => IO.exportSel('svg') },
  ] : [
    { label: 'Вставить', key: '⌘V', do: () => A.clip && pasteData(A.clip), disabled: !A.clip },
    { label: 'Выделить всё', key: '⌘A', do: selectAll },
    { label: 'Показать всё', key: '⇧1', do: zoomFit },
    '-',
    { label: 'Вставить картинку…', do: IO.insertImageDialog },
    { label: 'Импорт SVG…', do: IO.importSVGDialog },
    { label: 'Импорт из Figma…', do: () => import('./figma.js').then(m => m.figmaDialog()) },
  ]);
});
async function copyPNG() {
  try {
    const ids = M.topLevel(A.doc, A.sel);
    const { canvas } = renderToCanvas(A.doc, ids, 2, { M });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('PNG скопирован в буфер');
  } catch { toast('Браузер не дал записать картинку в буфер'); }
}

/* ---------- горячие клавиши ---------- */
let nudgeT = 0;
window.addEventListener('keydown', e => {
  if (A.present) return;
  if (document.querySelector('.modal-back')) { if (e.key === 'Escape') document.querySelector('.modal-back .modal-head .ibtn')?.click(); return; }
  if (isTyping()) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase(), code = e.code;
  const stop = () => { e.preventDefault(); e.stopPropagation(); };
  if (mod && code === 'KeyZ') { stop(); e.shiftKey ? redo() : undo(); return; }
  if (mod && code === 'KeyY') { stop(); redo(); return; }
  if (mod && code === 'KeyD') { stop(); duplicateSel(); return; }
  if (mod && code === 'KeyG') { stop(); e.altKey ? frameSel() : e.shiftKey ? ungroupSel() : groupSel(); return; }
  if (mod && e.altKey && code === 'KeyK') { stop(); componentSel(); return; }
  if (mod && e.altKey && code === 'KeyB') { stop(); detachSel(); return; }
  if (mod && e.shiftKey && code === 'KeyK') { stop(); IO.insertImageDialog(); return; }
  if (mod && code === 'KeyA') { stop(); selectAll(); return; }
  if (mod && code === 'KeyS') { stop(); scheduleSave(); IO.saveFile(); return; }
  if (mod && code === 'KeyO') { stop(); IO.openFileDialog(); return; }
  if (mod && e.shiftKey && code === 'KeyH') { stop(); toggleProp('visible'); return; }
  if (mod && e.shiftKey && code === 'KeyL') { stop(); toggleProp('locked'); return; }
  if (mod && e.shiftKey && code === 'KeyE') { stop(); IO.exportSel('png', 2); return; }
  if (mod && code === 'BracketRight') { stop(); zorder(e.shiftKey ? 'front' : 'up'); return; }
  if (mod && code === 'BracketLeft') { stop(); zorder(e.shiftKey ? 'back' : 'down'); return; }
  if (mod && (code === 'Digit0' || code === 'Numpad0')) { stop(); const v = viewSize(); zoomAt(1, v.w / 2, v.h / 2); return; }
  if (mod && code === 'Enter') { stop(); present(); return; }
  if (mod && (k === '=' || k === '+')) { stop(); const v = viewSize(); zoomAt(A.zoom * 2, v.w / 2, v.h / 2); return; }
  if (mod && k === '-') { stop(); const v = viewSize(); zoomAt(A.zoom / 2, v.w / 2, v.h / 2); return; }
  if (mod) return;
  if (e.altKey) {
    const map = { KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'hcenter', KeyV: 'vcenter' };
    if (map[code]) { stop(); align(map[code]); }
    return;
  }
  if (e.shiftKey && code === 'Digit1') { stop(); zoomFit(); return; }
  if (e.shiftKey && code === 'Digit2') { stop(); zoomSel(); return; }
  if (e.shiftKey && code === 'KeyA') { stop(); autoLayoutSel(); return; }
  if (e.key === '?' ) { stop(); help(); return; }
  if (k === 'backspace' || k === 'delete') { stop(); if (A.editPath && deletePathPoint()) return; deleteSel(); return; }
  if (k === 'escape') {
    stop(); closeMenu(); closePop();
    if (A.pen) { finishPen(false); return; }
    if (A.editPath) { const n = N(A.editPath); A.editPath = null; if (n) { M.normPath(n); commit(); } redraw(); return; }
    if (A.tool !== 'select') { setTool('select'); return; }
    if (A.sel.length) { const p = N(N(A.sel[0]).parent); select(p && p.type !== 'page' ? [p.id] : []); }
    return;
  }
  if (k === 'enter') {
    stop();
    if (A.pen) { finishPen(false); return; }
    const n = A.sel.length === 1 ? N(A.sel[0]) : null; if (!n) return;
    if (n.type === 'text') A.emit('editText', n.id);
    else if (n.type === 'path') { A.editPath = n.id; A.pathSel = -1; redraw(); }
    else if (n.children?.length) select([...n.children]);
    return;
  }
  if (k === 'tab') {
    stop(); if (A.sel.length !== 1) return;
    const n = N(A.sel[0]), sib = N(n.parent).children, i = sib.indexOf(n.id);
    select([sib[(i + (e.shiftKey ? 1 : -1) + sib.length) % sib.length]]); return;
  }
  if (k.startsWith('arrow')) {
    stop();
    const d = e.shiftKey ? 10 : 1, dx = k === 'arrowleft' ? -d : k === 'arrowright' ? d : 0, dy = k === 'arrowup' ? -d : k === 'arrowdown' ? d : 0;
    for (const id of M.topLevel(A.doc, A.sel)) moveWorld(id, dx, dy);
    live(); clearTimeout(nudgeT); nudgeT = setTimeout(commit, 400);
    return;
  }
  const tools = { v: 'select', f: 'frame', a: 'frame', r: 'rect', o: 'ellipse', l: 'line', p: 'pen', t: 'text', h: 'hand' };
  const t = tools[(code.startsWith('Key') ? code.slice(3) : '').toLowerCase()];
  if (t && !e.shiftKey) { stop(); setTool(t); }
});

/* ---------- буфер обмена ---------- */
document.addEventListener('copy', e => {
  if (isTyping() || !A.sel.length) return;
  const data = copySel(); if (!data) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', 'holst:' + JSON.stringify(data));
});
document.addEventListener('cut', e => {
  if (isTyping() || !A.sel.length) return;
  const data = copySel(); if (!data) return;
  e.preventDefault(); e.clipboardData.setData('text/plain', 'holst:' + JSON.stringify(data));
  deleteSel();
});
document.addEventListener('paste', e => {
  if (isTyping() || A.present) return;
  e.preventDefault();
  const dt = e.clipboardData;
  const html = dt?.getData('text/html') || '';
  if (/\(figma\)/.test(html)) { import('./figma.js').then(m => m.importFigClipboard(html)); return; }
  const files = [...(dt?.files || [])];
  if (files.length) { IO.insertImageFiles(files); return; }
  const t = dt?.getData('text/plain') || '';
  if (t.startsWith('holst:')) { try { pasteData(JSON.parse(t.slice(6))); } catch { toast('Не удалось вставить'); } return; }
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t)) { IO.importSVGText(t); return; }
  if (t.trim()) {
    const c = toWorld(viewSize().w / 2, viewSize().h / 2);
    const n = M.mk('text', { text: t, x: Math.round(c.x), y: Math.round(c.y), name: t.trim().slice(0, 40) });
    if (t.length > 60) { n.auto = 'height'; n.w = 320; }
    M.insert(A.doc, n, A.page); A.sel = [n.id]; commit(); A.emit('select');
    return;
  }
  if (A.clip) pasteData(A.clip);
});

/* ---------- перетаскивание файлов и компонентов ---------- */
function setupDrop() {
  const st = $('#stage');
  st.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  st.addEventListener('drop', e => {
    e.preventDefault();
    const r = st.getBoundingClientRect(), w = toWorld(e.clientX - r.left, e.clientY - r.top);
    const comp = e.dataTransfer.getData('holst/comp');
    if (comp && N(comp)) { A.sel = []; placeInstance(comp, w); return; }
    const files = [...e.dataTransfer.files];
    if (files.length) IO.insertImageFiles(files, w);
  });
}

/* ---------- окна: файлы, справка ---------- */
async function filesDialog() {
  const list = await listDocs().catch(() => []);
  const grid = h('div', { class: 'files' });
  const m = modal('Мои файлы', h('div', null,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { m.close(); newFile(); } }, '+ Новый файл'),
      h('button', { class: 'btn ghost', onclick: () => { m.close(); IO.openFileDialog(); } }, 'Открыть с диска…'),
      h('button', { class: 'btn ghost', onclick: () => { m.close(); openDemo(); } }, 'Демо-файл'),
      h('button', { class: 'btn ghost', onclick: () => { m.close(); import('./figma.js').then(x => x.figmaDialog()); } }, 'Из Figma…')),
    h('p', { class: 'muted small' }, 'Файлы хранятся в этом браузере и сохраняются автоматически. Чтобы перенести на другой компьютер — «Сохранить в файл .holst».'),
    grid), { cls: 'wide' });
  for (const d of list) {
    grid.append(h('div', { class: 'file' + (A.doc?.id === d.id ? ' on' : '') },
      h('div', { class: 'thumb', style: d.thumb ? `background-image:url(${d.thumb})` : '', onclick: async () => { m.close(); await openStored(d.id); } }),
      h('div', { class: 'fname' }, d.name),
      h('div', { class: 'fmeta' }, new Date(d.updated).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        h('button', { class: 'ibtn', title: 'Удалить', onclick: async ev => { ev.stopPropagation(); if (!confirm(`Удалить «${d.name}»?`)) return; await delDoc(d.id); ev.target.closest('.file').remove(); if (A.doc.id === d.id) toast('Текущий файл удалён из списка — он сохранится снова при следующей правке'); } }, '🗑'))));
  }
  if (!list.length) grid.append(h('div', { class: 'empty' }, 'Пока пусто.'));
}
async function openStored(id) {
  const s = await getDoc(id); if (!s) return;
  const d = JSON.parse(s); d.images ||= {};
  load(d);
}
function load(d) {
  setDoc(d); localStorage.setItem('holst-last', d.id);
  loadFonts(Object.values(d.nodes));
  requestAnimationFrame(zoomFit);
}
function newFile() {
  const d = M.newDoc('Без названия'); load(d); scheduleSave(); toast('Новый файл. F — фрейм, R — прямоугольник, T — текст');
}
function openDemo() { const d = demoDoc(); load(d); scheduleSave(); }
function help() {
  const rows = [
    ['Инструменты', [['V', 'Выделение'], ['F / A', 'Фрейм'], ['R', 'Прямоугольник'], ['O', 'Эллипс'], ['L', 'Линия'], ['P', 'Перо (щелчки — точки, протяжка — кривая, Enter — готово)'], ['T', 'Текст'], ['H / пробел', 'Рука'], ['⇧⌘K', 'Картинка']]],
    ['Правка', [['⌘Z / ⇧⌘Z', 'Отменить / повторить'], ['⌘C ⌘X ⌘V', 'Копировать, вырезать, вставить'], ['⌘D', 'Дублировать'], ['⌥ + перетаскивание', 'Копия при переносе'], ['⌫', 'Удалить'], ['Стрелки (⇧)', 'Сдвиг на 1 (10)'], ['Tab', 'Следующий слой'], ['Enter / Esc', 'Внутрь / к родителю']]],
    ['Структура', [['⌘G / ⇧⌘G', 'Группа / разгруппировать'], ['⌥⌘G', 'Обернуть во фрейм'], ['⇧A', 'Авто-раскладка'], ['⌥⌘K', 'Компонент'], ['⌥⌘B', 'Отсоединить экземпляр'], ['⌘] ⌘[', 'Выше / ниже'], ['⇧⌘H / ⇧⌘L', 'Скрыть / заблокировать']]],
    ['Вид', [['⌘ + колесо, щипок', 'Масштаб'], ['⇧1 / ⇧2', 'Всё / к выделению'], ['⌘0', '100%'], ['⌥A ⌥D ⌥W ⌥S ⌥H ⌥V', 'Выравнивание'], ['Alt (удерживать)', 'Расстояния'], ['⌘ + щелчок', 'Выбрать вложенный слой'], ['⌘Enter', 'Показ прототипа']]],
  ];
  modal('Горячие клавиши', h('div', { class: 'help' }, ...rows.map(([t, list]) => h('div', null, h('b', null, t), ...list.map(([k, v]) => h('div', { class: 'hk' }, h('kbd', null, k), h('span', null, v)))))), { cls: 'wide' });
}

/* ---------- запуск ---------- */
async function boot() {
  buildToolbar(); buildLeft(); buildRight(); initCanvas(); setupDrop();
  A.on('commit', () => { scheduleSave(); collab.onCommit(); });
  A.on('remote', scheduleSave);
  A.on('cursor', p => collab.cursor(p));
  A.on('select', () => collab.active && collab.cursor({ x: null, y: null }));
  A.on('undo', undo); A.on('redo', redo);
  A.on('present', () => present());
  A.on('collab', () => collab.openDialog());
  A.on('files', filesDialog); A.on('newfile', newFile); A.on('demo', openDemo); A.on('help', help);
  A.on('finishPen', () => finishPen(false));
  A.on('fontload', ns => loadFonts(ns));
  A.on('zoomfit', () => requestAnimationFrame(zoomFit));
  A.on('loadShared', d => { setDoc(d); loadFonts(Object.values(d.nodes)); requestAnimationFrame(zoomFit); });
  A.on('page', () => requestAnimationFrame(() => { if (N(A.page)?.children.length) zoomFit(); }));
  window.addEventListener('beforeunload', () => { clearTimeout(saveT); });

  let doc = null;
  const last = localStorage.getItem('holst-last');
  if (last) try { const s = await getDoc(last); if (s) { doc = JSON.parse(s); doc.images ||= {}; } } catch { }
  load(doc || demoDoc());
  if (!doc) scheduleSave();
  const room = new URLSearchParams(location.search).get('room');
  if (room && /^\d{6}$/.test(room)) { history.replaceState(null, '', location.pathname); collab.join(room); }
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__holst = { A, M, commit, select, setDoc, collab };
}
boot();
