// Build polygon path without stroking (for fill/hatch/stroke to be applied by caller)
export function buildPolygonPath(ctx, x, y, width, height, sides = 6) {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rx = width / 2;
  const ry = height / 2;

  ctx.beginPath();
  for (let i = 0; i <= sides; i++) {
    const angle = (i * 2 * Math.PI / sides) - Math.PI / 2;
    const px = cx + rx * Math.cos(angle);
    const py = cy + ry * Math.sin(angle);
    if (i === 0) {
      ctx.moveTo(px, py);
    } else {
      ctx.lineTo(px, py);
    }
  }
  ctx.closePath();
}

// Draw polygon shape (stroke only - legacy convenience wrapper)
export function drawPolygonShape(ctx, x, y, width, height, sides = 6) {
  buildPolygonPath(ctx, x, y, width, height, sides);
  ctx.stroke();
}

// Build cloud path without stroking (for fill/hatch/stroke to be applied by caller)
export function buildCloudPath(ctx, x, y, width, height) {
  const bumpRadius = Math.min(width, height) / 8;
  const numBumpsH = Math.max(3, Math.floor(width / (bumpRadius * 1.5)));
  const numBumpsV = Math.max(2, Math.floor(height / (bumpRadius * 1.5)));

  ctx.beginPath();

  // Top edge (left to right)
  const topSpacing = width / numBumpsH;
  for (let i = 0; i < numBumpsH; i++) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y, bumpRadius, Math.PI, 0, false);
  }

  // Right edge (top to bottom)
  const rightSpacing = height / numBumpsV;
  for (let i = 0; i < numBumpsV; i++) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x + width, by, bumpRadius, -Math.PI / 2, Math.PI / 2, false);
  }

  // Bottom edge (right to left)
  for (let i = numBumpsH - 1; i >= 0; i--) {
    const bx = x + topSpacing * (i + 0.5);
    ctx.arc(bx, y + height, bumpRadius, 0, Math.PI, false);
  }

  // Left edge (bottom to top)
  for (let i = numBumpsV - 1; i >= 0; i--) {
    const by = y + rightSpacing * (i + 0.5);
    ctx.arc(x, by, bumpRadius, Math.PI / 2, -Math.PI / 2, false);
  }

  ctx.closePath();
}

// Draw cloud shape (stroke only - legacy convenience wrapper)
export function drawCloudShape(ctx, x, y, width, height) {
  buildCloudPath(ctx, x, y, width, height);
  ctx.stroke();
}

// Build cloud path along arbitrary points (closed polygon with scallop edges)
export function buildCloudPolylinePath(ctx, points, closed = true) {
  if (!points || points.length < 2) return;
  const TARGET_BUMP = 12; // target bump radius in user units

  ctx.beginPath();
  const len = closed ? points.length : points.length - 1;
  for (let i = 0; i < len; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % points.length];
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const edgeLen = Math.sqrt(dx * dx + dy * dy);
    if (edgeLen < 1) continue;

    const numBumps = Math.max(1, Math.round(edgeLen / (TARGET_BUMP * 1.5)));
    const bumpRadius = edgeLen / numBumps / 2;
    const angle = Math.atan2(dy, dx);
    // Normal direction (perpendicular, pointing outward for CW winding)
    const nx = -Math.sin(angle);
    const ny = Math.cos(angle);

    for (let j = 0; j < numBumps; j++) {
      const t = (j + 0.5) / numBumps;
      const cx = p1.x + dx * t;
      const cy = p1.y + dy * t;
      // Arc center offset outward
      const arcCx = cx + nx * 0;
      const arcCy = cy + ny * 0;
      // Start and end angles for the arc (perpendicular to edge, sweeping outward)
      const startAngle = angle + Math.PI;
      const endAngle = angle;
      ctx.arc(arcCx, arcCy, bumpRadius, startAngle, endAngle, false);
    }
  }
  if (closed) ctx.closePath();
}

