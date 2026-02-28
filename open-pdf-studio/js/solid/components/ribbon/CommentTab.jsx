import { createSignal } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { setTool } from '../../../tools/manager.js';
import { state, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { undo, recordClearPage, recordClearAll } from '../../../core/undo-manager.js';
import { hideProperties } from '../../../ui/panels/properties-panel.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, calibrateIcon, snapToDrawingIcon,
  redactionIcon, applyRedactionsIcon,
  undoIcon, clearPageIcon, clearAllIcon
} from '../../data/ribbonIcons.js';
import { showCalibrationDialog } from '../../../annotations/measurement.js';
import { loadAllPdfSnapData, isPdfSnapLoaded, clearPdfVectorCache } from '../../../tools/pdf-snap-extractor.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function CommentTab() {
  const { t } = useTranslation('ribbon');
  const [snapLoading, setSnapLoading] = createSignal(false);
  const [snapLoaded, setSnapLoaded] = createSignal(false);

  async function handleSnapToDrawing() {
    if (snapLoaded()) {
      // Toggle off: clear cache
      clearPdfVectorCache();
      setSnapLoaded(false);
      return;
    }
    setSnapLoading(true);
    try {
      await loadAllPdfSnapData();
      setSnapLoaded(true);
    } catch { /* ignore */ }
    setSnapLoading(false);
  }

  return (
    <div class="ribbon-content active" id="tab-comment">
      <div class="ribbon-groups">
        <RibbonGroup label={t('comment.drawing')}>
          <RibbonButton id="tool-highlight" title={t('comment.highlight')} icon={highlightIcon} label={t('comment.highlight')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => setTool('highlight')} />
          <RibbonButton id="tool-draw" title={t('comment.freehand')} icon={freehandIcon} label={t('comment.freehand')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'draw'} onClick={() => setTool('draw')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-line" title={t('comment.line')} icon={lineIcon} label={t('comment.line')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'line'} onClick={() => setTool('line')} />
            <RibbonButton size="small" id="tool-arrow" title={t('comment.arrow')} icon={arrowIcon} label={t('comment.arrow')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'arrow'} onClick={() => setTool('arrow')} />
            <RibbonButton size="small" id="tool-polyline" title={t('comment.polylineTitle')} icon={polylineIcon} label={t('comment.polyline')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'polyline'} onClick={() => setTool('polyline')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.shapes')}>
          <RibbonButton id="tool-box" title={t('comment.rectangle')} icon={rectIcon} label={t('comment.rect')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'box'} onClick={() => setTool('box')} />
          <RibbonButton id="tool-circle" title={t('comment.ellipse')} icon={ellipseIcon} label={t('comment.ellipse')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'circle'} onClick={() => setTool('circle')} />
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-polygon" title={t('comment.polygon')} icon={polygonIcon} label={t('comment.polygon')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'polygon'} onClick={() => setTool('polygon')} />
            <RibbonButton size="small" id="tool-cloud" title={t('comment.cloud')} icon={cloudIcon} label={t('comment.cloud')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'cloud'} onClick={() => setTool('cloud')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.text')}>
          <RibbonButton id="tool-textbox" title={t('comment.textBox')} icon={textboxIcon} label={t('comment.textBox')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'textbox'} onClick={() => setTool('textbox')} />
          <RibbonButton id="tool-callout" title={t('comment.callout')} icon={calloutIcon} label={t('comment.callout')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'callout'} onClick={() => setTool('callout')} />
          <RibbonButton id="tool-comment" title={t('comment.note')} icon={noteIcon} label={t('comment.note')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'comment'} onClick={() => setTool('comment')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.stamp')}>
          <RibbonButton id="tool-stamp" title={t('comment.stamp')} icon={stampIcon} label={t('comment.stamp')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'stamp'} onClick={() => setTool('stamp')} />
          <RibbonButton id="tool-signature" title={t('comment.signature')} icon={signatureIcon} label={t('comment.signature')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'signature'} onClick={() => setTool('signature')} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.measure')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('comment.measureDistance')} icon={measureDistanceIcon} label={t('comment.distance')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('comment.measureArea')} icon={measureAreaIcon} label={t('comment.area')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('comment.measurePerimeter')} icon={measurePerimeterIcon} label={t('comment.perimeter')}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
          </RibbonButtonStack>
          <RibbonButton id="tool-calibrate" title={t('comment.calibrateTitle')} icon={calibrateIcon} label={t('comment.calibrate')}
            disabled={noPdf()} onClick={() => showCalibrationDialog()} />
          <RibbonButton id="tool-snap-drawing" title={t('comment.snapToDrawingTitle')} icon={snapToDrawingIcon}
            label={snapLoading() ? t('comment.loading') : snapLoaded() ? t('comment.snapActive') : t('comment.snapToDrawing')}
            disabled={noPdf() || snapLoading()} active={snapLoaded()} onClick={handleSnapToDrawing} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.redaction')}>
          <RibbonButton id="tool-redaction" title={t('comment.markForRedaction')} icon={redactionIcon} label={t('comment.redact')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => setTool('redaction')} />
          <RibbonButton id="btn-apply-redactions" title={t('comment.applyRedactions')} icon={applyRedactionsIcon} label={t('comment.applyLabel')}
            disabled={noPdf() || isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={async () => {
              const { applyRedactions } = await import('../../../annotations/redaction.js');
              applyRedactions();
            }} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.properties')}>
          <RibbonButtonStack>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.color')}</label>
              <input type="color" id="color-picker" class="ribbon-color-input"
                value={colorPickerValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setColorPickerValue(e.target.value)} />
            </div>
            <div class="ribbon-input-row">
              <label class="ribbon-input-label">{t('comment.width')}</label>
              <input type="number" id="line-width" class="ribbon-input" min="1" max="20"
                value={lineWidthValue()}
                disabled={noPdf() || isPdfAReadOnly()}
                onInput={(e) => setLineWidthValue(parseInt(e.target.value) || 3)} />
            </div>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('comment.edit')}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-undo" title={t('comment.undo')} icon={undoIcon} label={t('comment.undo')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={() => undo()} />
            <RibbonButton size="small" id="tool-clear" title={t('comment.clearPageAnnotations')} icon={clearPageIcon} label={t('comment.clearPage')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                let confirmed = false;
                if (window.__TAURI__?.dialog?.ask) {
                  confirmed = await window.__TAURI__.dialog.ask(t('comment.clearPageConfirm'), { title: t('comment.clearPage'), kind: 'warning' });
                } else {
                  confirmed = confirm(t('comment.clearPageConfirm'));
                }
                if (confirmed) {
                  recordClearPage(state.currentPage, state.annotations);
                  state.annotations = state.annotations.filter(a => a.page !== state.currentPage);
                  hideProperties();
                  if (state.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
            <RibbonButton size="small" id="ribbon-clear-all" title={t('comment.clearAllAnnotations')} icon={clearAllIcon} label={t('comment.clearAll')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                if (state.annotations.length === 0) return;
                const confirmed = await window.__TAURI__?.dialog?.ask(t('comment.clearAllConfirm'), { title: t('comment.clearAll'), kind: 'warning' });
                if (confirmed) {
                  recordClearAll(state.annotations);
                  state.annotations = [];
                  hideProperties();
                  if (state.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
          </RibbonButtonStack>
        </RibbonGroup>
      </div>
    </div>
  );
}
