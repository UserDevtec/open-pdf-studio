import { state, getActiveDocument } from '../core/state.js';
import { openDialog } from '../bridge.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { savePreferences } from '../core/preferences.js';

// Scale calibration: pixels per unit
// Per-document scale takes priority, then legacy global preference, then default (px)
export function getMeasureScale() {
  // 1. Per-document scale
  const docScale = state.measureScale;
  if (docScale && docScale.pixelsPerUnit > 0) {
    return { pixelsPerUnit: docScale.pixelsPerUnit, unit: docScale.unit || 'px' };
  }
  // 2. Legacy global preference
  const ms = state.preferences.measureScale;
  if (ms && ms.pixelsPerUnit > 0) {
    return { pixelsPerUnit: ms.pixelsPerUnit, unit: ms.unit || 'px' };
  }
  return { pixelsPerUnit: 1, unit: 'px' };
}

// Snap an endpoint so that the distance from (fromX,fromY) to the result
// is rounded to the nearest N measured units (N from preferences).  Returns { x, y }.
export function snapDistanceTo10(fromX, fromY, toX, toY) {
  const dx = toX - fromX, dy = toY - fromY;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  if (pixelDist === 0) return { x: toX, y: toY };
  const step = state.preferences.measureCtrlSnap || 10;
  const ms = getMeasureScale();
  const measuredValue = pixelDist / ms.pixelsPerUnit;
  const snappedValue = Math.max(Math.round(measuredValue / step) * step, step);
  const ratio = (snappedValue * ms.pixelsPerUnit) / pixelDist;
  return { x: fromX + dx * ratio, y: fromY + dy * ratio };
}

// Calculate distance between two points
export function calculateDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const pixelDist = Math.sqrt(dx * dx + dy * dy);
  const scale = getMeasureScale();
  return {
    value: pixelDist / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: pixelDist
  };
}

// Calculate area of a polygon (using shoelace formula)
export function calculateArea(points) {
  if (!points || points.length < 3) return { value: 0, unit: 'px\u00B2', pixels: 0 };

  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  area = Math.abs(area) / 2;

  const scale = getMeasureScale();
  const scaledArea = area / (scale.pixelsPerUnit * scale.pixelsPerUnit);
  return {
    value: scaledArea,
    unit: scale.unit + '\u00B2',
    pixels: area
  };
}

// Calculate perimeter of a polyline
export function calculatePerimeter(points) {
  if (!points || points.length < 2) return { value: 0, unit: 'px', pixels: 0 };

  let totalPixels = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    totalPixels += Math.sqrt(dx * dx + dy * dy);
  }

  const scale = getMeasureScale();
  return {
    value: totalPixels / scale.pixelsPerUnit,
    unit: scale.unit,
    pixels: totalPixels
  };
}

