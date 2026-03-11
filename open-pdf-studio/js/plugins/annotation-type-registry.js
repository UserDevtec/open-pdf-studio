/**
 * Annotation Type Registry
 *
 * Plugins register custom annotation types here. The host app falls back to
 * this registry when it encounters an unknown type in rendering, creation,
 * hit-testing, or shape preview.
 *
 * Handler shape:
 *   {
 *     create(startX, startY, endX, endY, e, state) => annotationProps | null,
 *     render(ctx, annotation) => void,
 *     preview(ctx, startX, startY, currentX, currentY, state, e) => void,
 *     hitTest(x, y, annotation, tolerance) => boolean,
 *     getBounds(annotation) => { x, y, width, height } | null,
 *     drawMode: 'drag' | 'click' | 'polyline',
 *     cursor: string   // CSS cursor, default 'crosshair'
 *   }
 */

const registry = new Map();

export function registerAnnotationType(typeName, handler) {
  if (registry.has(typeName)) {
    console.warn(`[plugin] Annotation type "${typeName}" is already registered. Overwriting.`);
  }
  registry.set(typeName, {
    drawMode: 'drag',
    cursor: 'crosshair',
    ...handler
  });
}

export function unregisterAnnotationType(typeName) {
  registry.delete(typeName);
}

export function getAnnotationType(typeName) {
  return registry.get(typeName);
}

export function hasAnnotationType(typeName) {
  return registry.has(typeName);
}

export function getAllAnnotationTypes() {
  return [...registry.keys()];
}
