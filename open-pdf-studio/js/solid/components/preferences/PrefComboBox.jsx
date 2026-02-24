import { createSignal, onCleanup } from 'solid-js';

export default function PrefComboBox(props) {
  const [open, setOpen] = createSignal(false);
  let wrapperRef;
  let dropdownRef;

  const options = props.options || [100, 80, 60, 40, 20];
  const min = props.min ?? 0;
  const max = props.max ?? 100;
  const suffix = props.suffix || '%';

  function handleDocClick(e) {
    if (wrapperRef && !wrapperRef.contains(e.target)) {
      setOpen(false);
    }
  }

  document.addEventListener('mousedown', handleDocClick);
  onCleanup(() => document.removeEventListener('mousedown', handleDocClick));

  function handleInput(e) {
    let val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      props.setValue(val);
    }
  }

  function handleBlur(e) {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) val = props.fallback ?? 100;
    val = Math.max(min, Math.min(max, val));
    props.setValue(val);
    e.target.value = val;
  }

  function selectOption(val) {
    props.setValue(val);
    setOpen(false);
  }

  function toggleDropdown(e) {
    e.preventDefault();
    const willOpen = !open();
    setOpen(willOpen);
    if (willOpen && dropdownRef) {
      requestAnimationFrame(() => {
        const sel = dropdownRef.querySelector('.selected');
        if (sel) sel.scrollIntoView({ block: 'nearest' });
      });
    }
  }

  return (
    <div class="pref-combo" ref={wrapperRef}>
      <input
        type="text"
        class="pref-combo-input"
        value={props.value()}
        onInput={handleInput}
        onBlur={handleBlur}
      />
      <span class="pref-combo-suffix">{suffix}</span>
      <button type="button" class="pref-combo-arrow" onMouseDown={toggleDropdown}>
        <svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 1l4 4 4-4"/>
        </svg>
      </button>
      <div class="pref-combo-dropdown" classList={{ show: open() }} ref={dropdownRef}>
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
