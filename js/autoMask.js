/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ── Automatic masking: exposure + keep-out volumes ───────────────────────────
//
// Pure, DOM-free (also runs in autoMaskWorker.js).
//
// Exposure = min(hemisphere, cone):
//   hemisphere  fraction of cosine-weighted rays over the face's outward
//               hemisphere that escape the model. Low for interiors, internal
//               pins and bosses (they see mostly the model itself).
//   normal      does the ray straight along the face normal escape? — "can
//               this face see straight out?". Catches surfaces that see plenty
//               of sky sideways but face into the model: window side walls
//               (for a convex opening the normal ray always meets the opposite
//               wall, however shallow), base-plate ledges, recess floors.
//               A blocked normal caps exposure at NORMAL_BLOCKED.
// Outer skin scores high on both. One threshold separates "outside" from
// "hidden".
//
// Keep-out: a face is inside a keep-out volume when a ray from its centroid
// crosses the volume's surface an odd number of times (majority of 3 rays,
// so a ray grazing an edge can't flip the answer).

// ── BVH over a non-indexed triangle soup ─────────────────────────────────────

const LEAF = 4;

/**
 * @param {Float32Array} pos  non-indexed positions (9 floats per triangle)
 * @returns {{ pos, tri: Int32Array, nodes: Float32Array, meta: Int32Array }}
 *   nodes: 6 floats per node (min xyz, max xyz); meta: 2 ints per node
 *   (leaf: start, −count−1 | inner: left child, right child)
 */
export function buildBVH(pos) {
  const nTri = pos.length / 9;
  const tri = new Int32Array(nTri);
  const cx = new Float32Array(nTri), cy = new Float32Array(nTri), cz = new Float32Array(nTri);
  for (let t = 0; t < nTri; t++) {
    tri[t] = t;
    const o = t * 9;
    cx[t] = (pos[o] + pos[o + 3] + pos[o + 6]) / 3;
    cy[t] = (pos[o + 1] + pos[o + 4] + pos[o + 7]) / 3;
    cz[t] = (pos[o + 2] + pos[o + 5] + pos[o + 8]) / 3;
  }
  const maxNodes = Math.max(1, 2 * Math.ceil(nTri / LEAF) + 1);
  const nodes = new Float32Array(maxNodes * 6);
  const meta = new Int32Array(maxNodes * 2);
  let nNodes = 0;

  const stack = [[0, nTri, nNodes++]];
  while (stack.length) {
    const [start, end, node] = stack.pop();
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    let c0x = Infinity, c0y = Infinity, c0z = Infinity, c1x = -Infinity, c1y = -Infinity, c1z = -Infinity;
    for (let i = start; i < end; i++) {
      const t = tri[i], o = t * 9;
      for (let k = 0; k < 9; k += 3) {
        const X = pos[o + k], Y = pos[o + k + 1], Z = pos[o + k + 2];
        if (X < x0) x0 = X; if (X > x1) x1 = X;
        if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
        if (Z < z0) z0 = Z; if (Z > z1) z1 = Z;
      }
      if (cx[t] < c0x) c0x = cx[t]; if (cx[t] > c1x) c1x = cx[t];
      if (cy[t] < c0y) c0y = cy[t]; if (cy[t] > c1y) c1y = cy[t];
      if (cz[t] < c0z) c0z = cz[t]; if (cz[t] > c1z) c1z = cz[t];
    }
    const no = node * 6;
    nodes[no] = x0; nodes[no + 1] = y0; nodes[no + 2] = z0;
    nodes[no + 3] = x1; nodes[no + 4] = y1; nodes[no + 5] = z1;
    const count = end - start;
    const ex = c1x - c0x, ey = c1y - c0y, ez = c1z - c0z;
    if (count <= LEAF || Math.max(ex, ey, ez) < 1e-12) {
      meta[node * 2] = start; meta[node * 2 + 1] = -count - 1;
      continue;
    }
    // Median-of-centroid-range split on the widest axis.
    const axis = ex >= ey && ex >= ez ? cx : ey >= ez ? cy : cz;
    const mid = ex >= ey && ex >= ez ? (c0x + c1x) / 2 : ey >= ez ? (c0y + c1y) / 2 : (c0z + c1z) / 2;
    let i = start, j = end - 1;
    while (i <= j) {
      if (axis[tri[i]] < mid) i++;
      else { const tmp = tri[i]; tri[i] = tri[j]; tri[j] = tmp; j--; }
    }
    let split = i;
    if (split === start || split === end) split = (start + end) >> 1;
    const left = nNodes++, right = nNodes++;
    meta[node * 2] = left; meta[node * 2 + 1] = right;
    stack.push([start, split, left], [split, end, right]);
  }
  return { pos, tri, nodes, meta };
}

