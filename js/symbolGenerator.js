/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Procedural symbol maps: one symbol (or a seamless field of them) as a
// height map. Symbols are drawn as vector shapes on an OffscreenCanvas
// (white = symbol), then a Euclidean distance transform turns the coverage
// into a relief profile — a crisp chamfer, a rounded pillow, or an outline —
// optionally on a coin / stamp / tile frame.
//
// Single layout: the map holds one centred symbol with an empty border; the
// mapper samples it once (entry.singleTile, mapping.js) instead of tiling.

import { hashf, clamp01, lerp, blurWrap } from './proceduralCore.js';
import { SYMBOL_CATALOGUE } from './symbolPresets.js';

export const LAYOUTS = ['single', 'grid', 'brick'];
export const PROFILES = ['flat', 'round', 'outline'];
export const FRAMES = ['none', 'ring', 'coin', 'stamp', 'tile'];

export const DEFAULT_SYMBOL_PARAMS = Object.freeze({
  symbol: 'smiley',
  layout: 'single',
  size: 0.8,        // symbol size: share of the map (single) or of a cell (grid)
  count: 4,         // grid: symbols per tile row
  scatter: 0,       // grid: position jitter
  sizeVar: 0,       // grid: size jitter
  rotJitter: 0,     // grid: rotation jitter
  mix: 0,           // grid: chance of another symbol from the same family
  profile: 'flat',
  bevel: 0.25,      // edge width (flat / round)
  outline: 0.3,     // outline width (outline profile)
  frame: 'none',
  softness: 0.05,
  seed: 1,
});

const TAU = Math.PI * 2;
const D = Math.PI / 180;

// ── Drawing toolkit: every symbol draws into a 100 × 100 box ────────────────
// fill / stroke add white; cut / cutStroke remove (destination-out), so
// symbols can have holes. Each symbol gets its own scratch canvas, so cuts
// never reach a neighbour.

function kit(c) {
  const begin = (fn) => { c.beginPath(); fn(c); };
  return {
    c,
    fill(fn, rule = 'nonzero') { begin(fn); c.fill(rule); },
    stroke(fn, w, cap = 'round') { begin(fn); c.lineWidth = w; c.lineCap = cap; c.lineJoin = 'round'; c.stroke(); },
    cut(fn, rule = 'nonzero') {
      c.globalCompositeOperation = 'destination-out'; begin(fn); c.fill(rule);
      c.globalCompositeOperation = 'source-over';
    },
    cutStroke(fn, w, cap = 'round') {
      c.globalCompositeOperation = 'destination-out';
      begin(fn); c.lineWidth = w; c.lineCap = cap; c.lineJoin = 'round'; c.stroke();
      c.globalCompositeOperation = 'source-over';
    },
  };
}

const circ = (x, y, r) => (c) => { c.moveTo(x + r, y); c.arc(x, y, r, 0, TAU); };
const ell = (x, y, rx, ry, rot = 0) => (c) => { c.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); c.ellipse(x, y, rx, ry, rot, 0, TAU); };
const poly = (pts) => (c) => { c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.closePath(); };
const line = (...pts) => (c) => { c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); };
const arc = (x, y, r, a0, a1, ccw = false) => (c) => { c.moveTo(x + r * Math.cos(a0), y + r * Math.sin(a0)); c.arc(x, y, r, a0, a1, ccw); };
const rrect = (x, y, w, h, r) => (c) => { c.roundRect(x, y, w, h, r); };
const many = (...fns) => (c) => { for (const f of fns) f(c); };

