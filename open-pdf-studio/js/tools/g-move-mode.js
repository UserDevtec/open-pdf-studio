// Blender-style G-key move mode.
//
// Activation: pressing 'G' while one or more annotations are selected enters
// move mode. The selection then follows the mouse cursor (no button held).
// While in move mode:
//   - 'X' constrains movement to the X-axis
//   - 'Y' constrains movement to the Y-axis (press the same key again to clear)
//   - Mouse click (left) or 'Enter' commits the new position (records undo)
//   - 'Escape' or right-click cancels and restores original positions
//
// Implementation notes:
//   - originals[] holds deep clones (cloneAnnotation) of each selected annotation
//     captured at G-press time. Restoring from these clones is what makes Esc
//     and lockAxis switching work correctly.
//   - Coordinates are computed from clientX/Y relative to the annotation canvas
//     (single-page mode) or the page-canvas under the cursor (continuous mode),
//     so movement works in both view modes.
//   - Listeners are attached to `document` only while the mode is active and
//     are torn down on commit/cancel — no permanent global listeners.
//
// See GitHub issue #210.

import { state, getActiveDocument } from '../core/state.js';
import { cloneAnnotation } from '../annotations/factory.js';
import { applyMove } from './../annotations/transforms.js';
import { redrawAnnotations, redrawContinuous } from '../annotations/rendering.js';
import { recordModify, recordBulkModify } from '../core/undo-manager.js';
import { isPdfAReadOnly } from '../pdf/loader.js';
import { annotationCanvas } from '../ui/dom-elements.js';

// Annotation types whose position is text-anchored — skip for G-move.
const NON_MOVABLE_TYPES = new Set([
  'textHighlight', 'textStrikethrough', 'textUnderline'
]);

// Module-level mode state. Mirrored onto state.gMoveMode for diagnostics.
let mode = null;

function redraw() {
  if (getActiveDocument()?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function getCanvasAndScale(e) {
  const doc = getActiveDocument();
  const scale = doc?.scale || 1.5;
  if (doc?.viewMode === 'continuous') {
    // Find the annotation-canvas under the pointer
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const canvas = el && el.closest ? el.closest('.annotation-canvas') : null;
    if (canvas) return { canvas, scale };
    return { canvas: null, scale };
  }
  return { canvas: annotationCanvas, scale };
}

function pointerToAppCoords(e) {
  const { canvas, scale } = getCanvasAndScale(e);
  if (!canvas) return null;
  const rect = canvas.getBoundingClientRect();
  const vp = window.__pdfViewport;
  if (vp && vp.active && getActiveDocument()?.viewMode !== 'continuous') {
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    return {
      x: (screenX - vp.offsetX) / vp.zoom,
      y: (screenY - vp.offsetY) / vp.zoom
    };
  }
  return {
    x: (e.clientX - rect.left) / scale,
    y: (e.clientY - rect.top) / scale
  };
}

function applyDeltaToAll(dx, dy) {
  if (!mode) return;
  const targets = mode.targets;
  for (let i = 0; i < targets.length; i++) {
    const ann = targets[i];
    const orig = mode.originals[i];
    if (!ann || !orig) continue;
    // Reset to the original snapshot before applying delta — this lets Esc
    // and axis switching always work from a known-good baseline.
    Object.assign(ann, cloneAnnotation(orig));
    applyMove(ann, dx, dy);
  }
}

function onMouseMove(e) {
  if (!mode) return;
  const c = pointerToAppCoords(e);
  if (!c) return;
  // First valid mousemove seeds the start position if it wasn't established
  // (e.g. cursor was off-canvas at G-press time, so _lastMouseAppX/Y stayed 0).
  // Without this, delta would be huge on the first move and annotations would
  // jump off-screen — particularly noticeable for measureDistance/Area/Perimeter.
  if (!mode.startSeeded) {
    mode.startX = c.x;
    mode.startY = c.y;
    mode.startSeeded = true;
    return;
  }
  let dx = c.x - mode.startX;
  let dy = c.y - mode.startY;
  if (mode.lockAxis === 'x') dy = 0;
  else if (mode.lockAxis === 'y') dx = 0;
  mode.lastDx = dx;
  mode.lastDy = dy;
  applyDeltaToAll(dx, dy);
  redraw();
}

function onKeyDown(e) {
  if (!mode) return;
  // Don't intercept keys while typing in inputs (paranoia — G-mode shouldn't
  // be entered while typing, but guard anyway).
  const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
  if (inInput) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    e.stopPropagation();
    commitMove();
    return;
  }
  if (e.key === 'x' || e.key === 'X') {
    e.preventDefault();
    e.stopPropagation();
    mode.lockAxis = mode.lockAxis === 'x' ? null : 'x';
    // Re-apply delta with new lock
    let dx = mode.lastDx, dy = mode.lastDy;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    applyDeltaToAll(dx, dy);
    redraw();
    return;
  }
  if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault();
    e.stopPropagation();
    mode.lockAxis = mode.lockAxis === 'y' ? null : 'y';
    let dx = mode.lastDx, dy = mode.lastDy;
    if (mode.lockAxis === 'x') dy = 0;
    else if (mode.lockAxis === 'y') dx = 0;
    applyDeltaToAll(dx, dy);
    redraw();
    return;
  }
  // 'G' again toggles off (cancel) — matches Blender muscle memory
  if (e.key === 'g' || e.key === 'G') {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
    return;
  }
}

