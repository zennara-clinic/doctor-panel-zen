import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import type { ReactNode } from "react";
import { AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronLeft, Info, Lightbulb, Loader2, RefreshCw, Search, Star, X } from "lucide-react";
import { addClinicDays, clinicMonthEnd, clinicMonthStart, isoDay } from "./lib/format";

/*
 * The panel's shared primitives. They render the classes in styles/derm.css,
 * so every screen — the rebuilt ones and the older ones that still compose
 * these — draws from one set of solid colours, one radius scale and one touch
 * size. Signatures are unchanged from the previous version on purpose: other
 * files call these with the same props.
 */

/* ---------- async states ---------- */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-ink3 ${className}`} />;
}

export function Loading({ label = "Loading…", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div className="grid gap-2.5" aria-busy="true">
      {label && <div className="flex items-center gap-2 text-[14px] text-ink3"><Spinner /> {label}</div>}
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="dz-skel" />)}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="dz-note dz-note--err" role="alert">
      <AlertTriangle />
      <div className="min-w-0 flex-1">
        <b className="block">Couldn’t load this</b>
        <span className="text-ink2">{message}</span>
      </div>
      {onRetry && <button type="button" className="dz-btn dz-btn--danger dz-btn--sm" onClick={onRetry}><RefreshCw /> Try again</button>}
    </div>
  );
}

export function Empty({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="dz-empty">
      {icon && <div className="dz-empty__icon">{icon}</div>}
      <b>{title}</b>
      {hint && <p>{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
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
    <div className="dz-note dz-note--warn mb-4">
      <AlertTriangle />
      <span className="flex-1">Showing the last good data — {error}</span>
      <button type="button" className="dz-link" onClick={onRetry}>Retry</button>
    </div>
  );
}

/* ---------- page scaffold ---------- */
export function Page({ eyebrow, title, sub, actions, back, children }: {
  eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode;
  back?: { label: string; onClick: () => void };
  children: ReactNode;
}) {
  return (
    <div className="dz-page">
      <header className="dz-head">
        <div className="dz-head__txt">
          {back && <button type="button" className="dz-back" onClick={back.onClick}><ChevronLeft />{back.label}</button>}
          {eyebrow && <div className="dz-eyebrow">{eyebrow}</div>}
          <h1 className="dz-title">{title}</h1>
          {sub && <div className="dz-sub">{sub}</div>}
        </div>
        {actions && <div className="dz-head__actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

/* ---------- buttons ---------- */
export type BtnKind = "primary" | "secondary" | "ghost" | "plain" | "soft" | "gold" | "danger";
const BTN_CLASS: Record<BtnKind, string> = {
  primary: "dz-btn--primary",
  secondary: "dz-btn--secondary",
  // "ghost" has always meant the bordered white button in this panel.
  ghost: "dz-btn--secondary",
  plain: "dz-btn--ghost",
  soft: "dz-btn--soft",
  gold: "dz-btn--gold",
  danger: "dz-btn--danger",
};

export function Btn({ children, kind = "primary", size, className = "", onClick, disabled, type = "button", title }: {
  children: ReactNode; kind?: BtnKind; size?: "sm" | "lg"; className?: string;
  onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; title?: string;
}) {
  return (
    <button type={type} title={title} onClick={onClick} disabled={disabled}
      className={`dz-btn ${BTN_CLASS[kind]} ${size ? `dz-btn--${size}` : ""} ${className}`}>
      {children}
    </button>
  );
}

/* ---------- tags ---------- */
export type TagKind = "ok" | "warn" | "err" | "info" | "mute" | "gold";
const TAG_CLASS: Record<TagKind, string> = {
  ok: "dz-pill--ok", warn: "dz-pill--warn", err: "dz-pill--err", info: "dz-pill--info", mute: "dz-pill--off", gold: "dz-pill--gold",
};
export function Tag({ kind, children }: { kind: TagKind; children: ReactNode }) {
  return <span className={`dz-pill dz-pill--sm ${TAG_CLASS[kind]}`}>{children}</span>;
}
export const STATUS: Record<string, ReactNode> = {
  pending: <Tag kind="warn">Pending</Tag>, confirmed: <Tag kind="ok">Confirmed</Tag>,
  rescheduled: <Tag kind="gold">Reschedule requested</Tag>,
  checkedin: <Tag kind="gold">Checked in</Tag>,
  inprogress: <Tag kind="info">In session</Tag>, completed: <Tag kind="ok">Completed</Tag>,
  cancelled: <Tag kind="err">Cancelled</Tag>, noshow: <Tag kind="err">No-show</Tag>,
  late: <Tag kind="err">Late</Tag>,
};

/* ---------- stats ---------- */
export function Stats({ items }: {
  items: { k: string; v: ReactNode; d?: ReactNode; hot?: boolean; tone?: "up" | "dn"; onClick?: () => void }[];
}) {
  return (
    <div className="dz-stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))" }}>
      {items.map((s, i) => {
        const Tag = s.onClick ? "button" : "div";
        return (
          <Tag key={i} type={s.onClick ? "button" : undefined} onClick={s.onClick}
            className="dz-stat" style={s.hot ? { borderColor: "var(--color-gold)", background: "var(--color-surface)" } : undefined}>
            <div className="dz-stat__top">{s.k}</div>
            <div className="dz-stat__n" style={{ fontSize: 26 }}>{s.v}</div>
            {s.d && <div className="dz-stat__d" style={s.tone === "up" ? { color: "var(--color-ok)" } : s.tone === "dn" ? { color: "var(--color-err)" } : undefined}>{s.d}</div>}
          </Tag>
        );
      })}
    </div>
  );
}

/* ---------- card + table ---------- */
export function Card({ children, className = "", onClick }: { children: ReactNode; className?: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} className={`dz-card ${onClick ? "cursor-pointer" : ""} ${className}`}>
      {children}
    </div>
  );
}

/** A card with the panel's standard head: icon, title, a quiet line under it, and an action on the right. */
export function Panel({ title, sub, icon, right, children, className = "", bodyClassName = "", tone }: {
  title: ReactNode; sub?: ReactNode; icon?: ReactNode; right?: ReactNode; children?: ReactNode;
  className?: string; bodyClassName?: string; tone?: "sage" | "alert";
}) {
  return (
    <section className={`dz-card ${tone ? `dz-card--${tone}` : ""} ${className}`}>
      <div className="dz-card__head">
        <div className="min-w-0">
          <h2 className="dz-card__title">{icon}{title}</h2>
          {sub && <div className="dz-card__sub">{sub}</div>}
        </div>
        {right}
      </div>
      {children !== undefined && <div className={`dz-card__body ${bodyClassName}`}>{children}</div>}
    </section>
  );
}

/** Panel-wide page size — every listing shows at most this many rows per page. */
export const PAGE_SIZE = 15;

/**
 * Every table paginates itself at PAGE_SIZE rows. `onRow` always receives the
 * index into the ORIGINAL rows array.
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
      <div className="dz-table-wrap">
        <table className="dz-table">
          <thead><tr>{cols.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={offset + i} onClick={onRow ? () => onRow(offset + i) : undefined} className={onRow ? "is-click" : ""}>
                {r.map((c, j) => <td key={j}>{c}</td>)}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={cols.length} className="py-10 text-center text-ink3">Nothing here yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize && (
        <div className="dz-pager">
          <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" onClick={() => setPage(current - 1)} disabled={current <= 1}>Previous</button>
          <span>{offset + 1}–{Math.min(offset + pageSize, rows.length)} of {rows.length}</span>
          <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" onClick={() => setPage(current + 1)} disabled={current >= pages}>Next</button>
        </div>
      )}
    </div>
  );
}

export const B = ({ children }: { children: ReactNode }) => <b className="font-bold text-ink">{children}</b>;

/* ---------- controlled tabs ---------- */
export function Tabs({ items, active, onChange }: {
  items: [string, (number | string)?][]; active: number; onChange: (i: number) => void;
}) {
  return (
    <div className="mb-4 max-w-full">
      <div className="dz-seg" role="tablist">
        {items.map((t, i) => (
          <button key={i} type="button" role="tab" aria-selected={i === active} className={i === active ? "is-on" : ""} onClick={() => onChange(i)}>
            {t[0]}
            {t[1] !== undefined && <span className="dz-seg__n">{t[1]}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Segmented control for a small set of string keys. */
export function Segmented<K extends string>({ value, onChange, options, block }: {
  value: K; onChange: (k: K) => void; block?: boolean;
  options: { key: K; label: ReactNode; icon?: ReactNode; count?: number }[];
}) {
  return (
    <div className={`dz-seg ${block ? "dz-seg--block" : ""}`} role="tablist">
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} className={value === o.key ? "is-on" : ""} onClick={() => onChange(o.key)}>
          {o.icon}{o.label}{o.count !== undefined && <span className="dz-seg__n">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- notes ---------- */
export function Note({ kind = "gold", children, className = "" }: {
  kind?: "gold" | "crit" | "ok" | "warn" | "info"; children: ReactNode; className?: string;
}) {
  const tone = { gold: "", crit: "dz-note--err", ok: "dz-note--ok", warn: "dz-note--warn", info: "dz-note--info" }[kind];
  const Icon = kind === "crit" || kind === "warn" ? AlertTriangle : kind === "ok" ? CheckCircle2 : Info;
  return <div className={`dz-note ${tone} my-3 ${className}`}><Icon /><div className="min-w-0 flex-1">{children}</div></div>;
}

/* ---------- first-visit hint ---------- */
export function Hint({ id, children, steps }: { id: string; children?: ReactNode; steps?: string[] }) {
  const [gone, setGone] = useState(() => localStorage.getItem("hint-" + id) === "1");
  if (gone) return null;
  return (
    <div className="dz-tip">
      <Lightbulb />
      <div className="min-w-0 flex-1">
        <b>How this page works</b>
        {children && <div className="mt-1">{children}</div>}
        {steps && <ol>{steps.map((st, i) => <li key={i}>{st}</li>)}</ol>}
      </div>
      <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm"
        onClick={() => { localStorage.setItem("hint-" + id, "1"); setGone(true); }}>
        Got it
      </button>
    </div>
  );
}

/* ---------- inputs ---------- */
export function In({ label, value, onChange, placeholder, type = "text", full, hint, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; full?: boolean; hint?: string; readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className={`dz-field ${full ? "col-span-full" : ""}`}>
      {label && <label htmlFor={id} className="dz-label">{label}</label>}
      <input id={id} type={type} value={value} placeholder={placeholder} readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)} className="dz-input" />
      {hint && <div className="dz-hint">{hint}</div>}
    </div>
  );
}

/**
 * An image field that can be pasted as a URL or uploaded.
 */
export function UploadField({ label, value, onChange, hint, full, upload, accept = "image/*", preview = true }: {
  label: string; value: string; onChange: (url: string) => void; hint?: string; full?: boolean;
  upload: (file: File) => Promise<string>;
  accept?: string;
  preview?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className={`dz-field ${full ? "col-span-full" : ""}`}>
      <label className="dz-label">{label}</label>
      <div className="flex gap-2">
        <input type="text" value={value} placeholder="https://…" onChange={(e) => onChange(e.target.value)} className="dz-input min-w-0 flex-1" />
        <Btn kind="secondary" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading…" : "Upload"}</Btn>
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
        <img src={value} alt="" className="mt-1 h-28 w-full rounded-2xl border border-border object-cover" />
      )}
      {err ? <div className="dz-error">{err}</div> : hint ? <div className="dz-hint">{hint}</div> : null}
    </div>
  );
}

export function Sel({ label, value, onChange, options, full }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; full?: boolean;
}) {
  const id = useId();
  return (
    <div className={`dz-field ${full ? "col-span-full" : ""}`}>
      {label && <label htmlFor={id} className="dz-label">{label}</label>}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="dz-select">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

export function Area({ label, value, onChange, placeholder, rows = 3, readOnly }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; readOnly?: boolean;
}) {
  const id = useId();
  return (
    <div className="dz-field">
      {label && <label htmlFor={id} className="dz-label">{label}</label>}
      <textarea id={id} rows={rows} value={value} placeholder={placeholder} readOnly={readOnly}
        onChange={(e) => onChange(e.target.value)} className="dz-textarea" style={{ minHeight: rows * 26 + 24 }} />
    </div>
  );
}

export function Toggle({ on, onChange, disabled, label }: { on: boolean; onChange?: (v: boolean) => void; gold?: boolean; disabled?: boolean; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={() => onChange?.(!on)} className={`dz-toggle ${on ? "is-on" : ""}`} />
  );
}

export function Switch({ label, sub, on, onChange }: {
  label: string; sub?: string; on: boolean; onChange?: (v: boolean) => void; gold?: boolean;
}) {
  return (
    <div className="dz-switch">
      <div className="min-w-0"><b>{label}</b>{sub && <small>{sub}</small>}</div>
      <Toggle on={on} onChange={onChange} label={label} />
    </div>
  );
}

export function SecH({ t, em, right }: { t: string; em?: string; right?: ReactNode }) {
  return (
    <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2 first:mt-0">
      <div className="text-[15px] font-extrabold tracking-[-0.01em] text-ink">
        {t}{em && <span className="ml-1.5 text-[13px] font-medium text-ink3">{em}</span>}
      </div>
      {right}
    </div>
  );
}

export function Prog({ pct, w = "" }: { pct: number; w?: string }) {
  return <div className={`dz-prog ${w || "w-24"}`}><i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} /></div>;
}

/* ---------- modal + sheet + drawer ---------- */
function useEscape(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({ open, onClose, title, sub, children, footer, wide, xl }: {
  open: boolean; onClose: () => void; title: ReactNode; sub?: ReactNode; children: ReactNode;
  footer?: ReactNode; wide?: boolean; xl?: boolean;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="dz-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className={`dz-modal ${xl ? "dz-modal--xl" : wide ? "dz-modal--wide" : ""}`}>
        <div className="dz-dialog__head">
          <div className="min-w-0">
            <h3 className="dz-dialog__title">{title}</h3>
            {sub && <div className="dz-dialog__sub">{sub}</div>}
          </div>
          <button type="button" className="dz-iconbtn dz-iconbtn--plain" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="dz-dialog__body">{children}</div>
        {footer && <div className="dz-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Bottom sheet — for anything a finger works through on a tablet: chips, tagging, pickers. */
export function Sheet({ open, onClose, eyebrow, title, sub, children, footer }: {
  open: boolean; onClose: () => void; eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode;
  children: ReactNode; footer?: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="dz-scrim dz-scrim--sheet" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" className="dz-sheet">
        <div className="dz-sheet__grip" />
        <div className="dz-dialog__head">
          <div className="min-w-0">
            {eyebrow && <div className="dz-dialog__eyebrow">{eyebrow}</div>}
            <h3 className="dz-dialog__title">{title}</h3>
            {sub && <div className="dz-dialog__sub">{sub}</div>}
          </div>
          <button type="button" className="dz-iconbtn" onClick={onClose} aria-label="Close"><X /></button>
        </div>
        <div className="dz-dialog__body">{children}</div>
        {footer && <div className="dz-dialog__foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({ open, onClose, title, children }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode;
}) {
  useEscape(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[440px] overflow-auto border-l border-border bg-surface p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="dz-dialog__title">{title}</h3>
          <button type="button" onClick={onClose} className="dz-iconbtn" aria-label="Close"><X /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------- dropdown menu ---------- */
export type MenuItem = { label: ReactNode; onClick?: () => void; icon?: ReactNode; danger?: boolean; disabled?: boolean; divider?: boolean };
export function Menu({ button, items, align = "left" }: {
  button: ReactNode; items: MenuItem[]; align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  useEscape(open, () => setOpen(false));
  return (
    <div className="dz-menu-wrap">
      <div onClick={() => setOpen(!open)}>{button}</div>
      {open && (
        <>
          <div className="fixed inset-0 z-[94]" onClick={() => setOpen(false)} />
          <div className={`dz-menu ${align === "right" ? "dz-menu--right" : "dz-menu--left"}`} role="menu">
            {items.map((it, i) => it.divider ? <hr key={i} /> : it.onClick ? (
              <button key={i} type="button" role="menuitem" disabled={it.disabled}
                className={`dz-menu__item ${it.danger ? "is-danger" : ""}`}
                onClick={() => { setOpen(false); it.onClick?.(); }}>
                {it.icon}{it.label}
              </button>
            ) : (
              <div key={i} className="dz-menu__label">{it.label}</div>
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
    <input value={value} maxLength={length} inputMode="numeric" placeholder={Array(length).fill("•").join("")}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
      className="dz-input dz-otp" />
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
      <button type="button" onClick={() => ref.current?.click()}
        className="grid w-full cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-border-strong bg-sage px-4 py-6 text-center text-[14px] text-ink3">
        <div><b className="text-ink">Tap to upload</b> — photos or video<br />JPG · PNG · MP4 · up to 20 MB</div>
      </button>
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
                ? <video src={f.url} className="h-16 w-24 rounded-xl border border-border object-cover" />
                : <img src={f.url} alt={f.name} className="h-16 w-24 rounded-xl border border-border object-cover" />}
              <button type="button" onClick={() => onFiles(files.filter((_, j) => j !== i))} aria-label="Remove"
                className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-err text-white"><X className="h-3.5 w-3.5" /></button>
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

/* ---------- interactive charts (validated palette, flat fills) ---------- */
const compactNumber = (n: number) => Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function AreaChart({ pts, label, labels, format }: {
  pts: number[]; label: string; labels?: string[]; format?: (n: number) => string;
}) {
  const [active, setActive] = useState<number | null>(null);
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
      <div className="absolute right-1 top-0 z-10 rounded-lg bg-sage px-2 py-1 text-[11px] text-ink3">
        Latest <b className="ml-1 text-ink">{valueText(pts[n - 1])}</b>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} trend`} className="block w-full touch-none"
        onPointerMove={(event) => {
          const box = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - box.left) / box.width) * w;
          setActive(Math.max(0, Math.min(n - 1, Math.round(((x - left) / (w - left - right)) * (n - 1)))));
        }}
        onPointerLeave={() => setActive(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = h - bottom - f * (h - top - bottom);
          return (
            <g key={f}>
              <line x1={left} x2={w - right} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={f ? "3 5" : undefined} />
              {(f === 0 || f === 0.5 || f === 1) && (
                <text x={left - 7} y={y + 3} textAnchor="end" className="fill-ink3 text-[9px]">{valueText(mx * f)}</text>
              )}
            </g>
          );
        })}
        <path d={fill} fill="var(--color-c1)" fillOpacity={0.12} className="chart-area-enter" />
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
          <text key={i} x={X(i)} y={h - 9} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} className="fill-ink3 text-[9px]">{labels[i]}</text>
        ))}
      </svg>
      {hover && (
        <div className="pointer-events-none absolute z-20 min-w-24 rounded-xl bg-primary px-2.5 py-2 text-white"
          style={{ left: `${(hover.x / w) * 100}%`, top: `${(hover.y / h) * 100}%`, transform: `translate(${active !== null && active > n * 0.72 ? "-100%" : "-50%"}, calc(-100% - 9px))` }}>
          <div className="whitespace-nowrap text-[11px] text-side-ink">{hover.text}</div>
          <div className="mt-0.5 whitespace-nowrap text-[13px] font-bold">{valueText(hover.value)}</div>
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
          className={`grid grid-cols-[minmax(90px,140px)_1fr_auto] items-center gap-3 rounded-lg px-1.5 py-2 text-[13px] outline-none transition-colors ${active === i ? "bg-sage" : ""}`}>
          <div className={`truncate whitespace-nowrap ${active === i ? "font-bold text-ink" : "text-ink2"}`} title={r[0]}>{r[0]}</div>
          <div className="relative h-4 overflow-hidden rounded-md bg-sage-2">
            <div className="chart-bar-x h-full rounded-md"
              style={{ width: `${Math.max(r[1] > 0 ? 2 : 0, Math.round((r[1] / mx) * 100))}%`, background: color, animationDelay: `${i * 45}ms` }} />
          </div>
          <div className={`max-w-28 text-right text-[12.5px] tabular-nums ${active === i ? "font-bold text-ink" : "text-ink2"}`}>{r[2] ?? r[1].toLocaleString("en-IN")}</div>
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
              <text x={left - 7} y={y + 3} textAnchor="end" className="fill-ink3 text-[9px]">{compactNumber(mx * f)}</text>
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
            <text x={left + ci * gw + gw / 2} y={h - 13} textAnchor="middle" className="fill-ink3 text-[9px]">{c}</text>
          </g>
        ))}
      </svg>
      {active && activeRow && activeVisibleIndex >= 0 && (
        <div className="pointer-events-none absolute z-20 rounded-xl bg-primary px-2.5 py-2 text-white"
          style={{ left: `${(activeX / w) * 100}%`, top: `${(activeY / h) * 100}%`, transform: `translate(${active.category > cats.length * 0.72 ? "-100%" : "-50%"}, calc(-100% - 8px))` }}>
          <div className="whitespace-nowrap text-[11px] text-side-ink">{cats[active.category]} · {activeRow.n}</div>
          <div className="mt-0.5 text-[13px] font-bold">{activeValue.toLocaleString("en-IN")}</div>
        </div>
      )}
      <div className="mt-1 flex flex-wrap gap-1.5 text-[12px] text-ink3">
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
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${off ? "border-transparent opacity-45" : "border-border bg-surface text-ink2"}`}>
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
    <div className="dz-card dz-card--pad overflow-hidden">
      <div className="text-[15.5px] font-extrabold">{title}</div>
      {sub && <div className="mt-0.5 text-[13px] text-ink3">{sub}</div>}
      {hero && (
        <div className="mt-2 text-[28px] font-extrabold tracking-tight tabular-nums">
          {hero}{heroTone && <span className="ml-2 text-[13px] font-bold text-ok">{heroTone}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-gold-dark" aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} strokeWidth={2} className={i <= n ? "fill-current" : "text-border"} />
      ))}
    </span>
  );
}

/** An inline rating. Never write a star glyph into a string. */
export function RatingValue({ value, className = "" }: { value?: number | null; className?: string }) {
  if (value === null || value === undefined) return <span className={className}>—</span>;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} aria-label={`Rated ${value}`}>
      <Star size={12} strokeWidth={2} className="fill-current text-gold-dark" />
      {typeof value === "number" ? value.toFixed(1) : value}
    </span>
  );
}

/** A <Menu> trigger that owns its disclosure chevron. */
export function MenuButton({ children, kind = "ghost", className }: {
  children: ReactNode; kind?: ComponentProps<typeof Btn>["kind"]; className?: string;
}) {
  return (
    <Btn kind={kind} className={className}>
      {children}<ChevronDown className="opacity-70" />
    </Btn>
  );
}

/* ---------- delete-with-reason ---------- */
export function DeleteModal({ open, onClose, what, onConfirm }: {
  open: boolean; onClose: () => void; what: string; onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (open) setReason(""); }, [open]);
  return (
    <Modal open={open} onClose={onClose} title={`Delete ${what}`}
      footer={<>
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Cancel</Btn>
        <Btn kind="danger" disabled={reason.trim().length < 5} onClick={() => { onConfirm(reason); onClose(); }}>Delete</Btn>
      </>}>
      <Note kind="crit" className="mt-0">This action is logged with your name and timestamp, and requires a written reason.</Note>
      <Area label="Reason for deletion (required)" value={reason} onChange={setReason} placeholder="e.g. duplicate entry created by mistake" />
    </Modal>
  );
}

/* ======================================================================== *
 * Filter drawer — slides in from the right, used by listing pages.
 * ======================================================================== */
export function FilterDrawer({ open, onClose, title = "Filters", children, onApply, onReset, activeCount = 0, applyLabel = "Apply filters" }: {
  open: boolean; onClose: () => void; title?: string; children: ReactNode;
  onApply: () => void; onReset: () => void; activeCount?: number; applyLabel?: string;
}) {
  useEscape(open, onClose);
  return (
    <div className={`fixed inset-0 z-[80] ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div className={`absolute inset-0 bg-scrim transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`} onClick={onClose} />
      <aside className={`absolute right-0 top-0 flex h-full w-full flex-col border-l border-border bg-surface transition-transform duration-200 ease-out sm:w-[min(92vw,max(360px,30vw))] ${open ? "translate-x-0" : "translate-x-full"}`}
        role="dialog" aria-label={title}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="dz-dialog__title">{title}</h3>
            <div className="text-[13px] text-ink3">{activeCount ? `${activeCount} active` : "No filters applied"}</div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onReset} className="dz-link">Reset all</button>
            <button type="button" onClick={onClose} className="dz-iconbtn" aria-label="Close"><X /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex gap-2 border-t border-border px-5 py-3">
          <Btn kind="secondary" className="flex-1" onClick={onClose}>Close</Btn>
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
      <div className="mb-2 text-[13px] font-extrabold text-ink2">{title}</div>
      {hint && <div className="-mt-1 mb-2 text-[12.5px] text-ink3">{hint}</div>}
      {children}
    </div>
  );
}

