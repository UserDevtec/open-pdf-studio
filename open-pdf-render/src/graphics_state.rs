use tiny_skia::Transform;

#[derive(Clone, Debug)]
pub struct GraphicsState {
    pub ctm: Transform,
    pub fill_color: (u8, u8, u8, u8),
    pub stroke_color: (u8, u8, u8, u8),
    pub line_width: f32,
    pub line_cap: u8,
    pub line_join: u8,
    pub miter_limit: f32,
    pub dash_array: Vec<f32>,
    pub dash_phase: f32,
    pub clip_path: Option<tiny_skia::Path>,
}

impl Default for GraphicsState {
    fn default() -> Self {
        GraphicsState {
            ctm: Transform::identity(),
            fill_color: (0, 0, 0, 255),
            stroke_color: (0, 0, 0, 255),
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

    pub fn save(&mut self) {
        self.stack.push(self.current.clone());
    }

    pub fn restore(&mut self) {
        if let Some(state) = self.stack.pop() {
            self.current = state;
        }
    }

    pub fn concat_matrix(&mut self, a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) {
        let new_transform = Transform::from_row(a, b, c, d, e, f);
        self.current.ctm = self.current.ctm.pre_concat(new_transform);
    }
}
