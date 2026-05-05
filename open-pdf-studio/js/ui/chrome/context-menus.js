import { state, getActiveDocument, isSelected } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { setTool } from '../../tools/manager.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  showAnnotationMenu, showMultiAnnotationMenu, showPageMenu,
  showTextSelectionMenu, hideMenu,
} from '../../bridge.js';

export function showContextMenu(e, annotation, vertex = null) {
  e.preventDefault();
  const _cmDoc = getActiveDocument();
  const _cmSel = _cmDoc ? _cmDoc.selectedAnnotations : [];
  const isMultiSelect = _cmSel.length > 1 && isSelected(annotation);
  if (isMultiSelect) {
    showMultiAnnotationMenu(e.clientX, e.clientY, _cmSel.length);
  } else {
    showAnnotationMenu(e.clientX, e.clientY, annotation, vertex);
  }
}

export function showPageContextMenu(e) {
  e.preventDefault();
  showPageMenu(e.clientX, e.clientY);
}

export function showTextSelectionContextMenu(e) {
  e.preventDefault();
  showTextSelectionMenu(e.clientX, e.clientY);
}

export function hideContextMenu() {
  hideMenu();
}

export function initContextMenus() {
  document.addEventListener('contextmenu', (e) => {
    const nonDrawTools = ['select', 'hand'];
    // Check if any multi-click tool is in progress
    const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
      state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1) ||
      state.addHoleTargetId;
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !isMultiClickActive) {
      e.preventDefault();
      e.stopPropagation();
      setTool('hand');
    }
  }, true);

  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!getActiveDocument()?.pdfDoc) return;

      // Let tool handle its own right-click behavior (polyline finish, measurement finish, etc.)
      // These are handled via the pointerdown handler with e.button === 2
      const isMultiClickActive = state.isDrawingPolyline || state.isDrawingCloudPolyline ||
        state.isDrawingDimension || (state.measurePoints && state.measurePoints.length >= 1) ||
        state.addHoleTargetId;
      if (isMultiClickActive) {
        e.preventDefault();
        return;
      }
      // Tool just finished via right-click (polyline sluit-operatie). Slik
      // dit ene contextmenu-event in zodat de gebruiker niet onmiddellijk
      // het selectie-menu krijgt nadat hij de scheur/polygoon afsloot.
      // Volgende rechtermuisklik werkt weer normaal.
      if (state._suppressNextContextmenu) {
        state._suppressNextContextmenu = false;
        e.preventDefault();
        return;
      }

      const rect = annotationCanvas.getBoundingClientRect();
      const doc = getActiveDocument();
      const scale = doc?.scale || 1.5;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      import('../../annotations/geometry.js').then(async ({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        // In edit-contour mode, detect right-click on a vertex/edge handle so the
        // context menu can offer vertex-specific actions.
        let vertex = null;
        const editingId = state.editingContour;
        if (editingId) {
          const _doc2 = getActiveDocument();
          const editAnn = (_doc2?.annotations || []).find(a => a.id === editingId);
          if (editAnn) {
            const { findHandleAt } = await import('../../annotations/handles.js');
            const handleType = findHandleAt(x, y, editAnn, scale);
            if (typeof handleType === 'string') {
              const holeNode = handleType.match(/^polyline_node_hole_(\d+)_(\d+)$/);
              const polyNode = handleType.match(/^polyline_node_(\d+)$/);
              const holeEdge = handleType.match(/^polyline_edge_hole_(\d+)_(\d+)$/);
              const polyEdge = handleType.match(/^polyline_edge_(\d+)$/);
              if (holeNode) vertex = { kind: 'vertex', holeIndex: +holeNode[1], nodeIndex: +holeNode[2], annotationId: editingId };
              else if (polyNode) vertex = { kind: 'vertex', holeIndex: null, nodeIndex: +polyNode[1], annotationId: editingId };
              else if (holeEdge) vertex = { kind: 'edge', holeIndex: +holeEdge[1], edgeIndex: +holeEdge[2], annotationId: editingId };
              else if (polyEdge) vertex = { kind: 'edge', holeIndex: null, edgeIndex: +polyEdge[1], annotationId: editingId };
              if (vertex) {
                showContextMenu(e, editAnn, vertex);
                return;
              }
            }
          }
        }
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
