// Programmatically open a sample PDF in the running Tauri app via CDP.
const { chromium } = require('./node_modules/playwright');

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

(async()=>{
  const filePath = process.argv[2] || 'C:\\Users\\rickd\\Desktop\\offerte-klant-2026-03-27.pdf';
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  let page = pages.find(p=>p.url().includes('localhost:3041') && !p.url().includes('worker'));
  if(!page) page = pages[0];
  console.log('URL:', page.url());

  const r = await page.evaluate(async (fp)=>{
    try{
      const tabs = await import('/js/ui/chrome/tabs.js');
      const loader = await import('/js/pdf/loader.js');
      const { state } = await import('/js/core/state.ts');
      const { doc, index } = tabs.createTab(fp, true);
      await loader.loadPDF(fp, index);
      return { ok:true, idx: index, fp: doc.filePath, pages: doc.pdfDoc?.numPages };
    }catch(e){ return { ok:false, err: e.message, stack: (e.stack||'').slice(0,400) }; }
  }, filePath);
  console.log('open result:', JSON.stringify(r));

  await sleep(2500);
  const snap = await page.evaluate(()=>{
    const s = window.__OPDFS?.state;
    return { docs: (s?.documents||[]).length, name: s?.documents?.[0]?.fileName, pages: s?.documents?.[0]?.pdfDoc?.numPages, vp: !!window.__pdfViewport?.active };
  });
  console.log('snap:', JSON.stringify(snap));
  await browser.close();
})().catch(e=>{ console.error('FATAL', e); process.exit(2); });
