/**
 * Coord-input capture module — CAD-style live coordinate entry.
 *
 * Supports four input formats while a tool/flow has activated capture mode:
 *
 *   length        e.g. `100`        distance in current cursor direction
 *   relative XY   e.g. `100,50`     offset @dx,dy from anchor
 *   polar         e.g. `100<45`     distance @ angle (deg) from anchor
 *   absolute      e.g. `=400,300`   absolute app-coord (top-left origin)
 *
 * Parsing rules (live, on every keystroke):
 *   - starts with `=` → absolute (must contain `,` after the `=`)
 *   - contains `<` → polar (split on `<`)
 *   - contains `,` → relative XY (split on `,`)
 *   - otherwise → length
 *
 * Numeric values:
 *   - `.` is the decimal separator (locale-agnostic, v1)
 *   - `,` is ALWAYS a field separator, never a decimal
 *   - leading `-` permitted on either field of relative/polar/absolute
 *
 * Backward compatibility:
 *   - public API (enter/exit/setStart/clear/applyToEndpoint/consumeKey) unchanged
 *   - typing `100` keeps the original length-only behaviour
 *   - applyToEndpoint signature unchanged: returns {x, y, constrained}
 *
 * Coordinate considerations:
 *   - typed numeric values are in current scale units; converted to app pixels
 *     via getMeasureScale().pixelsPerUnit
 *   - absolute mode interprets `=X,Y` as raw app-coords (already pixels) so it
 *     bypasses the unit conversion
 *
 * SolidJS signals exposed for HUD overlay:
 *   typeLengthBuffer()  — raw buffer string
 *   typeLengthCursor()  — last-seen cursor in viewport coords
 *   typeLengthFormat()  — parsed format kind: 'length'|'cartesian'|'polar'|'absolute'|'invalid'|'empty'
 */

import { createSignal } from 'solid-js';
import { getMeasureScale } from '../annotations/measurement.js';

// ── SolidJS signals exposed to the HUD overlay ─────────────────────────────
const [_buffer, _setBuffer] = createSignal('');
const [_cursorScreen, _setCursorScreen] = createSignal({ x: 0, y: 0 });
const [_format, _setFormat] = createSignal('empty');

export const typeLengthBuffer = _buffer;
export const typeLengthCursor = _cursorScreen;
export const typeLengthFormat = _format;

// ── Internal mode state ────────────────────────────────────────────────────
const _mode = {
  active: false,
  startX: 0,
  startY: 0,
};

/** Returns true if a tool has called enterTypeLengthMode and not yet exited. */
export function typeLengthActive() {
  return _mode.active;
}

/** Returns true if the user has typed at least one char (so endpoint should be constrained). */
export function typeLengthHasBuffer() {
  return _mode.active && _buffer().length > 0;
}

export function getTypeLengthStart() {
  return { x: _mode.startX, y: _mode.startY };
}

/** Activate coord-input capture for a tool that just committed its start point. */
export function enterTypeLengthMode(startX, startY) {
  _mode.active = true;
  _mode.startX = startX;
  _mode.startY = startY;
  _setBuffer('');
  _setFormat('empty');
}

/** Deactivate (called from tool onDeactivate or after final commit). */
export function exitTypeLengthMode() {
  _mode.active = false;
  _setBuffer('');
  _setFormat('empty');
}

/** Clear only the buffer but keep the mode active. */
export function clearTypeLengthBuffer() {
  _setBuffer('');
  _setFormat('empty');
}

/** Update startX/Y for tools that move along (e.g. polyline next segment). */
export function setTypeLengthStart(x, y) {
  _mode.startX = x;
  _mode.startY = y;
  _setBuffer('');
  _setFormat('empty');
}

/** Called from the canvas pointermove so the HUD can follow the cursor. */
export function setTypeLengthCursorScreen(clientX, clientY) {
  _setCursorScreen({ x: clientX, y: clientY });
}

// ── Parsing ────────────────────────────────────────────────────────────────

/**
 * Parse a buffer string into a structured form.
 * Returns { kind, a, b } where:
 *   kind ∈ 'empty' | 'length' | 'cartesian' | 'polar' | 'absolute' | 'invalid'
 *   a, b are numbers (b unused for length)
 */