/** Star polygon: n points, outer radius R, inner r, first point up. */
function starPts(n, R, r, cx = 50, cy = 50, rot = -90) {
  const pts = [];
  for (let i = 0; i < 2 * n; i++) {
    const a = (rot + i * 180 / n) * D, rr = i % 2 ? r : R;
    pts.push(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  return pts;
}

function arrowHead(c, x, y, ang, s) {
  const p = (a, r) => [x + r * Math.cos(ang + a), y + r * Math.sin(ang + a)];
  const [ax, ay] = p(0, s), [bx, by] = p(2.4, s * 0.85), [dx, dy] = p(-2.4, s * 0.85);
  c.moveTo(ax, ay); c.lineTo(bx, by); c.lineTo(dx, dy); c.closePath();
}

const SYMBOLS = {
  // ── Faces & emoji ──
  smiley(k) {
    k.fill(circ(50, 50, 46));
    k.cut(many(ell(35, 37, 5.5, 8.5), ell(65, 37, 5.5, 8.5)));
    k.cutStroke(arc(50, 50, 27, 25 * D, 155 * D), 7);
  },
  wink(k) {
    k.fill(circ(50, 50, 46));
    k.cut(ell(35, 37, 5.5, 8.5));
    k.cutStroke((c) => { c.moveTo(57, 40); c.quadraticCurveTo(65, 30, 73, 40); }, 5.5);
    k.cutStroke(arc(50, 50, 27, 25 * D, 155 * D), 7);
  },
  grin(k) {
    k.fill(circ(50, 50, 46));
    k.cutStroke((c) => { c.moveTo(27, 38); c.quadraticCurveTo(35, 27, 43, 38); c.moveTo(57, 38); c.quadraticCurveTo(65, 27, 73, 38); }, 5.5);
    k.cut((c) => { c.moveTo(24, 52); c.arc(50, 52, 26, 0, Math.PI); c.closePath(); c.moveTo(24, 52); c.lineTo(76, 52); });
  },
  heart(k) {
    k.fill((c) => {
      c.moveTo(50, 90);
      c.bezierCurveTo(12, 64, 2, 40, 14, 22);
      c.bezierCurveTo(26, 6, 46, 10, 50, 28);
      c.bezierCurveTo(54, 10, 74, 6, 86, 22);
      c.bezierCurveTo(98, 40, 88, 64, 50, 90);
      c.closePath();
    });
  },
  star(k) { k.fill(poly(starPts(5, 48, 19, 50, 53))); },
  sparkle(k) {
    k.fill((c) => {
      c.moveTo(50, 2); c.quadraticCurveTo(56, 44, 98, 50); c.quadraticCurveTo(56, 56, 50, 98);
      c.quadraticCurveTo(44, 56, 2, 50); c.quadraticCurveTo(44, 44, 50, 2); c.closePath();
    });
  },
  bolt(k) { k.fill(poly([60, 2, 18, 56, 45, 56, 36, 98, 82, 40, 55, 40, 66, 2])); },
  flame(k) {
    k.fill((c) => {
      c.moveTo(50, 98);
      c.bezierCurveTo(22, 98, 12, 74, 22, 52);
      c.bezierCurveTo(26, 60, 32, 66, 38, 66);
      c.bezierCurveTo(30, 42, 42, 18, 58, 2);
      c.bezierCurveTo(58, 26, 86, 40, 84, 68);
      c.bezierCurveTo(82, 88, 68, 98, 50, 98);
      c.closePath();
    });
    k.cut((c) => {
      c.moveTo(50, 92);
      c.bezierCurveTo(38, 92, 34, 80, 40, 68);
      c.bezierCurveTo(44, 72, 48, 74, 52, 72);
      c.bezierCurveTo(50, 62, 54, 54, 60, 48);
      c.bezierCurveTo(62, 62, 70, 70, 66, 82);
      c.bezierCurveTo(64, 88, 58, 92, 50, 92);
      c.closePath();
    });
  },
  ghost(k) {
    k.fill((c) => {
      c.moveTo(16, 94); c.lineTo(16, 46); c.arc(50, 46, 34, Math.PI, 0); c.lineTo(84, 94);
      for (let i = 0; i < 4; i++) {
        const x0 = 84 - i * 17;
        c.quadraticCurveTo(x0 - 4.25, 84, x0 - 8.5, 90);
        c.quadraticCurveTo(x0 - 12.75, 96, x0 - 17, 94);
      }
      c.closePath();
    });
    k.cut(many(ell(38, 44, 6, 9), ell(62, 44, 6, 9)));
    k.cut(ell(50, 64, 5, 6.5));
  },
  cat(k) {
    k.fill(many(ell(50, 60, 38, 33), poly([16, 52, 20, 8, 44, 30]), poly([84, 52, 80, 8, 56, 30])));
    k.cut(many(ell(35, 54, 5, 8), ell(65, 54, 5, 8)));
    k.cut(poly([45, 66, 55, 66, 50, 72]));
    k.cutStroke(many(line(30, 70, 6, 66), line(30, 75, 7, 79), line(70, 70, 94, 66), line(70, 75, 93, 79)), 2.6);
    k.cutStroke((c) => { c.moveTo(50, 72); c.quadraticCurveTo(45, 80, 40, 77); c.moveTo(50, 72); c.quadraticCurveTo(55, 80, 60, 77); }, 2.6);
  },
  skull(k) {
    k.fill(many(ell(50, 42, 38, 36), rrect(30, 62, 40, 30, 7)));
    k.cut(many(ell(35, 46, 10, 11), ell(65, 46, 10, 11)));
    k.cut(poly([50, 56, 44, 68, 56, 68]));
    k.cutStroke(many(line(40, 80, 40, 92), line(50, 80, 50, 92), line(60, 80, 60, 92)), 3.5, 'butt');
  },
  paw(k) {
    k.fill(many(
      (c) => { c.moveTo(50, 52); c.bezierCurveTo(68, 52, 80, 70, 74, 84); c.bezierCurveTo(68, 96, 56, 88, 50, 88); c.bezierCurveTo(44, 88, 32, 96, 26, 84); c.bezierCurveTo(20, 70, 32, 52, 50, 52); c.closePath(); },
      ell(18, 46, 9, 12, -0.4), ell(36, 24, 10, 13, -0.15), ell(64, 24, 10, 13, 0.15), ell(82, 46, 9, 12, 0.4),
    ));
  },

  // ── Signs ──
  warning(k) {
    const tri = poly([50, 10, 93, 86, 7, 86]);
    k.fill(tri); k.stroke(tri, 10);
    k.cut(many(rrect(45, 34, 10, 30, 5), circ(50, 75, 5.5)));
  },
  radiation(k) {
    k.fill(circ(50, 50, 9));
    for (const a of [-90, 30, 150]) {
      k.fill((c) => { c.arc(50, 50, 46, (a - 30) * D, (a + 30) * D); c.arc(50, 50, 15, (a + 30) * D, (a - 30) * D, true); c.closePath(); });
    }
  },
  cycle(k) {
    k.stroke(arc(50, 50, 34, 200 * D, 330 * D), 11, 'butt');
    k.stroke(arc(50, 50, 34, 20 * D, 150 * D), 11, 'butt');
    k.fill((c) => {
      arrowHead(c, 50 + 34 * Math.cos(330 * D), 50 + 34 * Math.sin(330 * D), 60 * D, 16);
      arrowHead(c, 50 + 34 * Math.cos(150 * D), 50 + 34 * Math.sin(150 * D), 240 * D, 16);
    });
  },
  power(k) {
    k.stroke(arc(50, 54, 33, -55 * D, 235 * D), 10);
    k.stroke(line(50, 8, 50, 50), 10);
  },
  wifi(k) {
    for (const r of [24, 46, 68]) k.stroke(arc(50, 86, r, -132 * D, -48 * D), 9);
    k.fill(circ(50, 86, 7.5));
  },
  check(k) { k.stroke(line(14, 54, 40, 80, 88, 22), 15); },
  cross(k) { k.stroke(many(line(18, 18, 82, 82), line(82, 18, 18, 82)), 15); },
  plus(k) { k.fill(many(rrect(38, 8, 24, 84, 6), rrect(8, 38, 84, 24, 6))); },
  arrow(k) { k.fill(poly([6, 38, 52, 38, 52, 16, 94, 50, 52, 84, 52, 62, 6, 62])); },
  nosign(k) {
    k.stroke(circ(50, 50, 40), 11);
    k.stroke(line(22, 22, 78, 78), 11, 'butt');
  },
  pin(k) {
    k.fill((c) => {
      c.moveTo(50, 97);
      c.bezierCurveTo(36, 76, 16, 60, 16, 38);
      c.arc(50, 38, 34, Math.PI, 0);
      c.bezierCurveTo(84, 60, 64, 76, 50, 97);
      c.closePath();
    });
    k.cut(circ(50, 38, 13));
  },
  peace(k) {
    k.stroke(circ(50, 50, 41), 8);
    k.stroke(many(line(50, 10, 50, 90), line(50, 52, 22, 78), line(50, 52, 78, 78)), 8, 'butt');
  },
  infinity(k) {
    k.stroke((c) => {
      for (let i = 0; i <= 200; i++) {
        const t = i / 200 * TAU, s = Math.sin(t), d = 1 + s * s;
        const x = 50 + 44 * Math.cos(t) / d, y = 50 + 44 * s * Math.cos(t) / d;
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
    }, 10);
  },
  yinyang(k) {
    k.stroke(circ(50, 50, 45), 3);
    k.fill((c) => {
      c.moveTo(50, 5); c.arc(50, 50, 45, -Math.PI / 2, Math.PI / 2, true);
      c.arc(50, 72.5, 22.5, Math.PI / 2, -Math.PI / 2, true);
      c.arc(50, 27.5, 22.5, Math.PI / 2, -Math.PI / 2, false);
      c.closePath();
    });
    k.cut(circ(50, 27.5, 7));
    k.fill(circ(50, 72.5, 7));
  },

  // ── Ancient & esoteric ──
  ankh(k) {
    k.stroke(ell(50, 26, 15, 20), 9);
    k.fill(many(rrect(14, 44, 72, 11, 3), poly([44, 50, 56, 50, 60, 97, 40, 97])));
  },
  triskele(k) {
    for (let j = 0; j < 3; j++) {
      const a0 = (-90 + j * 120) * D;
      const cx = 50 + 21 * Math.cos(a0), cy = 50 + 21 * Math.sin(a0);
      k.stroke((c) => {
        c.moveTo(50, 50);
        for (let i = 0; i <= 120; i++) {
          const t = i / 120, th = a0 + Math.PI + t * 2.4 * Math.PI, r = 21 * (1 - t * 0.85);
          c.lineTo(cx + r * Math.cos(th), cy + r * Math.sin(th));
        }
      }, 6.5);
    }
  },
  spiral(k) {
    k.stroke((c) => {
      for (let i = 0; i <= 400; i++) {
        const th = i / 400 * 6 * Math.PI, r = 3 + 42 * (i / 400);
        const x = 50 + r * Math.cos(th), y = 50 + r * Math.sin(th);
        if (i === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
    }, 6.5);
  },
  rings(k) {
    for (const a of [-90, 30, 150]) k.stroke(circ(50 + 17 * Math.cos(a * D), 50 + 17 * Math.sin(a * D), 27), 6);
  },
  hexagram(k) {
    const t1 = [], t2 = [];
    for (let i = 0; i < 3; i++) {
      t1.push(50 + 46 * Math.cos((-90 + i * 120) * D), 50 + 46 * Math.sin((-90 + i * 120) * D));
      t2.push(50 + 46 * Math.cos((90 + i * 120) * D), 50 + 46 * Math.sin((90 + i * 120) * D));
    }
    k.stroke(many(poly(t1), poly(t2)), 6.5);
  },
  pentacle(k) {
    const p = [];
    for (let i = 0; i < 5; i++) { const a = (-90 + i * 144) * D; p.push(50 + 40 * Math.cos(a), 50 + 40 * Math.sin(a)); }
    k.stroke(poly(p), 5.5);
    k.stroke(circ(50, 50, 45), 5.5);
  },
  eye(k) {
    k.stroke(poly([50, 6, 95, 88, 5, 88]), 6);
    k.fill((c) => { c.moveTo(24, 62); c.quadraticCurveTo(50, 36, 76, 62); c.quadraticCurveTo(50, 86, 24, 62); c.closePath(); });
    k.cut(circ(50, 62, 10));
    k.fill(circ(50, 62, 5));
  },
  suncross(k) {
    k.stroke(circ(50, 50, 42), 8);
    k.stroke(many(line(50, 8, 50, 92), line(8, 50, 92, 50)), 8, 'butt');
  },
  enso(k) {
    // A brush circle: thick where the stroke starts, thinning into the gap.
    const n = 140;
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1.5) / n;
      const a0 = (110 + t0 * 315) * D, a1 = (110 + t1 * 315) * D;
      const w = 15 * Math.pow(1 - t0, 0.6) + 2.5 + 3 * Math.sin(t0 * 9);
      k.stroke(arc(50, 50, 38, a0, a1), w);
    }
  },
  compass(k) {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = (-90 + i * 22.5) * D;
      const r = i % 4 === 0 ? 48 : i % 2 === 0 ? 30 : 9;
      pts.push(50 + r * Math.cos(a), 50 + r * Math.sin(a));
    }
    k.fill(poly(pts));
    k.stroke(circ(50, 50, 36), 3);
    k.cut(circ(50, 50, 4));
  },
  fleur(k) {
    k.fill((c) => {
      // centre petal
      c.moveTo(50, 4); c.bezierCurveTo(66, 22, 64, 46, 55, 60); c.lineTo(45, 60); c.bezierCurveTo(36, 46, 34, 22, 50, 4); c.closePath();
      // side petals
      c.moveTo(44, 62); c.bezierCurveTo(30, 66, 8, 58, 10, 38); c.bezierCurveTo(12, 28, 24, 26, 28, 34);
      c.bezierCurveTo(22, 34, 20, 44, 28, 48); c.bezierCurveTo(34, 52, 40, 50, 44, 46); c.closePath();
      c.moveTo(56, 62); c.bezierCurveTo(70, 66, 92, 58, 90, 38); c.bezierCurveTo(88, 28, 76, 26, 72, 34);
      c.bezierCurveTo(78, 34, 80, 44, 72, 48); c.bezierCurveTo(66, 52, 60, 50, 56, 46); c.closePath();
      // lower stem and curls
      c.moveTo(45, 70); c.lineTo(55, 70); c.lineTo(52, 90); c.lineTo(48, 90); c.closePath();
      c.moveTo(45, 72); c.bezierCurveTo(36, 74, 30, 86, 38, 92); c.bezierCurveTo(36, 84, 40, 80, 47, 80); c.closePath();
      c.moveTo(55, 72); c.bezierCurveTo(64, 74, 70, 86, 62, 92); c.bezierCurveTo(64, 84, 60, 80, 53, 80); c.closePath();
    });
    k.fill(rrect(28, 60, 44, 10, 3));
  },
  rosette(k) {
    for (let i = 0; i < 12; i++) k.fill(ell(50 + 30 * Math.cos(i * 30 * D), 50 + 30 * Math.sin(i * 30 * D), 15, 6.5, i * 30 * D));
    k.stroke(circ(50, 50, 20), 4);
    k.fill(circ(50, 50, 10));
  },

  // ── Modern & objects ──
  gear(k) {
    const n = 10, pts = [];
    for (let i = 0; i < n; i++) {
      const a = i * TAU / n, h = TAU / n;
      for (const [f, r] of [[0.0, 36], [0.12, 47], [0.38, 47], [0.5, 36]]) {
        pts.push(50 + r * Math.cos(a + f * h), 50 + r * Math.sin(a + f * h));
      }
    }
    k.fill(poly(pts));
    k.fill(circ(50, 50, 37));
    k.cut(circ(50, 50, 15));
  },
  nut(k) {
    const p = [];
    for (let i = 0; i < 6; i++) p.push(50 + 46 * Math.cos(i * 60 * D), 50 + 46 * Math.sin(i * 60 * D));
    k.fill(poly(p));
    k.cut(circ(50, 50, 21));
  },
  padlock(k) {
    k.stroke((c) => { c.moveTo(30, 48); c.lineTo(30, 32); c.arc(50, 32, 20, Math.PI, 0); c.lineTo(70, 48); }, 9, 'butt');
    k.fill(rrect(16, 44, 68, 52, 8));
    k.cut(many(circ(50, 64, 7), poly([46, 66, 54, 66, 56, 84, 44, 84])));
  },
  key(k) {
    k.stroke(circ(26, 50, 16), 9);
    k.fill(many(rrect(40, 45, 56, 10, 2), rrect(76, 53, 7, 14, 1), rrect(87, 53, 7, 18, 1)));
  },
  globe(k) {
    k.stroke(circ(50, 50, 44), 5);
    k.stroke(many(ell(50, 50, 18, 44), line(50, 6, 50, 94), line(6, 50, 94, 50), line(14, 28, 86, 28), line(14, 72, 86, 72)), 4);
  },
  planet(k) {
    const ring = (front) => (c) => {
      c.ellipse(50, 50, 47, 12, -20 * D, front ? 0 : Math.PI, front ? Math.PI : TAU);
    };
    k.stroke(ring(false), 6, 'butt');
    k.cut(circ(50, 50, 28));
    k.fill(circ(50, 50, 25));
    k.cutStroke(ring(true), 11, 'butt');
    k.stroke(ring(true), 6, 'butt');
  },
  crown(k) {
    k.fill(poly([10, 80, 6, 26, 30, 52, 50, 16, 70, 52, 94, 26, 90, 80]));
    k.fill(many(rrect(10, 84, 80, 10, 3), circ(6, 24, 6), circ(50, 13, 6.5), circ(94, 24, 6)));
  },
  anchor(k) {
    k.stroke(circ(50, 13, 8), 6);
    k.stroke(line(50, 21, 50, 90), 9, 'butt');
    k.stroke(line(30, 34, 70, 34), 8);
    k.stroke(arc(50, 54, 36, 15 * D, 165 * D), 8, 'butt');
    k.fill((c) => {
      arrowHead(c, 50 + 36 * Math.cos(15 * D), 50 + 2 + 36 * Math.sin(15 * D), -80 * D, 14);
      arrowHead(c, 50 + 36 * Math.cos(165 * D), 50 + 2 + 36 * Math.sin(165 * D), -100 * D, 14);
      arrowHead(c, 50, 92, 90 * D, 9);
    });
  },
  notes(k) {
    k.fill(many(ell(28, 80, 13, 9.5, -20 * D), ell(74, 72, 13, 9.5, -20 * D), poly([37, 16, 86, 6, 86, 20, 37, 30])));
    k.stroke(many(line(38, 78, 38, 20), line(84, 70, 84, 10)), 6, 'butt');
  },
  dice(k) {
    k.fill(rrect(6, 6, 88, 88, 16));
    k.cut(many(circ(28, 28, 8), circ(72, 28, 8), circ(50, 50, 8), circ(28, 72, 8), circ(72, 72, 8)));
  },
  bubble(k) {
    k.fill(many(rrect(6, 10, 88, 62, 18), poly([24, 66, 18, 94, 46, 70])));
    k.cut(many(circ(30, 41, 6), circ(50, 41, 6), circ(70, 41, 6)));
  },

  // ── Nature ──
  sun(k) {
    k.fill(circ(50, 50, 21));
    for (let i = 0; i < 12; i++) {
      const a = i * 30 * D, w = 0.13;
      k.fill(poly([50 + 27 * Math.cos(a - w), 50 + 27 * Math.sin(a - w), 50 + 48 * Math.cos(a), 50 + 48 * Math.sin(a), 50 + 27 * Math.cos(a + w), 50 + 27 * Math.sin(a + w)]));
    }
  },
  moon(k) {
    k.fill(circ(48, 50, 42));
    k.cut(circ(66, 40, 36));
  },
  leaf(k) {
    k.fill((c) => { c.moveTo(12, 88); c.bezierCurveTo(10, 40, 44, 10, 92, 8); c.bezierCurveTo(92, 56, 62, 90, 12, 88); c.closePath(); });
    k.cutStroke(line(18, 82, 80, 20), 3.5);
    k.cutStroke(many(line(40, 60, 40, 38), line(40, 60, 62, 60), line(56, 44, 56, 26), line(56, 44, 74, 44)), 2.5);
  },
  flower(k) {
    for (let i = 0; i < 6; i++) { const a = (i * 60 - 90) * D; k.fill(ell(50 + 26 * Math.cos(a), 50 + 26 * Math.sin(a), 22, 14, a)); }
    k.cut(circ(50, 50, 17));
    k.fill(circ(50, 50, 12));
  },
  snowflake(k) {
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 - 90) * D, ca = Math.cos(a), sa = Math.sin(a);
      const P = (r, da = 0) => [50 + r * Math.cos(a + da), 50 + r * Math.sin(a + da)];
      const [ex, ey] = P(46);
      k.stroke(line(50, 50, ex, ey), 6);
      for (const [r, L] of [[22, 13], [34, 9]]) {
        const bx = 50 + r * ca, by = 50 + r * sa;
        k.stroke(many(line(bx, by, bx + L * Math.cos(a - 0.8), by + L * Math.sin(a - 0.8)), line(bx, by, bx + L * Math.cos(a + 0.8), by + L * Math.sin(a + 0.8))), 5);
      }
    }
    k.fill(circ(50, 50, 7));
  },
  mountain(k) {
    k.fill(poly([2, 88, 38, 22, 58, 52, 70, 38, 98, 88]));
    k.cutStroke(line(26, 44, 34, 40, 38, 46, 44, 38, 50, 42), 3.5);
  },
};

