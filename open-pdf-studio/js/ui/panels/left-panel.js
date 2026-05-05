import { state, getActiveDocument, getPageRotation } from '../../core/state.js';
import { drawAnnotation } from '../../annotations/rendering.js';
import { updateAnnotationsList } from './annotations-list.js';
import { updateAttachmentsList } from './attachments.js';
import { updateSignaturesList } from './signatures.js';
import { updateLayersList } from './layers.js';
import { updateFormFieldsList } from './form-fields.js';
import { updateDestinationsList } from './destinations.js';
import { updateTagsList } from './tags.js';
import { updateLinksList } from './links.js';
import { updateBookmarksList } from './bookmarks.js';
import {
  showMessage,
  switchToLeftPanelTab, toggleLeftPanelCollapsed,
  leftPanelActiveTab as activeTab, setLeftPanelActiveTab as setActiveTab,
  setLeftPanelCollapsed as setCollapsed,
  setThumbnailPageCount as setPageCount, setThumbnailActivePage as setActivePage,
  setThumbnailPlaceholderSize as setPlaceholderSize,
  setThumbnailImage, clearAllThumbnails, removeThumbnailImage,
  getThumbnailContainerRef as getContainerRef,
  thumbnailSelectedPages, selectThumbnailPage,
} from '../../bridge.js';

// Thumbnail scale (relative to actual page size)
const THUMBNAIL_SCALE = 0.2;

// Cache for thumbnail data per document: Map<docId, Map<pageNum, imageDataURL>>
const thumbnailCache = new Map();

// Per-doc per-page generation counter. Bumped on invalidateThumbnail() so a
// stale render-completion (annotations changed mid-flight, rapid re-invalidate)
// can be discarded and not overwrite a newer cache entry. See bumpPageGen /
// pageGenMatches usage below.
const pageGeneration = new Map(); // Map<docId, Map<pageNum, int>>

function bumpPageGen(docId, pageNum) {
  let m = pageGeneration.get(docId);
  if (!m) { m = new Map(); pageGeneration.set(docId, m); }
  const g = (m.get(pageNum) || 0) + 1;
  m.set(pageNum, g);
  return g;
}
function getPageGen(docId, pageNum) {
  return pageGeneration.get(docId)?.get(pageNum) || 0;
}
function pageGenMatches(docId, pageNum, gen) {
  return getPageGen(docId, pageNum) === gen;
}

// Store pdfDoc references and state for each document
const documentState = new Map(); // { pdfDoc, numPages, nextPage, startPage }

// Priority queue for visible thumbnails (pages that should load first)
let priorityPages = new Set();

// Track the last scroll position to continue loading from there
let lastVisiblePage = 1;

// Per-document thumbnail scroll position: Map<docId, number>
const thumbnailScrollPositions = new Map();

// Scroll debounce timer
let scrollDebounceTimer = null;

// Track if scroll listener is attached
let scrollListenerAttached = false;

// Initialize left panel
export function initLeftPanel() {
  attachScrollListener();
}

// Attach scroll listener to the thumbnails container via store ref
function attachScrollListener() {
  if (scrollListenerAttached) return;
  const tc = getContainerRef();
  if (tc) {
    tc.addEventListener('scroll', handleThumbnailScroll);
    scrollListenerAttached = true;
  } else {
    // Retry until SolidJS sets the ref
    setTimeout(attachScrollListener, 100);
  }
}

// Handle scroll in thumbnails container - debounced
function handleThumbnailScroll() {
  if (scrollDebounceTimer) {
    clearTimeout(scrollDebounceTimer);
  }

  scrollDebounceTimer = setTimeout(() => {
    updateVisiblePriorities();
  }, 100);
}

