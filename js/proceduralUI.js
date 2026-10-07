/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Procedural map panel ─────────────────────────────────────────────────────
// One panel implementation drives the "Rocks", "Design" and "Water" tabs of the
// Displacement Map section: type swatches, a lit preview strip, grouped
// parameter sliders and seed / resolution / reset / download actions. Maps
// are generated in proceduralWorker.js — a fast 256 px pass while dragging,
// then the full-resolution pass once input settles — and handed to main.js
// as a normal map entry ({ name, fullCanvas, texture, imageData, width, height }).

import * as THREE from 'three';
import { t } from './i18n.js';
import { DEFAULT_ROCK_PARAMS, GRAIN_SHAPES, derivedCounts } from './rockGenerator.js';
import { logCount } from './proceduralCore.js';
import { ROCK_TYPES, DEFAULT_ROCK_TYPE, rockTypeById } from './rockPresets.js';
import { DEFAULT_DESIGN_PARAMS } from './designGenerator.js';
import { DESIGN_TYPES, DEFAULT_DESIGN_TYPE, designTypeById } from './designPresets.js';
import { DEFAULT_WATER_PARAMS } from './waterGenerator.js';
import { WATER_TYPES, DEFAULT_WATER_TYPE, waterTypeById } from './waterPresets.js';
import { DEFAULT_SYMBOL_PARAMS, LAYOUTS, PROFILES, FRAMES } from './symbolGenerator.js';
import { SYMBOL_TYPES, DEFAULT_SYMBOL_TYPE, symbolTypeById } from './symbolPresets.js';

const FAST_SIZE = 256;
const THUMB_GEN = 96;
const THUMB = 80;
const RESOLUTIONS = [512, 1024, 2048];
const DEFAULT_RESOLUTION = 1024;
const INPUT_DEBOUNCE_MS = 60;

const fmtMm = (mm) => ` ≈ ${mm < 10 ? mm.toFixed(1) : mm.toFixed(0)} mm`;

// ── Generator configurations ─────────────────────────────────────────────────
// Controls: 0..1 params are shown as 0..100 % unless `raw`. `readout` adds a
// live mm hint computed from the current tile size.

