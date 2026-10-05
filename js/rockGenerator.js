/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Procedural rock heightmap generator ──────────────────────────────────────
//
// A rock is a stack of geological layers, each driven by parameters that map
// to real rock features:
//
//   grain      Voronoi cells shaped as crystals / pebbles / planar facets /
//              pyramidal shards / split-face blocks / conchoidal scallops /
//              flat-topped columns
//   cleavage   facets share a dip direction and cells stretch along a strike
//              angle, so the rock splits "on a grain" like slate or schist
//   sub-facets smaller chips knapped into every facet (two extra scales)
//   terraces   stair-steps the relief into hard-edged ledges
//   gaps       grooves along grain boundaries (column joints, split lines)
//   fractures  an independent, warped crack network at its own spacing
//   pits       vesicles / solution pits (two scales)
//   bedding    sedimentary layers: angle, count, waviness, ledge sharpness
//   veins      mineral veins, raised or grooved
//   form       large-scale undulation of the whole face
//   weathering rounds everything above (seamless blur)
//   roughness  grit added after weathering — smooth lumps or jagged ridges
//
// Output is normalised to 0..1 (white = raised) with a percentile stretch so
// the displacement Amplitude slider means the same thing for every rock.

import {
  TAU, hashi, hashf, mod, lerp, clamp01, sstep, logCount, noise, fbm, ridged,
  W, WC, worley, siteWeight, lineLattice, blurWrap, normalise, normaliseMinMax,
} from './proceduralCore.js';

export { heightsToRGBA } from './proceduralCore.js';

// ── Pits (sparse random spherical bowls) ─────────────────────────────────────

function pitField(x, y, N, density, seed) {
  const fx = x * N, fy = y * N;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  let best = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = mod(gx, N), wy = mod(gy, N);
      const h = hashi(wx, wy, seed);
      if ((h & 0xffff) / 65536 >= density) continue;
      const h2 = hashi(wx, wy, seed + 7);
      const px = gx + 0.5 + 0.8 * ((h2 & 0xffff) / 65536 - 0.5);
      const py = gy + 0.5 + 0.8 * ((h2 >>> 16) / 65536 - 0.5);
      const r = 0.22 + 0.33 * ((h >>> 16) / 65536);
      const dx = fx - px, dy = fy - py;
      const q2 = (dx * dx + dy * dy) / (r * r);
      if (q2 >= 1) continue;
      const bowl = Math.sqrt(1 - q2) * (0.55 + 0.45 * hashf(wx, wy, seed + 13));
      if (bowl > best) best = bowl;
    }
  }
  return best;
}

// ── Porphyroblasts: faceted crystals the foliation wraps around ──────────────
// Sparse hex-faceted knobs (garnets) — or, with elongation, blades aligned to
// the strike (kyanite / staurolite). Returns the knob height in PB_H and a
// signed deflection for the foliation coordinate in PB_D.
let PB_H = 0, PB_D = 0;
function porphyroField(u, v, N, density, sizeMul, elong, sx, sy, seed) {
  const fx = u * N, fy = v * N, cx = Math.floor(fx), cy = Math.floor(fy);
  const stretch = 1 + 3 * elong, R = elong > 0.25 ? 2 : 1;
  PB_H = 0; PB_D = 0;
  for (let j = -R; j <= R; j++) {
    for (let i = -R; i <= R; i++) {
      const gx = cx + i, gy = cy + j, wx = mod(gx, N), wy = mod(gy, N);
      const h = hashi(wx, wy, seed);
      if ((h & 0xffff) / 65536 >= density) continue;
      const h2 = hashi(wx, wy, seed + 3);
      const dx = fx - (gx + 0.5 + 0.7 * ((h2 & 0xffff) / 65536 - 0.5));
      const dy = fy - (gy + 0.5 + 0.7 * ((h2 >>> 16) / 65536 - 0.5));
      const r = sizeMul * (0.16 + 0.2 * ((h >>> 16) / 65536));
      const along = (dx * sx + dy * sy) / stretch, across = -dx * sy + dy * sx;
      // hexagonal (dodecahedral-looking) footprint; equant crystals get a random spin
      const rot = elong > 0.05 ? 0 : hashf(wx, wy, seed + 5) * Math.PI / 3;
      let hd = 0;
      for (let k = 0; k < 3; k++) {
        const a = rot + k * Math.PI / 3;
        hd = Math.max(hd, Math.abs(along * Math.cos(a) + across * Math.sin(a)));
      }
      const knob = clamp01((r - hd) / (0.4 * r)) * (0.7 + 0.3 * hashf(wx, wy, seed + 7));
      if (knob > PB_H) PB_H = knob;
      const e = Math.hypot(along, across) / (r * 2.6);
      if (e < 1) {
        const w = (1 - e * e) * (1 - e * e);
        PB_D += w * across / (Math.abs(across) + r * 0.3) * r * 2;   // layers diverge around the crystal
      }
    }
  }
}

