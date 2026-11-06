// Перевод данных Figma в узлы Холста. Чистый модуль (без DOM) — его гоняют тесты в node.
// Два источника: бинарный kiwi (файл .fig и буфер обмена Figma) и JSON из Figma REST API.
// Оба сначала приводятся к общему описанию F, потом build() создаёт узлы Холста.
import * as M from './model.js';
import { mul, inv, ap } from './geom.js';

const R = v => Math.round(v * 100) / 100;
const h2 = v => Math.round(Math.max(0, Math.min(1, v ?? 0)) * 255).toString(16).padStart(2, '0');
export const hexOf = c => '#' + h2(c?.r) + h2(c?.g) + h2(c?.b);
export const bytesHex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

const BLEND = { MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', DARKEN: 'darken', LIGHTEN: 'lighten', COLOR_DODGE: 'color-dodge', COLOR_BURN: 'color-burn', DIFFERENCE: 'difference', LUMINOSITY: 'luminosity', EXCLUSION: 'difference', HARD_LIGHT: 'overlay', SOFT_LIGHT: 'overlay', LINEAR_BURN: 'color-burn', LINEAR_DODGE: 'color-dodge' };
const SAL = { INSIDE: 'inside', OUTSIDE: 'outside' };
const CONS_H = { MIN: 'left', MAX: 'right', CENTER: 'center', STRETCH: 'stretch', SCALE: 'scale', LEFT: 'left', RIGHT: 'right', LEFT_RIGHT: 'stretch' };
const CONS_V = { MIN: 'top', MAX: 'bottom', CENTER: 'center', STRETCH: 'stretch', SCALE: 'scale', TOP: 'top', BOTTOM: 'bottom', TOP_BOTTOM: 'stretch' };
const FIT = { FILL: 'fill', FIT: 'fit', STRETCH: 'stretch', TILE: 'tile' };
const ALIGN = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'between', SPACE_EVENLY: 'between', BASELINE: 'start' };
const BOOL = { UNION: 'union', SUBTRACT: 'subtract', INTERSECT: 'intersect', XOR: 'exclude', EXCLUDE: 'exclude' };
const TALIGN = { CENTER: 'center', RIGHT: 'right' };
const AUTO = { WIDTH_AND_HEIGHT: 'width', HEIGHT: 'height' };
const WEIGHTS = [[/thin|hairline/i, 100], [/(extra|ultra)\s*-?light/i, 200], [/light/i, 300], [/medium/i, 500], [/(semi|demi)\s*-?bold/i, 600], [/(extra|ultra)\s*-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
export const weightOf = style => (WEIGHTS.find(([re]) => re.test(style || '')) || [0, 400])[1];
const I6 = [1, 0, 0, 1, 0, 0];

/* ---------- общие кусочки ---------- */
function solidP(c, op) { return { type: 'solid', color: hexOf(c), a: R((c?.a ?? 1) * (op ?? 1)) }; }
function gradP(type, stops, op, p0, p1, w, hh) {
  const q = { type: /RADIAL|DIAMOND|ANGULAR/.test(type) ? 'radial' : 'linear', stops: stops.map(s => ({ p: R(s.position ?? 0), color: hexOf(s.color), a: R((s.color?.a ?? 1) * (op ?? 1)) })) };
  if (q.type === 'linear') q.angle = R(Math.atan2((p1.y - p0.y) * (hh || 1), (p1.x - p0.x) * (w || 1)) * 180 / Math.PI);
  return q;
}
function shadowE(e) { return { type: 'shadow', x: R(e.offset?.x || 0), y: R(e.offset?.y || 0), r: R(e.radius || 0), color: hexOf(e.color), a: R(e.color?.a ?? 0.25) }; }
function effectsOf(list) {
  const out = [];
  for (const e of list || []) {
    let q = null;
    if (e.type === 'DROP_SHADOW') q = shadowE(e);
    else if (e.type === 'FOREGROUND_BLUR' || e.type === 'LAYER_BLUR') q = { type: 'blur', r: R((e.radius || 0) / 2) };
    if (!q) continue;
    if (e.visible === false) q.on = false;
    out.push(q);
  }
  return out;
}
function layoutOf(dir, gap, pad, main, cross, hugMain, hugCross) {
  const row = dir === 'row';
  return { dir, gap: R(gap || 0), pad: pad.map(v => R(v || 0)), main: ALIGN[main] || 'start', cross: ALIGN[cross] || 'start', hugW: row ? hugMain : hugCross, hugH: row ? hugCross : hugMain };
}
const hug = v => v === 'RESIZE_TO_FIT' || v === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE' || v === 'AUTO' || v === 'HUG';
function textLH(units, value, size) {
  if (units === 'PIXELS') return R(value);
  if (units === 'RAW') return R(value * size);
  if (units === 'PERCENT') return value === 100 ? 0 : R(value / 100 * size);
  return 0;
}
const pt = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });

