import { useEffect, useState } from "react";
import { Check, Pill, Plus, Search, Star, Trash, X } from "lucide-react";
import type { Id, PrescriptionItem, ProductAvailability, RxFavourite, RxRecentItem } from "./lib/types";
import api from "./lib/api";
import { useApi, useDebounced } from "./lib/useApi";
import { Btn, Card, Empty, In, Modal, SecH, Sel, Tag, Toggle } from "./ui";
import StockPill from "./stock-pill";
import {
  DOSE_CHIPS, DURATION_CHIPS, FORM_CHIPS, FREQUENCY_CHIPS,
  INSTRUCTION_CHIPS, RX_CATEGORIES, TIMING_CHIPS, refillDaysFromDuration,
} from "./rx-vocab";

/**
 * The prescription builder.
 *
 * It replaced a flat list where every medicine meant filling seven text boxes
 * by hand. Dermatology is repetitive — the same acne set, the same melasma
 * set, several times a day — so the work is now picking, not typing: three
 * shelves feed one list, and a tap on any line opens a sheet where every
 * common value is a chip.
 *
 *   Favourites  prescriptions this doctor saved, and any shared clinic-wide
 *   Recent      what they actually prescribe most, from their own past notes
 *   Search      the live stock list, with quantities and the Rx flag
 *
 * What it writes is unchanged: `ConsultationNote.prescription`, the same
 * PrescriptionItem the printed slip, the refill reminder and the guest's app
 * already read. Nothing here signs anything — signing stays behind
 * `prescriptions.sign` on the server.
 */

/* ------------------------------------------------------------------ chips */

function ChipRow({ label, value, onChange, chips, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; chips: string[]; placeholder?: string;
}) {
  const isChip = chips.includes(value);
  const [typing, setTyping] = useState(false);
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button key={c} type="button" onClick={() => { onChange(value === c ? "" : c); setTyping(false); }}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-full border px-3 text-[12px] transition ${
              value === c ? "border-gold bg-gold font-bold text-primary" : "border-border bg-surface text-ink2 hover:bg-ivory"}`}>
            {value === c && <Check className="h-3.5 w-3.5" />}{c}
          </button>
        ))}
        <button type="button" onClick={() => setTyping(true)}
          className={`inline-flex min-h-[34px] items-center rounded-full border px-3 text-[12px] ${
            !isChip && value ? "border-gold bg-gold font-bold text-primary" : "border-border bg-surface text-ink3 hover:bg-ivory"}`}>
          Other…
        </button>
      </div>
      {(typing || (!isChip && value)) && (
        <input autoFocus value={isChip ? "" : value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Type ${label.toLowerCase()}`}
          className="mt-2 w-full rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
      )}
    </div>
  );
}

