import { state, getActiveDocument, getPageRotation, setPageRotation } from '../core/state.js';
import { isTauri, invoke } from '../core/platform.js';
// Always-fresh DOM refs (never stale regardless of init timing or bundler behavior)
function getPdfCanvas() { return document.getElementById('pdf-canvas'); }
function getAnnotationCanvas() { return document.getElementById('annotation-canvas'); }
import { redrawAnnotations, renderAnnotationsForPage } from '../annotations/rendering.js';
import { ensureAnnotationsForPage, hidePdfABar } from './loader.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { hideProperties } from '../ui/panels/properties-panel.js';
import { getCursorForTool } from '../tools/manager.js';
import { updateActiveThumbnail } from '../ui/panels/left-panel.js';
import { createSinglePageTextLayer, clearSinglePageTextLayer, createTextLayer, clearTextLayers } from '../text/text-layer.js';
import { createSinglePageLinkLayer, clearSinglePageLinkLayer, createLinkLayer, clearLinkLayers } from './link-layer.js';
import { createSinglePageFormLayer, clearSinglePageFormLayer, createFormLayer, clearFormLayers, hideFormFieldsBar } from './form-layer.js';
import { clearPdfVectorCache, prefetchPdfVectorGeometry } from '../tools/pdf-snap-extractor.js';
import { clearDetectionCache } from '../tools/pdf-element-detector.js';
import { onPageRendered, clearHighlights } from '../search/find-bar.js';
// Hi-DPI support: render canvases at device pixel ratio for sharp text
export function getCanvasDPR() { return window.devicePixelRatio || 1; }

// ─── MuPDF WASM Rendering ─────────────────────────────────────────────────
// Uses MuPDF compiled to WASM for 50-100x faster PDF rendering than PDF.js.
// Falls back to PDF.js if mupdf is not available.

let _mupdfModule = null;
let _mupdfAvailable = null;
let _mupdfDocument = null;
let _mupdfDocPath = null; // track which file is loaded

async function loadMupdf() {
  if (_mupdfModule) return _mupdfModule;
  try {
    _mupdfModule = await import('mupdf');
    return _mupdfModule;
  } catch (e) {
    console.warn('[mupdf] WASM module not available:', e);
    return null;
  }
}

async function isMupdfAvailable() {
  if (_mupdfAvailable !== null) return _mupdfAvailable;
  const mod = await loadMupdf();
  _mupdfAvailable = mod !== null;
  return _mupdfAvailable;
}

// Open or reuse a MuPDF document from cached PDF bytes
async function getMupdfDocument(pdfBytes) {
  const mupdf = await loadMupdf();
  if (!mupdf) return null;
  // Reuse if same bytes (check by length — imperfect but fast)
  if (_mupdfDocument && _mupdfDocPath === pdfBytes.length) {
    return _mupdfDocument;
  }
  try {
    if (_mupdfDocument) { try { _mupdfDocument.destroy(); } catch {} }
    _mupdfDocument = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
    _mupdfDocPath = pdfBytes.length;
    return _mupdfDocument;
  } catch (e) {
    console.warn('[mupdf] Failed to open document:', e);
    return null;
  }
}

// Render a page with MuPDF WASM — returns Pixmap as RGBA
async function renderPageWithMupdf(pdfBytes, pageIndex, scale) {
  const mupdf = await loadMupdf();
  if (!mupdf) return null;

  const doc = await getMupdfDocument(pdfBytes);
  if (!doc) return null;

  const page = doc.loadPage(pageIndex);
  const dpr = getCanvasDPR();
  const matrix = mupdf.Matrix.scale(scale * dpr, scale * dpr);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, true);

  const w = pixmap.getWidth();
  const h = pixmap.getHeight();
  const samples = pixmap.getPixels(); // Uint8ClampedArray RGBA

  // Copy samples before destroying pixmap (pixmap owns the memory)
  const rgba = new Uint8ClampedArray(samples);

  page.destroy();
  pixmap.destroy();

  return { rgba, width: w, height: h };
}

// PDF.js rendering helper — used as fallback when pdfium is not available
async function _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr) {
  const offscreen = document.createElement('canvas');
  offscreen.width = bufferW;
  offscreen.height = bufferH;
  const offCtx = offscreen.getContext('2d');

  const renderContext = {
    canvasContext: offCtx,
    viewport: viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    annotationMode: 0,
  };
  if (state.preferences.thinLines) renderContext.enhanceThinLines = true;

  currentRenderTask = page.render(renderContext);
  try {
    await currentRenderTask.promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') return;
    throw e;
  }
  currentRenderTask = null;

  // Atomic swap
  pdfCanvas.width = bufferW;
  pdfCanvas.height = bufferH;
  pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
  pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
  pdfCanvas.getContext('2d').drawImage(offscreen, 0, 0);
}

function setupCanvasHiDPI(canvas, width, height) {
  const dpr = getCanvasDPR();
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = Math.floor(width) + 'px';
  canvas.style.height = Math.floor(height) + 'px';
}

// Track current render task to cancel if needed
let currentRenderTask = null;

