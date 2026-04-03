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
