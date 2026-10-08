/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Botanical relief: roses, thorned rose vines, ivy, bramble, ferns, leaf
// canopy and wreaths. Everything is analytic per pixel:
//   • a rose is layered petals (outer ring → spiralled bud), each layer a
//     scalloped ring of cupped petals that curl up at the rim;
//   • leaves are serrated blades with a midrib and forward-sweeping veins
//     (ivy: palmate, five lobes, radiating veins);
//   • vines are wavy stems in "along / across" coordinates, so the same code
//     draws straight trails, crossing brambles and a closed wreath.
// Layout 'single' draws one centred motif with an empty border; the mapper
// then samples it once (entry.singleTile) instead of tiling it.

import { hashf, fract, clamp01, sstep, mod, noise, blurWrap } from './proceduralCore.js';

export const BOTANIC_LAYOUTS = ['single', 'pattern'];

export const DEFAULT_BOTANIC_PARAMS = Object.freeze({
  pattern: 'roseVine',
  layout: 'pattern',
  count: 3,          // vines / rows / roses per tile row
  size: 0.5,         // leaf & bloom size
  width: 0.4,        // stem thickness
  leaves: 0.6,       // leaf frequency
  flowers: 0.3,      // rose frequency along vines
  thorns: 0.4,       // thorn frequency & size
  petals: 0.5,       // petal layers
  waviness: 0.5,     // stem meander
  veins: 0.5,        // vein relief
  variation: 0.4,    // irregularity
  softness: 0.02,
  seed: 1,
});

const TAU = Math.PI * 2;
const WREATH_UNIT = 0.15;   // wreath: tile units per vine unit
const dome = (s) => (s >= 1 ? 0 : Math.sqrt(1 - s * s));
const tri = (x) => 1 - Math.abs(2 * fract(x) - 1);

// ── Motifs ───────────────────────────────────────────────────────────────────

/**
 * Leaf blade, base at the origin pointing +x, length L, max half-width W.
 * Returns height (≈0.35…0.85) or -1 outside.
 */
function leafH(lx, ly, L, W, serr, veins) {
  if (lx <= 0 || lx >= L) return -1;
  const t = lx / L;
  let w = W * 2.55 * Math.pow(t, 0.55) * Math.pow(1 - t, 0.85);
  if (serr > 0) w *= 1 - serr * 0.13 * tri(t * 11);
  const a = Math.abs(ly);
  if (a >= w) return -1;
  const s = a / w;
  let h = 0.42 + 0.3 * Math.sqrt(1 - s * s) * (0.6 + 0.4 * Math.sin(Math.PI * t));
  h += 0.08 * (1 - sstep(0, 0.09, s));                                      // raised midrib
  if (veins > 0) {
    const ph = (lx - a * 1.1) / L * 7;                                       // veins sweep toward the tip
    const g = Math.abs(fract(ph) - 0.5) * 2;
    h -= veins * 0.07 * sstep(0.75, 1, g) * sstep(0.08, 0.2, s) * (1 - s);
  }
  return h * Math.min(1, (w - a) / Math.max(W * 0.06, 1e-4) + 0.3);       // crisp rim
}

/** Palmate ivy leaf: polar about its body centre, axis +x, size R. */
function ivyH(lx, ly, R, veins) {
  const r = Math.hypot(lx, ly), al = Math.atan2(ly, lx);
  const lobe = (c, g, k) => g * Math.exp(-((al - c) / k) * ((al - c) / k));
  const lb = Math.max(lobe(0, 1, 0.42), lobe(0.95, 0.78, 0.36), lobe(-0.95, 0.78, 0.36), lobe(1.95, 0.55, 0.34), lobe(-1.95, 0.55, 0.34));
  const rho = R * (0.42 + 0.58 * lb) * sstep(Math.PI, Math.PI - 0.55, Math.abs(al));
  if (r >= rho) return -1;
  const q = r / rho;
  let h = 0.42 + 0.3 * dome(q * 0.95);
  if (veins > 0) {
    for (const c of [0, 0.95, -0.95, 1.95, -1.95]) {
      const d = r * Math.abs(Math.sin(al - c));
      if (Math.cos(al - c) > 0 && d < R * 0.035) h += veins * 0.07 * (1 - d / (R * 0.035));
    }
  }
  return h * Math.min(1, (rho - r) / (R * 0.06) + 0.3);
}

