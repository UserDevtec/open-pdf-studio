import { getActiveDocument } from '../../core/state.js';
import { applyToolTransform, getEffectiveScale } from '../tool-context.js';
import { getAnnotationType } from '../../plugins/annotation-type-registry.js';

/**
 * Polyline tool — multi-click placement, double-click/right-click to finish
 * Also handles cloudPolyline
 */
export const polylineTool = {
  name: 'polyline',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    const prefs = state.preferences;

    // Right-click finishes
    if (e.button === 2) {
      _finishPolyline(ctx);
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishPolyline(ctx);
      return;
    }

    // Single click — add point (with snap)
    const snap = ctx.snap(x, y, null, state.polylinePoints);
    let ptX = snap.snapped ? snap.x : x;
    let ptY = snap.snapped ? snap.y : y;

    // Plugin shift-snap: when shift held + handler exposes snapHook, snap to last vertex.
    if (e?.shiftKey && state.polylinePoints.length > 0) {
      const handler = getAnnotationType(state.currentTool);
      if (handler && typeof handler.snapHook === 'function') {
        const last = state.polylinePoints[state.polylinePoints.length - 1];
        const snapped = handler.snapHook(last.x, last.y, ptX, ptY);
        ptX = snapped.x;
        ptY = snapped.y;
      }
    }

    state.polylinePoints.push({ x: ptX, y: ptY });
    state.isDrawingPolyline = true;
    ctx.redraw();

    // Draw in-progress polyline
    if (state.polylinePoints.length > 0) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.polylineStrokeColor;
      canvasCtx.lineWidth = prefs.polylineLineWidth;
      canvasCtx.lineCap = 'round';
      canvasCtx.lineJoin = 'round';
      canvasCtx.beginPath();
      state.polylinePoints.forEach((point, index) => {
        if (index === 0) canvasCtx.moveTo(point.x, point.y);
        else canvasCtx.lineTo(point.x, point.y);
      });
      canvasCtx.stroke();
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!state.isDrawingPolyline || state.polylinePoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, null, state.polylinePoints);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    state.lastSnapResult = snap.snapped ? snap : null;

    // Plugin shift-snap preview: reflect snapped position before commit so user sees angle feedback.
    if (e?.shiftKey && state.polylinePoints.length > 0) {
      const handler = getAnnotationType(state.currentTool);
      if (handler && typeof handler.snapHook === 'function') {
        const last = state.polylinePoints[state.polylinePoints.length - 1];
        const snapped = handler.snapHook(last.x, last.y, snapX, snapY);
        snapX = snapped.x;
        snapY = snapped.y;
      }
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = prefs.polylineStrokeColor;
    canvasCtx.lineWidth = prefs.polylineLineWidth;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';
    canvasCtx.beginPath();
    state.polylinePoints.forEach((point, index) => {
      if (index === 0) canvasCtx.moveTo(point.x, point.y);
      else canvasCtx.lineTo(point.x, point.y);
    });
    canvasCtx.lineTo(snapX, snapY);
    canvasCtx.stroke();
    canvasCtx.restore();
    if (snap.snapped) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingPolyline) {
      state.polylinePoints = [];
      state.isDrawingPolyline = false;
      ctx.redraw();
    }
  },
};

