import { state, getPageRotation, getActiveDocument } from '../core/state.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { hexToColorArray } from '../utils/colors.js';
import { markDocumentSaved, updateWindowTitle } from '../ui/chrome/tabs.js';
import { isTauri, readBinaryFile, writeBinaryFile, saveFileDialog, unlockFile, lockFile } from '../core/platform.js';
import { getCachedPdfBytes, setCachedPdfBytes, hidePdfABar } from './loader.js';
import { PDFDocument, PDFString, PDFName, PDFArray, PDFStream, degrees,
  PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList } from 'pdf-lib';
import { getAnnotationStorage, getAnnotIdToFieldName } from './form-layer.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

// Sub-modules
import { hexToRgb, buildBorderStyle, computeAnnotFlags, mapFontToPdfName,
  ensureAcroFormFonts, stripPdfAMetadata, generateAppearanceStream } from './saver/utils.js';
import { saveTextEditsToPages } from './saver/text-edits.js';
import { saveWatermarksToPages } from './saver/watermarks.js';
import { saveBookmarksToOutline } from './saver/bookmarks.js';

// Save PDF with annotations
export async function savePDF(saveAsPath = null) {
  const activeDoc = getActiveDocument();
  const currentPath = activeDoc?.filePath;
  if (!currentPath && !saveAsPath) {
    // Untitled document — redirect to Save As
    return await savePDFAs();
  }

  try {
    showLoading('Saving PDF...');

    // Get original PDF bytes (from cache or disk, with memory key fallback for untitled docs)
    let existingPdfBytes = getCachedPdfBytes(currentPath);
    if (!existingPdfBytes) {
      if (activeDoc) {
        existingPdfBytes = getCachedPdfBytes(`__memory__${activeDoc.id}`);
      }
    }
    if (!existingPdfBytes) {
      existingPdfBytes = await readBinaryFile(currentPath);
    }

    const pdfDocLib = await PDFDocument.load(existingPdfBytes);

    // Strip PDF/A metadata — saved file no longer conforms to PDF/A
    if (activeDoc && activeDoc.pdfaCompliance) {
      stripPdfAMetadata(pdfDocLib);
      activeDoc.pdfaCompliance = null;
      hidePdfABar();
    }

    // Get the PDF pages
    const pages = pdfDocLib.getPages();
    const context = pdfDocLib.context;

    // Persist interactive form field values from AnnotationStorage
    const storage = getAnnotationStorage();
    const fieldNameMap = getAnnotIdToFieldName();
    if (storage && storage.size > 0 && fieldNameMap.size > 0) {
      try {
        const form = pdfDocLib.getForm();
        for (const [annotId, fieldName] of fieldNameMap.entries()) {
          const storedValue = storage.getRawValue(annotId);
          if (storedValue === undefined) continue;
          try {
            const field = form.getField(fieldName);
            if (field instanceof PDFTextField) {
              field.setText(storedValue.value != null ? String(storedValue.value) : '');
            } else if (field instanceof PDFCheckBox) {
              storedValue.value ? field.check() : field.uncheck();
            } else if (field instanceof PDFDropdown) {
              if (storedValue.value != null) field.select(storedValue.value);
            } else if (field instanceof PDFRadioGroup) {
              if (storedValue.value != null) field.select(storedValue.value);
            } else if (field instanceof PDFOptionList) {
              if (storedValue.value != null) {
                const vals = Array.isArray(storedValue.value) ? storedValue.value : [storedValue.value];
                field.select(vals);
              }
            }
          } catch (fieldErr) {
            // Skip fields that can't be set (e.g. read-only, signature, etc.)
          }
        }
      } catch (formErr) {
        console.warn('Failed to persist form field values:', formErr);
      }
    }

    // Ensure AcroForm DR (Default Resources) has fonts for FreeText annotations.
    // PDF viewers resolve font names in DA strings through these resources.
    const doc = getActiveDocument();
    const docAnnotations = doc?.annotations || [];
    const ftAnnotations = docAnnotations.filter(a => a.type === 'textbox' || a.type === 'callout');
    if (ftAnnotations.length > 0) {
      // Collect all font names actually used
      const usedFonts = new Set();
      for (const ann of ftAnnotations) {
        usedFonts.add(mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic));
      }
      ensureAcroFormFonts(pdfDocLib, context, usedFonts);
    }

    // Group annotations by page
    const annotationsByPage = {};
    for (const ann of docAnnotations) {
      if (!annotationsByPage[ann.page]) {
        annotationsByPage[ann.page] = [];
      }
      annotationsByPage[ann.page].push(ann);
    }

    // Process each page
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const pageNum = pageIndex + 1;
      const page = pages[pageIndex];

      // Apply page rotation if set (combine with existing PDF rotation)
      const appRotation = getPageRotation(pageNum);
      if (appRotation) {
        const existingDeg = page.getRotation().angle;
        page.setRotation(degrees(existingDeg + appRotation));
      }

      const pageAnnotations = annotationsByPage[pageNum] || [];

      // Build annotations array: keep existing annotations we don't handle (widgets, links, etc.)
      // and replace the ones we do with our document annotations (which is the source of truth)
      const handledSubtypes = new Set([
        '/Highlight', '/Underline', '/StrikeOut', '/Squiggly',
        '/Square', '/Circle', '/Line', '/Ink', '/PolyLine', '/Polygon',
        '/Text', '/FreeText', '/Stamp'
      ]);
      let annotsArray = [];
      const annotsRef = page.node.get(PDFName.of('Annots'));
      if (annotsRef) {
        const lookedUp = context.lookup(annotsRef);
        if (lookedUp instanceof PDFArray) {
          for (const ref of lookedUp.asArray()) {
            const dict = context.lookup(ref);
            const subtype = dict?.get?.(PDFName.of('Subtype'))?.toString();
            if (!subtype || !handledSubtypes.has(subtype)) {
              annotsArray.push(ref); // Keep annotations we don't manage
            }
          }
        }
      }

      // Skip pages with no changes: no annotations from us and no existing handled annotations removed
      if (pageAnnotations.length === 0 && !annotsRef) continue;

      // Helpers to convert viewport coordinates back to PDF coordinates (handles CropBox offsets)
      const cropBox = page.getCropBox();
      const viewLeft = cropBox.x;
      const viewTop = cropBox.y + cropBox.height;
      const convertX = (canvasX) => canvasX + viewLeft;
      const convertY = (canvasY) => viewTop - canvasY;

      // Add our annotations
      for (const ann of pageAnnotations) {
        const colorArr = hexToColorArray(ann.color || '#000000');
        const opacity = ann.opacity !== undefined ? ann.opacity : 1;
        const borderWidth = ann.lineWidth ?? 2;

        let annotDict;

        switch (ann.type) {
          case 'highlight':
          case 'textHighlight':
          case 'textStrikethrough':
          case 'textUnderline':
          case 'textSquiggly': {
            // Text markup annotations
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);

            // Build QuadPoints from rects if available, otherwise from bounding box
            let quadPoints;
            if (ann.rects && ann.rects.length > 0) {
              quadPoints = [];
              for (const r of ann.rects) {
                const qx1 = convertX(r.x);
                const qx2 = convertX(r.x + r.width);
                const qy1 = convertY(r.y + r.height);
                const qy2 = convertY(r.y);
                quadPoints.push(qx1, qy2, qx2, qy2, qx1, qy1, qx2, qy1);
              }
            } else {
              quadPoints = [x1, y2, x2, y2, x1, y1, x2, y1];
            }

            // Map type to PDF subtype
            let markupSubtype = 'Highlight';
            if (ann.type === 'textStrikethrough') markupSubtype = 'StrikeOut';
            else if (ann.type === 'textUnderline') markupSubtype = 'Underline';
            else if (ann.type === 'textSquiggly') markupSubtype = 'Squiggly';

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: markupSubtype,
              Rect: [x1, y1, x2, y2],
              QuadPoints: quadPoints,
              C: hexToColorArray(ann.fillColor || ann.color),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'box': {
            // Square annotation
            let bx1 = convertX(ann.x);
            let by1 = convertY(ann.y + ann.height);
            let bx2 = convertX(ann.x + ann.width);
            let by2 = convertY(ann.y);

            // Expand Rect to axis-aligned bounding box of rotated shape
            if (ann.rotation) {
              const rad = ann.rotation * Math.PI / 180;
              const cos = Math.abs(Math.cos(rad));
              const sin = Math.abs(Math.sin(rad));
              const pw = Math.abs(bx2 - bx1);
              const ph = Math.abs(by2 - by1);
              const newW = pw * cos + ph * sin;
              const newH = pw * sin + ph * cos;
              const cx = (bx1 + bx2) / 2;
              const cy = (by1 + by2) / 2;
              bx1 = cx - newW / 2;
              bx2 = cx + newW / 2;
              by1 = cy - newH / 2;
              by2 = cy + newH / 2;
            }

            // Stroke color
            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;
            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [bx1, by1, bx2, by2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            annDictObj.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            // Add interior color (fill) if specified
            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            if (ann.rotation) annDictObj.OPS_Rotation = ann.rotation;

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'circle': {
            // Circle annotation (ellipse)
            let ccx1 = convertX(ann.x);
            let ccy1 = convertY(ann.y + ann.height);
            let ccx2 = convertX(ann.x + ann.width);
            let ccy2 = convertY(ann.y);

            // Expand Rect to axis-aligned bounding box of rotated ellipse
            if (ann.rotation) {
              const rad = ann.rotation * Math.PI / 180;
              const cos = Math.abs(Math.cos(rad));
              const sin = Math.abs(Math.sin(rad));
              const pw = Math.abs(ccx2 - ccx1);
              const ph = Math.abs(ccy2 - ccy1);
              const newW = pw * cos + ph * sin;
              const newH = pw * sin + ph * cos;
              const cmx = (ccx1 + ccx2) / 2;
              const cmy = (ccy1 + ccy2) / 2;
              ccx1 = cmx - newW / 2;
              ccx2 = cmx + newW / 2;
              ccy1 = cmy - newH / 2;
              ccy2 = cmy + newH / 2;
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'Circle',
              Rect: [ccx1, ccy1, ccx2, ccy2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            annDictObj.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            if (ann.fillColor && ann.fillColor !== 'none') {
              annDictObj.IC = hexToColorArray(ann.fillColor);
            }

            if (ann.rotation) annDictObj.OPS_Rotation = ann.rotation;

            annotDict = context.obj(annDictObj);
            break;
          }

          case 'line':
          case 'arrow': {
            // Line annotation (arrows use LE entries)
            const x1 = convertX(ann.startX);
            const y1 = convertY(ann.startY);
            const x2 = convertX(ann.endX);
            const y2 = convertY(ann.endY);

            const headSize = ann.headSize || 12;
            const padding = Math.max(borderWidth, headSize);
            const rectX1 = Math.min(x1, x2) - padding;
            const rectY1 = Math.min(y1, y2) - padding;
            const rectX2 = Math.max(x1, x2) + padding;
            const rectY2 = Math.max(y1, y2) + padding;

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const lineDict = {
              Type: 'Annot',
              Subtype: 'Line',
              Rect: [rectX1, rectY1, rectX2, rectY2],
              L: [x1, y1, x2, y2],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            // Border style
            lineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            // Arrow line endings (LE)
            if (ann.type === 'arrow') {
              const mapHead = (h) => {
                switch (h) {
                  case 'open': return 'OpenArrow';
                  case 'closed': return 'ClosedArrow';
                  case 'diamond': return 'Diamond';
                  case 'circle': return 'Circle';
                  case 'square': return 'Square';
                  case 'slash': return 'Slash';
                  case 'butt': return 'Butt';
                  case 'openReversed': return 'ROpenArrow';
                  case 'closedReversed': return 'RClosedArrow';
                  default: return 'None';
                }
              };
              lineDict.LE = [PDFName.of(mapHead(ann.startHead)), PDFName.of(mapHead(ann.endHead))];

              // Interior color for closed arrowheads
              if (ann.fillColor) {
                lineDict.IC = hexToColorArray(ann.fillColor);
              }
            }

            annotDict = context.obj(lineDict);
            break;
          }

          case 'draw': {
            // Ink annotation (freehand drawing)
            if (!ann.path || ann.path.length < 2) continue;

            const inkList = [];
            for (const pt of ann.path) {
              inkList.push(convertX(pt.x));
              inkList.push(convertY(pt.y));
            }

            // Calculate bounding rect
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let i = 0; i < inkList.length; i += 2) {
              minX = Math.min(minX, inkList[i]);
              maxX = Math.max(maxX, inkList[i]);
              minY = Math.min(minY, inkList[i + 1]);
              maxY = Math.max(maxY, inkList[i + 1]);
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const inkDict = {
              Type: 'Annot',
              Subtype: 'Ink',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              InkList: [inkList],
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            inkDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(inkDict);
            break;
          }

          case 'polyline': {
            // PolyLine annotation
            if (!ann.points || ann.points.length < 2) continue;

            const vertices = [];
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              vertices.push(px, py);
              minX = Math.min(minX, px); maxX = Math.max(maxX, px);
              minY = Math.min(minY, py); maxY = Math.max(maxY, py);
            }

            const strokeColorArr = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polylineDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [minX - borderWidth, minY - borderWidth, maxX + borderWidth, maxY + borderWidth],
              Vertices: vertices,
              C: strokeColorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            polylineDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            annotDict = context.obj(polylineDict);
            break;
          }

          case 'polygon':
          case 'cloud':
          case 'cloudPolyline': {
            // Polygon annotation
            let polyVertices = [];
            let polyMinX = Infinity, polyMinY = Infinity, polyMaxX = -Infinity, polyMaxY = -Infinity;

            if (ann.points && ann.points.length >= 3) {
              // Use stored points (from loaded PDF annotations)
              for (const pt of ann.points) {
                const px = convertX(pt.x);
                const py = convertY(pt.y);
                polyVertices.push(px, py);
                polyMinX = Math.min(polyMinX, px); polyMaxX = Math.max(polyMaxX, px);
                polyMinY = Math.min(polyMinY, py); polyMaxY = Math.max(polyMaxY, py);
              }
            } else {
              // Generate points from bounding box for regular polygon
              const cx = ann.x + ann.width / 2;
              const cy = ann.y + ann.height / 2;
              const rx = ann.width / 2;
              const ry = ann.height / 2;
              const sides = ann.sides || 6;

              for (let i = 0; i < sides; i++) {
                const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
                const px = convertX(cx + rx * Math.cos(angle));
                const py = convertY(cy + ry * Math.sin(angle));
                polyVertices.push(px, py);
                polyMinX = Math.min(polyMinX, px); polyMaxX = Math.max(polyMaxX, px);
                polyMinY = Math.min(polyMinY, py); polyMaxY = Math.max(polyMaxY, py);
              }
            }

            const polyStrokeColor = ann.strokeColor ? hexToColorArray(ann.strokeColor) : colorArr;

            const polygonDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [polyMinX - borderWidth, polyMinY - borderWidth, polyMaxX + borderWidth, polyMaxY + borderWidth],
              Vertices: polyVertices,
              C: polyStrokeColor,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.subject || ''),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            polygonDict.BS = buildBorderStyle(context, borderWidth, ann.borderStyle);

            if (ann.fillColor && ann.fillColor !== 'none') {
              polygonDict.IC = hexToColorArray(ann.fillColor);
            }

            // Save custom subtype to distinguish cloud/cloudPolyline from polygon
            if (ann.type === 'cloud') {
              polygonDict.OPS_Subtype = PDFString.of('cloud');
            } else if (ann.type === 'cloudPolyline') {
              polygonDict.OPS_Subtype = PDFString.of('cloudPolyline');
            }

            annotDict = context.obj(polygonDict);
            break;
          }

          case 'text':
          case 'textbox':
          case 'callout': {
            // FreeText annotation
            const ftW = ann.width || 150;
            const ftH = ann.height || 50;
            const ftRotation = ann.rotation || 0;

            // Compute Rect
            // For standard 90° rotations: use original dimensions (viewer handles rotation)
            // For arbitrary angles: expand to bounding box of rotated textbox
            const isStdRot = ftRotation !== 0 && ftRotation % 90 === 0;
            let x1, y1, x2, y2;
            if (ftRotation !== 0 && !isStdRot) {
              const cxDoc = convertX(ann.x + ftW / 2);
              const cyDoc = ann.y + ftH / 2;
              const rad = ftRotation * Math.PI / 180;
              const cosA = Math.abs(Math.cos(rad));
              const sinA = Math.abs(Math.sin(rad));
              const rotHalfW = (ftW / 2) * cosA + (ftH / 2) * sinA;
              const rotHalfH = (ftW / 2) * sinA + (ftH / 2) * cosA;
              x1 = cxDoc - rotHalfW;
              y1 = convertY(cyDoc + rotHalfH);
              x2 = cxDoc + rotHalfW;
              y2 = convertY(cyDoc - rotHalfH);
            } else {
              x1 = convertX(ann.x);
              y1 = convertY(ann.y + ftH);
              x2 = convertX(ann.x + ftW);
              y2 = convertY(ann.y);
            }

            const fontSize = ann.fontSize || 14;
            const textColorArr = ann.textColor ? hexToColorArray(ann.textColor) : [0, 0, 0];

            // Map font family + bold/italic to PDF standard font name
            const pdfFontName = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
            const da = `${textColorArr[0]} ${textColorArr[1]} ${textColorArr[2]} rg /${pdfFontName} ${fontSize} Tf`;

            // FreeText color mapping (must match loader):
            //   C entry  = fill/background color (annot.color in pdf.js)
            //   IC entry = stroke/border color (extraColors.ic in loader)
            const ftStrokeColorArr = (ann.strokeColor && ann.strokeColor !== 'none')
              ? hexToColorArray(ann.strokeColor) : [0, 0, 0];
            const ftFillColorArr = (ann.fillColor && ann.fillColor !== 'none')
              ? hexToColorArray(ann.fillColor) : null;

            // Build DS (Default Style) string for better interop with other viewers
            const textColorCss = ann.textColor || '#000000';
            const dsFontFamily = ann.fontFamily || 'Arial';
            const dsLineHeight = ann.lineSpacing ? `line-height:${Math.round(fontSize * ann.lineSpacing * 100) / 100};` : '';
            const dsStr = `font-family:${dsFontFamily};font-size:${fontSize}pt;color:${textColorCss};${dsLineHeight}`;

            const annDictObj = {
              Type: 'Annot',
              Subtype: 'FreeText',
              Rect: [x1, y1, x2, y2],
              Contents: PDFString.of(ann.text || ''),
              DA: PDFString.of(da),
              DS: PDFString.of(dsStr),
              C: ftFillColorArr || [1, 1, 1],
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            // Border style
            const ftBorderWidth = ann.lineWidth !== undefined ? ann.lineWidth : 1;
            annDictObj.BS = buildBorderStyle(context, ftBorderWidth, ann.borderStyle);

            // Stroke/border color in IC
            annDictObj.IC = ftStrokeColorArr;

            // Callout-specific data (set after context.obj for reliable PDF serialization)
            let calloutData = null;
            if (ann.type === 'callout' && ann.arrowX !== undefined) {
              const clArrowX = convertX(ann.arrowX);
              const clArrowY = convertY(ann.arrowY);
              const clKneeX = ann.kneeX !== undefined ? convertX(ann.kneeX) : clArrowX;
              const clKneeY = ann.kneeY !== undefined ? convertY(ann.kneeY) : clArrowY;
              const textConnectionX = ann.armOriginX !== undefined ? convertX(ann.armOriginX) : (ann.arrowX < (ann.x + ftW / 2) ? x1 : x2);
              const textConnectionY = ann.armOriginY !== undefined ? convertY(ann.armOriginY) : (y1 + y2) / 2;

              // Save original text box Rect before expanding
              const tbX1 = x1, tbY1 = y1, tbX2 = x2, tbY2 = y2;

              // Expand Rect to include all callout points (with padding for arrowhead)
              const clPad = 12;
              x1 = Math.min(x1, clArrowX - clPad, clKneeX, textConnectionX);
              y1 = Math.min(y1, clArrowY - clPad, clKneeY, textConnectionY);
              x2 = Math.max(x2, clArrowX + clPad, clKneeX, textConnectionX);
              y2 = Math.max(y2, clArrowY + clPad, clKneeY, textConnectionY);
              annDictObj.Rect = [x1, y1, x2, y2];

              calloutData = {
                cl: [clArrowX, clArrowY, clKneeX, clKneeY, textConnectionX, textConnectionY],
                rd: [tbX1 - x1, tbY1 - y1, x2 - tbX2, y2 - tbY2]
              };
            }

            // For standard 90° multiples, also set /Rotation for viewers that rebuild AP
            const isStandardRotation = ftRotation !== 0 && ftRotation % 90 === 0;

            if (isStandardRotation) {
              let pdfRotation = ((ftRotation % 360) + 360) % 360;
              annDictObj.Rotation = pdfRotation;
              annDictObj.OPS_Rotation = ftRotation;
            }

            annotDict = context.obj(annDictObj);

            // Set callout entries explicitly using PDFName keys for reliable serialization
            if (calloutData) {
              annotDict.set(PDFName.of('CL'), context.obj(calloutData.cl));
              annotDict.set(PDFName.of('IT'), PDFName.of('FreeTextCallout'));
              annotDict.set(PDFName.of('LE'), PDFName.of('OpenArrow'));
              annotDict.set(PDFName.of('RD'), context.obj(calloutData.rd));
            }

            // Always generate AP stream so other viewers show correct colors
            {
              const isCallout = ann.type === 'callout' && ann.arrowX !== undefined;
              // Text box in absolute PDF coords
              const tbX1 = convertX(ann.x);
              const tbY1 = convertY(ann.y + ftH);
              const tbX2 = tbX1 + ftW;
              const tbY2 = tbY1 + ftH;

              let ftStreamContent = '';
              const [sr, sg, sb] = ann.strokeColor && ann.strokeColor !== 'none'
                ? hexToRgb(ann.strokeColor) : [0, 0, 0];

              // Draw callout leader line and arrowhead first (using absolute page coords)
              if (isCallout) {
                const clAX = convertX(ann.arrowX);
                const clAY = convertY(ann.arrowY);
                const clKX = ann.kneeX !== undefined ? convertX(ann.kneeX) : convertX(ann.arrowX);
                const clKY = ann.kneeY !== undefined ? convertY(ann.kneeY) : convertY(ann.arrowY);
                const clOX = ann.armOriginX !== undefined ? convertX(ann.armOriginX) : tbX1;
                const clOY = ann.armOriginY !== undefined ? convertY(ann.armOriginY) : (tbY1 + ftH / 2);

                const dashOp = ann.borderStyle === 'dashed' ? '[8 4] 0 d\n' : ann.borderStyle === 'dotted' ? '[2 2] 0 d\n' : '';
                ftStreamContent += `${sr} ${sg} ${sb} RG ${ftBorderWidth} w\n${dashOp}`;
                // Leader line: armOrigin -> knee -> arrow tip
                ftStreamContent += `${clOX} ${clOY} m ${clKX} ${clKY} l ${clAX} ${clAY} l S\n`;
                // Arrowhead at arrow tip (3-point open arrow: point1 -> tip -> point2)
                const aAngle = Math.atan2(clAY - clKY, clAX - clKX);
                const aSize = 8;
                const ah1x = clAX - aSize * Math.cos(aAngle - Math.PI / 6);
                const ah1y = clAY - aSize * Math.sin(aAngle - Math.PI / 6);
                const ah2x = clAX - aSize * Math.cos(aAngle + Math.PI / 6);
                const ah2y = clAY - aSize * Math.sin(aAngle + Math.PI / 6);
                ftStreamContent += `${ah1x} ${ah1y} m ${clAX} ${clAY} l ${ah2x} ${ah2y} l S\n`;
              }

              // Draw text box fill + stroke (absolute coords)
              const ftDashOp = ann.borderStyle === 'dashed' ? '[8 4] 0 d\n' : ann.borderStyle === 'dotted' ? '[2 2] 0 d\n' : '';
              // For non-callout with rotation, wrap in transform
              const needsRotationInAP = ftRotation !== 0 && !isStandardRotation;
              if (needsRotationInAP) {
                const rad = -ftRotation * Math.PI / 180;
                const cosR = Math.cos(rad);
                const sinR = Math.sin(rad);
                const bboxCX = tbX1 + ftW / 2;
                const bboxCY = tbY1 + ftH / 2;
                ftStreamContent += 'q\n';
                ftStreamContent += `1 0 0 1 ${bboxCX} ${bboxCY} cm\n`;
                ftStreamContent += `${cosR} ${sinR} ${-sinR} ${cosR} 0 0 cm\n`;
                ftStreamContent += `1 0 0 1 ${-ftW / 2} ${-ftH / 2} cm\n`;
                // In rotated mode, draw at local 0,0
                ftStreamContent += `${ftBorderWidth} w\n${ftDashOp}${sr} ${sg} ${sb} RG\n`;
                if (ann.fillColor && ann.fillColor !== 'none') {
                  const [fr, fg, fb] = hexToRgb(ann.fillColor);
                  ftStreamContent += `${fr} ${fg} ${fb} rg\n0 0 ${ftW} ${ftH} re B\n`;
                } else {
                  ftStreamContent += `0 0 ${ftW} ${ftH} re S\n`;
                }
              } else {
                // Draw at absolute text box position
                ftStreamContent += `${ftBorderWidth} w\n${ftDashOp}${sr} ${sg} ${sb} RG\n`;
                if (ann.fillColor && ann.fillColor !== 'none') {
                  const [fr, fg, fb] = hexToRgb(ann.fillColor);
                  ftStreamContent += `${fr} ${fg} ${fb} rg\n${tbX1} ${tbY1} ${ftW} ${ftH} re B\n`;
                } else {
                  ftStreamContent += `${tbX1} ${tbY1} ${ftW} ${ftH} re S\n`;
                }
                // Clip text to text box area
                ftStreamContent += `${tbX1} ${tbY1} ${ftW} ${ftH} re W n\n`;
              }

              // Render text
              if (ann.text) {
                const ftFontSize = ann.fontSize || 14;
                const [tr, tg, tb] = ann.textColor ? hexToRgb(ann.textColor) : [0, 0, 0];
                const pdfFont = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
                const padding = ftBorderWidth + 2;
                const lineHeight = ftFontSize * 1.2;
                // Text position in absolute coords (or local 0,0 for rotated)
                const textBaseX = needsRotationInAP ? padding : tbX1 + padding;
                const textBaseY = needsRotationInAP ? (ftH - padding - ftFontSize) : (tbY2 - padding - ftFontSize);

                ftStreamContent += 'BT\n';
                ftStreamContent += `0 0 0 rg 0 Tc 0 Tw 100 Tz 0 Tr\n`;
                ftStreamContent += `/${pdfFont} ${ftFontSize} Tf\n`;
                if (ann.textColor) {
                  ftStreamContent += `${tr} ${tg} ${tb} rg\n`;
                }
                const lines = ann.text.split('\n');
                let textY = textBaseY;
                for (const line of lines) {
                  if (needsRotationInAP ? textY < 0 : textY < tbY1) break;
                  const escaped = line.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
                  ftStreamContent += `${textBaseX} ${textY} Td\n(${escaped}) Tj\n`;
                  ftStreamContent += `${-textBaseX} ${-textY} Td\n`;
                  textY -= lineHeight;
                }
                ftStreamContent += 'ET\n';
              }

              if (needsRotationInAP) {
                ftStreamContent += 'Q\n';
              }

              // Create font dict for resources
              const pdfFont = mapFontToPdfName(ann.fontFamily, ann.fontBold, ann.fontItalic);
              const fontDict = context.obj({
                Type: 'Font',
                Subtype: 'Type1',
                BaseFont: pdfFont,
                Encoding: 'WinAnsiEncoding'
              });

              // Use absolute BBox (same as Rect) with Matrix to translate origin
              const apStreamDict = {
                Type: 'XObject',
                Subtype: 'Form',
                BBox: [x1, y1, x2, y2],
                Matrix: [1, 0, 0, 1, -x1, -y1],
                Resources: context.obj({
                  Font: context.obj({ [pdfFont]: fontDict })
                })
              };

              const ftApStream = context.stream(ftStreamContent, apStreamDict);
              const ftApRef = context.register(ftApStream);
              const ftApDict = context.obj({ N: ftApRef });
              annotDict.set(PDFName.of('AP'), ftApDict);

              // Store angle for our loader to recover
              if (ftRotation !== 0 && !isStandardRotation) {
                annotDict.set(PDFName.of('OPS_Rotation'), context.obj(ftRotation));
              }
            }

            break;
          }

          case 'comment': {
            // Text annotation (sticky note)
            const x = convertX(ann.x);
            const y = convertY(ann.y);

            // Map internal icon name to PDF /Name value
            const iconNameMap = {
              comment: 'Comment', note: 'Note', help: 'Help',
              insert: 'Insert', key: 'Key', newparagraph: 'NewParagraph',
              paragraph: 'Paragraph', check: 'Check', circle: 'Circle',
              cross: 'Cross', star: 'Star'
            };
            const pdfIconName = iconNameMap[(ann.icon || 'comment').toLowerCase()] || 'Comment';

            annotDict = context.obj({
              Type: 'Annot',
              Subtype: 'Text',
              Rect: [x, y - 24, x + 24, y],
              Contents: PDFString.of(ann.text || ann.comment || ''),
              C: hexToColorArray(ann.color || '#FFFF00'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              Name: pdfIconName,
              Open: ann.popupOpen || false,
              F: computeAnnotFlags(ann)
            });
            break;
          }

          case 'stamp': {
            // Stamp annotation — with or without embedded image
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);

            // Map app stamp names to PDF spec standard names (ISO 32000-1 Table 181)
            const stdStampNames = {
              'Approved': 'Approved', 'Rejected': 'NotApproved', 'Not Approved': 'NotApproved',
              'Draft': 'Draft', 'Confidential': 'Confidential', 'Final': 'Final',
              'For Review': 'ForComment', 'Void': 'Expired', 'As Is': 'AsIs', 'Revised': 'Experimental'
            };
            const pdfStampName = stdStampNames[ann.stampName] || ann.stampName || 'Draft';

            const stampDictObj = {
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: pdfStampName,
              Subj: PDFString.of(ann.stampName || pdfStampName),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              NM: PDFString.of('stamp_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 6)),
              F: computeAnnotFlags(ann)
            };
            stampDictObj.IT = PDFName.of('Stamp');

            if (ann.rotation) stampDictObj.OPS_Rotation = ann.rotation;
            if (ann.stampName) stampDictObj.OPS_StampName = PDFString.of(ann.stampName);

            annotDict = context.obj(stampDictObj);

            // Generate AP stream for text-only stamps
            if (!ann.imageData && ann.stampText) {
              const w = ann.width;
              const h = ann.height;
              const [sr, sg, sb] = hexToRgb(ann.stampColor || ann.color || '#ef4444');
              const fontSize = Math.min(h * 0.45, 22);
              const textW = ann.stampText.length * fontSize * 0.58;
              const textX = (w - textW) / 2;
              const textY = (h - fontSize) / 2.4;
              const escaped = ann.stampText.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
              const k = 0.5522847498;
              const r = Math.min(w, h) * 0.15;
              const rrect = (rx, ry, rw, rh, cr) => {
                const kr = cr * k;
                return `${rx+cr} ${ry} m ${rx+rw-cr} ${ry} l ${rx+rw-cr+kr} ${ry} ${rx+rw} ${ry+cr-kr} ${rx+rw} ${ry+cr} c ` +
                  `${rx+rw} ${ry+rh-cr} l ${rx+rw} ${ry+rh-cr+kr} ${rx+rw-cr+kr} ${ry+rh} ${rx+rw-cr} ${ry+rh} c ` +
                  `${rx+cr} ${ry+rh} l ${rx+cr-kr} ${ry+rh} ${rx} ${ry+rh-cr+kr} ${rx} ${ry+rh-cr} c ` +
                  `${rx} ${ry+cr} l ${rx} ${ry+cr-kr} ${rx+cr-kr} ${ry} ${rx+cr} ${ry} c h\n`;
              };
              let s = `q\n2 w ${sr} ${sg} ${sb} RG\n${rrect(0, 0, w, h, r)}S\n`;
              s += `BT\n/F1 ${fontSize} Tf\n${sr} ${sg} ${sb} rg\n${textX} ${textY} Td\n(${escaped}) Tj\nET\nQ\n`;
              const fontDict = context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica-Bold', Encoding: 'WinAnsiEncoding' });
              const apStream = context.stream(s, {
                Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h],
                Resources: context.obj({ Font: context.obj({ F1: fontDict }) })
              });
              const apStreamRef = context.register(apStream);
              annotDict.set(PDFName.of('AP'), context.obj({ N: apStreamRef }));
            }

            // Embed image data if present (e.g. north arrow, custom stamps)
            if (ann.imageData) {
              try {
                let embeddedImage;
                const dataUrl = ann.imageData;
                if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedJpg(bytes);
                } else {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedPng(bytes);
                }

                const imageRef = embeddedImage.ref;
                const w = ann.width;
                const h = ann.height;
                const alpha = ann.opacity !== undefined ? ann.opacity : 1;
                let apContent;
                const resources = { XObject: context.obj({ Img: imageRef }) };

                if (alpha < 1) {
                  const gsDict = context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
                  const gsRef = context.register(gsDict);
                  resources.ExtGState = context.obj({ GS0: gsRef });
                  apContent = `q\n/GS0 gs\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                } else {
                  apContent = `q\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                }

                const apStream = context.stream(
                  apContent,
                  {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: [0, 0, w, h],
                    Resources: context.obj(resources)
                  }
                );
                const apStreamRef = context.register(apStream);
                const apDict = context.obj({ N: apStreamRef });
                annotDict.set(PDFName.of('AP'), apDict);
              } catch (imgErr) {
                console.warn('Failed to embed stamp image:', imgErr);
              }
            }
            break;
          }

          case 'image':
          case 'signature': {
            // Save image/signature as Stamp annotation with embedded image AP stream
            const x1 = convertX(ann.x);
            const y1 = convertY(ann.y + ann.height);
            const x2 = convertX(ann.x + ann.width);
            const y2 = convertY(ann.y);
            const w = ann.width;
            const h = ann.height;

            const imgDictObj = {
              Type: 'Annot',
              Subtype: 'Stamp',
              Rect: [x1, y1, x2, y2],
              Name: ann.type === 'signature' ? 'Signature' : (ann.stampName || 'Image'),
              Contents: PDFString.of(ann.type === 'signature' ? 'Signature' : (ann.stampText || ann.subject || '')),
              C: colorArr,
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              M: PDFString.of(new Date().toISOString()),
              F: computeAnnotFlags(ann)
            };

            if (ann.rotation) imgDictObj.OPS_Rotation = ann.rotation;

            annotDict = context.obj(imgDictObj);

            // Embed the actual image data into the appearance stream
            if (ann.imageData) {
              try {
                let embeddedImage;
                const dataUrl = ann.imageData;
                if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) {
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedJpg(bytes);
                } else {
                  // Default to PNG (covers data:image/png and other formats)
                  const base64 = dataUrl.split(',')[1];
                  const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
                  embeddedImage = await pdfDocLib.embedPng(bytes);
                }

                const imageRef = embeddedImage.ref;

                // Build AP stream content with opacity via ExtGState
                const alpha = ann.opacity !== undefined ? ann.opacity : 1;
                let apContent;
                const resources = { XObject: context.obj({ Img: imageRef }) };

                if (alpha < 1) {
                  const gsDict = context.obj({ Type: 'ExtGState', ca: alpha, CA: alpha });
                  const gsRef = context.register(gsDict);
                  resources.ExtGState = context.obj({ GS0: gsRef });
                  apContent = `q\n/GS0 gs\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                } else {
                  apContent = `q\n${w} 0 0 ${h} 0 0 cm\n/Img Do\nQ\n`;
                }

                // Create Form XObject that draws the image scaled to annotation size
                const apStream = context.stream(
                  apContent,
                  {
                    Type: 'XObject',
                    Subtype: 'Form',
                    BBox: [0, 0, w, h],
                    Resources: context.obj(resources)
                  }
                );
                const apStreamRef = context.register(apStream);
                const apDict = context.obj({ N: apStreamRef });
                annotDict.set(PDFName.of('AP'), apDict);
              } catch (imgErr) {
                console.warn('Failed to embed image in annotation:', imgErr);
              }
            }
            break;
          }

          case 'viewport': {
            const vpx1 = convertX(ann.x);
            const vpy1 = convertY(ann.y + ann.height);
            const vpx2 = convertX(ann.x + ann.width);
            const vpy2 = convertY(ann.y);
            const vpDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [vpx1, vpy1, vpx2, vpy2],
              C: hexToColorArray(ann.color || '#0066cc'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.name || 'Viewport'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('viewport'),
              F: computeAnnotFlags(ann)
            };
            if (ann.pixelsPerUnit) vpDict.OPS_PixelsPerUnit = ann.pixelsPerUnit;
            if (ann.unit) vpDict.OPS_Unit = PDFString.of(ann.unit);
            if (ann.scaleRatio) vpDict.OPS_ScaleRatio = PDFString.of(ann.scaleRatio);
            if (ann.lineWidth) vpDict.OPS_LineWidth = ann.lineWidth;
            annotDict = context.obj(vpDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, ann.lineWidth || 1.5, 'dashed'));
            break;
          }

          case 'scaleBar': {
            const sbx1 = convertX(ann.x);
            const sby1 = convertY(ann.y + ann.height);
            const sbx2 = convertX(ann.x + ann.width);
            const sby2 = convertY(ann.y);
            const sbDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [sbx1, sby1, sbx2, sby2],
              C: hexToColorArray(ann.color || '#000000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of('Scale Bar'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('scaleBar'),
              F: computeAnnotFlags(ann)
            };
            if (ann.pixelsPerUnit) sbDict.OPS_PixelsPerUnit = ann.pixelsPerUnit;
            if (ann.unit) sbDict.OPS_Unit = PDFString.of(ann.unit);
            if (ann.divisions) sbDict.OPS_Divisions = ann.divisions;
            if (ann.totalUnits) sbDict.OPS_TotalUnits = ann.totalUnits;
            if (ann.lineWidth) sbDict.OPS_LineWidth = ann.lineWidth;
            if (ann.rotation) sbDict.OPS_Rotation = ann.rotation;
            annotDict = context.obj(sbDict);
            break;
          }

          case 'scheduleTable': {
            const stx1 = convertX(ann.x);
            const sty1 = convertY(ann.y + ann.height);
            const stx2 = convertX(ann.x + ann.width);
            const sty2 = convertY(ann.y);
            const stDict = {
              Type: 'Annot',
              Subtype: 'Square',
              Rect: [stx1, sty1, stx2, sty2],
              C: [0, 0, 0],
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of('Schedule Table'),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('scheduleTable'),
              F: computeAnnotFlags(ann)
            };
            if (ann.scheduleData) {
              stDict.OPS_ScheduleData = PDFString.of(JSON.stringify(ann.scheduleData));
            }
            if (ann.groupByMode) {
              stDict.OPS_GroupBy = PDFString.of(ann.groupByMode);
            }
            annotDict = context.obj(stDict);
            break;
          }

          case 'measureAngle': {
            if (!ann.point1 || !ann.vertex || !ann.point2) continue;
            const ap1x = convertX(ann.point1.x), ap1y = convertY(ann.point1.y);
            const avx = convertX(ann.vertex.x), avy = convertY(ann.vertex.y);
            const ap2x = convertX(ann.point2.x), ap2y = convertY(ann.point2.y);
            const aMinX = Math.min(ap1x, avx, ap2x) - 5;
            const aMinY = Math.min(ap1y, avy, ap2y) - 5;
            const aMaxX = Math.max(ap1x, avx, ap2x) + 5;
            const aMaxY = Math.max(ap1y, avy, ap2y) + 5;
            const maDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [aMinX, aMinY, aMaxX, aMaxY],
              Vertices: [ap1x, ap1y, avx, avy, ap2x, ap2y],
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              OPS_Subtype: PDFString.of('measureAngle'),
              F: computeAnnotFlags(ann)
            };
            if (ann.arcRadius && ann.arcRadius !== 30) maDict.OPS_ArcRadius = ann.arcRadius;
            annotDict = context.obj(maDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            break;
          }

          case 'measureDistance': {
            const mapDimHead = (h) => {
              switch (h) {
                case 'open': return 'OpenArrow';
                case 'closed': return 'ClosedArrow';
                case 'diamond': return 'Diamond';
                case 'circle': return 'Circle';
                case 'openCircle': return 'Circle';
                case 'square': return 'Square';
                case 'slash': return 'Slash';
                case 'butt': return 'Butt';
                case 'openReversed': return 'ROpenArrow';
                case 'closedReversed': return 'RClosedArrow';
                default: return 'Circle';
              }
            };
            // Save as Line annotation with Measure dictionary
            // Data model: startX/Y = dimension line, leaderX/Y = base object points
            const mdx1 = convertX(ann.startX);
            const mdy1 = convertY(ann.startY);
            const mdx2 = convertX(ann.endX);
            const mdy2 = convertY(ann.endY);

            // Compute rect including all points
            let mdRectMinX = Math.min(mdx1, mdx2) - 5;
            let mdRectMinY = Math.min(mdy1, mdy2) - 5;
            let mdRectMaxX = Math.max(mdx1, mdx2) + 5;
            let mdRectMaxY = Math.max(mdy1, mdy2) + 5;

            // PDF /L = base object points when leaders exist, else dimension line
            let pdfLX1 = mdx1, pdfLY1 = mdy1, pdfLX2 = mdx2, pdfLY2 = mdy2;

            const mdDict = {
              Type: 'Annot',
              Subtype: 'Line',
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('LineDimension'),
              OPS_Subtype: PDFString.of('measureDistance'),
              LE: [PDFName.of(mapDimHead(ann.startHead)), PDFName.of(mapDimHead(ann.endHead))],
              F: computeAnnotFlags(ann)
            };

            // Save custom properties for exact round-trip
            if (ann.headSize && ann.headSize !== 12) mdDict.OPS_HeadSize = ann.headSize;
            if (ann.measurePrecision != null && ann.measurePrecision !== 2) mdDict.OPS_Precision = ann.measurePrecision;

            // Save leader line properties if extension lines exist
            if (ann.leaderStartX !== undefined) {
              // leaderStartX/Y = /L base object points in our data model
              const lsx = convertX(ann.leaderStartX);
              const lsy = convertY(ann.leaderStartY);
              const lex = convertX(ann.leaderEndX);
              const ley = convertY(ann.leaderEndY);
              // /L = base object points
              pdfLX1 = lsx; pdfLY1 = lsy;
              pdfLX2 = lex; pdfLY2 = ley;
              // Compute LL: perpendicular distance from /L base to dimension line
              const lineAngle = Math.atan2(ley - lsy, lex - lsx);
              const perpX = -Math.sin(lineAngle);
              const perpY = Math.cos(lineAngle);
              const ll = (mdx1 - lsx) * perpX + (mdy1 - lsy) * perpY;
              mdDict.LL = ll;
              mdDict.LLE = 5;
              // Expand rect to include base points
              mdRectMinX = Math.min(mdRectMinX, lsx, lex);
              mdRectMinY = Math.min(mdRectMinY, lsy, ley);
              mdRectMaxX = Math.max(mdRectMaxX, lsx, lex);
              mdRectMaxY = Math.max(mdRectMaxY, lsy, ley);
            }

            mdDict.L = [pdfLX1, pdfLY1, pdfLX2, pdfLY2];

            mdDict.Rect = [mdRectMinX, mdRectMinY, mdRectMaxX, mdRectMaxY];

            // Save Measure dictionary with scale factor
            if (ann.measureScale) {
              mdDict.Cap = true;
              mdDict.CP = PDFName.of('Inline');
            }

            annotDict = context.obj(mdDict);

            if (ann.measureScale) {
              const numFmt = context.obj({
                C: ann.measureScale,
                D: 1,
                U: PDFString.of(ann.measureUnit || 'mm'),
              });
              const measureDict = context.obj({
                Subtype: PDFName.of('RL'),
                R: PDFString.of(`1 pt = ${ann.measureScale} ${ann.measureUnit || 'mm'}`),
                X: context.obj([numFmt]),
              });
              annotDict.set(PDFName.of('Measure'), measureDict);
            }

            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            break;
          }

          case 'measureArea': {
            // Save as Polygon annotation with measurement data
            if (!ann.points || ann.points.length < 3) continue;
            let maVertices = [];
            let maMinX = Infinity, maMinY = Infinity, maMaxX = -Infinity, maMaxY = -Infinity;

            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              maVertices.push(px, py);
              maMinX = Math.min(maMinX, px); maMaxX = Math.max(maMaxX, px);
              maMinY = Math.min(maMinY, py); maMaxY = Math.max(maMaxY, py);
            }

            const maDict = {
              Type: 'Annot',
              Subtype: 'Polygon',
              Rect: [maMinX - 2, maMinY - 2, maMaxX + 2, maMaxY + 2],
              Vertices: maVertices,
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('PolygonDimension'),
              OPS_Subtype: PDFString.of('measureArea'),
              F: computeAnnotFlags(ann)
            };
            if (ann.fillColor && ann.fillColor !== 'none') {
              maDict.IC = hexToColorArray(ann.fillColor);
            }
            annotDict = context.obj(maDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            // Save holes as custom OPS_Holes array
            if (ann.holes && ann.holes.length > 0) {
              const holesArray = ann.holes.map(hole => {
                const holeVertices = [];
                for (const pt of hole) {
                  holeVertices.push(convertX(pt.x));
                  holeVertices.push(convertY(pt.y));
                }
                return context.obj(holeVertices);
              });
              annotDict.set(PDFName.of('OPS_Holes'), context.obj(holesArray));
            }
            break;
          }

          case 'measurePerimeter': {
            // Save as PolyLine annotation with measurement data
            if (!ann.points || ann.points.length < 2) continue;
            let mpVertices = [];
            let mpMinX = Infinity, mpMinY = Infinity, mpMaxX = -Infinity, mpMaxY = -Infinity;

            for (const pt of ann.points) {
              const px = convertX(pt.x);
              const py = convertY(pt.y);
              mpVertices.push(px, py);
              mpMinX = Math.min(mpMinX, px); mpMaxX = Math.max(mpMaxX, px);
              mpMinY = Math.min(mpMinY, py); mpMaxY = Math.max(mpMaxY, py);
            }

            const mpDict = {
              Type: 'Annot',
              Subtype: 'PolyLine',
              Rect: [mpMinX - 2, mpMinY - 2, mpMaxX + 2, mpMaxY + 2],
              Vertices: mpVertices,
              C: hexToColorArray(ann.strokeColor || '#ff0000'),
              CA: opacity,
              T: PDFString.of(ann.author || 'User'),
              Contents: PDFString.of(ann.measureText || ''),
              M: PDFString.of(new Date().toISOString()),
              IT: PDFName.of('PolyLineDimension'),
              OPS_Subtype: PDFString.of('measurePerimeter'),
              F: computeAnnotFlags(ann)
            };
            // Save line endings
            if (ann.startHead || ann.endHead) {
              const mapHead = (h) => {
                switch (h) {
                  case 'open': return 'OpenArrow';
                  case 'closed': return 'ClosedArrow';
                  case 'diamond': return 'Diamond';
                  case 'circle': return 'Circle';
                  case 'square': return 'Square';
                  case 'slash': return 'Slash';
                  case 'butt': return 'Butt';
                  case 'openReversed': return 'ROpenArrow';
                  case 'closedReversed': return 'RClosedArrow';
                  default: return 'None';
                }
              };
              mpDict.LE = [PDFName.of(mapHead(ann.startHead)), PDFName.of(mapHead(ann.endHead))];
            }
            if (ann.headSize && ann.headSize !== 12) mpDict.OPS_HeadSize = ann.headSize;
            annotDict = context.obj(mpDict);
            annotDict.set(PDFName.of('BS'), buildBorderStyle(context, borderWidth, ann.borderStyle));
            break;
          }
        }

        // Generate appearance stream for better compatibility with other PDF viewers
        // Skip if AP was already set (e.g. image/signature with embedded image)
        if (annotDict && !annotDict.get(PDFName.of('AP'))) {
          const apStream = generateAppearanceStream(context, ann, convertY);
          if (apStream) {
            const apStreamRef = context.register(apStream);
            const apDict = context.obj({ N: apStreamRef });
            annotDict.set(PDFName.of('AP'), apDict);
          }
        }

        // Add annotation to page
        if (annotDict) {
          const annotRef = context.register(annotDict);
          annotsArray.push(annotRef);
        }
      }

      // Set the updated annotations array
      page.node.set(PDFName.of('Annots'), context.obj(annotsArray));
    }

    // Burn text edits into the PDF (cover-and-replace)
    await saveTextEditsToPages(pdfDocLib, pages);

    // Burn watermarks into the PDF
    await saveWatermarksToPages(pdfDocLib, pages);

    // Save bookmarks to PDF outline
    saveBookmarksToOutline(pdfDocLib);

    // Save the PDF
    const pdfBytes = await pdfDocLib.save();
    const outputPath = saveAsPath || currentPath;
    const savedBytes = new Uint8Array(pdfBytes);

    // Temporarily release lock so we can write, then re-lock
    await unlockFile(outputPath);
    try {
      await writeBinaryFile(outputPath, savedBytes);
    } catch (writeErr) {
      // Re-lock before reporting error
      await lockFile(outputPath);
      const msg = writeErr?.message || String(writeErr);
      if (msg.includes('denied') || msg.includes('locked') || msg.includes('sharing') || msg.includes('used by another')) {
        throw new Error(i18next.t('fileLocked', { defaultValue: 'The file is being used by another application. Please close it and try again.' }));
      }
      throw writeErr;
    }
    await lockFile(outputPath);

    // Update cache so subsequent saves use the latest PDF as base
    setCachedPdfBytes(outputPath, savedBytes.slice());

    // Mark document as saved
    markDocumentSaved();

    return true;
  } catch (error) {
    console.error('Error saving PDF:', error);
    showMessage(i18next.t('failedToSavePdf', { error: error?.message || String(error) }));
    return false;
  } finally {
    hideLoading();
  }
}




// Save As - prompt for new file path
export async function savePDFAs() {
  if (!getActiveDocument()?.pdfDoc) {
    showMessage(i18next.t('noPdfLoaded'));
    return false;
  }

  // Use current path as default, or the untitled file name
  const doc = getActiveDocument();
  const currentPath = doc?.filePath;
  const defaultPath = currentPath || (doc ? doc.fileName : 'Untitled.pdf');

  const savePath = await saveFileDialog(defaultPath);

  if (savePath) {
    const success = await savePDF(savePath);

    // If saved to a new path, update the current path and UI
    if (success && savePath !== currentPath) {
      // Clean up memory cache if this was an untitled doc
      if (doc && !currentPath) {
        const memKey = `__memory__${doc.id}`;
        const { clearCachedPdfBytes } = await import('./loader.js');
        clearCachedPdfBytes(memKey);
      }

      if (doc) {
        doc.filePath = savePath;
        doc.fileName = savePath ? savePath.split(/[\\/]/).pop() : 'Untitled';
      }
      updateWindowTitle();
    }
    return success || false;
  }
  return false;
}
