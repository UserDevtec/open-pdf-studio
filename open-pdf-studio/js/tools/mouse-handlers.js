import { state, addToSelection, removeFromSelection, isSelected, clearSelection, getAnnotationBounds, getSelectionBounds } from '../core/state.js';
import { annotationCanvas, annotationCtx, pdfContainer } from '../ui/dom-elements.js';
import { getColorPickerValue, getLineWidthValue } from '../bridge.js';
import { createAnnotation, cloneAnnotation } from '../annotations/factory.js';
import { findAnnotationAt } from '../annotations/geometry.js';
import { findHandleAt, getCursorForHandle } from '../annotations/handles.js';
import { applyResize, applyMove, applyRotation } from '../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous, renderAnnotationsForPage, snapToGrid } from '../annotations/rendering.js';
import { showProperties, hideProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { startTextEditing, finishTextEditing, addTextAnnotation, addComment } from './text-editing.js';
import { openStickyPopup } from '../bridge.js';
import { findTextEditAtPosition, startTextEditEditing } from './text-edit-tool.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import { recordAdd, recordModify, recordBulkModify } from '../core/undo-manager.js';
import { showStampPicker } from '../annotations/stamps.js';
import { showSignatureDialog } from '../annotations/signature.js';
import { startPan, startContinuousPan, handlePanMove, handleMiddleButtonPanEnd } from './pan-handler.js';
import { snapAngle } from '../utils/helpers.js';
import { drawShapePreview } from './shape-preview.js';
import { createAnnotationFromTool, createContinuousAnnotation } from './annotation-creators.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement } from '../annotations/measurement.js';
import { performSnap, drawSnapIndicator } from './snap-engine.js';

// Check if any modal dialog/overlay is blocking interaction
function isModalDialogOpen() {
  // State flag is set synchronously during blur (before mousedown fires)
  if (state.modalDialogOpen) return true;
  // DOM check as fallback for all overlays
  return !!document.querySelector(
    '.form-validation-overlay, ' +
    '.about-overlay.visible, ' +
    '.doc-props-overlay.visible, ' +
    '.preferences-overlay.visible, ' +
    '.text-annot-overlay.visible, ' +
    '.loading-overlay.visible, ' +
    '.app-menu-overlay.visible, ' +
    '.sig-overlay.visible'
  );
}

// Safety: document-level mouseup to catch releases outside the canvas
let _documentMouseUpAttached = false;
function _ensureDocumentMouseUp() {
  if (_documentMouseUpAttached) return;
  _documentMouseUpAttached = true;
  document.addEventListener('mouseup', _documentMouseUpHandler);
}
function _removeDocumentMouseUp() {
  if (!_documentMouseUpAttached) return;
  _documentMouseUpAttached = false;
  document.removeEventListener('mouseup', _documentMouseUpHandler);
}
function _documentMouseUpHandler(e) {
  // Only act if drag/resize state is stuck (mouseup missed on canvas)
  if (state.isDragging || state.isResizing) {
    console.warn('[drag] mouseup caught on document — cleaning stuck state. isDragging:', state.isDragging, 'isResizing:', state.isResizing);
    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    state.originalAnnotations = [];
    state._ctrlDragCopy = false;
    state._ctrlCopiesCreated = false;
    annotationCanvas.style.cursor = state.currentTool === 'hand' ? 'grab' : 'default';
  }
  _removeDocumentMouseUp();
}

// Mouse down handler for single page mode
export function handleMouseDown(e) {
  if (!state.pdfDoc) return;
  if (isModalDialogOpen()) return;

  // Safety: reset stuck drag/resize state from a previous missed mouseup
  if (state.isDragging || state.isResizing) {
    console.warn('[drag] mousedown with stuck state — resetting. isDragging:', state.isDragging, 'isResizing:', state.isResizing, 'isPanning:', state.isPanning);
    state.isDragging = false;
    state.isResizing = false;
    state.activeHandle = null;
    state.originalAnnotation = null;
    state.originalAnnotations = [];
    state._ctrlDragCopy = false;
    state._ctrlCopiesCreated = false;
    _removeDocumentMouseUp();
  }

  // Finish inline text editing when clicking outside
  if (state.isEditingText) {
    finishTextEditing();
  }

  const rect = annotationCanvas.getBoundingClientRect();
  // Convert to unscaled coordinates
  const x = (e.clientX - rect.left) / state.scale;
  const y = (e.clientY - rect.top) / state.scale;

  // Apply object snap then grid snap to start coordinates
  const startSnap = performSnap(x, y, state.annotations, state.currentPage, state.scale);
  state.startX = startSnap.snapped ? startSnap.x : snapToGrid(x);
  state.startY = startSnap.snapped ? startSnap.y : snapToGrid(y);
  state.lastSnapResult = startSnap.snapped ? startSnap : null;
  state.dragStartX = x;
  state.dragStartY = y;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    startPan(e, true);
    return;
  }

  // Ignore right-click — handled by context menu
  if (e.button === 2) return;



  // Handle hand tool (panning, allow annotation selection, dragging and resizing)
  if (state.currentTool === 'hand') {
    // Check for resize handle on already-selected annotation (use array[0] as source of truth)
    const handSelAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (handSelAnn) {
      const handleType = findHandleAt(x, y, handSelAnn, state.scale);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.dragStartX = x;
        state.dragStartY = y;
        state.originalAnnotation = cloneAnnotation(handSelAnn);
        annotationCanvas.style.cursor = getCursorForHandle(handleType, handSelAnn.rotation, handSelAnn);
        return;
      }
    }

    const clickedAnnotation = findAnnotationAt(x, y);
    if (clickedAnnotation) {
      if (e.ctrlKey || e.metaKey) {
        if (isSelected(clickedAnnotation)) {
          // Ctrl+click on already selected: initiate Ctrl+drag copy
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
          if (state.selectedAnnotations.length === 1) {
            state.originalAnnotation = cloneAnnotation(state.selectedAnnotations[0]);
          }
          annotationCanvas.style.cursor = 'copy';
        } else {
          // Ctrl+click on unselected: add to selection and initiate Ctrl+drag copy
          addToSelection(clickedAnnotation);
          state.isDragging = true;
          state._ctrlDragCopy = true;
          state._ctrlCopiesCreated = false;
          state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
          if (state.selectedAnnotations.length === 1) {
            state.originalAnnotation = cloneAnnotation(state.selectedAnnotations[0]);
          }
          annotationCanvas.style.cursor = 'copy';
        }
        if (state.selectedAnnotations.length === 1) {
          showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          showMultiSelectionProperties();
        } else {
          hideProperties();
        }
      } else {
        state.selectedAnnotations = [clickedAnnotation];
        showProperties(clickedAnnotation);
        // Text markup annotations (highlight/strikethrough/underline) are anchored to text — not movable
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (!isTextMarkup) {
          state.isDragging = true;
          state.dragStartX = x;
          state.dragStartY = y;
          state.originalAnnotation = cloneAnnotation(clickedAnnotation);
          state.originalAnnotations = [cloneAnnotation(clickedAnnotation)];
          annotationCanvas.style.cursor = 'move';
        }
      }
      redrawAnnotations();
    } else {
      clearSelection();
      hideProperties();
      startPan(e, false);
      redrawAnnotations();
    }
    return;
  }

  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly() && state.currentTool !== 'select' && state.currentTool !== 'selectComments') {
    return;
  }

  // Edit text tool: first check for textEdit records at click position
  if (state.currentTool === 'editText') {
    const canvas = annotationCanvas;
    const hitEdit = findTextEditAtPosition(x, y, state.currentPage, canvas);
    if (hitEdit) {
      startTextEditEditing(hitEdit, state.currentPage, canvas);
    }
    return;
  }

  // Handle select tool
  if (state.currentTool === 'select' || state.currentTool === 'selectComments') {
    const pdfaLocked = isPdfAReadOnly();

    // First check if clicking on a handle of the selected annotation (use array[0] as source of truth)
    const selAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (!pdfaLocked && selAnn) {
      const handleType = findHandleAt(x, y, selAnn, state.scale);
      if (handleType) {
        state.isResizing = true;
        state.activeHandle = handleType;
        state.originalAnnotation = cloneAnnotation(selAnn);
        annotationCanvas.style.cursor = getCursorForHandle(handleType, selAnn.rotation, selAnn);
        return;
      }
    }

    // Check if clicking on an annotation
    const clickedAnnotation = findAnnotationAt(x, y);
    if (clickedAnnotation) {
      // Double-click to edit text for textbox/callout
      if (!pdfaLocked && e.detail === 2 && ['textbox', 'callout'].includes(clickedAnnotation.type)) {
        startTextEditing(clickedAnnotation);
        return;
      }

      // Double-click or single-click on comment: open popup
      if (clickedAnnotation.type === 'comment') {
        state.selectedAnnotations = [clickedAnnotation];
        showProperties(clickedAnnotation);
        openStickyPopup(clickedAnnotation);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (isSelected(clickedAnnotation)) {
          // Ctrl+click on already selected annotation: initiate Ctrl+drag copy
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
            if (state.selectedAnnotations.length === 1) {
              state.originalAnnotation = cloneAnnotation(state.selectedAnnotations[0]);
            }
            annotationCanvas.style.cursor = 'copy';
          }
        } else {
          // Ctrl+click on unselected: add to multi-selection and allow drag
          addToSelection(clickedAnnotation);
          if (!pdfaLocked) {
            state.isDragging = true;
            state._ctrlDragCopy = true;
            state._ctrlCopiesCreated = false;
            state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
            if (state.selectedAnnotations.length === 1) {
              state.originalAnnotation = cloneAnnotation(state.selectedAnnotations[0]);
            }
            annotationCanvas.style.cursor = 'copy';
          }
        }
        if (state.selectedAnnotations.length === 1) {
          showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          showMultiSelectionProperties();
        } else {
          hideProperties();
        }
        redrawAnnotations();
      } else {
        // Normal click - select and show properties, but don't allow drag in PDF/A mode
        const isTextMarkup = ['textHighlight', 'textStrikethrough', 'textUnderline'].includes(clickedAnnotation.type);
        if (isSelected(clickedAnnotation) && state.selectedAnnotations.length > 1) {
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotations = state.selectedAnnotations.map(a => cloneAnnotation(a));
            annotationCanvas.style.cursor = 'move';
          }
        } else {
          // Single select
          state.selectedAnnotations = [clickedAnnotation];
          showProperties(clickedAnnotation);
          if (!pdfaLocked && !isTextMarkup) {
            state.isDragging = true;
            state.originalAnnotation = cloneAnnotation(clickedAnnotation);
            state.originalAnnotations = [cloneAnnotation(clickedAnnotation)];
            annotationCanvas.style.cursor = 'move';
          }
        }
      }
    } else {
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click on empty space: keep selection, do nothing
      } else {
        // Start rubber band selection
        state.isRubberBanding = true;
        state.rubberBandStartX = x;
        state.rubberBandStartY = y;
        clearSelection();
        hideProperties();
        redrawAnnotations();
      }
    }
    return;
  }

  // Handle polyline tool specially (click to add points, double-click to finish)
  if (state.currentTool === 'polyline') {
    const polyPrefs = state.preferences;
    if (e.detail === 2) {
      // Double-click to finish polyline
      if (state.polylinePoints.length >= 2) {
        const ann = createAnnotation({
          type: 'polyline',
          page: state.currentPage,
          points: [...state.polylinePoints],
          color: polyPrefs.polylineStrokeColor,
          strokeColor: polyPrefs.polylineStrokeColor,
          lineWidth: polyPrefs.polylineLineWidth,
          opacity: (polyPrefs.polylineOpacity || 100) / 100
        });
        state.annotations.push(ann);
        recordAdd(ann);
      }
      state.polylinePoints = [];
      state.isDrawingPolyline = false;
      redrawAnnotations();
      return;
    }

    // Single click - add point (with object snap, including in-progress vertices)
    const polySnap = performSnap(x, y, state.annotations, state.currentPage, state.scale, null, state.polylinePoints);
    const polyPtX = polySnap.snapped ? polySnap.x : x;
    const polyPtY = polySnap.snapped ? polySnap.y : y;
    state.polylinePoints.push({ x: polyPtX, y: polyPtY });
    state.isDrawingPolyline = true;
    redrawAnnotations();

    // Draw in-progress polyline so it remains visible after click
    if (state.polylinePoints.length > 0) {
      const ctx = annotationCtx || annotationCanvas.getContext('2d');
      ctx.save();
      ctx.scale(state.scale, state.scale);
      ctx.strokeStyle = polyPrefs.polylineStrokeColor;
      ctx.lineWidth = polyPrefs.polylineLineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      state.polylinePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();
      ctx.restore();
    }
    return;
  }

  // Start drawing for other tools
  state.isDrawing = true;

  if (state.currentTool === 'draw') {
    state.currentPath = [{ x, y }];
  } else if (state.currentTool === 'comment') {
    addComment(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'text') {
    addTextAnnotation(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'stamp') {
    showStampPicker(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'signature') {
    showSignatureDialog(x, y);
    state.isDrawing = false;
  } else if (state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') {
    // Multi-click to add points; use polyline-like behavior
    if (!state.measurePoints) state.measurePoints = [];
    // Try object snap first (including in-progress vertices)
    const mSnapResult = performSnap(x, y, state.annotations, state.currentPage, state.scale, null, state.measurePoints);
    let ptX = mSnapResult.snapped ? mSnapResult.x : x;
    let ptY = mSnapResult.snapped ? mSnapResult.y : y;
    // Snap angle relative to last placed point when Shift is held (only if not object-snapped)
    if (!mSnapResult.snapped && e.shiftKey && state.preferences.enableAngleSnap && state.measurePoints.length > 0) {
      const last = state.measurePoints[state.measurePoints.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = snapAngle(angle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
      ptX = last.x + length * Math.cos(snapped);
      ptY = last.y + length * Math.sin(snapped);
    }
    state.measurePoints.push({ x: ptX, y: ptY });
    state.isDrawing = false;
    redrawAnnotations();

    // Draw in-progress measurement so points remain visible after click
    if (state.measurePoints.length > 0) {
      const mPrefs = state.preferences;
      const mColor = mPrefs.measureStrokeColor || '#FF0000';
      const ctx = annotationCtx || annotationCanvas.getContext('2d');
      ctx.save();
      ctx.scale(state.scale, state.scale);
      ctx.strokeStyle = mColor;
      ctx.lineWidth = mPrefs.measureLineWidth || 1;
      ctx.globalAlpha = (mPrefs.measureOpacity || 100) / 100;
      ctx.setLineDash([4, 2]);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      state.measurePoints.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      if (state.currentTool === 'measureArea' && state.measurePoints.length > 2) {
        ctx.closePath();
        ctx.fillStyle = mColor + '20';
        ctx.fill();
      }
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw vertex markers
      state.measurePoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
        ctx.fillStyle = mColor;
        ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }
}

// Mouse move handler for single page mode
export function handleMouseMove(e) {
  if (!state.pdfDoc || !annotationCanvas) return;
  if (isModalDialogOpen()) return;

  // Skip if panning (handled by document-level listener)
  if (state.isPanning) return;

  // Ensure document-level mouseup is attached when dragging/resizing
  // (catches mouse releases outside the canvas)
  if (state.isDragging || state.isResizing) {
    _ensureDocumentMouseUp();
  }

  const rect = annotationCanvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) / state.scale;
  const currentY = (e.clientY - rect.top) / state.scale;

  // Hand tool: show resize cursors on handles, annotation hover, or grab for panning
  if (state.currentTool === 'hand' && !state.isDragging && !state.isResizing) {
    // Check resize handles on selected annotation (use array[0] as source of truth)
    const handHoverAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (handHoverAnn) {
      const handleType = findHandleAt(currentX, currentY, handHoverAnn, state.scale);
      if (handleType) {
        annotationCanvas.style.cursor = getCursorForHandle(handleType, handHoverAnn.rotation, handHoverAnn);
        return;
      }
    }
    const hoverAnnotation = findAnnotationAt(currentX, currentY);
    annotationCanvas.style.cursor = hoverAnnotation ? 'default' : 'grab';
    annotationCanvas.title = (hoverAnnotation?.type === 'comment' && !hoverAnnotation.popupOpen && hoverAnnotation.text) ? hoverAnnotation.text.split('\n').slice(0, 5).join('\n') : '';
    return;
  }

  // Rubber band selection drawing
  if (state.isRubberBanding && (state.currentTool === 'select' || state.currentTool === 'selectComments')) {
    redrawAnnotations();
    // Draw rubber band rectangle
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = '#0066cc';
    annotationCtx.lineWidth = 1 / state.scale;
    annotationCtx.setLineDash([4 / state.scale, 4 / state.scale]);
    annotationCtx.fillStyle = 'rgba(0, 102, 204, 0.1)';
    const rbX = Math.min(state.rubberBandStartX, currentX);
    const rbY = Math.min(state.rubberBandStartY, currentY);
    const rbW = Math.abs(currentX - state.rubberBandStartX);
    const rbH = Math.abs(currentY - state.rubberBandStartY);
    annotationCtx.fillRect(rbX, rbY, rbW, rbH);
    annotationCtx.strokeRect(rbX, rbY, rbW, rbH);
    annotationCtx.setLineDash([]);
    annotationCtx.restore();
    return;
  }

  // Update cursor when hovering over handles (use array[0] as source of truth)
  if ((state.currentTool === 'select' || state.currentTool === 'selectComments') && !state.isDragging && !state.isResizing) {
    const hoverAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (hoverAnn) {
      const handleType = findHandleAt(currentX, currentY, hoverAnn, state.scale);
      if (handleType) {
        annotationCanvas.style.cursor = getCursorForHandle(handleType, hoverAnn.rotation, hoverAnn);
        return;
      }
    }
    const hoverAnnForTooltip = findAnnotationAt(currentX, currentY);
    annotationCanvas.title = (hoverAnnForTooltip?.type === 'comment' && !hoverAnnForTooltip.popupOpen && hoverAnnForTooltip.text) ? hoverAnnForTooltip.text.split('\n').slice(0, 5).join('\n') : '';
    annotationCanvas.style.cursor = 'default';
    return;
  }

  // Handle resizing or rotation (use array[0] as source of truth)
  if (state.isResizing && state.activeHandle) {
    const resizeAnn = state.selectedAnnotations.length === 1 ? state.selectedAnnotations[0] : null;
    if (resizeAnn && state.originalAnnotation) {
      // Handle rotation separately
      if (state.activeHandle === 'rotate') {
        Object.assign(resizeAnn, cloneAnnotation(state.originalAnnotation));
        state.shiftKeyPressed = e.shiftKey;
        applyRotation(resizeAnn, currentX, currentY, state.originalAnnotation);
        redrawAnnotations(true);
        return;
      }

      const deltaX = currentX - state.dragStartX;
      const deltaY = currentY - state.dragStartY;

      // Restore original and apply resize
      Object.assign(resizeAnn, cloneAnnotation(state.originalAnnotation));
      applyResize(resizeAnn, state.activeHandle, deltaX, deltaY, state.originalAnnotation, e.shiftKey);

      redrawAnnotations(true);
      return;
    }
  }

  // Handle dragging (moving) - supports multi-selection and Ctrl+drag copy
  if (state.isDragging && state.selectedAnnotations.length > 0) {
    const deltaX = currentX - state.dragStartX;
    const deltaY = currentY - state.dragStartY;

    // Ctrl+drag copy: create clones on first meaningful move
    if (state._ctrlDragCopy && !state._ctrlCopiesCreated && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
      const newId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      const selected = state.selectedAnnotations;
      const originals = state.originalAnnotations;

      try {
        if (selected.length > 1) {
          // Restore originals to their positions
          for (let i = 0; i < selected.length; i++) {
            if (originals[i]) {
              Object.assign(selected[i], cloneAnnotation(originals[i]));
            }
          }
          // Create copies and switch selection to them
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
          // Use selectedAnnotations[0] directly (avoid selectedAnnotation getter)
          const ann = selected[0];
          const orig = state.originalAnnotation || originals[0];
          if (ann && orig) {
            // Restore original
            Object.assign(ann, cloneAnnotation(orig));
            // Create copy and switch selection to it
            const copy = cloneAnnotation(orig);
            copy.id = newId();
            state.annotations.push(copy);
            state.selectedAnnotations = [copy];
            state.originalAnnotation = cloneAnnotation(copy);
            state.originalAnnotations = [cloneAnnotation(copy)];
            state._ctrlCopiesCreated = true;

            showProperties(copy);
          } else {
            console.warn('[copy] FAILED: ann=', ann?.id, 'orig=', orig?.id, 'selectedAnnotation=', state.selectedAnnotation?.id);
          }
        }
      } catch (err) {
        console.error('[copy] ERROR during copy creation:', err);
      }
    }

    if (state.selectedAnnotations.length > 1 && state.originalAnnotations.length > 0) {
      // Multi-selection drag
      for (let i = 0; i < state.selectedAnnotations.length; i++) {
        if (state.originalAnnotations[i]) {
          Object.assign(state.selectedAnnotations[i], cloneAnnotation(state.originalAnnotations[i]));
          applyMove(state.selectedAnnotations[i], deltaX, deltaY);
        }
      }
    } else if (state.selectedAnnotations.length === 1) {
      // Single selection drag — use selectedAnnotations[0] directly
      const ann = state.selectedAnnotations[0];
      const orig = state.originalAnnotation || state.originalAnnotations[0];
      if (ann && orig) {
        Object.assign(ann, cloneAnnotation(orig));
        applyMove(ann, deltaX, deltaY);
      } else {
        console.warn('[drag] single drag SKIPPED: ann=', ann?.id, 'orig=', orig?.id,
          'selectedAnnotation=', state.selectedAnnotation?.id, 'originalAnnotation=', state.originalAnnotation?.id);
      }
    }

    redrawAnnotations(true);
    return;
  }

  // Handle polyline preview
  if (state.currentTool === 'polyline' && state.isDrawingPolyline && state.polylinePoints.length > 0) {
    const polyPrefs = state.preferences;
    // Snap cursor position for preview
    const polyPreviewSnap = performSnap(currentX, currentY, state.annotations, state.currentPage, state.scale, null, state.polylinePoints);
    const polySnapX = polyPreviewSnap.snapped ? polyPreviewSnap.x : currentX;
    const polySnapY = polyPreviewSnap.snapped ? polyPreviewSnap.y : currentY;
    state.lastSnapResult = polyPreviewSnap.snapped ? polyPreviewSnap : null;
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = polyPrefs.polylineStrokeColor;
    annotationCtx.lineWidth = polyPrefs.polylineLineWidth;
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    // Draw existing points
    state.polylinePoints.forEach((point, index) => {
      if (index === 0) {
        annotationCtx.moveTo(point.x, point.y);
      } else {
        annotationCtx.lineTo(point.x, point.y);
      }
    });
    // Draw line to snapped cursor position
    annotationCtx.lineTo(polySnapX, polySnapY);
    annotationCtx.stroke();
    // Draw snap indicator
    if (polyPreviewSnap.snapped) {
      drawSnapIndicator(annotationCtx, polyPreviewSnap, state.scale);
    }
    annotationCtx.restore();
    return;
  }

  // Handle measureArea / measurePerimeter preview
  if ((state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') &&
      state.measurePoints && state.measurePoints.length > 0) {
    const mPrefs = state.preferences;
    const mColor = mPrefs.measureStrokeColor || '#FF0000';
    // Object snap for measurement preview (including in-progress vertices)
    const mPreviewSnap = performSnap(currentX, currentY, state.annotations, state.currentPage, state.scale, null, state.measurePoints);
    state.lastSnapResult = mPreviewSnap.snapped ? mPreviewSnap : null;
    redrawAnnotations();
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    annotationCtx.strokeStyle = mColor;
    annotationCtx.lineWidth = mPrefs.measureLineWidth || 1;
    annotationCtx.globalAlpha = (mPrefs.measureOpacity || 100) / 100;
    annotationCtx.setLineDash([4, 2]);
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';

    // Use object snap if available, otherwise angle snap
    let snapX = mPreviewSnap.snapped ? mPreviewSnap.x : currentX;
    let snapY = mPreviewSnap.snapped ? mPreviewSnap.y : currentY;
    if (!mPreviewSnap.snapped && e.shiftKey && mPrefs.enableAngleSnap) {
      const last = state.measurePoints[state.measurePoints.length - 1];
      const dx = currentX - last.x;
      const dy = currentY - last.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = snapAngle(angle, mPrefs.angleSnapDegrees) * (Math.PI / 180);
      snapX = last.x + length * Math.cos(snapped);
      snapY = last.y + length * Math.sin(snapped);
    }

    // Build the current set of points including cursor position
    const previewPoints = [...state.measurePoints, { x: snapX, y: snapY }];

    // Draw lines connecting all points
    annotationCtx.beginPath();
    previewPoints.forEach((point, index) => {
      if (index === 0) annotationCtx.moveTo(point.x, point.y);
      else annotationCtx.lineTo(point.x, point.y);
    });

    if (state.currentTool === 'measureArea' && previewPoints.length > 2) {
      // Close the polygon and fill
      annotationCtx.closePath();
      annotationCtx.fillStyle = mColor + '20';
      annotationCtx.fill();
      annotationCtx.stroke();
    } else {
      annotationCtx.stroke();
    }
    annotationCtx.setLineDash([]);

    // Draw vertex markers at placed points
    state.measurePoints.forEach(point => {
      annotationCtx.beginPath();
      annotationCtx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
      annotationCtx.fillStyle = mColor;
      annotationCtx.fill();
    });

    // Draw live measurement text
    annotationCtx.font = '11px Arial';
    annotationCtx.fillStyle = mColor;
    if (state.currentTool === 'measureArea' && previewPoints.length >= 3) {
      const area = calculateArea(previewPoints);
      const areaText = formatMeasurement(area);
      let cx = 0, cy = 0;
      for (const p of previewPoints) { cx += p.x; cy += p.y; }
      cx /= previewPoints.length;
      cy /= previewPoints.length;
      annotationCtx.textAlign = 'center';
      annotationCtx.fillText(areaText, cx, cy);
      annotationCtx.textAlign = 'left';
    } else if (state.currentTool === 'measurePerimeter' && previewPoints.length >= 2) {
      const perim = calculatePerimeter(previewPoints);
      const perimText = formatMeasurement(perim);
      annotationCtx.fillText(perimText, snapX + 8, snapY - 4);
    }

    // Draw snap indicator for measurement preview
    if (mPreviewSnap.snapped) {
      annotationCtx.globalAlpha = 1;
      drawSnapIndicator(annotationCtx, mPreviewSnap, state.scale);
    }
    annotationCtx.globalAlpha = 1;
    annotationCtx.restore();
    return;
  }

  // Show snap indicator when hovering with a drawing tool (before click)
  if (!state.isDrawing) {
    const drawingTools = ['line', 'arrow', 'box', 'circle', 'highlight', 'textbox', 'callout',
      'polygon', 'cloud', 'measureDistance', 'polyline', 'measureArea', 'measurePerimeter'];
    if (drawingTools.includes(state.currentTool)) {
      const hoverSnap = performSnap(currentX, currentY, state.annotations, state.currentPage, state.scale);
      if (hoverSnap.snapped) {
        state.lastSnapResult = hoverSnap;
        redrawAnnotations();
        annotationCtx.save();
        annotationCtx.scale(state.scale, state.scale);
        drawSnapIndicator(annotationCtx, hoverSnap, state.scale);
        annotationCtx.restore();
      } else if (state.lastSnapResult) {
        state.lastSnapResult = null;
        redrawAnnotations();
      }
    }
    return;
  }

  // Drawing preview for various tools
  if (state.currentTool === 'draw') {
    state.currentPath.push({ x: currentX, y: currentY });
    // Draw temporary line with scale
    annotationCtx.save();
    annotationCtx.scale(state.scale, state.scale);
    const drawPrefs = state.preferences;
    annotationCtx.strokeStyle = drawPrefs.drawStrokeColor || getColorPickerValue();
    annotationCtx.lineWidth = drawPrefs.drawLineWidth || getLineWidthValue();
    annotationCtx.globalAlpha = (drawPrefs.drawOpacity || 100) / 100;
    annotationCtx.lineCap = 'round';
    annotationCtx.lineJoin = 'round';
    annotationCtx.beginPath();
    annotationCtx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    annotationCtx.lineTo(currentX, currentY);
    annotationCtx.stroke();
    annotationCtx.globalAlpha = 1;
    annotationCtx.restore();
  } else {
    // Snap cursor position for shape preview (object snap overrides grid snap)
    const shapeSnap = performSnap(currentX, currentY, state.annotations, state.currentPage, state.scale);
    const previewX = shapeSnap.snapped ? shapeSnap.x : currentX;
    const previewY = shapeSnap.snapped ? shapeSnap.y : currentY;
    state.lastSnapResult = shapeSnap.snapped ? shapeSnap : null;
    // Show preview for shape tools
    drawShapePreview(previewX, previewY, e);
  }
}

// Mouse up handler for single page mode
export function handleMouseUp(e) {
  if (isModalDialogOpen()) return;
  // Hand tool panning is handled by document-level listener (handlePanEnd)
  // But still clean up any stuck drag/resize state before returning
  if (state.isPanning) {
    if (state.isDragging || state.isResizing) {
      console.warn('[drag] mouseup while isPanning — clearing stuck drag state. isDragging:', state.isDragging, 'isResizing:', state.isResizing);
      state.isDragging = false;
      state.isResizing = false;
      state.activeHandle = null;
      state.originalAnnotation = null;
      state.originalAnnotations = [];
      state._ctrlDragCopy = false;
      state._ctrlCopiesCreated = false;
      _removeDocumentMouseUp();
    }
    return;
  }

  // Handle rubber band selection end
  if (state.isRubberBanding) {
    state.isRubberBanding = false;
    const rect = annotationCanvas.getBoundingClientRect();
    const endX = (e.clientX - rect.left) / state.scale;
    const endY = (e.clientY - rect.top) / state.scale;

    const rbX = Math.min(state.rubberBandStartX, endX);
    const rbY = Math.min(state.rubberBandStartY, endY);
    const rbW = Math.abs(endX - state.rubberBandStartX);
    const rbH = Math.abs(endY - state.rubberBandStartY);

    // Only select if rubber band has meaningful size
    if (rbW > 3 || rbH > 3) {
      const selected = [];
      for (const ann of state.annotations) {
        if (ann.page !== state.currentPage) continue;
        const bounds = getAnnotationBounds(ann);
        if (!bounds) continue;
        // Check if annotation intersects with rubber band
        if (bounds.x < rbX + rbW && bounds.x + bounds.width > rbX &&
            bounds.y < rbY + rbH && bounds.y + bounds.height > rbY) {
          selected.push(ann);
        }
      }
      if (selected.length > 0) {
        state.selectedAnnotations = selected;
        if (selected.length === 1) {
          showProperties(selected[0]);
        } else {
          showMultiSelectionProperties();
        }
      }
    }
    redrawAnnotations();
    return;
  }

  // Handle end of dragging/resizing
  if (state.isDragging || state.isResizing) {
    if (state._ctrlDragCopy && state._ctrlCopiesCreated) {
      // Ctrl+drag copy: record copies as additions
      for (const ann of state.selectedAnnotations) {
        recordAdd(ann);
      }
      markDocumentModified();
    } else {
      // Record undo for the modification (use array[0] as source of truth)
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
    _removeDocumentMouseUp();
    annotationCanvas.style.cursor = state.currentTool === 'hand' ? 'grab' : 'default';

    // Update properties panel with new values (use array[0] as source of truth)
    if (state.selectedAnnotations.length === 1) {
      showProperties(state.selectedAnnotations[0]);
    } else if (state.selectedAnnotations.length > 1) {
      showMultiSelectionProperties();
    }
    return;
  }

  if (!state.isDrawing) return;

  const rect = annotationCanvas.getBoundingClientRect();
  const rawEndX = (e.clientX - rect.left) / state.scale;
  const rawEndY = (e.clientY - rect.top) / state.scale;
  // Object snap on end point, fall back to grid snap
  const endSnap = performSnap(rawEndX, rawEndY, state.annotations, state.currentPage, state.scale);
  const endX = endSnap.snapped ? endSnap.x : snapToGrid(rawEndX);
  const endY = endSnap.snapped ? endSnap.y : snapToGrid(rawEndY);
  state.lastSnapResult = null;

  const annotationCountBefore = state.annotations.length;

  // Create annotation based on tool
  const currentTool = state.currentTool;
  const ann = createAnnotationFromTool(currentTool, state.startX, state.startY, endX, endY, e);
  if (ann) {
    state.annotations.push(ann);
  }

  state.isDrawing = false;

  // Record add for undo and mark document as modified
  if (state.annotations.length > annotationCountBefore) {
    recordAdd(state.annotations[state.annotations.length - 1]);
  }

  redrawAnnotations();

  // Auto-start text editing for textbox/callout after creation
  if (ann && ['textbox', 'callout'].includes(ann.type)) {
    state.selectedAnnotations = [ann];
    showProperties(ann);
    startTextEditing(ann);
  }
}

// Mouse event handlers for continuous mode
export function handleContinuousMouseDown(e, pageNum) {
  if (isModalDialogOpen()) return;

  // Finish inline text editing when clicking outside
  if (state.isEditingText) {
    finishTextEditing();
  }

  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  const rawX = (e.clientX - rect.left) / state.scale;
  const rawY = (e.clientY - rect.top) / state.scale;

  state.activeContinuousCanvas = canvas;
  state.activeContinuousPage = pageNum;
  state.currentPage = pageNum;

  // Object snap the start point
  const contStartSnap = performSnap(rawX, rawY, state.annotations, pageNum, state.scale);
  state.startX = contStartSnap.snapped ? contStartSnap.x : rawX;
  state.startY = contStartSnap.snapped ? contStartSnap.y : rawY;
  state.lastSnapResult = contStartSnap.snapped ? contStartSnap : null;

  // Handle middle mouse button panning (works regardless of current tool)
  if (e.button === 1) {
    startContinuousPan(e, true);
    return;
  }

  // Handle hand tool (panning, but allow annotation selection and dragging)
  if (state.currentTool === 'hand') {
    const clickedAnnotation = findAnnotationAt(state.startX, state.startY);
    if (clickedAnnotation) {
      if (e.ctrlKey || e.metaKey) {
        if (isSelected(clickedAnnotation)) {
          removeFromSelection(clickedAnnotation);
        } else {
          addToSelection(clickedAnnotation);
        }
        if (state.selectedAnnotations.length === 1) {
          showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          showMultiSelectionProperties();
        } else {
          hideProperties();
        }
      } else {
        state.selectedAnnotations = [clickedAnnotation];
        showProperties(clickedAnnotation);
        state.isDragging = true;
        state.dragStartX = state.startX;
        state.dragStartY = state.startY;
        state.originalAnnotation = cloneAnnotation(clickedAnnotation);
        state.originalAnnotations = [cloneAnnotation(clickedAnnotation)];
        state.activeContinuousCanvas = canvas;
        state.activeContinuousPage = pageNum;
        canvas.style.cursor = 'move';
      }
      redrawContinuous();
    } else {
      clearSelection();
      hideProperties();
      startContinuousPan(e, false);
      redrawContinuous();
    }
    return;
  }

  if (state.currentTool === 'select' || state.currentTool === 'selectComments') {
    const clickedAnnotation = findAnnotationAt(state.startX, state.startY);
    if (clickedAnnotation) {
      // Click on comment: open popup
      if (clickedAnnotation.type === 'comment') {
        state.selectedAnnotations = [clickedAnnotation];
        showProperties(clickedAnnotation);
        openStickyPopup(clickedAnnotation);
        redrawContinuous();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        if (isSelected(clickedAnnotation)) {
          removeFromSelection(clickedAnnotation);
        } else {
          addToSelection(clickedAnnotation);
        }
        if (state.selectedAnnotations.length === 1) {
          showProperties(state.selectedAnnotations[0]);
        } else if (state.selectedAnnotations.length > 1) {
          showMultiSelectionProperties();
        } else {
          hideProperties();
        }
      } else {
        state.selectedAnnotations = [clickedAnnotation];
        showProperties(clickedAnnotation);
      }
      redrawContinuous();
    } else {
      if (!(e.ctrlKey || e.metaKey)) {
        clearSelection();
        hideProperties();
      }
      redrawContinuous();
    }
    return;
  }

  // Edit text tool: first check for textEdit records at click position
  if (state.currentTool === 'editText') {
    const hitEdit = findTextEditAtPosition(state.startX, state.startY, pageNum, canvas);
    if (hitEdit) {
      startTextEditEditing(hitEdit, pageNum, canvas);
    }
    return;
  }

  // Block annotation tools when PDF/A read-only is active
  if (isPdfAReadOnly()) return;

  state.isDrawing = true;

  if (state.currentTool === 'draw') {
    state.currentPath = [{ x: state.startX, y: state.startY }];
  } else if (state.currentTool === 'comment') {
    addComment(state.startX, state.startY);
    state.isDrawing = false;
  } else if (state.currentTool === 'text') {
    addTextAnnotation(state.startX, state.startY, pageNum, canvas);
    state.isDrawing = false;
  }
}

export function handleContinuousMouseMove(e, pageNum) {
  if (isModalDialogOpen()) return;
  // Hand tool panning is handled by document-level listener
  if (state.isPanning) return;

  // Hand tool: change cursor when hovering over annotations
  if (state.currentTool === 'hand') {
    const canvas = e.target;
    const rect = canvas.getBoundingClientRect();
    const hx = (e.clientX - rect.left) / state.scale;
    const hy = (e.clientY - rect.top) / state.scale;
    state.currentPage = pageNum;
    const hoverAnnotation = findAnnotationAt(hx, hy);
    canvas.style.cursor = hoverAnnotation ? 'default' : 'grab';
    return;
  }

  if (!state.isDrawing) return;
  if (state.activeContinuousPage !== pageNum) return;
  if (!state.activeContinuousCanvas) return;

  const canvas = state.activeContinuousCanvas;
  const rect = canvas.getBoundingClientRect();
  const currentX = (e.clientX - rect.left) / state.scale;
  const currentY = (e.clientY - rect.top) / state.scale;
  const ctx = canvas.getContext('2d');

  const prefs = state.preferences;
  if (state.currentTool === 'draw') {
    state.currentPath.push({ x: currentX, y: currentY });
    ctx.strokeStyle = prefs.drawStrokeColor || getColorPickerValue();
    ctx.lineWidth = prefs.drawLineWidth || getLineWidthValue();
    ctx.globalAlpha = (prefs.drawOpacity || 100) / 100;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(state.currentPath[state.currentPath.length - 2].x, state.currentPath[state.currentPath.length - 2].y);
    ctx.lineTo(currentX, currentY);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (['highlight', 'line', 'circle', 'box', 'textbox', 'callout'].includes(state.currentTool)) {
    renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);

    if (state.currentTool === 'highlight') {
      ctx.fillStyle = prefs.highlightColor || getColorPickerValue();
      ctx.globalAlpha = 0.3;
      ctx.fillRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
      ctx.globalAlpha = 1;
    } else if (state.currentTool === 'line') {
      ctx.strokeStyle = prefs.lineStrokeColor || getColorPickerValue();
      ctx.lineWidth = prefs.lineLineWidth || getLineWidthValue();
      ctx.lineCap = 'round';
      if (prefs.lineBorderStyle === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (prefs.lineBorderStyle === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = (prefs.lineOpacity || 100) / 100;
      ctx.beginPath();
      ctx.moveTo(state.startX, state.startY);
      ctx.lineTo(currentX, currentY);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    } else if (state.currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(currentX - state.startX, 2) + Math.pow(currentY - state.startY, 2));
      ctx.strokeStyle = prefs.circleStrokeColor || getColorPickerValue();
      ctx.lineWidth = prefs.circleBorderWidth || getLineWidthValue();
      ctx.beginPath();
      ctx.arc(state.startX, state.startY, radius, 0, 2 * Math.PI);
      ctx.stroke();
    } else if (state.currentTool === 'box') {
      ctx.strokeStyle = prefs.rectStrokeColor || getColorPickerValue();
      ctx.lineWidth = prefs.rectBorderWidth || getLineWidthValue();
      ctx.strokeRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
    } else if (state.currentTool === 'textbox') {
      const tbX = Math.min(state.startX, currentX);
      const tbY = Math.min(state.startY, currentY);
      const tbW = Math.abs(currentX - state.startX);
      const tbH = Math.abs(currentY - state.startY);
      if (!prefs.textboxFillNone) {
        ctx.fillStyle = prefs.textboxFillColor;
        ctx.globalAlpha = (prefs.textboxOpacity || 100) / 100;
        ctx.fillRect(tbX, tbY, tbW, tbH);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = prefs.textboxStrokeColor;
      ctx.lineWidth = prefs.textboxBorderWidth;
      ctx.strokeRect(tbX, tbY, tbW, tbH);
    } else if (state.currentTool === 'callout') {
      const prefs = state.preferences;
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = currentX - defaultWidth / 2;
      const coY = currentY - defaultHeight / 2;
      if (!prefs.calloutFillNone) {
        ctx.fillStyle = prefs.calloutFillColor;
        ctx.globalAlpha = (prefs.calloutOpacity || 100) / 100;
        ctx.fillRect(coX, coY, defaultWidth, defaultHeight);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = prefs.calloutStrokeColor;
      ctx.lineWidth = prefs.calloutBorderWidth;
      ctx.strokeRect(coX, coY, defaultWidth, defaultHeight);
      // Leader line
      const isArrowLeft = state.startX < currentX;
      let armOriginX = isArrowLeft ? coX : coX + defaultWidth;
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, currentY));
      const armLength = Math.min(30, Math.abs(state.startX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      ctx.beginPath();
      ctx.moveTo(armOriginX, armOriginY);
      ctx.lineTo(kneeX, armOriginY);
      ctx.lineTo(state.startX, state.startY);
      ctx.stroke();
    }
  }
}

export function handleContinuousMouseUp(e, pageNum) {
  if (isModalDialogOpen()) return;
  // Hand tool panning is handled by document-level listener
  if (state.isPanning) return;

  if (!state.isDrawing || state.activeContinuousPage !== pageNum) return;

  const rect = state.activeContinuousCanvas.getBoundingClientRect();
  const rawEndX = (e.clientX - rect.left) / state.scale;
  const rawEndY = (e.clientY - rect.top) / state.scale;
  // Object snap end point
  const contEndSnap = performSnap(rawEndX, rawEndY, state.annotations, pageNum, state.scale);
  const endX = contEndSnap.snapped ? contEndSnap.x : rawEndX;
  const endY = contEndSnap.snapped ? contEndSnap.y : rawEndY;
  state.lastSnapResult = null;

  const annotationCountBefore = state.annotations.length;

  const ann = createContinuousAnnotation(state.currentTool, pageNum, state.startX, state.startY, endX, endY);
  if (ann) {
    state.annotations.push(ann);
  }

  state.isDrawing = false;
  state.activeContinuousCanvas = null;
  state.activeContinuousPage = null;

  // Record add for undo and mark document as modified
  if (state.annotations.length > annotationCountBefore) {
    recordAdd(state.annotations[state.annotations.length - 1]);
  }

  redrawContinuous();

  // Auto-start text editing for textbox/callout after creation
  if (ann && ['textbox', 'callout'].includes(ann.type)) {
    state.selectedAnnotations = [ann];
    showProperties(ann);
    startTextEditing(ann);
  }
}

// Double-click handler for editing textbox/callout annotations.
// Uses the dedicated dblclick event (fires after the full double-click sequence)
// rather than e.detail in mousedown, which can be unreliable when drawing
// operations occur between the two clicks.
export function handleDblClick(e) {
  if (!state.pdfDoc) return;
  if (isPdfAReadOnly()) return;

  const canvas = annotationCanvas || e.target;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / state.scale;
  const y = (e.clientY - rect.top) / state.scale;

  const clickedAnnotation = findAnnotationAt(x, y);
  if (clickedAnnotation) {
    if (['textbox', 'callout'].includes(clickedAnnotation.type)) {
      // Cancel any in-progress drawing that was started by the mousedown events
      state.isDrawing = false;
      state.selectedAnnotations = [clickedAnnotation];
      showProperties(clickedAnnotation);
      startTextEditing(clickedAnnotation);
    } else if (clickedAnnotation.type === 'comment') {
      state.isDrawing = false;
      state.selectedAnnotations = [clickedAnnotation];
      showProperties(clickedAnnotation);
      openStickyPopup(clickedAnnotation);
    }
  }
}

// Continuous mode double-click handler
export function handleContinuousDblClick(e, pageNum) {
  if (!state.pdfDoc) return;
  if (isPdfAReadOnly()) return;

  const canvas = e.target;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / state.scale;
  const y = (e.clientY - rect.top) / state.scale;

  state.currentPage = pageNum;
  const clickedAnnotation = findAnnotationAt(x, y);
  if (clickedAnnotation) {
    if (['textbox', 'callout'].includes(clickedAnnotation.type)) {
      state.isDrawing = false;
      state.selectedAnnotations = [clickedAnnotation];
      showProperties(clickedAnnotation);
      startTextEditing(clickedAnnotation);
    } else if (clickedAnnotation.type === 'comment') {
      state.isDrawing = false;
      state.selectedAnnotations = [clickedAnnotation];
      showProperties(clickedAnnotation);
      openStickyPopup(clickedAnnotation);
    }
  }
}
