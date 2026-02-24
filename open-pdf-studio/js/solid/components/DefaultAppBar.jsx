import { Show } from 'solid-js';
import { visible, hideDefaultAppBar } from '../stores/defaultAppBarStore.js';
import { state } from '../../core/state.js';

export default function DefaultAppBar() {
  const handleSetDefault = () => {
    import('../../core/platform.js').then(m => m.openDefaultAppsSettings());
    hideDefaultAppBar();
  };

  const handleDontAsk = () => {
    state.preferences.dontAskDefaultPdf = true;
    import('../../core/preferences.js').then(m => m.savePreferences());
    hideDefaultAppBar();
  };

  const handleDismiss = () => {
    hideDefaultAppBar();
  };

  return (
    <Show when={visible()}>
      <div class="default-app-bar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="#0969da" stroke-width="1.5" fill="none"/>
          <path d="M7.5 5V4h1v1h-1zm0 7V6.5h1V12h-1z" fill="#0969da"/>
        </svg>
        <span>Open PDF Studio is not set as the default app for opening PDF files.</span>
        <button class="default-app-bar-action" onClick={handleSetDefault}>Set as Default</button>
        <button class="default-app-bar-action" onClick={handleDontAsk}>Don't Ask Again</button>
        <button class="default-app-bar-close" onClick={handleDismiss} title="Close">&times;</button>
      </div>
    </Show>
  );
}
