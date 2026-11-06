// Тесты импорта из Figma: образцы .fig, буфер обмена, JSON REST API.
//   node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../js/model.js';
import * as FC from '../js/figma-conv.js';
import * as kiwi from '../vendor/kiwi.js';
import * as fflate from '../vendor/fflate.js';
import * as fzstd from '../vendor/fzstd.js';

const FX = new URL('./fixtures/figma/', import.meta.url);
const libs = { kiwi, fflate, fzstd };
function load(name) {
  let u8 = new Uint8Array(fs.readFileSync(new URL(name, FX)));
  if (name.endsWith('.html')) u8 = FC.clipboardBytes(Buffer.from(u8).toString());
  return FC.fromKiwi(FC.decodeFig(u8, libs).msg);
}
function toDoc({ pages }, images) {
  const doc = M.newDoc('t'); M.remove(doc, doc.nodes.root.children[0]);
  const ctx = FC.makeCtx(images);
  for (const p of pages) for (const F of p.kids) FC.preassign(ctx, F);
  for (const p of pages) { if (!p.kids.length) continue; const pg = M.addPage(doc, p.name); for (const F of p.kids) FC.build(doc, F, pg.id, ctx); }
  FC.finishInstances(doc, ctx);
  return { doc, ctx };
}
const pageNamed = (doc, name) => Object.values(doc.nodes).find(n => n.type === 'page' && n.name === name);
const kidsOf = (doc, id) => doc.nodes[id].children.map(c => doc.nodes[c]);
const byName = (doc, name) => Object.values(doc.nodes).filter(n => n.name === name);

test('.fig: страницы, фрейм, группа и прямоугольники', () => {
  const { doc } = toDoc(load('frame.fig'));
  const pages = doc.nodes.root.children.map(id => doc.nodes[id].name);
  assert.deepEqual(pages, ['page-with-frame', 'page-with-frame-with-clip', 'page-with-group']);
  const [fr] = kidsOf(doc, pageNamed(doc, 'page-with-frame').id);
  assert.equal(fr.type, 'frame'); assert.equal(fr.w, 320); assert.equal(fr.clip, false);
  assert.deepEqual(kidsOf(doc, fr.id).map(r => [r.type, r.x, r.fills[0].color]), [['rect', 0, '#ff0000'], ['rect', 110, '#00ff00'], ['rect', 220, '#0000ff']]);
  assert.equal(kidsOf(doc, pageNamed(doc, 'page-with-frame-with-clip').id)[0].clip, true);
  const [g] = kidsOf(doc, pageNamed(doc, 'page-with-group').id);
  assert.equal(g.type, 'group'); assert.equal(g.children.length, 3);
});

test('.fig: компоненты, экземпляры и их переопределения', () => {
  const { doc } = toDoc(load('components.fig'));
  const insts = kidsOf(doc, pageNamed(doc, 'instances-with-overrides').id);
  assert.equal(insts.length, 4);
  for (const i of insts) {
    assert.equal(i.type, 'instance');
    assert.equal(doc.nodes[i.main].type, 'component');
    assert.equal(i.fills[0].a, 0.5, 'прозрачность заливки переопределена');
    assert.equal(i.strokes.length, 1);
  }
});

test('.fig: вложенные экземпляры и свойства-тексты', () => {
  const { doc } = toDoc(load('slots.fig'));
  const placed = byName(doc, 'placed')[0];
  assert.equal(placed.type, 'instance');
  const texts = [];
  M.walk(doc, placed.id, n => { if (n.type === 'text') texts.push(n.text); });
  assert.deepEqual(texts, ['OUTER']);
  const direct = byName(doc, 'direct')[0], t2 = [];
  M.walk(doc, direct.id, n => { if (n.type === 'text') t2.push(n.text); });
  assert.deepEqual(t2, ['INNER']);
  const card = byName(doc, 'Card empty slot')[0];
  assert.equal(card.layout.dir, 'col'); assert.equal(card.layout.gap, 8); assert.deepEqual(card.layout.pad, [16, 16, 16, 16]);
});

test('.fig: вектор из сети точек — открытая кривая', () => {
  const { doc } = toDoc(load('vector.fig'));
  const v = byName(doc, 'vector-3-scurve')[0];
  assert.equal(v.type, 'path'); assert.equal(v.closed, false); assert.equal(v.pts.length, 3);
  assert.ok(Math.abs(v.w - 92.5) < 0.6 && Math.abs(v.h - 75.7) < 0.6, `${v.w}×${v.h}`);
  assert.equal(v.strokes.length, 1);
});

test('.fig: обводка внутри/снаружи', () => {
  const { doc } = toDoc(load('stroke.fig'));
  assert.equal(byName(doc, 'inside-rect-vector-with-strokes')[0].salign, 'inside');
  assert.equal(byName(doc, 'outside-rect-vector-with-strokes')[0].salign, 'outside');
  assert.equal(byName(doc, 'center-rect-vector-with-strokes')[0].sw, 10);
});

