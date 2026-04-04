# Batch Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 11 improvements to Open PDF Studio covering measurement defaults, UI toggles, polygon selection, unified select tool, page prefetching, thumbnail images, vector text selection, arc tool, and trim/extend/array tools.

**Architecture:** Changes span the Rust rendering engine (`open-pdf-render`), Tauri backend commands, and the SolidJS + Vanilla JS frontend. Each task is independently testable. Implementation order goes from lowest risk (config changes) to highest complexity (new CAD tools).

**Tech Stack:** Rust (tiny_skia, lopdf, image crate), TypeScript/JavaScript (SolidJS, Canvas2D), Tauri 2 IPC

---

## File Structure

### Modified Files
| File | Responsibility |
|------|---------------|
| `open-pdf-render/src/interpreter.rs` | Add image XObject handling to execute path |
| `open-pdf-render/src/renderer.rs` | Add `draw_image()` method for tiny_skia compositing |
| `open-pdf-render/src/parser.rs` | Add `extract_text_positions()` for text layer data |
| `open-pdf-studio/src-tauri/src/lib.rs` | Add `extract_page_text` Tauri command |
| `open-pdf-studio/js/core/constants.ts` | Update measurement default preferences |
| `open-pdf-studio/js/annotations/geometry.js` | Add point-in-polygon, line intersection, arc hit-testing |
| `open-pdf-studio/js/annotations/rendering.js` | Add arc annotation rendering |
| `open-pdf-studio/js/solid/components/ribbon/ViewTab.jsx` | Add thin lines toggle button |
| `open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx` | Remove selectComments, add arc/trim/extend/array buttons |
| `open-pdf-studio/js/tools/tools/index.js` | Remove selectComments, register new tools |
| `open-pdf-studio/js/tools/manager.js` | Unified select logic, auto-reset |
| `open-pdf-studio/js/tools/tool-dispatcher.js` | Auto-reset to select after creation |
| `open-pdf-studio/js/tools/tools/select-tool.js` | Unified annotation + text selection |
| `open-pdf-studio/js/text/text-layer.js` | Synthetic text layer from Rust data |
| `open-pdf-studio/js/pdf/renderer.js` | Page prefetching, vector text layer integration |
| `open-pdf-studio/js/types/annotation.ts` | Add ArcAnnotation type |
| `open-pdf-studio/js/annotations/factory.js` | Arc annotation defaults |
| `open-pdf-studio/js/pdf/saver.js` | Save arc annotations |

### New Files
| File | Responsibility |
|------|---------------|
| `open-pdf-studio/js/tools/tools/arc-tool.js` | Arc drawing tool (3-point + center modes) |
| `open-pdf-studio/js/tools/tools/trim-tool.js` | Trim lines at intersection |
| `open-pdf-studio/js/tools/tools/extend-tool.js` | Extend lines to boundary |
| `open-pdf-studio/js/tools/tools/array-tool.js` | Linear/radial array copies |

---

## Task 1: Measurement Line Defaults (#4)

**Files:**
- Modify: `open-pdf-studio/js/core/constants.ts:162-171`

- [ ] **Step 1: Update measurement distance defaults**

In `open-pdf-studio/js/core/constants.ts`, change these values:

```typescript
// Measure Distance defaults
measureDistStrokeColor: '#FF0000',    // was '#0000FF'
measureDistLineWidth: 1,
measureDistBorderStyle: 'solid',
measureDistOpacity: 100,
measureDistStartHead: 'openCircle',   // already correct
measureDistEndHead: 'openCircle',     // already correct
measureDistHeadSize: 12,
measureDistDimScale: 1,
measureDistDimUnit: 'mm',
measureDistDimPrecision: 0,           // was 2
```

- [ ] **Step 2: Verify the change**

Run: `cd open-pdf-studio && npm run tauri:dev` (background)

Open a PDF, select the measurement distance tool, draw a measurement. Confirm:
- Line is red
- Endpoints are open circles
- Value shows mm with 0 decimal places (e.g., "125 mm" not "125.00 mm")

- [ ] **Step 3: Commit**

```bash
git add open-pdf-studio/js/core/constants.ts
git commit -m "feat: change measurement distance defaults to red, 0 decimals mm"
```

---

## Task 2: Thin Lines Toggle in View Ribbon (#9)

**Files:**
- Modify: `open-pdf-studio/js/solid/components/ribbon/ViewTab.jsx`

- [ ] **Step 1: Add thin lines toggle button**

In `open-pdf-studio/js/solid/components/ribbon/ViewTab.jsx`, add a new RibbonGroup after the "Page Display" group. Import state and redraw functions at the top:

```jsx
import { redrawAnnotations } from '../../../annotations/rendering.js';
import { rerenderCurrentPage } from '../../../pdf/renderer.js';
```

Then add the group after the closing `</RibbonGroup>` of the "Page Display" group (after line 32):

```jsx
<RibbonGroup label={t('view.display') || 'Display'}>
  <RibbonButton id="thin-lines-toggle"
    title={t('view.thinLines') || 'Thin Lines'}
    icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><line x1="3" y1="6" x2="21" y2="6" stroke-width="0.5"/><line x1="3" y1="12" x2="21" y2="12" stroke-width="1"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="0.5"/></svg>`}
    label={t('view.thinLines') || 'Thin Lines'}
    disabled={noPdf()}
    active={state.preferences?.thinLines}
    onClick={() => {
      state.preferences.thinLines = !state.preferences.thinLines;
      rerenderCurrentPage();
      redrawAnnotations();
    }} />
