# open-pdf-render Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pure Rust crate die PDF pagina's rendert naar RGBA bitmaps, geïntegreerd in Open PDF Studio via Tauri IPC.

**Architecture:** lopdf parsed PDF structuur en content streams → eigen interpreter vertaalt PDF operators naar tiny-skia draw calls → tiny-skia rendert naar RGBA pixel buffer → Tauri stuurt Vec<u8> als Uint8Array naar frontend Canvas.

**Tech Stack:** Rust, lopdf (PDF parsing), tiny-skia (2D rasterization), image (JPEG/PNG decode), Tauri 2 IPC

---

## File Structure

```
open-pdf-render/                    # Nieuwe crate (naast open-pdf-studio/)
├── Cargo.toml                      # Dependencies: lopdf, tiny-skia, image
├── src/
│   ├── lib.rs                      # Publieke API: PdfRenderer, DocumentHandle, RenderedPage, RenderError
│   ├── parser.rs                   # lopdf wrapper: load document, get pages, extract content streams, resources
│   ├── graphics_state.rs           # GraphicsState struct, state stack push/pop, CTM, colors, line attrs
│   ├── interpreter.rs              # Content stream interpreter: loop operators, dispatch to renderer
│   ├── renderer.rs                 # tiny-skia wrapper: path building, fill, stroke, image composite
│   ├── color.rs                    # Color space parsing and conversion (CMYK→RGB, Gray→RGB)
│   └── image_decode.rs             # Decode embedded images (JPEG via image crate, FlateDecode)
└── tests/
    └── render_test.rs              # Integration tests met test-PDF's

open-pdf-studio/src-tauri/
├── Cargo.toml                      # WIJZIG: voeg open-pdf-render dependency toe
└── src/lib.rs                      # WIJZIG: voeg render_pdf_page command toe

open-pdf-studio/js/pdf/
└── renderer.js                     # WIJZIG: invoke('render_pdf_page') met PDF.js fallback
```

---

### Task 1: Scaffold de crate met publieke API

**Files:**
- Create: `open-pdf-render/Cargo.toml`
- Create: `open-pdf-render/src/lib.rs`

- [ ] **Step 1: Maak Cargo.toml**

```toml
[package]
name = "open-pdf-render"
version = "0.1.0"
edition = "2021"
license = "MIT"
description = "Pure Rust PDF page renderer — renders PDF pages to RGBA bitmaps"

[dependencies]
lopdf = "0.34"
tiny-skia = "0.11"
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
```

- [ ] **Step 2: Maak src/lib.rs met publieke types**

```rust
mod parser;
mod graphics_state;
mod interpreter;
mod renderer;
mod color;
mod image_decode;

pub use parser::DocumentHandle;

#[derive(Debug)]
pub enum RenderError {
    ParseError(String),
    UnsupportedFeature(String),
    RenderError(String),
}

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RenderError::ParseError(s) => write!(f, "Parse error: {}", s),
            RenderError::UnsupportedFeature(s) => write!(f, "Unsupported: {}", s),
            RenderError::RenderError(s) => write!(f, "Render error: {}", s),
        }
    }
}

pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

pub struct PdfRenderer;

impl PdfRenderer {
    pub fn new() -> Self {
        PdfRenderer
    }

    pub fn load_document(&self, bytes: &[u8]) -> Result<DocumentHandle, RenderError> {
        DocumentHandle::load(bytes)
    }
}
```

- [ ] **Step 3: Maak stub modules zodat het compileert**

Maak elk bestand met minimale inhoud:

`src/parser.rs`:
```rust
use crate::{RenderError, RenderedPage};

pub struct DocumentHandle {
    doc: lopdf::Document,
}

impl DocumentHandle {
    pub fn load(bytes: &[u8]) -> Result<Self, RenderError> {
        let doc = lopdf::Document::load_from(std::io::Cursor::new(bytes))
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        Ok(DocumentHandle { doc })
    }

    pub fn page_count(&self) -> usize {
        self.doc.get_pages().len()
    }

    pub fn page_dimensions(&self, page: usize) -> Result<(f32, f32), RenderError> {
        let pages = self.doc.get_pages();
        let page_ids: Vec<_> = pages.keys().collect();
        let page_num = page_ids.get(page)
            .ok_or_else(|| RenderError::ParseError(format!("Page {} not found", page)))?;
        let page_id = pages[page_num];

        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        let media_box = dict.get(b"MediaBox")
            .map_err(|_| RenderError::ParseError("No MediaBox".into()))?
            .as_array()
            .map_err(|_| RenderError::ParseError("MediaBox not array".into()))?;

        let width = Self::obj_to_f32(&media_box[2])? - Self::obj_to_f32(&media_box[0])?;
        let height = Self::obj_to_f32(&media_box[3])? - Self::obj_to_f32(&media_box[1])?;
        Ok((width.abs(), height.abs()))
    }

    pub fn render_page(&self, page: usize, scale: f32) -> Result<RenderedPage, RenderError> {
        let (w_pt, h_pt) = self.page_dimensions(page)?;
        let width = (w_pt * scale).ceil() as u32;
        let height = (h_pt * scale).ceil() as u32;

        // For now: white page (rendering comes in later tasks)
        let rgba = vec![255u8; (width * height * 4) as usize];
        Ok(RenderedPage { width, height, rgba })
    }

    fn obj_to_f32(obj: &lopdf::Object) -> Result<f32, RenderError> {
        match obj {
            lopdf::Object::Real(r) => Ok(*r as f32),
            lopdf::Object::Integer(i) => Ok(*i as f32),
            _ => Err(RenderError::ParseError("Expected number".into())),
        }
    }
}
```

`src/graphics_state.rs`:
```rust
pub struct GraphicsState;
```

`src/interpreter.rs`:
```rust
pub struct Interpreter;
```

`src/renderer.rs`:
```rust
pub struct SkiaRenderer;
```

`src/color.rs`:
```rust
pub fn cmyk_to_rgb(_c: f32, _m: f32, _y: f32, _k: f32) -> (u8, u8, u8) {
    (0, 0, 0)
}
```

`src/image_decode.rs`:
```rust
pub fn decode_image() {}
```

- [ ] **Step 4: Verifieer dat de crate compileert**

Run: `cd open-pdf-render && cargo check`
Expected: compileert zonder errors

- [ ] **Step 5: Schrijf basis test**

`tests/render_test.rs`:
```rust
use open_pdf_render::PdfRenderer;

#[test]
fn test_load_minimal_pdf() {
    // Minimal valid PDF (1 blank page)
    let pdf_bytes = include_bytes!("../tests/fixtures/blank.pdf");
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(pdf_bytes).unwrap();
    assert!(doc.page_count() > 0);
}

#[test]
fn test_render_returns_rgba() {
    let pdf_bytes = include_bytes!("../tests/fixtures/blank.pdf");
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(pdf_bytes).unwrap();
    let page = doc.render_page(0, 1.0).unwrap();
    assert!(page.width > 0);
    assert!(page.height > 0);
    assert_eq!(page.rgba.len(), (page.width * page.height * 4) as usize);
}
```

Maak een test fixture: genereer een blank.pdf met een simpel script of neem er een uit het test-bestandenpad.

- [ ] **Step 6: Run tests**

Run: `cd open-pdf-render && cargo test`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add open-pdf-render/
git commit -m "feat: scaffold open-pdf-render crate with public API and parser stub"
```

---

### Task 2: Graphics State machine

**Files:**
- Create: `open-pdf-render/src/graphics_state.rs` (vervang stub)

- [ ] **Step 1: Implementeer GraphicsState struct**

```rust
use tiny_skia::Transform;