export const PROCEDURAL_KINDS = {
  rock: {
    i18n: 'rock',
    types: ROCK_TYPES,
    defaultType: DEFAULT_ROCK_TYPE,
    typeById: rockTypeById,
    defaults: DEFAULT_ROCK_PARAMS,
    selects: { shape: GRAIN_SHAPES },
    groups: [
      // Edge finish first: it is the most-reached-for adjustment on every rock.
      { id: 'surface', open: true, controls: [
        { k: 'edgeSoftness' },
        { k: 'roughJag' },
        { k: 'roughness' },
        { k: 'roughScale' },
        { k: 'form' },
        { k: 'weathering' },
      ] },
      { id: 'grain', open: true, controls: [
        { k: 'shape', type: 'select' },
        { k: 'grainSize', readout: 'grain' },
        { k: 'grainRelief' },
        { k: 'irregularity' },
        { k: 'gapDepth' },
        { k: 'gapWidth' },
        { k: 'sizeVariation' },
        { k: 'mergeGrains' },
        { k: 'splitGrains' },
      ] },
      { id: 'facets', open: true, controls: [
        { k: 'facetSteepness' },
        { k: 'subFacets' },
        { k: 'cleavage' },
        { k: 'cleavageAngle', min: -90, max: 90, step: 1, raw: true },
        { k: 'elongation' },
        { k: 'terraces' },
        { k: 'terraceCount', min: 2, max: 24, step: 1, raw: true },
      ] },
      { id: 'fractures', controls: [
        { k: 'cracks' },
        { k: 'crackSpacing', readout: 'crack' },
        { k: 'crackWidth' },
      ] },
      { id: 'pits', controls: [
        { k: 'pits' },
        { k: 'pitSize', readout: 'pit' },
        { k: 'pitDensity' },
      ] },
      { id: 'bedding', controls: [
        { k: 'layers' },
        { k: 'layerCount', min: 2, max: 48, step: 1, raw: true },
        { k: 'layerAngle', min: -90, max: 90, step: 1, raw: true },
        { k: 'layerWaviness' },
        { k: 'layerSharpness' },
      ] },
      { id: 'foliation', controls: [
        { k: 'crenulation' },
        { k: 'crenCount', min: 1, max: 24, step: 1, raw: true },
        { k: 'flakiness' },
        { k: 'flakeSize' },
        { k: 'porphyro' },
        { k: 'porphyroSize', readout: 'porphyro' },
        { k: 'porphyroDensity' },
        { k: 'porphyroElong' },
        { k: 'deflection' },
      ] },
      { id: 'veins', controls: [
        { k: 'veins', min: -100, max: 100 },
        { k: 'veinWidth' },
        { k: 'veinDensity' },
      ] },
    ],
    readout(kind, p, tileMm) {
      const n = derivedCounts(p);
      const span = tileMm * n.tileMul;   // the map covers tileMul Scale tiles
      if (kind === 'grain') return fmtMm(span / n.grainCells);
      if (kind === 'crack') return fmtMm(span / n.crackCells);
      if (kind === 'porphyro') return fmtMm(span / Math.max(2, Math.round(logCount(30, 4, p.porphyroSize) * n.tileMul)) * 0.72);
      return fmtMm(span / n.pitCells * 0.77);
    },
  },
  design: {
    i18n: 'design',
    types: DESIGN_TYPES,
    defaultType: DEFAULT_DESIGN_TYPE,
    typeById: designTypeById,
    defaults: DEFAULT_DESIGN_PARAMS,
    selects: {},
    groups: [
      { id: 'pattern', open: true, controls: [
        { k: 'density', min: 1, max: 60, step: 1, raw: true, readout: 'pitch' },
        { k: 'angle', min: -90, max: 90, step: 1, raw: true },
        { k: 'width' },
        { k: 'softness' },
        { k: 'waviness' },
        { k: 'waveCount', min: 1, max: 12, step: 1, raw: true },
        { k: 'accent' },
        { k: 'detail' },
        { k: 'bubble' },
      ] },
      { id: 'growth', open: true, controls: [
        { k: 'length' },
        { k: 'curl' },
        { k: 'flow' },
        { k: 'branching' },
        { k: 'thorns' },
        { k: 'spacing' },
      ] },
      { id: 'variability', open: true, controls: [
        { k: 'variation' },
        { k: 'asymmetry' },
        { k: 'scatter' },
        { k: 'rotation' },
        { k: 'scaleVar' },
      ] },
    ],
    readout(kind, p, tileMm) {
      return fmtMm(tileMm / Math.max(1, Math.round(p.density)));
    },
  },
  water: {
    i18n: 'water',
    types: WATER_TYPES,
    defaultType: DEFAULT_WATER_TYPE,
    typeById: waterTypeById,
    defaults: DEFAULT_WATER_PARAMS,
    selects: {},
    groups: [
      { id: 'form', open: true, controls: [
        { k: 'scale', min: 1, max: 60, step: 1, raw: true, readout: 'pitch' },
        { k: 'shoal' },
        { k: 'bunch' },
        { k: 'shore' },
        { k: 'angle', min: -90, max: 90, step: 1, raw: true },
        { k: 'count' },
        { k: 'spread' },
        { k: 'complexity' },
        { k: 'rings' },
        { k: 'width' },
      ] },
      { id: 'shape', open: true, controls: [
        { k: 'chop' },
        { k: 'crest' },
        { k: 'asymmetry' },
        { k: 'decay' },
        { k: 'softness' },
      ] },
      { id: 'texture', open: true, controls: [
        { k: 'detail' },
        { k: 'turbulence' },
        { k: 'variation' },
      ] },
    ],
    readout(kind, p, tileMm) {
      return fmtMm(tileMm / Math.max(1, Math.round(p.scale)));
    },
  },
  symbol: {
    i18n: 'symbol',
    types: SYMBOL_TYPES,
    defaultType: DEFAULT_SYMBOL_TYPE,
    typeById: symbolTypeById,
    defaults: DEFAULT_SYMBOL_PARAMS,
    selects: { layout: LAYOUTS, profile: PROFILES, frame: FRAMES },
    compactGrid: true,
    groups: [
      { id: 'layout', open: true, controls: [
        { k: 'layout', type: 'select' },
        { k: 'size', readout: 'symbol' },
        { k: 'count', min: 1, max: 16, step: 1, raw: true, readout: 'pitch', when: (p) => p.layout !== 'single' },
        { k: 'scatter', when: (p) => p.layout !== 'single' },
        { k: 'sizeVar', when: (p) => p.layout !== 'single' },
        { k: 'rotJitter', when: (p) => p.layout !== 'single' },
        { k: 'mix', when: (p) => p.layout !== 'single' },
      ] },
      { id: 'relief', open: true, controls: [
        { k: 'profile', type: 'select' },
        { k: 'bevel', when: (p) => p.profile !== 'outline' },
        { k: 'outline', when: (p) => p.profile === 'outline' },
        { k: 'frame', type: 'select' },
        { k: 'softness' },
      ] },
    ],
    readout(kind, p, tileMm) {
      if (p.layout === 'single') return fmtMm(tileMm * (0.06 + 0.88 * p.size));
      const cell = tileMm / Math.max(1, Math.round(p.count));
      return kind === 'pitch' ? fmtMm(cell) : fmtMm(cell * (0.05 + 0.93 * p.size));
    },
  },
};

