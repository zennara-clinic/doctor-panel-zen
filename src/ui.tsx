import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check, ChevronDown, Loader2, RefreshCw, Search, X } from "lucide-react";
import { isoDay } from "./lib/format";

/* ---------- async states ---------- */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-ink3 ${className}`} />;
}

export function Loading({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="rounded-(--radius-card) border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2 text-[12.5px] text-ink3"><Spinner /> {label}</div>
      <div className="grid gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-8 animate-pulse rounded-lg bg-ivory" />
        ))}
      </div>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-(--radius-card) border border-err bg-err-bg px-4 py-4">
      <div className="text-[13px] font-bold text-err">Couldn’t load this</div>
      <div className="mt-1 text-[12.5px] text-ink2">{message}</div>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-(--radius-btn) bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink2 hover:bg-ivory">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="rounded-(--radius-card) border border-border bg-surface px-4 py-10 text-center">
      <div className="text-[13.5px] font-bold text-ink2">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-[420px] text-[12.5px] text-ink3">{hint}</div>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * One place that decides between skeleton, error and content, so no page
 * renders half-loaded data or a silent blank.
 */
export function Async<T>({ q, children, label, rows, empty }: {
  q: { data: T | undefined; error: string | null; initial: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  label?: string;
  rows?: number;
  empty?: ReactNode;
}) {
  if (q.initial && q.data === undefined && !q.error) return <Loading label={label} rows={rows} />;
  if (q.error && q.data === undefined) return <ErrorState message={q.error} onRetry={q.reload} />;
  if (q.data === undefined) return empty ? <>{empty}</> : <Loading label={label} rows={rows} />;
  return <>{children(q.data)}</>;
}

/** Non-blocking banner for a failed refresh when stale data is still on screen. */
export function StaleBanner({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-warn bg-warn-bg px-3 py-2 text-[12px] text-warn">
      <span>Showing the last good data — {error}</span>
      <button onClick={onRetry} className="shrink-0 font-bold underline">Retry</button>
    </div>
  );
}

/* ---------- page scaffold ---------- */
export function Page({ title, sub, actions, children }: {
  title: string; sub?: string; actions?: ReactNode; children: ReactNode;
}) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[1400px]">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[22px] font-extrabold tracking-[-0.01em]">{title}</h2>
          {sub && <div className="mt-0.5 text-[12.5px] text-ink3">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

/* ---------- buttons ---------- */
export function Btn({ children, kind = "primary", className = "", onClick, disabled }: {
  children: ReactNode; kind?: "primary" | "gold" | "ghost" | "danger"; className?: string;
  onClick?: () => void; disabled?: boolean;
}) {
  const k = {
    primary: "bg-primary text-white hover:bg-primary-hover",
    gold: "bg-gold text-primary hover:bg-gold-dark",
    ghost: "border border-border bg-surface text-ink2 hover:bg-ivory",
    danger: "bg-err-bg text-err hover:bg-err hover:text-white",
  }[kind];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded-(--radius-btn) px-4 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:bg-dis-bg disabled:text-dis ${k} ${className}`}>
      {children}
    </button>
  );
}

