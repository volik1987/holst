// Совместная работа без своего сервера: WebRTC через PeerJS (публичный брокер только для знакомства).
// Схема «звезда»: хост держит эталон, рассылает изменения; гости шлют свои правки хосту.
import * as M from './model.js';
import { A, N, redraw, toast } from './app.js';
import { peersView } from './canvas.js';
import { h, modal } from './dom.js';

const PREFIX = 'holst-v1-';
const PEER_OPTS = { debug: 1, config: { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
const COLORS = ['#f24822', '#14ae5c', '#9747ff', '#ff8a00', '#0d99ff', '#ff24bd', '#00b5a3'];
const S = { peer: null, role: null, code: null, conns: new Map(), sent: {}, me: null, peers: new Map(), applying: false };

function loadPeer() {
  if (window.Peer) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
    s.onload = res; s.onerror = () => rej(new Error('Не загрузилась сетевая библиотека — нужен интернет'));
    document.head.append(s);
  });
}
function myInfo() {
  let name = localStorage.getItem('holst-name');
  if (!name) { name = 'Гость ' + Math.floor(Math.random() * 90 + 10); localStorage.setItem('holst-name', name); }
  let color = localStorage.getItem('holst-color');
  if (!color) { color = COLORS[Math.floor(Math.random() * COLORS.length)]; localStorage.setItem('holst-color', color); }
  return { name, color };
}
const ERR = { 'peer-unavailable': 'Комната не найдена — проверьте код', network: 'Нет связи с сервером знакомства', 'server-error': 'Сервер знакомства недоступен', 'unavailable-id': 'Код занят, попробуйте ещё раз', 'browser-incompatible': 'Браузер не поддерживает WebRTC' };

export const collab = {
  get active() { return !!S.role; },
  get code() { return S.peer?.open ? S.code : null; },
  get connected() { return [...S.conns.values()].filter(c => c.open).length; },
  host,
  openDialog() {
    if (S.role) return statusDialog();
    const info = myInfo();
    const nameInp = h('input', { class: 'inp', value: info.name, onchange: e => localStorage.setItem('holst-name', e.target.value || info.name) });
    const codeInp = h('input', { class: 'inp', placeholder: 'Код комнаты, 6 цифр', inputmode: 'numeric', maxlength: 6 });
    const m = modal('Совместная работа', h('div', { class: 'collab' },
      h('p', { class: 'muted' }, 'Работайте над файлом вдвоём-втроём в реальном времени. Данные идут напрямую между браузерами (WebRTC), без сервера.'),
      h('label', { class: 'mini' }, 'Ваше имя', nameInp),
      h('div', { class: 'collab-cols' },
        h('div', null, h('b', null, 'Пригласить'), h('p', { class: 'muted small' }, 'Откроется комната с этим файлом, вы получите ссылку.'),
          h('button', { class: 'btn', onclick: () => { m.close(); host(); } }, 'Создать комнату')),
        h('div', null, h('b', null, 'Присоединиться'), codeInp,
          h('button', { class: 'btn ghost', onclick: () => { const c = codeInp.value.replace(/\D/g, ''); if (c.length === 6) { m.close(); join(c); } else toast('Нужен код из 6 цифр'); } }, 'Войти'))),
      h('p', { class: 'muted small' }, 'Работает, когда оба устройства в интернете; при строгом NAT (мобильная сеть) соединение может не установиться — тогда попробуйте одну Wi-Fi-сеть.')));
  },
  join,
  onCommit() {
    if (!S.role || S.applying) return;
    const ops = makeOps();
    if (ops) broadcast({ t: 'ops', ops });
  },
  cursor(p) {
    if (!S.role) return;
    const now = performance.now();
    if (now - (S.lastCur || 0) < 50) return;
    S.lastCur = now;
    broadcast({ t: 'cur', id: S.me, x: p.x, y: p.y, page: A.page, sel: A.sel, ...myInfo() });
  },
  leave,
};

function makeOps() {
  const d = M.diff(S.sent, A.doc);
  S.sent = d.map;
  const imgs = {};
  for (const id in d.set) for (const f of [...(d.set[id].fills || []), ...(d.set[id].strokes || [])]) if (f.img && !S.imgSent?.has(f.img)) { imgs[f.img] = A.doc.images[f.img]; (S.imgSent ||= new Set()).add(f.img); }
  const meta = M.metaOf(A.doc), ms = JSON.stringify(meta);
  const metaChanged = ms !== S.metaSent; S.metaSent = ms;
  if (!Object.keys(d.set).length && !d.del.length && !metaChanged) return null;
  return { set: d.set, del: d.del, meta: metaChanged ? meta : undefined, imgs };
}
function applyRemote(ops) {
  S.applying = true;
  M.applyOps(A.doc, ops);
  M.normalize(A.doc);
  S.sent = M.nodeMap(A.doc); S.metaSent = JSON.stringify(M.metaOf(A.doc));
  for (const k in ops.imgs || {}) (S.imgSent ||= new Set()).add(k);
  A.hist.rebase();
  A.sel = A.sel.filter(id => A.doc.nodes[id]);
  if (!A.doc.nodes[A.page]) A.page = A.doc.nodes.root.children[0];
  A.emit('change'); A.emit('docname'); redraw();
  A.emit('remote');
  S.applying = false;
}
function broadcast(msg, except) { for (const [id, c] of S.conns) if (id !== except && c.open) try { c.send(msg); } catch { } }

