import { createSignal, createMemo } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import RibbonButton from './RibbonButton.jsx';
import RibbonButtonStack from './RibbonButtonStack.jsx';
import { colorPickerValue, setColorPickerValue, lineWidthValue, setLineWidthValue } from '../../stores/ribbonStore.js';
import { setTool } from '../../../tools/manager.js';
import { state, getActiveDocument, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { recordClearPage, recordClearAll } from '../../../core/undo-manager.js';
import { hideProperties } from '../../../ui/panels/properties-panel.js';
import { clearSelection } from '../../../core/stores/selection-helpers.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import {
  highlightIcon, freehandIcon, lineIcon, arrowIcon, polylineIcon,
  rectIcon, ellipseIcon, polygonIcon, cloudIcon, cloudPolylineIcon,
  textAnnotIcon, textboxIcon, noteIcon, calloutIcon,
  stampIcon, signatureIcon,
  redactionIcon, applyRedactionsIcon,
  clearPageIcon, clearAllIcon,
  measureDistanceIcon, measureAreaIcon, measurePerimeterIcon, measureAngleIcon, calibrateIcon
} from '../../data/ribbonIcons.js';

import { useTranslation } from '../../../i18n/useTranslation.js';
import { setPickerOpen as setParametricPickerOpen } from '../../stores/parametricSymbolStore.js';
import { calibrationPixelDistance, setCalibrationPixelDistance } from '../../stores/ribbonStore.js';
import { recalculateAllMeasurements, saveDocumentScale } from '../../../annotations/measurement.js';
import { savePreferences } from '../../../core/preferences.js';
import { toggleSchedule, scheduleVisible } from '../../stores/scheduleStore.js';
import { detectScaleFromPdf } from '../../../annotations/scale-bar.js';
import { isDynamicScalingEnabled, setDynamicScalingEnabled } from '../../../annotations/dynamic-scaling.js';
import PrefSelect from '../preferences/PrefSelect.jsx';

const selectPointsIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="5" cy="19" r="2.5" stroke-width="2"/><circle cx="19" cy="5" r="2.5" stroke-width="2"/><path stroke-linecap="round" stroke-dasharray="4 3" stroke-width="1.5" d="M7 17L17 7"/></svg>`;

const autoDetectIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke-width="2"/><path stroke-linecap="round" stroke-width="2" d="M16 16l5 5"/><text x="7" y="14" font-size="8" fill="currentColor" stroke="none" font-weight="bold">A</text></svg>`;

const scaleBarIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="14" width="20" height="4" stroke-width="1.5" rx="0.5"/><rect x="2" y="14" width="4" height="4" fill="currentColor" stroke="none"/><rect x="10" y="14" width="4" height="4" fill="currentColor" stroke="none"/><rect x="18" y="14" width="4" height="4" fill="currentColor" stroke="none"/><path stroke-width="1" d="M2 20v-1M6 20v-1M10 20v-1M14 20v-1M18 20v-1M22 20v-1"/><text x="2" y="23" font-size="3" fill="currentColor">0</text></svg>`;

const viewportIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="1" stroke-width="1.5" stroke-dasharray="4 2"/><rect x="6" y="6" width="12" height="12" rx="0.5" stroke-width="1.5"/><text x="12" y="14" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" font-weight="bold">S</text></svg>`;

