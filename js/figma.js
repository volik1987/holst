// Импорт из Figma: файл .fig, вставка из буфера Figma (Ctrl/⌘+C в Figma → Ctrl/⌘+V здесь), ссылка + токен (REST API).
import * as M from './model.js';
import * as FC from './figma-conv.js';
import { A, N, commit, setDoc, viewCenter, toast } from './app.js';
import { shrinkImage } from './io.js';
import { h, modal, pickFile } from './dom.js';
import { FONTS } from './ui.js';

let libsP = null;
const loadLibs = () => libsP ||= Promise.all([import('../vendor/kiwi.js'), import('../vendor/fflate.js'), import('../vendor/fzstd.js')])
  .then(([kiwi, fflate, fzstd]) => ({ kiwi, fflate, fzstd }));

const MIME = b => b[0] === 0x89 && b[1] === 0x50 ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg' : b[0] === 0x47 && b[1] === 0x49 ? 'image/gif'
  : b[0] === 0x52 && b[8] === 0x57 ? 'image/webp' : 'image/png';
const toDataUrl = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
async function storeImage(doc, bytesOrBlob) {
  const blob = bytesOrBlob instanceof Blob ? bytesOrBlob : new Blob([bytesOrBlob], { type: MIME(bytesOrBlob) });
  const url = await shrinkImage(await toDataUrl(blob));
  const id = 'img' + M.uid(); doc.images[id] = url; return id;
}

// Шрифты, которых нет в наборе Холста, — подтягиваем с Google Fonts (если там есть).
const asked = new Set();
function ensureFonts(fonts, doc) {
  for (const f of fonts) {
    if (!f || FONTS.includes(f) || asked.has(f)) continue;
    asked.add(f);
    const fam = encodeURIComponent(f).replace(/%20/g, '+');
    const link = h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${fam}:ital,wght@0,100..900;1,100..900&display=swap` });
    link.onerror = () => { link.remove(); document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;600;700&display=swap` })); };
    document.head.append(link);
  }
  const texts = Object.values(doc.nodes).filter(n => n.type === 'text');
  if (texts.length) A.emit('fontload', texts);
}

/* ---------- сборка документа/вставки ---------- */
function buildPages(doc, pages, ctx, { paste }) {
  const top = [];
  const compPageName = 'Компоненты из Figma';
  let compPage = null;
  const getCompPage = () => compPage ||= Object.values(doc.nodes).find(n => n.type === 'page' && n.name === compPageName) || M.addPage(doc, compPageName);
  // уже вставленные раньше компоненты переиспользуем (по id из Figma)
  const have = new Map(Object.values(doc.nodes).filter(n => n.type === 'component' && n.fig).map(n => [n.fig, n.id]));
  const skip = F => F.type === 'component' && have.has(F.fid);
  for (const p of pages) for (const F of p.kids) FC.preassign(ctx, F);
  for (const [fid, id] of have) if (ctx.idOf.has(fid)) ctx.idOf.set(fid, id);
  for (const p of pages) {
    const kids = p.kids.filter(F => !skip(F));
    if (!kids.length) continue;
    let pageId;
    if (p.internal) pageId = getCompPage().id;
    else if (paste) pageId = A.page;
    else { const pg = M.addPage(doc, p.name); if (p.bg) pg.bg = p.bg; pageId = pg.id; }
    for (const F of kids) { const id = FC.build(doc, F, pageId, ctx); if (!p.internal) top.push(id); }
  }
  FC.finishInstances(doc, ctx);
  return top;
}
function centerAt(doc, ids, c) {
  if (!ids.length) return;
  const ns = ids.map(id => doc.nodes[id]);
  const x0 = Math.min(...ns.map(n => n.x)), y0 = Math.min(...ns.map(n => n.y));
  const x1 = Math.max(...ns.map(n => n.x + n.w)), y1 = Math.max(...ns.map(n => n.y + n.h));
  const dx = Math.round(c.x - (x0 + x1) / 2), dy = Math.round(c.y - (y0 + y1) / 2);
  for (const n of ns) { n.x += dx; n.y += dy; }
}
async function resolveImages(doc, need, getBytes) {
  const out = new Map(); let miss = 0;
  for (const [key, bytes] of need) {
    try { const b = bytes || await getBytes(key); if (b) out.set(key, await storeImage(doc, b)); else miss++; } catch { miss++; }
  }
  return { map: out, miss };
}
function report(what, ctx, miss) {
  const parts = [what];
  if (miss) parts.push(`картинок без данных: ${miss} (серые заглушки)`);
  const lost = ctx.insts.filter(i => !N(i.n.main)).length;
  if (lost) parts.push(`экземпляров без компонента: ${lost}`);
  toast(parts.join(' · '), miss || lost ? 6000 : 3500);
}