// Find visible thumbnails and add them to priority queue
function updateVisiblePriorities() {
  const thumbnailsContainer = getContainerRef();
  if (!thumbnailsContainer) return;

  const activeDoc = getActiveDocument();
  if (!activeDoc) return;

  const docCache = thumbnailCache.get(activeDoc.id);
  if (!docCache) return;

  const docState = documentState.get(activeDoc.id);

  const containerRect = thumbnailsContainer.getBoundingClientRect();
  const thumbnails = thumbnailsContainer.querySelectorAll('.thumbnail-item');

  priorityPages.clear();

  let firstVisiblePage = null;

  thumbnails.forEach(thumb => {
    const thumbRect = thumb.getBoundingClientRect();

    const isVisible = (
      thumbRect.top < containerRect.bottom &&
      thumbRect.bottom > containerRect.top
    );

    if (isVisible) {
      const pageNum = parseInt(thumb.dataset.page);

      if (firstVisiblePage === null) {
        firstVisiblePage = pageNum;
      }

      if (!docCache.has(pageNum)) {
        priorityPages.add(pageNum);
      }
    }
  });

  if (firstVisiblePage !== null && docState) {
    lastVisiblePage = firstVisiblePage;
    docState.nextPage = firstVisiblePage;
    docState.startPage = firstVisiblePage;
    docState.wrapped = false;
  }

  if (priorityPages.size > 0) {
    startProcessor();
  }
}

// Switch between tabs
export function switchLeftPanelTab(panelId) {
  switchToLeftPanelTab(panelId);
  refreshTabContent(panelId);
}

// Refresh whichever tab is currently active (call after loading a new document)
export function refreshActiveTab() {
  const panelId = activeTab();
  if (panelId && panelId !== 'thumbnails') {
    refreshTabContent(panelId);
  }
}

export function refreshAllTabs() {
  const tabs = ['annotations', 'attachments', 'signatures', 'layers', 'form-fields', 'destinations', 'tags', 'links', 'bookmarks'];
  for (const tab of tabs) {
    refreshTabContent(tab);
  }
}

function refreshTabContent(panelId) {
  if (panelId === 'annotations') {
    updateAnnotationsList();
  } else if (panelId === 'attachments') {
    updateAttachmentsList();
  } else if (panelId === 'signatures') {
    updateSignaturesList();
  } else if (panelId === 'layers') {
    updateLayersList();
  } else if (panelId === 'form-fields') {
    updateFormFieldsList();
  } else if (panelId === 'destinations') {
    updateDestinationsList();
  } else if (panelId === 'tags') {
    updateTagsList();
  } else if (panelId === 'links') {
    updateLinksList();
  } else if (panelId === 'bookmarks') {
    updateBookmarksList();
  }
}

// Toggle panel collapse/expand
export function toggleLeftPanel() {
  toggleLeftPanelCollapsed();
}

// Track if processor is running
let processorRunning = false;

// Generate thumbnails for all pages (sets store signals and starts generation)
export async function generateThumbnails() {
  const activeDoc = getActiveDocument();
  if (!activeDoc || !activeDoc.pdfDoc) {
    return;
  }

  const pdfDoc = activeDoc.pdfDoc;
  const docId = activeDoc.id;
  const numPages = pdfDoc.numPages;

  // Get first page dimensions for placeholder sizing
  let placeholderWidth = 150;
  let placeholderHeight = Math.round(150 * 1.414);
  try {
    const firstPage = await pdfDoc.getPage(1);
    const extraRot = getPageRotation(1);
    const thOpts = { scale: THUMBNAIL_SCALE };
    if (extraRot) thOpts.rotation = (firstPage.rotate + extraRot) % 360;
    const viewport = firstPage.getViewport(thOpts);
    placeholderWidth = Math.round(viewport.width);
    placeholderHeight = Math.round(viewport.height);
  } catch (err) {
    console.warn('[Thumbnails] Could not get first page dimensions:', err);
  }

  // Initialize or update document state
  if (!documentState.has(docId)) {
    documentState.set(docId, {
      pdfDoc,
      numPages,
      nextPage: 1,
      startPage: 1,
      wrapped: false
    });
  }

  // Initialize cache for this document if needed
  if (!thumbnailCache.has(docId)) {
    thumbnailCache.set(docId, new Map());
  }
  const docCache = thumbnailCache.get(docId);

  // Update Solid store signals - this triggers reactive rendering of ThumbnailItem components
  setPlaceholderSize({ width: placeholderWidth, height: placeholderHeight });
  setPageCount(numPages);

  // Clear old thumbnail data before populating from the new document's cache
  // (prevents stale images from the previous document showing through)
  clearAllThumbnails();
  setPageCount(numPages);

  // Populate store with any already-cached thumbnail data
  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    if (docCache.has(pageNum)) {
      setThumbnailImage(pageNum, docCache.get(pageNum));
    }
  }

  // Mark current page as active and restore scroll position
  updateActiveThumbnail(true);

  // Ensure scroll listener is attached (Solid may have re-rendered the container)
  scrollListenerAttached = false;
  attachScrollListener();

  // Update priorities based on initially visible thumbnails
  setTimeout(updateVisiblePriorities, 50);

  // Start the processor if not running
  startProcessor();
}