// Render PDF page (single page mode)
export async function renderPage(pageNum) {
  // Clear search highlights immediately to prevent stale highlights
  // from appearing at wrong positions during canvas resize
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  // Validate page number against THIS document's page count
  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;

  // Cancel any ongoing render task and wait for it to finish
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
      await currentRenderTask.promise;
    } catch (e) {
      // Ignore cancel/RenderingCancelledException errors
    }
    currentRenderTask = null;
  }

  const page = await pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale };
  if (extraRotation) {
    viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(viewportOpts);

  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  const dpr = getCanvasDPR();
  const bufferW = Math.floor(viewport.width * dpr);
  const bufferH = Math.floor(viewport.height * dpr);

  // Try Rust open-pdf-render first (pure Rust, fast), fall back to PDF.js
  const _t0 = performance.now();
  const _canUseTauri = isTauri();
  const _hasFilePath = !!doc.filePath;
  let _skipBitmapRender = false;

  // ─── VECTOR VIEWPORT MODE ──────────────────────────────────────────────
  // Extract draw commands once, then hand off to pdf-viewport.js render loop.
  // All zoom/pan is handled by the viewport — no re-rendering needed here.
  if (_canUseTauri && _hasFilePath) {
    try {
      const vr = await import('./vector-renderer.js');
      if (!vr.hasCachedCommands(doc.filePath, pageNum)) {
        const pageType = await invoke('analyze_page_type', { path: doc.filePath, pageIndex: pageNum - 1 });
        if (pageType === 'vector') {
          const cmdData = await invoke('extract_draw_commands', { path: doc.filePath, pageIndex: pageNum - 1 });
          const cmdBytes = cmdData instanceof Uint8Array ? cmdData : new Uint8Array(cmdData);
          vr.cacheCommands(doc.filePath, pageNum, cmdBytes);
          // Pre-decode any images in the command buffer (async, must complete before render)
          await vr.prepareImages(doc.filePath, pageNum);
        }
      }

      if (vr.hasCachedCommands(doc.filePath, pageNum)) {
        const dims = vr.getCachedPageDimensions(doc.filePath, pageNum);
        if (dims) {
          const { initViewport, setPage, wireEvents, viewport: pdfVP } = await import('./pdf-viewport.js');

          // Initialize viewport (idempotent — safe to call multiple times)
          initViewport(pdfCanvas, () => {
            import('../annotations/rendering.js').then(m => m.redrawAnnotations());
          });
          if (!pdfCanvas._vpEventsWired) {
            wireEvents(pdfCanvas);
            pdfCanvas._vpEventsWired = true;
          }
          const container = document.getElementById('pdf-container');
          if (container) container.style.overflow = 'hidden';

          // Load page into viewport (triggers fitToViewport + first render)
          setPage(doc.filePath, pageNum, dims.w, dims.h, dims.x0 || 0, dims.y0 || 0);

          // Create text layer for text selection + search (one-time per page)
          try {
            const page = await pdfDoc.getPage(pageNum);
            const textViewport = page.getViewport({ scale: 1.0 });
            await createSinglePageTextLayer(page, textViewport);
            // Force viewport re-render so text layer transform gets applied
            if (window.__pdfViewport) window.__pdfViewport.dirty = true;
          } catch (e) {
            console.warn('[render] Text layer failed:', e);
          }

          console.log(`[render] ✅ Vector viewport: ${dims.w}x${dims.h} pt, origin=(${dims.x0},${dims.y0})`);
          _skipBitmapRender = true;
        }
      }
    } catch (e) {
      console.warn('[render] Vector mode failed:', e);
    }
  }

  if (!_skipBitmapRender && _canUseTauri && _hasFilePath) {
    console.log(`[render] Rust render: page=${pageNum}, scale=${scale}, dpr=${dpr}, path=${doc.filePath}`);
    try {
      // Rust returns RGBA bytes directly as Uint8Array with 8-byte header (width u32 LE + height u32 LE)
      const rgbaData = await invoke('render_pdf_page', {
        path: doc.filePath,
        pageIndex: pageNum - 1,
        scale: scale,
      });
      const _t1 = performance.now();

      // Rust returns "tempPath|width|height" string
      const parts = rgbaData.split('|');
      const tempPath = parts[0];
      const rustW = parseInt(parts[1]);
      const rustH = parseInt(parts[2]);

      // Read RGBA from temp file via Tauri FS (fast binary)
      await invoke('allow_fs_scope', { path: tempPath });
      const { readBinaryFile } = await import('../core/platform.js');
      const fileBytes = await readBinaryFile(tempPath);
      const _t2 = performance.now();

      if (fileBytes && fileBytes.length > 8) {
        const rgba = new Uint8ClampedArray(fileBytes.buffer, fileBytes.byteOffset + 8, fileBytes.length - 8);

        if (rustW * rustH * 4 !== rgba.length) {
          console.warn(`[render] Size mismatch: ${rustW}x${rustH}x4=${rustW*rustH*4} != ${rgba.length}. Fallback.`);
          await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
        } else {
          pdfCanvas.width = rustW;
          pdfCanvas.height = rustH;
          pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
          pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
          const imageData = new ImageData(rgba, rustW, rustH);
          pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
          const _totalMs = Math.round(_t2 - _t0);
          state.renderEngine = 'Rust';
          state.renderTiming = `${_totalMs}ms`;
          console.log(`[render] ✅ Rust OK: ${rustW}x${rustH}, cmd=${Math.round(_t1 - _t0)}ms, read=${Math.round(_t2 - _t1)}ms, total=${_totalMs}ms`);
        }
      } else {
        console.warn(`[render] Empty response. Fallback.`);
        await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
      }
    } catch (e) {
      console.warn(`[render] Rust render FAILED: ${e}. Falling back to PDF.js`);
      await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
      console.log(`[render] PDF.js fallback: ${Math.round(performance.now() - _t0)}ms`);
    }
  } else if (!_skipBitmapRender) {
    console.log(`[render] PDF.js render: page=${pageNum}, tauri=${_canUseTauri}, filePath=${_hasFilePath}`);
    await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
    const _pjsMs = Math.round(performance.now() - _t0);
    state.renderEngine = 'PDF.js';
    state.renderTiming = `${_pjsMs}ms`;
    console.log(`[render] PDF.js done: ${_pjsMs}ms`);
  }

  // Annotation canvas resize is deferred to just before redrawAnnotations()
  // so the clear+redraw happens in one synchronous block (no blink).

  // Set CSS scale variables for PDF.js text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Text/link/form layers: skip during vector zoom (expensive PDF.js operations)
  // Only create on first load or page change, not on every zoom
  if (!_skipBitmapRender || !document.querySelector('.textLayer')) {
    try {
      await createSinglePageTextLayer(page, viewport);
    } catch (e) {
      console.warn('Failed to create text layer:', e);
    }

    try {
      await createSinglePageLinkLayer(page, viewport);
    } catch (e) {
      console.warn('Failed to create link layer:', e);
    }

    try {
      await createSinglePageFormLayer(page, viewport);
    } catch (e) {
      console.warn('Failed to create form layer:', e);
    }

    if (state.currentTool === 'select' || state.currentTool === 'editText') {
      annotationCanvas.style.zIndex = '2';
      annotationCanvas.style.pointerEvents = 'none';
      const container = document.getElementById('canvas-container');
      if (container) {
        container.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
          el.style.pointerEvents = 'none';
        });
      }
    }
  }

  // Ensure annotations for this page are loaded (on-demand if background hasn't reached it yet)
  // Skip heavy operations during vector zoom (only needed on first load / page change)
  if (!_skipBitmapRender || !document.querySelector('.textLayer')) {
    await ensureAnnotationsForPage(pageNum);
    if (state.preferences.snapToPdfContent) {
      prefetchPdfVectorGeometry(pageNum);
    }
  }

  // Resize annotation canvas and redraw in one synchronous block — no blink
  setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
  redrawAnnotations();

  // Re-apply search highlights after re-render
  onPageRendered();

  // Update status bar
  updateAllStatus();
}

