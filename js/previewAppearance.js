/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Preview colour + finish (viewport footer) ────────────────────────────────
// Lets you judge a texture in the filament you'll actually print with.
// Display-only: nothing here affects the exported mesh. Remembered per browser.

import { t } from './i18n.js';
import { setPreviewAppearance } from './previewMaterial.js';
import { setBaseMeshColor, setBackdrop, requestRender } from './viewer.js';

const STORAGE_KEY = 'bumpmesh-preview-appearance';

// Common filament colours. "Teal" is BumpMesh's original preview colour.
const PRESETS = [
  { id: 'teal',       hex: '#38adad' },
  { id: 'graphite',   hex: '#3b3e44' },
  { id: 'black',      hex: '#1d1d20' },
  { id: 'grey',       hex: '#8b8f94' },
  { id: 'white',      hex: '#e9e7e2' },
  { id: 'silver',     hex: '#bfc4ca' },
  { id: 'stone',      hex: '#b3a791' },
  { id: 'terracotta', hex: '#b5633f' },
];

export function initPreviewAppearance() {
  const wrap = document.getElementById('pc-swatches');
  const custom = document.getElementById('pc-custom');
  const finishSel = document.getElementById('pc-finish');
  const backdropSel = document.getElementById('pc-backdrop');
  if (!wrap) return;

  let state = { hex: '#38adad', finish: 'gloss', backdrop: 'auto' };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && /^#[0-9a-f]{6}$/i.test(saved.hex)) state = { hex: saved.hex, finish: saved.finish || 'satin', backdrop: saved.backdrop || 'auto' };
  } catch { /* storage unavailable — defaults are fine */ }

  const swatches = PRESETS.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pc-swatch';
    b.style.background = p.hex;
    b.title = t(`ui.colour.${p.id}`);
    b.setAttribute('data-i18n-title', `ui.colour.${p.id}`);
    b.setAttribute('aria-label', t(`ui.colour.${p.id}`));
    b.addEventListener('click', () => apply({ ...state, hex: p.hex }));
    wrap.appendChild(b);
    return { b, hex: p.hex };
  });

  function apply(next) {
    state = next;
    setPreviewAppearance(state.hex, state.finish);
    setBaseMeshColor(state.hex);
    const n = parseInt(state.hex.slice(1), 16);
    const lum = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    setBackdrop(state.backdrop, lum);
    backdropSel.value = state.backdrop;
    custom.value = state.hex;
    finishSel.value = state.finish;
    for (const s of swatches) s.b.classList.toggle('active', s.hex.toLowerCase() === state.hex.toLowerCase());
    requestRender();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }

  custom.addEventListener('input', () => apply({ ...state, hex: custom.value }));
  finishSel.addEventListener('change', () => apply({ ...state, finish: finishSel.value }));
  backdropSel.addEventListener('change', () => apply({ ...state, backdrop: backdropSel.value }));
  apply(state);
}
