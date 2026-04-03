use std::collections::HashMap;
use lopdf::{Dictionary, Document, Object};
use crate::encoding;
use crate::font_parser::{self, ParsedFont};

/// Cached font entry with parsed outlines and encoding info.
pub struct FontEntry {
    pub parsed: Option<ParsedFont>,
    pub encoding_name: Option<String>,
    pub differences: HashMap<u8, String>,
    pub base_font: String,
    /// True for Type0/CID fonts — character codes are 2-byte, not 1-byte
    pub is_cid: bool,
    /// True when CIDToGIDMap is Identity (CID values = glyph IDs directly)
    pub cid_to_gid_identity: bool,
}

/// Registry that caches font lookups per font name.
pub struct FontRegistry {
    fonts: HashMap<String, FontEntry>,
}

impl FontRegistry {
    pub fn new() -> Self {
        FontRegistry {
            fonts: HashMap::new(),
        }
    }

    /// Look up a font by name from the page Resources/Font dictionary.
    /// Caches results so each font is only parsed once.
    pub fn get_font<'a>(
        &'a mut self,
        name: &str,
        doc: &Document,
        resources: &Dictionary,
    ) -> Option<&'a FontEntry> {
        if self.fonts.contains_key(name) {
            return self.fonts.get(name);
        }

        // Look up font dictionary from Resources -> Font -> <name>
        let font_dict = Self::resolve_font_dict(name, doc, resources)?;

        // Extract base font name
        let base_font = font_dict
            .get(b"BaseFont")
            .ok()
            .and_then(|o| Self::resolve_obj(o, doc))
            .and_then(|o| match o {
                Object::Name(n) => Some(String::from_utf8_lossy(&n).to_string()),
                _ => None,
            })
            .unwrap_or_default();

        // Detect Type0/CID fonts
        let subtype = font_dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| Self::resolve_obj(o, doc))
            .and_then(|o| match o {
                Object::Name(n) => Some(n),
                _ => None,
            });
        let is_cid = subtype.as_deref() == Some(b"Type0");

        // Check CIDToGIDMap for Type0 fonts
        let cid_to_gid_identity = if is_cid {
            Self::check_cid_to_gid_identity(&font_dict, doc)
        } else {
            false
        };

        // Extract encoding info
        let (encoding_name, differences) = Self::extract_encoding(&font_dict, doc);

        // Try to extract and parse embedded font data
        let mut parsed = Self::extract_and_parse_font(&font_dict, doc);

        // Fallback: if no embedded font, try loading the system font
        if parsed.is_none() {
            parsed = Self::try_system_font(&base_font);
        }

        // For Type0 fonts with DescendantFonts, also check the descendant for embedded data
        if parsed.is_none() && is_cid {
            parsed = Self::extract_descendant_font(&font_dict, doc);
        }

        let entry = FontEntry {
            parsed,
            encoding_name,
            differences,
            base_font,
            is_cid,
            cid_to_gid_identity,
        };

        self.fonts.insert(name.to_string(), entry);
        self.fonts.get(name)
    }

    /// Resolve a character code to a glyph ID using the font entry.
    pub fn char_to_glyph_id(entry: &FontEntry, char_code: u8) -> Option<u16> {
        let parsed = entry.parsed.as_ref()?;

        // Resolve byte to Unicode character
        let ch = encoding::resolve_char_code(
            entry.encoding_name.as_deref(),
            &entry.differences,
            char_code,
        );

        // Look up in cmap
        let codepoint = ch as u32;
        parsed.cmap.get(&codepoint).copied()
    }

    /// Resolve the Font dictionary for a given font name from resources.
    fn resolve_font_dict(name: &str, doc: &Document, resources: &Dictionary) -> Option<Dictionary> {
        let font_res = resources.get(b"Font").ok()?;
        let font_res = Self::resolve_obj(font_res, doc)?;
        let font_dict_parent = match font_res {
            Object::Dictionary(d) => d.clone(),
            _ => return None,
        };

        let font_obj = font_dict_parent.get(name.as_bytes()).ok()?;
        let font_obj = Self::resolve_obj(font_obj, doc)?;
        match font_obj {
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        }
    }

    /// Extract encoding name and Differences array from font dictionary.
    fn extract_encoding(
        font_dict: &Dictionary,
        doc: &Document,
    ) -> (Option<String>, HashMap<u8, String>) {
        let enc_obj = match font_dict.get(b"Encoding") {
            Ok(o) => Self::resolve_obj(o, doc),
            Err(_) => None,
        };

        match enc_obj {
            Some(Object::Name(n)) => {
                let name = String::from_utf8_lossy(&n).to_string();
                (Some(name), HashMap::new())
            }
            Some(Object::Dictionary(d)) => {
                let enc_name = d
                    .get(b"BaseEncoding")
                    .ok()
                    .and_then(|o| Self::resolve_obj(o, doc))
                    .and_then(|o| match o {
                        Object::Name(n) => Some(String::from_utf8_lossy(&n).to_string()),
                        _ => None,
                    });

                let diffs = d
                    .get(b"Differences")
                    .ok()
                    .and_then(|o| Self::resolve_obj(o, doc))
                    .and_then(|o| match o {
                        Object::Array(arr) => Some(encoding::parse_differences(&arr)),
                        _ => None,
                    })
                    .unwrap_or_default();

                (enc_name, diffs)
            }
            _ => (None, HashMap::new()),
        }
    }

    /// Try to extract embedded font data (FontFile2 or FontFile3) and parse it.
    fn extract_and_parse_font(font_dict: &Dictionary, doc: &Document) -> Option<ParsedFont> {
        // Get FontDescriptor
        let desc_obj = font_dict.get(b"FontDescriptor").ok()?;
        let desc_obj = Self::resolve_obj(desc_obj, doc)?;
        let desc = match desc_obj {
            Object::Dictionary(d) => d,
            _ => return None,
        };

        // Try FontFile2 (TrueType), then FontFile3 (CFF/OpenType)
        let font_stream_obj = desc
            .get(b"FontFile2")
            .or_else(|_| desc.get(b"FontFile3"))
            .ok()?;

        let font_data = Self::get_stream_data(font_stream_obj, doc)?;

        match font_parser::parse_truetype(&font_data) {
            Ok(parsed) => Some(parsed),
            Err(_) => None,
        }
    }

    /// Check if CIDToGIDMap is /Identity in the DescendantFont
    fn check_cid_to_gid_identity(font_dict: &Dictionary, doc: &Document) -> bool {
        let desc_fonts = match font_dict.get(b"DescendantFonts") {
            Ok(o) => Self::resolve_obj(o, doc),
            _ => return false,
        };
        let arr = match desc_fonts {
            Some(Object::Array(a)) => a,
            _ => return false,
        };
        let first = match arr.first() {
            Some(o) => Self::resolve_obj(o, doc),
            None => return false,
        };
        let cid_dict = match first {
            Some(Object::Dictionary(d)) => d,
            _ => return false,
        };
        // Check CIDToGIDMap
        match cid_dict.get(b"CIDToGIDMap") {
            Ok(obj) => {
                match Self::resolve_obj(obj, doc) {
                    Some(Object::Name(n)) => n == b"Identity",
                    _ => false,
                }
            }
            _ => false,
        }
    }

    /// Extract font from DescendantFonts array (for Type0 fonts)
    fn extract_descendant_font(font_dict: &Dictionary, doc: &Document) -> Option<ParsedFont> {
        let desc_fonts = Self::resolve_obj(font_dict.get(b"DescendantFonts").ok()?, doc)?;
        let arr = match desc_fonts {
            Object::Array(a) => a,
            _ => return None,
        };
        let first = Self::resolve_obj(arr.first()?, doc)?;
        let cid_dict = match first {
            Object::Dictionary(d) => d,
            _ => return None,
        };
        // Try to get embedded font from the descendant's FontDescriptor
        Self::extract_and_parse_font(&cid_dict, doc)
    }

    /// Try to load a system font matching the PDF BaseFont name.
    /// Strips subset prefix (e.g., "ESYDQT+SegoeUI-Bold" → "SegoeUI-Bold")
    /// then maps to Windows font files.
    fn try_system_font(base_font: &str) -> Option<ParsedFont> {
        // Strip subset prefix: 6 uppercase letters + '+'
        let clean_name = if base_font.len() > 7 && base_font.as_bytes()[6] == b'+' {
            &base_font[7..]
        } else {
            base_font
        };

        // Try to find system font file
        let font_path = Self::find_system_font(clean_name)?;
        let font_data = std::fs::read(&font_path).ok()?;
        match font_parser::parse_truetype(&font_data) {
            Ok(parsed) => {
                eprintln!("[fonts] Loaded system font: {} → {}", clean_name, font_path);
                Some(parsed)
            }
            Err(e) => {
                eprintln!("[fonts] Failed to parse system font {}: {}", font_path, e);
                None
            }
        }
    }

    /// Find a system font file matching a PDF font name.
    /// Maps names like "SegoeUI-Bold" to "C:\Windows\Fonts\segoeuib.ttf"
    fn find_system_font(name: &str) -> Option<String> {
        let fonts_dir = r"C:\Windows\Fonts";

        // Normalize: lowercase, remove hyphens/spaces
        let normalized = name.to_lowercase().replace('-', "").replace(' ', "");

        // Common font name → file mappings
        let candidates = Self::font_name_to_files(&normalized);

        for candidate in &candidates {
            let path = format!("{}\\{}", fonts_dir, candidate);
            if std::path::Path::new(&path).exists() {
                return Some(path);
            }
        }

        // Brute-force: scan fonts directory for matching name
        if let Ok(entries) = std::fs::read_dir(fonts_dir) {
            let search = normalized.replace("bold", "").replace("italic", "")
                .replace("regular", "").replace("light", "");
            for entry in entries.flatten() {
                let filename = entry.file_name().to_string_lossy().to_lowercase();
                if filename.ends_with(".ttf") || filename.ends_with(".ttc") {
                    let stem = filename.trim_end_matches(".ttf").trim_end_matches(".ttc");
                    if stem.contains(&search) || search.contains(stem) {
                        return Some(entry.path().to_string_lossy().to_string());
                    }
                }
            }
        }

        None
    }

    /// Map normalized PDF font names to possible Windows font file names
    fn font_name_to_files(normalized: &str) -> Vec<String> {
        let mut files = Vec::new();

        // Segoe UI family
        if normalized.contains("segoeui") {
            if normalized.contains("bold") && normalized.contains("italic") {
                files.push("segoeuiz.ttf".to_string());
            } else if normalized.contains("bold") {
                files.push("segoeuib.ttf".to_string());
            } else if normalized.contains("italic") {
                files.push("segoeuii.ttf".to_string());
            } else {
                files.push("segoeui.ttf".to_string());
            }
        }
        // Arial family
        if normalized.contains("arial") {
            if normalized.contains("bold") && normalized.contains("italic") {
                files.push("arialbi.ttf".to_string());
            } else if normalized.contains("bold") {
                files.push("arialbd.ttf".to_string());
            } else if normalized.contains("italic") {
                files.push("ariali.ttf".to_string());
            } else {
                files.push("arial.ttf".to_string());
            }
        }
        // Times New Roman
        if normalized.contains("timesnewroman") || normalized.contains("times") {
            if normalized.contains("bold") && normalized.contains("italic") {
                files.push("timesbi.ttf".to_string());
            } else if normalized.contains("bold") {
                files.push("timesbd.ttf".to_string());
            } else if normalized.contains("italic") {
                files.push("timesi.ttf".to_string());
            } else {
                files.push("times.ttf".to_string());
            }
        }
        // Courier New
        if normalized.contains("courier") {
            if normalized.contains("bold") {
                files.push("courbd.ttf".to_string());
            } else {
                files.push("cour.ttf".to_string());
            }
        }
        // Helvetica → Arial on Windows
        if normalized.contains("helvetica") {
            if normalized.contains("bold") {
                files.push("arialbd.ttf".to_string());
            } else {
                files.push("arial.ttf".to_string());
            }
        }
        // Calibri
        if normalized.contains("calibri") {
            if normalized.contains("bold") {
                files.push("calibrib.ttf".to_string());
            } else if normalized.contains("italic") {
                files.push("calibrii.ttf".to_string());
            } else {
                files.push("calibri.ttf".to_string());
            }
        }

        // Generic: try the normalized name directly
        files.push(format!("{}.ttf", normalized));

        files
    }

    /// Resolve a CID (2-byte character code) to a glyph ID for Type0/CID fonts.
    /// With Identity-H + CIDToGIDMap=Identity: CID maps directly to glyph ID.
    pub fn cid_to_glyph_id(entry: &FontEntry, cid: u16) -> Option<u16> {
        let parsed = entry.parsed.as_ref()?;
        if entry.cid_to_gid_identity {
            // Direct mapping: CID = GID
            if parsed.glyphs.contains_key(&cid) {
                Some(cid)
            } else {
                None
            }
        } else {
            // Try Unicode lookup: CID might be a Unicode codepoint
            parsed.cmap.get(&(cid as u32)).copied()
        }
    }

    /// Get decompressed stream data from an object (possibly a reference).
    fn get_stream_data(obj: &Object, doc: &Document) -> Option<Vec<u8>> {
        let resolved = Self::resolve_obj(obj, doc)?;
        match resolved {
            Object::Stream(stream) => stream.decompressed_content().ok(),
            _ => None,
        }
    }

    /// Resolve an object reference, following indirect references.
    fn resolve_obj(obj: &Object, doc: &Document) -> Option<Object> {
        match obj {
            Object::Reference(id) => doc.get_object(*id).ok().cloned(),
            other => Some(other.clone()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_font_registry_new() {
        let registry = FontRegistry::new();
        assert!(registry.fonts.is_empty());
    }

    #[test]
    fn test_char_to_glyph_id_no_parsed_font() {
        let entry = FontEntry {
            parsed: None,
            encoding_name: None,
            differences: HashMap::new(),
            base_font: "TestFont".to_string(),
            is_cid: false,
            cid_to_gid_identity: false,
        };
        assert_eq!(FontRegistry::char_to_glyph_id(&entry, b'A'), None);
    }
}
