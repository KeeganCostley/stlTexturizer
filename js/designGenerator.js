/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Procedural design-surface heightmap generator ────────────────────────────
//
// Refined product-design surfaces, drawn from:
//   generative / parametric  reaction–diffusion, flow lines, gyroid, Voronoi
//                            lattice, modulated (kinetic-facade) ribs
//   horology                 Côtes de Genève, Clous de Paris, barleycorn guilloché
//   Japanese / Islamic craft seigaiha, asanoha kumiko, star-and-cross strapwork
//   luxury materials         intrecciato leather, matelassé, crackle glaze,
//                            brushed metal
//   architecture / folding   coffered ceiling, Miura-ori
//   organic                  drapery, topographic contours
//
// Every pattern reads the same parameter slots (density, angle, width,
// softness, waviness, waveCount, variation, accent, detail); the preset table
// in designPresets.js says which slots a pattern uses and what to call them.

import {
  TAU, hashf, mod, fract, lerp, clamp01, sstep, fbm, noise2,
  W, WC, worley, lineLattice, normalise,
} from './proceduralCore.js';

import { TATTOO_STYLES, buildTattoo, tattooHeight } from './tattooShapes.js';
import { GROWTH_STYLES, buildGrowth, growthHeight } from './growthShapes.js';

export { heightsToRGBA } from './proceduralCore.js';

export const PATTERNS = [
  'labyrinth', 'bloom', 'flowLines', 'gyroid', 'voronoiLattice', 'modRibs',
  'geneva', 'clous', 'barleycorn', 'seigaiha', 'asanoha', 'moorish',
  'intrecciato', 'matelasse', 'crackle', 'brushed', 'coffered', 'miura',
  'drapery', 'contours',
  'schwarzP', 'schwarzD', 'neovius', 'trabecular',
  'tribalBlades', 'tatau', 'koru', 'cyberSigil', 'thornVines',
  'barbedWire', ...Object.keys(TATTOO_STYLES), ...Object.keys(GROWTH_STYLES),
];

const TPMS = new Set(['gyroid', 'schwarzP', 'schwarzD', 'neovius', 'trabecular']);

export const DEFAULT_DESIGN_PARAMS = Object.freeze({
  seed: 1,
  pattern: 'flowLines',
  density: 12,
  angle: 0,
  width: 0.3,
  softness: 0.6,
  waviness: 0.5,
  waveCount: 3,
  variation: 0,
  accent: 0.5,
  detail: 0.5,
  asymmetry: 0,         // organic distortion / breaks mirror symmetry
  // Variability (tattoo motifs)
  scatter: 0,           // random motif offsets
  rotation: 0,          // random motif rotation
  scaleVar: 0,          // random motif scale
  // Growth (organic stroke growth)
  length: 0.5,
  curl: 0.4,
  flow: 0.5,
  branching: 0.3,
  thorns: 0.3,
  spacing: 0.35,
  bubble: 0,            // TPMS: thin walls → solid bubbly network
});

// ── Shaping helpers ──────────────────────────────────────────────────────────

/** Edge profile, x = 0 at the crest … 1 at the edge: crisp → chamfer → round → soft. */
function profile(x, s) {
  if (x >= 1) return 0;
  if (x <= 0) return 1;
  const crisp = 1 - sstep(0.82, 1, x);
  const lin = 1 - x;
  const round = Math.sqrt(1 - x * x);
  const cosine = 0.5 + 0.5 * Math.cos(Math.PI * x);
  if (s < 1 / 3) return lerp(crisp, lin, s * 3);
  if (s < 2 / 3) return lerp(lin, round, s * 3 - 1);
  return lerp(round, cosine, s * 3 - 2);
}

/** Symmetric band around each integer + 0.5 of t; `w` = band width fraction. */
function band(t, w, s) {
  return profile(Math.abs(fract(t) - 0.5) * 2 / Math.max(w, 1e-3), s);
}

// ── Triply periodic minimal surfaces (level-set functions, ~±1.5) ────────────

function tpmsField(kind, X, Y, Z) {
  const sx = Math.sin(X), cx = Math.cos(X), sy = Math.sin(Y), cy = Math.cos(Y), sz = Math.sin(Z), cz = Math.cos(Z);
  switch (kind) {
    case 'schwarzP': return (cx + cy + cz) * 0.55;
    case 'schwarzD': return sx * sy * sz + sx * cy * cz + cx * sy * cz + cx * cy * sz;
    case 'neovius':  return (3 * (cx + cy + cz) + 4 * cx * cy * cz) / 7;
    default:         return sx * cy + sy * cz + sz * cx;   // gyroid
  }
}

