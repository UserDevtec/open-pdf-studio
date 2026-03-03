const { PDFDocument, PDFName } = require('pdf-lib');
const fs = require('fs');
const zlib = require('zlib');

async function inspect() {
  const bytes = fs.readFileSync('D:\Repos\(Impertio)\(Old)\test pdf\111111111111111111.pdf');
  const doc = await PDFDocument.load(bytes);
  const context = doc.context;
  const pages = doc.getPages();
  
  for (let p = 0; p < pages.length; p++) {
    const page = pages[p];
    const annotsRaw = page.node.get(PDFName.of('Annots'));
    if (!annotsRaw) continue;
    const annots = context.lookup(annotsRaw);
    
    for (let i = 0; i < annots.size(); i++) {
      const dict = context.lookup(annots.get(i));
      if (!dict) continue;
      const subtype = dict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/FreeText') continue;
      
      const cl = dict.get(PDFName.of('CL'));
      const it = dict.get(PDFName.of('IT'));
      const clStr = cl ? cl.toString() : null;
      const itStr = it ? it.toString() : null;
      
      console.log('
' + '='.repeat(60));
      console.log('=== Page ' + (p+1) + ', FreeText annotation index ' + i + ' ===');
      if (itStr) console.log('Intent (IT): ' + itStr);
      if (clStr) console.log('Callout Line (CL): ' + clStr);
      console.log('='.repeat(60));
      
      const ds = dict.get(PDFName.of('DS'));
      if (ds) {
        console.log('
--- DS (Default Style) ---');
        console.log('Raw:', ds.toString());
        if (ds.toString().toLowerCase().includes('line-height')) {
          console.log('>>> FOUND line-height in DS! <<<');
        }
      } else {
        console.log('
DS: NOT FOUND');
      }
      
      const rc = dict.get(PDFName.of('RC'));
      if (rc) {
        console.log('
--- RC (Rich Content) ---');
        const rcStr = rc.toString();
        console.log('Raw:', rcStr);
        if (rcStr.toLowerCase().includes('line-height')) {
          console.log('>>> FOUND line-height in RC! <<<');
        }
        if (rcStr.toLowerCase().includes('leading')) {
          console.log('>>> FOUND leading in RC! <<<');
        }
      } else {
        console.log('
RC: NOT FOUND');
      }
      
      const tl = dict.get(PDFName.of('TL'));
      if (tl) {
        console.log('
--- TL (annotation dict) ---');
        console.log('Value:', tl.toString());
      } else {
        console.log('
TL in annotation dict: NOT FOUND');
      }
      
      const da = dict.get(PDFName.of('DA'));
      if (da) {
        console.log('
--- DA (Default Appearance) ---');
        console.log('Raw:', da.toString());
      } else {
        console.log('
DA: NOT FOUND');
      }
      
      const rect = dict.get(PDFName.of('Rect'));
      if (rect) {
        console.log('
--- Rect ---');
        console.log('Value:', rect.toString());
      }
      
      const contents = dict.get(PDFName.of('Contents'));
      if (contents) {
        console.log('
--- Contents ---');
        console.log('Value:', contents.toString());
      }
      
      const apRaw = dict.get(PDFName.of('AP'));
      if (apRaw) {
        const ap = context.lookup(apRaw);
        const nRaw = ap ? ap.get(PDFName.of('N')) : null;
        if (nRaw) {
          const nStream = context.lookup(nRaw);
          if (nStream) {
            let rawBytes;
            if (typeof nStream.getContents === 'function') {
              rawBytes = nStream.getContents();
            } else if (typeof nStream.contents === 'function') {
              rawBytes = nStream.contents();
            } else if (nStream.contentsCache && nStream.contentsCache.value) {
              rawBytes = nStream.contentsCache.value;
            } else if (nStream.contents) {
              rawBytes = nStream.contents;
            }
            
            const streamDict = nStream.dict || nStream;
            const filterRaw = streamDict.get ? streamDict.get(PDFName.of('Filter')) : null;
            
            console.log('
--- AP/N Stream ---');
            console.log('Filter:', filterRaw ? filterRaw.toString() : 'none');
            
            if (rawBytes) {
              let content;
              const buf = Buffer.from(rawBytes);
              
              if (filterRaw && filterRaw.toString() === '/FlateDecode') {
                try {
                  content = zlib.inflateSync(buf).toString('latin1');
                } catch(e) {
                  console.log('inflate failed, trying raw...');
                  content = buf.toString('latin1');
                }
              } else {
                content = buf.toString('latin1');
              }
              
              if (content) {
                console.log('
AP stream content:');
                console.log(content);
                
                const tlMatches = [...content.matchAll(/([-d.]+)s+TL/g)];
                if (tlMatches.length > 0) {
                  console.log('
>>> TL (text leading) operators found:');
                  tlMatches.forEach(function(m) { console.log('    ' + m[1] + ' TL'); });
                } else {
                  console.log('
TL operator in AP stream: NOT FOUND');
                }
                
                const tdMatches = [...content.matchAll(/([-d.]+)s+([-d.]+)s+Td/g)];
                if (tdMatches.length > 0) {
                  console.log('
>>> Td operators found:');
                  tdMatches.forEach(function(m) { console.log('    ' + m[1] + ' ' + m[2] + ' Td'); });
                } else {
                  console.log('
Td operators: NOT FOUND');
                }
                
                const tstarMatches = content.match(/T*/g);
                if (tstarMatches) {
                  console.log('
>>> T* operators found: ' + tstarMatches.length + ' occurrences');
                }
                
                const tfMatches = [...content.matchAll(//(S+)s+([-d.]+)s+Tf/g)];
                if (tfMatches.length > 0) {
                  console.log('
>>> Tf (font) operators:');
                  tfMatches.forEach(function(m) { console.log('    /' + m[1] + ' ' + m[2] + ' Tf'); });
                }
              }
            } else {
              console.log('Could not extract AP stream bytes');
              console.log('Stream type:', nStream.constructor.name);
            }
          }
        }
      } else {
        console.log('
AP (Appearance): NOT FOUND');
      }
      
      console.log('
--- All annotation dict keys ---');
      if (typeof dict.entries === 'function') {
        for (const [key, val] of dict.entries()) {
          const valStr = val.toString().substring(0, 200);
          console.log('  ' + key.toString() + ': ' + valStr);
        }
      }
    }
  }
}

inspect().catch(console.error);
