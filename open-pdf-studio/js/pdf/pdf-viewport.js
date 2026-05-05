// pdf-viewport.js — Unified viewport: fixed canvas, transform zoom/pan, RAF loop.
// Modeled after Open2D Studio's CADRenderer pattern.
// The ONLY render path for PDF pages. No fallback, no CSS-scale, no debounce.

import { renderVectorPage } from './vector-renderer.js';
import { state, getActiveDocument } from '../core/state.js';
import { findAnnotationAt as _findAnnotationAt } from '../annotations/geometry.js';
import {
  computeZoomBucket,
  getBestAvailableBitmap,
  ensureBitmap,
  getCachedBitmap,
} from './page-bitmap-cache.js';

// ─── Viewport State (singleton via window to survive HMR/dynamic imports) ───
if (!window.__pdfViewport) {
  window.__pdfViewport = {
    zoom: 1.5,
    offsetX: 0,
    offsetY: 0,
    pageW: 0,
    pageH: 0,
    originX: 0,      // MediaBox x0 (can be negative)
    originY: 0,      // MediaBox y0 (can be negative)
    filePath: null,
    pageNum: 1,
    rotation: 0,    // user-applied rotation (0/90/180/270) — part of cache key
    dirty: true,
    active: false,
  };
}
export const viewport = window.__pdfViewport;

let _canvas = null;
let _ctx = null;
let _rafId = 0;
let _annotationRedraw = null; // callback for annotation overlay
let _resizeObserver = null;

// ─── Init / Teardown ────────────────────────────────────────────────────────

export function initViewport(canvas, annotationRedrawFn) {
  // Stop previous loop if re-initializing
  if (_rafId) cancelAnimationFrame(_rafId);
  _canvas = canvas;
  _ctx = canvas.getContext('2d');
  _annotationRedraw = annotationRedrawFn || null;
  _resizeCanvas();
  window.removeEventListener('resize', _resizeCanvas);
  window.addEventListener('resize', _resizeCanvas);

  // ResizeObserver on #pdf-container — fires whenever the container's box
  // size changes for ANY reason (right panel toggled, properties panel
  // opened, palettes shown/hidden, ribbon collapsed, …). Without this the
  // canvas keeps its old width when a side panel opens, the clamp uses the
  // stale (too-large) canvas width, and the user can pan the page off into
  // the area covered by the panel — visible as grey on the right edge.
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  const container = document.getElementById('pdf-container');
  if (container && typeof ResizeObserver !== 'undefined') {
    _resizeObserver = new ResizeObserver(() => _resizeCanvas());
    _resizeObserver.observe(container);
  }

  _startLoop();
}

export function destroyViewport() {
  viewport.active = false;
  cancelAnimationFrame(_rafId);
  window.removeEventListener('resize', _resizeCanvas);
  if (_resizeObserver) {
    _resizeObserver.disconnect();
    _resizeObserver = null;
  }
  _canvas = null;
  _ctx = null;
}

// Canvas backing-store DPR multiplier. window.devicePixelRatio (1.0–3.0 typical)
// is multiplied so the canvas pixel grid matches the screen pixel grid, giving
// crisp rendering on HiDPI displays. CSS dimensions stay logical-px so all
// existing coordinate math (mouse, panning, zoom) keeps working unchanged.
function _getDpr() { return window.devicePixelRatio || 1; }

