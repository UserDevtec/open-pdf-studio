import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { aboutIcon, shortcutsIcon, updatesIcon, fileAssocIcon } from '../../data/ribbonIcons.js';
import { showPreferencesDialog } from '../../../core/preferences.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';

export default function HelpTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-help">
      <div class="ribbon-groups">
        <RibbonGroup label={t('help.information')}>
          <RibbonButton
            id="ribbon-about"
            title={t('help.aboutTitle')}
            icon={aboutIcon}
            label={t('help.about')}
            onClick={() => openDialog('about')}
          />
          <RibbonButton
            id="ribbon-shortcuts"
            title={t('help.keyboardShortcutsTitle')}
            icon={shortcutsIcon}
            label={t('help.shortcuts')}
            onClick={() => openDialog('shortcuts')}
          />
        </RibbonGroup>

        <RibbonGroup label={t('help.updates')}>
          <RibbonButton
            id="ribbon-check-updates"
            title={t('help.checkForUpdates')}
            icon={updatesIcon}
            label={t('help.updatesLabel')}
            onClick={() => import('../../../ui/chrome/updater.js').then(m => m.checkForUpdates(false))}
          />
        </RibbonGroup>

        <RibbonGroup label={t('help.fileAssociation')}>
          <RibbonButton
            id="ribbon-file-assoc"
            title={t('help.setDefaultPdf')}
            icon={fileAssocIcon}
            label={t('help.fileAssociations')}
            onClick={() => showPreferencesDialog('fileassoc')}
          />
        </RibbonGroup>
      </div>
    </div>
  );
}