// ── Rendering ────────────────────────────────────────────────────────────────

const FAMILY = {};
for (const s of SYMBOL_CATALOGUE) (FAMILY[s.cat] ||= []).push(s.id);
const catOf = (id) => (SYMBOL_CATALOGUE.find(s => s.id === id) || SYMBOL_CATALOGUE[0]).cat;

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}

/** Draw one symbol (plus its frame) into a px × px scratch canvas, white on transparent. */
function renderSymbol(id, px, frame) {
  const cv = makeCanvas(px, px);
  const c = cv.getContext('2d');
  c.fillStyle = c.strokeStyle = '#fff';
  c.scale(px / 100, px / 100);
  const draw = SYMBOLS[id] || SYMBOLS.smiley;
  if (frame === 'ring') {
    c.save(); c.translate(50, 50); c.scale(0.66, 0.66); c.translate(-50, -50);
    draw(kit(c)); c.restore();
    const k = kit(c);
    k.stroke(circ(50, 50, 46), 5);
  } else if (frame !== 'none') {
    c.save(); c.translate(50, 50); c.scale(0.7, 0.7); c.translate(-50, -50);
    draw(kit(c)); c.restore();
  } else {
    draw(kit(c));
  }
  return cv;
}

/** Plate shape behind coin / stamp / tile frames. */
function renderPlate(px, frame) {
  const cv = makeCanvas(px, px);
  const c = cv.getContext('2d');
  c.fillStyle = '#fff';
  c.scale(px / 100, px / 100);
  c.beginPath();
  if (frame === 'tile') c.roundRect(3, 3, 94, 94, 14); else c.arc(50, 50, 48, 0, TAU);
  c.fill();
  return cv;
}

