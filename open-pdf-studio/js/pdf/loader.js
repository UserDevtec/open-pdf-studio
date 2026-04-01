import { state, getNextUntitledName, getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { setViewMode } from './renderer.js';
import { generateThumbnails, refreshActiveTab } from '../ui/panels/left-panel.js';
import { createTab, updateWindowTitle, markDocumentModified } from '../ui/chrome/tabs.js';
import * as pdfjsLib from 'pdfjs-dist';
import { isTauri, readBinaryFile, openFileDialog, lockFile } from '../core/platform.js';
import { PDFDocument } from 'pdf-lib';
import { resetAnnotationStorage } from './form-layer.js';
import { addRecentFile } from '../mobile/recent-files.js';
import { extractFileName } from '../core/platform.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

// Sub-module imports
import { extractAnnotationColors } from './loader/color-extraction.js';
import { extractStampImagesViaPdfJs, extractStampImages } from './loader/image-extraction.js';
import { convertPdfAnnotation } from './loader/annotation-converter.js';


// Cache for original PDF bytes (used by saver to avoid re-reading)
const originalBytesCache = new Map(); // filePath -> Uint8Array

export function getCachedPdfBytes(filePath) {
  return originalBytesCache.get(filePath);
}

export function setCachedPdfBytes(filePath, bytes) {
  originalBytesCache.set(filePath, bytes);
}

/**
 * Reload a document's pdfDoc from new bytes (used by Find & Replace).
 * Updates the pdf.js document object without reloading the entire UI.
 */
export async function reloadDocumentFromBytes(doc, bytes) {
  if (!doc) return;

  doc._sharedPdfLibDoc = null;
  doc._sharedPdfLibDocPromise = null;

  // Replace the pdf.js document with one loaded from the new bytes
  doc.pdfDoc = await pdfjsLib.getDocument({
    data: bytes.slice(), // copy — pdf.js transfers the buffer
    cMapUrl: '/pdfjs/web/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/web/standard_fonts/',
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  doc.modified = true;
}

export function clearCachedPdfBytes(filePath) {
  if (filePath) {
    originalBytesCache.delete(filePath);
  } else {
    originalBytesCache.clear();
  }
}

// Set worker source (path relative to HTML file, not this module)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

// ─── PDF/A compliance bar ──────────────────────────────────────────────────────

async function checkPdfACompliance(doc) {
  try {
    if (!doc || !doc.pdfDoc) return;
    const meta = await doc.pdfDoc.getMetadata();
    const metadata = meta && meta.metadata;
    if (!metadata) return;
    const part = metadata.get('pdfaid:part');
    const conformance = metadata.get('pdfaid:conformance');
    if (part) {
      doc.pdfaCompliance = { part, conformance: conformance || null };
      // Only show bar if this document is active
      if (state.documents[state.activeDocumentIndex] === doc) {
        showPdfABar(part, conformance, doc);
      }
    }
  } catch (e) {
    // Metadata not available – ignore
  }
}

function showPdfABar(part, conformance, doc) {
  if (!doc) return;
  if (doc.pdfADismissed) return;
  const label = `PDF/A-${part}${conformance ? conformance.toLowerCase() : ''}`;
  const text = `This document complies with the ${label} standard and has been opened read-only to prevent modification.`;
  import('../solid/stores/pdfaBarStore.js').then(m => m.showPdfABar(text));

  // Disable annotation tool buttons
  import('../tools/manager.js').then(m => m.updatePdfAToolState());
}

export function hidePdfABar() {
  import('../solid/stores/pdfaBarStore.js').then(m => m.hidePdfABar());
}

export function dismissPdfAForActiveDoc() {
  const activeDoc = state.documents[state.activeDocumentIndex];
  if (activeDoc) activeDoc.pdfADismissed = true;
  hidePdfABar();
  import('../tools/manager.js').then(m => m.updatePdfAToolState());
}

// Check if the active document is PDF/A and editing has NOT been enabled
export function isPdfAReadOnly() {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return false;
  if (!doc.pdfaCompliance) return false;
  return !doc.pdfADismissed;
}

// Load PDF from file path into a specific document by index.
// Optional preloadedData (Uint8Array) bypasses FS plugin read.
export async function loadPDF(filePath, docIndex, preloadedData = null) {
  const doc = state.documents[docIndex];
  if (!doc) return;

  // Guard against loading into a document that's already loading
  if (doc._isLoading) return;
  doc._isLoading = true;

  // Helper: check if this document is the currently active one
  const isActive = () => state.documents[state.activeDocumentIndex] === doc;
  // Helper: check if document was closed during async operations
  const isClosed = () => !state.documents.includes(doc);

  try {
    if (isActive()) showLoading('Loading PDF...');

    let typedArray;

    if (preloadedData) {
      // Use pre-loaded bytes (e.g. from virtual printer capture, or browser file input)
      typedArray = preloadedData instanceof Uint8Array ? preloadedData : new Uint8Array(preloadedData);
      originalBytesCache.set(filePath, typedArray.slice());
    } else {
      if (isTauri()) {
        // Lock the file to prevent other apps from writing while we have it open
        // (skip on Android — content:// URIs don't support filesystem locking)
        const { isMobile } = await import('../core/platform.js');
        if (isClosed()) return;
        if (!isMobile()) {
          await lockFile(filePath);
          if (isClosed()) return;
        }
      }

      // Read file using Tauri fs plugin or web file cache
      const data = await readBinaryFile(filePath);
      if (isClosed()) return;
      if (!data) throw new Error('File system access not available');
      typedArray = new Uint8Array(data);

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      originalBytesCache.set(filePath, typedArray.slice());
    }

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    doc.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
      verbosity: 0,
    }).promise;
    if (isClosed()) return;

    doc.filePath = filePath;
    doc.fileName = filePath ? filePath.split(/[\\/]/).pop() : 'Untitled';

    // Reset annotation state (per-document)
    doc.annotations = [];
    doc._loadedAnnotationPages.clear();
    doc._pagesNeedingColorUpdate.clear();
    doc._sharedPdfLibDoc = null;
    doc._sharedPdfLibDocPromise = null;
    doc.undoStack = [];
    doc.redoStack = [];
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    doc.currentPage = 1;

    // Eagerly start pdf-lib loading in background (don't await - runs in parallel with first paint)
    getSharedPdfLibDoc(doc);

    // UI operations — only if this is the active document
    if (isActive()) {
      // Reset form field annotation storage for the new document
      resetAnnotationStorage();

      // Hide PDF/A bar from previous document
      hidePdfABar();

      // Show PDF container, hide placeholder
      const placeholder = document.getElementById('placeholder');
      const pdfContainer = document.getElementById('pdf-container');
      if (placeholder) placeholder.style.display = 'none';
      if (pdfContainer) pdfContainer.classList.add('visible');

      // Render first page immediately (before annotation loading)
      await setViewMode(doc.viewMode);
      if (isClosed()) return;
      hideLoading();

      // Check for PDF/A compliance and show info bar if applicable
      checkPdfACompliance(doc);

      // Generate thumbnails for left panel
      generateThumbnails();
    } else {
      // Not active — still check PDF/A but don't show bar
      checkPdfACompliance(doc);
    }

    // Load bookmarks from PDF outline (data-only, always run)
    {
      const { loadBookmarksFromPdf } = await import('../ui/panels/bookmarks.js');
      if (isClosed()) return;
      doc.bookmarks = await loadBookmarksFromPdf(doc.pdfDoc);
      if (isClosed()) return;
    }

    // Load persisted measure scale for this document (data-only)
    {
      const { loadDocumentScale } = await import('../annotations/measurement.js');
      if (isClosed()) return;
      loadDocumentScale(doc);
    }

    // Auto-detect scale from title block text if no scale is already set (fire-and-forget)
    if (!doc.measureScale) {
      import('../annotations/scale-bar.js').then(async ({ detectScaleFromPdf }) => {
        if (isClosed() || doc.measureScale) return;
        try {
          const result = await detectScaleFromPdf(1);
          if (isClosed() || doc.measureScale) return;
          if (result && result.ratio > 0) {
            const pixelsPerUnit = 72 / (25.4 * result.ratio);
            doc.measureScale = {
              pixelsPerUnit,
              unit: 'mm',
              method: 'auto-detect',
              scaleRatio: `1:${result.ratio}`,
            };
            const { saveDocumentScale } = await import('../annotations/measurement.js');
            saveDocumentScale();
            console.log(`Auto-detected scale: 1:${result.ratio} from "${result.scaleText}"`);
          }
        } catch (e) {
          // Non-critical — ignore auto-detect failures
        }
      });
    }

    // UI updates — only if active
    if (isActive()) {
      // Notify that a PDF has been loaded (listeners can reset tool, update UI, etc.)
      document.dispatchEvent(new CustomEvent('pdf-loaded'));

      // Refresh active left panel tab (e.g. attachments, layers, etc.)
      refreshActiveTab();

      // Update status bar
      updateAllStatus();

      // Update window title
      updateWindowTitle();
    }

    // Track in recent files (always run)
    if (filePath && !filePath.startsWith('__memory__')) {
      addRecentFile(filePath, extractFileName(filePath));
    }

    // Load existing annotations in background (after first paint)
    await loadExistingAnnotations(doc);
    if (isClosed()) return;

    // Sync doc.measureScale from any loaded scaleBar annotations
    const loadedScaleBar = doc.annotations.find(a => a.type === 'scaleBar');
    if (loadedScaleBar) {
      const { syncDocScale } = await import('../annotations/scale-bar.js');
      syncDocScale(loadedScaleBar);
    }

    // Redraw annotations on the current page now that they're loaded (including color updates)
    if (isActive() && doc.pdfDoc) {
      const { redrawAnnotations } = await import('../annotations/rendering.js');
      redrawAnnotations();
    }

  } catch (error) {
    // Suppress errors from document being closed during background loading
    if (isClosed()) return;
    console.error('Error loading PDF:', error);
    if (isActive()) {
      showMessage(i18next.t('failedToLoadPdf', { error: error.message }));
    }
  } finally {
    doc._isLoading = false;
    if (isActive()) hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  try {
    const result = await openFileDialog();
    if (result) {
      // Create a new tab for the file (will switch to existing tab if already open)
      const { index } = createTab(result);
      await loadPDF(result, index);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
  }
}

// Create a new blank PDF document
export async function createBlankPDF(widthPt, heightPt, numPages) {
  try {
    showLoading('Creating document...');

    // Create blank PDF using pdf-lib
    const pdfDocLib = await PDFDocument.create();
    for (let i = 0; i < numPages; i++) {
      pdfDocLib.addPage([widthPt, heightPt]);
    }
    const pdfBytes = await pdfDocLib.save();
    const typedArray = new Uint8Array(pdfBytes);

    // Generate untitled name and create tab
    const fileName = getNextUntitledName();
    const { index } = createTab(null);
    // Use the proxy-wrapped document from state so that Solid reactivity
    // picks up property changes (e.g. pdfDoc) and updates the UI.
    const doc = state.documents[index];
    doc.fileName = fileName;

    // Cache bytes under a memory key for saving later
    const memoryKey = `__memory__${doc.id}`;
    originalBytesCache.set(memoryKey, typedArray.slice());

    // Load into pdf.js for viewing
    doc.pdfDoc = await pdfjsLib.getDocument({
      data: typedArray,
      cMapUrl: '/pdfjs/web/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/web/standard_fonts/',
      isEvalSupported: false,
      verbosity: 0,
    }).promise;

    // Reset annotation storage and state
    resetAnnotationStorage();
    doc.annotations = [];
    doc.undoStack = [];
    doc.redoStack = [];
    doc.selectedAnnotation = null;
    doc.selectedAnnotations = [];
    doc.currentPage = 1;

    // Show PDF container, hide placeholder
    const placeholder = document.getElementById('placeholder');
    const pdfContainer = document.getElementById('pdf-container');
    if (placeholder) placeholder.style.display = 'none';
    if (pdfContainer) pdfContainer.classList.add('visible');

    // Mark as modified so Ctrl+S will trigger Save As
    markDocumentModified();

    // Render
    await setViewMode(doc.viewMode);
    generateThumbnails();
    refreshActiveTab();
    updateAllStatus();
    updateWindowTitle();

  } catch (error) {
    console.error('Error creating blank PDF:', error);
    showMessage(i18next.t('failedToCreateDocument', { error: error.message }));
  } finally {
    hideLoading();
  }
}

// Cancel any in-progress annotation loading for a document
// If no doc provided, cancels for the active document (backward compat)
export function cancelAnnotationLoading(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  doc._annotationLoadId++;
  doc._loadedAnnotationPages.clear();
  doc._pagesNeedingColorUpdate.clear();
  doc._sharedPdfLibDoc = null;
  doc._sharedPdfLibDocPromise = null;
}

// Mark all annotation pages as loaded (prevents background loader from overwriting after page ops)
export function markAllAnnotationPagesLoaded(numPages, doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  for (let i = 1; i <= numPages; i++) {
    doc._loadedAnnotationPages.add(i);
  }
}

// Get or lazily load the shared pdf-lib document for color extraction
async function getSharedPdfLibDoc(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return null;
  if (doc._sharedPdfLibDoc) return doc._sharedPdfLibDoc;
  if (doc._sharedPdfLibDocPromise) return doc._sharedPdfLibDocPromise;
  const pdfBytes = originalBytesCache.get(doc.filePath);
  if (!pdfBytes) return null;
  doc._sharedPdfLibDocPromise = PDFDocument.load(pdfBytes, { ignoreEncryption: true }).then(pdfLibDoc => {
    doc._sharedPdfLibDoc = pdfLibDoc;
    doc._sharedPdfLibDocPromise = null;
    return pdfLibDoc;
  });
  return doc._sharedPdfLibDocPromise;
}

// Load annotations for a single page on-demand (called when user navigates to a page)
// If waitForColors=false, skips color extraction when pdf-lib isn't ready yet
async function loadAnnotationsForSinglePage(doc, pageNum, waitForColors = false) {
  if (!doc || !doc.pdfDoc) return;

  const page = await doc.pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });

  const annotations = await page.getAnnotations();

  if (annotations.length === 0) return;

  const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
  const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

  let stampImageMap = null;
  let annotColorMap = null;

  // Resolve pdf-lib doc early so both stamp images and colors can use it
  let pdfLibDoc = doc._sharedPdfLibDoc || null;
  if (!pdfLibDoc && waitForColors) {
    pdfLibDoc = await getSharedPdfLibDoc(doc);
  }

  if (stampAnnots.length > 0 && pdfLibDoc) {
    // Extract images directly from AP stream XObjects via pdf-lib
    // (avoids rendering whole page with annotationMode:1 which bakes other annotations into stamp images)
    stampImageMap = await extractStampImages(pageNum, pdfLibDoc);
  }

  if (needsExtraData) {
    if (pdfLibDoc) {
      annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
    } else {
      // On-demand path: pdf-lib not ready, skip colors for now
      doc._pagesNeedingColorUpdate.add(pageNum);
    }
  }

  for (const annot of annotations) {
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (converted) {
      doc.annotations.push(converted);
    }
  }
}

// Ensure annotations are loaded for a given page (on-demand, called from renderer)
export async function ensureAnnotationsForPage(pageNum, doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc) return;
  if (doc._loadedAnnotationPages.has(pageNum)) {
    return;
  }
  doc._loadedAnnotationPages.add(pageNum);
  await loadAnnotationsForSinglePage(doc, pageNum, false);
}

