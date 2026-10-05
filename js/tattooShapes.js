/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Tattoo-style motif engine ────────────────────────────────────────────────
//
// Western "tribal" and cyber-sigilism surfaces are *designed* shapes rather
// than noise, so they're built from signed-distance primitives:
//
//   ARC   tapered spiral-arc blade (thick base → razor point, optional curl)
//   SEG   tapered straight needle / spike
//   RING  thin circle
//   DISC  filled circle
//
// Each cell of a (brick-offset, tile-periodic) grid gets a motif — a short
// list of primitives generated from a recipe and the seed. Motifs can be
// mirrored (x → |x|) or 180°-rotationally symmetric, and are evaluated over
// the 3×3 neighbouring cells so shapes flow across cell borders.
//
// Render modes:
//   solid    bold bevelled shapes; later shapes cut a thin gap into earlier
//            ones (the classic interlocking-overlap look of tribal flash)
//   line     fine rounded linework (cyber sigilism)
//   outline  only the contour of solid shapes, optionally doubled
//   chrome   smooth union of everything, domed like liquid metal

import { TAU, hashf, mod, clamp01, sstep, lerp } from './proceduralCore.js';

const ARC = 1, SEG = 2, RING = 3, DISC = 4;
// Primitive record layout (STRIDE floats):
//  ARC : type, cx, cy, R0, a0, span, curl, w0, taper, bcx, bcy, brad, p0x, p0y, p1x, p1y
//  SEG : type, ax, ay, bx, by, w0, w1, taper, -, bcx, bcy, brad
//  RING: type, cx, cy, R, w, -, -, -, -, bcx, bcy, brad
//  DISC: type, cx, cy, R, -, -, -, -, -, bcx, bcy, brad
const STRIDE = 16;
// Taper modes: 0 base → point, 1 pointed at both ends, 2 constant width,
// 3 tribal swoosh (sharp lead-in, fattest ~20 % along, long taper to a razor tip)

function taperW(w0, t, mode) {
  if (mode === 0) return w0 * Math.pow(Math.max(0, 1 - t), 0.75);
  if (mode === 1) return w0 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.6);
  if (mode === 3) return w0 * (t < 0.2 ? Math.sqrt(t / 0.2) : Math.pow(Math.max(0, 1 - (t - 0.2) / 0.8), 0.8));
  return w0;
}

class MotifBuilder {
  constructor() { this.a = []; }
  arc(cx, cy, R0, a0, span, curl, w0, taper = 0) {
    const R1 = R0 + curl * Math.abs(span), a1 = a0 + span;
    const brad = Math.max(R0, R1) + w0 + 1e-3;
    this.a.push(ARC, cx, cy, R0, a0, span, curl, w0, taper, cx, cy, brad,
      cx + R0 * Math.cos(a0), cy + R0 * Math.sin(a0), cx + R1 * Math.cos(a1), cy + R1 * Math.sin(a1));
    return this;
  }
  seg(ax, ay, bx, by, w0, w1 = 0, taper = 0) {
    const brad = Math.hypot(bx - ax, by - ay) / 2 + Math.max(w0, w1) + 1e-3;
    this.a.push(SEG, ax, ay, bx, by, w0, w1, taper, 0, (ax + bx) / 2, (ay + by) / 2, brad, 0, 0, 0, 0);
    return this;
  }
  ring(cx, cy, R, w) {
    this.a.push(RING, cx, cy, R, w, 0, 0, 0, 0, cx, cy, R + w + 1e-3, 0, 0, 0, 0);
    return this;
  }
  disc(cx, cy, R) {
    this.a.push(DISC, cx, cy, R, 0, 0, 0, 0, 0, cx, cy, R + 1e-3, 0, 0, 0, 0);
    return this;
  }
  /** Point on an arc primitive (index i) at fraction t — for attaching thorns. */
  arcPoint(i, t) {
    const o = i * STRIDE, a = this.a;
    const ang = a[o + 4] + a[o + 5] * t;
    const R = a[o + 3] + a[o + 6] * Math.abs(a[o + 5]) * t;
    return [a[o + 1] + R * Math.cos(ang), a[o + 2] + R * Math.sin(ang), ang];
  }
  get count() { return this.a.length / STRIDE; }
  build(flags) { return { prims: Float64Array.from(this.a), n: this.a.length / STRIDE, ...flags }; }
}

// Scratch output of evalPrim(): signed "inside" distance and local stroke width.
let P_IN = 0, P_W = 0;

