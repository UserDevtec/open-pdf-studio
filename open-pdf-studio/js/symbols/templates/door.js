// Parametric door symbol — opening line + arc swing
// Bbox is the door opening; geometry drawn within the bbox.
// Coords: app coords (top-left origin, y-down).
export const doorTemplate = {
  id: 'door',
  name: 'Deur',
  nameEn: 'Door',
  category: 'NEN1414',
  defaultSize: { width: 90, height: 90 }, // square bbox by default
  params: [
    { key: 'width', label: 'Breedte (mm)', labelEn: 'Width (mm)', type: 'number', default: 900, min: 100, max: 4000, step: 50, unit: 'mm' },
    { key: 'swing', label: 'Draairichting', labelEn: 'Swing', type: 'enum', options: [
        { value: 'left', label: 'Links' },
        { value: 'right', label: 'Rechts' }
      ], default: 'left' },
    { key: 'angle', label: 'Openingshoek', labelEn: 'Opening angle', type: 'number', default: 90, min: 5, max: 180, step: 5, unit: '°' },
    { key: 'showWall', label: 'Toon muur', labelEn: 'Show wall', type: 'boolean', default: false },
  ],
  // Returns array of draw commands. bbox: {x,y,width,height}
  render(params, bbox) {
    const cmds = [];
    const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
    const swing = params.swing || 'left';
    const angleDeg = Math.max(1, Math.min(180, Number(params.angle) || 90));
    // Hinge at bottom-left for 'left' swing, bottom-right for 'right'
    const hingeX = swing === 'left' ? x : x + w;
    const hingeY = y + h;
    const r = Math.min(w, h);
    // Door leaf line: from hinge at angle (0 = along bottom, 90 = vertical up)
    // For 'left' swing: angle measured from positive X axis going CCW (up).
    // For 'right' swing: mirror — angle from negative X axis going CW (up).
    const rad = angleDeg * Math.PI / 180;
    let leafEndX, leafEndY;
    if (swing === 'left') {
      leafEndX = hingeX + r * Math.cos(rad);
      leafEndY = hingeY - r * Math.sin(rad);
    } else {
      leafEndX = hingeX - r * Math.cos(rad);
      leafEndY = hingeY - r * Math.sin(rad);
    }
    // Door leaf
    cmds.push({ kind: 'line', x1: hingeX, y1: hingeY, x2: leafEndX, y2: leafEndY });
    // Swing arc (from leaf end back to fully closed position along the wall)
    // Canvas2D arc angles are in standard math but with y flipped (CW positive).
    // We'll draw: arc center=hinge, radius=r,
    // For 'left': start at angle = -rad (canvas uses y-down), end at 0 (along +x).
    // For 'right': start at angle = PI + rad, end at PI.
    let a0, a1, ccw;
    if (swing === 'left') {
      a0 = -rad; a1 = 0; ccw = false;
    } else {
      a0 = Math.PI + rad; a1 = Math.PI; ccw = true;
    }
    cmds.push({ kind: 'arc', cx: hingeX, cy: hingeY, r, a0, a1, ccw });
    // Optional wall line at top of bbox indicating opening
    if (params.showWall) {
      cmds.push({ kind: 'line', x1: x, y1: hingeY, x2: x + w, y2: hingeY, dash: [6, 3] });
    }
    return cmds;
  }
};
