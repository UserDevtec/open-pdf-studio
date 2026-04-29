import { HANDLE_TYPES } from '../core/constants.js';
import { state } from '../core/state.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, snapDistanceTo10 } from './measurement.js';

// Compute measurement text for a dimension annotation, using its own scale if available
function computeDimensionText(ann) {
  if (ann.measureScale) {
    const dx = ann.endX - ann.startX;
    const dy = ann.endY - ann.startY;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const scaledVal = pixelDist * ann.measureScale;
    const unit = ann.measureUnit || 'mm';
    const prec = ann.measurePrecision !== undefined ? ann.measurePrecision : 2;
    return `${scaledVal.toFixed(prec)} ${unit}`;
  }
  return formatMeasurement(calculateDistance(ann.startX, ann.startY, ann.endX, ann.endY, ann.page));
}

// Recalculate callout leader line geometry from box position and arrow tip.
// Picks the best box edge based on arrow position:
//   - Arrow to the side → horizontal arm from left/right edge at vertical center
//   - Arrow above/below → vertical arm from top/bottom edge at horizontal center
function recalcCalloutLeader(annotation) {
  const boxW = annotation.width || 150;
  const boxH = annotation.height || 50;
  const arrowX = annotation.arrowX !== undefined ? annotation.arrowX : annotation.x - 60;
  const arrowY = annotation.arrowY !== undefined ? annotation.arrowY : annotation.y + boxH;

  const boxCenterX = annotation.x + boxW / 2;
  const boxCenterY = annotation.y + boxH / 2;

  // How far the arrow is outside the box span in each axis
  const hDist = arrowX < annotation.x ? annotation.x - arrowX :
                arrowX > annotation.x + boxW ? arrowX - (annotation.x + boxW) : 0;
  const vDist = arrowY < annotation.y ? annotation.y - arrowY :
                arrowY > annotation.y + boxH ? arrowY - (annotation.y + boxH) : 0;

  // Determine current mode, with hysteresis to prevent flickering
  const wasVertical = annotation._leaderVertical;
  const threshold = 20;
  let useVertical;
  if (wasVertical) {
    // Currently vertical — only switch to horizontal if hDist exceeds vDist by threshold
    useVertical = !(hDist > vDist + threshold);
  } else {
    // Currently horizontal — only switch to vertical if vDist exceeds hDist by threshold
    useVertical = vDist > hDist + threshold;
  }
  annotation._leaderVertical = useVertical;

  if (!useVertical) {
    // Arrow is more to the side → horizontal arm from left/right edge, vertical center
    const isLeft = arrowX < boxCenterX;
    annotation.armOriginX = isLeft ? annotation.x : annotation.x + boxW;
    annotation.armOriginY = boxCenterY;

    const armLen = Math.min(30, Math.abs(arrowX - annotation.armOriginX) * 0.4);
    annotation.kneeX = isLeft ? annotation.armOriginX - armLen : annotation.armOriginX + armLen;
    annotation.kneeY = annotation.armOriginY;
  } else {
    // Arrow is more above/below → vertical arm from top/bottom edge, horizontal center
    const isAbove = arrowY < boxCenterY;
    annotation.armOriginX = boxCenterX;
    annotation.armOriginY = isAbove ? annotation.y : annotation.y + boxH;

    const armLen = Math.min(30, Math.abs(arrowY - annotation.armOriginY) * 0.4);
    annotation.kneeX = annotation.armOriginX;
    annotation.kneeY = isAbove ? annotation.armOriginY - armLen : annotation.armOriginY + armLen;
  }
}

// Rotate a delta vector from screen space into the annotation's local coordinate space
function rotateDelta(deltaX, deltaY, rotationDeg) {
  if (!rotationDeg) return { dx: deltaX, dy: deltaY };
  const rad = -rotationDeg * Math.PI / 180;
  return {
    dx: deltaX * Math.cos(rad) - deltaY * Math.sin(rad),
    dy: deltaX * Math.sin(rad) + deltaY * Math.cos(rad)
  };
}

