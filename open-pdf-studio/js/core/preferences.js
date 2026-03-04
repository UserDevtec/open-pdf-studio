import { DEFAULT_PREFERENCES } from './constants.js';
import { state } from './state.js';
import { setColorPickerValue, setLineWidthValue, setCurrentTheme } from '../solid/stores/ribbonStore.js';
import { updateStatusMessage } from '../ui/chrome/status-bar.js';
import { openDialog } from '../solid/stores/dialogStore.js';
import { changeLanguage } from '../i18n/useTranslation.js';
import { isTauri, getUsername, savePreferencesFile, loadPreferencesFile } from './platform.js';

// Load preferences from Rust file storage, with localStorage migration fallback
export async function loadPreferences() {
  try {
    // Try Rust-backed file storage first (survives WebView2 data clears)
    let loaded = isTauri() ? await loadPreferencesFile() : null;

    if (!loaded) {
      // Fallback: migrate from localStorage (first launch after update, or non-Tauri)
      const saved = localStorage.getItem('pdfEditorPreferences');
      if (saved) {
        loaded = JSON.parse(saved);
      }
    }

    if (loaded) {
      // Merge with defaults to ensure all keys exist
      state.preferences = { ...DEFAULT_PREFERENCES, ...loaded };
    }

    // Persist to both storages so they stay in sync
    const json = JSON.stringify(state.preferences);
    localStorage.setItem('pdfEditorPreferences', json);
    if (isTauri()) {
      savePreferencesFile(state.preferences).catch(e =>
        console.error('Failed to save preferences file:', e)
      );
    }
  } catch (e) {
    console.error('Failed to load preferences:', e);
    state.preferences = { ...DEFAULT_PREFERENCES };
  }

  // If authorName is empty (first launch or reset), resolve to OS login username
  if (!state.preferences.authorName) {
    try {
      const username = isTauri() ? await getUsername() : 'User';
      state.preferences.authorName = username;
    } catch (e) {
      state.preferences.authorName = 'User';
    }
  }

  applyPreferences();
}

// Save preferences to Rust file storage + localStorage mirror
export function savePreferences() {
  try {
    const json = JSON.stringify(state.preferences);
    // localStorage mirror for synchronous theme script in index.html
    localStorage.setItem('pdfEditorPreferences', json);
    // Rust-backed persistent storage
    if (isTauri()) {
      savePreferencesFile(state.preferences).catch(e =>
        console.error('Failed to save preferences file:', e)
      );
    }
    applyPreferences();
  } catch (e) {
    console.error('Failed to save preferences:', e);
  }
}

// Cached system theme from Tauri API (updated by onThemeChanged listener)
let cachedSystemTheme = null;

// Detect OS theme using Tauri Window API (reliable), with matchMedia fallback
function getSystemTheme() {
  if (cachedSystemTheme) return cachedSystemTheme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Resolve the effective theme (handles "system" by detecting OS preference)
function resolveTheme(themeName) {
  if (themeName === 'system') {
    return getSystemTheme();
  }
  return themeName;
}

// Apply theme to the document
export function applyTheme(themeName) {
  const effectiveTheme = resolveTheme(themeName);
  document.documentElement.setAttribute('data-theme', effectiveTheme);
  setCurrentTheme(themeName);
}

// Initialize theme change listener using Tauri API (more reliable than matchMedia)
async function initThemeListener() {
  if (isTauri() && window.__TAURI__?.window) {
    try {
      const appWindow = window.__TAURI__.window.getCurrentWindow();
      cachedSystemTheme = await appWindow.theme();
      appWindow.onThemeChanged(({ payload: theme }) => {
        cachedSystemTheme = theme;
        if (state.preferences.theme === 'system') {
          applyTheme('system');
        }
      });
    } catch (e) {
      console.warn('Tauri theme API unavailable, using matchMedia fallback');
    }
  }

  // Fallback listener for non-Tauri or if Tauri API fails
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!cachedSystemTheme && state.preferences.theme === 'system') {
      applyTheme('system');
    }
  });
}

initThemeListener();

// Apply preferences to the application
export function applyPreferences() {
  // Apply theme
  if (state.preferences.theme) {
    applyTheme(state.preferences.theme);
  }

  // Update default author from preferences
  state.defaultAuthor = state.preferences.authorName || 'User';

  // Update color picker default
  setColorPickerValue(state.preferences.defaultAnnotationColor);

  // Update line width default
  setLineWidthValue(state.preferences.defaultLineWidth);

  // Apply language
  changeLanguage(state.preferences.language || 'auto');
}

// Show preferences dialog (bridges to Solid.js dialog)
export function showPreferencesDialog(tabName = 'general') {
  openDialog('preferences', { tab: tabName });
}

