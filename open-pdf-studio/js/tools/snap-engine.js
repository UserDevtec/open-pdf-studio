import { state } from '../core/state.js';
import { getCachedPdfSnapPoints, getCachedPdfEdgeSegments } from './pdf-snap-extractor.js';

// Collect snap points from all annotations on the given page.
// excludeId: optional annotation id to skip (the one being drawn).
export function collectSnapPoints(annotations, currentPage, excludeId) {
  const prefs = state.preferences;
  if (!prefs.enableObjectSnap) return [];

  const points = [];

  for (const ann of annotations) {
    if (ann.page !== currentPage) continue;
    if (excludeId && ann.id === excludeId) continue;
    if (ann.type === 'draw') continue; // freehand is too noisy

    extractSnapPoints(ann, points, prefs);
  }

  return points;
}

function extractSnapPoints(ann, points, prefs) {
  const doEndpoints = prefs.snapToEndpoints;
  const doMidpoints = prefs.snapToMidpoints;
  const doCenters = prefs.snapToCenters;

  switch (ann.type) {
    case 'line':
    case 'arrow': {
      const sx = ann.startX, sy = ann.startY, ex = ann.endX, ey = ann.endY;
      if (doEndpoints) {
        points.push({ x: sx, y: sy, type: 'endpoint', annotation: ann });
        points.push({ x: ex, y: ey, type: 'endpoint', annotation: ann });
      }
      if (doMidpoints) {
        points.push({ x: (sx + ex) / 2, y: (sy + ey) / 2, type: 'midpoint', annotation: ann });
      }
      break;
    }

    case 'measureDistance': {
      // Only snap to extension line ends and dimension line ends
      if (doEndpoints) {
        points.push({ x: ann.startX, y: ann.startY, type: 'endpoint', annotation: ann });
        points.push({ x: ann.endX, y: ann.endY, type: 'endpoint', annotation: ann });
        if (ann.leaderStartX !== undefined) {
          points.push({ x: ann.leaderStartX, y: ann.leaderStartY, type: 'endpoint', annotation: ann });
        }
        if (ann.leaderEndX !== undefined) {
          points.push({ x: ann.leaderEndX, y: ann.leaderEndY, type: 'endpoint', annotation: ann });
        }
      }
      break;
    }

    case 'box':
    case 'highlight':
    case 'textbox':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction': {
      addRectSnapPoints(ann.x, ann.y, ann.width, ann.height, ann, points, doEndpoints, doMidpoints, doCenters);
      break;
    }

    case 'circle': {
      const x = ann.x, y = ann.y, w = ann.width, h = ann.height;
      const cx = x + w / 2, cy = y + h / 2;
      // Cardinal points of the ellipse
      if (doEndpoints) {
        points.push({ x: cx, y: y, type: 'endpoint', annotation: ann });         // top
        points.push({ x: cx, y: y + h, type: 'endpoint', annotation: ann });     // bottom
        points.push({ x: x, y: cy, type: 'endpoint', annotation: ann });         // left
        points.push({ x: x + w, y: cy, type: 'endpoint', annotation: ann });     // right
      }
      if (doCenters) {
        points.push({ x: cx, y: cy, type: 'center', annotation: ann });
      }
      break;
    }

    case 'polygon':
    case 'cloud': {
      // These have x, y, width, height bounding box
      addRectSnapPoints(ann.x, ann.y, ann.width, ann.height, ann, points, doEndpoints, doMidpoints, doCenters);
      break;
    }

    case 'polyline':
    case 'measureArea':
    case 'measurePerimeter': {
      const pts = ann.points;
      if (!pts || pts.length === 0) break;
      for (let i = 0; i < pts.length; i++) {
        if (doEndpoints) {
          points.push({ x: pts[i].x, y: pts[i].y, type: 'endpoint', annotation: ann });
        }
        if (doMidpoints && i < pts.length - 1) {
          points.push({
            x: (pts[i].x + pts[i + 1].x) / 2,
            y: (pts[i].y + pts[i + 1].y) / 2,
            type: 'midpoint',
            annotation: ann
          });
        }
      }
      // Close the loop for area
      if (doMidpoints && ann.type === 'measureArea' && pts.length > 2) {
        const first = pts[0], last = pts[pts.length - 1];
        points.push({
          x: (first.x + last.x) / 2,
          y: (first.y + last.y) / 2,
          type: 'midpoint',
          annotation: ann
        });
      }
      // Snap points for holes (cutouts) in measureArea
      if (ann.type === 'measureArea' && ann.holes && ann.holes.length > 0) {
        for (const hole of ann.holes) {
          if (!hole || hole.length === 0) continue;
          for (let i = 0; i < hole.length; i++) {
            if (doEndpoints) {
              points.push({ x: hole[i].x, y: hole[i].y, type: 'endpoint', annotation: ann });
            }
            if (doMidpoints && i < hole.length - 1) {
              points.push({
                x: (hole[i].x + hole[i + 1].x) / 2,
                y: (hole[i].y + hole[i + 1].y) / 2,
                type: 'midpoint',
                annotation: ann
              });
            }
          }
          // Close the loop for each hole
          if (doMidpoints && hole.length > 2) {
            const hFirst = hole[0], hLast = hole[hole.length - 1];
            points.push({
              x: (hFirst.x + hLast.x) / 2,
              y: (hFirst.y + hLast.y) / 2,
              type: 'midpoint',
              annotation: ann
            });
          }
        }
      }
      // Center of bounding box
      if (doCenters && pts.length > 0) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of pts) {
          if (p.x < minX) minX = p.x;
          if (p.y < minY) minY = p.y;
          if (p.x > maxX) maxX = p.x;
          if (p.y > maxY) maxY = p.y;
        }
        points.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, type: 'center', annotation: ann });
      }
      break;
    }

    case 'callout': {
      addRectSnapPoints(ann.x, ann.y, ann.width, ann.height, ann, points, doEndpoints, doMidpoints, doCenters);
      // Arrow tip
      if (doEndpoints && ann.arrowX !== undefined && ann.arrowY !== undefined) {
        points.push({ x: ann.arrowX, y: ann.arrowY, type: 'endpoint', annotation: ann });
      }
      break;
    }

    case 'comment': {
      if (doCenters) {
        points.push({ x: ann.x, y: ann.y, type: 'center', annotation: ann });
      }
      break;
    }
  }
}

