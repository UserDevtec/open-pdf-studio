import { state, getActiveDocument } from '../../core/state.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';
import { calculateArea, formatMeasurement, arcControlPoint, expandArcPoints } from '../../annotations/measurement.js';
import { applyToolTransform } from '../tool-context.js';
import {
  enterTypeLengthMode,
  exitTypeLengthMode,
  setTypeLengthStart,
  applyToEndpoint,
  typeLengthHasBuffer,
} from '../type-length-input.js';

// Last cursor position for measurement tools — used when Enter commits at
// typed length so we know the direction.
const _measureCursor = { x: 0, y: 0 };

// Default hatch options for area measurement preview (red diagonal lines at 45°)
const DEFAULT_AREA_HATCH = { pattern: 'diagonal-left', color: '#ff0000', scale: 100, angle: 0 };

// Arc mode state for area measurement (press 'A' to toggle)
const arcState = { active: false, bulge: 0.3 };

/**
 * Measurement tools — measureDistance (3-click dimension), measureArea, measurePerimeter
 */
export const measureDistanceTool = {
  name: 'measureDistance',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, scale } = ctx;

    // Right-click cancels
    if (e.button === 2) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
      return;
    }

    const snap = ctx.snap(x, y, null, state.dimPoints);
    const dimX = snap.snapped ? snap.x : x;
    const dimY = snap.snapped ? snap.y : y;

    if (state.dimPoints.length === 0) {
      // Click 1: first measurement point
      state.dimPoints.push({ x: dimX, y: dimY });
      state.isDrawingDimension = true;
      enterTypeLengthMode(dimX, dimY);
      state._typeLengthCommit = (length) => _commitMeasureDistanceClick2(ctx, e);
    } else if (state.dimPoints.length === 1) {
      // Click 2: second measurement point
      let pt2X = dimX, pt2Y = dimY;
      // Honor typed length if buffer active
      if (typeLengthHasBuffer()) {
        const last = state.dimPoints[0];
        const ep = applyToEndpoint(last.x, last.y, x, y);
        pt2X = ep.x; pt2Y = ep.y;
        // Skip further snap-modifications
        state.dimPoints.push({ x: pt2X, y: pt2Y });
        exitTypeLengthMode();
        state._typeLengthCommit = null;
        return;
      }
      // Apply Shift+angle snap (same logic as preview)
      const prefs = state.preferences;
      if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap) {
        const last = state.dimPoints[0];
        const adx = dimX - last.x, ady = dimY - last.y;
        const alen = Math.sqrt(adx * adx + ady * ady);
        const aangle = Math.atan2(ady, adx) * (180 / Math.PI);
        const asnapped = ctx.snapAngle(aangle, prefs.angleSnapDegrees) * (Math.PI / 180);
        pt2X = last.x + alen * Math.cos(asnapped);
        pt2Y = last.y + alen * Math.sin(asnapped);
      }
      const dx = pt2X - state.dimPoints[0].x;
      const dy = pt2Y - state.dimPoints[0].y;
      if (Math.sqrt(dx * dx + dy * dy) < 3 / scale) return;
      let finalPt = { x: pt2X, y: pt2Y };
      if (e.ctrlKey) finalPt = ctx.snapDistanceTo10(state.dimPoints[0].x, state.dimPoints[0].y, pt2X, pt2Y);
      state.dimPoints.push(finalPt);
    } else if (state.dimPoints.length === 2) {
      // Click 3: offset point — defines dimension line position
      const p1 = state.dimPoints[0];
      const p2 = state.dimPoints[1];
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perpX = -Math.sin(lineAngle);
      const perpY = Math.cos(lineAngle);
      const offDx = dimX - p1.x;
      const offDy = dimY - p1.y;
      const perpDist = offDx * perpX + offDy * perpY;
      const startX = p1.x + perpDist * perpX;
      const startY = p1.y + perpDist * perpY;
      const endX = p2.x + perpDist * perpX;
      const endY = p2.y + perpDist * perpY;

      const prefs = state.preferences;
      const currentPage = getActiveDocument()?.currentPage || 1;
      const dist = ctx.calculateDistance(startX, startY, endX, endY, currentPage);
      const dimPrecision = prefs.measureDistDimPrecision != null ? prefs.measureDistDimPrecision : 2;
      const hasScaleSource = getActiveDocument()?.annotations?.some(a => a.type === 'scaleBar' || a.type === 'viewport');
      const dimScale = hasScaleSource ? 0 : (prefs.measureDistDimScale || 0);
      const dimUnit = hasScaleSource ? dist.unit : (prefs.measureDistDimUnit || dist.unit);
      let mText;
      if (dimScale) {
        const pixelDist = Math.sqrt((endX - startX) ** 2 + (endY - startY) ** 2);
        mText = `${(pixelDist * dimScale).toFixed(dimPrecision)} ${dimUnit}`;
      } else {
        mText = ctx.formatMeasurement(dist);
      }
      const ann = ctx.createAnnotation({
        type: 'measureDistance',
        page: currentPage,
        startX, startY, endX, endY,
        leaderStartX: p1.x, leaderStartY: p1.y,
        leaderEndX: p2.x, leaderEndY: p2.y,
        startHead: prefs.measureDistStartHead || 'openCircle',
        endHead: prefs.measureDistEndHead || 'openCircle',
        headSize: prefs.measureDistHeadSize || 12,
        color: prefs.measureDistStrokeColor,
        strokeColor: prefs.measureDistStrokeColor,
        lineWidth: prefs.measureDistLineWidth,
        opacity: (prefs.measureDistOpacity || 100) / 100,
        measureText: mText,
        measureValue: dist.value,
        measureUnit: dimUnit,
        measurePixels: dist.pixels,
        measureScale: dimScale || undefined,
        measurePrecision: dimPrecision,
      });
      const doc = state.documents[state.activeDocumentIndex];
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();

      // Auto-reset to select tool
      import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    _measureCursor.x = x; _measureCursor.y = y;
    if (!state.isDrawingDimension || state.dimPoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const dimColor = prefs.measureDistStrokeColor || '#FF0000';
    const snap = ctx.snap(x, y, null, state.dimPoints);
    let dimSnapX = snap.snapped ? snap.x : x;
    let dimSnapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;
    // Type-length lock for click-2 preview (only when 1 point set)
    if (typeLengthHasBuffer() && state.dimPoints.length === 1) {
      const last = state.dimPoints[0];
      const ep = applyToEndpoint(last.x, last.y, x, y);
      dimSnapX = ep.x; dimSnapY = ep.y;
      state.lastSnapResult = null;
    }

    // Shift+snap angle constraint
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap) {
      const last = state.dimPoints[state.dimPoints.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
      dimSnapX = last.x + len * Math.cos(snapped);
      dimSnapY = last.y + len * Math.sin(snapped);
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = dimColor;
    canvasCtx.lineWidth = prefs.measureDistLineWidth || 1;
    canvasCtx.globalAlpha = (prefs.measureDistOpacity || 100) / 100;
    canvasCtx.setLineDash([]);

    const p1 = state.dimPoints[0];
    const sHead = prefs.measureDistStartHead || 'openCircle';
    const eHead = prefs.measureDistEndHead || 'openCircle';
    const hSize = prefs.measureDistHeadSize || 12;
    const hasScaleSourcePreview = getActiveDocument()?.annotations?.some(a => a.type === 'scaleBar' || a.type === 'viewport');
    const dimScale = hasScaleSourcePreview ? 0 : (prefs.measureDistDimScale || 0);
    const dimUnit = prefs.measureDistDimUnit || '';
    const dimPrecision = prefs.measureDistDimPrecision != null ? prefs.measureDistDimPrecision : 2;

    function dimMeasureText(sx, sy, ex, ey) {
      if (dimScale) {
        const pixelDist = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
        return `${(pixelDist * dimScale).toFixed(dimPrecision)} ${dimUnit}`;
      }
      const d = ctx.calculateDistance(sx, sy, ex, ey, getActiveDocument()?.currentPage);
      return ctx.formatMeasurement(d);
    }

    if (state.dimPoints.length === 1) {
      if (e.ctrlKey) {
        const s = ctx.snapDistanceTo10(p1.x, p1.y, dimSnapX, dimSnapY);
        dimSnapX = s.x; dimSnapY = s.y;
      }
      ctx.drawDimension(canvasCtx, {
        startX: p1.x, startY: p1.y, endX: dimSnapX, endY: dimSnapY,
        startHead: sHead, endHead: eHead, headSize: hSize,
        color: dimColor, measureText: dimMeasureText(p1.x, p1.y, dimSnapX, dimSnapY)
      });
    } else if (state.dimPoints.length === 2) {
      const p2 = state.dimPoints[1];
      const lineAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const perpX = -Math.sin(lineAngle);
      const perpY = Math.cos(lineAngle);
      const offDx = dimSnapX - p1.x;
      const offDy = dimSnapY - p1.y;
      const perpDist = offDx * perpX + offDy * perpY;
      const dStartX = p1.x + perpDist * perpX;
      const dStartY = p1.y + perpDist * perpY;
      const dEndX = p2.x + perpDist * perpX;
      const dEndY = p2.y + perpDist * perpY;
      ctx.drawDimension(canvasCtx, {
        startX: dStartX, startY: dStartY, endX: dEndX, endY: dEndY,
        leaderStartX: p1.x, leaderStartY: p1.y, leaderEndX: p2.x, leaderEndY: p2.y,
        startHead: sHead, endHead: eHead, headSize: hSize,
        color: dimColor, measureText: dimMeasureText(dStartX, dStartY, dEndX, dEndY)
      });
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingDimension) {
      state.dimPoints = [];
      state.isDrawingDimension = false;
      ctx.redraw();
    }
    exitTypeLengthMode();
    state._typeLengthCommit = null;
  },
};

// Helper: Enter pressed in measureDistance with one point + buffered length.
function _commitMeasureDistanceClick2(ctx, e) {
  const { state } = ctx;
  if (!state.dimPoints || state.dimPoints.length !== 1) return;
  const last = state.dimPoints[0];
  const ep = applyToEndpoint(last.x, last.y, _measureCursor.x, _measureCursor.y);
  state.dimPoints.push({ x: ep.x, y: ep.y });
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  ctx.redraw();
}

export const measureAreaTool = {
  name: 'measureArea',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    _measureMultiClickDown(ctx, e, 'measureArea');
  },

  onPointerMove(ctx, e) {
    _measureMultiClickMove(ctx, e, 'measureArea');
  },

  onKeyDown(ctx, e) {
    // Toggle arc mode with 'A' key during area drawing
    if ((e.key === 'a' || e.key === 'A') && state.measurePoints && state.measurePoints.length > 0) {
      e.preventDefault();
      arcState.active = !arcState.active;
      ctx.redraw();
    }
  },

  onWheel(ctx, e) {
    // Adjust arc bulge with mouse wheel while in arc mode
    if (arcState.active && state.measurePoints && state.measurePoints.length > 0) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.05 : 0.05;
      arcState.bulge = Math.max(-1, Math.min(1, arcState.bulge + delta));
      ctx.redraw();
    }
  },

  onDeactivate(ctx) {
    arcState.active = false;
    arcState.bulge = 0.3;
    _measureDeactivate(ctx);
  },
};

