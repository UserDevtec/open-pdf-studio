import { applyToolTransform } from '../tool-context.js';

/**
 * Freehand draw tool
 */
export const drawTool = {
  name: 'draw',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    const { x, y, state } = ctx;
    state.isDrawing = true;
    state.currentPath = [{ x, y }];
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx } = ctx;
    if (!state.isDrawing) return;

    state.currentPath.push({ x, y });

    // Incremental draw — only the new segment
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    const prefs = state.preferences;
    canvasCtx.strokeStyle = prefs.drawStrokeColor || ctx.getColorPickerValue();
    canvasCtx.lineWidth = prefs.drawLineWidth || ctx.getLineWidthValue();
    canvasCtx.globalAlpha = (prefs.drawOpacity || 100) / 100;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.beginPath();
    canvasCtx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    canvasCtx.lineTo(x, y);
    canvasCtx.stroke();
    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
  },

  onPointerUp(ctx, e) {
    const { state } = ctx;
    if (!state.isDrawing) return false;
    state.isDrawing = false;

    const ann = ctx.createAnnotationFromTool('draw', state.startX, state.startY, ctx.x, ctx.y, e);
    if (ann) {
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
    ctx.redraw();
    return true;
  },
};
