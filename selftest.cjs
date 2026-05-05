// Autonomous self-test for drawing tools
const { chromium } = require('./open-pdf-studio/node_modules/playwright');

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function pickPage(ctx){
  // pick the page (not workers) whose URL matches and that has a real document
  const pages = ctx.pages();
  for(const p of pages){
    const url = p.url();
    if(url.includes('localhost:3041') && !url.includes('pdf.worker')){
      try{
        const ok = await p.evaluate(()=>typeof document !== 'undefined');
        if(ok) return p;
      }catch(e){}
    }
  }
  return pages[0];
}

async function exposeState(page){
  // Inject helper that finds the state via dynamic import of the module URL
  return await page.evaluate(async ()=>{
    if(window.__OPDFS) return 'already';
    try{
      const mod = await import('/js/core/state.ts');
      window.__OPDFS = { state: mod.state };
    }catch(e){
      try{
        const mod = await import('/js/core/state.js');
        window.__OPDFS = { state: mod.state };
      }catch(e2){
        return 'fail: '+e.message+' / '+e2.message;
      }
    }
    // try expose tool manager too
    try{ const mm = await import('/js/tools/manager.js'); window.__OPDFS.manager = mm; }catch(e){}
    return 'ok';
  });
}

async function getSnapshot(page){
  return await page.evaluate(()=>{
    const s = window.__OPDFS?.state;
    if(!s) return null;
    const docIdx = s.currentDocumentIndex ?? 0;
    const doc = (s.documents||[])[docIdx];
    const anns = doc?.annotations || [];
    return { docs: (s.documents||[]).length, currentTool: s.currentTool, annCount: anns.length, lastType: anns[anns.length-1]?.type };
  });
}

async function getLastAnn(page){
  return await page.evaluate(()=>{
    const s = window.__OPDFS?.state;
    if(!s) return null;
    const docIdx = s.currentDocumentIndex ?? 0;
    const doc = (s.documents||[])[docIdx];
    const anns = doc?.annotations || [];
    const a = anns[anns.length-1];
    if(!a) return { count: anns.length, last: null };
    // shallow clone with key fields
    const safe = {};
    for(const k of Object.keys(a)){
      const v = a[k];
      if(v == null || typeof v !== 'object') safe[k] = v;
      else if(Array.isArray(v)) safe[k] = v.length<10 ? JSON.parse(JSON.stringify(v)) : '['+v.length+' items]';
      else safe[k] = '[obj]';
    }
    return { count: anns.length, last: safe };
  });
}

async function setTool(page, tool){
  return await page.evaluate(async (t)=>{
    try{
      const mm = window.__OPDFS?.manager || await import('/js/tools/manager.js');
      window.__OPDFS.manager = mm;
      if(mm.setTool) { mm.setTool(t); return 'mm.setTool'; }
      if(mm.toolManager?.setTool) { mm.toolManager.setTool(t); return 'tm.setTool'; }
      // fallback: set state.currentTool
      window.__OPDFS.state.currentTool = t;
      return 'state.currentTool';
    }catch(e){ return 'err:'+e.message; }
  }, tool);
}

async function pressEsc(page){
  await page.keyboard.press('Escape'); await sleep(60);
  await page.keyboard.press('Escape'); await sleep(80);
  // Defensive: also hide any open context menu via the bridge
  try{ await page.evaluate(async()=>{
    try{ const b = await import('/js/bridge.js'); if(b.hideMenu) b.hideMenu(); if(b.closeAllPopups) b.closeAllPopups(); }catch(_){}
    // Reset any stale per-tool state that might block subsequent tools
    const s = window.__OPDFS?.state; if(s){
      s.dimPoints = []; s.measurePoints = null; s.measurePhase = 'outer';
      s.measureOuterPoints = null; s.measureHoles = [];
      s.polylinePoints = []; s.isDrawingPolyline = false;
      s.splinePoints = []; s.isDrawingSpline = false;
      s.filledAreaPoints = null; s.filledAreaPhase = 'outer'; s.filledAreaOuterPoints = null; s.filledAreaHoles = [];
      s.isDrawing = false; s.isDrawingDimension = false;
      s._closeContourPending = false; s._suppressNextContextmenu = false;
    }
  }); }catch(_){}
}

async function drag(page, x1,y1,x2,y2){
  await page.mouse.move(x1,y1); await page.mouse.down(); await sleep(60);
  for(let i=1;i<=6;i++){ await page.mouse.move(x1+(x2-x1)*i/6, y1+(y2-y1)*i/6); await sleep(20); }
  await sleep(80); await page.mouse.up(); await sleep(150);
}
async function click(page,x,y){ await page.mouse.move(x,y); await sleep(30); await page.mouse.down(); await sleep(30); await page.mouse.up(); await sleep(80); }
async function dblclick(page,x,y){ await page.mouse.move(x,y); await sleep(20); await page.mouse.dblclick(x,y); await sleep(150); }
async function rclick(page,x,y){ await page.mouse.move(x,y); await sleep(30); await page.mouse.down({button:'right'}); await page.mouse.up({button:'right'}); await sleep(120); }