#[derive(Clone, Debug)]
pub struct GraphicsState {
    pub ctm: Transform,
    pub fill_color: (u8, u8, u8, u8),    // RGBA
    pub stroke_color: (u8, u8, u8, u8),  // RGBA
    pub line_width: f32,
    pub line_cap: u8,    // 0=Butt, 1=Round, 2=Square
    pub line_join: u8,   // 0=Miter, 1=Round, 2=Bevel
    pub miter_limit: f32,
    pub dash_array: Vec<f32>,
    pub dash_phase: f32,
    pub clip_path: Option<tiny_skia::Path>,
}

impl Default for GraphicsState {
    fn default() -> Self {
        GraphicsState {
            ctm: Transform::identity(),
            fill_color: (0, 0, 0, 255),       // Black
            stroke_color: (0, 0, 0, 255),      // Black
            line_width: 1.0,
            line_cap: 0,
            line_join: 0,
            miter_limit: 10.0,
            dash_array: Vec::new(),
            dash_phase: 0.0,
            clip_path: None,
        }
    }
}

pub struct GraphicsStateStack {
    stack: Vec<GraphicsState>,
    pub current: GraphicsState,
}

impl GraphicsStateStack {
    pub fn new() -> Self {
        GraphicsStateStack {
            stack: Vec::new(),
            current: GraphicsState::default(),
        }
    }

    /// q operator — push state
    pub fn save(&mut self) {
        self.stack.push(self.current.clone());
    }

    /// Q operator — pop state
    pub fn restore(&mut self) {
        if let Some(state) = self.stack.pop() {
            self.current = state;
        }
    }

    /// cm operator — concat transform matrix
    pub fn concat_matrix(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        let new_transform = Transform::from_row(a, b, c, d, e, f);
        self.current.ctm = self.current.ctm.pre_concat(new_transform);
    }
}
```

- [ ] **Step 2: Run cargo check**

Run: `cd open-pdf-render && cargo check`
Expected: compileert

- [ ] **Step 3: Commit**

```bash
git add open-pdf-render/src/graphics_state.rs
git commit -m "feat: implement graphics state machine with state stack"
```

---

### Task 3: Color space conversie

**Files:**
- Create: `open-pdf-render/src/color.rs` (vervang stub)

- [ ] **Step 1: Implementeer kleurconversies**

```rust
/// Convert CMYK (0.0-1.0 each) to RGB (0-255 each)
pub fn cmyk_to_rgb(c: f32, m: f32, y: f32, k: f32) -> (u8, u8, u8) {
    let r = 255.0 * (1.0 - c) * (1.0 - k);
    let g = 255.0 * (1.0 - m) * (1.0 - k);
    let b = 255.0 * (1.0 - y) * (1.0 - k);
    (r.clamp(0.0, 255.0) as u8, g.clamp(0.0, 255.0) as u8, b.clamp(0.0, 255.0) as u8)
}

/// Convert grayscale (0.0-1.0) to RGB (0-255 each)
pub fn gray_to_rgb(g: f32) -> (u8, u8, u8) {
    let v = (g * 255.0).clamp(0.0, 255.0) as u8;
    (v, v, v)
}

/// Convert PDF color floats (0.0-1.0) to RGBA8 tuple
pub fn rgb_to_rgba8(r: f32, g: f32, b: f32) -> (u8, u8, u8, u8) {
    (
        (r * 255.0).clamp(0.0, 255.0) as u8,
        (g * 255.0).clamp(0.0, 255.0) as u8,
        (b * 255.0).clamp(0.0, 255.0) as u8,
        255,
    )
}
```

- [ ] **Step 2: Commit**

```bash
git add open-pdf-render/src/color.rs
git commit -m "feat: add color space conversion (CMYK/Gray/RGB to RGBA)"
```

---

### Task 4: tiny-skia renderer wrapper

**Files:**
- Create: `open-pdf-render/src/renderer.rs` (vervang stub)

- [ ] **Step 1: Implementeer SkiaRenderer**

```rust
use tiny_skia::*;
use crate::graphics_state::GraphicsState;

