/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Auto-mask panel ──────────────────────────────────────────────────────────
// Two one-click ways to keep texture off surfaces that must stay exact:
//
//   Mask hidden surfaces  measures every face's exposure (autoMask.js) in a
//                         pool of workers, then masks faces below the Exposure
//                         threshold — enclosure interiors, internal pins and
//                         bosses, window walls. The slider re-applies live.
//   Keep-out zones…       loads a mesh of keep-out volumes, exported from CAD
//                         in the model's own coordinates, and masks every face
//                         whose centroid lies inside one.
//
// Results are handed to main.js as face sets, which merges them into the
// normal exclusion mask (so brush/fill, undo and project save all apply).

import { t } from './i18n.js';
import { buildBVH, pointInside, footprintCap, smoothFaceValues, growMask } from './autoMask.js';
import { loadModelFile } from './stlLoader.js';

const RAYS = 48;

/**
 * @param {object} o
 * @param {() => ({ geometry, adjacency, centroids } | null)} o.getModel
 * @param {() => ({ rot: THREE.Quaternion, trans: THREE.Vector3 })} o.getPose
 * @param {(kind: 'hidden'|'keepout', faces: Set<number>) => void} o.apply
 */
export function initAutoMask({ getModel, getPose, apply }) {
  const slider = document.getElementById('automask-exposure');
  const val = document.getElementById('automask-exposure-val');
  const capChk = document.getElementById('automask-cap');
  const margin = document.getElementById('automask-margin');
  const marginVal = document.getElementById('automask-margin-val');
  const hiddenBtn = document.getElementById('automask-hidden-btn');
  const keepBtn = document.getElementById('automask-keepout-btn');
  const keepInput = document.getElementById('automask-keepout-input');
  const status = document.getElementById('automask-status');
  if (!slider) return { reset() {} };

  let cache = null;        // { geometry, cap, exposure (smoothed) }
  let hiddenActive = false;
  let running = false;

  const setStatus = (msg) => { status.textContent = msg || ''; };
  const threshold = () => parseFloat(slider.value) / 100;

  function applyHidden() {
    if (!cache) return;
    const thr = threshold();
    let faces = new Set();
    for (let f = 0; f < cache.exposure.length; f++) if (cache.exposure[f] < thr) faces.add(f);
    const m = parseFloat(margin.value) || 0;
    if (m > 0) faces = growMask(faces, cache.geometry.attributes.position.array, m);
    apply('hidden', faces);
    setStatus(t('automask.statusHidden', { n: faces.size.toLocaleString() }));
  }

  async function measure(model) {
    const pos = model.geometry.attributes.position.array;
    const nFaces = pos.length / 9;
    let all = pos;
    if (capChk.checked) {
      const cap = footprintCap(pos);
      all = new Float32Array(pos.length + cap.length);
      all.set(pos); all.set(cap, pos.length);
    }
    const bb = model.geometry.boundingBox || (model.geometry.computeBoundingBox(), model.geometry.boundingBox);
    const eps = bb.min.distanceTo(bb.max) * 1e-4;
    const nW = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 1));
    const chunk = Math.ceil(nFaces / nW);
    const exposure = new Float32Array(nFaces);
    let done = 0;
    setStatus(t('automask.statusMeasuring', { pct: 0 }));
    await Promise.all(Array.from({ length: nW }, (_, i) => new Promise((resolve, reject) => {
      const f0 = i * chunk, f1 = Math.min(nFaces, f0 + chunk);
      if (f0 >= f1) { resolve(); return; }
      const w = new Worker(new URL('./autoMaskWorker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        w.terminate();
        if (e.data.error) { reject(new Error(e.data.error)); return; }
        exposure.set(e.data.exposure, e.data.f0);
        done += f1 - f0;
        setStatus(t('automask.statusMeasuring', { pct: Math.round(100 * done / nFaces) }));
        resolve();
      };
      w.onerror = (err) => { w.terminate(); reject(err); };
      w.postMessage({ pos: all, f0, f1, nRays: RAYS, eps });
    })));
    return smoothFaceValues(exposure, model.adjacency, pos, 2);
  }

  hiddenBtn.addEventListener('click', async () => {
    const model = getModel();
    if (!model || running) return;
    const capOn = capChk.checked;
    if (!cache || cache.geometry !== model.geometry || cache.cap !== capOn) {
      running = true;
      hiddenBtn.disabled = true;
      try {
        cache = { geometry: model.geometry, cap: capOn, exposure: await measure(model) };
      } catch (err) {
        console.error('[automask] exposure failed:', err);
        setStatus(t('automask.statusFailed'));
        return;
      } finally {
        running = false;
        hiddenBtn.disabled = false;
      }
    }
    hiddenActive = true;
    applyHidden();
  });

  const onSlide = () => { val.value = slider.value; if (hiddenActive && cache) applyHidden(); };
  slider.addEventListener('input', onSlide);
  val.addEventListener('change', () => {
    const v = Math.max(5, Math.min(95, parseFloat(val.value) || 70));
    slider.value = v; onSlide();
  });
  capChk.addEventListener('change', () => { if (hiddenActive) hiddenBtn.click(); });
  const onMargin = () => { marginVal.value = margin.value; if (hiddenActive && cache) applyHidden(); };
  margin.addEventListener('change', onMargin);   // growth is heavier than a threshold → apply on release
  margin.addEventListener('input', () => { marginVal.value = margin.value; });
  marginVal.addEventListener('change', () => {
    margin.value = Math.max(0, Math.min(10, parseFloat(marginVal.value) || 0)); onMargin();
  });

  keepBtn.addEventListener('click', () => { if (getModel()) keepInput.click(); });
  keepInput.addEventListener('change', async () => {
    const file = keepInput.files[0];
    keepInput.value = '';
    const model = getModel();
    if (!file || !model) return;
    setStatus(t('automask.statusLoading'));
    try {
      const { geometry, originOffset } = await loadModelFile(file);
      // Loaders centre meshes; undo that, then apply the model's pose so the
      // zones land exactly where they were drawn relative to the model.
      const { rot, trans } = getPose();
      const src = geometry.attributes.position.array;
      const pos = new Float32Array(src.length);
      const off = originOffset || { x: 0, y: 0, z: 0 };
      const q = rot, v = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < src.length; i += 3) {
        v.x = src[i] + off.x; v.y = src[i + 1] + off.y; v.z = src[i + 2] + off.z;
        // rotate by quaternion q (x,y,z,w)
        const ix = q.w * v.x + q.y * v.z - q.z * v.y, iy = q.w * v.y + q.z * v.x - q.x * v.z;
        const iz = q.w * v.z + q.x * v.y - q.y * v.x, iw = -q.x * v.x - q.y * v.y - q.z * v.z;
        pos[i]     = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y + trans.x;
        pos[i + 1] = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z + trans.y;
        pos[i + 2] = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x + trans.z;
      }
      geometry.dispose();
      const bvh = buildBVH(pos);
      const c = model.centroids, faces = new Set();
      for (let f = 0; f < c.length / 3; f++) {
        if (pointInside(bvh, c[f * 3], c[f * 3 + 1], c[f * 3 + 2])) faces.add(f);
      }
      apply('keepout', faces);
      setStatus(faces.size
        ? t('automask.statusKeepout', { n: faces.size.toLocaleString(), name: file.name })
        : t('automask.statusKeepoutNone'));
    } catch (err) {
      console.error('[automask] keep-out failed:', err);
      setStatus(t('automask.statusFailed'));
    }
  });

  return {
    /** New model / cleared mask: forget cached exposure and live state. */
    reset() { cache = null; hiddenActive = false; setStatus(''); },
    /** Mask cleared by the user: stop live re-application. */
    stopLive() { hiddenActive = false; setStatus(''); },
  };
}
