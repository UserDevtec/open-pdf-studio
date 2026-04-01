import { useTranslation } from '../../../i18n/useTranslation.js';
import { LANGUAGES } from '../../../i18n/config.js';
import PrefSelect from './PrefSelect.jsx';
import LanguageSelect from './LanguageSelect.jsx';

export default function GeneralTab(props) {
  const { t } = useTranslation('preferences');
  const { t: tRibbon } = useTranslation('ribbon');
  const p = props.prefs;

  const languageOptions = LANGUAGES.map(lang => ({
    value: lang.code,
    label: lang.code === 'auto' ? 'Auto-detect' : `${lang.englishName} (${lang.name})`
  }));

  const themeOptions = [
    { value: 'default', label: tRibbon('theme.default') },
    { value: 'light', label: tRibbon('theme.light') },
    { value: 'dark', label: tRibbon('theme.dark') },
    { value: 'blue', label: tRibbon('theme.blue') },
    { value: 'amber-navy', label: tRibbon('theme.amberNavy') },
    { value: 'warm-ember', label: tRibbon('theme.warmEmber') },
    { value: 'highContrast', label: tRibbon('theme.highContrast') },
  ];

  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('general.language')}</legend>
        <div class="pref-row">
          <label>{t('general.interfaceLanguage')}</label>
          <LanguageSelect value={p.language[0]} setValue={p.language[1]} options={languageOptions} style={{ width: '220px' }} />
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('general.theme')}</legend>
        <div class="pref-row">
          <label>{t('general.applicationTheme')}</label>
          <PrefSelect value={p.theme[0]} setValue={p.theme[1]} options={themeOptions} style={{ width: '140px' }} />
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