test('буфер Figma: фрейм и экземпляр со служебным компонентом', () => {
  const a = toDoc(load('frame-with-r-g-b-rect.html')).doc;
  const fr = byName(a, 'frame')[0];
  assert.equal(fr.type, 'frame'); assert.equal(fr.children.length, 3);
  const r = load('component-component-instance-blue-with-overrides.html');
  assert.ok(r.pages.find(p => p.internal).kids.some(F => F.type === 'component'), 'компонент со служебной страницы');
  const b = toDoc(r).doc;
  const inst = Object.values(b.nodes).find(n => n.type === 'instance');
  assert.equal(b.nodes[inst.main].name, 'blue'); assert.equal(inst.fills[0].a, 0.5);
});

test('REST API: раскладка, текст, экземпляр с правкой, градиент, группа, поворот, картинка', () => {
  const file = JSON.parse(fs.readFileSync(new URL('rest-file.json', FX)));
  const r = FC.fromREST(file);
  assert.ok(r.images.has('ref:abc123'));
  const { doc } = toDoc(r, new Map([['ref:abc123', 'imgX']]));
  const page = doc.nodes[doc.nodes.root.children[0]];
  assert.equal(page.name, 'Page 1');
  const btn = byName(doc, 'Btn').find(n => n.type === 'component');
  assert.deepEqual([btn.layout.dir, btn.layout.gap, btn.layout.main, btn.layout.cross, btn.layout.hugW], ['row', 8, 'center', 'center', true]);
  assert.equal(btn.effects[0].type, 'shadow'); assert.equal(btn.effects[0].a, 0.2); assert.equal(btn.radius, 8);
  const lbl = doc.nodes[btn.children[0]];
  assert.deepEqual([lbl.text, lbl.font, lbl.weight, lbl.size, lbl.lh], ['Кнопка', 'Roboto', 600, 14, 0]);
  const inst = Object.values(doc.nodes).find(n => n.type === 'instance' && !M.isClone(n.id));
  assert.equal(inst.main, btn.id); assert.equal(inst.x, 200);
  const it = doc.nodes[inst.children[0]];
  assert.equal(it.text, 'Купить', 'текст экземпляра переопределён');
  assert.equal(it.fills[0].color, '#ffff00');
  const ov = Object.values(inst.overrides).find(o => o.text);
  assert.equal(ov.text, 'Купить');
  const scr = byName(doc, 'Экран')[0];
  assert.equal(scr.fills[0].type, 'linear'); assert.equal(scr.fills[0].angle, 90);
  const g = byName(doc, 'Группа')[0], sq = byName(doc, 'Квадрат')[0];
  assert.deepEqual([g.x, g.y, sq.x, sq.y], [60, 70, 0, 0], 'координаты в группе считаются от фрейма');
  assert.deepEqual(sq.cons, { h: 'right', v: 'stretch' });
  const line = byName(doc, 'Черта')[0];
  assert.equal(line.type, 'path'); assert.equal(line.fills[0].color, '#000000'); assert.equal(line.strokes.length, 0);
  const ov2 = byName(doc, 'Овал')[0];
  assert.equal(ov2.rot, 30); assert.equal(ov2.fills[0].type, 'image'); assert.equal(ov2.fills[0].img, 'imgX');
  assert.ok(Math.abs(ov2.w - 40) < 1e-6);
});

test('разбор ссылок Figma', () => {
  assert.deepEqual(FC.parseFigmaLink('https://www.figma.com/design/AbC123/Name?node-id=12-34&t=x'), { key: 'AbC123', node: '12:34' });
  assert.deepEqual(FC.parseFigmaLink('https://figma.com/file/KEY9/x'), { key: 'KEY9', node: null });
  assert.deepEqual(FC.parseFigmaLink('https://www.figma.com/design/MAIN/branch/BR1/Name?node-id=0-1'), { key: 'BR1', node: null });
  assert.equal(FC.parseFigmaLink('https://example.com/'), null);
});

test('вектор с цветными областями (сеть точек из буфера)', () => {
  const { doc } = toDoc(load('vector-region-fills.html'));
  const g = byName(doc, 'Regions')[0];
  assert.equal(g.type, 'group');
  const areas = kidsOf(doc, g.id).filter(n => n.name === 'Область');
  assert.deepEqual(areas.map(a => a.fills[0].color), ['#ff0000', '#808080'], 'область без заливки пропущена');
  assert.ok(areas.every(a => a.closed && a.pts.length === 4));
  assert.ok(kidsOf(doc, g.id).some(n => n.name === 'Обводка'));
});
