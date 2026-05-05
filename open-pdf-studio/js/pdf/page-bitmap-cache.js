/**
 * High-res page bitmap cache for sharp rendering at high zoom levels.
 *
 * Strategy: when the user zooms in, the vector renderer draws raster images
 * at their native source resolution and upsamples them, causing blur. To
 * match the sharpness of professional PDF viewers, we re-rasterize the
 * entire page via the Rust renderer at a zoom-appropriate DPI and use that
 * bitmap as the page background. The vector layer is then drawn on top so
 * text and lines stay vector-crisp.
 *
 * The cache is keyed by (filePath, pageNum, rotation, zoomBucket). Zoom
 * buckets are powers of 2 (1, 2, 4, 8, 16) of zoom*dpr — buckets bound
 * memory growth and limit re-renders to actually-different scales.
 */

import { isTauri, invoke, readBinaryFile } from '../core/platform.js';

// Map<key, { bitmap: ImageBitmap, w, h, scale }>
const _cache = new Map();

// In-flight renders so we don't double-fire for the same key
const _pending = new Map(); // key -> Promise

// Per-page LRU bookkeeping (drop oldest entries above limit)
const MAX_ENTRIES = 12;

function _key(filePath, pageNum, rotation, zoomBucket) {
  return `${filePath}:${pageNum}:${(rotation || 0) % 360}:${zoomBucket}`;
}

// Compute the zoom bucket (power of 2) to render at, given a target scale.
// We round UP to the next power of 2 so we always have at least the requested
// resolution. Capped at 16 to keep memory bounded for very high zoom levels.
export function computeZoomBucket(targetScale) {
  if (!Number.isFinite(targetScale) || targetScale <= 0) return 1;
  if (targetScale <= 1) return 1;
  if (targetScale <= 2) return 2;
  if (targetScale <= 4) return 4;
  if (targetScale <= 8) return 8;
  return 16;
}

export function getCachedBitmap(filePath, pageNum, rotation, zoomBucket) {
  const entry = _cache.get(_key(filePath, pageNum, rotation, zoomBucket));
  return entry || null;
}

// Find the best available cached bitmap for a target bucket: prefer exact
// match, otherwise the nearest available bucket (lower preferred for speed,
// higher acceptable as fallback during downscale).
export function getBestAvailableBitmap(filePath, pageNum, rotation, targetBucket) {
  const exact = getCachedBitmap(filePath, pageNum, rotation, targetBucket);
  if (exact) return exact;
  // Search downwards then upwards
  const buckets = [1, 2, 4, 8, 16];
  // closest first
  const sorted = buckets.slice().sort((a, b) =>
    Math.abs(Math.log2(a) - Math.log2(targetBucket)) -
    Math.abs(Math.log2(b) - Math.log2(targetBucket))
  );
  for (const b of sorted) {
    const e = getCachedBitmap(filePath, pageNum, rotation, b);
    if (e) return e;
  }
  return null;
}

function _evictIfNeeded() {
  if (_cache.size <= MAX_ENTRIES) return;
  // Drop oldest insertion-order entries (Map preserves insertion order)
  const overflow = _cache.size - MAX_ENTRIES;
  let i = 0;
  for (const k of _cache.keys()) {
    if (i++ >= overflow) break;
    const e = _cache.get(k);
    try { e.bitmap.close && e.bitmap.close(); } catch {}
    _cache.delete(k);
  }
}

/**
 * Trigger an async render for the given key. Returns the existing promise if
 * one is already in flight. Resolves to the cached entry (or null on failure).
 */
export function ensureBitmap(filePath, pageNum, rotation, zoomBucket) {
  const key = _key(filePath, pageNum, rotation, zoomBucket);
  if (_cache.has(key)) return Promise.resolve(_cache.get(key));
  if (_pending.has(key)) return _pending.get(key);
  if (!isTauri() || !filePath) return Promise.resolve(null);

  const p = (async () => {
    try {
      const result = await invoke('render_pdf_page', {
        path: filePath,
        pageIndex: pageNum - 1,
        scale: zoomBucket,
        rotation: rotation || 0,
      });
      // Result format: "tempPath|width|height"
      const parts = String(result).split('|');
      const tempPath = parts[0];
      const w = parseInt(parts[1], 10);
      const h = parseInt(parts[2], 10);
      try { await invoke('allow_fs_scope', { path: tempPath }); } catch {}
      const fileBytes = await readBinaryFile(tempPath);
      if (!fileBytes || fileBytes.length <= 8) return null;
      const expected = w * h * 4;
      if (expected !== fileBytes.length - 8) {
        console.warn('[page-bitmap-cache] size mismatch', expected, fileBytes.length - 8);
        return null;
      }
      const rgba = new Uint8ClampedArray(fileBytes.buffer, fileBytes.byteOffset + 8, expected);
      const imageData = new ImageData(rgba, w, h);
      const bitmap = await createImageBitmap(imageData);
      const entry = { bitmap, w, h, scale: zoomBucket };
      _cache.set(key, entry);
      _evictIfNeeded();
      return entry;
    } catch (e) {
      console.warn('[page-bitmap-cache] render failed', e);
      return null;
    } finally {
      _pending.delete(key);
    }
  })();
  _pending.set(key, p);
  return p;
}

/// Drop ALL bitmap entries for a specific (filePath, pageNum). Use when page
/// content changes (e.g. annotations saved into the PDF stream).
export function invalidatePageBitmaps(filePath, pageNum) {
  const prefix = `${filePath}:${pageNum}:`;
  for (const k of Array.from(_cache.keys())) {
    if (k.startsWith(prefix)) {
      const e = _cache.get(k);
      try { e.bitmap.close && e.bitmap.close(); } catch {}
      _cache.delete(k);
    }
  }
}

export function clearAllBitmaps() {
  for (const e of _cache.values()) {
    try { e.bitmap.close && e.bitmap.close(); } catch {}
  }
  _cache.clear();
  _pending.clear();
}