/**
 * Rose bloom radius R at the origin: K petal layers, outer → inner, each a
 * scalloped ring of cupped petals; the bud spirals in the middle.
 */
function roseH(x, y, R, rot, petals, variation, seed) {
  const r = Math.hypot(x, y);
  if (r >= R) return -1;
  const th = Math.atan2(y, x) + rot;
  const K = 4 + Math.round(petals * 4);
  for (let k = K - 1; k >= 0; k--) {
    const f = k / K;
    const Rk = R * Math.pow(1 - f, 0.85);
    const n = k === 0 ? 5 : k < K * 0.6 ? 5 : 3;
    const ph = k * 2.39996 + seed * 1.7 + variation * 0.6 * Math.sin(k * 3.1 + seed);
    const lobe = Math.pow(Math.abs(Math.cos(n * (th - ph) / 2)), 0.55);
    const edge = Rk * (0.74 + 0.26 * lobe);
    if (r < edge) {
      const rr = r / edge;
      let h = 0.42 + 0.5 * Math.pow((k + 1) / K, 0.75);              // inner petals stand taller
      h += 0.11 * sstep(0.5, 0.97, rr) * lobe;                       // rims curl up
      h -= 0.07 * (1 - sstep(0.04, 0.32, lobe)) * sstep(0.2, 0.6, rr);   // creases between petals
      if (k === K - 1 || r < R * 0.3) {                               // the bud's spiral
        const g = fract(th / TAU * 2 - 1.3 * Math.log(r / R + 1e-3));
        h -= 0.08 * (1 - sstep(0, 0.14, Math.min(g, 1 - g))) * sstep(R * 0.32, R * 0.12, r);
      }
      return h;
    }
  }
  return -1;
}

/** Rose with leaves tucked under its bloom (local frame, rot = turn). */
function roseWithLeaves(x, y, R, rot, P, seed) {
  let h = roseH(x, y, R, rot, P.petals, P.variation, seed);
  if (h >= 0) return h;
  const nl = 3 + (seed & 1);
  for (let i = 0; i < nl; i++) {
    const a = rot + i * TAU / nl + 0.4 * Math.sin(seed + i * 2.3);
    const c = Math.cos(a), s = Math.sin(a);
    const lx = x * c + y * s - R * 0.55, ly = -x * s + y * c;
    const lh = leafH(lx, ly, R * 1.35, R * 0.42, 0.9, P.veins);
    if (lh >= 0) h = Math.max(h, lh * 0.72);
  }
  return h;
}

/** Hooked thorn from a stem surface: base at (0,0), outward +n, leaning toward -s. */
function thornH(ds, dn, L, bw) {
  if (dn < 0 || dn > L) return 0;
  const t = dn / L;
  const c = -0.55 * L * Math.pow(t, 1.4);                     // curves back like a rose thorn
  const half = bw * Math.pow(1 - t, 1.15);
  const d = Math.abs(ds - c);
  return d < half ? (1 - 0.35 * t) : 0;
}

// ── Vines in along / across coordinates ─────────────────────────────────────
// s: along the stem, n: across (row spacing = 1), Ls: tile length in s.

