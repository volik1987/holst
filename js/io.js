// Файлы: сохранение/открытие, картинки, импорт SVG, экспорт PNG/JPG/SVG/HTML, генерация CSS.
import * as M from './model.js';
import { localM, ap, mul, inv, aabb } from './geom.js';
import { A, N, commit, select, viewCenter, frameAt, toast, setDoc, nextName } from './app.js';
import { renderToCanvas, preloadImages, hexA, paintColor } from './render.js';
import { download, pickFile, readAs } from './dom.js';

const fileName = ext => (A.doc.name || 'holst').replace(/[\\/:*?"<>|]+/g, '_') + ext;

/* ---------- файл документа ---------- */
export function saveFile() {
  download(fileName('.holst'), JSON.stringify(A.doc), 'application/json');
  toast('Файл сохранён в «Загрузки»');
}
export async function openFileDialog() {
  const [f] = await pickFile('.holst,.json,.fig,application/json');
  if (f) openFile(f);
}
export async function openFile(f) {
  if (/\.fig$/i.test(f.name)) return (await import('./figma.js')).importFigFile(f);
  try {
    const o = JSON.parse(await readAs(f, 'text'));
    if (!o.nodes?.root) throw new Error('не похоже на файл Холста');
    o.id = M.uid(); o.images ||= {};
    setDoc(o); A.emit('zoomfit'); toast('Открыт «' + o.name + '»');
  } catch (e) { toast('Не удалось открыть: ' + e.message, 4000); }
}

/* ---------- картинки ---------- */
export async function shrinkImage(dataUrl) {
  if (dataUrl.length < 1.6e6 || /^data:image\/(svg|gif)/.test(dataUrl)) return dataUrl;
  const im = await loadImg(dataUrl);
  const s = Math.min(1, 2400 / Math.max(im.naturalWidth, im.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  const png = /^data:image\/png/.test(dataUrl);
  return c.toDataURL(png ? 'image/png' : 'image/jpeg', 0.88);
}
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
export async function addImage(dataUrl) {
  dataUrl = await shrinkImage(dataUrl);
  const id = 'img' + M.uid();
  A.doc.images[id] = dataUrl;
  const im = await loadImg(dataUrl);
  return { id, w: im.naturalWidth, h: im.naturalHeight };
}
export async function pickImageId() {
  const [f] = await pickFile('image/*');
  if (!f) return null;
  return (await addImage(await readAs(f))).id;
}
export async function insertImageFiles(files, at) {
  const doc = A.doc, out = [];
  let c = at || viewCenter();
  for (const f of files) {
    if (/svg/.test(f.type) || /\.svg$/i.test(f.name)) { const ids = importSVGText(await readAs(f, 'text'), c); out.push(...ids); c = { x: c.x + 20, y: c.y + 20 }; continue; }
    if (/json|holst/.test(f.type) || /\.(holst|fig)$/i.test(f.name)) { openFile(f); return; }
    if (!/^image\//.test(f.type)) continue;
    const img = await addImage(await readAs(f));
    let w = img.w, h = img.h; const s = Math.min(1, 800 / Math.max(w, h)); w = Math.round(w * s); h = Math.round(h * s);
    const parent = frameAt(c.x, c.y);
    const l = ap(inv(M.worldM(doc, parent)), c.x - w / 2, c.y - h / 2);
    const n = M.mk('rect', { name: f.name.replace(/\.[^.]+$/, '') || 'Картинка', x: Math.round(l.x), y: Math.round(l.y), w, h, fills: [{ type: 'image', img: img.id, fit: 'fill', a: 1 }] });
    M.insert(doc, n, parent);
    out.push(n.id);
    c = { x: c.x + 20, y: c.y + 20 };
  }
  if (out.length) { A.sel = out; commit(); A.emit('select'); }
}
export async function insertImageDialog() {
  const fs = await pickFile('image/*', true);
  if (fs.length) insertImageFiles(fs);
}

/* ---------- импорт SVG (редактируемые векторы) ---------- */
export async function importSVGDialog() {
  const [f] = await pickFile('.svg,image/svg+xml');
  if (f) importSVGText(await readAs(f, 'text'));
}
function parseColor(s) {
  if (!s || s === 'none' || s === 'transparent') return null;
  s = s.trim();
  if (s.startsWith('url(')) return { color: '#999999', a: 1 };
  const c = document.createElement('canvas').getContext('2d');
  c.fillStyle = '#000'; c.fillStyle = s;
  const v = c.fillStyle;
  if (v.startsWith('#')) return { color: v, a: 1 };
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) { const p = m[1].split(',').map(x => parseFloat(x)); return { color: '#' + p.slice(0, 3).map(x => Math.round(x).toString(16).padStart(2, '0')).join(''), a: p[3] ?? 1 }; }
  return { color: '#000000', a: 1 };
}
function svgTransform(s) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let r;
  while ((r = re.exec(s))) {
    const a = r[2].split(/[\s,]+/).filter(Boolean).map(Number); let t;
    switch (r[1]) {
      case 'matrix': t = a; break;
      case 'translate': t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case 'scale': t = [a[0], 0, 0, a[1] ?? a[0], 0, 0]; break;
      case 'rotate': { const q = (a[0] || 0) * Math.PI / 180, c = Math.cos(q), sn = Math.sin(q); t = [c, sn, -sn, c, 0, 0]; if (a.length > 2) t = mul(mul([1, 0, 0, 1, a[1], a[2]], t), [1, 0, 0, 1, -a[1], -a[2]]); break; }
      case 'skewX': t = [1, 0, Math.tan(a[0] * Math.PI / 180), 1, 0, 0]; break;
      case 'skewY': t = [1, Math.tan(a[0] * Math.PI / 180), 0, 1, 0, 0]; break;
    }
    m = mul(m, t);
  }
  return m;
}
// Разбор атрибута d в набор подконтуров из кубических кривых.
function parseD(d) {
  const toks = d.match(/[a-df-z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) || [];
  let i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0, lc = null, lq = null;
  const subs = []; let cur = null;
  const nextN = () => parseFloat(toks[i++]);
  const isNum = () => i < toks.length && !/^[a-z]$/i.test(toks[i]);
  const start = (px, py) => { cur = { pts: [{ x: px, y: py, ix: px, iy: py, ox: px, oy: py }], closed: false }; subs.push(cur); };
  const curve = (c1x, c1y, c2x, c2y, px, py) => { const last = cur.pts[cur.pts.length - 1]; last.ox = c1x; last.oy = c1y; cur.pts.push({ x: px, y: py, ix: c2x, iy: c2y, ox: px, oy: py }); };
  const line = (px, py) => curve(x, y, px, py, px, py);
  while (i < toks.length) {
    if (!isNum()) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { if (cur) { cur.closed = true; const f = cur.pts[0], l = cur.pts[cur.pts.length - 1]; if (cur.pts.length > 1 && Math.hypot(f.x - l.x, f.y - l.y) < 1e-6) { f.ix = l.ix; f.iy = l.iy; cur.pts.pop(); } } x = sx; y = sy; lc = lq = null; continue; }
    if (!isNum()) { i++; continue; }
    if (C === 'M') { x = ox + nextN(); y = oy + nextN(); sx = x; sy = y; start(x, y); cmd = rel ? 'l' : 'L'; lc = lq = null; continue; }
    if (!cur) start(x, y);
    if (C === 'L') { const px = ox + nextN(), py = oy + nextN(); line(px, py); x = px; y = py; lc = lq = null; }
    else if (C === 'H') { const px = ox + nextN(); line(px, y); x = px; lc = lq = null; }
    else if (C === 'V') { const py = oy + nextN(); line(x, py); y = py; lc = lq = null; }
    else if (C === 'C') { const a = [nextN(), nextN(), nextN(), nextN(), nextN(), nextN()]; curve(ox + a[0], oy + a[1], ox + a[2], oy + a[3], ox + a[4], oy + a[5]); lc = { x: ox + a[2], y: oy + a[3] }; x = ox + a[4]; y = oy + a[5]; lq = null; }
    else if (C === 'S') { const a = [nextN(), nextN(), nextN(), nextN()]; const c1 = lc ? { x: 2 * x - lc.x, y: 2 * y - lc.y } : { x, y }; curve(c1.x, c1.y, ox + a[0], oy + a[1], ox + a[2], oy + a[3]); lc = { x: ox + a[0], y: oy + a[1] }; x = ox + a[2]; y = oy + a[3]; lq = null; }
    else if (C === 'Q' || C === 'T') {
      let q;
      if (C === 'Q') { q = { x: ox + nextN(), y: oy + nextN() }; } else q = lq ? { x: 2 * x - lq.x, y: 2 * y - lq.y } : { x, y };
      const px = ox + nextN(), py = oy + nextN();
      curve(x + 2 / 3 * (q.x - x), y + 2 / 3 * (q.y - y), px + 2 / 3 * (q.x - px), py + 2 / 3 * (q.y - py), px, py);
      lq = q; lc = null; x = px; y = py;
    }
    else if (C === 'A') {
      const rx = nextN(), ry = nextN(), rot = nextN(), la = nextN(), sw = nextN(), px = ox + nextN(), py = oy + nextN();
      for (const c of arcToBez(x, y, rx, ry, rot, la, sw, px, py)) curve(...c);
      x = px; y = py; lc = lq = null;
    } else i++;
  }
  return subs;
}
function arcToBez(x1, y1, rx, ry, phi, fa, fs, x2, y2) {
  if (!rx || !ry) return [[x1, y1, x2, y2, x2, y2]];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const p = phi * Math.PI / 180, cp = Math.cos(p), sp = Math.sin(p);
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cp * dx + sp * dy, y1p = -sp * dx + cp * dy;
  let l = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (l > 1) { rx *= Math.sqrt(l); ry *= Math.sqrt(l); }
  const sign = fa === fs ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const co = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1p * y1p + ry * ry * x1p * x1p)));
  const cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
  const cx = cp * cxp - sp * cyp + (x1 + x2) / 2, cy = sp * cxp + cp * cyp + (y1 + y2) / 2;
  const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
  const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!fs && dt > 0) dt -= 2 * Math.PI; if (fs && dt < 0) dt += 2 * Math.PI;
  const segs = Math.ceil(Math.abs(dt) / (Math.PI / 2)), out = [], d = dt / segs;
  const k = 4 / 3 * Math.tan(d / 4);
  const pt = t => ({ x: cx + rx * Math.cos(t) * cp - ry * Math.sin(t) * sp, y: cy + rx * Math.cos(t) * sp + ry * Math.sin(t) * cp });
  const dv = t => ({ x: -rx * Math.sin(t) * cp - ry * Math.cos(t) * sp, y: -rx * Math.sin(t) * sp + ry * Math.cos(t) * cp });
  let t = t1;
  for (let i = 0; i < segs; i++) {
    const a = pt(t), b = pt(t + d), da = dv(t), db = dv(t + d);
    out.push([a.x + k * da.x, a.y + k * da.y, b.x - k * db.x, b.y - k * db.y, b.x, b.y]);
    t += d;
  }
  return out;
}
const ellipseD = (cx, cy, rx, ry) => `M${cx - rx},${cy}A${rx},${ry} 0 1 0 ${cx + rx},${cy}A${rx},${ry} 0 1 0 ${cx - rx},${cy}Z`;
export function importSVGText(text, at) {
  const doc = A.doc;
  const svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') { toast('Это не SVG'); return []; }
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const W = parseFloat(svg.getAttribute('width')) || vb[2] || 100, H = parseFloat(svg.getAttribute('height')) || vb[3] || 100;
  let root = vb.length === 4 && vb[2] ? [W / vb[2], 0, 0, H / vb[3], -vb[0] * W / vb[2], -vb[1] * H / vb[3]] : [1, 0, 0, 1, 0, 0];
  const style = (el, k, inh) => { const st = el.getAttribute('style') || ''; const m = new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)').exec(st); return m ? m[1].trim() : el.getAttribute(k) ?? inh[k]; };
  const c = at || viewCenter();
  const frame = M.mk('frame', { name: (svg.getAttribute('id') || 'SVG'), w: W, h: H, fills: [], clip: false });
  const parent = frameAt(c.x, c.y);
  const l = ap(inv(M.worldM(doc, parent)), c.x - W / 2, c.y - H / 2);
  frame.x = Math.round(l.x); frame.y = Math.round(l.y);
  M.insert(doc, frame, parent);
  const walkEl = (el, m, inh) => {
    for (const ch of el.children) {
      const tag = ch.nodeName.toLowerCase();
      if (['defs', 'style', 'title', 'desc', 'metadata', 'clippath', 'mask', 'lineargradient', 'radialgradient', 'symbol'].includes(tag)) continue;
      const cm = mul(m, svgTransform(ch.getAttribute('transform')));
      const st = { fill: style(ch, 'fill', inh) ?? 'black', stroke: style(ch, 'stroke', inh), 'stroke-width': style(ch, 'stroke-width', inh), opacity: inh.opacity * (parseFloat(style(ch, 'opacity', {})) || (style(ch, 'opacity', {}) === '0' ? 0 : 1)), 'fill-opacity': style(ch, 'fill-opacity', inh), 'font-size': style(ch, 'font-size', inh), 'font-family': style(ch, 'font-family', inh), 'font-weight': style(ch, 'font-weight', inh) };
      if (style(ch, 'display', {}) === 'none') continue;
      if (tag === 'g' || tag === 'svg' || tag === 'a') { walkEl(ch, cm, st); continue; }
      const A_ = k => parseFloat(ch.getAttribute(k)) || 0;
      let d = null;
      if (tag === 'path') d = ch.getAttribute('d');
      else if (tag === 'rect') { const x = A_('x'), y = A_('y'), w = A_('width'), h = A_('height'); let r = A_('rx') || A_('ry'); r = Math.min(r, w / 2, h / 2); d = r ? `M${x + r},${y}H${x + w - r}A${r},${r} 0 0 1 ${x + w},${y + r}V${y + h - r}A${r},${r} 0 0 1 ${x + w - r},${y + h}H${x + r}A${r},${r} 0 0 1 ${x},${y + h - r}V${y + r}A${r},${r} 0 0 1 ${x + r},${y}Z` : `M${x},${y}H${x + w}V${y + h}H${x}Z`; }
      else if (tag === 'circle') d = ellipseD(A_('cx'), A_('cy'), A_('r'), A_('r'));
      else if (tag === 'ellipse') d = ellipseD(A_('cx'), A_('cy'), A_('rx'), A_('ry'));
      else if (tag === 'line') d = `M${A_('x1')},${A_('y1')}L${A_('x2')},${A_('y2')}`;
      else if (tag === 'polyline' || tag === 'polygon') { const p = (ch.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); d = 'M' + p.join(' ') + (tag === 'polygon' ? 'Z' : ''); }
      else if (tag === 'text') {
        const fsz = parseFloat(st['font-size']) || 16;
        const p = ap(mul(root, cm), A_('x'), A_('y'));
        const sc = Math.hypot(cm[0] * root[0], cm[1] * root[0]) || 1;
        const fc = parseColor(st.fill) || { color: '#000000', a: 1 };
        const t = M.mk('text', { text: ch.textContent.trim(), size: Math.round(fsz * sc), x: p.x, y: p.y - fsz * sc * 0.9, weight: +st['font-weight'] || 400, fills: [M.solid(fc.color, fc.a)], name: ch.textContent.trim().slice(0, 30) });
        M.insert(doc, t, frame.id); continue;
      }
      if (!d) continue;
      const fm = mul(root, cm);
      const fillC = parseColor(st.fill), strokeC = parseColor(st.stroke);
      const fo = st['fill-opacity'] != null ? parseFloat(st['fill-opacity']) : 1;
      const sw = (parseFloat(st['stroke-width']) || 1) * Math.hypot(fm[0], fm[1]);
      for (const sub of parseD(d)) {
        const pts = sub.pts.map(q => { const a = ap(fm, q.x, q.y), i = ap(fm, q.ix, q.iy), o = ap(fm, q.ox, q.oy); return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; });
        if (pts.length < 2) continue;
        const n = M.mk('path', { name: tag === 'path' ? 'Вектор' : M.TYPE_RU[tag === 'circle' || tag === 'ellipse' ? 'ellipse' : tag === 'rect' ? 'rect' : 'path'] || 'Вектор', pts, closed: sub.closed || (tag !== 'line' && tag !== 'polyline' && fillC && false), x: 0, y: 0, w: 1, h: 1,
          fills: fillC && (sub.closed || tag === 'path' || tag === 'polygon') ? [M.solid(fillC.color, fillC.a * fo)] : [], strokes: strokeC ? [M.solid(strokeC.color, strokeC.a)] : [], sw: strokeC ? sw : 0, opacity: st.opacity });
        M.insert(doc, n, frame.id);
        M.normPath(n);
      }
    }
  };
  walkEl(svg, [1, 0, 0, 1, 0, 0], { opacity: 1, fill: 'black' });
  A.sel = [frame.id]; commit(); A.emit('select');
  return [frame.id];
}