// ── Pyramid footprints for shards: regular n-gons, n = 3…8, 32 rotations ────

const PYR_ROT = 32, PYR_MAXN = 8;
const PYR_C = new Float32Array(6 * PYR_ROT * PYR_MAXN), PYR_S = new Float32Array(6 * PYR_ROT * PYR_MAXN);
for (let n = 3; n <= 8; n++) {
  for (let r = 0; r < PYR_ROT; r++) {
    for (let j = 0; j < n; j++) {
      const a = (r / PYR_ROT) * (TAU / n) + j * TAU / n;
      const o = ((n - 3) * PYR_ROT + r) * PYR_MAXN + j;
      PYR_C[o] = Math.cos(a); PYR_S[o] = Math.sin(a);
    }
  }
}

// ── Parameter schema ─────────────────────────────────────────────────────────

export const GRAIN_SHAPES = ['none', 'crystalline', 'facet', 'shard', 'block', 'scallop', 'column', 'pebble'];

/** Neutral defaults; rock types override a subset. */
export const DEFAULT_ROCK_PARAMS = Object.freeze({
  seed: 1,
  // Grain
  shape: 'facet',
  grainSize: 0.18,      // 0 fine … 0.3 half a tile … 1 five tiles (see grainTiles)
  grainRelief: 0.8,
  irregularity: 0.6,
  gapDepth: 0,
  gapWidth: 0.2,
  // Heterogeneity — breaks the "same grain, reshaped" look
  sizeVariation: 0.5,   // weighted (power) Voronoi: big grains crowd small ones
  mergeGrains: 0.2,     // neighbouring grains fuse into large many-sided facets
  splitGrains: 0.3,     // grains cut by 1–2 straight fracture planes → 3/4-sided shards
  // Facets & cleavage
  facetSteepness: 0.45,
  cleavage: 0,          // 0 random facet tilt … 1 every facet dips the same way
  cleavageAngle: 0,     // strike of the split planes, degrees
  elongation: 0,        // stretch grains along the strike
  subFacets: 0,         // chips knapped into each facet
  terraces: 0,          // stair-step the relief into ledges
  terraceCount: 8,
  // Fractures
  cracks: 0,
  crackSpacing: 0.4,
  crackWidth: 0.25,
  // Pits
  pits: 0,
  pitSize: 0.4,
  pitDensity: 0.4,
  // Bedding
  layers: 0,
  layerCount: 12,
  layerAngle: 0,
  layerWaviness: 0.3,
  layerSharpness: 0.5,
  // Foliation & crystals (metamorphic)
  crenulation: 0,       // foliation folded into tight zig-zag kinks
  crenCount: 8,         // kinks per tile along the strike
  flakiness: 0,         // mica sheets broken into stepped flakes
  flakeSize: 0.5,
  porphyro: 0,          // porphyroblasts (garnet knobs / kyanite blades) standing proud
  porphyroSize: 0.4,
  porphyroDensity: 0.4,
  porphyroElong: 0,     // 0 equant garnets … 1 long blades aligned with the foliation
  deflection: 0.5,      // how strongly the foliation bows around them
  // Veins
  veins: 0,             // −1 grooved … +1 raised
  veinWidth: 0.3,
  veinDensity: 0.4,
  // Surface
  roughness: 0.15,
  roughScale: 0.3,      // 0 fine grit … 1 coarse lumps
  roughJag: 0.5,        // 0 smooth lumps … 1 jagged ridges
  form: 0.15,
  weathering: 0,
  edgeSoftness: 0.15,   // fine rounding of cliffs/ridges only (also kills pixel staircasing)
});

// Grain size slider → grain size in tile units (log scale):
//   0 … 0.3   1/80 … 1/2 tile   (the original range)
//   0.3 … 1   1/2 … 5 tiles     (giant grains)
// Past 1/4 tile the map keeps MIN_GRAIN_CELLS grains (so big grains don't
// visibly repeat) and instead covers `tileMul` Scale tiles; every other
// feature's count is multiplied by tileMul so it keeps its physical size.
const GRAIN_KNEE = 0.3;
const MIN_GRAIN_CELLS = 4;

