// Сквозной тест интерфейса: запускать в открытой странице Холста из консоли
//   (await import('/tests/ui-e2e.js?' + Date.now())).run()
// Рисует мышью (синтетические события), проверяет модель, экспорт и показ.
export async function run() {
  const { A, M, commit } = window.__holst;
  const cv = document.getElementById('cv');
  const log = [], fail = [];
  const ok = (c, m) => (c ? log : fail).push(m);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const frame = () => new Promise(r => setTimeout(r, 0));
  const R = () => cv.getBoundingClientRect();
  const ev = (type, x, y, o = {}) => {
    const r = R();
    const e = new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...o });
    (type === 'pointerdown' ? cv : window).dispatchEvent(e);
  };
  const dragS = async (x0, y0, x1, y1, o = {}) => { ev('pointerdown', x0, y0, o); await frame(); for (let i = 1; i <= 6; i++) { ev('pointermove', x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * i / 6, o); await frame(); } ev('pointerup', x1, y1, o); await frame(); };
  const key = (k, o = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: o.code || (k.length === 1 ? 'Key' + k.toUpperCase() : k), bubbles: true, ...o }));
  const N = id => A.doc.nodes[id];
  const toS = (x, y) => ({ x: x * A.zoom + A.px, y: y * A.zoom + A.py });

  // новый файл, масштаб 100%, начало координат в (100,100)
  A.emit('newfile'); await wait(100);
  A.zoom = 1; A.px = 100; A.py = 100; A.emit('zoom');
  const page = () => N(A.page);

  // фрейм
  key('f'); ok(A.tool === 'frame', 'F → инструмент «Фрейм»');
  await dragS(100, 100, 500, 400);
  const fr = N(A.sel[0]);
  ok(fr?.type === 'frame' && fr.w === 400 && fr.h === 300 && fr.x === 0 && fr.y === 0, `фрейм 400×300 в (0,0): ${fr?.w}×${fr?.h} @${fr?.x},${fr?.y}`);
  ok(A.tool === 'select', 'после рисования — снова выделение');

  // прямоугольник внутри фрейма
  key('r'); await dragS(150, 150, 250, 230);
  const r1 = N(A.sel[0]);
  ok(r1?.type === 'rect' && r1.parent === fr.id, 'прямоугольник попал во фрейм');
  ok(r1.x === 50 && r1.y === 50 && r1.w === 100 && r1.h === 80, `его координаты относительно фрейма: ${r1.x},${r1.y} ${r1.w}×${r1.h}`);

  // эллипс с Shift — круг
  key('o'); await dragS(300, 150, 370, 190, { shiftKey: true });
  const el = N(A.sel[0]);
  ok(el?.type === 'ellipse' && el.w === el.h, `Shift даёт круг: ${el?.w}×${el?.h}`);

  // перенос с прилипанием: тянем эллипс так, чтобы его верх почти совпал с верхом прямоугольника (y=50)
  const s0 = toS(fr.x + el.x + el.w / 2, fr.y + el.y + el.h / 2);
  await dragS(s0.x, s0.y, s0.x + 3, s0.y + 3);
  const e2 = N(el.id);
  // центр 88 ближе всего к центру соседа (90) → y=55; левый край 203 — к центру фрейма (200)
  ok(e2.y === 55 && e2.x === 200, `прилипание к центру соседа: ${e2.x},${e2.y}`);

  // изменение размера за правый нижний угол
  A.sel = [r1.id]; A.emit('select'); await frame();
  const c = toS(fr.x + r1.x + r1.w, fr.y + r1.y + r1.h);
  await dragS(c.x, c.y, c.x + 40, c.y + 20);
  ok(N(r1.id).w === 140 && N(r1.id).h === 100, `ресайз за угол: ${N(r1.id).w}×${N(r1.id).h}`);

  // отмена/повтор
  key('z', { code: 'KeyZ', metaKey: true });
  ok(N(r1.id).w === 100, 'отмена ресайза');
  key('z', { code: 'KeyZ', metaKey: true, shiftKey: true });
  ok(N(r1.id).w === 140, 'повтор ресайза');

  // группа и разгруппировка
  A.sel = [r1.id, el.id]; A.emit('select');
  key('g', { code: 'KeyG', metaKey: true });
  const g = N(A.sel[0]);
  ok(g?.type === 'group' && g.children.length === 2 && g.parent === fr.id, 'группа из двух');
  ok(g.x === 50 && g.y === 50, `рамка группы по детям: ${g.x},${g.y} ${g.w}×${g.h}`);
  key('g', { code: 'KeyG', metaKey: true, shiftKey: true });
  ok(!N(g.id) && N(r1.id).parent === fr.id, 'разгруппировка');

  // авто-раскладка на фрейме
  A.sel = [fr.id]; A.emit('select');
  key('A', { code: 'KeyA', shiftKey: true });
  ok(!!N(fr.id).layout, 'Shift+A — авто-раскладка');
  ok(N(fr.id).layout.dir === 'row', 'направление угадано: ряд');
  ok(N(r1.id).x === N(fr.id).layout.pad[3], 'первый слой у левого отступа');

  // компонент и экземпляр
  A.sel = [r1.id]; A.emit('select');
  key('k', { code: 'KeyK', metaKey: true, altKey: true });
  const comp = N(A.sel[0]);
  ok(comp?.type === 'component', 'создан компонент');
  const before = Object.keys(A.doc.nodes).length;
  (await import('/js/app.js')).placeInstance(comp.id, { x: 700, y: 200 });
  const inst = N(A.sel[0]);
  ok(inst?.type === 'instance' && inst.main === comp.id && inst.children.length === comp.children.length, 'экземпляр размещён');
  N(comp.children[0]).fills = [M.solid('#ff0000')]; commit();
  ok(N(inst.children[0]).fills[0].color === '#ff0000', 'правка главного дошла до экземпляра');

  // текст
  key('t'); ev('pointerdown', 600, 600); ev('pointerup', 600, 600); await frame();
  const ta = document.querySelector('.text-edit');
  ok(!!ta, 'появилось поле ввода текста');
  ta.value = 'Привет, Холст'; ta.dispatchEvent(new Event('input')); ta.blur(); await frame();
  const tn = Object.values(A.doc.nodes).find(n => n.type === 'text' && n.text === 'Привет, Холст');
  ok(tn && tn.w > 50 && tn.name === 'Привет, Холст', `текст создан и измерен: w=${tn?.w}`);

  // перо: треугольник
  key('p');
  for (const [x, y] of [[700, 500], [800, 500], [750, 420]]) { ev('pointerdown', x, y); ev('pointerup', x, y); }
  ev('pointerdown', 700, 500); ev('pointerup', 700, 500); await frame();
  const tri = N(A.sel[0]);
  ok(tri?.type === 'path' && tri.closed && tri.pts.length === 3 && tri.w === 100 && tri.h === 80, `перо: замкнутый контур ${tri?.w}×${tri?.h}`);

  // булева операция
  key('r'); await dragS(900, 100, 1000, 200);
  const ra = A.sel[0];
  key('o'); await dragS(950, 150, 1050, 250);
  const ob = A.sel[0];
  A.sel = [ra, ob]; A.emit('select');
  (await import('/js/app.js')).boolSel('subtract');
  const bo = N(A.sel[0]);
  ok(bo?.type === 'bool' && bo.op === 'subtract' && bo.w === 150, 'вычитание создано');

  // экспорт
  const io = await import('/js/io.js');
  const svg = io.toSVG(A.doc, [fr.id, bo.id]);
  ok(svg.startsWith('<svg') && svg.includes('mask'), 'SVG собран (с маской вычитания)');
  const doc2 = new DOMParser().parseFromString(svg, 'image/svg+xml');
  ok(!doc2.querySelector('parsererror'), 'SVG корректный XML');
  const css = io.nodeCSS(A.doc, N(fr.id));
  ok(css.includes('display: flex'), 'CSS фрейма с flex');
  const rt = (await import('/js/render.js')).renderToCanvas(A.doc, [fr.id], 2, { M });
  ok(rt.canvas.width === Math.ceil(N(fr.id).w * 2), 'PNG-рендер нужного размера');

  // импорт SVG
  const ids = io.importSVGText('<svg viewBox="0 0 100 50" width="100" height="50"><rect x="10" y="10" width="30" height="20" rx="4" fill="#f00"/><circle cx="70" cy="25" r="15" fill="blue"/><path d="M0 0 Q 50 50 100 0" stroke="black" fill="none"/></svg>', { x: 0, y: 600 });
  const sv = N(ids[0]);
  ok(sv?.children.length === 3, `импорт SVG: ${sv?.children.length} слоя`);

  // копировать/вставить
  A.sel = [tri.id]; A.emit('select');
  const app = await import('/js/app.js');
  const data = app.copySel(); A.sel = []; app.pasteData(data);
  ok(A.sel.length === 1 && A.sel[0] !== tri.id && N(A.sel[0]).type === 'path', 'копировать/вставить');

  // прототип
  N(A.sel[0]).link = null;
  const f2 = M.mk('frame', { x: 0, y: 1000, w: 200, h: 200, name: 'Экран 2' }); M.insert(A.doc, f2, A.page);
  N(r1.id).link = { to: f2.id, tr: 'dissolve', dur: 100 }; commit();
  A.sel = [fr.id]; A.emit('select');
  (await import('/js/proto.js')).present();
  await wait(150);
  ok(!!document.querySelector('.present'), 'открылся показ');
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await wait(50);
  ok(!document.querySelector('.present'), 'показ закрыт по Esc');

  // удаление
  A.sel = [f2.id]; A.emit('select'); key('Backspace', { code: 'Backspace' });
  ok(!N(f2.id), 'удаление');

  return { ok: log.length, fail, log };
}