// Простой разбор SVG-пути (Figma отдаёт только M L Q C Z, абсолютные) → подпути с ручками.
export function pathSubs(d, closeAll) {
  const tok = String(d).match(/[MLQCZmlqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const subs = []; let cur = null, i = 0, cmd = '';
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[A-Za-z]/.test(tok[i])) cmd = tok[i++].toUpperCase();
    if (cmd === 'Z') { if (cur) { closeSub(cur); cur = null; } continue; }
    if (cmd === 'M') { cur = { pts: [pt(num(), num())], closed: false }; subs.push(cur); cmd = 'L'; continue; }
    if (!cur) { cur = { pts: [pt(0, 0)], closed: false }; subs.push(cur); }
    const last = cur.pts[cur.pts.length - 1];
    if (cmd === 'L') cur.pts.push(pt(num(), num()));
    else if (cmd === 'Q') { const qx = num(), qy = num(), x = num(), y = num(); last.ox = last.x + 2 / 3 * (qx - last.x); last.oy = last.y + 2 / 3 * (qy - last.y); const p = pt(x, y); p.ix = x + 2 / 3 * (qx - x); p.iy = y + 2 / 3 * (qy - y); cur.pts.push(p); }
    else if (cmd === 'C') { last.ox = num(); last.oy = num(); const ix = num(), iy = num(); const p = pt(num(), num()); p.ix = ix; p.iy = iy; cur.pts.push(p); }
    else i++;
  }
  if (closeAll) for (const s of subs) if (!s.closed) closeSub(s);
  return subs.filter(s => s.pts.length > 1);
}
function closeSub(s) {
  const P = s.pts, a = P[0], b = P[P.length - 1];
  if (P.length > 1 && Math.abs(a.x - b.x) < 1e-3 && Math.abs(a.y - b.y) < 1e-3) { a.ix = b.ix; a.iy = b.iy; P.pop(); }
  s.closed = true;
}
// Бинарная геометрия kiwi: байт команды (0 Z, 1 M, 2 L, 3 Q, 4 C) + float32.
export function cmdsToD(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 0, d = '';
  const f = () => { const v = dv.getFloat32(o, true); o += 4; return R(v * 100) / 100; };
  while (o < b.length) {
    const c = b[o++];
    if (c === 0) d += 'Z';
    else if (c === 1) d += `M${f()} ${f()}`;
    else if (c === 2) d += `L${f()} ${f()}`;
    else if (c === 3) d += `Q${f()} ${f()} ${f()} ${f()}`;
    else if (c === 4) d += `C${f()} ${f()} ${f()} ${f()} ${f()} ${f()}`;
    else break;
  }
  return d;
}
// Векторная сеть kiwi → цепочки сегментов (для контуров без заливки).
export function networkSubs(b, sx = 1, sy = 1) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let o = 0;
  const u = () => { const v = dv.getUint32(o, true); o += 4; return v; }, f = () => { const v = dv.getFloat32(o, true); o += 4; return v; };
  const nv = u(), ns = u(); u();
  const V = [], S = [];
  for (let i = 0; i < nv; i++) { u(); V.push({ x: f() * sx, y: f() * sy }); }
  for (let i = 0; i < ns; i++) { u(); const a = u(), tax = f() * sx, tay = f() * sy, bb = u(), tbx = f() * sx, tby = f() * sy; S.push({ a, ta: [tax, tay], b: bb, tb: [tbx, tby] }); }
  const rev = s => ({ a: s.b, ta: s.tb, b: s.a, tb: s.ta });
  const used = new Set(), subs = [];
  for (let k = 0; k < S.length; k++) {
    if (used.has(k)) continue;
    used.add(k); const seq = [S[k]];
    const extend = (atEnd) => {
      for (;;) {
        const v = atEnd ? seq[seq.length - 1].b : seq[0].a;
        if (seq.length > 1 && seq[seq.length - 1].b === seq[0].a) return;
        let j = -1, s = null;
        for (let q = 0; q < S.length && j < 0; q++) if (!used.has(q)) {
          if (atEnd ? S[q].a === v : S[q].b === v) { j = q; s = S[q]; } else if (atEnd ? S[q].b === v : S[q].a === v) { j = q; s = rev(S[q]); }
        }
        if (j < 0) return;
        used.add(j); atEnd ? seq.push(s) : seq.unshift(s);
      }
    };
    extend(true); extend(false);
    const closed = seq[seq.length - 1].b === seq[0].a;
    const pts = seq.map((s, i) => {
      const v = V[s.a], p = pt(v.x, v.y);
      p.ox = v.x + s.ta[0]; p.oy = v.y + s.ta[1];
      const prev = i > 0 ? seq[i - 1] : closed ? seq[seq.length - 1] : null;
      if (prev) { p.ix = v.x + prev.tb[0]; p.iy = v.y + prev.tb[1]; }
      return p;
    });
    if (!closed) { const l = seq[seq.length - 1], v = V[l.b], p = pt(v.x, v.y); p.ix = v.x + l.tb[0]; p.iy = v.y + l.tb[1]; pts.push(p); }
    if (pts.length > 1) subs.push({ pts, closed });
  }
  // области (заливки): styleID<<1 | правило, петли — списки сегментов
  subs.regions = [];
  try {
    const nr = dv.getUint32(8, true);
    for (let r = 0; r < nr; r++) {
      const st = u(), nl = u(), loops = [];
      for (let l = 0; l < nl; l++) {
        const k = u(), idx = []; for (let q = 0; q < k; q++) idx.push(u());
        const seq = [];
        for (let q = 0; q < idx.length; q++) {
          let s = S[idx[q]]; if (!s) continue;
          if (!seq.length) { const nx = S[idx[(q + 1) % idx.length]]; if (nx && idx.length > 1 && s.b !== nx.a && s.b !== nx.b) s = rev(s); }
          else if (s.a !== seq[seq.length - 1].b) s = rev(s);
          seq.push(s);
        }
        if (seq.length < 2) continue;
        loops.push({ closed: true, pts: seq.map((s, i) => { const v = V[s.a], p = pt(v.x, v.y), pr = seq[(i - 1 + seq.length) % seq.length]; p.ox = v.x + s.ta[0]; p.oy = v.y + s.ta[1]; p.ix = v.x + pr.tb[0]; p.iy = v.y + pr.tb[1]; return p; }) });
      }
      if (loops.length) subs.regions.push({ styleID: st >> 1, evenodd: !(st & 1), subs: loops });
    }
  } catch { }
  return subs;
}

