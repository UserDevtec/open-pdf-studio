import { Show, createEffect, createMemo } from 'solid-js';
import { active, overlayStyle, text, setText, onCommit, onCancel, hideTextEditOverlay, heightGrowth, setHeightGrowth, setOverlayStyle } from '../stores/textEditOverlayStore.js';
import { state } from '../../core/state.js';
import { redrawAnnotations, redrawContinuous } from '../../annotations/rendering.js';

export default function TextEditOverlay() {
  let textareaRef;

  function autoGrow() {
    if (!textareaRef) return;
    const overflow = textareaRef.scrollHeight - textareaRef.clientHeight;
    if (overflow > 0) {
      setHeightGrowth(g => g + overflow);
    }
  }

  // Toggle bold/italic/underline on the active textbox annotation.
  // The textarea itself is plain text, so the toggle applies to the WHOLE textbox.
  function toggleStyle(prop) {
    const ann = state.editingAnnotation;
    if (!ann) return;
    ann[prop] = !ann[prop];
    // Update overlay textarea CSS so the user sees the change live
    const s = overlayStyle();
    const next = { ...s };
    if (prop === 'fontBold') next['font-weight'] = ann.fontBold ? 'bold' : 'normal';
    if (prop === 'fontItalic') next['font-style'] = ann.fontItalic ? 'italic' : 'normal';
    if (prop === 'fontUnderline') next['text-decoration'] = ann.fontUnderline ? 'underline' : 'none';
    setOverlayStyle(next);
    // Refresh canvas so unselected text instantly reflects the change
    if (state.documents?.[state.activeDocumentIndex]?.viewMode === 'continuous') redrawContinuous();
    else redrawAnnotations();
  }

  createEffect(() => {
    if (active() && textareaRef) {
      textareaRef.focus();
      textareaRef.select();
      // Check initial overflow (existing text may already exceed box)
      requestAnimationFrame(() => autoGrow());
    }
  });

  const handleBlur = () => {
    if (!active()) return;
    const commitFn = onCommit();
    if (commitFn) commitFn(text());
    hideTextEditOverlay();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      const cancelFn = onCancel();
      if (cancelFn) cancelFn();
      hideTextEditOverlay();
      return;
    }
    // Ctrl+B → toggle bold, Ctrl+I → italic, Ctrl+U → underline
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); e.stopPropagation(); toggleStyle('fontBold'); return; }
      if (k === 'i') { e.preventDefault(); e.stopPropagation(); toggleStyle('fontItalic'); return; }
      if (k === 'u') { e.preventDefault(); e.stopPropagation(); toggleStyle('fontUnderline'); return; }
    }
    // Don't propagate keyboard events during editing
    e.stopPropagation();
  };

  const handleInput = (e) => {
    setText(e.target.value);
    // Auto-grow after DOM updates
    requestAnimationFrame(() => autoGrow());
  };

  // Separate wrapper style (position/size/clip) from textarea style (font/colors)
  const wrapperStyle = createMemo(() => {
    const s = overlayStyle();
    const growth = heightGrowth();
    const baseH = parseFloat(s.height) || 0;
    const finalH = baseH + growth;
    const baseTop = parseFloat(s.top) || 0;
    // Grow downward: shift center down by half the growth (compensate for translate(-50%, -50%))
    const finalTop = baseTop + growth / 2;
    return {
      position: s.position,
      left: s.left,
      top: `${finalTop}px`,
      width: s.width,
      height: `${finalH}px`,
      transform: s.transform,
      'z-index': s['z-index'],
      overflow: 'hidden',
      'pointer-events': 'auto'
    };
  });

  const textareaStyle = createMemo(() => {
    const s = overlayStyle();
    const offset = s['--text-offset'] || '0px';
    // Copy all styles except position/size/transform (handled by wrapper)
    const ts = { ...s };
    delete ts.position;
    delete ts.left;
    delete ts.top;
    delete ts.transform;
    delete ts['z-index'];
    delete ts['--text-offset'];
    // Reactively reflect bold/italic/underline from the editing annotation,
    // so panel toggles or Ctrl+B/I/U update the textarea live.
    const ann = state.editingAnnotation;
    if (ann) {
      ts['font-weight'] = ann.fontBold ? 'bold' : 'normal';
      ts['font-style'] = ann.fontItalic ? 'italic' : 'normal';
      ts['text-decoration'] = ann.fontUnderline ? 'underline' : 'none';
      if (ann.textColor) ts.color = ann.textColor;
      if (ann.fontFamily) ts['font-family'] = ann.fontFamily;
    }
    // Make textarea fill the wrapper, shifted up by halfLeading
    ts.position = 'absolute';
    ts.left = '0';
    ts.top = `-${offset}`;
    ts.width = '100%';
    ts.height = `calc(100% + ${offset})`;
    return ts;
  });

  return (
    <Show when={active()}>
      <div style={wrapperStyle()}>
        <textarea
          ref={textareaRef}
          class="inline-text-editor"
          style={textareaStyle()}
          value={text()}
          onInput={handleInput}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      </div>
    </Show>
  );
}
