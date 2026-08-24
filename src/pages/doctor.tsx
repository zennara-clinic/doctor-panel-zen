import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Page, Btn, Tag, Stats, Card, DataTable, B, Note, Hint, In, Sel, Area, Switch, Toggle,
  SecH, Prog, Modal, AreaChart, ChartCard, HBars, Async, Empty, Loading, StaleBanner, Tabs, Otp, UploadField, MultiSelect,
} from "../ui";
import { useStore } from "../store";
import { useDictation } from "../dictate";
import api from "../lib/api";
import { useApi, useDebounced } from "../lib/useApi";
import { useMyDoctor } from "../lib/useMe";
import {
  ageFrom, bookingServiceName, bookingSlotLabel, fmtAgo, fmtDate, fmtDateFull, fmtINR, fmtWhen, idOf, initials, isoDay,
  nameOf, pct, patientFlags, statusKey,
} from "../lib/format";
import { STATUS } from "../ui";
import type { Booking, Consultation, Doctor, Package, PreConsultForm, PrescriptionItem } from "../lib/types";

/** Bookings assigned to this doctor, for a date (or a window) — filtered server-side. */
function useMyBookings(doctor: Doctor | null | undefined, date?: string, range?: { startDate: string; endDate: string }) {
  return useApi(async () => {
    if (!doctor) return [] as Booking[];
    const res = await api.bookings.list({ specialistId: doctor.doctorId, date, ...(range ?? {}) });
    const all = res.data ?? [];
    // Legacy rows were keyed on the display name only.
    return all.filter((b) => !b.specialistId || b.specialistId === doctor.doctorId || b.specialistName === doctor.name);
  }, [doctor?._id, date, range?.startDate, range?.endDate]);
}

/** Shown when a panel login has no matching Doctor profile. */
function NoProfile({ email }: { email?: string }) {
  return (
    <Empty
      title="No dermatologist profile is linked to this login"
      hint={`Ask an admin to open Care → Dermatologists and set the profile's email to ${email ?? "your address"}, or create a profile for you. Until then this panel has no schedule to show.`}
    />
  );
}

/* ================= MY DAY ================= */
export function MyDay() {
  const nav = useNavigate();
  const { admin } = useStore();
  const me = useMyDoctor();
  const [day, setDay] = useState(isoDay());

  const bookings = useMyBookings(me.data, day);
  const monthRange = useMemo(() => {
    const from = new Date(); from.setDate(1);
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    return { startDate: isoDay(from), endDate: isoDay(to) };
  }, []);
  const month = useMyBookings(me.data, undefined, monthRange);

  const forms = useApi(async () => {
    // Only the forms for today's bookings — not a global newest-200 page.
    const ids = (bookings.data ?? []).map((b) => b._id);
    if (!ids.length) return { data: [] as PreConsultForm[] };
    const parts = await Promise.all(ids.map((id) => api.preConsult.list({ bookingId: id, limit: 1 }).catch(() => ({ data: [] as PreConsultForm[] }))));
    return { data: parts.flatMap((p) => (p.data ?? []) as PreConsultForm[]) };
  }, [(bookings.data ?? []).map((b) => b._id).join(",")]);
  const notes = useApi(
    () => (me.data ? api.consultationNotes.list({ doctorId: me.data.doctorId, limit: 200 }) : Promise.resolve({ success: true, data: [] })),
    [me.data?._id],
  );

  const rows = bookings.data ?? [];
  const done = rows.filter((b) => b.status === "Completed");
  const next = rows.find((b) => b.status === "Confirmed" || b.status === "In Progress");

  const formByBooking = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of forms.data?.data ?? []) map.set(idOf(f.bookingId), f.status);
    return map;
  }, [forms.data]);

  const noteByBooking = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of notes.data?.data ?? []) map.set(idOf(n.bookingId), n.status);
    return map;
  }, [notes.data]);

  const monthRows = month.data ?? [];
  const monthCompleted = monthRows.filter((b) => b.status === "Completed").length;
  const awaitingNotes = monthRows.filter(
    (b) => b.status === "Completed" && noteByBooking.get(b._id) !== "Completed",
  ).length;

  return (
    <Page title="My day" sub={[me.data?.name ?? admin?.name, fmtDateFull(day)].filter(Boolean).join(" · ")}
      actions={<>
        <input type="date" value={day} onChange={(e) => setDay(e.target.value)}
          className="rounded-(--radius-btn) border border-border bg-surface px-3 py-1.5 text-[12.5px] outline-none focus:border-gold-dark" />
        <Btn kind="ghost" onClick={() => nav("/doctor/availability")}>My availability</Btn>
      </>}>
      <Hint id="myday-live">Click any row to open the consultation screen with that guest's history, their pre-consult form and your last note already loaded.</Hint>

      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <>
            <StaleBanner error={bookings.data ? bookings.error : null} onRetry={bookings.reload} />
            <Stats items={[
              { k: "Next", v: next ? <span className="text-[16px]">{next.fullName}</span> : "—",
                d: next ? bookingSlotLabel(next) : "nothing scheduled", hot: !!next },
              { k: "Today", v: rows.length, d: `${done.length} completed` },
              { k: "This month", v: monthRows.length, d: `${monthCompleted} completed`, onClick: () => nav("/doctor/month") },
              { k: "Awaiting notes", v: awaitingNotes, d: "completed without a signed note", hot: awaitingNotes > 0 },
              { k: "Centres", v: (doctor.availableCentres ?? []).length, d: (doctor.availableCentres ?? []).join(", ") || "none set" },
            ]} />

            <Async q={bookings} label="Loading your day…" rows={6}>
              {() => rows.length === 0 ? (
                <Empty title="Nothing booked for this date"
                  hint="Pick another date above, or check that your availability is published." />
              ) : (
                <DataTable cols={["Time", "Guest", "Service", "Centre", "Pre-consult", "Note", "Status"]}
                  onRow={(i) => nav("/doctor/consultation", { state: { bookingId: rows[i]._id } })}
                  rows={rows.map((b) => {
                    const formStatus = formByBooking.get(b._id);
                    const noteStatus = noteByBooking.get(b._id);
                    return [
                      <B key={b._id}>{b.confirmedTime || b.preferredTimeSlots?.[0] || "—"}</B>,
                      <B key={`${b._id}n`}>{b.fullName}</B>,
                      bookingServiceName(b),
                      b.preferredLocation,
                      formStatus
                        ? <Tag key={`${b._id}f`} kind={formStatus === "Submitted" || formStatus === "Approved" ? "ok" : "warn"}>{formStatus}</Tag>
                        : <Tag key={`${b._id}f`} kind="mute">not filled</Tag>,
                      noteStatus
                        ? <Tag key={`${b._id}c`} kind={noteStatus === "Completed" ? "ok" : "warn"}>{noteStatus}</Tag>
                        : <Tag key={`${b._id}c`} kind="mute">—</Tag>,
                      STATUS[statusKey(b)],
                    ];
                  })} />
              )}
            </Async>
          </>
        )}
      </Async>
    </Page>
  );
}

/* ================= CONSULTATION ================= */
type Field = "complaint" | "examination" | "assessment" | "plan";

export function Consult() {
  const nav = useNavigate();
  const loc = useLocation();
  const { toast, audit, admin } = useStore();
  const me = useMyDoctor();
  const bookingId = (loc.state as { bookingId?: string } | null)?.bookingId ?? null;

  const day = useMyBookings(me.data, isoDay());
  const todays = day.data ?? [];

  if (!bookingId) {
    return (
      <Page title="Consultation" sub="Pick today's guest to open their consultation">
        <Hint id="consultpick-live" steps={[
          "This list is your day — every guest booked with you, in order.",
          "Click a guest to open the consultation screen with their history, pre-consult form and previous notes loaded.",
          "Save draft keeps the note as you go; Complete & sign locks it and unlocks the prescription download.",
        ]} />
        <Async q={me} label="Loading your profile…" rows={3}>
          {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
            <Async q={day} label="Loading your day…" rows={5}>
              {() => todays.length === 0 ? (
                <Empty title="Nothing booked today" action={<Btn kind="ghost" onClick={() => nav("/doctor/my-day")}>Open my day</Btn>} />
              ) : (
                <DataTable cols={["Time", "Guest", "Service", "Status", ""]}
                  onRow={(i) => nav("/doctor/consultation", { state: { bookingId: todays[i]._id } })}
                  rows={todays.map((b) => [
                    <B key={b._id}>{b.confirmedTime || b.preferredTimeSlots?.[0] || "—"}</B>,
                    <B key={`${b._id}n`}>{b.fullName}</B>,
                    bookingServiceName(b),
                    STATUS[statusKey(b)],
                    "Open →",
                  ])} />
              )}
            </Async>
          )}
        </Async>
      </Page>
    );
  }

  return <ConsultScreen bookingId={bookingId} onBack={() => nav("/doctor/consultation", { state: {} })}
    doctorName={me.data?.name ?? admin?.name ?? ""} me={me.data ?? null} audit={audit} toast={toast} />;
}

