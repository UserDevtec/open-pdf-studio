import { createSignal } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

// DOM ref for the thumbnails container element (set by ThumbnailsPanel.jsx)
let containerRef = null;

export function setContainerRef(el) {
  containerRef = el;
}

export function getContainerRef() {
  return containerRef;
}

const [pageCount, setPageCount] = createSignal(0);
const [activePage, setActivePage] = createSignal(1);
const [placeholderSize, setPlaceholderSize] = createSignal({ width: 150, height: 212 });

// Map of pageNum -> dataURL for rendered thumbnails
const [thumbnailData, setThumbnailData] = createStore({});

// Drag state
const [draggedPage, setDraggedPage] = createSignal(null);
const [dropTarget, setDropTarget] = createSignal(null); // { page, position: 'before'|'after' }

// Multi-page selection state
const [selectedPages, setSelectedPages] = createSignal(new Set());
const [lastClickedPage, setLastClickedPage] = createSignal(1);

export function selectPage(pageNum) {
  setSelectedPages(new Set([pageNum]));
  setLastClickedPage(pageNum);
}

export function togglePageSelection(pageNum) {
  const current = selectedPages();
  const next = new Set(current);
  if (next.has(pageNum)) {
    if (next.size > 1) next.delete(pageNum);
  } else {
    next.add(pageNum);
  }
  setSelectedPages(next);
  setLastClickedPage(pageNum);
}

export function selectPageRange(toPage, additive) {
  const from = lastClickedPage();
  const lo = Math.min(from, toPage);
  const hi = Math.max(from, toPage);
  const range = new Set();
  for (let i = lo; i <= hi; i++) range.add(i);
  if (additive) {
    const current = selectedPages();
    for (const p of current) range.add(p);
  }
  setSelectedPages(range);
}

export function selectAllPages() {
  const count = pageCount();
  const all = new Set();
  for (let i = 1; i <= count; i++) all.add(i);
  setSelectedPages(all);
}

export function clearPageSelection() {
  const active = activePage();
  setSelectedPages(new Set(active ? [active] : []));
}

export function isPageSelected(pageNum) {
  return selectedPages().has(pageNum);
}

export function getSelectedPagesArray() {
  return [...selectedPages()].sort((a, b) => a - b);
}

export function formatPageRangeString(pages) {
  if (!pages || pages.length === 0) return '';
  const sorted = [...pages].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push(start === end ? String(start) : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(', ');
}

export function setThumbnailImage(pageNum, imageData) {
  setThumbnailData(String(pageNum), imageData);
}

export function clearAllThumbnails() {
  setThumbnailData(reconcile({}));
  setPageCount(0);
  setSelectedPages(new Set());
  setLastClickedPage(1);
}

export function removeThumbnailImage(pageNum) {
  setThumbnailData(String(pageNum), undefined);
}

export {
  pageCount, setPageCount,
  activePage, setActivePage,
  placeholderSize, setPlaceholderSize,
  thumbnailData,
  draggedPage, setDraggedPage,
  dropTarget, setDropTarget,
  selectedPages
};
