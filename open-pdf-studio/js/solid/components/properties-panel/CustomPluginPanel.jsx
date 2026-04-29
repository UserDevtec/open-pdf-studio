import { Show, createEffect, onCleanup } from 'solid-js';
import { customPanelRender, updateAnnotProp, getCurrentAnnotation, storeHideProperties, annotProps } from '../../stores/propertiesStore.js';

/**
 * Mounts a plugin-provided custom property-panel renderer when the selected
 * annotation type has one registered via api.registerPropertyPanel(). The
 * plugin renderer returns plain DOM (HTMLElement | DocumentFragment) which we
 * append to the panel-body.
 *
 * Renderer signature:
 *   renderFn(annotation, updateAnnotProp, onCommit, onCancel) -> DOM
 */
export default function CustomPluginPanel() {
  let containerRef;

  // Track last-active renderFn so we can fire a deselect-signal (renderFn(null))
  // when annotation goes away. Plugins that mount DOM elsewhere (e.g. into a
  // tool-palette) need this to know when to clean up.
  let lastRenderFn = null;

  createEffect(() => {
    const renderFn = customPanelRender();
    // Track annotProps.id reactively so the effect re-runs when the selected
    // annotation changes, even if customPanelRender stays the same renderFn
    // reference. getCurrentAnnotation() is a plain getter (not a signal); reading
    // it alone would lose tracking and the panel would stay stale on selection
    // swaps within the same plugin type.
    const trackedId = annotProps.id; // eslint-disable-line @typescript-eslint/no-unused-vars
    const annotation = getCurrentAnnotation();
    if (!containerRef || !renderFn || !annotation) {
      if (containerRef) containerRef.innerHTML = '';
      // Deselect-signal: fire renderFn(null) so plugin can unmount external DOM.
      if (lastRenderFn) {
        try { lastRenderFn(null, updateAnnotProp, () => {}, storeHideProperties); }
        catch (err) { console.error('[CustomPluginPanel] deselect signal threw', err); }
      }
      lastRenderFn = renderFn;
      return;
    }
    containerRef.innerHTML = '';
    try {
      const dom = renderFn(annotation, updateAnnotProp, () => {}, storeHideProperties);
      if (dom) containerRef.appendChild(dom);
    } catch (err) {
      console.error('[CustomPluginPanel] renderFn threw', err);
    }
    lastRenderFn = renderFn;
  });

  onCleanup(() => {
    if (containerRef) containerRef.innerHTML = '';
    if (lastRenderFn) {
      try { lastRenderFn(null, updateAnnotProp, () => {}, storeHideProperties); }
      catch (err) { console.error('[CustomPluginPanel] cleanup signal threw', err); }
      lastRenderFn = null;
    }
  });

  return (
    <Show when={customPanelRender()}>
      <div class="custom-plugin-panel" ref={containerRef} />
    </Show>
  );
}
