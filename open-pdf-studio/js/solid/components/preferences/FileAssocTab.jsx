import { createSignal, onMount } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openExternal } from '../../../core/platform.js';

export default function FileAssocTab() {
  const { t } = useTranslation('preferences');
  const { t: tCommon } = useTranslation('common');
  const [currentApp, setCurrentApp] = createSignal(tCommon('checking'));

  onMount(() => {
    checkDefaultPdfApp();
  });

  async function checkDefaultPdfApp() {
    try {
      const os = require('os');
      const platform = os.platform();

      if (platform === 'win32') {
        const { exec } = require('child_process');
        exec('reg query "HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\.pdf\\UserChoice" /v ProgId', (err, stdout) => {
          if (err) { setCurrentApp(tCommon('unableToDetect')); return; }
          const match = stdout.match(/ProgId\s+REG_SZ\s+(.+)/);
          if (match) {
            let appName = match[1].trim();
            if (appName.includes('AcroExch') || appName.includes('Acrobat')) appName = 'Adobe Acrobat';
            else if (appName.includes('Edge')) appName = 'Microsoft Edge';
            else if (appName.includes('Chrome')) appName = 'Google Chrome';
            else if (appName.includes('Firefox')) appName = 'Mozilla Firefox';
            else if (appName.includes('OpenPDFStudio') || appName.includes('open-pdf-studio')) appName = tCommon('appName');
            else if (appName.includes('SumatraPDF')) appName = 'SumatraPDF';
            setCurrentApp(appName);
          } else {
            setCurrentApp(t('fileAssoc.notSet'));
          }
        });
      } else if (platform === 'darwin') {
        setCurrentApp(t('fileAssoc.checkFinder'));
      } else {
        const { exec } = require('child_process');
        exec('xdg-mime query default application/pdf', (err, stdout) => {
          if (err || !stdout.trim()) { setCurrentApp(t('fileAssoc.notSet')); return; }
          setCurrentApp(stdout.trim().replace('.desktop', ''));
        });
      }
    } catch {
      setCurrentApp(tCommon('unableToDetect'));
    }
  }

  async function handleSetDefault() {
    const platform = navigator.platform.toLowerCase();
    if (platform.includes('win')) {
      try {
        await openExternal('ms-settings:defaultapps');
        alert(t('fileAssoc.windowsInstructions'));
      } catch {
        alert(t('fileAssoc.windowsFailed'));
      }
    } else if (platform.includes('mac')) {
      alert(t('fileAssoc.macInstructions'));
    } else {
      alert(t('fileAssoc.linuxInstructions'));
    }
  }

  return (
    <fieldset class="pref-fieldset">
      <legend>{t('fileAssoc.defaultPdfApplication')}</legend>
      <div class="pref-row">
        <label>{t('fileAssoc.currentDefault')}</label>
        <span style="font-size:11px;color:var(--theme-text-secondary, #666);">{currentApp()}</span>
      </div>
      <div class="pref-row" style="margin-top:12px;">
        <button type="button" class="pref-btn pref-btn-secondary" style="width:100%;" onClick={handleSetDefault}>
          {t('fileAssoc.setDefault')}
        </button>
      </div>
      <p style="font-size:10px;color:var(--theme-text-secondary, #888);margin-top:12px;line-height:1.4;">
        {t('fileAssoc.setDefaultHelp')}
      </p>
    </fieldset>
  );
}