pub struct SkiaRenderer {
    pub pixmap: Pixmap,
    path_builder: Option<PathBuilder>,
}

impl SkiaRenderer {
    pub fn new(width: u32, height: u32) -> Result<Self, String> {
        let mut pixmap = Pixmap::new(width, height)
            .ok_or_else(|| "Failed to create pixmap".to_string())?;
        // Fill with white background
        pixmap.fill(Color::WHITE);
        Ok(SkiaRenderer {
            pixmap,
            path_builder: None,
        })
    }

    pub fn begin_path(&mut self) {
        self.path_builder = Some(PathBuilder::new());
    }

    pub fn move_to(&mut self, x: f32, y: f32) {
        if let Some(ref mut pb) = self.path_builder {
            pb.move_to(x, y);
        }
    }

    pub fn line_to(&mut self, x: f32, y: f32) {
        if let Some(ref mut pb) = self.path_builder {
            pb.line_to(x, y);
        }
    }

    pub fn cubic_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) {
        if let Some(ref mut pb) = self.path_builder {
            pb.cubic_to(x1, y1, x2, y2, x3, y3);
        }
    }

    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32) {
        if let Some(ref mut pb) = self.path_builder {
            pb.move_to(x, y);
            pb.line_to(x + w, y);
            pb.line_to(x + w, y + h);
            pb.line_to(x, y + h);
            pb.close();
        }
    }

    pub fn close_path(&mut self) {
        if let Some(ref mut pb) = self.path_builder {
            pb.close();
        }
    }

    pub fn fill(&mut self, gs: &GraphicsState, even_odd: bool) {
        let path = match self.path_builder.take() {
            Some(pb) => match pb.finish() {
                Some(p) => p,
                None => return,
            },
            None => return,
        };

        let mut paint = Paint::default();
        let (r, g, b, a) = gs.fill_color;
        paint.set_color_rgba8(r, g, b, a);
        paint.anti_alias = true;

        let rule = if even_odd { FillRule::EvenOdd } else { FillRule::Winding };
        self.pixmap.fill_path(&path, &paint, rule, gs.ctm, None);
    }

    pub fn stroke(&mut self, gs: &GraphicsState) {
        let path = match self.path_builder.take() {
            Some(pb) => match pb.finish() {
                Some(p) => p,
                None => return,
            },
            None => return,
        };

        let mut paint = Paint::default();
        let (r, g, b, a) = gs.stroke_color;
        paint.set_color_rgba8(r, g, b, a);
        paint.anti_alias = true;

        let mut stroke = Stroke::default();
        stroke.width = gs.line_width;
        stroke.line_cap = match gs.line_cap {
            1 => LineCap::Round,
            2 => LineCap::Square,
            _ => LineCap::Butt,
        };
        stroke.line_join = match gs.line_join {
            1 => LineJoin::Round,
            2 => LineJoin::Bevel,
            _ => LineJoin::Miter,
        };
        stroke.miter_limit = gs.miter_limit;
        if !gs.dash_array.is_empty() {
            stroke.dash = StrokeDash::new(gs.dash_array.clone(), gs.dash_phase);
        }

        self.pixmap.stroke_path(&path, &paint, &stroke, gs.ctm, None);
    }

    pub fn fill_and_stroke(&mut self, gs: &GraphicsState, even_odd: bool) {
        // Clone path builder for fill, then stroke
        if let Some(ref pb) = self.path_builder {
            // We need the path twice — rebuild from the builder state
            // Actually just finish and clone the path
            let pb_clone = self.path_builder.take();
            if let Some(pb) = pb_clone {
                if let Some(path) = pb.finish() {
                    // Fill
                    let mut fill_paint = Paint::default();
                    let (r, g, b, a) = gs.fill_color;
                    fill_paint.set_color_rgba8(r, g, b, a);
                    fill_paint.anti_alias = true;
                    let rule = if even_odd { FillRule::EvenOdd } else { FillRule::Winding };
                    self.pixmap.fill_path(&path, &fill_paint, rule, gs.ctm, None);

                    // Stroke
                    let mut stroke_paint = Paint::default();
                    let (r, g, b, a) = gs.stroke_color;
                    stroke_paint.set_color_rgba8(r, g, b, a);
                    stroke_paint.anti_alias = true;

                    let mut stroke = Stroke::default();
                    stroke.width = gs.line_width;
                    self.pixmap.stroke_path(&path, &stroke_paint, &stroke, gs.ctm, None);
                }
            }
        }
    }

    pub fn into_rgba(self) -> Vec<u8> {
        self.pixmap.data().to_vec()
    }
}
```

- [ ] **Step 2: Run cargo check**

Run: `cd open-pdf-render && cargo check`
Expected: compileert

- [ ] **Step 3: Commit**

```bash
git add open-pdf-render/src/renderer.rs
git commit -m "feat: implement tiny-skia renderer wrapper with path/fill/stroke"
```

---

### Task 5: Content stream interpreter

**Files:**
- Create: `open-pdf-render/src/interpreter.rs` (vervang stub)

- [ ] **Step 1: Implementeer de interpreter**

```rust
use lopdf::content::{Content, Operation};
use lopdf::Object;
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::color;
use crate::RenderError;

