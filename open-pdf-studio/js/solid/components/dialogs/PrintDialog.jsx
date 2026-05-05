import { createSignal, createMemo, onMount, For, Show } from 'solid-js';
import Dialog from '../Dialog.jsx';
import { closeDialog } from '../../stores/dialogStore.js';
import { state, getActiveDocument, getPageRotation } from '../../../core/state.js';
import { invoke } from '../../../core/platform.js';
import { parsePageRange, renderPageOffscreen, canvasToBytes } from '../../../pdf/exporter.js';
import { PDFDocument } from 'pdf-lib';
import { useTranslation } from '../../../i18n/useTranslation.js';

export default function PrintDialog(props) {
  const { t } = useTranslation('dialogs');
  const { t: tCommon } = useTranslation('common');

  const [printerList, setPrinterList] = createSignal([]);
  const [selectedPrinter, setSelectedPrinter] = createSignal('');
  const [printerStatus, setPrinterStatus] = createSignal(`${t('print.status')} `);
  const [printerType, setPrinterType] = createSignal(`${t('print.type')} `);
  const [copies, setCopies] = createSignal(1);
  const [collate, setCollate] = createSignal(false);
  const [activeRange, setActiveRange] = createSignal('all');
  const [customPages, setCustomPages] = createSignal('');
  const [activeSubset, setActiveSubset] = createSignal('all');
  const [reverseOrder, setReverseOrder] = createSignal(false);
  const [scaling, setScaling] = createSignal('fit');
  const [zoom, setZoom] = createSignal(100);
  const [autoRotate, setAutoRotate] = createSignal(true);
  const [autoCenter, setAutoCenter] = createSignal(true);
  const [printContent, setPrintContent] = createSignal('doc-and-markups');
  const [printAsImage, setPrintAsImage] = createSignal(false);
  const [statusMessage, setStatusMessage] = createSignal('');
  const [statusType, setStatusType] = createSignal('');
  const [printDisabled, setPrintDisabled] = createSignal(false);
  const [previewPages, setPreviewPages] = createSignal([]);
  const [previewIndex, setPreviewIndex] = createSignal(0);
  const [paperDimensions, setPaperDimensions] = createSignal('');

  let canvasRef;

  const close = () => closeDialog('print');

  function updatePrinterInfo(name) {
    const printer = printerList().find(p => p.Name === name);
    if (printer) {
      setPrinterStatus(`${t('print.status')} ${printer.Status || 'Ready'}`);
      setPrinterType(`${t('print.type')} ${printer.DriverName || printer.Name || ''}`);
    } else {
      setPrinterStatus(`${t('print.status')} `);
      setPrinterType(`${t('print.type')} `);
    }
  }

  function getPrintPages() {
    const doc = getActiveDocument();
    if (!doc?.pdfDoc) return [];
    const totalPages = doc.pdfDoc.numPages;
    let pages = [];

    if (activeRange() === 'all') {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else if (activeRange() === 'current') {
      const cp = props.data?.currentPage || getActiveDocument()?.currentPage || 1;
      pages = [cp];
    } else if (activeRange() === 'custom') {
      pages = parsePageRange(customPages(), totalPages);
    }

    if (activeSubset() === 'odd') {
      pages = pages.filter(p => p % 2 === 1);
    } else if (activeSubset() === 'even') {
      pages = pages.filter(p => p % 2 === 0);
    }

    if (reverseOrder()) {
      pages.reverse();
    }

    return pages;
  }

  const pageInfo = createMemo(() => {
    const pages = getPrintPages();
    return `${pages.length} ${t('print.pagesToPrint')}`;
  });

  function updatePreviewPages() {
    const pages = getPrintPages();
    setPreviewPages(pages);
    setPreviewIndex(0);
  }

  async function renderPreview() {
    const doc = getActiveDocument();
    if (!canvasRef || !doc?.pdfDoc) return;
    const pages = previewPages();
    if (pages.length === 0) {
      const ctx = canvasRef.getContext('2d');
      canvasRef.width = 300;
      canvasRef.height = 350;
      ctx.clearRect(0, 0, 300, 350);
      setPaperDimensions('');
      return;
    }

    const idx = previewIndex();
    const pageNum = pages[Math.min(idx, pages.length - 1)];

    try {
      const page = await doc.pdfDoc.getPage(pageNum);
      const extraRotation = getPageRotation(pageNum);
      const viewportOpts = { scale: 1 };
      if (extraRotation) {
        viewportOpts.rotation = (page.rotate + extraRotation) % 360;
      }
      const viewport = page.getViewport(viewportOpts);

      const maxW = 300;
      const maxH = 350;
      const scaleW = maxW / viewport.width;
      const scaleH = maxH / viewport.height;
      const previewScale = Math.min(scaleW, scaleH);

      const previewViewportOpts = { scale: previewScale };
      if (extraRotation) {
        previewViewportOpts.rotation = (page.rotate + extraRotation) % 360;
      }
      const previewViewport = page.getViewport(previewViewportOpts);

      canvasRef.width = Math.floor(previewViewport.width);
      canvasRef.height = Math.floor(previewViewport.height);
      const ctx = canvasRef.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);

      if (printContent() === 'doc-and-markups') {
        const rendered = await renderPageOffscreen(pageNum, previewScale);
        ctx.drawImage(rendered, 0, 0, canvasRef.width, canvasRef.height);
      } else {
        const renderTask = page.render({
          canvasContext: ctx,
          viewport: previewViewport,
          annotationMode: 0
        });
        await renderTask.promise;
      }

      const wIn = (viewport.width / 72).toFixed(2);
      const hIn = (viewport.height / 72).toFixed(2);
      const wMm = (viewport.width / 72 * 25.4).toFixed(0);
      const hMm = (viewport.height / 72 * 25.4).toFixed(0);
      setPaperDimensions(`${wIn} x ${hIn} in (${wMm} x ${hMm} mm)`);
    } catch (e) {
      console.error('Preview render error:', e);
    }
  }

  function prevPreview() {
    if (previewIndex() > 0) {
      setPreviewIndex(previewIndex() - 1);
      renderPreview();
    }
  }

  function nextPreview() {
    if (previewIndex() < previewPages().length - 1) {
      setPreviewIndex(previewIndex() + 1);
      renderPreview();
    }
  }

  function onRangeChange(range) {
    setActiveRange(range);
    updatePreviewPages();
    renderPreview();
  }

  function onSubsetChange(subset) {
    setActiveSubset(subset);
    updatePreviewPages();
    renderPreview();
  }

  function onReverseChange(checked) {
    setReverseOrder(checked);
    updatePreviewPages();
    renderPreview();
  }

  function onCustomPagesChange(value) {
    setCustomPages(value);
    if (activeRange() === 'custom') {
      updatePreviewPages();
      renderPreview();
    }
  }

  function onPrintContentChange(value) {
    setPrintContent(value);
    renderPreview();
  }

  async function openPrinterProperties() {
    try {
      await invoke('open_printer_properties', { printer: selectedPrinter() });
    } catch (e) {
      console.error('Failed to open printer properties:', e);
    }
  }

  async function openPageSetup() {
    const { showPageSetupDialog } = await import('../../../ui/chrome/dialogs.js');
    showPageSetupDialog();
  }

  async function executePrint() {
    if (!selectedPrinter()) {
      setStatusMessage(t('print.noPrinterSelected'));
      setStatusType('error');
      return;
    }

    const pages = getPrintPages();
    if (pages.length === 0) {
      setStatusMessage(t('print.noPagesToPrint'));
      setStatusType('error');
      return;
    }

    setPrintDisabled(true);
    setStatusMessage(t('print.preparingPrintJob'));
    setStatusType('');

    try {
      const exportScale = 300 / 72;
      const newPdf = await PDFDocument.create();

      for (let i = 0; i < pages.length; i++) {
        const pageNum = pages[i];
        setStatusMessage(`${t('print.renderingPage')} ${pageNum}...`);

        const canvas = await renderPageOffscreen(pageNum, exportScale);
        const jpegBytes = await canvasToBytes(canvas, 'jpeg', 0.92);
        const jpegImage = await newPdf.embedJpg(jpegBytes);

        const origPage = await getActiveDocument().pdfDoc.getPage(pageNum);
        const extraRotation = getPageRotation(pageNum);
        const origViewportOpts = { scale: 1 };
        if (extraRotation) {
          origViewportOpts.rotation = (origPage.rotate + extraRotation) % 360;
        }
        const origViewport = origPage.getViewport(origViewportOpts);

        const pdfPage = newPdf.addPage([origViewport.width, origViewport.height]);
        pdfPage.drawImage(jpegImage, {
          x: 0,
          y: 0,
          width: origViewport.width,
          height: origViewport.height,
        });
      }

      setStatusMessage(t('print.savingPrintData'));
      const pdfBytes = await newPdf.save();
      const tempPath = await invoke('write_temp_pdf', { data: Array.from(pdfBytes) });

      if (!tempPath) {
        setStatusMessage(t('print.failedToCreateTempFile'));
        setStatusType('error');
        setPrintDisabled(false);
        return;
      }

      const numCopies = Math.max(1, copies());
      for (let c = 0; c < numCopies; c++) {
        setStatusMessage(numCopies > 1
          ? `${t('print.printingCopy')} ${c + 1} of ${numCopies}...`
          : t('print.sendingToPrinter'));
        await invoke('print_pdf', {
          path: tempPath,
          printer: selectedPrinter(),
        });
      }

      setStatusMessage(t('print.printJobSent'));
      setStatusType('success');

      setTimeout(() => {
        close();
      }, 1500);

      setTimeout(async () => {
        try {
          await invoke('delete_temp_file', { path: tempPath });
        } catch (_) {}
      }, 30000);
    } catch (e) {
      console.error('Print error:', e);
      setStatusMessage(`${t('print.printFailed')} ${e.message || e}`);
      setStatusType('error');
      setPrintDisabled(false);
    }
  }

  onMount(async () => {
    try {
      const json = await invoke('get_printers');
      const printers = JSON.parse(json);
      setPrinterList(printers || []);

      if (!printers || printers.length === 0) {
        setPrintDisabled(true);
        return;
      }

      const defaultPrinter = printers.find(p => p.Default === true);
      const printerName = defaultPrinter?.Name || printers[0]?.Name || '';
      setSelectedPrinter(printerName);
      updatePrinterInfo(printerName);
    } catch (e) {
      console.error('Failed to enumerate printers:', e);
      setPrintDisabled(true);
    }

    updatePreviewPages();
    renderPreview();
  });

  const currentPageNum = props.data?.currentPage || getActiveDocument()?.currentPage || 1;

  const footer = (
    <>
      <Show when={statusMessage()}>
        <div class={`print-status ${statusType()}`}>
          {statusMessage()}
        </div>
      </Show>
      <div class="print-footer-bar">
        <div class="print-footer-left">
          <span class="print-page-info">{pageInfo()}</span>
        </div>
        <div class="print-footer-right">
          <button
            class="pref-btn pref-btn-primary"
            disabled={printDisabled()}
            onClick={executePrint}
          >{tCommon('print')}</button>
          <button class="pref-btn pref-btn-secondary" onClick={close}>{tCommon('cancel')}</button>
        </div>
      </div>
    </>
  );

  return (
    <Dialog
      title={t('print.title')}
      overlayClass="print-overlay"
      dialogClass="print-dialog"
      headerClass="print-header"
      bodyClass="print-body"
      footerClass="print-footer"
      onClose={close}
      footer={footer}
    >
      <div class="print-settings">
        {/* Printer */}
        <fieldset class="print-group">
          <legend>{t('print.printer')}</legend>
          <div class="print-printer-layout">
            <div class="print-printer-left">
              <div class="print-row">
                <label class="print-label">{t('print.name')}</label>
                <select
                  class="print-select"
                  value={selectedPrinter()}
                  onChange={(e) => {
                    setSelectedPrinter(e.target.value);
                    updatePrinterInfo(e.target.value);
                  }}
                >
                  <For each={printerList()}>
                    {(printer) => (
                      <option value={printer.Name}>{printer.Name}</option>
                    )}
                  </For>
                </select>
              </div>
              <div class="print-row print-printer-detail-row">
                <span class="print-printer-status">{printerStatus()}</span>
                <span class="print-printer-sep">|</span>
                <span class="print-printer-type">{printerType()}</span>
              </div>
            </div>
            <div class="print-printer-right">
              <button class="print-printer-action-btn" onClick={openPrinterProperties}>
                {t('print.propertiesBtn')}
              </button>
              <button class="print-printer-action-btn" onClick={openPageSetup}>
                {t('print.pageSetupBtn')}
              </button>
            </div>
          </div>
          <div class="print-row">
            <label class="print-label">{t('print.copies')}</label>
            <input
              type="number"
              class="print-input"
              min="1"
              max="999"
              value={copies()}
              onInput={(e) => setCopies(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <label class="print-checkbox-label print-collate-label">
              <input
                type="checkbox"
                checked={collate()}
                onChange={(e) => setCollate(e.target.checked)}
              /> {t('print.collate')}
            </label>
          </div>
        </fieldset>

        {/* Page Range */}
        <fieldset class="print-group">
          <legend>{t('print.pageRange')}</legend>
          <div class="print-row print-pages-row">
            <div class="print-page-btns">
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'all' }}
                onClick={() => onRangeChange('all')}
              >{t('print.all')}</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'current' }}
                onClick={() => onRangeChange('current')}
              >{`${t('print.current')} ${currentPageNum}`}</button>
              <button
                class="print-page-btn"
                classList={{ active: activeRange() === 'custom' }}
                onClick={() => onRangeChange('custom')}
              >{t('print.custom')}</button>
            </div>
          </div>
          <div class="print-row print-custom-row">
            <label class="print-label">{t('print.pagesLabel')}</label>
            <input
              type="text"
              class="print-custom-input"
              placeholder={t('print.pagesPlaceholder')}
              disabled={activeRange() !== 'custom'}
              value={customPages()}
              onInput={(e) => onCustomPagesChange(e.target.value)}
            />
          </div>
          <div class="print-row">
            <label class="print-label">{t('print.subset')}</label>
            <div class="print-subset-btns">
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'all' }}
                onClick={() => onSubsetChange('all')}
              >{t('print.all')}</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'odd' }}
                onClick={() => onSubsetChange('odd')}
              >{t('print.odd')}</button>
              <button
                class="print-subset-btn"
                classList={{ active: activeSubset() === 'even' }}
                onClick={() => onSubsetChange('even')}
              >{t('print.even')}</button>
            </div>
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={reverseOrder()}
                onChange={(e) => onReverseChange(e.target.checked)}
              /> {t('print.reverseOrder')}
            </label>
          </div>
        </fieldset>

        {/* Page Placement and Scaling */}
        <fieldset class="print-group">
          <legend>{t('print.pagePlacement')}</legend>
          <div class="print-row">
            <label class="print-label">{t('print.typeLabel')}</label>
            <select
              class="print-select"
              value={scaling()}
              onChange={(e) => setScaling(e.target.value)}
            >
              <option value="fit">{t('print.fit')}</option>
              <option value="actual">{t('print.actualSize')}</option>
              <option value="shrink">{t('print.shrinkToPrintable')}</option>
              <option value="custom-scale">{t('print.customScale')}</option>
            </select>
          </div>
          <div class="print-row print-zoom-row">
            <label class="print-label">{t('print.pageZoom')}</label>
            <input
              type="number"
              class="print-input"
              min="10"
              max="400"
              value={zoom()}
              disabled={scaling() !== 'custom-scale'}
              onInput={(e) => setZoom(Math.max(10, parseInt(e.target.value) || 100))}
            />
            <span>%</span>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoRotate()}
                onChange={(e) => setAutoRotate(e.target.checked)}
              /> {t('print.autoRotate')}
            </label>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={autoCenter()}
                onChange={(e) => setAutoCenter(e.target.checked)}
              /> {t('print.autoCenter')}
            </label>
          </div>
        </fieldset>

        {/* Advanced Print Options */}
        <fieldset class="print-group">
          <legend>{t('print.advancedOptions')}</legend>
          <div class="print-row">
            <label class="print-label">{t('print.printLabel')}</label>
            <select
              class="print-select"
              value={printContent()}
              onChange={(e) => onPrintContentChange(e.target.value)}
            >
              <option value="doc-and-markups">{t('print.documentAndMarkups')}</option>
              <option value="doc-only">{t('print.document')}</option>
            </select>
          </div>
          <div class="print-row print-checkbox-row">
            <label class="print-checkbox-label">
              <input
                type="checkbox"
                checked={printAsImage()}
                onChange={(e) => setPrintAsImage(e.target.checked)}
              /> {t('print.printAsImage')}
            </label>
          </div>
        </fieldset>
      </div>

      <div class="print-preview-panel">
        <div class="print-preview-header">
          <span>{paperDimensions()}</span>
        </div>
        <div class="print-preview-container">
          <canvas ref={canvasRef} id="print-preview-canvas" />
        </div>
        <div class="print-preview-footer">
          <span>
            {previewPages().length > 0
              ? t('print.pageOf', { current: previewIndex() + 1, total: previewPages().length })
              : t('print.noPages')}
          </span>
          <div class="print-preview-nav">
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() <= 0}
              onClick={() => { setPreviewIndex(0); renderPreview(); }}
              title={t('print.firstPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="2" height="8" fill="currentColor"/><polygon points="9,1 9,9 3,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() <= 0}
              onClick={prevPreview}
              title={t('print.prevPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="9,1 9,9 1,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= previewPages().length - 1}
              onClick={nextPreview}
              title={t('print.nextPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 9,5" fill="currentColor"/></svg></button>
            <button
              class="print-preview-nav-btn"
              disabled={previewIndex() >= previewPages().length - 1}
              onClick={() => { setPreviewIndex(previewPages().length - 1); renderPreview(); }}
              title={t('print.lastPage')}
            ><svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 1,9 7,5" fill="currentColor"/><rect x="7" y="1" width="2" height="8" fill="currentColor"/></svg></button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
