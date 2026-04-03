# Hybrid Tile + Vector Rendering Engine

## Doel

Instant pan en zoom (100fps) in Open PDF Studio door twee render modes:
1. **Vector mode** voor technische tekeningen — Rust extraheert draw commands, frontend tekent direct op Canvas2D. Zoom/pan = transform update (0ms re-render).
2. **Tile mode** voor foto-PDF's/scans — Rust rendert 512×512 bitmap tiles, frontend cached in LRU. Pan = CSS verschuiving (instant).

## Architectuur

```
PDF openen
    ↓
[Rust] Parse content stream, analyseer pagina type
    ↓
┌─────────────────────────┐  ┌──────────────────────────┐
│ PageType::Vector         │  │ PageType::Tile            │
│                         │  │                          │
│ Extract draw commands   │  │ render_page_region()     │
│ → Vec<DrawCommand>      │  │ → RGBA bitmap per tile   │
│ → JSON naar frontend    │  │ → temp file → frontend   │
│                         │  │                          │
│ Frontend Canvas2D:      │  │ Frontend tile cache:     │
│ - Pan: translate(dx,dy) │  │ - Pan: CSS verschuiving  │
│ - Zoom: scale(s)        │  │ - Zoom: CSS scale +      │
│ - Redraw: <5ms          │  │   async nieuwe tiles     │
│ - Altijd scherp         │  │ - LRU max 100 tiles      │
└─────────────────────────┘  └──────────────────────────┘
```

## Automatische Mode Detectie

```rust
fn analyze_page(operations: &[Operation]) -> PageType {
    let mut has_images = false;
    let mut has_shading = false;

    for op in operations {
        match op.operator.as_str() {
            "Do" => has_images = true,
            "sh" => has_shading = true,
            _ => {}
        }
    }

    if has_images || has_shading {
        PageType::Tile
    } else {
        PageType::Vector
    }
}
```

Bouwtekeningen zijn bijna altijd puur vector (lijnen, arcs, rechthoeken, tekst). Foto-PDF's en scans bevatten `Do` (image XObject) operators.

## Vector Mode — Draw Commands

### Rust-side: Extract commands

Nieuw Tauri command: `extract_draw_commands(path, page_index) → Vec<u8>`

De interpreter loopt door de PDF content stream en produceert een compacte binaire array van draw commands in plaats van RGBA pixels.

### Command formaat

Elk command is een type byte gevolgd door f32 parameters:

| Type | Bytes | Betekenis |
|------|-------|-----------|
| 0 | 1 + 8 | MoveTo(x, y) |
| 1 | 1 + 8 | LineTo(x, y) |
| 2 | 1 + 24 | CubicTo(x1, y1, x2, y2, x3, y3) |
| 3 | 1 + 16 | Rect(x, y, w, h) |
| 4 | 1 | ClosePath |
| 5 | 1 + 8 | SetStroke(rgba u32, width f32) |
| 6 | 1 + 4 | SetFill(rgba u32) |
| 7 | 1 | Stroke |
| 8 | 1 | Fill |
| 9 | 1 | FillEvenOdd |
| 10 | 1 | SaveState |
| 11 | 1 | RestoreState |
| 12 | 1 + 24 | Transform(a, b, c, d, e, f) |
| 13 | 1 + 8 | SetLineCap(cap u8) + SetLineJoin(join u8) + SetMiterLimit(f32) |
| 14 | 1 + N | SetDash(count u8, values f32[], phase f32) |

Typische bouwtekening: 10.000-50.000 commands × ~10 bytes = 100-500KB. Eenmalig laden.

### Frontend: Vector Renderer

```javascript
function renderVectorPage(ctx, commands, transform) {
  ctx.save();
  ctx.setTransform(transform.a, transform.b, transform.c, transform.d, transform.e, transform.f);

  for (const cmd of commands) {
    // Dispatch op type byte — zie tabel hierboven
  }
  ctx.restore();
}
```

**Zoom:** Update transform matrix → `renderVectorPage()` (< 5ms voor 50K commands).
**Pan:** Update translate in transform → `renderVectorPage()` (< 5ms).
**requestAnimationFrame** loop voor smooth 60fps tijdens drag/scroll.

### Caching

Draw commands worden eenmalig geladen per pagina en gecached in JavaScript:
```javascript
const _vectorCache = new Map(); // pageNum → Float32Array of commands
```

Bij pagina wissel: hergebruik cache. Bij document wissel: clear cache.

## Tile Mode — Bitmap Tiles

### Rust-side: Region rendering

Nieuw Tauri command: `render_page_region(path, page_index, x, y, w, h, scale) → temp file path`

Rendert alleen een 512×512 rechthoek van de pagina. De bestaande `open-pdf-render` crate krijgt een `render_page_region` methode die een clipping rect toepast op de tiny-skia pixmap.

### Frontend: Tile Manager

```javascript
class TileManager {
  constructor(tileSize = 512) {
    this.tileSize = tileSize;
    this.cache = new Map(); // "page_zoom_col_row" → canvas element
    this.maxCached = 100;
  }

  getVisibleTiles(viewport, pageW, pageH, scale) {
    // Bereken welke tiles overlappen met de scroll viewport
    // Return array van { col, row, x, y }
  }

  async renderTile(page, col, row, scale) {
    const key = `${page}_${scale}_${col}_${row}`;
    if (this.cache.has(key)) return this.cache.get(key);

    // Vraag Rust om deze tile te renderen
    const result = await invoke('render_page_region', { ... });
    // Cache het resultaat als een klein canvas element
  }

  drawVisibleTiles(ctx, viewport, scale) {
    const tiles = this.getVisibleTiles(viewport, ...);
    for (const tile of tiles) {
      const cached = this.cache.get(tile.key);
      if (cached) {
        ctx.drawImage(cached, tile.x, tile.y); // Instant
      } else {
        this.renderTile(...); // Async, vult later in
      }
    }
  }
}
```

