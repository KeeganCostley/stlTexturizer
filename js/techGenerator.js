/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Industrial & technical surfaces: circuit boards, metal fabrication, mesh and
// grating, structural sheet. Two kinds of pattern:
//   • analytic — a height per pixel from periodic lattice maths (tread plate,
//     perforation, knurling, weave, isogrid …); rows split across workers.
//   • drawn — circuit boards, chip fan-outs and hull panels are laid out as
//     vector geometry on an OffscreenCanvas (drawn with wrap-around so the tile
//     is seamless), then a chamfer pass bevels every plateau edge.
// Every field lives on the unit torus with integer repeat counts.

import { hashf, fract, lerp, clamp01, sstep, mod, noise, noise2, blurWrap, normalise } from './proceduralCore.js';

export const TECH_SHAPES = ['round', 'hex', 'square', 'slot'];

export const DEFAULT_TECH_PARAMS = Object.freeze({
  pattern: 'pcb',
  scale: 6,          // repeats per tile (cells, rows, passes …)
  width: 0.5,        // bar / wire / trace / hole size
  bevel: 0.3,        // edge chamfer or rounding
  density: 0.5,      // how much stuff (traces, rivets, bars …)
  detail: 0.5,       // secondary feature (ripples, pins, rings …)
  variation: 0.25,   // irregularity
  shape: 'round',
  count: 3,         // chains / wires per tile
  softness: 0.02,
  seed: 1,
});

const SQ3 = Math.sqrt(3), H3 = SQ3 / 2, IR2 = Math.SQRT1_2;
const tri = (x) => 1 - Math.abs(2 * fract(x) - 1);          // 0 at integers, 1 at halves
const dome = (s) => (s >= 1 ? 0 : Math.sqrt(1 - s * s));
const ramp = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const even = (n) => Math.max(2, n + (n & 1));
/** Polynomial smooth minimum — fillets inside corners. */
function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp01(0.5 + 0.5 * (b - a) / k);
  return lerp(b, a, h) - k * h * (1 - h);
}

/** Shape distance in cell units (hole / pin of "radius" 1 at d = 1 after dividing). */
function shapeDist(shape, x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  switch (shape) {
    case 'hex': return Math.max(ax * 0.8660254 + ay * 0.5, ay);
    case 'square': return Math.max(ax, ay);
    default: return Math.hypot(x, y);
  }
}

// ── Analytic patterns: h(C, p, u, v) → 0..1 ─────────────────────────────────

const TAU_ = Math.PI * 2;

// ── Chains & wire ────────────────────────────────────────────────────────────
// Lengths are in link-pitch units (centre-to-centre of consecutive links = 1).

/**
 * One chain link seen from above, in its own frame (x along the chain).
 * flat: lying on the surface (an oval ring with a hole); otherwise standing
 * on edge (a bar whose top follows the link's rounded outline), threading
 * the holes of its flat neighbours. Returns the top height, 0 if missed.
 */
function linkTop(x, y, flat, rw, rC, a, stud) {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (flat) {
    const q = ax > a ? Math.hypot(ax - a, ay) : ay;
    const sd = Math.abs(q - rC);
    let h = sd < rw ? rw + Math.sqrt(rw * rw - sd * sd) : 0;
    if (stud && ax < rw * 0.75 && ay < rC) h = Math.max(h, rw + Math.sqrt(Math.max(0, rw * rw * 0.56 - ax * ax)));
    return h;
  }
  if (ay >= rw) return 0;
  const ex = ax - a;
  const zc = ex <= 0 ? rC : ex < rC ? Math.sqrt(rC * rC - ex * ex) : 0;
  const tip = Math.max(0, ex - rC);
  const s2 = rw * rw - ay * ay - tip * tip;
  return s2 > 0 ? rw + zc + Math.sqrt(s2) : 0;
}

/** Chains running along u: classic / stud-link / curb / hanging. */
function chainField(C, p, u, v, style) {
  const N = even(C.N);
  const rw = (0.1 + 0.085 * p.width) * (style === 'stud' ? 1.15 : 1);
  const rC = 0.4 + rw * 0.35, a = style === 'curb' ? 0.18 : 0.3;
  const linkW = rC + rw;                                      // half-width of a link
  const M = Math.max(1, Math.min(Math.round(p.count), Math.floor(N / (2 * linkW * 1.25))));
  const x = u * N, k0 = Math.round(x);
  const K = Math.max(1, Math.round(1 + 3 * p.detail));        // hanging arcs per tile
  const span = N / K, sag = style === 'hanging' ? (0.15 + 0.85 * p.variation) * Math.min(span * 0.35, (N / M) * 0.45) : 0;
  const cy = (xx) => { const t = fract(xx / span); return sag * 4 * t * (1 - t); };
  const dcy = (xx) => { const t = fract(xx / span); return sag * 4 * (1 - 2 * t) / span; };
  const yRow = v * M, j0 = Math.floor(yRow);
  const maxH = style === 'curb' ? 2.6 * rw : 2 * rw + rC;
  let best = 0;
  for (let dj = -1; dj <= 1; dj++) {
    const j = j0 + dj;
    const yc = (yRow - (j + 0.5)) * (N / M) - (sag ? -sag * 0.5 : 0);   // link units from the row axis (hanging: centred on the sag)
    for (let dk = -1; dk <= 1; dk++) {
      const k = k0 + dk;
      const cyk = sag ? cy(k) : 0, ang = sag ? Math.atan(dcy(k)) : 0;
      const tilt = style === 'curb' ? ((mod(k, 2) ? 1 : -1) * 0.42) : 0;
      const th = ang + tilt, c = Math.cos(th), s = Math.sin(th);
      const dx = x - k, dy = yc - cyk;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const flat = style === 'curb' ? true : (mod(k, 2) === 0);
      let h = linkTop(lx, ly, flat, rw, rC, a, style === 'stud');
      if (h > 0 && style === 'curb' && mod(k, 2)) h += 0.45 * rw;   // twisted links ride over their neighbours
      if (h > best) best = h;
    }
  }
  return clamp01(best / maxH);
}

/** Distance from (x, y) to a curve y = f(x) with slope g, in the same units. */
const curveDist = (y, f, g) => Math.abs(y - f) / Math.sqrt(1 + g * g);

/** Tapered spike from (0,0) in direction (dx, dy), length L, base half-width w → height factor (0 if missed). */
function spike(px, py, dx, dy, L, w) {
  const t = px * dx + py * dy;
  if (t < 0 || t > L) return 0;
  const n = Math.abs(-px * dy + py * dx), half = w * (1 - t / L);
  return n < half ? Math.sqrt(1 - (n / half) * (n / half)) * (1 - 0.25 * t / L) : 0;
}