const scheduleIcon = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="1.5" stroke-width="1.5"/><line x1="3" y1="8" x2="21" y2="8" stroke-width="1.5"/><line x1="3" y1="13" x2="21" y2="13" stroke-width="1"/><line x1="3" y1="18" x2="21" y2="18" stroke-width="1"/><line x1="9" y1="8" x2="9" y2="21" stroke-width="1"/><line x1="15" y1="8" x2="15" y2="21" stroke-width="1"/></svg>`;

const PRESET_SCALES = [
  { label: '1:10', ratio: 10 },
  { label: '1:20', ratio: 20 },
  { label: '1:25', ratio: 25 },
  { label: '1:50', ratio: 50 },
  { label: '1:75', ratio: 75 },
  { label: '1:100', ratio: 100 },
  { label: '1:125', ratio: 125 },
  { label: '1:150', ratio: 150 },
  { label: '1:200', ratio: 200 },
  { label: '1:250', ratio: 250 },
  { label: '1:300', ratio: 300 },
  { label: '1:400', ratio: 400 },
  { label: '1:500', ratio: 500 },
  { label: '1:750', ratio: 750 },
  { label: '1:1000', ratio: 1000 },
  { label: '1:1250', ratio: 1250 },
  { label: '1:2000', ratio: 2000 },
  { label: '1:2500', ratio: 2500 },
  { label: '1:5000', ratio: 5000 },
];

export default function CommentTab() {
  const { t } = useTranslation('ribbon');

  const [calibValue, setCalibValue] = createSignal('');
  const [calibUnit, setCalibUnit] = createSignal('mm');
  const [autoDetectStatus, setAutoDetectStatus] = createSignal('');
  const [presetScale, setPresetScale] = createSignal('');

  const currentScale = createMemo(() => {
    const doc = getActiveDocument();
    const ms = doc?.measureScale;
    if (ms && ms.pixelsPerUnit > 0) {
      if (ms.scaleRatio) return ms.scaleRatio;
      return `1px = ${(1 / ms.pixelsPerUnit).toFixed(4)} ${ms.unit}`;
    }
    return null;
  });

  function handleSelectPoints() {
    setCalibrationPixelDistance(null);
    setTool('calibrationPick');
  }

  function handleApply() {
    const pixelDist = calibrationPixelDistance();
    const realValue = parseFloat(calibValue());
    const unit = calibUnit();

    if (!pixelDist || pixelDist <= 0 || !realValue || realValue <= 0) return;

    const pixelsPerUnit = pixelDist / realValue;
    const doc = getActiveDocument();
    if (!doc) return;

    doc.measureScale = { pixelsPerUnit, unit, method: 'reference', scaleRatio: 0 };
    saveDocumentScale();

    const scaleVal = realValue / pixelDist;
    state.preferences.measureDistDimScale = scaleVal;
    state.preferences.measureDistDimUnit = unit;
    state.preferences.measureAreaDimScale = scaleVal;
    state.preferences.measureAreaDimUnit = unit;
    state.preferences.measurePerimDimScale = scaleVal;
    state.preferences.measurePerimDimUnit = unit;
    savePreferences();

    recalculateAllMeasurements();

    setCalibrationPixelDistance(null);
    setCalibValue('');
  }

  function applyPresetScale(val) {
    const ratio = parseInt(val);
    if (!ratio || ratio <= 0) return;

    const doc = getActiveDocument();
    if (!doc) return;

    const pixelsPerUnit = 72 / (25.4 * ratio);

    doc.measureScale = {
      pixelsPerUnit,
      unit: 'mm',
      method: 'preset',
      scaleRatio: `1:${ratio}`,
    };
    saveDocumentScale();

    const scaleVal = 1 / pixelsPerUnit;
    state.preferences.measureDistDimScale = scaleVal;
    state.preferences.measureDistDimUnit = 'mm';
    state.preferences.measureAreaDimScale = scaleVal;
    state.preferences.measureAreaDimUnit = 'mm';
    state.preferences.measurePerimDimScale = scaleVal;
    state.preferences.measurePerimDimUnit = 'mm';
    savePreferences();

    recalculateAllMeasurements();
  }

  async function handleAutoDetect() {
    setAutoDetectStatus('detecting');
    try {
      const result = await detectScaleFromPdf();
      if (result && result.ratio > 0) {
        const doc = getActiveDocument();
        if (!doc) { setAutoDetectStatus(''); return; }

        const pixelsPerUnit = 72 / (25.4 * result.ratio);

        doc.measureScale = {
          pixelsPerUnit,
          unit: 'mm',
          method: 'auto-detect',
          scaleRatio: `1:${result.ratio}`,
        };
        saveDocumentScale();

        const scaleVal = 1 / pixelsPerUnit;
        state.preferences.measureDistDimScale = scaleVal;
        state.preferences.measureDistDimUnit = 'mm';
        state.preferences.measureAreaDimScale = scaleVal;
        state.preferences.measureAreaDimUnit = 'mm';
        state.preferences.measurePerimDimScale = scaleVal;
        state.preferences.measurePerimDimUnit = 'mm';
        savePreferences();

        recalculateAllMeasurements();
        setAutoDetectStatus('found');
      } else {
        setAutoDetectStatus('notfound');
      }
    } catch (e) {
      console.error('Auto-detect scale error:', e);
      setAutoDetectStatus('notfound');
    }
    setTimeout(() => setAutoDetectStatus(''), 3000);
  }

  return (
    <div class="ribbon-content active" id="tab-comment">
      <AdaptiveGroups>
        {/* Drawing tools (line/arrow/polyline/arc/spline/rect/ellipse/polygon/cloud/cloudPolyline/filledArea/freehand)
            were moved to the dedicated Drawing tab. Comment tab keeps only
            comment-style annotations (highlight, callout, note, stamp, etc.). */}
        <RibbonGroup label={t('comment.drawing')}>
          <RibbonButton id="tool-highlight" title={t('comment.highlight')} icon={highlightIcon} label={t('comment.highlight')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'highlight'} onClick={() => setTool('highlight')} />
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
          <RibbonButton id="tool-parametric-symbol" title="Parametrisch symbool"
            icon={stampIcon} label="Parametrisch"
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'parametricSymbol'}
            onClick={() => setParametricPickerOpen(true)} />
        </RibbonGroup>

        <RibbonGroup label={t('comment.redaction')}>
          <RibbonButton id="tool-redaction" title={t('comment.markForRedaction')} icon={redactionIcon} label={t('comment.redact')}
            disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'redaction'} onClick={() => setTool('redaction')} />
          <RibbonButton id="btn-apply-redactions" title={t('comment.applyRedactions')} icon={applyRedactionsIcon} label={t('comment.applyLabel')}
            disabled={noPdf() || isPdfAReadOnly()} iconStyle={{ color: '#dc2626' }}
            onClick={async () => {
              const { applyRedactions } = await import('../../../annotations/redaction.js');
              await applyRedactions();
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
            <RibbonButton size="small" id="tool-clear" title={t('comment.clearPageAnnotations')} icon={clearPageIcon} label={t('comment.clearPage')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                let confirmed = false;
                if (window.__TAURI__?.dialog?.ask) {
                  confirmed = await window.__TAURI__.dialog.ask(t('comment.clearPageConfirm'), { title: t('comment.clearPage'), kind: 'warning' });
                } else {
                  confirmed = confirm(t('comment.clearPageConfirm'));
                }
                if (confirmed) {
                  const cpDoc = getActiveDocument();
                  const cpPage = cpDoc ? cpDoc.currentPage : 1;
                  recordClearPage(cpPage, cpDoc?.annotations || []);
                  if (cpDoc) cpDoc.annotations = cpDoc.annotations.filter(a => a.page !== cpPage);
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
            <RibbonButton size="small" id="ribbon-clear-all" title={t('comment.clearAllAnnotations')} icon={clearAllIcon} label={t('comment.clearAll')}
              disabled={noPdf() || isPdfAReadOnly()} onClick={async () => {
                const caDoc = getActiveDocument();
                if (!caDoc || caDoc.annotations.length === 0) return;
                const confirmed = await window.__TAURI__?.dialog?.ask(t('comment.clearAllConfirm'), { title: t('comment.clearAll'), kind: 'warning' });
                if (confirmed) {
                  recordClearAll(caDoc.annotations);
                  caDoc.annotations = [];
                  clearSelection();
                  hideProperties();
                  if (getActiveDocument()?.viewMode === 'continuous') { redrawContinuous(); } else { redrawAnnotations(); }
                }
              }} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.scale') || 'SCHAAL'}>
          <div class="measure-scale-row">
            <RibbonButton id="btn-select-points"
              title={t('measure.selectPointsTitle') || 'Selecteer 2 referentiepunten op de tekening'}
              icon={selectPointsIcon}
              label={t('measure.selectPoints') || 'Selecteer punten'}
              disabled={noPdf()}
              active={state.currentTool === 'calibrationPick'}
              onClick={handleSelectPoints} />

            <div class="measure-calib-group">
              <span class="measure-hint-text" style={{ visibility: calibrationPixelDistance() ? 'visible' : 'hidden' }}>
                {t('measure.pixelDistance') || 'Pixelafstand'}: {(calibrationPixelDistance() || 0).toFixed(1)} px
              </span>
              <div style={{ display: 'flex', gap: '2px', 'align-items': 'center' }}>
                <input
                  type="number"
                  class="ribbon-input"
                  placeholder={t('measure.enterDistance') || 'Maat...'}
                  value={calibValue()}
                  onInput={(e) => setCalibValue(e.target.value)}
                  disabled={!calibrationPixelDistance()}
                  style={{ width: '54px', height: '20px', 'font-size': '10px' }}
                />
                <PrefSelect
                  value={calibUnit}
                  setValue={setCalibUnit}
                  disabled={() => !calibrationPixelDistance()}
                  options={[
                    { value: 'mm', label: 'mm' },
                    { value: 'cm', label: 'cm' },
                    { value: 'm', label: 'm' },
                    { value: 'in', label: 'in' },
                    { value: 'ft', label: 'ft' },
                  ]}
                  style={{ width: '44px' }}
                />
              </div>
              <button
                class="measure-apply-btn"
                onClick={handleApply}
                disabled={!calibrationPixelDistance() || !calibValue() || parseFloat(calibValue()) <= 0}
              >
                {t('measure.apply') || 'Toepassen'}
              </button>
            </div>

            <div class="measure-section-divider" style={{ width: '70px' }}>
              <span class="measure-label-text">{t('measure.currentScale') || 'Huidige schaal'}</span>
              <span class="measure-value-text">{currentScale() || t('measure.notSet') || 'Not set'}</span>
            </div>

            <div class="measure-section-divider" style={{ width: '70px' }}>
              <span class="measure-label-text">{t('measure.presetScale') || 'Preset'}</span>
              <PrefSelect
                value={presetScale}
                setValue={(val) => { setPresetScale(val); applyPresetScale(val); }}
                disabled={noPdf}
                options={PRESET_SCALES.map(s => ({ value: String(s.ratio), label: s.label }))}
                style={{ width: '70px' }}
              />
            </div>

            <div class="measure-section-divider">
              <RibbonButton id="btn-auto-detect-scale"
                title={autoDetectStatus() === 'found' ? (t('measure.scaleDetected') || 'Scale detected') :
                       autoDetectStatus() === 'notfound' ? (t('measure.noScaleFound') || 'No scale found') :
                       (t('measure.autoDetectTitle') || 'Detect scale from title block text')}
                icon={autoDetectIcon}
                label={autoDetectStatus() === 'detecting' ? (t('measure.detecting') || '...') :
                       (t('measure.autoDetect') || 'Auto-detect')}
                disabled={noPdf() || autoDetectStatus() === 'detecting'}
                onClick={handleAutoDetect} />
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('measure.tools') || 'METEN'}>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-distance" title={t('measure.measureDistance') || 'Afstand meten'} icon={measureDistanceIcon} label={t('measure.distance') || 'Afstand'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureDistance'} onClick={() => setTool('measureDistance')} />
            <RibbonButton size="small" id="tool-measure-area" title={t('measure.measureArea') || 'Oppervlakte meten'} icon={measureAreaIcon} label={t('measure.area') || 'Oppervlakte'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureArea'} onClick={() => setTool('measureArea')} />
          </RibbonButtonStack>
          <RibbonButtonStack>
            <RibbonButton size="small" id="tool-measure-perimeter" title={t('measure.measurePerimeter') || 'Omtrek meten'} icon={measurePerimeterIcon} label={t('measure.perimeter') || 'Omtrek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measurePerimeter'} onClick={() => setTool('measurePerimeter')} />
            <RibbonButton size="small" id="tool-measure-angle" title={t('measure.measureAngle') || 'Hoek meten'} icon={measureAngleIcon} label={t('measure.angle') || 'Hoek'}
              disabled={noPdf() || isPdfAReadOnly()} active={state.currentTool === 'measureAngle'} onClick={() => setTool('measureAngle')} />
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.scaleBar') || 'SCHAALSTOK'}>
          <RibbonButton id="btn-place-scalebar"
            title={t('measure.placeScaleBar') || 'Schaalstok plaatsen'}
            icon={scaleBarIcon}
            label={t('measure.placeScaleBar') || 'Schaalstok'}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'scaleBar'}
            onClick={() => setTool('scaleBar')} />
          <RibbonButton id="btn-create-viewport"
            title={t('measure.createViewport') || 'Draw a viewport region with its own scale'}
            icon={viewportIcon}
            label={t('measure.viewport') || 'Viewport'}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'viewport'}
            onClick={() => setTool('viewport')} />
          <RibbonButton id="btn-create-scale-region"
            title={t('comment.scaleRegion') || 'Draw a scale region with its own calibration'}
            icon={`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="4" width="18" height="16" stroke-dasharray="3 2"/><text x="12" y="16" font-size="8" font-weight="bold" text-anchor="middle" fill="currentColor" stroke="none">1:N</text></svg>`}
            label={t('comment.scaleRegion') || 'Scale region'}
            disabled={noPdf() || isPdfAReadOnly()}
            active={state.currentTool === 'scaleRegion'}
            onClick={() => setTool('scaleRegion')} />
          <RibbonButtonStack>
            <label style={{ display: 'flex', 'align-items': 'center', gap: '4px', 'font-size': '10px', color: 'var(--theme-text-secondary, #888)', padding: '2px 4px', cursor: 'default' }}>
              <input type="checkbox"
                checked={isDynamicScalingEnabled()}
                onChange={(e) => { setDynamicScalingEnabled(e.target.checked); savePreferences(); }}
                style={{ margin: 0 }} />
              {t('measure.dynamicScaling') || 'Auto-scale markups'}
            </label>
          </RibbonButtonStack>
        </RibbonGroup>

        <RibbonGroup label={t('measure.schedule') || 'TAKE-OFF'}>
          <RibbonButton id="btn-open-schedule"
            title={t('measure.openSchedule') || 'Take-Off'}
            icon={scheduleIcon}
            label={t('measure.takeOff') || 'Take-Off'}
            disabled={noPdf()}
            active={scheduleVisible()}
            onClick={toggleSchedule} />
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
