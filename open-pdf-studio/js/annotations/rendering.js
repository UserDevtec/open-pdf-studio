import { state } from '../core/state.js';
import { annotationCanvas, annotationCtx } from '../ui/dom-elements.js';
import { updateStatusAnnotations } from '../ui/chrome/status-bar.js';
import { updateAnnotationsList } from '../ui/panels/annotations-list.js';
import { renderWatermarksBehind, renderWatermarksInFront } from '../watermark/watermark-renderer.js';

// Import from sub-modules
import { drawPolygonShape, drawCloudShape, buildPolygonPath, buildCloudPath, buildCloudPolylinePath, drawTextboxContent } from './rendering/shapes.js';
import { drawArrowheadOnCanvas, applyBorderStyle, drawDimensionLineEnding } from './rendering/decorations.js';
import { drawDimension, drawMeasureAreaShape, drawCentroidLabel, drawMeasurePerimeterShape } from './rendering/measurements.js';
import { applyHatchFill } from './rendering/hatch-patterns.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { drawSelectionHandles } from './rendering/selection.js';
import { updateQuickAccessButtons, updateContextualTabs, drawGrid, snapToGrid } from './rendering/ui-state.js';
import { drawCommentIcon } from './rendering/comment-icons.js';

// Re-export everything that external code needs
export { drawPolygonShape, drawCloudShape, buildPolygonPath, buildCloudPath } from './rendering/shapes.js';
export { updateQuickAccessButtons, snapToGrid } from './rendering/ui-state.js';

// Resolve line width, clamping to 1px when thin-lines view mode is active
function thinLw(width) {
  return state.preferences?.thinLines ? Math.min(width, 1) : width;
}

