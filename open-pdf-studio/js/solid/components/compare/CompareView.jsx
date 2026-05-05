import { createEffect, createSignal, onCleanup, onMount, For, Show } from 'solid-js';
import {
  compareActive,
  compareOldPath,
  compareNewPath,
  compareMode,
  compareOldPage,
  compareNewPage,
  compareOffset,
  compareZoom,
  compareChanges,
  compareFocusedChange,
  compareShowAdded,
  compareShowRemoved,
  compareShowModified,
  setCompareShowAdded,
  setCompareShowRemoved,
  setCompareShowModified,
  setFocusedChange,
  exitCompare,
  nextPagePair,
  prevPagePair,
  setCompareZoom,
  setCompareOffset,
} from '../../../compare/compare-store.js';
import {
  renderCompareSideBySide,
  renderCompareOverlay,
  paintHighlights,
  clearCompareDocCache,
} from '../../../compare/compare-viewport.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function CompareView() {
  const { t } = useTranslation('ribbon');
  let oldCanvasRef;
  let newCanvasRef;
  let overlayOldCanvasRef;
  let overlayNewCanvasRef;
  let overlayHighlightCanvasRef;
  let bodyRef;
  let overlayWrapRef;
  const [highlight, setHighlight] = createSignal(null); // {x,y,w,h} flash highlight
  let highlightTimer = null;

  // Instant CSS-transform preview while zooming. The bitmap stays at the
  // last hi-quality render scale; we visually scale the wrapper so the user
  // sees an immediate response. After a short debounce we trigger a true
  // re-render at the new scale and reset cssScale back to 1.
  const [cssScale, setCssScale] = createSignal(1);
  // The compareZoom value at which the current bitmap was rendered.
  let renderedZoom = compareZoom();
  let zoomDebounceTimer = null;
  const ZOOM_DEBOUNCE_MS = 150;

  const visibleTypes = () => ({
    added: compareShowAdded(),
    removed: compareShowRemoved(),
    modified: compareShowModified(),
  });

  const repaintHighlights = () => {
    if (!overlayHighlightCanvasRef || !overlayNewCanvasRef) return;
    const visualScale = 1.5 * compareZoom();
    const list = compareChanges();
    const detectScale = list[0]?.detectScale || visualScale;
    const ratio = visualScale / detectScale;
    paintHighlights(overlayHighlightCanvasRef, list, {
      ratio,
      visibleTypes: visibleTypes(),
      selected: compareFocusedChange(),
    });
  };

  const focusOnChange = (c) => {
    if (!bodyRef || !overlayWrapRef) return;
    // Toggle selection if same record clicked again.
    const cur = compareFocusedChange();
    if (cur === c) {
      setFocusedChange(null);
      repaintHighlights();
      return;
    }
    setFocusedChange(c);

    const visualScale = 1.5 * compareZoom();
    const ratio = visualScale / (c.detectScale || visualScale);
    const x = c.x * ratio;
    const y = c.y * ratio;
    const w = c.width * ratio;
    const h = c.height * ratio;

    const offsetLeft = overlayWrapRef.offsetLeft;
    const offsetTop = overlayWrapRef.offsetTop;
    const cx = offsetLeft + x + w / 2;
    const cy = offsetTop + y + h / 2;
    bodyRef.scrollTo({
      left: Math.max(0, cx - bodyRef.clientWidth / 2),
      top: Math.max(0, cy - bodyRef.clientHeight / 2),
      behavior: 'smooth',
    });

    setHighlight({ x, y, w, h });
    if (highlightTimer) clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => setHighlight(null), 1000);
    repaintHighlights();
  };

  let busy = false;
  let pending = false;

  const doRender = async () => {
    if (busy) { pending = true; return; }
    busy = true;
    const zoomAtRender = compareZoom();
    try {
      const opts = {
        oldPath: compareOldPath(),
        newPath: compareNewPath(),
        oldPage: compareOldPage(),
        newPage: compareNewPage(),
        scale: 1.5 * zoomAtRender,
        offset: compareOffset(),
      };
      if (!opts.oldPath || !opts.newPath) return;
      if (compareMode() === 'overlay') {
        if (overlayNewCanvasRef && overlayHighlightCanvasRef) {
          await renderCompareOverlay(
            overlayOldCanvasRef,
            overlayNewCanvasRef,
            opts,
            overlayHighlightCanvasRef,
          );
          repaintHighlights();
        }
      } else {
        if (oldCanvasRef && newCanvasRef) {
          await renderCompareSideBySide(oldCanvasRef, newCanvasRef, opts);
        }
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[compare] render failed', err);
    } finally {
      busy = false;
      // The freshly painted bitmap matches zoomAtRender. Reset CSS preview
      // so what the user sees is the crisp HQ bitmap (not a CSS-stretched
      // copy). We also remember the zoom so further wheel events can compute
      // a fresh CSS-only delta from this baseline.
      renderedZoom = zoomAtRender;
      // If the user kept zooming during render, recompute cssScale relative
      // to the new baseline so the preview stays consistent.
      const cur = compareZoom();
      setCssScale(cur === renderedZoom ? 1 : cur / renderedZoom);
      if (pending) {
        pending = false;
        doRender();
      }
    }
  };

  const scheduleHQRender = () => {
    if (zoomDebounceTimer) clearTimeout(zoomDebounceTimer);
    zoomDebounceTimer = setTimeout(() => {
      zoomDebounceTimer = null;
      doRender();
    }, ZOOM_DEBOUNCE_MS);
  };

  // Non-zoom deps trigger an immediate HQ render. Zoom is handled in a
  // separate effect below with debouncing + CSS-transform preview.
  createEffect(() => {
    compareOldPath();
    compareNewPath();
    compareMode();
    compareOldPage();
    compareNewPage();
    compareOffset();
    if (compareActive()) {
      // Reset CSS preview state — after a path/page/mode change the bitmap
      // baseline is whatever the next render produces.
      setCssScale(1);
      if (zoomDebounceTimer) {
        clearTimeout(zoomDebounceTimer);
        zoomDebounceTimer = null;
      }
      queueMicrotask(doRender);
    }
  });

  // Zoom: instant CSS preview + debounced HQ re-render.
  createEffect(() => {
    const z = compareZoom();
    if (!compareActive()) return;
    // Visual scale relative to whatever the bitmap was last rendered at.
    if (renderedZoom > 0) {
      setCssScale(z / renderedZoom);
    }
    scheduleHQRender();
  });

  // Repaint highlight overlay when the changes list, visibility toggles, or
  // selection change — without re-running the full PDF render.
  createEffect(() => {
    compareChanges();
    compareShowAdded();
    compareShowRemoved();
    compareShowModified();
    compareFocusedChange();
    if (compareActive() && compareMode() === 'overlay') {
      queueMicrotask(repaintHighlights);
    }
  });

  onCleanup(() => {
    if (zoomDebounceTimer) {
      clearTimeout(zoomDebounceTimer);
      zoomDebounceTimer = null;
    }
    clearCompareDocCache();
  });

  // Esc closes compare mode (capture phase so it wins over other Esc handlers)
  onMount(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && compareActive()) {
        e.preventDefault();
        e.stopPropagation();
        exitCompare();
      }
    };
    document.addEventListener('keydown', onKey, true);
    onCleanup(() => document.removeEventListener('keydown', onKey, true));
  });

  const handleWheel = (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setCompareZoom(compareZoom() * delta);
    }
  };

  // Click outside the change list deselects the focused change.
  const handleBodyClick = () => {
    if (compareFocusedChange()) setFocusedChange(null);
  };

  return (
    <Show when={compareActive()}>
      <div
        class="compare-view"
        style="position:absolute; inset:0; display:flex; flex-direction:column; background:#2a2a2a;"
        onWheel={handleWheel}
      >
        <div
          class="compare-toolbar"
          style="display:flex; align-items:center; gap:8px; padding:6px 10px; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4; color:#222; font-size:12px;"
        >
          <strong>{t('compare.title') || 'Compare PDFs'}</strong>
          <span>·</span>
          <span>{compareMode() === 'overlay' ? (t('compare.overlay') || 'Overlay') : (t('compare.sideBySide') || 'Side-by-side')}</span>
          <span style="margin-left:12px;">{t('compare.page') || 'Page'}: {compareOldPage()} / {compareNewPage()}</span>
          <button class="pref-btn pref-btn-secondary" onClick={prevPagePair}>{'<'}</button>
          <button class="pref-btn pref-btn-secondary" onClick={nextPagePair}>{'>'}</button>
          <span style="margin-left:12px;">Zoom:</span>
          <button class="pref-btn pref-btn-secondary" onClick={() => setCompareZoom(compareZoom() / 1.2)}>-</button>
          <span style="min-width:40px; text-align:center;">{Math.round(compareZoom() * 100)}%</span>
          <button class="pref-btn pref-btn-secondary" onClick={() => setCompareZoom(compareZoom() * 1.2)}>+</button>
          <Show when={compareMode() === 'overlay'}>
            <span style="margin-left:12px;">{t('compare.align') || 'Align'} dx:</span>
            <input
              type="number"
              style="width:60px;"
              value={compareOffset().dx}
              onInput={(e) => setCompareOffset({ dx: parseFloat(e.target.value) || 0 })}
            />
            <span>dy:</span>
            <input
              type="number"
              style="width:60px;"
              value={compareOffset().dy}
              onInput={(e) => setCompareOffset({ dy: parseFloat(e.target.value) || 0 })}
            />
            <span>rot:</span>
            <input
              type="number"
              step="0.1"
              style="width:60px;"
              value={compareOffset().rotation}
              onInput={(e) => setCompareOffset({ rotation: parseFloat(e.target.value) || 0 })}
            />
          </Show>
          <span style="flex:1;"></span>
          <button
            onClick={exitCompare}
            style="background:#dc2626; color:#fff; border:1px solid #b91c1c; padding:4px 14px; font-size:12px; font-weight:600; cursor:default;"
            title="Esc"
          >
            ✕ {t('compare.exit') || 'Vergelijken sluiten'}
          </button>
        </div>
        <div style="flex:1; display:flex; min-height:0;">
          <div
            class="compare-body"
            ref={bodyRef}
            onClick={handleBodyClick}
            style="flex:1; overflow:auto; display:flex; align-items:flex-start; justify-content:center; padding:14px; gap:14px;"
          >
            <Show
              when={compareMode() === 'side'}
              fallback={
                <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                  {/* Overlay: NEW page rendered normally; diff regions drawn as
                      translucent rectangles on a separate highlight canvas. */}
                  <div
                    ref={overlayWrapRef}
                    style={`position:relative; background:#ffffff; box-shadow:0 0 0 1px #444; line-height:0; transform:scale(${cssScale()}); transform-origin:0 0;`}
                  >
                    <canvas ref={overlayNewCanvasRef} style="display:block;"></canvas>
                    {/* OLD canvas is kept in DOM but hidden — used by detection only. */}
                    <canvas
                      ref={overlayOldCanvasRef}
                      style="position:absolute; left:0; top:0; display:none;"
                    ></canvas>
                    <canvas
                      ref={overlayHighlightCanvasRef}
                      style="position:absolute; left:0; top:0; pointer-events:none;"
                    ></canvas>
                    <Show when={highlight()}>
                      {(h) => (
                        <div
                          style={`position:absolute; left:${h().x}px; top:${h().y}px; width:${h().w}px; height:${h().h}px; border:2px solid #ffd700; background:rgba(255,215,0,0.15); pointer-events:none; box-sizing:border-box;`}
                        />
                      )}
                    </Show>
                  </div>
                </div>
              }
            >
              <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                <div style="color:#ddd; font-size:11px;">{t('compare.oldDoc') || 'Old'}</div>
                <canvas
                  ref={oldCanvasRef}
                  style={`background:#ffffff; box-shadow:0 0 0 1px #444; transform:scale(${cssScale()}); transform-origin:0 0;`}
                ></canvas>
              </div>
              <div style="display:flex; flex-direction:column; align-items:center; gap:6px;">
                <div style="color:#ddd; font-size:11px;">{t('compare.newDoc') || 'New'}</div>
                <canvas
                  ref={newCanvasRef}
                  style={`background:#ffffff; box-shadow:0 0 0 1px #444; transform:scale(${cssScale()}); transform-origin:0 0;`}
                ></canvas>
              </div>
            </Show>
          </div>
          <Show when={compareMode() === 'overlay'}>
            <ChangeListPanel
              t={t}
              changes={compareChanges}
              onFocus={focusOnChange}
              focused={compareFocusedChange}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
}