/** Barbed wire: two twisted strands (or one), 2- or 4-point barbs. */
function barbedField(C, p, u, v, style) {
  const M = Math.max(1, Math.round(p.count));               // wires per tile
  const x = u * M, yRow = v * M, j = Math.floor(yRow);
  const N = C.N;                                            // twists per tile
  const P = M / N;                                          // twist pitch (row units)
  const rw = 0.018 + 0.03 * p.width;
  const A = style === 'single' ? 0 : rw * 1.15;
  const wob = 0.08 * p.variation * noise(u, (mod(j, M) + 0.5) / M, 3, C.S + 21);
  const y = yRow - j - 0.5 - wob;
  let h = 0;
  const strands = style === 'single' ? [0] : [0, Math.PI];
  for (const ph of strands) {
    const th = TAU_ * x / P + ph;
    const ys = A * Math.cos(th), zs = Math.sin(th), g = -A * TAU_ / P * Math.sin(th);
    const d = curveDist(y, ys, g);
    if (d < rw) h = Math.max(h, 0.45 + (A ? 0.22 * zs : 0.2) + 0.33 * dome(d / rw));
  }
  // barbs
  const nb = Math.max(1, Math.round(N / Math.max(1, Math.round(1 + 3 * (1 - p.density)))));
  const Pb = M / nb, kb = Math.round(x / Pb - 0.5), bx = x - (kb + 0.5) * Pb;
  const L = rw * (3 + 6 * p.detail) + 0.03, bw = rw * 1.25;
  // the wrap: a tight coil clamping the strands
  if (Math.abs(bx) < rw * 1.7 && Math.abs(y) < A + rw * 1.4) {
    const coil = 0.5 + 0.5 * Math.cos(TAU_ * bx / (rw * 1.1));
    h = Math.max(h, 0.72 + 0.2 * coil * dome(Math.abs(y) / (A + rw * 1.4)));
  }
  const dirs = style === 'barb2' ? [[0.5, -0.866], [-0.5, 0.866]]
    : [[0.62, -0.78], [-0.62, -0.78], [0.62, 0.78], [-0.62, 0.78]];
  for (const [dx, dy] of dirs) {
    const f = spike(bx, y, dx, dy, L, bw);
    if (f > 0) h = Math.max(h, 0.62 + 0.38 * f);
  }
  return h;
}

/** Razor (concertina) wire: a splayed helical coil seen from above, with flat blades. */
function razorField(C, p, u, v) {
  const M = Math.max(1, Math.round(p.count));
  const x = u * M, yRow = v * M, j = Math.floor(yRow);
  const y = yRow - j - 0.5;
  const N = C.N, pp = M / N;                                // loop pitch (row units)
  const R = 0.34, cs = 0.7 + 0.5 * p.variation;           // coil radius, splay
  const rw = 0.012 + 0.016 * p.width;
  const X = (th) => pp * th / TAU_ + cs * R * Math.sin(th);
  let best = Infinity, bth = 0;
  const i0 = Math.floor(x / pp);
  for (let i = i0 - 2; i <= i0 + 2; i++) {
    for (let s = 0; s < 40; s++) {
      const th = TAU_ * (i + s / 40);
      const d = Math.hypot(x - X(th), y - R * Math.cos(th));
      if (d < best) { best = d; bth = th; }
    }
  }
  for (let it = 0, step = TAU_ / 80; it < 6; it++, step *= 0.5) {   // refine
    for (const th of [bth - step, bth + step]) {
      const d = Math.hypot(x - X(th), y - R * Math.cos(th));
      if (d < best) { best = d; bth = th; }
    }
  }
  const zs = Math.sin(bth);
  let h = best < rw ? 0.45 + 0.3 * zs + 0.25 * dome(best / rw) : 0;
  // blades: flat double-pointed barbs every 1/nb turn, along the tangent
  const nb = 4 + Math.round(8 * p.density);
  const kb = Math.round(bth / TAU_ * nb), tb = kb / nb * TAU_;
  const bxp = X(tb), byp = R * Math.cos(tb);
  const tx = pp / TAU_ + cs * R * Math.cos(tb), ty = -R * Math.sin(tb), tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl, uy = ty / tl;
  const px = x - bxp, py = y - byp;
  const along = px * ux + py * uy, across = Math.abs(-px * uy + py * ux);
  const Lb = rw * (1.5 + 2.5 * p.detail), wb = rw * 2;
  if (Math.abs(along) < Lb) {
    // blade: barbed both ways (a 'W' outline) — wide at the core, pointed tips
    const t = Math.abs(along) / Lb, half = wb * (1 - t) + rw * 0.6 * (1 - t);
    if (across < half) h = Math.max(h, 0.5 + 0.3 * Math.sin(tb) + 0.12);
  }
  return h;
}

