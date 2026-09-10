import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight, Camera, Check, ChevronLeft, ChevronRight, Columns2, ImagePlus, Images, SplitSquareHorizontal, Trash2, X,
} from "lucide-react";
import type { Id, PatientPhoto } from "./lib/types";
import api from "./lib/api";
import { useApi } from "./lib/useApi";
import { useStore } from "./store";
import { Btn, Empty, Modal, Segmented, Sheet } from "./ui";
import { fmtDate, fmtDateLong, idOf, isoDay } from "./lib/format";

/*
 * Clinical photographs: take, tag, look, compare.
 *
 * The flow is the reference panel's — the camera first, the form after — with
 * one change forced by the iPad: Safari only opens the camera from a tap that
 * lands directly on a file input, never from a script. So "Take photo" IS the
 * input (a label wrapping it), and tagging happens once the photo is back.
 */

export type Phase = PatientPhoto["phase"];
export const PHASES: { key: Phase; label: string }[] = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
];
const phaseLabel = (p: Phase) => PHASES.find((x) => x.key === p)?.label ?? p;

export const BODY_AREAS = [
  "Full face", "Forehead", "Left cheek", "Right cheek", "Nose", "Chin", "Jawline", "Under-eye", "Neck",
  "Scalp — frontal", "Scalp — crown", "Back", "Chest", "Arms", "Hands", "Legs", "Underarms",
];

/** Downscale to 2000px on the long edge before upload; a tablet camera frame is 12MP. */
async function downscale(file: File, max = 2000): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 2_500_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** A tap target that opens the camera (or the photo library) directly. */
export function PhotoInput({ mode, onFiles, children, className, disabled }: {
  mode: "camera" | "gallery"; onFiles: (files: File[]) => void; children: ReactNode; className: string; disabled?: boolean;
}) {
  return (
    <label className={className} aria-disabled={disabled} style={disabled ? { opacity: 0.45, pointerEvents: "none" } : { cursor: "pointer" }}>
      {children}
      {/* Visually hidden, not display:none — iPad Safari will not open a hidden input from its label. */}
      <input type="file" accept="image/*" className="sr-only" multiple={mode === "gallery"}
        {...(mode === "camera" ? { capture: "environment" as const } : {})}
        onChange={(e) => { const list = Array.from(e.target.files ?? []); e.target.value = ""; if (list.length) onFiles(list); }} />
    </label>
  );
}

/* ------------------------------------------------------------------ tagging */

