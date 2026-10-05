/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Rock types for the procedural rock generator. Each entry overrides a subset
// of DEFAULT_ROCK_PARAMS (rockGenerator.js); the user then fine-tunes from
// there. `tileFrac` is the suggested tile size as a fraction of the model's
// largest bounding-box edge (same convention as the image presets' defaultScale).
//
// The line-up leans hard, angular and faceted: rocks that cleave, split and
// shatter along planes rather than erode into rounded forms.

export const ROCK_TYPES = [
  // ── Faceted / shattered ──
  {
    id: 'lowpoly', name: 'Low-Poly Boulder', tileFrac: 0.7,
    params: { shape: 'shard', grainSize: 0.252, grainRelief: 1, irregularity: 0.7, facetSteepness: 0.08,
              roughness: 0, form: 0.12 },
  },
  {
    id: 'crag', name: 'Faceted Crag', tileFrac: 0.6,
    params: { sizeVariation: 0.6, mergeGrains: 0.25, splitGrains: 0.35, shape: 'facet', grainSize: 0.198, grainRelief: 1, irregularity: 0.75, facetSteepness: 0.75,
              subFacets: 0.25, cracks: 0.18, crackSpacing: 0.4, crackWidth: 0.15,
              roughness: 0.1, roughScale: 0.3, roughJag: 0.6, form: 0.12 },
  },
  {
    id: 'shattered', name: 'Shattered Stone', tileFrac: 0.55,
    params: { sizeVariation: 0.7, mergeGrains: 0.25, splitGrains: 0.55, shape: 'facet', grainSize: 0.222, grainRelief: 1, irregularity: 0.85, facetSteepness: 0.85,
              subFacets: 0.5, cracks: 0.2, crackSpacing: 0.45, crackWidth: 0.1,
              roughness: 0.14, roughScale: 0.25, roughJag: 0.85, form: 0.15 },
  },
  {
    id: 'shards', name: 'Shard Field', tileFrac: 0.5,
    params: { shape: 'shard', grainSize: 0.186, grainRelief: 1, irregularity: 0.8, facetSteepness: 0.6,
              subFacets: 0.25, roughness: 0.08, roughScale: 0.2, roughJag: 0.7, form: 0.1 },
  },
  {
    id: 'alpine', name: 'Alpine Ridge', tileFrac: 0.7,
    params: { shape: 'shard', grainSize: 0.246, grainRelief: 1, irregularity: 0.8, facetSteepness: 0.35,
              cleavage: 0.5, cleavageAngle: 35, subFacets: 0.5, terraces: 0.3, terraceCount: 7,
              roughness: 0.1, roughScale: 0.3, roughJag: 0.9, form: 0.35 },
  },
  {
    id: 'scree', name: 'Scree', tileFrac: 0.4,
    params: { sizeVariation: 0.8, mergeGrains: 0.1, splitGrains: 0.5, shape: 'facet', grainSize: 0.114, grainRelief: 1, irregularity: 1, facetSteepness: 0.8,
              gapDepth: 0.35, gapWidth: 0.1, roughness: 0.1, roughScale: 0.15, roughJag: 0.6, form: 0.1 },
  },
  // ── Cleaved / split along a grain ──
  {
    id: 'ledges', name: 'Cleaved Ledges', tileFrac: 0.6,
    params: { shape: 'facet', grainSize: 0.216, grainRelief: 1, irregularity: 0.7, facetSteepness: 0.5,
              cleavage: 0.7, cleavageAngle: 0, subFacets: 0.3, terraces: 0.75, terraceCount: 9,
              roughness: 0.06, roughJag: 0.6, form: 0.2 },
  },
  {
    id: 'schist', name: 'Schist', tileFrac: 0.5,
    params: { shape: 'facet', grainSize: 0.156, grainRelief: 1, irregularity: 0.7, facetSteepness: 0.45,
              cleavage: 0.7, cleavageAngle: 15, elongation: 0.8, subFacets: 0.45,
              layers: 0.2, layerCount: 20, layerAngle: 15, layerSharpness: 0.8, layerWaviness: 0.15,
              roughness: 0.15, roughScale: 0.15, roughJag: 0.5, form: 0.1 },
  },
  {
    // Fine, glittery mica sheets that peel into overlapping flakes.
    id: 'micaSchist', name: 'Mica Schist', tileFrac: 0.45,
    params: { shape: 'facet', grainSize: 0.1, grainRelief: 0.18, irregularity: 0.7, facetSteepness: 0.35,
              cleavage: 0.8, cleavageAngle: 8, elongation: 0.9, subFacets: 0.2,
              layers: 1, layerCount: 26, layerAngle: 8, layerSharpness: 0.85, layerWaviness: 0.35,
              flakiness: 0.7, flakeSize: 0.45, crenulation: 0.15, crenCount: 5,
              roughness: 0.12, roughScale: 0.08, roughJag: 0.6, form: 0.12 },
  },
  {
    // Mica schist studded with faceted garnet crystals; the foliation wraps around them.
    id: 'garnetSchist', name: 'Garnet Schist', tileFrac: 0.45,
    params: { shape: 'facet', grainSize: 0.09, grainRelief: 0.12, irregularity: 0.7, facetSteepness: 0.35,
              cleavage: 0.8, cleavageAngle: 5, elongation: 0.8, subFacets: 0.15,
              layers: 0.9, layerCount: 24, layerAngle: 5, layerSharpness: 0.75, layerWaviness: 0.3,
              flakiness: 0.4, flakeSize: 0.5,
              porphyro: 0.9, porphyroSize: 0.45, porphyroDensity: 0.35, porphyroElong: 0, deflection: 0.8,
              roughness: 0.1, roughScale: 0.08, roughJag: 0.5, form: 0.1 },
  },
  {
    // Foliation crumpled into tight, sharp kink folds (crenulation cleavage).
    id: 'crenulatedSchist', name: 'Crenulated Schist', tileFrac: 0.45,
    params: { shape: 'facet', grainSize: 0.1, grainRelief: 0.25, irregularity: 0.6, facetSteepness: 0.3,
              cleavage: 0.6, cleavageAngle: 0, elongation: 0.6,
              layers: 1, layerCount: 22, layerAngle: 0, layerSharpness: 0.8, layerWaviness: 0.1,
              crenulation: 0.95, crenCount: 7, flakiness: 0.3, flakeSize: 0.35,
              roughness: 0.1, roughScale: 0.1, roughJag: 0.6, form: 0.1 },
  },
  {
    // Long bladed kyanite crystals lying in the foliation plane.
    id: 'kyaniteSchist', name: 'Kyanite Schist', tileFrac: 0.5,
    params: { shape: 'facet', grainSize: 0.1, grainRelief: 0.3, irregularity: 0.7, facetSteepness: 0.35,
              cleavage: 0.7, cleavageAngle: 20, elongation: 0.8, subFacets: 0.2,
              layers: 0.8, layerCount: 20, layerAngle: 20, layerSharpness: 0.7, layerWaviness: 0.35,
              flakiness: 0.3, flakeSize: 0.5,
              porphyro: 0.85, porphyroSize: 0.55, porphyroDensity: 0.45, porphyroElong: 0.85, deflection: 0.5,
              roughness: 0.1, roughScale: 0.1, roughJag: 0.5, form: 0.12 },
  },
  {
    // Greenschist: dense, fine, platy foliation with a satin-smooth wave.
    id: 'greenschist', name: 'Greenschist', tileFrac: 0.45,
    params: { shape: 'facet', grainSize: 0.06, grainRelief: 0.2, irregularity: 0.6, facetSteepness: 0.25,
              cleavage: 0.9, cleavageAngle: -6, elongation: 0.9,
              layers: 1, layerCount: 30, layerAngle: -12, layerSharpness: 0.6, layerWaviness: 0.9,
              flakiness: 0.25, flakeSize: 0.3, crenulation: 0.25, crenCount: 3,
              roughness: 0.06, roughScale: 0.05, roughJag: 0.3, form: 0.2, weathering: 0.05 },
  },
  {
    id: 'slate', name: 'Slate', tileFrac: 0.5,
    params: { shape: 'none', layers: 1, layerCount: 16, layerAngle: 3, layerWaviness: 0.08, layerSharpness: 0.92,
              cracks: 0.22, crackSpacing: 0.2, crackWidth: 0.12,
              roughness: 0.1, roughScale: 0.1, roughJag: 0.3, form: 0.12 },
  },
  {
    id: 'shale', name: 'Shale', tileFrac: 0.45,
    params: { shape: 'none', layers: 0.9, layerCount: 32, layerAngle: -4, layerWaviness: 0.25, layerSharpness: 0.8,
              cracks: 0.35, crackSpacing: 0.55, crackWidth: 0.12,
              roughness: 0.2, roughScale: 0.2, roughJag: 0.4, form: 0.15, weathering: 0.1 },
  },
  {
    id: 'chiselled', name: 'Chiselled Stone', tileFrac: 0.4,
    params: { shape: 'facet', grainSize: 0.096, grainRelief: 1, irregularity: 0.6, facetSteepness: 0.5,
              cleavage: 0.9, cleavageAngle: 45, elongation: 0.5,
              roughness: 0.08, roughScale: 0.2, roughJag: 0.4, form: 0.1 },
  },
  {
    id: 'splitface', name: 'Split-Face Block', tileFrac: 0.6,
    params: { shape: 'block', grainSize: 0.258, grainRelief: 1, irregularity: 0.45, facetSteepness: 0.6,
              gapDepth: 0.6, gapWidth: 0.12, subFacets: 0.5,
              roughness: 0.12, roughScale: 0.2, roughJag: 0.6, form: 0.05 },
  },
  // ── Crystalline ──
  {
    id: 'quartz', name: 'Quartz Cluster', tileFrac: 0.4,
    params: { shape: 'shard', grainSize: 0.138, grainRelief: 1, irregularity: 0.6, facetSteepness: 0.9,
              cleavage: 0.2, cleavageAngle: 70, elongation: 0.6, roughness: 0.02, form: 0.15 },
  },
  {
    id: 'druse', name: 'Geode Druse', tileFrac: 0.35,
    params: { shape: 'shard', grainSize: 0.066, grainRelief: 1, irregularity: 0.9, facetSteepness: 1,
              roughness: 0.02, form: 0.5 },
  },
  {
    id: 'basalt', name: 'Basalt Columns', tileFrac: 0.5,
    params: { shape: 'column', sizeVariation: 0.15, mergeGrains: 0, splitGrains: 0.05, grainSize: 0.222, grainRelief: 0.35, irregularity: 0.35,
              gapDepth: 0.75, gapWidth: 0.1, cracks: 0.22, crackSpacing: 0.35, crackWidth: 0.1,
              roughness: 0.15, roughScale: 0.25, roughJag: 0.5, form: 0.05, weathering: 0.05 },
  },
  {
    id: 'granite', name: 'Granite', tileFrac: 0.35,
    params: { shape: 'crystalline', grainSize: 0.108, grainRelief: 0.75, irregularity: 0.6, facetSteepness: 0.5,
              gapDepth: 0.1, gapWidth: 0.08, cracks: 0.12, crackSpacing: 0.2, crackWidth: 0.12,
              roughness: 0.22, roughScale: 0.15, roughJag: 0.4, form: 0.15, weathering: 0.05 },
  },
  // ── Conchoidal ──
  {
    id: 'flint', name: 'Knapped Flint', tileFrac: 0.4,
    params: { shape: 'scallop', grainSize: 0.174, grainRelief: 1, irregularity: 0.85,
              roughness: 0.03, roughScale: 0.1, form: 0.2, weathering: 0.05 },
  },
  {
    id: 'obsidian', name: 'Obsidian', tileFrac: 0.6,
    params: { shape: 'scallop', grainSize: 0.24, grainRelief: 1, irregularity: 0.9,
              cracks: 0.15, crackSpacing: 0.3, crackWidth: 0.06, roughness: 0, form: 0.25, weathering: 0.02 },
  },
];

export const DEFAULT_ROCK_TYPE = 'crag';

export function rockTypeById(id) {
  return ROCK_TYPES.find(r => r.id === id) || null;
}