function evalPrim(pr, o, x, y) {
  const type = pr[o];
  if (type === ARC) {
    const cx = pr[o + 1], cy = pr[o + 2], R0 = pr[o + 3], a0 = pr[o + 4], span = pr[o + 5];
    const curl = pr[o + 6], w0 = pr[o + 7], taper = pr[o + 8];
    const dx = x - cx, dy = y - cy;
    const r = Math.hypot(dx, dy);
    const dir = span >= 0 ? 1 : -1, sp = Math.abs(span);
    let phi = (Math.atan2(dy, dx) - a0) * dir;
    phi -= TAU * Math.floor(phi / TAU);
    let d, t;
    if (phi <= sp) {
      t = phi / sp;
      d = Math.abs(r - (R0 + curl * phi));
    } else {
      const d0 = Math.hypot(x - pr[o + 12], y - pr[o + 13]);
      const d1 = Math.hypot(x - pr[o + 14], y - pr[o + 15]);
      if (d0 < d1) { d = d0; t = 0; } else { d = d1; t = 1; }
    }
    P_W = taperW(w0, t, taper);
    P_IN = P_W - d;
    return;
  }
  if (type === SEG) {
    const ax = pr[o + 1], ay = pr[o + 2], vx = pr[o + 3] - ax, vy = pr[o + 4] - ay;
    const t = clamp01(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy + 1e-12));
    const d = Math.hypot(x - ax - vx * t, y - ay - vy * t);
    const taper = pr[o + 7];
    P_W = taper === 1 ? taperW(pr[o + 5], t, 1) : lerp(pr[o + 5], pr[o + 6], t);
    P_IN = P_W - d;
    return;
  }
  if (type === RING) {
    P_W = pr[o + 4];
    P_IN = P_W - Math.abs(Math.hypot(x - pr[o + 1], y - pr[o + 2]) - pr[o + 3]);
    return;
  }
  P_W = pr[o + 3];   // DISC
  P_IN = P_W - Math.hypot(x - pr[o + 1], y - pr[o + 2]);
}

// ── Recipes ──────────────────────────────────────────────────────────────────
// r(k) → deterministic 0..1 for this motif. W = blade weight, LW = line weight.

