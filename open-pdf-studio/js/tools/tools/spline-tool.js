import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform } from '../tool-context.js';

/**
 * Spline tool — multi-click Catmull-Rom spline
 * Click to add control points, double-click or right-click to finish.
 * Minimum 3 points required. The curve passes through all clicked points.
 */

/**
 * Compute Catmull-Rom spline points from control points.
 * Returns an array of {x, y} sample points.
 * @param {Array<{x:number,y:number}>} pts - control points (minimum 3)
 * @param {number} segments - number of sample segments between each pair
 * @returns {Array<{x:number,y:number}>}
 */
export function catmullRomSpline(pts, segments = 16) {
  if (pts.length < 2) return [...pts];
  if (pts.length === 2) return [...pts];

  const result = [];
  // Extend with phantom points at start and end for full curve coverage
  const extended = [
    { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y },
    ...pts,
    { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x,
      y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y }
  ];

  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];

    for (let j = 0; j < segments; j++) {
      const t = j / segments;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
            (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
            (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
            (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
            (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3)
      });
    }
  }
  // Add the last control point
  result.push({ ...pts[pts.length - 1] });
  return result;
}

/**
 * Draw a Catmull-Rom spline on a canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{x:number,y:number}>} controlPoints
 * @param {number} segments
 */
export function drawCatmullRom(ctx, controlPoints, segments = 16) {
  const samples = catmullRomSpline(controlPoints, segments);
  if (samples.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(samples[0].x, samples[0].y);
  for (let i = 1; i < samples.length; i++) {
    ctx.lineTo(samples[i].x, samples[i].y);
  }
  ctx.stroke();
}

export const splineTool = {
  name: 'spline',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, canvasCtx } = ctx;
    const prefs = state.preferences;

    // Right-click finishes
    if (e.button === 2) {
      _finishSpline(ctx);
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishSpline(ctx);
      return;
    }

    // Single click — add point (with snap)
    const snap = ctx.snap(x, y, null, state.splinePoints);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;
    state.splinePoints.push({ x: ptX, y: ptY });
    state.isDrawingSpline = true;
    ctx.redraw();

    // Draw in-progress spline
    if (state.splinePoints.length >= 2) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.lineStrokeColor || '#000000';
      canvasCtx.lineWidth = prefs.lineLineWidth || 1;
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';
      drawCatmullRom(canvasCtx, state.splinePoints);
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx } = ctx;
    if (!state.isDrawingSpline || state.splinePoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, null, state.splinePoints);
    const snapX = snap.snapped ? snap.x : x;
    const snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = prefs.lineStrokeColor || '#000000';
    canvasCtx.lineWidth = prefs.lineLineWidth || 1;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    // Preview: existing points + cursor position
    const previewPts = [...state.splinePoints, { x: snapX, y: snapY }];
    if (previewPts.length >= 2) {
      drawCatmullRom(canvasCtx, previewPts);
    } else {
      canvasCtx.beginPath();
      canvasCtx.moveTo(state.splinePoints[0].x, state.splinePoints[0].y);
      canvasCtx.lineTo(snapX, snapY);
      canvasCtx.stroke();
    }

    // Draw control point markers
    canvasCtx.fillStyle = prefs.lineStrokeColor || '#000000';
    for (const pt of state.splinePoints) {
      canvasCtx.beginPath();
      canvasCtx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      canvasCtx.fill();
    }

    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingSpline) {
      state.splinePoints = [];
      state.isDrawingSpline = false;
      ctx.redraw();
    }
  },
};

function _finishSpline(ctx) {
  const { state } = ctx;
  if (state.splinePoints.length >= 3) {
    const prefs = state.preferences;
    const pts = [...state.splinePoints];
    const ann = ctx.createAnnotation({
      type: 'spline',
      page: getActiveDocument()?.currentPage || 1,
      controlPoints: pts,
      color: prefs.lineStrokeColor || '#000000',
      strokeColor: prefs.lineStrokeColor || '#000000',
      lineWidth: prefs.lineLineWidth || 1,
      opacity: (prefs.lineOpacity ?? 100) / 100,
    });
    const doc = getActiveDocument();
    if (doc) {
      doc.annotations.push(ann);
      doc.selectedAnnotations = [ann];
      doc.selectedAnnotation = ann;
    }
    ctx.recordAdd(ann);
  }
  state.splinePoints = [];
  state.isDrawingSpline = false;
  ctx.redraw();
  import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
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