// Apply resize for a rotated rectangular annotation.
// The idea: resize in local (unrotated) space, then reposition so the
// anchor corner (opposite to the dragged handle) stays in the same
// screen position.
function applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn, lockRatio = false) {
  const rot = originalAnn.rotation || 0;
  const { dx, dy } = rotateDelta(deltaX, deltaY, rot);

  // Start from original values
  let newX = originalAnn.x;
  let newY = originalAnn.y;
  let newW = originalAnn.width;
  let newH = originalAnn.height;
  const aspectRatio = lockRatio && originalAnn.originalWidth && originalAnn.originalHeight
    ? originalAnn.originalWidth / originalAnn.originalHeight
    : (lockRatio ? originalAnn.width / originalAnn.height : 0);

  // Apply local-space resize
  switch (handleType) {
    case HANDLE_TYPES.TOP_LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
        newY = originalAnn.y + originalAnn.height - newH;
      } else {
        newX += dx; newY += dy; newW -= dx; newH -= dy;
      }
      break;
    case HANDLE_TYPES.TOP_RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
        newY = originalAnn.y + originalAnn.height - newH;
      } else {
        newY += dy; newW += dx; newH -= dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM_LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
      } else {
        newX += dx; newW -= dx; newH += dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM_RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
      } else {
        newW += dx; newH += dy;
      }
      break;
    case HANDLE_TYPES.TOP:
      if (lockRatio) {
        newH -= dy; newW = newH * aspectRatio;
        newY = originalAnn.y + originalAnn.height - newH;
        newX = originalAnn.x + (originalAnn.width - newW) / 2;
      } else {
        newY += dy; newH -= dy;
      }
      break;
    case HANDLE_TYPES.BOTTOM:
      if (lockRatio) {
        newH += dy; newW = newH * aspectRatio;
        newX = originalAnn.x + (originalAnn.width - newW) / 2;
      } else {
        newH += dy;
      }
      break;
    case HANDLE_TYPES.LEFT:
      if (lockRatio) {
        newW -= dx; newH = newW / aspectRatio;
        newX = originalAnn.x + originalAnn.width - newW;
        newY = originalAnn.y + (originalAnn.height - newH) / 2;
      } else {
        newX += dx; newW -= dx;
      }
      break;
    case HANDLE_TYPES.RIGHT:
      if (lockRatio) {
        newW += dx; newH = newW / aspectRatio;
        newY = originalAnn.y + (originalAnn.height - newH) / 2;
      } else {
        newW += dx;
      }
      break;
  }

  // Enforce minimum size
  if (newW < 10) { newW = 10; if (lockRatio) newH = newW / aspectRatio; }
  if (newH < 10) { newH = 10; if (lockRatio) newW = newH * aspectRatio; }

  // The center of the original annotation in screen space
  const rad = rot * Math.PI / 180;
  const cosR = Math.cos(rad);
  const sinR = Math.sin(rad);

  const origCx = originalAnn.x + originalAnn.width / 2;
  const origCy = originalAnn.y + originalAnn.height / 2;

  // New center in local space (relative to old local origin)
  const newLocalCx = newX + newW / 2;
  const newLocalCy = newY + newH / 2;

  // Offset of new center from old center in local space
  const localOffX = newLocalCx - (originalAnn.x + originalAnn.width / 2);
  const localOffY = newLocalCy - (originalAnn.y + originalAnn.height / 2);

  // Rotate offset back to screen space to get the new screen center
  const screenCx = origCx + localOffX * cosR - localOffY * sinR;
  const screenCy = origCy + localOffX * sinR + localOffY * cosR;

  // Set annotation position from screen center
  annotation.x = screenCx - newW / 2;
  annotation.y = screenCy - newH / 2;
  annotation.width = newW;
  annotation.height = newH;
}