function vineAt(V, P, s, n, rowKey, S) {
  const { Ls, K, A, sw } = V;
  const ph = TAU * hashf(rowKey, 1, S);
  const wob = V.wob;
  const c = (ss) => A * Math.sin(TAU * K * ss / Ls + ph) + wob * noise(ss / Ls, (rowKey + 0.5) * 0.37, 3, S + rowKey);
  const dc = (ss) => (c(ss + 1e-3) - c(ss - 1e-3)) / 2e-3;
  const cs = c(s), g = dc(s);
  const dStem = Math.abs(n - cs) / Math.sqrt(1 + g * g);
  let h = dStem < sw ? 0.5 + 0.28 * dome(dStem / sw) : 0;

  // thorns
  if (P.thorns > 0 && V.thornSp > 0) {
    const Qt = Math.max(1, Math.round(Ls / V.thornSp)), sp = Ls / Qt;
    const k0 = Math.floor(s / sp);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      const kk = mod(k, Qt);
      if (hashf(kk, rowKey, S + 5) > 0.35 + 0.65 * P.thorns) continue;
      const st = (k + 0.3 + 0.4 * hashf(kk, rowKey, S + 6)) * sp, side = hashf(kk, rowKey, S + 7) < 0.5 ? 1 : -1;
      const ct = c(st), gt = dc(st), ang = Math.atan(gt), ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = s - st, dy = n - ct;
      const ls = dx * ca + dy * sa, ln = (-dx * sa + dy * ca) * side - sw * 0.7;
      const f = thornH(ls, ln, V.thornL, V.thornW);
      if (f > 0) h = Math.max(h, 0.75 * f + 0.05);
    }
  }

  // leaves and roses at alternating nodes
  const Q = Math.max(1, Math.round(Ls / V.nodeSp)), sp = Ls / Q;
  const reach = Math.ceil((V.leafL + V.roseR * 2) / sp) + 1;
  const i0 = Math.floor(s / sp);
  for (let i = i0 - reach; i <= i0 + reach; i++) {
    const ii = mod(i, Q);
    const hs = hashf(ii, rowKey, S + 11);
    const isRose = V.roseR > 0 && hashf(ii, rowKey, S + 12) < P.flowers * 0.45;
    if (!isRose && hs > P.leaves) continue;
    const si = (i + 0.5 + (hashf(ii, rowKey, S + 13) - 0.5) * 0.5 * P.variation) * sp;
    const side = (mod(i, 2) ? 1 : -1) * (V.flip || 1);
    const ci = c(si), gi = dc(si), phi = Math.atan(gi);
    const dx = s - si, dy = n - ci;
    if (isRose) {
      const R = V.roseR * (0.85 + 0.3 * hashf(ii, rowKey, S + 14));
      const ox = -Math.sin(phi) * side * (sw + R * 0.75), oy = Math.cos(phi) * side * (sw + R * 0.75);
      const rh = roseWithLeaves(dx - ox, dy - oy, R, hashf(ii, rowKey, S + 15) * TAU, P, ii + rowKey * 7);
      if (rh > h) h = rh;
      continue;
    }
    const la = phi + side * (V.leafAngle + 0.25 * P.variation * (hashf(ii, rowKey, S + 16) - 0.5));
    const ca = Math.cos(la), sa = Math.sin(la);
    const lx = dx * ca + dy * sa, ly = -dx * sa + dy * ca;
    const L = V.leafL * (0.8 + 0.4 * hashf(ii, rowKey, S + 17));
    let lh;
    if (V.leaf === 'ivy') {
      lh = ivyH(lx - L * 0.62, ly, L * 0.55, P.veins);
      if (lx > 0 && lx < L * 0.45 && Math.abs(ly) < sw * 0.55) lh = Math.max(lh, 0.5 + 0.2 * dome(Math.abs(ly) / (sw * 0.55)));   // petiole
    }
    else if (V.leaf === 'pinna') {
      // fern: opposite pinnae, length following the frond's envelope
      const fr = V.frondLen, q = fract(si / fr);
      const env = Math.pow(Math.sin(Math.PI * q), 0.8);
      lh = leafH(lx - sw * 0.6, ly, L * (0.2 + 0.8 * env), L * 0.13 * (0.5 + 0.5 * env), 0.45, P.veins * 0.5);
      const la2 = phi - side * V.leafAngle, ca2 = Math.cos(la2), sa2 = Math.sin(la2);
      const lh2 = leafH(dx * ca2 + dy * sa2 - sw * 0.6, -dx * sa2 + dy * ca2, L * (0.2 + 0.8 * env), L * 0.13 * (0.5 + 0.5 * env), 0.45, P.veins * 0.5);
      lh = Math.max(lh, lh2);
    } else lh = leafH(lx - sw * 0.5, ly, L, L * V.leafW, V.serr, P.veins);
    if (lh > 0) h = Math.max(h, lh * V.leafLevel);
  }
  return h;
}

