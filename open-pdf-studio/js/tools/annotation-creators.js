import { state, getActiveDocument } from '../core/state.js';
import { getColorPickerValue, getLineWidthValue } from '../bridge.js';
import { createAnnotation } from '../annotations/factory.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, snapDistanceTo10 } from '../annotations/measurement.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';
import { applyDynamicScaling } from '../annotations/dynamic-scaling.js';
import { getTemplate, defaultParams } from '../symbols/registry.js';
import { pendingSymbolId } from '../solid/stores/parametricSymbolStore.js';

/**
 * Build raw annotation properties from tool + coordinates.
 * Shared by both preview rendering and final annotation creation.
 * Does NOT call createAnnotation() — returns a plain props object.
 * Does NOT validate minimum size — preview needs to render at any size.
 */
export function buildAnnotationProps(tool, startX, startY, endX, endY, e) {
  const prefs = state.preferences;
  const o = state.toolOverrides || {};

  // Helpers
  function snap(sx, sy, ex, ey) {
    if (e?.shiftKey && prefs.enableAngleSnap) {
      const dx = ex - sx, dy = ey - sy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const ang = snapAngle(Math.atan2(dy, dx) * (180 / Math.PI), prefs.angleSnapDegrees) * (Math.PI / 180);
      return { x: sx + len * Math.cos(ang), y: sy + len * Math.sin(ang) };
    }
    return { x: ex, y: ey };
  }

  function bbox(sx, sy, ex, ey) {
    return {
      x: Math.min(sx, ex), y: Math.min(sy, ey),
      width: Math.abs(ex - sx), height: Math.abs(ey - sy)
    };
  }

  switch (tool) {
    case 'draw':
      if (state.currentPath.length > 1) {
        // Ribbon values take precedence so the live color/width pickers in the
        // Comment tab actually drive the freehand stroke. prefs.* serves as the
        // fallback default applied at startup to seed the ribbon signals.
        const _drawColor = getColorPickerValue() || prefs.drawStrokeColor || '#000000';
        const _drawWidth = getLineWidthValue() || prefs.drawLineWidth || 2;
        return {
          type: 'draw',
          page: getActiveDocument()?.currentPage || 1,
          path: state.currentPath,
          color: _drawColor,
          strokeColor: _drawColor,
          lineWidth: _drawWidth,
          opacity: (prefs.drawOpacity || 100) / 100
        };
      }
      return null;

    case 'highlight': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'highlight',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: prefs.highlightColor || getColorPickerValue(),
        fillColor: prefs.highlightColor || getColorPickerValue()
      };
    }

    case 'line': {
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'line',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.lineStrokeColor || getColorPickerValue(),
        strokeColor: prefs.lineStrokeColor || getColorPickerValue(),
        lineWidth: prefs.lineLineWidth || getLineWidthValue(),
        borderStyle: prefs.lineBorderStyle || 'solid',
        opacity: (prefs.lineOpacity || 100) / 100
      };
    }

    case 'arrow': {
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'arrow',
        page: getActiveDocument()?.currentPage || 1,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.arrowStrokeColor || getColorPickerValue(),
        strokeColor: prefs.arrowStrokeColor || getColorPickerValue(),
        fillColor: prefs.arrowFillColor || prefs.arrowStrokeColor || getColorPickerValue(),
        lineWidth: prefs.arrowLineWidth || getLineWidthValue(),
        borderStyle: prefs.arrowBorderStyle || 'solid',
        startHead: prefs.arrowStartHead || 'none',
        endHead: prefs.arrowEndHead || 'open',
        headSize: prefs.arrowHeadSize || 8,
        opacity: (prefs.arrowOpacity || 100) / 100,
        ...o
      };
    }

    case 'circle': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'circle',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: prefs.circleStrokeColor,
        strokeColor: prefs.circleStrokeColor,
        fillColor: prefs.circleFillNone ? null : prefs.circleFillColor,
        lineWidth: prefs.circleBorderWidth,
        borderStyle: prefs.circleBorderStyle,
        opacity: prefs.circleOpacity / 100,
        ...o
      };
    }

    case 'box': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'box',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: prefs.rectStrokeColor,
        strokeColor: prefs.rectStrokeColor,
        fillColor: prefs.rectFillNone ? null : prefs.rectFillColor,
        lineWidth: prefs.rectBorderWidth,
        borderStyle: prefs.rectBorderStyle,
        opacity: prefs.rectOpacity / 100,
        ...o
      };
    }

    case 'polygon':
      return {
        type: 'polygon',
        page: getActiveDocument()?.currentPage || 1,
        x: startX, y: startY,
        width: endX - startX, height: endY - startY,
        sides: 6,
        color: prefs.polygonStrokeColor || getColorPickerValue(),
        strokeColor: prefs.polygonStrokeColor || getColorPickerValue(),
        lineWidth: prefs.polygonLineWidth || getLineWidthValue(),
        opacity: (prefs.polygonOpacity || 100) / 100
      };

    case 'cloud': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'cloud',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        color: prefs.cloudStrokeColor || getColorPickerValue(),
        strokeColor: prefs.cloudStrokeColor || getColorPickerValue(),
        lineWidth: prefs.cloudLineWidth || getLineWidthValue(),
        opacity: (prefs.cloudOpacity || 100) / 100
      };
    }

    case 'textbox': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'textbox',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        text: '',
        color: prefs.textboxStrokeColor,
        strokeColor: prefs.textboxStrokeColor,
        fillColor: prefs.textboxFillNone ? 'transparent' : prefs.textboxFillColor,
        textColor: '#000000',
        fontSize: prefs.textboxFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.textboxBorderWidth,
        borderStyle: prefs.textboxBorderStyle,
        opacity: (prefs.textboxOpacity || 100) / 100
      };
    }

    case 'callout': {
      const defaultWidth = 150;
      const defaultHeight = 60;
      const coX = endX - defaultWidth / 2;
      const coY = endY - defaultHeight / 2;
      const boxCenterX = endX;
      const isArrowLeft = startX < boxCenterX;
      const armOriginX = isArrowLeft ? coX : coX + defaultWidth;
      const armOriginY = Math.max(coY, Math.min(coY + defaultHeight, endY));
      const armLength = Math.min(30, Math.abs(startX - armOriginX) * 0.4);
      const kneeX = isArrowLeft ? armOriginX - armLength : armOriginX + armLength;
      const kneeY = armOriginY;
      return {
        type: 'callout',
        page: getActiveDocument()?.currentPage || 1,
        x: coX, y: coY,
        width: defaultWidth, height: defaultHeight,
        arrowX: startX, arrowY: startY,
        kneeX, kneeY,
        armOriginX, armOriginY,
        text: '',
        color: prefs.calloutStrokeColor,
        strokeColor: prefs.calloutStrokeColor,
        fillColor: prefs.calloutFillNone ? 'transparent' : prefs.calloutFillColor,
        textColor: '#000000',
        fontSize: prefs.calloutFontSize,
        fontFamily: 'Arial',
        lineWidth: prefs.calloutBorderWidth,
        borderStyle: prefs.calloutBorderStyle,
        opacity: (prefs.calloutOpacity || 100) / 100
      };
    }

    case 'redaction': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'redaction',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        overlayColor: prefs.redactionOverlayColor
      };
    }

    case 'measureDistance': {
      let end = snap(startX, startY, endX, endY);
      if (e?.ctrlKey) end = snapDistanceTo10(startX, startY, end.x, end.y);
      const currentPage = getActiveDocument()?.currentPage || 1;
      const dist = calculateDistance(startX, startY, end.x, end.y, currentPage);
      return {
        type: 'measureDistance',
        page: currentPage,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.measureDistStrokeColor,
        strokeColor: prefs.measureDistStrokeColor,
        lineWidth: prefs.measureDistLineWidth,
        borderStyle: prefs.measureDistBorderStyle || 'solid',
        opacity: (prefs.measureDistOpacity || 100) / 100,
        measureText: formatMeasurement(dist),
        measureValue: dist.value,
        measureUnit: dist.unit,
        measurePixels: dist.pixels
      };
    }

    case 'parametricSymbol': {
      const symbolId = pendingSymbolId() || 'door';
      const template = getTemplate(symbolId);
      let b = bbox(startX, startY, endX, endY);
      // Click (no real drag): use the template's defaultSize
      if (b.width < 5 || b.height < 5) {
        const ds = (template && template.defaultSize) || { width: 80, height: 80 };
        b = { x: startX, y: startY, width: ds.width, height: ds.height };
      }
      const stroke = getColorPickerValue() || '#000000';
      return {
        type: 'parametricSymbol',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        symbolId,
        params: template ? defaultParams(template) : {},
        color: stroke,
        strokeColor: stroke,
        lineWidth: getLineWidthValue() || 1,
        rotation: 0,
        opacity: 1,
      };
    }

    case 'viewport': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'viewport',
        page: getActiveDocument()?.currentPage || 1,
        ...b,
        name: 'Viewport',
        scaleRatio: '1:100',
        pixelsPerUnit: 0.02835,
        unit: 'mm',
        color: '#0066cc',
        lineWidth: 1.5,
        opacity: 0.6,
      };
    }

    default: {
      const typeHandler = getAnnotationType(tool);
      if (typeHandler && typeHandler.create) {
        const ann = typeHandler.create(startX, startY, endX, endY, e, state);
        if (ann) return { ...ann, page: getActiveDocument()?.currentPage || 1, ...o };
      }
      return null;
    }
  }
}

