import { createSignal } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog, showMessage } from '../../stores/dialogStore.js';
import { parsePageRange } from '../../../pdf/exporter.js';
import { extractPages } from '../../../pdf/page-manager.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function ExtractPagesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const currentPage = props.data?.currentPage || 1;
  const totalPages = props.data?.totalPages || 1;

  const [pageRange, setPageRange] = createSignal(String(currentPage));
  const [deleteAfter, setDeleteAfter] = createSignal(false);

  const close = () => closeDialog('extract-pages');

  const handleExtract = () => {
    const pages = parsePageRange(pageRange(), totalPages);
    if (pages.length === 0) {
      showMessage(tCommon('invalidPageRange'));
      return;
    }
    close();
    extractPages(pages, deleteAfter());
  };

  const footer = (
    <>
      <div></div>
      <div class="extract-pages-footer-right">
        <button class="pref-btn pref-btn-primary" onClick={handleExtract}>{tCommon('extract')}</button>
        <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('extractPages.title')}
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
          <label class="extract-pages-label">{t('extractPages.pageRange')}</label>
          <input
            type="text"
            class="extract-pages-input-wide"
            placeholder={t('extractPages.placeholder')}
            value={pageRange()}
            onInput={(e) => setPageRange(e.target.value)}
          />
        </div>
        <div class="extract-pages-row extract-pages-info">
          {`${t('extractPages.documentHas')} ${totalPages} ${t('extractPages.pagesCount')}`}
        </div>
        <div class="extract-pages-row extract-pages-checkbox-row">
          <label class="extract-pages-checkbox-label">
            <input
              type="checkbox"
              checked={deleteAfter()}
              onChange={(e) => setDeleteAfter(e.target.checked)}
            /> {t('extractPages.deleteAfterExtraction')}
          </label>
        </div>
      </div>
    </Dialog>
  );
}
