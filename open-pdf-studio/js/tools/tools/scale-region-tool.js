/**
 * Scale Region tool — drag a rectangle, then prompt for scale + units.
 * The created scaleRegion does NOT use any region's scale itself; it IS
 * the calibration for annotations placed inside it.
 */
import { getActiveDocument } from '../../core/state.js';
import { createScaleRegion, invalidateScaleRegionCache } from '../../annotations/scale-region.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { openDialog } from '../../bridge.js';

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

export const scaleRegionTool = {
  name: 'scaleRegion',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    ctx.state.isDrawing = true;
  },

  onPointerMove(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return;
    ctx.drawShapePreview(ctx.x, ctx.y, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;

    const x1 = Math.min(state.startX, ctx.x);
    const y1 = Math.min(state.startY, ctx.y);
    const w = Math.abs(ctx.x - state.startX);
    const h = Math.abs(ctx.y - state.startY);

    if (w < 20 || h < 20) {
      ctx.redraw();
      return false;
    }

    const doc = getActiveDocument();
    if (!doc) return false;
    const pageNum = doc.currentPage || 1;

    const ann = createScaleRegion({
      page: pageNum,
      x: x1, y: y1, width: w, height: h,
      scaleString: '1:100',
      units: 'mm',
      label: '',
    });

    doc.annotations.push(ann);
    invalidateScaleRegionCache();
    redraw();

    // Prompt for scale + units (reuses the same dialog flow as viewport).
    openDialog('scale-region', { annotationId: ann.id, pageNum });

    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    return true;
  },

  onDeactivate() {},
};
