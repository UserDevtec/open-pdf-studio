// Tracks the current parametric symbol selection used by the
// parametricSymbol tool when placing a new annotation.
import { createSignal } from 'solid-js';
import { listTemplates } from '../../symbols/registry.js';

const [pendingSymbolId, setPendingSymbolId] = createSignal('door');
const [pickerOpen, setPickerOpen] = createSignal(false);

function getAvailableTemplates() {
  return listTemplates();
}

export {
  pendingSymbolId, setPendingSymbolId,
  pickerOpen, setPickerOpen,
  getAvailableTemplates,
};