// Draw single annotation
export function drawAnnotation(ctx, annotation) {
  // Skip hidden annotations
  if (annotation.hidden) return;

  // Use annotation's opacity property
  const baseOpacity = annotation.opacity !== undefined ? annotation.opacity :
                     (annotation.type === 'highlight' ? 0.3 : 1);

  // Use strokeColor/fillColor if available, otherwise fallback to color
  const strokeColor = annotation.strokeColor || annotation.color;
  const fillColor = annotation.fillColor || annotation.color;

  ctx.strokeStyle = strokeColor;
  ctx.fillStyle = fillColor;
  let lw = annotation.lineWidth ?? 3;
  // Ensure a minimum visible stroke when there's no fill, so the annotation stays visible
  const hasFill = annotation.fillColor && annotation.fillColor !== 'transparent';
  if (lw === 0 && !hasFill) lw = 0.5;
  lw = thinLw(lw);
  ctx.lineWidth = lw;
  ctx.globalAlpha = baseOpacity;
  ctx.globalCompositeOperation = annotation.blendMode === 'multiply' ? 'multiply' : 'source-over';

  switch (annotation.type) {
    case 'draw':
      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      annotation.path.forEach((point, index) => {
        if (index === 0) {
          ctx.moveTo(point.x, point.y);
        } else {
          ctx.lineTo(point.x, point.y);
        }
      });
      ctx.stroke();
      ctx.setLineDash([]);
      break;

    case 'highlight':
      ctx.fillStyle = fillColor;
      ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      break;

    case 'line':
      ctx.strokeStyle = strokeColor;
      ctx.lineCap = 'round';
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.beginPath();
      ctx.moveTo(annotation.startX, annotation.startY);
      ctx.lineTo(annotation.endX, annotation.endY);
      ctx.stroke();
      ctx.setLineDash([]);
      break;

    case 'arrow': {
      // Draw arrow onto offscreen canvas at full opacity to avoid overlap artifacts,
      // then composite onto main canvas with the desired opacity
      const arrowFillColor = annotation.fillColor || strokeColor;
      const endHead = annotation.endHead || 'open';
      const startHead = annotation.startHead || 'none';
      const headSize = annotation.headSize || 12;
      let lw = annotation.lineWidth ?? 3;
      if (lw === 0) lw = 0.5;
      lw = thinLw(lw);

      // Calculate bounding box with padding for arrowheads
      const pad = headSize + lw + 2;
      const minAX = Math.min(annotation.startX, annotation.endX) - pad;
      const minAY = Math.min(annotation.startY, annotation.endY) - pad;
      const maxAX = Math.max(annotation.startX, annotation.endX) + pad;
      const maxAY = Math.max(annotation.startY, annotation.endY) + pad;
      const offW = maxAX - minAX;
      const offH = maxAY - minAY;

      // Create offscreen canvas at scaled resolution to avoid pixelation when zoomed
      const arrowDoc = state.documents[state.activeDocumentIndex];
      const arrowScale = (arrowDoc ? arrowDoc.scale : 1) || 1;
      const offCanvas = document.createElement('canvas');
      offCanvas.width = offW * arrowScale;
      offCanvas.height = offH * arrowScale;
      const offCtx = offCanvas.getContext('2d');

      // Scale and translate so coordinates match document space
      offCtx.scale(arrowScale, arrowScale);
      offCtx.translate(-minAX, -minAY);
      offCtx.strokeStyle = strokeColor;
      offCtx.fillStyle = arrowFillColor;
      offCtx.lineWidth = lw;
      offCtx.lineCap = 'butt';
      offCtx.lineJoin = 'miter';

      applyBorderStyle(offCtx, annotation.borderStyle);

      // Shorten line so it stops at arrowhead base (not tip) to avoid overshoot
      const aDx = annotation.endX - annotation.startX;
      const aDy = annotation.endY - annotation.startY;
      const aLen = Math.sqrt(aDx * aDx + aDy * aDy);
      let lineStartX = annotation.startX, lineStartY = annotation.startY;
      let lineEndX = annotation.endX, lineEndY = annotation.endY;
      if (aLen > 0) {
        const ux = aDx / aLen, uy = aDy / aLen;
        if (endHead !== 'none') {
          lineEndX -= ux * headSize;
          lineEndY -= uy * headSize;
        }
        if (startHead !== 'none') {
          lineStartX += ux * headSize;
          lineStartY += uy * headSize;
        }
      }

      offCtx.beginPath();
      offCtx.moveTo(lineStartX, lineStartY);
      offCtx.lineTo(lineEndX, lineEndY);
      offCtx.stroke();

      offCtx.setLineDash([]);

      if (endHead !== 'none') {
        const endAngle = Math.atan2(aDy, aDx);
        drawArrowheadOnCanvas(offCtx, annotation.endX, annotation.endY, endAngle, headSize, endHead);
      }

      if (startHead !== 'none') {
        const startAngle = Math.atan2(-aDy, -aDx);
        drawArrowheadOnCanvas(offCtx, annotation.startX, annotation.startY, startAngle, headSize, startHead);
      }

      // Composite the offscreen arrow onto the main canvas with opacity
      ctx.drawImage(offCanvas, minAX, minAY, offW, offH);
      break;
    }

    case 'polyline':
      if (annotation.points && annotation.points.length >= 2) {
        ctx.strokeStyle = strokeColor;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        applyBorderStyle(ctx, annotation.borderStyle);
        ctx.beginPath();
        annotation.points.forEach((point, index) => {
          if (index === 0) {
            ctx.moveTo(point.x, point.y);
          } else {
            ctx.lineTo(point.x, point.y);
          }
        });
        ctx.stroke();
        ctx.setLineDash([]);
      }
      break;

    case 'circle':
      // Draw ellipse that fits in bounding box
      const ellipseX = annotation.x;
      const ellipseY = annotation.y;
      const ellipseW = annotation.width || annotation.radius * 2;
      const ellipseH = annotation.height || annotation.radius * 2;
      const ellipseCX = ellipseX + ellipseW / 2;
      const ellipseCY = ellipseY + ellipseH / 2;

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        ctx.translate(ellipseCX, ellipseCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-ellipseCX, -ellipseCY);
      }

      ctx.beginPath();
      ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        ctx.beginPath();
        ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.beginPath();
      ctx.ellipse(ellipseCX, ellipseCY, Math.abs(ellipseW / 2), Math.abs(ellipseH / 2), 0, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'box':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const boxCenterX = annotation.x + annotation.width / 2;
        const boxCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxCenterX, boxCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-boxCenterX, -boxCenterY);
      }

      // Fill if fillColor is set and not 'none'
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        ctx.beginPath();
        ctx.rect(annotation.x, annotation.y, annotation.width, annotation.height);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'polygon':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const polyCX = annotation.x + annotation.width / 2;
        const polyCY = annotation.y + annotation.height / 2;
        ctx.translate(polyCX, polyCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-polyCX, -polyCY);
      }
      // Fill if fillColor is set
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        buildPolygonPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        buildPolygonPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      applyBorderStyle(ctx, annotation.borderStyle);
      drawPolygonShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height, annotation.sides || 6);
      ctx.setLineDash([]);
      ctx.restore();
      break;

    case 'cloud':
      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const cloudCX = annotation.x + annotation.width / 2;
        const cloudCY = annotation.y + annotation.height / 2;
        ctx.translate(cloudCX, cloudCY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-cloudCX, -cloudCY);
      }
      // Fill if fillColor is set
      if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
        buildCloudPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.fillStyle = annotation.fillColor;
        ctx.fill();
      }

      // Hatch pattern fill
      if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
        buildCloudPath(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
        applyHatchFill(ctx, annotation);
      }

      ctx.strokeStyle = strokeColor;
      drawCloudShape(ctx, annotation.x, annotation.y, annotation.width, annotation.height);
      ctx.restore();
      break;

    case 'cloudPolyline':
      if (annotation.points && annotation.points.length >= 2) {
        // Fill if fillColor is set
        if (annotation.fillColor && annotation.fillColor !== 'none' && annotation.fillColor !== null) {
          buildCloudPolylinePath(ctx, annotation.points, true);
          ctx.fillStyle = annotation.fillColor;
          ctx.fill();
        }
        // Hatch pattern fill
        if (annotation.hatchPattern && annotation.hatchPattern !== 'none') {
          buildCloudPolylinePath(ctx, annotation.points, true);
          applyHatchFill(ctx, annotation);
        }
        ctx.strokeStyle = strokeColor;
        buildCloudPolylinePath(ctx, annotation.points, true);
        ctx.stroke();
      }
      break;

    case 'comment': {
      // Draw comment icon using proper vector icon rendering
      const cSize = annotation.width || 24;
      const iconCX = annotation.x + cSize / 2;
      const iconCY = annotation.y + cSize / 2;

      // Draw leader triangle from icon to popup
      if (annotation.popupOpen && annotation._popupFocused) {
        const popX = annotation.popupX !== undefined ? annotation.popupX : annotation.x + 30;
        const popY = annotation.popupY !== undefined ? annotation.popupY : annotation.y;

        const doc = state.documents[state.activeDocumentIndex];
        const scl = (doc ? doc.scale : 1) || 1;
        const popW = 230 / scl;
        const popH = 150 / scl;

        // Popup center
        const cx = popX + popW / 2;
        const cy = popY + popH / 2;

        // Direction from popup center to icon
        const dx = iconCX - cx;
        const dy = iconCY - cy;

        // Line-rect intersection: find where line from center to icon hits popup edge
        const sx = dx !== 0 ? (popW / 2) / Math.abs(dx) : Infinity;
        const sy = dy !== 0 ? (popH / 2) / Math.abs(dy) : Infinity;
        const s = Math.min(sx, sy);
        if (s >= 1) break; // icon is inside popup, skip leader

        const edgeX = cx + dx * s;
        const edgeY = cy + dy * s;

        // Distance from icon to edge
        const eDx = edgeX - iconCX;
        const eDy = edgeY - iconCY;
        const edgeDist = Math.sqrt(eDx * eDx + eDy * eDy);
        if (edgeDist < cSize * 0.5) break; // too close

        // Unit direction from icon toward popup center
        const udx = eDx / edgeDist;
        const udy = eDy / edgeDist;

        // Target point: 15px past the edge into the popup interior
        const inset = 15 / scl;
        const tgtX = edgeX + udx * inset;
        const tgtY = edgeY + udy * inset;

        // Perpendicular spread (always same visual width)
        const perpX = -udy;
        const perpY = udx;
        const spread = 7 / scl;

        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.moveTo(iconCX, iconCY);
        ctx.lineTo(tgtX + perpX * spread, tgtY + perpY * spread);
        ctx.lineTo(tgtX - perpX * spread, tgtY - perpY * spread);
        ctx.closePath();
        ctx.fillStyle = fillColor || '#FFFF00';
        ctx.fill();
        ctx.restore();
      }

      ctx.save();
      ctx.globalAlpha = baseOpacity;

      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const cCenterX = iconCX;
        const cCenterY = iconCY;
        ctx.translate(cCenterX, cCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-cCenterX, -cCenterY);
      }

      drawCommentIcon(ctx, annotation.icon, annotation.x, annotation.y, cSize, fillColor || '#FFFF00');

      ctx.restore();
      break;
    }

    case 'text': {
      const txtFontFamily = annotation.fontFamily || 'Arial';
      const txtFontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
      const txtFontSize = annotation.fontSize || 16;
      ctx.fillStyle = annotation.color || '#000000';
      ctx.font = `${txtFontStyle}${txtFontSize}px ${txtFontFamily}`;
      ctx.textAlign = annotation.textAlign || 'left';

      const lines = (annotation.text || '').split('\n');
      let txtY = annotation.y;
      for (let i = 0; i < lines.length; i++) {
        ctx.fillText(lines[i], annotation.x, txtY);
        if (annotation.fontUnderline) {
          const lineWidth = ctx.measureText(lines[i]).width;
          let underlineX = annotation.x;
          if (annotation.textAlign === 'center') underlineX -= lineWidth / 2;
          else if (annotation.textAlign === 'right') underlineX -= lineWidth;
          ctx.beginPath();
          ctx.moveTo(underlineX, txtY + 2);
          ctx.lineTo(underlineX + lineWidth, txtY + 2);
          ctx.strokeStyle = annotation.color || '#000000';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        txtY += txtFontSize * 1.3;
      }
      ctx.textAlign = 'left';
      break;
    }

    case 'textbox':
      // Draw text box with border and optional fill
      const tbWidth = annotation.width || 150;
      const tbHeight = annotation.height || 50;
      const tbLineWidth = thinLw(annotation.lineWidth !== undefined ? annotation.lineWidth : 1);
      const tbBorderStyle = annotation.borderStyle || 'solid';

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const tbCenterX = annotation.x + tbWidth / 2;
        const tbCenterY = annotation.y + tbHeight / 2;
        ctx.translate(tbCenterX, tbCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-tbCenterX, -tbCenterY);
      }

      // Draw fill
      if (annotation.fillColor && annotation.fillColor !== 'transparent') {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, tbWidth, tbHeight);
      }

      // Draw border with style
      if (tbLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = tbLineWidth;
        if (tbBorderStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        } else if (tbBorderStyle === 'dotted') {
          ctx.setLineDash([2, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(annotation.x, annotation.y, tbWidth, tbHeight);
        ctx.setLineDash([]);
      }

      // Clip text to textbox bounds
      ctx.beginPath();
      ctx.rect(annotation.x, annotation.y, tbWidth, tbHeight);
      ctx.clip();

      // Draw text content
      drawTextboxContent(ctx, annotation);
      ctx.restore();
      break;

    case 'callout':
      // Draw callout annotation (text box with two-segment leader line)
      const coWidth = annotation.width || 150;
      const coHeight = annotation.height || 50;
      const coLineWidth = thinLw(annotation.lineWidth !== undefined ? annotation.lineWidth : 1);
      const coBorderStyle = annotation.borderStyle || 'solid';

      // Set stroke style for leader line and border
      ctx.strokeStyle = annotation.strokeColor || strokeColor;
      ctx.lineWidth = coLineWidth > 0 ? coLineWidth : 1;
      if (coBorderStyle === 'dashed') {
        ctx.setLineDash([8, 4]);
      } else if (coBorderStyle === 'dotted') {
        ctx.setLineDash([2, 2]);
      } else {
        ctx.setLineDash([]);
      }

      // Arrow tip position
      const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
      const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + coHeight;

      // Knee point
      const kneeX = annotation.kneeX !== undefined ? annotation.kneeX : annotation.x - 30;
      const kneeY = annotation.kneeY !== undefined ? annotation.kneeY : annotation.y + coHeight / 2;

      // Arm origin (connection point on text box edge)
      let armOriginX, armOriginY;
      if (annotation.armOriginX !== undefined && annotation.armOriginY !== undefined) {
        armOriginX = annotation.armOriginX;
        armOriginY = annotation.armOriginY;
      } else {
        if (arrowX < annotation.x + coWidth / 2) {
          armOriginX = annotation.x;
        } else {
          armOriginX = annotation.x + coWidth;
        }
        armOriginY = kneeY;
      }

      // Draw the two-segment leader line (not rotated - arrow stays in place)
      ctx.beginPath();
      ctx.moveTo(armOriginX, armOriginY);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(arrowX, arrowY);
      ctx.stroke();

      // Draw arrowhead
      const angle = Math.atan2(arrowY - kneeY, arrowX - kneeX);
      drawArrowheadOnCanvas(ctx, arrowX, arrowY, angle, 10, 'open');

      ctx.save();
      if (annotation.rotation || annotation.flipX || annotation.flipY) {
        const coCenterX = annotation.x + coWidth / 2;
        const coCenterY = annotation.y + coHeight / 2;
        ctx.translate(coCenterX, coCenterY);
        if (annotation.rotation) ctx.rotate(annotation.rotation * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.translate(-coCenterX, -coCenterY);
      }

      // Draw fill
      if (annotation.fillColor && annotation.fillColor !== 'transparent') {
        ctx.fillStyle = annotation.fillColor;
        ctx.fillRect(annotation.x, annotation.y, coWidth, coHeight);
      }

      // Draw border with style
      if (coLineWidth > 0) {
        ctx.strokeStyle = annotation.strokeColor || strokeColor;
        ctx.lineWidth = coLineWidth;
        if (coBorderStyle === 'dashed') {
          ctx.setLineDash([8, 4]);
        } else if (coBorderStyle === 'dotted') {
          ctx.setLineDash([2, 2]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.strokeRect(annotation.x, annotation.y, coWidth, coHeight);
        ctx.setLineDash([]);
      }

      // Draw text content
      drawTextboxContent(ctx, annotation);
      ctx.restore();
      break;

    case 'image':
      // Draw image with rotation and flip
      const img = state.imageCache.get(annotation.imageId);
      if (img && img.complete) {
        ctx.save();

        // Move to center of image for rotation and flip
        const centerX = annotation.x + annotation.width / 2;
        const centerY = annotation.y + annotation.height / 2;
        ctx.translate(centerX, centerY);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);

        // Apply flip transformations
        const scaleX = annotation.flipX ? -1 : 1;
        const scaleY = annotation.flipY ? -1 : 1;
        ctx.scale(scaleX, scaleY);

        // Draw the image centered at origin
        ctx.drawImage(img, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);

        ctx.restore();
      } else {
        // Draw placeholder while loading
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.strokeStyle = '#ccc';
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.fillStyle = '#999';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', annotation.x + annotation.width/2, annotation.y + annotation.height/2);
        ctx.textAlign = 'left';
      }
      break;

    case 'textHighlight':
      // Draw text highlight - semi-transparent fill for each rect
      ctx.fillStyle = fillColor;
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
        });
      } else {
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }
      break;

    case 'textStrikethrough':
      // Draw strikethrough line through the middle of each text rect
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.lineCap = 'round';
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          const midY = rect.y + rect.height / 2;
          ctx.beginPath();
          ctx.moveTo(rect.x, midY);
          ctx.lineTo(rect.x + rect.width, midY);
          ctx.stroke();
        });
      } else {
        const midY = annotation.y + annotation.height / 2;
        ctx.beginPath();
        ctx.moveTo(annotation.x, midY);
        ctx.lineTo(annotation.x + annotation.width, midY);
        ctx.stroke();
      }
      break;

    case 'textUnderline':
      // Draw underline at the bottom of each text rect
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.lineCap = 'round';
      if (annotation.rects && annotation.rects.length > 0) {
        annotation.rects.forEach(rect => {
          const bottomY = rect.y + rect.height - 1;
          ctx.beginPath();
          ctx.moveTo(rect.x, bottomY);
          ctx.lineTo(rect.x + rect.width, bottomY);
          ctx.stroke();
        });
      } else {
        const bottomY = annotation.y + annotation.height - 1;
        ctx.beginPath();
        ctx.moveTo(annotation.x, bottomY);
        ctx.lineTo(annotation.x + annotation.width, bottomY);
        ctx.stroke();
      }
      break;

    case 'stamp': {
      // Render stamp - image or text-based
      const stampImg = annotation.imageId ? state.imageCache.get(annotation.imageId) : null;
      if (stampImg && stampImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.drawImage(stampImg, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        ctx.restore();
      } else if (annotation.stampText) {
        // Text-based stamp
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);

        const color = annotation.stampColor || annotation.color || '#ef4444';
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(-annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);

        ctx.fillStyle = color;
        ctx.font = `bold ${Math.min(annotation.height * 0.5, 24)}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(annotation.stampText, 0, 0);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
      }
      break;
    }

    case 'signature': {
      // Render signature image
      const sigImg = annotation.imageId ? state.imageCache.get(annotation.imageId) : null;
      if (sigImg && sigImg.complete) {
        ctx.save();
        const cx = annotation.x + annotation.width / 2;
        const cy = annotation.y + annotation.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((annotation.rotation || 0) * Math.PI / 180);
        if (annotation.flipX || annotation.flipY) ctx.scale(annotation.flipX ? -1 : 1, annotation.flipY ? -1 : 1);
        ctx.drawImage(sigImg, -annotation.width / 2, -annotation.height / 2, annotation.width, annotation.height);
        ctx.restore();
      } else {
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.strokeStyle = '#999';
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
        ctx.setLineDash([]);
        ctx.fillStyle = '#999';
        ctx.font = '11px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Signature', annotation.x + annotation.width / 2, annotation.y + annotation.height / 2 + 4);
        ctx.textAlign = 'left';
      }
      break;
    }

    case 'measureDistance': {
      // Distance measurement line with label
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);
      ctx.setLineDash([]);

      drawDimension(ctx, {
        startX: annotation.startX, startY: annotation.startY,
        endX: annotation.endX, endY: annotation.endY,
        leaderStartX: annotation.leaderStartX, leaderStartY: annotation.leaderStartY,
        leaderEndX: annotation.leaderEndX, leaderEndY: annotation.leaderEndY,
        startHead: annotation.startHead || 'closed',
        endHead: annotation.endHead || 'closed',
        headSize: annotation.headSize || 12,
        color: strokeColor,
        measureText: annotation.measureText
      });
      break;
    }

    case 'measureArea': {
      // Area measurement polygon
      if (!annotation.points || annotation.points.length < 3) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);

      drawMeasureAreaShape(ctx, annotation.points, annotation.color || '#ff0000', annotation.lineWidth, annotation.fillColor, annotation.borderStyle);
      if (annotation.measureText) {
        drawCentroidLabel(ctx, annotation.points, annotation.measureText, strokeColor);
      }
      break;
    }

    case 'redaction': {
      // Redaction mark - red hatched overlay
      const rw = annotation.width || 0;
      const rh = annotation.height || 0;
      // Semi-transparent red fill
      ctx.fillStyle = 'rgba(255, 0, 0, 0.25)';
      ctx.fillRect(annotation.x, annotation.y, rw, rh);
      // Red border
      ctx.strokeStyle = '#ff0000';
      ctx.lineWidth = 2;
      ctx.setLineDash([]);
      ctx.strokeRect(annotation.x, annotation.y, rw, rh);
      // Diagonal hatch lines
      ctx.lineWidth = 1;
      ctx.beginPath();
      const step = 10;
      for (let d = -rh; d < rw; d += step) {
        const x1 = Math.max(0, d) + annotation.x;
        const y1 = Math.max(0, -d) + annotation.y;
        const x2 = Math.min(rw, d + rh) + annotation.x;
        const y2 = Math.min(rh, -d + rw) + annotation.y;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
      }
      ctx.stroke();
      // Label
      ctx.font = '10px Arial';
      ctx.fillStyle = '#ff0000';
      ctx.fillText('REDACT', annotation.x + 4, annotation.y + 14);
      break;
    }

    case 'measurePerimeter': {
      // Perimeter measurement polyline
      if (!annotation.points || annotation.points.length < 2) break;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = thinLw(annotation.lineWidth ?? 1);

      drawMeasurePerimeterShape(ctx, annotation.points, strokeColor, annotation.borderStyle);

      // Line endings at first and last points
      const mpPts = annotation.points;
      const mpHeadSize = annotation.headSize || 12;
      const mpStartHead = annotation.startHead || 'none';
      const mpEndHead = annotation.endHead || 'none';
      if (mpStartHead !== 'none' && mpPts.length >= 2) {
        const startAngle = Math.atan2(mpPts[0].y - mpPts[1].y, mpPts[0].x - mpPts[1].x);
        ctx.fillStyle = strokeColor;
        drawDimensionLineEnding(ctx, mpPts[0].x, mpPts[0].y, startAngle, mpHeadSize, mpStartHead);
      }
      if (mpEndHead !== 'none' && mpPts.length >= 2) {
        const last = mpPts[mpPts.length - 1];
        const prev = mpPts[mpPts.length - 2];
        const endAngle = Math.atan2(last.y - prev.y, last.x - prev.x);
        ctx.fillStyle = strokeColor;
        drawDimensionLineEnding(ctx, last.x, last.y, endAngle, mpHeadSize, mpEndHead);
      }

      if (annotation.measureText && mpPts.length > 0) {
        const lastPt = mpPts[mpPts.length - 1];
        ctx.font = '11px Arial';
        ctx.fillStyle = strokeColor;
        ctx.fillText(annotation.measureText, lastPt.x + 8, lastPt.y - 4);
      }
      break;
    }

    default: {
      const typeHandler = getAnnotationType(annotation.type);
      if (typeHandler && typeHandler.render) {
        typeHandler.render(ctx, annotation);
      }
      break;
    }
  }
}

// Draw text edits (cover-and-replace) for a specific page
// ctx is already scaled by state.scale, so coordinates are in unscaled page space
function drawTextEdits(ctx, pageNum) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !doc.textEdits || doc.textEdits.length === 0) return;

  const pageEdits = doc.textEdits.filter(e => e.page === pageNum);
  if (pageEdits.length === 0) return;

  const canvasEl = ctx.canvas;
  const docForScale = state.documents[state.activeDocumentIndex];
  const pageHeight = canvasEl.height / (docForScale ? docForScale.scale : 1);

  for (const edit of pageEdits) {
    const fontSize = edit.fontSize;
    const ls = edit.lineSpacing || fontSize * 1.2;
    const numOrig = edit.numOriginalLines || 1;

    // First line baseline in canvas coordinates
    const firstBaseY = pageHeight - edit.pdfY;

    // Cover rectangle: extends from above first baseline to below last baseline
    // Skip cover rect for newly added text (no original text to cover)
    ctx.save();
    if (edit.originalText) {
      const coverTop = firstBaseY - fontSize;
      const coverHeight = (numOrig - 1) * ls + fontSize * 1.3;
      const origLines = edit.originalText.split('\n');
      const maxOrigLen = Math.max(...origLines.map(l => l.length));
      const coverWidth = Math.max(edit.pdfWidth, fontSize * 0.6 * maxOrigLen) + fontSize * 0.5;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(edit.pdfX, coverTop, coverWidth, coverHeight);
    }

    // Draw new text line by line
    ctx.fillStyle = edit.color || '#000000';
    const ff = (edit.fontFamily || 'Helvetica').toLowerCase();
    const cssFallback = ff.includes('courier') ? '"Courier New", Courier, monospace'
      : ff.includes('times') ? '"Times New Roman", Times, serif'
      : 'Helvetica, Arial, sans-serif';
    const fontWeight = ff.includes('bold') ? 'bold ' : '';
    const fontStyle = ff.includes('italic') || ff.includes('oblique') ? 'italic ' : '';
    // Use PDF.js loaded font for exact visual match on canvas, with standard font fallback
    const fontFamily = edit.loadedFontName
      ? `"${edit.loadedFontName}", ${cssFallback}`
      : cssFallback;
    const canvasFont = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
    ctx.font = canvasFont;
    ctx.textBaseline = 'alphabetic';

    const newLines = edit.newText.split('\n');
    for (let i = 0; i < newLines.length; i++) {
      ctx.fillText(newLines[i], edit.pdfX, firstBaseY + i * ls);
    }
    ctx.restore();
  }
}

// Redraw all annotations (single page mode)
// Pass lightweight=true during drag/resize to skip expensive DOM updates
export function redrawAnnotations(lightweight = false) {
  if (!annotationCtx || !annotationCanvas) return;

  // Read scale and annotations from the active document directly
  // (bypass createMutable proxy getter caching)
  const doc = state.documents[state.activeDocumentIndex];
  const scale = doc ? doc.scale : 1;
  const annotations = doc ? doc.annotations : [];

  annotationCtx.clearRect(0, 0, annotationCanvas.width, annotationCanvas.height);

  // Apply scale transformation for zooming
  annotationCtx.save();
  annotationCtx.scale(scale, scale);

  // Draw grid overlay if enabled
  if (state.preferences.showGrid) {
    drawGrid(annotationCtx, annotationCanvas.width / scale, annotationCanvas.height / scale);
  }

  // Draw watermarks behind content
  renderWatermarksBehind(annotationCtx, state.currentPage, annotationCanvas.width / scale, annotationCanvas.height / scale);

  // Draw text edits (cover-and-replace) before annotations
  drawTextEdits(annotationCtx, state.currentPage);

  // Draw all annotations for current page
  annotations.forEach(annotation => {
    if (annotation.page !== state.currentPage) return;
    drawAnnotation(annotationCtx, annotation);
  });

  annotationCtx.globalAlpha = 1;
  annotationCtx.globalCompositeOperation = 'source-over';

  // Draw watermarks in front of content
  renderWatermarksInFront(annotationCtx, state.currentPage, annotationCanvas.width / scale, annotationCanvas.height / scale);

  // Draw selection highlight and handles (use selectedAnnotations array as source of truth)
  const selected = state.selectedAnnotations;
  if (selected.length > 0) {
    for (const ann of selected) {
      if (ann.page !== state.currentPage) continue;
      drawSelectionHandles(annotationCtx, ann);
    }
  }

  // Restore context
  annotationCtx.restore();

  if (!lightweight) {
    // Update annotation count in status bar
    updateStatusAnnotations();

    // Update annotations list panel
    updateAnnotationsList();

    // Update quick access button states
    updateQuickAccessButtons();

    // Show/hide contextual ribbon tabs based on selection
    updateContextualTabs();
  }
}

// Render annotations for a specific page (continuous mode)
export function renderAnnotationsForPage(ctx, pageNum, width, height) {
  ctx.clearRect(0, 0, width, height);

  // Read scale and annotations from the active document directly
  const doc = state.documents[state.activeDocumentIndex];
  const scale = doc ? doc.scale : 1;
  const annotations = doc ? doc.annotations : [];

  // Apply scale transformation for zooming
  ctx.save();
  ctx.scale(scale, scale);

  // Draw watermarks behind content
  renderWatermarksBehind(ctx, pageNum, width / scale, height / scale);

  // Draw text edits (cover-and-replace)
  drawTextEdits(ctx, pageNum);

  annotations.forEach(annotation => {
    if (annotation.page !== pageNum) return;
    drawAnnotation(ctx, annotation);
  });

  // Draw watermarks in front of content
  renderWatermarksInFront(ctx, pageNum, width / scale, height / scale);

  // Restore context
  ctx.restore();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

// Redraw all pages in continuous mode
export function redrawContinuous() {
  const pageWrappers = document.querySelectorAll('.page-wrapper');
  pageWrappers.forEach(wrapper => {
    const pageNum = parseInt(wrapper.dataset.page);
    const canvas = wrapper.querySelector('.annotation-canvas');
    if (canvas) {
      const ctx = canvas.getContext('2d');
      renderAnnotationsForPage(ctx, pageNum, canvas.width, canvas.height);
    }
  });

  // Update quick access button states
  updateQuickAccessButtons();

  // Show/hide contextual ribbon tabs based on selection
  updateContextualTabs();
}
