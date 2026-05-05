// Parametric symbol template registry
// Templates describe parameter schemas and a render() function emitting
// draw commands. The annotation rendering layer (see js/annotations/rendering.js
// case 'parametricSymbol') walks those commands to draw on the canvas.

import { doorTemplate } from './templates/door.js';
import { windowTemplate } from './templates/window.js';
import { stairsTemplate } from './templates/stairs.js';
import { northTemplate } from './templates/north.js';

const templates = new Map();

function register(t) {
  templates.set(t.id, t);
}

register(doorTemplate);
register(windowTemplate);
register(stairsTemplate);
register(northTemplate);

export function getTemplate(id) {
  return templates.get(id) || null;
}

export function listTemplates(category) {
  const all = [...templates.values()];
  if (!category) return all;
  return all.filter(t => t.category === category);
}

export function defaultParams(template) {
  if (!template || !Array.isArray(template.params)) return {};
  const out = {};
  for (const p of template.params) {
    out[p.key] = p.default;
  }
  return out;
}

export function listCategories() {
  const cats = new Set();
  for (const t of templates.values()) cats.add(t.category);
  return [...cats];
}
