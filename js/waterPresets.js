/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Water, fluid, ice and air surfaces for the procedural water generator.
//   uses    the sliders that affect the surface (the rest are hidden)
//   labels  per-surface names for generic slots → i18n key water.label.<name>
//   ranges  per-surface slider spans (UI units) so the useful range fills the slider

const WAVES = ['scale', 'angle', 'spread', 'chop', 'crest', 'complexity', 'decay', 'detail', 'variation', 'softness'];
const WAVE_LABELS = { scale: 'swells', chop: 'choppiness', complexity: 'waveMix', decay: 'spectrum', detail: 'catsPaws', variation: 'patchiness' };
const SURF = ['scale', 'shoal', 'bunch', 'shore', 'width', 'turbulence', 'variation', 'detail', 'softness'];
const SURF_LABELS = { scale: 'waves', width: 'crestWidth', turbulence: 'wobble', variation: 'gaps', detail: 'whitewater' };
const RIPPLE = ['scale', 'angle', 'count', 'chop', 'asymmetry', 'turbulence', 'variation', 'softness'];
const RIPPLE_LABELS = { scale: 'ripples', count: 'forks', chop: 'crestSharp', turbulence: 'meander', variation: 'heightVar' };

export const WATER_TYPES = [
  // ── Still & open water ──
  { id: 'lake', name: 'Tranquil Lake', tileFrac: 0.5, uses: WAVES, labels: WAVE_LABELS,
    ranges: { scale: [1, 8] },
    params: { pattern: 'ocean', scale: 5, angle: 20, spread: 0.2, chop: 0.55, crest: 0.5, complexity: 0.25, decay: 0.7, detail: 0.3, variation: 0.85, softness: 0.05 } },
  { id: 'ocean', name: 'Open Ocean', tileFrac: 0.5, uses: WAVES, labels: WAVE_LABELS,
    ranges: { scale: [1, 12] },
    params: { pattern: 'ocean', scale: 6, angle: 0, spread: 0.15, chop: 0.9, crest: 0.65, complexity: 0.35, decay: 0.6, detail: 0.08, variation: 0.6, softness: 0.1 } },
  { id: 'groundswell', name: 'Groundswell', tileFrac: 0.5, uses: WAVES, labels: WAVE_LABELS,
    ranges: { scale: [1, 16] },
    params: { pattern: 'ocean', scale: 9, angle: 0, spread: 0.08, chop: 0.9, crest: 0.65, complexity: 0.12, decay: 0.6, detail: 0.05, variation: 0.4, softness: 0.03 } },
  { id: 'chop', name: 'Choppy Sea', tileFrac: 0.5, uses: WAVES, labels: WAVE_LABELS,
    ranges: { scale: [2, 20] },
    params: { pattern: 'ocean', scale: 7, angle: 30, spread: 0.35, chop: 0.92, crest: 0.6, complexity: 0.5, decay: 0.55, detail: 0.1, variation: 0.4, softness: 0.05 } },
  { id: 'surf', name: 'Surf Beach', tileFrac: 1, uses: SURF, labels: SURF_LABELS,
    ranges: { scale: [3, 40] },
    params: { pattern: 'surf', scale: 12, shoal: 0.6, bunch: 0.5, shore: 0.82, width: 0.35, turbulence: 0.35, variation: 0.55, detail: 0.35, softness: 0.04 } },
  { id: 'surfFib', name: 'Golden Sets', tileFrac: 1, uses: SURF, labels: SURF_LABELS,
    ranges: { scale: [3, 40] },
    params: { pattern: 'surf', scale: 9, shoal: 0.85, bunch: 0.5, shore: 1, width: 0.25, turbulence: 0.15, variation: 0, detail: 0, softness: 0.03 } },
  { id: 'rain', name: 'Raindrop Ripples', tileFrac: 0.6,
    uses: ['scale', 'count', 'rings', 'decay', 'variation', 'turbulence', 'softness'],
    labels: { scale: 'grid', count: 'drops', decay: 'ringTrail', variation: 'sizeVar', turbulence: 'wind' },
    ranges: { scale: [2, 16] },
    params: { pattern: 'rain', scale: 5, count: 0.55, rings: 0.45, decay: 0.45, variation: 0.8, turbulence: 0.15, softness: 0.1 } },
  { id: 'interference', name: 'Wave Interference', tileFrac: 0.7,
    uses: ['scale', 'count', 'decay', 'softness'],
    labels: { scale: 'wavelengths', count: 'sources', decay: 'reach' },
    ranges: { scale: [3, 40] },
    params: { pattern: 'interference', scale: 14, count: 0.3, decay: 0.85, softness: 0.05 } },
  // ── Coastal & tidal ──
  { id: 'tidal', name: 'Tidal Ripples', tileFrac: 0.4, uses: RIPPLE, labels: RIPPLE_LABELS,
    ranges: { scale: [3, 40] },
    params: { pattern: 'ripples', scale: 12, angle: 0, count: 0.45, chop: 0.55, asymmetry: 0.85, turbulence: 0.45, variation: 0.35, complexity: 0, softness: 0.15 } },
  { id: 'waveRipples', name: 'Oscillation Ripples', tileFrac: 0.4, uses: RIPPLE, labels: RIPPLE_LABELS,
    ranges: { scale: [3, 40] },
    params: { pattern: 'ripples', scale: 14, angle: 0, count: 0.7, chop: 0.8, asymmetry: 0.5, turbulence: 0.2, variation: 0.2, complexity: 0, softness: 0.12 } },
  { id: 'ladderback', name: 'Ladderback Ripples', tileFrac: 0.45,
    uses: [...RIPPLE, 'detail'], labels: { ...RIPPLE_LABELS, detail: 'ladder' },
    ranges: { scale: [3, 30] },
    params: { pattern: 'ladder', scale: 9, angle: 0, count: 0.3, chop: 0.5, asymmetry: 0.7, turbulence: 0.3, variation: 0.2, detail: 0.75, complexity: 0, softness: 0.15 } },
  { id: 'linguoid', name: 'Linguoid Ripples', tileFrac: 0.45,
    uses: [...RIPPLE, 'complexity', 'rings'], labels: { ...RIPPLE_LABELS, complexity: 'tongues', rings: 'lobes' },
    ranges: { scale: [3, 30] },
    params: { pattern: 'ripples', scale: 10, angle: 0, count: 0.25, chop: 0.6, asymmetry: 0.9, turbulence: 0.3, variation: 0.3, complexity: 0.7, rings: 0.4, softness: 0.15 } },
  { id: 'swash', name: 'Swash Marks', tileFrac: 0.6,
    uses: ['scale', 'angle', 'count', 'chop', 'width', 'asymmetry', 'turbulence', 'detail', 'softness'],
    labels: { scale: 'cusps', count: 'lines', chop: 'scallop', width: 'lineWidth', asymmetry: 'backwash', detail: 'rills' },
    ranges: { scale: [1, 12] },
    params: { pattern: 'swash', scale: 3, angle: 0, count: 0.55, chop: 0.6, width: 0.4, asymmetry: 0.6, turbulence: 0.4, detail: 0.25, softness: 0.12 } },
  // ── Fluvial & flow ──
  { id: 'braided', name: 'Braided River', tileFrac: 0.7,
    uses: ['scale', 'angle', 'count', 'chop', 'width', 'turbulence', 'detail', 'softness'],
    labels: { scale: 'bends', count: 'channels', chop: 'wander', width: 'channelWidth', detail: 'streaks' },
    ranges: { scale: [1, 8] },
    params: { pattern: 'braided', scale: 2, angle: 90, count: 0.6, chop: 0.6, width: 0.45, turbulence: 0.3, detail: 0.45, softness: 0.12 } },
  { id: 'meander', name: 'Meandering River', tileFrac: 0.8,
    uses: ['scale', 'angle', 'count', 'chop', 'width', 'rings', 'variation', 'detail', 'softness'],
    labels: { scale: 'meanders', count: 'channels', chop: 'sinuosity', width: 'channelWidth', rings: 'scrollBars', variation: 'oxbows', detail: 'floodplain' },
    ranges: { scale: [1, 8] },
    params: { pattern: 'meander', scale: 2, angle: 90, count: 0.5, chop: 0.8, width: 0.4, rings: 0.6, variation: 0.4, detail: 0.3, softness: 0.1 } },
  { id: 'vortexStreet', name: 'Vortex Street', tileFrac: 0.7,
    uses: ['scale', 'angle', 'count', 'chop', 'spread', 'decay', 'width', 'turbulence', 'softness'],
    labels: { scale: 'streamlines', count: 'vortices', chop: 'strength', spread: 'wakeWidth', decay: 'core', width: 'lineWidth' },
    ranges: { scale: [4, 60] },
    params: { pattern: 'vortexStreet', scale: 22, angle: 0, count: 0.3, chop: 0.45, spread: 0.5, decay: 0.3, width: 0.5, turbulence: 0.1, softness: 0.05 } },
  { id: 'eddies', name: 'Turbulent Eddies', tileFrac: 0.7,
    uses: ['scale', 'angle', 'count', 'chop', 'decay', 'width', 'turbulence', 'softness'],
    labels: { scale: 'streamlines', count: 'vortices', chop: 'strength', decay: 'core', width: 'lineWidth' },
    ranges: { scale: [4, 60] },
    params: { pattern: 'eddies', scale: 18, angle: 0, count: 0.35, chop: 0.4, decay: 0.3, width: 0.5, turbulence: 0.25, softness: 0.05 } },
  { id: 'suminagashi', name: 'Suminagashi', tileFrac: 0.7,
    uses: ['count', 'rings', 'width', 'turbulence', 'chop', 'scale', 'angle', 'variation', 'softness'],
    labels: { count: 'drops', width: 'lineWidth', turbulence: 'swirls', chop: 'combing', scale: 'tines', variation: 'sizeVar' },
    ranges: { scale: [1, 12] },
    params: { pattern: 'suminagashi', count: 0.3, rings: 0.55, width: 0.5, turbulence: 0.6, chop: 0.35, scale: 3, angle: 0, variation: 0.6, softness: 0.06 } },
  { id: 'caustics', name: 'Pool Caustics', tileFrac: 0.4,
    uses: ['scale', 'width', 'turbulence', 'detail', 'softness'],
    labels: { scale: 'cells', width: 'lineWidth', turbulence: 'warp', detail: 'secondLayer' },
    ranges: { scale: [2, 24] },
    params: { pattern: 'caustics', scale: 6, width: 0.15, turbulence: 0.9, detail: 0.6, softness: 0.08 } },
  // ── Ice ──
  { id: 'crackedIce', name: 'Cracked Ice', tileFrac: 0.5,
    uses: ['scale', 'width', 'variation', 'detail', 'turbulence', 'softness'],
    labels: { scale: 'plates', width: 'crackWidth', variation: 'tilt', detail: 'hairlines', turbulence: 'warp' },
    ranges: { scale: [2, 20] },
    params: { pattern: 'crackedIce', scale: 5, width: 0.35, variation: 0.6, detail: 0.6, turbulence: 0.4, softness: 0.04 } },
  { id: 'frost', name: 'Frost Ferns', tileFrac: 0.5,
    uses: ['count', 'variation', 'complexity', 'width', 'turbulence', 'detail', 'softness'],
    labels: { count: 'crystals', variation: 'reach', complexity: 'branching', width: 'thickness', turbulence: 'curl', detail: 'rime' },
    params: { pattern: 'frost', count: 0.65, variation: 0.75, complexity: 0.7, width: 0.5, turbulence: 0.25, detail: 0.08, softness: 0.03 } },
  { id: 'pancake', name: 'Pancake Ice', tileFrac: 0.5,
    uses: ['scale', 'variation', 'width', 'detail', 'softness'],
    labels: { scale: 'floes', variation: 'sizeVar', width: 'rim', detail: 'slush' },
    ranges: { scale: [2, 16] },
    params: { pattern: 'pancake', scale: 5, variation: 0.6, width: 0.4, detail: 0.5, softness: 0.15 } },
  { id: 'crevasse', name: 'Crevasse Field', tileFrac: 0.6,
    uses: ['scale', 'angle', 'count', 'width', 'turbulence', 'detail', 'softness'],
    labels: { scale: 'crevasses', count: 'continuity', width: 'opening', turbulence: 'curve', detail: 'windCrust' },
    ranges: { scale: [2, 24] },
    params: { pattern: 'crevasse', scale: 9, angle: 10, count: 0.95, width: 0.55, turbulence: 0.35, detail: 0.3, softness: 0.06 } },
  // ── Air ──
  { id: 'foam', name: 'Sea Foam', tileFrac: 0.4,
    uses: ['scale', 'variation', 'width', 'detail', 'softness'],
    labels: { scale: 'bubbles', variation: 'sizeVar', width: 'wall', detail: 'microFoam' },
    ranges: { scale: [2, 24] },
    params: { pattern: 'foam', scale: 7, variation: 0.8, width: 0.35, detail: 0.45, softness: 0.08 } },
  { id: 'raft', name: 'Bubble Raft', tileFrac: 0.35,
    uses: ['scale', 'variation', 'width', 'detail', 'softness'],
    labels: { scale: 'bubbles', variation: 'sizeVar', width: 'groove', detail: 'microFoam' },
    ranges: { scale: [2, 24] },
    params: { pattern: 'raft', scale: 8, variation: 0.75, width: 0.3, detail: 0.3, softness: 0.06 } },
  { id: 'beads', name: 'Water Beads', tileFrac: 0.35,
    uses: ['scale', 'count', 'variation', 'detail', 'softness'],
    labels: { scale: 'beads', count: 'coverage', variation: 'sizeVar', detail: 'mist' },
    ranges: { scale: [2, 30] },
    params: { pattern: 'beads', scale: 9, count: 0.75, variation: 0.6, detail: 0.6, softness: 0.05 } },
];

export const DEFAULT_WATER_TYPE = 'ocean';
export const waterTypeById = (id) => WATER_TYPES.find(t => t.id === id) || null;