/* ---------- tags ---------- */
export type TagKind = "ok" | "warn" | "err" | "info" | "mute" | "gold";
export function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  const k = {
    ok: "bg-ok-bg text-ok", warn: "bg-warn-bg text-warn", err: "bg-err-bg text-err",
    info: "bg-info-bg text-info", mute: "bg-dis-bg text-dis", gold: "bg-cream text-gold-dark",
  }[kind];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${k}`}>{children}</span>;
}
export const STATUS: Record<string, ReactNode> = {
  pending: <Tag kind="warn">Pending</Tag>, confirmed: <Tag kind="ok">Confirmed</Tag>,
  rescheduled: <Tag kind="gold">Reschedule requested</Tag>,
  inprogress: <Tag kind="info">In progress</Tag>, completed: <Tag kind="ok">Completed</Tag>,
  cancelled: <Tag kind="err">Cancelled</Tag>, noshow: <Tag kind="err">No-show</Tag>,
  late: <Tag kind="err">Late</Tag>,
};

/* ---------- stats ---------- */
export function Stats({ items }: {
  items: { k: string; v: ReactNode; d?: ReactNode; hot?: boolean; tone?: "up" | "dn"; onClick?: () => void }[];
}) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
      {items.map((s, i) => (
        <div key={i} onClick={s.onClick}
          className={`rounded-(--radius-card) border bg-surface px-3.5 py-3 ${s.onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${
            s.hot ? "border-gold shadow-[inset_0_0_0_1px_var(--color-gold)]" : "border-border"}`}>
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-ink3">{s.k}</div>
          <div className={`mt-1 text-[22px] font-bold tracking-tight tabular-nums ${s.hot ? "text-gold-dark" : ""}`}>{s.v}</div>
          {s.d && <div className={`mt-0.5 text-[11px] ${s.tone === "up" ? "text-ok" : s.tone === "dn" ? "text-err" : "text-ink3"}`}>{s.d}</div>}
        </div>
      ))}
    </div>
  );
}

/* ---------- card + table ---------- */
export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick}
      className={`rounded-(--radius-card) border border-border bg-surface shadow-[0_4px_16px_rgba(3,47,34,0.05)] ${onClick ? "cursor-pointer transition-shadow hover:shadow-md" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** Panel-wide page size — every listing shows at most this many rows per page. */
export const PAGE_SIZE = 15;

/**
 * Every table paginates itself at PAGE_SIZE rows. Pages that paginate on the
 * server should fetch PAGE_SIZE per page so only one pager appears; everything
 * else (detail sub-lists, filtered catalogues, drawers) gets the pager free.
 * `onRow` always receives the index into the ORIGINAL rows array.
 */
export function DataTable({ cols, rows, onRow, pageSize = PAGE_SIZE }: {
  cols: string[]; rows: ReactNode[][]; onRow?: (i: number) => void; pageSize?: number;
}) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  useEffect(() => { if (page > pages) setPage(pages); }, [pages, page]);
  const current = Math.min(page, pages);
  const offset = (current - 1) * pageSize;
  const shown = rows.length > pageSize ? rows.slice(offset, offset + pageSize) : rows;
  return (
    <div>
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[12.8px]">
        <thead><tr>
          {cols.map((c) => (
            <th key={c} className="whitespace-nowrap border-b border-border bg-ivory px-3 py-2.5 text-left font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">{c}</th>
          ))}
        </tr></thead>
        <tbody>
          {shown.map((r, i) => (
            <tr key={offset + i} onClick={onRow ? () => onRow(offset + i) : undefined} className={`group ${onRow ? "cursor-pointer" : ""}`}>
              {r.map((c, j) => (
                <td key={j} className="border-b border-border px-3 py-2.5 align-middle text-ink2 tabular-nums group-last:border-0 group-hover:bg-ivory">{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="px-3 py-8 text-center text-[12.5px] text-ink3">Nothing here yet.</td></tr>
          )}
        </tbody>
      </table>
    </Card>
    {rows.length > pageSize && (
      <div className="mt-2 flex items-center justify-end gap-2 text-[12px] text-ink3">
        <button onClick={() => setPage(current - 1)} disabled={current <= 1}
          className="rounded-lg border border-border bg-surface px-2.5 py-1 font-semibold disabled:opacity-40">← Prev</button>
        <span>{offset + 1}–{Math.min(offset + pageSize, rows.length)} of {rows.length}</span>
        <button onClick={() => setPage(current + 1)} disabled={current >= pages}
          className="rounded-lg border border-border bg-surface px-2.5 py-1 font-semibold disabled:opacity-40">Next →</button>
      </div>
    )}
    </div>
  );
}

export const B = ({ children }: { children: ReactNode }) => <b className="font-semibold text-ink">{children}</b>;

/* ---------- controlled tabs ---------- */
export function Tabs({ items, active, onChange }: {
  items: [string, (number | string)?][]; active: number; onChange: (i: number) => void;
}) {
  return (
    <div className="mb-3.5 flex gap-0.5 overflow-x-auto border-b border-border">
      {items.map((t, i) => (
        <button key={i} onClick={() => onChange(i)}
          className={`whitespace-nowrap border-b-2 px-3.5 py-2 text-[12.5px] ${
            i === active ? "border-gold-dark font-bold text-primary" : "border-transparent font-medium text-ink3 hover:text-ink2"}`}>
          {t[0]}
          {t[1] !== undefined && <span className="ml-1.5 font-mono text-[10px] text-ink3">{t[1]}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- notes ---------- */
export function Note({ kind = "gold", children, className = "" }: {
  kind?: "gold" | "crit" | "ok"; children: ReactNode; className?: string;
}) {
  const k = { gold: "border-gold-dark bg-ivory", crit: "border-err bg-err-bg", ok: "border-ok bg-ok-bg" }[kind];
  return <div className={`my-3 rounded-r-md border-l-[3px] px-3.5 py-2.5 text-[12.5px] text-ink2 ${k} ${className}`}>{children}</div>;
}

/* ---------- first-visit hint ---------- */
export function Hint({ id, children, steps }: { id: string; children?: ReactNode; steps?: string[] }) {
  const [gone, setGone] = useState(() => localStorage.getItem("hint-" + id) === "1");
  if (gone) return null;
  return (
    <div className="mb-4 rounded-(--radius-card) border border-gold-dark bg-cream px-4 py-3 text-[12.5px] text-ink2">
      <div className="flex items-start justify-between gap-3">
        <b className="text-[13px] text-ink">How this page works</b>
        <button className="shrink-0 rounded-lg bg-gold px-3 py-1 text-[11.5px] font-bold text-primary"
          onClick={() => { localStorage.setItem("hint-" + id, "1"); setGone(true); }}>
          Got it
        </button>
      </div>
      {children && <div className="mt-1">{children}</div>}
      {steps && (
        <ol className="mt-2 grid list-none gap-1.5 p-0">
          {steps.map((st, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gold text-[10.5px] font-extrabold text-primary">{i + 1}</span>
              <span>{st}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/* ---------- inputs ---------- */
export function In({ label, value, onChange, placeholder, type = "text", full, hint, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; full?: boolean; hint?: string; readOnly?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-full" : ""}`}>
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <input type={type} value={value} placeholder={placeholder} readOnly={readOnly} onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border border-border px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark ${readOnly ? "cursor-not-allowed bg-surface text-ink3" : "bg-ivory"}`} />
      {hint && <div className="text-[10.5px] text-ink3">{hint}</div>}
    </div>
  );
}

/**
 * An image field that can be pasted as a URL or uploaded. Uploads go through
 * the media endpoint and come back as a public URL, so every editor that
 * needs a picture behaves the same way.
 */
export function UploadField({ label, value, onChange, hint, full, upload, accept = "image/*", preview = true }: {
  label: string; value: string; onChange: (url: string) => void; hint?: string; full?: boolean;
  /** The uploader — normally `(f) => api.media.upload([f]).then((r) => r[0]?.url ?? "")`. */
  upload: (file: File) => Promise<string>;
  accept?: string;
  preview?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-full" : ""}`}>
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <div className="flex gap-2">
        <input type="text" value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark" />
        <Btn kind="ghost" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : "Upload"}</Btn>
        <input ref={ref} type="file" accept={accept} className="hidden" onChange={async (e) => {
          const file = e.target.files?.[0]; e.target.value = "";
          if (!file) return;
          setBusy(true); setErr(null);
          try {
            const url = await upload(file);
            if (url) onChange(url); else setErr("Upload failed — no URL returned");
          } catch (ex) { setErr((ex as Error).message); } finally { setBusy(false); }
        }} />
      </div>
      {preview && value && accept.startsWith("image") && (
        <img src={value} alt="" className="mt-1 h-28 w-full rounded-xl border border-border object-cover" />
      )}
      {err ? <div className="text-[10.5px] text-err">{err}</div> : hint ? <div className="text-[10.5px] text-ink3">{hint}</div> : null}
    </div>
  );
}

export function Sel({ label, value, onChange, options, full }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; full?: boolean;
}) {
  return (
    <div className={`flex flex-col gap-1 ${full ? "col-span-full" : ""}`}>
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function Area({ label, value, onChange, placeholder, rows = 3 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="resize-y rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] text-ink outline-none focus:border-gold-dark" />
    </div>
  );
}

export function Toggle({ on, onChange, gold }: { on: boolean; onChange?: (v: boolean) => void; gold?: boolean }) {
  return (
    <button type="button" onClick={() => onChange?.(!on)}
      className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? (gold ? "bg-gold-dark" : "bg-ok") : "bg-border"}`}>
      <span className={`absolute top-[2.5px] h-[15px] w-[15px] rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-[2.5px]"}`} />
    </button>
  );
}

export function Switch({ label, sub, on, onChange, gold }: {
  label: string; sub?: string; on: boolean; onChange?: (v: boolean) => void; gold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-ivory px-3 py-2.5">
      <div className="text-[12.5px] font-semibold">
        {label}{sub && <span className="mt-0.5 block text-[10.5px] font-normal text-ink3">{sub}</span>}
      </div>
      <Toggle on={on} onChange={onChange} gold={gold} />
    </div>
  );
}

export function SecH({ t, em, right }: { t: string; em?: string; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-2 first:mt-0">
      <div className="text-[12px] font-bold uppercase tracking-[0.04em] text-ink2">
        {t}{em && <em className="ml-1 text-[11.5px] font-medium normal-case not-italic tracking-normal text-ink3">{em}</em>}
      </div>
      {right}
    </div>
  );
}

export function Prog({ pct, w = "" }: { pct: number; w?: string }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded bg-sage ${w || "w-24"}`}>
      <div className="h-full rounded bg-gold-dark" style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ---------- modal + drawer ---------- */
export function Modal({ open, onClose, title, children, wide, xl }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; xl?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4">
      <div className="absolute inset-0 bg-primary/40 backdrop-blur-[2px]" onClick={onClose} />
      {/* `xl` is for the editors that carry a side column plus dense rows —
          at 720px those get squeezed into unreadable slivers. */}
      <div className={`relative max-h-[88vh] w-full overflow-auto rounded-(--radius-lg2) bg-surface p-5 shadow-2xl ${xl ? "max-w-[1040px]" : wide ? "max-w-[720px]" : "max-w-[480px]"}`}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[16px] font-extrabold">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-sage text-ink2"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-primary/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[400px] overflow-auto border-l border-border bg-bg p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold">{title}</h3>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-sage text-ink2"><X className="h-4 w-4" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- dropdown menu ---------- */
export function Menu({ button, items, align = "left" }: {
  button: ReactNode; items: { label: ReactNode; onClick?: () => void }[]; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <div onClick={() => setOpen(!open)}>{button}</div>
      {open && (
        <>
          <div className="fixed inset-0 z-[94]" onClick={() => setOpen(false)} />
          <div className={`absolute z-[95] mt-1.5 min-w-[190px] overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
            {items.map((it, i) => (
              <button key={i} className="block w-full px-3.5 py-2 text-left text-[12.5px] font-medium text-ink2 hover:bg-ivory"
                onClick={() => { setOpen(false); it.onClick?.(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- OTP ---------- */
export function Otp({ value, onChange, length = 6 }: { value: string; onChange: (v: string) => void; length?: number }) {
  return (
    <input value={value} maxLength={length} inputMode="numeric" placeholder={Array(length).fill("•").join(" ")}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
      className="w-full rounded-xl border-2 border-border bg-ivory px-4 py-3 text-center font-mono text-[22px] font-bold tracking-[0.6em] outline-none focus:border-gold-dark" />
  );
}

/* ---------- media upload ---------- */
export function FileDrop({ files, onFiles }: {
  files: { url: string; name: string; video: boolean }[];
  onFiles: (f: { url: string; name: string; video: boolean }[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div onClick={() => ref.current?.click()}
        className="grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-border bg-ivory px-4 py-6 text-center text-[12.5px] text-ink3 hover:border-gold-dark">
        <div><b className="text-ink2">Click to upload</b> — photos or video<br />JPG · PNG · MP4 · up to 20 MB</div>
      </div>
      <input ref={ref} type="file" accept="image/*,video/*" multiple className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files || []).map((f) => ({
            url: URL.createObjectURL(f), name: f.name, video: f.type.startsWith("video"),
          }));
          onFiles([...files, ...list]);
        }} />
      {files.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative">
              {f.video
                ? <video src={f.url} className="h-16 w-24 rounded-lg border border-border object-cover" />
                : <img src={f.url} alt={f.name} className="h-16 w-24 rounded-lg border border-border object-cover" />}
              <button onClick={() => onFiles(files.filter((_, j) => j !== i))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-err text-[10px] font-bold text-white">×</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- CSV export ---------- */
export function exportCsv(name: string, header: string[], rows: (string | number)[][]) {
  const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = name + ".csv";
  a.click();
}

/* ---------- interactive charts (validated palette) ---------- */
const compactNumber = (n: number) => Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function AreaChart({ pts, label, labels, format }: {
  pts: number[]; label: string; labels?: string[]; format?: (n: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = `chart-${useId().replace(/:/g, "")}`;
  const w = 600, h = 205, n = pts.length;
  const left = 48, right = 14, top = 18, bottom = 30;
  const maxValue = Math.max(...pts, 0) || 1;
  const mx = maxValue * 1.12;
  const X = (i: number) => left + (i * (w - left - right)) / Math.max(1, n - 1);
  const Y = (v: number) => h - bottom - (v / mx) * (h - top - bottom);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join(" ");
  const fill = `${line}L${X(Math.max(0, n - 1)).toFixed(1)},${h - bottom}L${left},${h - bottom}Z`;
  const valueText = (v: number) => format ? format(v) : compactNumber(v);
  const axisIndexes = [...new Set(Array.from({ length: Math.min(5, n) }, (_, i) => Math.round((i * (n - 1)) / Math.max(1, Math.min(5, n) - 1))))];
  const hover = active === null ? null : { x: X(active), y: Y(pts[active]), value: pts[active], text: labels?.[active] || `${label} ${active + 1}` };

  if (!pts.length) return null;
  return (
    <div className="relative mt-2.5 select-none">
      <div className="absolute right-1 top-0 z-10 rounded-lg bg-ivory px-2 py-1 text-[9.5px] text-ink3">
        Latest <b className="ml-1 text-ink">{valueText(pts[n - 1])}</b>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} trend`} className="block w-full touch-none"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - box.left) / box.width) * w;
          setActive(Math.max(0, Math.min(n - 1, Math.round(((x - left) / (w - left - right)) * (n - 1)))));
        }}
        onPointerLeave={() => setActive(null)}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-c1)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--color-c1)" stopOpacity="0.015" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = h - bottom - f * (h - top - bottom);
          return (
            <g key={f}>
              <line x1={left} x2={w - right} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={f ? "3 5" : undefined} />
              {(f === 0 || f === 0.5 || f === 1) && (
                <text x={left - 7} y={y + 3} textAnchor="end" className="fill-ink3 font-mono text-[8.5px]">{valueText(mx * f)}</text>
              )}
            </g>
          );
        })}
        <path d={fill} fill={`url(#${gradientId})`} className="chart-area-enter" />
        <path d={line} pathLength={1} fill="none" stroke="var(--color-c1)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="chart-line-enter" />
        {pts.map((point, i) => (
          <circle key={i} cx={X(i)} cy={Y(point)} r={8} fill="transparent" tabIndex={0}
            aria-label={`${labels?.[i] || `${label} ${i + 1}`}: ${valueText(point)}`}
            onFocus={() => setActive(i)} onBlur={() => setActive(null)} />
        ))}
        {hover && (
          <g pointerEvents="none">
            <line x1={hover.x} x2={hover.x} y1={top} y2={h - bottom} stroke="var(--color-gold-dark)" strokeDasharray="3 4" />
            <circle cx={hover.x} cy={hover.y} r={7} fill="var(--color-surface)" stroke="var(--color-c1)" strokeWidth={2.5} />
            <circle cx={hover.x} cy={hover.y} r={2.5} fill="var(--color-c1)" />
          </g>
        )}
        {labels && labels.length === n && axisIndexes.map((i) => (
          <text key={i} x={X(i)} y={h - 9} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-ink3 font-mono text-[8.5px]">{labels[i]}</text>
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-20 min-w-24 -translate-y-full rounded-xl border border-border bg-primary px-2.5 py-2 text-white shadow-xl"
          style={{ left: `${(hover.x / w) * 100}%`, top: `${(hover.y / h) * 100}%`, transform: `translate(${active !== null && active > n * 0.72 ? "-100%" : "-50%"}, calc(-100% - 9px))` }}>
          <div className="whitespace-nowrap text-[9.5px] text-side-ink">{hover.text}</div>
          <div className="mt-0.5 whitespace-nowrap font-mono text-[12px] font-bold">{valueText(hover.value)}</div>
        </div>
      )}
    </div>
  );
}

export function HBars({ rows, color = "var(--color-c1)" }: { rows: [string, number, string?][]; color?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const mx = Math.max(...rows.map((r) => r[1]), 0) || 1;
  return (
    <div className="mt-2">
      {rows.map((r, i) => (
        <div key={`${r[0]}-${i}`} role="img" tabIndex={0} aria-label={`${r[0]}: ${r[2] ?? r[1]}`}
          onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
          className={`grid grid-cols-[minmax(82px,120px)_1fr_auto] items-center gap-2 rounded-lg px-1.5 py-1.5 text-[12px] outline-none transition-colors ${active === i ? "bg-ivory" : ""}`}>
          <div className={`truncate whitespace-nowrap transition-colors ${active === i ? "font-bold text-ink" : "text-ink2"}`} title={r[0]}>{r[0]}</div>
          <div className="relative h-4 overflow-hidden rounded-md bg-sage">
            <div className="chart-bar-x h-full rounded-md transition-[filter,opacity] duration-200"
              style={{ width: `${Math.max(r[1] > 0 ? 2 : 0, Math.round((r[1] / mx) * 100))}%`, background: color, animationDelay: `${i * 45}ms`, filter: active === i ? "brightness(0.88)" : undefined }} />
            {active === i && <span className="absolute inset-y-0 right-1 flex items-center font-mono text-[8.5px] font-bold text-ink2">{compactNumber(r[1])}</span>}
          </div>
          <div className={`max-w-24 text-right font-mono text-[10.5px] tabular-nums ${active === i ? "font-bold text-ink" : "text-ink2"}`}>{r[2] ?? r[1].toLocaleString("en-IN")}</div>
        </div>
      ))}
    </div>
  );
}

export function GBars({ cats, series }: { cats: string[]; series: { n: string; v: number[] }[] }) {
  const [active, setActive] = useState<{ category: number; series: number } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const w = 600, h = 215, left = 42, right = 12, top = 18, bottom = 34;
  const C = ["var(--color-c1)", "var(--color-c2)", "var(--color-c3)", "var(--color-c4)"];
  const visible = series.map((s, original) => ({ ...s, original })).filter((s) => !hidden.has(s.n));
  const mx = (Math.max(...visible.flatMap((s) => s.v), 0) || 1) * 1.12;
  const gw = (w - left - right) / Math.max(1, cats.length);
  const bw = Math.max(3, Math.min(22, (gw - 12) / Math.max(1, visible.length)));
  const activeRow = active ? series[active.series] : null;
  const activeValue = activeRow && active ? activeRow.v[active.category] ?? 0 : 0;
  const activeVisibleIndex = active ? visible.findIndex((s) => s.original === active.series) : -1;
  const activeX = active && activeVisibleIndex >= 0
    ? left + active.category * gw + (gw - visible.length * bw - (visible.length - 1) * 3) / 2 + activeVisibleIndex * (bw + 3) + bw / 2
    : 0;
  const activeY = h - bottom - (activeValue / mx) * (h - top - bottom);

  return (
    <div className="relative mt-2.5 select-none">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Grouped bar chart" className="block w-full overflow-visible" onPointerLeave={() => setActive(null)}>
        {[0, 0.5, 1].map((f) => {
          const y = h - bottom - f * (h - top - bottom);
          return (
            <g key={f}>
              <line x1={left} x2={w - right} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={f ? "3 5" : undefined} />
              <text x={left - 7} y={y + 3} textAnchor="end" className="fill-ink3 font-mono text-[8.5px]">{compactNumber(mx * f)}</text>
            </g>
          );
        })}
        {cats.map((c, ci) => (
          <g key={`${c}-${ci}`}>
            {visible.map((s, si) => {
              const v = s.v[ci] ?? 0;
              const x = left + ci * gw + (gw - visible.length * bw - (visible.length - 1) * 3) / 2 + si * (bw + 3);
              const bh = (v / mx) * (h - top - bottom);
              const on = active?.category === ci && active?.series === s.original;
              return (
                <rect key={s.n} x={x} y={h - bottom - bh} width={bw} height={Math.max(v > 0 ? 2 : 0, bh)} rx={4} fill={C[s.original % C.length]}
                  tabIndex={0} role="img" aria-label={`${s.n}, ${c}: ${v.toLocaleString("en-IN")}`}
                  onPointerEnter={() => setActive({ category: ci, series: s.original })} onFocus={() => setActive({ category: ci, series: s.original })} onBlur={() => setActive(null)}
                  className={`chart-bar-y cursor-pointer transition-opacity ${active && !on ? "opacity-45" : "opacity-100"}`}
                  style={{ animationDelay: `${ci * 35 + si * 55}ms`, transformOrigin: `${x + bw / 2}px ${h - bottom}px` }} />
              );
            })}
            <text x={left + ci * gw + gw / 2} y={h - 13} textAnchor="middle" className="fill-ink3 font-mono text-[8.5px]">{c}</text>
          </g>
        ))}
      </svg>
      {active && activeRow && activeVisibleIndex >= 0 && (
        <div className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl border border-border bg-primary px-2.5 py-2 text-white shadow-xl"
          style={{ left: `${(activeX / w) * 100}%`, top: `${(activeY / h) * 100}%`, transform: `translate(${active.category > cats.length * 0.72 ? "-100%" : "-50%"}, calc(-100% - 8px))` }}>
          <div className="whitespace-nowrap text-[9.5px] text-side-ink">{cats[active.category]} · {activeRow.n}</div>
          <div className="mt-0.5 font-mono text-[12px] font-bold">{activeValue.toLocaleString("en-IN")}</div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px] text-ink3">
        {series.map((s, i) => {
          const off = hidden.has(s.n);
          return (
            <button key={s.n} type="button" aria-pressed={!off} title={`${off ? "Show" : "Hide"} ${s.n}`}
              onClick={() => setHidden((current) => {
                const next = new Set(current);
                if (off) next.delete(s.n);
                else if (visible.length > 1) next.add(s.n);
                return next;
              })}
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${off ? "border-transparent opacity-45" : "border-border bg-ivory text-ink2 hover:border-gold-dark"}`}>
              <i className="inline-block h-2 w-2 rounded-full" style={{ background: C[i % C.length] }} />{s.n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ChartCard({ title, sub, hero, heroTone, children }: {
  title: string; sub?: string; hero?: string; heroTone?: string; children: ReactNode;
}) {
  return (
    <Card className="group/chart overflow-hidden p-4 transition-[border-color,box-shadow] duration-200 hover:border-gold-dark/50 hover:shadow-[0_10px_30px_rgba(3,47,34,0.06)]">
      <div className="text-[13px] font-bold">{title}</div>
      {sub && <div className="mt-0.5 text-[11px] text-ink3">{sub}</div>}
      {hero && (
        <div className="mt-1.5 text-[26px] font-bold tracking-tight tabular-nums">
          {hero}{heroTone && <span className="ml-2 text-[12px] font-semibold text-ok">{heroTone}</span>}
        </div>
      )}
      {children}
    </Card>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="tracking-wider text-gold-dark">
      {"★".repeat(n)}<span className="text-border">{"★".repeat(5 - n)}</span>
    </span>
  );
}

/* ---------- delete-with-reason ---------- */
export function DeleteModal({ open, onClose, what, onConfirm }: {
  open: boolean; onClose: () => void; what: string; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Delete ${what}`}>
      <Note kind="crit" className="mt-0">This action is logged with your name and timestamp, and requires a written reason.</Note>
      <Area label="Reason for deletion (required)" value={reason} onChange={setReason} placeholder="e.g. duplicate entry created by mistake" />
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn kind="danger" disabled={reason.trim().length < 5} onClick={() => { onConfirm(reason); onClose(); }}>Delete</Btn>
      </div>
    </Modal>
  );
}

/* ======================================================================== *
 * Filter drawer — slides in from the right (≈28% of the screen), used by
 * every listing page. Fields are plain controlled widgets; the page owns the
 * filter state and decides what "Apply" means.
 * ======================================================================== */
export function FilterDrawer({ open, onClose, title = "Filters", children, onApply, onReset, activeCount = 0, applyLabel = "Apply filters" }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode;
  onApply: () => void; onReset: () => void; activeCount?: number; applyLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <div className={`fixed inset-0 z-[80] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-primary/30 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`absolute right-0 top-0 flex h-full w-full flex-col border-l border-border bg-bg shadow-2xl transition-transform duration-250 ease-out sm:w-[min(92vw,max(340px,28vw))] ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h3 className="text-[15px] font-extrabold">{title}</h3>
            <div className="text-[11px] text-ink3">{activeCount ? `${activeCount} active` : "No filters applied"}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onReset} className="text-[11.5px] font-semibold text-ink3 hover:text-err">Reset all</button>
            <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-sage text-ink2"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex gap-2 border-t border-border bg-surface px-5 py-3">
          <Btn kind="ghost" className="flex-1" onClick={onClose}>Close</Btn>
          <Btn className="flex-[2]" onClick={() => { onApply(); onClose(); }}>{applyLabel}</Btn>
        </div>
      </aside>
    </div>
  );
}

/** A titled group inside the drawer. */
export function FSection({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-5">
      <div className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.09em] text-ink3">{title}</div>
      {hint && <div className="-mt-1 mb-2 text-[11px] text-ink3">{hint}</div>}
      {children}
    </div>
  );
}

/** Searchable checklist used everywhere the admin can choose more than one item. */
export function MultiSelect({ label, options, value, onChange, placeholder = "Select options…", searchPlaceholder = "Search options…", className = "", disabled = false }: {
  label?: string;
  options: [string, string][];
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = new Set(value);
  const selectedLabels = options.filter(([v]) => selected.has(v)).map(([, text]) => text);
  const query = search.trim().toLocaleLowerCase();
  const visible = options.filter(([, text]) => !query || text.toLocaleLowerCase().includes(query));

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    requestAnimationFrame(() => searchRef.current?.focus());
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  const toggle = (item: string) => {
    onChange(selected.has(item) ? value.filter((v) => v !== item) : [...value, item]);
  };
  const summary = !value.length
    ? placeholder
    : value.length === 1
      ? selectedLabels[0] ?? "1 selected"
      : `${value.length} selected`;

  return (
    <div ref={root} className={`relative ${className}`}>
      {label && <label className="mb-1 block text-[11px] font-bold tracking-[0.02em] text-ink2">{label}</label>}
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-ivory px-2.5 py-2 text-left text-[12.5px] outline-none transition-colors hover:border-gold-dark focus:border-gold-dark disabled:cursor-not-allowed disabled:opacity-60">
        <span className={`min-w-0 flex-1 truncate ${value.length ? "font-semibold text-ink" : "text-ink3"}`}>{summary}</span>
        {!!value.length && <span className="rounded-full bg-primary px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-white">{value.length}</span>}
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="relative z-[70] mt-1 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="border-b border-border p-2">
            <div className="flex items-center gap-2 rounded-lg border border-border bg-ivory px-2.5 focus-within:border-gold-dark">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink3" />
              <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder} aria-label={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-ink outline-none placeholder:text-ink3" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="text-ink3 hover:text-ink"><X className="h-3.5 w-3.5" /></button>}
            </div>
            <div className="mt-1.5 flex items-center justify-between px-0.5 text-[10.5px] font-semibold">
              <span className="text-ink3">{visible.length} option{visible.length === 1 ? "" : "s"}</span>
              <span className="flex gap-2">
                <button type="button" onClick={() => onChange([...new Set([...value, ...visible.map(([v]) => v)])])} className="text-primary hover:underline">Select shown</button>
                <button type="button" onClick={() => onChange([])} disabled={!value.length} className="text-ink3 hover:text-err disabled:opacity-40">Clear</button>
              </span>
            </div>
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-56 overflow-y-auto p-1.5">
            {visible.map(([v, text]) => {
              const on = selected.has(v);
              return (
                <button key={v} type="button" role="option" aria-selected={on} onClick={() => toggle(v)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors ${on ? "bg-sage text-primary" : "text-ink2 hover:bg-ivory"}`}>
                  <span className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${on ? "border-primary bg-primary text-white" : "border-border bg-surface"}`}>
                    {on && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
                </button>
              );
            })}
            {!visible.length && <div className="px-2 py-5 text-center text-[11.5px] text-ink3">No matching options</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pill chips for single choice; multi-select calls are upgraded to the searchable checklist. */
export function Chips({ options, value, onChange, multi }: {
  options: [string, string][]; value: string | string[]; onChange: (v: string | string[]) => void; multi?: boolean;
}) {
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  if (multi) return <MultiSelect options={options} value={selected} onChange={onChange} />;
  const toggle = (v: string) => {
    onChange(selected[0] === v ? "" : v);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, label]) => {
        const on = selected.includes(v);
        return (
          <button key={v} type="button" onClick={() => toggle(v)}
            className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
              on ? "border-primary bg-primary text-white" : "border-border bg-surface text-ink2 hover:border-gold-dark"}`}>
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** From / to date pair with quick presets. */
export function DateRange({ from, to, onChange, presets = true }: {
  from: string; to: string; onChange: (from: string, to: string) => void; presets?: boolean;
}) {
  const iso = (d: Date) => isoDay(d);
  const today = new Date();
  const preset = (days: number) => { const f = new Date(today); f.setDate(f.getDate() - days + 1); onChange(iso(f), iso(today)); };
  const thisMonth = () => onChange(iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today));
  const lastMonth = () => onChange(iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0)));
  const cls = "w-full rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-dark";
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className={cls} aria-label="From" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className={cls} aria-label="To" />
      </div>
      {presets && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {([["Today", () => preset(1)], ["7 days", () => preset(7)], ["30 days", () => preset(30)], ["This month", thisMonth], ["Last month", lastMonth], ["Clear", () => onChange("", "")]] as [string, () => void][]).map(([l, fn]) => (
            <button key={l} type="button" onClick={fn} className="rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold text-ink3 hover:bg-ivory hover:text-ink">{l}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Min / max numeric pair. */
export function NumRange({ min, max, onChange, prefix, placeholder = ["Min", "Max"] }: {
  min: string; max: string; onChange: (min: string, max: string) => void; prefix?: string; placeholder?: [string, string];
}) {
  const cls = "w-full rounded-lg border border-border bg-ivory px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-gold-dark";
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative">{prefix && <span className="absolute left-2 top-1.5 text-[12px] text-ink3">{prefix}</span>}
        <input type="number" value={min} onChange={(e) => onChange(e.target.value, max)} placeholder={placeholder[0]} className={`${cls} ${prefix ? "pl-5" : ""}`} /></div>
      <div className="relative">{prefix && <span className="absolute left-2 top-1.5 text-[12px] text-ink3">{prefix}</span>}
        <input type="number" value={max} onChange={(e) => onChange(min, e.target.value)} placeholder={placeholder[1]} className={`${cls} ${prefix ? "pl-5" : ""}`} /></div>
    </div>
  );
}

/** Row of removable chips summarising the active filters above a table. */
export function ActiveFilters({ items, onClear }: { items: { key: string; label: string; onRemove: () => void }[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {items.map((f) => (
        <span key={f.key} className="inline-flex items-center gap-1 rounded-full border border-gold bg-gold/10 px-2.5 py-0.5 text-[11.5px] font-semibold text-primary">
          {f.label}
          <button onClick={f.onRemove} aria-label={`Remove ${f.label}`} className="ml-0.5 text-ink3 hover:text-err">×</button>
        </span>
      ))}
      <button onClick={onClear} className="text-[11.5px] font-semibold text-ink3 hover:text-err">Clear all</button>
    </div>
  );
}

/** Export modal: pick columns, then download whatever the page's fetcher returns. */
export function ExportModal({ open, onClose, columns, fetchRows, filename, summary }: {
  open: boolean; onClose: () => void; columns: string[]; filename: string; summary?: string;
  fetchRows: (fields: string[]) => Promise<Record<string, unknown>[]>;
}) {
  const [picked, setPicked] = useState<string[]>(columns);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setPicked(columns); setErr(null); } }, [open, columns.join("|")]);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const rows = await fetchRows(picked);
      if (!rows.length) { setErr("Nothing matched the current filters."); return; }
      const cols = picked.filter((c) => c in rows[0]);
      exportCsv(filename, cols, rows.map((r) => cols.map((c) => (r[c] ?? "") as string | number)));
      onClose();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Modal open={open} onClose={onClose} title="Export CSV">
      {summary && <div className="mb-3 text-[12.5px] text-ink2">{summary}</div>}
      <MultiSelect label={`Columns (${picked.length}/${columns.length})`} options={columns.map((c) => [c, c])}
        value={picked} onChange={setPicked} placeholder="Choose columns…" searchPlaceholder="Search columns…" />
      {err && <div className="mt-2 text-[12px] text-err">{err}</div>}
      <div className="mt-3 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy || !picked.length} onClick={run}>{busy ? "Preparing…" : "Download CSV"}</Btn>
      </div>
    </Modal>
  );
}