function vineSetup(P, rowsPerTile, opts = {}) {
  const Ls = opts.Ls ?? rowsPerTile;                 // one row spacing = 1 unit
  const sz = 0.5 + P.size;
  return {
    Ls,
    K: Math.max(1, Math.round((opts.K ?? 1) + 2 * P.waviness)),
    A: (opts.A ?? 0.12) * P.waviness,
    wob: 0.06 * P.variation,
    sw: (0.022 + 0.045 * P.width) * (opts.stemMul ?? 1),
    leafL: 0.32 * sz * (opts.leafMul ?? 1),
    leafW: opts.leafW ?? 0.32,
    serr: opts.serr ?? 0.8,
    leafAngle: opts.leafAngle ?? 0.85,
    leafLevel: opts.leafLevel ?? 0.82,
    nodeSp: 0.2 * sz * (opts.nodeMul ?? 1),
    roseR: opts.roses ? 0.17 * sz : 0,
    thornSp: opts.thornSp ?? 0.16,
    thornL: (0.04 + 0.1 * P.thorns) * (opts.thornMul ?? 1),
    thornW: (0.022 + 0.03 * P.width) * (opts.thornMul ?? 1),
    leaf: opts.leaf ?? 'blade',
    frondLen: opts.frondLen ?? 1,
  };
}

// ── Patterns ─────────────────────────────────────────────────────────────────

/** Horizontal vine rows: evaluates this row and both neighbours (leaves reach across). */
function vineRows(P, V, u, v, M, S) {
  const s = u * M, y = v * M, j0 = Math.floor(y);
  let h = 0;
  for (let dj = -1; dj <= 1; dj++) {
    const j = j0 + dj;
    h = Math.max(h, vineAt(V, P, s, y - (j + 0.5), mod(j, M), S));
  }
  return h;
}

/** Single rose: bloom, a curving stem with thorns and two leaves. */
function singleRose(P, u, v, S) {
  const R = 0.1 + 0.12 * P.size;
  const cx = 0.5 + 0.04, cy = 0.42;
  let h = Math.max(0, roseH(u - cx, v - cy, R, S * 0.37, P.petals, P.variation, S));
  if (h > 0) return h;
  // stem: a gentle curve from under the bloom down to the lower left
  const sw = 0.008 + 0.012 * P.width;
  const bez = (t) => [cx + (-0.02 - 0.1 * t) * t * 1.3, cy + R * 0.7 + 0.42 * t];
  let best = Infinity, bt = 0;
  for (let i = 0; i <= 48; i++) { const t = i / 48, [bx, by] = bez(t); const d = Math.hypot(u - bx, v - by); if (d < best) { best = d; bt = t; } }
  if (best < sw) h = Math.max(h, 0.5 + 0.28 * dome(best / sw));
  const tang = (t) => { const [a1, b1] = bez(Math.min(1, t + 0.01)), [a0, b0] = bez(Math.max(0, t - 0.01)); return Math.atan2(b1 - b0, a1 - a0); };
  for (const [t, side, kind] of [[0.22, 1, 'thorn'], [0.36, -1, 'leaf'], [0.5, -1, 'thorn'], [0.62, 1, 'leaf'], [0.78, 1, 'thorn'], [0.9, -1, 'thorn']]) {
    if (kind === 'thorn' && P.thorns <= 0) continue;
    if (kind === 'leaf' && P.leaves <= 0) continue;
    const [bx, by] = bez(t), a = tang(t), ca = Math.cos(a), sa = Math.sin(a);
    const dx = u - bx, dy = v - by, ls = dx * ca + dy * sa, ln = -dx * sa + dy * ca;
    if (kind === 'thorn') {
      const f = thornH(-ls, ln * side - sw * 0.7, 0.012 + 0.03 * P.thorns, sw * 1.1);
      if (f > 0) h = Math.max(h, 0.75 * f + 0.05);
    } else {
      const la = side * 0.8, cl = Math.cos(la), sl = Math.sin(la);
      const lx = ls * cl + ln * sl, ly = -ls * sl + ln * cl;
      const lh = leafH(lx - sw, ly, R * 1.5, R * 0.48, 0.9, P.veins);
      if (lh > 0) h = Math.max(h, lh * 0.8);
    }
  }
  return h;
}

