import { Show, For, createMemo, createSignal } from 'solid-js';
import { annotProps, sectionVis, updateAnnotProp, cycleSelectNext } from '../../stores/propertiesStore.js';
import CollapsibleSection from './CollapsibleSection.jsx';
import ColorPalettePicker from './ColorPalettePicker.jsx';
import PrefComboBox from '../preferences/PrefComboBox.jsx';
import { useTranslation } from '../../../i18n/useTranslation.js';
import {
  HATCH_CATEGORIES,
  listHatchPatternsByCategory,
  getHatchSwatchDataUrl,
} from '../../../annotations/rendering/hatch-patterns.js';

// Stable category ordering for the picker
const CATEGORY_ORDER = ['basic', 'hatching', 'material', 'geometric', 'nen47'];

export default function HatchPatternSection() {
  const { t } = useTranslation('properties');
  const { t: tCommon } = useTranslation('common');
  const isLocked = () => annotProps.locked === true || annotProps.locked === 'mixed';

  const grouped = createMemo(() => listHatchPatternsByCategory());

  const [pickerOpen, setPickerOpen] = createSignal(false);

  const patternLabel = (id) => {
    const key = `hatchPatterns.${id}`;
    const translated = t(key);
    // i18next returns the key itself when missing — fall back to the id
    return translated && translated !== key ? translated : id;
  };

  const currentSwatch = () => {
    const p = annotProps.hatchPattern;
    if (!p || p === 'none' || p === 'mixed') return '';
    const color = annotProps.hatchColor || '#000000';
    return getHatchSwatchDataUrl(p, color, 16);
  };

  const selectPattern = (id) => {
    updateAnnotProp('hatchPattern', id);
    setPickerOpen(false);
  };

  return (
    <Show when={sectionVis.hatchPatternGroup}>
      <CollapsibleSection title={t('appearance.hatchPattern')} name="hatchPattern" id="prop-hatch-pattern-section">
        <div class="property-group">
          <label>{t('appearance.hatchPattern')}</label>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              disabled={isLocked()}
              onDblClick={cycleSelectNext}
              onClick={() => setPickerOpen(!pickerOpen())}
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: '6px',
                width: '100%',
                'text-align': 'left',
                padding: '2px 6px',
                background: '#fff',
                border: '1px solid #7a7a7a',
                'border-radius': '0',
                cursor: isLocked() ? 'default' : 'pointer',
                font: 'inherit',
              }}
            >
              <Show when={annotProps.hatchPattern && annotProps.hatchPattern !== 'none' && annotProps.hatchPattern !== 'mixed'}>
                <img src={currentSwatch()} alt="" style={{ width: '16px', height: '16px', 'image-rendering': 'pixelated' }} />
              </Show>
              <span style={{ flex: '1' }}>
                {annotProps.hatchPattern === 'mixed'
                  ? tCommon('mixed')
                  : (!annotProps.hatchPattern || annotProps.hatchPattern === 'none'
                      ? tCommon('none')
                      : patternLabel(annotProps.hatchPattern))}
              </span>
              <span style={{ 'font-size': '10px' }}>{'▾'}</span>
            </button>
            <Show when={pickerOpen() && !isLocked()}>
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: '0',
                  right: '0',
                  'max-height': '320px',
                  'overflow-y': 'auto',
                  background: '#fff',
                  border: '1px solid #7a7a7a',
                  'box-shadow': '2px 2px 4px rgba(0,0,0,0.2)',
                  'z-index': 1000,
                }}
              >
                <PatternRow
                  active={!annotProps.hatchPattern || annotProps.hatchPattern === 'none'}
                  onClick={() => selectPattern('none')}
                  label={tCommon('none')}
                />
                <For each={CATEGORY_ORDER}>
                  {(cat) => (
                    <Show when={grouped()[cat] && grouped()[cat].length > 0}>
                      <div style={{
                        padding: '4px 8px',
                        background: 'linear-gradient(to bottom, #ffffff, #f5f5f5)',
                        'border-bottom': '1px solid #d4d4d4',
                        'border-top': '1px solid #d4d4d4',
                        'font-weight': 'bold',
                        'font-size': '11px',
                      }}>
                        {(() => {
                          const k = `hatchCategories.${cat}`;
                          const v = t(k);
                          return v && v !== k ? v : cat;
                        })()}
                      </div>
                      <For each={grouped()[cat]}>
                        {(p) => (
                          <PatternRow
                            active={annotProps.hatchPattern === p.id}
                            onClick={() => selectPattern(p.id)}
                            swatch={getHatchSwatchDataUrl(p.id, annotProps.hatchColor || '#000000', 16)}
                            label={patternLabel(p.id)}
                          />
                        )}
                      </For>
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
        <Show when={annotProps.hatchPattern && annotProps.hatchPattern !== 'none'}>
          <ColorPalettePicker
            label={t('appearance.hatchColor')}
            color={() => annotProps.hatchColor}
            showNone={false}
            disabled={isLocked()}
            onColorChange={(color) => updateAnnotProp('hatchColor', color)}
          />
          <div class="property-group">
            <label>{t('appearance.hatchScale')}</label>
            <PrefComboBox
              value={() => annotProps.hatchScale}
              setValue={(val) => updateAnnotProp('hatchScale', val)}
              options={[50, 75, 100, 125, 150, 175, 200]}
              min={25} max={400} fallback={100} suffix="%"
              disabled={isLocked}
            />
          </div>
          <div class="property-group">
            <label>{t('appearance.hatchAngle')}</label>
            <PrefComboBox
              value={() => annotProps.hatchAngle}
              setValue={(val) => updateAnnotProp('hatchAngle', val)}
              options={[0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165]}
              min={0} max={180} fallback={45} step={5} suffix="°"
              disabled={isLocked}
            />
          </div>
        </Show>
      </CollapsibleSection>
    </Show>
  );
}

function PatternRow(props) {
  return (
    <div
      onClick={props.onClick}
      style={{
        display: 'flex',
        'align-items': 'center',
        gap: '8px',
        padding: '3px 8px',
        cursor: 'pointer',
        background: props.active ? '#cce4f7' : 'transparent',
      }}
      onMouseEnter={(e) => { if (!props.active) e.currentTarget.style.background = '#e6f0fa'; }}
      onMouseLeave={(e) => { if (!props.active) e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ width: '16px', height: '16px', 'flex-shrink': '0' }}>
        <Show when={props.swatch}>
          <img src={props.swatch} alt="" style={{ width: '16px', height: '16px', 'image-rendering': 'pixelated' }} />
        </Show>
      </div>
      <span style={{ 'font-size': '12px' }}>{props.label}</span>
    </div>
  );
}
