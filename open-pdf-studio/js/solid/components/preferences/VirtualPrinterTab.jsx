import { createSignal, onMount } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function VirtualPrinterTab() {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const [status, setStatus] = createSignal(tCommon('checking'));
  const [statusColor, setStatusColor] = createSignal('#666');
  const [showInstall, setShowInstall] = createSignal(false);
  const [showRemove, setShowRemove] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    checkStatus();
  });

  async function checkStatus() {
    setShowInstall(false);
    setShowRemove(false);
    try {
      const { invoke } = await import('../../../core/platform.js');
      const installed = await invoke('is_virtual_printer_installed');
      if (installed) {
        setStatus(tCommon('installed'));
        setStatusColor('#2e7d32');
        setShowRemove(true);
      } else {
        setStatus(tCommon('notInstalled'));
        setStatusColor('#666');
        setShowInstall(true);
      }
    } catch {
      setStatus(tCommon('unableToDetect'));
      setStatusColor('#888');
      setShowInstall(true);
    }
  }

  async function handleInstall() {
    setStatus(t('virtualPrinter.installing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('install_virtual_printer');
      setStatus(tCommon('installed'));
      setStatusColor('#2e7d32');
      setShowInstall(false);
      setShowRemove(true);
    } catch (err) {
      setStatus(t('virtualPrinter.installationFailed'));
      setStatusColor('#c62828');
      alert(t('virtualPrinter.failedToInstall') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  async function handleRemove() {
    setStatus(t('virtualPrinter.removing'));
    setBusy(true);
    try {
      const { invoke } = await import('../../../core/platform.js');
      await invoke('remove_virtual_printer');
      setStatus(tCommon('notInstalled'));
      setStatusColor('#666');
      setShowRemove(false);
      setShowInstall(true);
    } catch (err) {
      setStatus(t('virtualPrinter.removalFailed'));
      setStatusColor('#c62828');
      alert(t('virtualPrinter.failedToRemove') + '\n' + (err.message || err));
    }
    setBusy(false);
  }

  return (
    <fieldset class="pref-fieldset">
      <legend>{t('virtualPrinter.title')}</legend>
      <p style="font-size:11px;color:var(--theme-text-secondary, #555);margin-bottom:12px;line-height:1.4;">
        {t('virtualPrinter.description')}
      </p>
      <div class="pref-row">
        <label>{t('virtualPrinter.status')}</label>
        <span style={{ 'font-size': '11px', color: statusColor() }}>{status()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        {showInstall() && (
          <button type="button" class="pref-btn pref-btn-primary" style="width:100%;" onClick={handleInstall} disabled={busy()}>
            {t('virtualPrinter.installButton')}
          </button>
        )}
        {showRemove() && (
          <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;" onClick={handleRemove} disabled={busy()}>
            {t('virtualPrinter.removeButton')}
          </button>
        )}
      </div>
      <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:12px;line-height:1.4;">
        {t('virtualPrinter.installNote')}
      </p>
    </fieldset>
  );
}