const PAT = {
  rose(P, u, v, C) {
    if (P.layout === 'single') return singleRose(P, u, v, C.S);
    return PAT.roseGarden(P, u, v, C);
  },
  roseGarden(P, u, v, C) {
    const N = C.M, x = u * N, y = v * N, ci = Math.floor(x), cj = Math.floor(y);
    let h = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, ii = mod(i, N), jj = mod(j, N);
      const R = (0.16 + 0.16 * P.size) * (1 - 0.3 * P.variation * hashf(ii, jj, C.S + 2));
      const ox = i + 0.5 + (hashf(ii, jj, C.S + 3) - 0.5) * 0.45 * P.variation;
      const oy = j + 0.5 + (hashf(ii, jj, C.S + 4) - 0.5) * 0.45 * P.variation;
      const rh = roseWithLeaves(x - ox, y - oy, R, hashf(ii, jj, C.S + 5) * TAU, P, ii * 31 + jj);
      if (rh > h) h = rh;
    }
    return h;
  },
  roseVine(P, u, v, C) { return vineRows(P, C.V, u, v, C.M, C.S); },
  thornVine(P, u, v, C) { return vineRows(P, C.V, u, v, C.M, C.S); },
  ivy(P, u, v, C) { return vineRows(P, C.V, u, v, C.M, C.S); },
  fern(P, u, v, C) { return vineRows(P, C.V, u, v, C.M, C.S); },
  bramble(P, u, v, C) {
    // canes in two crossing families (along u, and along the diagonal)
    const M = C.M, a = vineRows(P, C.V, u, v, M, C.S);
    const M2 = Math.max(1, Math.round(M * 0.7));
    const s = (u + v) * M2, n = (u - v) * M2, j0 = Math.floor(n);
    let b = 0;
    for (let dj = -1; dj <= 1; dj++) {
      const j = j0 + dj;
      b = Math.max(b, vineAt(C.V2, P, mod(s, M2), n - (j + 0.5), mod(j, M2) + 50, C.S + 9));
    }
    return Math.max(a, b * 0.88);
  },
  wreath(P, u, v, C) {
    const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y), th = Math.atan2(y, x);
    const Rw = 0.3, unit = WREATH_UNIT;
    const Ls = TAU * Rw / unit;
    const s = (th / TAU + 0.5) * Ls, n = (r - Rw) / unit;
    if (Math.abs(n) > 3) return 0;
    let h = vineAt(C.V, P, s, n, 1, C.S);
    // a second, counter-running branch braided through it
    if (C.V2) h = Math.max(h, vineAt(C.V2, P, Ls - s, -n, 2, C.S + 3) * 0.95);
    return h;
  },
  canopy(P, u, v, C) {
    const G = Math.max(2, C.M * 2), x = u * G, y = v * G, ci = Math.floor(x), cj = Math.floor(y);
    let top = -1, h = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj, ii = mod(i, G), jj = mod(j, G);
      const ord = hashf(ii, jj, C.S + 21);
      if (ord <= top) continue;
      const a = hashf(ii, jj, C.S + 22) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const L = (0.9 + 0.7 * P.size) * (0.85 + 0.3 * hashf(ii, jj, C.S + 23));
      const ox = i + 0.5 + (hashf(ii, jj, C.S + 24) - 0.5) * 0.6 - ca * L * 0.5;
      const oy = j + 0.5 + (hashf(ii, jj, C.S + 25) - 0.5) * 0.6 - sa * L * 0.5;
      const dx = x - ox, dy = y - oy;
      const lh = leafH(dx * ca + dy * sa, -dx * sa + dy * ca, L, L * 0.3, 0.7, P.veins);
      if (lh > 0) { top = ord; h = 0.2 + 0.3 * ord + 0.5 * lh; }
    }
    return h;
  },
};

