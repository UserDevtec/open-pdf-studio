import { For } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import ThemePicker from './ThemePicker.jsx';
import { singlePageIcon, continuousIcon, navigationIcon, propertiesIcon, annotationsListIcon, toolPaletteIcon, fullscreenIcon, fullscreenExitIcon } from '../../data/ribbonIcons.js';
import { isFullscreen } from '../../stores/ribbonStore.js';
import { toggleFullscreen } from '../../../ui/chrome/fullscreen.js';
import { toggleToolPalette, paletteVisible } from '../ToolPalette.jsx';
import { toggleSymbolPalette } from '../SymbolPalette.jsx';
import { symbolPaletteVisible } from '../../stores/symbolStore.js';
import { getRegisteredPalettes } from '../../../plugins/palette-registry.js';
import { toggleExtPalette, isExtPaletteVisible } from '../ExtensionToolPalette.jsx';
import { setViewMode } from '../../../pdf/renderer.js';
import { redrawAnnotations } from '../../../annotations/rendering.js';
import { toggleLeftPanel } from '../../../ui/panels/left-panel.js';
import { toggleAnnotationsListPanel } from '../../../ui/panels/annotations-list.js';
import { togglePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { panelVisible, panelCollapsed } from '../../stores/propertiesStore.js';
import { state, noPdf } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';
import { compareActive, exitCompare } from '../../../compare/compare-store.js';

export default function ViewTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-view">
      <AdaptiveGroups>
        <RibbonGroup label={t('view.pageDisplay')}>
          <RibbonButton id="single-page" title={t('view.singlePage')} icon={singlePageIcon} label={t('view.single')}
            disabled={noPdf()} active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'single'}
            onClick={() => setViewMode('single')} />
          <RibbonButton id="continuous" title={t('view.continuousTitle')} icon={continuousIcon} label={t('view.continuous')}
            active={(state.documents[state.activeDocumentIndex]?.viewMode || 'single') === 'continuous'}
            disabled={true} style={{ opacity: '0.4', cursor: 'default' }} />
        </RibbonGroup>

        <RibbonGroup label={t('view.display') || 'Display'}>
          <RibbonButton id="thin-lines-toggle"
            title={t('view.thinLines') || 'Thin Lines'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="3" y1="6" x2="21" y2="6" stroke-width="0.5"/><line x1="3" y1="12" x2="21" y2="12" stroke-width="1.5"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="0.5"/></svg>`}
            label={t('view.thinLines') || 'Thin Lines'}
            disabled={noPdf()}
            active={state.preferences?.thinLines}
            onClick={() => {
              state.preferences.thinLines = !state.preferences.thinLines;
              import('../../../pdf/renderer.js').then(m => {
                const doc = state.documents[state.activeDocumentIndex];
                if (doc) m.renderPage(doc.currentPage);
              });
              redrawAnnotations();
            }} />
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
          <RibbonButton id="ribbon-symbol-palette" title="Symbol Library" icon={toolPaletteIcon} label="Symbols"
            active={symbolPaletteVisible()} onClick={toggleSymbolPalette} />
          <For each={getRegisteredPalettes()}>
            {(p) => {
              const translated = p.translationKey ? t(p.translationKey) : null;
              const label = (translated && translated !== p.translationKey) ? translated : p.label;
              return (
                <RibbonButton id={`ribbon-ext-palette-${p.id}`} title={label} icon={p.icon || toolPaletteIcon} label={label}
                  active={isExtPaletteVisible(p.id)} onClick={() => toggleExtPalette(p.id)} />
              );
            }}
          </For>
        </RibbonGroup>

        <RibbonGroup label={t('view.appearance')}>
          <ThemePicker />
        </RibbonGroup>

        <RibbonGroup label={t('view.compareGroup') || 'Compare'}>
          <RibbonButton id="ribbon-compare"
            title={t('compare.title') || 'Compare PDFs'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="8" height="16"/><rect x="13" y="4" width="8" height="16"/><line x1="11" y1="12" x2="13" y2="12"/></svg>`}
            label={t('compare.title') || 'Compare'}
            disabled={(state.documents?.length || 0) < 2}
            active={compareActive()}
            onClick={() => {
              if (compareActive()) exitCompare();
              else openDialog('compare', {});
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('view.window') || 'Window'}>
          <RibbonButton id="ribbon-fullscreen"
            title={(t('view.fullscreen') || 'Fullscreen') + ' (Ctrl+L / F11)'}
            icon={isFullscreen() ? fullscreenExitIcon : fullscreenIcon}
            label={t('view.fullscreen') || 'Fullscreen'}
            active={isFullscreen()}
            onClick={() => toggleFullscreen()} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