// Файл .fig (Figma → «Сохранить локальную копию»)
export async function importFigFile(file) {
  try {
    toast('Читаю файл Figma…', 2000);
    const libs = await loadLibs();
    const { msg, files, figjam } = FC.decodeFig(new Uint8Array(await file.arrayBuffer()), libs);
    const { pages, images } = FC.fromKiwi(msg);
    if (!pages.some(p => !p.internal && p.kids.length)) throw new Error(figjam ? 'доски FigJam не поддерживаются' : 'в файле нет слоёв');
    const doc = M.newDoc(file.name.replace(/\.fig$/i, ''));
    M.remove(doc, doc.nodes.root.children[0]);
    const im = await resolveImages(doc, images, key => files?.['images/' + key]);
    const ctx = FC.makeCtx(im.map);
    buildPages(doc, pages, ctx, { paste: false });
    if (!doc.nodes.root.children.length) M.addPage(doc, 'Страница 1');
    setDoc(doc); commit(); A.emit('docname'); A.emit('zoomfit');
    ensureFonts(ctx.fonts, doc);
    report(`Импортировано из Figma: ${doc.nodes.root.children.length} стр.`, ctx, im.miss);
  } catch (e) { console.error(e); toast('Не удалось открыть .fig: ' + e.message, 5000); }
}

// Вставка из буфера обмена Figma (HTML с данными kiwi). Возвращает true, если это были данные Figma.
export function isFigmaClipboard(html) { return /\(figma\)/.test(html || ''); }
export async function importFigClipboard(html) {
  try {
    const u8 = FC.clipboardBytes(html);
    if (!u8) throw new Error('нет данных');
    const libs = await loadLibs();
    const { msg } = FC.decodeFig(u8, libs);
    const { pages, images } = FC.fromKiwi(msg);
    const doc = A.doc;
    const im = await resolveImages(doc, images, () => null); // картинки Figma в буфер не кладёт
    const ctx = FC.makeCtx(im.map);
    const top = buildPages(doc, pages, ctx, { paste: true });
    centerAt(doc, top, viewCenter());
    A.sel = top; commit(); A.emit('select'); A.emit('change');
    ensureFonts(ctx.fonts, doc);
    report(`Вставлено из Figma: ${top.length} сл.`, ctx, im.miss);
  } catch (e) { console.error(e); toast('Не удалось вставить из Figma: ' + e.message, 5000); }
}

