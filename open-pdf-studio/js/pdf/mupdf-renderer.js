// js/pdf/mupdf-renderer.js
// MuPDF WASM renderer — loads mupdf module and renders PDF pages to RGBA pixels.
// Separated from renderer.js to keep the module boundary clean.

let _mupdf = null;
let _available = null; // null = untested, true/false = tested
let _cachedDoc = null;
let _cachedDocId = null; // filePath or byte-length for identity check

// Lazy-load the mupdf WASM module
async function loadModule() {
  if (_mupdf) return _mupdf;
  try {
    const mod = await import('mupdf');
    _mupdf = mod;
    console.log('[mupdf] WASM module loaded successfully');
    return mod;
  } catch (e) {
    console.warn('[mupdf] Failed to load WASM module:', e);
    _available = false;
    return null;
  }
}

// Check if MuPDF is available (lazy, one-time check)
export async function isMupdfAvailable() {
  if (_available !== null) return _available;
  const mod = await loadModule();
  _available = mod !== null;
  return _available;
}

// Open a PDF document from Uint8Array bytes. Caches the document for reuse.
export async function openDocument(pdfBytes, docId) {
  const mupdf = await loadModule();
  if (!mupdf) return null;

  // Reuse cached document if same file
  if (_cachedDoc && _cachedDocId === docId) {
    return _cachedDoc;
  }

  // Destroy previous document
  if (_cachedDoc) {
    try { _cachedDoc.destroy(); } catch {}
    _cachedDoc = null;
    _cachedDocId = null;
  }

  try {
    _cachedDoc = mupdf.Document.openDocument(pdfBytes, 'application/pdf');
    _cachedDocId = docId;
    return _cachedDoc;
  } catch (e) {
    console.warn('[mupdf] Failed to open document:', e);
    return null;
  }
}

// Render a single page to RGBA pixel data.
// Returns { rgba: Uint8ClampedArray, width: number, height: number } or null.
export async function renderPage(pdfBytes, docId, pageIndex, scale) {
  const mupdf = await loadModule();
  if (!mupdf) return null;

  const doc = await openDocument(pdfBytes, docId);
  if (!doc) return null;

  try {
    const page = doc.loadPage(pageIndex);
    const dpr = window.devicePixelRatio || 1;
    const totalScale = scale * dpr;
    const matrix = mupdf.Matrix.scale(totalScale, totalScale);
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, false);

    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const pixels = pixmap.getPixels(); // RGB (3 bytes per pixel, no alpha)

    // Convert RGB → RGBA for ImageData compatibility
    const rgba = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      rgba[j]     = pixels[i];     // R
      rgba[j + 1] = pixels[i + 1]; // G
      rgba[j + 2] = pixels[i + 2]; // B
      rgba[j + 3] = 255;           // A (opaque)
    }

    pixmap.destroy();
    page.destroy();

    return { rgba, width, height };
  } catch (e) {
    console.warn(`[mupdf] Render page ${pageIndex} failed:`, e);
    return null;
  }
}

// Close cached document (call when switching files)
export function closeDocument() {
  if (_cachedDoc) {
    try { _cachedDoc.destroy(); } catch {}
    _cachedDoc = null;
    _cachedDocId = null;
  }
}

// Disable mupdf permanently (after unrecoverable error)
export function disable() {
  _available = false;
  closeDocument();
}