function onMouseDown(e) {
  if (!mode) return;
  // Left click: commit. Right click: cancel.
  if (e.button === 0) {
    e.preventDefault();
    e.stopPropagation();
    commitMove();
  } else if (e.button === 2) {
    e.preventDefault();
    e.stopPropagation();
    cancelMove();
  }
}

function onContextMenu(e) {
  // Suppress the context menu during G-mode (right-click is "cancel")
  if (mode) {
    e.preventDefault();
    e.stopPropagation();
  }
}

function attachListeners() {
  // Capture phase so we beat the canvas-level handlers (pointerdown etc.)
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('pointermove', onMouseMove, true);
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('pointerdown', onMouseDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('contextmenu', onContextMenu, true);
}

function detachListeners() {
  document.removeEventListener('mousemove', onMouseMove, true);
  document.removeEventListener('pointermove', onMouseMove, true);
  document.removeEventListener('mousedown', onMouseDown, true);
  document.removeEventListener('pointerdown', onMouseDown, true);
  document.removeEventListener('keydown', onKeyDown, true);
  document.removeEventListener('contextmenu', onContextMenu, true);
}

function endMode() {
  detachListeners();
  state.gMoveMode = null;
  mode = null;
  document.body.style.cursor = '';
}

export function isGMoveModeActive() {
  return !!mode;
}

export function commitMove() {
  if (!mode) return;
  const { targets, originals } = mode;
  // Detect any change vs. originals before recording (avoid empty undo entries)
  const changed = targets.some((ann, i) =>
    originals[i] && JSON.stringify(ann) !== JSON.stringify(originals[i])
  );
  if (changed) {
    if (targets.length > 1) {
      recordBulkModify(targets, originals);
    } else if (targets.length === 1) {
      recordModify(targets[0].id, originals[0], targets[0]);
    }
  }
  endMode();
  redraw();
}

export function cancelMove() {
  if (!mode) return;
  // Restore originals
  const { targets, originals } = mode;
  for (let i = 0; i < targets.length; i++) {
    if (targets[i] && originals[i]) {
      Object.assign(targets[i], cloneAnnotation(originals[i]));
    }
  }
  endMode();
  redraw();
}

/**
 * Try to enter G-move mode. Returns true if mode was started, false otherwise.
 * Caller should preventDefault on the keypress when this returns true.
 */
export function tryStartGMove() {
  if (mode) return false; // already active
  if (isPdfAReadOnly()) return false;
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return false;
  const selected = (doc.selectedAnnotations || []).filter(a =>
    a && !a.locked && !NON_MOVABLE_TYPES.has(a.type)
  );
  if (selected.length === 0) return false;

  // Capture starting mouse position from last known cursor coordinates.
  // If we have a recent valid tracker value, use it as start; otherwise the
  // first onMouseMove will seed it via startSeeded.
  const hasTracker = (state._lastMouseAppX != null && state._lastMouseAppY != null);
  const startX = hasTracker ? state._lastMouseAppX : 0;
  const startY = hasTracker ? state._lastMouseAppY : 0;

  mode = {
    active: true,
    targets: selected.slice(),
    originals: selected.map(a => cloneAnnotation(a)),
    lockAxis: null,
    startX,
    startY,
    startSeeded: hasTracker,
    lastDx: 0,
    lastDy: 0
  };
  state.gMoveMode = mode;
  document.body.style.cursor = 'move';
  attachListeners();
  return true;
}

// Track the most recent mouse position (in app-space) so that pressing G
// uses the cursor's current location as the move origin rather than (0,0).
function trackMouse(e) {
  const c = pointerToAppCoords(e);
  if (c) {
    state._lastMouseAppX = c.x;
    state._lastMouseAppY = c.y;
  }
}

let trackingInstalled = false;
export function installGMoveMouseTracker() {
  if (trackingInstalled) return;
  trackingInstalled = true;
  document.addEventListener('mousemove', trackMouse, true);
}
