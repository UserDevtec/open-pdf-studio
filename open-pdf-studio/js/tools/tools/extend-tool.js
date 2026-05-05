import { state, getActiveDocument } from '../../core/state.js';
import { lineLineIntersection } from '../../annotations/geometry.js';
import { cloneAnnotation } from '../../annotations/factory.js';
import { recordModify } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _extState = { boundary: null };

export const extendTool = {
  name: 'extend',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const clicked = ctx.findAnnotationAt(x, y);
    if (!clicked || clicked.startX === undefined) return;

    if (!_extState.boundary) {
      _extState.boundary = clicked;
      const doc = getActiveDocument();
      if (doc) { doc.selectedAnnotations = [clicked]; doc.selectedAnnotation = clicked; }
      redrawAnnotations();
      return;
    }

    const target = clicked;
    if (target === _extState.boundary) { _extState.boundary = null; return; }
    if (target.startX === undefined || target.endX === undefined) { _extState.boundary = null; return; }

    const tp1 = { x: target.startX, y: target.startY };
    const tp2 = { x: target.endX, y: target.endY };
    const bp1 = { x: _extState.boundary.startX, y: _extState.boundary.startY };
    const bp2 = { x: _extState.boundary.endX, y: _extState.boundary.endY };

    const ix = lineLineIntersection(tp1, tp2, bp1, bp2);
    if (!ix || (ix.u < -0.01 || ix.u > 1.01)) {
      _extState.boundary = null;
      return;
    }

    const oldState = cloneAnnotation(target);

    const d1 = Math.hypot(ix.x - target.startX, ix.y - target.startY);
    const d2 = Math.hypot(ix.x - target.endX, ix.y - target.endY);
    if (d1 < d2) {
      target.startX = ix.x; target.startY = ix.y;
    } else {
      target.endX = ix.x; target.endY = ix.y;
    }

    target.modifiedAt = new Date().toISOString();
    recordModify(target.id, oldState, target);
    redrawAnnotations();
    _extState.boundary = null;
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onDeactivate() { _extState.boundary = null; },
};
