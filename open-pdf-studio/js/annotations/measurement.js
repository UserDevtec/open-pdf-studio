import { state, getActiveDocument } from '../core/state.js';
import { openDialog } from '../bridge.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';

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