export function grainTiles(grainSize) {
  const s = clamp01(grainSize);
  if (s <= GRAIN_KNEE) return Math.exp(lerp(Math.log(1 / 80), Math.log(1 / 2), s / GRAIN_KNEE));
  return Math.exp(lerp(Math.log(1 / 2), Math.log(5), (s - GRAIN_KNEE) / (1 - GRAIN_KNEE)));
}

/** Counts derived from the 0..1 sliders — shared with the UI's mm readouts. */
export function derivedCounts(p) {
  const g = grainTiles(p.grainSize);
  const big = g > 1 / MIN_GRAIN_CELLS;
  const tileMul = big ? g * MIN_GRAIN_CELLS : 1;
  const k = (n) => Math.max(1, Math.round(n * tileMul));
  return {
    tileMul,
    grainCells: big ? MIN_GRAIN_CELLS : Math.max(1, Math.round(1 / g)),
    crackCells: k(logCount(14, 1, p.crackSpacing)),
    pitCells:   k(logCount(40, 4, p.pitSize)),
    roughCells: k(logCount(96, 6, p.roughScale)),
    veinCells:  k(logCount(2, 8, p.veinDensity)),
    formCells:  k(2),
  };
}

// ── Grain layer ──────────────────────────────────────────────────────────────
// One Voronoi grain layer, optionally stretched along the cleavage strike via
// an integer (unimodular) coordinate transform so it still tiles.

function makeGrainLayer(p, cells, seed, heterogeneous = false) {
  const L = {
    seed, jitter: 0.45 + 0.55 * p.irregularity,
    wAmp: heterogeneous ? 0.32 * p.sizeVariation : 0,
    merge: heterogeneous ? p.mergeGrains : 0,
    split: heterogeneous ? p.splitGrains : 0,
    steep: 0.3 + 3.2 * Math.pow(p.facetSteepness, 1.2),
    cleav: p.cleavage,
    aniso: p.elongation > 0.001,
  };
  if (L.aniso) {
    const lat = lineLattice(p.cleavageAngle, 1, 2);
    const stretch = 1 + 3 * p.elongation;
    const cdLen = Math.hypot(lat.c, lat.d);
    L.a = lat.a; L.b = lat.b; L.c = lat.c; L.d = lat.d;
    L.Nx = Math.max(1, Math.round(cells * Math.sqrt(stretch) / lat.len));
    L.Ny = Math.max(1, Math.round(cells / Math.sqrt(stretch) / cdLen));
    L.sy = (L.Nx * lat.len) / (L.Ny * cdLen);
    L.prefX = 1; L.prefY = 0;   // dip across the strike, in transformed space
  } else {
    L.Nx = L.Ny = cells; L.sy = 1;
    const phi = (p.cleavageAngle + 90) * Math.PI / 180;
    L.prefX = Math.cos(phi); L.prefY = Math.sin(phi);
  }
  return L;
}

function sampleWorley(L, u, v) {
  if (L.aniso) worley(L.a * u + L.b * v, L.c * u + L.d * v, L.Nx, L.Ny, L.jitter, L.seed, 0, L.sy, L.wAmp);
  else worley(u, v, L.Nx, L.Ny, L.jitter, L.seed, 0, 1, L.wAmp);
}

// ── Heterogeneous facets: merge + split ──────────────────────────────────────
// After sampleWorley(), resolve which *facet* the pixel belongs to:
//   merge  a cell may fuse into one lattice neighbour — both share the
//          neighbour's facet, so the border between them disappears and a big
//          7–10-sided polygon appears
//   split  a facet may be cut by one or two straight planes through its site —
//          each piece tilts on its own, giving 3- and 4-sided shards
// Outputs: F_ID (facet id for hashing), F_DX/F_DY (offset from the facet's
// anchor site, so planes stay continuous across merged cells) and F_EDGE
// (distance to the facet's nearest real border, for joints and bevels).

let F_ID = 0, F_DX = 0, F_DY = 0, F_EDGE = 0;
const MERGE_DIR = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function rootLattice(L, gx, gy, id) {
  if (L.merge > 0 && hashf(id, 7, L.seed) < L.merge) {
    const d = MERGE_DIR[hashi(id, 8, L.seed) & 3];
    return [gx + d[0], gy + d[1]];
  }
  return [gx, gy];
}

