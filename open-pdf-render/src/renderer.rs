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
        pixmap.fill(Color::WHITE);
        Ok(SkiaRenderer { pixmap, path_builder: None })
    }

    pub fn begin_path(&mut self) {
        self.path_builder = Some(PathBuilder::new());
    }

    pub fn move_to(&mut self, x: f32, y: f32) {
        if let Some(ref mut pb) = self.path_builder { pb.move_to(x, y); }
    }

    pub fn line_to(&mut self, x: f32, y: f32) {
        if let Some(ref mut pb) = self.path_builder { pb.line_to(x, y); }
    }

    pub fn cubic_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32) {
        if let Some(ref mut pb) = self.path_builder { pb.cubic_to(x1, y1, x2, y2, x3, y3); }
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
        if let Some(ref mut pb) = self.path_builder { pb.close(); }
    }

    pub fn fill(&mut self, gs: &GraphicsState, even_odd: bool) {
        let path = match self.path_builder.take() {
            Some(pb) => match pb.finish() { Some(p) => p, None => return },
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
            Some(pb) => match pb.finish() { Some(p) => p, None => return },
            None => return,
        };
        let mut paint = Paint::default();
        let (r, g, b, a) = gs.stroke_color;
        paint.set_color_rgba8(r, g, b, a);
        paint.anti_alias = true;

        let mut stroke = Stroke::default();
        stroke.width = gs.line_width;
        stroke.line_cap = match gs.line_cap { 1 => LineCap::Round, 2 => LineCap::Square, _ => LineCap::Butt };
        stroke.line_join = match gs.line_join { 1 => LineJoin::Round, 2 => LineJoin::Bevel, _ => LineJoin::Miter };
        stroke.miter_limit = gs.miter_limit;
        if !gs.dash_array.is_empty() {
            stroke.dash = StrokeDash::new(gs.dash_array.clone(), gs.dash_phase);
        }
        self.pixmap.stroke_path(&path, &paint, &stroke, gs.ctm, None);
    }

    pub fn fill_and_stroke(&mut self, gs: &GraphicsState, even_odd: bool) {
        if let Some(pb) = self.path_builder.take() {
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

    pub fn into_rgba(self) -> Vec<u8> {
        self.pixmap.data().to_vec()
    }
}