/** Instances to stamp: { id, x, y, s (px), rot } in map pixels. */
function layoutInstances(p, size) {
  const S = (p.seed | 0) * 7919 + 17;
  if (p.layout === 'single') {
    return [{ id: p.symbol, x: size / 2, y: size / 2, s: size * Math.min(0.94, 0.06 + 0.88 * p.size), rot: 0 }];
  }
  const n = Math.max(1, Math.round(p.count));
  const rows = p.layout === 'brick' ? n + (n % 2) : n;   // brick rows pair up so the tile stays seamless
  const cw = size / n, ch = size / rows;
  const fam = FAMILY[catOf(p.symbol)];
  const out = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < n; i++) {
      const h = (k) => hashf(i, j, S + k * 101);
      let x = (i + 0.5) * cw, y = (j + 0.5) * ch;
      if (p.layout === 'brick' && j % 2) x += cw / 2;
      x += (h(1) - 0.5) * cw * p.scatter;
      y += (h(2) - 0.5) * ch * p.scatter;
      const s = Math.min(cw, ch) * Math.min(0.98, 0.05 + 0.93 * p.size) * (1 - p.sizeVar * 0.6 * h(3));
      const rot = (h(4) - 0.5) * TAU * p.rotJitter;
      const id = (p.mix > 0 && h(5) < p.mix) ? fam[Math.floor(h(6) * fam.length) % fam.length] : p.symbol;
      out.push({ id, x, y, s, rot });
    }
  }
  return out;
}

