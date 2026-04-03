// Test the actual Tauri app via Chrome DevTools Protocol (CDP)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const TEST_PDF = String.raw`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\begane grond do 3 constructie verwerkt_50.pdf`;

(async () => {
  console.log('=== Tauri App E2E Test via CDP ===\n');

  const browser = await chromium.connectOverCDP('http://localhost:9222');
  const page = browser.contexts()[0]?.pages()[0];
  if (!page) { console.log('❌ No page'); process.exit(1); }
  console.log('1. ✅ Connected to:', await page.title());

  const renderLogs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[render]')) { renderLogs.push(t); console.log(`   ${t}`); }
  });

  // Step 2: Open PDF using the app's normal flow (createTab + loadPDF)
  console.log('\n2. Opening PDF via app flow...');
  const openResult = await page.evaluate(async (path) => {
    try {
      // First, grant FS scope access for this path
      await window.__TAURI__.core.invoke('allow_fs_scope', { path });

      // Import the app's tab + loader modules
      const { createTab } = await import('/js/ui/chrome/tabs.js');
      const { loadPDF } = await import('/js/pdf/loader.js');
      const { state } = await import('/js/core/state.ts');

      // Create a new tab (this adds a document to state.documents)
      createTab(path);
      const docIndex = state.activeDocumentIndex;

      // Load the PDF into that tab
      await loadPDF(path, docIndex);

      // Wait for render
      await new Promise(r => setTimeout(r, 2000));

      const doc = state.documents[docIndex];
      const canvas = document.getElementById('pdf-canvas');
      return {
        ok: !!doc?.pdfDoc,
        filePath: doc?.filePath,
        pages: doc?.pdfDoc?.numPages,
        scale: doc?.scale,
        canvasW: canvas?.width,
        canvasH: canvas?.height,
        cssW: canvas?.style?.width,
      };
    } catch (e) {
      return { ok: false, error: e.toString(), stack: e.stack?.split('\n').slice(0, 3).join(' | ') };
    }
  }, TEST_PDF);

  console.log('   Result:', JSON.stringify(openResult, null, 2));

  if (!openResult.ok) {
    console.log('❌ Failed to open PDF. Taking screenshot...');
    await page.screenshot({ path: 'test-tauri-fail.png' });
    await browser.close();
    process.exit(1);
  }

  // Step 3: Screenshot after load
  console.log('\n3. Taking screenshot after PDF load...');
  await page.screenshot({ path: 'test-tauri-loaded.png' });
  console.log('   Saved: test-tauri-loaded.png');

  // Step 4: Check canvas content
  const contentCheck = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    if (!c || c.width < 10) return { hasContent: false, reason: 'canvas too small' };
    const ctx = c.getContext('2d');
    // Sample center area
    const sx = Math.floor(c.width * 0.3);
    const sy = Math.floor(c.height * 0.3);
    const sw = Math.min(200, c.width - sx);
    const sh = Math.min(200, c.height - sy);
    const data = ctx.getImageData(sx, sy, sw, sh).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255) nonWhite++;
    }
    return { hasContent: nonWhite > 0, nonWhite, total: data.length / 4, canvasW: c.width, canvasH: c.height };
  });
  console.log(`   Content: ${contentCheck.nonWhite || 0}/${contentCheck.total || 0} non-white, canvas=${contentCheck.canvasW}x${contentCheck.canvasH}`);

  // Step 5: Zoom test
  console.log('\n5. Zoom 2x...');
  const zoomResult = await page.evaluate(async () => {
    try {
      const { state } = await import('/js/core/state.ts');
      const doc = state.documents[state.activeDocumentIndex];
      if (!doc?.pdfDoc) return { ok: false, error: 'no doc' };

      const oldScale = doc.scale;
      doc.scale = oldScale * 2;

      const renderer = await import('/js/pdf/renderer.js');
      const t0 = performance.now();
      await renderer.renderPage(doc.currentPage || 1);
      const elapsed = Math.round(performance.now() - t0);

      const c = document.getElementById('pdf-canvas');
      return { ok: true, oldScale, newScale: doc.scale, elapsed, w: c?.width, h: c?.height };
    } catch (e) {
      return { ok: false, error: e.toString() };
    }
  });
  console.log('   Result:', JSON.stringify(zoomResult));

  await page.screenshot({ path: 'test-tauri-zoomed.png' });

  // Step 6: Zoom back
  console.log('\n6. Zoom back to 1.5...');
  await page.evaluate(async () => {
    const { state } = await import('/js/core/state.ts');
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) doc.scale = 1.5;
    const renderer = await import('/js/pdf/renderer.js');
    await renderer.renderPage(doc?.currentPage || 1);
  });
  await page.screenshot({ path: 'test-tauri-normal.png' });

  // Summary
  console.log('\n7. Render logs:');
  renderLogs.forEach(l => console.log(`   ${l}`));

  console.log('\n=== Done ===');
  await browser.close();
})();
