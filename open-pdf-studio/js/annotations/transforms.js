import { HANDLE_TYPES } from '../core/constants.js';
import { state } from '../core/state.js';
import { snapAngle } from '../utils/helpers.js';

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
function applyRotatedResize(annotation, handleType, deltaX, deltaY, originalAnn) {
  const rot = originalAnn.rotation || 0;
  const { dx, dy } = rotateDelta(deltaX, deltaY, rot);

  // Start from original values
  let newX = originalAnn.x;
  let newY = originalAnn.y;
  let newW = originalAnn.width;
  let newH = originalAnn.height;

  // Apply local-space resize
  switch (handleType) {
    case HANDLE_TYPES.TOP_LEFT:
      newX += dx; newY += dy; newW -= dx; newH -= dy;
      break;
    case HANDLE_TYPES.TOP_RIGHT:
      newY += dy; newW += dx; newH -= dy;
      break;
    case HANDLE_TYPES.BOTTOM_LEFT:
      newX += dx; newW -= dx; newH += dy;
      break;
    case HANDLE_TYPES.BOTTOM_RIGHT:
      newW += dx; newH += dy;
      break;
    case HANDLE_TYPES.TOP:
      newY += dy; newH -= dy;
      break;
    case HANDLE_TYPES.BOTTOM:
      newH += dy;
      break;
    case HANDLE_TYPES.LEFT:
      newX += dx; newW -= dx;
      break;
    case HANDLE_TYPES.RIGHT:
      newW += dx;
      break;
  }

  // Enforce minimum size
  if (newW < 10) { newW = 10; }
  if (newH < 10) { newH = 10; }

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
export function applyResize(annotation, handleType, deltaX, deltaY, originalAnn, shiftKey = false) {
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

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
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

        // Snap to angle increments when Shift is held (and angle snapping is enabled)
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
      // Drag individual node
      if (typeof handleType === 'string' && handleType.startsWith(HANDLE_TYPES.POLYLINE_NODE + '_')) {
        const nodeIdx = parseInt(handleType.split('_').pop(), 10);
        if (originalAnn.points && !isNaN(nodeIdx) && nodeIdx < originalAnn.points.length) {
          annotation.points = originalAnn.points.map((p, i) => {
            if (i === nodeIdx) {
              return { x: p.x + deltaX, y: p.y + deltaY };
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
        }
      }
      break;

    case 'image':
    case 'stamp':
    case 'signature': {
      // Maintain aspect ratio when shift is held or lockAspectRatio is enabled
      const aspectRatio = originalAnn.originalWidth / originalAnn.originalHeight;
      const lockRatio = shiftKey || annotation.lockAspectRatio;

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
      // Support both old (centerX/centerY) and new (x/y) model
      if (annotation.x !== undefined) {
        annotation.x += deltaX;
        annotation.y += deltaY;
      } else {
        annotation.centerX += deltaX;
        annotation.centerY += deltaY;
      }
      break;

    case 'line':
    case 'arrow':
      annotation.startX += deltaX;
      annotation.startY += deltaY;
      annotation.endX += deltaX;
      annotation.endY += deltaY;
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
      if (annotation.points) {
        annotation.points = annotation.points.map(p => ({
          x: p.x + deltaX,
          y: p.y + deltaY
        }));
      }
      break;

    case 'image':
    case 'stamp':
    case 'signature':
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

  if (annotation.type === 'circle' && originalAnn.radius) {
    // Handle old circle format with radius
    width = originalAnn.radius * 2;
    height = originalAnn.radius * 2;
    centerX = originalAnn.centerX || (originalAnn.x + width / 2);
    centerY = originalAnn.centerY || (originalAnn.y + height / 2);
  } else {
    width = originalAnn.width || 24;
    height = originalAnn.height || 24;
    centerX = originalAnn.x + width / 2;
    centerY = originalAnn.y + height / 2;
  }

  // Calculate angle from center to mouse position
  const angle = Math.atan2(mouseY - centerY, mouseX - centerX) * (180 / Math.PI);

  // Adjust angle (rotation handle is to the right, so no offset needed)
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
