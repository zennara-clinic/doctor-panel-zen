import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, PenLine, Smartphone, Tablet, UserRound } from "lucide-react";
import api from "./lib/api";
import type {
  FormOrigin, IntakeState, IntakeSummary, PreConsultForm, PreConsultSchema, PreConsultSchemaField, PreConsultSchemaStep, User,
} from "./lib/types";
import { fmtDate, fmtDateTime, guestCodeOf, isoDay } from "./lib/format";
import { ApiError } from "./lib/http";
import { useApi } from "./lib/useApi";
import { useStore } from "./store";
import { Btn, Loading, Modal, Tag } from "./ui";

/**
 * One pre-consult form, read in full.
 *
 * The panel used to show a guest's forms only as table rows — a date, the
 * words "Pre-consult form" and a status — with no way to open them. The
 * answers were readable in exactly one place, the consultation screen, and
 * only for a form attached to that appointment. A guest who filled the form on
 * the front-desk tablet has no appointment attached to it, so their answers
 * were unreachable everywhere. This is the view that fixes that; it is used
 * from the patient record and from the consultation.
 *
 * It is read-only on purpose. A form is what the guest attested to and signed;
 * the clinic's own reading of it belongs in the consultation note, not on top
 * of the patient's words.
 */

const on = (v: unknown) => v === true;

/* ------------------------------------------------------------- provenance */

/**
 * One sentence saying where a form's answers came from:
 *   "Filled in the app on 3 Sep 2026"
 *   "Filled on the walk-in tablet on 3 Sep 2026"
 *   "Digitised from the paper form dated 12 Mar 2023 by Dr Rickson"
 * Returns null when the record carries no origin stamp, so callers can leave
 * the line out rather than guess.
 */
export function originSentence(origin: FormOrigin | null | undefined, fallbackDate?: string | null): string | null {
  if (!origin) return null;
  const when = origin.enteredAt || fallbackDate;
  const onDate = when ? ` on ${fmtDate(when)}` : "";
  const by = origin.enteredBy?.name ? ` by ${origin.enteredBy.name}` : "";
  let text: string;
  if (origin.capturedOn === "paper") {
    text = `Digitised from the paper form${origin.paperDate ? ` dated ${fmtDate(origin.paperDate)}` : ""}${by}${by || !when ? "" : onDate}`;
  } else if (origin.channel === "app") {
    text = `Filled in the app${onDate}`;
  } else if (origin.channel === "walkin") {
    text = `Filled on the walk-in tablet${onDate}`;
  } else {
    text = `Entered at the clinic${by}${onDate}`;
  }
  return origin.inferred ? `${text} (worked out from the record)` : text;
}

const ORIGIN_ICON: Record<string, ReactNode> = {
  paper: <PenLine />, app: <Smartphone />, walkin: <Tablet />, staff: <UserRound />,
};

/** The provenance line at the top of a form, read in full. Nothing when the API has not stamped it. */
export function OriginBanner({ form }: { form: Pick<PreConsultForm, "origin" | "createdAt"> }) {
  const text = originSentence(form.origin, form.createdAt);
  if (!text) return null;
  const key = form.origin?.capturedOn === "paper" ? "paper" : form.origin?.channel ?? "staff";
  return (
    <div className="dz-note dz-note--info mb-4" role="note">
      {ORIGIN_ICON[key] ?? <UserRound />}
      <span>
        {text}
        {form.origin?.capturedOn === "paper" && form.origin.signatureOnPaper && " · signed on the paper copy"}
      </span>
    </div>
  );
}

const INTAKE_TAG: Record<IntakeState, { label: string; cls: string }> = {
  digital: { label: "Digital", cls: "dz-pill--ok" },
  paper: { label: "On paper", cls: "dz-pill--info" },
  none: { label: "Not yet", cls: "dz-pill--off" },
};

/** Digital / On paper / Not yet — the three-state intake tag on a guest row. */
export function IntakeTag({ intake, state }: { intake?: IntakeSummary | null; state?: IntakeState | null }) {
  const key = state ?? intake?.state;
  if (!key || !INTAKE_TAG[key]) return null;
  const t = INTAKE_TAG[key];
  return <span className={`dz-pill dz-pill--sm ${t.cls}`} title={intake?.label ?? undefined}>{t.label}</span>;
}

/** The chosen entries of a `{ label: boolean }` block, in the record's order. */
export function chosenLabels(block: Record<string, unknown> | undefined): string[] {
  return Object.entries(block ?? {})
    .filter(([, v]) => on(v))
    .map(([k]) => humanise(k));
}

