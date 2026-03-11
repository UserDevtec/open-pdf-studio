import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';
import { openDialog, getDialogs } from '../stores/dialogStore.js';

async function handleClose() {
  const { closeActiveTab } = await import('../../ui/chrome/tabs.js');
  const { closeWindow } = await import('../../core/platform.js');
  while (state.documents.length > 0) {
    const closed = await closeActiveTab();
    if (!closed) return;
  }
  closeWindow();
}

export default function TitleBar() {
  const { t: tCommon } = useTranslation('common');
  const doc = () => state.documents[state.activeDocumentIndex];
  const fileName = () => {
    const d = doc();
    if (!d || !d.fileName) return '';
    return (d.modified ? '* ' : '') + d.fileName;
  };
  const hasPdf = () => !!state.pdfDoc;
  const undoEnabled = () => {
    const d = doc();
    return !!d && !!d.undoStack && d.undoStack.length > 0;
  };
  const redoEnabled = () => {
    const d = doc();
    return !!d && !!d.redoStack && d.redoStack.length > 0;
  };
  const hasDialogs = () => getDialogs().length > 0;

  return (
    <div class={`title-bar${hasDialogs() ? ' dialogs-open' : ''}`} attr:data-tauri-drag-region={hasDialogs() ? undefined : ''}>
      <div class="title-bar-left">
        <div class="quick-access-toolbar">
          <img src="icon.png" class="app-icon" alt={tCommon('appName')} />
          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title={`${tCommon('open')} (Ctrl+O)`}
            onClick={() => import('../../pdf/loader.js').then(m => m.openPDFFile())}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="m23.493,11.017c-.487-.654-1.234-1.03-2.05-1.03h-.443v-1.987c0-2.757-2.243-5-5-5h-5.056c-.154,0-.31-.037-.447-.105l-3.155-1.578c-.414-.207-.878-.316-1.342-.316h-2C1.794,1,0,2.794,0,5v13c0,2.757,2.243,5,5,5h12.558c2.226,0,4.15-1.432,4.802-3.607l1.532-6.116c.234-.782.089-1.605-.398-2.26ZM2,18V5c0-1.103.897-2,2-2h2c.154,0,.31.037.447.105l3.155,1.578c.414.207.878.316,1.342.316h5.056c1.654,0,3,1.346,3,3v1.987h-10.385c-1.7,0-3.218,1.079-3.789,2.72l-2.19,7.138c-.398-.509-.636-1.15-.636-1.845Zm19.964-5.253l-1.532,6.115c-.384,1.279-1.539,2.138-2.874,2.138H5c-.208,0-.411-.021-.607-.062l2.334-7.609c.279-.803,1.039-1.342,1.889-1.342h12.828c.242,0,.383.14.445.224.062.084.156.259.075.536Z"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={`${tCommon('save')} (Ctrl+S)`} disabled={!hasPdf()}
            onClick={() => import('../../pdf/saver.js').then(m => m.savePDF())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12.5 14.5h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h7.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1z"/>
              <path d="M5.5 1.5v3h4v-3"/>
              <rect x="4.5" y="8.5" width="7" height="5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={`${tCommon('saveAs')} (Ctrl+Shift+S)`} disabled={!hasPdf()}
            onClick={() => import('../../pdf/saver.js').then(m => m.savePDFAs())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12.5 14.5h-9a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1h7.586a1 1 0 0 1 .707.293l1.414 1.414a1 1 0 0 1 .293.707V13.5a1 1 0 0 1-1 1z"/>
              <path d="M5.5 1.5v3h4v-3"/>
              <rect x="4.5" y="8.5" width="7" height="5"/>
              <path d="M8 6v4m0 0l-1.5-1.5M8 10l1.5-1.5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={`${tCommon('print')} (Ctrl+P)`} disabled={!hasPdf()}
            onClick={() => import('../../ui/chrome/dialogs.js').then(m => m.showPrintDialog())}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M19,6V4a4,4,0,0,0-4-4H9A4,4,0,0,0,5,4V6a5.006,5.006,0,0,0-5,5v5a5.006,5.006,0,0,0,5,5,3,3,0,0,0,3,3h8a3,3,0,0,0,3-3,5.006,5.006,0,0,0,5-5V11A5.006,5.006,0,0,0,19,6ZM7,4A2,2,0,0,1,9,2h6a2,2,0,0,1,2,2V6H7ZM17,21a1,1,0,0,1-1,1H8a1,1,0,0,1-1-1V17a1,1,0,0,1,1-1h8a1,1,0,0,1,1,1Zm5-5a3,3,0,0,1-3,3V17a3,3,0,0,0-3-3H8a3,3,0,0,0-3,3v2a3,3,0,0,1-3-3V11A3,3,0,0,1,5,8H19a3,3,0,0,1,3,3Z"/>
              <path d="M18,10H16a1,1,0,0,0,0,2h2a1,1,0,0,0,0-2Z"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={`${tCommon('preferences')} (Ctrl+,)`}
            onClick={() => import('../../core/preferences.js').then(m => m.showPreferencesDialog())}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M15,24H9V20.487a9,9,0,0,1-2.849-1.646L3.107,20.6l-3-5.2L3.15,13.645a9.1,9.1,0,0,1,0-3.29L.107,8.6l3-5.2L6.151,5.159A9,9,0,0,1,9,3.513V0h6V3.513a9,9,0,0,1,2.849,1.646L20.893,3.4l3,5.2L20.85,10.355a9.1,9.1,0,0,1,0,3.29L23.893,15.4l-3,5.2-3.044-1.758A9,9,0,0,1,15,20.487Zm-4-2h2V18.973l.751-.194A6.984,6.984,0,0,0,16.994,16.9l.543-.553,2.623,1.515,1-1.732-2.62-1.513.206-.746a7.048,7.048,0,0,0,0-3.75l-.206-.746,2.62-1.513-1-1.732L17.537,7.649,16.994,7.1a6.984,6.984,0,0,0-3.243-1.875L13,5.027V2H11V5.027l-.751.194A6.984,6.984,0,0,0,7.006,7.1l-.543.553L3.84,6.134l-1,1.732L5.46,9.379l-.206.746a7.048,7.048,0,0,0,0,3.75l.206.746L2.84,16.134l1,1.732,2.623-1.515.543.553a6.984,6.984,0,0,0,3.243,1.875l.751.194Zm1-6a4,4,0,1,1,4-4A4,4,0,0,1,12,16Zm0-6a2,2,0,1,0,2,2A2,2,0,0,0,12,10Z"/>
            </svg>
          </button>

          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title={`${tCommon('undo')} (Ctrl+Z)`} disabled={!undoEnabled()}
            onClick={() => import('../../core/undo-manager.js').then(m => m.undo())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 5.5h6.5a4 4 0 0 1 0 8H6"/>
              <path d="M6 2.5L3 5.5l3 3"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={`${tCommon('redo')} (Ctrl+Y)`} disabled={!redoEnabled()}
            onClick={() => import('../../core/undo-manager.js').then(m => m.redo())}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M13 5.5H6.5a4 4 0 0 0 0 8H10"/>
              <path d="M10 2.5l3 3-3 3"/>
            </svg>
          </button>

          <div class="quick-access-separator"></div>

          <button class="quick-access-btn" title={tCommon('previousView')} disabled>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 3L5 8l5 5"/>
            </svg>
          </button>

          <button class="quick-access-btn" title={tCommon('nextView')} disabled>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
              <path d="M6 3l5 5-5 5"/>
            </svg>
          </button>

        </div>
      </div>

      <div class="title-bar-center" attr:data-tauri-drag-region={hasDialogs() ? undefined : ''}>
        <span class="app-title">{tCommon('appName')} v{__APP_VERSION__}</span>
        <span class="file-name">{fileName()}</span>
      </div>

      <div class="window-controls">
        <button class="send-feedback-btn" onClick={() => openDialog('feedback')}>
          {tCommon('sendFeedback')}
        </button>
        <button class="window-btn" title={tCommon('minimize')} disabled={hasDialogs()}
          onClick={() => import('../../core/platform.js').then(m => m.minimizeWindow())}>
          <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="window-btn" title={tCommon('maximize')} disabled={hasDialogs()}
          onClick={() => import('../../core/platform.js').then(m => m.maximizeWindow())}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
        <button class="window-btn window-btn-close" title={tCommon('close')} disabled={hasDialogs()}
          onClick={handleClose}>
          <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
        </button>
      </div>
    </div>
  );
}
