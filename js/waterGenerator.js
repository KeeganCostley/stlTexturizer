/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Procedural water / fluid / ice / air heightmaps ──────────────────────────
//
// Every field lives on the unit torus with integer periods, so maps tile
// seamlessly by construction:
//   • waves use integer wave-vectors (a Gerstner sea: crests pinch, troughs
//     broaden — the trochoid shape of real deep-water waves),
//   • point features (drops, sources, vortices) use the minimum-image
//     distance or compact support summed over periodic images,
//   • stripes use unimodular lattice coordinates (lineLattice), and their
//     forks are periodic phase vortices — atan2(sin 2πΔv, sin 2πΔu) has
//     winding +1 at the defect and the compensating −1 / +1 twins elsewhere
//     on the torus, exactly like the Y-junctions in real ripple fields,
//   • rivers and frost are polylines in a periodic bin grid.

import {
  TAU, hashf, mod, fract, lerp, clamp01, sstep,
  noise, noise2, fbm, ridged, worley, W, WC, lineLattice, blurWrap, normalise,
} from './proceduralCore.js';

export { heightsToRGBA } from './proceduralCore.js';

export const DEFAULT_WATER_PARAMS = Object.freeze({
  pattern: 'ocean',
  seed: 1,
  scale: 4,          // main features per tile (waves, ripples, cells …)
  angle: 0,          // wind / flow / shore direction (deg)
  spread: 0.35,      // directional spread of wave trains
  chop: 0.5,         // steepness / sharpness / strength
  complexity: 0.5,   // number of components / branching
  detail: 0.25,      // secondary fine layer (cat's paws, ladders, rills …)
  turbulence: 0.3,   // domain warp
  count: 0.5,        // drops / sources / channels / defects / crystals
  rings: 0.5,        // ring density / lobes / scroll bars
  decay: 0.5,        // spectrum fall-off / ring trail / reach / core
  width: 0.4,        // line, crack, channel or rim width
  asymmetry: 0.5,    // stoss–lee asymmetry
  variation: 0.5,    // size / amplitude randomness
  softness: 0.15,    // final rounding blur
  crest: 0,          // narrows wave crests into crisp ridges (open-water types)
  shoal: 0.6,        // surf: how much tighter waves get toward the shore (1× … 12×)
  bunch: 0.5,        // surf: where the tightening happens (early ↔ geometric ↔ late)
  shore: 0.82,       // surf: shoreline position across the map (beach beyond it)
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Small deterministic PRNG (mulberry32). */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const wrapd = (d) => d - Math.round(d);
/** Periodic 1-D noise along `t` (period 1); `row` picks an independent track. */
const noise1 = (t, row, P, seed) => noise(fract(t), fract(row * 0.6180339887), P, seed);
/** Periodic phase vortex: winding +1 at (x, y). */
const vortexAngle = (u, v, x, y) => Math.atan2(Math.sin(TAU * (v - y)), Math.sin(TAU * (u - x)));
/** Periodic log-distance (≈ log r near the centre, smooth everywhere else). */
const plog = (u, v, x, y, core2) => {
  const su = Math.sin(Math.PI * (u - x)), sv = Math.sin(Math.PI * (v - y));
  return 0.5 * Math.log(su * su + sv * sv + core2);
};

/** Lattice basis → (s, t) torus coordinates and back (a·d − b·c = 1). */
function basis(angle) {
  const L = lineLattice(angle, 1, 3);
  return L;
}
const toS = (L, u, v) => L.a * u + L.b * v;
const toT = (L, u, v) => L.c * u + L.d * v;
const fromST = (L, s, t) => [L.d * s - L.b * t, -L.c * s + L.a * t];

// ── Periodic segment grid (rivers, frost) ────────────────────────────────────
// Segments are stored flat, stride ST: x0 y0 x1 y1 w0 w1 h tag. Coordinates may
// run outside [0,1); queries use the minimum image of each segment's midpoint.

const ST = 8;
function buildSegGrid(segs, G, R) {
  const n = segs.length / ST;
  const counts = new Int32Array(G * G + 1);
  const visit = (i, f) => {
    const o = i * ST;
    const x0 = Math.min(segs[o], segs[o + 2]) - R, x1 = Math.max(segs[o], segs[o + 2]) + R;
    const y0 = Math.min(segs[o + 1], segs[o + 3]) - R, y1 = Math.max(segs[o + 1], segs[o + 3]) + R;
    const bx0 = Math.floor(x0 * G), bx1 = Math.min(Math.floor(x1 * G), bx0 + G - 1);
    const by0 = Math.floor(y0 * G), by1 = Math.min(Math.floor(y1 * G), by0 + G - 1);
    for (let by = by0; by <= by1; by++) {
      const row = mod(by, G) * G;
      for (let bx = bx0; bx <= bx1; bx++) f(row + mod(bx, G));
    }
  };
  for (let i = 0; i < n; i++) visit(i, (b) => { counts[b + 1]++; });
  for (let b = 0; b < G * G; b++) counts[b + 1] += counts[b];
  const fill = counts.slice(0, G * G);
  const items = new Int32Array(counts[G * G]);
  for (let i = 0; i < n; i++) visit(i, (b) => { items[fill[b]++] = i; });
  return { segs, G, start: counts, items };
}

/** Distance from (px, py) to segment i (periodic), result in Q. */
const Q = { d: 0, t: 0, side: 0 };
function segDist(segs, i, px, py) {
  const o = i * ST;
  let x0 = segs[o], y0 = segs[o + 1], x1 = segs[o + 2], y1 = segs[o + 3];
  const sx = Math.round(px - (x0 + x1) * 0.5), sy = Math.round(py - (y0 + y1) * 0.5);
  x0 += sx; x1 += sx; y0 += sy; y1 += sy;
  const ex = x1 - x0, ey = y1 - y0;
  const l2 = ex * ex + ey * ey || 1e-12;
  let t = ((px - x0) * ex + (py - y0) * ey) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (x0 + ex * t), dy = py - (y0 + ey * t);
  Q.d = Math.sqrt(dx * dx + dy * dy);
  Q.t = t;
  Q.side = ex * dy - ey * dx;
}

// ── Pattern builders (run once per parameter set) ───────────────────────────

function buildWaves(p, S) {
  const R = rng(S + 11);
  const n = Math.round(lerp(3, 40, p.complexity));
  const k0 = Math.max(1, p.scale);
  const dir = p.angle * Math.PI / 180;
  const waves = [];
  let steep = 0, var0 = 0;
  for (let i = 0; i < n; i++) {
    const kmag = k0 * Math.exp(R() * Math.log(1.2 + 7 * p.complexity));
    const th = dir + (R() + R() - 1) * Math.PI * p.spread;
    let kx = Math.round(kmag * Math.cos(th)), ky = Math.round(kmag * Math.sin(th));
    if (!kx && !ky) kx = 1;
    const km = Math.hypot(kx, ky);
    const amp = Math.pow(km / k0, -(0.6 + 2.2 * p.decay)) * (0.55 + 0.9 * R());
    waves.push({ kx, ky, km, amp, ph: R() * TAU });
    steep += amp * TAU * km;
    var0 += amp * amp * 0.5;
  }
  // Scale so the summed steepness is 1: Gerstner displacement stays a fold-free
  // map for chop < 1, crests pinch and troughs flatten.
  const ks = 1 / steep;
  for (const w of waves) { w.amp *= ks; w.dx = w.amp * w.kx / w.km; w.dy = w.amp * w.ky / w.km; }
  const hNorm = 1 / (Math.sqrt(var0) * ks);
  // Capillary layer (cat's paws): short random-direction ripples.
  const cap = [];
  const m = 14;
  for (let i = 0; i < m; i++) {
    const kmag = k0 * (7 + 9 * R());
    const th = R() * TAU;
    cap.push({ kx: Math.round(kmag * Math.cos(th)), ky: Math.round(kmag * Math.sin(th)), ph: R() * TAU });
  }
  return { waves, hNorm, cap, capNorm: 1 / Math.sqrt(m / 2) };
}

function buildRain(p, S) {
  const G = Math.max(2, Math.round(p.scale));
  return { G, S };
}

function buildInterference(p, S) {
  const R = rng(S + 21);
  const n = Math.round(lerp(2, 9, p.count));
  const src = [];
  for (let i = 0; i < n; i++) src.push({ x: R(), y: R(), ph: R() * TAU, a: 0.6 + 0.8 * R() });
  return { src, k: Math.max(2, p.scale * 2), Rc: lerp(0.35, 0.92, p.decay) };
}

function buildRipples(p, S) {
  const R = rng(S + 31);
  const L = lineLattice(p.angle, Math.max(1, p.scale));
  const nd = Math.round(p.count * 10);
  const defects = [];
  for (let i = 0; i < nd; i++) defects.push({ x: R(), y: R(), s: R() < 0.5 ? -1 : 1 });
  const crossLen = Math.hypot(L.c, L.d);
  const ladderN = Math.max(1, Math.round(p.scale * 2.6 / crossLen));
  const lobeN = Math.max(1, Math.round(lerp(1, 9, p.rings)));
  return { L, defects, ladderN, lobeN };
}

function buildSwash(p, S) {
  const R = rng(S + 41);
  const L = basis(p.angle);
  const K = Math.round(lerp(3, 16, p.count));
  const lines = [];
  for (let i = 0; i < K; i++) {
    lines.push({
      s: (i + 0.7 * R()) / K,
      m: Math.max(1, Math.round(p.scale * (0.6 + 0.8 * R()))),
      ph: R() * Math.PI,
      A: (0.02 + 0.05 * R()) * (0.4 + p.chop),
      str: 0.35 + 0.65 * R(),
      row: R() * 100,
    });
  }
  return { L, lines, w: lerp(0.0015, 0.012, p.width) };
}

function buildBraided(p, S) {
  const R = rng(S + 51);
  const L = basis(p.angle);
  const n = Math.round(lerp(3, 12, p.count));
  const ch = [];
  for (let i = 0; i < n; i++) {
    ch.push({
      s: R(),
      A: (0.03 + 0.09 * R()) * (0.3 + p.chop),
      m: Math.max(1, Math.round(p.scale * (0.5 + R()))),
      m2: Math.max(1, Math.round(p.scale * (1.5 + 2 * R()))),
      ph: R() * TAU, ph2: R() * TAU, ph3: R() * TAU,
      w: lerp(0.03, 0.12, p.width) * (0.6 + 0.8 * R()),
      d: 0.5 + 0.5 * R(),
    });
  }
  return { L, ch };
}

/** Kinoshita meander centre-lines, oxbow scars, binned for distance queries. */
function buildMeander(p, S) {
  const R = rng(S + 61);
  const L = basis(p.angle);
  const segs = [];
  const nCh = Math.round(lerp(1, 3, p.count));
  const w = lerp(0.006, 0.03, p.width);
  const band = lerp(0.03, 0.12, p.rings);
  const th0 = lerp(35, 118, p.chop) * Math.PI / 180;
  const pushSeg = (s0, t0, s1, t1, w0, h, curv) => {
    const [u0, v0] = fromST(L, s0, t0), [u1, v1] = fromST(L, s1, t1);
    segs.push(u0, v0, u1, v1, w0, w0, h, curv);
  };
  for (let c = 0; c < nCh; c++) {
    const m = Math.max(1, Math.round(p.scale * (c === 0 ? 1 : 0.6 + 0.8 * R())));
    const Js = (R() - 0.5) * 0.25, Jf = (R() - 0.5) * 0.2;
    const STEPS = 140;
    // Integrate one Kinoshita wavelength, then scale it to 1/m tile along t.
    const pts = [[0, 0]];
    let x = 0, y = 0;
    const thAt = (sg) => th0 * Math.sin(TAU * sg) + th0 * th0 * th0 * (Js * Math.cos(3 * TAU * sg) - Jf * Math.sin(3 * TAU * sg));
    for (let k = 1; k <= STEPS; k++) {
      const th = thAt((k - 0.5) / STEPS);
      x += Math.cos(th) / STEPS; y += Math.sin(th) / STEPS;
      pts.push([x, y]);
    }
    const X1 = x, Y1 = y;
    const sc = 1 / (m * X1);
    const s0 = R(), tOff = R();
    for (let rep = 0; rep < m; rep++) {
      for (let k = 0; k < STEPS; k++) {
        const a = pts[k], b = pts[k + 1];
        // remove net lateral drift so the channel closes on itself
        const ay = a[1] - Y1 * k / STEPS, by = b[1] - Y1 * (k + 1) / STEPS;
        const ta = tOff + (rep + a[0] / X1) / m, tb = tOff + (rep + b[0] / X1) / m;
        const curv = Math.sign(thAt((k + 1) / STEPS) - thAt(k / STEPS)) || 1;
        pushSeg(s0 + ay * sc, ta, s0 + by * sc, tb, w, 1, curv);
      }
    }
  }
  // Oxbow lakes: abandoned 300° loops, shallower and narrower.
  const nOx = Math.round(p.variation * 6);
  for (let i = 0; i < nOx; i++) {
    const cs = R(), ct = R(), r = lerp(0.035, 0.085, R()), a0 = R() * TAU, span = lerp(3.6, 5.4, R());
    const N = 48;
    for (let k = 0; k < N; k++) {
      const a = a0 + span * k / N, b = a0 + span * (k + 1) / N;
      pushSeg(cs + r * Math.cos(a), ct + r * Math.sin(a), cs + r * Math.cos(b), ct + r * Math.sin(b), w * 0.75, 0.55, 0);
    }
  }
  const grid = buildSegGrid(new Float64Array(segs), 128, w + band);
  return { grid, w, band, lam: band / lerp(2, 7, p.rings) };
}

/** Frost ferns: recursive dendrites with ~60° side branches. */
function buildFrost(p, S) {
  const R = rng(S + 71);
  const segs = [];
  const n = Math.round(lerp(4, 28, p.count));
  const len0 = lerp(0.08, 0.38, p.variation);
  const w0 = lerp(0.0025, 0.009, p.width);
  const maxLevel = p.complexity > 0.66 ? 3 : 2;
  const sideAng = lerp(50, 68, R()) * Math.PI / 180;
  const curl = lerp(0.02, 0.35, p.turbulence);
  let budget = 60000;
  function grow(x, y, th, len, w, level, h) {
    const step = Math.max(0.0025, len / 26);
    const steps = Math.max(2, Math.ceil(len / step));
    const every = Math.max(1, Math.round(lerp(5, 2, p.complexity)));
    let bend = (R() - 0.5) * curl;
    for (let k = 0; k < steps && budget > 0; k++) {
      th += bend / steps * 3 + (R() - 0.5) * curl * 0.15;
      const f = 1 - k / steps;
      const wa = w * (0.25 + 0.75 * f), wb = w * (0.25 + 0.75 * (f - 1 / steps));
      const x1 = x + Math.cos(th) * step, y1 = y + Math.sin(th) * step;
      segs.push(x, y, x1, y1, wa, wb, h * (0.7 + 0.3 * f), level);
      budget--;
      if (level < maxLevel && k > 0 && k % every === 0 && f > 0.15) {
        const sl = len * f * lerp(0.35, 0.6, R()) * (level === 0 ? 1 : 0.8);
        if (sl > step * 1.5) {
          const alt = level > 0 && R() < 0.5;
          if (!alt || k % (2 * every) === 0) grow(x1, y1, th + sideAng, sl, w * 0.62, level + 1, h * 0.85);
          if (!alt || k % (2 * every) !== 0) grow(x1, y1, th - sideAng, sl, w * 0.62, level + 1, h * 0.85);
        }
      }
      x = x1; y = y1;
    }
  }
  for (let i = 0; i < n; i++) {
    const x = R(), y = R(), th = R() * TAU;
    const L = len0 * (0.55 + 0.9 * R());
    grow(x, y, th, L, w0 * (0.7 + 0.6 * R()), 0, 1);
    if (R() < 0.35) grow(x, y, th + Math.PI + (R() - 0.5), L * 0.6, w0 * 0.8, 0, 0.95);
  }
  return { grid: buildSegGrid(new Float64Array(segs), 192, w0 * 1.05) };
}

function buildVortex(p, S, street) {
  const R = rng(S + 81);
  const L = lineLattice(p.angle, Math.max(1, p.scale));
  const B = basis(p.angle);
  const vort = [];
  const G = lerp(0.3, 3.2, p.chop);
  if (street) {
    const m = Math.max(1, Math.round(lerp(2, 9, p.count)));
    const s0 = R(), gap = lerp(0.04, 0.16, p.spread);
    for (let i = 0; i < m; i++) {
      for (const [ds, sign, off] of [[-gap / 2, 1, 0], [gap / 2, -1, 0.5]]) {
        const [u, v] = fromST(B, s0 + ds, (i + off) / m);
        vort.push({ x: fract(u), y: fract(v), g: sign * G * (0.85 + 0.3 * R()) });
      }
    }
  } else {
    const m = Math.round(lerp(3, 24, p.count));
    for (let i = 0; i < m; i++) vort.push({ x: R(), y: R(), g: (R() < 0.5 ? -1 : 1) * G * (0.4 + R()) });
  }
  const core = lerp(0.006, 0.07, p.decay);
  return { L, vort, core2: core * core };
}

function buildSumi(p, S) {
  const R = rng(S + 91);
  const swirls = [];
  const n = Math.round(p.turbulence * 7);
  for (let i = 0; i < n; i++) swirls.push({ x: R(), y: R(), r: lerp(0.06, 0.22, R()), a: (R() < 0.5 ? -1 : 1) * lerp(1, 4, R()) });
  return { swirls, B: basis(p.angle), N: Math.max(1, Math.round(lerp(1, 7, p.count))) };
}

const BUILDERS = {
  ocean: buildWaves,
  rain: buildRain,
  interference: buildInterference,
  ripples: buildRipples,
  ladder: buildRipples,
  swash: buildSwash,
  braided: buildBraided,
  meander: buildMeander,
  frost: buildFrost,
  vortexStreet: (p, S) => buildVortex(p, S, true),
  eddies: (p, S) => buildVortex(p, S, false),
  suminagashi: buildSumi,
  surf: buildSurf,
};

let _ctxKey = null, _ctx = null;
function context(p, S) {
  const b = BUILDERS[p.pattern];
  if (!b) return null;
  const key = JSON.stringify(p);
  if (_ctxKey !== key) { _ctx = b(p, S); _ctxKey = key; }
  return _ctx;
}

// ── Per-pixel height functions ───────────────────────────────────────────────

function hWaves(c, p, u, v) {
  const ws = c.waves, nw = ws.length;
  const chop = 0.95 * p.chop;
  // Invert the Gerstner map (two fixed-point steps): sample the sea at the
  // undisplaced position whose crest lands here.
  let x = u, y = v;
  for (let it = 0; it < 2; it++) {
    let dx = 0, dy = 0;
    for (let i = 0; i < nw; i++) {
      const w = ws[i];
      const s = Math.sin(TAU * (w.kx * x + w.ky * y) + w.ph);
      dx += w.dx * s; dy += w.dy * s;
    }
    x = u + chop * dx; y = v + chop * dy;
  }
  let h = 0;
  for (let i = 0; i < nw; i++) {
    const w = ws[i];
    h += w.amp * Math.cos(TAU * (w.kx * x + w.ky * y) + w.ph);
  }
  h *= c.hNorm;
  if (p.detail > 0) {
    let cap = 0;
    for (const w of c.cap) cap += Math.cos(TAU * (w.kx * u + w.ky * v) + w.ph);
    const patch = lerp(1, sstep(-0.15, 0.45, fbm(u, v, 3, 3, 0.5, c.S || 7)), p.variation);
    h += p.detail * 0.3 * patch * cap * c.capNorm;
  }
  return h;
}

function hRain(c, p, u, v, S) {
  const G = c.G, cell = 1 / G;
  const lam = cell * lerp(0.24, 0.055, p.rings);
  const gx = Math.floor(u * G), gy = Math.floor(v * G);
  const wob = p.turbulence > 0 ? p.turbulence * 0.25 * lam * noise(u, v, G * 3, S + 5) : 0;
  let h = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const cx = gx + i, cy = gy + j;
      const wx = mod(cx, G), wy = mod(cy, G);
      for (let d = 0; d < 2; d++) {
        if (hashf(wx, wy, S + 17 + d * 101) > (d === 0 ? lerp(0.35, 1, p.count) : lerp(0, 0.7, p.count) - 0.05)) continue;
        const hx = hashf(wx, wy, S + 23 + d * 7), hy = hashf(wx, wy, S + 29 + d * 7), hr = hashf(wx, wy, S + 31 + d * 7);
        const px = (cx + hx) * cell, py = (cy + hy) * cell;
        const r = Math.hypot(u - px, v - py) + wob;
        const Rr = cell * clamp01(0.7 + p.variation * 1.1 * (hr - 0.5)) * 1.25 + cell * 0.08;
        const s = r - Rr;
        if (s > 0.7 * lam) continue;
        const trail = Rr * lerp(0.15, 1.1, p.decay);
        let env = s > 0 ? (1 - s / (0.7 * lam)) ** 2 : Math.exp(s / trail);
        env *= sstep(0, lam * 1.2, r);
        h += env * Math.cos(TAU * s / lam) / Math.sqrt(Rr / cell + 0.2);
      }
    }
  }
  return h;
}