/** `hairFallThinning` → `Hair fall thinning`; already-spaced labels pass through. */
function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function Row({ k, v }: { k: string; v?: unknown }) {
  const text = v === null || v === undefined || v === "" ? "" : String(v);
  if (!text.trim()) return null;
  return (
    <div className="flex gap-2 border-b border-border py-2.5 last:border-0">
      <span className="w-[42%] shrink-0 text-ink3">{k}</span>
      <span className="flex-1 whitespace-pre-wrap text-ink2">{text}</span>
    </div>
  );
}

/** A block of questions, hidden entirely when the guest answered none of it. */
function Block({ t, children, empty }: { t: string; children: React.ReactNode; empty?: boolean }) {
  if (empty) return null;
  return (
    <div className="mt-6">
      <div className="mb-1.5 text-[13.5px] font-extrabold text-ink">{t}</div>
      {children}
    </div>
  );
}

const yesNo = (b: Record<string, unknown> | undefined, key: string) => {
  const block = b?.[key] as { used?: boolean; visited?: boolean; had?: boolean; details?: string } | undefined;
  if (!block) return null;
  const yes = on(block.used) || on(block.visited) || on(block.had);
  return `${yes ? "Yes" : "No"}${yes && block.details ? ` — ${block.details}` : ""}`;
};

