import { useTranslation } from '../../../i18n/useTranslation.js';

export default function PageDisplayTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.rendering')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.thinLines[0]()} onChange={e => p.thinLines[1](e.target.checked)} />
            <span>{t('pageDisplay.thinLines')}</span>
          </label>
        </div>
      </fieldset>
      <fieldset class="pref-fieldset">
        <legend>{t('pageDisplay.panels')}</legend>
        <div class="pref-row pref-checkbox-row">
          <label class="pref-checkbox-label">
            <input type="checkbox" checked={p.propertiesPanelVisible[0]()} onChange={e => p.propertiesPanelVisible[1](e.target.checked)} />
            <span>{t('pageDisplay.showPropertiesPanel')}</span>
          </label>
        </div>
      </fieldset>
    </>
  );
}
