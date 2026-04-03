import { state, getActiveDocument, getPageRotation } from '../core/state.js';
import { getCanvasDPR } from './renderer.js';

const TILE_SIZE = 512; // CSS pixels per tile
const MAX_CACHED_TILES = 80;

// LRU tile cache: key = `${pageNum}_${scale}_${col}_${row}`, value = { canvas, lastUsed }
const _tileCache = new Map();

// Active render tasks for cancellation: key -> pdf.js RenderTask
let _activeTileRenders = new Map();

/**
 * Build a tile cache key string.
 */
function tileKey(pageNum, scale, col, row) {
  return `${pageNum}_${scale}_${col}_${row}`;
}

/**
 * Calculate the full tile grid dimensions for a page at a given scale/rotation.
 * Returns { cols, rows, fullWidth, fullHeight } where fullWidth/fullHeight are
 * the CSS-pixel dimensions of the rendered page.
 */
function getTileGrid(fullViewport) {
  const fullWidth = fullViewport.width;
  const fullHeight = fullViewport.height;
  const cols = Math.ceil(fullWidth / TILE_SIZE);
  const rows = Math.ceil(fullHeight / TILE_SIZE);
  return { cols, rows, fullWidth, fullHeight };
}

/**
 * Build viewport options that account for the page's extra rotation.
 */
function buildViewportOpts(page, scale, pageNum) {
  const opts = { scale };
  const extraRotation = getPageRotation(pageNum);
  if (extraRotation) {
    opts.rotation = (page.rotate + extraRotation) % 360;
  }
  return opts;
}

/**
 * Determine which tiles overlap with the currently visible scroll area.
 *
 * @param {number} pageNum - 1-based page number
 * @param {number} scale - current zoom scale
 * @param {HTMLElement} scrollContainer - the scrollable parent element
 * @param {HTMLElement} pageElement - the element that represents the page (positioned inside scrollContainer)
 * @returns {Array<{col: number, row: number, x: number, y: number, width: number, height: number}>}
 *          Each entry describes a tile's position and CSS-pixel size within the page.
 */
export function getVisibleTiles(pageNum, scale, scrollContainer, pageElement) {
  if (!scrollContainer || !pageElement) return [];

  const doc = getActiveDocument();
  if (!doc || !doc.pdfDoc) return [];

  // Determine the visible rectangle in page-local coordinates
  const containerRect = scrollContainer.getBoundingClientRect();
  const pageRect = pageElement.getBoundingClientRect();

  // Visible area in page-local CSS pixels
  const visLeft = Math.max(0, containerRect.left - pageRect.left);
  const visTop = Math.max(0, containerRect.top - pageRect.top);
  const visRight = Math.min(pageRect.width, containerRect.right - pageRect.left);
  const visBottom = Math.min(pageRect.height, containerRect.bottom - pageRect.top);

  if (visRight <= visLeft || visBottom <= visTop) return []; // page not in view

  // Convert to tile grid coordinates
  const minCol = Math.max(0, Math.floor(visLeft / TILE_SIZE));
  const minRow = Math.max(0, Math.floor(visTop / TILE_SIZE));
  const maxCol = Math.floor(visRight / TILE_SIZE);
  const maxRow = Math.floor(visBottom / TILE_SIZE);

  // We also need the full page dimensions to clamp tile sizes at the edges
  const fullWidth = pageRect.width;
  const fullHeight = pageRect.height;

  const tiles = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      const width = Math.min(TILE_SIZE, fullWidth - x);
      const height = Math.min(TILE_SIZE, fullHeight - y);
      if (width > 0 && height > 0) {
        tiles.push({ col, row, x, y, width, height });
      }
    }
  }
  return tiles;
}

/**
 * Render a single tile of a PDF page.
 *
 * Uses PDF.js viewport offsetX/offsetY to shift the rendering origin so that
 * only the tile's portion of the page is drawn onto the small tile canvas.
 *
 * @param {PDFDocumentProxy} pdfDoc - the PDF.js document
 * @param {number} pageNum - 1-based page number
 * @param {number} scale - zoom scale
 * @param {number} col - tile column index (0-based)
 * @param {number} row - tile row index (0-based)
 * @returns {Promise<HTMLCanvasElement|null>} the rendered tile canvas, or null if cancelled/empty
 */