export function PreConsultBody({ form }: { form: PreConsultForm }) {
  const guest = typeof form.userId === "object" ? (form.userId as User) : null;
  const routine = Object.entries(form.dailyRoutine ?? {}).filter(([, v]) => v && String(v).trim());
  const medical = Object.entries(form.medicalHistory ?? {})
    // `thyroidDisorder` duplicates `thyroid`; menstrual history is its own row.
    .filter(([k, v]) => k !== "menstrualHistory" && k !== "thyroidDisorder" && on(v))
    .map(([k]) => humanise(k));
  const menstrual = String((form.medicalHistory ?? {}).menstrualHistory ?? "");
  const reasons = chosenLabels(form.reasonForVisit);
  const skin = chosenLabels(form.skinConcerns);
  const hair = chosenLabels(form.hairConcerns as Record<string, unknown>);
  const hairOther = (form.hairConcerns as Record<string, unknown> | undefined)?.others;
  const allergy = form.drugAllergies && !/^none/i.test(form.drugAllergies) ? form.drugAllergies : null;

  return (
    <div className="text-[14px] leading-relaxed">
      <OriginBanner form={form} />
      <div className="flex flex-wrap items-center gap-2">
        <Tag kind={form.status === "Approved" || form.status === "Reviewed" ? "ok" : form.status === "Rejected" ? "err" : "warn"}>{form.status}</Tag>
        <span className="text-ink3">Visit {fmtDate(form.dateOfVisit || form.createdAt)}</span>
        {guestCodeOf(guest) && <span className="font-mono text-[10.5px] text-ink3">{guestCodeOf(guest)}</span>}
      </div>

      <Block t="The guest">
        <Row k="Name" v={form.name ?? guest?.fullName} />
        <Row k="Date of birth" v={form.dateOfBirth ? fmtDate(form.dateOfBirth) : ""} />
        <Row k="Gender" v={form.gender} />
        <Row k="Marital status" v={form.maritalStatus} />
        {/* 0 is the model default, not an answer — only show a real count. */}
        <Row k="Children" v={form.numberOfChildren ? form.numberOfChildren : ""} />
        <Row k="Planning pregnancy" v={form.planningForPregnancy ? "Yes" : ""} />
        <Row k="LMP" v={form.lastMenstrualPeriod ? fmtDate(form.lastMenstrualPeriod) : ""} />
        <Row k="Heard about Zennara" v={form.referralSource} />
        <Row k="Referred by" v={form.referredBy} />
      </Block>

      <Block t="Reason for visit" empty={!reasons.length && !skin.length && !hair.length && !hairOther}>
        <Row k="Here for" v={reasons.join(", ")} />
        <Row k="Skin concerns" v={skin.join(", ")} />
        <Row k="Hair concerns" v={hair.filter((h) => h !== "Others").join(", ")} />
        <Row k="Other concerns" v={hairOther} />
      </Block>

      <Block
        t="Presenting complaint"
        empty={!form.symptomDuration && !form.previousTreatments && !form.currentMedications && !form.patientNotes
          && (!form.pregnancyStatus || form.pregnancyStatus === "not_applicable")}
      >
        <Row k="Going on for" v={form.symptomDuration} />
        <Row k="Already tried" v={form.previousTreatments} />
        <Row k="Currently taking" v={form.currentMedications} />
        {form.pregnancyStatus && form.pregnancyStatus !== "not_applicable" && (
          <div className="flex gap-2 border-b border-border py-2.5">
            <span className="w-[42%] shrink-0 text-ink3">Pregnancy</span>
            {/* Load-bearing: most lasers and peels and several drugs are
                contraindicated in pregnancy, so it reads as a warning. */}
            <span className="flex-1 font-semibold text-err">{humanise(form.pregnancyStatus)}</span>
          </div>
        )}
        <Row k="Anything else" v={form.patientNotes} />
      </Block>

      <Block t="Allergies & medical history" empty={!allergy && !form.otherAllergies && !medical.length && !menstrual}>
        <div className="flex gap-2 border-b border-border py-2.5">
          <span className="w-[42%] shrink-0 text-ink3">Drug allergies</span>
          <span className={`flex-1 ${allergy ? "font-semibold text-err" : "text-ink2"}`}>{allergy ?? "None reported"}</span>
        </div>
        <Row k="Other allergies" v={form.otherAllergies} />
        <Row k="Conditions" v={medical.join(", ")} />
        <Row k="Menstrual history" v={menstrual && menstrual !== "N/A" ? menstrual : ""} />
      </Block>

      <Block t="Daily routine" empty={!routine.length && !form.diet?.type}>
        {routine.map(([k, v]) => <Row key={k} k={humanise(k)} v={v} />)}
        <Row k="Diet" v={form.diet?.type} />
        <Row k="Water intake" v={form.diet?.waterIntakeLiters ? `${form.diet.waterIntakeLiters} litres/day` : ""} />
      </Block>

      <Block t="Recent activity" empty={!form.additionalInfo || !Object.keys(form.additionalInfo).length}>
        <Row k="New skincare this week" v={yesNo(form.additionalInfo, "newSkincareProducts")} />
        <Row k="Salon visit this week" v={yesNo(form.additionalInfo, "recentSalonVisit")} />
        <Row k="Past treatments / surgery" v={yesNo(form.additionalInfo, "pastTreatmentsSurgeries")} />
      </Block>

      {!!(form.photos ?? []).length && (
        <Block t="Photos the guest attached">
          <div className="flex flex-wrap gap-1.5 pt-1">
            {(form.photos ?? []).map((ph, i) => (
              <a key={i} href={ph.url} target="_blank" rel="noreferrer">
                <img src={ph.url} alt={ph.caption || "Guest photo"} className="h-24 w-24 rounded-xl border border-border object-cover" />
              </a>
            ))}
          </div>
        </Block>
      )}

      <Block t="Declaration">
        <Row k="Consent given" v={form.healthDataConsent?.accepted ? "Yes — health data consent (DPDPA 2023)" : "Not recorded"} />
        <Row k="Signed" v={form.clientSignature ? (form.clientSignature.split("|")[0] || "Signed") : ""} />
        <Row k="Submitted" v={form.createdAt ? fmtDateTime(form.createdAt) : ""} />
        <Row k="Dermatologist" v={form.doctorName} />
      </Block>
    </div>
  );
}

/** The same, in a modal — what the patient record and the consultation open. */
export function PreConsultModal({ form, open, onClose }: { form: PreConsultForm | null; open: boolean; onClose: () => void }) {
  if (!form) return null;
  return (
    <Modal open={open} onClose={onClose} title="Pre-consult form" wide>
      <PreConsultBody form={form} />
    </Modal>
  );
}

/* ===================================================== digitise a paper form */

type Values = Record<string, unknown>;
type FieldErrors = Record<string, string>;

function readPath(obj: Record<string, unknown> | undefined, key: string): unknown {
  if (!obj) return undefined;
  if (key in obj) return obj[key];
  return key.split(".").reduce<unknown>((acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined), obj);
}

/** Server `fieldErrors` arrive as `{ key: message }` or `[{ field | key, message }]`. */
function normaliseFieldErrors(raw: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (Array.isArray(raw)) {
    for (const e of raw) {
      const key = (e?.field ?? e?.key ?? e?.path) as string | undefined;
      if (key) out[key] = String(e?.message ?? e?.msg ?? "Check this answer");
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : String((v as { message?: string })?.message ?? "Check this answer");
    }
  }
  return out;
}

