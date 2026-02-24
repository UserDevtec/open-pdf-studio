import { createSignal } from 'solid-js';

const [visible, setVisible] = createSignal(false);

export function showDefaultAppBar() {
  setVisible(true);
}

export function hideDefaultAppBar() {
  setVisible(false);
}

export { visible };
