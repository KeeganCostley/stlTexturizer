// Named settings profiles — "I nailed this look, keep it".
//
// A profile is the active texture (library name, browser-local custom map id,
// or a procedural recipe) plus every texture/displacement/export setting,
// stored under a name in localStorage so it survives reloads, tabs and new
// projects. Model-specific state (paint masks, cylinder axis) is left out, so
// a profile can be applied to any model. Profiles can be exported to a JSON
// file and imported elsewhere (e.g. localhost ↔ the GitHub Pages site, which
// have separate storage).

import { t } from './i18n.js';

const STORE_KEY = 'bumpmesh-profiles';
const FILE_FORMAT = 'bumpmesh-profiles';

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(list) ? list.filter(p => p && typeof p.name === 'string' && p.settings) : [];
  } catch { return []; }
}

function store(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); return true; }
  catch { return false; }
}

/**
 * @param {object} opts
 * @param {() => object} opts.capture        current { settings, activeMapName, activeCustomId, procedural }
 * @param {(p: object) => Promise<boolean>} opts.apply  apply a saved profile; false = its texture is unavailable
 * @param {() => string} [opts.describe]     short label of the current texture (for the status line)
 */
export function initSettingsProfiles({ capture, apply, describe }) {
  const select   = document.getElementById('profile-select');
  const applyBtn = document.getElementById('profile-apply');
  const delBtn   = document.getElementById('profile-delete');
  const nameIn   = document.getElementById('profile-name');
  const saveBtn  = document.getElementById('profile-save');
  const status   = document.getElementById('profile-status');
  const exportBtn = document.getElementById('profile-export');
  const importIn  = document.getElementById('profile-import-input');
  if (!select) return;

  let profiles = load();
  let statusTimer = null;

  const say = (msg) => {
    status.textContent = msg;
    clearTimeout(statusTimer);
    if (msg) statusTimer = setTimeout(() => { status.textContent = ''; }, 5000);
  };

  const byName = (name) => profiles.find(p => p.name.toLowerCase() === name.toLowerCase());

  function render(selectName) {
    const keep = selectName ?? select.value;
    const none = select.options[0];
    select.replaceChildren(none);
    none.textContent = profiles.length ? t('profiles.pick') : t('profiles.none');
    for (const p of [...profiles].sort((a, b) => a.name.localeCompare(b.name))) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      o.title = [p.mapLabel, p.savedAt && new Date(p.savedAt).toLocaleString()].filter(Boolean).join(' · ');
      select.appendChild(o);
    }
    select.value = byName(keep || '') ? byName(keep).name : '';
    syncButtons();
  }

  function syncButtons() {
    const has = !!select.value;
    applyBtn.disabled = !has;
    delBtn.disabled = !has;
    saveBtn.disabled = !nameIn.value.trim();
    const existing = byName(nameIn.value.trim());
    saveBtn.textContent = existing ? t('profiles.update') : t('profiles.save');
  }

  nameIn.placeholder = t('profiles.namePlaceholder');
  nameIn.addEventListener('input', syncButtons);
  nameIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !saveBtn.disabled) { e.preventDefault(); saveBtn.click(); }
  });

  // Picking a profile offers its name for re-saving (tweak → Update).
  select.addEventListener('change', () => {
    if (select.value) nameIn.value = select.value;
    syncButtons();
  });

  saveBtn.addEventListener('click', () => {
    const name = nameIn.value.trim();
    if (!name) return;
    const existing = byName(name);
    if (existing && !confirm(t('profiles.confirmOverwrite', { name: existing.name }))) return;
    const entry = { name: existing ? existing.name : name, savedAt: Date.now(), ...capture() };
    if (describe) entry.mapLabel = describe();
    profiles = profiles.filter(p => p !== existing);
    profiles.push(entry);
    if (!store(profiles)) { say(t('profiles.storeFailed')); return; }
    render(entry.name);
    say(t(existing ? 'profiles.updated' : 'profiles.saved', { name: entry.name }));
  });

  applyBtn.addEventListener('click', async () => {
    const p = byName(select.value);
    if (!p) return;
    applyBtn.disabled = true;
    try {
      const ok = await apply(p);
      say(ok ? t('profiles.applied', { name: p.name }) : t('profiles.mapMissing', { name: p.name }));
    } catch (err) {
      console.warn('[profiles] apply failed:', err);
      say(t('profiles.applyFailed'));
    } finally {
      syncButtons();
    }
  });

  // Double-click a name in the list = apply it.
  select.addEventListener('dblclick', () => { if (select.value) applyBtn.click(); });

  delBtn.addEventListener('click', () => {
    const p = byName(select.value);
    if (!p || !confirm(t('profiles.confirmDelete', { name: p.name }))) return;
    profiles = profiles.filter(x => x !== p);
    store(profiles);
    if (nameIn.value.trim().toLowerCase() === p.name.toLowerCase()) nameIn.value = '';
    render('');
    say(t('profiles.deleted', { name: p.name }));
  });

  exportBtn.addEventListener('click', () => {
    if (!profiles.length) { say(t('profiles.nothingToExport')); return; }
    const blob = new Blob([JSON.stringify({ format: FILE_FORMAT, version: 1, profiles }, null, 2)],
      { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bumpmesh-profiles.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  importIn.addEventListener('change', async () => {
    const file = importIn.files && importIn.files[0];
    importIn.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = (Array.isArray(data) ? data : data.profiles || [])
        .filter(p => p && typeof p.name === 'string' && p.settings);
      if (!incoming.length) throw new Error('no profiles');
      // Same name = the imported one wins (it is the one being asked for).
      for (const p of incoming) {
        const old = byName(p.name);
        profiles = profiles.filter(x => x !== old);
        profiles.push(p);
      }
      store(profiles);
      render();
      say(t('profiles.imported', { n: incoming.length }));
    } catch (err) {
      console.warn('[profiles] import failed:', err);
      say(t('profiles.importFailed'));
    }
  });

  // Another tab saved/deleted a profile — keep this one's list current.
  window.addEventListener('storage', (e) => {
    if (e.key === STORE_KEY) { profiles = load(); render(); }
  });

  render('');
  return { refresh: () => render() };
}