function isVisible(f: PreConsultSchemaField, values: Values): boolean {
  if (!f.showIf) return true;
  const v = values[f.showIf.key];
  if (Array.isArray(v)) return v.includes(f.showIf.equals);
  return v === f.showIf.equals;
}

const isBlank = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** A schema field rendered with this panel's primitives — large targets, no hover-only state. */
function Field({ f, value, error, onChange }: { f: PreConsultSchemaField; value: unknown; error?: string; onChange: (v: unknown) => void }) {
  const label = (
    <label className="dz-label">
      <span>{f.label}{f.required && <span className="text-err"> *</span>}</span>
      {f.maxLength && typeof value === "string" && value.length > 0 && <span className="dz-hint">{value.length}/{f.maxLength}</span>}
    </label>
  );
  const foot = error ? <div className="dz-error">{error}</div> : f.hint ? <div className="dz-hint">{f.hint}</div> : null;
  const str = value === undefined || value === null ? "" : String(value);

  switch (f.type) {
    case "textarea":
      return (
        <div className="dz-field col-span-full">{label}
          <textarea className="dz-textarea" rows={3} value={str} maxLength={f.maxLength} onChange={(e) => onChange(e.target.value)} />
          {foot}
        </div>
      );
    case "select":
      return (
        <div className="dz-field">{label}
          <select className="dz-select" value={str} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {foot}
        </div>
      );
    case "chips": {
      return (
        <div className="dz-field col-span-full">{label}
          <div className="dz-chips">
            {(f.options ?? []).map((o) => {
              const isOn = str === o.value;
              return (
                <button key={o.value} type="button" className={`dz-chip ${isOn ? "is-on" : ""}`} aria-pressed={isOn}
                  onClick={() => onChange(isOn ? "" : o.value)}>{isOn && <Check />}{o.label}</button>
              );
            })}
          </div>
          {foot}
        </div>
      );
    }
    case "multichips": {
      const chosen = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="dz-field col-span-full">{label}
          <div className="dz-chips">
            {(f.options ?? []).map((o) => {
              const isOn = chosen.includes(o.value);
              return (
                <button key={o.value} type="button" className={`dz-chip ${isOn ? "is-on" : ""}`} aria-pressed={isOn}
                  onClick={() => onChange(isOn ? chosen.filter((c) => c !== o.value) : [...chosen, o.value])}>{isOn && <Check />}{o.label}</button>
              );
            })}
          </div>
          {foot}
        </div>
      );
    }
    case "yesno": {
      const v = value === true ? true : value === false ? false : null;
      return (
        <div className="dz-field">{label}
          <div className="dz-chips" role="radiogroup" aria-label={f.label}>
            {([["Yes", true], ["No", false]] as const).map(([text, val]) => (
              <button key={text} type="button" role="radio" aria-checked={v === val} className={`dz-chip ${v === val ? "is-on" : ""}`}
                onClick={() => onChange(v === val ? null : val)}>{v === val && <Check />}{text}</button>
            ))}
          </div>
          {foot}
        </div>
      );
    }
    case "boolean": {
      const isOn = value === true;
      return (
        <div className="dz-field">
          <button type="button" role="switch" aria-checked={isOn} className="dz-switch" style={{ width: "100%", cursor: "pointer", font: "inherit", textAlign: "left" }}
            onClick={() => onChange(!isOn)}>
            <span className="min-w-0"><b>{f.label}{f.required && <span className="text-err"> *</span>}</b>{f.hint && <small>{f.hint}</small>}</span>
            <span className={`dz-toggle ${isOn ? "is-on" : ""}`} aria-hidden="true" />
          </button>
          {error && <div className="dz-error">{error}</div>}
        </div>
      );
    }
    default: {
      const type = f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "number" ? "number" : "text";
      return (
        <div className="dz-field">{label}
          <input className="dz-input" type={type} value={str} maxLength={f.maxLength} inputMode={f.type === "number" ? "decimal" : undefined}
            max={f.type === "date" ? isoDay() : undefined} onChange={(e) => onChange(e.target.value)} />
          {foot}
        </div>
      );
    }
  }
}

/**
 * Type the paper pre-consult form a dermatologist is holding into a digital
 * record for one of their own guests. The steps and fields come from the API
 * (`GET /pre-consult-forms/admin/schema`) so the editor never drifts from what
 * the app and the walk-in tablet ask; the panel only knows how to draw them.
 *
 * Tablet-first: chips and yes/no pairs are 44px targets, nothing depends on
 * hover, and the step strip is tappable so a half-filled paper form can be
 * entered in any order.
 */
