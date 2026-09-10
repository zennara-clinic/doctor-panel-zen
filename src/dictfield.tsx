import { useEffect, useId, useState, type ReactNode } from "react";
import { Mic, Plus, Square } from "lucide-react";
import { useDictation } from "./dictate";

/**
 * Speak-to-type for the consultation note.
 *
 * One microphone for the whole screen: tapping Dictate on a second field moves
 * it there. Spoken text is appended as sentences; the field stays editable.
 */
export function useMic(onError: (message: string) => void) {
  const dict = useDictation();
  const [target, setTarget] = useState<string | null>(null);

  useEffect(() => () => dict.stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string, append: (text: string) => void) => {
    if (dict.state !== "idle" && target === key) { dict.stop(); setTarget(null); return; }
    dict.stop();
    setTarget(key);
    void dict.start(append, (message) => { onError(message); setTarget(null); });
  };
  const stop = () => { dict.stop(); setTarget(null); };

  return { dict, target, toggle, stop };
}
export type MicControl = ReturnType<typeof useMic>;

/** "Comedones over cheeks" + "no scarring" → "Comedones over cheeks. No scarring." */
export function appendSentence(prev: string, text: string): string {
  const t = text.trim();
  if (!t) return prev;
  const sentence = t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
  const base = prev.trimEnd();
  if (!base) return sentence;
  return `${base}${/[.!?]$/.test(base) ? " " : ". "}${sentence}`;
}

export function DictField({ k, label, value, set, mic, rows = 3, placeholder, quick, disabled, hint, right, tour }: {
  /** Which field this is, so one microphone can move between fields. */
  k: string;
  label: ReactNode;
  value: string;
  /** Functional setter: dictation callbacks outlive the render that started them. */
  set: (fn: (prev: string) => string) => void;
  mic: MicControl;
  rows?: number;
  placeholder?: string;
  /** Tap-to-add phrases shown under the box. */
  quick?: string[];
  disabled?: boolean;
  hint?: ReactNode;
  right?: ReactNode;
  tour?: string;
}) {
  const id = useId();
  const on = mic.target === k && mic.dict.state !== "idle";
  const connecting = mic.target === k && mic.dict.state === "connecting";
  return (
    <div className="dz-field">
      <div className="dz-label">
        <label htmlFor={id}>{label}</label>
        <span className="flex items-center gap-2">
          {right}
          {!disabled && (
            <button type="button" data-tour={tour} className={`dz-mic ${on ? "is-on" : ""}`} aria-pressed={on}
              onClick={() => mic.toggle(k, (text) => set((prev) => appendSentence(prev, text)))}>
              {on ? <Square /> : <Mic />}
              {connecting ? "Connecting…" : on ? "Stop" : "Dictate"}
            </button>
          )}
        </span>
      </div>
      <textarea id={id} className="dz-textarea" rows={rows} value={value} placeholder={placeholder} disabled={disabled}
        onChange={(e) => { const v = e.target.value; set(() => v); }}
        style={{ minHeight: rows * 26 + 24 }} />
      {on && mic.dict.interim && <div className="dz-interim">{mic.dict.interim}</div>}
      {!disabled && quick && quick.length > 0 && (
        <div className="dz-chips">
          {quick.map((q) => (
            <button key={q} type="button" className="dz-chip dz-chip--sm" onClick={() => set((prev) => appendSentence(prev, q))}>
              <Plus />{q}
            </button>
          ))}
        </div>
      )}
      {hint && <div className="dz-hint">{hint}</div>}
    </div>
  );
}