const MAP_PREFIX = { rock: 'Rock', design: 'Design', water: 'Water', symbol: 'Symbol' };

// ── Worker pool ──────────────────────────────────────────────────────────────
// Shared by every panel. Big maps are split into row bands across all cores
// (the per-pixel stage is independent per row), then one worker runs the
// whole-image stage (terraces, weathering blur, normalisation).

let _pool = null;
function getPool() {
  if (_pool) return _pool;
  const n = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
  const idle = [], queue = [];
  const drain = () => {
    while (idle.length && queue.length) {
      const w = idle.pop(), task = queue.shift();
      w._task = task;
      w.postMessage(task.msg, task.transfer);
    }
  };
  for (let i = 0; i < n; i++) {
    const w = new Worker(new URL('./proceduralWorker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      const task = w._task;
      w._task = null;
      idle.push(w);
      if (e.data.error) task.reject(new Error(e.data.error)); else task.resolve(e.data);
      drain();
    };
    idle.push(w);
  }
  const run = (msg, transfer = []) => new Promise((resolve, reject) => {
    queue.push({ msg, transfer, resolve, reject });
    drain();
  });
  _pool = { n, run };
  return _pool;
}

/** Generate one map → RGBA bytes. */
async function generateMap(kind, params, size) {
  const pool = getPool();
  if (size <= FAST_SIZE || pool.n === 1) {
    return (await pool.run({ op: 'full', kind, params, size })).px;
  }
  const bands = pool.n * 2, step = Math.ceil(size / bands), jobs = [];
  for (let y0 = 0; y0 < size; y0 += step) {
    jobs.push(pool.run({ op: 'rows', kind, params, size, y0, y1: Math.min(size, y0 + step) }));
  }
  const parts = await Promise.all(jobs);
  const struct = new Float32Array(size * size);
  const grit = parts[0].grit ? new Float32Array(size * size) : null;
  for (const part of parts) {
    struct.set(part.struct, part.y0 * size);
    if (grit) grit.set(part.grit, part.y0 * size);
  }
  const transfer = grit ? [struct.buffer, grit.buffer] : [struct.buffer];
  return (await pool.run({ op: 'finish', kind, params, size, struct, grit }, transfer)).px;
}

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('data-')) e.setAttribute(k, v);
    else e[k] = v;
  }
  for (const kid of kids) if (kid) e.appendChild(kid);
  return e;
}

/** i18n'd element: sets text now and tags it so applyTranslations() re-labels on language switch. */
function tl(tag, key, attrs = {}) {
  return el(tag, { ...attrs, text: t(key), 'data-i18n': key });
}

