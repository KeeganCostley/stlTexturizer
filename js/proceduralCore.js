/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Shared primitives for the procedural map generators ──────────────────────
//
// Pure and DOM-free (runs in proceduralWorker.js). Everything is evaluated on
// the unit torus [0,1)² with integer lattice periods, so any field built from
// these tiles seamlessly by construction.

export const TAU = Math.PI * 2;

// ── Scalar helpers ───────────────────────────────────────────────────────────

export function hashi(a, b, c) {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 0x85ebca77) + 0x165667b1) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export const hashf = (a, b, c) => hashi(a, b, c) / 4294967296;

export const mod = (i, n) => ((i % n) + n) % n;
export const fract = (x) => x - Math.floor(x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export function sstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Log-interpolate an integer count: t=0 → a, t=1 → b. */
export const logCount = (a, b, t) =>
  Math.max(1, Math.round(Math.exp(lerp(Math.log(a), Math.log(b), clamp01(t)))));

// ── Periodic gradient noise ──────────────────────────────────────────────────

const GRAD_N = 16;
const GX = new Float32Array(GRAD_N), GY = new Float32Array(GRAD_N);
for (let i = 0; i < GRAD_N; i++) { GX[i] = Math.cos(i / GRAD_N * TAU); GY[i] = Math.sin(i / GRAD_N * TAU); }

/** Perlin noise with `P` lattice cells per tile; tiles with period 1. ~[-1,1]. */
export function noise(x, y, P, seed) {
  const fx = x * P, fy = y * P;
  const xf = Math.floor(fx), yf = Math.floor(fy);
  const tx = fx - xf, ty = fy - yf;
  const x0 = mod(xf, P), y0 = mod(yf, P);
  const x1 = x0 + 1 === P ? 0 : x0 + 1, y1 = y0 + 1 === P ? 0 : y0 + 1;
  const g00 = hashi(x0, y0, seed) & 15, g10 = hashi(x1, y0, seed) & 15;
  const g01 = hashi(x0, y1, seed) & 15, g11 = hashi(x1, y1, seed) & 15;
  const n00 = GX[g00] * tx + GY[g00] * ty;
  const n10 = GX[g10] * (tx - 1) + GY[g10] * ty;
  const n01 = GX[g01] * tx + GY[g01] * (ty - 1);
  const n11 = GX[g11] * (tx - 1) + GY[g11] * (ty - 1);
  const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  return 1.414 * lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Anisotropic Perlin noise: `Px` × `Py` lattice cells per tile (streaks, brushing). */
export function noise2(x, y, Px, Py, seed) {
  const fx = x * Px, fy = y * Py;
  const xf = Math.floor(fx), yf = Math.floor(fy);
  const tx = fx - xf, ty = fy - yf;
  const x0 = mod(xf, Px), y0 = mod(yf, Py);
  const x1 = x0 + 1 === Px ? 0 : x0 + 1, y1 = y0 + 1 === Py ? 0 : y0 + 1;
  const g00 = hashi(x0, y0, seed) & 15, g10 = hashi(x1, y0, seed) & 15;
  const g01 = hashi(x0, y1, seed) & 15, g11 = hashi(x1, y1, seed) & 15;
  const n00 = GX[g00] * tx + GY[g00] * ty;
  const n10 = GX[g10] * (tx - 1) + GY[g10] * ty;
  const n01 = GX[g01] * tx + GY[g01] * (ty - 1);
  const n11 = GX[g11] * (tx - 1) + GY[g11] * (ty - 1);
  const u = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
  const v = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
  return 1.414 * lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
}

/** Fractal sum; each octave doubles the (integer) period so it still tiles. */
export function fbm(x, y, P, octaves, gain, seed) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x, y, P, seed + o * 1013);
    norm += amp;
    amp *= gain;
    P *= 2;
  }
  return sum / norm;
}

/** Ridged fractal — sharp creases instead of rounded lumps. ~[-1,1]. */
export function ridged(x, y, P, octaves, gain, seed) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(noise(x, y, P, seed + o * 1013));
    sum += amp * n * n;
    norm += amp;
    amp *= gain;
    P *= 2;
  }
  return 2 * sum / norm - 1;
}

