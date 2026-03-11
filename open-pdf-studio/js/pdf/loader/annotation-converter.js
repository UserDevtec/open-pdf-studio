import { state } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import { generateImageId } from '../../utils/helpers.js';
import { colorArrayToHex } from '../../utils/colors.js';
import { mapPdfFontName, mapBorderStyle } from './pdf-helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement } from '../../annotations/measurement.js';

// Convert PDF annotation to our format
export async function convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap) {
  // Helpers to convert PDF coordinates to viewport coordinates (handles CropBox/MediaBox offsets)
  const convertPoint = (pdfX, pdfY) => viewport.convertToViewportPoint(pdfX, pdfY);
  const convertRect = (pdfRect) => {
    const vr = viewport.convertToViewportRectangle(pdfRect);
    return {
      x: Math.min(vr[0], vr[2]),
      y: Math.min(vr[1], vr[3]),
      width: Math.abs(vr[2] - vr[0]),
      height: Math.abs(vr[3] - vr[1])
    };
  };

  // Helper to parse PDF dates (format: D:YYYYMMDDHHmmSS or similar)
  const parsePdfDate = (pdfDate) => {
    if (!pdfDate) return new Date().toISOString();
    try {
      // Handle PDF date format D:YYYYMMDDHHmmSS
      if (typeof pdfDate === 'string' && pdfDate.startsWith('D:')) {
        const dateStr = pdfDate.substring(2);
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6) || '01';
        const day = dateStr.substring(6, 8) || '01';
        const hour = dateStr.substring(8, 10) || '00';
        const min = dateStr.substring(10, 12) || '00';
        const sec = dateStr.substring(12, 14) || '00';
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
      }
      // Try direct parsing
      const date = new Date(pdfDate);
      if (isNaN(date.getTime())) return new Date().toISOString();
      return date.toISOString();
    } catch {
      return new Date().toISOString();
    }
  };

  // Get common properties
  const rect = annot.rect;
  if (!rect || rect.length < 4) return null;

  // Look up extra colors extracted via pdf-lib (IC entry, appearance stream colors)
  const rectKey = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
  let extraColors = annotColorMap?.get(rectKey);
  // Fuzzy match fallback — pdf.js may expand Rect by borderWidth (up to several pts)
  // when annotations lack an appearance stream, causing mismatch with pdf-lib's raw Rect
  if (!extraColors && annotColorMap) {
    let bestDist = Infinity;
    for (const [k, v] of annotColorMap.entries()) {
      const parts = k.split(',').map(Number);
      if (parts.length === 4) {
        const d = Math.abs(parts[0] - rect[0]) + Math.abs(parts[1] - rect[1]) +
                  Math.abs(parts[2] - rect[2]) + Math.abs(parts[3] - rect[3]);
        if (d < bestDist && d < 8) {
          bestDist = d;
          extraColors = v;
        }
      }
    }
  }
  extraColors = extraColors || {};

  const baseProps = {
    page: pageNum,
    author: (annot.titleObj && annot.titleObj.str) || annot.title || 'User',
    subject: annot.subject || '',
    createdAt: parsePdfDate(annot.creationDate),
    modifiedAt: parsePdfDate(annot.modificationDate),
    opacity: annot.opacity !== undefined ? annot.opacity : (extraColors.opacity !== undefined ? extraColors.opacity : 1.0),
    locked: !!(annot.annotationFlags & 128),      // Bit 8: Locked
    printable: !!(annot.annotationFlags & 4),       // Bit 3: Print
    readOnly: !!(annot.annotationFlags & 64),       // Bit 7: ReadOnly
    marked: false
  };

  switch (annot.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      // Map PDF subtype to our type
      const typeMap = {
        'Highlight': 'textHighlight',
        'Underline': 'textUnderline',
        'StrikeOut': 'textStrikethrough',
        'Squiggly': 'textSquiggly'
      };
      const markupType = typeMap[annot.subtype] || 'highlight';

      // Extract rects from quadPoints for per-line markup
      const rects = [];
      if (annot.quadPoints && annot.quadPoints.length >= 8) {
        for (let i = 0; i < annot.quadPoints.length; i += 8) {
          const xs = [annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]];
          const ys = [annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]];
          const qMinX = Math.min(...xs);
          const qMaxX = Math.max(...xs);
          const qMinY = Math.min(...ys);
          const qMaxY = Math.max(...ys);
          rects.push(convertRect([qMinX, qMinY, qMaxX, qMaxY]));
        }
      }

      // Calculate overall bounding box
      let minX, maxX, minY, maxY;
      if (rects.length > 0) {
        minX = Math.min(...rects.map(r => r.x));
        maxX = Math.max(...rects.map(r => r.x + r.width));
        minY = Math.min(...rects.map(r => r.y));
        maxY = Math.max(...rects.map(r => r.y + r.height));
      } else {
        const fallback = convertRect(rect);
        minX = fallback.x;
        maxX = fallback.x + fallback.width;
        minY = fallback.y;
        maxY = fallback.y + fallback.height;
      }

      return createAnnotation({
        ...baseProps,
        type: markupType,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rects: rects.length > 0 ? rects : undefined,
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00')
      });
    }

    case 'Square': {
      const sqRect = convertRect(annot.rect);
      let sqX = sqRect.x, sqY = sqRect.y, sqW = sqRect.width, sqH = sqRect.height;
      let sqRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        sqRotation = Math.round(extraColors.rotation);
      } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
        sqRotation = -Math.round(extraColors.matrixAngle);
        // Rect is the expanded axis-aligned bounding box; recover original size from BBox
        if (extraColors.bboxWidth && extraColors.bboxHeight) {
          const pdfRectW = Math.abs(rect[2] - rect[0]);
          const vScale = pdfRectW > 0 ? sqRect.width / pdfRectW : 1;
          sqW = extraColors.bboxWidth * vScale;
          sqH = extraColors.bboxHeight * vScale;
          const cx = sqRect.x + sqRect.width / 2;
          const cy = sqRect.y + sqRect.height / 2;
          sqX = cx - sqW / 2;
          sqY = cy - sqH / 2;
        }
      }
      const sqProps = {
        ...baseProps,
        type: 'box',
        x: sqX,
        y: sqY,
        width: sqW,
        height: sqH,
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: mapBorderStyle(annot, extraColors)
      };
      if (sqRotation) sqProps.rotation = sqRotation;
      return createAnnotation(sqProps);
    }

    case 'Circle': {
      const crRect = convertRect(annot.rect);
      let crX = crRect.x, crY = crRect.y, crW = crRect.width, crH = crRect.height;
      let crRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        crRotation = Math.round(extraColors.rotation);
      } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
        crRotation = -Math.round(extraColors.matrixAngle);
        if (extraColors.bboxWidth && extraColors.bboxHeight) {
          const pdfRectW = Math.abs(rect[2] - rect[0]);
          const vScale = pdfRectW > 0 ? crRect.width / pdfRectW : 1;
          crW = extraColors.bboxWidth * vScale;
          crH = extraColors.bboxHeight * vScale;
          const cx = crRect.x + crRect.width / 2;
          const cy = crRect.y + crRect.height / 2;
          crX = cx - crW / 2;
          crY = cy - crH / 2;
        }
      }
      const crProps = {
        ...baseProps,
        type: 'circle',
        x: crX,
        y: crY,
        width: crW,
        height: crH,
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: mapBorderStyle(annot, extraColors)
      };
      if (crRotation) crProps.rotation = crRotation;
      return createAnnotation(crProps);
    }

    case 'Line':
      if (annot.lineCoordinates && annot.lineCoordinates.length >= 4) {
        // Use original /L coords from pdf-lib (PDF.js normalizeRect destroys direction)
        const lc = extraColors.lineCoords || annot.lineCoordinates;
        const [lsx, lsy] = convertPoint(lc[0], lc[1]);
        const [lex, ley] = convertPoint(lc[2], lc[3]);

        // Check if this is a measurement annotation (use pdf.js IT + colorMap fallback)
        const isMeasureDist = extraColors.opsSubtype === 'measureDistance' ||
                              extraColors.intent === 'LineDimension' ||
                              extraColors.hasMeasure ||
                              annot.it === 'LineDimension';
        if (isMeasureDist) {
          const mdProps = {
            ...baseProps,
            type: 'measureDistance',
            startX: lsx,
            startY: lsy,
            endX: lex,
            endY: ley,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            lineWidth: annot.borderStyle?.width || 1,
          };
          // Store per-annotation scale/unit/precision from PDF Measure dictionary
          if (extraColors.measureScale) {
            mdProps.measureScale = extraColors.measureScale;
            mdProps.measureUnit = extraColors.measureUnit || 'mm';
            if (extraColors.measurePrecision !== undefined) {
              mdProps.measurePrecision = extraColors.measurePrecision;
            }
          }
          // Get measurement text from Contents, or auto-calculate using annotation's own scale
          let mdText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!mdText) {
            if (mdProps.measureScale) {
              const prec = mdProps.measurePrecision || 2;
              const pixelDist = Math.sqrt((lex - lsx) ** 2 + (ley - lsy) ** 2);
              const scaledVal = pixelDist * mdProps.measureScale;
              const unit = mdProps.measureUnit || 'mm';
              mdText = `${scaledVal.toFixed(prec)} ${unit}`;
            } else {
              const dist = calculateDistance(lsx, lsy, lex, ley);
              mdText = formatMeasurement(dist);
            }
          }
          mdProps.measureText = mdText;
          // Read line endings from PDF LE array
          const mdLe = annot.lineEndings || [];
          const mapMdHead = (h) => {
            switch (h) {
              case 'OpenArrow': return 'open';
              case 'ClosedArrow': return 'closed';
              case 'Diamond': return 'diamond';
              case 'Circle': return 'circle';
              case 'Square': return 'square';
              case 'Slash': return 'slash';
              case 'Butt': return 'butt';
              case 'ROpenArrow': return 'openReversed';
              case 'RClosedArrow': return 'closedReversed';
              default: return 'closed';
            }
          };
          if (mdLe.length >= 2) {
            mdProps.startHead = mapMdHead(mdLe[0]);
            mdProps.endHead = mapMdHead(mdLe[1]);
          } else {
            mdProps.startHead = 'closed';
            mdProps.endHead = 'closed';
          }
          mdProps.headSize = extraColors.opsHeadSize || 12;
          if (extraColors.opsPrecision != null) mdProps.measurePrecision = extraColors.opsPrecision;
          // Compute dimension line position from PDF LL (leader length)
          // Per PDF spec: /L = base points on measured object, /LL = perpendicular
          // offset to the dimension line. Positive LL = counter-clockwise from /L direction.
          // Our data model: startX/Y = dimension line, leaderX/Y = base object points.
          const ll = extraColors.leaderLength;
          if (ll && ll !== 0) {
            const lineAngle = Math.atan2(lc[3] - lc[1], lc[2] - lc[0]);
            const perpX = -Math.sin(lineAngle);
            const perpY = Math.cos(lineAngle);
            // Dimension line endpoints = /L offset by LL along perpendicular
            const [dimX1, dimY1] = convertPoint(lc[0] + ll * perpX, lc[1] + ll * perpY);
            const [dimX2, dimY2] = convertPoint(lc[2] + ll * perpX, lc[3] + ll * perpY);
            // Swap: startX/Y = dimension line, leaderX/Y = /L base points
            mdProps.leaderStartX = lsx;
            mdProps.leaderStartY = lsy;
            mdProps.leaderEndX = lex;
            mdProps.leaderEndY = ley;
            mdProps.startX = dimX1;
            mdProps.startY = dimY1;
            mdProps.endX = dimX2;
            mdProps.endY = dimY2;
          }
          return createAnnotation(mdProps);
        }

        // Check for line endings (arrow heads)
        const le = annot.lineEndings || [];
        const mapPdfHead = (h) => {
          switch (h) {
            case 'OpenArrow': return 'open';
            case 'ClosedArrow': return 'closed';
            case 'Diamond': return 'diamond';
            case 'Circle': return 'circle';
            case 'Square': return 'square';
            case 'Slash': return 'slash';
            case 'Butt': return 'butt';
            case 'ROpenArrow': return 'openReversed';
            case 'RClosedArrow': return 'closedReversed';
            default: return 'none';
          }
        };
        const startHead = mapPdfHead(le[0]);
        const endHead = mapPdfHead(le[1]);
        const isArrow = startHead !== 'none' || endHead !== 'none';

        return createAnnotation({
          ...baseProps,
          type: isArrow ? 'arrow' : 'line',
          startX: lsx,
          startY: lsy,
          endX: lex,
          endY: ley,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || undefined,
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot, extraColors),
          startHead: startHead,
          endHead: endHead,
          headSize: 12
        });
      }
      break;

    case 'Ink':
      // Freehand drawing
      if (annot.inkLists && annot.inkLists.length > 0) {
        const path = [];
        const inkList = annot.inkLists[0];
        for (let i = 0; i < inkList.length; i += 2) {
          const [ipx, ipy] = convertPoint(inkList[i], inkList[i + 1]);
          path.push({ x: ipx, y: ipy });
        }
        return createAnnotation({
          ...baseProps,
          type: 'draw',
          path: path,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        });
      }
      break;

    case 'PolyLine':
      if (annot.vertices && annot.vertices.length >= 4) {
        const plPoints = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          const [plx, ply] = convertPoint(annot.vertices[i], annot.vertices[i + 1]);
          plPoints.push({ x: plx, y: ply });
        }

        // Check if this is a perimeter measurement (use pdf.js IT + colorMap fallback)
        const isMeasurePerim = extraColors.opsSubtype === 'measurePerimeter' ||
                               extraColors.intent === 'PolyLineDimension' ||
                               extraColors.hasMeasure ||
                               annot.it === 'PolyLineDimension';
        if (isMeasurePerim) {
          let mpText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!mpText) {
            const perim = calculatePerimeter(plPoints);
            mpText = formatMeasurement(perim);
          }
          const mpProps = {
            ...baseProps,
            type: 'measurePerimeter',
            points: plPoints,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            lineWidth: annot.borderStyle?.width || 1,
            borderStyle: mapBorderStyle(annot, extraColors),
            measureText: mpText,
          };
          // Read line endings from PDF LE array
          const mpLe = annot.lineEndings || [];
          if (mpLe.length >= 2) {
            const mapHead = (h) => {
              switch (h) {
                case 'OpenArrow': return 'open';
                case 'ClosedArrow': return 'closed';
                case 'Diamond': return 'diamond';
                case 'Circle': return 'circle';
                case 'Square': return 'square';
                case 'Slash': return 'slash';
                case 'Butt': return 'butt';
                case 'ROpenArrow': return 'openReversed';
                case 'RClosedArrow': return 'closedReversed';
                default: return 'none';
              }
            };
            mpProps.startHead = mapHead(mpLe[0]);
            mpProps.endHead = mapHead(mpLe[1]);
          }
          mpProps.headSize = extraColors.opsHeadSize || 12;
          if (extraColors.measureScale) {
            mpProps.measureScale = extraColors.measureScale;
            mpProps.measureUnit = extraColors.measureUnit || 'mm';
            if (extraColors.measurePrecision !== undefined) {
              mpProps.measurePrecision = extraColors.measurePrecision;
            }
          }
          if (extraColors.opsPrecision != null) mpProps.measurePrecision = extraColors.opsPrecision;
          return createAnnotation(mpProps);
        }

        return createAnnotation({
          ...baseProps,
          type: 'polyline',
          points: plPoints,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        });
      }
      break;

    case 'Polygon':
      if (annot.vertices && annot.vertices.length >= 6) {
        // Calculate bounding box and points in viewport coordinates
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const polyPoints = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          const [pvx, pvy] = convertPoint(annot.vertices[i], annot.vertices[i + 1]);
          polyPoints.push({ x: pvx, y: pvy });
          minX = Math.min(minX, pvx);
          maxX = Math.max(maxX, pvx);
          minY = Math.min(minY, pvy);
          maxY = Math.max(maxY, pvy);
        }

        // Check if this is an area measurement (use pdf.js IT + colorMap fallback)
        const isMeasureArea = extraColors.opsSubtype === 'measureArea' ||
                              extraColors.intent === 'PolygonDimension' ||
                              (extraColors.hasMeasure && !extraColors.opsSubtype) ||
                              annot.it === 'PolygonDimension';
        if (isMeasureArea) {
          let maText = (annot.contentsObj && annot.contentsObj.str) || annot.contents || baseProps.subject || '';
          if (!maText) {
            const area = calculateArea(polyPoints);
            maText = formatMeasurement(area);
          }
          const maProps = {
            ...baseProps,
            type: 'measureArea',
            points: polyPoints,
            color: colorArrayToHex(annot.color, '#ff0000'),
            strokeColor: colorArrayToHex(annot.color, '#ff0000'),
            fillColor: extraColors.ic || 'none',
            lineWidth: annot.borderStyle?.width || 1,
            borderStyle: mapBorderStyle(annot, extraColors),
            measureText: maText,
          };
          if (extraColors.measureScale) {
            maProps.measureScale = extraColors.measureScale;
            maProps.measureUnit = extraColors.measureAreaUnit || extraColors.measureUnit || 'mm';
            const areaPrecision = extraColors.measureAreaPrecision !== undefined
              ? extraColors.measureAreaPrecision : extraColors.measurePrecision;
            if (areaPrecision !== undefined) maProps.measurePrecision = areaPrecision;
          }
          if (extraColors.opsPrecision != null) maProps.measurePrecision = extraColors.opsPrecision;
          return createAnnotation(maProps);
        }

        // Determine type from OPS_Subtype custom key
        const polyType = extraColors.opsSubtype === 'cloudPolyline' ? 'cloudPolyline'
                       : extraColors.opsSubtype === 'cloud' ? 'cloud'
                       : 'polygon';

        const polyProps = {
          ...baseProps,
          type: polyType,
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
          sides: Math.floor(annot.vertices.length / 2),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || null,
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot, extraColors)
        };

        // cloudPolyline and cloud need stored points for rendering
        if (polyType === 'cloudPolyline' || polyType === 'cloud') {
          polyProps.points = polyPoints;
        }

        return createAnnotation(polyProps);
      }
      break;

    case 'Text': {
      // Sticky note annotation
      const [txtVx, txtVy] = convertPoint(rect[0], rect[3]);

      // Normalize PDF /Name to lowercase internal icon name
      const pdfNameToIcon = {
        'Comment': 'comment', 'Note': 'note', 'Help': 'help',
        'Insert': 'insert', 'Key': 'key', 'NewParagraph': 'newparagraph',
        'Paragraph': 'paragraph', 'Check': 'check', 'Circle': 'circle',
        'Cross': 'cross', 'Star': 'star'
      };
      const rawName = annot.name || 'Comment';
      const iconName = pdfNameToIcon[rawName] || rawName.toLowerCase();

      return createAnnotation({
        ...baseProps,
        type: 'comment',
        x: txtVx,
        y: txtVy,
        width: 24,
        height: 24,
        text: (annot.contentsObj && annot.contentsObj.str) || annot.contents || '',
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00'),
        icon: iconName,
        popupOpen: annot.open || false
      });
    }

    case 'FreeText': {
      // Extract font size, font family, bold/italic, and text color
      let fontSize = 14;
      let fontSizeFromPdf = false;
      let textColor = '#000000';
      let fontFamily = null;
      let fontBold = false;
      let fontItalic = false;

      if (annot.defaultAppearanceData) {
        if (annot.defaultAppearanceData.fontSize) { fontSize = annot.defaultAppearanceData.fontSize; fontSizeFromPdf = true; }
        if (annot.defaultAppearanceData.fontColor) {
          textColor = colorArrayToHex(annot.defaultAppearanceData.fontColor, '#000000');
        }
        if (annot.defaultAppearanceData.fontName) {
          const fontInfo = mapPdfFontName(annot.defaultAppearanceData.fontName);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
      }
      if (!fontFamily && annot.defaultAppearance) {
        // Parse DA string "/FontRef size Tf"
        const fontMatch = annot.defaultAppearance.match(/\/([^\s]+)\s+[\d.]+\s+Tf/);
        if (fontMatch) {
          const fontInfo = mapPdfFontName(fontMatch[1]);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
        if (!annot.defaultAppearanceData) {
          const sizeMatch = annot.defaultAppearance.match(/(\d+(?:\.\d+)?)\s+Tf/);
          if (sizeMatch) { fontSize = parseFloat(sizeMatch[1]); fontSizeFromPdf = true; }
          const colorMatch = annot.defaultAppearance.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
          if (colorMatch) {
            textColor = colorArrayToHex([parseFloat(colorMatch[1]), parseFloat(colorMatch[2]), parseFloat(colorMatch[3])], '#000000');
          }
        }
      }
      // Use font info from pdf-lib if available (more accurate - resolves reference names like "F8")
      if (extraColors.fontFamily) fontFamily = extraColors.fontFamily;
      if (extraColors.fontBold) fontBold = true;
      if (extraColors.fontItalic) fontItalic = true;
      // Use DS font-size as fallback if DA didn't provide one
      if (!fontSizeFromPdf && extraColors.dsFontSize) fontSize = extraColors.dsFontSize;
      let fontUnderline = extraColors.fontUnderline || false;
      let fontStrikethrough = extraColors.fontStrikethrough || false;

      // Text content: prefer textContent array (joined), fallback to contents
      const text = annot.textContent ? annot.textContent.join('\n') : (annot.contents || '');

      // For FreeText annotations, annot.color (C entry) is the background/fill color per PDF spec
      // Border color: IC entry or appearance stream stroke color (extracted via pdf-lib)
      let borderColor = extraColors.ic || extraColors.apStrokeColor || '#000000';
      if (borderColor === '#000000' && annot.borderColor) {
        borderColor = colorArrayToHex(annot.borderColor, '#000000');
      }

      // Fill/background color: annot.color (C entry) for FreeText, fallback to backgroundColor (MK/BG)
      const bgColor = annot.color
        ? colorArrayToHex(annot.color)
        : (annot.backgroundColor ? colorArrayToHex(annot.backgroundColor) : null);

      // Border style: 1=SOLID, 2=DASHED, 3=BEVELED, 4=INSET, 5=UNDERLINE
      const bsStyle = annot.borderStyle?.style;
      const borderStyle = bsStyle === 2 ? 'dashed' : (bsStyle === 3 || bsStyle === 4 ? 'dotted' : 'solid');
      const borderWidth = extraColors.borderWidth !== undefined ? extraColors.borderWidth : (annot.borderStyle?.width || 1);

      // Derive rotation: check /Rotation key first (our format), then AP/N Matrix
      let ftRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        ftRotation = Math.round(extraColors.rotation);
      }
      if (ftRotation === 0 && extraColors.matrixAngle !== undefined) {
        const ma = extraColors.matrixAngle;
        const baseAngle = Math.round(ma / 90) * 90;
        ftRotation = -(ma - baseAngle);
        ftRotation = Math.round(ftRotation);
        if (Math.abs(ftRotation) <= 1) ftRotation = 0;
      }

      // Recover the original (unrotated) textbox dimensions from Rect.
      const rectW = rect[2] - rect[0];
      const rectH = rect[3] - rect[1];
      let ftWidth, ftHeight;
      const isStdRot = ftRotation !== 0 && ftRotation % 90 === 0;
      if (isStdRot) {
        // Standard rotation: Rect has original (non-expanded) dimensions
        ftWidth = rectW;
        ftHeight = rectH;
      } else if (ftRotation !== 0) {
        // Arbitrary angle: Rect is the expanded bounding box, recover original dims
        const c = Math.abs(Math.cos(ftRotation * Math.PI / 180));
        const s = Math.abs(Math.sin(ftRotation * Math.PI / 180));
        const det = c * c - s * s;
        if (Math.abs(det) > 0.01) {
          ftWidth = Math.round((rectW * c - rectH * s) / det);
          ftHeight = Math.round((rectH * c - rectW * s) / det);
          if (ftWidth <= 0 || ftHeight <= 0) {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        } else {
          if (extraColors.bboxWidth && extraColors.bboxHeight &&
              (Math.abs(extraColors.bboxWidth - rectW) > 1 || Math.abs(extraColors.bboxHeight - rectH) > 1)) {
            ftWidth = extraColors.bboxWidth;
            ftHeight = extraColors.bboxHeight;
          } else {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        }
      } else {
        ftWidth = rectW;
        ftHeight = rectH;
      }
      // Position: center of the Rect (bounding box center = rotated textbox center)
      const ftRectVp = convertRect(annot.rect);
      const cx = ftRectVp.x + ftRectVp.width / 2;
      const cy = ftRectVp.y + ftRectVp.height / 2;
      const ftX = cx - ftWidth / 2;
      const ftY = cy - ftHeight / 2;

      // pdf.js doesn't expose calloutLine; use pdf-lib extracted CL from extraColors
      const calloutLine = extraColors.calloutLine || annot.calloutLine;
      const isCallout = calloutLine && calloutLine.length >= 4;

      if (isCallout) {
        // For callouts, Rect may include the leader line. Use /RD to get the actual text box.
        // RD = [left, bottom, right, top] insets from Rect to text box
        let coX = ftX, coY = ftY, coW = ftWidth, coH = ftHeight;
        const rd = extraColors.rectDiff;
        if (rd && rd[0] !== null) {
          const rdVp = convertRect([rect[0] + rd[0], rect[1] + rd[1], rect[2] - rd[2], rect[3] - rd[3]]);
          coX = rdVp.x;
          coY = rdVp.y;
          coW = rdVp.width;
          coH = rdVp.height;
        }
        // Callout stroke color: IC > AP stroke > borderColor fallback
        const coStrokeColor = extraColors.ic || extraColors.apStrokeColor || borderColor;
        // Fill color: C entry is the background for FreeText
        const coFillColor = bgColor || extraColors.cColor || '#FFFFD0';
        // Convert callout line points to viewport coordinates
        const [clArrowVx, clArrowVy] = convertPoint(calloutLine[0], calloutLine[1]);
        let clKneeVx, clKneeVy, clArmVx, clArmVy;
        if (calloutLine.length >= 6) {
          [clKneeVx, clKneeVy] = convertPoint(calloutLine[2], calloutLine[3]);
          [clArmVx, clArmVy] = convertPoint(calloutLine[4], calloutLine[5]);
        } else {
          clKneeVx = clArrowVx; clKneeVy = clArrowVy;
          [clArmVx, clArmVy] = convertPoint(calloutLine[2], calloutLine[3]);
        }
        return createAnnotation({
          ...baseProps,
          type: 'callout',
          x: coX,
          y: coY,
          width: coW,
          height: coH,
          rotation: ftRotation,
          text: text,
          color: coStrokeColor,
          strokeColor: coStrokeColor,
          fillColor: coFillColor || '#FFFFD0',
          textColor: textColor,
          fontSize: fontSize,
          borderStyle: borderStyle,
          lineWidth: borderWidth,
          fontFamily: fontFamily || 'Arial',
          fontBold: fontBold,
          fontItalic: fontItalic,
          lineSpacing: extraColors.lineSpacing || undefined,
          fontUnderline: fontUnderline,
          fontStrikethrough: fontStrikethrough,
          arrowX: clArrowVx,
          arrowY: clArrowVy,
          kneeX: clKneeVx,
          kneeY: clKneeVy,
          armOriginX: clArmVx,
          armOriginY: clArmVy
        });
      }

      return createAnnotation({
        ...baseProps,
        type: 'textbox',
        x: ftX,
        y: ftY,
        width: ftWidth,
        height: ftHeight,
        rotation: ftRotation,
        text: text,
        color: borderColor,
        strokeColor: borderColor,
        fillColor: bgColor,
        textColor: textColor,
        fontSize: fontSize,
        borderStyle: borderStyle,
        lineWidth: borderWidth,
        fontFamily: fontFamily || 'Arial',
        fontBold: fontBold,
        fontItalic: fontItalic,
        lineSpacing: extraColors.lineSpacing || undefined,
        fontUnderline: fontUnderline,
        fontStrikethrough: fontStrikethrough
      });
    }

    case 'Stamp': {
      // Image stamp - extracted from PDF structure via pdf-lib
      const stRect = convertRect(annot.rect);
      const x = stRect.x;
      const y = stRect.y;
      const w = stRect.width;
      const h = stRect.height;

      // Find matching stamp image by rect
      let dataUrl = null;
      if (stampImageMap) {
        // Try exact match first
        const key = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
        dataUrl = stampImageMap.get(key);
        // Fuzzy match fallback
        if (!dataUrl) {
          for (const [k, v] of stampImageMap.entries()) {
            const parts = k.split(',').map(Number);
            if (Math.abs(parts[0] - rect[0]) < 1 && Math.abs(parts[1] - rect[1]) < 1 &&
                Math.abs(parts[2] - rect[2]) < 1 && Math.abs(parts[3] - rect[3]) < 1) {
              dataUrl = v;
              break;
            }
          }
        }
      }

      if (dataUrl) {
        const imageId = generateImageId();
        const img = new Image();
        img.src = dataUrl;
        state.imageCache.set(imageId, img);

        let stRotation = 0;
        if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
          stRotation = Math.round(extraColors.rotation);
        } else if (extraColors.matrixAngle !== undefined && Math.abs(extraColors.matrixAngle) > 1) {
          stRotation = -Math.round(extraColors.matrixAngle);
        }

        return createAnnotation({
          ...baseProps,
          type: 'image',
          x: x,
          y: y,
          width: w,
          height: h,
          imageId: imageId,
          imageData: dataUrl,
          originalWidth: w,
          originalHeight: h,
          lockAspectRatio: true,
          rotation: stRotation
        });
      }
      break;
    }
  }

  return null;
}
