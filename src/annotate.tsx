import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight, Check, Circle, Maximize, MousePointer2, Pencil, Square, Trash2, Undo2, X, ZoomIn, ZoomOut,
} from "lucide-react";
import type { PatientPhoto, PhotoMark } from "./lib/types";
import api from "./lib/api";
import { useStore } from "./store";

/*
 * Marks on clinical photographs.
 *
 * A dermatologist circles what changed — or boxes it, points at it, or draws
 * freehand — and may add a note to any mark. The note is optional: a circle on
 * its own is often the whole message.
 *
 * Marks are shapes stored beside the photo (PatientPhoto.annotations), never
 * burned into it, so the original stays clean, each mark keeps its own note,
 * and the before-and-after comparison can show them or hide them. Geometry is
 * in fractions of the image, so a mark lands on the same spot at any size.
 */

export type MarkKind = PhotoMark["kind"];
type Pt = [number, number];
type Size = { w: number; h: number };
type Rect = { left: number; top: number; width: number; height: number };

export const MARK_COLORS = [
  { value: "#D92D20", label: "Red" },
  { value: "#FDB022", label: "Amber" },
  { value: "#FFFFFF", label: "White" },
  { value: "#2E90FA", label: "Blue" },
  { value: "#12B76A", label: "Green" },
];
const WIDTHS = [2, 4, 7];
const KIND_LABEL: Record<MarkKind, string> = { ellipse: "Circle", rect: "Box", arrow: "Arrow", pen: "Drawing" };

export const markCount = (p?: PatientPhoto | null) => p?.annotations?.length ?? 0;

/** Where an image sits inside a box under object-fit contain (or cover). */
export function fitRect(box: Size, img: Size, mode: "contain" | "cover" = "contain"): Rect | null {
  if (!box.w || !box.h || !img.w || !img.h) return null;
  const s = mode === "contain" ? Math.min(box.w / img.w, box.h / img.h) : Math.max(box.w / img.w, box.h / img.h);
  const width = img.w * s;
  const height = img.h * s;
  return { left: (box.w - width) / 2, top: (box.h - height) / 2, width, height };
}

function useNaturalSize(url: string) {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => { if (live) setSize({ w: img.naturalWidth, h: img.naturalHeight }); };
    img.src = url;
    return () => { live = false; };
  }, [url]);
  return size;
}

/** Layout size of an element — unaffected by CSS transforms, which is what zoom uses. */
function useBoxSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Where a mark's number sits: just outside the shape, or at an arrow's tail. */
function anchorOf(m: PhotoMark): Pt {
  if (m.kind === "ellipse") {
    const rx = (m.w ?? 0) / 2, ry = (m.h ?? 0) / 2;
    return [(m.x ?? 0) + rx + rx * 0.7071, (m.y ?? 0) + ry - ry * 0.7071];
  }
  if (m.kind === "rect") return [(m.x ?? 0) + (m.w ?? 0), m.y ?? 0];
  return m.points?.[0] ?? [0, 0];
}

/* ------------------------------------------------------------------ drawing */

/**
 * One mark as SVG. The viewBox is 1000 wide and as tall as the photo's aspect,
 * so geometry scales evenly; strokes stay a fixed screen width.
 */
function Shape({ m, vw, vh, pxToVb, selected }: { m: PhotoMark; vw: number; vh: number; pxToVb: number; selected?: boolean }) {
  const stroke = {
    fill: "none", strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke",
  } as const;
  const shape = (props: { stroke: string; strokeWidth: number; strokeDasharray?: string }) => {
    const p = { ...stroke, ...props };
    if (m.kind === "ellipse") {
      return <ellipse {...p} cx={((m.x ?? 0) + (m.w ?? 0) / 2) * vw} cy={((m.y ?? 0) + (m.h ?? 0) / 2) * vh} rx={((m.w ?? 0) / 2) * vw} ry={((m.h ?? 0) / 2) * vh} />;
    }
    if (m.kind === "rect") {
      return <rect {...p} x={(m.x ?? 0) * vw} y={(m.y ?? 0) * vh} width={(m.w ?? 0) * vw} height={(m.h ?? 0) * vh} rx={6 * pxToVb} />;
    }
    const pts = (m.points ?? []).map(([x, y]) => [x * vw, y * vh] as Pt);
    if (m.kind === "arrow" && pts.length >= 2) {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const head = Math.max(14, m.width * 3.5) * pxToVb;
      const h1: Pt = [b[0] - head * Math.cos(ang - Math.PI / 6), b[1] - head * Math.sin(ang - Math.PI / 6)];
      const h2: Pt = [b[0] - head * Math.cos(ang + Math.PI / 6), b[1] - head * Math.sin(ang + Math.PI / 6)];
      return <path {...p} d={`M${a[0]},${a[1]} L${b[0]},${b[1]} M${h1[0]},${h1[1]} L${b[0]},${b[1]} L${h2[0]},${h2[1]}`} />;
    }
    return <polyline {...p} points={pts.map((q) => q.join(",")).join(" ")} />;
  };
  return (
    <g>
      {/* A dark keyline under every mark keeps a white or amber mark legible on pale skin. */}
      {shape({ stroke: "rgba(0,0,0,0.45)", strokeWidth: m.width + 3 })}
      {shape({ stroke: m.color, strokeWidth: m.width })}
      {selected && shape({ stroke: "#FFFFFF", strokeWidth: 1.5, strokeDasharray: "6 5" })}
    </g>
  );
}

