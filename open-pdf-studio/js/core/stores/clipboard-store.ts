import { createMutable } from 'solid-js/store';
import type { Annotation } from '../../types/annotation.js';

export interface ClipboardState {
  annotation: Annotation | null;
  annotations: Annotation[];
}

export const clipboardState = createMutable<ClipboardState>({
  annotation: null,
  annotations: [],
});

export function clearClipboard(): void {
  clipboardState.annotation = null;
  clipboardState.annotations = [];
}