**Pan:** `drawVisibleTiles()` — gecachede tiles tekenen (0ms), nieuwe tiles async laden.
**Zoom:** CSS-scale alle tiles (instant) → na debounce: invalideer cache, render nieuwe tiles.

### LRU Cache

Max 100 tiles × 512×512×4 bytes = 100MB geheugen. Oudste tiles worden verwijderd bij cache-vol.

## Integration in renderer.js

De huidige `renderPage()` functie krijgt een mode-switch:

```javascript
export async function renderPage(pageNum) {
  const doc = getActiveDocument();

  if (isTauri() && doc.filePath) {
    // Vraag Rust welk type pagina het is
    const pageType = await invoke('analyze_page_type', { path: doc.filePath, pageIndex: pageNum - 1 });

    if (pageType === 'vector') {
      // Eenmalig: laad draw commands
      if (!vectorCache.has(pageNum)) {
        const cmds = await invoke('extract_draw_commands', { path: doc.filePath, pageIndex: pageNum - 1 });
        vectorCache.set(pageNum, cmds);
      }
      // Teken met huidige transform
      renderVectorPage(ctx, vectorCache.get(pageNum), currentTransform);
      state.renderEngine = 'Rust Vector';
    } else {
      // Tile mode
      tileManager.drawVisibleTiles(ctx, viewport, scale);
      state.renderEngine = 'Rust Tiles';
    }
  } else {
    // PDF.js fallback
    await _renderPageWithPdfJs(...);
    state.renderEngine = 'PDF.js';
  }
}
```

## Zoom/Pan Event Handling

```javascript
// In navigation-events.js:

// Pan: direct hertekenen, geen debounce
scrollContainer.addEventListener('scroll', () => {
  if (currentMode === 'vector') {
    // Update transform translate, redraw (<5ms)
    requestAnimationFrame(() => renderVectorPage(ctx, commands, transform));
  } else {
    // Tile mode: teken gecachede tiles, async load nieuwe
    requestAnimationFrame(() => tileManager.drawVisibleTiles(ctx, viewport, scale));
  }
});

// Zoom: CSS scale instant, render na debounce
onWheel(e) {
  // CSS scale (instant)
  canvas.style.transform = `scale(${cssScale})`;

  // Na 300ms idle: re-render
  debounce(() => {
    if (currentMode === 'vector') {
      // Gewoon redraw met nieuwe scale (<5ms)
      renderVectorPage(ctx, commands, newTransform);
    } else {
      // Invalideer tile cache, render nieuwe tiles
      tileManager.invalidate();
      tileManager.drawVisibleTiles(ctx, viewport, newScale);
    }
  }, 300);
}
```

## Nieuwe Rust Commands

| Command | Input | Output | Doel |
|---------|-------|--------|------|
| `analyze_page_type` | path, page_index | "vector" of "tile" | Detecteer pagina type |
| `extract_draw_commands` | path, page_index | Vec<u8> (binaire commands) | Vector data extractie |
| `render_page_region` | path, page_index, x, y, w, h, scale | temp file path | Tile rendering |

## Nieuwe Crate Methoden (open-pdf-render)

```rust
impl DocumentHandle {
    // Bestaand
    pub fn render_page(&self, page: usize, scale: f32) -> Result<RenderedPage, RenderError>;

    // Nieuw: render alleen een regio
    pub fn render_page_region(&self, page: usize, x: f32, y: f32, w: f32, h: f32, scale: f32) -> Result<RenderedPage, RenderError>;

    // Nieuw: extraheer draw commands zonder te renderen
    pub fn extract_draw_commands(&self, page: usize) -> Result<Vec<u8>, RenderError>;

    // Nieuw: analyseer pagina type
    pub fn analyze_page_type(&self, page: usize) -> Result<PageType, RenderError>;
}

pub enum PageType {
    Vector,
    Tile,
}
```

## Bestanden

| Bestand | Wijziging |
|---------|-----------|
| `open-pdf-render/src/lib.rs` | `PageType` enum, nieuwe methoden op `DocumentHandle` |
| `open-pdf-render/src/interpreter.rs` | `extract_commands()` modus (commands ipv render) |
| `open-pdf-render/src/parser.rs` | `render_page_region()`, `analyze_page_type()`, `extract_draw_commands()` |
| `open-pdf-studio/src-tauri/src/lib.rs` | 3 nieuwe Tauri commands |
| `open-pdf-studio/js/pdf/renderer.js` | Mode switch, vector renderer, tile manager integratie |
| `open-pdf-studio/js/pdf/vector-renderer.js` | **NIEUW** — Canvas2D vector rendering loop |
| `open-pdf-studio/js/pdf/tile-manager.js` | **NIEUW** — Tile cache, visibility, async loading |

## Performance Targets

| Actie | Vector Mode | Tile Mode |
|-------|-------------|-----------|
| Eerste render | < 200ms (load commands) | < 500ms (render visible tiles) |
| Pan | < 5ms (redraw) | 0ms (CSS) + async nieuwe tiles |
| Zoom | < 5ms (redraw met nieuwe scale) | 0ms (CSS) + async re-render |
| Geheugen per pagina | ~500KB (commands) | ~50MB max (100 tiles) |

## Succes Criteria

1. Pan op een bouwtekening: 60fps zonder stutter
2. Zoom op een bouwtekening: instant, geen wachttijd
3. Foto-PDF's: smooth scroll met lazy tile loading
4. Automatische detectie werkt correct (geen handmatige switch)
5. PDF.js fallback bij onbekende content
