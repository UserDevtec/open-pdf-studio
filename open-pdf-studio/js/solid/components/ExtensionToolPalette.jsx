/**
 * ExtensionToolPalette — generic, data-driven tool palette for plugins.
 *
 * Each registered palette descriptor gets its own instance of this component
 * with independent docking, floating, visibility, and drag state.
 */

import { createSignal, Show, For, onMount } from 'solid-js';

import { state, noPdf } from '../../core/state.js';
import { setTool } from '../../tools/manager.js';
import { isPdfAReadOnly } from '../../pdf/loader.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { savePreferences } from '../../core/preferences.js';
import { registerPaletteDock, unregisterPaletteDock } from '../stores/paletteOrder.js';
import { hasAnnotationType } from '../../plugins/annotation-type-registry.js';
import { paletteIconSize, showPaletteCtxMenu } from './ToolPalette.jsx';

const DOCK_SNAP = 60;

// Per-palette state keyed by palette id
const paletteStates = {};

function getOrCreateState(id, defaults) {
  if (!paletteStates[id]) {
    const prefs = state.preferences;
    const prefKey = `ext_${id}`;
    paletteStates[id] = {
      visible:     createSignal(prefs[`${prefKey}_visible`]     ?? (defaults?.defaultVisible ?? false)),
      mode:        createSignal(prefs[`${prefKey}_mode`]        ?? (defaults?.defaultMode ?? 'docked-left')),
      floatPos:    createSignal({ x: prefs[`${prefKey}_floatX`] ?? 260, y: prefs[`${prefKey}_floatY`] ?? 150 }),
      isDragging:  createSignal(false),
      dockPreview: createSignal(null),
    };
  }
  return paletteStates[id];
}

function savePalettePrefs(id) {
  const ps = paletteStates[id];
  if (!ps) return;
  const prefKey = `ext_${id}`;
  state.preferences[`${prefKey}_visible`] = ps.visible[0]();
  state.preferences[`${prefKey}_mode`] = ps.mode[0]();
  const pos = ps.floatPos[0]();
  state.preferences[`${prefKey}_floatX`] = pos.x;
  state.preferences[`${prefKey}_floatY`] = pos.y;
  savePreferences();
}

export function initExtPalette(id, defaults) {
  const ps = getOrCreateState(id, defaults);
  const mode = ps.mode[0]();
  if (ps.visible[0]() && mode.startsWith('docked-')) {
    registerPaletteDock(id, mode.replace('docked-', ''));
  }
}

export function toggleExtPalette(id) {
  const ps = getOrCreateState(id);
  const willBeVisible = !ps.visible[0]();
  ps.visible[1](willBeVisible);
  const mode = ps.mode[0]();
  if (willBeVisible && mode.startsWith('docked-')) {
    registerPaletteDock(id, mode.replace('docked-', ''));
  } else {
    unregisterPaletteDock(id);
  }
  savePalettePrefs(id);
}

export function isExtPaletteVisible(id) {
  const ps = paletteStates[id];
  return ps ? ps.visible[0]() : false;
}

// --- Drag logic (per palette instance) ---
function startExtDrag(id, e, fromDocked) {
  if (e.button !== 0) return;
  e.preventDefault();
  const ps = paletteStates[id];
  if (!ps) return;
  const mainViewEl = document.querySelector('.main-view');
  if (!mainViewEl) return;
  let hasMoved = false;
  const startCX = e.clientX;
  const startCY = e.clientY;
  const offsetX = fromDocked ? 17 : (e.clientX - ps.floatPos[0]().x);
  const offsetY = fromDocked ? 12 : (e.clientY - ps.floatPos[0]().y);

  ps.isDragging[1](true);

  function getSnapSide(cx) {
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
      if (dx < 4 && dy < 4) return;
      hasMoved = true;
      if (fromDocked) {
        ps.mode[1]('float');
        unregisterPaletteDock(id);
      }
    }
    const nx = Math.max(0, Math.min(ev.clientX - offsetX, window.innerWidth - 80));
    const ny = Math.max(0, Math.min(ev.clientY - offsetY, window.innerHeight - 40));
    ps.floatPos[1]({ x: nx, y: ny });
    ps.dockPreview[1](getSnapSide(ev.clientX));
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    ps.isDragging[1](false);
    ps.dockPreview[1](null);
    if (!hasMoved) return;
    const snap = getSnapSide(ev.clientX);
    if (snap) {
      ps.mode[1](`docked-${snap}`);
      registerPaletteDock(id, snap);
    } else {
      unregisterPaletteDock(id);
    }
    savePalettePrefs(id);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// --- Tool button ---
function ExtToolBtn(props) {
  const toolDisabled = () => noPdf() || isPdfAReadOnly();
  const isActive = () => {
    if (state.currentTool !== props.tool) return false;
    if (!props.overrides && !state.toolOverrides) return true;
    if (!props.overrides || !state.toolOverrides) return false;
    const keys = Object.keys(props.overrides);
    return keys.length === Object.keys(state.toolOverrides).length &&
      keys.every(k => state.toolOverrides[k] === props.overrides[k]);
  };
  return (
    <button
      class={`tp-btn ${isActive() ? 'active' : ''}`}
      disabled={toolDisabled()}
      onClick={() => { setTool(props.tool); if (props.overrides) state.toolOverrides = props.overrides; }}
      title={props.title}
      innerHTML={props.icon}
    />
  );
}

// --- Tool list with separators ---
function ExtToolList(props) {
  const { t } = useTranslation('ribbon');
  let lastGroup = -1;
  return (
    <For each={props.tools}>
      {(item) => {
        const showSep = lastGroup !== -1 && lastGroup !== item.group;
        lastGroup = item.group;
        const translated = item.translationKey ? t(item.translationKey) : null;
        const title = (translated && translated !== item.translationKey) ? translated : item.label;
        return (
          <>
            {showSep && <div class="tp-sep" />}
            <ExtToolBtn tool={item.tool} title={title} icon={item.icon} overrides={item.overrides || null} />
          </>
        );
      }}
    </For>
  );
}

// --- Grip SVG (shared) ---
function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16">
      <circle cx="3" cy="2" r="1.2" fill="currentColor"/><circle cx="7" cy="2" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="6" r="1.2" fill="currentColor"/><circle cx="7" cy="6" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="10" r="1.2" fill="currentColor"/><circle cx="7" cy="10" r="1.2" fill="currentColor"/>
      <circle cx="3" cy="14" r="1.2" fill="currentColor"/><circle cx="7" cy="14" r="1.2" fill="currentColor"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 10 10">
      <line x1="2" y1="2" x2="8" y2="8" stroke="currentColor" stroke-width="1.5"/>
      <line x1="8" y1="2" x2="2" y2="8" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  );
}

