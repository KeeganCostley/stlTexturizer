/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Organic stroke-growth engine (tribal / cyber-sigilism) ───────────────────
//
// Instead of stamping a motif per grid cell, strokes are *grown* across the
// tile (a torus, so the result tiles seamlessly):
//
//   1. Seed strokes at random positions, biased toward vertical for sigils.
//   2. Advance each stroke in small steps. Its heading is steered by a smooth
//      flow field, bent by its own curvature, and can hook inward toward the
//      tip. Every stroke draws its own variation of these from the chaos control.
//   3. While growing, strokes spawn branches (which can branch again) and
//      short forward-leaning thorns.
//   4. An occupancy grid stops a stroke just before it runs into an earlier
//      one, so compositions fill space the way hand-drawn flash does.
//   5. Width is assigned after growth from the stroke's final length (so
//      every stroke still ends in a razor tip), and strokes are mirrored
//      about the tile's vertical axis unless asymmetry releases them.
//
// The strokes become tapered segments, binned on a 64×64 grid for fast
// per-pixel evaluation in the same render modes as tattooShapes.js.

import { TAU, hashf, mod, clamp01, sstep, lerp, fbm } from './proceduralCore.js';

export const GROWTH_STYLES = {
  // Bold Western-tribal swooshes that interlock with thin overlap gaps.
  tribalGrowth: { mode: 'solid', main: 'swoosh', vertical: 0.35, wBase: 0.008, wScale: 0.03, ringChance: 0 },
  // Cyber sigilism: hairline needles, thorny, vertical, with sigil rings.
  sigilGrowth:  { mode: 'line',  main: 'needle', vertical: 0.85, wBase: 0.0025, wScale: 0.007, ringChance: 1 },
  // Barbed vines: even-weight flowing lines with regular sharp barbs.
  barbedGrowth: { mode: 'line',  main: 'even',   vertical: 0.0, wBase: 0.003, wScale: 0.008, ringChance: 0, regularThorns: true },
};

const DS = 0.004;          // growth step (tile units)
const OCC = 96;            // occupancy grid resolution
const BINS = 64;           // evaluation bins per axis

function widthProfile(kind, t) {
  switch (kind) {
    case 'swoosh': return t < 0.15 ? Math.sqrt(t / 0.15) : Math.pow(Math.max(0, 1 - (t - 0.15) / 0.85), 0.8);
    case 'needle': return Math.pow(Math.max(0, Math.sin(Math.PI * t)), 0.7);
    case 'root':   return Math.pow(Math.max(0, 1 - t), 0.8);          // branch: thick where it joins
    case 'thorn':  return Math.pow(Math.max(0, 1 - t), 1.3);          // sharp spike
    default:       return t > 0.92 ? (1 - t) / 0.08 : Math.min(1, 0.4 + t * 6);   // even with small tapers
  }
}

const angDiff = (a, b) => { let d = a - b; d -= TAU * Math.round(d / TAU); return d; };
const wrap = (x) => x - Math.floor(x);

/**
 * Grow the stroke set for a style and parameter set.
 * Params: density (strokes), width, length, curl, flow, branching, thorns,
 * spacing, accent (hook), detail (overlap gap / rings), variation (chaos),
 * asymmetry, seed.
 */
