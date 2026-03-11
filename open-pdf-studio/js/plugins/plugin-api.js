/**
 * Plugin API
 *
 * Creates the `api` object that is passed to plugin activate() functions.
 * This is the contract between the host app and plugins.
 */

import { registerAnnotationType, unregisterAnnotationType } from './annotation-type-registry.js';
import { registerToolPalette, unregisterToolPalette } from './palette-registry.js';
import { state } from '../core/state.js';
import { setTool } from '../tools/manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';

export function createPluginApi(pluginId) {
  const registeredTypes = [];
  const registeredPalettes = [];

  return {
    pluginId,

    // --- Annotation type registration ---
    registerAnnotationType(typeName, handler) {
      const prefixedName = typeName;
      registerAnnotationType(prefixedName, handler);
      registeredTypes.push(prefixedName);
    },

    unregisterAnnotationType(typeName) {
      unregisterAnnotationType(typeName);
      const idx = registeredTypes.indexOf(typeName);
      if (idx >= 0) registeredTypes.splice(idx, 1);
    },

    // --- Tool palette registration ---
    registerToolPalette(descriptor) {
      registerToolPalette(descriptor);
      registeredPalettes.push(descriptor.id);
    },

    unregisterToolPalette(id) {
      unregisterToolPalette(id);
      const idx = registeredPalettes.indexOf(id);
      if (idx >= 0) registeredPalettes.splice(idx, 1);
    },

    // --- Tool management ---
    setTool(toolName) {
      setTool(toolName);
    },

    setToolOverrides(overrides) {
      state.toolOverrides = overrides;
    },

    // --- State access (read-only helpers) ---
    getPreferences() {
      return state.preferences;
    },

    getCurrentTool() {
      return state.currentTool;
    },

    getCurrentPage() {
      return state.currentPage;
    },

    // --- Annotation helpers ---
    createAnnotation(props) {
      return createAnnotation(props);
    },

    redrawAnnotations() {
      redrawAnnotations();
    },

    // --- Cleanup (called by plugin-manager on deactivate) ---
    _cleanup() {
      registeredTypes.forEach(t => unregisterAnnotationType(t));
      registeredPalettes.forEach(id => unregisterToolPalette(id));
      registeredTypes.length = 0;
      registeredPalettes.length = 0;
    }
  };
}
