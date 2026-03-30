import { state, getActiveDocument, getPageRotation, setPageRotation } from '../core/state.js';
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

  // Render PDF to an offscreen canvas so the visible canvas keeps its old
  // content (possibly CSS-scaled) until the new pixels are ready.
  const offscreen = document.createElement('canvas');
  offscreen.width = bufferW;
  offscreen.height = bufferH;
  const offCtx = offscreen.getContext('2d');

  const renderContext = {
    canvasContext: offCtx,
    viewport: viewport,
    transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
    annotationMode: 0 // DISABLE - annotations are rendered by the app's overlay canvas
  };

  if (state.preferences.thinLines) {
    renderContext.enhanceThinLines = true;
  }

  currentRenderTask = page.render(renderContext);

  try {
    await currentRenderTask.promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException') {
      return; // Render was cancelled, don't proceed
    }
    throw e;
  }

  currentRenderTask = null;

  // Atomic swap: resize the visible canvas and blit the offscreen content
  // in the same synchronous block — no visible blank frame.
  pdfCanvas.width = bufferW;
  pdfCanvas.height = bufferH;
  pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
  pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
  pdfCanvas.getContext('2d').drawImage(offscreen, 0, 0);

  // Annotation canvas resize is deferred to just before redrawAnnotations()
  // so the clear+redraw happens in one synchronous block (no blink).

  // Set CSS scale variables for PDF.js text/annotation layers
  const container = document.getElementById('canvas-container');
  if (container) {
    container.style.setProperty('--scale-factor', viewport.scale);
    container.style.setProperty('--total-scale-factor', viewport.scale);
  }

  // Create text layer for text selection
  try {
    await createSinglePageTextLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create text layer:', e);
  }

  // Create link layer for clickable links
  try {
    await createSinglePageLinkLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create link layer:', e);
  }

  // Create form layer for interactive form fields
  try {
    await createSinglePageFormLayer(page, viewport);
  } catch (e) {
    console.warn('Failed to create form layer:', e);
  }

  // Re-apply overlay state for newly created layers (setTool may not have run yet)
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

  // Ensure annotations for this page are loaded (on-demand if background hasn't reached it yet)
  await ensureAnnotationsForPage(pageNum);

  // Prefetch PDF vector geometry for snap-to-drawing (fire-and-forget)
  if (state.preferences.snapToPdfContent) {
    prefetchPdfVectorGeometry(pageNum);
  }

  // Resize annotation canvas and redraw in one synchronous block — no blink
  setupCanvasHiDPI(annotationCanvas, viewport.width, viewport.height);
  redrawAnnotations();

  // Re-apply search highlights after re-render
  onPageRendered();

  // Update status bar
  updateAllStatus();
}

// Track which pages have been rendered in continuous mode
const _renderedPages = new Set();
let _continuousObserver = null;

// Render a single page inside its wrapper (used by lazy rendering)
async function renderContinuousPage(pageNum) {
  if (_renderedPages.has(pageNum)) return;
  _renderedPages.add(pageNum);

  const pageWrapper = document.querySelector(`.page-wrapper[data-page="${pageNum}"]`);
  if (!pageWrapper) return;

  const canvasContainer = pageWrapper.querySelector('.canvas-container-cont');
  if (!canvasContainer) return;

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

  // Create PDF canvas (hi-DPI)
  const pdfCanvasEl = document.createElement('canvas');
  pdfCanvasEl.className = 'pdf-canvas';
  setupCanvasHiDPI(pdfCanvasEl, viewport.width, viewport.height);
  pdfCanvasEl.dataset.page = pageNum;
  pdfCanvasEl.style.display = 'block';
  pdfCanvasEl.style.background = 'white';

  // Create annotation canvas (hi-DPI)
  const annotationCanvasEl = document.createElement('canvas');
  annotationCanvasEl.className = 'annotation-canvas';
  setupCanvasHiDPI(annotationCanvasEl, viewport.width, viewport.height);
  annotationCanvasEl.dataset.page = pageNum;
  annotationCanvasEl.style.position = 'absolute';
  annotationCanvasEl.style.top = '0';
  annotationCanvasEl.style.left = '0';
  annotationCanvasEl.style.cursor = getCursorForTool();
  // Apply text-access overrides if select or editText tool is active
  if (state.currentTool === 'select' || state.currentTool === 'editText') {
    annotationCanvasEl.style.zIndex = '2';
    annotationCanvasEl.style.pointerEvents = 'none';
  }

  canvasContainer.appendChild(pdfCanvasEl);
  canvasContainer.appendChild(annotationCanvasEl);

  // Render PDF page
  const pdfCtxEl = pdfCanvasEl.getContext('2d');
  const contDpr = getCanvasDPR();
  const contRenderContext = {
    canvasContext: pdfCtxEl,
    viewport: viewport,
    transform: contDpr !== 1 ? [contDpr, 0, 0, contDpr, 0, 0] : null,
    annotationMode: 0
  };
  if (state.preferences.thinLines) {
    contRenderContext.enhanceThinLines = true;
  }
  try {
    await page.render(contRenderContext).promise;
  } catch (error) {
    console.error(`Error rendering page ${pageNum}:`, error);
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

  // Setup mouse events
  setupContinuousPageEvents(annotationCanvasEl, pageNum);
}

// Render all pages (continuous mode) — creates placeholders, lazily renders visible pages
export async function renderContinuous() {
  // Clear search highlights immediately to prevent stale positions during re-render
  clearHighlights();

  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.pdfDoc) return;
  const pdfDoc = doc.pdfDoc;
  const scale = doc.scale;

  // Cleanup previous observer
  if (_continuousObserver) {
    _continuousObserver.disconnect();
    _continuousObserver = null;
  }
  _renderedPages.clear();

  const continuousContainer = document.getElementById('continuous-container');
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
    await renderPage(doc.currentPage);
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
      await renderPage(doc.currentPage);
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
    await renderPage(doc.currentPage);
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
    await renderPage(doc.currentPage);
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
    await renderPage(doc.currentPage);
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
      await renderPage(doc.currentPage);
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
  const pdfCanvas = getPdfCanvas();
  const annotationCanvas = getAnnotationCanvas();
  if (!pdfCanvas || !annotationCanvas) return;

  // Clear single page mode canvases
  const pdfCtx = pdfCanvas.getContext('2d');
  pdfCtx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  const annotationCtx = annotationCanvas.getContext('2d');
  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

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
