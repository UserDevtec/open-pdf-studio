import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function MessageDialog(props) {
  const { t } = useTranslation('common');
  const close = () => closeDialog('message');

  const footer = (
    <div class="message-dialog-footer">
      <button class="pref-btn pref-btn-primary" onClick={close}>{t('ok')}</button>
    </div>
  );

  return (
    <Dialog
      title={props.data?.title || t('appName')}
      overlayClass="message-dialog-overlay"
      dialogClass="message-dialog"
      onClose={close}
      footer={footer}
    >
      <div class="message-dialog-body">
        <p>{props.data?.message || ''}</p>
      </div>
    </Dialog>
  );
}
