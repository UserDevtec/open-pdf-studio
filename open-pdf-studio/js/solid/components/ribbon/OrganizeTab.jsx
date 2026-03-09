import RibbonGroup from './RibbonGroup.jsx';
import RibbonButton from './RibbonButton.jsx';
import { insertPageIcon, deletePageIcon, extractPagesIcon, mergePdfsIcon, watermarkIcon, headerFooterIcon, manageWatermarksIcon } from '../../data/ribbonIcons.js';
import { state, noPdf } from '../../../core/state.js';
import { isPdfAReadOnly } from '../../../pdf/loader.js';
import { showInsertPageDialog, showExtractPagesDialog, showMergePdfsDialog } from '../../../ui/chrome/dialogs.js';
import { useTranslation } from '../../../i18n/useTranslation.js';
import { openDialog } from '../../stores/dialogStore.js';

export default function OrganizeTab() {
  const { t } = useTranslation('ribbon');

  return (
    <div class="ribbon-content active" id="tab-organize">
      <div class="ribbon-groups">
        <RibbonGroup label={t('organize.pages')}>
          <RibbonButton id="insert-page" title={t('organize.insertPage')} icon={insertPageIcon} label={t('organize.insert')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showInsertPageDialog()} />
          <RibbonButton id="delete-page" title={t('organize.deletePage')} icon={deletePageIcon} label={t('organize.deleteLabel')}
            disabled={noPdf() || isPdfAReadOnly()}
            onClick={() => openDialog('delete-pages', { totalPages: state.pdfDoc?.numPages, currentPage: state.currentPage })} />
          <RibbonButton id="extract-pages" title={t('organize.extractPages')} icon={extractPagesIcon} label={t('organize.extractLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showExtractPagesDialog()} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.combine')}>
          <RibbonButton id="merge-pdfs" title={t('organize.mergePdfs')} icon={mergePdfsIcon} label={t('organize.mergeLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={() => showMergePdfsDialog()} />
        </RibbonGroup>

        <RibbonGroup label={t('organize.watermark')}>
          <RibbonButton id="add-watermark" title={t('organize.addWatermark')} icon={watermarkIcon} label={t('organize.watermarkLabel')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showWatermarkDialog } = await import('../../../watermark/watermark-dialog.js'); showWatermarkDialog(); }} />
          <RibbonButton id="add-header-footer" title={t('organize.addHeaderFooter')} icon={headerFooterIcon} label={t('organize.headerFooter')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showHeaderFooterDialog } = await import('../../../watermark/watermark-dialog.js'); showHeaderFooterDialog(); }} />
          <RibbonButton id="manage-watermarks" title={t('organize.manageWatermarks')} icon={manageWatermarksIcon} label={t('organize.manage')}
            disabled={noPdf() || isPdfAReadOnly()} onClick={async () => { const { showManageWatermarksDialog } = await import('../../../watermark/watermark-dialog.js'); showManageWatermarksDialog(); }} />
        </RibbonGroup>
      </div>
    </div>
  );
}
