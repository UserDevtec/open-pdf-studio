import { drawDimensionLineEnding } from './decorations.js';
import { applyHatchFillPolygon } from './hatch-patterns.js';
import { arcControlPoint } from '../measurement.js';

/**
 * Trace a polygon path on the canvas context, supporting arc segments.
 * Points with `arc: true` are drawn as quadratic bezier curves; others as straight lines.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array} points - polygon vertices, some may have .arc and .bulge
 * @param {boolean} close - whether to closePath
 */
function _tracePolygonPath(ctx, points, close) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    if (points[i].arc) {
      const cp = arcControlPoint(points[i - 1], points[i]);
      ctx.quadraticCurveTo(cp.x, cp.y, points[i].x, points[i].y);
    } else {
      ctx.lineTo(points[i].x, points[i].y);
    }
  }
  if (close) {
    // The closing segment from last point back to first
    if (points[0].arc) {
      const cp = arcControlPoint(points[points.length - 1], points[0]);
      ctx.quadraticCurveTo(cp.x, cp.y, points[0].x, points[0].y);
    }
    ctx.closePath();
  }
}

// Draw a complete dimension annotation (extension lines, dimension line, endings, label)
export function drawDimension(ctx, opts) {
  const {
    startX, startY, endX, endY,
    leaderStartX, leaderStartY, leaderEndX, leaderEndY,
    startHead = 'openCircle', endHead = 'openCircle', headSize = 12,
    color, measureText
  } = opts;

  const mdAngle = Math.atan2(endY - startY, endX - startX);
  const hasLeaders = leaderStartX !== undefined && leaderStartY !== undefined;

  if (hasLeaders) {
    // Extension lines with overshoot past dimension line
    const perpDx = -Math.sin(mdAngle);
    const perpDy = Math.cos(mdAngle);
    const lsDx = startX - leaderStartX;
    const lsDy = startY - leaderStartY;
    const leaderDir = (lsDx * perpDx + lsDy * perpDy) > 0 ? 1 : -1;
    const overshoot = Math.max(10, Math.sin(Math.PI / 6) * headSize);
    const extDx = perpDx * overshoot * leaderDir;
    const extDy = perpDy * overshoot * leaderDir;

    ctx.beginPath();
    ctx.moveTo(leaderStartX, leaderStartY);
    ctx.lineTo(startX + extDx, startY + extDy);
    ctx.moveTo(leaderEndX, leaderEndY);
    ctx.lineTo(endX + extDx, endY + extDy);
    ctx.stroke();
  }

  // Dimension line
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Line endings
  ctx.fillStyle = color;
  if (startHead !== 'none') {
    drawDimensionLineEnding(ctx, startX, startY, mdAngle + Math.PI, headSize, startHead);
  }
  if (endHead !== 'none') {
    drawDimensionLineEnding(ctx, endX, endY, mdAngle, headSize, endHead);
  }

  // Measurement label
  if (measureText) {
    drawDimensionLabel(ctx, startX, startY, endX, endY, measureText, color);
  }
}

// Draw a measurement label along a dimension line direction
export function drawDimensionLabel(ctx, startX, startY, endX, endY, text, color) {
  const midX = (startX + endX) / 2;
  const midY = (startY + endY) / 2;
  let textAngle = Math.atan2(endY - startY, endX - startX);
  // Keep text readable (not upside-down)
  if (textAngle > Math.PI / 2) textAngle -= Math.PI;
  else if (textAngle < -Math.PI / 2) textAngle += Math.PI;
  ctx.save();
  ctx.translate(midX, midY);
  ctx.rotate(textAngle);
  ctx.font = '11px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 0, -4);
  ctx.restore();
}