// Apply measurement rounding based on preference
function applyRounding(value, unit) {
  const rounding = state.preferences.measureRounding;
  if (!rounding || rounding === 'none' || unit === 'px') return value;
  const step = parseFloat(rounding);
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

// Format measurement for display
export function formatMeasurement(measurement) {
  const val = applyRounding(measurement.value, measurement.unit);
  const suffix = measurement.unit === 'px' ? '' : ` ${measurement.unit}`;
  const rounding = state.preferences.measureRounding;
  if (rounding && rounding !== 'none' && measurement.unit !== 'px') {
    const step = parseFloat(rounding);
    // Show appropriate decimal places based on rounding step
    if (step >= 1) return `${Math.round(val)}${suffix}`;
    return `${val.toFixed(1)}${suffix}`;
  }
  if (val < 0.01) return `0${suffix}`;
  if (val < 1) return `${val.toFixed(3)}${suffix}`;
  if (val < 100) return `${val.toFixed(2)}${suffix}`;
  return `${val.toFixed(1)}${suffix}`;
}

// Show scale calibration dialog, optionally with a reference pixel length
export function showCalibrationDialog(referencePixelLength) {
  openDialog('calibration', { referencePixelLength: referencePixelLength || null });
}

// Set scale from a known line: given its pixel length and the real-world value + unit,
// update the document scale for future measurements.
// The source annotation's own measureScale/measureUnit are updated so the properties panel reflects the change.
export function setScaleFromLine(pixelLength, realValue, unit, sourceAnnotation) {
  if (!pixelLength || pixelLength <= 0 || !realValue || realValue <= 0) return;
  const pixelsPerUnit = pixelLength / realValue;
  const doc = getActiveDocument();
  if (!doc) return;
  doc.measureScale = { pixelsPerUnit, unit, method: 'quick-scale', scaleRatio: 0 };
  saveDocumentScale();

  // Update default preferences so future measurements use this scale/unit
  const scaleVal = realValue / pixelLength;
  state.preferences.measureDistDimScale = scaleVal;
  state.preferences.measureDistDimUnit = unit;
  state.preferences.measureAreaDimScale = scaleVal;
  state.preferences.measureAreaDimUnit = unit;
  state.preferences.measurePerimDimScale = scaleVal;
  state.preferences.measurePerimDimUnit = unit;
  savePreferences();

  // Update the source annotation's own scale/unit properties
  if (sourceAnnotation && sourceAnnotation.type === 'measureDistance') {
    sourceAnnotation.measureScale = realValue / pixelLength;
    sourceAnnotation.measureUnit = unit;
    const prec = sourceAnnotation.measurePrecision !== undefined ? sourceAnnotation.measurePrecision : 2;
    sourceAnnotation.measureText = `${realValue.toFixed(prec)} ${unit}`;

    // Redraw canvas
    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    // Refresh properties panel if this annotation is selected
    if (state.selectedAnnotation === sourceAnnotation) {
      import('../bridge.js').then(m => m.storeShowProperties(sourceAnnotation));
    }
  }
}

// Recalculate all measurement annotations after scale change
export function recalculateAllMeasurements() {
  const doc = getActiveDocument();
  if (!doc) return;

  const scale = getMeasureScale();

  for (const ann of doc.annotations) {
    if (ann.type === 'measureDistance') {
      const pixels = ann.measurePixels || Math.sqrt(
        (ann.endX - ann.startX) ** 2 + (ann.endY - ann.startY) ** 2
      );
      const value = pixels / scale.pixelsPerUnit;
      ann.measureValue = value;
      ann.measureUnit = scale.unit;
      ann.measureText = formatMeasurement({ value, unit: scale.unit });
    } else if (ann.type === 'measureArea') {
      if (ann.points && ann.points.length >= 3) {
        const area = calculateArea(ann.points);
        ann.measureValue = area.value;
        ann.measureUnit = area.unit;
        ann.measureText = formatMeasurement(area);
      }
    } else if (ann.type === 'measurePerimeter') {
      if (ann.points && ann.points.length >= 2) {
        const perim = calculatePerimeter(ann.points);
        ann.measureValue = perim.value;
        ann.measureUnit = perim.unit;
        ann.measureText = formatMeasurement(perim);
      }
    }
  }

  // Redraw canvas
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// LocalStorage key for per-document scale persistence
function scaleStorageKey(filePath) {
  return 'ops_measureScale_' + filePath;
}

// Save the current document's measure scale to localStorage
export function saveDocumentScale() {
  const doc = getActiveDocument();
  if (!doc || !doc.filePath) return;
  const ms = doc.measureScale;
  if (ms) {
    try {
      localStorage.setItem(scaleStorageKey(doc.filePath), JSON.stringify(ms));
    } catch { /* quota exceeded or private mode */ }
  } else {
    localStorage.removeItem(scaleStorageKey(doc.filePath));
  }
}

// Load measure scale from localStorage into the given (or active) document
export function loadDocumentScale(doc) {
  if (!doc) doc = getActiveDocument();
  if (!doc || !doc.filePath) return;
  try {
    const raw = localStorage.getItem(scaleStorageKey(doc.filePath));
    if (raw) {
      doc.measureScale = JSON.parse(raw);
    }
  } catch { /* corrupted data */ }
}
