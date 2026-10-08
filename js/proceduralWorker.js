/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Off-main-thread procedural heightmap generation (rocks, design patterns, water, symbols).
//   op 'full'    whole map in this worker → RGBA
//   op 'rows'    per-pixel stage for rows [y0, y1) → struct / grit slices
//   op 'finish'  whole-image stage over assembled slices → RGBA

import { heightsToRGBA } from './proceduralCore.js';
import { rockRows, rockFinish } from './rockGenerator.js';
import { designRows, designFinish } from './designGenerator.js';
import { waterRows, waterFinish } from './waterGenerator.js';
import { symbolRows, symbolFinish } from './symbolGenerator.js';
import { techRows, techFinish } from './techGenerator.js';
import { botanicRows, botanicFinish } from './botanicGenerator.js';

const ROWS   = { rock: rockRows,   design: designRows,   water: waterRows,   symbol: symbolRows,   tech: techRows,   botanic: botanicRows };
const FINISH = { rock: rockFinish, design: designFinish, water: waterFinish, symbol: symbolFinish, tech: techFinish, botanic: botanicFinish };

self.onmessage = (e) => {
  const { op = 'full', id, kind, params, size } = e.data;
  try {
    if (op === 'rows') {
      const { y0, y1 } = e.data;
      const { struct, grit } = ROWS[kind](params, size, y0, y1);
      self.postMessage({ id, y0, struct, grit }, grit ? [struct.buffer, grit.buffer] : [struct.buffer]);
      return;
    }
    let heights;
    if (op === 'finish') {
      heights = FINISH[kind](params, size, e.data.struct, e.data.grit);
    } else {
      const { struct, grit } = ROWS[kind](params, size, 0, size);
      heights = FINISH[kind](params, size, struct, grit);
    }
    const px = heightsToRGBA(heights);
    self.postMessage({ id, size, px }, [px.buffer]);
  } catch (err) {
    self.postMessage({ id, size, error: String(err && err.message || err) });
  }
};