/** Triangle wave: 0 at integers, 1 at half-integers. */
const tri = (x) => 1 - Math.abs(2 * fract(x) - 1);

/** Polynomial smooth-min (fillets where two distance fields meet). */
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

function segDist(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay;
  const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
}

function sdBox(px, py, r) {
  const qx = Math.abs(px) - r, qy = Math.abs(py) - r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

/** Two smallest border distances of the last worley() call (for filleted struts). */
let E1 = 0, E2 = 0;
function voronoiEdges2() {
  const bi = W.best, mx = WC.dx[bi], my = WC.dy[bi];
  E1 = 1e9; E2 = 1e9;
  for (let k = 0; k < 9; k++) {
    if (k === bi) continue;
    const ex = mx - WC.dx[k], ey = my - WC.dy[k];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const d = Math.max(0, -((WC.dx[k] + mx) * 0.5 * ex + (WC.dy[k] + my) * 0.5 * ey) / len);
    if (d < E1) { E2 = E1; E1 = d; } else if (d < E2) E2 = d;
  }
}

// ── Reaction–diffusion (Gray–Scott on a torus) ───────────────────────────────
// Global simulation, so each worker computes it once per recipe and caches it;
// row bands then just sample the cached field.

let _rdKey = null, _rdField = null, _rdG = 0;
let _growthKey = null, _growthCtx = null;

function reactionDiffusion(G, F, k, seed, iters) {
  const n = G * G;
  let U = new Float32Array(n).fill(1), V = new Float32Array(n);
  let U2 = new Float32Array(n), V2 = new Float32Array(n);
  // Seed scattered droplets so the pattern grows evenly across the tile.
  const drops = Math.max(6, Math.round(n / 300));
  for (let s = 0; s < drops; s++) {
    const cx = Math.floor(hashf(s, 1, seed) * G), cy = Math.floor(hashf(s, 2, seed) * G);
    const r = 2 + Math.floor(hashf(s, 3, seed) * 3);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const i = mod(cy + dy, G) * G + mod(cx + dx, G);
        U[i] = 0.5; V[i] = 0.25 + 0.1 * hashf(i, 4, seed);
      }
    }
  }
  const Du = 1.0, Dv = 0.5;
  const up = new Int32Array(G), dn = new Int32Array(G);
  for (let i = 0; i < G; i++) { up[i] = mod(i - 1, G); dn[i] = mod(i + 1, G); }
  for (let it = 0; it < iters; it++) {
    for (let y = 0; y < G; y++) {
      const ry = y * G, ru = up[y] * G, rd = dn[y] * G;
      for (let x = 0; x < G; x++) {
        const xl = up[x], xr = dn[x];
        const i = ry + x;
        const u = U[i], v = V[i];
        const lu = 0.2 * (U[ry + xl] + U[ry + xr] + U[ru + x] + U[rd + x])
                 + 0.05 * (U[ru + xl] + U[ru + xr] + U[rd + xl] + U[rd + xr]) - u;
        const lv = 0.2 * (V[ry + xl] + V[ry + xr] + V[ru + x] + V[rd + x])
                 + 0.05 * (V[ru + xl] + V[ru + xr] + V[rd + xl] + V[rd + xr]) - v;
        const uvv = u * v * v;
        U2[i] = u + Du * lu - uvv + F * (1 - u);
        V2[i] = v + Dv * lv + uvv - (F + k) * v;
      }
    }
    let t = U; U = U2; U2 = t;
    t = V; V = V2; V2 = t;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (V[i] < lo) lo = V[i]; if (V[i] > hi) hi = V[i]; }
  const sc = 1 / Math.max(hi - lo, 1e-6);
  for (let i = 0; i < n; i++) V[i] = (V[i] - lo) * sc;
  return V;
}

/** Periodic Catmull-Rom sample of a G×G field at tile coords (u,v). */
const _wx = new Float64Array(4), _wy = new Float64Array(4);
function cr(t, w) {
  w[0] = ((-t + 2) * t - 1) * t * 0.5;
  w[1] = (((3 * t - 5) * t) * t + 2) * 0.5;
  w[2] = ((-3 * t + 4) * t + 1) * t * 0.5;
  w[3] = ((t - 1) * t * t) * 0.5;
}
function sampleBicubic(f, G, u, v) {
  const x = u * G - 0.5, y = v * G - 0.5;
  const xi = Math.floor(x), yi = Math.floor(y);
  cr(x - xi, _wx); cr(y - yi, _wy);
  let s = 0;
  for (let j = 0; j < 4; j++) {
    const row = mod(yi - 1 + j, G) * G;
    let r = 0;
    for (let i = 0; i < 4; i++) r += _wx[i] * f[row + mod(xi - 1 + i, G)];
    s += _wy[j] * r;
  }
  return s;
}

