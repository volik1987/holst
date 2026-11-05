// Демо-файл: показывает компоненты, авто-раскладку, переменные, булевы операции и прототип.
import * as M from './model.js';

export function demoDoc() {
  const d = M.newDoc('Демо: мобильное приложение');
  const page = d.nodes[d.nodes.root.children[0]];
  page.name = 'Экраны'; page.bg = '#e9e9ee';
  const V = {};
  for (const [k, name, light, dark] of [['bg', 'Фон', '#f4f4f7', '#121214'], ['card', 'Карточка', '#ffffff', '#202024'], ['text', 'Текст', '#16161a', '#f2f2f5'], ['muted', 'Вторичный текст', '#6b6b76', '#9a9aa6'], ['accent', 'Акцент', '#5b5bf6', '#8e8cff']]) {
    const id = M.uid(); V[k] = id; d.vars.push({ id, name, values: [light, dark] });
  }
  const vf = (k, a = 1) => ({ type: 'solid', color: d.vars.find(v => v.id === V[k]).values[0], a, var: V[k] });
  const add = (n, parent) => M.insert(d, n, parent);
  const T = (text, size, weight, color, extra = {}) => M.mk('text', { text, size, weight, fills: [vf(color)], name: text.slice(0, 30), ...extra });

  // --- компоненты ---
  const lab = add(T('Компоненты', 13, 600, 'muted', { x: -420, y: -70 }), page.id);
  const btn = add(M.mk('component', { name: 'Кнопка', x: -420, y: 0, radius: 12, fills: [vf('accent')], clip: false,
    layout: { dir: 'row', gap: 8, pad: [13, 22, 13, 22], main: 'center', cross: 'center', hugW: true, hugH: true } }), page.id);
  const btnText = add(M.mk('text', { text: 'Кнопка', size: 15, weight: 600, fills: [M.solid('#ffffff')], name: 'Подпись' }), btn.id);

  const card = add(M.mk('component', { name: 'Карточка', x: -420, y: 90, w: 300, radius: 18, fills: [vf('card')], clip: true,
    effects: [{ type: 'shadow', x: 0, y: 6, r: 20, color: '#1b1b3a', a: 0.08 }],
    layout: { dir: 'col', gap: 10, pad: [12, 12, 16, 12], main: 'start', cross: 'start', hugW: false, hugH: true } }), page.id);
  add(M.mk('rect', { name: 'Обложка', h: 96, stretch: true, radius: 12, fills: [{ type: 'linear', angle: 35, a: 1, stops: [{ p: 0, color: '#8e8cff', a: 1 }, { p: 1, color: '#ff8fa3', a: 1 }] }] }), card.id);
  const cTitle = add(T('Заголовок карточки', 18, 700, 'text', { stretch: true, auto: 'height', name: 'Заголовок' }), card.id);
  add(T('Компоненты, авто-раскладка и цветовые переменные — как в больших редакторах.', 14, 400, 'muted', { stretch: true, auto: 'height', lh: 20, name: 'Описание' }), card.id);
  M.normalize(d);
  const cardBtn = M.makeInstance(d, btn.id, card.id, 0, 0);

  // --- экран 1 ---
  const s1 = add(M.mk('frame', { name: 'Главная', x: 0, y: 0, w: 375, h: 812, fills: [vf('bg')], clip: true,
    layout: { dir: 'col', gap: 14, pad: [44, 20, 24, 20], main: 'start', cross: 'start', hugW: false, hugH: false } }), page.id);
  add(T('Привет! Это Холст', 28, 800, 'text', { name: 'Заголовок' }), s1.id);
  add(T('Нажмите ▶ вверху справа и пощёлкайте прототип. Тёмная тема — во вкладке «Ресурсы».', 15, 400, 'muted', { stretch: true, auto: 'height', lh: 21 }), s1.id);
  M.normalize(d);
  const c1 = M.makeInstance(d, card.id, s1.id, 0, 0); c1.stretch = true;
  const c2 = M.makeInstance(d, card.id, s1.id, 0, 0); c2.stretch = true;
  M.normalize(d);
  M.setProp(d, d.nodes[c1.id + ':' + cTitle.id], 'text', 'Проект «Холст»');
  M.setProp(d, d.nodes[c2.id + ':' + cTitle.id], 'text', 'Экземпляры помнят правки');
  M.setProp(d, d.nodes[c2.id + ':' + cardBtn.id + ':' + btnText.id], 'text', 'Открыть');
  const b1 = M.makeInstance(d, btn.id, s1.id, 0, 0); b1.stretch = true;
  M.normalize(d);
  M.setProp(d, d.nodes[b1.id + ':' + btnText.id], 'text', 'Подробнее →');

  // --- экран 2 ---
  const s2 = add(M.mk('frame', { name: 'Детали', x: 440, y: 0, w: 375, h: 812, fills: [vf('bg')], clip: true,
    layout: { dir: 'col', gap: 20, pad: [56, 20, 24, 20], main: 'start', cross: 'start', hugW: false, hugH: false } }), page.id);
  add(T('Булевы операции', 28, 800, 'text'), s2.id);
  const shapes = add(M.mk('frame', { name: 'Фигуры', fills: [], clip: false, layout: { dir: 'row', gap: 20, pad: [0, 0, 0, 0], main: 'start', cross: 'center', hugW: true, hugH: true } }), s2.id);
  const u = add(M.mk('bool', { name: 'Объединение', op: 'union', fills: [vf('accent')] }), shapes.id);
  add(M.mk('ellipse', { x: 0, y: 0, w: 70, h: 70 }), u.id);
  add(M.mk('ellipse', { x: 35, y: 0, w: 70, h: 70 }), u.id);
  add(M.mk('rect', { x: 17, y: 35, w: 70, h: 45, radius: 6 }), u.id);
  const sb = add(M.mk('bool', { name: 'Вычитание', op: 'subtract', fills: [M.solid('#ff8a00')] }), shapes.id);
  add(M.mk('ellipse', { x: 0, y: 0, w: 80, h: 80 }), sb.id);
  add(M.mk('ellipse', { x: 26, y: -8, w: 70, h: 70 }), sb.id);
  const ix = add(M.mk('bool', { name: 'Пересечение', op: 'intersect', fills: [M.solid('#14ae5c')] }), shapes.id);
  add(M.mk('ellipse', { x: 0, y: 0, w: 70, h: 70 }), ix.id);
  add(M.mk('ellipse', { x: 30, y: 0, w: 70, h: 70 }), ix.id);
  add(T('Векторы пером', 18, 700, 'text'), s2.id);
  const wave = add(M.mk('path', { name: 'Волна', w: 300, h: 60, strokes: [vf('accent')], sw: 4, cap: 'round', pts: [
    { x: 0, y: 30, ix: 0, iy: 30, ox: 40, oy: -10 }, { x: 100, y: 30, ix: 60, iy: 70, ox: 140, oy: -10 },
    { x: 200, y: 30, ix: 160, iy: 70, ox: 240, oy: -10 }, { x: 300, y: 30, ix: 260, iy: 70, ox: 300, oy: 30 }] }), s2.id);
  M.normPath(wave);
  add(T('Двойной щелчок по волне — правка точек. Перетащите синие ручки.', 15, 400, 'muted', { stretch: true, auto: 'height', lh: 21 }), s2.id);
  const b2 = M.makeInstance(d, btn.id, s2.id, 0, 0);
  M.normalize(d);
  M.setProp(d, d.nodes[b2.id + ':' + btnText.id], 'text', '← Назад');
  b2.link = { to: 'back' };
  b1.link = { to: s2.id, tr: 'slideL', dur: 300 };
  page.start = s1.id;
  M.normalize(d);
  return d;
}