function _resizeCanvas() {
  if (!_canvas) return;
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  const dpr = _getDpr();
  const bw = Math.round(w * dpr);
  const bh = Math.round(h * dpr);
  if (_canvas.width !== bw || _canvas.height !== bh) {
    // Re-anchor: capture the world (PDF-space) point currently at the canvas
    // center BEFORE resizing, then restore it AFTER.
    const oldVpW = _canvas.width / dpr;
    const oldVpH = _canvas.height / dpr;
    let worldCenterX = null;
    let worldCenterY = null;
    if (oldVpW > 0 && oldVpH > 0 && viewport.zoom > 0 && viewport.pageW > 0) {
      worldCenterX = (oldVpW / 2 - viewport.offsetX) / viewport.zoom;
      worldCenterY = (oldVpH / 2 - viewport.offsetY) / viewport.zoom;
    }

    // Backing store at device-pixel resolution; CSS at logical-pixel size
    _canvas.width = bw;
    _canvas.height = bh;
    _canvas.style.width = w + 'px';
    _canvas.style.height = h + 'px';

    // Annotation + highlight canvases stay in CSS-pixel backing for now (existing
    // coordinate math uses canvas.width as CSS pixels). The PDF canvas is the only
    // one that needs HiDPI backing for crisp rendering.
    const ann = container.querySelector('.annotation-canvas, #annotation-canvas');
    if (ann && (ann.width !== w || ann.height !== h)) {
      ann.width = w;
      ann.height = h;
    }
    const hl = container.querySelector('#text-highlight-canvas');
    if (hl && (hl.width !== w || hl.height !== h)) {
      hl.width = w;
      hl.height = h;
    }

    if (worldCenterX !== null) {
      viewport.offsetX = w / 2 - worldCenterX * viewport.zoom;
      viewport.offsetY = h / 2 - worldCenterY * viewport.zoom;
    }

    viewport.dirty = true;
  }
}

// ─── Render Loop ────────────────────────────────────────────────────────────

function _startLoop() {
  function tick() {
    if (viewport.dirty && viewport.active) {
      viewport.dirty = false;
      _render();
    }
    _rafId = requestAnimationFrame(tick);
  }
  _rafId = requestAnimationFrame(tick);
}

// Single source of truth for offset validity:
//   - If the page fits an axis, center it on that axis.
//   - Otherwise clamp the offset so the page can't be dragged off-screen.
// Called at the top of every render so any code path that mutates
// zoom/offset gets corrected before the next paint.
export function clampAndCenter() {
  if (!_canvas || !viewport.pageW || !viewport.pageH) return;
  // Use CSS-pixel viewport size (backing is dpr * css)
  const dpr = _getDpr();
  const vpW = _canvas.width / dpr;
  const vpH = _canvas.height / dpr;
  const pageScreenW = viewport.pageW * viewport.zoom;
  const pageScreenH = viewport.pageH * viewport.zoom;

  // When the user has explicitly anchored the view (zoom-to-cursor, pan),
  // do NOT auto-center even if the page now fits the axis — otherwise the
  // anchor point drifts back to the viewport center on the very next frame.
  // Only clamp to keep the page fully on-screen.
  const anchored = _anchorActive;

  if (pageScreenW <= vpW) {
    if (anchored) {
      const minX = 0;                  // page left can't go past viewport left
      const maxX = vpW - pageScreenW;  // page right can't go past viewport right
      if (viewport.offsetX < minX) viewport.offsetX = minX;
      if (viewport.offsetX > maxX) viewport.offsetX = maxX;
    } else {
      // Fits horizontally → center
      viewport.offsetX = (vpW - pageScreenW) / 2;
    }
  } else {
    // Doesn't fit → clamp so neither edge crosses the viewport edge
    const minX = vpW - pageScreenW; // page right edge == viewport right edge
    const maxX = 0;                  // page left edge == viewport left edge
    if (viewport.offsetX < minX) viewport.offsetX = minX;
    if (viewport.offsetX > maxX) viewport.offsetX = maxX;
  }

  if (pageScreenH <= vpH) {
    if (anchored) {
      const minY = 0;
      const maxY = vpH - pageScreenH;
      if (viewport.offsetY < minY) viewport.offsetY = minY;
      if (viewport.offsetY > maxY) viewport.offsetY = maxY;
    } else {
      viewport.offsetY = (vpH - pageScreenH) / 2;
    }
  } else {
    const minY = vpH - pageScreenH;
    const maxY = 0;
    if (viewport.offsetY < minY) viewport.offsetY = minY;
    if (viewport.offsetY > maxY) viewport.offsetY = maxY;
  }
}

// Sticky flag set by zoom-to-cursor / pan / setZoomAtPoint. Once the user
// has positioned the view themselves, clampAndCenter() must NOT auto-center
// on a fit-axis. Reset by fitToViewport(), page nav, and resize, which are
// the legitimate "re-center" entry points.
let _anchorActive = false;
export function clearAnchor() { _anchorActive = false; }
export function markAnchored() { _anchorActive = true; }

