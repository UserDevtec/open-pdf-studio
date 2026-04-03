import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));

  await page.goto('http://localhost:3041/');
  await page.waitForTimeout(3000);

  // Load PDF and manually trigger render
  console.log('1. Creating & rendering PDF...');
  const result = await page.evaluate(async () => {
    try {
      const pdfLib = await import('/node_modules/.vite/deps/pdf-lib.js');
      const loader = await import('/js/pdf/loader.js');
      const renderer = await import('/js/pdf/renderer.js');

      // Create PDF
      const pdfDoc = await pdfLib.PDFDocument.create();
      const p = pdfDoc.addPage([842, 595]);
      p.drawText('Zoom Test Page', { x: 50, y: 500, size: 30 });
      p.drawRectangle({ x: 100, y: 200, width: 400, height: 200, borderWidth: 2 });
      const bytes = await pdfDoc.save();

      // Load
      await loader.loadPDF(new Uint8Array(bytes), 'test.pdf', '/tmp/test.pdf');

      // Show PDF container
      const placeholder = document.getElementById('placeholder');
      const pdfContainer = document.getElementById('pdf-container');
      if (placeholder) placeholder.style.display = 'none';
      if (pdfContainer) pdfContainer.classList.add('visible');

      // Render page 1
      await renderer.renderPage(1);

      await new Promise(r => setTimeout(r, 500));

      const c = document.getElementById('pdf-canvas');
      return { ok: true, cssW: parseInt(c?.style.width) || 0, visible: c?.offsetWidth > 0 };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });
  console.log('   Result:', JSON.stringify(result));
  if (!result.ok) { console.log('❌ FAIL'); await browser.close(); process.exit(1); }

  // Screenshot to verify
  await page.screenshot({ path: 'test-before-zoom.png' });
  console.log('   Screenshot: test-before-zoom.png');

  const initW = result.cssW;
  console.log('   Initial width:', initW, 'px');

  // ZOOM IN
  console.log('2. Zooming in (5 Ctrl+wheel)...');
  const box = await page.locator('#pdf-canvas').boundingBox();
  if (!box) { console.log('❌ No canvas bounding box'); await browser.close(); process.exit(1); }

  for (let i = 0; i < 5; i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.main-view')?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(30);
  }

  // Check CSS-scaled size (immediate, before render)
  const duringZoom = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    return parseInt(c?.style.width) || 0;
  });
  console.log('   CSS-scaled width:', duringZoom);

  // Wait for debounced render (150ms + render time)
  await page.waitForTimeout(1000);

  const afterRender = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    return { cssW: parseInt(c?.style.width) || 0, pixW: c?.width, visible: c?.offsetWidth > 0 };
  });
  console.log('   After render:', JSON.stringify(afterRender));

  await page.screenshot({ path: 'test-after-zoom.png' });

  if (afterRender.cssW > initW) {
    console.log('✅ Zoom in: PASS (', initW, '->', afterRender.cssW, ')');
  } else {
    console.log('❌ Zoom in: FAIL (width did not increase)');
  }

  // ZOOM OUT
  console.log('3. Zooming out (8 Ctrl+wheel)...');
  for (let i = 0; i < 8; i++) {
    await page.evaluate(({ x, y }) => {
      document.querySelector('.main-view')?.dispatchEvent(new WheelEvent('wheel', {
        clientX: x, clientY: y, deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true
      }));
    }, { x: box.x + 200, y: box.y + 200 });
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(1000);

  const afterOut = await page.evaluate(() => {
    const c = document.getElementById('pdf-canvas');
    return { cssW: parseInt(c?.style.width) || 0, visible: c?.offsetWidth > 0 };
  });
  console.log('   After zoom out:', JSON.stringify(afterOut));

  if (afterOut.cssW < afterRender.cssW && afterOut.visible) {
    console.log('✅ Zoom out: PASS');
  } else {
    console.log('❌ Zoom out: size issue');
  }

  await page.screenshot({ path: 'test-after-zoomout.png' });

  // Errors
  if (errors.length > 0) {
    console.log('\n⚠️ Errors:');
    errors.forEach(e => console.log('  ', e.substring(0, 300)));
  } else {
    console.log('\n✅ No errors');
  }

  await browser.close();
  console.log('Done.');
})();
