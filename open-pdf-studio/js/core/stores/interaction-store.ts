import { createMutable } from 'solid-js/store';
import type { Annotation, Point } from '../../types/annotation.js';

export interface InteractionState {
  isDrawing: boolean;
  startX: number;
  startY: number;
  currentPath: Point[];
  polylinePoints: Point[];
  isDrawingPolyline: boolean;
  cloudPolylinePoints: Point[];
  isDrawingCloudPolyline: boolean;
  dimPoints: Point[];
  isDrawingDimension: boolean;
  isDragging: boolean;
  isResizing: boolean;
  activeHandle: string | null;
  dragStartX: number;
  dragStartY: number;
  originalAnnotation: Annotation | null;
  originalAnnotations: Annotation[];
  isRubberBanding: boolean;
  rubberBandStartX: number;
  rubberBandStartY: number;
  isPanning: boolean;
  isMiddleButtonPanning: boolean;
  panStartX: number;
  panStartY: number;
  panScrollStartX: number;
  panScrollStartY: number;
  activeContinuousCanvas: HTMLCanvasElement | null;
  activeContinuousPage: number | null;
}

export const interactionState = createMutable<InteractionState>({
  isDrawing: false,
  startX: 0,
  startY: 0,
  currentPath: [],
  polylinePoints: [],
  isDrawingPolyline: false,
  cloudPolylinePoints: [],
  isDrawingCloudPolyline: false,
  dimPoints: [],
  isDrawingDimension: false,
  isDragging: false,
  isResizing: false,
  activeHandle: null,
  dragStartX: 0,
  dragStartY: 0,
  originalAnnotation: null,
  originalAnnotations: [],
  isRubberBanding: false,
  rubberBandStartX: 0,
  rubberBandStartY: 0,
  isPanning: false,
  isMiddleButtonPanning: false,
  panStartX: 0,
  panStartY: 0,
  panScrollStartX: 0,
  panScrollStartY: 0,
  activeContinuousCanvas: null,
  activeContinuousPage: null,
});

export function resetDrawing(): void {
  interactionState.isDrawing = false;
  interactionState.currentPath = [];
  interactionState.polylinePoints = [];
  interactionState.isDrawingPolyline = false;
  interactionState.cloudPolylinePoints = [];
  interactionState.isDrawingCloudPolyline = false;
  interactionState.dimPoints = [];
  interactionState.isDrawingDimension = false;
}

export function resetDrag(): void {
  interactionState.isDragging = false;
  interactionState.isResizing = false;
  interactionState.activeHandle = null;
  interactionState.originalAnnotation = null;
  interactionState.originalAnnotations = [];
}

export function resetPan(): void {
  interactionState.isPanning = false;
  interactionState.isMiddleButtonPanning = false;
}

export function resetRubberBand(): void {
  interactionState.isRubberBanding = false;
}

export function resetAllInteraction(): void {
  resetDrawing();
  resetDrag();
  resetPan();
  resetRubberBand();
}