// ── Generator ────────────────────────────────────────────────────────────────

/**
 * @param {object} params  see DEFAULT_DESIGN_PARAMS
 * @param {number} size    output resolution (square)
 * @returns {Float32Array} size×size heights in 0..1
 */
export function generateDesignHeights(params, size) {
  return designFinish(params, size, designRows(params, size, 0, size).struct);
}

/** Per-pixel stage for rows [y0, y1) — split across workers for big maps. */
export function designRows(params, size, y0, y1) {
  const p = { ...DEFAULT_DESIGN_PARAMS, ...params };
  const N = Math.max(1, Math.round(p.density));
  const Neven = Math.max(2, N + (N & 1));
  const S = (p.seed | 0) * 7919;
  const wc = Math.max(1, Math.round(p.waveCount));
  const L = lineLattice(p.angle, N);
  const Lev = lineLattice(p.angle, Neven);
  if (Lev.n & 1) Lev.n += 1;   // barleycorn alternates phase per line → needs an even count
  const pat = p.pattern;
  const out = new Float32Array(size * (y1 - y0));
  const inv = 1 / size;
  const diag = Math.abs(((p.angle % 90) + 90) % 90 - 45) < 22.5;
  const SQ3 = Math.sqrt(3) / 2;
  const triRows = Math.max(2, 2 * Math.round(N / SQ3 / 2));

  // Reaction–diffusion field (cached per worker)
  if (pat === 'labyrinth' || pat === 'bloom') {
    const G = Math.min(224, Math.max(48, Math.round(N * 11)));
    const [F, k] = pat === 'labyrinth' ? [0.029, 0.057] : [0.0367, 0.0649];
    const iters = 2500 + 28 * G;
    const key = `${pat}|${G}|${p.seed}`;
    if (_rdKey !== key) {
      _rdField = reactionDiffusion(G, F, k, S + 3, iters);
      _rdKey = key; _rdG = G;
    }
  }

  const tattoo = TATTOO_STYLES[pat] ? buildTattoo(pat, p, N, S + 81) : null;
  let growth = null;
  if (GROWTH_STYLES[pat]) {   // growth is size-independent → cache per worker
    const key = JSON.stringify(p);
    if (_growthKey !== key) { _growthCtx = buildGrowth(pat, p, S + 83); _growthKey = key; }
    growth = _growthCtx;
  }

  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      if (tattoo) { out[(y - y0) * size + x] = tattooHeight(tattoo, u, v); continue; }
      if (growth) { out[(y - y0) * size + x] = growthHeight(growth, u, v); continue; }
      const sAlong = L.c * u + L.d * v;
      let h = 0;

      switch (pat) {
        // ── Generative / parametric ──────────────────────────────────────────
        case 'labyrinth':
        case 'bloom': {
          let wu = u, wv = v;
          if (p.waviness > 0) {
            wu += p.waviness * 0.04 * fbm(u, v, 2, 3, 0.5, S + 5);
            wv += p.waviness * 0.04 * fbm(u, v, 2, 3, 0.5, S + 6);
          }
          const f = clamp01(sampleBicubic(_rdField, _rdG, wu, wv));
          const th = 1 - p.width;   // wider → thicker ridges
          const crisp = sstep(th - 0.06, th + 0.06, f);
          h = lerp(crisp, sstep(th - 0.35, th + 0.35, f), p.softness);
          break;
        }

        case 'flowLines': {
          const warp = p.waviness * L.n * (0.14 * fbm(u, v, 2, 4, 0.5, S + 7) + 0.04 * fbm(u, v, 5, 3, 0.5, S + 8));
          const t = L.n * (L.a * u + L.b * v) + warp;
          h = band(t, p.width, p.softness);
          if (p.detail > 0) h = Math.max(h, p.detail * 0.55 * band(t + 0.5, p.width * 0.45, p.softness));
          if (p.variation > 0) h *= 1 - p.variation * (0.5 + 0.5 * fbm(u, v, 3, 3, 0.5, S + 9));
          break;
        }

        case 'gyroid':
        case 'schwarzP':
        case 'schwarzD':
        case 'neovius':
        case 'trabecular': {
          // Oblique slice through a 3D minimal surface. Z is tied to an integer
          // multiple of u+v so the slice still tiles.
          let uu = u, vv = v;
          if (p.asymmetry > 0) {   // organic: cells swell, shrink and lean
            const A = p.asymmetry * 0.5 / N;
            uu += A * (fbm(u, v, 2, 3, 0.5, S + 41) + 0.35 * fbm(u, v, Math.max(2, N), 2, 0.5, S + 42));
            vv += A * (fbm(u, v, 2, 3, 0.5, S + 43) + 0.35 * fbm(u, v, Math.max(2, N), 2, 0.5, S + 44));
          }
          const M = Math.max(1, Math.round(N / 2));
          const X = TAU * N * uu, Y = TAU * N * vv;
          const Z = TAU * M * (uu + vv) + TAU * p.accent + p.waviness * TAU * 0.6 * fbm(u, v, 2, 3, 0.5, S + 11);
          let g = tpmsField(pat, X, Y, Z);
          if (pat === 'trabecular') g = 0.75 * g + 0.35 * tpmsField('gyroid', 2 * X, 2 * Y, 2 * Z + 1.3);
          const wl = Math.max(0.02, (0.05 + p.width * 1.4) * (1 + p.variation * 0.9 * fbm(u, v, 3, 3, 0.5, S + 47)));
          const walls = profile(Math.abs(g) / wl, p.softness);
          const sw = 0.12 + p.softness * 0.6;
          const solid = sstep(-sw, sw, g + (p.width - 0.5) * 0.8);
          h = lerp(walls, solid, p.bubble);
          break;
        }

        case 'voronoiLattice': {
          let wu = u, wv = v;
          if (p.waviness > 0) {
            wu += p.waviness * 0.2 / N * fbm(u, v, Math.max(2, N >> 1), 3, 0.5, S + 13);
            wv += p.waviness * 0.2 / N * fbm(u, v, Math.max(2, N >> 1), 3, 0.5, S + 14);
          }
          worley(wu, wv, N, N, 0.25 + 0.75 * p.variation, S + 15);
          voronoiEdges2();
          const d = smin(E1, E2, 0.02 + p.accent * 0.18);   // fillets swell the nodes
          const sw = 0.015 + p.width * 0.16;
          h = profile(Math.max(0, d) / sw, p.softness);
          if (p.detail > 0) {   // shallow domed cell floors
            const tt = W.f1 / (W.f1 + W.edge + 1e-9);
            h = Math.max(h, p.detail * 0.3 * (1 - tt * tt));
          }
          break;
        }

        case 'modRibs': {
          // Kinetic-facade ribs: width and depth swell in a travelling wave.
          const t = L.n * (L.a * u + L.b * v);
          const m = Math.round(p.accent * 4);
          const phase = TAU * (wc * sAlong + m * (L.a * u + L.b * v));
          const mod1 = 0.5 + 0.5 * Math.sin(phase);
          const w = lerp(1, lerp(0.12, 1, mod1), p.waviness);
          h = band(t, w, p.softness) * lerp(1, 0.35 + 0.65 * mod1, p.variation);
          break;
        }

        // ── Horology ────────────────────────────────────────────────────────
        case 'geneva': {
          // Côtes de Genève: overlapping stripes, each swept by fine arcs.
          const t = L.n * (L.a * u + L.b * v);
          const f = fract(t);
          const stripe = 0.72 * profile(Math.abs(f - 0.5) * 2, 0.66) + 0.28 * (1 - f);
          const sa = sAlong * L.n;
          const ax = fract(sa) - 0.5, ay = f + 0.9;
          const arcs = 0.5 + 0.5 * Math.cos(TAU * Math.hypot(ax, ay) * (2 + p.detail * 8));
          h = stripe + p.accent * 0.3 * arcs;
          break;
        }

        case 'clous': {
          // Clous de Paris: crisp hobnail pyramids between engraved V-grooves.
          const pp = diag ? N * (u + v) : N * u, qq = diag ? N * (u - v) : N * v;
          const d = Math.max(Math.abs(fract(pp) - 0.5), Math.abs(fract(qq) - 0.5)) * 2;
          const plateau = (1 - p.width) * 0.6;
          h = profile(Math.max(0, d - plateau) / (1 - plateau), p.softness * 0.5);
          h -= p.accent * 0.35 * (1 - sstep(0, 0.07, 1 - d));
          break;
        }

        case 'barleycorn': {
          // Barleycorn guilloché: engraved wave lines, alternate lines phase-shifted.
          const base = Lev.n * (Lev.a * u + Lev.b * v);
          const sA = Lev.c * u + Lev.d * v;
          const A = 0.2 + p.waviness * 0.6;
          const i0 = Math.floor(base);
          let d = 1e9;
          for (let i = i0 - 2; i <= i0 + 2; i++) {
            const ph = TAU * wc * sA + (i & 1) * Math.PI * 2 * p.accent;
            d = Math.min(d, Math.abs(base + A * Math.sin(ph) - i));
          }
          h = 1 - profile(d / (0.04 + p.width * 0.4), p.softness);
          break;
        }

        // ── Japanese / Islamic craft ────────────────────────────────────────
        case 'seigaiha': {
          const R = Neven * 2, fx = u * N, fy = v * R;
          const jy = Math.floor(fy);
          h = 0;
          for (let j = jy + 3; j >= jy - 2; j--) {
            const cx = fx - 0.5 * mod(j, 2);
            const i = Math.round(cx);
            const d = Math.hypot(cx - i, (fy - j) * (N / R));
            if (d < 1) {
              const rings = band(d * wc + 0.5, p.width, p.softness);
              const rim = 1 - sstep(0.9, 1, d);
              h = 0.25 + 0.75 * Math.max(rings * rim, p.accent * (1 - sstep(0.0, 0.08, 1 - d)));
              break;
            }
          }
          break;
        }

        case 'asanoha': {
          // Hemp-leaf kumiko on an equilateral triangle lattice.
          const X = u * N, Y = v * triRows * SQ3;
          const b = Y / SQ3, a = X - 0.5 * b;
          const i = Math.floor(a), j = Math.floor(b);
          const up = (a - i) + (b - j) > 1;
          const a0 = up ? i + 1 : i, b0 = j;
          const a1 = up ? i + 1 : i + 1, b1 = up ? j + 1 : j;
          const a2 = i, b2 = j + 1;
          const x0 = a0 + 0.5 * b0, y0v = SQ3 * b0;
          const x1 = a1 + 0.5 * b1, y1v = SQ3 * b1;
          const x2 = a2 + 0.5 * b2, y2v = SQ3 * b2;
          const gx = (x0 + x1 + x2) / 3, gy = (y0v + y1v + y2v) / 3;
          const de = Math.min(segDist(X, Y, x0, y0v, x1, y1v), segDist(X, Y, x1, y1v, x2, y2v), segDist(X, Y, x2, y2v, x0, y0v));
          const dm = Math.min(segDist(X, Y, x0, y0v, gx, gy), segDist(X, Y, x1, y1v, gx, gy), segDist(X, Y, x2, y2v, gx, gy));
          const lw = 0.015 + p.width * 0.07;
          h = Math.max(profile(de / (lw * (1 + p.accent)), p.softness),
                       (1 - 0.35 * p.accent) * profile(dm / lw, p.softness));
          break;
        }

        case 'moorish': {
          // Star-and-cross strapwork (8-fold), optional double-line straps.
          const fx = u * N, fy = v * N;
          const r = 0.3536 * (0.8 + 0.2 * p.accent);
          let sd = 1e9;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const px = fract(fx) - 0.5 - i, py = fract(fy) - 0.5 - j;
              const star = Math.min(sdBox(px, py, r), sdBox((px + py) * Math.SQRT1_2, (px - py) * Math.SQRT1_2, r));
              sd = Math.min(sd, star);
            }
          }
          const lw = 0.012 + p.width * 0.06;
          h = profile(Math.abs(sd) / lw, p.softness);
          if (p.detail > 0) h -= p.detail * 0.8 * profile(Math.abs(sd) / (lw * 0.35), 1);
          if (p.variation > 0 && sd < 0) h = Math.max(h, p.variation * 0.3);   // raised star fields
          break;
        }

        // ── Luxury materials ────────────────────────────────────────────────
        case 'intrecciato': {
          const pp = N * (u + v), qq = N * (u - v);
          const i = Math.floor(pp), j = Math.floor(qq);
          const fp = pp - i, fq = qq - j;
          const w = 0.55 + 0.43 * p.width;
          const edge = p.softness / 3;
          const prA = profile(Math.abs(fq - 0.5) * 2 / w, edge);
          const prB = profile(Math.abs(fp - 0.5) * 2 / w, edge);
          const aTop = ((i + j) & 1) === 0;
          const top = aTop ? prA : prB, under = aTop ? prB : prA;
          const along = aTop ? fp : fq;
          const bulge = 0.8 + 0.2 * Math.sin(Math.PI * along);
          h = top > 0 ? (1 - 0.45 * p.accent) + 0.45 * p.accent * top * bulge : 0.5 * under * (1 - 0.45 * p.accent);
          break;
        }

        case 'matelasse': {
          const pp = N * (u + v), qq = N * (u - v);
          const fp = fract(pp), fq = fract(qq);
          const puff = Math.pow(Math.sin(Math.PI * fp) * Math.sin(Math.PI * fq), 0.3 + 0.4 * (1 - p.softness));
          const ep = Math.min(fp, 1 - fp), eq = Math.min(fq, 1 - fq);
          h = puff - p.accent * 0.4 * (1 - sstep(0, 0.05, Math.min(ep, eq)));
          if (p.detail > 0) {   // dashed topstitching running beside each seam
            const stitches = 5;
            const dp = Math.abs(ep - 0.085) < 0.012 && fract(qq * stitches) < 0.62;
            const dq = Math.abs(eq - 0.085) < 0.012 && fract(pp * stitches) < 0.62;
            if (dp || dq) h -= p.detail * 0.12;
          }
          break;
        }

        case 'crackle': {
          // Crackle glaze: domed glaze cells, crazing lines at two scales.
          const wu = u + 0.25 / N * fbm(u, v, Math.max(2, N), 3, 0.5, S + 17);
          const wv = v + 0.25 / N * fbm(u, v, Math.max(2, N), 3, 0.5, S + 18);
          worley(wu, wv, N, N, 1, S + 19);
          const tt = W.f1 / (W.f1 + W.edge + 1e-9);
          const cw = 0.02 + p.width * 0.08;
          const c1 = Math.pow(Math.max(0, 1 - W.edge / cw), 1.5);
          h = p.detail * 0.25 * (1 - tt * tt) - c1;
          if (p.accent > 0) {
            const N2 = Math.round(N * 2.6);
            worley(wu, wv, N2, N2, 1, S + 21);
            const lo = Math.min(W.id1, W.id2), hi = Math.max(W.id1, W.id2);
            if (hashf(lo, hi, S) < 0.55) h -= p.accent * 0.55 * Math.pow(Math.max(0, 1 - W.edge / (cw * 0.7)), 1.5);
          }
          break;
        }

        case 'brushed': {
          // Directional hairline finish: many streaks across, few along.
          const across = L.a * u + L.b * v, along = L.c * u + L.d * v;
          const P = N * 8;
          h = 0;
          let amp = 1;
          for (let o = 0; o < 4; o++) {
            h += amp * noise2(across, along, P << o, 2 << o, S + 23 + o);
            amp *= 0.55;
          }
          if (p.variation > 0) {   // occasional deeper scratches
            const sc = Math.abs(noise2(across, along, N * 3, 1, S + 31));
            h -= p.variation * 1.5 * (1 - sstep(0, 0.05, sc));
          }
          break;
        }

        // ── Architecture / folding ──────────────────────────────────────────
        case 'coffered': {
          const pp = diag ? N * (u + v) / 2 : N * u, qq = diag ? N * (u - v) / 2 : N * v;
          const fp = fract(pp), fq = fract(qq);
          const e = Math.min(fp, 1 - fp, fq, 1 - fq);   // 0 on the rib centreline … 0.5 mid-panel
          const ribW = 0.025 + (1 - p.width) * 0.12;
          const K = 1 + Math.round(p.detail * 3);
          const stepW = Math.max(0.01, (0.5 - ribW) * 0.55 / K);
          const lvl = clamp01((e - ribW) / (stepW * K)) * K;
          const base = Math.floor(lvl), fr = lvl - base;
          const tw = 0.08 + p.softness * 0.85;   // riser softness
          const stepped = Math.min(K, base + sstep(1 - tw, 1, fr));
          h = 1 - stepped / K;
          if (p.accent > 0) {   // rosette boss in each panel
            const dc = Math.hypot(fp - 0.5, fq - 0.5);
            h = Math.max(h, p.accent * 0.6 * profile(dc / 0.12, 0.7));
          }
          break;
        }

        case 'miura': {
          const A = 0.35 + p.accent * 2.5;
          const tr = tri(N * v + A * tri(u * wc));
          h = lerp(tr, sstep(0, 1, tr), p.softness);
          break;
        }

        // ── Tribal ──────────────────────────────────────────────────────────
        case 'tribalBlades': {
          // Mirror-symmetric sweeping blades that taper to points.
          let X = tri(u) + p.asymmetry * 0.25 * fbm(u, v, 2, 3, 0.5, S + 51), Y = v;
          if (p.scatter > 0) {   // multi-scale warp: strokes wander further from the base flow
            X += p.scatter * 0.12 * fbm(X, Y, 4, 3, 0.5, S + 54);
            Y += p.scatter * 0.12 * fbm(X, Y, 4, 3, 0.5, S + 55);
          }
          const curve = 0.6 + p.waviness * 1.6;
          const t = N * (Y + curve * 0.5 * X * X) + (0.9 + p.rotation * 2.5) * fbm(X, Y, 2, 3, 0.5, S + 52);
          const taper = sstep(-0.35, 0.55, fbm(X, Y, 3, 3, 0.5, S + 53));
          const wVar = 1 + p.scaleVar * 0.8 * fbm(X, Y, 2, 2, 0.5, S + 56);
          h = band(t, (0.15 + p.width * 0.75) * taper * Math.max(0.2, wVar), p.softness / 3);
          if (p.detail > 0) h -= p.detail * 0.5 * band(t, (0.05 + p.width * 0.2) * taper, 0);   // inner cut line
          break;
        }

        case 'tatau': {
          // Polynesian tatau: stacked bands of shark teeth, spearheads, waves, chevrons, lines.
          const fy = fract(v * N), j = mod(Math.floor(v * N), N);
          const motif = Math.floor(hashf(j, 1, S) * 6);
          const C = Math.max(2, Math.round(N * (1.5 + hashf(j, 2, S)) * (0.6 + p.accent)));
          const x = u * C, fx = fract(x);
          const w = 0.08 + p.width * 0.25;
          let d;
          switch (motif) {
            case 0: d = tri(x) * 0.9 - fy; break;                                   // niho mano (shark teeth)
            case 1: d = 0.5 - (Math.abs(fx - 0.5) + Math.abs(fy - 0.5)); break;       // spearheads
            case 2: d = w - Math.abs(fy - 0.5 - 0.28 * Math.sin(TAU * x)); break;     // ocean waves
            case 3: d = w - Math.abs(fract(fy * 1.5 + tri(x) * 0.6) - 0.5) * 0.66; break; // chevrons
            case 4: d = w * 0.6 - Math.abs(fract(fy * 3) - 0.5) / 3; break;           // triple lines
            default: d = Math.min(0.9 - fy, tri(x + 0.5) * 0.9 - (1 - fy)) - 0.05;     // interlocking teeth
          }
          const frame = 0.035 - Math.min(fy, 1 - fy);   // raised divider between bands
          const bevel = 0.015 + p.softness * 0.12;
          h = Math.max(sstep(0, bevel, d), sstep(0, bevel, frame));
          break;
        }

        case 'koru': {
          // Koru spirals: an unfurling fern-frond spiral in every cell, alternating hands.
          worley(u, v, N, N, 0.55, S + 57);
          const r = W.f1, hand = hashf(W.id1, 1, S) < 0.5 ? 1 : -1;
          const th = Math.atan2(W.dy, W.dx);
          const tight = 0.35 + wc * 0.22;
          const phi = hand * th / TAU + tight * Math.log(r + 0.03);
          const edgeFade = sstep(0.02, 0.12, W.edge);
          const taper = 0.25 + 0.75 * clamp01(r * 2);
          h = band(phi, (0.15 + p.width * 0.5) * taper, p.softness / 2) * edgeFade;
          h = Math.max(h, profile(r / (0.08 + p.accent * 0.12), 0.66));   // bulb at the heart
          if (p.detail > 0) h = Math.max(h, p.detail * (1 - sstep(0, 0.025, W.edge)));   // cell outline
          break;
        }

        // ── Cyber sigilism ──────────────────────────────────────────────────
        case 'cyberSigil': {
          // Mirrored needle strokes: thin flowing lines that taper to sharp points.
          let X = tri(u) + p.asymmetry * 0.25 * fbm(u, v, 2, 3, 0.5, S + 61), Y = v;
          if (p.scatter > 0) {
            X += p.scatter * 0.1 * fbm(X, Y, 4, 3, 0.5, S + 67);
            Y += p.scatter * 0.1 * fbm(X, Y, 4, 3, 0.5, S + 68);
          }
          const t1 = N * (0.5 + 0.5 * fbm(X, Y, 2, 4, 0.5, S + 62)) * 1.5 + p.rotation * 1.5 * fbm(X, Y, 3, 2, 0.5, S + 69);
          const tp1 = sstep(-0.3, 0.45, fbm(X, Y, 3, 3, 0.5, S + 63));
          const t2 = Math.max(1, Math.round(N * 0.7)) * Y + N * X * (1.0 + p.waviness) + 1.4 * fbm(X, Y, 2, 3, 0.5, S + 64);   // integer × Y keeps it tiling
          const tp2 = sstep(-0.2, 0.5, fbm(X, Y, 4, 3, 0.5, S + 65));
          const lw = (0.08 + p.width * 0.45) * Math.max(0.2, 1 + p.scaleVar * 0.8 * fbm(X, Y, 2, 2, 0.5, S + 70));
          h = Math.max(band(t1, lw * tp1, p.softness / 3), 0.85 * band(t2, lw * 0.8 * tp2, p.softness / 3));
          if (p.accent > 0) {   // sigil nodes: small rings
            worley(X, Y, N, N, 0.9, S + 66);
            if (hashf(W.id1, 2, S) < p.accent * 0.6) {
              h = Math.max(h, band(W.f1 * 6 + 0.5, 0.35, 0) * (1 - sstep(0.15, 0.2, W.f1)));
            }
          }
          break;
        }

        case 'barbedWire': {
          // Two twisted strands; X-shaped barbs clamp every other crossing.
          const fy = fract(v * N + (p.waviness * 0.6) * fbm(u, v, 2, 3, 0.5, S + 91)) - 0.5;
          const xw = u * wc;
          const A = 0.1 + 0.08 * p.accent;
          const s1 = A * Math.sin(TAU * xw);
          const lw = 0.02 + p.width * 0.05;
          const over = fract(xw * 2) < 0.5;   // strands swap over / under each half twist
          const d1 = Math.abs(fy - s1), d2 = Math.abs(fy + s1);
          const h1 = profile(d1 / lw, 0.66), h2 = profile(d2 / lw, 0.66);
          h = over ? Math.max(h1, 0.75 * h2) : Math.max(0.75 * h1, h2);
          const bx = (fract(xw + 0.5) - 0.5) / wc * N;   // along-strand offset from the barb, in row units
          const L2 = 0.3 + 0.3 * p.accent, bw = lw * 1.6;
          for (const sgn of [1, -1]) {
            const ax = Math.cos(0.9) * L2, ay = sgn * Math.sin(0.9) * L2;
            const t = clamp01(((bx + ax) * 2 * ax + (fy + ay) * 2 * ay) / (4 * (ax * ax + ay * ay)));
            const px = -ax + 2 * ax * t, py = -ay + 2 * ay * t;
            const w = bw * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.5);   // pointed at both ends
            const d = Math.hypot(bx - px, fy - py);
            if (d < w) h = Math.max(h, 1.05 * profile(d / w, 0.66));
          }
          break;
        }

        case 'thornVines': {
          // Flowing vines with sharp, curved, forward-leaning thorns.
          const t = N * v + (0.3 + p.waviness * 1.5) * fbm(u, v, 2, 3, 0.5, S + 71);
          const i = Math.floor(t), fcross = fract(t) - 0.5;
          const vi = mod(i, N);
          const M = Math.max(1, wc * 2);
          const a = u * M + vi * 0.37 + 0.15 * fbm(u, v, 3, 2, 0.5, S + 72);
          const sIdx = mod(Math.floor(a), M), sa = fract(a);
          const w0 = 0.02 + p.width * 0.08;
          h = profile(Math.abs(fcross) / w0, p.softness);
          const side = hashf(sIdx, vi, S + 73) < 0.5 ? 1 : -1;
          const q = 0.4, len = 0.12 + p.accent * 0.3;
          const off = side * fcross - w0 * 0.5;
          if (sa < q && off > 0) {
            const reach = w0 * 0.5 + len * Math.pow(1 - sa / q, 1.6);   // curved, leaning spike
            if (off < reach) h = Math.max(h, sstep(0, 0.02 + p.softness * 0.05, reach - off));
          }
          break;
        }

        // ── Organic ─────────────────────────────────────────────────────────
        case 'drapery': {
          const tt = L.n * (L.a * u + L.b * v) + (0.3 + p.waviness * 2.5) * fbm(u, v, 2, 3, 0.5, S + 31);
          const fold = Math.abs(Math.sin(Math.PI * tt));
          h = lerp(fold, 0.5 - 0.5 * Math.cos(TAU * tt), p.softness * 0.5);
          if (p.variation > 0) h *= 1 - p.variation * 0.6 * (0.5 + 0.5 * fbm(u, v, 2, 3, 0.5, S + 37));
          break;
        }

        case 'contours': {
          const wu = u + p.waviness * 0.08 * fbm(u, v, 3, 3, 0.5, S + 11);
          const n = 0.5 + 0.5 * fbm(wu, v, 2, 4, 0.5, S + 13);
          const f = fract(n * N);
          const d = Math.min(f, 1 - f) * 2;
          h = profile(d / Math.max(p.width * 0.5, 0.02), p.softness) + p.accent * 2 * Math.floor(n * N) / N;
          break;
        }
      }
      out[(y - y0) * size + x] = h;
    }
  }
  return { struct: out, grit: null };
}

/** Whole-image stage. */
export function designFinish(params, size, struct) {
  return normalise(struct, 0.0005);
}
