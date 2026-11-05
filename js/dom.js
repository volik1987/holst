// Маленькие помощники для построения интерфейса.
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}
export const $ = (s, r = document) => r.querySelector(s);
export const fmt = v => v == null || Number.isNaN(v) ? '' : String(Math.round(v * 100) / 100);
export function evalNum(s, cur) {
  s = String(s).trim().replace(',', '.');
  if (!s) return null;
  if (/^[-+*/]/.test(s) && cur != null && !/^-\d/.test(s)) s = cur + s;
  if (!/^[\d\s.+\-*/()]+$/.test(s)) return null;
  try { const v = Function('return (' + s + ')')(); return Number.isFinite(v) ? v : null; } catch { return null; }
}
export function download(name, data, type = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function pickFile(accept, multiple = false) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, multiple, style: 'display:none' });
    i.onchange = () => { res([...i.files]); i.remove(); };
    document.body.append(i); i.click();
  });
}
export const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; how === 'text' ? r.readAsText(file) : r.readAsDataURL(file); });

// Модальное окно
export function modal(title, body, opts = {}) {
  const close = () => { back.remove(); opts.onclose?.(); };
  const back = h('div', { class: 'modal-back', onmousedown: e => { if (e.target === back) close(); } },
    h('div', { class: 'modal ' + (opts.cls || '') },
      h('div', { class: 'modal-head' }, h('b', null, title), h('button', { class: 'ibtn', onclick: close, title: 'Закрыть' }, '✕')),
      h('div', { class: 'modal-body' }, body)));
  document.body.append(back);
  return { close, el: back };
}
// Выпадающее меню
let openMenu = null;
export function menu(x, y, items) {
  closeMenu();
  const el = h('div', { class: 'menu' });
  const build = (list, host) => {
    for (const it of list) {
      if (it === '-') { host.append(h('div', { class: 'menu-sep' })); continue; }
      if (!it) continue;
      const row = h('div', { class: 'menu-item' + (it.disabled ? ' dis' : '') + (it.sub ? ' has-sub' : '') },
        h('span', { class: 'mi-check' }, it.checked ? '✓' : ''), h('span', { class: 'mi-label' }, it.label), h('span', { class: 'mi-key' }, it.key || (it.sub ? '▸' : '')));
      if (it.sub) { const sm = h('div', { class: 'menu sub' }); build(it.sub, sm); row.append(sm); }
      else if (!it.disabled) row.addEventListener('click', () => { closeMenu(); it.do?.(); });
      host.append(row);
    }
  };
  build(items, el);
  document.body.append(el);
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  el.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  openMenu = el;
  setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
  return el;
}
function outside(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; document.removeEventListener('mousedown', outside, true); } }