/** Stamp scratch renders onto a size × size canvas (wrapping across the edges when tiled). */
function stamp(ctx, size, inst, scratchOf, wrap) {
  for (const it of inst) {
    const img = scratchOf(it.id);
    const r = it.s * 0.75;   // rotated half-diagonal, roughly
    const xs = wrap ? [-size, 0, size] : [0], ys = wrap ? [-size, 0, size] : [0];
    for (const ox of xs) for (const oy of ys) {
      const x = it.x + ox, y = it.y + oy;
      if (x + r < 0 || x - r > size || y + r < 0 || y - r > size) continue;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(it.rot);
      ctx.drawImage(img, -it.s / 2, -it.s / 2, it.s, it.s);
      ctx.restore();
    }
  }
}

function coverage(p, size, inst, which) {
  const cv = makeCanvas(size, size);
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.globalCompositeOperation = 'lighten';
  const maxS = Math.ceil(Math.max(...inst.map(i => i.s)));
  const cache = new Map();
  const scratchOf = (id) => {
    if (!cache.has(id)) cache.set(id, which === 'plate' ? renderPlate(maxS, p.frame) : renderSymbol(id, maxS, p.frame));
    return cache.get(id);
  };
  stamp(ctx, size, inst, scratchOf, p.layout !== 'single');
  const d = ctx.getImageData(0, 0, size, size).data;
  const cov = new Float32Array(size * size);
  for (let i = 0; i < cov.length; i++) cov[i] = d[i * 4 + 3] / 255;
  return cov;
}