function addRectSnapPoints(x, y, w, h, ann, points, doEndpoints, doMidpoints, doCenters) {
  if (w === undefined || h === undefined) return;
  if (doEndpoints) {
    points.push({ x: x, y: y, type: 'corner', annotation: ann });
    points.push({ x: x + w, y: y, type: 'corner', annotation: ann });
    points.push({ x: x, y: y + h, type: 'corner', annotation: ann });
    points.push({ x: x + w, y: y + h, type: 'corner', annotation: ann });
  }
  if (doMidpoints) {
    points.push({ x: x + w / 2, y: y, type: 'midpoint', annotation: ann });       // top mid
    points.push({ x: x + w / 2, y: y + h, type: 'midpoint', annotation: ann });   // bottom mid
    points.push({ x: x, y: y + h / 2, type: 'midpoint', annotation: ann });       // left mid
    points.push({ x: x + w, y: y + h / 2, type: 'midpoint', annotation: ann });   // right mid
  }
  if (doCenters) {
    points.push({ x: x + w / 2, y: y + h / 2, type: 'center', annotation: ann });
  }
}

// Find the nearest snap point within radius.
// Returns { x, y, type, snapped: true } or { x: cursorX, y: cursorY, snapped: false }
export function findNearestSnap(cursorX, cursorY, snapPoints, snapRadius) {
  let bestDist = Infinity;
  let best = null;

  for (const pt of snapPoints) {
    const dx = cursorX - pt.x;
    const dy = cursorY - pt.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < bestDist && dist <= snapRadius) {
      bestDist = dist;
      best = pt;
    }
  }

  if (best) {
    return { x: best.x, y: best.y, type: best.type, snapped: true };
  }
  return { x: cursorX, y: cursorY, snapped: false };
}