const RECIPES = {
  // Western tribal: mirrored flame blades rising from a central spike.
  flames(r, p) {
    const W = 0.035 + p.width * 0.09;
    const m = new MotifBuilder();
    const nb = 3 + Math.floor(r(1) * 3);
    m.seg(0, 0.5, 0, -0.85 - 0.2 * r(2), W * 1.1, 0, 0);
    for (let b = 0; b < nb; b++) {
      const k = 10 + b * 7;
      const cx = 0.12 + 0.38 * r(k), cy = -0.1 + 0.55 * r(k + 1);
      const R0 = 0.22 + 0.32 * r(k + 2);
      const a0 = Math.PI + (r(k + 3) - 0.5) * 0.6;
      const span = 0.9 + (1.0 + p.waviness) * r(k + 4);
      const curl = -(0.03 + 0.1 * p.waviness) * (0.5 + r(k + 5));
      m.arc(cx, cy, R0, a0, span, curl, W * (0.65 + 0.7 * r(k + 6)), b === 0 ? 0 : 3);
    }
    if (p.accent > 0.3) m.seg(0.05, 0.2, 0.35 + 0.2 * r(90), 0.55 + 0.2 * r(91), W * 0.8, 0, 0);   // downward barb
    return m.build({ mirror: true });
  },

  // Western tribal armband: interlocking hooks, 180° rotational symmetry.
  armband(r, p) {
    const W = 0.035 + p.width * 0.09;
    const m = new MotifBuilder();
    m.arc(0.22, 0.12, 0.34, Math.PI * (0.95 + 0.1 * r(1)), 2.1 + 0.8 * p.waviness, -0.06 - 0.06 * p.waviness, W * 1.3, 3);
    m.arc(-0.05, -0.18, 0.2 + 0.1 * r(2), Math.PI * 0.5, 1.6 + 0.8 * r(3), -0.04, W * 0.9, 3);
    m.seg(-0.55, 0.02, 0.15, 0.3 + 0.1 * r(4), W * 1.0, 0, 0);
    if (p.accent > 0.2) m.seg(0.1, -0.05, 0.45 + 0.2 * r(5), -0.42, W * 0.7, 0, 0);
    return m.build({ rot180: true });
  },

  // Western tribal swirl: one big curling swoosh with thorns branching off.
  swirl(r, p) {
    const W = 0.04 + p.width * 0.1;
    const m = new MotifBuilder();
    const a0 = r(1) * TAU, hand = r(2) < 0.5 ? 1 : -1;
    m.arc(0, 0, 0.62, a0, hand * (3.2 + 1.2 * p.waviness), -0.12, W * 1.5, 3);
    const thorns = 1 + Math.round(p.accent * 3);
    for (let k = 0; k < thorns; k++) {
      const [px, py, ang] = m.arcPoint(0, 0.18 + 0.2 * k);
      const out = ang + hand * (0.9 + 0.3 * r(10 + k));
      const len = 0.28 + 0.2 * r(20 + k);
      m.seg(px, py, px + Math.cos(out) * len, py + Math.sin(out) * len, W * 0.9, 0, 0);
    }
    m.arc(0.35 * Math.cos(a0 + Math.PI), 0.35 * Math.sin(a0 + Math.PI), 0.25, a0, -hand * 2.2, -0.05, W * 0.8, 3);
    return m.build({});
  },

  // Cyber sigilism: mirrored crest — needle spine, winged hairline arcs, sigil ring.
  crest(r, p) {
    const LW = 0.01 + p.width * 0.035;
    const m = new MotifBuilder();
    m.seg(0, -0.9, 0, 0.9, LW * 1.6, 0, 1);
    const wings = 2 + Math.floor(r(1) * 3);
    for (let b = 0; b < wings; b++) {
      const k = 10 + b * 7;
      const cy = -0.6 + 1.1 * r(k);
      const R0 = 0.25 + 0.45 * r(k + 1);
      const up = r(k + 2) < 0.5 ? 1 : -1;
      m.arc(R0, cy, R0, Math.PI, up * (0.8 + (0.9 + p.waviness) * r(k + 3)), -0.04 * r(k + 4), LW * (1.2 + r(k + 5)), 0);
    }
    const needles = 1 + Math.floor(r(3) * 3);
    for (let b = 0; b < needles; b++) {
      const y0 = -0.5 + r(40 + b), ang = -0.3 - 1.2 * r(50 + b), len = 0.4 + 0.5 * r(60 + b);
      m.seg(0.02, y0, 0.02 + Math.cos(ang) * len, y0 + Math.sin(ang) * len, LW * 1.4, 0, 0);
    }
    if (r(4) < 0.35 + p.accent * 0.6) m.ring(0, -0.2 + 0.5 * r(5), 0.07 + 0.08 * r(6), LW * 0.8);
    return m.build({ mirror: true });
  },

  // Cyber sigilism: long mirrored hooks studded with sharp thorns.
  thorns(r, p) {
    const LW = 0.012 + p.width * 0.04;
    const m = new MotifBuilder();
    const hooks = 2 + Math.floor(r(1) * 2);
    for (let h = 0; h < hooks; h++) {
      const k = 10 + h * 9;
      const idx = m.count;
      const cx = 0.15 + 0.4 * r(k), cy = -0.4 + 0.8 * r(k + 1);
      m.arc(cx, cy, 0.3 + 0.35 * r(k + 2), Math.PI + (r(k + 3) - 0.5), (r(k + 4) < 0.5 ? 1 : -1) * (1.8 + 1.4 * p.waviness),
            -0.06 - 0.06 * r(k + 5), LW * 1.8, 0);
      const nThorn = 2 + Math.round(p.accent * 4);
      for (let j = 0; j < nThorn; j++) {
        const [px, py, ang] = m.arcPoint(idx, 0.1 + 0.7 * (j + 0.5) / nThorn);
        const len = 0.06 + 0.1 * r(k + 20 + j);
        const out = ang + (j & 1 ? 0.35 : -0.35);
        m.seg(px, py, px + Math.cos(out) * len * 1.4, py + Math.sin(out) * len * 1.4, LW * 1.6, 0, 0);
      }
    }
    return m.build({ mirror: true });
  },

  // Cyber sigilism: occult-geometric glyph built from a small vocabulary.
  glyphs(r, p) {
    const LW = 0.012 + p.width * 0.035;
    const m = new MotifBuilder();
    m.seg(0, -0.75, 0, 0.75, LW, LW, 2);
    const parts = 3 + Math.floor(r(1) * 3 + p.accent * 2);
    for (let q = 0; q < parts; q++) {
      const k = 10 + q * 7, kind = Math.floor(r(k) * 6), y = -0.6 + 1.2 * r(k + 1);
      const s = 0.15 + 0.3 * r(k + 2);
      switch (kind) {
        case 0: m.seg(0, y, s, y, LW, LW, 2); break;                                            // crossbar
        case 1: m.ring(0, y, s * 0.6, LW * 0.8); break;                                         // circle
        case 2: m.arc(0, y, s, Math.PI * 0.5, Math.PI * 0.9, 0, LW * 1.3, 1); break;            // crescent
        case 3: m.seg(0, y, s, y + s, LW * 1.2, 0, 0); break;                                   // arrow barb
        case 4: m.seg(0, y - s, s * 0.6, y, LW, LW, 2).seg(s * 0.6, y, 0, y + s, LW, LW, 2); break; // diamond
        default: m.disc(s * 0.8, y, LW * 2.2); break;                                           // node
      }
    }
    return m.build({ mirror: true });
  },

  // Cyber sigilism: liquid-chrome blobs with sharp drips.
  drips(r, p) {
    const m = new MotifBuilder();
    const blobs = 2 + Math.floor(r(1) * 3);
    for (let b = 0; b < blobs; b++) {
      const k = 10 + b * 6;
      const x = 0.05 + 0.45 * r(k), y = -0.45 + 0.3 * r(k + 1), R = 0.1 + 0.14 * r(k + 2) * (0.6 + p.width);
      m.disc(x, y, R);
      const len = 0.35 + (0.4 + p.accent * 0.5) * r(k + 3);
      m.seg(x, y, x + (r(k + 4) - 0.5) * 0.15, y + len, R * 0.7, 0, 0);
    }
    return m.build({ mirror: true });
  },
};