// Pause/resume mechanism: when the user navigates pages, pause thumbnail
// rendering so Rust IPC calls for page rendering aren't blocked.
let _thumbnailsPaused = false;
let _thumbnailPauseTimer = null;

export function pauseThumbnails() {
  _thumbnailsPaused = true;
  if (_thumbnailPauseTimer) clearTimeout(_thumbnailPauseTimer);
  // Auto-resume after 3 seconds of no navigation
  _thumbnailPauseTimer = setTimeout(() => {
    _thumbnailsPaused = false;
    _thumbnailPauseTimer = null;
    startProcessor();
  }, 3000);
}

// Start the thumbnail processor (with short initial delay so the current page
// render gets the Rust backend first; cached thumbnails return instantly so
// 250ms is enough — the previous 2000ms was visibly slow on small docs).
function startProcessor() {
  if (processorRunning) return;
  processorRunning = true;
  setTimeout(processNextThumbnail, 250);
}

// Process the next thumbnail (prioritizes visible pages, then active document)
async function processNextThumbnail() {
  // If paused (user is navigating), wait and retry
  if (_thumbnailsPaused) {
    processorRunning = false;
    return;
  }

  try {
    const activeDoc = getActiveDocument();
    const activeDocId = activeDoc?.id;

    if (activeDocId && priorityPages.size > 0) {
      const processed = await processPriorityThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    if (activeDocId && documentState.has(activeDocId)) {
      const processed = await processDocumentThumbnail(activeDocId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    for (const [docId, docState] of documentState) {
      if (docId === activeDocId) continue;

      const processed = await processDocumentThumbnail(docId);
      if (processed) {
        setTimeout(processNextThumbnail, 0);
        return;
      }
    }

    processorRunning = false;
  } catch (err) {
    console.error('[Thumbnails] Processor error:', err);
    processorRunning = false;
    setTimeout(startProcessor, 100);
  }
}

// Process a priority (visible) thumbnail first
async function processPriorityThumbnail(docId) {
  const docState = documentState.get(docId);
  const docCache = thumbnailCache.get(docId);

  if (!docState || !docCache || priorityPages.size === 0) {
    return false;
  }

  const { pdfDoc } = docState;

  const pageNum = priorityPages.values().next().value;
  priorityPages.delete(pageNum);

  if (docCache.has(pageNum)) {
    return priorityPages.size > 0;
  }

  const gen = getPageGen(docId, pageNum);
  try {
    const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
    if (imageData) {
      // Drop result if a newer invalidate raced past us — prevents stale
      // overlay (e.g. old annotation snapshot) from overwriting fresh cache.
      if (!pageGenMatches(docId, pageNum, gen)) {
        return true;
      }
      docCache.set(pageNum, imageData);

      // Update the Solid store so the ThumbnailItem component reacts
      const currentActiveDoc = getActiveDocument();
      if (currentActiveDoc && currentActiveDoc.id === docId) {
        setThumbnailImage(pageNum, imageData);
      }
    }
    return true;
  } catch (err) {
    console.warn(`[Thumbnails] Error rendering priority page ${pageNum}:`, err);
    return true;
  }
}

// Process one thumbnail for a specific document (sequential with wrap-around)
async function processDocumentThumbnail(docId) {
  const docState = documentState.get(docId);
  const docCache = thumbnailCache.get(docId);

  if (!docState || !docCache) {
    return false;
  }

  const { pdfDoc, numPages } = docState;
  const startPage = docState.startPage || 1;

  let attempts = 0;
  const maxAttempts = numPages;

  while (attempts < maxAttempts) {
    if (docState.wrapped && docState.nextPage === startPage) {
      return false;
    }

    const pageNum = docState.nextPage;
    attempts++;

    docState.nextPage++;
    if (docState.nextPage > numPages) {
      docState.nextPage = 1;
      docState.wrapped = true;
    }

    if (docCache.has(pageNum)) continue;

    const gen = getPageGen(docId, pageNum);
    try {
      const imageData = await renderThumbnailToDataURL(pdfDoc, pageNum);
      if (imageData) {
        if (!pageGenMatches(docId, pageNum, gen)) {
          return true;
        }
        docCache.set(pageNum, imageData);

        // Update the Solid store so the ThumbnailItem component reacts
        const currentActiveDoc = getActiveDocument();
        if (currentActiveDoc && currentActiveDoc.id === docId) {
          setThumbnailImage(pageNum, imageData);
        }
      }
      return true;
    } catch (err) {
      console.warn(`[Thumbnails] Error rendering page ${pageNum} of doc ${docId}:`, err);
      return true;
    }
  }

  return false;
}

// Composite plugin/Solid-store annotations on top of a rendered thumbnail
// dataURL. Returns a new dataURL with annotations overlayed. If the page has
// no annotations, returns the input dataURL unchanged (zero-cost early-exit).
async function overlayAnnotationsOnDataURL(dataURL, pageNum, width, height, scale) {
  const doc = getActiveDocument();
  const annotations = (doc?.annotations || []).filter(a => a.page === pageNum);
  if (annotations.length === 0) return dataURL;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = dataURL;
    });
    ctx.drawImage(img, 0, 0, width, height);
    ctx.save();
    ctx.scale(scale, scale);
    annotations.forEach(a => {
      try { drawAnnotation(ctx, a); }
      catch (e) {
        // Tolerant: 1 broken annotation mag thumb niet breken — wel loggen
        // zodat plugin-bugs niet stilletjes verdwijnen in productie.
        console.warn(`[Thumbnails] drawAnnotation failed page ${pageNum} id=${a?.id ?? '?'} type=${a?.type ?? '?'}:`, e);
      }
    });
    ctx.restore();
    return canvas.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    console.warn(`[Thumbnails] overlay failed for page ${pageNum}:`, e);
    return dataURL;
  }
}

