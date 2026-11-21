// db.js — persistence (IndexedDB) + cross-window sync (BroadcastChannel) + import/export
// Assets (image blobs) and the project document (pages + layouts) share one DB so that
// every browser window/tab reads the same latest data.

const DB_NAME = 'portfolio-studio';
const DB_VERSION = 1;
const STORE_ASSETS = 'assets';
const STORE_META = 'meta';
const PROJECT_KEY = 'project';

let _db = null;
const channel = ('BroadcastChannel' in self) ? new BroadcastChannel('portfolio-studio-sync') : null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ASSETS)) db.createObjectStore(STORE_ASSETS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}
function p(req) {
  return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });
}

export const DB = {
  async loadProject() {
    const s = await tx(STORE_META, 'readonly');
    return p(s.get(PROJECT_KEY));
  },
  async saveProject(project) {
    const s = await tx(STORE_META, 'readwrite');
    await p(s.put(project, PROJECT_KEY));
  },
  async putAsset(asset) {
    const s = await tx(STORE_ASSETS, 'readwrite');
    await p(s.put(asset));
  },
  async getAllAssets() {
    const s = await tx(STORE_ASSETS, 'readonly');
    return p(s.getAll());
  },
  async deleteAsset(id) {
    const s = await tx(STORE_ASSETS, 'readwrite');
    await p(s.delete(id));
  },

  broadcast(type) { if (channel) channel.postMessage({ type, at: Date.now() }); },
  onSync(cb) { if (channel) channel.onmessage = (e) => cb(e.data?.type || 'all'); },

  // ---- import / export (single JSON file with embedded images) ----
  async exportProject(project) {
    const assets = await this.getAllAssets();
    const out = { kind: 'portfolio-studio', version: 1, exportedAt: new Date().toISOString(), project, assets: [] };
    for (const a of assets) {
      out.assets.push({
        id: a.id, name: a.name, type: a.type, width: a.width, height: a.height,
        data: await blobToDataURL(a.blob),
      });
    }
    return JSON.stringify(out);
  },
  async importProject(text) {
    const data = JSON.parse(text);
    if (data.kind !== 'portfolio-studio') throw new Error('不是有效的 Portfolio Studio 项目文件');
    const db = await open();
    await new Promise((res, rej) => {
      const t = db.transaction([STORE_ASSETS, STORE_META], 'readwrite');
      const aStore = t.objectStore(STORE_ASSETS);
      for (const a of (data.assets || [])) {
        aStore.put({ id: a.id, name: a.name, type: a.type, width: a.width, height: a.height, blob: dataURLtoBlob(a.data) });
      }
      t.objectStore(STORE_META).put(data.project, PROJECT_KEY);
      t.oncomplete = res; t.onerror = () => rej(t.error);
    });
    return data.project;
  },
};

export function blobToDataURL(blob) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
export function dataURLtoBlob(dataurl) {
  const [head, body] = dataurl.split(',');
  const mime = (head.match(/:(.*?);/) || [, 'image/png'])[1];
  const bin = atob(body);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type: mime });
}