// Set the current annotation's style as default for its type
export function setAsDefaultStyle(annotation) {
  if (!annotation) return;
  const prefs = state.preferences;
  const type = annotation.type;

  switch (type) {
    case 'draw':
      prefs.drawStrokeColor = annotation.strokeColor || annotation.color || prefs.drawStrokeColor;
      prefs.drawLineWidth = annotation.lineWidth ?? prefs.drawLineWidth;
      if (annotation.opacity !== undefined) prefs.drawOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'highlight':
      prefs.highlightColor = annotation.color || annotation.fillColor || prefs.highlightColor;
      if (annotation.opacity !== undefined) prefs.highlightOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'line':
      prefs.lineStrokeColor = annotation.strokeColor || annotation.color || prefs.lineStrokeColor;
      prefs.lineLineWidth = annotation.lineWidth ?? prefs.lineLineWidth;
      if (annotation.borderStyle) prefs.lineBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.lineOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'arrow':
      prefs.arrowStrokeColor = annotation.strokeColor || annotation.color || prefs.arrowStrokeColor;
      prefs.arrowFillColor = annotation.fillColor || prefs.arrowFillColor;
      prefs.arrowLineWidth = annotation.lineWidth ?? prefs.arrowLineWidth;
      if (annotation.borderStyle) prefs.arrowBorderStyle = annotation.borderStyle;
      if (annotation.startHead) prefs.arrowStartHead = annotation.startHead;
      if (annotation.endHead) prefs.arrowEndHead = annotation.endHead;
      if (annotation.headSize) prefs.arrowHeadSize = annotation.headSize;
      if (annotation.opacity !== undefined) prefs.arrowOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'box':
      prefs.rectStrokeColor = annotation.strokeColor || annotation.color || prefs.rectStrokeColor;
      prefs.rectFillColor = annotation.fillColor || prefs.rectFillColor;
      prefs.rectFillNone = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === null;
      prefs.rectBorderWidth = annotation.lineWidth ?? prefs.rectBorderWidth;
      if (annotation.borderStyle) prefs.rectBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.rectOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'circle':
      prefs.circleStrokeColor = annotation.strokeColor || annotation.color || prefs.circleStrokeColor;
      prefs.circleFillColor = annotation.fillColor || prefs.circleFillColor;
      prefs.circleFillNone = !annotation.fillColor || annotation.fillColor === 'transparent' || annotation.fillColor === null;
      prefs.circleBorderWidth = annotation.lineWidth ?? prefs.circleBorderWidth;
      if (annotation.borderStyle) prefs.circleBorderStyle = annotation.borderStyle;
      if (annotation.opacity !== undefined) prefs.circleOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'textbox':
      prefs.textboxStrokeColor = annotation.strokeColor || annotation.color || prefs.textboxStrokeColor;
      prefs.textboxFillColor = annotation.fillColor || prefs.textboxFillColor;
      prefs.textboxFillNone = !annotation.fillColor || annotation.fillColor === 'transparent';
      prefs.textboxBorderWidth = annotation.lineWidth ?? prefs.textboxBorderWidth;
      if (annotation.borderStyle) prefs.textboxBorderStyle = annotation.borderStyle;
      if (annotation.fontSize) prefs.textboxFontSize = annotation.fontSize;
      if (annotation.opacity !== undefined) prefs.textboxOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'callout':
      prefs.calloutStrokeColor = annotation.strokeColor || annotation.color || prefs.calloutStrokeColor;
      prefs.calloutFillColor = annotation.fillColor || prefs.calloutFillColor;
      prefs.calloutFillNone = !annotation.fillColor || annotation.fillColor === 'transparent';
      prefs.calloutBorderWidth = annotation.lineWidth ?? prefs.calloutBorderWidth;
      if (annotation.borderStyle) prefs.calloutBorderStyle = annotation.borderStyle;
      if (annotation.fontSize) prefs.calloutFontSize = annotation.fontSize;
      if (annotation.opacity !== undefined) prefs.calloutOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'polygon':
      prefs.polygonStrokeColor = annotation.strokeColor || annotation.color || prefs.polygonStrokeColor;
      prefs.polygonLineWidth = annotation.lineWidth ?? prefs.polygonLineWidth;
      if (annotation.opacity !== undefined) prefs.polygonOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'cloud':
      prefs.cloudStrokeColor = annotation.strokeColor || annotation.color || prefs.cloudStrokeColor;
      prefs.cloudLineWidth = annotation.lineWidth ?? prefs.cloudLineWidth;
      if (annotation.opacity !== undefined) prefs.cloudOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'comment':
      prefs.commentColor = annotation.color || prefs.commentColor;
      if (annotation.icon) prefs.commentIcon = annotation.icon;
      break;
    case 'polyline':
      prefs.polylineStrokeColor = annotation.strokeColor || annotation.color || prefs.polylineStrokeColor;
      prefs.polylineLineWidth = annotation.lineWidth ?? prefs.polylineLineWidth;
      if (annotation.opacity !== undefined) prefs.polylineOpacity = Math.round(annotation.opacity * 100);
      break;
    case 'redaction':
      prefs.redactionOverlayColor = annotation.overlayColor || prefs.redactionOverlayColor;
      break;
    case 'measureDistance':
    case 'measureArea':
    case 'measurePerimeter':
      prefs.measureStrokeColor = annotation.strokeColor || annotation.color || prefs.measureStrokeColor;
      prefs.measureLineWidth = annotation.lineWidth ?? prefs.measureLineWidth;
      if (annotation.opacity !== undefined) prefs.measureOpacity = Math.round(annotation.opacity * 100);
      break;
  }

  savePreferences();
  updateStatusMessage('Style set as default');
}

// Reset preferences to defaults
export async function resetPreferencesToDefaults() {
  state.preferences = { ...DEFAULT_PREFERENCES };
  // Restore OS username as default author
  try {
    const username = isTauri() ? await getUsername() : 'User';
    state.preferences.authorName = username;
  } catch (e) {
    state.preferences.authorName = 'User';
  }
  savePreferences();
}
