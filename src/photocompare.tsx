import { useMemo, useRef, useState } from "react";
import { ArrowLeftRight, Columns2, SplitSquareHorizontal } from "lucide-react";
import type { PatientPhoto } from "./lib/types";
import { Btn, Empty, Modal, Sel } from "./ui";
import { fmtDate } from "./lib/format";

/**
 * Before and after, side by side.
 *
 * The panel could store a guest's photographs and show them as a grid, which
 * answers "do we have pictures" but not the only question anyone actually asks
 * of them: has this got better. Comparing meant opening two tabs and looking
 * from one to the other.
 *
 * Two modes, because they answer different questions. Side-by-side is for a
 * conversation with the guest — both frames whole, dates under each. The wipe
 * is for the doctor: one image over the other with a draggable seam, which is
 * the only way to see a small change in pigment or density when the framing
 * is nearly identical.
 *
 * Nothing is written here. It reads the photographs already on the record.
 */

const label = (p: PatientPhoto) =>
  `${fmtDate(p.takenAt)} · ${p.phase}${p.bodyArea ? ` · ${p.bodyArea}` : ""}`;

function Wipe({ left, right }: { left: PatientPhoto; right: PatientPhoto }) {
  const [pct, setPct] = useState(50);
  const box = useRef<HTMLDivElement | null>(null);

  /*
   * Pointer events rather than mouse events: the consult room runs on a
   * tablet, and a mouse-only seam cannot be dragged with a finger.
   */
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setPct(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <div>
      <div
        ref={box}
        className="relative select-none overflow-hidden rounded-xl border border-border bg-ivory"
        style={{ touchAction: "none" }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); move(e.clientX); }}
        onPointerMove={(e) => { if (e.buttons === 1) move(e.clientX); }}
      >
        <img src={right.url} alt={label(right)} className="block max-h-[62vh] w-full object-contain" />
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
          {/*
           * The clipped layer is sized to the whole box, not to its own
           * clipped width, or the left image squashes as the seam moves.
           */}
          <img src={left.url} alt={label(left)}
            className="absolute inset-0 block h-full w-full object-contain"
            style={{ width: box.current?.clientWidth ? `${box.current.clientWidth}px` : "100%" }} />
        </div>
        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]" style={{ left: `${pct}%` }}>
          <span className="absolute top-1/2 -ml-3.5 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-white shadow">
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
          </span>
        </div>
        <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">{label(left)}</span>
        <span className="pointer-events-none absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">{label(right)}</span>
      </div>
      <input
        type="range" min={0} max={100} value={pct} onChange={(e) => setPct(Number(e.target.value))}
        aria-label="Comparison position"
        className="mt-2 w-full accent-[var(--color-primary)]"
      />
    </div>
  );
}

export default function PhotoCompare({ photos, open, onClose }: {
  photos: PatientPhoto[]; open: boolean; onClose: () => void;
}) {
  /** Oldest first: the earliest photograph is almost always the "before". */
  const ordered = useMemo(
    () => [...photos].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
    [photos],
  );
  const [leftId, setLeftId] = useState<string>(() => ordered[0]?._id ?? "");
  const [rightId, setRightId] = useState<string>(() => ordered[ordered.length - 1]?._id ?? "");
  const [mode, setMode] = useState<"side" | "wipe">("side");

  const left = ordered.find((p) => p._id === leftId) ?? ordered[0];
  const right = ordered.find((p) => p._id === rightId) ?? ordered[ordered.length - 1];
  const options = ordered.map((p) => label(p));
  const byLabel = (l: string) => ordered.find((p) => label(p) === l)?._id ?? "";

  return (
    <Modal open={open} onClose={onClose} title="Compare photographs" xl>
      {ordered.length < 2 ? (
        <Empty
          title="Not enough photographs yet"
          hint="Two or more on this guest's record — a before and a later one — and they can be compared here."
        />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <Sel label="Left" value={left ? label(left) : ""} onChange={(v) => setLeftId(byLabel(v))} options={options} />
            <Sel label="Right" value={right ? label(right) : ""} onChange={(v) => setRightId(byLabel(v))} options={options} />
            <span className="flex-1" />
            <Btn kind={mode === "side" ? "primary" : "ghost"} className="!py-1.5 !text-[11.5px]" onClick={() => setMode("side")}>
              <span className="flex items-center gap-1.5"><Columns2 className="h-3.5 w-3.5" /> Side by side</span>
            </Btn>
            <Btn kind={mode === "wipe" ? "primary" : "ghost"} className="!py-1.5 !text-[11.5px]" onClick={() => setMode("wipe")}>
              <span className="flex items-center gap-1.5"><SplitSquareHorizontal className="h-3.5 w-3.5" /> Wipe</span>
            </Btn>
          </div>

          {left && right && (mode === "side" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {[left, right].map((p, i) => (
                <figure key={`${p._id}-${i}`} className="m-0">
                  <img src={p.url} alt={label(p)} className="block max-h-[56vh] w-full rounded-xl border border-border bg-ivory object-contain" />
                  <figcaption className="mt-1 text-center text-[11.5px] text-ink3">{label(p)}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <Wipe left={left} right={right} />
          ))}

          {left && right && left._id === right._id && (
            <div className="mt-2 text-center text-[11.5px] text-ink3">Same photograph on both sides — pick a different date to compare.</div>
          )}
        </>
      )}
      <div className="mt-4 flex justify-end"><Btn kind="ghost" onClick={onClose}>Close</Btn></div>
    </Modal>
  );
}