// ── Periodic Voronoi / power diagram ─────────────────────────────────────────
// `Nx`×`Ny` cells per tile. `rowShift` offsets odd rows (0.5 → hex packing;
// needs an even Ny to tile). `sy` scales row distances into column-cell units
// so non-square cell counts still measure true distance. `wAmp` > 0 gives each
// site a random weight (a power / Laguerre diagram): heavy sites swell and
// squeeze their neighbours, so cell sizes and side counts vary far more than
// in a jittered grid. Results land in `W` (and the 9 candidates in WC) to
// avoid per-pixel allocation.

export const W = { f1: 0, edge: 0, id1: 0, id2: 0, dx: 0, dy: 0, best: 0, fx: 0, fy: 0 };
export const WC = {
  dx: new Float64Array(9), dy: new Float64Array(9), id: new Int32Array(9),
  w: new Float64Array(9), gx: new Int32Array(9), gy: new Int32Array(9),
};

/** Site weight for power diagrams (cell units²), deterministic per wrapped cell. */
export const siteWeight = (wx, wy, seed, wAmp) => wAmp * (2 * hashf(wx, wy, seed + 99) - 1);

export function worley(x, y, Nx, Ny, jitter, seed, rowShift = 0, sy = 1, wAmp = 0) {
  const fx = x * Nx, fy = y * Ny;
  const cy = Math.floor(fy);
  const cdx = WC.dx, cdy = WC.dy, cid = WC.id, cw = WC.w, cgx = WC.gx, cgy = WC.gy;
  let best = 1e9, bi = 0, k = 0;
  for (let j = -1; j <= 1; j++) {
    const row = cy + j;
    const wy = mod(row, Ny);
    const shift = rowShift * (row & 1);
    const cx = Math.floor(fx - shift);
    for (let i = -1; i <= 1; i++, k++) {
      const gx = cx + i;
      const wx = mod(gx, Nx);
      const h = hashi(wx, wy, seed);
      const dx = fx - (gx + shift + 0.5 + jitter * ((h & 0xffff) / 65536 - 0.5));
      const dy = (fy - (row + 0.5 + jitter * ((h >>> 16) / 65536 - 0.5))) * sy;
      const w = wAmp > 0 ? siteWeight(wx, wy, seed, wAmp) : 0;
      cdx[k] = dx; cdy[k] = dy; cid[k] = wy * Nx + wx; cw[k] = w; cgx[k] = gx; cgy[k] = row;
      const d = dx * dx + dy * dy - w;
      if (d < best) { best = d; bi = k; }
    }
  }
  const mx = cdx[bi], my = cdy[bi], mw = cw[bi];
  const pm = mx * mx + my * my - mw;
  // Border distance = min over neighbours of the distance to the (power)
  // bisector: ((|p−s_k|² − w_k) − (|p−s_m|² − w_m)) / (2 |s_k − s_m|).
  let edge = 1e9, e2 = bi;
  for (k = 0; k < 9; k++) {
    if (k === bi) continue;
    const len = Math.hypot(mx - cdx[k], my - cdy[k]);
    if (len < 1e-9) continue;
    const dist = (cdx[k] * cdx[k] + cdy[k] * cdy[k] - cw[k] - pm) / (2 * len);
    if (dist < edge) { edge = dist; e2 = k; }
  }
  W.f1 = Math.sqrt(mx * mx + my * my);
  W.edge = edge < 0 ? 0 : edge;
  W.id1 = cid[bi];
  W.id2 = cid[e2];
  W.dx = mx; W.dy = my;
  W.best = bi;
  W.fx = fx; W.fy = fy;
}

// ── Lattice-snapped directions ───────────────────────────────────────────────
// Stripes/layers must be periodic, so their normal is an integer vector (a,b).
// Pick the small coprime (a,b) closest to the requested angle, repeat it n
// times for the requested count, and complete it to a unimodular basis (c,d)
// so the along-stripe coordinate c·u + d·v also tiles.

function gcd(a, b) { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; }
function egcd(a, b) {
  if (b === 0) return [a, 1, 0];
  const [g, x, y] = egcd(b, mod(a, b));
  return [g, y, x - Math.floor(a / b) * y];
}