function hInterference(c, p, u, v) {
  let h = 0;
  const Rc = c.Rc, Rc2 = Rc * Rc;
  for (const s of c.src) {
    for (let oy = -1; oy <= 1; oy++) {
      const dy = v - s.y - oy;
      if (dy * dy >= Rc2) continue;
      for (let ox = -1; ox <= 1; ox++) {
        const dx = u - s.x - ox;
        const r2 = dx * dx + dy * dy;
        if (r2 >= Rc2) continue;
        const r = Math.sqrt(r2), q = 1 - r2 / Rc2;
        h += s.a * q * q * Math.cos(TAU * c.k * r + s.ph) / (1 + 3 * r);
      }
    }
  }
  return h;
}

function crestProfile(x, p) {
  // x = fract(phase): asymmetric triangle (gentle stoss, steep lee), pinched crest.
  const cpos = lerp(0.5, 0.88, Math.abs(p.asymmetry - 0.5) * 2) ;
  const cc = p.asymmetry >= 0.5 ? cpos : 1 - cpos;
  const tri = x < cc ? x / cc : (1 - x) / (1 - cc);
  return Math.pow(tri, 1 + 2.4 * p.chop);
}

function hRipples(c, p, u, v, S, ladder) {
  const L = c.L;
  const s0 = L.n * (L.a * u + L.b * v), t = L.c * u + L.d * v;
  let ph = TAU * s0;
  if (p.turbulence > 0) ph += p.turbulence * TAU * 1.1 * fbm(u, v, 2, 3, 0.5, S + 3);
  for (const d of c.defects) ph += d.s * vortexAngle(u, v, d.x, d.y);
  if (p.rings > 0 && c.lobeN && p.complexity > 0) {   // linguoid tongues, staggered per ripple
    ph += p.complexity * TAU * 0.35 * (0.5 - Math.abs(Math.sin(Math.PI * c.lobeN * t + 0.5 * TAU * s0)));
  }
  const x = fract(ph / TAU);
  let h = crestProfile(x, p);
  if (ladder && p.detail > 0) {
    const tr = (1 - h) * (1 - h);
    h += p.detail * 0.45 * tr * (0.5 + 0.5 * Math.cos(TAU * c.ladderN * t + 2 * noise(u, v, 3, S + 9)));
  }
  if (p.variation > 0) h *= 1 - p.variation * 0.55 * (0.5 + 0.5 * noise(u, v, 3, S + 13));
  return h;
}