const _stack = new Int32Array(128);

/** Ray/triangle (Möller–Trumbore); returns t or −1. Double-sided. */
function hitTri(pos, o, ox, oy, oz, dx, dy, dz) {
  const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
  const e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az;
  const e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az;
  const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-14) return -1;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return -1;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return -1;
  return (e2x * qx + e2y * qy + e2z * qz) * inv;
}

function slab(nodes, n, ox, oy, oz, ix, iy, iz) {
  const o = n * 6;
  let t0 = (nodes[o] - ox) * ix, t1 = (nodes[o + 3] - ox) * ix;
  let tmin = Math.min(t0, t1), tmax = Math.max(t0, t1);
  t0 = (nodes[o + 1] - oy) * iy; t1 = (nodes[o + 4] - oy) * iy;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  t0 = (nodes[o + 2] - oz) * iz; t1 = (nodes[o + 5] - oz) * iz;
  tmin = Math.max(tmin, Math.min(t0, t1)); tmax = Math.min(tmax, Math.max(t0, t1));
  return tmax >= Math.max(tmin, 0);
}

/**
 * Walk the BVH along a ray. mode 'any' → true on first hit beyond tMin
 * (skipping triangle `skip`); mode 'count' → number of crossings.
 */
function trace(bvh, ox, oy, oz, dx, dy, dz, tMin, skip, countAll) {
  const { pos, tri, nodes, meta } = bvh;
  const ix = 1 / (dx || 1e-30), iy = 1 / (dy || 1e-30), iz = 1 / (dz || 1e-30);
  let sp = 0, hits = 0;
  _stack[sp++] = 0;
  while (sp) {
    const n = _stack[--sp];
    if (!slab(nodes, n, ox, oy, oz, ix, iy, iz)) continue;
    const a = meta[n * 2], b = meta[n * 2 + 1];
    if (b < 0) {
      for (let i = a, e = a - b - 1; i < e; i++) {
        const t = tri[i];
        if (t === skip) continue;
        const h = hitTri(pos, t * 9, ox, oy, oz, dx, dy, dz);
        if (h > tMin) { if (!countAll) return 1; hits++; }
      }
    } else if (sp < 126) {
      _stack[sp++] = a; _stack[sp++] = b;
    }
  }
  return hits;
}

// ── Exposure ─────────────────────────────────────────────────────────────────

/** Cosine-weighted hemisphere directions around +Z (Fibonacci spiral). */
export function hemisphereDirs(n) {
  const d = new Float32Array(n * 3), ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n), a = i * ga;
    d[i * 3] = r * Math.cos(a); d[i * 3 + 1] = r * Math.sin(a); d[i * 3 + 2] = Math.sqrt(Math.max(0, 1 - r * r));
  }
  return d;
}

const NORMAL_BLOCKED = 0.15;

/**
 * Exposure (0..1) for faces [f0, f1).
 * @param {object} bvh     from buildBVH (model positions)
 * @param {number} nRays   rays per face
 * @param {number} eps     origin offset along the normal (model units)
 */