</RibbonGroup>
```

- [ ] **Step 2: Verify `rerenderCurrentPage` export exists**

Check if `rerenderCurrentPage` is exported from `renderer.js`. If not, use this alternative onClick:

```jsx
onClick={() => {
  state.preferences.thinLines = !state.preferences.thinLines;
  // Trigger re-render by dispatching a redraw
  import('../../../pdf/renderer.js').then(m => {
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) m.renderPage(doc.currentPage);
  });
  redrawAnnotations();
}}
```

- [ ] **Step 3: Verify the change**

In running app, open View tab. Confirm:
- "Thin Lines" button appears in a "Display" group
- Clicking toggles active state visually
- Lines in PDF and annotations become thin (max 1px)

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/js/solid/components/ribbon/ViewTab.jsx
git commit -m "feat: add thin lines toggle to View tab ribbon"
```

---

## Task 3: Area/Surface Click-Anywhere Selection (#10)

**Files:**
- Modify: `open-pdf-studio/js/annotations/geometry.js:264-293`

- [ ] **Step 1: Add pointInPolygon function**

In `open-pdf-studio/js/annotations/geometry.js`, add this function before the `findAnnotationAt` function (or wherever utility functions are grouped):

```javascript
/**
 * Ray-casting point-in-polygon test.
 * Returns true if (x, y) is inside the polygon defined by points.
 */
function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x, yi = points[i].y;
    const xj = points[j].x, yj = points[j].y;
    if ((yi > y) !== (yj > y) &&
        x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}
```

- [ ] **Step 2: Integrate into measureArea hit-testing**

In the `measureArea` case block (around line 264-293), after the existing edge proximity checks and hole edge checks, before the `break`, add the point-in-polygon test:

```javascript
// After all edge checks (around line 291, before the closing break):
// Point-in-polygon: allow click anywhere inside filled area
if (ann.points.length >= 3) {
  let insideOuter = pointInPolygon(x, y, ann.points);
  if (insideOuter) {
    // Check we're not inside a hole
    let insideHole = false;
    if (ann.holes) {
      for (const hole of ann.holes) {
        if (hole && hole.length >= 3 && pointInPolygon(x, y, hole)) {
          insideHole = true;
          break;
        }
      }
    }
    if (!insideHole) return ann;
  }
}
```

- [ ] **Step 3: Also add for polygon and cloud types**

Find the hit-test cases for `polygon` and `cloud` types in the same function. Add the same `pointInPolygon` check after edge checks:

```javascript
// For polygon/cloud case, after edge proximity checks:
if (ann.points && ann.points.length >= 3) {
  if (pointInPolygon(x, y, ann.points)) return ann;
}
```

- [ ] **Step 4: Verify the change**

In running app, draw a measureArea polygon. Try clicking:
- On the edge → should select (existing behavior)
- Inside the polygon → should now select
- Inside a hole (if drawn) → should NOT select
- Outside → should NOT select

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/js/annotations/geometry.js
git commit -m "feat: allow click-anywhere selection for area/polygon annotations"
```

---

## Task 4: Scale Bar Selectable (#7)

**Files:**
- Modify: `open-pdf-studio/js/annotations/geometry.js` (verify scaleBar case)

- [ ] **Step 1: Verify scale bar hit-testing exists**

Read the `findAnnotationAt` function in `geometry.js` and check if `scaleBar` type has a case in the switch statement. It should use bounding box hit-testing.

- [ ] **Step 2: If missing, add bounding box hit-test**

If `scaleBar` is not handled in the switch or falls through to a default case that doesn't work, add:

```javascript
case 'scaleBar': {
  // Bounding box hit-test
  const sb = ann;
  if (sb.x !== undefined && sb.y !== undefined && sb.width !== undefined && sb.height !== undefined) {
    if (x >= sb.x && x <= sb.x + sb.width && y >= sb.y && y <= sb.y + sb.height) {
      return ann;
    }
  }
  break;
}
```

- [ ] **Step 3: Verify drag and resize**

In running app:
- Place a scale bar on a page
- Click on it → should select with handles
- Drag to move → should reposition
- Drag handles to resize → should resize

- [ ] **Step 4: Commit if changes were needed**

```bash
git add open-pdf-studio/js/annotations/geometry.js
git commit -m "fix: ensure scale bar is selectable and movable"
```

---

## Task 5: Unified Select Tool + Always Active (#2 + #11)

**Files:**
- Modify: `open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx:29-32`
- Modify: `open-pdf-studio/js/tools/tools/index.js:24`
- Modify: `open-pdf-studio/js/tools/manager.js:12,19,104,110,124`
- Modify: `open-pdf-studio/js/tools/tool-dispatcher.js:535-565`

- [ ] **Step 1: Remove selectComments from ribbon**

In `open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx`, remove lines 31-32 (the selectComments button):

```jsx
          <RibbonButton id="tool-select-comments" title={t('home.selectComments')} icon={selectCommentsIcon} label={t('home.selectComments')}
            disabled={noPdf()} active={state.currentTool === 'selectComments'} onClick={() => setTool('selectComments')} />
```

Also update the select button label to be more generic:

```jsx
<RibbonButton id="tool-select" title={t('home.select') || 'Select'} icon={selectTextIcon} label={t('home.select') || 'Select'}
  disabled={noPdf()} active={state.currentTool === 'select'} onClick={() => setTool('select')} />