/* ---------- экспорт растра и SVG ---------- */
export async function exportSel(fmt, scale = 1) {
  const ids = M.topLevel(A.doc, A.sel);
  if (!ids.length) { toast('Сначала выделите, что экспортировать'); return; }
  const name = N(ids[0]).name || 'export';
  if (fmt === 'svg') { download(name + '.svg', toSVG(A.doc, ids), 'image/svg+xml'); return; }
  await preloadImages(A.doc);
  const { canvas } = renderToCanvas(A.doc, ids, scale, { M, bg: fmt === 'jpg' ? '#ffffff' : null });
  canvas.toBlob(b => download(`${name}${scale !== 1 ? '@' + scale + 'x' : ''}.${fmt}`, b), fmt === 'jpg' ? 'image/jpeg' : 'image/png', 0.92);
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => Math.round(v * 1000) / 1000;
function rectD(w, h, r) {
  r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
  if (!r) return `M0 0H${num(w)}V${num(h)}H0Z`;
  return `M${num(r)} 0H${num(w - r)}A${num(r)} ${num(r)} 0 0 1 ${num(w)} ${num(r)}V${num(h - r)}A${num(r)} ${num(r)} 0 0 1 ${num(w - r)} ${num(h)}H${num(r)}A${num(r)} ${num(r)} 0 0 1 0 ${num(h - r)}V${num(r)}A${num(r)} ${num(r)} 0 0 1 ${num(r)} 0Z`;
}
function ptsD(pts, closed) {
  if (!pts.length) return '';
  let d = `M${num(pts[0].x)} ${num(pts[0].y)}`;
  const cnt = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < cnt; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; d += `C${num(a.ox)} ${num(a.oy)} ${num(b.ix)} ${num(b.iy)} ${num(b.x)} ${num(b.y)}`; }
  return d + (closed ? 'Z' : '');
}
function shapeD(n) {
  if (n.type === 'ellipse') return ellipseD(n.w / 2, n.h / 2, n.w / 2, n.h / 2);
  if (n.type === 'line') return `M0 0H${num(n.w)}`;
  if (n.type === 'path') return ptsD(n.pts, n.closed);
  return rectD(n.w, n.h, n.radius);
}
export function toSVG(doc, ids) {
  let b = null;
  for (const id of ids) { const w = M.worldBox(doc, id); b = b ? { x: Math.min(b.x, w.x), y: Math.min(b.y, w.y), x1: Math.max(b.x1, w.x + w.w), y1: Math.max(b.y1, w.y + w.h) } : { x: w.x, y: w.y, x1: w.x + w.w, y1: w.y + w.h }; }
  const W = b.x1 - b.x, H = b.y1 - b.y;
  const defs = []; let k = 0;
  const gid = () => 'h' + (k++);
  const paint = (p, n, mode) => {
    if (p.type === 'linear' || p.type === 'radial') {
      const id = gid();
      const stops = p.stops.map(s => `<stop offset="${num(s.p)}" stop-color="${s.color}" stop-opacity="${s.a ?? 1}"/>`).join('');
      if (p.type === 'radial') defs.push(`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${num(n.w / 2)}" cy="${num(n.h / 2)}" r="${num(Math.max(n.w, n.h) / 2)}">${stops}</radialGradient>`);
      else { const a = (p.angle ?? 90) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), L = Math.abs(n.w / 2 * dx) + Math.abs(n.h / 2 * dy); defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${num(n.w / 2 - dx * L)}" y1="${num(n.h / 2 - dy * L)}" x2="${num(n.w / 2 + dx * L)}" y2="${num(n.h / 2 + dy * L)}">${stops}</linearGradient>`); }
      return { v: `url(#${id})`, o: 1 };
    }
    return { v: paintColor(doc, p, mode), o: p.a ?? 1 };
  };
  const shadowF = n => {
    const sh = n.effects.filter(e => e.type === 'shadow' && e.on !== false), bl = n.effects.find(e => e.type === 'blur' && e.on !== false);
    if (!sh.length && !bl) return '';
    const id = gid();
    defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${sh.map(e => `<feDropShadow dx="${e.x || 0}" dy="${e.y || 0}" stdDeviation="${(e.r || 0) / 2}" flood-color="${e.color}" flood-opacity="${e.a ?? 0.25}"/>`).join('')}${bl ? `<feGaussianBlur stdDeviation="${bl.r / 2}"/>` : ''}</filter>`);
    return ` filter="url(#${id})"`;
  };
  const node = (n, mode) => {
    if (!n || !n.visible) return '';
    if (n.vmode != null && n.vmode !== '') mode = +n.vmode;
    const t = ` transform="matrix(${localM(n).map(num).join(' ')})"`;
    const op = n.opacity < 1 ? ` opacity="${num(n.opacity)}"` : '';
    const bl = n.blend && n.blend !== 'normal' ? ` style="mix-blend-mode:${n.blend}"` : '';
    const kids = () => (n.children || []).map(c => node(doc.nodes[c], mode)).join('');
    if (n.type === 'group') return `<g${t}${op}${bl}>${kids()}</g>`;
    const d = shapeD(n), f = shadowF(n);
    if (n.type === 'bool') {
      const fill = n.fills.find(p => p.on !== false);
      const pp = fill ? paint(fill, n, mode) : { v: 'none', o: 1 };
      const childD = c => c.type === 'group' || c.type === 'bool' ? (c.children.map(id => doc.nodes[id]).map(x => `<path transform="matrix(${localM(x).map(num).join(' ')})" d="${shapeD(x)}"/>`).join('')) : `<path d="${shapeD(c)}"/>`;
      const cs = n.children.map(id => doc.nodes[id]).filter(c => c?.visible);
      const wrapT = c => `<g transform="matrix(${localM(c).map(num).join(' ')})">${childD(c)}</g>`;
      if (n.op === 'subtract' || n.op === 'intersect') {
        const id = gid();
        if (n.op === 'subtract') defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="-1e5" y="-1e5" width="2e5" height="2e5"><g fill="#fff">${wrapT(cs[0])}</g><g fill="#000">${cs.slice(1).map(wrapT).join('')}</g></mask>`);
        else defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" x="-1e5" y="-1e5" width="2e5" height="2e5"><g fill="#fff">${wrapT(cs[cs.length - 1])}</g></mask>`);
        return `<g${t}${op}${f}><g mask="url(#${id})" fill="${pp.v}" fill-opacity="${pp.o}">${(n.op === 'subtract' ? [cs[0]] : cs.slice(0, -1)).map(wrapT).join('')}</g></g>`;
      }
      return `<g${t}${op}${f} fill="${pp.v}" fill-opacity="${pp.o}"${n.op === 'exclude' ? ' fill-rule="evenodd"' : ''}>${cs.map(wrapT).join('')}</g>`;
    }
    let out = `<g${t}${op}${bl}${f}>`;
    if (n.type === 'text') {
      const lines = M.textLines(n), lh = M.lineH(n);
      const x = n.align === 'center' ? n.w / 2 : n.align === 'right' ? n.w : 0, anchor = n.align === 'center' ? 'middle' : n.align === 'right' ? 'end' : 'start';
      for (const p of n.fills) {
        if (p.on === false || p.type === 'image') continue;
        const pp = paint(p, n, mode);
        out += `<text font-family="${esc(n.font)}, sans-serif" font-size="${n.size}" font-weight="${n.weight}"${n.italic ? ' font-style="italic"' : ''}${n.ls ? ` letter-spacing="${n.ls}"` : ''}${n.deco === 'underline' ? ' text-decoration="underline"' : n.deco === 'strike' ? ' text-decoration="line-through"' : ''} text-anchor="${anchor}" dominant-baseline="central" fill="${pp.v}" fill-opacity="${pp.o}">`;
        lines.forEach((l, i) => { out += `<tspan x="${num(x)}" y="${num(i * lh + lh / 2)}">${esc(l) || ' '}</tspan>`; });
        out += '</text>';
      }
      return out + '</g>';
    }
    let clipId = null;
    if (n.type !== 'line') for (const p of n.fills) {
      if (p.on === false) continue;
      if (p.type === 'image') {
        if (!doc.images[p.img]) continue;
        const id = gid(); defs.push(`<clipPath id="${id}"><path d="${d}"/></clipPath>`);
        const par = p.fit === 'fit' ? 'xMidYMid meet' : p.fit === 'stretch' ? 'none' : 'xMidYMid slice';
        out += `<image clip-path="url(#${id})" href="${doc.images[p.img]}" width="${num(n.w)}" height="${num(n.h)}" preserveAspectRatio="${par}" opacity="${p.a ?? 1}"/>`;
        continue;
      }
      const pp = paint(p, n, mode);
      out += `<path d="${d}" fill="${pp.v}" fill-opacity="${pp.o}"/>`;
    }
    if (n.children?.length) {
      if (n.clip) { clipId = gid(); defs.push(`<clipPath id="${clipId}"><path d="${d}"/></clipPath>`); }
      out += `<g${clipId ? ` clip-path="url(#${clipId})"` : ''}>${kids()}</g>`;
    }
    if (n.sw) for (const p of n.strokes) {
      if (p.on === false || p.type === 'image') continue;
      const pp = paint(p, n, mode);
      out += `<path d="${d}" fill="none" stroke="${pp.v}" stroke-opacity="${pp.o}" stroke-width="${n.sw}"${n.dash ? ` stroke-dasharray="${n.dash} ${n.dash}"` : ''}${n.cap && n.cap !== 'butt' ? ` stroke-linecap="${n.cap}"` : ''} stroke-linejoin="round"/>`;
    }
    return out + '</g>';
  };
  const body = ids.map(id => { const n = doc.nodes[id]; const pm = M.worldM(doc, n.parent); return `<g transform="matrix(${pm.map(num).join(' ')})">${node(n, doc.mode)}</g>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}" height="${num(H)}" viewBox="${num(b.x)} ${num(b.y)} ${num(W)} ${num(H)}" fill="none"><defs>${defs.join('')}</defs>${body}</svg>`;
}

/* ---------- CSS и HTML ---------- */
function cssPaint(doc, p, mode) {
  if (p.type === 'linear') return `linear-gradient(${num((p.angle ?? 90) + 90)}deg, ${p.stops.map(s => `${cssColor(s.color, s.a)} ${Math.round(s.p * 100)}%`).join(', ')})`;
  if (p.type === 'radial') return `radial-gradient(circle, ${p.stops.map(s => `${cssColor(s.color, s.a)} ${Math.round(s.p * 100)}%`).join(', ')})`;
  if (p.type === 'image') return `url(image.png) center / ${p.fit === 'fit' ? 'contain' : p.fit === 'stretch' ? '100% 100%' : 'cover'} no-repeat`;
  return cssColor(paintColor(doc, p, mode), p.a);
}
function cssColor(hex, a = 1) { return a >= 1 ? hex : hexA(hex, num(a)); }
function varName(doc, p) { const v = p.var && doc.vars.find(x => x.id === p.var); return v ? `var(--${v.name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')}, ${cssColor(paintColor(doc, p, doc.mode), p.a)})` : null; }
export function nodeCSS(doc, n, opts = {}) {
  const L = [];
  const mode = doc.mode;
  const p = doc.nodes[n.parent];
  const inFlow = p?.layout && !n.abs;
  if (!opts.noPos) {
    if (!inFlow && p && p.type !== 'page') { L.push('position: absolute;', `left: ${num(n.x)}px;`, `top: ${num(n.y)}px;`); }
  }
  const growMain = inFlow && n.grow, stretch = inFlow && n.stretch;
  const rowP = p?.layout?.dir !== 'col';
  if (!(growMain && rowP) && !(stretch && !rowP)) if (!(n.type === 'text' && n.auto === 'width') && !(n.layout?.hugW)) L.push(`width: ${num(n.w)}px;`);
  if (!(growMain && !rowP) && !(stretch && rowP)) if (!(n.type === 'text' && n.auto !== 'fixed') && !(n.layout?.hugH) && n.type !== 'line') L.push(`height: ${num(n.h)}px;`);
  if (growMain) L.push('flex: 1 0 0;');
  if (stretch) L.push('align-self: stretch;');
  if (n.rot) L.push(`transform: rotate(${num(n.rot)}deg);`);
  if (n.layout) {
    const l = n.layout;
    L.push('display: flex;', `flex-direction: ${l.dir === 'col' ? 'column' : 'row'};`);
    const jm = { start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between' };
    if (l.main !== 'start') L.push(`justify-content: ${jm[l.main]};`);
    if (l.cross !== 'start') L.push(`align-items: ${jm[l.cross]};`);
    if (l.gap && l.main !== 'between') L.push(`gap: ${num(l.gap)}px;`);
    const [t, r, b, lf] = l.pad;
    if (t || r || b || lf) L.push(`padding: ${[t, r, b, lf].map(v => num(v) + 'px').join(' ')};`);
    L.push('box-sizing: border-box;');
  }
  const fills = (n.fills || []).filter(f => f.on !== false);
  if (n.type === 'text') {
    const f = fills[0];
    if (f) L.push(`color: ${varName(doc, f) || cssPaint(doc, f, mode)};`);
    L.push(`font-family: "${n.font}", sans-serif;`, `font-size: ${n.size}px;`);
    if (n.weight !== 400) L.push(`font-weight: ${n.weight};`);
    if (n.italic) L.push('font-style: italic;');
    L.push(`line-height: ${n.lh ? num(n.lh) + 'px' : '120%'};`);
    if (n.ls) L.push(`letter-spacing: ${num(n.ls)}px;`);
    if (n.align !== 'left') L.push(`text-align: ${n.align};`);
    if (n.deco !== 'none') L.push(`text-decoration: ${n.deco === 'strike' ? 'line-through' : 'underline'};`);
    if (n.tcase === 'upper') L.push('text-transform: uppercase;');
    if (n.auto === 'width') L.push('white-space: pre;');
  } else if (fills.length && n.type !== 'line' && n.type !== 'group') {
    const bgs = fills.slice().reverse().map(f => varName(doc, f) || cssPaint(doc, f, mode));
    L.push(bgs.length === 1 && fills[0].type === 'solid' ? `background: ${bgs[0]};` : `background: ${bgs.join(', ')};`);
  }
  if (n.type === 'ellipse') L.push('border-radius: 50%;');
  else if (n.radius) L.push(`border-radius: ${num(n.radius)}px;`);
  const st = (n.strokes || []).find(f => f.on !== false);
  if (st && n.sw) {
    const c = varName(doc, st) || cssPaint(doc, st, mode);
    if (n.type === 'line') L.push(`border-top: ${num(n.sw)}px ${n.dash ? 'dashed' : 'solid'} ${c};`);
    else if (n.salign === 'outside') L.push(`outline: ${num(n.sw)}px solid ${c};`);
    else L.push(`border: ${num(n.sw)}px ${n.dash ? 'dashed' : 'solid'} ${c};`, 'box-sizing: border-box;');
  }
  const sh = (n.effects || []).filter(e => e.type === 'shadow' && e.on !== false);
  if (sh.length) L.push(`${n.type === 'text' ? 'text-shadow' : 'box-shadow'}: ${sh.map(e => `${e.x || 0}px ${e.y || 0}px ${e.r || 0}px ${cssColor(e.color, e.a ?? 0.25)}`).join(', ')};`);
  const bl = (n.effects || []).find(e => e.type === 'blur' && e.on !== false);
  if (bl) L.push(`filter: blur(${bl.r}px);`);
  if (n.opacity < 1) L.push(`opacity: ${num(n.opacity)};`);
  if (n.blend && n.blend !== 'normal') L.push(`mix-blend-mode: ${n.blend};`);
  if (n.clip && n.children?.length) L.push('overflow: hidden;');
  return L.join('\n');
}
export function exportHTML() {
  const doc = A.doc;
  const ids = M.topLevel(doc, A.sel);
  if (!ids.length) { toast('Выделите фрейм для экспорта в HTML'); return; }
  let css = '', k = 0;
  const cls = n => { const c = (n.name || n.type).toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-').replace(/^-|-$/g, '') || 'el'; return `${c}-${k++}`; };
  const node = (n, root) => {
    if (!n.visible) return '';
    const c = cls(n);
    let rules = nodeCSS(doc, n, { noPos: root });
    if (root) rules = 'position: relative;\n' + rules;
    const imgFill = (n.fills || []).find(f => f.type === 'image' && f.on !== false && doc.images[f.img]);
    if (imgFill) rules = rules.replace(/url\(image\.png\)/, `url(${doc.images[imgFill.img]})`);
    const needRel = n.children && !n.layout && n.children.length;
    if (needRel && !root && !/position:/.test(rules)) rules = 'position: relative;\n' + rules;
    css += `.${c} {\n  ${rules.split('\n').join('\n  ')}\n}\n`;
    if (n.type === 'text') return `<div class="${c}">${esc(M.caseText(n)).replace(/\n/g, '<br>')}</div>`;
    if (n.type === 'path' || n.type === 'bool') {
      const svg = toSVG(doc, [n.id]).replace('<svg ', `<svg class="${c}-svg" style="display:block" `);
      return `<div class="${c}">${svg}</div>`;
    }
    return `<div class="${c}">${(n.children || []).map(id => node(doc.nodes[id], false)).join('')}</div>`;
  };
  const vars = doc.vars.map(v => `  --${v.name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')}: ${v.values[doc.mode]};`).join('\n');
  const body = ids.map(id => node(doc.nodes[id], true)).join('\n');
  const fonts = [...new Set(Object.values(doc.nodes).filter(n => n.type === 'text').map(n => n.font))].filter(f => !['Arial', 'Georgia', 'Times New Roman', 'Courier New'].includes(f));
  const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(N(ids[0]).name)}</title>
${fonts.length ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fonts.map(f => 'family=' + f.replace(/ /g, '+') + ':ital,wght@0,100..900;1,100..900').join('&')}&display=swap">` : ''}
<style>
:root {\n${vars}\n}
body { margin: 0; padding: 24px; background: #f0f0f0; }
${css}</style></head>
<body>
${body}
</body></html>`;
  download((N(ids[0]).name || 'frame') + '.html', html, 'text/html');
}
