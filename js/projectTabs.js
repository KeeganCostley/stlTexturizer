/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Project tab strip (top of the viewport) ──────────────────────────────────
// Pure UI: renders the tabs and reports user intent. main.js owns switching
// (save current → load other) and persistence (workspaceStore.js).

import { t } from './i18n.js';

/**
 * @param {object} o
 * @param {HTMLElement} o.container
 * @param {() => {list:{id,name}[], active:string}} o.getTabs
 * @param {(id:string) => void} o.onSelect
 * @param {() => void} o.onNew
 * @param {(id:string) => void} o.onClose
 * @param {(id:string, name:string) => void} o.onRename
 */
export function initProjectTabs({ container, getTabs, onSelect, onNew, onClose, onRename }) {
  let busy = false;

  function render() {
    const { list, active } = getTabs();
    container.innerHTML = '';
    for (const tab of list) {
      const el = document.createElement('div');
      el.className = 'ptab' + (tab.id === active ? ' active' : '');
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(tab.id === active));
      el.tabIndex = 0;
      el.title = t('tabs.tip');

      const label = document.createElement('span');
      label.className = 'ptab-label';
      label.textContent = tab.name || t('tabs.untitled');
      el.appendChild(label);

      if (list.length > 1) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ptab-close';
        x.textContent = '×';
        x.title = t('tabs.close');
        x.setAttribute('aria-label', t('tabs.close'));
        x.addEventListener('click', (e) => { e.stopPropagation(); if (!busy) onClose(tab.id); });
        el.appendChild(x);
      }

      el.addEventListener('click', () => { if (!busy && tab.id !== active) onSelect(tab.id); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !busy) onSelect(tab.id); });
      el.addEventListener('dblclick', () => startRename(tab, label));
      container.appendChild(el);
    }
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'ptab-new';
    add.textContent = '+';
    add.title = t('tabs.new');
    add.setAttribute('aria-label', t('tabs.new'));
    add.addEventListener('click', () => { if (!busy) onNew(); });
    container.appendChild(add);
    container.classList.toggle('busy', busy);
  }

  function startRename(tab, label) {
    const input = document.createElement('input');
    input.className = 'ptab-rename';
    input.value = tab.name || '';
    label.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const commit = (save) => {
      if (done) return; done = true;
      const v = input.value.trim();
      if (save && v && v !== tab.name) onRename(tab.id, v); else render();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();   // keep Ctrl+Z etc. from reaching the app
      if (e.key === 'Enter') commit(true);
      if (e.key === 'Escape') commit(false);
    });
    input.addEventListener('blur', () => commit(true));
  }

  return {
    render,
    /** Lock the strip while a project is loading (avoids overlapping switches). */
    setBusy(b) { busy = b; render(); },
  };
}
