import { state } from '../core/state.js';
import { annotationCtx } from '../ui/dom-elements.js';
import { getColorPickerValue, getLineWidthValue } from '../solid/stores/ribbonStore.js';
import { redrawAnnotations, drawCloudShape } from '../annotations/rendering.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, formatMeasurement } from '../annotations/measurement.js';

export function drawArrowhead(ctx, x, y, angle, size, style) {
  const halfAngle = Math.PI / 6; // 30 degrees

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  ctx.beginPath();
  if (style === 'open' || style === 'stealth') {
    // Open arrow style - two lines
    ctx.moveTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(0, 0);
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.stroke();
  } else if (style === 'closed') {
    // Closed/filled arrow style - triangle
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * Math.tan(halfAngle));
    ctx.lineTo(-size, size * Math.tan(halfAngle));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'diamond') {
    // Diamond style
    const halfSize = size / 2;
    ctx.moveTo(0, 0);
    ctx.lineTo(-halfSize, -halfSize * 0.6);
    ctx.lineTo(-size, 0);
    ctx.lineTo(-halfSize, halfSize * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (style === 'circle') {
    // Circle style
    const radius = size / 3;
    ctx.arc(-radius, 0, radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'square') {
    // Square style
    const halfSize = size / 3;
    ctx.rect(-size / 2 - halfSize, -halfSize, halfSize * 2, halfSize * 2);
    ctx.fill();
    ctx.stroke();
  } else if (style === 'slash') {
    // Slash style - perpendicular line
    ctx.moveTo(0, -size / 2);
    ctx.lineTo(0, size / 2);
    ctx.stroke();
  }

  ctx.restore();
}

export function drawShapePreview(currentX, currentY, e) {
  redrawAnnotations();
  annotationCtx.save();
  annotationCtx.scale(state.scale, state.scale);

  const prefs = state.preferences;

  switch (state.currentTool) {
    case 'highlight':
      annotationCtx.fillStyle = prefs.highlightColor || getColorPickerValue();
      annotationCtx.globalAlpha = 0.3;
      annotationCtx.fillRect(state.startX, state.startY, currentX - state.startX, currentY - state.startY);
      annotationCtx.globalAlpha = 1;
      break;

    case 'line':
      let lineEndX = currentX;
      let lineEndY = currentY;
      // Snap to angle increments when Shift is held
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = currentX - state.startX;
        const dy = currentY - state.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        lineEndX = state.startX + length * Math.cos(snappedAngle);
        lineEndY = state.startY + length * Math.sin(snappedAngle);
      }
      annotationCtx.strokeStyle = prefs.lineStrokeColor || getColorPickerValue();
      annotationCtx.lineWidth = prefs.lineLineWidth || getLineWidthValue();
      annotationCtx.lineCap = 'round';
      // Set border style
      if (prefs.lineBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (prefs.lineBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }
      annotationCtx.globalAlpha = (prefs.lineOpacity || 100) / 100;
      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX, state.startY);
      annotationCtx.lineTo(lineEndX, lineEndY);
      annotationCtx.stroke();
      annotationCtx.globalAlpha = 1;
      annotationCtx.setLineDash([]);
      break;

    case 'arrow':
      let arrowEndX = currentX;
      let arrowEndY = currentY;
      // Snap to angle increments when Shift is held
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = currentX - state.startX;
        const dy = currentY - state.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        arrowEndX = state.startX + length * Math.cos(snappedAngle);
        arrowEndY = state.startY + length * Math.sin(snappedAngle);
      }
      // Get arrow preferences
      const arrowStrokeColor = prefs.arrowStrokeColor || getColorPickerValue();
      const arrowFillColor = prefs.arrowFillColor || arrowStrokeColor;
      const arrowLineWidth = prefs.arrowLineWidth || getLineWidthValue();
      const arrowBorderStyle = prefs.arrowBorderStyle || 'solid';
      const arrowHeadSize = prefs.arrowHeadSize || 12;
      const arrowStartHead = prefs.arrowStartHead || 'none';
      const arrowEndHead = prefs.arrowEndHead || 'open';

      annotationCtx.strokeStyle = arrowStrokeColor;
      annotationCtx.fillStyle = arrowFillColor;
      annotationCtx.lineWidth = arrowLineWidth;
      annotationCtx.lineCap = 'round';
      annotationCtx.lineJoin = 'round';

      // Set border style
      if (arrowBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (arrowBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }

      // Draw the line
      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX, state.startY);
      annotationCtx.lineTo(arrowEndX, arrowEndY);
      annotationCtx.stroke();

      // Reset line dash for arrowheads
      annotationCtx.setLineDash([]);

      // Draw arrowhead at end
      if (arrowEndHead !== 'none') {
        const angle = Math.atan2(arrowEndY - state.startY, arrowEndX - state.startX);
        drawArrowhead(annotationCtx, arrowEndX, arrowEndY, angle, arrowHeadSize, arrowEndHead);
      }

      // Draw arrowhead at start (if enabled)
      if (arrowStartHead !== 'none') {
        const startAngle = Math.atan2(state.startY - arrowEndY, state.startX - arrowEndX);
        drawArrowhead(annotationCtx, state.startX, state.startY, startAngle, arrowHeadSize, arrowStartHead);
      }
      break;

    case 'circle':
      const circleX = Math.min(state.startX, currentX);
      const circleY = Math.min(state.startY, currentY);
      const circleW = Math.abs(currentX - state.startX);
      const circleH = Math.abs(currentY - state.startY);
      const circleCX = circleX + circleW / 2;
      const circleCY = circleY + circleH / 2;
      if (circleW > 0 && circleH > 0) {
        annotationCtx.beginPath();
        annotationCtx.ellipse(circleCX, circleCY, circleW / 2, circleH / 2, 0, 0, 2 * Math.PI);
        if (!prefs.circleFillNone) {
          annotationCtx.fillStyle = prefs.circleFillColor;
          annotationCtx.globalAlpha = prefs.circleOpacity / 100;
          annotationCtx.fill();
          annotationCtx.globalAlpha = 1;
        }
        annotationCtx.strokeStyle = prefs.circleStrokeColor;
        annotationCtx.lineWidth = prefs.circleBorderWidth;
        annotationCtx.stroke();
      }
      break;

    case 'box':
      const boxX = Math.min(state.startX, currentX);
      const boxY = Math.min(state.startY, currentY);
      const boxW = Math.abs(currentX - state.startX);
      const boxH = Math.abs(currentY - state.startY);
      if (!prefs.rectFillNone) {
        annotationCtx.fillStyle = prefs.rectFillColor;
        annotationCtx.globalAlpha = prefs.rectOpacity / 100;
        annotationCtx.fillRect(boxX, boxY, boxW, boxH);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.rectStrokeColor;
      annotationCtx.lineWidth = prefs.rectBorderWidth;
      annotationCtx.strokeRect(boxX, boxY, boxW, boxH);
      break;

    case 'polygon':
      const width = currentX - state.startX;
      const height = currentY - state.startY;
      const cx = state.startX + width / 2;
      const cy = state.startY + height / 2;
      const rx = Math.abs(width) / 2;
      const ry = Math.abs(height) / 2;
      annotationCtx.strokeStyle = prefs.polygonStrokeColor || getColorPickerValue();
      annotationCtx.lineWidth = prefs.polygonLineWidth || getLineWidthValue();
      annotationCtx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const angle = (i * 2 * Math.PI / 6) - Math.PI / 2;
        const px = cx + rx * Math.cos(angle);
        const py = cy + ry * Math.sin(angle);
        if (i === 0) {
          annotationCtx.moveTo(px, py);
        } else {
          annotationCtx.lineTo(px, py);
        }
      }
      annotationCtx.closePath();
      annotationCtx.stroke();
      break;

    case 'cloud':
      const cloudX = Math.min(state.startX, currentX);
      const cloudY = Math.min(state.startY, currentY);
      const cloudW = Math.abs(currentX - state.startX);
      const cloudH = Math.abs(currentY - state.startY);
      if (cloudW > 10 && cloudH > 10) {
        annotationCtx.strokeStyle = prefs.cloudStrokeColor || getColorPickerValue();
        annotationCtx.lineWidth = prefs.cloudLineWidth || getLineWidthValue();
        drawCloudShape(annotationCtx, cloudX, cloudY, cloudW, cloudH);
      }
      break;

    case 'textbox':
      const tbX = Math.min(state.startX, currentX);
      const tbY = Math.min(state.startY, currentY);
      const tbWidth = Math.abs(currentX - state.startX);
      const tbHeight = Math.abs(currentY - state.startY);
      // Set border style
      if (prefs.textboxBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (prefs.textboxBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }
      if (!prefs.textboxFillNone) {
        annotationCtx.fillStyle = prefs.textboxFillColor;
        annotationCtx.globalAlpha = (prefs.textboxOpacity || 100) / 100;
        annotationCtx.fillRect(tbX, tbY, tbWidth, tbHeight);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.textboxStrokeColor;
      annotationCtx.lineWidth = prefs.textboxBorderWidth;
      annotationCtx.strokeRect(tbX, tbY, tbWidth, tbHeight);
      annotationCtx.setLineDash([]);
      break;

    case 'callout':
      // Draw callout preview
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = currentX - defaultWidth / 2;
      const coY = currentY - defaultHeight / 2;
      const arrowX = state.startX;
      const arrowY = state.startY;
      const boxCenterX = currentX;
      const isArrowLeft = arrowX < boxCenterX;
      let armOriginX;
      if (isArrowLeft) {
        armOriginX = coX;
      } else {
        armOriginX = coX + defaultWidth;
      }
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, currentY));
      const armLength = Math.min(30, Math.abs(arrowX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      const kneeY = armOriginY;
      // Set border style
      if (prefs.calloutBorderStyle === 'dashed') {
        annotationCtx.setLineDash([8, 4]);
      } else if (prefs.calloutBorderStyle === 'dotted') {
        annotationCtx.setLineDash([2, 2]);
      } else {
        annotationCtx.setLineDash([]);
      }
      if (!prefs.calloutFillNone) {
        annotationCtx.fillStyle = prefs.calloutFillColor;
        annotationCtx.globalAlpha = (prefs.calloutOpacity || 100) / 100;
        annotationCtx.fillRect(coX, coY, defaultWidth, defaultHeight);
        annotationCtx.globalAlpha = 1;
      }
      annotationCtx.strokeStyle = prefs.calloutStrokeColor;
      annotationCtx.lineWidth = prefs.calloutBorderWidth;
      annotationCtx.strokeRect(coX, coY, defaultWidth, defaultHeight);
      // Draw leader line
      annotationCtx.beginPath();
      annotationCtx.moveTo(armOriginX, armOriginY);
      annotationCtx.lineTo(kneeX, kneeY);
      annotationCtx.lineTo(arrowX, arrowY);
      annotationCtx.stroke();
      // Draw arrowhead
      const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
      const arrowSize = 10;
      annotationCtx.beginPath();
      annotationCtx.moveTo(arrowX, arrowY);
      annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle - Math.PI / 6), arrowY - arrowSize * Math.sin(angle - Math.PI / 6));
      annotationCtx.moveTo(arrowX, arrowY);
      annotationCtx.lineTo(arrowX - arrowSize * Math.cos(angle + Math.PI / 6), arrowY - arrowSize * Math.sin(angle + Math.PI / 6));
      annotationCtx.stroke();
      annotationCtx.setLineDash([]);
      break;

    case 'measureDistance': {
      let mEndX = currentX;
      let mEndY = currentY;
      // Snap to angle increments when Shift is held
      if (e.shiftKey && prefs.enableAngleSnap) {
        const dx = currentX - state.startX;
        const dy = currentY - state.startY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
        const snappedAngle = snapAngle(currentAngle, prefs.angleSnapDegrees) * (Math.PI / 180);
        mEndX = state.startX + length * Math.cos(snappedAngle);
        mEndY = state.startY + length * Math.sin(snappedAngle);
      }

      const mColor = prefs.measureStrokeColor || '#FF0000';
      const mLineWidth = prefs.measureLineWidth || 1;
      annotationCtx.strokeStyle = mColor;
      annotationCtx.lineWidth = mLineWidth;
      annotationCtx.globalAlpha = (prefs.measureOpacity || 100) / 100;
      annotationCtx.setLineDash([]);
      annotationCtx.lineCap = 'round';

      // Draw the measurement line
      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX, state.startY);
      annotationCtx.lineTo(mEndX, mEndY);
      annotationCtx.stroke();

      // Draw perpendicular end markers (ticks)
      const mdLen = 8;
      const mdAngle = Math.atan2(mEndY - state.startY, mEndX - state.startX);
      const perpAngle = mdAngle + Math.PI / 2;
      const mpx = Math.cos(perpAngle) * mdLen / 2;
      const mpy = Math.sin(perpAngle) * mdLen / 2;

      annotationCtx.beginPath();
      annotationCtx.moveTo(state.startX - mpx, state.startY - mpy);
      annotationCtx.lineTo(state.startX + mpx, state.startY + mpy);
      annotationCtx.moveTo(mEndX - mpx, mEndY - mpy);
      annotationCtx.lineTo(mEndX + mpx, mEndY + mpy);
      annotationCtx.stroke();

      // Draw live measurement text along the line direction
      const dist = calculateDistance(state.startX, state.startY, mEndX, mEndY);
      const measureText = formatMeasurement(dist);
      const midX = (state.startX + mEndX) / 2;
      const midY = (state.startY + mEndY) / 2;
      let textAngle = Math.atan2(mEndY - state.startY, mEndX - state.startX);
      // Keep text readable (not upside-down)
      if (textAngle > Math.PI / 2) textAngle -= Math.PI;
      else if (textAngle < -Math.PI / 2) textAngle += Math.PI;
      annotationCtx.save();
      annotationCtx.translate(midX, midY);
      annotationCtx.rotate(textAngle);
      annotationCtx.font = '11px Arial';
      annotationCtx.fillStyle = mColor;
      annotationCtx.textAlign = 'center';
      annotationCtx.textBaseline = 'bottom';
      annotationCtx.fillText(measureText, 0, -4);
      annotationCtx.restore();
      annotationCtx.globalAlpha = 1;
      break;
    }
  }

  annotationCtx.restore();
}