function _render() {
  if (!_ctx || !_canvas || !viewport.filePath) return;
  // CSS-pixel viewport (backing is dpr-scaled). All math below stays in CSS px;
  // the dpr multiplier is folded into the canvas transform so output
  // hits device pixels and stays crisp on HiDPI displays.
  const dpr = _getDpr();
  const vpW = _canvas.width / dpr;
  const vpH = _canvas.height / dpr;

  // Always clamp + auto-center BEFORE drawing so a page that fits the
  // viewport ends up centered no matter how we got here (zoom out, resize,
  // page nav, etc.).
  clampAndCenter();

  // Reset transform and clear (in device-pixel space)
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, _canvas.width, _canvas.height);

  // Background (outside page area)
  _ctx.fillStyle = '#e0e0e0';
  _ctx.fillRect(0, 0, _canvas.width, _canvas.height);

  // White page background — SAME transform as vector commands, multiplied by dpr
  _ctx.save();
  _ctx.setTransform(viewport.zoom * dpr, 0, 0, viewport.zoom * dpr, viewport.offsetX * dpr, viewport.offsetY * dpr);
  _ctx.transform(1, 0, 0, -1, 0, viewport.pageH);
  _ctx.translate(-viewport.originX, -viewport.originY); // MediaBox origin offset
  _ctx.fillStyle = '#ffffff';
  _ctx.fillRect(viewport.originX, viewport.originY, viewport.pageW, viewport.pageH);
  _ctx.restore();

  // Vector content (multiply zoom and offsets by dpr for HiDPI rasterization)
  _ctx.save();
  renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
    a: viewport.zoom * dpr,
    b: 0,
    c: 0,
    d: viewport.zoom * dpr,
    e: viewport.offsetX * dpr,
    f: viewport.offsetY * dpr,
  }, viewport.rotation);
  _ctx.restore();

  // Status bar
  state.renderEngine = 'Vector';

  // Sync text layer with viewport.
  // PDF.js text layer (0,0) = page top-left at scale=1.
  // Page top-left on screen = (offsetX, offsetY).
  const textLayer = document.querySelector('.textLayer');
  if (textLayer) {
    const tx = viewport.offsetX;
    const ty = viewport.offsetY;
    // The text layer lives in PDF user space (origin top-left after Y flip).
    // We size spans with --font-height in PDF points and let CSS compute
    // font-size = --total-scale-factor * --font-height. Setting the factor
    // to 1 means spans use raw PDF point sizes; the matrix transform below
    // scales the entire layer to match the canvas zoom. This keeps text
    // selection pixel-aligned with the rendered glyphs at any zoom level.
    textLayer.style.setProperty('--total-scale-factor', '1');
    // Sized to the unscaled PDF page; the matrix transform handles zoom.
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.width = `${viewport.pageW}px`;
    textLayer.style.height = `${viewport.pageH}px`;
    textLayer.style.transform = `matrix(${viewport.zoom}, 0, 0, ${viewport.zoom}, ${tx}, ${ty})`;
    textLayer.style.transformOrigin = '0 0';
    // Text layer: keep pointer-events as set by tool manager (don't override)
    // The tool manager sets pointer-events based on active tool (text select = auto, other = none)
    textLayer.style.opacity = '1';

    // Set up selection highlight styles (once)
    if (!textLayer._selectionStyled) {
      textLayer._selectionStyled = true;
      const style = document.createElement('style');
      style.textContent = `
        .textLayer span { color: transparent !important; }
        .textLayer ::selection { background: rgba(0, 100, 255, 0.3) !important; }
      `;
      textLayer.prepend(style);
    }
  }

  // Annotation overlay — sync with viewport transform
  const annCanvas = document.getElementById('annotation-canvas');
  if (annCanvas) {
    // Keep annotation canvas same size as pdf canvas
    if (annCanvas.width !== vpW || annCanvas.height !== vpH) {
      annCanvas.width = vpW;
      annCanvas.height = vpH;
    }
    // In vector mode: annotation canvas must match PDF canvas exactly (no DPR scaling)
    // Remove any legacy DPR-based CSS sizing from setupCanvasHiDPI()
    annCanvas.style.width = '';
    annCanvas.style.height = '';
    // Sync doc.scale so legacy code that reads it gets viewport zoom
    const doc = state.documents?.[state.activeDocumentIndex];
    if (doc) doc.scale = viewport.zoom;
  }
  // Keep the text-highlight canvas perfectly mirrored to the annotation canvas
  const hlCanvas = document.getElementById('text-highlight-canvas');
  if (hlCanvas) {
    if (hlCanvas.width !== vpW || hlCanvas.height !== vpH) {
      hlCanvas.width = vpW;
      hlCanvas.height = vpH;
    }
    hlCanvas.style.width = '';
    hlCanvas.style.height = '';
  }
  if (_annotationRedraw) {
    try { _annotationRedraw(); } catch {}
  }
}