// ── Distance transform (Felzenszwalb–Huttenlocher, squared Euclidean) ───────

function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    do {
      const r = v[k];
      s = ((f[q] + q * q) - (f[r] + r * r)) / (2 * q - 2 * r);
      if (s <= z[k]) k--; else break;
    } while (k >= 0);
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

/**
 * Distance (px) from every inside pixel (cov ≥ 0.5) to the nearest outside
 * one, anti-aliased with the coverage. `wrap` pads the tile with its own
 * edges first so distances are seamless across them.
 */
function insideDistance(cov, size, wrap, maxD) {
  const pad = wrap ? Math.min(size, Math.ceil(maxD) + 2) : 0;
  const W = size + 2 * pad;
  const INF = 1e12;
  const g = new Float64Array(W * W);
  for (let y = 0; y < W; y++) {
    const sy = ((y - pad) % size + size) % size;
    for (let x = 0; x < W; x++) {
      const sx = ((x - pad) % size + size) % size;
      g[y * W + x] = cov[sy * size + sx] >= 0.5 ? INF : 0;
    }
  }
  const f = new Float64Array(W), d = new Float64Array(W), v = new Int32Array(W), z = new Float64Array(W + 1);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < W; y++) f[y] = g[y * W + x];
    edt1d(f, W, d, v, z);
    for (let y = 0; y < W; y++) g[y * W + x] = d[y];
  }
  for (let y = 0; y < W; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) f[x] = g[row + x];
    edt1d(f, W, d, v, z);
    for (let x = 0; x < W; x++) g[row + x] = d[x];
  }
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x, c = cov[i];
      out[i] = c >= 0.5 ? Math.max(0, Math.sqrt(g[(y + pad) * W + x + pad]) - 1.5 + c) : 0;
    }
  }
  return out;
}