const A = {
  diamondPlate(C, p, u, v) {
    const N = C.N, x = u * N, y = v * N, i = Math.floor(x), j = Math.floor(y);
    const lx = x - i - 0.5, ly = y - j - 0.5, o = ((i + j) & 1) ? 1 : -1;
    const a = (lx + o * ly) * IR2, b = (-o * lx + ly) * IR2;
    const Lh = 0.27 + 0.17 * p.density;
    if (Math.abs(a) >= Lh) return 0;
    const t = a / Lh, w = (0.045 + 0.09 * p.width) * (1 - t * t);
    return Math.pow(dome(Math.abs(b) / Math.max(w, 1e-4)), 0.35 + 0.9 * p.bevel);
  },
  fiveBar(C, p, u, v) {
    const N = C.N, x = u * N, y = v * N, i = Math.floor(x), j = Math.floor(y);
    const lx = x - i - 0.5, ly = y - j - 0.5, o = (i + j) & 1;
    const along = o ? lx : ly, across = o ? ly : lx;
    const g = 0.17, k = Math.max(-2, Math.min(2, Math.round(across / g)));
    const db = across - k * g, Lh = 0.36 + 0.06 * p.density, wd = 0.022 + 0.04 * p.width;
    const d = Math.abs(along) > Lh ? Math.hypot(Math.abs(along) - Lh, db) : Math.abs(db);
    return Math.pow(dome(d / wd), 0.35 + 0.9 * p.bevel);
  },
  perforated(C, p, u, v) {
    const square = p.shape === 'square';
    const N = square ? C.N : even(C.N);
    const y = v * N, j = Math.floor(y);
    const x = u * N - (square ? 0 : (j & 1) * 0.5);
    const lx = fract(x) - 0.5, ly = y - j - 0.5;
    const r = 0.16 + 0.26 * p.width;
    let d;
    if (p.shape === 'slot') {
      const rs = r * 0.55, L = Math.max(0, Math.min(0.45 - rs, 0.12 + 0.25 * p.density));
      d = (Math.abs(lx) > L ? Math.hypot(Math.abs(lx) - L, ly) : Math.abs(ly)) / rs * r;
    } else d = shapeDist(p.shape, lx, ly);
    return ramp((d - r) / C.be);
  },
  expanded(C, p, u, v) {
    const N = C.N, M = Math.max(1, Math.round(N * 1.7));
    const a = u * N, b = v * M, ws = 0.07 + 0.16 * p.width;
    const strand = (q) => {
      const s = q - Math.round(q), e = Math.abs(s);
      if (e >= ws) return 0;
      const body = ramp((ws - e) / Math.max(C.be * 1.4, 0.02));
      return body * (0.72 + 0.28 * (s / ws));   // strands are inclined: one edge stands proud
    };
    return Math.max(strand(a + b), strand(a - b));
  },
  knurl(C, p, u, v) {
    const N = C.N, plateau = 0.6 * p.width;
    const t2 = (x) => Math.abs(2 * fract(x) - 1);
    const h = 1 - Math.max(t2((u + v) * N), t2((u - v) * N));
    return clamp01(h / (1 - plateau));
  },
  straightKnurl(C, p, u, v) {
    const plateau = 0.6 * p.width;
    return clamp01(tri(u * C.N) / (1 - plateau));
  },
  woven(C, p, u, v) {
    const N = even(C.N), x = u * N, y = v * N, i = Math.floor(x), j = Math.floor(y);
    const r = 0.2 + 0.24 * p.width;
    let h = 0;
    const dy = y - j - 0.5, dx = x - i - 0.5;
    if (Math.abs(dy) < r) {
      const z = Math.cos(Math.PI * (x - 0.5) + Math.PI * j);
      h = Math.max(h, 0.5 + 0.25 * z + 0.25 * dome(Math.abs(dy) / r));
    }
    if (Math.abs(dx) < r) {
      const z = Math.cos(Math.PI * (y - 0.5) + Math.PI * i + Math.PI);
      h = Math.max(h, 0.5 + 0.25 * z + 0.25 * dome(Math.abs(dx) / r));
    }
    return h;
  },
  welded(C, p, u, v) {
    const N = C.N, lx = fract(u * N) - 0.5, ly = fract(v * N) - 0.5;
    const r = 0.06 + 0.12 * p.width;
    let h = 0;
    if (Math.abs(ly) < r) h = Math.max(h, 0.55 + 0.45 * dome(Math.abs(ly) / r));
    if (Math.abs(lx) < r) h = Math.max(h, 0.2 + 0.45 * dome(Math.abs(lx) / r));
    const d = Math.hypot(lx, ly), rn = r * (1.2 + 0.8 * p.detail);
    if (d < rn) h = Math.max(h, 0.6 + 0.35 * dome(d / rn));
    return h;
  },
  grating(C, p, u, v) {
    const N = C.N, t = 0.03 + 0.1 * p.width;
    const K = Math.max(2, Math.round(2 + 10 * (1 - p.density)));
    const Mc = Math.max(1, Math.round(N / K));
    const dx = Math.abs(fract(u * N) - 0.5);                 // bearing bars (cell units)
    const dyc = Math.abs(fract(v * Mc) - 0.5) * (N / Mc);    // cross bars, in the same units
    let h = 0;
    if (0.5 - dx < t) {
      h = ramp((t - (0.5 - dx)) / C.be);
      if (p.variation > 0 && tri(v * N * 5) < 0.4 * p.variation) h *= 0.72;   // serrated tops
    }
    const tc = t * 1.5;
    if (0.5 * (N / Mc) - dyc < tc) {
      const hb = 0.82 * ramp((tc - (0.5 * (N / Mc) - dyc)) / C.be) * (0.82 + 0.18 * tri(u * N * 3 + v * N * 3));
      h = Math.max(h, hb);
    }
    return h;
  },
  chainLink(C, p, u, v) {
    const N = even(C.N), M = N / 2;
    const x = u * N, y = v * N, i0 = Math.floor(x);
    const r = 0.05 + 0.09 * p.width, k = 2 * M / N, norm = 1 / Math.sqrt(1 + k * k);
    let h = 0;
    for (let di = -1; di <= 1; di++) {
      const i = i0 + di, s = (mod(i, N) & 1) ? -1 : 1;
      const xz = i + 0.5 + s * 0.5 * (2 * tri(v * M) - 1);
      const d = Math.abs(x - xz) * norm;
      if (d < r) {
        const hook = 0.5 + 0.5 * Math.cos(2 * Math.PI * v * M + (s > 0 ? 0 : Math.PI));   // wraps over at the bends
        h = Math.max(h, (0.75 + 0.25 * hook) * Math.pow(dome(d / r), 0.6));
      }
    }
    return h;
  },
  honeycomb(C, p, u, v) {
    const Nx = C.N, Ny = Math.max(1, Math.round(Nx / SQ3));
    const X = u * Nx, Y = v * Ny * SQ3;
    const ax = X - Math.round(X), ay = Y - SQ3 * Math.round(Y / SQ3);
    const Xb = X - 0.5, Yb = Y - H3;
    const bx = Xb - Math.round(Xb), by = Yb - SQ3 * Math.round(Yb / SQ3);
    const [lx, ly] = (ax * ax + ay * ay <= bx * bx + by * by) ? [ax, ay] : [bx, by];
    const d = Math.max(Math.abs(lx), Math.abs(lx) * 0.5 + Math.abs(ly) * H3);
    const t = 0.015 + 0.09 * p.width;
    return ramp((d - (0.5 - t)) / C.be);
  },
  isogrid(C, p, u, v) {
    const Nx = C.N, Ny = Math.max(1, Math.round(Nx / SQ3));
    const X = u * Nx, Y = v * Ny * SQ3;
    const dl = (s) => Math.abs(s - H3 * Math.round(s / H3));
    const d0 = dl(Y), d1 = dl(X * H3 - Y * 0.5), d2 = dl(X * H3 + Y * 0.5);
    const kf = 0.02 + 0.12 * p.bevel;
    const D = smin(smin(d0, d1, kf), d2, kf);
    const w = 0.012 + 0.06 * p.width;
    let h = ramp((w - D) / C.aa + 0.5);
    if (p.detail > 0) {
      // node bosses (with a bolt hole when detail is high)
      const ax = X - Math.round(X), ay = Y - SQ3 * Math.round(Y / SQ3);
      const Xb = X - 0.5, Yb = Y - H3;
      const bx = Xb - Math.round(Xb), by = Yb - SQ3 * Math.round(Yb / SQ3);
      const dv = Math.sqrt(Math.min(ax * ax + ay * ay, bx * bx + by * by));
      const rb = w * (1.5 + 2.5 * p.detail);
      if (dv < rb) h = Math.max(h, p.detail > 0.6 && dv < rb * 0.38 ? 0.55 : ramp((rb - dv) / C.aa + 0.5));
    }
    return h;
  },
  orthogrid(C, p, u, v) {
    const N = C.N, X = u * N, Y = v * N;
    const ex = Math.abs(X - Math.round(X)), ey = Math.abs(Y - Math.round(Y));
    const D = smin(ex, ey, 0.02 + 0.14 * p.bevel);
    const w = 0.015 + 0.07 * p.width;
    let h = ramp((w - D) / C.aa + 0.5);
    if (p.detail > 0) {
      const dv = Math.hypot(ex, ey), rb = w * (1.5 + 2.5 * p.detail);
      if (dv < rb) h = Math.max(h, p.detail > 0.6 && dv < rb * 0.38 ? 0.55 : ramp((rb - dv) / C.aa + 0.5));
    }
    return h;
  },
  rivets(C, p, u, v) {
    const Px = C.N, Py = even(Math.max(1, Math.round(C.N * 0.55)));
    const Y = v * Py, j = Math.floor(Y);
    const X = u * Px - (j & 1) * 0.5, i = Math.floor(X);
    const pw = 1 / Px, ph = 1 / Py, U = ph;
    const lx = (X - i - 0.5) * pw, ly = (Y - j - 0.5) * ph;            // tile units
    const ex = pw / 2 - Math.abs(lx), ey = ph / 2 - Math.abs(ly);
    const e = Math.min(ex, ey), g = U * (0.008 + 0.025 * p.width);
    const L = 0.6 + 0.3 * p.variation * (hashf(mod(i, Px), mod(j, Py), C.S) - 0.5);
    let h = e < g ? 0.12 : 0.12 + (L - 0.12) * ramp((e - g) / (C.beT * 0.6));
    // rivet rows just inside every edge
    const ins = U * 0.1, rr = U * (0.022 + 0.03 * p.width);
    const nx = Math.max(2, Math.round((3 + 9 * p.density) * pw / ph)), ny = Math.max(2, Math.round(2 + 4 * p.density));
    const near = (pos, half, n) => {   // nearest of n evenly spaced points over [-half+ins, half-ins]
      const a = -half + ins, step = (2 * (half - ins)) / (n - 1);
      const k = Math.max(0, Math.min(n - 1, Math.round((pos - a) / step)));
      return pos - (a + k * step);
    };
    const dTop = Math.hypot(near(lx, pw / 2, nx), Math.abs(ly) - (ph / 2 - ins));
    const dSide = Math.hypot(Math.abs(lx) - (pw / 2 - ins), near(ly, ph / 2, ny));
    const d = Math.min(dTop, dSide);
    if (d < rr) h = Math.max(h, L + 0.32 * dome(d / rr));
    return h;
  },
  corrugated(C, p, u, v) {
    const t = fract(u * C.N);
    if (p.shape === 'square') {   // trapezoidal roofing
      const rib = 0.18 + 0.3 * p.width, sl = 0.05 + 0.12 * p.bevel;
      const a = 0.5 - rib / 2, b = 0.5 + rib / 2;
      let h = sstep(a - sl, a, t) * (1 - sstep(b, b + sl, t));
      if (p.detail > 0) {        // stiffening ribs in the pan
        const q = Math.min(Math.abs(t - 0.12), Math.abs(t - 0.88), Math.abs(t + 0.12 - 1));
        h = Math.max(h, 0.14 * p.detail * dome(q / 0.035));
      }
      return h;
    }
    const s = 0.5 + 0.5 * Math.cos(2 * Math.PI * t);
    return Math.pow(s, 0.6 + 1.2 * p.width);
  },
  louvres(C, p, u, v) {
    const Nx = C.N, Ny = Math.max(1, Math.round(C.N * (1.2 + 1.6 * p.density)));
    const lx = fract(u * Nx) - 0.5, ly = fract(v * Ny) - 0.5;
    const half = 0.32 + 0.12 * p.width, hy = 0.32;
    const plate = 0.4;
    if (Math.abs(ly) > hy || Math.abs(lx) > half) return plate;
    const t = (ly + hy) / (2 * hy);                            // 0 = cut edge, 1 = blends into the plate
    const end = sstep(half, half - 0.08, Math.abs(lx));
    if (t < 0.14) return plate * (1 - end) + 0.02 * end;      // the opening under the hood
    return plate + (0.58 * (1 - t)) * end;
  },
  fins(C, p, u, v) {
    const d = Math.abs(fract(u * C.N) - 0.5), w = 0.05 + 0.25 * p.width;
    let h = ramp((w - d) / C.be);
    if (p.detail > 0) {   // cross-cut slots through the fins
      const cy = fract(v * Math.max(1, Math.round(C.N * 0.5)));
      if (Math.abs(cy - 0.5) < 0.04 + 0.12 * p.detail) h *= 0.15;
    }
    return h;
  },
  pins(C, p, u, v) {
    const N = C.N, lx = fract(u * N) - 0.5, ly = fract(v * N) - 0.5;
    const r = 0.12 + 0.28 * p.width;
    return ramp((r - shapeDist(p.shape === 'slot' ? 'round' : p.shape, lx, ly)) / C.be);
  },
  studs(C, p, u, v) {
    const N = even(C.N), y = v * N, j = Math.floor(y);
    const lx = fract(u * N - (j & 1) * 0.5) - 0.5, ly = y - j - 0.5;
    const r = 0.16 + 0.22 * p.width, d = Math.hypot(lx, ly);
    return 0.15 + 0.85 * ramp((r - d) / C.be);
  },
  breadboard(C, p, u, v) {
    const cols = C.N * 6, rows = 16;
    const X = u * cols, Y = v * rows, ix = Math.floor(X), iy = Math.floor(Y);
    const lx = X - ix - 0.5, ly = Y - iy - 0.5;
    const isRail = iy === 0 || iy === 1 || iy === 14 || iy === 15;
    const isTerm = (iy >= 3 && iy <= 7) || (iy >= 8 && iy <= 12);
    let h = 1;
    if (iy === 2 || iy === 13) {                         // rail markings
      if (Math.abs(ly) < 0.06) h = 0.8;
    } else if (Math.abs(Y - 8) < 0.35) {                 // centre channel
      h = 0.15 + 0.85 * ramp((Math.abs(Y - 8) - 0.3) / 0.05);
    }
    const holeHere = isTerm || (isRail && (ix % 6) !== 5);
    if (holeHere) {
      const s = 0.15 + 0.12 * p.width, d = Math.max(Math.abs(lx), Math.abs(ly));
      h = Math.min(h, ramp((d - s) / (C.be * 0.4)));
    }
    return h;
  },
  inductor(C, p, u, v) {
    // A true square spiral (sides grow by one pitch every two turns of 90°),
    // same in every cell; distance to its segments.
    if (!C.spiral) {
      const turns = Math.round(2 + 6 * p.density), a = 0.8 / (2 * turns + 1);
      const D4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      const pts = [[0, 0]];
      for (let k = 0; k < 4 * turns; k++) {
        const L = a * Math.ceil((k + 1) / 2), [dx, dy] = D4[k % 4], [x, y] = pts[pts.length - 1];
        pts.push([x + dx * L, y + dy * L]);
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      C.spiral = { pts: pts.map(([x, y]) => [x - cx, y - cy]), w: a * (0.22 + 0.45 * p.width), a };
    }
    const { pts, w, a } = C.spiral;
    const lx = fract(u * C.N) - 0.5, ly = fract(v * C.N) - 0.5;
    let d = Infinity;
    for (let k = 1; k < pts.length; k++) {
      const [ax, ay] = pts[k - 1], [bx, by] = pts[k];
      const ex = bx - ax, ey = by - ay, t = clamp01(((lx - ax) * ex + (ly - ay) * ey) / (ex * ex + ey * ey));
      d = Math.min(d, Math.hypot(lx - ax - ex * t, ly - ay - ey * t));
    }
    let h = ramp((w / 2 - d) / C.aa + 0.5);
    const pad = a * 0.45;
    for (const [px, py] of [pts[0], pts[pts.length - 1]]) {
      if (Math.max(Math.abs(lx - px), Math.abs(ly - py)) < pad) h = 1;
    }
    return h;
  },
  weld(C, p, u, v) {
    const M = C.N, Y = v * M, j = Math.floor(Y);
    const off = 0.14 * p.variation * noise(u, (mod(j, M) + 0.5) / M, 4, C.S + 7);
    const ly = Y - j - 0.5 - off, bw = 0.16 + 0.26 * p.width, s = ly / bw;
    let h = 0;
    if (Math.abs(s) < 1) {
      const Q = Math.max(1, Math.round(M * (3 + 7 * p.detail)));
      const ph = fract(u * Q + 0.4 * s * s);
      const rip = Math.pow(ph, 3);
      h = Math.pow(dome(Math.abs(s)), 0.7) * (0.84 + 0.16 * rip);
    }
    if (p.density > 0) {   // spatter
      const G = M * 8, gx = u * G, gy = v * G, ci = Math.floor(gx), cj = Math.floor(gy);
      const hs = hashf(mod(ci, G), mod(cj, G), C.S + 11);
      if (hs < 0.12 * p.density) {
        const cx = ci + 0.2 + 0.6 * hashf(ci, cj, C.S + 12), cy = cj + 0.2 + 0.6 * hashf(ci, cj, C.S + 13);
        const d = Math.hypot(gx - cx, gy - cy), rs = 0.08 + 0.15 * hashf(ci, cj, C.S + 14);
        if (d < rs) h = Math.max(h, 0.35 * dome(d / rs));
      }
    }
    return h;
  },
  perlage(C, p, u, v) {
    const N = C.N, x = u * N, y = v * N, ci = Math.floor(x), cj = Math.floor(y);
    const R = 0.55 + 0.4 * p.width, K = 2 + 8 * p.detail;
    let best = -Infinity, h = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      const jx = (hashf(mod(i, N), mod(j, N), C.S) - 0.5) * 0.25 * p.variation;
      const jy = (hashf(mod(i, N), mod(j, N), C.S + 1) - 0.5) * 0.25 * p.variation;
      const d = Math.hypot(x - (i + 0.5 + jx), y - (j + 0.5 + jy));
      const order = j * 4096 + i;   // later rows / columns lie on top (local, so it wraps cleanly)
      if (d < R && order > best) {
        best = order;
        const q = d / R;
        h = 0.3 * q + 0.7 * (0.5 + 0.5 * Math.cos(2 * Math.PI * q * K)) * (0.4 + 0.6 * q);
      }
    }
    return h;
  },
  faceMill(C, p, u, v) {
    const M = C.N, Y = v * M, cj = Math.floor(Y);
    const R = (0.55 + 0.45 * p.width) / M;
    const Q = Math.max(1, Math.round(M * (6 + 20 * p.detail)));
    for (let dj = 1; dj >= -1; dj--) {     // the later pass wins
      const j = cj + dj, dy = (Y - (j + 0.5)) / M;
      if (Math.abs(dy) >= R) continue;
      const xc = u + Math.sqrt(R * R - dy * dy);
      const sc = fract(xc * Q);
      const step = 0.1 * p.variation * (hashf(mod(j, M), 0, C.S) - 0.5);
      return 0.5 + step + 0.3 * (sc * sc - 0.33);
    }
    return 0.5;
  },
  chain: (C, p, u, v) => chainField(C, p, u, v, 'classic'),
  studChain: (C, p, u, v) => chainField(C, p, u, v, 'stud'),
  curbChain: (C, p, u, v) => chainField(C, p, u, v, 'curb'),
  hangingChain: (C, p, u, v) => chainField(C, p, u, v, 'hanging'),
  barbed4: (C, p, u, v) => barbedField(C, p, u, v, 'barb4'),
  barbed2: (C, p, u, v) => barbedField(C, p, u, v, 'barb2'),
  barbedSingle: (C, p, u, v) => barbedField(C, p, u, v, 'single'),
  razor: (C, p, u, v) => razorField(C, p, u, v),
  brushed(C, p, u, v) {
    let h = 0, amp = 1, Py = C.N * 24, Px = 1;
    for (let o = 0; o < 4; o++) {
      h += amp * noise2(u, v, Px, Py, C.S + o * 31);
      amp *= 0.55; Py *= 2; Px *= 2;
    }
    if (p.detail > 0) {   // occasional deeper scratches
      const G = C.N * 60, row = Math.floor(v * G);
      if (hashf(mod(row, G), 3, C.S + 5) < 0.04 * p.detail) h -= 0.8 * (1 - Math.abs(fract(v * G) - 0.5) * 2);
    }
    return h;
  },
};

