import { state } from '../core/state.js';
import { createAnnotation } from './factory.js';
import { recordAdd } from '../core/undo-manager.js';
import { showProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../bridge.js';

// Built-in stamp definitions
export const BUILT_IN_STAMPS = [
  { name: 'Approved', color: '#22c55e', text: 'APPROVED' },
  { name: 'Rejected', color: '#ef4444', text: 'REJECTED' },
  { name: 'Draft', color: '#3b82f6', text: 'DRAFT' },
  { name: 'Confidential', color: '#ef4444', text: 'CONFIDENTIAL' },
  { name: 'Final', color: '#22c55e', text: 'FINAL' },
  { name: 'For Review', color: '#f59e0b', text: 'FOR REVIEW' },
  { name: 'Not Approved', color: '#ef4444', text: 'NOT APPROVED' },
  { name: 'Void', color: '#6b7280', text: 'VOID' },
  { name: 'As Is', color: '#6b7280', text: 'AS IS' },
  { name: 'Revised', color: '#8b5cf6', text: 'REVISED' }
];

// Show stamp picker dialog
export function showStampPicker(x, y) {
  openDialog('stamp-picker', {
    onSelect: (stamp) => placeStamp(stamp, x, y),
    onCustom: () => loadCustomStamp(x, y)
  });
}

// Place a built-in stamp
function placeStamp(stamp, x, y) {
  if (!state.pdfDoc) return;

  const width = 160;
  const height = 50;

  const ann = createAnnotation({
    type: 'stamp',
    page: state.currentPage,
    x: x - width / 2,
    y: y - height / 2,
    width: width,
    height: height,
    stampName: stamp.name,
    stampText: stamp.text,
    stampColor: stamp.color,
    color: stamp.color,
    strokeColor: stamp.color,
    opacity: 0.85,
    rotation: 0
  });

  state.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    state.selectedAnnotation = ann;
    showProperties(ann);
  }

  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`Stamp "${stamp.name}" placed`);
}

// Rasterize an SVG string to a PNG data URL for PDF embedding
function rasterizeSvg(svgString) {
  return new Promise((resolve) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 3;
      canvas.width = img.naturalWidth * scale;
      canvas.height = img.naturalHeight * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve({ img, dataUrl: canvas.toDataURL('image/png') });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

// Place a preconfigured image stamp from tool overrides (used by extensions).
// Supports stampSvg (SVG string) or stampImage (data URL) in state.toolOverrides.
export async function placeOverrideStamp(x, y) {
  if (!state.pdfDoc) return;

  const overrides = state.toolOverrides;
  if (!overrides?.stampSvg && !overrides?.stampImage) {
    updateStatusMessage('No stamp data provided');
    return;
  }

  let img, dataUrl;

  if (overrides.stampSvg) {
    const result = await rasterizeSvg(overrides.stampSvg);
    if (!result) {
      updateStatusMessage('Failed to render stamp SVG');
      return;
    }
    img = result.img;
    dataUrl = result.dataUrl;
  } else {
    // stampImage is already a data URL (PNG/JPG)
    img = new Image();
    img.src = overrides.stampImage;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    dataUrl = overrides.stampImage;
  }

  const aspect = img.naturalWidth / img.naturalHeight;
  const stampHeight = overrides.stampHeight || 80;
  const stampWidth = overrides.stampWidth || Math.round(stampHeight * aspect);

  const imageId = 'stamp_' + Date.now();
  state.imageCache.set(imageId, img);

  const ann = createAnnotation({
    type: 'stamp',
    page: state.currentPage,
    x: x - stampWidth / 2,
    y: y - stampHeight / 2,
    width: stampWidth,
    height: stampHeight,
    stampName: overrides.stampName || 'Custom',
    stampText: '',
    imageId: imageId,
    imageData: dataUrl,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    color: '#000000',
    opacity: 1,
    rotation: 0,
    lockAspectRatio: overrides.lockAspectRatio !== false
  });

  state.annotations.push(ann);
  recordAdd(ann);

  if (state.preferences.autoSelectAfterCreate) {
    state.selectedAnnotation = ann;
    showProperties(ann);
  }

  if (state.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();

  updateStatusMessage(`${overrides.stampName || 'Stamp'} placed`);
}

// Load custom stamp from image file
async function loadCustomStamp(x, y) {
  try {
    const { openFileDialog } = await import('../core/platform.js');
    const filePath = await openFileDialog(['png', 'jpg', 'jpeg', 'bmp', 'gif', 'svg']);
    if (!filePath) return;

    const { readBinaryFile } = await import('../core/platform.js');
    const data = await readBinaryFile(filePath);
    const blob = new Blob([data]);
    const url = URL.createObjectURL(blob);

    const img = new Image();
    img.src = url;
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

    const { generateImageId } = await import('../utils/helpers.js');
    const imageId = generateImageId();
    state.imageCache.set(imageId, img);

    let width = img.naturalWidth;
    let height = img.naturalHeight;
    const maxSize = 200;
    if (width > maxSize || height > maxSize) {
      const ratio = Math.min(maxSize / width, maxSize / height);
      width *= ratio;
      height *= ratio;
    }

    const ann = createAnnotation({
      type: 'stamp',
      page: state.currentPage,
      x: x - width / 2,
      y: y - height / 2,
      width: width,
      height: height,
      stampName: 'Custom',
      stampText: '',
      imageId: imageId,
      imageData: url,
      originalWidth: img.naturalWidth,
      originalHeight: img.naturalHeight,
      color: '#000000',
      opacity: 1,
      rotation: 0
    });

    state.annotations.push(ann);
    recordAdd(ann);

    if (state.preferences.autoSelectAfterCreate) {
      state.selectedAnnotation = ann;
      showProperties(ann);
    }

    if (state.viewMode === 'continuous') {
      redrawContinuous();
    } else {
      redrawAnnotations();
    }

    updateStatusMessage('Custom stamp placed');
  } catch (err) {
    console.error('Failed to load custom stamp:', err);
  }
}
