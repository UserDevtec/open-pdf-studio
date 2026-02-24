import { For } from 'solid-js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { LANGUAGES } from '../../../i18n/config.js';

export default function GeneralTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tRibbon } = useTranslation('ribbon');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('general.language')}</legend>
        <div class="pref-row">
          <label>{t('general.interfaceLanguage')}</label>
          <select style="width:180px;" value={p.language[0]()} onChange={e => p.language[1](e.target.value)}>
            <For each={LANGUAGES}>
              {(lang) => <option value={lang.code}>{lang.code === 'auto' ? 'Auto-detect' : lang.name}</option>}
            </For>
          </select>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.theme')}</legend>
        <div class="pref-row">
          <label>{t('general.applicationTheme')}</label>
          <select style="width:120px;" value={p.theme[0]()} onChange={e => p.theme[1](e.target.value)}>
            <option value="system">{tRibbon('theme.system')}</option>
            <option value="light">{tRibbon('theme.light')}</option>
            <option value="dark">{tRibbon('theme.dark')}</option>
            <option value="blue">{tRibbon('theme.blue')}</option>
            <option value="highContrast">{tRibbon('theme.highContrast')}</option>
          </select>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.startup')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.restoreLastSession[0]()} onChange={e => p.restoreLastSession[1](e.target.checked)} />
            <span>{t('general.restoreLastSession')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.author')}</legend>
        <div class="pref-row">
          <label>{t('general.defaultAuthorName')}</label>
          <input type="text" value={p.authorName[0]()} onInput={e => p.authorName[1](e.target.value)} />
        </div>
      </fieldset>
    </>
  );
}
