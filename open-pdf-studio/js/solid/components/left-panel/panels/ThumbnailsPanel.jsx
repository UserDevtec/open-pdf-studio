import { For, onMount } from 'solid-js';
import { pageCount, selectAllPages, clearPageSelection, getSelectedPagesArray, formatPageRangeString, setContainerRef } from '../../../stores/panels/thumbnailStore.js';
import { activeTab } from '../../../stores/leftPanelStore.js';
import ThumbnailItem from '../ThumbnailItem.jsx';
import { useTranslation } from '../../../../i18n/useTranslation.js';

export default function ThumbnailsPanel() {
  const { t } = useTranslation('properties');

  const pages = () => {
    const count = pageCount();
    return Array.from({ length: count }, (_, i) => i + 1);
  };

  const handleNavigate = (pageNum) => {
    import('../../../../pdf/renderer.js').then(m => m.goToPage(pageNum));
  };

  const handleReorder = async (fromPage, toPage, dropBefore) => {
    const { reorderPages } = await import('../../../../pdf/page-manager.js');
    const numPages = pageCount();
    const currentOrder = Array.from({ length: numPages }, (_, i) => i + 1);
    const fromIdx = currentOrder.indexOf(fromPage);
    currentOrder.splice(fromIdx, 1);
    let toIdx = currentOrder.indexOf(toPage);
    if (!dropBefore) toIdx++;
    currentOrder.splice(toIdx, 0, fromPage);
    await reorderPages(currentOrder);
  };

  const handleKeyDown = async (e) => {
    if (e.ctrlKey && e.key === 'a') {
      e.preventDefault();
      selectAllPages();
    } else if (e.key === 'Escape') {
      clearPageSelection();
    } else if (e.key === 'Delete') {
      const selected = getSelectedPagesArray();
      if (selected.length > 0 && selected.length < pageCount()) {
        const rangeStr = formatPageRangeString(selected);
        const { openDialog } = await import('../../../stores/dialogStore.js');
        openDialog('delete-pages', {
          totalPages: pageCount(),
          currentPage: selected[0],
          pageRange: rangeStr
        });
      }
    }
  };

  return (
    <div class={`left-panel-content${activeTab() === 'thumbnails' ? ' active' : ''}`} id="thumbnails-panel">
      <div class="left-panel-header">
        <span>{t('leftPanel.thumbnails')}</span>
      </div>
      <div class="thumbnails-container" id="thumbnails-container" ref={setContainerRef} tabIndex={0} onKeyDown={handleKeyDown}>
        <For each={pages()}>
          {(pageNum) => (
            <ThumbnailItem
              pageNum={pageNum}
              onNavigate={handleNavigate}
              onReorder={handleReorder}
            />
          )}
        </For>
      </div>
    </div>
  );
}
