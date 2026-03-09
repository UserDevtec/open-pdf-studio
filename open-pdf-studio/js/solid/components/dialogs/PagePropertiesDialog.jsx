import { createSignal, onMount } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getPageRotation } from '../../../core/state.js';
import { useTranslation } from '../../../i18n/useTranslation.js';

function PropRow(props) {
  return (
    <div class="doc-props-row">
      <span class="doc-props-label">{props.label}</span>
      <span class="doc-props-value">{props.value}</span>
    </div>
  );
}

export default function PagePropertiesDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const pageNum = props.data?.pageNum || 1;
  const [pageData, setPageData] = createSignal(null);

  onMount(async () => {
    if (!state.pdfDoc) return;
    try {
      const page = await state.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const viewport = page.getViewport({ scale: 1 });
      const widthPt = viewport.width;
      const heightPt = viewport.height;
      const totalRotation = (page.rotate + (extraRotation || 0)) % 360;

      setPageData({
        widthPt: widthPt.toFixed(0),
        heightPt: heightPt.toFixed(0),
        widthMm: (widthPt / 72 * 25.4).toFixed(1),
        heightMm: (heightPt / 72 * 25.4).toFixed(1),
        widthIn: (widthPt / 72).toFixed(2),
        heightIn: (heightPt / 72).toFixed(2),
        rotation: totalRotation,
        userUnit: page.userUnit || 1,
      });
    } catch (err) {
      console.error('Error loading page properties:', err);
    }
  });

  const close = () => closeDialog('page-properties');

  return (
    <Dialog
      title={t('pageProperties.title', { page: pageNum })}
      overlayClass="doc-props-overlay"
      dialogClass="doc-props-dialog"
      bodyClass="doc-props-content"
      footerClass="doc-props-footer"
      onClose={close}
      footer={<button onClick={close}>{tCommon('ok')}</button>}
    >
      {pageData() ? (
        <>
          <div class="doc-props-section">
            <h3>{t('pageProperties.dimensions')}</h3>
            <PropRow label={t('pageProperties.sizePoints')} value={`${pageData().widthPt} \u00D7 ${pageData().heightPt} pt`} />
            <PropRow label={t('pageProperties.sizeMm')} value={`${pageData().widthMm} \u00D7 ${pageData().heightMm} mm`} />
            <PropRow label={t('pageProperties.sizeInches')} value={`${pageData().widthIn} \u00D7 ${pageData().heightIn} in`} />
          </div>
          <div class="doc-props-section">
            <h3>{t('pageProperties.display')}</h3>
            <PropRow label={t('pageProperties.rotation')} value={`${pageData().rotation}\u00B0`} />
            <PropRow label={t('pageProperties.userUnit')} value={pageData().userUnit} />
          </div>
        </>
      ) : (
        <div class="doc-props-label" style={{ padding: '12px' }}>{t('pageProperties.loading')}</div>
      )}
    </Dialog>
  );
}