/** Paint RGBA greyscale heights as lit relief (reads as a surface, not a grey blob). */
function shadeInto(ctx, px, size, outW, outH, tilesX = 1) {
  const img = ctx.createImageData(outW, outH);
  const d = img.data;
  const sx = size * tilesX / outW, sy = size / outH;
  // Slope is measured across one output pixel (not one map pixel) so 8-bit
  // quantisation steps in large maps don't show up as speckle.
  const st = Math.max(1, Math.round(sy));
  const k = 0.11 * size / st;
  for (let y = 0; y < outH; y++) {
    const yy = Math.floor(y * sy) % size, yn = (yy + st) % size;
    for (let x = 0; x < outW; x++) {
      const xx = Math.floor(x * sx) % size, xn = (xx + st) % size;
      const h  = px[(yy * size + xx) * 4] / 255;
      const hx = px[(yy * size + xn) * 4] / 255;
      const hy = px[(yn * size + xx) * 4] / 255;
      const nx = (h - hx) * k, ny = (h - hy) * k;
      const lambert = Math.max(0, (-0.55 * nx - 0.55 * ny + 0.63) / Math.sqrt(nx * nx + ny * ny + 1));
      const v = Math.min(255, 38 + 170 * lambert + 55 * h);
      const i = (y * outW + x) * 4;
      d[i] = v * 0.98; d[i + 1] = v * 0.96; d[i + 2] = v * 0.92; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Paint the map exactly as it lands on the part: the strip is a window
 * `xf.viewMm` wide onto the texture plane, run through the same
 * scale → offset → rotate-about-centre maths as the preview shader
 * (previewMaterial.js sampleMap). Lit in screen space so the light stays put
 * while the texture rotates.
 */
function shadeTransformed(ctx, px, size, outW, outH, xf) {
  const img = ctx.createImageData(outW, outH);
  const d = img.data;
  const mmPx = xf.viewMm / outW;
  const iu = 1 / xf.scaleU, iv = 1 / xf.scaleV;
  const rot = (xf.rotation || 0) * Math.PI / 180, c = Math.cos(rot), sn = Math.sin(rot);
  // Single symbol: centred on the part (strip centre), outside its tile = empty.
  const cx = xf.single ? xf.viewMm / 2 : 0, cy = xf.single ? (outH * mmPx) / 2 : 0;
  const H = (X, Y) => {
    let u = (X - cx) * iu + xf.offsetU - (xf.single ? 0 : 0.5), v = (Y - cy) * iv + xf.offsetV - (xf.single ? 0 : 0.5);
    const ru = c * u - sn * v + 0.5, rv = sn * u + c * v + 0.5;
    if (xf.single && (ru < 0 || ru >= 1 || rv < 0 || rv >= 1)) return 0;
    const tx = Math.floor((ru - Math.floor(ru)) * size) % size;
    const ty = Math.floor((1 - (rv - Math.floor(rv))) * size) % size;   // textures are flipY'd
    return px[(ty * size + tx) * 4] / 255;
  };
  const k = 0.11 * Math.min(xf.scaleU, xf.scaleV) / mmPx;
  for (let y = 0; y < outH; y++) {
    const Y = (outH - y - 0.5) * mmPx;
    for (let x = 0; x < outW; x++) {
      const X = (x + 0.5) * mmPx;
      const h = H(X, Y), hx = H(X + mmPx, Y), hy = H(X, Y - mmPx);
      const nx = (h - hx) * k, ny = (h - hy) * k;
      const lambert = Math.max(0, (-0.55 * nx - 0.55 * ny + 0.63) / Math.sqrt(nx * nx + ny * ny + 1));
      const v = Math.min(255, 38 + 170 * lambert + 55 * h);
      const i = (y * outW + x) * 4;
      d[i] = v * 0.98; d[i + 1] = v * 0.96; d[i + 2] = v * 0.92; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const TRANSFORM_INPUT_IDS = new Set([
  'scale-u', 'scale-u-val', 'scale-v', 'scale-v-val', 'offset-u', 'offset-u-val',
  'offset-v', 'offset-v-val', 'rotation', 'rotation-val',
]);

// ── Panel ────────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {'rock'|'design'|'water'} opts.kind
 * @param {HTMLElement} opts.container         element to build the panel into
 * @param {() => number} opts.getTileMm        current tile size in mm (for readouts)
 * @param {(entry, displayName) => void} opts.onMap   a new map is ready
 * @param {(tileFrac: number) => void} opts.onTypePicked  user picked a type
 * @param {() => object} [opts.getTransform]   { scaleU, scaleV, offsetU, offsetV, rotation, viewMm }
 * @param {(t: object) => void} [opts.setTransform]  apply { scaleU?, scaleV?, offsetU?, offsetV?, rotation? }
 * @param {(entry) => boolean} [opts.isInUse]   another texture layer still shows this map (don't free it)
 */
export function initProceduralPanel({ kind, container, getTileMm, onMap, onTypePicked, getTransform, setTransform, isInUse }) {
  const cfg = PROCEDURAL_KINDS[kind];
  const P = cfg.i18n;
  const paramsFor = (typeId) => ({ ...cfg.defaults, ...cfg.typeById(typeId).params });
  const state = {
    type: cfg.defaultType,
    params: paramsFor(cfg.defaultType),
    resolution: DEFAULT_RESOLUTION,
  };
  let lastEntry = null;
  let lastEntryKey = null;
  let rev = 0;

  // ── Generation queue: fast preview pass, then full resolution ──
  let version = 0, delivered = -1, busy = false, want = null;

  // Giant rock grains stretch the map over several Scale tiles; keep fine
  // detail crisp by doubling the resolution once it covers more than two.
  const tileMulOf = (params) => (kind === 'rock' ? derivedCounts(params).tileMul : 1);
  const fullSize = (job) => (tileMulOf(job.params) > 2 ? Math.min(2048, job.res * 2) : job.res);

  const stateKey = () => JSON.stringify([state.type, state.params, state.resolution]);

  function schedule() {
    version++;
    want = { version, key: stateKey(), type: state.type, params: { ...state.params }, res: state.resolution, stage: 'fast' };
    setBusy(true);
    pump();
  }

  function pump() {
    if (busy || !want) return;
    const job = want;
    busy = true;
    const size = job.stage === 'fast' ? Math.min(FAST_SIZE, job.res) : fullSize(job);
    want = (job.stage === 'fast' && fullSize(job) > FAST_SIZE) ? { ...job, stage: 'full' } : null;
    generateMap(kind, job.params, size).then((px) => {
      const id = job.version;
      if (id > delivered || (id === delivered && size > (lastEntry?.width ?? 0))) {
        delivered = id;
        deliver(px, size, job);
      }
    }, (err) => {
      console.error(`[${kind}] generation failed:`, err);
    }).finally(() => {
      busy = false;
      if (!want && job.version === version) setBusy(false);
      pump();
    });
  }

  /**
   * Wrap generated pixels as a map entry. procState is the recipe that made
   * it, so a texture layer, a saved project or an undo step can rebuild it.
   */
  function makeEntry(px, size, job) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const imageData = new ImageData(px, size, size);
    canvas.getContext('2d').putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    const type = cfg.typeById(job.type);
    const name = `${MAP_PREFIX[kind]} ${type ? type.name : ''}`.trim();
    texture.name = name;
    return {
      name, fullCanvas: canvas, texture, imageData, width: size, height: size,
      isProcedural: true, proceduralKind: kind, rev: ++rev, tileMul: tileMulOf(job.params),
      singleTile: kind === 'symbol' && job.params.layout === 'single',
      procState: { kind, type: job.type, params: { ...job.params }, resolution: job.res },
    };
  }

  function deliver(px, size, job) {
    const prev = lastEntry;
    lastEntry = makeEntry(px, size, job);
    lastEntryKey = size === fullSize(job) ? job.key : null;
    drawPreview();
    onMap(lastEntry, displayName());
    if (prev && prev.texture && !(isInUse && isInUse(prev))) prev.texture.dispose();
  }

  const displayName = () =>
    `${t(`${P}.mapPrefix`)} · ${t(`${P}.type.${state.type}`)} · ${t('proc.seed')} ${state.params.seed}`;

  // ── DOM ──
  container.innerHTML = '';

  // Type grid
  const grid = el('div', { class: 'preset-grid proc-grid' + (cfg.compactGrid ? ' proc-grid-compact' : '') });
  const swatches = new Map();
  for (const rt of cfg.types) {
    const c = el('canvas'); c.width = c.height = THUMB;
    const key = `${P}.type.${rt.id}`;
    const label = el('span', { class: 'preset-label proc-label', text: t(key), 'data-i18n': key });
    const sw = el('div', { class: 'preset-swatch proc-swatch preset-loading', tabIndex: 0, title: t(key), 'data-i18n-title': key }, c, label);
    sw.setAttribute('role', 'button');
    sw.addEventListener('click', () => pickType(rt.id));
    sw.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickType(rt.id); }
    });
    grid.appendChild(sw);
    swatches.set(rt.id, sw);
  }
  container.appendChild(grid);

  // Preview strip (map tiled ~3× so seams would show if there were any)
  const preview = el('canvas', { class: 'proc-preview' });
  preview.width = 320; preview.height = 110;
  const spinner = el('div', { class: 'proc-busy hidden' });
  const resBadge = el('span', { class: 'proc-res-badge' });
  const hint = tl('span', 'proc.previewHint', { class: 'proc-preview-hint' });
  const xfBadge = el('span', { class: 'proc-xf-badge' });
  container.appendChild(el('div', { class: 'proc-preview-wrap' + (getTransform ? ' interactive' : '') }, preview, spinner, resBadge, getTransform ? hint : null, getTransform ? xfBadge : null));

  // Seed row
  const seedInput = el('input', { type: 'number', class: 'val proc-seed-input', min: 0, max: 99999, step: 1 });
  const diceBtn = el('button', { type: 'button', class: 'cylinder-axis-btn proc-dice-btn', title: t('proc.tip.newSeed'), 'data-i18n-title': 'proc.tip.newSeed' },
    el('span', { text: '🎲 ' }), tl('span', 'proc.newSeed'));
  container.appendChild(el('div', { class: 'form-row proc-seed-row' }, tl('label', 'proc.seed'), seedInput, diceBtn));
  seedInput.addEventListener('change', () => {
    const v = Math.max(0, Math.min(99999, Math.round(parseFloat(seedInput.value) || 0)));
    seedInput.value = v;
    state.params.seed = v;
    schedule();
  });
  diceBtn.addEventListener('click', () => {
    state.params.seed = Math.floor(Math.random() * 99999);
    seedInput.value = state.params.seed;
    seedInput.dispatchEvent(new Event('input', { bubbles: true }));   // autosave / undo hooks
    schedule();
  });

  // Parameter groups
  const controls = new Map();   // key → { row, sync(), label }
  const readouts = [];
  const groupEls = [];   // [{ details, keys }] — groups with no visible slider are hidden
  for (const g of cfg.groups) {
    const details = el('details', { class: 'proc-group' });
    if (g.open) details.open = true;
    details.appendChild(tl('summary', `${P}.group.${g.id}`));
    for (const c of g.controls) details.appendChild(buildControl(c));
    container.appendChild(details);
    groupEls.push({ details, keys: g.controls.map(c => c.k) });
  }

  function buildControl(c) {
    const key = c.k;
    const label = el('label', { title: t(`${P}.tip.${key}`), 'data-i18n-title': `${P}.tip.${key}` });
    const labelText = tl('span', `${P}.p.${key}`);
    label.appendChild(labelText);
    if (c.readout) {
      const ro = el('span', { class: 'proc-readout' });
      label.appendChild(ro);
      readouts.push({ el: ro, kind: c.readout });
    }

    if (c.type === 'select') {
      const sel = el('select');
      for (const s of cfg.selects[key]) {
        const o = el('option', { value: s, text: t(`${P}.${key}.${s}`) });
        o.setAttribute('data-i18n-opt', `${P}.${key}.${s}`);
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        const prev = state.params[key];
        state.params[key] = sel.value;
        // Single ↔ pattern: keep each symbol about the same size on the part
        // (a single symbol fills one tile; a pattern puts `count` per tile row).
        if (key === 'layout' && getTransform && setTransform && (prev === 'single') !== (sel.value === 'single')) {
          const n = Math.max(1, Math.round(state.params.count || 1));
          const s = getTransform().scaleU;
          if (s > 0) setTransform({ scaleU: sel.value === 'single' ? s / n : s * n, offsetU: 0, offsetV: 0 });
        }
        syncControls(); schedule();
      });
      const row = el('div', { class: 'form-row' }, label, sel);
      controls.set(key, { row, labelText, when: c.when, sync: () => { sel.value = state.params[key]; } });
      return row;
    }

    const scale = c.raw ? 1 : 100;
    // min/max can be narrowed per type (type.ranges) so a pattern's useful span fills the slider.
    let min = c.min ?? 0, max = c.max ?? 100;
    const step = c.step ?? 1;
    const range = el('input', { type: 'range', min, max, step });
    const num = el('input', { type: 'number', class: 'val', min, max, step });
    const toUi = (v) => Math.round(v * scale / step) * step;
    const fromUi = (v) => v / scale;
    const defaultUi = () => toUi(paramsFor(state.type)[key]);

    let timer = null;
    const set = (uiVal, immediate = false) => {
      const v = Math.max(min, Math.min(max, uiVal));
      range.value = v; num.value = v;
      state.params[key] = fromUi(v);
      refreshReadouts();
      clearTimeout(timer);
      if (immediate) schedule(); else timer = setTimeout(schedule, INPUT_DEBOUNCE_MS);
    };
    range.addEventListener('input', () => set(parseFloat(range.value)));
    range.addEventListener('dblclick', () => { set(defaultUi(), true); range.dispatchEvent(new Event('change', { bubbles: true })); });
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (Number.isNaN(v)) { num.value = range.value; return; }
      set(v, true);
    });
    const row = el('div', { class: 'form-row slider-row' }, label, range, num);
    const setRange = (r) => {
      min = r ? r[0] : (c.min ?? 0); max = r ? r[1] : (c.max ?? 100);
      range.min = num.min = min; range.max = num.max = max;
    };
    controls.set(key, { row, labelText, setRange, when: c.when, sync: () => { const v = toUi(state.params[key]); range.value = v; num.value = v; } });
    return row;
  }

  // Footer: resolution, reset, download
  const resSel = el('select', { class: 'proc-res-select' });
  for (const r of RESOLUTIONS) resSel.appendChild(el('option', { value: r, text: `${r} × ${r}` }));
  resSel.addEventListener('change', () => { state.resolution = parseInt(resSel.value, 10); schedule(); });
  const resLabel = el('label', { title: t('proc.tip.resolution'), 'data-i18n-title': 'proc.tip.resolution' }, tl('span', 'proc.resolution'));
  container.appendChild(el('div', { class: 'form-row' }, resLabel, resSel));

  const resetBtn = tl('button', 'proc.reset', { type: 'button', class: 'cylinder-axis-btn' });
  resetBtn.title = t('proc.tip.reset'); resetBtn.setAttribute('data-i18n-title', 'proc.tip.reset');
  resetBtn.addEventListener('click', () => {
    state.params = { ...paramsFor(state.type), seed: state.params.seed };
    syncControls();
    resetBtn.dispatchEvent(new Event('change', { bubbles: true }));
    schedule();
  });
  const dlBtn = tl('button', 'proc.download', { type: 'button', class: 'cylinder-axis-btn' });
  dlBtn.title = t('proc.tip.download'); dlBtn.setAttribute('data-i18n-title', 'proc.tip.download');
  dlBtn.addEventListener('click', () => {
    if (!lastEntry) return;
    lastEntry.fullCanvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${kind}_${state.type}_seed${state.params.seed}_${lastEntry.width}px.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  });
  container.appendChild(el('div', { class: 'proc-actions' }, resetBtn, dlBtn));

  // ── Behaviour ──
  function setBusy(on) { spinner.classList.toggle('hidden', !on); }

  function drawPreview() {
    if (!lastEntry) return;
    const w = preview.clientWidth || 320;
    preview.width = Math.round(w * (window.devicePixelRatio || 1));
    preview.height = Math.round(preview.width * 110 / 320);
    const xf = getTransform && getTransform();
    if (xf && xf.scaleU > 0 && xf.scaleV > 0 && xf.viewMm > 0) {
      shadeTransformed(preview.getContext('2d'), lastEntry.imageData.data, lastEntry.width, preview.width, preview.height, xf);
      xfBadge.textContent = `${+xf.scaleU.toFixed(1)} mm · ${Math.round(xf.rotation || 0)}°`;
    } else {
      shadeInto(preview.getContext('2d'), lastEntry.imageData.data, lastEntry.width, preview.width, preview.height, 2.9);
    }
    resBadge.textContent = `${lastEntry.width} px`;
  }

  // ── Direct manipulation: the strip is a handle on the texture transform ──
  let rafId = 0;
  const redrawSoon = () => { if (!rafId) rafId = requestAnimationFrame(() => { rafId = 0; drawPreview(); }); };
  if (getTransform && setTransform) {
    // Offsets are periodic in whole tiles — except for a single symbol, which can travel anywhere.
    const wrapOff = (o) => (getTransform().single ? o : o - Math.round(o));
    const wrapDeg = (r) => ((r % 360) + 360) % 360;
    const mmPerCss = () => getTransform().viewMm / (preview.clientWidth || 320);
    let drag = null;
    preview.addEventListener('contextmenu', (e) => e.preventDefault());
    preview.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      preview.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, rotate: e.button === 2 || e.shiftKey };
      preview.classList.add('dragging');
    });
    preview.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (!dx && !dy) return;
      const xf = getTransform();
      if (drag.rotate) {
        setTransform({ rotation: wrapDeg(xf.rotation + (dx - dy) * 0.6) });
      } else {
        const m = mmPerCss();
        // Content follows the pointer: off' = off − Δp / scale (screen y is down, v is up).
        setTransform({ offsetU: wrapOff(xf.offsetU - dx * m / xf.scaleU), offsetV: wrapOff(xf.offsetV + dy * m / xf.scaleV) });
      }
      redrawSoon();
    });
    const end = () => { if (drag) { drag = null; preview.classList.remove('dragging'); } };
    preview.addEventListener('pointerup', end);
    preview.addEventListener('pointercancel', end);
    preview.addEventListener('wheel', (e) => {
      e.preventDefault();
      const xf = getTransform();
      if (e.shiftKey) {
        setTransform({ rotation: wrapDeg(xf.rotation + (e.deltaY > 0 ? 5 : -5)) });
      } else {
        // Zoom about the cursor: the texture point under it stays put.
        const f = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        const r = preview.getBoundingClientRect(), m = mmPerCss();
        const X = (e.clientX - r.left) * m, Y = (r.bottom - e.clientY) * m;
        const su = xf.scaleU * f, sv = xf.scaleV * f;
        setTransform({
          scaleU: su, scaleV: sv,
          offsetU: wrapOff(xf.offsetU + X / xf.scaleU - X / su),
          offsetV: wrapOff(xf.offsetV + Y / xf.scaleV - Y / sv),
        });
      }
      redrawSoon();
    }, { passive: false });
    preview.addEventListener('dblclick', () => { setTransform({ offsetU: 0, offsetV: 0, rotation: 0 }); redrawSoon(); });
    // Keep the strip in sync when the Transform sliders move instead.
    const onExternal = (e) => { if (TRANSFORM_INPUT_IDS.has(e.target && e.target.id)) redrawSoon(); };
    document.addEventListener('input', onExternal);
    document.addEventListener('change', onExternal);
  }

  function syncControls() {
    const type = cfg.typeById(state.type);
    const visible = (key) => !(type && type.uses && !type.uses.includes(key))
      && !(controls.get(key)?.when && !controls.get(key).when(state.params));
    for (const [key, c] of controls) {
      if (c.setRange) c.setRange(type && type.ranges && type.ranges[key]);
      c.sync();
      // Types may list the sliders that affect them; hide the rest.
      c.row.classList.toggle('hidden', !visible(key));
    }
    for (const g of groupEls) g.details.classList.toggle('hidden', !g.keys.some(visible));
    seedInput.value = state.params.seed;
    resSel.value = String(state.resolution);
    for (const [id, sw] of swatches) sw.classList.toggle('proc-type-active', id === state.type);
    // Types may rename generic slots ("Accent" → "Tufting", "Detail" → "Topstitch" …)
    for (const [key, c] of controls) {
      const alias = type && type.labels && type.labels[key];
      const i18nKey = alias ? `${P}.label.${alias}` : `${P}.p.${key}`;
      c.labelText.setAttribute('data-i18n', i18nKey);
      c.labelText.textContent = t(i18nKey);
    }
    refreshReadouts();
  }

  function refreshReadouts() {
    const tile = getTileMm();
    for (const r of readouts) r.el.textContent = tile > 0 ? cfg.readout(r.kind, state.params, tile) : '';
  }

  function pickType(id) {
    const rt = cfg.typeById(id);
    if (!rt) return;
    state.type = id;
    state.params = { ...paramsFor(id), seed: state.params.seed };
    syncControls();
    onTypePicked(rt.tileFrac);
    grid.dispatchEvent(new Event('change', { bubbles: true }));
    schedule();
  }

  // Thumbnails — generated once, lit like the preview.
  for (const rt of cfg.types) {
    generateMap(kind, { ...paramsFor(rt.id), seed: 1 }, THUMB_GEN).then((px) => {
      const sw = swatches.get(rt.id);
      shadeInto(sw.querySelector('canvas').getContext('2d'), px, THUMB_GEN, THUMB, THUMB);
      sw.classList.remove('preset-loading');
    }, (err) => {
      console.error(`[${kind}] thumbnail failed:`, err);
      const sw = swatches.get(rt.id);
      sw.classList.remove('preset-loading');
      sw.classList.add('proc-failed');
      sw.title = t('proc.failed');
    });
  }

  window.addEventListener('resize', drawPreview);
  syncControls();

  return {
    kind,
    /** Make this generator's map the active map (reuse the last result if nothing changed). */
    activate() {
      if (lastEntry && lastEntryKey === stateKey()) onMap(lastEntry, displayName());
      else schedule();
    },
    getState() {
      return { kind, type: state.type, params: { ...state.params }, resolution: state.resolution };
    },
    /**
     * Render a saved recipe at full resolution without touching the panel —
     * for texture layers that are not the one being edited.
     */
    async render(saved) {
      if (!saved || typeof saved !== 'object') return null;
      const type = cfg.typeById(saved.type) ? saved.type : cfg.defaultType;
      const job = {
        type, params: { ...paramsFor(type), ...(saved.params || {}) },
        res: RESOLUTIONS.includes(saved.resolution) ? saved.resolution : DEFAULT_RESOLUTION,
      };
      const px = await generateMap(kind, job.params, fullSize(job));
      return makeEntry(px, fullSize(job), job);
    },
    /**
     * Show an existing entry of this generator (switching to its texture
     * layer, undo): the sliders follow its recipe, nothing is regenerated.
     */
    adopt(entry) {
      const saved = entry && entry.procState;
      if (!saved) return false;
      state.type = cfg.typeById(saved.type) ? saved.type : cfg.defaultType;
      state.params = { ...paramsFor(state.type), ...(saved.params || {}) };
      state.resolution = RESOLUTIONS.includes(saved.resolution) ? saved.resolution : DEFAULT_RESOLUTION;
      syncControls();
      lastEntry = entry;
      lastEntryKey = stateKey();
      version++; delivered = version; want = null;   // a result still in flight for an older recipe is stale now
      setBusy(false);
      drawPreview();
      return true;
    },
    /** Restore a saved state (project / session / undo) and regenerate. */
    restore(saved) {
      if (!saved || typeof saved !== 'object') return false;
      const type = cfg.typeById(saved.type) ? saved.type : cfg.defaultType;
      state.type = type;
      state.params = { ...paramsFor(type), ...(saved.params || {}) };
      state.resolution = RESOLUTIONS.includes(saved.resolution) ? saved.resolution : DEFAULT_RESOLUTION;
      syncControls();
      if (lastEntry && lastEntryKey === stateKey()) onMap(lastEntry, displayName());
      else schedule();
      return true;
    },
    refreshReadouts,
    redraw: drawPreview,
  };
}
