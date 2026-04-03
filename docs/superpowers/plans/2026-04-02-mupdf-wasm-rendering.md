# MuPDF WASM PDF Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vervang PDF.js rendering door MuPDF WASM voor 50-100x snellere PDF pagina rendering, met behoud van PDF.js voor tekst selectie, zoeken en form fields.

**Architecture:** MuPDF WASM (`mupdf` npm 1.27.0) rendert pagina's naar RGBA pixels via `page.toPixmap()`. Die pixels gaan via `putImageData` naar het canvas. PDF.js blijft geladen voor tekst/zoek/forms — alleen de `page.render()` call wordt vervangen. Bij falen valt het terug naar PDF.js.

**Tech Stack:** mupdf 1.27.0 (WASM), Vite 7.3, Tauri 2, SolidJS, PDF.js 5.4

---

## File Structure

| File | Verantwoordelijkheid |
|------|---------------------|
| `js/pdf/mupdf-renderer.js` | **NIEUW** — MuPDF WASM wrapper: laden, document cachen, pagina renderen |
| `js/pdf/renderer.js` | **WIJZIG** — renderPage/renderPageOffscreen: probeer mupdf eerst, fallback PDF.js |
| `vite.config.js` | **WIJZIG** — Exclude mupdf van Vite optimizeDeps (WASM compatibiliteit) |

---

### Task 1: MuPDF WASM module loader

**Files:**
- Create: `open-pdf-studio/js/pdf/mupdf-renderer.js`

- [ ] **Step 1: Maak het mupdf-renderer.js module bestand**

```javascript
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
    const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, true, false);

    const width = pixmap.getWidth();
    const height = pixmap.getHeight();
    const pixels = pixmap.getPixels();

    // CRITICAL: Copy pixels before destroying pixmap — pixmap owns the WASM memory
    const rgba = new Uint8ClampedArray(pixels.length);
    rgba.set(pixels);

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
```

- [ ] **Step 2: Verifieer dat het bestand geen syntax errors heeft**

Run: Open de browser console (F12) en check voor import errors.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/mupdf-renderer.js
git commit -m "feat: add mupdf WASM renderer module"
```

---

### Task 2: Vite configuratie voor WASM

**Files:**
- Modify: `open-pdf-studio/vite.config.js`

- [ ] **Step 1: Lees huidige vite.config.js**

Check of er al `optimizeDeps` of `assetsInclude` configuratie is.

- [ ] **Step 2: Voeg WASM/mupdf exclusion toe**

De mupdf package bevat een 9.6MB WASM file. Vite moet dit correct afhandelen:

```javascript
// In vite.config.js, voeg toe aan defineConfig:
optimizeDeps: {
  exclude: ['mupdf'], // Don't pre-bundle mupdf — it loads WASM via import.meta.url
},
```

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/vite.config.js
git commit -m "chore: configure Vite for mupdf WASM module"
```

---

### Task 3: Integreer MuPDF in renderPage (single page mode)

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Vervang de huidige TODO placeholder door MuPDF integratie**

Zoek in renderer.js naar:
```javascript
  // TODO: MuPDF WASM rendering — disabled until WASM loading is verified
  // For now, always use PDF.js rendering (reliable, working)
  await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
```

Vervang door:
```javascript
  // Try MuPDF WASM (50-100x faster) first, fall back to PDF.js
  const { isMupdfAvailable, renderPage: mupdfRender, disable: disableMupdf } = await import('./mupdf-renderer.js');
  const useMupdf = await isMupdfAvailable();

  if (useMupdf && doc.filePath) {
    try {
      // Get PDF bytes from cache (already in memory from PDF.js load)
      const { getCachedPdfBytes } = await import('./loader.js');
      const pdfBytes = getCachedPdfBytes(doc.filePath);
      if (pdfBytes) {
        const result = await mupdfRender(pdfBytes, doc.filePath, pageNum - 1, scale);
        if (result && result.rgba && result.width > 0 && result.height > 0) {
          // MuPDF render succeeded — blit to canvas
          pdfCanvas.width = result.width;
          pdfCanvas.height = result.height;
          pdfCanvas.style.width = Math.floor(result.width / dpr) + 'px';
          pdfCanvas.style.height = Math.floor(result.height / dpr) + 'px';
          const imageData = new ImageData(result.rgba, result.width, result.height);
          pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
        } else {
          // MuPDF returned empty — fallback
          await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
        }
      } else {
        // No cached bytes — fallback
        await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
      }
    } catch (e) {
      console.warn('[mupdf] Render failed, disabling. Using PDF.js:', e);
      disableMupdf();
      await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
    }
  } else {
    // MuPDF not available or no file path — PDF.js fallback
    await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
  }
```

