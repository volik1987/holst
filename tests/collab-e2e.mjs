// Сквозной тест совместной работы: две вкладки headless Chrome, настоящий PeerJS + WebRTC.
// node tests/collab-e2e.mjs http://localhost:8812
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:8812';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function browser() {
  const PORT = 9300 + (Math.random() * 500 | 0);
  const proc = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'holst-'))}`, '--no-first-run', '--disable-features=WebRtcHideLocalIpsWithMdns', '--window-size=1300,850', 'about:blank'], { stdio: 'ignore' });
  const json = async (path, method = 'GET') => { for (let i = 0; i < 50; i++) { try { return await (await fetch(`http://127.0.0.1:${PORT}${path}`, { method })).json(); } catch { await sleep(200); } } throw new Error('нет CDP'); };
  return {
    proc,
    async open(url) {
      const t = await json('/json/new?' + encodeURIComponent(url), 'PUT');
      const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
      let id = 0; const pend = {};
      ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } };
      const send = (method, params = {}) => new Promise(r => { pend[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
      const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400)); return r.result.result.value; };
      return { ev, close: () => ws.close() };
    },
  };
}
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(250); } return null; };
const b1 = browser(), b2 = browser();
let ok = true;
const check = (c, m) => { console.log((c ? '✔ ' : '✘ ') + m); if (!c) ok = false; };
try {
  const host = await b1.open(BASE + '/');
  await until(() => host.ev('!!window.__holst?.A?.doc'));
  await host.ev(`(()=>{const H=__holst; H.A.emit('newfile'); H.collab.host(); return 1})()`);
  const code = await until(() => host.ev('__holst.collab.code'));
  check(!!code, 'хост открыл комнату ' + code);
  const guest = await b2.open(BASE + '/?room=' + code);
  const joined = await until(() => host.ev('__holst.collab.connected'), 20000);
  check(joined === 1, 'гость подключился по WebRTC');
  await until(() => guest.ev(`__holst.A.doc && Object.keys(__holst.A.doc.nodes).length === 2`));
  // хост рисует
  const rid = await host.ev(`(()=>{const {A,M,commit}=__holst; const r=M.mk('rect',{x:10,y:20,w:50,h:40}); M.insert(A.doc,r,A.page); commit(); return r.id})()`);
  check(!!await until(() => guest.ev(`!!__holst.A.doc.nodes['${rid}']`)), 'прямоугольник хоста появился у гостя');
  // гость двигает
  await guest.ev(`(()=>{const {A,M,commit}=__holst; const n=A.doc.nodes['${rid}']; M.setProp(A.doc,n,'x',123); commit(); return 1})()`);
  check(!!await until(() => host.ev(`__holst.A.doc.nodes['${rid}']?.x === 123`)), 'правка гостя дошла до хоста');
  // компонент + экземпляр у хоста → у гостя собран экземпляр
  await host.ev(`(()=>{const {A,M,commit}=__holst; const c=M.mk('component',{x:300,y:0,w:80,h:30}); M.insert(A.doc,c,A.page); M.insert(A.doc,M.mk('text',{text:'ok'}),c.id); M.makeInstance(A.doc,c.id,A.page,300,100); commit(); return 1})()`);
  check(!!await until(() => guest.ev(`Object.values(__holst.A.doc.nodes).some(n=>n.type==='instance'&&n.children.length===1)`)), 'экземпляр компонента собрался у гостя');
  // удаление у гостя
  await guest.ev(`(()=>{const {A,M,commit}=__holst; M.remove(A.doc,'${rid}'); commit(); return 1})()`);
  check(!!await until(() => host.ev(`!__holst.A.doc.nodes['${rid}']`)), 'удаление гостя дошло до хоста');
  // курсор
  await guest.ev(`(()=>{__holst.collab.cursor({x:50,y:60}); return 1})()`);
  check(!!await until(() => host.ev(`document.querySelectorAll('#peers .avatar').length >= 2`)), 'хост видит аватар гостя');
  const same = await host.ev(`JSON.stringify(Object.keys(__holst.A.doc.nodes).sort())`) === await guest.ev(`JSON.stringify(Object.keys(__holst.A.doc.nodes).sort())`);
  check(same, 'деревья узлов совпадают');
} catch (e) { console.log('ошибка', e.message); ok = false; }
console.log(ok ? 'ИТОГ: OK' : 'ИТОГ: ПРОБЛЕМА');
b1.proc.kill(); b2.proc.kill();
process.exit(ok ? 0 : 1);
