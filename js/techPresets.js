/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Industrial & technical surfaces for the procedural tech generator.
//   uses    the sliders that affect the surface (the rest are hidden)
//   labels  per-surface names for generic slots → i18n key tech.label.<name>
//   ranges  per-surface slider spans (UI units)

const T = (id, name, tileFrac, uses, labels, ranges, params) => ({ id, name, tileFrac, uses, labels, ranges, params });
const S = 'softness';

export const TECH_TYPES = [
  // ── Electronics ──
  T('pcb', 'Circuit Board', 0.6, ['scale', 'width', 'density', 'detail', 'bevel', S],
    { scale: 'boardDensity', width: 'traceWidth', density: 'traces', detail: 'components' }, { scale: [1, 16] },
    { pattern: 'pcb', scale: 4, width: 0.45, density: 0.55, detail: 0.5, bevel: 0.15, softness: 0 }),
  T('pcbOrtho', 'Orthogonal Traces', 0.6, ['scale', 'width', 'density', 'detail', 'bevel', S],
    { scale: 'boardDensity', width: 'traceWidth', density: 'traces', detail: 'components' }, { scale: [1, 16] },
    { pattern: 'pcbOrtho', scale: 5, width: 0.4, density: 0.7, detail: 0.35, bevel: 0.15, softness: 0 }),
  T('pcbPour', 'Ground Pour', 0.6, ['scale', 'width', 'density', 'detail', 'bevel', S],
    { scale: 'boardDensity', width: 'traceWidth', density: 'traces', detail: 'components' }, { scale: [1, 16] },
    { pattern: 'pcbPour', scale: 4, width: 0.5, density: 0.45, detail: 0.5, bevel: 0.15, softness: 0 }),
  T('chip', 'Chip Fan-out', 0.5, ['width', 'density', 'detail', 'variation', 'bevel', S],
    { width: 'padWidth', density: 'pins', detail: 'vias', variation: 'fanSpread' }, {},
    { pattern: 'chip', scale: 1, width: 0.5, density: 0.5, detail: 0.6, variation: 0.3, bevel: 0.12, softness: 0 }),
  T('inductor', 'Coil Inductors', 0.4, ['scale', 'width', 'density', S],
    { scale: 'coils', width: 'traceWidth', density: 'turns' }, { scale: [1, 12] },
    { pattern: 'inductor', scale: 3, width: 0.5, density: 0.5, softness: 0.01 }),
  T('breadboard', 'Breadboard', 0.6, ['scale', 'width', 'bevel', S],
    { scale: 'columns', width: 'holeSize' }, { scale: [1, 8] },
    { pattern: 'breadboard', scale: 2, width: 0.5, bevel: 0.3, softness: 0.01 }),

  // ── Metal fabrication ──
  T('diamondPlate', 'Diamond Plate', 0.3, ['scale', 'width', 'density', 'bevel', S],
    { scale: 'lugs', width: 'lugWidth', density: 'lugLength', bevel: 'rounding' }, { scale: [2, 30] },
    { pattern: 'diamondPlate', scale: 8, width: 0.65, density: 0.75, bevel: 0.35, softness: 0.02 }),
  T('fiveBar', 'Five-Bar Tread', 0.3, ['scale', 'width', 'density', 'bevel', S],
    { scale: 'lugs', width: 'barWidth', density: 'barLength', bevel: 'rounding' }, { scale: [2, 24] },
    { pattern: 'fiveBar', scale: 6, width: 0.5, density: 0.5, bevel: 0.4, softness: 0.02 }),
  T('perforated', 'Perforated Sheet', 0.3, ['scale', 'width', 'bevel', 'shape', S],
    { scale: 'holes', width: 'holeSize', bevel: 'countersink' }, { scale: [2, 40] },
    { pattern: 'perforated', shape: 'round', scale: 12, width: 0.55, bevel: 0.3, softness: 0.01 }),
  T('hexPerf', 'Hex Perforation', 0.3, ['scale', 'width', 'bevel', 'shape', S],
    { scale: 'holes', width: 'holeSize', bevel: 'countersink' }, { scale: [2, 40] },
    { pattern: 'perforated', shape: 'hex', scale: 12, width: 0.7, bevel: 0.2, softness: 0.01 }),
  T('slotPerf', 'Slotted Sheet', 0.3, ['scale', 'width', 'density', 'bevel', 'shape', S],
    { scale: 'holes', width: 'holeSize', density: 'slotLength', bevel: 'countersink' }, { scale: [2, 30] },
    { pattern: 'perforated', shape: 'slot', scale: 8, width: 0.55, density: 0.6, bevel: 0.25, softness: 0.01 }),
  T('expanded', 'Expanded Metal', 0.3, ['scale', 'width', 'bevel', S],
    { scale: 'diamonds', width: 'strandWidth' }, { scale: [2, 30] },
    { pattern: 'expanded', scale: 8, width: 0.45, bevel: 0.25, softness: 0.01 }),
  T('knurl', 'Diamond Knurl', 0.2, ['scale', 'width', S],
    { scale: 'teeth', width: 'flatTops' }, { scale: [4, 80] },
    { pattern: 'knurl', scale: 24, width: 0.1, softness: 0.01 }),
  T('straightKnurl', 'Straight Knurl', 0.2, ['scale', 'width', S],
    { scale: 'teeth', width: 'flatTops' }, { scale: [4, 80] },
    { pattern: 'straightKnurl', scale: 30, width: 0.1, softness: 0.01 }),
  T('weld', 'Weld Beads', 0.4, ['scale', 'width', 'detail', 'variation', 'density', S],
    { scale: 'beads', width: 'beadWidth', detail: 'ripples', variation: 'wander', density: 'spatter' }, { scale: [1, 16] },
    { pattern: 'weld', scale: 4, width: 0.5, detail: 0.5, variation: 0.4, density: 0.4, softness: 0.02 }),
  T('perlage', 'Engine Turning', 0.3, ['scale', 'width', 'detail', 'variation', S],
    { scale: 'spots', width: 'overlap', detail: 'rings', variation: 'jitter' }, { scale: [2, 30] },
    { pattern: 'perlage', scale: 8, width: 0.5, detail: 0.5, variation: 0.1, softness: 0.01 }),
  T('faceMill', 'Face Milling', 0.5, ['scale', 'width', 'detail', 'variation', S],
    { scale: 'passes', width: 'cutterSize', detail: 'feedMarks', variation: 'passSteps' }, { scale: [1, 12] },
    { pattern: 'faceMill', scale: 3, width: 0.5, detail: 0.5, variation: 0.3, softness: 0.01 }),
  T('brushed', 'Brushed Steel', 0.5, ['scale', 'detail', S],
    { scale: 'grain', detail: 'scratches' }, { scale: [1, 20] },
    { pattern: 'brushed', scale: 4, detail: 0.4, softness: 0 }),

  // ── Mesh & grating ──
  T('woven', 'Woven Wire Cloth', 0.25, ['scale', 'width', S],
    { scale: 'wires', width: 'wireSize' }, { scale: [2, 40] },
    { pattern: 'woven', scale: 10, width: 0.5, softness: 0.01 }),
  T('welded', 'Welded Mesh', 0.35, ['scale', 'width', 'detail', S],
    { scale: 'wires', width: 'wireSize', detail: 'welds' }, { scale: [2, 30] },
    { pattern: 'welded', scale: 6, width: 0.45, detail: 0.5, softness: 0.01 }),
  T('grating', 'Bar Grating', 0.4, ['scale', 'width', 'density', 'variation', 'bevel', S],
    { scale: 'bars', width: 'barWidth', density: 'crossBars', variation: 'serration' }, { scale: [3, 40] },
    { pattern: 'grating', scale: 14, width: 0.4, density: 0.5, variation: 0.6, bevel: 0.15, softness: 0.01 }),
  T('chainLink', 'Chain Link', 0.35, ['scale', 'width', S],
    { scale: 'wires', width: 'wireSize' }, { scale: [2, 30] },
    { pattern: 'chainLink', scale: 8, width: 0.5, softness: 0.01 }),
  T('honeycomb', 'Honeycomb', 0.3, ['scale', 'width', 'bevel', S],
    { scale: 'cells', width: 'wallWidth' }, { scale: [2, 40] },
    { pattern: 'honeycomb', scale: 10, width: 0.35, bevel: 0.2, softness: 0.01 }),

  // ── Structural & building ──
  T('isogrid', 'Isogrid', 0.5, ['scale', 'width', 'bevel', 'detail', S],
    { scale: 'cells', width: 'ribWidth', bevel: 'fillets', detail: 'nodes' }, { scale: [1, 20] },
    { pattern: 'isogrid', scale: 4, width: 0.45, bevel: 0.4, detail: 0.7, softness: 0.01 }),
  T('orthogrid', 'Orthogrid', 0.5, ['scale', 'width', 'bevel', 'detail', S],
    { scale: 'cells', width: 'ribWidth', bevel: 'fillets', detail: 'nodes' }, { scale: [1, 20] },
    { pattern: 'orthogrid', scale: 4, width: 0.45, bevel: 0.4, detail: 0.5, softness: 0.01 }),
  T('rivets', 'Riveted Plates', 0.6, ['scale', 'width', 'density', 'variation', 'bevel', S],
    { scale: 'plates', width: 'rivetSize', density: 'rivets', variation: 'plateLevels' }, { scale: [1, 10] },
    { pattern: 'rivets', scale: 3, width: 0.5, density: 0.4, variation: 0.5, bevel: 0.3, softness: 0.01 }),
  T('corrugated', 'Corrugated Sheet', 0.4, ['scale', 'width', S],
    { scale: 'ribs', width: 'crestSharp' }, { scale: [2, 40] },
    { pattern: 'corrugated', shape: 'round', scale: 10, width: 0.2, softness: 0.01 }),
  T('roofing', 'Trapezoidal Roofing', 0.5, ['scale', 'width', 'bevel', 'detail', S],
    { scale: 'ribs', width: 'ribWidth', bevel: 'ribSlope', detail: 'panRibs' }, { scale: [1, 20] },
    { pattern: 'corrugated', shape: 'square', scale: 4, width: 0.35, bevel: 0.4, detail: 0.6, softness: 0.01 }),
  T('louvres', 'Louvre Vents', 0.4, ['scale', 'width', 'density', S],
    { scale: 'columns', width: 'slotLength', density: 'rows' }, { scale: [1, 12] },
    { pattern: 'louvres', scale: 3, width: 0.6, density: 0.4, softness: 0.015 }),
  T('fins', 'Heat Sink Fins', 0.4, ['scale', 'width', 'detail', 'bevel', S],
    { scale: 'fins', width: 'finWidth', detail: 'crossCuts' }, { scale: [2, 40] },
    { pattern: 'fins', scale: 12, width: 0.3, detail: 0, bevel: 0.1, softness: 0.01 }),
  T('pins', 'Pin Fins', 0.35, ['scale', 'width', 'bevel', 'shape', S],
    { scale: 'pins', width: 'pinSize' }, { scale: [2, 40] },
    { pattern: 'pins', shape: 'square', scale: 10, width: 0.45, bevel: 0.15, softness: 0.01 }),
  T('studs', 'Stud Flooring', 0.3, ['scale', 'width', 'bevel', S],
    { scale: 'studs', width: 'studSize' }, { scale: [2, 30] },
    { pattern: 'studs', scale: 8, width: 0.5, bevel: 0.25, softness: 0.01 }),
  T('panels', 'Hull Panels', 0.7, ['scale', 'width', 'density', 'detail', 'variation', 'bevel', S],
    { scale: 'panelSize', width: 'seams', density: 'subdivision', detail: 'greebles', variation: 'levels' }, { scale: [1, 8] },
    { pattern: 'panels', scale: 3, width: 0.4, density: 0.6, detail: 0.6, variation: 0.5, bevel: 0.15, softness: 0 }),
];

export const DEFAULT_TECH_TYPE = 'pcb';
export const techTypeById = (id) => TECH_TYPES.find(t => t.id === id) || null;
