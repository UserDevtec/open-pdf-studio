import type { Preferences } from '../types/preferences.js';

// Handle types for annotation selection and manipulation
export const HANDLE_SIZE = 6;

export const HANDLE_TYPES = {
  MOVE: 'move',
  TOP_LEFT: 'tl',
  TOP_RIGHT: 'tr',
  BOTTOM_LEFT: 'bl',
  BOTTOM_RIGHT: 'br',
  TOP: 't',
  BOTTOM: 'b',
  LEFT: 'l',
  RIGHT: 'r',
  LINE_START: 'line_start',
  LINE_END: 'line_end',
  RADIUS: 'radius',
  ROTATE: 'rotate',
  CALLOUT_ARROW: 'callout_arrow',
  CALLOUT_KNEE: 'callout_knee',
  CALLOUT_MOVE: 'callout_move',
  POLYLINE_NODE: 'polyline_node'
} as const;

// Default application preferences
export const DEFAULT_PREFERENCES: Preferences = {
  // Theme
  theme: 'system',

  // General — authorName defaults to '' (resolved to OS username at load time)
  authorName: '',

  // Snapping
  angleSnapDegrees: 30,
  enableAngleSnap: true,

  // Grid snapping
  gridSize: 10,
  enableGridSnap: false,
  showGrid: false,

  // Object snapping
  enableObjectSnap: true,
  snapToEndpoints: true,
  snapToMidpoints: true,
  snapToCenters: true,
  snapToEdges: true,
  objectSnapRadius: 10,
  snapToPdfContent: true,

  // Appearance
  defaultAnnotationColor: '#FF0000',
  defaultLineWidth: 1,
  defaultFontSize: 16,
  highlightOpacity: 50,

  // TextBox defaults
  textboxFillColor: '#FFFBEB',
  textboxFillNone: true,
  textboxStrokeColor: '#FF0000',
  textboxBorderWidth: 1,
  textboxBorderStyle: 'solid',
  textboxOpacity: 100,
  textboxFontSize: 14,

  // Callout defaults
  calloutFillColor: '#FFFBEB',
  calloutFillNone: false,
  calloutStrokeColor: '#FF0000',
  calloutBorderWidth: 1,
  calloutBorderStyle: 'solid',
  calloutOpacity: 100,
  calloutFontSize: 14,

  // Rectangle defaults
  rectFillColor: '#FFFBEB',
  rectFillNone: true,
  rectStrokeColor: '#FF0000',
  rectBorderWidth: 1,
  rectBorderStyle: 'solid',
  rectOpacity: 100,

  // Circle/Ellipse defaults
  circleFillColor: '#FFFBEB',
  circleFillNone: true,
  circleStrokeColor: '#FF0000',
  circleBorderWidth: 1,
  circleBorderStyle: 'solid',
  circleOpacity: 100,

  // Arrow defaults
  arrowFillColor: '#FF0000',
  arrowFillNone: true,
  arrowStrokeColor: '#FF0000',
  arrowLineWidth: 1,
  arrowBorderStyle: 'solid',
  arrowStartHead: 'none',
  arrowEndHead: 'open',
  arrowHeadSize: 10,
  arrowOpacity: 100,

  // Draw/Freehand defaults
  drawStrokeColor: '#FF0000',
  drawLineWidth: 1,
  drawOpacity: 100,

  // Line defaults
  lineStrokeColor: '#FF0000',
  lineLineWidth: 1,
  lineBorderStyle: 'solid',
  lineOpacity: 100,

  // Highlight defaults
  highlightColor: '#FFFF00',

  // Polygon defaults
  polygonStrokeColor: '#FF0000',
  polygonLineWidth: 1,
  polygonOpacity: 100,

  // Cloud defaults
  cloudStrokeColor: '#FF0000',
  cloudLineWidth: 1,
  cloudOpacity: 100,

  // Comment/Note defaults
  commentColor: '#FFFF00',
  commentIcon: 'comment',

  // Polyline defaults
  polylineStrokeColor: '#FF0000',
  polylineLineWidth: 1,
  polylineOpacity: 100,

  // Redaction defaults
  redactionOverlayColor: '#000000',

  // Measurement defaults
  measureStrokeColor: '#FF0000',
  measureLineWidth: 1,
  measureOpacity: 100,
  measureRounding: 'none', // 'none', '1', '5', '10'

  // Behavior
  autoSelectAfterCreate: true,
  confirmBeforeDelete: true,

  // Startup
  restoreLastSession: false,
  dontAskDefaultPdf: false,

  // Display
  showHandles: true,
  handleSize: 8,

  // View
  thinLines: false,

  // Panels
  propertiesPanelVisible: true,

  // Language
  language: 'auto'
};