// ─── Load Page ──────────────────────────────────────────────────────────────

// When true, the next setPage() call leaves zoom/offset alone instead of
// running fitToViewport(), even if the file path changes. Mostly obsolete
// now that page-change-within-same-document automatically preserves zoom,
// but kept for any caller that explicitly wants to force the no-fit path.
let _suppressNextFit = false;
export function suppressNextFit() { _suppressNextFit = true; }

export function setPage(filePath, pageNum, pageW, pageH, originX, originY, rotation) {
  // Detect "first time loading this document" vs "navigating to a different
  // page within the same document". The first case should fit-to-viewport
  // (initial load convention); the second must preserve the current zoom
  // (so prev/next/keyboard/wheel/thumbnail nav doesn't reset what the user
  // chose). Identify the document by file path — that's stable across all
  // page navigation but changes when a different file is opened.
  const isNewDocument = viewport.filePath !== filePath;

  viewport.filePath = filePath;
  viewport.pageNum = pageNum;
  viewport.pageW = pageW;
  viewport.pageH = pageH;
  viewport.originX = originX || 0;
  viewport.originY = originY || 0;
  viewport.rotation = rotation || 0;
  viewport.active = true;

  if (_suppressNextFit) {
    _suppressNextFit = false;
    // suppressNextFit() is used by wheel-driven page nav, which then calls
    // alignPageToTop/Bottom to set its own offset → keep anchor active so
    // clampAndCenter doesn't auto-center over that explicit positioning.
    _anchorActive = true;
    viewport.dirty = true;
  } else if (isNewDocument) {
    // First time we're seeing this file → fit to viewport
    fitToViewport();
  } else {
    // Same document, different page → keep the user's zoom and let
    // clampAndCenter() (in the next _render) center the new page if it
    // fits, or clamp the old offsets if it doesn't. Clear the anchor so
    // a fitting page actually does re-center on this transition.
    _anchorActive = false;
    viewport.dirty = true;
  }
}

/// Compute the zoom factor needed to fit a page into a canvas under one of
/// the standard fit modes. SINGLE SOURCE OF TRUTH for fit math — every
/// fit-to-* path in the app should call this instead of computing its own
/// `min(canvasW/pageW, canvasH/pageH)`-style expression.
///
/// @param {'page'|'width'|'height'} mode  How to fit
/// @param {number} pageW    Page width in PDF user units (post-rotation)
/// @param {number} pageH    Page height in PDF user units (post-rotation)
/// @param {number} canvasW  Available canvas / container width in pixels
/// @param {number} canvasH  Available canvas / container height in pixels
/// @param {number} [padding=0]  Pixels of breathing room around the page on
///                              each side (the canvasW/H is shrunk by 2x
///                              this before computing). Pass 0 for edge-to-edge.
/// @returns {number}  The zoom factor (multiplier from PDF units to pixels)
export function computeFitZoom(mode, pageW, pageH, canvasW, canvasH, padding = 0) {
  const availW = Math.max(1, canvasW - padding * 2);
  const availH = Math.max(1, canvasH - padding * 2);
  switch (mode) {
    case 'width':  return availW / pageW;
    case 'height': return availH / pageH;
    case 'page':
    default:       return Math.min(availW / pageW, availH / pageH);
  }
}

