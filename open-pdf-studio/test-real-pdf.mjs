import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PDF_PATH = 'C:/3BM/50_projecten/3_3BM_bouwtechniek/3059 Woonhuis Benedenkerkseweg 87 Stolwijk/20_post_IN/01 27-03-2026 beginstukken/begane grond do 3 constructie verwerkt_50.pdf';

(async () => {
  // Start vite first
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[mupdf]') || t.includes('render') || msg.type() === 'error') {
      console.log(`  BROWSER [${msg.type()}]: ${t.substring(0, 300)}`);
    }
  });
  page.on('pageerror', err => console.log('  PAGE ERROR:', err.message.substring(0, 200)));

  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);

  // Read real PDF file
  console.log('Reading PDF file...');
  const pdfBytes = readFileSync(PDF_PATH);
  console.log(`PDF size: ${(pdfBytes.length / 1024 / 1024).toFixed(1)} MB`);

  // Transfer bytes to browser and test MuPDF rendering
  console.log('\n=== Test 1: MuPDF WASM rendering ===');
  const base64 = pdfBytes.toString('base64');

  const mupdfResult = await page.evaluate(async (b64) => {
    try {
      // Decode base64 to Uint8Array
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { isMupdfAvailable, renderPage } = await import('/js/pdf/mupdf-renderer.js');
      const avail = await isMupdfAvailable();
      if (!avail) return { error: 'MuPDF not available' };

      // Render page 0
      const t0 = performance.now();
      const result = await renderPage(bytes, 'test-real', 0, 1.5);
      const elapsed = performance.now() - t0;

      if (!result) return { error: 'renderPage returned null' };

      return {
        success: true,
        width: result.width,
        height: result.height,
        rgbaSize: result.rgba.length,
        elapsed: Math.round(elapsed),
        isWhite: result.rgba.slice(0, 100).every(b => b === 255 || b === 0),
      };
    } catch (e) {
      return { error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
    }
  }, base64);

  console.log('MuPDF result:', JSON.stringify(mupdfResult, null, 2));

  if (mupdfResult.success) {
    console.log(`✅ MuPDF rendered: ${mupdfResult.width}x${mupdfResult.height} in ${mupdfResult.elapsed}ms`);

    // Draw to canvas to verify visually
    await page.evaluate(async (b64) => {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { renderPage } = await import('/js/pdf/mupdf-renderer.js');
      const result = await renderPage(bytes, 'test-real', 0, 1.0);
      if (!result) return;

      // Show on the pdf-canvas
      const canvas = document.getElementById('pdf-canvas');
      if (canvas) {
        canvas.width = result.width;
        canvas.height = result.height;
        canvas.style.width = result.width + 'px';
        canvas.style.height = result.height + 'px';
        const ctx = canvas.getContext('2d');
        const imageData = new ImageData(result.rgba, result.width, result.height);
        ctx.putImageData(imageData, 0, 0);

        // Show the canvas
        const placeholder = document.getElementById('placeholder');
        const pdfContainer = document.getElementById('pdf-container');
        if (placeholder) placeholder.style.display = 'none';
        if (pdfContainer) pdfContainer.classList.add('visible');
      }
    }, base64);

    await page.screenshot({ path: 'test-mupdf-real.png' });
    console.log('Screenshot saved: test-mupdf-real.png');
  } else {
    console.log('❌ MuPDF failed:', mupdfResult.error);
  }

  // Test 2: Compare with PDF.js
  console.log('\n=== Test 2: PDF.js rendering (comparison) ===');
  const pdfjsResult = await page.evaluate(async (b64) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const pdfjsLib = await import('pdfjs-dist');
      const t0 = performance.now();
      const loadingTask = pdfjsLib.getDocument({ data: bytes.slice() });
      const doc = await loadingTask.promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext('2d');

      await page.render({ canvasContext: ctx, viewport, annotationMode: 0 }).promise;
      const elapsed = performance.now() - t0;

      return { success: true, width: canvas.width, height: canvas.height, elapsed: Math.round(elapsed) };
    } catch (e) {
      return { error: e.message };
    }
  }, base64);

  if (pdfjsResult.success) {
    console.log(`PDF.js rendered: ${pdfjsResult.width}x${pdfjsResult.height} in ${pdfjsResult.elapsed}ms`);
  } else {
    console.log('PDF.js failed:', pdfjsResult.error);
  }

  if (mupdfResult.success && pdfjsResult.success) {
    const speedup = (pdfjsResult.elapsed / mupdfResult.elapsed).toFixed(1);
    console.log(`\n🚀 MuPDF is ${speedup}x faster than PDF.js (${mupdfResult.elapsed}ms vs ${pdfjsResult.elapsed}ms)`);
  }

  await page.waitForTimeout(5000); // Keep browser open to see result
  await browser.close();
})();
