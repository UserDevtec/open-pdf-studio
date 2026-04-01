import { PDFName, PDFDict, PDFArray } from 'pdf-lib';
import { pdfNum, pdfColorToHex, mapPdfFontName, inflateBytes } from './pdf-helpers.js';

// Extract colors (IC, appearance stream) from annotations using pdf-lib
// Returns Map<rectKey, { ic, apStrokeColor }> where ic = Interior Color hex, apStrokeColor = stroke from appearance stream
export async function extractAnnotationColors(pageNum, pdfDoc) {
  const colorMap = new Map();
  try {
    const page = pdfDoc.getPages()[pageNum - 1];
    if (!page) return colorMap;
    const context = pdfDoc.context;
    const annotsRaw = page.node.get(PDFName.of('Annots'));
    if (!annotsRaw) return colorMap;
    const annots = context.lookup(annotsRaw);
    if (!annots) return colorMap;

    for (let i = 0; i < annots.size(); i++) {
      const annotDict = context.lookup(annots.get(i));
      if (!annotDict) continue;
      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (!subtype) continue;
      const subtypeName = subtype.toString();

      // Get rect key for matching
      const rectRaw = annotDict.get(PDFName.of('Rect'));
      if (!rectRaw) continue;
      const rect = context.lookup(rectRaw);
      if (!rect || typeof rect.size !== 'function') continue;
      const key = `${pdfNum(rect.get(0))},${pdfNum(rect.get(1))},${pdfNum(rect.get(2))},${pdfNum(rect.get(3))}`;

      const colors = {};

      // Read /CA (opacity) entry for ALL annotation types - PDF.js doesn't always expose this
      const caRaw = annotDict.get(PDFName.of('CA'));
      if (caRaw) {
        const caVal = pdfNum(context.lookup(caRaw) || caRaw);
        if (caVal !== null && caVal >= 0 && caVal <= 1) {
          colors.opacity = caVal;
        }
      }

      // Read stamp-specific entries (PDF.js doesn't expose /Name for stamps)
      if (subtypeName === '/Stamp') {
        const nameRaw = annotDict.get(PDFName.of('Name'));
        if (nameRaw) {
          const n = context.lookup(nameRaw) || nameRaw;
          const nameStr = n.toString().replace('/', '');
          if (nameStr) colors.stampPdfName = nameStr;
        }
        const opsNameRaw = annotDict.get(PDFName.of('OPS_StampName'));
        if (opsNameRaw) {
          const on = context.lookup(opsNameRaw) || opsNameRaw;
          if (on && typeof on.value === 'string') colors.stampName = on.value;
          else if (on && typeof on.decodeText === 'function') colors.stampName = on.decodeText();
        }
      }

      // Read /OPS_Rotation (our custom rotation key) for ALL annotation types
      const opsRotRaw = annotDict.get(PDFName.of('OPS_Rotation'));
      if (opsRotRaw) {
        const rv = pdfNum(context.lookup(opsRotRaw) || opsRotRaw);
        if (rv !== null) colors.rotation = rv;
      }

      // Read /OPS_HeadSize (our custom arrowhead size for dimension annotations)
      const opsHsRaw = annotDict.get(PDFName.of('OPS_HeadSize'));
      if (opsHsRaw) {
        const hs = pdfNum(context.lookup(opsHsRaw) || opsHsRaw);
        if (hs !== null) colors.opsHeadSize = hs;
      }

      // Read /OPS_Precision (our custom decimal precision for measurement annotations)
      const opsPrecRaw = annotDict.get(PDFName.of('OPS_Precision'));
      if (opsPrecRaw) {
        const prec = pdfNum(context.lookup(opsPrecRaw) || opsPrecRaw);
        if (prec !== null) colors.opsPrecision = prec;
      }

      // Read /OPS_Subtype (our custom subtype for cloud/cloudPolyline/measurements)
      const opsSubRaw = annotDict.get(PDFName.of('OPS_Subtype'));
      if (opsSubRaw) {
        const sub = context.lookup(opsSubRaw) || opsSubRaw;
        if (sub && typeof sub.value === 'string') {
          colors.opsSubtype = sub.value;
        } else if (sub && typeof sub.decodeText === 'function') {
          colors.opsSubtype = sub.decodeText();
        }
      }

      // Read /OPS_PixelsPerUnit, /OPS_Unit, /OPS_ScaleRatio, /OPS_Divisions, /OPS_TotalUnits (viewport/scaleBar)
      const opsPpuRaw = annotDict.get(PDFName.of('OPS_PixelsPerUnit'));
      if (opsPpuRaw) {
        const ppu = pdfNum(context.lookup(opsPpuRaw) || opsPpuRaw);
        if (ppu !== null) colors.opsPixelsPerUnit = ppu;
      }
      const opsUnitRaw = annotDict.get(PDFName.of('OPS_Unit'));
      if (opsUnitRaw) {
        const u = context.lookup(opsUnitRaw) || opsUnitRaw;
        if (u && typeof u.value === 'string') colors.opsUnit = u.value;
        else if (u && typeof u.decodeText === 'function') colors.opsUnit = u.decodeText();
      }
      const opsSrRaw = annotDict.get(PDFName.of('OPS_ScaleRatio'));
      if (opsSrRaw) {
        const sr = context.lookup(opsSrRaw) || opsSrRaw;
        if (sr && typeof sr.value === 'string') colors.opsScaleRatio = sr.value;
        else if (sr && typeof sr.decodeText === 'function') colors.opsScaleRatio = sr.decodeText();
      }
      const opsDivRaw = annotDict.get(PDFName.of('OPS_Divisions'));
      if (opsDivRaw) {
        const div = pdfNum(context.lookup(opsDivRaw) || opsDivRaw);
        if (div !== null) colors.opsDivisions = div;
      }
      const opsTuRaw = annotDict.get(PDFName.of('OPS_TotalUnits'));
      if (opsTuRaw) {
        const tu = pdfNum(context.lookup(opsTuRaw) || opsTuRaw);
        if (tu !== null) colors.opsTotalUnits = tu;
      }
      const opsLwRaw = annotDict.get(PDFName.of('OPS_LineWidth'));
      if (opsLwRaw) {
        const lw = pdfNum(context.lookup(opsLwRaw) || opsLwRaw);
        if (lw !== null) colors.opsLineWidth = lw;
      }

      const opsScheduleRaw = annotDict.get(PDFName.of('OPS_ScheduleData'));
      if (opsScheduleRaw) {
        const sd = context.lookup(opsScheduleRaw) || opsScheduleRaw;
        if (sd && typeof sd.value === 'string') colors.opsScheduleData = sd.value;
        else if (sd && typeof sd.decodeText === 'function') colors.opsScheduleData = sd.decodeText();
      }
      const opsGroupByRaw = annotDict.get(PDFName.of('OPS_GroupBy'));
      if (opsGroupByRaw) {
        const gb = context.lookup(opsGroupByRaw) || opsGroupByRaw;
        if (gb && typeof gb.value === 'string') colors.opsGroupBy = gb.value;
        else if (gb && typeof gb.decodeText === 'function') colors.opsGroupBy = gb.decodeText();
      }

      const opsArRaw = annotDict.get(PDFName.of('OPS_ArcRadius'));
      if (opsArRaw) {
        const ar = pdfNum(context.lookup(opsArRaw) || opsArRaw);
        if (ar !== null) colors.opsArcRadius = ar;
      }

      // Read /OPS_Holes (our custom holes data for measureArea with cutouts)
      const opsHolesRaw = annotDict.get(PDFName.of('OPS_Holes'));
      if (opsHolesRaw) {
        const holesArr = context.lookup(opsHolesRaw) || opsHolesRaw;
        if (holesArr && typeof holesArr.size === 'function') {
          const holes = [];
          for (let hi = 0; hi < holesArr.size(); hi++) {
            const holeRaw = context.lookup(holesArr.get(hi)) || holesArr.get(hi);
            if (holeRaw && typeof holeRaw.size === 'function') {
              const holePoints = [];
              for (let pi = 0; pi + 1 < holeRaw.size(); pi += 2) {
                const hx = pdfNum(context.lookup(holeRaw.get(pi)) || holeRaw.get(pi));
                const hy = pdfNum(context.lookup(holeRaw.get(pi + 1)) || holeRaw.get(pi + 1));
                if (hx !== null && hy !== null) {
                  holePoints.push({ x: hx, y: hy });
                }
              }
              if (holePoints.length >= 3) holes.push(holePoints);
            }
          }
          if (holes.length > 0) colors.holes = holes;
        }
      }

      // Read /IT (Intent) for measurement annotations
      const itRaw = annotDict.get(PDFName.of('IT'));
      if (itRaw) {
        const it = context.lookup(itRaw) || itRaw;
        const itStr = it.toString();
        if (itStr) colors.intent = itStr.replace('/', '');
      }

      // Check for /Measure dictionary (PDF measurement annotations)
      const measureRaw = annotDict.get(PDFName.of('Measure'));
      if (measureRaw) {
        colors.hasMeasure = true;
        // Extract scale, unit, and precision from Measure NumberFormat dictionaries
        const measureDict = context.lookup(measureRaw);
        if (measureDict) {
          // Helper: read a single NumberFormat dict, extract C (scale), U (unit), D (precision)
          const readOneNF = (dict) => {
            if (!dict || typeof dict.get !== 'function') return null;
            const result = {};
            const cRaw = dict.get(PDFName.of('C'));
            const cVal = pdfNum(context.lookup(cRaw) || cRaw);
            if (cVal !== null && cVal > 0) result.scale = cVal;
            const uRaw = dict.get(PDFName.of('U'));
            if (uRaw) {
              const uStr = (context.lookup(uRaw) || uRaw);
              if (typeof uStr.decodeText === 'function') result.unit = uStr.decodeText();
              else if (typeof uStr.value === 'string') result.unit = uStr.value;
              else result.unit = uStr.toString().replace(/[()\/]/g, '');
            }
            const dRaw = dict.get(PDFName.of('D'));
            if (dRaw) {
              const dVal = pdfNum(context.lookup(dRaw) || dRaw);
              if (dVal !== null && dVal >= 0) result.precision = dVal;
            }
            return Object.keys(result).length > 0 ? result : null;
          };

          // Read a NumberFormat array: multiply C values across the chain,
          // take U and D from the last element (the display unit/precision).
          const readNumberFormat = (nfRaw) => {
            if (!nfRaw) return null;
            const arr = context.lookup(nfRaw);
            if (!arr) return null;
            // Single dict (not array)
            if (typeof arr.size !== 'function') return readOneNF(arr);
            const count = arr.size();
            if (count === 0) return null;
            // Read all elements: cumulative scale, last element's unit and precision
            let cumulativeScale = 1;
            let unit = null;
            let precision = undefined;
            for (let ei = 0; ei < count; ei++) {
              const nf = readOneNF(context.lookup(arr.get(ei)));
              if (nf) {
                if (nf.scale) cumulativeScale *= nf.scale;
                if (nf.unit) unit = nf.unit;
                if (nf.precision !== undefined) precision = nf.precision;
              }
            }
const result = {};
            if (cumulativeScale > 0) result.scale = cumulativeScale;
            if (unit) result.unit = unit;
            if (precision !== undefined) result.precision = precision;
            return Object.keys(result).length > 0 ? result : null;
          };

          // /X = per-pixel scale factor and unit
          const xFmt = readNumberFormat(measureDict.get(PDFName.of('X')));
          if (xFmt && xFmt.scale) {
            colors.measureScale = xFmt.scale;
            if (xFmt.unit) colors.measureUnit = xFmt.unit;
          }
          // /D = distance display format — its D value is a denominator (e.g. 100000 = 5 decimals)
          // Fallback to /X precision for annotations without /D (e.g. simple Line dimensions)
          const dFmt = readNumberFormat(measureDict.get(PDFName.of('D')));
          if (dFmt && dFmt.precision !== undefined && dFmt.precision > 1) {
            colors.measurePrecision = Math.round(Math.log10(dFmt.precision));
          } else if (xFmt && xFmt.precision !== undefined) {
            colors.measurePrecision = xFmt.precision;
          }
          // /A = area display format — D value is also a denominator
          const aFmt = readNumberFormat(measureDict.get(PDFName.of('A')));
          if (aFmt && aFmt.unit) {
            colors.measureAreaUnit = aFmt.unit;
          }
          if (aFmt && aFmt.precision !== undefined && aFmt.precision > 1) {
            colors.measureAreaPrecision = Math.round(Math.log10(aFmt.precision));
          }
        }
      }

      // Read BS/D (dash array) to distinguish dashed from dotted
      const bsRaw = annotDict.get(PDFName.of('BS'));
      if (bsRaw) {
        const bsDict = context.lookup(bsRaw);
        if (bsDict) {
          const dRaw = bsDict.get(PDFName.of('D'));
          if (dRaw) {
            const dArr = context.lookup(dRaw) || dRaw;
            if (dArr && typeof dArr.size === 'function' && dArr.size() >= 2) {
              const d0 = pdfNum(dArr.get(0));
              const d1 = pdfNum(dArr.get(1));
              // Short dash segments (<=3) indicate dotted; longer ones are dashed
              if (d0 !== null && d0 <= 3 && d1 !== null && d1 <= 3) {
                colors.borderStyle = 'dotted';
              } else {
                colors.borderStyle = 'dashed';
              }
            }
          }
        }
      }

      // IC and type-specific extraction only for shape/text annotations
      const needsIcTypes = ['/FreeText', '/Square', '/Circle', '/Line', '/PolyLine', '/Polygon'];
      if (needsIcTypes.includes(subtypeName)) {
        // Read IC (Interior Color) entry
        const icRaw = annotDict.get(PDFName.of('IC'));
        if (icRaw) {
          const ic = context.lookup(icRaw);
          colors.ic = pdfColorToHex(ic, context);
        }

        // For Line annotations, read original /L array (PDF.js normalizeRect destroys direction)
        if (subtypeName === '/Line') {
          const lRaw = annotDict.get(PDFName.of('L'));
          if (lRaw) {
            const lArr = context.lookup(lRaw) || lRaw;
            if (lArr && typeof lArr.size === 'function' && lArr.size() >= 4) {
              colors.lineCoords = [
                pdfNum(lArr.get(0)),
                pdfNum(lArr.get(1)),
                pdfNum(lArr.get(2)),
                pdfNum(lArr.get(3))
              ];
            }
          }
          // Read leader line properties for dimension annotations
          const llRaw = annotDict.get(PDFName.of('LL'));
          if (llRaw) {
            const llVal = pdfNum(context.lookup(llRaw) || llRaw);
            if (llVal !== null) colors.leaderLength = llVal;
          }
          const lleRaw = annotDict.get(PDFName.of('LLE'));
          if (lleRaw) {
            const lleVal = pdfNum(context.lookup(lleRaw) || lleRaw);
            if (lleVal !== null) colors.leaderExtension = lleVal;
          }
          const lloRaw = annotDict.get(PDFName.of('LLO'));
          if (lloRaw) {
            const lloVal = pdfNum(context.lookup(lloRaw) || lloRaw);
            if (lloVal !== null) colors.leaderOffset = lloVal;
          }
          // Read caption properties
          const capRaw = annotDict.get(PDFName.of('Cap'));
          if (capRaw) colors.hasCaption = true;
          const cpRaw = annotDict.get(PDFName.of('CP'));
          if (cpRaw) {
            const cpVal = (context.lookup(cpRaw) || cpRaw).toString();
            colors.captionPosition = cpVal.replace('/', '');
          }
          const coRaw = annotDict.get(PDFName.of('CO'));
          if (coRaw) {
            const coArr = context.lookup(coRaw) || coRaw;
            if (coArr && typeof coArr.size === 'function' && coArr.size() >= 2) {
              colors.captionOffset = [pdfNum(coArr.get(0)), pdfNum(coArr.get(1))];
            }
          }
        }
      }

      // For FreeText, extract border width from /BS or /Border, rotation, and stroke color
      if (subtypeName === '/FreeText') {
        // Read /BS (Border Style) dictionary → /W entry
        const bsRaw = annotDict.get(PDFName.of('BS'));
        if (bsRaw) {
          const bs = context.lookup(bsRaw);
          if (bs) {
            const wRaw = bs.get(PDFName.of('W'));
            if (wRaw) {
              const w = pdfNum(context.lookup(wRaw) || wRaw);
              if (w !== null) colors.borderWidth = w;
            }
          }
        }
        // Fallback: /Border array [H V W] - third element is width
        if (colors.borderWidth === undefined) {
          const borderRaw = annotDict.get(PDFName.of('Border'));
          if (borderRaw) {
            const border = context.lookup(borderRaw) || borderRaw;
            if (border && typeof border.size === 'function' && border.size() >= 3) {
              const w = pdfNum(border.get(2));
              if (w !== null) colors.borderWidth = w;
            }
          }
        }

        // Extract font family from /DR (default resources) → /Font → /BaseFont
        const daRaw = annotDict.get(PDFName.of('DA'));
        const drRaw = annotDict.get(PDFName.of('DR'));
        if (daRaw && drRaw) {
          try {
            const daStr = daRaw.toString?.() || '';
            // Get font reference name from DA string, e.g. "/Helv 12 Tf" → "Helv"
            const daFontMatch = daStr.match(/\/([^\s)]+)\s+[\d.]+\s+Tf/);
            if (daFontMatch) {
              const fontRef = daFontMatch[1];
              const dr = context.lookup(drRaw);
              if (dr) {
                const fontDictRaw = dr.get(PDFName.of('Font'));
                if (fontDictRaw) {
                  const fontDict = context.lookup(fontDictRaw);
                  if (fontDict) {
                    const fontObjRaw = fontDict.get(PDFName.of(fontRef));
                    if (fontObjRaw) {
                      const fontObj = context.lookup(fontObjRaw);
                      if (fontObj) {
                        const baseFont = fontObj.get(PDFName.of('BaseFont'));
                        if (baseFont) {
                          const fontInfo = mapPdfFontName(baseFont.toString());
                          if (fontInfo) {
                            colors.fontFamily = fontInfo.family;
                            if (fontInfo.bold) colors.fontBold = true;
                            if (fontInfo.italic) colors.fontItalic = true;
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch (e) { /* ignore font extraction errors */ }
        }

        // Extract text styles from /RC (Rich Content) XHTML string
        const rcRaw = annotDict.get(PDFName.of('RC'));
        if (rcRaw) {
          try {
            const rcStr = rcRaw.toString?.() || '';
            if (rcStr) {
              // Check for text-decoration in style attributes
              const decoMatch = rcStr.match(/text-decoration\s*:\s*([^;"']+)/i);
              if (decoMatch) {
                const deco = decoMatch[1].toLowerCase();
                if (deco.includes('underline')) colors.fontUnderline = true;
                if (deco.includes('line-through')) colors.fontStrikethrough = true;
              }
              // Also check for bold/italic in RC if not already detected from font name
              if (!colors.fontBold) {
                const weightMatch = rcStr.match(/font-weight\s*:\s*([^;"']+)/i);
                if (weightMatch && /bold|[7-9]00/i.test(weightMatch[1])) {
                  colors.fontBold = true;
                }
              }
              if (!colors.fontItalic) {
                const styleMatch = rcStr.match(/font-style\s*:\s*([^;"']+)/i);
                if (styleMatch && /italic|oblique/i.test(styleMatch[1])) {
                  colors.fontItalic = true;
                }
              }
              // Extract line-height from RC (stored as absolute pt value, convert to multiplier)
              const lhMatch = rcStr.match(/line-height\s*:\s*([\d.]+)/i);
              if (lhMatch) {
                colors.rawLineHeight = parseFloat(lhMatch[1]);
              }
            }
          } catch (e) { /* ignore RC parsing errors */ }
        }

        // Extract /DS (Default Style) for font-size fallback
        const dsRaw = annotDict.get(PDFName.of('DS'));
        if (dsRaw) {
          try {
            const dsStr = dsRaw.toString?.() || '';
            const fsSizeMatch = dsStr.match(/font-size\s*:\s*([\d.]+)\s*pt/i);
            if (fsSizeMatch) {
              colors.dsFontSize = parseFloat(fsSizeMatch[1]);
            }
            if (!colors.rawLineHeight) {
              const lhMatch = dsStr.match(/line-height\s*:\s*([\d.]+)/i);
              if (lhMatch) {
                colors.rawLineHeight = parseFloat(lhMatch[1]);
              }
            }
          } catch (e) { /* ignore DS parsing errors */ }
        }

        // Extract /OPS_Rotation (our custom key only — ignore standard /Rotation
        // which other tools use for text orientation, not whole-annotation rotation)
        const opsRotRaw = annotDict.get(PDFName.of('OPS_Rotation'));
        if (opsRotRaw) {
          const rv = pdfNum(context.lookup(opsRotRaw) || opsRotRaw);
          if (rv !== null) colors.rotation = rv;
        }

        // Extract /C (Color) entry directly for FreeText — needed for callout stroke detection
        const cRaw = annotDict.get(PDFName.of('C'));
        if (cRaw) {
          colors.cColor = pdfColorToHex(context.lookup(cRaw) || cRaw, context);
        }

        // Extract /CL (Callout Line) array — pdf.js doesn't expose this
        const clRaw = annotDict.get(PDFName.of('CL'));
        if (clRaw) {
          const cl = context.lookup(clRaw) || clRaw;
          if (cl && typeof cl.size === 'function') {
            const clArr = [];
            for (let ci = 0; ci < cl.size(); ci++) {
              const v = pdfNum(cl.get(ci));
              if (v !== null) clArr.push(v);
            }
            if (clArr.length >= 4) colors.calloutLine = clArr;
          }
        }

        // Extract /RD (Rectangle Differences) — insets from Rect to actual text box
        const rdRaw = annotDict.get(PDFName.of('RD'));
        if (rdRaw) {
          const rd = context.lookup(rdRaw) || rdRaw;
          if (rd && typeof rd.size === 'function' && rd.size() >= 4) {
            colors.rectDiff = [pdfNum(rd.get(0)), pdfNum(rd.get(1)), pdfNum(rd.get(2)), pdfNum(rd.get(3))];
          }
        }

        const apRaw = annotDict.get(PDFName.of('AP'));
        if (apRaw) {
          const ap = context.lookup(apRaw);
          if (ap) {
            const nRaw = ap.get(PDFName.of('N'));
            if (nRaw) {
              const nStream = context.lookup(nRaw);
              if (nStream) {
                const nDict = nStream.dict || nStream;

                // Extract rotation from /Matrix [a, b, c, d, e, f]
                // The Matrix maps form BBox to annotation Rect (includes page rotation)
                const matrixRaw = nDict.get(PDFName.of('Matrix'));
                if (matrixRaw) {
                  const matrix = context.lookup(matrixRaw) || matrixRaw;
                  if (matrix && typeof matrix.size === 'function' && matrix.size() >= 4) {
                    const a = pdfNum(matrix.get(0));
                    const b = pdfNum(matrix.get(1));
                    if (a !== null && b !== null) {
                      colors.matrixAngle = Math.round(Math.atan2(b, a) * 180 / Math.PI * 100) / 100;
                    }
                  }
                }

                // Extract font from AP/N Resources → Font → BaseFont (fallback when /DR is missing)
                if (!colors.fontFamily) {
                  try {
                    const resRaw = nDict.get(PDFName.of('Resources'));
                    if (resRaw) {
                      const res = context.lookup(resRaw);
                      if (res) {
                        const apFontDictRaw = res.get(PDFName.of('Font'));
                        if (apFontDictRaw) {
                          const apFontDict = context.lookup(apFontDictRaw);
                          if (apFontDict) {
                            // Get the font reference name from DA string
                            const daRawForAP = annotDict.get(PDFName.of('DA'));
                            const daStrForAP = daRawForAP?.toString?.() || '';
                            const daFontRef = daStrForAP.match(/\/([^\s)]+)\s+[\d.]+\s+Tf/);
                            const refName = daFontRef ? daFontRef[1] : null;

                            // Try specific font ref first, then iterate all fonts
                            const fontKeysToTry = refName ? [refName] : [];
                            if (apFontDict.entries) {
                              for (const [key] of apFontDict.entries()) {
                                const k = key.toString().replace(/^\//, '');
                                if (k !== refName) fontKeysToTry.push(k);
                              }
                            }

                            for (const fk of fontKeysToTry) {
                              const fObjRaw = apFontDict.get(PDFName.of(fk));
                              if (fObjRaw) {
                                const fObj = context.lookup(fObjRaw);
                                if (fObj) {
                                  const bf = fObj.get(PDFName.of('BaseFont'));
                                  if (bf) {
                                    const fontInfo = mapPdfFontName(bf.toString());
                                    if (fontInfo) {
                                      colors.fontFamily = fontInfo.family;
                                      if (fontInfo.bold) colors.fontBold = true;
                                      if (fontInfo.italic) colors.fontItalic = true;
                                      break;
                                    }
                                  }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  } catch (e) { /* ignore AP font extraction errors */ }
                }

                // Extract BBox - original unrotated dimensions of the textbox
                const bboxRaw = nDict.get(PDFName.of('BBox'));
                if (bboxRaw) {
                  const bbox = context.lookup(bboxRaw) || bboxRaw;
                  if (bbox && typeof bbox.size === 'function' && bbox.size() >= 4) {
                    colors.bboxWidth = Math.abs(pdfNum(bbox.get(2)) - pdfNum(bbox.get(0)));
                    colors.bboxHeight = Math.abs(pdfNum(bbox.get(3)) - pdfNum(bbox.get(1)));
                  }
                }

                // Extract stroke color from content stream (or referenced XObjects)
                if (!colors.ic) {
                  const decodeStream = async (stream) => {
                    let bytes;
                    if (typeof stream.getContents === 'function') bytes = stream.getContents();
                    else if (typeof stream.contents === 'function') bytes = stream.contents();
                    else if (stream.contentsCache?.value) bytes = stream.contentsCache.value;
                    if (!bytes) return null;
                    const dict = stream.dict || stream;
                    const filterRaw = dict.get(PDFName.of('Filter'));
                    const filterName = filterRaw?.toString();
                    if (filterName === '/FlateDecode') {
                      const dec = await inflateBytes(bytes);
                      return dec ? new TextDecoder().decode(dec) : null;
                    }
                    return new TextDecoder().decode(bytes);
                  };

                  let content = await decodeStream(nStream);
                  let rgMatch = content ? content.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/) : null;

                  // If not found, follow XObject form references (e.g. /Fm0 Do)
                  if (!rgMatch && content) {
                    const xobjMatch = content.match(/\/(\S+)\s+Do/);
                    if (xobjMatch) {
                      try {
                        const resRaw = nDict.get(PDFName.of('Resources'));
                        const res = resRaw ? context.lookup(resRaw) : null;
                        const xobjDictRaw = res ? res.get(PDFName.of('XObject')) : null;
                        const xobjDict = xobjDictRaw ? context.lookup(xobjDictRaw) : null;
                        const fmRaw = xobjDict ? xobjDict.get(PDFName.of(xobjMatch[1])) : null;
                        const fmStream = fmRaw ? context.lookup(fmRaw) : null;
                        if (fmStream) {
                          const fmContent = await decodeStream(fmStream);
                          if (fmContent) {
                            rgMatch = fmContent.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+RG/);
                          }
                        }
                      } catch (e) { /* ignore XObject extraction errors */ }
                    }
                  }

                  if (rgMatch) {
                    const r = parseFloat(rgMatch[1]), g = parseFloat(rgMatch[2]), b = parseFloat(rgMatch[3]);
                    colors.apStrokeColor = `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
                  }
                }
              }
            }
          }
        }
      }

      // For non-FreeText annotations, extract rotation Matrix and BBox from AP/N stream
      if (subtypeName !== '/FreeText' && colors.matrixAngle === undefined) {
        const apRaw2 = annotDict.get(PDFName.of('AP'));
        if (apRaw2) {
          const ap2 = context.lookup(apRaw2);
          if (ap2) {
            const nRaw2 = ap2.get(PDFName.of('N'));
            if (nRaw2) {
              const nStream2 = context.lookup(nRaw2);
              if (nStream2) {
                const nDict2 = nStream2.dict || nStream2;

                // Extract rotation from /Matrix [a, b, c, d, e, f]
                const matrixRaw2 = nDict2.get(PDFName.of('Matrix'));
                if (matrixRaw2) {
                  const matrix2 = context.lookup(matrixRaw2) || matrixRaw2;
                  if (matrix2 && typeof matrix2.size === 'function' && matrix2.size() >= 4) {
                    const a2 = pdfNum(matrix2.get(0));
                    const b2 = pdfNum(matrix2.get(1));
                    if (a2 !== null && b2 !== null) {
                      colors.matrixAngle = Math.round(Math.atan2(b2, a2) * 180 / Math.PI * 100) / 100;
                    }
                  }
                }

                // Extract BBox - original unrotated dimensions
                const bboxRaw2 = nDict2.get(PDFName.of('BBox'));
                if (bboxRaw2) {
                  const bbox2 = context.lookup(bboxRaw2) || bboxRaw2;
                  if (bbox2 && typeof bbox2.size === 'function' && bbox2.size() >= 4) {
                    colors.bboxWidth = Math.abs(pdfNum(bbox2.get(2)) - pdfNum(bbox2.get(0)));
                    colors.bboxHeight = Math.abs(pdfNum(bbox2.get(3)) - pdfNum(bbox2.get(1)));
                  }
                }
              }
            }
          }
        }
      }

      // Convert absolute line-height (pt) to multiplier using font size
      if (colors.rawLineHeight) {
        // Get font size from DA string
        const daRawForLH = annotDict.get(PDFName.of('DA'));
        const daStrLH = daRawForLH?.toString?.() || '';
        const fsSizeMatch = daStrLH.match(/([\d.]+)\s+Tf/);
        const fsVal = fsSizeMatch ? parseFloat(fsSizeMatch[1]) : (colors.dsFontSize || 12);
        if (fsVal > 0) {
          const ratio = Math.round(colors.rawLineHeight / fsVal * 100) / 100;
          if (ratio >= 0.5 && ratio <= 5) colors.lineSpacing = ratio;
        }
        delete colors.rawLineHeight;
      }

      if (Object.keys(colors).length > 0) {
        colorMap.set(key, colors);
      }
    }
  } catch (e) {
    console.warn('Failed to extract annotation colors:', e);
  }
  return colorMap;
}
