import { state } from '../core/state.js';
import { resolvePointerCoords, buildToolContext, isModalOpen } from './tool-context.js';
import { getTool } from './tool-registry.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, snapToGrid } from '../annotations/rendering.js';
import { showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { startTextEditing, finishTextEditing } from './text-editing.js';
import { openStickyPopup } from '../bridge.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { startPan, startContinuousPan, handlePanEnd, handleMiddleButtonPanEnd } from './pan-handler.js';
import { performSnap, drawSnapIndicator } from './snap-engine.js';
import { recordAdd, recordModify, recordBulkModify } from '../core/undo-manager.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';

function redraw() {
  if (state.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

/**
 * Main pointer-down handler (replaces handleMouseDown + handleContinuousMouseDown)
 */
export function handlePointerDown(e) {
  if (!state.pdfDoc) return;
  if (isModalOpen()) return;

  // Safety: reset stuck drag/resize state
  if (state.isDragging || state.isResizing) {
    console.warn('[dispatcher] pointerdown with stuck state — resetting');
    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    state.originalAnnotations = [];
    state._ctrlDragCopy = false;
    state._ctrlCopiesCreated = false;
  }

  // Finish inline text editing
  if (state.isEditingText) {
    finishTextEditing();
  }

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // Object snap start point, fall back to grid
  const startSnap = performSnap(coords.x, coords.y, state.annotations, coords.pageNum, state.scale);
  state.startX = startSnap.snapped ? startSnap.x : snapToGrid(coords.x);
  state.startY = startSnap.snapped ? startSnap.y : snapToGrid(coords.y);
  state.lastSnapResult = startSnap.snapped ? startSnap : null;
  state.dragStartX = coords.x;
  state.dragStartY = coords.y;

  // Set continuous mode context
  if (state.viewMode === 'continuous') {
    state.activeContinuousCanvas = coords.canvas;
    state.activeContinuousPage = coords.pageNum;
    state.currentPage = coords.pageNum;
  }

  // Middle mouse button: panning (works regardless of tool)
  if (e.button === 1) {
    if (state.viewMode === 'continuous') startContinuousPan(e, true);
    else startPan(e, true);
    return;
  }

  // Look up current tool
  const tool = getTool(state.currentTool);
  if (!tool) {
    // Fallback: check plugin registry for drag-mode tools
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler?.drawMode === 'click') {
      const clickTool = getTool('_plugin_click');
      if (clickTool) clickTool.onPointerDown(ctx, e);
    } else if (typeHandler) {
      // Drag-mode plugin: use shape tool behavior
      const shapeTool = getTool('box'); // shape tool handles all drag-to-create
      if (shapeTool) shapeTool.onPointerDown(ctx, e);
    }
    return;
  }

  // Block annotation tools when PDF/A read-only
  if (isPdfAReadOnly() && !['hand', 'select', 'selectComments', 'editText'].includes(state.currentTool)) {
    return;
  }

  // Right-click: delegate to tool (for polyline/measurement finish)
  // or handle dimension/polyline/cloudPolyline cancellation
  if (e.button === 2) {
    if (tool.onPointerDown) tool.onPointerDown(ctx, e);
    return;
  }

  // Capture pointer for reliable event delivery
  if (coords.canvas && e.pointerId !== undefined) {
    try { coords.canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }

  if (tool.onPointerDown) tool.onPointerDown(ctx, e);
}

/**
 * Main pointer-move handler (replaces handleMouseMove + handleContinuousMouseMove)
 */
export function handlePointerMove(e) {
  if (!state.pdfDoc) return;
  if (isModalOpen()) return;
  if (state.isPanning) return;

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // Handle resizing (shared across hand/select tools)
  if (state.isResizing && state.activeHandle) {
    _handleResize(ctx, e, coords);
    return;
  }

  // Handle dragging/moving (shared across hand/select tools)
  if (state.isDragging && state.selectedAnnotations.length > 0) {
    _handleDrag(ctx, e, coords);
    return;
  }

  // Delegate to the active tool
  const tool = getTool(state.currentTool);
  if (tool && tool.onPointerMove) {
    tool.onPointerMove(ctx, e);
  } else {
    // Plugin tool fallback: drag-mode preview
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler) {
      const shapeTool = getTool('box');
      if (shapeTool && shapeTool.onPointerMove) shapeTool.onPointerMove(ctx, e);
    }
  }
}

/**
 * Main pointer-up handler (replaces handleMouseUp + handleContinuousMouseUp)
 */
export function handlePointerUp(e) {
  if (!state.pdfDoc) return;
  if (isModalOpen()) return;
  if (state.isPanning) {
    // End the pan — pointer capture may prevent document-level listeners from firing
    if (state.isMiddleButtonPanning) {
      handleMiddleButtonPanEnd(e);
    } else {
      handlePanEnd(e);
    }
    return;
  }

  const coords = resolvePointerCoords(e);
  const ctx = buildToolContext(e, coords);

  // Handle end of drag/resize (shared logic)
  if (state.isDragging || state.isResizing) {
    _finishDragResize(ctx, e, coords);
    return;
  }

  // Delegate to the active tool
  const tool = getTool(state.currentTool);
  if (tool && tool.onPointerUp) {
    const handled = tool.onPointerUp(ctx, e);
    if (handled) return;
  } else {
    // Plugin tool fallback: shape tool up
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler && typeHandler.drawMode !== 'click') {
      const shapeTool = getTool('box');
      if (shapeTool && shapeTool.onPointerUp) shapeTool.onPointerUp(ctx, e);
      return;
    }
  }

  // Generic drawing tool up (for tools that set isDrawing=true and haven't handled up)
  if (state.isDrawing) {
    _finishDrawing(ctx, e, coords);
  }
}

/**
 * Double-click handler (replaces handleDblClick + handleContinuousDblClick)
 */
export function handleDblClick(e) {
  if (!state.pdfDoc) return;
  if (isModalOpen()) return;
  if (isPdfAReadOnly()) return;

  const coords = resolvePointerCoords(e);
  if (!coords.canvas) return;

  // Set correct page for continuous mode
  if (state.viewMode === 'continuous') {
    state.currentPage = coords.pageNum;
  }

  const clicked = findAnnotationAt(coords.x, coords.y);
  if (clicked) {
    if (['textbox', 'callout'].includes(clicked.type)) {
      state.isDrawing = false;
      state.selectedAnnotations = [clicked];
      showProperties(clicked);
      startTextEditing(clicked);
    } else if (clicked.type === 'comment') {
      state.isDrawing = false;
      state.selectedAnnotations = [clicked];
      showProperties(clicked);
      openStickyPopup(clicked);
    } else if (clicked.type === 'stamp' && clicked.stampSvgBuilder) {
      state.isDrawing = false;
      state.selectedAnnotations = [clicked];
      import('../bridge.js').then(m => {
        m.openDialog('title-block-edit', {
          annotation: clicked,
          rebuildAndUpdate: async (ann) => {
            const { updateStampImage } = await import('../annotations/stamps.js');
            const fields = {};
            for (const key of Object.keys(ann)) {
              if (key.startsWith('tb')) fields[key] = ann[key];
            }
            if (typeof ann.stampSvgBuilder === 'function') {
              await updateStampImage(ann, ann.stampSvgBuilder(fields));
            }
          }
        });
      });
    }
  }
}

// --- Shared drag/resize/drawing logic ---

function _handleResize(ctx, e, coords) {
  const ann = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
  if (!ann || !state.originalAnnotation) return;
  const canvasCtx = coords.canvasCtx;

  if (state.activeHandle === 'rotate') {
    Object.assign(ann, cloneAnnotation(state.originalAnnotation));
    state.shiftKeyPressed = e.shiftKey;
    applyRotation(ann, coords.x, coords.y, state.originalAnnotation);
    redraw();
    return;
  }

  // Snap cursor position during resize
  const snap = performSnap(coords.x, coords.y, state.annotations, coords.pageNum, state.scale, ann.id);
  const snappedX = snap.snapped ? snap.x : coords.x;
  const snappedY = snap.snapped ? snap.y : coords.y;
  state.lastSnapResult = snap.snapped ? snap : null;

  let deltaX, deltaY;
  if (snap.snapped) {
    const orig = state.originalAnnotation;
    const h = state.activeHandle;
    let ox, oy;
    if (typeof h === 'string' && h.startsWith('polyline_node_') && orig.points) {
      const nodeIdx = parseInt(h.split('_').pop(), 10);
      if (!isNaN(nodeIdx) && nodeIdx < orig.points.length) {
        ox = orig.points[nodeIdx].x;
        oy = orig.points[nodeIdx].y;
      }
    }
    if (ox === undefined) {
      ox = h === 'line_start' ? orig.startX
        : h === 'line_end' ? orig.endX
        : h === 'leader_start' ? orig.leaderStartX
        : h === 'leader_end' ? orig.leaderEndX
        : h === 'callout_arrow' ? (orig.arrowX || orig.x)
        : h === 'callout_knee' ? (orig.kneeX || orig.x)
        : (h === 'tl' || h === 'l' || h === 'bl') ? orig.x
        : (h === 'tr' || h === 'r' || h === 'br') ? orig.x + orig.width
        : orig.x + orig.width / 2;
      oy = h === 'line_start' ? orig.startY
        : h === 'line_end' ? orig.endY
        : h === 'leader_start' ? orig.leaderStartY
        : h === 'leader_end' ? orig.leaderEndY
        : h === 'callout_arrow' ? (orig.arrowY || orig.y)
        : h === 'callout_knee' ? (orig.kneeY || orig.y)
        : (h === 'tl' || h === 't' || h === 'tr') ? orig.y
        : (h === 'bl' || h === 'b' || h === 'br') ? orig.y + orig.height
        : orig.y + orig.height / 2;
    }
    deltaX = snappedX - ox;
    deltaY = snappedY - oy;
  } else {
    deltaX = coords.x - state.dragStartX;
    deltaY = coords.y - state.dragStartY;
  }

  Object.assign(ann, cloneAnnotation(state.originalAnnotation));
  applyResize(ann, state.activeHandle, deltaX, deltaY, state.originalAnnotation, e.shiftKey, e.ctrlKey);
  redraw();

  if (state.lastSnapResult) {
    canvasCtx.save();
    canvasCtx.scale(state.scale, state.scale);
    drawSnapIndicator(canvasCtx, state.lastSnapResult, state.scale);
    canvasCtx.restore();
  }
}

function _handleDrag(ctx, e, coords) {
  const deltaX = coords.x - state.dragStartX;
  const deltaY = coords.y - state.dragStartY;

  // Ctrl+drag copy: create clones on first meaningful move
  if (state._ctrlDragCopy && !state._ctrlCopiesCreated && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
    const newId = () => Date.now().toString(36) + Math.random().toString(36).substring(2, 11);
    const selected = state.selectedAnnotations;
    const originals = state.originalAnnotations;

    try {
      if (selected.length > 1) {
        for (let i = 0; i < selected.length; i++) {
          if (originals[i]) Object.assign(selected[i], cloneAnnotation(originals[i]));
        }
        const copies = originals.map(orig => {
          const copy = cloneAnnotation(orig);
          copy.id = newId();
          state.annotations.push(copy);
          return copy;
        });
        state.selectedAnnotations = copies;
        state.originalAnnotations = copies.map(c => cloneAnnotation(c));
        state._ctrlCopiesCreated = true;
      } else if (selected.length === 1) {
        const ann = selected[0];
        const orig = state.originalAnnotation || originals[0];
        if (ann && orig) {
          Object.assign(ann, cloneAnnotation(orig));
          const copy = cloneAnnotation(orig);
          copy.id = newId();
          state.annotations.push(copy);
          state.selectedAnnotations = [copy];
          state.originalAnnotation = cloneAnnotation(copy);
          state.originalAnnotations = [cloneAnnotation(copy)];
          state._ctrlCopiesCreated = true;
          showProperties(copy);
        }
      }
    } catch (err) {
      console.error('[dispatcher] copy error:', err);
    }
  }

  // Apply move to all selected annotations
  if (state.selectedAnnotations.length > 1 && state.originalAnnotations.length > 0) {
    for (let i = 0; i < state.selectedAnnotations.length; i++) {
      if (state.originalAnnotations[i]) {
        Object.assign(state.selectedAnnotations[i], cloneAnnotation(state.originalAnnotations[i]));
        applyMove(state.selectedAnnotations[i], deltaX, deltaY);
      }
    }
  } else if (state.selectedAnnotations.length === 1) {
    const ann = state.selectedAnnotations[0];
    const orig = state.originalAnnotation || state.originalAnnotations[0];
    if (ann && orig) {
      Object.assign(ann, cloneAnnotation(orig));
      applyMove(ann, deltaX, deltaY);
    }
  }

  redraw();
}

function _finishDragResize(ctx, e, coords) {
  if (state._ctrlDragCopy && state._ctrlCopiesCreated) {
    for (const ann of state.selectedAnnotations) recordAdd(ann);
    markDocumentModified();
  } else {
    const upAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (state.selectedAnnotations.length > 1 && state.originalAnnotations.length > 0) {
      recordBulkModify(state.selectedAnnotations, state.originalAnnotations);
    } else if (state.originalAnnotation && upAnn) {
      recordModify(upAnn.id, state.originalAnnotation, upAnn);
    }
  }

  state.isDragging = false;
  state.isResizing = false;
  state.activeHandle = null;
  state.originalAnnotation = null;
  state.originalAnnotations = [];
  state._ctrlDragCopy = false;
  state._ctrlCopiesCreated = false;
  state.lastSnapResult = null;

  // Restore cursor
  const canvas = coords.canvas;
  if (canvas) canvas.style.cursor = state.currentTool === 'hand' ? 'grab' : 'default';

  if (state.selectedAnnotations.length === 1) showProperties(state.selectedAnnotations[0]);
  else if (state.selectedAnnotations.length > 1) showMultiSelectionProperties();
}

function _finishDrawing(ctx, e, coords) {
  // Generic drag-to-create finalization — used when tool doesn't handle onPointerUp
  const rawEndX = coords.x, rawEndY = coords.y;
  const endSnap = performSnap(rawEndX, rawEndY, state.annotations, coords.pageNum, state.scale);
  const endX = endSnap.snapped ? endSnap.x : snapToGrid(rawEndX);
  const endY = endSnap.snapped ? endSnap.y : snapToGrid(rawEndY);
  state.lastSnapResult = null;
  state.isDrawing = false;

  const { createAnnotationFromTool } = ctx;
  const ann = createAnnotationFromTool(state.currentTool, state.startX, state.startY, endX, endY, e);
  if (ann) {
    state.annotations.push(ann);
    recordAdd(ann);
  }
  redraw();

  if (ann && ['textbox', 'callout'].includes(ann.type)) {
    state.selectedAnnotations = [ann];
    showProperties(ann);
    startTextEditing(ann);
  }

  // Clear continuous mode state
  if (state.viewMode === 'continuous') {
    state.activeContinuousCanvas = null;
    state.activeContinuousPage = null;
  }
}