function hSwash(c, p, u, v, S) {
  const L = c.L;
  const s = toS(L, u, v), t = toT(L, u, v);
  let h = 0;
  for (const ln of c.lines) {
    const cusp = Math.pow(Math.abs(Math.sin(Math.PI * ln.m * t + ln.ph)), 0.7);
    const o = ln.A * cusp + 0.012 * (0.3 + p.turbulence) * noise1(t, ln.row, 6, S + 5);
    const d = wrapd(s - ln.s - o);
    // steep landward face, long seaward tail
    const r = d > 0 ? Math.exp(-((d / c.w) ** 2) * 3) : Math.exp(d / (c.w * lerp(1.5, 5, p.asymmetry)));
    h += r * ln.str;
  }
  if (p.detail > 0) h += p.detail * 0.35 * ridged(u, v, Math.max(2, p.scale * 3), 3, 0.5, S + 7);
  return h;
}

function hBraided(c, p, u, v, S) {
  const L = c.L;
  let s = toS(L, u, v);
  const t = toT(L, u, v);
  if (p.turbulence > 0) s += p.turbulence * 0.03 * fbm(u, v, 4, 3, 0.5, S + 3);
  let wet = 0;
  for (const ch of c.ch) {
    const cen = ch.s + ch.A * Math.sin(TAU * ch.m * t + ch.ph) + ch.A * 0.35 * Math.sin(TAU * ch.m2 * t + ch.ph2);
    const w = ch.w * (0.65 + 0.35 * Math.sin(TAU * ch.m2 * t + ch.ph3));
    const d = Math.abs(wrapd(s - cen));
    if (d < w) { const q = sstep(w, w * 0.45, d); wet = Math.max(wet, q * ch.d); }
  }
  let h = 1 - wet;
  // bar tops: lens-shaped gravel bars with longitudinal streaks
  h += 0.12 * fbm(u, v, 3, 3, 0.5, S + 9);
  if (p.detail > 0) h += p.detail * 0.07 * noise2(fract(s), fract(t), 40, 3, S + 11) * (1 - wet);
  return h;
}