function resolveFacet(L) {
  const bi = W.best;
  let rootId = W.id1;
  F_DX = W.dx; F_DY = W.dy; F_EDGE = W.edge;
  if (L.merge > 0) {
    const [rx, ry] = rootLattice(L, WC.gx[bi], WC.gy[bi], W.id1);
    const wx = mod(rx, L.Nx), wy = mod(ry, L.Ny);
    rootId = wy * L.Nx + wx;
    if (rootId !== W.id1) {
      const h = hashi(wx, wy, L.seed);
      F_DX = W.fx - (rx + 0.5 + L.jitter * ((h & 0xffff) / 65536 - 0.5));
      F_DY = (W.fy - (ry + 0.5 + L.jitter * ((h >>> 16) / 65536 - 0.5))) * L.sy;
    }
    // Nearest border to a neighbour that belongs to a *different* facet.
    const mx = WC.dx[bi], my = WC.dy[bi];
    const pm = mx * mx + my * my - WC.w[bi];
    let edge = 1e9;
    for (let k = 0; k < 9; k++) {
      if (k === bi) continue;
      const [kx, ky] = rootLattice(L, WC.gx[k], WC.gy[k], WC.id[k]);
      if (mod(ky, L.Ny) * L.Nx + mod(kx, L.Nx) === rootId) continue;
      const len = Math.hypot(mx - WC.dx[k], my - WC.dy[k]);
      if (len < 1e-9) continue;
      const dist = (WC.dx[k] * WC.dx[k] + WC.dy[k] * WC.dy[k] - WC.w[k] - pm) / (2 * len);
      if (dist < edge) edge = dist;
    }
    F_EDGE = edge < 0 ? 0 : Math.min(edge, 1.5);
  }
  F_ID = rootId * 4;
  if (L.split > 0 && hashf(rootId, 9, L.seed) < L.split) {
    const a1 = hashf(rootId, 10, L.seed) * Math.PI;
    const c1 = (hashf(rootId, 11, L.seed) - 0.5) * 0.35;
    const s1 = F_DX * Math.cos(a1) + F_DY * Math.sin(a1) - c1;
    F_ID += s1 > 0 ? 1 : 0;
    F_EDGE = Math.min(F_EDGE, Math.abs(s1));
    if (hashf(rootId, 12, L.seed) < 0.55) {   // second, crossing cut
      const a2 = a1 + Math.PI * (0.25 + 0.5 * hashf(rootId, 13, L.seed));
      const c2 = (hashf(rootId, 14, L.seed) - 0.5) * 0.35;
      const s2 = F_DX * Math.cos(a2) + F_DY * Math.sin(a2) - c2;
      F_ID += s2 > 0 ? 2 : 0;
      F_EDGE = Math.min(F_EDGE, Math.abs(s2));
    }
  }
}

/** Facet gradient for cell `id`: random tilt blended toward the cleavage dip. */
let GGX = 0, GGY = 0;
function facetGrad(L, id) {
  const rx = 2 * hashf(id, 2, L.seed) - 1, ry = 2 * hashf(id, 3, L.seed) - 1;
  const m = 0.6 + 0.8 * hashf(id, 4, L.seed);
  GGX = L.steep * lerp(rx, L.prefX * m, L.cleav);
  GGY = L.steep * lerp(ry, L.prefY * m, L.cleav);
}

/** Planar chips (used for the facet shape and every sub-facet layer). */
function facetValue(L, u, v) {
  sampleWorley(L, u, v);
  const h1 = hashf(W.id1, 1, L.seed);
  facetGrad(L, W.id1);
  return 0.35 * (h1 - 0.5) + GGX * W.dx + GGY * W.dy;
}