// Draw a measurement polygon (area) with outline and optional fill, supporting holes (cutouts)
// hatchOpts: optional { pattern, color, scale, angle } for hatch fill
export function drawMeasureAreaShape(ctx, points, color, lineWidth, fillColor, borderStyle, holes, hatchOpts) {
  // Use actual border style from annotation; default to dashed for backwards compat
  if (borderStyle === 'dashed') {
    ctx.setLineDash([4, 2]);
  } else if (borderStyle === 'dotted') {
    ctx.setLineDash([2, 2]);
  } else if (borderStyle) {
    // 'solid' or other explicit styles → solid line
    ctx.setLineDash([]);
  } else {
    // No borderStyle specified (created in this app) → dashed default
    ctx.setLineDash([4, 2]);
  }

  // Build combined path: outer polygon + hole sub-paths (arc-aware)
  _tracePolygonPath(ctx, points, true);

  // Add hole sub-paths
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        _tracePolygonPath(ctx, hole, true);
      }
    }
  }

  // Fill using even-odd rule so holes appear as cutouts
  if (fillColor && fillColor !== 'none' && fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.fill('evenodd');
  } else if (!fillColor) {
    // No fill specified (created in this app) → semi-transparent default
    ctx.fillStyle = color + '20';
    ctx.fill('evenodd');
  }
  // fillColor === 'none' or 'transparent' → no fill

  // Apply hatch fill pattern (default: diagonal-left red at 45°)
  if (hatchOpts && hatchOpts.pattern && hatchOpts.pattern !== 'none') {
    applyHatchFillPolygon(ctx, points, holes, hatchOpts.pattern, hatchOpts.color || color, hatchOpts.scale, hatchOpts.angle);
  }

  // Rebuild outer path for stroke (hatch clip destroys the current path)
  _tracePolygonPath(ctx, points, true);

  // Stroke outer boundary
  ctx.stroke();

  // Stroke hole boundaries separately
  if (holes && holes.length > 0) {
    for (const hole of holes) {
      if (hole && hole.length >= 3) {
        _tracePolygonPath(ctx, hole, true);
        ctx.stroke();
      }
    }
  }

  ctx.setLineDash([]);
}

// Draw a measurement label at the centroid of a set of points (or at labelX/labelY override)
// annotation (optional): if provided, reads labelX/labelY for position override and measureName for name label
export function drawCentroidLabel(ctx, points, text, color, annotation) {
  // Compute centroid as default position
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;

  // Use absolute label position if set on the annotation
  const lx = (annotation && annotation.labelX != null) ? annotation.labelX : cx;
  const ly = (annotation && annotation.labelY != null) ? annotation.labelY : cy;

  const hasName = annotation && annotation.measureName;
  const nameFont = 'bold 12px Arial';
  const valueFont = '11px Arial';
  const pad = 3;

  // Measure text widths to compute background size
  ctx.font = valueFont;
  const valueWidth = ctx.measureText(text).width;
  let nameWidth = 0;
  if (hasName) {
    ctx.font = nameFont;
    nameWidth = ctx.measureText(annotation.measureName).width;
  }
  const bgWidth = Math.max(nameWidth, valueWidth) + pad * 2;
  const lineHeight = hasName ? 14 : 0;
  const bgHeight = 13 + lineHeight + pad * 2;
  const bgX = lx - bgWidth / 2;
  const bgY = ly - 11 - lineHeight - pad;

  // Draw white background
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

  // Draw text
  ctx.textAlign = 'center';
  ctx.fillStyle = color;

  if (hasName) {
    ctx.font = nameFont;
    ctx.fillText(annotation.measureName, lx, ly - 14);
  }

  ctx.font = valueFont;
  ctx.fillText(text, lx, ly);
  ctx.textAlign = 'left';
}

// Draw a measurement polyline (perimeter) with outline and vertex markers
export function drawMeasurePerimeterShape(ctx, points, color, borderStyle) {
  if (borderStyle === 'dashed') {
    ctx.setLineDash([4, 2]);
  } else if (borderStyle === 'dotted') {
    ctx.setLineDash([2, 2]);
  } else if (borderStyle) {
    ctx.setLineDash([]);
  } else {
    ctx.setLineDash([4, 2]);
  }
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
}