function hMeander(c, p, u, v, S) {
  const g = c.grid, segs = g.segs, G = g.G;
  const b = mod(Math.floor(v * G), G) * G + mod(Math.floor(u * G), G);
  let best = 1e9, bestSide = 0, bestCurv = 0, bestH = 1, bestW = c.w;
  for (let k = g.start[b], e = g.start[b + 1]; k < e; k++) {
    const i = g.items[k];
    segDist(segs, i, u, v);
    if (Q.d < best) { best = Q.d; bestSide = Q.side; bestCurv = segs[i * ST + 7]; bestH = segs[i * ST + 6]; bestW = segs[i * ST + 4]; }
  }
  let h = 0.08 * fbm(u, v, 3, 3, 0.5, S + 5);
  if (p.detail > 0) h += p.detail * 0.12 * fbm(u, v, 12, 3, 0.55, S + 7);
  if (best < bestW) {
    h -= bestH * (1 - (best / bestW) ** 2);
  } else {
    const dd = best - bestW;
    if (dd < c.band) {
      const inner = bestCurv === 0 ? 0.6 : (Math.sign(bestSide) === Math.sign(bestCurv) ? 1 : 0.3);
      const fade = 1 - dd / c.band;
      h += inner * fade * 0.45 * (0.5 + 0.5 * Math.cos(TAU * dd / c.lam)) * bestH;
      h += 0.06 * fade;   // natural levee
    }
  }
  return h;
}

