// Change detector for compare overlay.
//
// Consumes two RGBA ImageData buffers (old + new) of identical dimensions and
// produces a list of "change clusters" — bounding boxes around pixels where
// the two images differ.
//
// Algorithm:
//   1. Build a per-pixel label map:
//      -1 = neither (both pixels are paper-white)
//       0 = both inked (no change)
//       1 = only-old inked (something was removed)
//       2 = only-new inked (something was added)
//   2. Connected-components on labels 1 + 2 (background = -1 and 0).
//      Two-pass union-find with 8-connectivity for speed and noise tolerance.
//   3. Each component yields a bounding box, pixel count, and a mix flag.
//   4. Filter clusters smaller than MIN_CLUSTER_PIXELS.
//   5. Merge clusters whose bounding boxes are within MERGE_PROXIMITY px.
//
// Returns: Array<{type:'added'|'removed'|'modified', x,y,width,height, pixelCount}>

const DEFAULT_THRESHOLD = 600; // sum of (255 - r) + (255 - g) + (255 - b) above which a pixel is "ink"
const MIN_CLUSTER_PIXELS = 36; // ignore clusters smaller than this (~6x6)
const MERGE_PROXIMITY = 8;     // merge cluster bboxes within N pixels of each other

function _isInk(data, idx, threshold) {
  // data[idx..idx+3] = R,G,B,A. Treat fully transparent as background.
  const a = data[idx + 3];
  if (a === 0) return false;
  const darkness = (255 - data[idx]) + (255 - data[idx + 1]) + (255 - data[idx + 2]);
  return darkness > threshold;
}

/**
 * Detect change clusters between two equally-sized ImageData buffers.
 * @param {ImageData} oldData
 * @param {ImageData} newData
 * @param {number} threshold ink-darkness threshold (default 600)
 * @returns {Array<{type:string, x:number, y:number, width:number, height:number, pixelCount:number}>}
 */
export function detectChanges(oldData, newData, threshold = DEFAULT_THRESHOLD) {
  if (!oldData || !newData) return [];
  if (oldData.width !== newData.width || oldData.height !== newData.height) return [];

  const W = oldData.width;
  const H = oldData.height;
  const N = W * H;

  // labels: -1 background, 1 only-old, 2 only-new
  // We don't store "0 both" as it's also background for connectivity.
  const labels = new Int8Array(N);
  const oldBuf = oldData.data;
  const newBuf = newData.data;

  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const oInk = _isInk(oldBuf, p, threshold);
    const nInk = _isInk(newBuf, p, threshold);
    if (oInk && !nInk) labels[i] = 1;
    else if (!oInk && nInk) labels[i] = 2;
    else labels[i] = -1; // both or neither => no change
  }

  // Two-pass union-find connected components (8-connectivity).
  const comp = new Int32Array(N); // component id per pixel, 0 = unassigned
  const parent = [0]; // parent[0] unused
  const rank = [0];

  function find(a) {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra === rb) return ra;
    if (rank[ra] < rank[rb]) { parent[ra] = rb; return rb; }
    if (rank[ra] > rank[rb]) { parent[rb] = ra; return ra; }
    parent[rb] = ra; rank[ra]++; return ra;
  }

  // First pass — assign provisional labels, union with already-seen neighbors.
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (labels[i] === -1) continue;
      // Check 4 already-seen neighbors: NW, N, NE, W
      let best = 0;
      const neighbors = [];
      if (x > 0 && comp[i - 1]) neighbors.push(comp[i - 1]);
      if (y > 0) {
        if (comp[i - W]) neighbors.push(comp[i - W]);
        if (x > 0 && comp[i - W - 1]) neighbors.push(comp[i - W - 1]);
        if (x < W - 1 && comp[i - W + 1]) neighbors.push(comp[i - W + 1]);
      }
      if (neighbors.length === 0) {
        const id = parent.length;
        parent.push(id);
        rank.push(0);
        comp[i] = id;
      } else {
        best = neighbors[0];
        for (let k = 1; k < neighbors.length; k++) best = union(best, neighbors[k]);
        comp[i] = best;
      }
    }
  }

  // Second pass — flatten and build per-component stats.
  const stats = new Map(); // root -> {minX,minY,maxX,maxY,count,hasOld,hasNew}
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = comp[i];
      if (!c) continue;
      const r = find(c);
      let s = stats.get(r);
      if (!s) {
        s = { minX: x, minY: y, maxX: x, maxY: y, count: 0, hasOld: false, hasNew: false };
        stats.set(r, s);
      }
      if (x < s.minX) s.minX = x;
      if (y < s.minY) s.minY = y;
      if (x > s.maxX) s.maxX = x;
      if (y > s.maxY) s.maxY = y;
      s.count++;
      if (labels[i] === 1) s.hasOld = true;
      else if (labels[i] === 2) s.hasNew = true;
    }
  }

  // Filter and shape into change records.
  let changes = [];
  for (const s of stats.values()) {
    if (s.count < MIN_CLUSTER_PIXELS) continue;
    let type;
    if (s.hasOld && s.hasNew) type = 'modified';
    else if (s.hasOld) type = 'removed';
    else type = 'added';
    changes.push({
      type,
      x: s.minX,
      y: s.minY,
      width: s.maxX - s.minX + 1,
      height: s.maxY - s.minY + 1,
      pixelCount: s.count,
    });
  }

  // Merge nearby clusters (greedy O(N^2) — fine for typical N < a few hundred).
  changes = _mergeNearby(changes, MERGE_PROXIMITY);

  // Sort top-to-bottom, left-to-right for stable display order.
  changes.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return changes;
}

function _bboxOverlapOrNear(a, b, prox) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  // Distance along each axis, negative if overlapping.
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(ax2, bx2));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(ay2, by2));
  return dx <= prox && dy <= prox;
}

function _mergeNearby(list, prox) {
  if (list.length < 2) return list;
  const out = list.slice();
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (_bboxOverlapOrNear(out[i], out[j], prox)) {
          const a = out[i], b = out[j];
          const x = Math.min(a.x, b.x);
          const y = Math.min(a.y, b.y);
          const x2 = Math.max(a.x + a.width, b.x + b.width);
          const y2 = Math.max(a.y + a.height, b.y + b.height);
          const hasOld = (a.type === 'removed' || a.type === 'modified') ||
                         (b.type === 'removed' || b.type === 'modified');
          const hasNew = (a.type === 'added' || a.type === 'modified') ||
                         (b.type === 'added' || b.type === 'modified');
          let type;
          if (hasOld && hasNew) type = 'modified';
          else if (hasOld) type = 'removed';
          else type = 'added';
          out[i] = {
            type,
            x, y,
            width: x2 - x,
            height: y2 - y,
            pixelCount: a.pixelCount + b.pixelCount,
          };
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}
