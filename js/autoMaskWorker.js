/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Exposure for one range of faces (see autoMask.js). Each worker builds its
// own BVH from the transferred positions — cheap next to the ray casting.

import { buildBVH, computeExposure } from './autoMask.js';

self.onmessage = (e) => {
  const { pos, f0, f1, nRays, eps } = e.data;
  try {
    const bvh = buildBVH(pos);
    const exposure = computeExposure(bvh, f0, f1, nRays, eps);
    self.postMessage({ f0, exposure }, [exposure.buffer]);
  } catch (err) {
    self.postMessage({ f0, error: String(err && err.message || err) });
  }
};