// ── Drawn patterns ───────────────────────────────────────────────────────────

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** Run `draw(ctx)` nine times (tile + its 8 neighbours) so anything crossing an edge wraps. */
function drawWrapped(ctx, size, unitPx, draw) {
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    ctx.save();
    ctx.translate(ox * size, oy * size);
    ctx.scale(unitPx, unitPx);
    draw(ctx);
    ctx.restore();
  }
}

const grey = (g) => { const v = Math.round(clamp01(g) * 255); return `rgb(${v},${v},${v})`; };

function readGrey(ctx, size) {
  const d = ctx.getImageData(0, 0, size, size).data, out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

/**
 * Chamfer: lower every plateau edge along a cone of `slope` (height per px),
 * a two-pass 8-neighbour sweep on the wrapped grid.
 */
function chamfer(h, size, slope) {
  if (!(slope > 0) || slope >= 1) return h;
  const d1 = slope, d2 = slope * Math.SQRT2;
  for (let it = 0; it < 2; it++) {
    for (let y = 0; y < size; y++) {
      const ym = mod(y - 1, size) * size, yr = y * size;
      for (let x = 0; x < size; x++) {
        const xm = mod(x - 1, size), xp = mod(x + 1, size);
        let m = h[yr + x];
        const a = h[yr + xm] + d1, b = h[ym + x] + d1, c = h[ym + xm] + d2, e = h[ym + xp] + d2;
        if (a < m) m = a; if (b < m) m = b; if (c < m) m = c; if (e < m) m = e;
        h[yr + x] = m;
      }
    }
    for (let y = size - 1; y >= 0; y--) {
      const yp = mod(y + 1, size) * size, yr = y * size;
      for (let x = size - 1; x >= 0; x--) {
        const xm = mod(x - 1, size), xp = mod(x + 1, size);
        let m = h[yr + x];
        const a = h[yr + xp] + d1, b = h[yp + x] + d1, c = h[yp + xp] + d2, e = h[yp + xm] + d2;
        if (a < m) m = a; if (b < m) m = b; if (c < m) m = c; if (e < m) m = e;
        h[yr + x] = m;
      }
    }
  }
  return h;
}

/** Seeded RNG for layouts. */
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

const DIRS8 = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const unit8 = (d) => { const [x, y] = DIRS8[mod(d, 8)]; const l = Math.hypot(x, y); return [x / l, y / l]; };

/**
 * Offset a polyline by `o` (cells) with mitred corners — one track of a bus.
 * Normals point left of travel.
 */
function offsetPolyline(pts, o) {
  if (o === 0) return pts.map(p => [p[0], p[1]]);
  const out = [];
  const nrm = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
  for (let k = 0; k < pts.length; k++) {
    const n1 = k > 0 ? nrm(pts[k - 1], pts[k]) : null, n2 = k < pts.length - 1 ? nrm(pts[k], pts[k + 1]) : null;
    let mx, my, s = 1;
    if (n1 && n2) {
      mx = n1[0] + n2[0]; my = n1[1] + n2[1];
      const l = Math.hypot(mx, my) || 1; mx /= l; my /= l;
      s = 1 / Math.max(0.35, mx * n1[0] + my * n1[1]);
    } else [mx, my] = n1 || n2;
    out.push([pts[k][0] + mx * o * s, pts[k][1] + my * o * s]);
  }
  return out;
}

/**
 * Circuit board layout on a wrapped G × G grid (cell units): ICs and two-pad
 * parts, then buses — groups of parallel tracks that bend together at 45° (or
 * 90°) and end in staggered vias — routed so that nothing crosses.
 */
function layoutPCB(p, G, ortho, R) {
  const F = 2, GF = G * F;                         // occupancy at half-cell resolution
  const occ = new Uint8Array(GF * GF);
  const oi = (x, y) => mod(Math.floor(y * F), GF) * GF + mod(Math.floor(x * F), GF);
  const hit = (x, y) => occ[oi(x, y)] === 1;
  const mark = (x, y, r = 1) => {
    const cx = Math.floor(x * F), cy = Math.floor(y * F);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) occ[mod(cy + dy, GF) * GF + mod(cx + dx, GF)] = 1;
  };
  const rectFree = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y += 0.5) for (let x = x0; x <= x1; x += 0.5) if (hit(x, y)) return false;
    return true;
  };
  const rectMark = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y += 0.5) for (let x = x0; x <= x1; x += 0.5) mark(x, y); };

  const pads = [], vias = [], traces = [], busStarts = [];
  const turnStep = ortho ? 2 : 1;

  // ── components ──
  const nIC = Math.round(G * G * 0.0035 * (0.3 + p.detail));
  for (let c = 0; c < nIC; c++) {
    const n = 4 + Math.floor(R() * 7), body = 3 + Math.floor(R() * 2), horiz = R() < 0.5;
    const x = Math.floor(R() * G), y = Math.floor(R() * G);
    const [w, h] = horiz ? [n - 1, body] : [body, n - 1];
    if (!rectFree(x - 1, y - 1, x + w + 1, y + h + 1)) continue;
    rectMark(x - 0.5, y - 0.5, x + w + 0.5, y + h + 0.5);
    for (let k = 0; k < n; k++) for (const side of [0, 1]) {
      const px = horiz ? x + k : x + side * body, py = horiz ? y + side * body : y + k;
      pads.push({ x: px, y: py, w: horiz ? 0.5 : 0.95, h: horiz ? 0.95 : 0.5 });
    }
    // a bus leaves each pad row, pointing away from the body
    if (horiz) {
      busStarts.push({ x: x + (n - 1) / 2, y: y - 0.6, dir: 6, n, from: 'ic' });
      busStarts.push({ x: x + (n - 1) / 2, y: y + body + 0.6, dir: 2, n, from: 'ic' });
    } else {
      busStarts.push({ x: x - 0.6, y: y + (n - 1) / 2, dir: 4, n, from: 'ic' });
      busStarts.push({ x: x + body + 0.6, y: y + (n - 1) / 2, dir: 0, n, from: 'ic' });
    }
  }
  const nSmd = Math.round(G * G * 0.006 * (0.3 + p.detail));
  for (let c = 0; c < nSmd; c++) {
    const x = Math.floor(R() * G), y = Math.floor(R() * G), horiz = R() < 0.5;
    const [x2, y2] = horiz ? [x + 2, y] : [x, y + 2];
    if (!rectFree(x - 1, y - 1, x2 + 1, y2 + 1)) continue;
    rectMark(x - 0.5, y - 0.5, x2 + 0.5, y2 + 0.5);
    pads.push({ x, y, w: horiz ? 0.8 : 0.95, h: horiz ? 0.95 : 0.8 }, { x: x2, y: y2, w: horiz ? 0.8 : 0.95, h: horiz ? 0.95 : 0.8 });
    if (R() < 0.7) busStarts.push({ x: horiz ? x - 0.6 : x, y: horiz ? y : y - 0.6, dir: horiz ? 4 : 6, n: 1, from: 'pad' });
    if (R() < 0.7) busStarts.push({ x: horiz ? x2 + 0.6 : x2, y: horiz ? y2 : y2 + 0.6, dir: horiz ? 0 : 2, n: 1, from: 'pad' });
  }

  // ── buses ──
  const route = (start) => {
    const { n } = start;
    let dir = ortho ? start.dir & 6 : start.dir;
    const offs = Array.from({ length: n }, (_, j) => j - (n - 1) / 2);
    const center = [[start.x, start.y]];
    const maxSegs = 2 + Math.floor(R() * (3 + 5 * p.density));
    const pending = [];
    for (let s = 0; s < maxSegs; s++) {
      const [ux, uy] = unit8(dir);
      const step = DIRS8[mod(dir, 8)];
      let len = 2 + Math.floor(R() * (3 + G * 0.12 * (0.5 + p.density)));
      const [cx, cy] = center[center.length - 1];
      // check every track of the new segment (skipping the corner, which is the bus's own)
      const nx = -uy, ny = ux;
      let ok = 0;
      for (let t = 1; t <= len; t++) {
        let blocked = false;
        for (const o of offs) {
          for (let q = (t === 1 ? 0.5 : 0); q < 1; q += 0.5) {
            const px = cx + step[0] * (t - 1 + q + 0.5) + nx * o, py = cy + step[1] * (t - 1 + q + 0.5) + ny * o;
            if (hit(px, py)) { blocked = true; break; }
          }
          if (blocked) break;
        }
        if (blocked) break;
        ok = t;
      }
      if (ok < 1) break;
      len = ok;
      const end = [cx + step[0] * len, cy + step[1] * len];
      center.push(end);
      pending.push({ cx, cy, step, len, nx, ny });
      // mark what's settled (all but the newest segment, whose corner may still change)
      while (pending.length > 1) {
        const sg = pending.shift();
        for (let t = 0; t <= sg.len; t += 0.5) for (const o of offs) mark(sg.cx + sg.step[0] * t + sg.nx * o, sg.cy + sg.step[1] * t + sg.ny * o);
      }
      if (ok < len || R() < 0.5) dir = mod(dir + (R() < 0.5 ? 1 : -1) * turnStep, 8);
    }
    for (const sg of pending) for (let t = 0; t <= sg.len; t += 0.5) for (const o of offs) mark(sg.cx + sg.step[0] * t + sg.nx * o, sg.cy + sg.step[1] * t + sg.ny * o);
    if (center.length < 2) return;
    // merge collinear runs, then offset each track
    const pts = [center[0]];
    for (let k = 1; k < center.length; k++) {
      const a = pts[pts.length - 1], b = center[k], c = center[k + 1];
      if (c && Math.sign(b[0] - a[0]) === Math.sign(c[0] - b[0]) && Math.sign(b[1] - a[1]) === Math.sign(c[1] - b[1])) continue;
      pts.push(b);
    }
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    const ex = Math.sign(last[0] - prev[0]), ey = Math.sign(last[1] - prev[1]);
    for (let j = 0; j < n; j++) {
      const tr = offsetPolyline(pts, offs[j]);
      // staggered via fan-out: alternate tracks run one cell further
      const ext = n > 1 && (j & 1) ? 1.1 : 0;
      const e = tr[tr.length - 1];
      if (ext) { tr.push([e[0] + ex * ext, e[1] + ey * ext]); }
      traces.push(tr);
      const v = tr[tr.length - 1];
      if (n > 1 || R() < 0.8) vias.push({ x: v[0], y: v[1] }); else pads.push({ x: v[0], y: v[1], w: 0.8, h: 0.8 });
      if (start.from === 'via') vias.push({ x: tr[0][0], y: tr[0][1] });
    }
  };
  for (const s of busStarts) route(s);
  const nFree = Math.round(G * G * 0.045 * (0.25 + p.density));
  for (let k = 0; k < nFree; k++) {
    const x = Math.floor(R() * G) + 0.5, y = Math.floor(R() * G) + 0.5;
    if (hit(x, y)) continue;
    const r = R(), n = r < 0.55 ? 1 : r < 0.8 ? 2 + Math.floor(R() * 2) : 4 + Math.floor(R() * 5);
    route({ x, y, dir: Math.floor(R() * 8), n, from: 'via' });
  }
  return { pads, vias, traces };
}