/** Continuous pyramidal shards: max over neighbours of tilted hex pyramids. */
function shardValue(L, u, v) {
  sampleWorley(L, u, v);
  const P = 1.1 + L.steep;
  let best = -1e9;
  for (let k = 0; k < 9; k++) {
    const id = WC.id[k], dx = WC.dx[k], dy = WC.dy[k];
    facetGrad(L, id);
    // Footprint: a regular n-gon, n = 3…8 per shard (more variety with irregularity).
    const hs = hashi(id, 5, L.seed);
    const n = 3 + (hs % 6);
    const o = ((n - 3) * PYR_ROT + ((hs >>> 8) & (PYR_ROT - 1))) * PYR_MAXN;
    let pyr = -1e9;
    for (let j = 0; j < n; j++) {
      const d = dx * PYR_C[o + j] + dy * PYR_S[o + j];
      if (d > pyr) pyr = d;
    }
    // Weighted sites make bigger, taller shards that swallow their neighbours.
    const boost = L.wAmp > 0 ? 2.2 * WC.w[k] : 0;
    const val = 0.5 * hashf(id, 1, L.seed) + 0.35 * (GGX * dx + GGY * dy) - P * pyr + P * boost;
    if (val > best) best = val;
  }
  return best;
}

// ── Generator ────────────────────────────────────────────────────────────────

/**
 * Generate a seamless rock heightmap.
 * @param {object} params  see DEFAULT_ROCK_PARAMS
 * @param {number} size    output resolution (square)
 * @returns {Float32Array} size×size heights in 0..1
 */
export function generateRockHeights(params, size) {
  const { struct, grit } = rockRows(params, size, 0, size);
  return rockFinish(params, size, struct, grit);
}

/**
 * Per-pixel stage for rows [y0, y1) — independent per row, so it can be split
 * across workers. Returns the structural relief and the (optional) grit.
 */
