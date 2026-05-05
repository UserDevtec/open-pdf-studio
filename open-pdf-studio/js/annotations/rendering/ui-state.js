import { state, getActiveDocument } from '../../core/state.js';
import { setContextualTabsVisible, syncFormatStore } from '../../bridge.js';
import { getMeasureScale } from '../measurement.js';

// No-op: TitleBar.jsx now derives button states from reactive state
export function updateQuickAccessButtons() {}

// Show/hide Format and Arrange contextual ribbon tabs
export function updateContextualTabs() {
  const _uiDoc = getActiveDocument();
  const _uiSel = _uiDoc ? _uiDoc.selectedAnnotations : [];
  const hasSelection = _uiSel.length > 0;
  setContextualTabsVisible(hasSelection);
  if (hasSelection) {
    syncFormatStore(_uiSel);
  }
}

// Compute grid spacing in app-pixel space, honoring measure-scale so the
// preference value is interpreted in user units (default mm).
// Returns { spacingPx, originX, originY } or null if grid should be hidden.
export function getGridGeometry(viewportScale) {
  const userSpacing = state.preferences.gridSize || 10;
  let pxPerUnit = 1;
  try {
    const ms = getMeasureScale();
    if (ms && ms.pixelsPerUnit > 0) pxPerUnit = ms.pixelsPerUnit;
  } catch (_) { /* measurement module not ready */ }
  const spacingPx = userSpacing * pxPerUnit;
  // Hide when zoomed-out spacing < 4 screen px (avoids gpu meltdown)
  const screenSpacing = spacingPx * (viewportScale || 1);
  if (screenSpacing < 4) return null;
  return { spacingPx, screenSpacing };
}

// Draw dot-grid overlay (replaces line-grid). Coordinates here are in
// app-pixel space because the caller has already scaled the context.
export function drawGrid(ctx, width, height, viewportScale) {
  const geom = getGridGeometry(viewportScale);
  if (!geom) return;
  const { spacingPx, screenSpacing } = geom;

  ctx.save();
  ctx.fillStyle = '#cccccc';
  // 1 px screen dot — convert to app-units via 1/viewportScale
  const dotR = 0.5 / (viewportScale || 1);

  // Use a single Path2D-style batch (begin/arc/fill) for performance.
  ctx.beginPath();
  for (let x = 0; x <= width + spacingPx; x += spacingPx) {
    for (let y = 0; y <= height + spacingPx; y += spacingPx) {
      // Snap to integer screen pixel for crisp dots
      ctx.moveTo(x + dotR, y);
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
    }
  }
  ctx.fill();

  // Optional minor dots at fine zoom (every spacing/5)
  if (screenSpacing > 60) {
    ctx.fillStyle = 'rgba(204, 204, 204, 0.5)';
    const fine = spacingPx / 5;
    ctx.beginPath();
    for (let x = 0; x <= width + spacingPx; x += fine) {
      for (let y = 0; y <= height + spacingPx; y += fine) {
        ctx.moveTo(x + dotR, y);
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }

  ctx.restore();
}

// Snap a coordinate to the grid (single axis). Honors measure-scale so a
// gridSize of 10 (mm) produces grid-aligned points in app-pixel space.
export function snapToGrid(value) {
  if (!state.preferences.enableGridSnap) return value;
  const userSpacing = state.preferences.gridSize || 10;
  let pxPerUnit = 1;
  try {
    const ms = getMeasureScale();
    if (ms && ms.pixelsPerUnit > 0) pxPerUnit = ms.pixelsPerUnit;
  } catch (_) { /* not ready */ }
  const step = userSpacing * pxPerUnit;
  if (step <= 0) return value;
  return Math.round(value / step) * step;
}

// Snap a 2-D point to the nearest grid intersection. Returns
// {x, y, snapped:true, type:'grid'} when grid-snap pref enabled, else null.
export function snapPointToGrid(x, y) {
  if (!state.preferences.enableGridSnap) return null;
  const sx = snapToGrid(x);
  const sy = snapToGrid(y);
  if (sx === x && sy === y) return { x, y, snapped: true, type: 'grid' };
  return { x: sx, y: sy, snapped: true, type: 'grid' };
}
