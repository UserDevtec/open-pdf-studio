import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import PrefSelect from '../preferences/PrefSelect.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { getActiveDocument } from '../../../core/state.js';
import { recordAdd } from '../../../core/undo-manager.js';
import { redrawAnnotations, redrawContinuous } from '../../../annotations/rendering.js';
import { recalculateAllMeasurements } from '../../../annotations/measurement.js';
import { invalidateScaleRegionCache } from '../../../annotations/scale-region.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

const PRESET_SCALES = [
  '1:10','1:20','1:25','1:50','1:75','1:100','1:125','1:150','1:200','1:250',
  '1:300','1:400','1:500','1:1000','1:2000','1:5000',
];

function redraw() {
  const doc = getActiveDocument();
  if (doc?.viewMode === 'continuous') redrawContinuous();
  else redrawAnnotations();
}

function findAnnotation(id) {
  const doc = getActiveDocument();
  if (!doc) return null;
  return doc.annotations.find(a => a.id === id) || null;
}

export default function ScaleRegionDialog(props) {
  const { t } = useTranslation('properties');
  const data = props.data || {};
  const [scaleString, setScaleString] = createSignal('1:100');
  const [units, setUnits] = createSignal('mm');
  const [label, setLabel] = createSignal('');

  function handleApply() {
    const ann = findAnnotation(data.annotationId);
    if (!ann) return;
    ann.scaleString = scaleString() || '1:100';
    ann.units = units() || 'mm';
    ann.label = label() || '';

    invalidateScaleRegionCache();
    recordAdd(ann);
    recalculateAllMeasurements();
    redraw();
    closeDialog('scale-region');
  }

  function handleCancel() {
    const doc = getActiveDocument();
    const ann = findAnnotation(data.annotationId);
    if (doc && ann) {
      const idx = doc.annotations.indexOf(ann);
      if (idx !== -1) doc.annotations.splice(idx, 1);
      invalidateScaleRegionCache();
      redraw();
    }
    closeDialog('scale-region');
  }

  return (
    <Dialog
      title={t('scaleRegion.title') || 'Scale Region'}
      dialogClass="scale-region-dialog"
      onClose={handleCancel}
      footer={
        <div style="display:flex;gap:6px;justify-content:flex-end;width:100%">
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px;background:var(--theme-bg,#e0e0e0);color:var(--theme-text,#333);border-color:var(--theme-border,#ccc)"
            onClick={handleCancel}>Cancel</button>
          <button class="ai-plan-btn" style="width:auto;padding:5px 16px"
            onClick={handleApply}>Apply</button>
        </div>
      }
    >
      <div style="min-width:300px">
        <div class="ai-login-field">
          <label>{t('scaleRegion.label') || 'Label (optional)'}</label>
          <input type="text" class="ribbon-input"
            value={label()} onInput={e => setLabel(e.target.value)}
            placeholder="e.g. Plattegrond BG"
            style="width:100%;box-sizing:border-box" />
        </div>

        <div class="ai-login-field">
          <label>{t('scaleRegion.scale') || 'Scale'}</label>
          <PrefSelect
            value={scaleString}
            setValue={setScaleString}
            options={PRESET_SCALES.map(s => ({ value: s, label: s }))}
            style={{ width: '100%' }}
          />
        </div>

        <div class="ai-login-field">
          <label>{t('scaleRegion.unit') || 'Unit'}</label>
          <PrefSelect
            value={units}
            setValue={setUnits}
            options={[
              { value: 'mm', label: 'mm' },
              { value: 'cm', label: 'cm' },
              { value: 'm', label: 'm' },
              { value: 'in', label: 'in' },
              { value: 'ft', label: 'ft' },
            ]}
            style={{ width: '100%' }}
          />
        </div>
      </div>
    </Dialog>
  );
}
