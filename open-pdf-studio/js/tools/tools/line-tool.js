/**
 * Line tool — handles line, arrow
 * Uses click-click mode: first click sets start, second click sets end.
 * Also supports legacy drag-to-create (if pointer moves significantly before release).
 */
import { state, getActiveDocument } from '../../core/state.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';

// Internal state for click-click line drawing
const _lineState = { startX: 0, startY: 0, drawing: false, lastCursorX: 0, lastCursorY: 0 };

export const lineTool = {
  name: 'line',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e.button === 2) {
      // Right-click cancels
      if (_lineState.drawing) {
        _lineState.drawing = false;
        state.isDrawing = false;
        exitTypeLengthMode();
        state._typeLengthCommit = null;
        if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();
        ctx.redraw();
      }
      return;
    }

    if (!_lineState.drawing) {
      // First click: record start point
      _lineState.startX = state.startX;
      _lineState.startY = state.startY;
      _lineState.lastCursorX = state.startX;
      _lineState.lastCursorY = state.startY;
      _lineState.drawing = true;
      state.isDrawing = true;
      // Activate type-length capture: typing digits now will lock segment length
      enterTypeLengthMode(_lineState.startX, _lineState.startY);
      state._typeLengthCommit = (length) => _commitLine(ctx, e);
      // Polar tracking anchor (used by snap-engine when polar is on)
      if (ctx.setPolarAnchor) ctx.setPolarAnchor(_lineState.startX, _lineState.startY, ctx.pageNum);
    } else {
      // Second click: create the line annotation
      let endX, endY;
      if (typeLengthHasBuffer()) {
        // Honor typed length: use last cursor direction, length from buffer
        const ep = applyToEndpoint(_lineState.startX, _lineState.startY, ctx.x, ctx.y);
        endX = ep.x;
        endY = ep.y;
      } else {
        const rawX = ctx.x, rawY = ctx.y;
        const endSnap = ctx.snap(rawX, rawY);
        endX = endSnap.snapped ? endSnap.x : ctx.snapToGrid(rawX);
        endY = endSnap.snapped ? endSnap.y : ctx.snapToGrid(rawY);
      }

      _commitLineAt(ctx, e, endX, endY);
    }
  },

  onPointerMove(ctx, e) {
    const { x, y } = ctx;
    if (!_lineState.drawing) {
      // Hover snap indicator
      _drawHoverSnap(ctx, x, y);
      return;
    }

    // Remember cursor for type-length direction when committing on Enter
    _lineState.lastCursorX = x;
    _lineState.lastCursorY = y;

    // Temporarily set state.startX/Y to the saved first-click position
    // so drawShapePreview uses the correct origin
    const savedStartX = state.startX;
    const savedStartY = state.startY;
    state.startX = _lineState.startX;
    state.startY = _lineState.startY;

    // Snap cursor position for preview
    const snap = ctx.snap(x, y);
    let previewX = snap.snapped ? snap.x : x;
    let previewY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    // If user has typed a length, lock endpoint distance to typed value
    if (typeLengthHasBuffer()) {
      const ep = applyToEndpoint(_lineState.startX, _lineState.startY, x, y);
      previewX = ep.x;
      previewY = ep.y;
      state.lastSnapResult = null;
    }
    ctx.drawShapePreview(previewX, previewY, e);

    // Restore state.startX/Y (the dispatcher may have overwritten them)
    state.startX = savedStartX;
    state.startY = savedStartY;
  },

  onPointerUp(ctx, e) {
    // In click-click mode, pointerUp is a no-op (we handle everything in pointerDown).
    // Return true to signal "handled" so the dispatcher doesn't call _finishDrawing.
    if (_lineState.drawing) return true;
    return false;
  },

  onDeactivate(ctx) {
    if (_lineState.drawing) {
      _lineState.drawing = false;
      state.isDrawing = false;
      ctx.redraw();
    }
    exitTypeLengthMode();
    state._typeLengthCommit = null;
    if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();
  },
};

function _commitLine(ctx, e) {
  // Commit using last known cursor direction + buffered length
  const ep = applyToEndpoint(
    _lineState.startX,
    _lineState.startY,
    _lineState.lastCursorX,
    _lineState.lastCursorY,
  );
  _commitLineAt(ctx, e, ep.x, ep.y);
}

function _commitLineAt(ctx, e, endX, endY) {
  state.lastSnapResult = null;
  state.isDrawing = false;
  _lineState.drawing = false;
  if (ctx.clearPolarAnchor) ctx.clearPolarAnchor();

  const tool = state.currentTool;
  const ann = ctx.createAnnotationFromTool(tool, _lineState.startX, _lineState.startY, endX, endY, e);
  if (ann) {
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) doc.annotations.push(ann);
    ctx.recordAdd(ann);
  }
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  ctx.redraw();

  // Auto-reset to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
