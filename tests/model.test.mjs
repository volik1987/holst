// node --test tests/  — проверки модели без браузера
import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/model.js';
import { ap } from '../js/geom.js';

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);
function setup() { const d = M.newDoc(); return { d, page: d.nodes.root.children[0] }; }

test('авто-раскладка: ряд по содержимому, промежутки и отступы', () => {
  const { d, page } = setup();
  const f = M.insert(d, M.mk('frame', { layout: { ...M.defaultLayout('row'), gap: 10, pad: [5, 6, 7, 8] } }), page);
  M.insert(d, M.mk('rect', { w: 50, h: 20 }), f.id);
  M.insert(d, M.mk('rect', { w: 30, h: 40 }), f.id);
  M.normalize(d);
  assert.equal(f.w, 8 + 50 + 10 + 30 + 6);
  assert.equal(f.h, 5 + 40 + 7);
  const [a, b] = f.children.map(id => d.nodes[id]);
  assert.equal(a.x, 8); assert.equal(b.x, 68); assert.equal(a.y, 5);
});

test('авто-раскладка: заполнение, растяжение, «равномерно»', () => {
  const { d, page } = setup();
  const f = M.insert(d, M.mk('frame', { w: 300, h: 100, layout: { ...M.defaultLayout('row'), hugW: false, hugH: false, gap: 0, pad: [0, 0, 0, 0] } }), page);
  const a = M.insert(d, M.mk('rect', { w: 100, h: 20 }), f.id);
  const b = M.insert(d, M.mk('rect', { w: 10, h: 20, grow: true, stretch: true }), f.id);
  M.normalize(d);
  assert.equal(b.w, 200); assert.equal(b.h, 100); assert.equal(b.x, 100);
  b.grow = false; b.w = 50; f.layout.main = 'between';
  M.normalize(d);
  assert.equal(a.x, 0); assert.equal(b.x, 250);
});

test('вложенная раскладка: «заполнить» побеждает «по содержимому»', () => {
  const { d, page } = setup();
  const outer = M.insert(d, M.mk('frame', { w: 400, layout: { ...M.defaultLayout('col'), hugW: false, pad: [0, 0, 0, 0] } }), page);
  const inner = M.insert(d, M.mk('frame', { stretch: true, layout: { ...M.defaultLayout('row'), hugW: true } }), outer.id);
  M.insert(d, M.mk('rect', { w: 20, h: 20 }), inner.id);
  M.normalize(d);
  assert.equal(inner.w, 400);
});

test('текст: перенос по ширине и авто-высота', () => {
  const { d, page } = setup();
  const t = M.insert(d, M.mk('text', { text: 'один два три четыре', size: 10, auto: 'height', w: 40 }), page);
  M.normalize(d);
  assert.ok(M.textLines(t).length >= 3);
  assert.equal(t.h, M.textLines(t).length * 12);
});

test('ограничения при изменении рамки', () => {
  const { d, page } = setup();
  const f = M.insert(d, M.mk('frame', { w: 200, h: 100 }), page);
  const r = M.insert(d, M.mk('rect', { x: 150, y: 10, w: 40, h: 20, cons: { h: 'right', v: 'top' } }), f.id);
  const s = M.insert(d, M.mk('rect', { x: 10, y: 10, w: 180, h: 20, cons: { h: 'stretch', v: 'bottom' } }), f.id);
  M.resizeNode(d, f, 300, 150);
  assert.equal(r.x, 250); assert.equal(s.w, 280); assert.equal(s.y, 60);
});

test('компонент → экземпляр: синхронизация и переопределения', () => {
  const { d, page } = setup();
  const c = M.insert(d, M.mk('component', { w: 100, h: 40, fills: [M.solid('#ff0000')] }), page);
  const t = M.insert(d, M.mk('text', { text: 'Кнопка' }), c.id);
  const inst = M.makeInstance(d, c.id, page, 200, 0);
  const cl = d.nodes[inst.id + ':' + t.id];
  assert.equal(cl.text, 'Кнопка');
  M.setProp(d, cl, 'text', 'Купить');
  c.fills = [M.solid('#00ff00')];
  t.size = 30;
  M.normalize(d);
  const cl2 = d.nodes[inst.id + ':' + t.id];
  assert.equal(cl2.text, 'Купить', 'переопределение сохранилось');
  assert.equal(cl2.size, 30, 'изменение главного дошло');
  assert.equal(inst.fills[0].color, '#00ff00');
  M.setProp(d, inst, 'fills', [M.solid('#0000ff')]);
  c.fills = [M.solid('#123456')];
  M.normalize(d);
  assert.equal(inst.fills[0].color, '#0000ff', 'своя заливка экземпляра');
});