// Aliases: outline style reuses the flame recipe.
RECIPES.outline = RECIPES.flames;

export const TATTOO_STYLES = {
  tribalFlames:   { recipe: 'flames',  mode: 'solid' },
  tribalArmband:  { recipe: 'armband', mode: 'solid' },
  tribalSwirl:    { recipe: 'swirl',   mode: 'solid' },
  sigilCrest:     { recipe: 'crest',   mode: 'line' },
  chromeThorns:   { recipe: 'thorns',  mode: 'line' },
  neoTribal:      { recipe: 'outline', mode: 'outline' },
  sigilGlyphs:    { recipe: 'glyphs',  mode: 'line' },
  chromeDrips:    { recipe: 'drips',   mode: 'chrome' },
};

// ── Context: motif table for one recipe / parameter set ──────────────────────

export function buildTattoo(style, p, N, seed) {
  const st = TATTOO_STYLES[style];
  const cols = N, rows = Math.max(2, N + (N & 1));   // even rows → brick offset tiles
  const nCells = cols * rows;
  const motifs = new Array(nCells);
  const prio = new Float64Array(nCells);
  // Per-cell placement: scatter offset, rotation, scale — the "variability" controls.
  const jx = new Float64Array(nCells), jy = new Float64Array(nCells);
  const cs = new Float64Array(nCells), sn = new Float64Array(nCells), sc = new Float64Array(nCells);
  const bound = new Float64Array(nCells);
  let reach = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const id = j * cols + i;
      // variation 0 → one motif repeated (a regular flash sheet); 1 → every cell unique
      const vid = hashf(id, 3, seed) < p.variation ? id + 1 : 0;
      const r = (k) => hashf(vid, k, seed);
      const m = RECIPES[st.recipe](r, p);
      // Per-cell mirror breaking for asymmetric looks.
      if (p.asymmetry > 0 && hashf(id, 5, seed) < p.asymmetry) m.mirror = false;
      let br = 0;
      for (let q = 0; q < m.n; q++) {
        const o = q * STRIDE;
        br = Math.max(br, Math.hypot(m.prims[o + 9], m.prims[o + 10]) + m.prims[o + 11]);
      }
      motifs[id] = m;
      prio[id] = hashf(id, 7, seed);
      jx[id] = p.scatter * 0.45 * (2 * hashf(id, 11, seed) - 1);
      jy[id] = p.scatter * 0.45 * (2 * hashf(id, 12, seed) - 1);
      const ang = p.rotation * Math.PI * (2 * hashf(id, 13, seed) - 1);
      cs[id] = Math.cos(ang); sn[id] = Math.sin(ang);
      sc[id] = Math.exp(p.scaleVar * 0.6 * (2 * hashf(id, 14, seed) - 1));
      bound[id] = br * sc[id];
      reach = Math.max(reach, Math.hypot(jx[id], jy[id]) + bound[id]);
    }
  }
  const gap = 0.012 + p.detail * 0.05;
  return {
    mode: st.mode, cols, rows, motifs, prio, jx, jy, cs, sn, sc, bound,
    K: reach + gap > 1.45 ? 2 : 1,   // 3×3 or 5×5 neighbourhood
    brick: st.recipe === 'armband' ? 0 : 0.5,
    gap,
    bevel: 0.006 + p.softness * 0.07,
    softness: p.softness,
    outlineW: 0.012 + p.width * 0.02,
    doubleLine: p.detail,
  };
}

