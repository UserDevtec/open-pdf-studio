import { Show } from 'solid-js';
import { panelVisible, panelCollapsed, setPanelCollapsed } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';

export default function PropertiesPanel() {
  const { t } = useTranslation('properties');

  function expandPanel() {
    setPanelCollapsed(false);
  }

  return (
    <>
      <Show when={panelVisible() && panelCollapsed()}>
        <div class="properties-panel-collapsed" onClick={expandPanel}
          onMouseDown={(e) => e.stopPropagation()}>
          <span class="properties-panel-collapsed-text">{t('title')}</span>
        </div>
      </Show>
      <Show when={panelVisible() && !panelCollapsed()}>
        <div class="properties-panel visible" id="properties-panel"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}>
          <PanelHeader />
          <DocInfoView />
          <GeneralSection />
          <RepliesSection />
          <AppearanceSection />
          <LineEndingsSection />
          <DimensionsSection />
          <TextFormatSection />
          <ParagraphSection />
          <ContentSection />
          <ImageSection />
          <ActionsSection />
        </div>
      </Show>
    </>
  );
}
