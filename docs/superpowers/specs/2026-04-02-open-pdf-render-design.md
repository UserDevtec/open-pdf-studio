# open-pdf-render — Rust PDF Rendering Crate

## Doel

Pure Rust crate die PDF pagina's rendert naar RGBA bitmaps. Gebruikt door Open PDF Studio (Tauri 2) via IPC commands. Vervangt PDF.js rendering voor de canvas output. PDF.js blijft voor tekst selectie, zoeken en form fields. Bij onondersteunde PDF features valt de frontend automatisch terug op PDF.js per pagina.

## Architectuur

```
PDF bytes (Uint8Array via Tauri FS)
    ↓
[lopdf] Parse PDF structuur, page tree, content streams, resources
    ↓
[ContentStreamInterpreter] Loop door PDF operators, bouw graphics state stack op
    ↓
[tiny-skia] Render vector paden, images, tekst naar RGBA pixel buffer
    ↓
RenderedPage { width, height, rgba: Vec<u8> }
    ↓
[Tauri IPC] → Vec<u8> auto-convert naar Uint8Array → Canvas putImageData
```

**Drie lagen:**

1. **Parser** — `lopdf` crate (bestaand, bewezen). Parsed PDF objecten, cross-reference tables, content streams, resource dictionaries.
2. **Interpreter** — Eigen code. Loopt door PDF content stream operators. Houdt een graphics state stack bij (CTM, kleuren, line attributes, clipping paths). Vertaalt PDF operators naar tiny-skia draw calls.
3. **Renderer** — `tiny-skia` crate (pure Rust 2D rasterizer). Tekent paden, vullingen, images naar een RGBA pixel buffer. Geen externe dependencies.

## Publieke API

```rust
pub struct PdfRenderer;

impl PdfRenderer {
    pub fn new() -> Self;
    pub fn load_document(&mut self, bytes: &[u8]) -> Result<DocumentHandle, RenderError>;
}

pub struct DocumentHandle { /* lopdf::Document + parsed resources */ }

impl DocumentHandle {
    pub fn page_count(&self) -> usize;
    pub fn page_dimensions(&self, page: usize) -> Result<(f32, f32), RenderError>;
    pub fn render_page(&self, page: usize, scale: f32) -> Result<RenderedPage, RenderError>;
}

pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,  // width * height * 4 bytes (RGBA)
}

pub enum RenderError {
    ParseError(String),
    UnsupportedFeature(String),  // Signals frontend to use PDF.js fallback
    RenderError(String),
}
```

## Dependencies

| Crate | Versie | Rol |
|-------|--------|-----|
| `lopdf` | latest | PDF parsing |
| `tiny-skia` | latest | 2D rasterization (paths, fills, strokes, clipping, images) |
| `image` | latest | JPEG/PNG decompression voor embedded images |

Geen externe DLL's. Geen C bindings. Pure Rust. Compileert statisch in de Tauri binary.

## PDF Operators — Implementatie Scope

### Fase 1: Vector paden (week 1)

**Path construction:**
- `m` (moveto), `l` (lineto), `c` (curveto/bezier), `v`, `y` (shorthand curves)
- `re` (rectangle), `h` (closepath)

**Path painting:**
- `S` (stroke), `s` (close+stroke), `f`/`F` (fill non-zero), `f*` (fill even-odd)
- `B` (fill+stroke), `B*`, `b`, `b*` (close+fill+stroke)
- `n` (end path no-op)

**Graphics state:**
- `q`/`Q` (save/restore state stack)
- `cm` (concat transformation matrix)
- `w` (line width), `J` (line cap), `j` (line join), `M` (miter limit)
- `d` (dash pattern)

**Color:**
- `g`/`G` (gray), `rg`/`RG` (RGB), `k`/`K` (CMYK → convert to RGB)
- `cs`/`CS` (set colorspace), `sc`/`SC`/`scn`/`SCN` (set color)

**Clipping:**
- `W`/`W*` (clipping path)

### Fase 2: Images + XObjects (week 2)

