/**
 * Shape tool — handles box, circle, highlight, cloud, polygon, redaction, textbox, callout
 * All use the same drag-to-create pattern via buildAnnotationProps + drawShapePreview
 */
export const shapeTool = {
  name: 'shape',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button !== 0) return;
    const { state } = ctx;
    state.isDrawing = true;
  },

  onPointerMove(ctx, e) {
    const { x, y, state } = ctx;
    if (!state.isDrawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Snap cursor position for shape preview
    const snap = ctx.snap(x, y);
    const previewX = snap.snapped ? snap.x : x;
    const previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    ctx.drawShapePreview(previewX, previewY, e);
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;

    const rawX = ctx.x, rawY = ctx.y;
    const endSnap = ctx.snap(rawX, rawY);
    let endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
    let endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);
    state.lastSnapResult = null;
    state.isDrawing = false;

    const tool = state.currentTool;

    // Single-click detection: if barely dragged, use default size
    const dx = Math.abs(endX - state.startX);
    const dy = Math.abs(endY - state.startY);
    const isClick = dx < 5 && dy < 5;

    if (isClick && tool === 'textbox') {
      endX = state.startX + 150;
      endY = state.startY + 30;
    } else if (isClick && tool === 'callout') {
      // Click places arrow tip; box appears offset above-right
      endX = state.startX + 80;
      endY = state.startY - 40;
    } else if (isClick && (tool === 'comment' || tool === 'stamp' || tool === 'signature')) {
      // These already handle single click
    } else if (isClick && tool === 'parametricSymbol') {
      // Single click: use template default size
      // (handled inside buildAnnotationProps via b.width/height fallback)
    } else if (isClick) {
      // Other shapes: too small to be useful, skip creation
      ctx.redraw();
      return false;
    }

    const ann = ctx.createAnnotationFromTool(tool, state.startX, state.startY, endX, endY, e);
    if (ann) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();

    // Auto-start text editing for textbox/callout
    if (ann && ['textbox', 'callout'].includes(ann.type)) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) { doc.selectedAnnotations = [ann]; doc.selectedAnnotation = ann; }
      ctx.showProperties(ann);
      ctx.startTextEditing(ann);
    }

    // Auto-reset to select tool
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());

    return true;
  },
};

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const { state } = ctx;
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
