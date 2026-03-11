import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function LineEndingsSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.lineEndings}>
      <CollapsibleSection title={t('lineEndings.title')} name="lineEndings" id="prop-line-endings-section">
        <div class="property-group">
          <label>{t('lineEndings.start')}</label>
          <select value={annotProps.startHead} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('startHead', e.target.value)}>
            <Show when={annotProps.startHead === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="square">{t('lineEndings.square')}</option>
            <option value="circle">{t('lineEndings.circle')}</option>
            <option value="diamond">{t('lineEndings.diamond')}</option>
            <option value="open">{t('lineEndings.openArrow')}</option>
            <option value="closed">{t('lineEndings.closedArrow')}</option>
            <option value="butt">{t('lineEndings.butt')}</option>
            <option value="openReversed">{t('lineEndings.openArrowReversed')}</option>
            <option value="closedReversed">{t('lineEndings.closedArrowReversed')}</option>
            <option value="slash">{t('lineEndings.slash')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('lineEndings.end')}</label>
          <select value={annotProps.endHead} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('endHead', e.target.value)}>
            <Show when={annotProps.endHead === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="square">{t('lineEndings.square')}</option>
            <option value="circle">{t('lineEndings.circle')}</option>
            <option value="diamond">{t('lineEndings.diamond')}</option>
            <option value="open">{t('lineEndings.openArrow')}</option>
            <option value="closed">{t('lineEndings.closedArrow')}</option>
            <option value="butt">{t('lineEndings.butt')}</option>
            <option value="openReversed">{t('lineEndings.openArrowReversed')}</option>
            <option value="closedReversed">{t('lineEndings.closedArrowReversed')}</option>
            <option value="slash">{t('lineEndings.slash')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('lineEndings.headSize')}</label>
          <PrefComboBox
            value={() => annotProps.headSize}
            setValue={(val) => updateAnnotProp('headSize', val)}
            options={[4, 6, 8, 10, 12, 16, 20, 24, 32]}
            min={1} max={40} fallback={1} suffix="pt"
            disabled={isLocked}
          />
        </div>
      </CollapsibleSection>
    </Show>
  );
}
