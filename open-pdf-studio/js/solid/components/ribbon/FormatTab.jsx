import { For } from 'solid-js';
import RibbonGroup from './RibbonGroup.jsx';
import AdaptiveGroups from './AdaptiveGroups.jsx';
import ColorPickerButton from './ColorPickerButton.jsx';
import {
  fillColor, strokeColor, fmtLineWidth, opacity, borderStyle, blendMode,
  arrowStart, arrowEnd, isLocked,
  STYLE_DEFS, applyToSelected, syncFormatStore
} from '../../stores/formatStore.js';
import { state, getActiveDocument } from '../../../core/state.js';
import { showProperties, showMultiSelectionProperties, closePropertiesPanel } from '../../../ui/panels/properties-panel.js';
import { setPanelVisible } from '../../stores/propertiesStore.js';
import {
  styleToolsIcon, resetLocationIcon, openPropertiesIcon, hideAnnotationIcon
} from '../../data/ribbonIcons.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const STYLE_GALLERY = [
  { name: 'red', labelKey: 'format.styleRed', color: '#ff0000', cloudy: false },
  { name: 'purple', labelKey: 'format.stylePurple', color: '#800080', cloudy: false },
  { name: 'indigo', labelKey: 'format.styleIndigo', color: '#4b0082', cloudy: false },
  { name: 'blue', labelKey: 'format.styleBlue', color: '#0066cc', cloudy: false },
  { name: 'green', labelKey: 'format.styleGreen', color: '#008000', cloudy: false },
  { name: 'yellow', labelKey: 'format.styleYellow', color: '#e6a817', cloudy: false },
  { name: 'black', labelKey: 'format.styleBlack', color: '#000000', cloudy: false },
  { name: 'red-cloudy', labelKey: 'format.styleRedCloudy', color: '#ff0000', cloudy: true, bg: 'rgba(255,0,0,0.08)' },
  { name: 'purple-cloudy', labelKey: 'format.stylePurpleCloudy', color: '#800080', cloudy: true, bg: 'rgba(128,0,128,0.08)' },
  { name: 'indigo-cloudy', labelKey: 'format.styleIndigoCloudy', color: '#7b68ee', cloudy: true, bg: 'rgba(123,104,238,0.15)' },
];

function applyStyle(styleName) {
  const style = STYLE_DEFS[styleName];
  if (!style) return;
  applyToSelected(ann => {
    if (style.strokeColor) { ann.strokeColor = style.strokeColor; ann.color = style.color; }
    ann.fillColor = style.fillColor || null;
    if (style.borderStyle) ann.borderStyle = style.borderStyle;
  });
  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
}

function fillIconSvg() {
  const fc = fillColor();
  const hasFillColor = fc && fc !== '#ffffff';
  return `<svg viewBox="0 0 18 18" fill="none"><rect x="2" y="2" width="14" height="11" rx="1" id="fmt-fill-icon-rect" fill="${fc}" stroke="${hasFillColor ? 'none' : '#999'}" stroke-width="1"/><rect x="2" y="14" width="14" height="2.5" rx="0.5" id="fmt-fill-indicator" fill="${fc}" stroke="${hasFillColor ? 'none' : '#ccc'}" stroke-width="0.5"/></svg>`;
}

function strokeIconSvg() {
  const sc = strokeColor();
  return `<svg viewBox="0 0 18 18" fill="none"><rect x="3" y="3" width="12" height="9" rx="1" fill="none" id="fmt-stroke-icon-rect" stroke="${sc}" stroke-width="2.5"/><rect x="2" y="14" width="14" height="2.5" rx="0.5" id="fmt-stroke-indicator" fill="${sc}"/></svg>`;
}