// Render page offscreen and swap canvases atomically to avoid zoom flicker.
// The visible canvas keeps its CSS-scaled content until the new render is done.
export async function renderPageOffscreen(pageNum) {
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  if (!Number.isInteger(pageNum) || pageNum < 1 || pageNum > pdfDoc.numPages) return;

  // Cancel any ongoing render
  if (currentRenderTask) {
    try { currentRenderTask.cancel(); await currentRenderTask.promise; } catch {}
    currentRenderTask = null;
  }

  const page = await pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const viewportOpts = { scale };
  if (extraRotation) viewportOpts.rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport(viewportOpts);
  const dpr = getCanvasDPR();

  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  // Try Rust open-pdf-render first, fall back to PDF.js offscreen rendering
  let rustRendered = false;

  if (isTauri() && doc.filePath) {
    try {
      const rgbaData = await invoke('render_pdf_page', {
        path: doc.filePath,
        pageIndex: pageNum - 1,
        scale: scale,
      });
      const _offBytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
      if (_offBytes && _offBytes.length > 8) {
        const headerView = new DataView(_offBytes.buffer, _offBytes.byteOffset, 8);
        const rustW = headerView.getUint32(0, true);
        const rustH = headerView.getUint32(4, true);
        const rgba = new Uint8ClampedArray(_offBytes.buffer, _offBytes.byteOffset + 8, _offBytes.length - 8);
        pdfCanvas.width = rustW;
        pdfCanvas.height = rustH;
        pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
        pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
        const imageData = new ImageData(rgba, rustW, rustH);
        pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
        setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
        rustRendered = true;
      }
    } catch (e) {
      console.warn('[open-pdf-render] Offscreen fallback to PDF.js:', e);
    }
  }

  // Fall back to PDF.js offscreen rendering
  if (!rustRendered) {
    const offPdf = document.createElement('canvas');
    const offW = Math.floor(viewport.width * dpr);
    const offH = Math.floor(viewport.height * dpr);
    offPdf.width = offW;
    offPdf.height = offH;

    const offCtx = offPdf.getContext('2d');
    const renderContext = {
      canvasContext: offCtx,
      viewport,
      transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
      annotationMode: 0
    };
    if (state.preferences.thinLines) renderContext.enhanceThinLines = true;

    currentRenderTask = page.render(renderContext);
    try {
      await currentRenderTask.promise;
    } catch (e) {
      if (e.name === 'RenderingCancelledException') return;
      throw e;
    }
    currentRenderTask = null;

    // Resize visible canvases to match new viewport
    setupCanvasHiDPI(pdfCanvas, viewport.width, viewport.height);
    setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);

    // Copy rendered PDF pixels in one drawImage call (no visible blank frame)
    const visCtx = pdfCanvas.getContext('2d');
    visCtx.drawImage(offPdf, 0, 0);
  }

  // Set CSS scale variables for text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Create text, link, form layers
  try { await createSinglePageTextLayer(page, viewport); } catch {}
  try { await createSinglePageLinkLayer(page, viewport); } catch {}
  try { await createSinglePageFormLayer(page, viewport); } catch {}

  // Re-apply overlay state
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    annotationCanvas.style.zIndex = '2';
    annotationCanvas.style.pointerEvents = 'none';
    if (container) {
      container.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
        el.style.pointerEvents = 'none';
      });
    }
  }

  await ensureAnnotationsForPage(pageNum);
  if (state.preferences.snapToPdfContent) prefetchPdfVectorGeometry(pageNum);
  redrawAnnotations();
  onPageRendered();
  updateAllStatus();
}

