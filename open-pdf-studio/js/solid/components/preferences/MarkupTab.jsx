import { useTranslation } from '../../../i18n/useTranslation.js';
import PrefColorPicker from './PrefColorPicker.jsx';
import PrefComboBox from './PrefComboBox.jsx';

export default function MarkupTab(props) {
  const { t } = useTranslation('preferences');
  const p = props.prefs;
  return (
    <>
      <fieldset class="pref-fieldset">
        <legend>{t('markup.redactionDefaults')}</legend>
        <div class="pref-row">
          <label>{t('markup.overlayColor')}</label>
          <PrefColorPicker value={p.redactionOverlayColor[0]} setValue={p.redactionOverlayColor[1]} />
        </div>
      </fieldset>

      <fieldset class="pref-fieldset">
        <legend>{t('markup.measurementDefaults')}</legend>
        <div class="pref-row">
          <label>{t('markup.strokeColor')}</label>
          <PrefColorPicker value={p.measureStrokeColor[0]} setValue={p.measureStrokeColor[1]} />
        </div>
        <div class="pref-row">
          <label>{t('markup.lineWidth')}</label>
          <PrefComboBox value={p.measureLineWidth[0]} setValue={p.measureLineWidth[1]} options={[0.5,1,2,3,4,6,8,10,12]} min={0.5} max={20} fallback={1} suffix="pt" />
        </div>
        <div class="pref-row">
          <label>{t('markup.opacity')}</label>
          <PrefComboBox value={p.measureOpacity[0]} setValue={p.measureOpacity[1]} min={10} max={100} fallback={100} />
        </div>
        <div class="pref-row">
          <label>{t('markup.measureRounding')}</label>
          <select value={p.measureRounding[0]()} onChange={e => p.measureRounding[1](e.target.value)}>
            <option value="none">{t('markup.roundingNone')}</option>
            <option value="1">{t('markup.rounding1mm')}</option>
            <option value="5">{t('markup.rounding5mm')}</option>
            <option value="10">{t('markup.rounding10mm')}</option>
          </select>
        </div>
      </fieldset>
    </>
  );
}
