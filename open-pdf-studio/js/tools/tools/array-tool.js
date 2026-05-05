import { state, getActiveDocument } from '../../core/state.js';
import { recordAdd } from '../../core/undo-manager.js';
import { redrawAnnotations } from '../../annotations/rendering.js';

const _arrayState = { basePoint: null, count: 3, mode: 'linear' };

export const arrayTool = {
  name: 'array',
  cursor: 'crosshair',

  onPointerDown(ctx, e) {
    const { x, y } = ctx;
    const doc = getActiveDocument();
    if (!doc) return;
    const selected = doc.selectedAnnotations;
    if (!selected || selected.length === 0) return;

    if (!_arrayState.basePoint) {
      _arrayState.basePoint = { x, y };
      return;
    }

    const base = _arrayState.basePoint;
    const dx = x - base.x;
    const dy = y - base.y;
    const count = _arrayState.count;
    if (count < 2 || Math.hypot(dx, dy) < 0.5) {
      _arrayState.basePoint = null;
      return;
    }

    for (const srcAnn of selected) {
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const offsetX = dx * frac;
        const offsetY = dy * frac;
        const copy = JSON.parse(JSON.stringify(srcAnn));
        copy.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '_' + i;
        copy.createdAt = new Date().toISOString();
        copy.modifiedAt = new Date().toISOString();

        if (copy.startX !== undefined) { copy.startX += offsetX; copy.startY += offsetY; }
        if (copy.endX !== undefined) { copy.endX += offsetX; copy.endY += offsetY; }
        if (copy.x !== undefined) { copy.x += offsetX; copy.y += offsetY; }
        if (copy.centerX !== undefined) { copy.centerX += offsetX; copy.centerY += offsetY; }
        if (copy.points) {
          copy.points = copy.points.map(p => ({ ...p, x: p.x + offsetX, y: p.y + offsetY }));
        }
        if (copy.leaderStartX !== undefined) { copy.leaderStartX += offsetX; copy.leaderStartY += offsetY; }
        if (copy.leaderEndX !== undefined) { copy.leaderEndX += offsetX; copy.leaderEndY += offsetY; }
        if (copy.vertices) {
          copy.vertices = copy.vertices.map(v => ({ ...v, x: v.x + offsetX, y: v.y + offsetY }));
        }

        doc.annotations.push(copy);
        recordAdd(copy);
      }
    }

    redrawAnnotations();
    _arrayState.basePoint = null;
    import("../../tools/manager.js").then(m => m.maybeRevertToSelect && m.maybeRevertToSelect());
  },

  onPointerMove(ctx, e) {
    if (_arrayState.basePoint) {
      redrawAnnotations();
      const { x, y, canvas } = ctx;
      const doc = getActiveDocument();
      const scale = doc?.scale || 1.5;
      const c = canvas.getContext('2d');
      const base = _arrayState.basePoint;

      c.save();
      c.setLineDash([4, 4]);
      c.strokeStyle = '#0066FF';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(base.x * scale, base.y * scale);
      c.lineTo(x * scale, y * scale);
      c.stroke();

      const count = _arrayState.count;
      const ddx = x - base.x;
      const ddy = y - base.y;
      for (let i = 1; i < count; i++) {
        const frac = i / (count - 1 || 1);
        const px = (base.x + ddx * frac) * scale;
        const py = (base.y + ddy * frac) * scale;
        c.beginPath();
        c.arc(px, py, 3, 0, Math.PI * 2);
        c.fillStyle = '#0066FF';
        c.fill();
      }
      c.restore();
    }
  },

  onDeactivate() { _arrayState.basePoint = null; },
};

export function setArrayCount(n) { _arrayState.count = Math.max(2, Math.min(50, n)); }
export function setArrayMode(m) { _arrayState.mode = m; }
export function getArrayState() { return { count: _arrayState.count, mode: _arrayState.mode }; }