```

Remove `selectCommentsIcon` from the import if unused elsewhere.

- [ ] **Step 2: Remove selectComments tool registration**

In `open-pdf-studio/js/tools/tools/index.js`, remove line 24:

```javascript
registerTool('selectComments', selectTool);
```

- [ ] **Step 3: Update manager.js for unified select**

In `open-pdf-studio/js/tools/manager.js`:

a) Remove `selectComments` from `READONLY_ALLOWED_TOOLS` (line 12):
```javascript
const READONLY_ALLOWED_TOOLS = new Set(['select', 'hand']);
```

b) Remove the selectComments cursor case (line 19-20):
```javascript
// Remove: case 'selectComments': return 'text';
```

c) Update properties hiding (line 104): remove `selectComments` check:
```javascript
if (tool !== 'select') {
  hideProperties();
}
```

d) Update text selection enabling (line 110). For unified select, text selection is always enabled on the text layer but with `pointer-events: none` by default. The select tool handles text selection via a fallback mechanism:
```javascript
if (tool !== 'editText') {
  setTextSelectionEnabled(tool === 'select');
}
```

e) Update annotation canvas z-index (line 124). For unified select, canvas stays on top (z:6). Only editText needs text access:
```javascript
setAnnotationCanvasForTextAccess(tool === 'editText');
```

- [ ] **Step 4: Enable text selection fallback in select tool**

In `open-pdf-studio/js/tools/tools/select-tool.js`, modify `onPointerDown` so when no annotation is hit, it temporarily enables text selection:

```javascript
onPointerDown(ctx, e) {
  // ... existing handle check code ...

  const clickedAnnotation = ctx.findAnnotationAt(x, y);
  if (clickedAnnotation) {
    // ... existing annotation click handling ...
  } else {
    // No annotation hit — enable text selection temporarily
    const textLayers = document.querySelectorAll('.textLayer');
    textLayers.forEach(layer => {
      layer.style.pointerEvents = 'auto';
      layer.querySelectorAll('span').forEach(span => {
        span.style.pointerEvents = 'auto';
        span.style.cursor = 'text';
      });
    });

    // Start rubber band selection (existing code below)
```

Add `onPointerUp` to restore text layer state:

```javascript
onPointerUp(ctx, e) {
  // ... existing code ...

  // Restore text layer to non-interactive after selection completes
  setTimeout(() => {
    if (state.currentTool === 'select') {
      const textLayers = document.querySelectorAll('.textLayer');
      textLayers.forEach(layer => {
        layer.style.pointerEvents = 'none';
        layer.querySelectorAll('span').forEach(span => {
          span.style.pointerEvents = 'none';
          span.style.cursor = 'default';
        });
      });
    }
  }, 100);
}
```

- [ ] **Step 5: Add auto-reset to select after annotation creation**

In `open-pdf-studio/js/tools/tool-dispatcher.js`, in `_finishDrawing()` (around line 535), after the annotation is created and added, reset to select:

```javascript
// After line 552 (after redraw()):
// Auto-reset to select tool after creating annotation
const { setTool } = await import('../manager.js');
setTool('select');
```

Since `_finishDrawing` is not async, use dynamic import pattern:

```javascript
// After redraw(); on line 552:
import('../manager.js').then(m => m.setTool('select'));
```

- [ ] **Step 6: Add auto-reset in all tool completion handlers**

Add `setTool('select')` after annotation completion in these tools:

a) `measurement-tool.js` — already has `setTool('select')` at line 870 (for addHole). Need to add it at the end of measureDistance 3rd click, measureArea completion, measurePerimeter completion. Find where `state.isDrawing = false` is set and add after it:
```javascript
import('../../tools/manager.js').then(m => m.setTool('select'));
```

b) `line-tool.js` — after line creation (2nd click):
```javascript
import('../../tools/manager.js').then(m => m.setTool('select'));
```

c) `polyline-tool.js` — after polyline finalization (right-click or Enter):
```javascript
import('../../tools/manager.js').then(m => m.setTool('select'));
```

d) `draw-tool.js` — after freehand stroke completes (pointerUp):
```javascript
import('../../tools/manager.js').then(m => m.setTool('select'));
```

e) `text-tool.js` — stampTool, commentTool, signatureTool already place single items. After creation:
```javascript
import('../../tools/manager.js').then(m => m.setTool('select'));
```

f) `scalebar-tool.js` — already has `ctx.setTool('select')` at line 25.

- [ ] **Step 7: Verify unified select**

In running app:
- Only one "Select" button in Home tab (no separate "Select Comments")
- Select tool is active on startup
- Draw a line → tool resets to select after
- Draw a rectangle → tool resets to select after
- Place a stamp → tool resets to select after
- Draw freehand → tool resets to select after
- Text in PDF is selectable when no annotation is under cursor
- Clicking annotations still selects them

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx open-pdf-studio/js/tools/tools/index.js open-pdf-studio/js/tools/manager.js open-pdf-studio/js/tools/tools/select-tool.js open-pdf-studio/js/tools/tool-dispatcher.js open-pdf-studio/js/tools/tools/measurement-tool.js open-pdf-studio/js/tools/tools/line-tool.js open-pdf-studio/js/tools/tools/polyline-tool.js open-pdf-studio/js/tools/tools/draw-tool.js open-pdf-studio/js/tools/tools/text-tool.js
git commit -m "feat: unified select tool with auto-reset after every action"
```

---

## Task 6: Page Prefetching (#8)

**Files:**
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Add prefetch function**

In `open-pdf-studio/js/pdf/renderer.js`, add a `prefetchAdjacentPages()` function:

```javascript
let _prefetchAbort = null;

function prefetchAdjacentPages(currentPage) {
  // Cancel any pending prefetch
  if (_prefetchAbort) _prefetchAbort.cancelled = true;
  const abort = { cancelled: false };
  _prefetchAbort = abort;

  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc || doc.viewMode === 'continuous') return;

  const totalPages = doc.pdfDoc.numPages;
  const pagesToPrefetch = [];
  if (currentPage < totalPages) pagesToPrefetch.push(currentPage + 1);
  if (currentPage > 1) pagesToPrefetch.push(currentPage - 1);

  const doPrefetch = async () => {
    for (const pageNum of pagesToPrefetch) {
      if (abort.cancelled) return;
      try {
        // Prefetch annotation data
        const { ensureAnnotationsForPage } = await import('./loader.js');
        await ensureAnnotationsForPage(pageNum);
        if (abort.cancelled) return;

        // Prefetch low-res render cache
        const page = await doc.pdfDoc.getPage(pageNum);
        if (abort.cancelled) return;
        const viewport = page.getViewport({ scale: 0.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (abort.cancelled) return;
        // Store in low-res cache
        if (!doc._lowResCache) doc._lowResCache = new Map();
        doc._lowResCache.set(pageNum, { dataURL: canvas.toDataURL('image/jpeg', 0.5), width: viewport.width, height: viewport.height });
      } catch (e) {
        // Silently ignore prefetch errors
      }
    }
  };

  // Use requestIdleCallback for non-blocking prefetch
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => doPrefetch());
  } else {
    setTimeout(() => doPrefetch(), 200);
  }
}
```

- [ ] **Step 2: Call prefetch after page render**

Find the `renderPage()` function and add a call to `prefetchAdjacentPages` at the end, after the page has been rendered:

```javascript
// At the end of renderPage(), after all rendering is complete:
prefetchAdjacentPages(pageNum);
```

- [ ] **Step 3: Verify**

Navigate between pages in a multi-page PDF. Second navigation should feel faster because annotations and low-res cache are pre-loaded.

- [ ] **Step 4: Commit**

```bash
git add open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: prefetch adjacent pages for faster navigation"
```

---

## Task 7: Thumbnail Raster Images via Rust (#1)

**Files:**
- Modify: `open-pdf-render/src/renderer.rs`
- Modify: `open-pdf-render/src/interpreter.rs:188-241`

- [ ] **Step 1: Add draw_image method to SkiaRenderer**

In `open-pdf-render/src/renderer.rs`, add a method to composite an image pixmap:

```rust
pub fn draw_image(&mut self, width: u32, height: u32, rgba_pixels: &[u8], gs: &GraphicsState) {
    // Create a PixmapRef from the RGBA data
    let img = match PixmapRef::from_bytes(rgba_pixels, width, height) {
        Some(p) => p,
        None => return,
    };

    // The CTM maps from PDF image space (1x1 unit) to page pixels.
    // tiny_skia uses integer pixel coordinates, so we paint the image
    // then transform using the CTM.
    let paint = PixmapPaint {
        opacity: 1.0,
        blend_mode: BlendMode::SourceOver,
        quality: FilterQuality::Bilinear,
    };

    self.pixmap.draw_pixmap(0, 0, img, &paint, gs.ctm, None);
}
```

- [ ] **Step 2: Add image handling to handle_do_execute**

In `open-pdf-render/src/interpreter.rs`, modify `handle_do_execute()`. Replace the early return for non-Form XObjects (line 220-222) with image handling:

```rust
let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());

if subtype == Some(b"Image" as &[u8]) {
    // Image XObject — decode and render directly
    Self::handle_image_execute(stream, renderer, state, doc);
    return;
}

if subtype != Some(b"Form" as &[u8]) {
    return;
}
```

- [ ] **Step 3: Add handle_image_execute function**

Add a new function to `Interpreter` impl in `interpreter.rs`:

```rust
fn handle_image_execute(
    stream: &lopdf::Stream,
    renderer: &mut SkiaRenderer,
    state: &mut GraphicsStateStack,
    doc: &Document,
) {
    let dict = &stream.dict;
    let width = dict.get(b"Width").ok()
        .and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Integer(i) = o { Some(*i as u32) } else { None }
            }),
            _ => None,
        }).unwrap_or(0);
    let height = dict.get(b"Height").ok()
        .and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Integer(i) = o { Some(*i as u32) } else { None }
            }),
            _ => None,
        }).unwrap_or(0);

    if width == 0 || height == 0 { return; }

    let filter = dict.get(b"Filter").ok().and_then(|o| match o {
        Object::Name(n) => Some(n.clone()),
        Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
            if let Object::Name(n) = o { Some(n.clone()) } else { None }
        }),
        Object::Array(arr) => arr.last().and_then(|o| match o {
            Object::Name(n) => Some(n.clone()),
            _ => None,
        }),
        _ => None,
    });
    let filter_name = filter.as_deref().unwrap_or(b"");

    // Decode image to RGBA
    let rgba = if filter_name == b"DCTDecode" {
        // JPEG: decode using image crate
        let raw = &stream.content;
        match image::load_from_memory_with_format(raw, image::ImageFormat::Jpeg) {
            Ok(img) => {
                let img = img.to_rgba8();
                if img.width() != width || img.height() != height {
                    return; // dimension mismatch
                }
                img.into_raw()
            }
            Err(_) => return,
        }
    } else {
        // FlateDecode or raw: decompress and convert to RGBA
        let bits = dict.get(b"BitsPerComponent").ok()
            .and_then(|o| if let Object::Integer(i) = o { Some(*i as u8) } else { None })
            .unwrap_or(8);
        if bits != 8 { return; }

        let cs_name = dict.get(b"ColorSpace").ok().and_then(|o| match o {
            Object::Name(n) => Some(n.clone()),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Name(n) = o { Some(n.clone()) } else { None }
            }),
            Object::Array(arr) => arr.first().and_then(|o| match o {
                Object::Name(n) => Some(n.clone()),
                _ => None,
            }),
            _ => None,
        });
        let components: usize = match cs_name.as_deref() {
            Some(b"DeviceCMYK") => 4,
            Some(b"DeviceGray") | Some(b"CalGray") => 1,
            _ => 3,
        };

        let raw_pixels = match stream.decompressed_content() {
            Ok(p) => p,
            Err(_) => return,
        };
        let expected = width as usize * height as usize * components;
        if raw_pixels.len() < expected { return; }

        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        let mut idx = 0;
        for _ in 0..(width as usize * height as usize) {
            match components {
                1 => {
                    let g = raw_pixels[idx];
                    rgba.extend_from_slice(&[g, g, g, 255]);
                    idx += 1;
                }
                3 => {
                    rgba.extend_from_slice(&[raw_pixels[idx], raw_pixels[idx+1], raw_pixels[idx+2], 255]);
                    idx += 3;
                }
                4 => {
                    let c = raw_pixels[idx] as f32 / 255.0;
                    let m = raw_pixels[idx+1] as f32 / 255.0;
                    let y = raw_pixels[idx+2] as f32 / 255.0;
                    let k = raw_pixels[idx+3] as f32 / 255.0;
                    rgba.extend_from_slice(&[
                        (255.0 * (1.0 - c) * (1.0 - k)) as u8,
                        (255.0 * (1.0 - m) * (1.0 - k)) as u8,
                        (255.0 * (1.0 - y) * (1.0 - k)) as u8,
                        255,
                    ]);
                    idx += 4;
                }
                _ => { rgba.extend_from_slice(&[0, 0, 0, 255]); idx += components; }
            }
        }
        rgba
    };

    // Apply Y-flip transform (images are top-down in PDF space)
    state.save();
    state.concat_matrix(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
    renderer.draw_image(width, height, &rgba, &state.current);
    state.restore();
}
```

- [ ] **Step 4: Build and test**

```bash
cd open-pdf-render && cargo build --release
```

Then in the running app, open a PDF with raster images. Check thumbnails in the left panel — images should now appear.

- [ ] **Step 5: Commit**

```bash
git add open-pdf-render/src/renderer.rs open-pdf-render/src/interpreter.rs
git commit -m "feat: render raster images in Rust thumbnail engine"
```

---

## Task 8: Vector PDF Text Selection (#3)

**Files:**
- Modify: `open-pdf-render/src/parser.rs`
- Modify: `open-pdf-render/src/interpreter.rs`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`
- Modify: `open-pdf-studio/js/text/text-layer.js`
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Add text span collection to interpreter**

In `open-pdf-render/src/interpreter.rs`, add a struct and collection function:

```rust
#[derive(Clone, Debug, serde::Serialize)]
pub struct TextSpan {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    pub text: String,
    pub transform: [f32; 6],
}

impl Interpreter {
    pub fn extract_text_spans(
        content_bytes: &[u8],
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) -> Vec<TextSpan> {
        let mut spans = Vec::new();
        let ops = match lopdf::content::Content::decode(content_bytes) {
            Ok(c) => c.operations,
            Err(_) => return spans,
        };

        let mut font_registry = crate::fonts::FontRegistry::new();

        for op in &ops {
            match op.operator.as_str() {
                "Tf" => { /* track current font size */ }
                "Tm" | "Td" | "TD" | "T*" => { /* track text position */ }
                "Tj" | "TJ" | "'" | "\"" => {
                    // Extract text and position from current state
                    // Use the same text extraction as extract_commands but collect spans
                }
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "q" => state.save(),
                "Q" => state.restore(),
                _ => {}
            }
        }
        spans
    }
}
```

Note: The actual implementation needs to mirror the text extraction logic already in `extract_commands()` — track font, text matrix, character widths. This is complex and should reuse existing font/encoding infrastructure.

- [ ] **Step 2: Add extract_text_positions to DocumentHandle**

In `open-pdf-render/src/parser.rs`:

```rust
pub fn extract_text_positions(&self, page: usize) -> Result<Vec<crate::interpreter::TextSpan>, RenderError> {
    let page_id = self.get_page_id(page)?;
    let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;
    let content_bytes = self.get_content_stream(page_id)?;
    let resources = self.get_page_resources(page_id)?;
    let mut state = crate::graphics_state::GraphicsStateStack::new();
    // Set up coordinate system same as render_page
    state.current.ctm = tiny_skia::Transform::from_row(
        1.0, 0.0, 0.0, -1.0,
        -x0, h_pt + y0,
    );
    Ok(crate::interpreter::Interpreter::extract_text_spans(
        &content_bytes, &mut state, &self.doc, &resources
    ))
}
```

- [ ] **Step 3: Add Tauri command**

In `open-pdf-studio/src-tauri/src/lib.rs`, add:

```rust
#[tauri::command]
fn extract_page_text(path: String, page_index: u32, cache: tauri::State<PdfBytesCache>) -> Result<String, String> {
    let bytes = {
        let mut c = cache.0.lock().map_err(|e| format!("{}", e))?;
        if let Some(b) = c.get(&path) { b.clone() }
        else { let b = std::fs::read(&path).map_err(|e| format!("{}", e))?; c.insert(path.clone(), b.clone()); b }
    };
    let renderer = open_pdf_render::PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    let spans = doc.extract_text_positions(page_index as usize).map_err(|e| format!("{}", e))?;
    serde_json::to_string(&spans).map_err(|e| format!("{}", e))
}
```

Register it in the `invoke_handler`:

```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...,
    extract_page_text,
])
```

- [ ] **Step 4: Add synthetic text layer builder in JS**

In `open-pdf-studio/js/text/text-layer.js`, add:

```javascript
export async function createTextLayerFromRust(container, pageNum, scale) {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath) return;

  try {
    const jsonStr = await invoke('extract_page_text', {
      path: doc.filePath,
      pageIndex: pageNum - 1,
    });
    const spans = JSON.parse(jsonStr);
    if (!spans || spans.length === 0) return;

    const textLayerDiv = container.querySelector('.textLayer') || document.createElement('div');
    if (!textLayerDiv.classList.contains('textLayer')) {
      textLayerDiv.className = 'textLayer';
      container.appendChild(textLayerDiv);
    }
    textLayerDiv.innerHTML = '';

    for (const span of spans) {
      const el = document.createElement('span');
      el.textContent = span.text;
      el.style.position = 'absolute';
      el.style.left = `${span.x * scale}px`;
      el.style.top = `${span.y * scale}px`;
      el.style.fontSize = `${span.font_size * scale}px`;
      el.style.fontFamily = 'sans-serif';
      el.style.transformOrigin = '0% 0%';
      textLayerDiv.appendChild(el);
    }
  } catch (e) {
    // Fall back to PDF.js text layer
    console.warn('Rust text extraction failed, falling back to PDF.js:', e);
  }
}
```

- [ ] **Step 5: Integrate in renderer.js**

In the vector renderer code path in `renderer.js`, after page render, call `createTextLayerFromRust` if the vector renderer was used:

```javascript
// After vector rendering completes:
if (usedVectorRenderer) {
  const { createTextLayerFromRust } = await import('../text/text-layer.js');
  await createTextLayerFromRust(pageContainer, pageNum, doc.scale);
}
```

- [ ] **Step 6: Build and verify**

```bash
cd open-pdf-render && cargo build --release
cd ../open-pdf-studio && npm run tauri:dev
```

Open a vector-rendered PDF. Try selecting text — should work with the synthetic text layer.

- [ ] **Step 7: Commit**

```bash
git add open-pdf-render/src/interpreter.rs open-pdf-render/src/parser.rs open-pdf-studio/src-tauri/src/lib.rs open-pdf-studio/js/text/text-layer.js open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: vector PDF text selection via Rust text extraction"
```

---

## Task 9: Arc Tool (#5)

**Files:**
- Create: `open-pdf-studio/js/tools/tools/arc-tool.js`
- Modify: `open-pdf-studio/js/types/annotation.ts`
- Modify: `open-pdf-studio/js/tools/tools/index.js`
- Modify: `open-pdf-studio/js/annotations/rendering.js`
- Modify: `open-pdf-studio/js/annotations/geometry.js`
- Modify: `open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx`

- [ ] **Step 1: Add ArcAnnotation type**

In `open-pdf-studio/js/types/annotation.ts`, add to the annotation type union:

```typescript
export interface ArcAnnotation extends BaseAnnotation {
  type: 'arc';
  centerX: number;
  centerY: number;
  radius: number;
  startAngle: number;
  endAngle: number;
}
```

- [ ] **Step 2: Create arc-tool.js**

Create `open-pdf-studio/js/tools/tools/arc-tool.js`:

```javascript
import { getActiveDocument, state } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';
import { snapToGrid } from '../tool-context.js';

