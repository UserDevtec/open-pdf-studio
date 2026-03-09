import { onMount, onCleanup } from 'solid-js';

// Track when the window last gained focus (shared across all Dialog instances)
let lastFocusTime = 0;
function onWindowFocus() { lastFocusTime = Date.now(); }
window.addEventListener('focus', onWindowFocus);

export default function Dialog(props) {
  let overlayRef;
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
    const overlayRect = overlayRef.getBoundingClientRect();
    let newX = e.clientX - overlayRect.left - dragOffsetX;
    let newY = e.clientY - overlayRect.top - dragOffsetY;
    const dialogRect = dialogRef.getBoundingClientRect();
    newX = Math.max(0, Math.min(newX, overlayRect.width - dialogRect.width));
    newY = Math.max(0, Math.min(newY, overlayRect.height - dialogRect.height));
    dialogRef.style.left = newX + 'px';
    dialogRef.style.top = newY + 'px';
    dialogRef.style.transform = 'none';
    dialogRef.style.position = 'absolute';
  }

  function onMouseUp() {
    isDragging = false;
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      props.onClose?.();
    }
  }

  function triggerBump() {
    if (!dialogRef) return;
    // Remove class first to allow re-triggering
    dialogRef.classList.remove('bump');
    // Force reflow so the animation restarts
    void dialogRef.offsetWidth;
    dialogRef.classList.add('bump');
    // Play system alert sound via Rust backend
    if (window.__TAURI__?.core?.invoke) {
      window.__TAURI__.core.invoke('play_alert_sound').catch(() => {});
    }
  }

  function onOverlayMouseDown(e) {
    // If the window just gained focus from this click, only activate — don't interact
    if (Date.now() - lastFocusTime < 300) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    // Only trigger bump if click is directly on the overlay (not the dialog)
    if (e.target === overlayRef) {
      e.preventDefault();
      e.stopPropagation();
      triggerBump();
    }
  }

  function onOverlayDblClick(e) {
    // Block double-click on overlay from reaching the window behind
    if (e.target === overlayRef) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div
      ref={overlayRef}
      class={`modal-overlay ${props.overlayClass || ''}`}
      style="display:flex"
      onMouseDown={onOverlayMouseDown}
      onDblClick={onOverlayDblClick}
    >
      <div
        ref={dialogRef}
        class={`modal-dialog ${props.dialogClass || ''}`}
        onAnimationEnd={() => dialogRef?.classList.remove('bump')}
      >
        <div
          class={`modal-header ${props.headerClass || ''}`}
          onMouseDown={onHeaderMouseDown}
        >
          <h2>{props.title}</h2>
          <button class="modal-close-btn" onClick={() => props.onClose?.()}>
            <svg width="10" height="10" viewBox="0 0 10 10"><line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2"/><line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2"/></svg>
          </button>
        </div>
        <div class={`modal-body ${props.bodyClass || ''}`}>
          {props.children}
        </div>
        {props.footer && (
          <div class={`modal-footer ${props.footerClass || ''}`}>
            {props.footer}
          </div>
        )}
      </div>
    </div>
  );
}
