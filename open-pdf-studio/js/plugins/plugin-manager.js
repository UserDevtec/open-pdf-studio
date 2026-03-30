/**
 * Plugin Manager
 *
 * Discovers, loads, and manages plugins. Supports:
 *   - Built-in plugins (statically imported)
 *   - Installed plugins (loaded from app data directory via Tauri)
 */

import { createPluginApi } from './plugin-api.js';

const loadedPlugins = new Map(); // id -> { manifest, api, module }

/**
 * Load and activate a plugin module.
 * Module must export: { manifest: { id, name, version, ... }, activate(api), deactivate() }
 */
export function loadPlugin(pluginModule) {
  const { manifest } = pluginModule;
  if (!manifest || !manifest.id) {
    console.error('[plugin-manager] Plugin has no manifest or id');
    return false;
  }

  if (loadedPlugins.has(manifest.id)) {
    console.warn(`[plugin-manager] Plugin "${manifest.id}" is already loaded`);
    return false;
  }

  const api = createPluginApi(manifest.id);

  try {
    if (pluginModule.activate) {
      pluginModule.activate(api);
    }
    loadedPlugins.set(manifest.id, { manifest, api, module: pluginModule });
    return true;
  } catch (err) {
    console.error(`[plugin-manager] Failed to activate plugin "${manifest.id}":`, err);
    api._cleanup();
    return false;
  }
}

/**
 * Unload and deactivate a plugin.
 */
export function unloadPlugin(pluginId) {
  const entry = loadedPlugins.get(pluginId);
  if (!entry) return false;

  try {
    if (entry.module.deactivate) {
      entry.module.deactivate();
    }
  } catch (err) {
    console.error(`[plugin-manager] Error deactivating plugin "${pluginId}":`, err);
  }

  entry.api._cleanup();
  loadedPlugins.delete(pluginId);
  console.log(`[plugin-manager] Unloaded plugin: ${pluginId}`);
  return true;
}

/**
 * Get list of loaded plugins.
 */
export function getLoadedPlugins() {
  return [...loadedPlugins.values()].map(e => ({
    id: e.manifest.id,
    name: e.manifest.name,
    version: e.manifest.version,
    description: e.manifest.description,
    author: e.manifest.author,
    builtin: e.manifest.builtin || false
  }));
}

/**
 * Check if a plugin is loaded.
 */
export function isPluginLoaded(pluginId) {
  return loadedPlugins.has(pluginId);
}

/**
 * Reinstall a plugin from a new .oppx file: unload, install from file, re-activate.
 */
export async function reinstallPlugin(pluginId, filePath) {
  unloadPlugin(pluginId);
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const manifest = await invoke('install_plugin', { path: filePath });
    const pluginCode = await invoke('read_plugin_file', {
      pluginId: manifest.id,
      filePath: 'index.js'
    });
    const blob = new Blob([pluginCode], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const pluginModule = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);
    loadPlugin({ manifest, ...pluginModule });
    console.log(`[plugin-manager] Reinstalled plugin: ${manifest.name} v${manifest.version}`);
    return manifest;
  } catch (err) {
    console.error(`[plugin-manager] Failed to reinstall plugin "${pluginId}":`, err);
    throw err;
  }
}

/**
 * Install a plugin from a .oppx file path (Tauri command).
 * Returns the manifest on success.
 */
export async function installPluginFromFile(filePath) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const manifest = await invoke('install_plugin', { path: filePath });
    return manifest;
  } catch (err) {
    console.error('[plugin-manager] Failed to install plugin:', err);
    throw err;
  }
}

/**
 * Get list of installed plugins from the plugins directory.
 */
export async function getInstalledPlugins() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('list_plugins');
  } catch (err) {
    console.error('[plugin-manager] Failed to list plugins:', err);
    return [];
  }
}

/**
 * Load installed plugins from the app data plugins directory.
 */
export async function loadInstalledPlugins() {
  const installed = await getInstalledPlugins();
  for (const manifest of installed) {
    if (loadedPlugins.has(manifest.id)) continue;
    try {
      // Dynamically import the plugin's index.js
      const { invoke } = await import('@tauri-apps/api/core');
      const pluginCode = await invoke('read_plugin_file', {
        pluginId: manifest.id,
        filePath: 'index.js'
      });
      // Create a blob URL and import it
      const blob = new Blob([pluginCode], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      const pluginModule = await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
      loadPlugin({ manifest, ...pluginModule });
    } catch (err) {
      console.error(`[plugin-manager] Failed to load installed plugin "${manifest.id}":`, err);
    }
  }
}

/**
 * Initialize all plugins (built-in + installed).
 */
export async function initPlugins() {
  // Load installed plugins from filesystem
  await loadInstalledPlugins();
}
