use lopdf::content::Content;
use lopdf::{Document, Dictionary, Object};
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::draw_commands::DrawCommandBuffer;
use crate::color;
use crate::RenderError;

/// PDF Text State — follows PDF spec §9.3 and §9.4 exactly.
///
/// Two matrices track text position:
/// - `tm`:  Text Matrix — current glyph rendering position
/// - `tlm`: Text Line Matrix — start of current line (set by Td/TD/Tm/T*)
///
/// Character advances update `tm` via matrix pre-multiplication:
///   tm_new = [1 0 0 1 tx ty] × tm_old
///
/// Line moves (Td/TD/T*) update `tlm` then copy to `tm`.
struct TextState {
    font_size: f32,            // Tfs — set by Tf operator
    horizontal_scaling: f32,   // Th — set by Tz operator (1.0 = 100%)
    char_spacing: f32,         // Tc — set by Tc operator
    word_spacing: f32,         // Tw — set by Tw operator
    leading: f32,              // TL — set by TL operator
    rise: f32,                 // Trise — set by Ts operator
    tm: [f32; 6],             // Text matrix [a b c d e f]
    tlm: [f32; 6],            // Text line matrix
    in_text: bool,
    current_font_name: String,
}

impl TextState {
    fn new() -> Self {
        TextState {
            font_size: 12.0,
            horizontal_scaling: 1.0,
            char_spacing: 0.0,
            word_spacing: 0.0,
            leading: 0.0,
            rise: 0.0,
            tm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            tlm: [1.0, 0.0, 0.0, 1.0, 0.0, 0.0],
            in_text: false,
            current_font_name: String::new(),
        }
    }

    /// BT operator: reset text matrices to identity
    fn begin_text(&mut self) {
        self.tm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.tlm = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        self.in_text = true;
    }

    /// Td operator: move to start of next line.
    /// PDF spec: Tlm = [1 0 0 1 tx ty] × Tlm; Tm = Tlm
    fn translate_line(&mut self, tx: f32, ty: f32) {
        let new_e = tx * self.tlm[0] + ty * self.tlm[2] + self.tlm[4];
        let new_f = tx * self.tlm[1] + ty * self.tlm[3] + self.tlm[5];
        self.tlm[4] = new_e;
        self.tlm[5] = new_f;
        self.tm = self.tlm;
    }

    /// Tm operator: set text matrix and line matrix directly
    fn set_text_matrix(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        self.tm = [a, b, c, d, e, f];
        self.tlm = self.tm;
    }

    /// Advance for TJ kerning: adjust = -(kern/1000) × Tfs × Th
    fn apply_tj_kern(&mut self, kern: f32) {
        let tx = -(kern / 1000.0) * self.font_size * self.horizontal_scaling;
        self.tm[4] += tx * self.tm[0];
        self.tm[5] += tx * self.tm[1];
    }

    /// Get the effective text position including rise offset.
    /// Trm position = (Trise × Tm[2] + Tm[4], Trise × Tm[3] + Tm[5])
    fn render_x(&self) -> f32 {
        self.rise * self.tm[2] + self.tm[4]
    }

    fn render_y(&self) -> f32 {
        self.rise * self.tm[3] + self.tm[5]
    }
}

pub struct Interpreter;

impl Interpreter {
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;