export function computeExposure(bvh, f0, f1, nRays, eps) {
  const pos = bvh.pos;
  const dirs = hemisphereDirs(nRays);
  const out = new Float32Array(f1 - f0);
  for (let f = f0; f < f1; f++) {
    const o = f * 9;
    const ax = pos[o], ay = pos[o + 1], az = pos[o + 2];
    const e1x = pos[o + 3] - ax, e1y = pos[o + 4] - ay, e1z = pos[o + 5] - az;
    const e2x = pos[o + 6] - ax, e2y = pos[o + 7] - ay, e2z = pos[o + 8] - az;
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-20) { out[f - f0] = 1; continue; }
    nx /= nl; ny /= nl; nz /= nl;
    // Orthonormal frame (t, b, n)
    let tx, ty, tz;
    if (Math.abs(nx) < 0.9) { tx = 0; ty = -nz; tz = ny; } else { tx = nz; ty = 0; tz = -nx; }
    const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const cx = (ax + pos[o + 3] + pos[o + 6]) / 3 + nx * eps;
    const cy = (ay + pos[o + 4] + pos[o + 7]) / 3 + ny * eps;
    const cz = (az + pos[o + 5] + pos[o + 8]) / 3 + nz * eps;
    // Per-face rotation of the pattern so neighbouring faces don't alias.
    const rot = (f * 2.399963) % (2 * Math.PI), cr = Math.cos(rot), sr = Math.sin(rot);
    let escaped = 0;
    for (let r = 0; r < nRays; r++) {
      const lx = dirs[r * 3] * cr - dirs[r * 3 + 1] * sr, ly = dirs[r * 3] * sr + dirs[r * 3 + 1] * cr, lz = dirs[r * 3 + 2];
      const dx = tx * lx + bx * ly + nx * lz, dy = ty * lx + by * ly + ny * lz, dz = tz * lx + bz * ly + nz * lz;
      if (!trace(bvh, cx, cy, cz, dx, dy, dz, 1e-9, f, false)) escaped++;
    }
    const normalFree = !trace(bvh, cx, cy, cz, nx, ny, nz, 1e-9, f, false);
    out[f - f0] = normalFree ? escaped / nRays : Math.min(escaped / nRays, NORMAL_BLOCKED);
  }
  return out;
}

// ── Keep-out volumes ─────────────────────────────────────────────────────────

const PROBE_DIRS = [
  [0.577, 0.577, 0.577], [-0.707, 0.3, 0.64], [0.2, -0.93, 0.31],
];

/** True if point (x,y,z) is inside the closed mesh behind `bvh` (odd crossings, majority of 3). */
export function pointInside(bvh, x, y, z) {
  let votes = 0;
  for (const [dx, dy, dz] of PROBE_DIRS) {
    if (trace(bvh, x, y, z, dx, dy, dz, 0, -1, true) & 1) votes++;
  }
  return votes >= 2;
}

// ── Helpers for enclosures open at the bottom ────────────────────────────────

/**
 * Triangles for a virtual cap across the model's footprint at bed level
 * (min Z). Enclosures are often printed open-bottomed for a base plate; the
 * cap makes the interior count as enclosed while outer walls still see freely
 * sideways. Returns a Float32Array triangle soup (fan over the 2D convex hull
 * of the vertices within `band` of the bottom).
 */
export function footprintCap(pos, band = 0.6) {
  let zMin = Infinity;
  for (let i = 2; i < pos.length; i += 3) if (pos[i] < zMin) zMin = pos[i];
  const pts = [];
  for (let i = 0; i < pos.length; i += 3) if (pos[i + 2] < zMin + band) pts.push([pos[i], pos[i + 1]]);
  if (pts.length < 3) return new Float32Array(0);
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  const z = zMin + 0.05;
  const out = new Float32Array((hull.length - 2) * 9);
  for (let i = 1; i < hull.length - 1; i++) {
    out.set([hull[0][0], hull[0][1], z, hull[i][0], hull[i][1], z, hull[i + 1][0], hull[i + 1][1], z], (i - 1) * 9);
  }
  return out;
}

