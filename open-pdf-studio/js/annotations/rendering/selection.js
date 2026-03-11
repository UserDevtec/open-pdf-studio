import { HANDLE_SIZE, HANDLE_TYPES } from '../../core/constants.js';
import { state, getSelectionBounds, getAnnotationBounds } from '../../core/state.js';
import { annotationCtx } from '../../ui/dom-elements.js';
import { getAnnotationHandles } from '../handles.js';

// Draw selection highlight and handles
export function drawSelectionHandles(ctx, annotation) {
  const sc = state.scale || 1;

  // Draw rotation indicator lines (no dashed outlines)
  ctx.strokeStyle = '#22c55e';
  ctx.setLineDash([]);
  ctx.lineWidth = 1 / sc;

  switch (annotation.type) {
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline': {
      // Draw per-rect outlines instead of bounding-box indicator
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = 1 / sc;
      ctx.setLineDash([3 / sc, 3 / sc]);
      if (annotation.rects && annotation.rects.length > 0) {
        for (const rect of annotation.rects) {
          ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
      } else {
        ctx.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      }
      ctx.setLineDash([]);
      return; // Skip handle drawing — text markups have no handles
    }
    case 'circle': {
      const selCircW = annotation.width || annotation.radius * 2;
      const selCircH = annotation.height || annotation.radius * 2;
      const selCircX = annotation.x !== undefined ? annotation.x : annotation.centerX - annotation.radius;
      const selCircY = annotation.y !== undefined ? annotation.y : annotation.centerY - annotation.radius;
      ctx.save();
      if (annotation.rotation) {
        const circCenterX = selCircX + selCircW / 2;
        const circCenterY = selCircY + selCircH / 2;
        ctx.translate(circCenterX, circCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-circCenterX, -circCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(selCircX + selCircW/2, selCircY - 2);
      ctx.lineTo(selCircX + selCircW/2, selCircY - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'box':
    case 'polygon':
    case 'cloud':
    case 'highlight':
    case 'redaction':
      ctx.save();
      if (annotation.rotation) {
        const boxSelCenterX = annotation.x + annotation.width / 2;
        const boxSelCenterY = annotation.y + annotation.height / 2;
        ctx.translate(boxSelCenterX, boxSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-boxSelCenterX, -boxSelCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width / 2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width / 2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    case 'comment':
      // No selection indicators — fixed-size icon, move only
      break;
    case 'textbox': {
      const selTbWidth = annotation.width || 150;
      const selTbHeight = annotation.height || 50;
      ctx.save();
      if (annotation.rotation) {
        const tbSelCenterX = annotation.x + selTbWidth / 2;
        const tbSelCenterY = annotation.y + selTbHeight / 2;
        ctx.translate(tbSelCenterX, tbSelCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-tbSelCenterX, -tbSelCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + selTbWidth / 2, annotation.y - 2);
      ctx.lineTo(annotation.x + selTbWidth / 2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'image':
    case 'stamp':
    case 'signature':
      ctx.save();
      if (annotation.rotation) {
        const imgCenterX = annotation.x + annotation.width / 2;
        const imgCenterY = annotation.y + annotation.height / 2;
        ctx.translate(imgCenterX, imgCenterY);
        ctx.rotate(annotation.rotation * Math.PI / 180);
        ctx.translate(-imgCenterX, -imgCenterY);
      }
      ctx.beginPath();
      ctx.moveTo(annotation.x + annotation.width/2, annotation.y - 2);
      ctx.lineTo(annotation.x + annotation.width/2, annotation.y - 25 / sc);
      ctx.stroke();
      ctx.restore();
      break;
  }

  // Draw resize/move handles (scale-independent size)
  const scale = state.scale || 1;
  const handles = getAnnotationHandles(annotation, scale);
  const hs = HANDLE_SIZE / scale;
  const lw = 1 / scale;

  handles.forEach(handle => {
    const cx = handle.x + hs / 2;
    const cy = handle.y + hs / 2;

    // Draw rotation handle as a circle with rotation icon (green color)
    if (handle.type === HANDLE_TYPES.ROTATE) {
      // Outer circle
      ctx.fillStyle = '#22c55e';
      ctx.beginPath();
      ctx.arc(cx, cy, hs / 2 + lw, 0, 2 * Math.PI);
      ctx.fill();
      // Inner rotation arrow icon
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(cx, cy, 3 / scale, -Math.PI * 0.7, Math.PI * 0.5);
      ctx.stroke();
      // Small arrow head
      const as = 2 / scale;
      ctx.beginPath();
      ctx.moveTo(cx - as, cy + as);
      ctx.lineTo(cx - as, cy + as * 2);
      ctx.lineTo(cx - as * 2, cy + as * 1.5);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    // Callout move handle - four-arrow cross shape
    if (handle.type === HANDLE_TYPES.CALLOUT_MOVE) {
      const r = hs * 0.8;
      const a = hs * 0.35;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = lw;
      ctx.stroke();
      // Draw cross arrows
      ctx.strokeStyle = '#0066cc';
      ctx.lineWidth = lw * 1.2;
      ctx.beginPath();
      ctx.moveTo(cx - a, cy); ctx.lineTo(cx + a, cy);
      ctx.moveTo(cx, cy - a); ctx.lineTo(cx, cy + a);
      ctx.stroke();
      return;
    }

    // Square handles (white fill, blue border) — rotated to match annotation
    ctx.save();
    if (annotation.type === 'measureDistance') {
      // Rotate handles to match dimension line angle
      const mdAngle = Math.atan2(annotation.endY - annotation.startY, annotation.endX - annotation.startX);
      ctx.translate(cx, cy);
      ctx.rotate(mdAngle);
      ctx.translate(-cx, -cy);
    } else if (annotation.rotation) {
      ctx.translate(cx, cy);
      ctx.rotate(annotation.rotation * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = lw;
    ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
    ctx.restore();
  });
}

// Draw outline for a single annotation in multi-selection
export function drawMultiSelectionOutline(ctx, annotation) {
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);

  const bounds = getAnnotationBounds(annotation);
  if (bounds) {
    ctx.strokeRect(bounds.x - 2, bounds.y - 2, bounds.width + 4, bounds.height + 4);
  }
  ctx.setLineDash([]);
}

// Draw overall bounding box for multi-selection
export function drawMultiSelectionBounds(ctx) {
  const bounds = getSelectionBounds();
  if (!bounds) return;

  const sc = state.scale || 1;
  ctx.strokeStyle = '#0066cc';
  ctx.lineWidth = 1.5 / sc;
  ctx.setLineDash([6 / sc, 3 / sc]);
  const pad = 6 / sc;
  ctx.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
  ctx.setLineDash([]);

  // Draw corner handles for the overall bounding box
  const hs = HANDLE_SIZE / sc;
  const corners = [
    { x: bounds.x - pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y - pad - hs/2 },
    { x: bounds.x - pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 },
    { x: bounds.x + bounds.width + pad - hs/2, y: bounds.y + bounds.height + pad - hs/2 }
  ];

  corners.forEach(corner => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(corner.x, corner.y, hs, hs);
    ctx.strokeStyle = '#0066cc';
    ctx.lineWidth = 1 / sc;
    ctx.strokeRect(corner.x, corner.y, hs, hs);
  });
}