// Find the nearest point on any annotation edge within radius.
// This checks line segments and bounding-box edges.
export function nearestPointOnEdge(cursorX, cursorY, annotations, currentPage, snapRadius, excludeId) {
  const prefs = state.preferences;
  if (!prefs.enableObjectSnap || !prefs.snapToEdges) return null;

  let bestDist = Infinity;
  let bestPoint = null;

  for (const ann of annotations) {
    if (ann.page !== currentPage) continue;
    if (excludeId && ann.id === excludeId) continue;
    if (ann.type === 'draw') continue;

    const segments = getEdgeSegments(ann);
    for (const seg of segments) {
      const proj = projectPointOnSegment(cursorX, cursorY, seg.x1, seg.y1, seg.x2, seg.y2);
      if (proj.dist < bestDist && proj.dist <= snapRadius) {
        bestDist = proj.dist;
        bestPoint = { x: proj.x, y: proj.y, type: 'edge', snapped: true };
      }
    }
  }

  return bestPoint;
}

function getEdgeSegments(ann) {
  const segments = [];

  switch (ann.type) {
    case 'line':
    case 'arrow':
      segments.push({ x1: ann.startX, y1: ann.startY, x2: ann.endX, y2: ann.endY });
      break;

    case 'measureDistance':
      // No edge snapping for dimension annotations — only point snapping at endpoints
      break;

    case 'box':
    case 'highlight':
    case 'textbox':
    case 'image':
    case 'stamp':
    case 'signature':
    case 'redaction':
    case 'callout':
    case 'polygon':
    case 'cloud':
      addRectEdgeSegments(ann.x, ann.y, ann.width, ann.height, segments);
      break;

    case 'circle': {
      // Approximate ellipse with 16 segments
      const cx = ann.x + ann.width / 2, cy = ann.y + ann.height / 2;
      const rx = ann.width / 2, ry = ann.height / 2;
      const steps = 16;
      for (let i = 0; i < steps; i++) {
        const a1 = (i / steps) * 2 * Math.PI;
        const a2 = ((i + 1) / steps) * 2 * Math.PI;
        segments.push({
          x1: cx + rx * Math.cos(a1), y1: cy + ry * Math.sin(a1),
          x2: cx + rx * Math.cos(a2), y2: cy + ry * Math.sin(a2)
        });
      }
      break;
    }

    case 'polyline':
    case 'measureArea':
    case 'measurePerimeter': {
      const pts = ann.points;
      if (!pts || pts.length < 2) break;
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({ x1: pts[i].x, y1: pts[i].y, x2: pts[i + 1].x, y2: pts[i + 1].y });
      }
      if (ann.type === 'measureArea' && pts.length > 2) {
        segments.push({ x1: pts[pts.length - 1].x, y1: pts[pts.length - 1].y, x2: pts[0].x, y2: pts[0].y });
      }
      // Add edge segments for holes in measureArea
      if (ann.type === 'measureArea' && ann.holes && ann.holes.length > 0) {
        for (const hole of ann.holes) {
          if (!hole || hole.length < 2) continue;
          for (let i = 0; i < hole.length - 1; i++) {
            segments.push({ x1: hole[i].x, y1: hole[i].y, x2: hole[i + 1].x, y2: hole[i + 1].y });
          }
          if (hole.length > 2) {
            segments.push({ x1: hole[hole.length - 1].x, y1: hole[hole.length - 1].y, x2: hole[0].x, y2: hole[0].y });
          }
        }
      }
      break;
    }
  }

  return segments;
}

function addRectEdgeSegments(x, y, w, h, segments) {
  if (w === undefined || h === undefined) return;
  segments.push({ x1: x, y1: y, x2: x + w, y2: y });         // top
  segments.push({ x1: x + w, y1: y, x2: x + w, y2: y + h }); // right
  segments.push({ x1: x + w, y1: y + h, x2: x, y2: y + h }); // bottom
  segments.push({ x1: x, y1: y + h, x2: x, y2: y });          // left
}

// Project a point onto a line segment and return the closest point + distance.
function projectPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (zero length)
    const d = Math.sqrt((px - x1) * (px - x1) + (py - y1) * (py - y1));
    return { x: x1, y: y1, dist: d };
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  const dist = Math.sqrt((px - projX) * (px - projX) + (py - projY) * (py - projY));

  return { x: projX, y: projY, dist };
}