/** Instruction chips, joined into the one sentence the guest reads. */
function InstructionChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const parts = value ? value.split(/\.\s*/).map((s) => s.trim()).filter(Boolean) : [];
  const toggle = (c: string) => {
    const next = parts.includes(c) ? parts.filter((p) => p !== c) : [...parts, c];
    onChange(next.length ? `${next.join(". ")}.` : "");
  };
  return (
    <div className="mb-3.5">
      <div className="mb-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-ink3">Instructions to the guest</div>
      <div className="flex flex-wrap gap-1.5">
        {INSTRUCTION_CHIPS.map((c) => (
          <button key={c} type="button" onClick={() => toggle(c)}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-full border px-3 text-[12px] ${
              parts.includes(c) ? "border-gold bg-gold font-bold text-primary" : "border-border bg-surface text-ink2 hover:bg-ivory"}`}>
            {parts.includes(c) && <Check className="h-3.5 w-3.5" />}{c}
          </button>
        ))}
      </div>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2}
        placeholder="Anything else the guest should know"
        className="mt-2 w-full rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
    </div>
  );
}

/* ------------------------------------------------------------ item editor */

/**
 * One medicine, edited in a sheet.
 *
 * Refill days are shown as what they will actually be — derived from the
 * duration when left blank — rather than as an empty box that quietly becomes
 * something else on save. A doctor should be able to see the nudge the guest
 * is going to get.
 */
export function RxItemEditor({ item, onSave, onRemove, onClose }: {
  item: PrescriptionItem; onSave: (v: PrescriptionItem) => void; onRemove?: () => void; onClose: () => void;
}) {
  const [v, setV] = useState<PrescriptionItem>(item);
  const set = <K extends keyof PrescriptionItem>(k: K, val: PrescriptionItem[K]) => setV((x) => ({ ...x, [k]: val }));
  const derived = refillDaysFromDuration(v.duration);
  const refill = v.refillAfterDays === null || v.refillAfterDays === undefined || v.refillAfterDays === "" ? derived : Number(v.refillAfterDays);

  return (
    <Modal open onClose={onClose} title={v.medicine || "Medicine"} wide>
      <div className="max-h-[62vh] overflow-auto pr-1">
        <div className="mb-3.5 grid grid-cols-2 gap-2">
          <In label="Medicine" value={v.medicine} onChange={(x) => set("medicine", x)} />
          <In label="Strength" value={v.strength ?? ""} onChange={(x) => set("strength", x)} placeholder="500 mg, 0.1%" />
        </div>
        <ChipRow label="Form" value={v.formulation ?? ""} onChange={(x) => set("formulation", x)} chips={FORM_CHIPS} />
        <ChipRow label="Dose" value={v.dosage ?? ""} onChange={(x) => set("dosage", x)} chips={DOSE_CHIPS} />
        <ChipRow label="Frequency" value={v.frequency ?? ""} onChange={(x) => set("frequency", x)} chips={FREQUENCY_CHIPS} />
        <ChipRow label="Duration" value={v.duration ?? ""} onChange={(x) => set("duration", x)} chips={DURATION_CHIPS} />
        <ChipRow label="Timing" value={v.timing ?? ""} onChange={(x) => set("timing", x)} chips={TIMING_CHIPS} />
        <InstructionChips value={v.instructions ?? ""} onChange={(x) => set("instructions", x)} />

        <div className="flex flex-wrap items-center gap-4 border-t border-border pt-3">
          <label className="flex items-center gap-2 text-[12px] text-ink2">
            <Toggle on={!!v.isScheduleH} onChange={(on) => set("isScheduleH", on)} />
            Schedule H
          </label>
          <div className="flex items-center gap-2 text-[12px] text-ink2">
            <span>Refill nudge after</span>
            <input type="number" min={0} max={365}
              value={v.refillAfterDays ?? ""} onChange={(e) => set("refillAfterDays", e.target.value === "" ? null : Number(e.target.value))}
              placeholder={derived ? String(derived) : "—"}
              className="w-20 rounded border border-border bg-ivory px-2 py-1 text-[12px] outline-none focus:border-gold-dark" />
            <span className="text-ink3">
              days{refill && v.refillAfterDays == null ? ` · from the duration` : ""}
            </span>
          </div>
        </div>
        {v.isScheduleH && <div className="mt-2"><Tag kind="warn">Schedule H — the printed slip needs your signature</Tag></div>}
      </div>
      <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
        {onRemove && <Btn kind="ghost" onClick={onRemove}><span className="flex items-center gap-1.5 text-err"><Trash className="h-3.5 w-3.5" /> Remove</span></Btn>}
        <span className="flex-1" />
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave({ ...v, medicine: v.medicine.trim() })} disabled={!v.medicine.trim()}>Done</Btn>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- save favourite */

/** The "no category" row. `Sel` renders plain strings, so it needs a label. */
const NO_CATEGORY = "No category";

function SaveFavourite({ items, advice, onClose, onSaved }: {
  items: PrescriptionItem[]; advice?: string | null; onClose: () => void; onSaved: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(NO_CATEGORY);
  const [scope, setScope] = useState<"mine" | "clinic">("mine");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setErr("Give it a name you'll recognise next week.");
    setBusy(true); setErr(null);
    try {
      await api.rxFavourites.save({ name: name.trim(), items, category: category === NO_CATEGORY ? null : category, advice: advice || null, scope });
      onSaved(name.trim());
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Save this prescription">
      <p className="mb-3 text-[12px] text-ink3">
        Saves the {items.length} line{items.length === 1 ? "" : "s"} above, not this guest. You can still change every
        field each time you use it.
      </p>
      <In label="Name" value={name} onChange={setName} placeholder="Acne — moderate, first visit" full />
      <div className="mt-3"><Sel label="Category" value={category} onChange={(v) => setCategory(v === NO_CATEGORY ? "" : v)} options={[NO_CATEGORY, ...RX_CATEGORIES]} full /></div>
      <label className="mt-3 flex items-start gap-2 text-[12px] text-ink2">
        <input type="checkbox" checked={scope === "clinic"} onChange={(e) => setScope(e.target.checked ? "clinic" : "mine")} className="mt-0.5" />
        <span>Share with every dermatologist. Use this for a protocol the centre has agreed — it stays yours to edit.</span>
      </label>
      {err && <div className="mt-3 text-[12px] text-err">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Btn>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- builder */

const summary = (m: PrescriptionItem) =>
  [m.strength, m.dosage, m.frequency, m.duration, m.timing].filter(Boolean).join(" · ");

export default function RxBuilder({ rx, setRx, locked, branchId }: {
  rx: PrescriptionItem[];
  setRx: (next: PrescriptionItem[]) => void;
  locked: boolean;
  /** Scopes the stock search to the centre the doctor is sitting in. */
  branchId?: string | null;
}) {
  const [shelf, setShelf] = useState<"favourites" | "recent" | "search">("search");
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const [editing, setEditing] = useState<{ index: number } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const favourites = useApi(() => api.rxFavourites.list().then((r) => r.data ?? []).catch(() => []), []);
  const recent = useApi(() => api.rxFavourites.recent().then((r) => r.data ?? []).catch(() => []), []);
  const results = useApi(
    () => (search.trim().length >= 2
      ? api.productAvailability.list({ search: search.trim(), limit: 8, ...(branchId ? { branchId } : {}) }).then((r) => r.data ?? []).catch(() => [])
      : Promise.resolve([] as ProductAvailability[])),
    [search, branchId],
  );

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);

  const add = (item: PrescriptionItem, openEditor = false) => {
    const next = [...rx, item];
    setRx(next);
    setToast(`Added ${item.medicine}`);
    if (openEditor) setEditing({ index: next.length - 1 });
  };

  const addFavourite = async (f: RxFavourite) => {
    setRx([...rx, ...f.items.map((i) => ({ ...i }))]);
    setToast(`Added ${f.items.length} line${f.items.length === 1 ? "" : "s"} from ${f.name}`);
    void api.rxFavourites.markUsed(f._id);
  };

  /*
   * A Zennara product carries its id and the stock at the moment of
   * prescribing — quantity only, never a price. `isRx` on the product master
   * sets Schedule H so nobody has to remember which molecules need a signed
   * slip.
   */
  const fromProduct = (p: ProductAvailability): PrescriptionItem => ({
    medicine: p.name,
    formulation: p.formulation ?? null,
    isScheduleH: p.isRx === true,
    productId: p.source === "product" ? p._id : null,
    availableQuantity: p.quantity,
  });

  return (
    <Card data-tour="rx" className="p-4">
      <SecH t="Prescription" em={rx.length ? `${rx.length} line${rx.length === 1 ? "" : "s"}` : undefined}
        right={!locked && rx.length > 0 ? (
          <Btn kind="ghost" className="!py-1 !text-[11.5px]" onClick={() => setSaveOpen(true)}>
            <span className="flex items-center gap-1.5"><Star className="h-3.5 w-3.5" /> Save as favourite</span>
          </Btn>
        ) : undefined} />

      {/* ---------------- what is on the prescription ---------------- */}
      {rx.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-3 py-4 text-[11.5px] text-ink3">
          Nothing added yet. Pick from a saved prescription, from what you write most, or search the stock list below.
        </div>
      ) : (
        <div className="mb-3 grid gap-1.5">
          {rx.map((m, i) => (
            <button key={i} type="button" disabled={locked} onClick={() => setEditing({ index: i })}
              className="group flex w-full items-start gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:bg-ivory disabled:cursor-default">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sage text-primary"><Pill className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold text-ink">{m.medicine}</span>
                <span className="block text-[11px] text-ink3">{summary(m) || <em>Tap to set dose and duration</em>}</span>
                {m.instructions && <span className="mt-0.5 block text-[11px] text-ink2">{m.instructions}</span>}
                {m.isScheduleH && <span className="mt-1 inline-block"><Tag kind="warn">Sch H</Tag></span>}
              </span>
              {!locked && <span className="shrink-0 text-[11px] font-semibold text-primary opacity-0 group-hover:opacity-100">Edit</span>}
            </button>
          ))}
        </div>
      )}

      {/* ---------------------------- shelves ---------------------------- */}
      {!locked && (
        <div className="rounded-xl border border-border bg-ivory p-2.5">
          <div className="mb-2 flex gap-1">
            {([["search", "Search stock", Search], ["favourites", "Favourites", Star], ["recent", "I prescribe often", Pill]] as const).map(([k, label, Icon]) => (
              <button key={k} type="button" onClick={() => setShelf(k)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold ${
                  shelf === k ? "bg-primary text-white" : "text-ink2 hover:bg-surface"}`}>
                <Icon className="h-3.5 w-3.5" />{label}
                {k === "favourites" && (favourites.data?.length ?? 0) > 0 && <span className="text-[10px] opacity-70">{favourites.data!.length}</span>}
              </button>
            ))}
          </div>

          {shelf === "search" && (
            <>
              <div className="flex gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { add({ medicine: q.trim(), isScheduleH: false }, true); setQ(""); } }}
                  placeholder="Search the stock list — or type a name and press Enter for free text"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
                <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]" disabled={!q.trim()}
                  onClick={() => { add({ medicine: q.trim(), isScheduleH: false }, true); setQ(""); }}>Add</Btn>
              </div>
              <div className="mt-2 grid gap-1">
                {search.trim().length < 2 && <div className="px-1 py-2 text-[11.5px] text-ink3">Type at least two letters to search what the clinic actually holds.</div>}
                {search.trim().length >= 2 && (results.data ?? []).length === 0 && !results.loading && (
                  <div className="px-1 py-2 text-[11.5px] text-ink3">Nothing in stock matches. Press Enter to prescribe it as free text.</div>
                )}
                {(results.data ?? []).map((p) => (
                  <button key={p._id} type="button" onClick={() => { add(fromProduct(p), true); setQ(""); }}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:bg-ivory">
                    <span className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-ink">{p.name}</span>
                      <span className="block text-[10.5px] text-ink3">{[p.formulation, p.brand, p.sku].filter(Boolean).join(" · ") || p.category}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {p.isRx && <Tag kind="warn">Rx</Tag>}
                      <StockPill status={p.status} qty={p.quantity} />
                      <Plus className="h-3.5 w-3.5 text-primary" />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {shelf === "favourites" && (
            <div className="grid gap-1.5">
              {(favourites.data ?? []).length === 0 && (
                <Empty title="No saved prescriptions yet" hint="Write one, then use “Save as favourite”. It appears here for one tap next time." />
              )}
              {(favourites.data ?? []).map((f) => (
                <div key={f._id} className="rounded-lg border border-border bg-surface px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <b className="text-[12.5px] text-ink">{f.name}</b>
                    {f.category && <Tag kind="mute">{f.category}</Tag>}
                    {f.scope === "clinic" && <Tag kind="info">{f.mine ? "Shared" : `by ${f.ownerName ?? "the clinic"}`}</Tag>}
                    <span className="flex-1" />
                    <Btn kind="ghost" className="!py-1 !text-[11px]" onClick={() => addFavourite(f)}>
                      <span className="flex items-center gap-1"><Plus className="h-3 w-3" /> Add all</span>
                    </Btn>
                    {f.mine && (
                      <button type="button" aria-label={`Remove ${f.name}`} className="text-ink3 hover:text-err"
                        onClick={() => api.rxFavourites.remove(f._id).then(() => { favourites.reload(); setToast(`Removed ${f.name}`); }).catch((e) => setToast((e as Error).message))}>
                        <Trash className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <ul className="mt-1 text-[11px] text-ink3">
                    {f.items.slice(0, 4).map((i, j) => <li key={j}>{i.medicine}{summary(i) ? ` — ${summary(i)}` : ""}</li>)}
                    {f.items.length > 4 && <li>+{f.items.length - 4} more</li>}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {shelf === "recent" && (
            <div className="grid gap-1">
              {(recent.data ?? []).length === 0 && (
                <Empty title="Nothing yet" hint="The medicines you prescribe most will collect here, with the dose you last used." />
              )}
              {(recent.data ?? []).map((r: RxRecentItem, i) => (
                <button key={i} type="button" onClick={() => add({ ...r, uses: undefined } as PrescriptionItem)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-left hover:bg-ivory">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-ink">{r.medicine}</span>
                    <span className="block text-[10.5px] text-ink3">{summary(r) || "no dose set"} · used {r.uses}×</span>
                  </span>
                  <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-ok">
          <Check className="h-3.5 w-3.5" />{toast}
        </div>
      )}

      {editing && rx[editing.index] && (
        <RxItemEditor
          item={rx[editing.index]}
          onClose={() => setEditing(null)}
          onRemove={() => { setRx(rx.filter((_, j) => j !== editing.index)); setEditing(null); }}
          onSave={(v) => {
            setRx(rx.map((x, j) => (j === editing.index ? v : x)));
            setEditing(null);
          }}
        />
      )}
      {saveOpen && (
        <SaveFavourite items={rx} onClose={() => setSaveOpen(false)}
          onSaved={(name) => { setSaveOpen(false); favourites.reload(); setToast(`Saved “${name}”`); }} />
      )}
    </Card>
  );
}