export const cloudPolylineTool = {
  name: 'cloudPolyline',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    const prefs = state.preferences;

    // Right-click finishes
    if (e.button === 2) {
      _finishCloudPolyline(ctx);
      return;
    }

    // Double-click finishes
    if (e.detail === 2) {
      _finishCloudPolyline(ctx);
      return;
    }

    // Single click — add point (with snap)
    const snap = ctx.snap(x, y, null, state.cloudPolylinePoints);
    const ptX = snap.snapped ? snap.x : x;
    const ptY = snap.snapped ? snap.y : y;

    // Close shape when clicking near the first point
    if (state.cloudPolylinePoints.length >= 3) {
      const first = state.cloudPolylinePoints[0];
      const dx = ptX - first.x;
      const dy = ptY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        _createCloudPolylineAnnotation(ctx, state.cloudPolylinePoints);
        state.cloudPolylinePoints = [];
        state.isDrawingCloudPolyline = false;
        ctx.redraw();
        // Auto-reset to select tool
        import('../../tools/manager.js').then(m => m.setTool('select'));
        return;
      }
    }

    state.cloudPolylinePoints.push({ x: ptX, y: ptY });
    state.isDrawingCloudPolyline = true;
    ctx.redraw();

    // Draw in-progress cloud polyline
    if (state.cloudPolylinePoints.length > 1) {
      canvasCtx.save();
      applyToolTransform(canvasCtx);
      canvasCtx.strokeStyle = prefs.cloudPolylineStrokeColor;
      canvasCtx.lineWidth = prefs.cloudPolylineLineWidth;
      ctx.buildCloudPolylinePath(canvasCtx, state.cloudPolylinePoints, false);
      canvasCtx.stroke();
      canvasCtx.restore();
    }
  },

  onPointerMove(ctx, e) {
    const { x, y, state, canvasCtx, scale } = ctx;
    if (!state.isDrawingCloudPolyline || state.cloudPolylinePoints.length === 0) {
      _drawHoverSnap(ctx, x, y);
      return;
    }

    const prefs = state.preferences;
    const snap = ctx.snap(x, y, null, state.cloudPolylinePoints);
    let snapX = snap.snapped ? snap.x : x;
    let snapY = snap.snapped ? snap.y : y;
    let nearFirst = false;
    state.lastSnapResult = snap.snapped ? snap : null;

    // Snap to first point when near it (close shape hint)
    if (state.cloudPolylinePoints.length >= 3) {
      const first = state.cloudPolylinePoints[0];
      const dx = snapX - first.x;
      const dy = snapY - first.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10 / scale) {
        snapX = first.x;
        snapY = first.y;
        nearFirst = true;
      }
    }

    ctx.redraw();
    canvasCtx.save();
    applyToolTransform(canvasCtx);
    canvasCtx.strokeStyle = prefs.cloudPolylineStrokeColor;
    canvasCtx.lineWidth = prefs.cloudPolylineLineWidth;
    const previewPts = [...state.cloudPolylinePoints, { x: snapX, y: snapY }];
    ctx.buildCloudPolylinePath(canvasCtx, previewPts, nearFirst);
    canvasCtx.stroke();

    if (nearFirst) {
      const first = state.cloudPolylinePoints[0];
      canvasCtx.beginPath();
      canvasCtx.arc(first.x, first.y, 5 / scale, 0, Math.PI * 2);
      canvasCtx.fillStyle = prefs.cloudPolylineStrokeColor;
      canvasCtx.globalAlpha = 0.3;
      canvasCtx.fill();
      canvasCtx.globalAlpha = 1;
    }

    canvasCtx.restore();
    if (snap.snapped && !nearFirst) {
      ctx.drawSnapIndicator(snap);
    }
  },

  onDeactivate(ctx) {
    const { state } = ctx;
    if (state.isDrawingCloudPolyline) {
      state.cloudPolylinePoints = [];
      state.isDrawingCloudPolyline = false;
      ctx.redraw();
    }
  },
};

// Shared helpers
function _finishPolyline(ctx) {
  const { state } = ctx;
  if (state.polylinePoints.length >= 2) {
    const prefs = state.preferences;
    const doc = getActiveDocument();

    // Plugin polyline-flow: if active tool is a plugin-handler with drawMode='polyline',
    // delegate annotation-creation to typeHandler.create() with the collected points.
    // This lets plugins emit custom annotation-types (e.g. symitech.scheur, symitech.vloer-contour)
    // instead of always producing a generic 'polyline' annotation.
    const typeHandler = getAnnotationType(state.currentTool);
    if (typeHandler && typeHandler.drawMode === 'polyline' && typeof typeHandler.create === 'function') {
      const currentPage = doc?.currentPage || 1;
      const dims = doc?.pageDims?.[currentPage];
      const enrichedState = {
        ...state,
        polylinePoints: [...state.polylinePoints],
        docScale: doc?.scale || 1,
        devicePixelRatio: window.devicePixelRatio || 1,
        pageWidth: dims?.widthPt,
        pageHeight: dims?.heightPt,
        currentPage,
      };
      const annProps = typeHandler.create(0, 0, 0, 0, null, enrichedState);
      if (annProps) {
        const ann = ctx.createAnnotation({
          ...annProps,
          page: currentPage,
          ...state.toolOverrides,
        });
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
      }
    } else {
      // Default: generic polyline annotation (legacy behavior)
      const ann = ctx.createAnnotation({
        type: 'polyline',
        page: doc?.currentPage || 1,
        points: [...state.polylinePoints],
        color: prefs.polylineStrokeColor,
        strokeColor: prefs.polylineStrokeColor,
        lineWidth: prefs.polylineLineWidth,
        opacity: (prefs.polylineOpacity || 100) / 100
      });
      if (doc) doc.annotations.push(ann);
      ctx.recordAdd(ann);
    }
  }
  state.polylinePoints = [];
  state.isDrawingPolyline = false;
  ctx.redraw();

  // Auto-reset to select tool
  import('../../tools/manager.js').then(m => m.setTool('select'));
}

function _finishCloudPolyline(ctx) {
  const { state } = ctx;
  if (state.cloudPolylinePoints.length >= 3) {
    _createCloudPolylineAnnotation(ctx, state.cloudPolylinePoints);
  }
  state.cloudPolylinePoints = [];
  state.isDrawingCloudPolyline = false;
  ctx.redraw();

  // Auto-reset to select tool
  import('../../tools/manager.js').then(m => m.setTool('select'));
}

function _createCloudPolylineAnnotation(ctx, points) {
  const { state } = ctx;
  const prefs = state.preferences;
  const pts = [...points];
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const ann = ctx.createAnnotation({
    type: 'cloudPolyline',
    page: getActiveDocument()?.currentPage || 1,
    points: pts,
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    color: prefs.cloudPolylineStrokeColor,
    strokeColor: prefs.cloudPolylineStrokeColor,
    lineWidth: prefs.cloudPolylineLineWidth,
    opacity: (prefs.cloudPolylineOpacity || 100) / 100
  });
  const doc = getActiveDocument();
  if (doc) doc.annotations.push(ann);
  ctx.recordAdd(ann);
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
