import { For, Show, createSignal, onCleanup } from 'solid-js';
import { state } from '../../core/state.js';
import { useTranslation } from '../../i18n/useTranslation.js';

const [editingIndex, setEditingIndex] = createSignal(-1);
const [dropTargetIndex, setDropTargetIndex] = createSignal(-1);
const [draggingIndex, setDraggingIndex] = createSignal(-1);

// Mouse-based drag state (module-level so handlers can access it)
let dragState = null;

function handleTabClick(index) {
  if (editingIndex() === index) return;
  import('../../ui/chrome/tabs.js').then(m => m.switchToTab(index));
}

function handleCloseTab(e, index) {
  e.stopPropagation();
  import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
}

function handleMiddleClick(e, index) {
  if (e.button === 1) {
    e.preventDefault();
    import('../../ui/chrome/tabs.js').then(m => m.closeTab(index));
  }
}

function handleAddClick() {
  import('../../pdf/loader.js').then(m => m.openPDFFile());
}

function handleDoubleClick(e, index) {
  e.stopPropagation();
  const doc = state.documents[index];
  if (!doc) return;

  if (!doc.filePath) {
    import('../../ui/chrome/tabs.js').then(m => m.renameDocument(index, ''));
    return;
  }

  setEditingIndex(index);
}

function handleRenameKeyDown(e, index) {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitRename(e.target, index);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    cancelRename();
  }
}

function commitRename(input, index) {
  const newName = input.value.trim();
  setEditingIndex(-1);
  if (!newName) return;
  import('../../ui/chrome/tabs.js').then(m => m.renameDocument(index, newName));
}

function cancelRename() {
  setEditingIndex(-1);
}

function handleInputMount(el, doc) {
  const name = doc.fileName || '';
  el.value = name.replace(/\.pdf$/i, '');
  requestAnimationFrame(() => {
    el.focus();
    el.select();
  });
}

// --- Mouse-based tab reordering ---

const DRAG_THRESHOLD = 5; // pixels before drag starts

function handleMouseDown(e, index) {
  // Only left button, not on close button or rename input
  if (e.button !== 0) return;
  if (e.target.closest('.document-tab-close') || e.target.closest('.document-tab-rename-input')) return;
  if (editingIndex() === index) return;

  dragState = {
    fromIndex: index,
    startX: e.clientX,
    startY: e.clientY,
    started: false,
  };

  document.addEventListener('mousemove', onDocMouseMove);
  document.addEventListener('mouseup', onDocMouseUp);
}

function onDocMouseMove(e) {
  if (!dragState) return;

  if (!dragState.started) {
    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;
    if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
    dragState.started = true;
    setDraggingIndex(dragState.fromIndex);
    document.body.style.userSelect = 'none';
  }

  // Find which tab the mouse is over
  const tabsContainer = document.getElementById('document-tabs');
  if (!tabsContainer) return;

  const tabElements = tabsContainer.querySelectorAll('.document-tab');
  let targetIndex = -1;

  for (let i = 0; i < tabElements.length; i++) {
    const rect = tabElements[i].getBoundingClientRect();
    if (e.clientX >= rect.left && e.clientX < rect.right) {
      targetIndex = i;
      break;
    }
  }

  if (targetIndex !== -1 && targetIndex !== dragState.fromIndex) {
    setDropTargetIndex(targetIndex);
  } else {
    setDropTargetIndex(-1);
  }
}

function onDocMouseUp(e) {
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseup', onDocMouseUp);
  document.body.style.userSelect = '';

  if (!dragState) return;

  const from = dragState.fromIndex;
  const wasStarted = dragState.started;
  dragState = null;
  setDraggingIndex(-1);

  const target = dropTargetIndex();
  setDropTargetIndex(-1);

  if (!wasStarted || target === -1 || target === from) return;

  // Track which doc is active by its id
  const activeId = state.documents[state.activeDocumentIndex]?.id;

  // Reorder
  const [moved] = state.documents.splice(from, 1);
  state.documents.splice(target, 0, moved);

  // Maintain active tab
  if (activeId) {
    const newActiveIndex = state.documents.findIndex(d => d.id === activeId);
    if (newActiveIndex !== -1) {
      state.activeDocumentIndex = newActiveIndex;
    }
  }

  import('../../ui/chrome/tabs.js').then(m => m.updateTabBar());
}

export default function DocumentTabs() {
  const { t } = useTranslation('statusbar');

  onCleanup(() => {
    document.removeEventListener('mousemove', onDocMouseMove);
    document.removeEventListener('mouseup', onDocMouseUp);
  });

  return (
    <div class="document-tabs" id="document-tabs">
      <Show when={state.documents.length === 0}>
        <div class="document-tabs-empty">{t('noDocumentsOpen')}</div>
      </Show>

      <For each={state.documents}>
        {(doc, i) => (
          <div
            class={'document-tab'
              + (i() === state.activeDocumentIndex ? ' active' : '')
              + (draggingIndex() === i() ? ' dragging' : '')
              + (dropTargetIndex() === i() ? ' drop-target' : '')}
            data-index={i()}
            onClick={() => handleTabClick(i())}
            onAuxClick={(e) => handleMiddleClick(e, i())}
            onDblClick={(e) => handleDoubleClick(e, i())}
            onMouseDown={(e) => handleMouseDown(e, i())}
          >
            <span class="document-tab-modified">{doc.modified ? '*' : ''}</span>
            <Show when={editingIndex() === i()} fallback={
              <span class="document-tab-title" title={doc.filePath || doc.fileName}>{doc.fileName}</span>
            }>
              <input
                class="document-tab-rename-input"
                ref={(el) => handleInputMount(el, doc)}
                onKeyDown={(e) => handleRenameKeyDown(e, i())}
                onBlur={() => cancelRename()}
                onClick={(e) => e.stopPropagation()}
              />
            </Show>
            <span class="document-tab-close" title={t('closeTab')} onClick={(e) => handleCloseTab(e, i())}>&times;</span>
          </div>
        )}
      </For>

      <div class="document-tabs-add" title={t('openPdfFile')} onClick={handleAddClick}>+</div>
    </div>
  );
}
