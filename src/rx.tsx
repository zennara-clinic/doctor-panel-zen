import { useState } from "react";
import { Check, History, Pill, Plus, Search, Star, Trash2 } from "lucide-react";
import type { PrescriptionItem, ProductAvailability, RxFavourite, RxRecentItem } from "./lib/types";
import api from "./lib/api";
import { useApi, useDebounced } from "./lib/useApi";
import { useStore } from "./store";
import { Btn, Empty, In, Modal, Panel, Segmented, Sel, Sheet, Switch, Tag, Toggle } from "./ui";
import StockPill from "./stock-pill";
import {
  DOSE_CHIPS, DURATION_CHIPS, FORM_CHIPS, FREQUENCY_CHIPS,
  INSTRUCTION_CHIPS, RX_CATEGORIES, TIMING_CHIPS, refillDaysFromDuration,
} from "./rx-vocab";

/**
 * The prescription builder.
 *
 * Dermatology is repetitive — the same acne set, the same melasma set, several
 * times a day — so the work is picking, not typing: three shelves feed one
 * list, and a tap on any line opens a bottom sheet where every common value is
 * a chip.
 *
 *   Search stock   the live stock list at this centre, quantities and the Rx flag
 *   Favourites     prescriptions this dermatologist saved, plus shared clinic ones
 *   Often used     what they actually prescribe most, from their own past notes
 *
 * What it writes is unchanged: `ConsultationNote.prescription`. Nothing here
 * signs anything — signing stays behind `prescriptions.sign` on the server.
 * No prices, ever: availability, not the catalogue.
 */

/* ------------------------------------------------------------------ chips */