function hFrost(c, p, u, v, S) {
  const g = c.grid, segs = g.segs, G = g.G;
  const b = mod(Math.floor(v * G), G) * G + mod(Math.floor(u * G), G);
  let h = 0;
  for (let k = g.start[b], e = g.start[b + 1]; k < e; k++) {
    const i = g.items[k], o = i * ST;
    segDist(segs, i, u, v);
    const w = segs[o + 4] + (segs[o + 5] - segs[o + 4]) * Q.t;
    if (Q.d < w) {
      const q = Q.d / w;
      const r = segs[o + 6] * Math.sqrt(1 - q * q) * (1 - 0.25 * segs[o + 7] / 3);
      if (r > h) h = r;
    }
  }
  if (p.detail > 0) h += p.detail * 0.18 * (0.5 + 0.5 * ridged(u, v, 24, 2, 0.5, S + 9));
  return h;
}

function hVortex(c, p, u, v, S) {
  const L = c.L;
  let ph = L.n * (L.a * u + L.b * v);
  if (p.turbulence > 0) ph += p.turbulence * 0.6 * fbm(u, v, 3, 3, 0.5, S + 3);
  const kv = 0.035 * L.n;
  for (const w of c.vort) ph += w.g * kv * plog(u, v, w.x, w.y, c.core2);
  const x = 0.5 + 0.5 * Math.cos(TAU * ph);
  return Math.pow(x, lerp(1, 14, 1 - p.width));
}