// Apply resize based on handle being dragged
export function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false, ctrlKey = false) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      if (originalAnn.rotation) {
        applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn);
      } else {
        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            annotation.y = originalAnn.y + deltaY;
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            annotation.width = originalAnn.width + deltaX;
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.TOP:
            annotation.y = originalAnn.y + deltaY;
            annotation.height = originalAnn.height - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM:
            annotation.height = originalAnn.height + deltaY;
            break;
          case HANDLE_TYPES.LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.width = originalAnn.width - deltaX;
            break;
          case HANDLE_TYPES.RIGHT:
            annotation.width = originalAnn.width + deltaX;
            break;
        }
        // Ensure minimum size
        if (annotation.width < 10) annotation.width = 10;
        if (annotation.height < 10) annotation.height = 10;
      }
      break;

    case 'callout':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 150;
      if (!originalAnn.height) originalAnn.height = 50;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_MOVE:
          // Move entire callout (box + arrow + all points)
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          annotation.armOriginX = (originalAnn.armOriginX || originalAnn.x) + deltaX;
          annotation.armOriginY = (originalAnn.armOriginY || originalAnn.y + originalAnn.height / 2) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_ARROW:
          // Move arrow tip
          annotation.arrowX = (originalAnn.arrowX || originalAnn.x - 60) + deltaX;
          annotation.arrowY = (originalAnn.arrowY || originalAnn.y + originalAnn.height) + deltaY;
          break;
        case HANDLE_TYPES.CALLOUT_KNEE:
          // Constrain to the arm direction: horizontal arm → move X only, vertical arm → move Y only
          if (annotation._leaderVertical) {
            annotation.kneeY = (originalAnn.kneeY || originalAnn.y + originalAnn.height / 2) + deltaY;
          } else {
            annotation.kneeX = (originalAnn.kneeX || originalAnn.x - 30) + deltaX;
          }
          break;
      }
      // Ensure minimum size
      if (annotation.width < 50) annotation.width = 50;
      if (annotation.height < 30) annotation.height = 30;
      // Recalculate leader line geometry (skip for move-all, already correct)
      if (handleType === HANDLE_TYPES.CALLOUT_MOVE) {
        // Everything moved together, no recalc needed
      } else if (handleType === HANDLE_TYPES.CALLOUT_KNEE) {
        // Preserve user's knee offset in the arm direction, recalc everything else
        const isVert = annotation._leaderVertical;
        const userKneeX = annotation.kneeX;
        const userKneeY = annotation.kneeY;
        recalcCalloutLeader(annotation);
        if (isVert) {
          annotation.kneeY = userKneeY;
        } else {
          annotation.kneeX = userKneeX;
        }
      } else {
        recalcCalloutLeader(annotation);
      }
      break;

    case 'line':
    case 'arrow':
      if (handleType === HANDLE_TYPES.LINE_START) {
        let newStartX = originalAnn.startX + deltaX;
        let newStartY = originalAnn.startY + deltaY;
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.endX;
          const fixedY = originalAnn.endY;
          const dx = newStartX - fixedX;
          const dy = newStartY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newStartX = fixedX + length * Math.cos(snappedAngle);
          newStartY = fixedY + length * Math.sin(snappedAngle);
        }
        annotation.startX = newStartX;
        annotation.startY = newStartY;
      } else if (handleType === HANDLE_TYPES.LINE_END) {
        let newEndX = originalAnn.endX + deltaX;
        let newEndY = originalAnn.endY + deltaY;
        if (shiftKey && state.preferences.enableAngleSnap) {
          const fixedX = originalAnn.startX;
          const fixedY = originalAnn.startY;
          const dx = newEndX - fixedX;
          const dy = newEndY - fixedY;
          const length = Math.sqrt(dx * dx + dy * dy);
          const currentAngle = Math.atan2(dy, dx) * (180 / Math.PI);
          const snappedAngle = snapAngle(currentAngle, state.preferences.angleSnapDegrees) * (Math.PI / 180);
          newEndX = fixedX + length * Math.cos(snappedAngle);
          newEndY = fixedY + length * Math.sin(snappedAngle);
        }
        annotation.endX = newEndX;
        annotation.endY = newEndY;
      }
      break;

    case 'measureDistance': {
      if (handleType === HANDLE_TYPES.LEADER_START || handleType === HANDLE_TYPES.LEADER_END) {
        // Outer handles: move freely, define the measured points
        let newLSX = handleType === HANDLE_TYPES.LEADER_START
          ? originalAnn.leaderStartX + deltaX : originalAnn.leaderStartX;
        let newLSY = handleType === HANDLE_TYPES.LEADER_START
          ? originalAnn.leaderStartY + deltaY : originalAnn.leaderStartY;
        let newLEX = handleType === HANDLE_TYPES.LEADER_END
          ? originalAnn.leaderEndX + deltaX : originalAnn.leaderEndX;
        let newLEY = handleType === HANDLE_TYPES.LEADER_END
          ? originalAnn.leaderEndY + deltaY : originalAnn.leaderEndY;

        // Snap to angle increments when Shift is held
        if (shiftKey && state.preferences.enableAngleSnap) {
          if (handleType === HANDLE_TYPES.LEADER_START) {
            const dx = newLSX - newLEX;
            const dy = newLSY - newLEY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const cur = Math.atan2(dy, dx) * (180 / Math.PI);
            const snapped = snapAngle(cur, state.preferences.angleSnapDegrees) * (Math.PI / 180);
            newLSX = newLEX + len * Math.cos(snapped);
            newLSY = newLEY + len * Math.sin(snapped);
          } else {
            const dx = newLEX - newLSX;
            const dy = newLEY - newLSY;
            const len = Math.sqrt(dx * dx + dy * dy);
            const cur = Math.atan2(dy, dx) * (180 / Math.PI);
            const snapped = snapAngle(cur, state.preferences.angleSnapDegrees) * (Math.PI / 180);
            newLEX = newLSX + len * Math.cos(snapped);
            newLEY = newLSY + len * Math.sin(snapped);
          }
        }

        // Ctrl key: snap distance between leader tips to nearest 10 units
        if (ctrlKey) {
          if (handleType === HANDLE_TYPES.LEADER_START) {
            const s = snapDistanceTo10(newLEX, newLEY, newLSX, newLSY);
            newLSX = s.x; newLSY = s.y;
          } else {
            const s = snapDistanceTo10(newLSX, newLSY, newLEX, newLEY);
            newLEX = s.x; newLEY = s.y;
          }
        }

        // Snap to alignment with the other leader point
        const dimAlignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
        if (handleType === HANDLE_TYPES.LEADER_START) {
          if (Math.abs(newLSY - newLEY) < dimAlignTol) newLSY = newLEY;
          if (Math.abs(newLSX - newLEX) < dimAlignTol) newLSX = newLEX;
        } else {
          if (Math.abs(newLEY - newLSY) < dimAlignTol) newLEY = newLSY;
          if (Math.abs(newLEX - newLSX) < dimAlignTol) newLEX = newLSX;
        }

        annotation.leaderStartX = newLSX;
        annotation.leaderStartY = newLSY;
        annotation.leaderEndX = newLEX;
        annotation.leaderEndY = newLEY;

        // Recompute dimension line: keep the same perpendicular offset from leader tips
        // Compute perpDist from ORIGINAL geometry (so it stays constant at any angle)
        const origLDx = originalAnn.leaderEndX - originalAnn.leaderStartX;
        const origLDy = originalAnn.leaderEndY - originalAnn.leaderStartY;
        const origLLen = Math.sqrt(origLDx * origLDx + origLDy * origLDy) || 1;
        const origPerpX = -origLDy / origLLen;
        const origPerpY = origLDx / origLLen;
        const offDx = originalAnn.startX - originalAnn.leaderStartX;
        const offDy = originalAnn.startY - originalAnn.leaderStartY;
        const perpDist = offDx * origPerpX + offDy * origPerpY;
        // Apply that fixed offset along the NEW perpendicular direction
        const newLDx = newLEX - newLSX;
        const newLDy = newLEY - newLSY;
        const newLLen = Math.sqrt(newLDx * newLDx + newLDy * newLDy) || 1;
        const perpX = -newLDy / newLLen;
        const perpY = newLDx / newLLen;
        // Place dimension line endpoints at the perpendicular offset from new leader tips
        annotation.startX = newLSX + perpDist * perpX;
        annotation.startY = newLSY + perpDist * perpY;
        annotation.endX = newLEX + perpDist * perpX;
        annotation.endY = newLEY + perpDist * perpY;

        annotation.measureText = computeDimensionText(annotation);
      } else if (handleType === HANDLE_TYPES.LINE_START || handleType === HANDLE_TYPES.LINE_END) {
        // Inner handles: constrain to perpendicular direction only (change offset, not measurement)
        // Perpendicular direction based on the leader line
        const ldrDx = originalAnn.leaderEndX - originalAnn.leaderStartX;
        const ldrDy = originalAnn.leaderEndY - originalAnn.leaderStartY;
        const ldrLen = Math.sqrt(ldrDx * ldrDx + ldrDy * ldrDy) || 1;
        const pX = -ldrDy / ldrLen;
        const pY = ldrDx / ldrLen;
        // Project mouse delta onto perpendicular
        const pDot = deltaX * pX + deltaY * pY;
        // Move both dimension line endpoints together (keep parallel to leader line)
        annotation.startX = originalAnn.startX + pDot * pX;
        annotation.startY = originalAnn.startY + pDot * pY;
        annotation.endX = originalAnn.endX + pDot * pX;
        annotation.endY = originalAnn.endY + pDot * pY;
      }
      break;
    }

    case 'measureAngle': {
      // Node drag for angle measurement
      if (typeof handleType === 'string' && handleType.startsWith('polyline_node_')) {
        const angleNodeIdx = parseInt(handleType.split('_').pop(), 10);
        const anglePoints = [
          { ...originalAnn.point1 },
          { ...originalAnn.vertex },
          { ...originalAnn.point2 },
        ];
        if (angleNodeIdx >= 0 && angleNodeIdx < 3) {
          anglePoints[angleNodeIdx].x += deltaX;
          anglePoints[angleNodeIdx].y += deltaY;
          // Snap to sibling vertex alignment
          const angAlignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
          for (let ai = 0; ai < 3; ai++) {
            if (ai === angleNodeIdx) continue;
            if (Math.abs(anglePoints[angleNodeIdx].y - anglePoints[ai].y) < angAlignTol) anglePoints[angleNodeIdx].y = anglePoints[ai].y;
            if (Math.abs(anglePoints[angleNodeIdx].x - anglePoints[ai].x) < angAlignTol) anglePoints[angleNodeIdx].x = anglePoints[ai].x;
          }
        }
        annotation.point1 = anglePoints[0];
        annotation.vertex = anglePoints[1];
        annotation.point2 = anglePoints[2];
        // Recalculate angle
        const a1 = Math.atan2(annotation.point1.y - annotation.vertex.y, annotation.point1.x - annotation.vertex.x);
        const a2 = Math.atan2(annotation.point2.y - annotation.vertex.y, annotation.point2.x - annotation.vertex.x);
        let angleDeg = (a2 - a1) * (180 / Math.PI);
        if (angleDeg < 0) angleDeg += 360;
        if (angleDeg > 180) angleDeg = 360 - angleDeg;
        annotation.measureValue = angleDeg;
        annotation.measureText = angleDeg.toFixed(1) + '\u00B0';
      }
      break;
    }

    case 'draw':
      // Scale the path based on bounding box resize
      if (originalAnn.path && originalAnn.path.length > 0) {
        const minX = Math.min(...originalAnn.path.map(p => p.x));
        const minY = Math.min(...originalAnn.path.map(p => p.y));
        const maxX = Math.max(...originalAnn.path.map(p => p.x));
        const maxY = Math.max(...originalAnn.path.map(p => p.y));
        const origWidth = maxX - minX || 1;
        const origHeight = maxY - minY || 1;

        let newMinX = minX, newMinY = minY, newMaxX = maxX, newMaxY = maxY;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            newMinX = minX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            newMaxX = maxX + deltaX;
            newMinY = minY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            newMinX = minX + deltaX;
            newMaxY = maxY + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            newMaxX = maxX + deltaX;
            newMaxY = maxY + deltaY;
            break;
        }

        const newWidth = newMaxX - newMinX || 1;
        const newHeight = newMaxY - newMinY || 1;
        const scaleX = newWidth / origWidth;
        const scaleY = newHeight / origHeight;

        annotation.path = originalAnn.path.map(p => ({
          x: newMinX + (p.x - minX) * scaleX,
          y: newMinY + (p.y - minY) * scaleY
        }));
      }
      break;

    case 'polyline':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
      // Label drag for measureArea
      if (handleType === HANDLE_TYPES.LABEL_MOVE && annotation.type === 'measureArea') {
        // Compute centroid as default if no label position set
        let baseLx, baseLy;
        if (originalAnn.labelX != null && originalAnn.labelY != null) {
          baseLx = originalAnn.labelX;
          baseLy = originalAnn.labelY;
        } else {
          baseLx = 0; baseLy = 0;
          for (const p of originalAnn.points) { baseLx += p.x; baseLy += p.y; }
          baseLx /= originalAnn.points.length;
          baseLy /= originalAnn.points.length;
        }
        annotation.labelX = baseLx + deltaX;
        annotation.labelY = baseLy + deltaY;
        break;
      }
      // Drag individual node
      if (typeof handleType === 'string' && handleType.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_')) {
        // Check if this is a hole node: polyline_node_hole_<holeIdx>_<nodeIdx>
        const holeMatch = handleType.match(/^polyline_node_hole_(\d+)_(\d+)$/);
        if (holeMatch && annotation.type === 'measureArea' && originalAnn.holes) {
          const holeIdx = parseInt(holeMatch[1], 10);
          const nodeIdx = parseInt(holeMatch[2], 10);
          if (holeIdx < originalAnn.holes.length && nodeIdx < originalAnn.holes[holeIdx].length) {
            annotation.holes = originalAnn.holes.map((hole, hi) => {
              if (hi !== holeIdx) return hole.map(p => ({ x: p.x, y: p.y }));
              return hole.map((p, ni) => {
                if (ni !== nodeIdx) return { x: p.x, y: p.y };
                let nx = p.x + deltaX, ny = p.y + deltaY;
                if (shiftKey) {
                  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                  if (len > 0) {
                    const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                    nx = p.x + len * Math.cos(ang);
                    ny = p.y + len * Math.sin(ang);
                  }
                }
                return { x: nx, y: ny };
              });
            });
            // Recalculate measurement text with holes
            annotation.measureText = formatMeasurement(calculateArea(annotation.points, annotation.holes, annotation.page));
          }
        } else {
          // Regular outer node drag
          const nodeIdx = parseInt(handleType.split('_').pop(), 10);
          if (originalAnn.points && !isNaN(nodeIdx) && nodeIdx < originalAnn.points.length) {
            annotation.points = originalAnn.points.map((p, i) => {
              if (i === nodeIdx) {
                let nx = p.x + deltaX, ny = p.y + deltaY;
                // Shift key: constrain movement to horizontal/vertical/diagonal
                if (shiftKey) {
                  const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                  if (len > 0) {
                    const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                    nx = p.x + len * Math.cos(ang);
                    ny = p.y + len * Math.sin(ang);
                  }
                }
                // Ctrl key: snap segment to previous point to nearest N units (measure types only)
                if (ctrlKey && (annotation.type === 'measureArea' || annotation.type === 'measurePerimeter')) {
                  const prevIdx = i > 0 ? i - 1 : originalAnn.points.length - 1;
                  const prev = originalAnn.points[prevIdx];
                  if (prev && prevIdx !== i) {
                    const s = snapDistanceTo10(prev.x, prev.y, nx, ny);
                    nx = s.x; ny = s.y;
                  }
                }
                // Snap to sibling vertex alignment (horizontal/vertical)
                const alignTol = 3 / (state.documents?.[state.activeDocumentIndex]?.scale || 1.5);
                for (let si = 0; si < originalAnn.points.length; si++) {
                  if (si === i) continue;
                  const sp = originalAnn.points[si];
                  if (Math.abs(ny - sp.y) < alignTol) ny = sp.y;
                  if (Math.abs(nx - sp.x) < alignTol) nx = sp.x;
                }
                return { x: nx, y: ny };
              }
              return { x: p.x, y: p.y };
            });
            // Recalculate bounding box
            const xs = annotation.points.map(p => p.x);
            const ys = annotation.points.map(p => p.y);
            annotation.x = Math.min(...xs);
            annotation.y = Math.min(...ys);
            annotation.width = Math.max(...xs) - annotation.x;
            annotation.height = Math.max(...ys) - annotation.y;
            // Recalculate measurement text (with holes if present)
            if (annotation.type === 'measureArea') {
              annotation.measureText = formatMeasurement(calculateArea(annotation.points, annotation.holes, annotation.page));
            } else if (annotation.type === 'measurePerimeter') {
              annotation.measureText = formatMeasurement(calculatePerimeter(annotation.points, annotation.page));
            }
          }
        }
      }
      break;

    case 'viewport': {
      // Viewport: standard rectangle resize, minimum 40x40
      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX; annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX; annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX; annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY; annotation.height = originalAnn.height - deltaY; break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY; break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX; annotation.width = originalAnn.width - deltaX; break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX; break;
      }
      if (annotation.width < 40) annotation.width = 40;
      if (annotation.height < 40) annotation.height = 40;
      break;
    }

    case 'image':
    case 'stamp':
    case 'signature':
    case 'scaleBar':
    case 'scheduleTable': {
      const lockRatio = shiftKey || annotation.lockAspectRatio;
      if (originalAnn.rotation) {
        applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn, lockRatio);
      } else {
        const aspectRatio = originalAnn.originalWidth && originalAnn.originalHeight
          ? originalAnn.originalWidth / originalAnn.originalHeight
          : originalAnn.width / originalAnn.height;

        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            if (lockRatio) {
              const newWidth = originalAnn.width - deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.x = originalAnn.x + originalAnn.width - newWidth;
              annotation.y = originalAnn.y + originalAnn.height - newHeight;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.x = originalAnn.x + deltaX;
              annotation.y = originalAnn.y + deltaY;
              annotation.width = originalAnn.width - deltaX;
              annotation.height = originalAnn.height - deltaY;
            }
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            if (lockRatio) {
              const newWidth = originalAnn.width + deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.y = originalAnn.y + originalAnn.height - newHeight;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.y = originalAnn.y + deltaY;
              annotation.width = originalAnn.width + deltaX;
              annotation.height = originalAnn.height - deltaY;
            }
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            if (lockRatio) {
              const newWidth = originalAnn.width - deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.x = originalAnn.x + originalAnn.width - newWidth;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.x = originalAnn.x + deltaX;
              annotation.width = originalAnn.width - deltaX;
              annotation.height = originalAnn.height + deltaY;
            }
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            if (lockRatio) {
              const newWidth = originalAnn.width + deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.width = originalAnn.width + deltaX;
              annotation.height = originalAnn.height + deltaY;
            }
            break;
          case HANDLE_TYPES.TOP:
            if (lockRatio) {
              const newHeight = originalAnn.height - deltaY;
              const newWidth = newHeight * aspectRatio;
              annotation.y = originalAnn.y + deltaY;
              annotation.x = originalAnn.x + (originalAnn.width - newWidth) / 2;
              annotation.height = newHeight;
              annotation.width = newWidth;
            } else {
              annotation.y = originalAnn.y + deltaY;
              annotation.height = originalAnn.height - deltaY;
            }
            break;
          case HANDLE_TYPES.BOTTOM:
            if (lockRatio) {
              const newHeight = originalAnn.height + deltaY;
              const newWidth = newHeight * aspectRatio;
              annotation.x = originalAnn.x + (originalAnn.width - newWidth) / 2;
              annotation.height = newHeight;
              annotation.width = newWidth;
            } else {
              annotation.height = originalAnn.height + deltaY;
            }
            break;
          case HANDLE_TYPES.LEFT:
            if (lockRatio) {
              const newWidth = originalAnn.width - deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.x = originalAnn.x + deltaX;
              annotation.y = originalAnn.y + (originalAnn.height - newHeight) / 2;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.x = originalAnn.x + deltaX;
              annotation.width = originalAnn.width - deltaX;
            }
            break;
          case HANDLE_TYPES.RIGHT:
            if (lockRatio) {
              const newWidth = originalAnn.width + deltaX;
              const newHeight = newWidth / aspectRatio;
              annotation.y = originalAnn.y + (originalAnn.height - newHeight) / 2;
              annotation.width = newWidth;
              annotation.height = newHeight;
            } else {
              annotation.width = originalAnn.width + deltaX;
            }
            break;
        }
        // Ensure minimum size
        if (annotation.width < 20) annotation.width = 20;
        if (annotation.height < 20) annotation.height = 20;

      }
      break;
    }

    case 'comment':
      // Initialize width/height if not set
      if (!originalAnn.width) originalAnn.width = 24;
      if (!originalAnn.height) originalAnn.height = 24;

      switch (handleType) {
        case HANDLE_TYPES.TOP_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.TOP_RIGHT:
          annotation.y = originalAnn.y + deltaY;
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.BOTTOM_RIGHT:
          annotation.width = originalAnn.width + deltaX;
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.TOP:
          annotation.y = originalAnn.y + deltaY;
          annotation.height = originalAnn.height - deltaY;
          break;
        case HANDLE_TYPES.BOTTOM:
          annotation.height = originalAnn.height + deltaY;
          break;
        case HANDLE_TYPES.LEFT:
          annotation.x = originalAnn.x + deltaX;
          annotation.width = originalAnn.width - deltaX;
          break;
        case HANDLE_TYPES.RIGHT:
          annotation.width = originalAnn.width + deltaX;
          break;
      }
      // Ensure minimum size
      if (annotation.width < 20) annotation.width = 20;
      if (annotation.height < 20) annotation.height = 20;
      break;

    default:
      // Plugin rect/oval-area resize: types that use {x, y, w, h} (not
      // width/height) get corner/edge resize support here. Mirrors the
      // built-in 'box' case but writes to `w`/`h` instead.
      if (
        typeof originalAnn.x === 'number'
        && typeof originalAnn.y === 'number'
        && typeof originalAnn.w === 'number'
        && typeof originalAnn.h === 'number'
        && typeof handleType === 'string'
        && !handleType.startsWith('polyline_node_')
      ) {
        switch (handleType) {
          case HANDLE_TYPES.TOP_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.y = originalAnn.y + deltaY;
            annotation.w = originalAnn.w - deltaX;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.TOP_RIGHT:
            annotation.y = originalAnn.y + deltaY;
            annotation.w = originalAnn.w + deltaX;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.w = originalAnn.w - deltaX;
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.BOTTOM_RIGHT:
            annotation.w = originalAnn.w + deltaX;
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.TOP:
            annotation.y = originalAnn.y + deltaY;
            annotation.h = originalAnn.h - deltaY;
            break;
          case HANDLE_TYPES.BOTTOM:
            annotation.h = originalAnn.h + deltaY;
            break;
          case HANDLE_TYPES.LEFT:
            annotation.x = originalAnn.x + deltaX;
            annotation.w = originalAnn.w - deltaX;
            break;
          case HANDLE_TYPES.RIGHT:
            annotation.w = originalAnn.w + deltaX;
            break;
        }
        // Minimum-size guard: collapsing below 10 px makes the shape
        // unreachable. Mirror the box-case minimum.
        if (annotation.w < 10) annotation.w = 10;
        if (annotation.h < 10) annotation.h = 10;
        break;
      }
      // Plugin polyline fallback: any annotation-type with a points array supports
      // polyline_node_<i> handle-drag identically to the builtin polyline case.
      if (typeof handleType === 'string' && handleType.startsWith('polyline_node_') &&
          originalAnn.points && Array.isArray(originalAnn.points)) {
        const nodeIdx = parseInt(handleType.split('_').pop(), 10);
        if (!isNaN(nodeIdx) && nodeIdx < originalAnn.points.length) {
          annotation.points = originalAnn.points.map((p, i) => {
            if (i === nodeIdx) {
              let nx = p.x + deltaX, ny = p.y + deltaY;
              if (shiftKey) {
                const len = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
                if (len > 0) {
                  const ang = snapAngle(Math.atan2(deltaY, deltaX) * (180 / Math.PI), 45) * (Math.PI / 180);
                  nx = p.x + len * Math.cos(ang);
                  ny = p.y + len * Math.sin(ang);
                }
              }
              return { x: nx, y: ny };
            }
            return { x: p.x, y: p.y };
          });
          // Recalculate bounding box if annotation tracks x/y/width/height
          if (typeof annotation.x === 'number') {
            const xs = annotation.points.map(p => p.x);
            const ys = annotation.points.map(p => p.y);
            annotation.x = Math.min(...xs);
            annotation.y = Math.min(...ys);
            annotation.width = Math.max(...xs) - annotation.x;
            annotation.height = Math.max(...ys) - annotation.y;
          }
        }
      }
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply move to annotation
export function applyMove(annotation, deltaX, deltaY) {
  if (annotation.locked) return;

  switch (annotation.type) {
    case 'box':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'callout':
      // Move only the text box - arrow tip stays anchored
      annotation.x += deltaX;
      annotation.y += deltaY;
      // Recalculate leader line from new box position to fixed arrow
      recalcCalloutLeader(annotation);
      break;

    case 'circle':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'line':
    case 'arrow':
      annotation.startX += deltaX;
      annotation.startY += deltaY;
      annotation.endX += deltaX;
      annotation.endY += deltaY;
      break;

    case 'measureDistance':
      annotation.startX += deltaX;
      annotation.startY += deltaY;
      annotation.endX += deltaX;
      annotation.endY += deltaY;
      if (annotation.leaderStartX !== undefined) {
        annotation.leaderStartX += deltaX;
        annotation.leaderStartY += deltaY;
        annotation.leaderEndX += deltaX;
        annotation.leaderEndY += deltaY;
      }
      break;

    case 'measureAngle':
      if (annotation.point1) { annotation.point1.x += deltaX; annotation.point1.y += deltaY; }
      if (annotation.vertex) { annotation.vertex.x += deltaX; annotation.vertex.y += deltaY; }
      if (annotation.point2) { annotation.point2.x += deltaX; annotation.point2.y += deltaY; }
      break;

    case 'comment':
    case 'text':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'draw':
      if (annotation.path) {
        annotation.path = annotation.path.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'polyline':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
      if (annotation.points) {
        annotation.points = annotation.points.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      // Move holes along with the outer polygon
      if (annotation.type === 'measureArea' && annotation.holes) {
        annotation.holes = annotation.holes.map(hole =>
          hole.map(p => ({ x: p.x + deltaX, y: p.y + deltaY }))
        );
      }
      // Move label position along with the polygon
      if (annotation.type === 'measureArea' && annotation.labelX != null && annotation.labelY != null) {
        annotation.labelX += deltaX;
        annotation.labelY += deltaY;
      }
      break;

    case 'image':
    case 'stamp':
    case 'signature':
    case 'viewport':
    case 'scaleBar':
    case 'scheduleTable':
      annotation.x += deltaX;
      annotation.y += deltaY;
      break;

    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      // Move bounding box
      annotation.x += deltaX;
      annotation.y += deltaY;
      // Move individual rects
      if (annotation.rects) {
        annotation.rects = annotation.rects.map(r => ({
          x: r.x + deltaX,
          y: r.y + deltaY,
          width: r.width,
          height: r.height
        }));
      }
      // Move quadPoints if present
      if (annotation.quadPoints) {
        annotation.quadPoints = annotation.quadPoints.map(quad => {
          // quadPoints: [x1,y1,x2,y2,x3,y3,x4,y4]
          return [
            quad[0] + deltaX, quad[1] + deltaY,  // top-left
            quad[2] + deltaX, quad[3] + deltaY,  // top-right
            quad[4] + deltaX, quad[5] + deltaY,  // bottom-left
            quad[6] + deltaX, quad[7] + deltaY   // bottom-right
          ];
        });
      }
      break;

    default:
      // Generic move for plugin-registered types (e.g. symitech.schade,
      // symitech.scheur, symitech.vloer-contour). Without this branch any
      // annotation whose type isn't in the built-in switch would silently
      // refuse to move when dragged with the hand-tool.
      // Strategy: shift any of the well-known position-bearing fields that
      // are present on the annotation. Plugins that need custom semantics
      // can still opt out by setting `annotation.locked = true` (handled
      // at the top of this function).
      if (typeof annotation.x === 'number') annotation.x += deltaX;
      if (typeof annotation.y === 'number') annotation.y += deltaY;
      if (typeof annotation.startX === 'number') annotation.startX += deltaX;
      if (typeof annotation.startY === 'number') annotation.startY += deltaY;
      if (typeof annotation.endX === 'number') annotation.endX += deltaX;
      if (typeof annotation.endY === 'number') annotation.endY += deltaY;
      // Nested position-bearing fields used by point-marker plugin types
      // (symitech.schade, symitech.reeks, symitech.doorvoer.point-marker store
      // their coordinate as `at: {x, y}` rather than top-level x/y).
      if (annotation.at && typeof annotation.at === 'object') {
        if (typeof annotation.at.x === 'number') annotation.at.x += deltaX;
        if (typeof annotation.at.y === 'number') annotation.at.y += deltaY;
      }
      // Center-coordinate variants (e.g. circle/ellipse-shaped plugin types).
      if (typeof annotation.cx === 'number') annotation.cx += deltaX;
      if (typeof annotation.cy === 'number') annotation.cy += deltaY;
      if (Array.isArray(annotation.points)) {
        annotation.points = annotation.points.map(p => ({
          ...p,
          x: typeof p.x === 'number' ? p.x + deltaX : p.x,
          y: typeof p.y === 'number' ? p.y + deltaY : p.y,
        }));
      }
      if (Array.isArray(annotation.path)) {
        annotation.path = annotation.path.map(p => ({
          ...p,
          x: typeof p.x === 'number' ? p.x + deltaX : p.x,
          y: typeof p.y === 'number' ? p.y + deltaY : p.y,
        }));
      }
      break;
  }

  annotation.modifiedAt = new Date().toISOString();
}

// Apply rotation to annotation
export function applyRotation(annotation, mouseX, mouseY, originalAnn) {
  if (annotation.locked) return;

  // Supported types for rotation
  const rotationTypes = ['image', 'stamp', 'signature', 'comment', 'box', 'circle', 'highlight', 'polygon', 'cloud', 'textbox'];
  if (!rotationTypes.includes(annotation.type)) return;

  // Calculate center of annotation
  let width, height, centerX, centerY;

  width = originalAnn.width || 24;
  height = originalAnn.height || 24;
  centerX = originalAnn.x + width / 2;
  centerY = originalAnn.y + height / 2;

  // Calculate angle from center to mouse position
  // +90 offset because the rotation handle is above the annotation (at -90°)
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI) + 90;

  annotation.rotation = Math.round(angle);

  // Snap to 15 degree increments when shift is held
  if (state.shiftKeyPressed && state.preferences.enableAngleSnap) {
    annotation.rotation = snapAngle(annotation.rotation, state.preferences.angleSnapDegrees);
  } else {
    // Magnetic snap to common angles (0, ±45, ±90, ±135, 180) within ±3° tolerance
    const magnetAngles = [0, 45, 90, 135, 180, -45, -90, -135, -180];
    const magnetTolerance = 3;
    for (const magnet of magnetAngles) {
      if (Math.abs(annotation.rotation - magnet) <= magnetTolerance) {
        annotation.rotation = magnet;
        break;
      }
    }
  }

  annotation.modifiedAt = new Date().toISOString();
}