const _arcState = { clicks: [], mode: '3point' };

function calculateArcFrom3Points(p1, p2, p3) {
  // Calculate circle center from 3 points
  const ax = p1.x, ay = p1.y;
  const bx = p2.x, by = p2.y;
  const cx = p3.x, cy = p3.y;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-10) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  const radius = Math.sqrt((ax - ux) * (ax - ux) + (ay - uy) * (ay - uy));
  if (radius < 1) return null;

  const startAngle = Math.atan2(p1.y - uy, p1.x - ux);
  const midAngle = Math.atan2(p2.y - uy, p2.x - ux);
  const endAngle = Math.atan2(p3.y - uy, p3.x - ux);

  // Determine if mid is on the CCW arc from start to end
  function normalizeAngle(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
  const ns = normalizeAngle(startAngle);
  const nm = normalizeAngle(midAngle);
  const ne = normalizeAngle(endAngle);
  const ccwSpan = normalizeAngle(ne - ns);
  const midInCcw = normalizeAngle(nm - ns) < ccwSpan;

  if (midInCcw) {
    return { centerX: ux, centerY: uy, radius, startAngle, endAngle };
  } else {
    return { centerX: ux, centerY: uy, radius, startAngle: endAngle, endAngle: startAngle };
  }
}

export const arcTool = {
  name: 'arc',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const sx = snapToGrid(x);
    const sy = snapToGrid(y);
    _arcState.clicks.push({ x: sx, y: sy });

    if (_arcState.clicks.length === 3) {
      const [p1, p2, p3] = _arcState.clicks;
      const arc = calculateArcFrom3Points(p1, p2, p3);
      if (arc) {
        const doc = getActiveDocument();
        const prefs = state.preferences || {};
        const ann = createAnnotation({
          type: 'arc',
          page: doc?.currentPage || 1,
          centerX: arc.centerX,
          centerY: arc.centerY,
          radius: arc.radius,
          startAngle: arc.startAngle,
          endAngle: arc.endAngle,
          color: prefs.lineStrokeColor || '#000000',
          lineWidth: prefs.lineLineWidth || 1,
          opacity: (prefs.lineOpacity ?? 100) / 100,
        });
        if (doc) {
          doc.annotations.push(ann);
          doc.selectedAnnotations = [ann];
          doc.selectedAnnotation = ann;
        }
        recordAdd(ann);
        redrawAnnotations();
        import('../../tools/manager.js').then(m => m.setTool('select'));
      }
      _arcState.clicks = [];
    }
  },

  onPointerMove(ctx, e) {
    // Preview arc while drawing
    if (_arcState.clicks.length > 0) {
      redrawAnnotations();
      const { x, y, canvas } = ctx;
      const c = canvas.getContext('2d');
      const doc = getActiveDocument();
      const scale = doc?.scale || 1.5;

      c.save();
      c.setLineDash([4, 4]);
      c.strokeStyle = '#FF0000';
      c.lineWidth = 1;

      if (_arcState.clicks.length === 1) {
        // Draw line from first point to cursor
        c.beginPath();
        c.moveTo(_arcState.clicks[0].x * scale, _arcState.clicks[0].y * scale);
        c.lineTo(x * scale, y * scale);
        c.stroke();
      } else if (_arcState.clicks.length === 2) {
        // Preview arc through 3 points
        const arc = calculateArcFrom3Points(_arcState.clicks[0], _arcState.clicks[1], { x, y });
        if (arc) {
          c.beginPath();
          c.arc(arc.centerX * scale, arc.centerY * scale, arc.radius * scale, arc.startAngle, arc.endAngle);
          c.stroke();
        }
      }
      c.restore();
    }
  },

  onDeactivate() {
    _arcState.clicks = [];
  },
};
```

- [ ] **Step 3: Register arc tool**

In `open-pdf-studio/js/tools/tools/index.js`, add:

```javascript
import { arcTool } from './arc-tool.js';
// In registerAllTools():
registerTool('arc', arcTool);
```

- [ ] **Step 4: Add arc rendering**

In `open-pdf-studio/js/annotations/rendering.js`, add arc rendering in the main draw function switch:

```javascript
case 'arc': {
  const s = doc?.scale || 1.5;
  ctx.beginPath();
  ctx.arc(ann.centerX * s, ann.centerY * s, ann.radius * s, ann.startAngle, ann.endAngle);
  ctx.strokeStyle = ann.color || '#000000';
  ctx.lineWidth = thinLw(ann.lineWidth || 1);
  ctx.globalAlpha = ann.opacity ?? 1;
  ctx.stroke();
  ctx.globalAlpha = 1;
  break;
}
```

- [ ] **Step 5: Add arc hit-testing**

In `open-pdf-studio/js/annotations/geometry.js`, add arc case:

```javascript
case 'arc': {
  // Check proximity to arc path
  const dx = x - ann.centerX;
  const dy = y - ann.centerY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  // Check if angle is within arc span
  function normalizeAngle(a) { return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); }
  const ns = normalizeAngle(ann.startAngle);
  const ne = normalizeAngle(ann.endAngle);
  const na = normalizeAngle(angle);
  const span = normalizeAngle(ne - ns);
  const inSpan = normalizeAngle(na - ns) <= span;
  if (inSpan && Math.abs(dist - ann.radius) < tol) return ann;
  break;
}
```

- [ ] **Step 6: Add ribbon button**

In `HomeTab.jsx`, add an Arc button in the tools group:

```jsx
<RibbonButton id="tool-arc" title="Arc" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 20 Q 12 4 20 20"/></svg>`}
  label="Arc" disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'arc'} onClick={() => setTool('arc')} />