pub struct Interpreter;

impl Interpreter {
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;

        for op in &content.operations {
            match op.operator.as_str() {
                // --- Graphics state ---
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        let a = Self::f(&op.operands[0]);
                        let b = Self::f(&op.operands[1]);
                        let c = Self::f(&op.operands[2]);
                        let d = Self::f(&op.operands[3]);
                        let e = Self::f(&op.operands[4]);
                        let f = Self::f(&op.operands[5]);
                        state.concat_matrix(a, b, c, d, e, f);
                    }
                }
                "w" => {
                    if let Some(w) = op.operands.first() {
                        state.current.line_width = Self::f(w);
                    }
                }
                "J" => {
                    if let Some(v) = op.operands.first() {
                        state.current.line_cap = Self::i(v) as u8;
                    }
                }
                "j" => {
                    if let Some(v) = op.operands.first() {
                        state.current.line_join = Self::i(v) as u8;
                    }
                }
                "M" => {
                    if let Some(v) = op.operands.first() {
                        state.current.miter_limit = Self::f(v);
                    }
                }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                    }
                }

                // --- Color ---
                "g" => {
                    if let Some(gray) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(gray));
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "G" => {
                    if let Some(gray) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(gray));
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                "rg" => {
                    if op.operands.len() >= 3 {
                        state.current.fill_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                "RG" => {
                    if op.operands.len() >= 3 {
                        state.current.stroke_color = color::rgb_to_rgba8(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                        );
                    }
                }
                "k" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "K" => {
                    if op.operands.len() >= 4 {
                        let (r, g, b) = color::cmyk_to_rgb(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                        );
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // cs/CS/sc/SC/scn/SCN — colorspace operators (simplified)
                "cs" | "CS" | "sc" | "SC" | "scn" | "SCN" => {
                    // Simplified: treat as RGB if 3 operands, gray if 1
                    match op.operands.len() {
                        3 => {
                            let c = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                            if op.operator.chars().next().unwrap().is_uppercase() {
                                state.current.stroke_color = c;
                            } else {
                                state.current.fill_color = c;
                            }
                        }
                        1 => {
                            if let Object::Real(_) | Object::Integer(_) = &op.operands[0] {
                                let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                                if op.operator.chars().next().unwrap().is_uppercase() {
                                    state.current.stroke_color = (r, g, b, 255);
                                } else {
                                    state.current.fill_color = (r, g, b, 255);
                                }
                            }
                        }
                        _ => {} // Ignore complex colorspaces for now
                    }
                }

                // --- Path construction ---
                "m" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        renderer.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "l" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        renderer.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "c" => {
                    if op.operands.len() >= 6 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        renderer.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "v" => {
                    // Shorthand cubic: first control point = current point
                    if op.operands.len() >= 4 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        // Use current point as first control point — approximate with lineto for now
                        renderer.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "y" => {
                    // Shorthand cubic: second control point = endpoint
                    if op.operands.len() >= 4 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        renderer.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "re" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path { renderer.begin_path(); has_active_path = true; }
                        renderer.rect(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "h" => {
                    renderer.close_path();
                }

                // --- Path painting ---
                "S" => { renderer.stroke(&state.current); has_active_path = false; }
                "s" => { renderer.close_path(); renderer.stroke(&state.current); has_active_path = false; }
                "f" | "F" => { renderer.fill(&state.current, false); has_active_path = false; }
                "f*" => { renderer.fill(&state.current, true); has_active_path = false; }
                "B" => { renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "B*" => { renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "b" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "b*" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "n" => { has_active_path = false; } // End path without painting

                // --- Clipping (simplified: skip for now) ---
                "W" | "W*" => {} // TODO: implement clipping in later phase

                // --- Text (skip for now — Phase 3) ---
                "BT" | "ET" | "Tf" | "Td" | "TD" | "Tm" | "Tj" | "TJ" | "T*" | "'" | "\"" => {}

                // --- XObjects (skip for now — Phase 2) ---
                "Do" => {}

                // --- Ignore unknown operators ---
                _ => {}
            }
        }

        Ok(())
    }

    fn f(obj: &Object) -> f32 {
        match obj {
            Object::Real(r) => *r as f32,
            Object::Integer(i) => *i as f32,
            _ => 0.0,
        }
    }

    fn i(obj: &Object) -> i32 {
        match obj {
            Object::Integer(i) => *i as i32,
            Object::Real(r) => *r as i32,
            _ => 0,
        }
    }
}
```

- [ ] **Step 2: Run cargo check**

Run: `cd open-pdf-render && cargo check`
Expected: compileert

- [ ] **Step 3: Commit**

```bash
git add open-pdf-render/src/interpreter.rs
git commit -m "feat: implement PDF content stream interpreter with path/color/state operators"
```

---

### Task 6: Verbind parser → interpreter → renderer

**Files:**
- Modify: `open-pdf-render/src/parser.rs`

- [ ] **Step 1: Update render_page om de interpreter te gebruiken**

Vervang de stub `render_page` in parser.rs:

```rust
use crate::{RenderError, RenderedPage};
use crate::graphics_state::GraphicsStateStack;
use crate::interpreter::Interpreter;
use crate::renderer::SkiaRenderer;
use lopdf::{Document, Object};
use tiny_skia::Transform;

pub struct DocumentHandle {
    doc: Document,
}

impl DocumentHandle {
    pub fn load(bytes: &[u8]) -> Result<Self, RenderError> {
        let doc = Document::load_from(std::io::Cursor::new(bytes))
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        Ok(DocumentHandle { doc })
    }

    pub fn page_count(&self) -> usize {
        self.doc.get_pages().len()
    }

    pub fn page_dimensions(&self, page: usize) -> Result<(f32, f32), RenderError> {
        let page_id = self.get_page_id(page)?;
        self.extract_media_box(page_id)
    }

    pub fn render_page(&self, page: usize, scale: f32) -> Result<RenderedPage, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (w_pt, h_pt) = self.extract_media_box(page_id)?;
        let dpr = 1.0; // DPR is handled by frontend
        let width = (w_pt * scale * dpr).ceil() as u32;
        let height = (h_pt * scale * dpr).ceil() as u32;

        let mut renderer = SkiaRenderer::new(width, height)
            .map_err(|e| RenderError::RenderError(e))?;

        let mut state = GraphicsStateStack::new();

        // Set initial transform: PDF coords (bottom-left origin) → pixel coords (top-left origin)
        // Also apply scale
        state.current.ctm = Transform::from_row(scale, 0.0, 0.0, -scale, 0.0, h_pt * scale);

        // Get content stream bytes
        let content_bytes = self.get_content_stream(page_id)?;

        // Execute content stream
        Interpreter::execute(&content_bytes, &mut renderer, &mut state)?;

        Ok(RenderedPage {
            width,
            height,
            rgba: renderer.into_rgba(),
        })
    }

    fn get_page_id(&self, page: usize) -> Result<lopdf::ObjectId, RenderError> {
        let pages = self.doc.get_pages();
        let mut sorted_pages: Vec<_> = pages.iter().collect();
        sorted_pages.sort_by_key(|(num, _)| *num);
        sorted_pages
            .get(page)
            .map(|(_, id)| **id)
            .ok_or_else(|| RenderError::ParseError(format!("Page {} not found", page)))
    }

    fn extract_media_box(&self, page_id: lopdf::ObjectId) -> Result<(f32, f32), RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page not a dict".into()))?;

        // Try CropBox first, then MediaBox
        let box_arr = dict.get(b"CropBox")
            .or_else(|_| dict.get(b"MediaBox"))
            .map_err(|_| RenderError::ParseError("No MediaBox/CropBox".into()))?;

        let arr = match box_arr {
            Object::Reference(id) => {
                self.doc.get_object(*id)
                    .map_err(|e| RenderError::ParseError(format!("{}", e)))?
                    .as_array()
                    .map_err(|_| RenderError::ParseError("Box not array".into()))?
                    .clone()
            }
            Object::Array(a) => a.clone(),
            _ => return Err(RenderError::ParseError("Box not array".into())),
        };

        if arr.len() < 4 { return Err(RenderError::ParseError("Box < 4 elements".into())); }
        let x0 = Self::obj_to_f32(&arr[0])?;
        let y0 = Self::obj_to_f32(&arr[1])?;
        let x1 = Self::obj_to_f32(&arr[2])?;
        let y1 = Self::obj_to_f32(&arr[3])?;
        Ok(((x1 - x0).abs(), (y1 - y0).abs()))
    }

    fn get_content_stream(&self, page_id: lopdf::ObjectId) -> Result<Vec<u8>, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page not a dict".into()))?;

        let contents = dict.get(b"Contents")
            .map_err(|_| RenderError::ParseError("No Contents".into()))?;

        let mut all_bytes = Vec::new();

        match contents {
            Object::Reference(id) => {
                let stream = self.doc.get_object(*id)
                    .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
                if let Object::Stream(ref s) = *stream {
                    let decoded = s.decompressed_content()
                        .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))?;
                    all_bytes.extend(decoded);
                }
            }
            Object::Array(arr) => {
                for item in arr {
                    if let Object::Reference(id) = item {
                        let stream = self.doc.get_object(*id)
                            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
                        if let Object::Stream(ref s) = *stream {
                            let decoded = s.decompressed_content()
                                .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))?;
                            all_bytes.extend(decoded);
                        }
                    }
                }
            }
            _ => return Err(RenderError::ParseError("Contents not ref/array".into())),
        }

        Ok(all_bytes)
    }

    fn obj_to_f32(obj: &Object) -> Result<f32, RenderError> {
        match obj {
            Object::Real(r) => Ok(*r as f32),
            Object::Integer(i) => Ok(*i as f32),
            _ => Err(RenderError::ParseError("Expected number".into())),
        }
    }
}
```

- [ ] **Step 2: Test met een echte PDF**

Run: `cd open-pdf-render && cargo test`
Expected: tests passen (render geeft nu vectoren in plaats van wit)

- [ ] **Step 3: Commit**

```bash
git add open-pdf-render/src/parser.rs
git commit -m "feat: connect parser → interpreter → renderer pipeline"
```

---

### Task 7: Integreer in Tauri

**Files:**
- Modify: `open-pdf-studio/src-tauri/Cargo.toml`
- Modify: `open-pdf-studio/src-tauri/src/lib.rs`
- Modify: `open-pdf-studio/js/pdf/renderer.js`

- [ ] **Step 1: Voeg dependency toe in Cargo.toml**

Voeg onder `[dependencies]` toe:
```toml
open-pdf-render = { path = "../../open-pdf-render" }
```

- [ ] **Step 2: Voeg Tauri commands toe in lib.rs**

Voeg vóór de `run()` functie toe:
```rust
use open_pdf_render::PdfRenderer;

