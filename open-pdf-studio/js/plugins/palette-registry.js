/**
 * Tool Palette Registry
 *
 * Reactive store for plugin-contributed tool palettes.
 * App.jsx reads from this to render extension palettes dynamically.
 *
 * PaletteDescriptor:
 *   {
 *     id: string,
 *     label: string,
 *     icon: string | null,      // SVG string for the View ribbon button (falls back to default icon)
 *     translationKey: string | null,
 *     tools: ToolDefinition[],
 *     defaultVisible: boolean,
 *     defaultMode: 'docked-left' | 'docked-right' | 'float',
 *     cssClass?: string         // extra class added to the palette root (.tp-docked / .tp-float)
 *                               // so plugin-CSS can target without DOM scraping
 *   }
 *
 * ToolDefinition:
 *   {
 *     id: string,
 *     tool: string,           // base tool name or registered annotation type
 *     label: string,
 *     translationKey: string | null,
 *     icon: string,           // SVG string
 *     group: number,
 *     overrides: object | null,
 *     subTools?: ToolDefinition[]   // optional: turns this entry into a "tool group"
 *   }
 *
 * Tool groups (subTools):
 *   When a ToolDefinition has a non-empty `subTools` array, the host renders
 *   it as a "tool group" rather than a single tool button. The main palette
 *   button then shows the icon (and label) of the *currently active* sub-tool —
 *   i.e. the button "morphs" to reflect the last choice — and clicking it opens
 *   a sub-menu pop-out listing all sub-tools. Picking a sub-tool from the
 *   pop-out activates that tool and persists the choice as the group's new
 *   active sub-tool for the rest of the session (in-memory only; not
 *   persisted across app restarts).
 *
 *   The active-sub-tool state lives in `tool-group-state.js`. Plugins can
 *   feature-detect support via `api.features?.toolGroups === true`.
 */

import { createSignal } from 'solid-js';

const [palettes, setPalettes] = createSignal([]);

export function registerToolPalette(descriptor) {
  setPalettes(prev => {
    // Replace if same id already exists
    const filtered = prev.filter(p => p.id !== descriptor.id);
    return [...filtered, descriptor];
  });
}

export function unregisterToolPalette(id) {
  setPalettes(prev => prev.filter(p => p.id !== id));
}

export function getRegisteredPalettes() {
  return palettes();
}

export function getPalette(id) {
  return palettes().find(p => p.id === id) || null;
}
