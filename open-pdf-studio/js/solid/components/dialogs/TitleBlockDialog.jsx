import { createSignal, For } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';

const FIELDS = [
  { key: 'tbOnderwerp', label: 'Onderwerp' },
  { key: 'tbProjectNr', label: 'Project nr' },
  { key: 'tbSchaal', label: 'Schaal' },
  { key: 'tbProjectnaam', label: 'Projectnaam' },
  { key: 'tbDatum', label: 'Datum' },
  { key: 'tbProjectlocatie', label: 'Projectlocatie' },
  { key: 'tbBijlage', label: 'Bijlage' },
  { key: 'tbFormaat', label: 'Formaat' },
  { key: 'tbBedrijf', label: 'Bedrijf' },
  { key: 'tbAdres', label: 'Adres' },
  { key: 'tbPostcode', label: 'Postcode' },
  { key: 'tbTelefoon', label: 'Telefoon' },
  { key: 'tbEmail', label: 'Email' },
];

export default function TitleBlockDialog(props) {
  const data = props.data || {};
  const ann = data.annotation;

  // Create local signals for each field
  const fieldSignals = {};
  for (const f of FIELDS) {
    fieldSignals[f.key] = createSignal(ann ? (ann[f.key] || '') : '');
  }

  const close = () => closeDialog('title-block-edit');

  const handleSave = async () => {
    if (!ann) { close(); return; }
    // Update annotation fields
    for (const f of FIELDS) {
      ann[f.key] = fieldSignals[f.key][0]();
    }
    // Rebuild SVG and re-rasterize
    if (data.rebuildAndUpdate) {
      await data.rebuildAndUpdate(ann);
    }
    close();
  };

  return (
    <Dialog
      title="Edit Title Block"
      dialogClass="title-block-dialog"
      onClose={close}
    >
      <div class="title-block-fields">
        <For each={FIELDS}>
          {(field) => (
            <div class="title-block-field-row">
              <label class="title-block-field-label">{field.label}</label>
              <input
                class="title-block-field-input"
                type="text"
                value={fieldSignals[field.key][0]()}
                onInput={(e) => fieldSignals[field.key][1](e.target.value)}
              />
            </div>
          )}
        </For>
      </div>
      <div class="title-block-buttons">
        <button class="confirm-dialog-btn" onClick={close}>Cancel</button>
        <button class="confirm-dialog-btn confirm-dialog-btn-yes" onClick={handleSave}>OK</button>
      </div>
    </Dialog>
  );
}
