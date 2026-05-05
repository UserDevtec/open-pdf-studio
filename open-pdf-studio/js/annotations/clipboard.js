import { state, getActiveDocument, imageCache } from '../core/state.js';
import { cloneAnnotation } from './factory.js';
import { generateImageId } from '../utils/helpers.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { showProperties, showMultiSelectionProperties } from '../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from './rendering.js';
import { annotationCanvas, pdfContainer } from '../ui/dom-elements.js';
import { recordAdd, recordBulkAdd } from '../core/undo-manager.js';

// Copy annotation to internal clipboard
export function copyAnnotation(annotation) {
  state.clipboardAnnotation = cloneAnnotation(annotation);

  // Also copy image data to system clipboard so other apps can paste it
  if ((annotation.type === 'image' || annotation.type === 'signature' || annotation.type === 'stamp') && annotation.imageData) {
    try {
      const img = imageCache.get(annotation.imageId);
      if (img && img.complete) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || annotation.width;
        canvas.height = img.naturalHeight || annotation.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) {
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {});
          }
        }, 'image/png');
      }
    } catch (_) {}
  }

  updateStatusMessage('Annotation copied');
}

// Paste from clipboard (handles both images and annotations)
// Triggers a native paste so the 'paste' event handler in keyboard-handlers.js
// can read clipboardData without requiring the async Clipboard API permission.
export function pasteFromClipboard() {
  if (!getActiveDocument()?.pdfDoc) return;

  // Try triggering a native paste event which the handlePaste listener will pick up.
  // This avoids navigator.clipboard.read() which requires explicit browser permission.
  const didPaste = document.execCommand('paste');

  if (!didPaste) {
    // execCommand('paste') not supported — fall back to internal clipboard
    if (state.clipboardAnnotations && state.clipboardAnnotations.length > 1) {
      pasteAnnotations();
    } else if (state.clipboardAnnotation) {
      pasteAnnotation();
    }
  }
}

// Paste image from blob
export async function pasteImageFromBlob(blob) {
  const imageId = generateImageId();
  const url = URL.createObjectURL(blob);

  // Create image element and wait for it to load
  const img = new Image();
  img.src = url;

  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
  });

  // Convert blob URL to data URL for serialization/saving
  const dataUrl = await new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });

  // Store in cache
  imageCache.set(imageId, img);

  // Calculate position (center of visible area)
  const rect = annotationCanvas.getBoundingClientRect();
  const scrollX = pdfContainer.scrollLeft;
  const scrollY = pdfContainer.scrollTop;

  // Default size (max 400px, maintain aspect ratio)
  let width = img.naturalWidth;
  let height = img.naturalHeight;
  const maxSize = 400;

  if (width > maxSize || height > maxSize) {
    const ratio = Math.min(maxSize / width, maxSize / height);
    width *= ratio;
    height *= ratio;
  }

  const x = scrollX + (rect.width / 2) - (width / 2);
  const y = scrollY + (rect.height / 2) - (height / 2);

  // Create image annotation
  const annotation = {
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 9),
    type: 'image',
    page: getActiveDocument()?.currentPage || 1,
    x: Math.max(10, x),
    y: Math.max(10, y),
    width: width,
    height: height,
    rotation: 0,
    imageId: imageId,
    imageData: dataUrl, // data:image/... URL for PDF embedding
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    lockAspectRatio: true, // images keep their original w:h on resize by default
    opacity: 1,
    locked: false,
    printable: true,
    author: state.defaultAuthor,
    subject: '',
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString()
  };

  const _pasteDoc1 = getActiveDocument();
  if (_pasteDoc1) _pasteDoc1.annotations.push(annotation);
  recordAdd(annotation);
  if (_pasteDoc1) { _pasteDoc1.selectedAnnotation = annotation; _pasteDoc1.selectedAnnotations = [annotation]; }
  showProperties(annotation);

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Image pasted');
}

