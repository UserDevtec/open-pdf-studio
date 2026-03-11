/**
 * Tauri API wrapper module
 * Provides a unified interface for Tauri 2.x APIs
 * Uses the global __TAURI__ object instead of ES module imports
 */

// Extract a display-friendly file name from a path or content:// URI
export function extractFileName(pathOrUri) {
  if (!pathOrUri) return 'Document';
  // content:// URIs: try to decode and extract last segment
  if (pathOrUri.startsWith('content://')) {
    const decoded = decodeURIComponent(pathOrUri);
    // Try common patterns: .../document/primary:Download/file.pdf or raw:/storage/.../file.pdf
    const match = decoded.match(/[/:]([^/:]+\.pdf)$/i);
    if (match) return match[1];
    // Fallback: last path segment
    const segments = decoded.split(/[/:]+/).filter(Boolean);
    return segments[segments.length - 1] || 'Document';
  }
  // Regular filesystem path
  const parts = pathOrUri.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || 'Document';
}

// Check if running in Tauri
export const isTauri = () => {
  return typeof window !== 'undefined' && window.__TAURI__ !== undefined;
};

// Detect mobile platform (Android/iOS) — cached at first call
// Add ?mobile to the URL to force mobile layout for testing in browser
let _isMobile = null;
export function isMobile() {
  if (_isMobile !== null) return _isMobile;
  // Allow forcing mobile mode via URL param for dev/testing
  if (new URLSearchParams(window.location.search).has('mobile')) {
    _isMobile = true;
    return _isMobile;
  }
  try {
    if (isTauri() && window.__TAURI__.os) {
      const osType = window.__TAURI__.os.type();
      _isMobile = (osType === 'android' || osType === 'ios');
    } else {
      _isMobile = false;
    }
  } catch {
    _isMobile = false;
  }
  return _isMobile;
}

// Get Tauri APIs from global object
function getTauriWindow() {
  if (!isTauri()) return null;
  return window.__TAURI__.window;
}

function getTauriCore() {
  if (!isTauri()) return null;
  return window.__TAURI__.core;
}

// Window controls
export async function minimizeWindow() {
  if (!isTauri()) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    await currentWindow.minimize();
  }
}

export async function maximizeWindow() {
  if (!isTauri()) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    const isMaximized = await currentWindow.isMaximized();
    if (isMaximized) {
      await currentWindow.unmaximize();
    } else {
      await currentWindow.maximize();
    }
  }
}

export async function closeWindow() {
  if (!isTauri()) return;
  const win = getTauriWindow();
  if (win) {
    const currentWindow = win.getCurrentWindow();
    await currentWindow.destroy();
  }
}

// File dialogs - using Tauri commands since plugin APIs may not be globally available
export async function openFileDialog() {
  if (!isTauri()) return null;

  // Try using the dialog plugin via window.__TAURI__.dialog
  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
      });
      return result;
    } catch (e) {
      console.error('Dialog plugin error:', e);
    }
  }

  // Fallback: use invoke to call a custom command
  return await invoke('open_file_dialog');
}

export async function saveFileDialog(defaultPath, filters) {
  if (!isTauri()) return null;

  if (!filters) {
    filters = [{ name: 'PDF Files', extensions: ['pdf'] }];
  }

  // Try using the dialog plugin
  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.save({
        defaultPath: defaultPath,
        filters: filters
      });
      return result;
    } catch (e) {
      console.error('Dialog plugin error:', e);
    }
  }

  return null;
}

// Folder picker dialog
export async function openFolderDialog(title) {
  if (!isTauri()) return null;

  if (window.__TAURI__.dialog) {
    try {
      const result = await window.__TAURI__.dialog.open({
        directory: true,
        multiple: false,
        title: title || 'Select Folder'
      });
      return result;
    } catch (e) {
      console.error('Dialog plugin error:', e);
    }
  }

  return null;
}

// File system operations
export async function readBinaryFile(path) {
  if (!isTauri()) return null;

  // Use the fs plugin directly
  if (window.__TAURI__.fs) {
    return await window.__TAURI__.fs.readFile(path);
  }

  throw new Error('FS plugin not available');
}

export async function writeBinaryFile(path, data) {
  if (!isTauri()) return false;

  // Use the fs plugin directly - no fallback to slow base64 method
  if (window.__TAURI__.fs) {
    await window.__TAURI__.fs.writeFile(path, data);
    return true;
  }

  throw new Error('FS plugin not available');
}