// Track which pages have been rendered in continuous mode
const _renderedPages = new Set();
let _renderedPagesScale = null; // scale at which pages were rendered
let _continuousObserver = null;

// Track active continuous page renders for cancellation
const _continuousRenderTasks = new Map(); // pageNum -> RenderTask

// Low-res preview cache for fast initial display
const _lowResCache = new Map(); // pageNum -> { canvas, scale }
const LOW_RES_SCALE = 0.5; // Render at 50% for fast preview

// Render a quick low-res preview of a page (fast, <50ms per page)
async function renderLowResPreview(pdfDoc, pageNum, targetWidth, targetHeight) {
  const cacheKey = pageNum;
  if (_lowResCache.has(cacheKey)) return _lowResCache.get(cacheKey).canvas;

  const page = await pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: LOW_RES_SCALE };
  if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
  const viewport = page.getViewport(vpOpts);

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');

  try {
    await page.render({
      canvasContext: ctx,
      viewport,
      annotationMode: 0,
    }).promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') return null;
    return null;
  }

  _lowResCache.set(cacheKey, { canvas, scale: LOW_RES_SCALE });
  return canvas;
}

// Clear low-res cache (on document close)
export function clearLowResCache() {
  _lowResCache.clear();
}

// Render a single page inside its wrapper (used by lazy rendering)
async function renderContinuousPage(pageNum) {
  if (_renderedPages.has(pageNum)) return;
  _renderedPages.add(pageNum);

  const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
  if (!pageWrapper) return;

  const canvasContainer = pageWrapper.querySelector('.canvas-container-cont');
  if (!canvasContainer) return;

  // Cancel any in-progress render for this page
  if (_continuousRenderTasks.has(pageNum)) {
    try { _continuousRenderTasks.get(pageNum).cancel(); } catch {}
    _continuousRenderTasks.delete(pageNum);
  }

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const page = await doc.pdfDoc.getPage(pageNum);
  const extraRotation = getPageRotation(pageNum);
  const vpOpts = { scale: doc.scale };
  if (extraRotation) {
    vpOpts.rotation = (page.rotate + extraRotation) % 360;
  }
  const viewport = page.getViewport(vpOpts);

  canvasContainer.style.setProperty('--scale-factor', viewport.scale);
  canvasContainer.style.setProperty('--total-scale-factor', viewport.scale);

  // Reuse existing canvases if available (zoom re-render), or create new ones
  let pdfCanvasEl = canvasContainer.querySelector('.pdf-canvas');
  let annotationCanvasEl = canvasContainer.querySelector('.annotation-canvas');
  let isNewPage = false;

  if (!pdfCanvasEl) {
    isNewPage = true;
    pdfCanvasEl = document.createElement('canvas');
    pdfCanvasEl.className = 'pdf-canvas';
    pdfCanvasEl.dataset.page = pageNum;
    pdfCanvasEl.style.display = 'block';
    pdfCanvasEl.style.background = 'white';
    canvasContainer.appendChild(pdfCanvasEl);

    // Show low-res preview immediately while full render runs in background
    setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
    const lowRes = _lowResCache.get(pageNum);
    if (lowRes) {
      const previewCtx = pdfCanvasEl.getContext('2d');
      previewCtx.drawImage(lowRes.canvas, 0, 0, pdfCanvasEl.width, pdfCanvasEl.height);
    }
  }

  if (!annotationCanvasEl) {
    annotationCanvasEl = document.createElement('canvas');
    annotationCanvasEl.className = 'annotation-canvas';
    annotationCanvasEl.dataset.page = pageNum;
    annotationCanvasEl.style.position = 'absolute';
    annotationCanvasEl.style.top = '0';
    annotationCanvasEl.style.left = '0';
    canvasContainer.appendChild(annotationCanvasEl);
  }

  // Update canvas dimensions for new scale
  setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
  setupCanvasHiDPI(annotationCanvasEl, viewport.width, viewport.height);
  annotationCanvasEl.style.cursor = getCursorForTool();

  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    annotationCanvasEl.style.zIndex = '2';
    annotationCanvasEl.style.pointerEvents = 'none';
  }

  // Render PDF page — try Rust open-pdf-render first, fall back to PDF.js
  const pdfCtxEl = pdfCanvasEl.getContext('2d');
  const contDpr = getCanvasDPR();
  let contRustRendered = false;

  if (isTauri() && doc.filePath) {
    try {
      const rgbaData = await invoke('render_pdf_page', {
        path: doc.filePath,
        pageIndex: pageNum - 1,
        scale: doc.scale * contDpr,
      });
      const _contBytes = rgbaData instanceof Uint8Array ? rgbaData : new Uint8Array(rgbaData);
      if (_contBytes && _contBytes.length > 8) {
        const headerView = new DataView(_contBytes.buffer, _contBytes.byteOffset, 8);
        const rustW = headerView.getUint32(0, true);
        const rustH = headerView.getUint32(4, true);
        const rgba = new Uint8ClampedArray(_contBytes.buffer, _contBytes.byteOffset + 8, _contBytes.length - 8);
        pdfCanvasEl.width = rustW;
        pdfCanvasEl.height = rustH;
        pdfCanvasEl.style.width = Math.floor(rustW / contDpr) + 'px';
        pdfCanvasEl.style.height = Math.floor(rustH / contDpr) + 'px';
        const imageData = new ImageData(rgba, rustW, rustH);
        pdfCtxEl.putImageData(imageData, 0, 0);
        contRustRendered = true;
      }
    } catch (e) {
      console.warn(`[open-pdf-render] Continuous page ${pageNum} fallback to PDF.js:`, e);
    }
  }

  if (!contRustRendered) {
    const contRenderContext = {
      canvasContext: pdfCtxEl,
      viewport: viewport,
      transform: contDpr !== 1 ? [contDpr, 0, 0, contDpr, 0, 0] : null,
      annotationMode: 0
    };
    if (state.preferences.thinLines) {
      contRenderContext.enhanceThinLines = true;
    }

    const renderTask = page.render(contRenderContext);
    _continuousRenderTasks.set(pageNum, renderTask);

    try {
      await renderTask.promise;
    } catch (error) {
      if (error.name === 'RenderingCancelledException') return;
      console.error(`Error rendering page ${pageNum}:`, error);
      return;
    } finally {
      _continuousRenderTasks.delete(pageNum);
    }
  }

  // Create text layer
  try {
    await createTextLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create text layer for page ${pageNum}:`, e);
  }

  // Create link layer
  try {
    await createLinkLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create link layer for page ${pageNum}:`, e);
  }

  // Create form layer
  try {
    await createFormLayer(page, viewport, canvasContainer, pageNum);
  } catch (e) {
    console.warn(`Failed to create form layer for page ${pageNum}:`, e);
  }

  // Re-apply overlay state for newly created form/link layers
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    canvasContainer.querySelectorAll('.formLayer section, .linkLayer .pdf-link').forEach(el => {
      el.style.pointerEvents = 'none';
    });
  }

  // Render annotations
  const annotationCtxEl = annotationCanvasEl.getContext('2d');
  renderAnnotationsForPage(annotationCtxEl, pageNum, viewport.width, viewport.height);

  // Re-apply search highlights after re-render
  onPageRendered();

  // Setup mouse events only for new pages (not re-renders)
  if (isNewPage) {
    setupContinuousPageEvents(annotationCanvasEl, pageNum);
  }
}

