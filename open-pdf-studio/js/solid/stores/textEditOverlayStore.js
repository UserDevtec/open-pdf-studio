import { createSignal } from 'solid-js';

const [active, setActive] = createSignal(false);
const [overlayStyle, setOverlayStyle] = createSignal({});
const [text, setText] = createSignal('');
const [onCommit, setOnCommit] = createSignal(null);
const [onCancel, setOnCancel] = createSignal(null);
const [heightGrowth, setHeightGrowth] = createSignal(0);

export function showTextEditOverlay(style, initialText, commitFn, cancelFn) {
  setHeightGrowth(0);
  setOverlayStyle(style);
  setText(initialText);
  setOnCommit(() => commitFn);
  setOnCancel(() => cancelFn);
  setActive(true);
}

export function hideTextEditOverlay() {
  setActive(false);
  setHeightGrowth(0);
}

export function getTextValue() {
  return text();
}

export function getHeightGrowth() {
  return heightGrowth();
}

export { active, overlayStyle, setOverlayStyle, text, setText, onCommit, onCancel, heightGrowth, setHeightGrowth };