// Load existing annotations from PDF
export async function loadExistingAnnotations(doc) {
  if (!doc) {
    doc = getActiveDocument();
  }
  if (!doc || !doc.pdfDoc) return;

  const loadId = ++doc._annotationLoadId;
  const pdfDoc = doc.pdfDoc;
  const numPages = pdfDoc.numPages;
  const BATCH_SIZE = 50;

  for (let batchStart = 1; batchStart <= numPages; batchStart += BATCH_SIZE) {
    if (loadId !== doc._annotationLoadId) return;
    if (!state.documents.includes(doc)) return;

    const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, numPages);

    // Collect page numbers not yet loaded on-demand
    const pagesToLoad = [];
    for (let p = batchStart; p <= batchEnd; p++) {
      if (doc._loadedAnnotationPages.has(p)) {
        // already loaded
      } else {
        pagesToLoad.push(p);
        doc._loadedAnnotationPages.add(p);
      }
    }

    if (pagesToLoad.length === 0) continue;

    // Fetch all pages in this batch in parallel
    const pages = await Promise.all(pagesToLoad.map(p => pdfDoc.getPage(p)));
    if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

    // Fetch all annotations in this batch in parallel
    const annotResults = await Promise.all(pages.map(page => page.getAnnotations()));
    if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

    // Process each page's annotations
    for (let i = 0; i < pages.length; i++) {
      const pageNum = pagesToLoad[i];
      const page = pages[i];
      const viewport = page.getViewport({ scale: 1 });
      const annotations = annotResults[i];

      if (annotations.length === 0) continue;

      const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
      const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

      let stampImageMap = null;
      let annotColorMap = null;

      // Resolve pdf-lib doc for both stamp images (transparency) and colors
      const pdfLibDoc = await getSharedPdfLibDoc(doc);
      if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;

      if (stampAnnots.length > 0 && pdfLibDoc) {
        stampImageMap = await extractStampImages(pageNum, pdfLibDoc);
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;
      }

      if (needsExtraData && pdfLibDoc) {
        annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) return;
      }

      for (const annot of annotations) {
        const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
        if (converted) {
          doc.annotations.push(converted);
        }
      }
    }
  }

  // Fix up pages that were loaded on-demand without color data
  if (doc._pagesNeedingColorUpdate.size > 0 && loadId === doc._annotationLoadId && state.documents.includes(doc)) {
    const pdfLibDoc = await getSharedPdfLibDoc(doc);
    if (pdfLibDoc && loadId === doc._annotationLoadId && state.documents.includes(doc)) {
      for (const pageNum of doc._pagesNeedingColorUpdate) {
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;

        // Remove old annotations for this page
        doc.annotations = doc.annotations.filter(a => a.page !== pageNum);

        // Reload with full color data
        const page = await pdfDoc.getPage(pageNum);
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;
        const viewport = page.getViewport({ scale: 1 });
        const annotations = await page.getAnnotations();
        if (loadId !== doc._annotationLoadId || !state.documents.includes(doc)) break;

        if (annotations.length === 0) continue;

        const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
        const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));

        let stampImageMap = null;
        let annotColorMap = null;

        if (stampAnnots.length > 0 && pdfLibDoc) {
          stampImageMap = await extractStampImages(pageNum, pdfLibDoc);
        }
        if (needsExtraData) {
          annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        }

        for (const annot of annotations) {
          const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
          if (converted) {
            doc.annotations.push(converted);
          }
        }
      }
      doc._pagesNeedingColorUpdate.clear();
    }
  }
}