// Re-render only visible pages at new scale (keeps existing DOM structure)
export async function reRenderVisibleContinuousPages() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const scale = doc.scale;

  // Mark all pages as needing re-render at new scale
  _renderedPages.clear();
  _renderedPagesScale = scale;

  // Update wrapper dimensions for new scale without destroying canvases
  const continuousContainer = document.getElementById('continuous-container');
  if (!continuousContainer) return;

  for (const wrapper of continuousContainer.querySelectorAll('.page-wrapper')) {
    const pageNum = parseInt(wrapper.dataset.page, 10);
    if (!pageNum) continue;

    const page = await doc.pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale };
    if (extraRotation) vpOpts.rotation = (page.rotate + extraRotation) % 360;
    const viewport = page.getViewport(vpOpts);

    const cc = wrapper.querySelector('.canvas-container-cont');
    if (cc) {
      cc.style.width = `${viewport.width}px`;
      cc.style.height = `${viewport.height}px`;
    }
  }

  // IntersectionObserver will automatically trigger re-render for visible pages
  // Force a re-check by briefly disconnecting and reconnecting
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    continuousContainer.querySelectorAll('.page-wrapper').forEach(wrapper => {
      _continuousObserver.observe(wrapper);
    });
  }
}

// Render all pages (continuous mode) — creates placeholders, lazily renders visible pages
export async function renderContinuous(forceRebuild) {
  // Clear search highlights immediately to prevent stale positions during re-render
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  const continuousContainer = document.getElementById('continuous-container');
  // Cleanup previous observer
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    _continuousObserver = null;
  }
  _renderedPages.clear();
  _renderedPagesScale = scale;

  continuousContainer.innerHTML = '';

  clearTextLayers();
  clearLinkLayers();
  clearFormLayers();

  // First pass: create all page wrappers with correct dimensions (no rendering)
  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const extraRotation = getPageRotation(pageNum);
    const vpOpts = { scale };
    if (extraRotation) {
      vpOpts.rotation = (page.rotate + extraRotation) % 360;
    }
    const viewport = page.getViewport(vpOpts);

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'page-wrapper';
    pageWrapper.dataset.page = pageNum;

    const pageLabel = document.createElement('div');
    pageLabel.className = 'page-number-label';
    pageLabel.textContent = `Page ${pageNum}`;
    pageWrapper.appendChild(pageLabel);

    // Placeholder container with correct dimensions
    const canvasContainer = document.createElement('div');
    canvasContainer.className = 'canvas-container-cont';
    canvasContainer.style.position = 'relative';
    canvasContainer.style.display = 'inline-block';
    canvasContainer.style.width = `${viewport.width}px`;
    canvasContainer.style.height = `${viewport.height}px`;
    canvasContainer.style.background = 'white';
    canvasContainer.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.3)';

    pageWrapper.appendChild(canvasContainer);
    continuousContainer.appendChild(pageWrapper);
  }

  updateAllStatus();

  // Setup IntersectionObserver to lazily render pages as they scroll into view
  const scrollContainer = document.getElementById('pdf-container');
  _continuousObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        if (pageNum && !_renderedPages.has(pageNum)) {
          renderContinuousPage(pageNum);
        }
      }
    }
  }, {
    root: scrollContainer,
    rootMargin: '200px 0px'
  });

  // Observe all page wrappers
  continuousContainer.querySelectorAll('.page-wrapper').forEach(wrapper => {
    _continuousObserver.observe(wrapper);
  });

  // Fire-and-forget: pre-render low-res previews in background for fast scroll
  // This runs without blocking — pages that scroll into view get full render via observer
  if (pdfDoc.numPages > 1) {
    (async () => {
      for (let p = 1; p <= Math.min(pdfDoc.numPages, 200); p++) {
        if (_lowResCache.has(p)) continue;
        try {
          await renderLowResPreview(pdfDoc, p, 0, 0);
        } catch {}
        // Yield to main thread every 5 pages
        if (p % 5 === 0) await new Promise(r => setTimeout(r, 0));
      }
    })();
  }
}

