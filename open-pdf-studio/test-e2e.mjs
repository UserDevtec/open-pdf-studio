import { createRequire } from 'module';
import { readFileSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PDF_PATH = String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const logs = [];
  page.on('console', msg => {
    const t = msg.text();
    logs.push(`[${msg.type()}] ${t}`);
    if (t.includes('open-pdf-render') || t.includes('pdfium') || t.includes('mupdf') || t.includes('Fallback')) {
      console.log(`  BROWSER: ${t.substring(0, 300)}`);
    }
  });
  page.on('pageerror', err => console.log(`  PAGE ERROR: ${err.message.substring(0, 200)}`));

  console.log('=== E2E Test: PDF Rendering in App ===\n');

  // Load the app
  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);

  // Load PDF bytes and push to the app
  console.log('1. Loading real PDF into app...');
  const pdfBytes = readFileSync(PDF_PATH);
  const b64 = pdfBytes.toString('base64');

  const loadResult = await page.evaluate(async (b64) => {
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const loader = await import('/js/pdf/loader.js');
      await loader.loadPDF(bytes, 'test-bouwtekening.pdf', 'C:/tmp/test.pdf');

      // Show PDF container
      const placeholder = document.getElementById('placeholder');
      const pdfContainer = document.getElementById('pdf-container');
      if (placeholder) placeholder.style.display = 'none';
      if (pdfContainer) pdfContainer.classList.add('visible');

      // Wait for state to settle
      await new Promise(r => setTimeout(r, 500));

      // Try rendering
      const renderer = await import('/js/pdf/renderer.js');
      const t0 = performance.now();
      await renderer.renderPage(1);
      const elapsed = performance.now() - t0;

      const canvas = document.getElementById('pdf-canvas');
      return {
        ok: true,
        renderTime: Math.round(elapsed),
        canvasW: canvas?.width || 0,
        canvasH: canvas?.height || 0,
        cssPxW: parseInt(canvas?.style.width) || 0,
        visible: canvas?.offsetWidth > 0,
      };
    } catch (e) {
      return { ok: false, error: e.message, stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
    }
  }, b64);

  console.log('   Result:', JSON.stringify(loadResult));

  if (!loadResult.ok) {
    console.log('❌ PDF load/render failed');
    console.log('   Error:', loadResult.error);
    if (loadResult.stack) console.log('   Stack:', loadResult.stack);

    // Print relevant console logs
    console.log('\n   Relevant logs:');
    logs.filter(l => l.includes('render') || l.includes('error') || l.includes('Fallback') || l.includes('pdf'))
      .slice(-10)
      .forEach(l => console.log('   ', l.substring(0, 200)));

    await page.screenshot({ path: 'test-e2e-fail.png' });
    await browser.close();
    process.exit(1);
  }

  // Screenshot after first render
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-e2e-1-loaded.png' });
  console.log(`   ✅ Rendered in ${loadResult.renderTime}ms, canvas ${loadResult.canvasW}x${loadResult.canvasH}`);
  console.log('   Screenshot: test-e2e-1-loaded.png');

  // Check if canvas has actual content (not white)
  const contentCheck = await page.evaluate(() => {
    const canvas = document.getElementById('pdf-canvas');
    if (!canvas) return { hasContent: false };
    const ctx = canvas.getContext('2d');
    const sample = ctx.getImageData(canvas.width / 2, canvas.height / 2, 100, 100);
    let nonWhite = 0;
    for (let i = 0; i < sample.data.length; i += 4) {
      if (sample.data[i] !== 255 || sample.data[i+1] !== 255 || sample.data[i+2] !== 255) nonWhite++;
    }
    return { hasContent: nonWhite > 0, nonWhitePixels: nonWhite, totalSampled: sample.data.length / 4 };
  });
  console.log(`   Content check: ${contentCheck.nonWhitePixels}/${contentCheck.totalSampled} non-white pixels`);
  if (contentCheck.hasContent) {
    console.log('   ✅ Canvas has visible content');
  } else {
    console.log('   ⚠️ Canvas appears white — might be rendering issue');
  }

  // 2. Test zoom in
  console.log('\n2. Testing zoom in...');
  const zoomInResult = await page.evaluate(async () => {
    const renderer = await import('/js/pdf/renderer.js');
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc) return { error: 'no doc' };

    const oldScale = doc.scale;
    doc.scale = oldScale * 2.0; // 2x zoom

    const t0 = performance.now();
    await renderer.renderPage(doc.currentPage || 1);
    const elapsed = performance.now() - t0;

    const canvas = document.getElementById('pdf-canvas');
    return {
      ok: true,
      oldScale,
      newScale: doc.scale,
      renderTime: Math.round(elapsed),
      canvasW: canvas?.width || 0,
      canvasH: canvas?.height || 0,
    };
  });

  if (zoomInResult.ok) {
    console.log(`   ✅ Zoom ${zoomInResult.oldScale}→${zoomInResult.newScale} in ${zoomInResult.renderTime}ms`);
    console.log(`   Canvas: ${zoomInResult.canvasW}x${zoomInResult.canvasH}`);
  } else {
    console.log('   ❌ Zoom failed:', zoomInResult.error);
  }

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-e2e-2-zoomed.png' });
  console.log('   Screenshot: test-e2e-2-zoomed.png');

  // 3. Test zoom out
  console.log('\n3. Testing zoom out...');
  const zoomOutResult = await page.evaluate(async () => {
    const renderer = await import('/js/pdf/renderer.js');
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (!doc) return { error: 'no doc' };

    doc.scale = 0.75;
    const t0 = performance.now();
    await renderer.renderPage(doc.currentPage || 1);
    const elapsed = performance.now() - t0;

    return { ok: true, renderTime: Math.round(elapsed) };
  });

  if (zoomOutResult.ok) {
    console.log(`   ✅ Zoom to 0.75 in ${zoomOutResult.renderTime}ms`);
  }

  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-e2e-3-zoomout.png' });
  console.log('   Screenshot: test-e2e-3-zoomout.png');

  // Print relevant logs
  console.log('\n4. Renderer logs:');
  logs.filter(l => l.includes('render') || l.includes('Fallback') || l.includes('open-pdf') || l.includes('mupdf'))
    .forEach(l => console.log('   ', l.substring(0, 200)));

  console.log('\nDone.');
  await browser.close();
})();