export async function fileExists(path) {
  if (!isTauri()) return false;

  // Try using the fs plugin
  if (window.__TAURI__.fs) {
    try {
      await window.__TAURI__.fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  // Fallback: use invoke
  return await invoke('file_exists', { path });
}

// Shell operations
export async function openExternal(url) {
  if (!isTauri()) {
    window.open(url, '_blank');
    return;
  }

  // Try using the shell plugin
  if (window.__TAURI__.shell) {
    try {
      await window.__TAURI__.shell.open(url);
      return;
    } catch (e) {
      console.error('Shell plugin error:', e);
    }
  }

  // Fallback: use invoke
  await invoke('open_url', { url });
}

// Invoke custom commands
export async function invoke(cmd, args = {}) {
  if (!isTauri()) return null;
  const core = getTauriCore();
  if (core) {
    return await core.invoke(cmd, args);
  }
  return null;
}

// Resolve raw OS type + version into a human-friendly name
const WINDOWS_BUILDS = [
  [22000, 'Windows 11'],
  [0,     'Windows 10'],
];
const WINDOWS_VERSIONS = [
  [6, 3, 'Windows 8.1'],
  [6, 2, 'Windows 8'],
  [6, 1, 'Windows 7'],
  [6, 0, 'Windows Vista'],
  [5, 2, 'Windows XP x64'],
  [5, 1, 'Windows XP'],
];
const MACOS_NAMES = {
  26: 'Tahoe',      25: 'Tahoe',
  15: 'Sequoia',    14: 'Sonoma',     13: 'Ventura',
  12: 'Monterey',   11: 'Big Sur',
};
const MACOS_10_NAMES = {
  15: 'Catalina',   14: 'Mojave',     13: 'High Sierra',
  12: 'Sierra',     11: 'El Capitan', 10: 'Yosemite',
  9:  'Mavericks',  8:  'Mountain Lion', 7: 'Lion',
  6:  'Snow Leopard', 5: 'Leopard',   4: 'Tiger',
  3:  'Panther',    2:  'Jaguar',     1: 'Puma',
  0:  'Cheetah',
};

function resolveOsInfo(rawType, rawVersion) {
  const type = (rawType || '').toLowerCase();
  const parts = rawVersion.split('.').map(p => parseInt(p) || 0);
  const [major, minor, build] = parts;

  if (type === 'windows') {
    if (major === 10 && minor === 0) {
      for (const [minBuild, name] of WINDOWS_BUILDS) {
        if (build >= minBuild) return { name, version: String(build) };
      }
    }
    for (const [maj, min, name] of WINDOWS_VERSIONS) {
      if (major === maj && minor === min) return { name, version: rawVersion };
    }
    return { name: 'Windows', version: rawVersion };
  }

  if (type === 'macos' || type === 'darwin') {
    if (major === 10) {
      const sub = MACOS_10_NAMES[minor];
      return { name: sub ? `macOS ${sub}` : 'macOS', version: rawVersion };
    }
    const name = MACOS_NAMES[major];
    return { name: name ? `macOS ${name}` : 'macOS', version: rawVersion };
  }

  if (type === 'linux')   return { name: 'Linux', version: rawVersion };
  if (type === 'android') return { name: 'Android', version: rawVersion };
  if (type === 'ios')     return { name: 'iOS', version: rawVersion };

  return { name: rawType || 'Unknown', version: rawVersion };
}

// Get OS info as { name, version, arch, locale } — cached after first call
let _osInfoCache = null;
export async function getOsInfo() {
  if (_osInfoCache) return _osInfoCache;
  if (!isTauri()) {
    _osInfoCache = { name: 'Browser', version: '', arch: '', locale: '' };
    return _osInfoCache;
  }
  try {
    const os = await import('@tauri-apps/plugin-os');
    const resolved = resolveOsInfo(os.type(), os.version());
    _osInfoCache = {
      name: resolved.name,
      version: resolved.version,
      arch: os.arch() || '',
      locale: os.locale() || '',
    };
  } catch {
    _osInfoCache = { name: 'Unknown', version: '', arch: '', locale: '' };
  }
  return _osInfoCache;
}

// Build a User-Agent string for API requests
export async function buildUserAgent() {
  const ver = await getAppVersion() || '0.0.0';
  const os = await getOsInfo();
  return `OpenPDFStudio/${ver} (${os.name} ${os.version}; ${os.arch})`.replace(/\s+/g, ' ').trim();
}

// Get app version from Tauri config
export async function getAppVersion() {
  if (!isTauri()) return null;
  try {
    return await window.__TAURI__.app.getVersion();
  } catch {
    return null;
  }
}

// Check if running in dev/debug mode
export async function isDevMode() {
  try {
    return await invoke('is_dev_mode') === true;
  } catch {
    return false;
  }
}

// Get files opened via command line
export async function getOpenedFiles() {
  return await invoke('get_opened_file');
}

// Session management
export async function saveSession(data) {
  return await invoke('save_session', { data: JSON.stringify(data) });
}

export async function loadSession() {
  const result = await invoke('load_session');
  if (result) {
    try {
      return JSON.parse(result);
    } catch {
      return null;
    }
  }
  return null;
}

// Preferences file storage (Rust-backed, survives WebView2 data clears)
export async function savePreferencesFile(data) {
  return await invoke('save_preferences', { data: JSON.stringify(data) });
}

export async function loadPreferencesFile() {
  const result = await invoke('load_preferences');
  if (result) {
    try { return JSON.parse(result); } catch { return null; }
  }
  return null;
}

// Get system username
export async function getUsername() {
  const result = await invoke('get_username');
  return result || 'User';
}

// Check if this app is the default PDF handler
export async function isDefaultPdfApp() {
  try {
    return await invoke('is_default_pdf_app') === true;
  } catch {
    return false;
  }
}

// Open Windows Default Apps settings page
export async function openDefaultAppsSettings() {
  try {
    return await invoke('open_default_apps_settings');
  } catch (e) {
    console.warn('Failed to open default apps settings:', e);
    return false;
  }
}

// Download a PDF from URL to a temp file
export async function downloadPdfFromUrl(url) {
  return await invoke('download_pdf_from_url', { url });
}

// List PDF files in a directory
export async function listPdfFiles(dir) {
  return await invoke('list_pdf_files', { dir });
}

// File locking - prevent other apps from writing to an open file
export async function lockFile(path) {
  try {
    return await invoke('lock_file', { path });
  } catch (e) {
    console.warn('Failed to lock file:', e);
    return false;
  }
}

export async function renameFile(oldPath, newPath) {
  return await invoke('rename_file', { oldPath, newPath });
}

export async function unlockFile(path) {
  try {
    return await invoke('unlock_file', { path });
  } catch (e) {
    console.warn('Failed to unlock file:', e);
    return false;
  }
}