// Draw visual snap indicator at the snapped point.
// ctx should already be scaled to PDF space.
export function drawSnapIndicator(ctx, snapResult, scale) {
  if (!snapResult || !snapResult.snapped) return;

  const x = snapResult.x;
  const y = snapResult.y;
  const size = 5 / scale; // constant screen size
  const lineWidth = 1 / scale;

  ctx.save();
  ctx.strokeStyle = '#FF00FF';
  ctx.fillStyle = 'rgba(255, 0, 255, 0.15)';
  ctx.lineWidth = lineWidth;

  switch (snapResult.type) {
    case 'endpoint':
    case 'corner': {
      // Hollow square
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      break;
    }
    case 'midpoint': {
      // Small triangle
      const h = size * 0.866; // sqrt(3)/2
      ctx.beginPath();
      ctx.moveTo(x, y - h / 2);
      ctx.lineTo(x - size / 2, y + h / 2);
      ctx.lineTo(x + size / 2, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'center': {
      // Circle with crosshair
      ctx.beginPath();
      ctx.arc(x, y, size / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      // Crosshair
      ctx.beginPath();
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y);
      ctx.moveTo(x, y - size);
      ctx.lineTo(x, y + size);
      ctx.stroke();
      break;
    }
    case 'edge': {
      // Small diamond
      ctx.beginPath();
      ctx.moveTo(x, y - size / 2);
      ctx.lineTo(x + size / 2, y);
      ctx.lineTo(x, y + size / 2);
      ctx.lineTo(x - size / 2, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'intersection': {
      // X shape (two crossing lines)
      ctx.beginPath();
      ctx.moveTo(x - size / 2, y - size / 2);
      ctx.lineTo(x + size / 2, y + size / 2);
      ctx.moveTo(x + size / 2, y - size / 2);
      ctx.lineTo(x - size / 2, y + size / 2);
      ctx.stroke();
      break;
    }
    case 'perpendicular': {
      // Right-angle symbol
      const s = size * 0.6;
      ctx.beginPath();
      ctx.moveTo(x - s, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - s);
      ctx.stroke();
      // Small square at the corner
      ctx.fillRect(x - lineWidth, y - lineWidth, lineWidth * 3, lineWidth * 3);
      break;
    }
  }

  // Draw snap type label
  if (state.preferences.showSnapTypeLabel !== false) {
    const labels = {
      endpoint: 'Endpoint', corner: 'Corner', midpoint: 'Midpoint',
      center: 'Center', edge: 'Edge',
      intersection: 'Intersection', perpendicular: 'Perpendicular'
    };
    const label = labels[snapResult.type];
    if (label) {
      const fontSize = 9 / scale;
      ctx.font = `${fontSize}px Arial`;
      const textWidth = ctx.measureText(label).width;
      const labelX = x + size + 4 / scale;
      const labelY = y - 2 / scale;
      // Background
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(labelX - 1 / scale, labelY - fontSize, textWidth + 2 / scale, fontSize + 2 / scale);
      // Text
      ctx.fillStyle = '#FF00FF';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(label, labelX, labelY);
    }
  }

  ctx.restore();
}

// Draw alignment guide lines when dragging a polyline/polygon vertex.
// Shows horizontal/vertical guides from sibling vertices that align with the dragged node.
// ctx should already be scaled to PDF space.
export function drawAlignmentGuides(ctx, annotation, draggedNodeIdx, scale) {
  if (!annotation.points || annotation.points.length < 2) return;
  if (draggedNodeIdx < 0 || draggedNodeIdx >= annotation.points.length) return;

  const dragged = annotation.points[draggedNodeIdx];
  const alignTol = 3 / scale;
  const guideExtent = 50000;
  const lw = 0.5 / scale;
  const dashLen = 4 / scale;
  const dotR = 2.5 / scale;

  ctx.save();
  ctx.strokeStyle = '#00bcd4';
  ctx.fillStyle = '#00bcd4';
  ctx.lineWidth = lw;
  ctx.setLineDash([dashLen, dashLen]);

  for (let i = 0; i < annotation.points.length; i++) {
    if (i === draggedNodeIdx) continue;
    const pt = annotation.points[i];

    // Horizontal alignment
    if (Math.abs(dragged.y - pt.y) < alignTol) {
      ctx.beginPath();
      ctx.moveTo(dragged.x - guideExtent, pt.y);
      ctx.lineTo(dragged.x + guideExtent, pt.y);
      ctx.stroke();
      // Small dot at the source vertex
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dotR, 0, 2 * Math.PI);
      ctx.fill();
      ctx.setLineDash([dashLen, dashLen]);
    }

    // Vertical alignment
    if (Math.abs(dragged.x - pt.x) < alignTol) {
      ctx.beginPath();
      ctx.moveTo(pt.x, dragged.y - guideExtent);
      ctx.lineTo(pt.x, dragged.y + guideExtent);
      ctx.stroke();
      // Small dot at the source vertex
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, dotR, 0, 2 * Math.PI);
      ctx.fill();
      ctx.setLineDash([dashLen, dashLen]);
    }
  }

  ctx.setLineDash([]);
  ctx.restore();
}

// Find nearest point on PDF vector edge segments within radius.
function nearestPointOnPdfEdge(cursorX, cursorY, currentPage, snapRadius) {
  const prefs = state.preferences;
  if (!prefs.snapToPdfContent || !prefs.snapToEdges) return null;

  const edges = getCachedPdfEdgeSegments(currentPage);
  if (!edges || edges.length === 0) return null;

  let bestDist = Infinity;
  let bestPoint = null;

  for (const seg of edges) {
    const proj = projectPointOnSegment(cursorX, cursorY, seg.x1, seg.y1, seg.x2, seg.y2);
    if (proj.dist < bestDist && proj.dist <= snapRadius) {
      bestDist = proj.dist;
      bestPoint = { x: proj.x, y: proj.y, type: 'edge', snapped: true };
    }
  }

  return bestPoint;
}

// Combined snap: first try point snaps, then edge snap.
// Returns the best snap result.
// inProgressPoints: optional array of {x,y} from the polyline/measure being drawn
export function performSnap(cursorX, cursorY, annotations, currentPage, scale, excludeId, inProgressPoints) {
  const prefs = state.preferences;
  if (!prefs.enableObjectSnap) {
    return { x: cursorX, y: cursorY, snapped: false };
  }

  const snapRadius = (prefs.objectSnapRadius || 10) / scale;

  // 1. Collect point snap targets from completed annotations
  const snapPoints = collectSnapPoints(annotations, currentPage, excludeId);

  // 2. Add PDF vector snap points (if enabled)
  if (prefs.snapToPdfContent) {
    const pdfPoints = getCachedPdfSnapPoints(currentPage);
    if (pdfPoints.length > 0) {
      for (const pt of pdfPoints) {
        snapPoints.push(pt);
      }
    }
  }

  // 3. Add in-progress points (vertices already placed in the current polyline/measure)
  if (inProgressPoints && inProgressPoints.length > 0) {
    for (const pt of inProgressPoints) {
      snapPoints.push({ x: pt.x, y: pt.y, type: 'endpoint', annotation: null });
    }
  }

  // 4. Try point snap first (endpoints, corners, midpoints, centers)
  const pointResult = findNearestSnap(cursorX, cursorY, snapPoints, snapRadius);
  if (pointResult.snapped) return pointResult;

  // 5. Fall back to annotation edge snap
  const edgeResult = nearestPointOnEdge(cursorX, cursorY, annotations, currentPage, snapRadius, excludeId);
  if (edgeResult) return edgeResult;

  // 6. Fall back to PDF vector edge snap
  if (prefs.snapToPdfContent) {
    const pdfEdgeResult = nearestPointOnPdfEdge(cursorX, cursorY, currentPage, snapRadius);
    if (pdfEdgeResult) return pdfEdgeResult;
  }

  // 7. Intersection snap (where edges from different annotations cross)
  if (prefs.snapToIntersections !== false) {
    const intersectionResult = findIntersectionSnap(cursorX, cursorY, annotations, currentPage, snapRadius, excludeId);
    if (intersectionResult) return intersectionResult;
  }

  // 8. Perpendicular snap (point on edge perpendicular from last placed point)
  if (prefs.snapToPerpendicular && inProgressPoints && inProgressPoints.length > 0) {
    const lastPt = inProgressPoints[inProgressPoints.length - 1];
    const perpResult = findPerpendicularSnap(cursorX, cursorY, lastPt, annotations, currentPage, snapRadius, excludeId);
    if (perpResult) return perpResult;
  }

  return { x: cursorX, y: cursorY, snapped: false };
}

// Find intersection point of edge segments from different annotations near cursor
function findIntersectionSnap(cursorX, cursorY, annotations, currentPage, snapRadius, excludeId) {
  const allSegments = [];
  for (const ann of annotations) {
    if (ann.page !== currentPage) continue;
    if (excludeId && ann.id === excludeId) continue;
    if (ann.type === 'draw') continue;
    const segs = getEdgeSegments(ann);
    for (const seg of segs) {
      allSegments.push({ ...seg, annId: ann.id });
    }
  }

  let bestDist = Infinity;
  let bestPoint = null;

  for (let i = 0; i < allSegments.length; i++) {
    const a = allSegments[i];
    // Pre-filter: skip if segment bounding box is far from cursor
    const aMinX = Math.min(a.x1, a.x2) - snapRadius;
    const aMaxX = Math.max(a.x1, a.x2) + snapRadius;
    const aMinY = Math.min(a.y1, a.y2) - snapRadius;
    const aMaxY = Math.max(a.y1, a.y2) + snapRadius;
    if (cursorX < aMinX || cursorX > aMaxX || cursorY < aMinY || cursorY > aMaxY) continue;

    for (let j = i + 1; j < allSegments.length; j++) {
      const b = allSegments[j];
      if (a.annId === b.annId) continue;

      const inter = segmentIntersection(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1, b.x2, b.y2);
      if (!inter) continue;

      const dx = cursorX - inter.x;
      const dy = cursorY - inter.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist && dist <= snapRadius) {
        bestDist = dist;
        bestPoint = { x: inter.x, y: inter.y, type: 'intersection', snapped: true };
      }
    }
  }

  return bestPoint;
}

// Line segment intersection: returns {x, y} or null
function segmentIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
  const dx1 = x2 - x1, dy1 = y2 - y1;
  const dx2 = x4 - x3, dy2 = y4 - y3;
  const denom = dx1 * dy2 - dy1 * dx2;
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((x3 - x1) * dy2 - (y3 - y1) * dx2) / denom;
  const u = ((x3 - x1) * dy1 - (y3 - y1) * dx1) / denom;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: x1 + t * dx1, y: y1 + t * dy1 };
  }
  return null;
}