/**
 * Marks drawn over a photo that fills its parent with object-fit contain (or
 * cover). The parent must be positioned. Numbers are buttons when `onPick` is
 * given, so a tap shows that mark's note.
 */
export function MarkLayer({ photo, marks, mode = "contain", active, onPick, numbers = true }: {
  photo: PatientPhoto; marks?: PhotoMark[]; mode?: "contain" | "cover";
  active?: number | null; onPick?: (i: number) => void; numbers?: boolean;
}) {
  const list = marks ?? photo.annotations ?? [];
  const natural = useNaturalSize(photo.url);
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const rect = natural ? fitRect(box, natural, mode) : null;
  return (
    <div ref={ref} className="dz-marks" aria-hidden={!onPick}>
      {rect && natural && list.length > 0 && (
        <MarkSvg rect={rect} natural={natural} marks={list} active={active} onPick={onPick} numbers={numbers} />
      )}
    </div>
  );
}

function MarkSvg({ rect, natural, marks, active, onPick, numbers, draft, children }: {
  rect: Rect; natural: Size; marks: PhotoMark[]; active?: number | null; onPick?: (i: number) => void;
  numbers?: boolean; draft?: PhotoMark | null; children?: ReactNode;
}) {
  const vw = 1000;
  const vh = (1000 * natural.h) / natural.w;
  const pxToVb = vw / rect.width;
  return (
    <div className="dz-marks__fit" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
      <svg viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="none" width="100%" height="100%">
        {marks.map((m, i) => <Shape key={m._id ?? `m${i}`} m={m} vw={vw} vh={vh} pxToVb={pxToVb} selected={active === i} />)}
        {draft && <Shape m={draft} vw={vw} vh={vh} pxToVb={pxToVb} />}
      </svg>
      {numbers && marks.map((m, i) => {
        const [ax, ay] = anchorOf(m);
        const style = { left: `${Math.min(97, Math.max(3, ax * 100))}%`, top: `${Math.min(97, Math.max(3, ay * 100))}%` };
        const cls = `dz-marks__pin ${active === i ? "is-on" : ""} ${m.note ? "has-note" : ""}`;
        return onPick
          ? <button key={m._id ?? `p${i}`} type="button" className={cls} style={style} onClick={(e) => { e.stopPropagation(); onPick(i); }}
              onPointerDown={(e) => e.stopPropagation()} aria-label={`Mark ${i + 1}${m.note ? `: ${m.note}` : ""}`}>{i + 1}</button>
          : <span key={m._id ?? `p${i}`} className={cls} style={style}>{i + 1}</span>;
      })}
      {children}
    </div>
  );
}