        for op in &content.operations {
            match op.operator.as_str() {
                // Graphics state
                "q" => state.save(),
                "Q" => state.restore(),
                "cm" => {
                    if op.operands.len() >= 6 {
                        state.concat_matrix(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "w" => { if let Some(w) = op.operands.first() { state.current.line_width = Self::f(w); } }
                "J" => { if let Some(v) = op.operands.first() { state.current.line_cap = Self::i(v) as u8; } }
                "j" => { if let Some(v) = op.operands.first() { state.current.line_join = Self::i(v) as u8; } }
                "M" => { if let Some(v) = op.operands.first() { state.current.miter_limit = Self::f(v); } }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                    }
                }
                // Color - grayscale
                "g" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.fill_color = (r,g,b,255); } }
                "G" => { if let Some(v) = op.operands.first() { let (r,g,b) = color::gray_to_rgb(Self::f(v)); state.current.stroke_color = (r,g,b,255); } }
                // Color - RGB
                "rg" => { if op.operands.len() >= 3 { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                "RG" => { if op.operands.len() >= 3 { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); } }
                // Color - CMYK
                "k" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); } }
                "K" => { if op.operands.len() >= 4 { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); } }
                // Color - colorspace operators (simplified)
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => { state.current.fill_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.fill_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.fill_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => { state.current.stroke_color = color::rgb_to_rgba8(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2])); }
                        1 => { let (r,g,b) = color::gray_to_rgb(Self::f(&op.operands[0])); state.current.stroke_color = (r,g,b,255); }
                        4 => { let (r,g,b) = color::cmyk_to_rgb(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); state.current.stroke_color = (r,g,b,255); }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "l" => { if op.operands.len() >= 2 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1])); } }
                "c" => { if op.operands.len() >= 6 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[4]), Self::f(&op.operands[5])); } }
                "v" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "y" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.cubic_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "re" => { if op.operands.len() >= 4 { if !has_active_path { renderer.begin_path(); has_active_path = true; } renderer.rect(Self::f(&op.operands[0]), Self::f(&op.operands[1]), Self::f(&op.operands[2]), Self::f(&op.operands[3])); } }
                "h" => { renderer.close_path(); }
                // Path painting
                "S" => { renderer.stroke(&state.current); has_active_path = false; }
                "s" => { renderer.close_path(); renderer.stroke(&state.current); has_active_path = false; }
                "f" | "F" => { renderer.fill(&state.current, false); has_active_path = false; }
                "f*" => { renderer.fill(&state.current, true); has_active_path = false; }
                "B" => { renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "B*" => { renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "b" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, false); has_active_path = false; }
                "b*" => { renderer.close_path(); renderer.fill_and_stroke(&state.current, true); has_active_path = false; }
                "n" => { has_active_path = false; }
                // Clipping, text, XObjects -- skip for now
                "W" | "W*" => {}
                "BT" | "ET" | "Tf" | "Td" | "TD" | "Tm" | "Tj" | "TJ" | "T*" | "'" | "\"" | "Tc" | "Tw" | "Tz" | "TL" | "Ts" | "Tr" => {}
                "Do" => {
                    Self::handle_do_execute(&op.operands, renderer, state, doc, resources);
                }
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    fn handle_do_execute(
        operands: &[Object],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());
        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    state.concat_matrix(
                        Self::f(&arr[0]), Self::f(&arr[1]),
                        Self::f(&arr[2]), Self::f(&arr[3]),
                        Self::f(&arr[4]), Self::f(&arr[5]),
                    );
                }
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::execute(&content_bytes, renderer, state, doc, res);
        }
        state.restore();
    }

    pub fn extract_commands(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut has_active_path = false;
        let mut text_state = TextState::new();

        for op in &content.operations {
            match op.operator.as_str() {
                // Graphics state
                "q" => {
                    state.save();
                    buf.save_state();
                }
                "Q" => {
                    state.restore();
                    buf.restore_state();
                }
                "cm" => {
                    if op.operands.len() >= 6 {
                        let a = Self::f(&op.operands[0]);
                        let b = Self::f(&op.operands[1]);
                        let c = Self::f(&op.operands[2]);
                        let d = Self::f(&op.operands[3]);
                        let e = Self::f(&op.operands[4]);
                        let f = Self::f(&op.operands[5]);
                        state.concat_matrix(a, b, c, d, e, f);
                        buf.transform(a, b, c, d, e, f);
                    }
                }
                "w" => {
                    if let Some(w) = op.operands.first() {
                        state.current.line_width = Self::f(w);
                    }
                }
                "J" => {
                    if let Some(v) = op.operands.first() {
                        let cap = Self::i(v) as u8;
                        state.current.line_cap = cap;
                        buf.set_line_cap(cap);
                    }
                }
                "j" => {
                    if let Some(v) = op.operands.first() {
                        let join = Self::i(v) as u8;
                        state.current.line_join = join;
                        buf.set_line_join(join);
                    }
                }
                "M" => {
                    if let Some(v) = op.operands.first() {
                        let ml = Self::f(v);
                        state.current.miter_limit = ml;
                        buf.set_miter_limit(ml);
                    }
                }
                "d" => {
                    if op.operands.len() >= 2 {
                        if let Object::Array(arr) = &op.operands[0] {
                            state.current.dash_array = arr.iter().map(|o| Self::f(o)).collect();
                        }
                        state.current.dash_phase = Self::f(&op.operands[1]);
                        buf.set_dash(&state.current.dash_array, state.current.dash_phase);
                    }
                }
                // Color - grayscale
                "g" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.fill_color = (r, g, b, 255);
                    }
                }
                "G" => {
                    if let Some(v) = op.operands.first() {
                        let (r, g, b) = color::gray_to_rgb(Self::f(v));
                        state.current.stroke_color = (r, g, b, 255);
                    }
                }
                // Color - RGB
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
                // Color - CMYK
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
                // Color - colorspace operators
                "sc" | "scn" => {
                    match op.operands.len() {
                        3 => {
                            state.current.fill_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.fill_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.fill_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "SC" | "SCN" => {
                    match op.operands.len() {
                        3 => {
                            state.current.stroke_color = color::rgb_to_rgba8(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                            );
                        }
                        1 => {
                            let (r, g, b) = color::gray_to_rgb(Self::f(&op.operands[0]));
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        4 => {
                            let (r, g, b) = color::cmyk_to_rgb(
                                Self::f(&op.operands[0]),
                                Self::f(&op.operands[1]),
                                Self::f(&op.operands[2]),
                                Self::f(&op.operands[3]),
                            );
                            state.current.stroke_color = (r, g, b, 255);
                        }
                        _ => {}
                    }
                }
                "cs" | "CS" => {}
                // Path construction
                "m" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.move_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "l" => {
                    if op.operands.len() >= 2 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.line_to(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
                    }
                }
                "c" => {
                    if op.operands.len() >= 6 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "v" => {
                    // v x2 y2 x3 y3: cubic bezier where first control point = current point
                    // We don't track the current point here, so we approximate by using
                    // (x2,y2) as both control points (same as the existing behavior).
                    // A perfect implementation would track the current path position.
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "y" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.cubic_to(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "re" => {
                    if op.operands.len() >= 4 {
                        if !has_active_path {
                            buf.begin_path();
                            has_active_path = true;
                        }
                        buf.rect(
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                        );
                    }
                }
                "h" => {
                    buf.close_path();
                }
                // Path painting
                "S" => {
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "s" => {
                    buf.close_path();
                    let (r, g, b, a) = state.current.stroke_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_stroke(rgba, state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "f" | "F" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill();
                    has_active_path = false;
                }
                "f*" => {
                    let (r, g, b, a) = state.current.fill_color;
                    let rgba = Self::color_to_u32(r, g, b, a);
                    buf.set_fill(rgba);
                    buf.fill_even_odd();
                    has_active_path = false;
                }
                "B" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "B*" => {
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "b*" => {
                    buf.close_path();
                    let (fr, fg, fb, fa) = state.current.fill_color;
                    buf.set_fill(Self::color_to_u32(fr, fg, fb, fa));
                    buf.fill_even_odd();
                    let (sr, sg, sb, sa) = state.current.stroke_color;
                    buf.set_stroke(Self::color_to_u32(sr, sg, sb, sa), state.current.line_width);
                    buf.stroke();
                    has_active_path = false;
                }
                "n" => {
                    has_active_path = false;
                }
                // Clipping
                "W" | "W*" => {}
                // Text operators
                "BT" => {
                    text_state.begin_text();
                }
                "ET" => {
                    text_state.in_text = false;
                }
                "Tf" => {
                    if op.operands.len() >= 2 {
                        if let Object::Name(ref name_bytes) = op.operands[0] {
                            text_state.current_font_name =
                                String::from_utf8_lossy(name_bytes).to_string();
                        }
                        text_state.font_size = Self::f(&op.operands[1]);
                    }
                }
                "TL" => {
                    if let Some(v) = op.operands.first() {
                        text_state.leading = Self::f(v);
                    }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.translate_line(tx, ty);
                    }
                }
                "TD" => {
                    if op.operands.len() >= 2 {
                        let tx = Self::f(&op.operands[0]);
                        let ty = Self::f(&op.operands[1]);
                        text_state.leading = -ty;
                        text_state.translate_line(tx, ty);
                    }
                }
                "Tm" => {
                    if op.operands.len() >= 6 {
                        text_state.set_text_matrix(
                            Self::f(&op.operands[0]),
                            Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]),
                            Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]),
                            Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => {
                    text_state.translate_line(0.0, -text_state.leading);
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                if font_entry.is_cid && font_entry.parsed.is_some() {
                                    crate::text_renderer::render_cid_text_glyphs(
                                        bytes, font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                } else if font_entry.parsed.is_some() {
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                } else {
                                    // No font data available — skip rendering
                                    // (TextAt fallback causes mispositioned text)
                                }
                            }
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        let (r, g, b, a) = state.current.fill_color;
                        let rgba = Self::color_to_u32(r, g, b, a);
                        let font_entry_opt = font_registry.get_font(
                            &text_state.current_font_name, doc, resources,
                        );
                        let has_font = font_entry_opt.and_then(|e| e.parsed.as_ref()).is_some();

                        let is_cid_font = font_entry_opt.map(|e| e.is_cid).unwrap_or(false);

                        if has_font {
                            for item in arr {
                                match item {
                                    Object::String(bytes, _) => {
                                        if !bytes.is_empty() {
                                            let font_entry = font_registry
                                                .get_font(&text_state.current_font_name, doc, resources)
                                                .unwrap();
                                            if is_cid_font {
                                                crate::text_renderer::render_cid_text_glyphs(
                                                    bytes, font_entry, text_state.font_size,
                                                    text_state.horizontal_scaling, text_state.char_spacing,
                                                    text_state.word_spacing, text_state.rise,
                                                    &mut text_state.tm, rgba, buf,
                                                );
                                            } else {
                                                crate::text_renderer::render_text_glyphs(
                                                    bytes, font_entry, text_state.font_size,
                                                    text_state.horizontal_scaling, text_state.char_spacing,
                                                    text_state.word_spacing, text_state.rise,
                                                    &mut text_state.tm, rgba, buf,
                                                );
                                            }
                                        }
                                    }
                                    Object::Integer(_) | Object::Real(_) => {
                                        let kern = Self::f(item);
                                        text_state.apply_tj_kern(kern);
                                    }
                                    _ => {}
                                }
                            }
                        } else {
                            // No font data — skip rendering
                        }
                    }
                }
                "'" => {
                    // ' is equivalent to: T* then Tj
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            let (r, g, b, a) = state.current.fill_color;
                            let rgba = Self::color_to_u32(r, g, b, a);
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                crate::text_renderer::render_text_glyphs(
                                    bytes,
                                    font_entry,
                                    text_state.font_size,
                                    text_state.horizontal_scaling,
                                    text_state.char_spacing,
                                    text_state.word_spacing,
                                    text_state.rise,
                                    &mut text_state.tm,
                                    rgba,
                                    buf,
                                );
                            }
                        }
                    }
                }
                "\"" => {
                    // " is equivalent to: Tw Tc T* Tj
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                let (r, g, b, a) = state.current.fill_color;
                                let rgba = Self::color_to_u32(r, g, b, a);
                                if let Some(font_entry) = font_registry.get_font(
                                    &text_state.current_font_name, doc, resources,
                                ) {
                                    crate::text_renderer::render_text_glyphs(
                                        bytes,
                                        font_entry,
                                        text_state.font_size,
                                        text_state.horizontal_scaling,
                                        text_state.char_spacing,
                                        text_state.word_spacing,
                                        text_state.rise,
                                        &mut text_state.tm,
                                        rgba,
                                        buf,
                                    );
                                }
                            }
                        }
                    }
                }
                "Tc" => {
                    if let Some(v) = op.operands.first() {
                        text_state.char_spacing = Self::f(v);
                    }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() {
                        text_state.word_spacing = Self::f(v);
                    }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() {
                        text_state.horizontal_scaling = Self::f(v) / 100.0;
                    }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() {
                        text_state.rise = Self::f(v);
                    }
                }
                "Tr" => {}
                "Do" => {
                    Self::handle_do_extract(&op.operands, buf, state, doc, resources, font_registry);
                }
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn decode_pdf_string(obj: &Object) -> String {
        match obj {
            Object::String(bytes, _) => String::from_utf8_lossy(bytes).into_owned(),
            _ => String::new(),
        }
    }

    fn color_to_u32(r: u8, g: u8, b: u8, a: u8) -> u32 {
        (r as u32) << 24 | (g as u32) << 16 | (b as u32) << 8 | (a as u32)
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

    fn handle_do_extract(
        operands: &[Object],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) {
        let name = match operands.first() {
            Some(Object::Name(n)) => n,
            _ => return,
        };
        let xobj_dict = match resources.get(b"XObject").and_then(|o| Self::resolve_dict(o, doc)) {
            Ok(d) => d,
            _ => return,
        };
        let obj_ref = match xobj_dict.get(name.as_slice()) {
            Ok(o) => o,
            _ => return,
        };
        let resolved_id = match obj_ref {
            Object::Reference(id) => *id,
            _ => return,
        };
        let obj = match doc.get_object(resolved_id) {
            Ok(o) => o,
            _ => return,
        };
        let stream = match obj {
            Object::Stream(ref s) => s,
            _ => return,
        };
        let subtype = stream.dict.get(b"Subtype").ok().and_then(|s| s.as_name().ok());

        if subtype == Some(b"Image" as &[u8]) {
            // Image XObject — decode and emit as DrawImage command
            Self::handle_image_xobject(stream, buf, doc);
            return;
        }

        if subtype != Some(b"Form" as &[u8]) {
            return;
        }
        buf.save_state();
        state.save();
        if let Ok(matrix) = stream.dict.get(b"Matrix") {
            if let Ok(arr) = matrix.as_array() {
                if arr.len() >= 6 {
                    let a = Self::f(&arr[0]);
                    let b_val = Self::f(&arr[1]);
                    let c = Self::f(&arr[2]);
                    let d = Self::f(&arr[3]);
                    let e = Self::f(&arr[4]);
                    let f = Self::f(&arr[5]);
                    buf.transform(a, b_val, c, d, e, f);
                    state.concat_matrix(a, b_val, c, d, e, f);
                }
            }
        }
        let form_resources = Self::extract_form_resources(&stream.dict, doc);
        let res = form_resources.as_ref().unwrap_or(resources);
        if let Ok(content_bytes) = stream.decompressed_content() {
            let _ = Self::extract_commands(&content_bytes, buf, state, doc, res, font_registry);
        }
        state.restore();
        buf.restore_state();
    }

    /// Handle an Image XObject: decode image data and emit DrawImage command.
    /// PDF images live in a 1×1 unit square — the CTM (already on the canvas stack
    /// via cm operators) scales them to the correct page position and size.
    fn handle_image_xobject(
        stream: &lopdf::Stream,
        buf: &mut DrawCommandBuffer,
        doc: &Document,
    ) {
        let dict = &stream.dict;

        let width = dict.get(b"Width")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);
        let height = dict.get(b"Height")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u16),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Integer(i) = o { Some(*i as u16) } else { None }
                }),
                _ => None,
            })
            .unwrap_or(0);

        if width == 0 || height == 0 {
            return;
        }

        // Detect filter to determine image format
        let filter = dict.get(b"Filter").ok().and_then(|o| {
            match o {
                Object::Name(n) => Some(n.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Name(n) = o { Some(n.clone()) } else { None }
                }),
                Object::Array(arr) => {
                    // Multiple filters — use the last one (outermost)
                    arr.last().and_then(|o| match o {
                        Object::Name(n) => Some(n.clone()),
                        _ => None,
                    })
                }
                _ => None,
            }
        });

        let filter_name = filter.as_deref().unwrap_or(b"");

        if filter_name == b"DCTDecode" {
            // JPEG — send raw bytes directly (browser decodes via hardware-accelerated createImageBitmap)
            // stream.content contains the raw JPEG bytes before lopdf's decompression
            let raw_content = &stream.content;
            if !raw_content.is_empty() && raw_content.len() > 2
                && raw_content[0] == 0xFF && raw_content[1] == 0xD8 {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y (images are top-down)
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        if filter_name == b"JPXDecode" {
            // JPEG 2000 — send raw bytes, browser may support it
            let raw_content = &stream.content;
            if !raw_content.is_empty() {
                buf.save_state();
                buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
                buf.draw_image(width, height, raw_content);
                buf.restore_state();
                return;
            }
        }

        // For FlateDecode or no filter: decompress and encode as PNG
        let bits = dict.get(b"BitsPerComponent")
            .ok()
            .and_then(|o| match o {
                Object::Integer(i) => Some(*i as u8),
                _ => None,
            })
            .unwrap_or(8);

        let cs_name = dict.get(b"ColorSpace")
            .ok()
            .and_then(|o| match o {
                Object::Name(n) => Some(n.clone()),
                Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                    if let Object::Name(n) = o { Some(n.clone()) } else { None }
                }),
                Object::Array(arr) => {
                    arr.first().and_then(|o| match o {
                        Object::Name(n) => Some(n.clone()),
                        _ => None,
                    })
                }
                _ => None,
            });

        let components: u8 = match cs_name.as_deref() {
            Some(b"DeviceRGB") => 3,
            Some(b"DeviceCMYK") => 4,
            Some(b"DeviceGray") => 1,
            Some(b"CalRGB") => 3,
            Some(b"CalGray") => 1,
            _ => 3, // default RGB
        };

        if let Ok(raw_pixels) = stream.decompressed_content() {
            if bits == 8 {
                // Convert raw pixels to RGBA and encode as simple bitmap
                let expected_len = width as usize * height as usize * components as usize;
                if raw_pixels.len() >= expected_len {
                    // Build RGBA buffer
                    let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
                    let mut i = 0;
                    for _ in 0..(width as usize * height as usize) {
                        match components {
                            1 => {
                                let g = raw_pixels.get(i).copied().unwrap_or(0);
                                rgba.extend_from_slice(&[g, g, g, 255]);
                                i += 1;
                            }
                            3 => {
                                let r = raw_pixels.get(i).copied().unwrap_or(0);
                                let g = raw_pixels.get(i + 1).copied().unwrap_or(0);
                                let b = raw_pixels.get(i + 2).copied().unwrap_or(0);
                                rgba.extend_from_slice(&[r, g, b, 255]);
                                i += 3;
                            }
                            4 => {
                                // CMYK → RGB (simple conversion)
                                let c = raw_pixels.get(i).copied().unwrap_or(0) as f32 / 255.0;
                                let m = raw_pixels.get(i + 1).copied().unwrap_or(0) as f32 / 255.0;
                                let y = raw_pixels.get(i + 2).copied().unwrap_or(0) as f32 / 255.0;
                                let k = raw_pixels.get(i + 3).copied().unwrap_or(0) as f32 / 255.0;
                                let r = (255.0 * (1.0 - c) * (1.0 - k)) as u8;
                                let g = (255.0 * (1.0 - m) * (1.0 - k)) as u8;
                                let b = (255.0 * (1.0 - y) * (1.0 - k)) as u8;
                                rgba.extend_from_slice(&[r, g, b, 255]);
                                i += 4;
                            }
                            _ => {
                                rgba.extend_from_slice(&[0, 0, 0, 255]);
                                i += components as usize;
                            }
                        }
                    }

                    // Send as raw RGBA with a simple header marker
                    // Format: "RGBA" magic (4 bytes) + width u16 LE + height u16 LE + RGBA pixels
                    let mut img_data = Vec::with_capacity(8 + rgba.len());
                    img_data.extend_from_slice(b"RGBA");
                    img_data.extend_from_slice(&width.to_le_bytes());
                    img_data.extend_from_slice(&height.to_le_bytes());
                    img_data.extend_from_slice(&rgba);

                    buf.save_state();
                    buf.transform(1.0, 0.0, 0.0, -1.0, 0.0, 1.0); // flip Y
                    buf.draw_image(width, height, &img_data);
                    buf.restore_state();
                }
            }
        }
    }

    fn resolve_dict<'a>(obj: &'a Object, doc: &'a Document) -> Result<&'a Dictionary, lopdf::Error> {
        match obj {
            Object::Dictionary(d) => Ok(d),
            Object::Reference(id) => {
                let resolved = doc.get_object(*id)?;
                resolved.as_dict()
            }
            _ => Err(lopdf::Error::Type),
        }
    }

    fn extract_form_resources(dict: &Dictionary, doc: &Document) -> Option<Dictionary> {
        let res_obj = dict.get(b"Resources").ok()?;
        match res_obj {
            Object::Reference(rid) => {
                doc.get_object(*rid).ok().and_then(|o| o.as_dict().ok().cloned())
            }
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }
    }
}