function TagSheet({ files, userId, bookingId, defaultPhase, onClose, onSaved, onMore }: {
  files: File[]; userId: Id; bookingId?: Id | null; defaultPhase: Phase;
  onClose: () => void; onSaved: (count: number, phase: Phase) => void; onMore: (files: File[]) => void;
}) {
  const { toast } = useStore();
  const [phase, setPhase] = useState<Phase>(defaultPhase);
  const [area, setArea] = useState("");
  const [other, setOther] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const previews = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const ready = await Promise.all(files.map((f) => downscale(f)));
      await api.patientPhotos.upload(ready, { userId, bookingId: bookingId ?? null, phase, bodyArea: area.trim(), note: note.trim() });
      toast(files.length === 1 ? "Photo saved" : `${files.length} photos saved`);
      setSaved(files.length);
      onSaved(files.length, phase);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (saved) {
    return (
      <Sheet open onClose={onClose} title="Saved to the guest’s record" sub={`${saved} ${phaseLabel(phase).toLowerCase()} photo${saved === 1 ? "" : "s"}${area ? ` · ${area}` : ""}`}
        footer={<><span className="flex-1" /><Btn kind="secondary" onClick={onClose}>Done</Btn></>}>
        <div className="dz-capture">
          <PhotoInput mode="camera" className="dz-capture__btn" onFiles={onMore}>
            <Camera /><b>Take another</b><span>Same stage and area</span>
          </PhotoInput>
          <PhotoInput mode="gallery" className="dz-capture__btn" onFiles={onMore}>
            <ImagePlus /><b>Add from gallery</b><span>Pick existing images</span>
          </PhotoInput>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} eyebrow="Clinical photo" title="Tag before saving"
      sub="Stage and area make the before-and-after comparison work later."
      footer={<>
        {err && <span className="dz-error mr-auto">{err}</span>}
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Discard</Btn>
        <Btn size="lg" disabled={busy} onClick={save}><Check />{busy ? "Saving…" : files.length > 1 ? `Save ${files.length} photos` : "Save photo"}</Btn>
      </>}>
      <div className="dz-tag-layout">
        <div className="dz-tag-preview">
          <img src={previews[0]} alt="Photo to save" />
          {files.length > 1 && <span className="dz-tag-preview__count dz-pill dz-pill--dark">+{files.length - 1} more</span>}
        </div>
        <div className="dz-stack">
          <div className="dz-field">
            <span className="dz-label">Stage</span>
            <div className="dz-chips">
              {PHASES.map((p) => (
                <button key={p.key} type="button" className={`dz-chip ${phase === p.key ? "is-on" : ""}`} onClick={() => setPhase(p.key)}>
                  {phase === p.key && <Check />}{p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="dz-field">
            <span className="dz-label">Area</span>
            <div className="dz-chips">
              {BODY_AREAS.map((a) => (
                <button key={a} type="button" className={`dz-chip dz-chip--sm ${area === a && !other ? "is-on" : ""}`}
                  onClick={() => { setOther(false); setArea(area === a ? "" : a); }}>{a}</button>
              ))}
              <button type="button" className={`dz-chip dz-chip--sm dz-chip--dash ${other ? "is-on" : ""}`} onClick={() => { setOther(true); setArea(""); }}>Other…</button>
            </div>
            {other && <input autoFocus className="dz-input" value={area} onChange={(e) => setArea(e.target.value)} placeholder="Where on the body" />}
          </div>
          <div className="dz-field">
            <label className="dz-label" htmlFor="photo-note">Note <span className="font-medium text-ink3">optional</span></label>
            <input id="photo-note" className="dz-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Session 2, before laser toning" />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------- grid/tile */

export function PhotoGrid({ photos, onOpen, add }: { photos: PatientPhoto[]; onOpen: (p: PatientPhoto) => void; add?: ReactNode }) {
  return (
    <div className="dz-photos">
      {add}
      {photos.map((p) => (
        <button key={p._id} type="button" className="dz-photo" onClick={() => onOpen(p)}>
          <img src={p.url} alt={`${phaseLabel(p.phase)} ${p.bodyArea ?? ""}`} loading="lazy" />
          <span className="dz-photo__tag"><span className={`dz-pill dz-pill--sm ${p.phase === "after" ? "dz-pill--gold" : "dz-pill--line"}`}>{phaseLabel(p.phase)}</span></span>
          <span className="dz-photo__meta">{p.bodyArea || "Area not set"}<span>{fmtDate(p.takenAt)}</span></span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ viewer */

export function PhotoViewer({ photos, index, onIndex, onClose, onCompare, onDeleted, canDelete }: {
  photos: PatientPhoto[]; index: number; onIndex: (i: number) => void; onClose: () => void;
  onCompare?: (p: PatientPhoto) => void; onDeleted?: () => void; canDelete?: boolean;
}) {
  const { toast } = useStore();
  const [confirm, setConfirm] = useState(false);
  const p = photos[index];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && index > 0) onIndex(index - 1);
      if (e.key === "ArrowRight" && index < photos.length - 1) onIndex(index + 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [index, photos.length, onClose, onIndex]);
  useEffect(() => setConfirm(false), [index]);

  // Swipe between photos with a finger.
  const startX = useRef<number | null>(null);
  if (!p) return null;
  return (
    <div className="dz-viewer" role="dialog" aria-label="Photo">
      <div className="dz-viewer__bar">
        <button type="button" className="dz-iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        <div className="min-w-0 flex-1">
          <b>{phaseLabel(p.phase)}{p.bodyArea ? ` · ${p.bodyArea}` : ""}</b>
          <span>{fmtDateLong(p.takenAt)}{p.takenByName ? ` · ${p.takenByName}` : ""}{p.note ? ` · ${p.note}` : ""}</span>
        </div>
        <span className="text-[13px] text-photo-ink">{index + 1} / {photos.length}</span>
        {onCompare && photos.length > 1 && (
          <button type="button" className="dz-btn dz-btn--gold dz-btn--sm" onClick={() => onCompare(p)}><Columns2 /> Compare</button>
        )}
        {canDelete && (confirm ? (
          <button type="button" className="dz-btn dz-btn--danger dz-btn--sm" onClick={async () => {
            try { await api.patientPhotos.remove(p._id); toast("Photo deleted"); onDeleted?.(); }
            catch (e) { toast((e as Error).message); }
          }}><Trash2 /> Tap again to delete</button>
        ) : (
          <button type="button" className="dz-iconbtn" onClick={() => setConfirm(true)} aria-label="Delete photo"><Trash2 /></button>
        ))}
      </div>
      <div className="dz-viewer__stage"
        onPointerDown={(e) => { startX.current = e.clientX; }}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (dx > 60 && index > 0) onIndex(index - 1);
          if (dx < -60 && index < photos.length - 1) onIndex(index + 1);
        }}>
        <img src={p.url} alt="" draggable={false} />
        {index > 0 && <button type="button" className="dz-iconbtn dz-viewer__prev" onClick={() => onIndex(index - 1)} aria-label="Previous photo"><ChevronLeft /></button>}
        {index < photos.length - 1 && <button type="button" className="dz-iconbtn dz-viewer__next" onClick={() => onIndex(index + 1)} aria-label="Next photo"><ChevronRight /></button>}
      </div>
      <div className="dz-viewer__bar" style={{ justifyContent: "center" }}>
        <div className="dz-strip" style={{ maxWidth: "100%" }}>
          {photos.map((x, i) => (
            <button key={x._id} type="button" className={i === index ? "is-on" : ""} onClick={() => onIndex(i)} aria-label={`Photo ${i + 1}`}>
              <img src={x.url} alt="" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- compare */

const photoLabel = (p: PatientPhoto) => `${phaseLabel(p.phase)}${p.bodyArea ? ` · ${p.bodyArea}` : ""} · ${fmtDate(p.takenAt)}`;

function Picker({ title, photos, value, onChange }: { title: string; photos: PatientPhoto[]; value?: Id; onChange: (id: Id) => void }) {
  return (
    <div className="dz-field">
      <span className="dz-label">{title}</span>
      <div className="dz-strip">
        {photos.map((p) => (
          <button key={p._id} type="button" className={p._id === value ? "is-on" : ""} onClick={() => onChange(p._id)} title={photoLabel(p)}>
            <img src={p.url} alt={photoLabel(p)} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function PhotoCompare({ photos, open, onClose, right: rightInit }: {
  photos: PatientPhoto[]; open: boolean; onClose: () => void; right?: Id;
}) {
  /** Oldest first: the earliest photograph is almost always the "before". */
  const ordered = useMemo(
    () => [...photos].sort((a, b) => new Date(a.takenAt).getTime() - new Date(b.takenAt).getTime()),
    [photos],
  );
  const firstBefore = ordered.find((p) => p.phase === "before") ?? ordered[0];
  const lastLater = [...ordered].reverse().find((p) => p.phase !== "before") ?? ordered[ordered.length - 1];
  const [leftId, setLeftId] = useState<Id | undefined>(firstBefore?._id);
  const [rightId, setRightId] = useState<Id | undefined>(rightInit ?? lastLater?._id);
  const [mode, setMode] = useState<"slider" | "side">("slider");
  const [x, setX] = useState(50);
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setLeftId(firstBefore?._id);
    setRightId(rightInit ?? lastLater?._id);
    setX(50);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = ordered.find((p) => p._id === leftId) ?? firstBefore;
  const right = ordered.find((p) => p._id === rightId) ?? lastLater;
  const move = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    setX(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <Modal open={open} onClose={onClose} xl title="Compare photos" sub="Drag across the photo to reveal the change.">
      {ordered.length < 2 ? (
        <Empty icon={<Images />} title="Two photos are needed" hint="Take a before photo now and an after photo at the next visit." />
      ) : (
        <div className="dz-stack">
          <div className="dz-row">
            <Segmented value={mode} onChange={setMode} options={[
              { key: "slider", label: "Slider", icon: <SplitSquareHorizontal /> },
              { key: "side", label: "Side by side", icon: <Columns2 /> },
            ]} />
            {left && right && left._id === right._id && <span className="dz-pill dz-pill--warn">Same photo on both sides</span>}
          </div>

          {left && right && (mode === "slider" ? (
            <div ref={box} className="dz-compare" style={{ ["--x" as string]: `${x}%` }}
              onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); move(e.clientX); }}
              onPointerMove={(e) => { if (e.buttons === 1 || e.pointerType === "touch") move(e.clientX); }}>
              <img src={left.url} alt={photoLabel(left)} />
              <img src={right.url} alt={photoLabel(right)} className="dz-compare__after" />
              <div className="dz-compare__line"><span className="dz-compare__knob"><ArrowLeftRight /></span></div>
              <span className="dz-compare__label" style={{ left: 12 }}>{photoLabel(left)}</span>
              <span className="dz-compare__label" style={{ right: 12 }}>{photoLabel(right)}</span>
            </div>
          ) : (
            <div className="dz-grid-even">
              {[left, right].map((p, i) => (
                <figure key={`${p._id}-${i}`} className="m-0">
                  <div className="dz-compare" style={{ cursor: "default", maxWidth: "none" }}><img src={p.url} alt={photoLabel(p)} /></div>
                  <figcaption className="mt-2 text-center text-[13.5px] font-bold text-ink2">{photoLabel(p)}</figcaption>
                </figure>
              ))}
            </div>
          ))}

          <div className="dz-grid-even">
            <Picker title="Left — usually the before" photos={ordered} value={left?._id} onChange={setLeftId} />
            <Picker title="Right — the later photo" photos={ordered} value={right?._id} onChange={setRightId} />
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ studio */

/**
 * Everything photographic about one guest, on one screen: capture, this
 * visit's set, the earlier record, the viewer and the comparison.
 */
export function PhotoStudio({ userId, bookingId, locked, compact, onChanged }: {
  userId: Id; bookingId?: Id | null; locked?: boolean; compact?: boolean;
  /** Told after a photo is added or deleted, so a counter elsewhere can refresh. */
  onChanged?: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const q = useApi(
    () => (userId ? api.patientPhotos.list({ userId, limit: 300 }).then((r) => r.data ?? []) : Promise.resolve([] as PatientPhoto[])),
    [userId, nonce],
  );
  const [pending, setPending] = useState<File[] | null>(null);
  const [filter, setFilter] = useState<"all" | Phase>("all");
  const [viewer, setViewer] = useState<{ list: PatientPhoto[]; index: number } | null>(null);
  const [compare, setCompare] = useState<{ right?: Id } | null>(null);
  const [lastPhase, setLastPhase] = useState<Phase>("before");

  const all = useMemo(
    () => [...(q.data ?? [])].sort((a, b) => new Date(b.takenAt).getTime() - new Date(a.takenAt).getTime()),
    [q.data],
  );
  const shown = filter === "all" ? all : all.filter((p) => p.phase === filter);
  const thisVisit = bookingId ? shown.filter((p) => idOf(p.bookingId) === bookingId) : [];
  const earlier = bookingId ? shown.filter((p) => idOf(p.bookingId) !== bookingId) : shown;

  // Earlier photos grouped by the clinic day they were taken.
  const groups = useMemo(() => {
    const map = new Map<string, PatientPhoto[]>();
    for (const p of earlier) {
      const k = isoDay(new Date(p.takenAt));
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return [...map.entries()];
  }, [earlier]);

  const reload = () => { setNonce((n) => n + 1); onChanged?.(); };
  const canAdd = !locked && !!userId;
  const addTile = canAdd ? (
    <PhotoInput mode="camera" className="dz-photo dz-photo--add" onFiles={setPending}>
      <Camera />Take photo
    </PhotoInput>
  ) : undefined;

  return (
    <div className="dz-stack">
      <div className="dz-row">
        <Segmented value={filter} onChange={setFilter} options={[
          { key: "all", label: "All", count: all.length },
          ...PHASES.map((p) => ({ key: p.key, label: p.label, count: all.filter((x) => x.phase === p.key).length })),
        ]} />
        <span className="dz-spacer" />
        {all.length >= 2 && <Btn kind="secondary" onClick={() => setCompare({})}><Columns2 /> Compare</Btn>}
        {canAdd && (
          <>
            <PhotoInput mode="gallery" className="dz-btn dz-btn--secondary" onFiles={setPending}><ImagePlus /> From gallery</PhotoInput>
            <PhotoInput mode="camera" className="dz-btn dz-btn--primary" onFiles={setPending}><Camera /> Take photo</PhotoInput>
          </>
        )}
      </div>

      {q.initial && !q.data ? (
        <div className="dz-photos">{[0, 1, 2, 3].map((i) => <div key={i} className="dz-skel" style={{ height: "auto", aspectRatio: "3 / 4" }} />)}</div>
      ) : all.length === 0 ? (
        canAdd ? (
          <div className="dz-capture">
            <PhotoInput mode="camera" className="dz-capture__btn" onFiles={setPending}><Camera /><b>Take photo</b><span>Opens the rear camera</span></PhotoInput>
            <PhotoInput mode="gallery" className="dz-capture__btn" onFiles={setPending}><ImagePlus /><b>From gallery</b><span>Pick existing images</span></PhotoInput>
          </div>
        ) : <Empty icon={<Images />} title="No photos on this guest yet" />
      ) : (
        <>
          {bookingId && (
            <div>
              <div className="dz-section" style={{ marginTop: 4 }}><h2>This visit</h2><span>{thisVisit.length}</span></div>
              {thisVisit.length === 0 && !canAdd
                ? <div className="dz-hint">No photos were taken at this visit.</div>
                : <PhotoGrid photos={thisVisit} add={addTile} onOpen={(p) => setViewer({ list: thisVisit, index: thisVisit.indexOf(p) })} />}
            </div>
          )}
          {groups.length > 0 && (
            <div>
              {bookingId && <div className="dz-section"><h2>Earlier photos</h2><span>{earlier.length}</span></div>}
              <div className="dz-stack" style={{ gap: 20 }}>
                {groups.slice(0, compact ? 3 : undefined).map(([day, list], gi) => (
                  <div key={day}>
                    <div className="mb-2 text-[13.5px] font-extrabold text-ink2">{fmtDateLong(day)}</div>
                    <PhotoGrid photos={list} add={!bookingId && gi === 0 ? addTile : undefined}
                      onOpen={(p) => setViewer({ list: earlier, index: earlier.indexOf(p) })} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {shown.length === 0 && <Empty title={`No ${filter} photos`} hint="Change the filter above to see the rest." />}
        </>
      )}

      {pending && (
        <TagSheet key={pending.map((f) => f.name + f.size).join("|")} files={pending} userId={userId} bookingId={bookingId}
          defaultPhase={lastPhase}
          onClose={() => setPending(null)}
          onSaved={(_, phase) => { setLastPhase(phase); reload(); }}
          onMore={(files) => setPending(files)} />
      )}
      {viewer && (
        <PhotoViewer photos={viewer.list} index={Math.max(0, viewer.index)} onIndex={(i) => setViewer({ ...viewer, index: i })}
          onClose={() => setViewer(null)} canDelete={!locked}
          onDeleted={() => { setViewer(null); reload(); }}
          onCompare={(p) => { setViewer(null); setCompare({ right: p._id }); }} />
      )}
      <PhotoCompare photos={all} open={!!compare} right={compare?.right} onClose={() => setCompare(null)} />
    </div>
  );
}