function ConsultScreen({ bookingId, onBack, doctorName, me, audit, toast }: {
  bookingId: string; onBack: () => void; doctorName: string; me: Doctor | null;
  audit: ReturnType<typeof useStore>["audit"]; toast: (m: string) => void;
}) {
  const nav = useNavigate();
  const [sketchOpen, setSketchOpen] = useState(false);
  const [complaint, setComplaint] = useState("");
  const [examination, setExamination] = useState("");
  const [assessment, setAssessment] = useState("");
  const [plan, setPlan] = useState("");
  const [rx, setRx] = useState<PrescriptionItem[]>([]);
  const [sendingRx, setSendingRx] = useState(false);
  const [assigned, setAssigned] = useState<{ serviceId?: string; packageId?: string; name: string; sessions?: number }[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [sketch, setSketch] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rxQ, setRxQ] = useState("");
  const rxSearch = useDebounced(rxQ, 300);
  const [svcQ, setSvcQ] = useState("");
  const svcSearch = useDebounced(svcQ, 300);
  // Visit actions — OTP modals and the no-show/complete buttons.
  const [otpOpen, setOtpOpen] = useState<"in" | "out" | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualReason, setManualReason] = useState("");
  const [sendBusy, setSendBusy] = useState(false);
  const [code, setCode] = useState("");
  const [visitBusy, setVisitBusy] = useState(false);
  const [visitErr, setVisitErr] = useState<string | null>(null);

  const dict = useDictation();
  const [dictTarget, setDictTarget] = useState<Field | null>(null);
  const setters: Record<Field, (fn: (v: string) => string) => void> = {
    complaint: (fn) => setComplaint((v) => fn(v)),
    examination: (fn) => setExamination((v) => fn(v)),
    assessment: (fn) => setAssessment((v) => fn(v)),
    plan: (fn) => setPlan((v) => fn(v)),
  };

  const booking = useApi(() => api.bookings.get(bookingId), [bookingId]);
  const note = useApi(() => api.consultationNotes.forBooking(bookingId), [bookingId]);

  const userId = booking.data ? idOf(booking.data.userId) : "";
  const patient = useApi(() => (userId ? api.patients.get(userId) : Promise.resolve(null)), [userId]);
  const history = useApi(async () => {
    if (!userId) return { bookings: [] as Booking[], notes: [] as { _id: string; createdAt?: string; assessment?: string; plan?: string; prescription?: PrescriptionItem[]; status: string; doctorName?: string | null }[] };
    const [b, n] = await Promise.all([
      api.bookings.list({ userId, limit: 50 }).then((r) => (r.data ?? []).filter((x) => x._id !== bookingId)),
      api.consultationNotes.list({ userId, limit: 20 }).then((r) => (r.data ?? []).filter((x) => idOf(x.bookingId) !== bookingId)).catch(() => []),
    ]);
    return { bookings: b, notes: n };
  }, [userId, bookingId]);
  const form = useApi(
    () => api.preConsult.list({ bookingId, limit: 1 }).then((r) => (r.data ?? [])[0] ?? null).catch(() => null),
    [bookingId],
  );
  // The guest's most recent Universal Patient Consent — what the doctor counter-signs.
  const consent = useApi(
    () => (userId ? api.consentForms.list({ userId, limit: 1 }).then((r) => (r.data ?? [])[0] ?? null).catch(() => null) : Promise.resolve(null)),
    [userId],
  );
  const rxSuggest = useApi(
    () => (rxSearch.trim().length >= 2 ? api.products.list({ search: rxSearch.trim() }).then((r) => (r.data ?? []).slice(0, 6)).catch(() => []) : Promise.resolve([])),
    [rxSearch],
  );

  const visit = async (fn: () => Promise<unknown>, msg: string) => {
    setVisitBusy(true); setVisitErr(null);
    try { await fn(); toast(msg); booking.reload(); return true; }
    catch (e) { setVisitErr((e as Error).message); return false; }
    finally { setVisitBusy(false); }
  };

  const sendCode = async (kind: "checkin" | "checkout", channel: "email" | "whatsapp") => {
    if (!booking.data) return;
    setSendBusy(true);
    try {
      const r = await api.bookings.sendVisitCode(booking.data._id, { kind, channel });
      const sent = (r.delivered ?? []).join(" + ");
      toast(sent ? `Code sent via ${sent}` : "Could not deliver the code — try another channel");
    } catch (e) { toast((e as Error).message); } finally { setSendBusy(false); }
  };

  const services = useApi(
    () => (svcSearch.length >= 2 ? api.services.list({ search: svcSearch, isActive: "true", limit: 8 }) : Promise.resolve({ success: true, data: [] as Consultation[] })),
    [svcSearch],
  );

  // Prime the form once the saved note arrives.
  useEffect(() => {
    const n = note.data;
    if (!n) return;
    setComplaint(n.complaint ?? "");
    setExamination(n.examination ?? "");
    setAssessment(n.assessment ?? "");
    setPlan(n.plan ?? "");
    setRx(n.prescription ?? []);
    setAssigned((n.assignedServices ?? []).map((a) => ({
      serviceId: a.serviceId ? String(a.serviceId) : undefined,
      packageId: a.packageId ? String(a.packageId) : undefined,
      name: a.name, sessions: a.sessions,
    })));
    setFollowUp(n.followUpDate ? isoDay(new Date(n.followUpDate)) : "");
    setSketch(n.sketch ?? null);
    setDirty(false);
  }, [note.data?._id, note.data?.updatedAt]);

  const mic = (field: Field) => {
    if (dict.state !== "idle" && dictTarget === field) { dict.stop(); setDictTarget(null); return; }
    dict.stop();
    setDictTarget(field);
    dict.start(
      (txt) => { setters[field]((v) => (v ? v + " " : "") + txt); setDirty(true); },
      (e) => { toast(e); setDictTarget(null); },
    );
  };

  const MicBtn = ({ field }: { field: Field }) => (
    <button data-tour={field === "examination" ? "dictate" : undefined} onClick={() => mic(field)}
      className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${
        dictTarget === field && dict.state !== "idle" ? "animate-pulse bg-err text-white" : "bg-sage text-secondary hover:bg-gold hover:text-primary"}`}>
      ● {dictTarget === field && dict.state === "listening" ? "Listening…" : dictTarget === field && dict.state === "connecting" ? "Connecting…" : "Dictate"}
    </button>
  );

  const Interim = ({ field }: { field: Field }) =>
    dictTarget === field && dict.interim
      ? <div className="mt-1 rounded-lg bg-info-bg px-2.5 py-1.5 text-[12px] italic text-info">…{dict.interim}</div>
      : null;

  const save = async (status: "Draft" | "Completed") => {
    setSaving(true); setErr(null);
    try {
      const saved = await api.consultationNotes.save({
        bookingId, complaint, examination, assessment, plan, sketch: sketch ?? undefined,
        prescription: rx, assignedServices: assigned, followUpDate: followUp || null, status,
        // The booking's specialist owns the note; for a walk-in with none, the signed-in doctor does.
        doctorId: me?.doctorId, doctorName: me?.name,
      } as Parameters<typeof api.consultationNotes.save>[0]);
      if (status === "Completed") {
        // The route middleware already audits PRESCRIPTION_SAVED — no second row from here.
        toast(saved?.prescriptionEmailedAt
          ? `Signed — prescription emailed to ${saved.prescriptionEmailedTo ?? "the guest"}`
          : "Consultation signed — prescription unlocked");
      } else {
        toast("Draft saved");
      }
      setDirty(false);
      note.reload(); booking.reload();
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  };

  const completed = note.data?.status === "Completed";

  const downloadRx = () => {
    const p = patient.data;
    const age = ageFrom(p?.dateOfBirth);
    // Always the SIGNED record, never unsaved edits on screen.
    const n = note.data;
    const signed = { rx: n?.prescription ?? [], complaint: n?.complaint ?? "", examination: n?.examination ?? "", assessment: n?.assessment ?? "", plan: n?.plan ?? "", followUp: n?.followUpDate ? isoDay(new Date(n.followUpDate)) : "" };
    const items = signed.rx.map((r) => {
      const bits = [r.dosage, r.frequency, r.duration, r.instructions].filter(Boolean).join(" · ");
      return `<li>${r.medicine}${bits ? ` — ${bits}` : ""}${r.isScheduleH ? " <b>(Sch H)</b>" : ""}</li>`;
    }).join("");
    const html = `<html><head><title>Prescription — ${p?.fullName ?? ""}</title><style>body{font-family:Georgia,serif;max-width:640px;margin:40px auto;color:#111}h1{font-size:20px;letter-spacing:2px}hr{border:0;border-top:1px solid #ccc}li{margin:8px 0}</style></head>
<body><h1>ZENNARA</h1><p>Skin · Aesthetics · Wellness — ${booking.data?.preferredLocation ?? ""}</p><hr>
<p><b>Patient:</b> ${p?.fullName ?? ""}${age ? ` · ${age} ${p?.gender ?? ""}` : ""}${p?.patientId ? `<br><b>Patient ID:</b> ${p.patientId}` : ""}<br><b>Date:</b> ${fmtDateFull(new Date())}</p>
<p><b>Complaint:</b> ${signed.complaint || "—"}</p><p><b>Examination:</b> ${signed.examination || "—"}</p>
<p><b>Assessment:</b> ${signed.assessment || "—"}</p><p><b>Plan:</b> ${signed.plan || "—"}</p>
<h3>Rx</h3><ol>${items || "<li>—</li>"}</ol>
${signed.followUp ? `<p><b>Review on:</b> ${fmtDateFull(signed.followUp)}</p>` : ""}<hr>
<p><b>${doctorName}</b></p></body></html>`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    a.download = `prescription-${(p?.fullName ?? "patient").toLowerCase().replace(/\s+/g, "-")}.html`;
    a.click();
  };

  const PLAN_CHIPS = [
    "Continue current plan", "Start treatment series", "Review in 4 weeks", "Review in 8 weeks",
    "Patch test first", "Home care only", "Refer for procedure", "Repeat photos next visit",
  ];

  if (booking.initial && !booking.data) return <Page title="Consultation"><Loading label="Loading the consultation…" rows={6} /></Page>;
  if (booking.error && !booking.data) return <Page title="Consultation"><Empty title="Couldn’t load that booking" hint={booking.error} action={<Btn onClick={onBack}>← Back</Btn>} /></Page>;

  const bk = booking.data!;
  const p = patient.data;
  const flags = p ? patientFlags(p) : [];
  const age = ageFrom(p?.dateOfBirth);

  return (
    <Page title={`Consultation — ${bk.fullName}`}
      sub={[age ? `${age} ${p?.gender ?? ""}`.trim() : null, bookingServiceName(bk, ""), bookingSlotLabel(bk)]
        .filter(Boolean).join(" · ")}
      actions={<>
        <Btn kind="ghost" onClick={onBack}>← My list</Btn>
        <Tag kind={dirty ? "warn" : completed ? "ok" : "mute"}>{dirty ? "unsaved" : completed ? "completed" : "draft saved"}</Tag>
        <Btn kind="ghost" disabled={saving} onClick={() => save("Draft")}>{saving ? "Saving…" : "Save draft"}</Btn>
        <Btn disabled={saving} onClick={() => save("Completed")}>Complete &amp; sign</Btn>
      </>}>
      {err && <Note kind="crit">{err}</Note>}

      <div className="grid items-start gap-3.5 xl:grid-cols-[240px_minmax(0,1fr)_310px]">
        {/* ---- context ---- */}
        <div className="grid gap-2.5">
          <Card className="p-4">
            <SecH t="Context" />
            {flags.map((f) => <Note key={f} kind="crit" className="my-0 mb-2 text-[11.5px]"><B>{f}</B></Note>)}
            <div className="text-[12px] leading-relaxed text-ink2">
              {p?.patientId && <><B>ID</B> {p.patientId}<br /></>}
              {p?.createdAt && <><B>Since</B> {fmtDate(p.createdAt)}<br /></>}
              <B>Visits</B> {p?.totalVisits ?? 0}<br />
              <B>Membership</B> {p?.memberType ?? "Regular Member"}<br />
              <B>Paid</B> {bk.paymentStatus === "paid" ? fmtINR(bk.amount) : `${fmtINR(bk.amount)} due`}
            </div>
            {p && (
              <Btn kind="ghost" className="mt-2.5 w-full" onClick={() => nav("/doctor/patient", { state: { id: p._id } })}>Full record →</Btn>
            )}
          </Card>

          <Card className="p-4">
            <SecH t="This visit" />
            <div className="mb-2 flex flex-wrap items-center gap-2">{STATUS[statusKey(bk)]}{bk.checkInTime && <span className="text-[10.5px] text-ink3">in {fmtWhen(bk.checkInTime)}</span>}</div>
            {visitErr && <Note kind="crit" className="my-0 mb-2 text-[11.5px]">{visitErr}</Note>}
            <div className="grid gap-1.5">
              {["Confirmed", "Rescheduled", "Awaiting Confirmation"].includes(bk.status) && (
                <Btn disabled={visitBusy} onClick={() => { setCode(""); setVisitErr(null); setOtpOpen("in"); }}>Check in — guest code</Btn>
              )}
              {bk.status === "In Progress" && (
                <Btn kind="gold" disabled={visitBusy} onClick={() => { setCode(""); setVisitErr(null); setOtpOpen("out"); }}>Check out — guest code</Btn>
              )}
              {["Confirmed", "Rescheduled", "Awaiting Confirmation"].includes(bk.status) && (
                <Btn kind="ghost" disabled={visitBusy} onClick={() => visit(
                  () => api.bookings.noShow(bk._id).then(() => audit("BOOKING_NO_SHOW", bk.fullName, { bookingId: bk._id })),
                  "Marked as no-show")}>Mark no-show</Btn>
              )}
              {bk.status === "Completed" && <div className="text-[11.5px] text-ink3">Visit completed{bk.checkOutTime ? ` at ${fmtWhen(bk.checkOutTime)}` : ""}.</div>}
            </div>
          </Card>

          <Card className="p-4">
            <SecH t="Consent" />
            {consent.initial ? <Loading rows={1} label="" /> : !consent.data ? (
              <div className="text-[11.5px] text-ink3">No Patient Consent Form on file — the guest signs it in the app.</div>
            ) : (
              <div className="text-[11.5px] leading-relaxed text-ink2">
                <Tag kind={consent.data.doctorSignature ? "ok" : "warn"}>{consent.data.doctorSignature ? "Counter-signed" : consent.data.status}</Tag>
                <div className="mt-1.5">Signed by <B>{consent.data.patientName}</B> on {fmtDate(consent.data.createdAt)}</div>
                {!consent.data.doctorSignature && (
                  <Btn kind="gold" className="mt-2 w-full !py-1.5 !text-[11.5px]" disabled={visitBusy} onClick={() => visit(
                    () => api.consentForms.doctorSign(consent.data!._id, `${doctorName}|DancingScript`)
                      .then(() => audit("CONSENT_SIGNED", `${bk.fullName} consent counter-signed`, { formId: consent.data!._id }))
                      .then(() => consent.reload()),
                    "Consent counter-signed")}>Counter-sign as {doctorName}</Btn>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <SecH t="Pre-consult form" />
            {form.initial ? <Loading rows={1} label="" /> : !form.data ? (
              <div className="text-[11.5px] text-ink3">The guest has not filled one in for this visit.</div>
            ) : (
              <div className="text-[11.5px] leading-relaxed text-ink2">
                <Tag kind={form.data.status === "Submitted" || form.data.status === "Approved" ? "ok" : "warn"}>{form.data.status}</Tag>
                <div className="mt-1.5">
                  {Object.entries(form.data.reasonForVisit ?? {}).filter(([, v]) => v).length > 0 && (
                    <><B>Here for</B> {Object.entries(form.data.reasonForVisit ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ")}<br /></>
                  )}
                  {Object.entries(form.data.skinConcerns ?? {}).filter(([, v]) => v).length > 0 && (
                    <><B>Skin</B> {Object.entries(form.data.skinConcerns ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ")}<br /></>
                  )}
                  {Object.entries(form.data.hairConcerns ?? {}).filter(([, v]) => v).length > 0 && (
                    <><B>Hair</B> {Object.entries(form.data.hairConcerns ?? {}).filter(([, v]) => v).map(([k]) => k).join(", ")}<br /></>
                  )}
                  {form.data.drugAllergies && (
                    <><b className="font-semibold text-err">Allergies</b> {form.data.drugAllergies}<br /></>
                  )}
                  {form.data.otherAllergies && <><b className="font-semibold text-err">Other allergies</b> {form.data.otherAllergies}<br /></>}
                  {Object.entries(form.data.medicalHistory ?? {}).filter(([, v]) => v).length > 0 && (
                    <><B>Medical history</B> {Object.entries(form.data.medicalHistory ?? {}).filter(([, v]) => v).map(([k, v]) => (typeof v === "string" ? `${k}: ${v}` : k)).join(", ")}<br /></>
                  )}
                  {form.data.planningForPregnancy && <><B>Planning pregnancy</B> yes<br /></>}
                  {form.data.lastMenstrualPeriod && <><B>LMP</B> {fmtDate(form.data.lastMenstrualPeriod)}<br /></>}
                  {form.data.diet?.type && <><B>Diet</B> {String(form.data.diet.type)}<br /></>}
                  {form.data.dailyRoutine && Object.values(form.data.dailyRoutine).some(Boolean) && (
                    <><B>Routine</B> {Object.entries(form.data.dailyRoutine).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(", ")}<br /></>
                  )}
                  {form.data.additionalInfo && Object.values(form.data.additionalInfo).some(Boolean) && (
                    <><B>Also</B> {Object.entries(form.data.additionalInfo).filter(([, v]) => v).map(([k, v]) => `${k}: ${String(v)}`).join(", ")}<br /></>
                  )}
                </div>
                {form.data.status === "Submitted" && (
                  <Btn kind="ghost" className="mt-2 w-full !py-1.5 !text-[11.5px]" disabled={visitBusy} onClick={() => visit(
                    () => api.preConsult.setStatus(form.data!._id, "Reviewed")
                      .then(() => audit("FORM_STATUS_CHANGED", `${bk.fullName} pre-consult reviewed`, { formId: form.data!._id }))
                      .then(() => form.reload()),
                    "Pre-consult form marked reviewed")}>Mark reviewed</Btn>
                )}
              </div>
            )}
          </Card>

          <Card className="p-4">
            <SecH t="History" />
            <Async q={history} label="" rows={2}>
              {(h) => h.bookings.length === 0 && h.notes.length === 0 ? (
                <div className="text-[11.5px] text-ink3">First recorded visit.</div>
              ) : (
                <div className="text-[11.5px] leading-[1.85] text-ink2">
                  {h.bookings.slice(0, 6).map((b) => (
                    <div key={b._id}>{fmtDate(b.confirmedDate || b.preferredDate)} · {bookingServiceName(b, "visit")}</div>
                  ))}
                  {h.notes.slice(0, 3).map((n) => (
                    <div key={n._id} className="mt-1.5 rounded-lg bg-ivory px-2 py-1.5 leading-snug">
                      <div className="text-[10.5px] text-ink3">{fmtDate(n.createdAt)}{n.doctorName ? ` · ${n.doctorName}` : ""} · {n.status}</div>
                      {n.assessment && <div><B>Assessment</B> {n.assessment}</div>}
                      {n.plan && <div><B>Plan</B> {n.plan}</div>}
                      {!!n.prescription?.length && <div><B>Rx</B> {n.prescription.map((r) => r.medicine).join(", ")}</div>}
                    </div>
                  ))}
                </div>
              )}
            </Async>
          </Card>
        </div>

        {/* ---- clinical note ---- */}
        <div className="grid gap-2.5">
          <Card className="p-4">
            <SecH t="Clinical note" em={`· dictation: ${dict.engine === "deepgram" ? "Deepgram live" : dict.engine === "browser" ? "browser engine" : "unavailable"}`} />
            <div className="grid gap-2.5">
              {([
                ["complaint", "Complaint", complaint, setComplaint, 2, "What brought them in today"],
                ["examination", "Examination", examination, setExamination, 3, "Type, or tap Dictate and speak — words stream in live"],
                ["assessment", "Assessment", assessment, setAssessment, 2, "Your clinical impression"],
              ] as [Field, string, string, (v: string) => void, number, string][]).map(([field, label, value, setter, rows, ph]) => (
                <div key={field}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-bold text-ink2">{label}</span><MicBtn field={field} />
                  </div>
                  <Area label="" value={value} rows={rows} placeholder={ph}
                    onChange={(v) => { setter(v); setDirty(true); }} />
                  <Interim field={field} />
                </div>
              ))}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-ink2">Plan — tap chips or dictate</span><MicBtn field="plan" />
                </div>
                <Area label="" value={plan} rows={2} placeholder="Tap the chips below, or dictate…"
                  onChange={(v) => { setPlan(v); setDirty(true); }} />
                <Interim field="plan" />
                <div data-tour="plan-chips" className="mt-1.5 flex flex-wrap gap-1.5">
                  {PLAN_CHIPS.map((c) => (
                    <button key={c} onClick={() => { setPlan((v) => (v ? v + " · " : "") + c); setDirty(true); }}
                      className="rounded-full bg-sage px-2.5 py-1 text-[11px] font-semibold text-secondary hover:bg-gold hover:text-primary">＋ {c}</button>
                  ))}
                  <button onClick={() => setSketchOpen(true)}
                    className="rounded-full border border-dashed border-gold-dark px-2.5 py-1 text-[11px] font-bold text-gold-dark">
                    ✎ {sketch ? "Edit sketch" : "Open sketch pad"}
                  </button>
                </div>
              </div>

              <In label="Review on (optional)" type="date" value={followUp}
                onChange={(v) => { setFollowUp(v); setDirty(true); }} />
            </div>

            {sketch && (
              <>
                <SecH t="Attached sketch" />
                <img src={sketch} alt="Consultation sketch" className="w-full rounded-xl border border-border bg-ivory" />
              </>
            )}
          </Card>

          {!!note.data?.revisions?.length && (
            <Card className="p-4">
              <SecH t="Revision history" em={`· ${note.data.revisions.length} earlier version${note.data.revisions.length === 1 ? "" : "s"}`} />
              <div className="grid gap-1 text-[11.5px] text-ink3">
                {note.data.revisions.slice(-5).reverse().map((r, i) => (
                  <div key={i}>{fmtWhen(r.savedAt)}{r.savedByEmail ? ` · ${r.savedByEmail}` : ""}</div>
                ))}
              </div>
              <Note className="mb-0 text-[11.5px]">A clinical note can be corrected, but the earlier version is kept — it is never silently replaced.</Note>
            </Card>
          )}
        </div>

        {/* ---- assign + rx ---- */}
        <div className="grid gap-2.5">
          <Card data-tour="assign" className="p-4">
            <SecH t="Assign treatment" em="· packages are assigned by the clinic" />
            <input value={svcQ} onChange={(e) => setSvcQ(e.target.value)} placeholder="Search treatments…"
              className="mb-2 w-full rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
            {(services.data?.data ?? []).map((s) => (
              <button key={s._id} onClick={() => {
                setAssigned((a) => [...a, { serviceId: s._id, name: s.name, sessions: 1 }]);
                setSvcQ(""); setDirty(true);
              }}
                className="mb-1.5 flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-ivory px-2.5 py-2 text-left hover:border-gold-dark">
                <span className="min-w-0 truncate text-[12.5px] font-bold">{s.name}</span>
                <span className="shrink-0 text-[10.5px] text-ink3">{fmtINR(s.price)}</span>
              </button>
            ))}
            {assigned.map((a, i) => (
              <div key={i} className="mb-1.5 flex items-center justify-between gap-2 rounded-lg bg-ok-bg px-2.5 py-2 text-[12.5px] font-semibold text-ok">
                <span className="min-w-0 truncate">{a.name}</span>
                <span className="flex shrink-0 items-center gap-1 text-[11px]">
                  <button onClick={() => { setAssigned((x) => x.map((y, j) => (j === i ? { ...y, sessions: Math.max(1, (y.sessions ?? 1) - 1) } : y))); setDirty(true); }} className="rounded bg-white/70 px-1.5">−</button>
                  <span className="font-mono">{a.sessions ?? 1}×</span>
                  <button onClick={() => { setAssigned((x) => x.map((y, j) => (j === i ? { ...y, sessions: (y.sessions ?? 1) + 1 } : y))); setDirty(true); }} className="rounded bg-white/70 px-1.5">+</button>
                  <button onClick={() => { setAssigned((x) => x.filter((_, j) => j !== i)); setDirty(true); }} className="ml-1 font-bold">×</button>
                </span>
              </div>
            ))}
            {assigned.length > 0 && (
              <Note className="mb-0 text-[11px]">Assignments are stored on the note. Billing and package sessions are still created by reception from the guest's record.</Note>
            )}
          </Card>

          <Card data-tour="rx" className="p-4">
            <SecH t="Prescription" right={
              <span className="flex items-center gap-1.5">
                {completed && note.data?._id && (
                  <Btn kind="ghost" className="!py-1 !text-[11.5px]" disabled={sendingRx}
                    onClick={async () => {
                      setSendingRx(true);
                      try {
                        const r = await api.consultationNotes.send(note.data!._id);
                        toast((r.message as string) ?? "Prescription emailed");
                        note.reload();
                      } catch (e) { toast((e as Error).message); } finally { setSendingRx(false); }
                    }}>
                    {sendingRx ? "Sending…" : note.data?.prescriptionEmailedAt ? "Resend email" : "Email to guest"}
                  </Btn>
                )}
                <Btn kind={completed ? "gold" : "ghost"} className="!py-1 !text-[11.5px]" disabled={!completed} onClick={downloadRx}>
                  {completed ? "Download" : "Sign to unlock"}
                </Btn>
              </span>} />
            {completed && note.data?.prescriptionEmailedAt && (
              <div className="mb-2 text-[11px] text-ok">
                ✓ Emailed to {note.data.prescriptionEmailedTo ?? "the guest"} {fmtAgo(note.data.prescriptionEmailedAt)}
              </div>
            )}
            <div className="mb-2 flex gap-2">
              <input value={rxQ} onChange={(e) => setRxQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && rxQ.trim()) {
                    setRx((r) => [...r, { medicine: rxQ.trim(), isScheduleH: false }]);
                    setRxQ(""); setDirty(true);
                  }
                }}
                placeholder="Type a medicine and press Enter"
                className="min-w-0 flex-1 rounded-lg border border-border bg-ivory px-2.5 py-2 text-[12.5px] outline-none focus:border-gold-dark" />
              <Btn kind="ghost" className="!px-2.5 !py-1.5 !text-[11.5px]" disabled={!rxQ.trim()}
                onClick={() => { setRx((r) => [...r, { medicine: rxQ.trim(), isScheduleH: false }]); setRxQ(""); setDirty(true); }}>Add</Btn>
            </div>

            {(rxSuggest.data ?? []).length > 0 && (
              <div className="mb-2 rounded-lg border border-border bg-surface">
                {(rxSuggest.data ?? []).map((pr) => (
                  <button key={pr._id} onClick={() => { setRx((r) => [...r, { medicine: pr.name, isScheduleH: false }]); setRxQ(""); setDirty(true); }}
                    className="flex w-full items-center justify-between gap-2 border-b border-border px-2.5 py-1.5 text-left text-[12px] last:border-0 hover:bg-ivory">
                    <span className="min-w-0 truncate">{pr.name}</span><span className="shrink-0 text-[10.5px] text-ink3">{pr.formulation} · {fmtINR(pr.price)}</span>
                  </button>
                ))}
              </div>
            )}
            {rx.length === 0 && <div className="text-[11.5px] text-ink3">No medicines added. Type to search the pharmacy list, or press Enter to add free text.</div>}
            {rx.map((m, i) => (
              <div key={i} className="mb-1.5 rounded-lg border border-border bg-surface px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 text-[12px] font-semibold">{m.medicine}</span>
                  <button onClick={() => { setRx((r) => r.filter((_, j) => j !== i)); setDirty(true); }}
                    className="shrink-0 font-bold text-err">×</button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {([["dosage", "Dose"], ["frequency", "Frequency"], ["duration", "Duration"]] as [keyof PrescriptionItem, string][]).map(([k, label]) => (
                    <input key={String(k)} value={(m[k] as string) ?? ""} placeholder={label}
                      onChange={(e) => { setRx((r) => r.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x))); setDirty(true); }}
                      className="rounded border border-border bg-ivory px-2 py-1 text-[11px] outline-none focus:border-gold-dark" />
                  ))}
                  <label className="flex items-center gap-1.5 text-[11px] text-ink3">
                    <Toggle on={!!m.isScheduleH}
                      onChange={(v) => { setRx((r) => r.map((x, j) => (j === i ? { ...x, isScheduleH: v } : x))); setDirty(true); }} />
                    Sch H
                  </label>
                </div>
                <input value={m.instructions ?? ""} placeholder="Instructions to the guest"
                  onChange={(e) => { setRx((r) => r.map((x, j) => (j === i ? { ...x, instructions: e.target.value } : x))); setDirty(true); }}
                  className="mt-1.5 w-full rounded border border-border bg-ivory px-2 py-1 text-[11px] outline-none focus:border-gold-dark" />
                {m.isScheduleH && <div className="mt-1"><Tag kind="warn">Schedule H — signed slip required</Tag></div>}
              </div>
            ))}
            <div className="mt-2 border-t border-border pt-2 text-[11px] text-ink3">Signs as <B>{doctorName}</B></div>
          </Card>
        </div>
      </div>

      <Modal open={otpOpen !== null} onClose={() => { setOtpOpen(null); setManualMode(false); setManualReason(""); }}
        title={otpOpen === "in" ? "Check in — enter the guest's code" : "Check out — enter the guest's code"}>
        {!manualMode ? (
          <>
            <Note>Ask the guest for the 6-digit {otpOpen === "in" ? "check-in" : "check-out"} code on their Zennara
              appointment screen. Don&rsquo;t have it? Resend it below.</Note>
            <div className="mt-3"><Otp value={code} onChange={setCode} length={6} /></div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-ink3">Resend code:</span>
              <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" disabled={sendBusy}
                onClick={() => sendCode(otpOpen === "in" ? "checkin" : "checkout", "email")}>Email</Btn>
              <Btn kind="ghost" className="!px-2.5 !py-1 !text-[11.5px]" disabled={sendBusy}
                onClick={() => sendCode(otpOpen === "in" ? "checkin" : "checkout", "whatsapp")}>WhatsApp</Btn>
              <button className="ml-auto text-[11.5px] font-semibold text-ink3 underline-offset-2 hover:underline"
                onClick={() => { setManualMode(true); setVisitErr(null); }}>
                Guest can&rsquo;t receive a code?
              </button>
            </div>
          </>
        ) : (
          <>
            <Note kind="crit">Manual {otpOpen === "in" ? "check-in" : "check-out"} is recorded against your name on the
              booking and in the audit log — the guest is notified it happened without a code.</Note>
            <div className="mt-3">
              <Area label="Reason (required)" value={manualReason} onChange={setManualReason} rows={2}
                placeholder="e.g. No phone with them, email bouncing" />
            </div>
            <button className="mt-2 text-[11.5px] font-semibold text-ink3 underline-offset-2 hover:underline"
              onClick={() => { setManualMode(false); setVisitErr(null); }}>← Back to code entry</button>
          </>
        )}
        {visitErr && <Note kind="crit" className="mt-3">{visitErr}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => { setOtpOpen(null); setManualMode(false); setManualReason(""); }}>Back</Btn>
          <Btn kind={otpOpen === "out" ? "gold" : "primary"}
            disabled={visitBusy || (manualMode ? manualReason.trim().length < 3 : code.length < 6)}
            onClick={async () => {
              const kind = otpOpen;
              const ok = await visit(async () => {
                if (kind === "in") {
                  if (manualMode) await api.bookings.manualCheckIn(bk._id, manualReason.trim());
                  else await api.bookings.verifyCheckIn(bk._id, code);
                  audit("BOOKING_CHECKED_IN", `${bk.fullName}${manualMode ? " · manual" : ""}`, { bookingId: bk._id });
                } else {
                  if (manualMode) await api.bookings.manualCheckOut(bk._id, manualReason.trim());
                  else await api.bookings.verifyCheckOut(bk._id, code);
                  audit("BOOKING_CHECKED_OUT", `${bk.fullName}${manualMode ? " · manual" : ""}`, { bookingId: bk._id });
                }
              }, kind === "in" ? `${bk.fullName} checked in` : "Visit completed");
              if (ok) { setOtpOpen(null); setCode(""); setManualMode(false); setManualReason(""); }
            }}>
            {visitBusy ? "Working…" : manualMode
              ? (otpOpen === "in" ? "Check in without code" : "Check out without code")
              : (otpOpen === "in" ? "Check in" : "Check out")}
          </Btn>
        </div>
      </Modal>

      <Modal open={sketchOpen} onClose={() => setSketchOpen(false)} title="Sketch pad — annotate treatment areas" wide>
        <SketchPad initial={sketch} onSave={(dataUrl) => {
          setSketch(dataUrl); setDirty(true);
          toast("Sketch attached — save the note to keep it");
          setSketchOpen(false);
        }} />
      </Modal>
    </Page>
  );
}

function SketchPad({ initial, onSave }: { initial?: string | null; onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  useEffect(() => {
    if (!initial) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = initial;
  }, [initial]);

  const start = (x: number, y: number) => {
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    drawing.current = true; ctx.beginPath(); ctx.moveTo(x, y);
    ctx.strokeStyle = "#032F22"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  };
  const move = (x: number, y: number) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d"); if (!ctx) return;
    ctx.lineTo(x, y); ctx.stroke();
  };
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 640, ((e.clientY - r.top) / r.height) * 360] as const;
  };

  return (
    <div>
      <div className="mb-2 text-[12px] text-ink3">Draw with a finger, stylus or mouse — mark injection points, peel zones, lesion sites. It attaches to the clinical note.</div>
      <canvas ref={canvasRef} width={640} height={360}
        className="w-full touch-none rounded-xl border-2 border-border bg-[linear-gradient(#FAF8F4,#FAF8F4)]"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); const [x, y] = pos(e); start(x, y); }}
        onPointerMove={(e) => { const [x, y] = pos(e); move(x, y); }}
        onPointerUp={() => { drawing.current = false; }} />
      <div className="mt-3 flex justify-between">
        <Btn kind="ghost" onClick={() => { const c = canvasRef.current; c?.getContext("2d")?.clearRect(0, 0, c.width, c.height); }}>Clear</Btn>
        <Btn onClick={() => onSave(canvasRef.current?.toDataURL("image/png") ?? "")}>Attach to note</Btn>
      </div>
    </div>
  );
}

/* ================= MY PATIENTS ================= */
export function MyPatients() {
  const nav = useNavigate();
  const { admin } = useStore();
  const me = useMyDoctor();
  const [search, setSearch] = useState("");
  const debounced = useDebounced(search);

  const q = useApi(async () => {
    if (!me.data) return [];
    const res = await api.bookings.list({ specialistId: me.data.doctorId });
    const mine = (res.data ?? []).filter(
      (b) => !b.specialistId || b.specialistId === me.data!.doctorId || b.specialistName === me.data!.name,
    );

    // Roll bookings up per guest so the list is "who is under my care", not
    // "every appointment I have ever had".
    const byUser = new Map<string, { name: string; userId: string; visits: number; last?: string; next?: string; services: Set<string> }>();
    for (const b of mine) {
      const id = idOf(b.userId);
      if (!id) continue;
      const entry = byUser.get(id) ?? { name: b.fullName, userId: id, visits: 0, services: new Set<string>() };
      const when = b.confirmedDate || b.preferredDate;
      if (b.status === "Completed") {
        entry.visits += 1;
        if (!entry.last || new Date(when) > new Date(entry.last)) entry.last = when;
      } else if (["Confirmed", "Awaiting Confirmation", "Rescheduled"].includes(b.status)) {
        if (new Date(when).getTime() >= Date.now() && (!entry.next || new Date(when) < new Date(entry.next))) entry.next = when;
      }
      entry.services.add(bookingServiceName(b, ""));
      byUser.set(id, entry);
    }
    return [...byUser.values()].sort((a, b) => (b.last ? new Date(b.last).getTime() : 0) - (a.last ? new Date(a.last).getTime() : 0));
  }, [me.data?._id]);

  const rows = (q.data ?? []).filter((r) => !debounced || r.name.toLowerCase().includes(debounced.toLowerCase()));

  return (
    <Page title="My patients" sub={me.data ? `${me.data.name} · ${(q.data ?? []).length} under your care` : "Loading…"}>
      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <>
            <div className="mb-3">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search your patients…"
                className="w-full max-w-[380px] rounded-(--radius-btn) border border-border bg-surface px-3.5 py-2 text-[13px] outline-none focus:border-gold-dark" />
            </div>
            <Async q={q} label="Gathering your patients…" rows={6}>
              {() => rows.length === 0 ? (
                <Empty title="No patients yet" hint="Guests appear here once they have been booked with you." />
              ) : (
                <DataTable cols={["Patient", "Seen for", "Completed visits", "Last seen", "Next"]}
                  onRow={(i) => nav("/doctor/patient", { state: { id: rows[i].userId } })}
                  rows={rows.map((r) => [
                    <B key={r.userId}>{r.name}</B>,
                    [...r.services].filter(Boolean).slice(0, 2).join(", ") || "—",
                    r.visits,
                    r.last ? fmtDate(r.last) : "—",
                    r.next
                      ? fmtWhen(r.next)
                      : <Tag key={`${r.userId}n`} kind="warn">nothing booked</Tag>,
                  ])} />
              )}
            </Async>
          </>
        )}
      </Async>
    </Page>
  );
}

/* ================= CATALOGUE ================= */
/* ================= MY MONTH ================= */
export function MyMonth() {
  const { admin } = useStore();
  const me = useMyDoctor();

  const q = useApi(async () => {
    if (!me.data) return null;
    const from = new Date(); from.setMonth(from.getMonth() - 1, 1); from.setHours(0, 0, 0, 0);
    const res = await api.bookings.list({ specialistId: me.data.doctorId, startDate: isoDay(from) });
    const mine = (res.data ?? []).filter(
      (b) => !b.specialistId || b.specialistId === me.data!.doctorId || b.specialistName === me.data!.name,
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const inMonth = mine.filter((b) => new Date(b.preferredDate) >= monthStart);
    const prevMonth = mine.filter((b) => {
      const d = new Date(b.preferredDate);
      return d >= prevStart && d < monthStart;
    });

    // 12-month trend of completed consultations.
    const trend: { label: string; count: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      trend.push({
        label: start.toLocaleString("en-GB", { month: "short" }),
        count: mine.filter((b) => {
          const d = new Date(b.preferredDate);
          return d >= start && d < end && b.status === "Completed";
        }).length,
      });
    }

    const byService = new Map<string, number>();
    for (const b of inMonth) {
      const n = bookingServiceName(b, "Other");
      byService.set(n, (byService.get(n) ?? 0) + 1);
    }

    // Weekday load and outcome mix — same month, two more angles on it.
    const byWeekday = [0, 0, 0, 0, 0, 0, 0];
    const byStatus = new Map<string, number>();
    for (const b of inMonth) {
      byWeekday[new Date(b.confirmedDate || b.preferredDate).getDay()] += 1;
      byStatus.set(b.status, (byStatus.get(b.status) ?? 0) + 1);
    }

    const notes = await api.consultationNotes.list({ doctorId: me.data.doctorId, limit: 300 })
      .then((r) => r.data ?? []).catch(() => []);
    const assignedFromNotes = notes.filter(
      (n) => (n.assignedServices ?? []).length > 0 && new Date(n.createdAt ?? 0) >= monthStart,
    ).length;

    return { mine, inMonth, prevMonth, trend, byService, byWeekday, byStatus, notes, assignedFromNotes };
  }, [me.data?._id]);

  return (
    <Page title="My month" sub={me.data ? `${me.data.name} · ${new Date().toLocaleString("en-GB", { month: "long", year: "numeric" })}` : ""}>
      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <Async q={q} label="Adding up your month…" rows={5}>
            {(d) => !d ? <Empty title="No data yet" /> : (() => {
              const completed = d.inMonth.filter((b) => b.status === "Completed").length;
              const prevCompleted = d.prevMonth.filter((b) => b.status === "Completed").length;
              const delta = completed - prevCompleted;
              const noShows = d.inMonth.filter((b) => b.status === "No Show").length;
              const conversion = completed ? (d.assignedFromNotes / completed) * 100 : 0;
              const rated = d.mine.filter((b) => typeof b.rating === "number");
              const avgRating = rated.length ? rated.reduce((n, b) => n + (b.rating ?? 0), 0) / rated.length : null;

              return (
                <>
                  <Stats items={[
                    { k: "Booked", v: d.inMonth.length, d: `${completed} completed` },
                    { k: "vs last month", v: `${delta >= 0 ? "+" : ""}${delta}`, d: `${prevCompleted} completed then`, tone: delta >= 0 ? "up" : "dn" },
                    { k: "→ treatment", v: pct(conversion), d: "consults that assigned something", hot: true },
                    { k: "No-shows", v: noShows, d: d.inMonth.length ? pct((noShows / d.inMonth.length) * 100) : "—", tone: noShows ? "dn" : undefined },
                    { k: "Notes signed", v: d.notes.filter((n) => n.status === "Completed").length, d: `${d.notes.filter((n) => n.status === "Draft").length} still draft` },
                    { k: "Rating", v: avgRating ? avgRating.toFixed(1) : "—", d: `${rated.length} rated visits` },
                  ]} />

                  <div className="grid gap-3 xl:grid-cols-2">
                    <ChartCard title="Completed consultations" sub="Last 12 months" hero={String(completed)}
                      heroTone={delta >= 0 ? `▲ ${delta}` : undefined}>
                      {d.trend.some((t) => t.count > 0)
                        ? <AreaChart pts={d.trend.map((t) => t.count)} labels={d.trend.map((t) => t.label)} label="Consultations" />
                        : <Empty title="No completed consultations yet" hint="Your first completed month will draw the trend line here." />}
                    </ChartCard>
                    <ChartCard title="What you saw most" sub="This month, by service">
                      {d.byService.size
                        ? <HBars rows={[...d.byService.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => [n, c] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                    <ChartCard title="Busiest days" sub="This month, bookings by weekday">
                      {d.inMonth.length
                        ? <HBars rows={[1, 2, 3, 4, 5, 6, 0].map((day) =>
                            [["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][day], d.byWeekday[day]] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                    <ChartCard title="Visit outcomes" sub="This month, by status">
                      {d.byStatus.size
                        ? <HBars rows={[...d.byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => [n, c] as [string, number])} />
                        : <Empty title="Nothing booked this month" />}
                    </ChartCard>
                  </div>

                  <Note className="mt-3">
                    This is your own view — clinic revenue stays with admin. What you see here is workload, conversion
                    and how guests rated the visits.
                  </Note>
                </>
              );
            })()}
          </Async>
        )}
      </Async>
    </Page>
  );
}

/* ================= AVAILABILITY ================= */
export function Availability() {
  const { admin } = useStore();
  const me = useMyDoctor();

  const upcoming = useApi(async () => {
    if (!me.data) return [] as Booking[];
    const res = await api.bookings.list({ specialistId: me.data.doctorId, startDate: isoDay() });
    return (res.data ?? []).filter(
      (b) => (!b.specialistId || b.specialistId === me.data!.doctorId || b.specialistName === me.data!.name)
        && new Date(b.confirmedDate || b.preferredDate).getTime() >= Date.now()
        && !["Cancelled", "Completed", "No Show"].includes(b.status),
    );
  }, [me.data?._id]);

  return (
    <Page title="My centres" sub="Where you practise — centre assignment is managed by the clinic admin">
      <Async q={me} label="Loading your profile…" rows={3}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <>
            <Card className="p-4">
              <SecH t="Centres I practise at" em={`· ${(doctor.availableCentres ?? []).length}`} />
              {(doctor.availableCentres ?? []).length === 0 ? (
                <Empty title="No centre assigned yet"
                  hint="The clinic admin assigns your centres — until then you cannot be booked in the app." />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(doctor.availableCentres ?? []).map((c) => (
                    <span key={c} className="rounded-full bg-sage px-3 py-1.5 text-[12px] font-semibold text-secondary">{c}</span>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[11.5px] leading-relaxed text-ink3">
                Need a centre added or removed? Ask the clinic admin — assignment lives in the admin panel.
                Your weekly sitting hours at these centres are yours to manage in <B>My schedule</B>;
                each centre&rsquo;s opening hours and closure days are set by the clinic and automatically
                clamp your bookable slots.
              </div>
            </Card>

            <Card className="mt-3 p-4">
              <SecH t="Your upcoming bookings" em={`· ${(upcoming.data ?? []).length}`} />
              <Async q={upcoming} label="Loading your diary…" rows={4}>
                {(list) => list.length === 0 ? (
                  <Empty title="Nothing booked ahead" />
                ) : (
                  <DataTable cols={["When", "Guest", "Service", "Centre", "Status"]}
                    rows={list.slice(0, 25).map((b) => [
                      bookingSlotLabel(b),
                      <B key={b._id}>{b.fullName}</B>,
                      bookingServiceName(b),
                      b.preferredLocation,
                      STATUS[statusKey(b)],
                    ])} />
                )}
              </Async>
            </Card>
          </>
        )}
      </Async>
    </Page>
  );
}


/* ---------- the doctor's own fee, and requesting a change ---------- */
function MyFeeCard() {
  const { toast } = useStore();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const q = useApi(() => api.feeRequests.myFee(), []);
  const history = useApi(() => api.feeRequests.list({ mine: "true", limit: 20 }), []);
  const me = q.data;
  const past = (history.data?.data ?? []).filter((r) => r.status !== "Pending");

  useEffect(() => {
    if (!open) return;
    setAmount(me?.effectiveFee ? String(me.effectiveFee) : "");
    setReason("");
    setErr(null);
  }, [open, me?.effectiveFee]);

  const submit = async () => {
    setErr(null);
    const value = Number(amount);
    if (!value || value <= 0) return setErr("Enter the fee you would like to charge");
    if (reason.trim().length < 10) return setErr("Give the admin a reason — at least 10 characters");
    setBusy(true);
    try {
      await api.feeRequests.create({ requestedFee: value, reason: reason.trim() });
      toast("Request sent — an admin will review it");
      setOpen(false);
      q.reload(); history.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (q.initial && !me) return <Loading label="Loading your fee…" rows={2} />;
  if (!me?.linked) {
    return (
      <Note className="my-0 text-[11.5px]">
        No dermatologist profile is linked to this login yet, so there is no fee to manage.
      </Note>
    );
  }

  const pending = me.pendingRequest;

  return (
    <>
      <Card className="p-4">
        <div className="text-[22px] font-bold tabular-nums">{fmtINR(me.effectiveFee)}</div>
        <div className="mt-0.5 text-[11.5px] text-ink3">
          {me.hasOverride
            ? `Your approved rate · the standard fee for your tier is ${fmtINR(me.standardFee)}`
            : "The clinic's standard fee for your tier"}
        </div>

        {pending ? (
          <>
            <Note className="mb-0 mt-3 text-[11.5px]">
              <B>Request pending.</B> You asked for {fmtINR(pending.requestedFee)} on{" "}
              {fmtWhen(pending.createdAt)}. An admin will review it.
            </Note>
            <Btn kind="ghost" className="mt-2 w-full" onClick={async () => {
              try {
                await api.feeRequests.withdraw(pending._id);
                toast("Request withdrawn"); q.reload(); history.reload();
              } catch (e) { toast((e as Error).message); }
            }}>Withdraw request</Btn>
          </>
        ) : (
          <Btn kind="gold" className="mt-3 w-full" onClick={() => setOpen(true)}>Request a fee change</Btn>
        )}

        {past.length > 0 && (
          <>
            <SecH t="Past requests" />
            <div className="grid gap-1.5">
              {past.slice(0, 4).map((r) => (
                <div key={r._id} className="rounded-lg bg-ivory px-2.5 py-2 text-[11.5px]">
                  <div className="flex items-center justify-between gap-2">
                    <span>{fmtINR(r.currentFee)} → {fmtINR(r.requestedFee)}</span>
                    {r.status === "Approved"
                      ? <Tag kind="ok">Approved{r.approvedFee !== r.requestedFee ? ` at ${fmtINR(r.approvedFee ?? 0)}` : ""}</Tag>
                      : r.status === "Rejected" ? <Tag kind="err">Rejected</Tag> : <Tag kind="mute">{r.status}</Tag>}
                  </div>
                  {r.reviewNote && <div className="mt-1 text-ink3">“{r.reviewNote}”</div>}
                  <div className="mt-0.5 font-mono text-[10px] text-ink3">{fmtWhen(r.decidedAt ?? r.createdAt)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Request a fee change">
        <Note className="mt-0">
          You cannot change your own fee. This sends a request to an admin, who can approve it as asked,
          approve a different amount, or decline with a reason.
        </Note>
        <div className="grid gap-3">
          <In label="Fee you would like to charge (₹)" type="number" value={amount} onChange={setAmount}
            hint={`You currently charge ${fmtINR(me.effectiveFee)}${me.hasOverride ? "" : ` (the standard fee)`}.`} />
          <Area label="Why? (the admin reads this)" value={reason} onChange={setReason} rows={4}
            placeholder="e.g. additional fellowship completed, longer consultation slots, demand at this centre…" />
        </div>
        {err && <Note kind="crit">{err}</Note>}
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setOpen(false)}>Cancel</Btn>
          <Btn disabled={busy} onClick={submit}>{busy ? "Sending…" : "Send request"}</Btn>
        </div>
      </Modal>
    </>
  );
}

/* ================= MY PROFILE ================= */
/** Chip editor — click a chip to remove it, type and press Enter to add one. */
function ChipList({ label, em, values, onChange, placeholder }: {
  label: string; em?: string; values: string[]; onChange: (next: string[]) => void; placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div>
      <SecH t={label} em={em} />
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((e, i) => (
          <button key={`${e}${i}`} type="button" title="Remove" onClick={() => onChange(values.filter((_, j) => j !== i))}
            className="rounded-full bg-sage px-2.5 py-1 text-[11px] font-semibold text-secondary hover:bg-err-bg hover:text-err">{e} ×</button>
        ))}
        <input value={draft} onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={placeholder ?? "+ type & press Enter"}
          className="w-60 max-w-full rounded-full border border-dashed border-border bg-surface px-2.5 py-1 text-[11px] outline-none focus:border-gold-dark" />
      </div>
    </div>
  );
}

/**
 * Login email, phone and password — the account, as distinct from the app card.
 * The clinic admin can change all of these too, from the dermatologist's page
 * in the admin panel; changes here need the current password where it matters.
 */
function AccountSecurity() {
  const { toast, admin } = useStore();
  const acct = useApi(() => api.auth.me(), []);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [pwOpen, setPwOpen] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  useEffect(() => {
    if (acct.data) { setEmail(acct.data.email); setPhone(acct.data.phone ?? ""); }
  }, [acct.data]);

  const emailChanged = !!acct.data && email.trim().toLowerCase() !== acct.data.email;
  const phoneChanged = !!acct.data && (phone.trim() || "") !== (acct.data.phone ?? "");

  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr("Enter a valid email address"); return; }
    if (emailChanged && acct.data?.hasPassword && !confirmPw) { setErr("Enter your current password to change the email"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.auth.updateContact({
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        ...(emailChanged ? { currentPassword: confirmPw } : {}),
      });
      toast(emailChanged ? `Saved — you now sign in as ${r.email}` : "Saved");
      setConfirmPw("");
      acct.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const changePassword = async () => {
    if (newPw.length < 8) { setPwErr("The new password must be at least 8 characters"); return; }
    if (newPw !== newPw2) { setPwErr("The passwords don't match"); return; }
    setPwBusy(true); setPwErr(null);
    try {
      await api.auth.updatePassword(curPw, newPw);
      toast("Password changed");
      setPwOpen(false); setCurPw(""); setNewPw(""); setNewPw2("");
      acct.reload();
    } catch (e) { setPwErr((e as Error).message); } finally { setPwBusy(false); }
  };

  return (
    <Card className="grid gap-2.5 p-3.5">
      <In label="Login email" type="email" value={email} onChange={setEmail}
        hint="You sign in to this panel with this address" />
      <In label="Phone" value={phone} onChange={setPhone} hint="Staff contact only — never shown in the app" />
      {emailChanged && acct.data?.hasPassword && (
        <In label="Current password" type="password" value={confirmPw} onChange={setConfirmPw}
          hint="Required to change your sign-in email" />
      )}
      {(emailChanged || phoneChanged) && (
        <Btn disabled={busy} onClick={save}>{busy ? "Saving…" : "Save changes"}</Btn>
      )}
      <div className="flex items-center justify-between rounded-xl border border-border bg-ivory px-3.5 py-2.5">
        <div>
          <div className="text-[12.5px] font-bold">Password</div>
          <div className="text-[11px] text-ink3">
            {acct.data?.hasPassword ? "Set — you sign in with it" : "Not set yet — ask the clinic admin for one"}
          </div>
        </div>
        <Btn kind="ghost" onClick={() => { setCurPw(""); setNewPw(""); setNewPw2(""); setPwErr(null); setPwOpen(true); }}>
          Change
        </Btn>
      </div>
      {err && <Note kind="crit" className="mb-0">{err}</Note>}

      <Modal open={pwOpen} onClose={() => setPwOpen(false)} title="Change my password">
        <div className="grid gap-2.5">
          {acct.data?.hasPassword && (
            <In label="Current password" type="password" value={curPw} onChange={setCurPw} />
          )}
          <In label="New password" type="password" value={newPw} onChange={setNewPw} hint="At least 8 characters" />
          <In label="Confirm new password" type="password" value={newPw2} onChange={setNewPw2} />
          {pwErr && <Note kind="crit" className="mb-0">{pwErr}</Note>}
          <div className="flex justify-end gap-2">
            <Btn kind="ghost" onClick={() => setPwOpen(false)}>Cancel</Btn>
            <Btn disabled={pwBusy || !newPw || !newPw2 || (!!acct.data?.hasPassword && !curPw)} onClick={changePassword}>
              {pwBusy ? "Saving…" : "Change password"}
            </Btn>
          </div>
          <Note className="mb-0 text-[11.5px]">
            Signed in as <B>{admin?.email}</B>. Forgot your current password? The clinic admin can reset it
            from your page in the admin panel.
          </Note>
        </div>
      </Modal>
    </Card>
  );
}

export function DoctorProfile() {
  const { toast, audit, admin } = useStore();
  const me = useMyDoctor();
  const [f, setF] = useState<Partial<Doctor>>({});
  const [prevOpen, setPrevOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const tiers = useApi(() => api.doctors.tiers().catch(() => []), []);

  useEffect(() => { if (me.data) { setF(me.data); setDirty(false); } }, [me.data?._id]);

  const set = <K extends keyof Doctor>(k: K) => (v: Doctor[K]) => { setF((s) => ({ ...s, [k]: v })); setDirty(true); };

  // Typed-but-unsaved edits only live in this tab — warn before they are lost.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const tierFee = tiers.data?.find((t) => t.id === f.tier)?.fee ?? 0;
  const shownFee = f.fee || tierFee;

  const publish = async () => {
    if (!me.data) return;
    setBusy(true); setErr(null);
    try {
      // The tier and its fee are admin-owned; a doctor edits their identity.
      // The clinic owns designation, fee/tier and centres — the server strips
      // them from a dermatologist's own update, so they are not sent at all.
      await api.doctors.update(me.data._id, {
        name: f.name?.trim() || me.data.name, photo: f.photo,
        experienceYears: Number(f.experienceYears) || 0,
        experienceNote: f.experienceNote, qualifications: f.qualifications, expertise: f.expertise,
        achievements: f.achievements, phone: f.phone,
      });
      audit("DOCTOR_UPDATED", `${me.data.name} updated their app profile`, { doctorId: me.data.doctorId });
      toast("Saved — your app card is live");
      setPrevOpen(false);
      setDirty(false);
      me.reload();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title="My profile" sub="What guests see on the app's dermatologist card"
      actions={<>
        {dirty && <Tag kind="warn">unsaved changes</Tag>}
        <Btn kind="ghost" onClick={() => setPrevOpen(true)} disabled={!me.data}>Preview</Btn>
        <Btn kind="gold" onClick={publish} disabled={!me.data || busy || !dirty}>{busy ? "Saving…" : "Save & publish"}</Btn>
      </>}>
      {err && <Note kind="crit" className="mb-3">{err}</Note>}
      <Async q={me} label="Loading your profile…" rows={5}>
        {(doctor) => !doctor ? <NoProfile email={admin?.email} /> : (
          <div className="grid items-start gap-3.5 xl:grid-cols-[minmax(0,1fr)_300px]">
            <Card className="p-4">
              <div className="mb-4">
                <div className="mb-1.5 text-[11px] font-bold text-ink2">Profile photo</div>
                <div className="flex items-center gap-4">
                  {f.photo
                    ? <img src={f.photo} alt="" className="h-32 w-32 rounded-full border-2 border-gold-dark object-cover" />
                    : <span className="grid h-32 w-32 place-items-center rounded-full border-2 border-border bg-gradient-to-br from-sage to-cream text-[34px] font-extrabold text-primary">
                        {initials(doctor.name)}
                      </span>}
                  <div className="grid flex-1 gap-2">
                    <UploadField label="Photo" value={f.photo ?? ""} onChange={set("photo")} preview={false}
                      upload={(file) => api.media.upload([file]).then((r) => r?.[0]?.url ?? "")} />
                    {f.photo && (
                      <button onClick={() => set("photo")(null)} className="text-left text-[12px] font-semibold text-err">
                        Remove — back to initials
                      </button>
                    )}
                    <div className="max-w-[280px] text-[11px] leading-relaxed text-ink3">
                      Square image, at least <B>400 × 400 px</B>. Shown as a circle — face centred, plain background
                      works best. Upload straight from here, or paste a URL.
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <In label="Display name" value={f.name ?? ""} onChange={set("name")}
                  hint="Shown on your app card exactly as typed here" />
                <In label="Designation" value={doctor.designation ?? ""} onChange={() => {}} readOnly
                  hint="Set by the clinic with your consultation tier — ask admin to change it" />
                <In label="Years of experience" type="number" value={String(f.experienceYears ?? 0)}
                  onChange={(v) => set("experienceYears")(Number(v) || 0)} />
                <In label="Consultation fee" value={fmtINR(shownFee)} onChange={() => {}} readOnly
                  hint="The clinic sets this. Use “My fee” below to request a change." />
                <In label="Contact phone" value={f.phone ?? ""} onChange={set("phone")}
                  hint="Clinic contact only — never shown in the app" />
                <In label="Centres" value={(doctor.availableCentres ?? []).join(", ") || "none set"} onChange={() => {}} readOnly
                  hint="Assigned by the clinic admin" />
              </div>

              <div className="mt-3 grid gap-3">
                <Area label="About you — shown on your app card" value={f.experienceNote ?? ""}
                  onChange={set("experienceNote")} rows={3} />
              </div>

              <div className="mt-4 grid gap-4">
                <ChipList label="Qualifications" em="· shown on the app card" values={f.qualifications ?? []}
                  onChange={set("qualifications")} placeholder="+ e.g. MD (Dermatology) — Enter to add" />
                <ChipList label="Expertise" em="· shown on the app card" values={f.expertise ?? []}
                  onChange={set("expertise")} placeholder="+ e.g. Acne & acne scars — Enter to add" />
                <ChipList label="Achievements" em="· optional" values={f.achievements ?? []}
                  onChange={set("achievements")} placeholder="+ e.g. 10,000+ procedures — Enter to add" />
              </div>
            </Card>

            <div className="grid gap-2">
              <SecH t="My fee" />
              <MyFeeCard />

              <SecH t="Account & security" />
              <AccountSecurity />

              <SecH t="Visibility" />
              <div className="flex items-center justify-between rounded-xl border border-border bg-ivory px-3.5 py-2.5">
                <div><div className="text-[12.5px] font-bold">Listed in the app</div><div className="text-[11px] text-ink3">Only an admin can change this — ask them if you need to come off the list</div></div>
                <Tag kind={doctor.isActive ? "ok" : "mute"}>{doctor.isActive ? "Listed" : "Hidden"}</Tag>
              </div>
              <Note className="text-[11.5px]">
                Availability lives in <B>My availability</B>. This page is your identity as guests see it,
                and every publish is audited.
              </Note>
              {err && <Note kind="crit">{err}</Note>}
            </div>
          </div>
        )}
      </Async>

      <Modal open={prevOpen} onClose={() => setPrevOpen(false)} title="This is how your card will look">
        <div className="rounded-2xl border border-border bg-ivory p-4">
          <div className="flex items-start gap-3">
            {f.photo
              ? <img src={f.photo} alt="" className="h-14 w-14 rounded-full border border-gold-dark object-cover" />
              : <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-sage to-cream text-[16px] font-extrabold text-primary">
                  {initials(me.data?.name)}
                </span>}
            <div>
              <b className="text-[14.5px] font-bold">{f.name || me.data?.name}</b>
              <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-gold-dark">{f.designation}</div>
              <div className="mt-0.5 text-[11px] text-ink3">
                {f.experienceYears ? `${f.experienceYears} yrs` : ""}{shownFee ? ` · ${fmtINR(shownFee)}` : ""}
              </div>
            </div>
          </div>
          {f.experienceNote && <div className="mt-2 text-[12px] text-ink2">{f.experienceNote}</div>}
          <div className="mt-2 flex flex-wrap gap-1">
            {(f.expertise ?? []).slice(0, 6).map((e, i) => (
              <span key={`${e}${i}`} className="rounded-full bg-sage px-2 py-0.5 text-[10px] font-semibold text-secondary">{e}</span>
            ))}
            {(f.expertise?.length ?? 0) > 6 && <span className="text-[10px] text-ink3">+{f.expertise!.length - 6} more</span>}
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Btn kind="ghost" onClick={() => setPrevOpen(false)}>Keep editing</Btn>
          <Btn kind="gold" disabled={busy} onClick={publish}>{busy ? "Publishing…" : "Publish to app"}</Btn>
        </div>
      </Modal>
      
    </Page>
  );
}
