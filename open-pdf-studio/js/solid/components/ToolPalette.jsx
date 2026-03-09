import { createSignal, Show, For } from 'solid-js';
import { state, noPdf } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon,
  textboxIcon, calloutIcon, noteIcon,
  stampIcon, signatureIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon
} from '../data/ribbonIcons.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const handIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11"/></svg>`;
const selectIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122"/></svg>`;

// --- State ---
const [paletteVisible, setPaletteVisible] = createSignal(false);
const [paletteMode, setPaletteMode] = createSignal('docked-left');
const [floatPos, setFloatPos] = createSignal({ x: 200, y: 150 });
const [isDragging, setIsDragging] = createSignal(false);
const [dockPreview, setDockPreview] = createSignal(null); // null | 'left' | 'right'

export { paletteVisible, paletteMode };

export function toggleToolPalette() {
  setPaletteVisible(v => !v);
}

window.__toggleToolPalette = toggleToolPalette;

const DOCK_STRIP_WIDTH = 34;
const DOCK_SNAP = 60;

const tools = [
  { tool: 'hand', key: 'home.hand', icon: handIcon, group: 0 },
  { tool: 'select', key: 'home.select', icon: selectIcon, group: 0 },
  { tool: 'highlight', key: 'comment.highlight', icon: highlightIcon, group: 1 },
  { tool: 'draw', key: 'comment.freehand', icon: freehandIcon, group: 1 },
  { tool: 'line', key: 'comment.line', icon: lineIcon, group: 1 },
  { tool: 'arrow', key: 'comment.arrow', icon: arrowIcon, group: 1 },
  { tool: 'polyline', key: 'comment.polyline', icon: polylineIcon, group: 1 },
  { tool: 'box', key: 'comment.rect', icon: rectIcon, group: 2 },
  { tool: 'circle', key: 'comment.ellipse', icon: ellipseIcon, group: 2 },
  { tool: 'polygon', key: 'comment.polygon', icon: polygonIcon, group: 2 },
  { tool: 'cloud', key: 'comment.cloud', icon: cloudIcon, group: 2 },
  { tool: 'textbox', key: 'comment.textBox', icon: textboxIcon, group: 3 },
  { tool: 'callout', key: 'comment.callout', icon: calloutIcon, group: 3 },
  { tool: 'comment', key: 'comment.note', icon: noteIcon, group: 3 },
  { tool: 'stamp', key: 'comment.stamp', icon: stampIcon, group: 4 },
  { tool: 'signature', key: 'comment.signature', icon: signatureIcon, group: 4 },
  { tool: 'measureDistance', key: 'comment.measureDistance', icon: measureDistanceIcon, group: 5 },
  { tool: 'measureArea', key: 'comment.measureArea', icon: measureAreaIcon, group: 5 },
  { tool: 'measurePerimeter', key: 'comment.measurePerimeter', icon: measurePerimeterIcon, group: 5 },
];

// --- Shared drag logic ---
function startDrag(e, fromDocked) {
  e.preventDefault();
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  // For floating: offset from palette origin
  const offsetX = fromDocked ? 17 : (e.clientX - floatPos().x);
  const offsetY = fromDocked ? 12 : (e.clientY - floatPos().y);

  setIsDragging(true);

  function getSnapSide(cx) {
    // Use live measurement so it stays correct during drag
    const rect = mainViewEl.getBoundingClientRect();
    const relL = cx - rect.left;
    const relR = rect.right - cx;
    if (relL < DOCK_SNAP) return 'left';
    if (relR < DOCK_SNAP) return 'right';
    return null;
  }

  function onMove(ev) {
    if (!hasMoved) {
      const dx = Math.abs(ev.clientX - startCX);
      const dy = Math.abs(ev.clientY - startCY);
      if (dx < 4 && dy < 4) return; // dead zone
      hasMoved = true;
      if (fromDocked) {
        setPaletteMode('float');
      }
    }

    const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - 80));
    const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - 40));
    setFloatPos({ x: nx, y: ny });
    setDockPreview(getSnapSide(ev.clientX));
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    setIsDragging(false);
    setDockPreview(null);

    if (!hasMoved) return;

    const snap = getSnapSide(ev.clientX);
    if (snap) {
      setPaletteMode(`docked-${snap}`);
    }
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Components ---

