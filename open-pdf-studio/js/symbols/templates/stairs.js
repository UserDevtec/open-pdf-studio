// Parametric stairs symbol — N risers with up-arrow indicating direction
export const stairsTemplate = {
  id: 'stairs',
  name: 'Trap',
  nameEn: 'Stairs',
  category: 'NEN1414',
  defaultSize: { width: 120, height: 200 },
  params: [
    { key: 'steps', label: 'Aantal treden', labelEn: 'Step count', type: 'number', default: 12, min: 2, max: 40, step: 1 },
    { key: 'direction', label: 'Richting', labelEn: 'Direction', type: 'enum', options: [
        { value: 'up', label: 'Omhoog' },
        { value: 'down', label: 'Omlaag' }
      ], default: 'up' },
    { key: 'showOutline', label: 'Toon kader', labelEn: 'Show outline', type: 'boolean', default: true },
  ],
  render(params, bbox) {
    const cmds = [];
    const x = bbox.x, y = bbox.y, w = bbox.width, h = bbox.height;
    const steps = Math.max(2, Math.min(40, Number(params.steps) || 12));
    if (params.showOutline) {
      // Outline rectangle
      cmds.push({ kind: 'line', x1: x, y1: y, x2: x + w, y2: y });
      cmds.push({ kind: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h });
      cmds.push({ kind: 'line', x1: x + w, y1: y + h, x2: x, y2: y + h });
      cmds.push({ kind: 'line', x1: x, y1: y + h, x2: x, y2: y });
    }
    // Risers as horizontal lines
    const stepH = h / steps;
    for (let i = 1; i < steps; i++) {
      const yy = y + i * stepH;
      cmds.push({ kind: 'line', x1: x, y1: yy, x2: x + w, y2: yy });
    }
    // Direction arrow up the centre
    const cx = x + w / 2;
    const aTop = params.direction === 'up' ? y + 6 : y + h - 6;
    const aBot = params.direction === 'up' ? y + h - 6 : y + 6;
    cmds.push({ kind: 'line', x1: cx, y1: aBot, x2: cx, y2: aTop });
    // Arrowhead (always pointing in direction)
    const headLen = 8;
    const headW = 5;
    const dy = Math.sign(aTop - aBot);
    cmds.push({ kind: 'line', x1: cx, y1: aTop, x2: cx - headW, y2: aTop + dy * headLen });
    cmds.push({ kind: 'line', x1: cx, y1: aTop, x2: cx + headW, y2: aTop + dy * headLen });
    return cmds;
  }
};
