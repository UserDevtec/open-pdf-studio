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
    if (typeHandler && typeHandler.create) {
      // Enrich state with current page dimensions in PDF points so plugins do
      // not have to derive these from ctx.canvas (which carries DPR + zoom
      // and is unreliable across "Nieuw" vs loaded-PDF flows).
      const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
      const docScale = doc?.scale || 1;
      const canvasEl = doc?.canvasEl || null;
      let pageWidth, pageHeight;
      if (canvasEl) {
        pageWidth = canvasEl.width / (docScale * dpr);
        pageHeight = canvasEl.height / (docScale * dpr);
      }
      const enrichedState = {
        ...state,
        docScale,
        devicePixelRatio: dpr,
        pageWidth,
        pageHeight,
        currentPage: doc?.currentPage || 1,
      };
      const annProps = typeHandler.create(x, y, x, y, e, enrichedState);
      if (annProps) {
        const ann = ctx.createAnnotation({ ...annProps, page: doc?.currentPage || 1, ...state.toolOverrides });
        if (doc) doc.annotations.push(ann);
        ctx.recordAdd(ann);
        ctx.redraw();
      }
    }
  },
};