export function buildGrowth(style, p, seed) {
  const st = GROWTH_STYLES[style];
  const chaos = p.variation;
  const W = st.wBase + st.wScale * p.width;
  const spacing = 0.006 + p.spacing * 0.05;
  const baseLen = 0.08 + p.length * 0.7;
  const curlK = p.curl * 14;          // rad per tile unit
  const flowK = p.flow * 0.25;
  const R = (a, b) => hashf(a, b, seed);

  // Occupancy: points of finished strokes, bucketed on a torus grid.
  const occ = Array.from({ length: OCC * OCC }, () => []);
  const occAdd = (x, y, sid) => occ[mod(Math.floor(y * OCC), OCC) * OCC + mod(Math.floor(x * OCC), OCC)].push(x, y, sid);
  const blocked = (x, y, sid, parent) => {
    const cx = Math.floor(x * OCC), cy = Math.floor(y * OCC);
    const r2 = spacing * spacing, reach = Math.ceil(spacing * OCC);
    for (let j = -reach; j <= reach; j++) {
      for (let i = -reach; i <= reach; i++) {
        const b = occ[mod(cy + j, OCC) * OCC + mod(cx + i, OCC)];
        for (let k = 0; k < b.length; k += 3) {
          const id = b[k + 2];
          if (id === sid || id === parent) continue;
          let dx = x - b[k], dy = y - b[k + 1];
          dx -= Math.round(dx); dy -= Math.round(dy);
          if (dx * dx + dy * dy < r2) return true;
        }
      }
    }
    return false;
  };

  const strokes = [];   // { pts: number[], kind, wMul, group, parent }
  const queue = [];
  const nSeeds = Math.max(1, Math.round(p.density));
  for (let i = 0; i < nSeeds; i++) {
    const a0 = lerp(R(i, 1) * TAU, -Math.PI / 2 + (R(i, 2) - 0.5) * 1.4, st.vertical) + (R(i, 9) < 0.5 ? 0 : Math.PI * st.vertical * 0);
    queue.push({ x: R(i, 3), y: R(i, 4), a: a0, len: baseLen * (1 + chaos * (R(i, 5) - 0.5) * 1.4),
                 kind: st.main, wMul: 1 + chaos * (R(i, 6) - 0.5) * 0.8, depth: 0, parent: -1, group: i });
  }

  const flowAngle = (x, y) => TAU * fbm(x, y, 2, 3, 0.5, seed + 5);
  let guard = 0;
  while (queue.length && strokes.length < 600 && guard++ < 5000) {
    const q = queue.shift();
    const sid = strokes.length;
    const steps = Math.max(3, Math.round(q.len / DS));
    const kappa0 = curlK * (2 * R(sid, 11) - 1) * (0.5 + chaos * R(sid, 12));
    const hook = p.accent * (0.5 + R(sid, 13)) * (q.kind === 'thorn' ? 0 : 1);
    let x = q.x, y = q.y, a = q.a;
    const pts = [x, y];
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (flowK > 0 && q.kind !== 'thorn') a += flowK * angDiff(flowAngle(wrap(x), wrap(y)), a) * 0.25;
      const kappa = q.kind === 'thorn' ? kappa0 * 0.3 : kappa0 * (1 + hook * 8 * t * t);
      a += kappa * DS + chaos * 0.12 * (R(sid * 977 + s, 14) - 0.5);
      const nx = x + DS * Math.cos(a), ny = y + DS * Math.sin(a);
      if (s > 2 && blocked(wrap(nx), wrap(ny), sid, q.parent)) break;
      x = nx; y = ny;
      pts.push(x, y);

      if (q.kind === 'thorn' || q.depth >= 2) continue;
      // Branches: longer offshoots that can branch again.
      if (t > 0.1 && t < 0.8 && R(sid * 131 + s, 15) < p.branching * 0.035) {
        const side = R(sid * 131 + s, 16) < 0.5 ? 1 : -1;
        queue.push({ x, y, a: a + side * (0.45 + 0.6 * R(sid * 131 + s, 17)), len: q.len * (1 - t) * (0.5 + 0.4 * R(sid * 131 + s, 18)),
                     kind: q.kind === 'even' ? 'even' : 'root', wMul: q.wMul * 0.7, depth: q.depth + 1, parent: sid, group: q.group });
      }
      // Thorns: short sharp spikes leaning forward along the stroke.
      const thornHere = st.regularThorns
        ? (p.thorns > 0 && s % Math.max(4, Math.round(22 - p.thorns * 16)) === 0)
        : (t > 0.05 && t < 0.9 && R(sid * 173 + s, 19) < p.thorns * 0.05);
      if (thornHere) {
        const side = st.regularThorns ? (s / 2) % 2 < 1 ? 1 : -1 : (R(sid * 173 + s, 20) < 0.5 ? 1 : -1);
        const tl = (0.015 + 0.05 * R(sid * 173 + s, 21)) * (0.6 + p.width);
        queue.push({ x, y, a: a + side * (0.55 + 0.45 * R(sid * 173 + s, 22)), len: tl,
                     kind: 'thorn', wMul: q.wMul * widthProfile(q.kind, t) * 0.95 + 0.3, depth: 9, parent: sid, group: q.group });
      }
    }
    if (pts.length < 6) continue;
    strokes.push({ pts, kind: q.kind, wMul: q.wMul, group: q.group, parent: q.parent });
    for (let k = 0; k < pts.length; k += 2) occAdd(wrap(pts[k]), wrap(pts[k + 1]), sid);
    // Sigil rings at stroke starts.
    if (st.ringChance && q.depth === 0 && R(sid, 30) < p.detail) {
      const rr = 0.01 + 0.025 * R(sid, 31), cx = q.x, cy = q.y;
      const ring = [];
      for (let k = 0; k <= 24; k++) ring.push(cx + rr * Math.cos(k / 24 * TAU), cy + rr * Math.sin(k / 24 * TAU));
      strokes.push({ pts: ring, kind: 'ring', wMul: 0.6, group: q.group, parent: -1 });
    }
  }

  // ── Segments (+ mirror copies) ──
  const segs = [];   // x0,y0,x1,y1,w0,w1,group
  const groupsOut = new Map();
  const emit = (st2, mirror) => {
    const pts = st2.pts, n = pts.length / 2;
    const g = st2.group * 2 + (mirror ? 1 : 0);
    if (!groupsOut.has(g)) groupsOut.set(g, R(g, 40));
    for (let k = 0; k < n - 1; k++) {
      const t0 = k / (n - 1), t1 = (k + 1) / (n - 1);
      const w0 = st2.kind === 'ring' ? W * st2.wMul : W * st2.wMul * widthProfile(st2.kind, t0);
      const w1 = st2.kind === 'ring' ? W * st2.wMul : W * st2.wMul * widthProfile(st2.kind, t1);
      let x0 = pts[2 * k], x1 = pts[2 * k + 2];
      if (mirror) { x0 = -x0; x1 = -x1; }
      segs.push(x0, pts[2 * k + 1], x1, pts[2 * k + 3], w0, w1, g);
    }
  };
  for (const s2 of strokes) {
    emit(s2, false);
    if (R(s2.group, 50) >= p.asymmetry) emit(s2, true);
  }

  // Layer order: by group priority, then creation order inside a group.
  const nSeg = segs.length / 7;
  const order = Array.from({ length: nSeg }, (_, i) => i);
  order.sort((a, b) => (groupsOut.get(segs[a * 7 + 6]) - groupsOut.get(segs[b * 7 + 6])) || a - b);
  const S = new Float64Array(nSeg * 7);
  order.forEach((src, dst) => { for (let k = 0; k < 7; k++) S[dst * 7 + k] = segs[src * 7 + k]; });

  // ── Bins (CSR) over the torus ──
  const lists = Array.from({ length: BINS * BINS }, () => []);
  const gap = 0.002 + p.detail * 0.008;
  for (let i = 0; i < nSeg; i++) {
    const o = i * 7;
    const pad = Math.max(S[o + 4], S[o + 5]) + gap;
    const x0 = Math.min(S[o], S[o + 2]) - pad, x1 = Math.max(S[o], S[o + 2]) + pad;
    const y0 = Math.min(S[o + 1], S[o + 3]) - pad, y1 = Math.max(S[o + 1], S[o + 3]) + pad;
    for (let by = Math.floor(y0 * BINS); by <= Math.floor(y1 * BINS); by++) {
      for (let bx = Math.floor(x0 * BINS); bx <= Math.floor(x1 * BINS); bx++) {
        lists[mod(by, BINS) * BINS + mod(bx, BINS)].push(i);
      }
    }
  }
  const offs = new Int32Array(BINS * BINS + 1);
  for (let b = 0; b < BINS * BINS; b++) offs[b + 1] = offs[b] + lists[b].length;
  const idx = new Int32Array(offs[BINS * BINS]);
  for (let b = 0; b < BINS * BINS; b++) idx.set(lists[b], offs[b]);

  return {
    mode: st.mode, S, offs, idx, gap,
    bevel: 0.0015 + p.softness * 0.01,
    softness: p.softness,
  };
}

