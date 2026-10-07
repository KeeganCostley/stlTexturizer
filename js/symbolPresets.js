/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Symbol catalogue for the procedural symbol generator (symbolGenerator.js
// draws each id). Every type is one symbol; layout, relief profile and frame
// are shared sliders. `cat` groups symbols for the Mix slider.

export const SYMBOL_CATALOGUE = [
  // ── Faces & emoji ──
  { id: 'smiley',    name: 'Smiley',          cat: 'emoji' },
  { id: 'wink',      name: 'Wink',            cat: 'emoji' },
  { id: 'grin',      name: 'Big Grin',        cat: 'emoji' },
  { id: 'heart',     name: 'Heart',           cat: 'emoji' },
  { id: 'star',      name: 'Star',            cat: 'emoji' },
  { id: 'sparkle',   name: 'Sparkle',         cat: 'emoji' },
  { id: 'bolt',      name: 'Lightning',       cat: 'emoji' },
  { id: 'flame',     name: 'Flame',           cat: 'emoji' },
  { id: 'ghost',     name: 'Ghost',           cat: 'emoji' },
  { id: 'cat',       name: 'Cat',             cat: 'emoji' },
  { id: 'skull',     name: 'Skull',           cat: 'emoji' },
  { id: 'paw',       name: 'Paw Print',       cat: 'emoji' },
  // ── Signs ──
  { id: 'warning',   name: 'Warning',         cat: 'signs' },
  { id: 'radiation', name: 'Radiation',       cat: 'signs' },
  { id: 'cycle',     name: 'Cycle Arrows',    cat: 'signs' },
  { id: 'power',     name: 'Power',           cat: 'signs' },
  { id: 'wifi',      name: 'Wi-Fi',           cat: 'signs' },
  { id: 'check',     name: 'Check',           cat: 'signs' },
  { id: 'cross',     name: 'Cross',           cat: 'signs' },
  { id: 'plus',      name: 'Plus',            cat: 'signs' },
  { id: 'arrow',     name: 'Arrow',           cat: 'signs' },
  { id: 'nosign',    name: 'Prohibited',      cat: 'signs' },
  { id: 'pin',       name: 'Location Pin',    cat: 'signs' },
  { id: 'peace',     name: 'Peace',           cat: 'signs' },
  { id: 'infinity',  name: 'Infinity',        cat: 'signs' },
  { id: 'yinyang',   name: 'Yin Yang',        cat: 'signs' },
  // ── Ancient & esoteric ──
  { id: 'ankh',      name: 'Ankh',            cat: 'ancient' },
  { id: 'triskele',  name: 'Triskele',        cat: 'ancient' },
  { id: 'spiral',    name: 'Spiral',          cat: 'ancient' },
  { id: 'rings',     name: 'Trinity Rings',   cat: 'ancient' },
  { id: 'hexagram',  name: 'Hexagram',        cat: 'ancient' },
  { id: 'pentacle',  name: 'Pentacle',        cat: 'ancient' },
  { id: 'eye',       name: 'All-Seeing Eye',  cat: 'ancient' },
  { id: 'suncross',  name: 'Sun Cross',       cat: 'ancient' },
  { id: 'enso',      name: 'Ensō',            cat: 'ancient' },
  { id: 'compass',   name: 'Compass Rose',    cat: 'ancient' },
  { id: 'fleur',     name: 'Fleur-de-lis',    cat: 'ancient' },
  { id: 'rosette',   name: 'Rosette',         cat: 'ancient' },
  // ── Modern & objects ──
  { id: 'gear',      name: 'Gear',            cat: 'modern' },
  { id: 'nut',       name: 'Hex Nut',         cat: 'modern' },
  { id: 'padlock',   name: 'Padlock',         cat: 'modern' },
  { id: 'key',       name: 'Key',             cat: 'modern' },
  { id: 'globe',     name: 'Globe',           cat: 'modern' },
  { id: 'planet',    name: 'Ringed Planet',   cat: 'modern' },
  { id: 'crown',     name: 'Crown',           cat: 'modern' },
  { id: 'anchor',    name: 'Anchor',          cat: 'modern' },
  { id: 'notes',     name: 'Music Notes',     cat: 'modern' },
  { id: 'dice',      name: 'Dice',            cat: 'modern' },
  { id: 'bubble',    name: 'Speech Bubble',   cat: 'modern' },
  // ── Nature ──
  { id: 'sun',       name: 'Sun',             cat: 'nature' },
  { id: 'moon',      name: 'Crescent Moon',   cat: 'nature' },
  { id: 'leaf',      name: 'Leaf',            cat: 'nature' },
  { id: 'flower',    name: 'Flower',          cat: 'nature' },
  { id: 'snowflake', name: 'Snowflake',       cat: 'nature' },
  { id: 'mountain',  name: 'Mountains',       cat: 'nature' },
];

export const SYMBOL_IDS = SYMBOL_CATALOGUE.map(s => s.id);

export const SYMBOL_TYPES = SYMBOL_CATALOGUE.map(s => ({
  id: s.id, name: s.name, tileFrac: 0.4, params: { symbol: s.id },
}));

export const DEFAULT_SYMBOL_TYPE = 'smiley';
export const symbolTypeById = (id) => SYMBOL_TYPES.find(t => t.id === id) || null;