export async function renderTile(pdfDoc, pageNum, scale, col, row) {
  const key = tileKey(pageNum, scale, col, row);

  // Return cached tile if available (update LRU timestamp)
  if (_tileCache.has(key)) {
    _tileCache.get(key).lastUsed = Date.now();
    return _tileCache.get(key).canvas;
  }

  let page;
  try {
    page = await pdfDoc.getPage(pageNum);
  } catch (e) {
    console.warn(`[tile-renderer] Failed to get page ${pageNum}:`, e);
    return null;
  }

  const vpOpts = buildViewportOpts(page, scale, pageNum);
  const fullViewport = page.getViewport(vpOpts);

  const dpr = getCanvasDPR();
  const tileX = col * TILE_SIZE;
  const tileY = row * TILE_SIZE;
  const tileW = Math.min(TILE_SIZE, fullViewport.width - tileX);
  const tileH = Math.min(TILE_SIZE, fullViewport.height - tileY);

  // Skip tiles that fall entirely outside the page bounds
  if (tileW <= 0 || tileH <= 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(tileW * dpr);
  canvas.height = Math.ceil(tileH * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Create a viewport shifted so the tile region maps to (0,0) on the canvas.
  // The offsetX/offsetY values are applied in device pixels (after the DPR scale)
  // so we multiply by dpr to compensate for the transform below.
  const tileViewport = page.getViewport({
    scale: scale * dpr,
    rotation: vpOpts.rotation || 0,
    offsetX: -tileX * dpr,
    offsetY: -tileY * dpr,
  });

  const renderTask = page.render({
    canvasContext: ctx,
    viewport: tileViewport,
    annotationMode: 0,
  });

  _activeTileRenders.set(key, renderTask);

  try {
    await renderTask.promise;
  } catch (e) {
    if (e.name === 'RenderingCancelledException' || e.message === 'Rendering cancelled') {
      return null;
    }
    console.warn(`[tile-renderer] Render failed for tile ${key}:`, e);
    return null;
  } finally {
    _activeTileRenders.delete(key);
  }

  // Evict oldest tiles before inserting the new one
  evictTiles();

  _tileCache.set(key, { canvas, lastUsed: Date.now() });
  return canvas;
}

/**
 * Render all visible tiles for a page and compose them onto a target canvas.
 *
 * @param {PDFDocumentProxy} pdfDoc - the PDF.js document
 * @param {number} pageNum - 1-based page number
 * @param {number} scale - zoom scale
 * @param {HTMLElement} scrollContainer - the scrollable parent element
 * @param {HTMLCanvasElement} pageCanvas - the full-page canvas to draw tiles onto
 * @returns {Promise<void>}
 */
export async function renderVisibleTiles(pdfDoc, pageNum, scale, scrollContainer, pageCanvas) {
  if (!pdfDoc || !pageCanvas) return;

  const pageElement = pageCanvas.parentElement;
  if (!pageElement) return;

  const tiles = getVisibleTiles(pageNum, scale, scrollContainer, pageElement);
  if (tiles.length === 0) return;

  const dpr = getCanvasDPR();

  // Render all visible tiles in parallel
  const renderPromises = tiles.map(async (tile) => {
    const canvas = await renderTile(pdfDoc, pageNum, scale, tile.col, tile.row);
    return { tile, canvas };
  });

  const results = await Promise.allSettled(renderPromises);

  // Compose all successfully rendered tiles onto the target canvas
  const ctx = pageCanvas.getContext('2d');
  if (!ctx) return;

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { tile, canvas } = result.value;
    if (!canvas) continue;

    // Draw the tile at its correct position on the full-page canvas
    // Both source (tile) and destination (pageCanvas) are in device pixels
    ctx.drawImage(
      canvas,
      0, 0, canvas.width, canvas.height,
      Math.floor(tile.x * dpr), Math.floor(tile.y * dpr),
      canvas.width, canvas.height
    );
  }
}

/**
 * Cancel all in-progress tile render tasks.
 */
export function cancelAllTileRenders() {
  for (const [, task] of _activeTileRenders) {
    try {
      task.cancel();
    } catch {
      // RenderTask.cancel() can throw if already finished
    }
  }
  _activeTileRenders.clear();
}

/**
 * Remove all cached tiles that do NOT match the given scale.
 * Useful when the zoom level changes and old-scale tiles are no longer relevant.
 *
 * @param {number} exceptScale - the scale to keep
 */
export function invalidateTilesForScale(exceptScale) {
  const keysToRemove = [];
  for (const [key] of _tileCache) {
    // Key format: `${pageNum}_${scale}_${col}_${row}`
    const parts = key.split('_');
    const tileScale = parseFloat(parts[1]);
    if (tileScale !== exceptScale) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    _tileCache.delete(key);
  }
}

/**
 * Remove all cached tiles for a specific page (e.g. after annotations change).
 *
 * @param {number} pageNum - 1-based page number
 */
export function invalidateTilesForPage(pageNum) {
  const keysToRemove = [];
  for (const [key] of _tileCache) {
    const parts = key.split('_');
    if (parseInt(parts[0], 10) === pageNum) {
      keysToRemove.push(key);
    }
  }
  for (const key of keysToRemove) {
    _tileCache.delete(key);
  }
}

/**
 * Clear the entire tile cache and cancel all active renders.
 */
export function clearTileCache() {
  _tileCache.clear();
  cancelAllTileRenders();
}

/**
 * Get the current number of cached tiles (useful for debugging/diagnostics).
 * @returns {number}
 */
export function getTileCacheSize() {
  return _tileCache.size;
}

/**
 * Evict least-recently-used tiles until the cache is within the size limit.
 */
function evictTiles() {
  while (_tileCache.size >= MAX_CACHED_TILES) {
    let oldestTime = Infinity;
    let oldestKey = null;
    for (const [k, v] of _tileCache) {
      if (v.lastUsed < oldestTime) {
        oldestTime = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) {
      _tileCache.delete(oldestKey);
    } else {
      break; // safety: avoid infinite loop if cache is somehow corrupt
    }
  }
}