export function parseCoordBuffer(s) {
  if (!s || s.length === 0) return { kind: 'empty', a: null, b: null };

  // Absolute: starts with '='
  if (s[0] === '=') {
    const rest = s.slice(1);
    if (rest.length === 0) return { kind: 'absolute', a: null, b: null };
    // require a comma separator (or '<' for polar-absolute, but spec keeps it cartesian-only)
    const idx = rest.indexOf(',');
    if (idx < 0) return { kind: 'absolute', a: null, b: null };
    const xs = rest.slice(0, idx);
    const ys = rest.slice(idx + 1);
    const x = _toNum(xs);
    const y = _toNum(ys);
    if (x == null || (ys.length > 0 && y == null)) return { kind: 'invalid', a: null, b: null };
    return { kind: 'absolute', a: x, b: ys.length === 0 ? null : y };
  }

  // Polar: contains '<'
  const ltIdx = s.indexOf('<');
  if (ltIdx >= 0) {
    const ds = s.slice(0, ltIdx);
    const ts = s.slice(ltIdx + 1);
    const d = _toNum(ds);
    const t = ts.length === 0 ? null : _toNum(ts);
    if (d == null) return { kind: 'invalid', a: null, b: null };
    if (ts.length > 0 && t == null) return { kind: 'invalid', a: null, b: null };
    return { kind: 'polar', a: d, b: t };
  }

  // Relative XY: contains ','
  const commaIdx = s.indexOf(',');
  if (commaIdx >= 0) {
    const xs = s.slice(0, commaIdx);
    const ys = s.slice(commaIdx + 1);
    const x = _toNum(xs);
    const y = ys.length === 0 ? null : _toNum(ys);
    if (x == null) return { kind: 'invalid', a: null, b: null };
    if (ys.length > 0 && y == null) return { kind: 'invalid', a: null, b: null };
    return { kind: 'cartesian', a: x, b: y };
  }

  // Length-only: must be numeric
  const v = _toNum(s);
  if (v == null) return { kind: 'invalid', a: null, b: null };
  return { kind: 'length', a: v, b: null };
}

function _toNum(s) {
  if (s == null) return null;
  const t = s.trim();
  if (t === '' || t === '-' || t === '.' || t === '-.') return null;
  // Reject anything that isn't a clean signed decimal
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const v = parseFloat(t);
  return isFinite(v) ? v : null;
}

function _reparse() {
  const r = parseCoordBuffer(_buffer());
  _setFormat(r.kind);
}

// ── Key consumption ────────────────────────────────────────────────────────

/**
 * Consume a key while in coord-input mode.
 * Returns:
 *   { handled: false }                          — key not relevant
 *   { handled: true, committed: true,
 *     length: number|null }                     — Enter pressed with valid buffer
 *   { handled: true, committed: false }         — buffer edited
 *   { handled: true, aborted: true }            — Esc pressed
 */