function ChipRow({ label, value, onChange, chips, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; chips: string[]; placeholder?: string;
}) {
  const isChip = chips.includes(value);
  const [typing, setTyping] = useState(false);
  const custom = typing || (!isChip && !!value);
  return (
    <div className="dz-field">
      <span className="dz-label">{label}</span>
      <div className="dz-chips">
        {chips.map((c) => (
          <button key={c} type="button" className={`dz-chip ${value === c ? "is-on" : ""}`}
            onClick={() => { onChange(value === c ? "" : c); setTyping(false); }}>
            {value === c && <Check />}{c}
          </button>
        ))}
        <button type="button" className={`dz-chip dz-chip--dash ${custom ? "is-on" : ""}`} onClick={() => setTyping(true)}>Other…</button>
      </div>
      {custom && (
        <input autoFocus={typing} className="dz-input" value={isChip ? "" : value} onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? `Type the ${label.toLowerCase()}`} />
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
    <div className="dz-field">
      <span className="dz-label">Instructions to the guest</span>
      <div className="dz-chips">
        {INSTRUCTION_CHIPS.map((c) => (
          <button key={c} type="button" className={`dz-chip dz-chip--sm ${parts.includes(c) ? "is-on" : ""}`} onClick={() => toggle(c)}>
            {parts.includes(c) && <Check />}{c}
          </button>
        ))}
      </div>
      <textarea className="dz-textarea" style={{ minHeight: 72 }} value={value} onChange={(e) => onChange(e.target.value)} rows={2}
        placeholder="Anything else the guest should know" />
    </div>
  );
}

export const rxSummary = (m: PrescriptionItem) =>
  [m.strength, m.dosage, m.frequency, m.duration, m.timing].filter(Boolean).join(" · ");

/* ------------------------------------------------------------ item editor */

export function RxItemEditor({ item, onSave, onRemove, onClose }: {
  item: PrescriptionItem; onSave: (v: PrescriptionItem) => void; onRemove?: () => void; onClose: () => void;
}) {
  const [v, setV] = useState<PrescriptionItem>(item);
  const set = <K extends keyof PrescriptionItem>(k: K, val: PrescriptionItem[K]) => setV((x) => ({ ...x, [k]: val }));
  const derived = refillDaysFromDuration(v.duration);

  return (
    <Sheet open onClose={onClose} eyebrow="Medicine" title={v.medicine || "New medicine"}
      sub={rxSummary(v) || "Tap the chips — nothing needs typing."}
      footer={<>
        {onRemove && <Btn kind="danger" onClick={onRemove}><Trash2 />Remove</Btn>}
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Cancel</Btn>
        <Btn size="lg" onClick={() => onSave({ ...v, medicine: v.medicine.trim() })} disabled={!v.medicine.trim()}><Check />Done</Btn>
      </>}>
      <div className="dz-stack" style={{ gap: 22 }}>
        <div className="dz-form-grid">
          <In label="Medicine" value={v.medicine} onChange={(x) => set("medicine", x)} />
          <In label="Strength" value={v.strength ?? ""} onChange={(x) => set("strength", x)} placeholder="500 mg, 0.1%" />
        </div>
        <ChipRow label="Form" value={v.formulation ?? ""} onChange={(x) => set("formulation", x)} chips={FORM_CHIPS} />
        <ChipRow label="Dose" value={v.dosage ?? ""} onChange={(x) => set("dosage", x)} chips={DOSE_CHIPS} />
        <ChipRow label="How often" value={v.frequency ?? ""} onChange={(x) => set("frequency", x)} chips={FREQUENCY_CHIPS} />
        <ChipRow label="For how long" value={v.duration ?? ""} onChange={(x) => set("duration", x)} chips={DURATION_CHIPS} />
        <ChipRow label="When" value={v.timing ?? ""} onChange={(x) => set("timing", x)} chips={TIMING_CHIPS} />
        <InstructionChips value={v.instructions ?? ""} onChange={(x) => set("instructions", x)} />
        <div className="dz-switch">
          <div><b>Schedule H drug</b><small>The printed prescription carries your signature line.</small></div>
          <Toggle on={!!v.isScheduleH} onChange={(on) => set("isScheduleH", on)} label="Schedule H" />
        </div>
        <div className="dz-field">
          <label className="dz-label" htmlFor="rx-refill">Refill reminder after</label>
          <div className="dz-row">
            <input id="rx-refill" type="number" min={0} max={365} className="dz-input" style={{ maxWidth: 130 }}
              value={v.refillAfterDays ?? ""} placeholder={derived ? String(derived) : "—"}
              onChange={(e) => set("refillAfterDays", e.target.value === "" ? null : Number(e.target.value))} />
            <span className="dz-hint">days{derived && (v.refillAfterDays === null || v.refillAfterDays === undefined || v.refillAfterDays === "") ? ` — blank uses ${derived}, from the duration` : " — the guest’s app nudges them when the course runs out"}</span>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------- save favourite */

const NO_CATEGORY = "No category";

function SaveFavourite({ items, onClose, onSaved }: {
  items: PrescriptionItem[]; onClose: () => void; onSaved: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(NO_CATEGORY);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    if (!name.trim()) return setErr("Give it a name you’ll recognise next week.");
    setBusy(true); setErr(null);
    try {
      await api.rxFavourites.save({ name: name.trim(), items, category: category === NO_CATEGORY ? null : category, scope: shared ? "clinic" : "mine" });
      onSaved(name.trim());
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} title="Save as a favourite"
      sub={`Saves the ${items.length} line${items.length === 1 ? "" : "s"}, not this guest. Every field stays editable each time you use it.`}
      footer={<>
        {err && <span className="dz-error mr-auto">{err}</span>}
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={busy}><Star />{busy ? "Saving…" : "Save favourite"}</Btn>
      </>}>
      <div className="dz-stack">
        <In label="Name" value={name} onChange={setName} placeholder="Acne — moderate, first visit" />
        <Sel label="Category" value={category} onChange={setCategory} options={[NO_CATEGORY, ...RX_CATEGORIES]} />
        <Switch label="Share with every dermatologist" sub="For a protocol the centre has agreed. It stays yours to edit." on={shared} onChange={setShared} />
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- builder */

export default function RxBuilder({ rx, setRx, locked, branchId }: {
  rx: PrescriptionItem[];
  setRx: (next: PrescriptionItem[]) => void;
  locked: boolean;
  /** Scopes the stock search to the centre the dermatologist is sitting in. */
  branchId?: string | null;
}) {
  const { toast } = useStore();
  const [shelf, setShelf] = useState<"search" | "favourites" | "recent">("search");
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const [editing, setEditing] = useState<number | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const favourites = useApi(() => api.rxFavourites.list().then((r) => r.data ?? []).catch(() => [] as RxFavourite[]), []);
  const recent = useApi(() => api.rxFavourites.recent().then((r) => r.data ?? []).catch(() => [] as RxRecentItem[]), []);
  const results = useApi(
    () => (search.trim().length >= 2
      ? api.productAvailability.list({ search: search.trim(), limit: 10, ...(branchId ? { branchId } : {}) }).then((r) => r.data ?? []).catch(() => [])
      : Promise.resolve([] as ProductAvailability[])),
    [search, branchId],
  );

  const add = (item: PrescriptionItem, openEditor = false) => {
    const next = [...rx, item];
    setRx(next);
    toast(`Added ${item.medicine}`);
    if (openEditor) setEditing(next.length - 1);
  };

  const addFavourite = (f: RxFavourite) => {
    setRx([...rx, ...f.items.map((i) => ({ ...i }))]);
    toast(`Added ${f.items.length} line${f.items.length === 1 ? "" : "s"} from ${f.name}`);
    void api.rxFavourites.markUsed(f._id);
  };

  /** A product carries its id and the stock at the moment of prescribing — quantity only, never a price. */
  const fromProduct = (p: ProductAvailability): PrescriptionItem => ({
    medicine: p.name,
    formulation: p.formulation ?? null,
    isScheduleH: p.isRx === true,
    productId: p.source === "product" ? p._id : null,
    availableQuantity: p.quantity,
  });

  const freeText = () => { if (!q.trim()) return; add({ medicine: q.trim(), isScheduleH: false }, true); setQ(""); };
  const favs = favourites.data ?? [];

  return (
    <div className="dz-stack">
      <div data-tour="rx">
        <Panel icon={<Pill />} title="This prescription"
          sub={rx.length ? `${rx.length} medicine${rx.length === 1 ? "" : "s"}${locked ? "" : " · tap a line to change it"}` : "Nothing added yet"}
          right={!locked && rx.length > 0 ? <Btn kind="secondary" size="sm" onClick={() => setSaveOpen(true)}><Star />Save as favourite</Btn> : undefined}>
          {rx.length === 0 ? (
            <div className="dz-hint">{locked ? "No medicines were prescribed." : "Search the stock, or add a favourite or something you prescribe often — below."}</div>
          ) : (
            <div className="dz-list">
              {rx.map((m, i) => (
                <button key={i} type="button" className="dz-rx-item" disabled={locked} onClick={() => setEditing(i)}>
                  <span className="dz-rx-icon"><Pill /></span>
                  <span className="min-w-0">
                    <span className="dz-rx-item__name">{m.medicine}{m.isScheduleH && <span className="dz-pill dz-pill--sm dz-pill--warn">Schedule H</span>}</span>
                    <span className="dz-rx-sig">{rxSummary(m) || <em>Tap to set the dose and duration</em>}</span>
                    {m.instructions && <span className="dz-rx-note">{m.instructions}</span>}
                  </span>
                  {!locked && <span className="dz-rx-edit">Edit</span>}
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {!locked && (
        <Panel icon={<Plus />} title="Add medicines">
          <Segmented block value={shelf} onChange={setShelf} options={[
            { key: "search", label: "Search stock", icon: <Search /> },
            { key: "favourites", label: "Favourites", icon: <Star />, count: favs.length || undefined },
            { key: "recent", label: "Often used", icon: <History /> },
          ]} />

          <div className="mt-4">
            {shelf === "search" && (
              <div className="dz-stack--sm">
                <div className="dz-searchbox">
                  <Search />
                  <input className="dz-input" value={q} onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") freeText(); }}
                    placeholder="Tretinoin, sunscreen, biotin…" />
                </div>
                {search.trim().length < 2 && <div className="dz-hint">Type two letters to search what this centre holds. Anything not in stock can still be added as free text.</div>}
                {q.trim().length >= 2 && (
                  <button type="button" className="dz-result" onClick={freeText}>
                    <span className="dz-result__txt"><b>Add “{q.trim()}”</b><small>As free text — not linked to stock</small></span>
                    <span className="dz-result__add"><Plus /></span>
                  </button>
                )}
                {(results.data ?? []).map((p) => (
                  <button key={`${p.source}-${p._id}`} type="button" className="dz-result" onClick={() => { add(fromProduct(p), true); setQ(""); }}>
                    <span className="dz-result__txt">
                      <b>{p.name}</b>
                      <small>{[p.formulation, p.brand, p.category].filter(Boolean).join(" · ") || "Product"}</small>
                    </span>
                    <span className="dz-result__side">
                      {p.isRx && <Tag kind="warn">Rx</Tag>}
                      <StockPill status={p.status} qty={p.quantity} />
                      <span className="dz-result__add"><Plus /></span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {shelf === "favourites" && (
              favs.length === 0 ? (
                <Empty icon={<Star />} title="No favourites yet" hint="Write a prescription, then tap “Save as favourite”. It appears here for one tap next time." />
              ) : (
                <div className="dz-cards">
                  {favs.map((f) => (
                    <div key={f._id} className="dz-fav">
                      <div className="dz-fav__name">
                        {f.name}
                        {f.scope === "clinic" && <Tag kind="info">{f.mine ? "Shared" : `by ${f.ownerName ?? "the clinic"}`}</Tag>}
                      </div>
                      {f.category && <div className="dz-hint">{f.category}</div>}
                      <ul>
                        {f.items.slice(0, 4).map((i, j) => <li key={j}>{i.medicine}{rxSummary(i) ? ` — ${rxSummary(i)}` : ""}</li>)}
                        {f.items.length > 4 && <li className="dz-muted">+{f.items.length - 4} more</li>}
                      </ul>
                      <div className="dz-row mt-1">
                        <Btn size="sm" onClick={() => addFavourite(f)}><Plus />Add all</Btn>
                        {f.mine && (
                          <button type="button" className="dz-iconbtn dz-iconbtn--plain" aria-label={`Delete ${f.name}`}
                            onClick={() => api.rxFavourites.remove(f._id).then(() => { favourites.reload(); toast(`Removed ${f.name}`); }).catch((e) => toast((e as Error).message))}>
                            <Trash2 />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {shelf === "recent" && (
              (recent.data ?? []).length === 0 ? (
                <Empty icon={<History />} title="Nothing here yet" hint="The medicines you prescribe most collect here, with the dose you last used." />
              ) : (
                <div className="dz-stack--sm">
                  {(recent.data ?? []).map((r, i) => (
                    <button key={i} type="button" className="dz-result" onClick={() => add({ ...r, uses: undefined } as PrescriptionItem)}>
                      <span className="dz-result__txt"><b>{r.medicine}</b><small>{rxSummary(r) || "No dose set"} · used {r.uses} times</small></span>
                      <span className="dz-result__add"><Plus /></span>
                    </button>
                  ))}
                </div>
              )
            )}
          </div>
        </Panel>
      )}

      {editing !== null && rx[editing] && (
        <RxItemEditor
          item={rx[editing]}
          onClose={() => setEditing(null)}
          onRemove={() => { setRx(rx.filter((_, j) => j !== editing)); setEditing(null); }}
          onSave={(v) => { setRx(rx.map((x, j) => (j === editing ? v : x))); setEditing(null); }}
        />
      )}
      {saveOpen && (
        <SaveFavourite items={rx} onClose={() => setSaveOpen(false)}
          onSaved={(name) => { setSaveOpen(false); favourites.reload(); setShelf("favourites"); toast(`Saved “${name}”`); }} />
      )}
    </div>
  );
}
