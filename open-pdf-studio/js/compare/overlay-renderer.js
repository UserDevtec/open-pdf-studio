// Vector overlay tinting helpers.
//
// Strategy: render each PDF page natively (vector) onto its own canvas at the
// requested scale, then apply a per-canvas color tint that preserves the
// vector sharpness of the source render. The two canvases are stacked in the
// DOM with CSS `mix-blend-mode: multiply`, so:
//   - red ink (OLD)  on white   -> appears red
//   - green ink (NEW) on white  -> appears green
//   - red * green (multiply)    -> appears dark / near-black where both inked
//
// This avoids any pixel-diff thresholding, so the result is sharp at any zoom
// level. The previous threshold-based composeOverlay() is kept exported as a
// deprecated no-op fallback to preserve the public API for any external
// callers, but it is no longer used internally.

// Tint colors (as CSS rgb strings).
export const OLD_TINT = 'rgb(220, 38, 38)';   // red-600
export const NEW_TINT = 'rgb(22, 163, 74)';   // green-600

/**
 * Apply a solid-color tint to all non-white pixels of a canvas while keeping
 * vector sharpness. Operates on the canvas's existing 2d context.
 *
 * The canvas is expected to contain a black-on-white PDF render. After this
 * call, ink (anything that was not pure white) is replaced by the tint color
 * over a white background. The tint is applied at full pixel-resolution so
 * antialiasing edges remain smooth.
 *
 * Implementation: we use globalCompositeOperation = 'multiply' to multiply a
 * solid tint plane across the canvas. White (1,1,1) * tint = tint, while the
 * paper-white background stays white. This is equivalent to a per-channel
 * darken which preserves antialiasing.
 */
export function tintCanvas(canvas, cssColor) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
}

/**
 * Deprecated. Pixel-diff threshold compositor — replaced by vector tinting +
 * CSS mix-blend-mode. Kept only so legacy importers don't break. Returns null.
 */
export function composeOverlay(_oldData, _newData) {
  return null;
}

export const INK_THRESHOLD = 600;

// Per-change-type fill/stroke colors for translucent highlights.
export const HIGHLIGHT_COLORS = {
  added:    { fill: 'rgba(22, 163, 74, 0.28)',  stroke: 'rgba(22, 163, 74, 0.95)'  },
  removed:  { fill: 'rgba(220, 38, 38, 0.28)',  stroke: 'rgba(220, 38, 38, 0.95)'  },
  modified: { fill: 'rgba(202, 138, 4, 0.28)',  stroke: 'rgba(202, 138, 4, 0.95)'  },
};

/**
 * Draw translucent rectangles for each visible change on an overlay canvas.
 *
 * @param {HTMLCanvasElement} canvas — sized to match the base render
 * @param {Array} changes — change records from change-detector (in detection-px)
 * @param {Object} opts
 *   @prop {number} ratio — multiplier mapping detection-px to display-px
 *                          (typically displayScale / change.detectScale)
 *   @prop {Object} visibleTypes — { added: bool, removed: bool, modified: bool }
 *   @prop {Object|null} selected — change record currently selected, drawn with
 *                                  a thicker matching-color border (no fill)
 */
export function drawHighlights(canvas, changes, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!Array.isArray(changes) || changes.length === 0) return;

  const ratio = opts.ratio || 1;
  const visibleTypes = opts.visibleTypes || { added: true, removed: true, modified: true };
  const selected = opts.selected || null;

  for (const c of changes) {
    if (!visibleTypes[c.type]) continue;
    const colors = HIGHLIGHT_COLORS[c.type] || HIGHLIGHT_COLORS.modified;
    const x = c.x * ratio;
    const y = c.y * ratio;
    const w = c.width * ratio;
    const h = c.height * ratio;
    ctx.fillStyle = colors.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }

  // Selected change: draw a thicker border on top, no fill, with subtle glow.
  if (selected) {
    const colors = HIGHLIGHT_COLORS[selected.type] || HIGHLIGHT_COLORS.modified;
    const x = selected.x * ratio;
    const y = selected.y * ratio;
    const w = selected.width * ratio;
    const h = selected.height * ratio;
    ctx.save();
    ctx.shadowColor = colors.stroke;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = colors.stroke;
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, Math.max(0, w - 3), Math.max(0, h - 3));
    ctx.restore();
  }
}
