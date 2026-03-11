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
 *     defaultMode: 'docked-left' | 'docked-right' | 'float'
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
 *     overrides: object | null
 *   }
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