/**
 * @param {number} angleDeg  direction the stripes run (0 = horizontal)
 * @param {number} count     approximate stripes per tile
 * @returns {{a,b,n,c,d,len}} normal (a,b), repeat n, completion (c,d), |(a,b)|
 */
export function lineLattice(angleDeg, count, maxComp = 4) {
  const target = ((angleDeg + 90) % 180 + 180) % 180;   // normal angle, 0..180
  let best = null, bestErr = 1e9;
  for (let a = -maxComp; a <= maxComp; a++) {
    for (let b = 0; b <= maxComp; b++) {
      if ((a === 0 && b === 0) || gcd(a, b) !== 1) continue;
      if (b === 0 && a < 0) continue;
      const ang = (Math.atan2(b, a) * 180 / Math.PI + 180) % 180;
      let err = Math.abs(ang - target); err = Math.min(err, 180 - err);
      err += Math.hypot(a, b) * 0.01;   // prefer short vectors on near-ties
      if (err < bestErr) { bestErr = err; best = [a, b]; }
    }
  }
  const [a, b] = best;
  const len = Math.hypot(a, b);
  const n = Math.max(1, Math.round(count / len));
  // a·x + b·y = 1  →  d = x, c = −y  gives a·d − b·c = 1
  const [, x, y] = egcd(a, b);
  let c = -y, d = x;
  // Shift along (a,b) to make (c,d) as orthogonal to (a,b) as possible.
  const k = Math.round(-(a * c + b * d) / (a * a + b * b));
  c += k * a; d += k * b;
  return { a, b, n, c, d, len };
}

// ── Seamless separable box blur (3 passes ≈ Gaussian) ────────────────────────

export function blurWrap(src, size, radius) {
  const r = Math.round(radius);
  if (r < 1) return src;
  const tmp = new Float32Array(src.length);
  const inv = 1 / (2 * r + 1);
  const a = src, b = tmp;
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < size; y++) {
      const row = y * size;
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[row + mod(k, size)];
      for (let x = 0; x < size; x++) {
        b[row + x] = s * inv;
        s += a[row + mod(x + r + 1, size)] - a[row + mod(x - r, size)];
      }
    }
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += b[mod(k, size) * size + x];
      for (let y = 0; y < size; y++) {
        a[y * size + x] = s * inv;
        s += b[mod(y + r + 1, size) * size + x] - b[mod(y - r, size) * size + x];
      }
    }
  }
  return a;
}

// ── Output ───────────────────────────────────────────────────────────────────

/** Min/max stretch → 0..1 in place. */
export function normaliseMinMax(a) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi - lo > 1e-9)) { a.fill(0.5); return a; }
  const k = 1 / (hi - lo);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - lo) * k;
  return a;
}

/** Percentile stretch (clip `pct` at each end) → 0..1 via a 4096-bin histogram. */
export function normalise(a, pct = 0.002) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
  if (!(hi - lo > 1e-9)) { a.fill(0.5); return a; }
  const BINS = 4096, hist = new Uint32Array(BINS), sc = (BINS - 1) / (hi - lo);
  for (let i = 0; i < a.length; i++) hist[((a[i] - lo) * sc) | 0]++;
  const cut = a.length * pct;
  let acc = 0, b0 = 0, b1 = BINS - 1;
  for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc > cut) { b0 = b; break; } }
  acc = 0;
  for (let b = BINS - 1; b >= 0; b--) { acc += hist[b]; if (acc > cut) { b1 = b; break; } }
  const pLo = lo + b0 / sc, pHi = lo + (b1 + 1) / sc;
  const k = 1 / Math.max(pHi - pLo, 1e-9);
  for (let i = 0; i < a.length; i++) a[i] = clamp01((a[i] - pLo) * k);
  return a;
}

/** Heights → greyscale RGBA bytes ready for ImageData. */
export function heightsToRGBA(h) {
  const px = new Uint8ClampedArray(h.length * 4);
  for (let i = 0, j = 0; i < h.length; i++, j += 4) {
    const g = Math.round(h[i] * 255);
    px[j] = px[j + 1] = px[j + 2] = g;
    px[j + 3] = 255;
  }
  return px;
}
