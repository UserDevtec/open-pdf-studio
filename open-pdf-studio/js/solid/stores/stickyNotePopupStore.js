import { createStore, produce } from 'solid-js/store';
import { recordModify } from '../../core/undo-manager.js';
import { cloneAnnotation } from '../../annotations/factory.js';

// Store: array of open popup entries
// Each entry: { annotationId, annotation, textSnapshot }
const [popups, setPopups] = createStore([]);

export function openStickyPopup(annotation) {
  if (!annotation) return;

  // Don't open duplicate
  const existing = popups.find(p => p.annotationId === annotation.id);
  if (existing) return;

  annotation.popupOpen = true;

  setPopups(produce(list => {
    list.push({
      annotationId: annotation.id,
      annotation,
      textSnapshot: annotation.text || ''
    });
  }));
}

export function closeStickyPopup(annotationId) {
  const entry = popups.find(p => p.annotationId === annotationId);
  if (!entry) return;

  const ann = entry.annotation;
  ann.popupOpen = false;

  // Record undo if text changed
  if (ann.text !== entry.textSnapshot) {
    const oldClone = cloneAnnotation(ann);
    oldClone.text = entry.textSnapshot;
    recordModify(ann.id, oldClone, ann);
  }

  setPopups(produce(list => {
    const idx = list.findIndex(p => p.annotationId === annotationId);
    if (idx !== -1) list.splice(idx, 1);
  }));
}

export function updatePopupText(annotationId, text) {
  const entry = popups.find(p => p.annotationId === annotationId);
  if (!entry) return;
  entry.annotation.text = text;
  entry.annotation.modifiedAt = new Date().toISOString();
}

export function updatePopupPosition(annotationId, x, y) {
  const entry = popups.find(p => p.annotationId === annotationId);
  if (!entry) return;
  entry.annotation.popupX = x;
  entry.annotation.popupY = y;
}

export function closeAllPopups() {
  // Close each popup, recording undo for changed text
  for (const entry of [...popups]) {
    closeStickyPopup(entry.annotationId);
  }
}

export function getOpenPopups() {
  return popups;
}