// Setup pointer events for continuous mode pages
function setupContinuousPageEvents(canvas, pageNum) {
  // Store pageNum in dataset for the dispatcher's resolvePointerCoords
  canvas.dataset.page = pageNum;
  // Import event handlers dynamically to avoid circular dependencies
  import('../tools/tool-dispatcher.js').then(({ handlePointerDown, handlePointerMove, handlePointerUp, handleDblClick }) => {
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('dblclick', handleDblClick);
  });
}

// Switch view mode
export async function setViewMode(mode) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  if (doc) doc.viewMode = mode;
  const singleContainer = document.getElementById('canvas-container');
  const continuousContainer = document.getElementById('continuous-container');

  if (mode === 'single') {
    singleContainer.style.display = 'inline-block';
    continuousContainer.style.display = 'none';
    await renderPage(doc.currentPage);
  } else if (mode === 'continuous') {
    singleContainer.style.display = 'none';
    continuousContainer.style.display = 'flex';
    await renderContinuous();
  }
}

// Go to specific page
export async function goToPage(pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;

  if (pageNum < 1) pageNum = 1;
  if (pageNum > doc.pdfDoc.numPages) pageNum = doc.pdfDoc.numPages;

  if (doc) doc.currentPage = pageNum;
  hideProperties();

  if (doc?.viewMode === 'single') {
    await renderPage(pageNum);
    const pdfContainer = document.getElementById('pdf-container');
    if (pdfContainer) {
      pdfContainer.scrollTop = 0;
    }
  } else {
    // Scroll to page in continuous mode
    const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
    if (pageWrapper) {
      pageWrapper.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Update active thumbnail in left panel
  updateActiveThumbnail();
}

// Zoom controls
export async function zoomIn() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.scale += 0.25;

  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPageOffscreen(doc.currentPage);
  }
}

export async function zoomOut() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (doc.scale > 0.5) {
    doc.scale -= 0.25;

    if (doc.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPageOffscreen(doc.currentPage);
    }
  }
}

export async function setZoom(newScale) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.scale = newScale;

  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPageOffscreen(doc.currentPage);
  }
}

export async function fitWidth() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;

  const page = await doc.pdfDoc.getPage(doc.currentPage);
  const extraRot = getPageRotation(doc.currentPage);
  const fwOpts = { scale: 1 };
  if (extraRot) fwOpts.rotation = (page.rotate + extraRot) % 360;
  const viewport = page.getViewport(fwOpts);
  const container = document.getElementById('pdf-container');
  const containerWidth = container.clientWidth - 40; // padding
  doc.scale = containerWidth / viewport.width;

  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPageOffscreen(doc.currentPage);
  }
}

export async function fitPage() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;

  const page = await doc.pdfDoc.getPage(doc.currentPage);
  const extraRot2 = getPageRotation(doc.currentPage);
  const fpOpts = { scale: 1 };
  if (extraRot2) fpOpts.rotation = (page.rotate + extraRot2) % 360;
  const viewport = page.getViewport(fpOpts);
  const container = document.getElementById('pdf-container');
  const containerWidth = container.clientWidth - 40;
  const containerHeight = container.clientHeight - 40;
  const scaleX = containerWidth / viewport.width;
  const scaleY = containerHeight / viewport.height;
  doc.scale = Math.min(scaleX, scaleY);

  if (doc.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPageOffscreen(doc.currentPage);
  }
}

export async function actualSize() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.scale = 1;

  if (doc.pdfDoc) {
    if (doc.viewMode === 'continuous') {
      await renderContinuous();
    } else {
      await renderPageOffscreen(doc.currentPage);
    }
  }
}

// Rotate the current page by a delta (±90)
// ─── Annotation coordinate transforms for page rotation ─────────────────────

function rotatePoint(px, py, normDelta, oldW, oldH) {
  switch (normDelta) {
    case 90:  return { x: oldH - py, y: px };
    case 270: return { x: py, y: oldW - px };
    case 180: return { x: oldW - px, y: oldH - py };
    default:  return { x: px, y: py };
  }
}

function rotateRect(x, y, w, h, normDelta, oldW, oldH) {
  switch (normDelta) {
    case 90:  return { x: oldH - y - h, y: x, width: h, height: w };
    case 270: return { x: y, y: oldW - x - w, width: h, height: w };
    case 180: return { x: oldW - x - w, y: oldH - y - h, width: w, height: h };
    default:  return { x, y, width: w, height: h };
  }
}

function recalcBoundsFromPoints(ann, pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  ann.x = minX; ann.y = minY;
  ann.width = maxX - minX; ann.height = maxY - minY;
}

