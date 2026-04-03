use crate::font_parser::OutlineCommand;
use crate::fonts::{FontEntry, FontRegistry};
use crate::draw_commands::DrawCommandBuffer;

/// Render a text string as vector glyph outlines.
///
/// PDF text rendering follows the spec §9.4.4 exactly:
///
///   Trm = [Tfs×Th  0      0] × [Tm] × [CTM]
///         [0       Tfs    0]
///         [0       Trise  1]
///
/// CTM is already applied via the graphics state transform commands in the draw buffer.
/// So we compute: Trm = [Tfs×Th 0; 0 Tfs; 0 Trise] × Tm
///
/// For each glyph:
/// 1. Compute rendering position from Trm (includes rise offset)
/// 2. Scale glyph outlines by 1/units_per_em (glyph coords → text space)
/// 3. Apply Trm rotation/scale components
/// 4. Emit path commands + fill
/// 5. Advance Tm: tx = (w0 × Tfs + Tc + Tw) × Th; Tm = [1 0 0 1 tx 0] × Tm
///
/// Parameters:
/// - `text_bytes`: raw bytes from the Tj/TJ string
/// - `font_entry`: the resolved font with parsed glyph data
/// - `font_size`: Tfs (from Tf operator)
/// - `horizontal_scaling`: Th (from Tz operator, 1.0 = 100%)
/// - `char_spacing`: Tc (from Tc operator)
/// - `word_spacing`: Tw (from Tw operator, applied to space char code 32)
/// - `rise`: Trise (from Ts operator)
/// - `tm`: text matrix [a b c d e f] — MUTATED with character advances
/// - `fill_rgba`: fill color
/// - `buf`: draw command buffer
pub fn render_text_glyphs(
    text_bytes: &[u8],
    font_entry: &FontEntry,
    font_size: f32,
    horizontal_scaling: f32,
    char_spacing: f32,
    word_spacing: f32,
    rise: f32,
    tm: &mut [f32; 6],
    fill_rgba: u32,
    buf: &mut DrawCommandBuffer,
) {
    let parsed = match &font_entry.parsed {
        Some(p) => p,
        None => return,
    };

    let upm = parsed.units_per_em as f32;

    for &byte in text_bytes {
        let glyph_id = match FontRegistry::char_to_glyph_id(font_entry, byte) {
            Some(id) => id,
            None => {
                // Unknown glyph — still advance by estimated width
                let w0 = 0.5; // fallback: half em
                let tw = if byte == 32 { word_spacing } else { 0.0 };
                let tx = (w0 * font_size + char_spacing + tw) * horizontal_scaling;
                tm[4] += tx * tm[0];
                tm[5] += tx * tm[1];
                continue;
            }
        };

        if let Some(outline) = parsed.glyphs.get(&glyph_id) {
            if !outline.commands.is_empty() {
                // Compute Trm components (without CTM — already in graphics state):
                // Trm_a = Tfs × Th × Tm[0] / upm
                // Trm_b = Tfs × Th × Tm[1] / upm
                // Trm_c = Tfs × Tm[2] / upm
                // Trm_d = Tfs × Tm[3] / upm
                // Trm_e = Trise × Tm[2] + Tm[4]  (render position x)
                // Trm_f = Trise × Tm[3] + Tm[5]  (render position y)
                let s = font_size / upm;
                let sh = s * horizontal_scaling;
                let gx = rise * tm[2] + tm[4];
                let gy = rise * tm[3] + tm[5];

                buf.save_state();
                buf.transform(sh * tm[0], sh * tm[1], s * tm[2], s * tm[3], gx, gy);
                buf.begin_path();
                for cmd in &outline.commands {
                    match cmd {
                        OutlineCommand::MoveTo(x, y) => buf.move_to(*x, *y),
                        OutlineCommand::LineTo(x, y) => buf.line_to(*x, *y),
                        OutlineCommand::CubicTo(x1, y1, x2, y2, x, y) => {
                            buf.cubic_to(*x1, *y1, *x2, *y2, *x, *y)
                        }
                        OutlineCommand::Close => buf.close_path(),
                    }
                }
                buf.set_fill(fill_rgba);
                buf.fill();
                buf.restore_state();
            }

            // Advance text matrix per PDF spec §9.4.4:
            // w0 = advance_width / units_per_em (displacement in text space)
            // tx = (w0 × Tfs + Tc + Tw) × Th
            // Tm = [1 0 0 1 tx 0] × Tm
            let w0 = outline.advance_width / upm;
            let tw = if byte == 32 { word_spacing } else { 0.0 };
            let tx = (w0 * font_size + char_spacing + tw) * horizontal_scaling;
            tm[4] += tx * tm[0];
            tm[5] += tx * tm[1];
        }
    }
}

/// Render CID-encoded text (Type0/CID fonts) — 2 bytes per character.
/// Used for Identity-H/Identity-V encoded fonts where each 2-byte value is a CID.
pub fn render_cid_text_glyphs(
    text_bytes: &[u8],
    font_entry: &FontEntry,
    font_size: f32,
    horizontal_scaling: f32,
    char_spacing: f32,
    word_spacing: f32,
    rise: f32,
    tm: &mut [f32; 6],
    fill_rgba: u32,
    buf: &mut DrawCommandBuffer,
) {
    let parsed = match &font_entry.parsed {
        Some(p) => p,
        None => return,
    };

    let upm = parsed.units_per_em as f32;

    // Process 2-byte character codes (big-endian)
    let mut i = 0;
    while i + 1 < text_bytes.len() {
        let cid = u16::from_be_bytes([text_bytes[i], text_bytes[i + 1]]);
        i += 2;

        let glyph_id = match FontRegistry::cid_to_glyph_id(font_entry, cid) {
            Some(id) => id,
            None => {
                // Unknown glyph — advance by estimated width
                let w0 = 0.5;
                let tx = (w0 * font_size + char_spacing) * horizontal_scaling;
                tm[4] += tx * tm[0];
                tm[5] += tx * tm[1];
                continue;
            }
        };

        if let Some(outline) = parsed.glyphs.get(&glyph_id) {
            if !outline.commands.is_empty() {
                let s = font_size / upm;
                let sh = s * horizontal_scaling;
                let gx = rise * tm[2] + tm[4];
                let gy = rise * tm[3] + tm[5];

                buf.save_state();
                buf.transform(sh * tm[0], sh * tm[1], s * tm[2], s * tm[3], gx, gy);
                buf.begin_path();
                for cmd in &outline.commands {
                    match cmd {
                        OutlineCommand::MoveTo(x, y) => buf.move_to(*x, *y),
                        OutlineCommand::LineTo(x, y) => buf.line_to(*x, *y),
                        OutlineCommand::CubicTo(x1, y1, x2, y2, x, y) => {
                            buf.cubic_to(*x1, *y1, *x2, *y2, *x, *y)
                        }
                        OutlineCommand::Close => buf.close_path(),
                    }
                }
                buf.set_fill(fill_rgba);
                buf.fill();
                buf.restore_state();
            }

            let w0 = outline.advance_width / upm;
            // CID space char is typically U+0020 = CID 3 (font-dependent)
            let tw = if cid == 3 || cid == 32 { word_spacing } else { 0.0 };
            let tx = (w0 * font_size + char_spacing + tw) * horizontal_scaling;
            tm[4] += tx * tm[0];
            tm[5] += tx * tm[1];
        }
    }
}
