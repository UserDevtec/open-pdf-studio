import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { textFieldIcon, checkboxIcon, radioIcon } from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function FormsTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-forms">
      <div class="ribbon-groups">
        <RibbonGroup label={t('forms.formFields')}>
          <RibbonButton id="form-text-field" title={t('forms.textField')} icon={textFieldIcon} label={t('forms.textField')} disabled={noPdf() || isPdfAReadOnly()} />
          <RibbonButton id="form-checkbox" title={t('forms.checkbox')} icon={checkboxIcon} label={t('forms.checkbox')} disabled={noPdf() || isPdfAReadOnly()} />
          <RibbonButton id="form-radio" title={t('forms.radioButton')} icon={radioIcon} label={t('forms.radio')} disabled={noPdf() || isPdfAReadOnly()} />
        </RibbonGroup>
      </div>
    </div>
  );
}
