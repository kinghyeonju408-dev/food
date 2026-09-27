// 저장소: 소리 클립은 IndexedDB, 나머지 작은 기록은 localStorage.
// 브라우저 저장소는 지워질 수 있으므로 실험 데이터는 반드시 CSV로 내보내 보관한다.
(function (root) {
  'use strict';

  const LS_PREFIX = 'bionexus.';

  function load(key, fallback) {
    try {
      const v = localStorage.getItem(LS_PREFIX + key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  let dbPromise = null;
  const memory = new Map();

  function db() {
    if (!dbPromise) {
      dbPromise = new Promise(resolve => {
        try {
          const req = indexedDB.open('bionexus', 1);
          req.onupgradeneeded = () => req.result.createObjectStore('clips', { keyPath: 'id' });
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
    }
    return dbPromise;
  }

  const unwrap = r => (r && typeof r === 'object' && 'result' in r ? r.result : r);

  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      if (!d) { resolve(unwrap(fn(null))); return; }
      const t = d.transaction('clips', mode);
      const r = fn(t.objectStore('clips'));
      t.oncomplete = () => resolve(unwrap(r));
      t.onerror = () => reject(t.error);
    }));
  }

  const Clips = {
    add(clip) {
      clip.id = clip.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
      return tx('readwrite', s => { if (!s) { memory.set(clip.id, clip); return clip.id; } s.put(clip); return clip.id; })
        .then(() => clip.id);
    },
    list() {
      return tx('readonly', s => s ? s.getAll() : { result: Array.from(memory.values()) });
    },
    remove(id) {
      return tx('readwrite', s => { if (!s) memory.delete(id); else s.delete(id); });
    },
  };

  root.BNStore = { load, save, Clips };
})(typeof self !== 'undefined' ? self : this);