export const measurePerimeterTool = {
  name: 'measurePerimeter',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    _measureMultiClickDown(ctx, e, 'measurePerimeter');
  },

  onPointerMove(ctx, e) {
    _measureMultiClickMove(ctx, e, 'measurePerimeter');
  },

  onDeactivate(ctx) {
    _measureDeactivate(ctx);
  },
};

// Shared helpers for area/perimeter
function _measureMultiClickDown(ctx, e, toolType) {
  const { x, y, state } = ctx;
  const prefs = state.preferences;
  const isArea = toolType === 'measureArea';

  // Right-click finishes
  if (e.button === 2) {
    if (isArea && state.measurePhase === 'holes') {
      // In holes phase: right-click finalizes the entire annotation
      _finishMeasureWithHoles(ctx);
    } else if (isArea && state.measurePoints && state.measurePoints.length >= 3) {
      // In outer phase with enough points: close outer and enter holes phase
      _closeOuterAndEnterHolesPhase(ctx, state);
    } else {
      _finishMeasure(ctx, toolType);
    }
    return;
  }

  if (!state.measurePoints) state.measurePoints = [];

  // Object snap (including in-progress vertices)
  const allInProgressPoints = _getAllInProgressPoints(state, isArea);
  const snap = ctx.snap(x, y, null, allInProgressPoints);
  let ptX = snap.snapped ? snap.x : x;
  let ptY = snap.snapped ? snap.y : y;

  // Type-length lock: when buffer is non-empty and we have a previous point,
  // constrain this click to the typed length in the cursor direction.
  if (typeLengthHasBuffer() && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const ep = applyToEndpoint(last.x, last.y, x, y);
    ptX = ep.x; ptY = ep.y;
  }

  // Angle snap when Shift held
  if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
    ptX = last.x + length * Math.cos(snapped);
    ptY = last.y + length * Math.sin(snapped);
  }

  // Ctrl: snap distance to nearest N units
  if (e.ctrlKey && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const s = ctx.snapDistanceTo10(last.x, last.y, ptX, ptY);
    ptX = s.x; ptY = s.y;
  }

  // Close polygon when clicking near the first point
  if (isArea && state.measurePoints.length >= 3) {
    const first = state.measurePoints[0];
    const dx = ptX - first.x, dy = ptY - first.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10 / ctx.scale) {
      if (state.measurePhase === 'holes') {
        // Close the current hole
        _closeCurrentHole(ctx, state);
      } else {
        // Close outer boundary and enter holes phase
        _closeOuterAndEnterHolesPhase(ctx, state);
      }
      return;
    }
  }

  // Store arc data if arc mode is active (only for measureArea)
  if (isArea && arcState.active) {
    state.measurePoints.push({ x: ptX, y: ptY, arc: true, bulge: arcState.bulge });
    arcState.active = false; // reset arc mode after placing point
  } else {
    state.measurePoints.push({ x: ptX, y: ptY });
  }
  // Arm/refresh type-length anchor for next segment
  if (state.measurePoints.length === 1) {
    enterTypeLengthMode(ptX, ptY);
    state._typeLengthCommit = (length) => _commitMeasureSegmentByLength(ctx, toolType);
  } else {
    setTypeLengthStart(ptX, ptY);
  }
  ctx.redraw();

  // Draw in-progress measurement
  _drawMeasureInProgress(ctx, toolType);
}

