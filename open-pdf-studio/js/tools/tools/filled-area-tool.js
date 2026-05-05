/**
 * filledAreaTool — multi-click contour with optional arcs and holes,
 * resulting in a filled annotation (solid color or hatch pattern).
 *
 * Flow:
 *   - Click points to extend the outer contour.
 *   - Press 'A' to mark the next point as an arc segment (uses bulge factor,
 *     adjustable with the mouse wheel while arc-mode is active).
 *   - Click near the first point or right-click with >= 3 points to close
 *     the outer contour and enter the holes phase.
 *   - In holes phase, draw additional sub-contours; clicking near the first
 *     point of a hole or right-clicking finalizes that hole. Right-click on
 *     an empty hole-phase commits the annotation.
 *
 * The annotation type is 'filledArea'. Reuses the arc-aware {x,y,arc,bulge}
 * point structure already used by measureArea, plus a holes[][] array.
 */

import { state, getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';
import { createAnnotation } from '../../annotations/factory.js';

// Arc-mode toggle for the next-placed point. 'A' toggles, mouse wheel
// adjusts bulge while active.
const arcState = { active: false, bulge: 0.3 };

export const filledAreaTool = {
  name: 'filledArea',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const prefs = state.preferences;

    // Right-click finishes (close outer or commit annotation).
    if (e.button === 2) {
      if (state.filledAreaPhase === 'holes') {
        _finishFilledAreaWithHoles(ctx);
      } else if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
        _closeOuterAndEnterHolesPhase(ctx);
      } else {
        _finishFilledArea(ctx);
      }
      return;
    }

    if (!state.filledAreaPoints) state.filledAreaPoints = [];

    const allInProgress = _getAllInProgressPoints();
    const snap = ctx.snap(x, y, null, allInProgress);
    let ptX = snap.snapped ? snap.x : x;
    let ptY = snap.snapped ? snap.y : y;

    // Angle snap with Shift (skip when in arc mode — bulge already deviates)
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && state.filledAreaPoints.length > 0) {
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(ang, prefs.angleSnapDegrees) * (Math.PI / 180);
      ptX = last.x + len * Math.cos(snapped);
      ptY = last.y + len * Math.sin(snapped);
    }

    // Close outer contour by clicking near first point.
    if (state.filledAreaPhase !== 'holes' && state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = ptX - first.x, dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
        _closeOuterAndEnterHolesPhase(ctx);
        return;
      }
    }

    // In hole phase: clicking near the first point of the active hole closes it.
    if (state.filledAreaPhase === 'holes' && state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = ptX - first.x, dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
        _closeCurrentHole(ctx);
        return;
      }
    }

    if (arcState.active) {
      state.filledAreaPoints.push({ x: ptX, y: ptY, arc: true, bulge: arcState.bulge });
      arcState.active = false; // reset after placing one arc point
    } else {
      state.filledAreaPoints.push({ x: ptX, y: ptY });
    }
    ctx.redraw();
    _drawInProgress(ctx);
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx, scale } = ctx;
    const prefs = state.preferences;
    const inHoles = state.filledAreaPhase === 'holes';

    if (inHoles && (!state.filledAreaPoints || state.filledAreaPoints.length === 0)) {
      ctx.redraw();
      _drawHolesPhasePreview(ctx, x, y);
      _drawHoverSnap(ctx, x, y);
      return;
    }

    if (!state.filledAreaPoints || state.filledAreaPoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const allInProgress = _getAllInProgressPoints();
    const snap = ctx.snap(x, y, null, allInProgress);
    state.lastSnapResult = snap.snapped ? snap : null;
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    let nearFirst = false;

    if (state.filledAreaPoints.length >= 3) {
      const first = state.filledAreaPoints[0];
      const dx = snapX - first.x, dy = snapY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        snapX = first.x; snapY = first.y; nearFirst = true;
      }
    }

    if (!snap.snapped && !nearFirst && e.shiftKey && prefs.enableAngleSnap) {
      const last = state.filledAreaPoints[state.filledAreaPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(ang, prefs.angleSnapDegrees) * (Math.PI / 180);
      snapX = last.x + len * Math.cos(snapped);
      snapY = last.y + len * Math.sin(snapped);
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);

    const strokeColor = prefs.filledAreaStrokeColor || '#000000';
    const fillColor = prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc');
    const lineWidth = prefs.filledAreaLineWidth || 1;
    const borderStyle = prefs.filledAreaBorderStyle || 'solid';
    const opacity = (prefs.filledAreaOpacity ?? 100) / 100;
    const hatchOpts = prefs.filledAreaHatchPattern && prefs.filledAreaHatchPattern !== 'none'
      ? {
          pattern: prefs.filledAreaHatchPattern,
          color: prefs.filledAreaHatchColor || strokeColor,
          scale: prefs.filledAreaHatchScale ?? 100,
          angle: prefs.filledAreaHatchAngle ?? 0,
        }
      : null;

    canvasCtx.strokeStyle = strokeColor;
    canvasCtx.lineWidth = lineWidth;
    canvasCtx.globalAlpha = opacity;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    if (inHoles) {
      const outer = state.filledAreaOuterPoints || [];
      const completed = state.filledAreaHoles || [];
      const previewPt = arcState.active
        ? { x: snapX, y: snapY, arc: true, bulge: arcState.bulge }
        : { x: snapX, y: snapY };
      const activeHolePreview = [...state.filledAreaPoints, previewPt];
      const allHoles = activeHolePreview.length >= 3
        ? [...completed, activeHolePreview]
        : completed;
      if (outer.length >= 3) {
        ctx.drawMeasureAreaShape(canvasCtx, outer, strokeColor, lineWidth, fillColor, borderStyle, allHoles, hatchOpts);
      }
      if (activeHolePreview.length < 3 && activeHolePreview.length >= 2) {
        canvasCtx.setLineDash([2, 4]);
        canvasCtx.beginPath();
        canvasCtx.moveTo(activeHolePreview[0].x, activeHolePreview[0].y);
        for (let i = 1; i < activeHolePreview.length; i++) {
          canvasCtx.lineTo(activeHolePreview[i].x, activeHolePreview[i].y);
        }
        canvasCtx.stroke();
        canvasCtx.setLineDash([]);
      }
    } else {
      const previewPt = arcState.active
        ? { x: snapX, y: snapY, arc: true, bulge: arcState.bulge }
        : { x: snapX, y: snapY };
      const previewPts = [...state.filledAreaPoints, previewPt];
      if (previewPts.length > 2) {
        ctx.drawMeasureAreaShape(canvasCtx, previewPts, strokeColor, lineWidth, fillColor, borderStyle, undefined, hatchOpts);
      } else {
        // Fallback: simple polyline preview
        canvasCtx.beginPath();
        canvasCtx.moveTo(previewPts[0].x, previewPts[0].y);
        for (let i = 1; i < previewPts.length; i++) {
          canvasCtx.lineTo(previewPts[i].x, previewPts[i].y);
        }
        canvasCtx.stroke();
      }
    }

    if (arcState.active) {
      canvasCtx.font = '10px Arial';
      canvasCtx.fillStyle = strokeColor;
      canvasCtx.globalAlpha = 0.7;
      canvasCtx.fillText(`Arc (bulge: ${arcState.bulge.toFixed(2)})`, snapX + 12, snapY - 8);
      canvasCtx.globalAlpha = opacity;
    }

    if (nearFirst) {
      const first = state.filledAreaPoints[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = strokeColor;
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
    if (snap.snapped && !nearFirst) ctx.drawSnapIndicator(snap);
  },

  onKeyDown(ctx, e) {
    if ((e.key === 'a' || e.key === 'A') && state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      e.preventDefault();
      arcState.active = !arcState.active;
      ctx.redraw();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (state.filledAreaPhase === 'holes') {
        _finishFilledAreaWithHoles(ctx);
      } else if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
        _closeOuterAndEnterHolesPhase(ctx);
        // Immediately commit (Enter without holes)
        _finishFilledAreaWithHoles(ctx);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _resetState();
      ctx.redraw();
      import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    }
  },

  onWheel(ctx, e) {
    if (arcState.active && state.filledAreaPoints && state.filledAreaPoints.length > 0) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      arcState.bulge = Math.max(-1, Math.min(1, arcState.bulge + delta));
      ctx.redraw();
    }
  },

  onDeactivate(ctx) {
    arcState.active = false;
    arcState.bulge = 0.3;
    _resetState();
    ctx.redraw();
  },
};