function rotateAnnotation(ann, normDelta, oldW, oldH) {
  if (normDelta === 0) return;
  let boundsHandled = false;

  // Path-based (draw/freehand)
  if (ann.path && ann.path.length > 0) {
    ann.path = ann.path.map(p => rotatePoint(p.x, p.y, normDelta, oldW, oldH));
    recalcBoundsFromPoints(ann, ann.path);
    boundsHandled = true;
  }

  // Points-based (polygon, polyline, cloud, measureArea, measurePerimeter)
  if (ann.points && ann.points.length > 0) {
    ann.points = ann.points.map(p => rotatePoint(p.x, p.y, normDelta, oldW, oldH));
    recalcBoundsFromPoints(ann, ann.points);
    boundsHandled = true;
  }

  // Line endpoints (line, arrow, measureDistance)
  if (ann.startX != null && ann.startY != null && ann.endX != null && ann.endY != null) {
    const s = rotatePoint(ann.startX, ann.startY, normDelta, oldW, oldH);
    const e = rotatePoint(ann.endX, ann.endY, normDelta, oldW, oldH);
    ann.startX = s.x; ann.startY = s.y;
    ann.endX = e.x; ann.endY = e.y;
    ann.x = Math.min(s.x, e.x); ann.y = Math.min(s.y, e.y);
    ann.width = Math.abs(e.x - s.x); ann.height = Math.abs(e.y - s.y);
    boundsHandled = true;
  }

  // MeasureDistance leader lines
  if (ann.leaderStartX != null && ann.leaderStartY != null) {
    const ls = rotatePoint(ann.leaderStartX, ann.leaderStartY, normDelta, oldW, oldH);
    ann.leaderStartX = ls.x; ann.leaderStartY = ls.y;
  }
  if (ann.leaderEndX != null && ann.leaderEndY != null) {
    const le = rotatePoint(ann.leaderEndX, ann.leaderEndY, normDelta, oldW, oldH);
    ann.leaderEndX = le.x; ann.leaderEndY = le.y;
  }

  // Callout arrow/knee/armOrigin points
  if (ann.arrowX != null && ann.arrowY != null) {
    const a = rotatePoint(ann.arrowX, ann.arrowY, normDelta, oldW, oldH);
    ann.arrowX = a.x; ann.arrowY = a.y;
  }
  if (ann.kneeX != null && ann.kneeY != null) {
    const k = rotatePoint(ann.kneeX, ann.kneeY, normDelta, oldW, oldH);
    ann.kneeX = k.x; ann.kneeY = k.y;
  }
  if (ann.armOriginX != null && ann.armOriginY != null) {
    const ao = rotatePoint(ann.armOriginX, ann.armOriginY, normDelta, oldW, oldH);
    ann.armOriginX = ao.x; ann.armOriginY = ao.y;
  }

  // Text markup rects (textHighlight, textStrikethrough, textUnderline)
  if (ann.rects && ann.rects.length > 0) {
    ann.rects = ann.rects.map(r => rotateRect(r.x, r.y, r.width, r.height, normDelta, oldW, oldH));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const r of ann.rects) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
      if (r.y + r.height > maxY) maxY = r.y + r.height;
    }
    ann.x = minX; ann.y = minY;
    ann.width = maxX - minX; ann.height = maxY - minY;
    boundsHandled = true;
  }

  // Visual-content annotations: rotate center, keep w/h, add rotation property
  const visualTypes = new Set(['text', 'textbox', 'callout', 'stamp', 'image', 'signature']);
  if (!boundsHandled && visualTypes.has(ann.type) && ann.x != null && ann.y != null && ann.width != null && ann.height != null) {
    const cx = ann.x + ann.width / 2;
    const cy = ann.y + ann.height / 2;
    const rc = rotatePoint(cx, cy, normDelta, oldW, oldH);
    ann.x = rc.x - ann.width / 2;
    ann.y = rc.y - ann.height / 2;
    ann.rotation = ((ann.rotation || 0) + normDelta) % 360;
    boundsHandled = true;
  }

  // Bounding box for rect-only annotations (box, circle, highlight, etc.)
  if (!boundsHandled && ann.x != null && ann.y != null) {
    if (ann.width != null && ann.height != null) {
      const nr = rotateRect(ann.x, ann.y, ann.width, ann.height, normDelta, oldW, oldH);
      ann.x = nr.x; ann.y = nr.y; ann.width = nr.width; ann.height = nr.height;
    } else {
      const p = rotatePoint(ann.x, ann.y, normDelta, oldW, oldH);
      ann.x = p.x; ann.y = p.y;
    }
  }
}

function rotateAnnotationsForPage(pageNum, normDelta, oldW, oldH) {
  const doc = getActiveDocument();
  if (!doc) return;
  const annotations = doc.annotations;
  if (!annotations || annotations.length === 0) return;
  for (const ann of annotations) {
    if (ann.page === pageNum) {
      rotateAnnotation(ann, normDelta, oldW, oldH);
    }
  }
}

export async function rotatePage(delta, targetPage) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  const pageNum = targetPage || doc.currentPage;
  const current = getPageRotation(pageNum);

  // Get old viewport dimensions (at current rotation) for annotation transform
  const page = await doc.pdfDoc.getPage(pageNum);
  const oldViewport = page.getViewport({ scale: 1, rotation: (page.rotate + current) % 360 });
  const normDelta = ((delta % 360) + 360) % 360;

  // Transform annotation coordinates to match new rotation
  rotateAnnotationsForPage(pageNum, normDelta, oldViewport.width, oldViewport.height);

  setPageRotation(pageNum, current + delta);

  // Mark document as modified
  if (doc) doc.modified = true;

  // Re-render
  if (doc?.viewMode === 'continuous') {
    await renderContinuous();
  } else {
    await renderPage(pageNum);
  }

  // Update thumbnails
  const { invalidateThumbnail } = await import('../ui/panels/left-panel.js');
  invalidateThumbnail(pageNum);
}

