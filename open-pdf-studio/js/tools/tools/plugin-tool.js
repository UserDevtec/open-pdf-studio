import { getActiveDocument } from '../../core/state.js';

/**
 * Plugin tool — wraps annotation-type-registry handlers
 * Handles 'click' drawMode plugins; 'drag' plugins use shape-tool behavior
 */
export const pluginClickTool = {
  name: 'plugin-click',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const { x, y, state } = ctx;
    const doc = getActiveDocument();
    const typeHandler = ctx.getAnnotationType(state.currentTool);
    if (!typeHandler || !typeHandler.create) return;
    // Enrich state with the current page dimensions in PDF points so plugin
    // handlers don't need to derive them from canvas geometry (which mixes
    // DPR + zoom). pdf-viewport.js (a singleton on window.__pdfViewport) is
    // the canonical source for pageW, pageH, and zoom.
    const vp = window.__pdfViewport;
    if (!vp) {
      console.warn('[plugin-tool] window.__pdfViewport not initialized; aborting plugin click');
      return;
    }
    const enrichedState = {
      ...state,
      docScale: vp.zoom,
      devicePixelRatio: window.devicePixelRatio || 1,
      pageWidth: vp.pageW,
      pageHeight: vp.pageH,
      currentPage: doc?.currentPage || 1,
    };
    const annProps = typeHandler.create(x, y, x, y, e, enrichedState);
    if (!annProps) return;
    const ann = ctx.createAnnotation({ ...annProps, page: doc?.currentPage || 1, ...state.toolOverrides });
    if (doc) doc.annotations.push(ann);
    ctx.recordAdd(ann);
    ctx.redraw();
  },
};
