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
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;
        let width = (w_pt * scale).ceil() as u32;
        let height = (h_pt * scale).ceil() as u32;

        let mut renderer = crate::renderer::SkiaRenderer::new(width, height)
            .map_err(|e| RenderError::RenderError(e))?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();

        // PDF coordinate system: origin at MediaBox bottom-left, Y up
        // Canvas: origin at top-left, Y down
        // Transform: translate(-x0, -y0) to shift MediaBox origin to (0,0),
        // then scale + flip Y axis
        // Combined: CTM = [scale, 0, 0, -scale, -x0*scale, (h_pt+y0)*scale]
        // Simplified: translate to canvas space accounting for non-zero MediaBox origin
        state.current.ctm = tiny_skia::Transform::from_row(
            scale, 0.0, 0.0, -scale,
            -x0 * scale, (h_pt + y0) * scale,
        );

        let content_bytes = self.get_content_stream(page_id)?;
        let resources = self.get_page_resources(page_id)?;
        crate::interpreter::Interpreter::execute(&content_bytes, &mut renderer, &mut state, &self.doc, &resources)?;

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

    // Returns (x0, y0, width, height) — origin can be non-zero!
    fn extract_media_box_full(&self, page_id: ObjectId) -> Result<(f32, f32, f32, f32), RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        // Use CropBox if available, otherwise MediaBox
        let box_arr = dict.get(b"CropBox")
            .or_else(|_| dict.get(b"MediaBox"))
            .map_err(|_| RenderError::ParseError("No MediaBox/CropBox".into()))?
            .as_array()
            .map_err(|_| RenderError::ParseError("Box not array".into()))?;

        let x0 = Self::obj_to_f32(&box_arr[0])?;
        let y0 = Self::obj_to_f32(&box_arr[1])?;
        let x1 = Self::obj_to_f32(&box_arr[2])?;
        let y1 = Self::obj_to_f32(&box_arr[3])?;
        Ok((x0, y0, (x1 - x0).abs(), (y1 - y0).abs()))
    }

    fn extract_media_box(&self, page_id: ObjectId) -> Result<(f32, f32), RenderError> {
        let (_, _, w, h) = self.extract_media_box_full(page_id)?;
        Ok((w, h))
    }

    fn get_page_resources(&self, page_id: ObjectId) -> Result<lopdf::Dictionary, RenderError> {
        let page_obj = self.doc.get_object(page_id)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
        let dict = page_obj.as_dict()
            .map_err(|_| RenderError::ParseError("Page is not a dict".into()))?;

        match dict.get(b"Resources") {
            Ok(res) => {
                match res {
                    lopdf::Object::Dictionary(d) => Ok(d.clone()),
                    lopdf::Object::Reference(id) => {
                        let resolved = self.doc.get_object(*id)
                            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;
                        resolved.as_dict()
                            .map(|d| d.clone())
                            .map_err(|_| RenderError::ParseError("Resources is not a dict".into()))
                    }
                    _ => Ok(lopdf::Dictionary::new()),
                }
            }
            Err(_) => Ok(lopdf::Dictionary::new()),
        }
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

    /// Analyze whether a page is pure vector or contains raster content (images/shading)
    pub fn analyze_page_type(&self, page: usize) -> Result<crate::PageType, RenderError> {
        let page_id = self.get_page_id(page)?;
        let content_bytes = self.get_content_stream(page_id)?;
        let content = lopdf::content::Content::decode(&content_bytes)
            .map_err(|e| RenderError::ParseError(format!("{}", e)))?;

        let mut has_raster_images = false;
        for op in &content.operations {
            match op.operator.as_str() {
                // Only classify as Tile if there are shading patterns
                // Do (XObjects) can be Form XObjects (vector) — we try vector mode first
                "sh" => has_raster_images = true,
                _ => {}
            }
        }
        if has_raster_images {
            Ok(crate::PageType::Tile)
        } else {
            Ok(crate::PageType::Vector)
        }
    }

    /// Extract draw commands without rendering to bitmap.
    /// Returns binary buffer with 16-byte header (f32 LE: x0, y0, pageW, pageH) + commands.
    /// x0/y0 is the MediaBox origin — can be non-zero (e.g. -846, -595).
    pub fn extract_draw_commands(&self, page: usize) -> Result<crate::DrawCommandBuffer, RenderError> {
        let page_id = self.get_page_id(page)?;
        let (x0, y0, w_pt, h_pt) = self.extract_media_box_full(page_id)?;
        let content_bytes = self.get_content_stream(page_id)?;

        let mut state = crate::graphics_state::GraphicsStateStack::new();
        let mut cmds = crate::draw_commands::DrawCommandBuffer::new();
        let resources = self.get_page_resources(page_id)?;
        let mut font_registry = crate::fonts::FontRegistry::new();
        crate::interpreter::Interpreter::extract_commands(&content_bytes, &mut cmds, &mut state, &self.doc, &resources, &mut font_registry)?;

        // Prepend 16-byte header: x0, y0, width, height (all f32 LE)
        let cmd_bytes = cmds.into_bytes();
        let mut result = Vec::with_capacity(16 + cmd_bytes.len());
        result.extend_from_slice(&x0.to_le_bytes());
        result.extend_from_slice(&y0.to_le_bytes());
        result.extend_from_slice(&w_pt.to_le_bytes());
        result.extend_from_slice(&h_pt.to_le_bytes());
        result.extend(cmd_bytes);

        Ok(crate::DrawCommandBuffer::from_vec(result))
    }
}
