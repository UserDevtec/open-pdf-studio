import { isMobile } from '../core/platform.js';
import MobileApp from './MobileApp.jsx';
import TitleBar from './components/TitleBar.jsx';
import Ribbon from './components/ribbon/Ribbon.jsx';
import DocumentTabs from './components/DocumentTabs.jsx';
import LeftPanel from './components/left-panel/LeftPanel.jsx';
import FindBar from './components/FindBar.jsx';
import FormFieldsBar from './components/FormFieldsBar.jsx';
import PdfABar from './components/PdfABar.jsx';
import NotificationBar from './components/NotificationBar.jsx';
import PropertiesPanel from './components/properties-panel/PropertiesPanel.jsx';
import StatusBar from './components/StatusBar.jsx';
import AppMenu from './components/app-menu/AppMenu.jsx';
import DialogHost from './components/DialogHost.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import LoadingOverlay from './components/LoadingOverlay.jsx';
import { DockedToolPalette, FloatingToolPalette, DockTargets } from './components/ToolPalette.jsx';
import { useTranslation } from '../i18n/useTranslation.js';

function DesktopApp() {
  const { t } = useTranslation('common');

  return (
    <>
      <TitleBar />

      <div class="ribbon-container">
        <Ribbon />
      </div>

      <NotificationBar />
      <DocumentTabs />

      <div class="content">
        <LeftPanel />
        <DockedToolPalette side="left" />

        <div class="main-view">
          <DockTargets />
          <FindBar />

          <div id="placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            <h2>{t('noDocuments')}</h2>
            <p>{t('noDocumentsHint')}</p>
          </div>

          <FormFieldsBar />

          <PdfABar />

          <div id="pdf-container">
            <div id="canvas-wrapper">
              <div id="canvas-container" class="single-page-container">
                <canvas id="pdf-canvas"></canvas>
                <canvas id="annotation-canvas"></canvas>
              </div>
              <div id="continuous-container" class="continuous-container"></div>
            </div>
          </div>
        </div>

        <DockedToolPalette side="right" />
        <PropertiesPanel />
      </div>

      <StatusBar />

      <AppMenu />
      <DialogHost />
      <ContextMenu />
      <FloatingToolPalette />
      <LoadingOverlay />
    </>
  );
}

export default function App() {
  if (isMobile()) {
    return <MobileApp />;
  }
  return <DesktopApp />;
}
