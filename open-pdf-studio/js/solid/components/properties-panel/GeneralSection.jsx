import { Show } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function GeneralSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  return (
    <Show when={sectionVis.general}>
      <CollapsibleSection title={t('general.title')} name="general" id="prop-general-section">
        <div class="property-group">
          <label>{t('general.type')}</label>
          <input type="text" value={annotProps.typeDisplay} readonly />
        </div>

        <Show when={annotProps.id}>
          <div class="property-group">
            <label>ID</label>
            <input type="text" value={annotProps.id} readonly
              style="font-family: monospace; font-size: 11px;"
              onClick={(e) => e.target.select()} />
          </div>
        </Show>

        <div class="property-group">
          <label>{t('general.subject')}</label>
          <input type="text" value={annotProps.subject} placeholder={t('general.subjectPlaceholder')}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('subject', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.author')}</label>
          <input type="text" value={annotProps.author}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('author', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.created')}</label>
          <input type="text" value={annotProps.created} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>{t('general.modified')}</label>
          <input type="text" value={annotProps.modified} readonly class="prop-date" />
        </div>

        <div class="property-group">
          <label>{t('general.locked')}</label>
          <select value={annotProps.locked === 'mixed' ? 'mixed' : annotProps.locked ? 'yes' : 'no'}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('locked', e.target.value === 'yes')}>
            <Show when={annotProps.locked === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.printable')}</label>
          <select value={annotProps.printable === 'mixed' ? 'mixed' : annotProps.printable ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('printable', e.target.value === 'yes')}>
            <Show when={annotProps.printable === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="yes">{tCommon('yes')}</option>
            <option value="no">{tCommon('no')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.readOnly')}</label>
          <select value={annotProps.readOnly === 'mixed' ? 'mixed' : annotProps.readOnly ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('readOnly', e.target.value === 'yes')}>
            <Show when={annotProps.readOnly === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.marked')}</label>
          <select value={annotProps.marked === 'mixed' ? 'mixed' : annotProps.marked ? 'yes' : 'no'}
            disabled={isLocked()}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('marked', e.target.value === 'yes')}>
            <Show when={annotProps.marked === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="no">{tCommon('no')}</option>
            <option value="yes">{tCommon('yes')}</option>
          </select>
        </div>

        <div class="property-group">
          <label>{t('general.altText')}</label>
          <textarea rows="2"
            placeholder={annotProps.altText === '' && annotProps.multiCount > 0 ? tCommon('mixed') : t('general.altTextPlaceholder')}
            style="width: 100%; resize: vertical; font-size: 12px;"
            value={annotProps.altText}
            disabled={isLocked()}
            onInput={(e) => updateAnnotProp('altText', e.target.value)} />
        </div>

        <div class="property-group">
          <label>{t('general.status')}</label>
          <select value={annotProps.status}
            onDblClick={cycleSelectNext}
            onChange={(e) => updateAnnotProp('status', e.target.value)}>
            <Show when={annotProps.status === 'mixed'}>
              <option value="mixed" disabled hidden>{tCommon('mixed')}</option>
            </Show>
            <option value="none">{tCommon('none')}</option>
            <option value="accepted">{t('general.accepted')}</option>
            <option value="rejected">{t('general.rejected')}</option>
            <option value="cancelled">{t('general.cancelled')}</option>
            <option value="completed">{t('general.completed')}</option>
            <option value="reviewed">{t('general.reviewed')}</option>
          </select>
        </div>
      </CollapsibleSection>
    </Show>
  );
}