async function host() {
  try { await loadPeer(); } catch (e) { toast(e.message, 4000); return; }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const peer = new Peer(PREFIX + code, PEER_OPTS);
  S.peer = peer; S.role = 'host'; S.code = code; S.me = 'host';
  peer.on('open', () => { S.sent = M.nodeMap(A.doc); S.metaSent = JSON.stringify(M.metaOf(A.doc)); S.imgSent = new Set(Object.keys(A.doc.images)); updateBadge(); statusDialog(); });
  peer.on('connection', c => {
    c.on('open', () => {
      S.conns.set(c.peer, c);
      c.send({ t: 'full', doc: JSON.parse(JSON.stringify(A.doc)), page: A.page });
      updateBadge();
    });
    c.on('data', msg => onMsg(msg, c));
    c.on('close', () => dropPeer(c.peer));
    c.on('error', () => dropPeer(c.peer));
  });
  peer.on('error', e => { toast(ERR[e.type] || 'Ошибка связи: ' + e.type, 4000); if (e.type === 'unavailable-id') { leave(); host(); } });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch { } });
}
async function join(code) {
  try { await loadPeer(); } catch (e) { toast(e.message, 4000); return; }
  const peer = new Peer(PEER_OPTS);
  S.peer = peer; S.role = 'guest'; S.code = code;
  toast('Подключаюсь к комнате ' + code + '…', 5000);
  peer.on('open', id => {
    S.me = id;
    const c = peer.connect(PREFIX + code, { reliable: true });
    c.on('open', () => { S.conns.set('host', c); c.send({ t: 'hello', ...myInfo() }); updateBadge(); });
    c.on('data', msg => onMsg(msg, c));
    c.on('close', () => { toast('Хост закрыл комнату', 4000); leave(); });
  });
  peer.on('error', e => { toast(ERR[e.type] || 'Ошибка связи: ' + e.type, 5000); leave(); });
}
function onMsg(msg, c) {
  if (!msg || typeof msg !== 'object') return;
  switch (msg.t) {
    case 'full': {
      const d = msg.doc; d.images ||= {};
      A.emit('loadShared', d);
      S.sent = M.nodeMap(A.doc); S.metaSent = JSON.stringify(M.metaOf(A.doc)); S.imgSent = new Set(Object.keys(A.doc.images));
      if (msg.page && A.doc.nodes[msg.page]) { A.page = msg.page; A.emit('page'); }
      toast('Вы в комнате ' + S.code + ' — изменения видны всем');
      updateBadge();
      break;
    }
    case 'ops':
      applyRemote(msg.ops);
      if (S.role === 'host') broadcast(msg, c.peer);
      break;
    case 'cur': {
      const id = S.role === 'host' ? c.peer : msg.id;
      if (id === S.me) break;
      S.peers.set(id, { ...msg, id });
      peersView.list = [...S.peers.values()];
      if (S.role === 'host') broadcast({ ...msg, id: c.peer }, c.peer);
      updateBadge(); redraw();
      break;
    }
    case 'hello': S.peers.set(c.peer, { id: c.peer, name: msg.name, color: msg.color }); peersView.list = [...S.peers.values()]; updateBadge(); toast(msg.name + ' присоединился'); break;
    case 'bye': S.peers.delete(msg.id); peersView.list = [...S.peers.values()]; updateBadge(); redraw(); break;
  }
}
function dropPeer(id) {
  S.conns.delete(id);
  const p = S.peers.get(id);
  S.peers.delete(id); peersView.list = [...S.peers.values()];
  if (S.role === 'host') broadcast({ t: 'bye', id });
  if (p) toast((p.name || 'Участник') + ' вышел');
  updateBadge(); redraw();
}
function leave() {
  try { S.peer?.destroy(); } catch { }
  Object.assign(S, { peer: null, role: null, code: null, conns: new Map(), peers: new Map() });
  peersView.list = [];
  updateBadge(); redraw();
}
function link() { return location.origin + location.pathname + '?room=' + S.code; }
function statusDialog() {
  const items = [...S.peers.values()];
  const m = modal('Совместная работа', h('div', { class: 'collab' },
    S.role === 'host' ? h('div', null,
      h('p', null, 'Комната открыта. Отправьте ссылку или код:'),
      h('div', { class: 'room-code' }, S.code),
      h('div', { class: 'row' }, h('input', { class: 'inp grow', readonly: true, value: link(), onclick: e => e.target.select() }),
        h('button', { class: 'btn', onclick: () => { navigator.clipboard?.writeText(link()); toast('Ссылка скопирована'); } }, 'Копировать')),
      h('p', { class: 'muted small' }, 'Не закрывайте эту вкладку: пока она открыта, комната работает.'))
      : h('p', null, 'Вы в комнате ', h('b', null, S.code), '.'),
    h('div', { class: 'peer-list' }, h('b', null, 'Участники'),
      h('div', { class: 'peer-row' }, h('span', { class: 'dot', style: `background:${myInfo().color}` }), myInfo().name + ' (вы)'),
      ...items.map(p => h('div', { class: 'peer-row' }, h('span', { class: 'dot', style: `background:${p.color}` }), p.name || 'Участник'))),
    h('button', { class: 'btn ghost', onclick: () => { leave(); m.close(); toast('Вы вышли из комнаты'); } }, 'Выйти из комнаты')));
}
function updateBadge() {
  const el = document.getElementById('peers'); if (!el) return;
  el.innerHTML = '';
  if (!S.role) return;
  const me = myInfo();
  el.append(h('span', { class: 'avatar', style: `background:${me.color}`, title: me.name + ' (вы)' }, me.name[0]));
  for (const p of S.peers.values()) el.append(h('span', { class: 'avatar', style: `background:${p.color}`, title: p.name }, (p.name || '?')[0]));
  el.append(h('span', { class: 'room-badge', title: 'Код комнаты' }, '#' + S.code));
}
