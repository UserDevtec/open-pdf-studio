import { createSignal, For, Show, onMount } from 'solid-js';
import { closeAppMenu } from '../../stores/appMenuStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { getLoadedPlugins, installPluginFromFile, loadInstalledPlugins, unloadPlugin } from '../../../plugins/plugin-manager.js';
import { isTauri } from '../../../core/platform.js';

export default function ExtensionsPanel() {
  const { t } = useTranslation('appMenu');
  const [plugins, setPlugins] = createSignal([]);
  const [installing, setInstalling] = createSignal(false);
  const [message, setMessage] = createSignal(null);

  function refreshList() {
    setPlugins(getLoadedPlugins());
  }

  onMount(refreshList);

  async function handleInstall() {
    if (!isTauri()) return;
    setInstalling(true);
    setMessage(null);

    try {
      const result = await window.__TAURI__.dialog.open({
        multiple: false,
        filters: [{ name: 'Extension Package', extensions: ['oppx'] }]
      });

      if (!result) {
        setInstalling(false);
        return;
      }

      const manifest = await installPluginFromFile(result);
      // Reload installed plugins so the new one activates
      await loadInstalledPlugins();
      refreshList();
      setMessage({ type: 'success', text: t('extensionsPanel.installSuccess').replace('{{name}}', manifest.name || manifest.id) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.installError')}: ${err}` });
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall(pluginId, pluginName) {
    if (!isTauri()) return;

    try {
      const confirmed = window.__TAURI__?.dialog?.ask
        ? await window.__TAURI__.dialog.ask(
            t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName),
            { title: t('extensionsPanel.title'), kind: 'warning' }
          )
        : confirm(t('extensionsPanel.confirmUninstall').replace('{{name}}', pluginName));

      if (!confirmed) return;

      // Unload from runtime
      unloadPlugin(pluginId);

      // Remove from disk
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('uninstall_plugin', { id: pluginId });

      refreshList();
      setMessage({ type: 'success', text: t('extensionsPanel.uninstallSuccess').replace('{{name}}', pluginName) });
    } catch (err) {
      setMessage({ type: 'error', text: `${t('extensionsPanel.uninstallError')}: ${err}` });
    }
  }

  return (
    <div class="bs-export-panel">
      <h2 class="bs-export-title">{t('extensionsPanel.title')}</h2>

      <Show when={message()}>
        <div class={`ext-message ext-message-${message().type}`}>
          {message().text}
        </div>
      </Show>

      <div class="ext-install-section">
        <button class="ext-install-btn" onClick={handleInstall} disabled={installing()}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {installing() ? t('extensionsPanel.installing') : t('extensionsPanel.installFromFile')}
        </button>
        <p class="ext-install-hint">{t('extensionsPanel.installHint')}</p>
      </div>

      <div class="ext-divider" />

      <h3 class="ext-section-title">{t('extensionsPanel.installed')}</h3>

      <Show when={plugins().length === 0}>
        <p class="ext-empty">{t('extensionsPanel.noExtensions')}</p>
      </Show>

      <div class="ext-list">
        <For each={plugins()}>
          {(plugin) => (
            <div class="ext-card">
              <div class="ext-card-icon">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
                </svg>
              </div>
              <div class="ext-card-info">
                <div class="ext-card-header">
                  <h4 class="ext-card-name">{plugin.name}</h4>
                  <span class="ext-card-version">v{plugin.version}</span>
                </div>
                <Show when={plugin.description}>
                  <p class="ext-card-desc">{plugin.description}</p>
                </Show>
                <Show when={plugin.author}>
                  <p class="ext-card-author">{t('extensionsPanel.by')} {plugin.author}</p>
                </Show>
              </div>
              <Show when={!plugin.builtin}>
                <button class="ext-uninstall-btn" onClick={() => handleUninstall(plugin.id, plugin.name)} title={t('extensionsPanel.uninstall')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                  </svg>
                </button>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