export function fitToViewport() {
  if (!_canvas || !viewport.pageW) return;
  // CSS-pixel viewport (backing store is dpr-scaled)
  const dpr = _getDpr();
  const cssW = _canvas.width / dpr;
  const cssH = _canvas.height / dpr;
  viewport.zoom = computeFitZoom('page', viewport.pageW, viewport.pageH, cssW, cssH, 0);
  const scaledW = viewport.pageW * viewport.zoom;
  const scaledH = viewport.pageH * viewport.zoom;
  viewport.offsetX = (cssW - scaledW) / 2;
  viewport.offsetY = (cssH - scaledH) / 2;
  // Re-centering reset: discard any prior zoom-to-cursor anchor so
  // clampAndCenter() resumes auto-centering on fit-axis as before.
  _anchorActive = false;
  viewport.dirty = true;
}

// ─── Zoom ───────────────────────────────────────────────────────────────────

// Discrete zoom levels — same set used by professional PDF viewers.
// Roughly geometric, with finer steps near 100% where users zoom most.
export const ZOOM_STEPS = [
  0.0625, 0.125, 0.25, 0.333, 0.50, 0.667, 0.75, 0.80, 0.90,
  1.00, 1.10, 1.25, 1.50, 1.75, 2.00, 2.50, 3.00, 4.00, 6.00,
  8.00, 12.00, 16.00, 24.00, 32.00, 64.00,
];
const ZOOM_MIN = ZOOM_STEPS[0];
const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];

// Find the next snap level above (direction=+1) or below (-1) the current zoom.
// Uses a small relative epsilon so being "almost exactly" at a step still
// counts as past it (otherwise repeated wheel ticks at e.g. 1.0 would never
// move because 1.0 is technically not strictly less than 1.0).
function nextZoomStep(current, direction) {
  const eps = current * 1e-4;
  if (direction > 0) {
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      if (ZOOM_STEPS[i] > current + eps) return ZOOM_STEPS[i];
    }
    return ZOOM_MAX;
  } else {
    for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
      if (ZOOM_STEPS[i] < current - eps) return ZOOM_STEPS[i];
    }
    return ZOOM_MIN;
  }
}

// Re-anchor pan offsets so the world point under (screenX, screenY) stays
// pinned while zoom changes from oldZoom → newZoom.
function _anchorAt(screenX, screenY, oldZoom, newZoom) {
  const wx = (screenX - viewport.offsetX) / oldZoom;
  const wy = (screenY - viewport.offsetY) / oldZoom;
  viewport.offsetX = screenX - wx * newZoom;
  viewport.offsetY = screenY - wy * newZoom;
  viewport.zoom = newZoom;
  // The user has explicitly placed the view at this anchor point.
  // Tell clampAndCenter() not to override it with auto-centering even if
  // the page fits an axis at the new zoom level.
  _anchorActive = true;
  viewport.dirty = true;
}

// Snap to the next/previous discrete zoom level, anchored at a cursor point.
// direction: +1 = zoom in, -1 = zoom out
export function zoomStepAtPoint(screenX, screenY, direction) {
  const oldZoom = viewport.zoom;
  const newZoom = nextZoomStep(oldZoom, direction);
  if (newZoom === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, newZoom);
}

// Continuous (multiplicative) zoom. Kept for callers that want non-snapped
// zoom — e.g. animated keyboard zoom. Wheel zoom uses zoomStepAtPoint.
export function zoomAtPoint(screenX, screenY, factor) {
  const oldZoom = viewport.zoom;
  const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, oldZoom * factor));
  if (newZoom === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, newZoom);
}

// Set the zoom level absolutely, anchored at a specific screen point.
// Use this for the status-bar zoom input ("type 200% + Enter") and any
// other UI that wants to set an exact zoom value.
export function setZoomAtPoint(screenX, screenY, newZoom) {
  const oldZoom = viewport.zoom;
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
  if (clamped === oldZoom) return;
  _anchorAt(screenX, screenY, oldZoom, clamped);
}

// Convenience: zoom in/out by one preset step, anchored at the canvas
// center. Used by the status-bar +/- buttons and the toolbar zoom buttons.
export function zoomStepAtCenter(direction) {
  if (!_canvas) return;
  const dpr = _getDpr();
  zoomStepAtPoint((_canvas.width / dpr) / 2, (_canvas.height / dpr) / 2, direction);
}

// ─── Pan ────────────────────────────────────────────────────────────────────

let _isPanning = false, _panStartX = 0, _panStartY = 0;

