/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Persistent workspaces / project tabs (IndexedDB) ─────────────────────────
// Each project tab keeps its model (binary STL in its original pose) and its
// working state (settings, rotation, mask) across tab closes and restarts.
// Keys:  'tabs' → { list: [{ id, name }], active }
//        'tab:<id>:model' → { name, bytes }   'tab:<id>:state' → { settings, poseRotation, mask }
// Every call fails soft: private windows or blocked storage just mean no restore.

const DB_NAME = 'bumpmesh-workspace';
const STORE = 'kv';

let _dbPromise = null;
function db() {
  if (!_dbPromise) {
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch((err) => { _dbPromise = null; throw err; });
  }
  return _dbPromise;
}

function tx(mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let result;
    const r = fn(store);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  }));
}
const get = (key) => tx('readonly', (s) => s.get(key));
const put = (key, value) => tx('readwrite', (s) => s.put(value, key));
const del = (key) => tx('readwrite', (s) => s.delete(key));

const newId = () => Math.random().toString(36).slice(2, 10);

/**
 * Load the tab index, migrating the pre-tabs single workspace into tab 1.
 * @returns {Promise<{ list: {id,name}[], active: string }>}
 */
export async function loadTabs() {
  try {
    let tabs = await get('tabs');
    if (tabs && Array.isArray(tabs.list) && tabs.list.length) return tabs;
    const id = newId();
    const [model, state] = await Promise.all([get('model'), get('state')]);
    if (model) await put(`tab:${id}:model`, model);
    if (state) await put(`tab:${id}:state`, state);
    tabs = { list: [{ id, name: model ? model.name.replace(/\.stl$/i, '') : 'Project 1' }], active: id };
    await put('tabs', tabs);
    return tabs;
  } catch {
    return { list: [{ id: 'local', name: 'Project 1' }], active: 'local' };
  }
}

export async function saveTabs(tabs) {
  try { await put('tabs', tabs); } catch { /* storage unavailable */ }
}

export function createTabId() { return newId(); }

/** @returns {Promise<{ model?: { name, bytes }, state?: object } | null>} */
export async function loadWorkspace(tabId) {
  try {
    const [model, state] = await Promise.all([get(`tab:${tabId}:model`), get(`tab:${tabId}:state`)]);
    return model || state ? { model, state } : null;
  } catch { return null; }
}

export async function saveWorkspaceModel(tabId, name, bytes) {
  try { await put(`tab:${tabId}:model`, { name, bytes, savedAt: Date.now() }); } catch { /* storage unavailable */ }
}

export async function saveWorkspaceState(tabId, state) {
  try { await put(`tab:${tabId}:state`, { ...state, savedAt: Date.now() }); } catch { /* storage unavailable */ }
}

export async function deleteWorkspace(tabId) {
  try { await Promise.all([del(`tab:${tabId}:model`), del(`tab:${tabId}:state`)]); } catch { /* ignore */ }
}