/* ---------- kiwi (.fig и буфер) ---------- */
// Контейнер: zip (canvas.fig + images/) или голый «fig-kiwi» + версия + куски [длина, данные].
// libs = { kiwi, fflate, fzstd } — подгружаются снаружи (в браузере из vendor/).
export function decodeFig(u8, libs) {
  let files = null;
  if (u8[0] === 0x50 && u8[1] === 0x4b) { files = libs.fflate.unzipSync(u8); u8 = files['canvas.fig']; if (!u8) throw new Error('в архиве нет canvas.fig'); }
  const head = new TextDecoder().decode(u8.subarray(0, 8));
  if (!/^fig-(kiwi|jam\.|deck)/.test(head)) throw new Error('это не файл Figma');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const chunks = []; let o = 12;
  while (o + 4 <= u8.length) { const n = dv.getUint32(o, true); o += 4; chunks.push(u8.subarray(o, o + n)); o += n; }
  const un = c => c[0] === 0x28 && c[1] === 0xb5 && c[2] === 0x2f && c[3] === 0xfd ? libs.fzstd.decompress(c) : libs.fflate.inflateSync(c);
  const schema = libs.kiwi.compileSchema(libs.kiwi.decodeBinarySchema(un(chunks[0])));
  return { msg: schema.decodeMessage(un(chunks[1])), files, figjam: head.startsWith('fig-jam') };
}
// Из HTML буфера обмена Figma: <!--(figma)base64(/figma)-->
export function clipboardBytes(html) {
  const m = /\(figma\)([A-Za-z0-9+/=\s]+)\(\/figma\)/.exec(html || '');
  if (!m) return null;
  const bin = atob(m[1].replace(/\s+/g, '')), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

const gk = g => g ? g.sessionID + ':' + g.localID : '';

export function fromKiwi(msg) {
  const all = (msg.nodeChanges || []).filter(n => n.guid && n.phase !== 'REMOVED');
  const byId = new Map(all.map(n => [gk(n.guid), n]));
  const kids = new Map();
  for (const n of all) if (n.parentIndex?.guid) { const p = gk(n.parentIndex.guid); if (!kids.has(p)) kids.set(p, []); kids.get(p).push(n); }
  const pos = n => n.parentIndex?.position || '';
  for (const a of kids.values()) a.sort((x, y) => pos(x) < pos(y) ? -1 : pos(x) > pos(y) ? 1 : 0);
  const blobs = msg.blobs || [];
  const blob = i => blobs[i]?.bytes;
  const images = new Map(); // ключ → байты (или null, если картинки нет в данных)

  const paints = (list, w, hh) => (list || []).map(p => {
    const op = p.opacity ?? 1; let q;
    if (p.type === 'SOLID') q = solidP(p.color, op);
    else if (/^GRADIENT_/.test(p.type)) {
      const t = p.transform ? inv([p.transform.m00, p.transform.m10, p.transform.m01, p.transform.m11, p.transform.m02, p.transform.m12]) : I6;
      q = gradP(p.type, p.stops || [], op, ap(t, 0, 0.5), ap(t, 1, 0.5), w, hh);
    } else if (p.type === 'IMAGE') {
      let key = p.image?.hash?.length ? bytesHex(p.image.hash) : null, bytes = null;
      if (p.image?.dataBlob != null && blob(p.image.dataBlob)) { key ||= 'blob' + p.image.dataBlob; bytes = blob(p.image.dataBlob); }
      if (key && !images.get(key)) images.set(key, bytes);
      q = { type: 'image', key, fit: FIT[p.imageScaleMode] || 'fill' };
    } else return null;
    if (p.visible === false) q.on = false;
    return q;
  }).filter(Boolean);

  const textProps = (n, out) => {
    if ('textData' in n) out.text = n.textData?.characters ?? '';
    if (n.fontName) { out.font = n.fontName.family || 'Inter'; out.weight = weightOf(n.fontName.style); out.italic = /italic|oblique/i.test(n.fontName.style || ''); }
    if (n.fontSize != null) out.size = R(n.fontSize);
    return out;
  };
  // частичные свойства для переопределений экземпляра
  const partial = (o, w, hh) => {
    const p = {};
    if (o.fillPaints) p.fills = paints(o.fillPaints, w, hh);
    if (o.strokePaints) p.strokes = paints(o.strokePaints, w, hh);
    if (o.strokeWeight != null) p.sw = R(o.strokeWeight);
    if (o.visible != null) p.visible = o.visible;
    if (o.opacity != null) p.opacity = R(o.opacity);
    if (o.cornerRadius != null) p.radius = R(o.cornerRadius);
    if (o.effects) p.effects = effectsOf(o.effects);
    if (o.size && o.size.x != null) { p.w = R(o.size.x); p.h = R(o.size.y); }
    textProps(o, p);
    return p;
  };
  const geomSubs = (n, wantFill) => {
    if (wantFill && n.fillGeometry?.length) return n.fillGeometry.flatMap(g => blob(g.commandsBlob) ? pathSubs(cmdsToD(blob(g.commandsBlob)), true) : []);
    const vd = n.vectorData;
    if (vd && blob(vd.vectorNetworkBlob)) {
      const ns = vd.normalizedSize || n.size || { x: 1, y: 1 };
      try {
        const s = networkSubs(blob(vd.vectorNetworkBlob), (n.size?.x || 1) / (ns.x || 1), (n.size?.y || 1) / (ns.y || 1));
        if (wantFill && s.regions.length) { const r = s.regions.flatMap(g => g.subs); r.regions = s.regions; return r; }
        if (s.length) return s;
      } catch { }
    }
    return (n.fillGeometry || []).flatMap(g => blob(g.commandsBlob) ? pathSubs(cmdsToD(blob(g.commandsBlob)), true) : []);
  };
  // свойства компонента (текст/видимость), назначенные экземпляру, → переопределения по путям
  const propOverrides = (symId, assigns, prefix, out, depth = 0) => {
    if (!assigns?.length || depth > 8) return;
    const val = new Map(assigns.map(a => [gk(a.defID), a.value]));
    const walkS = (n) => {
      for (const c of kids.get(gk(n.guid)) || []) {
        for (const r of c.componentPropRefs || []) {
          if (r.isDeleted) continue;
          const v = val.get(gk(r.defID)); if (!v) continue;
          const key = [...prefix, gk(c.guid)];
          if (r.componentPropNodeField === 'TEXT_DATA' && v.textValue) out.push({ path: key, props: { text: v.textValue.characters ?? '' } });
          if (r.componentPropNodeField === 'VISIBLE' && v.boolValue != null) out.push({ path: key, props: { visible: !!v.boolValue } });
        }
        if (c.type !== 'INSTANCE') walkS(c);
      }
    };
    const s = byId.get(symId); if (s) walkS(s);
  };

  const conv = (n) => {
    const T = n.transform || { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    const w = n.size?.x ?? 0, hh = n.size?.y ?? 0;
    const F = {
      fid: gk(n.guid), okey: n.overrideKey ? gk(n.overrideKey) : null, name: n.name || '',
      m: [T.m00, T.m10, T.m01, T.m11, T.m02, T.m12], w, h: hh,
      visible: n.visible !== false && !n.mask, locked: !!n.locked, opacity: n.opacity ?? 1, blend: BLEND[n.blendMode] || 'normal',
      fills: paints(n.fillPaints, w, hh), strokes: paints(n.strokePaints, w, hh), sw: n.strokeWeight ?? 1, salign: SAL[n.strokeAlign] || 'center',
      dash: n.dashPattern?.[0] || 0, radius: n.cornerRadius ?? (n.rectangleCornerRadiiIndependent ? n.rectangleTopLeftCornerRadius : 0) ?? 0,
      effects: effectsOf(n.effects), cons: { h: CONS_H[n.horizontalConstraint] || 'left', v: CONS_V[n.verticalConstraint] || 'top' },
      grow: (n.stackChildPrimaryGrow || 0) > 0, stretch: n.stackChildAlignSelf === 'STRETCH', abs: n.stackPositioning === 'ABSOLUTE',
      clip: !n.frameMaskDisabled, kids: [],
    };
    if (n.stackMode === 'HORIZONTAL' || n.stackMode === 'VERTICAL') {
      const l = n.stackHorizontalPadding ?? n.stackPadding ?? 0, t = n.stackVerticalPadding ?? n.stackPadding ?? 0;
      F.layout = layoutOf(n.stackMode === 'HORIZONTAL' ? 'row' : 'col', n.stackSpacing, [t, n.stackPaddingRight ?? l, n.stackPaddingBottom ?? t, l], n.stackPrimaryAlignItems, n.stackCounterAlignItems, hug(n.stackPrimarySizing), hug(n.stackCounterSizing));
    }
    const sub = () => { for (const c of kids.get(F.fid) || []) { const k = conv(c); if (k) F.kids.push(k); } };
    switch (n.type) {
      case 'FRAME': F.type = n.resizeToFit ? 'group' : 'frame'; sub(); break;
      case 'GROUP': F.type = 'group'; sub(); break;
      case 'SECTION': F.type = 'frame'; F.clip = false; sub(); break;
      case 'SYMBOL': F.type = 'component'; sub(); break;
      case 'BOOLEAN_OPERATION': F.type = 'bool'; F.op = BOOL[n.booleanOperation] || 'union'; sub(); break;
      case 'INSTANCE': {
        F.type = 'instance'; F.main = gk(n.symbolData?.symbolID);
        F.ovr = [];
        for (const o of n.symbolData?.symbolOverrides || []) {
          const path = (o.guidPath?.guids || []).map(gk);
          if (!path.length || (path.length === 1 && path[0] === F.main)) continue;
          const p = partial(o, o.size?.x, o.size?.y);
          if (Object.keys(p).length) F.ovr.push({ path, props: p });
          if (o.componentPropAssignments?.length) {
            const tgt = byId.get(path[path.length - 1]);
            const sym = o.overriddenSymbolID ? gk(o.overriddenSymbolID) : gk(tgt?.symbolData?.symbolID);
            propOverrides(sym, o.componentPropAssignments, path, F.ovr);
          }
        }
        propOverrides(F.main, n.componentPropAssignments, [], F.ovr);
        break;
      }
      case 'RECTANGLE': case 'ROUNDED_RECTANGLE': F.type = 'rect'; break;
      case 'LINE': F.type = 'line'; break;
      case 'TEXT':
        F.type = 'text'; textProps(n, F); F.text ??= '';
        F.size ??= 12; F.font ??= 'Inter'; F.weight ??= 400;
        F.lh = n.lineHeight ? textLH(n.lineHeight.units, n.lineHeight.value, F.size) : 0;
        F.ls = n.letterSpacing ? R(n.letterSpacing.units === 'PERCENT' ? n.letterSpacing.value / 100 * F.size : n.letterSpacing.value) : 0;
        F.align = TALIGN[n.textAlignHorizontal] || 'left'; F.auto = AUTO[n.textAutoResize] || 'fixed';
        F.tcase = n.textCase === 'UPPER' ? 'upper' : n.textCase === 'LOWER' ? 'lower' : undefined;
        F.deco = n.textDecoration === 'UNDERLINE' ? 'underline' : n.textDecoration === 'STRIKETHROUGH' ? 'strike' : 'none';
        break;
      case 'ELLIPSE': {
        const a = n.arcData, full = !a || (Math.abs((a.endingAngle - a.startingAngle) - Math.PI * 2) < 1e-3 && !a.innerRadius);
        if (full) { F.type = 'ellipse'; break; }
      } // fallthrough — дуга/кольцо как вектор
      default: {
        if (n.type === 'TEXT_PATH') return null; // текст вдоль кривой не поддерживаем
        const wantFill = F.fills.some(p => p.on !== false);
        if (!n.fillGeometry?.length && !n.vectorData) return null;
        F.type = 'vector'; F.subs = geomSubs(n, wantFill); F.evenodd = n.fillGeometry?.[0]?.windingRule === 'ODD';
        // области вектора со своими заливками (styleID → vectorData.styleOverrideTable)
        const table = new Map((n.vectorData?.styleOverrideTable || []).map(s => [s.styleID, s]));
        if (!n.fillGeometry?.length && F.subs.regions?.length) {
          F.regions = F.subs.regions.map(g => { const st = g.styleID ? table.get(g.styleID) : null; return { subs: g.subs, fills: st?.fillPaints ? paints(st.fillPaints, w, hh) : F.fills, evenodd: g.evenodd }; })
            .filter(r => r.fills.some(p => p.on !== false));
          if (F.regions.length === 1) { F.subs = F.regions[0].subs; F.fills = F.regions[0].fills; F.evenodd = F.regions[0].evenodd; }
        } else if (n.fillGeometry?.length > 1 && n.fillGeometry.some(g => g.styleID)) {
          F.regions = n.fillGeometry.map(g => {
            const st = g.styleID ? table.get(g.styleID) : null;
            const fills = st?.fillPaints ? paints(st.fillPaints, w, hh) : F.fills;
            return { subs: blob(g.commandsBlob) ? pathSubs(cmdsToD(blob(g.commandsBlob)), true) : [], fills, evenodd: g.windingRule === 'ODD' };
          }).filter(r => r.subs.length && r.fills.some(p => p.on !== false));
        }
        if (F.regions?.length > 1 && F.strokes.some(p => p.on !== false) && blob(n.vectorData?.vectorNetworkBlob)) {
          const ns = n.vectorData.normalizedSize || n.size || { x: 1, y: 1 };
          try { F.strokeSubs = networkSubs(blob(n.vectorData.vectorNetworkBlob), (n.size?.x || 1) / (ns.x || 1), (n.size?.y || 1) / (ns.y || 1)); } catch { }
        }
        if (!F.subs.length) return null;
      }
    }
    return F;
  };

  const pages = [];
  const doc = all.find(n => n.type === 'DOCUMENT');
  for (const c of kids.get(gk(doc?.guid)) || []) {
    if (c.type !== 'CANVAS') continue;
    const bg = c.backgroundColor && c.backgroundEnabled !== false ? hexOf(c.backgroundColor) : null;
    const top = (kids.get(gk(c.guid)) || []).map(conv).filter(Boolean);
    pages.push({ name: c.name || 'Страница', bg, internal: !!c.internalOnly, kids: c.internalOnly ? top.filter(f => hasComp(f)) : top });
  }
  return { pages, images };
}
const hasComp = f => f.type === 'component' || f.kids?.some(hasComp);

/* ---------- REST API ---------- */
// Ссылка на файл/фрейм → ключ файла и id слоя
export function parseFigmaLink(s) {
  const m = /figma\.com\/(?:file|design|proto|board|make)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/.exec(s || '');
  if (!m) return null;
  const node = /[?&]node-id=([^&#]+)/.exec(s);
  const id = node ? decodeURIComponent(node[1]).replace(/-/g, ':') : null;
  return { key: m[2] || m[1], node: id && id !== '0:1' ? id : null };
}

export function fromREST(file) {
  const images = new Map();
  const comps = new Set();
  const scan = n => { if (n.type === 'COMPONENT') comps.add(n.id); for (const c of n.children || []) scan(c); };
  scan(file.document);
  const paints = (list, w, hh) => (list || []).map(p => {
    let q;
    if (p.type === 'SOLID') q = solidP(p.color, p.opacity);
    else if (/^GRADIENT_/.test(p.type)) { const [p0 = { x: 0, y: 0.5 }, p1 = { x: 1, y: 0.5 }] = p.gradientHandlePositions || []; q = gradP(p.type, p.gradientStops || [], p.opacity, p0, p1, w, hh); }
    else if (p.type === 'IMAGE') { const key = p.imageRef ? 'ref:' + p.imageRef : null; if (key) images.set(key, null); q = { type: 'image', key, fit: FIT[p.scaleMode] || 'fill' }; }
    else return null;
    if (p.visible === false) q.on = false;
    return q;
  }).filter(Boolean);
  const relM = n => {
    const t = n.relativeTransform;
    return t ? [t[0][0], t[1][0], t[0][1], t[1][1], t[0][2], t[1][2]] : null;
  };
  const sizeOf = n => n.size || { x: n.absoluteBoundingBox?.width || 0, y: n.absoluteBoundingBox?.height || 0 };
  const bboxOf = (m, w, hh) => { const pts = [ap(m, 0, 0), ap(m, w, 0), ap(m, 0, hh), ap(m, w, hh)]; const xs = pts.map(p => p.x), ys = pts.map(p => p.y); return { x: Math.min(...xs), y: Math.min(...ys) }; };
  // parentAbs — абсолютная матрица родителя, contAbs — ближайшего «настоящего» контейнера (группы и булевы им не считаются)
  const conv = (n, parentAbs, contAbs, inInst) => {
    if (n.type === 'SLICE') return null;
    const sz = sizeOf(n), w = sz.x, hh = sz.y;
    let rel = relM(n), abs;
    if (rel) {
      const a1 = mul(contAbs, rel), a2 = mul(parentAbs, rel);
      abs = a1;
      const bb = n.absoluteBoundingBox;
      if (bb && contAbs !== parentAbs) { const b1 = bboxOf(a1, w, hh), b2 = bboxOf(a2, w, hh); if (Math.hypot(b2.x - bb.x, b2.y - bb.y) < Math.hypot(b1.x - bb.x, b1.y - bb.y)) abs = a2; }
    } else { const bb = n.absoluteBoundingBox || { x: 0, y: 0 }; abs = [1, 0, 0, 1, bb.x, bb.y]; }
    const m = mul(inv(parentAbs), abs);
    const F = {
      fid: n.id, name: n.name || '', m, w, h: hh,
      visible: n.visible !== false && !n.isMask, locked: !!n.locked, opacity: n.opacity ?? 1, blend: BLEND[n.blendMode] || 'normal',
      fills: paints(n.fills, w, hh), strokes: paints(n.strokes, w, hh), sw: n.strokeWeight ?? 1, salign: SAL[n.strokeAlign] || 'center',
      dash: n.strokeDashes?.[0] || 0, radius: n.cornerRadius ?? n.rectangleCornerRadii?.[0] ?? 0, effects: effectsOf(n.effects),
      cons: { h: CONS_H[n.constraints?.horizontal] || 'left', v: CONS_V[n.constraints?.vertical] || 'top' },
      grow: (n.layoutGrow || 0) > 0, stretch: n.layoutAlign === 'STRETCH', abs: n.layoutPositioning === 'ABSOLUTE',
      clip: !!n.clipsContent, kids: [],
    };
    if (n.layoutMode === 'HORIZONTAL' || n.layoutMode === 'VERTICAL') {
      const row = n.layoutMode === 'HORIZONTAL';
      const hugM = row ? (n.layoutSizingHorizontal ? hug(n.layoutSizingHorizontal) : n.primaryAxisSizingMode === 'AUTO') : (n.layoutSizingVertical ? hug(n.layoutSizingVertical) : n.primaryAxisSizingMode === 'AUTO');
      const hugC = row ? (n.layoutSizingVertical ? hug(n.layoutSizingVertical) : n.counterAxisSizingMode === 'AUTO') : (n.layoutSizingHorizontal ? hug(n.layoutSizingHorizontal) : n.counterAxisSizingMode === 'AUTO');
      F.layout = layoutOf(row ? 'row' : 'col', n.itemSpacing, [n.paddingTop, n.paddingRight, n.paddingBottom, n.paddingLeft], n.primaryAxisAlignItems, n.counterAxisAlignItems, hugM, hugC);
    }
    const isCont = !['GROUP', 'BOOLEAN_OPERATION'].includes(n.type);
    const sub = () => { for (const c of n.children || []) { const k = conv(c, abs, isCont ? abs : contAbs, inInst); if (k) F.kids.push(k); } };
    switch (n.type) {
      case 'FRAME': case 'COMPONENT_SET': F.type = 'frame'; sub(); break;
      case 'SECTION': F.type = 'frame'; F.clip = false; sub(); break;
      case 'GROUP': F.type = 'group'; sub(); break;
      case 'COMPONENT': F.type = 'component'; sub(); break;
      case 'BOOLEAN_OPERATION': F.type = 'bool'; F.op = BOOL[n.booleanOperation] || 'union'; sub(); break;
      case 'INSTANCE':
        sub();
        if (comps.has(n.componentId)) { F.type = 'instance'; F.main = n.componentId; F.resolved = F.kids; F.kids = []; }
        else F.type = 'frame';
        break;
      case 'RECTANGLE': F.type = 'rect'; break;
      case 'LINE': F.type = 'line'; break;
      case 'TEXT': {
        const s = n.style || {};
        F.type = 'text'; F.text = n.characters ?? ''; F.font = s.fontFamily || 'Inter'; F.weight = s.fontWeight || weightOf(s.fontStyle); F.italic = !!s.italic;
        F.size = R(s.fontSize || 12); F.lh = s.lineHeightUnit === 'INTRINSIC_%' || !s.lineHeightPx ? 0 : R(s.lineHeightPx); F.ls = R(s.letterSpacing || 0);
        F.align = TALIGN[s.textAlignHorizontal] || 'left'; F.auto = AUTO[s.textAutoResize] || 'fixed';
        F.tcase = s.textCase === 'UPPER' ? 'upper' : s.textCase === 'LOWER' ? 'lower' : undefined;
        F.deco = s.textDecoration === 'UNDERLINE' ? 'underline' : s.textDecoration === 'STRIKETHROUGH' ? 'strike' : 'none';
        break;
      }
      case 'ELLIPSE': {
        const a = n.arcData, full = !a || (Math.abs((a.endingAngle - a.startingAngle) - Math.PI * 2) < 1e-3 && !a.innerRadius);
        if (full) { F.type = 'ellipse'; break; }
      } // fallthrough
      default: {
        const wantFill = F.fills.some(p => p.on !== false) && n.fillGeometry?.length;
        let geo = wantFill ? n.fillGeometry : null;
        if (!geo && n.strokeGeometry?.length && F.strokes.length) { geo = n.strokeGeometry; F.fills = F.strokes; F.strokes = []; } // контур обводки как заливка
        geo ||= n.fillGeometry;
        if (!geo?.length) return null;
        F.type = 'vector'; F.subs = geo.flatMap(g => pathSubs(g.path, true)); F.evenodd = geo[0].windingRule === 'EVENODD';
        if (!F.subs.length) return null;
      }
    }
    return F;
  };
  const pages = [];
  for (const c of file.document?.children || []) {
    if (c.type !== 'CANVAS') continue;
    pages.push({ name: c.name || 'Страница', bg: c.backgroundColor ? hexOf(c.backgroundColor) : null, kids: (c.children || []).map(k => conv(k, I6, I6)).filter(Boolean) });
  }
  return { pages, images };
}

/* ---------- сборка узлов Холста ---------- */
// ctx: { idOf: Map fid→id, images: Map key→imgId, fonts: Set, insts: [] }
export function makeCtx(images) { return { idOf: new Map(), images: images || new Map(), fonts: new Set(), insts: [], skip: new Set() }; }
export function preassign(ctx, F) {
  if (!ctx.idOf.has(F.fid)) ctx.idOf.set(F.fid, M.uid());
  if (F.okey && !ctx.idOf.has(F.okey)) ctx.idOf.set(F.okey, ctx.idOf.get(F.fid));
  for (const k of F.kids || []) preassign(ctx, k);
  for (const k of F.resolved || []) preassign(ctx, k);
}
const resolvePaints = (ctx, list) => (list || []).map(p => {
  if (p.type !== 'image') return p;
  const img = p.key && ctx.images.get(p.key);
  const q = img ? { type: 'image', img, fit: p.fit } : M.solid('#d9d9d9');
  if (p.on === false) q.on = false;
  return q;
});
const tpt = (m, p) => { const a = ap(m, p.x, p.y), i = ap(m, p.ix, p.iy), o = ap(m, p.ox, p.oy); return { x: a.x, y: a.y, ix: i.x, iy: i.y, ox: o.x, oy: o.y }; };

function baseProps(ctx, F) {
  const p = {
    name: F.name, visible: F.visible, locked: F.locked, opacity: R(F.opacity), blend: F.blend,
    fills: resolvePaints(ctx, F.fills), strokes: resolvePaints(ctx, F.strokes), sw: R(F.sw), dash: R(F.dash), radius: R(F.radius || 0),
    effects: F.effects, cons: F.cons,
  };
  if (F.salign !== 'center') p.salign = F.salign;
  if (F.grow) p.grow = true;
  if (F.stretch) p.stretch = true;
  if (F.abs) p.abs = true;
  return p;
}
function place(m, w, hh) {
  const [a, b, c, d, e, f] = m;
  const rot = Math.atan2(b, a) * 180 / Math.PI;
  const cx = e + a * w / 2 + c * hh / 2, cy = f + b * w / 2 + d * hh / 2;
  return { x: R(cx - w / 2), y: R(cy - hh / 2), w: R(w), h: R(hh), rot: Math.abs(rot) < 1e-3 ? 0 : R(rot) };
}
export const TEXT_KEYS = ['text', 'font', 'size', 'weight', 'italic', 'lh', 'ls', 'align', 'auto', 'deco'];

export function build(doc, F, parentId, ctx) {
  const id = ctx.idOf.get(F.fid) || M.uid();
  const base = baseProps(ctx, F);
  if (F.type === 'vector') return buildVector(doc, F, parentId, ctx, id, base);
  const type = F.type;
  const n = M.mk(type, { ...base, ...place(F.m, F.w, type === 'line' ? 0 : F.h), id });
  if (type === 'line') { n.h = 0; }
  if (M.FRAMEISH.has(type)) { n.clip = F.clip; if (F.layout) n.layout = F.layout; }
  if (type === 'group') { n.fills = []; n.strokes = []; }
  if (type === 'bool') n.op = F.op;
  if (type === 'component') n.fig = F.fid;
  if (type === 'text') {
    for (const k of TEXT_KEYS) if (F[k] !== undefined) n[k] = F[k];
    if (F.tcase) n.tcase = F.tcase;
    n.autoName = false; ctx.fonts.add(n.font);
  }
  if (type === 'instance') { n.main = ctx.idOf.get(F.main); n.overrides = {}; ctx.insts.push({ n, F }); }
  M.insert(doc, n, parentId);
  if (n.children) for (const k of F.kids) build(doc, k, n.id, ctx);
  return n.id;
}
function buildVector(doc, F, parentId, ctx, id, base) {
  const tr = subs => subs.map(s => ({ closed: s.closed, pts: s.pts.map(p => tpt(F.m, p)) }));
  if (F.regions?.length > 1) {
    const g = M.mk('group', { ...base, id, fills: [], strokes: [] });
    M.insert(doc, g, parentId);
    const sep = F.strokeSubs?.length > 0;
    for (const r of F.regions) shapeInto(doc, tr(r.subs), { fills: resolvePaints(ctx, r.fills), strokes: sep ? [] : base.strokes, sw: base.sw, name: 'Область' }, g.id, M.uid(), r.evenodd);
    if (sep) shapeInto(doc, tr(F.strokeSubs), { fills: [], strokes: base.strokes, sw: base.sw, salign: base.salign, name: 'Обводка' }, g.id, M.uid(), false);
    fitBox(doc, g);
    return id;
  }
  shapeInto(doc, tr(F.subs), base, parentId, id, F.evenodd);
  return id;
}
// Подпути → один контур или булева/группа из контуров (координаты подпутей — в системе родителя).
function shapeInto(doc, subs, props, parentId, id, evenodd) {
  const mkPath = (s, p) => { const n = M.mk('path', { ...p, pts: s.pts, closed: s.closed, x: 0, y: 0, w: 1, h: 1, rot: 0 }); M.normPath(n); n.x = R(n.x); n.y = R(n.y); return n; };
  if (subs.length === 1) { M.insert(doc, mkPath(subs[0], { ...props, id }), parentId); return; }
  const filled = props.fills.some(p => p.on !== false);
  const c = M.mk(filled ? 'bool' : 'group', { ...props, id });
  // чётно-нечётное или контуры разного направления (дыры) → «исключение», иначе — объединение
  const area = s => { let a = 0; const P = s.pts; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p.x * q.y - q.x * p.y; } return a; };
  const signs = new Set(subs.filter(s => s.closed).map(s => Math.sign(area(s))));
  if (filled) c.op = evenodd || signs.size > 1 ? 'exclude' : 'union'; else { c.fills = []; c.strokes = []; }
  M.insert(doc, c, parentId);
  for (const s of subs) M.insert(doc, mkPath(s, { fills: filled ? props.fills : [], strokes: props.strokes, sw: props.sw, name: 'Контур' }), c.id);
  fitBox(doc, c);
}
// рамка контейнера по детям (дети пока в координатах родителя контейнера)
function fitBox(doc, c) {
  const kids = c.children.map(k => doc.nodes[k]);
  if (!kids.length) return;
  const x0 = Math.min(...kids.map(k => k.x)), y0 = Math.min(...kids.map(k => k.y));
  const x1 = Math.max(...kids.map(k => k.x + k.w)), y1 = Math.max(...kids.map(k => k.y + k.h));
  Object.assign(c, { x: R(x0), y: R(y0), w: R(x1 - x0), h: R(y1 - y0), rot: 0 });
  for (const k of kids) { k.x = R(k.x - x0); k.y = R(k.y - y0); }
}
// Переопределения экземпляров: kiwi — готовые пути; REST — сравнение развёрнутых детей с главным компонентом.
const OVR_KEYS = ['fills', 'strokes', 'sw', 'visible', 'opacity', 'radius', 'effects', 'text', 'font', 'size', 'weight', 'italic'];
export function finishInstances(doc, ctx) {
  for (const { n, F } of ctx.insts) {
    if (!doc.nodes[n.main] || doc.nodes[n.main].type !== 'component') continue;
    n.overrides = { '': {} };
    for (const k of M.INST_COPY) if (n[k] !== undefined) n.overrides[''][k] = structuredClone(n[k]);
  }
  M.normalize(doc);
  for (const { n, F } of ctx.insts) {
    if (!n.overrides) continue;
    if (F.ovr) for (const o of F.ovr) {
      const ids = o.path.map(f => ctx.idOf.get(f));
      if (ids.some(x => !x)) continue;
      const props = { ...o.props };
      if (props.fills) props.fills = resolvePaints(ctx, props.fills);
      if (props.strokes) props.strokes = resolvePaints(ctx, props.strokes);
      const key = ids.join(':');
      n.overrides[key] = { ...n.overrides[key], ...props };
    }
    if (F.resolved) {
      const rec = list => {
        for (const D of list) {
          const segs = String(D.fid).split(';').slice(1);
          const ids = segs.map(s => ctx.idOf.get(s));
          if (ids.length && ids.every(Boolean)) {
            const key = ids.join(':'), src = doc.nodes[key];
            if (src) {
              const want = { ...baseProps(ctx, D) };
              if (D.type === 'text') for (const k of TEXT_KEYS) if (D[k] !== undefined) want[k] = D[k];
              const diff = {};
              for (const k of OVR_KEYS) if (k in want && JSON.stringify(want[k]) !== JSON.stringify(src[k])) diff[k] = want[k];
              if (Object.keys(diff).length) n.overrides[key] = { ...n.overrides[key], ...diff };
            }
          }
          rec(D.kids || []); rec(D.resolved || []);
        }
      };
      rec(F.resolved);
    }
  }
  M.normalize(doc);
}