function drawPCB(p, size, R, mode) {
  const ortho = mode === 'pcbOrtho', pour = mode === 'pcbPour';
  const G = Math.max(6, Math.round(C_N(p) * 6));
  const unit = size / G;
  const L = layoutPCB(p, G, ortho, R);
  const cv = makeCanvas(size, size), ctx = cv.getContext('2d');
  ctx.fillStyle = grey(pour ? 0.5 : 0); ctx.fillRect(0, 0, size, size);
  const tw = 0.22 + 0.3 * p.width, clr = 0.22;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const paint = (g, grow) => (c) => {
    c.fillStyle = c.strokeStyle = grey(g);
    c.lineWidth = tw + 2 * grow;
    for (const pts of L.traces) {
      c.beginPath(); c.moveTo(pts[0][0] + 0.5, pts[0][1] + 0.5);
      for (let k = 1; k < pts.length; k++) c.lineTo(pts[k][0] + 0.5, pts[k][1] + 0.5);
      c.stroke();
    }
    for (const pd of L.pads) {
      c.beginPath(); c.roundRect(pd.x + 0.5 - pd.w / 2 - grow, pd.y + 0.5 - pd.h / 2 - grow, pd.w + 2 * grow, pd.h + 2 * grow, 0.08);
      c.fill();
    }
    for (const vi of L.vias) { c.beginPath(); c.arc(vi.x + 0.5, vi.y + 0.5, 0.36 + grow, 0, Math.PI * 2); c.fill(); }
  };
  if (pour) drawWrapped(ctx, size, unit, paint(0, clr));       // clearance moat in the pour
  drawWrapped(ctx, size, unit, paint(1, 0));                    // copper
  drawWrapped(ctx, size, unit, (c) => {                         // drilled via holes
    c.fillStyle = grey(0);
    for (const vi of L.vias) { c.beginPath(); c.arc(vi.x + 0.5, vi.y + 0.5, 0.15, 0, Math.PI * 2); c.fill(); }
  });
  return readGrey(ctx, size);
}

