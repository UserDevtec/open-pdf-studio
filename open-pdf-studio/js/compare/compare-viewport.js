// Compare viewport orchestration.
// Loads each chosen PDF (re-using cached bytes when available), renders the
// requested page from each into an offscreen canvas at a target scale, and
// either lays them side-by-side or composes them into an overlay.
//
// Public API:
//   renderCompareSideBySide(canvasOld, canvasNew, opts)
//   renderCompareOverlay(canvasOut, opts)
//   getDocPageCount(filePath)
//
// Where opts = { oldPath, newPath, oldPage, newPage, scale, offset }

import * as pdfjsLib from 'pdfjs-dist';
import { getCachedPdfBytes } from '../pdf/loader.js';
import { drawHighlights } from './overlay-renderer.js';
import { detectChanges } from './change-detector.js';
import { setChanges } from './compare-store.js';

// Cap detection resolution to keep CPU bounded on huge pages.
const DETECTION_MAX_DIM = 1600;
let _detectTimer = null;
let _detectSeq = 0;

// Cache of pdfjs documents per filePath used by compare mode only — we don't
// reuse the document loaded by the main viewer because pdf.js transfers the
// underlying buffer; we always slice() bytes from originalBytesCache.
const _docCache = new Map();

async function _getDoc(filePath) {
  if (_docCache.has(filePath)) return _docCache.get(filePath);
  const bytes = getCachedPdfBytes(filePath);
  if (!bytes) throw new Error('Compare: no cached bytes for ' + filePath);
  const doc = await pdfjsLib.getDocument({
    data: bytes.slice(), // pdf.js transfers the buffer — must clone
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  _docCache.set(filePath, doc);
  return doc;
}

export function clearCompareDocCache() {
  for (const d of _docCache.values()) {
    try { d.destroy?.(); } catch {}
  }
  _docCache.clear();
}

export async function getDocPageCount(filePath) {
  if (!filePath) return 0;
  try {
    const d = await _getDoc(filePath);
    return d.numPages;
  } catch {
    return 0;
  }
}

async function _renderPageToCanvas(filePath, pageNum, scale, targetCanvas, fillWhite = true) {
  const doc = await _getDoc(filePath);
  const page = await doc.getPage(Math.max(1, Math.min(doc.numPages, pageNum)));
  const viewport = page.getViewport({ scale });
  targetCanvas.width = Math.ceil(viewport.width);
  targetCanvas.height = Math.ceil(viewport.height);
  const ctx = targetCanvas.getContext('2d');
  if (fillWhite) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
  }
  await page.render({ canvasContext: ctx, viewport, intent: 'display' }).promise;
  return { width: targetCanvas.width, height: targetCanvas.height, viewport };
}

export async function renderCompareSideBySide(canvasOld, canvasNew, opts) {
  const { oldPath, newPath, oldPage, newPage, scale = 1.5 } = opts;
  await Promise.all([
    _renderPageToCanvas(oldPath, oldPage, scale, canvasOld),
    _renderPageToCanvas(newPath, newPage, scale, canvasNew),
  ]);
}

/**
 * Render the compare overlay.
 *
 * The base canvas (canvasNew) shows the NEW page rendered NORMALLY — black ink
 * on white background, no tint. The differences between OLD and NEW are then
 * highlighted by translucent colored rectangles drawn on a separate overlay
 * canvas (canvasHighlights). The OLD canvas is kept hidden (still rasterized
 * for change detection only).
 *
 * Returns { width, height } of the rendered surface so the caller can size
 * its DOM containers.
 */
export async function renderCompareOverlay(canvasOld, canvasNew, opts, canvasHighlights = null) {
  const { oldPath, newPath, oldPage, newPage, scale = 1.5, offset = { dx: 0, dy: 0, rotation: 0 } } = opts;

  // Render NEW normally — this is the visible base layer.
  await _renderPageToCanvas(newPath, newPage, scale, canvasNew);

  // Render OLD into the (hidden) old canvas for completeness; not displayed.
  if (canvasOld) {
    const tmpOldRaw = document.createElement('canvas');
    await _renderPageToCanvas(oldPath, oldPage, scale, tmpOldRaw);

    canvasOld.width = canvasNew.width;
    canvasOld.height = canvasNew.height;
    const oldCtx = canvasOld.getContext('2d');
    oldCtx.fillStyle = '#ffffff';
    oldCtx.fillRect(0, 0, canvasOld.width, canvasOld.height);
    oldCtx.save();
    oldCtx.translate(offset.dx || 0, offset.dy || 0);
    if (offset.rotation) {
      oldCtx.translate(canvasOld.width / 2, canvasOld.height / 2);
      oldCtx.rotate((offset.rotation * Math.PI) / 180);
      oldCtx.translate(-canvasOld.width / 2, -canvasOld.height / 2);
    }
    oldCtx.drawImage(tmpOldRaw, 0, 0);
    oldCtx.restore();
  }

  // Size the highlights canvas to match NEW; the actual rectangles are drawn
  // separately by paintHighlights() once changes are detected.
  if (canvasHighlights) {
    canvasHighlights.width = canvasNew.width;
    canvasHighlights.height = canvasNew.height;
    const ctx = canvasHighlights.getContext('2d');
    ctx.clearRect(0, 0, canvasHighlights.width, canvasHighlights.height);
  }

  // Kick off async, debounced change detection on a separately rasterized copy
  // of both pages. Visual rendering is not blocked.
  scheduleChangeDetection(opts);

  return { width: canvasNew.width, height: canvasNew.height };
}

/**
 * Paint diff highlights onto an overlay canvas. Pure presentation — the change
 * list itself is computed elsewhere (change-detector.js / scheduleChangeDetection).
 *
 * @param {HTMLCanvasElement} canvas
 * @param {Array} changes
 * @param {Object} opts — { ratio, visibleTypes, selected }
 */
export function paintHighlights(canvas, changes, opts) {
  drawHighlights(canvas, changes, opts);
}

/**
 * Off-screen rasterize both pages to plain black-on-white at a bounded
 * resolution and run detectChanges(). Result is pushed into the compare-store.
 * Debounced so rapid zoom/offset changes don't spam the work.
 */
export function scheduleChangeDetection(opts) {
  if (_detectTimer) clearTimeout(_detectTimer);
  const seq = ++_detectSeq;
  _detectTimer = setTimeout(async () => {
    _detectTimer = null;
    try {
      const result = await runChangeDetection(opts);
      // Drop result if a newer detection has been queued.
      if (seq !== _detectSeq) return;
      setChanges(result);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[compare] change detection failed', err);
      if (seq === _detectSeq) setChanges([]);
    }
  }, 200);
}

async function runChangeDetection(opts) {
  const { oldPath, newPath, oldPage, newPage, offset = { dx: 0, dy: 0, rotation: 0 } } = opts;
  if (!oldPath || !newPath) return [];

  // Pick a modest scale capped by DETECTION_MAX_DIM so CPU stays bounded.
  // Use NEW page's natural size at scale=1 to set the target dimensions.
  const newDoc = await _getDoc(newPath);
  const np = await newDoc.getPage(Math.max(1, Math.min(newDoc.numPages, newPage)));
  const baseVp = np.getViewport({ scale: 1 });
  const longest = Math.max(baseVp.width, baseVp.height);
  const detectScale = Math.min(1.5, DETECTION_MAX_DIM / longest);

  const cOld = document.createElement('canvas');
  const cNewRaw = document.createElement('canvas');
  await _renderPageToCanvas(oldPath, oldPage, detectScale, cOld);
  await _renderPageToCanvas(newPath, newPage, detectScale, cNewRaw);

  // Apply alignment offset to OLD so detection respects the same alignment as
  // the visual overlay. NEW remains at native position.
  const cOldAligned = document.createElement('canvas');
  cOldAligned.width = cNewRaw.width;
  cOldAligned.height = cNewRaw.height;
  const aCtx = cOldAligned.getContext('2d');
  aCtx.fillStyle = '#ffffff';
  aCtx.fillRect(0, 0, cOldAligned.width, cOldAligned.height);
  aCtx.save();
  // Scale offsets from display scale to detection scale.
  const visualScale = opts.scale || 1.5;
  const off = {
    dx: (offset.dx || 0) * (detectScale / visualScale),
    dy: (offset.dy || 0) * (detectScale / visualScale),
    rotation: offset.rotation || 0,
  };
  aCtx.translate(off.dx, off.dy);
  if (off.rotation) {
    aCtx.translate(cOldAligned.width / 2, cOldAligned.height / 2);
    aCtx.rotate((off.rotation * Math.PI) / 180);
    aCtx.translate(-cOldAligned.width / 2, -cOldAligned.height / 2);
  }
  aCtx.drawImage(cOld, 0, 0);
  aCtx.restore();

  const oldData = aCtx.getImageData(0, 0, cOldAligned.width, cOldAligned.height);
  const newData = cNewRaw.getContext('2d').getImageData(0, 0, cNewRaw.width, cNewRaw.height);

  const changes = detectChanges(oldData, newData);
  // Tag the detection scale so the UI can map bbox px back to display px.
  return changes.map(c => ({ ...c, detectScale }));
}