function finalizeAnnotation(tool, props) {
  if (!props) return null;

  const w = props.width, h = props.height;
  if (tool === 'cloud' && (w < 10 || h < 10)) return null;
  if (tool === 'textbox' && (w < 5 || h < 5)) return null;
  if (tool === 'redaction' && (w < 5 || h < 5)) return null;

  if (tool === 'draw') {
    state.currentPath = [];
  }

  // Dynamic scaling: adjust line width, font size, etc. based on viewport
  const pageNum = props.page || getActiveDocument()?.currentPage || 1;
  const annX = props.x ?? props.startX ?? 0;
  const annY = props.y ?? props.startY ?? 0;
  applyDynamicScaling(props, pageNum, annX, annY);

  return createAnnotation(props);
}

export function createAnnotationFromTool(tool, startX, startY, endX, endY, e) {
  return finalizeAnnotation(tool, buildAnnotationProps(tool, startX, startY, endX, endY, e));
}

export function createContinuousAnnotation(tool, pageNum, startX, startY, endX, endY) {
  const props = buildAnnotationProps(tool, startX, startY, endX, endY, null);
  if (props) props.page = pageNum;
  return finalizeAnnotation(tool, props);
}

export function createMeasureAreaAnnotation(points, holes) {
  const mPrefs = state.preferences;
  const annProps = {
    type: 'measureArea',
    page: getActiveDocument()?.currentPage || 1,
    points,
    color: mPrefs.measureAreaStrokeColor,
    strokeColor: mPrefs.measureAreaStrokeColor,
    lineWidth: mPrefs.measureAreaLineWidth,
    opacity: (mPrefs.measureAreaOpacity || 100) / 100,
    fillColor: mPrefs.measureAreaFillNone ? null : (mPrefs.measureAreaFillColor || null),
    borderStyle: mPrefs.measureAreaBorderStyle || 'dashed',
    hatchPattern: mPrefs.measureAreaHatchPattern || 'diagonal-left',
    hatchColor: mPrefs.measureAreaHatchColor || '#ff0000',
    hatchScale: mPrefs.measureAreaHatchScale ?? 100,
  };
  // Store holes if provided
  if (holes && holes.length > 0) {
    annProps.holes = holes;
  }
  // Always use calculateArea (which resolves scale from scaleBar / document / prefs)
  // followed by formatMeasurement (which auto-converts mm² → m²).
  const currentPage = getActiveDocument()?.currentPage || 1;
  const area = calculateArea(points, holes, currentPage);
  annProps.measureText = formatMeasurement(area);
  annProps.measureValue = area.value;
  annProps.measureUnit = area.unit;
  if (mPrefs.measureAreaDimPrecision != null) {
    annProps.measurePrecision = mPrefs.measureAreaDimPrecision;
  }
  applyDynamicScaling(annProps, currentPage, points[0]?.x || 0, points[0]?.y || 0);
  return createAnnotation(annProps);
}

