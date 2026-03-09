import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { deletePages } from '../../../pdf/page-manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function DeletePagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const currentPage = props.data?.currentPage || 1;
  const totalPages = props.data?.totalPages || 1;

  const [pageRange, setPageRange] = createSignal(props.data?.pageRange || String(currentPage));

  const close = () => closeDialog('delete-pages');

  const handleDelete = () => {
    const pages = parsePageRange(pageRange(), totalPages);
    if (pages.length === 0) {
      showMessage(tCommon('invalidPageRange'));
      return;
    }
    if (pages.length >= totalPages) {
      showMessage(t('deletePages.cannotDeleteAll'));
      return;
    }
    close();
    deletePages(pages);
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleDelete}>{tCommon('delete')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('deletePages.title')}
      overlayClass="extract-pages-overlay"
      dialogClass="extract-pages-dialog"
      headerClass="extract-pages-header"
      bodyClass="extract-pages-content"
      footerClass="extract-pages-footer"
      onClose={close}
      footer={footer}
    >
      <div class="extract-pages-form">
        <div class="extract-pages-row">
          <label class="extract-pages-label">{t('deletePages.pageRange')}</label>
          <input
            type="text"
            class="extract-pages-input-wide"
            placeholder={t('deletePages.placeholder')}
            value={pageRange()}
            onInput={(e) => setPageRange(e.target.value)}
          />
        </div>
        <div class="extract-pages-row extract-pages-info">
          {`${t('deletePages.documentHas')} ${totalPages} ${t('deletePages.pagesCount')}`}
        </div>
      </div>
    </Dialog>
  );
}