export function startPan(screenX, screenY) {
  _isPanning = true;
  _panStartX = screenX - viewport.offsetX;
  _panStartY = screenY - viewport.offsetY;
}

export function updatePan(screenX, screenY) {
  if (!_isPanning) return;
  viewport.offsetX = screenX - _panStartX;
  viewport.offsetY = screenY - _panStartY;
  // User has explicitly positioned the view → don't let clampAndCenter
  // snap a fit-axis back to center on the next frame.
  _anchorActive = true;
  viewport.dirty = true;
}

export function endPan() {
  _isPanning = false;
}

export function isPanning() {
  return _isPanning;
}

// ─── Coordinate Conversion ──────────────────────────────────────────────────

export function screenToWorld(sx, sy) {
  return {
    x: (sx - viewport.offsetX) / viewport.zoom,
    y: (sy - viewport.offsetY) / viewport.zoom,
  };
}

export function worldToScreen(wx, wy) {
  return {
    x: wx * viewport.zoom + viewport.offsetX,
    y: wy * viewport.zoom + viewport.offsetY,
  };
}

// ─── Wire Events (call once after canvas is ready) ──────────────────────────

export function wireEvents(canvas) {
  // Wire events on the main-view (above tool dispatcher) for reliable capture
  const mainView = document.querySelector('.main-view') || canvas;

  // NOTE: wheel handling lives in navigation-events.js (single source of truth
  // for zoom + pan + page-nav-at-edges). Don't add a second wheel listener here
  // — they would race and cause panning + instant page jumps on the same event.

  // Pan: middle-click drag, or hand tool left-click drag.
  // Cursor is reactive — we set state.isPanning and js/ui/cursor.js derives
  // the grabbing cursor from it. The cursor module also toggles the body
  // class `pdf-cursor-override` so a CSS rule forces inheritance through
  // child elements that have their own explicit cursor (text spans, links).
  // No body classes, no !important written from this file.
  mainView.addEventListener('pointerdown', (e) => {
    if (!viewport.active) return;
    // Middle button always pans
    if (e.button === 1) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      startPan(e.clientX - rect.left, e.clientY - rect.top);
      mainView.setPointerCapture(e.pointerId);
      state.isPanning = true;
      state.isMiddleButtonPanning = true;
      return;
    }
    // Hand-tool left-click: only pan if NOT clicking on an annotation.
    // If the click is on an annotation, let the event fall through to the
    // annotation-canvas listener so hand-tool.onPointerDown can auto-switch
    // to Select tool and delegate the click for one-click selection.
    if (e.button === 0 && state.currentTool === 'hand') {
      // Hit-test annotations at the click location (in app coords)
      let isOnAnnotation = false;
      try {
        const doc = getActiveDocument();
        if (doc && doc.annotations && doc.annotations.length > 0) {
          const rect = canvas.getBoundingClientRect();
          // Convert client → app coordinates (inverse of viewport transform)
          const cx = e.clientX - rect.left;
          const cy = e.clientY - rect.top;
          const appX = (cx - viewport.offsetX) / viewport.zoom;
          const appY = (cy - viewport.offsetY) / viewport.zoom;
          // Lazy-import findAnnotationAt to avoid static cycle
          const ann = _findAnnotationAt && _findAnnotationAt(appX, appY);
          if (ann) isOnAnnotation = true;
        }
      } catch (_) {}
      if (!isOnAnnotation) {
        e.preventDefault();
        e.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        startPan(e.clientX - rect.left, e.clientY - rect.top);
        mainView.setPointerCapture(e.pointerId);
        state.isPanning = true;
      }
      // else: let the event propagate so hand-tool.onPointerDown can handle it
    }
  }, { capture: true });

  mainView.addEventListener('pointermove', (e) => {
    if (!_isPanning) return;
    const rect = canvas.getBoundingClientRect();
    updatePan(e.clientX - rect.left, e.clientY - rect.top);
  });

  function _endPanAndCursor() {
    if (_isPanning) {
      state.isPanning = false;
      state.isMiddleButtonPanning = false;
    }
    endPan();
  }

  mainView.addEventListener('pointerup', _endPanAndCursor);
  mainView.addEventListener('pointercancel', _endPanAndCursor);
}