export function rockRows(params, size, y0, y1) {
  const p = { ...DEFAULT_ROCK_PARAMS, ...params };
  const { tileMul, grainCells, crackCells, pitCells, roughCells, veinCells, formCells } = derivedCounts(p);
  const S = (p.seed | 0) * 7919;
  const sWarp = S + 11, sCrack = S + 37, sCrackW = S + 43,
        sPit = S + 53, sLayer = S + 61, sVein = S + 71, sRough = S + 83, sForm = S + 97;

  const shape = p.shape;
  const useGrain = shape !== 'none' && (p.grainRelief > 0 || p.gapDepth > 0);
  const main = makeGrainLayer(p, grainCells, S + 23, true);
  const subOn = p.subFacets > 0 && useGrain;
  const sub1 = subOn ? makeGrainLayer({ ...p, irregularity: 1 }, Math.round(grainCells * 2.7), S + 29) : null;
  const sub2 = subOn ? makeGrainLayer({ ...p, irregularity: 1 }, Math.round(grainCells * 7.3), S + 31) : null;
  const warpAmt = p.irregularity * 0.28 / grainCells;
  const warpP = Math.max(2, Math.round(grainCells / 2));
  const gapW = 0.015 + p.gapWidth * 0.3;
  const bevelW = 0.04 + 0.4 * (1 - p.facetSteepness);

  const crackW = 0.006 + p.crackWidth * 0.1;
  const crackWarp = 0.32 / crackCells;
  const bed = p.layers > 0 ? lineLattice(p.layerAngle, p.layerCount * tileMul) : null;
  // Foliation strike direction (unit, in uv) — porphyroblasts align to it.
  const fol = lineLattice(p.layerAngle, 1);
  const strikeX = -fol.b / fol.len, strikeY = fol.a / fol.len;
  const porphN = Math.max(2, Math.round(logCount(30, 4, p.porphyroSize) * tileMul));
  const crenM = Math.max(1, Math.round(p.crenCount * tileMul));
  const flakeM = Math.max(1, Math.round(logCount(40, 4, p.flakeSize) * tileMul));
  const veinW = 0.004 + p.veinWidth * 0.05;

  const rows = y1 - y0;
  // Grit finer than ~6 px per cell only aliases into noise; cap it at this resolution.
  const gritCells = Math.min(roughCells, Math.max(4, Math.floor(size / 6)));
  const struct = new Float32Array(size * rows);
  const grit   = p.roughness > 0 ? new Float32Array(size * rows) : null;
  const inv = 1 / size;

  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) * inv;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let h = 0;

      // ── Grain ──
      if (useGrain) {
        let gu = u, gv = v;
        if (warpAmt > 0) {
          gu += warpAmt * fbm(u, v, warpP, 3, 0.5, sWarp);
          gv += warpAmt * fbm(u, v, warpP, 3, 0.5, sWarp + 5);
        }
        let g = 0;
        if (shape === 'shard') {
          g = shardValue(main, gu, gv);
        } else {
          sampleWorley(main, gu, gv);
          resolveFacet(main);
          const id = F_ID, seed = main.seed;
          const h1 = hashf(id, 1, seed), h2 = hashf(id, 2, seed);
          const t = W.f1 / (W.f1 + W.edge + 1e-9);   // 0 at site → 1 at border
          switch (shape) {
            case 'crystalline': // flat, slightly tilted, random-height cleavage faces
              facetGrad(main, id);
              g = 0.8 * h1 + 0.2 * (GGX * F_DX + GGY * F_DY);
              break;
            case 'facet': // tilted planar chips
              facetGrad(main, id);
              g = 0.18 * (h1 - 0.5) + GGX * F_DX + GGY * F_DY;
              break;
            case 'block': // split-face block: flat top, hard chamfered edges
              facetGrad(main, id);
              g = 0.25 * h1 + 0.12 * (GGX * F_DX + GGY * F_DY) + 0.75 * Math.min(1, F_EDGE / bevelW);
              break;
            case 'scallop': // conchoidal bowls with faint ripple rings
              g = t * t * (0.6 + 0.4 * h1) + 0.025 * Math.cos(t * 22 + h2 * TAU) * t;
              break;
            case 'column': // flat tops
              g = 0.62 + 0.38 * h1;
              break;
            case 'pebble': { // rounded domes; irregularity mixes in smaller pebbles
              const r = 1 - 0.55 * p.irregularity * h2;
              const q = t / r;
              g = Math.sqrt(Math.max(0, 1 - q * q)) * (0.55 + 0.45 * h1) * (0.6 + 0.4 * r);
              break;
            }
          }
          if (p.gapDepth > 0) h -= p.gapDepth * (1 - sstep(0, gapW, F_EDGE));
        }
        if (subOn) {
          g += p.subFacets * (0.3 * facetValue(sub1, gu, gv) + 0.1 * facetValue(sub2, gu, gv));
        }
        h += p.grainRelief * g;
      }

      // ── Fractures ──
      if (p.cracks > 0) {
        const cu = u + crackWarp * (noise(u, v, crackCells * 2, sCrackW) + 0.35 * noise(u, v, crackCells * 7, sCrackW + 1));
        const cv = v + crackWarp * (noise(u, v, crackCells * 2, sCrackW + 2) + 0.35 * noise(u, v, crackCells * 7, sCrackW + 3));
        worley(cu, cv, crackCells, crackCells, 1, sCrack);
        let c = 0;
        if (W.edge < crackW) {
          const lo = Math.min(W.id1, W.id2), hi = Math.max(W.id1, W.id2);
          const depth = 0.35 + 0.65 * hashf(lo, hi, sCrack);
          const q = 1 - W.edge / crackW;
          c = depth * q * Math.sqrt(q);
        }
        h -= p.cracks * c;
      }

      // ── Pits / vesicles ──
      if (p.pits > 0) {
        const dens = 0.08 + 0.92 * p.pitDensity;
        const a = pitField(u, v, pitCells, dens, sPit);
        const b = pitField(u, v, Math.round(pitCells * 2.3), dens, sPit + 101);
        h -= p.pits * Math.max(a, 0.55 * b);
      }

      // ── Porphyroblasts (computed first: the foliation bends around them) ──
      if (p.porphyro > 0) porphyroField(u, v, porphN, 0.1 + 0.8 * p.porphyroDensity, 1, p.porphyroElong, strikeX, strikeY, S + 67);

      // ── Bedding / foliation ──
      if (bed) {
        const sAlong = bed.c * u + bed.d * v;   // integer coefficients → tiles
        let t = bed.n * (bed.a * u + bed.b * v) + p.layerWaviness * 1.6 * fbm(u, v, formCells, 4, 0.5, sLayer);
        if (p.crenulation > 0) {   // crenulation cleavage: tight kink folds
          // phase + amplitude drift so the kinks read as rock, not a printed zig-zag
          const ph = sAlong * crenM + 0.7 * fbm(u, v, formCells, 3, 0.5, sLayer + 3);
          const z = 1 - Math.abs(2 * (ph - Math.floor(ph)) - 1);
          const amp = 0.45 + 0.55 * (0.5 + 0.5 * fbm(u, v, formCells, 3, 0.5, sLayer + 5));
          t += p.crenulation * 1.1 * amp * (2 * sstep(0, 1, z) - 1);
        }
        if (p.porphyro > 0 && p.deflection > 0) t += p.deflection * bed.n / porphN * 1.5 * PB_D;
        const band = Math.floor(t), f = t - band, bi = mod(band, bed.n);
        const bh = hashf(bi, 0, sLayer);
        const smooth = 0.5 + 0.5 * Math.sin(TAU * t);
        const bevel = sstep(0, 0.07, f) * (1 - sstep(0.93, 1, f));
        let stepped = 0.25 + 0.75 * bh - 0.35 * (1 - bevel);
        if (p.flakiness > 0) {   // mica flakes: each layer breaks into offset sheets
          const a = sAlong * flakeM + 0.37 * bi + 0.9 * fbm(u, v, flakeM, 2, 0.5, sLayer + 7), seg = mod(Math.floor(a), flakeM), fr = a - Math.floor(a);   // wandering flake edges
          stepped += p.flakiness * 0.6 * (hashf(bi, seg, sLayer + 1) - 0.5)
                   - p.flakiness * 0.25 * (1 - sstep(0, 0.035, Math.min(fr, 1 - fr)));
        }
        h += p.layers * lerp(smooth, stepped, p.layerSharpness);
      }
      if (p.porphyro > 0) h += p.porphyro * 1.2 * PB_H;

      // ── Veins ──
      if (p.veins !== 0) {
        const wu = u + 0.12 / tileMul * fbm(u, v, formCells, 3, 0.5, sVein + 9);
        const wv = v + 0.12 / tileMul * fbm(u, v, formCells, 3, 0.5, sVein + 19);
        const n1 = Math.abs(fbm(wu, wv, veinCells, 4, 0.5, sVein));
        const n2 = Math.abs(fbm(wu, wv, veinCells * 2, 4, 0.5, sVein + 29));
        const line = Math.max(1 - sstep(0, veinW, n1), 0.6 * (1 - sstep(0, veinW * 0.6, n2)));
        h += p.veins * 0.7 * line;
      }

      // ── Large-scale form ──
      if (p.form > 0) h += p.form * 1.1 * fbm(u, v, formCells, 4, 0.5, sForm);

      struct[(y - y0) * size + x] = h;
      if (grit) {
        const smooth = p.roughJag < 1 ? fbm(u, v, gritCells, 5, 0.55, sRough) : 0;
        const jag = p.roughJag > 0 ? ridged(u, v, gritCells, 5, 0.55, sRough) : 0;
        grit[(y - y0) * size + x] = lerp(smooth, jag, p.roughJag);
      }
    }
  }

  return { struct, grit };
}

