// Compare/Overlay session store.
// Tracks which two PDFs are being compared, the mode, current page-pair and offset.
// Reactive via solid-js signals so UI re-renders when fields change.

import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [oldPath, setOldPath] = createSignal(null);
const [newPath, setNewPath] = createSignal(null);
const [mode, setMode] = createSignal('overlay'); // 'overlay' | 'side'
const [oldPage, setOldPage] = createSignal(1);
const [newPage, setNewPage] = createSignal(1);
const [offset, setOffset] = createSignal({ dx: 0, dy: 0, rotation: 0 });
const [zoom, setZoom] = createSignal(1);
const [changes, setChangesSignal] = createSignal([]);
const [focusedChange, setFocusedChangeSignal] = createSignal(null);
const [showAdded, setShowAdded] = createSignal(true);
const [showRemoved, setShowRemoved] = createSignal(true);
const [showModified, setShowModified] = createSignal(true);

export {
  active as compareActive,
  oldPath as compareOldPath,
  newPath as compareNewPath,
  mode as compareMode,
  oldPage as compareOldPage,
  newPage as compareNewPage,
  offset as compareOffset,
  zoom as compareZoom,
  changes as compareChanges,
  focusedChange as compareFocusedChange,
  showAdded as compareShowAdded,
  showRemoved as compareShowRemoved,
  showModified as compareShowModified,
  setShowAdded as setCompareShowAdded,
  setShowRemoved as setCompareShowRemoved,
  setShowModified as setCompareShowModified,
};

export function setChanges(list) {
  setChangesSignal(Array.isArray(list) ? list : []);
}

export function setFocusedChange(change) {
  setFocusedChangeSignal(change || null);
}

export function startCompare({ oldFilePath, newFilePath, mode: m, oldPage: op = 1, newPage: np = 1 }) {
  setOldPath(oldFilePath);
  setNewPath(newFilePath);
  setMode(m || 'overlay');
  setOldPage(op);
  setNewPage(np);
  setOffset({ dx: 0, dy: 0, rotation: 0 });
  setZoom(1);
  setActive(true);
}

export function exitCompare() {
  setActive(false);
  setOldPath(null);
  setNewPath(null);
}

export function setCompareMode(m) {
  setMode(m);
}

export function nextPagePair() {
  setOldPage(p => p + 1);
  setNewPage(p => p + 1);
}

export function prevPagePair() {
  setOldPage(p => Math.max(1, p - 1));
  setNewPage(p => Math.max(1, p - 1));
}

export function setPagePair(op, np) {
  if (op != null) setOldPage(op);
  if (np != null) setNewPage(np);
}

export function setCompareZoom(z) {
  setZoom(Math.max(0.1, Math.min(8, z)));
}

export function setCompareOffset(o) {
  setOffset({ ...offset(), ...o });
}
