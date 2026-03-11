import type { Annotation, AnnotationBounds } from '../../types/annotation.js';
import { state } from '../state.js';

export function clearSelection(): void {
  state.selectedAnnotation = null;
  state.selectedAnnotations = [];
}

export function addToSelection(annotation: Annotation): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  if (!doc.selectedAnnotations.includes(annotation)) {
    doc.selectedAnnotations.push(annotation);
  }
  doc.selectedAnnotation = annotation;
}

export function removeFromSelection(annotation: Annotation): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  doc.selectedAnnotations = doc.selectedAnnotations.filter(a => a !== annotation);
  doc.selectedAnnotation = doc.selectedAnnotations.length > 0
    ? doc.selectedAnnotations[doc.selectedAnnotations.length - 1]
    : null;
}

export function isSelected(annotation: Annotation): boolean {
  const doc = state.documents[state.activeDocumentIndex];
  return doc ? doc.selectedAnnotations.includes(annotation) : false;
}

export function selectAllOnPage(): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc) return;
  const pageAnnotations = doc.annotations.filter(a => a.page === doc.currentPage);
  doc.selectedAnnotations = pageAnnotations;
  doc.selectedAnnotation = pageAnnotations.length > 0 ? pageAnnotations[0] : null;
}

export function getAnnotationBounds(ann: Annotation): AnnotationBounds | null {
  switch (ann.type) {
    case 'draw':
      if (!ann.path || ann.path.length === 0) return null;
      const drawMinX = Math.min(...ann.path.map(p => p.x));
      const drawMinY = Math.min(...ann.path.map(p => p.y));
      const drawMaxX = Math.max(...ann.path.map(p => p.x));
      const drawMaxY = Math.max(...ann.path.map(p => p.y));
      return { x: drawMinX, y: drawMinY, width: drawMaxX - drawMinX, height: drawMaxY - drawMinY };
    case 'line':
    case 'arrow':
      const lx = Math.min(ann.startX!, ann.endX!);
      const ly = Math.min(ann.startY!, ann.endY!);
      return { x: lx, y: ly, width: Math.abs(ann.endX! - ann.startX!), height: Math.abs(ann.endY! - ann.startY!) };
    case 'polyline':
    case 'cloudPolyline':
    case 'measureArea':
    case 'measurePerimeter':
      if (!ann.points || ann.points.length === 0) return null;
      const plMinX = Math.min(...ann.points.map(p => p.x));
      const plMinY = Math.min(...ann.points.map(p => p.y));
      const plMaxX = Math.max(...ann.points.map(p => p.x));
      const plMaxY = Math.max(...ann.points.map(p => p.y));
      return { x: plMinX, y: plMinY, width: plMaxX - plMinX, height: plMaxY - plMinY };
    case 'measureDistance': {
      const mdXs = [ann.startX!, ann.endX!];
      const mdYs = [ann.startY!, ann.endY!];
      if ((ann as any).leaderStartX !== undefined) {
        mdXs.push((ann as any).leaderStartX, (ann as any).leaderEndX);
        mdYs.push((ann as any).leaderStartY, (ann as any).leaderEndY);
      }
      const mdlx = Math.min(...mdXs);
      const mdly = Math.min(...mdYs);
      return { x: mdlx, y: mdly, width: Math.max(...mdXs) - mdlx, height: Math.max(...mdYs) - mdly };
    }
    case 'text':
      return { x: ann.x!, y: ann.y! - (ann.fontSize || 16), width: 100, height: ann.fontSize || 16 };
    case 'comment':
      return { x: ann.x!, y: ann.y!, width: ann.width || 24, height: ann.height || 24 };
    case 'box':
    case 'circle':
    case 'highlight':
    case 'polygon':
    case 'cloud':
    case 'textbox':
    case 'callout':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
      return { x: ann.x!, y: ann.y!, width: ann.width!, height: ann.height! };
    case 'textHighlight':
    case 'textStrikethrough':
    case 'textUnderline':
      return { x: ann.x!, y: ann.y!, width: ann.width!, height: ann.height! };
    default:
      if (ann.x !== undefined && ann.width !== undefined) {
        return { x: ann.x, y: ann.y!, width: ann.width || 150, height: ann.height || 50 };
      }
      return null;
  }
}

export function getSelectionBounds(): AnnotationBounds | null {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || doc.selectedAnnotations.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const ann of doc.selectedAnnotations) {
    const bounds = getAnnotationBounds(ann);
    if (!bounds) continue;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  if (minX === Infinity) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
