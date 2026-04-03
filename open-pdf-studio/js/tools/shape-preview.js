import { state, getActiveDocument } from '../core/state.js';
import { annotationCtx } from '../ui/dom-elements.js';
import { redrawAnnotations, drawAnnotation } from '../annotations/rendering.js';
import { drawSnapIndicator } from './snap-engine.js';
import { buildAnnotationProps } from './annotation-creators.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';

/**
 * Draw a live preview of the shape being created.
 *
 * Uses the same buildAnnotationProps() + drawAnnotation() pipeline as
 * final annotation creation and rendering. This guarantees the preview
 * looks identical to the final result (line widths, arrowhead styles,
 * hatch patterns, border styles, etc.).
 */
export function drawShapePreview(currentX, currentY, e) {
  redrawAnnotations();
  const doc = getActiveDocument();
  const vp = window.__pdfViewport;
  annotationCtx.save();
  if (vp && vp.active) {
    // Vector viewport: use same transform as annotation rendering
    annotationCtx.setTransform(vp.zoom, 0, 0, vp.zoom, vp.offsetX, vp.offsetY);
  } else {
    // Legacy mode
    const scale = doc?.scale || 1.5;
    annotationCtx.scale(scale, scale);
  }

  const tool = state.currentTool;

  // Build a temporary annotation from current tool + coordinates
  const tempAnn = buildAnnotationProps(tool, state.startX, state.startY, currentX, currentY, e);

  if (tempAnn) {
    drawAnnotation(annotationCtx, tempAnn);
  } else {
    // Fallback: plugin types with custom preview
    const typeHandler = getAnnotationType(tool);
    if (typeHandler && typeHandler.preview) {
      typeHandler.preview(annotationCtx, state.startX, state.startY, currentX, currentY, state, e);
    }
  }

  // Draw snap indicator overlay
  if (state.lastSnapResult && state.lastSnapResult.snapped) {
    const snapScale = (vp && vp.active) ? vp.zoom : (doc?.scale || 1.5);
    drawSnapIndicator(annotationCtx, state.lastSnapResult, snapScale);
  }

  annotationCtx.restore();
}