function ToolBtn(props) {
  const toolDisabled = () => noPdf() || isPdfAReadOnly();
  const alwaysEnabled = props.tool === 'hand' || props.tool === 'select';
  const isActive = () => state.currentTool === props.tool;
  return (
    <button
      class={`tp-btn ${isActive() ? 'active' : ''}`}
      disabled={!alwaysEnabled && toolDisabled()}
      onClick={() => setTool(props.tool)}
      title={props.title}
      innerHTML={props.icon}
    />
  );
}

function ToolList() {
  const { t } = useTranslation('ribbon');
  let lastGroup = -1;
  return (
    <For each={tools}>
      {(item) => {
        const showSep = lastGroup !== -1 && lastGroup !== item.group;
        lastGroup = item.group;
        return (
          <>
            {showSep && <div class="tp-sep" />}
            <ToolBtn tool={item.tool} title={t(item.key)} icon={item.icon} />
          </>
        );
      }}
    </For>
  );
}

// Height needed for all tools in a single column (19 btns × 30px + 5 seps × 7px)
const SINGLE_COL_HEIGHT = 610;

// Docked strip — sits in the flex layout
export function DockedToolPalette(props) {
  const side = () => props.side;
  const shouldShow = () => paletteVisible() && paletteMode() === `docked-${side()}`;
  const [twoCol, setTwoCol] = createSignal(false);
  let observer = null;

  function bindRef(el) {
    if (observer) { observer.disconnect(); observer = null; }
    if (!el) return;
    observer = new ResizeObserver(() => {
      // Available height for tools = palette height - grip - close button
      const available = el.clientHeight - 46;
      setTwoCol(available < SINGLE_COL_HEIGHT);
    });
    observer.observe(el);
    const available = el.clientHeight - 46;
    setTwoCol(available < SINGLE_COL_HEIGHT);
  }

  return (
    <Show when={shouldShow()}>
      <div class={`tp-docked tp-docked-${side()}`} ref={bindRef}>
        <div class="tp-grip" onMouseDown={(e) => startDrag(e, true)}>
          <svg width="10" height="16" viewBox="0 0 10 16">
            <circle cx="3" cy="2" r="1.2" fill="currentColor"/><circle cx="7" cy="2" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="7" cy="6" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="10" r="1.2" fill="currentColor"/><circle cx="7" cy="10" r="1.2" fill="currentColor"/>
            <circle cx="3" cy="14" r="1.2" fill="currentColor"/><circle cx="7" cy="14" r="1.2" fill="currentColor"/>
          </svg>
        </div>
        <div class={`tp-docked-tools${twoCol() ? ' two-col' : ''}`}>
          <ToolList />
        </div>
        <button class="tp-close" onClick={() => setPaletteVisible(false)}>
          <svg width="8" height="8" viewBox="0 0 10 10">
            <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/>
            <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/>
          </svg>
        </button>
      </div>
    </Show>
  );
}

// Floating palette — fixed position, draggable
export function FloatingToolPalette() {
  const { t } = useTranslation('ribbon');
  const shouldShow = () => paletteVisible() && paletteMode() === 'float';
  let paletteRef;

  return (
    <Show when={shouldShow()}>
      <div
        ref={paletteRef}
        class="tp-float"
        style={`left:${floatPos().x}px; top:${floatPos().y}px`}
      >
        <div class="tp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.tp-float-close')) return;
          startDrag(e, false);
        }}>
          <span class="tp-float-title">{t('view.toolPaletteLabel')}</span>
          <button class="tp-float-close" onClick={() => setPaletteVisible(false)}>
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
        <div class="tp-float-body">
          <ToolList />
        </div>
      </div>
    </Show>
  );
}

// Dock targets — shown inside .main-view when dragging
export function DockTargets() {
  return (
    <>
      <div class={`tp-dock-target tp-dock-target-left ${isDragging() ? 'visible' : ''} ${dockPreview() === 'left' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="1" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-target tp-dock-target-right ${isDragging() ? 'visible' : ''} ${dockPreview() === 'right' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="13" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-preview tp-dock-preview-left ${dockPreview() === 'left' ? 'active' : ''}`} />
      <div class={`tp-dock-preview tp-dock-preview-right ${dockPreview() === 'right' ? 'active' : ''}`} />
    </>
  );
}

export default DockedToolPalette;
