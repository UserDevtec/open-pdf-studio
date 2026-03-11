import { createSignal } from 'solid-js';
import { state } from '../../core/state.js';
import { savePreferences } from '../../core/preferences.js';

// Tracks the order palettes were docked to each side.
// Each entry is a palette id string. First entry = closest to edge.
const [leftOrder, setLeftOrder] = createSignal([]);
const [rightOrder, setRightOrder] = createSignal([]);

export { leftOrder, rightOrder };

function save() {
  state.preferences.paletteLeftOrder = leftOrder();
  state.preferences.paletteRightOrder = rightOrder();
  savePreferences();
}

export function initPaletteOrder() {
  const prefs = state.preferences;
  setLeftOrder(prefs.paletteLeftOrder ?? []);
  setRightOrder(prefs.paletteRightOrder ?? []);
}

/** Call when a palette becomes visible/docked on a side. */
export function registerPaletteDock(id, side) {
  if (side === 'left') {
    setLeftOrder(prev => prev.includes(id) ? prev : [...prev, id]);
    // Remove from right if it was there
    setRightOrder(prev => prev.filter(p => p !== id));
  } else {
    setRightOrder(prev => prev.includes(id) ? prev : [...prev, id]);
    setLeftOrder(prev => prev.filter(p => p !== id));
  }
  save();
}

/** Call when a palette is hidden or undocked (goes floating). */
export function unregisterPaletteDock(id) {
  setLeftOrder(prev => prev.filter(p => p !== id));
  setRightOrder(prev => prev.filter(p => p !== id));
  save();
}