- `Do` operator (invoke XObject)
- Form XObjects (herbruikbare content streams — veel gebruikt in technische PDF's)
- Image XObjects: decode DCTDecode (JPEG), FlateDecode (zlib), ASCIIHexDecode, ASCII85Decode
- Image color spaces: DeviceRGB, DeviceGray, DeviceCMYK (convert to RGB)
- Image masks (stencil masks, soft masks)

### Fase 3: Tekst/fonts (week 3-4)

**Text operators:**
- `BT`/`ET` (begin/end text), `Tf` (set font), `Td`/`TD` (move text position)
- `Tm` (set text matrix), `Tj` (show string), `TJ` (show array)
- `T*` (next line), `'`/`"` (show string variants)

**Font support:**
- TrueType embedded fonts (parse glyf table, render outlines via tiny-skia)
- Type1 embedded fonts (parse CharStrings)
- Font encoding (WinAnsiEncoding, MacRomanEncoding, custom Differences arrays)
- ToUnicode CMap parsing (voor tekst extractie mapping)
- Fallback: onbekende fonts → system font of placeholder

### Fase 4: Advanced (ongoing, PDF.js fallback)

- Transparency groups (`/Group` with `/S /Transparency`)
- Soft masks (`/SMask`)
- Shading patterns (linear/radial gradients)
- Tiling patterns
- ICC color profiles
- Type3 fonts (font defined as drawing instructions)
- Blend modes (multiply, screen, overlay, etc.)
- Optional Content Groups (layers)

Features in fase 4 die niet geïmplementeerd zijn retourneren `RenderError::UnsupportedFeature`, waarna de frontend PDF.js gebruikt.

## Tauri Integratie

In `open-pdf-studio/src-tauri/Cargo.toml`:
```toml
open-pdf-render = { path = "../open-pdf-render" }
# OF na publicatie:
# open-pdf-render = "0.1"
```

In `open-pdf-studio/src-tauri/src/lib.rs`:
```rust
use open_pdf_render::{PdfRenderer, RenderError};

#[tauri::command]
fn render_pdf_page(path: String, page_index: u32, scale: f32) -> Result<Vec<u8>, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{:?}", e))?;
    let page = doc.render_page(page_index as usize, scale).map_err(|e| format!("{:?}", e))?;
    Ok(page.rgba)
}

#[tauri::command]
fn get_page_dimensions(path: String) -> Result<Vec<(f32, f32)>, String> {
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{:?}", e))?;
    let mut dims = Vec::new();
    for i in 0..doc.page_count() {
        dims.push(doc.page_dimensions(i).map_err(|e| format!("{:?}", e))?);
    }
    Ok(dims)
}
```

## Frontend Integratie

In `open-pdf-studio/js/pdf/renderer.js`, vervang de `page.render()` call:

```javascript
// In renderPage():
try {
  const rgbaBytes = await invoke('render_pdf_page', {
    path: doc.filePath,
    pageIndex: pageNum - 1,
    scale: scale
  });
  // Success — blit to canvas
  const dpr = getCanvasDPR();
  // Width/height afleiden uit bytes + scale + page dimensions
  pdfCanvas.width = bufferW;
  pdfCanvas.height = bufferH;
  pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
  pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
  const imageData = new ImageData(new Uint8ClampedArray(rgbaBytes), bufferW, bufferH);
  pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
} catch (e) {
  // UnsupportedFeature of andere error → PDF.js fallback
  await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
}
```

Dezelfde pattern in `renderPageOffscreen()` en `renderContinuousPage()`.

## Wat NIET verandert

- PDF.js blijft geladen (tekst selectie, zoeken, form fields, annotatie parsing)
- Annotatie rendering (overlay canvas) — ongewijzigd
- Zoom/pan logica (CSS-scale + debounce) — ongewijzigd
- Continuous mode (IntersectionObserver lazy loading) — ongewijzigd
- pdf-lib voor PDF saving — ongewijzigd

## Crate Structuur

```
open-pdf-render/
├── Cargo.toml
├── src/
│   ├── lib.rs              # Publieke API (PdfRenderer, DocumentHandle, RenderedPage)
│   ├── parser.rs           # lopdf wrapper, page tree navigatie, resource extraction
│   ├── interpreter.rs      # Content stream interpreter, graphics state machine
│   ├── graphics_state.rs   # GraphicsState struct, state stack, CTM
│   ├── renderer.rs         # tiny-skia rendering, path building, image compositing
│   ├── color.rs            # Color space conversie (CMYK→RGB, grayscale, etc.)
│   ├── fonts.rs            # Font parsing, glyph extraction, text rendering
│   └── image_decode.rs     # JPEG/PNG/Flate decompression
├── tests/
│   ├── test_vectors.rs     # Test met bekende vector PDF's
│   ├── test_images.rs      # Test met image-heavy PDF's
│   └── fixtures/           # Test PDF bestanden
└── README.md
```

## Performance Targets

| Metric | Target | Hoe |
|--------|--------|-----|
| Vector PDF (bouwtekening) render | < 100ms | tiny-skia is snel voor paden |
| Image-heavy PDF render | < 300ms | JPEG decompressie is de bottleneck |
| Memory per pagina | < 50MB | RGBA buffer = w×h×4 bytes |
| Eerste pagina zichtbaar | < 500ms | Parse + render eerste pagina, rest lazy |

## Succes Criteria

1. Bouwtekeningen uit `C:\3BM\50_projecten\` renderen correct en snel (< 100ms)
2. PDF.js fallback werkt transparant — gebruiker merkt geen verschil behalve snelheid
3. Geen externe DLL's — pure Rust, compileert statisch
4. Crate is publiceerbaar op crates.io
5. Open source onder MIT licentie (zelfde als Open PDF Studio)
