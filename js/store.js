// Хранилище файлов в браузере (IndexedDB): список документов, автосохранение.
const DB = 'holst', ST = 'docs';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(ST, mode), s = t.objectStore(ST);
    const r = fn(s);
    t.oncomplete = () => res(r?.result); t.onerror = () => rej(t.error);
  });
}
export const listDocs = async () => (await tx('readonly', s => s.getAll()) || []).map(({ id, name, updated, thumb }) => ({ id, name, updated, thumb })).sort((a, b) => b.updated - a.updated);
export const getDoc = async id => (await tx('readonly', s => s.get(id)))?.data;
export const putDoc = (doc, thumb) => tx('readwrite', s => s.put({ id: doc.id, name: doc.name, updated: Date.now(), data: JSON.stringify(doc), thumb }));
export const delDoc = id => tx('readwrite', s => s.delete(id));
