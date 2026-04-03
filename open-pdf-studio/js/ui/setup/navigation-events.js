import { state, getActiveDocument } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { renderPage, renderPageOffscreen, renderContinuous, goToPage } from '../../pdf/renderer.js';
import { showLoading, hideLoading } from '../chrome/dialogs.js';
import { clearHighlights } from '../../search/find-bar.js';
import { getTool } from '../../tools/tool-registry.js';

// Setup wheel zoom
let _zoomRenderTimer = null;
let _zoomBaseScale = null; // scale at which the canvas was last truly rendered
let _pageNavCooldown = false; // prevent rapid page flipping from wheel events

export function setupWheelZoom() {
  document.querySelector('.main-view')?.addEventListener('wheel', async (e) => {
    const activeDoc = getActiveDocument();
    if (!activeDoc?.pdfDoc) return;

    // Delegate wheel to active tool first (e.g. arc bulge adjustment)
    const _wheelTool = getTool(state.currentTool);
    if (_wheelTool && _wheelTool.onWheel) {
      const _wheelCtx = { state, redraw: () => {
        if (getActiveDocument()?.viewMode === 'continuous') renderContinuous();
        // For single-page mode a lightweight redraw suffices but we import
        // the annotation renderer lazily to avoid circular deps
        else import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
      }};
      _wheelTool.onWheel(_wheelCtx, e);
      if (e.defaultPrevented) return;
    }

    // Check if Ctrl key is pressed for zoom functionality
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();

      const doc = state.documents[state.activeDocumentIndex];
      if (!doc) return;

      const minZoom = 0.25;
      const maxZoom = 10.0;
      const oldScale = doc.scale;

      // Multiplicative zoom: smooth at all levels, works with trackpad pinch too
      // Mouse wheel deltaY is ~+-100 per tick, trackpad gives smaller values
      const factor = Math.pow(0.999, e.deltaY);
      doc.scale = Math.min(Math.max(doc.scale * factor, minZoom), maxZoom);

      // Round to avoid floating point noise (e.g. 0.9999999 -> 1.0)
      doc.scale = Math.round(doc.scale * 1000) / 1000;

      if (doc.scale === oldScale) return;

      const scrollContainer = document.getElementById('pdf-container');
      if (!scrollContainer) return;

      const isContinuous = doc.viewMode === 'continuous';
      const canvas = isContinuous
        ? document.querySelector('#continuous-container .annotation-canvas')
        : annotationCanvas;
      if (!canvas) return;

      // Record the scale at which the canvas was actually rendered
      if (_zoomBaseScale === null) _zoomBaseScale = oldScale;

      // Anchor zoom to mouse cursor
      const canvasRect = canvas.getBoundingClientRect();
      const mouseOnCanvasX = e.clientX - canvasRect.left;
      const mouseOnCanvasY = e.clientY - canvasRect.top;
      const docX = mouseOnCanvasX / oldScale;
      const docY = mouseOnCanvasY / oldScale;

      // Clear search highlights immediately so they don't appear at wrong
      // positions while the canvas is CSS-scaled. They are recreated after
      // the full render via onPageRendered().
      clearHighlights();

      // Scale canvases via CSS width/height for instant flicker-free feedback.
      // Unlike CSS transform, this updates layout (centering, scroll area)
      // without clearing the canvas pixel buffer.
      // c.width is physical pixels (= CSS width × DPR), so divide by DPR to get CSS base.
      const cssScale = doc.scale / _zoomBaseScale;
      const _dpr = window.devicePixelRatio || 1;
      const canvasSelector = isContinuous
        ? '#continuous-container canvas'
        : '#canvas-container canvas';
      document.querySelectorAll(canvasSelector).forEach(c => {
        c.style.width = Math.round(c.width / _dpr * cssScale) + 'px';
        c.style.height = Math.round(c.height / _dpr * cssScale) + 'px';
      });

      // Scroll so that the document point stays under the mouse cursor
      const newCanvasRect = canvas.getBoundingClientRect();
      const newPointViewportX = newCanvasRect.left + docX * doc.scale;
      const newPointViewportY = newCanvasRect.top + docY * doc.scale;
      scrollContainer.scrollLeft += newPointViewportX - e.clientX;
      scrollContainer.scrollTop += newPointViewportY - e.clientY;

      // Debounce: only re-render after user STOPS zooming (500ms idle).
      // The CSS-scaled canvas stays visible — no freeze, no flicker.
      if (_zoomRenderTimer) clearTimeout(_zoomRenderTimer);
      _zoomRenderTimer = setTimeout(async () => {
        _zoomRenderTimer = null;
        _zoomBaseScale = null;

        // Fire-and-forget background render — don't await, don't block UI
        if (isContinuous) {
          document.querySelectorAll(canvasSelector).forEach(c => {
            c.style.width = '';
            c.style.height = '';
          });
          renderContinuous(true).catch(() => {});
        } else {
          const curDoc = state.documents[state.activeDocumentIndex];
          const pageNum = curDoc ? curDoc.currentPage : 1;
          // Render in background — CSS-scaled version stays visible until done
          renderPageOffscreen(pageNum).catch(() => {});
        }
      }, 500);

      return;
    }

    // Page navigation in single page mode (without Ctrl)
    if (getActiveDocument()?.viewMode !== 'single') return;
    if (_pageNavCooldown) return;

    const pdfContainer = document.getElementById('pdf-container');
    if (!pdfContainer) return;
    const scrollTop = pdfContainer.scrollTop;
    const scrollHeight = pdfContainer.scrollHeight;
    const clientHeight = pdfContainer.clientHeight;

    // At low zoom the page fits entirely in the viewport — no scrollbar.
    // Scroll thresholds don't work here, so treat it as always at boundary.
    const canScroll = scrollHeight > clientHeight + 1;
    const atBottom = !canScroll || scrollTop + clientHeight >= scrollHeight - 5;
    const atTop = !canScroll || scrollTop <= 5;

    // Scrolling down at the bottom (or page fits in viewport)
    if (e.deltaY > 0 && atBottom) {
      if (activeDoc.currentPage < activeDoc.pdfDoc.numPages) {
        e.preventDefault();
        _pageNavCooldown = true;
        await goToPage(activeDoc.currentPage + 1);
        pdfContainer.scrollTop = 0;
        setTimeout(() => { _pageNavCooldown = false; }, 300);
      }
    }
    // Scrolling up at the top (or page fits in viewport)
    else if (e.deltaY < 0 && atTop) {
      if (activeDoc.currentPage > 1) {
        e.preventDefault();
        _pageNavCooldown = true;
        await goToPage(activeDoc.currentPage - 1);
        // Scroll to bottom of previous page only if it needs scrolling
        if (pdfContainer.scrollHeight > pdfContainer.clientHeight + 1) {
          pdfContainer.scrollTop = pdfContainer.scrollHeight - pdfContainer.clientHeight;
        }
        setTimeout(() => { _pageNavCooldown = false; }, 300);
      }
    }
  }, { passive: false });
}

// Cancel any pending zoom render (call when switching documents)
export function cancelPendingZoom() {
  if (_zoomRenderTimer) {
    clearTimeout(_zoomRenderTimer);
    _zoomRenderTimer = null;
  }
  if (_zoomBaseScale !== null) {
    // Clear CSS inline sizing left by the zoom preview
    document.querySelectorAll('#canvas-container canvas, #continuous-container canvas').forEach(c => {
      c.style.width = '';
      c.style.height = '';
    });
    _zoomBaseScale = null;
  }
}
