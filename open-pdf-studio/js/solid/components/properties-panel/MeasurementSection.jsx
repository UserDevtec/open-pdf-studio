import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function MeasurementSection() {
  const { t } = useTranslation('properties');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.measurement}>
      <CollapsibleSection title={t('measurement.title')} name="measurement" id="prop-measurement-section">
        <div class="property-group">
          <label>{t('measurement.scale')}</label>
          <input type="number" step="0.001" min="0"
            value={annotProps.measureScale}
            disabled={isLocked()}
            onChange={(e) => updateAnnotProp('measureScale', e.target.value)}
          />
        </div>

        <div class="property-group">
          <label>{t('measurement.unit')}</label>
          <select value={annotProps.measureUnit} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('measureUnit', e.target.value)}>
            <option value="mm">mm</option>
            <option value="cm">cm</option>
            <option value="m">m</option>
            <option value="in">in</option>
            <option value="ft">ft</option>
            <option value="pt">pt</option>
            <option value="px">px</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('measurement.precision')}</label>
          <select value={annotProps.measurePrecision} disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('measurePrecision', e.target.value)}>
            <option value="0">1</option>
            <option value="1">0.1</option>
            <option value="2">0.01</option>
            <option value="3">0.001</option>
            <option value="4">0.0001</option>
            <option value="5">0.00001</option>
            <option value="6">0.000001</option>
            <option value="7">0.0000001</option>
            <option value="8">0.00000001</option>
            <option value="9">0.000000001</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