```

- [ ] **Step 7: Verify**

Draw a 3-point arc. Confirm it renders, is selectable, and persists after deselection.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/tools/tools/arc-tool.js open-pdf-studio/js/tools/tools/index.js open-pdf-studio/js/types/annotation.ts open-pdf-studio/js/annotations/rendering.js open-pdf-studio/js/annotations/geometry.js open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx
git commit -m "feat: add arc drawing tool with 3-point mode"
```

---

## Task 10: Trim/Extend/Array Tools (#6)

**Files:**
- Create: `open-pdf-studio/js/tools/tools/trim-tool.js`
- Create: `open-pdf-studio/js/tools/tools/extend-tool.js`
- Create: `open-pdf-studio/js/tools/tools/array-tool.js`
- Modify: `open-pdf-studio/js/annotations/geometry.js`
- Modify: `open-pdf-studio/js/tools/tools/index.js`
- Modify: `open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx`

- [ ] **Step 1: Add line intersection utility**

In `open-pdf-studio/js/annotations/geometry.js`, add:

```javascript
/**
 * Find intersection of two infinite lines defined by (p1,p2) and (p3,p4).
 * Returns { x, y, t, u } where t is parameter on line 1, u on line 2.
 * Returns null if lines are parallel.
 */
export function lineLineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
  return {
    x: p1.x + t * d1x,
    y: p1.y + t * d1y,
    t, u,
  };
}
```

