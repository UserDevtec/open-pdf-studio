import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PASS = '✅';
const FAIL = '❌';
const WARN = '⚠️';
let passed = 0, failed = 0;

function report(name, ok, detail) {
  if (ok) { passed++; console.log(`${PASS} ${name}`); }
  else { failed++; console.log(`${FAIL} ${name}${detail ? ': ' + detail : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  page.on('console', msg => {
    const text = msg.text();
    if (msg.type() === 'error') consoleErrors.push(text);
    // Log mupdf messages
    if (text.includes('[mupdf]')) console.log('  BROWSER:', text);
  });
  page.on('pageerror', err => consoleErrors.push(err.message));

  console.log('=== Open PDF Studio Integration Test ===\n');

  // 1. Load app
  console.log('--- Loading app ---');
  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);
  report('App loads', true);

  // 2. Test MuPDF WASM import
  console.log('\n--- Test MuPDF WASM ---');
  const mupdfTest = await page.evaluate(async () => {
    try {
      const mod = await import('mupdf');
      return {
        loaded: true,
        hasDocument: typeof mod.Document === 'function' || typeof mod.Document?.openDocument === 'function',
        hasMatrix: !!mod.Matrix,
        hasColorSpace: !!mod.ColorSpace,
        hasDeviceRGB: !!mod.ColorSpace?.DeviceRGB,
      };
    } catch (e) {
      return { loaded: false, error: e.message };
    }
  });
  report('MuPDF WASM module imports', mupdfTest.loaded, mupdfTest.error);
  if (mupdfTest.loaded) {
    report('MuPDF Document class exists', mupdfTest.hasDocument);
    report('MuPDF Matrix exists', mupdfTest.hasMatrix);
    report('MuPDF ColorSpace.DeviceRGB exists', mupdfTest.hasDeviceRGB);
  }

  // 3. Test mupdf-renderer.js module
  console.log('\n--- Test mupdf-renderer.js ---');
  const rendererTest = await page.evaluate(async () => {
    try {
      const mod = await import('/js/pdf/mupdf-renderer.js');
      return {
        loaded: true,
        hasFunctions: typeof mod.isMupdfAvailable === 'function'
          && typeof mod.renderPage === 'function'
          && typeof mod.closeDocument === 'function'
          && typeof mod.disable === 'function',
      };
    } catch (e) {
      return { loaded: false, error: e.message };
    }
  });
  report('mupdf-renderer.js imports', rendererTest.loaded, rendererTest.error);
  if (rendererTest.loaded) {
    report('All exported functions exist', rendererTest.hasFunctions);
  }

  // 4. Test isMupdfAvailable
  const availTest = await page.evaluate(async () => {
    try {
      const { isMupdfAvailable } = await import('/js/pdf/mupdf-renderer.js');
      const avail = await isMupdfAvailable();
      return { available: avail };
    } catch (e) {
      return { error: e.message };
    }
  });
  report('isMupdfAvailable() returns true', availTest.available === true, JSON.stringify(availTest));

  // 5. Test rendering a minimal PDF with MuPDF
  console.log('\n--- Test MuPDF rendering ---');
  const renderTest = await page.evaluate(async () => {
    try {
      const pdfLib = await import('/node_modules/.vite/deps/pdf-lib.js');
      const pdfDoc = await pdfLib.PDFDocument.create();
      const p = pdfDoc.addPage([200, 100]);
      p.drawText('Hello MuPDF', { x: 10, y: 50, size: 20 });
      const bytes = await pdfDoc.save();

      const { renderPage } = await import('/js/pdf/mupdf-renderer.js');
      const t0 = performance.now();
      const result = await renderPage(new Uint8Array(bytes), 'test', 0, 1.5);
      const elapsed = performance.now() - t0;

      if (!result) return { rendered: false, error: 'renderPage returned null' };
      return {
        rendered: true,
        width: result.width,
        height: result.height,
        rgbaLength: result.rgba.length,
        expectedLength: result.width * result.height * 4,
        elapsed: Math.round(elapsed),
        firstPixels: Array.from(result.rgba.slice(0, 16)),
      };
    } catch (e) {
      return { rendered: false, error: e.message, stack: e.stack?.split('\n').slice(0,3).join(' | ') };
    }
  });

  if (renderTest.rendered) {
    report('MuPDF renders a page', true);
    report('RGBA size matches width*height*4', renderTest.rgbaLength === renderTest.expectedLength,
      `got ${renderTest.rgbaLength}, expected ${renderTest.expectedLength}`);
    report(`Render time: ${renderTest.elapsed}ms`, renderTest.elapsed < 2000);
    console.log(`  Dimensions: ${renderTest.width}x${renderTest.height}, ${renderTest.rgbaLength} bytes`);
  } else {
    report('MuPDF renders a page', false, renderTest.error);
    if (renderTest.stack) console.log('  Stack:', renderTest.stack);
  }

  // 6. Test that result can be put on canvas
  if (renderTest.rendered) {
    console.log('\n--- Test Canvas putImageData ---');
    const canvasTest = await page.evaluate(async () => {
      try {
        const pdfLib = await import('/node_modules/.vite/deps/pdf-lib.js');
        const pdfDoc = await pdfLib.PDFDocument.create();
        pdfDoc.addPage([200, 100]);
        const bytes = await pdfDoc.save();

        const { renderPage } = await import('/js/pdf/mupdf-renderer.js');
        const result = await renderPage(new Uint8Array(bytes), 'test2', 0, 1.0);
        if (!result) return { error: 'no result' };

        const canvas = document.createElement('canvas');
        canvas.width = result.width;
        canvas.height = result.height;
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(result.rgba, result.width, result.height);
        ctx.putImageData(imageData, 0, 0);

        return { success: true, canvasW: canvas.width, canvasH: canvas.height };
      } catch (e) {
        return { error: e.message };
      }
    });
    report('putImageData succeeds', canvasTest.success, canvasTest.error);
  }

  // 7. Check for console errors
  console.log('\n--- Console errors ---');
  const relevantErrors = consoleErrors.filter(e =>
    !e.includes('plugin-manager') && !e.includes('favicon')
  );
  if (relevantErrors.length === 0) {
    report('No relevant console errors', true);
  } else {
    report('Console errors found', false);
    relevantErrors.forEach(e => console.log('  ERROR:', e.substring(0, 200)));
  }

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);

  await browser.close();
  process.exit(failed > 0 ? 1 : 0);
})();