function hSumi(c, p, u, v, S) {
  let x = u, y = v;
  // tine combing: shear along the lattice direction (chevrons / nonpareil)
  if (p.chop > 0) {
    const B = c.B;
    const s = toS(B, x, y);
    let t = toT(B, x, y);
    t += p.chop * 0.06 * Math.sin(TAU * Math.max(1, Math.round(p.scale)) * s);
    [x, y] = fromST(B, s, t);
  }
  for (const w of c.swirls) {
    const dx = wrapd(x - w.x), dy = wrapd(y - w.y);
    const r = Math.hypot(dx, dy);
    const a = w.a * Math.exp(-((r / w.r) ** 2)) * (1 - sstep(0.3, 0.48, r));
    const ca = Math.cos(a), sa = Math.sin(a);
    x = w.x + dx * ca - dy * sa; y = w.y + dx * sa + dy * ca;
  }
  worley(fract(x), fract(y), c.N, c.N, 1, S + 7, 0, 1, p.variation * 0.35);
  const rings = lerp(3, 16, p.rings);
  const q = 0.5 + 0.5 * Math.cos(TAU * W.f1 * rings);
  return Math.pow(q, lerp(1, 10, 1 - p.width));
}

function hCaustics(p, u, v, S) {
  const N = Math.max(1, Math.round(p.scale));
  const layer = (n, seed, k) => {
    const wu = u + p.turbulence * 0.12 / Math.sqrt(n) * fbm(u, v, Math.max(1, Math.round(n * 0.7)), 3, 0.5, seed + 1);
    const wv = v + p.turbulence * 0.12 / Math.sqrt(n) * fbm(u, v, Math.max(1, Math.round(n * 0.7)), 3, 0.5, seed + 2);
    worley(fract(wu), fract(wv), n, n, 1, seed, 0, 1, 0.15);
    return Math.exp(-W.edge / lerp(0.006, 0.08, p.width)) * k;
  };
  const a = layer(N, S + 11, 1);
  const b = p.detail > 0 ? layer(Math.max(2, Math.round(N * 1.7)), S + 19, p.detail * 0.8) : 0;
  return Math.max(a, b) + 0.25 * Math.min(a, b);
}

function hCrackedIce(p, u, v, S) {
  const N = Math.max(1, Math.round(p.scale));
  const wu = u + p.turbulence * 0.25 / N * fbm(u, v, Math.max(2, N), 3, 0.5, S + 1);
  const wv = v + p.turbulence * 0.25 / N * fbm(u, v, Math.max(2, N), 3, 0.5, S + 2);
  worley(fract(wu), fract(wv), N, N, 1, S + 7, 0, 1, 0.25);
  const id = W.id1, ex = W.edge;
  const gx = hashf(id, 3, S) - 0.5, gy = hashf(id, 5, S) - 0.5;
  let h = p.variation * 0.6 * (W.dx * gx + W.dy * gy) + 0.15 * hashf(id, 9, S);
  const cw = lerp(0.015, 0.09, p.width);
  if (ex < cw) h -= 0.8 * (1 - ex / cw);
  if (p.detail > 0) {
    const n2 = Math.round(N * 2.8);
    worley(fract(wu * 1 + 0.37), fract(wv + 0.11), n2, n2, 1, S + 13, 0, 1, 0.2);
    const m = sstep(-0.05, 0.25, noise(u, v, Math.max(2, N), S + 15));
    const hw = cw * 0.45;
    if (W.edge < hw) h -= p.detail * 0.35 * m * (1 - W.edge / hw);
  }
  h += 0.04 * fbm(u, v, 16, 3, 0.5, S + 17);
  return h;
}