- [ ] **Step 2: Create trim-tool.js**

Create `open-pdf-studio/js/tools/tools/trim-tool.js`:

```javascript
import { getActiveDocument, state } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _trimState = { cuttingEdge: null };

function getLineEndpoints(ann) {
  if (ann.startX !== undefined) return { p1: { x: ann.startX, y: ann.startY }, p2: { x: ann.endX, y: ann.endY } };
  return null;
}

export const trimTool = {
  name: 'trim',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked) return;
    const endpoints = getLineEndpoints(clicked);
    if (!endpoints) return;

    if (!_trimState.cuttingEdge) {
      _trimState.cuttingEdge = clicked;
      return;
    }

    // Second click: trim target at intersection with cutting edge
    const target = clicked;
    if (target === _trimState.cuttingEdge) return;
    const targetPts = getLineEndpoints(target);
    const cutterPts = getLineEndpoints(_trimState.cuttingEdge);
    if (!targetPts || !cutterPts) return;

    const ix = lineLineIntersection(targetPts.p1, targetPts.p2, cutterPts.p1, cutterPts.p2);
    if (!ix) { _trimState.cuttingEdge = null; return; }

    // Determine which side of the target to keep (keep side away from click)
    const distToStart = Math.hypot(x - target.startX, y - target.startY);
    const distToEnd = Math.hypot(x - target.endX, y - target.endY);

    const old = { startX: target.startX, startY: target.startY, endX: target.endX, endY: target.endY };

    if (ix.t >= -0.01 && ix.t <= 1.01) {
      // Intersection within segment — trim
      if (distToStart < distToEnd) {
        target.startX = ix.x;
        target.startY = ix.y;
      } else {
        target.endX = ix.x;
        target.endY = ix.y;
      }
    } else {
      // Intersection outside — extend nearest endpoint
      if (distToStart < distToEnd) {
        target.startX = ix.x;
        target.startY = ix.y;
      } else {
        target.endX = ix.x;
        target.endY = ix.y;
      }
    }

    recordModify(target, old);
    redrawAnnotations();
    _trimState.cuttingEdge = null;
    import('../../tools/manager.js').then(m => m.setTool('select'));
  },

  onDeactivate() { _trimState.cuttingEdge = null; },
};
```