- [ ] **Step 2: Start de app en open een PDF**

Run: `npm run tauri:dev` (of als al draaiend, hot reload zou moeten werken)

Open een PDF. Check de DevTools console (F12):
- `[mupdf] WASM module loaded successfully` = MuPDF werkt
- `[mupdf] Failed to load WASM module:` = Vite config probleem, ga naar Task 2

- [ ] **Step 3: Verifieer rendering**

De PDF pagina moet zichtbaar zijn. Zoom in/uit moet werken. Als het een witte pagina toont maar geen errors, check of `result.rgba.length > 0`.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: integrate MuPDF WASM rendering with PDF.js fallback"
```

---

### Task 4: Integreer MuPDF in renderPageOffscreen (zoom)

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Update renderPageOffscreen functie**

Zoek de `renderPageOffscreen` functie. Dezelfde logica als Task 3, maar dan in de offscreen render path. Vervang de PDF.js render sectie:

Zoek:
```javascript
  const offCtx = offPdf.getContext('2d');
  const renderContext = { ... };
  currentRenderTask = page.render(renderContext);
  ...
  visCtx.drawImage(offPdf, 0, 0);
```

Vervang met MuPDF-first logica die bij succes direct naar het visible canvas schrijft (skip offscreen), bij falen de bestaande PDF.js offscreen flow gebruikt.

- [ ] **Step 2: Test zoom in/uit**

Zoom met Ctrl+scroll. Geen freeze, geen witte flits.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: use MuPDF WASM for offscreen zoom rendering"
```

---

### Task 5: Integreer MuPDF in continuous mode

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Update renderContinuousPage functie**

In de `renderContinuousPage` functie, vervang de `page.render(contRenderContext)` call met dezelfde MuPDF-first pattern.

- [ ] **Step 2: Test continuous mode scroll**

Schakel naar continuous mode (View → Continuous). Scroll door pagina's. Alle pagina's moeten snel laden.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: use MuPDF WASM in continuous page rendering"
```

---

### Task 6: Cleanup en document sluiten

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Roep closeDocument() aan bij document wissel**

In de `clearPdfView` functie, voeg toe:
```javascript
import('./mupdf-renderer.js').then(m => m.closeDocument());
```

- [ ] **Step 2: Test document wisselen**

Open PDF A, dan PDF B. Geen memory leaks, geen stale renders.

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "fix: close MuPDF document on file switch"
```

---

### Task 7: Performance verificatie

- [ ] **Step 1: Open een grote vector PDF (bouwtekening)**

Meet de tijd in de console:
```javascript
console.time('render');
// ... render happens ...
console.timeEnd('render');
```

Verwacht: < 200ms per pagina met MuPDF vs 2-10 sec met PDF.js.

- [ ] **Step 2: Test zoom snelheid**

Ctrl+scroll snel in en uit. Geen freeze, vloeiende CSS-preview → scherpe MuPDF render.

- [ ] **Step 3: Test tekst selectie**

Selecteer tekst op de pagina — dit moet nog werken via de PDF.js text layer.

- [ ] **Step 4: Test zoeken (Ctrl+F)**

Zoek naar tekst — dit moet nog werken via PDF.js.

- [ ] **Step 5: Finale commit en push**

```bash
git add -A
git commit -m "feat: MuPDF WASM rendering engine for 50-100x faster PDF display"
git push
```