test('вложенные экземпляры и отсоединение', () => {
  const { d, page } = setup();
  const btn = M.insert(d, M.mk('component', { w: 50, h: 20 }), page);
  const lbl = M.insert(d, M.mk('text', { text: 'ok' }), btn.id);
  const card = M.insert(d, M.mk('component', { w: 200, h: 100 }), page);
  const bi = M.makeInstance(d, btn.id, card.id, 10, 10);
  const ci = M.makeInstance(d, card.id, page, 300, 0);
  M.normalize(d);
  const deep = d.nodes[`${ci.id}:${bi.id}:${lbl.id}`];
  assert.ok(deep, 'глубокий клон есть');
  M.setProp(d, deep, 'text', 'Глубоко');
  lbl.text = 'новое';
  M.normalize(d);
  assert.equal(d.nodes[`${ci.id}:${bi.id}:${lbl.id}`].text, 'Глубоко');
  assert.equal(d.nodes[`${bi.id}:${lbl.id}`].text, 'новое');
  M.detachInstance(d, ci.id);
  M.normalize(d);
  assert.equal(d.nodes[ci.id].type, 'frame');
  assert.ok(Object.keys(d.nodes).every(id => !id.startsWith(ci.id + ':')));
});

test('группа подгоняет рамку под детей, перенос с сохранением положения', () => {
  const { d, page } = setup();
  const g = M.insert(d, M.mk('group'), page);
  M.insert(d, M.mk('rect', { x: 10, y: 20, w: 30, h: 30 }), g.id);
  M.insert(d, M.mk('rect', { x: 60, y: 0, w: 10, h: 10 }), g.id);
  M.normalize(d);
  assert.deepEqual([g.x, g.y, g.w, g.h], [10, 0, 60, 50]);
  const f = M.insert(d, M.mk('frame', { x: 100, y: 100, w: 200, h: 200, rot: 90 }), page);
  const r = M.insert(d, M.mk('rect', { x: 0, y: 0, w: 20, h: 10 }), page);
  const before = ap(M.worldM(d, r.id), 0, 0);
  M.reparent(d, r.id, f.id);
  const after = ap(M.worldM(d, r.id), 0, 0);
  near(before.x, after.x, 0.02); near(before.y, after.y, 0.02);
});

test('история: отмена и повтор', () => {
  const { d, page } = setup();
  const h = new M.History(d);
  const r = M.insert(d, M.mk('rect'), page); h.commit();
  r.x = 50; h.commit();
  h.undo(); assert.equal(d.nodes[r.id].x, 0);
  h.undo(); assert.equal(d.nodes[r.id], undefined);
  h.redo(); h.redo(); assert.equal(d.nodes[r.id].x, 50);
});

test('разница для сети: применение у другого участника', () => {
  const { d, page } = setup();
  const peer = JSON.parse(JSON.stringify(d));
  const base = M.nodeMap(d);
  const c = M.insert(d, M.mk('component', { w: 80 }), page);
  M.insert(d, M.mk('text', { text: 'hi' }), c.id);
  M.makeInstance(d, c.id, page, 100, 0);
  M.normalize(d);
  const ops = M.diff(base, d);
  assert.ok(Object.keys(ops.set).every(id => !id.includes(':')), 'клоны не передаются');
  M.applyOps(peer, ops); M.normalize(peer);
  assert.equal(Object.keys(peer.nodes).length, Object.keys(d.nodes).length);
  // удаление
  const base2 = M.nodeMap(d);
  M.remove(d, c.id); M.normalize(d);
  const ops2 = M.diff(base2, d);
  M.applyOps(peer, ops2); M.normalize(peer);
  assert.equal(peer.nodes[c.id], undefined);
});

test('контур: подгонка рамки по точкам', () => {
  const n = M.mk('path', { x: 0, y: 0, pts: [{ x: 10, y: 10, ix: 10, iy: 10, ox: 10, oy: 10 }, { x: 60, y: 40, ix: 60, iy: 40, ox: 60, oy: 40 }] });
  M.normPath(n);
  assert.deepEqual([n.x, n.y, n.w, n.h], [10, 10, 50, 30]);
  assert.equal(n.pts[0].x, 0);
});
