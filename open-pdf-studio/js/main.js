/**
 * PDF Annotator - Main Entry Point
 *
 * Single Solid.js render() call mounts the entire UI tree.
 * Canvas/PDF operations remain vanilla JS.
 */

// Core modules
import { state } from './core/state.js';
import { loadPreferences, savePreferences } from './core/preferences.js';
import { initDomElements } from './ui/dom-elements.js';
import { initPropertiesPanel } from './ui/panels/properties-panel.js';
import { initToolPalette } from './solid/components/ToolPalette.jsx';
import { initPaletteOrder } from './solid/stores/paletteOrder.js';
import { initPlugins } from './plugins/plugin-manager.js';

// UI initialization
import { initMenus } from './ui/chrome/menus.js';
import { initContextMenus } from './ui/chrome/context-menus.js';
import { initAnnotationsList } from './ui/panels/annotations-list.js';
import { initAttachments } from './ui/panels/attachments.js';
import { initLinks } from './ui/panels/links.js';
import { initBookmarks } from './ui/panels/bookmarks.js';
import { initLeftPanel } from './ui/panels/left-panel.js';

// Event setup
import { setupEventListeners } from './ui/setup.js';

// PDF operations (for handling file drops from command line args)
import { loadPDF } from './pdf/loader.js';
import { fitPage } from './pdf/renderer.js';

// Text selection
import { initTextSelection } from './text/text-selection.js';

// Tab management
import { initTabs, createTab, switchToTab, closeActiveTab } from './ui/chrome/tabs.js';

// Search/Find
import { initFindBar } from './search/find-bar.js';

// Font utilities
import { initFontDropdowns } from './utils/fonts.js';

// Auto-update
import { checkForUpdates } from './ui/chrome/updater.js';

// i18n
import './i18n/config.js';

// Solid.js
import { render } from 'solid-js/web';
import App from './solid/App.jsx';

// Recent files (mobile)
import { addRecentFile } from './mobile/recent-files.js';

// Tauri API
import { isTauri, isMobile, isDevMode, getOpenedFiles, loadSession, saveSession, fileExists, isDefaultPdfApp, openDefaultAppsSettings, extractFileName } from './core/platform.js';

// Global promise queue — serializes all file loads across multiple openFiles() calls
// (Windows single-instance plugin sends separate open-files events per file)
let fileOpenQueue = Promise.resolve();

// Register open-files listener immediately (before init) so events from the
// single-instance plugin are never lost. Queue files until the app is ready.
let appReady = false;
let pendingOpenFiles = [];
if (window.__TAURI__?.event) {
  window.__TAURI__.event.listen('open-files', (event) => {
    const files = event.payload;
    if (!Array.isArray(files)) return;
    if (appReady) {
      openFiles(files);
    } else {
      pendingOpenFiles.push(...files);
    }
  });
}

// Open PDF files: tabs created instantly, loads serialized through global queue
function openFiles(filePaths) {
  // 1. Create all tabs instantly (synchronous) so the tab bar updates right away
  const pending = [];
  for (const filePath of filePaths) {
    if (filePath && filePath.toLowerCase().endsWith('.pdf')) {
      const { index } = createTab(filePath, false); // don't auto-switch
      pending.push({ filePath, index });
    }
  }
  // 2. Switch to the last new tab immediately (shows placeholder until load completes)
  if (pending.length > 0) {
    switchToTab(pending[pending.length - 1].index);
  }
  // 3. Chain loads onto the global queue (serialized even across multiple callers)
  for (const { filePath, index } of pending) {
    fileOpenQueue = fileOpenQueue.then(async () => {
      await loadPDF(filePath, index);
      addRecentFile(filePath, extractFileName(filePath));
    }).catch(e => console.warn('Failed to open file:', filePath, e));
  }
  return fileOpenQueue;
}

// Disable default browser context menu
function disableDefaultContextMenu() {
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    e.preventDefault();
  });
}

// Block browser/webview default shortcuts in production (Ctrl+I, Ctrl+U, Ctrl+G, etc.)
function disableBrowserShortcuts() {
  document.addEventListener('keydown', (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    if (!ctrl) return;

    // Browser shortcuts to block: inspect (I/Shift+I), view source (U), find (G/Shift+G), print (P is handled by app)
    const blocked = ['i', 'u', 'g', 'j'];
    if (blocked.includes(e.key.toLowerCase()) && !e.target.matches('input, textarea')) {
      e.preventDefault();
    }
    // Ctrl+Shift+I (DevTools), Ctrl+Shift+J (Console), Ctrl+Shift+C (Inspect element)
    if (e.shiftKey && ['I', 'J', 'C'].includes(e.key)) {
      e.preventDefault();
    }
    // F5 refresh, Ctrl+R refresh (allow in dev mode)
    if ((e.key === 'r' || e.key === 'R') && !window.__devMode) {
      e.preventDefault();
    }
  }, true);

  // Block F5/F12 at capture phase
  document.addEventListener('keydown', (e) => {
    if (e.key === 'F5') {
      e.preventDefault();
    }
  }, true);
}

