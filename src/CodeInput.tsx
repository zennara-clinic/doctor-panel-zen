import { useRef, useState, type KeyboardEvent } from "react";

/**
 * A one-time code typed one digit per box, the way a phone does it.
 *
 * One real input — invisible, stretched over the boxes — so the numeric
 * keyboard, one-time-code autofill, paste of the whole code and backspace all
 * keep working; the boxes only render that input's value. The active box is
 * the one the next keystroke fills. Solid colours, dz-* tokens, tablet-sized.
 */
export function CodeInput({ length = 6, value, onChange, onEnter, disabled, autoFocus, ariaLabel }: {
  length?: number;
  value: string;
  onChange: (code: string) => void;
  onEnter?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = Array.from({ length }, (_, i) => value[i] ?? "");
  const active = Math.min(value.length, length - 1);
  const keepCaretAtEnd = () => {
    const el = ref.current;
    if (el) requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onEnter && value.length === length) { e.preventDefault(); onEnter(); }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") e.preventDefault();
  };
  return (
    <div className="dz-code">
      <div className="dz-code__boxes" aria-hidden="true">
        {digits.map((d, i) => {
          const isActive = focused && !disabled && i === active && value.length < length;
          return (
            <div key={i} className={`dz-code__box${isActive ? " is-active" : ""}${d ? " is-filled" : ""}`}>
              {d}{isActive && <span className="dz-code__caret" />}
            </div>
          );
        })}
      </div>
      <input ref={ref} value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        onKeyDown={onKeyDown} onFocus={() => { setFocused(true); keepCaretAtEnd(); }} onBlur={() => setFocused(false)} onClick={keepCaretAtEnd}
        inputMode="numeric" pattern="\d*" autoComplete="one-time-code" maxLength={length} disabled={disabled} autoFocus={autoFocus}
        aria-label={ariaLabel ?? `${length}-digit code`} className="dz-code__input" />
    </div>
  );
}