// --- Docked palette ---
export function DockedExtPalette(props) {
  const id = () => props.descriptor.id;

  onMount(() => initExtPalette(id(), props.descriptor));

  const ps = () => getOrCreateState(id(), props.descriptor);
  const side = () => props.side;
  const shouldShow = () => ps().visible[0]() && ps().mode[0]() === `docked-${side()}`;

  return (
    <Show when={shouldShow()}>
      <div class={`tp-docked tp-docked-${side()}${paletteIconSize() === 'large' ? ' tp-large' : ''}`} onContextMenu={showPaletteCtxMenu}>
        <div class="tp-grip" onMouseDown={(e) => startExtDrag(id(), e, true)}>
          <GripIcon />
        </div>
        <Show when={props.descriptor.logo}>
          <div class="tp-logo" innerHTML={props.descriptor.logo} />
        </Show>
        <div class="tp-docked-tools">
          <ExtToolList tools={props.descriptor.tools} />
        </div>
        <button class="tp-close" onClick={() => {
          ps().visible[1](false);
          unregisterPaletteDock(id());
          savePalettePrefs(id());
        }}>
          <CloseIcon />
        </button>
      </div>
    </Show>
  );
}

// --- Floating palette ---
export function FloatingExtPalette(props) {
  const { t } = useTranslation('ribbon');
  const id = () => props.descriptor.id;
  const ps = () => getOrCreateState(id(), props.descriptor);
  const shouldShow = () => ps().visible[0]() && ps().mode[0]() === 'float';

  const title = () => {
    if (props.descriptor.translationKey) {
      const translated = t(props.descriptor.translationKey);
      return translated !== props.descriptor.translationKey ? translated : props.descriptor.label;
    }
    return props.descriptor.label;
  };

  return (
    <Show when={shouldShow()}>
      <div
        class={`tp-float${paletteIconSize() === 'large' ? ' tp-large' : ''}`}
        style={`left:${ps().floatPos[0]().x}px; top:${ps().floatPos[0]().y}px`}
        onContextMenu={showPaletteCtxMenu}
      >
        <div class="tp-float-header" onMouseDown={(e) => {
          if (e.target.closest('.tp-float-close')) return;
          startExtDrag(id(), e, false);
        }}>
          <span class="tp-float-title">{title()}</span>
          <button class="tp-float-close" onClick={() => {
            ps().visible[1](false);
            unregisterPaletteDock(id());
            savePalettePrefs(id());
          }}>
            <svg width="8" height="8" viewBox="0 0 10 10">
              <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.5"/>
              <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.5"/>
            </svg>
          </button>
        </div>
        <Show when={props.descriptor.logo}>
          <div class="tp-logo" innerHTML={props.descriptor.logo} />
        </Show>
        <div class="tp-float-body">
          <ExtToolList tools={props.descriptor.tools} />
        </div>
      </div>
    </Show>
  );
}

// --- Dock targets ---
export function ExtDockTargets(props) {
  const id = () => props.descriptor.id;
  const ps = () => getOrCreateState(id(), props.descriptor);

  return (
    <>
      <div class={`tp-dock-target tp-dock-target-left ${ps().isDragging[0]() ? 'visible' : ''} ${ps().dockPreview[0]() === 'left' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="1" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-target tp-dock-target-right ${ps().isDragging[0]() ? 'visible' : ''} ${ps().dockPreview[0]() === 'right' ? 'active' : ''}`}>
        <div class="tp-dock-target-icon">
          <svg width="20" height="20" viewBox="0 0 20 20">
            <rect x="1" y="1" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
            <rect x="13" y="1" width="6" height="18" rx="1" fill="currentColor" opacity="0.4"/>
          </svg>
        </div>
      </div>
      <div class={`tp-dock-preview tp-dock-preview-left ${ps().dockPreview[0]() === 'left' ? 'active' : ''}`} />
      <div class={`tp-dock-preview tp-dock-preview-right ${ps().dockPreview[0]() === 'right' ? 'active' : ''}`} />
    </>
  );
}
