import { Show, For, createSignal, onMount, onCleanup } from 'solid-js';
import { state, getActiveDocument } from '../../core/state.js';
import { createAnnotation } from '../../annotations/factory.js';
import {
  scheduleVisible, setScheduleVisible,
  groupBy, setGroupBy,
  filterType, setFilterType,
  searchLabel, setSearchLabel,
  groupedEntries, scheduleEntries,
  saveTemplate, loadTemplate, deleteTemplate, getTemplates,
  exportCSV,
} from '../stores/scheduleStore.js';

export default function SchedulePanel() {
  const [templateName, setTemplateName] = createSignal('');
  const [showTemplates, setShowTemplates] = createSignal(false);

  let dialogRef;
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  function onHeaderMouseDown(e) {
    if (e.target.closest('.modal-close-btn')) return;
    isDragging = true;
    const rect = dialogRef.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    let newX = e.clientX - dragOffsetX;
    let newY = e.clientY - dragOffsetY;
    const dialogRect = dialogRef.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, window.innerWidth - dialogRect.width));
    newY = Math.max(0, Math.min(newY, window.innerHeight - dialogRect.height));
    dialogRef.style.left = newX + 'px';
    dialogRef.style.top = newY + 'px';
    dialogRef.style.transform = 'none';
  }

  function onMouseUp() {
    isDragging = false;
  }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  onCleanup(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  });

  // Place schedule as annotation on PDF
  function placeOnPdf() {
    const doc = getActiveDocument();
    if (!doc) return;
    const entries = scheduleEntries();
    if (entries.length === 0) return;

    const ann = createAnnotation({
      type: 'scheduleTable',
      page: doc.currentPage,
      x: 50, y: 50,
      width: 400, height: 22 + entries.length * 18,
      scheduleData: entries.map(e => ({ type: e.typeName, label: e.label, subject: e.subject, value: e.value, unit: e.unit, text: e.text, page: e.page })),
      groupByMode: groupBy(),
      color: '#000000',
      lineWidth: 0.5,
      opacity: 1,
    });
    doc.annotations.push(ann);
    import('../../annotations/rendering.js').then(m => m.redrawAnnotations());
  }

  return (
    <Show when={scheduleVisible()}>
      <div
        ref={dialogRef}
        class="modal-dialog schedule-modeless"
        role="dialog"
        aria-label="Take-Off"
      >
        {/* Header — same style as other dialogs */}
        <div class="modal-header" onMouseDown={onHeaderMouseDown}>
          <h2>Take-Off</h2>
          <div style={{ display: 'flex', gap: '0', 'align-items': 'center', height: '100%' }}>
            <button class="schedule-header-btn" title="Place on PDF" onClick={placeOnPdf}>PDF</button>
            <button class="schedule-header-btn" title="Export CSV" onClick={exportCSV}>CSV</button>
            <button class="schedule-header-btn" title="Templates" onClick={() => setShowTemplates(!showTemplates())}>
              {showTemplates() ? 'Hide' : 'Tmpl'}
            </button>
            <button class="modal-close-btn" onClick={() => setScheduleVisible(false)}>
              <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
          </div>
        </div>

        {/* Templates section */}
        <Show when={showTemplates()}>
          <div class="schedule-templates">
            <div style={{ display: 'flex', gap: '4px', 'margin-bottom': '4px' }}>
              <input type="text" placeholder="Template name..." value={templateName()}
                onInput={(e) => setTemplateName(e.target.value)}
                class="schedule-input" style={{ flex: 1 }} />
              <button class="schedule-btn-sm" disabled={!templateName().trim()}
                onClick={() => { saveTemplate(templateName().trim()); setTemplateName(''); }}>Save</button>
            </div>
            <For each={getTemplates()}>
              {(t) => (
                <div class="schedule-template-row">
                  <span class="schedule-template-name" onClick={() => loadTemplate(t.name)}>{t.name}</span>
                  <button class="schedule-btn-xs" onClick={() => deleteTemplate(t.name)}>x</button>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* Filters */}
        <div class="schedule-filters">
          <select value={groupBy()} onChange={(e) => setGroupBy(e.target.value)} class="schedule-select">
            <option value="type">Group: Type</option>
            <option value="page">Group: Page</option>
            <option value="label">Group: Label</option>
          </select>
          <select value={filterType()} onChange={(e) => setFilterType(e.target.value)} class="schedule-select">
            <option value="all">All types</option>
            <option value="measureDistance">Distance</option>
            <option value="measureArea">Area</option>
            <option value="measurePerimeter">Perimeter</option>
            <option value="measureAngle">Angle</option>
          </select>
          <input type="text" placeholder="Filter label..." value={searchLabel()}
            onInput={(e) => setSearchLabel(e.target.value)}
            class="schedule-input" />
        </div>

        {/* Table */}
        <div class="schedule-body">
          <Show when={groupedEntries().length > 0} fallback={
            <div class="schedule-empty">No measurements found</div>
          }>
            <For each={groupedEntries()}>
              {(group) => (
                <div class="schedule-group">
                  <div class="schedule-group-header">
                    <span class="schedule-group-name">{group.name}</span>
                    <span class="schedule-group-count">{group.items.length}</span>
                  </div>
                  <table class="schedule-table">
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>Subject</th>
                        <th>Value</th>
                        <th>Unit</th>
                        <th>Pg</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={group.items}>
                        {(item) => (
                          <tr>
                            <td>{item.label || item.typeName}</td>
                            <td>{item.subject}</td>
                            <td class="schedule-val">{item.text}</td>
                            <td>{item.unit}</td>
                            <td>{item.page}</td>
                          </tr>
                        )}
                      </For>
                      <Show when={group.items.length > 1}>
                        <tr class="schedule-total-row">
                          <td>Total</td>
                          <td></td>
                          <td class="schedule-val">{group.total.toFixed(2)}</td>
                          <td>{group.unit}</td>
                          <td></td>
                        </tr>
                      </Show>
                    </tbody>
                  </table>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* Footer */}
        <div class="schedule-footer">
          <span>{scheduleEntries().length} measurements</span>
        </div>
      </div>
    </Show>
  );
}