// Compute the minimum height needed for textbox content (same word-wrap logic as drawTextboxContent)
export function computeTextboxContentHeight(annotation) {
  if (!annotation.text) return annotation.height || 50;

  const width = annotation.width || 150;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || 1.0;
  const lineHeight = fontSize * lineSpacing;
  const padding = (annotation.lineWidth ?? 1) + 2;
  const maxWidth = width - padding * 2;

  const fontFamily = annotation.fontFamily || 'Arial';
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  const font = `${fontStyle}${fontSize}px ${fontFamily}`;

  // Use offscreen canvas for text measurement
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = font;

  const paragraphs = annotation.text.split('\n');
  let totalLines = 0;

  for (const para of paragraphs) {
    if (!para) {
      // Empty line counts as one line
      totalLines++;
      continue;
    }
    const words = para.split(' ');
    let line = '';
    let paraLines = 0;

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && i > 0) {
        paraLines++;
        line = words[i] + ' ';
      } else {
        line = testLine;
      }
    }
    if (line.trim()) paraLines++;
    totalLines += paraLines;
  }

  return padding * 2 + totalLines * lineHeight;
}

// Draw textbox content with word wrap
export function drawTextboxContent(ctx, annotation, padding) {
  if (!annotation.text) return;

  const width = annotation.width || 150;
  const height = annotation.height || 50;
  const fontSize = annotation.fontSize || 14;
  const lineSpacing = annotation.lineSpacing || 1.0;
  const lineHeight = fontSize * lineSpacing;
  // Use same padding as the textarea editor: borderWidth + 2
  if (padding === undefined) padding = (annotation.lineWidth ?? 1) + 2;

  // Build font string with style options
  const fontFamily = annotation.fontFamily || 'Arial';
  const fontStyle = (annotation.fontItalic ? 'italic ' : '') + (annotation.fontBold ? 'bold ' : '');
  ctx.fillStyle = annotation.textColor || annotation.color || '#000000';
  ctx.font = `${fontStyle}${fontSize}px ${fontFamily}`;
  ctx.textBaseline = 'top';

  // Get text alignment
  const textAlign = annotation.textAlign || 'left';
  const maxWidth = width - padding * 2;

  // Word wrap text with newline support
  // Line spacing only applies below text, not above first line
  const paragraphs = annotation.text.split('\n');
  let y = annotation.y + padding;

  for (let p = 0; p < paragraphs.length; p++) {
    if (y >= annotation.y + height) break;

    // Empty line: just advance y
    if (!paragraphs[p]) {
      y += lineHeight;
      continue;
    }

    const words = paragraphs[p].split(' ');
    let line = '';

    for (let i = 0; i < words.length; i++) {
      const testLine = line + words[i] + ' ';
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && i > 0) {
        // Calculate x position based on alignment
        let textX = annotation.x + padding;
        const lineWidth = ctx.measureText(line.trim()).width;
        if (textAlign === 'center') {
          textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
        } else if (textAlign === 'right') {
          textX = annotation.x + width - padding - lineWidth;
        }

        ctx.fillText(line.trim(), textX, y);

        // Draw underline if enabled
        if (annotation.fontUnderline) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize + 1);
          ctx.lineTo(textX + lineWidth, y + fontSize + 1);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        // Draw strikethrough if enabled
        if (annotation.fontStrikethrough) {
          ctx.beginPath();
          ctx.moveTo(textX, y + fontSize * 0.6);
          ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        line = words[i] + ' ';
        y += lineHeight;
        if (y >= annotation.y + height) break;
      } else {
        line = testLine;
      }
    }
    if (y < annotation.y + height && line.trim()) {
      // Calculate x position based on alignment
      let textX = annotation.x + padding;
      const lineWidth = ctx.measureText(line.trim()).width;
      if (textAlign === 'center') {
        textX = annotation.x + padding + (maxWidth - lineWidth) / 2;
      } else if (textAlign === 'right') {
        textX = annotation.x + width - padding - lineWidth;
      }

      ctx.fillText(line.trim(), textX, y);

      // Draw underline if enabled
      if (annotation.fontUnderline) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize + 1);
        ctx.lineTo(textX + lineWidth, y + fontSize + 1);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw strikethrough if enabled
      if (annotation.fontStrikethrough) {
        ctx.beginPath();
        ctx.moveTo(textX, y + fontSize * 0.6);
        ctx.lineTo(textX + lineWidth, y + fontSize * 0.6);
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      y += lineHeight;
    }
  }
  ctx.textBaseline = 'alphabetic'; // Reset
}
