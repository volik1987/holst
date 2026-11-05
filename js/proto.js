// Режим показа прототипа: кадры, переходы по щелчку, анимации.
import * as M from './model.js';
import { inv, ap } from './geom.js';
import { A, N } from './app.js';
import { renderToCanvas, preloadImages, hitTest } from './render.js';
import { h } from './dom.js';

export async function present(startId) {
  const doc = A.doc, page = N(A.page);
  const frames = page.children.map(N).filter(n => n && M.FRAMEISH.has(n.type) && n.visible);
  if (!frames.length) { alert('На странице нет фреймов для показа'); return; }
  // старт: выделенный фрейм верхнего уровня → стартовый кадр страницы → первый
  let cur = startId || (A.sel.length === 1 && frames.find(f => f.id === A.sel[0]) ? A.sel[0] : null);
  if (!cur && A.sel.length === 1) { const top = [A.sel[0], ...M.ancestors(doc, A.sel[0]).map(a => a.id)].find(id => frames.some(f => f.id === id)); cur = top; }
  cur ||= (page.start && N(page.start) ? page.start : frames[0].id);
  await preloadImages(doc);
  const hist = [];
  const cv = h('canvas', { class: 'pv-canvas' });
  const title = h('span', { class: 'pv-title' });
  const ov = h('div', { class: 'present' },
    h('div', { class: 'pv-bar' },
      h('button', { class: 'pv-btn', title: 'Назад', onclick: () => back() }, '←'), title,
      h('span', { class: 'pv-hint' }, 'Щёлкайте по элементам · ← → листать · Esc — выход'),
      h('button', { class: 'pv-btn', title: 'Закрыть (Esc)', onclick: () => close() }, '✕')),
    h('div', { class: 'pv-stage' }, cv));
  document.body.append(ov);
  A.present = true;
  const stage = ov.querySelector('.pv-stage');
  const ctx = cv.getContext('2d');
  let anim = null, layout = null;
  const dpr = devicePixelRatio || 1;

  const fit = id => {
    const n = N(id), W = stage.clientWidth, H = stage.clientHeight;
    const s = Math.min(1, (W - 40) / n.w, (H - 40) / n.h);
    return { s, x: (W - n.w * s) / 2, y: (H - n.h * s) / 2, w: n.w * s, h: n.h * s };
  };
  const snap = id => {
    const f = fit(id);
    const { canvas } = renderToCanvas(doc, [id], f.s * dpr, { M, onload: () => draw() });
    return { canvas, f };
  };
  const draw = (t) => {
    const W = stage.clientWidth, H = stage.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (anim) {
      const e = ease(Math.min(1, (performance.now() - anim.t0) / anim.dur));
      const A_ = anim.a, B = anim.b, W2 = W;
      const put = (o, dx, dy, al) => { ctx.globalAlpha = al; ctx.drawImage(o.canvas, o.f.x + dx, o.f.y + dy, o.f.w, o.f.h); ctx.globalAlpha = 1; };
      switch (anim.tr) {
        case 'dissolve': put(A_, 0, 0, 1); put(B, 0, 0, e); break;
        case 'slideL': put(A_, 0, 0, 1); put(B, (1 - e) * W2, 0, 1); break;
        case 'slideR': put(A_, 0, 0, 1); put(B, -(1 - e) * W2, 0, 1); break;
        case 'slideU': put(A_, 0, 0, 1); put(B, 0, (1 - e) * H, 1); break;
        case 'push': put(A_, -e * W2, 0, 1); put(B, (1 - e) * W2, 0, 1); break;
        default: put(B, 0, 0, 1);
      }
      if (e < 1) { requestAnimationFrame(() => draw()); return; }
      anim = null;
    }
    layout = snap(cur);
    ctx.drawImage(layout.canvas, layout.f.x, layout.f.y, layout.f.w, layout.f.h);
    title.textContent = N(cur).name;
  };
  const ease = x => 1 - Math.pow(1 - x, 3);
  const go = (id, tr = 'instant', dur = 300, push = true) => {
    if (!N(id) || id === cur) return;
    const a = snap(cur);
    if (push) hist.push(cur);
    cur = id;
    const b = snap(cur);
    title.textContent = N(cur).name;
    if (tr !== 'instant') anim = { a, b, tr, dur, t0: performance.now() };
    draw();
  };
  const back = () => { if (hist.length) go(hist.pop(), 'instant', 0, false); };
  const linkAt = (ex, ey) => {
    if (!layout) return null;
    const r = cv.getBoundingClientRect();
    const lx = (ex - r.left - layout.f.x) / layout.f.s, ly = (ey - r.top - layout.f.y) / layout.f.s;
    const fm = M.worldM(doc, cur), wpt = ap(fm, lx, ly);
    let id = hitTest(doc, cur, wpt.x, wpt.y, 2);
    while (id) { const n = N(id); if (n.link?.to) return n.link; if (id === cur) break; id = n.parent; }
    return null;
  };
  cv.addEventListener('click', e => {
    const l = linkAt(e.clientX, e.clientY);
    if (!l) { flash(); return; }
    if (l.to === 'back') back(); else go(l.to, l.tr || 'instant', l.dur || 300);
  });
  cv.addEventListener('mousemove', e => { cv.style.cursor = linkAt(e.clientX, e.clientY) ? 'pointer' : 'default'; });
  const flash = () => { ov.classList.add('flash'); setTimeout(() => ov.classList.remove('flash'), 250); };
  const key = e => {
    if (e.key === 'Escape') { close(); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const i = frames.findIndex(f => f.id === cur), j = (i + (e.key === 'ArrowRight' ? 1 : -1) + frames.length) % frames.length;
      go(frames[j].id, 'instant');
    } else if (e.key === 'Backspace') back();
    e.stopPropagation();
  };
  const ro = new ResizeObserver(() => draw()); ro.observe(stage);
  window.addEventListener('keydown', key, true);
  function close() { window.removeEventListener('keydown', key, true); ro.disconnect(); ov.remove(); A.present = false; }
  draw();
}
