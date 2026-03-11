import { createSignal } from 'solid-js';

const [activeTab, setActiveTab] = createSignal('thumbnails');
const [collapsed, setCollapsed] = createSignal(false);

export function switchToLeftPanelTab(panelId) {
  setActiveTab(panelId);
  if (collapsed()) {
    setCollapsed(false);
  }
}

export function toggleLeftPanelCollapsed() {
  const willCollapse = !collapsed();
  setCollapsed(willCollapse);
  // Clear inline width set by resize handler so CSS class takes effect
  const panel = document.getElementById('left-panel');
  if (panel) {
    if (willCollapse) {
      panel.dataset.prevWidth = panel.style.width || '';
      panel.style.width = '';
    } else if (panel.dataset.prevWidth) {
      panel.style.width = panel.dataset.prevWidth;
    }
  }
}

export {
  activeTab, setActiveTab,
  collapsed, setCollapsed
};
