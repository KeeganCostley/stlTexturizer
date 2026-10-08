/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Botanical surfaces for the procedural botanic generator.
//   uses    the sliders that affect the surface (the rest are hidden)
//   labels  per-surface names for generic slots → i18n key botanic.label.<name>
//   ranges  per-surface slider spans (UI units)

const VINE = ['count', 'size', 'width', 'leaves', 'thorns', 'waviness', 'veins', 'variation', 'softness'];

export const BOTANIC_TYPES = [
  { id: 'rose', name: 'Single Rose', tileFrac: 0.45,
    uses: ['layout', 'count', 'size', 'width', 'leaves', 'thorns', 'petals', 'veins', 'variation', 'softness'],
    labels: { count: 'roses' }, ranges: { count: [1, 10] },
    params: { pattern: 'rose', layout: 'single', count: 3, size: 0.6, width: 0.45, leaves: 1, thorns: 0.5, petals: 0.6, veins: 0.5, variation: 0.3, softness: 0.01 } },
  { id: 'roseGarden', name: 'Rose Garden', tileFrac: 0.45,
    uses: ['count', 'size', 'petals', 'veins', 'variation', 'softness'],
    labels: { count: 'roses' }, ranges: { count: [1, 10] },
    params: { pattern: 'roseGarden', count: 3, size: 0.6, petals: 0.55, veins: 0.5, variation: 0.5, softness: 0.01 } },
  { id: 'roseVine', name: 'Thorned Rose Vine', tileFrac: 0.6,
    uses: [...VINE, 'flowers', 'petals'], labels: { count: 'vines' }, ranges: { count: [1, 8] },
    params: { pattern: 'roseVine', count: 2, size: 0.5, width: 0.45, leaves: 0.7, flowers: 0.45, thorns: 0.6, petals: 0.5, waviness: 0.5, veins: 0.5, variation: 0.4, softness: 0.01 } },
  { id: 'thornVine', name: 'Barbed Vine', tileFrac: 0.5,
    uses: VINE, labels: { count: 'vines' }, ranges: { count: [1, 10] },
    params: { pattern: 'thornVine', count: 3, size: 0.4, width: 0.5, leaves: 0.25, thorns: 0.85, waviness: 0.6, veins: 0.4, variation: 0.5, softness: 0.01 } },
  { id: 'bramble', name: 'Bramble', tileFrac: 0.6,
    uses: VINE, labels: { count: 'canes' }, ranges: { count: [1, 8] },
    params: { pattern: 'bramble', count: 2, size: 0.45, width: 0.55, leaves: 0.3, thorns: 0.8, waviness: 0.55, veins: 0.4, variation: 0.5, softness: 0.01 } },
  { id: 'ivy', name: 'Ivy Trail', tileFrac: 0.6,
    uses: ['count', 'size', 'width', 'leaves', 'waviness', 'veins', 'variation', 'softness'], labels: { count: 'vines' }, ranges: { count: [1, 8] },
    params: { pattern: 'ivy', count: 2, size: 0.5, width: 0.35, leaves: 0.85, waviness: 0.6, veins: 0.6, variation: 0.4, softness: 0.01 } },
  { id: 'fern', name: 'Fern Fronds', tileFrac: 0.6,
    uses: ['count', 'size', 'width', 'leaves', 'waviness', 'veins', 'variation', 'softness'], labels: { count: 'fronds' }, ranges: { count: [1, 8] },
    params: { pattern: 'fern', count: 3, size: 0.5, width: 0.3, leaves: 1, waviness: 0.25, veins: 0.3, variation: 0.2, softness: 0.01 } },
  { id: 'canopy', name: 'Leaf Canopy', tileFrac: 0.4,
    uses: ['count', 'size', 'veins', 'softness'], labels: { count: 'leaves' }, ranges: { count: [1, 12] },
    params: { pattern: 'canopy', count: 4, size: 0.5, veins: 0.6, softness: 0.01 } },
  { id: 'wreath', name: 'Rose Wreath', tileFrac: 0.6,
    uses: ['size', 'width', 'leaves', 'flowers', 'thorns', 'petals', 'veins', 'variation', 'softness'],
    labels: {}, ranges: {},
    params: { pattern: 'wreath', layout: 'single', size: 0.4, width: 0.4, leaves: 0.9, flowers: 0.35, thorns: 0.3, petals: 0.5, waviness: 0.5, veins: 0.5, variation: 0.3, softness: 0.01 } },
  { id: 'thornWreath', name: 'Thorn Crown', tileFrac: 0.6,
    uses: ['size', 'width', 'leaves', 'thorns', 'veins', 'variation', 'softness'],
    labels: {}, ranges: {},
    params: { pattern: 'wreath', layout: 'single', size: 0.35, width: 0.55, leaves: 0.15, flowers: 0, thorns: 0.95, waviness: 0.5, veins: 0.4, variation: 0.5, softness: 0.01 } },
];

export const DEFAULT_BOTANIC_TYPE = 'roseVine';
export const botanicTypeById = (id) => BOTANIC_TYPES.find(t => t.id === id) || null;