function _closeOuterAndEnterHolesPhase(ctx, state) {
  state.measureOuterPoints = [...state.measurePoints];
  state.measurePhase = 'holes';
  state.measureHoles = [];
  state.measurePoints = [];
  ctx.redraw();
  _drawMeasureInProgress(ctx, 'measureArea');
}

function _closeCurrentHole(ctx, state) {
  if (state.measurePoints && state.measurePoints.length >= 3) {
    state.measureHoles = [...state.measureHoles, [...state.measurePoints]];
  }
  state.measurePoints = [];
  ctx.redraw();
  _drawMeasureInProgress(ctx, 'measureArea');
}

function _finishMeasureWithHoles(ctx) {
  const { state } = ctx;
  const doc = state.documents[state.activeDocumentIndex];

  // If there's an incomplete hole with enough points, include it
  if (state.measurePoints && state.measurePoints.length >= 3) {
    state.measureHoles = [...state.measureHoles, [...state.measurePoints]];
  }

  const outerPoints = state.measureOuterPoints;
  const holes = state.measureHoles && state.measureHoles.length > 0 ? state.measureHoles : undefined;

  if (outerPoints && outerPoints.length >= 3) {
    const ann = ctx.createMeasureAreaAnnotation(outerPoints, holes);
    if (ann) { if (doc) doc.annotations.push(ann); ctx.recordAdd(ann); }
  }

  // Reset all state
  state.measurePoints = null;
  state.measurePhase = 'outer';
  state.measureOuterPoints = null;
  state.measureHoles = [];
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  ctx.redraw();

  // Auto-reset to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

// Collect all in-progress points for snap exclusion
function _getAllInProgressPoints(state, isArea) {
  const points = [];
  if (state.measurePoints) {
    points.push(...state.measurePoints);
  }
  if (isArea && state.measurePhase === 'holes') {
    if (state.measureOuterPoints) points.push(...state.measureOuterPoints);
    for (const hole of (state.measureHoles || [])) {
      points.push(...hole);
    }
  }
  return points;
}

function _measureMultiClickMove(ctx, e, toolType) {
  const { x, y, state, canvasCtx, scale } = ctx;
  _measureCursor.x = x; _measureCursor.y = y;
  const isArea = toolType === 'measureArea';
  const inHolesPhase = isArea && state.measurePhase === 'holes';

  // When in holes phase with no active hole points, still show the outer preview
  if (inHolesPhase && (!state.measurePoints || state.measurePoints.length === 0)) {
    ctx.redraw();
    _drawHolesPhasePreview(ctx, x, y);
    _drawHoverSnap(ctx, x, y);
    return;
  }

  if (!state.measurePoints || state.measurePoints.length === 0) {
    _drawHoverSnap(ctx, x, y);
    return;
  }

  const prefs = state.preferences;
  const mColor = (isArea ? prefs.measureAreaStrokeColor : prefs.measurePerimStrokeColor) || '#FF0000';
  const mBorderStyle = (isArea ? prefs.measureAreaBorderStyle : prefs.measurePerimBorderStyle) || 'solid';
  const mFillColor = isArea ? (prefs.measureAreaFillNone ? 'none' : (prefs.measureAreaFillColor || null)) : null;

  const allInProgressPoints = _getAllInProgressPoints(state, isArea);
  const snap = ctx.snap(x, y, null, allInProgressPoints);
  state.lastSnapResult = snap.snapped ? snap : null;

  let snapX = snap.snapped ? snap.x : x;
  let snapY = snap.snapped ? snap.y : y;
  let nearFirst = false;

  // Type-length lock for preview
  if (typeLengthHasBuffer() && state.measurePoints.length > 0) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const ep = applyToEndpoint(last.x, last.y, x, y);
    snapX = ep.x; snapY = ep.y;
    state.lastSnapResult = null;
  }

  // Snap to first point when near (close shape hint) for measureArea
  if (isArea && state.measurePoints.length >= 3) {
    const first = state.measurePoints[0];
    const dx = snapX - first.x, dy = snapY - first.y;
    if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
      snapX = first.x; snapY = first.y;
      nearFirst = true;
    }
  }

  if (!snap.snapped && !nearFirst && e.shiftKey && prefs.enableAngleSnap) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const dx = x - last.x, dy = y - last.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
    snapX = last.x + length * Math.cos(snapped);
    snapY = last.y + length * Math.sin(snapped);
  }

  if (!nearFirst && e.ctrlKey) {
    const last = state.measurePoints[state.measurePoints.length - 1];
    const s = ctx.snapDistanceTo10(last.x, last.y, snapX, snapY);
    snapX = s.x; snapY = s.y;
  }

  ctx.redraw();
  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = (isArea ? prefs.measureAreaLineWidth : prefs.measurePerimLineWidth) || 1;
  canvasCtx.globalAlpha = ((isArea ? prefs.measureAreaOpacity : prefs.measurePerimOpacity) || 100) / 100;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  if (inHolesPhase) {
    // Draw outer polygon + completed holes + in-progress hole
    const outerPoints = state.measureOuterPoints || [];
    const completedHoles = state.measureHoles || [];
    const activeHolePreview = [...state.measurePoints, { x: snapX, y: snapY }];
    const allHoles = activeHolePreview.length >= 3
      ? [...completedHoles, activeHolePreview]
      : completedHoles;

    if (outerPoints.length > 2) {
      ctx.drawMeasureAreaShape(canvasCtx, outerPoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, allHoles, DEFAULT_AREA_HATCH);
    }

    // Draw active hole polyline when < 3 points
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

    // Live area text (outer - holes)
    if (outerPoints.length >= 3) {
      const currentPage = getActiveDocument()?.currentPage || 1;
      const area = ctx.calculateArea(outerPoints, allHoles.length > 0 ? allHoles : undefined, currentPage);
      ctx.drawCentroidLabel(canvasCtx, outerPoints, ctx.formatMeasurement(area), mColor);
    }
  } else {
    // Normal outer drawing
    // If arc mode is active, tag the preview point with arc data
    const previewPt = arcState.active && isArea
      ? { x: snapX, y: snapY, arc: true, bulge: arcState.bulge }
      : { x: snapX, y: snapY };
    const previewPoints = [...state.measurePoints, previewPt];

    if (isArea && previewPoints.length > 2) {
      ctx.drawMeasureAreaShape(canvasCtx, previewPoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, undefined, DEFAULT_AREA_HATCH);
    } else {
      ctx.drawMeasurePerimeterShape(canvasCtx, previewPoints, mColor, mBorderStyle);
    }

    // Arc mode indicator near cursor
    if (arcState.active && isArea) {
      canvasCtx.font = '10px Arial';
      canvasCtx.fillStyle = mColor;
      canvasCtx.globalAlpha = 0.7;
      canvasCtx.fillText(`Arc (bulge: ${arcState.bulge.toFixed(2)})`, snapX + 12, snapY - 8);
      canvasCtx.globalAlpha = ((isArea ? prefs.measureAreaOpacity : prefs.measurePerimOpacity) || 100) / 100;
    }

    // Live measurement text
    const currentPage = getActiveDocument()?.currentPage || 1;
    if (isArea && previewPoints.length >= 3) {
      const expandedPoints = expandArcPoints(previewPoints);
      const area = ctx.calculateArea(expandedPoints, undefined, currentPage);
      ctx.drawCentroidLabel(canvasCtx, previewPoints, ctx.formatMeasurement(area), mColor);
    } else if (!isArea && previewPoints.length >= 2) {
      const perim = ctx.calculatePerimeter(previewPoints, currentPage);
      canvasCtx.font = '11px Arial';
      canvasCtx.fillStyle = mColor;
      canvasCtx.fillText(ctx.formatMeasurement(perim), snapX + 8, snapY - 4);
    }
  }

  // Close indicator at first point
  if (nearFirst) {
    const first = state.measurePoints[0];
    canvasCtx.beginPath();
    canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
    canvasCtx.fillStyle = mColor;
    canvasCtx.globalAlpha = 0.3;
    canvasCtx.fill();
    canvasCtx.globalAlpha = 1;
  }

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
  if (snap.snapped && !nearFirst) {
    ctx.drawSnapIndicator(snap);
  }
}

