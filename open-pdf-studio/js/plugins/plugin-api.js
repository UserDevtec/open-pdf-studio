/**
 * Plugin API
 *
 * Creates the `api` object that is passed to plugin activate() functions.
 * This is the contract between the host app and plugins.
 */

import { registerAnnotationType, unregisterAnnotationType } from './annotation-type-registry.js';
import { registerToolPalette, unregisterToolPalette } from './palette-registry.js';
import { registerPropertyPanel as _registerPropertyPanel, unregisterPropertyPanel as _unregisterPropertyPanel } from './property-panel-registry.js';
import {
  registerSelectionListener as _registerSelectionListener,
  unregisterSelectionListener as _unregisterSelectionListener,
} from './selection-listener-registry.js';
import { clearAllToolGroups } from './tool-group-state.js';
import { setNativePanelHidden } from '../solid/stores/propertiesStore.js';
import { state, getActiveDocument } from '../core/state.js';
import { setTool } from '../tools/manager.js';
import { createAnnotation } from '../annotations/factory.js';
import { redrawAnnotations } from '../annotations/rendering.js';

export function createPluginApi(pluginId) {
  const registeredTypes = [];
  const registeredPalettes = [];
  const registeredPanels = [];
  const registeredSelectionListeners = []; // [{typeName, fn}]

  return {
    pluginId,

    // --- Feature flags ---
    // Plugins can feature-detect optional fork capabilities, e.g.:
    //   if (api.features?.toolGroups === true) { ... }
    // Adding a flag here is the contract for opting plugins into a feature
    // without breaking older OPPS builds that lack it.
    features: {
      toolGroups: true,
    },

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

    // --- Property panel registration (custom edit-form for plugin annotations) ---
    registerPropertyPanel(typeName, renderFn) {
      _registerPropertyPanel(typeName, renderFn);
      registeredPanels.push(typeName);
    },

    unregisterPropertyPanel(typeName) {
      _unregisterPropertyPanel(typeName);
      const idx = registeredPanels.indexOf(typeName);
      if (idx >= 0) registeredPanels.splice(idx, 1);
    },

    // --- Selection listener (direct selection-event channel for plugin annotations) ---
    // Listener fires with `annotation` on select and `null` on deselect. Plugins
    // should compare by stable id (not ref) since OPPS may reload annotation refs.
    registerSelectionListener(typeName, fn) {
      _registerSelectionListener(typeName, fn);
      registeredSelectionListeners.push({ typeName, fn });
    },

    unregisterSelectionListener(typeName, fn) {
      _unregisterSelectionListener(typeName, fn);
      const idx = registeredSelectionListeners.findIndex(e => e.typeName === typeName && e.fn === fn);
      if (idx >= 0) registeredSelectionListeners.splice(idx, 1);
    },

    // --- Native property-panel visibility ---
    // Plugin can hide OPPS' native eigenschappen-paneel during plugin-annotation
    // editing so all controls live in the plugin's own palette/UI.
    // Pass false to hide, true to restore. Caller is responsible for restoring on deselect.
    setNativePanelVisible(visible) {
      setNativePanelHidden(!visible);
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
      const doc = getActiveDocument();
      return doc ? doc.currentPage : 1;
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
      registeredPanels.forEach(t => _unregisterPropertyPanel(t));
      registeredSelectionListeners.forEach(({ typeName, fn }) => _unregisterSelectionListener(typeName, fn));
      // Restore native panel visibility on plugin-deactivate so the host UI returns to default.
      setNativePanelHidden(false);
      // Reset tool-group sub-tool selections so a fresh activate starts clean.
      clearAllToolGroups();
      registeredTypes.length = 0;
      registeredPalettes.length = 0;
      registeredPanels.length = 0;
      registeredSelectionListeners.length = 0;
    }
  };
}