// Perpendicular snap: find point on an edge where line from lastPoint is perpendicular
function findPerpendicularSnap(cursorX, cursorY, lastPoint, annotations, currentPage, snapRadius, excludeId) {
  let bestDist = Infinity;
  let bestPoint = null;

  for (const ann of annotations) {
    if (ann.page !== currentPage) continue;
    if (excludeId && ann.id === excludeId) continue;
    if (ann.type === 'draw') continue;

    const segs = getEdgeSegments(ann);
    for (const seg of segs) {
      const dx = seg.x2 - seg.x1, dy = seg.y2 - seg.y1;
      const lenSq = dx * dx + dy * dy;
      if (lenSq < 1e-10) continue;

      const t = ((lastPoint.x - seg.x1) * dx + (lastPoint.y - seg.y1) * dy) / lenSq;
      if (t < 0 || t > 1) continue;

      const footX = seg.x1 + t * dx;
      const footY = seg.y1 + t * dy;

      const cdx = cursorX - footX;
      const cdy = cursorY - footY;
      const dist = Math.sqrt(cdx * cdx + cdy * cdy);
      if (dist < bestDist && dist <= snapRadius) {
        bestDist = dist;
        bestPoint = { x: footX, y: footY, type: 'perpendicular', snapped: true };
      }
    }
  }

  return bestPoint;
}
