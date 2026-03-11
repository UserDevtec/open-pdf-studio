import { createMutable } from 'solid-js/store';
import { DEFAULT_PREFERENCES } from './constants.js';
import { interactionState } from './stores/interaction-store.js';
import { clipboardState } from './stores/clipboard-store.js';
import { editingState } from './stores/editing-store.js';
import type { Annotation, Point } from '../types/annotation.js';
import type { DocumentState, MeasureScale } from '../types/document.js';
import type { Preferences } from '../types/preferences.js';

// Re-export focused stores for new code
export { interactionState } from './stores/interaction-store.js';
export type { InteractionState } from './stores/interaction-store.js';
export { clipboardState } from './stores/clipboard-store.js';
export type { ClipboardState } from './stores/clipboard-store.js';
export { editingState } from './stores/editing-store.js';
export type { EditingState } from './stores/editing-store.js';
export { resetDrawing, resetDrag, resetPan, resetRubberBand, resetAllInteraction } from './stores/interaction-store.js';
export { clearClipboard } from './stores/clipboard-store.js';
export { resetTextEditing, resetPdfTextEditing, resetAllEditing } from './stores/editing-store.js';

// Re-export document helpers (pure functions, no state dependency)
export { createDocument, getNextUntitledName } from './stores/document-helpers.js';

// Re-export selection helpers (operate on state, extracted for modularity)
export { clearSelection, addToSelection, removeFromSelection, isSelected, selectAllOnPage, getAnnotationBounds, getSelectionBounds } from './stores/selection-helpers.js';

// Re-export types for consumers
export type { Annotation, AnnotationBounds, AnnotationType, Point } from '../types/annotation.js';
export type { DocumentState, MeasureScale } from '../types/document.js';
export type { Preferences } from '../types/preferences.js';

export interface TextSelection {
  hasSelection: boolean;
  selectedText: string;
  pageNum: number | null;
}

export interface SearchState {
  isOpen: boolean;
  query: string;
  results: any[];
  currentIndex: number;
  totalMatches: number;
  matchCase: boolean;
  wholeWord: boolean;
  highlightAll: boolean;
  isSearching: boolean;
}

export interface AppState {
  documents: DocumentState[];
  activeDocumentIndex: number;
  currentTool: string;
  toolOverrides: Record<string, any> | null;
  imageCache: Map<string, any>;
  modalDialogOpen: boolean;
  appMenuOpen: boolean;
  preferences: Preferences;
  defaultAuthor: string;
  shiftKeyPressed: boolean;
  statusMessage: string;
  statusMessageVisible: boolean;
  textSelection: TextSelection;
  search: SearchState;

  // Backward compat — interaction-store
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

  // Backward compat — clipboard-store
  clipboardAnnotation: Annotation | null;
  clipboardAnnotations: Annotation[];

  // Backward compat — editing-store
  isEditingText: boolean;
  editingAnnotation: Annotation | null;
  textEditElement: HTMLElement | null;
  isEditingPdfText: boolean;
  pdfTextEditState: any;

  // Document delegation
  pdfDoc: any;
  currentPage: number;
  scale: number;
  viewMode: 'single' | 'continuous';
  currentPdfPath: string | null;
  annotations: Annotation[];
  textEdits: any[];
  watermarks: any[];
  bookmarks: any[];
  redoStack: any[];
  pageRotations: Record<number, number>;
  selectedAnnotation: Annotation | null;
  measureScale: MeasureScale | null;
  selectedAnnotations: Annotation[];
}