/** The notes under a marked photo, numbered to match the pins. Marks without a note are listed by shape. */
export function MarkNotes({ marks, active, onPick, dark }: { marks: PhotoMark[]; active?: number | null; onPick?: (i: number) => void; dark?: boolean }) {
  if (!marks.length) return null;
  return (
    <ol className={`dz-marknotes ${dark ? "dz-marknotes--dark" : ""}`}>
      {marks.map((m, i) => (
        <li key={m._id ?? i}>
          <button type="button" className={active === i ? "is-on" : ""} onClick={() => onPick?.(i)} disabled={!onPick}>
            <span className="dz-marknotes__n" style={{ borderColor: m.color }}>{i + 1}</span>
            <span className={m.note ? "" : "dz-marknotes__empty"}>{m.note || KIND_LABEL[m.kind]}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ editor */

type Tool = MarkKind | "select";
type View = { s: number; x: number; y: number };
type Gesture =
  | { kind: "pinch"; dist: number; mid: Pt; view: View }
  | { kind: "pan"; start: Pt; view: View }
  | { kind: "draw" }
  | { kind: "move"; index: number; start: Pt; orig: PhotoMark };

const TOOLS: { key: Tool; label: string; icon: ReactNode }[] = [
  { key: "ellipse", label: "Circle", icon: <Circle /> },
  { key: "rect", label: "Box", icon: <Square /> },
  { key: "arrow", label: "Arrow", icon: <ArrowUpRight /> },
  { key: "pen", label: "Draw", icon: <Pencil /> },
  { key: "select", label: "Select", icon: <MousePointer2 /> },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  const t = len ? clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len, 0, 1) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

/** Which mark is under a point (in pixels on the fitted photo), topmost first. */
function hitTest(marks: PhotoMark[], p: Pt, W: number, H: number, tol = 16) {
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i];
    if (m.kind === "ellipse" || m.kind === "rect") {
      const x = (m.x ?? 0) * W, y = (m.y ?? 0) * H, w = (m.w ?? 0) * W, h = (m.h ?? 0) * H;
      if (m.kind === "rect") {
        if (p[0] >= x - tol && p[0] <= x + w + tol && p[1] >= y - tol && p[1] <= y + h + tol) return i;
      } else {
        const rx = w / 2 + tol, ry = h / 2 + tol;
        const d = ((p[0] - (x + w / 2)) / rx) ** 2 + ((p[1] - (y + h / 2)) / ry) ** 2;
        if (d <= 1) return i;
      }
    } else {
      const pts = (m.points ?? []).map(([a, b]) => [a * W, b * H] as Pt);
      const segs = m.kind === "arrow" ? [[pts[0], pts[pts.length - 1]]] : pts.slice(1).map((q, k) => [pts[k], q]);
      if (segs.some(([a, b]) => a && b && segDist(p, a, b) <= tol + m.width)) return i;
    }
  }
  return -1;
}

function moved(m: PhotoMark, dx: number, dy: number): PhotoMark {
  if (m.kind === "ellipse" || m.kind === "rect") {
    return { ...m, x: clamp((m.x ?? 0) + dx, 0, 1 - (m.w ?? 0)), y: clamp((m.y ?? 0) + dy, 0, 1 - (m.h ?? 0)) };
  }
  const pts = m.points ?? [];
  const minX = Math.min(...pts.map((q) => q[0])), maxX = Math.max(...pts.map((q) => q[0]));
  const minY = Math.min(...pts.map((q) => q[1])), maxY = Math.max(...pts.map((q) => q[1]));
  const ddx = clamp(dx, -minX, 1 - maxX), ddy = clamp(dy, -minY, 1 - maxY);
  return { ...m, points: pts.map(([x, y]) => [x + ddx, y + ddy] as Pt) };
}

/**
 * Full-screen mark-up for a tablet. Pick a shape and drag on the photo; the
 * new mark is selected so a note can be typed straight away — or not. Two
 * fingers pinch and pan at any time; Select moves or deletes a mark.
 */
export function PhotoMarker({ photo, onClose, onSaved }: {
  photo: PatientPhoto; onClose: () => void; onSaved?: (p: PatientPhoto) => void;
}) {
  const { toast } = useStore();
  const initial = useMemo(() => (photo.annotations ?? []).map((m) => ({ ...m })), [photo]);
  const [marks, setMarks] = useState<PhotoMark[]>(initial);
  const [history, setHistory] = useState<PhotoMark[][]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [tool, setTool] = useState<Tool>("ellipse");
  const [color, setColor] = useState(MARK_COLORS[0].value);
  const [width, setWidth] = useState(WIDTHS[1]);
  const [draft, setDraft] = useState<PhotoMark | null>(null);
  const [view, setView] = useState<View>({ s: 1, x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  const natural = useNaturalSize(photo.url);
  const [canvasRef, box] = useBoxSize<HTMLDivElement>();
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fitRef = useRef<HTMLDivElement | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const rect = natural ? fitRect(box, natural) : null;

  const pointers = useRef(new Map<number, Pt>());
  const gesture = useRef<Gesture | null>(null);
  const draftRef = useRef<PhotoMark | null>(null);

  const dirty = JSON.stringify(marks) !== JSON.stringify(initial);
  const sel = selected !== null ? marks[selected] : null;

  const remember = () => setHistory((h) => [...h.slice(-40), marks]);
  const undo = () => {
    setHistory((h) => {
      if (!h.length) return h;
      setMarks(h[h.length - 1]);
      setSelected(null);
      return h.slice(0, -1);
    });
  };
  const removeSelected = () => {
    if (selected === null) return;
    remember();
    setMarks((ms) => ms.filter((_, i) => i !== selected));
    setSelected(null);
  };
  const setNote = (note: string) => {
    if (selected === null) return;
    setMarks((ms) => ms.map((m, i) => (i === selected ? { ...m, note } : m)));
  };
  // Changing colour or width with a mark selected restyles that mark.
  const restyle = (patch: Partial<PhotoMark>) => {
    if (patch.color) setColor(patch.color);
    if (patch.width) setWidth(patch.width);
    if (selected === null) return;
    remember();
    setMarks((ms) => ms.map((m, i) => (i === selected ? { ...m, ...patch } : m)));
  };

  /* ---- zoom ---- */
  const stageSize = () => {
    const r = stageRef.current?.getBoundingClientRect();
    return r ? { left: r.left, top: r.top, w: r.width, h: r.height } : null;
  };
  const clampView = (v: View): View => {
    if (v.s <= 1.001) return { s: 1, x: 0, y: 0 };
    const w = box.w, h = box.h;
    return { s: v.s, x: clamp(v.x, w - w * v.s, 0), y: clamp(v.y, h - h * v.s, 0) };
  };
  const zoomAt = (cx: number, cy: number, factor: number) => {
    setView((v) => {
      const s = clamp(v.s * factor, 1, 6);
      return clampView({ s, x: cx - (cx - v.x) * (s / v.s), y: cy - (cy - v.y) * (s / v.s) });
    });
  };
  const zoomCentre = (factor: number) => zoomAt(box.w / 2, box.h / 2, factor);

  /* ---- pointer ---- */
  const toFrac = (clientX: number, clientY: number): Pt | null => {
    const r = fitRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return [(clientX - r.left) / r.width, (clientY - r.top) / r.height];
  };
  const fitPx = (): Size => {
    const r = fitRef.current?.getBoundingClientRect();
    return { w: r?.width ?? 1, h: r?.height ?? 1 };
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stageRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);

    if (pointers.current.size === 2) {
      // A second finger always means zoom/pan; drop any half-drawn mark.
      draftRef.current = null;
      setDraft(null);
      const [a, b] = [...pointers.current.values()];
      const st = stageSize();
      if (!st) return;
      gesture.current = { kind: "pinch", dist: dist(a, b), mid: [(a[0] + b[0]) / 2 - st.left, (a[1] + b[1]) / 2 - st.top], view };
      return;
    }
    if (pointers.current.size > 2) return;

    const f = toFrac(e.clientX, e.clientY);
    if (!f) return;
    const { w, h } = fitPx();
    const hit = hitTest(marks, [f[0] * w, f[1] * h], w, h);

    if (tool === "select") {
      if (hit >= 0) {
        setSelected(hit);
        remember();
        gesture.current = { kind: "move", index: hit, start: f, orig: marks[hit] };
      } else {
        setSelected(null);
        gesture.current = { kind: "pan", start: [e.clientX, e.clientY], view };
      }
      return;
    }

    const p: Pt = [clamp(f[0], 0, 1), clamp(f[1], 0, 1)];
    const start: PhotoMark = tool === "ellipse" || tool === "rect"
      ? { kind: tool, x: p[0], y: p[1], w: 0, h: 0, color, width, note: "" }
      : { kind: tool, points: [p, p], color, width, note: "" };
    (start as PhotoMark & { _origin?: Pt })._origin = p;
    draftRef.current = start;
    setDraft(start);
    gesture.current = { kind: "draw" };
  };

  const onMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const g = gesture.current;
    if (!g) return;

    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const st = stageSize();
      if (!st) return;
      const mid: Pt = [(a[0] + b[0]) / 2 - st.left, (a[1] + b[1]) / 2 - st.top];
      const s = clamp(g.view.s * (dist(a, b) / (g.dist || 1)), 1, 6);
      const px = (g.mid[0] - g.view.x) / g.view.s, py = (g.mid[1] - g.view.y) / g.view.s;
      setView(clampView({ s, x: mid[0] - px * s, y: mid[1] - py * s }));
      return;
    }
    if (g.kind === "pan") {
      setView(clampView({ ...g.view, x: g.view.x + (e.clientX - g.start[0]), y: g.view.y + (e.clientY - g.start[1]) }));
      return;
    }
    const f = toFrac(e.clientX, e.clientY);
    if (!f) return;
    if (g.kind === "move") {
      const next = moved(g.orig, f[0] - g.start[0], f[1] - g.start[1]);
      setMarks((ms) => ms.map((m, i) => (i === g.index ? next : m)));
      return;
    }
    const d = draftRef.current as (PhotoMark & { _origin?: Pt }) | null;
    if (!d) return;
    const p: Pt = [clamp(f[0], 0, 1), clamp(f[1], 0, 1)];
    let next: PhotoMark & { _origin?: Pt };
    if (d.kind === "ellipse" || d.kind === "rect") {
      const o = d._origin ?? p;
      next = { ...d, x: Math.min(o[0], p[0]), y: Math.min(o[1], p[1]), w: Math.abs(p[0] - o[0]), h: Math.abs(p[1] - o[1]) };
    } else if (d.kind === "arrow") {
      next = { ...d, points: [d.points![0], p] };
    } else {
      const pts = d.points ?? [];
      const last = pts[pts.length - 1];
      const { w, h } = fitPx();
      if (last && Math.hypot((p[0] - last[0]) * w, (p[1] - last[1]) * h) < 2.5) return;
      next = { ...d, points: [...pts, p] };
    }
    draftRef.current = next;
    setDraft(next);
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.kind === "draw") {
      const d = draftRef.current as (PhotoMark & { _origin?: Pt }) | null;
      draftRef.current = null;
      setDraft(null);
      if (d) {
        const { w, h } = fitPx();
        const { _origin, ...mark } = d; // eslint-disable-line @typescript-eslint/no-unused-vars
        const big = mark.kind === "ellipse" || mark.kind === "rect"
          ? Math.max((mark.w ?? 0) * w, (mark.h ?? 0) * h) > 10
          : (mark.points ?? []).slice(1).reduce((acc, q, i) => acc + Math.hypot((q[0] - mark.points![i][0]) * w, (q[1] - mark.points![i][1]) * h), 0) > 10;
        if (big) {
          remember();
          const pts = mark.kind === "pen" && (mark.points?.length ?? 0) > 2 ? mark.points!.slice(1) : mark.points;
          const clean: PhotoMark = mark.kind === "pen" ? { ...mark, points: pts } : mark;
          setMarks((ms) => {
            setSelected(ms.length);
            return [...ms, clean];
          });
        } else {
          // A tap, not a drag: select the mark under the finger, if any.
          const f = toFrac(e.clientX, e.clientY);
          const hit = f ? hitTest(marks, [f[0] * w, f[1] * h], w, h) : -1;
          setSelected(hit >= 0 ? hit : null);
        }
      }
    }
    if (pointers.current.size === 0) gesture.current = null;
    else if (g?.kind === "pinch" && pointers.current.size < 2) gesture.current = null;
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = stageSize();
    if (!st) return;
    zoomAt(e.clientX - st.left, e.clientY - st.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  /* ---- keyboard ---- */
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); undo(); return; }
      if (typing) { if (e.key === "Escape" || e.key === "Enter") (e.target as HTMLElement).blur(); return; }
      if (e.key === "Escape") { if (selected !== null) setSelected(null); else if (!dirty) onClose(); }
      if ((e.key === "Delete" || e.key === "Backspace") && selected !== null) { e.preventDefault(); removeSelected(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const updated = await api.patientPhotos.update(photo._id, { annotations: marks.map((m) => ({ ...m, note: (m.note ?? "").trim() })) });
      // A server without mark storage answers 200 and drops them; never report that as saved.
      if (!Array.isArray(updated?.annotations)) {
        throw new Error("The server can’t store marks yet — the backend update needs deploying. The photo itself is unchanged.");
      }
      toast(marks.length ? `${marks.length} mark${marks.length === 1 ? "" : "s"} saved` : "Marks cleared");
      onSaved?.(updated);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (dirty && !confirmClose) { setConfirmClose(true); return; }
    onClose();
  };

  return (
    <div className="dz-viewer dz-marker" role="dialog" aria-modal="true" aria-label="Mark photo">
      <div className="dz-viewer__bar">
        {confirmClose ? (
          <button type="button" className="dz-btn dz-btn--danger dz-btn--sm" onClick={onClose}><X /> Discard changes</button>
        ) : (
          <button type="button" className="dz-iconbtn" onClick={close} aria-label="Close"><X /></button>
        )}
        <div className="min-w-0 flex-1">
          <b>Mark changes</b>
          <span>{marks.length ? `${marks.length} mark${marks.length === 1 ? "" : "s"} · tap a number to add a note` : "Pick a shape, then drag on the photo"}</span>
        </div>
        <button type="button" className="dz-iconbtn" onClick={undo} disabled={!history.length} aria-label="Undo"><Undo2 /></button>
        <button type="button" className="dz-btn dz-btn--gold dz-btn--sm" disabled={!dirty || busy} onClick={save}>
          <Check />{busy ? "Saving…" : "Save marks"}
        </button>
      </div>

      <div className="dz-marker__body">
        <div ref={stageRef} className="dz-marker__stage"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
          <div ref={canvasRef} className="dz-marker__canvas" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
            <img src={photo.url} alt="" draggable={false} />
            {rect && natural && (
              <div ref={fitRef} className="dz-marks__fit" style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}>
                <MarkSvg rect={{ ...rect, left: 0, top: 0 }} natural={natural} marks={marks} active={selected} draft={draft}
                  onPick={(i) => { setSelected(i); setTool("select"); }} />
              </div>
            )}
          </div>
          {err && <div className="dz-marker__err">{err}</div>}
          <div className="dz-marker__zoom">
            <button type="button" className="dz-iconbtn" onClick={() => zoomCentre(1.35)} aria-label="Zoom in"><ZoomIn /></button>
            <button type="button" className="dz-iconbtn" onClick={() => zoomCentre(1 / 1.35)} aria-label="Zoom out"><ZoomOut /></button>
            <button type="button" className="dz-iconbtn" onClick={() => setView({ s: 1, x: 0, y: 0 })} aria-label="Fit photo"><Maximize /></button>
          </div>
        </div>

        {marks.length > 0 && (
          <aside className="dz-marker__side">
            <div className="dz-marker__sidehead">Marks and notes</div>
            <MarkNotes dark marks={marks} active={selected} onPick={(i) => { setSelected(i); setTool("select"); }} />
          </aside>
        )}
      </div>

      <div className="dz-marker__foot">
        {sel && selected !== null && (
          <div className="dz-marker__callout">
            <span className="dz-marks__pin is-on dz-marker__calloutpin">{selected + 1}</span>
            <span className="dz-marker__kind">{KIND_LABEL[sel.kind]}</span>
            <input ref={noteRef} className="dz-input dz-marker__note" value={sel.note ?? ""} maxLength={500}
              placeholder="Add a note (optional)" onFocus={remember} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className="dz-iconbtn" onClick={removeSelected} aria-label="Delete mark"><Trash2 /></button>
            <button type="button" className="dz-btn dz-btn--soft dz-btn--sm" onClick={() => setSelected(null)}>Done</button>
          </div>
        )}
        <div className="dz-marker__tools">
          <div className="dz-marker__group" role="radiogroup" aria-label="Shape">
            {TOOLS.map((t) => (
              <button key={t.key} type="button" role="radio" aria-checked={tool === t.key}
                className={`dz-marker__tool ${tool === t.key ? "is-on" : ""}`}
                onClick={() => { setTool(t.key); if (t.key !== "select") setSelected(null); }}>
                {t.icon}<span>{t.label}</span>
              </button>
            ))}
          </div>
          <div className="dz-marker__group" role="radiogroup" aria-label="Colour">
            {MARK_COLORS.map((c) => {
              const on = (sel?.color ?? color) === c.value;
              return (
                <button key={c.value} type="button" role="radio" aria-checked={on} aria-label={c.label}
                  className={`dz-marker__swatch ${on ? "is-on" : ""}`} style={{ background: c.value }}
                  onClick={() => restyle({ color: c.value })} />
              );
            })}
          </div>
          <div className="dz-marker__group" role="radiogroup" aria-label="Line width">
            {WIDTHS.map((w) => {
              const on = (sel?.width ?? width) === w;
              return (
                <button key={w} type="button" role="radio" aria-checked={on} aria-label={`Line ${w}`}
                  className={`dz-marker__width ${on ? "is-on" : ""}`} onClick={() => restyle({ width: w })}>
                  <i style={{ width: w + 6, height: w + 6 }} />
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