export function createMeasurePerimeterAnnotation(points) {
  const mPrefs = state.preferences;
  const perimProps = {
    type: 'measurePerimeter',
    page: getActiveDocument()?.currentPage || 1,
    points,
    color: mPrefs.measurePerimStrokeColor,
    strokeColor: mPrefs.measurePerimStrokeColor,
    lineWidth: mPrefs.measurePerimLineWidth,
    opacity: (mPrefs.measurePerimOpacity || 100) / 100,
    borderStyle: mPrefs.measurePerimBorderStyle || 'dashed',
    startHead: mPrefs.measurePerimStartHead || 'none',
    endHead: mPrefs.measurePerimEndHead || 'none',
    headSize: mPrefs.measurePerimHeadSize || 12,
  };
  const currentPage = getActiveDocument()?.currentPage || 1;
  const hasScaleSource = getActiveDocument()?.annotations?.some(a => a.type === 'scaleBar' || a.type === 'viewport');
  if (!hasScaleSource && mPrefs.measurePerimDimScale && typeof mPrefs.measurePerimDimScale === 'number') {
    perimProps.measureScale = mPrefs.measurePerimDimScale;
    perimProps.measureUnit = mPrefs.measurePerimDimUnit || 'mm';
    perimProps.measurePrecision = mPrefs.measurePerimDimPrecision ?? 2;
    const pixelPerim = calculatePerimeter(points, currentPage).pixels;
    const scaledPerim = pixelPerim * mPrefs.measurePerimDimScale;
    const unit = mPrefs.measurePerimDimUnit || 'mm';
    const prec = mPrefs.measurePerimDimPrecision ?? 2;
    perimProps.measureText = `${scaledPerim.toFixed(prec)} ${unit}`;
    perimProps.measureValue = scaledPerim;
    perimProps.measureUnit = unit;
  } else {
    const perim = calculatePerimeter(points, currentPage);
    perimProps.measureText = formatMeasurement(perim);
    perimProps.measureValue = perim.value;
    perimProps.measureUnit = perim.unit;
  }
  applyDynamicScaling(perimProps, currentPage, points[0]?.x || 0, points[0]?.y || 0);
  return createAnnotation(perimProps);
}