function drawChip(p, size, R) {
  const cv = makeCanvas(size, size), ctx = cv.getContext('2d');
  ctx.fillStyle = grey(0); ctx.fillRect(0, 0, size, size);
  const n = Math.round(6 + 14 * p.density);              // pins per side
  const body = 0.42, pitch = body / (n + 1), padL = 0.06, padW = pitch * (0.35 + 0.3 * p.width);
  const tw = padW * 0.75;
  drawWrapped(ctx, size, size, (c) => {
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = c.fillStyle = grey(1);
    for (let side = 0; side < 4; side++) {
      c.save(); c.translate(0.5, 0.5); c.rotate(side * Math.PI / 2);
      for (let k = 0; k < n; k++) {
        const a = -body / 2 + pitch * (k + 1);
        const y0 = body / 2 + 0.02;
        c.fillRect(a - padW / 2, y0, padW, padL);
        // fan-out: straight out, 45° spread, then straight to the tile edge
        const spread = (k - (n - 1) / 2) / ((n - 1) / 2 || 1);
        const fanTo = a * (1.95 + 0.25 * p.variation);
        const y1 = y0 + padL + 0.015, y2 = y1 + Math.abs(fanTo - a), y3 = 0.5;
        c.lineWidth = tw;
        c.beginPath(); c.moveTo(a, y0 + padL); c.lineTo(a, y1); c.lineTo(fanTo, y2); c.lineTo(fanTo, y3); c.stroke();
        if (p.detail > 0.3 && Math.abs(spread) < 0.999 && (k % 3 === 1)) {
          c.beginPath(); c.arc(fanTo, y2 + (y3 - y2) * 0.45, tw * 1.25, 0, Math.PI * 2); c.fill();
        }
      }
      c.restore();
    }
    // package outline and pin-1 mark (silkscreen, lower)
    c.strokeStyle = grey(0.45); c.lineWidth = 0.006;
    c.strokeRect(0.5 - body / 2 + 0.01, 0.5 - body / 2 + 0.01, body - 0.02, body - 0.02);
    c.fillStyle = grey(0.45);
    c.beginPath(); c.arc(0.5 - body / 2 + 0.05, 0.5 - body / 2 + 0.05, 0.012, 0, Math.PI * 2); c.fill();
  });
  return readGrey(ctx, size);
}