// Initialize application
async function init() {
  const mobile = isMobile();

  // Disable context menu on desktop only (long-press is expected on mobile)
  if (!mobile) {
    disableDefaultContextMenu();
  }

  // Set dev mode flag before blocking shortcuts (allows Ctrl+R refresh in dev)
  if (isTauri()) {
    window.__devMode = await isDevMode();
  }

  // Block browser shortcuts (Ctrl+I, Ctrl+U, F5, etc.)
  if (isTauri() && !mobile) {
    disableBrowserShortcuts();
  }

  // Load user preferences (before render so theme is applied)
  await loadPreferences();

  // Single render call — mounts the entire UI tree
  // render() is synchronous, so DOM elements exist immediately after
  render(() => App(), document.getElementById('app-root'));

  // Restore properties panel visibility from preferences
  initPropertiesPanel();

  // Restore tool palette visibility, mode and position from preferences
  initPaletteOrder();
  initToolPalette();

  // Load installed plugins (extension palettes, custom annotation types, etc.)
  initPlugins();

  // Show the window after the browser has painted the first frame.
  // Double requestAnimationFrame ensures layout + paint have completed.
  if (isTauri() && window.__TAURI__?.window) {
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    try {
      const appWindow = window.__TAURI__.window.getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    } catch (e) {
      console.warn('Failed to show window:', e);
    }
  }

  // Now that Solid has rendered, grab canvas and container refs
  initDomElements();

  // Initialize UI components (desktop-only UI modules)
  if (!mobile) {
    initMenus();
    initContextMenus();
    initAnnotationsList();
    initAttachments();
    initLinks();
    initBookmarks();
    initLeftPanel();
    initFindBar();
    initFontDropdowns();
  }

  // Initialize text selection
  initTextSelection();

  // Initialize tab management
  initTabs();

  // Setup all event listeners
  setupEventListeners();

  // Setup session save on window close (desktop only — Android lifecycle handles this)
  if (!mobile) {
    setupSessionSaveOnClose();
  }

  // Listen for deep-link events on mobile (Android intent to open PDF)
  if (mobile && isTauri() && window.__TAURI__?.event) {
    try {
      window.__TAURI__.event.listen('deep-link://new-url', async (event) => {
        try {
          const urls = event.payload;
          if (urls && urls.length > 0) {
            let filePath = urls[0];
            // Strip file:// prefix if present
            if (filePath.startsWith('file://')) {
              filePath = decodeURIComponent(filePath.replace('file://', ''));
            }
            // Accept content:// URIs directly (Android picker uses opaque IDs that don't end in .pdf)
            if (filePath.startsWith('content://') || filePath.toLowerCase().endsWith('.pdf')) {
              const { index } = createTab(filePath);
              await new Promise(r => setTimeout(r, 0));
              initDomElements();
              await loadPDF(filePath, index);
              await fitPage();
              addRecentFile(filePath, extractFileName(filePath));
            }
          }
        } catch (e) {
          console.warn('Failed to handle deep-link:', e);
        }
      });
    } catch (e) {
      console.warn('Failed to setup deep-link listener:', e);
    }
  }

  // Check for file passed as command line argument
  const hasCommandLineFile = await checkCommandLineArgs();

  // Drain any files queued by the single-instance plugin before the app was ready
  if (pendingOpenFiles.length > 0 && !hasCommandLineFile) {
    openFiles(pendingOpenFiles);
  }
  pendingOpenFiles = [];
  appReady = true;

  // Restore last session if enabled and no command line file
  if (!hasCommandLineFile) {
    await restoreLastSession();
  }

  // Desktop-only: check default PDF app and auto-update (deferred to avoid blocking startup)
  if (!mobile) {
    setTimeout(() => checkDefaultPdfApp(), 3000);
    checkForUpdates(true);
  }
}

// Check for PDF files passed as command line arguments
async function checkCommandLineArgs() {
  if (!isTauri()) return false;

  try {
    const files = await getOpenedFiles();
    if (Array.isArray(files) && files.length > 0) {
      await openFiles(files);
      return true;
    }
  } catch (e) {
    console.warn('Failed to check command line args:', e);
  }
  return false;
}

// Save session data (open documents) before window closes
function setupSessionSaveOnClose() {
  if (isTauri()) {
    try {
      const win = window.__TAURI__?.window;
      if (win) {
        const currentWindow = win.getCurrentWindow();
        currentWindow.onCloseRequested(async (event) => {
          while (state.documents.length > 0) {
            const closed = await closeActiveTab();
            if (!closed) {
              event.preventDefault();
              return;
            }
          }
          await saveSessionData();
        });
      }
    } catch (e) {
      console.warn('Failed to setup close handler:', e);
    }
  }

  window.addEventListener('beforeunload', async () => {
    if (!isTauri()) return;
    await saveSessionData();
  });
}

// Save session data to disk
async function saveSessionData() {
  try {
    const openFiles = state.documents
      .filter(doc => doc.filePath)
      .map(doc => doc.filePath);

    const sessionData = {
      openFiles: openFiles,
      activeIndex: state.activeDocumentIndex
    };

    await saveSession(sessionData);
  } catch (e) {
    console.warn('Failed to save session:', e);
  }
}

// Restore last session if preference is enabled
async function restoreLastSession() {
  if (!state.preferences.restoreLastSession) {
    return;
  }

  if (!isTauri()) return;

  try {
    const sessionData = await loadSession();

    if (sessionData && sessionData.openFiles && sessionData.openFiles.length > 0) {
      // Filter to files that still exist, then open in parallel
      const validFiles = [];
      for (const filePath of sessionData.openFiles) {
        try {
          if (await fileExists(filePath)) {
            validFiles.push(filePath);
          }
        } catch (e) {
          console.warn('Failed to check file:', filePath, e);
        }
      }
      if (validFiles.length > 0) {
        await openFiles(validFiles);
      }
    }
  } catch (e) {
    console.warn('Failed to restore session:', e);
  }
}

// Check if this app is the default PDF handler and show info bar if not
async function checkDefaultPdfApp() {
  if (!isTauri()) return;
  if (state.preferences.dontAskDefaultPdf) return;

  try {
    const isDefault = await isDefaultPdfApp();
    if (isDefault) return;

    const { showDefaultAppBar } = await import('./solid/stores/defaultAppBarStore.js');
    showDefaultAppBar();
  } catch (e) {
    console.warn('Failed to check default PDF app:', e);
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