// ── Generator entry points (proceduralWorker.js) ────────────────────────────

function context(P) {
  const M = Math.max(1, Math.round(P.count));
  const C = { M, S: (P.seed | 0) * 7919 + 5 };
  switch (P.pattern) {
    case 'roseVine': C.V = vineSetup(P, M, { roses: true }); break;
    case 'thornVine': C.V = vineSetup(P, M, { thornSp: 0.1, thornMul: 1.4, leafMul: 0.8 }); break;
    case 'ivy': C.V = vineSetup(P, M, { leaf: 'ivy', leafMul: 1.2, nodeMul: 1.1, thornSp: 0, leafAngle: 0.95 }); break;
    case 'fern': C.V = vineSetup(P, M, { leaf: 'pinna', leafMul: 0.95, nodeMul: 0.3, thornSp: 0, leafAngle: 1.0, A: 0.06, frondLen: M / Math.max(1, Math.round(M / 2.2)) }); break;
    case 'bramble': {
      C.V = vineSetup(P, M, { thornSp: 0.12, thornMul: 1.7, stemMul: 1.5, leafMul: 0.9, nodeMul: 2.2 });
      const M2 = Math.max(1, Math.round(M * 0.7));
      C.V2 = vineSetup(P, M2, { Ls: M2, thornSp: 0.12, thornMul: 1.7, stemMul: 1.5, leafMul: 0.9, nodeMul: 2.2 });
      break;
    }
    case 'wreath': {
      const Ls = TAU * 0.3 / WREATH_UNIT;
      C.V = vineSetup(P, 1, { Ls, roses: P.flowers > 0, A: 0.35, K: 6, leafMul: 1.1, nodeMul: 0.8 });
      C.V2 = vineSetup(P, 1, { Ls, A: 0.35, K: 6, leafMul: 0.9, nodeMul: 1.1 });
      C.V2.flip = -1;
      break;
    }
  }
  return C;
}

export function botanicRows(params, size, y0, y1) {
  const P = { ...DEFAULT_BOTANIC_PARAMS, ...params };
  if (P.pattern === 'wreath') P.layout = 'single';
  const C = context(P);
  const fn = PAT[P.pattern] || PAT.roseVine;
  const out = new Float32Array(size * (y1 - y0)), inv = 1 / size;
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) * inv, row = (y - y0) * size;
    for (let x = 0; x < size; x++) out[row + x] = Math.max(0, fn(P, (x + 0.5) * inv, v, C));
  }
  return { struct: out };
}

export function botanicFinish(params, size, struct) {
  const P = { ...DEFAULT_BOTANIC_PARAMS, ...params };
  for (let i = 0; i < struct.length; i++) struct[i] = clamp01(struct[i]);
  if (P.softness > 0) blurWrap(struct, size, P.softness * size * 0.004);
  return struct;
}