// Render a single page thumbnail — prefers replaying JS-cached vector commands
// (already extracted by the main viewer) for ~3-6× speedup; falls back to the
// Rust backend, then PDF.js. Reusing the cache avoids re-parsing the PDF
// content stream + IPC + JPEG encode + base64 round-trip.
async function renderThumbnailToDataURL(pdfDoc, pageNum) {
  if (!pdfDoc || pageNum > pdfDoc.numPages) return null;
  const _th0 = performance.now();

  const doc = getActiveDocument();

  // ── Fast path: JS replay of cached vector commands ────────────────────────
  // Only viable if the main viewer has already populated the cache for this
  // page (e.g. user navigated to it once, or it was prefetched).
  try {
    if (doc?.filePath) {
      const vr = await import('../../pdf/vector-renderer.js');
      const rotation = (typeof getPageRotation === 'function' ? getPageRotation(pageNum) : 0) || 0;
      if (vr.hasCachedCommands(doc.filePath, pageNum, rotation)) {
        const dims = vr.getCachedPageDimensions(doc.filePath, pageNum, rotation);
        if (dims && dims.w > 0 && dims.h > 0) {
          // Target 200 px wide thumbnail (matches Rust path).
          const targetW = 200;
          const scale = targetW / dims.w;
          const w = Math.max(1, Math.round(dims.w * scale));
          const h = Math.max(1, Math.round(dims.h * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          // Paint white background so transparency doesn't bleed to JPEG.
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          // Replay the cached vector commands at the thumbnail scale.
          vr.renderVectorPage(ctx, doc.filePath, pageNum, { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 }, rotation);
          const dataURL = canvas.toDataURL('image/jpeg', 0.7);
          // Overlay annotations on top (same as Rust path).
          try {
            const composited = await overlayAnnotationsOnDataURL(dataURL, pageNum, w, h, scale);
            return { dataURL: composited, width: w, height: h };
          } catch {
            return { dataURL, width: w, height: h };
          }
        }
      }
    }
  } catch (_) { /* fall through to Rust path */ }

  // Try Rust thumbnail rendering — uses skip_images=true so only
  // vector content is rendered (fast). Image decoding is skipped because
  // it can take 17+ seconds per page for complex PDFs, blocking the Rust
  // backend and preventing page navigation.
  if (doc?.filePath && window.__TAURI__) {
    try {
      const { invoke } = window.__TAURI__.core;
      const result = await invoke('render_thumbnail', {
        path: doc.filePath,
        pageIndex: pageNum - 1,
        maxWidth: 200,
        skipImages: true,
      });
      const data = JSON.parse(result);
      // Plugin/Solid-store annotations zijn niet in de PDF tot save; overlay
      // ze hier zodat thumbnail dezelfde inhoud toont als hoofdcanvas.
      // Scale = thumbnail-pixels / PDF-pt = data.width / pageWidthPt.
      try {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1 });
        const scale = data.width / viewport.width;
        const composited = await overlayAnnotationsOnDataURL(data.dataURL, pageNum, data.width, data.height, scale);
        return { dataURL: composited, width: data.width, height: data.height };
      } catch {
        return { dataURL: data.dataURL, width: data.width, height: data.height };
      }
    } catch (e) {
      console.warn(`[Thumbnails] Rust render failed for page ${pageNum}:`, e);
      // Fall through to PDF.js fallback
    }
  }

  // Fallback: PDF.js rendering
  console.log(`[PERF-THUMB] page ${pageNum}: PDF.js fallback START`);
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Render timeout')), 10000);
  });

  try {
    const renderPromise = (async () => {
      const page = await pdfDoc.getPage(pageNum);
      const extraRot = getPageRotation(pageNum);
      const trOpts = { scale: THUMBNAIL_SCALE };
      if (extraRot) trOpts.rotation = (page.rotate + extraRot) % 360;
      const viewport = page.getViewport(trOpts);

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');

      await page.render({
        canvasContext: ctx,
        viewport: viewport,
        annotationMode: 0
      }).promise;

      // Overlay plugin/Solid-store annotations op dezelfde ctx vóór toDataURL.
      // viewport.width = pdfPtWidth * THUMBNAIL_SCALE, dus scale-factor naar
      // PDF-pt-coordsysteem = THUMBNAIL_SCALE.
      try {
        const docActive = getActiveDocument();
        const annotations = (docActive?.annotations || []).filter(a => a.page === pageNum);
        if (annotations.length > 0) {
          ctx.save();
          ctx.scale(THUMBNAIL_SCALE, THUMBNAIL_SCALE);
          annotations.forEach(a => {
            try { drawAnnotation(ctx, a); }
            catch (e) {
              console.warn(`[Thumbnails] drawAnnotation failed (PDF.js path) page ${pageNum} id=${a?.id ?? '?'} type=${a?.type ?? '?'}:`, e);
            }
          });
          ctx.restore();
        }
      } catch (e) {
        console.warn(`[Thumbnails] PDF.js overlay failed for page ${pageNum}:`, e);
      }

      return {
        dataURL: canvas.toDataURL('image/jpeg', 0.7),
        width: viewport.width,
        height: viewport.height
      };
    })();

    const result = await Promise.race([renderPromise, timeoutPromise]);
    console.log(`[PERF-THUMB] page ${pageNum}: PDF.js fallback DONE: ${(performance.now() - _th0).toFixed(0)}ms`);
    return result;
  } catch (err) {
    console.warn(`[PERF-THUMB] page ${pageNum}: PDF.js fallback FAILED (${(performance.now() - _th0).toFixed(0)}ms):`, err.message);
    return null;
  }
}