/** Sci-fi hull panels: recursive panel split with insets, vents and bolts. */
function drawPanels(p, size, R) {
  const cv = makeCanvas(size, size), ctx = cv.getContext('2d');
  ctx.fillStyle = grey(0.12); ctx.fillRect(0, 0, size, size);
  const minSize = 1 / Math.max(2, C_N(p) * 2);
  const leaves = [];
  const split = (x, y, w, h, depth) => {
    const big = Math.max(w, h);
    if (depth > 0 && (big < minSize * 1.6 || (depth > 1 && R() < 0.18 + 0.2 * (1 - p.density)))) { leaves.push([x, y, w, h]); return; }
    const vert = w > h ? R() < 0.8 : R() < 0.2;
    const f = 0.3 + 0.4 * R();
    const snap = (t) => Math.round(t * 8) / 8;
    const cut = Math.min(0.85, Math.max(0.15, snap(f)));
    if (vert) { split(x, y, w * cut, h, depth + 1); split(x + w * cut, y, w * (1 - cut), h, depth + 1); }
    else { split(x, y, w, h * cut, depth + 1); split(x, y + h * cut, w, h * (1 - cut), depth + 1); }
  };
  split(0, 0, 1, 1, 0);
  const gap = 0.004 + 0.01 * p.width;
  drawWrapped(ctx, size, size, (c) => {
    for (const [x, y, w, h] of leaves) {
      const r = rng(Math.floor(x * 9973 + y * 7919 + w * 131 + h * 17) + (p.seed | 0));
      const L = 0.5 + 0.22 * (r() - 0.5) * (0.5 + p.variation);
      const X = x + gap / 2, Y = y + gap / 2, W = w - gap, H = h - gap;
      c.fillStyle = grey(L); c.fillRect(X, Y, W, H);
      const kind = r();
      const m = Math.min(W, H);
      if (kind < 0.3) {                         // raised inner plate
        const ins = m * 0.14; c.fillStyle = grey(L + 0.14); c.fillRect(X + ins, Y + ins, W - 2 * ins, H - 2 * ins);
      } else if (kind < 0.5) {                  // recessed bay
        const ins = m * 0.12; c.fillStyle = grey(L - 0.18); c.fillRect(X + ins, Y + ins, W - 2 * ins, H - 2 * ins);
      } else if (kind < 0.5 + 0.3 * (0.4 + p.detail)) {   // vent slots
        const horiz = W > H, n = Math.max(2, Math.floor((horiz ? W : H) / (m * 0.22)));
        c.fillStyle = grey(0.08);
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n;
          c.beginPath();
          if (horiz) c.roundRect(X + W * t - m * 0.05, Y + H * 0.2, m * 0.1, H * 0.6, m * 0.05);
          else c.roundRect(X + W * 0.2, Y + H * t - m * 0.05, W * 0.6, m * 0.1, m * 0.05);
          c.fill();
        }
      } else {                                  // grooved panel
        c.fillStyle = grey(L - 0.12);
        const n = 3 + Math.floor(r() * 4);
        for (let k = 1; k <= n; k++) c.fillRect(X + W * k / (n + 1) - m * 0.012, Y + m * 0.1, m * 0.024, H - m * 0.2);
      }
      if (p.detail > 0.2 && m > minSize * 0.6) {   // corner bolts
        const br = m * 0.045, bi = m * 0.09;
        c.fillStyle = grey(Math.min(1, L + 0.3));
        for (const [bx, by] of [[X + bi, Y + bi], [X + W - bi, Y + bi], [X + bi, Y + H - bi], [X + W - bi, Y + H - bi]]) {
          c.beginPath(); c.arc(bx, by, br, 0, Math.PI * 2); c.fill();
        }
      }
    }
  });
  return readGrey(ctx, size);
}