// Scratch arrays for sorting the neighbouring cells by priority (up to 5×5).
const _ci = new Int32Array(25), _cx = new Float64Array(25), _cy = new Float64Array(25), _cp = new Float64Array(25);

/** Height (0..1-ish) of the tattoo surface at tile coords (u, v). */
export function tattooHeight(ctx, u, v) {
  const { cols, rows, motifs, prio, mode, K } = ctx;
  const fy = v * rows, cj = Math.floor(fy);
  let n = 0;
  for (let dj = -K; dj <= K; dj++) {
    const row = cj + dj;
    const shift = ctx.brick * (row & 1);
    const fx = u * cols - shift, ci = Math.floor(fx);
    for (let di = -K; di <= K; di++) {
      const col = ci + di;
      const id = mod(row, rows) * cols + mod(col, cols);
      const dx = fx - (col + 0.5) - ctx.jx[id], dy = fy - (row + 0.5) - ctx.jy[id];
      const reach = ctx.bound[id] + ctx.gap;
      if (dx * dx + dy * dy > reach * reach) continue;   // this motif can't touch the pixel
      // insertion sort by priority (low first → drawn first)
      const pr = prio[id];
      let k = n++;
      while (k > 0 && _cp[k - 1] > pr) { _ci[k] = _ci[k - 1]; _cx[k] = _cx[k - 1]; _cy[k] = _cy[k - 1]; _cp[k] = _cp[k - 1]; k--; }
      // into the motif's own frame: un-rotate, un-scale
      const c = ctx.cs[id], s = ctx.sn[id], inv = 1 / ctx.sc[id];
      _ci[k] = id; _cx[k] = (dx * c + dy * s) * inv; _cy[k] = (-dx * s + dy * c) * inv; _cp[k] = pr;
    }
  }

  let val = 0, field = -1e9;
  for (let c = 0; c < n; c++) {
    const id = _ci[c], m = motifs[id], pr = m.prims, scl = ctx.sc[id];
    const gapL = ctx.gap / scl;   // thresholds in the motif's scaled frame
    for (let pass = 0; pass < (m.rot180 ? 2 : 1); pass++) {
      let x = pass ? -_cx[c] : _cx[c], y = pass ? -_cy[c] : _cy[c];
      if (m.mirror) x = Math.abs(x);
      for (let q = 0; q < m.n; q++) {
        const o = q * STRIDE;
        const bx = x - pr[o + 9], by = y - pr[o + 10], br = pr[o + 11] + gapL;
        if (bx * bx + by * by > br * br) continue;
        evalPrim(pr, o, x, y);
        const ins = P_IN * scl;   // back to cell units
        switch (mode) {
          case 'solid':
            if (ins > -ctx.gap) val = ins > 0 ? sstep(0, ctx.bevel, ins) : 0;
            break;
          case 'line': {
            if (ins > 0) {
              const q2 = 1 - P_IN / Math.max(P_W, 1e-4);   // 0 at stroke centre → 1 at edge
              const h = ctx.softness < 0.5 ? 1 - sstep(0.7, 1, q2) : Math.sqrt(Math.max(0, 1 - q2 * q2));
              if (h > val) val = h;
            }
            break;
          }
          case 'outline': {
            const d = Math.abs(ins);
            let h = 1 - sstep(ctx.outlineW * 0.6, ctx.outlineW, d);
            if (ctx.doubleLine > 0) {   // second contour just inside
              const d2 = Math.abs(ins - ctx.outlineW * 3);
              h = Math.max(h, ctx.doubleLine * (1 - sstep(ctx.outlineW * 0.4, ctx.outlineW * 0.7, d2)) * (ins > 0 ? 1 : 0));
            }
            if (h > val) val = h;
            break;
          }
          default: {   // chrome: smooth union, domed
            const kk = 0.06;
            const hh = clamp01(0.5 + 0.5 * (ins - field) / kk);
            field = lerp(field, ins, hh) + kk * hh * (1 - hh);
          }
        }
      }
    }
  }
  if (mode === 'chrome') return field > 0 ? Math.sqrt(clamp01(field / (0.05 + ctx.softness * 0.15))) : 0;
  return val;
}