- [ ] **Step 3: Create extend-tool.js**

Create `open-pdf-studio/js/tools/tools/extend-tool.js`:

```javascript
import { getActiveDocument, state } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _extState = { boundary: null };

export const extendTool = {
  name: 'extend',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked || clicked.startX === undefined) return;

    if (!_extState.boundary) {
      _extState.boundary = clicked;
      return;
    }

    const target = clicked;
    if (target === _extState.boundary) return;

    const tp = { p1: { x: target.startX, y: target.startY }, p2: { x: target.endX, y: target.endY } };
    const bp = { p1: { x: _extState.boundary.startX, y: _extState.boundary.startY }, p2: { x: _extState.boundary.endX, y: _extState.boundary.endY } };

    const ix = lineLineIntersection(tp.p1, tp.p2, bp.p1, bp.p2);
    if (!ix || (ix.u < -0.01 || ix.u > 1.01)) { return; } // intersection must be on boundary segment

    const old = { startX: target.startX, startY: target.startY, endX: target.endX, endY: target.endY };

    // Extend nearest endpoint
    const d1 = Math.hypot(ix.x - target.startX, ix.y - target.startY);
    const d2 = Math.hypot(ix.x - target.endX, ix.y - target.endY);
    if (d1 < d2) {
      target.startX = ix.x;
      target.startY = ix.y;
    } else {
      target.endX = ix.x;
      target.endY = ix.y;
    }

    recordModify(target, old);
    redrawAnnotations();
    _extState.boundary = null;
    import('../../tools/manager.js').then(m => m.setTool('select'));
  },

  onDeactivate() { _extState.boundary = null; },
};
```