function hPancake(p, u, v, S) {
  const N = Math.max(1, Math.round(p.scale));
  worley(u, v, N, N, 0.9, S + 7, 0, 1, p.variation * 0.3);
  const w = WC.w[W.best];
  const r = Math.sqrt(Math.max(0.03, 0.14 + w));
  const dIn = Math.min(r - W.f1, W.edge - 0.03);
  const base = sstep(-0.025, 0.02, dIn);
  const rw = lerp(0.02, 0.08, p.width);
  const rim = Math.exp(-(((dIn - rw * 0.9) / (rw * 0.7)) ** 2)) * (dIn > -0.01 ? 1 : 0);
  let h = 0.55 * base + 0.35 * rim * base + 0.08 * hashf(W.id1, 4, S) * base;
  h += (1 - base) * p.detail * 0.25 * (0.5 + 0.5 * noise(u, v, N * 8, S + 9));
  return h;
}

function hFoam(p, u, v, S, raft) {
  const N = Math.max(1, Math.round(p.scale));
  worley(u, v, N, N, 1, S + 7, 0, 1, p.variation * 0.45);
  const ww = lerp(0.015, 0.1, p.width);
  let h;
  if (raft) {
    const w = WC.w[W.best];
    const r = Math.sqrt(Math.max(0.05, 0.3 + w));
    const dome = Math.sqrt(Math.max(0, 1 - (W.f1 / r) ** 2));
    h = Math.min(dome, sstep(0, ww * 2.5, W.edge)) * (0.7 + 0.3 * Math.sqrt(r));
  } else {
    h = Math.exp(-((W.edge / ww) ** 2)) - 0.15 * W.f1;
  }
  if (p.detail > 0) {
    const id = W.id1;
    if (hashf(id, 2, S) < p.detail) {
      const n2 = Math.round(N * 3);
      worley(u, v, n2, n2, 1, S + 19, 0, 1, 0.2);
      h += raft ? -0.25 * (1 - sstep(0, ww * 1.4, W.edge)) : 0.55 * Math.exp(-((W.edge / (ww * 0.8)) ** 2));
    }
  }
  return h;
}

function hBeads(p, u, v, S) {
  const N = Math.max(1, Math.round(p.scale));
  const bead = (n, seed, big) => {
    worley(u, v, n, n, 1, seed, 0, 1, 0);
    const id = W.id1;
    if (hashf(id, 1, seed) > lerp(0.25, 1, p.count) * (big ? 1 : 0.9)) return 0;
    const hr = hashf(id, 2, seed);
    const r = lerp(0.14, 0.62, Math.pow(hr, lerp(1.8, 0.5, p.variation))) * (big ? 1 : 0.6);
    const q = W.f1 / r;
    if (q >= 1) return 0;
    // sessile drop: flattened cap, height ∝ r^0.7
    return Math.pow(r, 0.7) * Math.pow(1 - q * q, 0.42);
  };
  let h = bead(N, S + 7, true);
  if (p.detail > 0) h = Math.max(h, p.detail * bead(Math.round(N * 2.6), S + 13, false));
  return h;
}

function hCrevasse(p, u, v, S) {
  const L = lineLattice(p.angle, Math.max(1, p.scale));
  let s = L.n * (L.a * u + L.b * v);
  const t = L.c * u + L.d * v;
  if (p.turbulence > 0) s += p.turbulence * 1.2 * fbm(u, v, 2, 3, 0.5, S + 3);
  const nTot = L.n;
  const i = mod(Math.floor(s), nTot);
  const fs = fract(s) - 0.5;
  const op = sstep(lerp(0.35, -0.3, p.count), 0.45, noise1(t, i * 0.37 + 0.11, Math.max(2, Math.round(p.scale * 0.8)), S + 5));
  const hw = lerp(0.04, 0.22, p.width) * op;
  const d = Math.abs(fs);
  let h = 0.15 * fbm(u, v, 3, 3, 0.5, S + 7);
  if (d < hw) h -= 0.9 * (1 - d / hw) * op;
  else h += 0.08 * Math.exp(-(((d - hw) / 0.04) ** 2)) * op;   // lip
  if (p.detail > 0) h += p.detail * 0.1 * noise2(fract(L.c * u + L.d * v), fract(s / Math.max(1, nTot)), 48, 8, S + 9);
  return h;
}

// ── Surf beach: shoaling wave sets ───────────────────────────────────────────
// Sea on the left (u = 0), shore at u = shore, beach beyond. Local wave
// frequency grows as R^(x^q) toward the shore — q = 1 is a pure geometric
// progression (every gap the same fraction of the previous one, like a
// Fibonacci/golden-ratio ladder), q < 1 tightens early, q > 1 only near shore.
// The cumulative phase is tabulated and scaled so exactly N crests fit.

function buildSurf(p, S) {
  const Rr = lerp(1, 12, p.shoal);
  const q = Math.pow(2, lerp(-1.6, 1.6, p.bunch));
  const T = 2048;
  const phi = new Float64Array(T + 1);
  let acc = 0;
  for (let i = 1; i <= T; i++) {
    const x = (i - 0.5) / T;
    acc += Math.pow(Rr, Math.pow(x, q)) / T;
    phi[i] = acc;
  }
  for (let i = 0; i <= T; i++) phi[i] /= acc;
  const R2 = rng(S + 101);
  const swash = [];
  for (let i = 0; i < 3; i++) swash.push({ o: 0.012 + 0.035 * i + 0.01 * R2(), m: 2 + Math.floor(R2() * 4), ph: R2() * Math.PI, row: R2() * 50 });
  return { phi, T, N: Math.max(1, Math.round(p.scale)), shoreX: lerp(0.55, 1, p.shore), swash };
}