/** Whole-image stage: terraces, weathering blur, grit, normalisation. */
export function rockFinish(params, size, struct, grit) {
  const p = { ...DEFAULT_ROCK_PARAMS, ...params };

  // ── Terraces: stair-step the structural relief into hard ledges ──
  if (p.terraces > 0) {
    normaliseMinMax(struct);
    const T = Math.max(2, Math.round(p.terraceCount));
    for (let i = 0; i < struct.length; i++) {
      const s = struct[i] * T, base = Math.floor(s);
      const stepped = (base + sstep(0.72, 1, s - base)) / T;
      struct[i] = lerp(struct[i], stepped, p.terraces);
    }
  }

  // ── Edge softness: round off cliffs and ridges by a hair, keep the shapes ──
  // A small seamless blur on the structure only (grit is added afterwards),
  // ~1 px at the default — enough to remove pixel staircasing on hard edges.
  if (p.edgeSoftness > 0) {
    const r = Math.pow(p.edgeSoftness, 1.3) * size * 0.008;
    if (r >= 1) blurWrap(struct, size, r);
    else {   // sub-pixel: blend toward a 1 px blur so the low end of the slider is smooth
      const soft = blurWrap(Float32Array.from(struct), size, 1);
      for (let i = 0; i < struct.length; i++) struct[i] += (soft[i] - struct[i]) * r;
    }
  }

  // ── Weathering: seamless blur of the structural relief ──
  const w = p.weathering;
  const { tileMul } = derivedCounts(p);
  const out = w > 0 ? blurWrap(struct, size, Math.pow(w, 1.5) * size * 0.022 / Math.sqrt(tileMul)) : struct;

  if (grit) {
    // Grit is scaled against the structure's spread so it reads the same
    // whether or not terraces normalised the structure above.
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
    const rAmt = p.roughness * 0.2 * Math.max(hi - lo, 1e-6);
    for (let i = 0; i < out.length; i++) out[i] += rAmt * grit[i];
  }

  return normalise(out);
}