function ChangeListPanel(props) {
  const typeLabel = (type) => {
    const k = type === 'added' ? 'compare.added'
      : type === 'removed' ? 'compare.removed'
      : 'compare.modified';
    return props.t(k) || (type === 'added' ? 'Toegevoegd' : type === 'removed' ? 'Verwijderd' : 'Gewijzigd');
  };
  const typeIcon = (type) => type === 'added' ? '+' : type === 'removed' ? '−' : 'Δ';
  const typeColor = (type) => type === 'added' ? '#16a34a' : type === 'removed' ? '#dc2626' : '#ca8a04';

  // Per-type collapse state (default: expanded).
  const [collapsed, setCollapsed] = createSignal({ added: false, removed: false, modified: false });
  const toggleCollapsed = (type) => {
    setCollapsed({ ...collapsed(), [type]: !collapsed()[type] });
  };

  const groupedByType = () => {
    const result = { added: [], removed: [], modified: [] };
    const list = props.changes() || [];
    list.forEach((c, idx) => {
      // Preserve original index for stable numbering.
      const type = result[c.type] ? c.type : 'modified';
      result[type].push({ change: c, index: idx });
    });
    return result;
  };

  const visibleFor = (type) => {
    if (type === 'added') return compareShowAdded();
    if (type === 'removed') return compareShowRemoved();
    return compareShowModified();
  };
  const setVisibleFor = (type, val) => {
    if (type === 'added') setCompareShowAdded(val);
    else if (type === 'removed') setCompareShowRemoved(val);
    else setCompareShowModified(val);
  };

  const TypeToggle = (tProps) => (
    <button
      onClick={() => setVisibleFor(tProps.type, !visibleFor(tProps.type))}
      title={typeLabel(tProps.type)}
      style={`flex:1; display:flex; align-items:center; justify-content:center; gap:4px; padding:4px 6px; border:1px solid #b5b5b5; background:${visibleFor(tProps.type) ? '#ffffff' : '#e5e5e5'}; cursor:pointer; font-size:11px; color:${visibleFor(tProps.type) ? '#222' : '#888'};`}
    >
      <span
        style={`width:10px; height:10px; display:inline-block; background:${visibleFor(tProps.type) ? typeColor(tProps.type) : '#bbb'}; border:1px solid #555;`}
      ></span>
      {typeLabel(tProps.type)} ({tProps.count})
    </button>
  );

  const total = () => (props.changes() || []).length;

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style="width:260px; background:#f5f5f5; border-left:1px solid #d4d4d4; display:flex; flex-direction:column; color:#222; font-size:12px;"
    >
      <div
        style="padding:6px 10px; background:linear-gradient(#ffffff, #f5f5f5); border-bottom:1px solid #d4d4d4; font-weight:bold;"
      >
        {(props.t('compare.changes') || 'Wijzigingen')}: {total()}
      </div>
      <div style="display:flex; gap:4px; padding:6px 8px; border-bottom:1px solid #d4d4d4; background:#fafafa;">
        <TypeToggle type="added" count={groupedByType().added.length} />
        <TypeToggle type="removed" count={groupedByType().removed.length} />
        <TypeToggle type="modified" count={groupedByType().modified.length} />
      </div>
      <div style="flex:1; overflow:auto;">
        <Show
          when={total() > 0}
          fallback={
            <div style="padding:14px; color:#666; font-style:italic;">
              {props.t('compare.noChanges') || 'Geen wijzigingen'}
            </div>
          }
        >
          <For each={['added', 'removed', 'modified']}>
            {(type) => (
              <Show when={visibleFor(type) && groupedByType()[type].length > 0}>
                <div>
                  <div
                    onClick={() => toggleCollapsed(type)}
                    style={`padding:5px 10px; background:#e8e8e8; border-bottom:1px solid #d4d4d4; cursor:pointer; display:flex; align-items:center; gap:6px; font-weight:bold; user-select:none;`}
                  >
                    <span style="width:10px; display:inline-block;">{collapsed()[type] ? '▶' : '▼'}</span>
                    <span
                      style={`width:10px; height:10px; display:inline-block; background:${typeColor(type)}; border:1px solid #555;`}
                    ></span>
                    <span>{typeLabel(type)} ({groupedByType()[type].length})</span>
                  </div>
                  <Show when={!collapsed()[type]}>
                    <For each={groupedByType()[type]}>
                      {(item) => {
                        const c = item.change;
                        const isFocused = () => props.focused() === c;
                        return (
                          <div
                            onClick={(e) => { e.stopPropagation(); props.onFocus(c); }}
                            style={`height:50px; padding:6px 10px; border-bottom:1px solid #e0e0e0; display:flex; align-items:center; gap:8px; cursor:pointer; background:${isFocused() ? '#dbeafe' : '#ffffff'};`}
                            onMouseEnter={(e) => { if (!isFocused()) e.currentTarget.style.background = '#eaf3ff'; }}
                            onMouseLeave={(e) => { if (!isFocused()) e.currentTarget.style.background = '#ffffff'; }}
                          >
                            <div
                              style={`width:22px; height:22px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; background:${typeColor(c.type)}; color:#fff; font-weight:bold; font-size:13px;`}
                            >
                              {typeIcon(c.type)}
                            </div>
                            <div style="flex:1; min-width:0;">
                              <div style="font-weight:bold; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                {item.index + 1}. {typeLabel(c.type)}
                              </div>
                              <div style="color:#666; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                                ~{Math.round(c.width)}×{Math.round(c.height)} px @ ({Math.round(c.x)}, {Math.round(c.y)})
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