/** Area-weighted neighbour averaging of a per-face value (removes speckle). */
export function smoothFaceValues(values, adjacency, pos, passes = 2) {
  const n = values.length;
  const area = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const o = f * 9;
    const e1x = pos[o + 3] - pos[o], e1y = pos[o + 4] - pos[o + 1], e1z = pos[o + 5] - pos[o + 2];
    const e2x = pos[o + 6] - pos[o], e2y = pos[o + 7] - pos[o + 1], e2z = pos[o + 8] - pos[o + 2];
    area[f] = 0.5 * Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) + 1e-12;
  }
  let cur = values;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(n);
    for (let f = 0; f < n; f++) {
      let s = cur[f] * area[f], w = area[f];
      for (const { neighbor, angle } of adjacency[f]) {
        if (angle > 60) continue;   // don't blur across sharp edges (window walls, pins)
        s += cur[neighbor] * area[neighbor]; w += area[neighbor];
      }
      next[f] = s / w;
    }
    cur = next;
  }
  return cur;
}

/**
 * Grow a face mask: add every face whose three vertices all lie within
 * `dist` of a vertex of a masked face that does NOT face the opposite way.
 *   - "all three vertices" → narrow features hugging the masked region
 *     (window bevels, lips around ports) are swallowed, big faces that merely
 *     touch it are not.
 *   - "not facing the opposite way" (normals less than ~100° apart) → the mask
 *     can't leak straight through a thin wall to the skin on the other side.
 * Straight-line distance (rather than walking shared edges) keeps this robust
 * to CAD meshes whose bevels don't share vertices with neighbouring faces.
 */
export function growMask(masked, pos, dist) {
  if (!(dist > 0) || masked.size === 0) return masked;
  const n = pos.length / 9;
  const nrm = new Float32Array(n * 3);
  for (let f = 0; f < n; f++) {
    const o = f * 9;
    const e1x = pos[o + 3] - pos[o], e1y = pos[o + 4] - pos[o + 1], e1z = pos[o + 5] - pos[o + 2];
    const e2x = pos[o + 6] - pos[o], e2y = pos[o + 7] - pos[o + 1], e2z = pos[o + 8] - pos[o + 2];
    let x = e1y * e2z - e1z * e2y, y = e1z * e2x - e1x * e2z, z = e1x * e2y - e1y * e2x;
    const l = Math.hypot(x, y, z) || 1;
    nrm[f * 3] = x / l; nrm[f * 3 + 1] = y / l; nrm[f * 3 + 2] = z / l;
  }
  const inv = 1 / dist, grid = new Map();
  const key = (x, y, z) => (Math.floor(x * inv) * 73856093) ^ (Math.floor(y * inv) * 19349663) ^ (Math.floor(z * inv) * 83492791);
  for (const f of masked) {
    for (let k = 0; k < 9; k += 3) {
      const o = f * 9 + k, kk = key(pos[o], pos[o + 1], pos[o + 2]);
      let b = grid.get(kk); if (!b) grid.set(kk, b = []);
      b.push(pos[o], pos[o + 1], pos[o + 2], nrm[f * 3], nrm[f * 3 + 1], nrm[f * 3 + 2]);
    }
  }
  const d2 = dist * dist, MIN_DOT = -0.17;   // ~100°
  const near = (x, y, z, nx, ny, nz) => {
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) {
      const b = grid.get(((cx + i) * 73856093) ^ ((cy + j) * 19349663) ^ ((cz + k) * 83492791));
      if (!b) continue;
      for (let q = 0; q < b.length; q += 6) {
        const dx = b[q] - x, dy = b[q + 1] - y, dz = b[q + 2] - z;
        if (dx * dx + dy * dy + dz * dz <= d2 && b[q + 3] * nx + b[q + 4] * ny + b[q + 5] * nz > MIN_DOT) return true;
      }
    }
    return false;
  };
  const out = new Set(masked);
  for (let f = 0; f < n; f++) {
    if (out.has(f)) continue;
    const o = f * 9, nx = nrm[f * 3], ny = nrm[f * 3 + 1], nz = nrm[f * 3 + 2];
    if (near(pos[o], pos[o + 1], pos[o + 2], nx, ny, nz) &&
        near(pos[o + 3], pos[o + 4], pos[o + 5], nx, ny, nz) &&
        near(pos[o + 6], pos[o + 7], pos[o + 8], nx, ny, nz)) out.add(f);
  }
  return out;
}