export default function FormatTab() {
  const { t } = useTranslation('ribbon');
  const { t: tc } = useTranslation('common');

  return (
    <div class="ribbon-content active" id="tab-format">
      <AdaptiveGroups>
        <RibbonGroup label="" wide={true}>
          <div class="ribbon-style-gallery" id="fmt-style-gallery">
            <For each={STYLE_GALLERY}>
              {(item) => (
                <div
                  class="ribbon-style-item"
                  data-style={item.name}
                  title={t(item.labelKey)}
                  onClick={() => applyStyle(item.name)}
                >
                  <div
                    class={`ribbon-style-preview${item.cloudy ? ' ribbon-style-cloudy' : ''}`}
                    style={{
                      'border-color': item.color,
                      color: item.color,
                      ...(item.bg ? { background: item.bg } : {})
                    }}
                  >
                    <span>T</span>
                  </div>
                  <span class="ribbon-style-label">{t(item.labelKey)}</span>
                </div>
              )}
            </For>
          </div>
          <button class="ribbon-gallery-more" id="fmt-style-more" title={t('format.moreStyles')}>
            <svg viewBox="0 0 8 14"><path d="M1 1l5 6-5 6" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
          </button>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-btn-stack">
            <ColorPickerButton
              id="fmt-fill-color"
              title={t('format.fillColor')}
              label={t('format.fillColor')}
              iconSvg={fillIconSvg()}
              dropdownId="fmt-fill-dropdown"
              paletteId="fmt-fill-palette"
              showNoneButton={true}
              currentColor={fillColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onNone={() => {
                applyToSelected(ann => { ann.fillColor = null; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.fillColor = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
            />
            <ColorPickerButton
              id="fmt-stroke-color"
              title={t('format.strokeColor')}
              label={t('format.strokeColor')}
              iconSvg={strokeIconSvg()}
              dropdownId="fmt-stroke-dropdown"
              paletteId="fmt-stroke-palette"
              showNoneButton={false}
              currentColor={strokeColor()}
              onColorSelect={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
              onCustom={(color) => {
                applyToSelected(ann => { ann.strokeColor = color; ann.color = color; });
                syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
              }}
            />
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid">
            <div class="ribbon-form-row">
              <label>{t('format.widthLabel')}</label>
              <select class="ribbon-form-select" id="fmt-line-width" title={t('format.lineWidth')}
                value={fmtLineWidth()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.lineWidth = parseFloat(e.target.value); });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="0.5">0.5 pt</option>
                <option value="1">1 pt</option>
                <option value="2">2 pt</option>
                <option value="3">3 pt</option>
                <option value="4">4 pt</option>
                <option value="6">6 pt</option>
                <option value="8">8 pt</option>
              </select>
              <label>{t('format.opacityLabel')}</label>
              <select class="ribbon-form-select" id="fmt-opacity" title={t('format.opacity')}
                value={opacity()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.opacity = parseInt(e.target.value) / 100; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="100">100%</option>
                <option value="90">90%</option>
                <option value="75">75%</option>
                <option value="50">50%</option>
                <option value="25">25%</option>
                <option value="10">10%</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.borderLabel')}</label>
              <select class="ribbon-form-select" id="fmt-border-style" title={t('format.borderStyle')}
                value={borderStyle()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.borderStyle = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="solid">{tc('solid')}</option>
                <option value="dashed">{tc('dashed')}</option>
                <option value="dotted">{tc('dotted')}</option>
              </select>
              <label>{t('format.blendLabel')}</label>
              <select class="ribbon-form-select" id="fmt-blend-mode" title={t('format.blendMode')}
                value={blendMode()}
                onChange={(e) => {
                  applyToSelected(ann => { ann.blendMode = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="normal">{t('format.normal')}</option>
                <option value="multiply">{t('format.multiply')}</option>
              </select>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-form-grid ribbon-form-grid-2col">
            <div class="ribbon-form-row">
              <label>{t('format.startLabel')}</label>
              <select class="ribbon-form-select" id="fmt-arrow-start" title={t('format.startArrow')}
                value={arrowStart()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.startHead = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="none">{tc('none')}</option>
                <option value="open">{t('format.open')}</option>
                <option value="closed">{t('format.closed')}</option>
                <option value="stealth">{t('format.stealth')}</option>
                <option value="diamond">{t('format.diamond')}</option>
                <option value="circle">{t('format.circle')}</option>
                <option value="square">{t('format.square')}</option>
                <option value="slash">{t('format.slash')}</option>
              </select>
            </div>
            <div class="ribbon-form-row">
              <label>{t('format.endLabel')}</label>
              <select class="ribbon-form-select" id="fmt-arrow-end" title={t('format.endArrow')}
                value={arrowEnd()}
                onChange={(e) => {
                  applyToSelected(ann => { if (ann.type === 'arrow') ann.endHead = e.target.value; });
                  syncFormatStore(getActiveDocument()?.selectedAnnotations || []);
                }}>
                <option value="none">{tc('none')}</option>
                <option value="open">{t('format.open')}</option>
                <option value="closed">{t('format.closed')}</option>
                <option value="stealth">{t('format.stealth')}</option>
                <option value="diamond">{t('format.diamond')}</option>
                <option value="circle">{t('format.circle')}</option>
                <option value="square">{t('format.square')}</option>
                <option value="slash">{t('format.slash')}</option>
              </select>
            </div>
          </div>
        </RibbonGroup>

        <RibbonGroup label="">
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn ribbon-dropdown-btn" id="fmt-style-tools" title={t('format.styleTools')}>
              <span ref={el => { el.innerHTML = styleToolsIcon; }} />
              <span>{t('format.styleTools')}</span>
              <svg class="dropdown-arrow" viewBox="0 0 8 5"><path d="M0 0l4 4 4-4z" fill="currentColor"/></svg>
            </button>
            <button class="ribbon-row-btn" id="fmt-reset-location" title={t('format.resetLocation')}
              onClick={() => {
                applyToSelected(ann => {
                  ann.rotation = 0;
                  if (ann.x !== undefined) {
                    const canvas = document.getElementById('annotation-canvas');
                    if (canvas) {
                      const resetDoc = getActiveDocument();
                      const resetScale = resetDoc?.scale || 1.5;
                      const resetDpr = window.devicePixelRatio || 1;
                      const cx = (canvas.width / (resetScale * resetDpr)) / 2;
                      const cy = (canvas.height / (resetScale * resetDpr)) / 2;
                      const w = ann.width || 100;
                      const h = ann.height || 50;
                      ann.x = cx - w / 2;
                      ann.y = cy - h / 2;
                    }
                  }
                });
              }}>
              <span ref={el => { el.innerHTML = resetLocationIcon; }} />
              <span>{t('format.resetLocation')}</span>
            </button>
          </div>
        </RibbonGroup>

        <RibbonGroup label={t('format.propertiesGroup')}>
          <div class="ribbon-grid-col">
            <button class="ribbon-row-btn" id="fmt-open" title={t('format.openProperties')}
              onClick={() => {
                setPanelVisible(true);
                const _fmtSel = getActiveDocument()?.selectedAnnotations || [];
                if (_fmtSel.length === 1) {
                  showProperties(_fmtSel[0]);
                } else if (_fmtSel.length > 1) {
                  showMultiSelectionProperties();
                }
              }}>
              <span ref={el => { el.innerHTML = openPropertiesIcon; }} />
              <span>{t('format.openLabel')}</span>
            </button>
            <button class="ribbon-row-btn" id="fmt-hide" title={t('format.hideAnnotation')}
              onClick={() => {
                applyToSelected(ann => { ann.hidden = !ann.hidden; });
              }}>
              <span ref={el => { el.innerHTML = hideAnnotationIcon; }} />
              <span>{t('format.hide')}</span>
            </button>
          </div>
          <div class="ribbon-grid-col" style={{ 'justify-content': 'center' }}>
            <div class="ribbon-form-row">
              <label>{t('format.layerLabel')}</label>
              <select class="ribbon-form-select" id="fmt-layer" title={t('format.layer')}>
                <option value="none">{tc('none')}</option>
              </select>
            </div>
          </div>
        </RibbonGroup>
      </AdaptiveGroups>
    </div>
  );
}
