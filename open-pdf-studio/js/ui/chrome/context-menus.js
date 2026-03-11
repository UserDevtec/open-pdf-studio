import { state, isSelected } from '../../core/state.js';
import { annotationCanvas } from '../dom-elements.js';
import { setTool } from '../../tools/manager.js';
import { recordAdd } from '../../core/undo-manager.js';
import {
  showAnnotationMenu, showMultiAnnotationMenu, showPageMenu,
  showTextSelectionMenu, hideMenu,
} from '../../bridge.js';

export function showContextMenu(e, annotation) {
  e.preventDefault();
  const isMultiSelect = state.selectedAnnotations.length > 1 && isSelected(annotation);
  if (isMultiSelect) {
    showMultiAnnotationMenu(e.clientX, e.clientY, state.selectedAnnotations.length);
  } else {
    showAnnotationMenu(e.clientX, e.clientY, annotation);
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
    if (!nonDrawTools.includes(state.currentTool) && !state.isDrawing && !state.isDrawingPolyline && !state.isDrawingCloudPolyline && !(state.measurePoints && state.measurePoints.length >= 1)) {
      e.preventDefault();
      e.stopPropagation();
      setTool('hand');
    }
  }, true);

  if (annotationCanvas) {
    annotationCanvas.addEventListener('contextmenu', (e) => {
      if (!state.pdfDoc) return;

      if ((state.currentTool === 'measureArea' || state.currentTool === 'measurePerimeter') && state.measurePoints && state.measurePoints.length >= 1) {
        e.preventDefault();
        const canFinalize = (state.currentTool === 'measureArea' && state.measurePoints.length >= 3) ||
                            (state.currentTool === 'measurePerimeter' && state.measurePoints.length >= 2);
        if (canFinalize) {
          import('../../tools/annotation-creators.js').then(({ createMeasureAreaAnnotation, createMeasurePerimeterAnnotation }) => {
            const points = [...state.measurePoints];
            let ann;
            if (state.currentTool === 'measureArea') {
              ann = createMeasureAreaAnnotation(points);
            } else {
              ann = createMeasurePerimeterAnnotation(points);
            }
            if (ann) {
              state.annotations.push(ann);
              recordAdd(ann);
            }
            state.measurePoints = null;
            import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
              redrawAnnotations();
            });
          });
        } else {
          // Not enough points to finalize — cancel the drawing
          state.measurePoints = null;
          import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
            redrawAnnotations();
          });
        }
        return;
      }

      if (state.currentTool === 'polyline' && state.isDrawingPolyline) {
        e.preventDefault();
        import('../../annotations/factory.js').then(({ createAnnotation }) => {
          if (state.polylinePoints.length >= 2) {
            const pPrefs = state.preferences;
            const ann = createAnnotation({
              type: 'polyline',
              page: state.currentPage,
              points: [...state.polylinePoints],
              color: pPrefs.polylineStrokeColor,
              strokeColor: pPrefs.polylineStrokeColor,
              lineWidth: pPrefs.polylineLineWidth,
              opacity: (pPrefs.polylineOpacity || 100) / 100
            });
            state.annotations.push(ann);
            recordAdd(ann);
          }
          state.polylinePoints = [];
          state.isDrawingPolyline = false;
          import('../../annotations/rendering.js').then(({ redrawAnnotations }) => {
            redrawAnnotations();
          });
        });
        return;
      }

      const rect = annotationCanvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / state.scale;
      const y = (e.clientY - rect.top) / state.scale;

      import('../../annotations/geometry.js').then(({ findAnnotationAt }) => {
        const annotation = findAnnotationAt(x, y);
        if (annotation) {
          showContextMenu(e, annotation);
        } else {
          showPageContextMenu(e);
        }
      });
    });
  }
}