/** Height of the grown surface at tile coords (u, v). */
export function growthHeight(ctx, u, v) {
  const { S, offs, idx } = ctx;
  const b = Math.min(BINS - 1, Math.floor(v * BINS)) * BINS + Math.min(BINS - 1, Math.floor(u * BINS));
  let val = 0, curG = -1, curIn = -1e9;
  const solid = ctx.mode === 'solid';
  const flush = () => { if (curIn > -ctx.gap) val = curIn > 0 ? sstep(0, ctx.bevel, curIn) : 0; };
  for (let k = offs[b]; k < offs[b + 1]; k++) {
    const o = idx[k] * 7;
    // nearest periodic image of the pixel to this segment
    const mx = (S[o] + S[o + 2]) * 0.5, my = (S[o + 1] + S[o + 3]) * 0.5;
    const px = u + Math.round(mx - u), py = v + Math.round(my - v);
    const ax = S[o], ay = S[o + 1], vx = S[o + 2] - ax, vy = S[o + 3] - ay;
    const t = clamp01(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy + 1e-12));
    const d = Math.hypot(px - ax - vx * t, py - ay - vy * t);
    const w = lerp(S[o + 4], S[o + 5], t);
    const ins = w - d;
    if (solid) {
      const g = S[o + 6];
      if (g !== curG) { if (curG >= 0) flush(); curG = g; curIn = -1e9; }
      if (ins > curIn) curIn = ins;
    } else if (ins > 0 && w > 1e-6) {
      const q = d / w;
      const h = ctx.softness < 0.5 ? 1 - sstep(0.7, 1, q) : Math.sqrt(Math.max(0, 1 - q * q));
      if (h > val) val = h;
    }
  }
  if (solid && curG >= 0) flush();
  return val;
}