// ─────────────────────────────────────────────────────────────────────

function _getAllInProgressPoints() {
  const pts = [];
  if (state.filledAreaPoints) pts.push(...state.filledAreaPoints);
  if (state.filledAreaPhase === 'holes') {
    if (state.filledAreaOuterPoints) pts.push(...state.filledAreaOuterPoints);
    for (const h of (state.filledAreaHoles || [])) pts.push(...h);
  }
  return pts;
}

function _resetState() {
  state.filledAreaPoints = null;
  state.filledAreaPhase = 'outer';
  state.filledAreaOuterPoints = null;
  state.filledAreaHoles = [];
}

function _closeOuterAndEnterHolesPhase(ctx) {
  state.filledAreaOuterPoints = [...state.filledAreaPoints];
  state.filledAreaPhase = 'holes';
  state.filledAreaHoles = [];
  state.filledAreaPoints = [];
  ctx.redraw();
}

function _closeCurrentHole(ctx) {
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    state.filledAreaHoles = [...(state.filledAreaHoles || []), [...state.filledAreaPoints]];
  }
  state.filledAreaPoints = [];
  ctx.redraw();
}

function _finishFilledArea(ctx) {
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    const ann = _createFilledAreaAnnotation(ctx, state.filledAreaPoints);
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  _resetState();
  ctx.redraw();
  import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _finishFilledAreaWithHoles(ctx) {
  // Finalize incomplete in-progress hole if it has 3+ points.
  if (state.filledAreaPoints && state.filledAreaPoints.length >= 3) {
    state.filledAreaHoles = [...(state.filledAreaHoles || []), [...state.filledAreaPoints]];
  }
  const outer = state.filledAreaOuterPoints;
  const holes = state.filledAreaHoles && state.filledAreaHoles.length > 0 ? state.filledAreaHoles : undefined;
  if (outer && outer.length >= 3) {
    const ann = _createFilledAreaAnnotation(ctx, outer, holes);
    if (ann) {
      const doc = getActiveDocument();
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  _resetState();
  ctx.redraw();
  import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _createFilledAreaAnnotation(ctx, points, holes) {
  const prefs = state.preferences;
  const props = {
    type: 'filledArea',
    page: getActiveDocument()?.currentPage || 1,
    points,
    color: prefs.filledAreaStrokeColor || '#000000',
    strokeColor: prefs.filledAreaStrokeColor || '#000000',
    fillColor: prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc'),
    lineWidth: prefs.filledAreaLineWidth ?? 1,
    borderStyle: prefs.filledAreaBorderStyle || 'solid',
    opacity: (prefs.filledAreaOpacity ?? 100) / 100,
    hatchPattern: prefs.filledAreaHatchPattern || 'none',
    hatchColor: prefs.filledAreaHatchColor || '#000000',
    hatchScale: prefs.filledAreaHatchScale ?? 100,
    hatchAngle: prefs.filledAreaHatchAngle ?? 0,
  };
  if (holes && holes.length > 0) props.holes = holes;
  // Bounding box for selection helpers.
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  props.x = Math.min(...xs);
  props.y = Math.min(...ys);
  props.width = Math.max(...xs) - props.x;
  props.height = Math.max(...ys) - props.y;
  return createAnnotation(props);
}

function _drawInProgress(ctx) {
  // Lightweight redraw — full preview is handled in onPointerMove.
  ctx.redraw();
}

function _drawHolesPhasePreview(ctx, cursorX, cursorY) {
  const { canvasCtx, scale } = ctx;
  const prefs = state.preferences;
  const outer = state.filledAreaOuterPoints || [];
  const completed = state.filledAreaHoles || [];
  if (outer.length < 3) return;

  const strokeColor = prefs.filledAreaStrokeColor || '#000000';
  const fillColor = prefs.filledAreaFillNone ? null : (prefs.filledAreaFillColor || '#cccccc');
  const lineWidth = prefs.filledAreaLineWidth || 1;
  const borderStyle = prefs.filledAreaBorderStyle || 'solid';
  const opacity = (prefs.filledAreaOpacity ?? 100) / 100;
  const hatchOpts = prefs.filledAreaHatchPattern && prefs.filledAreaHatchPattern !== 'none'
    ? {
        pattern: prefs.filledAreaHatchPattern,
        color: prefs.filledAreaHatchColor || strokeColor,
        scale: prefs.filledAreaHatchScale ?? 100,
        angle: prefs.filledAreaHatchAngle ?? 0,
      }
    : null;

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = strokeColor;
  canvasCtx.lineWidth = lineWidth;
  canvasCtx.globalAlpha = opacity;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  ctx.drawMeasureAreaShape(canvasCtx, outer, strokeColor, lineWidth, fillColor, borderStyle, completed.length > 0 ? completed : undefined, hatchOpts);

  canvasCtx.font = '10px Arial';
  canvasCtx.fillStyle = strokeColor;
  canvasCtx.globalAlpha = 0.7;
  canvasCtx.fillText('Click to add hole, right-click or Enter to finish', cursorX + 12 / scale, cursorY - 4 / scale);
  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}
