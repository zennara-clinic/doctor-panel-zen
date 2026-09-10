import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardList, Download,
  FileSignature, FileText, History, Loader2, Mail, Minus, NotebookPen, Package, PenLine, Pencil, Pill, Play,
  Plus, Printer, Search, ShieldCheck, Sparkles, Stethoscope, Trash2, UserRound,
} from "lucide-react";
import api from "../lib/api";
import { useApi, useBookingUpdates, useDebounced } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import { useStore } from "../store";
import { useLifecycle } from "../lifecycle";
import { Btn, Empty, In, Loading, Modal, Note, Panel, Toggle } from "../ui";
import { DictField, appendSentence, useMic } from "../dictfield";
import RxBuilder, { rxSummary } from "../rx";
import { PhotoStudio } from "../photos";
import { PreConsultModal, chosenLabels } from "../preconsult";
import GuestPurchases from "../purchases";
import { VisitMenu, VisitStatus, useVisitRunner, visitTime } from "../visit";
import {
  addClinicDays, ageFrom, bookingServiceName, fmtAgo, fmtDate, fmtDateLong, fmtDateTime, idOf, initials, isoDay,
} from "../lib/format";
import type { Booking, ConsultationNote, Consultation, PackageAssignment, PreConsultForm, PrescriptionItem, User } from "../lib/types";
import logo from "../assets/zennara-logo.png";

/*
 * The consultation workspace.
 *
 * The reference panel's shape, on this panel's data: a bar that always says
 * who the guest is, what they are allergic to and where the visit has got to;
 * the guest's intake and history beside the note on a landscape tablet (a
 * "Guest" step in portrait); and the note itself as four steps —
 *
 *   Notes → Prescription → Photos → Sign & finish
 *
 * Status is never re-derived here. "Start" and "Check in & start" are the
 * server's lifecycle actions; signing saves the note as Completed (the server
 * checks prescriptions.sign) and, if the dermatologist leaves it on, checks the
 * guest out through the same lifecycle. The clinical stage follows on its own
 * — there are no stage buttons to remember.
 *
 * Saving: every save keeps a full revision on the server, so the draft is not
 * written on every keystroke. It saves when you change step, 20 seconds after
 * you stop typing, when you leave the screen, and when you tap Save.
 */

type Step = "guest" | "notes" | "rx" | "photos" | "sign";
type Assigned = { serviceId?: string; packageId?: string; name: string; sessions?: number };
type Draft = {
  complaint: string; examination: string; assessment: string; plan: string;
  primaryDiagnosis: string; secondaryDiagnosis: string;
  skinCareAdvice: string; lifestyleAdvice: string; precautions: string;
  followUpDate: string; sketch: string | null;
  prescription: PrescriptionItem[]; assignedServices: Assigned[];
};
type TextKey = "complaint" | "examination" | "assessment" | "plan" | "skinCareAdvice" | "lifestyleAdvice" | "precautions";

const EMPTY: Draft = {
  complaint: "", examination: "", assessment: "", plan: "", primaryDiagnosis: "", secondaryDiagnosis: "",
  skinCareAdvice: "", lifestyleAdvice: "", precautions: "", followUpDate: "", sketch: null, prescription: [], assignedServices: [],
};

const fromNote = (n: ConsultationNote | null | undefined): Draft => !n ? EMPTY : ({
  complaint: n.complaint ?? "", examination: n.examination ?? "", assessment: n.assessment ?? "", plan: n.plan ?? "",
  primaryDiagnosis: n.primaryDiagnosis ?? "", secondaryDiagnosis: n.secondaryDiagnosis ?? "",
  skinCareAdvice: n.skinCareAdvice ?? "", lifestyleAdvice: n.lifestyleAdvice ?? "", precautions: n.precautions ?? "",
  followUpDate: n.followUpDate ? isoDay(new Date(n.followUpDate)) : "",
  sketch: n.sketch ?? null,
  prescription: n.prescription ?? [],
  assignedServices: (n.assignedServices ?? []).map((a) => ({
    serviceId: a.serviceId ? String(a.serviceId) : undefined,
    packageId: a.packageId ? String(a.packageId) : undefined,
    name: a.name, sessions: a.sessions,
  })),
});

const EXAM_CHIPS = [
  "Comedones over cheeks", "Inflammatory papules and pustules", "Post-inflammatory hyperpigmentation",
  "Epidermal melasma pattern", "Diffuse thinning over the crown", "Fitzpatrick type III", "Fitzpatrick type IV",
  "Fitzpatrick type V", "No scarring", "No active lesions",
];
const DIAGNOSIS_CHIPS = [
  "Acne vulgaris", "Melasma", "Post-inflammatory hyperpigmentation", "Androgenetic alopecia", "Telogen effluvium",
  "Seborrhoeic dermatitis", "Rosacea", "Atopic dermatitis", "Psoriasis", "Tinea", "Urticaria",
];
const PLAN_CHIPS = [
  "Continue current plan", "Start treatment series", "Patch test first", "Home care only",
  "Refer for procedure", "Repeat photos next visit",
];
const SKIN_ADVICE = ["Gentle cleanser twice daily", "Moisturise morning and night", "Sunscreen SPF 50, reapply every 3 hours", "Apply actives only at night", "Do not pick or squeeze"];
const LIFE_ADVICE = ["Drink 2 to 3 litres of water a day", "Cut down on sugar and dairy", "Sleep 7 to 8 hours", "Change pillow covers twice a week"];
const PRECAUTIONS = ["Avoid direct sun for 48 hours", "No waxing or threading on treated areas", "Pause retinoids 5 days before a procedure", "Stop and call the clinic if there is irritation"];
const FOLLOW_UPS: { key: string; label: string; days: number }[] = [
  { key: "2w", label: "2 weeks", days: 14 }, { key: "4w", label: "4 weeks", days: 28 }, { key: "6w", label: "6 weeks", days: 42 },
  { key: "8w", label: "8 weeks", days: 56 }, { key: "3m", label: "3 months", days: 90 },
];

