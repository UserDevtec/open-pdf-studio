// Canvas-drawable icon paths for sticky note / comment annotation icons.
// Each icon is drawn within a `size x size` box at (x, y).

function darken(hex, amount = 0.3) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = 1 - amount;
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

function drawComment(ctx, x, y, s, fill) {
  // Speech bubble
  const w = s * 0.85, h = s * 0.65;
  const bx = x + (s - w) / 2, by = y + s * 0.1;
  const r = s * 0.08;

  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  ctx.lineTo(bx + w - r, by);
  ctx.arcTo(bx + w, by, bx + w, by + r, r);
  ctx.lineTo(bx + w, by + h - r);
  ctx.arcTo(bx + w, by + h, bx + w - r, by + h, r);
  // Tail
  ctx.lineTo(bx + w * 0.4, by + h);
  ctx.lineTo(bx + w * 0.15, by + h + s * 0.18);
  ctx.lineTo(bx + w * 0.25, by + h);
  ctx.lineTo(bx + r, by + h);
  ctx.arcTo(bx, by + h, bx, by + h - r, r);
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();

  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Lines inside
  ctx.strokeStyle = darken(fill, 0.5);
  ctx.lineWidth = 0.8;
  const lx = bx + w * 0.2, rx = bx + w * 0.8;
  for (let i = 0; i < 3; i++) {
    const ly = by + h * 0.25 + i * h * 0.22;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(rx - (i === 2 ? w * 0.2 : 0), ly);
    ctx.stroke();
  }
}

function drawNote(ctx, x, y, s, fill) {
  // Page with folded corner
  const m = s * 0.1;
  const fold = s * 0.25;
  const px = x + m, py = y + m;
  const pw = s - 2 * m, ph = s - 2 * m;

  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + pw - fold, py);
  ctx.lineTo(px + pw, py + fold);
  ctx.lineTo(px + pw, py + ph);
  ctx.lineTo(px, py + ph);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Fold triangle
  ctx.beginPath();
  ctx.moveTo(px + pw - fold, py);
  ctx.lineTo(px + pw - fold, py + fold);
  ctx.lineTo(px + pw, py + fold);
  ctx.closePath();
  ctx.fillStyle = darken(fill, 0.15);
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.stroke();

  // Lines
  ctx.strokeStyle = darken(fill, 0.5);
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    const ly = py + ph * 0.25 + i * ph * 0.15;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.15, ly);
    ctx.lineTo(px + pw * 0.75 - (i === 0 ? fold * 0.5 : 0), ly);
    ctx.stroke();
  }
}

function drawHelp(ctx, x, y, s, fill) {
  // Question mark in circle
  const cx = x + s / 2, cy = y + s / 2, r = s * 0.42;

  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Question mark
  ctx.fillStyle = darken(fill, 0.6);
  ctx.font = `bold ${s * 0.45}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', cx, cy + s * 0.02);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawInsert(ctx, x, y, s, fill) {
  // Caret / insertion marker (upward pointing)
  const cx = x + s / 2, bot = y + s * 0.8, top = y + s * 0.2;
  const hw = s * 0.3;

  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + hw, bot);
  ctx.lineTo(cx, bot - s * 0.15);
  ctx.lineTo(cx - hw, bot);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawKey(ctx, x, y, s, fill) {
  // Key shape
  const cx = x + s * 0.35, cy = y + s * 0.35, r = s * 0.22;

  // Key head (circle)
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();

  // Key hole
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = darken(fill, 0.15);
  ctx.fill();

  // Key shaft
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = s * 0.08;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + r * 0.7, cy + r * 0.7);
  ctx.lineTo(x + s * 0.8, y + s * 0.8);
  ctx.stroke();

  // Key teeth
  ctx.lineWidth = s * 0.06;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.65, y + s * 0.72);
  ctx.lineTo(x + s * 0.72, y + s * 0.79);
  ctx.moveTo(x + s * 0.72, y + s * 0.65);
  ctx.lineTo(x + s * 0.79, y + s * 0.72);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawNewParagraph(ctx, x, y, s, fill) {
  // Pilcrow with arrow
  ctx.fillStyle = fill;
  ctx.strokeStyle = darken(fill);

  // Pilcrow
  ctx.font = `bold ${s * 0.55}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u00B6', x + s * 0.4, y + s * 0.4);

  // Down-right arrow
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + s * 0.45, y + s * 0.65);
  ctx.lineTo(x + s * 0.45, y + s * 0.85);
  ctx.lineTo(x + s * 0.75, y + s * 0.85);
  ctx.stroke();
  // Arrowhead
  ctx.beginPath();
  ctx.moveTo(x + s * 0.75, y + s * 0.85);
  ctx.lineTo(x + s * 0.65, y + s * 0.78);
  ctx.moveTo(x + s * 0.75, y + s * 0.85);
  ctx.lineTo(x + s * 0.65, y + s * 0.92);
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawParagraph(ctx, x, y, s, fill) {
  // Pilcrow symbol
  const cx = x + s / 2, cy = y + s / 2;

  ctx.beginPath();
  ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = darken(fill, 0.6);
  ctx.font = `bold ${s * 0.5}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u00B6', cx, cy + s * 0.02);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawCheck(ctx, x, y, s, fill) {
  // Checkmark
  ctx.strokeStyle = fill;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x + s * 0.15, y + s * 0.5);
  ctx.lineTo(x + s * 0.4, y + s * 0.75);
  ctx.lineTo(x + s * 0.85, y + s * 0.2);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

function drawCircle(ctx, x, y, s, fill) {
  // Filled circle
  const cx = x + s / 2, cy = y + s / 2, r = s * 0.38;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawCross(ctx, x, y, s, fill) {
  // X mark
  const m = s * 0.2;
  ctx.strokeStyle = fill;
  ctx.lineWidth = s * 0.12;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + m, y + m);
  ctx.lineTo(x + s - m, y + s - m);
  ctx.moveTo(x + s - m, y + m);
  ctx.lineTo(x + m, y + s - m);
  ctx.stroke();
  ctx.lineCap = 'butt';
}

function drawStar(ctx, x, y, s, fill) {
  // Five-pointed star
  const cx = x + s / 2, cy = y + s / 2;
  const outerR = s * 0.42, innerR = s * 0.18;
  const points = 5;

  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (i * Math.PI / points) - Math.PI / 2;
    const px = cx + r * Math.cos(angle);
    const py = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = darken(fill);
  ctx.lineWidth = 1;
  ctx.stroke();
}

const ICON_DRAWERS = {
  comment: drawComment,
  note: drawNote,
  help: drawHelp,
  insert: drawInsert,
  key: drawKey,
  newparagraph: drawNewParagraph,
  paragraph: drawParagraph,
  check: drawCheck,
  circle: drawCircle,
  cross: drawCross,
  star: drawStar,
};

/**
 * Draw a comment/sticky-note icon on canvas.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} iconName - one of the known icon names (falls back to 'comment')
 * @param {number} x - top-left x
 * @param {number} y - top-left y
 * @param {number} size - icon bounding box size (width = height)
 * @param {string} fillColor - hex color string
 */
export function drawCommentIcon(ctx, iconName, x, y, size, fillColor) {
  ctx.save();
  const drawer = ICON_DRAWERS[(iconName || 'comment').toLowerCase()] || ICON_DRAWERS.comment;
  drawer(ctx, x, y, size, fillColor || '#FFFF00');
  ctx.restore();
}