// Paste annotation from internal clipboard
export function pasteAnnotation() {
  if (!state.clipboardAnnotation || !getActiveDocument()?.pdfDoc) return;

  const newAnnotation = cloneAnnotation(state.clipboardAnnotation);

  // Offset position slightly so it's visible
  if (newAnnotation.x !== undefined) newAnnotation.x += 20;
  if (newAnnotation.y !== undefined) newAnnotation.y += 20;
  if (newAnnotation.startX !== undefined) newAnnotation.startX += 20;
  if (newAnnotation.startY !== undefined) newAnnotation.startY += 20;
  if (newAnnotation.endX !== undefined) newAnnotation.endX += 20;
  if (newAnnotation.endY !== undefined) newAnnotation.endY += 20;
  if (newAnnotation.centerX !== undefined) newAnnotation.centerX += 20;
  if (newAnnotation.centerY !== undefined) newAnnotation.centerY += 20;
  if (newAnnotation.path) {
    newAnnotation.path = newAnnotation.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
  }

  // Update page, id, and timestamps
  newAnnotation.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  newAnnotation.page = getActiveDocument()?.currentPage || 1;
  newAnnotation.createdAt = new Date().toISOString();
  newAnnotation.modifiedAt = new Date().toISOString();

  // For images/signatures, need to copy the cached image
  if (newAnnotation.type === 'image' || newAnnotation.type === 'signature') {
    const newImageId = generateImageId();
    const originalImg = imageCache.get(state.clipboardAnnotation.imageId);
    if (originalImg) {
      imageCache.set(newImageId, originalImg);
    }
    newAnnotation.imageId = newImageId;
  }

  const _pasteDoc2 = getActiveDocument();
  if (_pasteDoc2) _pasteDoc2.annotations.push(newAnnotation);
  recordAdd(newAnnotation);
  if (_pasteDoc2) { _pasteDoc2.selectedAnnotation = newAnnotation; _pasteDoc2.selectedAnnotations = [newAnnotation]; }
  showProperties(newAnnotation);

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage('Annotation pasted');
}

// Duplicate selected annotation
export function duplicateAnnotation() {
  const _dupDoc = getActiveDocument();
  if (!_dupDoc?.selectedAnnotation) return;

  copyAnnotation(_dupDoc.selectedAnnotation);
  pasteAnnotation();
}

// Copy multiple annotations to internal clipboard
export function copyAnnotations(annotations) {
  if (!annotations || annotations.length === 0) return;
  state.clipboardAnnotations = annotations.map(a => cloneAnnotation(a));
  state.clipboardAnnotation = state.clipboardAnnotations[0]; // backward compat
  updateStatusMessage(`${annotations.length} annotations copied`);
}

// Paste multiple annotations from internal clipboard
export function pasteAnnotations() {
  if (!state.clipboardAnnotations || state.clipboardAnnotations.length === 0) {
    if (state.clipboardAnnotation) {
      pasteAnnotation();
      return;
    }
    return;
  }

  const newAnnotations = [];
  for (const source of state.clipboardAnnotations) {
    const newAnn = cloneAnnotation(source);

    // Offset position
    if (newAnn.x !== undefined) newAnn.x += 20;
    if (newAnn.y !== undefined) newAnn.y += 20;
    if (newAnn.startX !== undefined) newAnn.startX += 20;
    if (newAnn.startY !== undefined) newAnn.startY += 20;
    if (newAnn.endX !== undefined) newAnn.endX += 20;
    if (newAnn.endY !== undefined) newAnn.endY += 20;
    if (newAnn.centerX !== undefined) newAnn.centerX += 20;
    if (newAnn.centerY !== undefined) newAnn.centerY += 20;
    if (newAnn.path) {
      newAnn.path = newAnn.path.map(p => ({ x: p.x + 20, y: p.y + 20 }));
    }

    newAnn.id = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    newAnn.page = getActiveDocument()?.currentPage || 1;
    newAnn.createdAt = new Date().toISOString();
    newAnn.modifiedAt = new Date().toISOString();

    if (newAnn.type === 'image' || newAnn.type === 'signature') {
      const newImageId = generateImageId();
      const originalImg = imageCache.get(source.imageId);
      if (originalImg) imageCache.set(newImageId, originalImg);
      newAnn.imageId = newImageId;
    }

    const _pasteDoc3 = getActiveDocument();
    if (_pasteDoc3) _pasteDoc3.annotations.push(newAnn);
    newAnnotations.push(newAnn);
  }

  recordBulkAdd(newAnnotations);
  const _pasteDoc3 = getActiveDocument();
  if (_pasteDoc3) {
    _pasteDoc3.selectedAnnotations = newAnnotations;
    _pasteDoc3.selectedAnnotation = newAnnotations.length > 0 ? newAnnotations[0] : null;
  }

  if (newAnnotations.length === 1) {
    showProperties(newAnnotations[0]);
  } else {
    showMultiSelectionProperties();
  }

  if (getActiveDocument()?.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }

  updateStatusMessage(`${newAnnotations.length} annotations pasted`);
}
