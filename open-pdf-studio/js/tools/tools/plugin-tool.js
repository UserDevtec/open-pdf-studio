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
    // DPR + zoom). doc.pageDims is populated by createBlankPDF and renderPage
    // from page.view (the canonical PDF MediaBox), and stays consistent with
    // the actual rendered page regardless of zoom or pan.
    const currentPage = doc?.currentPage || 1;
    const dims = doc?.pageDims?.[currentPage];
    if (!dims) {
      console.warn(`[plugin-tool] doc.pageDims[${currentPage}] missing; aborting plugin click`);
      return;
    }
    const enrichedState = {
      ...state,
      docScale: doc?.scale || 1,
      devicePixelRatio: window.devicePixelRatio || 1,
      pageWidth: dims.widthPt,
      pageHeight: dims.heightPt,
      currentPage,
    };
    const annProps = typeHandler.create(x, y, x, y, e, enrichedState);
    if (!annProps) return;
    const ann = ctx.createAnnotation({ ...annProps, page: doc?.currentPage || 1, ...state.toolOverrides });
    if (doc) doc.annotations.push(ann);
    ctx.recordAdd(ann);
    ctx.redraw();
  },
};