export const state = createMutable<AppState>({
  documents: [],
  activeDocumentIndex: -1,
  currentTool: 'hand',
  toolOverrides: null,
  imageCache: new Map(),
  modalDialogOpen: false,
  appMenuOpen: false,
  preferences: { ...DEFAULT_PREFERENCES },
  defaultAuthor: 'User',
  shiftKeyPressed: false,
  statusMessage: 'Ready',
  statusMessageVisible: true,
  textSelection: {
    hasSelection: false,
    selectedText: '',
    pageNum: null
  },
  search: {
    isOpen: false,
    query: '',
    results: [],
    currentIndex: -1,
    totalMatches: 0,
    matchCase: false,
    wholeWord: false,
    highlightAll: true,
    isSearching: false
  },

  // Backward compat — interaction-store
  get isDrawing() { return interactionState.isDrawing; },
  set isDrawing(v) { interactionState.isDrawing = v; },
  get startX() { return interactionState.startX; },
  set startX(v) { interactionState.startX = v; },
  get startY() { return interactionState.startY; },
  set startY(v) { interactionState.startY = v; },
  get currentPath() { return interactionState.currentPath; },
  set currentPath(v) { interactionState.currentPath = v; },
  get polylinePoints() { return interactionState.polylinePoints; },
  set polylinePoints(v) { interactionState.polylinePoints = v; },
  get isDrawingPolyline() { return interactionState.isDrawingPolyline; },
  set isDrawingPolyline(v) { interactionState.isDrawingPolyline = v; },
  get cloudPolylinePoints() { return interactionState.cloudPolylinePoints; },
  set cloudPolylinePoints(v) { interactionState.cloudPolylinePoints = v; },
  get isDrawingCloudPolyline() { return interactionState.isDrawingCloudPolyline; },
  set isDrawingCloudPolyline(v) { interactionState.isDrawingCloudPolyline = v; },
  get dimPoints() { return interactionState.dimPoints; },
  set dimPoints(v) { interactionState.dimPoints = v; },
  get isDrawingDimension() { return interactionState.isDrawingDimension; },
  set isDrawingDimension(v) { interactionState.isDrawingDimension = v; },
  get isDragging() { return interactionState.isDragging; },
  set isDragging(v) { interactionState.isDragging = v; },
  get isResizing() { return interactionState.isResizing; },
  set isResizing(v) { interactionState.isResizing = v; },
  get activeHandle() { return interactionState.activeHandle; },
  set activeHandle(v) { interactionState.activeHandle = v; },
  get dragStartX() { return interactionState.dragStartX; },
  set dragStartX(v) { interactionState.dragStartX = v; },
  get dragStartY() { return interactionState.dragStartY; },
  set dragStartY(v) { interactionState.dragStartY = v; },
  get originalAnnotation() { return interactionState.originalAnnotation; },
  set originalAnnotation(v) { interactionState.originalAnnotation = v; },
  get originalAnnotations() { return interactionState.originalAnnotations; },
  set originalAnnotations(v) { interactionState.originalAnnotations = v; },
  get isRubberBanding() { return interactionState.isRubberBanding; },
  set isRubberBanding(v) { interactionState.isRubberBanding = v; },
  get rubberBandStartX() { return interactionState.rubberBandStartX; },
  set rubberBandStartX(v) { interactionState.rubberBandStartX = v; },
  get rubberBandStartY() { return interactionState.rubberBandStartY; },
  set rubberBandStartY(v) { interactionState.rubberBandStartY = v; },
  get isPanning() { return interactionState.isPanning; },
  set isPanning(v) { interactionState.isPanning = v; },
  get isMiddleButtonPanning() { return interactionState.isMiddleButtonPanning; },
  set isMiddleButtonPanning(v) { interactionState.isMiddleButtonPanning = v; },
  get panStartX() { return interactionState.panStartX; },
  set panStartX(v) { interactionState.panStartX = v; },
  get panStartY() { return interactionState.panStartY; },
  set panStartY(v) { interactionState.panStartY = v; },
  get panScrollStartX() { return interactionState.panScrollStartX; },
  set panScrollStartX(v) { interactionState.panScrollStartX = v; },
  get panScrollStartY() { return interactionState.panScrollStartY; },
  set panScrollStartY(v) { interactionState.panScrollStartY = v; },
  get activeContinuousCanvas() { return interactionState.activeContinuousCanvas; },
  set activeContinuousCanvas(v) { interactionState.activeContinuousCanvas = v; },
  get activeContinuousPage() { return interactionState.activeContinuousPage; },
  set activeContinuousPage(v) { interactionState.activeContinuousPage = v; },

  // Backward compat — clipboard-store
  get clipboardAnnotation() { return clipboardState.annotation; },
  set clipboardAnnotation(v) { clipboardState.annotation = v; },
  get clipboardAnnotations() { return clipboardState.annotations; },
  set clipboardAnnotations(v) { clipboardState.annotations = v; },

  // Backward compat — editing-store
  get isEditingText() { return editingState.isEditingText; },
  set isEditingText(v) { editingState.isEditingText = v; },
  get editingAnnotation() { return editingState.editingAnnotation; },
  set editingAnnotation(v) { editingState.editingAnnotation = v; },
  get textEditElement() { return editingState.textEditElement; },
  set textEditElement(v) { editingState.textEditElement = v; },
  get isEditingPdfText() { return editingState.isEditingPdfText; },
  set isEditingPdfText(v) { editingState.isEditingPdfText = v; },
  get pdfTextEditState() { return editingState.pdfTextEditState; },
  set pdfTextEditState(v) { editingState.pdfTextEditState = v; },

  // Document delegation
  get pdfDoc() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.pdfDoc : null;
  },
  set pdfDoc(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.pdfDoc = value;
  },
  get currentPage() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.currentPage : 1;
  },
  set currentPage(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.currentPage = value;
  },
  get scale() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.scale : 1.5;
  },
  set scale(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.scale = value;
  },
  get viewMode(): 'single' | 'continuous' {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.viewMode : 'single';
  },
  set viewMode(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.viewMode = value;
  },
  get currentPdfPath() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.filePath : null;
  },
  set currentPdfPath(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.filePath = value;
      doc.fileName = value ? value.split(/[\\/]/).pop()! : 'Untitled';
    }
  },
  get annotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.annotations : [];
  },
  set annotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.annotations = value;
  },
  get textEdits() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.textEdits : [];
  },
  set textEdits(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.textEdits = value;
  },
  get watermarks() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.watermarks : [];
  },
  set watermarks(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.watermarks = value;
  },
  get bookmarks() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.bookmarks : [];
  },
  set bookmarks(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.bookmarks = value;
  },
  get redoStack() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.redoStack : [];
  },
  set redoStack(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.redoStack = value;
  },
  get pageRotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.pageRotations : {};
  },
  set pageRotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.pageRotations = value;
  },
  get selectedAnnotation() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.selectedAnnotation : null;
  },
  set selectedAnnotation(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.selectedAnnotation = value;
      if (value) {
        doc.selectedAnnotations = [value];
      } else {
        doc.selectedAnnotations = [];
      }
    }
  },
  get measureScale() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.measureScale : null;
  },
  set measureScale(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) doc.measureScale = value;
  },
  get selectedAnnotations() {
    const doc = this.documents[this.activeDocumentIndex];
    return doc ? doc.selectedAnnotations : [];
  },
  set selectedAnnotations(value) {
    const doc = this.documents[this.activeDocumentIndex];
    if (doc) {
      doc.selectedAnnotations = value;
      doc.selectedAnnotation = value.length > 0 ? value[0] : null;
    }
  }
} as any); // cast needed: createMutable doesn't support getter/setter syntax in type param

export function noPdf(): boolean {
  return !state.pdfDoc;
}

export function getActiveDocument(): DocumentState | null {
  return state.documents[state.activeDocumentIndex] || null;
}

export function hasOpenDocuments(): boolean {
  return state.documents.length > 0;
}

export function findDocumentByPath(filePath: string): number {
  return state.documents.findIndex(doc => doc.filePath === filePath);
}

export function getPageRotation(pageNum: number): number {
  const doc = state.documents[state.activeDocumentIndex];
  return doc ? (doc.pageRotations[pageNum] || 0) : 0;
}

export function setPageRotation(pageNum: number, degrees: number): void {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.pageRotations[pageNum] = ((degrees % 360) + 360) % 360;
  }
}

// Make shiftKeyPressed accessible globally for legacy code
Object.defineProperty(window, 'shiftKeyPressed', {
  get: () => state.shiftKeyPressed,
  set: (value: boolean) => { state.shiftKeyPressed = value; }
});
