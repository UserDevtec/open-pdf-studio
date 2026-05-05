// Parametric window symbol — double parallel lines representing glass + frame
export const windowTemplate = {
  id: 'window',
  name: 'Raam',
  nameEn: 'Window',
  category: 'NEN1414',
  defaultSize: { width: 120, height: 24 },
  params: [
    { key: 'width', label: 'Breedte (mm)', labelEn: 'Width (mm)', type: 'number', default: 1200, min: 200, max: 6000, step: 100, unit: 'mm' },
    { key: 'wallThickness', label: 'Muurdikte (mm)', labelEn: 'Wall thickness (mm)', type: 'number', default: 240, min: 50, max: 600, step: 10, unit: 'mm' },
    { key: 'type', label: 'Type', labelEn: 'Type', type: 'enum', options: [
        { value: 'fixed', label: 'Vast' },
        { value: 'pivot', label: 'Tuimel' },
        { value: 'tilt', label: 'Klap' }
      ], default: 'fixed' },
  ],
  render(params, bbox) {
    const cmds = [];
    const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
    // Two parallel "frame" lines along the bbox top/bottom
    cmds.push({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y });
    cmds.push({ kind: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h });
    // Two glass lines in the middle (the parallel pair representing glazing)
    const cy = y + h / 2;
    const inset = h * 0.18;
    cmds.push({ kind: 'line', x1: x, y1: cy - inset, x2: x + w, y2: cy - inset });
    cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy + inset });
    // End caps
    cmds.push({ kind: 'line', x1: x, y1: y, x2: x, y2: y + h });
    cmds.push({ kind: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h });
    // Type indicator: small symbol in the centre
    if (params.type === 'pivot') {
      // Diagonal X across centre band
      cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy - inset, x2: x + w / 2 + 6, y2: cy + inset });
      cmds.push({ kind: 'line', x1: x + w / 2 - 6, y1: cy + inset, x2: x + w / 2 + 6, y2: cy - inset });
    } else if (params.type === 'tilt') {
      // Single diagonal indicating tilt
      cmds.push({ kind: 'line', x1: x, y1: cy + inset, x2: x + w, y2: cy - inset, dash: [3, 2] });
    }
    return cmds;
  }
};
