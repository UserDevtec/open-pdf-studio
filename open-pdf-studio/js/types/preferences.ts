export interface Preferences {
  // Theme
  theme: string;

  // General
  authorName: string;

  // Snapping
  angleSnapDegrees: number;
  enableAngleSnap: boolean;

  // Grid snapping
  gridSize: number;
  enableGridSnap: boolean;
  showGrid: boolean;

  // Object snapping
  enableObjectSnap: boolean;
  snapToEndpoints: boolean;
  snapToMidpoints: boolean;
  snapToCenters: boolean;
  snapToEdges: boolean;
  objectSnapRadius: number;
  snapToPdfContent: boolean;

  // Appearance
  defaultAnnotationColor: string;
  defaultLineWidth: number;
  defaultFontSize: number;
  highlightOpacity: number;

  // TextBox defaults
  textboxFillColor: string;
  textboxFillNone: boolean;
  textboxStrokeColor: string;
  textboxBorderWidth: number;
  textboxBorderStyle: string;
  textboxOpacity: number;
  textboxFontSize: number;

  // Callout defaults
  calloutFillColor: string;
  calloutFillNone: boolean;
  calloutStrokeColor: string;
  calloutBorderWidth: number;
  calloutBorderStyle: string;
  calloutOpacity: number;
  calloutFontSize: number;

  // Rectangle defaults
  rectFillColor: string;
  rectFillNone: boolean;
  rectStrokeColor: string;
  rectBorderWidth: number;
  rectBorderStyle: string;
  rectOpacity: number;

  // Circle/Ellipse defaults
  circleFillColor: string;
  circleFillNone: boolean;
  circleStrokeColor: string;
  circleBorderWidth: number;
  circleBorderStyle: string;
  circleOpacity: number;

  // Arrow defaults
  arrowFillColor: string;
  arrowFillNone: boolean;
  arrowStrokeColor: string;
  arrowLineWidth: number;
  arrowBorderStyle: string;
  arrowStartHead: string;
  arrowEndHead: string;
  arrowHeadSize: number;
  arrowOpacity: number;

  // Draw/Freehand defaults
  drawStrokeColor: string;
  drawLineWidth: number;
  drawOpacity: number;

  // Line defaults
  lineStrokeColor: string;
  lineLineWidth: number;
  lineBorderStyle: string;
  lineOpacity: number;

  // Highlight defaults
  highlightColor: string;

  // Polygon defaults
  polygonStrokeColor: string;
  polygonLineWidth: number;
  polygonOpacity: number;

  // Cloud defaults
  cloudStrokeColor: string;
  cloudLineWidth: number;
  cloudOpacity: number;

  // Comment/Note defaults
  commentColor: string;
  commentIcon: string;

  // Polyline defaults
  polylineStrokeColor: string;
  polylineLineWidth: number;
  polylineOpacity: number;

  // Redaction defaults
  redactionOverlayColor: string;

  // Measurement defaults
  measureStrokeColor: string;
  measureLineWidth: number;
  measureOpacity: number;
  measureRounding: string;

  // Behavior
  autoSelectAfterCreate: boolean;
  confirmBeforeDelete: boolean;

  // Startup
  restoreLastSession: boolean;
  dontAskDefaultPdf: boolean;

  // Display
  showHandles: boolean;
  handleSize: number;

  // View
  thinLines: boolean;

  // Panels
  propertiesPanelVisible: boolean;

  // Language
  language: string;
}