// Show page properties dialog
export async function showPageProperties(pageNum) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  try {
    const page = await doc.pdfDoc.getPage(pageNum);
    const rotation = getPageRotation(pageNum);
    const viewport = page.getViewport({ scale: 1 });
    const widthPt = viewport.width;
    const heightPt = viewport.height;
    const widthMm = (widthPt / 72 * 25.4).toFixed(1);
    const heightMm = (heightPt / 72 * 25.4).toFixed(1);
    const widthIn = (widthPt / 72).toFixed(2);
    const heightIn = (heightPt / 72).toFixed(2);
    const totalRotation = (page.rotate + (rotation || 0)) % 360;

    const msg = `Page ${pageNum}\n\n` +
      `Size: ${widthPt.toFixed(0)} x ${heightPt.toFixed(0)} pt\n` +
      `Size: ${widthMm} x ${heightMm} mm\n` +
      `Size: ${widthIn} x ${heightIn} in\n` +
      `Rotation: ${totalRotation}\u00B0`;

    if (window.__TAURI__?.dialog?.message) {
      await window.__TAURI__.dialog.message(msg, { title: 'Page Properties', kind: 'info' });
    } else {
      showMessage(msg);
    }
  } catch (err) {
    console.error('Error showing page properties:', err);
  }
}

