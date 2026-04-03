use lopdf::ObjectId;
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
        let page_id = self.get_page_id(page)?;
        self.extract_media_box(page_id)
    }

    pub fn render_page(&self, page: usize, scale: f32) -> Result<RenderedPage, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (w_pt, h_pt) = self.extract_media_box(page_id)?;
        let width = (w_pt * scale).ceil() as u32;
        let height = (h_pt * scale).ceil() as u32;

        let mut renderer = crate::renderer::SkiaRenderer::new(width, height)
            .map_err(|e| RenderError::RenderError(e))?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // PDF coordinate system: origin at bottom-left, Y up
        // Canvas: origin at top-left, Y down
        // Transform: scale + flip Y axis
        state.current.ctm = tiny_skia::Transform::from_row(scale, 0.0, 0.0, -scale, 0.0, h_pt * scale);

        let content_bytes = self.get_content_stream(page_id)?;
        crate::interpreter::Interpreter::execute(&content_bytes, &mut renderer, &mut state)?;

        Ok(RenderedPage { width, height, rgba: renderer.into_rgba() })
    }

    fn get_page_id(&self, page: usize) -> Result<ObjectId, RenderError> {
        let pages = self.doc.get_pages();
        let mut sorted: Vec<_> = pages.iter().collect();
        sorted.sort_by_key(|(num, _)| *num);
        let (_, &page_id) = sorted.get(page)
            .ok_or_else(|| RenderError::ParseError(format!("Page {} not found", page)))?;
        Ok(page_id)
    }

    fn extract_media_box(&self, page_id: ObjectId) -> Result<(f32, f32), RenderError> {
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

    fn get_content_stream(&self, page_id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        let contents = match dict.get(b"Contents") {
            Ok(c) => c,
            Err(_) => return Ok(Vec::new()),
        };

        match contents {
            lopdf::Object::Reference(id) => {
                self.decode_stream(*id)
            }
            lopdf::Object::Array(arr) => {
                let mut all_bytes = Vec::new();
                for item in arr {
                    match item {
                        lopdf::Object::Reference(id) => {
                            let bytes = self.decode_stream(*id)?;
                            all_bytes.extend_from_slice(&bytes);
                            all_bytes.push(b'\n');
                        }
                        _ => {}
                    }
                }
                Ok(all_bytes)
            }
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Ok(Vec::new()),
        }
    }

    fn decode_stream(&self, id: ObjectId) -> Result<Vec<u8>, RenderError> {
        let obj = self.doc.get_object(id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        match obj {
            lopdf::Object::Stream(stream) => {
                stream.decompressed_content()
                    .map_err(|e| RenderError::ParseError(format!("Decompress: {}", e)))
            }
            _ => Err(RenderError::ParseError("Contents ref is not a stream".into())),
        }
    }

    fn obj_to_f32(obj: &lopdf::Object) -> Result<f32, RenderError> {
        match obj {
            lopdf::Object::Real(r) => Ok(*r as f32),
            lopdf::Object::Integer(i) => Ok(*i as f32),
            _ => Err(RenderError::ParseError("Expected number".into())),
        }
    }
}
