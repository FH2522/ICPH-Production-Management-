// Local-demo image store: IndexedDB (not localStorage) holds image Blobs.
const NAME = 'icph-hcs-demo-photos';
const TABLE = 'images';
let openPromise;
function openDB() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('This browser does not support IndexedDB.'));
  if (!openPromise) openPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(TABLE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
  return openPromise;
}
export async function storeDemoPhoto(id, file) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TABLE, 'readwrite');
    tx.objectStore(TABLE).put(file, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function loadDemoPhoto(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(TABLE, 'readonly').objectStore(TABLE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