// Invalidate and re-render a single page's thumbnail (e.g. after rotation)
export function invalidateThumbnail(pageNum) {
  const activeDoc = getActiveDocument();
  if (!activeDoc) return;
  const docCache = thumbnailCache.get(activeDoc.id);
  if (docCache) {
    docCache.delete(pageNum);
  }
  // Bump generation: any in-flight render for this page will discard its
  // result on completion (see pageGenMatches in process*Thumbnail).
  bumpPageGen(activeDoc.id, pageNum);
  // Remove from Solid store so component shows loading spinner
  removeThumbnailImage(pageNum);
  // Re-add to priority queue and restart processor
  priorityPages.add(pageNum);
  startProcessor();
}

// Clear thumbnail cache for a specific document
export function clearThumbnailCache(docId) {
  if (docId) {
    thumbnailCache.delete(docId);
    documentState.delete(docId);
  }
}

// Save thumbnail scroll position for the current document
export function saveThumbnailScrollPosition() {
  const doc = getActiveDocument();
  if (!doc) return;
  const container = getContainerRef();
  if (container) {
    thumbnailScrollPositions.set(doc.id, container.scrollTop);
  }
}

// Update which thumbnail is marked as active
export function updateActiveThumbnail(restoreScroll = false) {
  const doc = getActiveDocument();
  const newPage = doc ? doc.currentPage : 1;
  setActivePage(newPage);

  // Keep the thumbnail selection in sync with the active page when the user
  // has a single-page selection (which is the default after a normal click).
  // If they have a multi-page selection (Ctrl/Shift-click), leave it alone so
  // they don't lose their selection while navigating with the wheel/keyboard.
  const sel = thumbnailSelectedPages();
  if (sel.size <= 1) {
    selectThumbnailPage(newPage);
  }

  setTimeout(() => {
    const container = getContainerRef();
    if (!container) return;

    if (restoreScroll && doc && thumbnailScrollPositions.has(doc.id)) {
      // Restore saved scroll position (tab switch)
      container.scrollTop = thumbnailScrollPositions.get(doc.id);
    } else {
      // Scroll active thumbnail into view (page navigation)
      const activeThumbnail = container.querySelector('.thumbnail-item.active');
      if (activeThumbnail) {
        activeThumbnail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, 0);
}

// Clear thumbnails (when PDF is closed)
export function clearThumbnails() {
  clearAllThumbnails();
  priorityPages.clear();
}
