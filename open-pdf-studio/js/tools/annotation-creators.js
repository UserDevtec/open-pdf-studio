import { state } from '../core/state.js';
import { getColorPickerValue, getLineWidthValue } from '../bridge.js';
import { createAnnotation } from '../annotations/factory.js';
import { snapAngle } from '../utils/helpers.js';
import { calculateDistance, calculateArea, calculatePerimeter, formatMeasurement, snapDistanceTo10 } from '../annotations/measurement.js';
import { getAnnotationType } from '../plugins/annotation-type-registry.js';

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
        return {
          type: 'draw',
          page: state.currentPage,
          path: state.currentPath,
          color: prefs.drawStrokeColor || getColorPickerValue(),
          strokeColor: prefs.drawStrokeColor || getColorPickerValue(),
          lineWidth: prefs.drawLineWidth || getLineWidthValue(),
          opacity: (prefs.drawOpacity || 100) / 100
        };
      }
      return null;

    case 'highlight': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'highlight',
        page: state.currentPage,
        ...b,
        color: prefs.highlightColor || getColorPickerValue(),
        fillColor: prefs.highlightColor || getColorPickerValue()
      };
    }

    case 'line': {
      const end = snap(startX, startY, endX, endY);
      return {
        type: 'line',
        page: state.currentPage,
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
        page: state.currentPage,
        startX, startY,
        endX: end.x, endY: end.y,
        color: prefs.arrowStrokeColor || getColorPickerValue(),
        strokeColor: prefs.arrowStrokeColor || getColorPickerValue(),
        fillColor: prefs.arrowFillColor || prefs.arrowStrokeColor || getColorPickerValue(),
        lineWidth: prefs.arrowLineWidth || getLineWidthValue(),
        borderStyle: prefs.arrowBorderStyle || 'solid',
        startHead: prefs.arrowStartHead || 'none',
        endHead: prefs.arrowEndHead || 'open',
        headSize: prefs.arrowHeadSize || 12,
        opacity: (prefs.arrowOpacity || 100) / 100,
        ...o
      };
    }

    case 'circle': {
      const b = bbox(startX, startY, endX, endY);
      return {
        type: 'circle',
        page: state.currentPage,
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
        page: state.currentPage,
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
        page: state.currentPage,
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
        page: state.currentPage,
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
        page: state.currentPage,
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
        page: state.currentPage,
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
        page: state.currentPage,
        ...b,
        overlayColor: prefs.redactionOverlayColor
      };
    }

    case 'measureDistance': {
      let end = snap(startX, startY, endX, endY);
      if (e?.ctrlKey) end = snapDistanceTo10(startX, startY, end.x, end.y);
      const dist = calculateDistance(startX, startY, end.x, end.y);
      return {
        type: 'measureDistance',
        page: state.currentPage,
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

    default: {
      const typeHandler = getAnnotationType(tool);
      if (typeHandler && typeHandler.create) {
        const ann = typeHandler.create(startX, startY, endX, endY, e, state);
        if (ann) return { ...ann, page: state.currentPage, ...o };
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

export function createMeasureAreaAnnotation(points) {
  const mPrefs = state.preferences;
  const annProps = {
    type: 'measureArea',
    page: state.currentPage,
    points,
    color: mPrefs.measureAreaStrokeColor,
    strokeColor: mPrefs.measureAreaStrokeColor,
    lineWidth: mPrefs.measureAreaLineWidth,
    opacity: (mPrefs.measureAreaOpacity || 100) / 100,
    fillColor: mPrefs.measureAreaFillNone ? null : (mPrefs.measureAreaFillColor || null),
    borderStyle: mPrefs.measureAreaBorderStyle || 'dashed',
  };
  if (mPrefs.measureAreaDimScale && typeof mPrefs.measureAreaDimScale === 'number') {
    annProps.measureScale = mPrefs.measureAreaDimScale;
    annProps.measureUnit = mPrefs.measureAreaDimUnit || 'mm';
    annProps.measurePrecision = mPrefs.measureAreaDimPrecision ?? 2;
    const pixelArea = calculateArea(points).pixels;
    const scaledArea = pixelArea * mPrefs.measureAreaDimScale * mPrefs.measureAreaDimScale;
    const unit = (mPrefs.measureAreaDimUnit || 'mm') + '\u00B2';
    const prec = mPrefs.measureAreaDimPrecision ?? 2;
    annProps.measureText = `${scaledArea.toFixed(prec)} ${unit}`;
    annProps.measureValue = scaledArea;
    annProps.measureUnit = unit;
  } else {
    const area = calculateArea(points);
    annProps.measureText = formatMeasurement(area);
    annProps.measureValue = area.value;
    annProps.measureUnit = area.unit;
  }
  return createAnnotation(annProps);
}

export function createMeasurePerimeterAnnotation(points) {
  const mPrefs = state.preferences;
  const perimProps = {
    type: 'measurePerimeter',
    page: state.currentPage,
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
  if (mPrefs.measurePerimDimScale && typeof mPrefs.measurePerimDimScale === 'number') {
    perimProps.measureScale = mPrefs.measurePerimDimScale;
    perimProps.measureUnit = mPrefs.measurePerimDimUnit || 'mm';
    perimProps.measurePrecision = mPrefs.measurePerimDimPrecision ?? 2;
    const pixelPerim = calculatePerimeter(points).pixels;
    const scaledPerim = pixelPerim * mPrefs.measurePerimDimScale;
    const unit = mPrefs.measurePerimDimUnit || 'mm';
    const prec = mPrefs.measurePerimDimPrecision ?? 2;
    perimProps.measureText = `${scaledPerim.toFixed(prec)} ${unit}`;
    perimProps.measureValue = scaledPerim;
    perimProps.measureUnit = unit;
  } else {
    const perim = calculatePerimeter(points);
    perimProps.measureText = formatMeasurement(perim);
    perimProps.measureValue = perim.value;
    perimProps.measureUnit = perim.unit;
  }
  return createAnnotation(perimProps);
}