// Clear the PDF view when no document is open
export function clearPdfView() {
  import('./mupdf-renderer.js').then(m => m.closeDocument());
  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  // Clear single page mode canvases
  const pdfCtx = pdfCanvas.getContext('2d');
  pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  const annotationCtx = annotationCanvas.getContext('2d');
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Clear caches
  _lowResCache.clear();
  _renderedPages.clear();
  _renderedPagesScale = null;

  // Clear continuous mode container
  const continuousContainer = document.getElementById('continuous-container');
  if (continuousContainer) {
    continuousContainer.innerHTML = '';
  }

  // Clear PDF vector snap cache
  clearPdfVectorCache();

  // Clear element detection cache
  clearDetectionCache();

  // Clear text, link, and form layers
  clearSinglePageTextLayer();
  clearTextLayers();
  clearSinglePageLinkLayer();
  clearLinkLayers();
  clearSinglePageFormLayer();
  clearFormLayers();
  hideFormFieldsBar();
  hidePdfABar();

  // Show placeholder if no documents open
  const placeholder = document.getElementById('placeholder');
  const pdfContainer = document.getElementById('pdf-container');
  if (placeholder) placeholder.style.display = 'flex';
  if (pdfContainer) pdfContainer.classList.remove('visible');

  // Update status bar (derives from reactive state)
  updateAllStatus();
}

// ─── Self-test: call from DevTools console with window.__testRender() ──────
// Tests the full rendering pipeline and reports what engine is used.
if (typeof window !== 'undefined') {
  window.__testRender = async function(filePath) {
    const testPath = filePath || String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;
    console.log('=== Render Self-Test ===');
    console.log('Path:', testPath);
    console.log('isTauri():', isTauri());

    // Step 1: Test Rust render command directly
    if (isTauri()) {
      try {
        console.log('Testing invoke("render_pdf_page")...');
        const t0 = performance.now();
        const result = await invoke('render_pdf_page', { path: testPath, pageIndex: 0, scale: 1.5 });
        const elapsed = Math.round(performance.now() - t0);
        if (result && result.length > 8) {
          // Parse 8-byte header: width (u32 LE) + height (u32 LE)
          const hdr = new DataView(result.buffer, result.byteOffset, 8);
          const w = hdr.getUint32(0, true);
          const h = hdr.getUint32(4, true);
          const rgbaLen = result.length - 8;
          console.log(`✅ Rust render: ${w}x${h}, ${rgbaLen} bytes (${rgbaLen === w*h*4 ? 'size OK' : 'SIZE MISMATCH'}), ${elapsed}ms`);

          // Draw to canvas to verify
          const canvas = document.getElementById('pdf-canvas');
          if (canvas && w * h * 4 === rgbaLen) {
            canvas.width = w;
            canvas.height = h;
            canvas.style.width = Math.floor(w / (window.devicePixelRatio || 1)) + 'px';
            canvas.style.height = Math.floor(h / (window.devicePixelRatio || 1)) + 'px';
            const rgba = result.slice(8);
            const imgData = new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w, h);
            canvas.getContext('2d').putImageData(imgData, 0, 0);
            document.getElementById('placeholder')?.style.setProperty('display', 'none');
            document.getElementById('pdf-container')?.classList.add('visible');
            console.log('✅ Drawn to canvas');
          }
        } else {
          console.log('❌ Rust render returned empty or too small:', result?.length);
        }
      } catch (e) {
        console.log('❌ Rust render error:', e);
      }
    } else {
      console.log('⚠️ Not in Tauri — Rust render unavailable, PDF.js will be used');
    }

    // Step 2: Test via the full renderPage pipeline
    const doc = getActiveDocument();
    if (doc) {
      console.log('Active doc:', doc.filePath, 'page:', doc.currentPage, 'scale:', doc.scale);
      console.log('Calling renderPage()...');
      const t0 = performance.now();
      await renderPage(doc.currentPage || 1);
      console.log(`renderPage() total: ${Math.round(performance.now() - t0)}ms`);
    } else {
      console.log('No active document. Open a PDF first, then run __testRender() again.');
    }
    console.log('=== End Self-Test ===');
  };

  window.__testRustDirect = async function(filePath) {
    const testPath = filePath || String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;
    if (!isTauri()) { console.log('Not in Tauri'); return; }
    try {
      console.log('Invoking render_pdf_page directly...');
      const t0 = performance.now();
      const rgba = await invoke('render_pdf_page', { path: testPath, pageIndex: 0, scale: 1.5 });
      const elapsed = Math.round(performance.now() - t0);
      console.log(`Result: ${rgba?.length || 0} bytes in ${elapsed}ms`);
      if (rgba && rgba.length > 8) {
        // Parse 8-byte header: width (u32 LE) + height (u32 LE)
        const hdr = new DataView(rgba.buffer, rgba.byteOffset, 8);
        const w = hdr.getUint32(0, true);
        const h = hdr.getUint32(4, true);
        const pixels = new Uint8ClampedArray(rgba.buffer, rgba.byteOffset + 8, rgba.length - 8);
        console.log(`Dimensions: ${w}x${h}, RGBA: ${pixels.length} bytes`);
        const canvas = document.getElementById('pdf-canvas');
        if (canvas && w * h * 4 === pixels.length) {
          canvas.width = w;
          canvas.height = h;
          canvas.style.width = (w / (window.devicePixelRatio || 1)) + 'px';
          canvas.style.height = (h / (window.devicePixelRatio || 1)) + 'px';
          const imgData = new ImageData(pixels, w, h);
          canvas.getContext('2d').putImageData(imgData, 0, 0);
          document.getElementById('placeholder')?.style.setProperty('display', 'none');
          document.getElementById('pdf-container')?.classList.add('visible');
          console.log(`Drawn to canvas: ${w}x${h}`);
        }
      }
    } catch (e) {
      console.log('❌ Error:', e);
    }
  };
}
