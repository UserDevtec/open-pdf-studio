use crate::font_parser::OutlineCommand;
use crate::fonts::{FontEntry, FontRegistry};
use crate::draw_commands::DrawCommandBuffer;

/// Render a text string as vector glyph outlines.
///
/// PDF text positioning follows this model:
///   Text Rendering Matrix (Trm) = [fontSize 0 0 fontSize 0 0] × Tm × CTM
///
/// Since CTM is already applied via the graphics state transform commands in the
/// draw buffer, we only need to apply: Tm (text matrix) × font scaling.
///
/// `font_size`: the raw Tf size
/// `tm`: the full text matrix [a, b, c, d, e, f] (set by Tm/Td/TD operators)
/// `tx`, `ty`: accumulated text position offsets (from Td/character advances)
pub fn render_text_glyphs(
    text_bytes: &[u8],
    font_entry: &FontEntry,
    font_size: f32,
    tm: &[f32; 6],
    tx: f32,
    ty: f32,
    fill_rgba: u32,
    buf: &mut DrawCommandBuffer,
) -> f32 {
    let parsed = match &font_entry.parsed {
        Some(p) => p,
        None => return 0.0,
    };

    // Glyph coordinates are in font units (typically 1000 or 2048 units per em).
    // Scale to PDF user space: multiply by fontSize / unitsPerEm.
    let s = font_size / parsed.units_per_em as f32;

    // Text position in the current coordinate space (CTM already applied via draw commands)
    // Tm provides additional positioning: e=x offset, f=y offset, plus rotation/scale in a-d
    let base_x = tm[4] + tx;
    let base_y = tm[5] + ty;

    let mut cursor = 0.0f32; // horizontal advance in PDF user space

    for &byte in text_bytes {
        let glyph_id = match FontRegistry::char_to_glyph_id(font_entry, byte) {
            Some(id) => id,
            None => continue,
        };
        if let Some(outline) = parsed.glyphs.get(&glyph_id) {
            if !outline.commands.is_empty() {
                // Per-glyph transform: translate to position, then scale from font units to PDF units
                // The text matrix a/b/c/d components handle rotation/scaling of the text itself
                // For most PDF text, tm = [1,0,0,1,x,y] (identity rotation, just positioning)
                //
                // Full glyph transform matrix:
                //   | tm[0]*s  tm[1]*s  0 |
                //   | tm[2]*s  tm[3]*s  0 |
                //   | gx       gy       1 |
                //
                // Where gx, gy = base position + cursor advance along text direction
                let gx = base_x + cursor * tm[0];
                let gy = base_y + cursor * tm[1];

                buf.save_state();
                buf.transform(tm[0] * s, tm[1] * s, tm[2] * s, tm[3] * s, gx, gy);
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
            cursor += outline.advance_width * s;
        }
    }
    cursor
}