export function DigitisePreConsultModal({ userId, guestName, open, onClose, onDone, replace = false }: {
  userId: string; guestName?: string | null; open: boolean; onClose: () => void;
  /** Called after the digital copy is saved — reload the form and the intake status. */
  onDone: (saved: { _id: string }) => void;
  /** Start in replace mode: the guest already has a digital form and this one supersedes it. */
  replace?: boolean;
}) {
  const { toast } = useStore();
  const schema = useApi<PreConsultSchema | null>(() => (open ? api.preConsult.schema() : Promise.resolve(null)), [open]);
  const steps: PreConsultSchemaStep[] = useMemo(() => (schema.data?.steps ?? []).filter((s) => s.fields?.length), [schema.data]);

  const [values, setValues] = useState<Values>({});
  const [paperDate, setPaperDate] = useState(isoDay());
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [topError, setTopError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{ formId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Fresh sheet each time the editor opens; seed from the schema's `empty` shape.
  useEffect(() => {
    if (!open) return;
    setPaperDate(isoDay()); setNotes(""); setStep(0); setErrors({}); setTopError(null); setConflict(null); setDirty(false);
  }, [open]);
  useEffect(() => {
    if (!schema.data) return;
    const seed: Values = {};
    for (const s of schema.data.steps ?? []) for (const f of s.fields ?? []) {
      const v = readPath(schema.data.empty, f.key);
      seed[f.key] = v !== undefined ? v : f.type === "multichips" ? [] : f.type === "boolean" ? false : f.type === "yesno" ? null : "";
    }
    setValues(seed);
  }, [schema.data]);

  const set = (key: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setDirty(true);
    if (errors[key]) setErrors((e) => { const n = { ...e }; delete n[key]; return n; });
  };

  const close = () => {
    if (busy) return;
    if (dirty && !window.confirm("Discard what you have entered so far?")) return;
    onClose();
  };

  const stepOfKey = (key: string) => steps.findIndex((s) => s.fields.some((f) => f.key === key));

  /** Required fields that are visible and blank, plus the paper date. */
  const clientCheck = (): FieldErrors => {
    const out: FieldErrors = {};
    for (const s of steps) for (const f of s.fields) {
      if (f.required && isVisible(f, values) && isBlank(values[f.key])) out[f.key] = "Needed to save the form";
      if (f.maxLength && typeof values[f.key] === "string" && (values[f.key] as string).length > f.maxLength) out[f.key] = `Keep this under ${f.maxLength} characters`;
    }
    return out;
  };

  const jumpToFirst = (errs: FieldErrors) => {
    const idx = Object.keys(errs).map(stepOfKey).filter((i) => i >= 0).sort((a, b) => a - b)[0];
    if (idx !== undefined) setStep(idx);
  };

  const payloadValues = (): Values => {
    const out: Values = {};
    for (const s of steps) for (const f of s.fields) {
      if (!isVisible(f, values)) continue;
      const v = values[f.key];
      if (f.type === "number") out[f.key] = isBlank(v) ? null : Number(v);
      else out[f.key] = v;
    }
    return out;
  };

  const save = async (replaceExisting: boolean) => {
    setTopError(null);
    if (!paperDate) { setTopError("Enter the date written on the paper form."); return; }
    if (paperDate > isoDay()) { setTopError("The paper form cannot be dated in the future."); return; }
    const errs = clientCheck();
    if (Object.keys(errs).length) { setErrors(errs); jumpToFirst(errs); setTopError("A few required answers are missing — they are marked on the steps."); return; }
    setBusy(true);
    try {
      const res = await api.preConsult.digitise(userId, { values: payloadValues(), paperDate, notes: notes.trim() || undefined, replace: replaceExisting || undefined });
      const saved = res.data;
      toast(replaceExisting ? "Paper form digitised — it replaces the earlier digital copy" : "Paper form digitised");
      setDirty(false);
      onDone({ _id: saved?._id ?? "" });
      onClose();
    } catch (e) {
      if (e instanceof ApiError) {
        const payload = (e.payload ?? {}) as { code?: string; fieldErrors?: unknown; data?: { formId?: string }; message?: string };
        if (e.status === 400 && (e.code === "FORM_VALIDATION_FAILED" || payload.fieldErrors)) {
          const fe = normaliseFieldErrors(payload.fieldErrors);
          setErrors(fe); jumpToFirst(fe);
          setTopError(Object.keys(fe).length ? "Some answers need attention — they are marked below." : e.message);
        } else if (e.status === 409) {
          setConflict({ formId: payload.data?.formId });
        } else {
          setTopError(e.message);
        }
      } else {
        setTopError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;
  const current = steps[step];
  const errorSteps = new Set(Object.keys(errors).map(stepOfKey));
  const last = step >= steps.length - 1;

  const footer = (
    <div className="dz-row" style={{ width: "100%", justifyContent: "space-between" }}>
      <Btn kind="secondary" size="lg" disabled={busy || step === 0} onClick={() => setStep(step - 1)}><ChevronLeft />Back</Btn>
      <div className="dz-row">
        <Btn kind="plain" size="lg" disabled={busy} onClick={close}>Cancel</Btn>
        {last || !steps.length
          ? <Btn size="lg" disabled={busy || schema.initial || !steps.length} onClick={() => void save(replace)}>{busy ? "Saving…" : replace ? "Save and replace" : "Save the digital copy"}</Btn>
          : <Btn size="lg" disabled={busy} onClick={() => setStep(step + 1)}>Next<ChevronRight /></Btn>}
      </div>
    </div>
  );

  return (
    <Modal open={open} onClose={close} xl title={replace ? "Replace with the paper form" : "Enter the paper form"}
      sub={guestName ? `${guestName} · typed from the paper pre-consult form` : "Typed from the paper pre-consult form"} footer={footer}>
      <div className="dz-stack">
        <div className="dz-form-grid">
          <div className="dz-field">
            <label className="dz-label"><span>Paper form date<span className="text-err"> *</span></span></label>
            <input className="dz-input" type="date" value={paperDate} max={isoDay()} onChange={(e) => { setPaperDate(e.target.value); setDirty(true); }} />
            <div className="dz-hint">The date written on the paper, not today’s.</div>
          </div>
          <div className="dz-field">
            <label className="dz-label"><span>Notes</span></label>
            <input className="dz-input" value={notes} maxLength={500} placeholder="Anything about the paper copy — illegible answers, missing pages" onChange={(e) => { setNotes(e.target.value); setDirty(true); }} />
          </div>
        </div>

        {conflict && (
          <div className="dz-note dz-note--warn" role="alert">
            <AlertTriangle />
            <span className="flex-1">
              This guest already has a digital pre-consult form. Saving again would replace it with what you have typed here.
              <div className="dz-row mt-2">
                <Btn kind="secondary" size="sm" disabled={busy} onClick={() => { setConflict(null); void save(true); }}>Replace the digital form</Btn>
                <Btn kind="plain" size="sm" disabled={busy} onClick={() => setConflict(null)}>Keep the existing one</Btn>
              </div>
            </span>
          </div>
        )}
        {topError && !conflict && <div className="dz-note dz-note--err" role="alert"><AlertTriangle /><span>{topError}</span></div>}

        {schema.initial ? <Loading label="Loading the form…" rows={4} />
          : schema.error ? (
            <div className="dz-note dz-note--err"><AlertTriangle /><span className="flex-1">Couldn’t load the form layout — {schema.error}</span>
              <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" onClick={schema.reload}>Retry</button></div>
          ) : !steps.length ? <div className="dz-hint">The form layout is empty — nothing to enter.</div> : (
            <>
              <div className="dz-steps" style={{ ["--n" as string]: Math.min(steps.length, 6) }}>
                {steps.map((s, i) => (
                  <button key={s.key} type="button" className={`dz-step ${i === step ? "is-on" : ""} ${i < step && !errorSteps.has(i) ? "is-done" : ""}`}
                    onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined}>
                    <span className="dz-step__n">{errorSteps.has(i) ? <AlertTriangle /> : i < step ? <Check /> : i + 1}</span>
                    <span className="dz-step__txt"><b>{s.title}</b><span>{errorSteps.has(i) ? "Needs attention" : `${s.fields.filter((f) => isVisible(f, values) && !isBlank(values[f.key])).length} of ${s.fields.filter((f) => isVisible(f, values)).length} answered`}</span></span>
                  </button>
                ))}
              </div>
              {current && (
                <div className="dz-form-grid">
                  {current.fields.filter((f) => isVisible(f, values)).map((f) => (
                    <Field key={f.key} f={f} value={values[f.key]} error={errors[f.key]} onChange={(v) => set(f.key, v)} />
                  ))}
                </div>
              )}
            </>
          )}
      </div>
    </Modal>
  );
}