export function consumeKey(key) {
  if (!_mode.active) return { handled: false };

  // Allow chars that participate in any of the four formats: digits, '.', ',',
  // '<', '=', '-' plus the editing keys.
  if (/^[0-9]$/.test(key)) {
    _setBuffer(_buffer() + key);
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '.') {
    // Append a literal decimal point. Multiple dots are allowed in different
    // fields (e.g. "12.5,3.7"); we let the parser reject malformed numbers.
    _setBuffer(_buffer() + '.');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === ',') {
    // Comma is ALWAYS a field separator (spec). Don't add a second comma in
    // formats that only support one field separator.
    const buf = _buffer();
    if (buf.includes(',')) return { handled: true, committed: false };
    if (buf.includes('<')) return { handled: true, committed: false };
    _setBuffer(buf + ',');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '<') {
    const buf = _buffer();
    // '<' valid only if no '<' already and no ',' (would mix formats)
    if (buf.includes('<') || buf.includes(',')) return { handled: true, committed: false };
    if (buf.length === 0 || buf === '=' || buf === '-') return { handled: true, committed: false };
    _setBuffer(buf + '<');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '=') {
    // Only meaningful as the very first character.
    if (_buffer().length !== 0) return { handled: true, committed: false };
    _setBuffer('=');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === '-') {
    // Allow '-' at start of buffer or right after a separator (',' '<' '=')
    const buf = _buffer();
    const last = buf.length > 0 ? buf[buf.length - 1] : '';
    const ok = buf.length === 0 || last === ',' || last === '<' || last === '=';
    if (!ok) return { handled: true, committed: false };
    _setBuffer(buf + '-');
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === 'Backspace') {
    if (_buffer().length === 0) return { handled: false };
    _setBuffer(_buffer().slice(0, -1));
    _reparse();
    return { handled: true, committed: false };
  }
  if (key === 'Tab') {
    // Tab is consumed while active (spec mentions field cycling for v2).
    // For v1 just swallow it so it doesn't break tool focus, no buffer change.
    if (_buffer().length === 0) return { handled: false };
    return { handled: true, committed: false };
  }
  if (key === 'Enter') {
    const r = parseCoordBuffer(_buffer());
    if (r.kind === 'invalid' || r.kind === 'empty') return { handled: false };
    // Length-only must have a > 0 to be meaningful (kept from original behaviour)
    if (r.kind === 'length' && (r.a == null || r.a <= 0)) return { handled: false };
    return { handled: true, committed: true, length: r.kind === 'length' ? r.a : null };
  }
  if (key === 'Escape') {
    if (_buffer().length === 0) return { handled: false };
    _setBuffer('');
    _setFormat('empty');
    return { handled: true, aborted: true };
  }
  return { handled: false };
}

// ── Endpoint constraint ────────────────────────────────────────────────────

/**
 * Constrain a cursor-driven endpoint to the parsed buffer when one is active.
 * Returns { x, y, constrained: bool }.  If buffer empty or unparseable, the
 * unchanged cursor coords are returned.
 */
export function applyToEndpoint(startX, startY, cursorX, cursorY) {
  if (!_mode.active || _buffer().length === 0) {
    return { x: cursorX, y: cursorY, constrained: false };
  }
  const r = parseCoordBuffer(_buffer());
  const pxPerUnit = getMeasureScale().pixelsPerUnit || 1;

  switch (r.kind) {
    case 'length': {
      if (r.a == null || r.a <= 0) {
        return { x: cursorX, y: cursorY, constrained: false };
      }
      const dx = cursorX - startX;
      const dy = cursorY - startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const pixels = r.a * pxPerUnit;
      if (len === 0) return { x: startX + pixels, y: startY, constrained: true };
      const k = pixels / len;
      return { x: startX + dx * k, y: startY + dy * k, constrained: true };
    }
    case 'cartesian': {
      // Need both fields to constrain. If only dx typed, fall back to cursor Y.
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      const dxPx = r.a * pxPerUnit;
      const dyPx = r.b == null ? (cursorY - startY) : r.b * pxPerUnit;
      return { x: startX + dxPx, y: startY + dyPx, constrained: true };
    }
    case 'polar': {
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      // Angle: if typed, use it; otherwise use cursor angle from anchor.
      let theta;
      if (r.b == null) {
        theta = Math.atan2(cursorY - startY, cursorX - startX);
      } else {
        // App Y axis points down; convert mathematical angle (CCW from +X) so
        // positive angles rotate counter-clockwise on screen.
        theta = -r.b * Math.PI / 180;
      }
      const pixels = r.a * pxPerUnit;
      return {
        x: startX + Math.cos(theta) * pixels,
        y: startY + Math.sin(theta) * pixels,
        constrained: true,
      };
    }
    case 'absolute': {
      // =X,Y → raw app-coordinates (already in app-pixel space).
      if (r.a == null) return { x: cursorX, y: cursorY, constrained: false };
      const ax = r.a;
      const ay = r.b == null ? cursorY : r.b;
      return { x: ax, y: ay, constrained: true };
    }
    case 'invalid':
    case 'empty':
    default:
      return { x: cursorX, y: cursorY, constrained: false };
  }
}