// Ссылка на файл + личный токен → REST API
export const parseFigmaLink = FC.parseFigmaLink;
const API = 'https://api.figma.com/v1';
async function api(path, token) {
  let r;
  try { r = await fetch(API + path, { headers: { 'X-Figma-Token': token } }); }
  catch { throw new Error('нет связи с api.figma.com'); }
  if (r.status === 403 || r.status === 401) throw new Error('токен не подходит или нет доступа к файлу');
  if (r.status === 404) throw new Error('файл не найден — проверьте ссылку');
  if (r.status === 429) throw new Error('Figma просит подождать — слишком много запросов, попробуйте через минуту');
  if (!r.ok) throw new Error('Figma ответила ' + r.status);
  return r.json();
}
export async function importFigmaLink(link, token, onStep = () => { }) {
  const L = FC.parseFigmaLink(link);
  if (!L) throw new Error('это не ссылка на файл Figma');
  if (!token) throw new Error('нужен токен доступа');
  onStep('Загружаю файл из Figma…');
  let file, paste = false;
  if (L.node) {
    const r = await api(`/files/${L.key}/nodes?ids=${encodeURIComponent(L.node)}&geometry=paths`, token);
    const d = r.nodes?.[L.node]?.document;
    if (!d) throw new Error('в файле нет слоя ' + L.node);
    file = d.type === 'CANVAS' ? { name: r.name, document: { children: [d] } } : { name: r.name, document: { children: [{ type: 'CANVAS', name: 'Figma', children: [d] }] } };
    paste = d.type !== 'CANVAS';
  } else file = await api(`/files/${L.key}?geometry=paths`, token);
  const { pages, images } = FC.fromREST(file);
  const doc = paste ? A.doc : M.newDoc(file.name || 'Из Figma');
  if (!paste) M.remove(doc, doc.nodes.root.children[0]);
  let urls = {};
  if (images.size) {
    onStep(`Загружаю картинки (${images.size})…`);
    try { urls = (await api(`/files/${L.key}/images`, token)).meta?.images || {}; } catch { }
  }
  const im = await resolveImages(doc, images, async key => { const u = urls[key.slice(4)]; if (!u) return null; const r = await fetch(u); return r.ok ? r.blob() : null; });
  const ctx = FC.makeCtx(im.map);
  const top = buildPages(doc, pages, ctx, { paste });
  if (paste) { centerAt(doc, top, viewCenter()); A.sel = top; commit(); A.emit('select'); A.emit('change'); }
  else { if (!doc.nodes.root.children.length) M.addPage(doc, 'Страница 1'); setDoc(doc); commit(); A.emit('docname'); A.emit('zoomfit'); }
  ensureFonts(ctx.fonts, A.doc);
  report(paste ? `Вставлено из Figma: ${top.length} сл.` : `Импортировано из Figma: ${A.doc.nodes.root.children.length} стр.`, ctx, im.miss);
}

/* ---------- окно ---------- */
export function figmaDialog() {
  const saved = localStorage.getItem('holst-figma-token') || '';
  const link = h('input', { class: 'inp', placeholder: 'https://www.figma.com/design/…', spellcheck: false });
  const token = h('input', { class: 'inp', type: 'password', placeholder: 'figd_…', value: saved, autocomplete: 'off' });
  const remember = h('input', { type: 'checkbox', checked: true });
  const status = h('p', { class: 'muted small' });
  const go = h('button', { class: 'btn', onclick: async () => {
    go.disabled = true; status.textContent = '';
    const t = token.value.trim();
    if (remember.checked) localStorage.setItem('holst-figma-token', t); else localStorage.removeItem('holst-figma-token');
    try { await importFigmaLink(link.value.trim(), t, s => { status.textContent = s; }); m.close(); }
    catch (e) { status.textContent = 'Ошибка: ' + e.message; }
    go.disabled = false;
  } }, 'Загрузить');
  const m = modal('Импорт из Figma', h('div', { class: 'figma-imp' },
    h('div', { class: 'imp-way' }, h('b', null, '1. Скопировать и вставить'),
      h('p', { class: 'muted small' }, 'В Figma выделите фреймы или слои → ⌘/Ctrl+C. Здесь нажмите ⌘/Ctrl+V. Переносятся фреймы, авто-раскладка, компоненты, тексты, векторы. Картинки Figma в буфер не кладёт — будут серые заглушки.')),
    h('div', { class: 'imp-way' }, h('b', null, '2. Файл .fig'),
      h('p', { class: 'muted small' }, 'В Figma: меню файла → «Save local copy…» (Сохранить локальную копию). Переносится весь файл со страницами и картинками.'),
      h('button', { class: 'btn ghost', onclick: async () => { const [f] = await pickFile('.fig'); if (f) { m.close(); importFigFile(f); } } }, 'Выбрать .fig…')),
    h('div', { class: 'imp-way' }, h('b', null, '3. По ссылке'),
      h('p', { class: 'muted small' }, 'Нужен личный токен: Figma → Settings → Security → Personal access tokens (право «File content: read»). Токен хранится только в этом браузере и уходит только на api.figma.com. Ссылка на фрейм (с node-id) вставит только его.'),
      h('label', { class: 'mini' }, 'Ссылка на файл или фрейм', link),
      h('label', { class: 'mini' }, 'Токен доступа', token),
      h('label', { class: 'mini row' }, remember, ' запомнить токен в этом браузере'),
      h('div', { class: 'row' }, go), status)), { cls: 'wide' });
  setTimeout(() => link.focus(), 50);
}
