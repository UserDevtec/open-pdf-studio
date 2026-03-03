import { createSignal, onCleanup } from 'solid-js';

export default function PrefComboBox(props) {
  const [open, setOpen] = createSignal(false);
  const [dropdownStyle, setDropdownStyle] = createSignal({});
  let wrapperRef;
  let dropdownRef;

  const options = props.options || [100, 80, 60, 40, 20];
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const suffix = props.suffix || '%';

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target) &&
        dropdownRef && !dropdownRef.contains(e.target)) {
      setOpen(false);
    }
  }

  document.addEventListener('mousedown', handleDocClick);
  onCleanup(() => document.removeEventListener('mousedown', handleDocClick));

  const isDisabled = () => typeof props.disabled === 'function' ? props.disabled() : !!props.disabled;

  function handleInput(e) {
    if (isDisabled()) return;
    // Strip non-numeric characters (allow digits, minus, dot)
    const cleaned = e.target.value.replace(/[^0-9.\-]/g, '');
    if (cleaned !== e.target.value) {
      e.target.value = cleaned;
    }
    let val = parseFloat(cleaned);
    if (!isNaN(val)) {
      const clamped = Math.max(min, Math.min(max, val));
      props.setValue(clamped);
      if (clamped !== val) {
        e.target.value = clamped;
      }
    }
  }

  function handleBlur(e) {
    if (isDisabled()) return;
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = props.fallback ?? 100;
    val = Math.max(min, Math.min(max, val));
    props.setValue(val);
    e.target.value = val;
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      let val = parseFloat(e.target.value);
      if (!isNaN(val)) {
        val = Math.max(min, Math.min(max, val));
        props.setValue(val);
        e.target.value = val;
      }
      setOpen(false);
      e.target.blur();
    }
  }

  function selectOption(val) {
    if (isDisabled()) return;
    props.setValue(val);
    setOpen(false);
  }

  function positionDropdown() {
    if (!wrapperRef) return;
    const rect = wrapperRef.getBoundingClientRect();
    const dropdownHeight = options.length * 24 + 4; // approx item height + padding
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUpward = spaceBelow < dropdownHeight && rect.top > spaceBelow;
    const style = {
      position: 'fixed',
      left: (rect.left - 1) + 'px',
      width: (rect.width + 2) + 'px',
    };
    if (openUpward) {
      style.bottom = (window.innerHeight - rect.top) + 'px';
      style.maxHeight = (rect.top - 4) + 'px';
    } else {
      style.top = rect.bottom + 'px';
      style.maxHeight = (spaceBelow - 4) + 'px';
    }
    setDropdownStyle(style);
  }

  function toggleDropdown(e) {
    e.preventDefault();
    if (isDisabled()) return;
    const willOpen = !open();
    if (willOpen) positionDropdown();
    setOpen(willOpen);
    if (willOpen && dropdownRef) {
      requestAnimationFrame(() => {
        const sel = dropdownRef.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  return (
    <div class="pref-combo" classList={{ disabled: isDisabled() }} ref={wrapperRef}>
      <input
        type="text"
        class="pref-combo-input"
        value={props.value() === 'mixed' ? 'Mixed' : props.value()}
        placeholder={props.value() === 'mixed' ? 'Mixed' : undefined}
        disabled={isDisabled()}
        onInput={handleInput}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onFocus={(e) => { if (props.value() === 'mixed') e.target.value = ''; }}
      />
      <span class="pref-combo-suffix">{props.value() === 'mixed' ? '' : suffix}</span>
      <button type="button" class="pref-combo-arrow" tabIndex={-1} disabled={isDisabled()} onMouseDown={toggleDropdown}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
      <div class="pref-combo-dropdown" classList={{ show: open() }}
        style={dropdownStyle()} ref={dropdownRef}>
        {options.map(opt => (
          <div
            class="pref-combo-option"
            classList={{ selected: props.value() === opt }}
            onMouseDown={() => selectOption(opt)}
          >
            {opt} {suffix}
          </div>
        ))}
      </div>
    </div>
  );
}