async function exerciseTool(page, tool, label, expectedType, fn){
  await pressEsc(page);
  const before = await getLastAnn(page);
  let err = null;
  let actualTool = null;
  try {
    const setRes = await setTool(page, tool);
    await sleep(80);
    actualTool = await page.evaluate(()=>window.__OPDFS?.state?.currentTool);
    if(actualTool !== tool) err = `tool not active (req=${tool} got=${actualTool}; setRes=${setRes})`;
    await fn();
    await sleep(250);
  } catch(e){ err = err || e.message; }
  const after = await getLastAnn(page);
  await pressEsc(page);
  const added = after && before && after.count > before.count;
  return { name: label, added, expectedType, gotType: after?.last?.type, err, before: before?.count, after: after?.count, last: after?.last, actualTool };
}

(async()=>{
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
  const ctx = browser.contexts()[0];
  const page = await pickPage(ctx);

  page.on('pageerror', e=>console.log('[pageerror]', e.message.slice(0,150)));
  page.on('console', m=>{ if(m.type()==='error'){ const t = m.text().slice(0,200); if(!t.includes('document is not defined')) console.log('[cerr]', t); }});

  console.log('URL:', page.url());

  const ex = await exposeState(page);
  console.log('expose state:', ex);

  let snap = await getSnapshot(page);
  console.log('snapshot:', snap);

  if(!snap || snap.docs === 0){
    console.log('NO DOC OPEN - aborting'); process.exit(1);
  }

  // wait viewport active
  for(let i=0;i<20;i++){
    const ok = await page.evaluate(()=>!!(window.__pdfViewport && window.__pdfViewport.active));
    if(ok) break; await sleep(300);
  }
  console.log('viewport active:', await page.evaluate(()=>!!window.__pdfViewport?.active));

  // Resize window so canvas has ample space for many distinct test regions
  try { const s = await page.context().newCDPSession(page); /* no-op */ } catch(e){}

  // Compute canvas-relative coordinate helper. Each test gets its own row/col block
  // inside the actual on-screen annotation canvas (which can be ~696x597 in dev).
  const cv = await page.evaluate(()=>{
    const c = document.getElementById('annotation-canvas') || document.getElementById('pdf-canvas');
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  console.log('canvas:', cv);
  // Build a 6x4 grid of cells inside the canvas, each cell big enough for a stroke
  const cols = 6, rows = 4;
  const padX = 18, padY = 18;
  const cellW = (cv.w - padX*2) / cols;
  const cellH = (cv.h - padY*2) / rows;
  function cell(idx){
    const r = Math.floor(idx / cols), c = idx % cols;
    const cx = cv.x + padX + cellW*c + cellW*0.1;
    const cy = cv.y + padY + cellH*r + cellH*0.1;
    return {
      x1: cx, y1: cy,
      x2: cx + cellW*0.75, y2: cy + cellH*0.75,
      midX: cx + cellW*0.4, midY: cy + cellH*0.4,
      w: cellW, h: cellH,
    };
  }

  const tests = [
    { tool:'line', type:'line', run: async()=>{ const c=cell(0); await click(page,c.x1,c.y1); await click(page,c.x2,c.y2); } },
    { tool:'arrow', type:'arrow', run: async()=>{ const c=cell(1); await click(page,c.x1,c.y1); await click(page,c.x2,c.y2); } },
    { tool:'box', type:'box', run: async()=>{ const c=cell(2); await drag(page,c.x1,c.y1,c.x2,c.y2); } },
    { tool:'circle', type:'circle', run: async()=>{ const c=cell(3); await drag(page,c.x1,c.y1,c.x2,c.y2); } },
    { tool:'polyline', type:'polyline', run: async()=>{ const c=cell(4); await click(page,c.x1,c.y1); await click(page,c.midX,c.midY); await click(page,c.x2-5,c.y2-5); await sleep(220); await dblclick(page,c.x2,c.y2); } },
    { tool:'polygon', type:'polygon', run: async()=>{ const c=cell(5); await drag(page,c.x1,c.y1,c.x2,c.y2); } },
    { tool:'cloud', type:'cloud', run: async()=>{ const c=cell(6); await drag(page,c.x1,c.y1,c.x2,c.y2); } },
    { tool:'cloudPolyline', type:'cloudPolyline', run: async()=>{ const c=cell(7); await click(page,c.x1,c.y1); await click(page,c.x2,c.y1+5); await click(page,c.x2,c.y2); await click(page,c.x1,c.y2); await click(page,c.x1,c.y1); } },
    { tool:'filledArea', type:'filledArea', run: async()=>{ const c=cell(8); await click(page,c.x1,c.y1); await click(page,c.x2,c.y1+5); await click(page,c.x2,c.y2); await click(page,c.x1,c.y2); await sleep(150); await page.keyboard.press('Enter'); await sleep(200); } },
    { tool:'arc', type:'arc', run: async()=>{ const c=cell(9); await click(page,c.x1,c.y1); await click(page,c.midX,c.midY); await click(page,c.x2,c.y2); } },
    { tool:'spline', type:'spline', run: async()=>{ const c=cell(10); await click(page,c.x1,c.y1); await click(page,c.midX,c.midY); await click(page,c.x2-5,c.y2-5); await sleep(220); await dblclick(page,c.x2,c.y2); } },
    { tool:'draw', type:'draw', run: async()=>{ const c=cell(11);
        await page.mouse.move(c.x1,c.y1); await page.mouse.down();
        for(let i=1;i<=10;i++){ await page.mouse.move(c.x1+i*4, c.y1+Math.sin(i)*5); await sleep(20); }
        await page.mouse.up(); }},
    { tool:'highlight', type:'highlight', run: async()=>{ const c=cell(12); await drag(page,c.x1,c.y1+10,c.x2,c.y1+20); } },
    { tool:'textbox', type:'textbox', run: async()=>{ const c=cell(13); await drag(page,c.x1,c.y1,c.x2,c.y2); await sleep(150); await page.keyboard.press('Escape'); await sleep(150); } },
    { tool:'callout', type:'callout', run: async()=>{ const c=cell(14); await drag(page,c.x1,c.y1,c.x2,c.y2); } },
    { tool:'comment', type:'comment', run: async()=>{ const c=cell(15); await click(page,c.midX,c.midY); await sleep(200); await page.keyboard.press('Escape'); } },
    { tool:'stamp', type:'stamp', run: async()=>{
        // Stamp normally opens a picker; inject a minimal SVG override so
        // placeOverrideStamp() commits an annotation directly.
        await page.evaluate(()=>{
          const s = window.__OPDFS?.state;
          if(!s) return;
          if(!s.toolOverrides) s.toolOverrides = {};
          s.toolOverrides.stampSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect x="2" y="2" width="36" height="36" fill="red"/></svg>';
          s.toolOverrides.stampWidth = 40;
          s.toolOverrides.stampHeight = 40;
        });
        const c=cell(16); await click(page,c.midX,c.midY);
        await sleep(300);
      } },
    { tool:'measureDistance', type:'measureDistance', run: async()=>{ const c=cell(17); await click(page,c.x1,c.y1); await click(page,c.x2,c.y1+5); await click(page,c.midX,c.y2); } },
    { tool:'measureArea', type:'measureArea', run: async()=>{ const c=cell(18); await click(page,c.x1,c.y1); await click(page,c.x2,c.y1+5); await click(page,c.x2,c.y2); await click(page,c.x1,c.y2); await click(page,c.x1,c.y1); await sleep(150); await rclick(page,c.x1,c.y1); await sleep(200); } },
    { tool:'measurePerimeter', type:'measurePerimeter', run: async()=>{ const c=cell(19); await click(page,c.x1,c.y1); await click(page,c.x2,c.y1+5); await click(page,c.x2,c.y2); await click(page,c.x1,c.y2); await sleep(150); await rclick(page,c.x1,c.y2); await sleep(200); } },
    { tool:'measureAngle', type:'measureAngle', run: async()=>{ const c=cell(20); await click(page,c.x1,c.y1); await click(page,c.midX,c.midY); await click(page,c.x2,c.y1); } },
    { tool:'scaleRegion', type:'scaleRegion', run: async()=>{ const c=cell(21); await drag(page,c.x1,c.y1,c.x2,c.y2); await sleep(400); await page.keyboard.press('Enter'); await sleep(200); } },
    { tool:'parametricSymbol', type:'parametricSymbol', run: async()=>{
        await page.evaluate(()=>{
          const s = window.__OPDFS?.state;
          if(s) s.parametricPickerOpen = true;
        });
        await sleep(400);
        await page.evaluate(()=>{
          const items = document.querySelectorAll('[data-template-key], .parametric-picker-item, .template-card, .parametric-template');
          if(items[0]){ items[0].click(); }
        });
        await sleep(300);
        const c=cell(22); await drag(page,c.x1,c.y1,c.x2,c.y2);
      } },
  ];

  const results = [];
  for(const t of tests){
    const r = await exerciseTool(page, t.tool, t.tool, t.type, t.run);
    console.log(`${t.tool}: added=${r.added} type=${r.gotType} err=${r.err||'-'} (${r.before}->${r.after}) tool=${r.actualTool}`);
    results.push(r);
  }

  console.log('\n=== RESULTS ===');
  console.log('| # | Tool | OK | Notes |');
  console.log('|---|------|----|-------|');
  results.forEach((r,i)=>{
    const ok = r.added && (r.gotType === r.expectedType);
    let note = '';
    if(!r.added) note = `no annotation added; ${r.err||''}`;
    else if(r.gotType !== r.expectedType) note = `wrong type: expected ${r.expectedType} got ${r.gotType}`;
    else {
      const a = r.last;
      if(a) note = JSON.stringify(a).slice(0,100);
    }
    console.log(`| ${i+1} | ${r.name} | ${ok?'YES':'NO'} | ${note} |`);
  });

  await browser.close();
})().catch(e=>{ console.error('FATAL', e); process.exit(2); });