function hSurf(c, p, u, v, S) {
  const shoreX = c.shoreX;
  if (u >= shoreX && shoreX < 1) {
    // Beach: wet sand rising gently, a few cuspate swash lines near the waterline.
    const xb = (u - shoreX) / Math.max(1e-6, 1 - shoreX);
    let h = 0.18 + 0.12 * xb + 0.03 * fbm(u, v, 8, 3, 0.5, S + 41);
    for (const sw of c.swash) {
      const line = shoreX + sw.o * (1 - shoreX) * 3 + 0.01 * Math.abs(Math.sin(Math.PI * sw.m * v + sw.ph)) + 0.004 * noise1(v, sw.row, 8, S + 43);
      const d = u - line;
      h += 0.12 * (d > 0 ? Math.exp(-((d / 0.004) ** 2)) : Math.exp(d / 0.012));
    }
    return h;
  }
  const xs = u / shoreX;
  const fi = xs * c.T, i0 = Math.min(c.T - 1, Math.floor(fi));
  let ph = c.N * lerp(c.phi[i0], c.phi[i0 + 1], fi - i0);
  // Crests wobble offshore and straighten as they refract onto the beach.
  if (p.turbulence > 0) ph += p.turbulence * 0.9 * (1 - 0.75 * xs) * fbm(u, v, 3, 3, 0.5, S + 3);
  const k = Math.floor(ph);
  const x = ph - k;   // 0 just past a crest … 1 at the next crest (waves travel toward +u)
  // Breaking-wave section: long gentle back, steep face toward shore.
  const back = 1 - x;                       // distance behind the crest
  const w = lerp(0.04, 0.35, p.width);
  const face = Math.exp(-((x / (w * 0.35)) ** 2));          // steep shoreward face
  const rear = Math.exp(-back / w) ;                          // long rear slope
  let crest = Math.max(face, rear);
  // Gaps in the sets: each crest line breaks up along its length.
  if (p.variation > 0) {
    const g = noise1(v, k * 0.731 + 0.1, 3 + (k % 3), S + 7);
    const thr = lerp(-0.9, 0.35, p.variation);
    crest *= sstep(thr - 0.12, thr + 0.12, g);
  }
  // Waves steepen and grow as they shoal.
  let h = 0.2 + crest * lerp(0.55, 1, xs);
  // Whitewater behind breakers in the last stretch before shore.
  if (p.detail > 0) {
    const surfZone = sstep(0.55, 0.95, xs);
    h += p.detail * 0.3 * surfZone * Math.exp(-back * 3) * (0.5 + 0.5 * ridged(u, v, 40, 2, 0.5, S + 9));
  }
  return h;
}

// ── Public entry points ──────────────────────────────────────────────────────

export function generateWaterHeights(params, size) {
  return waterFinish(params, size, waterRows(params, size, 0, size).struct);
}

/** Per-pixel stage for rows [y0, y1). */
export function waterRows(params, size, y0, y1) {
  const p = { ...DEFAULT_WATER_PARAMS, ...params };
  const S = (p.seed | 0) * 7919;
  const ctx = context(p, S);
  if (ctx && p.pattern === 'ocean') ctx.S = S + 3;
  const out = new Float32Array(size * (y1 - y0));
  const inv = 1 / size;
  const pat = p.pattern;
  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) * inv;
    const row = (y - y0) * size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) * inv;
      let h;
      switch (pat) {
        case 'ocean':        h = hWaves(ctx, p, u, v); break;
        case 'rain':         h = hRain(ctx, p, u, v, S); break;
        case 'interference': h = hInterference(ctx, p, u, v); break;
        case 'ripples':      h = hRipples(ctx, p, u, v, S, false); break;
        case 'ladder':       h = hRipples(ctx, p, u, v, S, true); break;
        case 'swash':        h = hSwash(ctx, p, u, v, S); break;
        case 'braided':      h = hBraided(ctx, p, u, v, S); break;
        case 'meander':      h = hMeander(ctx, p, u, v, S); break;
        case 'frost':        h = hFrost(ctx, p, u, v, S); break;
        case 'vortexStreet':
        case 'eddies':       h = hVortex(ctx, p, u, v, S); break;
        case 'suminagashi':  h = hSumi(ctx, p, u, v, S); break;
        case 'caustics':     h = hCaustics(p, u, v, S); break;
        case 'crackedIce':   h = hCrackedIce(p, u, v, S); break;
        case 'pancake':      h = hPancake(p, u, v, S); break;
        case 'foam':         h = hFoam(p, u, v, S, false); break;
        case 'raft':         h = hFoam(p, u, v, S, true); break;
        case 'beads':        h = hBeads(p, u, v, S); break;
        case 'crevasse':     h = hCrevasse(p, u, v, S); break;
        case 'surf':         h = hSurf(ctx, p, u, v, S); break;
        default:             h = 0;
      }
      out[row + x] = h;
    }
  }
  return { struct: out, grit: null };
}

/** Whole-image stage: optional rounding blur, then normalise. */
export function waterFinish(params, size, struct) {
  const p = { ...DEFAULT_WATER_PARAMS, ...params };
  if (p.softness > 0) blurWrap(struct, size, p.softness * size * 0.006);
  normalise(struct, 0.0008);
  // Crisp crests: push the swell's broad slopes down so each crest reads as a
  // distinct ridge on the print instead of a soft blur.
  if (p.crest > 0) {
    const e = 1 + 5 * p.crest;
    for (let i = 0; i < struct.length; i++) struct[i] = Math.pow(struct[i], e);
    normalise(struct, 0.0005);
  }
  return struct;
}

