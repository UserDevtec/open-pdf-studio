import { state } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';
import { savePreferences } from '../../core/preferences.js';
import {
  storeShowProperties,
  storeHideProperties,
  storeClosePanel,
  storeShowMultiSelection,
  storeShowTextEditProperties,
  setPropertiesPanelVisible as setPanelVisible,
  propertiesPanelVisible as panelVisible,
  setPropertiesPanelCollapsed as setPanelCollapsed,
  propertiesPanelCollapsed as panelCollapsed,
} from '../../bridge.js';

function redraw() {
  if (state.viewMode === 'continuous') {
    redrawContinuous();
  } else {
    redrawAnnotations();
  }
}

// Show properties panel for a single annotation
export function showProperties(annotation) {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) {
    doc.selectedAnnotation = annotation;
  }
  storeShowProperties(annotation);
  redraw();
}

// Hide properties (deselect annotation, show doc info)
export function hideProperties() {
  state.selectedAnnotation = null;
  storeHideProperties();
  redraw();
}

// Collapse the properties panel (keeps the vertical strip visible)
export function closePropertiesPanel() {
  setPanelCollapsed(true);
}

// Toggle properties panel expanded/collapsed (for keyboard shortcut F12 and ribbon button)
export function togglePropertiesPanel() {
  if (!panelVisible()) {
    setPanelVisible(true);
    setPanelCollapsed(false);
    state.preferences.propertiesPanelVisible = true;
    savePreferences();
    if (state.selectedAnnotation) {
      showProperties(state.selectedAnnotation);
    } else {
      hideProperties();
    }
  } else if (panelCollapsed()) {
    setPanelCollapsed(false);
  } else {
    setPanelCollapsed(true);
  }
}

// Initialize panel — always visible, always expanded on startup
export function initPropertiesPanel() {
  setPanelVisible(true);
  setPanelCollapsed(false);
}

// Show properties panel for multi-selection
export function showMultiSelectionProperties() {
  const selected = state.selectedAnnotations;
  if (!selected || selected.length < 2) return;
  storeShowMultiSelection(selected);
}

// Show text edit properties (PDF text editing mode)
export function showTextEditProperties(info) {
  storeShowTextEditProperties(info);
}

// No-op functions - Solid handles these inline now
export function updateAnnotationProperties() {}
export function updateArrowProperties() {}
export function updateTextFormatProperties() {}
export function updateColorDisplay() {}
