import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import ExtensionsPanel from '../app-menu/ExtensionsPanel.jsx';

export default function ExtensionsDialog() {
  const close = () => closeDialog('extensions');

  return (
    <Dialog
      title="Extensions"
      dialogClass="extensions-dialog"
      onClose={close}
    >
      <ExtensionsPanel />
    </Dialog>
  );
}
