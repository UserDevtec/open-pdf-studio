// Hatch / fill pattern catalog and renderer.
//
// Patterns are defined as a list of "line families". A line family is a
// repeating set of parallel (and optionally dashed / staggered) lines that,
// when combined, produce the final hatch. This format is ported from
// open-2d-studio (src/types/hatch.ts) so pattern IDs round-trip across both
// projects (open-2d-studio and open-pdf-studio share the OpenAEC standards).
//
// A line family with dashPattern containing 0 is rendered as a grid of dots
// instead of dashed lines. An empty lineFamilies array means "solid fill"
// (uses hatchColor as a flat fill).

// ---------------------------------------------------------------------------
// Pattern catalog (categories: basic / hatching / material / geometric / nen47)
// Names mirror open-2d-studio so the picker is consistent across both apps.
// ---------------------------------------------------------------------------

export const HATCH_CATEGORIES = ['basic', 'hatching', 'material', 'geometric', 'nen47'];

export const BUILTIN_HATCH_PATTERNS = [
  // ---- basic ----
  { id: 'horizontal',     category: 'basic', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'vertical',       category: 'basic', lineFamilies: [
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'grid',           category: 'basic', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'solid',          category: 'basic', lineFamilies: [] },

  // ---- hatching ----
  // Aliases keep backward compat with existing data: diagonal-left == diagonal,
  // diagonal-right == reverse-diagonal.
  { id: 'diagonal-left',  category: 'hatching', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'diagonal-right', category: 'hatching', lineFamilies: [
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'crosshatch',     category: 'hatching', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'dots',           category: 'hatching', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [0] },
  ]},

  // ---- material ----
  { id: 'concrete',       category: 'material', lineFamilies: [
    { angle: 37,  originX: 0, originY: 0, deltaX: 3, deltaY: 8,  dashPattern: [0] },
    { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 12, dashPattern: [0] },
    { angle: 70,  originX: 2, originY: 7, deltaX: 7, deltaY: 10, dashPattern: [0] },
  ]},
  { id: 'brick-running',  category: 'material', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0,  deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 20, deltaY: 20, dashPattern: [10, -10] },
  ]},
  { id: 'brick-stack',    category: 'material', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 20, dashPattern: [10, -10] },
  ]},
  { id: 'insulation',     category: 'material', lineFamilies: [
    { angle: 60,  originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
  ]},
  { id: 'earth',          category: 'material', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 12, dashPattern: [6, -3, 2, -3] },
    { angle: 0,  originX: 0, originY: 0, deltaX: 6, deltaY: 10, dashPattern: [0] },
  ]},
  { id: 'sand',           category: 'material', lineFamilies: [
    { angle: 0,   originX: 0, originY: 0, deltaX: 6, deltaY: 6, dashPattern: [0] },
    { angle: 60,  originX: 3, originY: 2, deltaX: 6, deltaY: 8, dashPattern: [0] },
    { angle: 120, originX: 1, originY: 4, deltaX: 8, deltaY: 7, dashPattern: [0] },
  ]},
  { id: 'gravel',         category: 'material', lineFamilies: [
    { angle: 30,  originX: 0, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [3, -5] },
    { angle: -30, originX: 6, originY: 0, deltaX: 4, deltaY: 12, dashPattern: [2, -6] },
    { angle: 80,  originX: 2, originY: 4, deltaX: 6, deltaY: 10, dashPattern: [0] },
  ]},
  { id: 'water',          category: 'material', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 8 },
    { angle: 0, originX: 0, originY: 4, deltaX: 0, deltaY: 16, dashPattern: [8, -4] },
  ]},
  { id: 'clay',           category: 'material', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 6, dashPattern: [12, -4] },
    { angle: 0, originX: 8, originY: 3, deltaX: 0, deltaY: 6, dashPattern: [6, -10] },
  ]},
  { id: 'wood-grain',     category: 'material', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: 0, originX: 0, originY: 2, deltaX: 0, deltaY: 12, dashPattern: [15, -8] },
  ]},
  { id: 'plywood',        category: 'material', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 15, dashPattern: [4, -8] },
  ]},
  { id: 'timber-section', category: 'material', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 10, dashPattern: [3, -7] },
  ]},
  { id: 'steel-section',  category: 'material', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'aluminum',       category: 'material', lineFamilies: [
    { angle: 45, originX: 0, originY: 0,   deltaX: 0, deltaY: 3 },
    { angle: 45, originX: 0, originY: 1.5, deltaX: 0, deltaY: 6, dashPattern: [4, -4] },
  ]},
  { id: 'stone-block',    category: 'material', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0,  deltaY: 20 },
    { angle: 90, originX: 0, originY: 0, deltaX: 30, deltaY: 40, dashPattern: [20, -20] },
    { angle: 45, originX: 5, originY: 5, deltaX: 10, deltaY: 20, dashPattern: [3, -17] },
  ]},
  { id: 'cut-stone',      category: 'material', lineFamilies: [
    { angle: 0,  originX: 0, originY: 0, deltaX: 0,  deltaY: 15 },
    { angle: 90, originX: 0, originY: 0, deltaX: 25, deltaY: 30, dashPattern: [15, -15] },
  ]},

  // ---- geometric ----
  { id: 'diamonds',       category: 'geometric', lineFamilies: [
    { angle: 60,  originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 10 },
  ]},
  { id: 'herringbone',    category: 'geometric', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
    { angle: -45, originX: 0, originY: 0, deltaX: 10, deltaY: 10, dashPattern: [10, -10] },
  ]},
  { id: 'basket-weave',   category: 'geometric', lineFamilies: [
    { angle: 0,  originX: 0,  originY: 0, deltaX: 20, deltaY: 10, dashPattern: [10, -10] },
    { angle: 90, originX: 10, originY: 0, deltaX: 10, deltaY: 20, dashPattern: [10, -10] },
  ]},
  { id: 'zigzag',         category: 'geometric', lineFamilies: [
    { angle: 60,  originX: 0, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
    { angle: -60, originX: 5, originY: 0, deltaX: 10, deltaY: 12, dashPattern: [7, -5] },
  ]},

  // ---- NEN47 (Dutch structural drawing standard) ----
  { id: 'nen47-metselwerk-baksteen', category: 'nen47', lineFamilies: [
    { angle: 45, originX: 0, originY: 0,   deltaX: 0, deltaY: 3 },
    { angle: 45, originX: 0, originY: 0.5, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-speciale-steenachtige', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-metselwerk-kunststeen', category: 'nen47', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-lichte-scheidingswand', category: 'nen47', lineFamilies: [
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 2 },
  ]},
  { id: 'nen47-gewapend-beton', category: 'nen47', lineFamilies: [] },
  { id: 'nen47-beton-prefab', category: 'nen47', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-ongewapend-beton', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-sierbeton', category: 'nen47', lineFamilies: [
    { angle: 135, originX: 0, originY: 0,   deltaX: 0, deltaY: 3 },
    { angle: 135, originX: 0, originY: 1.5, deltaX: 0, deltaY: 3, dashPattern: [1.5, -1.5] },
  ]},
  { id: 'nen47-natuursteen', category: 'nen47', lineFamilies: [
    { angle: 135, originX: 0, originY: 0,   deltaX: 0, deltaY: 3, strokeWidth: 0.15 },
    { angle: 135, originX: 0, originY: 1.5, deltaX: 0, deltaY: 3, dashPattern: [1.5, -1.5], strokeWidth: 0.15 },
  ]},
  { id: 'nen47-enkele-afwerking', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
  ]},
  { id: 'nen47-samengestelde-afwerking', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: -45, originX: 3, originY: 0, deltaX: 3, deltaY: 3, dashPattern: [4.24, -4.24] },
    { angle: 0,   originX: 0, originY: 2, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-naaldhout', category: 'nen47', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 6 },
  ]},
  { id: 'nen47-loofhout', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 4 },
  ]},
  { id: 'nen47-hout-langs', category: 'nen47', lineFamilies: [
    { angle: 0, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-bekledingsplaat', category: 'nen47', lineFamilies: [
    { angle: 90, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-isolatie', category: 'nen47', lineFamilies: [
    { angle: 60,  originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -60, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
  ]},
  { id: 'nen47-staal', category: 'nen47', lineFamilies: [] },
  { id: 'nen47-aluminium', category: 'nen47', lineFamilies: [] },
  { id: 'nen47-kunststof', category: 'nen47', lineFamilies: [
    { angle: 45, originX: 0, originY: 0, deltaX: 0, deltaY: 3 },
  ]},
  { id: 'nen47-afdichtingsmiddel', category: 'nen47', lineFamilies: [
    { angle: 37,  originX: 0, originY: 0, deltaX: 3, deltaY: 4, dashPattern: [0] },
    { angle: 127, originX: 5, originY: 3, deltaX: 5, deltaY: 6, dashPattern: [0] },
    { angle: 70,  originX: 2, originY: 7, deltaX: 7, deltaY: 5, dashPattern: [0] },
  ]},
  { id: 'nen47-maaiveld', category: 'nen47', lineFamilies: [
    { angle: 45,  originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
    { angle: -45, originX: 0, originY: 0, deltaX: 0, deltaY: 5 },
  ]},
];

const PATTERN_BY_ID = new Map(BUILTIN_HATCH_PATTERNS.map(p => [p.id, p]));

export function getHatchPattern(id) {
  return PATTERN_BY_ID.get(id);
}

export function listHatchPatternsByCategory() {
  const out = {};
  for (const cat of HATCH_CATEGORIES) out[cat] = [];
  for (const p of BUILTIN_HATCH_PATTERNS) {
    if (!out[p.category]) out[p.category] = [];
    out[p.category].push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

function drawLineFamily(ctx, family, left, top, right, bottom, scale, baseStrokeColor) {
  const angleDeg = family.angle;
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  const spacing = (family.deltaY || 10) * scale;
  if (spacing <= 0.01) return;
  const deltaX  = (family.deltaX  || 0) * scale;
  const originX = (family.originX || 0) * scale;
  const originY = (family.originY || 0) * scale;

  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const diagonal = Math.sqrt((right - left) ** 2 + (bottom - top) ** 2);
  const halfDiag = diagonal / 2 + spacing * 2;
  const numLines = Math.ceil((halfDiag * 2) / spacing) + 2;

  ctx.strokeStyle = family.strokeColor || baseStrokeColor;
  ctx.fillStyle   = family.strokeColor || baseStrokeColor;
  ctx.lineWidth   = family.strokeWidth != null ? family.strokeWidth : 1;

  // Dot family (dashPattern contains a 0 — interpreted as "render as dots")
  if (family.dashPattern && family.dashPattern.includes(0)) {
    const dotRadius = Math.max(0.5, 1 * scale);
    const dotSpacing = deltaX || spacing;
    const dotsPerLine = Math.ceil((halfDiag * 2) / dotSpacing) + 2;
    for (let i = -numLines; i <= numLines; i++) {
      const perp = i * spacing;
      const baseX = cx + perp * (-sinA);
      const baseY = cy + perp * cosA;
      for (let j = -dotsPerLine; j <= dotsPerLine; j++) {
        const along = j * dotSpacing;
        const dx = baseX + originX + along * cosA;
        const dy = baseY + originY + along * sinA;
        ctx.beginPath();
        ctx.arc(dx, dy, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return;
  }

  if (family.dashPattern && family.dashPattern.length > 0) {
    ctx.setLineDash(family.dashPattern.map(d => Math.abs(d) * scale));
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  for (let i = -numLines; i <= numLines; i++) {
    const perp = i * spacing;
    const stagger = deltaX !== 0 ? i * deltaX : 0;
    const baseX = cx + perp * (-sinA);
    const baseY = cy + perp * cosA;
    const ox = baseX + originX + stagger * cosA;
    const oy = baseY + originY + stagger * sinA;
    const x1 = ox - halfDiag * cosA;
    const y1 = oy - halfDiag * sinA;
    const x2 = ox + halfDiag * cosA;
    const y2 = oy + halfDiag * sinA;
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

function renderPattern(ctx, patternId, left, top, right, bottom, scale, color) {
  const pattern = PATTERN_BY_ID.get(patternId);
  if (!pattern) return;
  if (!pattern.lineFamilies || pattern.lineFamilies.length === 0) {
    // Solid fill — paint the clipped region with the hatch color.
    ctx.fillStyle = color;
    ctx.fillRect(left, top, right - left, bottom - top);
    return;
  }
  for (const fam of pattern.lineFamilies) {
    drawLineFamily(ctx, fam, left, top, right, bottom, scale, color);
  }
}

// ---------------------------------------------------------------------------
// Public API — same signatures as before
// ---------------------------------------------------------------------------

export function applyHatchFill(ctx, annotation) {
  const pattern = annotation.hatchPattern;
  if (!pattern || pattern === 'none') return;

  const hatchColor = annotation.hatchColor || annotation.strokeColor || '#000000';
  const hatchScale = (annotation.hatchScale != null ? annotation.hatchScale : 100) / 100;
  const hatchAngle = annotation.hatchAngle || 0;

  const bx = annotation.x || 0;
  const by = annotation.y || 0;
  const bw = annotation.width || 0;
  const bh = annotation.height || 0;
  const cx = bx + bw / 2;
  const cy = by + bh / 2;

  const expandedW = bw * 1.5;
  const expandedH = bh * 1.5;
  const left   = cx - expandedW / 2;
  const top    = cy - expandedH / 2;
  const right  = cx + expandedW / 2;
  const bottom = cy + expandedH / 2;

  ctx.save();
  ctx.clip();

  if (hatchAngle !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(hatchAngle * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  renderPattern(ctx, pattern, left, top, right, bottom, hatchScale, hatchColor);

  ctx.restore();
}

export function applyHatchFillPolygon(ctx, points, holes, hatchPattern, hatchColor, hatchScale, hatchAngle) {
  if (!hatchPattern || hatchPattern === 'none' || !points || points.length < 3) return;

  const color = hatchColor || '#ff0000';
  const scale = (hatchScale != null ? hatchScale : 100) / 100;
  const angle = hatchAngle || 0;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const bw = maxX - minX;
  const bh = maxY - minY;
  const diag = Math.sqrt(bw * bw + bh * bh);
  const pad = Math.max(diag, bw, bh) * 0.6;
  const left = minX - pad;
  const top = minY - pad;
  const right = maxX + pad;
  const bottom = maxY + pad;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        ctx.moveTo(hole[0].x, hole[0].y);
        for (let i = 1; i < hole.length; i++) ctx.lineTo(hole[i].x, hole[i].y);
        ctx.closePath();
      }
    }
  }
  ctx.clip('evenodd');

  if (angle !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate(angle * Math.PI / 180);
    ctx.translate(-cx, -cy);
  }

  renderPattern(ctx, hatchPattern, left, top, right, bottom, scale, color);

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Preview swatch — draws a small tileable image of the pattern.
// Cached so the picker (which builds many swatches) stays fast.
// ---------------------------------------------------------------------------

const SWATCH_CACHE = new Map(); // key: id|color|size → dataURL

export function getHatchSwatchDataUrl(patternId, color = '#000000', size = 16) {
  const key = `${patternId}|${color}|${size}`;
  const cached = SWATCH_CACHE.get(key);
  if (cached) return cached;

  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Light background so dark line patterns are visible.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  // Use a small scale so the pattern visibly tiles inside 16px.
  renderPattern(ctx, patternId, -size, -size, size * 2, size * 2, 0.35, color);
  ctx.restore();

  // Border for picker presentation
  ctx.strokeStyle = '#888';
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);

  const url = canvas.toDataURL('image/png');
  SWATCH_CACHE.set(key, url);
  return url;
}
