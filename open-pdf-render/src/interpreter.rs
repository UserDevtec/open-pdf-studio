use lopdf::content::Content;
use lopdf::{Document, Dictionary, Object};
use crate::graphics_state::GraphicsStateStack;
use crate::renderer::SkiaRenderer;
use crate::draw_commands::DrawCommandBuffer;
use crate::color;
use crate::RenderError;

/// A text span with position, size, and Unicode text content.
/// Used to build a synthetic text selection layer in the frontend.
#[derive(Clone, Debug)]
pub struct TextSpan {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    pub text: String,
}

impl TextSpan {
    pub fn to_json(&self) -> String {
        format!(
            r#"{{"x":{},"y":{},"width":{},"height":{},"fontSize":{},"text":"{}"}}"#,
            self.x, self.y, self.width, self.height, self.font_size,
            self.text.replace('\\', "\\\\").replace('"', "\\\"").replace('\n', "\\n").replace('\r', "\\r")
        )
    }
}

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
    /// Execute content stream, rendering all content including full-resolution images.
    pub fn execute(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, 0)
    }

    /// Execute content stream with a pixel budget for images. Images larger
    /// than `max_pixels` are downsampled after decode. Use for thumbnails
    /// to keep rendering fast without skipping images entirely.
    pub fn execute_with_image_limit(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        max_pixels: u32,
    ) -> Result<(), RenderError> {
        Self::execute_internal(content_bytes, renderer, state, doc, resources, max_pixels)
    }

    fn execute_internal(
        content_bytes: &[u8],
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        max_image_pixels: u32,
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
                    Self::handle_do_execute(&op.operands, renderer, state, doc, resources, max_image_pixels);
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
        max_image_pixels: u32,
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
            Self::handle_image_execute(stream, renderer, state, doc, max_image_pixels);
            return;
        }
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
            let _ = Self::execute_internal(&content_bytes, renderer, state, doc, res, max_image_pixels);
        }
        state.restore();
    }

    /// Decode and draw an image XObject. When `max_decode_pixels > 0`,
    /// JPEGs are decoded at reduced resolution via turbojpeg's native
    /// scaled DCT decoding (1/2, 1/4, or 1/8) — this is done during the
    /// decode itself, avoiding full-resolution decode entirely. Non-JPEG
    /// images are decoded at full resolution then box-filtered down.
    fn handle_image_execute(
        stream: &lopdf::Stream,
        renderer: &mut SkiaRenderer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        max_decode_pixels: u32,
    ) {
        let dict = &stream.dict;
        let width = Self::read_int(dict, b"Width", doc).unwrap_or(0);
        let height = Self::read_int(dict, b"Height", doc).unwrap_or(0);
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
        let is_jpeg = filter_name == b"DCTDecode";

        // ─── JPEG: use turbojpeg with native scaled DCT decoding ─────────
        let (img_w, img_h, rgba) = if is_jpeg {
            let raw = &stream.content;
            match Self::decode_jpeg_scaled(raw, max_decode_pixels) {
                Some(result) => result,
                None => return,
            }
        } else {
            // ─── Non-JPEG: raw pixel decode + optional box downsample ────
            match Self::decode_raw_image(dict, stream, doc, width, height, max_decode_pixels) {
                Some(result) => result,
                None => return,
            }
        };

        state.save();
        state.concat_matrix(1.0, 0.0, 0.0, -1.0, 0.0, 1.0);
        renderer.draw_image(img_w, img_h, &rgba, &state.current);
        state.restore();
    }

    /// Read an integer from a PDF dict, resolving indirect references.
    fn read_int(dict: &Dictionary, key: &[u8], doc: &Document) -> Option<u32> {
        dict.get(key).ok().and_then(|o| match o {
            Object::Integer(i) => Some(*i as u32),
            Object::Reference(id) => doc.get_object(*id).ok().and_then(|o| {
                if let Object::Integer(i) = o { Some(*i as u32) } else { None }
            }),
            _ => None,
        })
    }

    /// Decode JPEG with optional pixel-budget downscaling.
    /// Strategy:
    ///  1. Try turbojpeg with native scaled DCT decoding (fastest)
    ///  2. Fall back to `image` crate + box downsample if turbojpeg fails
    fn decode_jpeg_scaled(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        // ─── Try turbojpeg native scaled decode ──────────────────────────
        if let Some(result) = Self::try_turbojpeg(jpeg_data, max_pixels) {
            return Some(result);
        }

        // ─── Fallback: image crate + post-decode downsample ──────────────
        let img = image::load_from_memory_with_format(jpeg_data, image::ImageFormat::Jpeg).ok()?;
        let img = img.to_rgba8();
        let (w, h) = (img.width(), img.height());
        let mut rgba = img.into_raw();

        // Downsample if over budget
        if max_pixels > 0 && w * h > max_pixels {
            let (new_w, new_h, small) = Self::box_downsample(&rgba, w, h, max_pixels);
            return Some((new_w, new_h, small));
        }
        Some((w, h, rgba))
    }

    /// Try turbojpeg native scaled DCT decode. Returns None on any failure.
    fn try_turbojpeg(jpeg_data: &[u8], max_pixels: u32) -> Option<(u32, u32, Vec<u8>)> {
        let mut dc = turbojpeg::Decompressor::new().ok()?;
        let header = dc.read_header(jpeg_data).ok()?;
        let full_w = header.width;
        let full_h = header.height;

        // Pick scaling factor that fits the pixel budget
        let chosen_factor = if max_pixels > 0 && (full_w * full_h) as u32 > max_pixels {
            let factors = turbojpeg::Decompressor::supported_scaling_factors();
            // factors are sorted largest-first (1/1, 7/8, 3/4, ..., 1/8)
            let mut picked = None;
            for &f in &factors {
                let sw = f.scale(full_w);
                let sh = f.scale(full_h);
                if sw > 0 && sh > 0 && (sw * sh) as u32 <= max_pixels {
                    picked = Some(f);
                    break;
                }
            }
            // If nothing fits, use the smallest
            if picked.is_none() {
                picked = factors.last().copied();
            }
            picked
        } else {
            None
        };

        if let Some(factor) = chosen_factor {
            dc.set_scaling_factor(factor).ok()?;
        }

        // Compute scaled output dimensions using the chosen factor
        let out_w = chosen_factor.map_or(full_w, |f| f.scale(full_w)).max(1);
        let out_h = chosen_factor.map_or(full_h, |f| f.scale(full_h)).max(1);

        let mut image = turbojpeg::Image {
            pixels: vec![0u8; out_w * out_h * 4],
            width: out_w,
            pitch: out_w * 4,
            height: out_h,
            format: turbojpeg::PixelFormat::RGBA,
        };

        dc.decompress(jpeg_data, image.as_deref_mut()).ok()?;
        Some((out_w as u32, out_h as u32, image.pixels))
    }

    /// Fast box-filter downsample of RGBA data to fit a pixel budget.
    fn box_downsample(rgba: &[u8], w: u32, h: u32, max_pixels: u32) -> (u32, u32, Vec<u8>) {
        let ratio = (max_pixels as f64 / (w as f64 * h as f64)).sqrt();
        let nw = ((w as f64 * ratio).ceil() as u32).max(1);
        let nh = ((h as f64 * ratio).ceil() as u32).max(1);
        let sx = w as f64 / nw as f64;
        let sy = h as f64 / nh as f64;
        let mut small = Vec::with_capacity((nw * nh * 4) as usize);
        for dy in 0..nh {
            for dx in 0..nw {
                let src_x = (dx as f64 * sx) as usize;
                let src_y = (dy as f64 * sy) as usize;
                let idx = (src_y * w as usize + src_x) * 4;
                if idx + 3 < rgba.len() {
                    small.extend_from_slice(&rgba[idx..idx + 4]);
                } else {
                    small.extend_from_slice(&[0, 0, 0, 255]);
                }
            }
        }
        (nw, nh, small)
    }

    /// Decode a non-JPEG image (raw/deflated pixel data) with optional
    /// box-filter downsampling when exceeding the pixel budget.
    fn decode_raw_image(
        dict: &Dictionary,
        stream: &lopdf::Stream,
        doc: &Document,
        width: u32,
        height: u32,
        max_pixels: u32,
    ) -> Option<(u32, u32, Vec<u8>)> {
        let bits = dict.get(b"BitsPerComponent").ok()
            .and_then(|o| if let Object::Integer(i) = o { Some(*i as u8) } else { None })
            .unwrap_or(8);
        if bits != 8 { return None; }

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

        let raw_pixels = stream.decompressed_content().ok()?;
        let expected = width as usize * height as usize * components;
        if raw_pixels.len() < expected { return None; }

        // Determine output size — downsample if over budget
        let (out_w, out_h, step_x, step_y) = if max_pixels > 0 && width * height > max_pixels {
            let ratio = (max_pixels as f64 / (width as f64 * height as f64)).sqrt();
            let nw = ((width as f64 * ratio).ceil() as u32).max(1);
            let nh = ((height as f64 * ratio).ceil() as u32).max(1);
            (nw, nh, width as f64 / nw as f64, height as f64 / nh as f64)
        } else {
            (width, height, 1.0, 1.0)
        };

        let mut rgba = Vec::with_capacity((out_w * out_h * 4) as usize);
        for dy in 0..out_h {
            for dx in 0..out_w {
                let src_x = (dx as f64 * step_x) as usize;
                let src_y = (dy as f64 * step_y) as usize;
                let idx = (src_y * width as usize + src_x) * components;
                match components {
                    1 => {
                        let g = raw_pixels[idx];
                        rgba.extend_from_slice(&[g, g, g, 255]);
                    }
                    3 => {
                        rgba.extend_from_slice(&[raw_pixels[idx], raw_pixels[idx+1], raw_pixels[idx+2], 255]);
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
                    }
                    _ => { rgba.extend_from_slice(&[0, 0, 0, 255]); }
                }
            }
        }
        Some((out_w, out_h, rgba))
    }

    pub fn extract_commands(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        Self::extract_commands_with_text(content_bytes, buf, state, doc, resources, font_registry, None)
    }

    pub fn extract_commands_with_text(
        content_bytes: &[u8],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        mut text_spans: Option<&mut Vec<TextSpan>>,
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
                // Clipping — apply current path as clipping region
                "W" => {
                    buf.clip();
                }
                "W*" => {
                    buf.clip_even_odd();
                }
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
                            // get_font now returns Arc<FontEntry> from a
                            // document-scoped cache. Cheap for shared fonts
                            // already seen on previous pages.
                            if let Some(font_entry) = font_registry.get_font(
                                &text_state.current_font_name, doc, resources,
                            ) {
                                // Capture position before rendering for text span
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if font_entry.is_cid && font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_cid_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_cid_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_cid_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                } else if font_entry.parsed.is_some() {
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        if !decoded.trim().is_empty() {
                                            let pre_x = text_state.tm[4];
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        } else {
                                            crate::text_renderer::render_text_glyphs(
                                                bytes, &*font_entry, text_state.font_size,
                                                text_state.horizontal_scaling, text_state.char_spacing,
                                                text_state.word_spacing, text_state.rise,
                                                &mut text_state.tm, rgba, buf,
                                            );
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
                                }
                                // No parsed font data → skip (TextAt
                                // fallback would mis-position the text).
                            }
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        let (r, g, b, a) = state.current.fill_color;
                        let rgba = Self::color_to_u32(r, g, b, a);
                        // Fetch the font ONCE for the whole TJ array — Arc
                        // makes it trivial to hold across the loop instead
                        // of re-fetching per string like the old code did.
                        let font_entry_opt = font_registry.get_font(
                            &text_state.current_font_name, doc, resources,
                        );
                        if let Some(font_entry) = font_entry_opt {
                            if font_entry.parsed.is_some() {
                                let is_cid = font_entry.is_cid;
                                // For TJ arrays, collect all string parts into one span per run
                                let collecting = text_spans.is_some();
                                let mut run_text = if collecting { String::new() } else { String::new() };
                                let run_start_x = text_state.render_x();
                                let run_start_y = text_state.render_y();
                                let pre_x = text_state.tm[4];

                                for item in arr {
                                    match item {
                                        Object::String(bytes, _) => {
                                            if !bytes.is_empty() {
                                                if collecting {
                                                    if is_cid {
                                                        run_text.push_str(&Self::decode_cid_text(bytes, &*font_entry));
                                                    } else {
                                                        run_text.push_str(&Self::decode_simple_text(bytes, &*font_entry));
                                                    }
                                                }
                                                if is_cid {
                                                    crate::text_renderer::render_cid_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
                                                        text_state.horizontal_scaling, text_state.char_spacing,
                                                        text_state.word_spacing, text_state.rise,
                                                        &mut text_state.tm, rgba, buf,
                                                    );
                                                } else {
                                                    crate::text_renderer::render_text_glyphs(
                                                        bytes, &*font_entry, text_state.font_size,
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

                                if let Some(ref mut spans) = text_spans {
                                    if !run_text.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: run_start_x, y: run_start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: run_text,
                                        });
                                    }
                                }
                            }
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
                                let start_x = text_state.render_x();
                                let start_y = text_state.render_y();
                                if let Some(ref mut spans) = text_spans {
                                    let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                    let pre_x = text_state.tm[4];
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                    if !decoded.trim().is_empty() {
                                        let width = (text_state.tm[4] - pre_x).abs();
                                        spans.push(TextSpan {
                                            x: start_x, y: start_y,
                                            width, height: text_state.font_size.abs(),
                                            font_size: text_state.font_size.abs(),
                                            text: decoded,
                                        });
                                    }
                                } else {
                                    crate::text_renderer::render_text_glyphs(
                                        bytes, &*font_entry, text_state.font_size,
                                        text_state.horizontal_scaling, text_state.char_spacing,
                                        text_state.word_spacing, text_state.rise,
                                        &mut text_state.tm, rgba, buf,
                                    );
                                }
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
                                    let start_x = text_state.render_x();
                                    let start_y = text_state.render_y();
                                    if let Some(ref mut spans) = text_spans {
                                        let decoded = Self::decode_simple_text(bytes, &*font_entry);
                                        let pre_x = text_state.tm[4];
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                        if !decoded.trim().is_empty() {
                                            let width = (text_state.tm[4] - pre_x).abs();
                                            spans.push(TextSpan {
                                                x: start_x, y: start_y,
                                                width, height: text_state.font_size.abs(),
                                                font_size: text_state.font_size.abs(),
                                                text: decoded,
                                            });
                                        }
                                    } else {
                                        crate::text_renderer::render_text_glyphs(
                                            bytes, &*font_entry, text_state.font_size,
                                            text_state.horizontal_scaling, text_state.char_spacing,
                                            text_state.word_spacing, text_state.rise,
                                            &mut text_state.tm, rgba, buf,
                                        );
                                    }
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
                    Self::handle_do_extract_with_text(&op.operands, buf, state, doc, resources, font_registry, text_spans.as_deref_mut());
                }
                "gs" | "ri" | "i" => {}
                _ => {}
            }
        }
        Ok(())
    }

    /// Decode single-byte text bytes to Unicode using font ToUnicode map or encoding
    fn decode_simple_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        for &b in bytes {
            if let Some(&ch) = font_entry.to_unicode.get(&b) {
                result.push(ch);
            } else if font_entry.encoding_name.is_some() || !font_entry.differences.is_empty() {
                let ch = crate::encoding::resolve_char_code(
                    font_entry.encoding_name.as_deref(),
                    &font_entry.differences,
                    b,
                );
                result.push(ch);
            } else {
                // Fallback: interpret as Latin-1
                result.push(b as char);
            }
        }
        result
    }

    /// Decode CID (2-byte) text bytes to Unicode using font ToUnicode map
    fn decode_cid_text(bytes: &[u8], font_entry: &crate::fonts::FontEntry) -> String {
        let mut result = String::new();
        let mut i = 0;
        while i + 1 < bytes.len() {
            let hi = bytes[i];
            let lo = bytes[i + 1];
            i += 2;
            let cid = u16::from_be_bytes([hi, lo]);
            // Try CID-specific ToUnicode map first (2-byte keys)
            if let Some(&ch) = font_entry.cid_to_unicode.get(&cid) {
                result.push(ch);
            } else if let Some(&ch) = font_entry.to_unicode.get(&(cid as u8)) {
                // Fallback to single-byte ToUnicode (for codes <= 255)
                result.push(ch);
            } else {
                // Treat 2-byte value as Unicode codepoint directly (Identity-H)
                let codepoint = cid as u32;
                if let Some(ch) = char::from_u32(codepoint) {
                    if !ch.is_control() || ch == ' ' {
                        result.push(ch);
                    }
                }
            }
        }
        result
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
        Self::handle_do_extract_with_text(operands, buf, state, doc, resources, font_registry, None);
    }

    fn handle_do_extract_with_text(
        operands: &[Object],
        buf: &mut DrawCommandBuffer,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
        text_spans: Option<&mut Vec<TextSpan>>,
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
            let _ = Self::extract_commands_with_text(&content_bytes, buf, state, doc, res, font_registry, text_spans);
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

    /// Walk a content stream and emit one TextSpan per Tj/TJ run.
    /// Lighter than extract_commands — only the operators that affect text
    /// position or content are processed; path/color/image ops are skipped.
    pub fn extract_text_only(
        content_bytes: &[u8],
        spans: &mut Vec<crate::TextSpan>,
        state: &mut GraphicsStateStack,
        doc: &Document,
        resources: &Dictionary,
        font_registry: &mut crate::fonts::FontRegistry,
    ) -> Result<(), RenderError> {
        let content = Content::decode(content_bytes)
            .map_err(|e| RenderError::ParseError(format!("Content decode: {}", e)))?;

        let mut text_state = TextState::new();

        for op in &content.operations {
            match op.operator.as_str() {
                // Graphics state stack — only CTM matters for text positioning.
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
                // Text state operators
                "BT" => text_state.begin_text(),
                "ET" => text_state.in_text = false,
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
                    if let Some(v) = op.operands.first() { text_state.leading = Self::f(v); }
                }
                "Td" => {
                    if op.operands.len() >= 2 {
                        text_state.translate_line(Self::f(&op.operands[0]), Self::f(&op.operands[1]));
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
                            Self::f(&op.operands[0]), Self::f(&op.operands[1]),
                            Self::f(&op.operands[2]), Self::f(&op.operands[3]),
                            Self::f(&op.operands[4]), Self::f(&op.operands[5]),
                        );
                    }
                }
                "T*" => text_state.translate_line(0.0, -text_state.leading),
                "Tc" => {
                    if let Some(v) = op.operands.first() { text_state.char_spacing = Self::f(v); }
                }
                "Tw" => {
                    if let Some(v) = op.operands.first() { text_state.word_spacing = Self::f(v); }
                }
                "Tz" => {
                    if let Some(v) = op.operands.first() { text_state.horizontal_scaling = Self::f(v) / 100.0; }
                }
                "Ts" => {
                    if let Some(v) = op.operands.first() { text_state.rise = Self::f(v); }
                }
                "Tj" => {
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "TJ" => {
                    if let Some(Object::Array(arr)) = op.operands.first() {
                        for item in arr {
                            match item {
                                Object::String(bytes, _) => {
                                    if !bytes.is_empty() {
                                        Self::emit_text_span(
                                            bytes, &mut text_state, font_registry, doc, resources,
                                            state, spans,
                                        );
                                    }
                                }
                                Object::Integer(_) | Object::Real(_) => {
                                    text_state.apply_tj_kern(Self::f(item));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                "'" => {
                    text_state.translate_line(0.0, -text_state.leading);
                    if let Some(Object::String(bytes, _)) = op.operands.first() {
                        if !bytes.is_empty() {
                            Self::emit_text_span(
                                bytes, &mut text_state, font_registry, doc, resources,
                                state, spans,
                            );
                        }
                    }
                }
                "\"" => {
                    if op.operands.len() >= 3 {
                        text_state.word_spacing = Self::f(&op.operands[0]);
                        text_state.char_spacing = Self::f(&op.operands[1]);
                        text_state.translate_line(0.0, -text_state.leading);
                        if let Object::String(bytes, _) = &op.operands[2] {
                            if !bytes.is_empty() {
                                Self::emit_text_span(
                                    bytes, &mut text_state, font_registry, doc, resources,
                                    state, spans,
                                );
                            }
                        }
                    }
                }
                // Form XObjects can contain nested text — recurse into them.
                "Do" => {
                    Self::handle_do_text_only(&op.operands, spans, state, doc, resources, font_registry);
                }
                _ => {} // skip path/color/image/everything else
            }
        }
        Ok(())
    }

    /// Helper: process one Tj/TJ string run and emit a TextSpan.
    /// Captures the start text-matrix, advances tm by each glyph's width,
    /// then computes the final user-space bbox by transforming through the
    /// current CTM. Decodes bytes to text via the font's ToUnicode CMap
    /// (falls back to Latin-1 / WinAnsi for fonts without ToUnicode).
    fn emit_text_span(
        bytes: &[u8],
        text_state: &mut TextState,
        font_registry: &mut crate::fonts::FontRegistry,
        doc: &Document,
        resources: &Dictionary,
        state: &GraphicsStateStack,
        spans: &mut Vec<crate::TextSpan>,
    ) {
        // Capture the start position in text space (BEFORE we advance tm).
        let start_tx = text_state.tm[4];
        let start_ty = text_state.tm[5];

        // Resolve font + decode text content. get_font returns Arc<FontEntry>;
        // we hold the Arc for the duration of this run so cache lookups are
        // a single refcount bump.
        let font_arc = font_registry.get_font(&text_state.current_font_name, doc, resources);
        let mut decoded = String::new();
        let mut total_advance_text_units: f32 = 0.0;

        if let Some(font_entry) = font_arc.as_deref() {
            if font_entry.is_cid {
                // Type0 / 2-byte CID font — process two bytes at a time.
                let mut i = 0;
                while i + 1 < bytes.len() {
                    let cid = u16::from_be_bytes([bytes[i], bytes[i + 1]]);
                    i += 2;
                    // ToUnicode for CID fonts is currently truncated to u8 in
                    // this codebase — best-effort decode for low CIDs.
                    if let Some(ch) = font_entry.to_unicode.get(&(cid as u8)) {
                        decoded.push(*ch);
                    } else {
                        decoded.push('\u{FFFD}');
                    }
                    let w0 = 0.5; // approximate em width — good enough for hit-testing
                    let tw = if cid == 32 || cid == 3 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            } else {
                // Single-byte font — decode each byte and advance precisely.
                let parsed_opt = font_entry.parsed.as_ref();
                for &byte in bytes {
                    let ch = if let Some(&c) = font_entry.to_unicode.get(&byte) {
                        c
                    } else {
                        crate::encoding::resolve_char_code(
                            font_entry.encoding_name.as_deref(),
                            &font_entry.differences,
                            byte,
                        )
                    };
                    decoded.push(ch);

                    let w0 = if let Some(parsed) = parsed_opt {
                        if let Some(gid) = crate::fonts::FontRegistry::char_to_glyph_id(font_entry, byte) {
                            if let Some(g) = parsed.glyphs.get(&gid) {
                                g.advance_width / parsed.units_per_em as f32
                            } else { 0.5 }
                        } else { 0.5 }
                    } else { 0.5 };
                    let tw = if byte == 32 { text_state.word_spacing } else { 0.0 };
                    let tx = (w0 * text_state.font_size + text_state.char_spacing + tw) * text_state.horizontal_scaling;
                    total_advance_text_units += tx;
                    text_state.tm[4] += tx * text_state.tm[0];
                    text_state.tm[5] += tx * text_state.tm[1];
                }
            }
        } else {
            // No font resolved — still advance the matrix so subsequent text
            // operators see a sensible position.
            for _ in bytes {
                let tx = 0.5 * text_state.font_size * text_state.horizontal_scaling;
                total_advance_text_units += tx;
                text_state.tm[4] += tx * text_state.tm[0];
                text_state.tm[5] += tx * text_state.tm[1];
            }
        }

        if decoded.is_empty() {
            return;
        }

        // Transform the start position from text space → user space via CTM.
        // Text space already has tm baked in; for the SPAN ORIGIN we apply CTM.
        let ctm = state.current.ctm;
        let user_x = start_tx * ctm.sx + start_ty * ctm.kx + ctm.tx;
        let user_y = start_tx * ctm.ky + start_ty * ctm.sy + ctm.ty;

        // Effective font size in user space ≈ Tfs × |CTM scale|.
        let ctm_scale = (ctm.sx * ctm.sx + ctm.ky * ctm.ky).sqrt().abs();
        let font_size_user = text_state.font_size * ctm_scale;

        // Width in user space: project the total text-space advance through
        // tm (text matrix) and CTM. The span advances along (tm[0], tm[1])
        // in text space, so the user-space delta is that vector × CTM.
        let dtx = total_advance_text_units * text_state.tm[0];
        let dty = total_advance_text_units * text_state.tm[1];
        let du_x = dtx * ctm.sx + dty * ctm.kx;
        let du_y = dtx * ctm.ky + dty * ctm.sy;
        let width_user = (du_x * du_x + du_y * du_y).sqrt();

        spans.push(crate::TextSpan {
            text: decoded,
            x: user_x,
            y: user_y,
            width: width_user,
            height: font_size_user,
            font_size: font_size_user,
        });
    }

    /// Recurse into a Form XObject for text-only extraction.
    fn handle_do_text_only(
        operands: &[Object],
        spans: &mut Vec<crate::TextSpan>,
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
            let _ = Self::extract_text_only(&content_bytes, spans, state, doc, res, font_registry);
        }
        state.restore();
    }
}