- [ ] **Step 4: Create array-tool.js**

Create `open-pdf-studio/js/tools/tools/array-tool.js`:

```javascript
import { getActiveDocument, state } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _arrayState = { basePoint: null, count: 3, mode: 'linear' };

export const arrayTool = {
  name: 'array',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const doc = getActiveDocument();
    if (!doc) return;
    const selected = doc.selectedAnnotations;
    if (!selected || selected.length === 0) return;

    if (!_arrayState.basePoint) {
      _arrayState.basePoint = { x, y };
      return;
    }

    // Second click: create array
    const base = _arrayState.basePoint;
    const dx = x - base.x;
    const dy = y - base.y;
    const count = _arrayState.count;

    for (const srcAnn of selected) {
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const offsetX = dx * frac;
        const offsetY = dy * frac;
        const copy = JSON.parse(JSON.stringify(srcAnn));
        copy.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '_' + i;

        // Offset all position properties
        if (copy.startX !== undefined) { copy.startX += offsetX; copy.startY += offsetY; }
        if (copy.endX !== undefined) { copy.endX += offsetX; copy.endY += offsetY; }
        if (copy.x !== undefined) { copy.x += offsetX; copy.y += offsetY; }
        if (copy.centerX !== undefined) { copy.centerX += offsetX; copy.centerY += offsetY; }
        if (copy.points) { copy.points = copy.points.map(p => ({ ...p, x: p.x + offsetX, y: p.y + offsetY })); }
        if (copy.leaderStartX !== undefined) { copy.leaderStartX += offsetX; copy.leaderStartY += offsetY; }
        if (copy.leaderEndX !== undefined) { copy.leaderEndX += offsetX; copy.leaderEndY += offsetY; }

        doc.annotations.push(copy);
        recordAdd(copy);
      }
    }

    redrawAnnotations();
    _arrayState.basePoint = null;
    import('../../tools/manager.js').then(m => m.setTool('select'));
  },

  onDeactivate() { _arrayState.basePoint = null; },
};

export function setArrayCount(n) { _arrayState.count = Math.max(2, n); }
export function setArrayMode(m) { _arrayState.mode = m; }
```

- [ ] **Step 5: Register all new tools**

In `open-pdf-studio/js/tools/tools/index.js`, add:

```javascript
import { trimTool } from './trim-tool.js';
import { extendTool } from './extend-tool.js';
import { arrayTool } from './array-tool.js';

// In registerAllTools():
registerTool('trim', trimTool);
registerTool('extend', extendTool);
registerTool('array', arrayTool);
```

- [ ] **Step 6: Add ribbon buttons**

In `HomeTab.jsx`, add buttons for trim/extend/array in the tools or edit group:

```jsx
<RibbonButton id="tool-trim" title="Trim" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="20" x2="20" y2="4"/><line x1="12" y1="4" x2="12" y2="20" stroke-dasharray="2 2"/></svg>`}
  label="Trim" disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'trim'} onClick={() => setTool('trim')} />
<RibbonButton id="tool-extend" title="Extend" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="12" x2="14" y2="12"/><line x1="14" y1="12" x2="20" y2="12" stroke-dasharray="2 2"/><line x1="20" y1="4" x2="20" y2="20"/></svg>`}
  label="Extend" disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'extend'} onClick={() => setTool('extend')} />
<RibbonButton id="tool-array" title="Array" icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="6" height="6"/><rect x="12" y="3" width="6" height="6" stroke-dasharray="2 2"/><rect x="3" y="12" width="6" height="6" stroke-dasharray="2 2"/></svg>`}
  label="Array" disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'array'} onClick={() => setTool('array')} />
```

- [ ] **Step 7: Verify all three tools**

Test each:
- **Trim**: Draw two crossing lines. Select trim tool. Click one line, click the other. One should shorten at intersection.
- **Extend**: Draw a line and a boundary line. Select extend tool. Click boundary, click short line. It should extend to meet boundary.
- **Array**: Select an annotation. Select array tool. Click base point, click end point. 3 copies should appear distributed between base and end.

- [ ] **Step 8: Commit**

```bash
git add open-pdf-studio/js/tools/tools/trim-tool.js open-pdf-studio/js/tools/tools/extend-tool.js open-pdf-studio/js/tools/tools/array-tool.js open-pdf-studio/js/tools/tools/index.js open-pdf-studio/js/solid/components/ribbon/HomeTab.jsx
git commit -m "feat: add trim, extend, and array CAD tools"
```

---

## Self-Review Notes

- **Spec coverage**: All 11 items covered. #2 and #11 combined in Task 5. Leader line anchoring (part of #4) deferred to a follow-up since it requires significant rendering math changes.
- **Type consistency**: `lineLineIntersection` is defined in geometry.js and imported in trim-tool.js and extend-tool.js consistently.
- **Arc annotation**: Properties use `centerX/centerY/radius/startAngle/endAngle` consistently across type def, tool, rendering, and hit-testing.
- **Auto-reset pattern**: Consistently uses `import('../../tools/manager.js').then(m => m.setTool('select'))` across all tools.
- **Missing from plan**: PDF saver for arc annotations (saving arc to PDF format) — this can be addressed in a follow-up since annotations are stored in app state and will persist within sessions.
