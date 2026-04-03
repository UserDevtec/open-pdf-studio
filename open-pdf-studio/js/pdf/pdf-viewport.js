// pdf-viewport.js — Unified viewport: fixed canvas, transform zoom/pan, RAF loop.
// Modeled after Open2D Studio's CADRenderer pattern.
// The ONLY render path for PDF pages. No fallback, no CSS-scale, no debounce.

import { renderVectorPage } from './vector-renderer.js';
import { state } from '../core/state.js';

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
    dirty: true,
    active: false,
  };
}
export const viewport = window.__pdfViewport;

let _canvas = null;
let _ctx = null;
let _rafId = 0;
let _annotationRedraw = null; // callback for annotation overlay

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
  _startLoop();
}

export function destroyViewport() {
  viewport.active = false;
  cancelAnimationFrame(_rafId);
  window.removeEventListener('resize', _resizeCanvas);
  _canvas = null;
  _ctx = null;
}

function _resizeCanvas() {
  if (!_canvas) return;
  const container = document.getElementById('pdf-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  if (_canvas.width !== w || _canvas.height !== h) {
    _canvas.width = w;
    _canvas.height = h;
    // Also resize annotation canvas if sibling
    const ann = container.querySelector('.annotation-canvas, #annotation-canvas');
    if (ann && (ann.width !== w || ann.height !== h)) {
      ann.width = w;
      ann.height = h;
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

function _render() {
  if (!_ctx || !_canvas || !viewport.filePath) return;
  const { width: vpW, height: vpH } = _canvas;

  // Reset transform and clear
  _ctx.setTransform(1, 0, 0, 1, 0, 0);
  _ctx.clearRect(0, 0, vpW, vpH);

  // Background (outside page area)
  _ctx.fillStyle = '#e0e0e0';
  _ctx.fillRect(0, 0, vpW, vpH);

  // White page background — SAME transform as vector commands
  _ctx.save();
  _ctx.setTransform(viewport.zoom, 0, 0, viewport.zoom, viewport.offsetX, viewport.offsetY);
  _ctx.transform(1, 0, 0, -1, 0, viewport.pageH);
  _ctx.translate(-viewport.originX, -viewport.originY); // MediaBox origin offset
  _ctx.fillStyle = '#ffffff';
  _ctx.fillRect(viewport.originX, viewport.originY, viewport.pageW, viewport.pageH);
  _ctx.restore();

  // Now draw the vectors (renderVectorPage does setTransform+transform internally)
  _ctx.save();
  renderVectorPage(_ctx, viewport.filePath, viewport.pageNum, {
    a: viewport.zoom,
    b: 0,
    c: 0,
    d: viewport.zoom,
    e: viewport.offsetX,
    f: viewport.offsetY,
  });
  _ctx.restore();

  // Status bar
  state.renderEngine = 'Vector';

  // Sync text layer with viewport.
  // PDF.js text layer (0,0) = top-left of page at scale=1.
  // Our vector canvas has Y-flip: the page top-left in screen coords is
  // at (offsetX, offsetY - pageH * zoom). That's where the text layer top-left goes.
  // For PDFs with non-zero origin, shift by originX/originY.
  const textLayer = document.querySelector('.textLayer');
  if (textLayer) {
    const scaledH = viewport.pageH * viewport.zoom;
    const tx = viewport.offsetX - viewport.originX * viewport.zoom;
    const ty = viewport.offsetY - scaledH - viewport.originY * viewport.zoom;
    textLayer.style.position = 'absolute';
    textLayer.style.left = '0';
    textLayer.style.top = '0';
    textLayer.style.transform = `matrix(${viewport.zoom}, 0, 0, ${viewport.zoom}, ${tx}, ${ty})`;
    textLayer.style.transformOrigin = '0 0';
    textLayer.style.pointerEvents = 'none';
  }

  // Annotation overlay
  if (_annotationRedraw) {
    try { _annotationRedraw(); } catch {}
  }
}

// ─── Load Page ──────────────────────────────────────────────────────────────

export function setPage(filePath, pageNum, pageW, pageH, originX, originY) {
  viewport.filePath = filePath;
  viewport.pageNum = pageNum;
  viewport.pageW = pageW;
  viewport.pageH = pageH;
  viewport.originX = originX || 0;
  viewport.originY = originY || 0;
  viewport.active = true;
  fitToViewport();
}

export function fitToViewport() {
  if (!_canvas || !viewport.pageW) return;
  const pad = 20;
  const availW = _canvas.width - pad * 2;
  const availH = _canvas.height - pad * 2;
  viewport.zoom = Math.min(availW / viewport.pageW, availH / viewport.pageH);
  const scaledW = viewport.pageW * viewport.zoom;
  const scaledH = viewport.pageH * viewport.zoom;
  viewport.offsetX = (_canvas.width - scaledW) / 2;
  viewport.offsetY = (_canvas.height - scaledH) / 2;
  viewport.dirty = true;
}

// ─── Zoom ───────────────────────────────────────────────────────────────────

export function zoomAtPoint(screenX, screenY, factor) {
  const newZoom = Math.max(0.05, Math.min(50, viewport.zoom * factor));
  const wx = (screenX - viewport.offsetX) / viewport.zoom;
  const wy = (screenY - viewport.offsetY) / viewport.zoom;
  viewport.offsetX = screenX - wx * newZoom;
  viewport.offsetY = screenY - wy * newZoom;
  viewport.zoom = newZoom;
  viewport.dirty = true;
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

  // Zoom: Ctrl+wheel. Pan: plain wheel (scroll)
  mainView.addEventListener('wheel', (e) => {
    if (!viewport.active) return;
    if (e.ctrlKey || e.metaKey) {
      // ZOOM
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY > 0 ? 0.92 : 1.08;
      zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, factor);
    } else {
      // PAN via scroll wheel
      e.preventDefault();
      viewport.offsetX -= e.deltaX || 0;
      viewport.offsetY -= e.deltaY || 0;
      viewport.dirty = true;
    }
  }, { passive: false });

  // Pan: middle-click drag, or hand tool left-click drag
  mainView.addEventListener('pointerdown', (e) => {
    if (!viewport.active) return;
    if (e.button === 1 || (e.button === 0 && state.currentTool === 'hand')) {
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      startPan(e.clientX - rect.left, e.clientY - rect.top);
      mainView.setPointerCapture(e.pointerId);
    }
  }, { capture: true });

  mainView.addEventListener('pointermove', (e) => {
    if (!_isPanning) return;
    const rect = canvas.getBoundingClientRect();
    updatePan(e.clientX - rect.left, e.clientY - rect.top);
  });

  mainView.addEventListener('pointerup', () => endPan());
  mainView.addEventListener('pointercancel', () => endPan());
}
