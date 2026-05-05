import { Show } from 'solid-js';
import {
  typeLengthBuffer,
  typeLengthCursor,
  typeLengthFormat,
} from '../../tools/type-length-input.js';

/**
 * Overlay HUD that shows the live coord-input buffer.  Hidden when buffer is
 * empty.  Shows a colored format hint next to the typed text:
 *   length    → blue   "len"
 *   cartesian → green  "@dx,dy"
 *   polar     → orange "@d<θ"
 *   absolute  → purple "abs"
 *   invalid   → red    "?"
 */
function _hintFor(kind) {
  switch (kind) {
    case 'length':    return { text: 'len',    color: '#1c6dd0' };
    case 'cartesian': return { text: '@dx,dy', color: '#2e8b3d' };
    case 'polar':     return { text: '@d<θ',  color: '#d97706' };
    case 'absolute':  return { text: 'abs',    color: '#7c3aed' };
    case 'invalid':   return { text: '?',      color: '#c0382c' };
    default:          return { text: '',       color: '#666666' };
  }
}

export default function TypeLengthHUD() {
  return (
    <Show when={typeLengthBuffer().length > 0}>
      <div
        style={{
          position: 'fixed',
          left: (typeLengthCursor().x + 15) + 'px',
          top: (typeLengthCursor().y + 10) + 'px',
          background: '#ffffff',
          border: '1px solid #000000',
          padding: '2px 6px',
          'font-family': 'Consolas, monospace',
          'font-size': '12px',
          color: '#000000',
          'pointer-events': 'none',
          'z-index': 9999,
          'box-shadow': '1px 1px 2px rgba(0,0,0,0.2)',
          display: 'flex',
          gap: '6px',
          'align-items': 'baseline',
        }}
      >
        <span>{typeLengthBuffer()}</span>
        <Show when={_hintFor(typeLengthFormat()).text}>
          <span style={{ color: _hintFor(typeLengthFormat()).color, 'font-size': '10px' }}>
            {_hintFor(typeLengthFormat()).text}
          </span>
        </Show>
      </div>
    </Show>
  );
}