/** Searchable checklist used everywhere more than one item can be chosen. */
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
      {label && <label className="dz-label mb-1.5">{label}</label>}
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="dz-input flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
        <span className={`min-w-0 flex-1 truncate ${value.length ? "font-semibold text-ink" : "text-ink3"}`}>{summary}</span>
        {!!value.length && <span className="dz-pill dz-pill--sm dz-pill--dark">{value.length}</span>}
        <ChevronDown className={`h-4 w-4 shrink-0 text-ink3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="relative z-[70] mt-1.5 overflow-hidden rounded-2xl border border-border-strong bg-surface">
          <div className="border-b border-border p-2">
            <div className="dz-searchbox">
              <Search />
              <input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder} aria-label={searchPlaceholder} className="dz-input" />
            </div>
            <div className="mt-2 flex items-center justify-between px-0.5 text-[12.5px] font-semibold">
              <span className="text-ink3">{visible.length} option{visible.length === 1 ? "" : "s"}</span>
              <span className="flex gap-3">
                <button type="button" onClick={() => onChange([...new Set([...value, ...visible.map(([v]) => v)])])} className="dz-link">Select shown</button>
                <button type="button" onClick={() => onChange([])} disabled={!value.length} className="dz-link">Clear</button>
              </span>
            </div>
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto p-1.5">
            {visible.map(([v, text]) => {
              const on = selected.has(v);
              return (
                <button key={v} type="button" role="option" aria-selected={on} onClick={() => toggle(v)}
                  className={`flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[14px] ${on ? "bg-sage text-primary" : "text-ink2 hover:bg-sage"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-md border ${on ? "border-primary bg-primary text-white" : "border-border-strong bg-surface"}`}>
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
                </button>
              );
            })}
            {!visible.length && <div className="px-2 py-5 text-center text-[13px] text-ink3">No matching options</div>}
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
    <div className="dz-chips">
      {options.map(([v, label]) => {
        const on = selected.includes(v);
        return (
          <button key={v} type="button" onClick={() => toggle(v)} className={`dz-chip dz-chip--sm ${on ? "is-on" : ""}`}>
            {on && <Check />}{label}
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
  const today = isoDay();
  const preset = (days: number) => onChange(addClinicDays(today, -days + 1), today);
  const thisMonth = () => onChange(clinicMonthStart(today), today);
  const lastMonth = () => {
    const end = addClinicDays(clinicMonthStart(today), -1);
    onChange(clinicMonthStart(end), clinicMonthEnd(end));
  };
  return (
    <div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} className="dz-input" aria-label="From" />
        <input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} className="dz-input" aria-label="To" />
      </div>
      {presets && (
        <div className="dz-chips mt-2">
          {([["Today", () => preset(1)], ["7 days", () => preset(7)], ["30 days", () => preset(30)], ["This month", thisMonth], ["Last month", lastMonth], ["Clear", () => onChange("", "")]] as [string, () => void][]).map(([l, fn]) => (
            <button key={l} type="button" onClick={fn} className="dz-chip dz-chip--sm">{l}</button>
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
  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="relative">{prefix && <span className="absolute left-3 top-3 text-[14px] text-ink3">{prefix}</span>}
        <input type="number" value={min} onChange={(e) => onChange(e.target.value, max)} placeholder={placeholder[0]} className={`dz-input ${prefix ? "pl-7" : ""}`} /></div>
      <div className="relative">{prefix && <span className="absolute left-3 top-3 text-[14px] text-ink3">{prefix}</span>}
        <input type="number" value={max} onChange={(e) => onChange(min, e.target.value)} placeholder={placeholder[1]} className={`dz-input ${prefix ? "pl-7" : ""}`} /></div>
    </div>
  );
}

/** Row of removable chips summarising the active filters above a table. */
export function ActiveFilters({ items, onClear }: { items: { key: string; label: string; onRemove: () => void }[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {items.map((f) => (
        <span key={f.key} className="dz-pill dz-pill--line">
          {f.label}
          <button type="button" onClick={f.onRemove} aria-label={`Remove ${f.label}`} className="text-ink3 hover:text-err"><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="dz-link">Clear all</button>
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
    <Modal open={open} onClose={onClose} title="Export CSV"
      footer={<><span className="flex-1" /><Btn kind="secondary" onClick={onClose}>Cancel</Btn><Btn disabled={busy || !picked.length} onClick={run}>{busy ? "Preparing…" : "Download CSV"}</Btn></>}>
      {summary && <div className="mb-3 text-[14px] text-ink2">{summary}</div>}
      <MultiSelect label={`Columns (${picked.length}/${columns.length})`} options={columns.map((c) => [c, c])}
        value={picked} onChange={setPicked} placeholder="Choose columns…" searchPlaceholder="Search columns…" />
      {err && <div className="dz-error mt-2">{err}</div>}
    </Modal>
  );
}