const C_N = (p) => Math.max(1, Math.round(p.scale));
const DRAWN = { pcb: drawPCB, pcbOrtho: drawPCB, pcbPour: drawPCB, chip: drawChip, panels: drawPanels };

// ── Generator entry points (proceduralWorker.js) ────────────────────────────

function context(p, size) {
  const N = C_N(p), px = N / size;                 // one pixel in cell units
  return {
    N, S: (p.seed | 0) * 7919 + 3,
    be: Math.max(1.2 * px, 0.004 + 0.12 * p.bevel * p.bevel),    // chamfer width, cell units
    beT: Math.max(1.2 / size, (0.004 + 0.12 * p.bevel * p.bevel) / N),
    aa: Math.max(px, 1e-4),
  };
}

export function techRows(params, size, y0, y1) {
  const p = { ...DEFAULT_TECH_PARAMS, ...params };
  const out = new Float32Array(size * (y1 - y0));
  if (DRAWN[p.pattern]) return { struct: out };
  const fn = A[p.pattern] || A.diamondPlate;
  const C = context(p, size), inv = 1 / size;
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) * inv, row = (y - y0) * size;
    for (let x = 0; x < size; x++) out[row + x] = fn(C, p, (x + 0.5) * inv, v);
  }
  return { struct: out };
}

export function techFinish(params, size, struct) {
  const p = { ...DEFAULT_TECH_PARAMS, ...params };
  let h = struct;
  const draw = DRAWN[p.pattern];
  if (draw) {
    h = draw(p, size, rng((p.seed | 0) + 1), p.pattern);
    const bevelPx = 0.6 + p.bevel * p.bevel * size * 0.02;
    chamfer(h, size, 1 / bevelPx);
  }
  if (p.pattern === 'brushed') normalise(h, 0.002);
  if (p.softness > 0) blurWrap(h, size, p.softness * size * 0.004);
  return h;
}
