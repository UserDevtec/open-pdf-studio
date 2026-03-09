import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import ThemePicker from './ThemePicker.jsx';
import { singlePageIcon, continuousIcon, navigationIcon, propertiesIcon, annotationsListIcon, toolPaletteIcon } from '../../data/ribbonIcons.js';
import { toggleToolPalette, paletteVisible } from '../ToolPalette.jsx';
import { setViewMode } from '../../../pdf/renderer.js';
import { toggleLeftPanel } from '../../../ui/panels/left-panel.js';
import { toggleAnnotationsListPanel } from '../../../ui/panels/annotations-list.js';
import { togglePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { panelVisible, panelCollapsed } from '../../stores/propertiesStore.js';
import { state, noPdf } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ViewTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-view">
      <div class="ribbon-groups">
        <RibbonGroup label={t('view.pageDisplay')}>
          <RibbonButton id="single-page" title={t('view.singlePage')} icon={singlePageIcon} label={t('view.single')}
            disabled={noPdf()} active={state.viewMode === 'single'}
            onClick={() => setViewMode('single')} />
          <RibbonButton id="continuous" title={t('view.continuousTitle')} icon={continuousIcon} label={t('view.continuous')}
            active={state.viewMode === 'continuous'}
            disabled={true} style={{ opacity: '0.4', cursor: 'default' }} />
        </RibbonGroup>

        <RibbonGroup label={t('view.panels')}>
          <RibbonButton id="ribbon-nav-panel" title={t('view.navigationPanel')} icon={navigationIcon} label={t('view.navigation')}
            disabled={noPdf()} onClick={() => toggleLeftPanel()} />
          <RibbonButton id="ribbon-properties-panel" title={t('view.propertiesPanel')} icon={propertiesIcon} label={t('view.propertiesLabel')}
            disabled={noPdf()}
            active={panelVisible() && !panelCollapsed()}
            onClick={togglePropertiesPanel} />
          <RibbonButton id="ribbon-annotations-list" title={t('view.annotationsList')} icon={annotationsListIcon} label={t('view.annotationsLabel')}
            disabled={noPdf()} onClick={() => toggleAnnotationsListPanel()} />
          <RibbonButton id="ribbon-tool-palette" title={t('view.toolPalette')} icon={toolPaletteIcon} label={t('view.toolPaletteLabel')}
            active={paletteVisible()} onClick={toggleToolPalette} />
        </RibbonGroup>

        <RibbonGroup label={t('view.appearance')}>
          <ThemePicker />
        </RibbonGroup>
      </div>
    </div>
  );
}
