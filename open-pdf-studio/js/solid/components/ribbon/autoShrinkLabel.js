const MIN_FONT_SIZE = 7;
const DEFAULT_FONT_SIZE = 10;
const MAX_LINES = 2;

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    const el = m.target.nodeType === Node.TEXT_NODE ? m.target.parentElement : m.target;
    if (el) shrink(el);
  }
});

function shrink(el) {
  if (!el || !el.parentElement) return;

  // Reset to default size
  el.style.fontSize = '';
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || (DEFAULT_FONT_SIZE * 1.15);
  const maxHeight = lineHeight * MAX_LINES + 1; // allow 2 lines

  let size = DEFAULT_FONT_SIZE;
  // If content overflows 2 lines, reduce font size until it fits
  while (el.scrollHeight > maxHeight && size > MIN_FONT_SIZE) {
    size -= 0.5;
    el.style.fontSize = size + 'px';
  }
}

/**
 * Attach to a ribbon-btn-label span via ref.
 * Shrinks font-size so text fits within 2 lines without breaking words.
 */
export function autoShrinkLabel(el) {
  requestAnimationFrame(() => shrink(el));
  observer.observe(el, { childList: true, characterData: true, subtree: true });
}