/** Relief profile for a distance-into-the-shape field. */
function profileHeights(dist, p, symPx) {
  const out = new Float32Array(dist.length);
  if (p.profile === 'outline') {
    const w = Math.max(1, (0.015 + 0.16 * p.outline) * symPx);
    for (let i = 0; i < dist.length; i++) {
      const d = dist[i];
      out[i] = d <= 0 ? 0 : clamp01(d) * (1 - clamp01(d - w));
    }
    return out;
  }
  const R = Math.max(0.75, p.bevel * p.bevel * 0.5 * symPx + 0.75);
  const round = p.profile === 'round';
  for (let i = 0; i < dist.length; i++) {
    const x = Math.min(1, dist[i] / R);
    out[i] = round ? Math.sqrt(Math.max(0, 1 - (1 - x) * (1 - x))) : x;
  }
  return out;
}

// ── Generator entry points (proceduralWorker.js) ────────────────────────────

/** Per-row stage: symbols are drawn whole, so this is a no-op slice. */
export function symbolRows(params, size, y0, y1) {
  return { struct: new Float32Array(size * (y1 - y0)) };
}

export function symbolFinish(params, size) {
  const p = { ...DEFAULT_SYMBOL_PARAMS, ...params };
  const inst = layoutInstances(p, size);
  const wrap = p.layout !== 'single';
  const symPx = Math.max(...inst.map(i => i.s));
  const maxD = p.profile === 'outline' ? (0.02 + 0.16 * p.outline) * symPx + 4 : p.bevel * p.bevel * 0.5 * symPx + 4;

  const sym = profileHeights(insideDistance(coverage(p, size, inst, 'symbol'), size, wrap, maxD), p, symPx);
  let h = sym;
  if (p.frame === 'coin' || p.frame === 'stamp' || p.frame === 'tile') {
    // Symbol on (coin, tile) or sunk into (stamp) a raised plate.
    const plate = profileHeights(insideDistance(coverage(p, size, inst, 'plate'), size, wrap, symPx * 0.05 + 4),
      { ...p, profile: 'flat', bevel: Math.min(0.35, Math.max(0.12, p.bevel)) }, symPx * 0.2);
    h = new Float32Array(size * size);
    const sunk = p.frame === 'stamp';
    for (let i = 0; i < h.length; i++) {
      h[i] = sunk ? plate[i] * (1 - 0.75 * sym[i]) : lerp(0.45 * plate[i], 1, sym[i]);
    }
  }
  if (p.softness > 0) blurWrap(h, size, p.softness * size * 0.004);
  return h;
}