function useNarrow() {
  const query = "(max-width: 1079px)";
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

/* ===================================================================== route */

export function Consult() {
  const loc = useLocation();
  const [sp] = useSearchParams();
  const fromState = (loc.state as { bookingId?: string } | null)?.bookingId;
  const bookingId = sp.get("booking");
  // Older links carried the booking in router state, which does not survive a reload.
  if (!bookingId && fromState) return <Navigate to={`/dermatologist/consultation?booking=${fromState}`} replace />;
  if (!bookingId) return <Navigate to="/dermatologist/my-day" replace />;
  return <Workspace key={bookingId} bookingId={bookingId} />;
}

/* ================================================================= workspace */

function Workspace({ bookingId }: { bookingId: string }) {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { toast, audit, branchId, admin } = useStore();
  const me = useMyDoctor();
  const narrow = useNarrow();

  const booking = useApi(() => api.bookings.get(bookingId), [bookingId]);
  const life = useLifecycle(bookingId);
  const note = useApi(() => api.consultationNotes.forBooking(bookingId), [bookingId]);
  const bk = booking.data;
  const userId = bk ? idOf(bk.userId) : "";

  const patient = useApi(() => (userId ? api.patients.get(userId) : Promise.resolve(null)), [userId]);
  /*
   * The intake for this visit — failing that, the guest's newest one. A form
   * filled on the front-desk tablet has no booking attached, and it is still
   * the guest's intake; the card says which of the two it is showing.
   */
  const form = useApi(async () => {
    const forThisVisit = await api.preConsult.list({ bookingId, limit: 1 }).then((r) => (r.data ?? [])[0] ?? null).catch(() => null);
    if (forThisVisit) return { doc: forThisVisit, linked: true };
    if (!userId) return null;
    const latest = await api.preConsult.list({ userId, limit: 5 })
      .then((r) => (r.data ?? []).filter((f) => f.status !== "Draft")[0] ?? null).catch(() => null);
    return latest ? { doc: latest, linked: false } : null;
  }, [bookingId, userId]);
  const intake = useApi(() => api.preConsult.statusForBooking(bookingId).catch(() => null), [bookingId]);
  const consent = useApi(
    () => (userId ? api.consentForms.list({ userId, limit: 1 }).then((r) => (r.data ?? [])[0] ?? null).catch(() => null) : Promise.resolve(null)),
    [userId],
  );
  const history = useApi(async () => {
    if (!userId) return { notes: [] as ConsultationNote[], visits: [] as Booking[] | null };
    const [notes, visits] = await Promise.all([
      api.consultationNotes.list({ userId, limit: 50 }).then((r) => r.data ?? []).catch(() => [] as ConsultationNote[]),
      // Every practitioner's visits, not only this dermatologist's: a laser
      // session with a therapist last month is part of this guest's history.
      api.bookings.list({ userId, limit: 100 })
        .then((r) => (r.data ?? []).filter((b) => b._id !== bookingId && idOf(b.userId) === userId))
        .catch(() => null as Booking[] | null),
    ]);
    return { notes, visits };
  }, [userId, bookingId]);
  const guestPkgs = useApi(
    () => (userId ? api.packageAssignments.list({ userId, status: "Active", limit: 20 }).then((r) => r.data ?? []).catch(() => [] as PackageAssignment[]) : Promise.resolve([] as PackageAssignment[])),
    [userId],
  );
  const [photoNonce, setPhotoNonce] = useState(0);
  const visitPhotos = useApi(
    () => (userId ? api.patientPhotos.list({ userId, bookingId, limit: 200 }).then((r) => (r.data ?? []).filter((p) => idOf(p.bookingId) === bookingId).length).catch(() => 0) : Promise.resolve(0)),
    [userId, bookingId, photoNonce],
  );

  const reloadVisit = useCallback(() => { booking.reload(); void life.reload(); }, [booking.reload, life.reload]);
  // The desk checking the guest in appears here without a refresh.
  useBookingUpdates(reloadVisit);
  const runner = useVisitRunner(bk, reloadVisit);
  const mic = useMic((m) => toast(m));

  /* ------------------------------------------------------------- the draft */
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [editingSigned, setEditingSigned] = useState(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const noteRef = useRef(note.data); noteRef.current = note.data;
  const meRef = useRef(me.data); meRef.current = me.data;

  const signed = note.data?.status === "Completed";
  const locked = signed && !editingSigned;
  const lockedRef = useRef(locked); lockedRef.current = locked;

  // Prime from the server, but never over edits typed while a save was in flight.
  const noteKey = note.data === undefined ? "loading" : `${note.data?._id ?? "none"}:${note.data?.updatedAt ?? ""}`;
  useEffect(() => {
    if (note.data === undefined || dirtyRef.current) return;
    setDraft(fromNote(note.data));
  }, [noteKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (patch: Partial<Draft>) => { setDraft((d) => ({ ...d, ...patch })); setDirty(true); };
  const text = (k: TextKey) => (fn: (prev: string) => string) => { setDraft((d) => ({ ...d, [k]: fn(d[k]) })); setDirty(true); };

  const payload = (d: Draft, status: "Draft" | "Completed" | undefined) => ({
    bookingId,
    complaint: d.complaint, examination: d.examination, assessment: d.assessment, plan: d.plan,
    sketch: d.sketch ?? undefined, prescription: d.prescription, assignedServices: d.assignedServices,
    followUpDate: d.followUpDate || null,
    primaryDiagnosis: d.primaryDiagnosis, secondaryDiagnosis: d.secondaryDiagnosis,
    skinCareAdvice: d.skinCareAdvice, lifestyleAdvice: d.lifestyleAdvice, precautions: d.precautions,
    ...(status ? { status } : {}),
    // The booking's specialist owns the note; for a walk-in with none, the signed-in dermatologist does.
    doctorId: meRef.current?.doctorId, doctorName: meRef.current?.name,
  }) as Parameters<typeof api.consultationNotes.save>[0];

  const saveDraft = useCallback(async (quiet: boolean) => {
    if (!dirtyRef.current || lockedRef.current) return true;
    const snapshot = draftRef.current;
    setSaveState("saving");
    try {
      // A signed note is saved without a status, so the server decides whether
      // the change touched the prescription (and so revokes the signature).
      const saved = await api.consultationNotes.save(payload(snapshot, noteRef.current?.status === "Completed" ? undefined : "Draft"));
      if (draftRef.current === snapshot) setDirty(false);
      note.setData(saved);
      setSaveState("saved");
      if (!quiet) toast("Draft saved");
      return true;
    } catch (e) {
      setSaveState("error");
      toast(`Couldn’t save the draft — ${(e as Error).message}`);
      return false;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 20 seconds after the last edit.
  useEffect(() => {
    if (!dirty || locked) return;
    const t = window.setTimeout(() => { void saveDraft(true); }, 20000);
    return () => window.clearTimeout(t);
  }, [draft, dirty, locked, saveDraft]);
  // Leaving the screen.
  useEffect(() => () => { if (dirtyRef.current && !lockedRef.current) void saveDraft(true); }, [saveDraft]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /* ------------------------------------------------------------------ steps */
  const requested = (sp.get("step") as Step) || "notes";
  const step: Step = requested === "guest" && !narrow ? "notes" : requested;
  const goStep = (s: Step) => {
    if (dirtyRef.current && !lockedRef.current) void saveDraft(true);
    mic.stop();
    const next = new URLSearchParams(sp);
    next.set("step", s);
    setSp(next, { replace: true });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pbarRef = useRef<HTMLDivElement>(null);
  const [pbarH, setPbarH] = useState(80);
  useEffect(() => {
    const el = pbarRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPbarH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [bk?._id]);

  /* ------------------------------------------------------------------ guard */
  if (booking.initial && !bk) {
    return <div className="dz-page"><Loading label="Opening the consultation…" rows={5} /></div>;
  }
  if (!bk) {
    return (
      <div className="dz-page">
        <Empty icon={<Stethoscope />} title="Couldn’t open this consultation" hint={booking.error ?? "The appointment could not be found."}
          action={<Btn kind="secondary" onClick={() => nav("/dermatologist/my-day")}><ChevronLeft />Back to today</Btn>} />
      </div>
    );
  }

  const p = patient.data;
  const age = ageFrom(p?.dateOfBirth);
  const f = form.data?.doc ?? null;
  const doctorName = me.data?.name ?? admin?.name ?? "";

  const alerts: { text: string; tone: "err" | "warn" }[] = [];
  const drug = f?.drugAllergies && !/^none/i.test(f.drugAllergies) ? f.drugAllergies : p?.drugAllergies?.trim() || (p?.hasDrugAllergy ? "Drug allergy — details not recorded" : "");
  if (drug) alerts.push({ text: `Allergy: ${drug}`, tone: "err" });
  if (f?.otherAllergies && !/^none/i.test(f.otherAllergies)) alerts.push({ text: `Other allergy: ${f.otherAllergies}`, tone: "err" });
  if (f?.pregnancyStatus && ["pregnant", "breastfeeding", "planning"].includes(f.pregnancyStatus)) {
    alerts.push({ text: f.pregnancyStatus === "planning" ? "Planning a pregnancy" : f.pregnancyStatus === "pregnant" ? "Pregnant" : "Breastfeeding", tone: "err" });
  }
  if (f?.currentMedications && !/^(none|no|nil|na|n\/a)\.?$/i.test(f.currentMedications.trim())) alerts.push({ text: `Taking: ${f.currentMedications}`, tone: "warn" });

  const notesWritten = [draft.complaint, draft.examination, draft.primaryDiagnosis, draft.assessment, draft.plan].filter((x) => x.trim()).length;
  const photosCount = visitPhotos.data ?? 0;
  const status = bk.status;

  /* ------------------------------------------------------- primary action */
  let primary: ReactNode = null;
  if (status === "Checked In") {
    primary = <Btn onClick={() => runner.start(life.state)} disabled={runner.busy || !life.state}><Play />{runner.busy ? "Starting…" : "Start consultation"}</Btn>;
  } else if (["Confirmed", "Rescheduled", "No Show"].includes(status) && life.state?.actions.some((a) => a.action === "check_in")) {
    primary = <Btn onClick={() => runner.start(life.state)} disabled={runner.busy}><Play />{runner.busy ? "Starting…" : "Check in & start"}</Btn>;
  } else if (status === "In Progress" && signed && !editingSigned) {
    primary = <Btn kind="gold" disabled={runner.busy} onClick={() => runner.perform(() => runner.exec("complete"), "Visit completed — guest checked out")}><CheckCircle2 />Check out</Btn>;
  } else if ((status === "In Progress" || status === "Completed") && !signed && step !== "sign") {
    primary = <Btn kind="gold" onClick={() => goStep("sign")}><PenLine />{status === "Completed" ? "Sign note" : "Finish"}</Btn>;
  }

  const steps: { key: Step; label: string; hint: string; done: boolean; icon: ReactNode }[] = [
    ...(narrow ? [{ key: "guest" as Step, label: "Guest", hint: alerts.length ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"}` : "Intake & history", done: false, icon: <UserRound /> }] : []),
    { key: "notes", label: "Notes", hint: notesWritten ? `${notesWritten} of 5 written` : "Complaint, exam, diagnosis", done: notesWritten >= 3, icon: <NotebookPen /> },
    { key: "rx", label: "Prescription", hint: `${draft.prescription.length} medicine${draft.prescription.length === 1 ? "" : "s"} · ${draft.assignedServices.length} treatment${draft.assignedServices.length === 1 ? "" : "s"}`, done: draft.prescription.length + draft.assignedServices.length > 0, icon: <Pill /> },
    { key: "photos", label: "Photos", hint: photosCount ? `${photosCount} this visit` : "Before & after", done: photosCount > 0, icon: <Camera /> },
    { key: "sign", label: signed ? "Signed" : "Sign & finish", hint: signed ? fmtDate(note.data?.prescriptionSignedAt ?? note.data?.completedAt) : "Review and sign", done: signed, icon: <FileSignature /> },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  const prevStep = idx > 0 ? steps[idx - 1] : null;
  const nextStep = idx < steps.length - 1 ? steps[idx + 1] : null;

  const guest = (
    <GuestContext bk={bk} patient={p} form={form} consent={consent.data ?? null} history={history.data}
      paperIntake={intake.data?.state === "waived"}
      doctorName={doctorName} userId={userId}
      onOpenRecord={() => nav(`/dermatologist/patient?id=${userId}`, { state: { id: userId } })}
      onOpenVisit={(id) => nav(`/dermatologist/consultation?booking=${id}`)}
      onChanged={() => { form.reload(); consent.reload(); }}
      toast={toast} audit={audit} />
  );

  return (
    <>
      <div className="dz-pbar" ref={pbarRef}>
        <div className="dz-pbar__in">
          <button type="button" className="dz-iconbtn" onClick={() => nav("/dermatologist/my-day")} aria-label="Back to today"><ChevronLeft /></button>
          <div className="dz-pbar__who">
            <span className="dz-avatar dz-avatar--lg dz-avatar--sage">{initials(p?.fullName ?? bk.fullName)}</span>
            <div className="min-w-0">
              <div className="dz-pbar__name">{p?.fullName ?? bk.fullName}</div>
              <div className="dz-pbar__meta">
                {(age || p?.gender) && <span>{[age ? `${age} yrs` : null, p?.gender].filter(Boolean).join(" · ")}</span>}
                {p?.patientId && <span>ID {p.patientId}</span>}
                <span>{bookingServiceName(bk, "Visit")} · {visitTime(bk)}{bk.preferredLocation ? ` · ${bk.preferredLocation}` : ""}</span>
              </div>
            </div>
          </div>
          <div className="dz-pbar__actions" data-tour="visit-action">
            <span data-tour="save-state" className={`dz-save ${dirty ? "is-dirty" : saveState === "saved" ? "is-ok" : ""}`}>
              {locked ? <><ShieldCheck />Signed</>
                : saveState === "saving" ? <><Loader2 className="animate-spin" />Saving…</>
                : dirty ? <>Unsaved changes</>
                : saveState === "saved" ? <><Check />Saved</>
                : note.data ? <><Check />Draft saved</> : null}
            </span>
            <VisitStatus booking={bk} />
            {primary}
            <VisitMenu booking={bk} state={life.state} runner={runner} />
          </div>
        </div>
        {alerts.length > 0 && (
          <div className="dz-pbar__alerts">
            {alerts.map((a) => <span key={a.text} className={`dz-pill dz-pill--${a.tone}`}><AlertTriangle />{a.text.length > 70 ? `${a.text.slice(0, 68)}…` : a.text}</span>)}
          </div>
        )}
      </div>

      <div className="dz-consult" style={{ ["--pbar-h" as string]: `${pbarH}px` }}>
        <aside className="dz-consult__aside">{guest}</aside>

        <section className="dz-consult__main">
          <nav data-tour="steps" className="dz-steps" style={{ ["--n" as string]: steps.length }} aria-label="Consultation steps">
            {steps.map((s, i) => (
              <button key={s.key} type="button" className={`dz-step ${step === s.key ? "is-on" : ""} ${s.done && step !== s.key ? "is-done" : ""}`}
                onClick={() => goStep(s.key)} aria-current={step === s.key ? "step" : undefined}>
                <span className="dz-step__n">{s.done && step !== s.key ? <Check /> : narrow && s.key === "guest" ? <UserRound /> : narrow ? i : i + 1}</span>
                <span className="dz-step__txt"><b>{s.label}</b><span>{s.hint}</span></span>
              </button>
            ))}
          </nav>

          <div className="dz-stack">
            {runner.error && (
              <div className="dz-note dz-note--err"><AlertTriangle /><span className="flex-1">{runner.error}</span>
                <button type="button" className="dz-link" onClick={runner.clearError}>Dismiss</button></div>
            )}
            <VisitBanner bk={bk} signed={signed} editing={editingSigned} note={note.data ?? null}
              onEdit={() => setEditingSigned(true)} />

            {step === "guest" && guest}

            {step === "notes" && (
              <>
                <Panel icon={<ClipboardList />} title="What brings them in" sub="In the guest’s own words"
                  right={!locked && f && !draft.complaint.trim() ? (
                    <Btn kind="soft" size="sm" onClick={() => update({ complaint: intakeSummary(f) })}><ClipboardCheck />Use the pre-consult answers</Btn>
                  ) : undefined}>
                  <DictField k="complaint" label="Presenting complaint" value={draft.complaint} set={text("complaint")} mic={mic} rows={3}
                    disabled={locked} placeholder="e.g. Breakouts on both cheeks for three months, worse before periods" />
                </Panel>

                <Panel icon={<Search />} title="Examination">
                  <DictField k="examination" tour="dictate" label="Findings" value={draft.examination} set={text("examination")} mic={mic} rows={4}
                    disabled={locked} quick={EXAM_CHIPS} placeholder="Type, or tap Dictate and speak — distribution, Fitzpatrick type, dermoscopy…" />
                </Panel>

                <Panel icon={<Stethoscope />} title="Diagnosis" sub="Printed on the prescription">
                  <div className="dz-stack">
                    <div className="dz-form-grid">
                      <In label="Primary diagnosis" value={draft.primaryDiagnosis} readOnly={locked} onChange={(v) => update({ primaryDiagnosis: v })} placeholder="e.g. Acne vulgaris, grade 2" />
                      <In label="Secondary diagnosis" value={draft.secondaryDiagnosis} readOnly={locked} onChange={(v) => update({ secondaryDiagnosis: v })} placeholder="Optional" />
                    </div>
                    {!locked && (
                      <div className="dz-chips">
                        {DIAGNOSIS_CHIPS.map((d) => {
                          const on = draft.primaryDiagnosis === d || draft.secondaryDiagnosis === d;
                          return (
                            <button key={d} type="button" className={`dz-chip dz-chip--sm ${on ? "is-on" : ""}`}
                              onClick={() => {
                                if (draft.primaryDiagnosis === d) update({ primaryDiagnosis: "" });
                                else if (draft.secondaryDiagnosis === d) update({ secondaryDiagnosis: "" });
                                else if (!draft.primaryDiagnosis.trim()) update({ primaryDiagnosis: d });
                                else update({ secondaryDiagnosis: d });
                              }}>
                              {on ? <Check /> : <Plus />}{d}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Panel>

                <Panel icon={<NotebookPen />} title="Assessment and plan">
                  <div className="dz-stack">
                    <DictField k="assessment" label="Assessment" value={draft.assessment} set={text("assessment")} mic={mic} rows={3}
                      disabled={locked} placeholder="Your clinical impression" />
                    <DictField k="plan" label="Plan" value={draft.plan} set={text("plan")} mic={mic} rows={3}
                      disabled={locked} quick={PLAN_CHIPS} placeholder="Tap the phrases below, or dictate"
                      right={!locked ? <SketchButton sketch={draft.sketch} onSave={(s) => { update({ sketch: s }); toast("Sketch attached"); }} /> : undefined} />
                    {draft.sketch && (
                      <div className="dz-field">
                        <span className="dz-label">Sketch</span>
                        <img src={draft.sketch} alt="Consultation sketch" className="w-full max-w-[640px] rounded-2xl border border-border bg-surface" />
                      </div>
                    )}
                  </div>
                </Panel>
              </>
            )}

            {step === "rx" && (
              <>
                <RxBuilder rx={draft.prescription} setRx={(next) => update({ prescription: next })} locked={locked} branchId={branchId} />
                <TreatmentsPanel assigned={draft.assignedServices} locked={locked} packages={guestPkgs.data ?? []}
                  onChange={(next) => update({ assignedServices: next })} />
                <Panel icon={<Sparkles />} title="Advice for the guest" sub="Printed under the prescription">
                  <div className="dz-stack">
                    <DictField k="skin" label="Skin care" value={draft.skinCareAdvice} set={text("skinCareAdvice")} mic={mic} rows={2} disabled={locked} quick={SKIN_ADVICE} />
                    <DictField k="life" label="Diet and lifestyle" value={draft.lifestyleAdvice} set={text("lifestyleAdvice")} mic={mic} rows={2} disabled={locked} quick={LIFE_ADVICE} />
                    <DictField k="prec" label="Precautions" value={draft.precautions} set={text("precautions")} mic={mic} rows={2} disabled={locked} quick={PRECAUTIONS} />
                  </div>
                </Panel>
              </>
            )}

            {step === "photos" && (
              <Panel icon={<Camera />} title="Photos" sub="Tag each shot before, during or after — tap any photo to look closer or compare">
                <PhotoStudio userId={userId} bookingId={bookingId} onChanged={() => setPhotoNonce((n) => n + 1)} />
              </Panel>
            )}

            {step === "sign" && (
              <SignStep bk={bk} patient={p} form={f} draft={draft} note={note.data ?? null} signed={signed} editing={editingSigned}
                doctorName={doctorName} photosCount={photosCount} dirty={dirty}
                onGo={goStep} onSaveDraft={() => saveDraft(false)}
                onSigned={(saved) => { note.setData(saved); setDirty(false); setEditingSigned(false); setSaveState("idle"); }}
                runner={runner} reloadVisit={reloadVisit}
                onFollowUp={(date) => update({ followUpDate: date })} />
            )}
          </div>

          <div className="dz-actionbar">
            {prevStep ? <Btn kind="plain" onClick={() => goStep(prevStep.key)}><ChevronLeft />{prevStep.label}</Btn> : <span />}
            <span className="dz-spacer" />
            {!locked && dirty && <Btn kind="secondary" onClick={() => saveDraft(false)} disabled={saveState === "saving"}>Save draft</Btn>}
            {nextStep && <Btn onClick={() => goStep(nextStep.key)}>Next: {nextStep.label}<ChevronRight /></Btn>}
          </div>
        </section>
      </div>
      {runner.dialog}
    </>
  );
}

/** The guest's intake, condensed into the complaint box's first draft. */
function intakeSummary(f: PreConsultForm): string {
  const parts: string[] = [];
  const reasons = chosenLabels(f.reasonForVisit);
  const skin = chosenLabels(f.skinConcerns);
  const hair = chosenLabels(f.hairConcerns as Record<string, unknown>).filter((h) => h !== "Others");
  if (reasons.length) parts.push(`Here for ${reasons.join(", ").toLowerCase()}`);
  if (skin.length) parts.push(`Skin: ${skin.join(", ").toLowerCase()}`);
  if (hair.length) parts.push(`Hair: ${hair.join(", ").toLowerCase()}`);
  if (f.symptomDuration) parts.push(`Going on for ${f.symptomDuration}`);
  if (f.previousTreatments) parts.push(`Already tried ${f.previousTreatments}`);
  let out = "";
  for (const s of parts) out = appendSentence(out, s);
  if (f.patientNotes) out = appendSentence(out, f.patientNotes);
  return out;
}

/* ------------------------------------------------------------------ banner */

function VisitBanner({ bk, signed, editing, note, onEdit }: {
  bk: Booking; signed: boolean; editing: boolean; note: ConsultationNote | null; onEdit: () => void;
}) {
  if (signed && !editing) {
    return (
      <div className="dz-note dz-note--ok">
        <ShieldCheck />
        <span className="flex-1">
          <b>Signed{note?.prescriptionSignedByName ? ` by ${note.prescriptionSignedByName}` : ""}</b>
          {note?.prescriptionSignedAt || note?.completedAt ? ` on ${fmtDateTime(note.prescriptionSignedAt ?? note.completedAt)}` : ""}. The note is locked.
        </span>
        <button type="button" className="dz-btn dz-btn--secondary dz-btn--sm" onClick={onEdit}><Pencil />Edit and re-sign</button>
      </div>
    );
  }
  if (signed && editing) {
    return (
      <div className="dz-note dz-note--warn"><Pencil />
        <span>You are editing a signed note. Changing the diagnosis, prescription or advice removes the signature until you sign again.</span>
      </div>
    );
  }
  switch (bk.status) {
    case "Awaiting Confirmation":
      return <div className="dz-note dz-note--warn"><AlertTriangle /><span>The desk has not confirmed this booking yet. You can prepare the note; the visit starts once it is confirmed and the guest checks in.</span></div>;
    case "Confirmed":
    case "Rescheduled":
      return <div className="dz-note dz-note--info"><UserRound /><span>The guest has not been checked in. Anything you write is kept as a draft — tap <b>Check in &amp; start</b> once they are in the room.</span></div>;
    case "Checked In":
      return <div className="dz-note"><UserRound /><span><b>{bk.fullName}</b> is waiting{bk.checkInTime ? ` — arrived ${fmtAgo(bk.checkInTime)} ago` : ""}. Tap <b>Start consultation</b> when they come in.</span></div>;
    case "No Show":
      return <div className="dz-note dz-note--err"><AlertTriangle /><span>This visit was marked no-show. Use the menu to undo it if the guest did come.</span></div>;
    case "Cancelled":
      return <div className="dz-note dz-note--err"><AlertTriangle /><span>This visit was cancelled{bk.cancellationReason ? ` — ${bk.cancellationReason}` : ""}.</span></div>;
    default:
      return null;
  }
}

/* ------------------------------------------------------------ guest context */

function GuestContext({ bk, patient: p, form, consent, history, paperIntake, doctorName, userId, onOpenRecord, onOpenVisit, onChanged, toast, audit }: {
  bk: Booking; patient: User | null | undefined;
  /** No app form, but the clinic holds this returning guest's intake on paper. */
  paperIntake?: boolean;
  form: { data: { doc: PreConsultForm; linked: boolean } | null | undefined; initial: boolean; reload: () => void };
  consent: { _id: string; patientName: string; createdAt?: string; status: string; doctorSignature?: string | null } | null;
  history?: { notes: ConsultationNote[]; visits: Booking[] | null };
  doctorName: string; userId: string;
  onOpenRecord: () => void; onOpenVisit: (bookingId: string) => void; onChanged: () => void;
  toast: (m: string) => void; audit: ReturnType<typeof useStore>["audit"];
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const f = form.data?.doc ?? null;
  const age = ageFrom(p?.dateOfBirth);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true);
    try { await fn(); toast(msg); onChanged(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  const facts: [string, ReactNode][] = [];
  if (age || p?.gender) facts.push(["Age / gender", [age ? `${age} yrs` : null, p?.gender].filter(Boolean).join(" · ")]);
  if (p?.phone) facts.push(["Phone", p.phone]);
  const now = Date.now();
  const earlier = (history?.visits ?? [])
    .filter((b) => b.status !== "Cancelled" && new Date(b.confirmedDate || b.preferredDate).getTime() <= now);
  const completedBefore = earlier.filter((b) => b.status === "Completed");
  const noteByBooking = new Map((history?.notes ?? []).map((n) => [idOf(n.bookingId), n] as const));
  if (history?.visits) {
    const last = completedBefore[0];
    facts.push(["Visits", `${completedBefore.length + (bk.status === "Completed" ? 1 : 0)} completed${last ? ` · last ${fmtDate(last.confirmedDate || last.preferredDate)}` : ""}`]);
  }
  if (p?.memberType === "Zen Member") facts.push(["Membership", "Zen Member"]);
  if (p?.medicalHistory?.trim()) facts.push(["Medical history", p.medicalHistory]);

  const intakeRows: [string, string][] = f ? [
    ["Here for", chosenLabels(f.reasonForVisit).join(", ")],
    ["Skin", chosenLabels(f.skinConcerns).join(", ")],
    ["Hair", chosenLabels(f.hairConcerns as Record<string, unknown>).filter((h) => h !== "Others").join(", ")],
    ["Going on for", f.symptomDuration ?? ""],
    ["Tried before", f.previousTreatments ?? ""],
    ["In their words", f.patientNotes ?? ""],
  ].filter(([, v]) => v && String(v).trim()) as [string, string][] : [];

  return (
    <>
      <Panel icon={<UserRound />} title="About the guest" right={<button type="button" className="dz-link" onClick={onOpenRecord} disabled={!userId}>Full record<ChevronRight /></button>}>
        <dl className="dz-kv">
          {facts.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}
        </dl>
      </Panel>

      <Panel icon={<ClipboardList />} title="Pre-consult form"
        sub={f ? (form.data?.linked ? `Filled for this visit · ${fmtDate(f.dateOfVisit || f.createdAt)}` : `From ${fmtDate(f.dateOfVisit || f.createdAt)} — not this visit`) : undefined}
        right={f ? <span className={`dz-pill dz-pill--sm ${f.status === "Reviewed" || f.status === "Approved" ? "dz-pill--ok" : "dz-pill--warn"}`}>{f.status}</span> : undefined}>
        {form.initial ? <Loading label="" rows={2} /> : !f ? (
          paperIntake
            ? <div className="dz-note dz-note--ok"><Check /><span>Intake held on paper at the clinic — this guest has been seen before. There is no app form to show.</span></div>
            : <div className="dz-hint">No pre-consult form on this guest’s record. The desk can hand them the walk-in tablet to fill it.</div>
        ) : (
          <div className="dz-stack--sm">
            {intakeRows.length ? <dl className="dz-kv">{intakeRows.map(([k, v]) => <FactRow key={k} k={k} v={v} />)}</dl>
              : <div className="dz-hint">The guest left the reason blank.</div>}
            {(f.photos ?? []).length > 0 && (
              <div className="dz-strip">
                {(f.photos ?? []).map((ph, i) => (
                  <a key={i} href={ph.url} target="_blank" rel="noreferrer" style={{ width: 64, height: 64, borderRadius: 12, overflow: "hidden", flex: "none", border: "1px solid var(--color-border)" }}>
                    <img src={ph.url} alt={ph.caption || "Photo from the guest"} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}
            <div className="dz-row">
              <Btn kind="secondary" size="sm" onClick={() => setFormOpen(true)}><FileText />Read the full form</Btn>
              {f.status === "Submitted" && (
                <Btn kind="soft" size="sm" disabled={busy} onClick={() => run(
                  () => api.preConsult.setStatus(f._id, "Reviewed").then(() => audit("FORM_STATUS_CHANGED", `${bk.fullName} pre-consult reviewed`, { formId: f._id })),
                  "Pre-consult marked reviewed")}><Check />Mark reviewed</Btn>
              )}
            </div>
            <PreConsultModal form={f} open={formOpen} onClose={() => setFormOpen(false)} />
          </div>
        )}
      </Panel>

      <Panel icon={<ShieldCheck />} title="Consent"
        right={consent ? <span className={`dz-pill dz-pill--sm ${consent.doctorSignature ? "dz-pill--ok" : "dz-pill--warn"}`}>{consent.doctorSignature ? "Counter-signed" : "Needs your signature"}</span> : undefined}>
        {!consent ? (
          <div className="dz-hint">No patient consent form on file — the guest signs it in the app.</div>
        ) : (
          <div className="dz-stack--sm">
            <div className="text-[14px] text-ink2">Signed by <b className="text-ink">{consent.patientName}</b>{consent.createdAt ? ` on ${fmtDate(consent.createdAt)}` : ""}.</div>
            {!consent.doctorSignature && (
              <Btn kind="secondary" size="sm" disabled={busy} onClick={() => run(
                () => api.consentForms.doctorSign(consent._id, `${doctorName}|DancingScript`).then(() => audit("CONSENT_SIGNED", `${bk.fullName} consent counter-signed`, { formId: consent._id })),
                "Consent counter-signed")}><PenLine />Counter-sign as {doctorName || "yourself"}</Btn>
            )}
          </div>
        )}
      </Panel>

      <Panel icon={<History />} title="Earlier visits"
        sub={history?.visits ? `${completedBefore.length} completed · every practitioner` : undefined}
        right={<button type="button" className="dz-link" onClick={onOpenRecord} disabled={!userId}>All<ChevronRight /></button>}>
        {!history ? <Loading label="" rows={2} /> : history.visits === null ? (
          <div className="dz-note dz-note--warn"><AlertTriangle /><span>Couldn’t load earlier visits.</span></div>
        ) : earlier.length === 0 ? (
          <div className="dz-hint">No earlier visits on record.</div>
        ) : (
          <div className="dz-tl">
            {earlier.slice(0, 6).map((b) => {
              const n = noteByBooking.get(b._id);
              const who = b.specialistName || b.zenotiTherapistName || b.therapistName;
              const dx = n?.primaryDiagnosis || n?.assessment;
              return (
                <button key={b._id} type="button" className="dz-tl__item" onClick={() => onOpenVisit(b._id)}>
                  <div className="dz-tl__date">{fmtDate(b.confirmedDate || b.preferredDate)}{who ? ` · ${who}` : ""}{b.status !== "Completed" ? ` · ${b.status === "No Show" ? "no-show" : b.status.toLowerCase()}` : ""}</div>
                  <div className="dz-tl__title">{dx || bookingServiceName(b, "Visit")}</div>
                  {dx && <div className="dz-tl__text">{bookingServiceName(b, "Visit")}</div>}
                  {!!n?.prescription?.length && <div className="dz-tl__text">Rx: {n.prescription.map((r) => r.medicine).join(", ")}</div>}
                </button>
              );
            })}
            {earlier.length > 6 && <div className="dz-hint">+{earlier.length - 6} earlier — see the full record.</div>}
          </div>
        )}
      </Panel>

      <GuestPurchases userId={userId} patient={p} compact />
    </>
  );
}

function FactRow({ k, v }: { k: string; v: ReactNode }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}

/* -------------------------------------------------------------- treatments */

function TreatmentsPanel({ assigned, locked, packages, onChange }: {
  assigned: Assigned[]; locked: boolean; packages: PackageAssignment[]; onChange: (next: Assigned[]) => void;
}) {
  const [q, setQ] = useState("");
  const search = useDebounced(q, 300);
  const services = useApi(
    () => (search.trim().length >= 2 ? api.services.list({ search: search.trim(), isActive: "true", limit: 8 }).then((r) => r.data ?? []).catch(() => [] as Consultation[]) : Promise.resolve([] as Consultation[])),
    [search],
  );
  const setSessions = (i: number, n: number) => onChange(assigned.map((a, j) => (j === i ? { ...a, sessions: Math.max(1, n) } : a)));

  return (
    <Panel icon={<Sparkles />} title="Treatments to recommend" sub="What the guest should book — reception creates the sessions and the bill">
      <div className="dz-stack--sm">
        {assigned.length === 0 && locked && <div className="dz-hint">No treatments were recommended.</div>}
        {assigned.map((a, i) => (
          <div key={`${a.name}-${i}`} className="dz-rx-item" style={{ cursor: "default" }}>
            <span className="dz-rx-icon dz-rx-icon--tx"><Sparkles /></span>
            <span className="min-w-0"><span className="dz-rx-item__name">{a.name}</span>
              <span className="dz-rx-sig">{a.sessions ?? 1} session{(a.sessions ?? 1) === 1 ? "" : "s"}</span></span>
            {!locked ? (
              <span className="dz-row" style={{ gap: 6 }}>
                <span className="dz-stepper">
                  <button type="button" onClick={() => setSessions(i, (a.sessions ?? 1) - 1)} aria-label="One session fewer"><Minus /></button>
                  <span>{a.sessions ?? 1}</span>
                  <button type="button" onClick={() => setSessions(i, (a.sessions ?? 1) + 1)} aria-label="One session more"><Plus /></button>
                </span>
                <button type="button" className="dz-iconbtn dz-iconbtn--plain" onClick={() => onChange(assigned.filter((_, j) => j !== i))} aria-label={`Remove ${a.name}`}><Trash2 /></button>
              </span>
            ) : <span />}
          </div>
        ))}

        {!locked && (
          <>
            <div className="dz-searchbox">
              <Search />
              <input className="dz-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search treatments — HydraFacial, GFC, laser toning…" />
            </div>
            {(services.data ?? []).map((s) => (
              <button key={s._id} type="button" className="dz-result"
                onClick={() => { onChange([...assigned, { serviceId: s._id, name: s.name, sessions: 1 }]); setQ(""); }}>
                <span className="dz-result__txt"><b>{s.name}</b><small>{s.category || "Treatment"}</small></span>
                <span className="dz-result__add"><Plus /></span>
              </button>
            ))}
            {search.trim().length >= 2 && !services.loading && (services.data ?? []).length === 0 && <div className="dz-hint">No treatment matches “{q}”.</div>}
          </>
        )}

        {packages.length > 0 && (
          <div className="dz-card dz-card--sage" style={{ padding: 16 }}>
            <div className="mb-2 flex items-center gap-2 text-[14px] font-extrabold"><Package className="h-4 w-4 text-secondary" />Already on a package</div>
            <div className="dz-stack--sm">
              {packages.map((pk) => {
                const total = pk.usageTracking?.totalSessions ?? (pk.packageDetails?.services ?? []).reduce((n, s) => n + (Number(s.sessions) || 1), 0);
                const used = pk.usageTracking?.usedSessions ?? (pk.sessions ?? []).filter((s) => s.status === "Completed").length;
                return (
                  <div key={pk._id} className="flex items-center justify-between gap-3 text-[14px]">
                    <span className="min-w-0 truncate font-bold">{pk.packageDetails?.packageName ?? "Package"}</span>
                    <span className="shrink-0 text-ink2">{Math.max(0, total - used)} of {total} left{pk.validUntil ? ` · until ${fmtDate(pk.validUntil)}` : ""}</span>
                  </div>
                );
              })}
            </div>
            <div className="dz-hint mt-2">Reception redeems sessions from these — no need to recommend the same treatment again.</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

/* -------------------------------------------------------------------- sign */

function SignStep({ bk, patient, form, draft, note, signed, editing, doctorName, photosCount, dirty, onGo, onSaveDraft, onSigned, runner, reloadVisit, onFollowUp }: {
  bk: Booking; patient: User | null | undefined; form: PreConsultForm | null; draft: Draft; note: ConsultationNote | null;
  signed: boolean; editing: boolean; doctorName: string; photosCount: number; dirty: boolean;
  onGo: (s: Step) => void; onSaveDraft: () => void; onSigned: (n: ConsultationNote) => void;
  runner: ReturnType<typeof useVisitRunner>; reloadVisit: () => void; onFollowUp: (date: string) => void;
}) {
  const { toast } = useStore();
  const me = useMyDoctor();
  const today = isoDay();
  const [checkout, setCheckout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closeFailed, setCloseFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [noFollowUp, setNoFollowUp] = useState(bk.followUp?.required === false && !draft.followUpDate);
  const [customDate, setCustomDate] = useState(false);
  const sheetRef = useRef<HTMLElement | null>(null);

  const chosen = FOLLOW_UPS.find((c) => draft.followUpDate === addClinicDays(today, c.days))?.key ?? (draft.followUpDate ? "date" : noFollowUp ? "none" : "");
  const nothingWritten = ![draft.complaint, draft.examination, draft.primaryDiagnosis, draft.assessment, draft.plan].some((x) => x.trim()) && draft.prescription.length === 0;
  const willCheckout = bk.status === "In Progress" && checkout;

  const finish = async () => {
    setBusy(true); setErr(null); setCloseFailed(false);
    let saved: ConsultationNote;
    try {
      saved = await api.consultationNotes.save({
        bookingId: bk._id,
        complaint: draft.complaint, examination: draft.examination, assessment: draft.assessment, plan: draft.plan,
        sketch: draft.sketch ?? undefined, prescription: draft.prescription, assignedServices: draft.assignedServices,
        followUpDate: noFollowUp ? null : draft.followUpDate || null, status: "Completed",
        primaryDiagnosis: draft.primaryDiagnosis, secondaryDiagnosis: draft.secondaryDiagnosis,
        skinCareAdvice: draft.skinCareAdvice, lifestyleAdvice: draft.lifestyleAdvice, precautions: draft.precautions,
        doctorId: me.data?.doctorId, doctorName: me.data?.name,
      } as Parameters<typeof api.consultationNotes.save>[0]);
      onSigned(saved);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
      return;
    }

    if (willCheckout) {
      try { await runner.exec("complete"); } catch (e) { setErr(`Signed — but the visit could not be checked out: ${(e as Error).message}`); setCloseFailed(true); }
    }

    // The clinical stage follows from what was written; best effort, never blocking.
    const stages: Parameters<typeof api.bookings.setStage>[1][] = [];
    if (draft.prescription.length) stages.push({ stage: "prescription_created" });
    if (draft.assignedServices.length) stages.push({ stage: "treatment_recommended" });
    if (noFollowUp) stages.push({ stage: "no_follow_up", followUp: { required: false, dueDate: null, notes: "" } });
    else if (draft.followUpDate) stages.push({ stage: "follow_up_required", followUp: { required: true, dueDate: draft.followUpDate, notes: "" } });
    for (const s of stages) await api.bookings.setStage(bk._id, s).catch(() => undefined);

    toast(saved.prescriptionEmailedAt ? `Signed — prescription emailed to ${saved.prescriptionEmailedTo ?? "the guest"}` : "Signed — the prescription is on the guest’s app");
    reloadVisit();
    setBusy(false);
  };

  const download = () => {
    const el = sheetRef.current;
    if (!el) return;
    const html = el.outerHTML.replace(/src="([^"]*zennara-logo[^"]*)"/, (_, src) => `src="${new URL(src, window.location.href).href}"`);
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Prescription — ${patient?.fullName ?? bk.fullName}</title><style>${RX_FILE_CSS}</style></head><body>${html}</body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([doc], { type: "text/html" }));
    a.download = `prescription-${(patient?.fullName ?? bk.fullName).toLowerCase().replace(/\s+/g, "-")}-${today}.html`;
    a.click();
  };

  const checks: { ok: boolean | null; label: string; value: string; step?: Step }[] = [
    { ok: !!(draft.primaryDiagnosis.trim() || draft.assessment.trim()), label: "Diagnosis", value: draft.primaryDiagnosis || (draft.assessment ? "In the assessment" : "Not written"), step: "notes" },
    { ok: draft.prescription.length ? true : null, label: "Medicines", value: draft.prescription.length ? `${draft.prescription.length} on the prescription` : "None", step: "rx" },
    { ok: draft.assignedServices.length ? true : null, label: "Treatments recommended", value: draft.assignedServices.length ? draft.assignedServices.map((a) => a.name).join(", ") : "None", step: "rx" },
    { ok: photosCount ? true : null, label: "Photos this visit", value: photosCount ? `${photosCount}` : "None", step: "photos" },
    { ok: form ? form.status === "Reviewed" || form.status === "Approved" ? true : false : null, label: "Pre-consult form", value: form ? form.status : "Not on file", step: "notes" },
  ];

  return (
    <>
      {signed && !editing ? (
        <Panel icon={<ShieldCheck />} title="Prescription signed"
          sub={`${note?.prescriptionSignedByName ?? note?.doctorName ?? doctorName} · ${fmtDateTime(note?.prescriptionSignedAt ?? note?.completedAt)}`}>
          <div className="dz-stack">
            <div className="dz-row">
              {note?.prescriptionEmailedAt
                ? <span className="dz-pill dz-pill--ok"><Mail />Emailed to {note.prescriptionEmailedTo ?? "the guest"} · {fmtAgo(note.prescriptionEmailedAt)} ago</span>
                : <span className="dz-pill dz-pill--line">On the guest’s app</span>}
              {note?.followUpDate && <span className="dz-pill"><History />Review on {fmtDate(note.followUpDate)}</span>}
            </div>
            <div className="dz-row">
              <Btn onClick={() => window.print()}><Printer />Print or save PDF</Btn>
              <Btn kind="secondary" onClick={download}><Download />Download</Btn>
              {!!note?.prescription?.length && (
                <Btn kind="secondary" disabled={sending} onClick={async () => {
                  if (!note) return;
                  setSending(true);
                  try { const r = await api.consultationNotes.send(note._id); toast((r.message as string) ?? "Prescription emailed"); }
                  catch (e) { toast((e as Error).message); } finally { setSending(false); }
                }}><Mail />{sending ? "Sending…" : note?.prescriptionEmailedAt ? "Email again" : "Email to guest"}</Btn>
              )}
            </div>
            {bk.status === "In Progress" && (
              <Note kind="warn" className="my-0">The visit is still open.{" "}
                <button type="button" className="dz-link" disabled={runner.busy}
                  onClick={() => runner.perform(() => runner.exec("complete"), "Visit completed — guest checked out")}>Check the guest out</button>
              </Note>
            )}
          </div>
        </Panel>
      ) : (
        <div data-tour="sign-step">
          <Panel icon={<FileSignature />} title={editing ? "Sign again" : "Sign and finish"}
            sub="Signing locks the note and sends the prescription to the guest’s app and email.">
            <div className="dz-grid-even">
              <div>
                {checks.map((c) => (
                  <div key={c.label} className="dz-check">
                    <span className={`dz-check__icon ${c.ok === true ? "" : c.ok === false ? "dz-check__icon--todo" : "dz-check__icon--none"}`}>
                      {c.ok === true ? <Check /> : c.ok === false ? <AlertTriangle /> : <Minus />}
                    </span>
                    <b>{c.label}</b>
                    <span className="dz-check__val">
                      {c.step ? <button type="button" className="dz-link" style={{ fontWeight: 600, color: "var(--color-ink2)" }} onClick={() => onGo(c.step!)}>{c.value}</button> : c.value}
                    </span>
                  </div>
                ))}
              </div>

              <div className="dz-stack">
                <div className="dz-field">
                  <span className="dz-label">Follow-up</span>
                  <div className="dz-chips">
                    <button type="button" className={`dz-chip ${chosen === "none" ? "is-on" : ""}`}
                      onClick={() => { setNoFollowUp(true); setCustomDate(false); onFollowUp(""); }}>
                      {chosen === "none" && <Check />}Not needed
                    </button>
                    {FOLLOW_UPS.map((c) => (
                      <button key={c.key} type="button" className={`dz-chip ${chosen === c.key ? "is-on" : ""}`}
                        onClick={() => { setNoFollowUp(false); setCustomDate(false); onFollowUp(addClinicDays(today, c.days)); }}>
                        {chosen === c.key && <Check />}{c.label}
                      </button>
                    ))}
                    <button type="button" className={`dz-chip dz-chip--dash ${chosen === "date" || customDate ? "is-on" : ""}`}
                      onClick={() => { setNoFollowUp(false); setCustomDate(true); }}>Pick a date</button>
                  </div>
                  {(customDate || chosen === "date") && (
                    <input type="date" className="dz-input" style={{ maxWidth: 220 }} min={today} value={draft.followUpDate}
                      onChange={(e) => onFollowUp(e.target.value)} />
                  )}
                  {draft.followUpDate && <div className="dz-hint">Review on {fmtDateLong(draft.followUpDate)}.</div>}
                </div>
                {bk.status === "In Progress" && (
                  <div className="dz-switch">
                    <div><b>Check the guest out</b><small>Completes the visit here and in Zenoti.</small></div>
                    <Toggle on={checkout} onChange={setCheckout} label="Check the guest out" />
                  </div>
                )}
              </div>
            </div>

            {err && (
              <Note kind="crit">
                {err}
                {closeFailed && <> <button type="button" className="dz-link" onClick={() => runner.perform(() => runner.exec("complete"), "Visit completed")}>Try again</button></>}
              </Note>
            )}
            {nothingWritten && <Note kind="warn">Write the note or add a medicine before signing.</Note>}

            <div className="dz-row mt-5">
              <span className="dz-hint">Signs as <b className="text-ink">{doctorName || "you"}</b></span>
              <span className="dz-spacer" />
              {dirty && <Btn kind="secondary" onClick={onSaveDraft}>Save draft</Btn>}
              <Btn size="lg" disabled={busy || nothingWritten} onClick={finish}>
                {busy ? <Loader2 className="animate-spin" /> : <PenLine />}
                {busy ? "Signing…" : willCheckout ? "Sign and finish visit" : "Sign prescription"}
              </Btn>
            </div>
          </Panel>
        </div>
      )}

      <RxSheet sheetRef={sheetRef} bk={bk} patient={patient} form={form} draft={draft} note={note} signed={signed && !editing} doctorName={doctorName} />
    </>
  );
}

/* --------------------------------------------------------- the printed slip */

function RxSheet({ sheetRef, bk, patient: p, form, draft, note, signed, doctorName }: {
  sheetRef: React.MutableRefObject<HTMLElement | null>;
  bk: Booking; patient: User | null | undefined; form: PreConsultForm | null; draft: Draft; note: ConsultationNote | null;
  signed: boolean; doctorName: string;
}) {
  const age = ageFrom(p?.dateOfBirth);
  const allergy = form?.drugAllergies && !/^none/i.test(form.drugAllergies) ? form.drugAllergies : p?.drugAllergies?.trim();
  const section = (title: string, body?: string | null) => body?.trim() ? <><h4>{title}</h4><p>{body}</p></> : null;
  const signedBy = note?.prescriptionSignedByName ?? note?.doctorName ?? doctorName;
  return (
    <article ref={sheetRef} className="dz-rxsheet dz-print" aria-label="Prescription preview">
      {!signed && <div className="dz-rxsheet__draft"><span className="dz-pill dz-pill--warn">Preview — not signed yet</span></div>}
      <div className="dz-rxsheet__head">
        <img src={logo} alt="Zennara" />
        <div className="dz-rxsheet__clinic"><strong>Zennara Clinics</strong>Skin · Aesthetics · Wellness{bk.preferredLocation ? <><br />{bk.preferredLocation}</> : null}</div>
      </div>
      <div className="dz-rxsheet__pt">
        <div><span>Patient</span>{p?.fullName ?? bk.fullName}</div>
        <div><span>Patient ID</span>{p?.patientId ?? "—"}</div>
        <div><span>Age / gender</span>{[age ? `${age} yrs` : null, p?.gender].filter(Boolean).join(" · ") || "—"}</div>
        <div><span>Date</span>{fmtDate(signed ? note?.prescriptionSignedAt ?? note?.completedAt : new Date())}</div>
        <div><span>Dermatologist</span>{signedBy || "—"}</div>
        <div><span>Phone</span>{p?.phone ?? bk.mobileNumber ?? "—"}</div>
      </div>
      {allergy && <p><b>Allergies:</b> {allergy}</p>}
      {section("Complaint", draft.complaint)}
      {section("Examination", draft.examination)}
      {draft.primaryDiagnosis.trim() && <><h4>Diagnosis</h4><p>{draft.primaryDiagnosis}{draft.secondaryDiagnosis ? ` · ${draft.secondaryDiagnosis}` : ""}</p></>}
      {section("Assessment", draft.assessment)}
      {section("Plan", draft.plan)}

      <div className="dz-rxsheet__rx">Rx</div>
      {draft.prescription.length ? (
        <table>
          <thead><tr><th>#</th><th>Medicine</th><th>Dose</th><th>How often</th><th>For</th><th>Instructions</th></tr></thead>
          <tbody>
            {draft.prescription.map((r, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><b>{[r.medicine, r.strength, r.formulation].filter(Boolean).join(" ")}</b>{r.isScheduleH ? " (Sch H)" : ""}</td>
                <td>{r.dosage || "—"}</td>
                <td>{[r.frequency, r.timing].filter(Boolean).join(", ") || "—"}</td>
                <td>{r.duration || "—"}</td>
                <td>{r.instructions || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ color: "var(--color-ink3)" }}>No medicines prescribed.</p>}

      {draft.assignedServices.length > 0 && (
        <>
          <h4>Treatments advised</h4>
          <table>
            <thead><tr><th>Treatment</th><th>Sessions</th></tr></thead>
            <tbody>{draft.assignedServices.map((a, i) => <tr key={i}><td><b>{a.name}</b></td><td>{a.sessions ?? 1}</td></tr>)}</tbody>
          </table>
        </>
      )}
      {section("Skin care", draft.skinCareAdvice)}
      {section("Diet and lifestyle", draft.lifestyleAdvice)}
      {section("Precautions", draft.precautions)}
      {draft.followUpDate && <><h4>Review</h4><p>{fmtDateLong(draft.followUpDate)}</p></>}

      <div className="dz-rxsheet__sign">
        <span style={{ fontSize: 12.5, color: "var(--color-ink3)" }}>{signed ? `Signed ${fmtDateTime(note?.prescriptionSignedAt ?? note?.completedAt)}` : "Draft — not signed"}</span>
        <div className="dz-rxsheet__line"><b>{signedBy || "Dermatologist"}</b><br />Consultant Dermatologist, Zennara</div>
      </div>
      {draft.prescription.some((r) => r.isScheduleH) && <p style={{ marginTop: 12, fontSize: 12 }}>Schedule H drugs are dispensed only against this signed prescription.</p>}
    </article>
  );
}

/** A self-contained copy of the slip's styles for the downloaded file. */
const RX_FILE_CSS = `
body{margin:0;padding:32px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111714;background:#fff}
.dz-rxsheet{max-width:780px;margin:0 auto;font-size:14px;line-height:1.5}
.dz-rxsheet__draft{margin-bottom:12px}
.dz-pill{display:inline-block;padding:4px 10px;border-radius:999px;background:#fcefd7;color:#93560e;font-size:12px;font-weight:700}
.dz-rxsheet__head{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;border-bottom:2px solid #032f22;padding-bottom:16px;margin-bottom:18px}
.dz-rxsheet__head img{height:46px}
.dz-rxsheet__clinic{text-align:right;font-size:12.5px;color:#4a534e}
.dz-rxsheet__clinic strong{display:block;font-size:15px;color:#111714}
.dz-rxsheet__pt{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 18px;margin-bottom:16px}
.dz-rxsheet__pt span{display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#66706a}
h4{margin:18px 0 6px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0b4a37}
p{margin:2px 0;white-space:pre-wrap}
.dz-rxsheet__rx{margin:18px 0 6px;font-size:30px;font-style:italic;font-weight:800;color:#032f22}
table{width:100%;border-collapse:collapse}
th{text-align:left;font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#66706a;border-bottom:1px solid #cad5cb;padding:7px 6px}
td{padding:9px 6px;border-bottom:1px solid #e1e7e1;vertical-align:top}
.dz-rxsheet__sign{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-top:34px}
.dz-rxsheet__line{min-width:240px;border-top:1px solid #111714;padding-top:6px;font-size:13px}
`;

/* ------------------------------------------------------------------ sketch */

function SketchButton({ sketch, onSave }: { sketch: string | null; onSave: (dataUrl: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="dz-mic" onClick={() => setOpen(true)}><Pencil />{sketch ? "Edit sketch" : "Sketch"}</button>
      {open && <SketchPad initial={sketch} onClose={() => setOpen(false)} onSave={(d) => { onSave(d); setOpen(false); }} />}
    </>
  );
}

function SketchPad({ initial, onSave, onClose }: { initial?: string | null; onSave: (dataUrl: string) => void; onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (!initial) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = initial;
  }, [initial]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 960, ((e.clientY - r.top) / r.height) * 540] as const;
  };

  return (
    <Modal open onClose={onClose} xl title="Sketch" sub="Draw with a finger or stylus — injection points, peel zones, lesion sites. It attaches to the note."
      footer={<>
        <Btn kind="secondary" onClick={() => { const c = canvasRef.current; const ctx = c?.getContext("2d"); if (c && ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); } }}>Clear</Btn>
        <span className="flex-1" />
        <Btn kind="secondary" onClick={onClose}>Cancel</Btn>
        <Btn onClick={() => onSave(canvasRef.current?.toDataURL("image/png") ?? "")}><Check />Attach to note</Btn>
      </>}>
      <canvas ref={canvasRef} width={960} height={540}
        className="block w-full touch-none rounded-2xl border border-border-strong bg-white"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
          const [x, y] = pos(e);
          drawing.current = true; ctx.beginPath(); ctx.moveTo(x, y);
          ctx.strokeStyle = "#032F22"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
          const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke();
        }}
        onPointerUp={() => { drawing.current = false; }} />
    </Modal>
  );
}