// Draw preview of outer polygon with completed holes while idle in holes phase
function _drawHolesPhasePreview(ctx, cursorX, cursorY) {
  const { state, canvasCtx, scale } = ctx;
  const prefs = state.preferences;
  const mColor = prefs.measureAreaStrokeColor || '#FF0000';
  const mBorderStyle = prefs.measureAreaBorderStyle || 'solid';
  const mFillColor = prefs.measureAreaFillNone ? 'none' : (prefs.measureAreaFillColor || null);
  const outerPoints = state.measureOuterPoints || [];
  const completedHoles = state.measureHoles || [];

  if (outerPoints.length < 3) return;

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = prefs.measureAreaLineWidth || 1;
  canvasCtx.globalAlpha = (prefs.measureAreaOpacity || 100) / 100;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  ctx.drawMeasureAreaShape(canvasCtx, outerPoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, completedHoles.length > 0 ? completedHoles : undefined, DEFAULT_AREA_HATCH);

  // Show area text
  const currentPage = getActiveDocument()?.currentPage || 1;
  const area = ctx.calculateArea(outerPoints, completedHoles.length > 0 ? completedHoles : undefined, currentPage);
  ctx.drawCentroidLabel(canvasCtx, outerPoints, ctx.formatMeasurement(area), mColor);

  // Draw hint text near cursor
  canvasCtx.font = '10px Arial';
  canvasCtx.fillStyle = mColor;
  canvasCtx.globalAlpha = 0.7;
  canvasCtx.fillText('Click to add hole, right-click to finish', cursorX / scale + 12, cursorY / scale - 4);

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

function _finishMeasure(ctx, toolType) {
  const { state } = ctx;
  if (!state.measurePoints) return;
  const points = [...state.measurePoints];
  const doc = state.documents[state.activeDocumentIndex];

  if (toolType === 'measureArea' && points.length >= 3) {
    const ann = ctx.createMeasureAreaAnnotation(points);
    if (ann) { if (doc) doc.annotations.push(ann); ctx.recordAdd(ann); }
  } else if (toolType === 'measurePerimeter' && points.length >= 2) {
    const ann = ctx.createMeasurePerimeterAnnotation(points);
    if (ann) { if (doc) doc.annotations.push(ann); ctx.recordAdd(ann); }
  }
  state.measurePoints = null;
  state.measurePhase = 'outer';
  state.measureOuterPoints = null;
  state.measureHoles = [];
  exitTypeLengthMode();
  state._typeLengthCommit = null;
  ctx.redraw();

  // Auto-reset to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _measureDeactivate(ctx) {
  const { state } = ctx;
  if (state.measurePoints || state.measureOuterPoints) {
    state.measurePoints = null;
    state.measurePhase = 'outer';
    state.measureOuterPoints = null;
    state.measureHoles = [];
    ctx.redraw();
  }
  exitTypeLengthMode();
  state._typeLengthCommit = null;
}

// Helper: Enter pressed during measureArea/measurePerimeter — append the
// next vertex at the typed length in the current cursor direction.
function _commitMeasureSegmentByLength(ctx, toolType) {
  const { state } = ctx;
  if (!state.measurePoints || state.measurePoints.length === 0) return;
  const last = state.measurePoints[state.measurePoints.length - 1];
  const ep = applyToEndpoint(last.x, last.y, _measureCursor.x, _measureCursor.y);
  state.measurePoints.push({ x: ep.x, y: ep.y });
  setTypeLengthStart(ep.x, ep.y);
  ctx.redraw();
}

function _drawMeasureInProgress(ctx, toolType) {
  const { state, canvasCtx, scale } = ctx;
  const prefs = state.preferences;
  const isArea = toolType === 'measureArea';
  const mColor = (isArea ? prefs.measureAreaStrokeColor : prefs.measurePerimStrokeColor) || '#FF0000';
  const mBorderStyle = (isArea ? prefs.measureAreaBorderStyle : prefs.measurePerimBorderStyle) || 'solid';
  const mFillColor = isArea ? (prefs.measureAreaFillNone ? 'none' : (prefs.measureAreaFillColor || null)) : null;

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = (isArea ? prefs.measureAreaLineWidth : prefs.measurePerimLineWidth) || 1;
  canvasCtx.globalAlpha = ((isArea ? prefs.measureAreaOpacity : prefs.measurePerimOpacity) || 100) / 100;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  if (isArea && state.measurePhase === 'holes') {
    // In holes phase: draw outer + completed holes
    const outerPoints = state.measureOuterPoints || [];
    const completedHoles = state.measureHoles || [];
    if (outerPoints.length > 2) {
      ctx.drawMeasureAreaShape(canvasCtx, outerPoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, completedHoles.length > 0 ? completedHoles : undefined, DEFAULT_AREA_HATCH);
    }
  } else if (isArea && state.measurePoints && state.measurePoints.length > 2) {
    ctx.drawMeasureAreaShape(canvasCtx, state.measurePoints, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, undefined, DEFAULT_AREA_HATCH);
  } else if (state.measurePoints && state.measurePoints.length > 0) {
    ctx.drawMeasurePerimeterShape(canvasCtx, state.measurePoints, mColor, mBorderStyle);
  }

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

function _drawHoverSnap(ctx, x, y) {
  const snap = ctx.snap(x, y);
  const { state } = ctx;
  if (snap.snapped) {
    state.lastSnapResult = snap;
    ctx.redraw();
    ctx.drawSnapIndicator(snap);
  } else if (state.lastSnapResult) {
    state.lastSnapResult = null;
    ctx.redraw();
  }
}

// Export arc state for keyboard/wheel handler access from tool-dispatcher
export { arcState };

// ─── Add Hole to existing measureArea annotation ───

/**
 * addHoleTool — activated from the context menu on a measureArea annotation.
 * Draws a polygon that gets added as a hole to the target annotation.
 * Right-click or clicking near the first point closes the hole.
 */
// Arc-mode toggle for the addHole flow ('A' toggles, mouse wheel adjusts bulge).
const addHoleArcState = { active: false, bulge: 0.3 };

export const addHoleTool = {
  name: 'addHole',
  cursor: 'crosshair',

  onKeyDown(ctx, e) {
    if ((e.key === 'a' || e.key === 'A')) {
      const pts = state.addHolePoints || [];
      if (pts.length > 0) {
        e.preventDefault();
        addHoleArcState.active = !addHoleArcState.active;
        ctx.redraw();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      addHoleArcState.active = false;
      addHoleArcState.bulge = 0.3;
      state.addHoleTargetId = null;
      state.addHolePoints = [];
      ctx.redraw();
      import("../manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
    }
  },

  onWheel(ctx, e) {
    if (addHoleArcState.active) {
      const pts = state.addHolePoints || [];
      if (pts.length > 0) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.05 : 0.05;
        addHoleArcState.bulge = Math.max(-1, Math.min(1, addHoleArcState.bulge + delta));
        ctx.redraw();
      }
    }
  },

  onPointerDown(ctx, e) {
    const { x, y, scale } = ctx;
    const targetId = state.addHoleTargetId;
    if (!targetId) return;

    // Right-click finishes
    if (e.button === 2) {
      _finishAddHole(ctx);
      return;
    }

    const pts = state.addHolePoints || [];

    // Snap
    const snap = ctx.snap(x, y, targetId, pts);
    let ptX = snap.snapped ? snap.x : x;
    let ptY = snap.snapped ? snap.y : y;

    // Angle snap with Shift
    const prefs = state.preferences;
    if (!snap.snapped && e.shiftKey && prefs.enableAngleSnap && pts.length > 0) {
      const last = pts[pts.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
      ptX = last.x + length * Math.cos(snapped);
      ptY = last.y + length * Math.sin(snapped);
    }

    // Close polygon when clicking near first point
    if (pts.length >= 3) {
      const first = pts[0];
      const dx = ptX - first.x, dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        _finishAddHole(ctx);
        return;
      }
    }

    const newPt = addHoleArcState.active
      ? { x: ptX, y: ptY, arc: true, bulge: addHoleArcState.bulge }
      : { x: ptX, y: ptY };
    if (addHoleArcState.active) addHoleArcState.active = false; // reset after placing
    state.addHolePoints = [...pts, newPt];
    ctx.redraw();
    _drawAddHoleInProgress(ctx);
  },

  onPointerMove(ctx, e) {
    const { x, y, canvasCtx, scale } = ctx;
    const targetId = state.addHoleTargetId;
    if (!targetId) return;

    const pts = state.addHolePoints || [];
    if (pts.length === 0) {
      _drawAddHolePreview(ctx, x, y);
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, targetId, pts);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    let nearFirst = false;
    if (pts.length >= 3) {
      const first = pts[0];
      const dx = snapX - first.x, dy = snapY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        snapX = first.x; snapY = first.y;
        nearFirst = true;
      }
    }

    if (!snap.snapped && !nearFirst && e.shiftKey && prefs.enableAngleSnap) {
      const last = pts[pts.length - 1];
      const dx = x - last.x, dy = y - last.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      const snapped = ctx.snapAngle(angle, prefs.angleSnapDegrees) * (Math.PI / 180);
      snapX = last.x + length * Math.cos(snapped);
      snapY = last.y + length * Math.sin(snapped);
    }

    ctx.redraw();

    // Find target annotation for rendering context
    const doc = getActiveDocument();
    const ann = doc?.annotations.find(a => a.id === targetId);
    if (!ann) return;

    const mColor = ann.strokeColor || ann.color || '#FF0000';
    const mFillColor = ann.fillColor || null;
    const mBorderStyle = ann.borderStyle || 'dashed';

    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = mColor;
    canvasCtx.lineWidth = ann.lineWidth || 1;
    canvasCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    // Build preview holes: existing holes + in-progress hole (arc-aware)
    const existingHoles = ann.holes || [];
    const previewPt = addHoleArcState.active
      ? { x: snapX, y: snapY, arc: true, bulge: addHoleArcState.bulge }
      : { x: snapX, y: snapY };
    const previewHole = [...pts, previewPt];
    const allHoles = previewHole.length >= 3
      ? [...existingHoles, previewHole]
      : existingHoles;

    // Draw the full annotation with preview hole
    if (ann.points && ann.points.length > 2) {
      ctx.drawMeasureAreaShape(canvasCtx, ann.points, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, allHoles.length > 0 ? allHoles : undefined, DEFAULT_AREA_HATCH);
    }

    // Draw in-progress hole polyline when < 3 points
    if (previewHole.length < 3 && previewHole.length >= 2) {
      canvasCtx.setLineDash([2, 4]);
      canvasCtx.beginPath();
      canvasCtx.moveTo(previewHole[0].x, previewHole[0].y);
      for (let i = 1; i < previewHole.length; i++) {
        canvasCtx.lineTo(previewHole[i].x, previewHole[i].y);
      }
      canvasCtx.stroke();
      canvasCtx.setLineDash([]);
    }

    // Live area text (measureArea only)
    if (ann.type === 'measureArea' && ann.points && ann.points.length >= 3) {
      const area = ctx.calculateArea(ann.points, allHoles.length > 0 ? allHoles : undefined, ann.page || 1);
      ctx.drawCentroidLabel(canvasCtx, ann.points, ctx.formatMeasurement(area), mColor);
    }

    // Arc-mode hint near cursor
    if (addHoleArcState.active) {
      canvasCtx.font = '10px Arial';
      canvasCtx.fillStyle = mColor;
      canvasCtx.globalAlpha = 0.7;
      canvasCtx.fillText(`Arc (bulge: ${addHoleArcState.bulge.toFixed(2)})`, snapX + 12 / scale, snapY - 8 / scale);
      canvasCtx.globalAlpha = 1;
    }

    // Close indicator at first point
    if (nearFirst) {
      const first = pts[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = mColor;
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }

    canvasCtx.globalAlpha = 1;
    canvasCtx.restore();

    if (snap.snapped && !nearFirst) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    addHoleArcState.active = false;
    addHoleArcState.bulge = 0.3;
    state.addHoleTargetId = null;
    state.addHolePoints = [];
    ctx.redraw();
  },
};

function _finishAddHole(ctx) {
  const pts = state.addHolePoints || [];
  const targetId = state.addHoleTargetId;
  const doc = getActiveDocument();

  if (pts.length >= 3 && targetId && doc) {
    const ann = doc.annotations.find(a => a.id === targetId);
    if (ann) {
      // Record original state for undo
      const oldAnn = cloneAnnotation(ann);

      // Add the hole
      if (!ann.holes) ann.holes = [];
      ann.holes = [...ann.holes, [...pts]];

      // Recalculate the area measurement (measureArea only)
      if (ann.type === 'measureArea') _recalcMeasureAreaText(ann, ctx);

      ann.modifiedAt = new Date().toISOString();
      recordModify(ann.id, oldAnn, ann);
    }
  }

  // Reset state and switch back to select tool
  state.addHoleTargetId = null;
  state.addHolePoints = [];
  ctx.redraw();

  // Switch back to select tool
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
}

function _recalcMeasureAreaText(ann, ctx) {
  if (!ann.points || ann.points.length < 3) return;

  // Always use calculateArea (resolves scale from scaleBar / document / prefs)
  // + formatMeasurement (auto-converts mm² → m²)
  const area = calculateArea(ann.points, ann.holes, ann.page || 1);
  ann.measureText = formatMeasurement(area);
  ann.measureValue = area.value;
  ann.measureUnit = area.unit;
}

function _drawAddHolePreview(ctx, cursorX, cursorY) {
  const { canvasCtx, scale } = ctx;
  const targetId = state.addHoleTargetId;
  const doc = getActiveDocument();
  const ann = doc?.annotations.find(a => a.id === targetId);
  if (!ann || !ann.points || ann.points.length < 3) return;

  const mColor = ann.strokeColor || ann.color || '#FF0000';
  const mFillColor = ann.fillColor || null;
  const mBorderStyle = ann.borderStyle || 'dashed';

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = ann.lineWidth || 1;
  canvasCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  ctx.drawMeasureAreaShape(canvasCtx, ann.points, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, ann.holes && ann.holes.length > 0 ? ann.holes : undefined, DEFAULT_AREA_HATCH);

  // Show area text (measureArea only)
  if (ann.type === 'measureArea') {
    const area = ctx.calculateArea(ann.points, ann.holes, ann.page || 1);
    ctx.drawCentroidLabel(canvasCtx, ann.points, ctx.formatMeasurement(area), mColor);
  }

  // Draw hint text near cursor
  canvasCtx.font = '10px Arial';
  canvasCtx.fillStyle = mColor;
  canvasCtx.globalAlpha = 0.7;
  canvasCtx.fillText('Click to draw hole, right-click to cancel', cursorX + 12 / scale, cursorY - 4 / scale);

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}

function _drawAddHoleInProgress(ctx) {
  const { canvasCtx, scale } = ctx;
  const targetId = state.addHoleTargetId;
  const doc = getActiveDocument();
  const ann = doc?.annotations.find(a => a.id === targetId);
  if (!ann || !ann.points || ann.points.length < 3) return;

  const mColor = ann.strokeColor || ann.color || '#FF0000';
  const mFillColor = ann.fillColor || null;
  const mBorderStyle = ann.borderStyle || 'dashed';
  const pts = state.addHolePoints || [];
  const existingHoles = ann.holes || [];
  const allHoles = pts.length >= 3 ? [...existingHoles, pts] : existingHoles;

  canvasCtx.save();
  applyToolTransform(canvasCtx);
  canvasCtx.strokeStyle = mColor;
  canvasCtx.lineWidth = ann.lineWidth || 1;
  canvasCtx.globalAlpha = ann.opacity != null ? ann.opacity : 1;
  canvasCtx.lineCap = 'round';
  canvasCtx.lineJoin = 'round';

  ctx.drawMeasureAreaShape(canvasCtx, ann.points, mColor, canvasCtx.lineWidth, mFillColor, mBorderStyle, allHoles.length > 0 ? allHoles : undefined, DEFAULT_AREA_HATCH);

  canvasCtx.globalAlpha = 1;
  canvasCtx.restore();
}
