import { Show } from 'solid-js';
import { panelVisible, panelCollapsed, setPanelCollapsed } from '../../stores/propertiesStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import PanelHeader from './PanelHeader.jsx';
import DocInfoView from './DocInfoView.jsx';
import GeneralSection from './GeneralSection.jsx';
import RepliesSection from './RepliesSection.jsx';
import AppearanceSection from './AppearanceSection.jsx';
import HatchPatternSection from './HatchPatternSection.jsx';
import LineEndingsSection from './LineEndingsSection.jsx';
import DimensionsSection from './DimensionsSection.jsx';
import MeasurementSection from './MeasurementSection.jsx';
import TextFormatSection from './TextFormatSection.jsx';
import ParagraphSection from './ParagraphSection.jsx';
import ContentSection from './ContentSection.jsx';
import ImageSection from './ImageSection.jsx';
import ActionsSection from './ActionsSection.jsx';
import CustomFieldsSection from './CustomFieldsSection.jsx';

export default function PropertiesPanel() {
  const { t } = useTranslation('properties');

  function expandPanel() {
    setPanelCollapsed(false);
  }

  return (
    <Show when={panelVisible()}>
      <div class={`properties-panel-outer ${panelCollapsed() ? 'collapsed' : ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        <Show when={panelCollapsed()}>
          <div class="properties-panel-collapsed-content" onClick={expandPanel}>
            <span class="properties-panel-collapsed-text">{t('title')}</span>
          </div>
        </Show>
        <Show when={!panelCollapsed()}>
          <div class="properties-panel visible" id="properties-panel">
            <PanelHeader />
            <DocInfoView />
            <GeneralSection />
            <RepliesSection />
            <AppearanceSection />
            <HatchPatternSection />
            <LineEndingsSection />
            <DimensionsSection />
            <MeasurementSection />
            <TextFormatSection />
            <ParagraphSection />
            <ContentSection />
            <ImageSection />
            <CustomFieldsSection />
            <ActionsSection />
          </div>
        </Show>
      </div>
    </Show>
  );
}
