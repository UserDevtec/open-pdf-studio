/**
 * Text tools — comment, text, stamp, signature, editText
 * These are single-click placement tools that delegate to existing modules
 */
export const commentTool = {
  name: 'comment',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    ctx.addComment(ctx.x, ctx.y);
  },
};

export const textTool = {
  name: 'text',
  cursor: 'text',

  onPointerDown(ctx) {
    const { state, pageNum, canvas } = ctx;
    if (state.viewMode === 'continuous') {
      ctx.addTextAnnotation(ctx.x, ctx.y, pageNum, canvas);
    } else {
      ctx.addTextAnnotation(ctx.x, ctx.y);
    }
  },
};

export const stampTool = {
  name: 'stamp',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    if (e && e.button === 2) return;
    const { state } = ctx;
    if (state.toolOverrides?.stampSvg || state.toolOverrides?.stampImage) {
      ctx.placeOverrideStamp(ctx.x, ctx.y);
    } else {
      ctx.showStampPicker(ctx.x, ctx.y);
    }
  },
};

export const signatureTool = {
  name: 'signature',
  cursor: 'crosshair',

  onPointerDown(ctx) {
    ctx.showSignatureDialog(ctx.x, ctx.y);
  },
};

export const editTextTool = {
  name: 'editText',
  cursor: 'text',

  onPointerDown(ctx) {
    const { x, y, pageNum, canvas } = ctx;
    const hitEdit = ctx.findTextEditAtPosition(x, y, pageNum, canvas);
    if (hitEdit) {
      ctx.startTextEditEditing(hitEdit, pageNum, canvas);
    }
  },
};