#[tauri::command]
fn render_pdf_page(path: String, page_index: u32, scale: f32) -> Result<Vec<u8>, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Read: {}", e))?;
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    let page = doc.render_page(page_index as usize, scale).map_err(|e| format!("{}", e))?;
    Ok(page.rgba)
}

#[tauri::command]
fn get_page_dimensions(path: String) -> Result<Vec<(f32, f32)>, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Read: {}", e))?;
    let renderer = PdfRenderer::new();
    let doc = renderer.load_document(&bytes).map_err(|e| format!("{}", e))?;
    (0..doc.page_count())
        .map(|i| doc.page_dimensions(i).map_err(|e| format!("{}", e)))
        .collect()
}
```

Registreer in de `invoke_handler`:
```rust
render_pdf_page,
get_page_dimensions,
```

- [ ] **Step 3: Update renderer.js**

Vervang de MuPDF/TODO code in `renderPage()` met:
```javascript
// Try Rust open-pdf-render first, fall back to PDF.js
if (isTauri() && doc.filePath) {
  try {
    const rgbaBytes = await invoke('render_pdf_page', {
      path: doc.filePath,
      pageIndex: pageNum - 1,
      scale: scale * dpr,
    });
    if (rgbaBytes && rgbaBytes.length > 0) {
      const w = bufferW;
      const h = Math.floor(rgbaBytes.length / (w * 4));
      pdfCanvas.width = w;
      pdfCanvas.height = h;
      pdfCanvas.style.width = Math.floor(viewport.width) + 'px';
      pdfCanvas.style.height = Math.floor(viewport.height) + 'px';
      const imageData = new ImageData(new Uint8ClampedArray(rgbaBytes), w, h);
      pdfCanvas.getContext('2d').putImageData(imageData, 0, 0);
    } else {
      await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
    }
  } catch (e) {
    console.warn('[open-pdf-render] Fallback to PDF.js:', e);
    await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
  }
} else {
  await _renderPageWithPdfJs(page, viewport, pdfCanvas, bufferW, bufferH, dpr);
}
```

- [ ] **Step 4: Compileer en test**

Run: `cd open-pdf-studio/src-tauri && cargo check`
Expected: compileert

Run: `npm run tauri:dev`
Open een bouwtekening PDF → vectoren moeten zichtbaar zijn

- [ ] **Step 5: Commit**

```bash
git add open-pdf-studio/src-tauri/ open-pdf-studio/js/pdf/renderer.js
git commit -m "feat: integrate open-pdf-render into Tauri with PDF.js fallback"
```

---

### Task 8: Test met echte bouwtekeningen

- [ ] **Step 1: Test met de bouwtekening PDF's**

Open elk bestand uit:
`C:\3BM\50_projecten\3_3BM_bouwtechniek\3059 Woonhuis Benedenkerkseweg 87 Stolwijk\20_post_IN\01 27-03-2026 beginstukken\`

Verwacht:
- Vectorlijnen zichtbaar (zwarte lijnen op wit)
- Render tijd < 100ms (check DevTools console)
- Als tekst ontbreekt is dat OK (fase 3)

- [ ] **Step 2: Verifieer PDF.js fallback**

Test met een foto-PDF of scan-PDF. Als open-pdf-render een error geeft, moet PDF.js het automatisch overnemen zonder dat de gebruiker iets merkt.

- [ ] **Step 3: Commit en push**

```bash
git add -A
git commit -m "feat: open-pdf-render v0.1 — pure Rust PDF renderer with Tauri integration"
```
