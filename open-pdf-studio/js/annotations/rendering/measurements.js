import { drawDimensionLineEnding } from './decorations.js';

// Draw a complete dimension annotation (extension lines, dimension line, endings, label)
export function drawDimension(ctx, opts) {
  const {
    startX, startY, endX, endY,
    leaderStartX, leaderStartY, leaderEndX, leaderEndY,
    startHead = 'closed', endHead = 'closed', headSize = 12,
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
    const overshoot = Math.sin(Math.PI / 6) * headSize;
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

// Draw a measurement polygon (area) with outline and optional fill
export function drawMeasureAreaShape(ctx, points, color, lineWidth, fillColor, borderStyle) {
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
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  // Use actual fill color if specified, otherwise semi-transparent
  if (fillColor && fillColor !== 'none' && fillColor !== 'transparent') {
    ctx.fillStyle = fillColor;
    ctx.fill();
  } else if (!fillColor) {
    // No fill specified (created in this app) → semi-transparent default
    ctx.fillStyle = color + '20';
    ctx.fill();
  }
  // fillColor === 'none' or 'transparent' → no fill
  ctx.stroke();
  ctx.setLineDash([]);
}

// Draw a measurement label at the centroid of a set of points
export function drawCentroidLabel(ctx, points, text, color) {
  let cx = 0, cy = 0;
  for (const p of points) { cx += p.x; cy += p.y; }
  cx /= points.length;
  cy /= points.length;
  ctx.font = '11px Arial';
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, cy);
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
