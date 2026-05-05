// Parametric north arrow — compass with rotatable bearing
export const northTemplate = {
  id: 'north',
  name: 'Noordpijl',
  nameEn: 'North arrow',
  category: 'NEN1414',
  defaultSize: { width: 80, height: 80 },
  params: [
    { key: 'bearing', label: 'Hoek (°)', labelEn: 'Bearing (°)', type: 'number', default: 0, min: 0, max: 359, step: 1, unit: '°' },
    { key: 'showCircle', label: 'Toon cirkel', labelEn: 'Show circle', type: 'boolean', default: true },
    { key: 'showLabel', label: 'Toon N', labelEn: 'Show N label', type: 'boolean', default: true },
  ],
  render(params, bbox) {
    const cmds = [];
    const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const r = Math.min(w, h) / 2 * 0.92;
    if (params.showCircle) {
      cmds.push({ kind: 'circle', cx, cy, r });
    }
    // Bearing: 0° = North = up. Convert to canvas angle (y-down): angle = -PI/2 + bearing*PI/180
    const bearingRad = (Number(params.bearing) || 0) * Math.PI / 180;
    // Tip up (in canvas y-down: -y direction is up)
    const tipDirX = Math.sin(bearingRad);
    const tipDirY = -Math.cos(bearingRad);
    const tipX = cx + tipDirX * r;
    const tipY = cy + tipDirY * r;
    // Tail in opposite direction, shorter
    const tailX = cx - tipDirX * r * 0.5;
    const tailY = cy - tipDirY * r * 0.5;
    // Perpendicular for arrow base width
    const perpX = -tipDirY;
    const perpY = tipDirX;
    const baseW = r * 0.25;
    const baseLX = cx + perpX * baseW;
    const baseLY = cy + perpY * baseW;
    const baseRX = cx - perpX * baseW;
    const baseRY = cy - perpY * baseW;
    // Filled triangle for the arrow head: tip -> baseL -> tail -> baseR -> close
    cmds.push({ kind: 'polyline', points: [
      { x: tipX, y: tipY },
      { x: baseLX, y: baseLY },
      { x: tailX, y: tailY },
      { x: baseRX, y: baseRY },
      { x: tipX, y: tipY }
    ], close: true, fill: true });
    if (params.showLabel) {
      // 'N' label outside the tip
      const labelX = cx + tipDirX * (r + 6);
      const labelY = cy + tipDirY * (r + 6);
      cmds.push({ kind: 'text', x: labelX, y: labelY, text: 'N', size: Math.max(10, r * 0.35) });
    }
    return cmds;
  }
};
